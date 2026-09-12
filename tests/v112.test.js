// v112 検証: 「タスクシュート画面の未完了タスク一覧で、当日のブロックに登録済みのタスクでも
// 未完了なら一覧に表示したままにする」(K依頼、2026-07-16)。
//
// 調査結果(重要): renderOpenTasks() の現物を読んだ結果、当日Block登録済みタスクを一覧から
// 除外するロジックは**存在しなかった**(v19時点のコメント「今日に既に Block 化されていても
// 表示し続ける(1日に複数回追加することもあるため)」の通り、既に要望どおりの挙動)。
// 「本日N件 Block 追加済み」バッジ(blockCountByTaskId)も既存。v107.test.jsの(a)(b)でも
// 同等の挙動(Block完了チェックのみでは一覧に残る/タスク完了で消える)を別経路(事前seedした
// Blockのtoggle)で検証済みだった。
//
// 一方、ホームタブの「未完了タスク」パネル(homeBacklog())には、当日Block登録済みタスクの
// 再追加ボタンをdisabledにして「追加済み」表示に固定する実装が別途存在した。Kの体感上の
// 「一覧から消える/追加できない」という不満はこちらが原因だった可能性が高いとの指摘を受け、
// homeBacklog()のdisabled化を撤去し、renderOpenTasksと同じ思想(未完了である限り再追加可能、
// 当日登録済みは軽いバッジで示すだけ)に揃えた。app.js/sw.jsに変更が入るためSW CACHE_NAMEを
// v112へ+1した。
//
// (a) 当日ブロック未登録のタスクは一覧に出る/「今日へ追加」クリックでBlockが1件作られ、
//     タスクは一覧に残ったまま「本日 1 件 Block 追加済み」バッジが出る
// (b) 同じタスクへもう一度「今日へ追加」をクリックすると2件目のBlockが作られ(同一taskId、
//     別Block id)、バッジが「本日 2 件」に更新される
// (c) そのタスクを完了にすると一覧から消える(v107回帰の維持確認)
// (d) 期日なしTaskは表示されない/表示は期日昇順(v97/v107回帰の維持確認)
// (e) 当日Block登録済みタスクが混在しても期日昇順の並びは崩れない
// (f) ホームタブ「未完了タスク」パネル: 当日登録済み・未完了のタスクでも「＋今日に追加」ボタンが
//     disabledにならず押せる状態を維持する(v112でdisabled解除)
// (g) 同じくホームタブで、もう一度クリックすると2件目のBlockが作られ、バッジが更新される
const { browseYesterdayForPlacement, assertUntimedTodayPlacement, chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, dismissBodyScanIfOpen } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  // v108以降と同じ流儀: 実時刻依存フレーク対策のため実行時の「今日」10:00に固定する
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  const addDaysStr = (n) => {
    const d = new Date(now0);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  function wbsTask(id, title, extra = {}) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: TODAY,
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
      progressNum: 0, progressDen: 10, doneCriteria: "", firstStep: "", ...extra
    };
  }
  const testProject = () => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false, showProgress: false
  });

  async function seed({ tasks = [], blocks = [], projects = [], view = "tasks" } = {}) {
    await page.evaluate(({ KEY, tasks, blocks, projects, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = tasks;
      s.blocks = blocks;
      s.projects = projects;
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, tasks, blocks, projects, TODAY, view });
    await page.reload();
    await page.waitForTimeout(400);
    if(view==='wbs') await page.locator('[data-action="wbs-select-project"][data-id="test-proj"]').click();
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  function openItem(taskId) {
    return page.locator(`[data-work-list="wbs-tasks-test-proj"] [data-work-key="task:${taskId}"]`);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    const nav = view => page.locator(`.sidebar [data-action="nav"][data-view="${view}"]`).click();
    const placed = async id => (await stateNow()).blocks.filter(b => !b.deleted && b.taskId === id && b.date === TODAY);
    const open = async id => {
      await page.locator(`.wbs-projects :is([data-action="task-today"], [data-action="placement-add-today"])[data-id="${id}"]`).click();
      await page.locator('#modalRoot').evaluate(async root => { await Promise.all(root.getAnimations({subtree:true}).map(a => a.finished)); });
    };
    // v374: normalizeState(app.js v28)は「その他」Project直下の受け皿Task 1件を自動追加し、全件一覧はそれも表示する。
    //       順序・欠落の保証は投入fixture側で判定し、受け皿は「その他」タイトルの1件だけを除外する(他の追加行は許さない)。
    const receptacleIds = async () => (await stateNow()).tasks.filter(t => t.title === 'その他' && !t.deleted).map(t => t.id);
    const taskIds = async () => {
      const ids = await page.locator('[data-work-list="wbs-tasks-test-proj"] [data-work-key^="task:"]').evaluateAll(els => els.map(el => el.dataset.workKey.slice(5)));
      const receptacle = await receptacleIds();
      if (receptacle.length > 1) check('受け皿「その他」Taskは高々1件', false, JSON.stringify(receptacle));
      return ids.filter(id => !receptacle.includes(id));
    };
    console.log('[1] 未配置TaskはWBSに残り、時刻を確認するまでBlockを作らない');
    await seed({tasks:[wbsTask('task-A','複数回今日へ追加検証Task')],projects:[testProject()],view:'wbs'});
    check('初期状態で一覧に出る',await openItem('task-A').count()===1);
    check('初期状態は当日Block未登録', (await placed('task-A')).length===0);
    const placementBrowsingDate = await browseYesterdayForPlacement(page);
    await open('task-A');
    await assertUntimedTodayPlacement(page, { key: KEY, taskId: 'task-A', today: TODAY, browsingDate: placementBrowsingDate, confirm: false });
    check('確認画面を開くだけでは0件', (await placed('task-A')).length === 0);
    await page.locator('.modal-footer [data-action="modal-close"]').click();
    check('取消はモーダルを閉じ未保存を保つ', (await stateNow()).modal === null && (await placed('task-A')).length === 0);
    check('取消しても閲覧日を保持', (await stateNow()).selectedDate === placementBrowsingDate);
    await open('task-A');
    await assertUntimedTodayPlacement(page, { key: KEY, taskId: 'task-A', today: TODAY, browsingDate: placementBrowsingDate });
    const first=(await placed('task-A'));
    check('Blockが1件作られる',first.length===1,JSON.stringify(first));
    check('同じTask・今日・両時刻空を保存',first[0]?.taskId==='task-A' && first[0]?.date===TODAY && first[0]?.plannedStartAt==='' && first[0]?.plannedEndAt==='');
    check('新規追加後は確認を閉じWBSへ戻る', (await stateNow()).modal === null && await openItem('task-A').count() === 1);
    check('1回目配置後も元WBSにTaskが残る',await openItem('task-A').count()===1);
    console.log('[2] 同日同Taskへの再訪は既存予定へ進み、時刻編集しても件数とidを保持');
    await open('task-A');
    check('再訪では同じBlock idで1件のまま', (await placed('task-A')).length===1 && await page.locator('[data-action="placement-edit"]').getAttribute('data-id')===first[0].id);
    check('再訪結果は重複追加していないと表示', (await page.locator('.modal-card').textContent()).includes('重複追加はしていません'));
    check('再訪時に新規配置フォームは出さない',await page.locator('#placement-time').count()===0);
    await page.locator('[data-action="placement-edit"]').click();
    await page.locator('[data-modal-field="plannedStartAt"]').fill(`${TODAY}T11:45`);
    await page.locator('[data-action="modal-save"]').click();
    const revised=await placed('task-A');
    console.log('fixV384d L138 observation', JSON.stringify({ modal: await page.evaluate(async () => (await import('/src/state/store.js')).state.modal), blocks: revised, modalText: await page.locator('#modalRoot').innerText() }));
    check('時刻変更後も同じBlockが1件',revised.length===1 && revised[0].id===first[0].id && revised[0].plannedStartAt===`${TODAY}T11:45:00`);
    await nav('wbs');
    check('再訪・編集後もTaskを保持',await openItem('task-A').count()===1 && (await stateNow()).tasks.find(t=>t.id==='task-A')?.status!=='completed');
    await nav('exec');
    check('実行の予定一覧に同じBlockが1件描画される',await page.locator(`[data-work-list="exec"] [data-work-key="block:${first[0].id}"]`).count()===1);
    console.log('[3] Task完了は保存され、未完了filterから消え、全件には残る');
    await page.locator(`[data-work-list="exec"] [data-action="block-row-toggle"][data-id="${first[0].id}"]`).click();
    await page.locator(`[data-work-list="exec"] [data-action="edit-block"][data-id="${first[0].id}"]`).click();
    await page.locator('.modal-card details.tower-fold > summary').click();
    await page.locator(`.modal-card [data-action="toggle-task-complete"][data-id="${first[0].id}"]`).click();
    await dismissBodyScanIfOpen(page);
    check('Taskがcompletedになる',(await stateNow()).tasks.find(t=>t.id==='task-A')?.status==='completed');
    await nav('wbs');
    await page.locator('[data-work-list="wbs-tasks-test-proj"] [data-work-filter="status"]').selectOption('open');
    check('完了後は未完了filterから消える',await openItem('task-A').count()===0);
    await page.locator('[data-work-list="wbs-tasks-test-proj"] [data-work-filter="status"]').selectOption('');
    check('全件filterには完了Taskを保持',await openItem('task-A').count()===1 && await openItem('task-A').locator('.wbs-task-done').count()===1);
    console.log('[4][5] 期限なしも含めた全Taskを元順で保持し、配置が期限情報や並びを変えない');
    const tasks=[wbsTask('task-nodue','期日未設定Task',{dueDate:''}),wbsTask('task-overdue','期日超過Task',{dueDate:addDaysStr(-3)}),wbsTask('task-today2','当日Task',{dueDate:TODAY}),wbsTask('task-tomorrow','翌日Task',{dueDate:addDaysStr(1)})];
    await seed({tasks,projects:[testProject()],view:'wbs'});
    check('期日未設定Taskは一覧に表示される',await openItem('task-nodue').count()===1);
    check('期限で削らず全4Taskを元配列順で表示',JSON.stringify(await taskIds())===JSON.stringify(['task-overdue','task-today2','task-tomorrow','task-nodue']));
    const beforeTasks=(await stateNow()).tasks;
    const secondBrowsingDate = await browseYesterdayForPlacement(page);
    await open('task-today2');
    await assertUntimedTodayPlacement(page, { key: KEY, taskId: 'task-today2', today: TODAY, browsingDate: secondBrowsingDate });
    check('Block登録後も全件の並びは変わらない',JSON.stringify(await taskIds())===JSON.stringify(['task-overdue','task-today2','task-tomorrow','task-nodue']));
    check('Block登録はTask情報を変更しない',JSON.stringify((await stateNow()).tasks)===JSON.stringify(beforeTasks));
    check('Block登録したTaskは一覧に残ったまま',await openItem('task-today2').count()===1);
    await seed({tasks:[wbsTask('task-home','旧home複数回追加検証Task')],projects:[testProject()],view:'home'});
    check('旧home viewはtodayへフォールバックする',await page.locator('#app[data-view="today"]').count()===1);

  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
