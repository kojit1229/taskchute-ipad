'use strict';const assert=require('node:assert/strict');const {rejectedRunSettled,waitHeld,ready,run,nav,status,refresh,layout,expose,DATE,PREFIX}=require('./feedback-browser-harness.cjs');
run(async(browser,server)=>{for(const width of [390,768,1024]){const f=await ready(browser,server,width),{page,fixture}=f;try{
 fixture.loseQueueOnce();await f.editor().fill(`synthetic response lost ${width}`);await page.locator('[data-action="feedback-regenerate"]').click();await status(page,'確認が必要');const id=fixture.entries()[0].requestId,requestBefore=fixture.files.get(PREFIX+`requests/${id}.json`),writes=fixture.putCount();assert.equal(fixture.entries()[0].attempt,1);
 await page.locator('[data-action="feedback-resume"]').click();await status(page,'依頼の受付を確認済み');assert.equal(fixture.putCount(),writes,'committed queue response loss resumes by GET, no new PUT');assert.equal(fixture.entries()[0].requestId,id);assert.equal(fixture.entries()[0].attempt,1);assert.equal(fixture.files.get(PREFIX+`requests/${id}.json`),requestBefore);
 fixture.publish('failed');await refresh(page);if(!(await page.locator('.feedback-regeneration > details').evaluate(el=>el.open)))await page.locator('.feedback-regeneration > details > summary').click();await page.locator('[data-action="feedback-retry"]').click();await status(page,'依頼の受付を確認済み');assert.equal(fixture.entries()[0].requestId,id);assert.equal(fixture.entries()[0].attempt,2);assert.equal(fixture.putCount(),writes+1);assert.equal(fixture.files.get(PREFIX+`requests/${id}.json`),requestBefore);
 fixture.publish('succeeded');await refresh(page);if(!(await page.locator('.feedback-regeneration > details').evaluate(el=>el.open)))await page.locator('.feedback-regeneration > details > summary').click();assert.equal(await page.locator('.feedback-regeneration ol>li').count(),2,'both attempts remain');await page.locator('[data-action="feedback-version"]:not([data-feedback-version="original"])').click();const body=await page.locator('.feedback-version-body').textContent();assert(body.includes('synthetic regenerated '+DATE));
 fixture.offline(true);await page.locator('[data-action="feedback-refresh"]').click();await status(page,'確認が必要');assert.equal(await page.locator('.feedback-version-body').textContent(),body);assert.equal(fixture.putCount(),writes+1);fixture.offline(false);
 await page.locator('[data-action="feedback-refresh"]').focus();const y=await page.evaluate(()=>document.scrollingElement.scrollTop);await page.keyboard.press('Enter');await status(page,'処理状況を確認しました');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));const scrollAfter=await page.evaluate(()=>({y:document.scrollingElement.scrollTop,active:document.activeElement?.dataset?.action||document.activeElement?.tagName,open:[...document.querySelectorAll('.feedback-regeneration details')].filter(x=>x.open).length}));console.log('SCROLL_DIAGNOSTIC '+JSON.stringify({width,before:y,...scrollAfter}));assert(Math.abs(scrollAfter.y-y)<=2,'readonly refresh preserves scroll');await layout(page,width,'recovery');
 const detailRows=page.locator('[data-feedback-detail-key^="input:"]');await detailRows.first().evaluate(el=>el.open=true);await detailRows.last().evaluate(el=>el.open=false);await refresh(page);assert.equal(await detailRows.first().evaluate(el=>el.open),true);assert.equal(await detailRows.last().evaluate(el=>el.open),false);
 for(const focusTarget of ['version','summary','outside']){
  const heldRead=fixture.holdNextRead(PREFIX+'queue.json');
  await page.locator('[data-action="feedback-refresh"]').click();await waitHeld(heldRead);
  const selected=focusTarget==='version'?page.locator('[data-action="feedback-version"][data-feedback-version="original"]'):focusTarget==='summary'?page.locator('.feedback-regeneration > details > summary'):f.editor();
  if(focusTarget==='summary'){
   await page.locator('[data-action="feedback-version"][data-feedback-version="original"]').focus();await page.keyboard.press('Tab');
   assert(await selected.evaluate(el=>el===document.activeElement),'Tab actually moves to history summary');
  }else await selected.focus();
  if(focusTarget==='outside')await f.editor().fill('synthetic focus outside preserves input');
  heldRead.release();await status(page,'処理状況を確認しました');
  assert(await selected.evaluate(el=>el===document.activeElement),'new '+focusTarget+' focus survives pending readonly replacement');
  if(focusTarget==='outside')assert.equal(await f.editor().inputValue(),'synthetic focus outside preserves input');
  console.log('FOCUS_DIAGNOSTIC '+JSON.stringify({width,focusTarget,retained:true}));
 }
 for(const motion of ['wheel','Space','outside']){
  const textBefore=await f.editor().inputValue(),heldMotion=fixture.holdNextRead(PREFIX+'queue.json');
  await page.locator('[data-action="feedback-refresh"]').focus();await page.keyboard.press('Enter');await waitHeld(heldMotion);
  assert.equal(await page.evaluate(()=>document.activeElement.tagName),'BODY','disabled refresh physical focus is BODY');
  if(motion==='wheel'){await page.mouse.move(width-60,400);await page.mouse.wheel(0,100);}
  if(motion==='Space')await page.keyboard.press('Space');
  if(motion==='outside')await page.locator('.view-header h1').click();
  heldMotion.release();await page.waitForFunction(()=>!document.querySelector('[data-action="feedback-refresh"]').disabled);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const focusAfter=await page.evaluate(()=>document.activeElement.dataset.action||document.activeElement.tagName);
  assert.equal(focusAfter,motion==='outside'?'BODY':'feedback-refresh','scroll retains old focus; nonfocusable outside click relinquishes it');
  assert.equal(await f.editor().inputValue(),textBefore,'motion during readonly update preserves journal input');
  console.log('MOTION_FOCUS '+JSON.stringify({width,motion,focusAfter}));
 }
 const beforeAba=fixture.putCount(),runIndex=await page.evaluate(()=>window.__feedbackBrowserProbe.runs.length),held=fixture.holdNextPrimary();await f.editor().fill('synthetic later input ABA');await page.locator('[data-action="feedback-regenerate"]').click();await waitHeld(held);await nav(page,'settings');const owner=await expose(page,'[data-github-field="dataOwner"]');await owner.fill('synthetic-other-owner');await owner.fill('synthetic-feedback-owner');held.release();await rejectedRunSettled(page,runIndex);
 assert.equal(fixture.putCount(),beforeAba,'old primary head reply cannot authorize any write after ABA');assert.equal((await f.state()).settings.github.dataOwner,'synthetic-feedback-owner');assert.equal((await f.state()).journals[DATE],'synthetic later input ABA');assert.equal(fixture.entries().length,1);assert.equal(fixture.entries()[0].attempt,2);
 }finally{fixture.offline(false);await f.close();}}}).catch(e=>{console.error(e);process.exitCode=1;});
