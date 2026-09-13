// R3-10: weekly AI suggestions use the real saved-candidate boundary.
const assert = require('node:assert/strict');
const { chromium, launchOptions, startServer, randomPort, blockGithubApiByDefault,
  passGithubGate, defaultContextOptions } = require('./helpers');
const KEY = 'taskchute-journal-pwa-state-v1', DAY = '2026-09-13';
const NOW = Date.UTC(2026, 8, 13, 6), NAME = `週次レビュー_${DAY}.md`;
const MD = '# 架空の週次レビュー\n\n## 来週のタスク提案\n- [ ] 保存検査の提案 (30分)\n- [ ] 別の提案 (15分)';
const snapshot = page => page.evaluate(async key => ({ state: JSON.parse(JSON.stringify((await import('/src/state/store.js')).state)),
  persisted: localStorage.getItem(key), writes: window.weeklyWrites || 0 }), KEY);

(async () => {
  const port = randomPort(), server = startServer(port); let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ ...defaultContextOptions(), serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: NOW });
    await blockGithubApiByDefault(page);
    await page.route(url => url.hostname === 'api.github.com' && /\/contents\/taskchute(?:\/[^/]+)?$/.test(decodeURIComponent(url.pathname)), async route => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname).split('/').pop();
      const files = [{ name: NAME, kind: 'weekly', date: DAY, type: 'file' }];
      const value = name === NAME ? MD : name === 'taskchute' ? files : name === 'report-index.json'
        ? { generatedAt: new Date(NOW).toISOString().replace('.000Z', 'Z'), files } : null;
      await route.fulfill({ status: value === null ? 404 : 200, body: typeof value === 'string' ? value : JSON.stringify(value || {}),
        contentType: typeof value === 'string' ? 'text/plain' : 'application/json' });
    });
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(key => !!localStorage.getItem(key), KEY);
    await passGithubGate(page);
    await page.evaluate(key => {
      const state = JSON.parse(localStorage.getItem(key)); state.currentView = 'ai-reports';
      state.settings.aiReportType = 'weekly';
      state.tasks.push({ id: 'weekly-unrelated', title: '無関係な作業', projectId: state.projects.find(project => project.kind === 'other').id });
      localStorage.setItem(key, JSON.stringify(state));
    }, KEY);
    await page.reload();
    const add = page.locator('[data-action="weekly-suggest-add"][data-index="0"]');
    await add.waitFor();
    await page.waitForFunction(async name => (await import('/src/state/store.js')).state.aiReportReadIds.includes(name), NAME);
    await page.evaluate(key => {
      const original = Storage.prototype.setItem;
      window.weeklyFail = true; window.weeklyWrites = 0;
      Storage.prototype.setItem = function(name, value) {
        if (name === key) { window.weeklyWrites++; if (window.weeklyFail) throw new DOMException('Synthetic full storage', 'QuotaExceededError'); }
        return original.call(this, name, value);
      };
    }, KEY);
    const before = await snapshot(page);
    await add.click();
    await page.getByText('端末に保存できませんでした。入力は残しています。保存先を確認して再試行してください', { exact: true }).waitFor();
    const failed = await snapshot(page);
    assert.equal(failed.writes, 1);
    assert.deepEqual(failed.state, before.state, 'failed candidate restores all state');
    assert.equal(failed.persisted, before.persisted);
    assert.equal(await page.locator('.ai-weekly-suggest-row').filter({ hasText: '登録済み' }).count(), 0);
    assert.equal(await page.getByText('「保存検査の提案」をWBSに登録しました', { exact: true }).count(), 0);
    assert.equal(await add.count(), 1);
    console.log('PASS failure: one write attempt, all state restored, no registered mark or success notice');

    await page.evaluate(async () => {
      const { state } = await import('/src/state/store.js');
      const task = state.tasks.find(task => task.id === 'weekly-unrelated');
      task.title = '失敗後に更新された作業'; task.updatedAt = '2026-09-13T15:00:01';
      window.weeklyFail = false; window.weeklyWrites = 0;
    });
    const retryBefore = await snapshot(page);
    await add.click();
    await page.getByText('「保存検査の提案」をWBSに登録しました', { exact: true }).waitFor();
    const saved = await snapshot(page), added = saved.state.tasks.filter(task => task.title === '保存検査の提案');
    assert.equal(saved.writes, 1); assert.equal(added.length, 1); assert.equal(added[0].estimateMin, 30);
    assert.equal(saved.state.tasks.length, retryBefore.state.tasks.length + 1);
    assert.deepEqual(saved.state.tasks.filter(task => task.id !== added[0].id), retryBefore.state.tasks);
    assert.deepEqual(saved.state.blocks, retryBefore.state.blocks);
    assert.equal(JSON.parse(saved.persisted).tasks.filter(task => task.id === added[0].id).length, 1);
    assert.equal(await page.locator('.ai-weekly-suggest-row').filter({ hasText: '登録済み' }).count(), 1);
    assert.equal(await page.locator('[data-action="weekly-suggest-add"][data-index="1"]').count(), 1);
    console.log('PASS retry: one write, one task, estimate retained, unrelated updated task and blocks unchanged');

    await page.evaluate(day => {
      window.weeklyWrites = 0;
      const button = document.createElement('button');
      Object.assign(button.dataset, { action: 'weekly-suggest-add', week: day, index: '0' });
      document.body.append(button); button.click(); button.remove();
    }, DAY);
    const duplicate = await snapshot(page);
    assert.equal(duplicate.writes, 0); assert.deepEqual(duplicate.state.tasks, saved.state.tasks);
    await page.evaluate(async () => {
      const { state } = await import('/src/state/store.js');
      state.projects = state.projects.filter(project => project.kind !== 'other');
    });
    await page.locator('[data-action="weekly-suggest-add"][data-index="1"]').click();
    await page.getByText('登録先プロジェクトが見つかりません', { exact: true }).waitFor();
    const noProject = await snapshot(page);
    assert.equal(noProject.writes, 0); assert.deepEqual(noProject.state.tasks, saved.state.tasks);
    assert.equal(await page.locator('.ai-weekly-suggest-row').filter({ hasText: '登録済み' }).count(), 1);
    assert.deepEqual(errors, []);
    console.log('PASS duplicate and missing project: no save, no extra task, original explanation retained');
    await context.close();
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
