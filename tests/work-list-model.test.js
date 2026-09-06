const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/core/work-list.js'),'utf8');
 const {workListRows,filterWorkList}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const date='2026-09-06';
 const tasks=Array.from({length:300},(_,i)=>({id:'t'+i,title:'Task '+i,projectId:'p',description:i===299?'最後のメモ':'',doneCriteria:i===298?'受入条件':'',dueDate:date,estimateMin:20}));
 const blocks=tasks.map((t,i)=>({id:'b'+i,taskId:t.id,title:t.title,date,plannedStartAt:date+'T10:00',completed:i===0}));
 const state={tasks,blocks,projects:[{id:'p',title:'開発',description:'Projectの説明'}]};
 const before=JSON.stringify(state);Object.freeze(tasks);Object.freeze(blocks);Object.freeze(state.projects);Object.freeze(state);
 const today=workListRows(state,{scope:'today',date});assert.equal(today.length,300);assert.equal(today.filter(r=>r.status==='completed').length,1);
 assert.equal(filterWorkList(today,{query:'最後のメモ'},date)[0].id,'b299');
 assert.equal(filterWorkList(today,{query:'受入条件 開発'},date)[0].id,'b298');
 assert.equal(filterWorkList(today,{query:'　Ｔａｓｋ　２９９　最後のメモ　'},date)[0].id,'b299','NFKC, trim and AND');
 assert.equal(filterWorkList(today,{status:'open'},date).length,299);
 assert.equal(filterWorkList(today,{due:'today'},date).length,300);
 assert.equal(filterWorkList(today,{due:'overdue'},date).length,0);
 const mixed={...state,blocks:[...blocks,{id:'repeat',taskId:'t1',title:'2回目',date},{id:'single',title:'単発',date},
  {id:'future',title:'未来完了',date:'2026-09-07',completed:true},{id:'past',date:'2026-09-05'},
  {id:'deleted',date,deleted:true}]};
 const upcoming=workListRows(mixed,{scope:'exec',date,mode:'upcoming'});
 assert.equal(upcoming.length,302);assert.equal(upcoming.filter(r=>r.task?.id==='t1').length,2);
 assert.equal(upcoming.at(-1).id,'future');assert(upcoming.some(r=>r.id==='single'));
 assert(!upcoming.some(r=>['b0','past','deleted'].includes(r.id)));
 assert.equal(workListRows(mixed,{scope:'exec',date:'2026-09-07'}).length,1);
 assert.equal(workListRows({...state,blocks:[]},{scope:'exec',date,mode:'upcoming'}).length,0,'due-only Tasks are not placements');
 assert.equal(workListRows(state,{scope:'wbs',date}).length,301);
 assert.equal(filterWorkList(upcoming,{project:'__none__'},date).length,2);
 assert.equal(filterWorkList(upcoming,{query:'存在しない'},date).length,0);
 assert.equal(JSON.stringify(state),before,'model does not write state');
 assert.deepEqual(workListRows(state,{scope:'today',date}),today,'deterministic repeat');
 const allPlacements={tasks:[{id:'orphan-task',projectId:'missing-project'},{id:'no-project-task',projectId:''}],projects:[],blocks:[
  {id:'routine',date,category:'ルーティン',recurrenceGroupId:'routine-rule',routineId:'fixture-routine'},
  {id:'single',date,taskId:''},{id:'orphan',date,taskId:'orphan-task'},
  {id:'no-project',date,taskId:'no-project-task'},
  {id:'done',date,completed:true},{id:'removed',date,deleted:true},
  {id:'future-done',date:'2026-09-07',completed:true}]};
 assert.deepEqual(workListRows(allPlacements,{scope:'today',date}).map(row=>row.id).sort(),['done','no-project','orphan','routine','single']);
 assert.deepEqual(workListRows(allPlacements,{scope:'exec',date,mode:'upcoming'}).map(row=>row.id).sort(),['future-done','no-project','orphan','routine','single']);
 console.log('PASS explicit contract: routine/single/no Project included; deleted excluded; today completed/future completed separated');
 console.log('PASS work-list model: 300 Tasks/Blocks, last row, filters, occurrences, date boundary, no due placement, no mutation');
})().catch(e=>{console.error(e);process.exitCode=1;});
