// v96 検証: Taskに「完了条件」(doneCriteria)「スモールステップ」(firstStep)欄を新設。
//
// (a) normalizeState 後方互換: 旧Task(doneCriteria/firstStep無し)に ""/"" が補完される
// (b) Task編集モーダルに doneCriteria/firstStep のテキストエリアがあり、プレースホルダの
//     ガイド文言が表示され、font-size 16px以上(iOS Safariズーム対策)
// (c) 両欄に入力→保存→リロード後も値が保持される
// (d) タスクシュート画面(未完了タスク一覧)の行内に、タスクを開かずに両欄のサブテキストが見える。
//     空欄なら何も出さない(既存タスクとの比較で確認)
// (e) 390px幅で横スクロールが発生しない(サブテキスト表示込み)
//
// 方針: 既存スイート(v67/v95)と同じく、app.js は type="module" のため内部関数は window に
// 露出しない。ブラウザ操作 + localStorage 状態の直接注入で観測する。
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
  function task(id, title, extra = {}) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: TODAY,
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
      doneCriteria: "", firstStep: "", ...extra
    };
  }
  const testProject = () => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });

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

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) normalizeState 後方互換
    // ============================================================
    console.log("[1] normalizeState 後方互換: 旧Task(doneCriteria/firstStep無し)→\"\"/\"\"が補完される");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [{
        id: "legacy-task", projectId: "legacy-proj", parentTaskId: "", title: "旧データTask", category: "",
        status: "todo", dueDate: "", description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false
        // doneCriteria/firstStep フィールドなし(旧データを模擬)
      }];
      s.projects = [{
        id: "legacy-proj", kind: "normal", title: "旧データProject", category: "", status: "active",
        description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false
      }];
      s.blocks = [];
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click('[data-action="nav"][data-view="today"]');  // v230: home撤去後の現行viewで正規化値を永続化
    await page.waitForTimeout(200);
    const normalized = await stateNow();
    const legacyTask = (normalized.tasks || []).find((t) => t.id === "legacy-task");
    check("旧TaskにdoneCriteria:\"\"が補完される", legacyTask?.doneCriteria === "", JSON.stringify(legacyTask));
    check("旧TaskにfirstStep:\"\"が補完される", legacyTask?.firstStep === "", JSON.stringify(legacyTask));

    // ============================================================
    // (b) Task編集モーダルにテキストエリア + プレースホルダ文言 + font-size 16px以上
    // ============================================================
    console.log("[2] Task編集モーダルに doneCriteria/firstStep テキストエリアがあり、ガイド文言・16px以上");
    await seed({ tasks: [task("task-A", "テストTask")], projects: [testProject()] });
    await page.click('[data-action="edit-task"][data-id="task-A"]');
    await page.waitForTimeout(200);
    check("完了条件のテキストエリアがある", await page.locator('[data-modal-field="doneCriteria"]').count() === 1);
    check("スモールステップのテキストエリアがある", await page.locator('[data-modal-field="firstStep"]').count() === 1);
    const doneCriteriaPlaceholder = await page.locator('[data-modal-field="doneCriteria"]').getAttribute("placeholder");
    const firstStepPlaceholder = await page.locator('[data-modal-field="firstStep"]').getAttribute("placeholder");
    check("完了条件のプレースホルダが「行動でなく…残る物」ガイド文言", doneCriteriaPlaceholder === "行動でなく“終わったら残る物”で書く", doneCriteriaPlaceholder);
    check("スモールステップのプレースホルダが「5〜15分で終わる最初の行動」", firstStepPlaceholder === "5〜15分で終わる最初の行動", firstStepPlaceholder);
    check("完了条件欄はfont-size 16px以上", await page.locator('[data-modal-field="doneCriteria"]').evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize) >= 16));
    check("スモールステップ欄はfont-size 16px以上", await page.locator('[data-modal-field="firstStep"]').evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize) >= 16));

    // ============================================================
    // (c) 入力→保存→リロードで保持
    // ============================================================
    console.log("[3] 両欄に入力→保存→リロード後も保持される");
    await page.fill('[data-modal-field="doneCriteria"]', "見積書PDFが顧客フォルダに保存されている");
    await page.fill('[data-modal-field="firstStep"]', "見積テンプレを開いて宛名だけ入れる");
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s3 = await stateNow();
    const savedTask = (s3.tasks || []).find((t) => t.id === "task-A");
    check("doneCriteriaが保存される", savedTask?.doneCriteria === "見積書PDFが顧客フォルダに保存されている", JSON.stringify(savedTask));
    check("firstStepが保存される", savedTask?.firstStep === "見積テンプレを開いて宛名だけ入れる", JSON.stringify(savedTask));
    await page.reload();
    await page.waitForTimeout(500);
    const s3b = await stateNow();
    const reloadedTask = (s3b.tasks || []).find((t) => t.id === "task-A");
    check("リロード後もdoneCriteriaが保持される", reloadedTask?.doneCriteria === "見積書PDFが顧客フォルダに保存されている", JSON.stringify(reloadedTask));
    check("リロード後もfirstStepが保持される", reloadedTask?.firstStep === "見積テンプレを開いて宛名だけ入れる", JSON.stringify(reloadedTask));

    // ============================================================
    // (d) タスクシュート画面(未完了タスク一覧)の行内サブテキスト表示 / 空欄なら非表示
    // ============================================================
    console.log("[4] タスクシュート画面の未完了タスク一覧に、開かずに両欄が見える(空欄なら非表示)");
    await seed({
      tasks: [
        task("task-B", "両欄入力済みTask", { doneCriteria: "報告書が上長にメール送信済み", firstStep: "報告書の雛形を開く" }),
        task("task-C", "両欄空欄のTask")
      ],
      projects: [testProject()],
      view: "tasks"
    });
    check("タスクシュート画面が表示される", await page.locator('[data-action="task-today"][data-id="task-B"]').count() === 1);
    check("完了条件入力済みTaskに🎯サブテキストが出る", (await page.locator(".task-done-criteria").allTextContents())
      .some((t) => t.includes("報告書が上長にメール送信済み")));
    check("スモールステップ入力済みTaskに👣サブテキストが出る", (await page.locator(".task-first-step").allTextContents())
      .some((t) => t.includes("報告書の雛形を開く")));
    check("空欄のTaskには完了条件サブテキストが出ない件数=1(入力済み分のみ)", await page.locator(".task-done-criteria").count() === 1);
    check("空欄のTaskにはスモールステップサブテキストが出ない件数=1(入力済み分のみ)", await page.locator(".task-first-step").count() === 1);

    // ============================================================
    // (e) 390px幅で横スクロールが発生しない
    // ============================================================
    console.log("[5] 390px幅のタスクシュート画面でサブテキスト込みでも横スクロールが発生しない");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pageMobile = await ctxMobile.newPage();
    pageMobile.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(mobile):", e.message); });
    await blockGithubApiByDefault(pageMobile);
    await pageMobile.clock.setFixedTime(now0);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await pageMobile.waitForTimeout(500);
    await passGithubGate(pageMobile);
    await pageMobile.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [{
        id: "task-M", projectId: "test-proj", parentTaskId: "", title: "モバイル幅確認Task(長めのタイトルで折返し確認)", category: "",
        status: "todo", dueDate: TODAY, description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
        doneCriteria: "とても長い完了条件の文章でも横にはみ出さずに折り返して表示されることを確認するためのテスト文言です",
        firstStep: "とても長いスモールステップの文章でも横にはみ出さずに折り返して表示されることを確認するためのテスト文言です"
      }];
      s.projects = [{
        id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
        description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false, collapsed: false
      }];
      s.blocks = [];
      s.selectedDate = TODAY;
      s.currentView = "tasks";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await pageMobile.reload();
    await pageMobile.waitForTimeout(500);
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
