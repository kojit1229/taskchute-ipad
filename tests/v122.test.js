// v122 検証(v126で反転): v122は「今週選定したWish(state.weeklyWishes)」を朝の一括プランニング
// 候補へ特別ルートで合流させる仕組みだったが、v126でK指示によりこの週次選定ベースの特別
// スケジュールルートは撤去し、期日駆動のWBSフロー(v126.test.js参照)へ作り直した。
// 本ファイルは撤去そのものを検証する内容へ更新した(CHANGES_v126.md参照。仕様変更に伴う
// 正当なテスト更新であり、弱体化ではない)。
//
// (a) 今週選定しただけ(期日なし)のWishは、朝の一括プランニング候補に自動では合流しない
//     (v122当時はweeklyWishes選定だけで期日の有無に関わらず候補に入っていたが、その特別ルートを
//      撤去したことを、期日なしWishが依然として除外されることで確認する)
// (b) AIプラン採用ブランチでも同様に、週次選定Wishは自動では合流しない
//     (v122追補で足していたaiPlan採用時の残り空き時間への追記合流ブロックを撤去したことの確認)
// (c) ホームカード「今日へ」で今日のBlockが作られ、二重登録は弾かれる(v121/v122のUIは無変更で存続)
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, dispatchRegisteredAction } = require("./helpers");

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
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);  // v59/v121と同じく実行時刻依存のフレークを避けるため日中に固定
  function isoOffset(n) {
    const d = new Date(now0);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const TODAY = isoOffset(0);

  // app.js の weekRange() (土曜起点)をテスト側でも再現する(v121テストと同じ)
  function weekStartOf(dateISO) {
    const [y, m, d] = dateISO.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const dow = (dt.getDay() + 1) % 7; // Sat=0
    dt.setDate(dt.getDate() - dow);
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  }
  const WEEK_KEY = weekStartOf(TODAY);

  // AIプラン_<TODAY>.json のfetchをモックする変数(v62系のpage.routeパターン)。
  // nullなら404、文字列ならその内容で200を返す。
  let aiPlanFixture = null;

  const wishProject = () => ({
    id: "wish-1", kind: "wish", title: "Wish", category: "回復", status: "active",
    twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  });
  function makeWish({ id, title, dueDate = "", realized = false, deleted = false }) {
    return {
      id, projectId: "wish-1", parentTaskId: "", title, category: "", status: "todo", dueDate,
      description: "", selfDueOff: false, targetYear: null, targetMonth: null, lifeArea: "", motivation: "",
      realized, realizedDate: "", nextRoutineId: "", leverageType: "", leverageNote: "",
      aiWork: false, aiWorkBrief: "", progressNum: 0, progressDen: 10, doneCriteria: "", firstStep: "",
      criteriaRequest: false, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted
    };
  }
  const testProject = () => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });
  function wbsTask(id, title, dueDate = "") {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate,
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }

  async function seed({ tasks = [], projects = [], blocks = [], weeklyWishes = {}, journalMeta = {}, view = "tasks" } = {}) {
    await page.evaluate(({ KEY, tasks, projects, blocks, weeklyWishes, journalMeta, view, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = tasks;
      s.projects = projects;
      s.blocks = blocks;
      s.weeklyWishes = weeklyWishes;
      s.journalMeta = journalMeta;
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, tasks, projects, blocks, weeklyWishes, journalMeta, view, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
  }
  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }
  async function draftTitles() {
    return page.locator(".draft-block-title").allTextContents();
  }

  try {
    // AIプラン_<TODAY>.jsonのfetchをモックする(v62.test.jsと同じパターン)。
    // goto前、blockGithubApiByDefaultより後に登録する(Playwrightは後発ハンドラを優先)。
    await page.route((url) =>
      url.hostname === "api.github.com" && decodeURIComponent(url.pathname).endsWith(`/taskchute/AIプラン_${TODAY}.json`),
    (route) => {
      if (aiPlanFixture === null) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      route.fulfill({ status: 200, contentType: "application/json", body: aiPlanFixture });
    });

    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) 週次選定しただけ(期日なし)のWishは、決定論配置の朝プラン候補に自動では合流しない
    // ============================================================
    console.log("[1] 決定論配置: 週次選定Wish(期日なし)は候補に自動合流しない");
    const WISH_TITLE = "京都へ旅行する";
    const WBS_TITLE = "議事録作成";
    await seed({
      tasks: [
        makeWish({ id: "w-1", title: WISH_TITLE }),  // 期日なし。v122当時はこれでも合流していた
        wbsTask("wbs-1", WBS_TITLE, TODAY)
      ],
      projects: [wishProject(), testProject()],
      weeklyWishes: { [WEEK_KEY]: { taskIds: ["w-1"], updatedAt: `${TODAY}T09:00` } },  // 今週選定済み
      view: "tasks"
    });

    await page.click('[data-action="nav"][data-view="today"]');
    await page.waitForTimeout(150);
    await dispatchRegisteredAction(page, "ai-morning-plan");
    await page.waitForTimeout(600);

    const titles1 = await draftTitles();
    const titles1Joined = titles1.join(" / ");
    check("通常のWBS候補は下書きに配置される", titles1Joined.includes(WBS_TITLE), titles1Joined);
    check("週次選定しただけ(期日なし)のWishは下書きに合流しない", !titles1Joined.includes(WISH_TITLE), titles1Joined);

    await page.click('[data-action="draft-discard"]');
    await page.waitForTimeout(200);

    // ============================================================
    // (b) AIプラン採用ブランチでも、週次選定Wishは残り空き時間へ自動合流しない
    //     (v122追補で足していたsubtractBusyFromGaps経由の合流ブロックはv126で撤去した)
    // ============================================================
    console.log("[2] AIプラン採用時も、週次選定Wishは残り空き時間へ自動合流しない");
    const AI_PLAN_TITLE = "AIプラン本体タスク";
    const WISH2_TITLE = "料理教室に通う";
    aiPlanFixture = JSON.stringify({
      date: TODAY,
      generatedAt: `${TODAY}T05:00`,
      plan: [{ title: AI_PLAN_TITLE, taskId: null, blockId: null, start: "10:00", minutes: 30, category: "", reason: "", carryFromId: null }],
      skipped: []
    });
    await seed({
      tasks: [makeWish({ id: "w-6", title: WISH2_TITLE })],  // 期日なし・今週選定済み
      projects: [wishProject()],
      weeklyWishes: { [WEEK_KEY]: { taskIds: ["w-6"], updatedAt: `${TODAY}T09:00` } },
      view: "tasks"
    });
    await page.click('[data-action="nav"][data-view="today"]');
    await page.waitForTimeout(150);
    await dispatchRegisteredAction(page, "ai-morning-plan");
    await page.waitForTimeout(700);
    const titles2 = await draftTitles();
    const titles2Joined = titles2.join(" / ");
    check("AIプラン本体の項目は採用される", titles2Joined.includes(AI_PLAN_TITLE), titles2Joined);
    check("週次選定Wishは残り空き時間へ追記されない(自動合流ブロックは撤去済み)",
      !titles2Joined.includes(WISH2_TITLE), titles2Joined);
    check("下書き件数はAIプラン本体の1件のみ", titles2.length === 1, titles2Joined);
    const bar2 = await page.locator(".draft-bar").first().textContent().catch(() => "");
    check("sourceはai-planのまま(全体フォールバックしない)", (bar2 || "").includes("🤖 AIプラン由来"), bar2);
    aiPlanFixture = null;

    // ============================================================
    // ============================================================
    // (c) v230: home週間Wishカード撤去
    // ============================================================
    console.log("[3] v230: 旧週間Wishカードは描画せず、既存選択は保持する");
    const HOME_WISH_TITLE = "フルマラソン完走";
    await seed({
      tasks: [makeWish({ id: "w-5", title: HOME_WISH_TITLE })],
      projects: [wishProject()],
      weeklyWishes: { [WEEK_KEY]: { taskIds: ["w-5"], updatedAt: `${TODAY}T09:00` } },
      view: "home"
    });
    check("旧home週間Wishカードと「今日へ」導線は描画されない",
      await page.locator('.home-weekly-wish-card, [data-action="wish-subtask-to-tasks"]').count() === 0);
    check("旧home viewはtodayへフォールバックする", await page.locator('#app[data-view="today"]').count() === 1);
    const sHome = await stateNow();
    check("既存weeklyWishes選択は保持され、意図しないBlockを作らない",
      sHome.weeklyWishes?.[WEEK_KEY]?.taskIds?.[0] === "w-5"
      && !(sHome.blocks || []).some((b) => !b.deleted && b.taskId === "w-5" && b.date === TODAY),
      JSON.stringify({ weeklyWishes: sHome.weeklyWishes, blocks: sHome.blocks }));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
