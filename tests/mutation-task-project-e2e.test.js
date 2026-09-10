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
