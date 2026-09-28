// Orders 60/61, first unit: rows, sheet A, one-week/ongoing schedules and confirmation.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { setup } = require("./remaining-twelveweek-layout.test");
const { STATE_KEY, setViewportAndWaitForStableLayout } = require("./helpers");
let assertions = 0;
const eq = (a, b, message) => { assertions++; assert.deepEqual(a, b, message); };
const ok = (v, message) => { assertions++; assert.ok(v, message); };
const week = "2026-09-05", stamp = `${week}T08:00:00`, cycle = "2026-07-11";
const task = { id: "decide-task", title: "検定の勉強", projectId: "decide-project", status: "todo", kind: "normal", deleted: false,
  selfDueOff: true, twyPlan: { perWeek: 5, fromWeek: 1, toWeek: 12, keystone: true }, createdAt: stamp, updatedAt: stamp };
const project = { id: "decide-project", title: "検定", kind: "normal", status: "active", twelveWeekStartDate: cycle, deleted: false, createdAt: stamp, updatedAt: stamp };
const rule = { id: "decide-rule", taskId: task.id, title: task.title, kind: "weekly", days: [2, 4, 6], anchorDate: week,
  startTime: "07:30", endTime: "08:00", exceptionDates: [], deleted: false, createdAt: stamp, updatedAt: stamp };
const meta = { id: `wcw_${week}`, recordType: "week", weekStart: week, cycleStartDate: cycle, committedAt: stamp, updatedAt: stamp, createdAt: stamp, deleted: false };
async function nodeChecks() {
  const store = await import("../src/state/store.js"), feature = await import("../src/features/twelve-week.js");
  const { dispatchAction } = await import("../src/ui/actions.js"), { weekStartOfISO } = await import("../src/core/plan.js");
  let clock = week;
  store.setState({ settings: { twelveWeekStartDate: cycle }, projects: [project], tasks: [task], recurrences: [rule],
    blocks: [{ id: "b", taskId: task.id, date: week }], weeklyCommitments: [], twyWeeklyReviews: [], tracks: [] });
  feature.configureTwelveWeek({ escapeHTML: s => String(s), renderHeader: () => "", todayISO: () => clock,
    weekRange: d => ({ weekStart: weekStartOfISO(d) }), renderTwyTrackReadOnly: () => "", twyTrackIsDone: () => false,
    render: () => {}, candidateBlocksForWeek: () => [] });
  dispatchAction("twy-face-select", { target: { dataset: { face: "plan" } } });
  const before = JSON.stringify(store.state), html = feature.renderTwelveWeek();
  ok(html.includes("週 3 回 · 予定 1 件 · あと 2 件"), "n derives from recurring weekdays, not stale perWeek=5");
  ok(html.includes("★ 検定の勉強"));
  eq(JSON.stringify(store.state), before, "render is read-only");
  for (const d of ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]) {
    clock = d; ok(feature.renderTwelveWeek().includes('data-decide-week="2026-09-12"'), `${d} targets next Saturday`);
  }
  clock = "2026-09-12"; ok(feature.renderTwelveWeek().includes('data-decide-week="2026-09-12"'));
  store.state.recurrences = []; clock = week;
  ok(feature.renderTwelveWeek().includes("週 5 回 · 予定 1 件 · あと 4 件"), "fallback to task plan");
}
async function browserChecks() {
  const initial = await setup(), { browser, server } = initial, errors = [];
  const seed = await initial.page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  await initial.page.close();
  const context = await browser.newContext({ serviceWorkers: "block", timezoneId: "Asia/Tokyo", locale: "ja-JP" });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1"
    ? route.continue() : route.fulfill({ status: 404, body: "{}" }));
  const evidence = process.env.ORDER61_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "twy-decide-"));
  fs.mkdirSync(evidence, { recursive: true });
  const snapshot = () => page.evaluate(async () => JSON.parse(JSON.stringify((await import("/src/state/store.js")).state)));
  const active = s => s.blocks.filter(b => !b.deleted && b.taskId === task.id && b.date >= week && b.date <= "2026-09-11");
  async function openSheet() { await page.locator(`[data-decide-task="${task.id}"] [data-action="twy-decide-when"]`).first().click(); }
  async function choose(days, time, scope) {
    for (const d of [0, 1, 2, 3, 4, 5, 6]) {
      const b = page.locator(`[data-action="twy-decide-day"][data-day="${d}"]`);
      if ((await b.getAttribute("aria-pressed") === "true") !== days.includes(d)) await b.click();
    }
    await page.locator('[data-modal-field="time"]').fill(time);
    await page.locator('[data-modal-field="scope"]').selectOption(scope);
    await page.locator('[data-action="twy-decide-save"]').click();
    await page.waitForSelector(".twy-decide-sheet", { state: "detached" });
  }
  try {
    await page.clock.setFixedTime(new Date(2026, 8, 5, 10));
    await page.addInitScript(({ key, seed: s, task, project, rule, meta, cycle }) => {
      Object.assign(s, { currentView: "twelveweek", selectedDate: meta.weekStart, tasks: [task], projects: [project], recurrences: [rule], blocks: [],
        weeklyCommitments: [meta], twyWeeklyReviews: [], tracks: [] });
      s.settings.twelveWeekStartDate = cycle;
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, seed, task, project, rule, meta, cycle });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForSelector('.twy-face-segmented [data-face="plan"]');
    await page.locator('.twy-face-segmented [data-face="plan"]').click();
    let s = await snapshot();
    eq(active(s).map(b => b.date), [week, "2026-09-08", "2026-09-10"], "Tue Thu Sat: three scheduled instances");
    ok((await page.locator(`[data-decide-task="${task.id}"]`).innerText()).includes("週 3 回 · 予定 3 件 · ✓ 足りています"));
    ok((await page.locator(".twy-decide-total").innerText()).includes("3 回 · 約 1.5 時間"));
    ok((await page.locator(".twy-decide-total").innerText()).includes("✓ 確定済み"));
    eq(await page.locator(".twy-cycle-fold").getAttribute("open"), null);
    eq(await page.locator(".twy-tower").evaluate(el => el.lastElementChild.classList.contains("twy-cycle-fold")), true);
    eq(await page.locator(".twy-cycle-fold .twy-plan-grid").count(), 1);
    const aim = page.locator('[data-action="twy-decide-aim"]');
    await aim.fill("過去問を進める"); await aim.dispatchEvent("change");
    eq(await aim.evaluate(el => el === document.activeElement), true, "aim change keeps focus without rerendering");
    s = await snapshot(); eq(s.twyWeeklyReviews.find(r => r.projectId === project.id).aim, "過去問を進める");
    const originalRules = JSON.stringify(s.recurrences);
    await openSheet(); await choose([1, 3], "09:00", "week");
    s = await snapshot(); eq(JSON.stringify(s.recurrences), originalRules, "week only never changes rules");
    eq(active(s).map(b => b.date).sort(), ["2026-09-07", "2026-09-09"], JSON.stringify(active(s)));
    ok(active(s).every(b => !b.recurrenceGroupId && b.plannedStartAt.endsWith("T09:00")));
    eq(s.tasks.find(t => t.id === task.id).twyPlan.perWeek, 2);
    ok((await page.locator(".twy-decide-total").innerText()).includes("! 確定後に変更あり"));
    await page.clock.setFixedTime(new Date(2026, 8, 5, 10, 5));
    await openSheet(); await choose([1], "10:00", "week");
    s = await snapshot(); eq(active(s).length, 1, "repeated edits can decrease generated one-off schedules");
    await openSheet(); await choose([2, 4, 6], "11:00", "always");
    s = await snapshot(); eq(s.recurrences.filter(r => !r.deleted).length, 1);
    eq(s.recurrences[0].days, [2, 4, 6]); eq(s.recurrences[0].startTime, "11:00");
    eq(s.tasks.find(t => t.id === task.id).twyPlan.perWeek, 3);
    eq(active(s).map(b => b.date).sort(), [week, "2026-09-08", "2026-09-10"]);
    ok(active(s).every(b => b.plannedStartAt.endsWith("T11:00")), "target week regenerated at selected time");
    for (const [days, kind] of [[[0, 1, 2, 3, 4, 5, 6], "daily"], [[1, 2, 3, 4, 5], "weekdays"]]) {
      await openSheet(); await choose(days, "12:00", "always"); s = await snapshot();
      eq(s.recurrences[0].kind, kind); eq(Object.hasOwn(s.recurrences[0], "days"), false); eq(active(s).length, days.length);
    }
    // Preserving an edited instance must not block changing untouched instances.
    await page.evaluate(async () => {
      const s = (await import("/src/state/store.js")).state;
      const b = s.blocks.find(b => !b.deleted && b.date === "2026-09-07" && b.taskId === "decide-task");
      b.comment = "残す実績"; b.actualStartAt = "2026-09-07T12:00";
    });
    await openSheet(); await choose([2, 4, 6], "13:00", "always");
    s = await snapshot(); eq(active(s).filter(b => b.comment === "残す実績").length, 1); eq(active(s).length, 4);
    for (const width of [1280, 390]) {
      await setViewportAndWaitForStableLayout(page, { width, height: 1000 }, ".twy-tower");
      const metrics = await page.locator(".twy-tower").evaluate(root => ({
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        buttons: [...root.querySelectorAll("button,summary")].filter(el => el.getBoundingClientRect().height > 0)
          .map(el => ({ text: el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })),
        inputs: [...root.querySelectorAll(".twy-decide input")].map(el => parseFloat(getComputedStyle(el).fontSize))
      }));
      eq(metrics.overflow, false); ok(metrics.buttons.every(b => b.width >= 44 && b.height >= 44), JSON.stringify(metrics));
      ok(metrics.inputs.length > 0 && metrics.inputs.every(n => n >= 16));
      await page.screenshot({ path: path.join(evidence, `decide-${width}.png`), fullPage: true });
      await openSheet();
      await page.locator(".twy-decide-sheet").evaluate(async () => { await Promise.all(document.getAnimations().map(a => a.finished)); });
      eq(await page.locator('[data-modal-field="time"]').getAttribute("type"), "time");
      eq(await page.locator('[data-modal-field="time"]').getAttribute("step"), "300");
      const sheetMetrics = await page.locator(".twy-decide-sheet").evaluate(root => ({
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        buttons: [...root.querySelectorAll("button")].map(el => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height })),
        fonts: [...root.querySelectorAll("input,select")].map(el => parseFloat(getComputedStyle(el).fontSize))
      }));
      eq(sheetMetrics.overflow, false); ok(sheetMetrics.buttons.every(b => b.w >= 44 && b.h >= 44), JSON.stringify(sheetMetrics)); ok(sheetMetrics.fonts.every(n => n >= 16), JSON.stringify(sheetMetrics));
      await page.screenshot({ path: path.join(evidence, `sheet-when-${width}.png`), fullPage: true });
      await page.locator('[data-action="modal-close"]').click();
    }
    await page.evaluate(async () => {
      const s = (await import("/src/state/store.js")).state;
      for (let i = 0; i < 6; i++) s.blocks.push({ id: `crowd-${i}`, taskId: "decide-task", date: "2026-09-05", plannedStartAt: "2026-09-05T14:00", plannedEndAt: "2026-09-05T14:30" });
    });
    await page.locator('.twy-face-segmented [data-face="plan"]').click();
    ok((await page.locator(".twy-decide-total").innerText()).includes("5 回を超える日があります(土)"));
    await page.evaluate(async () => {
      const s = (await import("/src/state/store.js")).state; s.recurrences = []; s.blocks = [];
      s.tasks.find(t => t.id === "decide-task").twyPlan.perWeek = 1;
    });
    await openSheet(); await choose([2, 4, 6], "08:00", "always");
    s = await snapshot(); eq(s.recurrences.length, 1, "createRecurrenceRule path for task without rule");
    eq(s.recurrences[0].kind, "weekly"); eq(s.recurrences[0].days, [2, 4, 6]); eq(s.recurrences[0].endTime, "08:30");
    eq(s.tasks.find(t => t.id === task.id).twyPlan.perWeek, 3, "new-rule transaction updates the live task plan");
    eq(active(s).length, 3); eq(s.weeklyCommitments.find(r => r.id === meta.id).committedAt, meta.committedAt, "schedule changes do not rewrite confirmation");
    await page.clock.setFixedTime(new Date(2026, 8, 7, 10));
    await page.locator('.twy-face-segmented [data-face="plan"]').click();
    await page.locator('.twy-decide [data-action="twy-open-commit"]').click();
    s = await snapshot(); eq(s.modal.id, "2026-09-12", "commit sheet opens the displayed next week");
    eq(errors, [], "no browser errors");
  } catch (error) {
    const diagnostic = await page.evaluate(async key => {
      const s = (await import("/src/state/store.js")).state, saved = JSON.parse(localStorage.getItem(key));
      return { liveView: s.currentView, savedView: saved.currentView, appView: document.querySelector("#app")?.dataset.view,
        projects: s.projects.map(p => ({ id: p.id, kind: p.kind })), tasks: s.tasks.map(t => ({ id: t.id, kind: t.kind })),
        text: document.body.innerText.slice(0, 1800) };
    }, STATE_KEY);
    console.error("DECIDE DIAGNOSTIC", JSON.stringify({ errors, ...diagnostic }));
    throw error;
  } finally { await browser.close(); server.close(); }
}
(async () => { await nodeChecks(); await browserChecks(); console.log(`twy-decide-face: ${assertions} assertions passed`); })()
  .catch(e => { console.error(e); process.exitCode = 1; });
