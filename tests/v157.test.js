// v157 検証: AI機能第1弾「今日の敵」(K発注仕様 workbench/out/2026-07-27-taskchute-ai5/spec.md
// 機能1)。CHANGES_v157.md参照。
//
// (1) 今日の敵_<今日>.md がpersonal-data API(fetchGitHubRawText経由)で取得できる日は、
//     ホーム「今日」タブのhero直後に既定openの折りたたみカードとして本文が表示される
// (2) ファイルが無い日(404)はカード自体が表示されない(フェイルソフト)
// (3) 本文にHTML/Markdown的な文字列が含まれていてもエスケープされ、タグとして実行されない
// (4) 「※AI演出」の注記が常に添えられる
// (5) 過去日を閲覧中(ホームで今日以外の日付を選択)はカード自体が表示されない
//     (当日限定の演出であり、過去日を読み返す機能ではないため)
// (6) 公開Pages側(同一オリジン)への今日の敵_*.mdのfetchは一切発生しない(同一オリジンfetch回帰の防止)
// (7) 本文が4000字を超える場合、表示側でも末尾を省略する(バッチ側4000字上限とは別の
//     表示側二重防御。2026-07-28レビュー対応・項目9で追加)
//
// 方針: 既存スイート(v75等)と同じく、app.js は type="module" のため内部関数は window に
// 露出しない。ブラウザ操作 + page.route(api.github.com の偽装)+ localStorage 直接注入で観測する。
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
  const addDaysStr = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return isoDate(date);
  };
  const YDAY = addDaysStr(TODAY, -1);

  // (6)用: 公開Pages側(同一オリジン)への今日の敵_*.mdへのリクエストを全て記録する
  const sameOriginRequests = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(`http://localhost:${PORT}/`) && /今日の敵_/.test(decodeURIComponent(url))) {
      sameOriginRequests.push(url);
    }
  });

  let enemyFixture = null;  // null=404、文字列=本文
  const enemyApiRequests = [];
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const u = new URL(route.request().url());
    const p = decodeURIComponent(u.pathname);
    const enemyMatch = p.match(/\/contents\/taskchute\/今日の敵_(.+)\.md$/);
    if (enemyMatch) {
      enemyApiRequests.push(p);
      if (enemyMatch[1] !== TODAY || enemyFixture === null) {
        return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      }
      return route.fulfill({ status: 200, contentType: "text/markdown", body: enemyFixture });
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
    // (1)(4) ファイルがある日: 今日タブhero直後に既定openのカードで本文+注記が表示される
    // ============================================================
    console.log("[1][4] 今日の敵_TODAY.mdがある日は、ホーム『今日』タブに既定openのカードで本文+『※AI演出』注記が出る");
    enemyFixture = "7月28日、恐るべき「積読タワー」が今日のラスボスとして立ちはだかる_v157テスト本文。";
    await seed({ selectedDate: TODAY, view: "home" });
    check("api.github.comの今日の敵_TODAY.mdへリクエストが実際に飛んでいる(personal-data API経由の裏取り)",
      enemyApiRequests.some((p) => p.endsWith(`今日の敵_${TODAY}.md`)), JSON.stringify(enemyApiRequests));
    const cardCount1 = await page.locator(".home-today-enemy").count();
    check("『今日の敵』カードが1つ表示される", cardCount1 === 1);
    const openAttr1 = await page.locator(".home-today-enemy").getAttribute("open").catch(() => null);
    check("カードは既定open(open属性がある)", openAttr1 !== null, String(openAttr1));
    const homeText1 = await page.locator("main").textContent();
    check("本文がDOM上に読める", homeText1.includes("積読タワー"), homeText1.slice(0, 400));
    check("見出し『👹 今日の敵』が出る", homeText1.includes("今日の敵"));
    check("『※AI演出』の注記が出る", homeText1.includes("※AI演出"), homeText1.slice(0, 400));

    // ============================================================
    // (2) ファイルが無い日: カード自体が出ない
    // ============================================================
    console.log("[2] 今日の敵_TODAY.mdが無い日(404)はカード自体が表示されない");
    enemyFixture = null;
    await seed({ selectedDate: TODAY, view: "home" });
    const cardCount2 = await page.locator(".home-today-enemy").count();
    check("ファイルが無ければカードが0件", cardCount2 === 0);

    // ============================================================
    // (3) HTML/Markdown的な文字列はエスケープされ、タグとして実行されない
    // ============================================================
    console.log("[3] 本文中のHTMLタグ的な文字列はエスケープされ、要素として実行されない");
    enemyFixture = "<img src=x onerror=alert(1)>今日のラスボスは<b>強敵</b>_v157XSSテスト";
    await seed({ selectedDate: TODAY, view: "home" });
    const injectedImgCount = await page.locator(".home-today-enemy img[onerror]").count();
    check("onerror付きimgタグが実行可能な要素として存在しない(エスケープ済み)", injectedImgCount === 0);
    const homeText3 = await page.locator("main").textContent();
    check("エスケープされたタグ文字列自体はテキストとして読める", homeText3.includes("今日のラスボスは") && homeText3.includes("強敵"), homeText3.slice(0, 400));

    // ============================================================
    // (7) 4000字を超える本文は表示側でも末尾を省略する(表示側の二重防御)
    // ============================================================
    console.log("[7] 4000字を超える本文は表示側でクリップされ、末尾は表示されない");
    const CLIP_TAIL_MARKER = "TAIL_MARKER_SHOULD_BE_CLIPPED_v157";
    enemyFixture = "あ".repeat(4000) + CLIP_TAIL_MARKER;
    await seed({ selectedDate: TODAY, view: "home" });
    const cardCount7 = await page.locator(".home-today-enemy").count();
    check("4000字超でもカード自体は表示される", cardCount7 === 1);
    const bodyText7 = await page.locator(".home-today-enemy .home-fold-body > div").first().textContent();
    check("4000字を超えた末尾のマーカーは表示されない(クリップされている)", !bodyText7.includes(CLIP_TAIL_MARKER), bodyText7.slice(-60));
    check("クリップされたことを示す省略記号(…)が末尾に付く", bodyText7.endsWith("…"), bodyText7.slice(-10));
    check("表示本文の長さは4000字+省略記号1字(4001字)以内", bodyText7.length <= 4001, String(bodyText7.length));

    // ============================================================
    // (5) 過去日を閲覧中はカードが出ない
    // ============================================================
    // v18951の起動時仕様(state.selectedDate = todayISO()を毎回強制)により、localStorageへ
    // selectedDate=前日を直接注入してreloadしても次の起動処理で今日へ戻されてしまう。
    // 実際のユーザー操作(「前日」ボタン=date-prevアクション)でセッション内移動させて検証する。
    console.log("[5] ホームで『前日』ボタンを押して今日以外の日付を閲覧している間はカードが出ない");
    enemyFixture = "今日の敵_v157本文(過去日閲覧テスト用)";
    await seed({ selectedDate: TODAY, view: "home" });
    const cardCount5before = await page.locator(".home-today-enemy").count();
    check("前提: 今日を見ている間はカードが出ている", cardCount5before === 1);
    await page.click('[data-action="date-prev"]');
    await page.waitForTimeout(200);
    const cardCount5 = await page.locator(".home-today-enemy").count();
    check("『前日』を押した後(過去日閲覧中)はカードが0件(当日データはfetch済みでも非表示)", cardCount5 === 0);

    // ============================================================
    // (6) 公開Pages側(同一オリジン)への今日の敵_*.mdのfetchは一切発生しない
    // ============================================================
    console.log("[6] 公開Pages側(同一オリジン)への今日の敵_*.mdのfetchは一度も発生しない");
    check("同一オリジンでの今日の敵_*.mdへのリクエストが0件(すべてapi.github.com経由)",
      sameOriginRequests.length === 0, JSON.stringify(sameOriginRequests));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
