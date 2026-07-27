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
    console.log("[1][5] 勝手に格言_TODAY.jsonがある日は、ホーム『今日』タブ最下部に1行カードでquote/author+注記が出る");
    quoteFixture = JSON.stringify({
      quote: "積読タワーは崩れても知性の礎となる_v158テスト格言",
      author: "架空の賢者・テスト翁",
      note: "この文言はUI側で無視されるはず",
      date: TODAY,
    });
    await seed({ selectedDate: TODAY, view: "home" });
    check("api.github.comの勝手に格言_TODAY.jsonへリクエストが実際に飛んでいる(personal-data API経由の裏取り)",
      quoteApiRequests.some((p) => p.endsWith(`勝手に格言_${TODAY}.json`)), JSON.stringify(quoteApiRequests));
    const cardCount1 = await page.locator(".home-quote-card").count();
    check("『勝手に格言』カードが1つ表示される", cardCount1 === 1);
    const cardText1 = await page.locator(".home-quote-card").textContent();
    check("quote本文がDOM上に読める", cardText1.includes("積読タワーは崩れても知性の礎となる_v158テスト格言"), cardText1);
    check("author(偽偉人名)がDOM上に読める", cardText1.includes("架空の賢者・テスト翁"), cardText1);
    check("『※AIによる捏造です』の注記が出る(JSONの'note'値ではなくアプリ側固定文言)",
      cardText1.includes("※AIによる捏造です") && !cardText1.includes("この文言はUI側で無視されるはず"), cardText1);

    // ============================================================
    // (2) ファイルが無い日: カード自体が出ない
    // ============================================================
    console.log("[2] 勝手に格言_TODAY.jsonが無い日(404)はカード自体が表示されない");
    quoteFixture = null;
    await seed({ selectedDate: TODAY, view: "home" });
    const cardCount2 = await page.locator(".home-quote-card").count();
    check("ファイルが無ければカードが0件", cardCount2 === 0);

    // ============================================================
    // (3) 壊れたJSON: カード自体が出ない
