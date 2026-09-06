// FUND regression: complete assertions remain visible to the test manifest.
'use strict';
(async () => {
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { createFundReadTransport } = await import('../src/features/fund/read-transport.js');
const { createFundReadGateway } = await import('../src/features/fund/read-gateway.js');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup() {
  let conn = { ready: true, owner: 'fixture owner', repo: 'fixture-repo', branch: 'fixture/branch', token: 'synthetic-secret', prefix: 'taskchute' };
  let fetcher = async () => ({ ok: true, status: 200, text: async () => 'body' });
  const calls = [], auth = [];
  const transport = createFundReadTransport({ getConnection: () => conn, headers: token => ({ Authorization: `Bearer ${token}` }),
    fetchImpl: (...args) => { calls.push(args); return fetcher(...args); },
    onUnauthorized: () => auth.push('denied'), onAuthorized: () => auth.push('ok') });
  return { transport, calls, auth, set: value => { conn = { ...conn, ...value }; }, fetch: fn => { fetcher = fn; } };
}
const opts = t => ({ context: t.captureConnection().readContext, signal: new AbortController().signal });

test('directory fallback reads only the captured taskchute root with JSON Accept', async () => {
  const s = setup(); await s.transport.readDirectory(opts(s.transport));
  assert.equal(s.calls[0][0], 'https://api.github.com/repos/fixture%20owner/fixture-repo/contents/taskchute?ref=fixture%2Fbranch');
  assert.equal(s.calls[0][1].method, 'GET');
  assert.equal(s.calls[0][1].headers.Accept, 'application/vnd.github+json');
  assert.equal((await s.transport.read('.', opts(s.transport))).ok, false);
  assert.equal(s.calls.length, 1);
});
test('directory body and auth side effects are rejected after a connection change', async () => {
  const s = setup(), body = deferred();
  s.fetch(async () => ({ ok: true, status: 200, text: () => body.promise }));
  const pending = s.transport.readDirectory(opts(s.transport)); await Promise.resolve();
  s.set({ repo: 'next' }); body.resolve('[]');
  assert.equal((await pending).ok, false); assert.deepEqual(s.auth, []);
});
test('captures encoded GET connection; exposes no credentials in revision/context', async () => {
  const s = setup(), captured = s.transport.captureConnection();
  assert.equal(JSON.stringify(captured).includes('synthetic-secret'), false);
  assert.deepEqual(await s.transport.read('dashboard/fund.json', { context: captured.readContext }), { ok: true, status: 200, text: 'body' });
  assert.equal(s.calls[0][0], 'https://api.github.com/repos/fixture%20owner/fixture-repo/contents/taskchute/dashboard/fund.json?ref=fixture%2Fbranch');
  assert.equal(s.calls[0][1].method, 'GET'); assert.equal(s.calls[0][1].cache, 'no-store');
  assert.deepEqual(s.auth, ['ok']);
});
test('all connection dimensions invalidate captured requests', async () => {
  for (const [key, value] of Object.entries({ ready: false, owner: 'next', repo: 'next', branch: 'next', token: 'next', prefix: 'next' })) {
    const s = setup(), request = opts(s.transport); s.set({ [key]: value });
    assert.equal((await s.transport.read('dashboard/fund.json', request)).ok, false);
    assert.equal(s.calls.length, 0);
  }
});
test('late 401 from old connection cannot mark new connection unauthorized', async () => {
  const s = setup(), response = deferred(); s.fetch(() => response.promise);
  const pending = s.transport.read('dashboard/fund.json', opts(s.transport));
  s.set({ repo: 'next' }); response.resolve({ ok: false, status: 401 });
  assert.equal((await pending).ok, false); assert.deepEqual(s.auth, []);
});
test('late body, aborted request, and A-B-A do not clear current auth failure', async () => {
  for (const mode of ['body', 'abort', 'aba']) {
    const s = setup(), body = deferred(), entered = deferred(), controller = new AbortController();
    s.fetch(async () => ({ ok: true, status: 200, text: () => { entered.resolve(); return body.promise; } }));
    const pending = s.transport.read('dashboard/fund-codex.json', { ...opts(s.transport), signal: controller.signal });
    await entered.promise;
    if (mode === 'body') s.set({ token: 'new' });
    if (mode === 'abort') controller.abort();
    if (mode === 'aba') { s.set({ repo: 'B' }); s.transport.invalidate(); s.set({ repo: 'fixture-repo' }); s.transport.invalidate(); }
    body.resolve('obsolete'); assert.equal((await pending).ok, false); assert.deepEqual(s.auth, []);
  }
});
test('current 401 is reported; 403/404 and rejected body never report success', async () => {
  const s = setup();
  for (const status of [401, 403, 404]) {
    s.fetch(async () => ({ ok: false, status }));
    assert.equal((await s.transport.read('dashboard/fund.json', opts(s.transport))).status, status);
  }
  s.fetch(async () => ({ ok: true, status: 200, text: async () => { throw Error('synthetic-secret'); } }));
  const result = await s.transport.read('dashboard/fund.json', opts(s.transport));
  assert.deepEqual(result, { ok: false, status: 0, text: '' }); assert.deepEqual(s.auth, ['denied']);
});
test('only agreed generated files may be fetched; forged context is rejected', async () => {
  const s = setup();
  for (const path of ['app-state.json', '../app-state.json', 'codex-fund/account.json', 'https://other.invalid', 'dashboard/fund-other.json'])
    assert.equal((await s.transport.read(path, opts(s.transport))).ok, false);
  assert.equal((await s.transport.read('dashboard/fund.json', { context: {} })).ok, false);
  assert.equal(s.calls.length, 0);
  for (const path of ['dashboard/fund-codex.json', 'dashboard/fund-codex-status.json', 'dashboard/fund-comparison.json', 'report-index.json', 'CODEX FUND日誌_2026-09-06.md', '朝の投資ブリーフ_CODEX_2026-09-06.md'])
    assert.equal((await s.transport.read(path, opts(s.transport))).ok, true);
});
test('gateway timeout bounds pending body and suppresses late auth side effects', async () => {
  const s = setup(), body = deferred();
  s.fetch(async () => ({ ok: true, status: 200, text: () => body.promise }));
  const gateway = createFundReadGateway({ ...s.transport, timeoutMs: 10 });
  const result = await gateway.load('fable');
  assert.equal(result.error, 'timeout'); assert.equal(s.calls[0][1].signal.aborted, true);
  body.resolve('{}'); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(s.auth, []); assert.equal(gateway.snapshot('fable').data, null); gateway.dispose();
});

})().catch(error => { console.error(error); process.exitCode = 1; });
