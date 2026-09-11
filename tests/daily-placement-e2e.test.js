const assert=require('node:assert/strict');
(async()=>{
  const {runDailyOperation}=await import('../src/features/daily-operations.js');
  const {commitCandidate}=await import('../src/core/commit.js');
  const {contentKey}=await import('../src/core/single-schedule-merge.js');
  const {plannedAvailability,displayPlannedGaps,gapWarning,capturePlannedDraft,validatePlannedDraft,draftPlannedIntervals}=await import('../src/features/daily-gap-placement.js');
  const date='2026-09-11',stamp=`${date}T10:00:00`;
  const appSource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
  const computeSource=appSource.match(/function computeFreeGaps\([^]*?\n\}/)[0];
  const gapState={singleSchedules:[],blocks:[{id:'a',date,plannedStartAt:`${date}T09:00`,plannedEndAt:`${date}T10:00`}]};
  const computeFreeGaps=new Function('state','plannedAvailability','displayPlannedGaps',`${computeSource};return computeFreeGaps;`)(gapState,plannedAvailability,displayPlannedGaps);
  assert.deepEqual(computeFreeGaps(date,540,1080),[[600,1080]]);
  gapState.blocks.push({id:'old',date:'2026-01-05',plannedStartAt:'2026-01-06T09:00',plannedEndAt:'2026-01-06T10:00'});
  assert.deepEqual(computeFreeGaps(date,540,1080),[[600,1080]],'unrelated historical Block cannot erase today gaps');
  gapState.blocks.push({id:'bad-today',date,plannedStartAt:'bad'});
  assert.deepEqual(computeFreeGaps(date,540,1080),[[600,1080]],'display excludes invalid same-day rows');
  assert.ok(plannedAvailability(gapState,date).error,'manual placement still stops on same-day invalid rows');
  // Run the actual legacy confirm function with the production save boundary.
  const {createDraftSaveTransaction}=await import('../src/features/draft-save.js');
  const confirmSource=appSource.match(/function confirmScheduleDraft\(\) \{[^]*?\n\}/)[0];
  const legacy=new Function('createDraftSaveTransaction','validatePlannedDraft','gapWarning','date','stamp',`
    let state={blocks:[],singleSchedules:[],tasks:[]},allowSave=false,created=0,synced=0;
    let _scheduleDraft={date,items:[{id:'draft-new',title:'new',start:600,minutes:30}]},_draftUndo={marker:'keep'};
    const attempted=[];
    const draftSaveTransaction=createDraftSaveTransaction({getState:()=>state,setState:value=>state=value,
      persist:()=>{attempted.push(state.blocks.map(row=>row.id));return allowSave;},now:()=>stamp,
      schedule:()=>synced++,onFailure:()=>{}});
    const makeBlock=values=>({id:'legacy-'+(++created),createdAt:stamp,updatedAt:stamp,...values});
    const nowDateTime=()=>stamp,minToHHMM=value=>String(value),showToast=()=>{};
    const saveAndRender=()=>draftSaveTransaction.complete();
    ${confirmSource}
    return {confirm:confirmScheduleDraft,retry:()=>{allowSave=true;},
      read:()=>({state,draft:_scheduleDraft,undo:_draftUndo,attempted,created,synced})};
  `)(createDraftSaveTransaction,validatePlannedDraft,gapWarning,date,stamp);
  assert.equal(legacy.confirm(),false);
  let legacyResult=legacy.read();
  assert.equal(legacyResult.state.blocks.length,0);assert.equal(legacyResult.synced,0);
  assert.equal(legacyResult.draft.items[0].candidateBlock.id,legacyResult.attempted[0][0]);
  assert.deepEqual(legacyResult.undo,{marker:'keep'});
  legacy.retry();assert.equal(legacy.confirm(),true);legacyResult=legacy.read();
  assert.deepEqual(legacyResult.attempted,[['legacy-1'],['legacy-1']]);
  assert.equal(legacyResult.created,1);assert.equal(legacyResult.state.blocks.length,1);
  assert.equal(legacyResult.draft,null);assert.equal(legacyResult.undo,null);assert.equal(legacyResult.synced,1);
  legacy.confirm();assert.equal(legacy.read().state.blocks.length,1,'repeat confirm cannot duplicate saved candidate');
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
    f=>{f.state.blocks.push({id:'bad',date,plannedStartAt:'bad'});},f=>{f.deps.draftIntervals=()=>[{id:'bad'}];},
    f=>{f.deps.draftIntervals=()=>null;},f=>{f.state.blocks={};}
  ]){
    f=fixture();i=f.input('task');setup(f);const before=JSON.stringify(f.state);
    assert.equal(f.run(i).status,'invalid');assert.equal(JSON.stringify(f.state),before);assert.equal(f.counts().saved,0);
  }
  const full={...schedule,plannedStartAt:`${date}T00:00:00`,plannedEndAt:'2026-09-12T00:00:00'};
  assert.deepEqual(plannedAvailability({blocks:[],singleSchedules:[full]},date).gaps,[]);
  f=fixture();f.state.blocks.push({...source});assert.equal(f.run(f.input()).status,'invalid');
  f=fixture();
  const draft=capturePlannedDraft(f.state,{date,items:[{id:'draft',blockId:'unset',start:600,minutes:30}]});
  assert.equal(validatePlannedDraft(f.state,draft).error,'');
  assert.equal(validatePlannedDraft(f.state,{...draft,items:[{...draft.items[0],start:660}]}).error.length>0,true);
  f.state.blocks[0].estimateMin=45;assert.match(validatePlannedDraft(f.state,draft).error,/更新/);
  f=fixture();assert.ok(validatePlannedDraft(f.state,{date,items:[{id:'one',start:600,minutes:30},{id:'two',start:615,minutes:30}]}).error);
  const midnight={date,items:[{id:'midnight',start:1410,minutes:30}]};
  assert.equal(validatePlannedDraft(f.state,midnight).error,'');
  assert.equal(draftPlannedIntervals(midnight)[0].plannedEndAt,'2026-09-12T00:00');
  assert.ok(validatePlannedDraft(f.state,{date,items:[{id:'bad',start:200,minutes:30}]}).error);
  assert.ok(validatePlannedDraft(f.state,{date,items:[{id:'bad',start:600,minutes:5}]}).error);
  const past='2026-09-10';f=fixture();f.state.selectedDate=past;f.state.blocks[0].date=past;
  assert.equal(f.run(f.input('block',{date:past})).ok,true);assert.equal(f.state.blocks[0].plannedStartAt,`${past}T10:00:00`);
  const {chromium,launchOptions,startServer,randomPort,blockGithubApiByDefault,passGithubGate,STATE_KEY}=require('./helpers');
  const server=startServer(randomPort()),browser=await chromium.launch(launchOptions());
  try{
    const page=await browser.newPage({timezoneId:'Asia/Tokyo',locale:'ja-JP',serviceWorkers:'block'});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await blockGithubApiByDefault(page);await page.clock.setFixedTime(new Date(2026,8,11,10));
    await page.goto(`http://localhost:${server.address().port}/`);await passGithubGate(page);
    const cover={id:'cover',date,title:'occupied Block',plannedStartAt:`${date}T04:00:00`,plannedEndAt:`${date}T10:00:00`,completed:true};
    const rows=[{...schedule,plannedEndAt:'2026-09-12T00:00:00'},{id:'invalid'}];
    const seed=async(extra={})=>{
      await page.evaluate(({key,values})=>{
        const state=JSON.parse(localStorage.getItem(key));Object.assign(state,values);localStorage.setItem(key,JSON.stringify(state));
      },{key:STATE_KEY,values:{currentView:'exec',selectedDate:date,blocks:[{...source},cover],tasks:[{...task,estimateMin:null}],
        projects:[],recurrences:[],singleSchedules:rows,...extra}});
      await page.reload();await page.waitForSelector('[data-action="daily-gap-choose"]');
    };
    const read=()=>page.evaluate(async()=>{const {state}=await import('/src/state/store.js');return JSON.parse(JSON.stringify(state));});
    const open=async()=>{
      await page.locator('[data-action="daily-gap-choose"]').click();
      await page.locator('.planned-gap-picker [data-start="10:00"][data-end="11:00"]').click();
      await page.waitForSelector('.fill-gap-sheet');
    };
    for(const width of [1280,390]){
      await page.setViewportSize({width,height:900});await seed();
      const initial=JSON.stringify((await read()).blocks);await open();
      assert.match(await page.locator('.fill-gap-sheet').innerText(),/不正な単発予定1件/);
      assert.equal(JSON.stringify((await read()).blocks),initial,'opening does not create or change Blocks');
      await page.locator('.fill-gap-sheet [data-action="fill-gap-place"][data-id="unset"]').click();
      await page.waitForSelector('.fill-gap-sheet',{state:'detached'});
      let state=await read();assert.equal(state.blocks.length,2);
      assert.equal(state.blocks.find(row=>row.id==='unset').plannedStartAt,`${date}T10:00:00`);
      assert.equal(state.blocks.find(row=>row.id==='unset').plannedEndAt,`${date}T10:30:00`);
      await seed();await open();await page.locator('#fillGapProject').selectOption('task');
      await page.locator('.fill-gap-sheet [data-action="fill-gap-create"]').click();
      assert.equal((await read()).blocks.length,2,'missing estimate requires an explicit duration');
      assert.equal(await page.locator('#fillGapProject').inputValue(),'task');
      await page.locator('#fillGapLength').fill('20');
      // Failure does not replace the sheet or its inputs, and the retry keeps one candidate ID.
      await page.evaluate(key=>{
        window.originalGapSet=Storage.prototype.setItem;
        Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('fixture quota','QuotaExceededError');return window.originalGapSet.call(this,k,v);};
      },STATE_KEY);
      await page.locator('.fill-gap-sheet [data-action="fill-gap-create"]').click();
      assert.equal((await read()).blocks.length,2);assert.equal(await page.locator('#fillGapLength').inputValue(),'20');
      await page.evaluate(()=>{Storage.prototype.setItem=window.originalGapSet;});
      await page.locator('.fill-gap-sheet [data-action="fill-gap-create"]').dblclick();
      await page.waitForSelector('.fill-gap-sheet',{state:'detached'});
      state=await read();assert.equal(state.blocks.length,3);
      const created=state.blocks.find(row=>row.id!=='cover'&&row.id!=='unset');
      assert.equal(created.taskId,'task');assert.equal(created.plannedEndAt,`${date}T10:20:00`);
      assert.equal(state.tasks[0].estimateMin,null);
      await page.reload();await page.waitForSelector('[data-action="daily-gap-choose"]');
      state=await read();assert.equal(state.blocks.filter(row=>row.id===created.id).length,1);
      assert.deepEqual(state.singleSchedules.find(row=>row.id==='invalid'),{id:'invalid'});
      await seed();await open();await page.locator('#fillGapProject').selectOption('task');await page.locator('#fillGapLength').fill('20');
      await page.evaluate(({date})=>import('/src/state/store.js').then(({state})=>{
        state.singleSchedules.push({id:'late',date,title:'late conflict',plannedStartAt:`${date}T10:45:00`,plannedEndAt:`${date}T11:00:00`});
      }),{date});
      await page.locator('.fill-gap-sheet [data-action="fill-gap-create"]').click();
      assert.equal((await read()).blocks.length,2);assert.equal(await page.locator('#fillGapLength').inputValue(),'20');
      assert.equal(await page.locator('#fillGapProject').inputValue(),'task');
      await page.locator('.fill-gap-sheet .modal-close').click();
      await seed();await open();await page.locator('#fillGapProject').selectOption('task');await page.locator('#fillGapLength').fill('20');
      await page.evaluate(date=>import('/src/state/store.js').then(({state})=>{
        state.blocks.push({id:'bad-today',date,plannedStartAt:'bad'});
      }),date);
      await page.locator('.fill-gap-sheet [data-action="fill-gap-create"]').click();
      assert.equal((await read()).blocks.length,3,'invalid same-day Block stops manual creation');
      assert.equal(await page.locator('#fillGapLength').inputValue(),'20');
      assert.equal(await page.locator('#fillGapProject').inputValue(),'task');
      await page.locator('.fill-gap-sheet .modal-close').click();
      await seed();await open();await page.locator('#fillGapProject').selectOption('task');await page.locator('#fillGapLength').fill('20');
      await page.locator('.fill-gap-sheet [data-action="daily-gap-choose"]').click();
      await page.locator('[data-action="draft-leave-stay"]').click();
      assert.equal(await page.locator('#fillGapLength').inputValue(),'20');
      await page.evaluate(key=>{
        window.originalGapSet=Storage.prototype.setItem;
        Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('fixture quota','QuotaExceededError');return window.originalGapSet.call(this,k,v);};
      },STATE_KEY);
      await page.locator('.fill-gap-sheet [data-action="daily-gap-choose"]').click();await page.locator('[data-action="draft-leave-save"]').click();
      assert.equal((await read()).blocks.length,2);assert.equal(await page.locator('#fillGapLength').inputValue(),'20');
      assert.equal(await page.locator('.planned-gap-picker').count(),0,'failed save cannot leave the owner');
      await page.evaluate(()=>{Storage.prototype.setItem=window.originalGapSet;});
      await page.locator('.fill-gap-sheet [data-action="daily-gap-choose"]').click();await page.locator('[data-action="draft-leave-discard"]').click();
      await page.waitForSelector('.planned-gap-picker');assert.equal((await read()).blocks.length,2);
      await page.locator('.planned-gap-picker [data-start="10:00"]').click();
      await page.locator('#fillGapProject').selectOption('task');await page.locator('#fillGapLength').fill('20');
      await page.locator('.fill-gap-sheet [data-action="daily-gap-choose"]').click();await page.locator('[data-action="draft-leave-save"]').click();
      await page.waitForSelector('.planned-gap-picker [data-start="10:20"]');assert.equal((await read()).blocks.length,3);
      // A native row fixture uses the exact common-row owner/field contract in the live app.
      await seed();await page.evaluate(()=>{
        const row=document.createElement('div');row.id='inline-gap-fixture';row.dataset.dailyKey='block:unset';
        row.innerHTML='<input type="time" step="300" data-daily-field="start" style="font-size:16px"><input type="time" step="300" data-daily-field="end" style="font-size:16px">';document.body.append(row);
      });
      const inlineStart=page.locator('#inline-gap-fixture [data-daily-field="start"]'),inlineEnd=page.locator('#inline-gap-fixture [data-daily-field="end"]');
      await inlineStart.fill('10:00');await page.locator('[data-action="daily-gap-choose"]').click();
      await page.locator('[data-action="draft-leave-save"]').click();
      assert.equal(await inlineStart.inputValue(),'10:00');assert.equal(await page.locator('.planned-gap-picker').count(),0);
      assert.equal((await read()).blocks.find(row=>row.id==='unset').plannedStartAt,'');
      await inlineEnd.fill('10:30');await page.locator('[data-action="daily-gap-choose"]').click();
      await page.locator('[data-action="draft-leave-discard"]').click();await page.waitForSelector('.planned-gap-picker');
      assert.equal(await inlineStart.inputValue(),'');assert.equal((await read()).blocks.find(row=>row.id==='unset').plannedStartAt,'');
      await page.locator('.planned-gap-picker .modal-close').click();
      await inlineStart.fill('10:00');await inlineEnd.fill('10:30');await page.locator('[data-action="daily-gap-choose"]').click();
      await page.locator('[data-action="draft-leave-save"]').click();await page.waitForSelector('.planned-gap-picker [data-start="10:30"]');
      assert.equal((await read()).blocks.find(row=>row.id==='unset').plannedEndAt,`${date}T10:30:00`);
      await page.evaluate(()=>document.querySelector('#inline-gap-fixture').remove());
      console.log(`PASS common leave guard ${width}: stay, discard, save/recompute, failed/invalid save retains sheet and inline inputs`);
      await seed({singleSchedules:[full]});await page.locator('[data-action="daily-gap-choose"]').click();
      assert.match(await page.locator('.planned-gap-picker').innerText(),/配置できる空き時間がありません/);
      assert.equal(await page.locator('.planned-gap-picker [data-action="fill-gap-open"]').count(),0);
      assert.ok(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      console.log(`PASS browser planned placement ${width}: same/new ID, explicit length, failure/retry, full-gap recheck, invalid preservation, all-day occupied`);
    }
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
  console.log('PASS gap registry: identity, latest full-gap check, invalid/container/load failure stops, unchanged source, retry, calendar');
})().catch(error=>{console.error(error);process.exitCode=1;});
