// Order 53 / R2 first unit: review summary, completion persistence, three faces and responsive layout.
// The authorized second unit (measurements / optional prose) is not implemented in this suite.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { setup, nav } = require("./remaining-twelveweek-layout.test");
const { STATE_KEY, setViewportAndWaitForStableLayout } = require("./helpers");
let assertions = 0;
const eq = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
const ok = (value, message) => { assertions++; assert.ok(value, message); };
const week = "2026-08-29", today = "2026-09-05", cycle = "2026-07-11";
const stamp = "2026-08-29T08:00:00";
const item = (id, plannedDate, extra = {}) => ({ id, recordType: "item", weekStart: week, taskId: "t1",
  projectId: "p1", blockId: id, title: `予定${id}`, lane: "cycle", source: "auto", plannedDate, completedAt: "",
  excused: false, deleted: false, createdAt: stamp, updatedAt: stamp, ...extra });
const records = [
  { id: `wcw_${week}`, recordType: "week", weekStart: week, cycleStartDate: cycle, committedAt: stamp, committedVia: "auto",
    deleted: false, createdAt: stamp, updatedAt: stamp },
  item("done", "2026-08-29", { completedAt: stamp }), item("tue", "2026-09-01"),
  item("fri1", "2026-09-04"), item("fri2", "2026-09-04"),
  item("excused", "2026-09-04", { excused: true }), item("deleted", "2026-09-04", { deleted: true }),
  item("life", "2026-09-04", { lane: "life" }), item("otherWeek", today, { weekStart: today })
];
const projects = [{ id: "p1", title: "検定", kind: "normal", status: "active", twelveWeekStartDate: cycle,
  deleted: false, createdAt: stamp, updatedAt: stamp }];
const savedReview = { id: `wr_${week}_p1`, weekStart: week, projectId: "p1", cycleStartDate: cycle,
  aim: "目標を維持", wentWell: "朝にできた", obstacles: "雨", reviewedAt: "", deleted: false,
  createdAt: stamp, updatedAt: stamp };

async function nodeChecks() {
  const store = await import("../src/state/store.js");
  const feature = await import("../src/features/twelve-week.js");
  const { weekStartOfISO } = await import("../src/core/plan.js");
  const { dispatchAction } = await import("../src/ui/actions.js");
  const escapeHTML = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  let clock = today, saves = 0;
  store.setState({ settings: { twelveWeekStartDate: cycle }, projects, tasks: [], tracks: [], blocks: [],
    weeklyCommitments: records, twyWeeklyReviews: [{ ...savedReview }] });
  feature.configureTwelveWeek({ escapeHTML, renderHeader: () => "", todayISO: () => clock,
    weekRange: date => ({ weekStart: weekStartOfISO(date) }), nowDateTime: () => `${clock}T10:00:00`,
    renderTwyTrackReadOnly: () => "", twyTrackIsDone: () => false, candidateBlocksForWeek: () => [],
    render: () => {}, saveAndRender: () => { saves++; } });
  for (const date of ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]) {
    clock = date;
    ok(feature.renderTwelveWeek().includes('data-twy-face="week"'), `${date}: default today face`);
  }
  clock = today;
  const before = JSON.stringify(store.state), html = feature.renderTwelveWeek();
  ok(html.includes('data-twy-face="review"'), "Saturday defaults to review");
  eq(JSON.stringify(store.state), before, "render does not save or mutate state");
  ok(html.includes("① W8を見る"), "previous week number, not current week");
  ok(html.includes("25%"), "score is 1/4; excused/life/deleted/other week excluded");
  ok(html.includes("予定 5回のうち できた 1 · まだ 3 · 点数に含めない 1"));
  ok(html.includes("金曜が各2回"), "weekday bias is calculated from missed items");
  ok(!html.includes("予定life") && !html.includes("予定deleted") && !html.includes("予定otherWeek"));
  store.state.twyWeeklyReviews[0].reviewedAt = today;
  ok(feature.renderTwelveWeek().includes('data-twy-face="plan"'), "reviewed Saturday defaults to plan");
  store.state.twyWeeklyReviews[0].deleted = true;
  ok(feature.renderTwelveWeek().includes('data-twy-face="review"'), "deleted review does not mark finished");
  store.state.twyWeeklyReviews[0] = { ...savedReview, reviewedAt: "2026-09-04" };
  ok(feature.renderTwelveWeek().includes('data-twy-face="review"'), "last week's confirmation does not mark this week");
  for (const [fixture, expected] of [[[], "—"], [[records[0], records[5]], "—"]]) {
    store.state.weeklyCommitments = fixture;
    ok(feature.renderTwelveWeek().includes(`twy-week-score-big">${expected}</div>`), "empty/all-excused is not zero percent");
  }
  store.state.weeklyCommitments = records;
  dispatchAction("twy-review-finish", { target: { dataset: {} } });
  eq(saves, 1, "finish uses existing save path once");
  eq(store.state.twyWeeklyReviews[0], { ...savedReview, reviewedAt: today, updatedAt: `${today}T10:00:00` });
  ok(feature.renderTwelveWeek().includes('data-twy-face="plan"'));
  eq(store.state.weeklyCommitments, records, "finishing never edits commitments");
  store.state.twyWeeklyReviews[0].deleted = true;
  dispatchAction("twy-review-finish", { target: { dataset: {} } });
  eq(store.state.twyWeeklyReviews.length, 1, "finish restores the same tombstoned review id");
  eq(store.state.twyWeeklyReviews[0].deleted, false);
  store.state.projects = [];
  dispatchAction("twy-review-finish", { target: { dataset: {} } });
  eq(store.state.twyWeeklyReviews.find(r => r.projectId === "").reviewedAt, today, "empty goals can finish without a new state key");
}

async function browserChecks() {
  const { page, browser, server } = await setup();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const evidence = process.env.ORDER53_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "twy-review-face-"));
  fs.mkdirSync(evidence, { recursive: true });
  try {
    await page.clock.setFixedTime(new Date(2026, 8, 5, 10));
    await page.evaluate(({ key, records, projects, savedReview, cycle }) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.currentView = "twelveweek";
      s.settings.twelveWeekStartDate = cycle;
      s.projects = [...s.projects.filter(p => ["wish", "other"].includes(p.kind)), ...projects];
      s.tasks = s.tasks.filter(t => t.kind === "other");
      s.blocks = []; s.tracks = []; s.trackMeasurements = [];
      s.weeklyCommitments = records; s.twyWeeklyReviews = [savedReview];
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, records, projects, savedReview, cycle });
    await page.reload();
    await page.waitForSelector('.twy-tower[data-twy-face="review"]');
    const seeded = await page.evaluate(async () => {
      const s = (await import("/src/state/store.js")).state;
      return { records: s.weeklyCommitments, reviews: s.twyWeeklyReviews, date: new Date().toString() };
    });
    eq(seeded.records.map(r => r.id).sort(), records.map(r => r.id).sort(), JSON.stringify(seeded));
    eq(await page.locator(".twy-face-segmented button").evaluateAll(nodes => nodes.map(n => n.firstChild.textContent)),
      ["今週を決める", "今日やる", "ふりかえる"]);
    eq(await page.locator(".twy-face-segmented button:disabled").count(), 0);
    eq(await page.locator(".twy-review-score .twy-week-score-big").innerText(), "25%", JSON.stringify(seeded));
    ok((await page.locator(".twy-review-score").innerText()).includes("予定 5回のうち できた 1 · まだ 3 · 点数に含めない 1"));
    eq(await page.locator(".twy-review-score li").count(), 3);
    eq((await page.locator(".twy-review-score li").allTextContents()).map(s => s.trim()),
      ["火 予定tue検定", "金 予定fri1検定", "金 予定fri2検定"]);
    for (const width of [1280, 390]) {
      await setViewportAndWaitForStableLayout(page, { width, height: 1000 }, ".twy-tower");
      const metrics = await page.locator(".twy-tower").evaluate(root => ({
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        targets: [...root.querySelectorAll("button,summary")].filter(el => el.getClientRects().length)
          .map(el => ({ text: el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })),
        inputs: [...root.querySelectorAll("input,select,textarea")].map(el => parseFloat(getComputedStyle(el).fontSize))
      }));
      eq(metrics.overflow, false, `${width}: no horizontal overflow`);
      eq(metrics.targets.length, 4, `${width}: three chips plus finish`);
      ok(metrics.targets.every(m => m.width >= 44 && m.height >= 44), JSON.stringify(metrics.targets));
      eq(metrics.inputs, [], "first unit has no inputs; 16px inputs are second-unit acceptance");
      await page.screenshot({ path: path.join(evidence, `review-${width}.png`), fullPage: true });
    }
    const snapshot = () => page.evaluate(async () => JSON.parse(JSON.stringify((await import("/src/state/store.js")).state)));
    const before = await snapshot();
    await page.locator('[data-action="twy-review-finish"]').click();
    await page.waitForSelector('.twy-tower[data-twy-face="plan"]');
    const after = await snapshot();
    eq(after.twyWeeklyReviews[0], { ...savedReview, reviewedAt: today, updatedAt: "2026-09-05T10:00:00" });
    for (const key of ["tracks", "trackMeasurements", "weeklyCommitments", "projects", "tasks", "blocks"])
      eq(after[key], before[key], `finish preserves ${key}`);
    await page.waitForFunction(({ key, today }) => JSON.parse(localStorage.getItem(key)).twyWeeklyReviews[0].reviewedAt === today,
      { key: STATE_KEY, today });
    await page.reload();
    await page.waitForSelector('.twy-tower[data-twy-face="plan"]');
    eq(await page.locator(".twy-cycle-fold").getAttribute("open"), null);
    await page.locator(".twy-cycle-fold > summary").click();
    ok(await page.locator(".twy-vision-panel").isVisible(), "old cycle remains reachable inside plan");
    await page.locator('.twy-face-segmented [data-face="review"]').click();
    ok((await page.locator(".twy-review-finish").innerText()).includes("✓ ふりかえり済み"));
    for (const width of [1280, 390]) {
      await setViewportAndWaitForStableLayout(page, { width, height: 1000 }, ".twy-tower");
      await page.screenshot({ path: path.join(evidence, `review-after-${width}.png`), fullPage: true });
    }
    await page.clock.setFixedTime(new Date(2026, 8, 7, 10));
    await page.reload();
    await page.waitForSelector('.twy-tower[data-twy-face="week"]');
    eq(await page.locator('.twy-face-segmented button.active').getAttribute("data-face"), "week");
    eq(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

(async () => {
  await nodeChecks();
  await browserChecks();
  console.log(`PASS twy-review-face: ${assertions} assertions (Order 53 first unit a/b/e/f; c/d deferred)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
