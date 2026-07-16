// v107 検証: 「Blockを完了したのにTaskが未完了一覧・WBSに残る」バグ(K報告2026-07-15)。
//
// 調査・K補足で確定した仕様(当初指示から2回訂正):
//   - Block完了(✓)は「その作業枠」の完了であり、Task本体の完了ではない。1Taskに複数Blockが
//     紐づき得るため、Block完了→Task自動完了は実装しない(toggleBlockは従来どおりtodo→doingのみ)。
//   - タスクシュートのBlock行に、Block完了(✓・丸・緑)とは別に「タスク完了」チェック(🏁・角丸
//     四角・青)を新設。ONにするとTask本体が完了になり(v95連動込み)、そのBlock自身もあわせて
//     completed化する(同じTaskの他のBlockには触れない)。OFFにするとTaskの完了だけ解除し、
//     Block側は解除しない(実績を消さないため)。
//   - Task編集モーダル・WBSチェックボックス経由の完了でも、v95連動(分子=分母)・WBSステータス・
//     未完了タスク一覧からの除外が漏れなく効く必要がある(真因はsaveTaskFromModalがv95連動の
//     フックを素通りしていたこと=v95新設時の実装漏れ)。
//   - 未完了タスク一覧はK指示により仕様変更: 期日未設定Taskは表示しない(v97の「常に表示」を
//     廃止)。期日昇順(超過が最上位)で表示する。
//
// (a) Block完了チェックのみ→Taskのstatus/進捗は不変、未完了一覧に残る(回帰・意図した仕様)
// (b) タスク完了チェック(🏁)→そのBlockも完了になり、Task側もv95連動込みで完了する。
//     同じTaskの他の未完了Blockには触れない
// (c) タスク完了チェックを外す→Taskの完了だけ解除される(Block側は完了のまま維持)
// (d) Block完了チェックとタスク完了チェックはクラス名・アイコンで視覚的に区別できる
// (e) 390px幅で横スクロールが発生せず、両チェックが表示される
// (f) Task編集モーダルで「完了」に保存→v95連動+WBSで完了表示+未完了一覧から消える
// (g) WBSタブのチェックボックス(既存のtoggleTask)で完了→未完了一覧から消える(回帰)
// (h) 期日未設定Taskは未完了一覧に表示されない(K指示、v97からの仕様変更)
// (i) 未完了一覧は期日昇順(期日超過が最上位)で表示される
// (j) 8日後以降の折りたたみ(v97)と期日昇順ソートが共存する
//
// 方針: v95.test.js/v97.test.jsと同じくブラウザ操作 + localStorage状態注入で観測する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

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

  const TODAY = "2026-07-16";
  function wbsTask(id, title, extra = {}) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: TODAY,
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
      progressNum: 0, progressDen: 10, doneCriteria: "", firstStep: "", ...extra
    };
  }
  function makeBlockFixture({ id, taskId, title, completed = false }) {
    return {
      id, taskId, date: TODAY, title, category: "学習",
      plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:45`,
      actualStartAt: completed ? `${TODAY}T09:00` : "", actualEndAt: completed ? `${TODAY}T09:45` : "",
      completed, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "", estimateMin: null,
      leverageType: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
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
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  function wbsBadge(taskId) {
    return page.locator(`.row:has([data-action="edit-task"][data-id="${taskId}"]) .badge`).first();
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) 回帰: Block完了チェックのみ→Task不変、未完了一覧に残る
    // ============================================================
    console.log("[1] Block完了チェック(✓)のみでは紐づくTaskのstatus/進捗は変わらず未完了一覧に残る");
    await seed({
      tasks: [wbsTask("task-A", "W1① ウイスキー章1")],
      blocks: [makeBlockFixture({ id: "block-A", taskId: "task-A", title: "W1① ウイスキー章1" })],
      projects: [testProject()],
      view: "tasks"
    });
    check("Block完了前は未完了タスク一覧に出る", await page.locator('.item [data-action="task-today"][data-id="task-A"]').count() === 1);
    await page.click('[data-action="toggle-block"][data-id="block-A"]');
    await page.waitForTimeout(300);
    const s1 = await stateNow();
    const t1 = s1.tasks.find((t) => t.id === "task-A");
    const b1 = s1.blocks.find((b) => b.id === "block-A");
    check("Blockはcompletedになる", b1?.completed === true, JSON.stringify(b1));
    check("Taskのstatusはcompletedにならない(doingのまま)", t1?.status === "doing", JSON.stringify(t1));
    check("Taskの進捗(分子)は変化しない", t1?.progressNum === 0, JSON.stringify(t1));
    check("Blockチェック後も未完了タスク一覧に残る", await page.locator('.item [data-action="task-today"][data-id="task-A"]').count() === 1);

    // ============================================================
    // (b) タスク完了チェック(🏁)→Blockも完了+Task側もv95連動込みで完了。他Blockは不変
    // ============================================================
    console.log("[2] タスク完了チェック(🏁)→そのBlockも完了、Taskはv95連動込みで完了、同Taskの他Blockは不変");
    await seed({
      tasks: [wbsTask("task-B", "複数Block検証Task", { progressNum: 2, progressDen: 10 })],
      blocks: [
        makeBlockFixture({ id: "block-B1", taskId: "task-B", title: "セッション1" }),
        makeBlockFixture({ id: "block-B2", taskId: "task-B", title: "セッション2" })
      ],
      projects: [testProject()],
      view: "tasks"
    });
    check("タスク完了トグルが表示される(Task紐づきBlockのみ)", await page.locator('[data-action="toggle-task-complete"][data-id="block-B1"]').count() === 1);
    await page.click('[data-action="toggle-task-complete"][data-id="block-B1"]');
    await page.waitForTimeout(300);
    const s2 = await stateNow();
    const t2 = s2.tasks.find((t) => t.id === "task-B");
    const bB1 = s2.blocks.find((b) => b.id === "block-B1");
    const bB2 = s2.blocks.find((b) => b.id === "block-B2");
    check("Taskがcompletedになる", t2?.status === "completed", JSON.stringify(t2));
    check("Taskの分子が分母(10)に揃う(v95連動)", t2?.progressNum === 10, JSON.stringify(t2));
    check("チェックしたBlock(B1)はcompletedになる", bB1?.completed === true, JSON.stringify(bB1));
    check("同じTaskの他のBlock(B2)は完了にならない", bB2?.completed === false, JSON.stringify(bB2));
    check("未完了タスク一覧から消える", await page.locator('.item [data-action="task-today"][data-id="task-B"]').count() === 0);

    // ============================================================
    // (c) タスク完了チェックを外す→Taskの完了だけ解除、Blockは完了のまま
    // ============================================================
    console.log("[3] タスク完了チェックを外す→Taskの完了だけ解除される(Block側は完了のまま維持)");
    await page.click('[data-action="toggle-task-complete"][data-id="block-B1"]');
    await page.waitForTimeout(300);
    const s3 = await stateNow();
    const t3 = s3.tasks.find((t) => t.id === "task-B");
    const b3 = s3.blocks.find((b) => b.id === "block-B1");
    check("Taskはdoingに戻る(Blockに実績があるためtodoではない)", t3?.status === "doing", JSON.stringify(t3));
    check("Block(B1)は完了のまま(解除しない)", b3?.completed === true, JSON.stringify(b3));
    check("未完了タスク一覧へ戻る", await page.locator('.item [data-action="task-today"][data-id="task-B"]').count() === 1);

    // ============================================================
    // (d) 2つのチェックがクラス名・アイコンで視覚的に区別できる
    // ============================================================
    console.log("[4] Block完了チェックとタスク完了チェックがクラス名・アイコンで区別できる");
    const blockCheck = page.locator('[data-action="toggle-block"][data-id="block-B1"]');
    const taskCheck = page.locator('[data-action="toggle-task-complete"][data-id="block-B1"]');
    check("Block完了チェックは.checkbox-buttonクラス", await blockCheck.evaluate((el) => el.classList.contains("checkbox-button")));
    check("タスク完了チェックは.task-complete-toggleクラス(別クラス)", await taskCheck.evaluate((el) => el.classList.contains("task-complete-toggle")));
    check("Block完了チェックのアイコンは✓", (await blockCheck.textContent())?.trim() === "✓");
    check("タスク完了チェックのアイコンは🏁(別アイコン)", (await taskCheck.textContent())?.trim() === "🏁");

    // ============================================================
    // (e) 390px幅で横スクロールが発生せず、両チェックが表示される
    // ============================================================
    console.log("[5] 390px幅で横スクロールが発生せず、Block完了/タスク完了の両チェックが表示される");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pageMobile = await ctxMobile.newPage();
    pageMobile.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(mobile):", e.message); });
    await blockGithubApiByDefault(pageMobile);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await pageMobile.waitForTimeout(500);
    await passGithubGate(pageMobile);
    await pageMobile.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [{
        id: "task-M", projectId: "test-proj", parentTaskId: "", title: "390px幅確認Task", category: "",
        status: "todo", dueDate: TODAY, description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false, progressNum: 0, progressDen: 10, doneCriteria: "", firstStep: ""
      }];
      s.blocks = [{
        id: "block-M", taskId: "task-M", date: TODAY, title: "390px幅確認Task", category: "学習",
        plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:45`, actualStartAt: "", actualEndAt: "",
        completed: false, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "", pomodoroCount: 0,
        migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "", estimateMin: null,
        leverageType: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
      }];
      s.projects = [{
        id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
        description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false, collapsed: false
      }];
      s.selectedDate = TODAY;
      s.currentView = "tasks";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await pageMobile.reload();
    await pageMobile.waitForTimeout(500);
    check("390px幅でBlock完了チェックが見える", await pageMobile.locator('[data-action="toggle-block"][data-id="block-M"]').count() === 1);
    check("390px幅でタスク完了チェックが見える", await pageMobile.locator('[data-action="toggle-task-complete"][data-id="block-M"]').count() === 1);
    const metricsMobile = await pageMobile.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    check("390px幅で横スクロールが発生しない(scrollWidth <= clientWidth)",
      metricsMobile.scrollWidth <= metricsMobile.clientWidth + 1,
      `scrollWidth=${metricsMobile.scrollWidth} clientWidth=${metricsMobile.clientWidth}`);
    await ctxMobile.close();

    // ============================================================
    // (f) Task編集モーダルで「完了」に保存→v95連動+WBS完了表示+未完了一覧から消える
    // ============================================================
    console.log("[6] Task編集モーダルでステータスを「完了」にして保存 → 分子=分母、WBSで完了表示、未完了一覧から消える");
    await seed({
      tasks: [wbsTask("task-C", "編集モーダル完了検証Task", { progressNum: 3, progressDen: 10 })],
      blocks: [],
      projects: [testProject()],
      view: "tasks"
    });
    check("保存前は未完了タスク一覧に出る", await page.locator('.item [data-action="task-today"][data-id="task-C"]').count() === 1);
    await page.click('[data-action="edit-task"][data-id="task-C"]');
    await page.waitForTimeout(200);
    await page.selectOption('[data-modal-field="status"]', "completed");
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s6 = await stateNow();
    const t6 = s6.tasks.find((t) => t.id === "task-C");
    check("保存後、分子が分母(10)と同じになる(v95連動)", t6?.progressNum === 10, JSON.stringify(t6));
    check("保存後、statusがcompletedになる", t6?.status === "completed", JSON.stringify(t6));
    check("保存後、未完了タスク一覧から消える", await page.locator('.item [data-action="task-today"][data-id="task-C"]').count() === 0);
    await page.click('[data-action="nav"][data-view="wbs"]');
    await page.waitForTimeout(200);
    check("WBSタブのバッジが「完了」になる", (await wbsBadge("task-C").textContent())?.includes("完了"), await wbsBadge("task-C").textContent());

    // ============================================================
    // (g) WBSチェックボックス(既存toggleTask)で完了→未完了一覧から消える(回帰)
    // ============================================================
    console.log("[7] WBSタブのチェックボックス(toggleTask)で完了→タスクシュートの未完了一覧から消える(既存経路の回帰確認)");
    await seed({
      tasks: [wbsTask("task-D", "WBSチェック完了検証Task", { progressNum: 4, progressDen: 10 })],
      blocks: [],
      projects: [testProject()],
      view: "tasks"
    });
    check("WBS操作前は未完了タスク一覧(tasks画面)に出る", await page.locator('.item [data-action="task-today"][data-id="task-D"]').count() === 1);
    await page.click('[data-action="nav"][data-view="wbs"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="toggle-task"][data-id="task-D"]');
    await page.waitForTimeout(300);
    const s7 = await stateNow();
    const t7 = s7.tasks.find((t) => t.id === "task-D");
    check("WBSチェックで分子が分母に揃う(既存v95連動)", t7?.progressNum === 10, JSON.stringify(t7));
    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(200);
    check("WBS完了後、タスクシュートの未完了一覧から消える", await page.locator('.item [data-action="task-today"][data-id="task-D"]').count() === 0);

    // ============================================================
    // (h) 期日未設定Taskは未完了一覧に表示されない(K指示、v97仕様変更)
    // ============================================================
    console.log("[8] 期日未設定Taskは未完了タスク一覧に表示されない(v97の「常に表示」をK指示で廃止)");
    await seed({
      tasks: [wbsTask("task-nodue", "期日未設定Task", { dueDate: "" })],
      blocks: [],
      projects: [testProject()],
      view: "tasks"
    });
    check("期日未設定Taskは表示されない", await page.locator('.item [data-action="task-today"][data-id="task-nodue"]').count() === 0);

    // ============================================================
    // (i)(j) 未完了一覧は期日昇順(超過が最上位)。8日後以降の折りたたみと共存する
    // ============================================================
    console.log("[9][10] 未完了一覧は期日昇順で表示され、8日後以降の折りたたみ(v97)と共存する");
    const SORT_TASKS = [
      wbsTask("task-in3days", "3日後Task", { dueDate: "2026-07-19" }),
      wbsTask("task-overdue", "期日超過Task", { dueDate: "2026-07-10" }),
      wbsTask("task-today2", "当日Task", { dueDate: TODAY }),
      wbsTask("task-tomorrow", "翌日Task", { dueDate: "2026-07-17" }),
      wbsTask("task-8days", "8日後Task(折りたたみ対象)", { dueDate: "2026-07-25" })
    ];
    await seed({ tasks: SORT_TASKS, blocks: [], projects: [testProject()], view: "tasks" });
    const idsInOrder = await page.locator('.item [data-action="task-today"]').evaluateAll((els) => els.map((el) => el.dataset.id));
    check("既定表示(8日後以降は畳む)は期日昇順: 超過→当日→翌日→3日後",
      JSON.stringify(idsInOrder) === JSON.stringify(["task-overdue", "task-today2", "task-tomorrow", "task-in3days"]),
      JSON.stringify(idsInOrder));
    await page.click('[data-action="toggle-tasks-show-future"]');
    await page.waitForTimeout(200);
    const idsInOrderExpanded = await page.locator('.item [data-action="task-today"]').evaluateAll((els) => els.map((el) => el.dataset.id));
    check("8日後以降を展開しても期日昇順のまま末尾に追加される",
      JSON.stringify(idsInOrderExpanded) === JSON.stringify(["task-overdue", "task-today2", "task-tomorrow", "task-in3days", "task-8days"]),
      JSON.stringify(idsInOrderExpanded));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
