const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const helpers = require(process.env.UI_BASELINE_ROOT ? path.join(process.env.UI_BASELINE_ROOT,'tests/helpers') : './helpers');
const {chromium,launchOptions,startServer,randomPort,STATE_KEY,passGithubGate}=helpers;
const out=process.env.UI_EVIDENCE_DIR;
const baseline=!!process.env.UI_BASELINE_ROOT;
const DAY='2026-09-06';
const results=[];
function block(id, extra={}) { return {id,title:'記録を整理する '+id,date:DAY,taskId:'',category:'作業',plannedStartAt:DAY+'T10:00',plannedEndAt:DAY+'T11:00',actualStartAt:'',actualEndAt:'',completed:false,deleted:false,charge:0,discharge:0,comment:'',isMIT:true,...extra}; }
(async()=>{
 let server,browser;
 try {
  server=startServer(randomPort());browser=await chromium.launch(launchOptions());
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='localhost'?r.continue():r.abort());
  await page.clock.setFixedTime(new Date(2026,8,6,10,30));
  await page.goto('http://localhost:'+server.address().port+'/');
  await passGithubGate(page);
  const original=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),STATE_KEY);
  async function seed(mode) {
   await page.evaluate(({k,s,day,blocks,focus,alert})=>{
    s.currentView='today';s.selectedDate=day;s.blocks=blocks;s.tasks=[];s.recurrences=[];
    localStorage.removeItem('taskchute-journal-last-sync-pull-at');
    if(alert)localStorage.setItem('taskchute-journal-last-sync-pull-at','2026-09-04T10:00');
    s.settings.autoSync=false;s.settings.github.autoSave=false;s.settings.lastOpenedDate=day;
    s.journals[day]='固定の本文\n### 依頼\n任意の依頼';
    localStorage.setItem(k,JSON.stringify(s));
    localStorage.setItem('taskchute-journal-today-focus-v1',JSON.stringify({sections:{side:!focus,journal:!focus,life:!focus},restore:{side:true,journal:true,life:true}}));
   },{k:STATE_KEY,s:original,day:DAY,focus:mode==='focus',alert:mode==='alert',blocks:mode==='empty'?[]:[block('running',{actualStartAt:mode==='ready'?'':DAY+'T10:00',plannedEndAt:mode==='over'?DAY+'T10:10':DAY+'T11:00',title:mode==='long'?'長い作業名と日本語の情報を削らず保持するためのレイアウト確認'.repeat(4):'記録を整理する'}),block('mit2'),block('mit3')]});
   await page.reload();await page.locator('.today-tower').waitFor();await page.waitForLoadState('networkidle');
  }
  for(const width of (process.env.UI_WIDTHS||'390,768,1280,1440').split(',').map(Number)) for(const mode of (process.env.UI_MODES||'ready,running,over,empty,long,focus,alert').split(',')) {
   await page.setViewportSize({width,height:844});await seed(mode);
   const metrics=await page.evaluate(()=>{
    const tower=document.querySelector('.today-tower');
    const band=tower.querySelector('.tower-band2');
    const ordered=innerWidth>=1280?band.nextElementSibling.matches('.today-focus-bar'):band===tower.firstElementChild;
    const action=tower.querySelector('.tower-nowhud [data-action="now-start"],.tower-nowhud [data-action="complete-block-with-actual"],.tower-nowhud [data-action="nav"]');
    const box=action?.getBoundingClientRect();
    const rect=s=>{const b=tower.querySelector(s)?.getBoundingClientRect();return b?{x:b.x,y:b.y,width:b.width,height:b.height}:null};
    const body=tower.querySelector('.sec-bodymind'), prior=body?.previousElementSibling;
    return {ordered,bandArea:getComputedStyle(band).gridArea,bodyGap:body&&prior?body.getBoundingClientRect().top-prior.getBoundingClientRect().bottom:null,action:box?{top:box.top,bottom:box.bottom,height:box.height}:null,overflow:document.documentElement.scrollWidth>innerWidth,mit:tower.querySelectorAll('.tower-mit-row').length,creeds:tower.querySelectorAll('.so-item').length,english:[...tower.querySelectorAll('.so-item small')].map(x=>x.textContent),alert:!!tower.querySelector('.sync-alert-banner'),ring:!!tower.querySelector('.pomo-circle-wrap'),left:rect('.tower-col-left'),center:rect('.tower-col-center'),right:rect('.tower-col-right'),bodymindColumn:tower.querySelector('.sec-bodymind')?.parentElement.className};
   });
   results.push({width,mode,...metrics});
   if(!baseline){
    assert(metrics.ordered,'initial top-level DOM order');
    assert(!metrics.overflow,`${width} ${mode}: body overflow`);
    assert(metrics.action,`${width} ${mode}: main action`);
    if(width===390) assert(metrics.action.bottom<844 && metrics.action.top>=0,`${mode}: primary below viewport ${JSON.stringify(metrics.action)}`);
    assert(metrics.action.height>=44,'44px main action');
    assert.equal(metrics.mit,mode==='empty'?0:3);
    assert(metrics.ring,'circle timer kept');if(mode==='alert')assert(metrics.alert,'real sync warning rendered');
    if(mode!=='focus'){assert.equal(metrics.creeds,3);assert(metrics.english.every(Boolean),'English retained');}
    if(width>=1280 && mode!=='focus') {
     assert(metrics.bandArea.includes('band2'),'existing band2 grid assignment');assert(metrics.bodyGap>=8,'bodymind separated from gates');
     assert(Math.abs(metrics.left.width/metrics.center.width-38/29)<.08,'PC 38:29 ratio');
     assert(metrics.bodymindColumn==='tower-col-center','bodymind middle column');
    }
   }
   if(out && ['ready','running','empty','long','focus','alert'].includes(mode)) {fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`${baseline?'before':'after'}-${width}-${mode}.png`),fullPage:true});}
  }
  await page.setViewportSize({width:390,height:844});await seed('running');
  const input=page.locator('.tower-journal-free');await input.evaluate(el=>el.scrollIntoView());await input.fill('編集中の日本語\n### 依頼\n残す');
  await input.evaluate(el=>{window.__uiInput=el;window.__uiScroll=document.querySelector('#app').scrollTop;el.dispatchEvent(new CompositionEvent('compositionstart',{data:'にほんご',bubbles:true}));});
  await page.clock.runFor(1200);
  const preserved=await input.evaluate(el=>({same:el===window.__uiInput,focused:document.activeElement===el,value:el.value,scroll:document.querySelector('#app').scrollTop===window.__uiScroll,font:getComputedStyle(el).fontSize}));
  if(!baseline){assert(preserved.same&&preserved.focused&&preserved.scroll,'tick preserves DOM/focus/scroll');assert.equal(preserved.value,'編集中の日本語\n### 依頼\n残す');assert(parseFloat(preserved.font)>=16);}
  await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
  const resizeChecks=[];
  for(const mode of ['ready','focus']) {
   await seed(mode);
   await page.evaluate(()=>{window.__band=document.querySelector('.tower-band2');});
   for(const width of [1280,390]) {
    await page.setViewportSize({width,height:844});
    const metric=await page.evaluate(async()=>{
     const band=window.__band, app=document.querySelector('#app');
     const input=document.querySelector('.tower-journal-free');
     const target=input||band.querySelector('button');
     target.focus({preventScroll:true});
     if(input) {input.setSelectionRange(2,5); input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));}
     const top=app.scrollTop;
     const {updateTodayTowerTick}=await import('/src/features/today-tower.js');updateTodayTowerTick();
     const result={same:band===document.querySelector('.tower-band2'),focused:document.activeElement===target,scroll:app.scrollTop===top,selection:!input||(input.selectionStart===2&&input.selectionEnd===5),order:innerWidth>=1280?band.nextElementSibling.matches('.today-focus-bar'):band===band.parentElement.firstElementChild,duplicates:document.querySelectorAll('.tower-band2').length};
     if(input)input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
     return result;
    });
    assert(metric.same&&metric.focused&&metric.scroll&&metric.selection&&metric.order&&metric.duplicates===1,JSON.stringify({mode,width,metric}));
    resizeChecks.push({mode,width,...metric});
   }
  }
  results.push({resizeChecks});
  if(process.env.UI_INJECT_ERROR==='1') {
   const caught=page.waitForEvent('pageerror');
   await page.evaluate(()=>{
    const script=document.createElement('script');
    script.textContent="throw new Error('UI-A deliberate fixture error')";
    document.head.appendChild(script);script.remove();
   });
   await caught;
  }
  assert.equal(errs.length,0,'UI-A must reject pageerror: '+errs.join(' | '));
  results.push({input:preserved,pageErrors:errs});
  if(out)fs.writeFileSync(path.join(out,baseline?'before.json':'after.json'),JSON.stringify(results,null,2));
  console.log('PASS UI-A '+(baseline?'baseline observations':(results.filter(x=>x.width).length+' layout states + input tick'))+' '+JSON.stringify(results.filter(x=>x.width===390).map(x=>({mode:x.mode,action:x.action}))));
 }finally{
  try {if(browser)await browser.close();}
  finally {if(server)await new Promise(resolve=>server.close(resolve));}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
