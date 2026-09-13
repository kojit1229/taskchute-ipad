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
