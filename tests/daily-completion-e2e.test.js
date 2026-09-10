const assert = require('node:assert/strict');
const { runDailyOperation: run, dailyFingerprint } = require('../src/features/daily-operations.js');
const { commitCandidate, setCommitGuard } = require('../src/core/commit.js');
const { deepCommitGuard, expectRestored, chromium, launchOptions, startServer,
  randomPort, STATE_KEY, passGithubGate } = require('./helpers');

function fixture() {
  const state = { selectedDate: '2026-09-10', dataModifiedAt: '2026-09-10T08:00:00',
    blocks: [{ id: 'b', date: '2026-09-10', taskId: 't', title: '予定', completed: false,
      actualStartAt: '', actualEndAt: '', everStartedAt: '', comment: '記録', charge: 3 },
    { id: 'other', date: '2026-09-11', taskId: 't', completed: false, actualStartAt: '', actualEndAt: '' }],
    tasks: [{ id: 't', status: 'todo', progressNum: 1, progressDen: 5 }, { id: 't2', status: 'todo' }],
    declarations: [], pomodoro: { running: false }, weeklyCommitments: [] };
  const seen = { saves: 0, effects: 0, sync: 0, end: 0, fail: false };
  const deps = { state, commitCandidate, now: () => '2026-09-10T10:00:00',
    persist: () => { seen.saves++; return !seen.fail; }, scheduleSync: () => seen.sync++,
    planCompletionEffect: block => { assert(!seen.fail); assert.equal(state.blocks[0].completed, block.completed); seen.effects++; },
    requestPlanEnd: block => { assert.equal(block.id, 'b'); seen.end++; } };
  return { state, deps, seen, input: { kind: 'block', id: 'b', desiredCompleted: true } };
}

setCommitGuard(deepCommitGuard);
try {
  {
    const { state, deps, seen, input } = fixture(), original = structuredClone(state), refs = { ...state };
    seen.fail = true;
    assert.equal(run('daily-plan-complete', input, deps).ok, false);
    expectRestored(original, state);
    for (const key of Object.keys(refs)) assert.equal(state[key], refs[key]);
    assert.equal(seen.effects, 0); assert.equal(seen.sync, 0);
    seen.fail = false;
    const result = run('daily-plan-complete', input, deps);
    assert(result.ok); assert.equal(result.records.length, 1); assert.equal(result.records[0].kind, 'blocks');
    assert.equal(state.blocks[0].completed, true); assert.equal(state.blocks[0].actualStartAt, '');
    assert.equal(state.blocks[0].actualEndAt, ''); assert.equal(state.blocks[0].everStartedAt, '');
    assert.equal(state.blocks[0].comment, '記録'); assert.equal(state.blocks[0].charge, 3);
    assert.deepEqual(state.tasks, original.tasks); assert.deepEqual(state.blocks[1], original.blocks[1]);
    assert(state.blocks[0].updatedAt); assert(state.dataModifiedAt > original.dataModifiedAt);
    const saved = structuredClone(state);
    assert.equal(run('daily-plan-complete', input, deps).unchanged, true); expectRestored(saved, state);
    assert.equal(seen.saves, 2); assert.equal(seen.effects, 1); assert.equal(seen.sync, 1);
    assert(run('daily-plan-complete', { ...input, desiredCompleted: false }, deps).ok);
    assert.equal(state.blocks[0].completed, false); assert.equal(state.blocks[0].actualStartAt, '');
    console.log('PASS 30: desired plan completion, unmeasured actuals empty, replay, undo, stamps and atomic rollback');
  }
  {
    const { state, deps, seen, input } = fixture();
    state.blocks[0].actualStartAt = '2026-09-10T09:00:00';
    state.pomodoro = { running: true, blockId: 'b' };
    const before = structuredClone(state);
    const result = run('daily-plan-complete', input, deps);
    assert(result.ok && result.confirmEnd); expectRestored(before, state);
    assert.equal(seen.saves, 0); assert.equal(seen.effects, 0); assert.equal(seen.sync, 0); assert.equal(seen.end, 1);
    state.blocks[0].actualEndAt = '2026-09-10T09:30:00'; state.blocks[0].completed = true;
    assert(run('daily-plan-complete', { ...input, desiredCompleted: false }, deps).ok);
    assert.equal(state.blocks[0].actualStartAt, '2026-09-10T09:00:00');
    assert.equal(state.blocks[0].actualEndAt, '2026-09-10T09:30:00');
    console.log('PASS 30: running plan delegates end confirmation without persistence; undo preserves measured actuals');
  }
  {
    const { state, deps, seen, input } = fixture();
    for (const changes of [{ desiredCompleted: undefined }, { desiredCompleted: 1 }, { desiredCompleted: 'yes' },
      { id: 'missing' }, { kind: 'task' }, { date: '2026-09-09' }, { requestId: 'unowned' }]) {
      const before = structuredClone(state);
      assert.equal(run('daily-plan-complete', { ...input, ...changes }, deps).status, 'invalid'); expectRestored(before, state);
    }
    const baseFingerprint = dailyFingerprint(state.blocks[0]); state.blocks[0].title = '同期後';
    assert.equal(run('daily-plan-complete', { ...input, baseFingerprint }, deps).status, 'invalid');
    state.blocks[0].deleted = true;
    assert.equal(run('daily-plan-complete', input, deps).status, 'invalid'); assert.equal(seen.saves, 0);
    console.log('PASS 30: invalid desired state, deleted/missing target, stale date/fingerprint and unowned request rejected');
  }
} finally { setCommitGuard(null); }

(async () => {
  const server = startServer(randomPort()); let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'ja-JP',
      serviceWorkers: 'block', viewport: { width: 1100, height: 900 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'localhost') return route.abort();
      if (/personal-data|AIプラン|AIフィードバック|週次レビュー/.test(decodeURIComponent(url.pathname)))
        return route.fulfill({ status: 404, body: 'fixture only' });
      return route.continue();
    });
    await page.clock.setFixedTime(new Date(2026, 8, 10, 10));
    await page.goto(`http://localhost:${server.address().port}/`); await passGithubGate(page);
    const seed = async () => {
      await page.evaluate(({ key, fixtureState }) => {
        const s = JSON.parse(localStorage.getItem(key)); Object.assign(s, fixtureState);
        s.currentView = 'timeline'; s.recurrences = []; s.projects = []; s.bodyScans = [];
        s.settings.lastOpenedDate = '2026-09-10'; s.settings.autoSync = false;
        s.settings.github.autoSave = false; s.settings.focusTimerAuto = false; s.settings.twelveWeekStartDate = '';
        localStorage.setItem(key, JSON.stringify(s));
      }, { key: STATE_KEY, fixtureState: fixture().state });
      await page.reload(); await page.locator('#app[data-view="timeline"]').waitFor();
    };
    const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    const trigger = (action, kind, id, desiredCompleted) => page.evaluate(input => {
      let button = document.querySelector('#completionTestTrigger');
      if (!button) { button = document.createElement('button'); button.id = 'completionTestTrigger'; document.body.append(button); }
      Object.assign(button.dataset, input); button.click();
    }, { action, kind, id, desiredCompleted: String(desiredCompleted) });
    await seed();
    const before = await stored();
    await page.evaluate(key => {
      window.__completionSet = Storage.prototype.setItem; window.__completionFail = true; window.__completionWrites = 0;
      Storage.prototype.setItem = function(k, v) {
        if (k === key) { window.__completionWrites++; if (window.__completionFail) throw new DOMException('fixture quota', 'QuotaExceededError'); }
        return window.__completionSet.call(this, k, v);
      };
    }, STATE_KEY);
    await trigger('daily-plan-complete', 'block', 'b', true);
    assert.deepEqual(await stored(), before);
    assert.equal(await page.evaluate(async () => (await import('/src/state/store.js')).state.blocks[0].completed), false);
    await page.evaluate(() => { window.__completionFail = false; });
    await trigger('daily-plan-complete', 'block', 'b', true);
    await trigger('daily-plan-complete', 'block', 'b', true);
    let saved = await stored();
    assert.equal(saved.blocks[0].completed, true); assert.equal(saved.blocks[0].actualStartAt, '');
    assert.equal(saved.blocks[0].actualEndAt, ''); assert.equal(saved.blocks[0].everStartedAt, '');
    assert.deepEqual(saved.tasks, before.tasks); assert.deepEqual(saved.blocks[1], before.blocks[1]);
    assert.equal(await page.evaluate(() => window.__completionWrites), 2);
    await trigger('daily-plan-complete', 'block', 'b', false);
    saved = await stored(); assert.equal(saved.blocks[0].completed, false); assert.equal(saved.blocks[0].actualEndAt, '');
    await page.evaluate(() => { Storage.prototype.setItem = window.__completionSet; });
    await page.reload(); assert.equal((await stored()).blocks[0].completed, false);
    console.log('PASS 30: delegated desired plan completion, failure display/state rollback, replay, undo and reload');

    await page.evaluate(key => {
      const s = JSON.parse(localStorage.getItem(key)); s.blocks[0].actualStartAt = '2026-09-10T09:00:00';
      localStorage.setItem(key, JSON.stringify(s));
    }, STATE_KEY);
    await page.reload(); await page.locator('#app[data-view="timeline"]').waitFor();
    const running = await stored();
    await trigger('daily-plan-complete', 'block', 'b', true);
    await page.locator('[data-report-note]').waitFor(); assert.deepEqual(await stored(), running);
    await page.locator('#modalRoot [data-action="modal-close"]').first().click();
    assert.deepEqual(await stored(), running);
    await trigger('daily-plan-complete', 'block', 'b', true);
    await page.locator('[data-action="report-outcome"][data-outcome="partial"]').click();
    saved = await stored(); assert.equal(saved.blocks[0].completed, true);
    assert.equal(saved.blocks[0].actualStartAt, '2026-09-10T09:00:00');
    assert.equal(saved.blocks[0].actualEndAt, '2026-09-10T10:00:00');
    assert.equal(saved.tasks[0].status, 'todo');
    console.log('PASS 30: running confirmation/cancel preserve measurement; confirmed partial report honors desired plan completion');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
