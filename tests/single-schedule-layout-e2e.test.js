const strictAssert = require('node:assert/strict');
let failures = 0;
// Keep every ordered assertion, report all mismatches, and continue independent UI checks.
const assert = Object.fromEntries(['equal', 'deepEqual', 'ok', 'match'].map(method => [method, (...args) => {
  try { strictAssert[method](...args); } catch (error) { failures++; console.error(error); }
}]));
const { plannedAvailability } = require('../src/features/daily-gap-placement.js');
const { scheduleDisplay, scheduleTimelineRows } = require('../src/features/single-schedule-view.js');
const { chromium, launchOptions, defaultContextOptions, startServer, randomPort, STATE_KEY, passGithubGate } = require('./helpers');
const DAY = '2026-09-12';
const record = (id, start, end) => ({ id, date: start.slice(0, 10), title: id, plannedStartAt: start, plannedEndAt: end,
  completed: false, deleted: false, note: 'keep', createdAt: '2026-09-10T10:00:00', updatedAt: '2026-09-10T10:00:00' });
const rows = [record('previous', '2026-09-11T23:00:00', DAY + 'T05:00:00'),
  record('older', '2026-09-10T23:00:00', DAY + 'T05:00:00'),
  record('next', DAY + 'T23:00:00', '2026-09-13T01:00:00'),
  record('early', DAY + 'T02:00:00', DAY + 'T02:10:00'), { id: 'bad', title: 'preserve invalid original', date: '2026-02-30' }];
const crossBlock = { ...record('old-block', '2026-09-10T23:00:00', DAY + 'T05:00:00'), category: '仕事', taskId: '' };
for (const completed of [false, true]) {
  const model = { blocks: [crossBlock], singleSchedules: rows.map(row => ({ ...row, completed })) }, before = structuredClone(model);
  const availability = plannedAvailability(model, DAY);
  assert.equal(availability.error, ''); assert.deepEqual(availability.occupied, [[240, 300], [1380, 1440]]);
  assert.deepEqual(availability.gaps, [[300, 1380]]); assert.deepEqual(model, before);
  assert.equal(scheduleDisplay(model, DAY).warnings.reduce((sum, row) => sum + row.count, 0), 2);
  assert.deepEqual(scheduleTimelineRows(model, DAY).map(row => [row.id, row.timelineRange]), [['previous', [240, 300]], ['next', [1380, 1440]]]);
}
for (const value of [undefined, null, {}, 'failed']) {
  assert.ok(plannedAvailability({ blocks: [], singleSchedules: value }, DAY).error);
  assert.ok(scheduleDisplay({ singleSchedules: value }, DAY).error);
}
for (const block of [null, { id: 'end-only', plannedEndAt: DAY + 'T09:00' },
  { ...crossBlock, plannedEndAt: 'bad' }, { ...crossBlock, plannedStartAt: 'bad' }])
  assert.ok(plannedAvailability({ blocks: [block], singleSchedules: [] }, DAY).error);
console.log(`CHECKED multi-day collection, clipping, completion occupancy, invalid containers and original preservation; failures=${failures}`);
(async () => {
  let server, browser;
  try {
    server = startServer(randomPort()); browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ ...defaultContextOptions(), viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      if (new URL(route.request().url()).hostname !== 'localhost') return route.abort();
      if (!route.request().url().endsWith('/app.js')) return route.continue();
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + '\nwindow.layoutOperation = (action, input) => { const result = runDailyOperation("daily-schedule-" + action, input, dailyOperationDeps); render(); return result; };' });
    });
    await page.clock.setFixedTime(new Date(2026, 8, 12, 12));
    await page.goto('http://localhost:' + server.address().port + '/'); await passGithubGate(page);
    await page.evaluate(({ key, date, rows, crossBlock }) => {
      const state = JSON.parse(localStorage.getItem(key));
      Object.assign(state, { currentView: 'today', selectedDate: date, singleSchedules: rows, blocks: [crossBlock], recurrences: [], tasks: [], projects: [] });
      Object.assign(state.settings, { lastOpenedDate: date, autoSync: false }); state.settings.github.autoSave = false;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, date: DAY, rows, crossBlock });
    await page.reload(); await page.locator('[data-work-list="today"] .today-single-schedules').waitFor();
    await page.evaluate(async key => { const { state } = await import('/src/state/store.js'); localStorage.setItem(key, JSON.stringify(state)); }, STATE_KEY);
    await page.reload(); await page.locator('[data-work-list="today"] .today-single-schedules').waitFor();
    const dayList = page.locator('[data-work-list="today"] .today-single-schedules');
    assert.match(await dayList.innerText(), /不正な単発予定2件を表示から除外/);
    assert.equal(await dayList.locator('[data-schedule-id="older"]').count(), 0);
    assert.equal(await dayList.locator('[data-schedule-id]').count(), 3);
    assert.match(await dayList.locator('[data-schedule-id="early"]').innerText(), /時間軸外/);
    assert.equal(await page.locator('[data-action="daily-schedule-add"]').count(), 0);
    const sideBefore = await page.evaluate(async () => { const { state } = await import('/src/state/store.js'); return JSON.stringify([state.blocks, state.tasks]); });
    await dayList.locator('[data-schedule-id="early"] [data-action="schedule-view-details"]').click();
    assert.match(await page.locator('.single-schedule-detail').innerText(), /02:00:00/);
    await page.locator('.single-schedule-detail .modal-close').click();
    await page.locator('.nav-button[data-view="exec"]').click();
    await page.locator('.timeline[data-date]').waitFor();
    const geometry = await page.locator('.timeline [data-schedule-id]').evaluateAll(nodes => nodes.map(el =>
      [el.dataset.scheduleId, parseFloat(el.style.top), el.getBoundingClientRect().height]).sort());
    assert.deepEqual(geometry, [['next', 1140, 60], ['previous', 0, 60]]);
    assert.equal(await page.locator('.timeline-card[data-id="old-block"]').evaluate(el => parseFloat(el.style.top)), 0);
    assert.match(await page.locator('.timeline-availability').innerText(), /空き 1080分/);
    await page.locator('.timeline-schedule-list summary').click();
    assert.match(await page.locator('.timeline-schedule-list').innerText(), /時間軸外/);
    const card = page.locator('.timeline [data-schedule-id="next"]');
    await card.locator('[data-action="schedule-view-complete"]').click();
    assert.equal(await card.getAttribute('data-completed'), 'true');
    assert.match(await page.locator('.timeline-availability').innerText(), /空き 1080分/);
    await card.locator('[data-action="schedule-view-complete"]').click();
    assert.equal(await card.getAttribute('data-completed'), 'false');
    const changed = await page.evaluate(async date => {
      const { state } = await import('/src/state/store.js'); const { contentKey } = await import('/src/core/single-schedule-merge.js');
      const before = state.singleSchedules.find(row => row.id === 'early');
      return window.layoutOperation('edit', { kind: 'schedule', id: 'early', requestId: 'layout-edit', baseFingerprint: contentKey(before),
        values: { title: 'early-edited', date, start: '02:00', end: '02:10', endNextDay: false, note: 'retained detail' } });
    }, DAY);
    assert.equal(changed.ok, true);
    const deleted = await page.evaluate(async () => {
      const { state } = await import('/src/state/store.js'); const { contentKey } = await import('/src/core/single-schedule-merge.js');
      return window.layoutOperation('delete', { kind: 'schedule', id: 'next', requestId: 'layout-delete', confirmed: true,
        baseFingerprint: contentKey(state.singleSchedules.find(row => row.id === 'next')) });
    });
    assert.equal(deleted.ok, true); assert.match(await page.locator('.timeline-availability').innerText(), /空き 1140分/);
    await page.reload(); await page.locator('#app').waitFor();
    const saved = await page.evaluate(async () => { const { state } = await import('/src/state/store.js'); return { rows: state.singleSchedules, side: JSON.stringify([state.blocks, state.tasks]) }; });
    assert.equal(saved.side, sideBefore);
    assert.deepEqual(saved.rows.find(row => row.id === 'older'), rows[1]);
    assert.deepEqual(saved.rows.find(row => row.id === 'bad'), rows.at(-1));
    assert.equal(saved.rows.find(row => row.id === 'early').plannedEndAt, DAY + 'T02:10:00');
    assert.equal(saved.rows.find(row => row.id === 'next').deleted, true);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(`CHECKED today/timeline/detail IDs; early direct edit, complete/uncomplete/delete, reload and no Task/Block conversion; failures=${failures}`);
    if (failures) process.exitCode = 1;
  } finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
