// v158 検証: AI機能第2弾「勝手に格言」(K発注仕様 workbench/out/2026-07-27-taskchute-ai5/spec.md
// 機能2)。CHANGES_v158.md参照。
//
// (1) 勝手に格言_<今日>.json がpersonal-data API(fetchGitHubRawText経由)で取得できる日は、
//     ホーム「今日」タブ最下部(「今日の足あと」の下)に1行カードで quote/author が表示される
// (2) ファイルが無い日(404)はカード自体が表示されない(フェイルソフト)
// (3) 壊れたJSON(パース不能)の日はカード自体が表示されない(フェイルソフト)
// (4) quote/authorのいずれかが欠損しているJSONの日はカード自体が表示されない(フェイルソフト)
// (5) 「※AIによる捏造です」の注記が常に添えられる(JSONの"note"フィールドの値に関わらず、
//     アプリ側の固定文言が出ること)
// (6) quote/author中にHTML/Markdown的な文字列が含まれていてもエスケープされ、タグとして実行されない
// (7) 過去日を閲覧中(ホームで今日以外の日付を選択)はカード自体が表示されない
// (8) 公開Pages側(同一オリジン)への勝手に格言_*.jsonのfetchは一切発生しない(同一オリジンfetch回帰の防止)
// (9) quote200字境界に絵文字(サロゲートペア)が掛かる場合でも文字化けせずコードポイント単位で
//     クリップされる(2026-07-28レビュー対応・項目1。Array.from化前はJSの.length/.sliceが
//     UTF-16コード単位で数えるため、境界がサロゲートの途中に落ちると孤立サロゲートによる
//     文字化けを起こしていた)
//
// 方針: v157.test.js と同じ作法(ブラウザ操作 + page.route + localStorage直接注入)。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

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

  // (8)用: 公開Pages側(同一オリジン)への勝手に格言_*.jsonへのリクエストを全て記録する
  const sameOriginRequests = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(`http://localhost:${PORT}/`) && /勝手に格言_/.test(decodeURIComponent(url))) {
      sameOriginRequests.push(url);
    }
  });

  let quoteFixture = null;  // null=404、文字列=生body(JSON文字列 or 壊れたテキスト)
  const quoteApiRequests = [];
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const u = new URL(route.request().url());
    const p = decodeURIComponent(u.pathname);
    const quoteMatch = p.match(/\/contents\/taskchute\/勝手に格言_(.+)\.json$/);
    if (quoteMatch) {
      quoteApiRequests.push(p);
      if (quoteMatch[1] !== TODAY || quoteFixture === null) {
        return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: quoteFixture });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  async function seed({ selectedDate = TODAY, view = "home" } = {}) {
    await page.evaluate(({ KEY, selectedDate, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = [];
      s.selectedDate = selectedDate;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, selectedDate, view });
    await page.reload();
    await page.waitForTimeout(700);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (1)(5) ファイルがある日: 今日タブ最下部にquote/author+「※AIによる捏造です」注記が出る
    // ============================================================
    // v230: home完全撤去に伴い「勝手に格言」カードも描画・取得対象から削除。
    console.log("[1-9] v230: 格言カードの不存在と不要fetch防止");
    quoteFixture = JSON.stringify({ quote: "削除済みカード用", author: "v158", date: TODAY });
    await seed({ selectedDate: TODAY, view: "home" });
    check("旧格言カードは描画されない", await page.locator(".home-quote-card").count() === 0);
    check("旧home viewはtodayへフォールバックする", await page.locator('#app[data-view="today"]').count() === 1);
    check("削除済みカード用データを同一オリジンから取得しない",
      sameOriginRequests.length === 0, JSON.stringify(sameOriginRequests));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
