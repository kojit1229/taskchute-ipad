// 123 / R2-04: pure display/occupancy derivation, history, moves and provenance.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let count = 0;
const test = (name, run) => { run(); count++; console.log(`PASS ${name}`); };
const id = '11111111-1111-4111-8111-111111111111';
const time = { startTime: '09:00:00', endTime: '09:30:00', endDayOffset: 0 };
const stamp = (value, n = 1) => ({ value, updatedAt: `2026-09-09T10:00:0${n}`, changeId: `change-${n}` });
const child = (key, overrides = {}, seriesId = id) => ({ id: `schedule_${seriesId}_${key}`, formatVersion: 1,
  seriesId, occurrenceKey: key, overrides, createdAt: '2026-09-08T11:00:00', updatedAt: '2026-09-09T10:00:01' });
const copy = x => JSON.parse(JSON.stringify(x));
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
(async () => {
  const { deriveScheduleSeries: derive, schedulesWithSeriesForDate: view } = await import(pathToFileURL(path.join(__dirname, '../src/core/schedule-series-derive.js')).href);
  const { createSeriesMergeCandidate: create, mergeScheduleSeries: merge } = await import(pathToFileURL(path.join(__dirname, '../src/core/schedule-series-merge.js')).href);
  const base = (extra = {}) => create(Object.fromEntries(Object.entries({ id, anchorDate: '2026-09-08', pattern: { frequency: 'daily', until: '2026-09-14' },
    defaults: { title: 'initial', time, note: 'initial note' }, createdAt: '2026-09-08T08:00:00', updatedAt: '2026-09-08T08:00:01',
    changeId: '22222222-2222-4222-8222-222222222222', ...extra }).filter(([, value]) => value !== undefined)));
  const revision = (effectiveFrom, n, extra = {}) => ({ id: `change-${n}`, effectiveFrom,
    changes: { title: `title ${n}`, time: { startTime: '12:00:00', endTime: '12:30:00', endDayOffset: 0 }, note: `note ${n}`, ...extra },
    updatedAt: stamp(0, n).updatedAt, changeId: `change-${n}` });
  test('unchanged occurrences are computed with stable ids and no saved children', () => {
    const a = freeze(base()); const row = derive(a, '2026-09-08')[0];
    assert.equal(row.id, `schedule_${id}_2026-09-08`); assert.equal(row.title, 'initial');
    assert.equal(row.createdAt, a.scheduleSeries[0].createdAt); assert.equal(a.singleSchedules.length, 0);
    assert.deepEqual(derive(a, '2026-09-08'), derive(copy(a), '2026-09-08'));
  });
  test('8 to 9 move: two ids at destination, none at source; outside-window exceptions are scanned', () => {
    const a = base(); a.singleSchedules.push(child('2026-09-08', { date: stamp('2026-09-09') }));
    const rows = derive(a, '2026-09-09'); assert.equal(rows.length, 2);
    assert.deepEqual(new Set(rows.map(row => row.id)), new Set([`schedule_${id}_2026-09-08`, `schedule_${id}_2026-09-09`]));
    assert.equal(derive(a, '2026-09-08').length, 0);
    a.singleSchedules.push(child('2026-09-10', { date: stamp('2026-10-01') }));
    assert.equal(derive(a, '2026-10-01')[0].occurrenceKey, '2026-09-10');
  });
  test('cross-midnight uses same id and uncut interval; midnight endpoint is exclusive', () => {
    const a = base({ defaults: { title: 'night', note: '', time: { startTime: '23:30:00', endTime: '01:00:00', endDayOffset: 1 } } });
    const start = derive(a, '2026-09-08')[0], next = derive(a, '2026-09-09');
    assert.equal(next.length, 2); assert.deepEqual(next.find(row => row.id === start.id), start);
    assert.equal(start.plannedStartAt, '2026-09-08T23:30:00'); assert.equal(start.plannedEndAt, '2026-09-09T01:00:00');
    a.scheduleSeries[0].creation.value.defaults.time.endTime = '00:00:00';
    assert.equal(derive(a, '2026-09-09').length, 1);
  });
  test('completed occupies, explicit completion false remains, child and parent deletion do not occupy', () => {
    const a = base(); a.singleSchedules.push(child('2026-09-09', { completion: stamp({ completed: true }) }));
    assert.equal(derive(a, '2026-09-09')[0].completed, true);
    a.singleSchedules[0].overrides.completion = stamp({ completed: false }, 2);
    assert.equal(derive(a, '2026-09-09')[0].completed, false);
    a.singleSchedules[0].overrides.lifecycle = stamp({ deleted: true });
    a.singleSchedules[0].overrides.time = stamp(time, 3); assert.equal(derive(a, '2026-09-09').length, 0);
    a.scheduleSeries[0].lifecycle = stamp({ deleted: true }, 4); assert.equal(derive(a, '2026-09-10').length, 0);
  });
  test('history applies only if original and assigned date both meet effectiveFrom', () => {
    const a = base(); a.scheduleSeries[0].revisions.push(revision('2026-09-09', 2));
    a.singleSchedules.push(child('2026-09-08', { date: stamp('2026-09-10'), completion: stamp({ completed: true }) }));
    a.singleSchedules.push(child('2026-09-10', { date: stamp('2026-09-08') }));
    assert.equal(derive(a, '2026-09-08')[0].title, 'initial');
    const movedPast = derive(a, '2026-09-10').find(row => row.occurrenceKey === '2026-09-08');
    assert.equal(movedPast.title, 'initial'); assert.equal(movedPast.completed, true);
    assert.equal(derive(a, '2026-09-09')[0].title, 'title 2');
    const b = base(); b.singleSchedules.push(child('2026-09-08', { completion: stamp({ completed: true }) }));
    const before = derive(b, '2026-09-08'); b.scheduleSeries[0].revisions.push(revision('2026-09-09', 2));
    assert.deepEqual(derive(b, '2026-09-08'), before);
  });
  test('settings and pattern choose largest change order, not latest effective date or array order', () => {
    const a = base(); a.scheduleSeries[0].revisions.push(revision('2026-09-10', 1, { pattern: { frequency: 'weekly', until: '2026-09-14' } }),
      revision('2026-09-09', 3, { pattern: { frequency: 'daily', until: '2026-09-14' } }));
    assert.equal(derive(a, '2026-09-11')[0].title, 'title 3');
    assert.equal(derive(a, '2026-09-11')[0].updatedAt, stamp(0, 3).updatedAt);
    const before = derive(a, '2026-09-11'); a.scheduleSeries[0].revisions.reverse();
    assert.deepEqual(derive(a, '2026-09-11'), before);
  });
  test('shortening/weekday rules remove only unchanged rows; saved exceptions persist and extension reuses id', () => {
    const a = base(); const original = derive(a, '2026-09-11')[0].id;
    a.singleSchedules.push(child('2026-09-10', { note: stamp('personal', 4) }));
    a.scheduleSeries[0].revisions.push(revision('2026-09-09', 2, { pattern: { frequency: 'daily', until: '2026-09-09' } }));
    assert.equal(derive(a, '2026-09-11').length, 0);
    assert.equal(derive(a, '2026-09-10')[0].individuallyModified, true);
    assert.equal(derive(a, '2026-09-10')[0].note, 'personal');
    a.scheduleSeries[0].revisions.push(revision('2026-09-09', 5, { pattern: { frequency: 'daily', until: '2026-09-14' } }));
    assert.equal(derive(a, '2026-09-11')[0].id, original);
    assert.equal(a.singleSchedules.length, 1); assert.equal(derive(a, '2026-09-10')[0].note, 'note 5');
  });
  test('clear restores current series fields and original date; explicit values protect a date move', () => {
    const a = base(); a.scheduleSeries[0].revisions.push(revision('2026-09-09', 2));
    const clear = { cleared: true, updatedAt: stamp(0, 4).updatedAt, changeId: 'clear-4' };
    a.singleSchedules.push(child('2026-09-10', { date: clear, title: clear, note: clear, time: clear }));
    const restored = derive(a, '2026-09-10')[0]; assert.equal(restored.title, 'title 2');
    assert.equal(restored.date, '2026-09-10'); assert.equal(restored.plannedStartAt, '2026-09-10T12:00:00');
    a.singleSchedules[0].overrides = { date: stamp('2026-09-08', 5), title: stamp(restored.title, 5),
      note: stamp(restored.note, 5), time: stamp({ startTime: '12:00:00', endTime: '12:30:00', endDayOffset: 0 }, 5) };
    const moved = derive(a, '2026-09-08').find(row => row.occurrenceKey === '2026-09-10');
    assert.equal(moved.title, restored.title); assert.equal(moved.note, restored.note);
    assert.equal(moved.plannedStartAt, '2026-09-08T12:00:00');
  });
  test('weekend direct series starts on Monday while converted weekend origin remains', () => {
    const a = base({ anchorDate: '2026-09-12', pattern: { frequency: 'weekdays', until: '2026-09-14' } });
    assert.equal(derive(a, '2026-09-12').length, 0); assert.equal(derive(a, '2026-09-14').length, 1);
    const b = base({ originSchedule: { id: 'U', title: 'weekend', date: '2026-09-12', plannedStartAt: '2026-09-12T09:00:00',
      plannedEndAt: '2026-09-12T09:30:00' }, anchorDate: '2026-09-12', defaults: undefined,
      pattern: { frequency: 'weekdays', until: '2026-09-14' } });
    assert.equal(derive(b, '2026-09-12')[0].id, 'U'); assert.equal(derive(b, '2026-09-12')[0].individuallyModified, true);
  });
  test('A/B/C anchor reassociation merges only display; former general tombstone stays separate', () => {
    const candidates = ['08', '09', '10'].map((day, i) => base({ anchorDate: `2026-09-${day}`, defaults: undefined,
      originSchedule: { id: 'U', title: 'origin', date: `2026-09-${day}`, plannedStartAt: `2026-09-${day}T09:00:00`,
        plannedEndAt: `2026-09-${day}T09:30:00`, updatedAt: '2026-09-08T08:00:00' }, updatedAt: `2026-09-08T09:00:0${i}` }));
    candidates[0].singleSchedules.push(child('2026-09-09', { lifecycle: stamp({ deleted: true }, 4) }, 'series_U'));
    const ab = merge(candidates[0], candidates[1]), before = JSON.stringify(ab);
    assert.equal(derive(ab, '2026-09-09').length, 0); assert.equal(JSON.stringify(ab), before);
    const abc = merge(ab, candidates[2]); assert.equal(derive(abc, '2026-09-10')[0].id, 'U');
    assert.equal(derive(abc, '2026-09-09').length, 0);
    assert.equal(abc.singleSchedules[0].overrides.lifecycle.value.deleted, false);
    assert.equal(abc.singleSchedules[1].overrides.lifecycle.value.deleted, true);
    assert.deepEqual(derive(abc, '2026-09-10'), derive(merge(candidates[0], merge(candidates[1], candidates[2])), '2026-09-10'));
  });
  test('normal singles and series share 04-shaped records; 100 displays/day change/reload do no IO', () => {
    const a = base(); a.singleSchedules.push({ id: 'single', title: 'plain', date: '2026-09-09',
      plannedStartAt: '2026-09-09T08:00:00', plannedEndAt: '2026-09-09T08:30:00' });
    const snapshot = JSON.stringify(a); freeze(a); const oldNow = Date.now, oldRandom = Math.random;
    let issued = 0; Date.now = Math.random = () => { issued++; throw Error('clock/random forbidden'); };
    try {
      const expected = view(a, '2026-09-09'); assert.equal(expected.records.length, 2); assert.deepEqual(expected.warnings, []);
      for (let i = 0; i < 100; i++) assert.deepEqual(view(a, '2026-09-09'), expected);
      view(a, '2026-09-10'); assert.deepEqual(view(copy(a), '2026-09-09'), expected);
      assert.equal(JSON.stringify(a), snapshot); assert.equal(issued, 0);
    } finally { Date.now = oldNow; Math.random = oldRandom; }
  });
  test('numeric calendar year/leap boundaries agree in UTC and Japan settings', () => {
    const oldTZ = process.env.TZ;
    try {
      for (const [anchor, next] of [['2026-12-31', '2027-01-01'], ['2028-02-29', '2028-03-01']]) {
        const a = base({ anchorDate: anchor, pattern: { frequency: 'daily', until: next },
          defaults: { title: 'night', note: '', time: { startTime: '23:30:00', endTime: '00:30:00', endDayOffset: 1 } } });
        process.env.TZ = 'UTC'; const utc = derive(a, next); process.env.TZ = 'Asia/Tokyo';
        assert.deepEqual(derive(a, next), utc); assert.equal(utc[0].plannedEndAt, `${next}T00:30:00`);
      }
    } finally { if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ; }
  });
  console.log(`${count} tests passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
