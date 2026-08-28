// v133 検証: 2つの独立した小修正(K承認済み、2026-07-21)。CHANGES_v133.md参照。
//
// 修正1: AI提案タスクの自動登録を廃止し、追加ボタン式(候補+ワンタップ採用)に戻す。
//   autoIngestFeedback は「明日への提案」からのタスク候補をもう state.tasks へ直接pushしない。
//   aiMitChips/adoptAiMit と同じ設計思想(journalMeta[date].aiTaskCandidates へ溜めておき、
//   タスクシュート上部のチップの「＋」タップで初めて実体化)へ回帰した。既存挙動との回帰確認は
//   tests/v86.test.js を更新して行っている(本ファイルはチップUI自体の動作確認に専念する)。
//
// 修正2: Wishプロジェクト配下タスクの期日を常にNULLにする。
//   makeTask() の「呼び出し元が明示的にdueDateを渡した場合はそれを尊重してしまう」抜け道
//   (isWishProject ? "" : (dueDate || ...) ではなく dueDate || (isWishProject ? "" : ...) だった
//   ため、真値のdueDateが素通りしていた)を閉じた。
//
// スコープについての重要な注記(実装者から): 依頼書の修正2には(b)作成後の編集(タスク編集
// モーダルの期日入力)を塞ぐ実装と、(c)normalizeStateでの既存データの無条件上書きクレンジング
// も含まれていたが、コード調査の結果、Wishプロジェクト配下タスクのdueDateには
// v79で導入された「期限(任意。週次レビューで参照)」という別の意図的な機能
// (data-action="wish-set-duedate"、app.js:5103/1006)が既に存在し、v126では
// 「期日付きWishは通常タスクと同列に扱う」設計(aiScheduleCandidates/homeBacklog/
// renderOpenTasksがdueDate付きWishだけを候補に含める、app.js:3676,3369-3370,5754-5756)
// まで組まれていることが分かった。(b)(c)を文字通り実装すると、この既存の意図的な機能を
// 破壊し、週次レビュー・AI朝プラン候補・未完了タスク一覧からWishが一切出なくなる回帰になる。
// このコンフリクトは依頼書からは読み取れず(「抜け道」という表現からは意図的な機能とは
// 認識されていないように見える)、勝手に判断して機能を壊すのは危険と判断し、(a)=makeTask()の
// 修正のみを実装して(b)(c)は保留した。詳細は完了報告を参照。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, dispatchRegisteredAction } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const API_HOST = "api.github.com";

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

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const addDaysStr = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return isoDate(date);
  };
  const YEST = addDaysStr(TODAY, -1);

  // ---- AIフィードバック_*.md のfixture(route経由で応答)。
  let feedbackFixture = {};
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const u = new URL(route.request().url());
    const p = decodeURIComponent(u.pathname);
    const fbMatch = p.match(/\/contents\/taskchute\/AIフィードバック_(.+)\.md$/);
    if (fbMatch) {
      const body = feedbackFixture[fbMatch[1]];
      if (!body) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      return route.fulfill({ status: 200, contentType: "text/markdown", body });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  function wishProject(id = "wish-proj-v133") {
    return {
      id, kind: "wish", title: "Wish", category: "回復", status: "active",
      twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }
  function normalProject(id = "normal-proj-v133") {
    return {
      id, kind: "normal", title: "テスト案件_v133", category: "", status: "active",
      description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
      deleted: false, collapsed: false
    };
  }

  async function seed({ tasks = [], projects = [], view = "tasks", feedbackIngestedDates = [], feedbackFiles = [], journalMeta } = {}) {
    await page.evaluate(({ KEY, tasks, projects, view, feedbackIngestedDates, feedbackFiles, journalMeta, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = tasks;
      s.projects = projects;
      s.selectedDate = TODAY;
      s.currentView = view;
      s.feedback = {};
      s.feedbackIngestedDates = feedbackIngestedDates;
      s.feedbackFiles = feedbackFiles;
      if (journalMeta !== undefined) s.journalMeta = journalMeta;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, tasks, projects, view, feedbackIngestedDates, feedbackFiles, journalMeta, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function readState() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // 修正1(a): autoIngestFeedback → 候補state化。残存action本体による採用・却下も維持する
    // ============================================================
    console.log("[1] AIフィードバックの「明日への提案」は候補stateへ入り、直接state.tasksには入らない");
    feedbackFixture = { [YEST]: "# AIフィードバック本文_v133\n\n## 明日への提案\n\n- [ ] AI候補タスク_v133: 理由の説明\n" };
    await seed({ tasks: [], projects: [], view: "today" });
    const s1 = await readState();
    check("state.tasksへ直接登録されない", !(s1.tasks || []).some((t) => t.title === "AI候補タスク_v133"), JSON.stringify(s1.tasks));
    check("journalMeta[前日].aiTaskCandidatesへ候補として登録される",
      (s1.journalMeta?.[YEST]?.aiTaskCandidates || []).includes("AI候補タスク_v133"), JSON.stringify(s1.journalMeta?.[YEST]));
    check("候補stateはfixture由来の1件だけ", (s1.journalMeta?.[YEST]?.aiTaskCandidates || []).length === 1, JSON.stringify(s1.journalMeta?.[YEST]));
    check("候補の採用・却下UIは描画しない",
      await page.locator('[data-action="ai-task-adopt"], [data-action="ai-task-dismiss"]').count() === 0);

    console.log("[2] 残存採用action本体でタスクが作成され(dueDate=今日)、候補が消える");
    await dispatchRegisteredAction(page, "ai-task-adopt", { index: "0" });
    await page.waitForTimeout(300);
    const s2 = await readState();
    const adopted = (s2.tasks || []).find((t) => t.title === "AI候補タスク_v133");
    check("採用したタスクがstate.tasksへ作成される", !!adopted, JSON.stringify(adopted));
    check("採用したタスクのdueDateは今日", !!adopted && adopted.dueDate === TODAY, JSON.stringify(adopted));
    check("採用後は候補配列から消える", !(s2.journalMeta?.[YEST]?.aiTaskCandidates || []).includes("AI候補タスク_v133"), JSON.stringify(s2.journalMeta?.[YEST]));
    check("採用UIは画面へ復活しない", await page.locator('[data-action="ai-task-adopt"]').count() === 0);

    console.log("[3] 残存却下action本体では候補が消えるだけでタスクは作られない");
    feedbackFixture = {};  // 以降のseed()のreloadでtest[1]のfixtureが再ingestされないようクリア
    await seed({
      tasks: [], projects: [], view: "today",
      journalMeta: { [YEST]: { aiMitCandidates: [], aiImported: false, ideal: "", aiTaskCandidates: ["却下候補_v133"] } }
    });
    check("却下前も候補UIは表示しない", await page.locator('[data-action="ai-task-dismiss"]').count() === 0);
    await dispatchRegisteredAction(page, "ai-task-dismiss", { index: "0" });
    await page.waitForTimeout(300);
    const s3 = await readState();
    check("却下してもタスクは作られない", !(s3.tasks || []).some((t) => t.title === "却下候補_v133"), JSON.stringify(s3.tasks));
    check("候補配列からも消える", !(s3.journalMeta?.[YEST]?.aiTaskCandidates || []).includes("却下候補_v133"), JSON.stringify(s3.journalMeta?.[YEST]));
    check("却下UIは画面へ復活しない", await page.locator('[data-action="ai-task-dismiss"]').count() === 0);

    // ============================================================
    // 修正2(a): makeTask() — Wish配下は明示的なdueDate引数も無視して常に空にする
    // ============================================================
    console.log("[4] Wishプロジェクト配下でタスクを新規作成し、期日入力欄に値を入れて保存しても dueDate が空になる");
    await seed({ tasks: [], projects: [wishProject()], view: "wbs" });
    await page.click('[data-action="add-task-to-project"][data-id="wish-proj-v133"]');
    await page.waitForTimeout(200);
    await page.fill('[data-modal-field="title"]', "Wishタスク_期日テスト_v133");
    await page.fill('[data-modal-field="dueDate"]', addDaysStr(TODAY, 5));
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s4 = await readState();
    const wishTask = (s4.tasks || []).find((t) => t.title === "Wishタスク_期日テスト_v133");
    check("Wish配下タスクが作成される", !!wishTask, JSON.stringify(wishTask));
    check("期日入力欄に値を入れて保存してもdueDateは空文字になる(明示的な引数も無視)",
      !!wishTask && wishTask.dueDate === "", JSON.stringify(wishTask));

    console.log("[5] 回帰: 通常Project配下のタスクは従来どおり明示的なdueDateがそのまま保存される");
    await seed({ tasks: [], projects: [normalProject()], view: "wbs" });
    await page.click('[data-action="add-task-to-project"][data-id="normal-proj-v133"]');
    await page.waitForTimeout(200);
    await page.fill('[data-modal-field="title"]', "通常タスク_期日テスト_v133");
    const futureDate = addDaysStr(TODAY, 5);
    await page.fill('[data-modal-field="dueDate"]', futureDate);
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s5 = await readState();
    const normalTask = (s5.tasks || []).find((t) => t.title === "通常タスク_期日テスト_v133");
    check("通常Project配下は明示的なdueDateがそのまま保存される(Wish以外は無変更の回帰確認)",
      !!normalTask && normalTask.dueDate === futureDate, JSON.stringify(normalTask));

    // ============================================================
    // normalizeState 後方互換: journalMeta.aiTaskCandidates の補完
    // ============================================================
    console.log("[6] normalizeState 後方互換: journalMeta に aiTaskCandidates が無い旧データでも補完される");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.journalMeta = { [TODAY]: { aiMitCandidates: [], aiImported: false, ideal: "" } };  // aiTaskCandidatesフィールドなし
      s.tasks = [];
      s.projects = [];
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('[data-action="nav"][data-view="today"]');  // v230: home撤去後の現行view
    await page.waitForTimeout(300);
    const s6 = await readState();
    check("aiTaskCandidatesが空配列で補完される", Array.isArray(s6.journalMeta?.[TODAY]?.aiTaskCandidates) && s6.journalMeta[TODAY].aiTaskCandidates.length === 0,
      JSON.stringify(s6.journalMeta?.[TODAY]));
    check("既存データはクラッシュせず表示できる(pageerror無し)", true);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
