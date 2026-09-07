// Portable author guarantees: imports installed runtime; synthetic HTTP only.
const path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'..');
const load=name=>import(pathToFileURL(path.join(ROOT,'src/features/feedback',name+'.js')).href);
(async()=>{
const {test}=require('node:test'),assert=require('node:assert/strict');
const acorn=require('acorn'),app=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
const ast=acorn.parse(app,{ecmaVersion:'latest',sourceType:'module'});
const functions={},properties={},wanted=['invalidateFeedbackConnection','renderFeedbackUiSlot','patchFeedbackUi','feedbackCanonicalNotice','hydrateStaticMarkdown','markFeedbackReadKeepingScroll','maybeMarkAiReportRead'];
function visit(node){if(!node||typeof node!=='object')return;
 if(node.type==='FunctionDeclaration'&&wanted.includes(node.id.name)){assert.equal(functions[node.id.name],undefined);functions[node.id.name]=app.slice(node.start,node.end);}
 if(node.type==='Property'&&['getCanonicalFiles','getCanonicalBody'].includes(node.key.name)){assert.equal(properties[node.key.name],undefined);properties[node.key.name]=app.slice(node.value.start,node.value.end);}
 for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
}
visit(ast);for(const name of wanted)assert.equal(typeof functions[name],'string');
const hydrate=functions.hydrateStaticMarkdown,begin=hydrate.indexOf('  const files = Array.isArray(state.feedbackFiles)'),end=hydrate.indexOf('  // v159:',begin);
assert.ok(begin>=0&&end>begin);functions.hydrateSegment=hydrate.slice(begin,end);delete functions.hydrateStaticMarkdown;
for(const name of ['getCanonicalFiles','getCanonicalBody'])assert.equal(typeof properties[name],'string');
const vm=require('node:vm');

const {createFeedbackReadonlyPatch}=await load('feedback-readonly-patch');
const {createFeedbackCanonicalReader}=await load('feedback-canonical-reader');
const {createFeedbackUiView}=await load('feedback-ui-view');
const {createFeedbackReportOverlay}=await load('feedback-report-overlay');
const date='2026-09-06',prior='2026-09-05',name=d=>`AIフィードバック_${d}.md`;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
test('actual repaired journal/overlay callbacks never read any unscoped legacy cache',async()=>{
 let key=1;const reader=createFeedbackCanonicalReader({http:{connectionKey:()=>String(key),get:async r=>r.kind==='canonical-directory'?{status:200,entries:[]}:{status:200,text:r.kind==='canonical-index'?JSON.stringify({generatedAt:new Date().toISOString(),files:[name(date),name(prior)]}):'verified '+key+' '+r.name}}});
 await reader.refresh(date);await reader.refresh(prior);
 const trap=new Proxy({}, {get(){throw Error('legacy cache accessed');}}),slot={innerHTML:'',isConnected:true,contains:()=>false,querySelectorAll:()=>[]};
 const body={},root={scrollTop:0,scrollLeft:0};
 function controller(){let selected=date;return {selectDate:d=>selected=d,invalidate(){},refresh:async()=>{},snapshot:()=>({date:selected,versions:[],rows:[],status:'idle',lastGoodAt:null,busy:false})};}
 const journal=controller(),report=controller(),view=createFeedbackUiView({escapeHTML:String,renderMarkdown:String});
 const c={state:{currentView:'journal',selectedDate:date,feedback:trap},cachedFeedback:trap,_aiReportDirCache:trap,_aiReportBodyCache:trap,
 feedbackCanonicalReader:reader,feedbackHttpClient:{invalidate:()=>key++},feedbackUiController:journal,feedbackReportController:report,feedbackOverlayLoaded:true,
 feedbackUiView:view,createFeedbackReadonlyPatch,feedbackReadonlyPatch:null,ensureFeedbackClients(){},main:{querySelector:()=>null,querySelectorAll:()=>[]},markAiReportRead(){throw Error('unexpected read mark');},document:{querySelector:()=>slot,getElementById:()=>root,scrollingElement:root,body,activeElement:body,addEventListener(){}}};vm.createContext(c);
 vm.runInContext(Object.entries(functions).filter(([k])=>k!=='hydrateSegment').map(([,v])=>v).join('\n')+`\nthis.files=(${properties.getCanonicalFiles});this.body=(${properties.getCanonicalBody});`,c);
 c.feedbackReportOverlay=createFeedbackReportOverlay({gateway:{key:()=>key,dates:async()=>[]},controller:report,view,escapeHTML:String,getCanonicalFiles:c.files,getCanonicalBody:c.body,onUpdate(){}});
 assert.match(c.renderFeedbackUiSlot(date),/verified 1/);c.patchFeedbackUi();assert.match(slot.innerHTML,/verified 1/);
 c.feedbackReportOverlay.select(prior);assert.match(c.feedbackReportOverlay.render(),/verified 1 AIフィードバック_2026-09-05/);assert.equal(journal.snapshot().date,date);
 c.invalidateFeedbackConnection();assert.doesNotMatch(c.renderFeedbackUiSlot(date),/verified 1/);await reader.refresh(date);c.patchFeedbackUi();assert.match(slot.innerHTML,/verified 2/);
 c.state.currentView='ai-reports';c.feedbackReportOverlay.select(date);c.patchFeedbackUi();assert.match(slot.innerHTML,/verified 2/);assert.doesNotMatch(slot.innerHTML,/verified 1/);
});
for(const mode of ['same','AB','ABA'])test('actual hydrate await adoption '+mode,async()=>{
 const gate=deferred(),entered=deferred();let key='A',generation=1,fetches=0,record=0,ingest=0,saves=0;
 const c={state:{selectedDate:date,feedbackFiles:[date],feedback:{}},cachedFeedback:{},todayISO:()=>date,addDays:()=>prior,
 fetchGitHubRawText:()=>{if(++fetches===2)entered.resolve();return gate.promise;},ensureVisionConnection:()=>key,visionLegacyGeneration:generation,
 recordFeedbackFile:()=>record++,autoIngestFeedback:()=>{ingest++;return {addedThemes:1};},saveState:()=>saves++,showToast(){}};
 vm.createContext(c);vm.runInContext('this.run=async()=>{const connectionKey=ensureVisionConnection(),generation=visionLegacyGeneration;let changed=false;'+functions.hydrateSegment+';return changed;}',c);
 const pending=c.run();await entered.promise;if(mode!=='same'){key=mode==='AB'?'B':'A';c.visionLegacyGeneration=mode==='AB'?2:3;}
 gate.resolve('synthetic old feedback');await pending;
 if(mode==='same'){assert.equal(record,1);assert.equal(ingest,2);assert.equal(saves,1);assert.equal(c.cachedFeedback[date],'synthetic old feedback');}
 else {assert.equal(record,0);assert.equal(ingest,0);assert.equal(saves,0);assert.equal(Object.keys(c.cachedFeedback).length,0);}
});

})().catch(error=>{console.error(error);process.exitCode=1;});
