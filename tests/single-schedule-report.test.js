const assert = require('node:assert/strict');

(async () => {
  const { captureReportInput } = await import('../src/features/feedback/report-input.js');
  const { buildReportMarkdown } = await import('../src/features/feedback/report-builder.js');
  const { deriveReportValues } = await import('../src/features/feedback/report-derived.js');
  const date = '2026-09-11', next = '2026-09-12';
  const schedule = (id, patch = {}) => ({ id, title: '会議', date, completed: false,
    plannedStartAt: `${date}T23:30:00`, plannedEndAt: `${next}T00:00:00`, ...patch });
  const base = {
    journals: { [date]: '元のジャーナル', [next]: '翌日のジャーナル' },
    settings: { morningEnergyLog: {} },
    blocks: [{ id: 'b', date, title: '実績', taskId: 't', category: '仕事', completed: true,
      plannedStartAt: `${date}T09:00:00`, plannedEndAt: `${date}T09:30:00`,
      actualStartAt: `${date}T09:00:00`, actualEndAt: `${date}T09:00:00` }],
    tasks: [{ id: 't', title: '完了Task', projectId: 'p', status: 'completed' }],
    projects: [{ id: 'p', title: '案件', kind: 'normal', status: 'active' }]
  };
  const capture = (source, day = date) => captureReportInput(source, day, deriveReportValues);
  const baseline = capture(base), baselineReport = buildReportMarkdown(baseline);
  assert.deepEqual(baseline.singleSchedules, { records: [], count: 0, completed: 0,
    excluded: { deleted: 0, invalid: 0, otherDate: 0, continuation: 0 } });
  assert.deepEqual(capture({ ...base, singleSchedules: [] }), baseline);
  const normal = schedule('one', { completed: true, title: '会議 | <b> & **予定**\n続き' });
  const deleted = schedule('deleted', { deleted: true });
  const invalid = schedule('invalid', { plannedEndAt: 'bad', future: { original: ['keep'] } });
  const previous = schedule('previous', { date: '2026-09-10', plannedStartAt: '2026-09-10T23:00:00', plannedEndAt: `${date}T05:00:00` });
  const future = schedule('future', { date: next, plannedStartAt: `${next}T10:00:00`, plannedEndAt: `${next}T11:00:00` });
  const source = { ...structuredClone(base), singleSchedules: [normal, deleted, invalid, previous, future] };
  const unchanged = structuredClone(source), input = capture(source);
  assert.deepEqual(source, unchanged, 'capture never changes source, including malformed original values');
  assert.equal(input.singleSchedules.count, 1); assert.equal(input.singleSchedules.completed, 1);
  assert.deepEqual(input.singleSchedules.records.map(row => row.id), ['one']);
  assert.deepEqual(input.singleSchedules.excluded, { deleted: 1, invalid: 1, otherDate: 2, continuation: 1 });
  const { singleSchedules, ...rest } = input;
  const { singleSchedules: empty, ...oldRest } = baseline;
  assert.deepEqual(rest, oldRest, 'Task rates, captured state, Blocks and measured actuals remain identical');
  const report = buildReportMarkdown(input), table = report.slice(baselineReport.length);
  assert.equal(report.slice(0, baselineReport.length), baselineReport, 'every existing heading, total and external prompt is unchanged');
  assert.match(table, /## 単発予定（別表）/);
  assert.match(table, /1件（予定完了1件）/);
  assert.match(table, /23:30 – 2026-09-12 00:00/);
  assert.ok(table.includes('会議 \\| &lt;b&gt; &amp; \\*\\*予定\\*\\* 続き'));
  assert.match(table, /\| 完了 \|/);
  assert.match(table, /不正な単発予定1件を除外/);
  assert.match(report, /計測合計: 0分/);
  assert.match(report, /予定時間を補った集計\(従来\): 0h30m/);
  assert.equal(input.actuals[0].taskCompleted, true);
  assert.equal(input.actuals[0].minutes, 0);
  console.log('PASS attribution/one row/exclusion counts/midnight/escaping/measured total and Task count unchanged');

  const nextInput = capture(source, next);
  assert.deepEqual(nextInput.singleSchedules.records.map(row => row.id), ['future']);
  assert.equal(nextInput.singleSchedules.excluded.continuation, 0, 'midnight endpoint is not next-day continuation');
  const crossing = { ...structuredClone(base), singleSchedules: [schedule('cross', { plannedEndAt: `${next}T05:00:00` })] };
  const crossed = capture(crossing, next);
  assert.equal(crossed.singleSchedules.count, 0); assert.equal(crossed.singleSchedules.excluded.continuation, 1);
  assert.equal(buildReportMarkdown(crossed), buildReportMarkdown(capture(base, next)));
  const justDeleted = capture({ ...base, singleSchedules: [deleted] });
  assert.equal(justDeleted.singleSchedules.count, 0); assert.equal(justDeleted.singleSchedules.excluded.deleted, 1);
  assert.equal(buildReportMarkdown(justDeleted), baselineReport);
  for (const completed of [true, false]) {
    const captured = capture({ ...base, singleSchedules: [schedule('toggle', { completed })] });
    assert.equal(captured.singleSchedules.count, 1); assert.equal(captured.singleSchedules.completed, Number(completed));
    assert.deepEqual(captured.actuals, baseline.actuals); assert.deepEqual(captured.derived, baseline.derived);
    assert.ok(buildReportMarkdown(captured).endsWith(`| ${completed ? '完了' : '未完了'} |`));
  }
  console.log('PASS next-day continuation counted only on attribution date/deleted exclusion/completion independence');

  for (const malformed of [null, {}, '[]']) {
    const broken = { ...base, singleSchedules: malformed }, before = structuredClone(broken);
    assert.throws(() => capture(broken), /singleSchedules/);
    assert.deepEqual(broken, before);
  }
  const duplicate = capture({ ...base, singleSchedules: [schedule('dup'), schedule('dup')] });
  assert.equal(duplicate.singleSchedules.count, 0); assert.equal(duplicate.singleSchedules.excluded.invalid, 2);
  const sorted = capture({ ...base, singleSchedules: [schedule('late'), schedule('early', { plannedStartAt: `${date}T08:00:00`, plannedEndAt: `${date}T09:00:00` })] });
  assert.deepEqual(sorted.singleSchedules.records.map(row => row.id), ['early', 'late']);
  source.singleSchedules[0].title = '後から変更';
  assert.equal(buildReportMarkdown(input), report, 'captured input stays detached from subsequent edits');
  const deriveFailure = { ...structuredClone(base), singleSchedules: [schedule('kept')] }, beforeFailure = structuredClone(deriveFailure);
  assert.throws(() => captureReportInput(deriveFailure, date, () => { throw Error('fixture derive failure'); }), /fixture derive failure/);
  assert.deepEqual(deriveFailure, beforeFailure);
  console.log('PASS malformed container fail-closed/duplicate preservation/order/detached snapshot/injected derivation failure');
})().catch(error => { console.error(error); process.exitCode = 1; });
