const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium, launchOptions, startServer, randomPort } = require("./helpers");
const KEY = "taskchute-journal-pwa-state-v1", T = "2026-09-11T12:00:00";
const schedule = (id, extra = {}) => ({ id, title: "fixture", date: "2026-09-11",
  plannedStartAt: "2026-09-11T13:00:00", plannedEndAt: "2026-09-11T14:00:00",
  completed: false, note: "", createdAt: T, updatedAt: T, deleted: false,
  seriesId: "", occurrenceKey: "", overrides: {}, ...extra });
let series;
const rows = [schedule("live"), schedule("tomb", { deleted: true }), null];
let checks = 0;
const pass = name => { checks++; console.log(`PASS ${name}`); };

async function nodeContracts() {
  const load = file => import(pathToFileURL(path.join(__dirname, "../src/", file)).href);
  const { createSeriesMergeCandidate } = await load("core/schedule-series-merge.js");
  const storage = await load("core/schedule-series-storage.js");
  const derive = await load("core/schedule-series-derive.js");
  assert.equal(storage.SCHEDULE_SERIES_ENABLED, false);
  series = createSeriesMergeCandidate({ id: "11111111-1111-4111-8111-111111111111",
    changeId: "22222222-2222-4222-8222-222222222222", anchorDate: "2026-09-11",
    pattern: { frequency: "daily", until: "2026-09-14" },
    defaults: { title: "series", note: "", time: { startTime: "15:00", endTime: "16:00", endDayOffset: 0 } },
    createdAt: T, updatedAt: T }).scheduleSeries[0];
  const child = { id: "schedule_" + series.id + "_2026-09-12", seriesId: series.id, occurrenceKey: "2026-09-12",
    formatVersion: 1, createdAt: T, updatedAt: T, overrides: { note: { value: "exception", updatedAt: T,
      changeId: "33333333-3333-4333-8333-333333333333" } } };
  rows.splice(1, 0, child);
  const good = { scheduleSeries: [series], singleSchedules: rows };
  const merged = storage.mergeStoredScheduleState(good, {});
  assert.deepEqual(merged.scheduleSeries, [series]); assert.deepEqual(merged.singleSchedules, rows);
  assert.ok(storage.scheduleStateEqual(good, merged));
  const badParent = { ...series, id: "broken", formatVersion: 9 };
  const bad = { scheduleSeries: [badParent], singleSchedules: [null] };
  const mixed = storage.mergeStoredScheduleState(good, bad);
  assert.ok(mixed.scheduleSeries.some(p => p.id === "broken"));
  assert.equal(mixed.readable.scheduleSeries.length, 1);
  assert.equal(derive.deriveScheduleSeries(mixed, "2026-09-12").length, 1);
  assert.deepEqual(storage.mergeStoredScheduleState(mixed, bad).singleSchedules, mixed.singleSchedules);
  for (const snapshot of [{ scheduleSeries: null }, { singleSchedules: null }, null]) {
    assert.deepEqual(derive.schedulesWithSeriesForDate(snapshot, "2026-09-12").records, []);
    assert.ok(derive.schedulesWithSeriesForDate(snapshot, "2026-09-12").warnings.length);
  }
  for (const mutate of [p => p.creation.updatedAt = "bad", p => p.creation.value.pattern.until = "2026-02-30",
    p => p.lifecycle.value.deleted = "false", p => p.creation.value.defaults.time.startTime = "25:00"]) {
    const broken = structuredClone(series); mutate(broken);
    const result = storage.mergeStoredScheduleState({ scheduleSeries: [broken], singleSchedules: [child] });
    assert.deepEqual(result.scheduleSeries, [broken]); assert.deepEqual(result.singleSchedules, [child]);
    assert.equal(result.readable.scheduleSeries.length, 0);
  }
  const orphan = storage.mergeStoredScheduleState({ singleSchedules: [child] });
  assert.deepEqual(orphan.singleSchedules, [child]); assert.equal(orphan.readable.singleSchedules.length, 0);
  const recovered = storage.mergeStoredScheduleState(orphan, { scheduleSeries: [series] });
  assert.equal(recovered.readable.singleSchedules.length, 1);
  const conflict = structuredClone(series); conflict.creation.value.defaults.title = "conflict";
  const preserved = storage.mergeStoredScheduleState(good, { scheduleSeries: [conflict] });
  assert.equal(preserved.scheduleSeries.length, 2); assert.equal(preserved.readable.scheduleSeries.length, 0);
  pass("flag off, full payload, invalid isolation, orphan recovery, conflicting change preservation");
  const { runDailyOperation, DAILY_OPERATIONS } = await load("features/daily-operations.js");
  const { commitCandidate } = await load("core/commit.js");
  let model = { singleSchedules: [], scheduleSeries: [], dataModifiedAt: T }, saves = 0, sends = 0, reject = false;
  const memory = new Map(), deps = { get state() { return model; }, now: () => T, commitCandidate,
    newId: () => "44444444-4444-4444-8444-444444444444",
    persist: () => { if (reject) return false; saves++; return true; }, scheduleSync: () => sends++,
    draftStorage: () => ({ getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) }) };
  const values = { anchorDate: "2026-09-11", pattern: { frequency: "daily", until: "2026-09-14" }, defaults: series.creation.value.defaults };
  const input = { kind: "schedule", requestId: "55555555-5555-4555-8555-555555555555", values };
  assert.equal(runDailyOperation("daily-series-add", input, deps).ok, false);
  deps.scheduleSeriesEnabled = true;
  for (const name of ["daily-series-add", "daily-series-convert"])
    assert.throws(() => DAILY_OPERATIONS[name].build(model, {}, deps), error => error.code === "DAILY_OPERATION_INVALID");
  assert.equal(runDailyOperation("daily-series-add", input, deps).ok, true);
  assert.equal(model.scheduleSeries.length, 1); assert.equal(model.singleSchedules.length, 0);
  assert.deepEqual([saves, sends], [1, 1]);
  const first = JSON.stringify(model);
  assert.equal(runDailyOperation("daily-series-add", input, deps).unchanged, true);
  assert.equal(JSON.stringify(model), first); assert.deepEqual([saves, sends], [1, 1]);
  model = { singleSchedules: [schedule("origin")], scheduleSeries: [], dataModifiedAt: T };
  const { contentKey } = await load("core/single-schedule-merge.js");
  const convert = { kind: "schedule", id: "origin", requestId: "66666666-6666-4666-8666-666666666666",
    baseFingerprint: contentKey(model.singleSchedules[0]), values: { pattern: values.pattern } };
  reject = true; const original = JSON.stringify(model);
  assert.equal(runDailyOperation("daily-series-convert", convert, deps).ok, false);
  assert.equal(JSON.stringify(model), original); assert.deepEqual([saves, sends], [1, 1]);
  assert.ok([...memory.values()].some(raw => raw.includes("series_origin")));
  reject = false;
  assert.equal(runDailyOperation("daily-series-convert", convert, deps).ok, true);
  assert.equal(model.scheduleSeries.length, 1); assert.equal(model.singleSchedules.length, 1);
  assert.equal(model.singleSchedules[0].id, "origin"); assert.equal(model.singleSchedules[0].title, undefined);
  const mergedOrigin = storage.mergeStoredScheduleState(model, { singleSchedules: [schedule("origin", { note: "late", updatedAt: "2026-09-11T12:10:00" })] });
  const resend = storage.mergeStoredScheduleState(JSON.parse(JSON.stringify(mergedOrigin)), model);
  assert.ok(storage.scheduleStateEqual(mergedOrigin, resend));
  assert.equal(resend.singleSchedules[0].overrides.note.value, "late");
  assert.equal(resend.singleSchedules.length, 1); assert.deepEqual([saves, sends], [2, 2]);
  pass("registration gate, registry empty-input, parent1 child0, original id, quota rollback/draft/retry, mixed resend");
  for (const seconds of ["00", "01"]) {
    model = { singleSchedules: [schedule("future", { updatedAt: `2026-09-11T12:05:${seconds}` })], scheduleSeries: [], dataModifiedAt: T };
    const requestId = seconds === "00" ? "77777777-7777-4777-8777-777777777777" : "88888888-8888-4888-8888-888888888888";
    const result = runDailyOperation("daily-series-convert", { ...convert, id: "future", requestId, baseFingerprint: contentKey(model.singleSchedules[0]) }, deps);
    assert.equal(result.ok, true); assert.ok(model.dataModifiedAt > model.scheduleSeries[0].updatedAt);
    assert.ok(model.scheduleSeries[0].updatedAt > `2026-09-11T12:05:${seconds}`);
  }
  pass("K clock decision: both 300 and 301 seconds accepted; global floor includes new parent");
  const { occurrenceFingerprint } = await load("features/schedule-occurrence.js");
  const uid = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
  let request = 0;
  const occurrenceInput = (row, extra = {}) => ({ kind: "schedule", id: row.id, seriesId: row.seriesId,
    occurrenceKey: row.occurrenceKey, date: row.date, baseFingerprint: occurrenceFingerprint(model, row), requestId: uid(++request), ...extra });
  model = { scheduleSeries: [structuredClone(series)], singleSchedules: [], dataModifiedAt: T, tasks: [{ id: "task" }], blocks: [{ id: "block" }] };
  const originalParent = JSON.stringify(model.scheduleSeries), unrelated = JSON.stringify([model.tasks, model.blocks]);
  const firstRow = derive.deriveScheduleSeries(model, "2026-09-11")[0], tomorrow = derive.deriveScheduleSeries(model, "2026-09-12")[0];
  const noChange = occurrenceInput(firstRow, { desiredCompleted: false });
  const beforeSaves = saves;
  assert.equal(runDailyOperation("daily-schedule-complete", noChange, deps).unchanged, true);
  assert.equal(saves, beforeSaves); assert.equal(model.singleSchedules.length, 0);
  const complete = occurrenceInput(firstRow, { desiredCompleted: true });
  assert.equal(runDailyOperation("daily-schedule-complete", complete, deps).ok, true);
  assert.deepEqual(Object.keys(model.singleSchedules[0].overrides), ["completion"]);
  assert.equal(derive.deriveScheduleSeries(model, "2026-09-11")[0].completed, true);
  assert.equal(runDailyOperation("daily-schedule-complete", complete, deps).unchanged, true);
  const active = derive.deriveScheduleSeries(model, "2026-09-11")[0];
  const move = occurrenceInput(active, { values: { title: active.title, date: "2026-09-12", startTime: "15:00", endTime: "16:00", endNextDay: false, note: active.note } });
  reject = true; const beforeMove = JSON.stringify(model), failedSaves = saves;
  assert.equal(runDailyOperation("daily-schedule-edit", move, deps).ok, false);
  assert.equal(JSON.stringify(model), beforeMove); assert.equal(saves, failedSaves);
  reject = false;
  assert.equal(runDailyOperation("daily-schedule-edit", move, deps).ok, true);
  assert.equal(model.singleSchedules[0].id, active.id); assert.equal(model.singleSchedules[0].occurrenceKey, "2026-09-11");
  assert.deepEqual(Object.keys(model.singleSchedules[0].overrides).sort(), ["completion", "date", "note", "time", "title"]);
  assert.equal(derive.deriveScheduleSeries(model, "2026-09-11").length, 0);
  const moved = derive.deriveScheduleSeries(model, "2026-09-12"); assert.equal(moved.length, 2);
  assert.deepEqual(moved.find(row => row.id === tomorrow.id), tomorrow);
  const stale = structuredClone(model), movedRow = moved.find(row => row.id === active.id);
  const deletion = occurrenceInput(movedRow, { confirmed: true });
  assert.equal(runDailyOperation("daily-schedule-delete", deletion, deps).ok, true);
  const deleted = storage.mergeStoredScheduleState(model, stale);
  assert.equal(derive.deriveScheduleSeries(deleted, "2026-09-12").length, 1);
  assert.equal(deleted.singleSchedules[0].overrides.lifecycle.value.deleted, true);
  assert.equal(JSON.stringify(model.scheduleSeries), originalParent); assert.equal(JSON.stringify([model.tasks, model.blocks]), unrelated);
  const rowTomorrow = derive.deriveScheduleSeries(model, "2026-09-12")[0];
  const oldEdit = occurrenceInput(rowTomorrow, { desiredCompleted: true });
  model.scheduleSeries[0].extra = "remote unknown-field edit";
  const beforeStale = saves;
  assert.equal(runDailyOperation("daily-schedule-complete", oldEdit, deps).ok, false); assert.equal(saves, beforeStale);
  pass("occurrence no-op0, completion occupies, move preserves fields/id and next day, rollback/retry, delete no resurrection, stale parent");
  const extraParent = { ...series, futureField: { text: "preserve" } }, extraChild = { ...child, futureField: [1, 2] };
  const unknowns = storage.mergeStoredScheduleState(good, { scheduleSeries: [extraParent], singleSchedules: [extraChild] });
  assert.deepEqual(unknowns.scheduleSeries[0].futureField, extraParent.futureField);
  assert.deepEqual(unknowns.singleSchedules.find(r => r?.id === child.id).futureField, extraChild.futureField);
  const conflictingExtra = storage.mergeStoredScheduleState(unknowns, { scheduleSeries: [{ ...series, futureField: { text: "different" } }] });
  assert.equal(conflictingExtra.scheduleSeries.length, 2); assert.equal(conflictingExtra.readable.scheduleSeries.length, 0);
  const originSource = schedule("paired");
  model = { ...createSeriesMergeCandidate({ originSchedule: originSource, pattern: values.pattern, createdAt: T, updatedAt: "2026-09-11T12:00:01", changeId: uid(100) }), dataModifiedAt: T };
  const counterpart = { id: "schedule_series_paired_2026-09-11", seriesId: "series_paired", occurrenceKey: "2026-09-11", formatVersion: 1,
    createdAt: T, updatedAt: "2026-09-11T12:00:03", overrides: { note: { value: "counterpart note", updatedAt: "2026-09-11T12:00:03", changeId: uid(101) } } };
  model.singleSchedules.push(counterpart);
  const representative = derive.deriveScheduleSeries(model, "2026-09-11")[0];
  assert.equal(representative.id, "paired"); assert.equal(representative.note, "counterpart note");
  const originalNote = structuredClone(model.singleSchedules[0].overrides.note);
  assert.equal(runDailyOperation("daily-schedule-complete", occurrenceInput(representative, { desiredCompleted: true }), deps).ok, true);
  assert.deepEqual(model.singleSchedules.find(r => r.id === "paired").overrides.note, originalNote);
  assert.deepEqual(model.singleSchedules.find(r => r.id === counterpart.id), counterpart);
  assert.ok(model.singleSchedules.find(r => r.id === "paired").overrides.completion.updatedAt > counterpart.updatedAt);
  pass("unknown fields preserved or quarantined; representative edits only its explicit field with counterpart clock floor");
}

(async () => {
  await nodeContracts();
  const server = startServer(randomPort()), browser = await chromium.launch(launchOptions());
  async function fixture() {
    const context = await browser.newContext({ timezoneId: "Asia/Tokyo", locale: "ja-JP", serviceWorkers: "block" });
    const page = await context.newPage();
    page.on("console", message => { if (message.type() === "warning" || message.type() === "error") console.log("browser", message.text()); });
    // Install before the pause target so elapsed setup time cannot move it into the past.
    await page.clock.install({ time: new Date(2026, 8, 11, 11) });
    await page.clock.pauseAt(new Date(2026, 8, 11, 12));
    await page.route("https://**", route => route.abort());
    await page.route("**/app.js", route => route.fulfill({ contentType: "text/javascript",
      body: fs.readFileSync(path.join(__dirname, "../app.js"), "utf8")
        + "\nwindow.__b7 = { normalizeState, getState: () => state, setState, render, dailyOperationDeps, sanitizedStateForGitHub, persistLocalNoSchedule, writeBackupSnapshotBeforeLoad, restoreBackup, importData, collectArchivable };" }));
    await page.addInitScript(({ KEY, rows, T, series }) => localStorage.setItem(KEY, JSON.stringify({
      singleSchedules: rows, scheduleSeries: [series], dataModifiedAt: T, blocks: [], tasks: [], projects: [], settings: {}, selectedDate: "2026-09-11"
    })), { KEY, rows, T, series });
    await page.goto(`http://localhost:${server.address().port}`);
    await page.waitForFunction(() => !!window.__b7);
    await page.evaluate(async ({ T, KEY }) => {
      const app = window.__b7, sync = await import("/src/sync/github.js"), state = app.getState();
      window.__sync = sync;
      state.settings.github = { token: "fixture", dataOwner: "fixture", dataRepo: "fixture", branch: "test", path: "app-state.json" };
      state.settings.autoSync = true; state.settings.lastPushedAt = T; state.dataModifiedAt = T;
      state.blocks = []; state.recurrences = [];
      const io = window.__io = { remote: app.sanitizedStateForGitHub(), puts: [], failBackup: false, conflict: false };
      delete io.remote.singleSchedules; delete io.remote.scheduleSeries;
      io.remote.dataModifiedAt = "2026-09-11T12:05:01";
      sync.setLastSyncedSha("before");
      window.confirm = () => true;
      window.fetch = async (url, options = {}) => {
        if (!String(url).startsWith("https://api.github.com/repos/fixture/fixture/")) throw Error("unexpected network " + url);
        const backup = String(url).includes("/backups/");
        if (options.method === "PUT") {
          if (backup && io.failBackup) return { ok: false, status: 403, json: async () => ({ message: "fixture denied" }) };
          if (!backup && io.conflict) { io.conflict = false; return { ok: false, status: 409, json: async () => ({ message: "fixture conflict" }) }; }
          const body = JSON.parse(options.body), bytes = Uint8Array.from(atob(body.content), c => c.charCodeAt(0));
          io.puts.push({ backup, state: JSON.parse(new TextDecoder().decode(bytes)) });
          if (io.putGate && !backup) await io.putGate;
          return { ok: true, json: async () => ({ content: { sha: "sent" } }) };
        }
        if (io.getGate && !backup) await io.getGate;
        const bytes = new TextEncoder().encode(JSON.stringify(backup ? io.backup : io.remote));
        return { ok: true, json: async () => ({ encoding: "base64", sha: "remote",
          content: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")) }) };
      };
      app.persistLocalNoSchedule();
      state.currentView = "today"; app.render();
      io.beforeRaw = localStorage.getItem(KEY);
    }, { T, KEY });
    return { context, page };
  }
  try {
    {
      const { context, page } = await fixture();
      try {
        assert.equal(await page.locator('[data-action="series-register-new"]').count(), 0);
        await page.evaluate(() => { window.__b7.dailyOperationDeps.scheduleSeriesEnabled = true; window.__b7.render(); });
        await page.locator('[data-action="series-register-new"]').first().click();
        for (const [field, value] of Object.entries({ title: "new recurring", date: "2026-09-11", startTime: "17:00", endTime: "18:00", until: "2026-09-14" }))
          await page.locator(`[data-series-field="${field}"]`).fill(value);
        assert.equal(await page.locator('[data-series-field="startTime"]').getAttribute("step"), "300");
        const fonts = await page.locator('[data-series-field]').evaluateAll(items => items.filter(el => el.type !== "checkbox").map(el => parseFloat(getComputedStyle(el).fontSize)));
        assert.ok(fonts.every(size => size >= 16));
        await page.locator('[data-action="series-register-save"]').click();
        assert.equal(await page.evaluate(() => window.__b7.getState().scheduleSeries.length), 2);
        assert.deepEqual(await page.evaluate(() => window.__b7.getState().singleSchedules), rows);
        pass("browser gate and native registration form: parent only");
        const id = await page.evaluate(() => "schedule_" + window.__b7.getState().scheduleSeries.find(p => p.creation.value.defaults.title === "new recurring").id + "_2026-09-11");
        const card = () => page.locator(`[data-schedule-id="${id}"]`).first();
        await card().locator('[data-action="schedule-view-complete"]').click();
        assert.equal(await page.evaluate(id => window.__b7.getState().singleSchedules.find(r => r?.id === id).overrides.completion.value.completed, id), true);
        await card().locator('[data-action="schedule-view-details"]').click();
        await page.locator('[data-occurrence-field="note"]').fill("this occurrence only");
        assert.equal(await page.locator('[data-occurrence-field="startTime"]').getAttribute("step"), "300");
        await page.locator('[data-action="series-occurrence-save"]').click();
        assert.equal(await page.evaluate(id => window.__b7.getState().singleSchedules.find(r => r?.id === id).overrides.note.value, id), "this occurrence only");
        await card().locator('[data-action="schedule-view-details"]').click();
        await page.locator('[data-action="series-occurrence-delete"]').click();
        assert.equal(await card().count(), 0);
        assert.equal(await page.evaluate(id => window.__b7.getState().singleSchedules.find(r => r?.id === id).overrides.lifecycle.value.deleted, id), true);
        pass("browser complete/edit/delete delegated from existing detail, retained tombstone");
      } finally { await context.close(); }
    }
    {
      const { context, page } = await fixture();
      try {
        const capacities = await page.evaluate(async ({ T, KEY, source }) => {
          const { createSeriesMergeCandidate } = await import("/src/core/schedule-series-merge.js");
          const { commitCandidate } = await import("/src/core/commit.js");
          const app = window.__b7, results = [];
          app.getState().settings.autoSync = false; app.persistLocalNoSchedule();
          for (const count of [1, 100, 1000]) {
            const model = app.getState(), before = JSON.stringify(model), raw = localStorage.getItem(KEY);
            const candidate = { scheduleSeries: [], singleSchedules: [] };
            for (let i = 0; i < count; i++) {
              const part = createSeriesMergeCandidate({ originSchedule: { ...source, id: `capacity-${i}`, note: "長文".repeat(512) },
                pattern: { frequency: "daily", until: "2026-09-14" }, createdAt: T, updatedAt: T, changeId: "99999999-9999-4999-8999-999999999999" });
              candidate.scheduleSeries.push(...part.scheduleSeries); candidate.singleSchedules.push(...part.singleSchedules);
            }
            const bytes = new TextEncoder().encode(JSON.stringify({ ...model, ...candidate })).length;
            let attempts = 0;
            const result = commitCandidate({ state: model, now: T, build: state => ({ values: Object.keys(candidate).map(key => ({ kind: null, key, before: state[key], after: candidate[key] })) }),
              persist: state => { attempts++; localStorage.setItem(KEY, JSON.stringify(state)); return true; } });
            results.push({ count, bytes, ok: result.ok, attempts, unchanged: JSON.stringify(model) === before,
              rawUnchanged: localStorage.getItem(KEY) === raw, parents: model.scheduleSeries.length, children: model.singleSchedules.length });
          }
          return results;
        }, { T, KEY, source: schedule("capacity") });
        for (const result of capacities) {
          assert.equal(result.attempts, 1);
          if (result.ok) { assert.equal(result.parents, result.count); assert.equal(result.children, result.count); }
          else { assert.equal(result.unchanged, true); assert.equal(result.rawUnchanged, true); }
        }
        console.log("capacity UTF-8 bytes/localStorage", JSON.stringify(capacities));
        assert.ok(capacities.some(result => !result.ok), "real browser storage quota was exercised");
        pass("browser origin1/100/1000 long-note full payload capacity and atomic rollback");
      } finally { await context.close(); }
    }
    {
      const { context, page } = await fixture();
      try {
        const result = await page.evaluate(async ({ local, remote, KEY }) => {
          const app = window.__b7, io = window.__io, state = app.getState();
          state.scheduleSeries = []; state.singleSchedules = [local];
          io.remote = app.sanitizedStateForGitHub();
          delete io.remote.scheduleSeries;
          io.remote.singleSchedules = [remote];
          io.remote.dataModifiedAt = "2026-09-11T12:05:01";
          let confirms = 0;
          window.confirm = () => { confirms++; return true; };
          app.persistLocalNoSchedule();
          await window.__sync.loadFromGitHub();
          return { confirms, backupPuts: io.puts.filter(put => put.backup).length,
            rows: app.getState().singleSchedules, saved: JSON.parse(localStorage.getItem(KEY)).singleSchedules,
            parents: app.getState().scheduleSeries };
        }, { local: schedule("local-only"), remote: schedule("remote-only"), KEY });
        assert.equal(result.confirms, 0);
        assert.equal(result.backupPuts, 0);
        assert.deepEqual(result.rows, [schedule("local-only"), schedule("remote-only")]);
        assert.deepEqual(result.saved, result.rows);
        assert.deepEqual(result.parents, []);
        pass("flag off ordinary singles manual load: legacy path, no confirm or backup PUT, union persisted");
      } finally { await context.close(); }
    }
    for (const method of ["loadFromGitHub", "runAutoSyncPull", "syncFromGitHubOnStartup", "saveToGitHub", "runAutoSyncPush"]) {
      const { context, page } = await fixture();
      try {
        await page.evaluate(async method => {
          if (method === "runAutoSyncPush") window.__b7.getState().settings.lastPushedAt = "2026-09-11T11:59:00";
          await window.__sync[method]();
        }, method);
        const result = await page.evaluate(({ KEY }) => ({ state: window.__b7.getState(),
          saved: JSON.parse(localStorage.getItem(KEY)), puts: window.__io.puts }), { KEY });
        assert.deepEqual(result.state.singleSchedules, rows, method);
        assert.deepEqual(result.state.scheduleSeries, [series]);
        assert.deepEqual(result.saved.scheduleSeries, [series]);
        assert.deepEqual(result.saved.singleSchedules, rows, "persisted after adoption");
        assert.ok(result.state.dataModifiedAt > "2026-09-11T12:05:01", "remote +301 seconds cannot suppress union resend: "
          + JSON.stringify({ method, stamp: result.state.dataModifiedAt, toast: await page.locator("#toast").textContent() }));
        if (["saveToGitHub", "runAutoSyncPush"].includes(method)) {
          assert.ok(result.puts.some(put => !put.backup), "main PUT occurred");
          for (const put of result.puts) { assert.deepEqual(put.state.singleSchedules, rows); assert.deepEqual(put.state.scheduleSeries, [series]); }
        }
        // Disable the initialization fixture before reload so actual persisted data is read.
        await page.evaluate(() => { window.__b7.getState().settings.autoSync = false; window.__b7.persistLocalNoSchedule(); });
        const raw = await page.evaluate(KEY => localStorage.getItem(KEY), KEY);
        const reloadPage = await context.newPage();
        await reloadPage.route("https://**", route => route.abort());
        await reloadPage.goto(`http://localhost:${server.address().port}`);
        await reloadPage.waitForFunction(async () => !!(await import("/src/state/store.js")).state);
        assert.deepEqual(await reloadPage.evaluate(async () => (await import("/src/state/store.js")).state.singleSchedules), rows);
        assert.deepEqual(JSON.parse(raw).singleSchedules, rows);
        pass(`browser ${method}: legacy missing array, tombstones, future clock, persisted reload`);
      } finally { await context.close(); }
    }
    for (const mode of ["backup-failure", "get-edit", "put-edit", "invalid", "auto-merge", "old-auto-pull", "pending-auto-pull", "conflict-retry", "exports", "restore", "import"]) {
      const { context, page } = await fixture();
      try {
        const result = await page.evaluate(async ({ mode, KEY, extra }) => {
          const app = window.__b7, sync = window.__sync, io = window.__io;
          const before = JSON.stringify(app.getState());
          if (mode === "backup-failure") {
            io.remote.aiScheduleHistory = [{ id: "different" }]; io.failBackup = true;
            await sync.loadFromGitHub();
            return { unchanged: JSON.stringify(app.getState()) === before, raw: localStorage.getItem(KEY) === io.beforeRaw };
          }
          if (mode === "invalid") {
            io.remote.scheduleSeries = null;
            await sync.loadFromGitHub(); await sync.runAutoSyncPush();
            return { unchanged: JSON.stringify(app.getState()) === before, puts: io.puts.length };
          }
          if (mode === "get-edit") {
            io.getGate = new Promise(resolve => { io.releaseGet = resolve; });
            const pulling = sync.loadFromGitHub();
            app.getState().singleSchedules.push(extra); app.persistLocalNoSchedule();
            io.releaseGet(); await pulling;
          }
          if (mode === "put-edit") {
            io.putGate = new Promise(resolve => { io.releasePut = resolve; });
            window.__pendingPut = sync.saveToGitHub();
            return { pending: true };
          }
          if (mode === "auto-merge") {
            io.remote.declarations = [{ id: "other", declaredAt: "2026-09-11T09:00:00" }];
            await sync.autoMergeRemote(app.normalizeState(structuredClone(io.remote)), io.remote.dataModifiedAt, "remote");
          }
          if (mode === "old-auto-pull") { io.remote.dataModifiedAt = "2026-09-11T11:00:00"; await sync.runAutoSyncPull(); }
          if (mode === "pending-auto-pull") { app.getState().settings.lastPushedAt = "2026-09-11T11:00:00"; await sync.runAutoSyncPull(); }
          if (mode === "conflict-retry") {
            io.conflict = true; await sync.saveToGitHub();
            const failedRows = structuredClone(app.getState().singleSchedules), firstPuts = io.puts.filter(put => !put.backup).length;
            await sync.saveToGitHub();
            return { failedRows, firstPuts, sent: io.puts.find(put => !put.backup)?.state.singleSchedules };
          }
          if (mode === "exports") {
            await app.writeBackupSnapshotBeforeLoad();
            return { exported: app.sanitizedStateForGitHub().singleSchedules, backup: io.puts[0].state.singleSchedules,
              archive: app.collectArchivable().byYear, live: app.getState().singleSchedules };
          }
          if (mode === "restore") { io.backup = io.remote; await app.restoreBackup("app-state-2026-09-11.json"); }
          if (mode === "import") {
            app.importData(new File([JSON.stringify(io.remote)], "fixture.json", { type: "application/json" }));
            return { pending: true };
          }
          return { state: app.getState().singleSchedules };
        }, { mode, KEY, extra: schedule("during-get") });
        if (mode === "backup-failure") assert.deepEqual(result, { unchanged: true, raw: true });
        else if (mode === "invalid") assert.deepEqual(result, { unchanged: true, puts: 0 });
        else if (mode === "get-edit") assert.deepEqual(result.state, [schedule("during-get"), ...rows]);
        else if (mode === "conflict-retry") {
          assert.deepEqual(result.failedRows, rows); assert.equal(result.firstPuts, 0); assert.deepEqual(result.sent, rows);
        }
        else if (mode === "put-edit") {
          await page.waitForFunction(() => window.__io.puts.some(put => !put.backup));
          const result = await page.evaluate(async extra => {
            const state = window.__b7.getState(); state.singleSchedules.push(extra); state.dataModifiedAt = "2026-09-11T12:06:00";
            window.__b7.persistLocalNoSchedule(); window.__io.releasePut(); await window.__pendingPut;
            return { stamp: state.dataModifiedAt, pushed: state.settings.lastPushedAt, rows: state.singleSchedules };
          }, schedule("during-put"));
          assert.deepEqual(result.rows, [...rows, schedule("during-put")]); assert.ok(result.stamp > result.pushed);
        } else if (mode === "import") {
          await page.waitForFunction(() => window.__b7.getState().dataModifiedAt > "2026-09-11T12:05:01").catch(async error => {
            console.error("import diagnostic", await page.evaluate(() => ({ stamp: window.__b7.getState().dataModifiedAt,
              toast: document.querySelector("#toast")?.textContent, parents: window.__b7.getState().scheduleSeries })));
            throw error;
          });
          assert.deepEqual(await page.evaluate(() => window.__b7.getState().singleSchedules), rows);
        } else if (mode === "exports") {
          assert.deepEqual(result.exported, rows); assert.deepEqual(result.backup, rows);
          assert.deepEqual(result.live, rows); assert.deepEqual(result.archive, {});
        } else assert.deepEqual(result.state, rows);
        pass(`browser ${mode}`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  console.log(`${checks} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
