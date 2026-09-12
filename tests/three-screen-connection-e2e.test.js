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
    const conditionalTask = await page.evaluate(async () => structuredClone((await import('/src/state/store.js')).state.tasks.find(t => t.id === 'child')));
    assert.equal(await modalField('twyPerWeek').count(), 0);
    await page.locator('.task-modal [data-action="modal-save"]').click();
    await page.locator('.task-modal').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(async () => { const task = (await import('/src/state/store.js')).state.tasks.find(t => t.id === 'child'); return JSON.stringify([task.aiBrief, task.twyPlan, task.estimateMin]); }), hiddenBefore, 'open/save preserves hidden AI, 12-week and estimate values');
    await taskAction('edit-task', 'child');
    assert.equal(await modalField('title').inputValue(), conditionalTask.title, 'saved detail reopens the same Task');
    assert.equal(await modalField('projectId').inputValue(), conditionalTask.projectId);
    assert.equal(await modalField('aiBrief').count(), 0, 'conditional field remains hidden after reopen');
    assert.equal(await page.evaluate(async () => (await import('/src/state/store.js')).state.tasks.find(t => t.id === 'child').order), conditionalTask.order, 'detail save preserves ordering');
    await page.locator('.task-modal [data-action="modal-close"]').last().click();
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
    // S3-05: one transaction owns Block, Task and the end report; no planned time is invented.
    await page.evaluate(async today => {
      const { state } = await import('/src/state/store.js');
      state.tasks.push({ id: 'detail-task', title: '架空完了対象', status: 'todo', order: 123 });
      state.blocks.push({ id: 'detail-block', title: '架空未定枠', date: today, taskId: 'detail-task',
        category: '作業', plannedStartAt: '', plannedEndAt: '', actualStartAt: '', actualEndAt: '',
        completed: false, comment: '既存メモ', externalRef: 'fixture-reference', source: 'fixture', retained: 'keep' });
    }, today);
    const detailState = () => page.evaluate(async () => {
      const { state } = await import('/src/state/store.js');
      return JSON.stringify([state.blocks.find(b => b.id === 'detail-block'), state.tasks.find(t => t.id === 'detail-task'), state.declarations]);
    });
    const detailBefore = await detailState();
    await taskAction('edit-block', 'detail-block');
    assert.equal(await page.locator('#modalRoot details').count(), 0, 'all detail fields are permanent');
    assert(await modalField('actualStartAt').isVisible());
    await modalField('plannedStartAt').fill(today + 'T23:50');
    await modalField('plannedEndAt').fill(selected + 'T00:00');
    await page.locator('[data-action="block-date-shift"][data-days="1"]').click();
    assert.equal(await modalField('plannedEndAt').inputValue(), '2026-09-08T00:00', 'date shift retains next-day midnight');
    await modalField('date').fill(today);
    await modalField('plannedStartAt').fill(''); await modalField('plannedEndAt').fill('');
    await modalField('actualStartAt').fill(today + 'T10:00');
    await modalField('actualEndAt').fill(today + 'T10:25');
    await modalField('completed').check();
    await modalField('outcome').selectOption('done');
    await modalField('resultNote').fill('架空の終了結果');
    await page.locator('[data-action="toggle-task-complete"]').click();
    assert.equal(await detailState(), detailBefore, 'Task completion remains in the draft');
    await page.evaluate(() => {
      window.detailSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'taskchute-journal-pwa-state-v1') throw new DOMException('fixture quota', 'QuotaExceededError');
        return window.detailSetItem.call(this, key, value);
      };
    });
    await page.locator('#modalRoot [data-action="modal-save"]').click();
    assert.equal(await detailState(), detailBefore, 'failure rolls back Block, Task and report together');
    assert.equal(await modalField('resultNote').inputValue(), '架空の終了結果');
    await page.evaluate(() => { Storage.prototype.setItem = window.detailSetItem; });
    await page.locator('#modalRoot [data-action="modal-save"]').click();
    const [savedBlock, savedLinked, declarations] = JSON.parse(await detailState());
    assert.equal(savedLinked.status, 'completed'); assert.equal(savedLinked.order, 123);
    assert.equal(savedBlock.actualEndAt, today + 'T10:25:00'); assert.equal(savedBlock.completed, true);
    assert.equal(savedBlock.plannedStartAt, ''); assert.equal(savedBlock.plannedEndAt, '');
    assert.equal(savedBlock.retained, 'keep'); assert.equal(savedBlock.externalRef, 'fixture-reference');
    assert.equal(savedBlock.source, 'fixture'); assert.equal(savedBlock.comment, '既存メモ\n架空の終了結果');
    assert.equal(declarations.filter(d => d.blockId === 'detail-block' && d.resultNote === '架空の終了結果').length, 1);
    if (await page.locator('[data-action="body-scan-discard"]').count()) await page.locator('[data-action="body-scan-discard"]').first().click();
    console.log('PASS S3-05: permanent completion, unscheduled times, atomic failure/retry, retained metadata and end result');
    // S3-07: date ownership, IME, storage failure, navigation and archived protection.
    await page.clock.install({ time: new Date(2026, 8, 6, 10, 30) });
    const navJournal = async view => {
      await page.locator('#sidebar [data-action="nav"][data-view="' + view + '"]').click();
      await page.locator('#app[data-view="' + view + '"]').waitFor();
    };
    await navJournal('today');
    const journalInput = page.locator('#towerJournalFree');
    const journalValue = date => page.evaluate(async date => (await import('/src/state/store.js')).state.journals[date], date);
    await journalInput.fill('自動保存の架空本文'); await page.clock.runFor(650);
    assert.equal(await journalValue(today), '自動保存の架空本文');
    assert.equal(await page.locator('[data-journal-save-status]').textContent(), '端末に保存しました');
    await journalInput.dispatchEvent('compositionstart'); await journalInput.fill('日本語変換中の架空本文');
    await page.clock.runFor(1000); assert.equal(await journalValue(today), '自動保存の架空本文');
    await journalInput.dispatchEvent('compositionend'); assert.equal(await journalValue(today), '日本語変換中の架空本文');
    await page.evaluate(() => {
      window.journalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'taskchute-journal-pwa-state-v1') throw new DOMException('fixture quota', 'QuotaExceededError');
        return window.journalSetItem.call(this, key, value);
      };
    });
    await journalInput.fill('保存失敗でも残る日付別の本文'); await page.clock.runFor(650);
    assert.equal(await journalValue(today), '日本語変換中の架空本文');
    assert.equal(await journalInput.inputValue(), '保存失敗でも残る日付別の本文');
    assert((await page.locator('[data-journal-save-status]').textContent()).includes('入力は残しています'));
    await navJournal('exec'); await navJournal('today');
    assert.equal(await journalInput.inputValue(), '保存失敗でも残る日付別の本文');
    await page.evaluate(() => { Storage.prototype.setItem = window.journalSetItem; });
    await page.locator('[data-action="save-tower-journal"]').click();
    assert.equal(await journalValue(today), '保存失敗でも残る日付別の本文');
    await journalInput.fill('日跨ぎ直前の本文');
    await page.clock.setSystemTime(new Date(2026, 8, 7, 0, 0));
    await page.clock.setFixedTime(new Date(2026, 8, 7, 0, 0)); await page.clock.runFor(1000);
    assert.equal(await journalValue(today), '日跨ぎ直前の本文');
    assert.notEqual(await journalValue(selected), '日跨ぎ直前の本文');
    await page.evaluate(async date => { (await import('/src/state/store.js')).state.archivedDates.push(date); }, selected);
    await navJournal('exec'); await navJournal('today');
    console.log('S3-07 archive state', await page.evaluate(async () => ({ now: new Date().toISOString(), date: document.querySelector('#towerJournalFree').dataset.towerJournalDate, archived: (await import('/src/state/store.js')).state.archivedDates })));
    assert(await journalInput.evaluate(el => el.readOnly));
    assert(await page.locator('[data-action="save-tower-journal"]').isDisabled());
    console.log('PASS S3-07: debounce, IME commit, storage failure, draft restoration, retry, day ownership and archived readonly');
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
    for (const selector of ['#towerClock', '#towerDayLeft', '.life-band', '.so-row', '.tower-runway', '[data-work-list="today"]', '#towerFlightLog', '#towerGateStrip', '#towerJournalFree', '.today-pomodoro', '.tower-mit'])
      assert.equal(await root.locator(selector).count(), 1, 'permanent: ' + selector);
    assert.equal(await root.locator('.sec-bm,.tower-condition').count(), 0);
    assert.equal(await root.locator('#towerDate').textContent(), today + ' (日)');
    assert(await root.locator('header.daily-today-clock').isVisible());
    assert.equal(await root.locator('header.daily-today-clock').getAttribute('aria-label'), '今日の時計');
    assert.match(await root.locator('#towerDayLeft').locator('..').textContent(), /^本日残り /);
    const jumps = root.getByRole('navigation', { name: '今日の移動' });
    assert(await jumps.getByRole('button', { name: '予定へ', exact: true }).isVisible());
    assert(await jumps.getByRole('button', { name: '記録へ', exact: true }).isVisible());
    assert(await root.getByRole('region', { name: '今日の予定', exact: true }).isVisible());
    console.log('PASS fixSL2A4: weekday, remaining label, navigation labels and section labels');
    // 誕生日の補完は app.js の所有=レーン1の別発注 fixSB2x で扱う(CHANGELOG 17:20)。
    assert((await root.locator('#towerDate').textContent()).includes(today));
    const journal = root.locator('#towerJournalFree');
    await journal.fill('今日の入力を時計更新後も保つ');
    await journal.evaluate(el => { window.dailyJournalNode = el; window.dailyOrder = [...el.closest('[data-daily-view]').children]; });
    await page.clock.runFor(2000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.runFor(1000);
    assert(await journal.evaluate(el => el === window.dailyJournalNode && el.value === '今日の入力を時計更新後も保つ' && window.dailyOrder.every((node, i) => node === el.closest('[data-daily-view]').children[i])));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('taskchute-journal-today-focus-v1')).sections.life), false);
    await root.locator('[data-action="save-tower-journal"]').click();
    assert.equal(await page.evaluate(async date => (await import('/src/state/store.js')).state.journals[date], today), '今日の入力を時計更新後も保つ');
    for (const check of dailyLayoutChecks) await check(page, root);
    console.log('PASS S3-06: eight permanent sections, actual clock, retained settings/journal DOM, explicit save');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); }
});

// S3-08: Japanese subtitles retain their full rendered contents.
dailyLayoutChecks.push(async (page, root) => {
  assert(await root.locator('.so-item small').evaluateAll(nodes => {
    const expected = ['決めた一つを100%やり切る', '実行率より、進んだ量', '朝は集中、夜は充電'];
    return nodes.length === 3 && nodes.every((el, i) => el.textContent === expected[i] && el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1 && getComputedStyle(el).textOverflow !== 'ellipsis');
  }), 'three Japanese creed subtitles are displayed without clipping');
  console.log('PASS S3-08: Japanese subtitles without clipping');
});

// S3-09: measure the unmodified production parents in all four views.
dailyLayoutChecks.push(async page => {
  const measurements = [], measurementFailures = [];
  const action = (name, id = '') => page.evaluate(({ name, id }) => {
    const button = document.createElement('button'); button.dataset.action = name; button.dataset.id = id;
    document.body.append(button); button.click(); button.remove();
  }, { name, id });
  const measure = async (view, width, count, zoom) => {
    assert.equal(await page.locator('[data-daily-view="' + view + '"]').count(), 1, view + ' production parent');
    const result = await page.evaluate(view => {
      const root = document.querySelector('[data-daily-view="' + view + '"]');
      const selectors = view === 'today' ? ['.life-band', '.so-row', '.tower-runway', '#dailyTodayPlans', '.daily-today-records', '.tower-journal', '.today-pomodoro', '.tower-mit']
        : view === 'wbs' ? ['.wbs-project-list', '.wbs-project-detail']
        : view === 'exec' ? (root.querySelector('.exec-two-pane') ? ['.exec-pane-left', '.exec-pane-right'] : ['.timeline-tower', '[data-work-list="exec"]', '[data-work-list="exec-candidates"]']) : ['.detail-column'];
      const regions = [...new Set(selectors.flatMap(s => [...root.querySelectorAll(s)]))].map(el => {
        const r = el.getBoundingClientRect(); return { name: el.className || el.id, x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      });
      const overlaps = [];
      for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) {
        const a = regions[i], b = regions[j];
        if (a.name.includes('daily-today-records') || b.name.includes('daily-today-records')) continue;
        if ([a, b].some(r => r.name.includes('tower-runway')) && [a, b].some(r => /today-pomodoro|tower-mit/.test(r.name))) continue;
        if (Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1) overlaps.push([a.name, b.name]);
      }
      const inputs = [...root.querySelectorAll('input:not([type="hidden"]),select,textarea')];
      const buttons = [...root.querySelectorAll('button')].filter(el => el.getBoundingClientRect().height > 0);
      const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
      const layout = root.querySelector(({ today: '.daily-today-main', exec: '.exec-two-pane', wbs: '.wbs-projects', detail: '.detail-columns' })[view]) || root;
      const style = getComputedStyle(layout);
      return { view, regions, overlaps, rootWidth: root.getBoundingClientRect().width,
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        minInput: inputs.length ? Math.min(...inputs.map(el => parseFloat(getComputedStyle(el).fontSize))) : null,
        minButton: buttons.length ? Math.min(...buttons.map(el => el.getBoundingClientRect().height)) : null,
        duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i),
        columns: style.display === 'grid' ? style.gridTemplateColumns.split(' ').length : 1 };
    }, view);
    measurements.push({ width, count, zoom, ...result });
    console.log('SL2A_MEASURE ' + JSON.stringify(measurements.at(-1)));
    try {
    assert(result.regions.length > 0, view + ' must have measured regions');
    assert(result.regions.every(region => region.width > 0 && region.height > 0), view + ' visible measured regions');
    // 監督者の契約追随(2026-09-12 CHANGELOG 19:05): 詳細の共通枠は 1024px 以上で2列(fixSB1b 09:20・fixSB2c 17:47 と同じ境界。設計06 §7 は 1280=2列・390=1列で 1024 は未規定→既存 .detail-columns の境界に揃える)。今日は 1280 以上で2列。
    const twoColumns = view === 'exec' || view === 'detail' ? width >= 1024 : width >= 1280;
    assert.equal(result.columns, twoColumns ? 2 : 1, view + ' column count');
    const leftOf = (a, b) => assert(a.right <= b.x + 1 && Math.abs(a.y - b.y) <= 1, view + ' left/right placement');
    const above = (a, b) => assert(a.bottom <= b.y + 1 && Math.abs(a.x - b.x) <= 1, view + ' vertical placement');
    if (view === 'today') {
      assert.equal(result.regions.length, 8, 'Today required regions');
      const [life, creed, current, plans, records, journal, timer, mit] = result.regions;
      for (const region of [timer, mit]) assert(region.x >= current.x && region.right <= current.right + 1 && region.y >= current.y && region.bottom <= current.bottom + 1, "current-work child inside region");
      if (twoColumns) { leftOf(life, creed); leftOf(plans, records); }
      else { above(life, creed); above(creed, current); above(current, plans); above(plans, records); }
      assert(journal.y >= records.y && journal.bottom <= records.bottom + 1, 'journal inside records');
    } else if (view === 'exec') {
      assert.equal(result.regions.length, twoColumns ? 2 : 3, 'execution required regions');
      if (twoColumns) leftOf(result.regions[0], result.regions[1]);
      else { above(result.regions[0], result.regions[1]); above(result.regions[1], result.regions[2]); }
    } else {
      assert.equal(result.regions.length, 2, view + ' required regions');
      if (twoColumns) leftOf(...result.regions); else above(...result.regions);
    }
    assert.equal(result.overflow, 0, view + ' page overflow at ' + width + '/' + count + '/' + zoom);
    assert.deepEqual(result.overlaps, [], view + ' region overlap');
    assert.deepEqual(result.duplicateIds, [], view + ' unique IDs');
    assert(result.minInput === null || result.minInput >= 16, view + ' native input size');
    if (view === 'today') {
      assert.equal(result.columns, width >= 1280 ? 2 : 1);
      if (width >= 1280) assert(Math.abs(result.regions[0].height - result.regions[1].height) < 1, 'equal value panels');
      assert(result.minButton >= 44, 'Today main actions at least 44px');
    }
    } catch (error) { measurementFailures.push({ view, width, count, zoom, message: error.message }); }
  };
  for (const count of [0, 300]) {
    await page.evaluate(async ({ count, today }) => {
      const { state } = await import('/src/state/store.js');
      state.projects = [{ id: 'layout-project', title: '長いプロジェクト名'.repeat(12), status: 'active' }];
      state.tasks = Array.from({ length: count }, (_, i) => ({ id: 'layout-task-' + i, title: '長い作業名ABCDEFGHIJ'.repeat(12) + i, projectId: 'layout-project', status: 'todo', kind: 'task' }));
      state.blocks = state.tasks.map((task, i) => ({ id: 'layout-block-' + i, taskId: task.id, title: task.title, date: today, category: '作業', estimateMin: 5,
        plannedStartAt: today + 'T' + String(4 + Math.floor((i % 200) / 12)).padStart(2, '0') + ':' + String(i % 12 * 5).padStart(2, '0') }));
      state.selectedDate = today;
    }, { count, today });
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('[data-action="nav"][data-view="today"]:visible').first().click();
      for (const zoom of [100, 200]) {
        await page.evaluate(zoom => { document.documentElement.style.fontSize = zoom + '%'; }, zoom);
        await measure('today', width, count, zoom);
      }
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      await page.locator('[data-action="nav"][data-view="exec"]:visible').first().click();
      await page.locator('.timeline-tower').waitFor();
      for (const zoom of [100, 200]) {
        await page.evaluate(zoom => { document.documentElement.style.fontSize = zoom + '%'; }, zoom);
        await measure('exec', width, count, zoom);
      }
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      await page.locator('[data-action="nav"][data-view="wbs"]:visible').first().click();
      await page.locator('[data-action="wbs-select-project"][data-id="layout-project"]').click();
      for (const zoom of [100, 200]) {
        await page.evaluate(zoom => { document.documentElement.style.fontSize = zoom + '%'; }, zoom);
        await measure('wbs', width, count, zoom);
      }
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      await action(count ? 'edit-task' : 'add-task-to-project', count ? 'layout-task-0' : 'layout-project');
      await page.locator('.task-modal').evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)); });
      for (const zoom of [100, 200]) {
        await page.evaluate(zoom => { document.documentElement.style.fontSize = zoom + '%'; }, zoom);
        await measure('detail', width, count, zoom);
      }
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      await page.locator('.task-modal [data-action="modal-close"]').last().click();
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(async () => {
    const { state } = await import('/src/state/store.js'); state.blocks = state.blocks.slice(0, 4);
    state.blocks.forEach((block, i) => { block.title = '画面内の予定 ' + i; });
    state.tasks = state.tasks.slice(0, 4); state.tasks.forEach((task, i) => { task.title = '画面内の予定 ' + i; });
  });
  await page.locator('[data-action="nav"][data-view="today"]:visible').first().click();
  await page.locator('[data-daily-view="today"]').evaluate(el => { el.scrollIntoView({ block: 'start' }); });
  const fold = await page.evaluate(() => ({ plans: [...document.querySelectorAll('#dailyTodayPlans [data-work-key]')].map(el => el.getBoundingClientRect().bottom), journalTop: document.querySelector('#towerJournalFree').getBoundingClientRect().top, height: innerHeight }));
  console.log('SL2A_FOLD ' + JSON.stringify(fold));
  assert.equal(fold.plans.length, 4); assert(fold.plans.every(bottom => bottom <= fold.height) && fold.journalTop < fold.height, 'four plans and journal visible at 1440x1000');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-action="today-plans-jump"]').click();
  const firstPlan = page.locator('#dailyTodayPlans [data-action="edit-block"]').first();
  assert(await firstPlan.evaluate(el => el === document.activeElement && el.getBoundingClientRect().top >= 0 && el.getBoundingClientRect().bottom <= innerHeight));
  await firstPlan.click(); await page.locator('#modalRoot [data-action="modal-save"]').waitFor();
  await page.locator('#modalRoot [data-action="modal-close"]').last().click();
  for (const theme of ['light', 'dark', 'cockpit']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const paint = await page.locator('.daily-today-values .tower-glass-panel').first().evaluate(el => ({ background: getComputedStyle(el).backgroundColor, blur: getComputedStyle(el).backdropFilter }));
    console.log('SL2A_THEME ' + JSON.stringify({ theme, ...paint }));
    assert.notEqual(paint.background, 'rgb(255, 255, 255)', 'glass paint is inherited');
  }
  assert.equal(measurements.length, 80, 'all configurations measured');
  assert.deepEqual(measurementFailures, [], 'all measured configurations satisfy the same assertions');
  console.log('PASS S3-09: 80 measured configurations, 200% root font simulation, long names, empty/300 items, fold and jump');
});
