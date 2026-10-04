const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { fixedClock } = require('./helpers');
const moduleAt = name => import(pathToFileURL(path.resolve(name)).href);

test('212 recurrence: failed expansion restores exact state; retry saves once and remains idempotent', async () => {
  const { createDraftSaveTransaction } = await moduleAt('src/features/draft-save.js');
  const { recurrenceSaveOperation } = await moduleAt('src/features/recurrence-save.js');
  const core = await moduleAt('src/core/recurrence.js');
  const clock = fixedClock(Date.UTC(2026, 8, 13, 1));
  const now = () => new Date(clock()).toISOString().slice(0, 19);
  let state = { blocks: [], recurrences: [{ id: 'r', title: 'habit', kind: 'daily',
    anchorDate: '2026-09-13', exceptionDates: ['2026-09-14'], updatedAt: '2026-09-13T01:05:00' }],
    chainRuns: [], habitPinHistory: {}, archivedDates: [], dataModifiedAt: '2026-09-13T01:05:00' };
  const original = state, serialized = JSON.stringify(state);
  let fail = true, writes = 0, sync = 0;
  const transaction = createDraftSaveTransaction({ getState: () => state, setState: value => { state = value; },
    now, persist: () => { writes++; return !fail; }, schedule: () => sync++, onFailure() {} });
  const run = work => recurrenceSaveOperation.run({ work }, { transaction });
  const date = value => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); };
  core.configureRecurrence({ getState: () => state, mutate: run, mutationActive: () => transaction.active,
    todayISO: () => '2026-09-13', nowDateTime: now, parseDate: date,
    addDays: (value, n) => { const d = date(value); d.setDate(d.getDate() + n); return [d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); },
    RECURRENCE_KEEP_PAST_DAYS: 0, RECURRENCE_FUTURE_DAYS: 2, isTouchedBlock: b => Boolean(b.comment) });
  assert.equal(core.maintainRecurrences(), false);
  assert.equal(state, original);
  assert.equal(JSON.stringify(state), serialized);
  assert.equal(writes, 1); assert.equal(sync, 0);
  fail = false; core.maintainRecurrences();
  assert.deepEqual(state.blocks.map(b => b.date), ['2026-09-13', '2026-09-15']);
  assert.equal(writes, 2); assert.equal(sync, 1);
  const stamp = state.dataModifiedAt;
  core.maintainRecurrences();
  assert.equal(writes, 2); assert.equal(state.dataModifiedAt, stamp);
  run(() => { state.recurrences[0].title = 'edited'; });
  assert.equal(state.recurrences[0].updatedAt, '2026-09-13T01:05:01');
  run(() => { state.recurrences[0].exceptionDates.push('2026-09-16'); });
  assert.equal(state.recurrences[0].updatedAt, '2026-09-13T01:05:02');
});

test('113 B2-69/70: routine save transaction preserves unchanged instances and rebuilds changed rules', async () => {
  const { createDraftSaveTransaction } = await moduleAt('src/features/draft-save.js');
  const { recurrenceSaveOperation } = await moduleAt('src/features/recurrence-save.js');
  const core = await moduleAt('src/core/recurrence.js');
  const routine = await moduleAt('src/features/routine-view.js');
  const day = '2026-10-03', stamp = `${day}T12:00:00`;
  let state = { recurrences: [{ id: 'r', title: 'habit', kind: 'weekly', days: [6, 0], category: 'ルーティン',
    startTime: '07:00:00', endTime: '07:30:00', anchorDate: day, updatedAt: stamp }],
    blocks: [{ id: 'custom', recurrenceGroupId: 'r', date: day, title: 'habit', plannedStartAt: `${day}T07:45:00`, estimateMin: 47, orderIndex: 3 }],
    chainRuns: [], habitPinHistory: {}, archivedDates: [], dataModifiedAt: stamp };
  let removed = 0, maintained = 0, writes = 0;
  const transaction = createDraftSaveTransaction({ getState: () => state, setState: value => { state = value; },
    now: () => stamp, persist: () => { writes++; return true; }, schedule() {}, onFailure() {} });
  const run = work => recurrenceSaveOperation.run({ work }, { transaction });
  core.configureRecurrence({ getState: () => state });
  const values = { title: 'habit', kind: 'weekend', startTime: '07:00', endTime: '07:30', category: 'ルーティン', monthDay: '3' };
  const form = { querySelector: selector => ({ value: values[selector.match(/name="(\w+)"/)[1]] }), querySelectorAll: () => [] };
  const priorDocument = global.document;
  global.document = { querySelector: () => form, querySelectorAll: () => [] };
  routine.configureRoutineView({ getState: () => state, escapeHTML: value => value, todayISO: () => day, nowDateTime: () => stamp,
    runRecurrenceChange: run, removeUntouchedInstances: () => { removed++; state.blocks = []; },
    maintainRecurrences: () => { maintained++; state.blocks.push({ id: 'rebuilt', recurrenceGroupId: 'r' }); },
    saveAndRender() {}, render() {}, showToast: message => assert.fail(message) });
  try {
    const before = structuredClone(state);
    routine.startRoutineEdit('r'); routine.saveRoutine('r');
    assert.deepEqual(state, before, 'no-op includes seconds normalization and unordered weekend days');
    assert.deepEqual([removed, maintained, writes], [0, 0, 0], 'no regeneration or transaction write for unchanged save');
    routine.startRoutineEdit('r'); values.category = ''; routine.saveRoutine('r');
    assert.deepEqual(state, before, 'empty category resolves to existing default without regeneration');
    routine.startRoutineEdit('r'); values.title = 'changed'; routine.saveRoutine('r');
    assert.deepEqual([removed, maintained, writes], [1, 1, 1], 'changed save still rebuilds and persists through transaction');
    assert.equal(state.recurrences[0].title, 'changed');
    assert.equal(state.recurrences[0].category, 'ルーティン');
  } finally {
    routine.cancelRoutineEdit();
    if (priorDocument === undefined) delete global.document; else global.document = priorDocument;
  }
});
