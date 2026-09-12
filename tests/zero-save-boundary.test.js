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
