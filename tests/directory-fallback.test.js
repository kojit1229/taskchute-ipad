// FUND regression: complete assertions remain visible to the test manifest.
'use strict';
(async () => {
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const {createFundReportGateway} = await import('../src/features/fund/report-gateway.js');
const {classifyFundReport} = await import('../src/features/fund/report-selection.js');
const name='FABLE FUND日誌_2026-09-06.md',other='CODEX FUND日誌_2026-09-06.md';
const ok=value=>({ok:true,status:200,text:JSON.stringify(value)});
const index=files=>ok({generatedAt:'2026-09-06T01:00:00Z',files});
const captureConnection=()=>({ready:true,revision:1,readContext:'captured'});
test('initial valid index avoids directory, force unions while explicit poison metadata wins',async()=>{
 let dirs=0;const g=createFundReportGateway({captureConnection,read:async()=>index([{name,kind:'WRONG',date:'2026-09-05'}]),readDirectory:async o=>{dirs++;assert.equal(o.context,'captured');return ok([{name,type:'file'},{name:other,type:'file'},{name:'monthly.md',type:'file'}]);}});
 await g.load('report-index.json');assert.equal(dirs,0);
 const s=await g.load('report-index.json',{force:true});assert.equal(dirs,1);assert.equal(s.data.files.length,3);
 assert.equal(classifyFundReport(s.data.files.find(f=>f.name===name)),null);assert.equal(s.data.generatedAt,'2026-09-06T01:00:00Z');
 assert.deepEqual(s.sources,{index:'available',directory:'available'});
});
test('missing broken and throwing index fall back to directory without invented generation timestamp',async()=>{
 for(const read of [async()=>({ok:false,status:404}),async()=>ok({}),async()=>{throw Error();}]) {
 const g=createFundReportGateway({captureConnection,read,readDirectory:async()=>ok([{name,type:'file'},{name:'folder',type:'dir'}])});
 const s=await g.load('report-index.json');assert.equal(s.state,'available');assert.equal(s.data.generatedAt,null);assert.deepEqual(s.data.files,[{name,type:'file'}]);assert.equal(s.sources.directory,'available');
 }
});
test('partial force success retains valid index and reports directory failure; both failures keep lastGood',async()=>{
 let good=true;const g=createFundReportGateway({captureConnection,read:async()=>good?index([{name}]):{ok:false,status:500},readDirectory:async()=>ok({not:'a directory'})});
 const first=await g.load('report-index.json',{force:true});assert.equal(first.state,'available');assert.equal(first.sources.directory,'invalid');
 good=false;const fail=await g.load('report-index.json',{force:true});assert.equal(fail.data,first.data);assert.equal(fail.state,'failed');assert.equal(fail.lastSuccessAt,first.lastSuccessAt);
});
test('connection changes during directory discard late result and abort captured signal',async()=>{
 let revision=1,release,signal;const g=createFundReportGateway({captureConnection:()=>({ready:true,revision,readContext:revision}),read:async()=>({ok:false,status:404}),readDirectory:async o=>{signal=o.signal;return await new Promise(r=>release=r);}});
 const pending=g.load('report-index.json');while(!release)await new Promise(r=>setImmediate(r));revision=2;g.snapshot('report-index.json');assert.equal(signal.aborted,true);
 release(ok([{name,type:'file'}]));assert.equal((await pending).discarded,true);assert.equal(g.snapshot('report-index.json').data,null);
});
test('one deadline bounds directory and late result cannot overwrite retry',async()=>{
 let hang=false,release;const g=createFundReportGateway({captureConnection,timeoutMs:15,read:async()=>({ok:false,status:404}),readDirectory:async()=>hang?await new Promise(r=>release=r):ok([{name,type:'file'}])});
 const first=await g.load('report-index.json');hang=true;const fail=await g.load('report-index.json',{force:true});assert.equal(fail.error,'timeout');assert.equal(fail.data,first.data);
 hang=false;const retry=await g.load('report-index.json',{force:true});release(ok([{name:other,type:'file'}]));await new Promise(r=>setImmediate(r));assert.equal(g.snapshot('report-index.json').data,retry.data);
});
test('optional directory absence keeps original index errors and markdown never calls directory',async()=>{
 const g=createFundReportGateway({captureConnection,read:async()=>({ok:false,status:404})});assert.equal((await g.load('report-index.json')).state,'missing');
 let dirs=0;const h=createFundReportGateway({captureConnection,read:async()=>({ok:false,status:404}),readDirectory:async()=>{dirs++;return ok([]);}});
 await h.load(name,{force:true});assert.equal(dirs,0);
});

})().catch(error => { console.error(error); process.exitCode = 1; });
