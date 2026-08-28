// v287: AIレポート未読一覧と、今日のタスクシュート未着手件数バッジ。
const path = require("path");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY, GITHUB_API_HOST
} = require("./helpers");

const PORT = randomPort();
const FIXED_NOW = new Date(2026, 7, 28, 10, 0, 0);
const TODAY = "2026-08-28";
const YESTERDAY = "2026-08-27";
const TOMORROW = "2026-08-29";
const FRESH_GENERATED_AT = "2026-08-28T01:00:00Z";
const REQUIRED_AI_REPORT_TABS = ["feedback", "content", "self", "weekly", "english", "letter", "excuse", "fundJournal", "market"];

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function project(id = "p1") {
  return {
    id, title: id, kind: "normal", status: "active", deleted: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`
  };
}

function task(id, extra = {}) {
  return {
    id, projectId: "p1", title: id, kind: "normal", status: "todo", deleted: false,
    dueDate: TODAY, createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra
  };
}

function block(id, taskId, date = TODAY, extra = {}) {
  return {
    id, taskId, date, title: id, category: "仕事",
    plannedStartAt: `${date}T09:00:00`, plannedEndAt: `${date}T09:30:00`,
    actualStartAt: "", actualEndAt: "", everStartedAt: "", completed: false,
    charge: 0, discharge: 0, estimateMin: 30, recurrenceGroupId: "", source: "",
    orderIndex: 0, migratedTo: "", deleted: false,
    createdAt: `${date}T08:00:00`, updatedAt: `${date}T08:00:00`, ...extra
  };
}

async function installRoutes(page, fixture) {
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === GITHUB_API_HOST, (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    if (/\/contents\/taskchute\/report-index\.json$/.test(pathname)) {
      if (fixture.indexRaw !== undefined) {
        return route.fulfill({ status: 200, contentType: "application/json", body: fixture.indexRaw });
      }
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify(fixture.index || { generatedAt: FRESH_GENERATED_AT, files: [] })
      });
    }
    if (/\/contents\/taskchute$/.test(pathname)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    const md = pathname.match(/\/contents\/taskchute\/([^/]+\.md)$/);
    if (md) {
      const body = fixture.bodies?.[md[1]];
      return route.fulfill({ status: 200, contentType: "text/markdown", body: body === undefined ? "" : body });
    }
    return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });
}

async function connectedPage(browser, fixture, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.clock.setFixedTime(FIXED_NOW);
  await installRoutes(page, fixture);
  await page.goto(`http://localhost:${PORT}/`);
  const indexResponse = page.waitForResponse((response) =>
    /\/contents\/taskchute\/report-index\.json$/.test(decodeURIComponent(new URL(response.url()).pathname)));
  await passGithubGate(page);
  await indexResponse;
  return { context, page, pageErrors, consoleErrors };
}

async function seed(page, values) {
  await page.evaluate(({ key, values }) => {
    const current = JSON.parse(localStorage.getItem(key));
    const settings = { ...current.settings, ...(values.settings || {}) };
    Object.assign(current, values);
    current.settings = settings;
    localStorage.setItem(key, JSON.stringify(current));
  }, { key: STATE_KEY, values });
  const indexResponse = page.waitForResponse((response) =>
    /\/contents\/taskchute\/report-index\.json$/.test(decodeURIComponent(new URL(response.url()).pathname)));
  await page.reload();
  await indexResponse;
  await page.waitForSelector('[data-action="nav"]', { state: "attached" });
}

async function badgeText(page, root, view) {
  const locator = page.locator(`${root} [data-view="${view}"] .nav-badge`);
  return await locator.count() ? locator.textContent() : null;
}

async function verifyUnreadList(browser) {
  console.log("[1] 未読一覧: 混在・順序・表示・タップ既読化・両バッジ共存");
  const feedbackName = `AIフィードバック_${TODAY}.md`;
  const contentName = `コンテンツ総括_${TODAY}.md`;
  const weeklyName = `週次レビュー_${YESTERDAY}.md`;
  const letterName = "未来からの手紙_2026-08-26.md";
  const englishName = `英語表現集_${TODAY}.md`;
  const unknownName = `未知レポート_${TODAY}.md`;
  const fixture = {
    index: { generatedAt: FRESH_GENERATED_AT, files: [
      { name: letterName, date: "2026-08-26", kind: "letter" },
      { name: weeklyName, date: YESTERDAY, kind: "weekly" },
      { name: contentName, date: TODAY, kind: "content" },
      { name: feedbackName, date: TODAY, kind: "feedback" },
      { name: englishName, date: TODAY, kind: "english" },
      { name: unknownName, date: TODAY, kind: "unknown" }
    ] },
    bodies: {
      [feedbackName]: "# AIフィードバック\n\nfeedback本文_v287",
      [contentName]: "# コンテンツ総括\n\ncontent本文_v287",
      [weeklyName]: "# 週次レビュー\n\nweekly本文_v287",
      [letterName]: "# 未来からの手紙\n\nletter本文_v287",
      [englishName]: "# 英語表現集\n\n通知対象外本文_v287"
    }
  };
  const { context, page, pageErrors, consoleErrors } = await connectedPage(browser, fixture);
  try {
    await seed(page, {
      currentView: "ai-reports", selectedDate: TODAY, aiReportReadIds: [],
      projects: [project()], tasks: [task("badge-task")], blocks: [block("badge-block", "badge-task")],
      settings: { aiReportType: "english", lastOpenedDate: TODAY, focusTimerAuto: false }
    });
    await page.waitForSelector("[data-ai-report-unread-list]");

    const placement = await page.locator("main").evaluate((main) => {
      const children = [...main.children];
      return {
        header: children.findIndex((el) => el.classList.contains("view-header")),
        list: children.findIndex((el) => el.hasAttribute("data-ai-report-unread-list")),
        segmented: children.findIndex((el) => el.classList.contains("segmented"))
      };
    });
    check("未読一覧はAIレポートヘッダー直後・segmented直前", placement.list === placement.header + 1 && placement.segmented === placement.list + 1, JSON.stringify(placement));
    check("見出しは未読4件", (await page.locator("[data-ai-report-unread-list] h2").textContent()).trim() === "未読 4件");

    const rows = await page.$$eval('[data-action="ai-report-open-unread"]', (elements) => elements.map((element) => ({
      kind: element.dataset.kind,
      file: element.dataset.file,
      kindLabel: element.querySelector(".ai-report-unread-kind")?.textContent.trim(),
      date: element.querySelector(".ai-report-unread-kind + span")?.textContent.trim(),
      fileLabel: element.querySelector("small")?.textContent.trim(),
      height: element.getBoundingClientRect().height
    })));
    check("日付降順→同日name昇順", JSON.stringify(rows.map((row) => row.file)) === JSON.stringify([feedbackName, contentName, weeklyName, letterName]), JSON.stringify(rows));
    check("各行のkind・日付・ファイル名は個別span/smallで完全一致", JSON.stringify(rows.map(({ kind, file, kindLabel, date, fileLabel }) => ({ kind, file, kindLabel, date, fileLabel }))) === JSON.stringify([
      { kind: "feedback", file: feedbackName, kindLabel: "AIフィードバック", date: TODAY, fileLabel: feedbackName },
      { kind: "content", file: contentName, kindLabel: "コンテンツ総括", date: TODAY, fileLabel: contentName },
      { kind: "weekly", file: weeklyName, kindLabel: "週次レビュー", date: YESTERDAY, fileLabel: weeklyName },
      { kind: "letter", file: letterName, kindLabel: "未来からの手紙", date: "2026-08-26", fileLabel: letterName }
    ]), JSON.stringify(rows));
    check("不正kindは未読一覧・moreバッジ母集団の両方から除外", await page.locator(`[data-file="${unknownName}"]`).count() === 0
      && await badgeText(page, "#bottomNav", "more") === "4");
    check("全未読行のタップ標的は44px以上", rows.every((row) => row.height >= 44), JSON.stringify(rows.map((row) => row.height)));
    check("一覧行数===more未読バッジ件数", rows.length === Number(await badgeText(page, "#bottomNav", "more")));
    check("サイドバー未読も4件", await badgeText(page, "#sidebar", "ai-reports") === "4");
    check("未読moreと未着手tasksバッジを取り違えず同時表示", await badgeText(page, "#bottomNav", "more") === "4"
      && await badgeText(page, "#bottomNav", "tasks") === "1"
      && await badgeText(page, "#sidebar", "ai-reports") === "4"
      && await badgeText(page, "#sidebar", "tasks") === "1");

    await page.locator(`[data-action="ai-report-open-unread"][data-file="${feedbackName}"]`).click();
    await page.waitForSelector('[data-action="ai-report-type"][data-type="feedback"].active');
    await page.waitForFunction((name) => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).aiReportReadIds.includes(name), feedbackName);
    check("行タップで種類・ファイル名由来の日付・本文へ遷移", await page.locator("[data-ai-report-date]").inputValue() === TODAY
      && (await page.locator(".md-render").textContent()).includes("feedback本文_v287"));
    check("本文成功後に一覧から行が消えnav未読も3へ減る", await page.locator(`[data-file="${feedbackName}"]`).count() === 0
      && await page.locator('[data-action="ai-report-open-unread"]').count() === 3
      && await badgeText(page, "#bottomNav", "more") === "3");

    for (const name of [contentName, weeklyName, letterName]) {
      await page.locator(`[data-action="ai-report-open-unread"][data-file="${name}"]`).click();
      await page.waitForFunction((fileName) => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).aiReportReadIds.includes(fileName), name);
    }
    check("全件既読で未読一覧セクション自体が消える", await page.locator("[data-ai-report-unread-list]").count() === 0);
    check("全件既読でmore未読バッジも消え、tasksバッジは残る", await badgeText(page, "#bottomNav", "more") === null
      && await badgeText(page, "#bottomNav", "tasks") === "1");
    check("未読一覧主要経路でpageerror/console errorなし", pageErrors.length === 0 && consoleErrors.length === 0,
      JSON.stringify({ pageErrors, consoleErrors }));
  } finally { await context.close(); }
}

async function verifyHydrateRefreshAndFreshOpen(browser) {
  console.log("[2] hydrate差分更新・セッション中の新着行タップ");
  const oldName = `AIフィードバック_${YESTERDAY}.md`;
  const newName = `AIフィードバック_${TODAY}.md`;
  const fixture = {
    index: { generatedAt: FRESH_GENERATED_AT, files: [{ name: oldName, date: YESTERDAY, kind: "feedback" }] },
    bodies: { [oldName]: "# 旧レポート\n\nold本文_v287", [newName]: "# 新着レポート\n\nnew本文_v287" }
  };
  const { context, page } = await connectedPage(browser, fixture);
  try {
    await seed(page, { currentView: "ai-reports", aiReportReadIds: [], settings: { aiReportType: "english", lastOpenedDate: TODAY } });
    await page.waitForSelector(`[data-action="ai-report-open-unread"][data-file="${oldName}"]`);
    fixture.index = { generatedAt: FRESH_GENERATED_AT, files: [{ name: newName, date: TODAY, kind: "feedback" }] };
    await page.clock.setFixedTime(new Date(2026, 7, 28, 10, 2, 0));
    const refreshed = page.waitForResponse((response) =>
      /\/contents\/taskchute\/report-index\.json$/.test(decodeURIComponent(new URL(response.url()).pathname)));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await refreshed;
    await page.waitForSelector(`[data-action="ai-report-open-unread"][data-file="${newName}"]`);
    check("hydrate相当で全体renderなしに未読一覧が旧→新へ差分更新", await page.locator(`[data-file="${oldName}"]`).count() === 0
      && await page.locator('[data-action="ai-report-open-unread"]').count() === 1
      && await badgeText(page, "#bottomNav", "more") === "1");

    await page.locator(`[data-action="ai-report-open-unread"][data-file="${newName}"]`).click();
    await page.waitForFunction((name) => document.querySelector(`[data-report-file="${name}"][data-report-loaded="1"]`), newName);
    const readIds = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).aiReportReadIds, STATE_KEY);
    check("新着行タップは古いdir cacheのfiles[0]でなく正しい本文を開いて既読化", await page.locator("[data-ai-report-date]").inputValue() === TODAY
      && (await page.locator(".md-render").textContent()).includes("new本文_v287")
      && readIds.includes(newName) && !readIds.includes(oldName), JSON.stringify(readIds));
  } finally { await context.close(); }
}

async function verifyUnreadNegatives(browser) {
  console.log("[3] 未読一覧負例: 0件・english除外・壊れindex・空本文");
  const englishName = `英語表現集_${TODAY}.md`;
  const zeroFixture = {
    index: { generatedAt: FRESH_GENERATED_AT, files: [{ name: englishName, date: TODAY, kind: "english" }] },
    bodies: { [englishName]: "# 英語表現集\n\n従来どおり閲覧可能_v287" }
  };
  const zero = await connectedPage(browser, zeroFixture);
  try {
    await seed(zero.page, { currentView: "ai-reports", aiReportReadIds: [], settings: { aiReportType: "english", lastOpenedDate: TODAY } });
    await zero.page.waitForSelector('[data-action="ai-report-type"][data-type="english"].active');
    check("14日窓内englishは通知対象外で一覧セクションなし", await zero.page.locator("[data-ai-report-unread-list]").count() === 0);
    check("未読0件でmoreバッジDOMなし", await badgeText(zero.page, "#bottomNav", "more") === null);
    check("english本文は従来どおり閲覧可能", (await zero.page.locator(".md-render").textContent()).includes("従来どおり閲覧可能_v287"));
  } finally { await zero.context.close(); }

  const failures = [
    { name: "JSON不正", fixture: { indexRaw: "{ broken" } },
    { name: "generatedAt 48時間超過", fixture: { index: { generatedAt: "2026-08-25T00:00:00Z", files: [{ name: `AIフィードバック_${TODAY}.md`, date: TODAY, kind: "feedback" }] } } }
  ];
  for (const variant of failures) {
    const current = await connectedPage(browser, variant.fixture);
    try {
      await seed(current.page, { currentView: "ai-reports", aiReportReadIds: [], settings: { aiReportType: "feedback", lastOpenedDate: TODAY } });
      check(`${variant.name}: 一覧と未読バッジはfail-quietで非表示`, await current.page.locator("[data-ai-report-unread-list]").count() === 0
        && await badgeText(current.page, "#bottomNav", "more") === null);
      const tabs = await current.page.$$eval('[data-action="ai-report-type"]', (elements) => elements.map((element) => ({
        id: element.dataset.type, active: element.classList.contains("active")
      })));
      check(`${variant.name}: 必須タブが存在しfeedbackがactive`, REQUIRED_AI_REPORT_TABS.every((id) => tabs.some((tab) => tab.id === id))
        && tabs.some((tab) => tab.id === "feedback" && tab.active)
        && (await current.page.locator("main").textContent()).includes("まだ生成されていません"), JSON.stringify(tabs));
      check(`${variant.name}: pageerror/console errorなし`, current.pageErrors.length === 0 && current.consoleErrors.length === 0,
        JSON.stringify({ pageErrors: current.pageErrors, consoleErrors: current.consoleErrors }));
    } finally { await current.context.close(); }
  }

  const failedName = `AIフィードバック_${TODAY}.md`;
  const bodyFailure = await connectedPage(browser, {
    index: { generatedAt: FRESH_GENERATED_AT, files: [
      { name: failedName, date: TODAY, kind: "feedback" },
      { name: englishName, date: TODAY, kind: "english" }
    ] },
    bodies: { [failedName]: "", [englishName]: "# English\n\n先に表示" }
  });
  try {
    await seed(bodyFailure.page, { currentView: "ai-reports", aiReportReadIds: [], settings: { aiReportType: "english", lastOpenedDate: TODAY } });
    await bodyFailure.page.locator(`[data-action="ai-report-open-unread"][data-file="${failedName}"]`).click();
    await bodyFailure.page.waitForFunction(() => document.querySelector("main")?.textContent.includes("本文を取得できませんでした"));
    const readIds = await bodyFailure.page.evaluate((key) => JSON.parse(localStorage.getItem(key)).aiReportReadIds, STATE_KEY);
    check("空本文は既読化されない", !readIds.includes(failedName), JSON.stringify(readIds));
    check("空本文の未読行とmoreバッジは残る", await bodyFailure.page.locator(`[data-file="${failedName}"]`).count() === 1
      && await badgeText(bodyFailure.page, "#bottomNav", "more") === "1");
  } finally { await bodyFailure.context.close(); }
}

function taskFixture() {
  const tasks = [
    task("valid-start"), task("valid-complete"), task("started"), task("completed"), task("deleted"),
    task("yesterday"), task("timeline"), task("routine"), task("stale", { status: "suspended" })
  ];
  const blocks = [
    block("valid-start-block", "valid-start"),
    block("valid-complete-block", "valid-complete", TODAY, { plannedStartAt: `${TODAY}T10:00:00`, plannedEndAt: `${TODAY}T10:30:00` }),
    block("started-block", "started", TODAY, { actualStartAt: `${TODAY}T08:45:00` }),
    block("completed-block", "completed", TODAY, { completed: true }),
    block("deleted-block", "deleted", TODAY, { deleted: true }),
    block("yesterday-block", "yesterday", YESTERDAY),
    block("timeline-block", "timeline", TODAY, { source: "timeline" }),
    block("routine-block", "routine", TODAY, { category: "ルーティン" }),
    block("stale-block", "stale")
  ];
  return { projects: [project()], tasks, blocks };
}

async function verifyTaskBadges(browser) {
  console.log("[4] 未着手バッジ: 母集団・開始/完了即時更新・99+・過去日閲覧・日跨ぎ");
  const fixture = { index: { generatedAt: FRESH_GENERATED_AT, files: [{ name: `未知_${TODAY}.md`, date: TODAY, kind: "unknown" }] } };
  const { context, page, pageErrors, consoleErrors } = await connectedPage(browser, fixture);
  try {
    await seed(page, {
      projects: [project()],
      tasks: [task("one-tap-task"), task("recurrence-task"), task("unlinked-task", { projectId: "" })],
      recurrences: [{
        id: "rule-1", title: "境界ルーティン", category: "ルーティン", taskId: "recurrence-task", kind: "daily",
        startTime: "09:00", endTime: "09:30", anchorDate: TODAY, exceptionDates: [], deleted: false
      }],
      blocks: [
        block("one-tap-block", "one-tap-task", TODAY, { oneTap: true }),
        block("taskless-block", ""),
        block("recurrence-block", "recurrence-task", TODAY, { recurrenceGroupId: "rule-1" }),
        block("unlinked-block", "unlinked-task")
      ],
      currentView: "tasks", selectedDate: TODAY, settings: { lastOpenedDate: TODAY, focusTimerAuto: false }
    });
    const boundary = {
      badge: await badgeText(page, "#sidebar", "tasks"),
      oneTap: await page.locator('.block-row [data-action="now-start"][data-id="one-tap-block"]').count(),
      taskless: await page.locator('.block-row [data-action="now-start"][data-id="taskless-block"]').count(),
      recurrence: await page.locator('.block-row [data-action="now-start"][data-id="recurrence-block"]').count(),
      unlinked: await page.locator('.block-row [data-action="now-start"][data-id="unlinked-block"]').count()
    };
    check("母集団境界はoneTap・taskId無しが対象、recurrence・Project未紐づけは非対象", boundary.badge === "2"
      && boundary.oneTap === 1 && boundary.taskless === 1 && boundary.recurrence === 0 && boundary.unlinked === 0, JSON.stringify(boundary));

    const base = taskFixture();
    await seed(page, {
      ...base, currentView: "tasks", selectedDate: TODAY,
      settings: { lastOpenedDate: TODAY, focusTimerAuto: false }
    });
    await page.waitForSelector('.block-row [data-action="now-start"][data-id="valid-start-block"]');
    check("開始済み・完了・削除・昨日・timeline・routine・staleを除外し未着手2件", await badgeText(page, "#sidebar", "tasks") === "2"
      && await badgeText(page, "#bottomNav", "tasks") === "2");
    check("バッジ件数はタスクシュートに見える未着手行数と一致", await page.locator('.block-row [data-action="now-start"]').count() === 2);

    const mobileItems = await page.$$eval("#bottomNav button", (elements) => elements.map((element) => ({
      id: element.dataset.view, label: element.childNodes[0].textContent
    })));
    const expectedMobileItems = [
      { id: "today", label: "今日" }, { id: "journal", label: "ジャーナル" },
      { id: "tasks", label: "実行" }, { id: "timeline", label: "時間" }, { id: "more", label: "その他" }
    ];
    check("mobileNavは5項目・id・ラベル不変", JSON.stringify(mobileItems) === JSON.stringify(expectedMobileItems), JSON.stringify(mobileItems));

    await page.locator('.block-row [data-action="now-start"][data-id="valid-start-block"]').click();
    await page.locator('[data-action="declare-skip"]').click();
    await page.waitForFunction(() => document.querySelector('#bottomNav [data-view="tasks"] .nav-badge')?.textContent === "1");
    check("開始操作でサイドバー・下部ナビとも即時1減", await badgeText(page, "#sidebar", "tasks") === "1"
      && await badgeText(page, "#bottomNav", "tasks") === "1");

    await page.locator('.block-row [data-action="toggle-block"][data-id="valid-complete-block"]').click();
    await page.waitForFunction(() => !document.querySelector('#bottomNav [data-view="tasks"] .nav-badge'));
    check("完了操作で0件になりtasksバッジDOM自体が両方から消える", await badgeText(page, "#sidebar", "tasks") === null
      && await badgeText(page, "#bottomNav", "tasks") === null);

    await seed(page, {
      ...base, currentView: "tasks", selectedDate: TODAY,
      settings: { lastOpenedDate: TODAY, focusTimerAuto: false }
    });
    await page.locator('[data-action="date-prev"]').click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).selectedDate === "2026-08-27", STATE_KEY);
    const pastSnapshot = {
      sidebar: await badgeText(page, "#sidebar", "tasks"),
      bottom: await badgeText(page, "#bottomNav", "tasks"),
      rows: await page.locator(".block-row").count(),
      selectedDate: await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).selectedDate, STATE_KEY)
    };
    check("過去日閲覧中もバッジは今日基準の2件で不変", pastSnapshot.sidebar === "2"
      && pastSnapshot.bottom === "2" && pastSnapshot.rows === 1 && pastSnapshot.selectedDate === YESTERDAY,
      JSON.stringify(pastSnapshot));

    const manyBlocks = Array.from({ length: 101 }, (_, index) => block(`many-${index}`, "many-task", TODAY, {
      plannedStartAt: `${TODAY}T${String(9 + Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00`
    }));
    await seed(page, {
      projects: [project()], tasks: [task("many-task")], blocks: manyBlocks,
      currentView: "today", selectedDate: TODAY, settings: { lastOpenedDate: TODAY, focusTimerAuto: false }
    });
    check("100件超はサイドバー・下部ナビとも99+", await badgeText(page, "#sidebar", "tasks") === "99+"
      && await badgeText(page, "#bottomNav", "tasks") === "99+");

    await page.clock.setFixedTime(new Date(2026, 7, 28, 23, 59, 0));
    await seed(page, {
      projects: [project()], tasks: [task("cross-task")],
      blocks: [block("cross-today", "cross-task", TODAY), block("cross-next-1", "cross-task", TOMORROW), block("cross-next-2", "cross-task", TOMORROW)],
      currentView: "tasks", selectedDate: TODAY, settings: { lastOpenedDate: TODAY, focusTimerAuto: false }
    });
    check("日跨ぎ前は当日1件", await badgeText(page, "#bottomNav", "tasks") === "1");
    await page.clock.setFixedTime(new Date(2026, 7, 29, 0, 1, 0));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction(() => document.querySelector('#bottomNav [data-view="tasks"] .nav-badge')?.textContent === "2");
    const crossed = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    check("visibilitychange日跨ぎで新しい今日の2件へ再計算", await badgeText(page, "#sidebar", "tasks") === "2"
      && crossed.selectedDate === TOMORROW && crossed.settings.lastOpenedDate === TOMORROW);
    check("未着手バッジ主要経路でpageerror/console errorなし", pageErrors.length === 0 && consoleErrors.length === 0,
      JSON.stringify({ pageErrors, consoleErrors }));
  } finally { await context.close(); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  try {
    await verifyUnreadList(browser);
    await verifyHydrateRefreshAndFreshOpen(browser);
    await verifyUnreadNegatives(browser);
    await verifyTaskBadges(browser);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures === 0 ? "\n✅ v287: 全テスト成功" : `\n❌ v287: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
