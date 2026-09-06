'use strict';
(async()=>{
const test=(await import("node:test")).default;
const assert=(await import("node:assert/strict")).default;
const fs=(await import("node:fs")).default;
const path=(await import("node:path")).default;
const vm=(await import("node:vm")).default;
const {createRequire}=await import("node:module");
const {fileURLToPath}=await import("node:url");
const {pathToFileURL}=await import("node:url");
const {createFeedbackHttp}=await import("../src/features/feedback/feedback-http.js");
const {createFeedbackEntry}=await import("../src/features/feedback/feedback-entry.js");
const {boundProtectedSync}=await import("../src/features/feedback/feedback-entry.js");
const here=__dirname;
const {getFunction}=require('./support/prepare.cjs');
const {transformApp}=require('./support/ui-transform.cjs');
const {transformStorage}=require('./support/app-connection-transform.cjs');
const safe=path.resolve(here,'..');
const app=fs.readFileSync(path.join(safe,'app.js'),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
const timers=()=>{const active=new Map();let id=0;return {active,setTimer:fn=>{active.set(++id,fn);return id;},clearTimer:id=>active.delete(id),fire:()=>[...active.values()].forEach(fn=>fn())};};
const response=(text='synthetic 😀')=>({status:200,headers:{get:()=>null},text:async()=>JSON.stringify({encoding:'base64',content:btoa(unescape(encodeURIComponent(text))),sha:'a'.repeat(40)})});
function http(fetch){const time=timers();let cfg={owner:'synthetic-owner',repo:'synthetic-repo',branch:'fixture branch',token:'SYNTHETIC_SECRET',path:'taskchute/custom-state.json'};
 const h=createFeedbackHttp({connection:()=>cfg,headers:token=>({Authorization:'Bearer '+token}),fetch,...time});return {h,time,cycle:()=>{const old=cfg;cfg={...cfg,repo:'other'};h.invalidate();cfg=old;h.invalidate();}};}
test('HTTP binds actual configured path/branch/token, decodes contents, and does not expose credentials',async()=>{
 const f=http(async(url,opts)=>{assert.match(url,/custom-state\.json\?ref=fixture%20branch$/);assert.equal(opts.headers.Authorization,'Bearer SYNTHETIC_SECRET');return response();});
 const result=await f.h.get({kind:'primary-state'});assert.equal(result.text,'synthetic 😀');assert(!JSON.stringify(result).includes('SECRET'));assert.equal(f.time.active.size,0);
});
test('conditional report PUT only: missing SHA, primary write, and traversal all stop before fetch',async()=>{
 let calls=0;const f=http(async()=>{calls++;return {status:201};});
 await assert.rejects(f.h.putReport({kind:'report',date:'2026-09-06'},'synthetic',{}),/conditional_sha/);
 await assert.rejects(f.h.put({kind:'primary-state'},new Uint8Array(),{expectedSha:null}),/primary_write/);
 await assert.rejects(f.h.get('../secrets'),/path_rejected/);assert.equal(calls,0);
 await assert.rejects(f.h.put('taskchute/requests/feedback-regeneration/results/feedback-2026-09-06-'+'a'.repeat(64)+'/1.json',new Uint8Array(),{expectedSha:null}),/result_write_forbidden/);assert.equal(calls,0);
 await f.h.putReport({kind:'report',date:'2026-09-06'},'synthetic',{expectedSha:null});assert.equal(calls,1);
});
test('404 is distinct from errors and malformed contents',async()=>{
 assert.deepEqual(await http(async()=>({status:404})).h.get({kind:'primary-state'}),{status:404});
 for(const status of [401,403,429,500,304])await assert.rejects(http(async()=>({status})).h.get({kind:'primary-state'}),/read_failed/);
 await assert.rejects(http(async()=>({status:200,text:async()=>'{}'})).h.get({kind:'primary-state'}),/invalid_content/);
});
test('fetch and response-body deadlines abort, settle, and clear owned timers',async()=>{
 for(const body of [false,true]){let signal;const entered=deferred();const f=http(async(url,options)=>{signal=options.signal;entered.resolve();return body?{status:200,text:()=>new Promise(()=>{})}:new Promise(()=>{});});
  const p=f.h.get({kind:'primary-state'});await entered.promise;f.time.fire();await assert.rejects(p,/aborted/);assert.equal(signal.aborted,true);assert.equal(f.time.active.size,0);
 }
});
test('unobserved ABA cancels old body without adopting it',async()=>{
 const body=deferred(),entered=deferred();const f=http(async()=>({status:200,text:()=>{entered.resolve();return body.promise;}}));
 const p=f.h.get({kind:'primary-state'});await entered.promise;f.cycle();await assert.rejects(p,/aborted/);body.resolve(await response().text());assert.equal(f.time.active.size,0);
});
test('protected sync deadline invalidates late continuation and settles without success stub',async()=>{
 const time=timers(),gate=deferred(),entered=deferred();let writes=0,signal;
 const run=boundProtectedSync(async proof=>{signal=proof.signal;entered.resolve();await gate.promise;if(proof.isCurrent())writes++;return {ok:true};},time);
 const p=run({isCurrent:()=>true,expectedContent:'synthetic'});await entered.promise;time.fire();await assert.rejects(p,/timeout/);gate.resolve();await Promise.resolve();assert.equal(writes,0);assert.equal(signal.aborted,true);assert.equal(time.active.size,0);
});
test('actual transformed sync stops after late head GET when deadline expired, preserving in-flight ownership',async()=>{
 const {transformSync}=require('./support/sync-proof-transform.cjs');
 const sync=getFunction(fs.readFileSync(path.join(safe,'src/sync/github.js'),'utf8'),'saveToGitHub');
 const time=timers(),head=deferred(),entered=deferred();let writes=0;
 const c={_githubSaveInFlight:false,autoSaveTimer:null,archiveConnectionKey:()=> 'fixture',capturePrimarySyncState:()=>({}),clearTimeout(){},
  requireGitHubConfig:()=>({}),fetchGitHubFileSHA:()=>{entered.resolve();return head.promise;},fetch:()=>writes++,showToast(){},updateAutoSaveStatus(){}};
 vm.createContext(c);vm.runInContext(sync,c);
 const run=boundProtectedSync(proof=>c.saveToGitHub(true,proof),time);
 const p=run({expectedContent:'synthetic',isCurrent:()=>true});await entered.promise;time.fire();await assert.rejects(p,/timeout/);
 assert.equal(c._githubSaveInFlight,true);head.resolve('a'.repeat(40));await Promise.resolve();await Promise.resolve();
 assert.equal(writes,0);assert.equal(c._githubSaveInFlight,false);assert.equal(time.active.size,0);
});
test('entry blocks IME and stale owners, and a repeated guard continuation starts only once',async()=>{
 let composing=true,current=true,leave,runs=0,reflections=0;const errors=[];
 const start=createFeedbackEntry({isComposing:()=>composing,captureOwner:()=>({date:'2026-09-06'}),isOwner:()=>current,
  requestLeave:fn=>{leave=fn;return true;},reflectInput:()=>reflections++,run:async(date,owner)=>{assert.equal(owner(),true);runs++;},onResult(){},onError:e=>errors.push(e.message)});
 assert.equal(start(),false);assert.equal(errors[0],'finish_composition_first');composing=false;start();current=false;leave();assert.equal(runs,0);
 current=true;start();leave();leave();await Promise.resolve();assert.equal(runs,1);assert.equal(reflections,1);
});
test('actual requestDraftLeave and actual guard retain save failure/stay/replaced modal owner',async()=>{
 const {createDraftLeaveGuard}=await import(pathToFileURL(path.join(safe,'src/features/draft-leave.js')).href);
 for(const mode of ['saved','failed','stay','replaced']){
  let session={isConnected:true},runs=0,reflections=0;
  const document={addEventListener(){},activeElement:null,body:{append(){}},createElement:()=>({setAttribute(){},remove(){},showModal(){}})};
  const guard=createDraftLeaveGuard(document),state={modal:{type:'block',id:'fixture'},currentView:'journal'};
  const c={state,draftLeaveGuard:guard,modalDraftSnapshot:()=> 'dirty',modalDraftBaseline:'clean',
   modalRoot:{get firstElementChild(){return session;},classList:{contains:()=>true}},submitModal:()=>mode==='saved',ztEditId:null,ztCurrent:null};
  vm.createContext(c);vm.runInContext(getFunction(app,'requestDraftLeave'),c);
  const start=createFeedbackEntry({isComposing:()=>false,captureOwner:()=>({date:'2026-09-06'}),isOwner:()=>true,
   requestLeave:c.requestDraftLeave,reflectInput:()=>reflections++,run:async()=>runs++,onResult(){},onError(){}});
  start();if(mode==='replaced')session={isConnected:true};guard.resolve(mode==='stay'?'stay':'save');await Promise.resolve();
  assert.equal(runs,mode==='saved'?1:0);assert.equal(reflections,mode==='saved'?1:0);
 }
});
test('actual wiring owns journal DOM, reflects current draft, uses actual sanitizer and preserves four invalidations',()=>{
 const out=app,acorn=require('acorn');acorn.parse(out,{ecmaVersion:'latest',sourceType:'module'});
 assert.equal(out.match(/invalidateFeedbackConnection\(\);/g).length,4);assert.throws(()=>transformApp(out),/already integrated/);
 const element={isConnected:true,value:'synthetic current draft'},state={selectedDate:'2026-09-06',currentView:'journal',journals:{'2026-09-06':'old'},journalMeta:{},settings:{github:{token:'SYNTHETIC_SECRET'}}};
 const c={state,_imeComposing:false,document:{querySelector:()=>element},isArchivedDate:()=>false,draftSaveTransaction:{active:false},draftLeaveGuard:{active:false},nowDateTime:()=> 'fixture stamp',ensureJournal(){},structuredClone};
 vm.createContext(c);vm.runInContext(['feedbackInputOwner','ownsFeedbackInput','reflectFeedbackInput'].map(n=>getFunction(out,n)).join('\n')+'\n'+getFunction(app,'sanitizedStateForGitHub'),c);
 const owner=c.feedbackInputOwner();c.reflectFeedbackInput(owner);assert.equal(state.journals[owner.date],element.value);assert.equal(state.journalMeta[owner.date].textUpdatedAt,'fixture stamp');
 assert.equal(c.sanitizedStateForGitHub().settings.github.token,'');assert.equal(state.settings.github.token,'SYNTHETIC_SECRET');
 c._imeComposing=true;assert.equal(c.ownsFeedbackInput(owner),false);assert.throws(()=>c.reflectFeedbackInput(owner));
 c._imeComposing=false;c.document.querySelector=()=>({...element});assert.equal(c.ownsFeedbackInput(owner),false);
 const storage=fs.readFileSync(path.join(safe,'src/storage/local.js'),'utf8');acorn.parse(storage,{ecmaVersion:'latest',sourceType:'module'});
 assert.throws(()=>transformStorage(transformStorage(storage)),/already integrated/);
});

})().catch(error=>{console.error(error);process.exitCode=1;});
