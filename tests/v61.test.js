// v61 検証: ROADMAP フェーズ1(繰り越しの無自覚化と継続の自己否定を止める)。
//
// (a) carryCount が繰越経路(carryOverBlock=タスクシュート画面の「→ 今日へ」)と
//     朝プラン確定経路(confirmScheduleDraft)の両方で増える
// (b) 3回目以降も追加UIを挟まず、通常どおり繰り越せる
// (c) 「今日の理想」ワンライナーの保存・3日間のホーム表示(1〜3日目)・3日目のリトライ(続ける/手放す)・
//     日報生成(generateReport)への反映
// (d) normalizeState の後方互換(旧state = carryCount/ideal/migrationRitualLog が無いデータ)
//
// 方針: 既存スイート(v59/v60)と同じく、app.js は type="module" のため内部関数は window に
// 露出しない。ブラウザ操作 + localStorage 状態の直接注入で観測する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  // v72: api.github.com への実ネットワーク呼び出しを既定404で塞ぐ(個人データAPI化に伴う対策。tests/helpers.js参照)
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  const now0 = new Date();
  // コーディネーター指摘(2026-07-09, v61レビュー、v50/v59/v60への指摘を本スイートにも適用):
  // [9][10]は🌅朝プラン(内部でcomputeFreeGapsが「現在時刻〜23:00」の空き枠に依存)を実行するため、
  // 深夜23:00付近に実行すると空き枠が消えてフレーキーになり得る。page.clock でページ内の
  // 現在時刻を日中(10:00)に固定し、実行時刻に依存しないようにする(アプリ本体は無改修)。
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const YEST = isoDate(new Date(now0.getTime() - 24 * 60 * 60 * 1000));
  const YEST2 = isoDate(new Date(now0.getTime() - 2 * 24 * 60 * 60 * 1000));

  function planBlock({ id, date, title, startMin, endMin, taskId = "", category = "", migratedTo = "", carryCount = 0 }) {
    return {
      id, taskId, date, title, category,
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(endMin)}`,
      actualStartAt: "", actualEndAt: "",
      completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo, orderIndex: 0, carryCount, isMIT: false, source: "",
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`,
      deleted: false
    };
  }
  function wbsTask(id, title) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }
  const testProject = () => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });

  // 共通の下地: blocks/tasks/projects/journalMeta を丸ごと差し替えて reload。
  async function seed({ blocks = [], tasks = [], projects = [], journalMeta = {}, view = "tasks" } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, journalMeta, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.journalMeta = journalMeta;
      s.migrationRitualLog = [];
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, journalMeta, TODAY, view });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  await page.clock.setFixedTime(now0);  // goto前に固定してアプリ起動時のnew Date()から一貫させる
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(500);
  // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため、
  // 既存スイートの前提(設定済みstate)を保つためテスト用トークンを注入する(tests/helpers.js参照)
  await passGithubGate(page);

  // ============================================================
  // (d) normalizeState 後方互換: 旧state(carryCount/ideal/migrationRitualLogが無い)
  // ============================================================
  console.log("[1] normalizeState 後方互換(carryCount / journalMeta.ideal / migrationRitualLog)");
  await page.evaluate(({ KEY, TODAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.blocks = [{
      id: "legacy-block", taskId: "", date: TODAY, title: "旧データBlock", category: "",
      plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
      actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
      // carryCount フィールドなし(旧データを模擬)
    }];
    s.journalMeta = { [TODAY]: { aiMitCandidates: [], aiImported: false } };  // ideal フィールドなし
    delete s.migrationRitualLog;  // フィールド自体が無い旧state
    s.projects = [];
    s.tasks = [];
    s.selectedDate = TODAY;
    s.currentView = "home";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY });
  await page.reload();
  await page.waitForTimeout(500);
  // 何か保存操作を挟んでメモリ上の正規化値を永続化させる(v59/v60のテストと同じ作法)
  await page.click('[data-action="nav"][data-view="home"]');
  await page.waitForTimeout(300);
  const normalized = await stateNow();
  const legacyBlock = (normalized.blocks || []).find((b) => b.id === "legacy-block");
  check("carryCount のデフォルト(0)が補完される", !!legacyBlock && legacyBlock.carryCount === 0, JSON.stringify(legacyBlock));
  check("journalMeta.ideal のデフォルト('')が補完される", normalized.journalMeta?.[TODAY]?.ideal === "", JSON.stringify(normalized.journalMeta?.[TODAY]));
  check("migrationRitualLog が空配列で補完される", Array.isArray(normalized.migrationRitualLog) && normalized.migrationRitualLog.length === 0, JSON.stringify(normalized.migrationRitualLog));
  check("既存データはクラッシュせず表示できる(pageerror無し)", true);  // pageerrorハンドラで既に監視中

  // ============================================================
  // (a) carryCount の増加: carryOverBlock 経路
  // ============================================================
  console.log("[2] carryOverBlock 経路: 通常の繰り越しでcarryCountが0→1になる");
  await seed({
    blocks: [planBlock({ id: "cb-a", date: YEST, title: "テストA(初回繰越)", startMin: 10 * 60, endMin: 10 * 60 + 30, carryCount: 0 })]
  });
  check("繰越パネルにバッジが出ない(carryCount=0)", await page.locator('.carryover-row:has-text("テストA") .migration-badge').count() === 0);
  await page.click('[data-action="carry-over"][data-id="cb-a"]');
  await page.waitForTimeout(300);
  let s2 = await stateNow();
  let newA = (s2.blocks || []).find((b) => b.date === TODAY && b.title === "テストA(初回繰越)");
  let srcA = (s2.blocks || []).find((b) => b.id === "cb-a");
  check("新Blockのcarryが1になる", !!newA && newA.carryCount === 1, JSON.stringify(newA));
  check("元BlockにmigratedToが付く", !!srcA && srcA.migratedTo === newA.id);

  console.log("[3] carryOverBlock 経路: carryCount=2 → バッジ表示 → 直接3回目として繰り越す");
  await seed({
    blocks: [planBlock({ id: "cb-b", date: YEST, title: "テストB(2回繰越済み)", startMin: 10 * 60, endMin: 10 * 60 + 30, carryCount: 2 })]
  });
  const badgeText = await page.locator('.carryover-row:has-text("テストB") .migration-badge').textContent().catch(() => "");
  check("carryCount=2のBlockはパネルに「↻2」バッジが出る", (badgeText || "").includes("2"), badgeText);
  await page.click('[data-action="carry-over"][data-id="cb-b"]');
  await page.waitForTimeout(300);
  const s3 = await stateNow();
  const newB = (s3.blocks || []).find((b) => b.date === TODAY && b.title === "テストB(2回繰越済み)");
  const srcB = (s3.blocks || []).find((b) => b.id === "cb-b");
  check("3回目も通常どおりcarryCountが3になる", !!newB && newB.carryCount === 3, JSON.stringify(newB));
  check("元BlockにmigratedToが付く", !!srcB && srcB.migratedTo === newB.id);

  // ============================================================
  // (b) 朝プラン確定(confirmScheduleDraft)経路でも carryCount が増える
  // ============================================================
  async function runMorningPlan() {
    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="ai-morning-plan"]');
    await page.waitForTimeout(600);
  }
  console.log("[4] 朝プラン確定経路: carryCountが0→1になる");
  await seed({
    blocks: [planBlock({ id: "mp-a", date: YEST, title: "朝プラン繰越A", startMin: 14 * 60, endMin: 14 * 60 + 30, carryCount: 0 })]
  });
  await runMorningPlan();
  check("繰越候補が下書きに載る", (await page.locator(".draft-block-title").first().textContent().catch(() => "")).includes("朝プラン繰越A"));
  await page.click('[data-action="draft-confirm"]');
  await page.waitForTimeout(400);
  const s4 = await stateNow();
  const newMpA = (s4.blocks || []).find((b) => b.date === TODAY && b.title === "朝プラン繰越A");
  check("確定でcarryCountが1になる", !!newMpA && newMpA.carryCount === 1, JSON.stringify(newMpA));

  console.log("[5] 朝プラン確定経路: carryCount=2 → 下書きの予告バッジを保ち、直接3回目を確定する");
  await seed({
    blocks: [planBlock({ id: "mp-b", date: YEST, title: "朝プラン繰越B", startMin: 14 * 60, endMin: 14 * 60 + 30, carryCount: 2 })]
  });
  await runMorningPlan();
  const draftBadgeText = await page.locator('.draft-block:has-text("朝プラン繰越B") .migration-badge').textContent().catch(() => "");
  check("下書きに「↻3」の予告バッジが出る", (draftBadgeText || "").includes("3"), draftBadgeText);
  await page.click('[data-action="draft-confirm"]');
  await page.waitForTimeout(400);
  const s5 = await stateNow();
  const newMpB = (s5.blocks || []).find((b) => b.date === TODAY && b.title === "朝プラン繰越B");
  const srcMpB = (s5.blocks || []).find((b) => b.id === "mp-b");
  check("確定処理が完了しcarryCountが3になる", !!newMpB && newMpB.carryCount === 3, JSON.stringify(newMpB));
  check("元BlockにmigratedToが付く", !!srcMpB && srcMpB.migratedTo === newMpB.id);

  // ============================================================
  // (c) 今日の理想ワンライナー: 保存・3日表示・3日目リトライ・日報反映
  // ============================================================
  // v149(UI改善計画Phase4a): 今日の理想(homeIdeal)はホームの2タブ分割で「アファメーション」
  // としてホームタブへ移動した(既定は今日タブ)。reload/seedのたびにタブは既定へ戻るため、
  // ホーム画面を見る箇所ごとに切り替える。
  const gotoHomeTab = async () => { await page.click('[data-action="home-tab"][data-tab="home"]'); await page.waitForTimeout(150); };

  console.log("[11] 今日の理想: 未入力日は入力欄のみ(邪魔しない)");
  await seed({ journalMeta: {}, view: "home" });
  await gotoHomeTab();
  check("入力欄が表示される", await page.locator('[data-ideal-date]').count() === 1);
  check("表示テキスト(.home-ideal-text)は出ない(未入力)", await page.locator(".home-ideal-text").count() === 0);
  const idealInput = page.locator('[data-ideal-date]');
  const fontSize = await idealInput.evaluate((el) => getComputedStyle(el).fontSize);
  check("入力欄は16px以上(iOS自動ズーム対策)", parseFloat(fontSize) >= 16, fontSize);

  console.log("[12] 今日の理想: 入力→保存→1日目表示");
  // v81: 未入力日のカードは既定で閉じた折りたたみ(<details>)になった(UX監査A5)ため、
  // 入力欄はタップで展開してから操作する(保存ロジック自体は無変更)。
  await page.click('details[data-fold-id="home-ideal-empty"] summary');
  await page.waitForTimeout(150);
  await idealInput.fill("家族と穏やかに過ごす");
  await page.waitForTimeout(300);
  let s12 = await stateNow();
  check("journalMeta[today].idealに保存される", s12.journalMeta?.[TODAY]?.ideal === "家族と穏やかに過ごす", JSON.stringify(s12.journalMeta?.[TODAY]));
  await page.reload();
  await page.waitForTimeout(400);
  await gotoHomeTab();
  const idealText1 = await page.locator(".home-ideal-text").textContent().catch(() => "");
  check("1日目はホームに表示される", idealText1 === "家族と穏やかに過ごす", idealText1);
  const eyebrow1 = await page.locator(".home-ideal-eyebrow").textContent().catch(() => "");
  check("1日目のラベルになっている", (eyebrow1 || "").includes("1日目"), eyebrow1);
  check("1日目はリトライ選択肢が出ない", await page.locator('[data-action="ideal-retry"]').count() === 0);

  console.log("[13] 今日の理想: 3日目(2日前に書いた理想が今日も残り、続ける/手放すを問う)");
  await seed({ journalMeta: { [YEST2]: { aiMitCandidates: [], aiImported: false, ideal: "継続的な理想" } }, view: "home" });
  await gotoHomeTab();
  const eyebrow3 = await page.locator(".home-ideal-eyebrow").textContent().catch(() => "");
  check("3日目のラベルになっている", (eyebrow3 || "").includes("3日目"), eyebrow3);
  check("3日目はリトライ選択肢(続ける/手放す)が出る", await page.locator('[data-action="ideal-retry"]').count() === 2);

  console.log("[14] 今日の理想: 3日目「続ける」→ 今日を起点に新しい3日間サイクル");
  await page.click('[data-action="ideal-retry"][data-choice="continue"]');
  await page.waitForTimeout(300);
  const s14 = await stateNow();
  check("今日のjournalMetaに同じ理想がコピーされる", s14.journalMeta?.[TODAY]?.ideal === "継続的な理想", JSON.stringify(s14.journalMeta?.[TODAY]));
  await page.reload();
  await page.waitForTimeout(400);
  await gotoHomeTab();
  const eyebrow14 = await page.locator(".home-ideal-eyebrow").textContent().catch(() => "");
  check("続けた直後は1日目に戻る", (eyebrow14 || "").includes("1日目"), eyebrow14);

  console.log("[15] 今日の理想: 3日目「手放す」→ 表示窓が閉じ、入力欄に戻る");
  await seed({ journalMeta: { [YEST2]: { aiMitCandidates: [], aiImported: false, ideal: "手放す理想" } }, view: "home" });
  await gotoHomeTab();
  await page.click('[data-action="ideal-retry"][data-choice="release"]');
  await page.waitForTimeout(300);
  const s15 = await stateNow();
  check("元の理想(2日前)が空になる", s15.journalMeta?.[YEST2]?.ideal === "", JSON.stringify(s15.journalMeta?.[YEST2]));
  await page.reload();
  await page.waitForTimeout(400);
  await gotoHomeTab();
  check("表示は消え、入力欄に戻る", await page.locator(".home-ideal-text").count() === 0 && await page.locator('[data-ideal-date]').count() === 1);

  console.log("[16] 今日の理想: 日報生成(generateReport)への反映");
  await seed({ journalMeta: { [TODAY]: { aiMitCandidates: [], aiImported: false, ideal: "日報反映テストの理想" } }, view: "journal" });
  await page.click('[data-action="generate-report"]');
  await page.waitForTimeout(400);
  const reportText = await page.evaluate(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).reports[TODAY] || "", { KEY, TODAY });
  check("日報に今日の理想が出力される", reportText.includes("日報反映テストの理想"), reportText.slice(0, 300));
  check("翌日以降も見える旨(3日リトライ)が明日への接続に記載される", reportText.includes("明日・明後日もホームに小さく残ります"), reportText);
  check("達成/未達の自己申告文言は含まない", !reportText.includes("達成できましたか"));

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
