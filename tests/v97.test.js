// v97 検証(v332で仕様変更に追随): タスクシュート画面「タスク」一覧の表示範囲。
//
// 旧仕様(v97〜v107): 当日〜7日後(境界含む)+期日超過のみ表示、期日未設定は非表示、
// 8日後以降はtoggle-tasks-show-futureで折りたたみ/展開(データは消さない)。
//
// v332仕様(発注v332 §B、母集団再編): effectiveDueDateが「空(期日未設定) or 今日+7日以内」を
// 表示し、期日未設定は末尾に表示(非表示から変更)。8日後以降はトグルで展開する仕組みを廃止し、
// 「WBSで全部見る」導線へ一本化した(toggle-tasks-show-future UIは撤去)。
// 本ファイルはv97由来の回帰確認の意図(境界値・データ非消失・視覚表現)を新仕様へ置き換えて維持する。
//
// (a) 既定表示は当日〜7日後(境界含む)+期日超過+期日未設定(末尾)。8日後以降は表示されない
// (b) 8日後以降を表示するトグルUIはもう存在しない(WBSへの導線のみ)
// (c) 母集団から外れたTask(8日後)もstate.tasksからは消えない(データは消えていない)
// (d) 期日超過タスクはアンバー表示(.exec-task-overdue、赤系背景ではない)になる
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
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  function task(id, title, dueDate, extra = {}) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate,
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
      doneCriteria: "", firstStep: "", selfDueOff: true, ...extra
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
    task("task-8days", "8日後Task(母集団外)", addDaysStr(8)),
    task("task-overdue", "期日超過Task", addDaysStr(-5)),
    task("task-nodue", "期日未設定Task", "")
  ];

  async function seed({ tasks = [], projects = [], view = "tasks" } = {}) {
    await page.evaluate(({ KEY, tasks, projects, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = tasks;
      s.projects = projects;
      s.blocks = [];
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, tasks, projects, TODAY, view });
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
    // (a) 既定表示: 当日〜7日後(境界含む)+期日超過+期日未設定(末尾)。8日後以降は出ない
    // ============================================================
    console.log("[1] 既定表示は当日〜7日後(境界含む)+期日超過+期日未設定(末尾)。8日後以降は出ない(v332で仕様変更・追随)");
    await seed({ tasks: TASKS, projects: [testProject()], view: "tasks" });
    check("当日期日Taskが表示される", await taskTodayBtn("task-today").count() === 1);
    check("境界(7日後)Taskが表示される", await taskTodayBtn("task-7days").count() === 1);
    check("期日超過Taskが表示される", await taskTodayBtn("task-overdue").count() === 1);
    // v332: 母集団再編(effectiveDueDateが空 or 7日以内)により、期日未設定Taskは
    // 「表示しない」(v107)から「末尾に表示する」へ再度仕様変更された。
    check("期日未設定Taskは末尾に表示される(v332で表示へ変更)", await taskTodayBtn("task-nodue").count() === 1);
    check("8日後Taskは表示されない(母集団外)", await taskTodayBtn("task-8days").count() === 0);
    const idsInOrder = await page.locator('.item [data-action="task-today"]').evaluateAll((els) => els.map((el) => el.dataset.id));
    check("期日昇順: 超過→当日→7日後(境界)→期日なし(末尾)",
      JSON.stringify(idsInOrder) === JSON.stringify(["task-overdue", "task-today", "task-7days", "task-nodue"]),
      JSON.stringify(idsInOrder));

    // ============================================================
    // (b) 8日後以降を表示するトグルUIはもう存在しない(WBS導線へ一本化。発注v332 §B)
    // ============================================================
    console.log("[2] 8日後以降を表示するトグル(toggle-tasks-show-future)はもう出ない。WBSへの導線がある");
    check("toggle-tasks-show-futureボタンは出ない(v332でWBS導線へ一本化・廃止)",
      await page.locator('[data-action="toggle-tasks-show-future"]').count() === 0);
    check("「WBSで全部見る」導線がある", await page.locator('[data-action="nav"][data-view="wbs"]').filter({ hasText: "WBSで全部見る" }).count() === 1);

    // ============================================================
    // (c) 母集団から外れたTask(8日後)もstate.tasksからは消えない(データは消えていない)
    // ============================================================
    console.log("[3] 母集団から外れたTask(8日後)もstate.tasksには残る(データは消えていない)");
    const s = await stateNow();
    const seededIds = TASKS.map((t) => t.id);
    check("seedした5件がすべてstate.tasksに存在する(8日後Taskも含む)",
      seededIds.every((id) => (s.tasks || []).some((t) => t.id === id)));
    check("8日後Taskのdue Dateは変わっていない",
      (s.tasks || []).find((t) => t.id === "task-8days")?.dueDate === addDaysStr(8));
    // WBSタブへ移動すれば8日後Taskも見える(導線の実証)
    await page.click('[data-action="nav"][data-view="wbs"]');
    await page.waitForTimeout(200);
    check("WBSタブでは8日後Taskが見える(表示から消えただけでデータは健在)",
      (await page.textContent("body"))?.includes("8日後Task(母集団外)"));
    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(200);

    // ============================================================
    // (d) 期日超過タスクはアンバー表示(.exec-task-overdue)になる(赤系背景ではない)
    // ============================================================
    console.log("[4] 期日超過Taskは.exec-task-overdue(アンバー)で表示され、赤系背景ではない");
    const overdueRow = page.locator('.exec-task-row', { has: page.locator('[data-action="task-today"][data-id="task-overdue"]') }).first();
    check("期日超過Taskの行に.exec-task-overdue(アンバー)クラスが付く",
      ((await overdueRow.locator(".exec-row-meta").getAttribute("class")) || "").includes("exec-task-overdue"));
    const overdueRowStyle = await overdueRow.evaluate((el) => el.getAttribute("style") || "");
    check("期日超過Taskの行に赤系背景(var(--red-soft))は付かない(v332でアンバー表現へ統一)",
      !overdueRowStyle.includes("var(--red-soft)"), overdueRowStyle);

    // ============================================================
    // (e) 390px幅のスクリーンショット(既定表示・タスク行タップ展開の2枚)
    // ============================================================
    console.log("[5] 390px幅のスクリーンショット取得(既定表示 / タスク行タップ展開)");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pageMobile = await ctxMobile.newPage();
    pageMobile.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(mobile):", e.message); });
    await blockGithubApiByDefault(pageMobile);
    await pageMobile.clock.setFixedTime(now0);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await pageMobile.waitForTimeout(500);
    await passGithubGate(pageMobile);
    await pageMobile.evaluate(({ KEY, TASKS, TODAY }) => {
      const s2 = JSON.parse(localStorage.getItem(KEY));
      s2.tasks = TASKS;
      s2.projects = [{
        id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
        description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false, collapsed: false
      }];
      s2.blocks = [];
      s2.selectedDate = TODAY;
      s2.currentView = "tasks";
      localStorage.setItem(KEY, JSON.stringify(s2));
    }, { KEY, TASKS, TODAY });
    await pageMobile.reload();
    await pageMobile.waitForTimeout(500);
    screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "taskchute-v97-"));
    const defaultPath = path.join(screenshotDir, "v97-taskchute-390px-default.png");
    const expandedPath = path.join(screenshotDir, "v97-taskchute-390px-row-expanded.png");
    await pageMobile.screenshot({ path: defaultPath, fullPage: true });
    await pageMobile.click('[data-action="task-row-toggle"][data-id="task-overdue"]');
    await pageMobile.waitForTimeout(200);
    await pageMobile.screenshot({ path: expandedPath, fullPage: true });
    check("スクショ2枚が生成された",
      fs.existsSync(defaultPath) && fs.existsSync(expandedPath));
    await ctxMobile.close();
  } finally {
    if (screenshotDir) fs.rmSync(screenshotDir, { recursive: true, force: true });
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
