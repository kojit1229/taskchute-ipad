const assert = require('node:assert/strict');
const { captureReportInput } = require('../src/features/feedback/report-input.js');
const { deriveReportValues } = require('../src/features/feedback/report-derived.js');
const { buildReportMarkdown } = require('../src/features/feedback/report-builder.js');
const { dailyActuals, actualDurationMinutes } = require('../src/core/daily-actuals.js');
const { affectedReportDates, REPORT_PENDING } = require('../src/core/daily-report.js');
const { runDailyOperation: run, DAILY_OPERATIONS } = require('../src/features/daily-operations.js');
const { commitCandidate } = require('../src/core/commit.js');
const { chromium, launchOptions, startServer, randomPort, STATE_KEY, passGithubGate } = require('./helpers');
const DAY = '2026-09-10', NEXT = '2026-09-11';
function fixture() {
  const b = (id, start, end, completed) => ({ id, title: id, taskId: 'task', date: DAY, completed, deleted: false,
    plannedStartAt: `${DAY}T09:00:00`, plannedEndAt: `${DAY}T09:30:00`, actualStartAt: start, actualEndAt: end });
  return { selectedDate: DAY, dataModifiedAt: `${DAY}T08:00:00`, blocks: [
    b('overnight', `${DAY}T23:50:00`, `${NEXT}T00:10:00`, false),
    b('zero', `${DAY}T09:00:00`, `${DAY}T09:00:00`, true), b('plan-only', '', '', true), b('missing', '', `${DAY}T10:00:00`, false)],
    tasks: [{ id: 'task', title: 'Task', status: 'completed', deleted: false }], projects: [], recurrences: [],
    reports: { [DAY]: 'old report' }, journals: { [DAY]: '架空の本文', [NEXT]: '翌日本文' }, journalMeta: {},
    settings: { morningEnergyLog: {}, twelveWeekStartDate: DAY }, sleep: { logs: {} }, bodyScans: [], questions: [] };
}
{
  const state = fixture(), refreshed = [];
  const deps = { state, commitCandidate, now: () => `${NEXT}T01:00:00`, persist: () => true,
    refreshActualReports: dates => refreshed.push(dates) };
  assert(run('daily-plan-times-save', { kind: 'block', id: 'overnight', date: DAY,
    values: { start: '09:00', end: '09:45' } }, deps).ok);
  assert.deepEqual(refreshed, [], 'planned times alone must not insert a report save into source/copy persistence');
  assert(run('daily-plan-times-save', { kind: 'block', id: 'overnight', date: DAY,
    values: { date: NEXT, start: '09:00', end: '09:45' } }, deps).ok);
  assert.deepEqual(refreshed, [[DAY, NEXT]], 'explicit attribution still refreshes old and new days');
  console.log('PASS refresh effects: planned time edit is separate; explicit date move refreshes both days');
}
{
  const state = fixture(), original = structuredClone(state), input = captureReportInput(state, DAY, deriveReportValues);
  assert.deepEqual(input.actuals.map(r => r.blockId), dailyActuals(state.blocks, DAY).map(b => b.id));
  assert.deepEqual(input.actuals.map(r => r.minutes), dailyActuals(state.blocks, DAY).map(actualDurationMinutes));
  assert.deepEqual(input.actuals.map(r => r.taskCompleted), [true, true, true]);
  assert.equal(deriveReportValues(input.state, DAY).measuredMinutes, 20);
  const report = buildReportMarkdown(input);
  assert(report.includes('計測合計: 20分')); assert(report.includes('予定時間を補った集計(従来): 1h'));
  assert(report.includes(`| overnight | ${DAY} | ${DAY}T23:50:00 | ${NEXT}T00:10:00 | 20分 | 完了 |`));
  assert(report.includes(`| missing | ${DAY} | 未記録 | ${DAY}T10:00:00 | 未記録 | 完了 |`));
  assert(report.includes('## 8. ジャーナル')); assert(report.includes('## 9. 明日への接続'));
  assert.deepEqual(state, original); state.blocks[0].title = 'capture後'; assert.equal(input.blocks.find(b => b.id === 'overnight').title, 'overnight');
  let fail = false, saves = 0;
  const deps = { state, commitCandidate, now: () => `${NEXT}T01:00:00`, persist: () => { saves++; return !fail; },
    captureReport: (s, date) => captureReportInput(s, date, deriveReportValues), buildReport: buildReportMarkdown };
  assert(run('daily-report-refresh', { reportDate: DAY }, deps).ok);
  const saved = structuredClone(state), count = saves;
  assert(run('daily-report-refresh', { reportDate: DAY }, deps).unchanged); assert.equal(saves, count);
  assert.equal(run('daily-report-refresh', { reportDate: 'bad' }, deps).status, 'invalid');
  deps.buildReport = () => { throw Error('fixture generation failure'); };
  const blocks = structuredClone(state.blocks); const result = run('daily-report-refresh', { reportDate: DAY }, deps);
  assert(result.ok && result.pending); assert.equal(state.reports[DAY], REPORT_PENDING); assert.deepEqual(state.blocks, blocks);
  fail = true; deps.buildReport = buildReportMarkdown;
  assert.equal(run('daily-report-refresh', { reportDate: DAY }, deps).ok, false); assert.equal(state.reports[DAY], REPORT_PENDING);
  fail = false; assert(run('daily-report-refresh', { reportDate: DAY }, deps).ok); assert.equal(state.reports[DAY], saved.reports[DAY]);
  assert.deepEqual(affectedReportDates(state, { records: [{ kind: 'blocks', before: blocks[0], after: { ...blocks[0], date: NEXT } }] }), [DAY, NEXT]);
  console.log('PASS report: measured ids/date/times/task, zero fallback separate, capture isolation, generation/persist failure and replay');
}

(async () => {
  const server = startServer(randomPort()); let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'ja-JP', serviceWorkers: 'block', viewport: { width: 1400, height: 900 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => { const u = new URL(route.request().url());
      if (u.hostname !== 'localhost') return route.abort();
      if (/personal-data|AIプラン|AIフィードバック|週次レビュー/.test(decodeURIComponent(u.pathname))) return route.fulfill({ status: 404, body: 'fixture only' });
      return route.continue(); });
    await page.clock.setFixedTime(new Date(2026, 8, 10, 12));
    await page.goto(`http://localhost:${server.address().port}/`); await passGithubGate(page);
    await page.evaluate(({ key, data, day }) => {
      const s = JSON.parse(localStorage.getItem(key)), settings = s.settings;
      Object.assign(s, data); s.settings = { ...settings, ...data.settings };
      s.currentView = 'exec'; s.settings.lastOpenedDate = day; s.settings.autoSync = false; s.settings.github.autoSave = false;
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, data: fixture(), day: DAY });
    await page.reload(); await page.locator('#app[data-view="exec"]').waitFor();
    const trigger = (action, id) => page.evaluate(({ action, id }) => {
      const b = document.createElement('button'); Object.assign(b.dataset, { action, id }); document.body.append(b); b.click(); b.remove();
    }, { action, id });
    const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    await page.evaluate(async () => {
      const { DAILY_OPERATIONS } = await import('/src/features/daily-operations.js');
      const op = DAILY_OPERATIONS['daily-report-refresh']; window.__reportBuild = op.build;
      op.build = (s, input, deps) => window.__reportBuild(s, input, { ...deps, buildReport: () => { throw Error('fixture generator'); } });
      window.__shares = []; Object.defineProperty(navigator, 'share', { configurable: true, value: async value => { window.__shares.push(value); } });
    });
    await trigger('complete-block-with-actual', 'overnight');
    await page.locator('#modalRoot [data-modal-field="actualEndAt"]').fill(`${NEXT}T00:20`);
    await page.locator('#modalRoot [data-modal-field="comment"]').fill('一次保存は残す');
    await page.locator('#modalRoot [data-action="modal-save"]').click();
    const pending = await stored();
    assert.equal(pending.blocks.find(b => b.id === 'overnight').actualEndAt, `${NEXT}T00:20:00`);
    assert.equal(pending.blocks.find(b => b.id === 'overnight').completed, false);
    assert.equal(pending.reports[DAY], REPORT_PENDING);
    await trigger('report-share-ai', ''); assert.equal(await page.evaluate(() => window.__shares.length), 0);
    await page.evaluate(async () => { (await import('/src/features/daily-operations.js')).DAILY_OPERATIONS['daily-report-refresh'].build = window.__reportBuild; });
    await trigger('report-share-ai', '');
    assert.equal(await page.evaluate(() => window.__shares.length), 1);
    const ready = await stored(); assert(ready.reports[DAY].includes('計測合計: 30分'));
    assert.equal((await page.evaluate(() => window.__shares[0])).text, ready.reports[DAY]);
    // The real detail save moves attribution explicitly and regenerates both old and new days after its transaction.
    await trigger('edit-block', 'overnight');
    await page.locator('#modalRoot [data-modal-field="date"]').fill(NEXT);
    await page.locator('#modalRoot [data-action="modal-save"]').click();
    await page.waitForFunction(({ key, next }) => JSON.parse(localStorage.getItem(key)).blocks.find(b => b.id === 'overnight').date === next, { key: STATE_KEY, next: NEXT });
    const moved = await stored();
    assert(!moved.reports[DAY].includes('| overnight |')); assert(moved.reports[NEXT].includes(`| overnight | ${NEXT} |`));
    assert.equal(moved.blocks.find(b => b.id === 'overnight').comment, '一次保存は残す');
    assert.deepEqual(errors, []);
    console.log('PASS browser: actual correction survives generation failure, pending is not shared, retry refreshes, explicit date edit rebuilds both days');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
