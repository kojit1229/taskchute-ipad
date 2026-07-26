// v145 検証: エネルギーバッテリー「行動接続」— 残量低下時の回復Block下書き提案(P4、opt-in・既定OFF)。
// design-proposal.md §3(P4)。CHANGES_v145.md参照。2026-07-27の2系統レビュー対応後の再検証を含む。
//
// app.js は type="module" のため内部関数を window に露出しない(既存方針、v144と同じ)。
// 本テストは page.clock.setFixedTime で時刻を固定し、localStorageへの状態注入 + 画面表示
// (下書きバー・draft-blockの有無とテキスト)で挙動を間接検証する。
//
// 検証項目:
// (1) recoveryDraft OFF(既定)では、閾値を下回っていても何も起きない
// (2) recoveryDraft ONでも、残量が閾値以上なら何も起きない
// (3) recoveryDraft ONかつ閾値を下回ると下書きが現れる。候補選定:
//     n>=3・net中央値>0のタイトルだけが採用され(最大2件)、n<3のタイトル・net中央値が
//     負のタイトルは候補から除外される
// (4) 1日1回の冪等: 一度発火した後は同日中に何度ティッカーが回っても再発火しない
//     (下書きを破棄した後も再度は現れない)
// (5) 既存のdraft操作(個別却下 draft-remove・確定 draft-confirm)がそのまま使える
// (6) 既存の_scheduleDraft(朝プラン等)への追記経路: 重ならない配置になる
// (7) 当日に予定Blockがある状態での衝突回避
// (8) 空き無し時のno-op(冪等マーカーは立つが下書きは0件)
// (9) recoveryThresholdPctのクランプ(1〜100外は既定40)
// (10) batteryフィールド欠落state(v144時点の旧state)のnormalizeState後方互換
// (11) 候補選定の優先順位: net中央値が高い方が、競合する空き時間を優先的に得る
// (12) 朝プラン(runAiMorningPlan)処理中は回復提案がスキップされ、冪等マーカーも焼かれない
//      (完了後に改めて評価されて発火する)
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const TODAY = "2026-07-27";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// 直近4週(28日)以内・net(charge−discharge)中央値が正・n>=3で採用されるべき2タイトルと、
// 除外されるべき2タイトル(n<3 / net中央値が負)を仕込む共通の候補Block群。
// すべて「今日」より前の日付にし、当日の空き時間計算(computeFreeGaps)に干渉しないようにする。
function candidateBlocks() {
  const mk = (id, date, title, category, hStart, hEnd, charge, discharge) => ({
    id, date, title, category,
    plannedStartAt: `${date}T${hStart}`, plannedEndAt: `${date}T${hEnd}`,
    actualStartAt: `${date}T${hStart}`, actualEndAt: `${date}T${hEnd}`,
    completed: true, charge, discharge, estimateMin: 0, deleted: false
  });
  return [
    // 採用されるべき: 「ストレッチ」n=3, net=4(charge5-discharge1) x3, 20分
    mk("c-str-1", "2026-07-20", "ストレッチ", "休息", "09:00", "09:20", 5, 1),
    mk("c-str-2", "2026-07-21", "ストレッチ", "休息", "09:00", "09:20", 5, 1),
    mk("c-str-3", "2026-07-22", "ストレッチ", "休息", "09:00", "09:20", 5, 1),
    // 採用されるべき: 「散歩」n=3, net=6(charge7-discharge1) x3, 30分
    mk("c-walk-1", "2026-07-20", "散歩", "休息", "12:00", "12:30", 7, 1),
    mk("c-walk-2", "2026-07-21", "散歩", "休息", "12:00", "12:30", 7, 1),
    mk("c-walk-3", "2026-07-22", "散歩", "休息", "12:00", "12:30", 7, 1),
    // 除外されるべき: 「昼寝」n=2(3件未満)、net自体は正(8)
    mk("c-nap-1", "2026-07-23", "昼寝", "休息", "13:00", "13:20", 9, 1),
    mk("c-nap-2", "2026-07-24", "昼寝", "休息", "13:00", "13:20", 9, 1),
    // 除外されるべき: 「逆効果ブロック」n=3だがnet中央値が負(-4)
    mk("c-bad-1", "2026-07-17", "逆効果ブロック", "作業", "10:00", "10:20", 1, 5),
    mk("c-bad-2", "2026-07-18", "逆効果ブロック", "作業", "10:00", "10:20", 1, 5),
    mk("c-bad-3", "2026-07-19", "逆効果ブロック", "作業", "10:00", "10:20", 1, 5)
  ];
}

// 当日の実Block(予定のみ、completed不問)。computeFreeGapsの占有区間として使う。
function plannedBlock(id, title, hStart, hEnd, category = "") {
  return {
    id, date: TODAY, title, category,
    plannedStartAt: `${TODAY}T${hStart}`, plannedEndAt: `${TODAY}T${hEnd}`,
    actualStartAt: "", actualEndAt: "",
    completed: false, charge: 0, discharge: 0, estimateMin: 0, deleted: false
  };
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  // localStorageのbattery設定/blocks/tasks/projects/冪等マーカーを丸ごと差し替えてreloadする
  // 共通ヘルパー。timelineModeは明示的に"planned"にする(下書きレイヤはplannedモードでのみ
  // 描画されるため、前セッションの状態を持ち越さない)。tasks/projectsも既定で空配列に揃え、
  // デモデータの残存タスクが朝プラン等の候補に紛れ込まないようにする(決定論性のため)。
  async function seed({ battery, blocks, batteryRecoveryDraftDates, tasks, projects, ai } = {}) {
    await page.evaluate(({ KEY, TODAY, battery, blocks, batteryRecoveryDraftDates, tasks, projects, ai }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.sleep = s.sleep || { logs: {} };
      s.sleep.logs = {};  // 睡眠ログ無し→level:none→体力予算normal(開始値50)に揃える
      s.condition = s.condition || { logs: {} };
      s.condition.logs = {};
      s.blocks = blocks || [];
      s.tasks = tasks || [];
      s.projects = projects || [];
      s.selectedDate = TODAY;
      s.currentView = "home";
      s.timelineMode = "planned";
      s.settings.battery = { ...(s.settings.battery || {}), ...(battery || {}) };
      s.settings.ai = { ...(s.settings.ai || {}), ...(ai || {}) };
      s.batteryRecoveryDraftDates = batteryRecoveryDraftDates || [];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY, battery, blocks, batteryRecoveryDraftDates, tasks, projects, ai });
    await page.reload();
    await page.waitForTimeout(900);  // ティッカー初回発火(500ms周期)+起動時setTimeoutの猶予
  }

  async function goTimeline() {
    await page.click('[data-action="nav"][data-view="timeline"]');
    await page.waitForTimeout(300);
  }
  async function goTasks() {
    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(200);
  }
  async function goSettings() {
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(200);
  }

  async function draftBlockTitles() {
    return page.locator(".draft-block-title").allTextContents();
  }

  // draft-blockの{title, start(分), minutes}を画面から読み取る(draft-block-time文字列
  // "HH:MM〜HH:MM(N分)"をパース)。既存下書きとの重なり検証・優先順位検証に使う。
  async function draftItems() {
    return page.$$eval(".draft-block", (els) => els.map((el) => {
      const timeText = el.querySelector(".draft-block-time")?.textContent || "";
      const titleText = el.querySelector(".draft-block-title")?.textContent || "";
      const m = timeText.match(/(\d{2}):(\d{2})〜(\d{2}):(\d{2})\((\d+)分\)/);
      return { title: titleText, start: m ? Number(m[1]) * 60 + Number(m[2]) : null, minutes: m ? Number(m[5]) : null };
    }));
  }
  function hasOverlap(items) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.start == null || b.start == null) continue;
        const aEnd = a.start + a.minutes, bEnd = b.start + b.minutes;
        if (a.start < bEnd && b.start < aEnd) return true;
      }
    }
    return false;
  }

  const wbsTask = (id, title) => ({
    id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
    description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  });
  const testProject = () => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (1) recoveryDraft OFF(既定)では、残量が閾値を下回っていても何も起きない
    // ============================================================
    console.log("[1] recoveryDraft OFF(既定)では何も起きない");
    await page.clock.setFixedTime(new Date(2026, 6, 27, 18, 0, 0, 0));  // 07:00から11h、decay33→残量17(<20)
    await seed({ battery: { recoveryDraft: false }, blocks: candidateBlocks() });
    await goTimeline();
    check("下書きバーが出ない(draft-bar count 0)", await page.locator(".draft-bar").count() === 0);
    check("下書きBlockも出ない(draft-block count 0)", await page.locator(".draft-block").count() === 0);
    let st = await stateNow();
    check("batteryRecoveryDraftDatesにも今日が記録されない(判定自体が走っていない)",
      !(st.batteryRecoveryDraftDates || []).includes(TODAY));

