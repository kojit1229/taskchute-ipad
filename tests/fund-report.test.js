// FUND regression: complete assertions remain visible to the test manifest.
'use strict';
(async () => {
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const {FUND_REPORT_TYPES,validReportDate,classifyFundReport,fundReportFile,unionReportEntries,
  createFundReportSelection,resolveFundReportLink} = await import('../src/features/fund/report-selection.js');
const {createFundReportGateway} = await import('../src/features/fund/report-gateway.js');
const date='2026-09-06',f=fundReportFile('fundJournal',date),c=fundReportFile('fundJournalCodex',date);
const good=text=>({ok:true,status:200,text});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function harness(options={}) {
  let revision=1,ready=true,time=10,response=good('架空の日誌'),offline=false;
  const calls=[];
  const gateway=createFundReportGateway({captureConnection:()=>({ready,revision,readContext:{revision}}),
    read:(name,ctx)=>{calls.push({name,...ctx});return typeof response==='function'?response(name):response;},
    now:()=>time,isOffline:()=>offline,timeoutMs:100,...options});
  return {gateway,calls,setResponse:r=>response=r,tick:()=>time++,connect:()=>revision++,
    disconnect:()=>ready=false,offline:()=>offline=true};
}
test('strict classification covers four names, leap years and all mismatched metadata',()=>{
  for(const type of FUND_REPORT_TYPES) {
    const name=fundReportFile(type.kind,date);
    assert.equal(classifyFundReport({name}).kind,type.kind);
    assert.equal(classifyFundReport({name,kind:type.kind,date}).date,date);
    for(const entry of [{name,kind:'unknown'},{name,kind:null},{name,date:null},{name,date:'2026-09-05'},
      {name,type:'dir'},{name:`../${name}`},{name:`${name}.bak`},{name:name.replace(date,'2026-02-29')}])
      assert.equal(classifyFundReport(entry),null);
  }
  for(const d of ['2024-02-29','2000-02-29','0001-01-01','9999-12-31']) assert.equal(validReportDate(d),true);
  for(const d of ['1900-02-29','0000-01-01','2026-13-01','2026-04-31','2026-9-06','2026-09-06T00:00Z']) assert.equal(validReportDate(d),false);
  assert.equal(classifyFundReport({name:fundReportFile('marketCodex',date),kind:'market'}),null);
});
test('union retains index metadata, rejects poison, preserves unrelated monthly reports',()=>{
  const index=[{name:f,kind:'market',date},{name:c,kind:'fundJournalCodex',date},
    {name:'自己分析_2026-09.md',kind:'self',date:'2026-09'}];
  const dir=index.map(e=>({name:e.name,type:'file',marker:'contents'}));
  const result=unionReportEntries(index,dir);
  assert.equal(classifyFundReport(result[0]),null);
  assert.equal(classifyFundReport(result[1]).kind,'fundJournalCodex');
  assert.deepEqual(result[2],dir[2]);assert.equal(index[0].type,undefined);
});
test('shared selector keeps same date across all four types and missing-day history',()=>{
  const entries=[{name:f},{name:fundReportFile('fundJournalCodex','2026-09-05')},
    {name:fundReportFile('market','2026-09-07')}];
  const selection=createFundReportSelection();assert.equal(selection.initialize(entries).date,date);
  for(const type of FUND_REPORT_TYPES) assert.equal(selection.select(type.kind).date,date);
  assert.equal(selection.initialize(entries).date,date);
  assert.deepEqual(selection.history(entries),['2026-09-07',date]);
  assert.equal(selection.move(entries,-1).date,'2026-09-07');
  selection.select('fundJournal','2020-01-01');assert.equal(selection.initialize(entries).date,'2020-01-01');
  assert.equal(selection.move(entries,-1).date,'2026-09-05');
  assert.throws(()=>selection.select('market','2026-02-30'));
});
test('relative links only resolve exact permitted markdown names',()=>{
  assert.equal(resolveFundReportLink(encodeURIComponent(f)).name,f);
  for(const href of ['../'+f,'https://example.test/'+f,'javascript:alert(1)','%2e%2e%2f'+f,f+'#x',f+'?x','app-state.json'])
    assert.equal(resolveFundReportLink(href),null);
});
test('independent four paths, same-file force joins, refresh failure retains lastGood',async()=>{
  const h=harness(),d=deferred();h.setResponse(()=>d.promise);
  const promises=FUND_REPORT_TYPES.map(t=>h.gateway.load(fundReportFile(t.kind,date)));
  const joined=h.gateway.load(f,{force:true});assert.equal(joined,promises[0]);
  d.resolve(good('朝版'));await Promise.all(promises);assert.equal(h.calls.length,4);
  const prior=h.gateway.snapshot(f);h.tick();h.setResponse({ok:false,status:500});
  const failed=await h.gateway.load(f,{force:true});assert.equal(failed.data,'朝版');
  assert.equal(failed.lastSuccessAt,prior.lastSuccessAt);assert.equal(failed.state,'failed');
  assert.equal(h.gateway.snapshot(c).state,'available');
  h.setResponse(good('夜版'));assert.equal((await h.gateway.load(f,{force:true})).data,'夜版');
});
test('status and empty body failures do not become a missing or successful report',async()=>{
  const h=harness();await h.gateway.load(f);
  for(const [status,expected] of [[404,'missing'],[401,'unauthorized'],[403,'unauthorized'],[500,'failed']]) {
    h.setResponse({ok:false,status});const r=await h.gateway.load(f,{force:true});
    assert.equal(r.state,expected);assert.equal(r.data,'架空の日誌');assert.equal(r.loading,false);
  }
  h.setResponse(good('  '));assert.equal((await h.gateway.load(f,{force:true})).state,'invalid');
  h.offline();h.setResponse({ok:false,status:0});assert.equal((await h.gateway.load(f,{force:true})).state,'offline');
  assert.throws(()=>h.gateway.load('../app-state.json'));
});
test('connection changes abort old reads and A-B-A cannot leak late body or context',async()=>{
  const h=harness(),old=deferred();h.setResponse(()=>old.promise);
  const pending=h.gateway.load(f);await Promise.resolve();h.connect();
  assert.equal(h.gateway.snapshot(f).data,null);assert.equal(h.calls[0].signal.aborted,true);
  h.connect();h.setResponse(good('新接続'));await h.gateway.load(f);
  old.resolve(good('秘密旧本文'));assert.equal((await pending).discarded,true);
  assert.equal(h.gateway.snapshot(f).data,'新接続');assert.equal(h.calls[1].context.revision,3);
  assert.equal(JSON.stringify(h.gateway.snapshot(f)).includes('revision'),false);
  h.disconnect();assert.equal(h.gateway.snapshot(f).data,null);assert.equal(h.gateway.snapshot(f).state,'disconnected');
});
test('timeout settles, preserves good body, retry survives late result and disposal',async()=>{
  const h=harness({timeoutMs:5});await h.gateway.load(f);const slow=deferred();h.setResponse(()=>slow.promise);
  const result=await h.gateway.load(f,{force:true});assert.equal(result.error,'timeout');assert.equal(result.data,'架空の日誌');
  h.setResponse(good('再試行'));await h.gateway.load(f,{force:true});slow.resolve(good('遅延'));
  await Promise.resolve();assert.equal(h.gateway.snapshot(f).data,'再試行');
  h.gateway.dispose();assert.equal(h.gateway.snapshot(f).state,'disposed');assert.equal(h.gateway.snapshot(f).data,null);
});
test('index is immutable, metadata retained, malformed refresh retains prior history',async()=>{
  const h=harness();h.setResponse(good(JSON.stringify({generatedAt:'2026-09-06T00:00:00Z',files:[{name:f,kind:'market',date}]})));
  const first=await h.gateway.load('report-index.json');assert.equal(classifyFundReport(first.data.files[0]),null);
  assert.throws(()=>first.data.files.push({name:c}));assert.throws(()=>first.data.files[0].kind='fundJournal');
  h.setResponse(good('{'));const invalid=await h.gateway.load('report-index.json',{force:true});
  assert.equal(invalid.state,'invalid');assert.equal(invalid.data,first.data);
  for(const body of [{files:[]},{generatedAt:'2026-02-30T00:00:00Z',files:[]},
    {generatedAt:'2026-09-06T00:00:00Z',files:[4,null]}]) {
    h.setResponse(good(JSON.stringify(body)));const bad=await h.gateway.load('report-index.json',{force:true});
    assert.equal(bad.state,'invalid');assert.equal(bad.data,first.data);
  }
});
test('components require no state, persistence or write transport',async()=>{
  const {readFile}=await import('node:fs/promises');
  for(const name of ['../src/features/fund/report-selection.js','../src/features/fund/report-gateway.js']) {
    const source=await readFile(new URL(name,require('node:url').pathToFileURL(__filename)),'utf8');
    assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|saveState|setState|journals|fetch\(/);
  }
});

})().catch(error => { console.error(error); process.exitCode = 1; });
