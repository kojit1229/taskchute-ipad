// Isolated operation -> real candidate boundary -> persistence integration.
const assert = require('node:assert/strict');
const { DAILY_OPERATIONS, runDailyOperation } = require('../src/features/daily-operations.js');
const { commitCandidate } = require('../src/core/commit.js');
const { withLocalSaveFailure, expectRestored, fixedClock } = require('./helpers');
const name = '__stamp_fixture';
const make = () => ({ selectedDate: '2026-09-10', dataModifiedAt: '2026-09-10T14:00:00',
  lastPushedAt: '2026-09-10T15:00:00', settings: {},
  blocks: [{ id: 'b', title: 'before', updatedAt: '2026-09-10T13:00:00' }],
  tasks: [{ id: 't', title: 'task', updatedAt: '2026-09-10T16:00:00' }] });
const clock = fixedClock(Date.UTC(2026, 8, 10, 12));
const now = () => new Date(clock()).toISOString().slice(0, 19);
const input = { value: 'unsaved text', selectionStart: 2, selectionEnd: 5 };
let sequence = [], builds = 0, commits = 0;
DAILY_OPERATIONS[name] = {
  build: s => { builds++; return {
    records: ['blocks', 'tasks'].map(kind => ({ kind, before: s[kind][0], after: { ...s[kind][0], title: input.value } })),
    values: [{ kind: 'settings', key: 'flag', before: s.settings.flag, after: true }],
    inputs: [{ target: input, key: 'value', before: input.value }]
  }; },
  effects: () => sequence.push('effects')
};
try {
  const state = make(); let persisted;
  const deps = { state, now, floors: () => ['2026-09-10T17:00:00'],
    commitCandidate: options => { commits++; return commitCandidate(options); },
    persist: s => { sequence.push('persist'); persisted = JSON.parse(JSON.stringify(s)); return true; },
    scheduleSync: () => sequence.push('sync') };
  const result = runDailyOperation(name, {}, deps);
  assert.equal(result.ok, true); assert.equal(builds, 1); assert.equal(commits, 1);
  assert.equal(state.blocks[0].updatedAt, '2026-09-10T13:00:01');
  assert.equal(state.tasks[0].updatedAt, '2026-09-10T16:00:01');
  assert.equal(state.dataModifiedAt, '2026-09-10T17:00:01');
  assert.deepEqual(persisted, state); assert.deepEqual(sequence, ['persist', 'effects', 'sync']);
  console.log('PASS successful candidate: one commit/build/save, max+1 second, effects then sync');
  withLocalSaveFailure((fail, evidence) => {
    const state = make(), before = JSON.parse(JSON.stringify(state)), beforeInput = { ...input };
    const blocks = state.blocks, tasks = state.tasks, settings = state.settings;
    sequence = [];
    const failed = runDailyOperation(name, {}, { ...deps, state,
      persist: () => { input.value = 'interrupted'; return fail(); } });
    assert.equal(failed.ok, false); assert.equal(failed.error, evidence.error); assert.equal(evidence.calls, 1);
    expectRestored(before, state); expectRestored(beforeInput, input);
    assert.equal(state.blocks, blocks); assert.equal(state.tasks, tasks); assert.equal(state.settings, settings);
    assert.deepEqual(sequence, []);
  });
  console.log('PASS injected storage failure: all records/values/input and references restored; zero effects/sync');
  for (const persist of [() => false, () => { throw new Error('save exception'); }, () => Promise.resolve(true)]) {
    const state = make(), before = JSON.parse(JSON.stringify(state)); sequence = [];
    assert.equal(runDailyOperation(name, {}, { ...deps, state, persist }).ok, false);
    expectRestored(before, state); assert.deepEqual(sequence, []);
  }
  DAILY_OPERATIONS[name] = { build: () => ({ records: [] }) };
  const unchanged = make(), before = JSON.parse(JSON.stringify(unchanged)); sequence = [];
  assert.equal(runDailyOperation(name, {}, { ...deps, state: unchanged }).unchanged, true);
  expectRestored(before, unchanged); assert.deepEqual(sequence, []);
  const marker = { ok: false, custom: 'exact-result' };
  assert.equal(runDailyOperation(name, {}, { ...deps, commitCandidate: () => marker }), marker);
  console.log('PASS false/exception/async persistence, unchanged and exact boundary result');
} finally { delete DAILY_OPERATIONS[name]; }
