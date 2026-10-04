// v419: WBS completion records actual work; browser storage and daily report regression.
const assert = require('node:assert/strict');
const { chromium, launchOptions, startServer, randomPort, STATE_KEY, passGithubGate } = require('./helpers');
const DAY = '2026-10-01', NEXT = '2026-10-02', PREV = '2026-09-30';
let assertions = 0;
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; console.log('PASS', message); };
const ok = (value, message) => { assert.ok(value, message); assertions++; console.log('PASS', message); };
const task = estimateMin => ({ id: 'task', projectId: 'project', parentTaskId: '', title: '完了実績の検証作業',
  category: '作業', status: 'todo', deleted: false, estimateMin, progressNum: 0, progressDen: 10 });
const block = (id, extra = {}) => ({ id, taskId: 'task', title: '完了実績の検証作業', date: DAY,
  category: '作業', estimateMin: 50, plannedStartAt: `${DAY}T11:00:00`, plannedEndAt: `${DAY}T11:50:00`,
  actualStartAt: '', actualEndAt: '', completed: false, deleted: false, ...extra });

(async () => {
  let server, browser;
  try {
    const port = randomPort(); server = startServer(port);
    browser = await chromium.launch(launchOptions());
    const page = await browser.newPage({ serviceWorkers: 'block', timezoneId: 'Asia/Tokyo', viewport: { width: 375, height: 900 } });
    const errors = [], dialogs = [];
    let acceptDialog = false;
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await (acceptDialog ? dialog.accept() : dialog.dismiss()); });
    await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    await page.clock.setFixedTime(new Date(2026, 9, 1, 10, 0));
    await page.goto(`http://localhost:${port}/`);
    await page.locator('[data-action="gate-continue"]').waitFor();
    await passGithubGate(page);
    const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    async function openTask() {
      await page.locator('[data-action="wbs-select-project"][data-id="project"]').first().click();
      await page.locator('[data-action="toggle-task"][data-id="task"]').first().waitFor();
    }
    async function seed(estimateMin, blocks = [], hour = 10, minute = 0, second = 0, habits = {}) {
      await page.clock.setFixedTime(new Date(2026, 9, 1, hour, minute, second));
      await page.evaluate(({ key, day, task, blocks, habits }) => {
        const state = JSON.parse(localStorage.getItem(key));
        Object.assign(state, { currentView: 'wbs', selectedDate: day, tasks: [task], blocks,
          projects: [{ id: 'project', title: '検証Project', kind: 'project', status: 'active', deleted: false }],
          recurrences: [], habitStreaks: {}, singleSchedules: [], declarations: [], reports: {}, journals: { [day]: '検証本文' }, ...habits });
        Object.assign(state.settings, { lastOpenedDate: day, autoSync: false, wbsHideCompleted: false });
        state.settings.github.autoSave = false; state.pomodoro.running = false;
        localStorage.setItem(key, JSON.stringify(state));
      }, { key: STATE_KEY, day: DAY, task: task(estimateMin), blocks, habits });
      await page.reload(); await openTask(); dialogs.length = 0;
    }
    async function toggle(status = 'completed') {
      await page.locator('[data-action="toggle-task"][data-id="task"]').first().click();
      await page.waitForFunction(({ key, status }) => JSON.parse(localStorage.getItem(key)).tasks.find(t => t.id === 'task').status === status,
        { key: STATE_KEY, status }).catch(async error => {
        console.error('Task completion diagnostic', errors, dialogs, await page.evaluate(key => ({
          stored: JSON.parse(localStorage.getItem(key)), text: document.body.innerText.slice(-1800)
        }), STATE_KEY));
        throw error;
      });
      return stored();
    }
    async function report() {
      await page.evaluate(() => {
        const button = document.createElement('button'); button.dataset.action = 'generate-report';
        button.id = 'complete-actual-report'; document.querySelector('#app').append(button);
      });
      await page.locator('#complete-actual-report').click();
      const meditationGate = page.getByRole('button', { name: 'スキップして生成', exact: true });
      if (await meditationGate.isVisible()) await meditationGate.click();
      await page.waitForFunction(({ key, day }) => Boolean(JSON.parse(localStorage.getItem(key)).reports[day]), { key: STATE_KEY, day: DAY }).catch(async error => {
        console.error('Report diagnostic', errors, await page.evaluate(async () => {
          const s = (await import('/src/state/store.js')).state;
          return { selectedDate: s.selectedDate, reports: s.reports, modal: s.modal, text: document.body.innerText.slice(-1800) };
        }));
        throw error;
      });
      await page.locator('#complete-actual-report').evaluateAll(buttons => buttons.forEach(button => button.remove()));
      return (await stored()).reports[DAY];
    }
    const actuals = state => state.blocks.filter(b => !b.deleted && b.taskId === 'task' && b.date === DAY);
    const times = b => [b.actualStartAt, b.actualEndAt, b.completed];
    const headings = report => report.split('\n').filter(line => /^#{1,6} /.test(line));

    // 発注110/B2-67: 完了実績が今日にあれば追加せず、未着手・実行中は従来優先。
    const completed = block('already-done', { completed: true, actualStartAt: `${DAY}T08:00:00`, actualEndAt: `${DAY}T08:25:00` });
    await seed(25, [completed]);
    const doneBefore = (await stored()).blocks;
    let deduplicated = await toggle();
    equal(deduplicated.blocks, doneBefore, 'B2-67: 完了済み実績の時刻・更新印を変えずBlockを増やさない');
    equal([deduplicated.tasks[0].status, deduplicated.tasks[0].progressNum], ['completed', 10], 'B2-67: Taskだけ完了・進捗を保存');
    await toggle('doing'); deduplicated = await toggle();
    equal(deduplicated.blocks, doneBefore, 'B2-67: 解除して再完了しても二重にならない');
    for (const extra of [block('pending'), block('running', { actualStartAt: `${DAY}T09:50:00` })]) {
      await seed(25, [completed, extra]); deduplicated = await toggle();
      equal(deduplicated.blocks.length, 2, 'B2-67: 既存の未完了候補があれば再利用');
      equal(times(deduplicated.blocks.find(b => b.id === extra.id)),
        [extra.actualStartAt || `${DAY}T09:35:00`, `${DAY}T10:00:00`, true], 'B2-67: 未着手・実行中の従来規則を保持');
    }
    for (const extra of [{ date: PREV }, { deleted: true }, { taskId: 'other' }, { actualEndAt: '' }, { actualStartAt: '' }]) {
      await seed(25, [{ ...completed, ...extra }]); deduplicated = await toggle();
      equal(deduplicated.blocks.length, 2, 'B2-67: 別日・削除・別Task・片側実績は重複判定しない');
    }

    await seed(25, [block('report-reference', { completed: true, actualStartAt: `${DAY}T09:35:00`, actualEndAt: `${DAY}T10:00:00` })]);
    const originalHeadings = headings(await report());
    await seed(25);
    let state = await toggle(), actual = actuals(state)[0];
    equal(actuals(state).length, 1, '(a) one Block today');
    equal(times(actual), [`${DAY}T09:35:00`, `${DAY}T10:00:00`, true], '(a) 25-minute actual');
    equal([actual.taskId, actual.title, actual.category, actual.estimateMin], ['task', task(25).title, '作業', 25], '(a) task metadata');
    equal([state.tasks[0].status, state.tasks[0].progressNum], ['completed', 10], '(a) task completion and progress');
    equal(dialogs, [], '(a) no cleanup confirmation without future blocks');
    ok(await page.getByText('完了して実績を記録しました(09:35〜10:00)', { exact: true }).isVisible(), '(a) actual time toast');
    const generated = await report();
    console.log('REPORT_SAMPLE_BEGIN\n' + generated + '\nREPORT_SAMPLE_END');
    ok(generated.includes(`| ${actual.id} | ${DAY} | ${DAY}T09:35:00 | ${DAY}T10:00:00 | 25分 | 完了 |`), '(g) measured actual report row by Block id');
    ok(generated.includes(`| 09:35 | ✅ ${task(25).title} | 作業 |`), '(g) report execution row contains task title');
    equal(headings(generated), originalHeadings, '(g) all report headings unchanged');
    ok(generated.includes('## 8. ジャーナル') && generated.includes('## 9. 明日への接続'), '(g) existing report heading contract');
    const actualId = actual.id;
    await page.reload(); await openTask(); state = await stored();
    equal(actuals(state).length, 1, '(h) one actual after reload');
    equal(times(actuals(state)[0]), times(actual), '(h) actual timestamps persisted');
    equal(state.tasks[0].status, 'completed', '(h) completed task persisted');
    equal(state.reports[DAY], generated, '(h) report persisted');
    equal(await report(), generated, '(h) regenerated report is identical');
    state = await toggle('doing');
    equal([actuals(state)[0].id, ...times(actuals(state)[0])], [actualId, ...times(actual)], '(i) undo retains actual Block');
    equal(state.tasks[0].status, 'doing', '(i) undo restores doing');

    await seed(null); state = await toggle();
    equal(times(actuals(state)[0]), [`${DAY}T09:45:00`, `${DAY}T10:00:00`, true], '(b) no estimate uses 15 minutes');
    equal(actuals(state)[0].estimateMin, 15, '(b) fallback estimate persisted');
    await seed(50); state = await toggle();
    equal(times(actuals(state)[0]), [`${DAY}T09:10:00`, `${DAY}T10:00:00`, true], '(1) 50-minute estimate');

    await seed(25, [block('planned')]); state = await toggle(); actual = actuals(state)[0];
    equal(actuals(state).length, 1, '(c) reuse without extra Block');
    equal([actual.id, ...times(actual)], ['planned', `${DAY}T09:35:00`, `${DAY}T10:00:00`, true], '(c) planned Block receives task estimate actual');
    equal([actual.plannedStartAt, actual.plannedEndAt], [`${DAY}T11:00:00`, `${DAY}T11:50:00`], '(c) original plan retained');
    equal(dialogs, [], '(c) today excluded from cleanup confirmation');

    const previousStreaks = { habit: { logs: { [PREV]: { doneAt: `${PREV}T10:00:00` } } } };
    for (const kind of ['daily', 'weekdays']) {
      const habits = { recurrences: [{ id: 'habit', kind, title: task(25).title, taskId: 'task',
        category: '作業', anchorDate: PREV, startTime: '11:00', endTime: '11:50', streakSince: PREV, deleted: false }],
        habitStreaks: previousStreaks };
      const recurringBlock = block('habit-block', { recurrenceGroupId: 'habit' });
      await seed(25, [recurringBlock], 10, 0, 0, habits);
      await page.evaluate(() => {
        const button = document.createElement('button'); button.dataset.action = 'toggle-block';
        button.dataset.id = 'habit-block'; button.id = 'streak-reference'; document.querySelector('#app').append(button);
      });
      await page.locator('#streak-reference').click();
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).blocks.find(b => b.id === 'habit-block').completed, STATE_KEY);
      const normalStreaks = (await stored()).habitStreaks;
      equal(normalStreaks, { habit: { logs: { ...previousStreaks.habit.logs, [DAY]: { doneAt: `${DAY}T10:00:00` } },
        updatedAt: `${DAY}T10:00:01` } },
        `habit (${kind}) normal Block completion records today and retains previous log`);
      await seed(25, [recurringBlock], 10, 0, 0, habits);
      state = await toggle();
      // 監督者裁定 C-3(2026-10-01): 通常経路は daily-operation の記録スタンプ(updatedAt)が付くが、同期の habitStreaks は updatedAt を使わない比較(fail-close)なので、記録(logs)の一致だけを確かめる。
      const logsOnly = streaks => Object.fromEntries(Object.entries(streaks || {}).map(([k, v]) => [k, v.logs]));
      equal(logsOnly(state.habitStreaks), logsOnly(normalStreaks), `habit (${kind}) task completion records the same logs as normal Block completion`);
    }
    await seed(25, [block('non-recurring')], 10, 0, 0, { habitStreaks: previousStreaks });
    const unchangedStreaks = (await stored()).habitStreaks;
    state = await toggle();
    equal(state.habitStreaks, unchangedStreaks, 'non-recurring Block task completion preserves habit streaks');

    await seed(25, [block('planned'), block('running', { actualStartAt: `${DAY}T09:50:00` })]); state = await toggle();
    equal(state.blocks.length, 2, '(d) no extra Block with running candidate');
    equal(times(state.blocks.find(b => b.id === 'running')), [`${DAY}T09:50:00`, `${DAY}T10:00:00`, true], '(d) running start retained and end recorded');
    equal(times(state.blocks.find(b => b.id === 'planned')), ['', '', false], '(d) running takes priority over unstarted');
    equal(dialogs, [], '(d) remaining today plan does not trigger cleanup');

    for (const accepted of [true, false]) {
      await seed(25, [block('planned'), block('tomorrow', { date: NEXT }),
        block('future-running', { date: NEXT, actualStartAt: `${NEXT}T09:00:00` }),
        block('future-done', { date: NEXT, completed: true }), block('past', { date: PREV })]);
      acceptDialog = accepted; state = await toggle();
      equal(dialogs.length, 1, `(e) cleanup confirmation (${accepted})`);
      ok(dialogs[0].includes('明日以降の未着手Block 1件'), `(e) only future unstarted candidate (${accepted})`);
      equal(state.blocks.find(b => b.id === 'tomorrow').deleted, accepted, `(e) accept deletes / dismiss retains (${accepted})`);
      equal(state.blocks.filter(b => b.deleted).map(b => b.id), accepted ? ['tomorrow'] : [], `(e) other Blocks retained (${accepted})`);
      equal(times(state.blocks.find(b => b.id === 'planned')), [`${DAY}T09:35:00`, `${DAY}T10:00:00`, true], `(e) today's actual retained (${accepted})`);
    }
    acceptDialog = false;
    await seed(15, [], 0, 5); state = await toggle(); actual = actuals(state)[0];
    equal([actual.date, ...times(actual)], [DAY, `${PREV}T23:50:00`, `${DAY}T00:05:00`, true], '(f) midnight crossing belongs to today');
    ok(actual.actualEndAt > actual.actualStartAt, '(f) end remains after start');
    ok((await report()).includes(`| ${actual.id} | ${DAY} | ${PREV}T23:50:00 | ${DAY}T00:05:00 | 15分 | 完了 |`), '(f) overnight actual reports 15 minutes');
    await seed(25, [], 10, 0, 37); state = await toggle();
    equal(times(actuals(state)[0]), [`${DAY}T09:35:37`, `${DAY}T10:00:37`, true], 'seconds preserved');
    equal(errors, [], 'no browser errors');
    console.log(`PASS task-complete-actual: ${assertions} assertions`);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
