const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require('./helpers');
let assertions = 0;
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; console.log('PASS', message); };
const ok = (value, message) => { assert.ok(value, message); assertions++; console.log('PASS', message); };

(async () => {
  const server = startServer(randomPort()), browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Asia/Tokyo', viewport: { width: 375, height: 900 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(10000);
  await blockGithubApiByDefault(page);
  const day = '2026-09-29', yesterday = '2026-09-28';
  const block = (id, start = '09:00', end = '09:25', extra = {}) => ({ id, title: `作業 ${id}`, date: day, taskId: '',
    deleted: false, completed: false, plannedStartAt: `${day}T${start}:00`, plannedEndAt: `${day}T${end}:00`,
    actualStartAt: '', actualEndAt: '', estimateMin: 25, category: '仕事', comment: '', ...extra });
  const task = (id, dueDate = '', extra = {}) => ({ id, title: `候補 ${id}`, dueDate, projectId: 'p', category: '仕事', status: 'todo', deleted: false, ...extra });
  const live = () => page.evaluate(async () => JSON.parse(JSON.stringify((await import('/src/state/store.js')).state)));
  const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  const order = () => page.locator('.dandori-card').evaluateAll(rows => rows.map(r => r.dataset.blockId));
  async function seed(blocks, tasks = [], skin = 'now', date = day) {
    await page.evaluate(({ key, blocks, tasks, skin, date, day }) => {
      const s = JSON.parse(localStorage.getItem(key));
      Object.assign(s, { blocks, tasks, projects: [{ id: 'p', title: '仕事', status: 'active', deleted: false }],
        recurrences: [], singleSchedules: [], declarations: [], currentView: 'exec', selectedDate: date, timelineMode: 'planned' });
      Object.assign(s.settings, { todaySkin: skin, autoSync: false, lastOpenedDate: day, timelineCategoryFilter: '' });
      s.settings.github.autoSave = false;
      s.pomodoro.running = false;
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, blocks, tasks, skin, date, day });
    await page.reload();
    await page.locator('#app[data-view="exec"] .timeline-tower').waitFor();
  }
  async function screenshot(width) {
    if (!process.env.DANDORI_REPORT_DIR) return;
    fs.mkdirSync(process.env.DANDORI_REPORT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.DANDORI_REPORT_DIR, `${width}.png`), fullPage: true });
  }
  try {
    await page.clock.setFixedTime(new Date(2026, 8, 29, 10, 0));
    await page.goto('http://localhost:' + server.address().port + '/');
    await passGithubGate(page);
    const initial = [block('b', '10:00', '10:23'), block('a'), block('done', '08:00', '08:25', { completed: true }),
      block('running', '08:30', '08:55', { actualStartAt: `${day}T08:30:00` }), block('deleted', '07:00', '07:25', { deleted: true }),
      block('moved', '07:30', '07:55', { migratedTo: 'elsewhere' })];
    const tasks = [task('none'), task('late', '2026-10-02'), task('early', day), task('done', day, { status: 'completed' }), task('deleted', day, { deleted: true })];
    await seed(initial, tasks);
    equal(await page.locator('.dandori-view').count(), 1, 'now計画モードに段取り');
    equal(await order(), ['a', 'b'], '未完了・未開始・有効Blockを予定開始順');
    equal(await page.locator('.dandori-number').allTextContents(), ['1', '2'], 'カードの番号');
    ok((await page.locator('.dandori-card').first().innerText()).includes('09:00 ・ 見積 25分 ・ 仕事'), '時刻・見積・カテゴリ');
    ok((await page.locator('.dandori-view header').innerText()).includes('2件 ・ 見積 50分'), '件数と既存見積ヘルパーの合計');
    equal(await page.locator('.dandori-end').innerText(), await page.locator('#projected-end').innerText(), '見込み終了は既存execヘッダーと一致');
    equal(await page.locator('[data-action="dandori-add-task"]').evaluateAll(rows => rows.map(r => r.dataset.id)), ['early', 'late', 'none'], '未完了タスク期限順・期限なし末尾');
    ok(await page.locator('[data-action="dandori-move"][data-id="a"][data-dir="up"]').isDisabled(), '先頭を上へ動かせない');
    await page.locator('[data-action="dandori-move"][data-id="a"][data-dir="down"]').click();
    equal(await order(), ['b', 'a'], '下へ移動');
    let saved = (await stored()).blocks;
    equal(saved.filter(b => ['a', 'b'].includes(b.id)).map(b => [b.id, b.plannedStartAt, b.plannedEndAt]),
      [['b', `${day}T09:00:00`, `${day}T09:23:00`], ['a', `${day}T10:00:00`, `${day}T10:25:00`]], '開始を交換し元の長さで終了を保存');
    await page.reload(); await page.locator('.dandori-view').waitFor();
    equal(await order(), ['b', 'a'], '保存→再読込で順番維持');
    await page.locator('[data-action="dandori-move"][data-id="a"][data-dir="up"]').click();
    equal(await order(), ['a', 'b'], '上へ移動');
    await page.locator('[data-action="dandori-add-task"][data-id="early"]').click();
    let added = (await stored()).blocks.filter(b => b.taskId === 'early' && b.date === day);
    equal(added.length, 1, '候補から今日のBlockを保存');
    equal(added[0].plannedStartAt, `${day}T10:25:00`, '10:23終了→10:25開始');
    const addedButton = page.locator('[data-action="dandori-add-task"][data-id="early"]');
    equal(await addedButton.getAttribute('aria-disabled'), 'true', '追加済み候補の非活性表現');
    ok(await addedButton.evaluate(el => Number(getComputedStyle(el).opacity) < 1), '追加済みは薄い表示');
    await addedButton.evaluate(el => el.click());
    equal((await stored()).blocks.filter(b => b.taskId === 'early' && b.date === day).length, 1, '再クリックでも重複しない');
    await page.reload(); await page.locator('.dandori-view').waitFor();
    equal((await live()).blocks.find(b => b.id === added[0].id).plannedStartAt, `${day}T10:25:00`, '候補追加も再読込で残る');
    await page.locator('.dandori-view [data-action="edit-block"][data-id="a"]').click();
    equal((await live()).modal.type, 'block', '直すは既存Blockモーダル');
    equal((await live()).modal.id, 'a', '編集対象ID');
    ok(await page.locator('[data-modal-field="plannedStartAt"]').isVisible(), '既存の予定開始入力');
    equal(await page.locator('[data-modal-field="plannedStartAt"]').getAttribute('type'), 'datetime-local', 'ネイティブ日時入力');
    equal(await page.locator('[data-modal-field="plannedStartAt"]').getAttribute('step'), '300', '5分刻み');
    await page.locator('[data-action="modal-close"]').first().click();
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('.dandori-view [data-action="dandori-remove"][data-id="a"]').click();
    equal((await live()).blocks.find(b => b.id === 'a').deleted, false, '外すの既存確認を取消して保持');
    equal((await live()).modal, null, '外すの取消でモーダルも閉じる');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.dandori-view [data-action="dandori-remove"][data-id="a"]').click();
    equal((await stored()).blocks.find(b => b.id === 'a').deleted, true, '外すは既存削除経路の墓標保存');
    const carry = block('carry', '09:00', '09:25', { date: yesterday, plannedStartAt: `${yesterday}T09:00:00`, plannedEndAt: `${yesterday}T09:25:00` });
    await seed([carry, { ...carry, id: 'carried', migratedTo: 'target' }, { ...carry, id: 'finished', completed: true },
      { ...carry, id: 'older', date: '2026-09-27' }], tasks);
    equal(await page.locator('.dandori-view [data-action="carry-over"]').evaluateAll(rows => rows.map(r => r.dataset.id)), ['carry'], '昨日だけ・完了とmigratedToを除く');
    await page.locator('.dandori-view [data-action="carry-over"]').click();
    saved = (await stored()).blocks;
    const source = saved.find(b => b.id === 'carry'), destination = saved.find(b => b.id === source.migratedTo);
    ok(source.migratedTo, '持ち越し元にmigratedTo保存');
    equal(destination.date, day, '持ち越し先は今日');
    equal(destination.plannedStartAt, `${day}T09:00:00`, '既存持ち越しの時刻を維持');
    equal(await page.locator('.dandori-view [data-action="carry-over"]').count(), 0, '持ち越し後は候補から消える');
    await page.reload(); await page.locator('.dandori-view').waitFor();
    equal(await page.locator('.dandori-view [data-action="carry-over"]').count(), 0, '再読込後も二重持ち越しなし');
    await seed([block('long', '09:00', '10:23', { title: '非常に長い作業名'.repeat(12) }), block('second', '11:00', '11:25')], tasks);
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.evaluate(() => {
        const root = document.querySelector('.dandori-view'), today = root.querySelector('.dandori-today').getBoundingClientRect(), candidates = root.querySelector('.dandori-candidates').getBoundingClientRect();
        return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
          targets: [...root.querySelectorAll('button')].every(b => b.getBoundingClientRect().height >= 44 && b.getBoundingClientRect().width >= 44),
          columns: getComputedStyle(root.querySelector('.dandori-columns')).gridTemplateColumns.split(' ').length,
          below: document.querySelector('.timeline-tower').getBoundingClientRect().top >= root.getBoundingClientRect().bottom,
          sideBySide: Math.abs(today.top - candidates.top) < 1 && candidates.left > today.left };
      });
      ok(geometry.scroll <= geometry.client, `${width}px 横はみ出しなし`);
      ok(geometry.targets, `${width}px 全ボタン44px以上`);
      equal(geometry.columns, width === 1280 ? 2 : 1, `${width}px 列数`);
      ok(geometry.below, `${width}px 既存タイムラインが下にある`);
      if (width === 1280) ok(geometry.sideBySide, '1280px 今日やると候補が横並び');
      await screenshot(width);
    }
    await page.locator('[data-action="exec-mode-toggle"][data-mode="actual"]').first().click();
    equal(await page.locator('.dandori-view').count(), 0, 'now実績モードは段取りなし');
    ok(await page.locator('.timeline-tower').isVisible(), '実績タイムラインは保持');
    await page.locator('[data-action="exec-mode-toggle"][data-mode="plan"]').first().click();
    await seed(initial, tasks, 'tower');
    equal(await page.locator('.dandori-view').count(), 0, 'tower計画モードは段取りなし');
    ok(await page.locator('[data-work-list="exec"]').isVisible(), 'towerは従来の一覧');
    await seed([], [task('empty')]);
    await page.locator('[data-action="dandori-add-task"][data-id="empty"]').click();
    equal((await stored()).blocks.find(b => b.taskId === 'empty').plannedStartAt, `${day}T10:00:00`, '空なら既存defaultPlannedTimes');
    await seed([], Array.from({ length: 12 }, (_, i) => task(`limit-${i}`, `2026-10-${String(i + 1).padStart(2, '0')}`)));
    equal(await page.locator('[data-action="dandori-add-task"]').count(), 10, '期限候補は10件まで');
    await seed([block('selected', '14:00', '14:25', { date: yesterday, plannedStartAt: `${yesterday}T14:00:00`, plannedEndAt: `${yesterday}T14:25:00` }), block('today', '10:00', '10:23')], [task('from-past')], 'now', yesterday);
    // 起動時は今日へ戻るため、選択日表示の境界に過去日を投入する。
    await page.evaluate(async date => {
      (await import('/src/state/store.js')).state.selectedDate = date;
      document.querySelector('.dandori-view').outerHTML = (await import('/src/features/dandori-view.js')).renderDandoriView();
    }, yesterday);
    equal(await order(), ['today'], '今日やる欄は常に今日を表示');
    ok((await page.locator('.dandori-view').innerText()).includes('時間軸は選択日、段取りは今日です'), '選択日と今日の注意');
    ok((await page.locator('.dandori-view header').innerText()).includes(`今日 ${day}`), '見出しに今日の日付');
    await page.locator('[data-action="dandori-add-task"][data-id="from-past"]').click();
    equal((await stored()).blocks.find(b => b.taskId === 'from-past').date, day, '過去日閲覧中も候補は今日へ');
    equal((await stored()).blocks.find(b => b.taskId === 'from-past').plannedStartAt, `${day}T10:25:00`, '過去日ではなく今日の末尾に追加');
    equal((await live()).selectedDate, yesterday, '追加しても選択日を維持');
    equal((await stored()).selectedDate, yesterday, '保存した選択日も維持');
    await seed([block('short', '09:00', '09:10', { estimateMin: 10 }), block('long', '10:00', '10:50', { estimateMin: 50 })]);
    await page.locator('[data-action="dandori-move"][data-id="short"][data-dir="down"]').click();
    equal((await stored()).blocks.map(b => [b.id, b.plannedStartAt, b.plannedEndAt, b.estimateMin]),
      [['short', `${day}T10:00:00`, `${day}T10:10:00`, 10], ['long', `${day}T09:00:00`, `${day}T09:50:00`, 50]], '10分と50分の長さと見積を保って開始だけ交換');
    await seed([block('running', '10:00', '11:00', { actualStartAt: `${day}T10:00:00` })], [task('estimate', '', { estimateMin: 50 })]);
    await page.locator('[data-action="dandori-add-task"][data-id="estimate"]').click();
    added = (await stored()).blocks.find(b => b.taskId === 'estimate');
    equal(added.plannedStartAt, `${day}T11:00:00`, '実行中の終了以降に追加');
    equal(added.estimateMin, 50, 'タスクの見積をBlockへ渡す');
    equal(added.plannedEndAt, `${day}T11:50:00`, '見積とBlockの長さが一致');
    const many = Array.from({ length: 12 }, (_, i) => task(`new-${i}`, `2026-10-${String(i + 1).padStart(2, '0')}`));
    const already = Array.from({ length: 11 }, (_, i) => task(`added-${i}`, day));
    await seed(already.map(t => block(t.id, '09:00', '09:25', { taskId: t.id })),
      [...already, ...many, task('suspended', day, { status: 'suspended' }), task('cancelled', day, { status: 'cancelled' })]);
    equal(await page.locator('[data-action="dandori-add-task"]').evaluateAll(rows => rows.map(r => r.dataset.id)),
      [...many.slice(0, 10), ...already].map(t => t.id), '未追加10件の後に追加済み全件・停止と中止は除外');
    ok(await page.locator('[data-action="dandori-add-task"][aria-disabled="true"]').evaluateAll(rows => rows.length === 11 && rows.every(el => Number(getComputedStyle(el).opacity) < 1)), '追加済み全件を薄く表示');
    equal(errors, [], 'ブラウザ例外なし');
    console.log(`PASS dandori-view: ${assertions} assertions`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
