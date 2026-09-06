'use strict';
(async()=>{
const test=(await import("node:test")).default;
const assert=(await import("node:assert/strict")).default;
const fs=(await import("node:fs")).default;
const vm=(await import("node:vm")).default;
const {createRequire}=await import("node:module");
const {createFeedbackUiController}=await import("../src/features/feedback/feedback-ui-controller.js");
const {createFeedbackEntry}=await import("../src/features/feedback/feedback-entry.js");
const safe=require('node:path').resolve(__dirname,'..');
const {getFunction}=require('./support/prepare.cjs');
const {createDraftLeaveGuard}=await import(require('node:url').pathToFileURL(require('node:path').join(safe,'src/features/draft-leave.js')).href);
const date='2026-09-06',app=fs.readFileSync(safe+'/app.js','utf8');
const hold=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};};
function fixture({hashWait=false}={}){
 const read=hold(),hash=hold(),hashEntered=hold(),operation=hold(),done=hold();let key=1,calls=0,reads=0,c;
 const doc={addEventListener(){},activeElement:null,body:{append(){}},createElement:()=>({setAttribute(){},remove(){},showModal(){}})};
 const guard=createDraftLeaveGuard(doc),session={isConnected:true};
 const box={state:{modal:{type:'block',id:'synthetic'},currentView:'journal'},draftLeaveGuard:guard,modalDraftSnapshot:()=> 'dirty',modalDraftBaseline:'clean',modalRoot:{firstElementChild:session,classList:{contains:()=>true}},submitModal:()=>true,ztEditId:null,ztCurrent:null};
 vm.createContext(box);vm.runInContext(getFunction(app,'requestDraftLeave'),box);
 const entry=createFeedbackEntry({isComposing:()=>false,captureOwner:()=>({date}),isOwner:()=>true,requestLeave:box.requestDraftLeave,reflectInput(){},
  run:async(d,current)=>{calls++;await operation.promise;if(!current())throw Error('old operation');return {request:{date,requestId:'fixture',inputHash:'a'.repeat(64)}};},
  onResult:r=>c.accepted(r),onError:e=>c.failed(e),onSettled:()=>c.settled()});
 c=createFeedbackUiController({gateway:{key:()=>key,history:()=>{reads++;return read.promise;}},currentHash:()=>{hashEntered.resolve();return hashWait?hash.promise:null;},
  startEntry:l=>entry({...l,onSettled:()=>{l.onSettled();done.resolve();}}),onUpdate(){}});c.selectDate(date);
 return {c,guard,read,hash,hashEntered,operation,done,counts:()=>({calls,reads}),cycle:()=>{key++;c.invalidate();key++;c.invalidate();}};
}
for(const method of ['refresh','tick'])test('actual guard continues after successful '+method+' while confirmation waits',async()=>{
 const f=fixture();f.c.begin();assert.equal(f.guard.active,true);const p=method==='tick'?f.c.tick(true):f.c.refresh();f.read.resolve([]);await p;
 assert.equal(f.c.snapshot().status,'ready');f.guard.resolve('save');assert.equal(f.counts().calls,1);assert.equal(f.c.snapshot().busy,true);
 f.operation.resolve();await f.done.promise;assert.equal(f.c.snapshot().status,'accepted');assert.equal(f.c.snapshot().busy,false);
});
for(const order of ['read-first','operation-first'])test('actual guard start owns busy against older delayed read '+order,async()=>{
 const f=fixture();f.c.begin();const p=f.c.refresh();f.guard.resolve('save');assert.equal(f.counts().calls,1);assert.equal(f.c.snapshot().busy,true);
 if(order==='operation-first'){f.operation.resolve();await f.done.promise;assert.equal(f.c.snapshot().status,'accepted');}
 f.read.resolve([{status:'queued',entry:{requestId:'old-history',attempt:1}}]);await p;
 assert.deepEqual(f.c.snapshot().rows,[]);assert.equal(f.c.snapshot().lastGoodAt,null);
 assert.equal(f.c.snapshot().busy,order==='read-first');assert.equal(f.c.snapshot().status,order==='read-first'?'preparing':'accepted');
 if(order==='read-first'){f.operation.resolve();await f.done.promise;}assert.equal(f.c.snapshot().status,'accepted');
});
test('actual guard start invalidates a read already awaiting current input hash',async()=>{
 const f=fixture({hashWait:true});f.c.begin();const p=f.c.refresh();f.read.resolve([]);await f.hashEntered.promise;
 f.guard.resolve('save');assert.equal(f.counts().calls,1);f.hash.resolve('b'.repeat(64));await p;
 assert.equal(f.c.snapshot().busy,true);assert.equal(f.c.snapshot().currentHash,null);assert.equal(f.c.snapshot().status,'preparing');
 f.operation.resolve();await f.done.promise;assert.equal(f.c.snapshot().status,'accepted');
});
for(const change of ['date-ABA','connection-ABA'])test('actual guard and delayed read both reject '+change,async()=>{
 const f=fixture();f.c.begin();const p=f.c.refresh();if(change==='date-ABA'){f.c.selectDate('2026-09-05');f.c.selectDate(date);}else f.cycle();
 f.guard.resolve('save');assert.equal(f.counts().calls,0);f.read.resolve([{status:'queued',entry:{requestId:'old-history',attempt:1}}]);await p;
 assert.deepEqual(f.c.snapshot().rows,[]);assert.equal(f.c.snapshot().lastGoodAt,null);assert.equal(f.c.snapshot().busy,false);assert.equal(f.c.snapshot().status,'idle');
});

})().catch(error=>{console.error(error);process.exitCode=1;});
