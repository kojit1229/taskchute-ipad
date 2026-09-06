// FUND regression: complete assertions remain visible to the test manifest.
'use strict';
(async () => {
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const {createFundDOMBridge} = await import('../src/features/fund/dom-bridge.js');
const {createFundReportView} = await import('../src/features/fund/report-view.js');
const {createFundReportSelection} = await import('../src/features/fund/report-selection.js');
test('date control matches state after immediate acceptance, stays old during guard and cancellation, follows continuation',()=>{
 let wait=false,continuation;const state={currentView:'ai-reports',selectedDate:'2026-07-01'};
 globalThis.document={activeElement:null,getElementById:()=>null};
 const bridge=createFundDOMBridge({root:{querySelector:()=>null,querySelectorAll:()=>[],addEventListener:()=>{}},getState:()=>state,registerActions:()=>{},requestDraftLeave:fn=>{if(wait){continuation=fn;return true;}return false;},setView:()=>{},render:()=>{},markRead:()=>{},connection:()=>({ready:false}),fetchImpl:()=>{throw Error('must not fetch');},headers:()=>({}),escapeHTML:String,renderHeader:()=>'',renderMarkdown:String});
 try{bridge.controller.selectReport('fundJournal','2026-07-02');const target={matches:s=>s==='[data-fund-report-date]',value:'2026-07-03'};
 assert.equal(bridge.handleDate(target),true);assert.equal(target.value,'2026-07-03');assert.equal(bridge.controller.reports.snapshot().date,target.value);
 wait=true;target.value='2026-07-04';bridge.handleDate(target);assert.equal(target.value,'2026-07-03');assert.equal(bridge.controller.reports.snapshot().date,'2026-07-03');
 continuation=null;assert.equal(bridge.controller.reports.snapshot().date,'2026-07-03');
 target.value='2026-07-05';bridge.handleDate(target);continuation();assert.equal(bridge.controller.reports.snapshot().date,'2026-07-05');
 }finally{bridge.controller.dispose();}
});
test('partial sources are explained without making failed sources look complete',()=>{
 for(const [sources,expected] of [[{index:'failed',directory:'available'},'フォルダで確認できた履歴'],[{index:'invalid',directory:'available'},'一覧ファイルを確認できない'],[{index:'available',directory:'failed'},'フォルダの再確認に失敗'],[{index:'available',directory:'invalid'},'一覧ファイルで確認できた履歴'],[{index:'available',directory:'available'},null],[{index:'available',directory:'not_requested'},null]]){
 const selection=createFundReportSelection();const v=createFundReportView({selection,gateway:{snapshot:()=>({state:'available',sources,data:{files:[],generatedAt:null}})},escapeHTML:String,renderMarkdown:String});const html=v.render();if(expected)assert(html.includes(expected));else assert.doesNotMatch(html,/フォルダで確認できた履歴|フォルダの再確認に失敗/);
 }
});

})().catch(error => { console.error(error); process.exitCode = 1; });
