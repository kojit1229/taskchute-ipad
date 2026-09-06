'use strict';
(async()=>{
const test=(await import("node:test")).default;
const assert=(await import("node:assert/strict")).default;
const {webcrypto}=await import("node:crypto");
const {createFeedbackCoordinator}=await import("../src/features/feedback/feedback-coordinator.js");
const {createFeedbackUiController:Fixed}=await import("../src/features/feedback/feedback-ui-controller.js");
const {createFeedbackEntry:FixedEntry}=await import("../src/features/feedback/feedback-entry.js");
const date='2026-09-06',hold=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
for(const heldHash of [1,2])test('fixed rejects second action before real SHA stage '+heldHash,{timeout:5000},async()=>{
 const firstHash=hold(),entered=hold(),complete=hold(),errors=[],files=new Map();let hashes=0,writes=0,prepares=0,c;
 const state={selectedDate:date,reports:{},journals:{[date]:'synthetic journal'},journalMeta:{[date]:{textUpdatedAt:'audit'}},archivedDates:[],settings:{morningEnergyLog:{}},sleep:{logs:{}},blocks:[],tasks:[],projects:[],recurrences:[]};
 const crypto={subtle:{digest:async(...args)=>{if(++hashes===heldHash){entered.resolve();await firstHash.promise;}return webcrypto.subtle.digest(...args);}}};
 const transport={connectionKey:()=>1,get:async key=>files.has(key)?{status:200,sha:'a'.repeat(40),bytes:files.get(key)}:{status:404},put:async(key,bytes)=>{writes++;files.set(key,bytes);return {status:201};}};
 const run=createFeedbackCoordinator({getState:()=>state,identity:()=>1,selectedDate:()=>date,today:()=>date,now:()=>date+'T12:00:00Z',crypto,
  localCommit:request=>({ok:true,...request}),serializePrimary:()=>JSON.stringify(state),proof:{state:async()=>({sha:'a'.repeat(40)}),report:async()=>({sha:'b'.repeat(40)})},queueTransport:transport,
  onPrepared:r=>{prepares++;c.prepared(r);},onProven:r=>c.proven(r)});
 const entry=FixedEntry({isComposing:()=>false,captureOwner:()=>({date}),isOwner:()=>true,requestLeave:()=>false,reflectInput(){},run,
  onResult:r=>{c.accepted(r);complete.resolve();},onError:e=>{errors.push(e.message);c.failed(e);if(e.message!=='feedback_busy'){entered.resolve();complete.resolve();}},onSettled:()=>c.settled()});
 c=Fixed({gateway:{key:()=>1,rememberProven(){}},startEntry:l=>entry(l),onUpdate(){}});c.selectDate(date);
 c.begin();await entered.promise;assert.equal(prepares,0);const second=c.begin();await Promise.resolve();await Promise.resolve();
 {assert.equal(second,false);assert.deepEqual(errors,[]);assert.equal(c.snapshot().status,'preparing');assert.equal(c.snapshot().busy,true);}
 firstHash.resolve();await complete.promise;await Promise.resolve();assert.equal(prepares,1);assert.equal(writes,2);assert.equal(c.snapshot().status,'accepted');assert.equal(c.snapshot().busy,false);
});





})().catch(error=>{console.error(error);process.exitCode=1;});
