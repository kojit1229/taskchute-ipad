'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium,launchOptions,startServer,randomPort,STATE_KEY,passGithubGate}=require('./helpers');
const {createFeedbackFixture,DATE,PREFIX}=require('./feedback-fixture.cjs');
const {observeEntry}=require('./feedback-entry-observer.cjs');
const {observeCanonical}=require('./feedback-canonical-observer.cjs');
async function nav(page,view){const direct=page.locator(`#bottomNav [data-view="${view}"]:visible,#sidebar [data-view="${view}"]:visible`).first();
 if(await direct.count())await direct.click();else{await page.locator('#bottomNav [data-view="more"]:visible,#sidebar [data-view="more"]:visible').first().click();await page.locator(`.more-tower-grid [data-view="${view}"]`).click();}}
async function expose(page,selector){const el=page.locator(selector).first();await el.waitFor({state:'attached'});await el.evaluate(el=>{for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});return el;}
async function date(page,date){await nav(page,'exec');await page.locator('[data-date-picker]').fill(date);await page.waitForFunction(async date=>(await import('/src/state/store.js')).state.selectedDate===date,date);await nav(page,'journal');await expose(page,`[data-journal-date="${date}"]`);}
async function ready(browser,server,width,providedFixture=null){const page=await browser.newPage({viewport:{width,height:844},serviceWorkers:'block'}),fixture=providedFixture||createFeedbackFixture(),errors=[];
 page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>fixture.route(r).catch(async e=>{errors.push(e.message);await r.abort().catch(()=>{});}));
 await page.route('**/src/features/feedback/feedback-entry.js*',r=>r.fulfill({status:200,contentType:'text/javascript',body:observeEntry(fs.readFileSync(path.join(__dirname,'../src/features/feedback/feedback-entry.js'),'utf8'))}));
 if(providedFixture)await page.route('**/src/features/feedback/feedback-canonical-reader.js*',r=>r.fulfill({status:200,contentType:'text/javascript',body:observeCanonical(fs.readFileSync(path.join(__dirname,'../src/features/feedback/feedback-canonical-reader.js'),'utf8'))}));
 await page.addInitScript(KEY=>{window.__feedbackBrowserProbe={runs:[],settled:0};const write=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(window.__feedbackQuota&&key===KEY)throw new DOMException('synthetic quota','QuotaExceededError');return write.call(this,key,value);};},STATE_KEY);
 await page.clock.setFixedTime(new Date(2026,8,6,12));await page.goto('http://localhost:'+server.address().port+'/');
 await page.evaluate(({KEY,DATE})=>{const s=JSON.parse(localStorage.getItem(KEY));Object.assign(s.settings.github,{token:'SYNTHETIC_FEEDBACK_TOKEN',dataOwner:'synthetic-feedback-owner',dataRepo:'synthetic-feedback-repo',branch:'fixture',path:'app-state.json',autoSave:false});
 s.settings.autoSync=false;s.settings.lastOpenedDate=DATE;s.currentView='journal';s.selectedDate=DATE;s.journals[DATE]='synthetic initial journal';s.journals['2026-09-05']='synthetic prior day';s.reports={};s.feedback={};s.blocks=[];s.tasks=[];s.projects=[];s.recurrences=[];s.pomodoro={running:false};localStorage.setItem(KEY,JSON.stringify(s));localStorage.setItem('taskchute-backup-last-date',DATE);}, {KEY:STATE_KEY,DATE});
 await passGithubGate(page);await nav(page,'journal');await page.locator('[data-feedback-ui-slot]').waitFor();await expose(page,`[data-journal-date="${DATE}"]`);
 const state=()=>page.evaluate(async()=>structuredClone((await import('/src/state/store.js')).state));
 return {page,fixture,errors,state,editor:()=>page.locator(`[data-journal-date="${DATE}"]`),async close(){fixture.cleanup();await page.close();assert.deepEqual(errors,[],'actual page/route errors');}};
}
async function status(page,text){await page.waitForFunction(text=>[...document.querySelectorAll('.feedback-regeneration [role="status"]')].some(el=>el.textContent.includes(text)),text);}
async function refresh(page){await page.locator('[data-action="feedback-refresh"]').click();await status(page,'処理状況を確認しました');}
async function submit(f,text='synthetic edited journal'){await f.editor().fill(text);await f.page.locator('[data-action="feedback-regenerate"]').click();await status(f.page,'依頼の受付を確認済み');const r=f.fixture.request();assert.equal(r.date,DATE);assert.equal(r.snapshot.journalText,text);
 assert(f.fixture.calls.some(c=>c.method==='PUT'&&c.path==='taskchute/app-state.json'));assert(f.fixture.calls.some(c=>c.method==='PUT'&&c.path===`taskchute/日報_${DATE}.md`));return r;}
async function layout(page,width,label){await page.waitForLoadState('networkidle');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');const buttons=await page.evaluate(()=>[...document.querySelectorAll('.feedback-regeneration button')].filter(el=>el.getClientRects().length&&!['hidden','collapse'].includes(getComputedStyle(el).visibility)).map(el=>{const r=el.getBoundingClientRect();return {x:r.x,width:r.width,height:r.height};}).filter(r=>r.width>0&&r.height>0));assert(buttons.length>0,'visible feedback controls exist');for(const r of buttons){assert(r&&r.x>=-1&&r.x+r.width<=width+1&&r.height>=43,`44px reachable control ${width}`);}const dir=process.env.FEEDBACK_EVIDENCE||fs.mkdtempSync(path.join(os.tmpdir(),'tc-feedback-'));fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,`${label}-${width}.png`),fullPage:true});
 await page.locator('.feedback-regeneration h3').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(dir,`${label}-${width}-viewport.png`)});
 const metrics=await page.evaluate(()=>{
 const measure=el=>{const r=el.getBoundingClientRect(),c=getComputedStyle(el);return {tag:el.tagName,id:el.id,cls:el.className,top:r.top,bottom:r.bottom,height:r.height,scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,overflow:c.overflow,display:c.display,position:c.position,grid:c.gridTemplateRows};};
 return {viewport:{width:innerWidth,height:innerHeight},ancestors:(()=>{const a=[];for(let el=document.querySelector('.feedback-regeneration');el;el=el.parentElement)a.push(measure(el));return a;})(),body:measure(document.querySelector('.feedback-version-body'))};
 });fs.writeFileSync(path.join(dir,`${label}-${width}-metrics.json`),JSON.stringify(metrics,null,2));
 const ends={};
 for(const end of ['first','last']){
  const el=page.locator('.feedback-version-body').locator(':scope > *')[end]();
  const move=await el.evaluate((el,end)=>{
   const r=el.getBoundingClientRect(),nav=document.getElementById('bottomNav'),n=nav&&getComputedStyle(nav).display!=='none'?nav.getBoundingClientRect().height:0;
   const boundary=end==='first'?r.top-80:r.bottom-(innerHeight-n-12),max=document.scrollingElement.scrollHeight-innerHeight;
   const target=Math.max(0,Math.min(max,scrollY+boundary));return {target,delta:target-scrollY,x:r.left+Math.min(30,r.width/2)};
  },end);
  // Real wheel input relinquishes a pending readonly update's former scroll ownership.
  await page.mouse.move(move.x,400);await page.mouse.wheel(0,move.delta);
  await page.waitForFunction(target=>Math.abs(scrollY-target)<=2,move.target);
  const reach=await el.evaluate((el,end)=>{const r=el.getBoundingClientRect(),x=Math.max(1,r.left+Math.min(30,r.width/2)),y=end==='first'?Math.max(1,r.top+Math.min(5,r.height/2)):Math.min(innerHeight-1,r.bottom-5),hit=document.elementFromPoint(x,y);return {top:r.top,bottom:r.bottom,height:r.height,viewport:innerHeight,hit:el===hit||el.contains(hit),mainTop:document.getElementById('main').scrollTop};},end);
  ends[end]=reach;
  fs.writeFileSync(path.join(dir,`${label}-${width}-body-reach.json`),JSON.stringify(ends,null,2));
  await page.screenshot({path:path.join(dir,`${label}-${width}-body-${end}-viewport.png`)});
  assert(reach.hit,`${end} actual feedback body is visible and not occluded at ${width}`);
  assert.equal(reach.mainTop,0,'feedback uses document scroll without a second hidden main scroll');
 }
 fs.writeFileSync(path.join(dir,`${label}-${width}-body-reach.json`),JSON.stringify(ends,null,2));

}

async function run(fn){const started=Date.now();let server,browser;try{server=startServer(randomPort());browser=await chromium.launch(launchOptions());await fn(browser,server);console.log('PASS feedback browser suite; elapsedMs='+ (Date.now()-started));}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));}}
async function waitHeld(held){let timer;try{await Promise.race([held.reached,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('primary request not reached')),8000))]);}finally{clearTimeout(timer);}}
async function rejectedRunSettled(page,index){await page.waitForFunction(index=>{const p=window.__feedbackBrowserProbe;return p?.runs[index]?.outcome==='rejected'&&p.runs[index].settled===true;},index);}
module.exports={rejectedRunSettled,waitHeld,ready,run,nav,date,status,refresh,submit,layout,expose,DATE,PREFIX,STATE_KEY};
