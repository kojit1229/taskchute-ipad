// v195: 実行計画UI(適用、担当/状態、上下移動、途中挿入、AI指示文)とowner→aiWork同期。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");

const PORT = randomPort();
let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  const project = {
    id: "project-v195", kind: "normal", title: "実行計画UI", category: "", status: "active",
    priority: "中", description: "", dueDate: "", twelveWeekStartDate: "",
    createdAt: "2026-08-06T08:00", updatedAt: "2026-08-06T08:00", deleted: false,
    collapsed: false, showProgress: false
  };
  function makeTask(id, title, overrides = {}) {
    return {
      id, projectId: project.id, parentTaskId: "", title, category: "仕事", status: "todo",
      dueDate: "", selfDueOff: true, order: null, description: "", progressNum: 0, progressDen: 10,
      doneCriteria: "", firstStep: "", planTarget: false, owner: "k", aiWork: false,
      aiWorkBrief: "既存ワーカー指示", aiBrief: "", aiStatus: "none", handoffNote: "", aiResultRef: "",
      createdAt: "2026-08-06T09:00", updatedAt: "2026-01-01T00:00", deleted: false, collapsed: false,
      ...overrides
    };
  }
  const parent = makeTask("plan-parent", "計画対象の親");
  const children = [
    makeTask("step-a", "ステップA", { parentTaskId: parent.id, dueDate: "2026-08-10", aiStatus: "queued", owner: "ai", aiWork: true }),
    makeTask("step-b", "ステップB", { parentTaskId: parent.id, dueDate: "2026-08-11" }),
    makeTask("step-c", "ステップC", { parentTaskId: parent.id })
  ];
  const offParent = makeTask("off-parent", "対象外の親");
  const offChild = makeTask("off-child", "対象外の子", { parentTaskId: offParent.id });
  const normalizeAi = makeTask("normalize-ai", "正規化AI", { owner: "ai", aiWork: false });
  const originalUpdatedAt = Object.fromEntries(children.map((t) => [t.id, t.updatedAt]));

  async function storedTask(id) {
    return page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)).tasks.find((t) => t.id === id), { key: STATE_KEY, id });
  }
  async function openTaskEditor(id) {
    await page.locator(`[data-work-key="task:${id}"] [data-action="edit-task"]`).click();
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('[data-action="gate-continue"]');
    await passGithubGate(page);
    await page.evaluate(({ key, project, tasks }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.projects = [project];
      state.tasks = tasks;
      state.blocks = [];
      state.currentView = "wbs";
      state.settings.wbsHideCompleted = false;
      state.settings.wbsCategoryFilter = "";
      state.settings.wbsEditMode = false;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, project, tasks: [parent, ...children, offParent, offChild, normalizeAi] });
    await page.reload();
    await page.waitForSelector('#app[data-view="wbs"]');
    await page.locator(`[data-action="wbs-select-project"][data-id="${project.id}"]`).click();

    console.log("A-8: no owner, move, insert or AI toggle in current rows");
    for (const id of ['step-a', 'off-child', 'normalize-ai']) {
      const row = page.locator(`[data-work-key="task:${id}"]`);
      check("Task row exists: " + id, await row.count() === 1);
      check("Removed inline actions absent: " + id, await row.locator('[data-action="toggle-plan-owner"], [data-action="move-plan-step"], [data-action="add-plan-step-below"], [data-action="toggle-criteria-request"], [data-wbs-edit="status"]').count() === 0);
    }
    await openTaskEditor('plan-parent');
    await page.locator('[data-modal-field="planTarget"]').check();
    await page.locator('[data-action="modal-save"]').click();
    const savedParent = await storedTask('plan-parent');
    check("Plan target is saved with updated timestamp", savedParent.planTarget === true && savedParent.updatedAt !== '2026-01-01T00:00');
    const normalized = await storedTask('normalize-ai');
    check("owner=ai normalizes aiWork without changing timestamp", normalized.aiWork === true && normalized.updatedAt === '2026-01-01T00:00');
    check("Enabling plan target does not restore removed inline actions", await page.locator('[data-work-list="wbs"] [data-action="toggle-plan-owner"], [data-work-list="wbs"] [data-action="move-plan-step"], [data-work-list="wbs"] [data-action="add-plan-step-below"]').count() === 0);
    await openTaskEditor('step-a');
    await page.locator('[data-modal-field="aiBrief"]').fill('Return investigation notes');
    await page.locator('[data-action="modal-save"]').click();
    const stepA = await storedTask('step-a');
    check("Modal still saves aiBrief and preserves worker brief", stepA.aiBrief === 'Return investigation notes' && stepA.aiWorkBrief === children[0].aiWorkBrief);
    const beforeBrief = new Map(await Promise.all(children.map(async child => [child.id, await storedTask(child.id)])));
    await page.locator('[data-work-list="wbs"] [data-work-filter="query"]').fill(children[0].title);
    await page.locator('[data-work-list="wbs"] [data-work-filter="query"]').fill('');
    for (const child of children) {
      const saved = await storedTask(child.id);
      check("Read-only actions retain owner/order: " + child.id, saved.owner === beforeBrief.get(child.id).owner && saved.order === beforeBrief.get(child.id).order);
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((error) => { console.error(error); process.exit(1); });

let v195RegressionScenariosStarted = false;
process.on("beforeExit", async () => {
  if (v195RegressionScenariosStarted) return;
  v195RegressionScenariosStarted = true;

  const regressionPort = randomPort();
  const server = startServer(regressionPort);
  let browser;
  function regressionProject(id, title) {
    return {
      id, kind: "normal", title, category: "", status: "active", priority: "中",
      description: "", dueDate: "", twelveWeekStartDate: "",
      createdAt: "2026-08-06T08:00", updatedAt: "2026-08-06T08:00", deleted: false,
      collapsed: false, showProgress: false
    };
  }
  function regressionTask(id, projectId, title, overrides = {}) {
    return {
      id, projectId, parentTaskId: "", title, category: "仕事", status: "todo",
      dueDate: "", selfDueOff: true, order: null, description: "", progressNum: 0, progressDen: 10,
      doneCriteria: "", firstStep: "", planTarget: false, owner: "k", aiWork: false,
      aiWorkBrief: "", aiBrief: "", aiStatus: "none", handoffNote: "", aiResultRef: "",
      createdAt: "2026-08-06T09:00", updatedAt: "2026-08-06T09:00", deleted: false, collapsed: false,
      ...overrides
    };
  }
  async function loadWbsState(page, project, tasks, settings = {}) {
    await page.evaluate(({ key, project, tasks, settings }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.projects = [project];
      state.tasks = tasks;
      state.blocks = [];
      state.currentView = "wbs";
      state.settings = {
        ...state.settings,
        wbsHideCompleted: false,
        wbsCategoryFilter: "",
        wbsEditMode: false,
        showSuspended: false,
        ...settings
      };
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, project, tasks, settings });
    await page.reload();
    await page.waitForSelector('#app[data-view="wbs"]');
    await page.locator(`[data-action="wbs-select-project"][data-id="${project.id}"]`).click();
  }
  async function storedRegressionTask(page, id) {
    return page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)).tasks.find((t) => t.id === id), { key: STATE_KEY, id });
  }
  async function regressionSiblingOrder(page, ids) {
    return page.locator('[data-work-list="wbs"] .work-list-title[data-id]').evaluateAll((els, wanted) => {
      const set = new Set(wanted);
      return els.map((el) => el.dataset.id).filter((id) => set.has(id));
    }, ids);
  }
  async function waitForRegressionOrder(page, ids, expected) {
    await page.waitForFunction(({ ids, expected }) => {
      const wanted = new Set(ids);
      const actual = Array.from(document.querySelectorAll('[data-work-list="wbs"] .work-list-title[data-id]'))
        .map((el) => el.dataset.id).filter((id) => wanted.has(id));
      return JSON.stringify(actual) === JSON.stringify(expected);
    }, { ids, expected });
  }

  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror(regression):", error.message); });
    await blockGithubApiByDefault(page);
    await page.goto(`http://localhost:${regressionPort}/`);
    await page.waitForSelector('[data-action="gate-continue"]');
    await passGithubGate(page);

    console.log("[A] planTarget=false親への+サブはorder未採番で従来順を維持");
    const projectA = regressionProject("reg-a-project", "通常サブタスク回帰");
    const parentA = regressionTask("reg-a-parent", projectA.id, "通常の親", { planTarget: false });
    await loadWbsState(page, projectA, [parentA]);
    async function addRegressionSubtask(title) {
      await page.locator('[data-action="add-subtask"][data-parent-task="reg-a-parent"]').click();
      await page.waitForSelector('[data-modal-field="title"]');
      await page.locator('[data-modal-field="title"]').fill(title);
      await page.locator('[data-action="modal-save"]').click();
      await page.waitForFunction(({ key, title }) => {
        const state = JSON.parse(localStorage.getItem(key));
        return state.tasks.some((task) => task.title === title && task.parentTaskId === "reg-a-parent");
      }, { key: STATE_KEY, title });
      return page.evaluate(({ key, title }) => JSON.parse(localStorage.getItem(key)).tasks.find((task) => task.title === title), { key: STATE_KEY, title });
    }
    const addedA = await addRegressionSubtask("通常サブA");
    const addedB = await addRegressionSubtask("通常サブB");
    check("planTarget=false親の+サブ2件はorder=null", addedA.order === null && addedB.order === null,
      JSON.stringify({ a: addedA.order, b: addedB.order }));
    await page.locator(`[data-work-list="wbs"] [data-action="toggle-task"][data-id="${addedA.id}"]`).click();
    await page.waitForFunction(({ key, id }) => JSON.parse(localStorage.getItem(key)).tasks.find((task) => task.id === id)?.status === "completed",
      { key: STATE_KEY, id: addedA.id });
    // 現行WBS(裁定A-3): 兄弟は保存順のまま並び、完了しても行は動かない。
    await waitForRegressionOrder(page, [addedA.id, addedB.id], [addedA.id, addedB.id]);
    check("order未採番の兄弟は完了しても保存順のまま", JSON.stringify(await regressionSiblingOrder(page, [addedA.id, addedB.id])) === JSON.stringify([addedA.id, addedB.id]));

    console.log("[B] 旧aiWork=trueをowner=aiへ正規化しupdatedAtを保持");
    const projectB = regressionProject("reg-b-project", "旧AI担当回帰");
    const legacyUpdatedAt = "2026-03-04T05:06";
    const legacyAiTask = regressionTask("reg-b-legacy-ai", projectB.id, "旧AI担当タスク", {
      aiWork: true, updatedAt: legacyUpdatedAt
    });
    delete legacyAiTask.owner;
    await loadWbsState(page, projectB, [legacyAiTask]);
    const legacyLine = page.locator('[data-work-key="task:reg-b-legacy-ai"]');
    check("AI toggle absent for legacy AI task", await legacyLine.locator('[data-action="toggle-criteria-request"]').count() === 0);
    await page.locator('[data-action="nav"][data-view="today"]').first().click();  // v230: home撤去後の現行起点
    await page.waitForSelector('#app[data-view="today"]');
    await page.waitForFunction(({ key, id }) => {
      const task = JSON.parse(localStorage.getItem(key)).tasks.find((item) => item.id === id);
      return task?.owner === "ai" && task.aiWork === true;
    }, { key: STATE_KEY, id: legacyAiTask.id });
    const normalizedLegacyAi = await storedRegressionTask(page, legacyAiTask.id);
    check("owner未設定+aiWork=trueはowner=aiかつaiWork=true", normalizedLegacyAi.owner === "ai" && normalizedLegacyAi.aiWork === true,
      JSON.stringify(normalizedLegacyAi));
    check("正規化してもupdatedAtを変更しない", normalizedLegacyAi.updatedAt === legacyUpdatedAt, normalizedLegacyAi.updatedAt);

    console.log("[C] 完了非表示時の↑↓は可視兄弟だけで入れ替え・活性判定");
    const projectC = regressionProject("reg-c-project", "可視兄弟回帰");
    const parentC = regressionTask("reg-c-parent", projectC.id, "実行計画の親", { planTarget: true });
    const stepVisibleA = regressionTask("reg-c-a", projectC.id, "可視A", { parentTaskId: parentC.id, order: 1000 });
    const stepHiddenB = regressionTask("reg-c-b", projectC.id, "非表示B", { parentTaskId: parentC.id, order: 2000, status: "completed" });
    const stepVisibleC = regressionTask("reg-c-c", projectC.id, "可視C", { parentTaskId: parentC.id, order: 3000 });
    await loadWbsState(page, projectC, [parentC, stepVisibleA, stepHiddenB, stepVisibleC], { wbsHideCompleted: true });
    await page.waitForSelector('[data-work-key="task:reg-c-a"]');
    await page.waitForSelector('[data-work-key="task:reg-c-c"]');
    check("完了Bは非表示でA/Cだけ表示", await page.locator('[data-work-key="task:reg-c-b"]').count() === 0
      && JSON.stringify(await regressionSiblingOrder(page, [stepVisibleA.id, stepHiddenB.id, stepVisibleC.id])) === JSON.stringify([stepVisibleA.id, stepVisibleC.id]));
    // 裁定A-8: 上下移動は束Bの入口。現行の行に入口が無く、可視兄弟の並びも動かない。
    check("現行の行に上下移動の入口が無く、可視A/Cの並びは保存順のまま", await page.locator('[data-action="move-plan-step"]').count() === 0
      && JSON.stringify(await regressionSiblingOrder(page, [stepVisibleA.id, stepVisibleC.id])) === JSON.stringify([stepVisibleA.id, stepVisibleC.id]));
  } catch (error) {
    failures++;
    console.error(error);
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\n${failures} failure(s) including regression scenarios`);
    process.exitCode = 1;
  } else {
    console.log("\nALL PASS (including regression scenarios A-C)");
  }
});
