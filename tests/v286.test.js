// v286: FABLE FUND日誌/朝の投資ブリーフをAIレポートタブと14日未読通知へ追加する。
// 既存8kind白名単、english/未知kind除外、既読no-op、index fail-quiet、空タブ縮退を固定する。
const fs = require("fs");
const path = require("path");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY, GITHUB_API_HOST
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
const FIXED_NOW = new Date(2026, 7, 28, 10, 0, 0);
const TODAY = "2026-08-28";
const INSIDE_WINDOW = "2026-08-15";
const OUTSIDE_WINDOW = "2026-08-14";
const FRESH_GENERATED_AT = "2026-08-28T01:00:00Z";

const EXPECTED_TYPES = [
  ["feedback", "AIフィードバック", "AIフィードバック_"],
  ["content", "コンテンツ総括", "コンテンツ総括_"],
  ["self", "自己分析", "自己分析_"],
  ["weekly", "週次レビュー", "週次レビュー_"],
  ["english", "英語表現集", "英語表現集_"],
  ["letter", "未来からの手紙", "未来からの手紙_"],
  ["excuse", "言い訳レポート", "言い訳レポート_"],
  ["fundJournal", "FABLE FUND日誌", "FABLE FUND日誌_"],
  ["market", "朝の投資ブリーフ", "朝の投資ブリーフ_"]
];

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function verifySourceContracts() {
  console.log("[1] AI_REPORT_TYPES既存順序・新2定義・8kind白名単を静的固定");
  const source = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const block = /const AI_REPORT_TYPES = \[([\s\S]*?)\n\];/.exec(source)?.[1] || "";
  const actualTypes = [...block.matchAll(/\{ id: "([^"]+)", label: "([^"]+)", prefix: "([^"]+)"/g)]
    .map((match) => match.slice(1));
  check("既存7kindのid/label/prefix/順序と既定feedbackを保ち、新2kindを末尾追加",
    JSON.stringify(actualTypes) === JSON.stringify(EXPECTED_TYPES), JSON.stringify(actualTypes));
  check("FUNDビューidと紛れないfundJournalを使用", actualTypes[7]?.[0] === "fundJournal");
  check("新2kindのguideは設計確定文言",
    block.includes('guide: "FABLE FUND模擬運用のAI投資判断日誌。平日朝夜バッチが生成します"')
      && block.includes('guide: "前夜の米国市場と当日の注目材料を寄り付き前にまとめます"'));
  const notify = /const notifyKinds = new Set\(\[([^\]]+)\]\)/.exec(source)?.[1]
    ?.match(/"[^"]+"/g)?.map((value) => value.slice(1, -1)) || [];
  check("通知白名単は既存6kind+fundJournal+marketの8種だけ",
    JSON.stringify(notify) === JSON.stringify(["feedback", "content", "self", "weekly", "letter", "excuse", "fundJournal", "market"]),
    JSON.stringify(notify));
}

async function installRoutes(page, fixture) {
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === GITHUB_API_HOST, (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    if (/\/contents\/taskchute\/report-index\.json$/.test(pathname)) {
      if (fixture.indexRaw !== undefined) {
        return route.fulfill({ status: 200, contentType: "application/json", body: fixture.indexRaw });
      }
      if (fixture.index === null) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.index) });
    }
    if (/\/contents\/taskchute$/.test(pathname)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.dir || []) });
    }
    const md = pathname.match(/\/contents\/taskchute\/([^/]+\.md)$/);
    if (md) {
      const body = fixture.bodies?.[md[1]];
      return route.fulfill({ status: 200, contentType: "text/markdown", body: body === undefined ? "" : body });
    }
    return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });
}

async function gatedPage(browser, fixture, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.clock.setFixedTime(FIXED_NOW);
  await installRoutes(page, fixture);
  await page.goto(`http://localhost:${PORT}/`);
  const indexResponse = page.waitForResponse((response) => /\/contents\/taskchute\/report-index\.json$/.test(decodeURIComponent(new URL(response.url()).pathname)));
  await passGithubGate(page);
  await indexResponse;
  return { context, page, pageErrors, consoleErrors };
}

async function openAiType(page, typeId) {
  await page.evaluate(({ key, typeId }) => {
    const current = JSON.parse(localStorage.getItem(key));
    current.currentView = "ai-reports";
    current.settings.aiReportType = typeId;
    localStorage.setItem(key, JSON.stringify(current));
  }, { key: STATE_KEY, typeId });
  const indexResponse = page.waitForResponse((response) => /\/contents\/taskchute\/report-index\.json$/.test(decodeURIComponent(new URL(response.url()).pathname)));
  await page.reload();
  await indexResponse;
  await page.waitForSelector(`[data-action="ai-report-type"][data-type="${typeId}"].active`);
}

async function badgeText(page) {
  const badge = page.locator('#bottomNav [data-view="more"] .nav-badge');
  return await badge.count()
    ? badge.textContent()
    : null;
}

async function verifyMixedWhitelist(browser) {
  console.log("[2] 既存6kind+新2kind混在、english/journal/unknown除外、タブ契約");
  const files = [
    ["AIフィードバック", "feedback"], ["コンテンツ総括", "content"], ["自己分析", "self"],
    ["週次レビュー", "weekly"], ["未来からの手紙", "letter"], ["言い訳レポート", "excuse"],
    ["FABLE FUND日誌", "fundJournal"], ["朝の投資ブリーフ", "market"],
    ["英語表現集", "english"], ["日報", "journal"], ["未知", "unknown"]
  ].map(([prefix, kind]) => ({ name: `${prefix}_${TODAY}.md`, date: TODAY, kind }));
  const fixture = {
    index: { generatedAt: FRESH_GENERATED_AT, files },
    bodies: { [`英語表現集_${TODAY}.md`]: "# 英語表現集\n\n通知外でも閲覧可能_v286" }
  };
  const { context, page } = await gatedPage(browser, fixture);
  try {
    await page.waitForFunction(() => document.querySelector('#bottomNav [data-view="more"] .nav-badge')?.textContent === "8");
    check("既存6kindと新2kindを各1件ずつ数える", await badgeText(page) === "8");
    await openAiType(page, "english");
    await page.waitForFunction(() => document.querySelector(".md-render")?.textContent.includes("通知外でも閲覧可能_v286"));
    const tabs = await page.$$eval('[data-action="ai-report-type"]', (elements) => elements.map((element) => [element.dataset.type, element.textContent.trim()]));
    check("既存7セグメント不変・新2セグメント末尾表示",
      JSON.stringify(tabs) === JSON.stringify(EXPECTED_TYPES.map(([id, label]) => [id, label])), JSON.stringify(tabs));
    check("englishは通知外のままタブでは読める", (await page.locator(".md-render").textContent()).includes("通知外でも閲覧可能_v286"));
    check("englishを開いても通知8件は不変", await badgeText(page) === "8", String(await badgeText(page)));
  } finally { await context.close(); }
}

async function verifySingleKindCounts(browser) {
  console.log("[3] fundJournal/market単独fixtureで各1件カウント");
  for (const [kind, prefix] of [["fundJournal", "FABLE FUND日誌"], ["market", "朝の投資ブリーフ"]]) {
    const fixture = {
      index: { generatedAt: FRESH_GENERATED_AT, files: [{ name: `${prefix}_${TODAY}.md`, date: TODAY, kind }] },
      bodies: {}
    };
    const { context, page } = await gatedPage(browser, fixture);
    try {
      await page.waitForFunction(() => document.querySelector('#bottomNav [data-view="more"] .nav-badge')?.textContent === "1");
      check(`${kind}だけで未読1件`, await badgeText(page) === "1");
    } finally { await context.close(); }
  }
}

async function verifyBoundary(browser) {
  console.log("[4] 新2kindの14日包含境界とYYYY-MM-DD日付契約");
  const fixture = {
    index: { generatedAt: FRESH_GENERATED_AT, files: [
      { name: `FABLE FUND日誌_${INSIDE_WINDOW}.md`, date: INSIDE_WINDOW, kind: "fundJournal" },
      { name: `FABLE FUND日誌_${OUTSIDE_WINDOW}.md`, date: OUTSIDE_WINDOW, kind: "fundJournal" },
      { name: `朝の投資ブリーフ_${INSIDE_WINDOW}.md`, date: INSIDE_WINDOW, kind: "market" },
      { name: `朝の投資ブリーフ_${OUTSIDE_WINDOW}.md`, date: OUTSIDE_WINDOW, kind: "market" }
    ] },
    bodies: {}
  };
  const { context, page } = await gatedPage(browser, fixture);
  try {
    await page.waitForFunction(() => document.querySelector('#bottomNav [data-view="more"] .nav-badge')?.textContent === "2");
    check("今日から13日前は両kindとも14日窓内、14日前は両kindとも窓外", await badgeText(page) === "2");
    await openAiType(page, "fundJournal");
    const fundDates = await page.$$eval("[data-ai-report-date] option", (options) => options.map((option) => option.value));
    await page.click('[data-action="ai-report-type"][data-type="market"]');
    const marketDates = await page.$$eval("[data-ai-report-date] option", (options) => options.map((option) => option.value));
    check("両kindの日付は月次補完不要のYYYY-MM-DDだけで日付降順",
      [fundDates, marketDates].every((dates) => JSON.stringify(dates) === JSON.stringify([INSIDE_WINDOW, OUTSIDE_WINDOW])),
      JSON.stringify({ fundDates, marketDates }));
  } finally { await context.close(); }
}

async function verifyReadAndBodyFlows(browser) {
  console.log("[5] 新2kind本文成功・既読化・即時バッジ減・再訪no-op・空本文失敗");
  const fundLatest = `FABLE FUND日誌_${TODAY}.md`;
  const fundOlder = "FABLE FUND日誌_2026-08-26.md";
  const marketLatest = `朝の投資ブリーフ_${TODAY}.md`;
  const fixture = {
    index: { generatedAt: FRESH_GENERATED_AT, files: [
      { name: fundOlder, date: "2026-08-26", kind: "fundJournal" },
      { name: fundLatest, date: TODAY, kind: "fundJournal" },
      { name: marketLatest, date: TODAY, kind: "market" }
    ] },
    bodies: {
      [fundLatest]: "# FABLE FUND日誌\n\nFUND本文成功_v286",
      [fundOlder]: "# FABLE FUND日誌\n\nFUND旧本文_v286",
      [marketLatest]: "# 朝の投資ブリーフ\n\n朝ブリーフ本文成功_v286"
    }
  };
  const { context, page } = await gatedPage(browser, fixture);
  try {
    await page.waitForFunction(() => document.querySelector('#bottomNav [data-view="more"] .nav-badge')?.textContent === "3");
    await openAiType(page, "fundJournal");
    await page.waitForFunction(() => document.querySelector(".md-render")?.textContent.includes("FUND本文成功_v286"));
    await page.waitForFunction((name) => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).aiReportReadIds.includes(name), fundLatest);
    const fundDates = await page.$$eval("[data-ai-report-date] option", (options) => options.map((option) => option.value));
    check("FUND日誌一覧は日付降順で最新本文を取得", JSON.stringify(fundDates) === JSON.stringify([TODAY, "2026-08-26"]));
    check("FUND日誌表示でファイル名を既読化しバッジ即時減", await badgeText(page) === "2");

    const beforeReload = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 5 * 60 * 1000));
    await openAiType(page, "fundJournal");
    await page.waitForSelector('.md-render[data-report-loaded="1"]');
    const afterReload = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    check("FUND日誌の既読済み再訪は重複追加なし・saveState不発火",
      afterReload.aiReportReadIds.filter((id) => id === fundLatest).length === 1
        && afterReload.dataModifiedAt === beforeReload.dataModifiedAt,
      JSON.stringify({ before: beforeReload.dataModifiedAt, after: afterReload.dataModifiedAt, ids: afterReload.aiReportReadIds }));

    await page.click('[data-action="ai-report-type"][data-type="market"]');
    await page.waitForFunction(() => document.querySelector(".md-render")?.textContent.includes("朝ブリーフ本文成功_v286"));
    await page.waitForFunction((name) => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).aiReportReadIds.includes(name), marketLatest);
    check("朝ブリーフ表示でもkind非依存の既読化が発火しバッジ即時減", await badgeText(page) === "1");

    const beforeMarketReload = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 10 * 60 * 1000));
    await openAiType(page, "market");
    await page.waitForSelector('.md-render[data-report-loaded="1"]');
    const afterMarketReload = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    check("朝ブリーフの既読済み再訪は重複追加なし・saveState不発火",
      afterMarketReload.aiReportReadIds.filter((id) => id === marketLatest).length === 1
        && afterMarketReload.dataModifiedAt === beforeMarketReload.dataModifiedAt,
      JSON.stringify({ before: beforeMarketReload.dataModifiedAt, after: afterMarketReload.dataModifiedAt, ids: afterMarketReload.aiReportReadIds }));
  } finally { await context.close(); }

  const emptyFixture = {
    index: { generatedAt: FRESH_GENERATED_AT, files: [{ name: marketLatest, date: TODAY, kind: "market" }] },
    bodies: { [marketLatest]: "" }
  };
  const empty = await gatedPage(browser, emptyFixture);
  try {
    await openAiType(empty.page, "market");
    await empty.page.waitForSelector('.md-render[data-report-loaded="0"]');
    const state = await empty.page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    check("朝ブリーフ空本文は取得失敗表示になり既読化しない",
      (await empty.page.locator(".md-render").textContent()).includes("本文を取得できませんでした")
        && !state.aiReportReadIds.includes(marketLatest));
    check("空本文では未読バッジ1件を維持", await badgeText(empty.page) === "1");
  } finally { await empty.context.close(); }
}

async function verifyIndexFailures(browser) {
  console.log("[6] index 404/壊れJSON/48h超過は未読0、Contents APIで新タブ閲覧可");
  const variants = [
    { name: "404", index: null, type: "fundJournal", prefix: "FABLE FUND日誌" },
    { name: "壊れJSON", indexRaw: "{broken", type: "market", prefix: "朝の投資ブリーフ" },
    { name: "48h超過", index: { generatedAt: "2026-08-20T00:00:00Z", files: [{ name: `FABLE FUND日誌_${TODAY}.md`, date: TODAY, kind: "fundJournal" }] }, type: "fundJournal", prefix: "FABLE FUND日誌" }
  ];
  for (const variant of variants) {
    const fileName = `${variant.prefix}_${TODAY}.md`;
    const fixture = {
      ...variant,
      dir: [{ name: fileName, path: `taskchute/${fileName}`, type: "file" }],
      bodies: { [fileName]: `# ${variant.prefix}\n\n${variant.name}フォールバック本文_v286` }
    };
    const { context, page, pageErrors, consoleErrors } = await gatedPage(browser, fixture);
    try {
      check(`${variant.name}: 通知はfail-quietで0件`, await badgeText(page) === null);
      await openAiType(page, variant.type);
      await page.waitForFunction((marker) => document.querySelector(".md-render")?.textContent.includes(marker), `${variant.name}フォールバック本文_v286`);
      check(`${variant.name}: 新タブはContents APIフォールバックで閲覧可`,
        (await page.locator(".md-render").textContent()).includes(`${variant.name}フォールバック本文_v286`));
      const expectedNetwork404Only = variant.name === "404"
        && consoleErrors.every((message) => message.startsWith("Failed to load resource: the server responded with a status of 404"));
      check(`${variant.name}: pageerror/予期しないconsole errorなし`,
        pageErrors.length === 0 && (consoleErrors.length === 0 || expectedNetwork404Only),
        JSON.stringify({ pageErrors, consoleErrors }));
    } finally { await context.close(); }
  }
}

async function verifyNoReportsDegradation(browser) {
  console.log("[7] loop側未稼働で新kind実ファイル0件の無害縮退");
  const fixture = {
    index: { generatedAt: FRESH_GENERATED_AT, files: [{ name: `未知_${TODAY}.md`, date: TODAY, kind: "unknown" }] },
    bodies: {}
  };
  const { context, page, pageErrors, consoleErrors } = await gatedPage(browser, fixture);
  try {
    check("新kind未到着時は未読0件・バッジ非表示", await badgeText(page) === null);
    await openAiType(page, "fundJournal");
    check("FUND日誌タブは空一覧メッセージへ縮退", (await page.locator("main").textContent()).includes("まだ生成されていません。"));
    await page.click('[data-action="ai-report-type"][data-type="market"]');
    check("朝ブリーフタブも空一覧メッセージへ縮退", (await page.locator("main").textContent()).includes("まだ生成されていません。"));
    check("空一覧縮退でpageerror/console errorなし", pageErrors.length === 0 && consoleErrors.length === 0,
      JSON.stringify({ pageErrors, consoleErrors }));
  } finally { await context.close(); }
}

(async () => {
  verifySourceContracts();
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  try {
    await verifyMixedWhitelist(browser);
    await verifySingleKindCounts(browser);
    await verifyBoundary(browser);
    await verifyReadAndBodyFlows(browser);
    await verifyIndexFailures(browser);
    await verifyNoReportsDegradation(browser);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures === 0 ? "\n✅ v286: 全テスト成功" : `\n❌ v286: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
