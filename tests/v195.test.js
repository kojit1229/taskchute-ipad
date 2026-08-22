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
    makeTask("step-a", "ステップA", { parentTaskId: parent.id, dueDate: "2026-08-10", aiStatus: "queued" }),
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
  async function siblingOrder(ids) {
    return page.locator('span[data-action="edit-task"][data-id]').evaluateAll((els, wanted) => {
      const set = new Set(wanted);
      return els.map((el) => el.dataset.id).filter((id) => set.has(id));
    }, ids);
  }
  async function waitForOrder(ids, expected) {
    await page.waitForFunction(({ ids, expected }) => {
      const wanted = new Set(ids);
      const actual = Array.from(document.querySelectorAll('span[data-action="edit-task"][data-id]'))
        .map((el) => el.dataset.id).filter((id) => wanted.has(id));
      return JSON.stringify(actual) === JSON.stringify(expected);
    }, { ids, expected });
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

    console.log("[1] planTarget OFFでは従来表示、owner=aiはaiWorkへ正規化");
    check("対象外の子に担当バッジが出ない", await page.locator('[data-action="toggle-plan-owner"][data-id="step-a"]').count() === 0);
    check("別の対象外親配下にも操作が出ない", await page.locator('[data-action="add-plan-step-below"][data-id="off-child"]').count() === 0);
    const normalizedLine = page.locator('span[data-action="edit-task"][data-id="normalize-ai"]').locator("..");
    check("owner=aiなら既存aiWork表示も有効になる", await normalizedLine.locator(".ai-work-flag").count() === 1);

    console.log("[2] 親モーダルの適用フラグで、直下だけに担当・状態・操作を表示");
    await page.locator('span[data-action="edit-task"][data-id="plan-parent"]').click();
    await page.locator('[data-modal-field="planTarget"]').check();
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForSelector('[data-action="toggle-plan-owner"][data-id="step-a"]');
    const savedParent = await storedTask("plan-parent");
    check("planTargetとupdatedAtが保存される", savedParent.planTarget === true && savedParent.updatedAt !== "2026-01-01T00:00");
    const normalized = await storedTask("normalize-ai");
    check("owner=aiならaiWork=trueに揃えて保存される", normalized.aiWork === true, JSON.stringify(normalized));
    // v195レビュー(必須1)対応: normalizeStateは起動時・同期時に走る。ここでupdatedAtを進めると、
    // 手を触れていないローカルの古い内容がリモートの新しい変更に勝って上書きしてしまう(v135の事故)。
    // 正規化は読み取り時の整形に留め、updatedAtは元の値のまま保持されなければならない。
    check("正規化ではupdatedAtを進めない(同期マージの勝敗を狂わせないため)",
      normalized.updatedAt === "2026-01-01T00:00", normalized.updatedAt);
    check("初期担当Kを表示", await page.locator('[data-action="toggle-plan-owner"][data-id="step-a"]').textContent() === "K");
    const titleLine = page.locator('[data-action="toggle-plan-owner"][data-id="step-a"]').locator("..");
    check("queuedを待機中と表示", (await titleLine.textContent()).includes("待機中"));

    console.log("[3] 担当切替とAI指示文保存");
    await page.locator('[data-action="toggle-plan-owner"][data-id="step-a"]').click();
    await page.waitForFunction(() => document.querySelector('[data-action="toggle-plan-owner"][data-id="step-a"]')?.textContent === "AI");
    let stepA = await storedTask("step-a");
    check("担当AIでowner/aiWork/updatedAtが追随", stepA.owner === "ai" && stepA.aiWork === true && stepA.updatedAt !== originalUpdatedAt[stepA.id]);
    check("aiWorkBriefは変換せず保持", stepA.aiWorkBrief === "既存ワーカー指示");
    await page.locator('[data-action="toggle-plan-owner"][data-id="step-a"]').click();
    await page.waitForFunction(() => document.querySelector('[data-action="toggle-plan-owner"][data-id="step-a"]')?.textContent === "K");
    stepA = await storedTask("step-a");
    check("AI→Kでもowner/aiWorkが追随", stepA.owner === "k" && stepA.aiWork === false);
    await page.locator('[data-action="toggle-plan-owner"][data-id="step-a"]').click();
    await page.waitForFunction(() => document.querySelector('[data-action="toggle-plan-owner"][data-id="step-a"]')?.textContent === "AI");
    await page.locator('span[data-action="edit-task"][data-id="step-a"]').click();
    await page.locator('[data-modal-field="aiBrief"]').fill("調査結果を箇条書きで返す");
    await page.locator('[data-action="modal-save"]').click();
    stepA = await storedTask("step-a");
    check("実行計画用aiBriefを保存", stepA.aiBrief === "調査結果を箇条書きで返す");

    console.log("[4] order未設定を表示順で遅延採番し、上下移動を永続化");
    const lazyUpdatedAt = "2026-02-01T00:00";
    await page.evaluate(({ key, ids, updatedAt }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.tasks = state.tasks.map((t) => ids.includes(t.id) ? { ...t, order: null, updatedAt } : t);
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, ids: children.map((t) => t.id), updatedAt: lazyUpdatedAt });
    await page.reload();
    await page.waitForSelector('#app[data-view="wbs"]');
    await page.locator('[data-action="move-plan-step"][data-id="step-a"][data-direction="1"]').click();
    const childIds = children.map((t) => t.id);
    await waitForOrder(childIds, ["step-b", "step-a", "step-c"]);
    const moved = await page.evaluate(({ key, ids }) => {
      const tasks = JSON.parse(localStorage.getItem(key)).tasks.filter((t) => ids.includes(t.id));
      return Object.fromEntries(tasks.map((t) => [t.id, { order: t.order, updatedAt: t.updatedAt }]));
    }, { key: STATE_KEY, ids: childIds });
    check("全兄弟を1000刻みで採番して入れ替える", moved["step-b"].order === 1000 && moved["step-a"].order === 2000 && moved["step-c"].order === 3000, JSON.stringify(moved));
    check("遅延採番で触れた全兄弟のupdatedAtを更新", childIds.every((id) => moved[id].updatedAt !== lazyUpdatedAt));
    await page.reload();
    await page.waitForSelector('#app[data-view="wbs"]');
    check("リロード後も順序を保持", JSON.stringify(await siblingOrder(childIds)) === JSON.stringify(["step-b", "step-a", "step-c"]));

    console.log("[5] 下に追加は前後orderの中間値で保存");
    await page.locator('[data-action="add-plan-step-below"][data-id="step-a"]').click();
    await page.locator('[data-modal-field="title"]').fill("途中に追加したステップ");
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('span[data-action="edit-task"]')).some((el) => el.textContent === "途中に追加したステップ"));
    const inserted = await page.evaluate(({ key }) => JSON.parse(localStorage.getItem(key)).tasks.find((t) => t.title === "途中に追加したステップ"), { key: STATE_KEY });
    check("同じ親へ2000と3000の中間で追加", inserted.parentTaskId === "plan-parent" && inserted.order === 2500 && Boolean(inserted.updatedAt), JSON.stringify(inserted));
    const finalIds = ["step-b", "step-a", inserted.id, "step-c"];
    check("挿入後の表示順が崩れない", JSON.stringify(await siblingOrder(finalIds)) === JSON.stringify(finalIds));
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
  }
  async function storedRegressionTask(page, id) {
    return page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)).tasks.find((t) => t.id === id), { key: STATE_KEY, id });
  }
  async function regressionSiblingOrder(page, ids) {
    return page.locator('span[data-action="edit-task"][data-id]').evaluateAll((els, wanted) => {
      const set = new Set(wanted);
      return els.map((el) => el.dataset.id).filter((id) => set.has(id));
    }, ids);
  }
  async function waitForRegressionOrder(page, ids, expected) {
    await page.waitForFunction(({ ids, expected }) => {
      const wanted = new Set(ids);
      const actual = Array.from(document.querySelectorAll('span[data-action="edit-task"][data-id]'))
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
    await page.locator(`[data-action="toggle-task"][data-id="${addedA.id}"]`).click();
    await page.waitForFunction(({ key, id }) => JSON.parse(localStorage.getItem(key)).tasks.find((task) => task.id === id)?.status === "completed",
      { key: STATE_KEY, id: addedA.id });
    await waitForRegressionOrder(page, [addedA.id, addedB.id], [addedB.id, addedA.id]);
    check("order未採番の兄弟は未完了が完了より上", JSON.stringify(await regressionSiblingOrder(page, [addedA.id, addedB.id])) === JSON.stringify([addedB.id, addedA.id]));

    console.log("[B] 旧aiWork=trueをowner=aiへ正規化しupdatedAtを保持");
    const projectB = regressionProject("reg-b-project", "旧AI担当回帰");
    const legacyUpdatedAt = "2026-03-04T05:06";
    const legacyAiTask = regressionTask("reg-b-legacy-ai", projectB.id, "旧AI担当タスク", {
      aiWork: true, updatedAt: legacyUpdatedAt
    });
    delete legacyAiTask.owner;
    await loadWbsState(page, projectB, [legacyAiTask]);
    const legacyLine = page.locator('span[data-action="edit-task"][data-id="reg-b-legacy-ai"]').locator("..");
    await legacyLine.locator(".ai-work-flag").waitFor();
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
    await page.waitForSelector('span[data-action="edit-task"][data-id="reg-c-a"]');
    await page.waitForSelector('span[data-action="edit-task"][data-id="reg-c-c"]');
    check("完了Bは非表示でA/Cだけ表示", await page.locator('span[data-action="edit-task"][data-id="reg-c-b"]').count() === 0
      && JSON.stringify(await regressionSiblingOrder(page, [stepVisibleA.id, stepHiddenB.id, stepVisibleC.id])) === JSON.stringify([stepVisibleA.id, stepVisibleC.id]));
    await page.locator('[data-action="move-plan-step"][data-id="reg-c-a"][data-direction="1"]').click();
    await waitForRegressionOrder(page, [stepVisibleA.id, stepVisibleC.id], [stepVisibleC.id, stepVisibleA.id]);
    check("Aの↓1回で可視A/Cが入れ替わる", JSON.stringify(await regressionSiblingOrder(page, [stepVisibleA.id, stepVisibleC.id])) === JSON.stringify([stepVisibleC.id, stepVisibleA.id]));
    check("先頭可視ステップの↑と末尾可視ステップの↓がdisabled",
      await page.locator('[data-action="move-plan-step"][data-id="reg-c-c"][data-direction="-1"]').isDisabled()
      && await page.locator('[data-action="move-plan-step"][data-id="reg-c-a"][data-direction="1"]').isDisabled());
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
