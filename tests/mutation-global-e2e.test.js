// Node contracts for the sync-storage candidate commit boundary; no browser required.
const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { fixedClock, withLocalSaveFailure, expectRestored } = require("./helpers");
const api = async () => {
  const module = await import(pathToFileURL(path.join(__dirname, "../src/core/commit.js")).href);
  module.setCommitGuard(require("./helpers").deepCommitGuard);
  return module;
};
const epoch = fixedClock(Date.UTC(new Date().getUTCFullYear(), 0, 1))();
const stamp = seconds => new Date(epoch + seconds * 1000).toISOString().slice(0, 19);

async function globalSaveFixture() {
  const fs = require('node:fs'), vm = require('node:vm'), acorn = require('acorn');
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const names = ['saveState', 'saveAndRender', 'saveGlobalInput', 'restoreGlobalInputs'];
  const functions = names.map(name => {
    const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
    assert.ok(node, `actual app function ${name} is connected`);
    return source.slice(node.start, node.end);
  }).join('\n');
  const initialization = ast.body.find(n => n.type === 'ExpressionStatement' && n.expression.left?.name === 'draftSaveTransaction');
  const listener = ast.body.find(n => n.type === 'ExpressionStatement' && n.expression.callee?.object?.name === 'document'
    && n.expression.arguments?.[0]?.value === 'input' && source.slice(n.start, n.end).includes('[data-journal-date]'));
  const branches = listener.expression.arguments[1].body.body.filter(n => n.type === 'IfStatement'
    && /data-((journal|ideal|condition-note)-date|vision-field)/.test(source.slice(n.test.start, n.test.end)));
  const date = stamp(0).slice(0, 10), storage = new Map();
  const state = { dataModifiedAt: stamp(0), settings: { lastPushedAt: stamp(0) }, modal: null,
    journals: { [date]: 'saved' }, journalMeta: {}, reports: {}, tasks: [{ id: 'task', title: 'saved', updatedAt: stamp(0) }] };
  const input = { value: 'typed journal', dataset: { journalDate: date }, selectionStart: 2, selectionEnd: 6,
    matches(selector) { return selector === '[data-journal-date]'; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
  let fail = false, raw = JSON.stringify(state);
  const counts = { writes: 0, autoSave: 0, autoSync: 0, render: 0, feedback: 0, toast: 0 };
  const { commitCandidate, assertNotInsideBuild } = await api();
  const { createDraftSaveTransaction } = await import('../src/features/draft-save.js');
  const ctx = vm.createContext({ state, commitCandidate, assertNotInsideBuild, createDraftSaveTransaction,
    nowDateTime: () => stamp(0), draftSaveTransaction: null, globalInputDrafts: {}, _quotaToastShown: false, _lastSaveError: null,
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    document: { querySelectorAll: () => [input] }, crypto: { randomUUID: () => 'candidate' }, console: { error() {} },
    ensureConditionLog: date => ((ctx.state.condition ||= {}).logs ||= {})[date] ||= { eveningNote: "", eveningRecordedAt: "" },
    setState: value => { ctx.state = value; },
    persistLocalNoSchedule: () => { counts.writes++; ctx._lastSaveError = fail ? new Error('quota') : null;
      if (!fail) raw = JSON.stringify(ctx.state); },
    scheduleAutoSave: () => counts.autoSave++, scheduleAutoSync: () => counts.autoSync++,
    render: () => counts.render++, showToast: () => counts.toast++,
    feedbackUiController: { inputChanged: () => counts.feedback++ }, feedbackReportController: null,
    isArchivedDate: () => false, ARCHIVED_READONLY_MESSAGE: 'archived' });
  vm.runInContext(functions + '\n' + source.slice(initialization.start, initialization.end), ctx);
  const inputEvent = vm.runInContext('(target) => {' + branches.map(n => source.slice(n.start, n.end)).join('\n') + '}', ctx);
  return { ctx, date, input, counts, storage, inputEvent, raw: () => raw, fail: value => { fail = value; } };
}

for (const route of ['normal', 'detail', 'report', 'placement']) test(`${route}: settings lastPushedAt 12:01:00 advances to 12:01:01`, async () => {
  const f = await globalSaveFixture(), pushed = stamp(12 * 3600 + 60);
  f.ctx.state.settings.lastPushedAt = pushed;
  if (route === 'normal') assert.equal(f.ctx.saveState(stamp(12 * 3600)), true);
  if (route === 'detail') assert.equal(f.ctx.draftSaveTransaction.run(() => { f.ctx.state.journals[f.date] = 'detail'; f.ctx.saveAndRender(); }).ok, true);
  if (route === 'report') {
    const { createLocalReportCommit } = await import('../src/features/feedback/local-report-commit.js');
    const commit = createLocalReportCommit({ getState: () => f.ctx.state, canSave: () => true,
      now: () => stamp(12 * 3600), persist: () => { f.ctx.persistLocalNoSchedule(); return true; },
      readStored: f.raw, writeStored() {} });
    assert.equal(commit({ date: f.date, journalText: 'saved', reportMarkdown: 'report' }).ok, true);
  }
  if (route === 'placement') {
    const { commitPlacement } = await import('../src/features/placement.js');
    f.ctx.state.blocks = [];
    // The lower-bound case edits content; D06 covers unchanged saves separately.
    assert.equal(commitPlacement(f.ctx.state, { tasks: f.ctx.state.tasks.map(task => ({ ...task, title: 'placed' })), blocks: [] },
      { now: () => stamp(12 * 3600), persist: () => true, schedule() {} }), true);
  }
  assert.equal(f.ctx.state.dataModifiedAt, stamp(12 * 3600 + 61));
});

test('normal/detail/report saves in the same second preserve candidate timestamps and pending floors', async () => {
  const f = await globalSaveFixture();
  f.inputEvent(f.input);
  assert.equal(f.ctx.state.dataModifiedAt, stamp(1));
  assert.equal(f.ctx.state.journalMeta[f.date].textUpdatedAt, stamp(0));
  assert.equal(f.counts.render, 0);
  assert.equal(f.ctx.draftSaveTransaction.run(() => {
    f.ctx.state.tasks[0].title = 'detail'; f.ctx.state.tasks[0].updatedAt = stamp(80);
    assert.equal(f.ctx.saveState(), true);
    f.ctx.saveAndRender('detail saved');
  }).ok, true);
  assert.equal(f.ctx.state.dataModifiedAt, stamp(82));
  assert.equal(f.counts.writes, 2);
  const { createLocalReportCommit } = await import('../src/features/feedback/local-report-commit.js');
  const commit = createLocalReportCommit({ getState: () => f.ctx.state, canSave: () => true, now: () => stamp(0),
    floors: () => [f.ctx.saveState.pendingStamp], persist: () => { f.ctx.persistLocalNoSchedule(); return true; },
    readStored: f.raw, writeStored() {} });
  f.ctx.state.dataModifiedAt = stamp(0);
  assert.equal(commit({ date: f.date, journalText: f.input.value, reportMarkdown: 'observed ' + stamp(0) }).ok, true);
  assert.equal(f.ctx.state.dataModifiedAt, stamp(83));
  assert.equal(f.counts.writes, 3);
  assert.equal(f.ctx.saveState(stamp(0), [stamp(100)]), true);
  assert.equal(f.ctx.state.dataModifiedAt, stamp(101));
  assert.equal(JSON.parse(f.raw()).dataModifiedAt, stamp(101));
});

for (const route of ['journal', 'ideal']) test(`${route}: failed input restores state and retains DOM/session draft; retry saves once`, async () => {
  const f = await globalSaveFixture();
  if (route === 'ideal') {
    f.input.dataset = { idealDate: f.date };
    f.input.matches = selector => selector === '[data-ideal-date]';
  }
  const before = f.ctx.state, snapshot = JSON.stringify(before), raw = f.raw();
  f.fail(true); f.inputEvent(f.input);
  assert.equal(f.ctx.state, before); assert.equal(JSON.stringify(f.ctx.state), snapshot);
  assert.equal(f.raw(), raw); assert.equal(f.input.value, 'typed journal');
  assert.equal(f.input.selectionStart, 2); assert.equal(f.input.selectionEnd, 6);
  assert.deepEqual([f.counts.writes, f.counts.autoSave, f.counts.autoSync, f.counts.render, f.counts.feedback], [1, 0, 0, 0, 0]);
  assert.ok([...f.storage.values()].some(raw => raw.includes('typed journal')));
  f.ctx.globalInputDrafts = {}; f.input.value = 'saved'; f.input.selectionStart = 0;
  f.ctx.restoreGlobalInputs();
  assert.equal(f.input.value, 'typed journal'); assert.equal(f.input.selectionStart, 2);
  f.fail(false); f.inputEvent(f.input);
  assert.deepEqual([f.counts.writes, f.counts.autoSave, f.counts.autoSync, f.counts.render], [2, 1, 1, 0]);
  assert.equal(f.ctx.state.dataModifiedAt, stamp(1));
  assert.equal(route === 'journal' ? f.ctx.state.journals[f.date] : f.ctx.state.journalMeta[f.date].ideal, 'typed journal');
  assert.equal(f.counts.feedback, route === 'journal' ? 1 : 0);
  assert.ok([...f.storage.values()].every(raw => !raw.includes('typed journal')));
});

test('saveAndRender renders failure state without toasting success; later request does not send failed journal', async () => {
  const f = await globalSaveFixture(), stampBefore = f.ctx.state.dataModifiedAt;
  f.fail(true); assert.equal(f.ctx.saveAndRender('saved'), false);
  assert.equal(f.ctx.state.dataModifiedAt, stampBefore);
  assert.deepEqual([f.counts.render, f.counts.autoSave, f.counts.autoSync], [1, 0, 0]);
  f.inputEvent(f.input); f.fail(false);
  assert.equal(f.ctx.saveAndRender('saved'), true);
  assert.equal(JSON.parse(f.raw()).journals[f.date], 'saved');
  assert.equal(f.input.value, 'typed journal');
  assert.deepEqual([f.counts.render, f.counts.autoSave, f.counts.autoSync], [2, 1, 1]);
});

test('actual saveState refuses a pure commit build without writing', async () => {
  const f = await globalSaveFixture(), { commitCandidate } = await api();
  assert.throws(() => commitCandidate({ state: f.ctx.state, now: stamp(0),
    build: () => { f.ctx.saveState(); return {}; }, persist: () => true }), /forbidden/);
  assert.equal(f.counts.writes, 0);
});

test('retry rechecks the input baseline after another request changes the journal', async () => {
  const f = await globalSaveFixture();
  f.fail(true); f.inputEvent(f.input);
  f.ctx.state.journals[f.date] = 'newer saved journal';
  f.fail(false);
  assert.equal(f.inputEvent(f.input), false);
  assert.equal(f.ctx.state.journals[f.date], 'newer saved journal');
  assert.equal(f.counts.writes, 1); assert.equal(f.counts.autoSync, 0);
  assert.equal(f.input.value, 'typed journal');
});

function fixture() {
  const untouched = { id: "other", updatedAt: stamp(900) };
  const state = { tasks: [{ id: "task", title: "before", updatedAt: stamp(0) }, untouched],
    dataModifiedAt: stamp(0), lastPushedAt: stamp(0) };
  const input = { value: "typed" };
  const before = structuredClone({ state, input });
  const counts = { build: 0, persist: 0, effects: 0, now: 0 };
  const options = { state, input, now: () => { counts.now++; return stamp(0); },
    build: (model, fields) => {
      counts.build++;
      assert.equal(fields, input);
      return { records: [{ kind: "tasks", before: model.tasks[0],
        after: { ...model.tasks[0], title: fields.value } }],
      inputs: [{ target: fields, key: "value", before: fields.value }] };
    },
    persist: saved => { counts.persist++; assert.equal(saved, state); return true; },
    effects: result => { counts.effects++; assert.equal(result.ok, true); }
  };
  return { state, input, before, counts, options, untouched };
}

for (const row of [
  { name: "success saves once and ignores unrelated records", candidate: 0, global: 2 },
  { name: "candidate updatedAt bounds the global stamp", candidate: 50, global: 52 },
  { name: "an older real clock cannot regress global time", candidate: 0, prior: 80, global: 81 },
  { name: "last pushed time bounds global time", candidate: 0, pushed: 90, global: 91 },
  { name: "pending and merged clocks are explicit lower bounds", candidate: 0, extra: [stamp(100), stamp(110)], global: 111 }
]) test(row.name, async () => {
  const { commitCandidate } = await api();
  const f = fixture();
  if (row.prior) f.state.dataModifiedAt = stamp(row.prior);
  if (row.pushed) f.state.lastPushedAt = stamp(row.pushed);
  const build = f.options.build;
  f.options.build = (...args) => {
    const candidate = build(...args);
    candidate.records[0].after.updatedAt = stamp(row.candidate);
    candidate.candidates = row.extra || [];
    return candidate;
  };
  const result = commitCandidate(f.options);
  assert.equal(result.ok, true);
  assert.deepEqual(f.counts, { build: 1, persist: 1, effects: 1, now: 1 });
  assert.equal(f.state.tasks[0].updatedAt, stamp(row.candidate + 1));
  assert.equal(f.state.dataModifiedAt, stamp(row.global));
  assert.equal(f.state.tasks[1], f.untouched);
  assert.equal(f.state.tasks[0].title, "typed");
  assert.equal(f.before.state.tasks[0].title, "before");
  assert.equal(result.records[0].after, f.state.tasks[0]);
});

for (const failure of ["throw", "false", "result"]) test(`persist ${failure}: restore state/inputs and suppress effects`, async () => {
  const { commitCandidate } = await api();
  const f = fixture();
  const tasks = f.state.tasks;
  const original = tasks[0];
  withLocalSaveFailure((persist, injected) => {
    f.options.persist = () => {
      f.counts.persist++;
      f.input.value = "changed while saving";
      if (failure === "throw") return persist();
      return failure === "false" ? false : { ok: false, error: injected.error };
    };
    const result = commitCandidate(f.options);
    assert.equal(result.ok, false);
    assert.ok(result.error instanceof Error);
    if (failure !== "false") assert.equal(result.error, injected.error);
    expectRestored(f.before, { state: f.state, input: f.input });
    assert.equal(f.state.tasks, tasks);
    assert.equal(f.state.tasks[0], original);
    assert.equal(f.counts.persist, 1);
    assert.equal(f.counts.effects, 0);
    assert.equal(injected.calls, failure === "throw" ? 1 : 0);
  });
});

for (const operation of ["await", "thenable", "saveState", "nested", "write", "delete", "define", "swallowed",
  "closure", "descriptor", "closureThrow", "arrayLength"]) {
  test(`build rejects ${operation} with an exception and no save`, async () => {
    const { commitCandidate, assertNotInsideBuild } = await api();
    const f = fixture();
    const saveState = () => assertNotInsideBuild("saveState");
    const builds = {
      await: async () => { await Promise.resolve(); return { records: [] }; },
      thenable: () => ({ then() {} }),
      saveState,
      nested: () => commitCandidate(f.options),
      write: model => { model.tasks[0].title = "forbidden"; },
      delete: model => { delete model.tasks[0].title; },
      define: model => { Object.defineProperty(model, "injected", { value: true }); },
      closure: () => { f.state.tasks[0].title = "forbidden"; return { records: [] }; },
      descriptor: model => {
        Object.getOwnPropertyDescriptor(model, "tasks").value[0].title = "forbidden";
        return { records: [] };
      },
      closureThrow: () => { f.state.tasks[0].title = "forbidden"; throw new Error("build failed"); },
      arrayLength: () => { f.state.tasks.length = 9; return { records: [] }; },
      swallowed: () => { try { saveState(); } catch {} return { records: [] }; }
    };
    f.options.build = builds[operation];
    assert.throws(() => commitCandidate(f.options), /build|nested/i);
    expectRestored(f.before, { state: f.state, input: f.input });
    assert.equal(f.counts.persist, 0);
    assert.equal(f.counts.effects, 0);
    assert.doesNotThrow(saveState);
    assert.equal(commitCandidate(fixture().options).ok, true);
  });
}

test("multi-record insert/delete/keyed updates roll back, including absent global stamp", async () => {
  const { commitCandidate } = await api();
  for (const fail of [false, true]) {
    const f = fixture();
    delete f.state.dataModifiedAt;
    f.state.meta = {};
    const before = structuredClone({ state: f.state, input: f.input });
    f.options.build = model => ({ records: [
      { kind: "tasks", before: model.tasks[0], after: null },
      { kind: "tasks", before: null, after: { id: "new" } },
      { kind: "meta", key: "day", before: undefined, after: { title: "new" } }
    ], inputs: [] });
    f.options.persist = () => !fail;
    assert.equal(commitCandidate(f.options).ok, !fail);
    if (fail) expectRestored(before, { state: f.state, input: f.input });
    else {
      assert.deepEqual(f.state.tasks.map(task => task.id), ["other", "new"]);
      assert.equal(f.state.meta.day.updatedAt, stamp(1));
      assert.equal(f.state.dataModifiedAt, stamp(2));
    }
  }
});

test("effects exceptions propagate after persistence, without rollback or retry", async () => {
  const { commitCandidate } = await api();
  const f = fixture();
  const error = new Error("effect failed");
  f.options.effects = () => { throw error; };
  assert.throws(() => commitCandidate(f.options), error);
  assert.equal(f.counts.persist, 1);
  assert.equal(f.state.tasks[0].title, "typed");
  assert.equal(commitCandidate(fixture().options).ok, true);
});

for (const mixed of [false, true]) for (const fail of [false, true]) {
  test(`values preserve strings and restore absent keys: mixed=${mixed}, failure=${fail}`, async () => {
    const { commitCandidate } = await api();
    const f = fixture();
    f.state.reports = { previous: "old report" };
    const original = f.state.reports, before = structuredClone(f.state);
    const build = f.options.build;
    f.options.build = (model, input) => ({
      records: mixed ? build(model, input).records : [],
      values: [
        { kind: "reports", key: "previous", before: model.reports.previous, after: "updated report" },
        { kind: "reports", key: "new", before: undefined, after: "new report" }
      ]
    });
    let observed;
    f.options.persist = () => {
      f.counts.persist++;
      observed = structuredClone(f.state.reports);
      assert.equal(f.state.reports.previous, "updated report");
      assert.equal(f.state.reports.new, "new report");
      return !fail;
    };
    const result = commitCandidate(f.options);
    assert.equal(result.ok, !fail);
    assert.equal(f.counts.persist, 1);
    assert.equal(f.counts.now, 1);
    assert.equal(f.counts.effects, fail ? 0 : 1);
    assert.deepEqual(observed, { previous: "updated report", new: "new report" });
    if (fail) {
      assert.deepEqual(f.state, before);
      assert.equal(f.state.reports, original);
      assert.equal(Object.hasOwn(f.state.reports, "new"), false);
    } else {
      assert.equal(f.state.reports.previous, "updated report");
      assert.equal(f.state.reports.new, "new report");
      assert.equal(f.state.dataModifiedAt, stamp(mixed ? 2 : 1));
      assert.equal(f.state.tasks[0].updatedAt, stamp(mixed ? 1 : 0));
    }
  });
}

test("draft adapter retains owner/input on failure and saves reordered candidates once on retry", async () => {
  const { createDraftSaveTransaction } = await import("../src/features/draft-save.js");
  const f = fixture(), original = f.state;
  original.modal = { type: "task", id: "task" };
  original.zeroThinking = { entries: [{ id: "entry", body: "before" }] };
  let state = original, fail = true, writes = 0, schedules = 0, posts = 0;
  const before = structuredClone(original);
  const transaction = createDraftSaveTransaction({ getState: () => state, setState: value => { state = value; },
    now: () => stamp(0), persist: () => { writes++; return !fail; }, schedule: () => { schedules++; }, onFailure() {} });
  const save = () => transaction.run(() => {
    state.tasks[0].title = f.input.value;
    state.tasks.reverse();
    state.zeroThinking.entries[0].body = "edited";
    transaction.complete(() => { state.modal = null; });
    transaction.defer(() => { posts++; f.input.value = ""; }, { post: true });
  }, { deferPost: true });
  assert.equal(save().reason, "storage-failed");
  assert.equal(state, original);
  assert.deepEqual(state, before);
  assert.equal(f.input.value, "typed");
  assert.equal(schedules, 0); assert.equal(posts, 0); assert.equal(writes, 1);
  fail = false;
  const result = save();
  assert.equal(result.ok, true); assert.equal(writes, 2); assert.equal(schedules, 1);
  assert.equal(state.modal, null);
  assert.deepEqual(state.tasks.map(row => row.id), ["other", "task"]);
  assert.equal(state.tasks[0].updatedAt, stamp(900));
  assert.equal(state.tasks[1].updatedAt, stamp(1));
  assert.equal(state.dataModifiedAt, stamp(2));
  assert.equal(state.zeroThinking.entries[0].body, "edited");
  assert.equal(posts, 0); result.afterLeave(); result.afterLeave();
  assert.equal(posts, 1); assert.equal(f.input.value, "");
});

test("placement stamps only changed candidates and restores references before a single retry", async () => {
  const { commitPlacement } = await import("../src/features/placement.js");
  const f = fixture(); f.state.blocks = [];
  const originalTasks = f.state.tasks, originalBlocks = f.state.blocks;
  const candidate = { blocks: [{ id: "block", createdAt: stamp(0) }],
    tasks: [{ ...f.state.tasks[0], status: "doing" }, f.untouched] };
  let writes = 0, schedules = 0, fail = true;
  const deps = { now: () => stamp(0), persist: () => { writes++; return !fail; }, schedule: () => { schedules++; } };
  assert.equal(commitPlacement(f.state, candidate, deps), false);
  assert.equal(f.state.tasks, originalTasks); assert.equal(f.state.blocks, originalBlocks);
  assert.equal(f.state.dataModifiedAt, stamp(0)); assert.equal(schedules, 0);
  fail = false; assert.equal(commitPlacement(f.state, candidate, deps), true);
  assert.equal(writes, 2); assert.equal(schedules, 1);
  assert.equal(f.state.tasks[1], f.untouched);
  assert.equal(f.state.tasks[0].updatedAt, stamp(1));
  assert.equal(f.state.blocks[0].updatedAt, stamp(1));
  assert.equal(f.state.blocks[0].createdAt, stamp(0));
  assert.equal(f.state.dataModifiedAt, stamp(2));
});

test("local report readback failure restores memory/storage and retry retains the observed body clock", async () => {
  const { createLocalReportCommit } = await import("../src/features/feedback/local-report-commit.js");
  const date = stamp(0).slice(0, 10), markdown = `Observed at ${stamp(0)}`;
  const state = { reports: {}, journals: { [date]: "journal" }, dataModifiedAt: stamp(80) };
  const before = structuredClone(state), reports = state.reports;
  let raw = JSON.stringify(state), mismatch = true, writes = 0;
  const initial = raw;
  const commit = createLocalReportCommit({ getState: () => state, canSave: () => true, now: () => stamp(0),
    readStored: () => raw, writeStored: value => { raw = value; },
    persist: () => { writes++; raw = JSON.stringify(mismatch ? { ...state, reports: {} } : state); return true; } });
  const candidate = { date, reportMarkdown: markdown, journalText: "journal" };
  assert.equal(commit(candidate).reason, "local_save_failed");
  assert.deepEqual(state, before); assert.equal(state.reports, reports); assert.equal(raw, initial);
  mismatch = false; assert.equal(commit(candidate).ok, true); assert.equal(writes, 2);
  assert.equal(state.reports[date], markdown); assert.equal(state.dataModifiedAt, stamp(81));
  assert.equal(JSON.parse(raw).dataModifiedAt, stamp(81));
});

for (const route of ['condition', 'vision']) test(`${route}: failure restores prior state/input and does not schedule the request`, async () => {
  const f = await globalSaveFixture();
  const selector = route === 'condition' ? '[data-condition-note-date]' : '[data-vision-field]';
  f.input.dataset = route === 'condition' ? { conditionNoteDate: f.date } : { visionField: 'vision' };
  f.input.matches = value => value === selector;
  if (route === 'condition') f.ctx.state.condition = { logs: { [f.date]: { eveningNote: 'before', eveningRecordedAt: '' } } };
  else f.ctx.state.settings.vision = 'before';
  const before = f.ctx.state, snapshot = JSON.stringify(before), raw = f.raw();
  f.fail(true);
  assert.equal(f.inputEvent(f.input), false);
  assert.equal(f.ctx.state, before); assert.equal(JSON.stringify(f.ctx.state), snapshot);
  assert.equal(f.raw(), raw); assert.equal(f.input.value, 'before');
  assert.deepEqual([f.counts.writes, f.counts.autoSave, f.counts.autoSync, f.counts.render], [1, 0, 0, 0]);
  f.fail(false); assert.equal(f.ctx.saveState(), true);
  assert.equal(route === 'condition' ? JSON.parse(f.raw()).condition.logs[f.date].eveningNote : JSON.parse(f.raw()).settings.vision, 'before');
});

test('createdAt is the record and global lower bound when updatedAt is absent', async () => {
  const { commitCandidate } = await api(), f = fixture();
  delete f.state.tasks[0].updatedAt; f.state.tasks[0].createdAt = '2400-01-01';
  f.options.now = '2026-09-09T12:00:00';
  assert.equal(commitCandidate(f.options).ok, true);
  assert.equal(f.state.tasks[0].updatedAt, '2400-01-01T00:00:01');
  assert.equal(f.state.dataModifiedAt, '2400-01-01T00:00:02');
});

test('empty declared candidates run effects without reading a clock, persisting or scheduling', async () => {
  const f = await globalSaveFixture(), { commitCandidate } = await api();
  const before = JSON.stringify(f.ctx.state); let effects = 0;
  const result = commitCandidate({ state: f.ctx.state, build: () => ({ records: [], values: [] }),
    now: () => { throw new Error('no clock for unchanged content'); },
    persist: () => { throw new Error('no persist for unchanged content'); },
    effects: r => { effects++; assert.equal(r.unchanged, true); } });
  assert.equal(result.ok, true); assert.equal(effects, 1); assert.equal(JSON.stringify(f.ctx.state), before);
  assert.equal(f.ctx.draftSaveTransaction.run(() => f.ctx.saveAndRender()).ok, true);
  assert.deepEqual([f.counts.writes, f.counts.autoSave, f.counts.autoSync, f.counts.render], [0, 0, 0, 1]);
});

test('effects can call actual saveState as an independent commit', async () => {
  const f = await globalSaveFixture();
  assert.equal(f.ctx.draftSaveTransaction.run(() => {
    f.ctx.state.journals[f.date] = 'first';
    f.ctx.draftSaveTransaction.complete(() => {
      f.ctx.state.settings.vision = 'second'; assert.equal(f.ctx.saveState(), true);
    });
  }).ok, true);
  assert.equal(JSON.parse(f.raw()).settings.vision, 'second');
  assert.equal(f.ctx.state.dataModifiedAt, stamp(2));
  assert.deepEqual([f.counts.writes, f.counts.autoSave, f.counts.autoSync, f.counts.toast], [2, 2, 2, 0]);
});

test('commit effects release active before invoking actual saveState', async () => {
  const f = await globalSaveFixture(), { commitCandidate } = await api();
  const result = commitCandidate({ state: f.ctx.state, now: stamp(0), build: () => ({ candidates: [] }),
    persist: () => { f.ctx.persistLocalNoSchedule(); return true; },
    effects: () => { f.ctx.state.settings.vision = 'effect'; assert.equal(f.ctx.saveState(), true); } });
  assert.equal(result.ok, true); assert.equal(f.counts.writes, 2);
  assert.equal(JSON.parse(f.raw()).settings.vision, 'effect');
  assert.equal(f.ctx.state.dataModifiedAt, stamp(2));
});

test('D06 unchanged placement does not persist or schedule', async () => {
  const f = await globalSaveFixture(), { commitPlacement } = await import('../src/features/placement.js');
  f.ctx.state.blocks = [];
  assert.equal(commitPlacement(f.ctx.state, { tasks: f.ctx.state.tasks, blocks: [] }, {
    now: () => { throw new Error('unchanged clock'); },
    persist: () => { throw new Error('unchanged persist'); },
    schedule: () => { throw new Error('unchanged schedule'); }
  }), true);
  assert.equal(f.ctx.state.dataModifiedAt, stamp(0));
});

test('reordering unchanged records persists order without altering their stamps', async () => {
  const f = await globalSaveFixture();
  f.ctx.state.tasks.push({ id: 'other', updatedAt: stamp(90) });
  assert.equal(f.ctx.draftSaveTransaction.run(() => {
    f.ctx.state.tasks.reverse(); f.ctx.draftSaveTransaction.complete();
  }).ok, true);
  assert.deepEqual(Array.from(f.ctx.state.tasks, row => row.id), ['other', 'task']);
  assert.deepEqual(Array.from(f.ctx.state.tasks, row => row.updatedAt), [stamp(90), stamp(0)]);
  assert.equal(f.counts.writes, 1);
});

// 14b: execute the real eight sync entrances with isolated network/storage adapters.
async function syncStampFixture({ pending = true, localOnly = true } = {}) {
  const fs = require('node:fs'), vm = require('node:vm'), acorn = require('acorn');
  const source = fs.readFileSync(path.join(__dirname, '../src/sync/github.js'), 'utf8');
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const names = ['beginSyncCandidate', 'adoptSyncResult', 'saveToGitHub', 'runAutoSyncPush',
    'autoMergeRemote', 'runAutoSyncPull', 'loadFromGitHub', 'syncFromGitHubOnStartup'];
  const functions = names.map(name => {
    const node = ast.body.map(n => n.declaration || n).find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
    assert.ok(node, name); return source.slice(node.start, node.end);
  }).join('\n');
  const config = { token: 'fixture', branch: 'test' };
  const local = { dataModifiedAt: stamp(10), settings: { github: config, lastPushedAt: stamp(pending ? 0 : 10) },
    blocks: localOnly ? [{ id: 'local', title: 'local', updatedAt: stamp(0) }] : [], core: 'same' };
  const remote = { ...structuredClone(local), dataModifiedAt: stamp(100),
    blocks: [{ id: 'remote', title: 'remote', updatedAt: stamp(1) }] };
  const counts = { puts: 0, saves: 0, scheduled: 0, adopted: 0 };
  let fail = false, stored = JSON.stringify(local), sent, onPut = () => {}, onDownload = () => {};
  const noop = () => {}, { commitCandidate } = await api();
  // v387 ハーネス追随(監督者決定 2026-09-11、束B7 単位37): adoptSyncResult / syncCoreEqual が単発予定の比較・容器検査を参照するので実物を砂場へ渡す(製品変更なし)。
  const singleSchedule = await import(pathToFileURL(path.join(__dirname, '../src/core/single-schedule.js')).href);
  const { mergeReadingEvidence } = await import('../src/core/daily-reading-sync.js');
  const ctx = vm.createContext({ JSON, state: local, commitCandidate, _lastSaveError: null,
    mergeReadingEvidence,
    singleSchedulesEqual: singleSchedule.singleSchedulesEqual, validateSingleScheduleContainer: singleSchedule.validateSingleScheduleContainer, console: { warn: noop },
    nowDateTime: () => stamp(0), saveState: Object.assign(noop, { pendingStamp: stamp(20) }),
    setState: value => { ctx.state = value; }, normalizeState: x => x,
    persistLocalNoSchedule: () => { counts.saves++; ctx._lastSaveError = null;
      if (fail) withLocalSaveFailure((persist, injected) => {
        assert.throws(persist, error => error === injected.error); ctx._lastSaveError = injected.error;
      });
      if (!fail) stored = JSON.stringify(ctx.state); },
    archiveConnectionKey: () => 'fixture', capturePrimarySyncState: () => ({ pending }),
    _githubSaveInFlight: false, autoSaveTimer: null, clearTimeout: noop,
    requireGitHubConfig: () => config, fetchGitHubFileSHA: async () => 'remote-sha', getLastSyncedSha: () => 'old-sha',
    setLastSyncedSha: noop, window: { confirm: () => true },
    downloadGitHubStateText: async () => { onDownload(); return { text: JSON.stringify(remote), sha: 'remote-sha' }; },
    normalizedRemoteCopy: JSON.parse, prepareArchiveMerge: async () => {}, assertPrimarySettingsSafe: noop,
    requireSyncMerge: r => {
      const blocks = [...new Map([...r.blocks, ...ctx.state.blocks].map(b => [b.id, b])).values()];
      return { blocks, values: { reading: mergeReadingEvidence(ctx.state, r, blocks) },
        changedVsRemote: JSON.stringify(blocks) !== JSON.stringify(r.blocks) };
    },
    applySyncMergeToLocal: merge => { ctx.state.blocks = merge.blocks; return true; },
    applySyncMergeToRemote: (merge, r) => { r.blocks = merge.blocks; return merge.changedVsRemote; },
    syncCoreEqual: () => true, archiveProof: { assert: noop },
    sanitizedStateForGitHub: () => ctx.state, toBase64: x => x, gitHubContentsURL: () => 'mock', githubHeaders: () => ({}),
    fetch: async (_url, options) => { counts.puts++; sent = JSON.parse(JSON.parse(options.body).content); await onPut();
      return { ok: true, json: async () => ({ content: { sha: 'sent-sha' } }) }; },
    clearPersonalDataAuthError: noop, recordSyncPushSuccess: noop, recordSyncPullSuccess: noop,
    clearSyncBanner: noop, setSyncBanner: noop, showToast: noop, updateAutoSaveStatus: noop, updateSyncDot: noop,
    maybeWriteBackupSnapshot: noop, writeBackupSnapshotBeforeLoad: async () => true,
    scheduleAutoSave: () => counts.scheduled++, scheduleAutoSync: () => counts.scheduled++,
    autoSyncReady: () => true, personalDataReady: () => true, personalDataFileConfig: x => x,
    normalizeDataStamp: x => x, remoteShaUnchanged: () => false, primarySettingsDifferWhilePending: () => false,
    mergeCoreKeys: r => ({ core: r.core }), SYNC_CORE_COMPARE_KEYS: ['core'], LOSS_RISK_KEYS: [],
    getByPath: (x, k) => x[k], setByPath: (x, k, v) => { x[k] = v; },
    _lastPullCheckAt: 0, AUTO_SYNC_PULL_THROTTLE_MS: 0, _startupDataModifiedAt: stamp(10),
    maintainRecurrences: noop, runDailyOpen: () => false, render: noop, renderDeferringForFocus: noop });
  vm.runInContext(functions, ctx);
  const adopt = ctx.adoptSyncResult;
  ctx.adoptSyncResult = (...args) => { counts.adopted++; return adopt(...args); };
  return { ctx, remote, counts, raw: () => stored, sent: () => sent, fail: value => { fail = value; },
    onPut: fn => { onPut = fn; }, onDownload: fn => { onDownload = fn; } };
}

const syncEntrances = [
  ['manual merge', 'saveToGitHub', true], ['auto push merge', 'runAutoSyncPush', true],
  ['core auto merge', 'autoMergeRemote', true], ['pull merge', 'runAutoSyncPull', true],
  ['pull adopt', 'runAutoSyncPull', false], ['manual load', 'loadFromGitHub', false],
  ['startup pending', 'syncFromGitHubOnStartup', true], ['startup adopt', 'syncFromGitHubOnStartup', false]
];
for (const [name, method, pending] of syncEntrances) {
  for (const localOnly of [false, true]) test('sync ' + name + ': ' + (localOnly ? 'union advances future clock' : 'pure adoption retains remote clock'), async () => {
    const f = await syncStampFixture({ pending, localOnly });
    await f.ctx[method](...(method === 'autoMergeRemote' ? [f.remote, stamp(100), 'remote-sha'] : []));
    assert.ok(f.counts.adopted > 0, 'entrance reaches common adoption');
    assert.equal(f.ctx.state.dataModifiedAt, stamp(localOnly ? 101 : 100));
    assert.deepEqual(f.ctx.state.blocks.map(b => b.id).sort(), localOnly ? ['local', 'remote'] : ['remote']);
    assert.equal(f.ctx.state.settings.lastPushedAt, stamp(f.counts.puts ? (localOnly ? 101 : 100) : 100));
    assert.equal(JSON.parse(f.raw()).dataModifiedAt, f.ctx.state.dataModifiedAt);
  });
  test('sync ' + name + ': failed save restores original state and suppresses PUT', async () => {
    const f = await syncStampFixture({ pending }), before = JSON.stringify(f.ctx.state), raw = f.raw();
    f.fail(true);
    await f.ctx[method](...(method === 'autoMergeRemote' ? [f.remote, stamp(100), 'remote-sha'] : []));
    expectRestored(JSON.parse(before), JSON.parse(JSON.stringify(f.ctx.state))); assert.equal(f.raw(), raw);
    assert.equal(f.counts.puts, 0); assert.equal(f.counts.scheduled, 0);
    f.fail(false);
    await f.ctx[method](...(method === 'autoMergeRemote' ? [f.remote, stamp(100), 'remote-sha'] : []));
    assert.equal(f.ctx.state.dataModifiedAt, stamp(101));
  });
}
for (const method of ['saveToGitHub', 'runAutoSyncPush']) test(method + ': PUT-wait edits remain unpushed after reload', async () => {
  const f = await syncStampFixture();
  f.onPut(() => { f.ctx.state.blocks.push({ id: 'waiting-edit' }); f.ctx.state.dataModifiedAt = stamp(102); });
  await f.ctx[method]();
  assert.equal(f.sent().dataModifiedAt, stamp(101));
  assert.equal(f.ctx.state.settings.lastPushedAt, stamp(101));
  assert.equal(f.ctx.state.dataModifiedAt, stamp(102));
  const reloaded = JSON.parse(f.raw()); assert.equal(reloaded.dataModifiedAt, stamp(102));
  assert.ok(reloaded.blocks.some(b => b.id === 'waiting-edit'));
});
test('sync: two alternating devices stop sending within three round trips', async () => {
  const fs = require('node:fs');
  const { chromium, launchOptions, startServer, randomPort, blockGithubApiByDefault } = require('./helpers');
  const port = randomPort(), server = startServer(port);
  let browser;
  try {
    await server.ready;
    browser = await chromium.launch(launchOptions());
    const devices = [];
    for (let index = 0; index < 2; index++) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      await blockGithubApiByDefault(context);
      const page = await context.newPage();
      await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript',
        body: fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8')
          + '\nwindow.__stampApp = { normalizeState, makeBlock, getState: () => state, setState };' }));
      await page.route('**/src/sync/github.js', route => route.fulfill({ contentType: 'text/javascript',
        body: fs.readFileSync(path.join(__dirname, '../src/sync/github.js'), 'utf8')
          + '\nwindow.__stampSync = { configureGithubSync, computeSyncMerge, applySyncMergeToLocal, syncCoreEqual, autoMergeRemote, runAutoSyncPush };' }));
      await page.goto('http://localhost:' + port);
      await page.waitForFunction(() => Boolean(window.__stampApp && window.__stampSync));
      devices.push(page);
    }
    const seed = await devices[0].evaluate(() => {
      const app = window.__stampApp, value = JSON.parse(JSON.stringify(app.getState()));
      value.blocks = [app.makeBlock({ title: 'shared', date: '2026-09-10' })];
      value.dataModifiedAt = '2026-09-10T10:05:00';
      value.settings.lastPushedAt = '2026-09-10T10:00:00';
      value.settings.autoSync = true;
      value.settings.github = { token: 'fixture', owner: 'fixture', repo: 'fixture', branch: 'test' };
      return value;
    });
    for (const page of devices) await page.evaluate(value => {
      const app = window.__stampApp, sync = window.__stampSync, noop = () => {};
      app.setState(app.normalizeState(value));
      window.__stampIO = { puts: 0, remote: null, sequence: 0, merges: 0 };
      const io = window.__stampIO;
      window.fetch = async (url, options = {}) => {
        if (url !== 'fixture-sync' && url !== 'fixture-sync?ref=test') throw new Error('Unexpected network: ' + url);
        if (options.method === 'PUT') {
          io.puts++;
          io.sent = JSON.parse(JSON.parse(options.body).content);
          return { ok: true, json: async () => ({ content: { sha: 'sent-' + io.sequence } }) };
        }
        return { ok: true, json: async () => ({ content: JSON.stringify(io.remote), encoding: 'base64', sha: 'remote-' + io.sequence }) };
      };
      sync.configureGithubSync({ normalizeState: app.normalizeState,
        nowDateTime: () => '2026-09-10T10:00:00', todayISO: () => '2026-09-10', addDays: d => d,
        isTouchedBlock: b => Boolean(b.actualStartAt), RECURRENCE_KEEP_PAST_DAYS: 7,
        RECURRENCE_FUTURE_DAYS: 31, SWIPE_TRIAGE_LOG_MAX: 200,
        showToast: noop, maintainRecurrences: noop, render: noop, runDailyOpen: () => false,
        saveState: noop, renderDeferringForFocus: noop,
        requireGitHubConfig: () => app.getState().settings.github,
        fetchGitHubFileSHA: async () => 'remote-' + io.sequence,
        personalDataReady: () => true, personalDataFileConfig: c => c,
        gitHubContentsURL: () => 'fixture-sync', githubHeaders: () => ({}),
        gitHubErrorMessage: async () => 'fixture error', fromBase64: x => x, toBase64: x => x,
        sanitizedStateForGitHub: () => JSON.parse(JSON.stringify(app.getState())),
        maybeWriteBackupSnapshot: async () => {}, writeBackupSnapshotBeforeLoad: async () => true,
        updateAutoSaveStatus: noop, updateSyncDot: noop, renderSyncBanner: noop,
        clearSyncBannerDismissal: noop, clearPersonalDataAuthError: noop,
        pruneExpiredSuggestedThemes: x => x, _startupDataModifiedAt: value.dataModifiedAt
      });
    }, structuredClone(seed));
    const rounds = [];
    for (let round = 0; round < 3; round++) {
      let puts = 0;
      for (const [page, other] of [[devices[0], devices[1]], [devices[1], devices[0]]]) {
        const remote = await other.evaluate(() => window.__stampApp.getState());
        const result = await page.evaluate(async remote => {
          const app = window.__stampApp, sync = window.__stampSync, io = window.__stampIO;
          io.remote = remote; io.sequence++;
          const norm = app.normalizeState(JSON.parse(JSON.stringify(remote)));
          const coreEqual = sync.syncCoreEqual(norm);
          const separateBlocks = app.getState().blocks[0] !== norm.blocks[0];
          const merged = sync.computeSyncMerge(norm, 'local');
          if (!merged) throw new Error('Real computeSyncMerge failed');
          io.merges++;
          const count = io.puts;
          const adopted = await sync.autoMergeRemote(norm, norm.dataModifiedAt, 'merge-' + io.sequence);
          await sync.runAutoSyncPush();
          return { adopted, coreEqual, separateBlocks, puts: io.puts - count,
            stamp: app.getState().dataModifiedAt, pushed: app.getState().settings.lastPushedAt,
            blocks: app.getState().blocks.length };
        }, remote);
        assert.equal(result.adopted, true, 'real merge adoption succeeds');
        assert.equal(result.coreEqual, true, 'real syncCoreEqual compares normalized state');
        assert.equal(result.separateBlocks, true, 'same Block has separate object identity');
        assert.equal(result.blocks, 1);
        puts += result.puts;
      }
      rounds.push(puts);
    }
    console.log('real merge round-trip PUT counts:', JSON.stringify(rounds));
    assert.equal(rounds[2], 0, 'PUT stops within three complete round trips');
    assert.deepEqual(rounds, [0, 0, 0], 'identical content never needs a resend');
    for (const page of devices) {
      const final = await page.evaluate(() => ({ state: window.__stampApp.getState(), io: window.__stampIO }));
      assert.equal(final.io.merges, 3);
      assert.equal(final.state.dataModifiedAt, seed.dataModifiedAt);
      assert.equal(final.state.dataModifiedAt, final.state.settings.lastPushedAt);
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
