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
    // ============================================================
    console.log("[3] 勝手に格言_TODAY.jsonがJSONとしてパースできない場合はカード自体が表示されない");
    quoteFixture = "{ this is not valid json ,,,";
    await seed({ selectedDate: TODAY, view: "home" });
    const cardCount3 = await page.locator(".home-quote-card").count();
    check("壊れたJSONならカードが0件", cardCount3 === 0);

    // ============================================================
    // (4) quote/author欠損: カード自体が出ない
    // ============================================================
    console.log("[4] quote/authorのいずれかが欠損しているJSONの日はカード自体が表示されない");
    quoteFixture = JSON.stringify({ author: "著者だけあってquoteが無いケース", note: "※AIによる捏造です", date: TODAY });
    await seed({ selectedDate: TODAY, view: "home" });
    const cardCount4 = await page.locator(".home-quote-card").count();
    check("quote欠損ならカードが0件", cardCount4 === 0);

    // ============================================================
    // (6) HTML/Markdown的な文字列はエスケープされ、タグとして実行されない
    // ============================================================
    console.log("[6] quote/author中のHTMLタグ的な文字列はエスケープされ、要素として実行されない");
    quoteFixture = JSON.stringify({
      quote: "<img src=x onerror=alert(1)>捏造格言_v158XSSテスト",
      author: "<b>強調著者</b>",
      note: "※AIによる捏造です",
      date: TODAY,
    });
    await seed({ selectedDate: TODAY, view: "home" });
    const injectedImgCount = await page.locator(".home-quote-card img[onerror]").count();
    check("onerror付きimgタグが実行可能な要素として存在しない(エスケープ済み)", injectedImgCount === 0);
    const cardText6 = await page.locator(".home-quote-card").textContent();
    check("エスケープされたタグ文字列自体はテキストとして読める", cardText6.includes("捏造格言_v158XSSテスト") && cardText6.includes("強調著者"), cardText6);

    // ============================================================
    // (7) 過去日を閲覧中はカードが出ない
    // ============================================================
    // v157.test.jsと同じ理由(起動時仕様でstate.selectedDateが今日へ強制されるため)、
    // 実際のユーザー操作(「前日」ボタン=date-prevアクション)でセッション内移動させて検証する。
    console.log("[7] ホームで『前日』ボタンを押して今日以外の日付を閲覧している間はカードが出ない");
    quoteFixture = JSON.stringify({
      quote: "過去日閲覧テスト用の格言_v158",
      author: "過去日テスト著者",
      note: "※AIによる捏造です",
      date: TODAY,
    });
    await seed({ selectedDate: TODAY, view: "home" });
    const cardCount7before = await page.locator(".home-quote-card").count();
    check("前提: 今日を見ている間はカードが出ている", cardCount7before === 1);
    await page.click('[data-action="date-prev"]');
    await page.waitForTimeout(200);
    const cardCount7 = await page.locator(".home-quote-card").count();
    check("『前日』を押した後(過去日閲覧中)はカードが0件(当日データはfetch済みでも非表示)", cardCount7 === 0);

    // ============================================================
    // (8) 公開Pages側(同一オリジン)への勝手に格言_*.jsonのfetchは一切発生しない
    // ============================================================
    console.log("[8] 公開Pages側(同一オリジン)への勝手に格言_*.jsonのfetchは一度も発生しない");
    check("同一オリジンでの勝手に格言_*.jsonへのリクエストが0件(すべてapi.github.com経由)",
      sameOriginRequests.length === 0, JSON.stringify(sameOriginRequests));

    // ============================================================
    // (9) quote200字境界に絵文字(サロゲートペア)が掛かる場合でも文字化けせずクリップされる
    // ============================================================
    console.log("[9] quote200字境界に絵文字が掛かってもコードポイント単位で正しくクリップされる(2026-07-28レビュー対応・項目1)");
    const EMOJI = "😀";  // U+1F600、UTF-16ではサロゲートペア(2コード単位)・コードポイントは1
    const TAIL_MARKER_9 = "TAIL_MARKER_SHOULD_BE_CLIPPED_v158";
    // コードポイント199個の「あ」+ 絵文字1個 = ちょうど200コードポイント目が絵文字になる境界。
    // 旧実装(s.length/s.sliceでUTF-16コード単位カウント)だと、199文字目までのUTF-16長は199、
    // そこに絵文字の高位サロゲートだけが200文字目として切り出され、孤立サロゲート(文字化け)を生む。
    const quoteBody9 = "あ".repeat(199) + EMOJI + TAIL_MARKER_9;
    quoteFixture = JSON.stringify({ quote: quoteBody9, author: "境界テスト著者_v158", note: "※AIによる捏造です", date: TODAY });
    await seed({ selectedDate: TODAY, view: "home" });
    const cardCount9 = await page.locator(".home-quote-card").count();
    check("200字境界のquoteでもカードは表示される", cardCount9 === 1);
    const cardText9 = await page.locator(".home-quote-card").textContent();
    check("境界の絵文字が欠けずそのまま表示される(サロゲート分断による文字化けなし)", cardText9.includes(EMOJI), cardText9.slice(0, 250));
    check("孤立サロゲートによる置換文字(U+FFFD)が含まれない", !cardText9.includes("�"), cardText9.slice(0, 250));
    check("200字を超えた末尾のマーカーは表示されない(クリップされている)", !cardText9.includes(TAIL_MARKER_9), cardText9.slice(-80));
    check("クリップされたことを示す省略記号(…)が絵文字の直後(quote末尾)に付く", cardText9.includes(`${EMOJI}…`), cardText9);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
