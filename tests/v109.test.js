// v109 検証: WBSタブ画面上部のカテゴリ絞り込みプルダウン(K依頼、2026-07-16)。
//
// 背景: WBSタブのProjectが増えたため、Project.category(既存フィールド。v9のカテゴリマスタを
// 使ってProject/Task/Blockに横断で付与できる)を使って、WBS上部のプルダウンでProjectを
// カテゴリごとに絞り込み表示できるようにした。project.categoryは既存フィールドのため新規
// マイグレーションは不要(addProjectで既定""、renderProjectTree/編集モーダルで既に使用中)。
// プルダウンの選択肢は実在するProjectのcategoryから動的生成し、category未設定のProjectは
// 「未分類」として選択肢にもフィルタ結果にも含める(絞り込みで消えて見つからなくなる事故防止)。
// 選択状態はstate.settings.wbsCategoryFilter(既定""=すべて)に永続化する(wbsHideCompleted等の
// 既存UI状態と同じ流儀)。
//
// (a) プルダウンでカテゴリを選択→そのカテゴリのProjectのみ表示される
// (b) 「すべて」を選択→全Projectが表示される
// (c) category未設定のProjectは「未分類」として選択肢に出て、選択すると該当Projectのみ表示される
// (d) 絞り込み中もタスク操作(完了チェック・進捗の分子/分母入力)が正常に動作する
// (e) 390px幅でプルダウンが表示され、横スクロールが発生しない
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
  // v108/v109と同じ流儀: 実時刻依存フレークを避けるためTODAYは実行時の「今日」10:00に固定する
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;

  function makeProject(id, title, category) {
    return {
      id, kind: "normal", title, category, status: "active", priority: "中",
      description: "", dueDate: "", twelveWeekStartDate: "",
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
      collapsed: false, showProgress: false
    };
  }
  function makeTask(id, projectId, title) {
    return {
      id, projectId, parentTaskId: "", title, category: "", status: "todo", dueDate: "",
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
      progressNum: 0, progressDen: 10, doneCriteria: "", firstStep: ""
    };
  }

  const PROJECTS = [
    makeProject("proj-manabi", "学びプロジェクト", "学び"),
    makeProject("proj-work", "仕事プロジェクト", "仕事"),
    makeProject("proj-none", "未分類プロジェクト", "")
  ];
  const TASKS = [
    makeTask("task-manabi", "proj-manabi", "学びタスク1"),
    makeTask("task-work", "proj-work", "仕事タスク1"),
    makeTask("task-none", "proj-none", "未分類タスク1")
  ];

  async function seed({ projects = PROJECTS, tasks = TASKS } = {}) {
    await page.evaluate(({ KEY, projects, tasks, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.projects = projects;
      s.tasks = tasks;
      s.blocks = [];
      s.selectedDate = TODAY;
      s.currentView = "wbs";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, projects, tasks, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  function projectTitleLocator(page_) {
    return page_.locator('.item strong[data-action="edit-project"]');
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    await seed();
    await page.click('[data-action="nav"][data-view="wbs"]');
    await page.waitForTimeout(200);

    // ============================================================
    // 選択肢の動的生成 & 既定値の確認
    // ============================================================
    console.log("[0] プルダウンの選択肢は実在するProjectのcategoryから動的生成される(ハードコードでない)");
    const filterSelect = page.locator('select[data-action="wbs-category-filter"]');
    check("プルダウンが画面上部に表示される", await filterSelect.count() === 1);
    const optionTexts = await filterSelect.locator("option").allTextContents();
    // v126: Wish Project(category「回復」)もWBSに表示されるようになったため選択肢+1(CHANGES_v126.md)
    check("選択肢は「すべて/回復/学び/仕事/未分類」の5件(順不同判定)",
      optionTexts.length === 5 && ["すべて", "回復", "学び", "仕事", "未分類"].every((t) => optionTexts.includes(t)),
      JSON.stringify(optionTexts));
    check("既定の選択値は「すべて」", await filterSelect.inputValue() === "");
    // v28: normalizeStateがcategory未設定の「その他」Projectを常に1件保証するため、
    // 種分けした3件+「その他」=4件になる(既存仕様、絞り込み機能の対象外にはしない)
    check("既定表示では全5件のProjectが表示される(自動生成の「その他」とWish Project含む。v126)", await projectTitleLocator(page).count() === 5);

    // ============================================================
    // (a) カテゴリ選択→該当Projectのみ表示
    // ============================================================
    console.log("[1] 「学び」を選択→学びプロジェクトのみ表示される");
    await filterSelect.selectOption("学び");
    await page.waitForTimeout(200);
    const titlesManabi = await projectTitleLocator(page).allTextContents();
    check("「学び」選択時は学びプロジェクトのみ表示", JSON.stringify(titlesManabi) === JSON.stringify(["学びプロジェクト"]), JSON.stringify(titlesManabi));
    check("選択状態がstateに永続化される(wbsCategoryFilter)", (await stateNow()).settings.wbsCategoryFilter === "学び");
    // リロードしても選択状態が保持される(永続化の確認)
    await page.reload();
    await page.waitForTimeout(400);
    check("リロード後も絞り込みが維持される", await filterSelect.inputValue() === "学び");
    const titlesAfterReload = await projectTitleLocator(page).allTextContents();
    check("リロード後も学びプロジェクトのみ表示", JSON.stringify(titlesAfterReload) === JSON.stringify(["学びプロジェクト"]), JSON.stringify(titlesAfterReload));

    // ============================================================
    // (b) 「すべて」で全件表示に戻る
    // ============================================================
    console.log("[2] 「すべて」を選択→全Projectが表示される");
    await filterSelect.selectOption("");
    await page.waitForTimeout(200);
    check("「すべて」選択時は全5件表示(v126でWish Project追加)", await projectTitleLocator(page).count() === 5);
    check("wbsCategoryFilterは空文字に戻る", (await stateNow()).settings.wbsCategoryFilter === "");

    // ============================================================
    // (c) 未分類の扱い(category未設定のProjectに加え、自動生成の「その他」Projectも含む)
    // ============================================================
    console.log("[3] 「未分類」を選択→category未設定のProject(「未分類プロジェクト」と自動生成「その他」)のみ表示される");
    await filterSelect.selectOption("未分類");
    await page.waitForTimeout(200);
    const titlesNone = await projectTitleLocator(page).allTextContents();
    check("「未分類」選択時はcategory未設定の2件のみ表示", JSON.stringify(titlesNone) === JSON.stringify(["その他", "未分類プロジェクト"]), JSON.stringify(titlesNone));

    // ============================================================
    // (d) 絞り込み中もタスク操作(完了チェック・進捗入力)が正常に動く
    // ============================================================
    console.log("[4] 絞り込み中(未分類)でもタスクの完了チェック・進捗の分子/分母入力が正常に動作する");
    await page.click('[data-action="toggle-task"][data-id="task-none"]');
    await page.waitForTimeout(300);
    let s4 = await stateNow();
    check("絞り込み中でもタスク完了チェックが反映される", s4.tasks.find((t) => t.id === "task-none")?.status === "completed", JSON.stringify(s4.tasks));
    check("完了操作後も絞り込み状態(未分類)は維持される", s4.settings.wbsCategoryFilter === "未分類");
    check("完了操作後も未分類の2件のみ表示のまま", await projectTitleLocator(page).count() === 2);

    // 完了を隠すトグルで一覧から消えるため、進捗入力の検証は別カテゴリの未完了タスクで行う
    await filterSelect.selectOption("仕事");
    await page.waitForTimeout(200);
    const numInput = page.locator('input[data-wbs-progress="num"][data-id="task-work"]');
    await numInput.fill("7");
    await numInput.dispatchEvent("change");
    await page.waitForTimeout(300);
    const s5 = await stateNow();
    check("絞り込み中(仕事)でも進捗の分子入力が反映される", s5.tasks.find((t) => t.id === "task-work")?.progressNum === 7, JSON.stringify(s5.tasks));
    check("進捗入力後も絞り込み状態(仕事)は維持される", s5.settings.wbsCategoryFilter === "仕事");

    // ============================================================
    // (e) 390px幅でプルダウンが表示され、横スクロールが発生しない
    // ============================================================
    console.log("[5] 390px幅でプルダウンが表示され、横スクロールが発生しない");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pageMobile = await ctxMobile.newPage();
    pageMobile.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(mobile):", e.message); });
    await blockGithubApiByDefault(pageMobile);
    await pageMobile.clock.setFixedTime(now0);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await pageMobile.waitForTimeout(500);
    await passGithubGate(pageMobile);
    await pageMobile.evaluate(({ KEY, projects, tasks, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.projects = projects;
      s.tasks = tasks;
      s.blocks = [];
      s.selectedDate = TODAY;
      s.currentView = "wbs";
      s.settings.wbsCategoryFilter = "学び";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, projects: PROJECTS, tasks: TASKS, TODAY });
    await pageMobile.reload();
    await pageMobile.waitForTimeout(500);
    const filterSelectMobile = pageMobile.locator('select[data-action="wbs-category-filter"]');
    check("390px幅でプルダウンが表示される", await filterSelectMobile.count() === 1);
    check("390px幅でも絞り込みが効いている(学びプロジェクトのみ)", await projectTitleLocator(pageMobile).count() === 1);
    const fontSize = await filterSelectMobile.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    check("プルダウンのfont-sizeは16px以上(iOSズーム防止)", fontSize >= 16, `fontSize=${fontSize}`);
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
