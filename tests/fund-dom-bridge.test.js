// FUND regression: complete assertions remain visible to the test manifest.
'use strict';
(async () => {
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { createFundDOMBridge } = await import('../src/features/fund/dom-bridge.js');
function setup() {
  const state = { currentView: 'journal', selectedDate: '2026-09-01', modal: null };
  const actions = {}, calls = [], scroll = { scrollTop: 71 };
  let blocked = false, continuation;
  globalThis.document = { activeElement: { dataset: { action: 'fund-report-open', engine: 'fable', family: 'journal', date: '2026-09-01' } },
    getElementById: () => scroll };
  const root = { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  const bridge = createFundDOMBridge({ root, getState: () => state, registerActions: value => Object.assign(actions, value),
    requestDraftLeave: fn => { if (blocked) { continuation = fn; return true; } return false; },
    setView: (view, skip) => { state.currentView = view; calls.push([view, skip]); }, render: () => {}, markRead: () => {},
    connection: () => ({ ready: false }), fetchImpl: () => { throw new Error('unexpected fetch'); }, headers: () => ({}),
    escapeHTML: String, renderHeader: () => '', renderMarkdown: String });
  return { bridge, state, actions, calls, scroll, block() { blocked = true; }, resume() { blocked = false; continuation(); } };
}
test('guarded open leaves report selection and view unchanged until continuation', async () => {
  const f = setup(); f.block();
  f.bridge.open('codex', 'brief', '2026-09-02');
  assert.equal(f.state.currentView, 'journal'); assert.equal(f.bridge.controller.activeKind(), null);
  f.resume();
  assert.deepEqual(f.calls, [['ai-reports', true]]);
  assert.equal(f.bridge.controller.reports.snapshot().date, '2026-09-02');
  f.bridge.controller.dispose();
});
test('report switches preserve original journal date and scroll for back', async () => {
  const f = setup(); f.bridge.open('fable', 'journal', '2026-09-01');
  f.bridge.open('codex', 'brief', '2026-09-03');
  f.state.selectedDate = '2026-09-04'; f.scroll.scrollTop = 999;
  f.actions['fund-report-back'](); f.bridge.mounted();
  assert.equal(f.state.currentView, 'journal'); assert.equal(f.state.selectedDate, '2026-09-01');
  assert.equal(f.scroll.scrollTop, 71); f.bridge.controller.dispose();
});
test('invalid dates and external links cannot change the view', () => {
  const f = setup();
  assert.equal(f.bridge.open('codex', 'brief', '2026-02-30'), false);
  assert.equal(f.bridge.open('unknown', 'journal', '2026-09-01'), false);
  assert.equal(f.bridge.handleLink('https://example.invalid/report.md'), false);
  assert.equal(f.bridge.handleLink('CODEX FUND日誌_2026-09-01.md'), true);
  assert.equal(f.bridge.controller.activeKind(), 'fundJournalCodex');
  assert.equal(f.bridge.controller.reports.snapshot().date, '2026-09-01');
  f.bridge.controller.dispose();
});

test('back restores the page scroll even when the app itself never scrolls', () => {
  const f = setup(), pageScroll = { scrollTop: 420, scrollLeft: 7 };
  document.scrollingElement = pageScroll; f.scroll.scrollTop = 0;
  f.bridge.open('fable', 'journal', '2026-09-01');
  pageScroll.scrollTop = 0; pageScroll.scrollLeft = 0;
  f.actions['fund-report-back'](); f.bridge.mounted();
  assert.deepEqual(pageScroll, { scrollTop: 420, scrollLeft: 7 });
  assert.equal(f.scroll.scrollTop, 0); f.bridge.controller.dispose();
});

test('an immediately allowed date choice remains visible before SELECT loses focus', () => {
  const f = setup(); f.bridge.open('fable', 'journal', '2026-09-01');
  const target = { value: '2026-09-02', matches: () => true };
  assert.equal(f.bridge.handleDate(target), true);
  assert.equal(target.value, '2026-09-02');
  assert.equal(f.bridge.controller.reports.snapshot().date, target.value);
  f.bridge.controller.dispose();
});

})().catch(error => { console.error(error); process.exitCode = 1; });
