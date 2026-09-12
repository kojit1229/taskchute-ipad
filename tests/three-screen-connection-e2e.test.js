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
        // 監督者修正(2026-09-12 CHANGELOG 12:15): 期限の判定は既存の実効期限(自己締切=期限の2日前、selfDueOff で無効)を使う契約。境界例は selfDueOff で素の期限に固定する。
        { id: 'day-seven', title: '選択日から7日後', dueDate: '2026-09-14', selfDueOff: true },
        { id: 'day-eight', title: '選択日から8日後', dueDate: '2026-09-15', selfDueOff: true },
        ...['completed', 'suspended', 'cancelled'].map(status => ({ id: status, title: status, status })),
        { id: 'deleted', title: '削除済み', deleted: true }, { id: 'internal', title: '内部用', kind: 'other' }
      ].map(task => ({ status: 'todo', kind: 'task', deleted: false, parentTaskId: '', ...task }));
      const base = { date: selected, taskId: 'none', title: '選択日の予定', category: '作業', deleted: false, completed: false, estimateMin: 15 };
      state.blocks = [
        { ...base, id: 'today-only', date: today, title: '今日だけ' },
        ...[
          { id: 'today-plan', plannedStartAt: today + 'T09:00' },
          { id: 'today-unlinked', taskId: '' },
          { id: 'today-actual', actualStartAt: today + 'T08:00', actualEndAt: today + 'T08:15' },
          { id: 'today-routine', taskId: '', category: 'ルーティン' }
        ].map(block => ({ ...base, date: today, ...block })),
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
    assert.equal(await page.locator('[data-work-list="today"] h2 span').innerText(), '今日 2026-09-06');
    // Keep fixture dates independent from startup's selected-date policy.
    await page.evaluate(async selected => { (await import('/src/state/store.js')).state.selectedDate = selected; }, selected);
    const businessBefore = await page.evaluate(async () => {
      const { state } = await import('/src/state/store.js');
      return JSON.stringify([state.tasks, state.projects, state.blocks]);
    });
    assert.equal(await page.locator('[data-work-list="today"] [data-work-key="block:today-only"]').count(), 1);
    assert.equal(await page.locator('[data-work-list="today"] [data-work-key="block:planned"]').count(), 0);
    // 3段-01: 今日の群は、存在する群だけ設計06 §4の順に表示する。
    const todayGroups = await page.locator('[data-work-list="today"] [data-screen-group]').evaluateAll(nodes => nodes.map(node => node.dataset.screenGroup));
    assert.deepEqual(todayGroups, ['plans', 'untimed', 'unlinked', 'actuals', 'routines', 'candidates'].filter(group => todayGroups.includes(group)), '今日の群のDOM順');
    await page.locator('[data-work-list="today"] [data-action="nav"][data-view="exec"]').click();
    const plans = page.locator('[data-work-list="exec"]'), candidates = page.locator('[data-work-list="exec-candidates"]');
    await plans.waitFor();
    assert.equal(await plans.locator('h2 span').innerText(), '選択日 2026-09-07');
    assert.equal(await candidates.locator('h2 span').innerText(), '選択日 2026-09-07');
    assert.equal(await plans.locator('[data-work-key]').count(), 7);
    for (const [group, id] of [['plans', 'planned'], ['plans', 'second'], ['untimed', 'untimed'], ['unlinked', 'unlinked'], ['routines', 'routine'], ['actuals', 'ended'], ['actuals', 'zero']])
      assert.equal(await plans.locator(`[data-screen-group="${group}"] [data-work-key="block:${id}"]`).count(), 1, group + ':' + id);
    for (const id of ['none', 'future', 'wish-task', 'soon', 'day-seven', 'day-eight']) assert.equal(await candidates.locator(`[data-work-key="task:${id}"]`).count(), 1);
    for (const id of ['completed', 'suspended', 'cancelled', 'deleted', 'internal']) assert.equal(await candidates.locator(`[data-work-key="task:${id}"]`).count(), 0);
    await candidates.locator('[data-work-filter="status"]').selectOption('no-wish');
    assert.equal(await candidates.locator('[data-work-key="task:wish-task"]').count(), 0);
    await candidates.locator('[data-action="work-list-clear"]').click();
    await candidates.locator('[data-work-filter="due"]').selectOption('week');
    assert.equal(await candidates.locator('[data-work-key="task:soon"]').count(), 1);
    assert.equal(await candidates.locator('[data-work-key="task:day-seven"]').count(), 1);
    assert.equal(await candidates.locator('[data-work-key="task:day-eight"]').count(), 0);
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
    assert.deepEqual(await taskSearch.locator('[data-work-filter="status"] option').evaluateAll(nodes => nodes.map(node => node.value)), ['', 'open', 'running', 'completed', 'suspended']);
    await taskSearch.locator('[data-work-filter="status"]').selectOption('open');
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
    assert.equal(await taskSearch.locator('[data-work-filter="status"]').inputValue(), 'open');
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
    // S3-03: every existing field remains in one common, vertically scrollable editor.
    const taskAction = (name, id) => page.evaluate(({ name, id }) => {
      const button = document.createElement('button'); button.dataset.action = name; button.dataset.id = id;
      document.body.append(button); button.click(); button.remove();
    }, { name, id });
    const modalField = name => page.locator('#modalRoot [data-modal-field="' + name + '"]');
    await page.evaluate(async () => {
      const { state } = await import('/src/state/store.js');
      state.projects.find(p => p.id === 'alpha').twelveWeekStartDate = '2026-09-05';
      Object.assign(state.tasks.find(t => t.id === 'child'), { owner: 'ai', aiWork: true, aiBrief: '隠しても残す指示', aiWorkBrief: 'AIへの依頼', planTarget: true, estimateMin: 47, dueDate: '2026-09-15', doneCriteria: '完了の成果', firstStep: '最初の一歩', twyPlan: { perWeek: 3, fromWeek: 2, toWeek: 9, keystone: true } });
    });
    await taskAction('edit-task', 'child');
    const keys = ['title', 'projectId', 'status', 'parentTaskId', 'category', 'dueDate', 'selfDueEnabled', 'doneCriteria', 'firstStep', 'leverageType', 'aiWork', 'aiWorkBrief', 'planTarget', 'aiBrief', 'twyPerWeek', 'twyFromWeek', 'twyToWeek', 'twyKeystone', 'description'];
    for (const key of keys) assert.equal(await modalField(key).count(), 1, 'one independent field: ' + key);
    assert.equal(await modalField('dueDate').getAttribute('type'), 'date');
    assert.equal(await modalField('estimateMin').count(), 0, 'no invented estimate input');
    assert.equal(await page.locator('.task-modal [role="tab"]').count(), 0);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      // 監督者の契約追随(2026-09-12 CHANGELOG 10:10): 設計06 §7「詳細: 390px は1列、1280px は関連項目2列で1つの編集枠」。切替タブなしは列数と別の契約。
      assert(await page.locator('.task-modal .detail-columns').evaluate((el, w) => { const sections = [...el.children].map(node => node.getBoundingClientRect()); const cols = getComputedStyle(el).gridTemplateColumns.split(' ').length; return (w === 390 ? sections[1].top >= sections[0].bottom && cols === 1 : cols === 2) && el.scrollWidth <= el.clientWidth + 1; }, width), width === 390 ? 'narrow: all sections stack vertically in one column' : 'wide: two columns in one editing frame');
      await modalField('description').scrollIntoViewIfNeeded();
      assert(await modalField('description').isVisible());
      assert(await page.locator('.task-modal').evaluate(el => [...el.querySelectorAll('input:not([type="hidden"]),select,textarea')].every(input => parseFloat(getComputedStyle(input).fontSize) >= 16)));
      await page.locator('.task-modal [data-action="modal-save"]').scrollIntoViewIfNeeded();
      assert(await page.locator('.task-modal [data-action="modal-save"]').isVisible());
    }
    await page.locator('.task-modal [data-action="modal-close"]').last().click();
    await taskAction('add-task-to-project', 'alpha');
    assert.equal(await modalField('order').getAttribute('type'), 'hidden');
    assert.equal(await page.locator('.task-modal [data-action="modal-delete"]').count(), 0);
    await page.locator('.task-modal [data-action="modal-close"]').last().click();
    const hiddenBefore = await page.evaluate(async () => {
      const task = (await import('/src/state/store.js')).state.tasks.find(t => t.id === 'child');
      task.projectId = 'beta'; task.owner = 'k'; task.aiWork = false;
      return JSON.stringify([task.aiBrief, task.twyPlan, task.estimateMin]);
    });
    await taskAction('edit-task', 'child');
    assert.equal(await modalField('aiBrief').count(), 0);
    assert.equal(await modalField('twyPerWeek').count(), 0);
    await page.locator('.task-modal [data-action="modal-save"]').click();
    await page.locator('.task-modal').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(async () => { const task = (await import('/src/state/store.js')).state.tasks.find(t => t.id === 'child'); return JSON.stringify([task.aiBrief, task.twyPlan, task.estimateMin]); }), hiddenBefore, 'open/save preserves hidden AI, 12-week and estimate values');
    const savedTask = await page.evaluate(async () => JSON.stringify((await import('/src/state/store.js')).state.tasks.find(t => t.id === 'child')));
    await taskAction('edit-task', 'child');
    await modalField('title').fill('保存失敗でも残る入力');
    await modalField('title').evaluate(el => { window.taskTitleInput = el; });
    await page.evaluate(key => { window.originalTaskSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (k === key) throw new DOMException('fixture quota', 'QuotaExceededError'); return window.originalTaskSetItem.call(this, k, v); }; }, STATE_KEY);
    await page.locator('.task-modal [data-action="modal-save"]').click();
    assert.equal(await modalField('title').inputValue(), '保存失敗でも残る入力');
    assert(await modalField('title').evaluate(el => el === window.taskTitleInput));
    assert.equal(await page.evaluate(async () => JSON.stringify((await import('/src/state/store.js')).state.tasks.find(t => t.id === 'child'))), savedTask, 'failed save rolls back task');
    await page.evaluate(() => { Storage.prototype.setItem = window.originalTaskSetItem; });
    await page.locator('.task-modal [data-action="modal-close"]').last().click();
    await page.locator('[data-action="draft-leave-stay"]').click();
    assert.equal(await modalField('title').inputValue(), '保存失敗でも残る入力');
    await page.locator('.task-modal [data-action="modal-close"]').last().click();
    await page.locator('[data-action="draft-leave-discard"]').click();
    assert.equal(await page.evaluate(async () => JSON.stringify((await import('/src/state/store.js')).state.tasks.find(t => t.id === 'child'))), savedTask, 'discard leaves saved task unchanged');
    console.log('PASS S3-03: all fields, vertical editor, native date, hidden values, no fixed estimate, failure DOM and cancel/discard');
    assert.deepEqual(errors, []);
    console.log('PASS S3-01: explicit dates, occurrences, candidates, groups, zero actuals, IME, responsive execution and no mutation');
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

// S-L2A: appended suite runs after the preceding browser/server have closed.
const dailyLayoutChecks = [];
process.once('beforeExit', async () => {
  let server, browser;
  try {
    server = startServer(randomPort());
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ ...defaultContextOptions(), viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    await page.clock.install({ time: new Date(2026, 8, 6, 10, 30) });
    await page.goto('http://localhost:' + server.address().port + '/');
    await passGithubGate(page);
    await page.evaluate(({ key, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = 'today'; state.settings.lastOpenedDate = today;
      state.settings.autoSync = false; state.settings.github.autoSave = false;
      state.settings.birthDate = ''; state.selectedDate = '2026-09-01';
      state.blocks = []; state.tasks = []; state.projects = []; state.recurrences = [];
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem('taskchute-journal-today-focus-v1', JSON.stringify({ sections: { side: false, journal: false, life: false } }));
    }, { key: STATE_KEY, today });
    await page.reload();
    const root = page.locator('[data-daily-view="today"]');
    await root.waitFor();
    for (const selector of ['#towerClock', '#towerDayLeft', '.life-band', '.so-row', '.tower-runway', '[data-work-list="today"]', '#towerFlightLog', '#towerGateStrip', '#towerJournalFree'])
      assert.equal(await root.locator(selector).count(), 1, 'permanent: ' + selector);
    assert.equal(await root.locator('.today-pomodoro,.sec-bm,.tower-condition').count(), 0);
    assert.equal(await root.locator('.life-band').getByText('45???').count(), 0);
    assert((await root.locator('#towerDate').textContent()).includes(today));
    const journal = root.locator('#towerJournalFree');
    await journal.fill('????????????');
    await journal.evaluate(el => { window.dailyJournalNode = el; window.dailyOrder = [...el.closest('[data-daily-view]').children]; });
    await page.clock.runFor(2000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.runFor(1000);
    assert(await journal.evaluate(el => el === window.dailyJournalNode && el.value === '????????????' && window.dailyOrder.every((node, i) => node === el.closest('[data-daily-view]').children[i])));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('taskchute-journal-today-focus-v1')).sections.life), false);
    await root.locator('[data-action="save-tower-journal"]').click();
    assert.equal(await page.evaluate(async date => (await import('/src/state/store.js')).state.journals[date], today), '????????????');
    for (const check of dailyLayoutChecks) await check(page, root);
    console.log('PASS S3-06: eight permanent sections, actual clock, missing birthday, retained settings/journal DOM, explicit save');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); }
});
