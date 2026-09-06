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
const {fundMetadata,validateFundSource}=await component('read-contract.js');
let input;
const view=createFundIndividualView({escapeHTML:String,renderMarkdown:m=>{input=m;return '<strong>既存Markdown経路</strong>';},readState:()=>''});
const render=(data,time)=>view.render('fable',{data,state:'available',metadata:fundMetadata('fable',data,time)});
test('v301:65-90 injected Markdown, unchanged timestamp freshness under/at/over120h',()=>{
 const stamp=Date.parse(V301.generatedAt),hour=3600000;
 let html=render(V301,stamp+119*hour);assert.equal(input,V301.journal.markdown);assert.match(html,/<strong>既存Markdown経路<\/strong>/);assert.doesNotMatch(html,/fund-stale-badge/);
 assert.doesNotMatch(render(V301,stamp+120*hour),/fund-stale-badge/);assert.match(render(V301,stamp+120*hour+1),/fund-stale-badge/);
});
test('v301:82-98 journal null/undefined/absent accepted, no body and one point in each raw-unit graph',()=>{
 for(const mode of ['null','undefined','absent']) {const d=structuredClone(V301);if(mode==='absent')delete d.journal;else d.journal=mode==='null'?null:undefined;
 assert.equal(validateFundSource('fable',d).ok,true);d.nav.series=d.nav.series.slice(0,1);const html=render(d,0);assert.doesNotMatch(html,/<strong>既存Markdown経路<\/strong>/);assert.equal((html.match(/<circle class="fund-chart-dot/g)||[]).length,3);}
});
// Original raw chart fixtures and explicit revised guarantee: independent provided units, no normalization.

}
{
const {renderIndividualChart}=await component('individual-chart.js');
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
 for(const [version,fixture] of [['v301',V301]]){
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
