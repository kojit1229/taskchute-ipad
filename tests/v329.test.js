// v329 A-1b: WBS Project/Task行再構成と排他的な副操作メニュー。
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
    dueDate: "", selfDueOff: true, description: "", progressNum: 0, progressDen: 10, collapsed: false,
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
  const row = (id) => page.locator(`[data-wbs-row-id="${id}"] > .wbs-task-row`);
  const openTaskMenu = async (id) => row(id).locator(":scope > .wbs-row-menu-toggle").click();
  const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    const cycle = project("p-cycle", "12WY Project", { twelveWeekStartDate: "2026-08-15" });
    const other = project("p-other", "その他 Project", { category: "仕事" });
    const wish = project("p-wish", "Wish", { kind: "wish", category: "回復" });
    const active = task("t-active", cycle.id, "期限超過 active", { status: "doing", dueDate: "2026-09-01", progressNum: 4 });
    const suspended = task("t-suspended", other.id, "中断 Task", { status: "suspended" });
    const planParent = task("t-plan", cycle.id, "未着手 plan", { planTarget: true, dueDate: "2026-09-05" });
    const tasks = [
      task("t-done", cycle.id, "完了 Task", { status: "completed", dueDate: TODAY, progressNum: 10 }),
      active, suspended, planParent,
      task("t-sub", cycle.id, "サブ Task", { parentTaskId: active.id }),
      task("t-step", cycle.id, "12WY Step", { parentTaskId: planParent.id, owner: "k", order: 1000 })
    ];
    await page.evaluate(({ key, projects, tasks, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      Object.assign(state, { projects, tasks, tracks: [], trackMeasurements: [], blocks: [], currentView: "wbs", selectedDate: today });
      Object.assign(state.settings, { twelveWeekStartDate: "2026-08-15", showSuspended: true,
        wbsHideCompleted: false, wbsHideDoneProjects: false, wbsCompactMode: false,
        wbsCategoryFilter: "", wbsEditMode: false });
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, projects: [cycle, other, wish], tasks, today: TODAY });
    await page.reload();
    await page.waitForSelector('[data-wbs-row-id="t-active"] > .wbs-task-row');

    console.log("[1] Task常時表示と完了・期限表現");
    const activeRow = row("t-active");
    check("通常行は完了・名前・meta・今日へ・…を常時表示", await activeRow.locator(":scope > .wbs-task-check").isVisible()
      && await activeRow.locator(":scope > .wbs-task-copy .wbs-task-title").isVisible()
      && (await activeRow.locator(".wbs-task-meta").textContent()).includes("進捗 4/10")
      && (await activeRow.locator(".wbs-task-meta").textContent()).includes("期限 9/1 超過")
      && await activeRow.locator(":scope > .wbs-today-btn").textContent() === "今日へ"
      && await activeRow.locator(":scope > .wbs-row-menu-toggle").isVisible());
    check("閉時は＋サブ・中断・編集・AI・上下操作を表示しない",
      await activeRow.locator(":scope > .wbs-row-menu-panel").isHidden()
      && await activeRow.locator('[data-action="add-subtask"], [data-action="suspend-task"], [data-action="edit-task"], [data-action="toggle-criteria-request"], [data-action="move-plan-step"]').evaluateAll((els) => els.every((el) => !el.getClientRects().length)));
    const doneRow = row("t-done");
    check("完了行は取消線と完了表示で今日へ無し", await doneRow.locator(".wbs-task-title").evaluate((el) => getComputedStyle(el).textDecorationLine.includes("line-through"))
      && await doneRow.locator(":scope > .wbs-task-done").textContent() === "完了"
      && await doneRow.locator('[data-action="task-today"]').count() === 0);
    check("期限超過はアンバーで赤系class無し", await activeRow.locator(".wbs-overdue").evaluate((el) => getComputedStyle(el).color === "rgb(242, 184, 75)"
      && !/red|danger|error/i.test(el.className)));
    check("状態badge(active/done/未着手)を描画しない", await page.locator(".wbs-status-badge").count() === 0);
    const lowOpacityText = await row("t-suspended").evaluate((root) => [...root.querySelectorAll("*")]
      .filter((el) => el.getClientRects().length && [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))
      .map((el) => {
        let opacity = 1;
        for (let current = el; current && root.contains(current); current = current.parentElement) {
          opacity *= Number.parseFloat(getComputedStyle(current).opacity);
        }
        return { text: el.textContent.trim(), opacity };
      }).filter((item) => item.opacity < .7 - Number.EPSILON));
    check("中断行の全テキストは実効opacity .7以上", lowOpacityText.length === 0, JSON.stringify(lowOpacityText));

    console.log("[2] 排他的メニューと既存Task/12WY action");
    await page.evaluate((key) => {
      window.__v329StateWrites = 0;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItemSpy(name, value) {
        if (this === localStorage && name === key) window.__v329StateWrites += 1;
        return original.call(this, name, value);
      };
    }, STATE_KEY);
    const stateBeforeMenus = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await openTaskMenu("t-active");
    check("…で副操作を表示", await activeRow.locator(":scope > .wbs-row-menu-panel").isVisible()
      && await activeRow.locator('[data-action="add-subtask"]').isVisible()
      && await activeRow.locator('[data-action="toggle-criteria-request"]').isVisible());
    await openTaskMenu("t-plan");
    check("別行を開くと前行を閉じる", await activeRow.locator(":scope > .wbs-row-menu-panel").isHidden()
      && await row("t-plan").locator(":scope > .wbs-row-menu-panel").isVisible());
    check("メニュー開閉はstate/localStorage非書込", await page.evaluate((key) => localStorage.getItem(key), STATE_KEY) === stateBeforeMenus
      && await page.evaluate(() => window.__v329StateWrites) === 0);

    await openTaskMenu("t-active");
    await activeRow.locator('[data-action="add-subtask"]').click();
    await page.locator('[data-modal-field="title"]').fill("追加サブ");
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).tasks.some((item) => item.title === "追加サブ" && item.parentTaskId === "t-active"), STATE_KEY);
    check("＋サブは既存actionで子を追加", (await stored()).tasks.filter((item) => item.parentTaskId === "t-active").length === 2);
    await openTaskMenu("t-active");
    await row("t-active").locator('[data-action="suspend-task"]').click();
    check("中断は既存actionでstatus更新", (await stored()).tasks.find((item) => item.id === "t-active")?.status === "suspended");
    await openTaskMenu("t-active");
    await row("t-active").locator('[data-action="toggle-criteria-request"]').click();
    check("AI依頼はcriteriaRequest更新", (await stored()).tasks.find((item) => item.id === "t-active")?.criteriaRequest === true);

    await openTaskMenu("t-step");
    await row("t-step").locator('[data-action="add-plan-step-below"]').click();
    await page.locator('[data-modal-field="title"]').fill("追加Step");
    await page.locator('[data-action="modal-save"]').click();
    const addedStep = (await stored()).tasks.find((item) => item.title === "追加Step");
    await openTaskMenu("t-step");
    await row("t-step").locator('[data-action="move-plan-step"][data-direction="1"]').click();
    let state = await stored();
    check("12WY Stepの↓で順序更新", state.tasks.find((item) => item.id === "t-step").order > state.tasks.find((item) => item.id === addedStep.id).order);
    await openTaskMenu("t-step");
    await row("t-step").locator('[data-action="toggle-plan-owner"]').click();
    check("担当K/AI切替が既存actionで動く", (await stored()).tasks.find((item) => item.id === "t-step")?.owner === "ai");

    console.log("[3] 編集モード・Project見出し・レスポンシブ品質");
    check("編集OFFでは行内入力無し", await page.locator(".wbs-inline-input").count() === 0);
    await page.locator(".wbs-view-menu > summary").click();
    await page.locator('[data-action="toggle-wbs-edit"].wbs-menu-edit-toggle').click();
    check("編集ONだけ行内入力を表示し進捗入力は2つ/行", await row("t-plan").locator(".wbs-inline-input").count() >= 5
      && await row("t-plan").locator(".wbs-progress-input").count() === 2);
    const projectRow = page.locator('[data-wbs-row-id="p-cycle"]');
    const otherProjectRow = page.locator('[data-wbs-row-id="p-other"]');
    check("Project見出しはタグ・進捗・完了数と…を表示", (await projectRow.locator(".wbs-project-meta").textContent()).includes("[12WY]")
      && (await projectRow.locator(".wbs-project-meta").textContent()).includes("進捗")
      && (await projectRow.locator(".wbs-project-meta").textContent()).includes("完了")
      && await projectRow.locator(":scope > .wbs-project-head > .wbs-row-menu-toggle").isVisible());
    const projectMenuRightGaps = await Promise.all([projectRow, otherProjectRow].map((projectLocator) => projectLocator.locator(":scope > .wbs-project-head").evaluate((head) => {
      const headBox = head.getBoundingClientRect();
      const menuBox = head.querySelector(":scope > .wbs-row-menu-toggle").getBoundingClientRect();
      return headBox.right - menuBox.right;
    })));
    check("12WY/非12WY Projectの…右端位置が一致", projectMenuRightGaps.every((gap) => Math.abs(gap) < .5)
      && Math.abs(projectMenuRightGaps[0] - projectMenuRightGaps[1]) < .5, JSON.stringify(projectMenuRightGaps));
    await projectRow.locator(":scope > .wbs-project-head > .wbs-row-menu-toggle").click();
    check("Projectメニューは＋タスク・編集・中断を表示", await projectRow.locator('[data-action="add-task-to-project"]').isVisible()
      && await projectRow.locator('[data-action="edit-project"]').isVisible()
      && await projectRow.locator('[data-action="suspend-project"]').isVisible());

    async function quality(width) {
      await page.setViewportSize({ width, height: 900 });
      return page.locator(".wbs-tower").evaluate((root) => {
        const doc = document.scrollingElement || document.documentElement;
        const visible = [...root.querySelectorAll("*")].filter((el) => el instanceof HTMLElement && el.getClientRects().length
          && getComputedStyle(el).visibility !== "hidden");
        const textTooSmall = visible.filter((el) => [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
          && parseFloat(getComputedStyle(el).fontSize) < 11).map((el) => el.className);
        const tapTooSmall = visible.filter((el) => el.matches("button, summary, input, select")
          && (el.getBoundingClientRect().height < 44 || (el.matches("button, summary") && el.getBoundingClientRect().width < 44)))
          .map((el) => { const box = el.getBoundingClientRect(); return `${el.tagName}.${el.className}:${box.width}x${box.height}`; });
        const widthOf = (selector) => root.querySelector(selector)?.getBoundingClientRect().width || 0;
        return { noOverflow: doc.scrollWidth <= innerWidth + 1, textTooSmall, tapTooSmall,
          layout: { header: widthOf(".wbs-header"), toolbar: widthOf(".wbs-toolbar"), menu: widthOf(".wbs-view-menu"), popover: widthOf(".wbs-view-popover"), options: widthOf(".wbs-view-options") } };
      });
    }
    const mobile = await quality(390);
    const desktop = await quality(1280);
    check("390px/1280pxで横スクロールなし", mobile.noOverflow && desktop.noOverflow, JSON.stringify({ mobile, desktop }));
    check("可視文字11px以上・タップ要素44px以上", !mobile.textTooSmall.length && !desktop.textTooSmall.length
      && !mobile.tapTooSmall.length && !desktop.tapTooSmall.length, JSON.stringify({ mobile, desktop }));
    check("pageerror 0", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  if (failures) { console.error(`\n❌ v329 A-1b: ${failures} failure(s)`); process.exit(1); }
  console.log("\n✅ v329 A-1b: all checks passed");
})().catch((error) => { console.error(error); process.exit(1); });
