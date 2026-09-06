// FUND regression: complete assertions remain visible to the test manifest.
'use strict';
(async () => {
const test = (await import('node:test')).default;const assert = (await import('node:assert/strict')).default;const {createFundDOMBridge} = await import('../src/features/fund/dom-bridge.js');
const tick=()=>new Promise(r=>setImmediate(r));
function setup(){const state={currentView:'journal',selectedDate:'2026-09-01',modal:null},scroll={scrollTop:71},actions={},events={},select={tagName:'SELECT',dataset:{},value:'2026-09-01',matches:()=>true};let mounted=false,blocked=false,continuation;
const host={writes:[],contains:e=>e===select,querySelectorAll:()=>[],set innerHTML(v){this.writes.push(v)}};globalThis.document={activeElement:{dataset:{}},getElementById:()=>scroll};
const root={querySelector:()=>mounted?host:null,querySelectorAll:()=>[],addEventListener:(k,v)=>events[k]=v};
const bridge=createFundDOMBridge({root,getState:()=>state,registerActions:a=>Object.assign(actions,a),requestDraftLeave:fn=>{if(blocked){continuation=fn;return true;}return false},setView:v=>state.currentView=v,render(){},markRead(){},connection:()=>({ready:false}),fetchImpl:()=>{throw Error('unexpected network')},headers:()=>({}),escapeHTML:String,renderHeader:()=>'',renderMarkdown:String});
return {bridge,state,scroll,actions,events,host,select,mount(){mounted=true;bridge.renderReport()},block(){blocked=true},resume(){blocked=false;continuation()}};
}
test('first report render records current epoch so same-epoch async reply preserves active SELECT',async()=>{const x=setup();x.bridge.open('fable','journal','2026-09-01');x.mount();document.activeElement=x.select;await tick();assert.equal(x.host.writes.length,0,'first unchanged-connection response must defer while SELECT is active');x.bridge.controller.dispose()});
test('connection epoch change clears report even with SELECT focused after initial patch',async()=>{const x=setup();x.bridge.open('fable','journal','2026-09-01');x.mount();await tick();const before=x.host.writes.length;document.activeElement=x.select;x.bridge.invalidateConnection();assert(x.host.writes.length>before);assert.match(x.host.writes.at(-1),/接続設定が必要/);x.bridge.controller.dispose()});
test('blocked date change restores visible prior date before guard and stays selected until resume',async()=>{const x=setup();x.bridge.open('fable','journal','2026-09-01');await tick();x.block();x.select.value='2026-09-02';assert.equal(x.bridge.handleDate(x.select),true);assert.equal(x.select.value,'2026-09-01');assert.equal(x.bridge.controller.reports.snapshot().date,'2026-09-01');x.resume();assert.equal(x.bridge.controller.reports.snapshot().date,'2026-09-02');x.bridge.controller.dispose()});
test('deferred origin restoration is cancelled after view/date mismatch',async()=>{for(const field of ['currentView','selectedDate']){const x=setup();x.bridge.open('fable','journal','2026-09-01');await tick();x.state.modal={type:'fixture'};x.actions['fund-report-back']();x.scroll.scrollTop=999;x.bridge.mounted();x.state[field]=field==='currentView'?'today':'2026-09-02';x.bridge.mounted();x.state.currentView='journal';x.state.selectedDate='2026-09-01';x.state.modal=null;x.bridge.mounted();assert.equal(x.scroll.scrollTop,999);x.bridge.controller.dispose()}});

})().catch(error => { console.error(error); process.exitCode = 1; });
