// Order 79 / M2-3: counts depend only on the supplied blocks/tasks/week.
const assert = require("node:assert/strict");
const { fixedClock } = require("./helpers");
(async () => {
  const { weekCounts, ringRatio } = await import("../src/core/twy-stack.js");
  const { weekStartOfISO, addDaysISO } = await import("../src/core/plan.js");
  const now = new Date(fixedClock(Date.now())());
  const week = weekStartOfISO([now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-"));
  const tasks = [{id:"yes",projectId:"goal",twyPlan:{perWeek:3}}, {id:"off",twyPlan:{perWeek:0}}, {id:"deleted",deleted:true,twyPlan:{perWeek:1}}];
  const blocks = [
    {taskId:"yes",date:week,completed:true},
    {taskId:"yes",date:addDaysISO(week,2),completed:true},
    {taskId:"yes",date:addDaysISO(week,2),completed:true},
    {taskId:"yes",date:addDaysISO(week,6),completed:false},
    ...["off","deleted","missing"].map(taskId=>({taskId,date:week,completed:true})),
    {taskId:"yes",date:week,completed:true,deleted:true},
    {taskId:"yes",date:addDaysISO(week,-1),completed:true},
    {taskId:"yes",date:addDaysISO(week,7),completed:true}
  ];
  const before = JSON.stringify({blocks,tasks});
  const days = weekCounts(blocks,tasks,week);
  assert.deepEqual(days.map(d=>d.done),[1,0,2,0,0,0,0]);
  assert.deepEqual(days.map(d=>d.planned),[1,0,2,0,0,0,1]);
  assert.deepEqual(days.map(d=>d.date),Array.from({length:7},(_,i)=>addDaysISO(week,i)));
  assert.equal(ringRatio(3,4),.75); assert.equal(ringRatio(0,0),0); assert.equal(ringRatio(2,0),0); assert.equal(ringRatio(5,4),1);
  assert.deepEqual(weekCounts([],tasks,week).map(d=>[d.done,d.planned]),Array.from({length:7},()=>[0,0]));
  assert.equal(JSON.stringify({blocks,tasks}),before);
  console.log("PASS M2-3: seven counts, exclusions, empty/overflow ratio and purity");
})().catch(error=>{console.error(error);process.exitCode=1;});
