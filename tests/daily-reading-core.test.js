const assert = require('node:assert/strict');
const { buildReadingView } = require('../src/features/daily-reading.js');
const request = { kind: 'feedback', date: '2026-09-12', referenceDate: '2026-09-11' };
assert.equal(buildReadingView(request, { ok: true, text: 'fixture' }, s => `<p>${s}</p>`).html, '<p>fixture</p>');
for (const result of [{ ok: false, status: 401 }, { ok: false, status: 404 }, { ok: true, text: '  ' }])
  assert.throws(() => buildReadingView(request, result, s => s));
console.log('PASS reading view requires successful, nonempty content');
for (const [status, message] of [[404, '昨日の結果はまだありません'], [401, '接続状態を確認してください'], [500, '取得できませんでした／再試行']])
  assert.throws(() => buildReadingView(request, { ok: false, status }, s => s), { message });

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
  for (const date of ['', undefined]) {
    const state = fixture(), block = { ...makeRecurrenceInstance(state.recurrences[0], DAY), date };
    state.blocks = [block]; const original = structuredClone(state);
    assert.equal(buildDailyReading(state, input(state), deps).records.length, 0);
    assert.deepEqual(state, original);
  }
  console.log('PASS fixSB2b4 empty attribution preserves existing Block');
}
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

// S3-12: report capture must retain historical provenance independently of current settings.
{
  const { captureReportInput } = require('../src/features/feedback/report-input.js');
  const { buildReportMarkdown } = require('../src/features/feedback/report-builder.js');
  const { deriveReportValues } = require('../src/features/feedback/report-derived.js');
  const { routineRate } = require('../src/core/recurrence.js');
  const { buildDailyReport, REPORT_PENDING } = require('../src/core/daily-report.js');
  const state = fixture();
  const auto = buildDailyReading(state, input(state), deps).records[0].after;
  const ai = buildDailyReading(state, input(state, 'feedback'), deps).records[0].after;
  Object.assign(state, { projects: [], reports: {}, journals: { [DAY]: '架空の本文' }, singleSchedules: [] });
  state.settings = { dailyReadingRecordEnabled: false, dailyReadingRoutineIds: {} };
  const capture = () => captureReportInput(state, DAY, deriveReportValues);
  const scenarios = [
    [auto, 0], [{ ...auto, plannedStartAt: '', plannedEndAt: '' }, 0], [ai, 0],
    [{ ...auto, source: 'daily-reading-manual', actualEndAt: DAY + 'T10:12:00' }, 12],
    [{ ...auto, source: 'daily-reading-manual' }, 0],
    [{ ...auto, source: '', externalRef: '' }, 30],
  ];
  for (const [block, minutes] of scenarios) {
    state.blocks = [block]; const snapshot = structuredClone(state), captured = capture();
    assert.equal(captured.blocks[0].externalRef, block.externalRef);
    const markdown = buildReportMarkdown(captured), duration = minutes ? '0h' + minutes + 'm' : '0h';
    assert(markdown.includes('| 時間実行 | ' + duration + ' /'), markdown);
    assert(markdown.includes('- ルーティン: ' + duration), markdown);
    assert.equal(captured.actuals[0].minutes, block.source ? minutes : 0);
    assert.deepEqual(state, snapshot);
    const capturedMark = captured.blocks[0].externalRef;
    block.externalRef = 'edited-after-capture';
    assert.equal(captured.blocks[0].externalRef, capturedMark);
    block.externalRef = capturedMark;
  }
  state.blocks = [{ ...ai, oneTap: false }, auto];
  assert.deepEqual(routineRate(state.blocks, state.recurrences), { done: 1, total: 1, pct: 100 });
  assert.deepEqual(capture().derived.rateRoutine, { done: 1, total: 1, pct: 100 });
  state.recurrences[0].protection = true;
  assert.deepEqual(capture().derived.rateRoutine, { done: 0, total: 0, pct: 0 });
  for (const patch of [{ externalRef: 42 }, { externalRef: 'daily-reading:v1:{}' },
    { actualEndAt: DAY + 'T25:00:00' }, { actualStartAt: DAY + 'T11:00:00' },
    { actualEndAt: DAY + 'T10:12:00' }, { actualStartAt: '', actualEndAt: '' }]) {
    state.blocks = [{ ...auto, ...patch }];
    assert.throws(capture, /閲覧記録|invalid_report_field/);
  }
  state.blocks = [{ ...auto, source: 'daily-reading-manual', completed: false, actualEndAt: '' }];
  assert.equal(capture().actuals.length, 0);
  assert(buildReportMarkdown(capture()).includes('| 時間実行 | 0h /'));
  state.blocks[0].actualEndAt = DAY + 'T10:12:00';
  assert.equal(capture().actuals[0].minutes, 12, 'ended incomplete remains an actual under stage 2');
  state.blocks = [auto]; const saved = structuredClone(state.blocks);
  const failed = buildDailyReport(state, { reportDate: DAY }, { captureReport: capture, buildReport: () => { throw Error('fixture report failure'); } });
  assert.equal(failed.report, REPORT_PENDING); assert.equal(failed.pending, true);
  const retried = buildDailyReport(state, { reportDate: DAY }, { captureReport: capture, buildReport: buildReportMarkdown });
  assert.equal(retried.pending, false); assert.deepEqual(retried.records, []); assert.deepEqual(state.blocks, saved);
  console.log('PASS S3-12 report: provenance, 0/12 minutes, ordinary fallback, AI rate exclusion, invalid timestamps, timer and report-only retry');
}

// S5-02: isolated reading records survive report failure, replay/reload and the next day.
{
  const { runDailyOperation } = require('../src/features/daily-operations.js');
  const { commitCandidate } = require('../src/core/commit.js');
  const { captureReportInput } = require('../src/features/feedback/report-input.js');
  const { deriveReportValues } = require('../src/features/feedback/report-derived.js');
  const { buildReportMarkdown } = require('../src/features/feedback/report-builder.js');
  const { REPORT_PENDING } = require('../src/core/daily-report.js');
  const state = fixture();
  Object.assign(state, { projects: [], reports: {}, singleSchedules: [], journals: { [DAY]: '閲覧後も保持する本文' } });
  let saves = 0, reportFails = true;
  const operationDeps = { ...deps, state, commitCandidate, now: () => AT,
    persist: () => { saves++; return true; }, scheduleSync: () => {},
    captureReport: (source, date) => captureReportInput(source, date, deriveReportValues),
    buildReport: captured => { if (reportFails) throw Error('fixture report failure'); return buildReportMarkdown(captured); } };
  const run = (name, value) => runDailyOperation(name, value, operationDeps);
  state.settings.dailyReadingRecordEnabled = false;
  for (const kind of ['affirmation', 'visionBoard', 'feedback'])
    assert(run('daily-reading-record', { ...input(state, kind), sequence: 1 }).discarded);
  assert.equal(saves, 0); assert.equal(state.blocks.length, 0);
  state.settings.dailyReadingRecordEnabled = true;
  for (const kind of ['affirmation', 'visionBoard', 'feedback'])
    assert(run('daily-reading-record', { ...input(state, kind), sequence: 2 }).ok);
  assert.equal(saves, 3); assert.equal(state.blocks.length, 3); assert.equal(state.tasks.length, 0); assert.equal(state.recurrences.length, 2);
  const originalBlocks = structuredClone(state.blocks), originalHabits = structuredClone(state.habitStreaks);
  assert(run('daily-report-refresh', { reportDate: DAY }).ok); assert.equal(state.reports[DAY], REPORT_PENDING);
  assert.deepEqual(state.blocks, originalBlocks); assert.deepEqual(state.habitStreaks, originalHabits);
  Object.assign(state, JSON.parse(JSON.stringify(state)));
  const afterReload = saves;
  for (const kind of ['affirmation', 'visionBoard', 'feedback'])
    assert(run('daily-reading-record', { ...input(state, kind), sequence: 3 }).unchanged);
  assert.equal(saves, afterReload);
  reportFails = false; assert(run('daily-report-refresh', { reportDate: DAY }).ok);
  assert(state.reports[DAY].includes('| 時間実行 | 0h /'));
  assert.deepEqual(state.blocks, originalBlocks);
  const ai = state.blocks.find(b => b.id.startsWith('daily-reading-feedback_'));
  assert(run('daily-actual-edit', { kind: 'actual', id: ai.id, values: { actualEndAt: DAY + 'T10:12:00' } }).ok);
  assert(run('daily-report-refresh', { reportDate: DAY }).ok);
  assert(state.reports[DAY].includes('| 時間実行 | 0h12m /'));
  const [year, month, day] = DAY.split('-').map(Number), next = new Date(year, month - 1, day + 1);
  const nextDay = [next.getFullYear(), String(next.getMonth() + 1).padStart(2, '0'), String(next.getDate()).padStart(2, '0')].join('-');
  const previous = structuredClone(state.blocks); operationDeps.today = () => nextDay; operationDeps.now = () => nextDay + 'T10:00:00';
  assert(run('daily-reading-record', { ...input(state, 'feedback'), sequence: 4, date: nextDay, referenceDate: DAY, recordedAt: nextDay + 'T10:00:00' }).ok);
  assert.equal(state.blocks.length, 4);
  assert.deepEqual(state.blocks.filter(b => b.date === DAY), previous);
  assert.deepEqual(state.habitStreaks, originalHabits);
  assert.equal(state.journals[DAY], '閲覧後も保持する本文');
  console.log('PASS S5-02 three readers: flag off, report-only failure/retry, serialized reload, replay, manual 12 minutes and next-day identity');
}
