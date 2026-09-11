const assert = require('node:assert/strict');
(async () => {
  const { plannedOccupancy: calculate, plannedMinute } = await import('../src/core/planned-occupancy.js');
  const date = '2026-09-11';
  const row = (id, start, end, extra = {}) => ({ id, date, plannedStartAt: `${date}T${start}`,
    plannedEndAt: `${date}T${end}`, ...extra });
  const input = { blocks: [row('a', '10:00', '11:00', { completed: true }),
    row('b', '12:00', '13:00'), { id: 'unset', plannedStartAt: '', plannedEndAt: '' },
    row('deleted', '04:00', '24:00', { deleted: true }), row('sent', '04:00', '24:00', { migratedTo: 'x' })],
    schedules: [row('a', '10:30', '12:00', { completed: true })],
    draftIntervals: [row('draft', '13:00', '13:15')] };
  const before = JSON.stringify(input), result = calculate(input, date);
  assert.deepEqual(result.occupied, [[600, 795]]);
  assert.deepEqual(result.gaps, [[240, 600], [795, 1440]]);
  assert.deepEqual(result.overlaps, [{ left: { kind: 'block', id: 'a' },
    right: { kind: 'schedule', id: 'a' }, range: [630, 660] }]);
  assert.equal(result.invalid.length, 0);
  assert.equal(JSON.stringify(input), before, 'pure calculation must preserve inputs');
  const crossing = row('cross', '23:00', '06:00', { date: '2026-09-10',
    plannedStartAt: '2026-09-10T23:00', plannedEndAt: `${date}T06:00` });
  for (const kind of ['blocks', 'schedules', 'draftIntervals']) {
    const value = calculate({ [kind]: [crossing] }, date);
    assert.deepEqual(value.occupied, [[240, 360]]);
    assert.equal(value.intervals[0].start, -60);
    assert.equal(value.intervals[0].plannedStartAt, crossing.plannedStartAt);
    assert.deepEqual(calculate({ [kind]: [row('all', '00:00', '24:00')] }, date).gaps, []);
    assert.deepEqual(calculate({ [kind]: [row('early', '01:00', '04:00')] }, date).occupied, []);
  }
  for (const [estimateMin, length] of [[undefined, 30], [0, 30], [5, 15], [300, 240], [45, 45]]) {
    const value = calculate({ blocks: [row('old', '23:00', '', { plannedEndAt: '', estimateMin })] }, date);
    assert.equal(value.intervals[0].end, 1380 + length);
    assert.equal(value.intervals[0].estimatedEnd, true);
  }
  for (const bad of [null, {}, row('x', 'bad', '11:00'), row('x', '11:00', '10:00'),
    row('x', '11:00', '11:00'), row('x', '11:00', '12:00', { date: '2026-02-30' }),
    row('x', '11:00', '', { plannedEndAt: '', estimateMin: 'bad' }),
    row('x', '11:00', '12:00', { plannedStartAt: '', plannedEndAt: `${date}T12:00` })]) {
    assert.ok(calculate({ blocks: [bad] }, date).invalid.length, JSON.stringify(bad));
    assert.ok(calculate({ draftIntervals: [bad] }, date).invalid.length, JSON.stringify(bad));
  }
  assert.equal(calculate({ blocks: [row('x','10:00','11:00'),row('x','12:00','13:00')] },date).invalid.length,1);
  for (const kind of ['blocks', 'schedules', 'draftIntervals']) assert.ok(calculate({ [kind]: {} }, date).invalid.length);
  assert.ok(calculate({}, '2026-02-29').invalid.length);
  assert.ok(calculate({}, date, [1440, 240]).invalid.length);
  assert.deepEqual(calculate({ blocks: [{ id: 'actual', actualStartAt: `${date}T10:00`, actualEndAt: `${date}T11:00` }] }, date).occupied, []);
  assert.equal(plannedMinute('2028-03-01T00:00', '2028-02-29'), 1440);
  assert.equal(plannedMinute('2027-01-01T00:00', '2026-12-31'), 1440);
  assert.ok(Number.isNaN(plannedMinute('2026-09-11T24:01', date)));
  assert.ok(Number.isNaN(plannedMinute('2026-09-11T12:00:60', date)));
  const { normalizeSingleSchedules } = await import('../src/core/single-schedule.js');
  const source = [row('good', '10:00:00', '11:00:00', { title: 'normal' }), { id: 'bad' }];
  const normalized = normalizeSingleSchedules(source);
  assert.equal(normalized.warnings[0].count, 1);
  assert.deepEqual(calculate({ schedules: normalized.records }, date).occupied, [[600,660]]);
  assert.deepEqual(source[1], { id: 'bad' });
  // Independently verify the union minute by minute across multiple overlapping sources.
  const ranges = [[260,330],[300,480],[500,600],[600,780],[1400,1500]];
  const minuteTime = m => `${date}T${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  const union = calculate({ blocks: ranges.map(([s,e], i) => ({ id: String(i),
    plannedStartAt: minuteTime(s), plannedEndAt: e > 1440 ? '2026-09-12T01:00' : minuteTime(e) })) }, date);
  for (let m=240;m<1440;m++) {
    const expected=ranges.some(([s,e])=>s<=m&&m<e);
    assert.equal(union.occupied.some(([s,e])=>s<=m&&m<e),expected);
    assert.equal(union.gaps.some(([s,e])=>s<=m&&m<e),!expected);
  }
  console.log('PASS planned occupancy: union, adjacency, identity, invalid explanations, calendar, compatibility, no mutation');
})().catch(error => { console.error(error); process.exitCode = 1; });
