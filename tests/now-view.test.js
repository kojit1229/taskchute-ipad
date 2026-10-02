const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require('./helpers');
let assertions = 0;
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; console.log('PASS', message); };
const ok = (value, message) => { assert.ok(value, message); assertions++; console.log('PASS', message); };

(async () => {
  const port = randomPort(), server = startServer(port);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Asia/Tokyo', viewport: { width: 375, height: 900 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(10000);
  await blockGithubApiByDefault(page);
  const day = '2026-09-29';
  const block = (id, extra = {}) => ({ id, title: `作業 ${id}`, date: day, taskId: '', deleted: false, completed: false,
    plannedStartAt: `${day}T12:00:00`, plannedEndAt: `${day}T12:25:00`, actualStartAt: '', actualEndAt: '',
    estimateMin: 25, category: '', comment: '', ...extra });
  const live = () => page.evaluate(async () => JSON.parse(JSON.stringify((await import('/src/state/store.js')).state)));
  const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  async function seed(blocks, skin, settings = {}) {
    await page.evaluate(({ key, blocks, skin, settings, day }) => {
      const s = JSON.parse(localStorage.getItem(key));
      Object.assign(s, { blocks, tasks: [], projects: [], recurrences: [], singleSchedules: [], declarations: [], currentView: 'today', selectedDate: day });
      Object.assign(s.settings, { todaySkin: skin, autoSync: false, towerMotion: 'normal' }, settings);
      if (skin === 'missing') delete s.settings.todaySkin;
      s.pomodoro.running = false;
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, blocks, skin, settings, day });
    await page.reload();
    await page.locator('#app[data-view="today"] .now-view, #app[data-view="today"] .today-tower').waitFor();
  }
  const tick = () => page.evaluate(async () => (await import('/src/features/now-view.js')).updateNowViewTick());
  // 再読込のnormalizeStateは不正日時を空にするため、表示境界へ直接投入する。
  async function seedDisplayBlocks(blocks) {
    await seed([], 'now');
    await page.evaluate(async blocks => {
      (await import('/src/state/store.js')).state.blocks = blocks;
      document.querySelector('.now-view').outerHTML = (await import('/src/features/now-view.js')).renderNowView();
    }, blocks);
  }
  const at = (h, m, s = 0, date = 29) => new Date(2026, 8, date, h, m, s);
  async function start(id) {
    await page.locator(`.now-view [data-action="now-start"][data-id="${id}"]`).click();
    await page.locator('[data-declare-note]').fill(`まず ${id}`);
    await page.locator('[data-action="declare-confirm"]').click();
    await page.locator(`[data-running-id="${id}"]`).waitFor();
    ok((await live()).blocks.find(b => b.id === id).actualStartAt, `${id}: 宣言して開始時刻を保存`);
  }
  async function end(id, outcome, note) {
    await page.locator(`.now-view [data-action="now-end"][data-id="${id}"]`).click();
    equal(await page.locator('[data-action="report-outcome"]').count(), 3, `${id}: 既存終了報告の3択`);
    await page.locator('[data-report-note]').fill(note);
    await page.locator(`[data-action="report-outcome"][data-outcome="${outcome}"]`).click();
    await page.locator(`.now-done [data-record-id="${id}"]`).waitFor();
    if (outcome === 'done') await page.getByRole('button', { name: '記録せず閉じる', exact: true }).click();
    ok((await stored()).blocks.find(b => b.id === id).comment.includes(note), `${id}: 一言を既存commentへ保存`);
  }
  const allMotionStopped = () => page.evaluate(() => [...document.querySelectorAll('.now-view, .now-view *')]
    .every(el => [null, '::before', '::after'].every(pseudo => {
      const style = getComputedStyle(el, pseudo);
      return style.animationName === 'none' && style.transitionDuration.split(',').every(t => parseFloat(t) === 0);
    })));
  try {
    await page.clock.setFixedTime(at(12, 0));
    await page.goto(`http://localhost:${port}/`);
    await page.locator('[data-action="gate-continue"]').waitFor();
    await passGithubGate(page);
    await seed([block('draft-a', { estimateMin: 15 }), block('draft-b', { estimateMin: 50, updatedAt: `${day}T11:00:00` })], 'now');
    await page.locator('[data-action="nav"][data-view="now"]:visible').click();
    const declaration = page.locator('[data-field="now-declaration"][data-id="draft-a"]');
    const draft = 'まず <紙> を1枚 & "整理"';
    await declaration.fill(draft);
    const declarationNode = await declaration.elementHandle();
    await declaration.dispatchEvent('compositionstart');
    await tick();
    ok(await declarationNode.evaluate(el => el === document.activeElement), '宣言のIME入力中もtickでフォーカスとDOMを保持');
    await declaration.dispatchEvent('compositionend', { data: draft });
    equal(await declaration.inputValue(), draft, '宣言欄のクリック・入力で開始しない');
    equal((await live()).blocks.find(b => b.id === 'draft-a').actualStartAt, '', '宣言下書きは未開始のまま');
    const previousUpdatedAt = (await live()).blocks.find(b => b.id === 'draft-b').updatedAt;
    await page.clock.setFixedTime(at(12, 1));
    await page.locator('[data-action="now-estimate"][data-id="draft-b"][data-minutes="25"]').click();
    ok((await stored()).blocks.find(b => b.id === 'draft-b').updatedAt > previousUpdatedAt, '見積ボタンで保存したBlock.updatedAtが前より新しい');
    equal(await declaration.inputValue(), draft, '別カードの見積で全再描画しても宣言下書きを保持');
    equal((await live()).blocks.find(b => b.id === 'draft-b').estimateMin, 25, '見積25をBlockへ反映');
    equal((await stored()).blocks.find(b => b.id === 'draft-b').estimateMin, 25, '見積25を既存保存経路で保存');
    equal(await page.locator('[data-action="now-estimate"][data-id="draft-b"][aria-pressed="true"]').getAttribute('data-minutes'), '25', '保存した見積だけ選択状態');
    equal((await stored()).declarations.length, 0, 'カードの宣言下書きは宣言ログへ保存しない');
    await page.locator('[data-action="now-start"][data-id="draft-a"]').click();
    equal(await page.locator('[data-declare-note]').inputValue(), draft, 'カードの宣言を既存モーダルへそのまま渡す');
    await page.locator('[data-declare-note]').fill('モーダルで編集');
    await page.locator('[data-action="declare-confirm"]').click();
    await page.locator('[data-running-id="draft-a"]').waitFor();
    equal((await stored()).declarations.find(d => d.blockId === 'draft-a').note, 'モーダルで編集', '宣言の保存はモーダルの編集値を優先');
    await page.evaluate(async () => {
      const state = (await import('/src/state/store.js')).state;
      state.blocks.find(b => b.id === 'draft-a').actualStartAt = '';
      document.querySelector('.now-view').outerHTML = (await import('/src/features/now-view.js')).renderNowView();
    });
    equal(await declaration.inputValue(), '', '開始後はモジュールの宣言下書きが空');
    await page.reload();
    await page.locator('[data-action="now-estimate"][data-id="draft-b"]').first().waitFor();
    equal((await live()).blocks.find(b => b.id === 'draft-b').estimateMin, 25, '再読込後も見積25を保持');
    equal(await page.locator('[data-action="now-estimate"][data-id="draft-b"][aria-pressed="true"]').getAttribute('data-minutes'), '25', '再読込後も25分が選択状態');
    for (const choice of ['end', 'parallel']) {
      await seed([block('overlap-running', { actualStartAt: `${day}T11:55:00` }), block('overlap-draft')], 'now');
      await page.locator('[data-action="nav"][data-view="now"]:visible').click();
      await page.locator('[data-field="now-declaration"][data-id="overlap-draft"]').fill(draft);
      await page.locator('[data-action="now-start"][data-id="overlap-draft"]').click();
      await page.locator(`[data-action="start-overlap-choice"][data-choice="${choice}"]`).click();
      equal(await page.locator('[data-declare-note]').inputValue(), draft, `重複開始の${choice}選択後もカードの宣言をモーダルへ渡す`);
    }
    await seed([block('tower-draft')], 'tower');
    await page.locator('[data-action="nav"][data-view="now"]:visible').click();
    await page.locator('[data-field="now-declaration"][data-id="tower-draft"]').fill('いま専用の下書き');
    await page.locator('[data-action="nav"][data-view="today"]:visible').click();
    await page.locator('.today-tower [data-action="now-start"][data-id="tower-draft"]').click();
    equal(await page.locator('[data-declare-note]').inputValue(), '', '今日タブTOWERからの開始にはいまの宣言下書きを差し込まない');
    await page.locator('[data-action="declare-confirm"]').click();
    equal((await stored()).declarations.find(d => d.blockId === 'tower-draft').note, '', 'TOWERの宣言確定にもいまの下書きを差し込まない');
    await seed([block('today-skin-draft')], 'now');
    await page.locator('#app[data-view="today"] [data-field="now-declaration"][data-id="today-skin-draft"]').fill(draft);
    await page.locator('#app[data-view="today"] [data-action="now-start"][data-id="today-skin-draft"]').click();
    equal(await page.locator('[data-declare-note]').inputValue(), draft, '今日タブの見た目いまでもカードの宣言をモーダルへ渡す');
    await seed([block('today-skin-draft')], 'tower');
    await page.locator('[data-action="nav"][data-view="now"]:visible').click();
    await page.locator('[data-field="now-declaration"][data-id="today-skin-draft"]').fill(draft);
    await page.locator('[data-action="nav"][data-view="today"]:visible').click();
    await page.locator('.today-tower [data-action="now-start"][data-id="today-skin-draft"]').click();
    equal(await page.locator('[data-declare-note]').inputValue(), '', '同じBlockも今日タブの見た目TOWERではいまタブの宣言を混ぜない');
    await page.clock.setFixedTime(at(12, 0));
    const nextDay = '2026-09-30';
    await seed([
      block('previous-candidate'),
      block('next-candidate', { date: nextDay, plannedStartAt: `${nextDay}T12:00:00`, plannedEndAt: `${nextDay}T12:25:00` }),
      block('previous-done', { completed: true, actualStartAt: `${day}T10:00:00`, actualEndAt: `${day}T10:25:00` }),
      block('next-done', { date: nextDay, completed: true, plannedStartAt: `${nextDay}T00:00:00`, plannedEndAt: `${nextDay}T00:01:00`, actualStartAt: `${nextDay}T00:00:00`, actualEndAt: `${nextDay}T00:01:00` })
    ], 'now');
    await page.evaluate(key => {
      const s = JSON.parse(localStorage.getItem(key));
      s.currentView = 'now';
      localStorage.setItem(key, JSON.stringify(s));
    }, STATE_KEY);
    await page.clock.setFixedTime(at(23, 59));
    await page.reload();
    await page.locator('#app[data-view="now"] .now-view').waitFor();
    equal((await live()).currentView, 'now', '保存されたいまタブから起動');
    equal(await page.locator('.now-start [data-action="now-start"]').evaluateAll(els => els.map(el => el.dataset.id)), ['previous-candidate'], '日跨ぎ前は当日の開始候補');
    equal(await page.locator('.now-done > [data-record-id]').evaluateAll(els => els.map(el => el.dataset.recordId)), ['previous-done'], '日跨ぎ前は当日の今日できた');
    await page.clock.setFixedTime(at(0, 1, 0, 30));
    await page.evaluate(async () => (await import('/src/features/today.js')).updateTodayTick());
    equal(await page.locator('.now-start [data-action="now-start"]').evaluateAll(els => els.map(el => el.dataset.id)), ['next-candidate'], '日跨ぎtickで翌日の開始候補へ');
    equal(await page.locator('.now-done > [data-record-id]').evaluateAll(els => els.map(el => el.dataset.recordId)), ['next-done'], '日跨ぎtickで翌日の今日できたへ');
    equal(await page.locator('.now-done details [data-record-id="previous-done"]').count(), 1, '日跨ぎtickで前日の記録は履歴へ');
    await page.clock.setFixedTime(at(12, 0));
    for (const skin of ['missing', 'invalid', 'cockpit', 'now', 'tower']) {
      await seed([], skin);
      equal((await live()).settings.todaySkin, skin === 'now' ? 'now' : 'tower', `${skin}: normalizeStateの補完`);
      equal(await page.locator(skin === 'now' ? '.now-view' : '.today-tower').count(), 1, `${skin}: スキン描画`);
    }
    await seed([], 'now');
    await page.getByRole('button', { name: '段取りで決める', exact: true }).click();
    await page.locator('#app[data-view="dandori"]').waitFor();
    equal((await live()).currentView, 'dandori', 'Blockなしの案内で段取りタブへ');
    await seed([block('b', { plannedStartAt: `${day}T13:00:00` }), block('a', { isMIT: true })], 'now');
    equal(await page.locator('.now-start [data-action="now-start"]').evaluateAll(els => els.map(el => el.dataset.id)), ['a', 'b'], '未着手は予定順');
    ok((await page.locator('.now-start').textContent()).includes('★'), '主役に★');
    equal(await page.locator('.now-view > section > h2').allTextContents(), ['開始', 'いま', '今日できた', '積み上げ', 'これから'], 'DOM順序');
    await start('a');
    const card = await page.locator('[data-running-id="a"]').elementHandle();
    const elapsed = page.locator('[data-elapsed-id="a"]');
    equal(await elapsed.textContent(), '0:00', '開始時の経過');
    await page.clock.setFixedTime(at(12, 0, 3)); await tick();
    equal(await elapsed.textContent(), '0:03', '3秒後の経過');
    ok(await card.evaluate(el => el === document.querySelector('[data-running-id="a"]')), '実行中カードは同じDOMノード');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.setFixedTime(at(12, 1)); await tick();
    equal(await elapsed.textContent(), '0:03', '非表示中は経過を書き換えない');
    equal(await page.locator('.now-view').getAttribute('data-paused'), '1', '非表示中は演出停止');
    ok(await allMotionStopped(), 'pausedは疑似要素も停止');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    equal(await elapsed.textContent(), '1:00', '復帰で実時間へ追随');
    await page.locator('.now-view [data-action="now-end"]').click();
    const note = page.locator('[data-report-note]');
    await note.fill('入力を保持'); await note.focus();
    const input = await note.elementHandle();
    await page.clock.setFixedTime(at(12, 2)); await tick();
    equal(await note.inputValue(), '入力を保持', 'tickで終了報告の下書きを保持');
    ok(await input.evaluate(el => el === document.activeElement), 'tickで入力フォーカスを保持');
    await page.locator('[data-action="report-outcome"][data-outcome="done"]').click();
    await page.locator('[data-record-id="a"]').waitFor();
    await page.getByRole('button', { name: '記録せず閉じる', exact: true }).click();
    await start('b'); await page.clock.setFixedTime(at(12, 3)); await end('b', 'partial', '二枚目の一言');
    equal(await page.locator('.now-done [data-record-id]').evaluateAll(els => els.map(el => el.dataset.recordId)), ['a', 'b'], '連続2件は別の記録ID');
    ok((await page.locator('[data-record-id="a"]').textContent()).includes('入力を保持'), '1枚目を2枚目で上書きしない');
    await page.reload(); await page.locator('[data-record-id="b"]').waitFor();
    equal(await page.locator('.now-done [data-record-id]').count(), 2, '保存・再読込後も2枚');
    equal((await stored()).declarations.length, 2, '保存・再読込後も報告履歴');
    const beforeDay = (await live()).blocks.map(b => [b.id, b.date, b.actualStartAt, b.actualEndAt, b.comment]);
    await page.clock.setFixedTime(at(0, 1, 0, 30));
    await page.evaluate(async () => (await import('/src/features/today.js')).updateTodayTick());
    await page.locator('.now-done details [data-record-id="b"]').waitFor({ state: 'attached' });
    equal((await live()).blocks.map(b => [b.id, b.date, b.actualStartAt, b.actualEndAt, b.comment]), beforeDay, '翌日の再描画で前日の実績を保持');
    await page.reload(); await page.locator('.now-done details').waitFor();
    equal((await live()).blocks.map(b => [b.id, b.date, b.actualStartAt, b.actualEndAt, b.comment]), beforeDay, '翌朝の再読込で前日の実績を保持');
    await page.clock.setFixedTime(at(12, 3));
    await seedDisplayBlocks([block('broken-running', { actualStartAt: 'broken' })]);
    const brokenElapsed = page.locator('[data-elapsed-id="broken-running"]');
    equal(await brokenElapsed.textContent(), '--:--', '壊れた開始日時は経過不明');
    await brokenElapsed.evaluate(el => {
      window.brokenElapsedMutations = 0;
      new MutationObserver(records => { window.brokenElapsedMutations += records.length; })
        .observe(el, { childList: true, characterData: true, subtree: true });
    });
    for (const seconds of [1, 2, 3]) {
      await page.clock.setFixedTime(at(12, 3, seconds)); await tick();
    }
    equal(await brokenElapsed.textContent(), '--:--', '3秒後も経過不明');
    equal(await page.evaluate(() => window.brokenElapsedMutations), 0, '壊れた開始日時はtickでDOMを書き換えない');
    ok(!/NaN|1970/.test(await page.locator('.now-view').textContent()), '壊れた開始日時でNaN・1970を出さない');
    const incompleteRecords = [
      block('broken-record', { actualStartAt: 'broken', actualEndAt: 'broken' }),
      block('broken-start', { actualStartAt: 'broken', actualEndAt: `${day}T11:00:00` }),
      block('broken-end', { actualStartAt: `${day}T10:00:00`, actualEndAt: 'broken' }),
      block('completed-start', { completed: true, actualStartAt: `${day}T10:00:00`, comment: '完了の一言' }),
      block('completed-empty', { completed: true, comment: '時刻なしの一言' }),
      block('completed-past', { date: '2026-09-28', completed: true, actualStartAt: '2026-09-28T09:00:00', comment: '過去の一言' })
    ];
    for (const invalid of ['2026-09-29T99:99', '2026-00-29T10:00', '2026-13-29T10:00',
      '2026-09-00T10:00', '2026-09-32T10:00', '2026-09-29T24:00', '2026-09-29T10:60']) {
      await seedDisplayBlocks([block('range-start', { completed: true, actualStartAt: invalid }),
        block('range-end', { actualStartAt: `${day}T10:00:00`, actualEndAt: invalid })]);
      equal(await page.locator('[data-record-id="range-start"] time').textContent(), '時刻不明', `${invalid}: 範囲外の開始は時刻不明`);
      equal(await page.locator('[data-record-id="range-end"] time').textContent(), '時刻不明', `${invalid}: 範囲外の終了は時刻不明`);
    }
    await seedDisplayBlocks(incompleteRecords);
    const recordSnapshot = (await live()).blocks;
    for (const id of ['broken-record', 'broken-start', 'broken-end', 'completed-empty']) {
      equal(await page.locator(`[data-record-id="${id}"] time`).textContent(), '時刻不明', `${id}: 記録は時刻不明`);
    }
    equal(await page.locator('[data-record-id="completed-start"] time').textContent(), '10:00〜', '終了なしの完了記録は開始のみ表示');
    for (const id of ['completed-start', 'completed-empty']) {
      equal(await page.locator(`.now-done > [data-record-id="${id}"]`).count(), 1, `${id}: 今日できたに1枚`);
      equal(await page.locator(`[data-action="now-start"][data-id="${id}"], [data-running-id="${id}"]`).count(), 0, `${id}: 開始候補と実行中に出さない`);
      equal(await page.locator(`[data-record-id="${id}"] .now-comment`).textContent(), incompleteRecords.find(b => b.id === id).comment, `${id}: commentを表示`);
    }
    equal(await page.locator('[data-record-id="completed-past"]').count(), 1, '過去の終了なし完了記録は重複しない');
    equal(await page.locator('.now-done details [data-record-id="completed-past"] time').textContent(), '09:00〜', '過去の終了なし完了記録は履歴へ');
    equal(await page.locator('[data-record-id="completed-past"] .now-comment').textContent(), '過去の一言', '履歴のcommentを表示');
    await tick();
    equal((await live()).blocks, recordSnapshot, '不正日時と終了なし記録の表示はデータを変更しない');
    ok(!/NaN|1970/.test(await page.locator('.now-done').textContent()), '不正日時の記録でNaN・1970を出さない');
    const pastRecords = Array.from({ length: 35 }, (_, i) => {
      const date = `2026-08-${String(Math.floor(i / 2) + 1).padStart(2, '0')}`;
      return block(`history-${i}`, { date, completed: true, actualStartAt: `${date}T${i % 2 ? '10' : '09'}:00:00` });
    });
    const historyNotice = 'ほかの記録は実行タブの実績で見られます';
    await seedDisplayBlocks(pastRecords);
    const historyCards = page.locator('.now-done details [data-record-id]');
    equal(await historyCards.count(), 30, '過去35件の履歴は直近30枚まで');
    equal(await page.locator('.now-done details > div > small').first().textContent(), '2026-08-18', '履歴の先頭は最新の日付');
    equal(await historyCards.evaluateAll(els => els.map(el => el.dataset.recordId)),
      pastRecords.slice().reverse().slice(0, 30).map(b => b.id), '履歴は日付降順・同日は開始時刻降順');
    equal(await page.locator('.now-done details > p').allTextContents(), [historyNotice], '30件超の履歴の末尾に案内を1行表示');
    equal((await live()).blocks, pastRecords, '履歴の並べ替えと件数制限は元データを変更しない');
    await seedDisplayBlocks(pastRecords.slice(0, 2));
    equal(await historyCards.count(), 2, '過去2件の履歴は2枚');
    equal(await page.getByText(historyNotice, { exact: true }).count(), 0, '過去2件では案内なし');
    const fixtures = [block('pending', { title: 'とても長い作業名'.repeat(12) }), block('running', { actualStartAt: `${day}T12:00:00` }),
      block('equal', { actualStartAt: `${day}T10:00:00`, actualEndAt: `${day}T10:00:00`, completed: true, comment: '回復・休息' }),
      block('reverse', { actualStartAt: `${day}T23:59:00`, actualEndAt: `${day}T23:58:00`, completed: true })];
    await seed(fixtures, 'now');
    ok((await page.locator('[data-record-id="equal"]').textContent()).includes('10:00〜10:01'), '終了=開始は表示のみ1分');
    ok((await page.locator('[data-record-id="reverse"]').textContent()).includes('23:59〜2026-09-30 00:00'), '終了<開始は翌日の表示まで1分補正');
    equal((await live()).blocks.find(b => b.id === 'reverse').actualEndAt, `${day}T23:58:00`, '補正は保存値を変更しない');
    for (const theme of ['light', 'dark']) {
      await seed(fixtures, 'now', { theme });
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 1000 });
        const layout = await page.locator('.now-view').evaluate(root => ({
          overflow: root.scrollWidth > root.clientWidth || document.documentElement.scrollWidth > document.documentElement.clientWidth,
          buttons: [...root.querySelectorAll('button')].every(el => el.getBoundingClientRect().height >= 44),
          columns: getComputedStyle(root).gridTemplateColumns.split(' ').length
        }));
        equal(layout.overflow, false, `${theme}/${width}: 横はみ出しなし`);
        ok(layout.buttons, `${theme}/${width}: ボタン44px以上`);
        ok(await page.locator('[data-field="now-declaration"]').evaluateAll(els => els.length > 0 && els.every(el =>
          parseFloat(getComputedStyle(el).fontSize) >= 16 && el.getBoundingClientRect().height >= 44)), `${theme}/${width}: 宣言欄16px以上・高さ44px以上`);
        ok(await page.locator('[data-action="now-estimate"]').evaluateAll(els => els.length === 3 && els.every(el =>
          el.getBoundingClientRect().width >= 44 && el.getBoundingClientRect().height >= 44)), `${theme}/${width}: 見積3ボタンは縦横44px以上`);
        equal(layout.columns, width === 1280 ? 3 : 1, `${theme}/${width}: 列数`);
        ok(await page.locator('.now-candidates button').evaluate(el =>
          el.getBoundingClientRect().width >= el.parentElement.getBoundingClientRect().width * .9), `${theme}/${width}: 候補1件の幅は親の90%以上`);
        if (process.env.NOW_VIEW_REPORT_DIR) {
          fs.mkdirSync(process.env.NOW_VIEW_REPORT_DIR, { recursive: true });
          await page.screenshot({ path: path.join(process.env.NOW_VIEW_REPORT_DIR, `${width}-${theme}.png`), fullPage: true });
        }
      }
    }
    await seed([block('wide-a'), block('wide-b')], 'now');
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      ok(await page.locator('.now-candidates button').evaluateAll(els => els.every(el =>
        el.getBoundingClientRect().width >= el.parentElement.getBoundingClientRect().width * .9 && el.getBoundingClientRect().height >= 44)), `${width}: 候補2件も列幅いっぱいで44px以上`);
    }
    await seed(fixtures, 'now', { towerMotion: 'off' });
    ok(await allMotionStopped(), 'motion=off: 本体/全子孫/疑似要素のanimationとtransition停止');
    await seed(fixtures, 'now', { towerMotion: 'normal' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    ok(await allMotionStopped(), 'OS reduce-motion: 疑似要素も停止');
    // 発注50 / G4b: 集計済みの実績を週のタワー・輪へ投影する。
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 375, height: 900 });
    await page.clock.setFixedTime(at(12, 0));
    const ended = (id, date, start, end) => block(id, { date, completed: true,
      actualStartAt: `${date}T${start}`, actualEndAt: `${date}T${end}` });
    const weekFixtures = [ended('monday', '2026-09-28', '09:00:00', '10:05:00'),
      ended('today-69', day, '09:00:00', '10:09:00'), ended('minimum', day, '11:00:00', '11:00:00'),
      ended('last-sunday', '2026-09-27', '09:00:00', '12:00:00')];
    const bars = page.locator('.now-tower');
    const ring = page.locator('.now-ring-frame');
    const progress = () => ring.locator('circle').evaluate(el => Number(el.getAttribute('stroke-dasharray').split(/\s+/)[0]));
    const redraw = () => page.evaluate(async () => {
      document.querySelector('.now-view').outerHTML = (await import('/src/features/now-view.js')).renderNowView();
    });
    await seedDisplayBlocks(weekFixtures);
    equal(await bars.evaluateAll(els => els.map(el => el.dataset.date)),
      ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'], 'G4b: 暦週は月〜日の7本');
    equal(await bars.evaluateAll(els => els.map(el => el.getAttribute('aria-label'))),
      ['月曜 1時間05分', '火曜 1時間10分', '水曜 0時間00分', '木曜 0時間00分', '金曜 0時間00分', '土曜 0時間00分', '日曜 0時間00分'], 'G4b: 各日の実績合計と各件最低1分・先週除外');
    equal(await bars.evaluateAll(els => els.map(el => [el.dataset.today, el.dataset.future])),
      [['0', '0'], ['1', '0'], ['0', '1'], ['0', '1'], ['0', '1'], ['0', '1'], ['0', '1']], 'G4b: 今日と未来の属性');
    equal(await page.locator('.now-tower-day > span').allTextContents(), ['月', '火', '水', '木', '金', '土', '日'], 'G4b: 本の下に曜日');
    equal(await ring.getAttribute('aria-label'), '輪 2周と 10分', 'G4b: 70分は2周と10分');
    equal(await ring.locator('strong').textContent(), '2', 'G4b: 中央は周数');
    equal(await ring.locator('circle').count(), 1, 'G4b: SVGの円は1つ');
    ok(Math.abs(await progress() - 1 / 3) < 1e-9, 'G4b: 70分のdasharrayは1/3周');
    equal(await page.locator('.now-yesterday').textContent(), '昨日 1時間05分', 'G4b: 昨日の実績を常に表示');
    equal(await page.locator('.now-beaten').getAttribute('data-beaten'), '1', 'G4b: 昨日超えの初回描画');
    await redraw();
    equal(await page.locator('.now-beaten').getAttribute('data-beaten'), '0', 'G4b: 同日の再描画はきらめきを繰り返さない');
    const geometry = await page.locator('.now-tower-frame').evaluate(frame => {
      const rect = frame.getBoundingClientRect();
      return [...frame.querySelectorAll('.now-tower')].map(el => {
        const bar = el.getBoundingClientRect();
        return bar.left >= rect.left && bar.right <= rect.right && bar.width >= 24;
      });
    });
    equal(geometry, Array(7).fill(true), 'G4b: 375pxで7本が枠内・最小幅24px');
    equal(await page.locator('.now-tower-line').allTextContents(), ['2h'], 'G4b: 2時間未満も基準線1本');
    await seedDisplayBlocks([]);
    equal(await page.locator('.now-tower-line').allTextContents(), ['2h'], 'G4b: 実績0も2hの線');
    equal(await page.locator('.now-yesterday').textContent(), '昨日 0時間00分', 'G4b: 昨日0分も表示');
    equal(await page.locator('.now-beaten:visible').count(), 0, 'G4b: 今日と昨日が0なら昨日超えなし');
    await seedDisplayBlocks([ended('long', day, '09:00:00', '11:30:00')]);
    equal(await page.locator('.now-tower-line').allTextContents(), ['2h', '4h'], 'G4b: 天井150分なら切り上げ2本');
    equal(await bars.locator('[data-today="1"]').count(), 0, 'G4b: 本の内部に本を重ねない');
    equal(await page.locator('.now-tower[data-today="1"]').evaluate(el => el.style.height), '100%', 'G4b: 最大日の本は天井まで');
    ok(await page.locator('.now-tower-line').evaluateAll(els => els.every(el => {
      const frame = el.closest('.now-tower-frame').getBoundingClientRect(), line = el.getBoundingClientRect();
      return line.top >= frame.top && line.bottom <= frame.bottom;
    })), 'G4b: 切り上げた4hの基準線も枠内に見える');
    await page.clock.setFixedTime(at(12, 0, 0, 28));
    await seedDisplayBlocks([ended('sunday-yesterday', '2026-09-27', '09:00:00', '10:05:00'),
      ended('monday-today', '2026-09-28', '09:00:00', '09:30:00')]);
    equal(await bars.evaluateAll(els => els.map(el => el.getAttribute('aria-label'))),
      ['月曜 0時間30分', '火曜 0時間00分', '水曜 0時間00分', '木曜 0時間00分', '金曜 0時間00分', '土曜 0時間00分', '日曜 0時間00分'], 'G4b: 月曜日の昨日は前週日曜で今週の本に混ざらない');
    equal(await page.locator('.now-yesterday').textContent(), '昨日 1時間05分', 'G4b: 週外の昨日も比較には含める');
    equal(await page.locator('.now-beaten:visible').count(), 0, 'G4b: 今日が昨日未満なら表示なし');
    await page.clock.setFixedTime(at(12, 0));
    await seedDisplayBlocks([ended('yesterday-minute', '2026-09-28', '09:00:00', '09:01:00'),
      block('grow', { actualStartAt: `${day}T11:59:00` }), block('typing')]);
    equal(await page.locator('.now-beaten:visible').count(), 0, 'G4b: 今日と昨日が同じなら表示なし');
    const todayBar = page.locator('.now-tower[data-today="1"]');
    const barNode = await todayBar.elementHandle(), circleNode = await ring.locator('circle').elementHandle();
    const frameNode = await page.locator('.now-tower-frame').elementHandle();
    const beforeGrow = { height: await todayBar.evaluate(el => parseFloat(el.style.height)), progress: await progress() };
    const inputDraft = page.locator('[data-field="now-declaration"][data-id="typing"]');
    await inputDraft.fill('入力中の宣言');
    await inputDraft.dispatchEvent('compositionstart');
    await page.clock.setFixedTime(at(12, 0, 10)); await tick();
    ok(await todayBar.evaluate(el => parseFloat(el.style.height)) > beforeGrow.height, 'G4b: 走行中の本がtickで伸びる');
    ok(await progress() > beforeGrow.progress, 'G4b: 走行中の輪がtickで進む');
    ok(await barNode.evaluate(el => el === document.querySelector('.now-tower[data-today="1"]')), 'G4b: 本のDOMを保持');
    ok(await circleNode.evaluate(el => el === document.querySelector('.now-ring-frame circle')), 'G4b: 輪のDOMを保持');
    ok(await frameNode.evaluate(el => el === document.querySelector('.now-tower-frame')), 'G4b: 枠のDOMを保持');
    equal(await todayBar.getAttribute('aria-label'), '火曜 0時間01分', 'G4b: tick後の実績aria-label');
    equal(await page.locator('.now-beaten').getAttribute('data-beaten'), '1', 'G4b: tickで昨日を超えた瞬間のきらめき');
    equal(await inputDraft.inputValue(), '入力中の宣言', 'G4b: 集計tickでも入力中の宣言を保持');
    ok(await inputDraft.evaluate(el => el === document.activeElement), 'G4b: 集計tickでもIMEのフォーカスを保持');
    await inputDraft.dispatchEvent('compositionend', { data: '入力中の宣言' });
    await tick();
    equal(await page.locator('.now-beaten').getAttribute('data-beaten'), '0', 'G4b: 後続tickで演出を再発火しない');
    const pausedStack = await page.locator('.now-stack').innerHTML();
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.setFixedTime(at(12, 30)); await tick();
    equal(await page.locator('.now-stack').innerHTML(), pausedStack, 'G4b: hidden中は積み上げのDOMを更新しない');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    equal(await ring.getAttribute('aria-label'), '輪 1周と 1分', 'G4b: 復帰すると周数と分が追随');
    await page.locator('.now-view').evaluate(el => { el.dataset.paused = '1'; });
    const pausedOnly = await page.locator('.now-stack').innerHTML();
    await page.clock.setFixedTime(at(13, 0)); await tick();
    equal(await page.locator('.now-stack').innerHTML(), pausedOnly, 'G4b: data-pausedだけでもtick停止');
    await seedDisplayBlocks(weekFixtures);
    await page.locator('.now-stack').evaluate(el => {
      window.stackMutations = 0;
      new MutationObserver(records => { window.stackMutations += records.length; })
        .observe(el, { childList: true, attributes: true, characterData: true, subtree: true });
    });
    await page.clock.setFixedTime(at(13, 1)); await tick();
    equal(await page.evaluate(() => window.stackMutations), 0, 'G4b: 走行中BlockなしならDOM更新なし');
    await page.clock.setFixedTime(at(23, 59));
    await seedDisplayBlocks([ended('yesterday-cross', '2026-09-28', '09:00:00', '09:01:00'),
      block('cross-midnight', { actualStartAt: `${day}T23:57:00` })]);
    equal(await page.locator('.now-beaten').getAttribute('data-beaten'), '1', 'G4b: 日跨ぎ前に当日の昨日超え');
    await page.clock.setFixedTime(at(0, 1, 0, 30));
    await page.evaluate(async () => (await import('/src/features/today.js')).updateTodayTick());
    equal(await page.locator('.now-tower[data-today="1"]').getAttribute('data-date'), '2026-09-30', 'G4b: 日跨ぎで今日の本を更新');
    equal(await page.locator('.now-tower[data-date="2026-09-29"]').getAttribute('aria-label'), '火曜 0時間04分', 'G4b: 日跨ぎの走行中は開始日の本に帰属');
    equal(await ring.getAttribute('aria-label'), '輪 0周と 0分', 'G4b: 日跨ぎの走行中を今日の輪に混ぜない');
    await page.evaluate(async () => {
      (await import('/src/state/store.js')).state.blocks.push({ id: 'new-day', date: '2026-09-30', completed: true,
        actualStartAt: '2026-09-30T00:00:00', actualEndAt: '2026-09-30T00:05:00' });
    });
    await redraw();
    equal(await page.locator('.now-beaten').getAttribute('data-beaten'), '1', 'G4b: 翌日の昨日超えは改めて1回');
    await redraw();
    equal(await page.locator('.now-beaten').getAttribute('data-beaten'), '0', 'G4b: 翌日も再描画では繰り返さない');
    await page.clock.setFixedTime(at(12, 0));
    for (const motion of ['calm', 'off', 'normal']) {
      await seed(weekFixtures, 'now', { towerMotion: motion });
      if (motion === 'normal') await page.emulateMedia({ reducedMotion: 'reduce' });
      ok(await allMotionStopped(), `G4b: ${motion}は昨日超えの演出も抑制`);
    }
    equal(errors, [], 'ブラウザ例外なし');
    console.log(`now-view: ${assertions} assertions passed`);
  } finally {
    await browser.close(); server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
