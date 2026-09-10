const assert = require('node:assert/strict');
const { chromium, launchOptions, startServer, randomPort, STATE_KEY } = require('./helpers');

(async () => {
  const server = startServer(randomPort()); let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const page = await browser.newPage({ viewport: { width: 1280, height: 844 },
      timezoneId: 'Asia/Tokyo', locale: 'ja-JP', serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    await page.clock.setFixedTime(new Date(2026, 8, 10, 23, 55));
    await page.goto('http://localhost:' + server.address().port + '/');
    await page.evaluate(key => {
      const s = JSON.parse(localStorage.getItem(key));
      Object.assign(s.settings.github, { token: 'fixture-token', dataOwner: 'fixture-owner', dataRepo: 'fixture-repo', autoSave: false });
      s.settings.autoSync = false; s.settings.lastOpenedDate = '2026-09-10';
      s.projects = [{ id: 'p', title: '検査Project', kind: 'project', status: 'active' }];
      s.tasks = ['a', 'b', 'c'].map(id => ({ id, title: '時刻なし検査 ' + id, projectId: 'p', status: 'todo', estimateMin: 25 }));
      s.blocks = [{ id: 'prior', taskId: 'a', date: '2026-09-09', title: '既存実績',
        plannedStartAt: '', plannedEndAt: '', actualStartAt: '2026-09-09T10:00', actualEndAt: '2026-09-09T10:20', completed: true }];
      s.recurrences = []; s.currentView = 'wbs';
      localStorage.setItem(key, JSON.stringify(s));
    }, STATE_KEY);
    await page.reload();
    // Normalize the automatically created fallback Task before capturing the baseline.
    await page.reload();
    const state = () => page.evaluate(async () => JSON.parse(JSON.stringify((await import('/src/state/store.js')).state)));
    const nav = async view => {
      await page.locator(`#sidebar [data-view="${view}"]:visible, #bottomNav [data-view="${view}"]:visible`).first().click();
    };
    const browse = async () => {
      await nav('exec');
      await page.locator('[data-date-picker]').fill('2026-09-09');
      await page.waitForFunction(async () => (await import('/src/state/store.js')).state.selectedDate === '2026-09-09');
      await nav('wbs');
    };
    const open = async id => {
      await page.locator(`[data-work-list="wbs"] [data-action="placement-add-today"][data-id="${id}"]`).click();
      await page.locator('.placement-form').waitFor();
      await page.locator('#modalRoot').evaluate(async root => {
        await Promise.all(root.getAnimations({ subtree: true }).map(animation => animation.finished));
      });
    };
    const confirm = () => page.locator('.modal-footer [data-action="modal-save"]').click();
    const request = id => page.evaluate(id => {
      const key = Object.keys(sessionStorage).find(key => key.startsWith('taskchute-journal-placement-v1:') && JSON.parse(sessionStorage.getItem(key)).block.taskId === id);
      return JSON.parse(sessionStorage.getItem(key));
    }, id);
    await browse();
    const before = await state();
    await open('a');
    assert.match(await page.locator('#modalRoot').textContent(), /今日の予定を追加/);
    assert.equal(await page.locator('.placement-form strong').textContent(), '2026-09-10');
    assert.equal(await page.locator('#placement-time, #placement-duration').count(), 0);
    const saveBox = await page.locator('.modal-footer [data-action="modal-save"]').boundingBox();
    assert(saveBox && saveBox.height >= 44 && saveBox.y + saveBox.height <= 844);
    const firstRequest = await request('a');
    assert.equal(firstRequest.requestId, firstRequest.block.id);
    assert.equal(firstRequest.block.date, '2026-09-10');
    assert.equal(firstRequest.block.plannedStartAt, '');
    assert.equal(firstRequest.block.plannedEndAt, '');
    await page.evaluate(key => {
      window.fixtureSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, value) {
        if (this === localStorage && k === key) throw new DOMException('fixture quota', 'QuotaExceededError');
        return window.fixtureSetItem.call(this, k, value);
      };
    }, STATE_KEY);
    await confirm();
    assert.match(await page.locator('#placement-error').textContent(), /保存に失敗/);
    assert.deepEqual((await state()).blocks, before.blocks, 'failure leaves all Blocks intact');
    assert.deepEqual((await state()).tasks, before.tasks, 'failure leaves Tasks intact');
    assert.equal((await request('a')).block.id, firstRequest.block.id);
    await page.evaluate(() => { Storage.prototype.setItem = window.fixtureSetItem; });
    await page.reload();
    assert.equal((await state()).blocks.some(block => block.id === firstRequest.block.id), false, 'reload never auto-sends');
    await browse(); await open('a');
    assert.equal((await request('a')).block.id, firstRequest.block.id, 'same-tab explicit retry restores request');
    await confirm();
    let saved = await state();
    const added = saved.blocks.find(block => block.id === firstRequest.block.id);
    assert(added);
    assert.equal(added.date, '2026-09-10');
    for (const field of ['plannedStartAt', 'plannedEndAt', 'actualStartAt', 'actualEndAt']) assert.equal(added[field], '');
    assert.equal(added.completed, false);
    assert.equal(saved.currentView, 'wbs'); assert.equal(saved.selectedDate, '2026-09-09');
    assert.deepEqual(saved.tasks, before.tasks); assert.deepEqual(saved.blocks[0], before.blocks[0]);
    assert(added.updatedAt); assert.notEqual(saved.dataModifiedAt, before.dataModifiedAt);
    const replay = await page.evaluate(async request => {
      const { state } = await import('/src/state/store.js');
      const { commitPlacement } = await import('/src/features/placement.js');
      const stamp = state.dataModifiedAt;
      const input = { request, today: '2026-09-10', connection: request.connection };
      let writes = 0;
      const ok = commitPlacement(state, input, { now: '2026-09-10T23:55:00', persist: () => { writes++; return true; } });
      return { ok, writes, unchanged: stamp === state.dataModifiedAt, count: state.blocks.filter(b => b.id === request.block.id).length };
    }, await request('a'));
    assert.deepEqual(replay, { ok: true, writes: 0, unchanged: true, count: 1 });
    await page.locator('[data-work-list="wbs"] [data-action="placement-add-today"][data-id="a"]').click();
    assert.equal((await state()).modal.id, added.id, 'reopen selects saved result');
    assert.equal((await state()).blocks.filter(b => b.id === added.id).length, 1);
    await page.locator('[data-action="placement-return"]').click();
    assert.equal((await state()).selectedDate, '2026-09-09');
    await open('c');
    await page.locator('.modal-footer [data-action="modal-close"]').click();
    assert.equal((await state()).modal, null);
    assert.equal((await state()).blocks.some(b => b.taskId === 'c'), false, 'cancel creates none');
    console.log('PASS 22: yesterday browsing / untimed / failure / same-tab restore / same-id replay');

    await open('b');
    const midnightRequest = await request('b');
    await page.clock.setFixedTime(new Date(2026, 8, 11, 0, 1));
    await confirm();
    assert.match(await page.locator('#placement-error').textContent(), /2026-09-11/);
    assert.equal((await state()).blocks.some(b => b.taskId === 'b'), false);
    assert.equal((await request('b')).block.id, midnightRequest.block.id);
    await confirm();
    saved = await state();
    assert.equal(saved.blocks.find(b => b.id === midnightRequest.block.id).date, '2026-09-11');
    assert.equal(saved.selectedDate, '2026-09-09');
    await open('c');
    await page.evaluate(async () => { (await import('/src/state/store.js')).state.tasks.find(t => t.id === 'c').status = 'completed'; });
    await confirm();
    assert.match(await page.locator('#placement-error').textContent(), /日付が変わりました/);
    assert.equal((await state()).blocks.some(b => b.taskId === 'c'), false);
    await confirm();
    assert.match(await page.locator('#placement-error').textContent(), /完了済み/);
    assert.equal((await state()).blocks.some(b => b.taskId === 'c'), false);
    const rejected = await page.evaluate(async request => {
      const { state } = await import('/src/state/store.js');
      const { commitPlacement } = await import('/src/features/placement.js');
      const deps = { now: '2026-09-11T00:01:00', persist: () => { throw Error('invalid request must not persist'); } };
      state.blocks.find(b => b.id === request.block.id).deleted = true;
      const candidate = { request, today: '2026-09-11', connection: request.connection };
      const ok = commitPlacement(state, candidate, deps);
      return { ok, error: candidate.error, deleted: state.blocks.find(b => b.id === request.block.id).deleted };
    }, firstRequest);
    assert.equal(rejected.ok, false); assert.match(rejected.error, /削除済み/); assert.equal(rejected.deleted, true);
    assert.deepEqual(errors, []);
    console.log('PASS 22: midnight reconfirmation / completed Task rejection / deleted request never resurrects');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
