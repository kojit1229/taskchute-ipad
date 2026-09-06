// Generated review candidate. Copy into tests only after review; no OUT runtime dependencies.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'..');
const component=name=>import(pathToFileURL(path.join(ROOT,'src/features/fund',name)).href);
const checks=[];const test=(name,run)=>checks.push({name,run});
(async()=>{
// Original synthetic fixtures; no shape/date augmentation.
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

const V356 = {
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

const STATIC_MAP={"fund-read-contract.mjs":"read-contract.js","fund-read-gateway.mjs":"read-gateway.js","fund-read-transport.mjs":"read-transport.js","individual-view/fund-individual-view.mjs":"individual-view.js","individual-view/fund-individual-chart.mjs":"individual-chart.js","report-resume/fund-report-selection.mjs":"report-selection.js","report-resume/fund-report-gateway.mjs":"report-gateway.js","report-view/fund-report-view.mjs":"report-view.js"};
{
const {createFundIndividualView}=await component('individual-view.js');
const {renderIndividualChart,individualChartModel}=await component('individual-chart.js');
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

}
{
const {createFundIndividualView}=await component('individual-view.js');
const {individualChartModel,renderIndividualChart}=await component('individual-chart.js');
const {fundMetadata}=await component('read-contract.js');
const escapeHTML=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const view=createFundIndividualView({escapeHTML,renderMarkdown:escapeHTML,readState:s=>s?.loading?'読み込み中':s?.state||'未取得'});
function data() {return {version:1,generatedAt:'2026-09-06T01:00:00Z',start:{date:'2026-09-01',capital:200},
  nav:{current:220,totalReturnPct:10,series:[{date:'2026-09-01',nav:200,n225:null,spx:null},{date:'2026-09-05',nav:220,n225:null,spx:null}]},
  cash:110,benchmark:{excessVsN225:3,excessVsSpx:null},positions:[],openOrders:[],recentTrades:[],
  journal:{date:'2026-09-04',markdown:'架空の記録'}};}
const snapshot=d=>({data:d,state:'available',metadata:fundMetadata('fable',d,0)});
test('legacy FABLE displays ordered shared fields, nullable model/cost, NAV fallback independent of benchmark',()=>{
  const d=data(),html=view.render('fable',snapshot(d));
  let cursor=-1;
  for(const label of ['運用状態','評価日','最終生成時刻','運用開始日','元本','現在の資産額','運用開始からの増減率','現金の割合']) {
    const next=html.indexOf(label,cursor+1);assert.ok(next>cursor,label);cursor=next;
  }
  assert.match(html,/50\.00%/);assert.match(html,/\+3\.00ポイント/);assert.match(html,/実際に使ったモデル：記録なし/);
  assert.match(html,/呼び出し費用：未確認/);assert.match(html,/資産額（円）/);assert.doesNotMatch(html,/NaN|Infinity/);
});
test('CODEX status separate from old performance, requested model is never actual model fallback',()=>{
  const d=data();d.engine={id:'codex',requestedModel:'DO-NOT-DISPLAY',actualModel:null,costUsd:null};
  const s=snapshot(d);s.state='failed';
  const html=view.render('codex',s,{data:{status:'error',checkedAt:'2026-09-07T00:00:00Z'},state:'available'});
  assert.match(html,/処理に失敗/);assert.match(html,/前回正常に取得した成績/);assert.match(html,/2026-09-07T00:00:00Z/);
  assert.match(html,/<span>評価日<\/span><strong>2026-09-05/);assert.doesNotMatch(html,/DO-NOT-DISPLAY/);
});
test('no data, not started, loading and failure never manufacture zero performance',()=>{
  for(const state of ['not_created','disconnected','offline','invalid','failed','idle']) {
    const html=view.render('codex',{state},{state:'available',data:{status:'not_started'}});
    assert.match(html,/運用開始前/);assert.match(html,/表示できる成績がまだありません/);assert.doesNotMatch(html,/¥0|0\.00%|<svg/);
  }
  assert.match(view.render('fable',{loading:true}),/読み込み中/);
});
test('unknown start/valuation and stale timestamps remain distinct, benchmark unavailable',()=>{
  const d=data();d.start.date='2026-08-31';const s=snapshot(d);s.metadata.stale=true;
  const html=view.render('fable',s);assert.match(html,/生成から時間が経った/);assert.doesNotMatch(html,/\+3\.00ポイント/);
  assert.match(html,/指数と同じ開始日か確認できない/);
  d.nav.series[1].date='2026-02-30';assert.equal(snapshot(d).metadata.valuationDate,null);
  assert.match(view.render('fable',snapshot(d)),/<span>評価日<\/span><strong>未確認/);
});
test('all holdings/orders/fills and source range are retained beyond previous list limits',()=>{
  const d=data();d.positions=Array.from({length:35},(_,i)=>({code:'POS'+i,name:'架空',shares:1,avgCost:20,lastClose:null,pnlPct:null,
    reasonPlain:'理由'+i,takeProfit:{price:30,basis:'利益理由'},stopLoss:{price:10,basis:'損切理由'}}));
  d.orders=Array.from({length:36},(_,i)=>({code:'ORDER'+i,side:'buy',validFor:'2026-09-07',price:1,shares:1,whyPlain:'注文理由'}));
  d.fills=Array.from({length:37},(_,i)=>({code:'FILL'+i,side:'sell',date:i?'2026-09-06':'2026-09-01',pnl:null}));
  const html=view.render('fable',snapshot(d));
  for(const code of ['POS34','ORDER35','FILL36']) assert.match(html,new RegExp(code));
  assert.match(html,/35件（入力データ内の全件）/);assert.match(html,/収録期間：2026-09-01 ～ 2026-09-06/);
  assert.match(html,/利益理由/);assert.match(html,/損切理由/);assert.match(html,/成立した売買/);
});
test('empty or identity-missing modern arrays preserve legacy fallback; mixed malformed rows reported',()=>{
  const d=data();d.orders=[];d.fills=[];d.openOrders=[{code:'OLD-ORDER'}];d.recentTrades=[{code:'OLD-FILL'}];
  assert.match(view.render('fable',snapshot(d)),/OLD-ORDER/);assert.match(view.render('fable',snapshot(d)),/OLD-FILL/);
  d.orders=[{code:'PARTIAL'}];assert.match(view.render('fable',snapshot(d)),/OLD-ORDER/);
  d.orders=[null,{code:'CURRENT',side:'buy'}];assert.match(view.render('fable',snapshot(d)),/形式を確認できない記録 1件/);
  assert.match(view.render('fable',snapshot(d)),/CURRENT/);assert.doesNotMatch(view.render('fable',snapshot(d)),/OLD-ORDER/);
});
test('journal exact date and links are independent of NAV valuation and generation dates',()=>{
  const d=data(),html=view.render('codex',snapshot(d));
  assert.match(html,/日誌の日付：2026-09-04/);assert.match(html,/data-family="brief"\s+data-date="2026-09-04"/);
  assert.match(html,/data-engine="codex"/);assert.match(html,/data-history="true"/);
  d.journal.date='invalid';d.journalPlain='UNBOUND-BODY';
  const invalid=view.render('fable',snapshot(d));const unbound=invalid.match(/<details class="fund-undated-journal">([\s\S]*?)<\/details>/)?.[1];
  assert.match(unbound,/UNBOUND-BODY/);assert.doesNotMatch(unbound,/data-date|data-report-file|data-loaded|fund-report-open/);
  assert.doesNotMatch(invalid.replace(/<details class="fund-undated-journal">[\s\S]*?<\/details>/,''),/UNBOUND-BODY/);
  assert.match(invalid,/日誌の日付：未確認/);assert.match(invalid,/data-date="2026-09-05"/);
});
test('provided chart values and null gaps retained exactly, invalid series fallback keeps NAV',()=>{
  const d=data();d.series={dates:['2026-09-01','2026-09-02','2026-09-03'],fund:[100,null,105],n225:[null,null,null],spx:[100,103,102]};
  const model=individualChartModel(d);assert.deepEqual(model.lines[0].values,[100,null,105]);
  const html=renderIndividualChart(d,escapeHTML);const path=/class="fund-chart-line is-nav" d="([^"]+)"/.exec(html)[1];
  assert.equal((path.match(/M/g)||[]).length,2);assert.equal(path.includes('L'),false);assert.match(html,/未確認/);
  d.series.dates[1]='bad';assert.equal(individualChartModel(d).unit,'資産額（円）');
});
test('actual zero remains zero; null/undefined/nonfinite never become zero',()=>{
  const d=data();d.cash=0;d.nav.totalReturnPct=0;d.engine={actualModel:'verified',costUsd:0};
  assert.match(view.render('codex',snapshot(d)),/呼び出し費用：0米ドル/);
  assert.match(view.render('codex',snapshot(d)),/現金の割合<\/span><strong>0\.00%/);
  d.cash=null;assert.match(view.render('codex',snapshot(d)),/現金の割合<\/span><strong>未確認/);
});
test('all generated strings escaped and Markdown uses injected sanitizing route, no mutation',()=>{
  const d=data(),attack='<img src=x onerror="alert(1)">';d.positions=[{code:attack,name:attack,reasonPlain:attack,stopNote:attack}];
  d.journal.markdown=attack;d.engine={actualModel:attack};const before=JSON.stringify(d);
  const html=view.render('fable',snapshot(d));assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.equal(JSON.stringify(d),before);
  assert.throws(()=>view.render('evil',snapshot(d)));
});

}
{
const {createFundIndividualView}=await component('individual-view.js');
const {renderIndividualChart}=await component('individual-chart.js');
const {createFundReadGateway}=await component('read-gateway.js');
const {fundMetadata,validateFundSource}=await component('read-contract.js');
const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const view=createFundIndividualView({escapeHTML:esc,renderMarkdown:esc,readState:s=>s.loading?'読み込み中':s.state});
const render=d=>view.render('fable',{data:d,state:'available',metadata:fundMetadata('fable',d,0)});
const contains=(html,list)=>list.forEach(s=>assert.ok(html.includes(s),s));
const ordered=(html,list)=>{let previous=-1;for(const s of list){const at=html.indexOf(s);assert.ok(at>previous,s);previous=at;}};
test('v281:152-155 defensive invalid elements remain renderable, all-empty one card, no unknown zeros',()=>{
 const d={...V281,positions:[],openOrders:[],recentTrades:[]};let h=render(d);
 assert.equal((h.match(/まだ取引記録がありません/g)||[]).length,1);assert.doesNotMatch(h,/NaN|undefined/);
 h=render({...d,positions:[null],openOrders:[null],recentTrades:[null]});assert.doesNotMatch(h,/NaN|undefined/);assert.match(h,/形式を確認できない記録/);
});
test('v281:170-184 each raw missing series breaks independently; NAV never disappears with missing indices',()=>{
 const d=structuredClone(V281);d.nav.series=[{date:'2026-08-07',nav:20000000,n225:64000,spx:7500},{date:'2026-08-08',nav:20100000,n225:null,spx:null},{date:'2026-08-09',nav:20200000,n225:64200,spx:7520}];
 let h=renderIndividualChart(d,esc);assert.doesNotMatch(h,/NaN|undefined/);
 for(const key of ['is-n225','is-spx']){const path=h.match(new RegExp('class="fund-chart-line '+key+'" d="([^"]+)"'))[1];assert.equal((path.match(/M/g)||[]).length,2);}
 d.nav.series.forEach(r=>{r.n225=null;r.spx=null;});h=renderIndividualChart(d,esc);assert.match(h,/fund-chart-line is-nav/);assert.match(h,/>20,100,000</);assert.match(h,/>20,200,000</);
});
test('v281:256-271 all legacy numeric, position, order and fill information remains with explicit labels',()=>{
 const h=render(V281);contains(h,['現在の資産額','¥20,292,650','運用開始からの増減率','+1.46%','+1.58ポイント','-0.87ポイント','現金の割合','71.86%','2026-08-27T18:35:00+09:00']);assert.doesNotMatch(h,/\+71\.86%/);
 ordered(h,['fund-holdings','有効な注文','成立した売買']);
 contains(h,['9432','NTT','17,000株','購入価格 ¥166.5','現在価格 未確認','買った理由：未確認','利益確定価格 未確認','損切り価格 未確認','158円で撤退']);
 contains(h,['5401','日本製鉄','買い・逆指値','¥710','3,500株','理由：高値更新','損切り計画：直近安値割れ','有効注文']);
 contains(h,['2026-08-24','8306','三菱UFJ FG','売り・逆指値','¥3,489.5','700株','実現損益 -¥7,350','理由：予定どおり撤退','成立した売買']);
});
test('v301:69 and v356:102 source order retained for all-empty and trading fixtures',()=>{
 ordered(render(V301),['fund-summary','fund-chart','まだ取引記録がありません','fund-journal']);
 ordered(render(V356),['fund-summary','fund-chart','fund-holdings','fund-activity','fund-journal']);
});
test('v356:85 all production components forbid literal string Date constructors',()=>{
 for(const p of ['fund-read-contract.mjs','fund-read-gateway.mjs','fund-read-transport.mjs','individual-view/fund-individual-view.mjs','individual-view/fund-individual-chart.mjs','report-resume/fund-report-selection.mjs','report-resume/fund-report-gateway.mjs','report-view/fund-report-view.mjs']) {
 const source=fs.readFileSync(path.join(ROOT,'src/features/fund',STATIC_MAP[p]),'utf8');assert.doesNotMatch(source,/new Date\(\s*["'`]/,p);
 }
});
test('v356:103-118 every reason, target, why, status and basis marker from original fixture',()=>{
 const h=render(V356);contains(h,['52週の高値166.2円を超えたためです','買った理由：未確認','利益確定価格 未確認','¥171.5 (+3.00%)','¥7,500 (+16.28%)','¥6,000 (-6.98%)','理由：下落の線を171.5円に保ち、17,000株を守るためです。','理由：52週の高値を6,450円で超えたら400株買うためです。','有効注文','成立した売買','損切り計画：171.5円据え置き','利確の指値はなし(利は伸ばす)','トレーリングで171.5円へ上げました。','+15%の指値','6,000円まで下がったら売る']);assert.doesNotMatch(h,/158\.0円/);assert.equal((h.match(/class="fund-chart-key/g)||[]).length,3);
});
test('v356:146-151 exact top-series values and paths override contradictory raw NAV',()=>{
 const d=structuredClone(V356);d.series={dates:['2026-08-07','2026-08-20','2026-09-04'],fund:[100,101,101.8978],n225:[100,null,99.1071],spx:[100,100.2,100.4896]};
 const h=renderIndividualChart(d,esc);contains(h,['2026-08-07','2026-09-04']);
 const path=key=>h.match(new RegExp('class="fund-chart-line '+key+'" d="([^"]+)"'))[1];assert.equal((path('is-nav').match(/[ML]/g)||[]).length,3);assert.equal((path('is-n225').match(/M/g)||[]).length,2);
 assert.doesNotMatch(h,/20,000,000|20,379,550/);assert.match(h,/>101</);assert.equal((h.match(/<tr><th>2026-/g)||[]).length,3);
});
test('v356:167-171 malformed modern element cannot remove accepted healthy orders or trigger failure',()=>{
 const d=structuredClone(V356);d.orders.push({id:'ORD-BROKEN'});assert.equal(validateFundSource('fable',d).ok,true);
 const h=render(d);assert.doesNotMatch(h,/ORD-BROKEN/);contains(h,['下落の線を171.5円に保ち、17,000株を守るためです。']);assert.doesNotMatch(h,/形式が正しくありません|取得できませんでした/);
});
test('v356:192-223 gateway coalescing, generation update, missing/idle, failed-after-good retains timestamps/data',async()=>{
 let ready=false,release,clock=1000,body=V356,fail=false,count=0;
 const g=createFundReadGateway({now:()=>clock,captureConnection:()=>({ready,revision:1}),read:async()=>{count++;await new Promise(r=>release=r);return fail?{ok:false,status:500}:{ok:true,status:200,text:JSON.stringify(body)};}});
 assert.equal(g.snapshot('fable').state,'disconnected');ready=true;assert.equal(g.snapshot('fable').state,'idle');
 const run=async()=>{const p=g.load('fable',{force:true});await Promise.resolve();release();return await p;};
 fail=true;let s=await run();assert.equal(s.state,'failed');assert.equal(s.lastAttemptAt,1000);assert.equal(s.data,null);
 fail=false;const p=g.load('fable',{force:true}),p2=g.load('fable',{force:true});assert.equal(p,p2);await Promise.resolve();release();s=await p;assert.equal(count,2);assert.match(render(s.data),/18:34:00\+09:00/);
 body={...V356,generatedAt:'2026-09-04T19:10:00+09:00'};clock=2000;s=await run();assert.match(render(s.data),/19:10:00\+09:00/);assert.doesNotMatch(render(s.data),/18:34:00\+09:00/);
 fail=true;clock=3000;const last=await run();assert.equal(last.data,s.data);assert.equal(last.lastSuccessAt,2000);assert.equal(last.lastAttemptAt,3000);assert.match(view.render('fable',last),/前回正常に取得した成績/);
});
test('v356:234-256 whole/partial empty states independent and no plain body for null',()=>{
 let d={...V356,positions:[],orders:[],fills:[],openOrders:[],recentTrades:[],journalPlain:null};let h=render(d);assert.equal((h.match(/まだ取引記録がありません/g)||[]).length,1);assert.doesNotMatch(h,/fund-journal-plain/);
 d={...d,positions:V356.positions};h=render(d);assert.doesNotMatch(h,/まだ取引記録がありません/);contains(h,['有効な注文はありません','成立した売買はありません']);
 h=render({...V356,positions:[]});assert.match(h,/保有銘柄はありません/);assert.doesNotMatch(h,/まだ取引記録がありません/);
});

test('v301:62-64 raw two-point paths use separate provided units; every series has both dates',()=>{
 const h=renderIndividualChart(V301,esc),paths=[...h.matchAll(/class="fund-chart-line [^"]+" d="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(paths.length,3);assert.ok(paths.every(p=>p.includes('L')));
 contains(h,['20,000,000','20,400,000','40,000','40,400','6,500','6,630']);assert.doesNotMatch(h,/提供された起点100/);
});

}
{
 const {createFundComparisonView}=await component('comparison-view.js');
 const {createFundIndividualView}=await component('individual-view.js');
 const escapeHTML=v=>String(v).replaceAll('<','&lt;');
 const concrete=createFundIndividualView({escapeHTML,renderMarkdown:escapeHTML,readState:createFundComparisonView({escapeHTML}).readState});
 test('v356-32..34 real readState HTML connection/idle/loading/failure attempt timestamp',()=>{
  const render=s=>concrete.render('fable',s);
  assert.match(render({state:'disconnected'}),/接続設定が必要です/);
  assert.match(render({state:'idle'}),/成績：未取得/);
  assert.match(render({state:'idle',loading:true}),/成績：読み込み中/);
  const failed=render({state:'failed',lastAttemptAt:1000});
  assert.match(failed,/取得に失敗しました/);
  assert.match(failed,/今回の取得試行（UTC）：1970-01-01T00:00:01.000Z/);
  assert.match(failed,/表示できる成績がまだありません/);
 });
}
for(const {name,run} of checks){await run();console.log('PASS '+name);}
const {chromium,launchOptions,startServer,blockGithubApiByDefault,passGithubGate,randomPort}=require('./helpers');
const css=fs.readFileSync(path.join(ROOT,'styles.css'),'utf8');
assert.match(css,/\.fund-chart-line\.is-n225\s*\{[^}]*stroke-dasharray/);
assert.match(css,/\.fund-chart-line\.is-spx\s*\{[^}]*stroke-dasharray/);
const PORT=randomPort();let server,browser;
const KEY='taskchute-journal-pwa-state-v1';
const fundSelect='[data-action="fund-select"][data-engine="fable"]';
async function selectFable(page){const button=page.locator(fundSelect);assert.equal(await button.count(),1,'integrated engine selector');await button.click();}
async function monitor(page){return page.evaluate(key=>{
 window.__legacySetItem=Storage.prototype.setItem;window.__legacyWrites=0;
 Storage.prototype.setItem=function(k,v){if(k===key)window.__legacyWrites++;return window.__legacySetItem.call(this,k,v);};
 const raw=localStorage.getItem(key);return {raw,date:JSON.parse(raw)?.dataModifiedAt};
},KEY);}
async function unchanged(page,before){const after=await page.evaluate(key=>({raw:localStorage.getItem(key),writes:window.__legacyWrites}),KEY);assert.equal(after.raw,before.raw);assert.equal(after.writes,0);assert.equal(JSON.parse(after.raw)?.dataModifiedAt,before.date);await page.evaluate(()=>Storage.prototype.setItem=window.__legacySetItem);}
try {
 server=startServer(PORT);browser=await chromium.launch(launchOptions());
 for(const [version,fixture] of [['v356',V356]]){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844},timezoneId:'Asia/Tokyo'}),page=await context.newPage(),errors=[];
  const pendingWaits=[];
  const observe=promise=>{pendingWaits.push(promise);promise.catch(()=>{});return promise;};
  page.on('pageerror',e=>errors.push(e.message));await blockGithubApiByDefault(page);
  let body=fixture,requests=0,hold=true,release,arrived,nextArrived,cancelHandler;
  const arrival=new Promise(r=>arrived=r);
  await page.route(url=>url.hostname==='api.github.com',async route=>{
   const u=decodeURIComponent(new URL(route.request().url()).pathname);
   if(u.endsWith('/contents/taskchute/dashboard/fund.json')){
    requests++;arrived();if(nextArrived){nextArrived();nextArrived=null;}if(hold)await new Promise(r=>release=r);
    return route.fulfill({status:200,contentType:'application/json',body:typeof body==='string'?body:JSON.stringify(body)});
   }
   if(/\/contents\/taskchute\/(?:dashboard\/fund-|report-index\.json)/.test(u))return route.fulfill({status:404,body:''});
   if(u.endsWith('/contents/taskchute'))return route.fulfill({status:200,contentType:'application/json',body:'[]'});
   return route.fallback();
  });
  try{
   await page.goto(`http://localhost:${PORT}/`);await passGithubGate(page);await arrival;
   await page.locator('#bottomNav [data-action="nav"][data-view="more"]').click();
   assert.equal(await page.locator('.more-tower-item[data-view="fund"] small').textContent(),'振り返り');
   await page.locator('.more-tower-item[data-view="fund"]').click();await selectFable(page);
   assert.equal(await page.locator('#app[data-view="fund"]').count(),1);assert.equal(await page.locator('.fund-loading').count(),1);
   const before=await monitor(page);hold=false;release();await page.waitForSelector('.fund-summary');await unchanged(page,before);
   const mobile=await page.locator('#bottomNav [data-action="nav"]').evaluateAll(es=>es.map(e=>e.dataset.view));assert.equal(mobile.length,4);assert.ok(!mobile.includes('fund'));
   assert.equal(await page.locator('.nav-list [data-view="fund"]').count(),1);assert.equal(requests,1);
   if(version==='v301'){
    assert.equal(await page.locator('.fund-journal strong').textContent(),'既存Markdown経路');
    assert.equal(await page.locator('.fund-chart path.fund-chart-line').count(),3,'v301-13: actual DOM has all three raw-series paths');
    const paths=await page.locator('.fund-chart path.fund-chart-line').evaluateAll(es=>es.map(e=>e.getAttribute('d')));
    assert.ok(paths.every(p=>p.includes('L')),'each raw series retains both points');
   }
   if(version==='v356')await page.locator('.fund-undated-journal summary').click();
   for(const width of [390,768,1024,1280]){
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),`${version} width ${width}`);
    if(version==='v356'){
     assert.ok(await page.locator('.fund-journal-plain').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));
     if(width===1280){
      const b=await page.evaluate(()=>Object.fromEntries(['header','status','summary','chart','holdings','journal'].map(k=>{const sel={header:'.fund-view > .view-header',status:'.fund-status-line',summary:'.fund-summary',chart:'.fund-chart',holdings:'.fund-holdings',journal:'.fund-journal'}[k],r=document.querySelector(sel)?.getBoundingClientRect();return [k,r?{top:r.top,left:r.left}:null];})));
      assert.ok(Object.values(b).every(Boolean),'all PC boxes');
      for(const k of ['summary','chart','holdings','journal']){assert.ok(b.header.top<b[k].top);assert.ok(b.status.top<b[k].top);}
      assert.ok(Math.abs(b.summary.left-b.holdings.left)<1);assert.ok(Math.abs(b.chart.left-b.journal.left)<1);assert.ok(b.summary.left<b.chart.left);assert.ok(b.holdings.left<b.journal.left);assert.ok(Math.abs(b.summary.top-b.chart.top)<1);
     }
    }
   }
   const saved=await monitor(page),count=requests;hold=true;
   const click=page.locator('[data-action="fund-refresh"]');assert.equal(await click.count(),1);
   // DOM click dispatches synchronously while response remains held; disabled button must prevent second fetch.
   const requestSeen=observe(page.waitForRequest(r=>decodeURIComponent(r.url()).includes('/dashboard/fund.json')));
   const responseSeen=observe(page.waitForResponse(r=>decodeURIComponent(r.url()).includes('/dashboard/fund.json')));
   const handlerSeen=observe(new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('FABLE refresh route did not arrive')),15000);
    nextArrived=()=>{clearTimeout(timer);resolve();};
    cancelHandler=()=>{clearTimeout(timer);reject(new Error('FABLE refresh route wait cancelled'));};
   }));
   await click.evaluate(e=>{e.click();e.click();});await requestSeen;await handlerSeen;
   assert.equal(requests,count+1);hold=false;release();await responseSeen;await page.waitForFunction(()=>!document.querySelector('[data-action="fund-refresh"]')?.disabled);
   await unchanged(page,saved);
   if(version==='v281'){
    body=JSON.stringify({...fixture,positions:[null]});const badBefore=await monitor(page);
    const badResponse=observe(page.waitForResponse(r=>decodeURIComponent(r.url()).includes('/dashboard/fund.json')));
    await click.click();await badResponse;await page.waitForFunction(()=>!document.querySelector('[data-action="fund-refresh"]')?.disabled);
    assert.match(await page.locator('.fund-holdings').textContent(),/NTT/);assert.equal(await page.locator('.fund-summary').count(),1);await unchanged(page,badBefore);
   }
   body=fixture;await page.reload();await page.waitForSelector('#app[data-view="fund"]');await selectFable(page);await page.waitForSelector('.fund-summary');
   await page.locator('.nav-list [data-action="nav"][data-view="today"]').click();await page.locator('.nav-list [data-action="nav"][data-view="fund"]').click();await selectFable(page);await page.waitForSelector('#app[data-view="fund"] .fund-summary');assert.deepEqual(errors,[]);
  }finally{hold=false;if(release)release();if(cancelHandler)cancelHandler();await context.close();await Promise.allSettled(pendingWaits);}
 }
 console.log('legacy browser candidate: all checks passed');
}finally{try{if(browser)await browser.close();}finally{if(server)await new Promise(resolve=>server.close(resolve));}}

})().catch(error=>{console.error(error);process.exitCode=1;});
