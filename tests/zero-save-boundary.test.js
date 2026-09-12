// 0秒思考: 下書き保存・問い更新・完了・画面離脱の候補保存境界 (order 124).
const assert = require('node:assert/strict');
const { createZeroEntryDraft, stopZeroEntry, zeroNeedsSave } = require('../src/features/zero-entry.js');
const { createDailyDraftStore } = require('../src/features/daily-draft.js');
const { runDailyOperation } = require('../src/features/daily-operations.js');
const { commitCandidate, setCommitGuard } = require('../src/core/commit.js');
const { deepCommitGuard } = require('./helpers');
setCommitGuard(deepCommitGuard);
function fixture({ question = true } = {}) {
  let nowMs = 0, tabFails = false, stateFails = false, saves = 0, syncs = 0;
  const stored = new Map();
  const state = { selectedDate: '2026-08-01', dataModifiedAt: '2026-09-11T10:00:00',
    zeroThinking: { themes: [{ id: 'theme', text: 'Synthetic theme', fav: false, questionId: question ? 'q' : null }], entries: [] },
    questions: question ? [{ id: 'q', title: 'Synthetic question', status: 'open', lastTouchedAt: '', updatedAt: '2026-09-10T10:00:00' }] : [] };
  const draft = createZeroEntryDraft({ theme: state.zeroThinking.themes[0], id: 'answer', connection: 'fixture-a',
    date: '2026-09-11', createdAt: '2026-09-11T10:00:00', startedAt: nowMs });
  const deps = { state, commitCandidate, now: () => '2026-09-11T10:00:00', today: () => '2026-09-11', nowMs: () => nowMs,
    isZeroOwner: value => value === draft && value.connection === 'fixture-a',
    zeroDrafts: createDailyDraftStore({ storage: () => ({ setItem(key, value) {
      if (tabFails) throw Error('session quota'); stored.set(key, value);
    }, getItem: key => stored.get(key), removeItem: key => stored.delete(key) }) }),
    persist: () => { saves++; return !stateFails; }, scheduleSync: () => syncs++ };
  return { state, draft, deps, stored, run: (name, body = draft.body) => runDailyOperation(name, { draft, body }, deps),
    configure: flags => { if ('nowMs' in flags) nowMs = flags.nowMs; if ('tabFails' in flags) tabFails = flags.tabFails; if ('stateFails' in flags) stateFails = flags.stateFails; },
    counts: () => ({ saves, syncs }) };
}
try {
  {
    const f = fixture({ question: false }), before = JSON.stringify(f.state);
    assert.equal(f.run('zero-draft-save', '保存済み本文').ok, true);
    assert.equal(zeroNeedsSave(f.draft, '保存済み本文'), false);
    assert.equal(JSON.stringify(f.state), before); assert.deepEqual(f.counts(), { saves: 0, syncs: 0 });
    stopZeroEntry(f.draft, 20000);
    assert.equal(zeroNeedsSave(f.draft, '保存済み本文'), true, 'time-only stop needs a draft save');
    assert.equal(f.run('zero-leave').ok, true);
    assert.equal(zeroNeedsSave(f.draft, f.draft.body), false);
    assert.equal(f.state.zeroThinking.entries.length, 0, 'leaving never completes');
    assert.equal(f.deps.zeroDrafts.get(f.draft).durationSec, 20);
    console.log('PASS saved baseline, original date, time-only draft, zero state writes and no completion on leave');
  }
  {
    const f = fixture(), before = JSON.stringify(f.state);
    f.configure({ nowMs: 20000, tabFails: true });
    assert.equal(f.run('zero-leave', '未保存本文').ok, false);
    assert.equal(f.draft.durationSec, 20); assert.equal(JSON.stringify(f.state), before);
    assert.equal(f.draft.body, '未保存本文');
    f.configure({ nowMs: 50000, tabFails: false, stateFails: true });
    assert.equal(f.run('zero-leave').ok, false);
    assert.equal(JSON.stringify(f.state), before); assert.equal(f.draft.questionRequest.done, false);
    assert.equal(f.draft.durationSec, 20); assert.equal(zeroNeedsSave(f.draft, f.draft.body), true);
    f.configure({ stateFails: false });
    assert.equal(f.run('zero-leave').ok, true); assert.equal(f.draft.durationSec, 20);
    assert.equal(f.state.questions[0].status, 'deepening'); assert.equal(f.state.questions[0].lastTouchedAt, '2026-09-11');
    const touched = f.state.questions[0].updatedAt;
    assert.equal(f.run('zero-complete').ok, true); assert.equal(f.run('zero-complete').ok, true);
    assert.equal(f.state.zeroThinking.entries.length, 1); assert.equal(f.state.zeroThinking.entries[0].id, f.draft.id);
    assert.equal(f.state.zeroThinking.entries[0].durationSec, 20); assert.equal(f.state.zeroThinking.themes.length, 0);
    assert.equal(f.state.questions[0].updatedAt, touched, 'completion does not retouch');
    console.log('PASS stop 20s/fail/retry 50s remains 20s; question retry; same request gives one answer');
  }
  {
    const f = fixture(), before = JSON.stringify(f.state);
    f.configure({ tabFails: true, stateFails: true, nowMs: 20000 });
    assert.equal(f.run('zero-complete', '明示完了').ok, false);
    assert.equal(JSON.stringify(f.state), before); assert.equal(f.draft.body, '明示完了');
    f.configure({ stateFails: false, nowMs: 50000 });
    assert.equal(f.run('zero-complete').ok, true, 'session unavailable still permits explicit local completion');
    assert.equal(f.state.zeroThinking.entries.length, 1); assert.equal(f.state.questions[0].status, 'deepening');
    assert.equal(f.state.zeroThinking.entries[0].durationSec, 20);
    assert.deepEqual(f.counts(), { saves: 2, syncs: 1 });
    console.log('PASS atomic completion rollback and explicit completion with unavailable session storage');
  }
  {
    const f = fixture(); f.configure({ stateFails: true }); f.run('zero-draft-save', 'pending');
    const pending = structuredClone(f.draft.questionRequest);
    f.state.questions[0] = { ...pending.planned, updatedAt: '2026-09-12T10:00:00', lastTouchedAt: '2026-09-12', status: 'closed' };
    f.configure({ stateFails: false });
    assert.equal(f.run('zero-draft-save').ok, true); assert.equal(f.state.questions[0].status, 'closed');
    assert.equal(f.counts().saves, 1, 'later question progress is acknowledged without a second state save');
    f.state.zeroThinking.themes[0].text = 'Renamed';
    assert.equal(f.run('zero-complete').ok, false); assert.equal(f.state.zeroThinking.entries.length, 0);
    console.log('PASS restored pending question reconciles later state; renamed theme cannot be consumed');
  }
  {
    const f = fixture();
    f.state.questions[0].lastTouchedAt = '2026-09-10';
    f.configure({ stateFails: true });
    assert.equal(f.run('zero-draft-save', 'pending status-only change').ok, false);
    assert.equal(f.draft.questionRequest.done, false);
    assert.equal(f.deps.zeroDrafts.get(f.draft).body, 'pending status-only change');
    Object.assign(f.state.questions[0], { status: 'closed', updatedAt: '2026-09-12T10:00:00' });
    const advanced = structuredClone(f.state.questions[0]);
    f.configure({ stateFails: false });
    assert.equal(f.run('zero-draft-save').ok, true);
    assert.deepEqual(f.state.questions[0], advanced, 'status, timestamp and old touch date are not rolled back');
    assert.equal(f.draft.questionRequest.done, true);
    assert.equal(f.deps.zeroDrafts.get(f.draft).questionRequest.done, true);
    assert.equal(zeroNeedsSave(f.draft, f.draft.body), false);
    assert.equal(f.counts().saves, 1, 'status-only progress needs no second state save');
    console.log('PASS pending question acknowledges status-only progress with an unchanged old touch date');
  }
  for (const change of ['deleted', 'content', 'owner', 'blank']) {
    const f = fixture();
    if (change !== 'blank') { f.configure({ stateFails: true }); f.run('zero-draft-save', 'pending'); f.configure({ stateFails: false }); }
    if (change === 'deleted') f.state.questions = [];
    if (change === 'content') f.state.questions[0].title = 'Changed elsewhere';
    if (change === 'owner') f.draft.connection = 'fixture-b';
    const before = JSON.stringify(f.state);
    assert.equal(f.run('zero-complete', change === 'blank' ? ' \n ' : f.draft.body).ok, false);
    assert.equal(JSON.stringify(f.state), before);
  }
  console.log('PASS deleted/changed question, other connection, blank completion preserve state');
} finally { setCommitGuard(null); }

// R3-03b: exercise the actual app adapter and shared leave guard with isolated storage.
(async () => {
  const fs = require('node:fs'), path = require('node:path'), { once } = require('node:events');
  const { chromium, launchOptions, startServer, randomPort, STATE_KEY } = require('./helpers');
  const server = startServer(randomPort()); let browser;
  try {
    if (!server.listening) await once(server, 'listening');
    browser = await chromium.launch(launchOptions());
    const page = await browser.newPage({ serviceWorkers: 'block', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    await page.route('**/app.js', route => route.fulfill({ status: 200, contentType: 'text/javascript',
      body: fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8') + '\nwindow.zeroBoundaryProbe = { save: () => runZeroEntry("zero-draft-save", "#zt-write-input"), read: () => ztCurrent?.zeroDraft };' }));
    await page.clock.install({ time: new Date(2026, 8, 11, 10) });
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.waitForFunction(key => !!localStorage.getItem(key), STATE_KEY);
    await page.evaluate(key => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = 'zero'; state.settings.autoSync = false;
      Object.assign(state.settings.github, { token: 'synthetic', dataOwner: 'synthetic', dataRepo: 'fixture', autoSave: false });
      state.zeroThinking = { themes: [{ id: 'a', text: 'Synthetic A', fav: true }, { id: 'b', text: 'Synthetic B', fav: false }], entries: [] };
      localStorage.setItem(key, JSON.stringify(state));
    }, STATE_KEY);
    await page.reload();
    await page.waitForFunction(() => !!window.zeroBoundaryProbe);
    const action = (name, values = {}) => page.evaluate(({ name, values }) => {
      const button = document.createElement('button'); Object.assign(button.dataset, { action: name, ...values });
      document.body.append(button); button.click(); button.remove();
    }, { name, values });
    const input = page.locator('#zt-write-input');
    const read = () => page.evaluate(async () => { const { state } = await import('/src/state/store.js'); return state; });
    await action('zt-write', { id: 'a' }); await input.fill('保存済み本文');
    assert.equal((await page.evaluate(() => window.zeroBoundaryProbe.save())).ok, true);
    await page.clock.runFor(20000);
    const first = await page.evaluate(() => window.zeroBoundaryProbe.read());
    await action('nav', { view: 'wbs' });
    assert.equal((await read()).currentView, 'wbs'); assert.equal((await read()).zeroThinking.entries.length, 0);
    assert.equal(await page.locator('.draft-leave-dialog').count(), 0, 'saved body/time leave has no confirmation');
    const saved = await page.evaluate(id => Object.keys(sessionStorage).map(key => JSON.parse(sessionStorage.getItem(key)))
      .find(value => value.id === id), first.id);
    assert.equal(saved.body, '保存済み本文'); assert.equal(saved.durationSec, 20);
    console.log('PASS live saved body/time: confirmation 0, history insertion 0, preserved draft id and 20 seconds');
    await action('nav', { view: 'zero' }); await action('zt-write', { id: 'a' }); await input.fill('失敗しても保持');
    await page.clock.runFor(20000);
    await page.evaluate(() => {
      window.originalZeroStorage = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (this === sessionStorage) throw Error('synthetic session quota');
        return window.originalZeroStorage.call(this, key, value);
      };
    });
    await action('nav', { view: 'wbs' });
    assert.equal((await read()).currentView, 'zero'); assert.equal(await input.inputValue(), '失敗しても保持');
    assert.equal((await page.evaluate(() => window.zeroBoundaryProbe.read())).durationSec, 20);
    await page.locator('[data-action="draft-leave-stay"]').click();
    await page.clock.runFor(30000);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalZeroStorage; });
    await action('nav', { view: 'wbs' });
    assert.equal((await read()).currentView, 'wbs'); assert.equal((await read()).zeroThinking.entries.length, 0);
    console.log('PASS live session failure blocks navigation; retry after 50 seconds keeps stopped draft');
    await action('nav', { view: 'zero' }); await action('zt-write', { id: 'b' }); await input.fill('完成回答');
    await page.evaluate(() => {
      Storage.prototype.setItem = function(key, value) {
        if (this === sessionStorage) throw Error('synthetic session unavailable');
        return window.originalZeroStorage.call(this, key, value);
      };
    });
    await action('zt-save');
    assert.equal((await read()).zeroThinking.entries.filter(entry => entry.body === '完成回答').length, 1);
    assert.equal((await read()).zeroThinking.themes.some(theme => theme.id === 'b'), false);
    assert.deepEqual(errors, []);
    console.log('PASS live explicit completion with session unavailable; normal local persistence succeeds');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
