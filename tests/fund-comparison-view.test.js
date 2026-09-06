// FUND regression: complete assertions remain visible to the test manifest.
'use strict';
(async () => {
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { createFundComparisonView } = await import('../src/features/fund/comparison-view.js');
const escapeHTML = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const view = createFundComparisonView({ escapeHTML });
const fixture = (delta = -5) => ({ state: 'available', loading: false, metadata: { stale: false }, data: {
  status: 'ready', startDate: '2026-08-01', valuationDate: '2026-09-04', generatedAt: '2026-09-06T00:00:00Z',
  series: [{ date: '2026-08-01', fable: 100, codex: 100 }, { date: '2026-09-04', fable: 110, codex: 105 }],
  metrics: { fable: { returnPct: 10, maxDrawdownPct: -2 }, codex: { returnPct: 5, maxDrawdownPct: 0 } },
  codexMinusFablePctPoints: delta } });
test('shows supplied common-period metrics and CODEX-minus-FABLE sign', () => {
  const input = fixture(), before = JSON.stringify(input), html = view.render(input);
  for (const text of ['+10.00%', '+5.00%', '-2.00%', '0.00%', '-5.00ポイント', 'CODEX − FABLE', '2026-08-01', '2026-09-04', '2026-09-06T00:00:00Z']) assert.ok(html.includes(text), text);
  assert.equal((html.match(/data-date="2026-09-04"/g) || []).length, 2);
  assert.equal(JSON.stringify(input), before);
  assert.ok(view.render(fixture(0)).includes('0.00ポイント'));
  assert.ok(view.render(fixture(12)).includes('+12.00ポイント'));
});
test('missing data produces no fabricated flat line or zero metrics', () => {
  for (const data of [null, { status: 'insufficient_data', series: [] }, { status: 'ready', series: [{}] }]) {
    const html = view.render({ state: 'not_created', data });
    assert.ok(html.includes('比較できる記録がまだそろっていません'));
    assert.ok(!html.includes('<svg')); assert.ok(!html.includes('0.00%'));
  }
});
test('retains older comparison with explicit read failure and generation date', () => {
  const input = fixture(); input.state = 'offline'; input.metadata.stale = true;
  const html = view.render(input);
  assert.ok(html.includes('オフライン')); assert.ok(html.includes('前回取得した記録'));
  assert.ok(html.includes('生成から時間が経った')); assert.ok(html.includes('終了日：2026-09-04'));
  input.state = 'failed'; input.error = 'timeout'; assert.ok(view.render(input).includes('時間内'));
});
test('labels, patterns and exact table distinguish the two series without color', () => {
  const html = view.render(fixture());
  for (const marker of ['FABLE FUND（実線）', 'CODEX FUND（破線）', '評価日ごとの値', '<td>110</td><td>105</td>', '開始時の保有は異なる']) assert.ok(html.includes(marker), marker);
  assert.equal((html.match(/class="fund-chart-line /g) || []).length, 2);
});
test('escapes producer note without injecting HTML or event attributes', () => {
  const input = fixture(); input.data.note = '<img src=x onerror="bad()">';
  const html = view.render(input); assert.ok(!html.includes('<img')); assert.ok(html.includes('&lt;img'));
});

})().catch(error => { console.error(error); process.exitCode = 1; });
