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
    await check('U3-11 oldest five proposals and disabled controls', async () => {
      assert((await root.textContent()).includes('今日 0/5 件'));
      assert.deepEqual(await root.locator('[data-nudge-id]').evaluateAll(rows=>rows.map(row=>row.dataset.nudgeId)),['s1','n0','n1','n2','n3']);
      const first = root.locator('[data-nudge-id="s1"]');
      assert.equal(await first.getAttribute('data-suggestion'),fixture.suggestion);
      assert((await first.textContent()).includes('5日後')); assert((await first.textContent()).includes('管理Project'));
      assert(/[日月火水木金土]曜/.test(await first.textContent()));
      assert.equal(await root.locator('[data-nudge-id] button:disabled').count(),15);
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
    });
    await check('U3-12 mobile layout and mock wording', async () => {
      await page.setViewportSize({width:375,height:900});
      assert.equal(await root.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert((await root.textContent()).includes('期日を決めてほしいもの'));
      assert((await root.textContent()).includes('期日なし…'));
      assert.deepEqual(errors,[]);
    });
    assert.equal(failures,0,'acceptance failures');
  } finally { if(browser) await browser.close(); if(server) await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
