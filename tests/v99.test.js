// v99 検証: WBSタブのタスク行に「翌朝のAI処理を依頼する」チェックUI(criteriaRequest)を追加。
// (a) トグルON→保存→再描画で保持 (b) 既定false・normalizeState後方互換
// (c) ON状態が視覚的にわかる(.on付与+バッジ) (d) 完了チェック/進捗入力と独立に動作(双方向)
// (e) 390px幅で横スクロールが発生しない
// 方針: v96/v95と同じく、app.js は type="module" のため内部関数はwindowに露出しない。
// ブラウザ操作 + localStorage 状態の直接注入で観測する。
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
    await page.waitForTimeout(400);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }
  async function openTaskMenu(id) {
    await page.locator(`[data-wbs-row-id="${id}"] > .wbs-task-row > .wbs-row-menu-toggle`).click();
  }
  async function enableEditMode() {
    await page.locator(".wbs-view-menu > summary").click();
    await page.locator('[data-action="toggle-wbs-edit"].wbs-menu-edit-toggle').click();
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

    // (c) WBS行にトグルボタン + 既定OFF表示
    console.log("[2] WBS行にトグルボタンがあり、既定はOFF(.on無し・バッジ無し)");
    await seed({ tasks: [task("task-A", "テストTask")], projects: [testProject()] });
    const btnA = page.locator('[data-action="toggle-criteria-request"][data-id="task-A"]');
    check("トグルボタンが1個ある", await btnA.count() === 1);
    check("既定はOFF(onクラス無し)", !(await btnA.evaluate((el) => el.classList.contains("on"))));
    check("既定はaria-pressed=false", await btnA.getAttribute("aria-pressed") === "false");
    check("既定ではバッジ非表示", await page.locator(".wbs-criteria-badge").count() === 0);

    // (a)(c) トグルON→保存→再描画で保持 + 視覚表示
    console.log("[3] トグルをタップ→ONになり保存される→再読込後も保持・視覚表示される");
    await openTaskMenu("task-A");
    await btnA.click();
    await page.waitForTimeout(250);
    const taskOn = (await stateNow()).tasks.find((t) => t.id === "task-A");
    check("state.criteriaRequestがtrueになる", taskOn?.criteriaRequest === true, JSON.stringify(taskOn));
    check("トグルボタンに.onが付く", await btnA.evaluate((el) => el.classList.contains("on")));
    check("aria-pressed=trueになる", await btnA.getAttribute("aria-pressed") === "true");
    await openTaskMenu("task-A");
    check("メニュー内のAI依頼ボタンがON表示になる", await btnA.isVisible()
      && await btnA.evaluate((el) => el.classList.contains("on"))
      && await btnA.getAttribute("aria-pressed") === "true");
    await page.reload();
    await page.waitForTimeout(500);
    const btnAReload = page.locator('[data-action="toggle-criteria-request"][data-id="task-A"]');
    check("再読込後もONが保持される(.on)", await btnAReload.evaluate((el) => el.classList.contains("on")));
    check("再読込後もstate上criteriaRequest=true", (await stateNow()).tasks.find((t) => t.id === "task-A")?.criteriaRequest === true);
    await openTaskMenu("task-A");
    await btnAReload.click();  // バッチの自動解除と同じUIパスで、再タップでOFFに戻せることも確認
    await page.waitForTimeout(250);
    check("再タップでOFFに戻る", (await stateNow()).tasks.find((t) => t.id === "task-A")?.criteriaRequest === false);

    // (d) 完了チェック(toggle-task)・進捗入力(wbs-progress)と双方向に独立して動作する
    console.log("[4] 完了チェック・進捗入力と双方向に独立して動作する(互いの値を書き換えない)");
    await seed({ tasks: [task("task-B", "独立性確認Task", { progressNum: 3, progressDen: 10, status: "doing" })], projects: [testProject()] });
    const btnB = page.locator('[data-action="toggle-criteria-request"][data-id="task-B"]');
    await openTaskMenu("task-B");
    await btnB.click();
    await page.waitForTimeout(200);
    let taskB = (await stateNow()).tasks.find((t) => t.id === "task-B");
    check("criteriaRequestトグルはprogressNum/statusを変えない", taskB?.progressNum === 3 && taskB?.status === "doing", JSON.stringify(taskB));
    await page.click('[data-action="toggle-task"][data-id="task-B"]');
    await page.waitForTimeout(200);
    taskB = (await stateNow()).tasks.find((t) => t.id === "task-B");
    check("完了チェック操作後もcriteriaRequest=trueを維持", taskB?.criteriaRequest === true && taskB?.status === "completed", JSON.stringify(taskB));
    await enableEditMode();
    await page.fill('[data-wbs-progress="den"][data-id="task-B"]', "20");
    await page.locator('[data-wbs-progress="den"][data-id="task-B"]').dispatchEvent("change");
    await page.waitForTimeout(200);
    taskB = (await stateNow()).tasks.find((t) => t.id === "task-B");
    check("進捗編集操作後もcriteriaRequest=trueを維持", taskB?.criteriaRequest === true, JSON.stringify(taskB));

    // (e) 390px幅で横スクロールが発生しない
    console.log("[5] 390px幅のWBSタブでトグルON状態でも横スクロールが発生しない");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
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
    await pageMobile.waitForTimeout(500);
    check("モバイル幅でもトグルON表示(.on)が見える",
      await pageMobile.locator('[data-action="toggle-criteria-request"][data-id="task-M"]').evaluate((el) => el.classList.contains("on")));
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
