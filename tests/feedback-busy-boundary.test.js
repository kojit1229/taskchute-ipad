'use strict';
(async()=>{
const test=(await import("node:test")).default;
const assert=(await import("node:assert/strict")).default;
const fs=(await import("node:fs")).default;
const vm=(await import("node:vm")).default;
const {createRequire}=await import("node:module");
const {createFeedbackUiController}=await import("../src/features/feedback/feedback-ui-controller.js");
const {createFeedbackEntry}=await import("../src/features/feedback/feedback-entry.js");
const {createFeedbackUiView}=await import("../src/features/feedback/feedback-ui-view.js");
const safe=require('node:path').resolve(__dirname,'..');
const {getFunction}=require('./support/prepare.cjs');
const {createDraftLeaveGuard}=await import(require('node:url').pathToFileURL(require('node:path').join(safe,'src/features/draft-leave.js')).href);
const app=fs.readFileSync(safe+'/app.js','utf8'),date='2026-09-06';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function fixture({dirty=false}={}) {
 let composing=false,owner=true,save=true,mode='',calls=0,reflections=0,key=1,session={isConnected:true},controller;
 const gate=deferred(),done=deferred(),errors=[];
 const document={addEventListener(){},activeElement:null,body:{append(){}},createElement:()=>({setAttribute(){},remove(){},showModal(){}})};
 const guard=createDraftLeaveGuard(document),state={modal:{type:'block',id:'fixture'},currentView:'journal'};
 const c={state,draftLeaveGuard:guard,modalDraftSnapshot:()=>dirty?'dirty':'clean',modalDraftBaseline:'clean',modalRoot:{get firstElementChild(){return session;},classList:{contains:()=>true}},submitModal:()=>save,ztEditId:null,ztCurrent:null};
 vm.createContext(c);vm.runInContext(getFunction(app,'requestDraftLeave'),c);
 const entry=createFeedbackEntry({isComposing:()=>composing,captureOwner:()=>{if(mode==='capture')throw Error(mode);return {date};},isOwner:()=>owner,
  requestLeave:(...args)=>{if(mode==='guard')throw Error(mode);return c.requestDraftLeave(...args);},reflectInput:()=>{if(mode==='reflect')throw Error(mode);reflections++;},
  run:(d,current)=>{calls++;if(mode==='run')throw Error(mode);return gate.promise.then(()=>{if(!current())throw Error('stale');return {request:{date,requestId:'fixture',inputHash:'a'.repeat(64)}};});},
  onResult:r=>controller.accepted(r),onError:e=>{errors.push(e.message);controller.failed(e);},onSettled:()=>controller.settled()});
 controller=createFeedbackUiController({gateway:{key:()=>key,history:async()=>[]},startEntry:lifecycle=>entry({...lifecycle,onSettled:()=>{lifecycle.onSettled();done.resolve();}}),onUpdate(){}});controller.selectDate(date);
 return {controller,guard,gate,done,errors,counts:()=>({calls,reflections}),compose:v=>composing=v,owner:v=>owner=v,save:v=>save=v,mode:v=>mode=v,
  replace:()=>session={isConnected:true},cycle:()=>{key++;controller.invalidate();key++;controller.invalidate();}};
}
test('two clicks before prepared: real entry starts once and stays preparing until completion',async()=>{
 const f=fixture();assert.equal(f.controller.begin(),true);assert.equal(f.controller.snapshot().busy,true);assert.equal(f.controller.begin(),false);
 assert.equal(f.counts().calls,1);assert.equal(f.controller.snapshot().status,'preparing');assert.deepEqual(f.errors,[]);
 f.gate.resolve();await f.done.promise;assert.equal(f.controller.snapshot().busy,false);assert.equal(f.controller.snapshot().status,'accepted');
});
for(const kind of ['stay','save-failure','owner-replaced'])test('real guard '+kind+' releases preparation and allows retry',async()=>{
 const f=fixture({dirty:true});f.controller.begin();assert.equal(f.guard.active,true);assert.equal(f.controller.snapshot().busy,false);
 if(kind==='save-failure')f.save(false);if(kind==='owner-replaced')f.replace();f.guard.resolve(kind==='stay'?'stay':'save');
 assert.equal(f.guard.active,false);assert.equal(f.counts().calls,0);assert.equal(f.controller.snapshot().busy,false);
 f.save(true);f.controller.begin();f.guard.resolve('save');assert.equal(f.counts().calls,1);assert.equal(f.controller.snapshot().busy,true);
 f.gate.resolve();await f.done.promise;assert.equal(f.controller.snapshot().status,'accepted');
});
test('second action while actual guard open does not replace original continuation or run twice',async()=>{
 const f=fixture({dirty:true});f.controller.begin();f.controller.begin();assert.equal(f.counts().calls,0);f.guard.resolve('save');assert.equal(f.counts().calls,1);
 f.gate.resolve();await f.done.promise;assert.equal(f.controller.snapshot().status,'accepted');
});
for(const mode of ['capture','guard','reflect','run'])test('synchronous '+mode+' exception releases busy for retry',async()=>{
 const f=fixture();f.mode(mode);f.controller.begin();assert.equal(f.controller.snapshot().busy,false);assert(f.errors.includes(mode));
 f.mode('');f.controller.begin();assert.equal(f.controller.snapshot().busy,true);f.gate.resolve();await Promise.resolve();await Promise.resolve();assert.equal(f.controller.snapshot().busy,false);
});
test('IME refusal and owner loss before continuation never save and allow fresh attempt',async()=>{
 const f=fixture({dirty:true});f.compose(true);assert.equal(f.controller.begin(),false);assert.equal(f.controller.snapshot().busy,false);assert.equal(f.counts().calls,0);
 f.compose(false);f.controller.begin();f.owner(false);f.guard.resolve('save');assert.equal(f.counts().calls,0);assert.equal(f.controller.snapshot().busy,false);
 f.owner(true);f.controller.begin();f.guard.resolve('save');assert.equal(f.counts().calls,1);f.gate.resolve();await f.done.promise;
});
for(const type of ['date','ABA','owner'])test('in-flight '+type+' does not adopt old success or lock new state',async()=>{
 const f=fixture();f.controller.begin();if(type==='date')f.controller.selectDate('2026-09-05');if(type==='ABA')f.cycle();if(type==='owner')f.owner(false);
 f.gate.resolve();await f.done.promise;assert.equal(f.controller.snapshot().busy,false);assert.notEqual(f.controller.snapshot().status,'accepted');assert.equal(f.controller.snapshot().pending,null);
});
for(const type of ['date','ABA'])test('guard awaiting '+type+' cannot start old operation',()=>{
 const f=fixture({dirty:true});f.controller.begin();if(type==='date')f.controller.selectDate('2026-09-05');else f.cycle();f.guard.resolve('save');assert.equal(f.counts().calls,0);assert.equal(f.controller.snapshot().busy,false);
});
function assertClosedInputDetails(html, entries) {
 assert.equal((html.match(/<summary>入力版の詳細<\/summary>/g)||[]).length,entries.length);
 for(const entry of entries) assert(html.includes('<details data-feedback-detail-key="input:'+entry.requestId+'/'+entry.attempt+'"><summary>入力版の詳細</summary><p>'+entry.inputHash+'</p></details>'));
 assert.doesNotMatch(html,/<details\b[^>]*\sopen(?:[\s=>])/i);
}
test('wording explains feedback-only action and full hash is inside closed detail',()=>{
 const hash='a'.repeat(64),view=createFeedbackUiView({escapeHTML:s=>String(s),renderMarkdown:s=>s});
 const html=view({date,busy:false,rows:[{status:'queued',entry:{requestId:'fixture',date,attempt:1,inputHash:hash},request:{requestedAt:'2026-09-06T00:00:00Z'}}],versions:[],selected:'original',status:'idle',lastGoodAt:null,now:0},'old');
 assert(html.includes('フィードバックだけを作り直します。ジャーナルに書いた依頼は再実行しません。'));
 assertClosedInputDetails(html,[{requestId:'fixture',attempt:1,inputHash:hash}]);assert(!html.includes('<details open'));
});

test('same input retries retain separate request and attempt detail keys',()=>{
 const hash='a'.repeat(64),view=createFeedbackUiView({escapeHTML:s=>String(s),renderMarkdown:s=>s});
 const entries=[{requestId:'fixture',attempt:1},{requestId:'fixture',attempt:2},{requestId:'fixture-other',attempt:1}].map(entry=>({...entry,date,inputHash:hash}));
 const html=view({date,busy:false,rows:entries.map(entry=>({status:'queued',entry,request:{requestedAt:'2026-09-06T00:00:00Z'}})),versions:[],selected:'original',status:'idle',lastGoodAt:null,now:0},'old');
 assertClosedInputDetails(html,entries);
});

})().catch(error=>{console.error(error);process.exitCode=1;});
