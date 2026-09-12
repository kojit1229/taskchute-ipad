const assert = require('node:assert/strict');
const sync = require('../src/sync/github.js');
const store = require('../src/state/store.js');
const { mergeReadingEvidence } = require('../src/core/daily-reading-sync.js');
const { buildDailyReading } = require('../src/core/daily-reading.js');
const rec = require('../src/core/recurrence.js');
const { mergeRecords } = require('../src/core/merge.js');
const DAY = '2026-09-12', EARLY = `${DAY}T09:00:00`, LATE = `${DAY}T10:00:00`, NOW = `${DAY}T12:00:00`;
const clone = value => structuredClone(value);
const noop = () => {};
const parseDate = text => { const [y, m, d] = text.split('-').map(Number); return new Date(y, m - 1, d); };
rec.configureRecurrence({ parseDate, nowDateTime: () => EARLY });
const deps = { today: () => DAY, readingCurrent: () => true, readingMatches: rec.recurrenceMatchesDate, readingInstance: rec.makeRecurrenceInstance };
function fixture(fixed = true) {
  return { dataModifiedAt: EARLY, settings: { dailyReadingRecordEnabled: false, dailyReadingRoutineIds: { affirmation: 'a', visionBoard: 'v' },
    journalTemplate: '', morningEnergyLog: {}, github: { token: 'fixture', dataOwner: 'fixture', dataRepo: 'fixture' }, autoSync: true, lastPushedAt: '' },
    recurrences: ['a', 'v'].map(id => ({ id, title: id, category: 'ルーティン', kind: 'daily', anchorDate: DAY,
      streakSince: fixed ? DAY : '', startTime: '08:00', endTime: '08:30' })),
    blocks: [], tasks: [], projects: [], journalMeta: {}, journals: {}, feedback: {}, reports: {},
    condition: { logs: {} }, sleep: { logs: {} }, zeroThinking: { entries: [], suggestedThemes: [], groups: [] },
    habitStreaks: {}, habitPinHistory: {}, earlyBird: {}, declarations: [], questions: [], experiments: [], aiScheduleHistory: [],
    dailyDeclarations: {}, weeklyWishes: {}, bodyScans: [], writeMeditations: [], storeVisits: [], tracks: [], trackMeasurements: [],
    weeklyCommitments: [], swipeTriageLog: [], gardenLog: {}, coachLog: { meals: [] }, aiStepProcessedIds: [],
    aiStepDismissedIds: [], aiStepPendingRequests: [], archivedDates: [], singleSchedules: [] };
}
function success(side, at = LATE, kind = 'affirmation') {
  const result = buildDailyReading({ ...side, settings: { ...side.settings, dailyReadingRecordEnabled: true } }, {
    kind, date: DAY, referenceDate: kind === 'feedback' ? '2026-09-11' : DAY, recordedAt: at,
    routineIds: side.settings.dailyReadingRoutineIds, displayed: true
  }, deps);
  assert.ok(result.records.length);
  side.blocks = result.records.filter(row => row.kind === 'blocks').map(row => row.after);
  for (const value of result.values) side[value.key] = value.after;
  side.dataModifiedAt = at;
  return side;
}
function merged(local, remote) {
  store.setState(local);
  return sync.computeSyncMerge(remote, 'local');
}
let clock = new Date(2026, 8, 12, 12).getTime();
Date.now = () => clock;
let remoteState, puts, confirms, failStorage, fetchEdit, saved;
function configure(local, remote, options = {}) {
  clock += 120000; remoteState = clone(remote); puts = []; confirms = 0; failStorage = options.failStorage; fetchEdit = options.fetchEdit;
  const memory = new Map([['taskchute-journal-last-synced-sha', 'prior']]);
  saved = clone(local);
  global.localStorage = { getItem: key => memory.get(key) || null, removeItem: key => memory.delete(key), setItem: (key, value) => {
    if (key === 'taskchute-journal-pwa-state-v1') { if (failStorage) throw Error('fixture disk full'); saved = JSON.parse(value); }
    memory.set(key, value);
  } };
  global.window = { confirm: () => { confirms++; return true; } };
  global.fetch = async (_url, init = {}) => {
    if (init.method === 'PUT') {
      const payload = JSON.parse(init.body); puts.push(JSON.parse(payload.content)); remoteState = JSON.parse(payload.content);
      return { ok: true, json: async () => ({ content: { sha: 'sent' } }) };
    }
    const text = JSON.stringify(remoteState);
    if (fetchEdit) { const edit = fetchEdit; fetchEdit = null; edit(store.state); }
    return { ok: true, json: async () => ({ content: text, encoding: 'base64', sha: 'remote' }) };
  };
  sync.configureGithubSync({ normalizeState: clone, nowDateTime: () => NOW, todayISO: () => DAY,
    addDays: (date, days) => { const value = parseDate(date); value.setDate(value.getDate() + days); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; },
    isTouchedBlock: b => !!(b.completed || b.actualStartAt || b.actualEndAt || b.deleted || b.source === 'daily-reading-manual'),
    RECURRENCE_KEEP_PAST_DAYS: 7, RECURRENCE_FUTURE_DAYS: 31, SWIPE_TRIAGE_LOG_MAX: 200,
    showToast: noop, maintainRecurrences: noop, render: noop, runDailyOpen: () => false, saveState: () => { throw Error('nontransactional save'); },
    renderDeferringForFocus: noop, requireGitHubConfig: () => local.settings.github, fetchGitHubFileSHA: async () => 'remote',
    personalDataReady: () => true, personalDataFileConfig: () => ({ owner: 'fixture', repo: 'fixture', branch: 'fixture', token: 'fixture' }),
    gitHubContentsURL: () => 'https://fixture.invalid/state', githubHeaders: () => ({}), gitHubErrorMessage: async () => 'fixture failure',
    fromBase64: x => x, toBase64: x => x, sanitizedStateForGitHub: () => clone(store.state), maybeWriteBackupSnapshot: noop,
    writeBackupSnapshotBeforeLoad: async () => true, updateAutoSaveStatus: noop, updateSyncDot: noop,
    renderSyncBanner: noop, clearSyncBannerDismissal: noop, clearPersonalDataAuthError: noop,
    pruneExpiredSuggestedThemes: x => x, _startupDataModifiedAt: local.dataModifiedAt, readArchiveForSync: async () => ({}) });
  store.setState(local);
}
async function run() {
  configure(fixture(), fixture());
  for (const fixed of [false, true]) for (const other of ['missing', 'unexecuted', 'success']) for (const reverse of [false, true]) {
    const a = success(fixture(fixed)), b = fixture(fixed);
    if (other === 'unexecuted') b.blocks = [rec.makeRecurrenceInstance(b.recurrences[0], DAY)];
    if (other === 'success') success(b, EARLY);
    const pair = reverse ? [b, a] : [a, b], before = clone(pair), result = merged(...pair);
    assert.deepEqual(pair, before); assert.deepEqual(result.values.blocks, a.blocks);
    if (fixed) assert.equal(result.values.reading.habitStreaks.a.logs[DAY].doneAt, LATE);
    else assert.deepEqual(result.values.reading.habitStreaks, {});
    for (const entry of ['syncFromGitHubOnStartup', 'loadFromGitHub', 'runAutoSyncPull', 'saveToGitHub', 'runAutoSyncPush']) {
      configure(clone(pair[0]), pair[1]); await sync[entry]();
      assert.deepEqual(store.state.blocks, a.blocks, `${entry}/${fixed}/${other}/${reverse}`);
      if (fixed) assert.equal(store.state.habitStreaks.a.logs[DAY].doneAt, LATE, entry);
      assert.equal(store.state.settings.dailyReadingRecordEnabled, false);
      assert.equal(confirms, 0, 'proven reading differences do not ask for destructive replacement');
      for (const value of puts) {
        assert.deepEqual(value.blocks, a.blocks);
        if (fixed) assert.equal(value.habitStreaks.a.logs[DAY].doneAt, LATE);
      }
    }
  }
  console.log('PASS fixed/unfixed, missing/unexecuted/success, both directions, all five sync entrances');
  for (const reverse of [false, true]) {
    const a = success(fixture()), b = success(fixture(), EARLY);
    b.blocks[0].updatedAt = a.blocks[0].updatedAt;
    const pair = reverse ? [b, a] : [a, b], result = merged(...pair);
    assert.deepEqual(result.values.blocks, pair[0].blocks);
    assert.equal(result.values.reading.habitStreaks.a.logs[DAY].doneAt, reverse ? EARLY : LATE);
    const tomb = clone(a); tomb.blocks[0] = { ...tomb.blocks[0], source: 'daily-reading-manual', deleted: true };
    const deleted = merged(...(reverse ? [tomb, a] : [a, tomb]));
    assert.equal(deleted.values.blocks[0].deleted, true);
    assert.equal(deleted.values.reading.habitStreaks.a.logs[DAY], undefined);
  }
  console.log('PASS equal stamps keep full local winner; tombstone wins ties and never restores habit');
  const a = success(fixture()), b = fixture();
  for (const mutate of [
    s => { delete s.habitStreaks.a; }, s => { s.blocks[0].actualEndAt = EARLY; },
    s => { s.blocks[0].externalRef = 'daily-reading:v1:{}'; }, s => { s.habitStreaks.a.logs[DAY].doneAt = EARLY; },
    s => { s.recurrences[0].exceptionDates = [DAY]; }, s => { s.recurrences[0].deleted = true; },
    s => { s.habitPinHistory.a = [{ from: DAY }]; }, s => { s.habitStreaks.a.logs['2026-09-11'] = { doneAt: EARLY }; },
    s => { s.settings.dailyReadingRoutineIds.visionBoard = 'missing'; }, s => { s.archivedDates = [DAY]; }
  ]) {
    const invalid = clone(a); mutate(invalid);
    for (const pair of [[invalid, b], [b, invalid]]) {
      configure(clone(pair[0]), pair[1]); const originals = clone([store.state, remoteState]);
      assert.throws(() => merged(store.state, clone(pair[1])), { name: 'DailyReadingSyncConflict' });
      for (const entry of ['loadFromGitHub', 'runAutoSyncPull', 'saveToGitHub', 'runAutoSyncPush', 'syncFromGitHubOnStartup']) {
        clock += 120000; await sync[entry]();
        assert.deepEqual([store.state, remoteState], originals, entry); assert.equal(puts.length, 0);
      }
    }
  }
  console.log('PASS malformed provenance, habit-only deletion, unrelated core differences, archive and missing definitions stop all writes');
  for (const entry of ['loadFromGitHub', 'runAutoSyncPull', 'saveToGitHub', 'runAutoSyncPush', 'syncFromGitHubOnStartup']) {
    configure(fixture(), a, { failStorage: true }); const before = clone(store.state);
    await sync[entry](); assert.deepEqual(store.state, before, entry); assert.deepEqual(saved, before); assert.equal(puts.length, 0);
    configure(fixture(), a, { fetchEdit: side => { side.recurrences[0].exceptionDates = [DAY]; } });
    await sync[entry](); assert.deepEqual(store.state.blocks, []); assert.equal(puts.length, 0);
  }
  console.log('PASS storage failure keeps originals; edits during fetch are rechecked');
  for (const reverse of [false, true]) {
    const configured = fixture(), empty = fixture(); delete empty.settings.dailyReadingRoutineIds;
    const pair = reverse ? [configured, empty] : [empty, configured], result = merged(...pair);
    assert.deepEqual(result.values.reading.routineIds, configured.settings.dailyReadingRoutineIds);
    assert.equal(result.values.reading.changed[reverse ? 1 : 0], true);
    const different = fixture(); different.settings.dailyReadingRoutineIds = { affirmation: 'v', visionBoard: 'a' };
    assert.throws(() => merged(configured, different), { name: 'DailyReadingSyncConflict' });
    different.dataModifiedAt = LATE;
    assert.deepEqual(merged(configured, different).values.reading.routineIds, different.settings.dailyReadingRoutineIds);
  }
  const noFixed = success(fixture(false), LATE, 'feedback');
  assert.deepEqual(merged(fixture(false), noFixed).values.reading.habitStreaks, {});
  const old = success(fixture()); old.blocks[0].updatedAt = ''; old.blocks[0].createdAt = EARLY;
  assert.deepEqual(merged(old, a).values.blocks, a.blocks);
  const same = merged(a, clone(a));
  assert.equal(same.values.reading.changed[0], false); assert.deepEqual(same.values.blocks, a.blocks);
  console.log('PASS setting pair selection, AI, timestamp fallback and idempotent proof');
}
run().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
