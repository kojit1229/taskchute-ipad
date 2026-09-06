// FUND regression: complete assertions remain visible to the test manifest.
'use strict';
(async () => {
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { createFundWorkspace } = await import('../src/features/fund/workspace.js');
const fixture = (engine, capital) => ({ version: 1, generatedAt: '2026-09-06T00:00:00Z',
  start: { date: '2026-09-01', capital }, nav: { current: capital, dayChangePct: 0, totalReturnPct: 0,
    series: [{ date: '2026-09-01', nav: capital, n225: null, spx: null }] }, cash: capital,
  benchmark: { n225ReturnPct: null, spxReturnPct: null, excessVsN225: null, excessVsSpx: null },
  positions: [], openOrders: [], recentTrades: [], engine: { id: engine, actualModel: null, costUsd: null } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup() {
  let revision = 1, ready = true, handler = async path => ({ ok: true, status: 200,
    text: JSON.stringify(path.endsWith('fund.json') ? fixture('fable', 123456) : path.endsWith('fund-codex.json') ? fixture('codex', 654321) :
      path.includes('status') ? { version: 1, engine: 'codex', status: 'not_started', checkedAt: '2026-09-06T00:00:00Z', lastAttemptAt: null, lastSuccessAt: null } :
      { version: 1, status: 'insufficient_data', generatedAt: '2026-09-06T00:00:00Z', startDate: null, valuationDate: null, series: [], metrics: null }) });
  const calls = [], updates = [], actions = {};
  const api = createFundWorkspace({ transport: { captureConnection: () => ({ revision, ready, readContext: {} }),
    read: path => { calls.push(path); return handler(path); } }, escapeHTML: s => String(s), renderHeader: (a, b, c) => `<header>${a}${b}${c}</header>`,
    renderMarkdown: s => String(s), registerActions: a => Object.assign(actions, a), onUpdate: e => updates.push(e),
    now: () => 1788652800000, timeoutMs: 50 });
  return { api, calls, updates, actions, fetch: fn => { handler = fn; }, disconnect: () => { ready = false; revision++; } };
}
test('loads all four sources independently and exposes both individual views', async () => {
  const s = setup(); await s.api.load(); assert.equal(s.calls.length, 4);
  assert.ok(s.api.content().includes('比較できる記録がまだそろっていません'));
  s.actions['fund-select']({ target: { dataset: { engine: 'fable' } } });
  assert.ok(s.api.content().includes('¥123,456')); assert.ok(!s.api.content().includes('¥654,321'));
  s.api.select('codex'); assert.ok(s.api.content().includes('¥654,321')); assert.ok(s.api.content().includes('運用開始前'));
  assert.ok(s.api.render().includes('data-engine="codex" aria-pressed="true"'));
  await s.api.load(); assert.equal(s.calls.length, 4); s.api.dispose();
});
test('rapid refresh coalesces each source while selected fund remains selected', async () => {
  const s = setup(); await s.api.load(); const pending = deferred(); s.fetch(() => pending.promise);
  const a = s.api.load({ force: true }), b = s.api.load({ force: true });
  s.api.select('codex'); await Promise.resolve(); assert.equal(s.calls.length, 8);
  pending.resolve({ ok: false, status: 503, text: '' }); await Promise.all([a, b]);
  assert.equal(s.api.selected(), 'codex'); assert.ok(s.api.content().includes('¥654,321'));
  assert.ok(s.api.content().includes('前回正常に取得した成績'));
  assert.ok(s.updates.at(-1).content.includes('CODEX FUND')); s.api.dispose();
});
test('late requests from disconnected connection are discarded and data hidden', async () => {
  const s = setup(); await s.api.load(); const pending = deferred(); s.fetch(() => pending.promise);
  const task = s.api.load({ force: true }); await Promise.resolve(); s.disconnect();
  s.api.select('fable'); assert.ok(!s.api.content().includes('¥123,456'));
  pending.resolve({ ok: true, status: 200, text: JSON.stringify(fixture('fable', 999999)) });
  const result = await task; assert.ok(result.every(r => r.discarded)); assert.ok(!s.api.content().includes('¥999,999'));
  s.api.dispose();
});
test('unknown choice cannot select an arbitrary source or alter existing choice', () => {
  const s = setup(); assert.equal(s.api.select('app-state.json'), false); assert.equal(s.api.selected(), 'comparison'); s.api.dispose();
});

})().catch(error => { console.error(error); process.exitCode = 1; });
