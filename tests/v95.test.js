// v443 A-9: progress is read-only; retain normalization, aggregation and completion linkage.
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
  // v108: 実時刻依存フレーク対策 — TODAYをハードコードせず実行時の「今日」10:00に固定する
  //       (v89/v90/v97/v98と同じ流儀)。app.js起動時にstate.selectedDate=todayISO()(実時計)へ
  //       強制されるため、TODAYがハードコード日付のままだと実行日によって選択日とフィクスチャが
  //       ズレる可能性がある(2026-07-16のCI赤=v97/v98で顕在化した既知のクラス)。
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  function wbsTask(id, title, extra = {}) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
      progressNum: 0, progressDen: 10, ...extra
    };
  }
  const testProject = (extra = {}) => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false, showProgress: false, ...extra
  });

  async function seed(page, { tasks = [], projects = [], view = "wbs" } = {}) {
    await page.evaluate(({ KEY, tasks, projects, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = tasks;
      s.projects = projects;
      s.blocks = [];
      s.selectedDate = TODAY;
      s.currentView = view;
      // v302: 本スイートは進捗↔status連動を固定するため、完了Projectフィルタは明示OFF。
      s.settings.wbsHideDoneProjects = false;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, tasks, projects, TODAY, view });
    await page.reload();
    if (view === "wbs" && projects.length) {
      await page.locator(`[data-action="wbs-select-project"][data-id="${projects[0].id}"]`).click();
    }
    await page.waitForTimeout(400);
  }

  async function stateNow(page) {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) normalizeState 後方互換
    // ============================================================
    console.log("[1] normalizeState 後方互換: 旧Task→progressNum:0/progressDen:10、旧Project→showProgress:false");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [{
        id: "legacy-task", projectId: "legacy-proj", parentTaskId: "", title: "旧データTask", category: "",
        status: "todo", dueDate: "", description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false
        // progressNum/progressDen フィールドなし(旧データを模擬)
      }];
      s.projects = [{
        id: "legacy-proj", kind: "normal", title: "旧データProject", category: "", status: "active",
        description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false
        // showProgress フィールドなし
      }];
      s.blocks = [];
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click('[data-action="nav"][data-view="today"]');  // v230: home撤去後の現行view
    await page.waitForTimeout(200);
    const normalized = await stateNow(page);
    const legacyTask = (normalized.tasks || []).find((t) => t.id === "legacy-task");
    const legacyProj = (normalized.projects || []).find((p) => p.id === "legacy-proj");
    check("旧Taskにprogress Num:0が補完される", legacyTask?.progressNum === 0, JSON.stringify(legacyTask));
    check("旧Taskにprogress Den:10が補完される", legacyTask?.progressDen === 10, JSON.stringify(legacyTask));
    check("旧ProjectにshowProgress:falseが補完される", legacyProj?.showProgress === false, JSON.stringify(legacyProj));

    // ============================================================
    // (b)(c) 入力欄常時表示 + 保存 + バー幅
    // ============================================================
    // A-9: inline progress editing belongs to bundle B; values remain visible.
    for (const den of [10, 0]) {
      await seed(page, { tasks: [wbsTask("task-A", "Progress task", { progressNum: 3, progressDen: den })], projects: [testProject()] });
      const row = page.locator('[data-work-key="task:task-A"]');
      check("No inline numerator/denominator editors", await row.locator('[data-wbs-progress]').count() === 0);
      check("Progress information retains numerator and denominator", (await row.locator('.work-list-meta').textContent()).includes(`3/${den}`));
    }
    for (const showProgress of [false, true]) {
      await seed(page, { tasks: [wbsTask("task-B1", "Child 1", { progressNum: 4 }), wbsTask("task-B2", "Child 2", { progressNum: 2 })], projects: [testProject({ showProgress })] });
      const summary = await page.locator('[data-work-group="test-proj"] > summary').textContent();
      check("Project task aggregate is 6/20 (30%)", summary.includes('6/20 (30%)'), summary);
      check("Both task rows have information and no inline editor", await page.locator('[data-work-group="test-proj"] .work-list-meta').count() === 2 && await page.locator('[data-work-group="test-proj"] [data-wbs-progress]').count() === 0);
    }

    // ============================================================
    // (f) 390px幅で横スクロールが発生しない
    // ============================================================
    console.log("[5] 390px幅のWBSタブで横スクロールが発生しない");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pageMobile = await ctxMobile.newPage();
    pageMobile.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(mobile):", e.message); });
    await blockGithubApiByDefault(pageMobile);
    await pageMobile.clock.setFixedTime(now0);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await pageMobile.waitForTimeout(500);
    await passGithubGate(pageMobile);
    await seed(pageMobile, {
      tasks: [wbsTask("task-M", "モバイル幅確認Task", { progressNum: 5, progressDen: 10 })],
      projects: [testProject({ showProgress: true })]
    });
    const metricsMobile = await pageMobile.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    check("390px幅で横スクロールが発生しない(scrollWidth <= clientWidth)",
      metricsMobile.scrollWidth <= metricsMobile.clientWidth + 1,
      `scrollWidth=${metricsMobile.scrollWidth} clientWidth=${metricsMobile.clientWidth}`);
    await ctxMobile.close();

    // ============================================================
    // (g)〜(j) 進捗↔ステータスの双方向連動(K指示 2026-07-15追加)
    // ============================================================
    console.log("[6] チェックボックス完了 → 分子が分母と同じ値になる");
    await seed(page, { tasks: [wbsTask("task-C", "完了チェックTask", { progressNum: 3, progressDen: 10 })], projects: [testProject()] });
    await page.click('[data-action="toggle-task"][data-id="task-C"]');
    await page.waitForTimeout(200);
    const s6 = await stateNow(page);
    const t6 = s6.tasks.find((t) => t.id === "task-C");
    check("完了チェックで分子が分母(10)と同じになる", t6?.progressNum === 10, JSON.stringify(t6));
    check("ステータスがcompletedになる", t6?.status === "completed", JSON.stringify(t6));

    for (const [id, num, status] of [["task-D", 10, "completed"], ["task-E", 2, "todo"], ["task-F", 3, "todo"]]) {
      await seed(page, { tasks: [wbsTask(id, "Progress editor deferred", { progressNum: num, status })], projects: [testProject()] });
      const row = page.locator(`[data-work-key="task:${id}"]`);
      check("Bundle B editor absent for " + id, await row.locator('[data-wbs-progress]').count() === 0);
      const saved = (await stateNow(page)).tasks.find(t => t.id === id);
      check("Displaying row preserves progress/status for " + id, saved.progressNum === num && saved.status === status);
    }

    console.log("[10] 分子0の未完了Taskは従来どおり未着手(todo)表示のまま");
    await seed(page, { tasks: [wbsTask("task-G", "未着手Task", { progressNum: 0, progressDen: 10 })], projects: [testProject()] });
    check("分子0はtodo(未着手)のまま", (await stateNow(page)).tasks.find((t) => t.id === "task-G")?.status === "todo");
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
