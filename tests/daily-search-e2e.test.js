const assert = require('node:assert/strict');
const { chromium, launchOptions, defaultContextOptions, fixedClock, startServer, randomPort,
  STATE_KEY, passGithubGate } = require('./helpers');

(async () => {
  let server, browser;
  let passed = 0;
  const pass = name => { passed++; console.log('PASS ' + name); };
  try {
    server = startServer(randomPort());
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ ...defaultContextOptions(), locale: 'ja-JP',
      viewport: { width: 1280, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost'
      ? route.continue() : route.abort());
    const now = fixedClock(new Date(2026, 8, 8, 10, 30).getTime());
    await page.clock.install({ time: now() });
    await page.goto('http://localhost:' + server.address().port + '/');
    await passGithubGate(page);
    await page.evaluate(key => {
      const s = JSON.parse(localStorage.getItem(key));
      const d = new Date(), day = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
      s.currentView = 'today'; s.selectedDate = day; s.settings.lastOpenedDate = day;
      s.settings.autoSync = false; s.settings.github.autoSave = false; s.settings.wbsHideCompleted = false;
      s.projects = [{ id: 'search-project', title: '検索用Project', kind: 'project', status: 'active', category: '作業', deleted: false }];
      s.tasks = Array.from({ length: 60 }, (_, i) => ({ id: 'search-task-' + i, title: '検索対象 ' + i,
        projectId: 'search-project', parentTaskId: '', kind: 'task', status: i === 0 ? 'completed' : 'active',
        deleted: false, estimateMin: 15, dueDate: day, description: i === 59 ? '日本語の固有メモ' : '',
        doneCriteria: '', order: i * 1000, progressNum: 0, progressDen: 10 }));
      s.blocks = s.tasks.map((task, i) => ({ id: 'search-block-' + i, taskId: task.id, title: task.title,
        date: day, plannedStartAt: day + 'T10:' + String(i).padStart(2, '0'), plannedEndAt: '',
        actualStartAt: '', actualEndAt: '', completed: i === 0, deleted: false, category: '作業',
        estimateMin: 15, charge: 0, discharge: 0, comment: '' }));
      s.recurrences = []; s.journals[day] = '架空の本文';
      localStorage.setItem(key, JSON.stringify(s));
    }, STATE_KEY);
    await page.reload();
    await page.locator('[data-work-list="today"]').waitFor();
    for (const scope of ['today', 'exec', 'wbs']) {
      if (scope !== 'today') await page.locator(`#sidebar [data-action="nav"][data-view="${scope}"]`).click();
      const root = page.locator(`[data-work-list="${scope}"]`);
      await root.waitFor();
      const query = root.locator('[data-work-filter="query"]'), rows = root.locator('[data-work-list-rows]');
      const stored = await page.evaluate(key => localStorage.getItem(key), STATE_KEY);
      await query.fill('検索対象');
      assert.equal(await rows.locator('[data-work-key]').count(), 60);
      const countBefore = await root.locator('.work-list-count').textContent();
      await query.evaluate(el => {
        window.__searchInput = el;
        el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        el.value = '日本語の固有メモ'; el.setSelectionRange(1, 3);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
      });
      await page.clock.runFor(1100);
      assert.equal(await rows.locator('[data-work-key]').count(), 60);
      assert.equal(await root.locator('.work-list-count').textContent(), countBefore);
      assert(await query.evaluate(el => el === window.__searchInput && document.activeElement === el
        && el.selectionStart === 1 && el.selectionEnd === 3));
      await query.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      assert.equal(await rows.locator('[data-work-key]').count(), 1);
      assert((await root.locator('.work-list-count').textContent()).startsWith('1 / '));
      assert(await query.evaluate(el => el === window.__searchInput && document.activeElement === el));
      pass(scope + ' IME / input identity / count');

      await query.fill('<img src=x onerror=alert(1)>');
      assert.equal(await rows.locator('[data-work-key]').count(), 0);
      assert.equal(await rows.locator('img').count(), 0);
      assert.equal(await rows.locator('.work-list-empty').textContent(), '条件に一致する項目はありません。');
      await root.locator('[data-action="work-list-clear"]').click();
      assert(await query.evaluate(el => el === window.__searchInput));
      await root.locator('[data-work-filter="status"]').selectOption('completed');
      assert.equal(await rows.locator('[data-work-key]').count(), 1);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), STATE_KEY), stored,
        'search and filters do not save primary data');
      await root.locator('[data-action="work-list-clear"]').click();
      await query.fill('検索対象');
      await root.locator('[data-work-filter="project"]').selectOption('search-project');
      await rows.evaluate(el => { el.scrollTop = el.scrollHeight; });
      const top = await rows.evaluate(el => el.scrollTop);
      assert(top > 0, 'fixture exercises a scrolled result');
      await query.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
      assert.equal(await rows.evaluate(el => el.scrollTop), top);
      const id = scope === 'wbs' ? 'task:search-task-59' : 'block:search-block-59';
      const row = rows.locator(`[data-work-key="${id}"]`);
      assert.equal(await row.count(), 1, scope + ' filtered target row exists');
      const button = row.locator(`[data-action="edit-${scope === 'wbs' ? 'task' : 'block'}"]`).first();
      if (scope === 'exec') {
        // Upcoming execution rows expose Edit only after the user expands them.
        const toggle = row.locator('[data-action="block-row-toggle"]');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        assert.equal(await button.count(), 0);
        await toggle.click();
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        assert.equal(await button.count(), 1);
      }
      // Expansion adds controls below the title; measure after Edit is in view.
      await button.scrollIntoViewIfNeeded();
      const detailTop = await rows.evaluate(el => el.scrollTop);
      assert(detailTop > 0, 'detail opens from a scrolled result');
      await button.click();
      await page.locator('[data-action="modal-close"]').first().click();
      await page.waitForFunction(key => document.activeElement?.closest('[data-work-key]')?.dataset.workKey === key, id);
      assert.equal(await query.inputValue(), '検索対象');
      assert.equal(await root.locator('[data-work-filter="project"]').inputValue(), 'search-project');
      assert(Math.abs(await rows.evaluate(el => el.scrollTop) - detailTop) < 3);
      assert(await button.evaluate(el => el === document.activeElement));
      pass(scope + ' filters / no save / detail return / scroll');
    }

    const contract = await page.evaluate(async () => {
      const { renderSearchFrame, patchSearchFrame } = await import('/src/ui/daily-parts/search-frame.js');
      const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
      const model = { scope: 'wbs', query: '"><img src=x>', filters: { status: '', project: '', category: '', due: '' },
        options: { status: [['', 'すべて']], project: [['', '<svg onload=x>']], category: [], due: [] },
        shownCount: 1, totalCount: 1, composing: false, emptyMessage: '<img src=x>', resultRegionId: 'isolated-results' };
      const root = document.createElement('section');
      root.innerHTML = renderSearchFrame(model, { escapeHTML, resultsHTML: '<button>fixture</button>' });
      const input = root.querySelector('input'), before = root.innerHTML;
      const rejected = [];
      for (const invalid of [{ shownCount: -1 }, { shownCount: 2 }, { scope: 'archive' },
        { filters: {} }, { options: { ...model.options, project: [[null, 'bad']] } }]) {
        try { patchSearchFrame(root, { ...model, ...invalid }, { escapeHTML, resultsHTML: '' }); rejected.push(false); }
        catch (error) { rejected.push(error instanceof TypeError && root.innerHTML === before); }
      }
      let failurePreserved = false;
      try {
        patchSearchFrame(root, { ...model, shownCount: 0 }, { resultsHTML: '',
          escapeHTML: () => { throw new Error('injected formatter failure'); } });
      } catch (error) { failurePreserved = error.message === 'injected formatter failure' && root.innerHTML === before; }
      const composing = patchSearchFrame(root, { ...model, composing: true }, { escapeHTML, resultsHTML: 'changed' });
      const deferred = composing === false && root.innerHTML === before;
      patchSearchFrame(root, { ...model, shownCount: 0 }, { escapeHTML, resultsHTML: '' });
      return { rejected, failurePreserved, deferred, sameInput: input === root.querySelector('input'),
        unsafeElements: root.querySelectorAll('img,svg').length, emptyText: root.querySelector('.work-list-empty').textContent };
    });
    assert.deepEqual(contract.rejected, [true, true, true, true, true]);
    assert.equal(contract.failurePreserved, true);
    assert.equal(contract.deferred, true);
    assert.equal(contract.sameInput, true);
    assert.equal(contract.unsafeElements, 0);
    assert.equal(contract.emptyText, '<img src=x>');
    pass('invalid contracts / injected rendering failure / escaped text / shared composition guard');
    for (const width of [390, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.locator('[data-work-list="wbs"]').evaluate(root => ({
        inputSizes: [...root.querySelectorAll('input,select')].map(el => parseFloat(getComputedStyle(el).fontSize)),
        width: root.getBoundingClientRect().width, viewport: innerWidth, pageWidth: document.documentElement.scrollWidth
      }));
      assert(layout.inputSizes.every(size => size >= 16), 'iOS input zoom guard');
      assert(layout.width > 0 && layout.width <= width && layout.pageWidth <= layout.viewport);
      console.log('MEASURE ' + width + ' ' + JSON.stringify(layout));
    }
    pass('390 / 768 / 1024 layout and font measurements');
    assert.deepEqual(errors, []);
    console.log(`PASS daily-search E2E: ${passed} cases; desktop emulation only`);
  } finally {
    try { if (browser) await browser.close(); }
    finally { if (server) await new Promise(resolve => server.close(resolve)); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
