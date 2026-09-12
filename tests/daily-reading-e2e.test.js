const assert = require('node:assert/strict');
const { chromium, launchOptions, defaultContextOptions, startServer, randomPort } = require('./helpers');
const { runDailyOperation } = require('../src/features/daily-operations.js');
const { commitCandidate } = require('../src/core/commit.js');
const { configureRecurrence, recurrenceMatchesDate, makeRecurrenceInstance } = require('../src/core/recurrence.js');
const DAY = '2026-09-12', AT = `${DAY}T10:00:00`;
configureRecurrence({ parseDate: s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }, nowDateTime: () => AT });
{
  const state = { settings: { dailyReadingRecordEnabled: false, dailyReadingRoutineIds: { affirmation: 'affirm', visionBoard: 'board' } },
    blocks: [], tasks: [], recurrences: ['affirm', 'board'].map(id => ({ id, category: 'ルーティン', kind: 'daily', streakSince: DAY })), habitStreaks: {}, weeklyCommitments: [] };
  let saves = 0, syncs = 0, fail = false;
  const deps = { state, commitCandidate, now: () => AT, today: () => DAY, readingCurrent: () => true,
    readingMatches: recurrenceMatchesDate, readingInstance: makeRecurrenceInstance,
    persist: () => { saves++; return !fail; }, scheduleSync: () => { syncs++; }, refreshActualReports: () => { throw Error('report is a later unit'); } };
  const input = { kind: 'affirmation', date: DAY, referenceDate: DAY, recordedAt: AT, displayed: true, routineIds: { ...state.settings.dailyReadingRoutineIds } };
  const run = () => runDailyOperation('daily-reading-record', input, deps);
  const empty = structuredClone(state); assert(run().discarded); assert.deepEqual(state, empty); assert.equal(saves, 0); assert.equal(syncs, 0);
  state.settings.dailyReadingRecordEnabled = true; fail = true; const original = structuredClone(state), blocks = state.blocks, habits = state.habitStreaks;
  assert.equal(run().ok, false); assert.deepEqual(state, original); assert.equal(state.blocks, blocks); assert.equal(state.habitStreaks, habits); assert.equal(syncs, 0);
  fail = false; assert(run().ok); assert.equal(saves, 2); assert.equal(syncs, 1);
  assert.equal(state.blocks[0].actualStartAt, AT); assert.equal(state.habitStreaks.affirm.logs[DAY].doneAt, AT);
  const saved = structuredClone(state); assert(run().unchanged); assert.deepEqual(state, saved); assert.equal(saves, 2);
  Object.assign(state, JSON.parse(JSON.stringify(saved))); assert(run().unchanged); assert.equal(saves, 2);
  // Existing weekly completion is part of the same persist; no post-save mutation is needed.
  state.blocks = []; state.habitStreaks = {}; state.weeklyCommitments = [{ id: `wci_${DAY}_rec_affirm_${DAY}`, recordType: 'item' }];
  deps.weekRange = () => ({ weekStart: DAY }); const beforeCount = saves;
  assert(run().ok); assert.equal(saves, beforeCount + 1); assert.equal(state.weeklyCommitments[0].completedAt, AT);
  console.log('PASS registry: flag off=0; failure rolls back Block/habit; same success retry; replay/reload=0; weekly single save');
}
(async () => {
  const server = startServer(randomPort()); let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext(defaultContextOptions()), page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.route('**/fixture', route => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
    await page.route('https://**/*', route => route.abort());
    await page.clock.install({ time: new Date(2026, 8, 12, 10) });
    await page.goto(`http://localhost:${server.address().port}/fixture`);
    const results = await page.evaluate(async () => {
      const { createDailyReading } = await import('/src/features/daily-reading.js');
      let day = '2026-09-12', connection = 'fixture:1', shown = null, response = { ok: true, text: 'fixture text' }, pending;
      let brokenImage = false;
      const calls = [], successes = [], records = [], png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6gAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
      const read = async (name, kind) => {
        calls.push(name);
        if (pending) { const wait = pending; pending = null; return wait; }
        if (name.endsWith('manifest.json')) return { ok: true, text: JSON.stringify({ 'now_vision.pdf': { files: ['page.png'] } }) };
        if (kind === 'blob') return { ok: true, blob: new Blob([brokenImage ? 'bad image' : png], { type: 'image/png' }) };
        return response;
      };
      const reader = createDailyReading({ document, today: () => day, addDays: d => d === '2026-09-12' ? '2026-09-11' : '2026-09-12',
        now: () => `${day}T10:00:00`, connection: () => connection, board: () => 'now_vision.pdf', readVision: read, readRaw: read,
        markdown: text => `<p>${text}</p>`, visible: req => req === shown,
        record: input => { records.push({ kind: input.kind, at: input.recordedAt }); return { ok: true, message: '記録済み(保存は無効)' }; },
        show: (req, html) => { shown = req; document.querySelector('main').innerHTML = html; } });
      for (const kind of ['affirmation', 'feedback', 'visionBoard']) successes.push(Boolean((await reader.open(kind))?.displayed));
      const image = document.querySelector('img'), imageShown = Boolean(image?.naturalWidth && image.isConnected);
      let resolve;
      pending = new Promise(r => { resolve = r; }); const late = reader.open('feedback'); reader.close();
      resolve({ ok: true, text: 'late closed' }); const closed = await late;
      pending = new Promise(r => { resolve = r; }); const changed = reader.open('feedback'); connection = 'fixture:2';
      resolve({ ok: true, text: 'late connection' }); const changedResult = await changed;
      pending = new Promise(r => { resolve = r; }); const crossing = reader.open('feedback'); day = '2026-09-13';
      resolve({ ok: true, text: 'yesterday before crossing' }); const crossed = await crossing;
      response = { ok: false, status: 500 }; const failed = await reader.open('feedback');
      const stale = document.querySelector('[data-reading-status]').textContent;
      const errors = [];
      for (const value of [{ ok: false, status: 0 }, { ok: false, status: 401 }, { ok: false, status: 404 }, { ok: true, text: '' }]) {
        response = value; errors.push((await reader.open('affirmation')).displayed);
      }
      const beforeBroken = records.length; brokenImage = true; const broken = await reader.open('visionBoard');
      return { successes, imageShown, closed: closed?.displayed || false, changed: changedResult?.displayed || false,
        crossed: crossed?.request?.referenceDate, calls, failed: failed.displayed, stale, errors,
        broken: broken.displayed, brokenRecorded: records.length - beforeBroken, records };
    });
    assert.deepEqual(results.successes, [true, true, true]); assert(results.imageShown);
    assert.equal(results.closed, false); assert.equal(results.changed, false);
    assert.equal(results.crossed, '2026-09-12'); assert(results.calls.includes('AIフィードバック_2026-09-12.md'));
    assert.equal(results.failed, false); assert.match(results.stale, /前回取得分/);
    assert.deepEqual(results.errors, [false, false, false, false]);
    assert.equal(results.broken, false); assert.equal(results.brokenRecorded, 0); assert.equal(results.records.length, 4);
    console.log('PASS browser display, decoded image, close/connection cancellation, midnight refetch, stale/error handling');
    await page.route('https://api.github.com/**', route => route.fulfill({ status: route.request().url().includes('Daily_Affirmation.md') ? 200 : 404,
      contentType: 'text/plain', body: route.request().url().includes('Daily_Affirmation.md') ? '# Fixture affirmation' : '' }));
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.evaluate(() => {
      const key = 'taskchute-journal-pwa-state-v1', state = JSON.parse(localStorage.getItem(key));
      state.currentView = 'today'; state.blocks = []; state.tasks = []; state.recurrences = []; state.weeklyCommitments = [];
      state.settings.github = { token: 'fixture-token', owner: 'fixture', repo: 'fixture', dataOwner: 'fixture', dataRepo: 'fixture' };
      localStorage.setItem(key, JSON.stringify(state));
    });
    await page.reload();
    await page.locator('[data-action="daily-reading-open"][data-reading-kind="affirmation"]').click();
    await page.waitForFunction(() => document.querySelector('[data-reading-status]')?.textContent.includes('対応設定'));
    assert.match(await page.locator('[data-reading-body]').innerText(), /Fixture affirmation/);
    await page.locator('[data-action="modal-close"]').click();
    assert.equal(await page.locator('[data-reading-body]').count(), 0);
    console.log('PASS real app: delegated top button, limited affirmation transport, display, unconfigured read-only, close');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
