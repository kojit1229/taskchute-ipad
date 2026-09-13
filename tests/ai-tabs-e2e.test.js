// R3-08: AI report tabs, synthetic reads, dates, sources and touch targets.
const assert = require('node:assert/strict');
const { chromium, launchOptions, startServer, randomPort, blockGithubApiByDefault,
  passGithubGate, defaultContextOptions, setViewportAndWaitForStableLayout } = require('./helpers');
const KEY = 'taskchute-journal-pwa-state-v1';
const NOW = Date.UTC(2026, 8, 13, 6), DAY = '2026-09-13', PREV = '2026-09-12';
const types = [
  ['feedback', 'AIフィードバック'], ['content', 'コンテンツ総括'], ['self', '自己分析'],
  ['weekly', '週次レビュー'], ['english', '英語表現集'], ['letter', '未来からの手紙'],
  ['excuse', '言い訳レポート'], ['fundJournal', 'FABLE FUND日誌'],
  ['fundJournalCodex', 'CODEX FUND日誌'], ['market', '朝の投資ブリーフ'], ['marketCodex', '朝の投資ブリーフ_CODEX']
];
const files = types.flatMap(([kind, prefix]) => (['self', 'letter'].includes(kind) ? ['2026-09', '2026-08'] : [DAY, PREV])
  .map(date => ({ kind, date, name: `${prefix}_${date}.md`, type: 'file' })));
const body = file => `# SYNTHETIC ${file.kind} ${file.date}\n\n本文の表示確認`;
async function readIds(page) { return page.evaluate(async () => (await import('/src/state/store.js')).state.aiReportReadIds || []); }

async function verifyGeneralErrors(browser, url) {
  const context = await browser.newContext({ ...defaultContextOptions(), serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], counts = {};
  const entries = files.filter(file => file.kind === 'content');
  let indexMode = 'valid', response = { status: 500, text: 'failed' }, directoryCalls = 0;
  let releaseCurrent, releaseOld, currentStarted, oldStarted;
  const currentRequest = new Promise(resolve => { currentStarted = resolve; });
  const oldRequest = new Promise(resolve => { oldStarted = resolve; });
  let holdCurrent = true, holdOld = true;
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: NOW });
  await blockGithubApiByDefault(page);
  await page.route(url => url.hostname === 'api.github.com' && /\/contents\/taskchute(?:\/[^/]+)?$/.test(decodeURIComponent(url.pathname)), async route => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname).split('/').pop();
    counts[name] = (counts[name] || 0) + 1;
    if (name === 'report-index.json') {
      const index = { generatedAt: new Date(indexMode === 'stale' ? NOW - 72 * 3600000 : NOW).toISOString().replace('.000Z', 'Z'),
        files: ['empty', 'none'].includes(indexMode) ? [] : entries };
      return route.fulfill({ status: 200, contentType: 'application/json', body: indexMode === 'invalid' ? '{bad' : JSON.stringify(index) });
    }
    if (name === 'taskchute') { directoryCalls++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(indexMode === 'none' ? [] : entries) }); }
    if (name === entries[0].name) {
      if (holdCurrent) { holdCurrent = false; currentStarted(); await new Promise(resolve => { releaseCurrent = resolve; }); }
      return route.fulfill({ status: response.status, body: response.text });
    }
    if (name === entries[1].name) {
      if (holdOld) { holdOld = false; oldStarted(); await new Promise(resolve => { releaseOld = resolve; }); }
      return route.fulfill({ status: 200, body: '# OLD DELAYED CONTENT' });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
  try {
    await page.goto(url);
    await page.waitForFunction(key => !!localStorage.getItem(key), KEY);
    await passGithubGate(page);
    await page.evaluate(key => {
      const state = JSON.parse(localStorage.getItem(key)); state.currentView = 'ai-reports';
      state.settings.aiReportType = 'content'; state.aiReportReadIds = []; localStorage.setItem(key, JSON.stringify(state));
    }, KEY);
    await page.reload(); await currentRequest;
    await page.locator('[data-report-state="loading"]').waitFor();
    assert(!(await readIds(page)).includes(entries[0].name));
    releaseCurrent(); await page.locator('[data-report-state="failed"]').waitFor();
    assert.match(await page.locator('.md-render').innerText(), /本文の取得に失敗/);
    assert(!(await readIds(page)).includes(entries[0].name));
    const failedRequests = counts[entries[0].name];
    await page.locator('[data-ai-report-date]').selectOption(PREV); await oldRequest;
    await page.locator('[data-ai-report-date]').selectOption(DAY);
    await page.locator('[data-report-state="failed"]').waitFor();
    assert.equal(counts[entries[0].name], failedRequests, 'cooldown prevents immediate automatic retry');
    const oldResponse = page.waitForResponse(res => decodeURIComponent(new URL(res.url()).pathname).endsWith(entries[1].name));
    releaseOld(); await (await oldResponse).finished();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.locator('[data-ai-report-date]').inputValue(), DAY);
    assert(!(await readIds(page)).includes(entries[1].name), 'late unshown day stays unread');
    await page.locator('[data-ai-report-date]').selectOption(PREV);
    await page.getByText('OLD DELAYED CONTENT', { exact: true }).waitFor();
    assert((await readIds(page)).includes(entries[1].name));
    await page.locator('[data-ai-report-date]').selectOption(DAY);
    for (const text of ['', '   \n ']) {
      response = { status: 200, text };
      await page.locator('[data-action="ai-report-refresh"]').first().click();
      await page.locator('[data-report-state="empty"]').waitFor();
      assert.match(await page.locator('.md-render').innerText(), /本文がありません/);
      assert(!(await readIds(page)).includes(entries[0].name));
    }
    response = { status: 200, text: '# RETRY SUCCESS CONTENT' };
    await page.locator('[data-action="ai-report-refresh"]').first().click();
    await page.getByText('RETRY SUCCESS CONTENT', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-ai-report-date]').inputValue(), DAY);
    assert((await readIds(page)).includes(entries[0].name));
    for (const mode of ['stale', 'invalid', 'empty']) {
      indexMode = mode; const before = directoryCalls;
      await page.reload(); await page.getByText('RETRY SUCCESS CONTENT', { exact: true }).waitFor();
      assert(directoryCalls > before, `${mode} index falls back to directory`);
    }
    indexMode = 'none'; await page.reload();
    await page.locator('[data-ai-report-state="empty-list"]').waitFor();
    assert.equal(await page.locator('[data-report-file]').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS R3-09: loading / failure / cooldown / delayed date / empty body / retry / stale-invalid-empty index / no list');
  } finally { await context.close(); }
}

(async () => {
  const port = randomPort(), server = startServer(port);
  let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ ...defaultContextOptions(), serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: NOW });
    await blockGithubApiByDefault(page);
    await page.route(url => url.hostname === 'api.github.com' && /\/contents\/taskchute(?:\/[^/]+)?$/.test(decodeURIComponent(url.pathname)), async route => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname).split('/').pop();
      const file = files.find(file => file.name === name);
      const result = name === 'taskchute' ? files : name === 'report-index.json'
        ? { generatedAt: new Date(NOW).toISOString().replace('.000Z', 'Z'), files } : file ? body(file) : null;
      await route.fulfill({ status: result === null ? 404 : 200, contentType: typeof result === 'string' ? 'text/plain' : 'application/json',
        body: typeof result === 'string' ? result : JSON.stringify(result || {}) });
    });
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(key => !!localStorage.getItem(key), KEY);
    await passGithubGate(page);
    await page.evaluate(key => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = 'ai-reports'; state.settings.aiReportType = 'content';
      state.aiReportReadIds = []; localStorage.setItem(key, JSON.stringify(state));
    }, KEY);
    await page.reload();
    await page.getByText(`SYNTHETIC content ${DAY}`, { exact: true }).waitFor();
    const tabs = page.locator('.ai-report-types button');
    assert.deepEqual(await tabs.allTextContents(), ['AIフィードバック', 'コンテンツ総括', '自己分析', '週次レビュー', '英語表現集', '未来からの手紙', '言い訳レポート', 'FABLE FUND日誌', '朝の投資ブリーフ']);
    for (const [kind, label] of types.slice(1, 7)) {
      await tabs.filter({ hasText: label }).click();
      const date = ['self', 'letter'].includes(kind) ? '2026-09' : DAY;
      await page.getByText(`SYNTHETIC ${kind} ${date}`, { exact: true }).waitFor();
      const previous = ['self', 'letter'].includes(kind) ? '2026-08' : PREV;
      await page.locator('[data-ai-report-date]').selectOption(previous);
      await page.getByText(`SYNTHETIC ${kind} ${previous}`, { exact: true }).waitFor();
    }
    await tabs.filter({ hasText: 'コンテンツ総括' }).click();
    assert.equal(await page.locator('[data-ai-report-date]').inputValue(), PREV);
    assert((await readIds(page)).includes(`コンテンツ総括_${PREV}.md`));
    for (const [kind, label] of [['fundJournalCodex', 'FABLE FUND日誌'], ['marketCodex', '朝の投資ブリーフ']]) {
      await page.locator(`[data-action="ai-report-open-unread"][data-kind="${kind}"][data-file$="${DAY}.md"]`).click();
      await page.getByText(`SYNTHETIC ${kind} ${DAY}`, { exact: true }).waitFor();
      assert.equal(await page.locator('.ai-report-types .active').textContent(), label);
      assert.equal(await page.locator('[data-fund-report-source]').textContent(), '作成元：CODEX');
      assert.equal(await page.locator('[data-report-loaded="1"]').evaluate(el => el.previousElementSibling.matches('[data-fund-report-source]')), true);
    }
    for (const family of ['journal', 'brief']) for (const engine of ['fable', 'codex']) {
      await page.locator(`[data-action="fund-report-family"][data-family="${family}"]`).click();
      await page.locator(`[data-action="fund-report-engine"][data-engine="${engine}"]`).click();
      const kind = (family === 'journal' ? 'fundJournal' : 'market') + (engine === 'codex' ? 'Codex' : '');
      await page.getByText(`SYNTHETIC ${kind} ${DAY}`, { exact: true }).waitFor();
      assert.equal(await page.locator('[data-fund-report-source]').textContent(), `作成元：${engine.toUpperCase()}`);
      assert.equal(await page.locator('.ai-report-types .active').textContent(), family === 'journal' ? 'FABLE FUND日誌' : '朝の投資ブリーフ');
      await page.locator('.ai-report-types .active').click();
      assert.equal(await page.locator('[data-fund-report-source]').textContent(), `作成元：${engine.toUpperCase()}`);
    }
    for (const width of [390, 768, 1024, 1280, 1440]) {
      const selector = '.ai-report-types button, [data-fund-report-view] button, [data-fund-report-date], [data-action="ai-report-refresh"]';
      await setViewportAndWaitForStableLayout(page, { width, height: 900 }, selector);
      const sizes = await page.locator(selector).evaluateAll(elements => elements.map(el => ({ label: el.textContent.trim(),
        height: el.getBoundingClientRect().height, font: parseFloat(getComputedStyle(el).fontSize), tag: el.tagName })));
      for (const size of sizes) { assert(size.height >= 44, JSON.stringify({ width, ...size })); if (size.tag === 'SELECT') assert(size.font >= 16); }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      console.log(`PASS width ${width}: controls >=44px; select >=16px`);
    }
    await tabs.filter({ hasText: 'AIフィードバック' }).click();
    await page.locator('[data-feedback-overlay-slot]').waitFor();
    assert.equal(await page.locator('.ai-report-types .active').textContent(), 'AIフィードバック');
    assert.deepEqual(errors, []);
    console.log('PASS R3-08: 9 tabs / 11 types / per-type dates / unread direct / source before body');
    await context.close();
    await verifyGeneralErrors(browser, `http://localhost:${port}/`);
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
