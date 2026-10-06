// v443 A-8/A-9: title query, project chips, filtered completion; inline progress deferred.
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
  // v108/v109と同じ流儀: 実時刻依存フレークを避けるためTODAYは実行時の「今日」10:00に固定する
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;

  function makeProject(id, title, category) {
    return {
      id, kind: "normal", title, category, status: "active", priority: "中",
      description: "", dueDate: "", twelveWeekStartDate: "",
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
      collapsed: false, showProgress: false
    };
  }
  function makeTask(id, projectId, title) {
    return {
      id, projectId, parentTaskId: "", title, category: "", status: "todo", dueDate: "",
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
      progressNum: 0, progressDen: 10, doneCriteria: "", firstStep: ""
    };
  }

  const PROJECTS = [
    makeProject("proj-manabi", "学びプロジェクト", "学び"),
    makeProject("proj-work", "仕事プロジェクト", "仕事"),
    makeProject("proj-none", "未分類プロジェクト", "")
  ];
  const TASKS = [
    makeTask("task-manabi", "proj-manabi", "学びタスク1"),
    makeTask("task-work", "proj-work", "仕事タスク1"),
    makeTask("task-none", "proj-none", "未分類タスク1")
  ];

  async function seed({ projects = PROJECTS, tasks = TASKS } = {}) {
    await page.evaluate(({ KEY, projects, tasks, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.projects = projects;
      s.tasks = tasks;
      s.blocks = [];
      s.selectedDate = TODAY;
      s.currentView = "wbs";
      // v302: 本スイートはカテゴリ絞り込みの到達性を固定するため、完了Projectフィルタは明示OFF。
      s.settings.wbsHideDoneProjects = false;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, projects, tasks, TODAY });
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

    await seed();
    await page.click('[data-action="nav"][data-view="wbs"]');
    await page.waitForTimeout(200);
    // A-8: one title query and project chips replace the category list filter.
    const root = page.locator('[data-work-list="wbs"]');
    const query = root.locator('[data-work-filter="query"]');
    const selectProject = async id => {
      const chip = root.locator(`[data-action="wbs-select-project"][data-id="${id}"]`);
      if (await chip.getAttribute('aria-pressed') !== 'true') await chip.click();
    };
    const chips = root.locator('[data-action="wbs-select-project"]');
    const storedProjects = (await stateNow()).projects.filter(p => !p.deleted);
    check("Every live project has one chip", await chips.count() === storedProjects.length + 1);
    for (const project of PROJECTS) {
      const chip = root.locator(`[data-action="wbs-select-project"][data-id="${project.id}"]`);
      check("Project chip retains title: " + project.id, (await chip.textContent()).includes(project.title));
    }
    for (const task of TASKS) {
      await query.fill(task.title);
      await selectProject(task.projectId);
      check("Title query finds task in selected project: " + task.id, await root.locator(`[data-work-key="task:${task.id}"]`).count() === 1);
      check("Project selection remains explicit", await root.locator(`[data-action="wbs-select-project"][data-id="${task.projectId}"]`).getAttribute('aria-pressed') === 'true');
    }
    await query.fill('');
    await selectProject('proj-none');
    const noneTitle = TASKS.find(t => t.id === 'task-none').title;
    await query.fill(noneTitle);
    await root.locator('[data-action="toggle-task"][data-id="task-none"]').click();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).tasks.find(t => t.id === 'task-none').status === 'completed', KEY);
    check("Completion works while filtered", (await stateNow()).tasks.find(t => t.id === 'task-none').status === 'completed');
    check("Completion retains title query and selected project", await query.inputValue() === noneTitle && await root.locator('[data-action="wbs-select-project"][data-id="proj-none"]').getAttribute('aria-pressed') === 'true');
    await query.fill('');
    await selectProject('proj-work');
    const work = root.locator('[data-work-key="task:task-work"]');
    check("Inline progress editor deferred to bundle B", await work.locator('[data-wbs-progress]').count() === 0);
    check("Read-only row preserves progress", (await stateNow()).tasks.find(t => t.id === 'task-work').progressNum === 0);

    // ============================================================
    // (e) 390px幅でプルダウンが表示され、横スクロールが発生しない
    // ============================================================
    console.log("[5] 390px幅でプルダウンが表示され、横スクロールが発生しない");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pageMobile = await ctxMobile.newPage();
    pageMobile.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(mobile):", e.message); });
    await blockGithubApiByDefault(pageMobile);
    await pageMobile.clock.setFixedTime(now0);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await pageMobile.waitForTimeout(500);
    await passGithubGate(pageMobile);
    await pageMobile.evaluate(({ KEY, projects, tasks, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.projects = projects;
      s.tasks = tasks;
      s.blocks = [];
      s.selectedDate = TODAY;
      s.currentView = "wbs";
      s.settings.wbsCategoryFilter = "学び";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, projects: PROJECTS, tasks: TASKS, TODAY });
    await pageMobile.reload();
    await pageMobile.waitForTimeout(500);
    const filterSelectMobile = pageMobile.locator('[data-work-list="wbs"] [data-work-filter="query"]');
    const mobileTask = TASKS.find(t => t.projectId === 'proj-manabi');
    await filterSelectMobile.fill(mobileTask.title);
    check("390px title query is visible", await filterSelectMobile.isVisible());
    check("390px title query finds the matching task", await pageMobile.locator(`[data-work-key="task:${mobileTask.id}"]`).count() === 1);
    const fontSize = await filterSelectMobile.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    check("プルダウンのfont-sizeは16px以上(iOSズーム防止)", fontSize >= 16, `fontSize=${fontSize}`);
    const metricsMobile = await pageMobile.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    check("390px幅で横スクロールが発生しない(scrollWidth <= clientWidth)",
      metricsMobile.scrollWidth <= metricsMobile.clientWidth + 1,
      `scrollWidth=${metricsMobile.scrollWidth} clientWidth=${metricsMobile.clientWidth}`);
    await ctxMobile.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
