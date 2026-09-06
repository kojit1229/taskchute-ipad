const assert = require('node:assert/strict');
(async () => {
  const { placementTimes, existingPlacement, placementCandidate } = await import('../src/core/placement.js');
  const { commitPlacement } = await import('../src/features/placement.js');
  for (const [date, time, duration, end] of [
    ['2026-09-06', '11:40', 25, '2026-09-06T12:05'],
    ['2026-09-06', '18:15', 30, '2026-09-06T18:45'],
    ['2026-09-06', '23:50', 30, '2026-09-07T00:20'],
    ['2028-02-29', '23:50', 25, '2028-03-01T00:15'],
    ['2026-12-31', '23:50', 30, '2027-01-01T00:20']
  ]) assert.equal(placementTimes(date,time,duration).plannedEndAt,end);
  for (const [date,time,duration] of [
    ['2026-02-29','11:40',30],['2026-09-06','',30],['2026-09-06','24:00',30],
    ['2026-09-06','11:60',30],['2026-09-06','11:40',0],['2026-09-06','11:40',1.5],
    ['2026-09-06','11:40',null],['2026-09-06','11:40',Infinity]
  ]) assert.equal(placementTimes(date,time,duration),null);
  const model = { selectedDate:'2020-01-01', dataModifiedAt:'old', blocks:[
    {id:'future',taskId:'t1',date:'2026-09-07'},
    {id:'deleted',taskId:'t1',date:'2026-09-06',deleted:true}
  ], tasks:[{id:'t1',title:'Step',parentTaskId:'wish-root',status:'todo',projectId:'wish',estimateMin:25}] };
  const input={taskId:'t1',source:'wish',date:'2026-09-06',time:'23:50',duration:25};
  let creations=0;
  const deps={today:'2026-09-06',stamp:'new',makeBlock: input=>({id:`new-${++creations}`,...input}),projectName:()=> 'Project'};
  const before=JSON.stringify(model);
  assert.equal(existingPlacement(model.blocks,'t1',deps.today),null);
  assert.ok(placementCandidate(model,{...input,time:''},deps).error);
  assert.ok(placementCandidate(model,{...input,date:'2020-01-01'},deps).error);
  assert.equal(creations,0);
  const result=placementCandidate(model,input,deps);
  assert.equal(JSON.stringify(model),before,'candidate must not mutate');
  assert.equal(result.block.date,deps.today);
  assert.equal(result.block.taskId,'t1');
  assert.equal(result.block.plannedEndAt,'2026-09-07T00:15');
  assert.equal(result.block.expectedCharge,4);
  assert.equal(result.block.expectedDischarge,1);
  assert.equal(result.tasks[0].status,'doing');
  assert.equal(result.tasks[0].parentTaskId,'wish-root');
  const oldBlocks=model.blocks,oldTasks=model.tasks;
  let schedules=0;
  for(const persist of [()=>false,()=>{throw Error('quota');}]) {
    assert.equal(commitPlacement(model,result,{stamp:'new',persist,schedule:()=>schedules++}),false);
    assert.equal(model.blocks,oldBlocks); assert.equal(model.tasks,oldTasks);
    assert.equal(model.dataModifiedAt,'old'); assert.equal(schedules,0);
  }
  const sequence=[];
  assert.equal(commitPlacement(model,result,{stamp:'new',persist:()=>{sequence.push('persist');assert.equal(model.blocks.at(-1).taskId,'t1');return true;},schedule:()=>sequence.push('schedule')}),true);
  assert.deepEqual(sequence,['persist','schedule']);
  const count=creations;
  assert.equal(placementCandidate(model,input,deps).existing.id,result.block.id);
  assert.equal(creations,count,'revisit/double confirmation must not create');
  const wbs=placementCandidate({...model,blocks:[]},{...input,source:'wbs'},deps);
  assert.equal(wbs.tasks,model.tasks);
  assert.equal(wbs.block.category,'Project');
  assert.equal(wbs.block.expectedCharge,undefined);
  assert.ok(placementCandidate({...model,tasks:[]},input,deps).error);
  const doneModel={...model,blocks:[],tasks:model.tasks.map(t=>({...t,status:'completed'}))};
  const doneBefore=JSON.stringify(doneModel),beforeDone=creations;
  assert.match(placementCandidate(doneModel,input,deps).error,/完了済み/);
  assert.equal(creations,beforeDone);assert.equal(JSON.stringify(doneModel),doneBefore);
  const {setState}=await import('../src/state/store.js');
  const {configurePlacement,openTaskPlacement,placementBackHTML}=await import('../src/features/placement.js');
  const linked={...model,currentView:'wbs',wishOpenId:'',selectedDate:'2020-01-01'};
  setState(linked);
  global.window={scrollY:0};global.document={querySelector:()=>null};
  configurePlacement({requestLeave:()=>false,todayISO:()=>deps.today,escapeHTML:String,modalHeaderHTML:()=>'',renderModal:()=>{},
    closeModal:()=>{linked.modal=null;},setView:view=>{linked.currentView=view;}});
  openTaskPlacement('t1');
  assert.match(placementBackHTML(result.block),/placement-return/);
  assert.equal(placementBackHTML({...result.block,id:'another-block',date:'2026-09-07'}),'','different Block must not inherit origin');
  assert.equal(placementBackHTML({...result.block,taskId:'another-task'}),'');
  delete global.window;delete global.document;
  console.log('PASS placement calendar, candidate, source IDs, actual today, duplicate guard, atomic persistence ordering');
})().catch(error=>{console.error(error);process.exitCode=1;});
