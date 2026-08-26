// v266: COUNTDOWNの12WY週次スコア信号、展開内訳、設定、ATIS縦予算を検証する。
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY, openSettingsGroup
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const topbandSource = fs.readFileSync(path.join(ROOT, "src", "features", "topband.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
const maxRelease = Math.max(...fs.readdirSync(path.join(ROOT, "releases"))
  .map((file) => /^v(\d+)\.json$/.exec(file)?.[1]).filter(Boolean).map(Number));
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}

function countMatches(source, pattern) {
  return (source.match(pattern) || []).length;
}

function contrastRatio(foreground, background, underlay = "rgb(0, 0, 0)") {
  const valuesOf = (color) => (String(color).match(/[\d.]+/g) || []).map(Number);
  const backgroundValues = valuesOf(background);
  const underlayValues = valuesOf(underlay);
  const effectiveBackground = backgroundValues.length > 3 && backgroundValues[3] < 1
    ? backgroundValues.slice(0, 3).map((value, index) => value * backgroundValues[3]
      + underlayValues[index] * (1 - backgroundValues[3]))
    : backgroundValues.slice(0, 3);
  const luminance = (values) => {
    const channels = values.map((value) => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const a = luminance(valuesOf(foreground).slice(0, 3)), b = luminance(effectiveBackground);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

(async () => {
  console.log("[1] 静的契約・import実測・iOS/SW/CSSガード");
  check("weeklyScore importは既存1件だけで、selectTrackFooterを1件追加", countMatches(appSource.slice(0, 600), /\bweeklyScore\b/g) === 1
    && countMatches(appSource.slice(0, 600), /\bselectTrackFooter\b/g) === 1);
  check("toggleTwyScoreExpanded import/呼出とaction登録は重複なし", countMatches(appSource, /\btoggleTwyScoreExpanded\b/g) === 2
    && countMatches(appSource, /"twy-score-toggle"\s*:/g) === 1);
  check("表示トグルはsaveState/generateReportを呼ばずrenderだけ", /"twy-score-toggle"\s*:\s*\(\)\s*=>\s*\{\s*toggleTwyScoreExpanded\(\);\s*render\(\);\s*\}/.test(appSource));
  const scoreRendererSource = topbandSource.slice(topbandSource.indexOf("function twyScoreHTML"), topbandSource.indexOf("export function renderCountdown"));
  check("topbandは個別listener/id/new Date文字列パースを追加しない", !topbandSource.includes("addEventListener")
    && !/\sid=/.test(scoreRendererSource) && !/new Date\s*\(/.test(scoreRendererSource));
  check(".t-state 5+1は既存定義を再利用", countMatches(stylesSource, /^\.t-state\.s-/gm) === 6
    && stylesSource.includes(".t-state.s-ahead, .t-state.s-done"));
  check("ATIS縦予算は指定2ルール", /\.tower-atis-body\s*\{[^}]*max-height:\s*60vh;[^}]*overflow-y:\s*auto;/.test(stylesSource)
    && /\.tower-atis-feedback-body \.readonly-md\s*\{\s*min-height:\s*0;\s*\}/.test(stylesSource));
  check("TOWER赤トークンと40pxタップ標的を正本で定義", /\.today-tower, \.tower-skin\s*\{[^}]*--tower-red:\s*#ff6d7f;/.test(stylesSource)
    && /\.twy-score-signal\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*min-height:\s*40px;/.test(stylesSource));
  check("TRACKS pace/meta CSSは行内へスコープ", !/^\.t-(?:pace|meta)\b/m.test(stylesSource)
    && countMatches(stylesSource, /^\.twy-track-line \.t-(?:pace|meta)\b/gm) === 4);
  check(`CACHE_NAMEはreleases最大版v${maxRelease}`, new RegExp(
    `^const CACHE_NAME = "taskchute-journal-pwa-v${maxRelease}";`, "m").test(swSource));
  const topband = await import(pathToFileURL(path.join(ROOT, "src", "features", "topband.js")).href);
  topband.configureTopband({ escapeHTML: (value) => String(value), todayISO: () => "2026-08-25",
    getSettings: () => ({ twelveWeekStartDate: "2026-08-15", birthDate: "" }), getTrackDigest: () => null });
  const noBirthHTML = topband.renderCountdown();
  check("birthDate未設定ならtopbandは寿命2セルを描画しない", countMatches(noBirthHTML, /class="tower-life-cell/g) === 2
    && !noBirthHTML.includes("45歳まで") && !noBirthHTML.includes("80歳まで"));

  const instrumentedApp = appSource
    .replace("let cachedAiWorkResults = null;", "let cachedAiWorkResults = null; window.__v266SetAiWorkResults = (items) => { cachedAiWorkResults = items; };")
    .replace("function saveState() {", "function saveState() { window.__v266SaveCalls = (window.__v266SaveCalls || 0) + 1;")
    .replace("function render() {", "function render() { window.__v266RenderCalls = (window.__v266RenderCalls || 0) + 1;")
    .replace("function generateReport(dateArg, { quiet = false } = {}) {",
      "function generateReport(dateArg, { quiet = false } = {}) { window.__v266GenerateReportCalls = (window.__v266GenerateReportCalls || 0) + 1;");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1024, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);
  await page.route(`http://localhost:${PORT}/app.js`, (route) => route.fulfill({
    status: 200, contentType: "application/javascript; charset=utf-8", body: instrumentedApp
  }));

  const TODAY = "2026-08-25", PREVIOUS_DAY = "2026-08-24", SATURDAY = "2026-08-22", CYCLE = "2026-08-15", PREV = "2026-08-15";
  const stamp = `${TODAY}T10:00:00`;
  const project = (id, extra = {}) => ({ id, kind: "normal", title: id, status: "active", priority: "中",
    category: "", startDate: CYCLE, dueDate: "", description: "", twelveWeekStartDate: CYCLE,
    showProgress: false, collapsed: false, createdAt: stamp, updatedAt: stamp, deleted: false, ...extra });
  const task = (id, projectId, extra = {}) => ({ id, projectId, parentTaskId: "", title: id, category: "",
    status: "todo", dueDate: "", description: "", progressNum: 0, progressDen: 1,
    createdAt: stamp, updatedAt: stamp, deleted: false, ...extra });
  const block = (id, taskId, extra = {}) => ({ id, taskId, date: TODAY, title: id, plannedStart: "10:00",
    plannedEnd: "10:30", completed: false, actualStartAt: "", actualEndAt: "", createdAt: stamp,
    updatedAt: stamp, deleted: false, ...extra });
  const numericTrack = (id, ownerId, extra = {}) => ({ id, ownerType: "project", ownerId,
    cycleStartDate: CYCLE, kind: "numeric", name: id, unit: "章", startDate: CYCLE, deadline: "2026-09-30",
    baselineValue: 0, goalValue: 100, valueStep: 1, milestones: [], status: "active", closedAt: "",
    closedReason: "", supersedesTrackId: "", carriedFromTrackId: "", createdAt: stamp,
    updatedAt: stamp, deleted: false, ...extra });
  const measurement = (trackId, value, observedAt = `${TODAY}T09:00:00`) => ({ id: `m-${trackId}`,
    trackId, value, observedAt, updatedAt: observedAt, deleted: false });
  const weekMeta = (weekStart = SATURDAY, extra = {}) => ({ id: `wcw_${weekStart}`, recordType: "week",
    weekStart, cycleStartDate: CYCLE, committedAt: `${weekStart}T07:00:00`, committedVia: "manual",
    selectedBlockIds: [], updatedAt: stamp, deleted: false, ...extra });
  const weekItem = (id, weekStart = SATURDAY, extra = {}) => ({ id: `wci_${weekStart}_${id}`,
    recordType: "item", weekStart, lane: "cycle", blockId: id, taskId: "t-score", projectId: "p-score",
    trackId: "", title: id, plannedDate: weekStart, completedAt: "", completedChangedAt: "",
    excused: false, excusedReason: "", source: "confirmed", updatedAt: stamp, deleted: false, ...extra });
  const scoredCommitments = (done, total, weekStart = SATURDAY) => {
    const ids = Array.from({ length: total }, (_, index) => `score-${index + 1}`);
    return [weekMeta(weekStart, { selectedBlockIds: ids }), ...ids.map((id, index) =>
      weekItem(id, weekStart, { completedAt: index < done ? stamp : "" }))];
  };
  const candidateFixture = () => ({ projects: [project("p-candidate")], tasks: [task("t-candidate", "p-candidate")],
    blocks: [block("b-candidate", "t-candidate")] });

  async function resetCounters() {
    await page.evaluate(() => { window.__v266SaveCalls = 0; window.__v266RenderCalls = 0; window.__v266GenerateReportCalls = 0; });
  }

  async function counters() {
    return page.evaluate(() => ({ save: window.__v266SaveCalls || 0, render: window.__v266RenderCalls || 0,
      report: window.__v266GenerateReportCalls || 0 }));
  }

  async function seed(overrides = {}) {
    const fixture = {
      projects: [], tasks: [], blocks: [], tracks: [], trackMeasurements: [], weeklyCommitments: [],
      feedback: {}, journalMeta: {}, aiLinkFreshness: { feedbackAt: TODAY, planAt: TODAY },
      birthDate: "1980-01-01", scoreTarget: 85, cycleStart: CYCLE, ...overrides
    };
    await page.evaluate(({ key, fixture, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "today";
      state.selectedDate = today;
      state.settings.twelveWeekStartDate = fixture.cycleStart;
      state.settings.twelveWeekScoreTarget = fixture.scoreTarget;
      state.settings.birthDate = fixture.birthDate;
      state.projects = fixture.projects;
      state.tasks = fixture.tasks;
      state.blocks = fixture.blocks;
      state.tracks = fixture.tracks;
      state.trackMeasurements = fixture.trackMeasurements;
      state.weeklyCommitments = fixture.weeklyCommitments;
      state.feedback = fixture.feedback;
      state.journalMeta = fixture.journalMeta;
      state.aiLinkFreshness = fixture.aiLinkFreshness;
      state.recurrences = [];
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, fixture, today: TODAY });
    await page.reload();
    await page.waitForSelector(".sec-life");
    await page.evaluate(() => window.__v266SetAiWorkResults?.([]));
    await resetCounters();
  }

  const mobile = () => page.locator(".sec-life");
  const signal = () => mobile().locator('[data-action="twy-score-toggle"]');
  const signalText = () => signal().textContent();

  try {
    await page.clock.setFixedTime(new Date(2026, 7, 25, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[2] B-6 #1〜#10: 未設定・未確定・色・N/A・確定0");
    await seed({ cycleStart: "" });
    check("B-6 #1 12WY未設定はscore/banner/tracks全非表示", await page.locator(".twy-score, .twy-commit-banner, .twy-tracks-foot").count() === 0);

    const previous = scoredCommitments(1, 1, PREV);
    await seed({ ...candidateFixture(), weeklyCommitments: previous });
    check("B-6 #2 未確定候補ありは先週スコア+バナー+確定ボタン", (await mobile().locator(".twy-score").textContent()).includes("未確定・先週100%")
      && await mobile().locator(".twy-score-signal").count() === 0
      && (await mobile().locator(".twy-commit-banner").textContent()).includes("候補 1件")
      && await mobile().locator('[data-action="twy-open-commit"]').count() === 1);
    const olderMeta = weekMeta(SATURDAY, { updatedAt: `${TODAY}T08:00:00` });
    const newerDeletedMeta = weekMeta(SATURDAY, { updatedAt: `${TODAY}T11:00:00`, deleted: true });
    await seed({ ...candidateFixture(), weeklyCommitments: [olderMeta, newerDeletedMeta] });
    check("同一週metaの新しいtombstoneを優先して未確定導線を維持", await mobile().locator(".twy-score-signal").count() === 0
      && (await mobile().locator(".twy-score").textContent()).includes("未確定")
      && await mobile().locator('[data-action="twy-open-commit"]').count() === 1);
    await seed();
    check("B-6 #3 未確定候補0は信号だけでバナーなし", (await mobile().locator(".twy-score").textContent()).includes("未確定")
      && await page.locator(".twy-commit-banner").count() === 0);
    check("B-6 #4 先週データなしは先週表記なし", !(await mobile().locator(".twy-score").textContent()).includes("先週"));

    await seed({ weeklyCommitments: scoredCommitments(6, 6) });
    check("B-6 #5 初回折りたたみはaria-expanded=false", await signal().getAttribute("aria-expanded") === "false"
      && await mobile().locator(".twy-score-detail").count() === 0);
    await resetCounters();
    await page.locator('.nav-button[data-view="settings"]').click();
    await page.locator('.nav-button[data-view="today"]').click();
    await page.waitForSelector('.sec-life [data-action="twy-score-toggle"]');
    let probe = await counters();
    check("初期・折りたたみの無関係renderはsave/report 0回", probe.save === 0 && probe.report === 0
      && await signal().getAttribute("aria-expanded") === "false", JSON.stringify(probe));
    check("B-6 #5 scored>=目安はdone/total・軌道内 is-goodの1行", (await signalText()).includes("6/6・軌道内")
      && await signal().evaluate((el) => el.classList.contains("is-good"))
      && await mobile().locator(".twy-score-detail").count() === 0);
    await seed({ weeklyCommitments: scoredCommitments(4, 5) });
    check("B-6 #6 70<=pct<目安は要注意 is-mid", (await signalText()).includes("4/5・要注意")
      && await signal().evaluate((el) => el.classList.contains("is-mid")));
    await seed({ weeklyCommitments: scoredCommitments(1, 2) });
    check("B-6 #7 pct<70は遅延 is-low", (await signalText()).includes("1/2・遅延")
      && await signal().evaluate((el) => el.classList.contains("is-low")));
    await signal().click();
    const lowStyles = await signal().evaluate((el) => ({
      color: getComputedStyle(el).color,
      amberColor: (() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--tower-amber)";
        el.closest(".today-tower").appendChild(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      })(),
      panelBackground: getComputedStyle(el.closest(".tower-panel-box")).backgroundColor,
      rootBackground: getComputedStyle(el.closest(".today-tower")).backgroundColor,
      display: getComputedStyle(el).display,
      alignItems: getComputedStyle(el).alignItems,
      height: el.getBoundingClientRect().height
    }));
    const lowBarStyles = await mobile().locator(".twy-score-bar.is-low > span").evaluate((el) => ({
      background: getComputedStyle(el).backgroundColor,
      shadow: getComputedStyle(el).boxShadow
    }));
    check("is-lowは--tower-amber実効色で暗パネル比4.5:1以上", lowStyles.color === lowStyles.amberColor
      && lowBarStyles.background === lowStyles.amberColor && lowBarStyles.shadow.includes(lowStyles.amberColor)
      && contrastRatio(lowStyles.color, lowStyles.panelBackground, lowStyles.rootBackground) >= 4.5,
      JSON.stringify({ ...lowStyles, lowBarStyles, ratio: contrastRatio(lowStyles.color, lowStyles.panelBackground, lowStyles.rootBackground) }));
    check("スコア信号はinline-flex中央揃え・実測40px以上", lowStyles.display === "inline-flex"
      && lowStyles.alignItems === "center" && lowStyles.height >= 40, JSON.stringify(lowStyles));
    await seed({ weeklyCommitments: scoredCommitments(7, 10), scoreTarget: 70 });
    check("B-6 #8 目安70ではis-midが出ず70%はis-good", await signal().evaluate((el) => el.classList.contains("is-good") && !el.classList.contains("is-mid")));
    await seed({ weeklyCommitments: scoredCommitments(2, 3), scoreTarget: 70 });
    check("目安70でもpct<70はis-lowでis-mid不在", await signal().evaluate((el) => el.classList.contains("is-low") && !el.classList.contains("is-mid")));
    const excused = scoredCommitments(0, 2).map((record) => record.recordType === "item" ? { ...record, excused: true } : record);
    await seed({ weeklyCommitments: excused });
    check("B-6 #9 全免除はN/A・免除", (await signalText()).includes("N/A・免除"));
    await seed({ weeklyCommitments: [weekMeta()] });
    check("B-6 #10 meta存在・対象0は確定0・対象0でバナーなし", (await signalText()).includes("確定0・対象0")
      && await page.locator(".twy-commit-banner").count() === 0);
    const isNaColor = await signal().evaluate((el) => getComputedStyle(el).color);
    check("is-low computed colorはis-naと異なる", lowStyles.color !== isNaColor, JSON.stringify({ low: lowStyles.color, na: isNaColor }));

    console.log("[3] B-6 #11〜#19: 展開機械・TRACKS・二重描画・#12結線");
    await seed({ weeklyCommitments: scoredCommitments(4, 5) });
    await signal().click();
    check("B-6 #11 タップ展開でdetail/bar/目安・aria/caret", await mobile().locator(".twy-score-detail .twy-score-bar").count() === 1
      && (await mobile().locator(".twy-score-target").textContent()) === "目安85"
      && await signal().getAttribute("aria-expanded") === "true" && (await signal().textContent()).includes("▾"));
    probe = await counters();
    check("展開トグルはsave/report 0回・render 1回", probe.save === 0 && probe.report === 0 && probe.render === 1, JSON.stringify(probe));
    await resetCounters();
    await signal().click();
    check("B-6 #12 再タップでdetail消滅・aria false・caret復帰", await mobile().locator(".twy-score-detail").count() === 0
      && await signal().getAttribute("aria-expanded") === "false" && (await signal().textContent()).includes("▸"));

    await seed({ weeklyCommitments: scoredCommitments(1, 1) });
    await signal().click();
    check("B-6 #13 track 0件は展開してもフッタ要素なし", await mobile().locator(".twy-tracks-foot").count() === 0);

    const aheadProjects = [project("p-ahead"), project("p-ontrack")];
    const aheadTracks = [numericTrack("ahead", "p-ahead"), numericTrack("ontrack", "p-ontrack")];
    const aheadMeasurements = [measurement("ahead", 60), measurement("ontrack", 22)];
    await seed({ weeklyCommitments: scoredCommitments(1, 1), projects: aheadProjects, tracks: aheadTracks,
      trackMeasurements: aheadMeasurements });
    await signal().click();
    check("B-6 #14 ahead/ontrackだけなら先頭1件", await mobile().locator(".twy-track-line").count() === 1);

    const mixedProjects = [project("p-overdue"), project("p-warn"), project("p-stale"), project("p-done")];
    const mixedTracks = [
      numericTrack("overdue", "p-overdue", { deadline: "2026-08-24" }),
      numericTrack("warn", "p-warn"), numericTrack("stale", "p-stale"),
      numericTrack("done", "p-done", { goalValue: 10 })
    ];
    const mixedMeasurements = [measurement("overdue", 50), measurement("warn", 0),
      measurement("stale", 22, "2026-08-15T09:00:00"), measurement("done", 10)];
    await seed({ weeklyCommitments: scoredCommitments(1, 1), projects: mixedProjects, tracks: mixedTracks,
      trackMeasurements: mixedMeasurements });
    await signal().click();
    const mixedRows = await mobile().locator(".twy-track-line").allTextContents();
    check("B-6 #15 severity混在は期限超過→要注意の最大2件", mixedRows.length === 2
      && mixedRows[0].includes("期限超過") && mixedRows[1].includes("要注意"), JSON.stringify(mixedRows));
    check("期限超過だけs-overdueへ変換", await mobile().locator(".twy-track-line").first().locator(".t-state.s-overdue").count() === 1);
    check("B-6 #16 mobile/PCに同じtoggle actionが各1件", await page.locator('.sec-life [data-action="twy-score-toggle"]').count() === 1
      && await page.locator('.sec-life-pc [data-action="twy-score-toggle"]').count() === 1);
    await seed({ ...candidateFixture() });
    check("B-6 #16 mobile/PCに同じopen-commit actionが各1件", await page.locator('.sec-life [data-action="twy-open-commit"]').count() === 1
      && await page.locator('.sec-life-pc [data-action="twy-open-commit"]').count() === 1);

    await seed({ weeklyCommitments: scoredCommitments(1, 1) });
    await page.setViewportSize({ width: 390, height: 844 });
    await signal().click();
    await page.setViewportSize({ width: 1280, height: 900 });
    check("B-6 #17 mobile展開後にPC幅でも共有状態が展開", await page.locator(".sec-life-pc .twy-score-detail").count() === 1
      && await page.locator('.sec-life-pc [aria-expanded="true"]').count() === 1);
    await page.locator('.nav-button[data-view="settings"]').click();
    await page.waitForSelector('[data-setting-scoretarget]', { state: "attached" });
    await page.locator('.nav-button[data-view="today"]').click();
    await page.waitForSelector(".sec-life-pc .twy-score-detail");
    check("B-6 #18 無関係renderを跨いでも展開状態を保持", await mobile().locator(".twy-score-detail").count() === 1);

    await page.setViewportSize({ width: 1024, height: 900 });
    await seed({ ...candidateFixture() });
    await mobile().locator('[data-action="twy-open-commit"]').click();
    check("B-6 #19/#12 twy-open-commitで確定シートが開く", await page.locator(".twy-commit-sheet").count() === 1
      && (await page.locator(".twy-commit-sheet").textContent()).includes("候補"));

    console.log("[4] 負例・境界・XSS・週境界・表示state不変");
    const boundaryProjects = [
      project("p-in", { twelveWeekStartDate: "2026-11-06" }),
      project("p-out", { twelveWeekStartDate: "2026-11-07" }), project("p-closed"), project("p-deleted")
    ];
    const xss = '\"><img data-v266-breached src=x>';
    const boundaryTracks = [numericTrack("inside", "p-in", { name: xss, unit: xss }),
      numericTrack("outside", "p-out"), numericTrack("closed", "p-closed", { status: "closed" }),
      numericTrack("deleted", "p-deleted", { deleted: true })];
    await seed({ weeklyCommitments: scoredCommitments(1, 1), projects: boundaryProjects, tracks: boundaryTracks,
      trackMeasurements: [] });
    await signal().click();
    const boundaryText = await mobile().locator(".twy-tracks-foot").textContent();
    check("+83日内/+84日外・closed/deleted除外", boundaryText.includes(xss) && !boundaryText.includes("outside")
      && !boundaryText.includes("closed") && !boundaryText.includes("deleted"));
    check("measurement 0件でもNaN/Infinityなし", !boundaryText.includes("NaN") && !boundaryText.includes("Infinity"));
    check("track.name/unitはescapeされDOM注入なし", await page.locator("[data-v266-breached]").count() === 0);

    await seed({ weeklyCommitments: scoredCommitments(1, 1), projects: [project("p-baseline")],
      tracks: [numericTrack("baseline-only", "p-baseline")], trackMeasurements: [] });
    await signal().click();
    const baselineText = await mobile().locator(".twy-track-line").textContent();
    check("measurement 0件で8日以上なら具体paceを出さず未更新表示", baselineText.includes("未更新")
      && baselineText.includes("不明") && !baselineText.includes("-22章")
      && baselineText.includes("0/100章"), baselineText);

    await seed({ weeklyCommitments: scoredCommitments(1, 1), projects: [project("p-tolerance")],
      tracks: [numericTrack("within-tolerance", "p-tolerance")], trackMeasurements: [measurement("within-tolerance", 20)] });
    await signal().click();
    check("tolerance内の遅れは状態語と同じ順調色", (await mobile().locator(".twy-track-line .t-state").textContent()) === "順調"
      && await mobile().locator(".twy-track-line .t-pace.pos").count() === 1
      && await mobile().locator(".twy-track-line .t-pace.neg").count() === 0);

    await page.clock.setFixedTime(new Date(2026, 7, 22, 10, 0, 0));
    await seed({ weeklyCommitments: scoredCommitments(1, 1) });
    const saturdayText = await signalText();
    await page.clock.setFixedTime(new Date(2026, 7, 25, 10, 0, 0));
    await seed({ weeklyCommitments: scoredCommitments(1, 1) });
    check("土曜と平日で同じweekStartのスコアを読む", saturdayText.includes("1/1") && (await signalText()).includes("1/1"));
    const beforeDisplay = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await resetCounters();
    await signal().click();
    const afterDisplay = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    probe = await counters();
    check("build/render/toggleは保存state不変・save/report 0回", beforeDisplay === afterDisplay && probe.save === 0 && probe.report === 0);

    console.log("[5] 設定70〜100・保存1回・normalize安定・既存COUNTDOWN/ATIS/#9回帰");
    await page.locator('.nav-button[data-view="settings"]').click();
    await page.waitForSelector('[data-setting-scoretarget]', { state: "attached" });
    await openSettingsGroup(page, "settings-master");
    const scoreInput = () => page.locator('[data-setting-scoretarget]');
    check("設定入力はnumber/min70/max100/step1/font-size>=16", await scoreInput().getAttribute("type") === "number"
      && await scoreInput().getAttribute("min") === "70" && await scoreInput().getAttribute("max") === "100"
      && await scoreInput().getAttribute("step") === "1"
      && parseFloat(await scoreInput().evaluate((el) => getComputedStyle(el).fontSize)) >= 16);
    async function changeScore(value, expected) {
      await resetCounters();
      await scoreInput().evaluate((input, next) => { input.value = next; input.dispatchEvent(new Event("change", { bubbles: true })); }, value);
      await page.waitForFunction(({ key, expected }) => JSON.parse(localStorage.getItem(key)).settings.twelveWeekScoreTarget === expected,
        { key: STATE_KEY, expected });
      const calls = await counters();
      check(`scoreTarget ${value || "空"}→${expected}を1回保存・report 0`, calls.save === 1 && calls.report === 0, JSON.stringify(calls));
    }
    await changeScore("69", 70);
    await changeScore("101", 100);
    await changeScore("", 85);
    await changeScore("70", 70);
    await changeScore("100", 100);

    async function normalizeTwice(value) {
      await page.evaluate(({ key, value }) => { const state = JSON.parse(localStorage.getItem(key));
        state.settings.twelveWeekScoreTarget = value; localStorage.setItem(key, JSON.stringify(state)); }, { key: STATE_KEY, value });
      const observed = [];
      for (let index = 0; index < 2; index++) {
        await page.reload(); await page.waitForSelector('[data-setting-scoretarget]', { state: "attached" });
        await openSettingsGroup(page, "settings-master");
        observed.push(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).settings.twelveWeekScoreTarget, STATE_KEY));
      }
      return observed;
    }
    const normalized70 = await normalizeTwice(69);
    const normalized100 = await normalizeTwice(100);
    const normalized85 = await normalizeTwice(85);
    check("normalizeState二重適用で70・100・85に安定", JSON.stringify(normalized70) === "[70,70]"
      && JSON.stringify(normalized100) === "[100,100]" && JSON.stringify(normalized85) === "[85,85]",
      JSON.stringify({ normalized70, normalized100, normalized85 }));

    await seed({ cycleStart: "", birthDate: "1980-01-01" });
    const countdownWithoutDigest = await mobile().locator(".tower-life-cell:not(.is-cycle)").evaluateAll((cells) => cells.map((cell) => cell.outerHTML));
    await seed({ weeklyCommitments: scoredCommitments(1, 1), birthDate: "1980-01-01",
      projects: [project("p-wbs")], tracks: [numericTrack("same-status", "p-wbs")],
      trackMeasurements: [measurement("same-status", 0)] });
    const countdownWithDigest = await mobile().locator(".tower-life-cell:not(.is-cycle)").evaluateAll((cells) => cells.map((cell) => cell.outerHTML));
    const countdownMetrics = await mobile().locator(".tower-life-cell:not(.is-cycle)").evaluateAll((cells) => cells.map((cell) => ({
      label: cell.querySelector(".tower-life-label")?.textContent,
      pct: cell.querySelector(".tower-life-pct")?.textContent,
      remaining: cell.querySelector(".tower-life-num")?.textContent.replace(/\s+/g, " ").trim(),
      barWidth: cell.querySelector(".tower-life-bar > span")?.style.width
    })));
    check("既存COUNTDOWN 3セルのHTMLはdigest追加前後で完全一致", JSON.stringify(countdownWithoutDigest) === JSON.stringify(countdownWithDigest));
    check("既存COUNTDOWNの残日数・進捗率・バー幅を固定", JSON.stringify(countdownMetrics) === JSON.stringify([
      { label: "今年", pct: "65%経過", remaining: "128 日", barWidth: "65%" },
      { label: "45歳まで", pct: "—", remaining: "0 日", barWidth: "100%" },
      { label: "80歳まで", pct: "—", remaining: "12,182 日", barWidth: "58%" }
    ]), JSON.stringify(countdownMetrics));

    const longFeedback = `## サマリー\n${Array.from({ length: 80 }, (_, index) => `実データ行${index + 1}`).join("\n")}\n## 詳細\n本文`;
    await seed({ feedback: { [TODAY]: longFeedback }, journalMeta: { [PREVIOUS_DAY]: {
      aiMitCandidates: [], aiImported: false, ideal: "", aiTaskCandidates: ["実候補"], aiRequest: ""
    } }, aiLinkFreshness: { feedbackAt: TODAY, planAt: TODAY } });
    await page.evaluate(() => window.__v266SetAiWorkResults?.([{
      resultId: "v266-work", taskId: "", title: "実作業", status: "completed", summary: "実測用", outputPath: "", minutes: 10
    }]));
    await page.locator('.nav-button[data-view="today"]').click();
    await page.waitForSelector(".tower-atis-body .ai-work-row");
    const atisActions = await page.locator(".tower-atis-actions [data-action]").evaluateAll((nodes) => nodes.map((node) => node.dataset.action));
    const atisDom = await page.locator(".tower-atis-body").evaluate((body) => {
      const selectors = [".ai-freshness-line", ".ai-work-row", ".tower-atis-feedback", ".tower-atis-chips", ".tower-atis-actions"];
      const nodes = selectors.map((selector) => body.querySelector(selector));
      return {
        present: nodes.map(Boolean),
        ordered: nodes.every((node, index) => index === 0 || Boolean(nodes[index - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)),
        overflow: getComputedStyle(body).overflowY,
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight
      };
    });
    check("ATIS既存3 actionのDOM順序不変", JSON.stringify(atisActions) === JSON.stringify(["ai-morning-plan", "ai-schedule", "today-replan"]));
    check("ATIS鮮度/work/feedback/chips/actionの存在・順序不変", atisDom.present.every(Boolean) && atisDom.ordered, JSON.stringify(atisDom));
    check("ATIS実データ長文はfillerなしで内部スクロール可能", atisDom.overflow === "auto"
      && atisDom.scrollHeight > atisDom.clientHeight, JSON.stringify(atisDom));

    await seed({ weeklyCommitments: scoredCommitments(1, 1), projects: [project("p-wbs")],
      tracks: [numericTrack("same-status", "p-wbs")], trackMeasurements: [measurement("same-status", 0)] });
    await signal().click();
    const countdownStatus = await mobile().locator(".twy-track-line .t-state").textContent();
    await page.locator('.nav-button[data-view="wbs"]').click();
    await page.waitForSelector('.twy-row[data-twy-track-id="same-status"]');
    const wbsStatus = await page.locator('.twy-row[data-twy-track-id="same-status"] .t-state').textContent();
    check("#9 WBSとCOUNTDOWNが同じtrackStatus結果", countdownStatus === wbsStatus && countdownStatus === "要注意");
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nv266: 全件成功" : `\nv266: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
