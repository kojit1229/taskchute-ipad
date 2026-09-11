const assert = require('node:assert/strict');
const { dailyActuals, actualDurationMinutes } = require('../src/core/daily-actuals.js');
const { runDailyOperation: run, dailyFingerprint } = require('../src/features/daily-operations.js');
const { commitCandidate, setCommitGuard } = require('../src/core/commit.js');
const { chromium, launchOptions, startServer, randomPort, STATE_KEY, passGithubGate, deepCommitGuard } = require('./helpers');
const DAY = '2026-09-10', PREV = '2026-09-09';
function block(id, start, end, extra = {}) {
  return { id, title: id, taskId: 'task', date: DAY, actualStartAt: start, actualEndAt: end,
    plannedStartAt: `${DAY}T09:00:00`, plannedEndAt: `${DAY}T09:30:00`,
    completed: false, deleted: false, charge: 2, discharge: 1, comment: '', ...extra };
}
function fixture() {
  return { selectedDate: DAY, dataModifiedAt: `${DAY}T08:00:00`,
    tasks: [{ id: 'task', title: 'Task', status: 'todo', deleted: false }],
    blocks: [block('overnight', `${PREV}T23:50:00`, `${DAY}T00:10:00`),
      block('zero-b', `${DAY}T09:00:00`, `${DAY}T09:00:00`),
      block('zero-a', `${DAY}T09:00:00`, `${DAY}T09:00:00`),
      block('missing', '', `${DAY}T09:30:00`),
      block('plan-only', '', '', { completed: true }),
      block('deleted', `${DAY}T09:00:00`, `${DAY}T09:30:00`, { deleted: true }),
      block('past', `${PREV}T23:50:00`, `${DAY}T00:10:00`, { date: PREV })] };
}
const expected = ['overnight', 'zero-a', 'zero-b', 'missing'];
setCommitGuard(deepCommitGuard);
try {
  const state = fixture(), original = structuredClone(state);
  assert.deepEqual(dailyActuals(state.blocks, DAY).map(b => b.id), expected);
  assert.deepEqual(dailyActuals(state.blocks, DAY).map(actualDurationMinutes), [20, 0, 0, null]);
  assert.equal(actualDurationMinutes(block('invalid', `${DAY}T09:00:00`, '2026-02-30T10:00:00')), null);
  assert.deepEqual(state, original);
  let fail = true, saves = 0, effects = 0, sync = 0;
  const deps = { state, commitCandidate, now: () => `${DAY}T12:00:00`,
    persist: () => { saves++; return !fail; }, actualEditEffect: () => effects++, scheduleSync: () => sync++ };
  const input = { kind: 'actual', id: 'past', values: { actualStartAt: `${PREV}T23:45`, actualEndAt: `${DAY}T00:15`, comment: '訂正' } };
  assert.equal(run('daily-actual-edit', input, deps).ok, false);
  assert.deepEqual(state, original); assert.equal(effects, 0); assert.equal(sync, 0);
  fail = false;
  assert(run('daily-actual-edit', input, deps).ok);
  const saved = structuredClone(state), past = state.blocks.find(b => b.id === 'past');
  assert.equal(past.date, PREV); assert.equal(past.completed, false); assert.equal(actualDurationMinutes(past), 30);
  assert(past.updatedAt); assert.deepEqual(state.tasks, original.tasks);
  assert(run('daily-actual-edit', input, deps).unchanged); assert.deepEqual(state, saved); assert.equal(saves, 2);
  for (const change of [{ id: 'plan-only' }, { id: 'deleted' }, { id: 'absent' }, { kind: 'task' },
    { values: { actualStartAt: `${DAY}T01:00`, actualEndAt: `${DAY}T00:10` } },
    { values: { date: DAY } }, { values: { actualEndAt: '' } }, { values: { actualEndAt: 'invalid' } },
    { values: { charge: 6 } }, { requestId: 'unowned' }, { baseFingerprint: dailyFingerprint(original.blocks[6]) }]) {
    assert.equal(run('daily-actual-edit', { ...input, ...change }, deps).status, 'invalid');
    assert.deepEqual(state, saved);
  }
  assert(run('daily-actual-edit', { kind: 'actual', id: 'missing', values: { comment: '開始未記録' } }, deps).ok);
  assert.equal(actualDurationMinutes(state.blocks.find(b => b.id === 'missing')), null);
  console.log('PASS pure: ordered extraction, missing/zero/overnight, past correction, invalid input, rollback, replay and stamps');
} finally { setCommitGuard(null); }

(async () => {
  const server = startServer(randomPort()); let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'ja-JP', serviceWorkers: 'block', viewport: { width: 1400, height: 900 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'localhost') return route.abort();
      if (/personal-data|AIプラン|AIフィードバック|週次レビュー/.test(decodeURIComponent(url.pathname))) return route.fulfill({ status: 404, body: 'fixture only' });
      return route.continue();
    });
    await page.clock.setFixedTime(new Date(2026, 8, 10, 12));
    await page.goto(`http://localhost:${server.address().port}/`); await passGithubGate(page);
    await page.evaluate(({ key, data, day, prev }) => {
      const s = JSON.parse(localStorage.getItem(key)); Object.assign(s, data);
      s.currentView = 'today'; s.selectedDate = prev; s.recurrences = []; s.projects = []; s.bodyScans = [];
      s.settings.lastOpenedDate = day; s.settings.autoSync = false; s.settings.github.autoSave = false;
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, data: fixture(), day: DAY, prev: PREV });
    await page.reload(); await page.locator('#towerFlightLog').waitFor();
    const today = await page.locator('#towerFlightLog .tower-log-row').evaluateAll(rows => rows.map(r => ({
      id: r.dataset.id, time: r.querySelector('time').textContent, duration: r.querySelector('.tower-log-dur').textContent })));
    assert.deepEqual(today.map(r => r.id), expected);
    assert.deepEqual(today.map(r => r.duration), ['20分', '0分', '0分', '未記録']);
    await page.evaluate(({ key, day }) => { const s = JSON.parse(localStorage.getItem(key)); s.currentView = 'exec'; s.selectedDate = day; localStorage.setItem(key, JSON.stringify(s)); }, { key: STATE_KEY, day: DAY });
    await page.reload();
    await page.locator('.exec-mode-segmented [data-action="exec-mode-toggle"][data-mode="actual"]').click();
    const exec = await page.locator('.exec-row-done').evaluateAll(rows => rows.map(r => ({ id: r.querySelector('[data-action="edit-block"]').dataset.id, text: r.querySelector('.exec-row-meta').textContent })));
    assert.deepEqual(exec.map(r => r.id), expected);
    today.forEach((row, i) => { assert(exec[i].text.includes(row.duration)); if (row.id !== 'missing') assert(exec[i].text.includes(row.time.replace('-', '–'))); });
    // Exercise the old modal entry and its actual caller with another day's record.
    const trigger = (action, id) => page.evaluate(({ action, id }) => {
      const b = document.createElement('button'); Object.assign(b.dataset, { action, id }); document.body.append(b); b.click(); b.remove();
    }, { action, id });
    await trigger('complete-block-with-actual', 'past');
    const comment = page.locator('#modalRoot [data-modal-field="comment"]');
    await comment.fill('保存失敗からの訂正');
    await page.locator('#modalRoot [data-modal-field="actualStartAt"]').fill(`${PREV}T23:45`);
    await page.locator('#modalRoot [data-modal-field="actualEndAt"]').fill(`${DAY}T00:15`);
    const before = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    await comment.evaluate(el => { window.__actualInput = el; });
    await page.evaluate(key => {
      window.__actualSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, value) { if (k === key) throw new DOMException('fixture quota', 'QuotaExceededError'); return window.__actualSet.call(this, k, value); };
    }, STATE_KEY);
    await page.locator('#modalRoot [data-action="modal-save"]').click();
    assert.equal(await comment.inputValue(), '保存失敗からの訂正'); assert(await comment.evaluate(el => el === window.__actualInput));
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY), before);
    assert.equal(await page.evaluate(async () => (await import('/src/state/store.js')).state.blocks.find(b => b.id === 'past').actualStartAt), `${PREV}T23:50:00`);
    await page.evaluate(() => { Storage.prototype.setItem = window.__actualSet; });
    await page.locator('#modalRoot [data-action="modal-save"]').click();
    await page.waitForFunction(() => !document.querySelector('#modalRoot.open'));
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY), past = saved.blocks.find(b => b.id === 'past');
    assert.equal(past.actualStartAt, `${PREV}T23:45:00`); assert.equal(past.date, PREV); assert.equal(past.completed, false);
    assert.deepEqual(saved.tasks, before.tasks); assert.equal(actualDurationMinutes(past), 30);
    await page.reload(); assert.equal((await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY)).blocks.find(b => b.id === 'past').comment, '保存失敗からの訂正');
    assert.deepEqual(errors, []);
    console.log('PASS browser: today uses actual day, exec agrees on ids/times/durations; old modal past edit, failed save retains DOM/state, retry and reload');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
