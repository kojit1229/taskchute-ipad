const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = file => import(pathToFileURL(path.join(__dirname, '../../src', file)).href);
const uid = n => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, '0')}`;
exports.bulk = async function(pass) {
  const { createSeriesMergeCandidate } = await load('core/schedule-series-merge.js');
  const { runDailyOperation } = await load('features/daily-operations.js');
  const { seriesBulkPreview } = await load('features/schedule-series-bulk.js');
  const { schedulesWithSeriesForDate } = await load('core/schedule-series-derive.js');
  const { commitCandidate } = await load('core/commit.js');
  const T = '2026-09-11T12:00:00';
  const parent = createSeriesMergeCandidate({ id: uid(1), changeId: uid(2), anchorDate: '2026-09-10',
    pattern: { frequency: 'daily', until: '2026-09-14' }, createdAt: T, updatedAt: T,
    defaults: { title: 'before', note: '', time: { startTime: '09:05', endTime: '10:05', endDayOffset: 0 } } }).scheduleSeries[0];
  const child = (date, overrides = {}) => ({ id: `schedule_${parent.id}_${date}`, seriesId: parent.id, occurrenceKey: date,
    formatVersion: 1, createdAt: T, updatedAt: T, overrides });
  const stamp = value => ({ value, updatedAt: T, changeId: uid(3) });
  let state, saves, today = T, request = 10, reject = false;
  const memory = new Map(), deps = { get state() { return state; }, now: () => today, scheduleSeriesEnabled: true,
    commitCandidate, persist: () => { if (reject) return false; saves++; return true; },
    draftStorage: () => ({ getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) }) };
  const reset = () => { state = { scheduleSeries: [structuredClone(parent)], singleSchedules: [], tasks: [{ id: 'task' }], blocks: [{ id: 'block' }], dataModifiedAt: T }; saves = 0; today = T; };
  const make = () => { const input = { kind: 'schedule', seriesId: parent.id, requestId: uid(++request), values: {
    title: 'after', note: 'bulk', startTime: '16:00', endTime: '17:00', endNextDay: false,
    pattern: { frequency: 'daily', until: '2026-09-15' } } }; return { ...input, confirmation: seriesBulkPreview(state, input, deps).fingerprint }; };
  for (const change of ['value', 'add', 'delete', 'move', 'remove', 'parent', 'today']) {
    reset(); state.singleSchedules = [child('2026-09-12', { note: stamp('old') })];
    const input = make(), before = structuredClone(state);
    if (change === 'value') state.singleSchedules[0].overrides.note = stamp('received');
    if (change === 'add') state.singleSchedules.push(child('2026-09-13', { completion: stamp(true) }));
    if (change === 'delete') state.singleSchedules[0].overrides.lifecycle = stamp({ deleted: true });
    if (change === 'move') state.singleSchedules[0].overrides.date = stamp('2026-09-15');
    if (change === 'remove') state.singleSchedules = [];
    if (change === 'parent') state.scheduleSeries[0].creation.value.defaults.note = 'received';
    if (change === 'today') today = '2026-09-12T00:00:00';
    // completion is a structured value, matching the stored contract.
    if (change === 'add') state.singleSchedules[1].overrides.completion.value = { completed: true };
    const received = structuredClone(state);
    assert.equal(runDailyOperation('daily-series-bulk', input, deps).status, 'conflict', change);
    assert.equal(saves, 0); assert.deepEqual(state, received); assert.deepEqual(input.values.title, 'after');
    assert.ok([...memory.values()].some(raw => raw.includes(input.requestId) && raw.includes('after')));
    assert.equal(runDailyOperation('daily-series-bulk', make(), deps).ok, true, change);
    assert.equal(saves, 1); assert.equal(state.scheduleSeries[0].revisions.length, 1);
    assert.deepEqual(state.tasks, before.tasks); assert.deepEqual(state.blocks, before.blocks);
  }
  pass('R2-08: other occurrence value/add/delete/move/remove, parent and day conflict save0; reconfirm save1');
  for (const change of ['deleted-parent', 'invalid-parent']) {
    reset(); const input = make();
    if (change === 'deleted-parent') state.scheduleSeries[0].lifecycle.value.deleted = true;
    else state.scheduleSeries[0].formatVersion = 9;
    const before = structuredClone(state);
    assert.equal(runDailyOperation('daily-series-bulk', input, deps).status, 'conflict');
    assert.equal(saves, 0); assert.deepEqual(state, before);
    assert.ok([...memory.values()].some(raw => raw.includes(input.requestId) && raw.includes('after')));
  }
  reset();
  state.singleSchedules = [child('2026-09-10', { date: stamp('2026-09-15') }),
    child('2026-09-12', { date: stamp('2026-09-15'), note: stamp('old'), completion: stamp({ completed: true }) }),
    child('2026-09-13', { lifecycle: stamp({ deleted: true }) })];
  const input = make(), children = structuredClone(state.singleSchedules);
  today = '2026-09-11T12:00:15';
  state.scheduleSeries.push({ ...structuredClone(parent), id: uid(4) }); state.tasks.push({ id: 'unrelated' });
  reject = true; const before = structuredClone(state);
  assert.equal(runDailyOperation('daily-series-bulk', input, deps).ok, false); assert.deepEqual(state, before); assert.equal(saves, 0);
  reject = false;
  assert.equal(runDailyOperation('daily-series-bulk', input, deps).ok, true); assert.equal(saves, 1);
  assert.equal(runDailyOperation('daily-series-bulk', input, deps).unchanged, true); assert.equal(saves, 1);
  assert.deepEqual(state.singleSchedules, children); assert.equal(state.scheduleSeries.find(p => p.id === uid(4)).revisions.length, 0);
  const rows = schedulesWithSeriesForDate(state, '2026-09-15').records.filter(r => r.seriesId === parent.id);
  assert.equal(rows.find(r => r.occurrenceKey === '2026-09-10').title, 'before');
  assert.equal(rows.find(r => r.occurrenceKey === '2026-09-12').plannedStartAt, '2026-09-15T16:00:00');
  assert.equal(rows.find(r => r.occurrenceKey === '2026-09-12').completed, true);
  assert.equal(schedulesWithSeriesForDate(state, '2026-09-13').records.filter(r => r.seriesId === parent.id).length, 0);
  pass('R2-08: unrelated changes do not conflict, quota rollback/retry/idempotency, moved/past/completed/deleted preserved');
};
exports.bulkBrowser = async function(fixture, pass) {
  const { context, page } = await fixture();
  try {
    await page.evaluate(() => { const app = window.__b7; app.dailyOperationDeps.scheduleSeriesEnabled = true; app.render(); });
    await page.locator('[data-schedule-id^="schedule_"] [data-action="schedule-view-details"]').first().click();
    await page.locator('[data-occurrence-field="note"]').fill('全件の下書き');
    await page.locator('[data-occurrence-form] summary').click();
    await page.locator('[data-action="series-bulk-preview"]').click();
    assert.ok((await page.locator('[data-bulk-impact]').textContent()).includes('未保存の他端末変更'));
    const received = await page.evaluate(async () => {
      const io = window.__io, app = window.__b7;
      io.remote = app.sanitizedStateForGitHub();
      const child = io.remote.singleSchedules.find(r => r?.seriesId);
      child.overrides.note = { value: '他端末の12日', updatedAt: '2026-09-11T12:06:00', changeId: 'eeeeeeee-eeee-4eee-8eee-000000000100' };
      io.remote.dataModifiedAt = '2026-09-11T12:06:00';
      await window.__sync.loadFromGitHub();
      let saves = 0; const persist = app.dailyOperationDeps.persist;
      app.dailyOperationDeps.persist = (...args) => { saves++; return persist(...args); };
      window.__bulkSaves = () => saves;
      return child.id;
    });
    await page.locator('[data-action="series-bulk-save"]').click();
    assert.equal(await page.evaluate(() => window.__bulkSaves()), 0);
    assert.equal(await page.locator('[data-occurrence-field="note"]').inputValue(), '全件の下書き');
    assert.ok((await page.locator('[data-bulk-impact]').textContent()).includes('他端末の12日'));
    assert.equal(await page.evaluate(id => window.__b7.getState().singleSchedules.find(r => r?.id === id).overrides.note.value, received), '他端末の12日');
    await page.locator('[data-action="series-bulk-save"]').click();
    assert.equal(await page.evaluate(() => window.__bulkSaves()), 1);
    assert.equal(await page.evaluate(() => window.__b7.getState().scheduleSeries[0].revisions.length), 1);
    pass('R2-08 browser sync: latest other occurrence and draft remain; conflict save0, explicit reconfirm save1');
  } finally { await context.close(); }
};
exports.timeline = async function(pass) {
  const { createSeriesMergeCandidate } = await load('core/schedule-series-merge.js');
  const { runDailyOperation } = await load('features/daily-operations.js');
  const { occurrenceFingerprint } = await load('features/schedule-occurrence.js');
  const { schedulesWithSeriesForDate } = await load('core/schedule-series-derive.js');
  const { plannedAvailability } = await load('features/daily-gap-placement.js');
  const { commitCandidate } = await load('core/commit.js');
  const date = '2026-09-11', T = date + 'T12:00:00';
  const parent = createSeriesMergeCandidate({ id: uid(200), changeId: uid(201), anchorDate: date,
    pattern: { frequency: 'daily', until: '2026-09-14' }, createdAt: T, updatedAt: T,
    defaults: { title: 'timeline', note: 'retained', time: { startTime: '09:05', endTime: '10:05', endDayOffset: 0 } } }).scheduleSeries[0];
  let model, saves = 0, request = 210;
  const memory = new Map(), deps = { get state() { return model; }, now: () => T, scheduleSeriesEnabled: true, commitCandidate,
    persist: () => { saves++; return true; }, draftStorage: () => ({ getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) }) };
  const reset = () => { model = { selectedDate: date, scheduleSeries: [structuredClone(parent)], singleSchedules: [], blocks: [], tasks: [{ id: 'untouched' }], dataModifiedAt: T }; saves = 0; };
  const row = () => schedulesWithSeriesForDate(model, date).records[0];
  const run = (timeline, delta = 15) => { const item = row(); return runDailyOperation('daily-schedule-edit', { kind: 'schedule', id: item.id,
    seriesId: item.seriesId, occurrenceKey: item.occurrenceKey, date, baseFingerprint: occurrenceFingerprint(model, item), requestId: uid(++request), timeline, delta }, deps); };
  reset(); const side = JSON.stringify([model.tasks, model.blocks]), id = row().id;
  const occupancy = plannedAvailability(model, date, { scheduleSeriesEnabled: true });
  assert.deepEqual(occupancy.intervals.map(r => [r.id, r.start, r.end]), [[id, 545, 605]]);
  assert.equal(run('move').ok, true); assert.equal(row().plannedStartAt, date + 'T09:20:00'); assert.equal(row().id, id);
  assert.equal(saves, 1); assert.deepEqual(Object.keys(model.singleSchedules[0].overrides), ['time']);
  assert.equal(schedulesWithSeriesForDate(model, '2026-09-12').records[0].plannedStartAt, '2026-09-12T09:05:00');
  assert.equal(run('undo').ok, true); assert.equal(row().plannedStartAt, date + 'T09:05:00');
  assert.equal(model.singleSchedules[0].overrides.time.cleared, true);
  assert.deepEqual(plannedAvailability(model, date, { scheduleSeriesEnabled: true }).occupied, occupancy.occupied);
  assert.equal(run('resize').ok, true); assert.equal(row().plannedEndAt, date + 'T10:20:00');
  assert.equal(run('undo').ok, true); assert.equal(row().plannedEndAt, date + 'T10:05:00');
  assert.equal(JSON.stringify([model.tasks, model.blocks]), side);
  for (const change of ['parent', 'child', 'counterpart']) {
    reset();
    if (change === 'counterpart') {
      model = { ...model, ...createSeriesMergeCandidate({ originSchedule: { id: 'origin', title: 'timeline', note: 'retained', date,
        plannedStartAt: date + 'T09:05:00', plannedEndAt: date + 'T10:05:00', completed: false, deleted: false, createdAt: T, updatedAt: T },
        pattern: parent.creation.value.pattern, changeId: uid(++request), createdAt: T, updatedAt: T }) };
    }
    assert.equal(run('move').ok, true);
    const stamp = { value: 'remote', updatedAt: date + 'T12:01:00', changeId: uid(++request) };
    if (change === 'parent') model.scheduleSeries[0].creation.value.defaults.note = 'remote';
    if (change === 'child') model.singleSchedules[0].overrides.note = stamp;
    if (change === 'counterpart') model.singleSchedules.push({ id: 'schedule_series_origin_' + date, seriesId: 'series_origin', occurrenceKey: date,
      formatVersion: 1, createdAt: T, updatedAt: stamp.updatedAt, overrides: { note: stamp } });
    const before = structuredClone(model);
    assert.equal(run('undo').ok, false, change); assert.equal(saves, 1); assert.deepEqual(model, before);
  }
  reset();
  model = { ...model, ...createSeriesMergeCandidate({ originSchedule: { id: 'paired', title: 'paired', note: '', date,
    plannedStartAt: date + 'T09:05:00', plannedEndAt: date + 'T10:05:00', completed: false, deleted: false, createdAt: T, updatedAt: T },
    pattern: parent.creation.value.pattern, changeId: uid(++request), createdAt: T, updatedAt: T }) };
  model.singleSchedules.push({ id: 'schedule_series_paired_' + date, seriesId: 'series_paired', occurrenceKey: date,
    formatVersion: 1, createdAt: T, updatedAt: date + 'T12:01:00', overrides: { time: { value: { startTime: '16:00:00', endTime: '17:00:00', endDayOffset: 0 },
      updatedAt: date + 'T12:01:00', changeId: uid(++request) } } });
  const pairedOccupancy = plannedAvailability(model, date, { scheduleSeriesEnabled: true }).occupied;
  assert.equal(run('move').ok, true); assert.equal(row().plannedStartAt, date + 'T16:15:00');
  assert.equal(run('undo').ok, true); assert.equal(row().plannedStartAt, date + 'T16:00:00');
  assert.deepEqual(plannedAvailability(model, date, { scheduleSeriesEnabled: true }).occupied, pairedOccupancy);
  const revisionId = uid(++request);
  model.scheduleSeries[0].revisions.push({ id: revisionId, changeId: revisionId, updatedAt: date + 'T12:02:00', effectiveFrom: date,
    changes: { title: 'paired', note: '', time: { startTime: '18:00:00', endTime: '19:00:00', endDayOffset: 0 } } });
  assert.equal(run('move').ok, true); assert.equal(row().plannedStartAt, date + 'T18:15:00');
  assert.equal(run('undo').ok, true); assert.equal(row().plannedStartAt, date + 'T18:00:00');
  reset(); model.scheduleSeries[0].creation.value.defaults.time = { startTime: '23:30:00', endTime: '00:00:00', endDayOffset: 1 };
  assert.equal(run('move').ok, false); assert.equal(saves, 0);
  assert.equal(run('resize', -15).ok, true); assert.equal(run('resize', -15).ok, false); assert.equal(saves, 1);
  const before = structuredClone(model); model.selectedDate = '2026-09-12';
  assert.equal(run('undo').ok, false); assert.equal(saves, 1); assert.deepEqual(model.singleSchedules, before.singleSchedules);
  pass('R2-09a: 09:05+15=09:20, same ID/occupancy, only time override/clear, resize, parent/child/counterpart rejection, day/window/minimum');
};
exports.timelineBrowser = async function(fixture, pass) {
  const { context, page } = await fixture();
  try {
    const before = await page.evaluate(() => {
      const app = window.__b7, state = app.getState(); app.dailyOperationDeps.scheduleSeriesEnabled = true;
      state.scheduleSeries[0].creation.value.defaults.time = { startTime: '09:05:00', endTime: '10:05:00', endDayOffset: 0 };
      state.singleSchedules = []; state.blocks = []; app.render();
      return JSON.stringify([state.tasks, state.blocks]);
    });
    await page.locator('.nav-button[data-view="exec"]').click();
    const card = () => page.locator('.timeline [data-schedule-id^="schedule_"]').first();
    const originalId = await card().getAttribute('data-schedule-id');
    const occupied = await page.locator('.timeline-availability').innerText();
    await card().locator('[data-time-action="move"][data-delta="15"]').click();
    assert.equal(await card().getAttribute('data-schedule-id'), originalId);
    assert.match(await card().innerText(), /09:20/);
    await card().locator('[data-time-action="undo"]').click();
    assert.match(await card().innerText(), /09:05/);
    assert.equal(await page.locator('.timeline-availability').innerText(), occupied);
    await card().locator('[data-time-action="resize"][data-delta="15"]').click();
    assert.match(await card().innerText(), /10:20/);
    assert.equal(await page.evaluate(() => JSON.stringify([window.__b7.getState().tasks, window.__b7.getState().blocks])), before);
    pass('R2-09a browser delegated timeline move/undo/resize and availability identity');
  } finally { await context.close(); }
};
exports.report = async function(pass) {
  const { createSeriesMergeCandidate, mergeScheduleSeries } = await load('core/schedule-series-merge.js');
  const { mergeStoredScheduleState } = await load('core/schedule-series-storage.js');
  const { captureReportInput } = await load('features/feedback/report-input.js');
  const { buildReportMarkdown } = await load('features/feedback/report-builder.js');
  const { deriveReportValues } = await load('features/feedback/report-derived.js');
  const date = '2026-09-11', next = '2026-09-12', T = date + 'T12:00:00';
  const origin = { id: 'report-origin', title: '系列 | <b> & 名前', note: '', date, plannedStartAt: date + 'T23:30:00',
    plannedEndAt: next + 'T05:00:00', createdAt: T, updatedAt: T, completed: true, deleted: false };
  const source = { ...createSeriesMergeCandidate({ originSchedule: origin, pattern: { frequency: 'daily', until: next },
    createdAt: T, updatedAt: T, changeId: uid(300) }), journals: { [date]: '本文', [next]: '翌日' }, settings: { morningEnergyLog: {} },
    blocks: [{ id: 'b', title: '実績', date, taskId: 't', completed: true, category: '仕事', plannedStartAt: date + 'T09:00:00',
      plannedEndAt: date + 'T09:30:00', actualStartAt: date + 'T09:00:00', actualEndAt: date + 'T09:00:00' }],
    tasks: [{ id: 't', title: 'Task', status: 'completed' }], projects: [] };
  source.singleSchedules.push({ id: 'schedule_series_report-origin_' + date, seriesId: 'series_report-origin', occurrenceKey: date,
    formatVersion: 1, createdAt: T, updatedAt: T, overrides: { completion: { value: { completed: true }, updatedAt: T, changeId: uid(299) } } });
  const capture = (state, day = date) => captureReportInput(state, day, deriveReportValues, { scheduleSeriesEnabled: true });
  const base = capture({ ...source, singleSchedules: [], scheduleSeries: [] }), baseline = buildReportMarkdown(base), before = structuredClone(source);
  const input = capture(source), report = buildReportMarkdown(input);
  assert.deepEqual(source, before); assert.equal(input.singleSchedules.count, 0);
  assert.deepEqual(input.seriesSchedules.records.map(row => row.id), ['report-origin']);
  assert.equal(input.seriesSchedules.completed, 1);
  assert.equal(report.slice(0, baseline.length), baseline);
  assert.equal((report.match(/系列 \\\| &lt;b&gt; &amp; 名前/g) || []).length, 1);
  assert.equal((report.match(/## 繰り返し予定（別表）/g) || []).length, 1);
  assert.deepEqual(input.actuals, base.actuals); assert.deepEqual(input.derived, base.derived); assert.deepEqual(input.state, base.state);
  assert.equal(input.actuals[0].minutes, 0);
  const tomorrow = capture(source, next);
  assert.equal(tomorrow.seriesSchedules.count, 1); assert.equal(tomorrow.seriesSchedules.excluded.continuation, 1);
  assert.equal(tomorrow.seriesSchedules.records[0].id, 'schedule_series_report-origin_' + next);
  assert.equal(buildReportMarkdown(input), report);
  const moved = structuredClone(source);
  moved.singleSchedules[0].overrides.date = { value: next, updatedAt: next + 'T01:00:00', changeId: uid(301) };
  assert.equal(capture(moved).seriesSchedules.count, 0);
  assert.equal(capture(moved, next).seriesSchedules.records.filter(row => row.id === 'report-origin').length, 1);
  assert.equal(capture({ ...moved, ...mergeStoredScheduleState(moved, { singleSchedules: [origin] }) }).singleSchedules.count, 0,
    'a late legacy origin cannot reappear in the ordinary table on its previous date');
  const union = { ...source, ...mergeScheduleSeries(source, moved) };
  assert.equal(capture(union, next).seriesSchedules.records.filter(row => row.id === 'report-origin').length, 1,
    JSON.stringify({ union, summary: capture(union, next).seriesSchedules }));
  assert.deepEqual(capture(union, next).actuals, capture({ ...union, singleSchedules: [], scheduleSeries: [] }, next).actuals);
  const off = captureReportInput(source, date, deriveReportValues);
  assert.equal(off.seriesSchedules, undefined); assert.equal(buildReportMarkdown(off).includes('## 繰り返し予定'), false);
  const ordinary = { ...origin, id: 'ordinary', title: '単発' };
  const plain = capture({ ...source, singleSchedules: [ordinary], scheduleSeries: [] });
  const mixed = capture({ ...source, singleSchedules: [...source.singleSchedules, ordinary] });
  assert.deepEqual(mixed.singleSchedules, plain.singleSchedules);
  pass('R2-09b: origin/counterpart one row, continuation attribution, moved/synced identity, flag off, Task/actual/body and ordinary table unchanged');
};
exports.reportBrowser = async function(fixture, pass) {
  const { context, page } = await fixture();
  try {
    const result = await page.evaluate(async () => {
      await window.__sync.loadFromGitHub();
      const source = window.__b7.getState(), date = source.selectedDate;
      const { captureReportInput } = await import('/src/features/feedback/report-input.js');
      const { deriveReportValues } = await import('/src/features/feedback/report-derived.js');
      const { buildReportMarkdown } = await import('/src/features/feedback/report-builder.js');
      const before = JSON.stringify(source), capture = value => captureReportInput(value, date, deriveReportValues, { scheduleSeriesEnabled: true });
      const input = capture(source), base = capture({ ...source, singleSchedules: [], scheduleSeries: [] });
      return { input, base, unchanged: JSON.stringify(source) === before, report: buildReportMarkdown(input), baseline: buildReportMarkdown(base) };
    });
    assert.equal(result.unchanged, true); assert.equal(result.input.seriesSchedules.count, 1);
    assert.equal(new Set(result.input.seriesSchedules.records.map(row => row.id)).size, 1);
    assert.deepEqual(result.input.actuals, result.base.actuals); assert.deepEqual(result.input.derived, result.base.derived);
    assert.equal(result.report.slice(0, result.baseline.length), result.baseline);
    pass('R2-09b browser sync to captured report: attributed once, existing body and totals unchanged');
  } finally { await context.close(); }
};
