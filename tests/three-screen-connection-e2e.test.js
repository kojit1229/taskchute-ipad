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
    // S3-02: independent Project/Task searches, hierarchy, retained DOM and two placements.
    await page.evaluate(async () => {
      const { state } = await import('/src/state/store.js');
      state.projects.push({ id: 'alpha', title: 'Alpha', description: '検索用説明', status: 'active' }, { id: 'beta', title: 'Beta', status: 'active' });
      state.tasks.push({ id: 'parent', title: '親', projectId: 'alpha', status: 'completed', collapsed: true },
        { id: 'child', title: '検索対象', projectId: 'alpha', parentTaskId: 'parent', status: 'todo' },
        { id: 'grandchild', title: '未完了の子', projectId: 'alpha', parentTaskId: 'child', status: 'todo' },
        { id: 'beta-task', title: '別Project', projectId: 'beta', status: 'todo' },
        ...Array.from({ length: 40 }, (_, i) => ({ id: 'alpha-' + i, title: '連続 ' + i, projectId: 'alpha', status: 'todo', order: i })));
      state.settings.wbsHideCompleted = false; state.settings.wbsCompactMode = false;
    });
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.locator('[data-action="nav"][data-view="wbs"]').first().click();
    const projectSearch = page.locator('[data-work-list="wbs-projects"]');
    await projectSearch.locator('[data-action="wbs-select-project"][data-id="alpha"]').click();
    const taskSearch = page.locator('[data-work-list="wbs-tasks-alpha"]');
    const searchBefore = await page.evaluate(async () => { const { state } = await import('/src/state/store.js'); return JSON.stringify([state.tasks, state.projects, state.blocks, state.settings]); });
    const projectQuery = projectSearch.locator('[data-work-filter="query"]');
    await projectQuery.fill('検索用説明');
    assert.equal(await projectSearch.locator('[data-action="wbs-select-project"]').count(), 1);
    await projectQuery.fill('該当なし');
    assert.equal(await projectSearch.locator('[data-action="wbs-select-project"]').count(), 0);
    assert.equal(await taskSearch.count(), 1, 'filtering projects never changes selection');
    await projectQuery.fill('');
    const taskQuery = taskSearch.locator('[data-work-filter="query"]');
    await taskQuery.fill('検索対象');
    for (const id of ['parent', 'child', 'grandchild']) assert.equal(await taskSearch.locator('[data-work-key="task:' + id + '"]').count(), 1);
    await taskQuery.evaluate(el => { window.taskSearchInput = el; el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.value = '連続'; el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true })); });
    assert.equal(await taskSearch.locator('[data-work-key="task:child"]').count(), 1);
    await taskQuery.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    assert.equal(await taskSearch.locator('[data-work-key]').count(), 40);
    assert(await taskQuery.evaluate(el => el === window.taskSearchInput && el === document.activeElement));
    await taskSearch.locator('[data-work-list-rows]').evaluate(el => { el.scrollTop = 900; window.taskSearchTop = el.scrollTop; });
    await projectSearch.locator('[data-action="wbs-select-project"][data-id="beta"]').click();
    const betaQuery = page.locator('[data-work-list="wbs-tasks-beta"] [data-work-filter="query"]');
    assert.equal(await betaQuery.inputValue(), '');
    await betaQuery.fill('別Project');
    await projectSearch.locator('[data-action="wbs-select-project"][data-id="alpha"]').click();
    assert.equal(await taskQuery.inputValue(), '連続');
    assert(await taskQuery.evaluate(el => el === window.taskSearchInput));
    assert(await taskSearch.locator('[data-work-list-rows]').evaluate(el => el.scrollTop === window.taskSearchTop));
    await taskQuery.fill('検索対象');
    await taskSearch.locator('.wbs-task-title[data-id="child"]').click();
    await page.locator('.task-modal').waitFor();
    await page.locator('.task-modal [data-action="modal-close"]').last().click();
    await page.locator('.task-modal').waitFor({ state: 'hidden' });
    assert(await taskQuery.evaluate(el => el === window.taskSearchInput));
    assert.equal(await taskQuery.inputValue(), '検索対象');
    assert.equal(await page.evaluate(async () => { const { state } = await import('/src/state/store.js'); return JSON.stringify([state.tasks, state.projects, state.blocks, state.settings]); }), searchBefore, 'search and return never mutate business state or settings');
    await projectSearch.locator('[data-action="wbs-select-project"][data-id=""]').click();
    assert.equal(await page.locator('[data-work-list="wbs-tasks-"] [data-work-key="task:none"]').count(), 1);
    assert.equal(await page.evaluate(async () => (await import('/src/state/store.js')).state.projects.some(p => p.id === '')), false);
    await projectSearch.locator('[data-action="wbs-select-project"][data-id="alpha"]').click();
    await taskSearch.locator('[data-action="task-today"][data-id="child"]').click();
    await page.locator('.modal-footer [data-action="modal-save"]').click();
    await taskSearch.locator('[data-action="placement-add-another"][data-id="child"]').click();
    await page.locator('.modal-footer [data-action="modal-save"]').click();
    assert.equal(await page.evaluate(async () => (await import('/src/state/store.js')).state.blocks.filter(b => !b.deleted && b.taskId === 'child').length), 2);
    assert.equal(await taskSearch.locator('[data-action="placement-add-today"][data-id="child"]').count(), 1);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => !!document.querySelector('[data-work-list="wbs-tasks-alpha"]'));
      assert(await taskQuery.isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'WBS no horizontal overflow');
    }
    console.log('PASS S3-02: left/right search, hierarchy, IME, per-Project DOM/query/scroll, detail return, no save and two placements');
    assert.deepEqual(errors, []);
    console.log('PASS S3-01: explicit dates, occurrences, candidates, groups, zero actuals, IME, responsive execution and no mutation');
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
