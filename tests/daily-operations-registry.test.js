const assert = require('node:assert/strict');
const { DAILY_ACTIONS } = require('../src/ui/daily-parts/contract.js');
const { DAILY_OPERATIONS: rows, runDailyOperation: run, dailyFingerprint } = require('../src/features/daily-operations.js');
const { commitCandidate, setCommitGuard } = require('../src/core/commit.js');
const { deepCommitGuard, expectRestored } = require('./helpers');
setCommitGuard(deepCommitGuard);
const state = { selectedDate: '2026-09-10', blocks: [{ id: 'b', date: '2026-09-10', title: 'before' }] };
let commits = 0, saves = 0, schedules = 0;
const deps = { state, now: () => '2026-09-10T12:00:00',
  commitCandidate: options => { commits++; return commitCandidate(options); },
  persist: () => { saves++; return true; }, scheduleSync: () => schedules++, legacy: {} };
assert.deepEqual(Object.keys(rows).sort(), [...DAILY_ACTIONS].sort());
for (const name of DAILY_ACTIONS) {
  const before = JSON.parse(JSON.stringify(state));
  if (rows[name].legacy) {
    const token = {}, start = commits;
    deps.legacy[name] = input => { assert.equal(input, token); return token; };
    assert.equal(run(name, token, deps), token);
    assert.equal(commits, start, 'legacy must not commit twice');
  } else {
    assert.equal(typeof rows[name].build, 'function');
    assert.equal(run(name, {}, deps).status, 'invalid');
  }
  expectRestored(before, state);
}
for (const name of ['missing', 'toString', '__proto__']) assert.throws(() => run(name, {}, deps), /unknown operation/);
assert.equal(saves, 0); assert.equal(schedules, 0);
console.log('PASS all 18 rows, 12 unwired rejections, 6 legacy delegates and unknown names');
const fixture = '__fixture';
try {
  rows[fixture] = { build: () => ({ records: [] }) };
  const input = { kind: 'block', id: 'b', date: state.selectedDate, baseFingerprint: dailyFingerprint(state.blocks[0]), requestId: 'r1' };
  deps.currentRequest = s => s === state ? 'unexpected raw state' : 'r1';
  assert.equal(run(fixture, input, deps).unchanged, true);
  for (const patch of [{ id: 'gone' }, { kind: 'constructor' }, { date: '2026-09-11' }, { baseFingerprint: 'stale' }, { requestId: 'r0' }])
    assert.equal(run(fixture, { ...input, ...patch }, deps).status, 'invalid');
  delete deps.currentRequest;
  assert.equal(run(fixture, input, deps).status, 'invalid');
  const fingerprint = dailyFingerprint({ id: 'b', nested: { z: 1, a: 2 } });
  assert.equal(fingerprint, dailyFingerprint({ nested: { a: 2, z: 1 }, id: 'b' }));
  assert.equal(saves, 0); assert.equal(schedules, 0);
  console.log('PASS target/date/fingerprint/request validation and unchanged clock/sync');
  for (const build of [
    s => { s.blocks[0].title = 'bad'; return { records: [] }; },
    () => { state.blocks[0].title = 'closure mutation'; return { records: [] }; },
    () => run(fixture, {}, deps),
    async () => ({ records: [] }),
    () => ({ then() {} })
  ]) {
    rows[fixture] = { build };
    const before = JSON.parse(JSON.stringify(state));
    assert.throws(() => run(fixture, {}, deps), /mutate|forbidden|synchronous/);
    expectRestored(before, state);
  }
  rows[fixture] = { build: () => ({ records: [] }) };
  assert.equal(run(fixture, {}, deps).ok, true, 'guard released after rejection');
  console.log('PASS deep mutation, nested and async rejection; guard recovery');
} finally { delete rows[fixture]; setCommitGuard(null); }
