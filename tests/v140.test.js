// v140 検証: 2系統レビュー(Claude reviewer=PASS軽微、Codexレビュー=High1+Med3+Low2)対応。
// CHANGES_v140.md参照。本ファイルはHigh-1(report-indexの鮮度・破損・手動更新)とMed-3
// (compositionend欠落時の永久延期フェイルセーフ)を検証する。Med-2はtests/v137.test.jsの
// 既存IMEシナリオを仕様精緻化に合わせて更新済み。Low-5/Low-6はtests/xss-sanitizer.test.js
// に追加済み。Med-4(並行run間のポート帯衝突回避)はrun-all.js単体の帯計算を手元で確認
// (帯選択が20000〜38000の1000刻み19通りから一様に選ばれること、TEST_PORT_BASE経由でスイート
// 側のrandomPort()が正しく基底を反映することを確認済み。ブラウザテストの対象ではないため
// 自動テストファイルには含めない)。
//
// [1] 破損index(files配列の要素が全てstring型nameを持たない)→ Contents APIへフォールバック
// [2] 古いindex(generatedAtが48時間超過)→ Contents APIへフォールバック
// [3] 手動「一覧を更新」時はindexとContents API listingの両方を取得し、name単位でunionする
// [4] Med-3: compositionendイベントが発火しなくても、focusoutで_imeComposingが無条件クリア
//     されてflushされる(フェイルセーフ)。60秒の強制flushタイムアウトも確認する。
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
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  // テストコード(Node.js側)でのfixture組み立てのみに使う。V8はnew Date(string)の解釈に
  // iOS Safariのような曖昧さが無いため、ここでのtoISOString()利用はapp.js側の
  // 「new Date(string)禁止」ルール(iOS Safari対策)の対象外(ブラウザ実行コードではない)。
  const toUtcIso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const freshGeneratedAt = toUtcIso(new Date(now0.getTime() - 1 * 60 * 60 * 1000));   // 1時間前(鮮度OK)
  const staleGeneratedAt = toUtcIso(new Date(now0.getTime() - 50 * 60 * 60 * 1000));  // 50時間前(48h超過)

  let reportIndexFixture = null;  // null=404
  let dirListFixture = [];
  const bodyRequests = [];
  let dirListRequests = 0;
  let reportIndexRequests = 0;

  await page.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute\/report-index\.json$/.test(decodeURIComponent(url.pathname)), (route) => {
    reportIndexRequests++;
    if (reportIndexFixture === null) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reportIndexFixture) });
  });
  await page.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute$/.test(url.pathname), (route) => {
    dirListRequests++;
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dirListFixture) });
  });
  await page.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute\/[^/]+$/.test(decodeURIComponent(url.pathname)) && !/report-index\.json$/.test(decodeURIComponent(url.pathname)), (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    const name = p.split("/").pop();
    bodyRequests.push(name);
    route.fulfill({ status: 200, contentType: "application/json", body: `# ${name}\n\n本文(${name})。` });
  });

  // v140フレーク修正(CI失敗2連続の根本原因対応): localStorageへのseedは、アプリJSが動いていない
  // 同一オリジンの静的ページ(/styles.css)上で行う。アプリページ上でevaluate→reloadすると、
  // 起動時のhydrateStaticMarkdown(app.js:16315)の非同期継続(このスイートの汎用200ルートが
  // 前日AIフィードバックにも本文を返すため、recordFeedbackFile→saveStateが必ず走る)が
  // seed書込〜reloadコミットの隙間に着弾し、在メモリstate(currentView="today"、v182の新既定)で
  // seedを丸ごと上書きする競合があった(→ ai-reportsが開かず report-index fetchが0回になる)。
  async function gotoAiReports() {
    await page.goto(`http://localhost:${PORT}/styles.css`);  // アプリJSを停止させてから書く
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "ai-reports";
      s.settings.aiReportType = "content";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.goto(`http://localhost:${PORT}/`);
    // 低速環境(CI)対策: 固定600ms待ちでは fetch→(フォールバック)→render が間に合わない
    // ことがあるため、日付セレクトにoptionが並ぶまで条件待ちに置換(このスイートの全シナリオで
    // 最終的にoptionは必ず1件以上になる)。
    await page.waitForFunction(() => document.querySelectorAll("[data-ai-report-date] option").length >= 1, null, { timeout: 15000 });
    await page.waitForTimeout(200);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [1] High-1(i): 破損index(files配列の要素がstring型nameを持たない)→ フォールバック
    // ============================================================
    console.log("[1] files配列が壊れているindex(有効な要素0件)は不採用にし、Contents APIへフォールバックする");
    reportIndexFixture = { generatedAt: freshGeneratedAt, files: [{ notName: "x" }, { name: 123 }, {}] };
    dirListFixture = [{ name: "コンテンツ総括_2026-07-10.md", path: "taskchute/コンテンツ総括_2026-07-10.md", type: "file" }];
    reportIndexRequests = 0; dirListRequests = 0;
    await gotoAiReports();
    check("report-index.jsonへのfetchが試みられる", reportIndexRequests === 1, `(実際: ${reportIndexRequests})`);
    check("有効な要素が無いためContents APIへフォールバックする", dirListRequests === 1, `(実際: ${dirListRequests})`);
    let options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("フォールバック経由でContents APIの内容が表示される", JSON.stringify(options) === JSON.stringify(["2026-07-10"]), JSON.stringify(options));

    // ============================================================
    // [2] High-1(ii): 古いindex(generatedAtが48時間超過)→ フォールバック
    // ============================================================
    console.log("[2] generatedAtが現在から48時間超過しているindexは不採用にし、Contents APIへフォールバックする");
    reportIndexFixture = { generatedAt: staleGeneratedAt, files: [{ name: "コンテンツ総括_2026-07-01.md", date: "2026-07-01", kind: "content" }] };
    dirListFixture = [{ name: "コンテンツ総括_2026-07-15.md", path: "taskchute/コンテンツ総括_2026-07-15.md", type: "file" }];
    reportIndexRequests = 0; dirListRequests = 0;
    await gotoAiReports();
    check("report-index.jsonへのfetchが試みられる", reportIndexRequests === 1, `(実際: ${reportIndexRequests})`);
    check("48時間超過のためContents APIへフォールバックする", dirListRequests === 1, `(実際: ${dirListRequests})`);
    options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("古いindexの内容(2026-07-01)ではなくContents APIの内容(2026-07-15)が表示される",
      JSON.stringify(options) === JSON.stringify(["2026-07-15"]), JSON.stringify(options));

    // ============================================================
    // [3] High-1(iii): 手動「一覧を更新」はindexとContents APIをunionする
    // ============================================================
    console.log("[3] 通常表示はindexのみだが、「一覧を更新」ではContents APIも取得しname単位でunionする");
    reportIndexFixture = { generatedAt: freshGeneratedAt, files: [{ name: "コンテンツ総括_2026-07-20.md", date: "2026-07-20", kind: "content" }] };
    dirListFixture = [{ name: "コンテンツ総括_2026-07-19.md", path: "taskchute/コンテンツ総括_2026-07-19.md", type: "file" }];  // indexには無い当日追加分を想定
    reportIndexRequests = 0; dirListRequests = 0;
    await gotoAiReports();
    check("通常表示はindexのみで構築される(Contents APIは飛ばない)", dirListRequests === 0, `(実際: ${dirListRequests})`);
    options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("通常表示はindexの1件のみ", JSON.stringify(options) === JSON.stringify(["2026-07-20"]), JSON.stringify(options));

    reportIndexRequests = 0; dirListRequests = 0;
    await page.click('[data-action="ai-report-refresh"]');
    // 低速環境(CI)対策: union結果(2件)が並ぶまで条件待ち(固定700ms待ちを置換)
    await page.waitForFunction(() => document.querySelectorAll("[data-ai-report-date] option").length >= 2, null, { timeout: 15000 });
    await page.waitForTimeout(200);
    check("「一覧を更新」ではreport-index.jsonも再取得される", reportIndexRequests === 1, `(実際: ${reportIndexRequests})`);
    check("「一覧を更新」ではContents APIも取得される(union対象)", dirListRequests === 1, `(実際: ${dirListRequests})`);
    options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("index(07-20)とContents API(07-19)がunionされ新しい順に2件並ぶ",
      JSON.stringify(options) === JSON.stringify(["2026-07-20", "2026-07-19"]), JSON.stringify(options));

    // ============================================================
    // [4] Med-3: compositionend欠落時のfocusoutフェイルセーフ + 60秒タイムアウトフェイルセーフ
    // ============================================================
    console.log("[4-a] compositionendイベントを取りこぼしても、focusoutで_imeComposingが無条件クリアされflushされる");
    await page.goto(`http://localhost:${PORT}/styles.css`);  // gotoAiReportsと同じ理由(seed上書き競合の遮断)
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "journal";
      s.feedback = {};
      s.feedbackFiles = [];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.goto(`http://localhost:${PORT}/`);
    // v140フレーク修正の安定化: 起動時の前日AIフィードバック無条件fetch(汎用200ルートが本文を
    // 返す→recordFeedbackFile→saveState+render)が非同期で走り終わるのを待ってから
    // IMEシナリオを始める(待たないと保留・flushのタイミングと交錯し、延期検証が1/3程度で偽失敗する)
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s && ((Array.isArray(s.feedbackFiles) && s.feedbackFiles.length >= 1) || (s.feedback && Object.keys(s.feedback).length >= 1));
    }, KEY, { timeout: 15000 });
    await page.waitForTimeout(500);

    const journalTextarea = page.locator(`[data-journal-date="${TODAY}"]`);
    await journalTextarea.click();
    await page.evaluate(() => {
      document.activeElement.setAttribute("data-test-marker", "v140-lost-compositionend");
      // compositionstartのみ発火させ、compositionendは意図的に発火させない(取りこぼしを模擬)
      document.activeElement.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    });

    // 新着を発生させてrenderDeferringForFocus経由の保留を作る(Vision.mdの変更をトリガーに使う)
    await page.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute\/content\/Vision\.md$/.test(decodeURIComponent(url.pathname)), (route) =>
      route.fulfill({ status: 200, contentType: "text/markdown", body: "# Vision_v140\n\nフェイルセーフ検証用トリガー。" }));
    await page.clock.setFixedTime(new Date(now0.getTime() + 5 * 60 * 1000));  // maybeRefreshFeedbackの60秒ガードを超えさせる
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(600);
    const markerStillThereComposing = await page.evaluate(() =>
      document.activeElement && document.activeElement.getAttribute("data-test-marker") === "v140-lost-compositionend");
    check("IME変換中(compositionstartのみ)は延期される", markerStillThereComposing);

    // compositionendを発火させずにフォーカスだけ外す(取りこぼしの模擬)
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.waitForTimeout(400);
    const markerGoneAfterBlurWithoutCompositionEnd = await page.evaluate(() =>
      !document.activeElement || document.activeElement.getAttribute("data-test-marker") !== "v140-lost-compositionend");
    check("compositionend無しでもfocusoutだけで保留が解除されrenderが実行される(フェイルセーフ)", markerGoneAfterBlurWithoutCompositionEnd);

    console.log("[4-b] 60秒経過すると、focusout/compositionendを待たずに強制flushされる(周期チェックのフェイルセーフ)");
    await page.goto(`http://localhost:${PORT}/styles.css`);  // gotoAiReportsと同じ理由(seed上書き競合の遮断)
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "journal";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.goto(`http://localhost:${PORT}/`);
    // [4-a]と同じ安定化(feedbackが既に在る場合は即成立)
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s && ((Array.isArray(s.feedbackFiles) && s.feedbackFiles.length >= 1) || (s.feedback && Object.keys(s.feedback).length >= 1));
    }, KEY, { timeout: 15000 });
    await page.waitForTimeout(500);
    const journalTextarea2 = page.locator(`[data-journal-date="${TODAY}"]`);
    await journalTextarea2.click();
    await page.evaluate(() => {
      document.activeElement.setAttribute("data-test-marker", "v140-timeout-failsafe");
    });
    // フォーカスしたままcompositionstart無しで新着トリガーを送る(通常の「入力中」延期と同じ経路)
    await page.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute\/content\/Daily_Affirmation\.md$/.test(decodeURIComponent(url.pathname)), (route) =>
      route.fulfill({ status: 200, contentType: "text/markdown", body: "# Affirmation_v140\n\nタイムアウトフェイルセーフ検証用。" }));
    await page.clock.setFixedTime(new Date(now0.getTime() + 12 * 60 * 1000));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(600);
    const markerStillThereFocused = await page.evaluate(() =>
      document.activeElement && document.activeElement.getAttribute("data-test-marker") === "v140-timeout-failsafe");
    check("フォーカス中は延期される(まだ60秒経過していない)", markerStillThereFocused);

    // フォーカスは外さずに、仮想時刻だけ61秒進める(DEFERRED_RENDER_FAILSAFE_MS=60秒を超過させる)。
    // 500ms周期のtimerTickerは実時間で動くため、少し実時間を待てば次のtickでフェイルセーフが働く。
    await page.clock.setFixedTime(new Date(now0.getTime() + 12 * 60 * 1000 + 61 * 1000));
    await page.waitForTimeout(1200);
    const markerGoneAfterTimeout = await page.evaluate(() =>
      !document.activeElement || document.activeElement.getAttribute("data-test-marker") !== "v140-timeout-failsafe");
    // 注: 60秒フェイルセーフが働きrender()が実行されると、DOMが丸ごと再構築されfocusは
    // どの要素も持たない状態(document.activeElement===body)に戻る。これはblur操作を
    // 一度もしていないシナリオでの結果であり、「フォーカス喪失イベントを一切経ないまま
    // 強制的にrenderが実行された」ことの副次的な証拠でもある。
    check("60秒経過でフォーカスが外れていなくても強制flushされる(フェイルセーフ)", markerGoneAfterTimeout);
  } catch (e) {
    failures++;
    console.log("  ❌ 例外:", e.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nv140: 全件成功" : `\nv140: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
