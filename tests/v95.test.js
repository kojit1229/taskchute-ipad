// v95 検証: WBSタブに Task進捗(分子/分母)入力+バー、Project進捗率集計を追加。
//
// (a) normalizeState 後方互換: 旧Task(progressNum/progressDen無し)に 0/10 が補完される。
//     旧Project(showProgress無し)に false が補完される
// (b) WBSタブの通常表示(編集モードOFF)でも分子/分母の数値入力欄が常時表示され、
//     入力→change→保存→再描画で値が保持される
// (c) Task行のバー幅が num/den に一致する(0除算ガード: 分母0→0%)
// (d) Project集計: 配下Taskの Σ分子/Σ分母 で進捗率を算出しバー表示する
// (e) 「進捗率を表示」チェックボックスOFFならProject行にバー・集計が出ない(Task入力欄は出る)
// (f) 390px幅でWBSタブに横スクロールが発生しない
// (g) 完了チェック → 分子が分母と同じ値になる
// (h) 完了済みTaskに分子<分母を入力 → 完了解除されdoing(着手中)になる
// (i) 分子>分母を入力 → 分子が分母にクランプされ completed になる
// (j) 分子=分母を入力 → completed になる。分子0の未完了Taskはtodo(未着手)のまま
//
// 方針: 既存スイート(v55/v67)と同じく、app.jsはtype="module"のため内部関数はwindowに
// 露出しない。ブラウザ操作 + localStorage状態の直接注入で観測する。
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
  // v108: 実時刻依存フレーク対策 — TODAYをハードコードせず実行時の「今日」10:00に固定する
  //       (v89/v90/v97/v98と同じ流儀)。app.js起動時にstate.selectedDate=todayISO()(実時計)へ
  //       強制されるため、TODAYがハードコード日付のままだと実行日によって選択日とフィクスチャが
  //       ズレる可能性がある(2026-07-16のCI赤=v97/v98で顕在化した既知のクラス)。
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  function wbsTask(id, title, extra = {}) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
      progressNum: 0, progressDen: 10, ...extra
    };
  }
  const testProject = (extra = {}) => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false, showProgress: false, ...extra
  });

  async function seed(page, { tasks = [], projects = [], view = "wbs" } = {}) {
    await page.evaluate(({ KEY, tasks, projects, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = tasks;
      s.projects = projects;
      s.blocks = [];
      s.selectedDate = TODAY;
      s.currentView = view;
      // v302: 本スイートは進捗↔status連動を固定するため、完了Projectフィルタは明示OFF。
      s.settings.wbsHideDoneProjects = false;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, tasks, projects, TODAY, view });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function stateNow(page) {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) normalizeState 後方互換
    // ============================================================
    console.log("[1] normalizeState 後方互換: 旧Task→progressNum:0/progressDen:10、旧Project→showProgress:false");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [{
        id: "legacy-task", projectId: "legacy-proj", parentTaskId: "", title: "旧データTask", category: "",
        status: "todo", dueDate: "", description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false
        // progressNum/progressDen フィールドなし(旧データを模擬)
      }];
      s.projects = [{
        id: "legacy-proj", kind: "normal", title: "旧データProject", category: "", status: "active",
        description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false
        // showProgress フィールドなし
      }];
      s.blocks = [];
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click('[data-action="nav"][data-view="today"]');  // v230: home撤去後の現行view
    await page.waitForTimeout(200);
    const normalized = await stateNow(page);
    const legacyTask = (normalized.tasks || []).find((t) => t.id === "legacy-task");
    const legacyProj = (normalized.projects || []).find((p) => p.id === "legacy-proj");
    check("旧Taskにprogress Num:0が補完される", legacyTask?.progressNum === 0, JSON.stringify(legacyTask));
    check("旧Taskにprogress Den:10が補完される", legacyTask?.progressDen === 10, JSON.stringify(legacyTask));
    check("旧ProjectにshowProgress:falseが補完される", legacyProj?.showProgress === false, JSON.stringify(legacyProj));

    // ============================================================
    // (b)(c) 入力欄常時表示 + 保存 + バー幅
    // ============================================================
    console.log("[2] 編集モードOFFでも分子/分母の入力欄が常時表示され、入力→保存→再描画で値保持、バー幅がnum/denに一致");
    await seed(page, { tasks: [wbsTask("task-A", "進捗つきTask", { progressNum: 0, progressDen: 10 })], projects: [testProject()] });
    check("編集モードOFF", await page.locator('[data-action="toggle-wbs-edit"].primary').count() === 0);
    check("分子入力欄が常時表示される", await page.locator('input[data-wbs-progress="num"][data-id="task-A"]').count() === 1);
    check("分母入力欄が常時表示される", await page.locator('input[data-wbs-progress="den"][data-id="task-A"]').count() === 1);
    check("入力欄はfont-size 16px以上", await page.locator('input[data-wbs-progress="num"][data-id="task-A"]').evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize) >= 16));

    await page.locator('input[data-wbs-progress="num"][data-id="task-A"]').fill("3");
    await page.locator('input[data-wbs-progress="num"][data-id="task-A"]').dispatchEvent("change");
    await page.waitForTimeout(200);
    const s2 = await stateNow(page);
    check("分子3が保存される", s2.tasks.find((t) => t.id === "task-A")?.progressNum === 3, JSON.stringify(s2.tasks));
    check("再描画後も入力欄の値3が保持される", await page.locator('input[data-wbs-progress="num"][data-id="task-A"]').inputValue() === "3");
    // v95補足: normalizeState()が「その他」Project/Task(受け皿)を必ず1つ自動生成するため、
    // .wbs-progress-row は複数存在しうる。.first()に頼らずtask-Aの行に:has()で絞り込む。
    const barWidth = await page.locator('.wbs-progress-row:has(input[data-id="task-A"]) .wbs-progress-bar > span').evaluate((el) => el.style.width);
    check("バー幅が30%(3/10)", barWidth === "30%", barWidth);

    console.log("[3] 0除算ガード: 分母を0にするとバーが0%になる(エラーにならない)");
    await page.locator('input[data-wbs-progress="den"][data-id="task-A"]').fill("0");
    await page.locator('input[data-wbs-progress="den"][data-id="task-A"]').dispatchEvent("change");
    await page.waitForTimeout(200);
    const barWidth0 = await page.locator('.wbs-progress-row:has(input[data-id="task-A"]) .wbs-progress-bar > span').evaluate((el) => el.style.width);
    check("分母0でバー0%(0除算ガード)", barWidth0 === "0%", barWidth0);

    // ============================================================
    // (d)(e) Project集計 + 表示トグル
    // ============================================================
    console.log("[4] Project集計: Σ分子/Σ分母で進捗率算出、showProgress ONの時だけバー表示");
    await seed(page, {
      tasks: [
        wbsTask("task-B1", "子1", { progressNum: 4, progressDen: 10 }),
        wbsTask("task-B2", "子2", { progressNum: 2, progressDen: 10 })
      ],
      projects: [testProject({ showProgress: false })]
    });
    check("showProgress OFFでは集計バーが出ない", await page.locator('.wbs-progress-agg').count() === 0);
    // v95補足: 「その他」Project配下の受け皿Taskにも進捗入力欄が出るため、全体件数ではなく個別に確認する
    check("Task入力欄はshowProgress OFFでも出る(子1)", await page.locator('input[data-wbs-progress="num"][data-id="task-B1"]').count() === 1);
    check("Task入力欄はshowProgress OFFでも出る(子2)", await page.locator('input[data-wbs-progress="num"][data-id="task-B2"]').count() === 1);

    await seed(page, {
      tasks: [
        wbsTask("task-B1", "子1", { progressNum: 4, progressDen: 10 }),
        wbsTask("task-B2", "子2", { progressNum: 2, progressDen: 10 })
      ],
      projects: [testProject({ showProgress: true })]
    });
    check("showProgress ONで集計バーが出る", await page.locator('.wbs-progress-agg').count() === 1);
    const aggText = await page.locator('.wbs-progress-agg').textContent();
    check("集計が6/20(30%)", aggText.includes("6 / 20") && aggText.includes("30%"), aggText);

    // ============================================================
    // (f) 390px幅で横スクロールが発生しない
    // ============================================================
    console.log("[5] 390px幅のWBSタブで横スクロールが発生しない");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pageMobile = await ctxMobile.newPage();
    pageMobile.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(mobile):", e.message); });
    await blockGithubApiByDefault(pageMobile);
    await pageMobile.clock.setFixedTime(now0);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await pageMobile.waitForTimeout(500);
    await passGithubGate(pageMobile);
    await seed(pageMobile, {
      tasks: [wbsTask("task-M", "モバイル幅確認Task", { progressNum: 5, progressDen: 10 })],
      projects: [testProject({ showProgress: true })]
    });
    const metricsMobile = await pageMobile.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    check("390px幅で横スクロールが発生しない(scrollWidth <= clientWidth)",
      metricsMobile.scrollWidth <= metricsMobile.clientWidth + 1,
      `scrollWidth=${metricsMobile.scrollWidth} clientWidth=${metricsMobile.clientWidth}`);
    await ctxMobile.close();

    // ============================================================
    // (g)〜(j) 進捗↔ステータスの双方向連動(K指示 2026-07-15追加)
    // ============================================================
    console.log("[6] チェックボックス完了 → 分子が分母と同じ値になる");
    await seed(page, { tasks: [wbsTask("task-C", "完了チェックTask", { progressNum: 3, progressDen: 10 })], projects: [testProject()] });
    await page.click('[data-action="toggle-task"][data-id="task-C"]');
    await page.waitForTimeout(200);
    const s6 = await stateNow(page);
    const t6 = s6.tasks.find((t) => t.id === "task-C");
    check("完了チェックで分子が分母(10)と同じになる", t6?.progressNum === 10, JSON.stringify(t6));
    check("ステータスがcompletedになる", t6?.status === "completed", JSON.stringify(t6));

    console.log("[7] 完了済みTaskに分子<分母を入力 → 完了解除されdoing(着手中)になる");
    await seed(page, { tasks: [wbsTask("task-D", "完了済みTask", { progressNum: 10, progressDen: 10, status: "completed" })], projects: [testProject()] });
    await page.locator('input[data-wbs-progress="num"][data-id="task-D"]').fill("4");
    await page.locator('input[data-wbs-progress="num"][data-id="task-D"]').dispatchEvent("change");
    await page.waitForTimeout(200);
    const s7 = await stateNow(page);
    const t7 = s7.tasks.find((t) => t.id === "task-D");
    check("分子<分母でステータスがdoing(着手中)になる", t7?.status === "doing", JSON.stringify(t7));
    check("分子は入力値4のまま", t7?.progressNum === 4, JSON.stringify(t7));

    console.log("[8] 分子>分母を入力 → 分子が分母にクランプされ completed になる");
    await seed(page, { tasks: [wbsTask("task-E", "オーバーTask", { progressNum: 2, progressDen: 10 })], projects: [testProject()] });
    await page.locator('input[data-wbs-progress="num"][data-id="task-E"]').fill("15");
    await page.locator('input[data-wbs-progress="num"][data-id="task-E"]').dispatchEvent("change");
    await page.waitForTimeout(200);
    const s8 = await stateNow(page);
    const t8 = s8.tasks.find((t) => t.id === "task-E");
    check("分子が分母(10)にクランプされる", t8?.progressNum === 10, JSON.stringify(t8));
    check("ステータスがcompletedになる", t8?.status === "completed", JSON.stringify(t8));

    console.log("[9] 分子=分母を入力 → completed になる");
    await seed(page, { tasks: [wbsTask("task-F", "ぴったりTask", { progressNum: 3, progressDen: 10 })], projects: [testProject()] });
    await page.locator('input[data-wbs-progress="num"][data-id="task-F"]').fill("10");
    await page.locator('input[data-wbs-progress="num"][data-id="task-F"]').dispatchEvent("change");
    await page.waitForTimeout(200);
    const s9 = await stateNow(page);
    check("分子=分母でcompletedになる", s9.tasks.find((t) => t.id === "task-F")?.status === "completed", JSON.stringify(s9.tasks));

    console.log("[10] 分子0の未完了Taskは従来どおり未着手(todo)表示のまま");
    await seed(page, { tasks: [wbsTask("task-G", "未着手Task", { progressNum: 0, progressDen: 10 })], projects: [testProject()] });
    check("分子0はtodo(未着手)のまま", (await stateNow(page)).tasks.find((t) => t.id === "task-G")?.status === "todo");
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
