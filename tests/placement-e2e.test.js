const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,launchOptions,startServer,randomPort,STATE_KEY,passGithubGate}=require('./helpers');
(async()=>{
 const server=startServer(randomPort());let browser;
 try {
  console.log('STEP browser launch');
  browser=await chromium.launch({...launchOptions(),timeout:60000});
  console.log('STEP browser ready');
  const page=await browser.newPage({viewport:{width:1280,height:844},timezoneId:'Asia/Tokyo',locale:'ja-JP',serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('PAGEERROR '+e.message);});
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='localhost'?r.continue():r.abort());
  await page.clock.setFixedTime(new Date(2026,8,6,10,30));
  await page.goto('http://localhost:'+server.address().port+'/');await passGithubGate(page);
  console.log('STEP app ready');
  const state=()=>page.evaluate(async()=>JSON.parse(JSON.stringify((await import('/src/state/store.js')).state)));
  const placed=async id=>(await state()).blocks.filter(b=>!b.deleted&&b.taskId===id&&b.date==='2026-09-06');
  const nav=async view=>{
   const direct=page.locator(`#bottomNav [data-view="${view}"]:visible, #sidebar [data-view="${view}"]:visible`).first();
   if(await direct.count()) await direct.click();
   else {await page.locator('#bottomNav [data-view="more"]:visible, #sidebar [data-view="more"]:visible').first().click();await page.locator(`.more-tower-grid [data-view="${view}"]`).click();}
  };
  for(const width of [390,768,1024,1280]) {
  await page.setViewportSize({width,height:844});
  for(const source of ['wbs','wish']) {
   await page.evaluate(({key,source})=>{
    Object.keys(sessionStorage).filter(key=>key.startsWith('taskchute-journal-placement-v1:')).forEach(key=>sessionStorage.removeItem(key));
    const s=JSON.parse(localStorage.getItem(key));s.currentView=source;s.selectedDate='2020-01-01';
    s.settings.lastOpenedDate='2026-09-06';s.settings.autoSync=false;s.settings.github.autoSave=false;
    s.projects=[{id:'p',title:'配置検査Project',kind:'project',status:'active',collapsed:false},
      {id:'wish',title:'Wish',kind:'wish',status:'active',collapsed:false}];
    s.tasks=[{id:'root',title:'配置検査Wish',projectId:'wish',parentTaskId:'',status:'active',collapsed:false},
      ...['a','b','c'].map(id=>({id:source+'-'+id,title:'配置検査 '+id,projectId:source==='wish'?'wish':'p',parentTaskId:source==='wish'?'root':'',status:'active',estimateMin:30,collapsed:false}))];
    s.wishOpenId='root';s.blocks=[{id:'future',taskId:source+'-a',date:'2026-09-07',title:'未来の同じTask',completed:false}];s.recurrences=[];
    localStorage.setItem(key,JSON.stringify(s));
   },{key:STATE_KEY,source});
   await page.reload();await page.waitForLoadState('networkidle');
   // Startup intentionally opens actual today; choose the browsing date through real UI afterwards.
   const browseSource=async()=>{
    await nav('exec');
    await page.locator('[data-date-picker]').fill('2020-01-01');
    await page.waitForFunction(async () => (await import('/src/state/store.js')).state.selectedDate === '2020-01-01');
    await nav(source);
    assert.equal((await state()).selectedDate,'2020-01-01','source browsing date established after startup');
   };
   await browseSource();
   console.log('STEP source '+source);
   if(source==='wbs') await page.locator('[data-action="wbs-select-project"][data-id="p"]').click();
   const action=source==='wish'?'wish-subtask-to-tasks':'task-today';
   const open=async (id, entryAction=action)=>{await page.locator(`[data-action="${entryAction}"][data-id="${id}"]`).click();await page.locator("#modalRoot").evaluate(async root=>{await Promise.all(root.getAnimations({subtree:true}).map(animation=>animation.finished));});};
   if(source==='wbs') {
    for(const suffix of ['a','b','c']) {
     const id=source+'-'+suffix;
     await open(id);
     assert.match(await page.locator('#modalRoot').textContent(),/今日の予定を追加/);
     assert.equal(await page.locator('.placement-form strong').textContent(),'2026-09-06');
     assert.equal(await page.locator('#placement-time, #placement-duration').count(),0,'WBS has no time inputs');
     const save=page.locator('.modal-footer [data-action="modal-save"]');
     const box=await save.boundingBox();
     assert(box && box.x>=0 && box.x+box.width<=width+1 && box.y>=0 && box.y+box.height<=844 && box.height>=44,`WBS confirm reachable at ${width}`);
     await page.locator('.modal-footer [data-action="modal-close"]').click();
     assert.equal((await state()).modal,null,'cancel closes confirmation');
     assert.equal((await placed(id)).length,0,'cancel creates none');
     await open(id);
     await save.click();
     const first=await placed(id);
     assert.equal(first.length,1);
     for(const field of ['plannedStartAt','plannedEndAt','actualStartAt','actualEndAt']) assert.equal(first[0][field],'');
     assert.equal(first[0].completed,false);
     assert.equal((await state()).currentView,'wbs');
     assert.equal((await state()).selectedDate,'2020-01-01','untimed save preserves browsing date');
      await open(id,'placement-add-today');
      assert.equal((await state()).modal.id,first[0].id,'reopen shows existing result');
     const replay=await page.evaluate(async id=>{
      const {state}=await import('/src/state/store.js');
      const {commitPlacement}=await import('/src/features/placement.js');
      const key=Object.keys(sessionStorage).find(key=>key.startsWith('taskchute-journal-placement-v1:') && JSON.parse(sessionStorage.getItem(key)).block.taskId===id);
      const request=JSON.parse(sessionStorage.getItem(key));let writes=0;
      const ok=commitPlacement(state,{request,today:'2026-09-06',connection:request.connection},{now:'2026-09-06T10:30:00',persist:()=>{writes++;return true;}});
      return {ok,writes};
     },id);
     assert.deepEqual(replay,{ok:true,writes:0},'same request reconfirmation does not write');
     assert.equal((await placed(id)).length,1,'reconfirmation remains one Block');
     await page.locator('[data-action="placement-edit"]').click();
     assert.equal((await state()).modal.type,'block','existing editor remains accessible');
     await page.locator('[data-modal-field="plannedStartAt"]').fill('2026-09-06T11:45');
     await page.locator('[data-modal-field="plannedEndAt"]').fill('2026-09-06T12:15');
     await page.locator('.modal-footer [data-action="modal-save"]').click();
     assert.equal((await placed(id))[0].plannedStartAt,'2026-09-06T11:45:00');
     assert.equal((await placed(id)).length,1,'editing never adds a Block');
     await browseSource();
     console.log('PASS wbs untimed/cancel/reconfirm/editor '+width+' '+suffix);
    }
   } else {
   for(const [suffix,time,end] of [['a','11:40','2026-09-06T12:10'],['b','18:15','2026-09-06T18:45'],['c','23:50','2026-09-07T00:20']]) {
    const id=source+'-'+suffix;
    console.log('STEP open '+id+' '+time);
    await open(id);
    for(const field of ['#placement-time','#placement-duration']){
     const box=await page.locator(field).boundingBox();
     console.log("FIELD_STABLE",width,field,JSON.stringify(box),await page.locator(field).evaluate(el=>({height:getComputedStyle(el).height,minHeight:getComputedStyle(el).minHeight})));
     assert(box && box.x>=0 && box.x+box.width<=width+1 && box.height>=44,`${field} reachable at ${width}`);
    }
    assert((await page.locator('.placement-form').textContent()).includes('2026-09-06'));
    assert.equal(await page.locator('#placement-time').inputValue(),'');
    assert.equal((await placed(id)).length,0);
    await page.locator('[data-action="modal-save"]').click();
    assert.equal((await placed(id)).length,0,'empty time creates none');
    assert((await page.locator('#placement-error').textContent()).includes('開始時刻'));
    await page.locator('#placement-time').fill(time);
    assert((await page.locator('#placement-end').textContent()).includes(end.replace('T',' ')));
    await page.locator('.modal-footer [data-action="modal-close"]').click();
    await page.locator('.draft-leave-dialog').waitFor();
    await page.locator('[data-action="draft-leave-stay"]').click();
    assert.equal(await page.locator('#placement-time').inputValue(),time,'stay retains draft');
    assert.equal((await placed(id)).length,0,'stay does not persist');
    await page.locator('.modal-footer [data-action="modal-close"]').click();
    await page.locator('[data-action="draft-leave-discard"]').click();
    assert.equal(await page.locator('#modalRoot').evaluate(n=>n.classList.contains('open')),false,'discard closes original placement modal');
    assert.equal((await placed(id)).length,0,'cancel creates none');
    await open(id);await page.locator('#placement-time').fill(time);
    if(suffix==='a') {
      await page.evaluate(()=>{window.__placementSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('fixture quota','QuotaExceededError');};});
      await page.locator('[data-action="modal-save"]').click();
      assert.equal((await placed(id)).length,0,'failed persistence must roll back');
      assert.equal(await page.locator('#placement-time').inputValue(),time);
      assert((await page.locator('#placement-error').textContent()).includes('保存に失敗'));
      await page.evaluate(()=>{Storage.prototype.setItem=window.__placementSetItem;});
    }
    await page.locator('[data-action="modal-save"]').click();
    const first=(await placed(id));assert.equal(first.length,1);assert.equal(first[0].plannedStartAt,'2026-09-06T'+time);assert.equal(first[0].plannedEndAt,end);
    assert.equal((await state()).currentView,source==='wish'?'exec':'today');
    await page.locator('[data-action="placement-return"]').click();
    assert.equal((await state()).selectedDate,'2020-01-01');assert.equal((await state()).currentView,source);
    await open(id);assert.equal((await state()).modal.id,first[0].id);assert.equal((await placed(id)).length,1);
    await page.locator('[data-action="placement-edit"]').click();
    assert.equal((await state()).modal.id,first[0].id);assert.equal((await state()).modal.type,'block');
    const start=page.locator('[data-modal-field="plannedStartAt"]');
    const revised=time.slice(0,3)+String(Number(time.slice(3))+5).padStart(2,'0');
    await start.fill('2026-09-06T'+revised);await page.locator('[data-action="modal-save"]').click();
    assert.equal((await placed(id)).length,1);
    assert.equal((await placed(id))[0].plannedStartAt,'2026-09-06T'+revised+':00','existing editor saves a changed time');
    await browseSource();
    console.log('PASS '+source+' '+time+' cancel/empty/confirm/revisit/editor '+first[0].id);
   }
   }
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'viewport horizontal overflow');
  if(process.env.PLACEMENT_EVIDENCE){fs.mkdirSync(process.env.PLACEMENT_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.PLACEMENT_EVIDENCE,`placement-${width}.png`),fullPage:true});}
  }
  assert.deepEqual(errors,[],'pageerror must fail acceptance');
  if(process.env.PLACEMENT_EVIDENCE){fs.mkdirSync(process.env.PLACEMENT_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.PLACEMENT_EVIDENCE,'placement-final.png'),fullPage:true});}
  console.log('PASS placement UI: six actual-time flows at each of 390/768/1024/1280');
 } catch(error) {console.error('ACCEPTANCE FAILED',error);throw error;}
 finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
