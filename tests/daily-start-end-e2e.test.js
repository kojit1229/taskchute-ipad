const assert = require('node:assert/strict');
const { runDailyOperation: run, getDailyStartDraft } = require('../src/features/daily-operations.js');
const { commitCandidate, setCommitGuard } = require('../src/core/commit.js');
const { mergeWeeklyCommitments } = require('../src/core/merge.js');
const { deepCommitGuard, expectRestored } = require('./helpers');
setCommitGuard(deepCommitGuard);
const at = '2026-09-10T23:50:00';
function fixture() {
  const state = {
    selectedDate: '2026-09-11', dataModifiedAt: '2026-09-10T12:00:00',
    settings: { focusTimerAuto: true, twelveWeekStartDate: '2026-09-07' },
    blocks: [
      { id: 'b', taskId: 't', date: '2026-09-10', title: '作業', actualStartAt: '', actualEndAt: '', everStartedAt: '' },
      { id: 'r', date: '2026-09-09', category: 'ルーティン', actualStartAt: '2026-09-09T22:00:00', actualEndAt: '' },
      { id: 'other', date: '2026-09-10', actualStartAt: '2026-09-10T20:00:00', actualEndAt: '' }
    ],
    tasks: [{ id: 't', status: 'todo' }, { id: 't2', status: 'todo' }],
    declarations: [], weeklyCommitments: [],
    pomodoro: { running: true, blockId: 'r', startedAt: '2026-09-09T22:00:00' }
  };
  const seen = { saves: 0, effects: 0, sync: 0, ids: 0, fail: false };
  const deps = { state, commitCandidate, now: () => at,
    newId: () => `declaration-${++seen.ids}`, currentRequest: (_state, input) => input.requestId,
    persist: () => { seen.saves++; assert.equal(seen.effects, 0); return !seen.fail; },
    scheduleSync: () => seen.sync++, startEffect: () => { seen.effects++; assert(!seen.fail); },
    weekRange: () => ({ weekStart: '2026-09-07' }),
    candidateBlocksForWeek: value => value.blocks.filter(row => row.taskId),
    commitmentItemForBlock: (_value, block, weekStart, source, now) => ({
      id: `wci_${weekStart}_${block.id}`, recordType: 'item', weekStart, source, blockId: block.id,
      createdAt: now, updatedAt: now, deleted: false
    }), mergeWeeklyCommitments,
    pomodoroForStart: (time, id) => ({ running: true, blockId: id, startedAt: time,
      endsAt: '2026-09-11T00:15:00', mode: 'focus', paused: false, pausedRemainMs: 0 })
  };
  return { state, deps, seen, input: { kind: 'block', id: 'b', requestId: 'request-1', note: '  宣言  ', estimateMin: 25 } };
}
try {
  {
    const { state, deps, seen, input } = fixture();
    const original = structuredClone(state), refs = { ...state };
    seen.fail = true;
    assert.equal(run('daily-block-start', input, deps).ok, false);
    expectRestored(original, state);
    for (const key of Object.keys(refs)) assert.equal(state[key], refs[key], `rollback reference: ${key}`);
    assert.equal(seen.effects, 0); assert.equal(seen.sync, 0);
    const failedDraft = getDailyStartDraft(deps, 'b');
    assert.equal(failedDraft.declarationId, 'declaration-1'); assert.equal(failedDraft.saved, undefined);
    seen.fail = false;
    const result = run('daily-block-start', input, deps);
    assert.equal(result.ok, true); assert.equal(seen.saves, 2);
    assert.equal(seen.effects, 1); assert.equal(seen.sync, 1); assert.equal(seen.ids, 1);
    assert.equal(state.blocks[0].actualStartAt, at); assert.equal(state.blocks[0].everStartedAt, at);
    assert.equal(state.blocks[0].date, '2026-09-10'); assert.equal(state.tasks[0].status, 'doing');
    assert.deepEqual(state.tasks[1], original.tasks[1]); assert.deepEqual(state.blocks[2], original.blocks[2]);
    assert.equal(state.blocks[1].actualEndAt, '2026-09-09T23:59:00'); assert.equal(state.blocks[1].completed, false);
    assert.equal(state.pomodoro.blockId, 'b'); assert.equal(state.pomodoro.running, true);
    assert.equal(state.declarations.length, 1); assert.equal(state.weeklyCommitments.length, 2);
    assert.equal(state.declarations[0].declaredAt, at); assert.equal(state.declarations[0].date, '2026-09-10');
    assert.equal(state.declarations[0].note, '宣言'); assert.equal(result.declarationId, failedDraft.declarationId);
    assert.equal(getDailyStartDraft(deps, 'b').saved, true);
    for (const row of result.records) if (row.after) assert(row.after.updatedAt, `stamp ${row.kind}`);
    const saved = structuredClone(state);
    deps.now = () => '2026-09-11T00:01:00';
    assert.equal(run('daily-block-start', input, deps).unchanged, true);
    expectRestored(saved, state); assert.equal(seen.saves, 2); assert.equal(seen.effects, 1);
    assert.equal(run('daily-block-start', { ...input, requestId: 'another' }, deps).status, 'invalid');
    expectRestored(saved, state);
    console.log('PASS 28a: atomic rollback, fixed declaration ID retry, one commit/effect, cross-day date, replay and stamps');
  }
  {
    const { state, deps, seen, input } = fixture();
    state.blocks[0].everStartedAt = '2026-09-01T10:00:00';
    state.tasks[0].status = 'completed';
    state.pomodoro = { running: true, blockId: 'other', startedAt: '2026-09-10T20:00:00' };
    const timer = state.pomodoro;
    assert.equal(run('daily-block-start', { ...input, declare: false }, deps).ok, true);
    assert.equal(state.blocks[0].everStartedAt, '2026-09-01T10:00:00');
    assert.equal(state.tasks[0].status, 'completed'); assert.equal(state.pomodoro, timer);
    assert.equal(state.declarations.length, 0); assert.equal(getDailyStartDraft(deps, 'b').declarationId, '');
    assert.equal(seen.saves, 1);
    console.log('PASS 28a: prior first-start, completed Task, other timer preserved and skip has no declaration');
  }
  {
    const { state, deps, seen, input } = fixture();
    state.blocks[0].actualStartAt = '2026-09-10T09:00:00';
    const original = structuredClone(state);
    assert.equal(run('daily-block-start', input, deps).unchanged, true);
    expectRestored(original, state); assert.equal(seen.saves, 0); assert.equal(seen.effects, 0);
    assert.equal(run('daily-block-start', { ...input, id: 'missing' }, deps).status, 'invalid');
    assert.equal(run('daily-block-start', { ...input, kind: 'task' }, deps).status, 'invalid');
    assert.equal(run('daily-block-start', { ...input, date: '2026-09-09' }, deps).status, 'invalid');
    expectRestored(original, state);
    console.log('PASS 28a: already-started unchanged and invalid target/kind/date rejected');
  }
  {
    const { state, deps, input } = fixture();
    state.declarations = Array.from({ length: 300 }, (_, i) => ({ id: `old-${i}`, date: '2026-08-01' }));
    assert.equal(run('daily-block-start', input, deps).ok, true);
    assert.equal(state.declarations.length, 300); assert.equal(state.declarations[0].id, 'old-1');
    assert.equal(state.declarations.at(-1).id, 'declaration-1');
    console.log('PASS 28a: declaration cap maintained in candidate');
  }
} finally { setCommitGuard(null); }
