// Order 46 / R1: twyWeeklyReviews normalization, writes and real sync wiring (Node only).
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const acorn = require('acorn');
let assertions = 0;
const eq = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const parse = source => acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const findFunction = (ast, name) => ast.body.map(n => n.declaration || n)
  .find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
const start = '2026-09-26', t1 = '2026-09-28T10:00:00', t2 = '2026-09-28T11:00:00';
const id = `wr_${start}_p1`;

(async () => {
  // Execute the real normalizeState assignment and real compactArr, as daily-order-core does.
  const app = read('app.js'), ast = parse(app);
  const normalizer = findFunction(ast, 'normalizeState');
  const compact = findFunction(ast, 'compactArr');
  const assignment = normalizer.body.body.find(n => n.type === 'ExpressionStatement'
    && n.expression.left?.object?.name === 'value' && n.expression.left?.property?.name === 'twyWeeklyReviews');
  assert(assignment && compact, 'actual normalization and compactArr must exist'); assertions++;
  let serial = 0;
  function normalize(value) {
    const context = { value, nowDateTime: () => t2, crypto: { randomUUID: () => `uuid-${++serial}` } };
    vm.runInNewContext(app.slice(compact.start, compact.end) + '\n' + app.slice(assignment.start, assignment.end), context);
    return JSON.parse(JSON.stringify(context.value));
  }
  eq(normalize({}).twyWeeklyReviews, []);
  eq(normalize({ twyWeeklyReviews: null }).twyWeeklyReviews, []);
  eq(normalize({ twyWeeklyReviews: [null, false, 'bad', 1, []] }).twyWeeklyReviews, []);
  const defaults = { weekStart: start, projectId: 'p1', cycleStartDate: '', aim: '', wentWell: '',
    obstacles: '', reviewedAt: '', deleted: false, id, createdAt: t2, updatedAt: '' };
  eq(normalize({ twyWeeklyReviews: [null, { weekStart: start, projectId: 'p1' }] }).twyWeeklyReviews, [defaults]);
  const existing = { ...defaults, id: 'kept', aim: 'focus', wentWell: 'done', obstacles: 'rain',
    cycleStartDate: '2026-08-01', reviewedAt: t1, createdAt: t1, updatedAt: t1, deleted: true };
  eq(normalize({ twyWeeklyReviews: [existing] }).twyWeeklyReviews, [existing], 'existing fields/timestamps preserved');
  eq(normalize({ twyWeeklyReviews: [{ weekStart: start }] }).twyWeeklyReviews[0].id, `wr_${start}_`);
  eq(normalize({ twyWeeklyReviews: [{ projectId: 'p1' }] }).twyWeeklyReviews[0].id, 'wr__p1');
  const anonymous = normalize({ twyWeeklyReviews: [{}, {}] }).twyWeeklyReviews;
  eq(anonymous.map(r => r.id), ['wr_uuid-1', 'wr_uuid-2']);
  eq(normalize({ twyWeeklyReviews: anonymous }).twyWeeklyReviews, anonymous, 'normalizing again is stable');
  eq(normalize({ twyWeeklyReviews: [{ createdAt: t1 }] }).twyWeeklyReviews[0].updatedAt, '');

  const store = await import('../src/state/store.js');
  const feature = await import('../src/features/twelve-week.js');
  let now = t1;
  feature.configureTwelveWeek({ nowDateTime: () => now });
  store.setState({});
  const first = feature.upsertWeeklyReview(start, 'p1', { aim: 'focus', wentWell: 'done', cycleStartDate: '2026-08-01' });
  eq(first, { ...defaults, createdAt: t1, updatedAt: t1, aim: 'focus', wentWell: 'done', cycleStartDate: '2026-08-01' });
  eq(store.state.twyWeeklyReviews[0], first);
  now = t2;
  const second = feature.upsertWeeklyReview(start, 'p1', { obstacles: 'rain', id: 'wrong', createdAt: 'wrong', updatedAt: 'wrong' });
  eq(store.state.twyWeeklyReviews.length, 1);
  eq(second === first, false, 'same id replaces the record');
  eq(second, { ...first, obstacles: 'rain', updatedAt: t2 });
  eq(first.updatedAt, t1, 'replacement does not mutate previous object');
  const other = feature.upsertWeeklyReview(start, 'p2', {});
  eq(other.id, `wr_${start}_p2`);
  now = '2026-09-28T12:00:00';
  const deleted = feature.deleteWeeklyReview(id);
  eq(deleted, { ...second, deleted: true, updatedAt: now });
  eq(store.state.twyWeeklyReviews.length, 2, 'delete keeps tombstone');
  eq(store.state.twyWeeklyReviews[1], other);
  eq(feature.deleteWeeklyReview('missing'), null);
  eq(Object.keys(store.state), ['twyWeeklyReviews'], 'writer only mutates review data');

  const sync = await import('../src/sync/github.js');
  sync.configureGithubSync({ normalizeState: x => x, nowDateTime: () => now, todayISO: () => '2026-09-28',
    addDays: d => d, isTouchedBlock: () => false, SWIPE_TRIAGE_LOG_MAX: 200,
    personalDataFileConfig: () => ({}), pruneExpiredSuggestedThemes: x => x });
  function base(reviews) {
    return { settings: { journalTemplate: '', morningEnergyLog: {}, github: {},
      avoidList: [], categories: [], lifeAreas: [], vision: '', affirmation: '',
      twelveWeekStartDate: '', twelveWeekScoreTarget: 85, birthDate: '', battery: {},
      gymExerciseList: [], visionDirectCategories: [] },
      journalMeta: {}, journals: {}, feedback: {}, condition: { logs: {} }, sleep: { logs: {} },
      blocks: [], zeroThinking: { entries: [], suggestedThemes: [] }, dailyDeclarations: {}, weeklyWishes: {},
      bodyScans: [], writeMeditations: [], tasks: [], projects: [], storeVisits: [], swipeTriageLog: [],
      gardenLog: {}, reports: {}, chainRuns: [], feedbackFiles: [], feedbackIngestedDates: [],
      migrationRitualLog: [], zeroSecThemeLog: [], aiWorkProcessedIds: [],
      recurrences: [], declarations: [], questions: [], experiments: [], aiScheduleHistory: [], ironImport: {},
      aiStepProcessedIds: [], aiStepDismissedIds: [], aiStepPendingRequests: [],
      ...(reviews === undefined ? {} : { twyWeeklyReviews: reviews }) };
  }
  const row = { ...first }, newer = { ...row, aim: 'new', updatedAt: t2 };
  const cases = [
    ['local only', [row], [], 'local', [row], false, true],
    ['remote only', [], [row], 'local', [row], true, false],
    ['remote newer', [row], [newer], 'local', [newer], true, false],
    ['local newer', [newer], [row], 'remote', [newer], false, true],
    ['tie local', [row], [{ ...row, aim: 'remote' }], 'local', [row], false, true],
    ['tie remote', [{ ...row, aim: 'local' }], [row], 'remote', [{ ...row, aim: 'local' }], false, true],
    ['old remote', [row], undefined, 'remote', [row], false, true],
    ['old local', undefined, [row], 'local', [row], true, false],
    ['both old', undefined, undefined, 'local', [], false, false],
    ['same reference', [row], [row], 'local', [row], false, false],
    ['tombstone newer', [row], [deleted], 'local', [deleted], true, false],
    ['union', [row], [other], 'local', [row, other], true, true]
  ];
  const failures = [];
  for (const [name, local, remote, tie, expected, changedLocal, changedRemote] of cases) {
    try {
      store.setState(base(local)); const remoteState = base(remote);
      const merged = sync.computeSyncMerge(remoteState, tie);
      assert(merged, name + ': merge succeeds'); assertions++;
      if (name !== 'both old') eq(merged.values.twyWeeklyReviews, expected, name);
      eq(merged.changedVsLocal, changedLocal, name + ': changedVsLocal');
      eq(merged.changedVsRemote, changedRemote, name + ': changedVsRemote');
      sync.applySyncMergeToLocal(merged);
      if (name !== 'both old') eq(store.state.twyWeeklyReviews, expected, name + ': apply local');
      sync.applySyncMergeToRemote(merged, remoteState);
      if (name !== 'both old') eq(remoteState.twyWeeklyReviews, expected, name + ': apply remote');
      if (name !== 'both old') eq(JSON.parse(JSON.stringify(store.state)).twyWeeklyReviews, expected, name + ': JSON round trip');
    } catch (error) { failures.push(error); console.error(error); }
  }
  // Inspect the actual function's keys declaration, not a whole-file substring match.
  const source = read('src/sync/github.js'), syncAst = parse(source);
  const adopt = findFunction(syncAst, 'adoptSyncResult');
  const adoptSource = source.slice(adopt.start, adopt.end);
  assert.match(adoptSource, /const keys = \[[\s\S]*?"twyWeeklyReviews"[\s\S]*?\];/); assertions++;
  // App must inject the clock into the exported writer's dependency configuration.
  const injection = ast.body.find(n => n.type === 'ExpressionStatement' && n.expression.callee?.name === 'configureTwelveWeek');
  eq(injection.expression.arguments[0].properties.some(p => p.key.name === 'nowDateTime'), true);
  console.log(`weekly-reviews-core: ${assertions} assertions, ${failures.length} failed cases (a-e)`);
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
