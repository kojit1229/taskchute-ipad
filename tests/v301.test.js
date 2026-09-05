// v301: FABLE FUND R3 — NAV3本線SVG、既存Markdown日誌、120時間鮮度バッジ。
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const FUND_PATH = path.join(ROOT, "src", "features", "fund.js");
const STORE_PATH = path.join(ROOT, "src", "state", "store.js");
const CACHE_PATH = path.join(ROOT, "src", "state", "fund-cache.js");
const PORT = randomPort();
const HOUR_MS = 60 * 60 * 1000;
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

const FUND_FIXTURE = {
  version: 1,
  generatedAt: "2026-08-30T11:00:00+09:00",
  start: { date: "2026-08-07", capital: 20000000 },
  nav: {
    current: 20400000, dayChangePct: 0.7, totalReturnPct: 2,
    series: [
      { date: "2026-08-07", nav: 20000000, n225: 40000, spx: 6500 },
      { date: "2026-08-30", nav: 20400000, n225: 40400, spx: 6630 }
    ]
  },
  benchmark: { n225ReturnPct: 1, spxReturnPct: 2, excessVsN225: 1, excessVsSpx: 0 },
  cash: 10000000,
  positions: [],
  openOrders: [],
  recentTrades: [],
  journal: { date: "2026-08-30", markdown: "# 運用日誌\n\n**既存Markdown経路**" }
};

(async () => {
  const fund = await import(pathToFileURL(FUND_PATH).href);
  const store = await import(pathToFileURL(STORE_PATH).href);
  const { fundCache } = await import(pathToFileURL(CACHE_PATH).href);
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  let markdownInput = "";
  let fetchBody = "";
  fund.configureFund({
    escapeHTML,
    renderHeader: () => "<header>FUND</header>",
    renderMarkdown: (markdown) => { markdownInput = markdown; return "<strong>既存Markdown経路</strong>"; },
    personalDataReady: () => true,
    fetchGitHubRawText: async () => fetchBody
  });
  store.setState({ settings: { github: {} } });

  console.log("[1] 主要経路: 2点以上を起点100へ正規化した3本線・日誌・120時間以内");
  const realDateNow = Date.now;
  Date.now = () => Date.UTC(2026, 7, 30, 3, 0, 0);
  try {
    fundCache.data = FUND_FIXTURE;
    const html = fund.renderFund();
    const paths = [...html.matchAll(/<path class="fund-chart-line [^"]+" d="([^"]+)"/g)].map((match) => match[1]);
    check("NAV・日経・S&P500の3 pathを描画", paths.length === 3, JSON.stringify(paths));
    check("2点では3本とも折れ線になる", paths.every((value) => value.includes("L")), JSON.stringify(paths));
    check("3本の起点座標は同じ=起点100正規化", new Set(paths.map((value) => value.split("L")[0])).size === 1, JSON.stringify(paths));
    check("journal.markdownを既存rendererへそのまま渡す", markdownInput === FUND_FIXTURE.journal.markdown && html.includes("<strong>既存Markdown経路</strong>"));
    check("120時間以内は鮮度バッジ非表示", !html.includes("fund-stale-badge"));
    // v357: FUND_FIXTUREは保有0・注文0・約定0のため2セクションが1枚の統合空表示へ変わる。
    const order = ["fund-summary", "fund-chart", "まだ取引記録がありません", "fund-journal"].map((marker) => html.indexOf(marker));
    check("ヘッダ→チャート→保有活動(統合空表示)→日誌の順", order.every((value, index) => value >= 0 && (!index || value > order[index - 1])), JSON.stringify(order));

    console.log("[2] 負例: series 1点・journal null/undefined/キー欠損・鮮度境界");
    const onePoint = { ...FUND_FIXTURE, nav: { ...FUND_FIXTURE.nav, series: FUND_FIXTURE.nav.series.slice(0, 1) } };
    for (const [label, data] of [
      ["null", { ...onePoint, journal: null }],
      ["undefined", { ...onePoint, journal: undefined }],
      ["キー欠損", (() => { const value = { ...onePoint }; delete value.journal; return value; })()]
    ]) {
      fundCache.data = data;
      let rendered = "";
      let error;
      try { rendered = fund.renderFund(); } catch (caught) { error = caught; }
      check(`series 1点+journal ${label}でも例外なし`, !error && rendered.includes("fund-chart"), error?.message || "");
      check(`journal ${label}では日誌セクションを出さない`, !rendered.includes("fund-journal"));
      check(`series 1点は3つの点で表示`, (rendered.match(/<circle class="fund-chart-dot/g) || []).length === 3);
    }

    fundCache.data = { ...FUND_FIXTURE, generatedAt: "2026-08-25T11:59:59+09:00" };
    check("120時間超で『データが古い』バッジ表示", fund.renderFund().includes("データが古い"));
    fundCache.data = { ...FUND_FIXTURE, generatedAt: "2026-08-25T12:00:00+09:00" };
    check("120時間ちょうどではバッジ非表示", !fund.renderFund().includes("fund-stale-badge"));

    for (const [label, journalValue] of [["null", null], ["キー欠損", undefined]]) {
      const candidate = { ...FUND_FIXTURE, journal: journalValue };
      if (label === "キー欠損") delete candidate.journal;
      fetchBody = JSON.stringify(candidate);
      fundCache.fetchedAt = 0;
      fundCache.data = undefined;
      check(`取得スキーマもjournal ${label}を受理`, await fund.hydrateFundData(0) && fundCache.data?.nav?.series?.length === 2);
    }
  } finally {
    Date.now = realDateNow;
  }

  console.log("[3] 実ブラウザ: actual marked経路・SVG DOM・390px表示");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => { pageErrors.push(error.message); });
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === "api.github.com", async (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    if (pathname.endsWith("/contents/taskchute/dashboard/fund.json")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FUND_FIXTURE) });
    }
    return route.fallback();
  });
  try {
    await page.goto(`http://localhost:${PORT}/`);
    const response = page.waitForResponse((item) => item.url().includes("/contents/taskchute/dashboard/fund.json"));
    await passGithubGate(page);
    await response;
    await page.locator('#bottomNav [data-view="more"]').click();
    await page.locator('.more-tower-item[data-view="fund"]').click();
    await page.waitForSelector(".fund-journal strong");
    check("実DOMに3本線SVG", await page.locator(".fund-chart path.fund-chart-line").count() === 3);
    check("actual renderMarkdown/markedでstrongへ変換", await page.locator(".fund-journal strong").textContent() === "既存Markdown経路");
    check("390pxで横スクロールなし", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    check("pageerrorなし", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\n❌ v301: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\n✅ v301: all checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
