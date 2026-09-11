'use strict';
(async()=>{
const fs=(await import("node:fs")).default;
const path=(await import("node:path")).default;
const vm=(await import("node:vm")).default;
const test=(await import("node:test")).default;
const assert=(await import("node:assert/strict")).default;
const {fileURLToPath}=await import("node:url");
const {createRequire}=await import("node:module");
const {createHash,webcrypto}=await import("node:crypto");
const {createLocalReportCommit}=await import("../src/features/feedback/local-report-commit.js");
const {commitCandidate}=await import("../src/core/commit.js");
const {createReportProofAdapter}=await import("../src/features/feedback/report-proof-adapter.js");
const {createFeedbackCoordinator}=await import("../src/features/feedback/feedback-coordinator.js");
// v387 ハーネス追随(監督者決定 2026-09-11、束B7 単位37): adoptSyncResult が単発予定の比較 singleSchedulesEqual を参照するようになったので、実物を砂場へ渡す(製品変更なし)。
const {singleSchedulesEqual,validateSingleScheduleContainer}=await import("../src/core/single-schedule.js");
const here=__dirname;
const {transformSync}=require('./support/sync-proof-transform.cjs');
const acorn=require('acorn');
function getFunction(source,name){const nodes=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n).filter(n=>n?.type==='FunctionDeclaration'&&n.id.name===name);assert.equal(nodes.length,1,'one actual runtime function '+name);return source.slice(nodes[0].start,nodes[0].end);}
const safe=path.resolve(here,'..');
const syncSource=fs.readFileSync(path.join(safe,'src/sync/github.js'),'utf8');
const sync=['adoptSyncResult','saveToGitHub'].map(name=>getFunction(syncSource,name)).join('\n');
const storage=getFunction(fs.readFileSync(path.join(safe,'src/storage/local.js'),'utf8'),'persistLocalNoSchedule');
const hash=bytes=>createHash('sha1').update(bytes).digest('hex');
function fixture(mode='ok'){
 const date='2026-09-06';let generation=1,selected=date,today=date,raw,primary,report,queueWrites=0,reportWrites=0,primaryWrites=0;
 const state={selectedDate:date,reports:{old:'synthetic old'},journals:{[date]:'synthetic journal\r\n text'},journalMeta:{[date]:{textUpdatedAt:'audit-only'}},
  archivedDates:mode==='archived'?[date]:[],settings:{morningEnergyLog:{},github:{token:'SYNTHETIC_TOKEN'}},sleep:{logs:{}},blocks:[],tasks:[],projects:[],recurrences:[]};
 raw=JSON.stringify(state);const initialRaw=raw,initialReports=state.reports;
 const serialize=()=>{const copy=structuredClone(state);delete copy.settings.github.token;return JSON.stringify(copy,null,2);};
 const syncErrors=[];
 const box={state,commitCandidate,singleSchedulesEqual,validateSingleScheduleContainer,setState:value=>{box.state=value;},saveState:Object.assign(()=>{},{pendingStamp:null}),
  STORAGE_KEY:'fixture-only',_lastSaveError:null,_githubSaveInFlight:mode==='inflight',autoSaveTimer:null,
  console:{error:(...args)=>syncErrors.push(args.map(String).join(' '))},localStorage:{setItem(k,value){if(mode==='quota')throw Error('synthetic quota');raw=value;}},
  archiveConnectionKey:()=>generation,capturePrimarySyncState:()=>({}),requireGitHubConfig:()=>({branch:'fixture',token:'SYNTHETIC_TOKEN'}),
  fetchGitHubFileSHA:async()=>mode==='conflict'?'b'.repeat(40):'a'.repeat(40),getLastSyncedSha:()=> 'a'.repeat(40),
  clearTimeout(){},downloadGitHubStateText:async()=>({text:'{}'}),normalizedRemoteCopy:()=>({}),
  prepareArchiveMerge:async()=>{if(mode==='archive-proof')throw Object.assign(Error('synthetic'),{name:'ArchiveTextConflict'});},
  assertPrimarySettingsSafe(){if(mode==='primary-setting')throw Object.assign(Error('synthetic'),{name:'PrimarySettingsConflict'});},
  requireSyncMerge:()=>null,archiveProof:{assert(){}},sanitizedStateForGitHub:()=>JSON.parse(serialize()),
  gitHubContentsURL:()=> 'synthetic://primary',githubHeaders:()=>({}),toBase64:s=>Buffer.from(s).toString('base64'),
  fetch:async(url,options)=>{assert.equal(url,'synthetic://primary');assert.equal(options.method,'PUT');primaryWrites++;
    const payload=JSON.parse(options.body);assert.equal(payload.sha,'a'.repeat(40));primary=Buffer.from(payload.content,'base64').toString();
    return {ok:true,json:async()=>{if(mode==='primary-json-aba')generation+=2;return {content:{sha:hash(primary)}};}};},
  clearPersonalDataAuthError(){},setLastSyncedSha(){},recordSyncPushSuccess(){},nowDateTime:()=>date+'T12:00:00',
  clearSyncBanner(){},showToast(){},updateAutoSaveStatus(){},maybeWriteBackupSnapshot(){},setSyncBanner(){}};
 // Primary-setting proof is reached only on a changed remote head.
 if(mode==='primary-setting')box.fetchGitHubFileSHA=async()=> 'b'.repeat(40);
 vm.createContext(box);vm.runInContext(storage+'\n'+sync,box);
 const localCommit=createLocalReportCommit({getState:()=>state,canSave:()=>mode!=='local-blocked',
  persist:()=>{box.persistLocalNoSchedule();return !box._lastSaveError;},readStored:()=>raw,writeStored:value=>{raw=value;},now:()=>date+'T12:00:00'});
 const proof=createReportProofAdapter({syncProtectedState:async options=>{
    if(mode==='edit-before-sync')state.journals[date]+=' later edit';
    if(mode==='aba')generation+=2;
    return box.saveToGitHub(true,options);
   },get:async resource=>{
    if(resource.kind==='primary-state')return {status:200,sha:'a'.repeat(40),text:mode==='state-mismatch'?'different':primary};
    if(mode==='report-get500')return {status:500};
    return report===undefined?{status:404}:{status:200,sha:hash(report),text:report};
   },putReport:async(resource,text,options)=>{
    assert.equal(resource.kind,'report');assert.equal(options.expectedSha,report===undefined?null:hash(report));reportWrites++;
    if(mode!=='report-never-saved')report=text;
    if(mode==='put-uncertain')throw Error('synthetic reply lost');
    if(mode==='date-change')selected='2026-09-05';
    return {status:201};
   }});
 const files=new Map();
 const queueTransport={connectionKey:()=>String(generation),get:async key=>{
   if(mode==='date-in-queue-read')selected='2026-09-05';
   const bytes=files.get(key);return bytes?{status:200,sha:hash(bytes),bytes:bytes.slice()}:{status:404};
  },put:async(key,bytes,options)=>{
   queueWrites++;const before=files.get(key);assert.equal(options.expectedSha,before?hash(before):null);
   assert(!new TextDecoder().decode(bytes).includes('SYNTHETIC_TOKEN'));files.set(key,bytes.slice());return {status:201};
  }};
 const run=createFeedbackCoordinator({getState:()=>state,identity:()=>generation,selectedDate:()=>selected,today:()=>today,
  now:()=>date+'T12:00:00Z',crypto:webcrypto,localCommit,serializePrimary:serialize,proof,queueTransport});
 return {run:()=>run(date,()=>true),state,initialReports,initialRaw,inspect:()=>({raw,primary,report,queueWrites,reportWrites,primaryWrites,syncErrors})};
}
for(const mode of ['quota','local-blocked','archived','inflight','conflict','primary-setting','archive-proof','edit-before-sync','aba','primary-json-aba','state-mismatch','report-get500','report-never-saved','date-change','date-in-queue-read'])
 test('unconfirmed '+mode+' cannot write request or queue',async()=>{
  const f=fixture(mode);await assert.rejects(f.run());const got=f.inspect();assert.equal(got.queueWrites,0);
  if(['quota','local-blocked','archived'].includes(mode)){assert.equal(f.state.reports,f.initialReports);assert.equal(got.raw,f.initialRaw);}
  if(['inflight','conflict','primary-setting','archive-proof','edit-before-sync','aba'].includes(mode))assert.equal(got.primaryWrites,0);
  if(['state-mismatch','report-get500','report-never-saved','date-change','date-in-queue-read'].includes(mode))assert.equal(got.primaryWrites,1,'must reach intended post-sync failure');
  if(mode==='edit-before-sync')assert.match(f.state.journals['2026-09-06'],/later edit$/);
  if(mode==='primary-json-aba'){assert.equal(got.primaryWrites,1);assert.equal(got.reportWrites,0);assert.equal(f.state.settings.lastPushedAt,undefined);}
 });
for(const mode of ['ok','put-uncertain'])test('actual protected sync + readbacks + real queue '+mode,async()=>{
 const f=fixture(mode),result=await f.run(),got=f.inspect();
 assert.equal(got.primaryWrites,1);assert.equal(got.reportWrites,1);assert.equal(got.queueWrites,2);
 // The real PUT-success adoption must persist exactly the transmitted version's stamp.
 const sentStamp=JSON.parse(got.primary).dataModifiedAt;
 assert.ok(sentStamp);assert.deepEqual(got.syncErrors,[]);
 assert.equal(f.state.settings.lastPushedAt,sentStamp);
 assert.equal(JSON.parse(got.raw).settings.lastPushedAt,sentStamp);
 assert.ok(result);assert.equal(got.report,f.state.reports['2026-09-06']);
});
test('local readback and timestamp failures restore exact memory and raw storage',()=>{
 for(const mode of ['readback','stamp','rollback-failure']){
  const state={reports:{old:'old'},journals:{'2026-09-06':'synthetic'},dataModifiedAt:'2026-09-06T11:00:00'};
  const reports=state.reports,initial=JSON.stringify(state);let raw=initial,reads=0;
  const commit=createLocalReportCommit({getState:()=>state,canSave:()=>true,now:()=>{if(mode==='stamp')throw Error('synthetic');return '2026-09-06T12:00:00';},
   persist:()=>{raw=JSON.stringify(state);return true;},readStored:()=>++reads===2?'{}':raw,
   writeStored:value=>{if(mode==='rollback-failure')throw Error('synthetic');raw=value;}});
  const result=commit({date:'2026-09-06',journalText:'synthetic',reportMarkdown:'new report'});
  assert.equal(result.ok,false);assert.equal(state.reports,reports);assert.equal(state.dataModifiedAt,'2026-09-06T11:00:00');
  if(mode==='rollback-failure')assert.equal(result.reason,'local_rollback_unconfirmed');else assert.equal(raw,initial);
 }
});
test('configuration never defaults to successful save or proof',()=>{
 assert.throws(()=>createFeedbackCoordinator(),/configuration/);
 assert.throws(()=>createLocalReportCommit(),/configuration/);
 assert.throws(()=>createReportProofAdapter(),/configuration/);
 assert.throws(()=>transformSync(transformSync(syncSource)),/already integrated/);
});

test('re-saving the same report text issues no stamp and no persist (design 03 / K decision D06)',()=>{
 const state={reports:{'2026-09-06':'same report'},journals:{'2026-09-06':'synthetic'},dataModifiedAt:'2026-09-06T11:00:00'};
 let raw=JSON.stringify(state),persists=0,nows=0;
 const commit=createLocalReportCommit({getState:()=>state,canSave:()=>true,now:()=>{nows++;return '2026-09-06T12:00:00';},
  persist:()=>{persists++;raw=JSON.stringify(state);return true;},readStored:()=>raw,writeStored:value=>{raw=value;}});
 const result=commit({date:'2026-09-06',journalText:'synthetic',reportMarkdown:'same report'});
 assert.equal(result.ok,true);assert.equal(persists,0);assert.equal(nows,0);assert.equal(state.dataModifiedAt,'2026-09-06T11:00:00');
 assert.equal(state.reports['2026-09-06'],'same report');
});
})().catch(error=>{console.error(error);process.exitCode=1;});
