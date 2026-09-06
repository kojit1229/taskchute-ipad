// Synthetic real-app integration. No external requests; run only after browser ownership is granted.
const assert = require('node:assert/strict');
const { chromium, launchOptions, startServer, randomPort, STATE_KEY } = require('./helpers');
const DATE = '2026-01-05';
const MAPS = ['journals', 'reports', 'feedback'];
const ARCHIVE = Object.fromEntries(MAPS.map(key => [key, { [DATE]: `synthetic ${key}` }]));
(async () => {
  const port = randomPort(), server = startServer(port);
  let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const seed = await browser.newContext({ serviceWorkers: 'block' });
    const seedPage = await seed.newPage();
    await seedPage.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    await seedPage.goto(`http://localhost:${port}/`);
    await seedPage.waitForFunction(key => !!localStorage.getItem(key), STATE_KEY);
    const base = await seedPage.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    await seed.close();
    for (const kind of ['readonly', 'equal', 'different']) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const page = await context.newPage(); page.setDefaultTimeout(12000);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        const state = JSON.parse(JSON.stringify(base));
        Object.assign(state, JSON.parse(JSON.stringify(ARCHIVE)));
        state.selectedDate = DATE; state.archivedDates = [DATE]; state.view = 'journal';
        state.settings.autoSync = false;
        Object.assign(state.settings.github, { token: 'synthetic', dataOwner: 'synthetic', dataRepo: 'fixture', autoSave: false });
        if (kind !== 'equal') state.journals[DATE] += ' retained addition';
        const remote = JSON.parse(JSON.stringify(state));
        remote.journals[DATE] = ARCHIVE.journals[DATE];
        let enabled = false, archiveGets = 0, writes = 0;
        await page.route('**/*', route => {
          const req = route.request(), url = new URL(req.url());
          if (url.hostname === 'localhost') return route.continue();
          if (url.hostname !== 'api.github.com') return route.abort();
          if (req.method() !== 'GET') { writes++; return route.fulfill({ status: 503, body: '{}' }); }
          if (!enabled) return route.fulfill({ status: 404, body: '{}' });
          const archive = url.pathname.includes('archive-2026.json');
          if (!archive && !url.pathname.endsWith('app-state.json')) return route.fulfill({ status: 404, body: '{}' });
          if (archive) archiveGets++;
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            sha: 'synthetic-sha', encoding: 'base64', content: Buffer.from(JSON.stringify(archive ? ARCHIVE : remote)).toString('base64')
          }) });
        });
        await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: STATE_KEY, value: state });
        await page.goto(`http://localhost:${port}/`);
        await page.locator('[data-action="nav"][data-view="journal"]').first().click();
        // Selected-date startup policy may choose today; select fixture date through the live store before normal nav render.
        await page.evaluate(async date => { const store = await import('/src/state/store.js'); store.state.selectedDate = date; }, DATE);
        await page.locator('[data-action="nav"][data-view="journal"]').first().click();
        const textarea = page.locator(`[data-journal-date="${DATE}"]`);
        assert.equal(await textarea.getAttribute('readonly') !== null, true);
        assert.equal(await textarea.inputValue(), state.journals[DATE]);
        assert.ok((await page.locator('body').innerText()).includes('アーカイブ'));
        if (kind === 'readonly') {
          await page.locator('[data-journal-section="journal"]').evaluate(node => { node.open = true; });
          await page.locator('[data-action="generate-report"]').click();
          assert.ok((await page.locator('body').innerText()).includes('アーカイブも検索'));
          await page.locator('[data-journal-section="morning"]').evaluate(node => { node.open = true; });
          await page.locator('[data-action="set-morning"][data-value="3"]').click();
          const saved = await page.evaluate(async date => { const { state } = await import('/src/state/store.js'); return {
            energy: state.settings.morningEnergyLog[date], morning: state.condition.logs[date].morningRecordedAt,
            maps: Object.fromEntries(['journals', 'reports', 'feedback'].map(key => [key, state[key][date]]))
          }; }, DATE);
          assert.equal(saved.energy, 3); assert.ok(saved.morning);
          for (const key of MAPS) assert.equal(saved.maps[key], state[key][DATE]);
          // Tower always renders today; seed its independent archived fixture without writing through the UI.
          await page.evaluate(async date => { const { state } = await import('/src/state/store.js'); const now = new Date();
            const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            state.archivedDates.push(today);
            for (const key of ['journals', 'reports', 'feedback']) state[key][today] = state[key][date];
          }, DATE);
          await page.locator('[data-action="nav"][data-view="today"]').first().click();
          assert.equal(await page.locator('#towerJournalFree').getAttribute('readonly') !== null, true);
          assert.equal(await page.locator('[data-action="save-tower-journal"]').isDisabled(), true);
        } else {
          enabled = true;
          await page.evaluate(async () => { const store = await import('/src/state/store.js'); store.state.settings.autoSync = true;
            const sync = await import('/src/sync/github.js'); await sync.runAutoSyncPull(); });
          assert.ok(archiveGets > 0);
          const actual = await page.evaluate(async date => { const { state } = await import('/src/state/store.js');
            return Object.fromEntries(['journals', 'reports', 'feedback'].map(key => [key, state[key][date]])); }, DATE);
          if (kind === 'equal') for (const key of MAPS) assert.equal(actual[key], undefined);
          else {
            for (const key of MAPS) assert.equal(actual[key], state[key][DATE]);
            await page.locator('.sync-error-banner').waitFor({ state: 'visible' });
            assert.ok((await page.locator('.sync-error-banner').innerText()).includes('同期できませんでした'));
            await page.locator('.sync-error-banner [data-action="nav"][data-view="settings"]').click();
            await page.locator('[data-sync-error-detail-slot]').waitFor({ state: 'visible' });
            const detail = await page.locator('[data-sync-error-detail-slot]').innerText();
            assert.ok(detail.includes('アーカイブと一致しない記録'));
            assert.ok(detail.includes('端末の追記は保持'));
            const persisted = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
            for (const key of MAPS) assert.equal(persisted[key][DATE], state[key][DATE]);
          }
        }
        assert.equal(writes, 0); assert.deepEqual(errors, []);
        console.log('PASS real app archive/' + kind);
      } finally { await context.close(); }
    }
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
