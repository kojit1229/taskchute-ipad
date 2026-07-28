// v97 検証: タスクシュート画面「未完了タスク」の表示範囲を当日〜7日後+期日超過に絞り、
// 8日後以降はトグルで折りたたむ(データは消さない)。
//
// (a) 既定表示(tasksShowFuture=false)は当日〜7日後(境界含む)+期日超過+期日未設定のみ。
//     8日後以降は行が出ない
// (b) 折りたたみ件数がトグルボタンに表示される
// (c) トグルを押すと8日後以降のタスクも表示され、ボタン文言が切り替わる。state.tasksは
//     一切減っていない(データは消えていない)
// (d) トグル状態(state.settings.tasksShowFuture)はpersistLocalNoScheduleで永続化され、
//     リロード後も保持される
// (e) 期日超過タスクは既定表示に含まれ、赤系背景(var(--red-soft))が付く
//
// 方針: v96.test.jsと同じくブラウザ操作 + localStorage状態注入で観測する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
let screenshotDir = "";

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
  // v108: 実時刻依存フレーク対策 — TODAYをハードコードせず実行時の「今日」10:00に固定する
  //       (v89/v90と同じ流儀)。app.js起動時にstate.selectedDate=todayISO()(実時計)へ強制される
  //       ため、TODAYがハードコード日付のままだと実行日によって選択日とフィクスチャの期日計算が
  //       ズレて「8日後」等の境界判定が壊れる(2026-07-16のCI赤で顕在化)。
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  function task(id, title, dueDate, extra = {}) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate,
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
      doneCriteria: "", firstStep: "", ...extra
    };
  }
  // v108: TODAY相対の期日をnow0からのDateオブジェクト演算で求める(文字列固定日ではズレる)
  const addDaysStr = (n) => {
    const d = new Date(now0);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  const testProject = () => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });

  const TASKS = [
    task("task-today", "当日期日Task", TODAY),
    task("task-7days", "境界(7日後)Task", addDaysStr(7)),
    task("task-8days", "8日後Task(折りたたみ対象)", addDaysStr(8)),
    task("task-overdue", "期日超過Task", addDaysStr(-5)),
    task("task-nodue", "期日未設定Task", "")
  ];

  async function seed({ tasks = [], projects = [], view = "tasks", tasksShowFuture } = {}) {
    await page.evaluate(({ KEY, tasks, projects, TODAY, view, tasksShowFuture }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = tasks;
      s.projects = projects;
      s.blocks = [];
      s.selectedDate = TODAY;
      s.currentView = view;
      if (typeof tasksShowFuture === "boolean") s.settings.tasksShowFuture = tasksShowFuture;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, tasks, projects, TODAY, view, tasksShowFuture });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  function taskTodayBtn(id) {
    return page.locator(`.item [data-action="task-today"][data-id="${id}"]`);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) 既定表示(tasksShowFuture=false): 当日〜7日後(境界含む)+期日超過+期日未設定のみ
    // ============================================================
    console.log("[1] 既定表示は当日〜7日後(境界含む)+期日超過+期日未設定のみ。8日後以降は出ない");
    await seed({ tasks: TASKS, projects: [testProject()], view: "tasks", tasksShowFuture: false });
    check("当日期日Taskが表示される", await taskTodayBtn("task-today").count() === 1);
    check("境界(7日後)Taskが表示される", await taskTodayBtn("task-7days").count() === 1);
    check("期日超過Taskが表示される", await taskTodayBtn("task-overdue").count() === 1);
    // v107: K指示(2026-07-15)によりv97の「期日未設定は常に表示」を廃止。期日未設定Taskは
    //       一覧から除外される(tests/v107.test.jsで新仕様の主検証、ここは回帰確認のみ更新)
    check("期日未設定Taskは表示されない(v107でK指示により廃止)", await taskTodayBtn("task-nodue").count() === 0);
    check("8日後Taskは既定では表示されない", await taskTodayBtn("task-8days").count() === 0);

    // ============================================================
    // (b) 折りたたみ件数がトグルボタンに表示される
    // ============================================================
    console.log("[2] トグルボタンに折りたたみ件数(1件)が表示される");
    const toggleBtn = page.locator('[data-action="toggle-tasks-show-future"]');
    check("トグルボタンが1個存在する", await toggleBtn.count() === 1);
    check("ボタン文言に「8日後以降を表示 (1件)」が含まれる", (await toggleBtn.textContent())?.includes("8日後以降を表示 (1件)"),
      await toggleBtn.textContent());

    // ============================================================
    // (c) トグルを押すと8日後以降も表示され、文言が切り替わる。データは消えていない
    // ============================================================
    console.log("[3] トグルを押すと8日後以降のTaskも表示され、文言が切り替わる。stateのTask件数は不変");
    // v28自動生成の「その他」受け皿Taskがnormalize時に1件追加されるため、seed直後の総数を
    // 基準に前後比較する(絶対値5固定ではなく差分ゼロで検証)
    const beforeToggleState = await stateNow();
    const beforeCount = (beforeToggleState.tasks || []).length;
    const seededIds = TASKS.map((t) => t.id);
    check("トグル前: seedした5件がすべて存在する",
      seededIds.every((id) => (beforeToggleState.tasks || []).some((t) => t.id === id)));
    await toggleBtn.click();
    await page.waitForTimeout(200);
    check("8日後Taskがトグル後に表示される", await taskTodayBtn("task-8days").count() === 1);
    const toggleBtnAfter = page.locator('[data-action="toggle-tasks-show-future"]');
    check("ボタン文言が「8日後以降を隠す」に切り替わる", (await toggleBtnAfter.textContent())?.includes("8日後以降を隠す"),
      await toggleBtnAfter.textContent());
    const afterToggleState = await stateNow();
    check("トグル後もTask総数は不変(データは消えていない)", (afterToggleState.tasks || []).length === beforeCount,
      `before=${beforeCount} after=${(afterToggleState.tasks || []).length}`);
    check("トグル後もseedした5件がすべて存在する",
      seededIds.every((id) => (afterToggleState.tasks || []).some((t) => t.id === id)));
    check("トグル後もtask-8daysのdueDateは変わらず残っている",
      (afterToggleState.tasks || []).find((t) => t.id === "task-8days")?.dueDate === addDaysStr(8));

    // ============================================================
    // (d) トグル状態はpersistLocalNoScheduleで永続化され、リロード後も保持される
    // ============================================================
    console.log("[4] トグル状態(tasksShowFuture=true)がリロード後も保持される");
    check("state.settings.tasksShowFutureがtrueになっている", afterToggleState.settings?.tasksShowFuture === true);
    await page.reload();
    await page.waitForTimeout(500);
    check("リロード後も8日後Taskが表示されたまま(トグル状態が保持)", await taskTodayBtn("task-8days").count() === 1);

    // ============================================================
    // (e) 期日超過タスクは既定表示に含まれ、赤系背景(var(--red-soft))が付く
    // ============================================================
    console.log("[5] 期日超過Taskには赤系背景(var(--red-soft))が付く");
    const overdueItemStyle = await page.locator('.item', { has: page.locator('[data-action="task-today"][data-id="task-overdue"]') }).first()
      .evaluate((el) => el.getAttribute("style") || "");
    check("期日超過Taskの行にvar(--red-soft)背景が付く", overdueItemStyle.includes("var(--red-soft)"), overdueItemStyle);

    // ============================================================
    // (f) 8日後以降のTaskが1件も無いときはトグルボタンが出ない(回帰: 誤って常時表示しない)
    // ============================================================
    console.log("[6] 8日後以降のTaskが0件のときはトグルボタンが出ない");
    await seed({
      tasks: [task("task-only-today", "当日のみTask", TODAY)],
      projects: [testProject()], view: "tasks", tasksShowFuture: false
    });
    check("折りたたみ対象が無いときはトグルボタンが出ない", await page.locator('[data-action="toggle-tasks-show-future"]').count() === 0);

    // ============================================================
    // (g) 390px幅のスクリーンショット(既定=折りたたみ、トグル後=展開)
    // ============================================================
    console.log("[7] 390px幅のスクリーンショット取得(既定折りたたみ / トグル展開)");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pageMobile = await ctxMobile.newPage();
    pageMobile.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(mobile):", e.message); });
    await blockGithubApiByDefault(pageMobile);
    await pageMobile.clock.setFixedTime(now0);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await pageMobile.waitForTimeout(500);
    await passGithubGate(pageMobile);
    await pageMobile.evaluate(({ KEY, TASKS, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = TASKS;
      s.projects = [{
        id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
        description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false, collapsed: false
      }];
      s.blocks = [];
      s.selectedDate = TODAY;
      s.currentView = "tasks";
      s.settings.tasksShowFuture = false;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TASKS, TODAY });
    await pageMobile.reload();
    await pageMobile.waitForTimeout(500);
    screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "taskchute-v97-"));
    const collapsedPath = path.join(screenshotDir, "v97-taskchute-390px-collapsed.png");
    const expandedPath = path.join(screenshotDir, "v97-taskchute-390px-expanded.png");
    await pageMobile.screenshot({ path: collapsedPath, fullPage: true });
    await pageMobile.click('[data-action="toggle-tasks-show-future"]');
    await pageMobile.waitForTimeout(200);
    await pageMobile.screenshot({ path: expandedPath, fullPage: true });
    check("スクショ2枚が生成された",
      fs.existsSync(collapsedPath) && fs.existsSync(expandedPath));
    await ctxMobile.close();
  } finally {
    if (screenshotDir) fs.rmSync(screenshotDir, { recursive: true, force: true });
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
