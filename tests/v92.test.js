// v92 検証: AIレポートビューア(その他 > AIレポート)。
// コンテンツ総括・自己分析・週次レビューを、personal-dataリポジトリの
// taskchute/直下のContents API一覧から取得し、種類タブ+日付セレクタで横断閲覧できるようにした。
//
// ①一覧取得(Contents APIのディレクトリ一覧モック)→タブ切替でセレクタに履歴日付が並ぶ
// ②セレクタで日付を選択→本文(該当ファイルのGET)が表示される
// ③一覧は取れるが該当種類が0件→フェイルソフト(生成方法の1行ガイド)を表示
// ④公開オリジン(同一オリジン = GitHub Pages相当のテストサーバ)へレポートファイル名のfetchが
//   一切飛ばない(否定アサーション。auth不要な公開URLへのフォールバックを作っていないことの確認)
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

  // taskchute/ 直下のディレクトリ一覧(Contents API)モック。
  // コンテンツ総括2件・自己分析1件・週次レビュー1件。
  const DIR_LIST = [
    { name: "コンテンツ総括_2026-07-14.md", path: "taskchute/コンテンツ総括_2026-07-14.md", type: "file" },
    { name: "コンテンツ総括_2026-04-01.md", path: "taskchute/コンテンツ総括_2026-04-01.md", type: "file" },
    { name: "自己分析_2026-07.md", path: "taskchute/自己分析_2026-07.md", type: "file" },
    { name: "週次レビュー_2026-07-11.md", path: "taskchute/週次レビュー_2026-07-11.md", type: "file" },
    { name: "日報_2026-07-13.md", path: "taskchute/日報_2026-07-13.md", type: "file" },
    { name: "content", path: "taskchute/content", type: "dir" }
  ];
  const BODIES = {
    "コンテンツ総括_2026-07-14.md": "# コンテンツ総括 2026-07-14\n\n最新の総括本文。",
    "コンテンツ総括_2026-04-01.md": "# コンテンツ総括 2026-04-01\n\n古い方の総括本文。",
    "自己分析_2026-07.md": "# 自己分析 2026-07\n\n月次の自己分析本文。"
  };

  let dirListRequests = 0;
  const bodyRequests = [];
  await page.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute$/.test(url.pathname), (route) => {
    dirListRequests++;
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DIR_LIST) });
  });
  await page.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute\/[^/]+$/.test(decodeURIComponent(url.pathname)), (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    const name = p.split("/").pop();
    bodyRequests.push(name);
    if (BODIES[name] !== undefined) {
      route.fulfill({ status: 200, contentType: "application/json", body: BODIES[name] });
    } else {
      route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
  });

  // ④ 否定アサーション用: 同一オリジン(このテストサーバ = 公開GitHub Pages相当)への
  //    レポートファイル名リクエストを記録する(1件も無いことを後で確認する)。
  const sameOriginReportRequests = [];
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.hostname !== "api.github.com" && /コンテンツ総括_|自己分析_|基盤ヘルス_|週次レビュー_/.test(decodeURIComponent(u.pathname))) {
      sameOriginReportRequests.push(req.url());
    }
  });

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [1] 「その他」グリッドから「AIレポート」へ遷移し、一覧取得→セレクタ表示
    // ============================================================
    console.log("[1] その他 > AIレポート へ遷移し、既定タブ(コンテンツ総括)で履歴セレクタが並ぶ");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "more";
      s.settings.aiReportType = "content";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(300);

    const moreHasAiReport = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-action="nav"][data-view="ai-reports"]')).length > 0);
    check("「その他」グリッドに AIレポート ボタンがある", moreHasAiReport);

    await page.click('[data-action="nav"][data-view="ai-reports"]');
    await page.waitForTimeout(400);

    check("画面見出しに「AIレポート」が出る", (await page.textContent("#main")).includes("AIレポート"));
    check("一覧取得(Contents API)が1回飛んだ", dirListRequests === 1, `(実際: ${dirListRequests})`);

    let options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("コンテンツ総括の履歴が新しい順に2件並ぶ", JSON.stringify(options) === JSON.stringify(["2026-07-14", "2026-04-01"]), `(実際: ${JSON.stringify(options)})`);

    let mdText = await page.textContent("#main .md-render");
    check("既定選択(最新)の本文が表示される", mdText.includes("最新の総括本文"), `(実際: ${mdText.slice(0, 80)})`);

    // ============================================================
    // [2] セレクタで別日付を選ぶと本文が切り替わる
    // ============================================================
    console.log("[2] セレクタで古い日付を選択すると、その日付の本文がGETされて表示される");
    await page.selectOption("[data-ai-report-date]", "2026-04-01");
    await page.waitForTimeout(300);
    mdText = await page.textContent("#main .md-render");
    check("選択した日付の本文に切り替わる", mdText.includes("古い方の総括本文"), `(実際: ${mdText.slice(0, 80)})`);
    check("選択したファイルがGETされた", bodyRequests.includes("コンテンツ総括_2026-04-01.md"), `(実際: ${JSON.stringify(bodyRequests)})`);

    // タブ切替(自己分析)でも別ファイルの本文が出ることを確認
    await page.click('[data-action="ai-report-type"][data-type="self"]');
    await page.waitForTimeout(300);
    mdText = await page.textContent("#main .md-render");
    check("自己分析タブへ切替→月次本文が表示される", mdText.includes("月次の自己分析本文"), `(実際: ${mdText.slice(0, 80)})`);

    // ============================================================
    // [3] v283: 基盤ヘルス/バッチ実行サマリはタブから削除し、feedbackは追加
    // ============================================================
    console.log("[3] v283の種類構成へ追従し、運用ログ2種を非表示にする");
    check("基盤ヘルスタブを表示しない", await page.locator('[data-type="health"]').count() === 0);
    check("バッチ実行サマリタブを表示しない", await page.locator('[data-type="batch"]').count() === 0);
    check("AIフィードバックタブを表示する", await page.locator('[data-type="feedback"]').count() === 1);

    // ============================================================
    // [4] 公開オリジン(同一オリジン)へレポートファイルのfetchが一切飛んでいない
    // ============================================================
    console.log("[4] レポート本文の取得はapi.github.com経由のみ(同一オリジンへの直接fetchが無い)");
    check("同一オリジンへのレポートファイルfetchは0件", sameOriginReportRequests.length === 0, `(実際: ${JSON.stringify(sameOriginReportRequests)})`);
  } catch (e) {
    failures++;
    console.log("  ❌ 例外:", e.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures ? `\n❌ v92: ${failures} 件失敗` : "\n✅ v92: 全件成功");
  process.exit(failures ? 1 : 0);
})();
