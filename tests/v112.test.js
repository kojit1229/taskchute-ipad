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
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  function openItem(taskId) {
    return page.locator(`.item:has([data-action="task-today"][data-id="${taskId}"])`);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) 未登録タスクは一覧に出る→「今日へ追加」クリックでBlock1件、一覧に残る+バッジ表示
    // ============================================================
    console.log("[1] 当日Block未登録タスクは一覧に出る→「今日へ追加」クリックでBlockが作られ、一覧に残ったままバッジが出る");
    await seed({
      tasks: [wbsTask("task-A", "複数回今日へ追加検証Task")],
      blocks: [],
      projects: [testProject()],
      view: "tasks"
    });
    check("初期状態で一覧に出る", await openItem("task-A").count() === 1);
    check("初期状態ではバッジは出ない", !(await openItem("task-A").textContent())?.includes("Block 追加済み"));
    await page.click('[data-action="task-today"][data-id="task-A"]');
    await page.waitForTimeout(300);
    const s1 = await stateNow();
    const blocksForA1 = s1.blocks.filter((b) => b.taskId === "task-A" && !b.deleted);
    check("Blockが1件作られる", blocksForA1.length === 1, JSON.stringify(blocksForA1));
    check("1回目クリック後も一覧に残る", await openItem("task-A").count() === 1);
    check("「本日 1 件 Block 追加済み」バッジが出る", (await openItem("task-A").textContent())?.includes("本日 1 件 Block 追加済み"),
      await openItem("task-A").textContent());

    // ============================================================
    // (b) 同じタスクへもう一度「今日へ追加」→2件目のBlockが作られる。バッジは「本日 2 件」
    // ============================================================
    console.log("[2] 同じタスクへもう一度「今日へ追加」をクリックすると2件目のBlockが作られ、バッジが更新される");
    await page.click('[data-action="task-today"][data-id="task-A"]');
    await page.waitForTimeout(300);
    const s2 = await stateNow();
    const blocksForA2 = s2.blocks.filter((b) => b.taskId === "task-A" && !b.deleted);
    check("Blockが2件になる(同一taskId、別id)", blocksForA2.length === 2, JSON.stringify(blocksForA2));
    check("2件のBlock idは別々", blocksForA2[0].id !== blocksForA2[1].id, JSON.stringify(blocksForA2));
    check("2回目クリック後も一覧に残る", await openItem("task-A").count() === 1);
    check("「本日 2 件 Block 追加済み」バッジに更新される", (await openItem("task-A").textContent())?.includes("本日 2 件 Block 追加済み"),
      await openItem("task-A").textContent());
    // タスクシュート画面のBlock一覧(.block-rowカード)にも2件のBlockが実際に描画されていること
    // (Block化自体のUI確認。.block-row内には複数のdata-action="edit-block"要素があるため、
    // カード単位=.block-rowで数える)
    const blockCardCount = await page.locator(
      `.block-row:has([data-action="edit-block"][data-id="${blocksForA2[0].id}"]), .block-row:has([data-action="edit-block"][data-id="${blocksForA2[1].id}"])`
    ).count();
    check("タスクシュートのBlock一覧に2件描画される", blockCardCount === 2, `blockCardCount=${blockCardCount}`);

    // ============================================================
    // (c) タスクを完了にすると一覧から消える(v107回帰の維持確認)
    // ============================================================
    console.log("[3] タスクを完了にすると一覧から消える(v107回帰の維持確認)");
    // v146でBlockシュート行から🏁(toggle-task-complete)がBlock編集モーダルへ移設されたため、
    // 行内の直接クリックではなくモーダルを開いてから操作する(tests/v107.test.jsと同じパターン)。
    await page.click(`[data-action="edit-block"][data-id="${blocksForA2[0].id}"]`);
    await page.waitForTimeout(200);
    await page.click(`.modal-card [data-action="toggle-task-complete"][data-id="${blocksForA2[0].id}"]`);
    await page.waitForTimeout(300);
    await page.click('[data-action="modal-close"]');
    await page.waitForTimeout(150);
    const s3 = await stateNow();
    const tA3 = s3.tasks.find((t) => t.id === "task-A");
    check("Taskがcompletedになる", tA3?.status === "completed", JSON.stringify(tA3));
    check("完了後は一覧から消える", await openItem("task-A").count() === 0);

    // ============================================================
    // (d) 期日なしTaskは表示されない/期日昇順(v97/v107回帰の維持確認)
    // ============================================================
    console.log("[4] 期日なしTaskは表示されない/未完了一覧は期日昇順で表示される(v97/v107回帰の維持確認)");
    await seed({
      tasks: [
        wbsTask("task-nodue", "期日未設定Task", { dueDate: "" }),
        wbsTask("task-overdue", "期日超過Task", { dueDate: addDaysStr(-3) }),
        wbsTask("task-today2", "当日Task", { dueDate: TODAY }),
        wbsTask("task-tomorrow", "翌日Task", { dueDate: addDaysStr(1) })
      ],
      blocks: [],
      projects: [testProject()],
      view: "tasks"
    });
    check("期日未設定Taskは表示されない", await openItem("task-nodue").count() === 0);
    const idsInOrder = await page.locator('.item [data-action="task-today"]').evaluateAll((els) => els.map((el) => el.dataset.id));
    check("期日昇順(超過→当日→翌日)で表示される",
      JSON.stringify(idsInOrder) === JSON.stringify(["task-overdue", "task-today2", "task-tomorrow"]),
      JSON.stringify(idsInOrder));

    // ============================================================
    // (e) 当日Block登録済みタスクへ2つ目を追加した状態でも期日超過は最上位のまま(表示順回帰)
    // ============================================================
    console.log("[5] 当日Block登録済み(バッジ有り)タスクが混在しても期日昇順の並びは崩れない");
    await page.click('[data-action="task-today"][data-id="task-today2"]');
    await page.waitForTimeout(300);
    const idsInOrder2 = await page.locator('.item [data-action="task-today"]').evaluateAll((els) => els.map((el) => el.dataset.id));
    check("Block登録後も期日昇順の並びは変わらない",
      JSON.stringify(idsInOrder2) === JSON.stringify(["task-overdue", "task-today2", "task-tomorrow"]),
      JSON.stringify(idsInOrder2));
    check("Block登録したタスクは一覧に残ったまま", await openItem("task-today2").count() === 1);

    // ============================================================
    // (f)(g) ホームタブの「未完了タスク」パネル(homeBacklog): v112でdisabled解除。
    //        当日登録済み・未完了でも再追加ボタンが押せ、2件目のBlockが作られる
    //        (K指摘: Kの体感の原因はここのdisabledだった可能性が高い)
    // ============================================================
    console.log("[6][7] v230: 旧home backlog導線は描画されない");
    await seed({
      tasks: [wbsTask("task-home", "旧home複数回追加検証Task")],
      blocks: [],
      projects: [testProject()],
      view: "home"
    });
    check("旧home backlogとhome-add-today導線は描画されない",
      await page.locator('.home-due, [data-action="home-add-today"]').count() === 0);
    check("旧home viewはtodayへフォールバックする", await page.locator('#app[data-view="today"]').count() === 1);
    // 現行タスクシュートでの複数回追加契約は本スイート(a)〜(e)で維持している。
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
