// v281: FABLE FUND R2 — タブ登録、30分キャッシュ、ヘッダ/保有/注文/約定の閲覧表示。
// Domains: GitHub Contents API sync/storage、token、cache、responsive render。
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const FUND_PATH = path.join(ROOT, "src", "features", "fund.js");
const STORE_PATH = path.join(ROOT, "src", "state", "store.js");
const CACHE_PATH = path.join(ROOT, "src", "state", "fund-cache.js");
const PORT = randomPort();
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

const FUND_FIXTURE = {
  version: 1,
  generatedAt: "2026-08-27T18:35:00+09:00",
  start: { date: "2026-08-07", capital: 20000000 },
  nav: {
    current: 20292650, dayChangePct: 0.89, totalReturnPct: 1.46,
    series: [{ date: "2026-08-07", nav: 20000000, n225: 64000, spx: 7500 }]
  },
  benchmark: { n225ReturnPct: 2.39, spxReturnPct: 2.33, excessVsN225: 1.58, excessVsSpx: -0.87 },
  cash: 14582150,
  positions: [{ code: "9432", name: "NTT", shares: 17000, avgCost: 166.5, lastClose: null, marketValue: null, pnlPct: null, openedAt: "2026-08-24", stopNote: "158円で撤退" }],
  openOrders: [{ id: "ORD-1", validFor: "2026-08-27", code: "5401", name: "日本製鉄", side: "buy", type: "stop", price: 710, shares: 3500, rationale: "高値更新", stopPlan: "直近安値割れ" }],
  recentTrades: [{ date: "2026-08-24", code: "8306", name: "三菱UFJ FG", side: "sell", type: "stop", price: 3489.5, shares: 700, pnl: -7350, rationale: "予定どおり撤退" }],
  journal: null
};

(async () => {
  const fund = await import(pathToFileURL(FUND_PATH).href);
  const store = await import(pathToFileURL(STORE_PATH).href);
  const { fundCache } = await import(pathToFileURL(CACHE_PATH).href);
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  console.log("[1] §3スキーマと30分キャッシュ: 境界再取得・成功/失敗時刻・前回正常値保持");
  store.setState({ settings: { github: {} } });
  fundCache.fetchedAt = 0;
  fundCache.data = undefined;
  let ready = false;
  let fetchResult = JSON.stringify(FUND_FIXTURE);
  let fetches = 0;
  fund.configureFund({
    escapeHTML, renderHeader: () => "<header>FUND</header>", personalDataReady: () => ready,
    fetchGitHubRawText: async (name) => {
      fetches++;
      check("取得先はdashboard/fund.json", name === "dashboard/fund.json", name);
      if (fetchResult instanceof Error) throw fetchResult;
      return fetchResult;
    }
  });
  const realDateNow = Date.now;
  let now = 10_000_000;
  Date.now = () => now;
  try {
    check("personalDataReady=falseではfetchしない", !(await fund.hydrateFundData(REFRESH_INTERVAL_MS)) && fetches === 0 && fundCache.fetchedAt === 0);
    ready = true;
    check("正常JSONを採用し成功時刻を記録", await fund.hydrateFundData(REFRESH_INTERVAL_MS) && fundCache.fetchedAt === now);
    const firstNormal = fundCache.data;
    const firstFetches = fetches;

    now += REFRESH_INTERVAL_MS - 1;
    fetchResult = "{broken";
    check("成功後30分未満は再取得しない", !(await fund.hydrateFundData(REFRESH_INTERVAL_MS)) && fetches === firstFetches && fundCache.data === firstNormal);
    now += 1;
    fetchResult = new Error("404");
    check("30分境界で再取得し、404でも前回正常値を保持して再描画対象", await fund.hydrateFundData(REFRESH_INTERVAL_MS) && fetches === firstFetches + 1 && fundCache.data === firstNormal && fundCache.fetchedAt === now);

    for (const [label, invalidRaw] of [
      ["必須キー欠損", JSON.stringify({ version: 1 })],
      ["positions null要素", JSON.stringify({ ...FUND_FIXTURE, positions: [null] })],
      ["openOrders非配列", JSON.stringify({ ...FUND_FIXTURE, openOrders: {} })],
      ["nav型不正", JSON.stringify({ ...FUND_FIXTURE, nav: "broken" })],
      ["配列要素型不正", JSON.stringify({ ...FUND_FIXTURE, recentTrades: ["broken"] })],
      ["非有限の巨大数", JSON.stringify(FUND_FIXTURE).replace('"current":20292650', '"current":1e309')]
    ]) {
      now += 1;
      fetchResult = invalidRaw;
      check(`${label}は失敗扱いで前回正常値保持・再描画対象`, await fund.hydrateFundData(0) && fundCache.data === firstNormal && fundCache.fetchedAt === now);
    }

    now += 1;
    fetchResult = "";
    check("空文字も失敗扱いで前回正常値保持・再描画対象", await fund.hydrateFundData(0) && fundCache.data === firstNormal && fundCache.fetchedAt === now);
    now += 1;
    fetchResult = "{broken";
    check("壊れJSONも失敗扱いで前回正常値保持・再描画対象", await fund.hydrateFundData(0) && fundCache.data === firstNormal && fundCache.fetchedAt === now);

    now += REFRESH_INTERVAL_MS;
    fetchResult = JSON.stringify({ ...FUND_FIXTURE, generatedAt: "2026-08-27T19:05:00+09:00" });
    check("期限切れ後の正常値を採用し成功時刻を更新", await fund.hydrateFundData(REFRESH_INTERVAL_MS) && fundCache.fetchedAt === now);
    const afterSuccessFetches = fetches;
    now += REFRESH_INTERVAL_MS - 1;
    check("再成功後も30分未満は再取得しない", !(await fund.hydrateFundData(REFRESH_INTERVAL_MS)) && fetches === afterSuccessFetches);
  } finally {
    Date.now = realDateNow;
  }

  console.log("[2] nullable値・空配列を例外なく表示する");
  fundCache.data = {
    ...FUND_FIXTURE, generatedAt: "",
    benchmark: { n225ReturnPct: null, spxReturnPct: null, excessVsN225: null, excessVsSpx: null },
    positions: [], openOrders: [], recentTrades: []
  };
  const emptyHtml = fund.renderFund();
  check("3セクションの空表示が揃う", ["保有ポジションはありません", "有効な注文はありません", "約定履歴はありません"].every((label) => emptyHtml.includes(label)));
  check("nullable値からNaN/undefinedを描画しない", !emptyHtml.includes("NaN") && !emptyHtml.includes("undefined"));
  fundCache.data = { ...FUND_FIXTURE, positions: [null], openOrders: ["broken"], recentTrades: [null] };
  check("防御的描画でも不正配列要素から例外を出さない", fund.renderFund().includes("保有ポジションはありません"));

  console.log("[3] 取得中表示→再描画、読み取り専用、実DOMの4領域、導線を固定する");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => { pageErrors.push(error.message); failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);
  let fundRequests = 0;
  let fundBody = JSON.stringify(FUND_FIXTURE);
  let holdFundResponse = true;
  let releaseFundResponse;
  await page.route((url) => url.hostname === "api.github.com", async (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    if (pathname.endsWith("/contents/taskchute/dashboard/fund.json")) {
      fundRequests++;
      if (holdFundResponse) await new Promise((resolve) => { releaseFundResponse = resolve; });
      return route.fulfill({ status: 200, contentType: "application/json", body: fundBody });
    }
    return route.fallback();
  });

  try {
    await page.goto(`http://localhost:${PORT}/`);
    const fundResponse = page.waitForResponse((response) => response.url().includes("/contents/taskchute/dashboard/fund.json"));
    const fundRequest = page.waitForRequest((request) => request.url().includes("/contents/taskchute/dashboard/fund.json"));
    await passGithubGate(page);
    await fundRequest;
    await page.locator('#bottomNav [data-action="nav"][data-view="more"]').click();
    check("FUNDはその他の振り返りグループ", await page.locator('.more-tower-item[data-view="fund"] small').textContent() === "振り返り");
    await page.locator('.more-tower-item[data-view="fund"]').click();
    await page.waitForSelector('.fund-view .fund-loading');
    check("取得中でもFUNDビューを描画", await page.locator('#app[data-view="fund"] .fund-loading').count() === 1);

    const stateBeforeHydrate = await page.evaluate((KEY) => {
      window.__fundOriginalSetItem = Storage.prototype.setItem;
      window.__fundStateWrites = 0;
      Storage.prototype.setItem = function(key, value) {
        if (key === KEY) window.__fundStateWrites++;
        return window.__fundOriginalSetItem.call(this, key, value);
      };
      return localStorage.getItem(KEY);
    }, "taskchute-journal-pwa-state-v1");
    holdFundResponse = false;
    releaseFundResponse();
    await fundResponse;
    await page.waitForSelector('.fund-view .fund-summary');
    const readonlyResult = await page.evaluate((KEY) => ({
      state: localStorage.getItem(KEY), writes: window.__fundStateWrites,
      dataModifiedAt: JSON.parse(localStorage.getItem(KEY)).dataModifiedAt
    }), "taskchute-journal-pwa-state-v1");
    const dataModifiedAtBefore = JSON.parse(stateBeforeHydrate).dataModifiedAt;
    check("取得・再描画は永続stateを変更しない", readonlyResult.state === stateBeforeHydrate && readonlyResult.dataModifiedAt === dataModifiedAtBefore, readonlyResult.state);
    check("取得・再描画中のlocalStorage保存は0回", readonlyResult.writes === 0, String(readonlyResult.writes));
    await page.evaluate(() => { Storage.prototype.setItem = window.__fundOriginalSetItem; });

    check("FUNDビューへ遷移", await page.locator('#app[data-view="fund"]').count() === 1);
    // v287: 実行ボタンへ未着手バッジが共存するためテキスト全量でなくid+先頭ラベルの厳密比較(v278と同型)
    const mobileItems = await page.$$eval("#bottomNav button", (elements) => elements.map((element) => ({
      id: element.dataset.view, label: element.childNodes[0].textContent
    })));
    // v333: 実行タブ統合で4項目化(「時間」廃止)。仕様変更としてセレクタ追随。
    check("mobileNavは4項目のままFUNDを含まない",
      JSON.stringify(mobileItems) === JSON.stringify([
        { id: "today", label: "今日" }, { id: "journal", label: "ジャーナル" },
        { id: "exec", label: "実行" }, { id: "more", label: "その他" }
      ]), JSON.stringify(mobileItems));
    check("PCサイドバーにはFUNDを追加", (await page.locator('.nav-list [data-view="fund"]').count()) === 1);
    const summaryText = await page.locator(".fund-summary").textContent();
    check("ヘッダ指標はラベル・NAV・比率・整形時刻を表示", ["NAV", "¥20,292,650", "起点比", "+1.46%", "対日経", "+1.58%", "対S&P", "-0.87%", "現金比率", "71.86%", "生成時刻", "2026-08-27 18:35"].every((marker) => summaryText.includes(marker)), summaryText);
    check("現金比率には損益用のプラス符号を付けない", !summaryText.includes("+71.86%"), summaryText);

    const sections = page.locator(".fund-section");
    check("保有・注文・約定の3セクション順を固定", JSON.stringify(await sections.locator("h2").allTextContents()) === JSON.stringify(["保有ポジション", "当日有効注文", "直近の約定"]));
    const positionText = await sections.nth(0).textContent();
    check("保有カードは銘柄・株数・建値・現値・STOPを表示", ["9432", "NTT", "17,000株", "建値 ¥166.5", "現値 —", "158円で撤退"].every((marker) => positionText.includes(marker)), positionText);
    const orderText = await sections.nth(1).textContent();
    check("注文カードはside/type/価格/株数・銘柄を表示", ["5401", "日本製鉄", "買・逆指値", "¥710", "3,500株"].every((marker) => orderText.includes(marker)), orderText);
    check("注文の根拠とストップ計画を正しいdetailsへ格納", JSON.stringify(await sections.nth(1).locator("details summary").allTextContents()) === JSON.stringify(["根拠", "ストップ計画"]) && (await sections.nth(1).locator("details").nth(0).textContent()).includes("高値更新") && (await sections.nth(1).locator("details").nth(1).textContent()).includes("直近安値割れ"));
    const tradeText = await sections.nth(2).textContent();
    check("約定カードは日付・銘柄・side/type/価格/株数・損益を表示", ["2026-08-24", "8306", "三菱UFJ FG", "売・逆指値", "¥3,489.5 × 700株", "実現 -¥7,350"].every((marker) => tradeText.includes(marker)), tradeText);
    check("約定の根拠を約定セクションのdetailsへ格納", (await sections.nth(2).locator("details summary").textContent()) === "根拠" && (await sections.nth(2).locator("details").textContent()).includes("予定どおり撤退"));
    check("fund.jsonは起動中1回だけ取得", fundRequests === 1, String(fundRequests));
    check("390pxで横スクロールなし", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    fundBody = JSON.stringify({ ...FUND_FIXTURE, positions: [null] });
    const cacheBeforeInvalid = await page.evaluate(async () => (await import("/src/state/fund-cache.js")).fundCache.fetchedAt);
    const invalidResponse = page.waitForResponse((response) => response.url().includes("/contents/taskchute/dashboard/fund.json"));
    const futureNow = cacheBeforeInvalid + REFRESH_INTERVAL_MS;
    await page.evaluate((future) => {
      window.__fundRealDateNow = Date.now;
      Date.now = () => future;
      document.dispatchEvent(new Event("visibilitychange"));
    }, futureNow);
    await invalidResponse;
    await page.waitForFunction(async (future) => (await import("/src/state/fund-cache.js")).fundCache.fetchedAt === future, futureNow);
    await page.evaluate(() => { Date.now = window.__fundRealDateNow; });
    check("不正配列要素の再取得後も前回正常DOMを保持し描画クラッシュしない", (await sections.nth(0).textContent()).includes("NTT") && await page.locator(".fund-summary").count() === 1 && pageErrors.length === 0, JSON.stringify(pageErrors));

    fundBody = JSON.stringify(FUND_FIXTURE);
    const reloadResponse = page.waitForResponse((response) => response.url().includes("/contents/taskchute/dashboard/fund.json"));
    await page.reload();
    await reloadResponse;
    await page.waitForSelector('.fund-view .fund-summary');
    check("allowedViewsがfundを保持しtodayへ縮退しない", await page.locator('#app[data-view="fund"]').count() === 1);
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.locator('.nav-list [data-view="today"]').click();
    await page.locator('.nav-list [data-view="fund"]').click();
    check("PCサイドバーのdata-actionでFUNDへ実遷移", await page.locator('#app[data-view="fund"] .fund-summary').count() === 1);
    check("1024pxで横スクロールなし", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  } finally {
    releaseFundResponse?.();
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\n❌ v281: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\n✅ v281: all checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
