// S5-01: timeline placement, Task/Block execution, daily report and localStorage reload across three screens.
const assert = require('node:assert/strict');
const { chromium, launchOptions, defaultContextOptions, startServer, randomPort, STATE_KEY, passGithubGate, fixedClock } = require('./helpers');
const wall = new Date(), now = fixedClock(new Date(wall.getFullYear(), wall.getMonth(), wall.getDate(), 10).getTime());
const instant = new Date(now()), date = [instant.getFullYear(), String(instant.getMonth() + 1).padStart(2, '0'), String(instant.getDate()).padStart(2, '0')].join('-');
const additionalChecks = [];
(async () => {
  const server = startServer(randomPort()); let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ ...defaultContextOptions(), reducedMotion: 'reduce', serviceWorkers: 'block', viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'localhost') return route.abort();
      if (/personal-data/.test(url.pathname)) return route.fulfill({ status: 404, body: 'fixture only' });
      if (url.pathname !== '/app.js') return route.continue();
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text()
        + '\nwindow.sl2bRun=(name,input)=>{const r=runDailyOperation(name,input,dailyOperationDeps);render();return {ok:r.ok,status:r.status,message:r.message};};'
        + '\nwindow.sl2bDraft={set:d=>{_scheduleDraft=capturePlannedDraft(state,d);_draftUndo={marker:"keep"};render();},confirm:()=>confirmScheduleDraft(),get:()=>({blocks:state.blocks,draft:_scheduleDraft,undo:_draftUndo,journals:state.journals})};' });
    });
    await page.clock.install({ time: instant });
    await page.clock.setFixedTime(instant);
    await page.goto('http://localhost:' + server.address().port + '/'); await passGithubGate(page);
    await page.evaluate(({ key, date }) => {
      const state = JSON.parse(localStorage.getItem(key));
      Object.assign(state, { currentView: 'wbs', selectedDate: date, blocks: [], recurrences: [], singleSchedules: [], declarations: [],
        projects: [{ id: 'flow-project', title: '架空Project', status: 'active', kind: 'normal' }],
        tasks: ['a', 'b'].map(id => ({ id: 'flow-' + id, title: '架空作業' + id, projectId: 'flow-project', status: 'todo', kind: 'task', category: '仕事' })),
        journals: { [date]: '通し操作でも保持する架空本文' }, reports: {} });
      Object.assign(state.settings, { lastOpenedDate: date, autoSync: false, dailyReadingRecordEnabled: false, focusTimerAuto: false });
      state.settings.github.autoSave = false;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, date });
    await page.reload();
    const nav = view => page.locator('[data-action="nav"][data-view="' + view + '"]:visible').first().click();
    const snapshot = () => page.evaluate(async date => {
      const { state } = await import('/src/state/store.js');
      const { captureReportInput } = await import('/src/features/feedback/report-input.js');
      const { deriveReportValues } = await import('/src/features/feedback/report-derived.js');
      return { blocks: structuredClone(state.blocks.filter(b => !b.deleted)), tasks: structuredClone(state.tasks), schedules: structuredClone(state.singleSchedules),
        actuals: captureReportInput(state, date, deriveReportValues).actuals, report: state.reports[date], journal: state.journals[date] };
    }, date);
    await page.locator('[data-action="wbs-select-project"][data-id="flow-project"]').click();
    for (const id of ['flow-a', 'flow-b']) {
      await page.locator('[data-work-list="wbs-tasks-flow-project"] [data-action="task-today"][data-id="' + id + '"]').click();
      await page.locator('.modal-footer [data-action="modal-save"]').click();
      await page.locator('#modalRoot.open').waitFor({ state: 'hidden' });
    }
    const added = await snapshot(); assert.equal(added.blocks.length, 2); assert.equal(added.actuals.length, 0);
    assert(added.blocks.every(b => b.date === date && !b.plannedStartAt && !b.plannedEndAt));
    const first = added.blocks.find(b => b.taskId === 'flow-a'), second = added.blocks.find(b => b.taskId === 'flow-b');
    await nav('today');
    for (const block of added.blocks) assert.equal(await page.locator('[data-work-list="today"] [data-work-key="block:' + block.id + '"]').count(), 1);
    await nav('exec');
    assert.match(await page.locator('.timeline-availability').innerText(), /空き 1200分/);
    const row = page.locator('[data-work-list="exec"] [data-work-key="block:' + first.id + '"]');
    await row.locator('[data-action="block-row-toggle"]').click();
    await row.locator('[data-action="edit-block"]').first().click();
    await page.locator('#modalRoot [data-modal-field="plannedStartAt"]').fill(date + 'T10:00');
    await page.locator('#modalRoot [data-modal-field="plannedEndAt"]').fill(date + 'T10:30');
    await page.locator('#modalRoot [data-action="modal-save"]').click();
    await page.locator('#modalRoot.open').waitFor({ state: 'hidden' });
    const planned = await snapshot();
    assert.equal(planned.blocks.length, 2); assert.equal(planned.actuals.length, 0);
    assert.equal(planned.blocks.find(b => b.id === second.id).plannedStartAt, '');
    assert.equal(planned.blocks.find(b => b.id === first.id).plannedStartAt, date + 'T10:00:00');
    assert.match(await page.locator('.timeline-availability').innerText(), /空き 1170分/);
    const run = (name, input) => page.evaluate(({ name, input }) => window.sl2bRun(name, input), { name, input });
    assert((await run('daily-block-start', { kind: 'block', id: first.id, declare: false })).ok);
    await page.clock.setFixedTime(new Date(instant.getTime() + 12 * 60000));
    assert((await run('daily-block-end', { kind: 'block', id: first.id, outcome: 'partial' })).ok);
    const ended = await snapshot(), actual = ended.actuals.find(b => b.blockId === first.id);
    assert.equal(actual.minutes, 12); assert.equal(actual.date, date);
    assert.equal(ended.blocks.find(b => b.id === first.id).completed, false);
    assert.equal(ended.tasks.find(t => t.id === first.taskId).status, 'doing');
    assert(ended.report.includes(first.id) && ended.report.includes(actual.actualStartAt) && ended.report.includes(actual.actualEndAt));
    await nav('today');
    assert.equal(await page.locator('#towerFlightLog [data-id="' + first.id + '"]').count(), 1);
    await nav('exec');
    await page.locator('.exec-mode-segmented [data-action="exec-mode-toggle"][data-mode="actual"]').click();
    assert.equal(await page.locator('[data-work-list="exec-actual"] [data-work-key="block:' + first.id + '"]').count(), 1);
    assert((await run('daily-plan-complete', { kind: 'block', id: first.id, desiredCompleted: true })).ok);
    const complete = await snapshot();
    assert.equal(complete.tasks.find(t => t.id === first.taskId).status, 'doing');
    assert.deepEqual(complete.actuals, ended.actuals);
    assert.equal(complete.journal, added.journal);
    await page.reload();
    const normalizedBlocks = complete.blocks.map(block => ({ copiedFromId: '', isMIT: false, source: '', ...block }));
    assert.deepEqual((await snapshot()).blocks, normalizedBlocks, 'reload only fills the three legacy defaults');
    assert((await run('daily-task-complete', { kind: 'task', id: first.taskId, desiredCompleted: true })).ok);
    const taskDone = await snapshot();
    assert.equal(taskDone.tasks.find(t => t.id === first.taskId).status, 'completed');
    assert.deepEqual(taskDone.blocks, normalizedBlocks, 'Task completion preserves every Block field');
    assert.equal(taskDone.actuals[0].actualStartAt, actual.actualStartAt);
    assert.equal(taskDone.actuals[0].actualEndAt, actual.actualEndAt);
    assert.equal(taskDone.actuals[0].taskCompleted, true);
    const scheduleInput = { kind: 'schedule', requestId: 'sl2b-private-add', values: { title: '架空の単発予定', note: '', date, start: '10:30', end: '11:00', endNextDay: false } };
    assert((await run('daily-schedule-add', scheduleInput)).ok);
    assert((await run('daily-schedule-add', scheduleInput)).ok);
    const scheduleState = await snapshot(); assert.equal(scheduleState.schedules.length, 1);
    assert.deepEqual(scheduleState.blocks, taskDone.blocks); assert.deepEqual(scheduleState.tasks, taskDone.tasks);
    const occupancy = () => page.evaluate(async date => {
      const { state } = await import('/src/state/store.js');
      const { plannedAvailability } = await import('/src/features/daily-gap-placement.js');
      const { contentKey } = await import('/src/core/single-schedule-merge.js');
      const value = plannedAvailability(state, date);
      return { occupied: value.occupied, gaps: value.gaps, fingerprint: contentKey(state.singleSchedules[0]) };
    }, date);
    const scheduled = await occupancy(); assert.deepEqual(scheduled.occupied, [[600, 660]]);
    const scheduleId = scheduleState.schedules[0].id;
    assert((await run('daily-schedule-complete', { kind: 'schedule', id: scheduleId, requestId: 'sl2b-private-complete', baseFingerprint: scheduled.fingerprint, desiredCompleted: true })).ok);
    const marked = await occupancy(); assert.deepEqual(marked.occupied, scheduled.occupied);
    assert((await run('daily-schedule-delete', { kind: 'schedule', id: scheduleId, requestId: 'sl2b-private-delete', baseFingerprint: marked.fingerprint, confirmed: true })).ok);
    assert.deepEqual((await occupancy()).occupied, [[600, 630]]);
    assert.equal(await page.locator('[data-action="daily-schedule-add"]').count(), 0, 'D01 remains private');
    assert.deepEqual(errors, []);
    console.log('PASS S5-01 through-flow: WBS two untimed IDs -> Today -> placement -> start -> partial end -> actual/report -> plan completion -> reload');
    for (const check of additionalChecks) await check(page, { date, instant, run, snapshot, nav });
    assert.deepEqual(errors, [], 'all additional browser scenarios remain free of uncaught errors');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

additionalChecks.push(async (page, { instant, nav }) => {
  const iso = value => [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
  for (const [label, month] of [['month-end', instant.getMonth()], ['year-end', 11]]) {
    const clock = new Date(instant.getFullYear(), month + 1, 0, 12), day = iso(clock);
    const next = new Date(clock.getFullYear(), clock.getMonth(), clock.getDate() + 1), tomorrow = iso(next);
    await page.clock.setFixedTime(clock);
    await page.evaluate(({ key, day }) => {
      const state = JSON.parse(localStorage.getItem(key));
      Object.assign(state, { currentView: 'exec', selectedDate: day, timelineMode: 'planned', timelineZoom: 1,
        blocks: [{ id: 'boundary-existing', title: '既存の架空枠', date: day, category: '仕事', plannedStartAt: '', plannedEndAt: '', actualStartAt: '', actualEndAt: '', completed: false, taskId: '' },
          { id: 'boundary-legacy', title: '旧23:59', date: day, category: '仕事', plannedStartAt: day + 'T23:45:00', plannedEndAt: day + 'T23:59:00', actualStartAt: '', actualEndAt: '', completed: false, taskId: '' }],
        projects: [{ id: 'boundary-project', title: '境界試験', kind: 'normal', status: 'active' }],
        tasks: [{ id: 'boundary-task', title: '新規の架空枠', projectId: 'boundary-project', status: 'todo', kind: 'task' }],
        recurrences: [], singleSchedules: [], declarations: [], journals: { [day]: '別の本文を保持' }, reports: {} });
      state.settings.lastOpenedDate = day; state.settings.autoSync = false; state.settings.github.autoSave = false;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, day });
    await page.reload(); await page.locator('.timeline[data-date]').waitFor();
    const business = () => page.evaluate(async day => {
      const { state } = await import('/src/state/store.js');
      return { blocks: structuredClone(state.blocks), tasks: structuredClone(state.tasks), journal: state.journals[day] };
    }, day);
    const before = await business();
    const row = page.locator('[data-work-key="block:boundary-existing"]');
    await row.locator('[data-action="block-row-toggle"]').click();
    await row.locator('[data-action="edit-block"]').first().click();
    const field = name => page.locator('#modalRoot [data-modal-field="' + name + '"]');
    await field('plannedStartAt').fill(day + 'T23:45');
    await field('plannedEndAt').fill(tomorrow + 'T00:00');
    await page.evaluate(key => {
      window.sl2bStorage = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, value) { if (k === key) throw new DOMException('fixture quota', 'QuotaExceededError'); return window.sl2bStorage.call(this, k, value); };
    }, STATE_KEY);
    await page.locator('#modalRoot [data-action="modal-save"]').click();
    assert.deepEqual(await business(), before, label + ': storage failure is atomic');
    assert.equal(await field('plannedStartAt').inputValue(), day + 'T23:45');
    assert.equal(await field('plannedEndAt').inputValue(), tomorrow + 'T00:00');
    await page.evaluate(() => { Storage.prototype.setItem = window.sl2bStorage; });
    await page.locator('#modalRoot [data-action="modal-save"]').click();
    await page.locator('#modalRoot.open').waitFor({ state: 'hidden' });
    // The WBS confirmation is intentionally untimed. Exercise the existing timed placement draft.
    await page.evaluate(async () => (await import('/src/features/placement.js')).openTaskPlacement('boundary-task', 'wish'));
    await field('duration').fill('15');
    await field('time').fill('23:45');
    await page.locator('#modalRoot [data-action="modal-save"]').click();
    await page.locator('#modalRoot [data-action="placement-edit"]').waitFor();
    await page.locator('#modalRoot [data-action="modal-close"]').last().click();
    await page.locator('#modalRoot.open').waitFor({ state: 'hidden' });
    await page.reload();
    const after = await business();
    assert.equal(after.blocks.length, 3); assert.equal(after.journal, before.journal);
    assert.deepEqual(after.blocks.find(b => b.id === 'boundary-legacy'), before.blocks.find(b => b.id === 'boundary-legacy'));
    const placed = after.blocks.filter(b => b.id !== 'boundary-legacy');
    for (const block of placed) {
      assert.equal(block.date, day);
      assert.equal(block.plannedStartAt.slice(0, 16), day + 'T23:45');
      assert.equal(block.plannedEndAt.slice(0, 16), tomorrow + 'T00:00');
      assert.equal(block.actualStartAt, ''); assert.equal(block.actualEndAt, '');
    }
    assert.equal(placed.filter(b => b.id === 'boundary-existing').length, 1);
    assert.equal(placed.filter(b => b.taskId === 'boundary-task').length, 1);
    await nav('exec');
    const geometry = await page.locator('.timeline-card').evaluateAll(nodes => nodes.map(el => ({ id: el.dataset.id, height: el.getBoundingClientRect().height })));
    for (const block of placed) assert.equal(geometry.find(row => row.id === block.id).height, 15);
    assert.equal(geometry.find(row => row.id === 'boundary-legacy').height, 14);
    console.log('S5-02_BOUNDARY ' + JSON.stringify({ label, day, tomorrow, ids: placed.map(b => b.id), geometry, timezone: await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone) }));
    for (const midnightKind of ['new', 'existing']) {
      await page.evaluate(async block => { (await import('/src/state/store.js')).state.blocks = [block]; }, before.blocks.find(b => b.id === 'boundary-existing'));
      await page.evaluate(({ day, midnightKind }) => window.sl2bDraft.set({ date: day, items: [
        { id: 'new-draft', title: '新規下書き', start: midnightKind === 'new' ? 1425 : 1380, minutes: 15 },
        { id: 'existing-draft', blockId: 'boundary-existing', title: '既存下書き', start: midnightKind === 'existing' ? 1425 : 1380, minutes: 15 }
      ] }), { day, midnightKind });
      const draftBefore = await page.evaluate(() => window.sl2bDraft.get());
      await page.evaluate(key => {
        window.sl2bStorage = Storage.prototype.setItem; window.sl2bFailDraft = true; window.sl2bDraftWrites = 0;
        Storage.prototype.setItem = function(k, value) {
          if (k === key) { window.sl2bDraftWrites++; if (window.sl2bFailDraft) throw new DOMException('fixture quota', 'QuotaExceededError'); }
          return window.sl2bStorage.call(this, k, value);
        };
      }, STATE_KEY);
      assert.equal(await page.evaluate(() => window.sl2bDraft.confirm()), false);
      const failed = await page.evaluate(() => window.sl2bDraft.get());
      const newCandidate = failed.draft.items.find(item => !item.blockId), candidateId = newCandidate.candidateId;
      assert(candidateId); assert.equal(newCandidate.candidateBlock.id, candidateId);
      assert.deepEqual(failed.blocks, draftBefore.blocks); assert.deepEqual(failed.undo, draftBefore.undo);
      assert.deepEqual(failed.journals, draftBefore.journals); assert.equal(failed.draft.date, day);
      assert.deepEqual(failed.draft.items.map(({ candidateId, candidateBlock, ...input }) => input), draftBefore.draft.items,
        'the first persist attempt only allocates retry identity; all entered fields and fingerprints remain intact');
      assert.equal(await page.evaluate(() => window.sl2bDraftWrites), 1);
      await page.evaluate(() => { window.sl2bFailDraft = false; });
      assert.equal(await page.evaluate(() => window.sl2bDraft.confirm()), true);
      assert.equal(await page.evaluate(() => window.sl2bDraftWrites), 2, 'one failed persist and one successful persist');
      await page.evaluate(() => { Storage.prototype.setItem = window.sl2bStorage; });
      const committed = await page.evaluate(() => window.sl2bDraft.get());
      assert.equal(committed.draft, null); assert.equal(committed.undo, null);
      assert.equal(committed.blocks.length, 2); assert.deepEqual(committed.journals, draftBefore.journals);
      const midnightId = midnightKind === 'new' ? candidateId : 'boundary-existing';
      await page.reload();
      const reloaded = await page.evaluate(() => window.sl2bDraft.get());
      assert.equal(reloaded.blocks.filter(block => block.id === candidateId).length, 1);
      const midnight = reloaded.blocks.find(block => block.id === midnightId);
      assert.equal(midnight.date, day); assert.equal(midnight.plannedStartAt.slice(0, 16), day + 'T23:45');
      assert.equal(midnight.plannedEndAt.slice(0, 16), tomorrow + 'T00:00');
      assert.equal(midnight.actualStartAt, ''); assert.equal(midnight.actualEndAt, '');
      const midnightCard = page.locator('.timeline-card[data-id="' + midnightId + '"]');
      await midnightCard.waitFor({ state: 'visible' });
      assert.equal(await midnightCard.evaluate(el => el.getBoundingClientRect().height), 15);
      console.log('S5-02_MIXED_DRAFT ' + JSON.stringify({ label, midnightKind, midnightId, candidateId, count: reloaded.blocks.length, writes: 2 }));
    }
  }
  console.log('PASS S5-02 month/year midnight, existing/new paths, storage failure, retained inputs, retry, reload and unchanged legacy 23:59');
});
