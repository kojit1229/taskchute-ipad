// Node-only contract tests: actual editor save functions and actual transaction/guard.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const acorn = require('acorn'), root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const names = ['saveState', 'saveAndRender', 'closeModal', 'submitModal', 'readModalFields',
  'modalDraftSnapshot', 'requestDraftLeave', 'saveProjectFromModal', 'saveTaskFromModal', 'saveBlockFromModal',
  'runZeroEntry', 'saveZtEntry', 'applyZtEntry', 'saveZtEdit', 'applyZtEdit', 'saveTrackFromForm', 'saveProjectTrackFromModal',
  'readTrackDraft', 'autoCloseStaleRoutineRuns', 'resetPomodoroForBlock', 'transferIronLogToCompletedBlock',
  'trackOnBlockStarted', 'trackOnBlockCompletionChanged', 'autoCommitWeekIfNeeded', 'stampCommitmentCompletion',
  'toggleTaskCompleteFromBlock', 'commitBlockChanges'];
const extracted = names.map(name => {
  const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert(node, name); assert.equal(node.async, false, `${name} must remain synchronous`);
  return source.slice(node.start, node.end);
}).join('\n');
const { commitCandidate, assertNotInsideBuild } = require('../src/core/commit.js');
const factory = ['core/mutation-stamp', 'features/draft-save', 'features/draft-leave']
  .map(name => fs.readFileSync(path.join(root, `src/${name}.js`), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace(/export (function|const)\b/g, '$1')).join('\n');
const init = ast.body.find(n => n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression'
  && n.expression.left.name === 'draftSaveTransaction');
assert(init, 'actual app transaction dependency wiring exists');
const { createZeroEntryDraft, stopZeroEntry, zeroNeedsSave } = require('../src/features/zero-entry.js');
const { createDailyDraftStore } = require('../src/features/daily-draft.js');
const { runDailyOperation } = require('../src/features/daily-operations.js');
const { buildBlockDetailDraft } = require('../src/features/block-detail.js');
const copy = value => JSON.parse(JSON.stringify(value));
function setup(mode, { storageFail = true, completed = false, track = false } = {}) {
  const effects = { persisted: [], schedules: 0, renders: 0, stops: 0, post: [], toasts: [], sequence: [], dialogs: [] };
  let fail = storageFail, nextId = 0;
  const input = { value: 'edited body', isConnected: true, selectionStart: 2, selectionEnd: 5,
    matches: () => true,
    focus() { effects.sequence.push('focus'); }, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
  const fields = [], rows = [];
  const putField = (name, value, type = 'text') => {
    const old = fields.find(f => f.dataset.modalField === name);
    const item = old || { dataset: { modalField: name }, type };
    item.type = type; if (type === 'checkbox') item.checked = value; else item.value = String(value);
    if (!old) fields.push(item); return item;
  };
  const modalRoot = { innerHTML: 'original-form', firstElementChild: { isConnected: true }, classList: { remove() {}, contains: () => Boolean(ctx.state.modal && modalRoot.innerHTML) }, setAttribute() {},
    querySelectorAll: selector => !modalRoot.innerHTML ? [] : selector === '[data-modal-field]' ? fields : selector === '.twy-ms-edit-row' ? rows : [],
    querySelector: () => null };
  const data = { currentView: 'zero', selectedDate: '2026-09-06', dataModifiedAt: '2026-09-06T12:00:00',
    modal: mode.startsWith('zero') ? null : { type: mode === 'new-task' ? 'task' : mode, id: mode === 'new-task' ? '' : mode === 'block' ? 'b' : 'p' },
    settings: { twelveWeekStartDate: '2026-09-05' }, projects: [{ id: 'p', title: 'old project' }],
    tasks: mode === 'block' ? [{ id: 't', status: 'todo' }] : mode === 'task' ? [{ id: 'p', title: 'old task', status: 'todo' }] : [], blocks: mode === 'block' ? [{ id: 'b', title: 'old block', date: '2026-09-06', taskId: 't', completed: false,
      actualStartAt: '', plannedStartAt: '2026-09-06T11:00:00', plannedEndAt: '2026-09-06T12:00:00', comment: 'old' }] : [],
    recurrences: [], reports: {}, journals: {}, weeklyCommitments: [], tracks: [],
    condition: { logs: { '2026-09-06': { gym: [{ id: 'set', blockId: 'b', at: '2026-09-06T11:00:00', reps: 5 }] } } },
    zeroThinking: { entries: [{ id: 'past', body: 'old body', date: '2026-09-01' }], themes: [{ id: 'theme' }] },
    questions: [{ id: 'q', status: 'open' }], pomodoro: { running: false } };
  if (mode === 'new-block') data.modal = { type: 'block', id: 'fresh-block' };
  if (track) data.tracks.push({ id: 'track', projectId: 'p', kind: 'numeric', baselineValue: 0 });
  const listeners = {};
  const document = { activeElement: input, addEventListener: (name, handler) => { listeners[name] = handler; }, querySelector: selector => input.isConnected &&
    ((mode === 'zero-new' && selector === '#zt-write-input') || (mode === 'zero-edit' && selector === '#zt-edit-input')) ? input : null,
    createElement: () => ({ close() {}, remove() {}, showModal() {}, setAttribute() {} }), body: { append: dialog => effects.dialogs.push(dialog) } };
  const ctx = vm.createContext({ commitCandidate, assertNotInsideBuild, state: data, document, modalRoot, modalDraftBaseline: null,
    draftSaveTransaction: null, _lastSaveError: null, _quotaToastShown: false, _blockSaveInFlight: false,
    _migrationRitualCtx: null, _pendingLifecycleCtx: null, _pendingBodyScanCtx: null, _aiStepConfirmCtx: null, _aiStepPending: null,
    ztCurrent: mode === 'zero-new' ? { id: 'theme', text: 'theme', fav: false, questionId: 'q' } : null,
    ztEditId: mode === 'zero-edit' ? 'past' : null, ztWriteStartedAt: 12,
    crypto: { randomUUID: () => `new-${++nextId}` }, nowDateTime: () => '2026-09-06T12:30:00', todayISO: () => '2026-09-06',
    setState: value => { ctx.state = value; },
    persistLocalNoSchedule: () => { effects.sequence.push('persist'); effects.persisted.push(copy(ctx.state)); ctx._lastSaveError = fail ? new Error('QuotaExceededError') : null; },
    scheduleAutoSave: () => effects.schedules++, scheduleAutoSync: () => effects.schedules++,
    render: () => { if (ctx.draftSaveTransaction?.defer(() => ctx.render())) return; effects.renders++; effects.sequence.push('render'); },
    showToast: text => effects.toasts.push(text), console: { error() {} },
    stopZtTimer: () => effects.stops++, makeTask: values => ({ id: `new-${++nextId}`, ...values }),
    twyPlanFromFields: () => ({}), fillProgressOnComplete: () => 1, planParentFor: () => null,
    fromLocalInput: value => value || '', habitStreakEdit: () => ({ ok: true }), syncHabitStreakForBlock() {},
    linkedGymBlock: () => true, localDateTimeToMs: () => 1, gymCommentSummary: sets => sets.length ? 'gym summary' : '',
    generateReport: date => { ctx.state.journals[date] ||= 'fixture journal'; ctx.state.reports[date] = 'fixture report'; ctx.saveState(); },
    weekRange: () => ({ weekStart: '2026-09-05' }), candidateBlocksForWeek: () => ctx.state.blocks,
    commitmentItemForBlock: (_, block) => ({ id: `wci_2026-09-05_${block.id}`, blockId: block.id }),
    upsertWeeklyCommitment: item => { const rows = ctx.state.weeklyCommitments; const i = rows.findIndex(x => x.id === item.id); if (i < 0) rows.push(item); else rows[i] = item; },
    activeTrackForProject: () => ctx.state.tracks[0], validateTrackDraft: () => ({ ok: true }),
    trackDefinitionChanged: () => false, trackDraftMatchesExisting: () => false,
    trackRecord: (projectId, kind, fields) => ({ id: 'candidate-track', projectId, kind, ...fields }),
    window: { confirm: () => true },
    maybeQueueNextAiStep: () => {}, maybeShowTrackProgressToast() {}, closeAiStepConfirmIfUndone() {},
    openBodyScanModal: id => {
      if (ctx.draftSaveTransaction?.defer(() => ctx.openBodyScanModal(id), { post: true })) return;
      ctx.state.modal = { type: 'bodyScan', id }; effects.post.push(id); effects.sequence.push('post');
    }
  });
  Object.assign(ctx, { runDailyOperation, buildBlockDetailDraft, stopZeroEntry, zeroNeedsSave, _imeComposing: false, zeroConnectionKey: () => 'fixture',
    dailyDrafts: createDailyDraftStore({ storage: () => ({ setItem() {} }) }),
    dailyOperationDeps: { state: data, commitCandidate, now: ctx.nowDateTime,
      persist: () => { ctx.persistLocalNoSchedule(); return !ctx._lastSaveError; },
      scheduleSync: () => { ctx.scheduleAutoSave(); ctx.scheduleAutoSync(); } } });
  if (ctx.ztCurrent) {
    data.zeroThinking.themes[0] = { ...ctx.ztCurrent };
    ctx.ztCurrent.zeroDraft = createZeroEntryDraft({ theme: data.zeroThinking.themes[0], id: 'answer', connection: 'fixture', date: ctx.todayISO(), createdAt: ctx.nowDateTime(), startedAt: Date.now() });
  }
  vm.runInContext(factory + '\n' + extracted + '\n' + source.slice(init.start, init.end) + '\nconst draftLeaveGuard = createDraftLeaveGuard(document);', ctx);
  ctx.dispatchModalSave = (type, id, values) => ({ project: ctx.saveProjectFromModal, task: ctx.saveTaskFromModal, block: ctx.saveBlockFromModal })[type](id, values);
  putField('title', 'new title');
  if (['block', 'new-block'].includes(mode)) {
    putField('date', '2026-09-06'); putField('plannedStartAt', '2026-09-06T11:00:00'); putField('plannedEndAt', '2026-09-06T12:00:00');
    putField('completed', completed, 'checkbox'); putField('comment', 'edited memo'); putField('taskId', mode === 'block' ? 't' : '');
  }
  if (track) {
    putField('is12WY', true, 'checkbox'); putField('twyKind', 'numeric'); putField('twyName', 'edited goal');
    putField('twyBaseline', 0, 'number'); putField('twyGoal', 10, 'number');
  }
  vm.runInContext('modalDraftBaseline = modalDraftSnapshot()', ctx);
  const run = options => mode === 'zero-new' ? ctx.saveZtEntry('#zt-write-input', options)
    : mode === 'zero-edit' ? ctx.saveZtEdit('past', options) : ctx.submitModal(options);
  return { ctx, effects, input, fields, rows, modalRoot, document, listeners, putField, run, fail: value => { fail = value; },
    state: () => ctx.state, baseline: () => vm.runInContext('modalDraftBaseline = modalDraftSnapshot()', ctx) };
}
let count = 0;
function test(name, action) { action(); count++; console.log(`PASS ${name}`); }
for (const mode of ['project', 'task', 'new-task', 'new-block', 'block', 'zero-new', 'zero-edit']) {
  test(`${mode}: persistence failure preserves original state/DOM/owner; retry commits once`, () => {
    const x = setup(mode, { completed: mode === 'block', track: mode === 'project' });
    const original = x.state(), before = copy(original), owner = x.ctx.ztCurrent;
    const result = x.run();
    assert.equal(result.ok, false);
    if (mode === 'zero-new') assert.match(result.error.message, /local persistence failed/, 'registry returns commitCandidate failure');
    else assert.equal(result.reason, 'storage-failed');
    assert.equal(x.state(), original); assert.deepEqual(x.state(), before);
    assert.equal(x.modalRoot.innerHTML, 'original-form'); assert.equal(x.ctx.ztCurrent, owner);
    if (mode === 'zero-edit') assert.equal(x.ctx.ztEditId, 'past');
    assert.equal(x.effects.renders, 0); assert.equal(x.effects.stops, 0); assert.equal(x.effects.schedules, 0);
    assert.equal(x.effects.post.length, 0); assert.equal(x.effects.persisted.length, 1);
    x.fail(false); const success = x.run(); assert.equal(success.ok, true);
    assert.equal(x.effects.persisted.length, 2, 'one write per attempt despite nested saveState');
    assert.equal(x.effects.schedules, 2, 'one autoSave and one autoSync');
    if (mode === 'new-task') assert.equal(x.state().tasks.length, 1);
    if (mode === 'task') { assert.equal(x.state().tasks.length, 1); assert.equal(x.state().tasks[0].title, 'new title'); }
    if (mode === 'new-block') assert.equal(x.state().blocks.length, 1);
    if (mode === 'zero-new') { assert.equal(x.state().zeroThinking.entries.length, 2); assert.equal(x.state().zeroThinking.themes.length, 0); assert.equal(x.state().questions[0].status, 'deepening'); }
    if (mode === 'project') { assert.equal(x.state().tracks.length, 1); assert.equal(x.state().tracks[0].name, 'edited goal'); }
    if (mode === 'block') { assert.equal(x.state().blocks[0].completed, true); assert.match(x.state().blocks[0].comment, /edited memo.*\ngym summary/); assert.equal(x.state().reports['2026-09-06'], 'fixture report'); assert.ok(x.state().weeklyCommitments.some(row => row.completedAt)); }
  });
}
test('H1 milestone label/date/ID/order and added/deleted rows change the snapshot', () => {
  const x = setup('project');
  const label = { value: 'first' }, date = { value: '2026-09-06' };
  const row = { dataset: { twyMsId: 'ms1' }, querySelector: selector => selector.includes('label') ? label : date };
  x.rows.push(row); x.baseline(); const original = x.ctx.modalDraftSnapshot();
  for (const change of [() => { label.value = 'second'; }, () => { date.value = '2026-09-07'; }, () => { row.dataset.twyMsId = 'ms2'; }, () => { x.rows.push({ ...row, dataset: { twyMsId: 'another' } }); }, () => { x.rows.reverse(); }, () => { x.rows.pop(); }]) {
    const before = x.ctx.modalDraftSnapshot(); change(); assert.notEqual(x.ctx.modalDraftSnapshot(), before);
  }
  assert.notEqual(x.ctx.modalDraftSnapshot(), original);
});
test('M3 successful Block save returns success and runs navigation before body scan exactly once', () => {
  const x = setup('block', { storageFail: false, completed: true });
  const result = x.run({ deferPost: true }); assert.equal(result.ok, true);
  assert.equal(x.effects.post.length, 0); x.effects.sequence.push('leave'); result.afterLeave(); result.afterLeave();
  assert.equal(x.effects.post.length, 1); assert.ok(x.effects.sequence.indexOf('leave') < x.effects.sequence.indexOf('post'));
});
test('validation failure writes nothing and does not clear editor', () => {
  const x = setup('new-block', { storageFail: false }); x.putField('plannedStartAt', '');
  const original = x.state(); const result = x.run();
  assert.equal(result.reason, 'invalid'); assert.equal(x.state(), original); assert.equal(x.effects.persisted.length, 0); assert.equal(x.effects.renders, 0);
});
test('thrown save discards candidate and queued effects, then a later save works', () => {
  const x = setup('project', { storageFail: false }); const original = x.state();
  const result = x.ctx.draftSaveTransaction.run(() => { x.state().projects[0].title = 'partial'; x.ctx.closeModal(); throw new Error('fixture'); });
  assert.equal(result.reason, 'exception'); assert.equal(x.state(), original); assert.equal(x.modalRoot.innerHTML, 'original-form');
  assert.equal(x.ctx.draftSaveTransaction.active, false); assert.equal(x.run().ok, true);
});
test('M3 real Block-to-Task completion continuation and body scan occur once after guarded save', () => {
  const x = setup('block', { storageFail: false, completed: true }); x.putField('comment', 'changed after opening');
  let continued = 0;
  assert.equal(x.ctx.requestDraftLeave(() => { continued++; x.ctx.toggleTaskCompleteFromBlock('b'); }, { allowDiscard: false }), true);
  vm.runInContext('draftLeaveGuard.resolve("save"); draftLeaveGuard.resolve("save");', x.ctx);
  assert.equal(continued, 1); assert.equal(x.state().tasks[0].status, 'completed');
  assert.equal(x.effects.post.length, 1); assert.match(x.state().blocks[0].comment, /changed after opening/);
});
test('stay and failed save return to last editor input and selection, not clicked navigation button', () => {
  const x = setup('project'); x.putField('title', 'changed');
  x.listeners.focusin({ target: x.input });
  x.document.activeElement = { isConnected: true, focus() { throw new Error('must not focus nav button'); } };
  for (const choice of ['stay', 'save']) {
    assert.equal(x.ctx.requestDraftLeave(() => { throw new Error('must stay'); }), true);
    vm.runInContext(`draftLeaveGuard.resolve('${choice}')`, x.ctx);
    assert.equal(x.input.selectionStart, 2); assert.equal(x.input.selectionEnd, 5);
  }
  assert.equal(x.effects.sequence.filter(x => x === 'focus').length, 2);
});
test('new zero entry success followed by duplicate direct save does not add another record', () => {
  const x = setup('zero-new', { storageFail: false }); assert.equal(x.run().ok, true);
  assert.equal(x.run().ok, false); assert.equal(x.state().zeroThinking.entries.length, 2);
  assert.equal(x.effects.persisted.length, 1);
});
test('native dialog cancellation clears the pending leave without losing draft', () => {
  const x = setup('project'); x.putField('title', 'edited title'); let prevented = false;
  x.ctx.requestDraftLeave(() => { throw new Error('must not leave'); });
  x.listeners.cancel({ target: x.effects.dialogs[0], preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(vm.runInContext('draftLeaveGuard.active', x.ctx), false);
  assert.equal(x.modalRoot.innerHTML, 'original-form'); assert.equal(x.effects.persisted.length, 0);
});
test('committed saves remain successful through schedule/render/post errors and finish all remaining effects once', () => {
  const x = setup('project', { storageFail: false }); const events = []; let writes = 0;
  const transaction = x.ctx.createDraftSaveTransaction({ now: x.ctx.nowDateTime, getState: () => x.state(), setState: value => { x.ctx.state = value; },
    persist: () => { writes++; return true; }, schedule: () => { events.push('schedule'); throw new Error('schedule'); },
    onFailure: () => { throw new Error('must not mark committed save failed'); },
    onEffectError: () => { events.push('effect-error'); throw new Error('reporter also failed'); } });
  const result = transaction.run(() => {
    x.state().projects[0].title = 'changed for committed-effects test';
    transaction.defer(() => { events.push('close'); x.ctx.state.modal = null; });
    transaction.complete(() => { events.push('render'); throw new Error('render'); });
    transaction.defer(() => events.push('remaining-ui'));
    transaction.defer(() => { events.push('post-throws'); throw new Error('post'); }, { post: true });
    transaction.defer(() => events.push('remaining-post'), { post: true });
  }, { deferPost: true });
  assert.equal(result.ok, true); assert.equal(writes, 1); assert.equal(x.state().modal, null);
  assert.ok(events.includes('remaining-ui')); assert.equal(events.includes('remaining-post'), false);
  result.afterLeave(); result.afterLeave();
  assert.equal(events.filter(x => x === 'remaining-post').length, 1);
  assert.equal(events.filter(x => x === 'effect-error').length, 3);
});
test('a throwing failure reporter cannot prevent state restoration or block the next transaction', () => {
  const x = setup('project'), original = x.state(); let failing = true;
  const transaction = x.ctx.createDraftSaveTransaction({ now: x.ctx.nowDateTime, getState: () => x.state(), setState: value => { x.ctx.state = value; },
    persist: () => !failing, schedule() {}, onFailure: () => { throw new Error('reporter failed'); } });
  const save = () => transaction.run(() => { x.state().projects[0].title = 'candidate'; transaction.complete(); });
  assert.equal(save().reason, 'storage-failed'); assert.equal(x.state(), original); assert.equal(transaction.active, false);
  failing = false; assert.equal(save().ok, true);
});
// D06 / 設計03「新旧の保存が交差しても更新時刻を戻さない」: 内容無変更は発行しない。
for (const [mode, kind] of [['task', 'tasks'], ['project', 'projects'], ['block', 'blocks']]) {
  test(`${mode}: unchanged opened record keeps stamps and bypasses persistence even when storage fails`, () => {
    const x = setup(mode, { storageFail: true });
    x.state()[kind][0].updatedAt = '2026-09-06T12:30:00';
    x.state()[kind].push({ id: 'unrelated', updatedAt: '2400-01-01T00:00:00' });
    const original = x.state(), before = copy(original);
    const save = () => x.ctx.draftSaveTransaction.run(() => x.ctx.draftSaveTransaction.complete());
    for (const failing of [true, false]) {
      x.fail(failing); assert.equal(save().ok, true);
      assert.equal(x.state(), original); assert.deepEqual(x.state(), before);
      assert.equal(x.state()[kind][0].updatedAt, '2026-09-06T12:30:00');
      assert.equal(x.state().dataModifiedAt, '2026-09-06T12:00:00');
      assert.equal(x.effects.persisted.length, 0); assert.equal(x.effects.schedules, 0);
    }
  });
}
console.log(`PASS draft save transaction: ${count} cases`);
