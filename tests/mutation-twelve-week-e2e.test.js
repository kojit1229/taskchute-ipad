const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { fixedClock } = require('./helpers');
const moduleAt = name => import(pathToFileURL(path.resolve(name)).href);
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const names = ['autoCommitWeekIfNeeded', 'stampCommitmentCompletion', 'trackOnBlockStarted',
  'trackOnBlockCompletionChanged', 'upsertWeeklyCommitment', 'runTwelveWeekChange', 'excuseCommitmentItem', 'unexcuseCommitmentItem'];
const code = names.map(name => { const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node); return source.slice(node.start, node.end); }).join('\n');

test('212 nested track edit: milestone and parent advance together above future child clocks', async () => {
  const { prepareRelatedStamps } = await moduleAt('src/features/twelve-week-save.js');
  const { createDraftSaveTransaction } = await moduleAt('src/features/draft-save.js');
  const now = '2026-09-13T10:00:00';
  let state = { tracks: [{ id: 'track', updatedAt: now, milestones: [{ id: 'ms', label: 'before',
    doneAt: '', updatedAt: '2026-09-13T10:10:00' }] }], dataModifiedAt: now };
  const before = state;
  let fail = true, writes = 0;
  const transaction = createDraftSaveTransaction({ getState: () => state, setState: s => { state = s; },
    now: () => now, persist: () => { writes++; return !fail; }, schedule() {}, onFailure() {} });
  const save = () => transaction.run(() => {
    const snapshot = JSON.parse(JSON.stringify(state));
    Object.assign(state.tracks[0].milestones[0], { label: 'after', doneAt: '2026-09-13', doneChangedAt: now, updatedAt: now });
    prepareRelatedStamps(snapshot, state, ['tracks'], now);
    transaction.complete();
  });
  assert.equal(save().ok, false); assert.equal(state, before);
  fail = false; assert.equal(save().ok, true); assert.equal(writes, 2);
  assert.equal(state.tracks[0].updatedAt, '2026-09-13T10:10:01');
  assert.equal(state.tracks[0].milestones[0].updatedAt, state.tracks[0].updatedAt);
  assert.equal(state.tracks[0].milestones[0].doneChangedAt, state.tracks[0].updatedAt);
});

test('212 twelve week: actual old entry restores weekly records and suppresses toast; retry persists once', async () => {
  const { createDraftSaveTransaction } = await moduleAt('src/features/draft-save.js');
  const { runDailyOperation } = await moduleAt('src/features/daily-operations.js');
  const { buildTwelveWeekDraft, twelveWeekSaveOperation } = await moduleAt('src/features/twelve-week-save.js');
  const clock = fixedClock(Date.UTC(2026, 8, 13, 1));
  const now = () => new Date(clock()).toISOString().slice(0, 19);
  const block = { id: 'b', date: '2026-09-13', actualEndAt: '2026-09-13T00:59:00' };
  const ctx = vm.createContext({ state: { blocks: [block], weeklyCommitments: [], tracks: [], trackMeasurements: [],
    projects: [], settings: { twelveWeekStartDate: '2026-09-12' }, dataModifiedAt: now() },
    todayISO: () => '2026-09-13', nowDateTime: now, weekRange: () => ({ weekStart: '2026-09-12' }),
    candidateBlocksForWeek: s => s.blocks,
    commitmentItemForBlock: (s, b, weekStart) => ({ id: `wci_${weekStart}_${b.id}`, recordType: 'item', weekStart }),
    buildTwelveWeekDraft, twelveWeekSaveOperation, runDailyOperation, saveState() { assert.equal(ctx.draftSaveTransaction.active, true); } });
  let fail = true, writes = 0, sync = 0, toast = 0;
  ctx.maybeShowTrackProgressToast = () => toast++;
  ctx.draftSaveTransaction = createDraftSaveTransaction({ getState: () => ctx.state, setState: s => { ctx.state = s; },
    now, persist: () => { writes++; return !fail; }, schedule: () => sync++, onFailure() {} });
  vm.runInContext(code, ctx);
  const before = ctx.state, content = JSON.stringify(before);
  assert.equal(ctx.trackOnBlockCompletionChanged(block, true, { interactive: true }).ok, false);
  assert.equal(ctx.state, before); assert.equal(JSON.stringify(ctx.state), content);
  assert.equal(writes, 1); assert.equal(sync, 0); assert.equal(toast, 0);
  fail = false;
  assert.equal(ctx.trackOnBlockCompletionChanged(block, true, { interactive: true }).ok, true);
  assert.equal(writes, 2); assert.equal(sync, 1); assert.equal(toast, 1);
  const item = ctx.state.weeklyCommitments.find(row => row.recordType === 'item');
  assert.equal(item.completedAt, '2026-09-13T01:00:00');
  assert.equal(item.updatedAt, item.completedChangedAt);
  assert.equal(ctx.state.blocks[0].actualEndAt, block.actualEndAt);
  item.updatedAt = '2026-09-13T01:10:00'; item.excusedChangedAt = item.updatedAt;
  assert.equal(ctx.excuseCommitmentItem(item.id, 'typed reason').ok, true);
  const excused = ctx.state.weeklyCommitments.find(row => row.id === item.id);
  assert.equal(excused.updatedAt, '2026-09-13T01:10:01');
  assert.equal(excused.excusedChangedAt, excused.updatedAt);
  assert.equal(excused.completedAt, item.completedAt);
  fail = true;
  assert.equal(ctx.unexcuseCommitmentItem(item.id).ok, false);
  assert.equal(ctx.state.weeklyCommitments.find(row => row.id === item.id), excused);
});
