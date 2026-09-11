// 123 / R2-03: pure series merge, field ordering, mixed singles, provenance.
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
let count = 0;
const test = (name, run) => { run(); count++; console.log(`PASS ${name}`); };
const stamp = (value, n = 1, changeId = `request-${n}`) => ({ value, updatedAt: `2026-09-08T10:00:0${n}`, changeId });
const single = (extra = {}) => ({ id: 'U', title: 'reading', date: '2026-09-08',
  plannedStartAt: '2026-09-08T09:00:00', plannedEndAt: '2026-09-08T09:30:00',
  createdAt: '2026-09-01T08:00:00', updatedAt: '2026-09-08T08:00:00', ...extra });
const input = originSchedule => ({ originSchedule, pattern: { frequency: 'daily', until: '2026-09-14' },
  changeId: '11111111-1111-4111-8111-111111111111', createdAt: '2026-09-08T08:30:00', updatedAt: '2026-09-08T08:30:01' });
const copy = x => JSON.parse(JSON.stringify(x));
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
const permutations = xs => xs.length ? xs.flatMap((x, i) => permutations(xs.filter((_, j) => i !== j)).map(t => [x, ...t])) : [[]];
(async () => {
  const { mergeScheduleSeries: merge, createSeriesMergeCandidate: create, legacySeriesOccurrence: legacy,
    chooseSeriesChange: choose } = await import(pathToFileURL(path.join(__dirname, '../src/core/schedule-series-merge.js')).href);
  const base = () => create(input(single()));
  const child = (key, overrides) => ({ id: `schedule_series_U_${key}`, seriesId: 'series_U', occurrenceKey: key,
    formatVersion: 1, overrides, createdAt: '2026-09-08T09:00:00', updatedAt: '2026-09-08T09:00:00' });
  test('creation adapter keeps original six stamps, defaults, unknown UTF-8 bytes and no derived fields', () => {
    const source = single({ extra: { text: '日本語\n', order: ['b', 'a'] } });
    const result = create(input(freeze(source))), row = result.singleSchedules[0];
    assert.equal(row.updatedAt, source.updatedAt); assert.equal(row.createdAt, source.createdAt);
    assert.equal(Object.keys(row.overrides).length, 6); assert.equal(row.overrides.completion.value.completed, false);
    assert.deepEqual(row.legacyExtras.value, { extra: source.extra });
    const decoded = JSON.parse(Buffer.from(row.overrides.title.changeId.slice(7), 'hex').toString('utf8'));
    assert.deepEqual(decoded.extra, source.extra); assert.equal(decoded.deleted, false);
    assert.equal(row.title, undefined); assert.equal(row.deleted, undefined);
    assert.deepEqual(legacy({ ...source, note: '', completed: false, deleted: false }, result.scheduleSeries[0]), row);
  });
  test('independent occurrences, completion/time, revisions/date survive and inputs stay frozen', () => {
    const a = base(), b = base();
    a.singleSchedules.push(child('2026-09-09', { completion: stamp({ completed: true }) }));
    b.singleSchedules.push(child('2026-09-09', { time: stamp({ startTime: '12:00:00', endTime: '13:00:00', endDayOffset: 0 }, 2) }));
    b.singleSchedules.push(child('2026-09-10', { date: stamp('2026-09-11') }));
    a.scheduleSeries[0].revisions.push({ id: 'r1', effectiveFrom: '2026-09-09', changes: { title: 'new', time: {}, note: '' }, ...stamp(null, 3) });
    const before = JSON.stringify([a, b]), result = merge(freeze(a), freeze(b));
    assert.equal(result.singleSchedules.length, 3); assert.equal(result.scheduleSeries[0].revisions.length, 1);
    assert.deepEqual(Object.keys(result.singleSchedules[1].overrides), ['completion', 'time']);
    assert.equal(JSON.stringify([a, b]), before); assert.deepEqual(merge(a, b), merge(b, a));
  });
  test('same timestamp deletion then clear then code-unit changeId; conflicting request rejected', () => {
    assert.equal(choose(stamp({ deleted: false }, 1, 'z'), stamp({ deleted: true }, 1, 'a'), 'lifecycle').value.deleted, true);
    const clear = { cleared: true, updatedAt: stamp(0).updatedAt, changeId: 'a' };
    assert.equal(choose(stamp('old', 1, 'z'), clear), clear);
    assert.equal(choose(stamp('Z', 1, 'Z'), stamp('a', 1, 'a')).value, 'a');
    assert.throws(() => choose(stamp('a'), stamp('b')), /conflicting changeId/);
  });
  test('legacy all six fields compete at single timestamp including completion false and date', () => {
    const a = base(), edited = single({ title: 'edited', date: '2026-09-10', plannedStartAt: '2026-09-10T23:30:00',
      plannedEndAt: '2026-09-11T00:30:00', note: 'note', completed: true, updatedAt: '2026-09-08T10:00:09' });
    const result = merge(a, { singleSchedules: [edited] });
    assert.equal(result.scheduleSeries.length, 1); assert.equal(result.singleSchedules.length, 1);
    const fields = result.singleSchedules[0].overrides;
    assert.equal(fields.title.value, 'edited'); assert.equal(fields.date.value, '2026-09-10');
    assert.equal(fields.time.value.endDayOffset, 1); assert.equal(fields.note.value, 'note');
    assert.equal(fields.completion.value.completed, true);
    assert.equal(new Set(Object.values(fields).map(v => v.updatedAt)).size, 1);
    assert.deepEqual(merge(a, { singleSchedules: [edited] }), merge({ singleSchedules: [edited] }, a));
    const same = base(); same.singleSchedules[0].overrides.title = stamp('UUID', 1, '11111111-1111-4111-8111-111111111111');
    assert.equal(merge(same, { singleSchedules: [single({ updatedAt: stamp(0).updatedAt })] }).singleSchedules[0].overrides.title.value, 'reading');
  });
  test('later legacy false never revives child deletion; explicit false can restore in every order', () => {
    const a = base(), b = base(), c = { singleSchedules: [single({ updatedAt: '2026-09-08T10:00:09' })] };
    b.singleSchedules[0].overrides.lifecycle = stamp({ deleted: true }, 2);
    for (const order of permutations([a, b, c])) assert.equal(order.reduce(merge).singleSchedules[0].overrides.lifecycle.value.deleted, true);
    const restored = base(); restored.singleSchedules[0].overrides.lifecycle = stamp({ deleted: false }, 3);
    assert.equal(merge(merge(b, c), restored).singleSchedules[0].overrides.lifecycle.value.deleted, false);
    b.scheduleSeries[0].lifecycle = stamp({ deleted: true }, 2);
    assert.equal(merge(b, c).scheduleSeries[0].deleted, true);
  });
  test('A/B/C all permutations, both associations, reload and replay preserve storage provenance', () => {
    const candidates = ['08', '09', '10'].map((day, i) => {
      const a = create({ ...input(single({ date: `2026-09-${day}`, plannedStartAt: `2026-09-${day}T09:00:00`,
        plannedEndAt: `2026-09-${day}T09:30:00` })), updatedAt: `2026-09-08T09:00:0${i}` });
      if (i === 0) a.singleSchedules.push(child('2026-09-09', { lifecycle: stamp({ deleted: true }, 4) }));
      return a;
    });
    const expected = candidates.reduce(merge);
    for (const [a, b, c] of permutations(candidates)) {
      assert.deepEqual(merge(copy(merge(a, b)), c), expected);
      assert.deepEqual(merge(a, copy(merge(b, c))), expected);
    }
    assert.equal(expected.scheduleSeries[0].creation.value.anchorDate, '2026-09-10');
    assert.equal(expected.singleSchedules.length, 2);
    assert.equal(expected.singleSchedules[0].id, 'U');
    assert.equal(expected.singleSchedules[0].overrides.lifecycle.value.deleted, false);
    assert.equal(expected.singleSchedules[1].occurrenceKey, '2026-09-09');
    assert.equal(expected.singleSchedules[1].overrides.lifecycle.value.deleted, true);
    for (const a of [...candidates, ...candidates]) assert.deepEqual(merge(expected, a), expected);
  });
  test('history union retains same-day requests and older resend; clear marks survive', () => {
    const a = base(), b = base();
    for (const [candidate, n] of [[a, 1], [b, 2]]) candidate.scheduleSeries[0].revisions.push({ id: `r${n}`, effectiveFrom: '2026-09-09',
      changes: { title: `name${n}`, time: {}, note: '' }, updatedAt: stamp(0, n).updatedAt, changeId: `r${n}` });
    b.singleSchedules[0].overrides.note = { cleared: true, updatedAt: stamp(0, 3).updatedAt, changeId: 'clear' };
    const result = merge(a, b); assert.equal(result.scheduleSeries[0].revisions.length, 2);
    assert.equal(result.singleSchedules[0].overrides.note.cleared, true); assert.deepEqual(merge(result, a), result);
  });
  test('normal singles retain local-first tie and deleted parent replay cannot revive', () => {
    const a = base(); a.scheduleSeries[0].lifecycle = stamp({ deleted: true }, 2);
    assert.equal(merge(a, base()).scheduleSeries[0].deleted, true);
    const l = { singleSchedules: [single({ id: 'other', title: 'local' })] };
    const r = { singleSchedules: [single({ id: 'other', title: 'remote' })] };
    assert.equal(merge(l, r).singleSchedules[0].title, 'local');
    assert.throws(() => merge({ scheduleSeries: 'bad' }, {}), /array/);
    assert.throws(() => legacy(single({ updatedAt: 'bad' }), a.scheduleSeries[0]), /invalid/);
  });
  console.log(`${count} tests passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
