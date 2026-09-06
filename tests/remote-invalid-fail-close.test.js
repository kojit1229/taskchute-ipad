const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
const validate = vm.runInNewContext(app.slice(app.indexOf('function validateStateContainers('),app.indexOf('function normalizeState('))+';validateStateContainers');
const clone = x => JSON.parse(JSON.stringify(x));
function base(stamp='2026-09-06T10:00:00') {
  return {
    settings:{github:{token:'fixture',autoSave:false},autoSync:true,lastPushedAt:stamp,journalTemplate:'',morningEnergyLog:{}},
    dataModifiedAt:stamp,journals:{},feedback:{},reports:{},journalMeta:{},condition:{logs:{}},sleep:{logs:{}},
    blocks:[],tasks:[],projects:[],recurrences:[],declarations:[],questions:[],experiments:[],earlyBird:{},habitStreaks:{},habitPinHistory:{},
    zeroThinking:{entries:[],suggestedThemes:[],groups:[]},dailyDeclarations:{},weeklyWishes:{},bodyScans:[],writeMeditations:[],storeVisits:[],
    tracks:[],trackMeasurements:[],weeklyCommitments:[],swipeTriageLog:[],gardenLog:{},coachLog:{settings:{},meals:[]},
    aiStepProcessedIds:[],aiStepDismissedIds:[],aiReportReadIds:[],aiStepPendingRequests:[],archivedDates:[],
    chainRuns:[],aiScheduleHistory:[],feedbackFiles:[],feedbackIngestedDates:[],migrationRitualLog:[],zeroSecThemeLog:[],aiWorkProcessedIds:[]
  };
}
const STATE_KEY='taskchute-journal-pwa-state-v1';
const SHA_KEY='taskchute-journal-last-synced-sha';
const PULL_KEY='taskchute-journal-last-sync-pull-at';
let clock=Date.now();Date.now=()=>clock;
global.setTimeout=()=>0;global.clearTimeout=()=>{};
let failures=0,checks=0;
function check(name,fn){checks++;try{fn();console.log('PASS '+name);}catch(e){failures++;console.log('FAIL '+name+': '+e.message);}}
(async()=>{
  const store=await import(pathToFileURL(path.join(ROOT,'src/state/store.js')));
  const sync=await import(pathToFileURL(path.join(ROOT,'src/sync/github.js')));
  async function run(entry,kind,{stamp='2026-09-06T09:00:00',pending=false,during=false}={}) {
    clock+=100000;
    const local=base();if(pending)local.settings.lastPushedAt='2026-09-06T08:00:00';
    if(entry==='startup')local.settings.autoSync=false;
    store.setState(local);
    const remote=base(stamp);remote.zeroThinking.entries=[{id:'remote-only',date:'2026-09-06',text:'fixture',updatedAt:stamp}];
    if(kind==='journals')remote.journals='invalid';
    if(kind==='recurrences')remote.recurrences={invalid:true};
    let body=JSON.stringify(remote);
    if(kind==='json')body='{broken';if(kind==='null')body='null';if(kind==='array')body='[]';if(kind==='scalar')body='42';
    if(kind==="late-merge" || kind==="late-normalize") { local.recurrences=[{id:"local-rule"}]; remote.recurrences=[{id:"remote-rule"}]; body=JSON.stringify(remote); }
    let failNextMerge=false;
    let expected=JSON.stringify(local);
    const memory=new Map([[STATE_KEY,expected],[SHA_KEY,'sha-before'],[PULL_KEY,'pull-before']]);
    const calls={writes:[],puts:0,saves:0,snapshots:0,daily:0,gets:0};
    global.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>{calls.writes.push(k);memory.set(k,String(v));}};
    global.window={confirm:()=>true};
    global.fetch=async(_url,options={})=>{
      if(options.method==='PUT'){calls.puts++;return {ok:true,json:async()=>({content:{sha:'put-sha'}})};}
      calls.gets++;
      if(during){if(kind.startsWith('late-'))store.state.journals['2026-09-06']='fixture-edit-during-get';else store.state.settings.vision='fixture-edit-during-get';store.state.dataModifiedAt='2026-09-06T11:00:00';expected=JSON.stringify(store.state);memory.set(STATE_KEY,expected);}
      return {ok:true,json:async()=>({content:body,encoding:'base64',sha:'sha-remote'})};
    };
    const noop=()=>{};
    sync.configureGithubSync({normalizeState:value=>{validate(value);if(kind==='late-normalize' && failNextMerge){failNextMerge=false;throw Error('fixture-late-normalize');}if(kind==='normalize')throw Error('fixture-normalize');if(kind==='merge')Object.defineProperty(value,'blocks',{get(){throw Error('fixture-merge');}});if(kind==='late-merge'){const blocks=value.blocks;Object.defineProperty(value,'blocks',{get(){if(failNextMerge){failNextMerge=false;throw Error('fixture-late-merge');}return blocks;}});}return value;},
      nowDateTime:()=> '2026-09-06T13:00:00',todayISO:()=> '2026-09-06',addDays:d=>d,isTouchedBlock:()=>false,
      RECURRENCE_KEEP_PAST_DAYS:7,RECURRENCE_FUTURE_DAYS:31,SWIPE_TRIAGE_LOG_MAX:200,
      showToast:noop,maintainRecurrences:noop,render:noop,renderDeferringForFocus:noop,
      runDailyOpen:()=>{calls.daily++;return false;},saveState:()=>{calls.saves++;localStorage.setItem(STATE_KEY,JSON.stringify(store.state));},
      requireGitHubConfig:()=>({branch:'fixture',token:'fixture'}),fetchGitHubFileSHA:async()=> 'sha-remote',
      personalDataReady:()=>true,personalDataFileConfig:()=>({branch:'fixture',token:'fixture'}),
      gitHubContentsURL:()=> 'https://fixture.invalid/state',githubHeaders:()=>({}),gitHubErrorMessage:()=> 'fixture-error',
      fromBase64:x=>x,toBase64:x=>x,sanitizedStateForGitHub:()=>store.state,maybeWriteBackupSnapshot:noop,
      writeBackupSnapshotBeforeLoad:async()=>{calls.snapshots++;if(kind==="late-merge" || kind==="late-normalize")failNextMerge=true;return true;},updateAutoSaveStatus:noop,updateSyncDot:noop,
      renderSyncBanner:noop,clearSyncBannerDismissal:noop,clearPersonalDataAuthError:noop,
      pruneExpiredSuggestedThemes: x=>{if(kind==='merge')throw Error('fixture-merge');return x;},_startupDataModifiedAt:local.dataModifiedAt});
    if(entry==='startup')await sync.syncFromGitHubOnStartup();
    if(entry==='auto')await sync.runAutoSyncPull();
    if(entry==='manual')await sync.loadFromGitHub();
    if(entry==='push')await sync.runAutoSyncPush();
    if(entry==='legacy-push')await sync.saveToGitHub(true);
    return {calls,memory,expected,state:store.state};
  }
  for(const entry of ['startup','auto','manual','push','legacy-push'])for(const kind of ['journals','recurrences','json','null','array','scalar','normalize','merge']) {
    for(const stamp of ['2026-09-06T09:00:00','2026-09-06T10:00:00','2026-09-06T12:00:00']) {
      const result=await run(entry,kind,{stamp,pending:entry==='push'});
      check(entry+'/'+kind+'/'+stamp,()=>{
        assert.ok(result.calls.gets>0,'must actually exercise fetch');
        assert.equal(JSON.stringify(result.state),result.expected,'state must be unchanged');
        assert.equal(result.memory.get(STATE_KEY),result.expected,'persisted raw must be unchanged');
        assert.equal(result.memory.get(SHA_KEY),'sha-before');assert.equal(result.memory.get(PULL_KEY),'pull-before');
        assert.equal(result.calls.puts,0);assert.equal(result.calls.saves,0);assert.equal(result.calls.snapshots,0);
        assert.equal(result.calls.daily,0,'invalid remote must not trigger day-open mutation');
        assert.equal(result.calls.writes.length,0,'invalid remote must not advance successful sync state');
      });
    }
  }
  for(const entry of ['startup','auto']) {
    const result=await run(entry,'journals',{stamp:'2026-09-06T12:00:00',pending:true,during:true});
    check(entry+'/pending-and-during-get',()=>{assert.equal(JSON.stringify(result.state),result.expected);assert.equal(result.calls.saves,0);});
  }
  for(const entry of ['startup','auto','manual','push','legacy-push']) {
    const result=await run(entry,'valid',{stamp:'2026-09-06T12:00:00',pending:entry==='push'});
    check(entry+'/valid-retry',()=>{assert.ok(result.state.zeroThinking.entries.some(x=>x.id==='remote-only'));assert.ok(result.calls.writes.length>0);});
  }
  for(const entry of ['startup','auto','push','manual']) for(const kind of entry==='manual'?['late-merge']:['late-merge','late-normalize']) {
    const result=await run(entry,kind,{stamp:'2026-09-06T12:00:00',pending:true,during:entry==='startup'});
    check(entry+'/'+kind+'/single-failure-after-snapshot',()=>{
      assert.equal(result.calls.snapshots,1,'must reach snapshot wait boundary');
      assert.equal(JSON.stringify(result.state),result.expected);
      assert.equal(result.memory.get(STATE_KEY),result.expected);
      assert.equal(result.memory.get(PULL_KEY),'pull-before');assert.equal(result.memory.get(SHA_KEY),'sha-before');
      assert.equal(result.calls.puts,0);assert.equal(result.calls.saves,0);assert.equal(result.calls.writes.length,0);
    });
  }
  console.log(JSON.stringify({checks,failures}));process.exitCode=failures?1:0;
})().catch(e=>{console.error(e);process.exitCode=2;});
