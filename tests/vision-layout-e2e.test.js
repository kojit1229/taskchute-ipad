// Order 124 / R3-02: synthetic overview and existing edit/board paths, five widths.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { chromium, launchOptions, startServer, randomPort, STATE_KEY,
  setViewportAndWaitForStableLayout } = require('./helpers');
const fixture = { schemaVersion: 1, themes: ['A', 'B', 'C'].map(id => ({ id,
  title: `Synthetic ${id}`, core: `Core ${id}`, question: `Question ${id}`,
  detailMarkdown: `Full guide ${id}`, imageFile: `vision-overview/${id.toLowerCase()}.png` })),
  affirmationMarkdown: 'Complete synthetic affirmation' };
(async () => {
  const port = randomPort(), server = startServer(port); let browser;
  try {
    if (!server.listening) await once(server, 'listening');
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ serviceWorkers: 'block', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    await page.clock.install({ time: new Date(2026, 8, 11, 12) });
    const puts = [], errors = []; let heldPut;
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.hostname === 'localhost') return route.continue();
      if (url.hostname !== 'api.github.com') return route.abort();
      const vision = url.pathname.endsWith('/content/Vision.md');
      if (req.method() === 'PUT') {
        assert.ok(vision && url.pathname.includes('/synthetic-layout/'));
        puts.push(Buffer.from(req.postDataJSON().content, 'base64').toString('utf8'));
        heldPut = route; return;
      }
      if (vision) return route.fulfill({ status: 200, body: String(req.headers().accept).includes('raw')
        ? '# Existing full vision\n\nOriginal body' : JSON.stringify({ sha: 'synthetic-sha' }) });
      if (url.pathname.endsWith('/content/vision-overview.json')) return route.fulfill({ status: 200, body: JSON.stringify(fixture) });
      if (url.pathname.endsWith('/content/Daily_Affirmation.md')) return route.fulfill({ status: 200, body: 'Existing affirmation' });
      return route.fulfill({ status: 404, body: '{}' });
    });
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(key => !!localStorage.getItem(key), STATE_KEY);
    await page.evaluate(key => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = 'vision'; state.settings.visionSection = 'vision'; state.settings.autoSync = false;
      Object.assign(state.settings.github, { token: 'synthetic', dataOwner: 'synthetic-layout', dataRepo: 'fixture', autoSave: false });
      localStorage.setItem(key, JSON.stringify(state));
    }, STATE_KEY);
    await page.reload();
    await page.locator('[data-vision-theme="C"]').waitFor();
    assert.deepEqual(await page.locator('[data-vision-theme]').evaluateAll(rows => rows.map(row => row.dataset.visionTheme)), ['A', 'B', 'C']);
    assert.equal(await page.locator('.vision-image-missing').count(), 3);
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await setViewportAndWaitForStableLayout(page, { width, height: 1100 }, '.vision-sections button');
      const sizes = await page.locator('.vision-layout').evaluate(root => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        buttons: [...root.querySelectorAll('button, summary')].filter(el => el.getClientRects().length)
          .map(el => ({ text: el.textContent.trim(), height: el.getBoundingClientRect().height }))
      }));
      assert.equal(sizes.overflow, false, `horizontal overflow at ${width}`);
      assert.ok(sizes.buttons.every(button => button.height >= 44), JSON.stringify({ width, ...sizes }));
      console.log('PASS layout measurements', JSON.stringify({ width, ...sizes }));
    }
    await page.locator('[data-vision-theme="A"] summary').click();
    assert.equal(await page.getByText('Full guide A', { exact: true }).isVisible(), true);
    await page.locator('[data-action="vision-section"][data-section="affirmation"]').click();
    assert.equal(await page.getByText(fixture.affirmationMarkdown, { exact: true }).isVisible(), true);
    await page.locator('[data-action="vision-section"][data-section="board"]').click();
    assert.equal(await page.locator('[data-action="vision-board-tab"]').count(), 3);
    await page.locator('[data-action="vision-board-tab"]').nth(1).click();
    assert.equal(await page.locator('[data-action="vision-board-tab"].active').count(), 1);
    await page.locator('[data-action="vision-section"][data-section="vision"]').click();
    await page.locator('.vision-legacy-content > summary').click();
    assert.equal(await page.getByText('Original body', { exact: true }).isVisible(), true);
    await page.locator('[data-action="vision-edit-open"]').click();
    const editor = page.locator('[data-vision-edit-textarea]');
    await editor.fill('Synthetic submitted text');
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await setViewportAndWaitForStableLayout(page, { width, height: 1100 }, '[data-vision-edit-textarea]');
      const font = await editor.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      assert.ok(font >= 16, `input font at ${width}: ${font}`);
      console.log('PASS input measurement', JSON.stringify({ width, font }));
    }
    await editor.evaluate(el => { el.focus(); el.setSelectionRange(2, 7, 'backward'); window.layoutEditor = el; });
    await page.clock.runFor(61000);
    assert.deepEqual(await editor.evaluate(el => ({ same: el === window.layoutEditor, start: el.selectionStart,
      end: el.selectionEnd, direction: el.selectionDirection })), { same: true, start: 2, end: 7, direction: 'backward' });
    const putRequest = page.waitForRequest(req => req.method() === 'PUT');
    await page.locator('[data-action="vision-edit-save"]').click(); await putRequest;
    await editor.fill('Synthetic appended during send');
    assert.ok(heldPut, 'PUT held before appending');
    await heldPut.fulfill({ status: 200, body: JSON.stringify({ content: { sha: 'saved-fixture' } }) });
    await page.locator('[data-action="vision-edit-save"]:not([disabled])').waitFor();
    assert.equal(await editor.inputValue(), 'Synthetic appended during send');
    assert.deepEqual(puts, ['Synthetic submitted text']);
    await page.evaluate(async () => { const { state } = await import('/src/state/store.js'); state.settings.github.dataOwner = 'synthetic-other'; });
    await page.locator('[data-action="nav"][data-view="vision"]').first().click();
    assert.equal(await editor.inputValue(), 'Synthetic appended during send');
    assert.equal(await page.locator('[data-action="vision-edit-save"]').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('PASS vision layout: full text, affirmation, old board, input selection, in-flight append, connection change');
    await context.close();
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
