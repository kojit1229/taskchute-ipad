// v283: AIフィードバックのAIレポート統合、同期既読state、14日窓の未読バッジ。
const path = require("path");
const { pathToFileURL } = require("url");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY, GITHUB_API_HOST
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
const FIXED_NOW = new Date(2026, 7, 27, 10, 0, 0);
const TODAY = "2026-08-27";
const FEEDBACK_OLD_DATE = "2026-08-25";
const WEEKLY_DATE = "2026-08-24";
const FRESH_GENERATED_AT = "2026-08-27T01:00:00Z";
// v287: tasksにも同じnav-badgeが共存するため、v283の未読0件検証は未読導線だけを対象にする。
const UNREAD_BADGES = '#sidebar [data-view="ai-reports"] .nav-badge, #bottomNav [data-view="more"] .nav-badge, .more-tower-item[data-view="ai-reports"] .nav-badge';

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function baseSyncState(aiReportReadIds = []) {
  return {
    journalMeta: {}, settings: { journalTemplate: "", morningEnergyLog: {}, github: {} },
    journals: {}, feedback: {}, condition: { logs: {} }, sleep: { logs: {} },
    blocks: [], zeroThinking: { entries: [], suggestedThemes: [] },
    dailyDeclarations: {}, weeklyWishes: {}, bodyScans: [], tasks: [], projects: [], storeVisits: [],
    tracks: [], trackMeasurements: [], weeklyCommitments: [], swipeTriageLog: [], gardenLog: {},
    coachLog: { meals: [], settings: {} },
    aiStepProcessedIds: [], aiStepDismissedIds: [], aiStepPendingRequests: [], aiReportReadIds,
    dataModifiedAt: "2026-08-27T09:00:00"
  };
}

async function verifySyncMerge() {
  console.log("[1] aiReportReadIdsは同期で決定論的な和集合になり、両適用方向へ配線される");
  const storeMod = await import(pathToFileURL(path.join(ROOT, "src", "state", "store.js")).href);
  const syncMod = await import(pathToFileURL(path.join(ROOT, "src", "sync", "github.js")).href);
  const noop = () => {};
  syncMod.configureGithubSync({
    normalizeState: (x) => x, nowDateTime: () => "2026-08-27T10:00:00", todayISO: () => TODAY,
    addDays: (d) => d, isTouchedBlock: () => false,
    RECURRENCE_KEEP_PAST_DAYS: 7, RECURRENCE_FUTURE_DAYS: 31, SWIPE_TRIAGE_LOG_MAX: 200,
    showToast: noop, maintainRecurrences: noop, render: noop, runDailyOpen: () => false, saveState: noop,
    requireGitHubConfig: noop, fetchGitHubFileSHA: noop, personalDataReady: () => true, personalDataFileConfig: noop,
    gitHubContentsURL: noop, githubHeaders: noop, gitHubErrorMessage: noop, fromBase64: noop, toBase64: noop,
    sanitizedStateForGitHub: noop, maybeWriteBackupSnapshot: noop, updateAutoSaveStatus: noop, updateSyncDot: noop,
    renderSyncBanner: noop, pruneExpiredSuggestedThemes: (x) => x, _startupDataModifiedAt: ""
  });

  storeMod.setState(baseSyncState([
    "AIフィードバック_2026-08-27.md",
    "AIフィードバック_2026-08-27.md",
    "共通_2026-08-26.md"
  ]));
  const remote = baseSyncState([
    "週次レビュー_2026-08-24.md",
    "週次レビュー_2026-08-24.md",
    "共通_2026-08-26.md"
  ]);
  const merged = syncMod.computeSyncMerge(remote, "local");
  const expected = ["AIフィードバック_2026-08-27.md", "共通_2026-08-26.md", "週次レビュー_2026-08-24.md"];
  check("片側内重複と両側共通IDを除いたソート済み和集合", JSON.stringify(merged?.values.aiReportReadIds) === JSON.stringify(expected), JSON.stringify(merged?.values.aiReportReadIds));
  check("local/remoteの片側だけにある既読で両changedフラグが立つ", merged?.changedVsLocal === true && merged?.changedVsRemote === true, JSON.stringify(merged));
  syncMod.applySyncMergeToLocal(merged);
  check("remoteのみの既読がローカルへ反映される", JSON.stringify(storeMod.state.aiReportReadIds) === JSON.stringify(expected), JSON.stringify(storeMod.state.aiReportReadIds));
  const remoteApplied = baseSyncState(["週次レビュー_2026-08-24.md", "週次レビュー_2026-08-24.md", "共通_2026-08-26.md"]);
  syncMod.applySyncMergeToRemote(merged, remoteApplied);
  check("localのみの既読がリモート採用側へ反映される", JSON.stringify(remoteApplied.aiReportReadIds) === JSON.stringify(expected), JSON.stringify(remoteApplied.aiReportReadIds));
}

async function installRoutes(page, fixture) {
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === GITHUB_API_HOST, (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    if (/\/contents\/taskchute\/report-index\.json$/.test(pathname)) {
      fixture.reportRequests = (fixture.reportRequests || 0) + 1;
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
      if (body !== undefined) return route.fulfill({ status: 200, contentType: "text/markdown", body });
      return route.fulfill({ status: 200, contentType: "text/markdown", body: "" });
    }
    return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });
}

async function gatedPage(browser, fixture, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  await page.clock.setFixedTime(FIXED_NOW);
  await installRoutes(page, fixture);
  await page.goto(`http://localhost:${PORT}/`);
  const indexResponse = page.waitForResponse((res) => /\/contents\/taskchute\/report-index\.json$/.test(decodeURIComponent(new URL(res.url()).pathname)));
  await passGithubGate(page);
  await indexResponse;
  return { context, page, pageErrors, consoleErrors };
}

async function connectedStartupPage(browser, fixture) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const seedPage = await context.newPage();
  await seedPage.clock.setFixedTime(FIXED_NOW);
  await installRoutes(seedPage, fixture);
  await seedPage.goto(`http://localhost:${PORT}/`);
  const seededIndex = seedPage.waitForResponse((res) => /\/contents\/taskchute\/report-index\.json$/.test(decodeURIComponent(new URL(res.url()).pathname)));
  await passGithubGate(seedPage);
  await seededIndex;
  await seedPage.close();

  fixture.reportRequests = 0;
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await installRoutes(page, fixture);
  const startupIndex = page.waitForResponse((res) => /\/contents\/taskchute\/report-index\.json$/.test(decodeURIComponent(new URL(res.url()).pathname)));
  await page.goto(`http://localhost:${PORT}/`);
  await startupIndex;
  await page.waitForSelector('[data-action="nav"]', { state: "attached" });
  return { context, page, pageErrors };
}

async function verifyMainFlow(browser) {
  console.log("[2] feedback一覧・本文・未読バッジ・種類/日付切替・永続化");
  const latestFeedback = `# AIコーチングフィードバック ${TODAY}\n\n## サマリー\n\n- 新形式サマリー_v283\n\n## 詳細\n\n新形式全文詳細_v283`;
  const oldFeedback = `# AIコーチングフィードバック ${FEEDBACK_OLD_DATE}\n\n## 良かった点\n\n旧形式全文_v283`;
  const fixture = {
    index: {
      generatedAt: FRESH_GENERATED_AT,
      files: [
        { name: `AIフィードバック_${TODAY}.md`, date: TODAY, kind: "feedback" },
        { name: `AIフィードバック_${FEEDBACK_OLD_DATE}.md`, date: FEEDBACK_OLD_DATE, kind: "feedback" },
        { name: `週次レビュー_${WEEKLY_DATE}.md`, date: WEEKLY_DATE, kind: "weekly" },
        { name: `英語表現集_${TODAY}.md`, date: TODAY, kind: "english" },
        { name: `日報_${TODAY}.md`, date: TODAY, kind: "journal" },
        { name: "基盤ヘルス_2026-08-27.md", date: TODAY, kind: "health" }
      ]
    },
    bodies: {
      [`AIフィードバック_${TODAY}.md`]: latestFeedback,
      [`AIフィードバック_${FEEDBACK_OLD_DATE}.md`]: oldFeedback,
      [`週次レビュー_${WEEKLY_DATE}.md`]: "# 週次レビュー\n\n週次本文_v283",
      [`英語表現集_${TODAY}.md`]: "# 英語表現集\n\nEnglish body v283"
    }
  };
  const { context, page, pageErrors } = await gatedPage(browser, fixture);
  try {
    await page.waitForFunction(() => document.querySelector('#bottomNav [data-view="more"] .nav-badge')?.textContent === "3");
    const mobileItems = await page.$$eval("#bottomNav button", (els) => els.map((el) => ({ id: el.dataset.view, label: el.childNodes[0].textContent })));
    const expectedMobileItems = [
      { id: "today", label: "今日" }, { id: "journal", label: "ジャーナル" },
      { id: "tasks", label: "実行" }, { id: "timeline", label: "時間" }, { id: "more", label: "その他" }
    ];
    check("mobileNavは5項目・id/ラベルの組が不変", JSON.stringify(mobileItems) === JSON.stringify(expectedMobileItems), JSON.stringify(mobileItems));
    const moreHeight = await page.locator('#bottomNav [data-view="more"]').evaluate((el) => el.getBoundingClientRect().height);
    check("バッジを内包してもその他ボタンのタップ標的は44px以上", moreHeight >= 44, String(moreHeight));

    await page.click('#bottomNav [data-view="more"]');
    await page.waitForSelector('.more-tower-item[data-view="ai-reports"] .nav-badge');
    check("その他グリッドのAIレポート項目にも同じ未読3件を表示", await page.locator('.more-tower-item[data-view="ai-reports"] .nav-badge').textContent() === "3");

    await page.click('.more-tower-item[data-view="ai-reports"]');
    await page.waitForSelector('.md-render[data-report-loaded="1"]');
    await page.waitForFunction((name) => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).aiReportReadIds.includes(name), `AIフィードバック_${TODAY}.md`);
    const tabs = await page.$$eval('[data-action="ai-report-type"]', (els) => els.map((el) => ({ id: el.dataset.type, label: el.textContent.trim(), active: el.classList.contains("active") })));
    check("feedbackが先頭かつ既定active", tabs[0]?.id === "feedback" && tabs[0]?.label === "AIフィードバック" && tabs[0]?.active, JSON.stringify(tabs));
    check("health/batchセグメントは非表示", !tabs.some((tab) => tab.id === "health" || tab.id === "batch"), JSON.stringify(tabs));
    check("既存kindはすべて維持", ["content", "self", "weekly", "english", "letter", "excuse"].every((id) => tabs.some((tab) => tab.id === id)), JSON.stringify(tabs));
    const dates = await page.$$eval('[data-ai-report-date] option', (els) => els.map((el) => el.value));
    check("feedback一覧は日付降順", JSON.stringify(dates) === JSON.stringify([TODAY, FEEDBACK_OLD_DATE]), JSON.stringify(dates));
    check("新形式フィードバック本文を全文表示", (await page.locator(".md-render").textContent()).includes("新形式全文詳細_v283"));
    await page.waitForFunction(() => document.querySelector('#bottomNav [data-view="more"] .nav-badge')?.textContent === "2");

    await page.selectOption("[data-ai-report-date]", FEEDBACK_OLD_DATE);
    await page.waitForFunction(() => document.querySelector(".md-render")?.textContent.includes("旧形式全文_v283"));
    await page.waitForFunction((name) => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).aiReportReadIds.includes(name), `AIフィードバック_${FEEDBACK_OLD_DATE}.md`);
    check("日付切替で旧形式本文を既読化しバッジを1件へ減らす", await page.locator('#bottomNav [data-view="more"] .nav-badge').textContent() === "1");

    await page.click('[data-action="ai-report-type"][data-type="weekly"]');
    await page.waitForFunction(() => document.querySelector(".md-render")?.textContent.includes("週次本文_v283"));
    await page.waitForFunction((name) => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).aiReportReadIds.includes(name), `週次レビュー_${WEEKLY_DATE}.md`);
    check("種類切替で本文を既読化し0件時はバッジDOMを消す", await page.locator(UNREAD_BADGES).count() === 0);

    const persisted = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), STATE_KEY);
    const beforeReloadModifiedAt = persisted.dataModifiedAt;
    check("既読IDはファイル名そのものをソート保持", JSON.stringify(persisted.aiReportReadIds) === JSON.stringify([
      `AIフィードバック_${FEEDBACK_OLD_DATE}.md`, `AIフィードバック_${TODAY}.md`, `週次レビュー_${WEEKLY_DATE}.md`
    ]), JSON.stringify(persisted.aiReportReadIds));
    await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 5 * 60 * 1000));
    await page.reload();
    await page.waitForSelector('.md-render[data-report-loaded="1"]');
    await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 0, UNREAD_BADGES);
    const afterReload = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), STATE_KEY);
    check("reload後も既読が残りバッジは増えない", JSON.stringify(afterReload.aiReportReadIds) === JSON.stringify(persisted.aiReportReadIds));
    check("既読済み再訪はsaveState不発火(dataModifiedAt不変)", afterReload.dataModifiedAt === beforeReloadModifiedAt, `${beforeReloadModifiedAt} -> ${afterReload.dataModifiedAt}`);
    check("主要経路でpageerrorなし", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await context.close();
  }
}

async function verifyWhitelistAndBoundary(browser) {
  console.log("[3] 通知白名単6kind・負例・YYYY-MM補完・14日包含境界");
  const fixture = {
    index: { generatedAt: FRESH_GENERATED_AT, files: [
      { name: `AIフィードバック_${TODAY}.md`, date: TODAY, kind: "feedback" },
      { name: "コンテンツ総括_2026-08-14.md", date: "2026-08-14", kind: "content" },
      { name: `自己分析_${TODAY}.md`, date: TODAY, kind: "self" },
      { name: `週次レビュー_${TODAY}.md`, date: TODAY, kind: "weekly" },
      { name: `未来からの手紙_${TODAY}.md`, date: TODAY, kind: "letter" },
      { name: `言い訳レポート_${TODAY}.md`, date: TODAY, kind: "excuse" },
      { name: "未来からの手紙_2026-09.md", date: "2026-09", kind: "letter" },
      { name: `英語表現集_${TODAY}.md`, date: TODAY, kind: "english" },
      { name: `日報_${TODAY}.md`, date: TODAY, kind: "journal" },
      { name: `基盤ヘルス_${TODAY}.md`, date: TODAY, kind: "health" },
      { name: `バッチ実行サマリ_${TODAY}.md`, date: TODAY, kind: "batch" },
      { name: `未知_${TODAY}.md`, date: TODAY, kind: "unknown" },
      { name: "コンテンツ総括_2026-08-13.md", date: "2026-08-13", kind: "content" }
    ] },
    bodies: {}
  };
  const { context, page } = await gatedPage(browser, fixture);
  try {
    const badgeCount = await (await page.waitForFunction(
      () => document.querySelector('#bottomNav [data-view="more"] .nav-badge')?.textContent === "7"
    )).jsonValue();
    check("6kind正例+YYYY-MM補完を数え、5kind/未知kindと08-13を除外", badgeCount === true);
    check("14日窓の08-14は包含される", await page.locator('#bottomNav [data-view="more"] .nav-badge').textContent() === "7");
  } finally { await context.close(); }
}

async function verifyLargeBadgesAndSidebar(browser) {
  console.log("[4] 100件超fixtureの99+上限・iPadサイドバー・既読後の全導線更新");
  const files = Array.from({ length: 101 }, (_, index) => ({
    name: `AIフィードバック_${TODAY}-${String(index).padStart(3, "0")}.md`,
    date: TODAY,
    kind: "feedback"
  }));
  const initiallyRead = files[0].name;
  const openedName = files[100].name;
  const fixture = {
    index: { generatedAt: FRESH_GENERATED_AT, files },
    bodies: { [openedName]: "# large fixture\n\n99+更新本文_v283" }
  };
  const { context, page } = await gatedPage(browser, fixture, { width: 768, height: 1024 });
  try {
    await page.evaluate(({ KEY, initiallyRead }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.aiReportReadIds = [initiallyRead];
      s.currentView = "today";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY: STATE_KEY, initiallyRead });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#sidebar [data-view="ai-reports"] .nav-badge')?.textContent === "99+");
    check("101件fixture・既読1件でサイドバーと下部ナビを99+表示",
      await page.locator('#sidebar [data-view="ai-reports"] .nav-badge').textContent() === "99+"
      && await page.locator('#bottomNav [data-view="more"] .nav-badge').textContent() === "99+");

    await page.click('#sidebar [data-view="more"]');
    check("その他グリッドも99+表示", await page.locator('.more-tower-item[data-view="ai-reports"] .nav-badge').textContent() === "99+");
    await page.click('.more-tower-item[data-view="ai-reports"]');
    await page.waitForFunction(() => document.querySelector(".md-render")?.textContent.includes("99+更新本文_v283"));
    await page.waitForFunction((name) => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).aiReportReadIds.includes(name), openedName);
    check("既読化直後にサイドバーと下部ナビを99へ減少",
      await page.locator('#sidebar [data-view="ai-reports"] .nav-badge').textContent() === "99"
      && await page.locator('#bottomNav [data-view="more"] .nav-badge').textContent() === "99");
    await page.click('#sidebar [data-view="more"]');
    check("既読化後にその他グリッドも99へ減少", await page.locator('.more-tower-item[data-view="ai-reports"] .nav-badge').textContent() === "99");
  } finally { await context.close(); }
}

async function verifyNormalizeAndFallback(browser) {
  console.log("[5] normalizeState後方互換と旧health設定の先頭タブ縮退");
  const fixture = {
    index: { generatedAt: FRESH_GENERATED_AT, files: [{ name: `AIフィードバック_${TODAY}.md`, date: TODAY, kind: "feedback" }] },
    bodies: { [`AIフィードバック_${TODAY}.md`]: "# feedback\n\nhealth fallback body v283" }
  };
  const { context, page } = await gatedPage(browser, fixture);
  try {
    for (const value of [undefined, "broken", ["z.md", 1, "a.md", "z.md", "", null]]) {
      await page.evaluate(({ KEY, value }) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        if (value === undefined) delete s.aiReportReadIds;
        else s.aiReportReadIds = value;
        localStorage.setItem(KEY, JSON.stringify(s));
      }, { KEY: STATE_KEY, value });
      await page.reload();
      await page.waitForSelector('[data-action="nav"]', { state: "attached" });
      const normalized = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).aiReportReadIds, STATE_KEY);
      const expected = Array.isArray(value) ? ["a.md", "z.md"] : [];
      check(`normalizeState: ${value === undefined ? "欠落" : Array.isArray(value) ? "混在配列" : "非配列"}`, JSON.stringify(normalized) === JSON.stringify(expected), JSON.stringify(normalized));
    }
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "ai-reports";
      s.settings.aiReportType = "health";
      s.aiReportReadIds = [];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, STATE_KEY);
    await page.reload();
    await page.waitForSelector('.md-render[data-report-loaded="1"]');
    const activeType = await page.locator('[data-action="ai-report-type"].active').getAttribute("data-type");
    check("保存済みhealthは先頭feedbackへ安全に縮退", activeType === "feedback", String(activeType));
    check("health/batchボタンは存在しない", await page.locator('[data-type="health"], [data-type="batch"]').count() === 0);
  } finally {
    await context.close();
  }
}

async function verifyNegativeCases(browser) {
  console.log("[6] 通知白名単・14日窓・壊れindex・空本文のfail-quiet");
  const zeroFixture = {
    index: { generatedAt: FRESH_GENERATED_AT, files: [
      { name: `英語表現集_${TODAY}.md`, date: TODAY, kind: "english" },
      { name: `日報_${TODAY}.md`, date: TODAY, kind: "journal" },
      { name: `基盤ヘルス_${TODAY}.md`, date: TODAY, kind: "health" },
      { name: "コンテンツ総括_2026-08-13.md", date: "2026-08-13", kind: "content" }
    ] },
    bodies: { [`英語表現集_${TODAY}.md`]: "# English\n\nreadable v283" }
  };
  {
    const { context, page } = await gatedPage(browser, zeroFixture);
    try {
      await page.click('#bottomNav [data-view="more"]');
      check("english/journal/healthと15日目以前は未読件数に入らずバッジDOM 0件", await page.locator(UNREAD_BADGES).count() === 0);
      await page.click('.more-tower-item[data-view="ai-reports"]');
      await page.click('[data-action="ai-report-type"][data-type="english"]');
      await page.waitForFunction(() => document.querySelector(".md-render")?.textContent.includes("readable v283"));
      check("通知対象外englishもタブでは読める", (await page.locator(".md-render").textContent()).includes("readable v283"));
      const englishName = `英語表現集_${TODAY}.md`;
      const englishReadIds = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).aiReportReadIds, STATE_KEY);
      check("通知対象外englishもファイル名を既読IDへ1回だけ記録", englishReadIds.filter((id) => id === englishName).length === 1, JSON.stringify(englishReadIds));
    } finally { await context.close(); }
  }

  const badVariants = [
    { name: "JSON不正", indexRaw: "{broken" },
    { name: "generatedAt 48時間超過", index: { generatedAt: "2026-08-20T00:00:00Z", files: [{ name: `AIフィードバック_${TODAY}.md`, date: TODAY, kind: "feedback" }] } },
    { name: "files空", index: { generatedAt: FRESH_GENERATED_AT, files: [] } }
  ];
  for (const variant of badVariants) {
    const fallbackName = `AIフィードバック_${TODAY}.md`;
    const fixture = {
      ...variant,
      dir: [{ name: fallbackName, path: `taskchute/${fallbackName}`, type: "file" }],
      bodies: { [fallbackName]: `# fallback\n\n${variant.name}でも閲覧可能_v283` }
    };
    const { context, page, pageErrors, consoleErrors } = await gatedPage(browser, fixture);
    try {
      check(`${variant.name}: バッジ非表示`, await page.locator(UNREAD_BADGES).count() === 0);
      await page.evaluate((KEY) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.currentView = "ai-reports";
        s.settings.aiReportType = "feedback";
        localStorage.setItem(KEY, JSON.stringify(s));
      }, STATE_KEY);
      await page.reload();
      const readable = await (await page.waitForFunction(
        (marker) => document.querySelector(".md-render")?.textContent.includes(marker) === true,
        `${variant.name}でも閲覧可能_v283`
      )).jsonValue();
      check(`${variant.name}: Contents APIフォールバックでタブ閲覧可能`, readable === true);
      check(`${variant.name}: pageerror/console errorなし`, pageErrors.length === 0 && consoleErrors.length === 0, JSON.stringify({ pageErrors, consoleErrors }));
    } finally { await context.close(); }
  }

  const emptyBodyFixture = {
    index: { generatedAt: FRESH_GENERATED_AT, files: [{ name: `AIフィードバック_${TODAY}.md`, date: TODAY, kind: "feedback" }] },
    bodies: { [`AIフィードバック_${TODAY}.md`]: "" }
  };
  {
    const { context, page } = await gatedPage(browser, emptyBodyFixture);
    try {
      await page.waitForFunction(() => document.querySelector('#bottomNav [data-view="more"] .nav-badge')?.textContent === "1");
      await page.evaluate((KEY) => {
        const s = JSON.parse(localStorage.getItem(KEY)); s.currentView = "ai-reports"; localStorage.setItem(KEY, JSON.stringify(s));
      }, STATE_KEY);
      await page.reload();
      await page.waitForSelector('.md-render[data-report-loaded="0"]');
      const state = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), STATE_KEY);
      check("空本文は既読化しない", !state.aiReportReadIds.includes(`AIフィードバック_${TODAY}.md`), JSON.stringify(state.aiReportReadIds));
      check("空本文では未読1件バッジを維持", await page.locator('#bottomNav [data-view="more"] .nav-badge').textContent() === "1");
    } finally { await context.close(); }
  }
}

async function verifyHydrateRefresh(browser) {
  console.log("[7] フォアグラウンド復帰周期でindexを再取得しバッジを更新する");
  const fixture = { index: { generatedAt: FRESH_GENERATED_AT, files: [] }, bodies: {} };
  const { context, page } = await gatedPage(browser, fixture);
  try {
    check("初回indexが空ならバッジDOMなし", await page.locator(UNREAD_BADGES).count() === 0);
    fixture.index = { generatedAt: FRESH_GENERATED_AT, files: [{ name: `AIフィードバック_${TODAY}.md`, date: TODAY, kind: "feedback" }] };
    await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 61 * 1000));
    const refreshed = page.waitForResponse((res) => /\/contents\/taskchute\/report-index\.json$/.test(decodeURIComponent(new URL(res.url()).pathname)));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await refreshed;
    const badgeUpdated = await (await page.waitForFunction(
      () => document.querySelector('#bottomNav [data-view="more"] .nav-badge')?.textContent === "1"
    )).jsonValue();
    check("復帰hydrate後に新着1件バッジを即時表示", badgeUpdated === true);
  } finally { await context.close(); }
}

async function verifyConnectedStartupAndTicker(browser) {
  console.log("[8] 接続済み通常起動hydrateとvisibleのまま30分ticker更新");
  const fixture = { index: { generatedAt: FRESH_GENERATED_AT, files: [] }, bodies: {} };
  const { context, page, pageErrors } = await connectedStartupPage(browser, fixture);
  try {
    check("接続済みstateからの通常起動でreport-index hydrateが走る", fixture.reportRequests >= 1, String(fixture.reportRequests));

    const preparedRefresh = page.waitForResponse((res) => /\/contents\/taskchute\/report-index\.json$/.test(decodeURIComponent(new URL(res.url()).pathname)));
    await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 61 * 1000));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await preparedRefresh;
    const beforeTickerRequests = fixture.reportRequests;

    fixture.index = {
      generatedAt: FRESH_GENERATED_AT,
      files: [{ name: `AIフィードバック_${TODAY}.md`, date: TODAY, kind: "feedback" }]
    };
    const tickerRefresh = page.waitForResponse((res) => /\/contents\/taskchute\/report-index\.json$/.test(decodeURIComponent(new URL(res.url()).pathname)));
    await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 32 * 60 * 1000));
    await tickerRefresh;
    const tickerBadge = await (await page.waitForFunction(
      () => document.querySelector('#bottomNav [data-view="more"] .nav-badge')?.textContent === "1"
    )).jsonValue();
    check("visibleのまま30分超でtickerがindex再取得しバッジ更新", tickerBadge === true && fixture.reportRequests > beforeTickerRequests,
      JSON.stringify({ beforeTickerRequests, after: fixture.reportRequests }));
    check("通常起動/ticker経路でpageerrorなし", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally { await context.close(); }
}

(async () => {
  await verifySyncMerge();
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  try {
    await verifyMainFlow(browser);
    await verifyWhitelistAndBoundary(browser);
    await verifyLargeBadgesAndSidebar(browser);
    await verifyNormalizeAndFallback(browser);
    await verifyNegativeCases(browser);
    await verifyHydrateRefresh(browser);
    await verifyConnectedStartupAndTicker(browser);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures === 0 ? "\n✅ v283: 全テスト成功" : `\n❌ v283: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
