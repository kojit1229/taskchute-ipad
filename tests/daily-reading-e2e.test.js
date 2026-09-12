const assert = require('node:assert/strict');
const { chromium, launchOptions, defaultContextOptions, startServer, randomPort } = require('./helpers');
(async () => {
  const server = startServer(randomPort()); let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext(defaultContextOptions()), page = await context.newPage();
    await page.route('**/fixture', route => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
    await page.route('https://**/*', route => route.abort());
    await page.clock.install({ time: new Date(2026, 8, 12, 10) });
    await page.goto(`http://localhost:${server.address().port}/fixture`);
    const results = await page.evaluate(async () => {
      const { createDailyReading } = await import('/src/features/daily-reading.js');
      let day = '2026-09-12', connection = 'fixture:1', shown = null, response = { ok: true, text: 'fixture text' }, pending;
      const calls = [], successes = [], png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6gAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
      const read = async (name, kind) => {
        calls.push(name);
        if (pending) { const wait = pending; pending = null; return wait; }
        if (name.endsWith('manifest.json')) return { ok: true, text: JSON.stringify({ 'now_vision.pdf': { files: ['page.png'] } }) };
        if (kind === 'blob') return { ok: true, blob: new Blob([png], { type: 'image/png' }) };
        return response;
      };
      const reader = createDailyReading({ document, today: () => day, addDays: d => d === '2026-09-12' ? '2026-09-11' : '2026-09-12',
        now: () => `${day}T10:00:00`, connection: () => connection, board: () => 'now_vision.pdf', readVision: read, readRaw: read,
        markdown: text => `<p>${text}</p>`, visible: req => req === shown,
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
      return { successes, imageShown, closed: closed?.displayed || false, changed: changedResult?.displayed || false,
        crossed: crossed?.request?.referenceDate, calls, failed: failed.displayed, stale, errors };
    });
    assert.deepEqual(results.successes, [true, true, true]); assert(results.imageShown);
    assert.equal(results.closed, false); assert.equal(results.changed, false);
    assert.equal(results.crossed, '2026-09-12'); assert(results.calls.includes('AIフィードバック_2026-09-12.md'));
    assert.equal(results.failed, false); assert.match(results.stale, /前回取得分/);
    assert.deepEqual(results.errors, [false, false, false, false]);
    console.log('PASS browser display, decoded image, close/connection cancellation, midnight refetch, stale/error handling');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
