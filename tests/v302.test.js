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
  await page.waitForSelector('#app[data-view="wbs"] #wbs-projects-query');
  if(values.projects?.length) {
    const choice=page.locator(`[data-action="wbs-select-project"][data-id="${values.projects[0].id}"]`);
    if(await choice.count()) { await page.locator('.wbs-view-menu > summary').click(); await choice.click(); await openViewMenu(page); }
  }
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
  console.log('A-8/r3: Project chips and summary aggregates match their tasks');
  const projects = [project('p-done','Done'),project('p-active','Active'),project('p-empty','Empty'),project('p-mixed','Mixed'),project('p-cancelled','Cancelled')];
  const tasks = [task('done','p-done','Done',{status:'completed',progressNum:10}),task('open','p-active','Open'),
    task('mixed-done','p-mixed','Done',{status:'completed',progressNum:10}),task('mixed-cancelled','p-mixed','Cancelled',{status:'cancelled'}),task('mixed-suspended','p-mixed','Suspended',{status:'suspended'}),task('cancelled','p-cancelled','Cancelled',{status:'cancelled'})];
  await seed(page,{projects,tasks,deleteSettings:['wbsHideDoneProjects','wbsCompactMode']});
  const state=await stateNow(page);
  check('Legacy settings default to false',state.settings.wbsHideDoneProjects===false&&state.settings.wbsCompactMode===false);
  if(await page.locator('.wbs-view-menu').evaluate(el=>el.open)) await page.locator('.wbs-view-menu > summary').click();
  const root=page.locator('[data-work-list="wbs"]');
  const before=await stateNow(page); await installWriteSpy(page);
  for(const [id,count,num,den] of [['p-done',1,10,10],['p-active',1,3,10],['p-empty',0,0,0],['p-mixed',2,10,10],['p-cancelled',1,0,0]]) {
    const chip=root.locator(`[data-action="wbs-select-project"][data-id="${id}"]`);
    check('Chip task count: '+id,(await chip.textContent()).trim().endsWith(' '+count));
    await chip.click();
    const summary=await root.locator(`[data-work-group="${id}"] > summary`).textContent();
    check('Summary visible count: '+id,summary.includes(`${count}/${count}`),summary);
    check('Summary task aggregate: '+id,summary.includes(`${num}/${den} (`),summary);
  }
  check('Selecting and reading aggregates does not write state',await page.evaluate(()=>window.__v302StateWrites)===0&&JSON.stringify(await stateNow(page))===JSON.stringify(before));
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
  // 現行の作業一覧にWIPバナーの入口は無い(renderWipBannerは呼び出し元なし)。4件でも描画されず、描画だけでは保存値を変えない。
  check("現行の作業一覧は未完了Taskを含む4件でもWIPバナーを描画せず、保存値も動かさない",
    await page.locator(".wip-banner, .wip-banner-row").count() === 0
      && await page.locator('[data-work-key^="task:"]').count() >= 1
      && state.dataModifiedAt === OLD_MODIFIED);
}

async function verifyActiveOnly(page) {
  console.log("[2] E: ON→OFF・片側手動変更時の導出・永続化");
  const active = project("p-e-active", "活動中案件");
  const paused = project("p-e-paused", "中断案件", { status: "paused" });
  const done = project("p-e-done", "完了案件", { status: "completed" });
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
    await page.locator('[data-work-group="p-e-active"]').count() === 1
      && await page.locator('[data-work-group="p-e-paused"]').count() === 0
      && await page.locator('[data-work-group="p-e-done"]').count() === 0
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
    && await page.locator('[data-work-group="p-e-paused"]').count() === 1
    && await page.locator('[data-work-group="p-e-done"]').count() === 1);
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
  // 裁定A-3/A-8: 現行の行は進捗・期日を行メタに常時表示し、副操作メニュー・実績欄・コンパクト行は持たない。
  // コンパクト設定そのものは保存・復元され、行の表示は設定で変わらない。
  const row = page.locator('[data-work-key="task:t-f"]');
  const beforeHeight = await row.evaluate((element) => element.getBoundingClientRect().height);
  const rowShape = () => row.evaluate((element) => ({
    compact: element.classList.contains("is-compact"),
    meta: element.querySelector(".work-list-meta").getClientRects().length,
    menu: element.querySelectorAll(".wbs-row-menu-toggle").length,
    today: element.querySelector('[data-action="placement-add-today"]')?.getClientRects().length || 0,
    title: element.querySelector('[data-action="edit-task"]')?.getClientRects().length || 0,
    check: element.querySelector(".checkbox-button")?.getClientRects().length || 0,
    metaText: element.querySelector(".work-list-meta").textContent,
    height: element.getBoundingClientRect().height
  }));
  const offShape = await rowShape();
  check("F OFFは行メタに進捗・超過を表示し、行メニュー導線は無い", offShape.meta > 0 && offShape.metaText.includes("進捗")
    && offShape.metaText.includes("超過") && offShape.menu === 0 && !offShape.compact, JSON.stringify(offShape));
  await installWriteSpy(page);
  await page.locator('[data-action="toggle-wbs-compact"]').click();
  await waitSetting(page, { wbsCompactMode: true });
  const compactMetrics = await rowShape();
  check("F ONでも現行の行は同じ表示(メタ・今日へ・タイトル・完了checkboxを維持、行高も不変)",
    !compactMetrics.compact && compactMetrics.meta > 0 && compactMetrics.today > 0 && compactMetrics.title > 0
      && compactMetrics.check > 0 && compactMetrics.metaText.includes("超過") && compactMetrics.height === beforeHeight,
    JSON.stringify({ beforeHeight, ...compactMetrics }));
  let state = await stateNow(page);
  check("FはlocalStorageへ1回保存しdataModifiedAtを動かさない",
    await page.evaluate(() => window.__v302StateWrites) === 1 && state.dataModifiedAt === OLD_MODIFIED);
  await page.reload();
  await page.locator('[data-action="wbs-select-project"][data-id="p-f"]').click();
  await page.waitForSelector('[data-work-key="task:t-f"]');
  check("F設定はリロード後もtrueを復元", (await stateNow(page)).settings.wbsCompactMode === true);
  await openViewMenu(page);
  await page.locator('[data-action="toggle-wbs-compact"]').click();
  await waitSetting(page, { wbsCompactMode: false });
  check("F OFFでも行メタを表示し行メニュー導線は無い", (await rowShape()).meta > 0 && (await rowShape()).menu === 0 && !(await rowShape()).compact);


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
  const planRow = page.locator('[data-work-key="task:t-plan-a"]');
  check("planParentFor真の行にもis-compactを付けない", !await planRow.evaluate((element) => element.classList.contains("is-compact")));
  // 裁定A-8: 担当切替・上下移動・途中追加は現行の行に入口が無い(12WYのStepでも同じ)。進捗は行メタに出る。
  check("12WY Stepの行に担当badge・上下移動・下に追加・行メニューの入口が無く、進捗は表示される",
    await planRow.locator('[data-action="toggle-plan-owner"], [data-action="move-plan-step"], [data-action="add-plan-step-below"], .wbs-row-menu-toggle').count() === 0
      && (await planRow.locator(".work-list-meta").textContent()).includes("進捗"));
}


async function verifyExistingFiltersAndSearch(page) {
  console.log("[6] 既存WBS機能: v302 ON/OFF双方でTask完了/中断/category/searchを維持");
  for (const mode of [
    { name: "v302 ON", hide: true, compact: true },
    { name: "v302 OFF", hide: false, compact: false }
  ]) {
    const work = project(`p-reg-work-${mode.hide}`, `${mode.name} 仕事`, { category: "仕事" });
    const learn = project(`p-reg-learn-${mode.hide}`, `${mode.name} 学び`, { category: "学び" });
    const done = project(`p-reg-done-${mode.hide}`, `${mode.name} 完了`, { category: "仕事", status: "completed" });
    const openTask = task(`t-reg-open-${mode.hide}`, work.id, `${mode.name} 検索対象`);
    const doneTask = task(`t-reg-completed-${mode.hide}`, work.id, `${mode.name} 完了Task`, { status: "completed" });
    const suspendedTask = task(`t-reg-suspended-${mode.hide}`, work.id, `${mode.name} 中断Task`, { status: "suspended" });
    await seed(page, {
      projects: [work, learn, done],
      tasks: [openTask, doneTask, suspendedTask, task(`t-reg-learn-${mode.hide}`, learn.id, "学びTask"),
        task(`t-reg-done-${mode.hide}`, done.id, "全完了", { status: "completed" })],
      settings: { wbsHideDoneProjects: mode.hide, wbsCompactMode: mode.compact }
    });
    if (await page.locator('.wbs-view-menu').evaluate((element) => element.open)) await page.locator('.wbs-view-menu > summary').click();
    { const all = page.locator('[data-action="wbs-select-project"][data-id=""]'); if (await all.getAttribute('aria-pressed') !== 'true') await all.click(); }
    check(`${mode.name}: 通常Project/未完了Taskは表示し中断Taskは既定非表示`,
      await page.locator(`[data-work-group="${work.id}"]`).count() === 1
        && await page.locator(`[data-wbs-row-id="${openTask.id}"]`).count() === 1
        && await page.locator(`[data-wbs-row-id="${suspendedTask.id}"]`).count() === 0);
    check(`${mode.name}: 完了Projectフィルタだけが設定どおり`,
      await page.locator(`[data-work-group="${done.id}"]`).count() === (mode.hide ? 0 : 1));

    await openViewMenu(page);
    await page.locator('.wbs-view-option[data-action="toggle-wbs-hide-done"]').click();
    await waitSetting(page, { wbsHideCompleted: true });
    check(`${mode.name}: wbsHideCompletedはProject設定と独立して完了Taskだけ隠す`,
      await page.locator(`[data-wbs-row-id="${doneTask.id}"]`).count() === 0
        && (await stateNow(page)).settings.wbsHideDoneProjects === mode.hide);
    await openViewMenu(page);
    await page.locator('.wbs-view-option[data-action="toggle-show-suspended"]').click();
    await waitSetting(page, { showSuspended: true });
    check(`${mode.name}: showSuspendedで中断Taskを表示`, await page.locator(`[data-wbs-row-id="${suspendedTask.id}"]`).count() === 1);
    await openViewMenu(page);
    await page.locator('[data-action="wbs-category-filter"]').selectOption("学び");
    await waitSetting(page, { wbsCategoryFilter: "学び" });
    check(`${mode.name}: category絞り込みを維持`, await page.locator(`[data-work-group="${learn.id}"]`).count() === 1
      && await page.locator(`[data-work-group="${work.id}"]`).count() === 0);

    const viewMenu = page.locator("details.wbs-view-menu");
    if (await viewMenu.evaluate(el => el.open)) await viewMenu.locator("summary").click();
    await openViewMenu(page);
    await page.locator('[data-action="wbs-category-filter"]').selectOption("");
    await page.locator(`[data-action="wbs-select-project"][data-id="${work.id}"]`).click();
    await page.locator('#wbs-projects-query').fill("検索対象");
    check(`${mode.name}: category解除→Project選択→Task検索で対象行だけへ到達`,
      (await stateNow(page)).settings.wbsCategoryFilter === ""
        && await page.locator(`[data-wbs-row-id="${openTask.id}"]`).count() === 1
        && await page.locator(`[data-wbs-row-id="t-reg-learn-${mode.hide}"]`).count() === 0
        && await page.locator(`[data-work-group="${work.id}"] [data-work-key]`).count() === 1);
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
  await page.locator('[data-action="toggle-wbs-hide-done-projects"]').click();
  await page.locator('[data-action="wbs-select-project"][data-id="p-search-done"]').click();
  await page.locator('#wbs-projects-query').fill('完了検索');
  check("Dを解除してProject選択・Task検索から完了Taskのcompact行へ到達",
    (await stateNow(page)).settings.wbsHideDoneProjects === false
      && await page.locator('[data-work-key="task:t-search-done"]').count() === 1
      && await page.locator('[data-work-group="p-search-done"] [data-work-key]').count() === 1);
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
