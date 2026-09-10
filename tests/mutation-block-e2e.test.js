// Exercise the actual legacy entry points against the shared candidate boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const { fixedClock, withLocalSaveFailure, expectRestored, deepCommitGuard } = require('./helpers');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const functions = names => names.map(name => {
  const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node, `actual app entry: ${name}`);
  return source.slice(node.start, node.end);
}).join('\n');
const clone = value => JSON.parse(JSON.stringify(value));

async function deletionFixture() {
  const f = await fixture(['deleteBlock', 'carryOverBlock', 'resolveMigrationRitual', 'bodyScanRecord', 'closeBodyScanFlow']);
  Object.assign(f.ctx, {
    window: { confirm: () => false }, _migrationRitualCtx: { srcId: 'b', origin: 'draft', draftItemId: 'draft-b' },
    logMigrationRitual: () => {}, bodyScanSyncCommentFromDom() {},
    _pendingBodyScanCtx: { fatigue: 2, recovery: 3, parts: ['neck'], comment: 'typed scan', pomodoroBlockId: 'b' }
  });
  f.ctx._scheduleDraft = { items: [{ id: 'draft-b' }] };
  f.ctx.state.bodyScans = [];
  return f;
}
const deletionEdits = [
  ['series deletion', f => {
    f.ctx.state.blocks[0].recurrenceGroupId = 'rule';
    Object.assign(f.ctx.state.recurrences[0], { kind: 'weekly', anchorDate: DATE, exceptionDates: [], updatedAt: FUTURE });
    return () => f.ctx.deleteBlock('b');
  }],
  ['carry', f => () => f.ctx.carryOverBlock('b', { toDate: '2026-09-11' })],
  ['release', f => () => f.ctx.resolveMigrationRitual('release')],
  ['ritual today', f => { f.ctx._migrationRitualCtx.origin = 'panel'; return () => f.ctx.resolveMigrationRitual('today'); }],
  ['ritual carry', f => { f.ctx._migrationRitualCtx.origin = 'panel'; return () => f.ctx.resolveMigrationRitual('carry'); }],
  ['body scan', f => () => f.ctx.bodyScanRecord()]
];
for (const [name, prepare] of deletionEdits) test(`15c ${name}: failure restores Blocks and editable context; retry succeeds`, async () => {
  const f = await deletionFixture(), execute = prepare(f), before = clone(f.ctx.state);
  const blocks = f.ctx.state.blocks, rules = f.ctx.state.recurrences;
  const ritual = f.ctx._migrationRitualCtx, scan = f.ctx._pendingBodyScanCtx, draft = clone(f.ctx._scheduleDraft);
  await withLocalSaveFailure(async (fail, injection) => {
    f.fail(fail);
    assert.equal(execute(), false);
    assert.equal(injection.calls, 1);
    assert.equal(f.ctx.state.blocks, blocks);
    assert.equal(f.ctx.state.recurrences, rules);
    expectRestored(before.blocks, clone(f.ctx.state.blocks));
    expectRestored(before.recurrences, clone(f.ctx.state.recurrences));
    assert.equal(f.ctx.state.dataModifiedAt, before.dataModifiedAt);
    assert.equal(f.ctx._migrationRitualCtx, ritual);
    assert.equal(f.ctx._pendingBodyScanCtx, scan);
    expectRestored(draft, clone(f.ctx._scheduleDraft));
    assert.equal(f.counts.render + f.counts.close + f.counts.timer + f.counts.autoSync + f.counts.autoSave, 0);
    if (name === 'body scan') assert.equal(f.ctx.state.bodyScans.length, 1); // related record retains its original position
    f.fail(null);
    execute();
    assert.equal(f.ctx.state.blocks[0].updatedAt, '2026-09-10T10:05:01');
    assert.equal(f.ctx.state.blocks[0].createdAt, before.blocks[0].createdAt);
    assert.deepEqual(f.persisted[0].blocks, clone(f.ctx.state.blocks));
    assert.deepEqual(clone(f.ctx.state.blocks[1]), before.blocks[1]);
    if (name === 'series deletion') {
      const { configureRecurrence, recurrenceMatchesDate } = await import('../src/core/recurrence.js');
      configureRecurrence({ parseDate: value => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); } });
      assert.equal(f.ctx.state.blocks[0].deleted, true);
      assert.deepEqual(clone(f.ctx.state.recurrences[0].exceptionDates), [DATE]);
      assert.equal(f.ctx.state.recurrences[0].updatedAt, '2026-09-10T10:05:01');
      assert.equal(recurrenceMatchesDate(f.ctx.state.recurrences[0], DATE), false);
      assert.equal(recurrenceMatchesDate(f.ctx.state.recurrences[0], '2026-09-17'), true);
      assert.deepEqual(f.persisted[0].recurrences, clone(f.ctx.state.recurrences));
      assert.equal(f.counts.writes, 2);
    } else if (name.includes('carry') || name === 'ritual today') {
      const carried = f.ctx.state.blocks.find(b => b.id === f.ctx.state.blocks[0].migratedTo);
      assert.ok(carried);
      assert.equal(carried.carryCount, 1);
      // 監督者 2026-09-10: 非MIT の表現は既存どおり未設定(undefined)も可。MIT かどうかの真偽だけを検査する。
      assert.equal(Boolean(carried.isMIT), name === 'ritual today');
    } else if (name === 'release') assert.equal(f.ctx.state.blocks[0].deleted, true);
    else assert.equal(f.ctx.state.blocks[0].comment, 'typed scan');
  });
});

test('15c repeated deletion and unchanged scan do not stamp Blocks again', async () => {
  const f = await deletionFixture();
  f.ctx.deleteBlock('b');
  const block = clone(f.ctx.state.blocks[0]), writes = f.counts.writes;
  f.ctx.deleteBlock('b');
  assert.equal(f.counts.writes, writes);
  f.ctx._pendingBodyScanCtx.comment = block.comment;
  f.ctx.bodyScanRecord();
  expectRestored(block, clone(f.ctx.state.blocks[0]));
});
const NOW = '2026-09-10T10:00:00', FUTURE = '2026-09-10T10:05:00', DATE = NOW.slice(0, 10);

async function pomodoroFixture() {
  const f = await fixture(['recordBlockInterruption', 'stopPomodoro', 'completePomodoro',
    'goBreakPomodoro', 'recordIncompleteReasonChip']);
  f.ctx.state.blocks[0].actualStartAt = `${DATE}T09:00:00`;
  f.ctx.state.pomodoro = { running: true, blockId: 'b', mode: 'focus',
    startedAt: `${DATE}T09:00:00`, endsAt: `${DATE}T10:30:00`, paused: false };
  Object.assign(f.ctx, {
    _pendingInterruptBlockId: 'b', _pendingIncompleteReasonCtx: { queue: ['b'] },
    dateToLocalDateTime: date => date.toISOString().slice(0, 19),
    advanceIncompleteReasonQueue: () => { f.ctx._pendingIncompleteReasonCtx.queue.shift(); f.counts.close++; },
    skipIncompleteReasonModal: () => { throw Error('unexpected skip'); },
    openBodyScanModal: () => f.counts.close++
  });
  f.note = { value: 'typed reason' };
  f.ctx.modalRoot.querySelector = () => f.note;
  return f;
}
const pomodoroEdits = [
  ['interruption', f => f.ctx.recordBlockInterruption('b', 'fatigue')],
  ['stop', f => f.ctx.stopPomodoro()],
  ['complete', f => f.ctx.completePomodoro()],
  ['break', f => f.ctx.goBreakPomodoro()],
  ['incomplete reason', f => f.ctx.recordIncompleteReasonChip('fatigue')]
];
for (const [name, execute] of pomodoroEdits) test(`15d ${name}: failure retains Block, timer and input; retry commits`, async () => {
  const f = await pomodoroFixture(), before = clone(f.ctx.state), blocks = f.ctx.state.blocks;
  const queue = clone(f.ctx._pendingIncompleteReasonCtx), pending = f.ctx._pendingInterruptBlockId;
  await withLocalSaveFailure(async (fail, injection) => {
    f.fail(fail);
    assert.equal(execute(f), false);
    assert.equal(injection.calls, 1);
    assert.equal(f.ctx.state.blocks, blocks);
    expectRestored(before, clone(f.ctx.state));
    expectRestored(queue, clone(f.ctx._pendingIncompleteReasonCtx));
    assert.equal(f.ctx._pendingInterruptBlockId, pending);
    assert.equal(f.note.value, 'typed reason');
    assert.equal(f.counts.render + f.counts.close + f.counts.tracking + f.counts.autoSync + f.counts.autoSave, 0);
    f.fail(null);
    assert.equal(execute(f), true);
    const block = f.ctx.state.blocks[0];
    assert.equal(block.updatedAt, '2026-09-10T10:05:01');
    assert.equal(block.createdAt, before.blocks[0].createdAt);
    assert.deepEqual(f.persisted[0].blocks, clone(f.ctx.state.blocks));
    assert.deepEqual(clone(f.ctx.state.blocks[1]), before.blocks[1]);
    if (name === 'interruption') assert.deepEqual(clone(block.interruptions), [{ at: NOW, reason: 'fatigue' }]);
    if (name === 'stop') { assert.equal(block.actualStartAt, ''); assert.equal(f.ctx.state.pomodoro.running, false); }
    if (name === 'complete') { assert.equal(block.completed, true); assert.equal(block.actualEndAt, NOW); assert.equal(block.pomodoroCount, 1); }
    if (name === 'break') { assert.equal(block.pomodoroCount, 1); assert.equal(f.ctx.state.pomodoro.mode, 'break'); assert.equal(f.ctx.state.pomodoro.running, true); }
    if (name === 'incomplete reason') { assert.deepEqual(clone(block.incompleteReason), { chip: 'fatigue', note: 'typed reason', at: NOW }); assert.equal(f.ctx._pendingIncompleteReasonCtx.queue.length, 0); }
  });
});

test('15d all five writers alternate with candidate edits in the same second', async () => {
  const { mergeById } = await import('../src/core/merge.js');
  for (const [, execute] of pomodoroEdits) {
    const f = await pomodoroFixture();
    execute(f);
    const older = clone(f.ctx.state.blocks[0]);
    f.ctx.commitBlockChanges(f.ctx.state.blocks.map(b => b.id === 'b' ? { ...b, comment: 'candidate' } : b));
    const candidate = clone(f.ctx.state.blocks[0]);
    f.ctx.updateBlockField('b', 'comment', 'latest');
    const latest = clone(f.ctx.state.blocks[0]);
    assert.ok(latest.updatedAt > candidate.updatedAt && candidate.updatedAt > older.updatedAt);
    assert.deepEqual(mergeById([older, candidate], [latest]), [latest]);
    assert.equal(latest.actualStartAt, older.actualStartAt);
    assert.equal(latest.actualEndAt, older.actualEndAt);
  }
});

test('15d interruption click retains its reason picker after a failed Block save', async () => {
  const f = await pomodoroFixture();
  let action;
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Property' && node.key.value === 'interrupt-reason') action = node.value;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
  assert.ok(action, 'actual delegated interruption action');
  const click = vm.runInContext(`(${source.slice(action.start, action.end)})`, f.ctx);
  const before = clone(f.ctx.state);
  await withLocalSaveFailure(async fail => {
    f.fail(fail);
    click({ target: { dataset: { reason: 'fatigue' } } });
    expectRestored(before, clone(f.ctx.state));
    assert.equal(f.ctx._pendingInterruptBlockId, 'b', 'failed save must retain the editable reason picker');
    assert.equal(f.counts.writes, 1, 'failed interruption must not proceed to stopPomodoro');
  });
});

async function fixture(extraNames = []) {
  const core = await import('../src/core/commit.js');
  core.setCommitGuard(deepCommitGuard);
  const { stamped } = await import('../src/core/mutation-stamp.js');
  const { createDraftSaveTransaction } = await import('../src/features/draft-save.js');
  const clock = fixedClock(Date.UTC(2026, 8, 10, 10));
  const counts = { writes: 0, autoSave: 0, autoSync: 0, render: 0, close: 0, timer: 0, tracking: 0 };
  let failure, raw, id = 0;
  const persisted = [];
  const ctx = vm.createContext({ ...core, stamped, createDraftSaveTransaction, console: { error() {} },
    nowDateTime: () => new Date(clock()).toISOString().slice(0, 19), todayISO: () => DATE,
    draftSaveTransaction: null, _lastSaveError: null, _quotaToastShown: false, _blockSaveInFlight: false,
    _scheduleDraft: null, _draftUndo: { retained: true }, MIGRATION_RITUAL_THRESHOLD: 3,
    crypto: { randomUUID: () => `new-${++id}` },
    setState: value => { ctx.state = value; },
    persistLocalNoSchedule: () => {
      counts.writes++;
      ctx._lastSaveError = null;
      try { failure?.(); raw = JSON.stringify(ctx.state); persisted.push(JSON.parse(raw)); } catch (error) { ctx._lastSaveError = error; }
    },
    scheduleAutoSave: () => counts.autoSave++, scheduleAutoSync: () => counts.autoSync++,
    showToast: message => { ctx.lastToast = message; },
    render: () => { if (!ctx.draftSaveTransaction?.defer(() => ctx.render())) counts.render++; },
    closeModal: () => { if (!ctx.draftSaveTransaction?.defer(() => ctx.closeModal())) { counts.close++; ctx.state.modal = null; } },
    fromLocalInput: value => value ? (value.length === 16 ? `${value}:00` : value) : '',
    stampEverStarted: b => ({ ...b, everStartedAt: b.everStartedAt || b.actualStartAt || '' }),
    habitStreakEdit: () => ({ ok: true, value: '' }),
    syncHabitStreakForBlock() {}, transferIronLogToCompletedBlock() {}, generateReport() {},
    trackOnBlockStarted: () => counts.tracking++, trackOnBlockCompletionChanged: () => counts.tracking++,
    autoCloseStaleRoutineRuns() {}, openBodyScanModal() {},
    blockById: id => ctx.state.blocks.find(b => b.id === id),
    minToHHMM: min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`,
    pad2: n => String(n).padStart(2, '0'), migrationNextCount: () => 1,
    renderModal: block => { ctx.displayedBlock = block; }, buildBlockModal: b => b,
    setTimeout: callback => { callback(); }, modalRoot: { querySelector: () => ({ focus() {} }) }
  });
  vm.runInContext(functions(['makeBlock', 'openTimelineNewBlock', 'commitBlockChanges', 'updateBlockField',
    'updateCategoryField', 'confirmScheduleDraft', 'saveBlockFromModal', 'saveState', 'saveAndRender', ...extraNames]), ctx);
  ctx.state = { blocks: [], tasks: [{ id: 'task', category: 'work', status: 'todo', updatedAt: NOW }],
    projects: [{ id: 'project', category: 'work', updatedAt: NOW }],
    recurrences: [{ id: 'rule', category: 'work', updatedAt: NOW }],
    weeklyCommitments: [{ id: 'week', updatedAt: NOW }],
    settings: { categories: [{ id: 'cat', name: 'work' }], lastPushedAt: FUTURE },
    pomodoro: { running: false }, selectedDate: DATE, dataModifiedAt: NOW, modal: { type: 'block', id: 'b' } };
  ctx.state.blocks = [{ ...ctx.makeBlock({ title: 'saved', category: 'work',
    plannedStartAt: `${DATE}T09:00:00`, plannedEndAt: `${DATE}T11:00:00` }), id: 'b', updatedAt: FUTURE },
  { ...ctx.makeBlock({ title: 'unrelated', category: 'other' }), id: 'other' }];
  const init = ast.body.find(n => n.type === 'ExpressionStatement' && n.expression.left?.name === 'draftSaveTransaction');
  vm.runInContext(source.slice(init.start, init.end), ctx);
  raw = JSON.stringify(ctx.state);
  return { ctx, counts, persisted, raw: () => raw, fail: fn => { failure = fn; } };
}

function fields(f) {
  return { ...clone(f.ctx.state.blocks[0]), title: 'typed title', recurrenceKind: '__keep__' };
}
const edits = [
  ['field', f => () => f.ctx.updateBlockField('b', 'comment', 'typed comment')],
  ['category', f => () => f.ctx.updateCategoryField('cat', 'name', 'renamed')],
  ['modal edit', f => { const input = fields(f); f.input = input; return () => f.ctx.saveBlockFromModal('b', input); }],
  ['modal create', f => { const input = fields(f); f.input = input; return () => f.ctx.saveBlockFromModal('fresh', input); }],
  ['draft update/create/carry', f => {
    f.ctx._scheduleDraft = { date: DATE, items: [{ blockId: 'b', start: 630, minutes: 30 },
      { title: 'new', start: 700, minutes: 20, carryFromId: 'b' }] };
    return () => f.ctx.confirmScheduleDraft();
  }]
];
for (const [name, prepare] of edits) test(`${name}: failure restores state/input; explicit retry commits once`, async () => {
  const f = await fixture(), execute = prepare(f), before = clone(f.ctx.state), input = clone(f.input || {});
  const draft = f.ctx._scheduleDraft, undo = f.ctx._draftUndo, reference = f.ctx.state;
  await withLocalSaveFailure(async (fail, injection) => {
    f.fail(fail);
    assert.equal(execute(), false);
    assert.equal(injection.calls, 1);
    assert.match(f.ctx.lastToast, /端末.*保存/);
    expectRestored(before, clone(f.ctx.state));
    expectRestored(before, JSON.parse(f.raw()));
    expectRestored(input, clone(f.input || {}));
    assert.equal(f.ctx.state, reference);
    assert.equal(f.ctx._scheduleDraft, draft);
    assert.equal(f.ctx._draftUndo, undo);
    assert.equal(f.counts.close + f.counts.render + f.counts.autoSync + f.counts.autoSave + f.counts.timer, 0);
    f.fail(null);
    assert.equal(execute(), true);
    assert.equal(f.counts.writes, 2);
    assert.equal(f.counts.autoSync, 1);
    assert.equal(f.counts.autoSave, 1);
    assert.ok(f.ctx.state.dataModifiedAt > FUTURE);
    const changed = f.ctx.state.blocks.filter(b => !before.blocks.some(old => JSON.stringify(old) === JSON.stringify(b)));
    assert.ok(changed.length > 0);
    assert.ok(changed.every(b => b.updatedAt > (before.blocks.find(old => old.id === b.id)?.updatedAt || NOW)));
    assert.deepEqual(clone(f.ctx.state.blocks.find(b => b.id === 'other')), before.blocks[1]);
    assert.deepEqual(JSON.parse(f.raw()).blocks, clone(f.ctx.state.blocks));
  });
});

test('same-second legacy and candidate edits alternate; latest wins and observations stay unchanged', async () => {
  const f = await fixture(), { mergeById } = await import('../src/core/merge.js');
  f.ctx.state.blocks[0].actualStartAt = `${DATE}T09:13:00`;
  f.ctx.state.blocks[0].everStartedAt = `${DATE}T09:13:00`;
  const history = [];
  for (const execute of [() => f.ctx.updateBlockField('b', 'comment', 'first'),
    () => f.ctx.commitBlockChanges(f.ctx.state.blocks.map(b => b.id === 'b' ? { ...b, title: 'candidate' } : b)),
    () => f.ctx.saveBlockFromModal('b', fields(f)),
    () => f.ctx.updateCategoryField('cat', 'name', 'latest')]) {
    const previous = clone(f.ctx.state.blocks[0]);
    assert.equal(execute(), true);
    const current = clone(f.ctx.state.blocks[0]);
    assert.ok(current.updatedAt > previous.updatedAt);
    assert.equal(current.actualStartAt, previous.actualStartAt);
    assert.equal(current.createdAt, previous.createdAt);
    assert.equal(current.everStartedAt, previous.everStartedAt);
    history.push(previous);
    assert.deepEqual(mergeById([current], history), [current]);
    assert.deepEqual(mergeById(history, [current]), [current]);
  }
});

test('no content change issues no stamp, write or sync reservation', async () => {
  const f = await fixture(), before = clone(f.ctx.state);
  assert.equal(f.ctx.updateBlockField('b', 'title', 'saved'), true);
  assert.equal(f.ctx.updateCategoryField('cat', 'name', 'work'), true);
  expectRestored(before, clone(f.ctx.state));
  assert.equal(f.counts.writes + f.counts.autoSync, 0);
});

test('invalid modal input remains editable and is never persisted', async () => {
  const f = await fixture(), input = { ...fields(f), plannedStartAt: '' }, before = clone(f.ctx.state);
  assert.equal(f.ctx.saveBlockFromModal('b', input), false);
  expectRestored(before, clone(f.ctx.state));
  assert.equal(input.title, 'typed title');
  assert.equal(f.counts.writes + f.counts.close + f.counts.autoSync, 0);
});

test('factories keep unsaved timeline input out of state; persistence owns the stamp', async () => {
  const f = await fixture(), before = clone(f.ctx.state.blocks);
  f.ctx.openTimelineNewBlock(1440);
  const block = f.ctx.displayedBlock;
  assert.equal(block.plannedStartAt, `${DATE}T23:00:00`);
  assert.equal(block.plannedEndAt, `${DATE}T23:59:00`);
  assert.equal(block.createdAt, NOW);
  expectRestored(before, clone(f.ctx.state.blocks));
  assert.equal(f.counts.writes, 0);
  assert.equal(f.ctx.saveBlockFromModal(block.id, { ...block, title: 'timeline' }), true);
  assert.equal(f.counts.writes, 1);
  assert.ok(f.ctx.state.blocks.find(b => b.id === block.id).updatedAt > NOW);
});

async function lifecycleFixture() {
  const f = await fixture(['setBlockTime', 'resumeLifecycleStart', 'toggleBlock', 'autoCloseStaleRoutineRuns',
    'weekRange', 'candidateBlocksForWeek', 'commitmentItemForBlock', 'parseDate', 'addDays',
    'dateToISO', 'dateToLocalDateTime', 'localDateTimeToMs',
    'saveActualEntryFromModal', 'toggleTaskCompleteFromBlock', 'bulkApproveAsPlanned']);
  Object.assign(f.ctx, {
    runDailyOperation: (await import('../src/features/daily-operations.js')).runDailyOperation,
    mergeWeeklyCommitments: (await import('../src/core/merge.js')).mergeWeeklyCommitments,
    ...await import('../src/core/track.js'),
    queueMicrotask: callback => callback(),
    maybeShowGuidedAccessHint: () => { f.counts.guidedAccess = (f.counts.guidedAccess || 0) + 1; },
    _quickCompleteSnapshots: {}, requestDraftLeave: () => false,
    resetPomodoroForBlock: () => f.counts.timer++, forceResetPomodoroSession() {},
    startPomodoro: () => { f.counts.timer++; f.ctx.state.pomodoro.running = true; },
    quickCompleteActualStart: b => b.plannedStartAt,
    prefillEnergy: () => null, triggerAnchorPlacements() {}, getRandomCelebrate: () => 'done',
    triggerCompletionEffect() {}, fillProgressOnComplete: () => 1,
    maybeQueueNextAiStep() {}, closeAiStepConfirmIfUndone() {}, rerenderActiveModal() {},
    isStaleBlock: () => false, window: { confirm: () => true }, completePomodoro: () => f.counts.timer++
  });
  const wiring = ast.body.filter(n => n.type === 'VariableDeclaration'
    && n.declarations.some(d => ['dailyOperationDeps', 'COMMITMENT_SOURCE_PRIORITY'].includes(d.id.name)));
  vm.runInContext(wiring.map(n => source.slice(n.start, n.end)).join('\n'), f.ctx);
  return f;
}
const lifecycle = [
  ['start and close stale routine', f => {
    f.ctx.state.settings.focusTimerAuto = true;
    f.ctx.state.blocks.push({ ...clone(f.ctx.state.blocks[0]), id: 'stale', date: '2026-09-09',
      category: 'ルーティン', actualStartAt: '2026-09-09T23:10:00', actualEndAt: '' });
    return () => f.ctx.setBlockTime('b', 'actualStartAt');
  }],
  ['end', f => () => f.ctx.setBlockTime('b', 'actualEndAt')],
  ['complete', f => () => f.ctx.toggleBlock('b')],
  ['stale close', f => {
    f.ctx.state.blocks[0].category = 'ルーティン';
    f.ctx.state.blocks[0].date = '2026-09-09';
    f.ctx.state.blocks[0].actualStartAt = '2026-09-09T23:10:00';
    return () => f.ctx.autoCloseStaleRoutineRuns('another');
  }],
  ['actual modal', f => {
    f.input = { actualStartAt: `${DATE}T09:17`, actualEndAt: `${DATE}T09:53`, charge: '4', comment: 'typed' };
    return () => f.ctx.saveActualEntryFromModal('b', f.input);
  }],
  ['task completion', f => {
    f.ctx.state.blocks[0].taskId = 'task';
    f.ctx.state.tasks = [{ id: 'task', status: 'todo', progressDen: 1 }];
    return () => f.ctx.toggleTaskCompleteFromBlock('b');
  }],
  ['bulk approval', f => () => f.ctx.bulkApproveAsPlanned()]
];
for (const [name, prepare] of lifecycle) test(`${name}: Block failure prevents later effects; retry stamps once`, async () => {
  const f = await lifecycleFixture(), execute = prepare(f), before = clone(f.ctx.state);
  const input = clone(f.input || {}), blocks = f.ctx.state.blocks, snapshots = clone(f.ctx._quickCompleteSnapshots);
  await withLocalSaveFailure(async (fail, injection) => {
    f.fail(fail);
    assert.equal(execute(), false);
    assert.equal(injection.calls, 1);
    expectRestored(before.blocks, clone(f.ctx.state.blocks));
    assert.equal(f.ctx.state.blocks, blocks);
    assert.equal(f.ctx.state.dataModifiedAt, before.dataModifiedAt);
    expectRestored(input, clone(f.input || {}));
    expectRestored(snapshots, clone(f.ctx._quickCompleteSnapshots));
    assert.equal(f.counts.timer + f.counts.tracking + f.counts.close + f.counts.render + f.counts.autoSync + f.counts.autoSave, 0);
    if (name === 'task completion') {
      // Task precedes the Block boundary and intentionally is not rolled back in 15b.
      assert.equal(f.ctx.state.tasks[0].status, 'completed');
      // Recreate the same completion intent for the isolated Block retry check.
      f.ctx.state.tasks = clone(before.tasks);
    }
    f.fail(null);
    execute();
    const changed = f.ctx.state.blocks[0];
    assert.equal(changed.updatedAt, '2026-09-10T10:05:01');
    assert.equal(changed.createdAt, before.blocks[0].createdAt);
    assert.deepEqual(f.persisted[0].blocks, clone(f.ctx.state.blocks));
    assert.deepEqual(clone(f.ctx.state.blocks[1]), before.blocks[1]);
    assert.equal(f.persisted.filter((image, i) => !i || image.blocks[0].updatedAt !== f.persisted[i - 1].blocks[0].updatedAt).length, 1);
    if (name === 'start and close stale routine') {
      assert.equal(changed.actualStartAt, NOW);
      assert.equal(f.ctx.state.blocks[2].actualEndAt, '2026-09-09T23:59:00');
      assert.equal(f.ctx.state.blocks[2].updatedAt, '2026-09-10T10:05:01');
      assert.equal(f.counts.timer, 2);
    }
    if (name === 'end') assert.equal(changed.actualEndAt, NOW);
    if (name === 'actual modal') {
      assert.equal(changed.actualStartAt, `${DATE}T09:17:00`);
      assert.equal(changed.actualEndAt, `${DATE}T09:53:00`);
    }
    if (name === 'stale close') assert.equal(changed.actualEndAt, '2026-09-09T23:59:00');
    if (name === 'bulk approval') assert.equal(changed.actualEndAt, before.blocks[0].plannedEndAt);
  });
});

test('failed completion undo retains the snapshot for a successful retry', async () => {
  const f = await lifecycleFixture();
  f.ctx.toggleBlock('b');
  const completed = clone(f.ctx.state.blocks[0]), snapshot = clone(f.ctx._quickCompleteSnapshots.b);
  await withLocalSaveFailure(async fail => {
    f.fail(fail);
    assert.equal(f.ctx.toggleBlock('b'), false);
    expectRestored(completed, clone(f.ctx.state.blocks[0]));
    expectRestored(snapshot, clone(f.ctx._quickCompleteSnapshots.b));
    f.fail(null);
    f.ctx.toggleBlock('b');
    assert.equal(f.ctx.state.blocks[0].completed, false);
    assert.equal(f.ctx.state.blocks[0].actualStartAt, '');
    assert.equal(f.ctx.state.blocks[0].actualEndAt, '');
    assert.ok(f.ctx.state.blocks[0].updatedAt > completed.updatedAt);
  });
});

test('stale timer reset is persisted after the Block commit without stamping Blocks again', async () => {
  const f = await lifecycleFixture();
  vm.runInContext(functions(['resetPomodoroForBlock']), f.ctx);
  f.ctx.state.blocks.push({ ...clone(f.ctx.state.blocks[0]), id: 'stale', category: 'ルーティン',
    actualStartAt: `${DATE}T09:00:00`, actualEndAt: '' });
  f.ctx.state.pomodoro = { running: true, blockId: 'stale', startedAt: `${DATE}T09:00:00` };
  const before = clone(f.ctx.state);
  await withLocalSaveFailure(async fail => {
    f.fail(fail);
    assert.equal(f.ctx.setBlockTime('b', 'actualStartAt'), false);
    expectRestored(before, clone(f.ctx.state));
    f.fail(null);
    f.ctx.setBlockTime('b', 'actualStartAt');
    assert.equal(f.counts.writes, 3); // failed Block write, successful Block write, related timer write
    const saved = JSON.parse(f.raw());
    assert.equal(saved.pomodoro.running, false);
    assert.equal(saved.pomodoro.blockId, '');
    assert.equal(saved.blocks[0].actualStartAt, NOW);
    assert.deepEqual(f.persisted[0].blocks, f.persisted[1].blocks);
    assert.equal(saved.blocks[0].updatedAt, '2026-09-10T10:05:01');
  });
});

test('all lifecycle writers alternate with candidate edits and survive merging old copies', async () => {
  const { mergeById } = await import('../src/core/merge.js');
  for (const [, prepare] of lifecycle) {
    const f = await lifecycleFixture(), execute = prepare(f);
    execute();
    const older = clone(f.ctx.state.blocks[0]);
    f.ctx.commitBlockChanges(f.ctx.state.blocks.map(b => b.id === 'b' ? { ...b, comment: 'new candidate' } : b));
    const candidate = clone(f.ctx.state.blocks[0]);
    f.ctx.updateBlockField('b', 'comment', 'last legacy edit');
    const latest = clone(f.ctx.state.blocks[0]);
    assert.ok(latest.updatedAt > candidate.updatedAt && candidate.updatedAt > older.updatedAt);
    assert.deepEqual(mergeById([older, candidate], [latest]), [latest]);
    assert.equal(latest.actualStartAt, older.actualStartAt);
    assert.equal(latest.actualEndAt, older.actualEndAt);
  }
});

test('browser modal keeps typed input after storage failure and saves once on retry', async () => {
  const { chromium, launchOptions, startServer, randomPort, blockGithubApiByDefault, STATE_KEY } = require('./helpers');
  const port = randomPort(), server = startServer(port);
  let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'ja-JP', serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.clock.install({ time: new Date(Date.UTC(2026, 8, 10, 1)) });
    await blockGithubApiByDefault(page);
    await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript',
      body: source + '\nwindow.__blockTest = { openTimelineNewBlock, getState: () => state };' }));
    await page.goto(`http://localhost:${port}`);
    await page.waitForFunction(() => Boolean(window.__blockTest));
    await page.evaluate(key => {
      const state = window.__blockTest.getState();
      state.blocks = [];
      state.selectedDate = '2026-09-10';
      state.settings.autoSyncEnabled = false;
      window.__blockTest.openTimelineNewBlock(600);
      const original = Storage.prototype.setItem;
      window.__storageTest = { fail: true, writes: 0 };
      Storage.prototype.setItem = function(name, value) {
        if (name === key) {
          window.__storageTest.writes++;
          if (window.__storageTest.fail) throw new DOMException('Injected quota', 'QuotaExceededError');
        }
        return original.call(this, name, value);
      };
    }, STATE_KEY);
    const title = page.locator('[data-modal-field="title"]');
    await title.fill('保存失敗でも保持');
    await page.locator('[data-action="modal-save"]').click();
    assert.equal(await title.inputValue(), '保存失敗でも保持');
    assert.equal(await page.evaluate(() => window.__blockTest.getState().blocks.length), 0);
    assert.equal(await page.evaluate(() => window.__storageTest.writes), 1);
    await page.evaluate(() => { window.__storageTest.fail = false; });
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForFunction(() => window.__blockTest.getState().blocks.length === 1);
    assert.equal(await page.evaluate(() => window.__storageTest.writes), 2);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).blocks[0], STATE_KEY);
    assert.equal(saved.title, '保存失敗でも保持');
    assert.equal(saved.plannedStartAt, `${DATE}T10:00:00`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('third carry-over draft confirmation keeps migration ritual outside the save boundary', async () => {
  const f = await fixture(['migrationNextCount', 'openMigrationRitual']);
  f.ctx._migrationRitualCtx = null;
  f.ctx.buildMigrationRitualModal = (block, count) => ({ id: block.id, count });
  f.ctx.state.blocks[0].carryCount = 2;
  f.ctx._scheduleDraft = { date: DATE, items: [{ id: 'draft', carryFromId: 'b', title: 'carry', start: 600, minutes: 30 }] };
  const blocks = clone(f.ctx.state.blocks), draft = clone(f.ctx._scheduleDraft);
  f.ctx.confirmScheduleDraft();
  assert.equal(f.ctx.state.modal.type, 'migrationRitual');
  assert.equal(f.ctx.state.modal.id, 'b');
  assert.equal(f.ctx._migrationRitualCtx.nextCount, 3);
  assert.deepEqual(clone(f.ctx.state.blocks), blocks);
  assert.deepEqual(clone(f.ctx._scheduleDraft), draft);
  assert.equal(f.counts.writes + f.counts.autoSave + f.counts.autoSync, 0);
});


test('fixB2 Block modal deletion failure retains modal, Block and recurrence exceptions', async () => {
  const f = await deletionFixture();
  vm.runInContext(functions(['deleteFromModal']), f.ctx);
  f.ctx.window.confirm = () => true;
  f.ctx.modalDeleteMessage = () => 'delete?';
  const actionSource = fs.readFileSync(path.join(__dirname, '../src/ui/actions.js'), 'utf8');
  const actionAst = acorn.parse(actionSource, { ecmaVersion: 'latest', sourceType: 'module' });
  const dispatcher = actionAst.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'dispatchModalDelete');
  f.ctx.modalHandlerRegistry = new Map([['block', { delete: id => f.ctx.deleteBlock(id) }]]);
  vm.runInContext(actionSource.slice(dispatcher.start, dispatcher.end), f.ctx);
  f.ctx.state.blocks[0].recurrenceGroupId = 'rule';
  Object.assign(f.ctx.state.recurrences[0], { kind: 'weekly', anchorDate: DATE, exceptionDates: [], updatedAt: FUTURE });
  const before = clone(f.ctx.state), blocks = f.ctx.state.blocks, rules = f.ctx.state.recurrences;
  await withLocalSaveFailure(async fail => {
    f.fail(fail);
    f.ctx.deleteFromModal();
    expectRestored(before, clone(f.ctx.state));
    assert.equal(f.ctx.state.blocks, blocks);
    assert.equal(f.ctx.state.recurrences, rules);
    assert.equal(f.counts.close + f.counts.autoSync, 0);
    f.fail(null);
    f.ctx.deleteFromModal();
    assert.equal(f.ctx.state.modal, null);
    assert.equal(f.ctx.state.blocks[0].deleted, true);
    assert.deepEqual(clone(f.ctx.state.recurrences[0].exceptionDates), [DATE]);
    assert.equal(f.counts.close, 1);
    assert.equal(f.counts.writes, 2);
  });
});

test('fixB2 interruption click retries only stop after the second Block save fails', async () => {
  const f = await pomodoroFixture();
  let action;
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Property' && node.key.value === 'interrupt-reason') action = node.value;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
  const click = vm.runInContext('(' + source.slice(action.start, action.end) + ')', f.ctx);
  vm.runInContext(functions(['renderPomodoroInterruptControls']), f.ctx);
  f.ctx.interruptReasonPickerHTML = () => 'reason picker';
  const timer = clone(f.ctx.state.pomodoro);
  await withLocalSaveFailure(async (fail, injection) => {
    f.fail(() => { if (f.counts.writes === 2) fail(); });
    click({ target: { dataset: { reason: 'fatigue' } } });
    assert.equal(injection.calls, 1);
    assert.equal(f.counts.writes, 2);
    assert.equal(f.ctx._pendingInterruptBlockId, 'b');
    assert.equal(f.ctx.renderPomodoroInterruptControls('default'), 'reason picker');
    expectRestored(timer, clone(f.ctx.state.pomodoro));
    assert.equal(f.ctx.state.blocks[0].actualStartAt, DATE + 'T09:00:00');
    assert.deepEqual(clone(f.ctx.state.blocks[0].interruptions), [{ at: NOW, reason: 'fatigue' }]);
    f.fail(null);
    click({ target: { dataset: { reason: 'fatigue' } } });
    assert.equal(f.ctx._pendingInterruptBlockId, null);
    assert.equal(f.ctx.state.pomodoro.running, false);
    assert.equal(f.ctx.state.blocks[0].actualStartAt, '');
    assert.equal(f.ctx.state.blocks[0].interruptions.length, 1);
    assert.equal(f.counts.writes, 4); // reason, failed stop, retry stop, timer effects
    assert.equal(f.ctx.state.blocks[0].updatedAt, '2026-09-10T10:05:02');
  });
});
