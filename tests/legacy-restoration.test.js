// FUND regression: complete assertions remain visible to the test manifest.
'use strict';
(async () => {
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const {createFundIndividualView} = await import('../src/features/fund/individual-view.js');
const {renderIndividualChart,individualChartModel} = await import('../src/features/fund/individual-chart.js');
// Exact synthetic v356 fixture, copied without changing its nullable/date combinations.
const FUND_FIXTURE = {
  version: 1,
  generatedAt: "2026-09-04T18:34:00+09:00",
  start: { date: "2026-08-07", capital: 20000000 },
  nav: {
    current: 20379550, dayChangePct: -0.3, totalReturnPct: 1.9,
    series: [
      { date: "2026-08-07", nav: 20000000, n225: 65606.71, spx: 7709.96 },
      { date: "2026-09-04", nav: 20379550, n225: 65020.94, spx: 7747.71 }
    ]
  },
  benchmark: { n225ReturnPct: -0.89, spxReturnPct: 0.49, excessVsN225: 2.79, excessVsSpx: 1.41 },
  cash: 14582150,
  positions: [
    {
      code: "9432", name: "NTT", shares: 17000, avgCost: 166.5, lastClose: 172.6,
      marketValue: 2934200, pnlPct: 3.66, openedAt: "2026-08-24",
      stopNote: "158.0円(建値-5.1%)に売り逆指値",
      reasonPlain: "2026-08-24にNTTを17,000株、166.5円で買いました。\n52週の高値166.2円を超えたためです。",
      takeProfit: { price: null, basis: "利確の指値はなし(利は伸ばす)" },
      stopLoss: { price: 171.5, basis: "トレーリングで171.5円へ上げました。" }
    },
    {
      code: "9101", name: "日本郵船", shares: 400, avgCost: 6450, lastClose: 7158,
      marketValue: 2863200, pnlPct: 10.98, openedAt: "2026-08-17",
      stopNote: "",
      reasonPlain: "",
      takeProfit: { price: 7500, basis: "+15%の指値" },
      stopLoss: { price: 6000, basis: "6,000円まで下がったら売る" }
    }
  ],
  openOrders: [],
  recentTrades: [],
  orders: [{
    id: "ORD-1", validFor: "2026-09-07", side: "sell", type: "stop", code: "9432", name: "NTT",
    price: 171.5, shares: 17000, rationale: "day order制のため毎晩張り直し。",
    stopPlan: "171.5円据え置き", whyPlain: "下落の線を171.5円に保ち、17,000株を守るためです。"
  }],
  fills: [{
    date: "2026-09-04", side: "buy", type: "stop", code: "9101", name: "日本郵船", shares: 400,
    price: 6450, pnl: null, rationale: "52週高値ブレイク",
    whyPlain: "52週の高値を6,450円で超えたら400株買うためです。"
  }],
  journal: null,
  series: {
    dates: ["2026-08-07", "2026-09-04"],
    fund: [100.0, 101.8978], n225: [100.0, 99.1071], spx: [100.0, 100.4896]
  },
  journalPlain: "## きょう何が起きた?\n\n- NAVは20,379,550円です。\n\n## なぜそうなった?\n\n- 円が急に強くなりました。\n\n## あした何をする?\n\n- 注文を出し直します。\n\n## 用語メモ\n\n- 逆指値は自動で売る注文です。"
};

const escapeHTML=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const view=createFundIndividualView({escapeHTML,renderMarkdown:escapeHTML,readState:s=>s.state});
const render=d=>view.render('fable',{data:d,state:'available',metadata:{valuationDate:'2026-09-04'}});
test('v356 actual prices retain avgCost percentages and basis supersedes stale stopNote',()=>{
 const html=render(FUND_FIXTURE);
 for(const expected of ['¥171.5 (+3.00%)','¥7,500 (+16.28%)','¥6,000 (-6.98%)','トレーリングで171.5円へ上げました。','利確の指値はなし']) assert.ok(html.includes(expected),expected);
 assert.doesNotMatch(html,/158\.0円/);
 const d=structuredClone(FUND_FIXTURE);d.positions[0].takeProfit={};d.positions[0].stopLoss={};
 assert.match(render(d),/158\.0円/);
 for(const avgCost of [0,null,undefined]) {d.positions=[{...FUND_FIXTURE.positions[0],avgCost}];assert.doesNotMatch(render(d),/\(\+3\.00%\)|Infinity|NaN/);}
});
test('v356 undated journalPlain remains separate and passes sanitizing renderer',()=>{
 const html=render(FUND_FIXTURE),undated=html.match(/<details class="fund-undated-journal">([\s\S]*?)<\/details>/)?.[1];
 for(const heading of ['きょう何が起きた?','なぜそうなった?','あした何をする?','用語メモ'])assert.ok(undated.includes(heading));
 assert.doesNotMatch(undated,/data-date|data-report-file|data-loaded|fund-report-open/);
 assert.match(html,/日誌の日付：未確認/);
 const d=structuredClone(FUND_FIXTURE);d.journalPlain='<img src=x onerror=alert(1)>';
 assert.match(render(d),/&lt;img/);assert.doesNotMatch(render(d),/<img/);
 d.journalPlain=null;assert.doesNotMatch(render(d),/fund-undated-journal/);
});
test('provided normalized series has baseline100 while raw separate-unit plots never do',()=>{
 let html=renderIndividualChart(FUND_FIXTURE,escapeHTML);assert.equal((html.match(/fund-chart-baseline/g)||[]).length,1);
 assert.match(html,/stroke="#888"/);assert.equal((html.match(/<path class="fund-chart-line/g)||[]).length,3);
 const d=structuredClone(FUND_FIXTURE);delete d.series;html=renderIndividualChart(d,escapeHTML);
 assert.doesNotMatch(html,/fund-chart-baseline/);assert.equal((html.match(/<svg/g)||[]).length,3);
 for(const raw of ['20,000,000','20,379,550','65,606.71','65,020.94','7,709.96','7,747.71'])assert.ok(html.includes(raw),raw);
 assert.match(html,/日経平均（円）/);assert.match(html,/S&amp;P500（指数ポイント）/);
 assert.deepEqual(individualChartModel(d).lines[0].values,[20000000,20379550]);
});
test('raw missing index preserves NAV, complete date rows, gaps and all-null index state',()=>{
 const d=structuredClone(FUND_FIXTURE);delete d.series;
 d.nav.series.splice(1,0,{date:'2026-08-20',nav:20100000,n225:null,spx:null});
 let html=renderIndividualChart(d,escapeHTML);
 const p=html.match(/class="fund-chart-line is-n225" d="([^"]+)"/)[1];assert.equal((p.match(/M/g)||[]).length,2);
 assert.equal((html.match(/<tr><th>2026-/g)||[]).length,3);assert.match(html,/>20,100,000</);assert.match(html,/未確認/);
 d.nav.series.forEach(r=>{r.n225=null;r.spx=null;});html=renderIndividualChart(d,escapeHTML);
 assert.equal((html.match(/<svg/g)||[]).length,1);assert.equal((html.match(/全日付の値が未確認/g)||[]).length,2);
 assert.equal((html.match(/<tr><th>2026-/g)||[]).length,3);assert.doesNotMatch(html,/NaN|Infinity/);
});
test('all-empty restores a single combined card with all three states, partial arrays remain separate',()=>{
 const d=structuredClone(FUND_FIXTURE);for(const k of ['positions','orders','fills','openOrders','recentTrades'])d[k]=[];
 let html=render(d);assert.equal((html.match(/まだ取引記録がありません/g)||[]).length,1);
 const card=html.match(/<section class="panel fund-empty">([\s\S]*?)<\/section>/)[1];
 for(const state of ['保有銘柄はありません','有効な注文はありません','成立した売買はありません'])assert.ok(card.includes(state));
 d.positions=FUND_FIXTURE.positions;html=render(d);assert.doesNotMatch(html,/まだ取引記録がありません/);assert.match(html,/有効な注文はありません/);assert.match(html,/成立した売買はありません/);
});

})().catch(error => { console.error(error); process.exitCode = 1; });
