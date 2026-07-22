// v137 検証: review.md未対応指摘のラウンド1(小型のUX・品質修正、K承認済み2026-07-22)。
// CHANGES_v137.md参照。1・2・3・5を検証する(4=tests/run-all.jsのプロセスツリーcleanupは
// テストランナー自体の変更のため、本ファイルの対象外。手元でtaskkill /Tによる孫プロセス
// 巻き込み終了を単体確認済み)。
//
// [1] review.md:28 — hydrateStaticMarkdownの新着renderは、フォーカスが入力系要素にある間・
//     IME変換中は延期し、フォーカス離脱時に実行する(renderDeferringForFocus/
//     attemptFlushDeferredRender)。v140(Codexレビュー Med-2): compositionend時点でも
//     フォーカスがまだ入力欄に残っていれば延期を継続し、focusoutまで待つ(仕様精緻化)。
// [2] review.md:29 — AIレポート本文の取得失敗を空文字で成功キャッシュしない(リトライ可能)。
//     連打防止のクールダウンはあるが、「一覧を更新」ボタンは常にクールダウンを無視して
//     表示中ファイルの本文キャッシュをinvalidateし再取得する。
// [3] review.md:30 — Wish詳細textarea(.wish-detail .textarea)のcomputed font-sizeが16px以上。
// [5] review.md:39 — conditionBudgetがsleepHに数値文字列(非正規state)を渡されてもTypeErrorに
//     ならず、Number()経由で正しく判定する(hr/hrvの暗黙変換との非対称を解消)。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const API_HOST = "api.github.com";

let failures = 0;
let pageErrorCount = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; pageErrorCount++; console.log("  ❌ pageerror:", e.message); });

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

  // ---- 共通モック状態(可変。各セクションで書き換える) ----
  let feedbackFixture = {};   // { 'YYYY-MM-DD': mdText } — AIフィードバック_*.md
  let visionFixture = "";     // content/Vision.md 本文("" = 404扱い)
  let aiDirList = null;       // AIレポート taskchute/ 直下一覧(null = 404扱い)
  let aiBodyAttempts = 0;     // コンテンツ総括_*.md への本文GET試行回数

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
    if (p.endsWith("/contents/taskchute/content/Vision.md")) {
      if (!visionFixture) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      return route.fulfill({ status: 200, contentType: "text/markdown", body: visionFixture });
    }
    if (/\/contents\/taskchute$/.test(p)) {
      if (!aiDirList) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(aiDirList) });
    }
    const reportMatch = p.match(/\/contents\/taskchute\/(コンテンツ総括_.+\.md)$/);
    if (reportMatch) {
      aiBodyAttempts++;
      if (aiBodyAttempts === 1) return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", body: "# 総括本文_v137\n\n最新の内容。" });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  async function seed({ tasks = [], projects, view = "home", sleepLogs = {} } = {}) {
    await page.evaluate(({ KEY, tasks, projects, view, sleepLogs, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = tasks;
      if (projects !== undefined) s.projects = projects;
      s.selectedDate = TODAY;
      s.currentView = view;
      s.feedback = {};
      s.feedbackFiles = [];
      s.feedbackIngestedDates = [];
      s.sleep = s.sleep || { logs: {} };
      s.sleep.logs = sleepLogs;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, tasks, projects, view, sleepLogs, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [1] review.md:28 — 入力中/IME変換中はhydrateStaticMarkdownの新着renderを延期する
    // ============================================================
    console.log("[1-a] journalの入力中にhydrateStaticMarkdownの新着(前日AIフィードバック)が来ても、フォーカス中はrenderを延期する");
    feedbackFixture = {};  // 起動時点ではまだ前日分なし
    await seed({ view: "journal" });
    check("起動直後は前日フィードバックのdetailsが出ていない", await page.locator(".journal-yesterday-feedback").count() === 0);

    const journalTextarea = page.locator(`[data-journal-date="${TODAY}"]`);
    await journalTextarea.click();
    await journalTextarea.pressSequentially("編集中の下書き_v137");
    await page.evaluate(() => document.activeElement.setAttribute("data-test-marker", "still-focused-v137"));

    // 前日分のバッチが新規pushされた想定で内容を用意し、60秒スロットルを超えさせてから復帰イベントを送る
    feedbackFixture[YEST] = "# AIフィードバック本文_v137\n\n新着フィードバック本文_v137\n";
    await page.clock.setFixedTime(new Date(now0.getTime() + 5 * 60 * 1000));
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(600);

    const markerStillThereWhileFocused = await page.evaluate(() =>
      document.activeElement && document.activeElement.getAttribute("data-test-marker") === "still-focused-v137");
    check("フォーカス中はDOMが再構築されず、フォーカスもテキストも維持される(render延期)", markerStillThereWhileFocused);
    const inputValueAfterDefer = await journalTextarea.inputValue();
    check("入力中の文字は消えない", inputValueAfterDefer.includes("編集中の下書き_v137"), `(実際: ${JSON.stringify(inputValueAfterDefer)})`);
    check("フォーカス中はまだ新着フィードバックが画面に反映されていない(保留中)",
      await page.locator(".journal-yesterday-feedback").count() === 0);

    console.log("[1-b] フォーカスが外れると、保留していたrenderが1回だけ実行され新着が反映される");
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.waitForTimeout(400);
    const afterBlurText = await page.locator("main").textContent();
    check("フォーカス離脱後は新着フィードバックが反映される", afterBlurText.includes("新着フィードバック本文_v137"), afterBlurText.slice(0, 200));

    console.log("[1-c] IME変換中も同様にrenderを延期し、compositionend後もフォーカスが残っていれば延期を継続、focusoutで反映される(v140仕様精緻化)");
    await journalTextarea.click();
    await journalTextarea.pressSequentially("追記");
    await page.evaluate(() => {
      document.activeElement.setAttribute("data-test-marker", "still-composing-v137");
      document.activeElement.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    });
    visionFixture = "# Vision_v137\n\nIME変換中トリガー用の新着本文。";
    // maybeRefreshFeedbackの最短間隔(60秒)ガードを超えさせてから復帰イベントを送る
    // (直前の1-aでのhydrate呼び出しから60秒未満だと何もfetchされず、そもそもrenderの
    // 延期自体が発生しない=偽陽性のPASSになってしまうため)
    await page.clock.setFixedTime(new Date(now0.getTime() + 11 * 60 * 1000));
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));  // visibilityStateは既にvisibleのまま
    });
    await page.waitForTimeout(600);
    const markerStillThereWhileComposing = await page.evaluate(() =>
      document.activeElement && document.activeElement.getAttribute("data-test-marker") === "still-composing-v137");
    check("IME変換中もDOMが再構築されず、フォーカスが維持される(render延期)", markerStillThereWhileComposing);

    await page.evaluate(() => document.activeElement.dispatchEvent(new Event("compositionend", { bubbles: true })));
    await page.waitForTimeout(400);
    // v140(Codexレビュー Med-2、仕様精緻化): compositionend時にフォーカスがまだ入力欄に
    // 残っている場合は、IME確定直後に続けて入力するのが通例のため、v137時点の「即render」から
    // 「延期を継続してfocusoutを待つ」へ変更した(未確定文字消失というv137の核心的リスクは
    // compositionendの時点で既に解消しているため、フォーカス/カーソル位置の保持を優先する)。
    const markerStillThereAfterCompositionEnd = await page.evaluate(() =>
      document.activeElement && document.activeElement.getAttribute("data-test-marker") === "still-composing-v137");
    check("v140: compositionend直後もフォーカスが入力欄に残っていれば延期を継続する", markerStillThereAfterCompositionEnd);

    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.waitForTimeout(400);
    const markerGoneAfterComposition = await page.evaluate(() =>
      !document.activeElement || document.activeElement.getAttribute("data-test-marker") !== "still-composing-v137");
    check("v140: その後フォーカスが外れる(focusout)と保留していたrenderが実行される(DOMが再構築される)", markerGoneAfterComposition);

    // ============================================================
    // [2] review.md:29 — AIレポート本文の取得失敗は成功キャッシュしない(リトライ可能)。
    //     「一覧を更新」は表示中ファイルの本文キャッシュを必ずinvalidateして再取得する。
    // ============================================================
    console.log("[2] AIレポート本文の一時取得失敗は空文字でcacheされず、「一覧を更新」で確実に再取得できる");
    aiDirList = [{ name: "コンテンツ総括_2026-07-01.md", path: "taskchute/コンテンツ総括_2026-07-01.md", type: "file" }];
    aiBodyAttempts = 0;
    await seed({ view: "ai-reports" });
    await page.waitForTimeout(500);
    check("初回の本文取得(失敗)が1回飛んでいる", aiBodyAttempts === 1, `(実際: ${aiBodyAttempts})`);
    let mainText2 = await page.locator("main").textContent();
    check("失敗した本文が空文字のまま表示され続けたりしない(内容が出ていない)", !mainText2.includes("総括本文_v137"), mainText2.slice(0, 200));

    await page.click('[data-action="ai-report-refresh"]');
    await page.waitForTimeout(600);
    check("「一覧を更新」で本文が再取得される(2回目の試行が飛ぶ)", aiBodyAttempts === 2, `(実際: ${aiBodyAttempts})`);
    mainText2 = await page.locator("main").textContent();
    check("再取得後は正しい本文が表示される", mainText2.includes("総括本文_v137"), mainText2.slice(0, 200));

    // ============================================================
    // [3] review.md:30 — Wish詳細textareaのcomputed font-sizeが16px以上
    // ============================================================
    console.log("[3] Wish詳細のtextarea(なぜやりたい)のcomputed font-sizeが16px以上");
    const wishProjectId = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const wp = (s.projects || []).find((p) => p.kind === "wish" && !p.deleted);
      return wp ? wp.id : null;
    }, KEY);
    check("Wish Projectが既定で存在する(normalizeState)", !!wishProjectId);
    await seed({
      view: "wish",
      tasks: [{
        id: "wish-font-v137", projectId: wishProjectId, parentTaskId: "", title: "フォントサイズ確認用Wish",
        category: "", status: "todo", dueDate: "", description: "", lifeArea: "", motivation: "",
        targetYear: null, targetMonth: null, realized: false, realizedDate: "",
        createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
      }]
    });
    await page.click('[data-action="open-wish"][data-id="wish-font-v137"]');
    await page.waitForTimeout(300);
    const motivationTextarea = page.locator('[data-action="wish-set-motivation"][data-id="wish-font-v137"]');
    check("Wish詳細のtextareaが表示されている", await motivationTextarea.count() === 1);
    const fontSizePx = await motivationTextarea.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    check("computed font-sizeが16px以上(iOS自動ズーム防止)", fontSizePx >= 16, `(実際: ${fontSizePx}px)`);

    // ============================================================
    // [4](review.md:39) — conditionBudgetがsleepHの数値文字列でTypeErrorにならない
    // ============================================================
    console.log("[4] sleepHが数値文字列の非正規stateでもconditionBudgetがTypeErrorを起こさず正しく判定する");
    const pageErrorsBefore4 = pageErrorCount;
    await seed({ view: "home", sleepLogs: { [TODAY]: { sleepH: "4.5" } } });  // 文字列(非正規state)。5.5h未満=赤字想定
    await page.waitForTimeout(300);
    const chipText = await page.locator(".home-condition-budget-chip").textContent().catch(() => null);
    check("pageerror(TypeError)が発生していない", pageErrorCount === pageErrorsBefore4, `(発生件数: ${pageErrorCount - pageErrorsBefore4})`);
    check("体力予算チップが表示される", !!chipText, chipText);
    check("睡眠4.5hが赤字判定として表示される(toFixed(1)がNumber経由で成功している)",
      !!chipText && chipText.includes("赤字") && chipText.includes("睡眠4.5h"), chipText);

    console.log("[4-回帰] sleepHが数値(通常state)でも従来どおり動く");
    await seed({ view: "home", sleepLogs: { [TODAY]: { sleepH: 7.2 } } });  // 7.2h → 通常
    await page.waitForTimeout(300);
    const chipText2 = await page.locator(".home-condition-budget-chip").textContent().catch(() => null);
    check("数値型のsleepHでも従来どおり通常判定される", !!chipText2 && chipText2.includes("通常"), chipText2);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
