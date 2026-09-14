const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fixedClock } = require('./helpers');
const moduleAt = name => import(pathToFileURL(path.resolve(name)).href);
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const names = ['lifecycleSaveDeps', 'runLifecycleChange', 'runTwelveWeekChange', 'toggleBlock', 'completePomodoro',
  'autoCloseStaleRoutineRuns', 'resetPomodoroForBlock', 'commitBlockChanges', 'saveActualEntryFromModal',
  'trackOnBlockStarted', 'trackOnBlockCompletionChanged', 'autoCommitWeekIfNeeded', 'stampCommitmentCompletion',
  'upsertWeeklyCommitment', 'syncHabitStreakForBlock', 'recordHabitStreakDone', 'removeHabitStreakDone', 'saveAndRender', 'generateReport'];
const code = names.map(name => { const n = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(n, name); return source.slice(n.start, n.end); }).join('\n');

async function fixture() {
  const { createDraftSaveTransaction } = await moduleAt('src/features/draft-save.js');
  const { runDailyOperation, DAILY_OPERATIONS } = await moduleAt('src/features/daily-operations.js');
  const { commitLifecycleDraft } = await moduleAt('src/features/lifecycle-save.js');
  const { buildTwelveWeekDraft } = await moduleAt('src/features/twelve-week-save.js');
  const { buildDailyReport } = await moduleAt('src/core/daily-report.js');
  const core = await moduleAt('src/core/recurrence.js');
  const clock = fixedClock(Date.UTC(2026, 8, 13, 10)), now = () => new Date(clock()).toISOString().slice(0, 19);
  const block = { id: 'b', taskId: 't', date: '2026-09-13', category: 'work', title: 'work', completed: false,
    actualStartAt: '', actualEndAt: '', recurrenceGroupId: 'r', updatedAt: '2026-09-13T10:05:00' };
  const ctx = vm.createContext({ state: { blocks: [block], tasks: [{ id: 't', status: 'todo', updatedAt: '2026-09-13T10:05:00' }],
    projects: [], declarations: [], weeklyCommitments: [], tracks: [], trackMeasurements: [], chainRuns: [], reports: {},
    settings: { twelveWeekStartDate: '2026-09-12', focusTimerAuto: true }, selectedDate: block.date, archivedDates: [],
    recurrences: [{ id: 'r', kind: 'daily', streakSince: block.date }, { id: 'follow', anchor: 'r', title: 'follow' }],
    habitStreaks: {}, pomodoro: { running: false }, dataModifiedAt: '2026-09-13T10:05:00' },
    _quickCompleteSnapshots: {}, _pendingInterruptBlockId: 'typed-interrupt',
    runDailyOperation, DAILY_OPERATIONS, commitLifecycleDraft, buildTwelveWeekDraft, buildDailyReport, REPORT_PENDING: 'pending',
    todayISO: () => block.date, nowDateTime: now, fromLocalInput: v => v || '',
    weekRange: () => ({ weekStart: '2026-09-12' }), candidateBlocksForWeek: s => s.blocks.filter(b => b.taskId),
    commitmentItemForBlock: (s, b, weekStart) => ({ id: `wci_${weekStart}_${b.id}`, recordType: 'item', weekStart, blockId: b.id }),
    prefillEnergy: () => null, quickCompleteActualStart: () => '2026-09-13T09:00:00',
    transferIronLogToCompletedBlock() {}, isArchivedDate: () => false, ensureJournal() {},
    getRandomCelebrate: () => 'done', triggerAnchorPlacements: core.triggerAnchorPlacements });
  let fail = true, writes = 0, sync = 0, ui = 0, persisted;
  const effect = () => { if (!ctx.draftSaveTransaction.defer(() => ui++)) ui++; };
  Object.assign(ctx, { render: effect, closeModal: effect, showToast: effect, triggerCompletionEffect: effect,
    openBodyScanModal: effect, maybeShowTrackProgressToast: effect, blockById: id => ctx.state.blocks.find(b => b.id === id),
    saveState: () => { assert.equal(ctx.draftSaveTransaction.active, true); return true; } });
  ctx.draftSaveTransaction = createDraftSaveTransaction({ getState: () => ctx.state, setState: s => { ctx.state = s; }, now,
    persist: () => { writes++; if (fail) return false; persisted = JSON.stringify(ctx.state); return true; },
    schedule: () => sync++, onFailure() {} });
  ctx.dailyOperationDeps = { get state() { return ctx.state; }, now, newId: () => 'declaration',
    commitLifecycle: input => commitLifecycleDraft(input, ctx.lifecycleSaveDeps()),
    captureReport: (s, date) => ({ done: s.blocks.filter(b => b.actualEndAt && b.date === date).map(b => b.id) }),
    buildReport: input => JSON.stringify(input), weekRange: ctx.weekRange,
    candidateBlocksForWeek: ctx.candidateBlocksForWeek, commitmentItemForBlock: ctx.commitmentItemForBlock,
    mergeWeeklyCommitments: (old, incoming) => incoming,
    pomodoroForStart: (at, id) => ({ running: true, blockId: id, startedAt: at }),
    startEffect: effect, endEffect: effect, planCompletionEffect: effect, actualEditEffect: effect };
  core.configureRecurrence({ getState: () => ctx.state, todayISO: ctx.todayISO, nowDateTime: now,
    minutesOf: at => Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16)), pad2: n => String(n).padStart(2, '0') });
  vm.runInContext(code, ctx);
  return { ctx, fail: value => { fail = value; }, counts: () => ({ writes, sync, ui, persisted }) };
}

for (const entry of ['toggle', 'timer', 'actual', 'start', 'end', 'stale']) test(`212 bundle ${entry}: failure restores all owners; retry persists once`, async () => {
  const f = await fixture(), c = f.ctx, block = c.state.blocks[0];
  if (entry === 'timer' || entry === 'end') {
    block.actualStartAt = '2026-09-13T09:00:00';
    c.state.pomodoro = { running: true, blockId: block.id, mode: 'focus' };
  }
  if (entry === 'stale') {
    block.updatedAt = '2026-09-13T10:04:00'; // Unrelated Task/global future values must not stamp this Block.
    block.actualStartAt = '2026-09-13T09:00:00'; block.category = 'ルーティン';
    c.state.pomodoro = { running: true, blockId: block.id };
  }
  const input = { actualStartAt: '2026-09-13T09:00', actualEndAt: '2026-09-13T10:00', comment: 'typed input' };
  const invoke = () => entry === 'toggle' ? c.toggleBlock('b') : entry === 'timer' ? c.completePomodoro()
    : entry === 'actual' ? c.saveActualEntryFromModal('b', input) : entry === 'stale' ? c.autoCloseStaleRoutineRuns('other')
      : c.runDailyOperation(entry === 'start' ? 'daily-block-start' : 'daily-block-end',
        { kind: 'block', id: 'b', outcome: entry === 'end' ? 'done' : undefined }, c.dailyOperationDeps).ok;
  const before = c.state, json = JSON.stringify(before), quick = JSON.stringify(c._quickCompleteSnapshots);
  assert.equal(invoke(), false);
  assert.equal(c.state, before); assert.equal(JSON.stringify(c.state), json);
  assert.equal(JSON.stringify(c._quickCompleteSnapshots), quick);
  assert.equal(c._pendingInterruptBlockId, 'typed-interrupt'); assert.equal(input.comment, 'typed input');
  // fixV404f(監督者追随 2026-09-14): toggle は利用者向けの入口 toggleBlock で、失敗時に案内トースト1件を出す
  // (resumeLifecycleStart と同じ作法)。保存境界の外なので ui=1。他の入口は操作そのものを直接呼ぶため ui=0。
  assert.deepEqual(f.counts(), { writes: 1, sync: 0, ui: entry === 'toggle' ? 1 : 0, persisted: undefined });
  f.fail(false); assert.equal(invoke(), true);
  assert.equal(f.counts().writes, 2); assert.equal(f.counts().sync, 1);
  assert.equal(f.counts().persisted, JSON.stringify(c.state));
  const changed = [...c.state.blocks, ...c.state.tasks, ...c.state.weeklyCommitments, ...c.state.declarations]
    .filter(row => row.updatedAt && row.updatedAt > '2026-09-13T10:05:00');
  if (entry !== 'stale') assert.ok(changed.length >= 2);
  assert.equal(new Set(changed.map(row => row.updatedAt)).size, entry === 'stale' ? 0 : 1);
  if (['toggle', 'timer', 'end'].includes(entry)) {
    assert.ok(c.state.blocks.some(b => b.recurrenceGroupId === 'follow'));
    assert.equal(c.state.habitStreaks.r.logs[block.date].doneAt, '2026-09-13T10:00:00');
  }
  if (entry === 'start') assert.equal(c.state.pomodoro.running, true);
  if (entry === 'stale') assert.equal(c.state.pomodoro.running, false);
});
