// Order 73c: the former sheets now use goal cards; shared by R3 and mutation tests.
const assert = require('node:assert/strict');
const { setup } = require('./remaining-twelveweek-layout.test');
const { STATE_KEY, fixedClock, setViewportAndWaitForStableLayout } = require('./helpers');
const snapshot = page => page.evaluate(async () => JSON.parse(JSON.stringify((await import('/src/state/store.js')).state)));
const plan = page => page.locator('.twy-face-segmented [data-face="plan"]').click();
const card = (page, id = 'card-a') => page.locator(`[data-decide-task="${id}"]`);
const day = (page, d, id) => card(page, id).locator(`[data-action="twy-decide-day"][data-day="${d}"]`).click();
const reload = async page => { await page.reload(); await plan(page); return snapshot(page); };
async function choose(page, days, time, id) {
  for (const d of [0, 1, 2, 3, 4, 5, 6]) {
    const b = card(page, id).locator(`[data-action="twy-decide-day"][data-day="${d}"]`);
    if ((await b.getAttribute('aria-pressed') === 'true') !== days.includes(d)) await b.click();
    assert.equal(await b.getAttribute('aria-pressed'), String(days.includes(d)), `day ${d}: ${JSON.stringify((await snapshot(page)).recurrences)} ${await page.locator('body').innerText()}`);
  }
  if (time) { const input = card(page, id).locator('[data-action="twy-decide-time"]'); await input.fill(time); await input.dispatchEvent('change'); }
}
async function seedCards(page) {
  const { weekStartOfISO, addDaysISO } = await import('../src/core/plan.js');
  const date = new Date(fixedClock(Date.now())());
  const iso = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const week = weekStartOfISO(iso), previous = addDaysISO(week, -7), cycle = addDaysISO(week, -14);
  const [y,m,d] = week.split('-').map(Number);
  await page.clock.setFixedTime(new Date(y,m-1,d,10));
  await page.evaluate(({ key, week, previous, cycle }) => {
    const s = JSON.parse(localStorage.getItem(key)), stamp = `${previous}T08:00:00`;
    const common = { createdAt: stamp, updatedAt: stamp, deleted: false };
    const project = id => ({ ...common, id, title: `目標${id}`, kind: 'normal', status: 'active', twelveWeekStartDate: cycle });
    const task = (id, projectId, extra = {}) => ({ ...common, id, projectId, title: `やること${id}`, kind: 'normal', status: 'todo', selfDueOff: true,
      estimateMin: 25, twyPlan: { perWeek: 5, fromWeek: 1, toWeek: 12, keystone: id === 'card-a' }, ...extra });
    Object.assign(s, { currentView: 'twelveweek', selectedDate: week,
      projects: [...s.projects.filter(p => ['wish','other'].includes(p.kind)), project('goal-a'), project('goal-b')],
      tasks: [...s.tasks.filter(t => t.kind === 'other'), task('card-a','goal-a', { memo: '先頭\r\n後続\n' }), task('card-b','goal-a'),
        task('card-c','goal-b'), task('pool','goal-a',{status:'someday'})],
      recurrences: [], blocks: [{ ...common, id:'miss', taskId:'card-a', title:'やることcard-a', date:previous,
        plannedStartAt:`${previous}T09:00`, plannedEndAt:`${previous}T09:25`, completed:false }],
      weeklyCommitments: [{ ...common, id:`wcw_${week}`, recordType:'week', weekStart:week, cycleStartDate:cycle, committedAt:`${week}T09:00:00` }],
      twyWeeklyReviews: [], tracks: [{ ...common, id:'metric', projectId:'goal-a', name:'過去問', kind:'numeric', baselineValue:2, goalValue:10, unit:'回', startDate:cycle, deadline:week }], trackMeasurements: [] });
    s.settings.twelveWeekStartDate = cycle;
    localStorage.setItem(key, JSON.stringify(s));
  }, { key: STATE_KEY, week, previous, cycle });
  await reload(page);
  return { week, previous, cycle, addDaysISO };
}
async function runCardAcceptance(page, n) {
  const diagnostic = msg => { if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) console.error('browser:', msg.text()); };
  page.on('console', diagnostic);
  const { week, previous, addDaysISO } = await seedCards(page);
  const rule = s => s.recurrences.find(r => r.taskId === 'card-a' && !r.deleted);
  const live = s => s.blocks.filter(b => !b.deleted && b.taskId === 'card-a' && b.date >= week && b.date <= addDaysISO(week,6));
  if (n === 1) {
    const before = await snapshot(page);
    assert.equal(await page.locator('[data-decide-project] > h4').count(),2);
    assert.match(await page.locator('[data-decide-project="goal-a"] > h4').innerText(), /先週 できた 0\/0.*今週 2 件.*週 0 回/s);
    assert.match(await page.locator('[data-decide-project="goal-a"] > h4').innerText(), /過去問 2\/10 回/);
    assert.equal(await card(page).locator('[data-action="twy-decide-day"]').count(),7);
    assert.match(await card(page).innerText(), /★ .*card-a.*週 0 回.*見積 25/s);
    assert.equal(await card(page).locator('[data-decide-number]').innerText(),'1');
    assert.equal(await card(page).locator('[data-decide-end]').getAttribute('readonly'),'');
    assert.equal(await card(page).locator('[data-decide-end]').inputValue(),'07:55');
    assert.equal(await page.locator('[data-action="twy-decide-when"],[data-add-missing],[data-modal-field="scope"]').count(),0);
    assert.equal(await page.locator('.twy-cycle-fold').getAttribute('open'),null);
    await plan(page); assert.deepEqual(await snapshot(page),before,'render is read-only');
    const aim=page.locator('[data-action="twy-decide-aim"]').first();
    await aim.fill('過去問を進める'); await aim.dispatchEvent('change');
    assert.ok(await aim.evaluate(el=>el===document.activeElement));
    assert.equal((await reload(page)).twyWeeklyReviews.find(r=>r.projectId==='goal-a').aim,'過去問を進める');
  }
  if (n === 2) {
    await choose(page,[2,4,6],'08:00'); let s=await reload(page);
    assert.deepEqual(rule(s).days,[2,4,6]); assert.equal(rule(s).kind,'weekly');
    assert.equal(s.tasks.find(t=>t.id==='card-a').twyPlan.perWeek,3);
    assert.equal(live(s).length,3); assert.ok(live(s).every(b=>b.plannedStartAt.endsWith('T08:00:00')));
    const old=live(s);
    await page.evaluate(async week=>{ const s=(await import('/src/state/store.js')).state; const b=s.blocks.find(b=>b.taskId==='card-a'&&b.date===week&&!b.deleted); b.comment='保存用の値'; b.actualStartAt=`${week}T08:00`; },week);
    await choose(page,[1,3,5],'10:00'); s=await reload(page);
    assert.equal(live(s).length,4); assert.equal(live(s).find(b=>b.date===week).comment,'保存用の値');
    assert.ok(old.filter(b=>b.date!==week).every(b=>s.blocks.some(x=>x.id===b.id&&x.deleted&&x.updatedAt)));
    assert.ok(!s.blocks.some(b=>!b.deleted&&b.recurrenceGroupId===rule(s).id&&b.date>addDaysISO(week,6)&&[2,4,6].includes(new Date(...b.date.split('-').map((v,i)=>Number(v)-(i===1?1:0))).getDay())));
    for (const [days,kind] of [[[0,1,2,3,4,5,6],'daily'],[[1,2,3,4,5],'weekdays']]) {
      await choose(page,days,'11:00'); s=await reload(page); assert.equal(rule(s).kind,kind); assert.equal(Object.hasOwn(rule(s),'days'),false);
    }
    await choose(page,[]); s=await reload(page);
    assert.equal(rule(s),undefined); assert.equal(s.tasks.find(t=>t.id==='card-a').twyPlan.perWeek,0);
    assert.equal(live(s).length,1); assert.equal(live(s)[0].comment,'保存用の値');
    const ended=s.recurrences.map(r=>r.id); await day(page,1); s=await reload(page);
    assert.ok(!ended.includes(rule(s).id),'ended rules are not revived');
    assert.ok(ended.every(id=>s.recurrences.find(r=>r.id===id).deleted));
    for (const offset of [2, 16]) {
      const anchor=addDaysISO(week,offset);
      await page.evaluate(async anchor=>{ const s=(await import('/src/state/store.js')).state; const r=s.recurrences.find(r=>!r.deleted); Object.assign(r,{kind:'monthly',anchorDate:anchor}); delete r.days; s.blocks=[]; },anchor);
      await plan(page); assert.match(await card(page).innerText(), new RegExp(`毎月 ${Number(anchor.slice(8))} 日 · この週は ${offset===2?1:0} 回`));
    }
    const monthlyTime=card(page).locator('[data-action="twy-decide-time"]'); await monthlyTime.fill('08:30'); await monthlyTime.dispatchEvent('change');
    s=await reload(page); assert.equal(rule(s).kind,'monthly'); assert.equal(rule(s).anchorDate,addDaysISO(week,16)); assert.equal(rule(s).endTime,'08:55');
    await choose(page,[2,4],'09:00'); s=await reload(page); assert.equal(rule(s).kind,'weekly'); assert.deepEqual(rule(s).days,[2,4]);
    const removed=live(s).find(b=>b.date===addDaysISO(week,3));
    await choose(page,[4]); await choose(page,[2,4]); s=await reload(page);
    assert.equal(s.blocks.find(b=>b.id===removed.id).source,'','automatic tombstone marker is cleared when restored');
    await page.evaluate(async id=>{ const s=(await import('/src/state/store.js')).state; s.blocks.find(b=>b.id===id).deleted=true; },removed.id);
    await choose(page,[1,2,4]); s=await reload(page); assert.ok(s.blocks.find(b=>b.id===removed.id).deleted,'user deletion stays protected');
  }
  if (n === 3) {
    const time=card(page).locator('[data-action="twy-decide-time"]');
    assert.ok(await time.isDisabled()); assert.equal(await time.inputValue(),'07:30');
    await day(page,6); assert.ok(await time.isEnabled());
    let s=await reload(page); assert.equal(rule(s).startTime,'07:30'); assert.equal(rule(s).endTime,'07:55');
    await time.fill('09:00'); await time.dispatchEvent('change'); s=await reload(page);
    assert.equal(rule(s).startTime,'09:00'); assert.equal(rule(s).endTime,'09:25');
    assert.equal(live(s)[0].plannedStartAt,`${week}T09:00:00`); assert.equal(live(s)[0].plannedEndAt,`${week}T09:25:00`);
  }
  if (n === 4) {
    assert.ok(await card(page).locator('[data-action="twy-decide-move"][data-dir="-1"]').isDisabled());
    assert.ok(await card(page,'card-b').locator('[data-action="twy-decide-move"][data-dir="1"]').isDisabled());
    const before=await snapshot(page);
    await card(page).locator('[data-action="twy-decide-move"][data-dir="1"]').click();
    let s=await reload(page);
    assert.deepEqual(await page.locator('[data-decide-project="goal-a"] [data-decide-task]').evaluateAll(els=>els.map(el=>el.dataset.decideTask)),['card-b','card-a']);
    assert.ok(s.tasks.find(t=>t.id==='card-b').order<s.tasks.find(t=>t.id==='card-a').order);
    assert.deepEqual(s.tasks.find(t=>t.id==='card-c'),before.tasks.find(t=>t.id==='card-c'));
    await card(page).locator('[data-action="twy-decide-move"][data-dir="-1"]').click(); await reload(page);
    assert.equal(await page.locator('[data-decide-project="goal-a"] [data-decide-task]').first().getAttribute('data-decide-task'),'card-a');
  }
  if (n === 5) {
    for (const newline of ['\r','\r\n','\n']) {
      await page.evaluate(async newline=>{ const s=(await import('/src/state/store.js')).state; s.tasks.find(t=>t.id==='card-a').memo=`先頭${newline}後続${newline}`; },newline);
      await card(page).locator('[data-action="twy-decide-edit"]').click();
      const memo=page.locator('[data-modal-field="memo"]'); assert.equal(await memo.inputValue(),'先頭');
      await memo.fill('新しい <先頭>');
      assert.ok(await memo.evaluate(el=>el===document.activeElement),'typing does not rerender');
      await page.locator('[data-modal-field="estimateMin"]').fill('40');
      await page.locator('[data-modal-field="keystone"]').uncheck();
      await page.locator('[data-action="twy-decide-save"]').click();
      let s=await reload(page), t=s.tasks.find(t=>t.id==='card-a');
      assert.equal(t.memo,`新しい <先頭>${newline}後続${newline}`); assert.equal(t.estimateMin,40); assert.equal(t.twyPlan.keystone,false);
      assert.equal(await card(page).locator('[data-decide-memo-preview]').innerText(),'新しい <先頭>');
      assert.equal(rule(s),undefined,'editing an unscheduled card does not create a rule');
    }
    await day(page,6); assert.equal(rule(await snapshot(page)).endTime,'08:10');
    await card(page).locator('[data-action="twy-decide-edit"]').click();
    await page.locator('[data-modal-field="estimateMin"]').fill('180'); await page.locator('[data-modal-field="keystone"]').check();
    await page.locator('[data-action="twy-decide-save"]').click(); const s=await reload(page);
    assert.equal(rule(s).endTime,'10:30'); assert.equal(live(s)[0].plannedEndAt,`${week}T10:30:00`);
    assert.equal(s.tasks.find(t=>t.id==='card-a').twyPlan.keystone,true);
  }
  if (n === 6) {
    await choose(page,[2,6]);
    await page.evaluate(async week=>{ const s=(await import('/src/state/store.js')).state; s.blocks.find(b=>b.taskId==='card-a'&&b.date===week&&!b.deleted).comment='残す'; },week);
    const before=await snapshot(page), id=rule(before).id;
    const remove=card(page).locator('[data-action="twy-decide-remove"]'); await remove.click();
    assert.equal(await remove.innerText(),'本当に終了');
    await remove.evaluate(el=>el.click()); assert.ok(rule(await snapshot(page)),'immediate second click is rejected');
    // Advance the injected clock to the exact confirmation boundary (no wall-clock sleep).
    const after=Number(await remove.getAttribute('data-confirm-after'));
    await page.clock.setFixedTime(new Date(after)); await remove.click();
    const s=await reload(page); assert.ok(s.recurrences.find(r=>r.id===id).deleted);
    assert.equal(s.tasks.find(t=>t.id==='card-a').status,'todo'); assert.equal(s.tasks.find(t=>t.id==='card-a').twyPlan.perWeek,0);
    assert.ok(!s.blocks.some(b=>b.recurrenceGroupId===id&&b.date>=week&&!b.comment&&!b.deleted));
    assert.ok(s.blocks.some(b=>b.comment==='残す')); assert.ok(s.blocks.some(b=>b.id==='miss'&&b.date===previous));
    assert.ok(await card(page).locator('[data-action="twy-decide-time"]').isDisabled());
  }
  if (n === 7) {
    const goal=page.locator('[data-decide-project="goal-a"]'), input=goal.locator('[data-decide-title]');
    const before=await snapshot(page); await input.fill('  '); await goal.locator('[data-action="twy-decide-create"]').click(); assert.deepEqual((await snapshot(page)).tasks,before.tasks);
    const ids=[];
    for (const projectId of ['goal-a','goal-b','goal-a']) {
      const root=page.locator(`[data-decide-project="${projectId}"]`), before=await snapshot(page);
      await root.locator('[data-decide-title]').fill('保存用の値'); await root.locator('[data-action="twy-decide-create"]').click();
      let s=await reload(page), t=s.tasks.find(t=>!before.tasks.some(old=>old.id===t.id)); assert.ok(t); ids.push(t.id);
      assert.equal(t.projectId,projectId); assert.equal(t.twyPlan.perWeek,0); assert.equal(t.twyPlan.keystone,false);
      assert.equal(s.recurrences.filter(r=>r.taskId===t.id).length,0); assert.equal(await card(page,t.id).locator('[data-decide-end]').inputValue(),'07:55');
      await day(page,1,t.id); s=await reload(page); assert.equal(s.recurrences.filter(r=>r.taskId===t.id&&!r.deleted).length,1);
      assert.ok(s.blocks.some(b=>b.taskId===t.id&&!b.deleted));
    }
    assert.equal(new Set(ids).size,3);
    const s=await snapshot(page);
    const duplicate=await page.evaluate(async ({id,week})=>(await import('/src/core/recurrence.js')).createRecurrenceRule({taskId:id,title:'保存用の値',date:week,plannedStartAt:`${week}T07:30`},'weekly',{sameTaskOnly:true}),{id:ids[0],week});
    // The rule uses the actual task title; reject its same-task duplicate.
    if (duplicate) throw new Error('same task duplicate unexpectedly created');
    assert.deepEqual((await snapshot(page)).recurrences,s.recurrences);
    const beforeFailure=await snapshot(page);
    await page.evaluate(key=>{ window.restoreCardStorage=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){ if(k===key) throw new Error('73c storage failure'); return window.restoreCardStorage.call(this,k,v); }; },STATE_KEY);
    await input.fill('保存失敗時の入力'); await goal.locator('[data-action="twy-decide-create"]').click();
    const failed=await snapshot(page); assert.deepEqual(failed.tasks,beforeFailure.tasks); assert.deepEqual(failed.recurrences,beforeFailure.recurrences); assert.deepEqual(failed.blocks,beforeFailure.blocks);
    assert.equal(await input.inputValue(),'保存失敗時の入力');
    await page.evaluate(()=>{ Storage.prototype.setItem=window.restoreCardStorage; delete window.restoreCardStorage; });
    await page.locator('[data-decide-project="goal-a"] [data-action="nav"][data-view="wbs"]').click();
    assert.ok((await snapshot(page)).tasks.filter(t=>ids.includes(t.id)).every(t=>t.title==='保存用の値'));
  }
  if (n === 8) {
    const add=page.locator('[data-action="twy-decide-candidate"][data-id="miss"]');
    const before=await snapshot(page); await add.click(); let s=await reload(page);
    assert.equal(live(s).length,1); assert.equal(live(s)[0].date,week); assert.equal(live(s)[0].plannedStartAt,`${week}T09:00:00`);
    assert.ok(await add.isDisabled()); assert.match(await add.innerText(),/追加済み/);
    assert.deepEqual(s.recurrences,before.recurrences); assert.deepEqual(s.tasks,before.tasks);
    assert.deepEqual(s.blocks.find(b=>b.id==='miss'),before.blocks.find(b=>b.id==='miss'));
    await add.evaluate(el=>el.click()); assert.equal(live(await snapshot(page)).length,1);
    const pool=page.locator('[data-action="twy-decide-pool"][data-id="pool"]'); assert.equal(await pool.count(),1);
    await pool.click(); s=await reload(page); assert.equal(s.tasks.find(t=>t.id==='pool').status,'todo');
    assert.equal(s.tasks.find(t=>t.id==='pool').twyPlan.perWeek,0); assert.equal(await card(page,'pool').count(),1);
    assert.equal(s.recurrences.length,0); assert.equal(await page.locator('[data-decide-pool]').count(),0,'empty pool section omitted');
  }
  if (n === 9) {
    assert.match(await page.locator('.twy-decide-total').innerText(),/3 件.*週 0 回.*約 0 時間.*確定済み/s);
    await day(page,6); assert.match(await page.locator('.twy-decide-total').innerText(),/週 1 回.*約 0.4 時間.*確定後に変更あり/s);
    assert.match(await page.locator('.twy-decide [data-action="twy-open-commit"]').innerText(),/これで決める/);
    await page.evaluate(async week=>{ const s=(await import('/src/state/store.js')).state; for(let i=0;i<6;i++) s.blocks.push({id:`crowd-${i}`,taskId:'card-a',date:week}); },week);
    await plan(page); assert.match(await page.locator('.twy-decide-total').innerText(),/5 回を超える日があります\(土\)/);
    await page.locator('.twy-decide [data-action="twy-open-commit"]').click(); assert.equal((await snapshot(page)).modal.id,week);
    await page.locator('[data-action="modal-close"]').click();
    const [y,m,d]=addDaysISO(week,2).split('-').map(Number); await page.clock.setFixedTime(new Date(y,m-1,d,10)); await plan(page);
    assert.equal(await page.locator('[data-decide-week]').getAttribute('data-decide-week'),addDaysISO(week,7));
    await page.locator('.twy-decide [data-action="twy-open-commit"]').click(); assert.equal((await snapshot(page)).modal.id,addDaysISO(week,7));
    await page.locator('[data-action="modal-close"]').click();
  }
  if (n === 10) {
    for (const width of [375,768,1280]) {
      await setViewportAndWaitForStableLayout(page,{width,height:1000},'.twy-decide');
      const metrics=await page.locator('.twy-decide').evaluate(root=>({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
        controls:[...root.querySelectorAll('button,input')].map(el=>({day:el.dataset.action==='twy-decide-day',w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height,font:parseFloat(getComputedStyle(el).fontSize),input:el.tagName==='INPUT'})),
        columns:[...root.querySelector('.twy-decide-columns').children].map(el=>el.getBoundingClientRect().toJSON())}));
      assert.equal(metrics.overflow,false,`${width}: no overflow`);
      assert.ok(metrics.controls.every(c=>c.w>=(c.day?40:44)&&c.h>=(c.day?40:44)),JSON.stringify(metrics.controls));
      assert.ok(metrics.controls.filter(c=>c.input).every(c=>c.font>=16));
      assert.equal(metrics.columns[0].y===metrics.columns[1].y,width>=768);
      assert.equal(await card(page).locator('[data-action="twy-decide-time"]').getAttribute('type'),'time');
      assert.equal(await card(page).locator('[data-action="twy-decide-time"]').getAttribute('step'),'300');
      await card(page).locator('[data-action="twy-decide-edit"]').click();
      await page.locator('.twy-decide-sheet').evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished)); });
      await setViewportAndWaitForStableLayout(page,{width,height:1000},'.twy-decide-sheet input');
      const sheet=await page.locator('.twy-decide-sheet').evaluate(root=>({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
        inputs:[...root.querySelectorAll('input')].map(el=>({font:parseFloat(getComputedStyle(el).fontSize),h:el.getBoundingClientRect().height}))}));
      assert.equal(sheet.overflow,false); assert.ok(sheet.inputs.every(c=>c.font>=16&&c.h>=44), JSON.stringify(sheet));
      await page.locator('.twy-decide-sheet [data-action="modal-close"]').click();
    }
  }
  page.off('console', diagnostic);
  console.log(`PASS 73c acceptance ${n}`);
}
async function browserChecks(acceptances=Array.from({length:10},(_,i)=>i+1)) {
  const {page,browser,server}=await setup(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  try { for(const n of acceptances) await runCardAcceptance(page,n); assert.deepEqual(errors,[]); }
  finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
module.exports={browserChecks,runCardAcceptance};
if(require.main===module) browserChecks().catch(e=>{console.error(e);process.exitCode=1;});
