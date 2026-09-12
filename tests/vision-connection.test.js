// Node-only real render/action/hydrate functions with an in-memory transport.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),acorn=require('acorn');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});
const functions=['renderVision','renderVisionMd','visionMdStatusLine','renderVisionEdit','visionConnectionKey','ensureVisionConnection','invalidateVisionConnection','hydrateStaticMarkdown'].map(name=>{
 const n=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert(n);return source.slice(n.start,n.end);
}).join('\n');
function action(name){for(const n of ast.body){const call=n.expression;if(call?.callee?.name!=='registerActions')continue;const p=call.arguments[0].properties.find(p=>p.key.value===name);if(p)return source.slice(p.value.start,p.value.end);}throw Error(name);}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
function setup(){
 const sent=[],toasts=[];let feedbackReads=0,overviewRenders=0;
 const cfg={owner:'A',repo:'private',branch:'main',token:'synthetic'};
 const ctx=vm.createContext({
  dailyReading:{open(){},close(){},current:()=>null},
  recurrenceMatchesDate:()=>false,makeRecurrenceInstance:()=>null,
  isDailyReadingBlock:()=>false,markDailyReadingEdit:value=>value,
  state:{settings:{github:cfg,visionSection:'vision'},currentView:'vision',feedbackFiles:[],feedback:{},selectedDate:'2026-09-06'},
  cachedVisionMd:'original A',cachedAffirmationMd:'affirmation A',visionLegacyKey:JSON.stringify(cfg),visionLegacyGeneration:0,visionConnectionGeneration:0,
  visionMdFetchStatus:{vision:{ok:true,attemptedAt:1},affirmation:{ok:true,attemptedAt:1}},visionEditDraft:null,visionEditSaving:false,
  visionOverview:{render:()=>'',hydrate:async()=>false,reset(){}},renderHeader:()=>'',renderVisionAlignment:()=>'',renderVisionBoard:()=>'',renderMarkdown:x=>x,escapeHTML:x=>x,
  personalDataReady:x=>Boolean(x.token),personalDataConn:x=>({...x}),render(){},renderDeferringForFocus(){overviewRenders++;},
  autoGrowVisionEditTextarea(){},window:{confirm:()=>true},showToast:x=>toasts.push(x),VISION_MD_DISCONNECTED_TEXT:'disconnected',
  document:{querySelector:selector=>selector==='[data-vision-edit-textarea]'?null:{}},
  pushFileToGitHub:async(file,text)=>{sent.push({key:JSON.stringify(ctx.state.settings.github),file,text});return{ok:true};},
  fetchGitHubRawResult:async name=>({ok:true,status:200,text:name.includes('Vision')?'fresh vision':'fresh affirmation'}),fetchReportIndex:async()=>[],
  renderSidebar(){},renderBottomNav(){},patchAiReportUnreadList(){},cachedFeedback:{},todayISO:()=> '2026-09-06',addDays:()=> '2026-09-05',
  // Stop at the next existing I/O stage; reaching it proves optional images did not block.
  fetchGitHubRawText:()=>{feedbackReads++;throw new Error('FIXTURE_FEEDBACK_REACHED');}
 });
 ctx.visionReader={read:(...args)=>ctx.fetchGitHubRawResult(...args),invalidate(){}};
 vm.runInContext(functions+`\nthis.openEditor=${action('vision-edit-open')};this.saveEditor=${action('vision-edit-save')};`,ctx);
 const hydrate=()=>ctx.hydrateStaticMarkdown().catch(e=>{if(e.message!=='FIXTURE_FEEDBACK_REACHED')throw e;});
 return{ctx,sent,toasts,hydrate,feedbackReads:()=>feedbackReads,overviewRenders:()=>overviewRenders};
}
let count=0;async function test(name,run){await run();count++;console.log(`PASS ${name}`);}
(async()=>{
 for(const [field,value] of [['owner','B'],['repo','another'],['branch','branch-b'],['token','changed'],['token','']]){
  await test(`H1 ${field} change clears cached copy/status and editing permission`,()=>{
   const x=setup();x.ctx.state.settings.github[field]=value;const html=x.ctx.renderVision();
   assert(!html.includes('original A'));assert(!html.includes('vision-edit-open'));
   assert.equal(x.ctx.cachedVisionMd,'');assert.equal(x.ctx.cachedAffirmationMd,'');assert.equal(x.ctx.visionMdFetchStatus.vision.ok,null);
  });
 }
 await test('H2 draft survives connection change but cannot be sent to the new connection',async()=>{
  const x=setup();x.ctx.openEditor();const draft=x.ctx.visionEditDraft;
  x.ctx.state.settings.github.owner='B';await x.ctx.saveEditor();
  assert.equal(x.sent.length,0);assert.equal(x.ctx.visionEditDraft,draft);assert.equal(draft.text,'original A');
  assert(x.ctx.renderVision().includes('元の接続先の下書き'));assert(x.ctx.renderVisionEdit().includes('disabled'));
  x.ctx.state.settings.github.owner='A';await x.ctx.saveEditor();assert.equal(x.sent.length,1);assert.equal(x.ctx.visionEditDraft,null);
 });
 await test('H2 in-flight save response cannot update new connection cache or discard its retained draft',async()=>{
  const x=setup(),pending=deferred();x.ctx.openEditor();const draft=x.ctx.visionEditDraft;
  x.ctx.pushFileToGitHub=async()=>pending.promise;const save=x.ctx.saveEditor();
  x.ctx.state.settings.github.owner='B';x.ctx.ensureVisionConnection();x.ctx.cachedVisionMd='current B';
  pending.resolve({ok:true});await save;assert.equal(x.ctx.cachedVisionMd,'current B');assert.equal(x.ctx.visionEditDraft,draft);
  assert.equal(x.ctx.visionEditSaving,false);
 });
 await test('H1 delayed old-connection legacy response is ignored',async()=>{
  const x=setup(),pending=deferred();x.ctx.fetchGitHubRawResult=()=>pending.promise;const work=x.hydrate();
  x.ctx.state.settings.github.owner='B';pending.resolve({ok:true,status:200,text:'late A'});await work;
  assert.equal(x.ctx.cachedVisionMd,'');assert.equal(x.ctx.cachedAffirmationMd,'');assert.equal(x.feedbackReads(),0);
 });
 await test('same-connection out-of-order legacy reads keep the latest response',async()=>{
  const x=setup(),pending=deferred();let batch=0;
  x.ctx.fetchGitHubRawResult=name=>{if(name.endsWith('/Vision.md'))batch++;return batch===1?pending.promise:Promise.resolve({ok:true,status:200,text:'latest'});};
  const old=x.hydrate();await x.hydrate();pending.resolve({ok:true,status:200,text:'old'});await old;
  assert.equal(x.ctx.cachedVisionMd,'latest');assert.equal(x.ctx.cachedAffirmationMd,'latest');
 });
 await test('M1 pending overview images do not delay legacy cache or feedback entry; completion renders separately',async()=>{
  const x=setup(),pending=deferred();x.ctx.visionOverview.hydrate=()=>pending.promise;
  await x.hydrate();assert.equal(x.ctx.cachedVisionMd,'fresh vision');assert.equal(x.feedbackReads(),1);assert.equal(x.overviewRenders(),0);
  pending.resolve(true);await Promise.resolve();assert.equal(x.overviewRenders(),1);
 });
 await test('successful same-connection save invalidates an older GET',async()=>{
  const x=setup(),pending=deferred();x.ctx.openEditor();x.ctx.visionEditDraft.text='edited draft';
  x.ctx.fetchGitHubRawResult=()=>pending.promise;const old=x.hydrate();await x.ctx.saveEditor();
  assert.equal(x.ctx.cachedVisionMd,'edited draft');pending.resolve({ok:true,status:200,text:'old GET'});await old;
  assert.equal(x.ctx.cachedVisionMd,'edited draft');
 });
 await test('same-connection save retains further edits made while sending',async()=>{
  const x=setup(),pending=deferred();x.ctx.openEditor();x.ctx.visionEditDraft.text='sent version';
  x.ctx.pushFileToGitHub=()=>pending.promise;const save=x.ctx.saveEditor();
  x.ctx.visionEditDraft.text='further edits';pending.resolve({ok:true});await save;
  assert.equal(x.ctx.cachedVisionMd,'sent version');assert.equal(x.ctx.visionEditDraft.text,'further edits');
  assert.equal(x.ctx.visionMdFetchStatus.vision.ok,true);
 });
 console.log(`PASS vision connection (${count} cases)`);
})().catch(e=>{console.error(e);process.exitCode=1;});
