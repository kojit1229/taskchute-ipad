// Twelve-week responsive layout: full-width panels, isolated table scrolling and today layout.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium, launchOptions, startServer, randomPort, STATE_KEY, setViewportAndWaitForStableLayout } = require("./helpers");
const widths = [390, 768, 1024, 1280, 1440];
const evidence = process.env.L21_EVIDENCE_DIR || path.join(__dirname, ".artifacts", "remaining-twelveweek-layout");
async function setup() {
  const server = startServer(randomPort());
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", timezoneId: "Asia/Tokyo", locale: "ja-JP" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(2026, 6, 25, 10));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" ? route.continue() : route.fulfill({ status: 404, body: "{}" });
  });
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.waitForFunction(key => localStorage.getItem(key), STATE_KEY);
  await page.evaluate(key => {
    const s = JSON.parse(localStorage.getItem(key));
    Object.assign(s.settings.github, { token: "fixture-token", dataOwner: "fixture-owner", dataRepo: "fixture-repo" });
    s.settings.twelveWeekStartDate = "2026-07-11";
    s.settings.twelveWeekVision = "架空の3年ビジョン";
    s.settings.twelveWeekFocus = "架空の今サイクルの焦点";
    s.settings.towerView = { side: true, journal: true, life: true };
    s.currentView = "today";
    s.selectedDate = "2026-07-25";
    const stamped = { createdAt: "2026-07-11T08:00:00", updatedAt: "2026-07-11T08:00:00", deleted: false };
    s.projects = [{ ...stamped, id: "layout-project", title: "配置試験のプロジェクト", kind: "normal", status: "active", twelveWeekStartDate: "2026-07-11" }];
    s.tasks = [
      { ...stamped, id: "layout-task", projectId: "layout-project", title: "毎週の作業", kind: "normal", status: "todo", selfDueOff: true, twyPlan: { fromWeek: 1, toWeek: 12, perWeek: 2, keystone: true } },
      { ...stamped, id: "layout-no-plan", projectId: "layout-project", title: "目安なしの作業", kind: "normal", status: "todo", selfDueOff: true }
    ];
    s.blocks = []; s.weeklyCommitments = []; s.tracks = [];
    localStorage.setItem(key, JSON.stringify(s));
  }, STATE_KEY);
  await page.reload();
  await page.waitForSelector('[data-action="nav"]', { state: "attached" });
  return { page, browser, server };
}
async function nav(page, view) {
  await page.locator('[data-action="nav"][data-view="' + view + '"]').first().evaluate(el => el.click());
  await page.waitForSelector('#app[data-view="' + view + '"]', { state: "attached" });
}
async function measure(page) {
  return page.locator(".twy-tower").evaluate(root => {
    const metric = el => {
      const r = el.getBoundingClientRect(), c = getComputedStyle(el);
      return { class: el.className, rect: r.toJSON(), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth,
        css: Object.fromEntries(["display", "width", "paddingLeft", "paddingRight", "marginLeft", "marginRight", "overflowX", "gridTemplateColumns"].map(k => [k, c[k]])) };
    };
    return { root: metric(root), children: [...root.children].map(metric),
      document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      wrap: root.querySelector(".twy-plan-grid-wrap") ? metric(root.querySelector(".twy-plan-grid-wrap")) : null };
  });
}
async function todayMetrics(page) {
  return page.locator(".today-tower").evaluate(root => {
    const css = getComputedStyle(root);
    return { display: css.display, columns: css.gridTemplateColumns,
      children: [...root.querySelectorAll(".tower-col-left,.tower-col-center,.tower-col-right")].map(el => {
        const c = getComputedStyle(el), r = el.getBoundingClientRect();
        return { display: c.display, gridArea: c.gridArea, x: r.x, width: r.width };
      }) };
  });
}
async function run() {
  fs.mkdirSync(evidence, { recursive: true });
  const { page, browser, server } = await setup();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const baselineCss = execFileSync("git", ["show", "7723450398e04025946631f35e8f4280842e5a94:styles.css"], { encoding: "utf8", cwd: path.join(__dirname, "..") });
  const results = [];
  try {
    const baseline = new Map();
    await page.route("**/styles.css*", route => route.fulfill({ contentType: "text/css", body: baselineCss }));
    await page.reload(); await nav(page, "today");
    for (const width of widths) {
      await setViewportAndWaitForStableLayout(page, { width, height: 1000 }, ".today-tower");
      baseline.set(width, await todayMetrics(page));
    }
    await page.unroute("**/styles.css*");
    await page.reload();
    for (const width of widths) {
      await nav(page, "today");
      const before = baseline.get(width);
      await setViewportAndWaitForStableLayout(page, { width, height: 1000 }, ".today-tower");
      const after = await todayMetrics(page);
      assert.deepEqual(after, before, width + ": today columns unchanged");
      await nav(page, "twelveweek");
      const faces = [];
      for (const face of ["cycle", "plan"]) {
        await page.locator('[data-action="twy-face-select"][data-face="' + face + '"]').first().click();
        await setViewportAndWaitForStableLayout(page, { width, height: 1000 }, ".twy-tower > *");
        const m = await measure(page);
        faces.push({ face, ...m });
        fs.writeFileSync(path.join(evidence, width + "-" + face + ".json"), JSON.stringify(m, null, 2), "utf8");
        await page.screenshot({ path: path.join(evidence, width + "-" + face + ".png"), fullPage: true });
        assert.ok(m.children.length >= 3);
        for (let i = 0; i < m.children.length - 1; i++)
          assert.ok(m.children[i].rect.bottom <= m.children[i + 1].rect.top + 1, width + "/" + face + ": vertical order " + i);
        const available = m.root.clientWidth - parseFloat(m.root.css.paddingLeft) - parseFloat(m.root.css.paddingRight);
        for (const child of m.children.slice(2))
          assert.ok(Math.abs(child.rect.width + parseFloat(child.css.marginLeft) + parseFloat(child.css.marginRight) - available) <= 2, width + "/" + face + ": full-width body");
        assert.ok(m.document.scrollWidth <= m.document.clientWidth + 1, width + "/" + face + ": no page overflow");
        if (face === "plan") {
          assert.ok(m.wrap.rect.left >= m.root.rect.left && m.wrap.rect.right <= m.root.rect.right);
          if (width <= 768) {
            assert.ok(m.wrap.scrollWidth > m.wrap.clientWidth, width + ": table overflows inside frame");
            assert.ok(["auto", "scroll"].includes(m.wrap.css.overflowX));
          }
          const reached = await page.locator(".twy-plan-grid-wrap").evaluate(el => {
            el.scrollLeft = el.scrollWidth;
            const last = el.querySelector("thead th:last-child").getBoundingClientRect();
            const wrap = el.getBoundingClientRect();
            return { scrollLeft: el.scrollLeft, max: el.scrollWidth - el.clientWidth, lastRight: last.right, right: wrap.right };
          });
          assert.ok(Math.abs(reached.scrollLeft - reached.max) <= 1 && reached.lastRight <= reached.right + 1, width + ": last column reachable");
          faces.at(-1).reached = reached;
        }
      }
      results.push({ width, today: { before, after }, faces });
      console.log("PASS " + width + "px: cycle/plan layout, scrolling, today baseline");
    }
    assert.deepEqual(errors, []);
    console.log("PASS page errors = 0; 5 widths / 10 faces");
  } finally {
    fs.writeFileSync(path.join(evidence, "measurements.json"), JSON.stringify(results, null, 2), "utf8");
    await page.context().close(); await browser.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { setup, nav };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
