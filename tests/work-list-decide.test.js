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
    const now = fixedClock(new Date().setHours(12, 0, 0, 0));
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
    await page.locator('#sidebar [data-action="nav"][data-view="wbs"]').evaluate(el => el.click());
    const root = page.locator('[data-work-list="wbs"]');
    const taskRow = id => root.locator(`[data-work-key="task:${id}"]`);
    const snapshot = () => page.evaluate(async key => ({ state:JSON.stringify((await import('/src/state/store.js')).state), stored:localStorage.getItem(key) }), STATE_KEY);
    const before = await snapshot();
    async function check(name, run) { try { assert.equal(await root.count(),1,'new list is the WBS entry'); await run(); console.log('PASS '+name); } catch (error) { failures++; console.error('FAIL '+name+': '+error.stack); } }
    await check('U2-4 managed aggregate chips and toggle', async () => {
      for (const [key,label,count] of [['overdue','超過',1],['today','今日',1],['week','7日以内',1],['none','期日なし',9]]) {
        const chip = root.locator(`[data-action="work-list-toggle"][data-kind="due"][data-value="${key}"]`);
        assert.equal((await chip.textContent()).trim(),`${label} ${count}`);
        await chip.click(); assert.equal(await chip.getAttribute('aria-pressed'),'true');
        if(key==='overdue') { assert.equal(await taskRow('late').count(),1); assert.equal(await taskRow('free').count(),0); }
        await chip.click(); assert.equal(await chip.getAttribute('aria-pressed'),'false');
      }
    });
    await check('U2-5 oldest five nudges with disabled controls', async () => {
      assert((await root.locator('[data-work-decide]').textContent()).includes('今日 0/5 件'));
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
        (await import('/src/features/work-list.js')).updateWorkLists();
        return old;
      });
      assert.equal(await root.locator('[data-nudge-id="new"]').getAttribute('data-suggestion'),fixture.recent);
      assert((await root.locator('[data-nudge-id="new"]').textContent()).includes('作成から2週間'));
      await page.evaluate(async tasks=>{(await import('/src/state/store.js')).state.tasks=tasks;(await import('/src/features/work-list.js')).updateWorkLists();},oldTasks);
    });
    await check('U2-6 project groups series and child rows', async () => {
      const group = root.locator('[data-work-group="p"]'), summary = group.locator('summary');
      if (await group.getAttribute('open') === null) await summary.click();
      assert.equal(await taskRow('s1').count(),1); assert.equal(await taskRow('s2').count(),0);
      const expand = taskRow('s1').locator('[data-kind="series"]'); assert.equal((await expand.textContent()).trim(),'+2件');
      await expand.click(); assert.equal(await taskRow('s2').count(),1); assert.equal(await taskRow('s3').count(),1); await expand.click();
      assert((await taskRow('late').textContent()).includes('着手中')); assert((await taskRow('late').textContent()).includes('超過 1日'));
      assert((await taskRow('late').textContent()).includes('作業 ')); assert((await taskRow('late').textContent()).includes('見積 30分'));
      assert((await taskRow('child').textContent()).includes('└'));
      assert.equal(await taskRow('kid1').count(),1); assert.equal(await taskRow('kid2').count(),0);
      assert((await summary.textContent()).includes('仕事')); assert(/\d+\/\d+件/.test(await summary.textContent()));
      await summary.click(); assert.equal(await group.getAttribute('open'),null); await summary.click(); assert.notEqual(await group.getAttribute('open'),null);
    });
    await check('U2-7 title search project chips ancestor context and IME', async () => {
      const query = root.locator('[data-work-filter="query"]');
      await query.fill('物語'); assert.equal(await root.locator('[data-work-key]').count(),3);
      await query.evaluate(el=>{ window.__decideInput=el; el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})); el.value='子だけ'; el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true})); });
      assert.equal(await root.locator('[data-work-key]').count(),3);
      await query.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
      assert.equal(await root.locator('[data-work-key]').count(),2); assert((await taskRow('parent').textContent()).includes('(条件外の親)'));
      assert(await query.evaluate(el=>el===window.__decideInput&&el===document.activeElement));
      await query.fill('管理Project'); assert.equal(await root.locator('[data-work-key]').count(),0,'only titles are searched'); await query.fill('');
      const chip = root.locator('[data-kind="project"][data-value="q"]'); await chip.click(); assert.equal(await root.locator('[data-work-key]').count(),1); assert.equal(await taskRow('free').count(),1);
      await root.locator('[data-kind="project"][data-value=""]').click();
      assert.deepEqual(await snapshot(),before,'display interactions never persist or modify state');
    });
    await check('U2-8 legacy search removed and visibility settings honored', async () => {
      assert.equal(await root.locator('.search-frame,[data-work-filter="status"],[data-work-filter="category"]').count(),0);
      assert.equal(await taskRow('done').count(),0); assert.equal(await taskRow('suspended').count(),0);
      await page.evaluate(async()=>{ const {state}=await import('/src/state/store.js'); state.settings.wbsHideCompleted=false;state.settings.showSuspended=true;(await import('/src/features/work-list.js')).updateWorkLists(); });
      assert.equal(await taskRow('done').count(),1); assert.equal(await taskRow('suspended').count(),1); assert.equal(await taskRow('deleted').count(),0);
    });
    await check('U2-9 responsive columns and no horizontal overflow', async () => {
      for (const width of [375,900,1280]) {
        await page.setViewportSize({width,height:900});
        const size = await root.evaluate(el=>{const side=el.querySelector('.work-decide-sidebar'),groups=el.querySelector('[data-work-list-rows]'),a=side.getBoundingClientRect(),b=groups.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,side:a.width,sideX:a.x,listX:b.x,listY:b.y,sideBottom:a.bottom,position:getComputedStyle(side).position,columns:getComputedStyle(groups).columnCount,font:parseFloat(getComputedStyle(el.querySelector('input')).fontSize)};});
        assert(!size.overflow,'overflow at '+width); assert(size.font>=16);
        if(width>=900) { assert.equal(Math.round(size.side),400); assert(size.listX>size.sideX); assert.equal(size.position,'sticky'); } else assert(size.listY>=size.sideBottom);
        assert.equal(size.columns,width>=1280?'2':'auto');
      }
      assert.deepEqual(errors,[]);
    });
    assert.equal(failures,0,'acceptance failures');
  } finally { if(browser) await browser.close(); if(server) await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
