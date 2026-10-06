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
      state.projects = [{ id:'p',title:'管理Project',category:'仕事',dueManaged:true,status:'active',twelveWeekStartDate:date(-7) }, { id:'q',title:'自由Project',category:'私用',status:'active' }];
      state.tasks = [task('s3','物語 3巻'),task('s1','物語 1巻'),task('s2','物語 2巻'),task('late','期限超過',{dueDate:date(1),status:'doing',progressNum:1,progressDen:4}),task('today','今日の期日',{dueDate:date(2)}),task('week','今週',{dueDate:date(9)}),task('later','来週より後',{dueDate:date(10)}),
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
    await check('U2-4 whole unfinished pool chips and list-only face', async () => {
      assert.equal(await root.locator('[data-work-decide]').count(),0);
      assert.equal(await page.locator('.wbs-week-panel').count(),0);
      assert.equal((await root.locator('[data-work-mode]').textContent()).trim(),'一覧');
      for (const [key,label,count] of [['overdue','超過',1],['week','7日以内',2],['none','期日なし',10]]) {
        const chip = root.locator(`[data-action="work-list-toggle"][data-kind="due"][data-value="${key}"]`);
        assert.equal((await chip.textContent()).trim(),`${label} ${count}`);
        await chip.click(); assert.equal(await chip.getAttribute('aria-pressed'),'true');
        if(key==='overdue') { assert.equal(await taskRow('late').count(),1); assert.equal(await taskRow('free').count(),0); }
        if(key==='none') { assert.equal(await taskRow('free').count(),1); assert((await taskRow('parent').textContent()).includes('(条件外の親)')); }
        await chip.click(); assert.equal(await chip.getAttribute('aria-pressed'),'false');
      }
    });
    await check('U2-5 project groups series and child rows', async () => {
      const group = root.locator('[data-work-group="p"]'), summary = group.locator('summary');
      if (await group.getAttribute('open') === null) await summary.click();
      assert.equal(await taskRow('s1').count(),1); assert.equal(await taskRow('s2').count(),0);
      const expand = taskRow('s1').locator('[data-kind="series"]'); assert.equal((await expand.textContent()).trim(),'+2件');
      await expand.click(); assert.equal(await taskRow('s2').count(),1); assert.equal(await taskRow('s3').count(),1); await expand.click();
      assert((await taskRow('late').textContent()).includes('着手中')); assert((await taskRow('late').textContent()).includes('超過 1日'));
      assert((await taskRow('late').textContent()).includes('作業 ')); assert((await taskRow('late').textContent()).includes('見積 30分'));
      assert((await taskRow('child').textContent()).includes('└'));
      assert((await taskRow('late').textContent()).includes('進捗 1/4'));
      assert((await group.textContent()).includes('進捗 1/4 (25%)'));
      assert((await group.textContent()).includes('12週計画 第2週'));
      assert((await group.textContent()).includes('期限超過 1'));
      const kids = taskRow('parent').locator('[data-kind=children]');
      await kids.click(); assert.equal(await taskRow('child').count(),0); assert.equal(await kids.textContent(),'▸');
      await kids.click(); assert.equal(await taskRow('child').count(),1);
      assert.equal(await taskRow('kid1').count(),1); assert.equal(await taskRow('kid2').count(),0);
      // A-1: entering a filter opens children once; manual toggles remain effective.
      const query = root.locator('[data-work-filter="query"]');
      await kids.click();
      await query.fill('子だけ'); assert.equal(await taskRow('child').count(),1);
      await kids.click(); assert.equal(await taskRow('child').count(),0);
      await query.fill('子だけ検索'); assert.equal(await taskRow('child').count(),0);
      await kids.click(); assert.equal(await taskRow('child').count(),1);
      await kids.click(); await query.fill(''); assert.equal(await taskRow('child').count(),0);
      const none = root.locator('[data-kind="due"][data-value="none"]');
      await none.click(); assert.equal(await taskRow('child').count(),1);
      await kids.click(); assert.equal(await taskRow('child').count(),0);
      await none.click(); assert.equal(await taskRow('child').count(),0);
      await kids.click();

      assert((await summary.textContent()).includes('仕事')); assert(/\d+\/\d+件/.test(await summary.textContent()));
      await summary.click(); assert.equal(await group.getAttribute('open'),null); await summary.click(); assert.notEqual(await group.getAttribute('open'),null);
    });
    await check('U2-6 title search project chips ancestor context and IME', async () => {
      const query = root.locator('[data-work-filter="query"]');
      assert.equal(await query.getAttribute('id'), 'wbs-projects-query');
      assert.equal(await root.locator('[data-work-list="wbs-projects"] [data-action="wbs-select-project"][data-id="q"]').count(), 1);
      assert.equal(await root.locator('.wbs-project-detail [data-wbs-row-id="free"]').count(), 1);
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
    await check('U2-7 legacy search removed and visibility settings honored', async () => {
      assert.equal(await root.locator('.search-frame,[data-work-filter="status"],[data-work-filter="category"]').count(),0);
      assert.equal(await taskRow('done').count(),0); assert.equal(await taskRow('suspended').count(),0);
      await page.evaluate(async()=>{ const {state}=await import('/src/state/store.js'); state.settings.wbsHideCompleted=false;state.settings.showSuspended=true;(await import('/src/features/work-list.js')).updateWorkLists(); });
      assert.equal(await taskRow('done').count(),1); assert.equal(await taskRow('suspended').count(),1); assert.equal(await taskRow('deleted').count(),0);
    });
    await check('U2-8 responsive columns and no horizontal overflow', async () => {
      for (const width of [375,900,1280]) {
        await page.setViewportSize({width,height:900});
        await root.locator('.work-decide-sidebar').waitFor();
        await root.locator('[data-work-list-rows]').waitFor();
        await root.locator('[data-work-filter="query"]').waitFor();
        const size = await root.evaluate(el=>{const side=el.querySelector('.work-decide-sidebar'),groups=el.querySelector('[data-work-list-rows]'),a=side.getBoundingClientRect(),b=groups.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,side:a.width,sideX:a.x,listX:b.x,listY:b.y,sideBottom:a.bottom,position:getComputedStyle(side).position,columns:getComputedStyle(groups).columnCount,font:parseFloat(getComputedStyle(el.querySelector('input')).fontSize)};});
        assert(!size.overflow,'overflow at '+width); assert(size.font>=16);
        if(width>=900) { assert.equal(Math.round(size.side),400); assert(size.listX>size.sideX); assert.equal(size.position,'sticky'); } else assert(size.listY>=size.sideBottom);
        assert.equal(size.columns,'auto');
        if(width>=900) {
          const layout=await root.locator('[data-work-key]').first().evaluate(el=>{const boxes=[...el.children].map(x=>x.getBoundingClientRect());return boxes.map(x=>({x:x.x,y:x.y}));});
          assert(layout[1].x>layout[0].x && layout[2].x>layout[1].x,'title / information / due columns');
        }
      }
      assert.deepEqual(errors,[]);
    });
    await check('U2-5 A-9 restored completion, subtask, project edit and add entries', async () => {
      await page.setViewportSize({width:1280,height:900});
      await root.locator('[data-work-filter="query"]').fill('自由な作業');
      const complete = taskRow('free').locator('[data-action="toggle-task"][data-id="free"]');
      assert.equal(await complete.count(),1,'completion entry in the task row');
      await complete.click();
      const completed = await page.evaluate(async()=> (await import('/src/state/store.js')).state);
      assert.equal(completed.tasks.find(t=>t.id==='free').status,'completed');
      const actual = completed.blocks.filter(b=>b.taskId==='free'&&!b.deleted&&b.completed&&b.actualStartAt&&b.actualEndAt);
      assert.equal(actual.length,1,'v419 records one actual');
      assert.equal(actual[0].actualStartAt,fixture.date+'T11:30:00');
      assert.equal(actual[0].actualEndAt,fixture.date+'T12:00:00');
      await root.locator('[data-work-filter="query"]').fill('親の作業');
      await taskRow('parent').locator('[data-action="add-subtask"][data-parent-task="parent"]').click();
      await page.locator('[data-modal-field="title"]').fill('入口から作った子');
      await page.locator('[data-action="modal-save"]').click();
      assert(await page.evaluate(async()=> (await import('/src/state/store.js')).state.tasks.some(t=>t.title==='入口から作った子'&&t.parentTaskId==='parent'&&t.projectId==='p')));
      const group = root.locator('[data-work-group="p"]');
      const wasOpen = await group.getAttribute('open');
      await group.locator('summary [data-action="edit-project"][data-id="p"]').click();
      assert.equal(await page.locator('[data-modal-field="title"]').inputValue(),'管理Project');
      assert.equal(await group.getAttribute('open'),wasOpen,'edit does not toggle the group');
      await page.locator('[data-action="modal-close"]').first().click();
      await root.locator('.wbs-add-menu > summary').click();
      await root.locator('#taskTitle').fill('追加入口のTask');
      await root.locator('#taskProject').selectOption('q');
      await root.locator('[data-action="add-task"]').click();
      assert(await page.evaluate(async()=> (await import('/src/state/store.js')).state.tasks.some(t=>t.title==='追加入口のTask'&&t.projectId==='q'&&!t.deleted)));
    });
    assert.equal(failures,0,'acceptance failures');
  } finally { if(browser) await browser.close(); if(server) await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
