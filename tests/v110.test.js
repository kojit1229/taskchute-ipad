// v110由来回帰 / v283追従: バッチ実行サマリをタブから削除し、保存済みbatch設定を
// 先頭のAIフィードバックへ安全に縮退する。
//
// ①batchタブが無く、保存済みbatchはfeedbackをactiveにする
// ②feedback履歴・本文は既存ビューア機構で表示される
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

  try {
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
    await page.waitForTimeout(400);

    check("種類タブに「バッチ実行サマリ」が無い", await page.locator('[data-type="batch"]').count() === 0);
    check("保存済みbatchは先頭feedbackをactive表示", await page.locator('[data-type="feedback"].active').count() === 1);
    check("一覧取得(Contents API)が1回飛んだ", dirListRequests === 1, `(実際: ${dirListRequests})`);

    const options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("AIフィードバックの履歴が新しい順に2件並ぶ", JSON.stringify(options) === JSON.stringify(["2026-07-16", "2026-07-15"]), `(実際: ${JSON.stringify(options)})`);

    let mdText = await page.textContent("#main .md-render");
    check("既定選択(最新)の本文が表示される", mdText.includes("最新フィードバック本文_v110"), `(実際: ${mdText.slice(0, 80)})`);

    // ============================================================
    // [2] セレクタで別日付を選ぶと本文が切り替わる(失敗ログを含む日)
    // ============================================================
    console.log("[2] セレクタで前日を選択すると前日の本文に切り替わる");
    await page.selectOption("[data-ai-report-date]", "2026-07-15");
    await page.waitForTimeout(300);
    mdText = await page.textContent("#main .md-render");
    check("選択した日付の本文に切り替わる", mdText.includes("前日フィードバック本文_v110"), `(実際: ${mdText.slice(0, 80)})`);
    check("選択したファイルがGETされた", bodyRequests.includes("AIフィードバック_2026-07-15.md"), `(実際: ${JSON.stringify(bodyRequests)})`);

    // ============================================================
    // [3] 他種別(コンテンツ総括)からfeedbackへ戻っても一覧キャッシュ共有で壊れない
    // ============================================================
    console.log("[3] 他タブへ切替→feedbackへ戻っても壊れない");
    await page.click('[data-action="ai-report-type"][data-type="content"]');
    await page.waitForTimeout(300);
    await page.click('[data-action="ai-report-type"][data-type="feedback"]');
    await page.waitForTimeout(300);
    const stillHasSelect = await page.$("[data-ai-report-date]") !== null;
    check("タブ往復後もセレクタが表示されたまま", stillHasSelect);
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
  await page2.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute$/.test(url.pathname), (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  try {
    console.log("[4] taskchute/直下が0件でも保存済みbatch設定からfeedbackへ縮退して壊れない");
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
    await page2.waitForTimeout(500);
    const mainText = await page2.textContent("#main");
    check("0件時は「まだ生成されていません」の案内が出る(例外なし)", mainText.includes("まだ生成されていません"), `(実際: ${mainText.slice(0, 120)})`);
    check("0件時のガイド文にフィードバック生成案内が含まれる", mainText.includes("前日の日報"), `(実際: ${mainText.slice(0, 200)})`);
    check("0件時は履歴セレクタを出さない", await page2.$("[data-ai-report-date]") === null);
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
