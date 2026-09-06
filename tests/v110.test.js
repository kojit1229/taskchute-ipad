// v110由来回帰 / v283追従: バッチ実行サマリをタブから削除し、保存済みbatch設定を
// 先頭のAIフィードバックへ安全に縮退する。
//
// ①batchタブが無く、保存済みbatchはfeedbackをactiveにする
// ②feedback履歴・本文は現在の日付ボタンと読み取り専用本文で表示される
// Contents JSONとrawの表現はAcceptに従い分け、API契約に合う合成応答だけを返す。
// ③他種別との往復で壊れない
// ④一覧空でもfeedbackのフェイルソフト表示へ縮退する
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

  const DIR_LIST = [
    { name: "AIフィードバック_2026-07-16.md", path: "taskchute/AIフィードバック_2026-07-16.md", type: "file" },
    { name: "AIフィードバック_2026-07-15.md", path: "taskchute/AIフィードバック_2026-07-15.md", type: "file" },
    { name: "コンテンツ総括_2026-07-14.md", path: "taskchute/コンテンツ総括_2026-07-14.md", type: "file" },
    { name: "日報_2026-07-13.md", path: "taskchute/日報_2026-07-13.md", type: "file" }
  ];
  const BODIES = {
    "AIフィードバック_2026-07-16.md": "# AIフィードバック 2026-07-16\n\n- 最新フィードバック本文_v110",
    "AIフィードバック_2026-07-15.md": "# AIフィードバック 2026-07-15\n\n- 前日フィードバック本文_v110"
  };

  let dirListRequests = 0;
  const writes = [];
  page.on("request", request => { if (new URL(request.url()).hostname === "api.github.com" && request.method() !== "GET") writes.push(request.method()); });
  const contents = text => ({ encoding: "base64", sha: "a".repeat(40), content: Buffer.from(text, "utf-8").toString("base64") });
  const index = { generatedAt: "2026-07-16T03:00:00Z", files: DIR_LIST.filter(f => !f.name.startsWith("日報_")).map(f => ({ ...f, date: f.name.match(/\d{4}-\d{2}-\d{2}/)[0], kind: f.name.startsWith("AIフィードバック_") ? "feedback" : "content" })) };
  BODIES["コンテンツ総括_2026-07-14.md"] = "# コンテンツ総括\n\n別種別本文_v110";
  async function readBody(pg, marker) {
    await pg.waitForFunction(value => document.querySelector("[data-feedback-report-overlay] .feedback-version-body")?.textContent.includes(value), marker);
    return pg.textContent("[data-feedback-report-overlay] .feedback-version-body");
  }
  const dates = pg => pg.$$eval('[data-feedback-report-overlay] [data-action="feedback-report-date"]', els => els.map(e => e.dataset.feedbackDate));
  const bodyRequests = [];
  await page.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute$/.test(url.pathname), (route) => {
    dirListRequests++;
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DIR_LIST) });
  });
  await page.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute\/[^/]+$/.test(decodeURIComponent(url.pathname)), (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    const name = p.split("/").pop();
    bodyRequests.push(name);
    if (route.request().method() !== "GET") { writes.push(p); return route.fulfill({ status: 405, body: "{}" }); }
    const text = name === "report-index.json" ? JSON.stringify(index) : BODIES[name];
    if (text !== undefined) {
      const raw = (route.request().headers().accept || "").includes("raw");
      route.fulfill({ status: 200, contentType: raw ? "text/plain" : "application/json", body: raw ? text : JSON.stringify(contents(text)) });
    } else {
      route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
  });

  await page.route(url => url.hostname === "api.github.com" && url.pathname.includes("/contents/taskchute/requests/"), route => route.fulfill({ status: 404, body: "{}" }));

  try {
    await page.clock.setFixedTime(new Date(2026, 6, 16, 12, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [1] 保存済みbatch設定は先頭feedbackへ縮退し、履歴セレクタに新しい順で並ぶ
    // ============================================================
    console.log("[1] 保存済みbatch設定からAIフィードバックへ縮退し、履歴セレクタ・本文が表示される");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "ai-reports";
      s.settings.aiReportType = "batch";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await readBody(page, "最新フィードバック本文_v110");

    check("種類タブに「バッチ実行サマリ」が無い", await page.locator('[data-type="batch"]').count() === 0);
    check("保存済みbatchは先頭feedbackをactive表示", await page.locator('[data-type="feedback"].active').count() === 1);
    check("一覧取得(Contents API)が1回飛んだ", dirListRequests === 1, `(実際: ${dirListRequests})`);

    const options = await dates(page);
    check("AIフィードバックの履歴が新しい順に2件並ぶ", JSON.stringify(options) === JSON.stringify(["2026-07-16", "2026-07-15"]), `(実際: ${JSON.stringify(options)})`);

    let mdText = await readBody(page, "最新フィードバック本文_v110");
    check("既定選択(最新)の本文が表示される", mdText.includes("最新フィードバック本文_v110"), `(実際: ${mdText.slice(0, 80)})`);

    // ============================================================
    // [2] セレクタで別日付を選ぶと本文が切り替わる(失敗ログを含む日)
    // ============================================================
    console.log("[2] セレクタで前日を選択すると前日の本文に切り替わる");
    await page.locator('[data-action="feedback-report-date"][data-feedback-date="2026-07-15"]').click();
    mdText = await readBody(page, "前日フィードバック本文_v110");
    check("選択した日付の本文に切り替わる", mdText.includes("前日フィードバック本文_v110"), `(実際: ${mdText.slice(0, 80)})`);
    check("選択したファイルがGETされた", bodyRequests.includes("AIフィードバック_2026-07-15.md"), `(実際: ${JSON.stringify(bodyRequests)})`);

    // ============================================================
    // [3] 他種別(コンテンツ総括)からfeedbackへ戻っても一覧キャッシュ共有で壊れない
    // ============================================================
    console.log("[3] 他タブへ切替→feedbackへ戻っても壊れない");
    await page.click('[data-action="ai-report-type"][data-type="content"]');
    await page.waitForFunction(() => document.querySelector("#main .md-render")?.textContent.includes("別種別本文_v110"));
    const beforeReturn = dirListRequests;
    await page.click('[data-action="ai-report-type"][data-type="feedback"]');
    await readBody(page, "前日フィードバック本文_v110");
    const stillHasSelect = JSON.stringify(await dates(page)) === JSON.stringify(["2026-07-16", "2026-07-15"]);
    check("タブ往復後も日付選択2件が表示されたまま", stillHasSelect);
    check("タブ復帰で一覧を重複取得せず、選択日と本文を保持", dirListRequests === beforeReturn
      && await page.locator('[data-action="feedback-report-date"][data-feedback-date="2026-07-15"][aria-pressed="true"]').count() === 1);
    check("閲覧だけでは書き込みを行わない", writes.length === 0, JSON.stringify(writes));
  } catch (e) {
    failures++;
    console.log("  ❌ 例外:", e.message);
  } finally {
    await browser.close();
    server.close();
  }

  // ============================================================
  // [4] taskchute/ 直下が0件(バッチ未実行の初回状態)でもビューアが壊れない(新規コンテキスト)
  // ============================================================
  const server2 = startServer(PORT + 1);
  const browser2 = await chromium.launch(launchOptions());
  const ctx2 = await browser2.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page2 = await ctx2.newPage();
  page2.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(0件時):", e.message); });
  await blockGithubApiByDefault(page2);
  const emptyReads = [];
  await page2.route((url) => url.hostname === "api.github.com", route => {
    const request = route.request(), pathname = decodeURIComponent(new URL(request.url()).pathname);
    emptyReads.push({ method: request.method(), pathname });
    if (request.method() !== "GET") return route.fulfill({ status: 405, body: "{}" });
    if (/\/contents\/taskchute$/.test(pathname)) return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    if (pathname.endsWith("/report-index.json")) {
      const text = JSON.stringify({ ...index, files: [] }), raw = (request.headers().accept || "").includes("raw");
      return route.fulfill({ status: 200, contentType: "application/json", body: raw ? text : JSON.stringify(contents(text)) });
    }
    return route.fulfill({ status: 404, body: "{}" });
  });
  try {
    console.log("[4] taskchute/直下が0件でも保存済みbatch設定からfeedbackへ縮退して壊れない");
    await page2.clock.setFixedTime(new Date(2026, 6, 16, 12, 0, 0));
    await page2.goto(`http://localhost:${PORT + 1}/`);
    await page2.waitForTimeout(500);
    await passGithubGate(page2);
    await page2.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "ai-reports";
      s.settings.aiReportType = "batch";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page2.reload();
    await page2.locator('[data-feedback-report-overlay] [data-action="feedback-report-refresh"]').waitFor({ state: "visible" });
    const mainText = await page2.textContent("[data-feedback-report-overlay]");
    check("0件時は対象日が未確認であることを案内する(例外なし)", mainText.includes("対象日をまだ確認できていません"), `(実際: ${mainText.slice(0, 120)})`);
    check("0件時は一覧を確認する案内と操作がある", mainText.includes("一覧を確認")
      && await page2.locator('[data-feedback-report-overlay] [data-action="feedback-report-refresh"]').isVisible(), `(実際: ${mainText.slice(0, 200)})`);
    check("0件時は日付選択や取得済み本文を作らない", (await dates(page2)).length === 0
      && await page2.locator("[data-feedback-report-overlay] .feedback-version-body").count() === 0);
    check("空一覧の閲覧でも書き込みを行わない", emptyReads.every(r => r.method === "GET"));
  } catch (e) {
    failures++;
    console.log("  ❌ 例外(0件時):", e.message);
  } finally {
    await browser2.close();
    server2.close();
  }

  console.log(failures ? `\n❌ v110: ${failures} 件失敗` : "\n✅ v110: 全件成功");
  process.exit(failures ? 1 : 0);
})();
