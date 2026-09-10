const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { validateDailyTimes } = require('../src/core/daily-time.js');
const { runDailyOperation: run, dailyFingerprint } = require('../src/features/daily-operations.js');
const { commitCandidate } = require('../src/core/commit.js');
const { chromium, launchOptions, startServer, randomPort, passGithubGate } = require('./helpers');
const day = '2026-09-10';
const original = { id: 'b', date: day, title: 'fixture', plannedStartAt: day + 'T01:01:12',
  plannedEndAt: day + 'T01:02:34', actualStartAt: day + 'T01:01:23', estimateMin: null, updatedAt: day + 'T10:00:00' };
const pair = (start, end, extra = {}) => ({ start, end, ...extra });
assert.deepEqual(validateDailyTimes(pair('', ''), original), { date: day, plannedStartAt: '', plannedEndAt: '' });
for (const values of [pair('', '01:00'), pair('01:00', ''), pair('02:00', '01:00'), pair('01:00', '01:00'),
  pair('25:00', '26:00'), pair('23:00', '24:01'), pair('01:00', '02:00', { date: '2026-02-30' })])
  assert.throws(() => validateDailyTimes(values, original), /両方|終了|時刻|日付/);
for (const values of [pair('23:59', '24:00'), pair('23:59', '00:00', { endNextDay: true })])
  assert.equal(validateDailyTimes(values, original).plannedEndAt, '2026-09-11T00:00:00');
assert.equal(validateDailyTimes(pair('03:01', '03:02'), original).plannedEndAt, day + 'T03:02:00');
assert.equal(validateDailyTimes(pair('01:01', '01:02'), original).plannedStartAt, original.plannedStartAt);
assert.equal(validateDailyTimes(pair('23:59', '24:00', { date: '2026-12-31' }), original).plannedEndAt, '2027-01-01T00:00:00');
assert.equal(validateDailyTimes(pair(day + 'T23:59:00', '2026-09-11T00:00:00'), original).date, day);
const state = { selectedDate: day, blocks: [{ ...original }], tasks: [{ id: 't' }] };
let saves = 0, syncs = 0, effects = 0;
const deps = { state, commitCandidate, now: () => day + 'T09:00:00', persist: () => { saves++; return true; },
  scheduleSync: () => syncs++, planTimesEffect: () => effects++ };
const input = values => ({ id: 'b', kind: 'block', date: day, values });
const snapshot = JSON.stringify(state);
assert.equal(run('daily-plan-times-save', input(pair('02:00', '01:00')), deps).status, 'invalid');
assert.equal(JSON.stringify(state), snapshot);
const failedInput = input(pair('03:01', '03:02', { date: '2026-09-11' }));
assert.equal(run('daily-plan-times-save', failedInput, { ...deps, persist: () => false }).ok, false);
assert.equal(JSON.stringify(state), snapshot); assert.equal(failedInput.values.date, '2026-09-11');
for (const patch of [{ baseFingerprint: 'old' }, { requestId: 'old' }, { date: '2026-09-09' }])
  assert.equal(run('daily-plan-times-save', { ...input(pair('03:01', '03:02')), ...patch }, deps).status, 'invalid');
assert.equal(run('daily-plan-times-cancel', input(pair('broken', '')), deps).unchanged, true);
assert.equal(saves, 0); assert.equal(syncs, 0);
assert.equal(run('daily-plan-times-save', { ...failedInput, baseFingerprint: dailyFingerprint(state.blocks[0]) }, deps).ok, true);
assert.equal(state.blocks[0].date, '2026-09-11'); assert.equal(state.selectedDate, day);
assert.equal(state.blocks[0].actualStartAt, original.actualStartAt); assert.equal(state.blocks[0].estimateMin, null);
assert.equal(state.blocks[0].updatedAt, day + 'T10:00:01');
assert.equal(saves, 1); assert.equal(syncs, 1); assert.equal(effects, 2);
console.log('PASS pure pairs, seconds, date atomicity, conflict, failure and cancel via registry');

(async () => {
  const server = startServer(randomPort()), browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ serviceWorkers: 'block', timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: app + '\nexport { dailyOperationDeps as testDeps };' }));
    await page.clock.setFixedTime(new Date(2026, 8, 10, 12));
    await page.goto(`http://localhost:${server.address().port}/`); await passGithubGate(page);
    await page.evaluate(async ({ day, original }) => {
      const { testDeps: deps } = await import('/app.js'); window.testDeps = deps;
      deps.state.selectedDate = day; deps.state.blocks = [original];
      deps.scheduleSync = () => {}; deps.persist = () => true;
      const row = document.createElement('article'); row.dataset.dailyKey = 'block:b';
      row.innerHTML = '<input type="time" step="300" data-daily-field="start"><input type="time" step="300" data-daily-field="end"><input type="checkbox" data-daily-field="endNextDay"><button data-action="daily-plan-times-save" data-kind="block" data-id="b">save</button><button data-action="daily-plan-times-cancel" data-kind="block" data-id="b">cancel</button>';
      document.body.append(row);
    }, { day, original });
    const field = key => page.locator(`[data-daily-key="block:b"] [data-daily-field="${key}"]`);
    const action = name => page.locator(`[data-daily-key="block:b"] [data-action="daily-plan-times-${name}"]`).click();
    await field('start').fill('23:59'); await field('end').fill('00:00');
    await action('save'); assert.equal(await field('start').inputValue(), '23:59');
    assert.equal(await page.evaluate(() => testDeps.state.blocks[0].plannedStartAt), original.plannedStartAt);
    await field('endNextDay').check();
    await page.evaluate(() => { testDeps.persist = () => false; });
    await action('save'); assert.equal(await field('endNextDay').isChecked(), true);
    assert.equal(await page.evaluate(() => testDeps.state.blocks[0].plannedStartAt), original.plannedStartAt);
    await page.evaluate(() => { testDeps.persist = () => true; });
    await action('save');
    assert.equal(await page.evaluate(() => testDeps.state.blocks[0].plannedEndAt), '2026-09-11T00:00:00');
    await field('start').fill('02:00'); await action('cancel'); assert.equal(await field('start').inputValue(), '23:59');
    await field('start').fill(''); await field('end').fill(''); await action('save');
    assert.equal(await page.evaluate(() => testDeps.state.blocks[0].plannedStartAt), '');
    assert.deepEqual(errors, []);
    console.log('PASS real data-action: invalid/failure keeps DOM draft, next day save, cancel and undetermined');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
