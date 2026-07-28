// v161 検証: AI機能第5弾(最終)「エネルギーカーブ」(K発注仕様
// workbench/out/2026-07-27-taskchute-ai5/spec.md 機能5)。CHANGES_v161.md参照。
//
// バッチ側(loop/scripts/energy-curve.sh、決定論)が personal-data/taskchute/energy-curve.json
// (単一の上書きファイル。日付を含まないファイル名)へ直近28日の時間帯別{実行数,充放電net,
// 着手率}を集計してpushする。アプリ側は計器盤(統計)の詳細層に「エネルギーカーブ(時間帯別)」
// 節として棒グラフ表示するのみ(集計はバッチ側、アプリは描画のみ)。
//
// (1) energy-curve.jsonが取得できる(スキーマ正常)場合、計器盤の詳細details内に
//     「エネルギーカーブ(時間帯別)」節が表示され、24時間分のセルが描画される
// (2) count>=3かつnetAvgが正の時間帯は緑(pos)クラス、負の時間帯は赤(neg)クラスが付く
// (3) netAvg/startRateがnull(3件未満)の時間帯は色クラスが付かない(data-net-class=""空)
// (4) count=0の時間帯は棒(.energy-curve-fill)自体が描画されない
// (5) 着手率がバー下に可視テキストとして表示される(title属性頼みにしない。iOS実機対策)
// (6) energy-curve.jsonが無い(404)場合は節ごと非表示
// (7) 壊れたJSON(パース不能)の場合は節ごと非表示
// (8) hourlyが24件でない(スキーマ不正)場合は節ごと非表示
// (9) hourly全24件がcount=0(実データ無し)の場合は節ごと非表示(2026-07-28レビュー対応・必須修正3)
// (10) 公開Pages側(同一オリジン)へのenergy-curve.jsonのfetchは一切発生しない(同一オリジン
//      fetch回帰の防止)
// (11) api.github.com の taskchute/energy-curve.json へ実際にリクエストが飛んでいる(裏取り)
// (12) 初回取得から30分以上経過後、visibilitychange復帰でバッチの新着カーブが再取得され
//      表示に反映される(2026-07-28レビュー対応・必須修正4。日付キーではなくTTLキャッシュに
//      した効果の直接検証)
//
// 方針: v158.test.js/v138.test.js/v77.test.jsと同じ作法(ブラウザ操作 + page.route +
// localStorage直接注入 + page.clock)。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const API_HOST = "api.github.com";
const FEEDBACK_REFRESH_INTERVAL_MS = 30 * 60 * 1000;  // app.js側の定数と同値(TTL検証用)

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function makeHourly({ overrides = {} } = {}) {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, netAvg: null, startRate: null }));
  Object.entries(overrides).forEach(([hourStr, row]) => {
    const hour = Number(hourStr);
    hourly[hour] = { hour, ...hourly[hour], ...row };
  });
  return hourly;
}

const VALID_FIXTURE = JSON.stringify({
  generatedAt: "2026-07-28T05:30:00",
  days: 28,
  hourly: makeHourly({
    overrides: {
      9: { count: 5, netAvg: 2.5, startRate: 80 },   // 充電傾向(pos)
      14: { count: 6, netAvg: -1.5, startRate: 40 }, // 放電傾向(neg)
      11: { count: 1, netAvg: null, startRate: null }, // サンプル不足(棒は出るが色なし)
      12: { count: 0, netAvg: null, startRate: null }, // 実行0件(棒自体が無い)
    },
  }),
});

const ALL_ZERO_FIXTURE = JSON.stringify({
  generatedAt: "2026-07-28T05:30:00",
  days: 28,
  hourly: makeHourly(),  // 全24件count=0・netAvg/startRateすべてnull
});

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1200 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);

  // (10)用: 公開Pages側(同一オリジン)へのenergy-curve.jsonへのリクエストを全て記録する
  const sameOriginRequests = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(`http://localhost:${PORT}/`) && /energy-curve\.json/.test(url)) {
      sameOriginRequests.push(url);
    }
  });

  let energyCurveFixture = null;  // null=404、文字列=生body(JSON文字列 or 壊れたテキスト)
  const energyCurveApiRequests = [];
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const u = new URL(route.request().url());
    const p = decodeURIComponent(u.pathname);
    if (/\/contents\/taskchute\/energy-curve\.json$/.test(p)) {
      energyCurveApiRequests.push(p);
      if (energyCurveFixture === null) {
        return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: energyCurveFixture });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  async function seedStats() {
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = [];
      s.currentView = "stats";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(700);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (1)(2)(3)(4)(5)(11) スキーマ正常: 節が表示され、色分け・null/0件・可視着手率が正しい
    // ============================================================
    console.log("[1][2][3][4][5][11] energy-curve.jsonが正常な場合、計器盤詳細に節が出て色分け・null/0件・可視着手率が正しく描画される");
    energyCurveFixture = VALID_FIXTURE;
    await seedStats();

    check("api.github.comのtaskchute/energy-curve.jsonへリクエストが実際に飛んでいる(裏取り)",
      energyCurveApiRequests.some((p) => p.endsWith("energy-curve.json")), JSON.stringify(energyCurveApiRequests));

    const sectionH2 = page.locator('details[data-fold-id="stats-details"] h2', { hasText: "エネルギーカーブ(時間帯別)" });
    check("『エネルギーカーブ(時間帯別)』節が計器盤の詳細details内に表示される", await sectionH2.count() === 1);

    const cells = page.locator(".energy-curve-cell");
    check("24時間分のセルが描画される", await cells.count() === 24, String(await cells.count()));

    const cell9 = page.locator('.energy-curve-cell[data-hour="9"]');
    check("count=5・netAvg正の時間帯(9時)はposクラスが付く", await cell9.getAttribute("data-net-class") === "pos");
    check("9時のバーに.energy-curve-fillが描画される", await cell9.locator(".energy-curve-fill").count() === 1);
    const rate9 = (await cell9.locator(".energy-curve-rate").textContent()).trim();
    check("着手率(80%)がtitle頼みでなくバー下に可視テキストとして表示される(iOS実機対策)",
      rate9 === "80", rate9);

    const cell14 = page.locator('.energy-curve-cell[data-hour="14"]');
    check("count=6・netAvg負の時間帯(14時)はnegクラスが付く", await cell14.getAttribute("data-net-class") === "neg");

    const cell11 = page.locator('.energy-curve-cell[data-hour="11"]');
    check("count=1(3件未満)でnetAvg=nullの時間帯(11時)は色クラスが付かない", await cell11.getAttribute("data-net-class") === "");
    check("11時はcount>0のためバー自体は描画される(高さの色だけ無い)", await cell11.locator(".energy-curve-fill").count() === 1);
    const rate11 = (await cell11.locator(".energy-curve-rate").textContent()).trim();
    check("startRateがnull(サンプル不足)の時間帯は着手率テキストが空欄", rate11 === "", rate11);

    const cell12 = page.locator('.energy-curve-cell[data-hour="12"]');
    check("count=0の時間帯(12時)はバー(.energy-curve-fill)自体が描画されない", await cell12.locator(".energy-curve-fill").count() === 0);

    // ============================================================
    // (6) ファイルが無い(404): 節ごと非表示
    // ============================================================
    console.log("[6] energy-curve.jsonが無い(404)場合は節ごと非表示");
    energyCurveFixture = null;
    await seedStats();
    check("404の場合『エネルギーカーブ』節が出ない",
      await page.locator('details[data-fold-id="stats-details"] h2', { hasText: "エネルギーカーブ(時間帯別)" }).count() === 0);

    // ============================================================
    // (7) 壊れたJSON: 節ごと非表示
    // ============================================================
    console.log("[7] energy-curve.jsonがJSONとしてパースできない場合は節ごと非表示");
    energyCurveFixture = "{ this is not valid json ,,,";
    await seedStats();
    check("壊れたJSONの場合『エネルギーカーブ』節が出ない",
      await page.locator('details[data-fold-id="stats-details"] h2', { hasText: "エネルギーカーブ(時間帯別)" }).count() === 0);

    // ============================================================
    // (8) hourlyが24件でない(スキーマ不正): 節ごと非表示
    // ============================================================
    console.log("[8] hourlyが24件でない(スキーマ不正)場合は節ごと非表示");
    energyCurveFixture = JSON.stringify({
      generatedAt: "2026-07-28T05:30:00",
      days: 28,
      hourly: makeHourly().slice(0, 23),  // 23件しかない不正データ
    });
    await seedStats();
    check("hourlyが23件(不正)の場合『エネルギーカーブ』節が出ない",
      await page.locator('details[data-fold-id="stats-details"] h2', { hasText: "エネルギーカーブ(時間帯別)" }).count() === 0);

    // ============================================================
    // (9) hourly全24件がcount=0(実データ無し): 節ごと非表示
    // ============================================================
    console.log("[9] hourly全件がcount=0(実データ無し)の場合は節ごと非表示(2026-07-28レビュー対応・必須修正3)");
    energyCurveFixture = ALL_ZERO_FIXTURE;
    await seedStats();
    check("全時間帯count=0の場合『エネルギーカーブ』節が出ない(スキーマは正常でも空チャートを出さない)",
      await page.locator('details[data-fold-id="stats-details"] h2', { hasText: "エネルギーカーブ(時間帯別)" }).count() === 0);

    // ============================================================
    // (10) 公開Pages側(同一オリジン)へのenergy-curve.jsonのfetchは一切発生しない
    // ============================================================
    console.log("[10] 公開Pages側(同一オリジン)へのenergy-curve.jsonのfetchは一度も発生しない");
    check("同一オリジンでのenergy-curve.jsonへのリクエストが0件(すべてapi.github.com経由)",
      sameOriginRequests.length === 0, JSON.stringify(sameOriginRequests));

    // ============================================================
    // (12) TTL(30分)経過後、visibilitychange復帰で新着カーブが再取得され表示に反映される
    // ============================================================
    console.log("[12] 初回取得から30分以上経過後、visibilitychange復帰でバッチの新着カーブが再取得・反映される(日付キーでなくTTLキャッシュにした効果)");
    const FIXTURE_A = JSON.stringify({
      generatedAt: "2026-07-28T05:30:00",
      days: 28,
      hourly: makeHourly({ overrides: { 9: { count: 5, netAvg: 2.0, startRate: 60 } } }),  // pos
    });
    const FIXTURE_B = JSON.stringify({
      generatedAt: "2026-07-28T09:00:00",  // バッチが同日中に再pushし、生成時刻が進んだ想定
      days: 28,
      hourly: makeHourly({ overrides: { 9: { count: 5, netAvg: -2.0, startRate: 20 } } }),  // neg(A→反転)
    });
    energyCurveFixture = FIXTURE_A;
    await seedStats();  // 初回取得(フルreloadでfetchedAtがリセットされ、TTL関係なく必ず取得する)
    const cell9BeforeRefresh = page.locator('.energy-curve-cell[data-hour="9"]');
    check("[12前提] 初回取得直後はFIXTURE_A(pos)が表示されている", await cell9BeforeRefresh.getAttribute("data-net-class") === "pos");

    // 31分経過させる(FEEDBACK_REFRESH_INTERVAL_MS=30分のTTLを超えさせる。多重発火防止の
    // 最短間隔=60秒ガードも十分超えている)。その間にバッチが energy-curve.json を再pushしたと想定。
    await page.clock.setFixedTime(new Date(now0.getTime() + FEEDBACK_REFRESH_INTERVAL_MS + 60 * 1000));
    energyCurveFixture = FIXTURE_B;
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(700);
    const cell9AfterRefresh = page.locator('.energy-curve-cell[data-hour="9"]');
    check("30分経過後のvisibilitychange復帰でFIXTURE_B(neg)へ再fetch・反映される(再起動不要)",
      await cell9AfterRefresh.getAttribute("data-net-class") === "neg");
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
