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
// (d)〜(j): tests/v107.test.js の後続コミットで追加(2チェックの視覚的区別・390px幅・
//     Task編集モーダル/WBSチェックボックス経由の完了回帰・期日未設定除外・期日昇順ソート)
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
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
