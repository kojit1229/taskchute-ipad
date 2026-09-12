const assert = require('node:assert/strict');
const { buildReadingView } = require('../src/features/daily-reading.js');
const request = { kind: 'feedback', date: '2026-09-12', referenceDate: '2026-09-11' };
assert.equal(buildReadingView(request, { ok: true, text: 'fixture' }, s => `<p>${s}</p>`).html, '<p>fixture</p>');
for (const result of [{ ok: false, status: 401 }, { ok: false, status: 404 }, { ok: true, text: '  ' }])
  assert.throws(() => buildReadingView(request, result, s => s));
console.log('PASS reading view requires successful, nonempty content');

const { buildDailyReading, readingMark, readingRule } = require('../src/core/daily-reading.js');
const { configureRecurrence, recurrenceMatchesDate, makeRecurrenceInstance } = require('../src/core/recurrence.js');
const DAY = '2026-09-12', AT = `${DAY}T10:00:00`;
configureRecurrence({ parseDate: s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }, nowDateTime: () => AT });
const deps = { today: () => DAY, readingCurrent: () => true, readingMatches: recurrenceMatchesDate, readingInstance: makeRecurrenceInstance };
function fixture() {
  return { settings: { dailyReadingRecordEnabled: true, dailyReadingRoutineIds: { affirmation: 'affirm', visionBoard: 'board' } },
    blocks: [], tasks: [], recurrences: ['affirm', 'board'].map(id => ({ id, category: 'ルーティン', kind: 'daily', anchorDate: DAY,
      streakSince: DAY, title: id, startTime: '09:00', endTime: '09:30' })), habitStreaks: {}, weeklyCommitments: [] };
}
const input = (state, kind = 'affirmation') => ({ kind, date: DAY, referenceDate: kind === 'feedback' ? '2026-09-11' : DAY,
  recordedAt: AT, routineIds: { ...state.settings.dailyReadingRoutineIds }, displayed: true });
{
  const state = fixture(), original = structuredClone(state), result = buildDailyReading(state, input(state), deps), block = result.records[0].after;
  assert.deepEqual(state, original); assert.equal(block.id, `rec_affirm_${DAY}`); assert.equal(block.source, 'daily-reading-auto');
  assert.equal(block.actualStartAt, AT); assert.equal(block.actualEndAt, AT); assert.equal(block.completed, true);
  assert.equal(block.plannedStartAt, `${DAY}T09:00`); assert.equal(block.everStartedAt, AT);
  assert.deepEqual(readingMark(block), { kind: 'affirmation', referenceDate: DAY, recordedAt: AT });
  assert.equal(result.values[0].after.affirm.logs[DAY].doneAt, AT);
  const ai = buildDailyReading(state, input(state, 'feedback'), deps);
  assert.equal(ai.records[0].after.id, `daily-reading-feedback_${DAY}`); assert.equal(ai.values.length, 0);
  for (const name of ['taskId', 'recurrenceGroupId', 'plannedStartAt', 'plannedEndAt']) assert.equal(ai.records[0].after[name], '');
  assert.equal(ai.records[0].after.estimateMin, null); assert.equal(ai.records[0].after.oneTap, true);
  for (const patch of [{ id: 'wrong' }, { date: '2026-09-11' }, { recurrenceGroupId: 'other' },
    { externalRef: 'daily-reading:v1:{}' }, { externalRef: 'daily-reading:v1:' + JSON.stringify({ ...readingMark(block), referenceDate: '2026-09-10' }) }])
    assert.equal(readingMark({ ...block, ...patch }), null);
  const old = { ...makeRecurrenceInstance(state.recurrences[0], DAY), comment: 'keep', taskId: 'keep-task', everStartedAt: `${DAY}T08:00:00` };
  state.blocks = [old]; const kept = buildDailyReading(state, input(state), deps).records[0].after;
  assert.equal(kept.comment, old.comment); assert.equal(kept.taskId, old.taskId); assert.equal(kept.everStartedAt, old.everStartedAt);
}
for (const mutate of [
  s => { s.archivedDates = [DAY]; }, s => { s.recurrences[0].deleted = true; },
  s => { s.recurrences[0].exceptionDates = [DAY]; }, s => { s.recurrences[0].anchorDate = '2026-09-13'; },
  s => { s.recurrences.push({ ...s.recurrences[0] }); }, s => { s.settings.dailyReadingRoutineIds.visionBoard = 'affirm'; },
  s => { s.settings.dailyReadingRoutineIds = {}; }, s => { s.habitStreaks.affirm = { logs: { [DAY]: { doneAt: `${DAY}T09:00:00` } } }; },
  ...[{ actualStartAt: AT }, { actualEndAt: AT }, { completed: true }, { deleted: true }, { source: 'manual' },
    { externalRef: 'other:1' }, { recurrenceGroupId: 'other' }, { date: '2026-09-11' }, { category: '仕事' }]
    .map(patch => s => { s.blocks = [{ ...makeRecurrenceInstance(s.recurrences[0], DAY), ...patch }]; })
]) {
  const state = fixture(); mutate(state); const original = structuredClone(state);
  assert.equal(buildDailyReading(state, input(state), deps).records.length, 0); assert.deepEqual(state, original);
}
{
  const state = fixture(); state.settings.dailyReadingRecordEnabled = false;
  assert.equal(buildDailyReading(state, input(state), deps).discarded, true);
  assert.equal(buildDailyReading(state, { ...input(state), displayed: false }, deps).records.length, 0);
  assert.equal(buildDailyReading(state, { ...input(state), date: '2026-09-11' }, deps).records.length, 0);
  assert.equal(buildDailyReading(state, input(state), { ...deps, readingCurrent: () => false }).records.length, 0);
  assert.equal(readingRule(state, 'affirmation', DAY, deps).id, 'affirm');
}
console.log('PASS candidate identity, attribution, provenance, fixed habit, AI shape, existing values and refusal cases');
const { isDailyReadingBlock, markDailyReadingEdit, excludedReadingRule } = require('../src/core/daily-reading.js');
{
  const state = fixture(), auto = buildDailyReading(state, input(state), deps).records[0].after;
  for (const patch of [{ comment: 'edited' }, { completed: false }, { date: '2026-09-13' }, { plannedStartAt: `${DAY}T08:00` },
    { actualStartAt: `${DAY}T09:30:00` }, { deleted: true }]) {
    const manual = markDailyReadingEdit(auto, { ...auto, ...patch });
    assert.equal(manual.source, 'daily-reading-manual'); assert.equal(manual.externalRef, auto.externalRef);
    assert.equal(readingMark(manual, true).recordedAt.slice(0, 10), DAY);
  }
  assert.equal(markDailyReadingEdit(auto, auto), auto);
  const ordinary = { id: 'normal', source: 'other' }; assert.equal(markDailyReadingEdit(ordinary, ordinary), ordinary);
  assert.equal(isDailyReadingBlock(auto, { settings: {} }), true, 'orphan marker remains noncopyable');
  assert.equal(isDailyReadingBlock({ recurrenceGroupId: 'affirm' }, state), true, 'unmarked existing definition is noncopyable');
  assert.equal(isDailyReadingBlock(ordinary, state), false);
  assert.equal(excludedReadingRule(state, 'affirm', DAY, deps), true); assert.equal(excludedReadingRule(state, 'board', DAY, deps), true);
  assert.equal(excludedReadingRule(state, '__early_bird__', DAY, deps), false);
  assert.equal(excludedReadingRule(state, undefined, DAY, deps), false, 'ordinary ungrouped routines are never excluded');
  assert.equal(excludedReadingRule({ ...state, settings: {} }, undefined, DAY, deps), false, 'unconfigured settings never exclude ungrouped routines');
  state.recurrences[0].exceptionDates = [DAY]; assert.equal(excludedReadingRule(state, 'affirm', DAY, deps), false);
  state.recurrences[0].deleted = true; assert.equal(excludedReadingRule(state, 'board', DAY, deps), false);
}
console.log('PASS explicit provenance, original date on deletion/move, orphan/legacy copy refusal, exact valid exclusion');
