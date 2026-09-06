'use strict';
const assert=require('node:assert/strict');
const {ready,run,nav,expose,waitHeld,layout}=require('./feedback-browser-harness.cjs');
const {createCanonicalFixture,A,B}=require('./feedback-canonical-fixture.cjs');
async function owner(page,value){await nav(page,'settings');const field=await expose(page,'[data-github-field="dataOwner"]');await field.fill(value);await page.waitForFunction(async value=>(await import('/src/state/store.js')).state.settings.github.dataOwner===value,value);}
async function open(page,view){await nav(page,view);if(view==='ai-reports'){await page.locator('[data-action="ai-report-type"][data-type="feedback"]').click();await page.locator('[data-feedback-report-overlay]').waitFor();}}
async function body(page,marker,absent){await page.waitForFunction(marker=>document.querySelector('.feedback-version-body')?.textContent.includes(marker),marker);const text=await page.locator('.feedback-version-body').textContent();assert(!text.includes(absent),'foreign canonical body absent');}
run(async(browser,server)=>{for(const width of [390,768,1024]){const fixture=createCanonicalFixture(),f=await ready(browser,server,width,fixture),{page}=f;try{
 for(const view of ['journal','ai-reports']){
  await owner(page,A);await open(page,view);await body(page,fixture.mark('A'),fixture.mark('B'));
  await owner(page,B);await open(page,view);await body(page,fixture.mark('B'),fixture.mark('A'));
  // Force the old A request to remain pending while an actual settings transition selects B.
  const held=fixture.a.holdNextRead(fixture.canonicalPath);await owner(page,A);const index=await page.evaluate(()=>globalThis.__feedbackCanonicalProbe?.length||0);await open(page,view);await waitHeld(held);
  await owner(page,B);await open(page,view);await body(page,fixture.mark('B'),fixture.mark('A'));held.release();
  await page.waitForFunction(index=>globalThis.__feedbackCanonicalProbe?.[index]?.settled===true,index);await body(page,fixture.mark('B'),fixture.mark('A'));
  // A→B→A must not accept the first A generation, even though its identity strings match again.
  fixture.a.files.set(fixture.canonicalPath,fixture.mark('A',' old-generation'));const aba=fixture.a.holdNextRead(fixture.canonicalPath);await owner(page,A);const abaIndex=await page.evaluate(()=>globalThis.__feedbackCanonicalProbe.length);await open(page,view);await waitHeld(aba);
  await owner(page,B);await owner(page,A);fixture.a.files.set(fixture.canonicalPath,fixture.mark('A',' current-generation'));await open(page,view);await body(page,fixture.mark('A',' current-generation'),'old-generation');aba.release();
  await page.waitForFunction(index=>globalThis.__feedbackCanonicalProbe?.[index]?.settled===true,abaIndex);await body(page,fixture.mark('A',' current-generation'),'old-generation');fixture.a.files.set(fixture.canonicalPath,fixture.mark('A'));
 }
 assert(fixture.a.calls.some(c=>c.method==='GET'&&c.path===fixture.canonicalPath));assert(fixture.b.calls.some(c=>c.method==='GET'&&c.path===fixture.canonicalPath));assert.equal(fixture.calls.filter(c=>c.method==='PUT').length,0,'reading canonical bodies never writes either connection');await layout(page,width,'canonical-connections');
 }finally{await f.close();}}}).catch(e=>{console.error(e);process.exitCode=1;});
