const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium,launchOptions,startServer,randomPort,passGithubGate,STATE_KEY,dispatchRegisteredAction}=require('./helpers');
(async()=>{
 const port=randomPort(),server=startServer(port);let browser;
 try{
 browser=await chromium.launch({...launchOptions(),timeout:20000});
 const ctx=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}}),page=await ctx.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let req,res,health,metadata,puts=0,healthGets=0,failHealth=false;const sha='a'.repeat(40);
 let uncertainPut=false,failInspect=false,holdHealth=null,healthEntered=null,healthReleased=null;
 const routeErrors=[];
 const bounded=(promise,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' deadline')),30000);})]).finally(()=>clearTimeout(timer));};
 if(process.env.ARTIFACT_DIR)require('node:fs').mkdirSync(process.env.ARTIFACT_DIR,{recursive:true});
 const now=new Date(),date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 const packet=(data)=>({encoding:'base64',sha,content:Buffer.from(JSON.stringify(data)).toString('base64')});
 await ctx.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());if(u.hostname==='localhost')return route.continue();
  if(u.hostname!=='api.github.com')return route.fulfill({status:404,body:''});
  const p=u.pathname.split('/contents/')[1];
  if(r.method()==='PUT') {assert.equal(p,'taskchute/requests/karada-request.json');puts++;const b=JSON.parse(r.postData());req=JSON.parse(Buffer.from(b.content,'base64'));if(uncertainPut){uncertainPut=false;return route.abort('failed');}return route.fulfill({status:201,json:{content:{sha}}});}
  if(failInspect && p?.startsWith('taskchute/requests/'))return route.fulfill({status:503,body:''});
  if(p==='karada/health-daily.json' && holdHealth){const wait=holdHealth,body=JSON.stringify(health);healthEntered();await wait;try{await route.fulfill({status:200,body});}catch(error){routeErrors.push(error.message);}finally{healthReleased();}return;}
  if(p==='karada/health-daily.json'){healthGets++;if(failHealth)return route.fulfill({status:503,body:''});}
  const data=p==='karada/health-daily.json'?health:p==='karada/import-status.json'?metadata:p==='taskchute/requests/karada-request.json'?req:p==='taskchute/requests/karada-response.json'?res:undefined;
  if(p==='karada/health-daily.json' && data!==undefined)return route.fulfill({status:200,body:JSON.stringify(data)});
  return route.fulfill(data===undefined?{status:404,body:''}:{status:200,json:packet(data)});
 });
 // Test-only wrapper records the REAL controller restore promise. It does not
 // stub fetch, body decoding, digest, validation, or cache adoption.
 const modulePath=require('node:path').join(__dirname,'../src/features/karada-import.js');
 const moduleText=require('node:fs').readFileSync(modulePath,'utf8');
 const actionAnchor='"karada-recheck": () => controller.restore()';
 assert.equal(moduleText.split(actionAnchor).length,2,'unique real operation anchor');
 await ctx.route('**/src/features/karada-import.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:moduleText.replace(actionAnchor,
  '"karada-recheck": () => { const marker = window.__karadaObserved = {done:false,error:null}; const operation=controller.restore(); operation.then(()=>{marker.done=true;},error=>{marker.error=String(error);marker.done=true;}); return operation; }')}));
 await page.goto('http://localhost:'+port);await page.waitForSelector('[data-action="gate-continue"]');await passGithubGate(page);
 await page.waitForSelector('[data-karada-import] button:not([disabled])');
 const state=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),STATE_KEY);
 const before=await state();
 for(const width of [390,768,1024,1280]){await page.setViewportSize({width,height:900});assert(await page.locator('[data-karada-import]').count());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(process.env.ARTIFACT_DIR)await page.screenshot({path:require('node:path').join(process.env.ARTIFACT_DIR,`app-ui-${width}-${puts}.png`)});}
 await page.locator('[data-action="karada-import"]').first().click();await page.waitForFunction(()=>document.querySelector('[data-karada-import]').textContent.includes('受付'));
 await dispatchRegisteredAction(page,'karada-import');assert.equal(puts,1);
 req.requestedAt=new Date(Date.now()-11*60*1000).toISOString();
 const reloadHealth=page.waitForResponse(r=>r.url().includes('/karada/health-daily.json'));await page.reload();await reloadHealth;await page.waitForFunction(()=>document.querySelector('[data-karada-import]')?.textContent.includes('受付'));assert.equal(puts,1);
 assert((await page.locator('[data-karada-import]').first().innerText()).includes('PCの電源'),'unanswered request shows PC guidance');
 assert.equal(await page.locator('[data-action="karada-import"]').first().isDisabled(),true);
 function response(status,extra={}){return {schema:1,requestId:req.requestId,requestSha:sha,status,updatedAt:new Date().toISOString(),lastSuccessfulAt:null,dataThrough:null,healthSha256:null,reason:null,...extra};}
 res=response('no_data');const oldGets=healthGets;await dispatchRegisteredAction(page,'karada-recheck');await page.waitForFunction(()=>document.querySelector('[data-karada-import]').textContent.includes('新しいデータなし'));assert.equal(healthGets,oldGets);
 await page.locator('[data-action="karada-import"]').first().click();await page.waitForFunction(()=>document.querySelector('[data-karada-import]').textContent.includes('受付'));
 health={schema:1,generated_at:new Date().toISOString(),days:[{date,sleep_min:480,resting_hr:55,hrv_sdnn:45}]};
 const hash=crypto.createHash('sha256').update(JSON.stringify(health)).digest('hex');res=response('success',{healthSha256:hash,lastSuccessfulAt:new Date().toISOString(),dataThrough:date});metadata={...res};delete metadata.requestId;
 // Preserve an actual focused editable node while asynchronous completion requests a render.
 await page.evaluate(()=>{const t=document.createElement('textarea');t.id='synthetic-draft';document.querySelector('#app').append(t);t.value='未保存の架空入力';t.focus();t.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));});
 await dispatchRegisteredAction(page,'karada-recheck');await page.waitForFunction(()=>document.querySelector('[data-karada-import]').textContent.includes('画面更新が完了'));
 assert.equal(await page.locator('#synthetic-draft').inputValue(),'未保存の架空入力');assert.equal(await page.locator('#synthetic-draft').evaluate(n=>n===document.activeElement),true);
 await page.evaluate(()=>{const t=document.querySelector('#synthetic-draft');t.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));t.blur();t.remove();});
 await page.evaluate(async()=>{const s=await import('/src/state/store.js');s.state.currentView='instruments';});
 // 4回-08 日本語化の契約追随(監督者決定 2026-09-10)
 await dispatchRegisteredAction(page,'karada-recheck');await page.waitForSelector('.instr-today');assert((await page.locator('.instr-today').innerText()).includes('8時間00分'));
 for(const width of [390,768,1024,1280]){await page.setViewportSize({width,height:900});assert(await page.locator('.instr-today [data-karada-import]').count());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(process.env.ARTIFACT_DIR)await page.screenshot({path:require('node:path').join(process.env.ARTIFACT_DIR,`app-ui-${width}-${puts}.png`)});}
 // 4回-08 日本語化の契約追随(監督者決定 2026-09-10)
 failHealth=true;await dispatchRegisteredAction(page,'karada-recheck');await page.waitForFunction(()=>document.querySelector('[data-karada-import]').textContent.includes('画面の更新に失敗'));assert((await page.locator('.instr-today').innerText()).includes('8時間00分'));
 failHealth=false;await page.locator('[data-action="karada-recheck"]').click();await page.waitForFunction(()=>document.querySelector('[data-karada-import]').textContent.includes('画面更新が完了'));

 // Saved remotely but response lost: recheck is GET-only and joins the original request.
 const priorPuts=puts;uncertainPut=true;
 await page.locator('[data-action="karada-import"]').first().click();
 await page.waitForSelector('[data-action="karada-recheck"]');assert.equal(puts,priorPuts+1);
 const uncertainId=req.requestId;failInspect=true;
 await page.locator('[data-action="karada-recheck"]').first().click();
 await page.waitForFunction(()=>document.querySelector('[data-karada-import]')?.textContent.includes('確認できません'));
 assert.equal(puts,priorPuts+1);failInspect=false;
 await page.locator('[data-action="karada-recheck"]').first().click();
 await page.waitForFunction(()=>document.querySelector('[data-karada-import]')?.textContent.includes('受付'));
 assert.equal(req.requestId,uncertainId);assert.equal(puts,priorPuts+1);
 res=response('success',{healthSha256:hash,lastSuccessfulAt:new Date().toISOString(),dataThrough:date});metadata={...res};delete metadata.requestId;

 // Hold an old force response while real settings input performs A -> B -> A.
 let release;holdHealth=new Promise(r=>release=r);
 const entered=new Promise(r=>healthEntered=r),released=new Promise(r=>healthReleased=r);
 await dispatchRegisteredAction(page,'karada-recheck');await bounded(entered,'health route entered');
 await dispatchRegisteredAction(page,'nav',{view:'settings'});
 const owner=page.locator('[data-github-field="dataOwner"]').first();
 const group=owner.locator('xpath=ancestor::details[1]');
 if(await group.count() && !await owner.isVisible())await group.locator('summary').first().click();
 const originalOwner=await owner.inputValue();await owner.fill('synthetic-other');await owner.fill(originalOwner);
 holdHealth=null;release();await bounded(released,'health route released');
 assert.deepEqual(routeErrors,[],'held health response delivered');
 await page.waitForFunction(()=>window.__karadaObserved?.done===true, null, {timeout:30000});
 assert.equal(await page.evaluate(()=>window.__karadaObserved.error),null,'actual restore operation completed');
 assert.equal(await owner.inputValue(),originalOwner,'connection input survives readonly invalidation');
 assert.equal(await page.evaluate(async()=>Boolean((await import('/src/features/health.js')).cachedHealthData())),false,'old force response cannot restore prior connection cache after ABA');
 assert.equal(puts,priorPuts+1,'connection change does not automatically resubmit');
 const after=await state();for(const key of ['condition','bodyScans','sleep','journal'])assert.deepEqual(after[key],before[key]);assert(!Object.keys(after).some(k=>/karada|health/i.test(k)));
 assert.deepEqual(errors,[]);console.log('PASS 390/768/1024/1280 Today/Instruments empty button, receipt/reload/PC-wait/no_data, force update, IME draft, refresh failure/retry, uncertain PUT recheck, delayed ABA, state boundary');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
