// v194: 実行計画(WBS)の兄弟タスクに、従来順を維持する任意の order 順を追加。
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
    await page.waitForFunction((ids) => {
      if (!document.querySelector('#app[data-view="wbs"]')) return false;
      const renderedIds = new Set(Array.from(document.querySelectorAll('.wbs-projects .wbs-task-title[data-id]'), (el) => el.dataset.id));
      return ids.every((id) => renderedIds.has(id));
    }, tasks.map((task) => task.id));
  }

  async function wbsSiblingOrder(ids) {
    return page.locator('.wbs-projects .wbs-task-title[data-id]').evaluateAll((elements, wantedIds) => {
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
    const renderedOrder = await wbsSiblingOrder(orderIds);
    check("3000/1000/2000 の兄弟が 1000→2000→3000 で描画される",
      JSON.stringify(renderedOrder) === JSON.stringify(["order-1000", "order-2000", "order-3000"]),
      JSON.stringify(renderedOrder));

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
    const renderedMixed = await wbsSiblingOrder(mixedIds);
    check("完了側だけ order ありでも未完了→完了の従来順を維持する",
      JSON.stringify(renderedMixed) === JSON.stringify(["mixed-incomplete", "mixed-completed"]),
      JSON.stringify(renderedMixed));

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
    const renderedLegacy = await wbsSiblingOrder(legacyIds);
    check("全員 order なしなら期限、同一期限の createdAt、期限なしの順で描画される",
      JSON.stringify(renderedLegacy) === JSON.stringify([
        "legacy-early-older", "legacy-early-newer", "legacy-later-due", "legacy-no-due"
      ]), JSON.stringify(renderedLegacy));

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
