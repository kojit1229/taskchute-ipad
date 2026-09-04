// v302: WBS完了Project非表示・アクティブのみ・通常Taskコンパクト表示。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-08-30";
const OLD_MODIFIED = "2026-08-01T00:00:00";
const FIXED_NOW = new Date(2026, 7, 30, 10, 0, 0);
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function project(id, title, extra = {}) {
  return {
    id, kind: "normal", title, category: "仕事", status: "active", priority: "中",
    description: "", dueDate: "", twelveWeekStartDate: "", showProgress: false,
    collapsed: false, createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`,
    deleted: false, ...extra
  };
}

function task(id, projectId, title, extra = {}) {
  return {
    id, projectId, parentTaskId: "", title, category: "仕事", status: "todo",
    dueDate: "", description: "", progressNum: 3, progressDen: 10, collapsed: false,
    criteriaRequest: false, leverageType: "", aiWork: false, planTarget: false,
    owner: "k", order: null, aiStatus: "none",
    createdAt: `${TODAY}T09:00:00`, updatedAt: `${TODAY}T09:00:00`,
    deleted: false, ...extra
  };
}

function block(id, taskId) {
  return {
    id, taskId, title: "実績", category: "仕事", date: TODAY, completed: true,
    plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
    deleted: false, createdAt: `${TODAY}T09:00:00`, updatedAt: `${TODAY}T09:30:00`
  };
}

async function stateNow(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
}

async function seed(page, values = {}) {
  await page.evaluate(({ key, values, today, modified }) => {
    const state = JSON.parse(localStorage.getItem(key));
    Object.assign(state, {
      projects: values.projects || [], tasks: values.tasks || [], blocks: values.blocks || [],
      recurrences: [], tracks: values.tracks || [], trackMeasurements: [],
      currentView: "wbs", selectedDate: today, dataModifiedAt: modified
    });
    state.settings = {
      ...state.settings,
      showSuspended: false,
      wbsHideCompleted: false,
      wbsHideDoneProjects: false,
      wbsCompactMode: false,
      wbsCategoryFilter: "",
      wbsEditMode: false,
      twelveWeekStartDate: "",
      ...(values.settings || {})
    };
    for (const field of values.deleteSettings || []) delete state.settings[field];
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: STATE_KEY, values, today: TODAY, modified: OLD_MODIFIED });
  await page.reload();
  await page.locator(".wbs-view-menu > summary").click();
  await page.waitForSelector('#app[data-view="wbs"] #wbs-search-input');
}

async function openViewMenu(page) {
  if (!await page.locator(".wbs-view-menu").evaluate((element) => element.open)) {
    await page.locator(".wbs-view-menu > summary").click();
  }
}

async function installWriteSpy(page) {
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    window.__v302StateWrites = 0;
    Storage.prototype.setItem = function patchedSetItem(k, value) {
      if (k === key) window.__v302StateWrites += 1;
      return original.call(this, k, value);
    };
  }, STATE_KEY);
}

async function waitSetting(page, expected) {
  await page.waitForFunction(({ key, expected }) => {
    const settings = JSON.parse(localStorage.getItem(key)).settings;
    return Object.entries(expected).every(([name, value]) => settings[name] === value);
  }, { key: STATE_KEY, expected });
}

async function verifyMigrationAndDoneProjectToggle(page) {
  console.log("[1] D: migration・完了判定の進捗基準統一・表示切替・負例");
  const done = project("p-done", "完了案件");
  const active = project("p-active", "進行案件");
  const empty = project("p-empty", "Taskゼロ案件");
  const effectivelyDone = project("p-effectively-done", "実質完了案件");
  const cancelledOnly = project("p-cancelled-only", "中止Taskのみ案件");
  await seed(page, {
    projects: [done, active, empty, effectivelyDone, cancelledOnly],
    tasks: [
      task("t-done", done.id, "完了Task", { status: "completed" }),
      task("t-open", active.id, "未完了Task"),
      task("t-effective-completed", effectivelyDone.id, "完了Task", { status: "completed" }),
      task("t-effective-cancelled", effectivelyDone.id, "中止Task", { status: "cancelled" }),
      task("t-effective-suspended", effectivelyDone.id, "中断Task", { status: "suspended" }),
      task("t-cancelled-only", cancelledOnly.id, "中止Task", { status: "cancelled" })
    ],
    deleteSettings: ["wbsHideDoneProjects", "wbsCompactMode"]
  });
  let state = await stateNow(page);
  check("旧stateはwbsHideDoneProjects=false / wbsCompactMode=falseへ移行",
    state.settings.wbsHideDoneProjects === false && state.settings.wbsCompactMode === false,
    JSON.stringify(state.settings));
  check("既定OFFで全Task完了Projectも表示",
    await page.locator('[data-wbs-row-id="p-done"]').count() === 1
      && await page.locator('[data-wbs-row-id="p-active"]').count() === 1);

  await installWriteSpy(page);
  await page.locator('[data-action="toggle-wbs-hide-done-projects"]').click();
  await waitSetting(page, { wbsHideDoneProjects: true });
  check("Dを明示ONにすると全Task完了Projectだけ非表示",
    await page.locator('[data-wbs-row-id="p-done"]').count() === 0
      && await page.locator('[data-wbs-row-id="p-active"]').count() === 1);
  check("Task 0件Projectは0/0完了扱いにせず表示", await page.locator('[data-wbs-row-id="p-empty"]').count() === 1);
  check("completedにcancelled/suspendedが併存するProjectは進捗基準どおり実質完了で非表示",
    await page.locator('[data-wbs-row-id="p-effectively-done"]').count() === 0);
  check("cancelledだけでcountable Taskが0件のProjectは完了扱いにしない",
    await page.locator('[data-wbs-row-id="p-cancelled-only"]').count() === 1);

  state = await stateNow(page);
  check("DはlocalStorageへ1回保存しdataModifiedAtを動かさない",
    await page.evaluate(() => window.__v302StateWrites) === 1 && state.dataModifiedAt === OLD_MODIFIED);
  await page.reload();
  await openViewMenu(page);
  await page.waitForSelector('[data-action="toggle-wbs-hide-done-projects"][aria-pressed="true"]');
  check("D設定はリロード後もtrueを復元", (await stateNow(page)).settings.wbsHideDoneProjects === true);

  await page.locator('[data-action="toggle-wbs-hide-done-projects"]').click();
  await waitSetting(page, { wbsHideDoneProjects: false });
  check("D表示経路で完了Projectが戻る", await page.locator('[data-wbs-row-id="p-done"]').count() === 1);
  await openViewMenu(page);
  await page.locator('[data-action="toggle-wbs-hide-done-projects"]').click();
  await waitSetting(page, { wbsHideDoneProjects: true });
  check("D再非表示経路で完了Projectを再び隠す", await page.locator('[data-wbs-row-id="p-done"]').count() === 0);

  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    state.tasks.find((item) => item.id === "t-done").status = "todo";
    localStorage.setItem(key, JSON.stringify(state));
  }, STATE_KEY);
  await page.reload();
  await page.waitForSelector('[data-wbs-row-id="p-done"]');
  check("全完了から1件未完了へ戻すとProjectが再表示", await page.locator('[data-wbs-row-id="t-done"]').count() === 1);
}

async function verifyFilteredCollapseAll(page) {
  console.log("[4] collapse-all: category+完了Project絞り込み後だけを対象化・全件負例");
  const visible = project("p-collapse-visible", "表示案件", { category: "仕事", collapsed: false });
  const otherCategory = project("p-collapse-other", "別カテゴリ案件", { category: "学び", collapsed: false });
  const done = project("p-collapse-done", "完了案件", { category: "仕事", collapsed: true });
  await seed(page, {
    projects: [visible, otherCategory, done],
    tasks: [task("t-collapse-visible", visible.id, "未完了"), task("t-collapse-other", otherCategory.id, "未完了"),
      task("t-collapse-done", done.id, "完了", { status: "completed" })],
    settings: { wbsCategoryFilter: "仕事", wbsHideDoneProjects: true }
  });
  const collapseAll = page.locator('[data-action="wbs-collapse-all"]');
  const beforeCollapse = await stateNow(page);
  check("絞り込み後の表示Project基準でラベルを計算", await collapseAll.locator("span").textContent() === "すべて折りたたむ");
  await collapseAll.click();
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).projects
    .find((item) => item.id === "p-collapse-visible")?.collapsed === true, STATE_KEY);
  let state = await stateNow(page);
  check("category/完了絞り込みで非表示のProjectはcollapsedを変更しない",
    state.projects.find((item) => item.id === otherCategory.id).collapsed === false
      && state.projects.find((item) => item.id === done.id).collapsed === true);
  check("collapse-allは既存saveAndRender経路のままentity.updatedAtを変更しない",
    state.dataModifiedAt !== beforeCollapse.dataModifiedAt
      && state.projects.every((item) => item.updatedAt
        === beforeCollapse.projects.find((before) => before.id === item.id)?.updatedAt));

  const first = project("p-collapse-first", "全件A", { collapsed: false });
  const second = project("p-collapse-second", "全件B", { collapsed: true });
  await seed(page, {
    projects: [first, second],
    tasks: [task("t-collapse-first", first.id, "未完了"), task("t-collapse-second", second.id, "未完了")],
    settings: { wbsCategoryFilter: "", wbsHideDoneProjects: false, showSuspended: true }
  });
  await page.locator('[data-action="wbs-collapse-all"]').click();
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).projects
    .every((item) => item.collapsed === true), STATE_KEY);
  state = await stateNow(page);
  check("絞り込みなしでは従来どおり全Projectを対象に折りたたむ",
    state.projects.every((item) => item.collapsed === true));
}

async function verifyWipExcludesDoneProjects(page) {
  console.log("[5] WIP: 実質完了Project除外・未完了Projectカウント・描画無書込み");
  const openProjects = [1, 2, 3].map((index) => project(`p-wip-open-${index}`, `進行案件${index}`));
  const done = project("p-wip-done", "実質完了案件");
  await seed(page, {
    projects: [...openProjects, done],
    tasks: [
      ...openProjects.map((item, index) => task(`t-wip-open-${index + 1}`, item.id, "未完了")),
      task("t-wip-completed", done.id, "完了", { status: "completed" }),
      task("t-wip-cancelled", done.id, "中止", { status: "cancelled" })
    ]
  });
  const beforeRender = await stateNow(page);
  check("実質完了1件を除いた3件ではWIP超過バナーを表示しない", await page.locator(".wip-banner").count() === 0);
  await page.locator('[data-action="toggle-wbs-hide-done-projects"]').click();
  await waitSetting(page, { wbsHideDoneProjects: true });
  let state = await stateNow(page);
  check("WIP/完了判定の描画だけではdataModifiedAt/updatedAtを変更しない",
    state.dataModifiedAt === beforeRender.dataModifiedAt
      && state.projects.every((item) => item.updatedAt
        === beforeRender.projects.find((before) => before.id === item.id)?.updatedAt)
      && state.tasks.every((item) => item.updatedAt
        === beforeRender.tasks.find((before) => before.id === item.id)?.updatedAt)
      && await page.locator(".wip-banner").count() === 0);

  const fourth = project("p-wip-open-4", "進行案件4");
  await seed(page, {
    projects: [...openProjects, fourth],
    tasks: [...openProjects.map((item, index) => task(`t-wip-counted-${index + 1}`, item.id, "未完了")),
      task("t-wip-open-4", fourth.id, "未完了", { status: "doing" }),
      task("t-wip-open-4-cancelled", fourth.id, "中止", { status: "cancelled" })]
  });
  state = await stateNow(page);
  check("未完了Taskを含む4件は引き続きWIPとして数えて警告する",
    await page.locator(".wip-banner-row").count() === 4
      && (await page.locator(".wip-banner-msg").textContent()).includes("4件")
      && state.dataModifiedAt === OLD_MODIFIED);
}

async function verifyActiveOnly(page) {
  console.log("[2] E: ON→OFF・片側手動変更時の導出・永続化");
  const active = project("p-e-active", "活動中案件");
  const paused = project("p-e-paused", "中断案件", { status: "paused" });
  const done = project("p-e-done", "完了案件");
  await seed(page, {
    projects: [active, paused, done],
    tasks: [task("t-e-active", active.id, "通常"), task("t-e-paused", paused.id, "中断配下"),
      task("t-e-done", done.id, "完了", { status: "completed" })],
    settings: { showSuspended: true, wbsHideDoneProjects: false }
  });
  const activeButton = page.locator('[data-action="toggle-wbs-active-only"]');
  check("OFF状態は導出値false", await activeButton.getAttribute("aria-pressed") === "false");
  await installWriteSpy(page);
  await activeButton.click();
  await waitSetting(page, { showSuspended: false, wbsHideDoneProjects: true });
  let state = await stateNow(page);
  check("E ONは中断非表示+完了Project非表示だけを束ねる",
    await page.locator('[data-wbs-row-id="p-e-active"]').count() === 1
      && await page.locator('[data-wbs-row-id="p-e-paused"]').count() === 0
      && await page.locator('[data-wbs-row-id="p-e-done"]').count() === 0
      && state.settings.wbsHideCompleted === false);
  check("Eは1回保存・導出ボタンON・dataModifiedAt不変",
    await page.evaluate(() => window.__v302StateWrites) === 1
      && await activeButton.getAttribute("aria-pressed") === "true"
      && state.dataModifiedAt === OLD_MODIFIED);
  await page.reload();
  await openViewMenu(page);
  await page.waitForSelector('[data-action="toggle-wbs-active-only"][aria-pressed="true"]');
  state = await stateNow(page);
  check("Eの2設定はリロード後も個別に復元", state.settings.showSuspended === false && state.settings.wbsHideDoneProjects === true);

  await activeButton.click();
  await waitSetting(page, { showSuspended: true, wbsHideDoneProjects: false });
  check("E OFFは中断表示+完了Project表示", await activeButton.getAttribute("aria-pressed") === "false"
    && await page.locator('[data-wbs-row-id="p-e-paused"]').count() === 1
    && await page.locator('[data-wbs-row-id="p-e-done"]').count() === 1);
  await openViewMenu(page);
  await page.locator('[data-action="toggle-wbs-hide-done-projects"]').click();
  await waitSetting(page, { showSuspended: true, wbsHideDoneProjects: true });
  check("片側だけ手動変更したtrue/trueはアクティブ扱いにしない",
    await activeButton.getAttribute("aria-pressed") === "false");
}

async function verifyCompactAndPlanProtection(page) {
  console.log("[3] F: ON→OFF・非表示要素・期限維持・12WY保護・永続化");
  const normal = project("p-f", "コンパクト案件");
  const detailed = task("t-f", normal.id, "情報量の多い通常Task", {
    dueDate: "2026-08-29", criteriaRequest: true, leverageType: "asset", aiWork: true
  });
  const child = task("t-f-child", normal.id, "子Task", { parentTaskId: detailed.id });
  await seed(page, { projects: [normal], tasks: [detailed, child], blocks: [block("b-f", detailed.id)] });
  const row = page.locator('[data-wbs-row-id="t-f"] > .wbs-task-row');
  const beforeHeight = await row.evaluate((element) => element.getBoundingClientRect().height);
  check("F OFFは進捗・アクション・実績を表示", await row.locator(".wbs-progress-row").isVisible()
    && await row.locator(".wbs-actions").isVisible() && await row.locator(".wbs-task-stats").isVisible());
  await installWriteSpy(page);
  await page.locator('[data-action="toggle-wbs-compact"]').click();
  await waitSetting(page, { wbsCompactMode: true });
  const compactMetrics = await row.evaluate((element) => ({
    compact: element.classList.contains("is-compact"),
    height: element.getBoundingClientRect().height,
    progress: getComputedStyle(element.querySelector(".wbs-progress-row")).display,
    actions: getComputedStyle(element.querySelector(".wbs-actions")).display,
    stats: getComputedStyle(element.querySelector(".wbs-task-stats")).display,
    criteria: getComputedStyle(element.querySelector(".wbs-criteria-btn")).display,
    details: [...element.querySelectorAll(".wbs-compact-detail")].every((item) => getComputedStyle(item).display === "none"),
    status: getComputedStyle(element.querySelector(".wbs-status-badge")).display,
    due: getComputedStyle(element.querySelector(".wbs-due")).display,
    overdue: element.querySelector(".wbs-due")?.classList.contains("wbs-overdue")
  }));
  check("F ONは通常Taskの進捗/数値入力/アクション/実績/補助情報を非表示",
    compactMetrics.compact && compactMetrics.progress === "none" && compactMetrics.actions === "none"
      && compactMetrics.stats === "none" && compactMetrics.criteria === "none" && compactMetrics.details,
    JSON.stringify(compactMetrics));
  check("F ONでもタイトル+status+超過期限+caret+完了checkboxを1行に維持",
    compactMetrics.status !== "none" && compactMetrics.due !== "none" && compactMetrics.overdue
      && await row.locator(".wbs-task-title").isVisible()
      && await row.locator(".wbs-caret").isVisible()
      && await row.locator(".checkbox-button").isVisible()
      && compactMetrics.height < beforeHeight,
    JSON.stringify({ beforeHeight, ...compactMetrics }));
  let state = await stateNow(page);
  check("FはlocalStorageへ1回保存しdataModifiedAtを動かさない",
    await page.evaluate(() => window.__v302StateWrites) === 1 && state.dataModifiedAt === OLD_MODIFIED);
  await page.reload();
  await page.waitForSelector('[data-wbs-row-id="t-f"] > .wbs-task-row.is-compact');
  check("F設定はリロード後もtrueを復元", (await stateNow(page)).settings.wbsCompactMode === true);
  await openViewMenu(page);
  await page.locator('[data-action="toggle-wbs-compact"]').click();
  await waitSetting(page, { wbsCompactMode: false });
  check("F OFFで通常表示を復元", await row.locator(".wbs-progress-row").isVisible()
    && await row.locator(".wbs-actions").isVisible() && !await row.evaluate((element) => element.classList.contains("is-compact")));

  const planProject = project("p-plan", "12WY案件", { twelveWeekStartDate: "2026-08-15" });
  const parent = task("t-plan-parent", planProject.id, "実行計画親", { planTarget: true });
  const stepA = task("t-plan-a", planProject.id, "計画Step A", { parentTaskId: parent.id, owner: "k", order: 1000 });
  const stepB = task("t-plan-b", planProject.id, "計画Step B", { parentTaskId: parent.id, owner: "ai", order: 2000 });
  await seed(page, {
    projects: [planProject], tasks: [parent, stepA, stepB],
    // 現行サイクルではv260既存仕様のhideOldProgressが独立して働くため、ここでは
    // cycleを外してcompact単独の12WY保護経路を検証する。
    settings: { wbsCompactMode: true, twelveWeekStartDate: "" }
  });
  const planRow = page.locator('[data-wbs-row-id="t-plan-a"] > .wbs-task-row');
  check("planParentFor真の行にはis-compactを付けない", !await planRow.evaluate((element) => element.classList.contains("is-compact")));
  check("12WY担当badge・上下移動・下に追加・進捗・通常actionを常時表示",
    await planRow.locator('[data-action="toggle-plan-owner"]').isVisible()
      && await planRow.locator('[data-action="move-plan-step"]').count() === 2
      && await planRow.locator('[data-action="add-plan-step-below"]').isVisible()
      && await planRow.locator(".wbs-progress-row").isVisible()
      && await planRow.locator(".wbs-actions").isVisible());
}

async function verifyExistingFiltersAndSearch(page) {
  console.log("[6] 既存WBS機能: v302 ON/OFF双方でTask完了/中断/category/searchを維持");
  for (const mode of [
    { name: "v302 ON", hide: true, compact: true },
    { name: "v302 OFF", hide: false, compact: false }
  ]) {
    const work = project(`p-reg-work-${mode.hide}`, `${mode.name} 仕事`, { category: "仕事" });
    const learn = project(`p-reg-learn-${mode.hide}`, `${mode.name} 学び`, { category: "学び" });
    const done = project(`p-reg-done-${mode.hide}`, `${mode.name} 完了`, { category: "仕事" });
    const openTask = task(`t-reg-open-${mode.hide}`, work.id, `${mode.name} 検索対象`);
    const doneTask = task(`t-reg-completed-${mode.hide}`, work.id, `${mode.name} 完了Task`, { status: "completed" });
    const suspendedTask = task(`t-reg-suspended-${mode.hide}`, work.id, `${mode.name} 中断Task`, { status: "suspended" });
    await seed(page, {
      projects: [work, learn, done],
      tasks: [openTask, doneTask, suspendedTask, task(`t-reg-learn-${mode.hide}`, learn.id, "学びTask"),
        task(`t-reg-done-${mode.hide}`, done.id, "全完了", { status: "completed" })],
      settings: { wbsHideDoneProjects: mode.hide, wbsCompactMode: mode.compact }
    });
    check(`${mode.name}: 通常Project/未完了Taskは表示し中断Taskは既定非表示`,
      await page.locator(`[data-wbs-row-id="${work.id}"]`).count() === 1
        && await page.locator(`[data-wbs-row-id="${openTask.id}"]`).count() === 1
        && await page.locator(`[data-wbs-row-id="${suspendedTask.id}"]`).count() === 0);
    check(`${mode.name}: 完了Projectフィルタだけが設定どおり`,
      await page.locator(`[data-wbs-row-id="${done.id}"]`).count() === (mode.hide ? 0 : 1));

    await page.locator('[data-action="toggle-wbs-hide-done"]').click();
    await waitSetting(page, { wbsHideCompleted: true });
    check(`${mode.name}: wbsHideCompletedはProject設定と独立して完了Taskだけ隠す`,
      await page.locator(`[data-wbs-row-id="${doneTask.id}"]`).count() === 0
        && (await stateNow(page)).settings.wbsHideDoneProjects === mode.hide);
    await openViewMenu(page);
    await page.locator('[data-action="toggle-show-suspended"]').click();
    await waitSetting(page, { showSuspended: true });
    check(`${mode.name}: showSuspendedで中断Taskを表示`, await page.locator(`[data-wbs-row-id="${suspendedTask.id}"]`).count() === 1);
    await openViewMenu(page);
    await page.locator('[data-action="wbs-category-filter"]').selectOption("学び");
    await waitSetting(page, { wbsCategoryFilter: "学び" });
    check(`${mode.name}: category絞り込みを維持`, await page.locator(`[data-wbs-row-id="${learn.id}"]`).count() === 1
      && await page.locator(`[data-wbs-row-id="${work.id}"]`).count() === 0);

    await openViewMenu(page);
    const input = page.locator("#wbs-search-input");
    await input.fill("検索対象");
    await page.waitForFunction((id) => document.querySelector(`[data-action="wbs-search-jump"][data-id="${id}"]`), openTask.id);
    await page.evaluate(() => {
      window.__v302Scrolled = "";
      Element.prototype.scrollIntoView = function scrollSpy() { window.__v302Scrolled = this.dataset.wbsRowId || ""; };
    });
    await page.locator(`[data-action="wbs-search-jump"][data-id="${openTask.id}"]`).click();
    await page.waitForFunction((id) => window.__v302Scrolled === id, openTask.id);
    check(`${mode.name}: 検索結果ジャンプはcategoryを解除し対象行を表示`,
      (await stateNow(page)).settings.wbsCategoryFilter === ""
        && await page.locator(`[data-wbs-row-id="${openTask.id}"]`).count() === 1);
  }

  console.log("[7] 完了Project検索ジャンプはDフィルタを解除しcompact行へ到達");
  const doneProject = project("p-search-done", "検索完了案件");
  const doneTask = task("t-search-done", doneProject.id, "完了検索ヒット", { status: "completed" });
  await seed(page, {
    projects: [doneProject], tasks: [doneTask],
    settings: { wbsCompactMode: true }
  });
  await page.locator('[data-action="toggle-wbs-hide-done-projects"]').click();
  await waitSetting(page, { wbsHideDoneProjects: true });
  check("検索前は完了Project非表示", await page.locator('[data-wbs-row-id="p-search-done"]').count() === 0);
  await openViewMenu(page);
  await page.locator("#wbs-search-input").fill("完了検索");
  await page.waitForSelector('[data-action="wbs-search-jump"][data-id="t-search-done"]');
  await page.evaluate(() => {
    window.__v302Scrolled = "";
    Element.prototype.scrollIntoView = function scrollSpy() { window.__v302Scrolled = this.dataset.wbsRowId || ""; };
  });
  await page.locator('[data-action="wbs-search-jump"][data-id="t-search-done"]').click();
  await page.waitForFunction(() => window.__v302Scrolled === "t-search-done");
  check("ジャンプ時にDを解除して完了Taskのcompact行を表示",
    (await stateNow(page)).settings.wbsHideDoneProjects === false
      && await page.locator('[data-wbs-row-id="t-search-done"] > .wbs-task-row.is-compact').count() === 1);
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await blockGithubApiByDefault(page);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await verifyMigrationAndDoneProjectToggle(page);
    await verifyActiveOnly(page);
    await verifyCompactAndPlanProtection(page);
    await verifyFilteredCollapseAll(page);
    await verifyWipExcludesDoneProjects(page);
    await verifyExistingFiltersAndSearch(page);
    const unexpectedConsoleErrors = consoleErrors.filter((message) =>
      !message.startsWith("Failed to load resource: the server responded with a status of 404"));
    check("全経路でpageerror/予期しないconsole errorなし",
      pageErrors.length === 0 && unexpectedConsoleErrors.length === 0,
      JSON.stringify({ pageErrors, unexpectedConsoleErrors }));
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }
  console.log(failures === 0 ? "\n✅ v302: 全テスト成功" : `\n❌ v302: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
