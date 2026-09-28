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
const meta = { id: `wcw_${week}`, recordType: "week", weekStart: week, cycleStartDate: cycle, committedAt: `${week}T10:00:00`, updatedAt: stamp, createdAt: stamp, deleted: false };
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
  ok(html.includes("週 3 回(ルール) · この週の予定 1 件 · あと 2 件"), "n derives from recurring weekdays, not stale perWeek=5");
  ok(html.includes("★ 検定の勉強"));
  eq(JSON.stringify(store.state), before, "render is read-only");
  for (const d of ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]) {
    clock = d; ok(feature.renderTwelveWeek().includes('data-decide-week="2026-09-12"'), `${d} targets next Saturday`);
  }
  clock = "2026-09-12"; ok(feature.renderTwelveWeek().includes('data-decide-week="2026-09-12"'));
  clock = week; store.state.weeklyCommitments = [meta];
  store.state.recurrences = [{ ...rule, updatedAt: `${week}T10:01:00` }];
  ok(feature.renderTwelveWeek().includes("! 確定後に変更あり"), "persisted rule timestamp alone marks changes");
  store.state.recurrences = [{ ...rule }];
  ok(feature.renderTwelveWeek().includes("✓ 確定済み"), "older updates do not mark changes");
  store.state.blocks = [{ id: "b", taskId: task.id, date: week, deleted: true, updatedAt: `${week}T10:01:00` }];
  ok(feature.renderTwelveWeek().includes("! 確定後に変更あり"), "persisted tombstone alone marks changes");
  store.state.blocks = [{ id: "b", taskId: task.id, date: week }];
  store.state.recurrences = []; clock = week;
  ok(feature.renderTwelveWeek().includes("週 5 回 · この週の予定 1 件 · あと 4 件"), "fallback to task plan");
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
      if (sessionStorage.getItem("decide-seeded")) return;
      sessionStorage.setItem("decide-seeded", "1");
      Object.assign(s, { currentView: "twelveweek", selectedDate: meta.weekStart, tasks: [task], projects: [project], recurrences: [rule],
        blocks: [meta.weekStart, "2026-09-08", "2026-09-10"].map(date => ({ id: `seed-${date}`, taskId: task.id, title: task.title, date, recurrenceGroupId: rule.id,
          plannedStartAt: `${date}T07:30`, plannedEndAt: `${date}T08:00`, createdAt: task.createdAt, updatedAt: task.updatedAt, deleted: false })),
        weeklyCommitments: [meta], twyWeeklyReviews: [], tracks: [] });
      s.settings.twelveWeekStartDate = cycle;
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, seed, task, project, rule, meta, cycle });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForSelector('.twy-face-segmented [data-face="plan"]');
    await page.locator('.twy-face-segmented [data-face="plan"]').click();
    let s = await snapshot();
    eq(active(s).map(b => b.date), [week, "2026-09-08", "2026-09-10"], "Tue Thu Sat: three scheduled instances");
    ok((await page.locator(`[data-decide-task="${task.id}"]`).innerText()).includes("週 3 回(ルール) · この週の予定 3 件 · ✓ 足りています"));
    ok((await page.locator(".twy-decide-total").innerText()).includes("3 回 · 約 1.5 時間"));
    ok((await page.locator(".twy-decide-total").innerText()).includes("✓ 確定済み"));
    eq(await page.locator(".twy-cycle-fold").getAttribute("open"), null);
    eq(await page.locator(".twy-tower").evaluate(el => el.lastElementChild.classList.contains("twy-cycle-fold")), true);
    eq(await page.locator(".twy-cycle-fold .twy-plan-grid").count(), 1);
    const aim = page.locator('[data-action="twy-decide-aim"]');
    await aim.fill("過去問を進める"); await aim.dispatchEvent("change");
    eq(await aim.evaluate(el => el === document.activeElement), true, "aim change keeps focus without rerendering");
    s = await snapshot(); eq(s.twyWeeklyReviews.find(r => r.projectId === project.id).aim, "過去問を進める");
    const originalRules = JSON.stringify(s.recurrences), originalInstances = active(s);
    await page.clock.setFixedTime(new Date(2026, 8, 5, 10, 1));
    await openSheet(); await choose([1, 3], "09:00", "week");
    s = await snapshot(); eq(JSON.stringify(s.recurrences), originalRules, "week only never changes rules");
    eq(active(s).map(b => b.date).sort(), ["2026-09-07", "2026-09-09"], JSON.stringify(active(s)));
    ok(active(s).every(b => !b.recurrenceGroupId && b.plannedStartAt.endsWith("T09:00")));
    eq(s.tasks.find(t => t.id === task.id).twyPlan.perWeek, task.twyPlan.perWeek, "week-only preserves perWeek");
    ok((await page.locator(`[data-decide-task="${task.id}"]`).innerText()).includes("週 3 回(ルール) · この週の予定 2 件 · あと 1 件"));
    ok(originalInstances.every(b => s.blocks.some(x => x.id === b.id && x.deleted && x.updatedAt > meta.committedAt)), "week-only deletions retain timestamped tombstones");
    ok((await page.locator(".twy-decide-total").innerText()).includes("! 確定後に変更あり"));
    await page.reload();
    await page.locator('.twy-face-segmented [data-face="plan"]').click();
    ok((await page.locator(".twy-decide-total").innerText()).includes("! 確定後に変更あり"), "saved block updates survive reload");
    await openSheet();
    eq(await page.locator('[data-action="twy-decide-day"][aria-pressed="true"]').evaluateAll(bs => bs.map(b => Number(b.dataset.day)).sort()), [2, 4, 6], "sheet starts with rule days despite one-offs");
    await page.locator('[data-action="modal-close"]').click();
    await page.clock.setFixedTime(new Date(2026, 8, 5, 10, 5));
    await openSheet(); await choose([1], "10:00", "week");
    s = await snapshot(); eq(active(s).length, 1, "repeated edits can decrease generated one-off schedules");
    await openSheet(); await choose([2, 4, 6], "11:00", "always");
    s = await snapshot(); eq(s.recurrences.filter(r => !r.deleted).length, 1);
    eq(s.recurrences[0].days, [2, 4, 6]); eq(s.recurrences[0].startTime, "11:00");
    eq(s.tasks.find(t => t.id === task.id).twyPlan.perWeek, 3);
    eq(active(s).map(b => b.date).sort(), [week, "2026-09-08", "2026-09-10"]);
    ok(active(s).every(b => b.plannedStartAt.endsWith("T11:00")), "target week regenerated at selected time");
    ok(active(s).every(b => b.source !== "twy-decide-week"), "restored occurrences drop the automatic tombstone marker so later user deletions remain protected");
    const beforeReduction = active(s);
    await openSheet(); await choose([4], "11:00", "always");
    s = await snapshot();
    ok(beforeReduction.filter(b => b.date !== "2026-09-10").every(b => s.blocks.some(x => x.id === b.id && x.deleted && x.updatedAt)), "removed rule days retain tombstones");
    eq(active(s).map(b => b.date), ["2026-09-10"]);
    await openSheet(); await choose([2, 4, 6], "11:00", "always");
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
    ok((await page.locator(`[data-decide-task="${task.id}"]`).innerText()).includes("この週の予定 4 件 · 1 件 多い"));
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
    // A missing-date add is non-destructive, including recurrence tombstones.
    await page.evaluate(async () => {
      const s = (await import("/src/state/store.js")).state;
      for (const b of s.blocks) if (b.taskId === "decide-task" && ["2026-09-08", "2026-09-10"].includes(b.date)) b.deleted = true;
    });
    await page.locator('.twy-face-segmented [data-face="plan"]').click();
    const beforeAdd = await snapshot();
    await page.locator('[data-add-missing="true"]').click();
    s = await snapshot(); eq(await page.locator(".twy-decide-sheet").count(), 0);
    eq(s.blocks.filter(b => beforeAdd.blocks.some(old => old.id === b.id)), beforeAdd.blocks, "add preserves every existing block byte for byte");
    const added = s.blocks.filter(b => !beforeAdd.blocks.some(old => old.id === b.id));
    eq(added.map(b => b.date), ["2026-09-08", "2026-09-10"]); ok(added.every(b => !b.recurrenceGroupId));
    eq(s.recurrences, beforeAdd.recurrences); eq(s.tasks, beforeAdd.tasks);
    await openSheet(); await choose([4], "08:00", "always");
    await page.reload(); await page.locator('.twy-face-segmented [data-face="plan"]').click();
    ok((await page.locator(".twy-decide-total").innerText()).includes("! 確定後に変更あり"), "rule changes survive reload");
    for (const anchorDate of ["2026-09-08", "2026-09-20"]) {
      await page.evaluate(async anchorDate => {
        const s = (await import("/src/state/store.js")).state;
        Object.assign(s.recurrences[0], { kind: "monthly", anchorDate }); delete s.recurrences[0].days; s.blocks = [];
      }, anchorDate);
      await page.locator('.twy-face-segmented [data-face="plan"]').click();
      const row = page.locator(`[data-decide-task="${task.id}"]`), text = await row.innerText();
      ok(text.includes(anchorDate.endsWith("08") ? "毎月 8 日 · この週は 1 回" : "毎月 20 日 · この週は 0 回"));
      ok(!text.includes("あと ")); eq(await row.locator('[data-add-missing="true"]').count(), 0);
      ok(!(await page.locator(".twy-decide-total").innerText()).includes("検定の勉強 1 件"));
    }
    await openSheet(); ok((await page.locator(".twy-decide-sheet").innerText()).includes("毎週の繰り返しに置き換えます"));
    await choose([2, 4], "09:00", "always"); s = await snapshot(); eq(s.recurrences[0].kind, "weekly"); eq(s.recurrences[0].days, [2, 4]);
    await page.evaluate(async () => {
      const s = (await import("/src/state/store.js")).state; delete s.recurrences[0].days; s.recurrences[0].anchorDate = ""; s.blocks = [];
    });
    await page.locator('.twy-face-segmented [data-face="plan"]').click();
    ok((await page.locator(`[data-decide-task="${task.id}"]`).innerText()).includes("毎週(曜日未設定) 09:00 → 週 0 回(ルール)"));
    await openSheet(); eq(await page.locator('[data-action="twy-decide-day"][aria-pressed="true"]').count(), 0);
    ok((await page.locator(".twy-decide-sheet").innerText()).includes("毎週の繰り返しに置き換えます"));
    await choose([1, 5], "09:00", "always"); s = await snapshot(); eq(s.recurrences[0].days, [1, 5]);
    // Order 65: real recurrence generation -> persistence -> reload/normalizeState -> edit.
    for (const scope of ["week", "always", "add"]) {
      await page.evaluate(async ({ rule, key }) => {
        const s = (await import("/src/state/store.js")).state;
        s.recurrences = [rule]; s.blocks = [];
        (await import("/src/core/recurrence.js")).maintainRecurrences({ persist: false });
        localStorage.setItem(key, JSON.stringify(s));
      }, { rule, key: STATE_KEY });
      await page.reload();
      await page.locator('.twy-face-segmented [data-face="plan"]').click();
      const reloaded = await snapshot(), oldInstances = active(reloaded);
      eq(oldInstances.map(b => b.date).sort(), [week, "2026-09-08", "2026-09-10"]);
      ok(oldInstances.every(b => b.plannedStartAt === `${b.date}T07:30:00` && b.plannedEndAt === `${b.date}T08:00:00`), "reload actually normalizes both planned times");
      if (scope === "add") {
        await page.evaluate(async () => {
          const s = (await import("/src/state/store.js")).state;
          s.blocks.find(b => !b.deleted && b.date === "2026-09-08").deleted = true;
        });
        await page.locator('.twy-face-segmented [data-face="plan"]').click();
        const before = await snapshot();
        await page.locator('[data-add-missing="true"]').click();
        s = await snapshot();
        eq(s.blocks.filter(b => before.blocks.some(old => old.id === b.id)), before.blocks, "add after reload preserves existing instances and tombstones");
        eq(active(s).map(b => b.date).sort(), [week, "2026-09-08", "2026-09-10"], "add after reload fills only the missing day without duplicates");
        eq(s.recurrences, before.recurrences);
      } else {
        await openSheet(); await choose([1, 3, 5], "21:00", scope);
        s = await snapshot();
        eq(active(s).map(b => b.date).sort(), ["2026-09-07", "2026-09-09", "2026-09-11"], `${scope}: no old weekdays or duplicate instances after reload`);
        ok(oldInstances.every(old => s.blocks.some(b => b.id === old.id && b.deleted && b.source === "twy-decide-week" && b.updatedAt)), `${scope}: old instances remain as tombstones`);
        ok(active(s).every(b => b.plannedStartAt.slice(0, 16) === `${b.date}T21:00`));
        if (scope === "week") eq(s.recurrences, reloaded.recurrences, "week after reload preserves recurrence rules");
        else ok(!s.blocks.some(b => !b.deleted && b.recurrenceGroupId === rule.id && ["2026-09-12", "2026-09-15", "2026-09-17"].includes(b.date)), "ongoing also removes old weekdays in future weeks");
      }
    }
    await page.clock.setFixedTime(new Date(2026, 8, 7, 10));
    await page.locator('.twy-face-segmented [data-face="plan"]').click();
    await page.locator('.twy-decide [data-action="twy-open-commit"]').click();
    s = await snapshot(); eq(s.modal.id, "2026-09-12", "commit sheet opens the displayed next week");
    eq(errors, [], "no browser errors");
  } catch (error) {
    const diagnostic = await page.evaluate(async key => {
      const s = (await import("/src/state/store.js")).state, saved = JSON.parse(localStorage.getItem(key));
      return { timestamps: { meta: s.weeklyCommitments, blocks: s.blocks.filter(b => b.taskId === "decide-task" && b.date >= "2026-09-05" && b.date <= "2026-09-11").map(b => ({date:b.date,updatedAt:b.updatedAt})), rules:s.recurrences }, liveView: s.currentView, savedView: saved.currentView, appView: document.querySelector("#app")?.dataset.view,
        projects: s.projects.map(p => ({ id: p.id, kind: p.kind })), tasks: s.tasks.map(t => ({ id: t.id, kind: t.kind })),
        text: document.body.innerText.slice(0, 1800) };
    }, STATE_KEY);
    console.error("DECIDE DIAGNOSTIC", JSON.stringify({ errors, ...diagnostic }));
    throw error;
  } finally { await browser.close(); server.close(); }
}
(async () => { await nodeChecks(); await browserChecks(); console.log(`twy-decide-face: ${assertions} assertions passed`); })()
  .catch(e => { console.error(e); process.exitCode = 1; });
