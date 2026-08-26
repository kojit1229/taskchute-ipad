// v277 検証: PC幅でTOWER系ビューと全Project詳細を拡幅し、各レスポンシブ境界を維持する。
// ui-responsive: 境界マトリクス、幅スイープ、多層overflow、Projectモーダル、横スクロール負例。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  const openView = async (view) => {
    await page.evaluate(({ key, view }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = view;
      state.settings.sidebarCollapsed = false;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, view });
    await page.reload();
    await page.waitForSelector(`#app[data-view="${view}"]`, { state: "attached" });
  };
  const layoutOf = (selector) => page.locator(selector).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      width: box.width,
      maxWidth: getComputedStyle(element).maxWidth,
      pageClient: document.documentElement.clientWidth,
      pageScroll: document.documentElement.scrollWidth
    };
  });
  const columnCountOf = (selector) => page.locator(selector).evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length);
  const overflowOf = (selector) => page.locator(selector).evaluate((root) => {
    const dimensions = (element) => ({ client: element.clientWidth, scroll: element.scrollWidth });
    return {
      documentElement: dimensions(document.documentElement),
      main: dimensions(document.querySelector("#main")),
      root: dimensions(root)
    };
  });

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('[data-action="gate-continue"]', { state: "attached" });
    await passGithubGate(page);

    console.log("[1] 1440pxではTOWER系の各ビューが760pxを超えて主領域を使う");
    const desktopViews = [
      ["more", ".tower-skin.more-tower", "1360px"],
      ["timeline", ".tower-skin.timeline-tower", "1360px"],
      ["wish", ".tower-skin.wish-tower", "1360px"],
      ["journal", ".tower-skin.journal-tower", "1360px"],
      ["instruments", ".instr-view", "1360px"],
      ["iron-log", ".iron", "960px"]
    ];
    for (const [view, selector, maxWidth] of desktopViews) {
      await openView(view);
      const layout = await layoutOf(selector);
      check(`${view}は実効幅760px超`, layout.width > 760, JSON.stringify(layout));
      check(`${view}のPC max-width`, layout.maxWidth === maxWidth, JSON.stringify(layout));
      check(`${view}は1440pxで横スクロールなし`, layout.pageScroll <= layout.pageClient, JSON.stringify(layout));
    }
    await openView("instruments");
    const instrumentColumns = await page.locator(".instr-view").evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean));
    check("計器盤は1280px以上で3列", instrumentColumns.length === 3, JSON.stringify(instrumentColumns));

    console.log("[2] その他グリッドは1440pxで4列・カード幅280px以上");
    await openView("more");
    const moreGrid = await page.locator(".more-tower-grid").evaluate((element) => ({
      columns: getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length,
      cardWidths: [...element.children].map((card) => card.getBoundingClientRect().width)
    }));
    check("その他は4列前後(3〜5列)", moreGrid.columns >= 3 && moreGrid.columns <= 5, JSON.stringify(moreGrid));
    check("その他カードは全て280px以上", moreGrid.cardWidths.length > 0
      && moreGrid.cardWidths.every((width) => width >= 280), JSON.stringify(moreGrid));

    console.log("[3] Todayの既存3面卓は拡幅ルールの対象外");
    await openView("today");
    const today = await page.locator(".today-tower").evaluate((element) => ({
      maxWidth: getComputedStyle(element).maxWidth,
      columns: getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean)
    }));
    check("Todayは既存max-width 1280px", today.maxWidth === "1280px", JSON.stringify(today));
    check("Todayは340px/320px/可変の3面卓", today.columns.length === 3
      && today.columns[0] === "340px" && today.columns[1] === "320px", JSON.stringify(today));

    console.log("[4] 390/768/1024pxでは従来max-width・横スクロールなし");
    const negativeViews = [
      ["more", ".tower-skin.more-tower", { 390: "760px", 768: "760px", 1024: "760px" }],
      ["timeline", ".tower-skin.timeline-tower", { 390: "760px", 768: "760px", 1024: "760px" }],
      ["wish", ".tower-skin.wish-tower", { 390: "760px", 768: "760px", 1024: "760px" }],
      ["journal", ".tower-skin.journal-tower", { 390: "760px", 768: "760px", 1024: "760px" }],
      ["instruments", ".instr-view", { 390: "760px", 768: "1000px", 1024: "1000px" }],
      ["iron-log", ".iron", { 390: "640px", 768: "640px", 1024: "640px" }]
    ];
    for (const width of [390, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [view, selector, expected] of negativeViews) {
        await openView(view);
        const layout = await layoutOf(selector);
        check(`${view} ${width}pxは従来max-width`, layout.maxWidth === expected[width], JSON.stringify(layout));
        check(`${view} ${width}pxは横スクロールなし`, layout.pageScroll <= layout.pageClient, JSON.stringify(layout));
      }
    }

    console.log("[5] 768pxは2列、1024pxは3列のその他グリッドを維持する");
    for (const [width, expectedColumns] of [[768, 2], [1024, 3]]) {
      await page.setViewportSize({ width, height: 900 });
      await openView("more");
      const columns = await columnCountOf(".more-tower-grid");
      check(`その他 ${width}pxは${expectedColumns}列`, columns === expectedColumns, String(columns));
    }

    console.log("[6] 1099/1100pxの拡幅境界と1279/1280pxの計器盤列境界");
    const boundaryCases = [
      [1099, "760px", "1000px", 2],
      [1100, "1360px", "1360px", 2],
      [1279, "1360px", "1360px", 2],
      [1280, "1360px", "1360px", 3]
    ];
    for (const [width, towerMax, instrumentsMax, instrumentColumns] of boundaryCases) {
      await page.setViewportSize({ width, height: 900 });
      await openView("more");
      const tower = await layoutOf(".tower-skin.more-tower");
      check(`その他 ${width}pxのmax-width`, tower.maxWidth === towerMax, JSON.stringify(tower));
      await openView("instruments");
      const instruments = await layoutOf(".instr-view");
      const columns = await columnCountOf(".instr-view");
      check(`計器盤 ${width}pxのmax-width`, instruments.maxWidth === instrumentsMax, JSON.stringify(instruments));
      check(`計器盤 ${width}pxは${instrumentColumns}列`, columns === instrumentColumns, String(columns));
    }

    console.log("[7] 1920pxのその他グリッドはカード280px以上・4〜5列に収まる");
    await page.setViewportSize({ width: 1920, height: 900 });
    await openView("more");
    const wideMoreGrid = await page.locator(".more-tower-grid").evaluate((element) => ({
      columns: getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length,
      cardWidths: [...element.children].map((card) => card.getBoundingClientRect().width)
    }));
    check("1920pxのその他は4〜5列", wideMoreGrid.columns >= 4 && wideMoreGrid.columns <= 5, JSON.stringify(wideMoreGrid));
    check("1920pxのその他カードは全て280px以上", wideMoreGrid.cardWidths.length > 0
      && wideMoreGrid.cardWidths.every((width) => width >= 280), JSON.stringify(wideMoreGrid));

    console.log("[8] 変更対象4ビューはdocument/#main/ビュールートの全層で横overflowなし");
    const overflowViews = [
      ["more", ".tower-skin.more-tower"],
      ["instruments", ".instr-view"],
      ["journal", ".tower-skin.journal-tower"],
      ["iron-log", ".iron"]
    ];
    for (const [view, selector] of overflowViews) {
      await openView(view);
      const layers = await overflowOf(selector);
      for (const [layer, size] of Object.entries(layers)) {
        check(`${view}の${layer}は横overflowなし`, size.scroll <= size.client + 1, JSON.stringify(layers));
      }
    }

    console.log("[9] 12WY Project詳細をPCで広げ、既存2・3列グリッドへ幅を渡す");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      const cycle = "2026-08-22";
      state.currentView = "wbs";
      state.settings.sidebarCollapsed = false;
      state.settings.twelveWeekStartDate = cycle;
      state.projects = [{ id: "p-v277", title: "12WY PC幅確認", kind: "normal", status: "active", priority: "中",
        category: "検証", startDate: cycle, dueDate: "2026-11-13", twelveWeekStartDate: cycle,
        showProgress: false, createdAt: `${cycle}T00:00:00`, updatedAt: `${cycle}T00:00:00`, deleted: false },
      { id: "p-v277-normal", title: "通常Project PC幅確認", kind: "normal", status: "active", priority: "中",
        category: "検証", startDate: cycle, dueDate: "2026-11-13", twelveWeekStartDate: "",
        showProgress: false, createdAt: `${cycle}T00:00:00`, updatedAt: `${cycle}T00:00:00`, deleted: false }];
      state.tasks = [];
      state.tracks = [{ id: "track-v277", ownerType: "project", ownerId: "p-v277", kind: "numeric",
        name: "成果トラック", startDate: cycle, deadline: "2026-11-13", baselineValue: 0, goalValue: 12,
        valueStep: 1, unit: "件", milestones: [], status: "active", createdAt: `${cycle}T00:00:00`,
        updatedAt: `${cycle}T00:00:00`, deleted: false }];
      state.trackMeasurements = [];
      localStorage.setItem(key, JSON.stringify(state));
    }, STATE_KEY);
    await page.reload();
    await page.waitForSelector('[data-action="edit-project"][data-id="p-v277"]', { state: "attached" });
    await page.locator('[data-action="edit-project"][data-id="p-v277"]').first().click();
    await page.waitForSelector(".project-modal [data-twy-track]", { state: "visible" });
    const projectModal = await page.locator(".project-modal").evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      maxWidth: getComputedStyle(element).maxWidth,
      fieldColumns: getComputedStyle(element.querySelector(".field-row")).gridTemplateColumns.trim().split(/\s+/).length,
      track2Columns: getComputedStyle(element.querySelector(".twy-grid2")).gridTemplateColumns.trim().split(/\s+/).length,
      track3Columns: getComputedStyle(element.querySelector(".twy-grid3")).gridTemplateColumns.trim().split(/\s+/).length
    }));
    check("Project詳細は560pxを超え最大960px", projectModal.width > 560 && projectModal.maxWidth === "960px", JSON.stringify(projectModal));
    check("Project詳細の既存2・3列比率を維持", projectModal.fieldColumns === 2
      && projectModal.track2Columns === 2 && projectModal.track3Columns === 3, JSON.stringify(projectModal));
    await page.setViewportSize({ width: 1024, height: 900 });
    const projectBoundary = await layoutOf(".project-modal");
    check("1024pxのProject詳細は従来560px", projectBoundary.maxWidth === "560px"
      && projectBoundary.width <= 560 && projectBoundary.pageScroll <= projectBoundary.pageClient, JSON.stringify(projectBoundary));

    console.log("[10] 非12WYの通常Projectも1440pxで960px、1024pxで560pxに統一する");
    await page.locator(".modal-close").click();
    await page.waitForSelector(".project-modal", { state: "detached" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-action="edit-project"][data-id="p-v277-normal"]').first().click();
    await page.waitForSelector(".project-modal", { state: "visible" });
    const normalProjectModal = await page.locator(".project-modal").evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      maxWidth: getComputedStyle(element).maxWidth,
      is12WY: element.querySelector('[data-modal-field="is12WY"]').checked,
      trackHidden: element.querySelector("[data-twy-track]").hidden
    }));
    check("通常Projectは非12WY", !normalProjectModal.is12WY && normalProjectModal.trackHidden,
      JSON.stringify(normalProjectModal));
    check("通常Projectは1440pxで最大960px", normalProjectModal.width > 560
      && normalProjectModal.maxWidth === "960px", JSON.stringify(normalProjectModal));
    await page.setViewportSize({ width: 1024, height: 900 });
    const normalProjectBoundary = await layoutOf(".project-modal");
    check("通常Projectは1024pxで従来560px", normalProjectBoundary.maxWidth === "560px"
      && normalProjectBoundary.width <= 560 && normalProjectBoundary.pageScroll <= normalProjectBoundary.pageClient,
    JSON.stringify(normalProjectBoundary));
  } catch (error) {
    failures++; console.error(error.stack || error.message);
  } finally {
    try { await browser.close(); } finally { await new Promise((resolve) => server.close(resolve)); }
  }

  console.log(failures === 0 ? "\n✅ v277 ALL PASS" : `\n❌ v277: ${failures}件失敗`);
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
