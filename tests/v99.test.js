// v443 A-9: request toggle absent; stored flags remain independent of completion.
const { chromium, launchOptions, defaultContextOptions, fixedClock, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

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
  const ctx = await browser.newContext({ ...defaultContextOptions(), serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  // 案件行の検証を火曜に固定する。既定の自己締切(2日前)は前週日曜となり、
  // 「今週」パネルにも同じTaskが載る水曜以降と違って、各トグルが1個になる。
  // fixtureと両画面の時計を共通の日時から作り、実行日・ホストの地域に依存させない。
  const fixedNow = "2026-09-08T10:00:00+09:00";
  const now0 = new Date(fixedClock(fixedNow)());
  const TODAY = fixedNow.slice(0, 10);
  function task(id, title, extra = {}) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: TODAY,
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
      doneCriteria: "", firstStep: "", progressNum: 0, progressDen: 10, criteriaRequest: false, ...extra
    };
  }
  const testProject = () => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });

  async function seed({ tasks = [], projects = [], view = "wbs" } = {}) {
    await page.evaluate(({ KEY, tasks, projects, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = tasks; s.projects = projects; s.blocks = []; s.selectedDate = TODAY; s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, tasks, projects, TODAY, view });
    await page.reload();
    // 固定したfixtureでは各Taskが案件行にだけ現れるまで待つ。「今週」にも載る場合の
    // 2個表示は過渡状態ではなく仕様なので、待機延長では解消しない。
    // normalizeStateが補完する「その他」Taskを除き、seedしたIDごとに検証する。
    if (view === "wbs" && tasks.length) {
      await page.locator(`[data-action="wbs-select-project"][data-id="${tasks[0].projectId}"]`).click();
      await page.waitForFunction(
        (ids) => ids.every((id) =>
          document.querySelectorAll(`[data-work-key="task:${id}"]`).length === 1),
        tasks.map((t) => t.id)
      );
    } else {
      await page.waitForTimeout(400);
    }
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }
  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // (b) normalizeState 後方互換: 旧Task(criteriaRequestフィールド無し)→falseが補完される
    console.log("[1] normalizeState 後方互換: 旧TaskにcriteriaRequest:falseが補完される");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [{
        id: "legacy-task", projectId: "legacy-proj", parentTaskId: "", title: "旧データTask", category: "",
        status: "todo", dueDate: "", description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false  // criteriaRequestフィールドなし(旧データを模擬)
      }];
      s.projects = [{
        id: "legacy-proj", kind: "normal", title: "旧データProject", category: "", status: "active",
        description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false
      }];
      s.blocks = []; s.selectedDate = TODAY; s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click('[data-action="nav"][data-view="today"]');  // v230: home撤去後の現行viewで正規化値を永続化
    await page.waitForTimeout(200);
    const normalized = await stateNow();
    const legacyTask = (normalized.tasks || []).find((t) => t.id === "legacy-task");
    check("旧TaskにcriteriaRequest:falseが補完される", legacyTask?.criteriaRequest === false, JSON.stringify(legacyTask));

    // A-9: AI request and inline progress controls belong to bundle B.
    for (const criteriaRequest of [false, true]) {
      await seed({tasks:[task('task-A','Request state',{criteriaRequest,progressNum:3,status:'doing'})],projects:[testProject()]});
      const row = page.locator('[data-work-key="task:task-A"]');
      check('AI request control absent for saved value '+criteriaRequest,await row.locator('[data-action="toggle-criteria-request"]').count()===0);
      check('Inline progress editor absent',await row.locator('[data-wbs-progress]').count()===0);
      let saved=(await stateNow()).tasks.find(t=>t.id==='task-A');
      check('Displaying row preserves request, progress and status',saved.criteriaRequest===criteriaRequest&&saved.progressNum===3&&saved.status==='doing');
      await row.locator('[data-action="toggle-task"]').click();
      await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).tasks.find(t=>t.id==='task-A').status==='completed',KEY);
      saved=(await stateNow()).tasks.find(t=>t.id==='task-A');
      check('Completion remains independent of AI request flag',saved.status==='completed'&&saved.progressNum===saved.progressDen&&saved.criteriaRequest===criteriaRequest);
      await page.reload();
      check('Reload retains saved AI request flag', (await stateNow()).tasks.find(t=>t.id==='task-A').criteriaRequest===criteriaRequest);
    }

    // (e) 390px幅で横スクロールが発生しない
    console.log("[5] 390px幅のWBSタブでトグルON状態でも横スクロールが発生しない");
    const ctxMobile = await browser.newContext({ ...defaultContextOptions(), serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pageMobile = await ctxMobile.newPage();
    pageMobile.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(mobile):", e.message); });
    await blockGithubApiByDefault(pageMobile);
    await pageMobile.clock.setFixedTime(now0);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await pageMobile.waitForTimeout(500);
    await passGithubGate(pageMobile);
    await pageMobile.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [{
        id: "task-M", projectId: "test-proj", parentTaskId: "", title: "モバイル幅確認Task(長めのタイトルで折返し確認)", category: "",
        status: "todo", dueDate: TODAY, description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
        progressNum: 0, progressDen: 10, criteriaRequest: true
      }];
      s.projects = [{
        id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
        description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false, collapsed: false
      }];
      s.blocks = []; s.selectedDate = TODAY; s.currentView = "wbs";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await pageMobile.reload();
    await pageMobile.locator('[data-action="wbs-select-project"][data-id="test-proj"]').click();
    await pageMobile.waitForTimeout(500);
    check('Mobile row has no AI toggle even with stored request ON',
      await pageMobile.locator('[data-work-key="task:task-M"]').count()===1 && await pageMobile.locator('[data-work-key="task:task-M"] [data-action="toggle-criteria-request"]').count()===0);
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
