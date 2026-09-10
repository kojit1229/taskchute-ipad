const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { COPY_DEFAULTS, copyBlockPlan } = require('../src/core/block-copy.js');
const { runDailyOperation: run, dailyFingerprint } = require('../src/features/daily-operations.js');
const { commitCandidate } = require('../src/core/commit.js');
const { createCopyUndoTicket, canUndoCopy } = require('../src/core/copy-undo.js');
const { getCopyUndoTicket } = require('../src/features/daily-operations.js');
const { mergeRecords } = require('../src/core/merge.js');
const { chromium, launchOptions, startServer, randomPort, passGithubGate } = require('./helpers');
const date = '2026-09-10';
const original = { ...COPY_DEFAULTS, id: 'b', taskId: 't', date, title: '計画', category: '仕事',
  plannedStartAt: date + 'T10:00:00', plannedEndAt: date + 'T10:10:00', estimateMin: 10,
  expectedCharge: 4, expectedDischarge: 2, leverageType: 'asset', createdAt: date + 'T08:00:00', updatedAt: date + 'T08:00:00',
  actualStartAt: date + 'T10:01:02', actualEndAt: date + 'T10:09:12', everStartedAt: date + 'T10:01:02',
  completed: true, charge: 5, discharge: 6, comment: '終了文', recurrenceGroupId: 'ordinary', pomodoroCount: 3,
  migratedTo: 'other', carryCount: 2, interruptions: [{ at: date + 'T10:05:00', reason: 'phone' }],
  incompleteReason: { chip: 'interrupt', note: 'test' }, isMIT: true, source: 'external', oneTap: true,
  externalRef: 'other-ref', label: 'old-label', timeswitchStart: true, unknown: { must: 'not copy' } };
const allowed = ['taskId','date','title','category','plannedStartAt','plannedEndAt','estimateMin','expectedCharge','expectedDischarge','leverageType'];
function checkCopy(copy, source) {
  for (const key of allowed) assert.deepEqual(copy[key], source[key], key);
  for (const key of Object.keys(COPY_DEFAULTS).filter(key => !allowed.includes(key) && !['copiedFromId','orderIndex'].includes(key)))
    assert.deepEqual(copy[key], COPY_DEFAULTS[key], 'cleared: ' + key);
  assert.equal(copy.copiedFromId, source.id); assert.notEqual(copy.id, source.id); assert.equal(Object.hasOwn(copy, 'unknown'), false);
}
const pure = copyBlockPlan(original, [original], { id: 'new', createdAt: date + 'T12:00:00' }); checkCopy(pure, original);
assert.throws(() => copyBlockPlan(original, [original], { id: 'b', createdAt: date }), /識別子/);
// This fixture stands in for the reading owner, which owns the two configured legacy definitions and AI identity.
const isReadingBlock = block => ['affirmation-rule', 'vision-rule'].includes(block.recurrenceGroupId)
  || block.externalRef?.startsWith('daily-reading:v1:') === true || block.id === 'fixture-feedback';
function setup() {
  const state = { selectedDate: date, blocks: [JSON.parse(JSON.stringify(original))], tasks: [{ id: 't', description: 'Task説明', status: 'done' }], journals: { [date]: { text: 'keep' } } };
  const trace = [], controls = { saves: 0, failAt: 0, ids: 0 };
  const deps = { state, commitCandidate, now: () => date + 'T12:00:00', newId: () => 'copy-' + (++controls.ids), isReadingBlock,
    currentRequest: () => 'r1', persist: () => { trace.push('save'); return ++controls.saves !== controls.failAt; },
    scheduleSync: () => trace.push('sync'), copyEffect: value => { controls.effect = value; trace.push('copy-effect'); }, notify: message => trace.push(message) };
  return { state, deps, trace, controls };
}
const input = (extra = {}) => ({ kind: 'block', id: 'b', date, requestId: 'r1', values: { start: '11:00', end: '11:02' }, ...extra });
{
  const { state, deps, controls } = setup(), before = JSON.stringify(state);
  controls.failAt = 1;
  const failed = run('daily-block-duplicate', input(), deps);
  assert.equal(failed.ok, false); assert.equal(failed.sourceSaved, false); assert.equal(JSON.stringify(state), before);
  controls.failAt = 0;
  const result = run('daily-block-duplicate', input(), deps); assert.equal(result.ok, true); assert.equal(state.blocks.length, 2);
  checkCopy(state.blocks[1], state.blocks[0]); assert.equal(state.blocks[1].updatedAt, date + 'T12:00:01');
  assert.equal(state.blocks[0].plannedStartAt, date + 'T11:00:00'); assert.equal(state.blocks[0].comment, original.comment);
  assert.equal(state.tasks[0].description, 'Task説明'); assert.equal(state.tasks[0].status, 'done');
  assert.equal(controls.effect.highlightedId, state.blocks[1].id);
  assert.deepEqual(controls.effect.ordered.map(b => b.id), ['b', 'copy-1']);
  const stamp = state.dataModifiedAt, saves = controls.saves;
  assert.equal(run('daily-block-duplicate', input(), deps).unchanged, true);
  assert.equal(state.blocks.length, 2); assert.equal(controls.saves, saves); assert.equal(state.dataModifiedAt, stamp);
  assert.equal(run('daily-block-duplicate', input({ values: { start: '12:00', end: '12:01' } }), deps).status, 'invalid');
}
{
  const { state, deps, controls } = setup(); controls.failAt = 2;
  const result = run('daily-block-duplicate', input(), deps);
  assert.equal(result.ok, false); assert.equal(result.sourceSaved, true); assert.equal(state.blocks.length, 1);
  assert.equal(state.blocks[0].plannedStartAt, date + 'T11:00:00'); const saved = JSON.stringify(state.blocks[0]);
  controls.failAt = 0; assert.equal(run('daily-block-duplicate', input(), deps).ok, true);
  assert.equal(JSON.stringify(state.blocks[0]), saved); assert.equal(controls.saves, 3, 'retry only copy, not source');
}
for (const patch of [{ externalRef: 'daily-reading:v1:{"kind":"affirmation"}', recurrenceGroupId: 'missing' },
  { recurrenceGroupId: 'affirmation-rule' }, { recurrenceGroupId: 'vision-rule' }, { id: 'fixture-feedback', recurrenceGroupId: '' }]) {
  const { state, deps, controls } = setup(); Object.assign(state.blocks[0], patch); const before = JSON.stringify(state);
  assert.equal(run('daily-block-duplicate', input({ id: state.blocks[0].id }), deps).status, 'invalid');
  assert.equal(JSON.stringify(state), before); assert.equal(controls.saves, 0);
}
{
  const { state, deps, controls } = setup(); delete deps.isReadingBlock;
  assert.equal(run('daily-block-duplicate', input(), deps).status, 'invalid'); assert.equal(controls.saves, 0);
  deps.isReadingBlock = isReadingBlock;
  assert.equal(run('daily-block-duplicate', input({ baseFingerprint: 'stale' }), deps).status, 'invalid');
  assert.equal(run('daily-block-duplicate', input({ values: { start: '23:00', end: '01:00' } }), deps).status, 'invalid');
  const moved = input({ values: { date: '2026-09-11', start: '03:01', end: '03:02' } });
  assert.equal(run('daily-block-duplicate', moved, deps).ok, true);
  assert.equal(state.blocks[1].date, '2026-09-11'); assert.equal(state.selectedDate, date);
}
console.log('PASS whitelist, source/copy failure separation, request replay, date change and reading owner exclusions');

const undoInput = id => ({ id, kind: 'block' });
const merge = (local, remote) => mergeRecords(local, remote, { compareAt: b => b.updatedAt || b.createdAt || '',
  tieBreak: (local, remote) => Boolean(local.deleted) === Boolean(remote.deleted) || local.deleted ? local : remote });
{
  const { state, deps, controls, trace } = setup(); run('daily-block-duplicate', input(), deps);
  const copy = state.blocks[1], ticket = getCopyUndoTicket(deps, copy.id);
  assert(ticket); assert.equal(controls.effect.undoAvailable, true); assert.equal(canUndoCopy(copy, ticket, dailyFingerprint), true);
  const omitted = { ...copy }; for (const key of ['comment', 'oneTap', 'incompleteReason', 'carryCount']) delete omitted[key];
  assert.equal(canUndoCopy(omitted, ticket, dailyFingerprint), true, 'missing optional defaults equal explicit defaults');
  const unknown = { ...copy, custom: { b: 1, a: ['x', { z: 2, y: 3 }] } };
  const reordered = { ...copy, custom: { a: ['x', { y: 3, z: 2 }], b: 1 } };
  assert.equal(canUndoCopy(reordered, createCopyUndoTicket(unknown, dailyFingerprint), dailyFingerprint), true);
  assert.equal(canUndoCopy({ ...reordered, custom: { a: ['changed'] } }, createCopyUndoTicket(unknown, dailyFingerprint), dailyFingerprint), false);
  for (const patch of [{ actualStartAt: date + 'T12:01:00' }, { actualEndAt: date + 'T12:02:00' }, { completed: true }, { everStartedAt: date + 'T12:01:00' }]) {
    const started = { ...copy, ...patch };
    assert.equal(canUndoCopy(started, createCopyUndoTicket(started, dailyFingerprint), dailyFingerprint), false, 'started/completed never undo even with matching ticket');
  }
  const other = JSON.stringify({ source: state.blocks[0], tasks: state.tasks, journals: state.journals });
  const stamp = state.dataModifiedAt, saves = controls.saves;
  const reloaded = { ...deps };
  assert.equal(getCopyUndoTicket(reloaded, copy.id), null);
  assert.equal(run('daily-duplicate-undo', { ...undoInput(copy.id), undoTicket: ticket }, reloaded).undoStatus, 'hidden', 'cannot inject a foreign ticket');
  assert.equal(controls.saves, saves);
  const realPersist = deps.persist; deps.persist = () => false;
  assert.equal(run('daily-duplicate-undo', undoInput(copy.id), deps).ok, false);
  assert.equal(state.blocks[1], copy); assert.equal(state.dataModifiedAt, stamp);
  deps.persist = realPersist;
  const result = run('daily-duplicate-undo', undoInput(copy.id), deps);
  assert.equal(result.ok, true); const tombstone = state.blocks[1]; assert.equal(tombstone.deleted, true);
  assert(tombstone.updatedAt > copy.updatedAt); assert(state.dataModifiedAt > stamp);
  assert.equal(JSON.stringify({ source: state.blocks[0], tasks: state.tasks, journals: state.journals }), other);
  assert.deepEqual(Object.keys(tombstone).sort(), Object.keys(copy).sort(), 'no new persisted undo fields');
  assert(!JSON.stringify(state).includes('undoBaseFingerprint')); assert(!JSON.stringify(state).includes('fingerprint'));
  assert(trace.includes('この端末で取消・同期待ち'));
  const deletedStamp = state.dataModifiedAt, deletedSaves = controls.saves;
  assert.equal(run('daily-duplicate-undo', undoInput(copy.id), deps).unchanged, true);
  assert.equal(state.dataModifiedAt, deletedStamp); assert.equal(controls.saves, deletedSaves);
  assert.equal(merge([tombstone], [{ ...copy, title: 'later remote', updatedAt: date + 'T13:00:00' }])[0].deleted, false);
  assert.equal(merge([tombstone], [{ ...copy, title: 'older remote' }])[0].deleted, true);
  assert.equal(merge([tombstone], [{ ...copy, updatedAt: tombstone.updatedAt }])[0].deleted, true);
  state.blocks = [state.blocks[0]];
  assert.equal(run('daily-duplicate-undo', undoInput(copy.id), deps).unchanged, true, 'physically absent is a no-op');
}
for (const patch of [{ comment: 'same-second edit' }, { plannedStartAt: date + 'T11:01:00' }, { taskId: 'other-task' },
  { unknown: { edited: true } }, { completed: true }, { actualStartAt: date + 'T12:00:00' }, { date: '2026-09-11' }]) {
  const { state, deps, controls, trace } = setup(); run('daily-block-duplicate', input(), deps);
  const copy = state.blocks[1], saves = controls.saves;
  // Simulate already received edits, including edits made inside the same timestamp second.
  state.blocks[1] = { ...copy, ...patch };
  const before = JSON.stringify(state);
  assert.equal(run('daily-duplicate-undo', undoInput(copy.id), deps).undoStatus, 'changed');
  assert.equal(JSON.stringify(state), before); assert.equal(controls.saves, saves);
  assert(trace.some(message => message.includes('詳細から削除')));
}
console.log('PASS ticket/default/full-field checks; changed/start/completion refusal, save failure, tombstone replay and ordinary merge');

(async () => {
  const server = startServer(randomPort()), browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ serviceWorkers: 'block', timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: app + '\nexport { dailyOperationDeps as testDeps };' }));
    await page.clock.setFixedTime(new Date(2026, 8, 10, 12));
    await page.goto(`http://localhost:${server.address().port}/`); await passGithubGate(page);
    await page.evaluate(async ({ date, original }) => {
      const { testDeps: deps } = await import('/app.js'); window.testDeps = deps;
      deps.state.selectedDate = date; deps.state.blocks = [original]; deps.scheduleSync = () => {};
      deps.state.tasks = [{ id: 't', description: 'Task説明', status: 'done' }];
      deps.currentRequest = () => 'browser-r1'; deps.newId = () => 'browser-copy';
      deps.isReadingBlock = b => ['affirmation-rule', 'vision-rule'].includes(b.recurrenceGroupId)
        || b.externalRef?.startsWith('daily-reading:v1:') === true || b.id === 'fixture-feedback';
      window.saveCount = 0; window.failAt = 1; deps.persist = () => ++window.saveCount !== window.failAt;
      const row = document.createElement('article'); row.dataset.dailyKey = 'block:b';
      row.innerHTML = '<input type="time" step="300" data-daily-field="start" value="11:00"><input type="time" step="300" data-daily-field="end" value="11:01"><button data-action="daily-block-duplicate" data-kind="block" data-id="b" data-request-id="browser-r1">copy</button>';
      document.body.append(row);
    }, { date, original });
    const click = () => page.locator('[data-daily-key="block:b"] [data-action="daily-block-duplicate"]').click();
    await click(); assert.equal(await page.evaluate(() => testDeps.state.blocks.length), 1);
    assert.equal(await page.locator('[data-daily-field="start"]').inputValue(), '11:00');
    await page.evaluate(() => { window.failAt = 3; }); await click();
    assert.equal(await page.evaluate(() => testDeps.state.blocks.length), 1);
    assert.equal(await page.evaluate(() => testDeps.state.blocks[0].plannedStartAt), date + 'T11:00:00');
    await page.evaluate(() => { window.failAt = 0; }); await click(); await click();
    const blocks = await page.evaluate(() => testDeps.state.blocks); assert.equal(blocks.length, 2); checkCopy(blocks[1], blocks[0]);
    assert.equal(await page.evaluate(() => window.saveCount), 4);
    await page.evaluate(() => {
      window.browserCopy = structuredClone(testDeps.state.blocks[1]);
      const button = document.createElement('button'); button.dataset.action = 'daily-duplicate-undo';
      button.dataset.kind = 'block'; button.dataset.id = 'browser-copy'; button.textContent = 'undo'; document.body.append(button);
      testDeps.state.blocks[1].comment = 'received edit';
    });
    const undo = () => page.locator('[data-action="daily-duplicate-undo"]').click();
    await undo(); assert.equal(await page.evaluate(() => testDeps.state.blocks[1].deleted), false);
    assert.equal(await page.evaluate(() => window.saveCount), 4);
    await page.evaluate(() => { testDeps.state.blocks[1] = structuredClone(window.browserCopy); window.failAt = 5; });
    await undo(); assert.equal(await page.evaluate(() => testDeps.state.blocks[1].deleted), false);
    await page.evaluate(() => { window.failAt = 0; }); await undo(); await undo();
    assert.equal(await page.evaluate(() => testDeps.state.blocks[1].deleted), true);
    assert.equal(await page.evaluate(() => testDeps.state.blocks[0].deleted), false);
    assert.equal(await page.evaluate(() => window.saveCount), 6);
    for (const patch of [{ externalRef: 'daily-reading:v1:{}' }, { recurrenceGroupId: 'affirmation-rule' },
      { recurrenceGroupId: 'vision-rule' }, { id: 'fixture-feedback' }]) {
      await page.evaluate(({ patch, original }) => {
        testDeps.state.blocks = [{ ...original, ...patch }];
        document.querySelector('[data-action="daily-block-duplicate"]').dataset.id = testDeps.state.blocks[0].id;
      }, { patch, original });
      await click(); assert.equal(await page.evaluate(() => testDeps.state.blocks.length), 1);
    }
    assert.equal(await page.evaluate(() => window.saveCount), 6);
    assert.deepEqual(errors, []);
    console.log('PASS real data-action: two saves, both failure phases, retry/replay, reading cases, edited undo refusal and failed/successful/repeated undo');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
