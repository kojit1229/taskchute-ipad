// FUND regression: complete assertions remain visible to the test manifest.
'use strict';
(async () => {
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const {renderIndividualChart} = await import('../src/features/fund/individual-chart.js');
const V281 = {
  version: 1,
  generatedAt: "2026-08-27T18:35:00+09:00",
  start: { date: "2026-08-07", capital: 20000000 },
  nav: {
    current: 20292650, dayChangePct: 0.89, totalReturnPct: 1.46,
    series: [{ date: "2026-08-07", nav: 20000000, n225: 64000, spx: 7500 }]
  },
  benchmark: { n225ReturnPct: 2.39, spxReturnPct: 2.33, excessVsN225: 1.58, excessVsSpx: -0.87 },
  cash: 14582150,
  positions: [{ code: "9432", name: "NTT", shares: 17000, avgCost: 166.5, lastClose: null, marketValue: null, pnlPct: null, openedAt: "2026-08-24", stopNote: "158円で撤退" }],
  openOrders: [{ id: "ORD-1", validFor: "2026-08-27", code: "5401", name: "日本製鉄", side: "buy", type: "stop", price: 710, shares: 3500, rationale: "高値更新", stopPlan: "直近安値割れ" }],
  recentTrades: [{ date: "2026-08-24", code: "8306", name: "三菱UFJ FG", side: "sell", type: "stop", price: 3489.5, shares: 700, pnl: -7350, rationale: "予定どおり撤退" }],
  journal: null
};

const V301 = {
  version: 1,
  generatedAt: "2026-08-30T11:00:00+09:00",
  start: { date: "2026-08-07", capital: 20000000 },
  nav: {
    current: 20400000, dayChangePct: 0.7, totalReturnPct: 2,
    series: [
      { date: "2026-08-07", nav: 20000000, n225: 40000, spx: 6500 },
      { date: "2026-08-30", nav: 20400000, n225: 40400, spx: 6630 }
    ]
  },
  benchmark: { n225ReturnPct: 1, spxReturnPct: 2, excessVsN225: 1, excessVsSpx: 0 },
  cash: 10000000,
  positions: [],
  openOrders: [],
  recentTrades: [],
  journal: { date: "2026-08-30", markdown: "# 運用日誌\n\n**既存Markdown経路**" }
};

test('unchanged v281 and v301 raw fixtures retain all original NAV/index points in distinct units',()=>{
 for(const [data,count] of [[V281,1],[V301,2]]) {
  const html=renderIndividualChart(data,v=>String(v));
  assert.equal((html.match(/<svg/g)||[]).length,3);
  assert.equal((html.match(/<circle class="fund-chart-dot/g)||[]).length,count*3);
  assert.equal((html.match(/<tr><th>2026-/g)||[]).length,count);
  for(const row of data.nav.series)for(const key of ['nav','n225','spx'])assert.ok(html.includes(row[key].toLocaleString('ja-JP')));
  assert.doesNotMatch(html,/fund-chart-baseline|NaN|Infinity/);
 }
});

})().catch(error => { console.error(error); process.exitCode = 1; });
