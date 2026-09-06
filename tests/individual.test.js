// FUND regression: complete assertions remain visible to the test manifest.
'use strict';
(async () => {
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const {createFundIndividualView} = await import('../src/features/fund/individual-view.js');
const {individualChartModel,renderIndividualChart} = await import('../src/features/fund/individual-chart.js');
const {fundMetadata} = await import('../src/features/fund/read-contract.js');
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

})().catch(error => { console.error(error); process.exitCode = 1; });
