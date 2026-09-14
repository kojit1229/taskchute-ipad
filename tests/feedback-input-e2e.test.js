'use strict';const assert=require('node:assert/strict');const {rejectedRunSettled,waitHeld,ready,run,date,status,submit,layout,DATE,STATE_KEY}=require('./feedback-browser-harness.cjs');
run(async(browser,server)=>{await globalInputRecovery(browser,server);for(const width of [390,768,1024]){const f=await ready(browser,server,width),{page,fixture}=f;try{
 await f.editor().dispatchEvent('compositionstart',{data:'synthetic'});const before=fixture.putCount();await page.locator('[data-action="feedback-regenerate"]').click();assert.equal(fixture.putCount(),before,'IME cannot write');assert((await page.locator('body').textContent()).includes('文字の変換を確定'));await f.editor().dispatchEvent('compositionend',{data:'synthetic'});
 const rawBefore=await page.evaluate(KEY=>localStorage.getItem(KEY),STATE_KEY);await page.evaluate(()=>window.__feedbackQuota=true);await f.editor().fill('synthetic unsaved quota draft');await page.locator('[data-action="feedback-regenerate"]').click();await status(page,'確認が必要');assert.equal(fixture.putCount(),before,'failed local persistence cannot reach any PUT');assert.equal(await f.editor().inputValue(),'synthetic unsaved quota draft');assert.equal(await page.evaluate(KEY=>localStorage.getItem(KEY),STATE_KEY),rawBefore,'quota leaves original stored bytes');await page.evaluate(()=>window.__feedbackQuota=false);
 const runIndex=await page.evaluate(()=>window.__feedbackBrowserProbe.runs.length);const held=fixture.holdNextPrimary();await page.locator('[data-action="feedback-regenerate"]').click();await waitHeld(held);await date(page,'2026-09-05');held.release();await page.waitForFunction(()=>document.querySelector('.feedback-regeneration h3')?.textContent.startsWith('2026-09-05'));await rejectedRunSettled(page,runIndex);
 assert.equal(fixture.putCount(),before,'lost journal owner stops before primary PUT');assert.equal((await f.state()).journals[DATE],'synthetic unsaved quota draft');
 await date(page,DATE);await submit(f,`synthetic recovered ${width}`);await layout(page,width,'input-protection');
 }finally{await page.evaluate(()=>window.__feedbackQuota=false).catch(()=>{});await f.close();}}}).catch(e=>{console.error(e);process.exitCode=1;});

async function globalInputRecovery(browser,server) {
 const {nav,expose}=require('./feedback-browser-harness.cjs');
 for(const kind of ['condition','vision']) {
  const f=await ready(browser,server,390),{page,fixture}=f;
  const field=kind==='condition'?DATE:'vision',key=`${kind}:${field}`;
  const selector=kind==='condition'?`[data-condition-note-date="${DATE}"]`:'[data-vision-field="vision"]';
  const mountLegacyVision=()=>page.evaluate(()=>{
   // The old vision renderer is gone; exercise its retained delegated input contract.
   const el=document.createElement('textarea');el.dataset.visionField='vision';document.body.append(el);
  });
  const drafts=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('taskchute-global-inputs')||'{}'));
  try {
   if(kind==='vision')await mountLegacyVision();
   const editor=await expose(page,selector);
   await editor.fill('synthetic saved original');
   const rawBefore=await page.evaluate(KEY=>localStorage.getItem(KEY),STATE_KEY),putsBefore=fixture.putCount();
   const stateBefore=await f.state();
   await page.evaluate(()=>window.__feedbackQuota=true);
   await editor.fill('synthetic unsaved draft');
   assert.equal(await editor.inputValue(),'synthetic unsaved draft',`${kind}: failed save retains text`);
   assert.equal((await drafts())[key].value,'synthetic unsaved draft');
   // Real continued typing must extend the failed text, without reverting to the stored text.
   await editor.press('End');await editor.pressSequentially(' continued');
   const value='synthetic unsaved draft continued';
   assert.equal(await editor.inputValue(),value);
   const draft=(await drafts())[key];
   assert.equal(draft.value,value);assert.equal(draft.beforeValue,'synthetic saved original');
   assert.deepEqual(await editor.evaluate(el=>[el.selectionStart,el.selectionEnd]),[draft.start,draft.end]);
   assert.deepEqual(await f.state(),stateBefore,`${kind}: failed save restores state`);
   assert.equal(await page.evaluate(KEY=>localStorage.getItem(KEY),STATE_KEY),rawBefore);
   assert.equal(fixture.putCount(),putsBefore,`${kind}: failed save has no PUT`);
   await page.reload();
   await page.locator('[data-feedback-ui-slot]').waitFor();
   if(kind==='vision') {await mountLegacyVision();await nav(page,'journal');}
   const restored=await expose(page,selector);
   assert.equal(await restored.inputValue(),value,`${kind}: reload restores draft`);
   assert.deepEqual(await restored.evaluate(el=>[el.selectionStart,el.selectionEnd]),[draft.start,draft.end]);
   assert.equal((await drafts())[key].candidateId,draft.candidateId);
   await restored.dispatchEvent('input');
   const saved=JSON.parse(await page.evaluate(KEY=>localStorage.getItem(KEY),STATE_KEY));
   const savedValue=kind==='condition'?saved.condition.logs[DATE].eveningNote:saved.settings[field];
   assert.equal(savedValue,value,`${kind}: retry persists recovered text`);
   assert.equal((await drafts())[key],undefined,`${kind}: successful retry clears draft`);
   assert.equal(await restored.inputValue(),value);
  } finally {await page.evaluate(()=>window.__feedbackQuota=false).catch(()=>{});await f.close();}
 }
 console.log('PASS F3 condition/legacy vision failure, continued input, reload and retry');
}
