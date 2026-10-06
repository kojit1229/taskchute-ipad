// v443 A-8: WBSの旧手動並び替え契約は題名検索へ移行。Wishの並び順契約は維持。
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
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1300 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  const PROJECT_ID = "project-v194";
  const WISH_PROJECT_ID = "wish-project-v194";
  const WISH_ID = "wish-v194";

  function makeProject(id = PROJECT_ID, kind = "normal") {
    return {
      id, kind, title: kind === "wish" ? "Wish" : "実行計画", category: "", status: "active",
      priority: "中", description: "", dueDate: "", twelveWeekStartDate: "",
      createdAt: "2026-08-06T08:00", updatedAt: "2026-08-06T08:00", deleted: false,
      collapsed: false, showProgress: false
    };
  }

  function makeTask(id, title, overrides = {}) {
    return {
      id, projectId: PROJECT_ID, parentTaskId: "", title, category: "", status: "todo",
      dueDate: "", selfDueOff: true, order: null, description: "", progressNum: 0, progressDen: 10,
      doneCriteria: "", firstStep: "", createdAt: "2026-08-06T09:00",
      updatedAt: "2026-08-06T09:00", deleted: false, collapsed: false,
      ...overrides
    };
  }

  async function seedWbs(parent, children) {
    const tasks = [parent, ...children];
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
    }, { key: STATE_KEY, project: makeProject(), tasks });
    await page.reload();
    await page.locator(`[data-action="wbs-select-project"][data-id="${PROJECT_ID}"]`).click();
    const collapsedSeries = page.locator('[data-work-list="wbs"] [data-kind="series"][aria-expanded="false"]');
    while (await collapsedSeries.count()) await collapsedSeries.first().click();
    await page.waitForFunction((ids) => {
      if (!document.querySelector('#app[data-view="wbs"]')) return false;
      const renderedIds = new Set(Array.from(document.querySelectorAll('.wbs-project-detail .work-list-title[data-id]'), (el) => el.dataset.id));
      return ids.every((id) => renderedIds.has(id));
    }, tasks.map((task) => task.id));
  }

  async function wbsSiblingOrder(ids) {
    return page.locator('.wbs-project-detail .work-list-title[data-id]').evaluateAll((elements, wantedIds) => {
      const wanted = new Set(wantedIds);
      return elements.map((el) => el.dataset.id).filter((id) => wanted.has(id));
    }, ids);
  }

  async function seedWish(children) {
    const wish = makeTask(WISH_ID, "並び順を確認するWish", {
      projectId: WISH_PROJECT_ID, parentTaskId: "", targetYear: null, targetMonth: null,
      lifeArea: "", motivation: "", realized: false, realizedDate: ""
    });
    const tasks = [wish, ...children];
    await page.evaluate(({ key, project, tasks, wishId }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.projects = [project];
      state.tasks = tasks;
      state.blocks = [];
      state.currentView = "wish";
      state.wishViewMode = "list";
      state.wishOpenId = wishId;
      state.wishFilter = { area: "", showRealized: false };
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, project: makeProject(WISH_PROJECT_ID, "wish"), tasks, wishId: WISH_ID });
    await page.reload();
    await page.waitForFunction((ids) => {
      if (!document.querySelector('#app[data-view="wish"] .wish-detail')) return false;
      const renderedIds = new Set(Array.from(document.querySelectorAll('input[data-action="wish-subtask-title"][data-id]'), (el) => el.dataset.id));
      return ids.every((id) => renderedIds.has(id));
    }, children.map((task) => task.id));
  }

  async function wishSubtaskOrder(ids) {
    return page.locator('input[data-action="wish-subtask-title"][data-id]').evaluateAll((elements, wantedIds) => {
      const wanted = new Set(wantedIds);
      return elements.map((el) => el.dataset.id).filter((id) => wanted.has(id));
    }, ids);
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('[data-action="gate-continue"]');
    await passGithubGate(page);

    console.log("[1] 同一親の兄弟サブタスクは order 昇順");
    const orderParent = makeTask("order-parent", "order親");
    const orderedChildren = [
      makeTask("order-3000", "order 3000", { parentTaskId: orderParent.id, order: 3000 }),
      makeTask("order-1000", "order 1000", { parentTaskId: orderParent.id, order: 1000 }),
      makeTask("order-2000", "order 2000", { parentTaskId: orderParent.id, order: 2000 })
    ];
    await seedWbs(orderParent, orderedChildren);
    const orderIds = orderedChildren.map((task) => task.id);
    await page.locator('[data-work-filter="query"]').fill('order 2000');
    const renderedOrder = await wbsSiblingOrder(orderIds);
    check("orderの異なる兄弟も題名検索で該当行だけ残る",
      JSON.stringify(renderedOrder) === JSON.stringify(["order-2000"]), JSON.stringify(renderedOrder));
    check("検索対象の親を文脈として残す", await page.locator('[data-work-key="task:order-parent"]').count() === 1);

    console.log("[2] 片方だけ order がある混在期も未完了が完了済みより上");
    const mixedParent = makeTask("mixed-parent", "混在親");
    const mixedChildren = [
      makeTask("mixed-completed", "orderあり完了", {
        parentTaskId: mixedParent.id, status: "completed", progressNum: 10, order: 1000
      }),
      makeTask("mixed-incomplete", "orderなし未完了", { parentTaskId: mixedParent.id })
    ];
    await seedWbs(mixedParent, mixedChildren);
    const mixedIds = mixedChildren.map((task) => task.id);
    await page.locator('[data-work-filter="query"]').fill('orderあり完了');
    const renderedMixed = await wbsSiblingOrder(mixedIds);
    check("完了表示設定で完了兄弟を題名検索でき未完了兄弟を混ぜない",
      JSON.stringify(renderedMixed) === JSON.stringify(["mixed-completed"]), JSON.stringify(renderedMixed));
    check("検索した完了行は状態selectなしで完了を文字表示", await page.locator('[data-work-key="task:mixed-completed"] select').count() === 0
      && (await page.locator('[data-work-key="task:mixed-completed"] .work-list-meta').textContent()).includes('完了'));

    console.log("[3] order なし兄弟は期限昇順→createdAt昇順の従来順");
    const legacyParent = makeTask("legacy-parent", "従来順親");
    const legacyChildren = [
      makeTask("legacy-later-due", "後の期限", {
        parentTaskId: legacyParent.id, dueDate: "2026-08-20", createdAt: "2026-08-06T07:00"
      }),
      makeTask("legacy-no-due", "期限なし", {
        parentTaskId: legacyParent.id, createdAt: "2026-08-06T06:00"
      }),
      makeTask("legacy-early-newer", "早い期限・後作成", {
        parentTaskId: legacyParent.id, dueDate: "2026-08-10", createdAt: "2026-08-06T10:00"
      }),
      makeTask("legacy-early-older", "早い期限・先作成", {
        parentTaskId: legacyParent.id, dueDate: "2026-08-10", createdAt: "2026-08-06T08:00"
      })
    ];
    await seedWbs(legacyParent, legacyChildren);
    const legacyIds = legacyChildren.map((task) => task.id);
    await page.locator('[data-work-filter="query"]').fill('早い期限');
    const renderedLegacy = await wbsSiblingOrder(legacyIds);
    check("orderなしでも題名検索は同名部分の2兄弟だけ残す",
      JSON.stringify([...renderedLegacy].sort()) === JSON.stringify(["legacy-early-newer", "legacy-early-older"]), JSON.stringify(renderedLegacy));
    await page.locator('[data-action="wbs-select-project"][data-id=""]').click();
    await page.locator(`[data-action="wbs-select-project"][data-id="${PROJECT_ID}"]`).click();
    check("Projectチップ往復で検索語と結果を保持", await page.locator('[data-work-filter="query"]').inputValue() === '早い期限'
      && JSON.stringify(await wbsSiblingOrder(legacyIds)) === JSON.stringify(renderedLegacy));

    console.log("[4] Wishサブタスクは片側期限でcreatedAt、両側orderでorder昇順");
    const wishDueChildren = [
      makeTask("wish-with-due", "期限あり・後作成", {
        projectId: WISH_PROJECT_ID, parentTaskId: WISH_ID, dueDate: "2026-08-10",
        createdAt: "2026-08-06T10:00"
      }),
      makeTask("wish-without-due", "期限なし・先作成", {
        projectId: WISH_PROJECT_ID, parentTaskId: WISH_ID, createdAt: "2026-08-06T08:00"
      })
    ];
    await seedWish(wishDueChildren);
    const wishDueIds = wishDueChildren.map((task) => task.id);
    const renderedWishDue = await wishSubtaskOrder(wishDueIds);
    check("Wishで片方だけ期限ありなら期限有無を優先せずcreatedAt順になる",
      JSON.stringify(renderedWishDue) === JSON.stringify(["wish-without-due", "wish-with-due"]),
      JSON.stringify(renderedWishDue));

    const wishOrderChildren = [
      makeTask("wish-order-3000", "order 3000・未完了", {
        projectId: WISH_PROJECT_ID, parentTaskId: WISH_ID, order: 3000
      }),
      makeTask("wish-order-1000", "order 1000・完了", {
        projectId: WISH_PROJECT_ID, parentTaskId: WISH_ID, status: "completed", progressNum: 10, order: 1000
      })
    ];
    await seedWish(wishOrderChildren);
    const wishOrderIds = wishOrderChildren.map((task) => task.id);
    const renderedWishOrder = await wishSubtaskOrder(wishOrderIds);
    check("Wishで両方に order があれば完了状態よりorder昇順を優先する",
      JSON.stringify(renderedWishOrder) === JSON.stringify(["wish-order-1000", "wish-order-3000"]),
      JSON.stringify(renderedWishOrder));
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((error) => { console.error(error); process.exit(1); });
