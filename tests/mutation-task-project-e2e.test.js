// Order 66 / 16a: actual legacy writers and shared commitCandidate, isolated fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const { withLocalSaveFailure, expectRestored, deepCommitGuard, chromium, launchOptions,
  startServer, randomPort, blockGithubApiByDefault, passGithubGate } = require('./helpers');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const extract = name => {
  const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node, `actual writer ${name}`);
  return source.slice(node.start, node.end);
};
const names = ['makeTask', 'addTask', 'addProject', 'deleteProject', 'saveTaskFromModal',
  'saveProjectFromModal', 'toggleTask', 'deleteTask', 'toggleMIT', 'updateTaskField',
  'updateTaskProgress', 'setEntityStatus', 'updateCategoryField', 'deleteFromModal',
  'fillProgressOnComplete', 'deriveStatusFromProgress'];
const NOW = '2026-09-10T10:00:00', FUTURE = '2026-09-10T10:05:00';
const clone = value => JSON.parse(JSON.stringify(value));
async function fixture() {
  const { createDraftSaveTransaction } = await import('../src/features/draft-save.js');
  const { commitCandidate, setCommitGuard } = await import('../src/core/commit.js');
  const { stamped } = await import('../src/core/mutation-stamp.js');
  setCommitGuard(deepCommitGuard);
  let failure, raw, seq = 0;
  const counts = { writes: 0, sync: 0, render: 0, close: 0, queue: 0 };
  const inputs = { '#taskTitle': { value: 'typed task' }, '#taskProject': { value: 'p' },
    '#projectTitle': { value: 'typed project' }, '#projectKind': { value: 'normal' } };
  const ctx = vm.createContext({ stamped, commitCandidate, Date, JSON, Map, Set,
    crypto: { randomUUID: () => `new-${++seq}` }, nowDateTime: () => NOW, todayISO: () => '2026-09-10',
    document: { querySelector: selector => inputs[selector] }, window: { confirm: () => true },
    twyPlanFromFields: (_fields, previous) => previous || {}, planParentFor: () => null,
    saveProjectTrackFromModal: () => true, activeTrackForProject: () => null,
    showToast: message => { ctx.lastToast = message; },
    render: () => { counts.render++; },
    closeModal: () => { if (ctx.draftSaveTransaction.defer(() => ctx.closeModal())) return; counts.close++; ctx.state.modal = null; },
    maybeQueueNextAiStep: () => { if (ctx.draftSaveTransaction.defer(() => ctx.maybeQueueNextAiStep(), { post: true })) return; counts.queue++; },
    closeAiStepConfirmIfUndone: () => { counts.close++; },
    modalDeleteMessage: () => 'delete?', dispatchModalDelete: () => { throw new Error('Task/Project must propagate save result'); }
  });
  vm.runInContext(names.map(extract).join('\n'), ctx);
  ctx.state = { selectedDate: '2026-09-10', dataModifiedAt: FUTURE, lastPushedAt: NOW,
    settings: { categories: [{ id: 'cat', name: 'work' }], visionDirectCategories: [] },
    projects: [{ id: 'p', title: 'project', kind: 'normal', category: 'work', status: 'active', createdAt: NOW, updatedAt: FUTURE }],
    tasks: [{ id: 't', projectId: 'p', title: 'task', category: 'work', status: 'todo', progressNum: 0, progressDen: 10, createdAt: NOW, updatedAt: FUTURE }],
    blocks: [{ id: 'b', taskId: 't', title: 'block', category: 'work', date: '2026-09-10', createdAt: NOW, updatedAt: FUTURE }],
    tracks: [{ id: 'track', ownerType: 'project', ownerId: 'p', status: 'active', updatedAt: FUTURE }],
    recurrences: [], modal: { type: 'task', id: 't' } };
  raw = JSON.stringify(ctx.state);
  ctx.draftSaveTransaction = createDraftSaveTransaction({ getState: () => ctx.state,
    setState: value => { ctx.state = value; }, now: () => NOW,
    persist: () => { counts.writes++; if (failure) failure(); raw = JSON.stringify(ctx.state); return true; },
    schedule: () => { counts.sync++; }, onFailure: error => { ctx.lastError = error; } });
  vm.runInContext(['saveState', 'saveAndRender'].map(extract).join('\n'), ctx);
  return { ctx, counts, inputs, fail: value => { failure = value; }, raw: () => raw };
}
const operations = [
  ['addTask', f => () => f.ctx.addTask()], ['addProject', f => () => f.ctx.addProject()],
  ['deleteProject', f => () => f.ctx.deleteProject('p')],
  ['saveTaskFromModal', f => () => f.ctx.saveTaskFromModal('t', { title: 'edited', status: 'completed' })],
  ['createTaskFromModal', f => () => f.ctx.saveTaskFromModal('', { title: 'created', projectId: 'p' })],
  ['saveProjectFromModal', f => () => f.ctx.saveProjectFromModal('p', { title: 'edited project' })],
  ['toggleTask', f => () => f.ctx.toggleTask('t')],
  ['undoTask', f => { f.ctx.state.tasks[0].status = 'completed'; return () => f.ctx.toggleTask('t'); }],
  ['deleteTask', f => () => f.ctx.deleteTask('t')],
  ['toggleMIT', f => () => f.ctx.toggleMIT('b')],
  ['updateTaskField', f => () => f.ctx.updateTaskField('t', 'status', 'completed')],
  ['updateTaskProgress', f => () => f.ctx.updateTaskProgress('t', 'progressNum', '10')],
  ['taskStatus', f => () => f.ctx.setEntityStatus('tasks', 't', 'suspended', 'suspended')],
  ['projectStatus', f => () => f.ctx.setEntityStatus('projects', 'p', 'paused', 'paused')],
  ['updateCategoryField', f => () => f.ctx.updateCategoryField('cat', 'name', 'renamed')],
  ['deleteTaskModal', f => () => f.ctx.deleteFromModal()],
  ['deleteProjectModal', f => { f.ctx.state.modal = { type: 'project', id: 'p' }; return () => f.ctx.deleteFromModal(); }]
];
for (const [name, prepare] of operations) test(`16a ${name}: failure restores all records/input; one explicit retry`, async () => {
  const f = await fixture(), execute = prepare(f), reference = f.ctx.state;
  const before = clone(reference), input = clone(f.inputs), persistedBefore = f.raw();
  await withLocalSaveFailure(async (fail, injection) => {
    f.fail(fail);
    execute();
    assert.equal(injection.calls, 1, 'reached persistence failure');
    assert.equal(f.ctx.state, reference);
    expectRestored(before, clone(f.ctx.state));
    expectRestored(input, clone(f.inputs));
    assert.equal(f.raw(), persistedBefore);
    assert.equal(f.counts.sync + f.counts.render + f.counts.close + f.counts.queue, 0);
    f.fail(null);
    execute();
    assert.equal(f.counts.writes, 2);
    assert.equal(f.counts.sync, 1);
    assert.ok(f.ctx.state.dataModifiedAt > FUTURE);
    const saved = JSON.parse(f.raw());
    let changed = 0;
    for (const kind of ['tasks', 'projects', 'blocks', 'tracks']) {
      assert.deepEqual(saved[kind], clone(f.ctx.state[kind]));
      for (const row of f.ctx.state[kind]) {
        const old = before[kind].find(r => r.id === row.id);
        if (JSON.stringify(old) === JSON.stringify(row)) continue;
        changed++;
        assert.ok(row.updatedAt > (old?.updatedAt || NOW), `${kind}/${row.id} monotonic`);
        if (old) assert.equal(row.createdAt, old.createdAt);
      }
    }
    assert.ok(changed > 0);
    if (name === 'toggleTask') assert.equal(f.ctx.state.blocks[0].deleted, true);
    if (name === 'deleteTask' || name === 'deleteTaskModal') assert.equal(f.ctx.state.blocks[0].taskId, '');
    if (name === 'updateTaskField') assert.equal(f.ctx.state.tasks[0].progressNum, 10);
  });
});
test('16a same-second legacy/candidate updates, project reassignment and deletion preserve latest', async () => {
  const f = await fixture(), { mergeById } = await import('../src/core/merge.js');
  for (const kind of ['tasks', 'projects']) {
    const id = kind === 'tasks' ? 't' : 'p';
    const history = [];
    const edit = kind === 'tasks' ? () => f.ctx.updateTaskField(id, 'projectId', 'other-project')
      : () => f.ctx.setEntityStatus(kind, id, 'paused', 'paused');
    const remove = kind === 'tasks' ? () => f.ctx.deleteTask(id) : () => f.ctx.deleteProject(id);
    for (const execute of [edit, () => f.ctx.commitCandidate({ state: f.ctx.state, now: NOW,
      build: s => ({ records: [{ kind, before: s[kind][0], after: { ...s[kind][0], title: 'candidate' } }] }), persist: () => true }).ok, remove]) {
      const before = clone(f.ctx.state[kind][0]); history.push(before);
      assert.equal(execute(), true);
      const row = clone(f.ctx.state[kind][0]);
      assert.ok(row.updatedAt > before.updatedAt);
      assert.deepEqual(mergeById([row], history), [row]);
      assert.deepEqual(mergeById(history, [row]), [row]);
    }
  }
});
test('16a unchanged save and invalid input issue no clock or writes', async () => {
  const f = await fixture(), before = clone(f.ctx.state);
  assert.equal(f.ctx.updateTaskField('t', 'title', 'task'), true);
  assert.equal(f.ctx.setEntityStatus('projects', 'p', 'active', ''), true);
  assert.equal(f.ctx.saveTaskFromModal('', { title: '  ' }), false);
  expectRestored(before, clone(f.ctx.state));
  assert.equal(f.counts.writes + f.counts.sync + f.counts.close, 0);
});
test('16a target Task/Project writers contain no raw updatedAt assignment', () => {
  for (const name of names.filter(n => !['deleteProject', 'saveTaskFromModal'].includes(n))) {
    assert.doesNotMatch(extract(name), /updatedAt\s*:\s*(?:nowDateTime\(|changedAt)/, name);
  }
  assert.doesNotMatch(extract('saveTaskFromModal'), /updatedAt\s*:/);
  assert.doesNotMatch(extract('deleteProject'), /project[^\n]*updatedAt\s*:/);
});
test('16a actual WBS change handlers keep DOM input on failed save; retry saves status/progress together', async () => {
  const port = randomPort(), server = startServer(port);
  let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Asia/Tokyo' });
    const page = await context.newPage();
    page.on('pageerror', error => console.error('browser pageerror:', error.message));
    page.on('console', message => { if (message.type() === 'error') console.error('browser console:', message.text()); });
    await page.clock.install({ time: new Date(2026, 8, 10, 10, 0, 0) });
    await blockGithubApiByDefault(page);
    await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript',
      body: source + '\nwindow.__b2 = { get state() { return state; }, updateTaskField };' }));
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => Boolean(window.__b2));
    await passGithubGate(page);
    for (const progress of [false, true]) {
      await page.evaluate(progress => {
        const state = window.__b2.state;
        state.tasks = [{ id: 'b2-input', title: 'fixture', status: 'todo', progressNum: 0, progressDen: 10, updatedAt: '2026-09-10T10:00:00' }];
        const before = JSON.stringify(state.tasks), reference = state.tasks;
        const el = document.createElement('input');
        el.dataset.id = 'b2-input';
        if (progress) el.dataset.wbsProgress = 'num'; else el.dataset.wbsEdit = 'status';
        el.value = progress ? '10' : 'completed'; document.querySelector('#app').append(el);
        const original = Storage.prototype.setItem;
        window.__b2Input = { before, reference, el, original, writes: 0, fail: true };
        Storage.prototype.setItem = function(key, value) { if (key === 'taskchute-journal-pwa-state-v1') { window.__b2Input.writes++; if (window.__b2Input.fail) throw new Error('Injected save failure'); } return original.call(this, key, value); };
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, progress);
      await page.waitForFunction(() => window.__b2Input.writes > 0);
      const failed = await page.evaluate(() => {
        const { before, reference, el, writes } = window.__b2Input;
        return { restored: JSON.stringify(window.__b2.state.tasks) === before,
          same: window.__b2.state.tasks === reference, input: el.value, attached: el.isConnected, writes };
      });
      assert.deepEqual(failed, { restored: true, same: true, input: progress ? '10' : 'completed', attached: true, writes: 1 });
      await page.evaluate(() => {
        const { el } = window.__b2Input;
        window.__b2Input.fail = false;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForFunction(() => window.__b2Input.writes > 1);
      const result = await page.evaluate(() => {
        const { original, writes } = window.__b2Input;
        Storage.prototype.setItem = original;
        return { writes, task: window.__b2.state.tasks[0] };
      });
      assert.equal(result.writes, 2);
      assert.equal(result.task.status, 'completed');
      assert.equal(result.task.progressNum, 10);
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});

const planWriters = ['ensurePlanSiblingOrders', 'togglePlanStepOwner', 'movePlanStep', 'addPlanStepBelow',
  'approvePlanStepDraft', 'resolveAiStepConfirmSend', 'compensateAiStepRequest', 'addWeeklySuggestedTask', 'submitQuestionBridge'];
const wishSource = fs.readFileSync(path.join(__dirname, '../src/features/wish.js'), 'utf8');
const wishAst = acorn.parse(wishSource, { ecmaVersion: 'latest', sourceType: 'module' });
const wishWriters = ['addWish', 'addWishSubtask', 'toggleWishSubtask', 'realizeWish', 'unrealizeWish', 'deleteWish'];
const wishExtract = name => { const node = wishAst.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name); return wishSource.slice(node.start, node.end); };
async function planFixture() {
  const f = await fixture(), c = f.ctx;
  Object.assign(c.state.tasks[0], { planTarget: true, parentTaskId: '' });
  c.state.tasks.push(...['step', 'next'].map((id, i) => ({ id, title: id, parentTaskId: 't', projectId: 'p',
    status: i ? 'todo' : 'completed', owner: i ? 'ai' : 'k', aiStatus: 'none', order: null,
    createdAt: NOW, updatedAt: FUTURE })));
  c.state.projects.push({ id: 'other', kind: 'other' }, { id: 'wish', kind: 'wish' });
  Object.assign(c.state, { aiStepPendingRequests: [{ requestId: 'request', taskId: 'next' }], aiStepDismissedIds: [],
    wishOpenId: 't', questions: [{ id: 'q', text: 'question', updatedAt: FUTURE }] });
  f.inputs['#wishTitle'] = { value: 'typed wish' };
  f.inputs['[data-ai-step-confirm-note]'] = { value: 'typed handoff' };
  f.inputs['[data-qb-text]'] = { value: 'typed conclusion' };
  f.inputs['[data-qb-target]'] = { value: '__new__' };
  f.counts.send = 0; f.counts.open = 0; f.counts.view = 0;
  Object.assign(c, {
    _planStepDraft: { taskId: 't', steps: [{ title: 'new step', owner: 'ai', aiBrief: 'brief', note: 'note' }] },
    _planStepUi: { kind: 'ready' }, _planStepPending: null, _scheduleDraft: null,
    _aiStepConfirmCtx: { stepTaskId: 'step', nextStepTaskId: 'next' },
    _weeklySuggestRegistered: new Set(), cachedWeeklyReviewMd: { week: 'fixture markdown' },
    splitWeeklyReviewMd: () => ({ tasks: ['suggested task'] }), parseSuggestedTaskTitle: raw => ({ title: raw, estimateMin: 25 }),
    planParentFor: task => c.state.tasks.find(t => t.id === task.parentTaskId && t.planTarget),
    planStepSiblings: task => c.state.tasks.filter(t => t.parentTaskId === task.parentTaskId && !t.deleted).sort((a, b) => (a.order || 0) - (b.order || 0)),
    planStepVisibleSiblings: task => c.planStepSiblings(task),
    nextSiblingOrder: tasks => Math.max(0, ...tasks.map(t => t.order || 0)) + 1000,
    midpointOrder: (a, b) => (a + b) / 2,
    openTaskCreator: () => { f.counts.open++; }, personalDataReady: () => true,
    putAiStepRequest: () => { f.counts.send++; }, setView: () => { f.counts.view++; },
    modalRoot: { querySelector: selector => f.inputs[selector] },
    taskTransaction: () => c.draftSaveTransaction, wishSubtaskDraft: null, getWishProject: () => c.state.projects.find(p => p.kind === 'wish')
  });
  c.window.prompt = () => 'typed subtask';
  vm.runInContext(planWriters.map(extract).concat(wishWriters.map(wishExtract)).join('\n'), c);
  return f;
}
const planOperations = [
  ['ensurePlanSiblingOrders', f => () => f.ctx.ensurePlanSiblingOrders(f.ctx.state.tasks[1], NOW)],
  ['togglePlanStepOwner', f => () => f.ctx.togglePlanStepOwner('step')],
  ['movePlanStep', f => () => f.ctx.movePlanStep('step', 1)],
  ['addPlanStepBelow', f => () => f.ctx.addPlanStepBelow('step')],
  ['approvePlanStepDraft', f => () => f.ctx.approvePlanStepDraft()],
  ['resolveAiStepConfirmSend', f => () => f.ctx.resolveAiStepConfirmSend()],
  ['compensateAiStepRequest', f => () => f.ctx.compensateAiStepRequest('request', 'next')],
  ['addWeeklySuggestedTask', f => () => f.ctx.addWeeklySuggestedTask('week', 0)],
  ['submitQuestionBridge project', f => { f.ctx.state.modal = { type: 'questionBridge', id: 'q' }; return () => f.ctx.submitQuestionBridge(); }],
  ['submitQuestionBridge task', f => { f.ctx.state.modal = { type: 'questionBridge', id: 'q' }; f.inputs['[data-qb-target]'].value = 'p'; return () => f.ctx.submitQuestionBridge(); }],
  ...wishWriters.map(name => [name, f => () => f.ctx[name](name.includes('Subtask') ? 'step' : 't')])
];
for (const [name, prepare] of planOperations) test(`16b ${name}: rollback includes input and related state; effects follow one successful save`, async () => {
  const f = await planFixture(), execute = prepare(f), reference = f.ctx.state, before = clone(reference);
  const input = clone(f.inputs), draft = f.ctx._planStepDraft, ui = f.ctx._planStepUi, confirm = f.ctx._aiStepConfirmCtx;
  const raw = f.raw();
  await withLocalSaveFailure(async (fail, injection) => {
    f.fail(fail); execute();
    assert.equal(injection.calls, 1, f.ctx.lastError?.stack || 'must reach failing local persistence');
    assert.equal(f.ctx.state, reference);
    expectRestored(before, clone(f.ctx.state)); expectRestored(input, clone(f.inputs));
    assert.equal(f.raw(), raw);
    assert.equal(f.ctx._planStepDraft, draft); assert.equal(f.ctx._planStepUi, ui); assert.equal(f.ctx._aiStepConfirmCtx, confirm);
    assert.equal(f.ctx._weeklySuggestRegistered.size, 0);
    assert.equal(f.counts.render + f.counts.close + f.counts.queue + f.counts.send + f.counts.open + f.counts.view + f.counts.sync, 0);
    f.fail(null); execute();
    assert.equal(f.counts.writes, 2); assert.equal(f.counts.sync, 1);
    assert.ok(f.ctx.state.dataModifiedAt > FUTURE);
    const saved = JSON.parse(f.raw());
    for (const kind of ['tasks', 'projects', 'questions']) {
      assert.deepEqual(saved[kind], clone(f.ctx.state[kind]));
      for (const row of f.ctx.state[kind]) {
        const prior = before[kind].find(old => old.id === row.id);
        if (JSON.stringify(row) !== JSON.stringify(prior)) assert.ok(row.updatedAt > (prior?.updatedAt || NOW), kind + '/' + row.id);
      }
    }
    if (name === 'resolveAiStepConfirmSend') { assert.equal(f.counts.send, 1); assert.equal(f.ctx.state.tasks[2].handoffNote, 'typed handoff'); }
    if (name === 'addPlanStepBelow') assert.equal(f.counts.open, 1);
    if (name === 'approvePlanStepDraft') assert.equal(f.ctx._planStepDraft, null);
    if (name === 'addWeeklySuggestedTask') assert.equal(f.ctx._weeklySuggestRegistered.size, 1);
    if (name === 'addWish') assert.equal(f.inputs['#wishTitle'].value, '');
    if (name === 'deleteWish') assert.ok(f.ctx.state.tasks.every(t => t.deleted));
  });
});
test('16b renumbering an already numbered plan and unrealizing an unchanged wish issue no stamps', async () => {
  const f = await planFixture();
  assert.ok(f.ctx.ensurePlanSiblingOrders(f.ctx.state.tasks[1], NOW));
  const before = clone(f.ctx.state), counts = { ...f.counts };
  assert.equal(f.ctx.ensurePlanSiblingOrders(f.ctx.state.tasks[1], NOW).changed, false);
  expectRestored(before, clone(f.ctx.state)); assert.deepEqual(f.counts, counts);
  f.ctx.unrealizeWish('t');
  const saved = clone(f.ctx.state), writes = f.counts.writes;
  f.ctx.unrealizeWish('t');
  expectRestored(saved, clone(f.ctx.state)); assert.equal(f.counts.writes, writes);
});
test('16b native subtask prompt retains the entered title for retry after persistence failure', async () => {
  const f = await planFixture();
  let prompts = 0;
  f.ctx.window.prompt = () => { prompts++; return prompts === 1 ? 'retained prompt title' : ''; };
  await withLocalSaveFailure(async fail => {
    f.fail(fail); assert.equal(f.ctx.addWishSubtask('t'), false);
    f.fail(null); assert.equal(f.ctx.addWishSubtask('t'), true);
    assert.equal(prompts, 1);
    assert.equal(f.ctx.state.tasks.at(-1).title, 'retained prompt title');
    assert.equal(f.counts.writes, 2);
  });
});
test('16b singleton reconciliation stamps changed candidates without mutating inputs; repeated reconciliation is unchanged', async () => {
  const syncSource = fs.readFileSync(path.join(__dirname, '../src/sync/github.js'), 'utf8');
  const syncAst = acorn.parse(syncSource, { ecmaVersion: 'latest', sourceType: 'module' });
  const { nextMutationStamp, stamped } = await import('../src/core/mutation-stamp.js');
  const c = vm.createContext({ nowDateTime: () => NOW, nextMutationStamp, stamped });
  for (const name of ['pickCanonicalSingleton', 'reconcileSingletonDuplicates']) {
    const node = syncAst.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
    vm.runInContext(syncSource.slice(node.start, node.end), c);
  }
  const projects = ['p1', 'p2'].map(id => ({ id, kind: 'other', createdAt: NOW, updatedAt: FUTURE }));
  const tasks = ['t1', 't2'].map(id => ({ id, kind: 'other', projectId: 'p2', createdAt: NOW, updatedAt: FUTURE }));
  const blocks = [{ id: 'b', taskId: 't2', createdAt: NOW, updatedAt: FUTURE }];
  const before = clone({ tasks, projects, blocks });
  const result = c.reconcileSingletonDuplicates(tasks, projects, blocks);
  expectRestored(before, clone({ tasks, projects, blocks }));
  for (const kind of ['tasks', 'projects', 'blocks']) for (const row of result[kind]) {
    const old = before[kind].find(r => r.id === row.id);
    if (JSON.stringify(row) !== JSON.stringify(old)) assert.equal(row.updatedAt, '2026-09-10T10:05:01');
    assert.equal(row.createdAt, old.createdAt);
  }
  const twice = c.reconcileSingletonDuplicates(result.tasks, result.projects, result.blocks);
  expectRestored(clone(result), clone(twice));
});
test('16b owned Task/Project writers have no raw mutation timestamps; load-time factories use stamped', () => {
  for (const name of planWriters) {
    const body = extract(name);
    assert.doesNotMatch(body, /(?:\bt\.updatedAt\s*=|updatedAt\s*:\s*(?:changedAt|nowDateTime\())/, name);
  }
  for (const name of wishWriters) assert.doesNotMatch(wishExtract(name), /updatedAt\s*:/, name);
  let factories = 0;
  function visit(node, parent, scope) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration') scope = node.id.name;
    if (node.type === 'ObjectExpression' && ['normalizeState', 'seedState'].includes(scope)) {
      const props = node.properties.map(p => p.key?.name);
      // normalizeState creates only the wish/other singletons here; seedState owns the five demo records.
      const taskProject = scope === 'seedState' || ['wish', 'other'].includes(node.properties.find(p => p.key?.name === 'kind')?.value?.value);
      if (taskProject && props.includes('id') && props.includes('title') && props.includes('createdAt') && props.includes('deleted')) {
        assert.equal(parent?.callee?.name, 'stamped', `${scope}: ${props.join(',')}`); assert.ok(!props.includes('updatedAt')); factories++;
      }
    }
    for (const value of Object.values(node)) if (value && typeof value === 'object') {
      if (Array.isArray(value)) value.forEach(n => visit(n, node, scope)); else visit(value, node, scope);
    }
  }
  visit(ast, null, ''); assert.equal(factories, 8);
});


test('fixB2 invalid AI send preconditions close the confirmation sheet without saving', async () => {
  const f = await planFixture();
  f.ctx.state.modal = { type: 'aiStepConfirm' };
  f.ctx.state.tasks.find(t => t.id === 'step').status = 'todo';
  const before = clone(f.ctx.state.tasks);
  f.ctx.resolveAiStepConfirmSend();
  assert.equal(f.ctx.lastToast, '状況が変わったため送信を取りやめました');
  assert.equal(f.ctx.state.modal, null);
  assert.equal(f.counts.close, 1);
  assert.equal(f.counts.writes + f.counts.sync + f.counts.send, 0);
  expectRestored(before, clone(f.ctx.state.tasks));
});
