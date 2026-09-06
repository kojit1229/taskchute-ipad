const assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
const load=n=>import(pathToFileURL(path.resolve(__dirname,'../src',n)).href);
(async()=>{
const {createKaradaTransport}=await load('sync/karada.js'),{createKaradaImport}=await load('core/karada-import.js'),health=await load('features/health.js');
const {validKaradaRequest,validKaradaResponse}=await load('core/karada-contract.js');
const date='2026-09-06',time=date+'T12:00:00Z',id='11111111-2222-3333-4444-555555555555',sha='a'.repeat(40),hash='b'.repeat(64);
const req={schema:1,requestId:id,requestedAt:time};
const response=(status='success',extra={})=>({schema:1,requestId:id,requestSha:sha,status,updatedAt:time,lastSuccessfulAt:time,dataThrough:date,healthSha256:hash,reason:null,...extra});
assert(validKaradaRequest(req));assert(!validKaradaRequest({...req,path:'x'}));assert(!validKaradaRequest({...req,requestedAt:'2026-02-30T00:00:00Z'}));assert(validKaradaResponse(response('no_data',{healthSha256:null,lastSuccessfulAt:null,dataThrough:null})));assert(!validKaradaResponse(response('success',{healthSha256:null})));
assert(!validKaradaRequest({...req,requestId:'AAAAAAAA-2222-3333-4444-555555555555'}));
for(const bad of [{lastSuccessfulAt:null},{dataThrough:null},{dataThrough:'2026-02-30'}]) assert(!validKaradaResponse(response('success',bad)));
assert(!validKaradaResponse(response('no_data',{dataThrough:null})));
let remoteReq,remoteRes,puts=0,fail=false;let conn={owner:'fixture',repo:'fixture',branch:'main',token:'synthetic'};
const packet=data=>({ok:true,status:200,json:async()=>({encoding:'base64',sha,content:Buffer.from(JSON.stringify(data)).toString('base64')})});
async function fake(url,opts){
assert(url.startsWith('https://api.github.com/repos/fixture/fixture/contents/'));
if(fail)return {ok:false,status:503};
if(opts.method==='PUT') {assert(url.includes('/taskchute/requests/karada-request.json?'));const body=JSON.parse(opts.body);puts++;
if(remoteReq&&body.sha!==sha)return {ok:false,status:409};remoteReq=JSON.parse(Buffer.from(body.content,'base64'));return {ok:true,status:201,json:async()=>({content:{sha}})};}
const data=url.includes('karada-request.json')?remoteReq:url.includes('karada-response.json')?remoteRes:undefined;
return data===undefined?{ok:false,status:404}:packet(data);
}
const make=()=>createKaradaTransport({connection:()=>conn,headers:()=>({}),fetch:fake,makeId:()=>id,now:()=>time});
const a=make(),b=make(),joined=await Promise.all([a.submit(),b.submit()]);assert(joined.every(r=>r.ok));assert.equal(puts,2);assert.equal(joined.filter(r=>r.joined).length,1);
await a.submit();assert.equal(puts,2);remoteRes=response('processing');await a.submit();assert.equal(puts,2);remoteRes=response();await a.submit();assert.equal(puts,3);
remoteReq={...req,requestedAt:'2026-09-06T12:01:00Z'};remoteRes=response('failed',{requestId:null,reason:'invalid_request'});const beforeInvalid=puts;assert((await a.submit()).ok);assert.equal(puts,beforeInvalid+1);
remoteReq={bad:true};remoteRes=response('failed',{requestId:null,reason:'invalid_request'});assert((await a.submit()).ok);
remoteReq={bad:true};remoteRes=response('failed',{requestId:null,reason:'invalid_request',requestSha:'f'.repeat(40)});assert(!(await a.submit()).ok);fail=true;assert(!(await a.submit()).ok);
const hung=()=>new Promise(()=>{});
for(const mode of ['GET','GET-body','PUT','PUT-body']) {
 const t=createKaradaTransport({connection:()=>conn,headers:()=>({}),timeoutMs:10,fetch:async(url,opts)=>{
   if(opts.method==='PUT') return mode==='PUT'?hung():{ok:true,json:hung};
   if(mode==='GET')return hung();if(mode==='GET-body')return {ok:true,json:hung};
   return {ok:false,status:404};
 }});
 const r=mode.startsWith('PUT')?await t.submit():await t.inspect();assert(!r.ok);if(mode.startsWith('PUT'))assert.equal(r.reason,'send_uncertain');
}
console.log('PASS validator / 2-client CAS / pending join / invalid SHA / fail closed');
let identity=1,raw=JSON.stringify({schema:1,days:[{date,steps:100}]}),reads=0,pending=[];
health.configureHealth({personalDataReady:()=>true,connectionIdentity:()=>identity,fetchHealthText:async()=>{reads++;return {ok:true,text:raw}},todayISO:()=>date});
assert(await health.hydrateHealthData(21600000));raw=JSON.stringify({schema:1,days:[{date,steps:200}]});assert.equal(await health.hydrateHealthData(21600000),false);assert.equal(reads,1);
const digest=s=>require('node:crypto').createHash('sha256').update(s).digest('hex');assert((await health.forceHealthData([digest(raw)])).ok);
for(const bad of ['{',JSON.stringify({schema:1,days:[]}),JSON.stringify({schema:1,days:[{date:'2026-02-30'}]})]){raw=bad;assert(!(await health.forceHealthData([digest(raw)])).ok);assert.equal(health.cachedHealthData().days[0].steps,200)}
raw=JSON.stringify({schema:1,days:[{date,steps:300}]});assert(!(await health.forceHealthData([hash])).ok);assert.equal(health.cachedHealthData().days[0].steps,200);
health.configureHealth({personalDataReady:()=>true,connectionIdentity:()=>identity,fetchHealthText:()=>new Promise(r=>pending.push(r)),todayISO:()=>date});
const first=health.forceHealthData(),second=health.forceHealthData();pending[1]({ok:true,text:raw});await second;pending[0]({ok:true,text:JSON.stringify({schema:1,days:[{date,steps:400}]})});assert.equal((await first).reason,'superseded');assert.equal(health.cachedHealthData().days[0].steps,300);
const old=health.forceHealthData();identity=2;assert.equal(health.cachedHealthData(),undefined);pending[2]({ok:true,text:raw});assert(!(await old).ok);
console.log('PASS TTL / hash mismatch / bad health preservation / reversed GET / connection race');
let res=response('processing'),forces=0,refreshes=0,submits=0,forceOk=true,meta,seen;
const transport={identity:()=>identity,inspect:async()=>({ok:true,request:req,requestSha:sha,response:res}),submit:async()=>{submits++;return {ok:true,request:req,requestSha:sha}},read:async()=>meta?{ok:true,data:meta}:{ok:true,missing:true}};
const c=createKaradaImport({transport,forceHealthData:async(h)=>{forces++;seen=h;return {ok:forceOk}},refresh:()=>refreshes++,now:()=>Date.UTC(2026,8,6,12,11)});
await Promise.all([c.submit(),c.submit()]);assert.equal(submits,1);assert.equal(c.snapshot().phase,'waiting');assert(c.snapshot().waited>=600000);
await c.restore();assert.equal(c.snapshot().phase,'processing');res=response('success',{requestId:'00000000-2222-3333-4444-555555555555'});await c.restore();assert.equal(forces,0);
res=response();await c.restore();assert.equal(c.snapshot().phase,'success');assert.equal(refreshes,1);
res=response('no_data',{healthSha256:null,lastSuccessfulAt:null,dataThrough:null});await c.restore();assert.equal(c.snapshot().phase,'no_data');assert.equal(forces,1);assert.equal(c.snapshot().lastSuccessfulAt,time);
res=response();forceOk=false;await c.restore();assert.equal(c.snapshot().phase,'update_failed');assert.equal(refreshes,1);
forceOk=true;meta=response('success',{updatedAt:'2026-09-06T12:01:00Z',healthSha256:'c'.repeat(64)});await c.restore();assert.deepEqual(seen,['c'.repeat(64)]);assert.equal(c.snapshot().phase,'success');
meta={...meta,updatedAt:res.updatedAt};await c.restore();assert.deepEqual(seen,['c'.repeat(64)]);
const reload=createKaradaImport({transport,forceHealthData:async()=>({ok:true})});await reload.restore();assert.equal(reload.snapshot().phase,'success');res=response('failed');await c.restore();assert.equal(c.snapshot().phase,'failed');const failedReload=createKaradaImport({transport,forceHealthData:async()=>({ok:true})});await failedReload.restore();assert.equal(failedReload.snapshot().phase,'failed');assert.equal(failedReload.snapshot().lastSuccessfulAt,time);
identity++;assert.equal(c.snapshot().phase,'idle');assert.equal(c.snapshot().lastSuccessfulAt,undefined);
console.log('PASS controller spam / reload / late response / no_data / refresh retry / newer daily hash');
})().catch(e=>{console.error(e);process.exitCode=1});
