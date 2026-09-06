const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'..');
const fixtureSource=fs.readFileSync(path.join(__dirname,'remote-invalid-fail-close.test.js'),'utf8');
const base=vm.runInNewContext(fixtureSource.slice(fixtureSource.indexOf('function base('),fixtureSource.indexOf('const STATE_KEY'))+';base');
const primaryValues={avoidList:['local'],categories:['local'],lifeAreas:['local'],vision:'local',affirmation:'local',journalTemplate:'local',twelveWeekStartDate:'2026-09-01',twelveWeekScoreTarget:85,birthDate:'2000-01-01',battery:{local:1},gymExerciseList:['local'],visionDirectCategories:['local'],twelveWeekVision:'local',twelveWeekFocus:'local',twelveWeekReviewWeekMinItems:3,ironManualBaseKg:10,ironDailyTarget:2000,earlyRiseTarget:'06:00',dailyBufferMin:60,dayCloseHours:24,gymBlockKeywords:['local']};
const clone=x=>JSON.parse(JSON.stringify(x));
const KEY='taskchute-journal-pwa-state-v1',SHA='taskchute-journal-last-synced-sha',PULL='taskchute-journal-last-sync-pull-at';
let clock=Date.now();Date.now=()=>clock;global.setTimeout=()=>0;global.clearTimeout=()=>{};
let checks=0,failures=0;function check(name,fn){checks++;try{fn();console.log('PASS '+name);}catch(e){failures++;console.log('FAIL '+name+': '+e.message);}}
(async()=>{
const store=await import(pathToFileURL(path.join(ROOT,'src/state/store.js'))),sync=await import(pathToFileURL(path.join(ROOT,'src/sync/github.js')));
async function run(entry,key,opts={}){
  clock+=100000;const local=base(opts.localStamp||'2026-09-06T10:00:00');Object.assign(local.settings,clone(primaryValues));
  local.settings.lastPushedAt=opts.synced?local.dataModifiedAt:'2026-09-06T08:00:00';
  if(entry==='startup'&&!opts.followPush)local.settings.autoSync=false;
  const remote=clone(local);remote.dataModifiedAt=opts.remoteStamp||'2026-09-06T12:00:00';
  remote.tasks=[{id:'remote-only',title:'fixture',updatedAt:remote.dataModifiedAt}];
  remote.recurrences=entry==='legacy'?clone(local.recurrences):[{id:'remote-rule',updatedAt:remote.dataModifiedAt}];
  if(!opts.same){const v=primaryValues[key];remote.settings[key]=Array.isArray(v)?['remote']:typeof v==='number'?v+1:typeof v==='object'?{remote:1}:key.includes('Date')?'2001-01-01':'remote';}
  if(opts.empty)local.settings[key]='';
  store.setState(local);let expected=JSON.stringify(local);
  const memory=new Map([[KEY,expected],[SHA,'before-sha'],[PULL,'before-pull']]);
  if(opts.unknownLocalSha)memory.delete(SHA);
  const bannerBefore=sync._syncBanner;
  const calls={writes:[],puts:0,snapshots:0,confirms:0,gets:0,saves:0,putStates:[]};
  global.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>{calls.writes.push(k);memory.set(k,String(v));}};
  function edit(){store.state.settings[key]='edit-at-same-second';expected=JSON.stringify(store.state);memory.set(KEY,expected);}
  global.window={confirm:()=>{calls.confirms++;return opts.confirm!==false;}};
  global.fetch=async(_url,o={})=>{if(o.method==='PUT'){calls.puts++;calls.putStates.push(JSON.parse(JSON.parse(o.body).content));return {ok:true,json:async()=>({content:{sha:'after-put'}})};}calls.gets++;if(opts.during)edit();if(opts.shaDuring)memory.set(SHA,'changed-during');return {ok:true,json:async()=>({content:opts.invalidRemote?'[]':JSON.stringify(remote),encoding:'base64',sha:opts.noRemoteSha?'':opts.knownSha&&!opts.remoteChangedAfterGet?'before-sha':opts.knownSha&&calls.gets===1?'before-sha':'remote-sha'})};};
  const noop=()=>{};
  sync.configureGithubSync({normalizeState:x=>x,nowDateTime:()=> '2026-09-06T13:00:00',todayISO:()=> '2026-09-06',addDays:d=>d,isTouchedBlock:()=>false,RECURRENCE_KEEP_PAST_DAYS:7,RECURRENCE_FUTURE_DAYS:31,SWIPE_TRIAGE_LOG_MAX:200,
  showToast:noop,maintainRecurrences:noop,render:noop,renderDeferringForFocus:noop,runDailyOpen:()=>false,saveState:()=>{calls.saves++;localStorage.setItem(KEY,JSON.stringify(store.state));},
  requireGitHubConfig:()=>({branch:'fixture',token:'fixture'}),fetchGitHubFileSHA:async()=> opts.knownSha&&!opts.remoteChangedAfterGet?'before-sha':'remote-sha',personalDataReady:()=>true,personalDataFileConfig:()=>({branch:'fixture',token:'fixture'}),gitHubContentsURL:()=> 'https://fixture.invalid/state',githubHeaders:()=>({}),gitHubErrorMessage:()=> 'fixture',fromBase64:x=>x,toBase64:x=>x,sanitizedStateForGitHub:()=>store.state,maybeWriteBackupSnapshot:noop,writeBackupSnapshotBeforeLoad:async()=>{calls.snapshots++;if(opts.snapshotEdit)edit();if(opts.snapshotThrow)throw Error("fixture snapshot failure");return opts.snapshot!==false;},updateAutoSaveStatus:noop,updateSyncDot:noop,renderSyncBanner:noop,clearSyncBannerDismissal:noop,clearPersonalDataAuthError:noop,pruneExpiredSuggestedThemes:x=>x,_startupDataModifiedAt:local.dataModifiedAt});
  async function invoke(){if(entry==='startup')await sync.syncFromGitHubOnStartup();if(entry==='auto')await sync.runAutoSyncPull();if(entry==='push')await sync.runAutoSyncPush();if(entry==='legacy')await sync.saveToGitHub(true);if(entry==='manual')await sync.loadFromGitHub();}
  await invoke();
  const beforeFollowingPush=JSON.stringify(store.state);
  if(opts.followPush)await sync.runAutoSyncPush();
  let retryBefore;
  if(opts.retry){retryBefore={state:JSON.stringify(store.state),puts:calls.puts,writes:calls.writes.length};remote.settings=clone(store.state.settings);clock+=100000;await invoke();}
  return {state:store.state,memory,calls,expected,remote,retryBefore,bannerBefore,beforeFollowingPush};
}
function preserved(r){assert.equal(JSON.stringify(r.state),r.expected);assert.equal(r.memory.get(KEY),r.expected);assert.equal(r.memory.get(SHA),'before-sha');assert.equal(r.memory.get(PULL),'before-pull');assert.equal(r.calls.puts,0);assert.equal(r.calls.saves,0);assert.equal(r.calls.writes.length,0);}
for(const entry of ['startup','auto','push','legacy'])for(const key of Object.keys(primaryValues))for(const remoteStamp of ['2026-09-06T09:00:00','2026-09-06T10:00:00','2026-09-06T12:00:00']){
 const r=await run(entry,key,{remoteStamp});check(entry+'/'+key+'/'+remoteStamp,()=>{assert.ok(r.calls.gets);preserved(r);assert.equal(r.calls.snapshots,0);assert.ok(sync._syncBanner);});
}
for(const entry of ['startup','auto','push','legacy']){
 const r=await run(entry,'vision',{empty:true});check(entry+'/intentional-empty',()=>preserved(r));
 const d=await run(entry,'vision',{synced:entry!=='push',same:true,during:true});check(entry+'/same-second-GET-change',()=>preserved(d));
 const t=await run(entry,'vision',{localStamp:'2026-09-06',remoteStamp:'2026-09-07T01:00:00'});check(entry+'/date-only-stamp',()=>preserved(t));
 const ok=await run(entry,'vision',{same:true});check(entry+'/records-merge-without-primary-conflict',()=>{assert.ok(ok.state.tasks.some(t=>t.id==='remote-only'));assert.ok(ok.calls.writes.length);});
}
for(const opts of [{confirm:false},{snapshot:false},{snapshotEdit:true},{snapshotThrow:true}]){
 const r=await run('manual','twelveWeekVision',opts);check('manual/'+JSON.stringify(opts),()=>{assert.equal(r.calls.confirms,1);preserved(r);});
}
const accepted=await run('manual','twelveWeekVision');check('manual/explicit-accept',()=>{assert.equal(accepted.calls.confirms,1);assert.equal(accepted.calls.snapshots,1);assert.equal(accepted.state.settings.twelveWeekVision,accepted.remote.settings.twelveWeekVision);});
for(const entry of ['auto','startup','push']){
 const r=await run(entry,'vision',{same:true,snapshotEdit:true});check(entry+'/same-second-snapshot-change',()=>{assert.equal(r.calls.snapshots,1);preserved(r);});
}
for(const entry of ['auto','startup']){
 const r=await run(entry,'vision',{synced:true});check(entry+'/no-observed-pending-allows-adoption',()=>{assert.equal(r.state.settings.vision,r.remote.settings.vision);});
}
for(const entry of ['startup','auto']){
 const r=await run(entry,'vision',{knownSha:true});check(entry+'/known-SHA-pending-no-op',()=>{preserved(r);assert.equal(sync._syncBanner,r.bannerBefore);});
}
for(const entry of ['push','auto','startup'])for(const during of [false,true]){
 const r=await run(entry,'vision',{knownSha:true,during,followPush:entry!=='push'});check(entry+'/known-SHA-normal-save/'+during,()=>{assert.equal(r.calls.puts,1);assert.equal(r.calls.putStates[0].settings.vision,during?'edit-at-same-second':'local');assert.equal(r.state.settings.lastPushedAt,r.state.dataModifiedAt);if(entry!=='push')assert.equal(r.beforeFollowingPush,r.expected);});
}
for(const key of Object.keys(primaryValues)){
 const r=await run('push',key,{knownSha:true});check('push/known-SHA-setting/'+key,()=>{assert.equal(r.calls.puts,1);assert.deepEqual(r.calls.putStates[0].settings[key],primaryValues[key]);});
}
const emptySave=await run('push','vision',{knownSha:true,empty:true});check('push/known-SHA-intentional-empty',()=>{assert.equal(emptySave.calls.puts,1);assert.equal(emptySave.calls.putStates[0].settings.vision,'');});
for(const opts of [{remoteChangedAfterGet:true},{shaDuring:true},{unknownLocalSha:true},{noRemoteSha:true},{invalidRemote:true}]){
 const r=await run('push','vision',{knownSha:true,...opts});check('push/known-SHA-safety/'+JSON.stringify(opts),()=>{assert.equal(JSON.stringify(r.state),r.expected);assert.equal(r.calls.puts,0);assert.equal(r.calls.writes.length,0);assert.equal(r.calls.snapshots,0);});
}

for(const entry of ['startup','auto','push','legacy']){
 const r=await run(entry,'vision',{retry:true});check(entry+'/conflict-then-valid-retry',()=>{assert.equal(r.retryBefore.state,r.expected);assert.equal(r.retryBefore.puts,0);assert.equal(r.retryBefore.writes,0);assert.ok(r.state.tasks.some(t=>t.id==='remote-only'));assert.ok(r.calls.writes.length);});
}
console.log(JSON.stringify({checks,failures}));process.exitCode=failures?1:0;
})().catch(e=>{console.error(e);process.exitCode=2;});
