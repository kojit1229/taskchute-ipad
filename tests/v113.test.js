// v113 検証: AIレポートビューア(その他 > AIレポート)に「英語表現集」種別を追加。
// loop/english-phrases.sh が毎日 personal-data/taskchute/ へ push する
// 「英語表現集_YYYY-MM-DD.md」を、既存の AI_REPORT_TYPES(コンテンツ総括/自己分析/
// 基盤ヘルス/週次レビュー/バッチ実行サマリ)と同じ流儀でアプリに表示する。
//
// ①種類タブに「英語表現集」が並ぶ→選択で一覧取得(Contents API)が飛ぶ
// ②履歴セレクタに日付が並び、選択で本文(該当ファイルのGET)が表示される
// ③ファイルが1件も無い(一覧はあるが英語表現集_prefix一致0件)→フェイルソフト表示で壊れない
// ④一覧そのものが空配列(taskchute/直下に何も無い初回状態)→他種別同様に壊れない
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
    { name: "英語表現集_2026-07-16.md", path: "taskchute/英語表現集_2026-07-16.md", type: "file" },
    { name: "英語表現集_2026-07-15.md", path: "taskchute/英語表現集_2026-07-15.md", type: "file" },
    { name: "コンテンツ総括_2026-07-14.md", path: "taskchute/コンテンツ総括_2026-07-14.md", type: "file" },
    { name: "日報_2026-07-13.md", path: "taskchute/日報_2026-07-13.md", type: "file" }
  ];
  const BODIES = {
    "英語表現集_2026-07-16.md": "# 使える表現集\n\n### \"I was at my limit\"\n- 意味: 体力・気力が尽きた状態",
    "英語表現集_2026-07-15.md": "# 使える表現集\n\n### \"a hectic weekend\"\n- 意味: 慌ただしかった週末"
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
    // [1] 種類タブに「英語表現集」が並び、選択すると一覧取得→履歴セレクタに新しい順で並ぶ
    // ============================================================
    console.log("[1] AIレポート画面で「英語表現集」タブを選択→履歴セレクタ・本文が表示される");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "ai-reports";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);

    const hasEnglishTab = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-action="ai-report-type"]')).some((b) => b.dataset.type === "english"));
    check("種類タブに「英語表現集」がある", hasEnglishTab);

    await page.click('[data-action="ai-report-type"][data-type="english"]');
    await page.waitForTimeout(400);
    check("一覧取得(Contents API)が1回飛んだ", dirListRequests === 1, `(実際: ${dirListRequests})`);

    const options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("英語表現集の履歴が新しい順に2件並ぶ", JSON.stringify(options) === JSON.stringify(["2026-07-16", "2026-07-15"]), `(実際: ${JSON.stringify(options)})`);

    let mdText = await page.textContent("#main .md-render");
    check("既定選択(最新)の本文が表示される", mdText.includes("I was at my limit"), `(実際: ${mdText.slice(0, 80)})`);

    // ============================================================
    // [2] セレクタで別日付を選ぶと本文が切り替わる
    // ============================================================
    console.log("[2] セレクタで前日を選択すると別の表現に切り替わる");
    await page.selectOption("[data-ai-report-date]", "2026-07-15");
    await page.waitForTimeout(300);
    mdText = await page.textContent("#main .md-render");
    check("選択した日付の本文に切り替わる", mdText.includes("a hectic weekend"), `(実際: ${mdText.slice(0, 80)})`);
    check("選択したファイルがGETされた", bodyRequests.includes("英語表現集_2026-07-15.md"), `(実際: ${JSON.stringify(bodyRequests)})`);

    // ============================================================
    // [3] 他種別(コンテンツ総括)から英語表現集タブへ戻っても壊れない
    // ============================================================
    console.log("[3] 他タブへ切替→英語表現集タブへ戻ってもフェイルソフトのまま壊れない");
    await page.click('[data-action="ai-report-type"][data-type="content"]');
    await page.waitForTimeout(300);
    await page.click('[data-action="ai-report-type"][data-type="english"]');
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
  // [4] taskchute/ 直下が0件(初回状態)でもビューアが壊れない(新規コンテキスト)
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
    console.log("[4] taskchute/直下が0件(初回状態)でも英語表現集タブが壊れない");
    await page2.goto(`http://localhost:${PORT + 1}/`);
    await page2.waitForTimeout(500);
    await passGithubGate(page2);
    await page2.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "ai-reports";
      s.settings.aiReportType = "english";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page2.reload();
    await page2.waitForTimeout(500);
    const mainText = await page2.textContent("#main");
    check("0件時は「まだ生成されていません」の案内が出る(例外なし)", mainText.includes("まだ生成されていません"), `(実際: ${mainText.slice(0, 120)})`);
    check("0件時のガイド文に英語表現の案内が含まれる", mainText.includes("使える表現"), `(実際: ${mainText.slice(0, 200)})`);
  } catch (e) {
    failures++;
    console.log("  ❌ 例外(0件時):", e.message);
  } finally {
    await browser2.close();
    server2.close();
  }

  console.log(failures ? `\n❌ v113: ${failures} 件失敗` : "\n✅ v113: 全件成功");
  process.exit(failures ? 1 : 0);
})();
