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
        recurrences: [], singleSchedules: [], declarations: [], currentView: 'dandori', selectedDate: date, timelineMode: 'planned' });
      Object.assign(s.settings, { todaySkin: skin, autoSync: false, lastOpenedDate: day, timelineCategoryFilter: '' });
      s.settings.github.autoSave = false;
      s.pomodoro.running = false;
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, blocks, tasks, skin, date, day });
    await page.reload();
    await page.locator('#app[data-view="dandori"] .timeline-tower').waitFor();
  }
  async function screenshot(width, view) {
    if (!process.env.DANDORI_REPORT_DIR) return;
    fs.mkdirSync(process.env.DANDORI_REPORT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.DANDORI_REPORT_DIR, `${width}-${view}.png`), fullPage: true });
  }
  try {
    await page.clock.install({ time: new Date(2026, 8, 29, 10, 0) });
    await page.clock.pauseAt(new Date(2026, 8, 29, 10, 0, 5)); // install 直後の同時刻は「過去」になり得る(負荷で揺れた)ため 5 秒先で止める
    await page.goto('http://localhost:' + server.address().port + '/');
    await passGithubGate(page);
    await seed([block('today-timeline'), block('past-timeline', '09:00', '09:25', {
      date: yesterday, plannedStartAt: `${yesterday}T09:00:00`, plannedEndAt: `${yesterday}T09:25:00`
    })]);
    await page.locator('#bottomNav [data-view="exec"]').click();
    await page.locator('[data-action="date-prev"]').click();
    equal((await live()).selectedDate, yesterday, '実行タブで前日を選択');
    await page.locator('#bottomNav [data-view="dandori"]').click();
    equal((await live()).selectedDate, day, '段取りタブへの切替で選択日を今日に戻す');
    equal((await stored()).selectedDate, day, '段取りへの切替後は今日を保存');
    const timelineText = await page.locator('.dandori-layout .timeline-tower').innerText();
    ok(timelineText.includes('作業 today-timeline'), '段取りの下のタイムラインに今日の予定');
    ok(!timelineText.includes('作業 past-timeline'), '段取りの下のタイムラインに前日の予定を出さない');
    await seed([block('normal'), block('repeat-plan', '11:00', '11:40', { category: '', estimateMin: 40 }),
      block('routine', '12:00', '14:00', { category: 'ルーティン', estimateMin: 120 }),
      block('carry-normal', '09:00', '09:25', { date: yesterday, plannedStartAt: `${yesterday}T09:00:00`, plannedEndAt: `${yesterday}T09:25:00` }),
      block('carry-routine', '10:00', '10:25', { category: 'ルーティン', date: yesterday, plannedStartAt: `${yesterday}T10:00:00`, plannedEndAt: `${yesterday}T10:25:00` })]);
    const timelineBlockIds = () => page.locator('.timeline-tower [data-action="edit-block"][data-id]')
      .evaluateAll(els => [...new Set(els.map(el => el.dataset.id))].sort());
    const dandoriTimelineIds = await timelineBlockIds();
    await page.locator('#bottomNav [data-view="exec"]').click();
    const execTimelineIds = await timelineBlockIds();
    await page.locator('#bottomNav [data-view="dandori"]').click();
    equal({
      today: await order(),
      summary: await page.locator('.dandori-view header > p').innerText(),
      carry: await page.locator('.dandori-view [data-action="carry-over"]').evaluateAll(els => els.map(el => el.dataset.id)),
      timelineIds: dandoriTimelineIds, timelineMatchesExec: JSON.stringify(dandoriTimelineIds) === JSON.stringify(execTimelineIds)
    }, { today: ['normal', 'repeat-plan'], summary: '2件 ・ 見積 65分 ・ 見込み終了 11:05', carry: ['carry-normal'], timelineIds: ['normal', 'repeat-plan'], timelineMatchesExec: true },
    'categoryルーティンは今日やる・件数・見積合計・見込み終了・持ち越しから除外しタイムラインは既存実行画面と一致');
    const initial = [block('b', '10:00', '10:23'), block('a'), block('done', '08:00', '08:25', { completed: true }),
      block('running', '08:30', '08:55', { actualStartAt: `${day}T08:30:00` }), block('deleted', '07:00', '07:25', { deleted: true }),
      block('moved', '07:30', '07:55', { migratedTo: 'elsewhere' })];
    const tasks = [task('none'), task('late', '2026-10-02'), task('early', day), task('done', day, { status: 'completed' }), task('deleted', day, { deleted: true })];
    await seed(initial, tasks);
    equal(await page.locator('.dandori-view').count(), 1, '独立した段取りタブに段取り');
    equal(await order(), ['a', 'b'], '未完了・未開始・有効Blockを予定開始順');
    equal(await page.locator('.dandori-number').allTextContents(), ['1', '2'], 'カードの番号');
    ok((await page.locator('.dandori-card').first().innerText()).includes('09:00 ・ 見積 25分 ・ 仕事'), '時刻・見積・カテゴリ');
    ok((await page.locator('.dandori-view header').innerText()).includes('2件 ・ 見積 50分'), '件数と既存見積ヘルパーの合計');
    const endText = await page.locator('.dandori-end').innerText();
    await page.locator('#bottomNav [data-view="exec"]').click();
    equal(endText, await page.locator('#projected-end').innerText(), '見込み終了は既存execヘッダーと一致');
    await page.locator('#bottomNav [data-view="dandori"]').click();
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
        const root = document.querySelector('.dandori-view'), rect = root.getBoundingClientRect(), timeline = document.querySelector('.timeline-tower').getBoundingClientRect();
        return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
          targets: [...root.querySelectorAll('button')].every(b => b.getBoundingClientRect().height >= 44 && b.getBoundingClientRect().width >= 44),
          columns: getComputedStyle(document.querySelector('.dandori-layout')).gridTemplateColumns.split(' ').length,
          below: timeline.top >= rect.bottom,
          sideBySide: Math.abs(rect.top - timeline.top) < 1 && timeline.left >= rect.right };
      });
      ok(geometry.scroll <= geometry.client, `${width}px 横はみ出しなし`);
      ok(geometry.targets, `${width}px 全ボタン44px以上`);
      equal(geometry.columns, width === 1280 ? 2 : 1, `${width}px 列数`);
      ok(width === 1280 ? geometry.sideBySide : geometry.below, `${width}px 段取りとタイムラインはPC横並び・スマホ縦並び`);
      if (width === 1280) ok(geometry.sideBySide, '1280px 段取りとタイムラインが横並び');
      await screenshot(width, 'dandori');
    }
    await page.locator('#sidebar [data-view="exec"]').click();
    equal(await page.locator('.dandori-view').count(), 0, 'now設定でも実行計画モードは段取りなし');
    ok(await page.locator('[data-work-list="exec"]').isVisible(), 'now設定でも実行タブは従来の一覧');
    await page.locator('[data-action="exec-mode-toggle"][data-mode="actual"]').first().click();
    equal(await page.locator('.dandori-view').count(), 0, 'now実績モードは段取りなし');
    ok(await page.locator('.timeline-tower').isVisible(), '実績タイムラインは保持');
    await page.locator('[data-action="exec-mode-toggle"][data-mode="plan"]').first().click();
    await seed(initial, tasks, 'tower');
    equal(await page.locator('.dandori-view').count(), 1, 'tower設定でも段取りタブに表示');
    await page.locator('#sidebar [data-view="exec"]').click();
    equal(await page.locator('.dandori-view').count(), 0, 'tower設定でも実行計画モードは段取りなし');
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
    await seed([block('timed'), block('undated', '', '', { plannedStartAt: '', plannedEndAt: '' })]);
    const beforeUndated = await stored();
    await page.locator('.dandori-card').first().locator('[data-dir="down"]').click();
    await page.getByText('開始時刻のない予定とは入れ替えられません', { exact: true }).waitFor();
    equal(await stored(), beforeUndated, '未定Blockの隣で▼を押しても保存値は変わらない');
    ok(!JSON.stringify((await stored()).blocks).includes('1970'), '未定Blockの並べ替えで1970を書かない');
    equal((await live()).blocks, beforeUndated.blocks, '未定Blockの並べ替えで実行中stateも変えない');
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await seed([block('running', '09:00', '10:25', { actualStartAt: `${day}T09:00:00` })], tasks, 'tower');
      const nav = width === 375 ? '#bottomNav' : '#sidebar';
      for (const id of ['now', 'dandori']) {
        equal(await page.locator(`${nav} [data-view="${id}"]`).count(), 1, `${width}px ${id}タブが常設`);
        await page.locator(`${nav} [data-view="${id}"]`).click();
        equal((await live()).currentView, id, `${width}px ${id}タブへ切替`);
        ok(await page.locator(`${nav} [data-view="${id}"].active`).isVisible(), `${width}px ${id}タブの選択表示`);
      }
      if (width === 375) {
        const buttons = await page.locator('#bottomNav button').evaluateAll(els => els.map(el => {
          const r = el.getBoundingClientRect();
          return { id: el.dataset.view, width: r.width, height: r.height, left: r.left, right: r.right,
            nowrap: getComputedStyle(el).whiteSpace === 'nowrap', fits: el.scrollWidth <= el.clientWidth };
        }));
        equal(buttons.map(b => b.id), ['now', 'dandori', 'today', 'exec', 'wbs', 'more'], '375px 下ナビ6枠の順序');
        ok(buttons.every(b => b.width >= 44 && b.height >= 44), '375px 下ナビ全6枠44px以上');
        ok(buttons.every(b => b.left >= 0 && b.right <= 375 && b.nowrap && b.fits), '375px 下ナビは横はみ出し・文字折返しなし');
      }
      await page.locator(`${nav} [data-view="exec"]`).click();
      await page.clock.runFor(1000);
      equal(await page.evaluate(async () => (await import('/src/features/today.js')).isTodayTickerRunning()), false, '実行タブでticker停止');
      await page.locator(`${nav} [data-view="now"]`).click();
      equal(await page.locator('#app').getAttribute('data-skin'), 'now', 'tower設定でもいまタブはnowスキン');
      const elapsed = await page.locator('[data-elapsed-id="running"]').innerText();
      for (let second = 1; second <= 2; second++) {
        await page.clock.runFor(1000);
        const initialSeconds = elapsed.split(':').reduce((m, s) => m * 60 + Number(s), 0) + second;
        equal(await page.locator('[data-elapsed-id="running"]').innerText(), `${Math.floor(initialSeconds / 60)}:${String(initialSeconds % 60).padStart(2, '0')}`, `${width}px いまタブの${second}秒後の経過更新`);
      }
      await screenshot(width, 'now');
      await page.locator(`${nav} [data-view="today"]`).click();
      equal(await page.locator('#app').getAttribute('data-skin'), 'tower', '今日タブはtower設定を維持');
      ok(await page.locator('.today-tower').isVisible(), '今日タブにTOWERを表示');
      await screenshot(width, 'today');
      await seed([], [], 'now');
      await page.locator(`${nav} [data-view="today"]`).click();
      ok(await page.locator('#app[data-view="today"][data-skin="now"] .now-view').isVisible(), '今日タブのnow設定も維持');
      await page.getByRole('button', { name: '段取りで決める', exact: true }).click();
      equal((await live()).currentView, 'dandori', '空のいまから段取りタブへ');
      await page.clock.setSystemTime(new Date(2026, 8, 29, 10, 0));
    }
    await page.setViewportSize({ width: 375, height: 900 });
    await seed([block('tail', '10:00', '10:23', { completed: true, actualEndAt: `${day}T10:27:01` })]);
    const rules = [
      { id: 'daily', title: '朝の支度', kind: 'daily', startTime: '06:00', endTime: '06:25', category: '生活', taskId: 'routine-task' },
      { id: 'weekdays', title: '平日の整理', kind: 'weekdays', startTime: '07:00', endTime: '07:15' },
      { id: 'monthly', title: '月の整理', kind: 'monthly', startTime: '08:00', endTime: '08:50' },
      { id: 'weekly', title: '週の整理', kind: 'weekly', startTime: '09:00', endTime: '09:10' },
      { id: 'deleted-rule', title: '削除済み', kind: 'daily', deleted: true },
      { id: 'unsupported', title: '対象外', kind: 'none' }
    ];
    async function setRoutines(values) {
      await page.evaluate(async values => {
        (await import('/src/state/store.js')).state.recurrences = values;
        document.querySelector('.dandori-view').outerHTML = (await import('/src/features/dandori-view.js')).renderDandoriView();
      }, values);
    }
    await setRoutines(rules);
    equal(await page.locator('[data-action="dandori-add-routine"]').count(), 0, '段取りにルーティン追加ボタンを出さない');
    equal(await page.locator('.dandori-candidates').getByRole('heading', { name: 'ルーティン', exact: true }).count(), 0, '段取りの候補にルーティン見出しを出さない');
    await seed([block('draft-tail', '10:00', '10:23')], [task('draft-task', day)]);
    await setRoutines(rules);
    const draftInput = page.locator('[data-field="dandori-free-title"]');
    const draftTitle = '途中の "作業" <確認> & 続き';
    await draftInput.fill(draftTitle);
    await page.locator('[data-action="dandori-add-task"][data-id="draft-task"]').click();
    equal(await draftInput.inputValue(), draftTitle, '候補追加のsaveAndRender後も入力途中の文字を保持');
    await page.locator('[data-action="dandori-add-free"]').click();
    equal(await draftInput.inputValue(), '', '保持した文字も足すと消える');
    equal((await stored()).blocks.filter(b => b.title === draftTitle).length, 1, '保持した文字で自由追加できる');
    await setRoutines(rules);
    equal(await draftInput.inputValue(), '', '追加後の再描画でも入力は空');
    await draftInput.fill('消す途中');
    await draftInput.fill('');
    await setRoutines(rules);
    equal(await draftInput.inputValue(), '', '手動で空にした後の再描画でも入力は空');
    await seed([block('free-tail', '10:00', '10:23')]);
    const freeInput = page.locator('[data-field="dandori-free-title"]');
    const freeButton = page.locator('[data-action="dandori-add-free"]');
    await freeInput.fill('  自由な作業  ');
    await freeInput.dispatchEvent('compositionstart');
    await freeInput.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
    equal((await live()).blocks.length, 1, 'IME変換確定のEnterで追加しない');
    await freeInput.dispatchEvent('compositionend', { data: '自由な作業' });
    equal(await freeInput.inputValue(), '  自由な作業  ', 'IME確定で入力を消さない');
    await freeButton.click();
    const freeBlock = (await stored()).blocks.find(b => b.title === '自由な作業');
    equal([freeBlock.date, freeBlock.plannedStartAt, freeBlock.plannedEndAt], [day, `${day}T10:25:00`, `${day}T10:55:00`], '自由追加は今日の末尾・既定見積30分');
    ok(!freeBlock.recurrenceGroupId, '自由追加に繰り返しの紐付けなし');
    equal(await freeInput.inputValue(), '', '自由追加後は入力欄を空にする');
    await freeButton.click();
    await freeInput.fill('   '); await freeButton.click();
    equal((await stored()).blocks.length, 2, '空入力と空白だけの追加は何もしない');
    await page.reload(); await page.locator('.dandori-view').waitFor();
    equal((await live()).blocks.find(b => b.id === freeBlock.id), { ...freeBlock, copiedFromId: '', isMIT: false, source: '' }, '自由追加Blockは再読込後も残る');
    await setRoutines(rules);
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.locator('.dandori-view').evaluate(root => ({
        fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        targets: [...root.querySelectorAll('button, input')].every(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }),
        font: parseFloat(getComputedStyle(root.querySelector('[data-field="dandori-free-title"]')).fontSize)
      }));
      ok(geometry.fits, `${width}px 新候補に横はみ出しなし`);
      ok(geometry.targets, `${width}px 新候補の入力・操作は44px以上`);
      ok(geometry.font >= 16, `${width}px 自由追加入力は16px以上`);
      await screenshot(width, 'dandori-b2b1');
    }
    const tomorrow = '2026-09-30';
    await seed([block('old-day'), block('next-day', '08:00', '08:25', { date: tomorrow,
      plannedStartAt: `${tomorrow}T08:00:00`, plannedEndAt: `${tomorrow}T08:25:00` })]);
    await page.clock.setSystemTime(new Date(2026, 8, 30, 0, 1));
    await page.clock.runFor(1000);
    equal((await live()).selectedDate, tomorrow, '段取りを開いたまま0時跨ぎで選択日は翌日');
    ok((await page.locator('.dandori-view header').innerText()).includes(`今日 ${tomorrow}`), '日跨ぎで上段の日付も翌日');
    equal(await order(), ['next-day'], '日跨ぎで今日やるを翌日分へ再描画');
    const nextTimeline = await page.locator('.dandori-layout .timeline-tower').innerText();
    ok(nextTimeline.includes('作業 next-day') && !nextTimeline.includes('作業 old-day'), '日跨ぎで下段タイムラインも翌日分へ再描画');
    equal(errors, [], 'ブラウザ例外なし');
    console.log(`PASS dandori-view: ${assertions} assertions`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
