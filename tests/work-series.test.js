const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/core/work-series.js'), 'utf8');
  const { seriesKey, collapseSeries, nudgeKey } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const task = (title, id = title, projectId = 'p', parentTaskId = '') => ({ title, id, projectId, parentTaskId });
  for (const unit of ['巻', '話', '章', '回']) {
    assert.deepEqual(seriesKey(task(`物語　12${unit}`)), { key: `p||物語|${unit}`, n: 12 });
    assert.deepEqual(seriesKey(task(`物語 2${unit}`, 'a', 'q', 'parent')), { key: `q|parent|物語|${unit}`, n: 2 });
  }
  for (const title of ['3巻', ' 3話', '過去問 第3回', '2026年', '無職転生 3期', '単発', '①', '第①']) assert.equal(seriesKey(task(title)), null, title);
  assert.deepEqual(seriesKey(task('11Wジム①(ベンチ 70kg)')), { key: 'p||11Wジム|○', n: 1 });
  assert.deepEqual(seriesKey(task('11Wジム②')), { key: 'p||11Wジム|○', n: 2 });
  assert.equal(seriesKey(task('11Wジム⑩（補足）')).n, 10);
  console.log('PASS U1-1 series recognition and exclusions');

  const tasks = [task('物語 3巻'), task('単発'), task('物語 1巻'), task('物語 2巻'), task('物語 1巻', 'child', 'p', 'parent'), task('物語 1巻', 'other', 'q')];
  tasks.forEach(Object.freeze); Object.freeze(tasks);
  const groups = collapseSeries(tasks, {});
  assert.deepEqual(groups.map(g => g.task.id), [tasks[2].id, '単発', 'child', 'other']);
  assert.deepEqual(groups[0], { task: tasks[2], hidden: 2, rest: [tasks[3], tasks[0]] });
  assert.deepEqual(groups[1], { task: tasks[1], hidden: 0, rest: [] });
  assert.deepEqual(collapseSeries(tasks, { noCollapse: true }), tasks.map(task => ({ task, hidden: 0, rest: [] })));
  assert.deepEqual(collapseSeries([], {}), []);
  console.log('PASS U1-2 stable group order, minimum head, sorted rest, no mutation and search expansion');
  assert.equal(nudgeKey(tasks[0]), nudgeKey(tasks[2]));
  assert.equal(nudgeKey(tasks[0]), 's:p||物語|巻');
  assert.equal(nudgeKey(tasks[1]), '単発');
  console.log('PASS U1-3 stable nudge keys');
})().catch(error => { console.error(error); process.exitCode = 1; });
