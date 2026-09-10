const assert = require('node:assert/strict');
const { runDailyOperation: run, getDailyStartDraft, prepareDailyEnd } = require('../src/features/daily-operations.js');
const { commitCandidate, setCommitGuard } = require('../src/core/commit.js');
const { mergeWeeklyCommitments } = require('../src/core/merge.js');
const { deepCommitGuard, expectRestored } = require('./helpers');
setCommitGuard(deepCommitGuard);
const at = '2026-09-10T23:50:00';
function fixture() {
  const state = {
    selectedDate: '2026-09-11', dataModifiedAt: '2026-09-10T12:00:00',
    settings: { focusTimerAuto: true, twelveWeekStartDate: '2026-09-07' },
    blocks: [
      { id: 'b', taskId: 't', date: '2026-09-10', title: '作業', actualStartAt: '', actualEndAt: '', everStartedAt: '' },
      { id: 'r', date: '2026-09-09', category: 'ルーティン', actualStartAt: '2026-09-09T22:00:00', actualEndAt: '' },
      { id: 'other', date: '2026-09-10', actualStartAt: '2026-09-10T20:00:00', actualEndAt: '' }
    ],
    tasks: [{ id: 't', status: 'todo' }, { id: 't2', status: 'todo' }],
    declarations: [], weeklyCommitments: [],
    pomodoro: { running: true, blockId: 'r', startedAt: '2026-09-09T22:00:00' }
  };
  const seen = { saves: 0, effects: 0, sync: 0, ids: 0, fail: false };
  const deps = { state, commitCandidate, now: () => at,
    newId: () => `declaration-${++seen.ids}`, currentRequest: (_state, input) => input.requestId,
    persist: () => { seen.saves++; assert.equal(seen.effects, 0); return !seen.fail; },
    scheduleSync: () => seen.sync++, startEffect: () => { seen.effects++; assert(!seen.fail); },
    weekRange: () => ({ weekStart: '2026-09-07' }),
    candidateBlocksForWeek: value => value.blocks.filter(row => row.taskId),
    commitmentItemForBlock: (_value, block, weekStart, source, now) => ({
      id: `wci_${weekStart}_${block.id}`, recordType: 'item', weekStart, source, blockId: block.id,
      createdAt: now, updatedAt: now, deleted: false
    }), mergeWeeklyCommitments,
    pomodoroForStart: (time, id) => ({ running: true, blockId: id, startedAt: time,
      endsAt: '2026-09-11T00:15:00', mode: 'focus', paused: false, pausedRemainMs: 0 })
  };
  return { state, deps, seen, input: { kind: 'block', id: 'b', requestId: 'request-1', note: '  宣言  ', estimateMin: 25 } };
}
try {
  {
    const { state, deps, seen, input } = fixture();
    state.weeklyCommitments = [
      { id: "wcw_2026-09-07", recordType: "week", updatedAt: at, deleted: true },
      { id: "wci_2026-09-07_b", recordType: "item", updatedAt: at, deleted: true }
    ];
    const original = structuredClone(state), refs = { ...state };
    seen.fail = true;
    assert.equal(run('daily-block-start', input, deps).ok, false);
    expectRestored(original, state);
    for (const key of Object.keys(refs)) assert.equal(state[key], refs[key], `rollback reference: ${key}`);
    assert.equal(seen.effects, 0); assert.equal(seen.sync, 0);
    const failedDraft = getDailyStartDraft(deps, 'b');
    assert.equal(failedDraft.declarationId, 'declaration-1'); assert.equal(failedDraft.saved, undefined);
    seen.fail = false;
    const result = run('daily-block-start', input, deps);
    assert.equal(result.ok, true); assert.equal(seen.saves, 2);
    assert.equal(seen.effects, 1); assert.equal(seen.sync, 1); assert.equal(seen.ids, 1);
    assert.equal(state.blocks[0].actualStartAt, at); assert.equal(state.blocks[0].everStartedAt, at);
    assert.equal(state.blocks[0].date, '2026-09-10'); assert.equal(state.tasks[0].status, 'doing');
    assert.deepEqual(state.tasks[1], original.tasks[1]); assert.deepEqual(state.blocks[2], original.blocks[2]);
    assert.equal(state.blocks[1].actualEndAt, '2026-09-09T23:59:00'); assert.equal(state.blocks[1].completed, false);
    assert.equal(state.pomodoro.blockId, 'b'); assert.equal(state.pomodoro.running, true);
    assert.equal(state.declarations.length, 1); assert.equal(state.weeklyCommitments.length, 2);
    assert.equal(state.declarations[0].declaredAt, at); assert.equal(state.declarations[0].date, '2026-09-10');
    assert.equal(state.declarations[0].note, '宣言'); assert.equal(result.declarationId, failedDraft.declarationId);
    assert.equal(getDailyStartDraft(deps, 'b').saved, true);
    for (const row of result.records) if (row.after) assert(row.after.updatedAt, `stamp ${row.kind}`);
    for (const row of state.weeklyCommitments) assert.equal(row.updatedAt, "2026-09-10T23:50:01", "single stamp above comparison floor");
    const saved = structuredClone(state);
    deps.now = () => '2026-09-11T00:01:00';
    assert.equal(run('daily-block-start', input, deps).unchanged, true);
    expectRestored(saved, state); assert.equal(seen.saves, 2); assert.equal(seen.effects, 1);
    assert.equal(run('daily-block-start', { ...input, requestId: 'another' }, deps).status, 'invalid');
    expectRestored(saved, state);
    console.log('PASS 28a: atomic rollback, fixed declaration ID retry, one commit/effect, cross-day date, replay and stamps');
  }
  {
    const { state, deps, seen, input } = fixture();
    state.blocks[0].everStartedAt = '2026-09-01T10:00:00';
    state.tasks[0].status = 'completed';
    state.pomodoro = { running: true, blockId: 'other', startedAt: '2026-09-10T20:00:00' };
    const timer = state.pomodoro;
    assert.equal(run('daily-block-start', { ...input, declare: false }, deps).ok, true);
    assert.equal(state.blocks[0].everStartedAt, '2026-09-01T10:00:00');
    assert.equal(state.tasks[0].status, 'completed'); assert.equal(state.pomodoro, timer);
    assert.equal(state.declarations.length, 0); assert.equal(getDailyStartDraft(deps, 'b').declarationId, '');
    assert.equal(seen.saves, 1);
    console.log('PASS 28a: prior first-start, completed Task, other timer preserved and skip has no declaration');
  }
  {
    const { state, deps, seen, input } = fixture();
    state.blocks[0].actualStartAt = '2026-09-10T09:00:00';
    const original = structuredClone(state);
    assert.equal(run('daily-block-start', input, deps).unchanged, true);
    expectRestored(original, state); assert.equal(seen.saves, 0); assert.equal(seen.effects, 0);
    assert.equal(run('daily-block-start', { ...input, id: 'missing' }, deps).status, 'invalid');
    assert.equal(run('daily-block-start', { ...input, kind: 'task' }, deps).status, 'invalid');
    assert.equal(run('daily-block-start', { ...input, date: '2026-09-09' }, deps).status, 'invalid');
    expectRestored(original, state);
    console.log('PASS 28a: already-started unchanged and invalid target/kind/date rejected');
  }
  {
    const { state, deps, input } = fixture();
    state.declarations = Array.from({ length: 300 }, (_, i) => ({ id: `old-${i}`, date: '2026-08-01' }));
    assert.equal(run('daily-block-start', input, deps).ok, true);
    assert.equal(state.declarations.length, 300); assert.equal(state.declarations[0].id, 'old-1');
    assert.equal(state.declarations.at(-1).id, 'declaration-1');
    console.log('PASS 28a: declaration cap maintained in candidate');
  }
} finally { setCommitGuard(null); }

function endFixture() {
  const f = fixture();
  f.state.blocks[0].actualStartAt = at;
  f.state.declarations = [{ id: 'started', blockId: 'b', date: '2026-09-10', declaredAt: at, reportedAt: '', note: 'original' }];
  f.state.pomodoro = { running: true, blockId: 'b', startedAt: at };
  f.deps.now = () => '2026-09-11T00:10:00';
  f.deps.persist = () => { f.seen.saves++; return !f.seen.fail; };
  f.deps.completedTask = task => ({ ...task, status: 'completed', progressNum: 10 });
  f.deps.endEffect = () => { assert(!f.seen.fail); f.seen.effects++; };
  f.input = { kind: 'block', id: 'b', requestId: 'end-1', outcome: 'done', note: 'result', completeTask: true };
  return f;
}
setCommitGuard(deepCommitGuard);
try {
  {
    const { state, deps, seen, input } = endFixture();
    const captured = prepareDailyEnd(input, deps), before = structuredClone(state), refs = { ...state };
    seen.fail = true;
    assert.equal(run('daily-block-end', captured, deps).ok, false);
    expectRestored(before, state); for (const key of Object.keys(refs)) assert.equal(state[key], refs[key]);
    assert.equal(seen.effects, 0); assert.equal(seen.sync, 0);
    assert.equal(prepareDailyEnd(input, deps).endDraft.fallbackId, captured.endDraft.fallbackId);
    seen.fail = false;
    const result = run('daily-block-end', captured, deps);
    assert(result.ok); assert.equal(seen.saves, 2); assert.equal(seen.effects, 1);
    assert.equal(state.declarations.length, 1); assert.equal(state.declarations[0].id, 'started');
    assert.equal(state.declarations[0].date, '2026-09-10'); assert.equal(state.declarations[0].reportedAt, '2026-09-11T00:10:00');
    assert.equal(state.declarations[0].declaredAt, at); assert.equal(state.declarations[0].note, 'original');
    assert.equal(state.blocks[0].actualEndAt, state.declarations[0].reportedAt);
    assert.equal(state.blocks[0].comment, 'result'); assert.equal(state.blocks[0].completed, true);
    assert.equal(state.tasks[0].status, 'completed'); assert.equal(state.tasks[0].progressNum, 10);
    assert.equal(state.pomodoro.running, false);
    assert.deepEqual(state.blocks.slice(1), before.blocks.slice(1)); assert.deepEqual(state.tasks[1], before.tasks[1]);
    const saved = structuredClone(state);
    assert.equal(run('daily-block-end', input, deps).unchanged, true); expectRestored(saved, state);
    assert.equal(seen.saves, 2); assert.equal(seen.effects, 1);
    assert(run('daily-block-end', { ...input, values: { actualEndAt: '2026-09-11T00:20:00' } }, deps).ok);
    assert.equal(state.declarations.length, 1); assert.equal(state.declarations[0].id, 'started');
    assert.equal(state.declarations[0].reportedAt, '2026-09-11T00:20:00');
    console.log('PASS 29a: cross-midnight identity/date, report/comment/Task/timer atomic rollback, retry and correction');
  }
  for (const lost of [false, true]) {
    const { state, deps, input } = endFixture(); state.declarations = [];
    const request = prepareDailyEnd({ ...input, declarationId: lost ? 'lost-start' : '', outcome: '', completeTask: false }, deps);
    assert(run('daily-block-end', request, deps).ok);
    assert.equal(state.declarations.length, 1); assert.equal(state.declarations[0].id, request.endDraft.fallbackId);
    assert.equal(state.declarations[0].date, '2026-09-10'); assert.equal(state.declarations[0].declaredAt, '');
    // Saved ID is recovered after reload without a start draft, and corrections update that report.
    const reloadedDeps = { ...deps };
    assert(run('daily-block-end', { ...input, outcome: '', completeTask: false,
      values: { actualEndAt: '2026-09-11T00:25:00' } }, reloadedDeps).ok);
    assert.equal(state.declarations.length, 1); assert.equal(state.declarations[0].id, request.endDraft.fallbackId);
  }
  for (const existing of [false, true]) {
    const { state, deps } = endFixture();
    if (!existing) state.declarations = [];
    const before = structuredClone(state.declarations);
    const skip = { kind: 'block', id: 'b', outcome: '', note: '', completeTask: false };
    assert(run('daily-block-end', skip, deps).ok);
    assert.deepEqual(state.declarations, before, 'skip neither creates nor updates a declaration/report');
    assert.equal(state.blocks[0].actualEndAt, '2026-09-11T00:10:00');
    assert.equal(state.pomodoro.running, false);
    assert.equal(run('daily-block-end', skip, deps).unchanged, true);
    assert.deepEqual(state.declarations, before);
    if (!existing) {
      assert(run('daily-block-end', { ...skip, note: '報告あり' }, deps).ok);
      assert.equal(state.declarations.length, 1, 'report without start declaration creates one record');
      assert.equal(state.declarations[0].resultNote, '報告あり');
      assert.equal(run('daily-block-end', { ...skip, note: '報告あり' }, deps).unchanged, true);
      assert.equal(state.declarations.length, 1);
    }
  }
  console.log('PASS 29b: skip preserves declarations; report without declaration creates exactly one');
  {
    const { state, deps, input } = endFixture();
    state.declarations.push({ ...state.declarations[0], id: 'ambiguous' });
    const captured = prepareDailyEnd(input, deps), before = structuredClone(state);
    assert.equal(run('daily-block-end', captured, deps).status, 'invalid'); expectRestored(before, state);
    assert(run('daily-block-end', { ...captured, declarationId: 'started' }, deps).ok);
    assert.equal(state.declarations[1].reportedAt, '');
  }
  {
    const { state, deps, input } = endFixture();
    const captured = prepareDailyEnd(input, deps); state.blocks[0].date = '2026-09-12';
    const before = structuredClone(state);
    assert.equal(run('daily-block-end', captured, deps).status, 'invalid'); expectRestored(before, state);
    assert(run('daily-block-end', { ...captured, confirmDate: '2026-09-12' }, deps).ok);
    assert.equal(state.blocks[0].date, '2026-09-12'); assert.equal(state.declarations[0].date, '2026-09-10');
  }
  for (const invalidEnd of ['2026-02-30T10:00:00', '2026-09-10T22:00:00', 'bad']) {
    const { state, deps, input } = endFixture(), before = structuredClone(state);
    assert.equal(run('daily-block-end', { ...input, values: { actualEndAt: invalidEnd } }, deps).status, 'invalid');
    expectRestored(before, state);
  }
  console.log('PASS 29a: missing/lost declaration, reload correction, ambiguity, date reconfirmation and invalid time');
} finally { setCommitGuard(null); }


// fixB5c: stale drafts must follow corrected records within the same tab.
{
  const { state, deps, input } = fixture();
  deps.persist = () => true;
  assert(run('daily-block-start', input, deps).ok);
  const old = getDailyStartDraft(deps, 'b');
  state.blocks[0].actualStartAt = '';
  deps.now = () => '2026-09-10T23:55:00';
  assert(run('daily-block-start', input, deps).ok);
  assert.equal(state.blocks[0].actualStartAt, '2026-09-10T23:55:00');
  assert.notEqual(getDailyStartDraft(deps, 'b').declarationId, old.declarationId);
  assert.equal(state.declarations.length, 2);
  console.log('PASS fixB5c: start draft renewed after clearing actual start');
}
{
  const { state, deps, input } = endFixture();
  assert(run('daily-block-end', input, deps).ok);
  state.blocks[0].actualEndAt = '2026-09-11T00:15:00';
  assert.equal(prepareDailyEnd(input, deps).endDraft.actualEndAt, state.blocks[0].actualEndAt);
  state.blocks[0].actualStartAt = '2026-09-10T23:45:00';
  state.declarations = [{ ...state.declarations[0], id: 'corrected', declaredAt: state.blocks[0].actualStartAt }];
  const next = prepareDailyEnd(input, deps);
  assert.equal(next.endDraft.actualStartAt, state.blocks[0].actualStartAt);
  assert(run('daily-block-end', next, deps).ok);
  assert.equal(state.declarations.length, 1);
  assert.equal(state.declarations[0].id, 'corrected');
  console.log('PASS fixB5c: end draft renewed after actual/declaration correction');
}
{
  const { state, deps, seen, input } = endFixture();
  const captured = prepareDailyEnd({ ...input, timer: true }, deps);
  state.pomodoro = { running: true, blockId: '', lastFocusBlockId: 'b', mode: 'break' };
  assert(run('daily-block-end', captured, deps).ok);
  assert.equal(state.pomodoro.running, false);
  assert.equal(state.pomodoro.blockId, '');
  assert.equal(state.blocks[0].completed, true);
  assert.equal(seen.saves, 1);
  console.log('PASS fixB5c: focus to break then done stops timer and completes in one save');
}

// Real delegated entrances share the same candidate and preserve the declaration UI on failure.
const { chromium, launchOptions, startServer, randomPort, STATE_KEY, passGithubGate } = require('./helpers');
(async () => {
  const server = startServer(randomPort());
  let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'ja-JP',
      serviceWorkers: 'block', viewport: { width: 1100, height: 900 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('pageerror:', error.message); });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'localhost') return route.abort();
      if (/personal-data|AIプラン|AIフィードバック|週次レビュー/.test(decodeURIComponent(url.pathname)))
        return route.fulfill({ status: 404, body: 'fixture only' });
      return route.continue();
    });
    await page.clock.setFixedTime(new Date(2026, 8, 10, 23, 50));
    await page.goto(`http://localhost:${server.address().port}/`);
    await passGithubGate(page);
    for (const action of ['now-start', 'daily-block-start', 'start-pomodoro']) {
      await page.evaluate(({ key, action }) => {
        const s = JSON.parse(localStorage.getItem(key));
        s.selectedDate = '2026-09-10'; s.currentView = 'timeline';
        s.settings.lastOpenedDate = '2026-09-10'; s.settings.autoSync = false;
        s.settings.github.autoSave = false; s.settings.focusTimerAuto = true;
        s.settings.twelveWeekStartDate = ''; s.settings.guidedAccessHintDismissed = true;
        s.projects = []; s.tasks = [{ id: 'start-task', title: 'fixture task', status: 'todo' }];
        s.blocks = [{ id: 'start-block', taskId: 'start-task', title: '開始の架空予定', date: '2026-09-10',
          plannedStartAt: '2026-09-10T23:30:00', plannedEndAt: '2026-09-10T23:55:00',
          actualStartAt: '', actualEndAt: '', everStartedAt: '', completed: false }];
        s.declarations = []; s.weeklyCommitments = []; s.recurrences = [];
        s.pomodoro = { running: false, blockId: '', startedAt: '', endsAt: '', mode: 'focus', paused: false, pausedRemainMs: 0 };
        localStorage.setItem(key, JSON.stringify(s));
      }, { key: STATE_KEY, action });
      await page.reload();
      await page.locator('[data-action="now-start"][data-id="start-block"]').first().waitFor();
      // New UI is not shipped yet. Stable fixture controls exercise the real document delegation;
      // do not rewrite a rendered row, since a pending render can replace it before the click.
      if (action === 'now-start') await page.locator('[data-action="now-start"][data-id="start-block"]').first().click();
      else {
        await page.evaluate(action => {
          const el = document.createElement('button'); el.id = 'startTestTrigger'; el.textContent = 'fixture start';
          Object.assign(el.dataset, { action, kind: 'block', id: 'start-block', blockId: 'start-block' });
          document.body.append(el);
        }, action);
        await page.locator('#startTestTrigger').click();
      }
      const note = page.locator('[data-declare-note]');
      await note.fill('失敗しても残る宣言');
      const original = await page.evaluate(async () => {
        const s = (await import('/src/state/store.js')).state;
        window.__startInput = document.querySelector('[data-declare-note]');
        return JSON.parse(JSON.stringify({ blocks:s.blocks,tasks:s.tasks,declarations:s.declarations,
          weeklyCommitments:s.weeklyCommitments,pomodoro:s.pomodoro,dataModifiedAt:s.dataModifiedAt }));
      });
      await page.evaluate(key => {
        window.__setStart = Storage.prototype.setItem; window.__startWrites = 0; window.__startFail = true;
        Storage.prototype.setItem = function(k,v) {
          if (k === key) { window.__startWrites++; if (window.__startFail) throw new DOMException('fixture quota', 'QuotaExceededError'); }
          return window.__setStart.call(this,k,v);
        };
      }, STATE_KEY);
      await page.locator('[data-action="declare-confirm"]').click();
      assert.equal(await note.inputValue(), '失敗しても残る宣言');
      assert(await note.evaluate(el => el === window.__startInput));
      const failed = await page.evaluate(async () => {
        const s = (await import('/src/state/store.js')).state;
        return JSON.parse(JSON.stringify({ blocks:s.blocks,tasks:s.tasks,declarations:s.declarations,
          weeklyCommitments:s.weeklyCommitments,pomodoro:s.pomodoro,dataModifiedAt:s.dataModifiedAt }));
      });
      assert.deepEqual(failed, original, action + ': all candidate fields rollback');
      assert.equal(await page.evaluate(() => window.__startWrites), 1);
      const failedDraft = await page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('taskchute-journal-daily-draft-v1:')).map(key => JSON.parse(sessionStorage.getItem(key)))
        .find(draft => draft.id === 'start-block' && draft.draftId === 'start'));
      assert(failedDraft.declarationId);
      await page.evaluate(() => { window.__startFail = false; });
      await page.locator('[data-action="declare-confirm"]').evaluate(el => { el.click(); el.click(); });
      await page.waitForFunction(() => !(document.querySelector('#modalRoot')?.classList.contains('open')));
      const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
      assert.equal(await page.evaluate(() => window.__startWrites), 2, 'one successful persistence despite double click');
      assert.equal(saved.blocks[0].actualStartAt, '2026-09-10T23:50:00');
      assert.equal(saved.blocks[0].everStartedAt, saved.blocks[0].actualStartAt);
      assert.equal(saved.tasks[0].status, 'doing'); assert(saved.pomodoro.running);
      assert.equal(saved.pomodoro.blockId, 'start-block'); assert.equal(saved.declarations.length, 1);
      assert.equal(saved.declarations[0].id, failedDraft.declarationId);
      assert.equal(saved.declarations[0].date, '2026-09-10');
      assert.equal(saved.declarations[0].declaredAt, saved.blocks[0].actualStartAt);
      assert.equal(saved.declarations[0].note, '失敗しても残る宣言');
      if (action === 'start-pomodoro') {
        await page.evaluate(async () => {
          // A break session can be stopped without clearing the Block's actual start.
          const s = (await import('/src/state/store.js')).state;
          s.pomodoro = { ...s.pomodoro, mode: 'break', blockId: '', lastFocusBlockId: 'start-block' };
          const el = document.createElement('button'); el.id = 'stopTestTrigger';
          el.dataset.action = 'stop-pomodoro'; document.body.append(el);
        });
        await page.locator('#stopTestTrigger').click();
        assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).pomodoro.running, STATE_KEY), false);
        await page.clock.setFixedTime(new Date(2026, 8, 10, 23, 55));
        await page.evaluate(() => { window.__startWrites = 0; });
        await page.locator('#startTestTrigger').click();
        const restarted = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
        assert.equal(await page.evaluate(() => window.__startWrites), 1, 'restart persists once');
        assert.equal(restarted.blocks[0].actualStartAt, saved.blocks[0].actualStartAt);
        assert.equal(restarted.declarations.length, 1);
        assert.equal(restarted.pomodoro.running, true);
        assert.equal(restarted.pomodoro.blockId, 'start-block');
        assert.equal(restarted.pomodoro.startedAt, '2026-09-10T23:55:00');
        console.log('PASS fixB5c: delegated pomodoro restart preserves actual start');
      }
      await page.evaluate(() => { Storage.prototype.setItem = window.__setStart; });
      console.log(`PASS 28b: ${action} atomic save, rollback/input retention, fixed ID retry and double click`);
    }
    for (const action of ['now-end', 'daily-block-end']) {
      await page.evaluate(key => {
        const s = JSON.parse(localStorage.getItem(key));
        s.selectedDate = '2026-09-10'; s.settings.lastOpenedDate = '2026-09-11';
        s.tasks = [{ id: 'end-task', title: 'fixture task', status: 'doing', progressDen: 5, progressNum: 1 }];
        s.blocks = [{ id: 'end-block', taskId: 'end-task', date: '2026-09-10', title: '日跨ぎ終了',
          plannedStartAt: '2026-09-10T23:30:00', plannedEndAt: '2026-09-10T23:55:00',
          actualStartAt: '2026-09-10T23:50:00', actualEndAt: '', completed: false, comment: '元コメント' }];
        s.declarations = [{ id: 'midnight-declaration', blockId: 'end-block', date: '2026-09-10',
          title: '日跨ぎ終了', declaredAt: '2026-09-10T23:50:00', reportedAt: '', note: '開始宣言' }];
        s.weeklyCommitments = []; s.recurrences = [];
        s.pomodoro = { running: true, blockId: 'end-block', startedAt: '2026-09-10T23:50:00',
          endsAt: '2026-09-11T00:15:00', mode: 'focus', paused: false, pausedRemainMs: 0 };
        localStorage.setItem(key, JSON.stringify(s));
      }, STATE_KEY);
      await page.clock.setFixedTime(new Date(2026, 8, 11, 0, 10));
      await page.reload();
      await page.evaluate(action => {
        const el = document.createElement('button'); el.id = 'endTestTrigger'; el.textContent = 'fixture end';
        Object.assign(el.dataset, { action, kind: 'block', id: 'end-block' }); document.body.append(el);
      }, action);
      await page.locator('#endTestTrigger').click();
      const note = page.locator('[data-report-note]'), end = page.locator('[data-modal-field="actualEndAt"]');
      await note.fill('終了の入力を保持');
      assert((await end.inputValue()).startsWith('2026-09-11T00:10'));
      assert.equal(await end.getAttribute('type'), 'datetime-local'); assert.equal(await end.getAttribute('step'), '300');
      assert(await end.evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16));
      await page.locator('[data-modal-field="completeTask"]').check();
      if (action === 'daily-block-end') {
        await page.evaluate(async () => { (await import('/src/state/store.js')).state.blocks[0].date = '2026-09-12'; });
        await page.locator('[data-action="report-outcome"][data-outcome="partial"]').click();
        assert.equal(await note.inputValue(), '終了の入力を保持');
        assert(await page.evaluate(() => document.body.textContent.includes('帰属日が2026-09-12に変わりました')));
        assert.equal(await page.evaluate(async () => (await import('/src/state/store.js')).state.blocks[0].actualEndAt), '');
      }
      const before = await page.evaluate(async () => {
        const s = (await import('/src/state/store.js')).state; window.__endInput = document.querySelector('[data-report-note]');
        return JSON.parse(JSON.stringify({ blocks:s.blocks,tasks:s.tasks,declarations:s.declarations,pomodoro:s.pomodoro,dataModifiedAt:s.dataModifiedAt }));
      });
      await page.evaluate(key => {
        window.__setEnd = Storage.prototype.setItem; window.__endFail = true; window.__endWrites = 0;
        Storage.prototype.setItem = function(k,v) {
          if (k === key) { window.__endWrites++; if (window.__endFail) throw new DOMException('fixture quota', 'QuotaExceededError'); }
          return window.__setEnd.call(this,k,v);
        };
      }, STATE_KEY);
      await page.locator('[data-action="report-outcome"][data-outcome="partial"]').click();
      assert.equal(await note.inputValue(), '終了の入力を保持'); assert(await note.evaluate(el => el === window.__endInput));
      assert(await page.locator('[data-modal-field="completeTask"]').isChecked());
      assert.equal(await page.evaluate(() => window.__endWrites), 1);
      const failed = await page.evaluate(async () => {
        const s = (await import('/src/state/store.js')).state;
        return JSON.parse(JSON.stringify({ blocks:s.blocks,tasks:s.tasks,declarations:s.declarations,pomodoro:s.pomodoro,dataModifiedAt:s.dataModifiedAt }));
      });
      assert.deepEqual(failed, before);
      await page.evaluate(() => { window.__endFail = false; });
      await page.locator('[data-action="report-outcome"][data-outcome="partial"]').evaluate(el => { el.click(); el.click(); });
      await page.waitForFunction(() => !document.querySelector('#modalRoot').classList.contains('open'));
      let saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
      assert.equal(await page.evaluate(() => window.__endWrites), 2);
      assert.equal(saved.blocks[0].actualEndAt, '2026-09-11T00:10:00');
      assert.equal(saved.blocks[0].date, action === 'daily-block-end' ? '2026-09-12' : '2026-09-10');
      assert.equal(saved.blocks[0].completed, false); assert.equal(saved.blocks[0].comment, '元コメント\n終了の入力を保持');
      assert.equal(saved.tasks[0].status, 'completed'); assert.equal(saved.tasks[0].progressNum, 5);
      assert.equal(saved.pomodoro.running, false); assert.equal(saved.declarations.length, 1);
      assert.equal(saved.declarations[0].id, 'midnight-declaration'); assert.equal(saved.declarations[0].date, '2026-09-10');
      assert.equal(saved.declarations[0].reportedAt, '2026-09-11T00:10:00');
      await page.locator('#endTestTrigger').click(); await end.fill('2026-09-11T00:20');
      await note.fill('終了の入力を保持');
      await page.locator('[data-action="report-outcome"][data-outcome="partial"]').click();
      saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
      assert.equal(saved.declarations.length, 1); assert.equal(saved.declarations[0].id, 'midnight-declaration');
      assert.equal(saved.declarations[0].reportedAt, '2026-09-11T00:20:00');
      assert.equal(saved.blocks[0].comment, '元コメント\n終了の入力を保持');
      await page.evaluate(() => { Storage.prototype.setItem = window.__setEnd; });
      console.log(`PASS 29b: ${action} midnight binding, atomic rollback/Task/comment/timer, input retention, retry/correction/date confirmation`);
    }
    // v385 契約追随(監督者決定 2026-09-11): stale end versus completed correction.
    for (const completed of [false, true]) {
      await page.clock.setFixedTime(new Date(2026, 8, 11, 0, 10));
      await page.evaluate(({ key, completed }) => {
        const s = JSON.parse(localStorage.getItem(key));
        s.blocks[0].date = '2026-09-10';
        s.blocks[0].actualStartAt = '2026-09-10T23:50:00';
        s.blocks[0].actualEndAt = '2026-09-11T00:05:00';
        s.blocks[0].completed = completed;
        s.declarations = []; s.weeklyCommitments = [];
        s.pomodoro = { running: !completed, blockId: 'end-block', mode: 'focus',
          startedAt: '2026-09-10T23:50:00', endsAt: '2026-09-11T00:15:00' };
        localStorage.setItem(key, JSON.stringify(s));
      }, { key: STATE_KEY, completed });
      await page.reload();
      await page.evaluate(completed => {
        const el = document.createElement('button'); el.id = 'staleEndTrigger';
        Object.assign(el.dataset, { action: completed ? 'daily-block-end' : 'complete-pomodoro',
          kind: 'block', id: 'end-block' }); document.body.append(el);
      }, completed);
      await page.locator('#staleEndTrigger').click();
      assert.equal(await page.locator('[data-modal-field="actualEndAt"]').inputValue(),
        completed ? '2026-09-11T00:05' : '2026-09-11T00:10');
      await page.locator('[data-action="report-skip"]').click();
      const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
      assert.equal(saved.blocks[0].actualEndAt, completed ? '2026-09-11T00:05:00' : '2026-09-11T00:10:00');
      assert.equal(saved.blocks[0].completed, true);
      console.log('PASS fixV385: ' + (completed ? 'completed correction retains end' : 'complete-pomodoro/report-skip overwrites stale end'));
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
