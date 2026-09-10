const assert = require('node:assert/strict');
const { chromium, launchOptions, startServer, randomPort, STATE_KEY, defaultContextOptions } = require('./helpers');

(async () => {
  const server = startServer(randomPort()); let browser;
  try {
    browser = await chromium.launch(launchOptions());
    let context, page;
    const errors = [];
    const anchor = new Date();
    const timeAt = (offset, hour, minute = 0) => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + offset, hour, minute);
    const dateAt = offset => {
      const date = timeAt(offset, 12);
      return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    };
    const fixtureDates = { yesterday: dateAt(-1), today: dateAt(0), tomorrow: dateAt(1), continuous: dateAt(2) };
    async function startScenario(name, { continuous = false } = {}) {
      if (context) await context.close();
      context = await browser.newContext({ ...defaultContextOptions(), viewport: { width: 1280, height: 844 },
        locale: 'ja-JP', serviceWorkers: 'block', reducedMotion: 'reduce' });
      page = await context.newPage();
      page.on('pageerror', error => errors.push(name + ': ' + error.message));
      await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
      const time = continuous ? timeAt(2, 12) : timeAt(0, 23, 55);
      await page.clock.install({ time });
      // Freeze timers too: the 500ms daily-open ticker otherwise changes selectedDate
      // after setFixedTime crosses midnight, racing the placement-only assertions.
      await page.clock.pauseAt(time);
      await page.addInitScript(dates => { window.fixtureDates = dates; }, fixtureDates);
      await page.goto('http://localhost:' + server.address().port + '/');
      await page.evaluate(({ key, continuous }) => {
        const s = JSON.parse(localStorage.getItem(key));
        Object.assign(s.settings.github, { token: 'fixture-token', dataOwner: 'fixture-owner', dataRepo: 'fixture-repo', autoSave: false });
        s.settings.autoSync = false;
        s.settings.lastOpenedDate = continuous ? fixtureDates.continuous : fixtureDates.today;
        s.selectedDate = fixtureDates.yesterday; s.modal = null;
        s.projects = [{ id: 'p', title: '検査Project', kind: 'project', status: 'active' }];
        s.tasks = continuous
          ? Array.from({ length: 30 }, (_, i) => ({ id: 'continuous-' + i, title: '連続追加 ' + String(i).padStart(2, '0'), projectId: 'p', status: 'todo' }))
          : ['a', 'b', 'c', 'edited', 'overnight'].map(id => ({ id, title: '時刻なし検査 ' + id, projectId: 'p', status: 'todo', estimateMin: 25 }));
        s.blocks = continuous ? [] : [{ id: 'prior', taskId: 'a', date: fixtureDates.yesterday, title: '既存実績',
          plannedStartAt: '', plannedEndAt: '', actualStartAt: fixtureDates.yesterday + 'T10:00', actualEndAt: fixtureDates.yesterday + 'T10:20', completed: true }];
        s.recurrences = []; s.currentView = 'wbs';
        sessionStorage.clear();
        localStorage.setItem(key, JSON.stringify(s));
      }, { key: STATE_KEY, continuous });
      await page.reload();
      // Normalize the automatically created fallback Task before capturing the baseline.
      await page.reload();
      await browse();
      const initial = await state();
      assert.equal(initial.settings.lastOpenedDate, continuous ? fixtureDates.continuous : fixtureDates.today);
      assert.equal(initial.selectedDate, fixtureDates.yesterday);
      assert.equal(initial.modal, null);
      assert.equal(await page.evaluate(() => sessionStorage.length), 0);
      console.log('SCENARIO ' + name);
    }
    const state = () => page.evaluate(async () => JSON.parse(JSON.stringify((await import('/src/state/store.js')).state)));
    const nav = async view => {
      await page.locator(`#sidebar [data-view="${view}"]:visible, #bottomNav [data-view="${view}"]:visible`).first().click();
    };
    const browse = async () => {
      await nav('exec');
      await page.locator('[data-date-picker]').fill(fixtureDates.yesterday);
      await page.waitForFunction(async () => (await import('/src/state/store.js')).state.selectedDate === fixtureDates.yesterday);
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
    const reopenFailures = [];
    for (const id of ['edited', 'overnight']) {
      await startScenario(id);
      await open(id);
      const oldRequest = await request(id);
      await page.locator('.modal-footer [data-action="modal-close"]').click();
      if (id === 'edited') {
        await page.evaluate(async () => {
          (await import('/src/state/store.js')).state.tasks.find(t => t.id === 'edited').title = '????Task';
        });
      } else {
        await page.clock.setFixedTime(timeAt(1, 0, 1));
        await page.reload(); await browse(); // Restore the previous day's request from sessionStorage.
      }
      await open(id);
      try {
        const fresh = await request(id);
        const today = id === 'edited' ? fixtureDates.today : fixtureDates.tomorrow;
        assert.notEqual(fresh.requestId, oldRequest.requestId, id + ': reopening allocates a new request');
        if (id === 'edited') {
          assert.notEqual(fresh.baseFingerprint, oldRequest.baseFingerprint);
          assert.equal(fresh.block.title, '????Task');
        }
        assert.equal(await page.locator('.placement-form strong').textContent(), today);
        assert.equal(fresh.block.date, today);
        await confirm();
        const blocks = (await state()).blocks.filter(b => b.taskId === id);
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].id, fresh.requestId);
        assert.equal(blocks[0].date, today);
        console.log('PASS fixL22: ' + id);
      } catch (error) {
        console.error('FAIL fixL22: ' + id, error);
        reopenFailures.push(id);
        await page.locator('.modal-footer [data-action="modal-close"]').click();
      }
    }
    assert.deepEqual(reopenFailures, [], 'both stale-request reopening cases pass');
    await startScenario('save failure and same-tab restore');
    const before = await state();
    await open('a');
    assert.match(await page.locator('#modalRoot').textContent(), /今日の予定を追加/);
    assert.equal(await page.locator('.placement-form strong').textContent(), fixtureDates.today);
    assert.equal(await page.locator('#placement-time, #placement-duration').count(), 0);
    const saveBox = await page.locator('.modal-footer [data-action="modal-save"]').boundingBox();
    assert(saveBox && saveBox.height >= 44 && saveBox.y + saveBox.height <= 844);
    const firstRequest = await request('a');
    assert.equal(firstRequest.requestId, firstRequest.block.id);
    assert.equal(firstRequest.block.date, fixtureDates.today);
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
    assert.equal(added.date, fixtureDates.today);
    for (const field of ['plannedStartAt', 'plannedEndAt', 'actualStartAt', 'actualEndAt']) assert.equal(added[field], '');
    assert.equal(added.completed, false);
    assert.equal(saved.currentView, 'wbs'); assert.equal(saved.selectedDate, fixtureDates.yesterday);
    assert.deepEqual(saved.tasks, before.tasks); assert.deepEqual(saved.blocks[0], before.blocks[0]);
    assert(added.updatedAt); assert.notEqual(saved.dataModifiedAt, before.dataModifiedAt);
    const replay = await page.evaluate(async request => {
      const { state } = await import('/src/state/store.js');
      const { commitPlacement } = await import('/src/features/placement.js');
      const stamp = state.dataModifiedAt;
      const input = { request, today: fixtureDates.today, connection: request.connection };
      let writes = 0;
      const ok = commitPlacement(state, input, { now: fixtureDates.today + 'T23:55:00', persist: () => { writes++; return true; } });
      return { ok, writes, unchanged: stamp === state.dataModifiedAt, count: state.blocks.filter(b => b.id === request.block.id).length };
    }, await request('a'));
    assert.deepEqual(replay, { ok: true, writes: 0, unchanged: true, count: 1 });
    await page.locator('[data-work-list="wbs"] [data-action="placement-add-today"][data-id="a"]').click();
    assert.equal((await state()).modal.id, added.id, 'reopen selects saved result');
    assert.equal((await state()).blocks.filter(b => b.id === added.id).length, 1);
    await page.locator('[data-action="placement-return"]').click();
    assert.equal((await state()).selectedDate, fixtureDates.yesterday);
    await startScenario('cancel');
    await open('c');
    await page.locator('.modal-footer [data-action="modal-close"]').click();
    assert.equal((await state()).modal, null);
    assert.equal((await state()).blocks.some(b => b.taskId === 'c'), false, 'cancel creates none');
    console.log('PASS 22: yesterday browsing / untimed / failure / same-tab restore / same-id replay');

    await startScenario('midnight reconfirmation');
    await open('b');
    const midnightRequest = await request('b');
    await page.clock.setFixedTime(timeAt(1, 0, 1));
    await confirm();
    assert.match(await page.locator('#placement-error').textContent(), new RegExp(fixtureDates.tomorrow));
    assert.equal((await state()).blocks.some(b => b.taskId === 'b'), false);
    assert.equal((await request('b')).block.id, midnightRequest.block.id);
    await confirm();
    saved = await state();
    assert.equal(saved.blocks.find(b => b.id === midnightRequest.block.id).date, fixtureDates.tomorrow);
    assert.equal(saved.selectedDate, fixtureDates.yesterday);
    await startScenario('cancelled request and completed Task at midnight');
    await open('c');
    await page.locator('.modal-footer [data-action="modal-close"]').click();
    await open('c');
    await page.clock.setFixedTime(timeAt(1, 0, 1));
    await page.evaluate(async () => { (await import('/src/state/store.js')).state.tasks.find(t => t.id === 'c').status = 'completed'; });
    await confirm();
    assert.match(await page.locator('#placement-error').textContent(), /日付が変わりました/);
    assert.equal((await state()).blocks.some(b => b.taskId === 'c'), false);
    await confirm();
    assert.match(await page.locator('#placement-error').textContent(), /完了済み/);
    assert.equal((await state()).blocks.some(b => b.taskId === 'c'), false);
    await startScenario('deleted request never resurrects');
    await open('a');
    const deletedRequest = await request('a');
    await confirm();
    const rejected = await page.evaluate(async request => {
      const { state } = await import('/src/state/store.js');
      const { commitPlacement } = await import('/src/features/placement.js');
      const deps = { now: fixtureDates.today + 'T23:55:00', persist: () => { throw Error('invalid request must not persist'); } };
      state.blocks.find(b => b.id === request.block.id).deleted = true;
      const candidate = { request, today: fixtureDates.today, connection: request.connection };
      const ok = commitPlacement(state, candidate, deps);
      return { ok, error: candidate.error, deleted: state.blocks.find(b => b.id === request.block.id).deleted };
    }, deletedRequest);
    assert.equal(rejected.ok, false); assert.match(rejected.error, /削除済み/); assert.equal(rejected.deleted, true);
    assert.deepEqual(errors, []);
    console.log('PASS 22: midnight reconfirmation / completed Task rejection / deleted request never resurrects');

    await startScenario('continuous additions, extras and rendering', { continuous: true });
    const query = page.locator('[data-work-list="wbs"] [data-work-filter="query"]');
    await query.fill('連続追加');
    await query.evaluate(input => { input.setSelectionRange(1, 3); window.continuousQuery = input; });
    const position = () => page.evaluate(() => {
      const input = document.querySelector('[data-work-list="wbs"] [data-work-filter="query"]');
      return { sameInput: input === window.continuousQuery, query: input.value,
        start: input.selectionStart, end: input.selectionEnd,
        scroll: document.querySelector('[data-work-list="wbs"] [data-work-list-rows]').scrollTop };
    });
    await open('continuous-8');
    const firstPosition = await position();
    assert(firstPosition.scroll > 0, 'fixture exercises scrolled list');
    const continuousFirst = await request('continuous-8');
    await confirm();
    assert.deepEqual(await position(), firstPosition, 'first save keeps input node, selection and scroll');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'continuous-8', 'focus returns to originating row');
    assert.equal((await state()).currentView, 'wbs');
    assert.equal((await state()).selectedDate, fixtureDates.yesterday);
    assert.equal(await page.locator('[data-work-list="wbs"] [data-action="placement-add-today"][data-id="continuous-8"]').textContent(), '予定を見る');
    const firstSaved = (await state()).blocks.find(b => b.id === continuousFirst.block.id);
    const persistedFirst = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).blocks, STATE_KEY);
    assert.deepEqual(persistedFirst, [firstSaved]);

    await open('continuous-9');
    const secondPosition = await position(), secondRequest = await request('continuous-9');
    await page.evaluate(key => {
      window.fixtureSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, value) {
        if (this === localStorage && k === key) throw new DOMException('second save fixture', 'QuotaExceededError');
        return window.fixtureSetItem.call(this, k, value);
      };
    }, STATE_KEY);
    await confirm();
    assert.match(await page.locator('#placement-error').textContent(), /保存に失敗/);
    assert.deepEqual((await state()).blocks, [firstSaved], 'second failure retains first success exactly');
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).blocks, STATE_KEY), persistedFirst);
    assert.deepEqual(await position(), secondPosition, 'failure retains search and input position');
    assert.equal((await request('continuous-9')).requestId, secondRequest.requestId);
    await page.evaluate(() => { Storage.prototype.setItem = window.fixtureSetItem; });
    await confirm();
    assert.deepEqual(await position(), secondPosition);
    assert.equal((await state()).blocks.length, 2);
    assert.deepEqual((await state()).blocks.find(b => b.id === firstSaved.id), firstSaved);
    assert((await state()).blocks.some(b => b.id === secondRequest.block.id));
    assert.notEqual(firstSaved.id, secondRequest.block.id);
    assert.equal((await state()).currentView, 'wbs');
    console.log('PASS 23: continuous tasks / second failure retains first / search node, selection and scroll');

    await page.locator('[data-work-list="wbs"] [data-action="placement-add-today"][data-id="continuous-8"]').click();
    assert.equal((await state()).modal.id, firstSaved.id, 'normal action views saved Block');
    assert.equal((await state()).blocks.length, 2);
    await page.locator('[data-action="placement-return"]').click();
    for (const count of [3, 4]) {
      await page.locator('[data-work-list="wbs"] [data-action="placement-add-another"][data-id="continuous-8"]').evaluate(button => {
        button.click(); button.click();
      });
      assert.match(await page.locator('.placement-form').textContent(), /別の予定/);
      const separate = await request('continuous-8');
      assert.notEqual(separate.requestId, continuousFirst.requestId);
      assert.equal((await state()).blocks.some(b => b.id === separate.block.id), false, 'each intentional extra gets a fresh id');
      await page.locator('.modal-footer [data-action="modal-save"]').evaluate(button => { button.click(); button.click(); });
      assert.equal((await state()).blocks.length, count, 'double activation saves one request');
      assert.equal((await state()).blocks.filter(b => b.id === separate.block.id).length, 1);
      assert.equal((await state()).currentView, 'wbs');
      assert.deepEqual((await state()).blocks.find(b => b.id === firstSaved.id), firstSaved);
      const resend = await page.evaluate(async request => {
        const { state } = await import('/src/state/store.js');
        const { commitPlacement } = await import('/src/features/placement.js');
        let writes = 0;
        const ok = commitPlacement(state, { request, today: fixtureDates.continuous, connection: request.connection },
          { now: fixtureDates.continuous + 'T12:00:00', persist: () => { writes++; return true; } });
        return { ok, writes, count: state.blocks.length };
      }, separate);
      assert.deepEqual(resend, { ok: true, writes: 0, count });
    }
    const staleButton = page.locator('[data-work-list="wbs"] [data-action="placement-add-another"][data-id="continuous-8"]');
    await page.evaluate(async () => { (await import('/src/state/store.js')).state.tasks.find(t => t.id === 'continuous-8').status = 'completed'; });
    await staleButton.click();
    assert.equal((await state()).modal, null, 'completed Task is rejected before new candidate selection');
    assert.equal((await state()).blocks.length, 4);
    assert.equal((await state()).tasks.find(t => t.id === 'continuous-8').status, 'completed');
    await page.reload(); await nav('wbs');
    assert.equal((await state()).blocks.length, 4, 'reload does not resend requests');
    assert.deepEqual((await state()).blocks.find(b => b.id === firstSaved.id),
      // B4 25: normalizeState fills missing copiedFromId on reload; compare the full record.
      { ...firstSaved, isMIT: false, source: '', copiedFromId: '' }, 'reload adds only existing normalization defaults');
    await page.evaluate(connection => {
      sessionStorage.setItem('taskchute-journal-placement-v1:' + JSON.stringify([connection, 'continuous-10']),
        JSON.stringify({ requestId: 'invalid-fixture' }));
    }, continuousFirst.connection);
    await open('continuous-10');
    assert.notEqual((await request('continuous-10')).requestId, 'invalid-fixture');
    assert.equal((await request('continuous-10')).block.taskId, 'continuous-10');
    await page.locator('.modal-footer [data-action="modal-close"]').click();
    assert.equal((await state()).blocks.length, 4, 'malformed local draft never auto-saves');
    for (const scope of ['today', 'exec', 'wbs']) {
      await nav(scope);
      const unchanged = await page.evaluate(async scope => {
        const { updateWorkLists } = await import('/src/features/work-list.js');
        const root = document.querySelector(`[data-work-list="${scope}"]`);
        const rows = [...root.querySelectorAll('[data-work-key]')];
        window.stableWorkRows = rows;
        updateWorkLists(); updateWorkLists();
        return rows.length > 0 && rows.every(row => row.isConnected && root.contains(row));
      }, scope);
      assert(unchanged, scope + ' unchanged updates preserve the original row nodes');
      await page.clock.runFor(1100);
      assert(await page.evaluate(() => window.stableWorkRows.every(row => row.isConnected)), scope + ' ticker preserves row nodes');
    }
    await nav('today');
    const changedTitle = '変更確認 < & >';
    await page.evaluate(async ({ id, title }) => {
      const { state } = await import('/src/state/store.js');
      state.blocks.find(block => block.id === id).title = title;
      (await import('/src/features/work-list.js')).updateWorkLists();
    }, { id: firstSaved.id, title: changedTitle });
    assert.equal(await page.locator(`[data-work-list="today"] [data-work-key="block:${firstSaved.id}"] .work-list-title`).textContent(), changedTitle,
      'actual content changes still update the row with escaped text');
    console.log('PASS 23: unchanged rows survive patch/ticker across three views; changed content updates');
    assert.deepEqual(errors, []);
    console.log('PASS 23: view existing / two intentional extras / double activation and replay one / completed rejection / reload');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
