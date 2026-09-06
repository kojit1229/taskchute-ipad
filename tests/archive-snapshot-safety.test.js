// Node-only: execute the real app functions with an in-memory GitHub transport.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const names = ['collectArchivable', 'runArchive'];
const functions = names.map(name => {
  const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node, `real function ${name} exists`);
  return source.slice(node.start, node.end);
}).join('\n');
const copy = value => JSON.parse(JSON.stringify(value));
const base = () => ({
  reports: { '2025-01-01': 'report' }, feedback: { '2025-01-01': 'feedback' },
  journals: { '2025-01-01': 'journal', '2026-09-05': 'recent' },
  blocks: [{ id: 'old', date: '2025-01-01', title: 'old block', updatedAt: 'same-second', sets: [{ reps: 3 }] },
    { id: 'recent', date: '2026-09-05', title: 'recent block' },
    { id: 'deleted', date: '2025-01-02', deleted: true, updatedAt: 'older' }],
  archivedDates: ['2024-01-01'], settings: { github: { repo: 'fixture' }, lastArchivedAt: 'previous' }
});
function fixture({ data = base(), archive = {}, onGet, onPut, failPut, failGet } = {}) {
  const remote = copy(archive), puts = [], messages = [];
  let saves = 0, renders = 0, gets = 0;
  const context = vm.createContext({
    state: data, ARCHIVE_TEXT_KEEP_DAYS: 90, ARCHIVE_BLOCK_KEEP_DAYS: 180, _archiveCache: 'cached',
    todayISO: () => '2026-09-06', addDays: (_, delta) => delta === -90 ? '2026-06-08' : '2026-03-10',
    nowDateTime: () => '2026-09-06T12:00:00', personalDataReady: () => true,
    personalDataConn: x => ({ ...x }), personalDataPath: p => p, gitHubFileURL: (_, p) => p,
    githubHeaders: () => ({}), toBase64: x => Buffer.from(x).toString('base64'),
    gitHubErrorMessage: async () => 'fixture failure', showToast: x => messages.push(x),
    console: { warn: x => messages.push(x) }, saveState: () => saves++, render: () => renders++,
    fetchGitHubJSONFile: async (_, file) => {
      gets++;
      if (onGet) await onGet(data, gets);
      if (failGet) throw new Error('GET failed');
      return Object.hasOwn(remote, file) ? { obj: copy(remote[file]), sha: 'fixture-sha' } : null;
    },
    fetch: async (file, options) => {
      const body = JSON.parse(options.body);
      const content = JSON.parse(Buffer.from(body.content, 'base64').toString());
      puts.push({ file, body, content });
      if (onPut) await onPut(data, puts.length);
      if (failPut === puts.length) return { ok: false };
      remote[file] = copy(content);
      return { ok: true };
    }
  });
  vm.runInContext(functions, context);
  return { data, remote, puts, messages, context, run: () => context.runArchive({ manual: true }),
    counts: () => ({ saves, renders, gets }) };
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
function retained(f, expected) {
  assert.deepEqual(f.data, expected);
  assert.equal(f.counts().saves, 0);
  assert.equal(f.counts().renders, 0);
  assert.equal(f.context._archiveCache, 'cached');
}
(async () => {
  await test('normal success saves all text and full nested Block before pruning, preserving recent/deleted items', async () => {
    const f = fixture(), initial = copy(f.data);
    await f.run();
    const archived = f.remote['archive/archive-2025.json'];
    assert.equal(archived.journals['2025-01-01'], 'journal');
    assert.equal(archived.reports['2025-01-01'], 'report');
    assert.equal(archived.feedback['2025-01-01'], 'feedback');
    assert.deepEqual(archived.blocks, [initial.blocks[0]]);
    assert.deepEqual(f.data.journals, { '2026-09-05': 'recent' });
    assert.equal(f.data.blocks[0].deleted, true);
    assert.equal(f.data.blocks[0].archivedAt, '2026-09-06T12:00:00');
    assert.equal(f.data.blocks[0].updatedAt, f.data.blocks[0].archivedAt);
    assert.equal(f.data.blocks[0].title, undefined);
    assert.deepEqual(f.data.blocks.slice(1), initial.blocks.slice(1));
    assert.deepEqual([...f.data.archivedDates], ['2024-01-01', '2025-01-01']);
    assert.equal(f.data.settings.lastArchivedAt, '2026-09-06T12:00:00');
    assert.deepEqual(f.counts(), { saves: 1, renders: 1, gets: 1 });
    assert.equal(f.context._archiveCache, null);
    await f.run();
    assert.equal(f.puts.length, 1, 'repeat after successful prune is no-op');
  });
  const mutations = {
    'journal edited': s => { s.journals['2025-01-01'] = 'edited'; },
    'report edited': s => { s.reports['2025-01-01'] = 'edited'; },
    'feedback edited': s => { s.feedback['2025-01-01'] = 'edited'; },
    'new old date': s => { s.journals['2025-02-01'] = 'new'; },
    'new empty old date': s => { s.journals['2025-02-01'] = ''; },
    'text cleared': s => { s.journals['2025-01-01'] = ''; },
    'text removed': s => { delete s.journals['2025-01-01']; },
    'same-second nested Block edit': s => { s.blocks[0].sets[0].reps = 9; },
    'new old Block': s => { s.blocks.push({ id: 'new', date: '2025-02-01' }); },
    'Block deleted': s => { s.blocks[0].deleted = true; },
    'Block moved out of archive range': s => { s.blocks[0].date = '2026-09-06'; }
  };
  for (const phase of ['onGet', 'onPut']) for (const [name, mutation] of Object.entries(mutations)) {
    await test(`${phase}: ${name} retains every local record and success marker`, async () => {
      let expected;
      const f = fixture({ [phase]: s => { mutation(s); expected = copy(s); } });
      await f.run();
      retained(f, expected);
      assert.ok(f.messages.some(x => x.includes('すべて保持')));
      assert.equal(f.puts[0].content.journals['2025-01-01'], 'journal');
      assert.equal(f.puts[0].content.blocks[0].sets[0].reps, 3, 'deep snapshot is immutable across await');
    });
  }
  for (const kind of ['journals', 'reports', 'feedback', 'blocks']) {
    await test(`different existing ${kind} rejects overwrite and local pruning`, async () => {
      const archived = { reports: {}, feedback: {}, journals: {}, blocks: [] };
      if (kind === 'blocks') archived.blocks.push({ ...base().blocks[0], title: 'remote version' });
      else archived[kind]['2025-01-01'] = 'remote version';
      const f = fixture({ archive: { 'archive/archive-2025.json': archived } }), initial = copy(f.data);
      await f.run(); retained(f, initial);
      assert.equal(f.puts.length, 0);
      assert.deepEqual(f.remote['archive/archive-2025.json'], archived);
      assert.ok(f.messages.some(x => x.includes('異なります')));
    });
  }
  await test('identical existing text and Block deduplicate while preserving archive-only records', async () => {
    const data = base();
    const archived = { journals: { '2025-01-01': 'journal', '2025-03-01': 'archive only' },
      blocks: [copy(data.blocks[0]), { id: 'archive-only', date: '2025-03-01', title: 'kept' }] };
    const f = fixture({ data, archive: { 'archive/archive-2025.json': archived } });
    await f.run();
    assert.equal(f.counts().saves, 1);
    assert.equal(f.puts[0].body.sha, 'fixture-sha', 'existing file update uses SHA');
    assert.equal(f.remote['archive/archive-2025.json'].blocks.length, 2);
    assert.equal(f.remote['archive/archive-2025.json'].journals['2025-03-01'], 'archive only');
  });
  await test('cutoff day stays local while cutoff-minus-one day is archived', async () => {
    const data = base();
    data.journals['2026-06-08'] = 'boundary'; data.journals['2026-06-07'] = 'older';
    data.blocks.push({ id: 'boundary', date: '2026-03-10' }, { id: 'older', date: '2026-03-09' });
    const f = fixture({ data }); await f.run();
    assert.equal(f.data.journals['2026-06-08'], 'boundary');
    assert.equal(f.data.journals['2026-06-07'], undefined);
    assert.equal(f.data.blocks.find(x => x.id === 'boundary').deleted, undefined);
    assert.equal(f.data.blocks.find(x => x.id === 'older').deleted, true);
  });
  for (const malformed of [null, [], 'bad', { journals: [] }, { blocks: {} }, { blocks: [null] }, { blocks: [{}] }]) {
    await test(`invalid archive ${JSON.stringify(malformed)} retains local data`, async () => {
      const f = fixture({ archive: { 'archive/archive-2025.json': malformed } }), initial = copy(f.data);
      await f.run(); retained(f, initial); assert.equal(f.puts.length, 0);
    });
  }
  await test('GET failure keeps all records', async () => {
    const f = fixture({ failGet: true }), initial = copy(f.data);
    await f.run(); retained(f, initial); assert.equal(f.puts.length, 0);
  });
  await test('second year PUT failure preserves both years; retry merges identical saved year and succeeds', async () => {
    const data = base(); data.journals['2024-02-01'] = 'earlier';
    const f = fixture({ data, failPut: 2 }), initial = copy(data);
    await f.run(); retained(f, initial);
    assert.equal(f.puts.length, 2);
    assert.equal(f.remote['archive/archive-2024.json'].journals['2024-02-01'], 'earlier');
    assert.equal(f.remote['archive/archive-2025.json'], undefined);
    await f.run();
    assert.equal(f.counts().saves, 1);
    assert.equal(f.puts.length, 4);
    assert.equal(f.remote['archive/archive-2025.json'].blocks.length, 1);
  });
  await test('edit during first attempt persists and next attempt reports archive conflict rather than deleting edit', async () => {
    const f = fixture({ onPut: (s, count) => { if (count === 1) s.journals['2025-01-01'] = 'edited'; } });
    await f.run(); const after = copy(f.data);
    await f.run(); retained(f, after);
    assert.equal(f.puts.length, 1);
    assert.equal(f.remote['archive/archive-2025.json'].journals['2025-01-01'], 'journal');
    assert.ok(f.messages.some(x => x.includes('異なります')));
  });
  await test('recent-only edits do not stop archiving and remain intact', async () => {
    const f = fixture({ onPut: s => { s.journals['2026-09-05'] = 'recent edited'; s.blocks[1].title = 'changed'; } });
    await f.run(); assert.equal(f.counts().saves, 1);
    assert.equal(f.data.journals['2026-09-05'], 'recent edited');
    assert.equal(f.data.blocks[1].title, 'changed');
  });
  console.log(`\n${passed} tests passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
