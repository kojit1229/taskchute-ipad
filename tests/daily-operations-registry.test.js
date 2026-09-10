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
  // fixB3(73a F1): 保存成功後に effects が例外を投げても同期予約は1回行われ、保存失敗なら予約0回。
  const changed = s => ({ records: [{ kind: 'blocks', before: s.blocks[0], after: { ...s.blocks[0], title: 'after' } }] });
  rows[fixture] = { build: changed, effects: () => { throw new Error('effects boom'); } };
  const savesBefore = saves, schedulesBefore = schedules;
  assert.throws(() => run(fixture, {}, deps), /effects boom/);
  assert.equal(saves, savesBefore + 1, 'device save happened before effects');
  assert.equal(schedules, schedulesBefore + 1, 'sync is scheduled even when effects throw');
  assert.equal(state.blocks[0].title, 'after', 'successful save is kept');
  state.blocks[0].title = 'before';
  const failing = { ...deps, persist: () => { saves++; return false; } };
  const before = JSON.parse(JSON.stringify(state));
  assert.equal(run(fixture, {}, failing).ok, false);
  assert.equal(schedules, schedulesBefore + 1, 'no sync schedule after a failed save');
  expectRestored(before, state);
  console.log('PASS sync schedule survives effects failure and is skipped on save failure');
  // fixB4(78b 中1): 日付なし入力は対象 Block の date が selectedDate と違っても拒否しない。日付あり入力の不一致は拒否。
  state.blocks.push({ id: 'y', date: '2026-09-09', title: 'yesterday' });
  rows[fixture] = { build: () => ({ records: [] }) };
  assert.equal(run(fixture, { kind: 'block', id: 'y' }, deps).ok, true, 'no-date input tolerates a block on another day');
  assert.equal(run(fixture, { kind: 'block', id: 'y', date: '2026-09-09' }, deps).status, 'invalid', 'explicit date must match selectedDate');
  assert.equal(run(fixture, { kind: 'block', id: 'b', date: '2026-09-10' }, deps).ok, true, 'explicit matching date passes');
  state.blocks.pop();
  console.log('PASS date check applies only to inputs that carry a date');
} finally { delete rows[fixture]; setCommitGuard(null); }

// Execute the actual app dispatcher/dependency wiring without importing the app UI.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), acorn = require('acorn');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const wiring = ast.body.find(n => n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === 'dailyOperationDeps'));
const click = ast.body.find(n => n.type === 'ExpressionStatement' && n.expression.callee?.object?.name === 'document'
  && n.expression.callee?.property?.name === 'addEventListener' && n.expression.arguments[0]?.value === 'click');
assert(wiring && click, 'one shared dependency object and actual delegated click entry');
let listener, calls = [], routes = [], blockSaveCount = 0;
const ctx = { DAILY_ACTIONS, state: { modal: null },
  runDailyOperation: (name, input, injected) => { routes.push(name); return run(name, input, injected); },
  commitCandidate: () => { throw Error('legacy entered candidate boundary'); }, nowDateTime() {},
  saveState: {}, persistLocalNoSchedule() {}, _lastSaveError: null, scheduleAutoSave() {}, scheduleAutoSync() {},
  showToast() {}, openBlockEditor: id => calls.push(['edit-block', id]),
  openTaskEditor: id => calls.push(['edit-task', id]), openProjectEditor: id => calls.push(['edit-project', id]),
  closeFillGapAware: () => calls.push(['modal-close']), deleteFromModal: () => calls.push(['modal-delete']),
  submitModal: () => { blockSaveCount++; return { ok: false }; }, rememberWorkListOrigin() {},
  document: { addEventListener: (name, handler) => { assert.equal(name, 'click'); listener = handler; } },
  dispatchAction: name => { calls.push(['other', name]); return true; }
};
vm.runInNewContext(source.slice(wiring.start, wiring.end) + '\n' + source.slice(click.start, click.end), ctx);
const fire = (action, disabled = false) => {
  const target = { dataset: { action, id: 'b' }, disabled };
  listener({ target: { closest: selector => selector === '[data-action]' ? target : null } });
  return target;
};
for (const name of ['edit-block', 'edit-task', 'edit-project', 'modal-close', 'modal-delete']) fire(name);
assert.deepEqual(routes, ['edit-block', 'edit-task', 'edit-project', 'modal-close', 'modal-delete']);
assert.deepEqual(calls.map(row => row[0]), routes);
ctx.state.modal = { type: 'block', id: 'b' };
assert.equal(fire('modal-save').disabled, false, 'failed save re-enables button');
assert.equal(blockSaveCount, 1);
fire('modal-save', true); assert.equal(blockSaveCount, 1, 'disabled save returns without invoking submit');
ctx.state.modal = { type: 'task', id: 't' }; fire('modal-save'); assert.equal(blockSaveCount, 2);
ctx.submitModal = () => { blockSaveCount++; ctx.state.modal = null; };
ctx.state.modal = { type: 'block', id: 'b' };
assert.equal(fire('modal-save').disabled, true, 'successful close preserves prior disabled behavior');
ctx.commitCandidate = commitCandidate;
// The dependency captures commitCandidate; re-create it for unconnected candidate rows.
const unwiredContext = { ...ctx, document: ctx.document };
vm.runInNewContext(source.slice(wiring.start, wiring.end) + '\n' + source.slice(click.start, click.end), unwiredContext);
for (const name of DAILY_ACTIONS.filter(name => !rows[name].legacy)) fire(name);
assert(DAILY_ACTIONS.every(name => routes.includes(name)), 'all 18 data-actions reach the daily registry');
const count = routes.length; fire('other-action');
assert.equal(routes.length, count); assert.deepEqual(calls.at(-1), ['other', 'other-action']);
console.log('PASS actual app routing, legacy save result/disabled semantics and unrelated action fallback');
