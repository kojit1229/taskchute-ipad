// v150 検証: UI改善計画Phase4b(残る構造課題、K指定2026-07-27)。CHANGES_v150.md参照。
// 2系統レビュー対応(初回実装後)の検証も本ファイルに追加している(A8〜A11、C1〜C4刷新、D3)。
//
// (A) 完了作法の統一(R3): ホーム今日タブのドット(タスクシュート/ながれ)・タスクシュートの✓・
//     タイムラインの○のいずれも、直接クリックでモーダルを介さず即完了する(実績開始/終了時刻を
//     未設定なら現在時刻ベースで自動記録、充放電はprefillEnergyで自動補完)。完了直後のトーストに
//     「実績を編集」ボタンが出て、既存の実績登録モーダル(complete-block-with-actual)を開ける。
//     完了解除(トグルOFF)は従来どおりプレーンなトースト(実績編集ボタンは出ない)。
//     ポモドーロ完了経路(completePomodoro)は対象外(現行維持)——既存tests/v87.test.jsの
//     全件成功で非破壊を別途確認済み(本ファイルでは再検証しない)。
//   レビュー対応追加分:
//     A8: 実績開始時刻はplannedStartAt優先(0分実績にならない)+開始>終了になる場合は
//         終了−予定所要ぶんに丸め込まれる(項目2)。
//     A9: 手入力済みの充放電はprefillEnergyで上書きされない(項目3)。
//     A10: 完了解除(同セッション)で自動記録した実績時刻・充放電が元へ復元される(項目4)。
//     A11: トースト消滅後、透明な当たり判定(pointer-events)が残留しない(項目1、elementFromPoint)。
// (B) タイポ・余白トークン(S4): :root に --text-xs/sm/md/lg と --space-1〜5 が定義され、
//     ホーム/今日タブ・ジャーナルCSSの一部(段階移行の第1弾)がそれを参照している。
// (C) 回復候補ドラフトの再構築(S7): PWA破棄相当(reload=モジュール再読込で_scheduleDraftは
//     リセットされるが、localStorage上のbatteryRecoveryDraftDatesは残る)からの起動時に、
//     新規stateフィールド無しで候補を再構築する。既に実Blockとして確定済みの候補は
//     再提案しない(未確定のものだけを対象にする)。
//   レビュー対応(項目5、Codex指摘): マーカーを{date, titles}へ拡張し、旧形式(文字列)は
//     normalizeStateで{date, titles:[]}へ後方互換マイグレーション(titles不明の日は再構築
//     スキップ)。再構築は記録済みタイトルのうち未解決のものだけを復元し、記録に無い次点候補
//     (computeChargeTopTitlesを素で再実行した場合の3番手)を繰り上げ提案しない(C1〜C4)。
// (D) タイムライン短時間Blockの重なり解消(R9): 実績モード・1xズームで連続する15分Block
//     (min-height 38pxで物理的に重なっていた)が、既存の横レーン分割(段差配置)により
//     重ならなくなる。離れた時刻のBlockは従来どおりレーン分割されない(regression)。
//   レビュー対応(項目6、監督者裁定): 分割対象は実所要20分未満のBlockに限定する。
//     連続する30分Block同士は全幅のまま(D3)——20分以上の数px食い込みはv149以前からの
//     既存挙動として許容する。
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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(18, 0, 0, 0);  // 過去日側の候補には影響しない時刻(v145と同じ思想)
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  const hhmm = (min) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;
  const addDaysISO = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d + n);
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  };
  // "YYYY-MM-DDTHH:mm"から0時起点の分を取り出す(app.jsのminutesOfと同じ考え方、文字列パースのみ)。
  const minutesOfDateTime = (dateTime) => {
    const m = /T(\d{1,2}):(\d{2})/.exec(dateTime || "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  };

  function planBlock({ id, date = TODAY, title, startMin, minutes = 30, taskId = "", category = "",
    completed = false, actualStartAt = "", actualEndAt = "", charge = 0, discharge = 0 } = {}) {
    return {
      id, taskId, date, title, category,
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(startMin + minutes)}`,
      actualStartAt, actualEndAt,
      completed, charge, discharge, comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "", estimateMin: null,
      leverageType: "", createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
    };
  }
  const testProject = () => ({
    id: "v150-proj", kind: "normal", title: "v150テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });
  const testTask = (id, title) => ({
    id, projectId: "v150-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
    description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  });

  async function seed({ blocks = [], tasks = [], projects = [], view = "home", settings = {}, batteryRecoveryDraftDates } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY, view, settings, batteryRecoveryDraftDates }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.sleep = s.sleep || { logs: {} };
      s.sleep.logs = {};
      s.condition = s.condition || { logs: {} };
      s.condition.logs = {};
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.selectedDate = TODAY;
      s.currentView = view;
      s.timelineMode = "planned";
      Object.assign(s.settings, settings);
      if (batteryRecoveryDraftDates !== undefined) s.batteryRecoveryDraftDates = batteryRecoveryDraftDates;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view, settings, batteryRecoveryDraftDates });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (A) 完了作法の統一(R3)
    // ============================================================
    console.log("[A1] ホーム今日タブ: タスクシュートのドット(home-dot)を直接クリックすると即完了する(モーダルを介さない)");
    await seed({
      view: "home",
      tasks: [testTask("task-A", "A用タスク")],
      projects: [testProject()],
      blocks: [
        planBlock({ id: "block-hd", title: "即完了確認A", startMin: 9 * 60, minutes: 30, taskId: "task-A" }),
        planBlock({ id: "block-flow", title: "即完了確認B(ながれ)", startMin: 11 * 60, minutes: 15 })
      ]
    });
    // block-hdはtaskId付きなので「今日のタスクシュート」(.home-tc)と「今日のながれ」(.home-flow)
    // の両方に出る(homeFlowはtaskIdの有無を問わずルーティン以外の全Blockを表示するため)。
    // ここでは「タスクシュートのドット」に絞ってクリックする。
    // v150レビュー対応(項目2)確認用: normalizeStateは16文字("YYYY-MM-DDTHH:mm")の日時文字列に
    // ":00"を補って19文字へ揃えるため、クリック前の(正規化後の)plannedStartAtを控えておき、
    // これと比較する(自前でhhmm()から組み立てた無補正の文字列とは一致しないため)。
    const plannedStartAtNormalized = (await stateNow()).blocks.find((x) => x.id === "block-hd").plannedStartAt;
    await page.locator('.home-tc .home-dot[data-action="toggle-block"][data-id="block-hd"]').click();
    await page.waitForTimeout(200);
    check("モーダルは開かない(即完了)", await page.locator(".modal-card").count() === 0);
    let st = await stateNow();
    let b = st.blocks.find((x) => x.id === "block-hd");
    check("即完了でcompletedになる", b.completed === true);
    check("実績開始時刻が自動記録される", !!b.actualStartAt, b.actualStartAt);
    check("実績終了時刻が自動記録される", !!b.actualEndAt, b.actualEndAt);
    // v150レビュー対応(項目2、両レビュー一致): actualStartAt=actualEndAt(0分実績)にならない
    // ことを確認する。plannedStartAt(09:00)が現在時刻(18:00固定)より過去なので、
    // 実績開始時刻はplannedStartAtを優先して使うはず(単純な「現在時刻」ではない)。
    check("実績開始時刻はplannedStartAt(過去)を優先する(現在時刻に丸められない)",
      b.actualStartAt === plannedStartAtNormalized, `actualStartAt=${b.actualStartAt} planned=${plannedStartAtNormalized}`);
    check("実績開始時刻と終了時刻が異なる(0分実績にならない)", b.actualStartAt !== b.actualEndAt, JSON.stringify({ s: b.actualStartAt, e: b.actualEndAt }));
    check("完了直後のトーストに「実績を編集」ボタンが出る",
      await page.locator('.toast-action[data-action="complete-block-with-actual"][data-id="block-hd"]').count() === 1);
    check(".toastにhas-actionクラスが付く", await page.locator("#toast.has-action").count() === 1);

    console.log("[A2] ホーム今日タブ: ながれのチェック(home-dot)も同様に即完了する");
    await page.locator('.home-flow .home-dot[data-action="toggle-block"][data-id="block-flow"]').click();
    await page.waitForTimeout(200);
    st = await stateNow();
    b = st.blocks.find((x) => x.id === "block-flow");
    check("ながれのチェックも即完了する", b.completed === true);
    check("実績時刻が自動記録される(ながれ)", !!b.actualStartAt && !!b.actualEndAt);

    console.log("[A3] タスクシュート画面: ✓(checkbox-button)も同様に即完了する");
    await seed({
      view: "tasks",
      tasks: [testTask("task-B", "B用タスク")],
      projects: [testProject()],
      blocks: [planBlock({ id: "block-tc", title: "即完了確認C", startMin: 9 * 60, minutes: 30, taskId: "task-B" })]
    });
    await page.locator('.checkbox-button[data-action="toggle-block"][data-id="block-tc"]').click();
    await page.waitForTimeout(200);
    st = await stateNow();
    b = st.blocks.find((x) => x.id === "block-tc");
    check("タスクシュートの✓も即完了する", b.completed === true);
    check("モーダルは開かない(タスクシュート✓)", await page.locator(".modal-card").count() === 0);
    check("完了直後のトーストに「実績を編集」ボタンが出る(タスクシュート)",
