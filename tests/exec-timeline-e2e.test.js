const assert = require('node:assert/strict');
const { chromium, launchOptions, defaultContextOptions, startServer, randomPort, STATE_KEY, passGithubGate } = require('./helpers');
const DAY = '2026-09-12';
(async () => {
  let server, browser;
  try {
    server = startServer(randomPort()); browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ ...defaultContextOptions(), viewport: { width: 1280, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    await page.clock.setFixedTime(new Date(2026, 8, 12, 10, 30));
    await page.goto('http://localhost:' + server.address().port + '/'); await passGithubGate(page);
    async function seed(blocks) {
      await page.evaluate(({ key, date, blocks }) => {
        const state = JSON.parse(localStorage.getItem(key));
        Object.assign(state, { currentView: 'exec', selectedDate: date, timelineMode: 'planned', timelineZoom: 1,
          blocks, tasks: [], projects: [], recurrences: [], singleSchedules: [] });
        Object.assign(state.settings, { lastOpenedDate: date, autoSync: false, timelineCategoryFilter: '' });
        state.settings.github.autoSave = false;
        localStorage.setItem(key, JSON.stringify(state));
      }, { key: STATE_KEY, date: DAY, blocks });
      await page.reload(); await page.locator('.timeline[data-date]').waitFor();
    }
    const block = (id, start, end, extra = {}) => ({ id, title: id, date: DAY, category: '仕事', taskId: '',
      plannedStartAt: `${DAY}T${start}`, plannedEndAt: `${DAY}T${end}`, deleted: false, completed: false, ...extra });
    await seed([]);
    assert.match(await page.locator('.timeline-availability').innerText(), /空き 1200分/);
    assert.equal(await page.locator('.timeline-gap-list button').count(), 1);
    assert.equal(await page.locator('.time-row[data-minute="1440"]').getAttribute('data-action'), null);
    await seed([block('done', '09:00', '10:00', { completed: true }), block('overlap', '09:30', '11:00'), block('adjacent', '11:00', '12:00')]);
    assert.match(await page.locator('.timeline-availability').innerText(), /空き 1020分/);
    assert.match(await page.locator('[role="status"]').filter({ hasText: '計画の重複' }).innerText(), /1件/);
    for (const zoom of [1, 2, 4]) {
      await page.locator(`[data-action="tl-zoom"][data-zoom="${zoom}"]`).click();
      const values = await page.evaluate(() => {
        const axis = document.querySelector('.timeline[data-date]'), first = axis.querySelector('.timeline-card[data-id="done"]');
        return { height: parseFloat(axis.style.minHeight), top: parseFloat(first.style.top), duration: first.getBoundingClientRect().height,
          first: axis.querySelector('.time-row').textContent.trim(), terminal: axis.querySelector('[data-minute="1440"]').style.height };
      });
      assert.deepEqual(values, { height: 1200 * zoom, top: 300 * zoom, duration: 60 * zoom, first: '04:00', terminal: '0px' });
    }
    console.log('PASS 4–24 axis, 1200/1020 free minutes, half-open overlap, completed position and exact zoom scale');
    await page.locator('.tl-zoom-controls [data-action="timeline-jump"][data-where="all"]').click();
    assert(await page.locator('.time-row[data-minute="240"]').evaluate(el => Math.abs(el.getBoundingClientRect().top) <= 2));
    await page.locator('[data-action="timeline-jump"][data-where="list"]').click();
    await page.locator('[data-action="timeline-jump"][data-where="now"]').click();
    assert(await page.locator('.now-line').evaluate(el => { const y = el.getBoundingClientRect().top; return y >= 0 && y <= innerHeight; }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => !document.querySelector('.exec-two-pane'));
    assert(await page.locator('[data-work-list="exec"]').isVisible());
    assert(await page.locator('.timeline').isVisible());
    const positions = await page.evaluate(() => ({ timeline: document.querySelector('.timeline-tower').getBoundingClientRect().top,
      list: document.querySelector('[data-work-list="exec"]').getBoundingClientRect().top }));
    assert(positions.timeline < positions.list);
    console.log('PASS explicit current/all-day/list navigation and narrow screen retains both views');
    await seed([block('late', '23:45', '23:59'), block('running', '09:00', '09:30', { actualStartAt: `${DAY}T09:00` })]);
    assert.match(await page.locator('.timeline-gap-list').innerText(), /1分・配置対象外/);
    assert.equal(await page.locator('.timeline-card[data-id="late"]').evaluate(el => el.getBoundingClientRect().height), 14);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).blocks, STATE_KEY);
    await page.locator('.exec-mode-segmented [data-action="exec-mode-toggle"][data-mode="actual"]').click();
    assert.equal(await page.locator('.time-row').first().innerText(), '04:00');
    await page.clock.setFixedTime(new Date(2026, 8, 12, 11, 30));
    await page.evaluate(async () => (await import('/src/features/timeline.js')).updateTimelineClock());
    assert.equal(await page.locator('.timeline-card[data-id="running"]').evaluate(el => parseFloat(el.style.height)), 150);
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).blocks, STATE_KEY), saved);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS legacy 23:59 stays 14 minutes; clock updates actual height without saving');
  } finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
