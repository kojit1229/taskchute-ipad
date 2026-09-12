// Shared daily UI, notification contracts, localStorage isolation and responsive inputs.
// Synthetic preview/server only; optional external mock root is for manual evidence runs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const { chromium, launchOptions, defaultContextOptions, fixedClock, randomPort,
  STATE_KEY, setViewportAndWaitForStableLayout } = require('./helpers');
const ROOT = path.resolve(__dirname, '..');
const MOCK_KEY = 'taskchute-daily-mock-m04';
const report = { checks: [], measurements: [], network: [], storage: [], apiCalls: [], failures: [] };
const read = file => fs.readFileSync(file, 'utf8');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const check = (name, fn) => { fn(); report.checks.push(name); console.log(`PASS ${name}`); };

// This function becomes the disposable preview.js, independent of any real mock version.
async function mockUI() {
  const { renderPlanRow } = await import('/product/src/ui/daily-parts/plan-row.js');
  const { createMockAdapter } = await import('/product/scripts/daily-mock/mock-adapter.js');
  const fixtures = await (await fetch('/product/scripts/daily-mock/fixtures.json')).json();
  const adapter = createMockAdapter({ fixtures, storage: localStorage });
  const escape = value => String(value).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  let last;
  function render() {
    const state = adapter.getState();
    document.querySelector('#rows').innerHTML = state.entities.map(item => {
      const undoAvailable = state.receipts.some(r => r.result.entityId === item.id && r.result.undoToken === JSON.stringify(item));
      return renderPlanRow({ key: `block:${item.id}`, kind: 'block', id: item.id, title: item.title,
        dateLabel: '架空の日', subtitle: '', statusLabel: '', busy: false, error: '',
        actions: { 'daily-plan-times-save': true, 'daily-plan-times-cancel': true, 'daily-plan-complete': true,
          'daily-block-duplicate': true, 'daily-duplicate-undo': undoAvailable } },
      { plannedStartText: item.start, plannedEndText: item.end, endNextDay: item.endNextDay, estimateText: '', overlapLabel: '',
        planCompleted: item.planCompleted, taskCompleted: false, running: false, canDuplicate: true,
        canStart: false, canEnd: false, highlighted: false, saving: false, undoAvailable,
        draftId: `draft-${item.id}`, draft: { start: item.start, end: item.end, endNextDay: item.endNextDay, dirty: true, errors: [] } }, escape);
    }).join('');
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset, values = {};
    if (action === 'daily-plan-times-save') for (const field of button.closest('article').querySelectorAll('[data-daily-field]'))
      values[field.dataset.dailyField] = field.type === 'checkbox' ? field.checked : field.value;
    if (action === 'daily-plan-complete') values.desiredCompleted = button.dataset.desiredCompleted === 'true';
    if (action === 'daily-duplicate-undo') values.undoToken = adapter.getState().receipts.find(r => r.result.entityId === id && r.result.undoToken)?.result.undoToken;
    if (action !== 'mock-retry') last = { action, kind: 'block', id, draftId: `draft-${id}`,
      requestId: crypto.randomUUID(), baseFingerprint: adapter.fingerprint(), values };
    if (!last) return;
    const answer = adapter.dispatchMockOperation(last, { scenario: action === 'mock-retry' ? 'retry' : document.querySelector('#scenario').value });
    document.querySelector('#result').textContent = `${answer.status} ${answer.errors.join(' ')}`;
    document.querySelector('#candidate').textContent = JSON.stringify(adapter.getCandidate());
    if (['saved', 'cancelled'].includes(answer.status)) render();
  });
  render();
}

function createPreview(directory) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'preview.html'), `<!doctype html><html lang="ja"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic isolation preview</title>
    <link rel="stylesheet" href="/product/src/ui/daily-parts/daily-parts.css"><link rel="stylesheet" href="./preview.css"></head>
    <body><main><select id="scenario"><option value="success">成功</option><option value="failure">失敗</option><option value="cancel">取消</option></select>
    <button data-action="mock-retry">再送</button><p id="result" role="status"></p><section id="rows"></section><pre id="candidate"></pre></main>
    <script type="module" src="./preview.js"></script></body></html>`, 'utf8');
  fs.writeFileSync(path.join(directory, 'preview.js'), `(${mockUI.toString()})();`, 'utf8');
  fs.writeFileSync(path.join(directory, 'preview.css'), 'body{margin:0;font-family:system-ui}main{padding:20px;max-width:860px;margin:auto}input,select,textarea,button{font-size:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}', 'utf8');
}

async function startPreview(product, mock) {
  const python = ['python3', 'python'].find(command => spawnSync(command, ['--version'], { windowsHide: true }).status === 0);
  assert.ok(python, 'Python is required');
  const port = randomPort();
  const child = spawn(python, ['-B', '-u', path.join(ROOT, 'scripts/daily-preview-server.py'), '--bind', '127.0.0.1',
    '--port', String(port), '--product-root', product, '--mock-root', mock], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  let stdout = '', stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`Preview exited: ${stderr}`)));
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!stdout.includes('\n')) return;
      try { const message = JSON.parse(stdout.split('\n')[0]); assert.equal(message.ready, true); assert.equal(message.port, port); resolve(); }
      catch (error) { reject(error); }
    });
  });
  const stop = async () => { if (child.exitCode === null) child.kill(); await closed; };
  try { await ready; return { origin: `http://127.0.0.1:${port}`, stop }; }
  catch (error) { await stop(); throw error; }
}

// Observe calls before delegating; property syntax is also audited, not just setItem.
function installStorageAudit() {
  window.__storageAudit = [];
  for (const name of ['localStorage', 'sessionStorage']) {
    const storage = window[name];
    Object.defineProperty(window, name, { configurable: true, value: new Proxy(storage, {
      get(target, key) {
        if (['getItem', 'setItem', 'removeItem', 'clear', 'key'].includes(key)) return (...args) => {
          window.__storageAudit.push({ area: name, operation: key, key: args[0] ?? null });
          return target[key](...args);
        };
        if (key !== 'length' && typeof key === 'string') window.__storageAudit.push({ area: name, operation: 'property-read', key });
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, key, value) { window.__storageAudit.push({ area: name, operation: 'property-write', key }); return Reflect.set(target, key, value, target); },
      deleteProperty(target, key) { window.__storageAudit.push({ area: name, operation: 'property-delete', key }); return Reflect.deleteProperty(target, key); }
    }) });
  }
  for (const method of ['open', 'deleteDatabase', 'databases']) {
    const original = IDBFactory.prototype[method];
    IDBFactory.prototype[method] = function (...args) {
      window.__storageAudit.push({ area: 'indexedDB', operation: method, key: args[0] ?? null });
      return original.apply(this, args);
    };
  }
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  Object.defineProperty(Document.prototype, 'cookie', { configurable: true,
    get() { window.__storageAudit.push({ area: 'cookie', operation: 'read', key: null }); return cookie.get.call(this); },
    set(value) { window.__storageAudit.push({ area: 'cookie', operation: 'write', key: value }); return cookie.set.call(this, value); }
  });
  window.__networkCalls = [];
  const record = (api, url, method = 'GET') => window.__networkCalls.push({ api, url: new URL(String(url), location.href).href, method });
  const originalFetch = window.fetch;
  window.fetch = function (input, options) { record('fetch', input.url || input, options?.method || input.method || 'GET'); return originalFetch.apply(this, arguments); };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) { record('XHR', url, method); return originalOpen.apply(this, arguments); };
  for (const name of ['WebSocket', 'EventSource']) {
    const Original = window[name];
    window[name] = new Proxy(Original, { construct(target, args) { record(name, args[0]); throw new Error(`Forbidden ${name}`); } });
  }
  navigator.sendBeacon = (url) => { record('sendBeacon', url, 'POST'); return false; };
}

function allowedStorage(entries) {
  return entries.filter(entry => entry.area !== 'localStorage' || entry.key !== MOCK_KEY
    || !['getItem', 'setItem', 'removeItem', 'property-read', 'property-write', 'property-delete'].includes(entry.operation));
}

async function observePage(page, label, origin, files) {
  const requests = new Map(), pending = new Set(), errors = [];
  const allowed = request => {
    const url = new URL(request.url);
    return url.origin === origin && request.method === 'GET' && !url.search && files.has(url.pathname);
  };
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => pending.add(request));
  await page.route('**/*', async route => {
    const request = route.request(), entry = { page: label, url: request.url(), method: request.method(), status: 'requested' };
    entry.allowed = allowed(entry); requests.set(request, entry); report.network.push(entry);
    if (entry.allowed) await route.continue();
    else await route.fulfill({ status: 403, body: 'Blocked by isolation test' });
  });
  page.on('response', response => { const entry = requests.get(response.request()); if (entry) entry.status = response.status(); });
  page.on('requestfinished', request => {
    const entry = requests.get(request);
    if (entry) entry.finished = true;
    pending.delete(request);
  });
  page.on('requestfailed', request => { const entry = requests.get(request); if (entry) entry.status = 'failed'; pending.delete(request); });
  return { allowed, errors, async settled() {
    await page.waitForLoadState('load');
    // A browser round trip flushes synchronous operation callbacks; requestfinished is the counter boundary.
    await page.evaluate(() => document.readyState);
    if (pending.size) await new Promise(resolve => {
      const done = () => { if (!pending.size) { page.off('requestfinished', done); page.off('requestfailed', done); resolve(); } };
      page.on('requestfinished', done); page.on('requestfailed', done); done();
    });
  } };
}

async function productState(page, day, observer) {
  await page.evaluate(({ key, day }) => {
    const s = JSON.parse(localStorage.getItem(key));
    s.currentView = 'today'; s.selectedDate = day;
    Object.assign(s.settings, { lastOpenedDate: day, autoSync: false, autoArchive: false });
    Object.assign(s.settings.github, { token: 'synthetic-token', dataOwner: 'synthetic-owner', dataRepo: 'synthetic-repo', autoSave: false });
    s.projects = []; s.tasks = []; s.recurrences = [];
    s.blocks = [{ id: 'mock-product-block', title: '架空の読書', date: day, taskId: '', category: '仕事',
      plannedStartAt: `${day}T09:00:00`, plannedEndAt: `${day}T09:30:00`, actualStartAt: '', actualEndAt: '',
      completed: false, deleted: false, estimateMin: 30, charge: 0, discharge: 0, comment: '' }];
    localStorage.setItem(key, JSON.stringify(s));
  }, { key: STATE_KEY, day });
  await observer.settled(); await page.reload();
  await page.locator('[data-daily-key="block:mock-product-block"]').waitFor();
  await observer.settled();
}

async function measure(page, label, inputSelector) {
  const input = page.locator(inputSelector).first();
  await input.fill(label === 'mock' ? '10:15' : '架空');
  for (const zoom of [1, 2]) for (const width of [390, 768, 1024, 1280]) {
    await page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
    await setViewportAndWaitForStableLayout(page, { width, height: 900 }, inputSelector);
    const sample = await page.evaluate(({ label, zoom, inputSelector }) => {
      const controls = [...document.querySelectorAll('input,select,textarea')].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      const shared = document.querySelector('.daily-plan-row');
      const row = (getComputedStyle(shared).display === 'contents' ? shared.closest('[data-work-key]') : shared).getBoundingClientRect();
      return { page: label, width: innerWidth, zoom, documentWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth, row: { left: row.left, right: row.right, height: row.height },
        fonts: controls.map(el => parseFloat(getComputedStyle(el).fontSize)), value: document.querySelector(inputSelector).value };
    }, { label, zoom, inputSelector });
    report.measurements.push(sample);
    check(`${label} ${width}px zoom=${zoom}: overflow/fonts/input retention`, () => {
      assert.ok(sample.row.height > 0); assert.ok(sample.row.left >= 0 && sample.row.right <= width + 1, JSON.stringify(sample));
      assert.ok(sample.documentWidth <= sample.clientWidth + 1, JSON.stringify(sample));
      assert.ok(sample.fonts.length && sample.fonts.every(size => size >= 16), JSON.stringify(sample));
      assert.equal(sample.value, label === 'mock' ? '10:15' : '架空');
    });
  }
  await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
}

async function operations(page) {
  const action = name => page.locator(`[data-action="${name}"]`).first();
  const input = page.locator('[data-daily-field="start"]').first();
  const result = async status => page.waitForFunction(status => document.querySelector('#result').textContent.startsWith(status), status);
  await input.fill('09:05'); await action('daily-plan-times-save').click(); await result('saved');
  await page.locator('#scenario').selectOption('failure');
  await input.fill('09:10'); await action('daily-plan-times-save').click(); await result('storage-failed');
  assert.equal(await input.inputValue(), '09:10'); assert.notEqual(await page.locator('#candidate').textContent(), 'null');
  await action('mock-retry').click(); await result('saved');
  await page.locator('#scenario').selectOption('cancel');
  await input.fill('09:15'); await action('daily-plan-times-save').click(); await result('cancelled');
  assert.equal(await input.inputValue(), '09:10');
  await page.locator('#scenario').selectOption('success');
  await input.fill('09:20'); await action('daily-plan-times-cancel').click(); await result('cancelled');
  assert.equal(await input.inputValue(), '09:10');
  await action('daily-plan-complete').click(); await result('saved');
  await action('daily-block-duplicate').click(); await result('saved');
  assert.equal(await page.locator('.daily-plan-row').count(), 2);
  await action('daily-duplicate-undo').click(); await result('saved');
  assert.equal(await page.locator('.daily-plan-row').count(), 1);
  check('all five mock actions, failure, retry and cancellation', () => {});
}

async function run() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-isolation-'));
  const product = path.join(temp, 'product'), synthetic = path.join(temp, 'mock');
  const external = process.env.DAILY_ISOLATION_MOCK_ROOT;
  const mock = external ? path.resolve(external) : synthetic;
  const tracked = spawnSync('git', ['ls-files', '--', 'index.html', 'app.js', 'styles.css', 'sw.js', 'marked.min.js', 'manifest.webmanifest', 'src', 'assets', 'scripts/daily-mock'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(tracked.status, 0);
  const files = tracked.stdout.trim().split(/\r?\n/).filter(Boolean);
  const original = Object.fromEntries(files.map(file => [file, hash(path.join(ROOT, file))]));
  const mockHashes = directory => Object.fromEntries(fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath || entry.path, entry.name))
    .filter(file => !path.relative(directory, file).split(path.sep).includes('evidence'))
    .map(file => [path.relative(directory, file), hash(file)]));
  let server, browser, beforeMock;
  try {
    for (const file of files) { const target = path.join(product, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(ROOT, file), target); }
    if (!external) createPreview(mock);
    beforeMock = mockHashes(mock);
    report.mockFingerprints = beforeMock;
    const sw = read(path.join(product, 'sw.js'));
    const shell = sw.match(/const APP_SHELL\s*=\s*(\[[\s\S]*?\]);/)[1];
    check('APP_SHELL excludes mock assets', () => assert.doesNotMatch(shell, /scripts\/daily-mock|preview\./));
    const { validateDailyContract } = await import(pathToFileURL(path.join(ROOT, 'src/ui/daily-parts/contract.js')).href);
    const { createMockAdapter } = await import(pathToFileURL(path.join(ROOT, 'scripts/daily-mock/mock-adapter.js')).href);
    const memory = new Map(), storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
    const adapter = createMockAdapter({ fixtures: JSON.parse(read(path.join(ROOT, 'scripts/daily-mock/fixtures.json'))), storage });
    check('invalid contracts reject without persistence', () => {
      for (const value of [{}, null, { action: 'authenticate', values: {} }, { html: '<script>bad</script>' }]) {
        assert.equal(validateDailyContract('notification', value).valid, false);
        assert.equal(adapter.dispatchMockOperation(value).status, 'invalid');
      }
      assert.equal(memory.size, 0);
      assert.throws(() => createMockAdapter({ fixtures: {}, storage }), TypeError);
    });
    server = await startPreview(product, mock);
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ ...defaultContextOptions(), reducedMotion: 'reduce', locale: 'ja-JP',
      serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
    const now = fixedClock(new Date().setHours(10, 0, 0, 0)), epoch = now();
    const day = new Date(epoch + 9 * 3600000).toISOString().slice(0, 10);
    const productPage = await context.newPage(), mockPage = await context.newPage();
    for (const page of [productPage, mockPage]) { page.setDefaultTimeout(15000); await page.clock.setFixedTime(epoch); }
    const productAssets = new Set(files.filter(file => !file.startsWith('scripts/')).map(file => `/product/${file}`));
    const mockAssets = new Set(['/mock/preview.html', '/mock/preview.js', '/mock/preview.css',
      ...files.filter(file => /^(src\/ui\/daily-parts|scripts\/daily-mock)\//.test(file)).map(file => `/product/${file}`)]);
    const productObserver = await observePage(productPage, 'product', server.origin, productAssets);
    const mockObserver = await observePage(mockPage, 'mock', server.origin, mockAssets);
    // The order requires synthetic product startup responses. Only this product page receives them.
    // Mock fetch remains unmodified except for observation and the rejecting network route.
    report.productStartupResponses = [];
    await productPage.exposeFunction('__recordSyntheticResponse', url => report.productStartupResponses.push(url));
    await productPage.addInitScript(() => {
      const originalFetch = window.fetch;
      window.fetch = function (input) {
        const url = new URL(input.url || input, location.href);
        if (url.origin === location.origin) return originalFetch.apply(this, arguments);
        window.__recordSyntheticResponse(url.href);
        return Promise.resolve(new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } }));
      };
    });
    await mockPage.addInitScript(installStorageAudit);
    await productPage.goto(`${server.origin}/product/index.html`);
    await productState(productPage, day, productObserver);
    await mockPage.goto(`${server.origin}/mock/preview.html`);
    await mockPage.locator('.daily-plan-row').waitFor();
    await mockObserver.settled();
    const rowSample = async page => page.locator('.daily-plan-row').first().evaluate(el => ({
      label: el.querySelector('[data-daily-status="plan"]').textContent, height: el.getBoundingClientRect().height,
      computedHeight: getComputedStyle(el).height }));
    const rowFile = path.join(product, 'src/ui/daily-parts/plan-row.js'), source = read(rowFile);
    assert.equal(source.split('予定未完了').length, 2);
    const sharing = { before: [await rowSample(productPage), await rowSample(mockPage)] };
    const collectMockAudit = async () => {
      report.storage.push(...await mockPage.evaluate(() => window.__storageAudit));
      report.apiCalls.push(...await mockPage.evaluate(() => window.__networkCalls));
    };
    try {
      fs.writeFileSync(rowFile, source.replace('予定未完了', '共有変更の検出用'), 'utf8');
      await collectMockAudit();
      await productPage.reload(); await mockPage.reload();
      await productPage.locator('.daily-plan-row').first().waitFor(); await mockPage.locator('.daily-plan-row').waitFor();
      await productObserver.settled(); await mockObserver.settled();
      sharing.changed = [await rowSample(productPage), await rowSample(mockPage)];
      check('one copied shared label changes both real product and mock previews', () => {
        for (const sample of sharing.before) assert.equal(sample.label, '予定未完了');
        for (const sample of sharing.changed) assert.equal(sample.label, '共有変更の検出用');
      });
    } finally { fs.writeFileSync(rowFile, source, 'utf8'); }
    await collectMockAudit();
    await productPage.reload(); await mockPage.reload();
    await productPage.locator('.daily-plan-row').first().waitFor(); await mockPage.locator('.daily-plan-row').waitFor();
    await productObserver.settled(); await mockObserver.settled();
    sharing.restored = [await rowSample(productPage), await rowSample(mockPage)]; report.sharing = sharing;
    check('temporary shared change restored', () => {
      for (const sample of sharing.restored) assert.equal(sample.label, '予定未完了');
      assert.equal(hash(rowFile), original['src/ui/daily-parts/plan-row.js']);
    });
    const productBefore = await productPage.evaluate(key => localStorage.getItem(key), STATE_KEY);
    const cookiesBefore = await context.cookies();
    const databasesBefore = await productPage.evaluate(() => indexedDB.databases());
    await operations(mockPage);
    await measure(mockPage, 'mock', '[data-daily-field="start"]');
    await measure(productPage, 'product', '[data-work-filter="query"]');
    await mockObserver.settled(); await productObserver.settled();
    await collectMockAudit();
    report.keys = await productPage.evaluate(() => Object.keys(localStorage));
    report.cookies = await context.cookies();
    report.databases = await productPage.evaluate(() => indexedDB.databases());
    check('mock only accesses its key; no IndexedDB/cookie/auth access or product writes', () => {
      assert.ok(report.storage.some(entry => entry.operation === 'setItem'));
      assert.deepEqual(allowedStorage(report.storage), []);
    });
    check('product state, cookie jar and database inventory unchanged by mock operations', () => {
      assert.deepEqual(report.cookies, cookiesBefore); assert.deepEqual(report.databases, databasesBefore);
    });
    assert.equal(await productPage.evaluate(key => localStorage.getItem(key), STATE_KEY), productBefore);
    check('all observed requests finish as permitted local asset GETs', () => {
      assert.ok(report.network.some(entry => entry.page === 'mock' && entry.finished));
      assert.deepEqual(report.network.filter(entry => !entry.allowed || entry.status !== 200 || !entry.finished), []);
      assert.deepEqual(report.apiCalls.filter(entry => !mockObserver.allowed(entry)), []);
      assert.deepEqual(productObserver.errors, []); assert.deepEqual(mockObserver.errors, []);
    });
    const negative = await context.newPage();
    const negativeObserver = await observePage(negative, 'negative', server.origin, new Set());
    await negative.addInitScript(installStorageAudit);
    await negative.goto('about:blank');
    await negative.evaluate(() => fetch('https://forbidden.invalid/isolation-probe').catch(() => null));
    await negativeObserver.settled();
    const forbidden = report.network.filter(entry => entry.page === 'negative' && !entry.allowed);
    report.negative = { forbiddenRequests: forbidden.length };
    const rejectForbidden = () => assert.deepEqual(forbidden, [], 'forbidden communication detected');
    if (process.argv.includes('--inject-forbidden')) rejectForbidden();
    check('failure injection is detected by the same network predicate', () => { assert.equal(forbidden.length, 1); assert.throws(rejectForbidden, /forbidden communication detected/); });
    check('storage detector rejects product keys, IDB, cookies and clear', () => {
      for (const entry of [{ area: 'localStorage', operation: 'setItem', key: STATE_KEY },
        { area: 'indexedDB', operation: 'open', key: 'probe' }, { area: 'cookie', operation: 'read', key: null },
        { area: 'localStorage', operation: 'clear', key: null }]) assert.equal(allowedStorage([entry]).length, 1);
    });
  } finally {
    if (browser) await browser.close(); if (server) await server.stop();
    check('real product files unchanged', () => { for (const file of files) assert.equal(hash(path.join(ROOT, file)), original[file], file); });
    if (beforeMock) check('mock source and fixed snapshot fingerprints unchanged', () => assert.deepEqual(mockHashes(mock), beforeMock));
    report.mock = external ? 'external evidence run' : 'self-contained synthetic fixture';
    // Only delete the exact directory returned by mkdtemp, after containment verification.
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('daily-isolation-'));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

run().catch(error => { report.failures.push(error.stack); console.error(error); process.exitCode = 1; }).finally(() => {
  if (process.env.DAILY_ISOLATION_EVIDENCE_FILE) fs.writeFileSync(path.resolve(process.env.DAILY_ISOLATION_EVIDENCE_FILE), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`daily-parts-isolation-e2e: ${report.checks.length} checks, ${report.failures.length} failures`);
});
