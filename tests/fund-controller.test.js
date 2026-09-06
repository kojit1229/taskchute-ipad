// FUND regression: complete assertions remain visible to the test manifest.
'use strict';
(async () => {
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { createFundController } = await import('../src/features/fund/controller.js');

function fixture() {
  let view = 'journal';
  const events = [], requests = [];
  const controller = createFundController({
    connection: () => ({ ready: true, owner: 'fiction', repo: 'fixture', branch: 'main', token: 'fake', prefix: 'taskchute' }),
    fetchImpl: async url => { requests.push(url); return { ok: false, status: 404 }; }, headers: () => ({}),
    escapeHTML: value => String(value), renderHeader: () => '', renderMarkdown: value => value,
    registerActions: () => {}, currentView: () => view,
    patchFund: value => events.push(['fund', value]), patchReport: value => events.push(['report', value]),
    patchMoney: (date, html) => events.push(['money', date, html]), onBack: () => events.push(['back'])
  });
  return { controller, events, requests, setView(value) { view = value; } };
}
test('inactive surfaces do not receive FUND/report replacements', async () => {
  const f = fixture();
  await f.controller.workspace.load();
  assert.equal(f.controller.selectReport('fundJournal', '2026-09-01'), true);
  await f.controller.reports.loadCurrent();
  assert.equal(f.events.length, 0);
  assert.equal(f.controller.activeKind(), 'fundJournal');
  f.controller.dispose();
});
test('same date survives engine switch and leaving report mode', async () => {
  const f = fixture(); f.setView('ai-reports');
  f.controller.selectReport('fundJournal', '2026-09-01');
  await f.controller.reports.loadCurrent();
  f.controller.selectReport('marketCodex');
  await f.controller.reports.loadCurrent();
  assert.equal(f.controller.reports.snapshot().date, '2026-09-01');
  assert.equal(f.controller.reports.snapshot().engine, 'codex');
  assert(f.events.some(([area]) => area === 'report'));
  f.controller.leaveReports(); f.events.length = 0;
  await f.controller.reports.refresh();
  assert.equal(f.events.length, 0);
  assert.equal(f.controller.activeKind(), null);
  f.controller.dispose();
});
test('connection reset clears reads and requests mounted MONEY refresh', async () => {
  const f = fixture();
  await f.controller.reports.loadMoney('2026-09-01');
  assert.equal(f.events[0][1], '2026-09-01');
  assert.match(f.events[0][2], /FABLE FUND 2026-09-01/);
  assert.match(f.events[0][2], /CODEX FUND 2026-09-01/);
  f.controller.invalidateConnection();
  assert.deepEqual(f.events.at(-1), ['money', null, null]);
  assert.equal(f.controller.reports.snapshot().index.data, null);
  assert.equal(f.controller.workspace.snapshot('fable').data, null);
  assert.equal(f.controller.selectReport('invalid'), false);
  f.controller.dispose();
});

})().catch(error => { console.error(error); process.exitCode = 1; });
