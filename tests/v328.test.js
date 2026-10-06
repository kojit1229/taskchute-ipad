// v328 A-1a: WBS TOWERヘッダ、表示メニュー集約、追加フォーム折りたたみ。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-02";
const FIXED_NOW = new Date(2026, 8, 2, 10, 0, 0, 0);
async function tokenColor(page, selector, token) {
  return page.locator(selector).first().evaluate((root, name) => {
    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(root).getPropertyValue(name).trim();
    root.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

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
  page.on("pageerror", (error) => { pageErrors.push(error.message); console.error("PAGEERROR",error.message); });
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

    check('WBS header keeps cycle week and date range', (await page.locator('.wbs-heading').textContent()).includes('8/29')&&(await page.locator('.wbs-heading').textContent()).includes('9/4'));
    check('One title query and add panel are always available',await page.locator('#wbs-projects-query').isVisible()&&await page.locator('[data-work-list="wbs"] [data-work-filter="query"]').count()===1&&await page.locator('.wbs-add-menu > summary').isVisible());
    const menu=page.locator('.wbs-view-menu');
    const openMenu=async()=>{if(!await menu.evaluate(el=>el.open))await menu.locator('summary').click();};
    const closeMenu=async()=>{if(await menu.evaluate(el=>el.open))await menu.locator('summary').click();};
    const beforeMenus=await page.evaluate(key=>localStorage.getItem(key),STATE_KEY);
    await openMenu();
    check('View menu retains 8 operations',await page.locator('.wbs-view-options [data-action]').count()===8);
    await closeMenu();
    check('Opening and closing view menu does not save',await page.evaluate(key=>localStorage.getItem(key),STATE_KEY)===beforeMenus);
    for(const enabled of [true,false]) {
      await openMenu();
      const button=page.locator('.wbs-menu-edit-toggle');
      check('Edit mode tap height >=44px',await button.evaluate(el=>el.getBoundingClientRect().height>=44));
      await button.click();
      check('Existing edit setting is saved: '+enabled,await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).settings.wbsEditMode,STATE_KEY)===enabled);
    }
    await closeMenu();

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
    await closeMenu();
    await page.locator('[data-action="wbs-select-project"][data-id="p-cycle"]').click();
    await page.locator('#wbs-projects-query').fill("未着手 Task");
    await page.waitForSelector('[data-work-group="p-cycle"] [data-work-key="task:t-todo"]');
    check("選択Project内検索は一致Taskだけを表示し別Projectを混ぜない", await page.locator('[data-work-group="p-cycle"] [data-work-key]').count() === 1
      && await page.locator(`[data-work-key="task:${added.id}"]`).count() === 0);
    await page.locator('#wbs-projects-query').fill('');
    const mobile = await page.evaluate(() => {
      const root = document.querySelector(".wbs-tower");
      const doc = document.scrollingElement || document.documentElement;
      const buttons = [...document.querySelectorAll(".wbs-toolbar summary")].map((el) => el.getBoundingClientRect().height);
      return { bg: getComputedStyle(root).backgroundColor, noOverflow: doc.scrollWidth <= innerWidth + 1, buttons };
    });
    const overdueText = await page.locator('[data-work-key="task:t-active"] .work-list-meta').first().textContent();
    check("390pxでTOWER背景・期限超過の表示・横スクロールなし", mobile.bg === await tokenColor(page, ".wbs-tower", "--tower-bg")
      && /超過 [0-9]+日/.test(overdueText) && mobile.noOverflow, overdueText);
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
    check('AI request toggle is deferred while saved flag is retained',await page.locator('[data-work-list="wbs"] [data-action="toggle-criteria-request"]').count()===0&&await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).tasks.find(t=>t.id==='t-active').criteriaRequest,STATE_KEY)===true);
    const selectedColor=await page.locator('[data-action="wbs-select-project"][data-id="p-cycle"]').evaluate(el=>getComputedStyle(el).borderLeftColor);
    check('Selected project retains amber indicator',selectedColor===await tokenColor(page,'.wbs-tower','--tower-amber'),selectedColor);
    const summary=await page.locator('[data-work-group="p-cycle"] > summary').textContent();
    check('Project summary carries cycle week',/12\u9031\u8a08\u753b \u7b2c3\u9031/.test(summary),summary);
    check('WBS no longer embeds track editing',await page.locator('[data-work-list="wbs"] [data-twy-track-id]').count()===0);
    await page.locator('#bottomNav [data-action="nav"][data-view="more"]').click();
    await page.locator('.more-tower-grid [data-action="nav"][data-view="twelveweek"]').click();
  console.log('Twelve-week navigation',await page.locator('#app').getAttribute('data-view'),await page.locator('.twy-tower').count());
    await page.locator('.twy-cycle-fold > summary').click();
    const track=page.locator('.twy-goals-panel [data-twy-track-id="track-numeric"]');
    check('Track moves to twelve-week tab',await track.count()===1);
    check('Track retains TOWER background',await track.evaluate(el=>getComputedStyle(el).backgroundColor)===await tokenColor(page,'.twy-goals-panel','--tower-bg'));
    check('Week commit remains reachable in twelve-week tab',await page.locator('.twy-goals-panel [data-action="twy-open-commit"]').count()===1);
    await page.locator('#bottomNav [data-action="nav"][data-view="more"]').click();
    await page.locator('.more-tower-grid [data-action="nav"][data-view="wbs"]').click();

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await page.waitForSelector("#wbs-projects-query", { state: "attached" });
    const desktop = await page.evaluate(() => ({
      search: document.querySelector("#wbs-projects-query").getClientRects().length > 0,
      edit: document.querySelector(".wbs-edit-toggle").getClientRects().length > 0,
      summary: document.querySelector(".wbs-view-menu > summary").getClientRects().length > 0,
      options: document.querySelector(".wbs-view-options").getClientRects().length > 0,
      noOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
      inputFont: parseFloat(getComputedStyle(document.querySelector("#wbs-projects-query")).fontSize)
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
