// FUND regression: complete assertions remain visible to the test manifest.
'use strict';
(async () => {
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const fs = (await import('node:fs')).default;
const {FUND_SOURCES,validateFundSource,fundMetadata,validFundDate,fundTimestamp} = await import('../src/features/fund/read-contract.js');
const {createFundReadGateway} = await import('../src/features/fund/read-gateway.js');
const time=Date.UTC(2026,8,6,0), stamp='2026-09-06T09:00:00+09:00';
const clone=v=>structuredClone(v);
function individual(codex=false) {return {version:1,generatedAt:stamp,start:{date:'2026-09-04',capital:100},
  nav:{current:110,dayChangePct:0,totalReturnPct:10,series:[{date:'2026-09-04',nav:100,n225:100,spx:100},{date:'2026-09-05',nav:110,n225:101,spx:102}]},
  benchmark:{n225ReturnPct:1,spxReturnPct:2,excessVsN225:9,excessVsSpx:8},cash:10,positions:[],openOrders:[],recentTrades:[],
  ...(codex?{engine:{id:'codex',requestedModel:'requested-fixture',actualModel:null,costUsd:null}}:{})};}
const status=()=>({version:1,engine:'codex',status:'ready',checkedAt:stamp,lastAttemptAt:stamp,lastSuccessAt:stamp,valuationDate:'2026-09-05'});
const comparison=()=>({version:1,generatedAt:stamp,status:'ready',startDate:'2026-09-04',valuationDate:'2026-09-05',
  series:[{date:'2026-09-04',fable:100,codex:100},{date:'2026-09-05',fable:110,codex:105}],
  metrics:{fable:{returnPct:10,maxDrawdownPct:0},codex:{returnPct:5,maxDrawdownPct:0}},codexMinusFablePctPoints:-5});
const fixture=s=>s==='fable'?individual():s==='codex'?individual(true):s==='status'?status():comparison();
const response=v=>({ok:true,status:200,text:JSON.stringify(v)});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(read,opts={}) {
  let revision=1,ready=true,t=time,offline=false;
  const calls=[];
  const gateway=createFundReadGateway({captureConnection:()=>({ready,revision,readContext:{secret:'fixture-only',revision}}),
    read:(path,args)=>{calls.push({path,args});return read(path,args);},now:()=>t,isOffline:()=>offline,timeoutMs:1000,...opts});
  return {gateway,calls,change:()=>revision++,connect:v=>ready=v,clock:v=>t=v,offline:v=>offline=v};
}
test('4 source schemas, old FABLE optional fields and actual model never inferred',()=>{
  for(const s of Object.keys(FUND_SOURCES)) assert(validateFundSource(s,fixture(s)).ok);
  assert.equal(fundMetadata('fable',individual(),time).actualModel,null);
  assert.equal(fundMetadata('codex',individual(true),time).actualModel,null);
  const actual=individual(true);actual.engine.actualModel='observed-fixture';assert.equal(fundMetadata('codex',actual,time).actualModel,'observed-fixture');
  for(const v of [true,'1',Infinity,NaN,null]) {const f=individual();f.nav.current=v;assert(!validateFundSource('fable',f).ok);}
  const f=individual();f.orders=[{}];f.fills=[{code:'partial'}];assert(validateFundSource('fable',f).ok);
  assert(!validateFundSource('codex',individual()).ok);
  assert(!validateFundSource('fable',individual(true)).ok);
  const named=individual();named.engine={id:'fable',actualModel:'observed-fixture'};
  assert(validateFundSource('fable',named).ok);
  assert(!validateFundSource('codex',named).ok);
  named.engine.id='unknown';assert(!validateFundSource('fable',named).ok);
});
test('date calendar/offset boundary without string Date parsing',()=>{
  for(const d of ['2024-02-29','2000-02-29','0001-01-01'])assert(validFundDate(d));
  for(const d of ['2025-02-29','1900-02-29','0000-01-01','2026-9-06','2026-13-01'])assert(!validFundDate(d));
  assert.equal(fundTimestamp(stamp),time);assert.equal(fundTimestamp('2026-09-06T00:00:00Z'),time);
  assert.equal(fundTimestamp('2026-09-05T20:00:00-04:00'),time);
  assert.equal(fundTimestamp('2026-09-06T00:00:00.123456Z'),time+123);
  for(const d of ['2026-09-06T24:00:00Z','2026-09-06T00:00:00','2026-09-06T00:00:00+24:00'])assert.equal(fundTimestamp(d),null);
});
test('invalid, duplicate or unordered valuation dates do not attach old date to current NAV',()=>{
  for(const dates of [['2026-09-04','broken'],['2026-09-04','2026-09-04'],['2026-09-05','2026-09-04']]) {
    const f=individual();f.nav.series.forEach((r,i)=>r.date=dates[i]);
    assert(validateFundSource('fable',f).ok);assert.equal(fundMetadata('fable',f,time).valuationDate,null);
    assert.equal(fundMetadata('fable',f,time).benchmarkComparable,false);assert.equal(f.nav.current,110);
  }
  const f=individual();assert.equal(fundMetadata('fable',f,time).benchmarkComparable,true);
  f.start.date='2026-09-03';assert.equal(fundMetadata('fable',f,time).benchmarkComparable,false);
  f.nav.series=[];assert.equal(fundMetadata('fable',f,time).valuationDate,null);
});
test('generation age distinct from valuation and processing attempts',()=>{
  const f=individual(), m=fundMetadata('fable',f,time+120*3600000);assert.equal(m.stale,false);assert.equal(m.valuationDate,'2026-09-05');
  assert.equal(fundMetadata('fable',f,time+120*3600000+1).stale,true);
  f.generatedAt='unknown';assert.equal(fundMetadata('fable',f,time).stale,null);
  const s=status();s.status='new_backend_state';assert(validateFundSource('status',s).ok);assert.equal(fundMetadata('status',s,time).producerStatus,'unknown');
});
test('comparison 0/1/2, malformed dates/types and no client metrics recomputation',()=>{
  for(const n of [0,1]) {const c=comparison();c.series.length=n;assert(!validateFundSource('comparison',c).ok);}
  for(const state of ['insufficient_data','error'])assert(validateFundSource('comparison',{...comparison(),status:state,series:[],metrics:null,startDate:null,valuationDate:null,codexMinusFablePctPoints:undefined}).ok);
  for(const mutate of [c=>c.series[1].date=c.series[0].date,c=>c.startDate='2026-09-03',c=>c.metrics.fable.returnPct=null,c=>c.metrics.codex.maxDrawdownPct=1,c=>c.codexMinusFablePctPoints=Infinity]) {
    const c=comparison();mutate(c);assert(!validateFundSource('comparison',c).ok);
  }
  for(const n of [-10,0,10]) {const c=comparison();c.metrics.fable.returnPct=n;const before=JSON.stringify(c);assert(validateFundSource('comparison',c).ok);assert.equal(JSON.stringify(c),before);}
});
test('4 inflights independent, force/repeated taps join, immutable returned snapshot',async()=>{
  const queues=Object.fromEntries(Object.values(FUND_SOURCES).map(p=>[p,deferred()]));
  const h=harness(p=>queues[p].promise), promises=Object.keys(FUND_SOURCES).map(s=>h.gateway.load(s));
  assert.equal(promises[0],h.gateway.load('fable',{force:true}));await Promise.resolve();assert.equal(h.calls.length,4);
  for(const s of Object.keys(FUND_SOURCES))queues[FUND_SOURCES[s]].resolve(response(fixture(s)));
  await Promise.all(promises);const snap=h.gateway.snapshot('fable');assert.equal(snap.loading,false);assert.equal(snap.lastSuccessAt,time);
  assert.throws(()=>snap.data.nav.current=0);snap.state='tampered';snap.metadata.valuationDate='bad';
  assert.equal(h.gateway.snapshot('fable').state,'available');assert.equal(h.gateway.snapshot('fable').metadata.valuationDate,'2026-09-05');
  assert(!JSON.stringify(snap).includes('fixture-only'));assert(!('inflight' in snap));assert(!('context' in snap));
  await h.gateway.load('fable');assert.equal(h.calls.length,4);h.gateway.dispose();
});
test('success then 404/auth/invalid/5xx/offline retain data+success time, retry restores',async()=>{
  let next=response(individual());const h=harness(()=>next);await h.gateway.load('fable');
  for(const [res,state] of [[{ok:false,status:404},'not_created'],[{ok:false,status:403},'unauthorized'],
    [{ok:true,status:200,text:'{'},'invalid'],[response({}),'invalid'],[{ok:false,status:500},'failed'],[{ok:false,status:0},'offline']]) {
    h.clock(time+10);h.offline(true);next=res;const out=await h.gateway.load('fable',{force:true});
    assert.equal(out.state,state);assert.equal(out.data.nav.current,110);assert.equal(out.lastSuccessAt,time);assert.equal(out.fetchedAt,time+10);assert.equal(out.loading,false);
    assert.equal(h.gateway.snapshot('codex').data,null);
  }
  next=response(individual());assert.equal((await h.gateway.load('fable',{force:true})).state,'available');h.gateway.dispose();
});
test('FABLE only, CODEX only, neither created and malformed peer remain separate',async()=>{
  for(const available of ['fable','codex',null]) {
    const h=harness(p=>p===FUND_SOURCES[available]?response(fixture(available)):{ok:false,status:404});
    await h.gateway.refreshAll();for(const s of ['fable','codex'])assert.equal(h.gateway.snapshot(s).state,s===available?'available':'not_created');h.gateway.dispose();
  }
  const h=harness(p=>p===FUND_SOURCES.fable?response(individual()):response({broken:true}));await h.gateway.refreshAll();assert.equal(h.gateway.snapshot('fable').state,'available');assert.equal(h.gateway.snapshot('codex').state,'invalid');h.gateway.dispose();
});
test('connection change and A-B-A epochs discard late response and credentials',async()=>{
  const first=deferred();let next=first.promise;const h=harness(()=>next), a=h.gateway.load('fable');await Promise.resolve();
  h.change();assert.equal(h.gateway.snapshot('fable').data,null);next=response(individual());await h.gateway.load('fable');
  h.change();const epoch=h.gateway.snapshot('fable').epoch;first.resolve(response({...individual(),cash:999}));assert((await a).discarded);
  assert.equal(h.gateway.snapshot('fable').epoch,epoch);assert.equal(h.gateway.snapshot('fable').data,null);
  h.connect(false);assert.equal(h.gateway.snapshot('fable').state,'disconnected');assert(h.calls[0].args.signal.aborted);h.gateway.dispose();
});
test('unresolved adapter/body timeout clears busy, ignores late success and permits retry',async()=>{
  const wait=deferred();let next=wait.promise;const h=harness(()=>next,{timeoutMs:10});
  const result=await h.gateway.load('fable');assert.equal(result.error,'timeout');assert.equal(result.loading,false);
  assert(h.calls[0].args.signal.aborted);next=response(individual());await h.gateway.load('fable',{force:true});
  wait.resolve(response({...individual(),cash:999}));await Promise.resolve();assert.equal(h.gateway.snapshot('fable').data.cash,10);h.gateway.dispose();
});
test('throwing transport/getters have fixed errors, disposal settles pending reads',async()=>{
  for(const read of [()=>{throw Error('secret-fixture');},()=>({get ok(){throw Error('secret-fixture');}})]) {
    const h=harness(read);const out=await h.gateway.load('fable');assert.equal(out.error,'read_failed');assert(!JSON.stringify(out).includes('secret-fixture'));h.gateway.dispose();
  }
  const h=harness(()=>new Promise(()=>{}));const p=h.gateway.load('fable');h.gateway.dispose();assert((await p).discarded);
  assert.equal(h.calls.length,0,'dispose before queued I/O prevents transport invocation');
});
test('no persistence, app state or AI imports; cache instance reload starts empty',()=>{
  const code=fs.readFileSync(new URL('../src/features/fund/read-gateway.js',require('node:url').pathToFileURL(__filename)),'utf8');
  assert(!/localStorage|saveState|app\.js|state\/store|anthropic|openai/.test(code));
  const h=harness(()=>response(individual()));assert.equal(h.gateway.snapshot('fable').data,null);h.gateway.dispose();
});

})().catch(error => { console.error(error); process.exitCode = 1; });
