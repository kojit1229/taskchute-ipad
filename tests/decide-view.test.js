const assert = require('node:assert/strict');
const { chromium, launchOptions, defaultContextOptions, fixedClock, startServer, randomPort, passGithubGate, STATE_KEY } = require('./helpers');
(async () => {
  let server, browser, failures = 0;
  try {
    server = startServer(randomPort()); browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ ...defaultContextOptions(), reducedMotion: 'reduce', viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    const monday = new Date();
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    const now = fixedClock(monday.setHours(12, 0, 0, 0));
    await page.clock.setFixedTime(new Date(now()));
    await page.goto(`http://localhost:${server.address().port}/`); await passGithubGate(page);
    const fixture = await page.evaluate(async () => {
      const { state } = await import('/src/state/store.js');
      const today = new Date(), iso = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      const date = offset => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate()+offset); return iso(d); };
      const task = (id, title, extra = {}) => ({ id, title, projectId: 'p', parentTaskId: '', status: 'todo', kind: 'task', createdAt: date(-30)+'T10:00:00', dueDate: '', estimateMin: 30, ...extra });
      state.projects = [{ id:'p',title:'管理Project',category:'仕事',dueManaged:true,status:'active' }, { id:'q',title:'自由Project',category:'私用',status:'active' }];
      state.tasks = [task('s3','物語 3巻'),task('s1','物語 1巻'),task('s2','物語 2巻'),task('late','期限超過',{dueDate:date(1),status:'doing'}),task('today','今日の期日',{dueDate:date(2)}),task('week','今週',{dueDate:date(9)}),task('later','来週より後',{dueDate:date(10)}),
        task('parent','親の作業',{dueDate:date(15)}),task('child','子だけ検索',{parentTaskId:'parent'}),task('kid1','学習 1回',{parentTaskId:'parent'}),task('kid2','学習 2回',{parentTaskId:'parent'}),
        task('new','新しい作業',{createdAt:date(-1)+'T10:00:00'}), ...Array.from({length:5},(_,i)=>task('n'+i,'期日未定 '+i,{createdAt:date(-20+i)+'T10:00:00'})),
        task('free','自由な作業',{projectId:'q'}),task('done','完了済',{status:'completed'}),task('suspended','中断中',{status:'suspended'}),task('deleted','削除済',{deleted:true})];
      state.settings.wbsHideCompleted = true; state.settings.wbsHideDoneProjects = true; state.settings.showSuspended = false;
      state.settings.autoSync = false; state.settings.github.autoSave = false;
      return { date: date(0), suggestion: date(5), recent: date(13), overdue: date(-1) };
    });
    await page.locator('#sidebar [data-action="nav"][data-view="decide"]').evaluate(el => el.click());
    const root = page.locator('[data-decide-view]');
    const taskRow = id => root.locator(`[data-work-key="task:${id}"]`);
    const snapshot = () => page.evaluate(async key => ({ state:JSON.stringify((await import('/src/state/store.js')).state), stored:localStorage.getItem(key) }), STATE_KEY);
    const before = await snapshot();
    async function check(name, run) { try { assert.equal(await root.count(),1,'decide is a separate view'); await run(); console.log('PASS '+name); } catch (error) { failures++; console.error('FAIL '+name+': '+error.stack); } }
    await check('U3-9 sidebar, More and WBS link; mobile stays six', async () => {
      assert.equal(await page.locator('.bottom-nav [data-action="nav"]').count(),6);
      await page.locator('#sidebar [data-view="wbs"]').evaluate(el=>el.click());
      const link=page.locator('[data-work-list="wbs"] [data-view="decide"]');
      assert((await link.textContent()).includes('期日が決まっていないもの 9 件 → 決めること'));
      assert.equal(await page.locator('[data-work-list="wbs"] [data-nudge-id]').count(),0);
      await link.click(); assert.equal(await root.count(),1);
      await page.locator('#sidebar [data-view="more"]').evaluate(el=>el.click());
      await page.locator('.more-tower-item[data-view="decide"]').click();
      assert.equal(await root.count(),1);
    });
    await check('U3-10 managed aggregate chips and toggle', async () => {
      for (const [key,label,count] of [['overdue','超過',1],['today','今日',1],['week','7日以内',1],['none','期日なし',9]]) {
        const chip = root.locator(`[data-action="decide-filter"][data-value="${key}"]`);
        assert.equal((await chip.textContent()).trim(),`${label} ${count}`);
        await chip.click(); assert.equal(await chip.getAttribute('aria-pressed'),'true');
        if(key==='overdue') { assert.equal(await taskRow('late').count(),1); assert.equal(await taskRow('free').count(),0); }
        await chip.click(); assert.equal(await chip.getAttribute('aria-pressed'),'false');
      }
      assert.deepEqual(await snapshot(),before,'display interactions never persist or modify state');
    });
    await check('U3-11 oldest five proposals and enabled adoption controls', async () => {
      assert((await root.textContent()).includes('今日 0/5 件'));
      assert.deepEqual(await root.locator('[data-nudge-id]').evaluateAll(rows=>rows.map(row=>row.dataset.nudgeId)),['s1','n0','n1','n2','n3']);
      const first = root.locator('[data-nudge-id="s1"]');
      assert.equal(await first.getAttribute('data-suggestion'),fixture.suggestion);
      assert((await first.textContent()).includes('5日後')); assert((await first.textContent()).includes('管理Project'));
      assert(/[日月火水木金土]曜/.test(await first.textContent()));
      for (const action of ['decide-adopt','decide-pick']) assert(await first.locator(`[data-action="${action}"]`).isEnabled());
      assert(await first.locator('[data-work-nudge-cycle]').isEnabled());
      assert.equal(await root.locator('[data-nudge-id="child"]').count(),0);
      const oldTasks = await page.evaluate(async()=>{
        const {state}=await import('/src/state/store.js'), old=state.tasks;
        state.tasks=old.filter(t=>['new','parent','child'].includes(t.id));
        document.querySelector('[data-decide-view]').outerHTML=(await import('/src/features/decide-view.js')).renderDecideView();
        return old;
      });
      assert.equal(await root.locator('[data-nudge-id="child"]').count(),0,'A-4: inherited parent due excludes child even with fewer than five candidates');
      assert.equal(await root.locator('[data-nudge-id="new"]').getAttribute('data-suggestion'),fixture.recent);
      assert((await root.locator('[data-nudge-id="new"]').textContent()).includes('作成から2週間'));
      const friday = await page.evaluate(async () => {
        const {state}=await import('/src/state/store.js'), now=new Date();
        const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        state.projects[0].twelveWeekStartDate=iso(now);
        const fri=new Date(now.getFullYear(),now.getMonth(),now.getDate()+4-(now.getDay()+6)%7);
        document.querySelector('[data-decide-view]').outerHTML=(await import('/src/features/decide-view.js')).renderDecideView();
        return iso(fri);
      });
      assert.equal(await root.locator('[data-nudge-id="new"]').getAttribute('data-suggestion'),friday);
      assert((await root.locator('[data-nudge-id="new"]').textContent()).includes('12週目標の週の金曜'));

      await page.evaluate(async tasks=>{(await import('/src/state/store.js')).state.tasks=tasks;document.querySelector('[data-decide-view]').outerHTML=(await import('/src/features/decide-view.js')).renderDecideView();},oldTasks);
      await first.locator('[data-action="decide-adopt"]').click();
      assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).tasks.find(t=>t.id==='s1').dueDate,STATE_KEY),friday);
    });
    await check('U3-12 mobile layout and mock wording', async () => {
      await page.setViewportSize({width:375,height:900});
      assert.equal(await root.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert((await root.textContent()).includes('期日を決めてほしいもの'));
      assert((await root.textContent()).includes('期日なし…'));
      assert.deepEqual(errors,[]);
    });
    await check('B-2 Project management checkbox persists ON and OFF', async () => {
      await page.setViewportSize({width:1280,height:900});
      for (const enabled of [true,false]) {
        await page.locator('#sidebar [data-view="wbs"]').evaluate(el=>el.click());
        await page.locator('[data-work-group="q"] [data-action="edit-project"]').click();
        const checkbox=page.locator('[data-modal-field="dueManaged"]');
        assert.equal(await checkbox.count(),1);
        await checkbox.setChecked(enabled);
        await page.locator('[data-action="modal-save"]').click();
        assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).projects.find(p=>p.id==='q').dueManaged,STATE_KEY),enabled);
        await page.locator('#sidebar [data-view="decide"]').evaluate(el=>el.click());
        const count=await page.evaluate(async()=> (await import('/src/features/decide-view.js')).undecidedCount());
        assert.equal(count,enabled?10:9);
      }
    });
    await check('B-3 B-5 adoption and native date selection persist and consume today quota', async () => {
      await page.locator('#sidebar [data-view="decide"]').evaluate(el=>el.click());
      assert((await root.textContent()).includes('今日 1/5 件'));
      assert.equal(await root.locator('[data-nudge-id="s1"]').count(),0);
      const row=root.locator('[data-nudge-id]').first(), id=await row.getAttribute('data-nudge-id');
      await row.locator('[data-action="decide-pick"]').click();
      const input=row.locator('input[type="date"]');
      assert.equal(await input.count(),1);
      const size=await input.evaluate(el=>({font:parseFloat(getComputedStyle(el).fontSize),height:el.getBoundingClientRect().height}));
      assert(size.font>=16&&size.height>=44);
      const beforeFailure=await snapshot();
      await page.evaluate(key=>{
        window.__bundleBSetItem=Storage.prototype.setItem;
        Storage.prototype.setItem=function(name,value){if(name===key)throw new DOMException('injected quota failure','QuotaExceededError');return window.__bundleBSetItem.call(this,name,value);};
      },STATE_KEY);
      try {
        await input.evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},fixture.recent);
        assert.equal(await input.inputValue(),'','failed save restores the date input');
        assert.deepEqual(await snapshot(),beforeFailure,'failed adoption saves neither dueDate nor quota');
        assert((await page.locator('body').textContent()).includes('端末に保存できませんでした'));
      } finally {
        await page.evaluate(()=>{Storage.prototype.setItem=window.__bundleBSetItem;delete window.__bundleBSetItem;});
      }
      await input.evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},fixture.recent);
      await input.dispatchEvent('change');
      const saved=await page.evaluate(({key,id})=>JSON.parse(localStorage.getItem(key)).tasks.find(t=>t.id===id),{key:STATE_KEY,id});
      assert.equal(saved.dueDate,fixture.recent); assert.equal(saved.dueDecidedAt,fixture.date);
      assert.equal(await root.locator(`[data-nudge-id="${id}"]`).count(),0);
      assert((await root.textContent()).includes('今日 2/5 件'));
      for(let i=2;i<5;i++) await root.locator('[data-action="decide-adopt"]').first().click();
      assert((await root.textContent()).includes('今日 5/5 件'));
      assert.equal(await root.locator('[data-nudge-id]').count(),0);
      assert((await root.textContent()).includes('今日の分(5 件)は決め終わりました。続きは明日。'));
      assert.deepEqual(errors,[]);
    });
    const refresh = () => page.evaluate(async()=>{document.querySelector('[data-decide-view]').outerHTML=(await import('/src/features/decide-view.js')).renderDecideView();});
    const storedTask = id => page.evaluate(({key,id})=>JSON.parse(localStorage.getItem(key)).tasks.find(t=>t.id===id),{key:STATE_KEY,id});
    async function resetNudges(series = false) {
      await page.evaluate(async series=>{
        const {state}=await import('/src/state/store.js'), now=new Date();
        const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        state.tasks=Array.from({length:8},(_,i)=>({id:'r'+i,title:series&&i<3?`読書 ${i+1}巻`:`確認 ${i}`,projectId:'p',parentTaskId:'',status:'todo',kind:'task',dueDate:'',estimateMin:30,createdAt:iso(new Date(now.getFullYear(),now.getMonth(),now.getDate()-30+i))+'T10:00:00'}));
      },series);
      await refresh();
    }
    await check('B-4 reminder cycles, rollback, two rechecks per day and total five', async () => {
      await resetNudges();
      const select = id => root.locator(`[data-work-nudge-cycle="${id}"]`);
      assert.deepEqual(await select('r0').locator('option').allTextContents(),['期日なし…','1週間後に再確認','1か月後に再確認','3か月後に再確認','促さない']);
      const size=await select('r0').evaluate(el=>({font:parseFloat(getComputedStyle(el).fontSize),height:el.getBoundingClientRect().height}));
      assert(size.font>=16&&size.height>=44);
      const initial=await snapshot();
      await page.evaluate(key=>{window.__nudgeSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('injected failure','QuotaExceededError');return window.__nudgeSetItem.call(this,k,v);};},STATE_KEY);
      try {
        await select('r0').selectOption('1m');
        assert.equal(await select('r0').inputValue(),'');
        assert.deepEqual(await snapshot(),initial);
        assert((await page.locator('body').textContent()).includes('端末に保存できませんでした'));
      } finally { await page.evaluate(()=>{Storage.prototype.setItem=window.__nudgeSetItem;delete window.__nudgeSetItem;}); }
      const expected=await page.evaluate(()=>{
        const d=new Date(), iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const month=n=>iso(new Date(d.getFullYear(),d.getMonth()+n,Math.min(d.getDate(),new Date(d.getFullYear(),d.getMonth()+n+1,0).getDate())));
        return {today:iso(d),week:iso(new Date(d.getFullYear(),d.getMonth(),d.getDate()+7)),month:month(1),quarter:month(3)};
      });
      for(const [id,cycle,at] of [['r0','1m',expected.month],['r1','1w',expected.week],['r2','3m',expected.quarter]]) {
        await select(id).selectOption(cycle);
        assert.deepEqual((await storedTask(id)).dueNudge,{cycle,at,decidedAt:expected.today,key:id,count:1});
        assert.equal(await root.locator(`[data-nudge-id="${id}"]`).count(),0);
      }
      assert.equal(await root.locator('[data-value="sleep"]').textContent(),'再確認待ち 3');
      assert((await root.textContent()).includes('今日 3/5 件'));
      await root.locator('[data-action="decide-adopt"]').first().click();
      await root.locator('[data-action="decide-adopt"]').first().click();
      assert((await root.textContent()).includes('今日の分(5 件)は決め終わりました。続きは明日。'));
      const [y,m,d]=expected.quarter.split('-').map(Number);
      await page.clock.setFixedTime(new Date(y,m-1,d+1,12)); await refresh();
      assert.deepEqual(await root.locator('[data-nudge-id]').evaluateAll(rows=>rows.filter(r=>r.querySelector('strong').textContent.includes('再確認')).map(r=>r.dataset.nudgeId)),['r1','r0']);
      for(const id of ['r1','r0']) {
        await select(id).selectOption('1w');
        assert.equal((await storedTask(id)).dueNudge.count,2);
      }
      await refresh();
      assert.equal(await root.locator('[data-nudge-id="r2"]').count(),0,'third recheck waits until tomorrow');
      assert((await root.textContent()).includes('今日 2/5 件'));
      await page.clock.setFixedTime(new Date(y,m-1,d+2,12)); await refresh();
      assert((await root.locator('[data-nudge-id="r2"]').textContent()).includes('再確認'));
      const stable=await snapshot(); await refresh(); assert.deepEqual(await snapshot(),stable,'render never mutates or saves state');
    });
    await check('B-4 series carries reminders on decision and completion; never can be cleared', async () => {
      await resetNudges(true);
      await root.locator('[data-work-nudge-cycle="r0"]').selectOption('never');
      const reminder=(await storedTask('r0')).dueNudge;
      assert.equal(reminder.key,'s:p||読書|巻'); assert.equal(reminder.at,'9999-12-31');
      assert.deepEqual((await storedTask('r1')).dueNudge,reminder,'decision carries the series key');
      assert((await root.textContent()).includes('今日 1/5 件'),'series copies count once');
      assert.equal(await root.locator('[data-value="never"]').textContent(),'促さない 1');
      await root.locator('[data-value="never"]').click();
      assert.equal(await root.locator('[data-decide-results] [data-work-key]').count(),1);
      // Remove the copied value in memory to exercise the completion save path independently.
      await page.evaluate(async()=>{const {state}=await import('/src/state/store.js');delete state.tasks.find(t=>t.id==='r1').dueNudge;});
      await root.locator('[data-action="toggle-task"][data-id="r0"]').click();
      assert.deepEqual((await storedTask('r1')).dueNudge,reminder);
      assert.equal(await root.locator('[data-nudge-id="r1"]').count(),0);
      assert.equal(await root.locator('[data-value="never"]').textContent(),'促さない 1');
      await root.locator('[data-action="decide-resume"][data-id="r1"]').click();
      assert.equal((await storedTask('r1')).dueNudge,null);
      assert.equal((await storedTask('r2')).dueNudge,null);
      assert.equal(await root.locator('[data-value="never"]').count(),0);
      await root.locator('[data-action="decide-adopt"][data-id="r1"]').click();
      assert((await storedTask('r1')).dueDate);
      assert.equal((await storedTask('r2')).dueNudge,null);
      assert.deepEqual(errors,[]);
    });
    await check('B-7 inline due edit refreshes counts and rejects stale decisions', async () => {
      await resetNudges();
      const chip = root.locator('[data-value="none"]');
      if (await chip.getAttribute('aria-pressed') !== 'true') await chip.click();
      await page.evaluate(() => { window.__staleNudge = document.querySelector('[data-nudge-id="r0"]').outerHTML; });
      await taskRow('r0').locator('[data-work-edit="dueDate"]').evaluate((el, value) => {
        el.value = value; el.dispatchEvent(new Event('change', { bubbles: true }));
      }, fixture.recent);
      const afterEdit = {
        count: await chip.textContent(), row: await taskRow('r0').count(),
        nudge: await root.locator('[data-nudge-id="r0"]').count()
      };
      const saved = await snapshot();
      // Reinsert the old proposal to exercise a stale event after the row edit.
      for (const action of ['decide-adopt', 'decide-pick', 'cycle']) {
        await refresh();
        await root.evaluate(el => el.insertAdjacentHTML('beforeend', window.__staleNudge));
        const stale = root.locator('[data-nudge-id="r0"]').last();
        if (action === 'cycle') await stale.locator('select').selectOption('1w');
        else {
          await stale.locator(`[data-action="${action}"]`).click();
          if (action === 'decide-pick' && await stale.locator('input[type="date"]').count()) {
            await stale.locator('input').evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }, fixture.suggestion);
          }
        }
        assert.deepEqual(await snapshot(), saved, action + ' must not save a stale decision');
        assert.equal(await root.locator('[data-nudge-id="r0"]').count(), 0);
      }
      assert.deepEqual(afterEdit, { count: '期日なし 7', row: 0, nudge: 0 });
      assert.equal((await storedTask('r0')).dueDate, fixture.recent);
      await page.evaluate(() => { delete window.__staleNudge; });
    });
    await check('B-8 recompleting an old volume preserves the newer second decision', async () => {
      await resetNudges(true);
      const chip = root.locator('[data-value="none"]');
      if (await chip.getAttribute('aria-pressed') !== 'true') await chip.click();
      await root.locator('[data-work-nudge-cycle="r0"]').selectOption('1m');
      const original = (await storedTask('r0')).dueNudge;
      await taskRow('r0').locator('[data-action="toggle-task"]').click();
      const [y, m, d] = original.at.split('-').map(Number);
      await page.clock.setFixedTime(new Date(y, m - 1, d, 12)); await refresh();
      await root.locator('[data-work-nudge-cycle="r1"]').selectOption('1w');
      const newer = (await storedTask('r1')).dueNudge;
      assert.equal(newer.count, 2); assert(newer.decidedAt > original.decidedAt);
      // The old completed volume is hidden; use its normal delegated completion action.
      for (const status of ['doing', 'completed']) {
        await root.evaluate(el => {
          el.insertAdjacentHTML('beforeend', '<button data-action="toggle-task" data-id="r0" data-fixb-old-volume>old volume</button>');
          el.querySelector('[data-fixb-old-volume]').click();
        });
        assert.equal((await storedTask('r0')).status, status);
      }
      assert.deepEqual((await storedTask('r1')).dueNudge, newer);
      assert.deepEqual(errors, []);
    });
    assert.equal(failures,0,'acceptance failures');
  } finally { if(browser) await browser.close(); if(server) await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
