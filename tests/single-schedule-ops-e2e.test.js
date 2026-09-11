const assert = require('node:assert/strict');
const { chromium, launchOptions, startServer, randomPort } = require('./helpers');

(async () => {
  const server = startServer(randomPort());
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ timezoneId: 'Asia/Tokyo', locale: 'ja-JP', serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'localhost') return route.abort();
      if (url.pathname === '/schedule-fixture') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>38 isolated registry fixture</title>' });
      return route.continue();
    });
    await page.clock.setFixedTime(new Date(2026, 8, 11, 10));
    await page.goto(`http://localhost:${server.address().port}/schedule-fixture`);
    const boot = () => page.evaluate(async () => {
      const { runDailyOperation } = await import('/src/features/daily-operations.js');
      const { getSingleScheduleDraft } = await import('/src/features/single-schedule.js');
      const { contentKey } = await import('/src/core/single-schedule-merge.js');
      const { commitCandidate } = await import('/src/core/commit.js');
      const initial = { selectedDate: '2026-09-11', singleSchedules: [],
        tasks: [{ id: 'untouched-task', status: 'todo' }], blocks: [{ id: 'untouched-block' }],
        actualEntries: [{ id: 'untouched-actual' }], tracks: [{ id: 'untouched-track' }],
        weeklyCommitments: { fixture: 'unchanged' }, declarations: [], reports: { fixture: 'unchanged' } };
      const state = JSON.parse(localStorage.getItem('schedule-38-state') || JSON.stringify(initial));
      const side = () => JSON.stringify(Object.fromEntries(Object.entries(state).filter(([key]) => !['singleSchedules', 'dataModifiedAt', 'selectedDate'].includes(key))));
      const sideBefore = side();
      const deps = { state, now: () => '2026-09-11T10:00:00', commitCandidate,
        persist: s => { localStorage.setItem('schedule-38-state', JSON.stringify(s)); return true; },
        scheduleSync: () => { window.syncCalls++; if (window.failSync) throw Error('fixture external sync failed'); },
        singleScheduleEffect: () => { window.effectCalls++; },
        refreshActualReports: () => { throw Error('schedule must not refresh actual reports'); } };
      Object.assign(window, { state, deps, side, sideBefore, fp: contentKey, syncCalls: 0, effectCalls: 0,
        run: (action, input) => runDailyOperation(`daily-schedule-${action}`, { kind: 'schedule', ...input }, deps),
        draft: (action, input) => getSingleScheduleDraft(action, { kind: 'schedule', ...input }, deps),
        values: { title: '架空予定', date: '2026-12-31', start: '23:30', end: '24:00', endNextDay: false, note: '入力を保持' },
        failStorage: fail => {
          window.originalSetItem ||= Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (fail && key === 'schedule-38-state') throw new DOMException('fixture quota', 'QuotaExceededError');
            return window.originalSetItem.call(this, key, value);
          };
        } });
    });
    const unchangedSide = async () => assert.equal(await page.evaluate(() => side()), await page.evaluate(() => sideBefore));
    await boot();
    assert.deepEqual(await page.evaluate(() => ({ rows: state.singleSchedules, saved: localStorage.getItem('schedule-38-state') })), { rows: [], saved: null });
    // Every malformed member must reject the entire candidate without changing any state.
    for (const patch of [ { title: ' ' }, { title: null }, { note: 4 }, { date: '2026-02-30' },
      { start: '' }, { start: '24:00' }, { end: '' }, { end: '23:00' }, { end: '24:05' },
      { start: '25:00' }, { endNextDay: 'true' }, { start: '2027-01-01T09:00:00' },
      { end: '2027-01-02T01:00:00' } ]) {
      const result = await page.evaluate(patch => {
        const before = JSON.stringify(state);
        const result = run('add', { requestId: 'invalid', values: { ...values, ...patch } });
        return { status: result.status, restored: JSON.stringify(state) === before, saved: localStorage.getItem('schedule-38-state') };
      }, patch);
      assert.deepEqual(result, { status: 'invalid', restored: true, saved: null });
    }
    console.log('PASS 13 invalid input combinations reject atomically');
    // Failure retains the candidate and inputs in sessionStorage, and reload resumes that id.
    const candidate = await page.evaluate(() => {
      failStorage(true);
      const before = JSON.stringify(state), result = run('add', { requestId: 'create', values });
      return { ok: result.ok, restored: JSON.stringify(state) === before, draft: draft('add', { requestId: 'create' }), syncCalls, effectCalls };
    });
    assert.equal(candidate.ok, false); assert.equal(candidate.restored, true);
    assert.equal(candidate.syncCalls, 0); assert.equal(candidate.effectCalls, 0);
    assert.equal(candidate.draft.values.note, '入力を保持');
    await page.reload(); await boot();
    assert.equal(await page.evaluate(() => draft('add', { requestId: 'create' }).candidateId), candidate.draft.candidateId);
    const added = await page.evaluate(() => run('add', { requestId: 'create' }));
    assert.equal(added.ok, true);
    assert.equal(added.records[0].after.id, candidate.draft.candidateId);
    assert.equal(added.records[0].after.plannedEndAt, '2027-01-01T00:00:00');
    assert.equal(await page.evaluate(() => run('add', { requestId: 'create' }).unchanged), true);
    assert.equal(await page.evaluate(() => state.singleSchedules.length), 1);
    await unchangedSide();
    console.log('PASS add quota rollback/reload/same candidate id/24:00/retry/no side effects');
    await page.reload(); await boot();
    assert.equal(await page.evaluate(() => run('add', { requestId: 'create' }).unchanged), true);
    // Edit uses the fingerprint from opening, changes the recorded date, and never selectedDate.
    const edited = await page.evaluate(() => {
      const before = JSON.stringify(state), record = state.singleSchedules[0];
      failStorage(true);
      const result = run('edit', { id: record.id, requestId: 'edit', baseFingerprint: fp(record),
        values: { title: '年越し後の予定', date: '2027-01-02', start: '23:50', end: '00:20', endNextDay: true, note: '編集失敗でも保持' } });
      return { ok: result.ok, restored: before === JSON.stringify(state), draft: draft('edit', { id: record.id, requestId: 'edit' }) };
    });
    assert.equal(edited.ok, false); assert.equal(edited.restored, true);
    await page.reload(); await boot();
    const editResult = await page.evaluate(() => run('edit', { id: state.singleSchedules[0].id, requestId: 'edit' }));
    assert.equal(editResult.ok, true);
    assert.equal(editResult.records[0].after.id, candidate.draft.candidateId);
    assert.equal(editResult.records[0].after.plannedEndAt, '2027-01-03T00:20:00');
    assert.equal(editResult.records[0].after.note, edited.draft.values.note);
    assert(editResult.records[0].after.updatedAt > added.records[0].after.updatedAt);
    assert.equal(await page.evaluate(() => state.selectedDate), '2026-09-11');
    assert.equal(await page.evaluate(() => run('edit', { id: state.singleSchedules[0].id, requestId: 'edit' }).unchanged), true);
    await unchangedSide();
    console.log('PASS edit rollback/reload/original id/explicit next day/updatedAt');
    for (const desiredCompleted of [true, false]) {
      assert.equal(await page.evaluate(desired => {
        const record = state.singleSchedules[0], before = JSON.stringify(state);
        failStorage(true);
        const result = run('complete', { id: record.id, requestId: `complete-${desired}`,
          baseFingerprint: fp(record), desiredCompleted: desired });
        return !result.ok && before === JSON.stringify(state);
      }, desiredCompleted), true);
      await page.reload(); await boot();
      assert.equal(await page.evaluate(desired => run('complete', { id: state.singleSchedules[0].id, requestId: `complete-${desired}` }).ok, desiredCompleted), true);
      assert.equal(await page.evaluate(() => state.singleSchedules[0].completed), desiredCompleted);
      assert.equal(await page.evaluate(desired => run('complete', { id: state.singleSchedules[0].id, requestId: `complete-${desired}` }).unchanged, desiredCompleted), true);
      await unchangedSide();
    }
    console.log('PASS desired completion/uncompletion rollback/reload/idempotency/no Task or actual writes');
    const conflict = await page.evaluate(() => {
      const record = state.singleSchedules[0], input = { id: record.id, requestId: 'conflict', baseFingerprint: fp(record), values };
      failStorage(true); run('edit', input); failStorage(false);
      record.title = '別端末による変更'; record.updatedAt = '2027-01-05T09:00:00';
      deps.persist(state);
      return input;
    });
    await page.reload(); await boot();
    assert.equal(await page.evaluate(input => run('edit', input).status, conflict), 'invalid');
    assert.equal(await page.evaluate(() => state.singleSchedules[0].title), '別端末による変更');
    assert.equal(await page.evaluate(input => draft('edit', input).values.note, { kind: 'schedule', ...conflict }), '入力を保持');
    assert.equal(await page.evaluate(() => run('edit', { id: 'missing', requestId: 'missing', baseFingerprint: 'missing', values }).status), 'invalid');
    // Changing a confirmed owner or omitting the desired value must never perform a write.
    for (const [action, extra] of [['complete', {}], ['complete', { desiredCompleted: 'true' }], ['delete', {}]]) {
      assert.equal(await page.evaluate(({ action, extra }) => run(action, { id: state.singleSchedules[0].id,
        requestId: `invalid-${action}-${JSON.stringify(extra)}`, baseFingerprint: fp(state.singleSchedules[0]), ...extra }).status, { action, extra }), 'invalid');
    }
    console.log('PASS remote conflict retains latest + draft, missing target and confirmation/value guards');
    const deleteFailure = await page.evaluate(() => {
      const before = JSON.stringify(state), record = state.singleSchedules[0];
      failStorage(true);
      const result = run('delete', { id: record.id, requestId: 'delete', baseFingerprint: fp(record), confirmed: true });
      return { ok: result.ok, restored: before === JSON.stringify(state) };
    });
    assert.deepEqual(deleteFailure, { ok: false, restored: true });
    await page.reload(); await boot();
    assert.equal(await page.evaluate(() => run('delete', { id: state.singleSchedules[0].id, requestId: 'delete' }).ok), true);
    assert.equal(await page.evaluate(() => state.singleSchedules[0].deleted), true);
    assert.equal(await page.evaluate(() => state.singleSchedules.length), 1);
    assert.equal(await page.evaluate(() => run('delete', { id: state.singleSchedules[0].id, requestId: 'delete' }).unchanged), true);
    assert.equal(await page.evaluate(() => run('add', { requestId: 'create' }).status), 'invalid');
    assert.equal(await page.evaluate(input => run('edit', input).status, conflict), 'invalid');
    await unchangedSide();
    console.log('PASS delete quota rollback/reload/tombstone/idempotency/no resurrection');
    // A failed external effect happens after local persistence and must leave the save intact.
    assert.equal(await page.evaluate(() => {
      failSync = true;
      try { run('add', { requestId: 'sync-failure', values }); } catch (error) { return error.message; }
    }), 'fixture external sync failed');
    await page.reload(); await boot();
    assert.equal(await page.evaluate(() => state.singleSchedules.length), 2);
    assert.equal(await page.evaluate(() => run('add', { requestId: 'sync-failure' }).unchanged), true);
    await unchangedSide();
    assert.deepEqual(errors, []);
    console.log('PASS external failure retains local save; isolated Chromium registry tests (D01 no published UI)');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
