const assert = require('node:assert/strict');
const { chromium, launchOptions, startServer, randomPort, STATE_KEY, passGithubGate } = require('./helpers');
(async () => {
  const port = randomPort(); const server = startServer(port);
  const browser = await chromium.launch(launchOptions());
  const url = `http://localhost:${port}/`;
  const seedContext = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const seedPage = await seedContext.newPage();
    await seedPage.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    await seedPage.goto(url);
    await seedPage.waitForFunction(key => !!localStorage.getItem(key), STATE_KEY);
    await passGithubGate(seedPage);
    const valid = await seedPage.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    valid.settings.autoSync = false; valid.settings.github.autoSave = false;
    await seedContext.close();
    for (const [key, bad] of [['journals','invalid'],['journals',[]],['recurrences','invalid'],['recurrences',{}]]) {
      // Separate documents prevent normal startup requests from contaminating quarantine counts.
      const context = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const page = await context.newPage(); page.setDefaultTimeout(10000);
        const errors = []; page.on('pageerror', e => errors.push(e.name));
        let externalCalls = 0;
        await page.route('**/*', route => {
          if (new URL(route.request().url()).hostname !== 'localhost') { externalCalls++; return route.abort(); }
          return route.continue();
        });
        const raw = JSON.stringify({ ...valid, [key]: bad });
        await page.addInitScript(({k,raw}) => {
          if (sessionStorage.getItem('fixture-seeded')) return;
          localStorage.setItem(k,raw);
          localStorage.setItem(k+'-corrupt-backup','fixture-existing-recovery-copy');
          sessionStorage.setItem('fixture-seeded','yes');
        }, { k:STATE_KEY,raw });
        await page.goto(url);
        await page.getByRole('heading', {name:'保存データを読み込めませんでした'}).waitFor();
        assert.equal(await page.evaluate(k => localStorage.getItem(k), STATE_KEY), raw);
        assert.equal(await page.evaluate(k => localStorage.getItem(k+'-corrupt-backup'), STATE_KEY), 'fixture-existing-recovery-copy');
        assert.equal(externalCalls, 0, 'quarantine must not request remote data');
        assert.equal(await page.getByRole('link',{name:'再読み込み'}).count(),1);
        assert.deepEqual(errors,['StateContainerError']);
        await page.evaluate(({k,valid}) => localStorage.setItem(k,JSON.stringify(valid)), {k:STATE_KEY,valid});
        await page.getByRole('link',{name:'再読み込み'}).click();
        await page.locator('#sidebar .nav-button[data-action="nav"][data-view="today"]').waitFor({state:'visible'});
        assert.equal(JSON.parse(await page.evaluate(k => localStorage.getItem(k),STATE_KEY)).recurrences.length,valid.recurrences.length);
        console.log('PASS full startup quarantine + valid reload '+key+':'+JSON.stringify(bad));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(e=>{ console.error(e); process.exitCode=1; });
