const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium, launchOptions, startServer, randomPort, STATE_KEY, passGithubGate } = require('./helpers');
const DAY = '2026-09-06', PREV = '2026-09-05';
const output = process.env.INTEGRATION_EVIDENCE_DIR;
const which = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
(async () => {
 let server, browser, failures = 0;
 try {
  server = startServer(randomPort()); browser = await chromium.launch({ ...launchOptions(), timeout: 60000 });
  for (const name of ['A', 'B', 'C', 'D'].filter(name => !which || which === name)) {
   const context = await browser.newContext({ viewport: { width: name === 'C' ? 1024 : 390, height: 844 }, serviceWorkers: 'block' });
   const page = await context.newPage(), errors = [];
   const deadline = setTimeout(() => context.close().catch(() => {}), 60000);
   page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(15000);
   page.on('pageerror', error => errors.push(error.message));
   try {
    await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    await page.clock.setFixedTime(new Date(2026, 8, 6, 10, 30));
    await page.goto(`http://localhost:${server.address().port}/`); await passGithubGate(page);
    await page.evaluate(({ key, day, prev, name }) => {
     const s = JSON.parse(localStorage.getItem(key));
     s.currentView = name === 'A' ? 'wbs' : 'exec'; s.selectedDate = day;
     s.settings.lastOpenedDate = day; s.settings.autoSync = false; s.settings.github.autoSave = false;
     s.projects = [{ id: 'fixture-project', title: '架空Project', kind: 'normal', status: 'active' }];
     s.tasks = Array.from({ length: 300 }, (_, i) => ({ id: 'task-' + i, title: '対象Task ' + i, projectId: 'fixture-project', status: 'todo', description: '元メモ', estimateMin: 15, order: i * 1000 }));
     s.blocks = [{ id: 'block', title: '当日の架空Block', taskId: 'task-299', date: day, plannedStartAt: day + 'T11:40:00', plannedEndAt: day + 'T12:10:00', completed: false, comment: '元Blockメモ' },
      { id: 'ended', title: '当日終了未完了', taskId: '', date: day, plannedStartAt: day + 'T08:00:00', plannedEndAt: day + 'T08:15:00', actualStartAt: day + 'T08:01:00', actualEndAt: day + 'T08:16:00', completed: false },
      { id: 'previous', title: '前日実績の架空Block', taskId: '', date: prev, plannedStartAt: prev + 'T09:00:00', plannedEndAt: prev + 'T09:15:00', actualStartAt: prev + 'T09:01:00', actualEndAt: prev + 'T09:16:00', completed: false }];
     s.recurrences = []; s.tracks = []; s.journals[day] = '架空本文'; s.journals[prev] = '前日の架空本文';
     if (name === 'D') s.blocks[0].title = '予定行の長い架空タイトル'.repeat(6);
     localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, day: DAY, prev: PREV, name });
    await page.reload(); await page.locator('[data-work-list]').waitFor();
    const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    const field = key => page.locator(`#modalRoot [data-modal-field="${key}"]`);
    const choose = choice => page.locator(`[data-action="draft-leave-${choice}"]`).click();
    const close = () => page.locator('#modalRoot [data-action="modal-close"]').first().click();
    if (name === 'A') {
     const root = page.locator('[data-work-list="wbs"]'), rows = root.locator('[data-work-list-rows]'), query = root.locator('[data-work-filter="query"]');
     await query.fill('対象Task'); assert.equal(await rows.locator('[data-work-key^="task:"]').count(), 300);
     await rows.evaluate(el => el.scrollTop = el.scrollHeight); const top = await rows.evaluate(el => el.scrollTop);
     const last = rows.locator('[data-work-key="task:task-299"] button[data-action="edit-task"]');
     await last.click(); await field('description').fill('未保存の架空メモ');
     await field('description').evaluate(el => { window.__editor = el; el.setSelectionRange(1, 4); });
     await close(); await choose('stay');
     assert(await field('description').evaluate(el => el === window.__editor && document.activeElement === el && el.selectionStart === 1 && el.selectionEnd === 4));
     const before = (await read()).tasks.find(row => row.id === 'task-299');
     await page.evaluate(key => { window.__set = Storage.prototype.setItem; window.__writes = 0; Storage.prototype.setItem = function(k,v) { if (k === key) { window.__writes++; throw new DOMException('synthetic quota', 'QuotaExceededError'); } return window.__set.call(this,k,v); }; }, STATE_KEY);
     await close(); await choose('save');
     assert.equal(await field('description').inputValue(), '未保存の架空メモ');
     assert.deepEqual((await read()).tasks.find(row => row.id === 'task-299'), before);
     assert(await field('description').evaluate(el => el === window.__editor && document.activeElement === el && el.selectionStart === 1 && el.selectionEnd === 4));
     assert.equal(await page.evaluate(() => window.__writes), 1, 'one failed persistence attempt');
     assert.equal(await page.evaluate(async () => (await import('/src/state/store.js')).state.tasks.find(t => t.id === 'task-299').description), before.description);
     await page.evaluate(() => { Storage.prototype.setItem = window.__set; });
     await close(); await choose('save'); await page.waitForFunction(() => !document.querySelector('#modalRoot').classList.contains('open'));
     assert.equal((await read()).tasks.find(row => row.id === 'task-299').description, '未保存の架空メモ');
     assert(await last.evaluate(el => document.activeElement === el)); assert(Math.abs(await rows.evaluate(el => el.scrollTop) - top) < 3);
     await last.click(); await field('title').fill('検索条件から外れる名称'); await close(); await choose('save');
     assert.equal((await read()).tasks.find(row => row.id === 'task-299').title, '検索条件から外れる名称');
     await page.waitForFunction(() => document.activeElement?.dataset.workFilter === 'query');
     assert.equal(await query.inputValue(), '対象Task'); assert.equal(await rows.locator('[data-work-key^="task:"]').count(), 299);
    } else if (name === 'B') {
     await page.locator('[data-work-key="block:block"] [data-action="block-row-toggle"]').click();
     const button = page.locator('[data-work-key="block:block"] button[data-action="edit-block"]').first();
     await button.click(); await field('comment').fill('身体スキャンへ渡す架空メモ');
     await page.evaluate(() => { window.__scanOpen = 0; let had = false; new MutationObserver(() => { const has = Boolean(document.querySelector('#bodyScanComment')); if (has && !had) window.__scanOpen++; had = has; }).observe(document.querySelector('#modalRoot'), {childList:true,subtree:true}); });
     await page.locator('#modalRoot details').filter({has:page.locator('[data-action="toggle-task-complete"]')}).locator(':scope > summary').click();
     await page.locator('#modalRoot [data-action="toggle-task-complete"]').click(); await choose('save');
     await page.locator('#bodyScanComment').waitFor(); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
     assert.equal((await read()).tasks.find(row => row.id === 'task-299').status, 'completed');
     assert.equal((await read()).blocks.find(row => row.id === 'block').comment, '身体スキャンへ渡す架空メモ');
     assert.equal(await page.evaluate(() => window.__scanOpen), 1, 'body scan opens once');
     assert(await page.evaluate(() => document.querySelector('#modalRoot').contains(document.activeElement)), 'new body scan owns focus after microtask');
     await page.keyboard.press('Tab'); assert(await page.evaluate(() => document.querySelector('#modalRoot').contains(document.activeElement)), 'Tab stays in new modal');
     await page.locator('#modalRoot [data-action="body-scan-discard"]').first().click();
     await button.click(); await field('comment').fill('別画面へ保存');
     // Real nav control: invocation through DOM avoids an overlay intercepting pointer hit testing.
     await page.locator('#sidebar [data-action="nav"][data-view="wbs"]').evaluate(el => el.click()); await choose('save');
     await page.locator('[data-work-list="wbs"]').waitFor();
     assert(!(await page.evaluate(() => document.activeElement?.closest('[data-work-list="exec"]'))));
     assert.equal((await read()).blocks.find(row => row.id === 'block').comment, '別画面へ保存');
    } else if (name === 'D') {
     const search = page.locator('[data-work-list="exec"] [data-work-filter="query"]');
     await search.fill('長い架空タイトル');
     const initialTop = await page.locator('[data-work-list="exec"] [data-work-list-rows]').evaluate(el=>el.scrollTop);
     const row = page.locator('[data-work-key="block:block"]');
     await row.locator('.checkbox-button').focus(); await page.keyboard.press('Tab');
     assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'block-row-toggle', 'Tab reaches planned row disclosure');
     await page.keyboard.press('Enter');
     assert.equal(await row.locator('[data-action="edit-block"]').count(), 1);
     for (let i = 0; i < 6 && !(await row.locator('[data-action="edit-block"]').evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('Tab');
     assert(await row.locator('[data-action="edit-block"]').evaluate(el => el === document.activeElement));
     await page.keyboard.press('Enter'); await field('comment').waitFor();
     assert.equal(await page.evaluate(async () => (await import('/src/state/store.js')).state.modal.id), 'block');
     await close();
     assert.equal(await search.inputValue(),'長い架空タイトル');
     assert.equal(await page.locator('[data-work-list="exec"] [data-work-list-rows]').evaluate(el=>el.scrollTop),initialTop);
     assert.equal((await read()).blocks.find(item => item.id === 'block').actualStartAt || '', '', 'keyboard expansion does not start Block');
     for (const width of [390,768,1024,1280]) {
      await page.setViewportSize({width,height:width===1024?768:844});
      await page.locator('#sidebar [data-action="nav"][data-view="exec"]').evaluate(el=>el.click());
      const disclosure = row.locator('button[data-action="block-row-toggle"]');
      await row.locator('.checkbox-button').focus(); await page.keyboard.press('Tab');
      const metrics = await disclosure.evaluate(el => { const r=el.getBoundingClientRect(),title=el.querySelector('strong'),meta=el.querySelector('.exec-row-meta'); return {width:r.width,height:r.height,title:title.textContent,titleClipped:title.scrollHeight>title.clientHeight+1,metaBelow:meta.getBoundingClientRect().top>=title.getBoundingClientRect().bottom-1,overflow:document.documentElement.scrollWidth>innerWidth,expanded:el.getAttribute('aria-expanded'),focus:el.matches(':focus-visible')}; });
      assert(metrics.height>=44 && metrics.width>=44 && !metrics.titleClipped && metrics.metaBelow && !metrics.overflow && metrics.focus, JSON.stringify({width,metrics}));
      assert.equal(metrics.title,'予定行の長い架空タイトル'.repeat(6));
      assert(['true','false'].includes(metrics.expanded)); console.log('PASS disclosure layout '+JSON.stringify({width,metrics}));
      if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,`D-${width}.png`),fullPage:true});}
     }
    } else {
     const original = (await read()).blocks.map(({ id, actualStartAt, actualEndAt }) => ({ id, actualStartAt, actualEndAt }));
     await page.locator('[data-action="date-prev"]').first().click();
     assert((await page.locator('.exec-date-context').textContent()).includes(PREV));
     assert((await page.locator('[data-work-list="exec"] h2').textContent()).includes(DAY));
     assert.equal(await page.locator('[data-work-list="exec"] [data-work-key]').count(), 2);
     assert.equal(await page.locator('[data-work-key="block:ended"] [data-action="now-start"]').count(), 0);
     assert((await page.locator('.exec-pane-right').textContent()).includes('前日実績の架空Block'));
     await page.locator('[data-action="exec-mode-toggle"][data-mode="actual"]').first().click();
     assert((await page.locator('.exec-pane-left').textContent()).includes('前日実績の架空Block'));
     assert(!(await page.locator('.exec-pane-left').textContent()).includes('当日終了未完了'));
     await page.locator('.exec-pane-left button[data-action="edit-block"]').first().click(); await close();
     assert.deepEqual((await read()).blocks.map(({ id, actualStartAt, actualEndAt }) => ({ id, actualStartAt, actualEndAt })), original);
    }
    assert.deepEqual(errors, [], 'no pageerror'); console.log(`PASS integration ${name}`);
    if (output) { fs.mkdirSync(output,{recursive:true}); await page.screenshot({path:path.join(output,`${name}.png`),fullPage:true}); }
   } catch (error) {
    failures++; console.error(`FAIL integration ${name}: ${error.stack}`);
    if (output && !page.isClosed()) { fs.mkdirSync(output,{recursive:true}); await page.screenshot({path:path.join(output,`${name}-failure.png`),fullPage:true}).catch(()=>{}); }
   } finally { clearTimeout(deadline); await context.close(); }
  }
 } finally { try { if(browser)await browser.close(); } finally { if(server)await new Promise(resolve=>server.close(resolve)); } }
 assert.equal(failures,0,'integration acceptance failures');
})().catch(error => {console.error(error);process.exitCode=1;});
