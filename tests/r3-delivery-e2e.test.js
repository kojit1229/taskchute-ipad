// R3-D: real SW update, three-screen navigation, offline modules and delivery isolation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions, startServer, randomPort, defaultContextOptions, passGithubGate } = require('./helpers');
const components = ['src/features/vision-overview.js', 'src/features/vision-read.js', 'src/features/zero-entry.js',
  'src/features/zero-session.js', 'src/features/fund/report-view.js', 'src/features/feedback/feedback-report-overlay.js'];
(async () => {
  const server = startServer(randomPort());
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const original = server.listeners('request');
  const source = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const cacheName = source.match(/const CACHE_NAME = "([^"]+)"/)[1];
  let updated = false;
  const workerResponses = [];
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (req.url.split('?')[0] === '/sw.js') {
      workerResponses.push(updated ? 'updated' : 'original');
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
      // Update only the isolated HTTP response; the product sw.js stays byte-for-byte unchanged.
      res.end(updated ? source.replace(cacheName, `${cacheName}-r3d-fixture`) : source); return;
    }
    for (const handler of original) handler.call(server, req, res);
  });
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext({ ...defaultContextOptions(), viewport: { width: 1280, height: 900 } });
    const p = await context.newPage();
    const errors = []; p.on('pageerror', error => errors.push(error.message));
    await p.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.fulfill({ status: 404, body: '{}' }));
    await p.addInitScript(() => {
      sessionStorage.setItem('r3d-boots', String(Number(sessionStorage.getItem('r3d-boots') || 0) + 1));
      document.addEventListener('load', event => { if (event.target?.id === 'appEntry') window.r3dLoaded = true; }, true);
      const addListener = ServiceWorkerRegistration.prototype.addEventListener;
      ServiceWorkerRegistration.prototype.addEventListener = function (type, ...args) {
        const result = addListener.call(this, type, ...args);
        if (type === 'updatefound') window.r3dUpdateRegistration = this;
        return result;
      };
    });
    await p.goto(`http://localhost:${server.address().port}/`);
    await p.waitForFunction(() => Number(sessionStorage.getItem('r3d-boots')) >= 2 && window.r3dLoaded && !!navigator.serviceWorker.controller);
    await passGithubGate(p);
    await p.waitForFunction(() => window.r3dLoaded && document.readyState === 'complete');
    async function screens() {
      for (const [view, selector] of [['vision', '.vision-layout'], ['zero', '.zt-library'], ['ai-reports', '.ai-report-types']]) {
        const nav = p.locator(`[data-action="nav"][data-view="${view}"]`).filter({ visible: true }).first();
        if (!await nav.count()) await p.locator('[data-action="nav"][data-view="more"]').filter({ visible: true }).first().click();
        await p.locator(`[data-action="nav"][data-view="${view}"]`).filter({ visible: true }).first().click();
        await p.locator(selector).waitFor();
        if (view === 'ai-reports') assert.equal(await p.locator('.ai-report-types button').count(), 9);
      }
    }
    await screens();
    console.log('PASS D1: three screens open through visible navigation with active SW');
    // Start the update only after the app has installed its updatefound handler.
    await p.waitForFunction(() => !!window.r3dUpdateRegistration);
    const boots = await p.evaluate(() => Number(sessionStorage.getItem('r3d-boots')));
    updated = true;
    await p.evaluate(() => window.r3dUpdateRegistration.update());
    try {
      await p.waitForFunction(before => Number(sessionStorage.getItem('r3d-boots')) > before && window.r3dLoaded && !!navigator.serviceWorker.controller, boots);
    } catch (error) {
      console.error('SW update diagnostics', JSON.stringify({ workerResponses, before: boots, current: await p.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return { boots: sessionStorage.getItem('r3d-boots'), loaded: window.r3dLoaded, ready: document.readyState,
          active: reg?.active?.state, waiting: reg?.waiting?.state, installing: reg?.installing?.state, caches: await caches.keys() };
      }) }));
      throw error;
    }
    const names = await p.evaluate(() => caches.keys());
    assert.ok(names.includes(`${cacheName}-r3d-fixture`)); assert.ok(!names.includes(cacheName));
    await screens();
    console.log('PASS D2: new worker activates, old cache removed and three screens reopen after automatic reload');
    const cached = await p.evaluate(async name => (await (await caches.open(name)).keys()).map(r => new URL(r.url).pathname.slice(1)), `${cacheName}-r3d-fixture`);
    for (const component of components) assert.ok(cached.includes(component), component);
    assert.deepEqual(cached.filter(name => /(^|\/)(mock[^/]*|personal-data|tests|reports)(\/|$)|Vision\.md|Daily_Affirmation\.md|_vision\.pdf|\.(mp4|webm)$/i.test(name)), []);
    await context.setOffline(true); await p.reload();
    await p.waitForFunction(() => window.r3dLoaded && !!navigator.serviceWorker.controller);
    await screens();
    const responses = await p.evaluate(async files => {
      const result = [];
      for (const file of files) { const response = await fetch('/' + file); result.push([file, response.status, (await response.text()).length]); }
      return result;
    }, components);
    for (const [file, status, length] of responses) { assert.equal(status, 200, file); assert.ok(length > 0, file); }
    await context.setOffline(false); await p.reload(); await p.waitForFunction(() => window.r3dLoaded); await screens();
    assert.deepEqual(errors, []);
    console.log('PASS D3: six components cached and readable offline; no mock/private/media cache entries; online recovery');
    console.log('PASS r3-delivery-e2e: 3 cases');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
