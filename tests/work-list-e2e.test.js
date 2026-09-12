const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,launchOptions,startServer,randomPort,STATE_KEY,passGithubGate}=require('./helpers');
const DAY='2026-09-06';
const checked={workflows:0,layouts:0};
(async()=>{
 let server,browser;
 try {
  server=startServer(randomPort());browser=await chromium.launch(launchOptions());
  const page=await browser.newPage({viewport:{width:1280,height:844},serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('PAGEERROR: '+e.message);});
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='localhost'?r.continue():r.abort());
  await page.clock.setFixedTime(new Date(2026,8,6,10,30));
  await page.goto('http://localhost:'+server.address().port+'/');await passGithubGate(page);
  await page.evaluate(({key,day})=>{
   const s=JSON.parse(localStorage.getItem(key));
   s.currentView='today';s.selectedDate=day;s.settings.lastOpenedDate=day;s.settings.autoSync=false;s.settings.github.autoSave=false;
   s.projects=[{id:'fixture-project',title:'隔離Project',kind:'project',status:'active',category:'作業',deleted:false}];
   s.tasks=Array.from({length:300},(_,i)=>({id:'task-'+i,title:'対象Task '+String(i).padStart(3,'0'),projectId:'fixture-project',parentTaskId:'',status:i===0?'completed':'active',deleted:false,kind:'task',estimateMin:15,dueDate:day,description:i===299?'最後の固有メモ':'通常のメモ',doneCriteria:i===298?'特別な完了条件':'',order:i*1000,progressNum:0,progressDen:10}));
   s.blocks=s.tasks.map((t,i)=>({id:'block-'+i,taskId:t.id,title:t.title,date:day,plannedStartAt:day+'T'+String(Math.floor(i/60)).padStart(2,'0')+':'+String(i%60).padStart(2,'0'),plannedEndAt:'',actualStartAt:i===0?day+'T00:00':'',actualEndAt:i===0?day+'T00:15':'',completed:i===0,deleted:false,category:'作業',estimateMin:15,charge:0,discharge:0,comment:''}));
   s.blocks.push({id:'future-done',title:'未来完了',date:'2026-09-07',completed:true,deleted:false,category:'生活'});
   Object.assign(s.blocks[1],{actualStartAt:day+'T00:01',actualEndAt:day+'T00:16'});
   s.recurrences=[];s.journals[day]='架空の本文';s.settings.wbsHideCompleted=false;
   localStorage.setItem(key,JSON.stringify(s));localStorage.removeItem('taskchute-journal-today-focus-v1');
  },{key:STATE_KEY,day:DAY});
  await page.reload();await page.locator('[data-work-list="today"]').waitFor();await page.waitForLoadState('networkidle');
  for(const scope of (process.env.WORK_LIST_SCOPES ?? 'today,exec,wbs').split(',').filter(Boolean)) {
   const listScope=scope==='wbs'?'wbs-tasks-fixture-project':scope;
   if(scope!=='today') {await page.locator(`#sidebar [data-action="nav"][data-view="${scope}"]`).click();if(scope==='wbs') await page.locator('[data-action="wbs-select-project"][data-id="fixture-project"]').click();await page.locator(`[data-work-list="${listScope}"]`).waitFor();}
   const root=page.locator(`[data-work-list="${listScope}"]`),rows=root.locator('[data-work-list-rows]'),query=root.locator('[data-work-filter="query"]');
   if(scope==='wbs') await page.locator('[data-action="wbs-select-project"][data-id="fixture-project"]').click();
   const total=300;
   assert.equal(await rows.locator('[data-work-key]').count(),total,scope+' all rows');
   if(scope==='wbs')assert.equal(await rows.locator('[data-work-key^="task:task-"]').count(),300,'selected Project has all 300 fixture Tasks and no other Project Tasks');
   await query.fill('最後の固有メモ');assert.equal(await rows.locator('[data-work-key]').count(),1);
   assert((await rows.textContent()).includes('299'));
   await query.fill('特別な完了条件');assert.equal(await rows.locator('[data-work-key]').count(),1);
   await query.fill('存在しない');assert.equal(await rows.locator('[data-work-key]').count(),0);
   await root.locator('[data-action="work-list-clear"]').click();
   await query.fill('対象');
   const beforeComposition=await rows.locator('[data-work-key]').count();
   await query.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='最後の固有メモ';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
   assert.equal(await rows.locator('[data-work-key]').count(),beforeComposition,'composition defers result rendering');
   await query.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
   assert.equal(await rows.locator('[data-work-key]').count(),1,'composition commits result');
   await query.fill('対象');
   await query.evaluate(el=>{window.__listInput=el;el.setSelectionRange(1,2);el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'にほんご'}));});
   await page.clock.runFor(1100);
   assert(await query.evaluate(el=>el===window.__listInput&&document.activeElement===el&&el.selectionStart===1&&el.selectionEnd===2),'tick preserves '+scope+' IME input');
   await query.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
   await rows.evaluate(el=>el.scrollTop=el.scrollHeight);
   const scrolledTop=await rows.evaluate(el=>el.scrollTop);
   await query.evaluate(el=>el.dispatchEvent(new Event('change',{bubbles:true})));
   assert.equal(await rows.evaluate(el=>el.scrollTop),scrolledTop,'unchanged native change must not reset scroll');
   // v390(3段-01、設計06 §3 の契約追随・監督者 2026-09-12): today/exec は予定・実績などの群([data-screen-group])に分けて並べるため
   // 「時刻順の一列で block-299 が末尾」は旧契約。末尾まで届くことの検査は「容器内で最後に描画された行」に対して行う(wbs は従来どおり task-299)。
   const last=scope==='wbs'?rows.locator('[data-work-key="task:task-299"]'):rows.locator('[data-work-key]').last();
   const reachable=await last.evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('[data-work-list-rows]').getBoundingClientRect();return r.top<p.bottom&&r.bottom>p.top;});
   assert(reachable,'last row scroll reachable '+scope);
   if(scope==='wbs') {
    const top=await rows.evaluate(el=>el.scrollTop);
    await page.evaluate(()=>{window.__searchClicks=[];document.addEventListener('click',e=>window.__searchClicks.push({action:e.target.closest('[data-action]')?.dataset.action,id:e.target.closest('[data-action]')?.dataset.id}),true);});
    await last.locator('.wbs-task-title[data-action="edit-task"]').click();
    console.log('WBS EDIT SNAPSHOT '+JSON.stringify(await page.evaluate(async()=>({clicks:window.__searchClicks,modal:(await import('/src/state/store.js')).state.modal,html:document.querySelector('#modalRoot').innerHTML.slice(0,180),active:document.activeElement?.outerHTML.slice(0,180)}))));
    assert.deepEqual(errors,[],'edit must not throw');
    await page.locator('[data-modal-field="title"]').fill('対象Task 299 編集後');
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForFunction(()=>document.querySelector('#modalRoot')&&!document.querySelector('#modalRoot').classList.contains('open'));
    assert.equal(await query.inputValue(),'対象');
    assert(Math.abs((await rows.evaluate(el=>el.scrollTop))-top)<3,'save restores WBS list scroll');
    await last.locator('.wbs-task-title[data-action="edit-task"]').click();await page.locator('[data-action="modal-close"]').first().click();
    await page.waitForFunction(()=>document.activeElement?.closest('[data-work-key]')?.dataset.workKey==='task:task-299');
    assert.equal(await query.inputValue(),'対象');
    assert(Math.abs((await rows.evaluate(el=>el.scrollTop))-top)<3,'cancel keeps WBS scroll');
   }
   await root.locator('[data-action="work-list-clear"]').click();
   await root.locator('[data-work-filter="status"]').selectOption('completed');
   assert.equal(await rows.locator('[data-work-key]').count(),1,scope+' completed only');
   await root.locator('[data-action="work-list-clear"]').click();
   if(scope==='exec') {
    const ended=rows.locator('[data-work-key="block:block-1"]');
    assert((await ended.textContent()).includes('終了・未完了'));
    assert.equal(await ended.locator('[data-action="now-start"]').count(),0,'ended row cannot restart its actual time');
    const endedTitle=ended.locator('button[data-action="edit-block"]').first();
    await endedTitle.click(); await page.locator('[data-action="modal-close"]').first().click();
    await page.waitForFunction(()=>document.activeElement?.closest('[data-work-key]')?.dataset.workKey==='block:block-1');
    assert(await endedTitle.evaluate(el=>el===document.activeElement),'ended title regains keyboard focus');
    await root.locator('[data-work-filter="mode"]').selectOption('upcoming');
    assert.equal(await rows.locator('[data-work-key]').count(),300);
    assert.equal(await rows.locator('[data-work-key="block:future-done"]').count(),1,'future completed kept');
    assert.equal(await rows.locator('[data-work-key="block:block-0"]').count(),0,'today completed excluded from upcoming');
    await page.locator('[data-action="exec-mode-toggle"][data-mode="actual"]').first().click();
    assert.equal(await page.locator('.exec-row-done').count(),2,'actual keeps ended but incomplete');
    assert((await page.locator('.exec-pane-left').textContent()).includes('終了・未完了'));
    await page.locator('[data-action="exec-mode-toggle"][data-mode="plan"]').first().click();
   }
   console.log('PASS '+scope+' all/search/zero/IME/scroll/filter');
   checked.workflows++;
  }
  // The selected timeline date must not redefine Today or Upcoming.
  await page.evaluate(async()=>{(await import('/src/state/store.js')).state.selectedDate='2026-09-05';});
  for(const scope of ['today','exec']) {
   const listScope=scope;
   await page.locator(`#sidebar [data-action="nav"][data-view="${scope}"]`).evaluate(el=>el.click());
   const root=page.locator(`[data-work-list="${listScope}"]`);
   if(scope==='exec') await root.locator('[data-work-filter="mode"]').selectOption('today');
   await root.locator('[data-action="work-list-clear"]').click();
   // v390(3段-01、設計06 §3.2/§3.3 の契約追随・監督者 2026-09-12): 今日は実時計の今日(300件のまま)、実行の一覧は選択日
   // (2026-09-05 には固定資料の Block が無いので 0 件)。旧期待「実行も選択日を無視して今日を出す」は一方だけを出す旧画面の契約。
   assert.equal(await root.locator('[data-work-key]').count(),scope==='today'?300:0,scope==='today'?'today uses real today when timeline date differs':'exec follows the selected timeline date');
  }
  await page.evaluate(async()=>{(await import('/src/state/store.js')).state.selectedDate= '2026-09-06';});
  const output=process.env.WORK_LIST_EVIDENCE_DIR;if(output)fs.mkdirSync(output,{recursive:true});
  for(const width of (process.env.WORK_LIST_WIDTHS??'390,768,1024,1280').split(',').filter(Boolean).map(Number)) {
   await page.setViewportSize({width,height:width===1024?768:844});
   for(const scope of ['today','exec','wbs']) {
    const listScope=scope==='wbs'?'wbs-tasks-fixture-project':scope;
    await page.locator(`#sidebar [data-action="nav"][data-view="${scope}"]`).evaluate(el=>el.click());
    await page.locator(`[data-work-list="${listScope}"]`).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+scope+' '+width);
    // fixV392 / 設計06 §7: 今日1024pxは縦、1280pxから予定/記録の2列。
    if(scope==='today') {
     const columns=await page.evaluate(()=>{const a=document.querySelector('#dailyTodayPlans').getBoundingClientRect(),b=document.querySelector('.daily-today-records').getBoundingClientRect();return {stacked:b.top>=a.bottom&&Math.abs(a.x-b.x)<2,sideBySide:b.x>=a.right&&Math.abs(a.y-b.y)<2};});
     assert(width<1280?columns.stacked:columns.sideBySide,'Today planned/record layout '+width);
     assert(await page.evaluate(()=>document.querySelector('[data-action="today-plans-jump"]').getBoundingClientRect().top<document.querySelector('[data-work-list="today"]').getBoundingClientRect().top),'plans jump precedes Today list');
    }
    if(width===1024&&scope==='exec') assert(await page.locator('.exec-pane-right').isVisible(),'1024 execution timeline accessible');
    if(output)await page.screenshot({path:path.join(output,`${scope}-${width}.png`),fullPage:true});
    checked.layouts++;
   }
  }
  assert.deepEqual(errors,[],'no pageerror');
  console.log(`PASS work-list E2E: ${checked.workflows} workflows, ${checked.layouts} layout screens; desktop emulation only`);
 } finally {
  try {if(browser)await browser.close();}
  finally {if(server)await new Promise(resolve=>server.close(resolve));}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
