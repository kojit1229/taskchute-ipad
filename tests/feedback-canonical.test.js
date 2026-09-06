// Portable author guarantees: imports installed runtime; synthetic HTTP only.
const path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'..');
const load=name=>import(pathToFileURL(path.join(ROOT,'src/features/feedback',name+'.js')).href);
(async()=>{
const {test}=require('node:test'),assert=require('node:assert/strict');


const {createFeedbackCanonicalReader}=await load('feedback-canonical-reader');
const {createFeedbackHttp}=await load('feedback-http');
const date='2026-09-06',other='2026-09-05',name=d=>`AIフィードバック_${d}.md`;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function fixture(){
 let cfg={owner:'A',repo:'synthetic',branch:'main',token:'synthetic-only',path:'taskchute/app-state.json'};
 const calls=[],timers=new Map();let id=0;
 const packet=text=>({status:200,headers:{get:()=>null},text:async()=>JSON.stringify({encoding:'base64',sha:'a'.repeat(40),content:Buffer.from(text).toString('base64')})});
 let handler=async(path)=>path==='taskchute'?{status:200,text:async()=>JSON.stringify([])}:path.endsWith('report-index.json')?packet(JSON.stringify({generatedAt:new Date().toISOString(),files:[{name:name(date)}]})):packet(cfg.owner+' old body');
 const http=createFeedbackHttp({connection:()=>cfg,headers:()=>({}),fetch:async(url,init)=>{const path=decodeURIComponent(url.split('/contents/')[1].split('?')[0]);calls.push({path,method:init.method,url,signal:init.signal});return handler(path,init);},setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:id=>timers.delete(id)});
 const reader=createFeedbackCanonicalReader({http});
 return {http,reader,calls,timers,packet,setHandler:fn=>handler=fn,switchTo(owner,path='taskchute/app-state.json'){cfg={...cfg,owner,path};http.invalidate();reader.invalidate();}};
}
test('actual HTTP index/directory authorize exact observed body only; shared body dedup',async()=>{
 const f=fixture();assert.equal(f.reader.body(other),null);await f.reader.refresh(date);
 assert.equal(f.reader.body(date),'A old body');assert.equal(f.reader.body(date),'A old body');assert.equal(f.reader.body(other),null);
 assert.deepEqual(f.calls.map(x=>x.method),['GET','GET','GET']);assert.equal(f.calls.filter(x=>x.path===`taskchute/${name(date)}`).length,1);assert.equal(f.timers.size,0);
});
test('directory fallback excludes invalid dates, traversal, nonfile and wrong full path',async()=>{
 const f=fixture();f.setHandler(async p=>p.endsWith('report-index.json')?{status:404}:p==='taskchute'?{status:200,text:async()=>JSON.stringify([
 {name:name(other),type:'file',path:'taskchute/'+name(other)},
 ...[name('2026-02-30'),'../'+name(date),name(date)].map(n=>({name:n,type:'dir',path:'taskchute/'+n})),
 {name:name(date),type:'file',path:'elsewhere/'+name(date)}])}:f.packet('directory old body'));
 await f.reader.refresh(other);assert.deepEqual(f.reader.files(),[{name:name(other),date:other}]);assert.equal(f.reader.body(other),'directory old body');assert.equal(f.reader.body(date),null);
});
test('same connection failure retains verified body and metadata, empty body is valid',async()=>{
 const f=fixture();await f.reader.refresh(date);f.setHandler(async()=>{throw Error('offline');});await f.reader.refresh(date);
 assert.equal(f.reader.body(date),'A old body');assert.equal(f.reader.status(date).failed,true);
 f.setHandler(async p=>p==='taskchute'?{status:200,text:async()=>JSON.stringify([])}:f.packet(p.endsWith('json')?JSON.stringify({generatedAt:new Date().toISOString(),files:[name(date)]}):''));await f.reader.refresh(date);assert.equal(f.reader.body(date),'');assert.equal(f.reader.status(date).hasBody,true);
});
test('connection/path changes clear all body visibility immediately; ABA delayed body rejected',async()=>{
 const f=fixture();await f.reader.refresh(date);const entered=deferred(),body=deferred();
 f.setHandler(async p=>p==='taskchute'?{status:200,text:async()=>JSON.stringify([])}:p.endsWith('json')?f.packet(JSON.stringify({generatedAt:new Date().toISOString(),files:[name(date)]})):{status:200,text:()=>{entered.resolve();return body.promise;}});
 const old=f.reader.refresh(date);await entered.promise;f.switchTo('B');assert.equal(f.reader.body(date),null);f.switchTo('A','taskchute/other-state.json');assert.equal(f.reader.body(date),null);
 f.setHandler(async p=>p==='taskchute'?{status:200,text:async()=>JSON.stringify([])}:f.packet(p.endsWith('json')?JSON.stringify({generatedAt:new Date().toISOString(),files:[name(date)]}):'new A body'));
 body.resolve(await f.packet('obsolete A body').text());await old;await f.reader.refresh(date);assert.equal(f.reader.body(date),'new A body');assert.equal(f.timers.size,0);
});
test('all canonical PUT and untrusted direct paths fail before fetch',async()=>{
 const f=fixture();for(const resource of [{kind:'canonical-index'},{kind:'canonical-directory'},{kind:'canonical-file',name:name(date)}])await assert.rejects(f.http.put(resource,new Uint8Array(),{expectedSha:null}),/canonical_read_only/);
 for(const bad of ['taskchute',`taskchute/${name(date)}`,...['2026-02-30','0000-01-01','2026-09-06/..'].map(d=>({kind:'canonical-file',name:name(d)}))])await assert.rejects(f.http.get(bad),/http_path_rejected/);
 assert.equal(f.calls.length,0);
});
test('actual body timeout rejects, clears owned timer and ignores late resolution',async()=>{
 const f=fixture(),entered=deferred(),body=deferred();f.setHandler(async()=>({status:200,text:()=>{entered.resolve();return body.promise;}}));
 const read=f.http.get({kind:'canonical-file',name:name(date)});await entered.promise;[...f.timers.values()][0]();await assert.rejects(read,/http_aborted/);assert.equal(f.timers.size,0);body.resolve(await f.packet('late').text());
});
test('two dates share reader but never mix body selection',async()=>{
 const f=fixture();f.setHandler(async p=>p==='taskchute'?{status:200,text:async()=>JSON.stringify([])}:f.packet(p.endsWith('json')?JSON.stringify({generatedAt:new Date().toISOString(),files:[name(date),name(other)]}):p));
 await f.reader.refresh(date);await f.reader.refresh(other);assert.equal(f.reader.body(date),'taskchute/'+name(date));assert.equal(f.reader.body(other),'taskchute/'+name(other));
});
test('invalid, empty and stale index plus directory failure retain same-connection lastGood',async()=>{
 const f=fixture();await f.reader.refresh(date);
 for(const data of [{files:[name(other)]},{generatedAt:'invalid',files:[name(other)]},{generatedAt:'2026-09-07T00:00:00',files:[name(other)]},{generatedAt:'2026-02-30T00:00:00Z',files:[name(other)]},{generatedAt:new Date().toISOString(),files:[]},{generatedAt:new Date().toISOString(),files:[{name:'not-a-report'}]},{generatedAt:'2000-01-01T00:00:00Z',files:[name(other)]}]){
 f.setHandler(async p=>p==='taskchute'?{status:500}:p.endsWith('json')?f.packet(JSON.stringify(data)):{status:500});await f.reader.refresh(date);
 assert.equal(f.reader.body(date),'A old body');assert.equal(f.reader.body(other),null);assert.equal(f.reader.status(date).failed,true);
 }
});
test('48-hour inclusive boundary and stale directory fallback',async()=>{
 const now=Date.parse('2026-09-07T00:00:00Z');let stamp=now-48*3600000;
 const reader=createFeedbackCanonicalReader({now:()=>now,http:{connectionKey:()=> 'fixed',get:async r=>r.kind==='canonical-index'?{status:200,text:JSON.stringify({generatedAt:new Date(stamp).toISOString(),files:[name(date)]})}:r.kind==='canonical-directory'?{status:200,entries:[{name:name(other),type:'file',path:'taskchute/'+name(other)}]}:{status:200,text:r.name}}});
 await reader.refresh(date);assert.equal(reader.body(date),name(date));stamp--;reader.invalidate();await reader.refresh(other);assert.equal(reader.body(date),null);assert.equal(reader.body(other),name(other));assert.equal(reader.status(other).failed,true);
});

})().catch(error=>{console.error(error);process.exitCode=1;});
