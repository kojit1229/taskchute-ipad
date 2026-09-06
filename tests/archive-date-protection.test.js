// Real sync entry points and pure archive proof; synthetic memory IO only, no browser/network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const ROOT = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const source = fs.readFileSync(path.join(ROOT, 'tests/remote-invalid-fail-close.test.js'), 'utf8');
const base = vm.runInNewContext(source.slice(source.indexOf('function base('), source.indexOf('const STATE_KEY')) + ';base');
const d = '2026-01-05', KEYS = ['journals', 'reports', 'feedback'];
const archive = Object.fromEntries(KEYS.map(key => [key, { [d]: `synthetic ${key}` }]));
const STATE = 'taskchute-journal-pwa-state-v1', SHA = 'taskchute-journal-last-synced-sha';
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
global.setTimeout = () => 0; global.clearTimeout = () => {};
let clock = Date.now(); Date.now = () => clock;
(async () => {
  const store = await import(pathToFileURL(path.join(ROOT, 'src/state/store.js')));
  const sync = await import(pathToFileURL(path.join(ROOT, 'src/sync/github.js')));
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/features/archive-date-protection.js')));
  const journal = await import(pathToFileURL(path.join(ROOT, 'src/features/journal.js')));
  for (const kind of ['equal', 'missing', 'malformed', 'different', 'read-error', 'same-second-edit', 'connection']) {
    await check('proof/' + kind, async () => {
      let current = clone(base()), cfg = { repo: 'synthetic', token: 'synthetic' };
      current.archivedDates = [d]; Object.assign(current, clone(archive));
      const proof = mod.createArchiveProtection({ getState: () => current, getConnection: () => cfg,
        readArchive: async () => {
          if (kind === 'read-error') throw new Error('synthetic network failure');
          if (kind === 'same-second-edit') current.journals[d] += ' new';
          if (kind === 'connection') cfg = { ...cfg, token: 'changed' };
          return kind === 'missing' ? null : kind === 'malformed' ? { journals: [] } :
            kind === 'different' ? { ...clone(archive), feedback: { [d]: 'other' } } : clone(archive);
        } });
      const before = clone(current);
      if (kind === 'equal') { await proof.prepare(null); proof.assert(null); }
      else await assert.rejects(proof.prepare(null), { name: 'ArchiveTextConflict' });
      if (kind !== 'same-second-edit') assert.deepEqual(current, before);
      else assert.ok(current.journals[d].endsWith(' new'));
    });
  }
  await check('proof/invalid-input-revokes-prior-evidence', async () => {
    const current = clone(base()); current.archivedDates = [d]; Object.assign(current, clone(archive));
    let reads = 0;
    const proof = mod.createArchiveProtection({ getState: () => current, getConnection: () => ({ repo: 'fixture' }),
      readArchive: async () => { reads++; return clone(archive); } });
    await proof.prepare(null); proof.assert(null);
    current.journals[d] = { invalid: true };
    await assert.rejects(proof.prepare(null), { name: 'ArchiveTextConflict' });
    current.journals[d] = archive.journals[d];
    assert.throws(() => proof.assert(null), { name: 'ArchiveTextConflict' });
    assert.equal(reads, 1);
    await proof.prepare(null); proof.assert(null); assert.equal(reads, 2);
  });
  async function flow(entry, kind) {
    clock += 100000;
    const local = clone(base()), remote = clone(base('2026-09-06T12:00:00'));
    local.settings.lastPushedAt = '2026-09-06T08:00:00';
    remote.settings.lastPushedAt = local.settings.lastPushedAt;
    local.archivedDates = [d]; Object.assign(local, clone(archive));
    Object.assign(remote, clone(archive));
    if (entry === 'startup') local.settings.autoSync = false;
    if (kind === 'remote-edit') remote.feedback[d] += ' new remote';
    if (kind === 'local-edit') local.journals[d] += ' new local';
    if (kind === 'backup-edit') { local.recurrences = [{ id: 'local' }]; remote.recurrences = [{ id: 'remote' }]; }
    store.setState(local);
    let expected = JSON.stringify(local), puts = 0, reads = 0, backups = 0, writes = 0, config = { branch: 'fixture', token: 'fixture' };
    const memory = new Map([[STATE, expected], [SHA, 'before-sha']]);
    global.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { writes++; memory.set(key, String(value)); } };
    global.window = { confirm: () => true };
    global.fetch = async (_url, options = {}) => {
      if (options.method === 'PUT') { puts++; return { ok: true, json: async () => ({ content: { sha: 'put-sha' } }) }; }
      if (kind === 'before-archive-connection') config = { ...config, token: 'during-state-get' };
      return { ok: true, json: async () => ({ content: JSON.stringify(remote), encoding: 'base64', sha: 'remote-sha' }) };
    };
    const notices = []; const noop = () => {};
    const edit = () => { store.state.journals[d] += ' same second'; expected = JSON.stringify(store.state); memory.set(STATE, expected); };
    sync.configureGithubSync({ normalizeState: value => value, nowDateTime: () => '2026-09-06T13:00:00',
      todayISO: () => '2026-09-06', addDays: value => value, isTouchedBlock: () => false,
      RECURRENCE_KEEP_PAST_DAYS: 7, RECURRENCE_FUTURE_DAYS: 31, SWIPE_TRIAGE_LOG_MAX: 200,
      showToast: message => notices.push(message), maintainRecurrences: noop, render: noop, renderDeferringForFocus: noop, runDailyOpen: () => false,
      saveState: () => localStorage.setItem(STATE, JSON.stringify(store.state)),
      requireGitHubConfig: () => config, fetchGitHubFileSHA: async () => 'remote-sha',
      personalDataReady: () => true, personalDataFileConfig: () => config,
      gitHubContentsURL: () => 'https://synthetic.invalid', githubHeaders: () => ({}), gitHubErrorMessage: () => 'synthetic error',
      fromBase64: value => value, toBase64: value => value, sanitizedStateForGitHub: () => store.state,
      maybeWriteBackupSnapshot: noop, updateAutoSaveStatus: noop, updateSyncDot: noop,
      renderSyncBanner: noop, clearSyncBannerDismissal: noop, clearPersonalDataAuthError: noop,
      pruneExpiredSuggestedThemes: value => value, _startupDataModifiedAt: local.dataModifiedAt,
      writeBackupSnapshotBeforeLoad: async () => { backups++; if (kind === 'backup-edit') edit(); return true; },
      readArchiveForSync: async () => { reads++; if (kind === 'await-edit') edit();
        if (kind === 'connection') config = { ...config, token: 'different' }; return clone(archive); } });
    if (entry === 'startup') await sync.syncFromGitHubOnStartup();
    if (entry === 'auto') await sync.runAutoSyncPull();
    if (entry === 'manual') await sync.loadFromGitHub();
    if (entry === 'push') await sync.runAutoSyncPush();
    if (entry === 'legacy') await sync.saveToGitHub(true);
    if (kind === 'before-archive-connection') assert.equal(reads, 0);
    else assert.ok(reads > 0, 'archive evidence actually requested');
    if (kind === 'equal') {
      for (const key of KEYS) assert.equal(store.state[key][d], undefined, 'equal archived text pruned normally');
      if (entry === 'push' || entry === 'legacy') assert.ok(puts > 0);
    } else {
      assert.equal(JSON.stringify(store.state), expected, 'all local data retained');
      assert.equal(memory.get(STATE), expected, 'persisted raw retained');
      assert.equal(memory.get(SHA), 'before-sha'); assert.equal(puts, 0); assert.equal(writes, 0);
      if (kind === 'backup-edit') assert.equal(backups, 1);
      const visible = entry === 'manual' ? notices.join(' ') : JSON.stringify(sync._syncBanner);
      assert.ok(visible.includes('端末の追記は保持'), 'archive-specific preservation message reaches UI: ' + visible);
    }
  }
  for (const entry of ['startup', 'auto', 'manual', 'push', 'legacy']) {
    for (const kind of ['equal', 'local-edit', 'remote-edit', 'await-edit', 'connection', 'before-archive-connection']) {
      await check(entry + '/' + kind, () => flow(entry, kind));
    }
  }
  for (const entry of ['manual', 'auto', 'startup', 'push']) await check(entry + '/edit-during-backup', () => flow(entry, 'backup-edit'));
  await check('readonly/ensure-and-morning', () => {
    const local = clone(base()); local.selectedDate = d; local.archivedDates = [d]; store.setState(local);
    journal.ensureJournal(d); assert.equal(local.journals[d], undefined);
    let saves = 0;
    journal.configureJournal({ saveAndRender: () => saves++, nowDateTime: () => '2026-09-06T13:00:00',
      upsertMorningLine: () => { throw new Error('archived journal must not be written'); } });
    journal.setMorningEnergy(4);
    assert.equal(local.settings.morningEnergyLog[d], 4); assert.ok(local.condition.logs[d].morningRecordedAt);
    assert.equal(local.journals[d], undefined); assert.equal(saves, 1);
    local.archivedDates = []; journal.ensureJournal(d); assert.ok(local.journals[d]);
  });
  await check('proof/no-permission-cannot-prune', () => {
    const local = clone(base()); local.archivedDates = [d]; local.journals[d] = 'unproven new note'; store.setState(local);
    assert.throws(() => sync.computeSyncMerge(clone(base()), 'local'), { name: 'ArchiveTextConflict' });
    assert.equal(local.journals[d], 'unproven new note');
  });
  await check('apply/rechecks-same-second-edit', async () => {
    const local = clone(base()); local.archivedDates = [d]; Object.assign(local, clone(archive)); store.setState(local);
    const remote = clone(base());
    await sync.prepareArchiveMerge(remote);
    const merged = sync.computeSyncMerge(remote, 'local'); assert.ok(merged);
    local.reports[d] += ' new report';
    assert.throws(() => sync.applySyncMergeToLocal(merged), { name: 'ArchiveTextConflict' });
    assert.throws(() => sync.applySyncMergeToRemote(merged, remote), { name: 'ArchiveTextConflict' });
    assert.ok(local.reports[d].endsWith(' new report'));
  });
  await check('apply/unregistered-merge-cannot-bypass-remote-proof', async () => {
    const local = clone(base()), remote = clone(base()); store.setState(local);
    remote.journals[d] = 'synthetic remote only';
    await sync.prepareArchiveMerge(remote);
    const merged = sync.computeSyncMerge(remote, 'remote');
    const localBefore = JSON.stringify(local), remoteBefore = JSON.stringify(remote);
    for (const fabricated of [clone(merged), { values: {}, changedVsLocal: false, changedVsRemote: false }]) {
      assert.throws(() => sync.applySyncMergeToLocal(fabricated), { name: 'ArchiveTextConflict' });
      assert.throws(() => sync.applySyncMergeToRemote(fabricated, remote), { name: 'ArchiveTextConflict' });
      assert.equal(JSON.stringify(local), localBefore); assert.equal(JSON.stringify(remote), remoteBefore);
    }
    sync.applySyncMergeToRemote(merged, remote);
    sync.applySyncMergeToLocal(merged);
    assert.equal(local.journals[d], remote.journals[d]);
    assert.equal(local.journals[d], 'synthetic remote only');
  });
  await check('writers/actual-app-guards', () => {
    const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    const local = clone(base()); local.archivedDates = [d]; local.selectedDate = d; Object.assign(local, clone(archive));
    let notices = 0;
    const env = { state: local, isArchivedDate: mod.isArchivedDate, ARCHIVED_READONLY_MESSAGE: mod.ARCHIVED_READONLY_MESSAGE,
      showToast: () => notices++, ensureJournal: () => { throw Error('must stop before generation'); } };
    let start = app.indexOf('function generateReport('), end = app.indexOf('\nfunction ', start + 1);
    const generate = vm.runInNewContext(app.slice(start, end) + ';generateReport', env);
    assert.equal(generate(d), archive.reports[d]);
    assert.equal(notices, 1);
    start = app.indexOf('  if (target.matches("[data-journal-date]"))'); end = app.indexOf('  // v61:', start);
    vm.runInNewContext('(function(){' + app.slice(start, end) + '})()', { ...env,
      target: { matches: () => true, dataset: { journalDate: d }, value: 'blocked input' } });
    start = app.indexOf('"save-tower-journal":'); end = app.indexOf('  "early-bird-check":', start);
    const handler = app.slice(start + '"save-tower-journal":'.length, end).trim().replace(/,$/, '');
    vm.runInNewContext('(' + handler + ')', env)({ target: { dataset: { date: d } } });
    assert.equal(notices, 3);
    for (const key of KEYS) assert.equal(local[key][d], archive[key][d]);
  });
  console.log(checks + ' checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

