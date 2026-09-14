// F6: approved Today order, table columns, compact band and responsive stacking.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium, launchOptions, defaultContextOptions, startServer, randomPort, STATE_KEY,
  passGithubGate, setViewportAndWaitForStableLayout } = require('./helpers');
const failures = [], measurements = [];
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); if (!ok) failures.push(name); };
const shots = process.env.F6_SHOTS_DIR;
(async () => {
  let server, browser;
  try {
    server = startServer(randomPort()); browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ ...defaultContextOptions(), viewport: { width: 1440, height: 1080 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    const clock = new Date(2026, 8, 14, 14, 30);
    await page.clock.setFixedTime(clock);
    await page.goto('http://localhost:' + server.address().port + '/'); await passGithubGate(page);
    await page.evaluate(({ key, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = 'today'; state.selectedDate = today;
      Object.assign(state.settings, { theme: 'cockpit', lastOpenedDate: today, autoSync: false, birthDate: '', twelveWeekStartDate: '2026-09-05' });
      state.settings.github.autoSave = false;
      state.projects = [{ id: 'reading', title: '読書', kind: 'project', status: 'active', deleted: false }];
      state.tasks = [{ id: 'book', title: '読書ノートをまとめる', projectId: 'reading', status: 'todo', kind: 'task', deleted: false, dueDate: '2026-09-20' }];
      state.recurrences = []; state.bodyScans = [];
      state.blocks = ['読書ノートをまとめる', '休憩・ストレッチ', '来週の予定を立てる', '買い物', '夕食', '書く瞑想', '明日の準備', '終了した作業'].map((title, index) => ({
        id: 'f6-' + index, title, date: today, taskId: 'book', category: '作業', estimateMin: 30,
        plannedStartAt: `${today}T${14 + index}:00`, plannedEndAt: `${today}T${14 + index}:30`,
        actualStartAt: index === 0 ? `${today}T14:00` : index === 7 ? `${today}T08:00` : '',
        actualEndAt: index === 7 ? `${today}T08:30` : '', completed: index === 7, isMIT: index === 0,
        deleted: false, orderIndex: index, createdAt: `${today}T07:00`, updatedAt: `${today}T07:00`
      }));
      state.journals = { [today]: '### 今日のハイライト\n読書メモを、自分の言葉で整理する。\n\n### 依頼\n明日の予定を確認する。' };
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: '2026-09-14' });
    await page.reload(); await page.locator('.daily-table-row button').first().waitFor();
    const ordered = ['.daily-today-clock', '.tower-mit', '.life-band', '.so-row', '.tower-runway', '.daily-today-sections', '#dailyTodayPlans', '.daily-today-records', '.tower-journal'];
    const domOrder = await page.evaluate(selectors => selectors.map(selector => document.querySelector('[data-daily-view="today"] ' + selector)).every((node, index, nodes) => node && (!index || Boolean(nodes[index - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))), ordered);
    check('上部帯から末尾の記録・ジャーナルまでモック順（8枠と記録内の順序）', domOrder);
    check('表の5列', JSON.stringify(await page.locator('[role="columnheader"]').allTextContents()) === JSON.stringify(['時刻', 'タスク', 'プロジェクト', '見積', '状態']));
    check('MITは上部に1枠、NOW横に重複なし', await page.locator('.today-tower > .tower-mit').count() === 1 && await page.locator('.tower-runway .tower-mit').count() === 0);
    check('MITにタイトル・時刻・見積・状態', /読書ノートをまとめる[\s\S]*14:00–14:30・見積 30分・進行中/.test(await page.locator('.tower-mit').innerText()));
    check('生年月日未設定は年齢2枠とも未設定', JSON.stringify(await page.locator('.life-unset').allTextContents()) === JSON.stringify(['未設定', '未設定']));
    check('からだの帯なし・からだのきろくあり', await page.locator('.tower-condition').count() === 0 && await page.locator('.sec-bodymind').count() === 1);
    const root = page.locator('[data-work-list="today"]');
    check('次の予定7件、やったこと1件', JSON.stringify(await root.locator('[role="tab"]').allTextContents()) === JSON.stringify(['次の予定 7', 'やったこと 1']));
    await root.locator('[data-tab="actuals"]').click();
    check('実績タブの切替', await root.locator('[data-today-table-group="actuals"]').isVisible() && !await root.locator('[data-today-table-group="plans"]').isVisible());
    await root.locator('[data-tab="plans"]').click();
    check('予定行に日付・期限なし', !/2026-|期限/.test(await root.locator('.daily-table-row:visible').allTextContents().then(values => values.join(' '))));
    const first = root.locator('details[data-work-key="block:f6-0"]');
    await first.locator('summary > span').last().click();
    check('内訳に共通行と期限を維持', await first.locator('.daily-plan-row').isVisible() && (await first.innerText()).includes('外部期限 2026-09-20'));
    await page.clock.setFixedTime(new Date(clock.getTime() + 2000));
    await page.waitForFunction(() => document.querySelector('#towerClock').textContent.endsWith('02'));
    check('時計更新で内訳の開閉を維持', await first.getAttribute('open') !== null);
    await first.locator('summary > span').last().click();
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await setViewportAndWaitForStableLayout(page, { width, height: 1080 }, '.daily-today-sections button');
      await page.evaluate(() => { document.scrollingElement.scrollTop = 0; document.querySelector('#main')?.scrollTo(0, 0); });
      const m = await page.evaluate(selectors => {
        const tower = document.querySelector('[data-daily-view="today"]');
        const rect = selector => { const r = tower.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
        const visible = [...tower.querySelectorAll('button, select, input:not([type="checkbox"]), textarea, summary')].filter(el => el.checkVisibility() && el.getBoundingClientRect().width > 0);
        return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, sections: selectors.map(rect),
          life: rect('.life-band'), creeds: [...tower.querySelectorAll('.so-item')].map(el => ({ y: el.getBoundingClientRect().y })),
          smallVisible: tower.querySelector('.so-item small').checkVisibility(),
          smallControls: visible.filter(el => el.getBoundingClientRect().height < 43.9 || el.getBoundingClientRect().width < 43.9).map(el => [el.outerHTML.slice(0, 140), el.getBoundingClientRect().width, el.getBoundingClientRect().height]),
          smallInputs: visible.filter(el => el.matches('input, select, textarea') && parseFloat(getComputedStyle(el).fontSize) < 16).length };
      }, ordered);
      measurements.push(m);
      check(`${width}px ページと主要枠の横はみ出しなし`, m.pageWidth <= width && m.sections.every(r => r.x >= -1 && r.right <= width + 1), m);
      check(`${width}px 操作対象44px・入力16px`, !m.smallControls.length && !m.smallInputs, m.smallControls);
      if (width === 390) {
        check('390pxは同じ順で縦積み', m.sections.every((r, i, rows) => !i || r.y >= rows[i - 1].bottom - 1), m.sections);
        check('390pxは信条の副題を隠す', !m.smallVisible);
      }
      if (width === 1440) {
        check('1440px LIFE BAND高さ70px前後', m.life.height >= 60 && m.life.height <= 80, m.life);
        check('1440px 信条3枠が同じ行', m.creeds.every(r => Math.abs(r.y - m.creeds[0].y) < 1));
        const [plans, records, journal] = m.sections.slice(-3);
        check('1440px予定・記録・ジャーナルは3列', Math.abs(plans.y - records.y) < 1 && Math.abs(records.y - journal.y) < 1 && plans.right <= records.x && records.right <= journal.x);
      }
      if (shots && [390, 1440].includes(width)) {
        fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `today-${width}.png`), fullPage: true });
      }
    }
    const before = await page.evaluate(async () => JSON.stringify((await import('/src/state/store.js')).state));
    for (const section of ['focus', 'records', 'journal', 'life']) {
      await page.locator(`[data-action="today-section-jump"][data-section="${section}"]`).click();
      check(`4切替 ${section} は今日のまま`, await page.locator('#app').getAttribute('data-view') === 'today');
    }
    check('4切替はstateを変更しない', before === await page.evaluate(async () => JSON.stringify((await import('/src/state/store.js')).state)));
    await page.locator('.life-cycle-details summary').click();
    await page.locator('.life-cycle-popover [data-action="nav"]').click();
    await page.locator('#app[data-view="twelveweek"]').waitFor();
    check('12週の既存画面への入口を維持', true);
    check('ページ例外なし', !errors.length, errors);
    if (shots) fs.writeFileSync(path.join(shots, 'measurements.json'), JSON.stringify(measurements, null, 2), 'utf8');
    assert.deepEqual(failures, []);
  } finally { await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve()); }
})().catch(error => { console.error(error); process.exitCode = 1; });
