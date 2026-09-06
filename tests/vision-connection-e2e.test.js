// Synthetic live-app UI/transport coverage. Connection changes inject only fixture settings.
const assert = require('node:assert/strict');
const { chromium, launchOptions, startServer, randomPort, STATE_KEY } = require('./helpers');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function observed(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('fixture request not observed within 12s')), 12000); })]); }
  finally { clearTimeout(timer); }
}
function observeTerminal(page, request) {
  let timer, finish, failed;
  const promise = new Promise((resolve, reject) => {
    const clean = () => { clearTimeout(timer); page.off('requestfinished', finish); page.off('requestfailed', failed); };
    finish = req => { if (req === request) { clean(); resolve({type:'finished'}); } };
    failed = req => { if (req === request) { clean(); resolve({type:'failed',error:req.failure()?.errorText}); } };
    page.on('requestfinished', finish); page.on('requestfailed', failed);
    timer = setTimeout(() => { clean(); reject(new Error('old Vision request terminal not observed within 12s')); },12000);
  });
  // Attach rejection handling before navigation; preserve the original error for the later await.
  return promise.then(value => ({value}), error => ({error}));
}
const overview = { schemaVersion: 1, themes: ['A', 'B', 'C'].map(id => ({ id, title: `Synthetic ${id}`,
  core: 'Synthetic core', question: 'Synthetic question', detailMarkdown: 'Synthetic details', imageFile: `vision-overview/${id.toLowerCase()}.png` })),
  affirmationMarkdown: 'Synthetic affirmation' };
(async () => {
  const port = randomPort(), server = startServer(port); let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const seed = await browser.newContext({ serviceWorkers: 'block' });
    const seedPage = await seed.newPage();
    await seedPage.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    await seedPage.goto(`http://localhost:${port}/`);
    await seedPage.waitForFunction(key => !!localStorage.getItem(key), STATE_KEY);
    const base = await seedPage.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    await seed.close();
    for (const kind of ['delayed-get', 'draft-and-put', 'pending-images']) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const held = deferred(), imageSeen = deferred(), oldSeen = deferred(), putSeen = deferred(), putHeld = deferred();
      let released = false, heldVisionRequest;
      try {
        const page = await context.newPage(); page.setDefaultTimeout(12000);
        const errors = [], puts = []; page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.accept());
        const state = JSON.parse(JSON.stringify(base));
        state.currentView = 'vision'; state.settings.visionSection = 'vision'; state.settings.autoSync = false;
        Object.assign(state.settings.github, { token: 'synthetic', dataOwner: 'synthetic-a', dataRepo: 'fixture', branch: 'main', autoSave: false });
        await page.route('**/*', async route => {
          const req = route.request(), url = new URL(req.url());
          if (url.hostname === 'localhost') return route.continue();
          if (url.hostname !== 'api.github.com') return route.abort();
          const owner = url.pathname.includes('/synthetic-a/') ? 'A' : 'B';
          const vision = url.pathname.endsWith('/content/Vision.md');
          if (req.method() === 'PUT') {
            assert.ok(vision, 'only synthetic Vision PUT allowed');
            const body = req.postDataJSON(); puts.push({ owner, text: Buffer.from(body.content, 'base64').toString('utf8') });
            putSeen.resolve(); await putHeld.promise;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: 'saved-fixture' } }) });
          }
          if (req.method() !== 'GET') return route.abort();
          if (vision && !String(req.headers().accept).includes('raw')) return route.fulfill({ status: 200, body: JSON.stringify({ sha: 'fixture-old' }) });
          if (vision || url.pathname.endsWith('/content/Daily_Affirmation.md')) {
            if (kind === 'delayed-get' && owner === 'A' && !released) { if (vision) { heldVisionRequest = req; oldSeen.resolve(); } await held.promise; }
            return route.fulfill({ status: 200, contentType: 'text/plain', body: vision ? `# Synthetic vision ${owner}\n\nBody ${owner}` : `Synthetic affirmation ${owner}` });
          }
          if (kind === 'pending-images' && url.pathname.endsWith('/content/vision-overview.json')) {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overview) });
          }
          if (kind === 'pending-images' && url.pathname.includes('/content/vision-overview/')) {
            imageSeen.resolve(); await held.promise;
          }
          return route.fulfill({ status: 404, body: '{}' });
        });
        await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: STATE_KEY, value: state });
        await page.goto(`http://localhost:${port}/`);
        const nav = () => page.locator('[data-action="nav"][data-view="vision"]').first().click();
        const switchConnection = async owner => {
          // Exercise production connection/render handling without reloading away the in-memory draft.
          await page.evaluate(async value => { const { state } = await import('/src/state/store.js'); state.settings.github.dataOwner = value; }, `synthetic-${owner.toLowerCase()}`);
          await nav();
        };
        await nav();
        if (kind === 'delayed-get') {
          await observed(oldSeen.promise); const oldTerminal = observeTerminal(page, heldVisionRequest); await switchConnection('B');
          await page.locator('[data-action="reload-md"]').first().click();
          await page.getByText('Body B', { exact: true }).waitFor();

          released = true; held.resolve();
          const terminal = await oldTerminal; if (terminal.error) throw terminal.error;
          assert.ok(terminal.value.type === "finished" || terminal.value.type === "failed" && terminal.value.error === "net::ERR_ABORTED", "old request reaches a real terminal");
          console.log("PASS old Vision request terminal", JSON.stringify(terminal.value));
          await nav();
          assert.equal(await page.getByText('Body A', { exact: true }).count(), 0);
          assert.equal(await page.getByText('Body B', { exact: true }).count(), 1);
        } else if (kind === 'draft-and-put') {
          await page.locator('[data-action="vision-edit-open"]').click();
          const editor = page.locator('[data-vision-edit-textarea]');
          await editor.fill('Synthetic retained A draft');
          await switchConnection('B');
          assert.equal(await editor.inputValue(), 'Synthetic retained A draft');
          assert.equal(await page.locator('[data-action="vision-edit-save"]').isDisabled(), true);
          assert.ok((await page.locator('body').innerText()).includes('元の接続先の下書き'));
          assert.equal(puts.length, 0);
          await switchConnection('A');
          assert.equal(await page.locator('[data-action="vision-edit-save"]').isEnabled(), true);
          await page.locator('[data-action="vision-edit-save"]').click();
          await observed(putSeen.promise);
          await editor.fill('Synthetic further edits while PUT');
          putHeld.resolve();
          await page.locator('[data-action="vision-edit-save"]:not([disabled])').waitFor();
          assert.equal(await editor.inputValue(), 'Synthetic further edits while PUT');
          assert.deepEqual(puts, [{ owner: 'A', text: 'Synthetic retained A draft' }]);
        } else {
          await observed(imageSeen.promise);
          await page.getByText('Body A', { exact: true }).waitFor();
          assert.equal(released, false, 'legacy body visible while optional images unresolved');
          assert.equal(await page.locator('[data-action="vision-edit-open"]').count(), 1);
          released = true; held.resolve();
        }
        assert.deepEqual(errors, []);
        if (kind !== 'draft-and-put') assert.equal(puts.length, 0);
        console.log('PASS real app vision/' + kind);
      } finally { released = true; held.resolve(); putHeld.resolve(); await context.close(); }
    }
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
