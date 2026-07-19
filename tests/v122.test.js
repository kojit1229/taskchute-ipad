// v122 検証: v121で選んだ「今週のやりたいこと」を、朝の一括プランニング候補への合流と
// ホームカードからのワンタップ登録で、タスクシュートのスケジュールに実際に載せられるようにする。
//
// (a) 今週選定したWishが朝の一括プランニング候補に「今週のやりたいこと」として含まれる
// (b) 配置順が MIT→繰越→やりたいこと→WBS の優先を守る
// (c) ホームカード「今日へ」で今日のBlockが作られ、二重登録は弾かれる
// (d) 選定していないWishは従来どおり候補に入らない
// (e) 対象日にBlock化済みのWishは候補から除外される
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
  const YEST = isoOffset(-1);

  // app.js の weekRange() (土曜起点)をテスト側でも再現する(v121テストと同じ)
  function weekStartOf(dateISO) {
    const [y, m, d] = dateISO.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const dow = (dt.getDay() + 1) % 7; // Sat=0
    dt.setDate(dt.getDate() - dow);
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  }
  const WEEK_KEY = weekStartOf(TODAY);

  const wishProject = () => ({
    id: "wish-1", kind: "wish", title: "Wish", category: "回復", status: "active",
    twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  });
  function makeWish({ id, title, realized = false, deleted = false }) {
    return {
      id, projectId: "wish-1", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
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
  function wbsTask(id, title) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }
  function planBlock({ id, date, title, startMin, endMin, taskId = "", category = "" }) {
    return {
      id, taskId, date, title, category,
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(endMin)}`,
      actualStartAt: "", actualEndAt: "",
      completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0,
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`,
      deleted: false
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
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a)(b)(d)(e) 朝の一括プランニング候補: MIT→繰越→今週のやりたいこと→WBS の順、
    //              未選定Wishは含まれず、当日Block化済みの選定Wishは除外される
    // ============================================================
    console.log("[1] 朝の一括プランニング候補の合流順・除外条件");
    const MIT_TITLE = "MIT候補: 資料レビュー";
    const CARRY_TITLE = "昨日やり残したレポート作成";
    const WISH_TITLE = "京都へ旅行する";
    const WBS_TITLE = "WBS未完了: 議事録作成";
    const UNSELECTED_WISH_TITLE = "書籍を出版する";       // (d) 選定していない
    const BLOCKED_WISH_TITLE = "実家をリフォーム";        // (e) 選定済みだが当日Block化済み

    await seed({
      tasks: [
        makeWish({ id: "w-1", title: WISH_TITLE }),
        makeWish({ id: "w-3", title: UNSELECTED_WISH_TITLE }),
        makeWish({ id: "w-4", title: BLOCKED_WISH_TITLE }),
        wbsTask("wbs-1", WBS_TITLE)
      ],
      projects: [wishProject(), testProject()],
      blocks: [
        planBlock({ id: "carry-1", date: YEST, title: CARRY_TITLE, startMin: 14 * 60, endMin: 14 * 60 + 30 }),
        planBlock({ id: "blk-w4", date: TODAY, title: BLOCKED_WISH_TITLE, taskId: "w-4", startMin: 6 * 60, endMin: 6 * 60 + 30 })
      ],
      weeklyWishes: { [WEEK_KEY]: { taskIds: ["w-1", "w-4"], updatedAt: `${TODAY}T09:00` } },  // w-3は選定していない
      journalMeta: { [YEST]: { aiMitCandidates: [MIT_TITLE], aiImported: false, ideal: "" } },
      view: "tasks"
    });

    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="ai-morning-plan"]');
    await page.waitForTimeout(600);

    const titles = await draftTitles();
    check("下書きに4件配置される(MIT/繰越/やりたいこと/WBSの4件)", titles.length === 4, JSON.stringify(titles));
    if (titles.length === 4) {
      check("1番目はMIT候補", titles[0].includes(MIT_TITLE), titles[0]);
      check("2番目は繰越", titles[1].includes(CARRY_TITLE), titles[1]);
      check("3番目は今週のやりたいこと(WBSより先)", titles[2].includes(WISH_TITLE), titles[2]);
      check("4番目はWBS", titles[3].includes(WBS_TITLE), titles[3]);
    }
    const titlesJoined = titles.join(" / ");
    check("(d) 選定していないWishは候補に入らない", !titlesJoined.includes(UNSELECTED_WISH_TITLE), titlesJoined);
    check("(e) 当日Block化済みの選定Wishは候補から除外される", !titlesJoined.includes(BLOCKED_WISH_TITLE), titlesJoined);

    await page.click('[data-action="draft-discard"]');
    await page.waitForTimeout(200);

    // ============================================================
    // (c) ホームカード「今日へ」で今日のBlockが作られ、二重登録は弾かれる
    // ============================================================
    console.log("[2] ホームカードの「今日へ」ボタン");
    const HOME_WISH_TITLE = "フルマラソン完走";
    await seed({
      tasks: [makeWish({ id: "w-5", title: HOME_WISH_TITLE })],
      projects: [wishProject()],
      weeklyWishes: { [WEEK_KEY]: { taskIds: ["w-5"], updatedAt: `${TODAY}T09:00` } },
      view: "home"
    });

    const wishRow = page.locator(".home-weekly-wish-card li", { hasText: HOME_WISH_TITLE });
    check("未Block時は「今日へ」ボタンが出る", await wishRow.locator('[data-action="wish-subtask-to-tasks"]').count() === 1);
    check("未Block時は「済」が出ない", !(await wishRow.innerText()).includes("済"));

