// FUND regression: complete assertions remain visible to the test manifest.
'use strict';
(async () => {
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const {createFundReportView} = await import('../src/features/fund/report-view.js');
const {createFundReportSelection,fundReportFile,FUND_REPORT_TYPES} = await import('../src/features/fund/report-selection.js');
const {createFundReportGateway} = await import('../src/features/fund/report-gateway.js');
const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const good=text=>({ok:true,status:200,text});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
// 固定時計: 一覧の生成時刻(2026-09-06)から48時間以内に固定し、実行日が進んでも stale 判定へ落ちないようにする。
const clock=()=>{let t=Date.parse('2026-09-06T12:00:00Z');return ()=>t++;};
test('partial history names the failed source and never invents a generation time',async()=>{
  const name=fundReportFile('fundJournal','2026-09-05');
  let indexOK=false,dirOK=true;
  const gateway=createFundReportGateway({captureConnection:()=>({ready:true,revision:1}),now:clock(),
    read:path=>path==='report-index.json'?(indexOK?good(JSON.stringify({generatedAt:'2026-09-06T00:00:00Z',files:[{name}]})):{ok:false,status:404}):good('Synthetic report'),
    readDirectory:()=>dirOK?good(JSON.stringify([{name,type:'file'}])):{ok:false,status:503}});
  const view=createFundReportView({selection:createFundReportSelection(),gateway,escapeHTML:esc,renderMarkdown:esc});
  await view.loadCurrent();
  assert.match(view.render(),/一覧ファイルを確認できないため/);
  assert.match(view.render(),/一覧生成時刻：未確認/);
  indexOK=true;dirOK=false;await view.refresh();
  assert.match(view.render(),/フォルダの再確認に失敗しました/);
  assert.match(view.render(),/2026-09-06T00:00:00Z/);
});
function setup(initial={}) {
  const files=new Map(),calls=[],updates=[];let revision=1,back=0,time=10;
  files.set('report-index.json',good(JSON.stringify({generatedAt:'2026-09-06T00:00:00Z',files:[]})));
  const gateway=createFundReportGateway({captureConnection:()=>({ready:true,revision,readContext:{}}),timeoutMs:100,
    read:name=>{calls.push(name);return files.get(name)||{ok:false,status:404};},now:()=>time++});
  const view=createFundReportView({selection:createFundReportSelection(initial),gateway,escapeHTML:esc,renderMarkdown:esc,
    onUpdate:value=>updates.push(value),onBack:()=>back++});
  return {view,gateway,files,calls,updates,connect:()=>revision++,getBack:()=>back,
    index:names=>files.set('report-index.json',good(JSON.stringify({generatedAt:'2026-09-06T00:00:00Z',files:names.map(name=>({name}))})))};
}
test('same date preserved across all four choices and missing does not substitute other latest',async()=>{
  const h=setup(),date='2026-09-05';h.index([fundReportFile('fundJournal',date),fundReportFile('marketCodex','2026-09-06')]);
  h.files.set(fundReportFile('fundJournal',date),good('same day'));
  await h.view.select('fable','journal',date);
  for(const t of FUND_REPORT_TYPES) {await h.view.select(t.engine,t.family);assert.equal(h.view.snapshot().date,date);}
  assert.match(h.view.render(),/この日のブリーフはありません/);assert.equal(h.view.snapshot().name,fundReportFile('marketCodex',date));
  assert.equal(h.calls.includes(fundReportFile('marketCodex','2026-09-06')),false);
});
test('complete shared family history, previous and next, explicitly unlisted date retained',async()=>{
  const h=setup(),names=Array.from({length:28},(_,i)=>fundReportFile(i%2?'fundJournal':'fundJournalCodex',`2026-08-${String(i+1).padStart(2,'0')}`));
  h.index(names);await h.view.loadCurrent();assert.equal(h.view.snapshot().date,'2026-08-28');
  assert.equal(h.view.snapshot().history.length,28);assert.equal((h.view.render().match(/<option /g)||[]).length,28);
  await h.view.previous();assert.equal(h.view.snapshot().date,'2026-08-27');await h.view.next();assert.equal(h.view.snapshot().date,'2026-08-28');
  await h.view.select('codex','journal','2020-01-01');assert.equal(h.view.snapshot().date,'2020-01-01');assert.equal(h.view.snapshot().history.length,29);
});
test('late selected report only updates its cache, never newly selected report or UI update',async()=>{
  const h=setup(),slow=deferred();h.files.set(fundReportFile('fundJournal','2026-09-01'),slow.promise);
  const old=h.view.select('fable','journal','2026-09-01');
  for(let i=0;i<100 && !h.calls.includes(fundReportFile('fundJournal','2026-09-01'));i++) await Promise.resolve();
  assert.equal(h.calls.includes(fundReportFile('fundJournal','2026-09-01')),true);
  h.files.set(fundReportFile('fundJournalCodex','2026-09-02'),good('NEW CODEX'));
  await h.view.select('codex','journal','2026-09-02');const count=h.updates.length;slow.resolve(good('OLD FABLE'));
  assert.equal((await old).discarded,true);assert.equal(h.updates.length,count);assert.match(h.view.render(),/NEW CODEX/);assert.doesNotMatch(h.view.render(),/OLD FABLE/);
});
test('refresh failure retains normal prior body/time, retry updates body, repeat calls merge',async()=>{
  const h=setup(),name=fundReportFile('market','2026-09-06');h.files.set(name,good('old normal'));
  await h.view.select('fable','brief','2026-09-06');const time=h.view.snapshot().report.lastSuccessAt;
  h.files.set(name,{ok:false,status:500});await h.view.refresh();const html=h.view.render();
  assert.match(html,/old normal/);assert.match(html,/前回正常に取得した本文/);assert.match(html,/data-report-loaded="0"/);
  assert.equal(h.view.snapshot().report.lastSuccessAt,time);
  h.files.set(name,good('new normal'));await Promise.all(Array.from({length:20},()=>h.view.refresh()));
  assert.match(h.view.render(),/new normal/);assert.match(h.view.render(),/data-report-loaded="1"/);
});
test('money renders both named engines for exact date and only requests those two permitted paths',async()=>{
  const h=setup(),date='2026-09-03';h.files.set(fundReportFile('fundJournal',date),good('# synthetic same date'));
  const html=await h.view.loadMoney(date);assert.match(html,/FABLE FUND 2026-09-03/);assert.match(html,/CODEX FUND 2026-09-03/);
  assert.match(html,/synthetic same date/);assert.match(html,/この日の日誌はありません/);assert.equal(h.calls.length,2);
  assert.equal(h.updates[0].area,'money');assert.equal(h.updates[0].date,date);assert.equal(h.view.snapshot().date,null);
  assert.doesNotMatch(h.view.money('2026-09-04'),/synthetic same date/);
});
test('body and labels escape, allowed relative link selects exact report, external untouched and back delegated',async()=>{
  const h=setup(),name=fundReportFile('marketCodex','2026-09-06');h.files.set(name,good('<img src=x onerror=attack>'));
  await h.view.select('codex','brief','2026-09-06');assert.doesNotMatch(h.view.render(),/<img/);assert.match(h.view.render(),/&lt;img/);
  for(const link of ['https://example.test/','javascript:alert(1)','../app-state.json','%2e%2e%2ffile']) assert.equal(h.view.openLink(link),false);
  assert.equal(h.view.openLink(encodeURIComponent(fundReportFile('fundJournal','2025-01-01'))),true);
  assert.equal(h.view.snapshot().date,'2025-01-01');assert.equal(h.view.snapshot().engine,'fable');
  h.view.back();assert.equal(h.getBack(),1);
});
test('connection changes discard old normal body and pending money update',async()=>{
  const h=setup(),date='2026-09-03';h.files.set(fundReportFile('fundJournal',date),good('old private'));
  await h.view.select('fable','journal',date);h.connect();assert.doesNotMatch(h.view.render(),/old private/);
  const slow=deferred();h.files.set(fundReportFile('fundJournal',date),slow.promise);const pending=h.view.loadMoney(date);
  await Promise.resolve();h.connect();h.gateway.snapshot(fundReportFile('fundJournal',date));slow.resolve(good('late private'));
  assert.equal((await pending).discarded,true);assert.equal(h.updates.some(u=>u.area==='money'),false);
});
test('no state/persistence/fetch/DOM mutation dependencies in view; invalid dates fail closed',async()=>{
  const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../src/features/fund/report-view.js',require('node:url').pathToFileURL(__filename)),'utf8');
  assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|saveState|setState|innerHTML|document\.|fetch\(/);
  const h=setup();assert.throws(()=>h.view.select('fable','journal','2026-02-30'));assert.equal(h.view.money('bad'),'');
});
test('explicit date body does not wait for delayed history index',async()=>{
  const h=setup(),index=deferred(),date='2026-09-01';h.files.set('report-index.json',index.promise);
  h.files.set(fundReportFile('fundJournal',date),good('direct body'));
  await h.view.select('fable','journal',date);assert.match(h.view.render(),/direct body/);
  index.resolve(good(JSON.stringify({generatedAt:'2026-09-06T00:00:00Z',files:[]})));
});

})().catch(error => { console.error(error); process.exitCode = 1; });
