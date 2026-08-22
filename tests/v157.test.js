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
    // v230: home完全撤去に伴い「今日の敵」演出カードも描画・取得対象から削除。
    console.log("[1-7] v230: 今日の敵カードの不存在と不要fetch防止");
    enemyFixture = "今日の敵_v157本文";
    await seed({ selectedDate: TODAY, view: "home" });
    check("旧今日の敵カードは描画されない", await page.locator(".home-today-enemy").count() === 0);
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
