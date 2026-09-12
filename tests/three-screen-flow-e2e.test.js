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
      await route.fulfill({ response, body: await response.text() + '\nwindow.sl2bRun=(name,input)=>{const r=runDailyOperation(name,input,dailyOperationDeps);render();return {ok:r.ok,status:r.status,message:r.message};};' });
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
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
