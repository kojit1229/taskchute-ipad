// v122/v126回帰 + v299 Test-Reduction:
// 朝プランへのweeklyWishes合流経路は本体ごと削除済みなのでソース不存在を確認する。
// v230で廃止したホーム週間Wishカードと既存state保持の契約は実画面で維持する。
const fs = require("fs");
const path = require("path");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
}

(async () => {
  console.log("[1-2] v299で削除した朝プラン・AIプラン採用経路のソース不存在");
  check("ai-morning-plan actionが存在しない", !appSource.includes('"ai-morning-plan"'));
  check("runAiMorningPlanが存在しない", !appSource.includes("runAiMorningPlan"));
  check("tryFetchAiPlanが存在しない", !appSource.includes("tryFetchAiPlan"));
  check("aiScheduleCandidatesが存在しない", !appSource.includes("aiScheduleCandidates"));
  check("D側ai-schedule actionは維持", appSource.includes('"ai-schedule": () => runAiSchedule()'));

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ✗ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  function weekStartOf(dateISO) {
    const [y, m, d] = dateISO.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const dow = (date.getDay() + 1) % 7;
    date.setDate(date.getDate() - dow);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }
  const WEEK_KEY = weekStartOf(TODAY);

  const wishProject = {
    id: "wish-1", kind: "wish", title: "Wish", category: "回復", status: "active",
    twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  };
  const wishTask = {
    id: "w-5", projectId: "wish-1", parentTaskId: "", title: "フルマラソン完走",
    category: "", status: "todo", dueDate: "", description: "", selfDueOff: false,
    targetYear: null, targetMonth: null, lifeArea: "", motivation: "", realized: false,
    realizedDate: "", nextRoutineId: "", leverageType: "", leverageNote: "", aiWork: false,
    aiWorkBrief: "", progressNum: 0, progressDen: 10, doneCriteria: "", firstStep: "",
    criteriaRequest: false, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  };

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[3] v230: 旧週間Wishカードは描画せず、既存選択を保持");
    await page.evaluate(({ key, today, weekKey, project, task }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.tasks = [task];
      state.projects = [project];
      state.blocks = [];
      state.weeklyWishes = { [weekKey]: { taskIds: [task.id], updatedAt: `${today}T09:00` } };
      state.selectedDate = today;
      state.currentView = "home";
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: KEY, today: TODAY, weekKey: WEEK_KEY, project: wishProject, task: wishTask });
    await page.reload();
    check("旧home週間Wishカードと『今日へ』導線を描画しない",
      await page.locator('.home-weekly-wish-card, [data-action="wish-subtask-to-tasks"]').count() === 0);
    check("旧home viewはtodayへフォールバック", await page.locator('#app[data-view="today"]').count() === 1);
    const state = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    check("weeklyWishes選択を保持し、意図しないBlockを作らない",
      state.weeklyWishes?.[WEEK_KEY]?.taskIds?.[0] === "w-5" &&
      !(state.blocks || []).some((block) => !block.deleted && block.taskId === "w-5" && block.date === TODAY),
      JSON.stringify({ weeklyWishes: state.weeklyWishes, blocks: state.blocks }));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
