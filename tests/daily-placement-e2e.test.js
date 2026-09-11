const assert=require('node:assert/strict');
(async()=>{
  const {runDailyOperation}=await import('../src/features/daily-operations.js');
  const {commitCandidate}=await import('../src/core/commit.js');
  const {contentKey}=await import('../src/core/single-schedule-merge.js');
  const {plannedAvailability}=await import('../src/features/daily-gap-placement.js');
  const date='2026-09-11',stamp=`${date}T10:00:00`;
  const source={id:'unset',date,title:'existing',plannedStartAt:'',plannedEndAt:'',estimateMin:30};
  const task={id:'task',title:'new',status:'todo',estimateMin:30};
  const schedule={id:'schedule',date,title:'occupied',plannedStartAt:`${date}T11:00:00`,plannedEndAt:`${date}T12:00:00`,completed:true};
  function fixture(){
    const state={selectedDate:date,blocks:[{...source}],tasks:[{...task}],singleSchedules:[{...schedule},{id:'invalid'}],reports:{},declarations:[]};
    let saved=0,synced=0,created=0;
    const deps={state,commitCandidate,now:()=>stamp,persist:()=>{saved++;return true;},scheduleSync:()=>synced++,
      makeBlock:values=>({id:`candidate-${++created}`,createdAt:stamp,...values}),projectName:()=>'',draftIntervals:()=>[]};
    const input=(kind='block',extra={})=>({kind,id:kind==='block'?'unset':'task',date,start:'10:00',end:'11:00',basis:'planned',
      requestId:'request',baseFingerprint:contentKey(state[kind==='block'?'blocks':'tasks'][0]),...extra});
    const run=i=>runDailyOperation(i.kind==='block'?'daily-gap-place':'daily-gap-create',i,deps);
    return {state,deps,input,run,counts:()=>({saved,synced,created})};
  }
  let f=fixture(),i=f.input();const blockBefore={...f.state.blocks[0]};
  let result=f.run(i);assert.equal(result.ok,true);assert.equal(f.state.blocks.length,1);
  assert.equal(f.state.blocks[0].id,'unset');assert.equal(f.state.blocks[0].estimateMin,blockBefore.estimateMin);
  assert.equal(f.state.blocks[0].plannedEndAt,`${date}T10:30:00`);assert.equal(result.warnings[0].count,1);
  assert.equal(f.run(i).unchanged,true);assert.equal(f.counts().saved,1);
  f=fixture();i=f.input('task');const tasksBefore=JSON.stringify(f.state.tasks);
  result=f.run(i);assert.equal(result.ok,true);assert.equal(f.state.blocks.length,2);
  assert.equal(f.state.blocks[1].taskId,'task');assert.equal(f.run(i).unchanged,true);
  assert.equal(f.counts().created,1);assert.equal(JSON.stringify(f.state.tasks),tasksBefore);
  assert.deepEqual(JSON.parse(JSON.stringify(f.state)).singleSchedules[1],{id:'invalid'});
  // Persistence failure retains one candidate ID, rolls back only the candidate, and never schedules sync.
  f=fixture();i=f.input('task');const before=JSON.stringify(f.state);f.deps.persist=()=>false;
  assert.equal(f.run(i).ok,false);assert.equal(JSON.stringify(f.state),before);assert.equal(f.counts().synced,0);
  f.state.tasks.push({id:'unrelated',title:'keep',status:'todo'});
  f.deps.persist=()=>true;assert.equal(f.run(i).ok,true);assert.equal(f.counts().created,1);
  assert.equal(f.state.blocks[1].id,'candidate-1');assert.equal(f.state.tasks[1].title,'keep');
  for(const duration of [undefined,0,10,'bad']){
    f=fixture();f.state.tasks[0].estimateMin=null;i=f.input('task',{duration});
    assert.equal(f.run(i).status,'invalid');assert.equal(f.state.blocks.length,1);
  }
  for(const estimateMin of [null,5]){
    f=fixture();f.state.tasks[0].estimateMin=estimateMin;i=f.input('task',{duration:20});
    assert.equal(f.run(i).ok,true);assert.equal(f.state.blocks[1].plannedEndAt,`${date}T10:20:00`);
    assert.equal(f.state.tasks[0].estimateMin,estimateMin);
  }
  for(const extra of [{end:'10:15'},{start:'03:00',end:'04:00'},{start:'23:30',end:'24:01'},{date:'2026-09-10'}]){
    f=fixture();assert.equal(f.run(f.input('task',extra)).status,'invalid');assert.equal(f.state.blocks.length,1);
  }
  f=fixture();assert.equal(f.run(f.input('task',{start:'23:30',end:'24:00'})).ok,true);
  assert.equal(f.state.blocks[1].plannedEndAt,'2026-09-12T00:00:00');
  // A change in the tail of the selected gap rejects even when the requested 30 minutes still fit.
  for(const kind of ['block','schedule','draft']){
    f=fixture();i=f.input('task');f.deps.persist=()=>false;assert.equal(f.run(i).ok,false);
    const conflict={id:'tail',date,title:'tail',plannedStartAt:`${date}T10:45:00`,plannedEndAt:`${date}T11:00:00`};
    if(kind==='block')f.state.blocks.push(conflict);
    if(kind==='schedule')f.state.singleSchedules.push(conflict);
    if(kind==='draft')f.deps.draftIntervals=()=>[conflict];
    f.deps.persist=()=>true;assert.equal(f.run(i).status,'invalid');assert.equal(f.counts().created,1);
  }
  for(const change of [{completed:true},{migratedTo:'sent'},{actualStartAt:stamp},{plannedStartAt:stamp},
    {date:'2026-09-12'},{estimateMin:45},{deleted:true}]){
    f=fixture();i=f.input();Object.assign(f.state.blocks[0],change);
    assert.equal(f.run(i).status,'invalid');assert.equal(f.counts().saved,0);
  }
  for(const setup of [
    f=>{f.state.singleSchedules={};},f=>{delete f.state.singleSchedules;},
    f=>{f.deps.readSchedules=()=>({status:'failed',value:[]});},f=>{f.deps.readSchedules=()=>({status:'unavailable',value:[]});},
    f=>{f.deps.readSchedules=()=>{throw Error('fetch failed');};},
    f=>{f.state.blocks.push({id:'bad',plannedStartAt:'bad'});},f=>{f.deps.draftIntervals=()=>[{id:'bad'}];},
    f=>{f.deps.draftIntervals=()=>null;},f=>{f.state.blocks={};}
  ]){
    f=fixture();i=f.input('task');setup(f);const before=JSON.stringify(f.state);
    assert.equal(f.run(i).status,'invalid');assert.equal(JSON.stringify(f.state),before);assert.equal(f.counts().saved,0);
  }
  const full={...schedule,plannedStartAt:`${date}T00:00:00`,plannedEndAt:'2026-09-12T00:00:00'};
  assert.deepEqual(plannedAvailability({blocks:[],singleSchedules:[full]},date).gaps,[]);
  console.log('PASS gap registry: identity, latest full-gap check, invalid/container/load failure stops, unchanged source, retry, calendar');
})().catch(error=>{console.error(error);process.exitCode=1;});
