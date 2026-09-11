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
  const { chromium, launchOptions, startServer, randomPort, blockGithubApiByDefault, passGithubGate, STATE_KEY } = require('./helpers');
  const server=startServer(randomPort()), browser=await chromium.launch(launchOptions());
  try {
    const page=await browser.newPage({timezoneId:'Asia/Tokyo',locale:'ja-JP',serviceWorkers:'block',viewport:{width:1280,height:900}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await blockGithubApiByDefault(page);
    await page.clock.setFixedTime(new Date(2026,8,11,10));
    await page.goto(`http://localhost:${server.address().port}/`);await passGithubGate(page);
    await page.evaluate(({key,rows,day})=>{
      const state=JSON.parse(localStorage.getItem(key));
      Object.assign(state,{currentView:'today',selectedDate:day,blocks:[],tasks:[],projects:[],recurrences:[],singleSchedules:rows});
      localStorage.setItem(key,JSON.stringify(state));
    },{key:STATE_KEY,rows:[record,early,{id:'invalid'},{...record,id:'deleted',deleted:true}],day});
    await page.reload();
    await page.waitForSelector('.today-single-schedules [data-schedule-id="shared"]');
    const side=()=>page.evaluate(async()=>{
      const {state}=await import('/src/state/store.js');
      return JSON.stringify(Object.fromEntries(['blocks','tasks','declarations','weeklyCommitments','tracks','actualEntries','reports'].map(key=>[key,state[key]])));
    });
    const sideBefore=await side();
    assert.equal(await page.locator('.today-single-schedules [data-schedule-id="shared"]').count(),1);
    assert.match(await page.locator('.today-single-schedules').innerText(),/前日から/);
    assert.match(await page.locator('.today-single-schedules [data-schedule-id="early"]').innerText(),/時間軸外/);
    assert.equal(await page.locator('[data-schedule-id="invalid"], [data-schedule-id="deleted"]').count(),0);
    assert.equal(await page.locator('[data-action="daily-schedule-add"]').count(),0);
    await page.locator('.today-single-schedules [data-schedule-id="shared"] [data-action="schedule-view-complete"]').click();
    await page.waitForSelector('.today-single-schedules [data-schedule-id="shared"][data-completed="true"]');
    await page.locator('.today-single-schedules [data-schedule-id="shared"] [data-action="schedule-view-details"]').click();
    await page.waitForSelector('.single-schedule-detail [data-schedule-id="shared"][data-completed="true"]');
    assert.match(await page.locator('.single-schedule-detail').innerText(),/memo/);
    await page.locator('.single-schedule-detail .modal-close').click();
    await page.locator('.nav-button[data-view="exec"]').click();
    await page.locator('[data-action="exec-mode-toggle"][data-mode="plan"]').click();
    await page.waitForSelector('.timeline-card[data-schedule-id="shared"][data-completed="true"]');
    assert.equal(await page.locator('.exec-pane-left [data-schedule-id]').count(),0,'Task list excludes schedules');
    assert.equal(await page.locator('.timeline .time-row[data-minute="240"]').count(),1);
    const geometry=await page.locator('.timeline-card[data-schedule-id="shared"]').evaluate(el=>({top:el.style.top,opacity:getComputedStyle(el).opacity,transform:el.style.transform}));
    assert.deepEqual(geometry,{top:'0px',opacity:'0.55',transform:''});
    await page.locator('.timeline-card[data-schedule-id="shared"] [data-action="schedule-view-details"]').click();
    await page.waitForSelector('.single-schedule-detail [data-schedule-id="shared"][data-completed="true"]');
    await page.locator('.single-schedule-detail [data-action="schedule-view-complete"]').click();
    await page.waitForSelector('.single-schedule-detail [data-schedule-id="shared"][data-completed="false"]');
    await page.locator('.single-schedule-detail .modal-close').click();
    // Inject actual local persistence failure, then retry the same visible request.
    await page.evaluate(key=>{
      window.savedSetItem=Storage.prototype.setItem;
      Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('fixture quota','QuotaExceededError');return window.savedSetItem.call(this,k,v);};
    },STATE_KEY);
    await page.locator('.timeline-card[data-schedule-id="shared"] [data-action="schedule-view-complete"]').click();
    assert.equal(await page.locator('.timeline-card[data-schedule-id="shared"]').getAttribute('data-completed'),'false');
    const request=await page.locator('.timeline-card[data-schedule-id="shared"] [data-action="schedule-view-complete"]').getAttribute('data-request-id');
    assert.ok(request);
    await page.evaluate(()=>{Storage.prototype.setItem=window.savedSetItem;});
    await page.locator('.timeline-card[data-schedule-id="shared"] [data-action="schedule-view-complete"]').click();
    await page.waitForSelector('.timeline-card[data-schedule-id="shared"][data-completed="true"]');
    assert.equal(await side(),sideBefore,'schedule completion cannot affect tasks, actuals or 12-week records');
    await page.getByRole('button',{name:'実績(タイムライン)',exact:true}).click();
    assert.equal(await page.locator('.timeline [data-schedule-id]').count(),0,'no actual schedule cards');
    await page.reload();
    const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),STATE_KEY);
    assert.equal(saved.singleSchedules.find(row=>row.id==='shared').completed,true);
    assert.equal(saved.singleSchedules.find(row=>row.id==='shared').plannedStartAt,record.plannedStartAt);
    assert.deepEqual(saved.singleSchedules.find(row=>row.id==='invalid'),{id:'invalid'});
    assert.deepEqual(errors,[]);
    console.log('PASS browser today/timeline/details: same ID and completion, failure/retry, no actual/task/12-week side effects');
  } finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
  console.log('PASS single schedule display: same IDs, continuation, completed occupancy, invalid exclusion, outside window, no actual projection');
})().catch(error=>{console.error(error);process.exitCode=1;});
