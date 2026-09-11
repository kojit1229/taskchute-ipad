const assert = require('node:assert/strict');
(async () => {
  const { scheduleDisplay, scheduleTimelineRows, renderSchedule } = await import('../src/features/single-schedule-view.js');
  const { buildDailyViewModel } = await import('../src/features/daily-view-model.js');
  const { plannedOccupancy } = await import('../src/core/planned-occupancy.js');
  const day='2026-09-11';
  const record={ id:'shared', title:'overnight', date:'2026-09-10',
    plannedStartAt:'2026-09-10T23:00:00', plannedEndAt:`${day}T06:00:00`, completed:false, note:'memo' };
  const model={singleSchedules:[record,{id:'invalid'}, {...record,id:'deleted',deleted:true}],blocks:[],tasks:[]};
  const before=JSON.stringify(model);
  let display=scheduleDisplay(model,day);
  assert.deepEqual(display.records.map(row=>row.id),['shared']);
  assert.equal(display.warnings[0].count,1);
  assert.equal(JSON.stringify(model),before);
  assert.equal(scheduleDisplay({singleSchedules:{}},day).error.length>0,true);
  const view=buildDailyViewModel(record,{kind:'schedule',date:day});
  assert.equal(view.display.key,'schedule:shared');assert.match(view.display.title,/前日から/);
  assert.deepEqual(view.plan.range,[240,360]);assert.equal(view.plan.canStart,false);
  assert.equal(view.actual,undefined);
  const proxy=scheduleTimelineRows(model,day)[0];
  assert.equal(proxy.id,record.id);assert.equal(proxy.plannedStartAt,`${day}T04:00`);
  assert.equal(proxy.scheduleRecord.plannedStartAt,record.plannedStartAt);
  for (const completed of [true,false]) {
    record.completed=completed;
    const vm=buildDailyViewModel(record,{kind:'schedule',date:day});
    assert.equal(vm.plan.planCompleted,completed);
    assert.equal(renderSchedule(record,day,String,{detail:true}).includes('opacity:.55'),completed);
    assert.deepEqual(plannedOccupancy({schedules:scheduleDisplay(model,day).records},day).occupied,[[240,360]]);
  }
  const early={...record,id:'early',date:day,plannedStartAt:`${day}T01:00:00`,plannedEndAt:`${day}T03:00:00`};
  assert.equal(scheduleDisplay({singleSchedules:[early]},day).records.length,1);
  assert.equal(scheduleTimelineRows({singleSchedules:[early]},day).length,0);
  assert.match(renderSchedule(early,day,String),/時間軸外/);
  assert.throws(()=>buildDailyViewModel({...record,plannedStartAt:'bad'},{kind:'schedule',date:day}),/Invalid/);
  assert.throws(()=>buildDailyViewModel(record,{kind:'schedule',date:day},true),/Invalid/);
  assert.deepEqual(model.tasks,[]);assert.deepEqual(model.blocks,[]);
  console.log('PASS single schedule display: same IDs, continuation, completed occupancy, invalid exclusion, outside window, no actual projection');
})().catch(error=>{console.error(error);process.exitCode=1;});
