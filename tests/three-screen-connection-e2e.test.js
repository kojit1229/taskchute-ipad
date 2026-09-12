// S3-01 execution: Task/Block classification, selected dates, search IME and responsive views.
const assert = require('node:assert/strict');
const { chromium, launchOptions, defaultContextOptions, startServer, randomPort, STATE_KEY, passGithubGate } = require('./helpers');
const today = '2026-09-06', selected = '2026-09-07';
(async () => {
  let server, browser;
  try {
    server = startServer(randomPort());
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ ...defaultContextOptions(), locale: 'ja-JP', viewport: { width: 1280, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    await page.clock.setFixedTime(new Date(2026, 8, 6, 10, 30));
    await page.goto('http://localhost:' + server.address().port + '/');
    await passGithubGate(page);
    await page.evaluate(({ key, today, selected }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = 'today'; state.selectedDate = selected;
      state.settings.lastOpenedDate = today; state.settings.autoSync = false; state.settings.github.autoSave = false;
      state.projects = [{ id: 'wish', title: 'やりたいこと', kind: 'wish', status: 'active' }];
      state.tasks = [
        { id: 'none', title: '所属なし期限なし', projectId: '' },
        { id: 'future', title: '先の期限', dueDate: '2026-10-01' },
        { id: 'wish-task', title: 'やりたいこと候補', projectId: 'wish' },
        { id: 'soon', title: '期限7日以内', dueDate: selected },
        ...['completed', 'suspended', 'cancelled'].map(status => ({ id: status, title: status, status })),
        { id: 'deleted', title: '削除済み', deleted: true }, { id: 'internal', title: '内部用', kind: 'other' }
      ].map(task => ({ status: 'todo', kind: 'task', deleted: false, parentTaskId: '', ...task }));
      const base = { date: selected, taskId: 'none', title: '選択日の予定', category: '作業', deleted: false, completed: false, estimateMin: 15 };
      state.blocks = [
        { ...base, id: 'today-only', date: today, title: '今日だけ' },
        { ...base, id: 'planned', plannedStartAt: selected + 'T09:00' },
        { ...base, id: 'second', title: '同じTaskの別枠', plannedStartAt: selected + 'T10:00' },
        { ...base, id: 'untimed', title: '時刻未定' },
        { ...base, id: 'unlinked', taskId: '', title: '紐づきなし' },
        { ...base, id: 'ended', actualStartAt: selected + 'T08:00', actualEndAt: selected + 'T08:15' },
        { ...base, id: 'routine', taskId: '', category: 'ルーティン', title: '通常ルーティン' },
        { ...base, id: 'zero', taskId: '', category: 'ルーティン', title: '0分実績', actualStartAt: selected + 'T07:00', actualEndAt: selected + 'T07:00' },
        { ...base, id: 'removed', deleted: true }
      ];
      state.recurrences = [];
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.removeItem('taskchute-journal-today-focus-v1');
    }, { key: STATE_KEY, today, selected });
    await page.reload();
    await page.locator('[data-work-list="today"]').waitFor();
    // Keep fixture dates independent from startup's selected-date policy.
    await page.evaluate(async selected => { (await import('/src/state/store.js')).state.selectedDate = selected; }, selected);
    const businessBefore = await page.evaluate(async () => {
      const { state } = await import('/src/state/store.js');
      return JSON.stringify([state.tasks, state.projects, state.blocks]);
    });
    assert.equal(await page.locator('[data-work-list="today"] [data-work-key="block:today-only"]').count(), 1);
    assert.equal(await page.locator('[data-work-list="today"] [data-work-key="block:planned"]').count(), 0);
    await page.locator('[data-work-list="today"] [data-action="nav"][data-view="exec"]').click();
    const plans = page.locator('[data-work-list="exec"]'), candidates = page.locator('[data-work-list="exec-candidates"]');
    await plans.waitFor();
    assert.equal(await plans.locator('[data-work-key]').count(), 7);
    for (const [group, id] of [['plans', 'planned'], ['plans', 'second'], ['untimed', 'untimed'], ['unlinked', 'unlinked'], ['routines', 'routine'], ['actuals', 'ended'], ['actuals', 'zero']])
      assert.equal(await plans.locator(`[data-screen-group="${group}"] [data-work-key="block:${id}"]`).count(), 1, group + ':' + id);
    for (const id of ['none', 'future', 'wish-task', 'soon']) assert.equal(await candidates.locator(`[data-work-key="task:${id}"]`).count(), 1);
    for (const id of ['completed', 'suspended', 'cancelled', 'deleted', 'internal']) assert.equal(await candidates.locator(`[data-work-key="task:${id}"]`).count(), 0);
    await candidates.locator('[data-work-filter="status"]').selectOption('no-wish');
    assert.equal(await candidates.locator('[data-work-key="task:wish-task"]').count(), 0);
    await candidates.locator('[data-action="work-list-clear"]').click();
    await candidates.locator('[data-work-filter="due"]').selectOption('week');
    assert.equal(await candidates.locator('[data-work-key="task:soon"]').count(), 1);
    assert.equal(await candidates.locator('[data-work-key="task:future"]').count(), 0);
    assert.equal(await candidates.locator('[data-work-key="task:none"]').count(), 0);
    await candidates.locator('[data-action="work-list-clear"]').click();
    const query = candidates.locator('[data-work-filter="query"]');
    await query.fill('所属');
    await query.evaluate(el => { window.fixtureQuery = el; el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.value = 'やりたい'; el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true })); });
    assert.equal(await candidates.locator('[data-work-key="task:none"]').count(), 1);
    await query.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    assert.equal(await candidates.locator('[data-work-key="task:wish-task"]').count(), 1);
    assert(await query.evaluate(el => el === window.fixtureQuery && el === document.activeElement));
    await page.locator('[data-action="exec-mode-toggle"][data-mode="actual"]').first().click();
    const actuals = page.locator('[data-work-list="exec-actual"]');
    assert.equal(await actuals.locator('[data-work-key]').count(), 2);
    assert((await actuals.locator('[data-work-key="block:zero"]').textContent()).includes('0分'));
    assert.equal(await actuals.locator('[data-work-key="block:zero"] [data-action="daily-task-complete"]').count(), 0);
    for (const width of [390, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => !!document.querySelector('[data-work-list="exec-actual"]') && !!document.querySelector('.timeline-tower'));
      assert(await actuals.isVisible());
      assert(await page.locator('.timeline-tower').isVisible());
    }
    const businessAfter = await page.evaluate(async () => {
      const { state } = await import('/src/state/store.js');
      return JSON.stringify([state.tasks, state.projects, state.blocks]);
    });
    assert.equal(businessAfter, businessBefore, 'navigation, classification and searching do not save business changes');
    assert.deepEqual(errors, []);
    console.log('PASS S3-01: explicit dates, occurrences, candidates, groups, zero actuals, IME, responsive execution and no mutation');
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
