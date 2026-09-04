// v328 A-1a: WBS TOWERヘッダ、表示メニュー集約、追加フォーム折りたたみ。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-02";
const FIXED_NOW = new Date(2026, 8, 2, 10, 0, 0, 0);
let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}
function project(id, title, extra = {}) {
  return { id, kind: "normal", title, category: "開発", status: "active", priority: "中",
    description: "", dueDate: "", twelveWeekStartDate: "", showProgress: false, collapsed: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, deleted: false, ...extra };
}
function task(id, projectId, title, extra = {}) {
  return { id, projectId, parentTaskId: "", title, category: "開発", status: "todo",
    dueDate: "", description: "", progressNum: 0, progressDen: 10, collapsed: false,
    criteriaRequest: false, planTarget: false, owner: "k", order: null,
    createdAt: `${TODAY}T09:00:00`, updatedAt: `${TODAY}T09:00:00`, deleted: false, ...extra };
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);
  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    const cycle = project("p-cycle", "12WY Project", { twelveWeekStartDate: "2026-08-15" });
    const other = project("p-other", "その他 Project", { category: "仕事", twelveWeekStartDate: "2026-08-15" });
    const wish = project("p-wish", "Wish Project", { kind: "wish", category: "回復" });
    const parent = task("t-active", cycle.id, "期限超過 active", { status: "doing", dueDate: "2026-09-01", progressNum: 4, criteriaRequest: true });
    const fixtureTasks = [
      task("t-done", cycle.id, "完了 Task", { status: "completed", dueDate: TODAY, progressNum: 10 }),
      parent,
      task("t-todo", cycle.id, "未着手 Task", { dueDate: "2026-09-05" }),
      task("t-sub", cycle.id, "サブ Task", { parentTaskId: parent.id })
    ];
    const tracks = [
      { id: "track-numeric", ownerType: "project", ownerId: cycle.id, cycleStartDate: "2026-08-15",
        kind: "numeric", name: "執筆", unit: "章", startDate: "2026-08-15", deadline: "2026-11-06",
        baselineValue: 0, goalValue: 20, valueStep: 1, milestones: [], status: "active", closedAt: "",
        closedReason: "", supersedesTrackId: "", carriedFromTrackId: "", createdAt: `${TODAY}T08:00:00`,
        updatedAt: `${TODAY}T08:00:00`, deleted: false },
      { id: "track-milestone", ownerType: "project", ownerId: other.id, cycleStartDate: "2026-08-15",
        kind: "milestone", name: "公開", unit: "", startDate: "2026-08-15", deadline: "",
        baselineValue: 0, goalValue: 0, valueStep: 1, status: "active", closedAt: "", closedReason: "",
        supersedesTrackId: "", carriedFromTrackId: "", createdAt: `${TODAY}T08:00:00`,
        updatedAt: `${TODAY}T08:00:00`, deleted: false,
        milestones: [{ id: "ms-1", label: "初稿", plannedDate: "2026-09-05", originalPlannedDate: "2026-09-03",
          doneAt: "", doneChangedAt: "", updatedAt: `${TODAY}T08:00:00`, deleted: false,
          progress: { type: "percent", current: 40, target: null, start: null, unit: "" } }] }
    ];
    const trackMeasurements = [{ id: "measure-1", trackId: "track-numeric", value: 4,
      observedAt: "2026-08-20T10:00:00", updatedAt: "2026-08-20T10:00:00", deleted: false }];
    await page.evaluate(({ key, projects, tasks, tracks, trackMeasurements, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      Object.assign(state, { projects, tasks, tracks, trackMeasurements, blocks: [], currentView: "wbs", selectedDate: today });
      Object.assign(state.settings, { twelveWeekStartDate: "2026-08-15", showSuspended: false,
        wbsHideCompleted: false, wbsHideDoneProjects: false, wbsCompactMode: false,
        wbsCategoryFilter: "", wbsEditMode: false });
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, projects: [cycle, other, wish], tasks: fixtureTasks, tracks, trackMeasurements, today: TODAY });
    await page.reload();
    await page.waitForSelector(".wbs-header");

    console.log("[1] モバイルの常時ツールバーと非永続の表示メニュー");
    check("TOWER / WBSと12WY週・日付範囲を表示", /TOWER \/ WBS/.test(await page.locator(".wbs-heading").textContent())
      && (await page.locator(".wbs-heading").textContent()).includes("12WY 第3週 ・ 8/29 – 9/4"));
    check("閉時の常時操作は表示と追加だけ", await page.locator(".wbs-view-menu > summary").isVisible()
      && await page.locator(".wbs-add-menu > summary").isVisible()
      && !await page.locator("#wbs-search-input").isVisible() && !await page.locator(".wbs-edit-toggle").isVisible());
    const stateBeforeMenus = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await page.locator(".wbs-view-menu > summary").click();
    check("表示メニュー内に検索と編集を含む8操作、ON/OFFを表示", await page.locator("#wbs-search-input").isVisible()
      && await page.locator(".wbs-view-options [data-action]").count() === 8
      && (await page.locator(".wbs-view-options").textContent()).includes("カテゴリ絞り込み")
      && await page.locator(".wbs-view-option b").count() === 7);
    check("表示メニュー開閉はstate/localStorageへ書かない", await page.evaluate((key) => localStorage.getItem(key), STATE_KEY) === stateBeforeMenus);
    const menuEdit = page.locator(".wbs-menu-edit-toggle");
    check("モバイルの編集モード行は44px・現在値OFF", await menuEdit.isVisible()
      && await menuEdit.evaluate((element) => element.getBoundingClientRect().height >= 44)
      && await menuEdit.locator("b").textContent() === "OFF");
    await menuEdit.click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).settings.wbsEditMode === true, STATE_KEY);
    await page.locator(".wbs-view-menu > summary").click();
    check("表示メニューの編集モード行は既存actionでONへ更新", await page.locator(".wbs-menu-edit-toggle b").textContent() === "ON");
    await page.locator(".wbs-menu-edit-toggle").click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).settings.wbsEditMode === false, STATE_KEY);

    console.log("[2] 追加パネルは既定閉、Project/Task追加は既存actionのまま");
    check("追加パネルは既定閉", !await page.locator("#projectTitle").isVisible() && !await page.locator("#taskTitle").isVisible());
    const stateBeforeAddPanel = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await page.locator(".wbs-add-menu > summary").click();
    await page.locator(".wbs-add-menu > summary").click();
    check("追加パネル開閉はstate/localStorageへ書かない",
      await page.evaluate((key) => localStorage.getItem(key), STATE_KEY) === stateBeforeAddPanel);
    await page.locator(".wbs-add-menu > summary").click();
    await page.locator("#projectTitle").fill("追加 Project");
    await page.locator('[data-action="add-project"]').click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).projects.some((item) => item.title === "追加 Project"), STATE_KEY);
    const addedProjectId = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).projects.find((item) => item.title === "追加 Project").id, STATE_KEY);
    await page.locator(".wbs-add-menu > summary").click();
    await page.locator("#taskTitle").fill("追加 Task");
    await page.locator("#taskProject").selectOption(addedProjectId);
    await page.locator('[data-action="add-task"]').click();
    const added = await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      return state.tasks.find((item) => item.title === "追加 Task");
    }, STATE_KEY);
    check("add-project/add-taskが従来どおり保存", added?.projectId === addedProjectId);

    console.log("[3] TOWER色・44px・390/1280pxレスポンシブ");
    await page.locator(".wbs-view-menu > summary").click();
    await page.locator("#wbs-search-input").fill("Task");
    await page.waitForSelector(".wbs-search-shell .search-kind");
    const mobile = await page.evaluate(() => {
      const root = document.querySelector(".wbs-tower");
      const doc = document.scrollingElement || document.documentElement;
      const buttons = [...document.querySelectorAll(".wbs-toolbar summary")].map((el) => el.getBoundingClientRect().height);
      return { bg: getComputedStyle(root).backgroundColor, noOverflow: doc.scrollWidth <= innerWidth + 1, buttons };
    });
    const overdueColor = await page.locator(".wbs-projects .wbs-overdue").first().evaluate((el) => getComputedStyle(el).color);
    check("390pxでTOWER背景・アンバー期限超過・横スクロールなし", mobile.bg === "rgb(5, 10, 20)"
      && overdueColor === "rgb(242, 184, 75)" && mobile.noOverflow);
    check("常時ボタンは44px以上", mobile.buttons.every((height) => height >= 44), JSON.stringify(mobile.buttons));
    const accessibilityViolations = await page.locator(".wbs-tower").evaluate((root) => {
      const visibleTextElements = [root, ...root.querySelectorAll("*")].filter((element) => {
        if (!(element instanceof HTMLElement) || element.closest("[disabled],[aria-disabled='true'],[aria-hidden='true']")) return false;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || element.getClientRects().length === 0) return false;
        return [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      });
      return visibleTextElements.flatMap((element) => {
        const style = getComputedStyle(element);
        let effectiveOpacity = 1;
        for (let current = element; current && root.contains(current); current = current.parentElement) {
          effectiveOpacity *= Number(getComputedStyle(current).opacity);
          if (current === root) break;
        }
        const reasons = [];
        if (parseFloat(style.fontSize) < 11) reasons.push(`font=${style.fontSize}`);
        if (effectiveOpacity < .7 - .001) reasons.push(`opacity=${effectiveOpacity}`);
        return reasons.length ? [`${element.tagName.toLowerCase()}.${element.className}: ${reasons.join(",")}`] : [];
      });
    });
    check("WBSタブの可視テキストは11px以上・opacity .7以上", accessibilityViolations.length === 0,
      JSON.stringify(accessibilityViolations.slice(0, 12)));
    const towerTokens = await page.evaluate(() => ({
      criteria: getComputedStyle(document.querySelector(".wbs-criteria-btn.on")).borderColor,
      searchKind: getComputedStyle(document.querySelector(".wbs-search-shell .search-kind")).color,
      track: getComputedStyle(document.querySelector(".twy-row")).backgroundColor
    }));
    check("検索種別・条件ボタン・12WYトラックはTOWERトークン配色",
      towerTokens.criteria === "rgb(85, 217, 232)" && towerTokens.searchKind === "rgb(85, 217, 232)"
        && towerTokens.track === "rgb(5, 10, 20)", JSON.stringify(towerTokens));
    check("今週を確定は12WY Project行内", await page.locator('[data-wbs-row-id="p-cycle"] [data-action="twy-open-commit"]').count() === 1
      && await page.locator(".wbs-toolbar [data-action='twy-open-commit']").count() === 0);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await page.waitForSelector("#wbs-search-input", { state: "attached" });
    const desktop = await page.evaluate(() => ({
      search: document.querySelector("#wbs-search-input").getClientRects().length > 0,
      edit: document.querySelector(".wbs-edit-toggle").getClientRects().length > 0,
      summary: document.querySelector(".wbs-view-menu > summary").getClientRects().length > 0,
      options: document.querySelector(".wbs-view-options").getClientRects().length > 0,
      noOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
      inputFont: parseFloat(getComputedStyle(document.querySelector("#wbs-search-input")).fontSize)
    }));
    check("1280pxはsummaryを隠し検索・編集モード・表示設定を常時表示", desktop.search && desktop.edit
      && !desktop.summary && desktop.options
      && desktop.inputFont >= 16 && desktop.noOverflow, JSON.stringify(desktop));
    const stateBeforeResizeMenu = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await page.setViewportSize({ width: 1000, height: 900 });
    check("1280→1000pxをリロード無しで跨ぐと閉状態を表示", await page.locator(".wbs-view-menu > summary").isVisible()
      && !await page.locator(".wbs-view-popover").isVisible());
    await page.locator(".wbs-view-menu > summary").click();
    check("1000pxでネイティブdetailsを開ける", await page.locator(".wbs-view-popover").isVisible());
    await page.locator(".wbs-view-menu > summary").click();
    check("1000pxでネイティブdetailsを閉じられ、保存もしない", !await page.locator(".wbs-view-popover").isVisible()
      && await page.evaluate((key) => localStorage.getItem(key), STATE_KEY) === stateBeforeResizeMenu);
    check("pageerror 0", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  if (failures) { console.error(`\n❌ v328 A-1a: ${failures} failure(s)`); process.exit(1); }
  console.log("\n✅ v328 A-1a: all checks passed");
})().catch((error) => { console.error(error); process.exit(1); });
