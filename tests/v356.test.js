// v356: FUND表示 — 保有理由・利確/損切りと根拠・注文の理由・起点100の3系列・平易版日誌・
// 再取得・3状態+「時点(古い)」。実装はimplementer(Codex利用上限のためClaudeフォールバック)。
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const FUND_PATH = path.join(ROOT, "src", "features", "fund.js");
const STORE_PATH = path.join(ROOT, "src", "state", "store.js");
const CACHE_PATH = path.join(ROOT, "src", "state", "fund-cache.js");
const ACTIONS_PATH = path.join(ROOT, "src", "ui", "actions.js");
const PORT = randomPort();
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

const FUND_FIXTURE = {
  version: 1,
  generatedAt: "2026-09-04T18:34:00+09:00",
  start: { date: "2026-08-07", capital: 20000000 },
  nav: {
    current: 20379550, dayChangePct: -0.3, totalReturnPct: 1.9,
    series: [
      { date: "2026-08-07", nav: 20000000, n225: 65606.71, spx: 7709.96 },
      { date: "2026-09-04", nav: 20379550, n225: 65020.94, spx: 7747.71 }
    ]
  },
  benchmark: { n225ReturnPct: -0.89, spxReturnPct: 0.49, excessVsN225: 2.79, excessVsSpx: 1.41 },
  cash: 14582150,
  positions: [
    {
      code: "9432", name: "NTT", shares: 17000, avgCost: 166.5, lastClose: 172.6,
      marketValue: 2934200, pnlPct: 3.66, openedAt: "2026-08-24",
      stopNote: "158.0円(建値-5.1%)に売り逆指値",
      reasonPlain: "2026-08-24にNTTを17,000株、166.5円で買いました。\n52週の高値166.2円を超えたためです。",
      takeProfit: { price: null, basis: "利確の指値はなし(利は伸ばす)" },
      stopLoss: { price: 171.5, basis: "トレーリングで171.5円へ上げました。" }
    },
    {
      code: "9101", name: "日本郵船", shares: 400, avgCost: 6450, lastClose: 7158,
      marketValue: 2863200, pnlPct: 10.98, openedAt: "2026-08-17",
      stopNote: "",
      reasonPlain: "",
      takeProfit: { price: 7500, basis: "+15%の指値" },
      stopLoss: { price: 6000, basis: "6,000円まで下がったら売る" }
    }
  ],
  openOrders: [],
  recentTrades: [],
  orders: [{
    id: "ORD-1", validFor: "2026-09-07", side: "sell", type: "stop", code: "9432", name: "NTT",
    price: 171.5, shares: 17000, rationale: "day order制のため毎晩張り直し。",
    stopPlan: "171.5円据え置き", whyPlain: "下落の線を171.5円に保ち、17,000株を守るためです。"
  }],
  fills: [{
    date: "2026-09-04", side: "buy", type: "stop", code: "9101", name: "日本郵船", shares: 400,
    price: 6450, pnl: null, rationale: "52週高値ブレイク",
    whyPlain: "52週の高値を6,450円で超えたら400株買うためです。"
  }],
  journal: null,
  series: {
    dates: ["2026-08-07", "2026-09-04"],
    fund: [100.0, 101.8978], n225: [100.0, 99.1071], spx: [100.0, 100.4896]
  },
  journalPlain: "## きょう何が起きた?\n\n- NAVは20,379,550円です。\n\n## なぜそうなった?\n\n- 円が急に強くなりました。\n\n## あした何をする?\n\n- 注文を出し直します。\n\n## 用語メモ\n\n- 逆指値は自動で売る注文です。"
};
const EMPTY_FUND_FIXTURE = {
  ...FUND_FIXTURE, positions: [], openOrders: [], recentTrades: [], orders: [], fills: [], journalPlain: null
};

(async () => {
  const fund = await import(pathToFileURL(FUND_PATH).href);
  const store = await import(pathToFileURL(STORE_PATH).href);
  const { fundCache } = await import(pathToFileURL(CACHE_PATH).href);
  const { dispatchAction } = await import(pathToFileURL(ACTIONS_PATH).href);
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const renderMarkdown = (markdown) => markdown; // 生markdownをそのまま流し込み、見出し4本の到達を検証する。

  console.log("[0] ソース静的チェック: new Date(\"文字列\")を使っていない");
  const source = fs.readFileSync(FUND_PATH, "utf-8");
  check("fund.jsに new Date(\" を含む危険な日時パースが無い", !/new Date\(\s*["'`]/.test(source), source.match(/new Date\([^)]*/)?.[0] || "");

  console.log("[1] 5節の順序と各節の内容(理由・指値/逆指値%・whyPlain・凡例3つ・起点100灰線)");
  let fetches = 0;
  let renders = 0;
  let fetchBody = JSON.stringify(FUND_FIXTURE);
  fund.configureFund({
    escapeHTML, renderHeader: (eyebrow, title, action) => `<header>${title}${action || ""}</header>`,
    renderMarkdown, personalDataReady: () => true,
    fetchGitHubRawText: async () => { fetches++; return fetchBody; },
    render: () => { renders++; }
  });
  store.setState({ settings: { github: {} } });
  Object.assign(fundCache, { fetchedAt: 0, data: undefined, lastError: "", lastAttemptAt: 0 });
  await fund.hydrateFundData(0);
  const html = fund.renderFund();
  const order = ["fund-summary", "fund-chart", "保有ポジション", "今日の注文と約定", "fund-journal"].map((marker) => html.indexOf(marker));
  check("ヘッダ→チャート→保有→注文と約定→日誌の順", order.every((value, index) => value >= 0 && (!index || value > order[index - 1])), JSON.stringify(order));
  check("買った理由(reasonPlain)を表示", html.includes("52週の高値166.2円を超えたためです"));
  check("reasonPlain欠損は—", html.includes("買った理由: —"));
  check("利確 指値が null は—", html.includes("利確 指値 —"));
  check("損切り 逆指値%はavgCost基準で計算(+3.00%)", html.includes("損切り 逆指値 ¥171.5(+3.00%)"));
  check("利確 指値%はavgCost基準で計算(+16.28%)", html.includes("利確 指値 ¥7,500(+16.28%)"));
  check("損切り 逆指値%の負値表示(-6.98%)", html.includes("損切り 逆指値 ¥6,000(-6.98%)"));
  check("注文のなぜ(whyPlain)を表示", html.includes("なぜ: 下落の線を171.5円に保ち、17,000株を守るためです。"));
  check("約定のなぜ(whyPlain)を表示", html.includes("なぜ: 52週の高値を6,450円で超えたら400株買うためです。"));
  check("注文行は「有効」ラベルを表示", html.includes(">有効<"));
  check("約定行は「約定」ラベルを表示", html.includes(">約定<"));
  check("注文行はストップ計画(stopPlan)を復帰表示", html.includes("ストップ計画: 171.5円据え置き"));
  check("保有の根拠はtakeProfit.basis/stopLoss.basisを平易文で優先表示(stopNoteではない)",
    html.includes("根拠</b> 利確: 利確の指値はなし(利は伸ばす) ・ 損切り: トレーリングで171.5円へ上げました。")
    && !html.includes("158.0円(建値-5.1%)に売り逆指値"));
  check("2件目のbasisも利確・損切り両方を結合表示", html.includes("根拠</b> 利確: +15%の指値 ・ 損切り: 6,000円まで下がったら売る"));
  check("凡例3つ(NAV/日経/S&P500)", (html.match(/<span class="fund-chart-key/g) || []).length === 3);
  check("起点100の灰の基準線を描画", html.includes("fund-chart-baseline"));
  check("日誌は平易版journalPlainの4見出しを表示", ["きょう何が起きた?", "なぜそうなった?", "あした何をする?", "用語メモ"].every((h) => html.includes(h)));

  console.log("[1b] 日経=破線・S&P500=点線のCSSが定義されている(静的確認)");
  const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf-8");
  check("is-n225にstroke-dasharray(破線)がある", /\.fund-chart-line\.is-n225\s*\{[^}]*stroke-dasharray/.test(css));
  check("is-spxにstroke-dasharray(点線)がある", /\.fund-chart-line\.is-spx\s*\{[^}]*stroke-dasharray/.test(css));

  console.log("[1c] 上位series(dates/fund/n225/spx)を起点100のまま使い、欠損(null)は線を途切れさせる");
  const SERIES_GAP_FIXTURE = {
    ...FUND_FIXTURE,
    series: {
      dates: ["2026-08-07", "2026-08-20", "2026-09-04"],
      fund: [100.0, 101.0, 101.8978],
      n225: [100.0, null, 99.1071], // 中日が欠損 → 日経の線は2区間に分かれる
      spx: [100.0, 100.2, 100.4896]
    }
  };
  fund.configureFund({
    escapeHTML, renderHeader: (eyebrow, title, action) => `<header>${title}${action || ""}</header>`,
    renderMarkdown, personalDataReady: () => true,
    fetchGitHubRawText: async () => JSON.stringify(SERIES_GAP_FIXTURE),
    render: () => {}
  });
  Object.assign(fundCache, { fetchedAt: 0, data: undefined, lastError: "", lastAttemptAt: 0 });
  await fund.hydrateFundData(0);
  const seriesHtml = fund.renderFund();
  check("x軸の日付範囲はseries.datesの両端(2026-08-07〜2026-09-04)", seriesHtml.includes("2026-08-07") && seriesHtml.includes("2026-09-04"));
  const navPath = seriesHtml.match(/<path class="fund-chart-line is-nav" d="([^"]+)"/)?.[1] || "";
  const n225Path = seriesHtml.match(/<path class="fund-chart-line is-n225" d="([^"]+)"/)?.[1] || "";
  check("NAV線(欠損なし)はseriesの点数どおり3点(M1+L2)で描画", (navPath.match(/[ML]/g) || []).length === 3, navPath);
  check("日経線は中日の欠損でパスが2つに分かれる(M2つ)", (n225Path.match(/M/g) || []).length === 2, n225Path);
  check("nav.seriesはフォールバックのため、上位seriesがある間は無視される(NAV総資産の点数はnav.seriesの2点のまま変わらない)",
    SERIES_GAP_FIXTURE.nav.series.length === 2);

  console.log("[1d] orders/fillsは要素単位で寛容に扱う: 壊れた1要素があってもFUNDデータ全体を棄却しない(M5負例)");
  const BROKEN_ELEMENT_FIXTURE = {
    ...FUND_FIXTURE,
    orders: [...FUND_FIXTURE.orders, { id: "ORD-BROKEN" }] // code/sideが無い壊れた要素
  };
  fund.configureFund({
    escapeHTML, renderHeader: (eyebrow, title, action) => `<header>${title}${action || ""}</header>`,
    renderMarkdown, personalDataReady: () => true,
    fetchGitHubRawText: async () => JSON.stringify(BROKEN_ELEMENT_FIXTURE),
    render: () => {}
  });
  Object.assign(fundCache, { fetchedAt: 0, data: undefined, lastError: "", lastAttemptAt: 0 });
  await fund.hydrateFundData(0);
  check("壊れた要素が1件混ざってもFUNDデータ全体を棄却しない(schema通過)", !!fundCache.data && fundCache.lastError === "");
  const brokenHtml = fund.renderFund();
  check("code/sideの無い壊れた要素はそれ自体は描画されない", !brokenHtml.includes("ORD-BROKEN"));
  check("壊れた要素と同居する正常な注文は描画され続ける", brokenHtml.includes("なぜ: 下落の線を171.5円に保ち、17,000株を守るためです。"));
  check("壊れた要素混在でも取得失敗表示にはならない", !brokenHtml.includes("FUNDデータの形式が正しくありません") && !brokenHtml.includes("FUNDデータを取得できませんでした"));

  console.log("[2] 再取得ボタンでfetchが1回走り「HH:MM時点」が更新、連打で1回");
  let renderWaiters = [];
  const waitRender = () => new Promise((resolve) => renderWaiters.push(resolve));
  let gate;
  let releaseGate;
  fund.configureFund({
    escapeHTML, renderHeader: (eyebrow, title, action) => `<header>${title}${action || ""}</header>`,
    renderMarkdown, personalDataReady: () => true,
    fetchGitHubRawText: async () => { fetches++; await gate; return fetchBody; },
    render: () => { renders++; const waiters = renderWaiters.splice(0); waiters.forEach((resolve) => resolve()); }
  });
  Object.assign(fundCache, { fetchedAt: 0, data: undefined, lastError: "", lastAttemptAt: 0 });
  fetches = 0;
  gate = new Promise((resolve) => { releaseGate = resolve; });
  const firstRenderDone = waitRender();
  dispatchAction("fund-refresh", {});
  dispatchAction("fund-refresh", {}); // 連打
  releaseGate();
  await firstRenderDone;
  check("連打してもfetchは1回だけ", fetches === 1, String(fetches));
  check("成功後は「18:34 時点」を表示", fund.renderFund().includes("18:34 時点"));

  fetchBody = JSON.stringify({ ...FUND_FIXTURE, generatedAt: "2026-09-04T19:10:00+09:00" });
  gate = new Promise((resolve) => { releaseGate = resolve; });
  const secondRenderDone = waitRender();
  dispatchAction("fund-refresh", {});
  releaseGate();
  await secondRenderDone;
  check("再取得後は新しい生成時刻「19:10 時点」に更新", fund.renderFund().includes("19:10 時点") && !fund.renderFund().includes("18:34 時点"));

  console.log("[3] 失敗時に前回データが「時点(古い)」で残る・3状態の文言");
  Object.assign(fundCache, { fetchedAt: 0, data: undefined, lastError: "", lastAttemptAt: 0 });
  let ready = false;
  let result = "";
  fund.configureFund({
    escapeHTML, renderHeader: () => "<header>FUND</header>", renderMarkdown,
    personalDataReady: () => ready,
    fetchGitHubRawText: async () => { if (result instanceof Error) throw result; return result; }
  });
  check("未接続は接続案内", fund.renderFund().includes("設定で個人データリポジトリを接続すると表示されます"));
  ready = true;
  check("試行前は読み込み中", fund.renderFund().includes("FUNDデータを読み込んでいます"));
  result = new Error("404");
  await fund.hydrateFundData(0);
  check("データ無しの取得失敗は最終試行時刻付きで表示", fund.renderFund().includes("FUNDデータを取得できませんでした") && /最終試行 \d{2}:\d{2}/.test(fund.renderFund()));
  result = JSON.stringify(FUND_FIXTURE);
  await fund.hydrateFundData(0);
  result = new Error("404 after success");
  await fund.hydrateFundData(0);
  const staleHtml = fund.renderFund();
  check("前回成功後の失敗は「時点(古い)」を表示し取得失敗の全面表示にはならない",
    staleHtml.includes("時点・古い") && staleHtml.includes("を表示中") && !staleHtml.includes("FUNDデータを取得できませんでした"));

  console.log("[4] 保有0・注文0・約定0で「まだ取引記録がありません」1枚に統合");
  fund.configureFund({
    escapeHTML, renderHeader: () => "<header>FUND</header>", renderMarkdown,
    personalDataReady: () => true, fetchGitHubRawText: async () => JSON.stringify(EMPTY_FUND_FIXTURE)
  });
  Object.assign(fundCache, { fetchedAt: 0, data: undefined, lastError: "", lastAttemptAt: 0 });
  await fund.hydrateFundData(0);
  const emptyHtml = fund.renderFund();
  check("空データは統合空表示1枚", emptyHtml.includes("まだ取引記録がありません"));
  check("journalPlainがnullなら平易日誌セクションを出さない", !emptyHtml.includes("fund-journal-plain"));

  console.log("[4b] 部分0件(保有あり・注文0件・約定0件)は統合空表示にならず個別の空文言を表示");
  const PARTIAL_EMPTY_FIXTURE = { ...FUND_FIXTURE, orders: [], fills: [], openOrders: [], recentTrades: [] };
  fund.configureFund({
    escapeHTML, renderHeader: () => "<header>FUND</header>", renderMarkdown,
    personalDataReady: () => true, fetchGitHubRawText: async () => JSON.stringify(PARTIAL_EMPTY_FIXTURE)
  });
  Object.assign(fundCache, { fetchedAt: 0, data: undefined, lastError: "", lastAttemptAt: 0 });
  await fund.hydrateFundData(0);
  const partialHtml = fund.renderFund();
  check("保有ありのときは統合空表示にならない(まだ取引記録がありませんを出さない)", !partialHtml.includes("まだ取引記録がありません"));
  check("注文0件は個別の空文言「有効な注文はありません」", partialHtml.includes("有効な注文はありません"));
  check("約定0件は個別の空文言「約定はありません」", partialHtml.includes("約定はありません"));
  fund.configureFund({
    escapeHTML, renderHeader: () => "<header>FUND</header>", renderMarkdown,
    personalDataReady: () => true, fetchGitHubRawText: async () => JSON.stringify({ ...FUND_FIXTURE, positions: [] })
  });
  Object.assign(fundCache, { fetchedAt: 0, data: undefined, lastError: "", lastAttemptAt: 0 });
  await fund.hydrateFundData(0);
  const noPositionHtml = fund.renderFund();
  check("保有0件・注文/約定ありのときは「保有ポジションはありません」を個別表示", noPositionHtml.includes("保有ポジションはありません") && !noPositionHtml.includes("まだ取引記録がありません"));

  console.log("[5] 実DOM: 390px/1280px横スクロールなし・本文16px・pageerror0・state非書込");
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
    await page.locator('#bottomNav [data-action="nav"][data-view="more"]').click();
    await page.locator('.more-tower-item[data-view="fund"]').click();
    await page.waitForSelector(".fund-journal");
    const journalFont = await page.locator(".fund-journal-plain").evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontSize: style.fontSize, lineHeight: style.lineHeight };
    });
    check("平易版日誌本文は16px以上", parseFloat(journalFont.fontSize) >= 16, JSON.stringify(journalFont));
    check("390pxで横スクロールなし", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await page.setViewportSize({ width: 1280, height: 900 });
    check("1280pxで横スクロールなし", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    // v356レビュー対応(A-H1/B-M4): PCでヘッダ・取得状態行が最上段に固定され、
    // 左列=NAV+保有、右列=推移+日誌(TabFundPC.png準拠)になっていることを実測で pin する。
    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        return element ? element.getBoundingClientRect() : null;
      };
      return {
        header: rect(".fund-view > .view-header"),
        status: rect(".fund-status-line"),
        summary: rect(".fund-summary"),
        chart: rect(".fund-chart"),
        holdings: rect(".fund-holdings"),
        journal: rect(".fund-journal")
      };
    });
    const allBoxesFound = ["header", "status", "summary", "chart", "holdings", "journal"].every((key) => layout[key]);
    check("PCレイアウト計測対象の全要素が見つかる", allBoxesFound, JSON.stringify(layout));
    check("PCでヘッダが最上段(view-headerのtopがNAV/推移/保有/日誌より上)",
      allBoxesFound && [layout.summary, layout.chart, layout.holdings, layout.journal].every((box) => layout.header.top < box.top),
      JSON.stringify(layout));
    check("PCで取得状態行もヘッダ直下で最上段(NAV/推移/保有/日誌より上)",
      allBoxesFound && [layout.summary, layout.chart, layout.holdings, layout.journal].every((box) => layout.status.top < box.top),
      JSON.stringify(layout));
    check("PCは左列にNAV(summary)+保有(holdings)、右列に推移(chart)+日誌(journal)がTabFundPC.png準拠で並ぶ",
      allBoxesFound
        && Math.abs(layout.summary.left - layout.holdings.left) < 1
        && Math.abs(layout.chart.left - layout.journal.left) < 1
        && layout.summary.left < layout.chart.left
        && layout.holdings.left < layout.journal.left,
      JSON.stringify(layout));
    check("PCはNAV(summary)と推移(chart)が1行目に横並び(topがほぼ同じ)",
      allBoxesFound && Math.abs(layout.summary.top - layout.chart.top) < 1, JSON.stringify(layout));

    // 再取得ボタンの連打テスト: レスポンスを保留してから2連打し、まとめて解放する
    // (Playwright側の即時応答だと2クリックが直列2回の正当な取得に化けてしまうため)。
    let refetches = 0;
    let holdRefetch = true;
    let releaseRefetch;
    await page.route((url) => url.hostname === "api.github.com", async (route) => {
      const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
      if (pathname.endsWith("/contents/taskchute/dashboard/fund.json")) {
        refetches++;
        if (holdRefetch) await new Promise((resolve) => { releaseRefetch = resolve; });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FUND_FIXTURE) });
      }
      return route.fallback();
    });
    const stateBefore = await page.evaluate((KEY) => {
      window.__v356OriginalSetItem = Storage.prototype.setItem;
      window.__v356Writes = 0;
      Storage.prototype.setItem = function(key, value) {
        if (key === KEY) window.__v356Writes++;
        return window.__v356OriginalSetItem.call(this, key, value);
      };
      return localStorage.getItem(KEY);
    }, "taskchute-journal-pwa-state-v1");
    const refetchResponse = page.waitForResponse((item) => item.url().includes("/contents/taskchute/dashboard/fund.json"));
    await Promise.all([
      page.locator('[data-action="fund-refresh"]').click(),
      page.locator('[data-action="fund-refresh"]').click()
    ]);
    holdRefetch = false;
    releaseRefetch?.();
    await refetchResponse;
    await page.waitForSelector(".fund-summary");
    check("実DOMでも再取得ボタンの連打はfetch1回だけ", refetches === 1, String(refetches));
    const afterState = await page.evaluate((KEY) => ({ state: localStorage.getItem(KEY), writes: window.__v356Writes }), "taskchute-journal-pwa-state-v1");
    check("再取得はstate非書込", afterState.state === stateBefore && afterState.writes === 0, String(afterState.writes));
    await page.evaluate(() => { Storage.prototype.setItem = window.__v356OriginalSetItem; });
    check("pageerrorなし", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\n❌ v356: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\n✅ v356: all checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
