const assert = require('node:assert/strict');
const { createZeroSession } = require('../src/features/zero-session.js');
const { runDailyOperation } = require('../src/features/daily-operations.js');
const { commitCandidate } = require('../src/core/commit.js');
const { zeroAnswer } = require('../src/features/zero-entry.js');
const { DAILY_DRAFT_KEY } = require('../src/features/daily-draft.js');
let count = 0;
function test(name, run) { run(); count++; console.log(`PASS ${name}`); }
function fixture() {
  const values = new Map(); let failure, now = 0, writes = 0;
  const storage = { getItem(key) { if (failure === 'get') throw Error('get'); return values.get(key) ?? null; },
    setItem(key, value) { if (failure === 'set') throw Error('set'); values.set(key, value); },
    removeItem(key) { if (failure === 'remove') throw Error('remove'); values.delete(key); } };
  const state = { dataModifiedAt: '2026-09-11T10:00:00', questions: [], zeroThinking: { entries: [], themes: [
    { id: 'a', text: 'Same name', fav: true }, { id: 'b', text: 'Same name', fav: false }] } };
  const session = (connection = 'fixture-a') => createZeroSession({ connection, nowMs: () => now,
    storage: () => { if (failure === 'acquire') throw Error('acquire'); return storage; } });
  const fields = id => ({ id, date: '2026-09-10', createdAt: '2026-09-10T10:00:00', startedAt: now });
  const start = (s, themeId, id, options = {}) => s.select(state.zeroThinking.themes.find(t => t.id === themeId), fields(id), { state, ...options });
  const run = (s, draft, action) => runDailyOperation(action, { draft, body: draft.body }, {
    state, commitCandidate, zeroDrafts: s, nowMs: () => now, now: () => '2026-09-11T10:00:00', today: () => '2026-09-11',
    isZeroOwner: d => d.connection === 'fixture-a', persist: () => { writes++; return true; }
  });
  return { values, state, session, start, run, fields, fail: value => { failure = value; }, time: value => { now = value; }, writes: () => writes };
}
test('A -> B -> reload -> A: original ids/body/date, same-name themes and explicit restore', () => {
  const f = fixture(), s = f.session(), before = JSON.stringify(f.state);
  const a = f.start(s, 'a', 'answer-a').draft; a.body = 'A body'; f.time(20000);
  const b = f.start(s, 'b', 'answer-b', { currentDraft: a }).draft; b.body = 'B body'; s.put(b);
  const reload = f.session();
  assert.equal(reload.inspect(a.id, f.state).status, 'confirm');
  assert.equal(reload.restore(a.id, f.state).status, 'confirm');
  const result = f.start(reload, 'a', 'unused', { confirmed: true });
  assert.equal(result.draft.id, a.id); assert.equal(result.draft.body, 'A body');
  assert.equal(result.draft.durationSec, 20); assert.equal(result.draft.date, '2026-09-10');
  assert.equal(reload.get(b).body, 'B body'); assert.equal(Object.keys(reload.snapshot().drafts).length, 2);
  assert.equal(JSON.stringify(f.state), before); assert.equal(f.writes(), 0);
  assert.equal(f.values.size, 1); assert.ok([...f.values.keys()][0].startsWith(DAILY_DRAFT_KEY));
  f.time(100000); assert.equal(reload.remaining(a.id), 0);
});
test('same-theme taps retain live text; new writing retains prior stopped draft; explicit discard is targeted', () => {
  const f = fixture(), s = f.session(), a = f.start(s, 'a', 'a1').draft; a.body = 'live';
  assert.equal(f.start(s, 'a', 'unused', { currentDraft: a }).draft, a);
  f.time(20000); f.fail('set');
  assert.equal(f.start(s, 'a', 'a2', { newWriting: true, currentDraft: a }).ok, false);
  assert.equal(s.snapshot().themeToDraft.a, 'a1'); assert.equal(s.get(a).body, 'live');
  f.time(50000); f.fail(null);
  const a2 = f.start(s, 'a', 'a2', { newWriting: true, currentDraft: a }).draft;
  assert.equal(s.get(a).durationSec, 20); assert.equal(s.snapshot().themeToDraft.a, a2.id);
  const b = f.start(s, 'b', 'b1', { currentDraft: a2 }).draft;
  assert.equal(s.discard(a.id).ok, true); assert.equal(s.get(a), null); assert.ok(s.get(b));
  assert.equal(s.snapshot().themeToDraft.a, a2.id); assert.equal(f.state.zeroThinking.entries.length, 0);
});
test('completion releases only matching theme; immediate reload cleans matching old copy, conflict preserves both', () => {
  const f = fixture(), s = f.session(), a = f.start(s, 'a', 'a1').draft; a.body = 'finished';
  f.run(s, a, 'zero-leave'); const old = new Map(f.values);
  const b = f.start(s, 'b', 'b1').draft;
  assert.equal(f.run(s, a, 'zero-complete').ok, true);
  assert.equal(s.snapshot().themeToDraft.a, undefined); assert.equal(s.snapshot().themeToDraft.b, b.id);
  f.values.clear(); old.forEach((v, k) => f.values.set(k, v));
  assert.equal(f.session().restore(a.id, f.state).status, 'completed'); assert.equal(f.values.size, 0);
  old.forEach((v, k) => f.values.set(k, v)); f.state.zeroThinking.entries[0].body = 'later canonical body';
  const reload = f.session(), before = JSON.stringify(f.state);
  assert.equal(reload.restore(a.id, f.state, true).status, 'conflict');
  assert.equal(reload.get(a).body, 'finished'); assert.equal(JSON.stringify(f.state), before);
  assert.equal(reload.discard(a.id).ok, true); assert.equal(f.state.zeroThinking.entries[0].body, 'later canonical body');
});
test('other connection and separate tab cannot apply drafts; old theme changes require reconfirmation', () => {
  const f = fixture(), s = f.session(), a = f.start(s, 'a', 'a1').draft; a.body = 'old'; s.put(a);
  assert.equal(f.session('other').inspect(a.id, f.state).status, 'missing');
  assert.equal(f.session('other').put(a).ok, false);
  assert.equal(fixture().session().inspect(a.id, f.state).status, 'missing');
  assert.equal(f.session().get(a).body, 'old');
  f.state.zeroThinking.themes[0].text = 'renamed';
  assert.equal(f.session().restore(a.id, f.state, true).status, 'conflict');
  f.state.zeroThinking.themes = []; assert.equal(f.session().restore(a.id, f.state, true).status, 'conflict');
});
for (const error of ['acquire', 'get', 'set', 'remove']) test(`storage ${error} exception leaves normal input and explicit completion usable`, () => {
  const f = fixture(); f.fail(error); const s = f.session();
  const a = f.start(s, 'a', 'a1').draft; assert.ok(a); a.body = 'kept';
  const saved = s.put(a); assert.equal(s.get(a).body, 'kept');
  if (['acquire', 'set'].includes(error)) { assert.equal(saved.ok, false); assert.equal(s.status().memoryOnly, true); }
  assert.equal(f.run(s, a, 'zero-complete').ok, true); assert.equal(f.writes(), 1);
  assert.equal(f.state.zeroThinking.entries[0].body, 'kept');
  const removed = s.discard(a.id);
  assert.equal(removed.ok, !['acquire', 'remove'].includes(error));
  f.fail(null); assert.equal(s.retry().ok, true);
});
for (const invalid of ['{', 'null', '{"version":99}', '{"version":1,"drafts":[]}']) test(`bad or unknown session ignored: ${invalid}`, () => {
  const f = fixture(), s = f.session(); f.start(s, 'a', 'a1'); const key = [...f.values.keys()][0];
  f.values.set(key, invalid); const before = JSON.stringify(f.state), reload = f.session();
  assert.equal(reload.inspect('a1', f.state).status, 'missing');
  assert.equal(JSON.stringify(f.state), before); assert.ok(f.start(reload, 'b', 'b1').draft);
});
for (const change of [
  saved => { saved.version = 99; },
  saved => { saved.drafts.a1.version = 99; },
  saved => { saved.drafts.a1.connection = 'other'; },
  saved => { saved.themeToDraft.a = 'missing'; }
]) test('valid common owner cannot admit unknown version or inconsistent nested owners', () => {
  const f = fixture(), s = f.session(); f.start(s, 'a', 'a1'); const key = [...f.values.keys()][0];
  const saved = JSON.parse(f.values.get(key)); change(saved); f.values.set(key, JSON.stringify(saved));
  const reload = f.session(); assert.equal(reload.inspect('a1', f.state).status, 'missing');
  assert.ok(reload.status().loadError); assert.equal(f.state.zeroThinking.entries.length, 0);
});
test('read failure with existing draft does not restore it; missing key and restored key remain isolated', () => {
  const f = fixture(), s = f.session(), a = f.start(s, 'a', 'a1').draft; a.body = 'stored'; s.put(a);
  f.fail('get'); assert.equal(f.session().inspect(a.id, f.state).status, 'missing');
  f.fail(null); assert.equal(f.session().get(a).body, 'stored');
  const old = new Map(f.values); f.values.clear(); assert.equal(f.session().inspect(a.id, f.state).status, 'missing');
  old.forEach((v, k) => f.values.set(k, v)); assert.equal(f.session().restore(a.id, f.state).status, 'confirm');
});
test('missing keys and JSON serialization exceptions are safe; pending question survives and reconciles through 03', () => {
  const f = fixture(), s = f.session(); assert.deepEqual(s.snapshot().drafts, {});
  f.state.questions = [{ id: 'q', title: 'Q', status: 'open' }]; f.state.zeroThinking.themes[0].questionId = 'q';
  const a = f.start(s, 'a', 'a1').draft; a.body = 'pending body';
  a.questionRequest = { id: 'q', date: '2026-09-11', before: { ...f.state.questions[0] },
    planned: { ...f.state.questions[0], status: 'deepening', lastTouchedAt: '2026-09-11' }, done: false };
  assert.equal(s.put(a).ok, true); const bad = { ...a }; bad.cycle = bad;
  assert.equal(s.put(bad).ok, false); assert.equal(s.get(a).body, 'pending body');
  const reload = f.session(), restored = reload.restore(a.id, f.state, true).draft;
  assert.deepEqual(restored.questionRequest, a.questionRequest);
  assert.equal(f.run(reload, restored, 'zero-complete').ok, true);
  assert.equal(f.state.questions[0].status, 'deepening'); assert.equal(f.state.zeroThinking.entries[0].id, a.id);
  assert.equal(f.writes(), 1); assert.deepEqual(zeroAnswer(restored).body, 'pending body');
});
console.log(`PASS zero-session: ${count} cases`);
