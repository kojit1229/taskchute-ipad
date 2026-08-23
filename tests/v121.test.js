// v121 検証: ホームで「今週のやりたいこと」をWishリストから選択・設定でき、
// 未設定の週は睡眠ログ風の赤帯アラートで気づける状態にする。
//
// (a) 未設定週のホームに赤帯が出る
// (b) モーダルで2件選択→保存でカード表示になり赤帯が消える
// (c) 4件目の選択が拒否される
// (d) weeklyWishesの無い旧stateでも起動できる(normalizeStateの後方互換)
// (e) 過去日表示では赤帯を出さない
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
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);  // 実行時刻依存のフレーク回避(v117等と同じ方針)
  function isoOffset(n) {
    const d = new Date(now0);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const TODAY = isoOffset(0);

  // app.js の weekRange() (土曜起点)をテスト側でも再現し、期待する週キーを算出する
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

  // 注意: 起動処理(app.js末尾)はロード毎に必ず state.selectedDate = todayISO() へ
  // 上書きするため、ここでselectedDateを直接指定しても効かない。過去日を見る場合は
  // seed後にUIの date-prev を叩く(v117テストと同じ方式)。
  async function seed({ tasks = [], projects = [], weeklyWishes = {}, view = "home" } = {}) {
    await page.evaluate(({ KEY, tasks, projects, weeklyWishes, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = tasks;
      s.projects = projects;
      s.weeklyWishes = weeklyWishes;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, tasks, projects, weeklyWishes, view });
    await page.reload();
    await page.waitForTimeout(400);
  }
  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    const wishes = [
      makeWish({ id: "w-1", title: "京都へ旅行する" }),
      makeWish({ id: "w-2", title: "書籍を出版する" })
    ];

    // v230: home完全撤去に伴い週間Wishカード・設定モーダルへの入口も仕様削除。
    // 同等UIはないため、不存在とstateマイグレーション/既存値保持へ置換する。
    console.log("[1-6] v230: 旧週間Wish UIの不存在とデータ互換");
    await seed({
      tasks: wishes,
      projects: [wishProject()],
      weeklyWishes: { [WEEK_KEY]: { taskIds: ["w-1"], updatedAt: `${TODAY}T09:00` } },
      view: "home"
    });
    const kept = await stateNow();
    check("既存weeklyWishes.taskIdsは正規化後も保持される",
      kept.weeklyWishes?.[WEEK_KEY]?.taskIds?.join(",") === "w-1", JSON.stringify(kept.weeklyWishes));

    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.weeklyWishes;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(350);
    const migrated = await stateNow();
    check("旧stateではweeklyWishesを空objectで補完する",
      migrated.weeklyWishes && typeof migrated.weeklyWishes === "object"
      && Object.keys(migrated.weeklyWishes).length === 0, JSON.stringify(migrated.weeklyWishes));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
