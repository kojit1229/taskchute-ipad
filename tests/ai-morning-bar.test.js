const assert = require('node:assert/strict');
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY, defaultContextOptions, fixedClock } = require('./helpers');

(async () => {
  const port = randomPort(), server = startServer(port);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ ...defaultContextOptions(), serviceWorkers: 'block',
    reducedMotion: 'reduce', viewport: { width: 375, height: 900 } });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  const current = new Date(), clock = fixedClock(new Date(current.getFullYear(), current.getMonth(), current.getDate(), 12).getTime());
  const now = clock(), day = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const yesterday = new Date(now - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const built = `${day}T02:10:00+09:00`;
  const block = (id, extra = {}) => ({ id, title: id, date: day, taskId: '', category: '',
    plannedStartAt: `${day}T13:00`, plannedEndAt: `${day}T13:30`, estimateMin: 30,
    actualStartAt: '', actualEndAt: '', completed: false, deleted: false, ...extra });
  const mark = reason => ({ source: 'morning', builtAt: built, reason, tag: '期限', key: `${day}:${reason}` });
  const blocks = [block('ai-one', { aiPlan: mark('期限: <script>危険</script>') }),
    block('ai-done', { aiPlan: mark('12週目標: 一歩'), completed: true }),
    block('manual', { estimateMin: 20, plannedEndAt: `${day}T17:00` }),
    block('rec_routine', { category: 'ルーティン', estimateMin: 60, plannedEndAt: `${day}T18:00` }),
    block('running', { actualStartAt: `${day}T12:00` }),
    block('yesterday', { date: yesterday, aiPlan: mark('過去') }),
    block('deleted', { deleted: true, aiPlan: mark('削除') })];
  let response = { date: day, status: 'ok', builtAt: built, placed: 2, skipped: [], nextRunAt: `${day}T02:10:00+09:00` };
  await blockGithubApiByDefault(page);
  await page.route('**/contents/taskchute/app-state.json?*', async route => {
    const text = await page.evaluate(key => localStorage.getItem(key), STATE_KEY);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      sha: 'fixture-sha', encoding: 'base64', content: Buffer.from(text).toString('base64')
    }) });
  });
  await page.route('**/contents/taskchute/ai-morning-status.json?*', route => route.fulfill({
    status: response === null ? 404 : 200, contentType: 'application/json', body: JSON.stringify(response)
  }));
  async function seed(skin, items = blocks) {
    await page.evaluate(({ key, day, skin, blocks }) => {
      const s = JSON.parse(localStorage.getItem(key));
      Object.assign(s, { blocks, tasks: [], projects: [], recurrences: [], singleSchedules: [], currentView: 'today', selectedDate: day });
      Object.assign(s.settings, { todaySkin: skin, autoSync: false });
      s.pomodoro.running = false;
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, day, skin, blocks: items });
    await page.reload();
    await page.locator('[data-testid="ai-morning-host"][data-loaded="true"]').waitFor({ state: 'attached' });
  }
  try {
    await page.clock.setFixedTime(now);
    await page.goto(`http://localhost:${port}/`);
    await page.locator('[data-action="gate-continue"]').waitFor();
    await passGithubGate(page);
    // Acceptance 10: real Block marks, aggregation, native reason disclosure and escaping.
    await seed('now');
    let bar = page.locator('[data-testid="ai-morning-bar"]');
    assert.match(await bar.innerText(), /✦ AI が組みました.*02:10/s);
    assert.match(await bar.innerText(), /AI が置いたもの 2 件 ・ 残り 50 分\(ルーティン除く\)・ 終わる見込み 18:00/);
    await bar.locator('summary').click();
    assert.deepEqual(await bar.locator('li').allTextContents(), ['期限: <script>危険</script>', '12週目標: 一歩']);
    assert.equal(await bar.locator('script').count(), 0);
    console.log('PASS acceptance 10: marked Blocks and reasons');
    // Acceptance 11: producer status, skipped disclosure, missing and stale files.
    response = { ...response, status: 'error', reason: '接続エラー' + 'x'.repeat(150),
      skipped: [{ title: '置けない作業', reason: '既存の予定と重なります' }] };
    await seed('now', []);
    bar = page.locator('[data-testid="ai-morning-bar"]');
    assert.match(await bar.innerText(), /✦ AI が今朝は組めませんでした/);
    assert.match(await bar.innerText(), /接続エラー.*既存の予定はそのまま.*次の実行/s);
    assert.equal(await bar.getAttribute('data-status'), 'error');
    await bar.locator('summary').click();
    assert.match(await bar.innerText(), /AI が今日は置かなかったもの\(1 件\).*置けない作業/s);
    assert.equal(await bar.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth), true);
    response = null;
    await seed('now');
    assert.equal(await page.locator('[data-testid="ai-morning-bar"]').count(), 0);
    response = { date: yesterday, status: 'error', reason: '古いエラー' };
    await seed('now');
    assert.equal(await page.locator('[data-testid="ai-morning-bar"]').count(), 0);
    console.log('PASS acceptance 11: error, skipped, missing and stale');
    // Acceptance 12: common entry for both skins, first position, narrow viewport.
    response = { date: day, status: 'ok', skipped: [] };
    for (const skin of ['now', 'tower']) {
      await seed(skin);
      bar = page.locator('[data-testid="ai-morning-bar"]');
      assert.match(await bar.innerText(), /AI が組みました/);
      assert.equal(await page.locator('#main > :first-child').getAttribute('data-testid'), 'ai-morning-host');
      assert.equal(await bar.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth), true);
    }
    assert.deepEqual(errors, []);
    console.log('PASS acceptance 12: now/tower and 375px');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
