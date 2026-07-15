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
//
// 進捗↔ステータス双方向連動(K指示 2026-07-15追加)のシナリオ(g)〜(j)は本ファイル後半に続く。
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

  const TODAY = "2026-07-15";
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
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, tasks, projects, TODAY, view });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function stateNow(page) {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
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
    await page.click('[data-action="nav"][data-view="home"]');
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
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
