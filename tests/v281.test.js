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
const {createFundReadGateway}=await component('read-gateway.js');
function setup(){let clock=1000,ready=false,calls=0,result={ok:true,status:200,text:JSON.stringify(V281)};
 const gateway=createFundReadGateway({now:()=>clock,captureConnection:()=>({ready,revision:1}),read:async path=>{assert.equal(path,'dashboard/fund.json');calls++;return result;}});
 return {gateway,set ready(v){ready=v;},set clock(v){clock=v;},set result(v){result=v;},get calls(){return calls;}};}
test('v281:53-100 exact path, disconnected, TTL boundaries, original six bad shapes, empty and malformed lastGood',async()=>{
 const h=setup(),g=h.gateway;assert.equal((await g.load('fable')).state,'disconnected');assert.equal(h.calls,0);
 h.ready=true;const first=await g.load('fable');assert.equal(first.lastSuccessAt,1000);assert.equal(first.state,'available');
 h.clock=1800999;await g.load('fable');assert.equal(h.calls,1);
 h.clock=1801000;h.result={ok:false,status:404};let failed=await g.load('fable');assert.equal(h.calls,2);assert.equal(failed.data,first.data);assert.equal(failed.fetchedAt,1801000);assert.equal(failed.lastSuccessAt,1000);
 const invalid=[{version:1},{...V281,positions:[null]},{...V281,openOrders:{}},{...V281,nav:'broken'},{...V281,recentTrades:['broken']}].map(JSON.stringify);
 invalid.push(JSON.stringify(V281).replace('"current":20292650','"current":1e309'),'','{broken');
 for(const text of invalid){h.result={ok:true,status:200,text};failed=await g.load('fable',{force:true});assert.equal(failed.state,'invalid');assert.equal(failed.data,first.data);assert.equal(failed.lastSuccessAt,1000);}
 h.clock=1802000;h.result={ok:true,status:200,text:JSON.stringify(V281)};const next=await g.load('fable');assert.equal(next.lastSuccessAt,1802000);const n=h.calls;await g.load('fable');assert.equal(h.calls,n);
});
test('v281:113-137 nullable both/one/normal accepted, missing benchmark key rejected preserving data',async()=>{
 const h=setup();h.ready=true;let prior;
 for(const values of [[null,null],[null,7500],[64000,7500]]){const d=structuredClone(V281);[d.nav.series[0].n225,d.nav.series[0].spx]=values;h.result={ok:true,status:200,text:JSON.stringify(d)};prior=await h.gateway.load('fable',{force:true});assert.equal(prior.state,'available');}
 const d=structuredClone(V281);delete d.nav.series[0].n225;h.result={ok:true,status:200,text:JSON.stringify(d)};const bad=await h.gateway.load('fable',{force:true});assert.equal(bad.state,'invalid');assert.equal(bad.data,prior.data);
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
 for(const [version,fixture] of [['v281',V281]]){
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
