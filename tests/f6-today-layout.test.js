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
    const ordered = ['.daily-today-clock', '.tower-runway', '.life-band', '.so-row', '#dailyTodayPlans', '.daily-today-records'];
    const domOrder = await page.evaluate(selectors => selectors.map(selector => document.querySelector('[data-daily-view="today"] ' + selector)).every((node, index, nodes) => node && (!index || Boolean(nodes[index - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))), ordered);
    check('上部帯・カード・LIFE BAND・信条・予定・記録の順', domOrder);
    check('表の3列', JSON.stringify(await page.locator('[role="columnheader"]').allTextContents()) === JSON.stringify(['時刻', 'タスク', '見積']));
    check('MIT独立枠なし・カードの作業名に★', await page.locator('.tower-mit').count() === 0 && (await page.locator('.tower-now-title').innerText()).includes('★'));
    check('MITの予定時刻・見積は予定行に残る', /14:00[\s\S]*読書ノートをまとめる[\s\S]*30/.test(await page.locator('[data-work-key="block:f6-0"] summary').innerText()));
    check('生年月日未設定は年齢2枠とも未設定', JSON.stringify(await page.locator('.life-unset').allTextContents()) === JSON.stringify(['未設定', '未設定']));
    check('記録群はルーティン/実績一覧の2つ・からだの帯/きろくなし', await page.locator('.tower-condition').count() === 0 && await page.locator('.sec-bodymind').count() === 0
      && JSON.stringify(await page.locator('.daily-today-records > *').evaluateAll(nodes => nodes.map(el => el.matches('.sec-gates') ? 'gates' : el.matches('.sec-log') ? 'actuals-panel' : 'other'))) === JSON.stringify(['gates', 'actuals-panel']));
    const root = page.locator('[data-work-list="today"]');
    // T2-1..6: one screen-result check for each acceptance condition.
    const t2row = page.locator('[data-work-key="block:f6-0"]');
    check('T2-1 3列・札・MIT・件数と見積合計',
      JSON.stringify(await page.locator('[role="columnheader"]').allTextContents()) === JSON.stringify(['時刻', 'タスク', '見積'])
      && await t2row.locator('summary [role="cell"]').count() === 3
      && await t2row.locator('.daily-table-tag').textContent() === '読書'
      && await t2row.locator('.mit-star').count() === 1
      && (await root.locator('h2').textContent()).includes('8件 · 見積 4時間0分'));
    const t2running = await t2row.evaluate(el => ({ state: el.dataset.rowState, background: getComputedStyle(el).backgroundColor }));
    const t2runningButtons = await root.locator('[data-action="today-pick-next"]').count();
    const t2snapshot = await page.evaluate(key => localStorage.getItem(key), STATE_KEY);
    await page.evaluate(key => {
      const s = JSON.parse(localStorage.getItem(key)); s.blocks[0].actualStartAt = '';
      s.blocks[6].category = 'ルーティン'; s.blocks[7].category = 'ルーティン'; s.blocks[7].isMIT = true;
      localStorage.setItem(key, JSON.stringify(s));
    }, STATE_KEY);
    await page.reload(); await root.waitFor();
    const t2styles = await page.evaluate(() => {
      const late = document.querySelector('[data-work-key="block:f6-0"]');
      const done = document.querySelector('[data-work-key="block:f6-7"]');
      return { state: late.dataset.rowState, opacity: Number(getComputedStyle(late).opacity), text: late.textContent,
        doneState: done.dataset.rowState, decoration: getComputedStyle(done.querySelector('.work-list-title')).textDecorationLine };
    });
    check('T2-2 遅れ・実行中・完了の見た目', t2styles.state === 'late' && t2styles.opacity < 1 && t2styles.text.includes('遅れ')
      && t2running.state === 'running' && !['transparent', 'rgba(0, 0, 0, 0)'].includes(t2running.background)
      && t2styles.doneState === 'done' && t2styles.decoration.includes('line-through'));
    const t2pick = root.locator('[data-action="today-pick-next"][data-id="f6-2"]');
    let t2picked = false, t2touch = false, t2desktop = false;
    if (await t2pick.count()) {
      await page.mouse.move(0, 0);
      const hidden = await t2pick.evaluate(el => getComputedStyle(el).opacity === '0');
      await t2pick.focus();
      t2desktop = hidden && await t2pick.evaluate(el => getComputedStyle(el).opacity === '1');
      const before = await page.evaluate(key => localStorage.getItem(key), STATE_KEY);
      await t2pick.click();
      t2picked = (await page.locator('.today-now-card .tower-now-title').textContent()).includes('来週の予定を立てる')
        && await page.evaluate(key => localStorage.getItem(key), STATE_KEY) === before;
      await setViewportAndWaitForStableLayout(page, { width: 390, height: 1080 }, '.daily-today-clock button');
      t2touch = await t2pick.evaluate(el => getComputedStyle(el).opacity === '1' && el.getBoundingClientRect().height >= 44);
      await setViewportAndWaitForStableLayout(page, { width: 1440, height: 1080 }, '.daily-today-clock button');
    }
    check('T2-3 行から次候補を保存せず選択・PC/携帯の表示', t2picked && t2touch && t2desktop && t2runningButtons === 0
      && await page.locator('.tower-arrival-select').count() === 0 && await root.locator('[data-row-state="done"] [data-action="today-pick-next"]').count() === 0);
    const t2tools = root.locator('.daily-table-tools');
    const t2search = root.locator('.daily-table-search');
    let t2searchOpened = false;
    if (await t2search.count()) {
      const closed = await t2search.getAttribute('open') === null;
      await t2search.locator(':scope > summary').click();
      t2searchOpened = closed && await root.locator('input[type="search"]').isVisible();
    }
    check('T2-4 道具の順序・検索開閉・実行への導線', t2searchOpened
      && JSON.stringify(await t2tools.locator(':scope > button, :scope > details > summary').allTextContents()) === JSON.stringify(['＋ 割り込み', '＋ 実績だけ', '検索・絞り込み ▸', '時間軸で見る ›'])
      && await t2tools.locator('[data-action="nav"][data-view="exec"]').count() === 1
      && await root.getByRole('button', { name: '予定へ', exact: true }).count() === 0);
    check('T2-5 完了を含むルーティンチップと見出し', await page.locator('#towerGateStrip .tower-gate').count() === 3
      && await page.locator('#towerGateStrip').evaluate(el => getComputedStyle(el).display === 'flex' && getComputedStyle(el).flexWrap === 'wrap')
      && await page.locator('.tower-gate[data-id="f6-7"] strong').evaluate(el => getComputedStyle(el).textDecorationLine.includes('line-through'))
      && (await page.locator('.sec-gates h2').textContent()).includes('未完了2 · 完了1') && await page.locator('.tower-gate-showdone').count() === 0);
    check('T2-6 実績の枠・開始時刻/名前/分・MIT・日報への導線', await page.locator('.daily-today-records details').count() === 0
      && (await page.locator('.sec-log h2').textContent()).includes('実績の簡易一覧 終了時刻がある 1件')
      && JSON.stringify(await page.locator('.tower-log-row time').allTextContents()) === JSON.stringify(['08:00'])
      && await page.locator('.tower-log-title .mit-star').count() === 1
      && (await page.locator('.tower-log-dur').textContent()) === '30分' && await page.locator('.tower-log-state').count() === 0
      && await page.locator('.sec-log [data-action="nav"][data-view="journal"]').textContent() === '日報を書く ›');
    await page.evaluate(({key, snapshot}) => localStorage.setItem(key, snapshot), {key: STATE_KEY, snapshot: t2snapshot});
    await page.reload(); await root.waitFor();
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
      await setViewportAndWaitForStableLayout(page, { width, height: 1080 }, '.daily-today-clock button');
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
        const [plans, records] = m.sections.slice(-2);
        check('1440px予定・記録は2列', Math.abs(plans.y - records.y) < 1 && plans.right <= records.x);
      }
      if (shots && [390, 1440].includes(width)) {
        fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `today-${width}.png`), fullPage: true });
      }
    }
    for (const selector of ['.daily-today-quick', '.tower-mit', '.daily-today-sections', '.tower-journal']) {
      check(`廃止した枠 ${selector} は出ない`, await page.locator(selector).count() === 0);
    }
    await page.locator('.daily-today-clock [data-view="journal"]').click();
    check('上部の日報導線でjournalへ移る', await page.locator('#app').getAttribute('data-view') === 'journal');
    await page.locator('[data-action="nav"][data-view="today"]').first().click();
    await page.locator('.life-cycle-details summary').click();
    await page.locator('.life-cycle-popover [data-action="nav"]').click();
    await page.locator('#app[data-view="twelveweek"]').waitFor();
    check('12週の既存画面への入口を維持', true);
    check('ページ例外なし', !errors.length, errors);
    if (shots) fs.writeFileSync(path.join(shots, 'measurements.json'), JSON.stringify(measurements, null, 2), 'utf8');
    assert.deepEqual(failures, []);
  } finally { await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve()); }
})().catch(error => { console.error(error); process.exitCode = 1; });
