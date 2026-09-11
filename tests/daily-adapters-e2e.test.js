const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions, startServer, randomPort, STATE_KEY, passGithubGate } = require('./helpers');
const { createMockAdapter, MOCK_STORAGE_KEY } = require('../scripts/daily-mock/mock-adapter.js');
const DAY = '2026-09-10';
const failures = [];
async function check(name, work) {
  try { await work(); console.log('PASS ' + name); }
  catch (error) { failures.push(name); console.error('FAIL ' + name, error); }
}

(async () => {
  await check('product: add/edit/start/end/actual/report, failure/cancel/retry and isolated storage', async () => {
    const server = startServer(randomPort()); let browser;
    try {
      browser = await chromium.launch(launchOptions());
      const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'ja-JP', serviceWorkers: 'block', viewport: { width: 1400, height: 900 } });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => { const u = new URL(route.request().url());
        if (u.hostname !== 'localhost') return route.abort();
        if (/personal-data|AIプラン|AIフィードバック|週次レビュー/.test(decodeURIComponent(u.pathname))) return route.fulfill({ status: 404, body: 'fixture only' });
        return route.continue(); });
      await page.clock.setFixedTime(new Date(2026, 8, 10, 12));
      await page.goto(`http://localhost:${server.address().port}/`); await passGithubGate(page);
      await page.evaluate(({ key, mockKey, day }) => {
        const s = JSON.parse(localStorage.getItem(key));
        s.selectedDate = day; s.currentView = 'exec'; s.blocks = []; s.recurrences = []; s.bodyScans = [];
        s.projects = [{ id: 'p', title: '架空Project', kind: 'normal', status: 'active', deleted: false }];
        s.tasks = [{ id: 'task', title: '通しTask', projectId: 'p', kind: 'project', status: 'todo', deleted: false, dueDate: day }];
        s.settings.lastOpenedDate = day; s.settings.autoSync = false; s.settings.github.autoSave = false; s.settings.focusTimerAuto = false;
        localStorage.setItem(key, JSON.stringify(s)); localStorage.setItem(mockKey, 'mock sentinel');
      }, { key: STATE_KEY, mockKey: MOCK_STORAGE_KEY, day: DAY });
      await page.reload(); await page.locator('#app[data-view="exec"]').waitFor();
      const trigger = (action, id, kind = 'block') => page.evaluate(values => {
        const b = document.createElement('button'); Object.assign(b.dataset, values); document.body.append(b); b.click(); b.remove();
      }, { action, id, kind });
      const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
      await page.evaluate(key => {
        window.__adapterSet = Storage.prototype.setItem; window.__adapterFail = false; window.__adapterKeys = [];
        Storage.prototype.setItem = function(k, v) { window.__adapterKeys.push(k); if (window.__adapterFail && k === key) throw new DOMException('fixture quota', 'QuotaExceededError'); return window.__adapterSet.call(this, k, v); };
      }, STATE_KEY);
      await trigger('placement-add-today', 'task', 'task');
      await page.locator('.placement-form').waitFor();
      await page.locator('#modalRoot .modal-footer [data-action="modal-close"]').click();
      assert.equal((await stored()).blocks.length, 0);
      await trigger('placement-add-today', 'task', 'task');
      await page.locator('.placement-form').waitFor();
      await page.evaluate(() => { window.__adapterFail = true; });
      await page.locator('#modalRoot .modal-footer [data-action="modal-save"]').click();
      assert.equal((await stored()).blocks.length, 0); assert(await page.locator('.placement-form').isVisible());
      await page.evaluate(() => { window.__adapterFail = false; });
      await page.locator('#modalRoot .modal-footer [data-action="modal-save"]').click();
      const added = (await stored()).blocks; assert.equal(added.length, 1); const id = added[0].id;
      await trigger('edit-block', id);
      await page.locator('#modalRoot [data-modal-field="title"]').fill('編集した通しBlock');
      await page.locator('#modalRoot [data-modal-field="plannedStartAt"]').fill(`${DAY}T09:00`);
      await page.locator('#modalRoot [data-modal-field="plannedEndAt"]').fill(`${DAY}T09:30`);
      await page.locator('#modalRoot .modal-footer [data-action="modal-save"]').click();
      assert.equal((await stored()).blocks.find(b => b.id === id).title, '編集した通しBlock');
      await check('product: copy and undo through real app dependencies', async () => {
        await trigger('daily-block-duplicate', id);
        const blocks = (await stored()).blocks, copy = blocks.find(b => b.id !== id && !b.deleted);
        assert(copy); assert.equal(copy.actualStartAt, '');
        await trigger('daily-duplicate-undo', copy.id);
        assert.equal((await stored()).blocks.find(b => b.id === copy.id).deleted, true);
        await trigger('daily-duplicate-undo', copy.id);
        assert.equal((await stored()).blocks.filter(b => !b.deleted).length, 1);
      });
      await trigger('daily-block-start', id);
      await page.locator('[data-action="declare-skip"]').click();
      assert.equal((await stored()).blocks.find(b => b.id === id).actualStartAt, `${DAY}T12:00:00`);
      const startedTasks = (await stored()).tasks;
      assert.equal(startedTasks[0].status, 'doing');
      await page.clock.setFixedTime(new Date(2026, 8, 10, 13));
      await trigger('daily-block-end', id);
      await page.locator('[data-action="report-outcome"][data-outcome="partial"]').click();
      let saved = await stored(); assert.equal(saved.blocks.find(b => b.id === id).actualEndAt, `${DAY}T13:00:00`);
      assert.equal(saved.blocks.find(b => b.id === id).completed, false);
      await trigger('complete-block-with-actual', id);
      await page.locator('#modalRoot [data-modal-field="actualEndAt"]').fill(`${DAY}T13:15`);
      await page.locator('#modalRoot .modal-footer [data-action="modal-save"]').click();
      saved = await stored(); assert(saved.reports[DAY].includes('計測合計: 75分'));
      assert(saved.reports[DAY].includes(`| ${id} | ${DAY} |`));
      assert.deepEqual(saved.tasks, startedTasks, 'end and actual correction preserve the Task state established by start');
      assert.equal(await page.evaluate(key => localStorage.getItem(key), MOCK_STORAGE_KEY), 'mock sentinel');
      assert(!(await page.evaluate(() => window.__adapterKeys)).includes(MOCK_STORAGE_KEY));
      await page.reload(); assert.equal((await stored()).blocks.find(b => b.id === id).actualEndAt, `${DAY}T13:15:00`);
      assert.deepEqual(errors, []);
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
  });

  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/daily-mock/fixtures.json'), 'utf8'));
  const bytes = fs.readFileSync(path.join(__dirname, '../scripts/daily-mock/fixtures.json'), 'utf8');
  const data = new Map([[STATE_KEY, 'product sentinel']]), keys = [];
  const storage = { getItem: k => { keys.push(k); return data.get(k) ?? null; }, setItem: (k, v) => { keys.push(k); data.set(k, v); } };
  const adapter = createMockAdapter({ fixtures, storage }); let sequence = 0, id = fixtures.entities[0].id;
  const request = (action, values = {}, target = id) => ({ action, kind: 'block', id: target, draftId: 'mock-draft',
    requestId: `bundle-${++sequence}`, baseFingerprint: adapter.fingerprint(), values });
  await check('mock: cancel leaves state unchanged', () => {
    const before = adapter.getState(); assert.equal(adapter.dispatchMockOperation(request('daily-plan-times-cancel')).status, 'cancelled'); assert.deepEqual(adapter.getState(), before);
  });
  await check('mock: add through existing modal-save', () => {
    const r = adapter.dispatchMockOperation(request('modal-save', { title: '追加Block', date: DAY, start: '', end: '', endNextDay: false }, null));
    assert.equal(r.status, 'saved'); id = r.entityId;
  });
  await check('mock: edit failure retains candidate and retry/replay saves once', () => {
    const req = request('daily-plan-times-save', { start: '09:00', end: '09:45', endNextDay: false }); const before = adapter.getState();
    assert.equal(adapter.dispatchMockOperation(req, { scenario: 'failure' }).status, 'storage-failed'); assert.deepEqual(adapter.getState(), before); assert(adapter.getCandidate());
    assert.equal(adapter.dispatchMockOperation(req, { scenario: 'retry' }).status, 'saved'); const saved = adapter.getState();
    assert.equal(adapter.dispatchMockOperation(req, { scenario: 'retry' }).status, 'saved'); assert.deepEqual(adapter.getState(), saved);
  });
  await check('mock: copy and undo', () => {
    const copy = adapter.dispatchMockOperation(request('daily-block-duplicate')); assert.equal(copy.status, 'saved');
    const undo = request('daily-duplicate-undo', { undoToken: copy.undoToken }, copy.entityId);
    assert.equal(adapter.dispatchMockOperation(undo).status, 'saved'); assert.equal(adapter.dispatchMockOperation(undo).status, 'saved');
    assert(!adapter.getState().entities.some(row => row.id === copy.entityId));
  });
  for (const [action, values] of [
    ['daily-block-start', { actualStartAt: `${DAY}T12:00:00` }],
    ['daily-block-end', { actualEndAt: `${DAY}T13:00:00`, completed: false }],
    ['daily-actual-edit', { actualEndAt: `${DAY}T13:15:00` }],
    ['daily-report-refresh', { reportDate: DAY }]
  ]) await check(`mock: ${action} uses the same saved meaning`, () => {
    const r = adapter.dispatchMockOperation(request(action, values)); assert.equal(r.status, 'saved');
  });
  await check('mock: invalid datetime is rejected like the product (106a F1)', () => {
    const before = adapter.getState();
    for (const actualEndAt of [`${DAY}T25:00:00`, '2026-02-30T10:00:00', `${DAY}T11:00:00`]) {
      const r = adapter.dispatchMockOperation(request('daily-actual-edit', { actualEndAt }));
      assert.equal(r.status, 'invalid', actualEndAt); assert.deepEqual(adapter.getState(), before); assert.equal(adapter.getCandidate(), null);
    }
  });
  await check('mock: isolation, fixed fixture and measured report', () => {
    assert(keys.every(key => key === MOCK_STORAGE_KEY)); assert.equal(data.get(STATE_KEY), 'product sentinel');
    assert.equal(fs.readFileSync(path.join(__dirname, '../scripts/daily-mock/fixtures.json'), 'utf8'), bytes);
    const state = adapter.getState(); assert.equal(state.entities.find(row => row.id === id).actualEndAt, `${DAY}T13:15:00`);
    assert(state.reports[DAY].includes('計測合計: 75分'));
  });
  assert.deepEqual(failures, [], 'all product and mock flow checks must pass');
})().catch(error => { console.error(error); process.exitCode = 1; });
