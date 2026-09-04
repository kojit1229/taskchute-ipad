// v260: 12WY WBS成果トラック行、前サイクル注記、第三の進捗非表示を検証する。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}
function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`source markerが見つかりません: ${startMarker}`);
  return source.slice(start, end);
}

(async () => {
  const trackCore = await import(pathToFileURL(path.join(ROOT, "src", "core", "track.js")).href);
  const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

  console.log("[1] 表示専用レンダラはstate不変・保存0回");
  const renderSource = sourceBetween(appSource, "function renderTwyTrackBlock(project) {", "function renderProjectTree(project) {");
  const sandbox = {
    String, Number, Boolean, Math, Object,
    state: { settings: { twelveWeekStartDate: "2026-08-15" }, trackMeasurements: [], tracks: [] },
    _twyOpenEditorIds: new Set(),
    activeTrackForProject: trackCore.activeTrackForProject,
    latestMeasurement: trackCore.latestMeasurement,
    paceNumeric: trackCore.paceNumeric,
    paceMilestone: trackCore.paceMilestone,
    trackStatus: trackCore.trackStatus,
    trackDaysBetween: trackCore.daysBetween,
    todayISO: () => "2026-08-24",
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    escapeHTML: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"),
    canCarryProjectCycle: (project) => project.twelveWeekStartDate < "2026-08-15",
    saveCalls: 0,
    saveState: () => { sandbox.saveCalls += 1; },
    saveAndRender: () => { sandbox.saveCalls += 1; }
  };
  vm.createContext(sandbox);
  vm.runInContext(renderSource, sandbox);
  const pureTrack = { id: "pure-track", ownerId: "pure-project", kind: "numeric", status: "active",
    startDate: "2026-08-14", deadline: "2026-09-03", baselineValue: 0, goalValue: 20, valueStep: 1,
    unit: "章", milestones: [], createdAt: "2026-08-14T00:00:00", deleted: false };
  sandbox.state.tracks = [pureTrack];
  const beforePure = JSON.stringify(sandbox.state);
  const pureHTML = sandbox.renderTwyTrackBlock({ id: "pure-project", twelveWeekStartDate: "2026-08-15" });
  const pureXss = '\"><input data-v260-breached="';
  const staleHTML = sandbox.renderTwyStaleNote({ id: pureXss, twelveWeekStartDate: "2026-05-23" });
  sandbox.renderTwyTrackRow(pureTrack);
  check("renderTwyTrackBlock以下の全経路でstateが完全不変", JSON.stringify(sandbox.state) === beforePure);
  check("表示専用レンダラはsaveState/saveAndRenderを呼ばない", sandbox.saveCalls === 0);
  check("レンダラはdata-action付きHTMLだけを返す", pureHTML.includes('data-action="twy-open-editor"')
    && !renderSource.includes("addEventListener"));
  check("前サイクル注記のproject.idをescapeHTML", staleHTML.includes(`data-id="${sandbox.escapeHTML(pureXss)}"`)
    && !staleHTML.includes("<input"));
  const invalidStepHTML = sandbox.twyNumericValueHTML({ ...pureTrack, valueStep: 0 }, 10,
    { invalid: false, diffRaw: 1, diffNorm: 1 }, { state: "ahead" }, "");
  const invalidValueHTML = sandbox.twyNumericValueHTML(pureTrack, Number("legacy"),
    { invalid: true }, { state: "ontrack" }, "");
  const roundedPositiveZeroHTML = sandbox.twyNumericValueHTML(pureTrack, 10.2,
    { invalid: false, diffRaw: .2, diffNorm: .2 }, { state: "ontrack" }, "");
  const roundedNegativeZeroHTML = sandbox.twyNumericValueHTML(pureTrack, 9.8,
    { invalid: false, diffRaw: -.2, diffNorm: -.2 }, { state: "ontrack" }, "");
  check("valueStep不正時はペース欄を表示しない", !invalidStepHTML.includes("twy-pace"));
  check("非数値measurementはNaN値欄を表示しない", !invalidValueHTML.includes("NaN")
    && !invalidValueHTML.includes("twy-val"));
  check("丸め結果0はraw符号にかかわらず符号なし", !roundedPositiveZeroHTML.includes("+0")
    && !roundedNegativeZeroHTML.includes("-0")
    && roundedPositiveZeroHTML.includes(">0章</span>") && roundedNegativeZeroHTML.includes(">0章</span>"));

  console.log("[2] B-6 19バリエーション・境界・XSS・既存WBS回帰");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1024, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);
  const TODAY = "2026-08-24", CYCLE = "2026-08-15", OLD_CYCLE = "2026-05-23";
  const project = (id, extra = {}) => ({ id, kind: "normal", title: id, status: "active", priority: "中",
    category: "", startDate: CYCLE, dueDate: "", description: "", twelveWeekStartDate: CYCLE,
    showProgress: false, collapsed: false, createdAt: `${CYCLE}T00:00:00`, updatedAt: `${CYCLE}T00:00:00`,
    deleted: false, ...extra });
  const task = (id, projectId, extra = {}) => ({ id, projectId, parentTaskId: "", title: id, category: "",
    status: "todo", dueDate: "", description: "", progressNum: 0, progressDen: 10,
    createdAt: `${CYCLE}T00:00:00`, updatedAt: `${CYCLE}T00:00:00`, deleted: false, ...extra });
  const numeric = (id, ownerId, extra = {}) => ({ id, ownerType: "project", ownerId, cycleStartDate: CYCLE,
    kind: "numeric", name: id, unit: "u", startDate: "2026-08-14", deadline: "2026-09-03",
    baselineValue: 0, goalValue: 20, valueStep: 1, milestones: [], status: "active", closedAt: "",
    closedReason: "", supersedesTrackId: "", carriedFromTrackId: "", createdAt: `${CYCLE}T00:00:00`,
    updatedAt: `${CYCLE}T00:00:00`, deleted: false, ...extra });
  const milestone = (id, label, plannedDate, doneAt = "", extra = {}) => ({ id, label, plannedDate,
    originalPlannedDate: plannedDate, doneAt, doneChangedAt: doneAt ? `${doneAt}T12:00:00` : "",
    updatedAt: `${CYCLE}T00:00:00`, deleted: false, ...extra });
  const milestoneTrack = (id, ownerId, milestones, extra = {}) => numeric(id, ownerId, { kind: "milestone",
    unit: "", deadline: "", baselineValue: 0, goalValue: 0, valueStep: 1, milestones, ...extra });
  const measurement = (trackId, value, observedDate, id = `m-${trackId}`) => ({ id, trackId, value,
    observedAt: `${observedDate}T10:00:00`, updatedAt: `${observedDate}T10:00:00`, deleted: false });
  async function seed({ projects = [], tasks = [], tracks = [], measurements = [], settingCycle = CYCLE } = {}) {
    await page.evaluate(({ key, today, projects, tasks, tracks, measurements, settingCycle }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "wbs";
      state.selectedDate = today;
      state.settings.twelveWeekStartDate = settingCycle;
      state.settings.showSuspended = true;
      state.settings.wbsHideCompleted = false;
      state.projects = projects;
      state.tasks = tasks;
      state.tracks = tracks;
      state.trackMeasurements = measurements;
      state.blocks = [];
      state.recurrences = [];
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY, projects, tasks, tracks, measurements, settingCycle });
    await page.reload();
    await page.waitForSelector("main");
  }
  const row = (trackId) => page.locator(`.twy-row[data-twy-track-id="${trackId}"]`);
  const projectCard = (projectId) => page.locator(`.item:has(strong[data-id="${projectId}"])`);

  try {
    await page.clock.setFixedTime(new Date(2026, 7, 24, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    const projects = [], tracks = [], measurements = [], tasks = [];
    const addNumeric = (number, id, value, trackExtra = {}, observed = TODAY) => {
      projects.push(project(`p${number}`));
      tracks.push(numeric(id, `p${number}`, trackExtra));
      if (value !== null) measurements.push(measurement(id, value, observed));
    };
    addNumeric(1, "n-ahead", 15);
    addNumeric(2, "n-ontrack", 10);
    addNumeric(3, "n-warn", 5);
    addNumeric(4, "n-overdue", 50, { startDate: "2026-08-01", deadline: "2026-08-23", goalValue: 100 });
    addNumeric(5, "n-stale", 10, {}, "2026-08-16");
    addNumeric(6, "n-done", 20, {}, "2026-08-20");
    addNumeric(7, "n-invalid", null, { deadline: "2026-08-14", goalValue: 0 });

    projects.push(project("p8"), project("p9"), project("p10"), project("p11"), project("p12"));
    tracks.push(
      milestoneTrack("ms-ahead", "p8", [milestone("a1", "先行済", "2026-08-30", "2026-08-20"), milestone("a2", "提出", "2026-09-05")]),
      milestoneTrack("ms-ontrack", "p9", [milestone("o1", "完了済", "2026-08-20", "2026-08-20"),
        milestone("o2", "ドラフト", "2026-08-30", "", { originalPlannedDate: "2026-08-28" }), milestone("o3", "提出", "2026-09-05")]),
      milestoneTrack("ms-warn", "p10", [milestone("w1", "中間", "2026-08-23"), milestone("w2", "提出", "2026-09-05")]),
      milestoneTrack("ms-overdue", "p11", [milestone("d1", "公開", "2026-08-23")]),
      milestoneTrack("ms-done", "p12", [milestone("z2", "提出", "2026-08-20", "2026-08-19"),
        milestone("z1", "構成", "2026-08-10", "2026-08-21"),
        milestone("z-deleted", "削除済", "2026-08-30", "2026-08-22", { deleted: true })])
    );
    projects.push(project("p13"), project("p14", { twelveWeekStartDate: OLD_CYCLE }),
      project("p15", { twelveWeekStartDate: OLD_CYCLE }), project("p16", { twelveWeekStartDate: "" }), project("p17"));
    tracks.push(numeric("n-old", "p15"), numeric("n-closed", "p17", { status: "closed", closedReason: "manual" }));
    measurements.push(measurement("n-old", 10, TODAY));
    projects.push(project("p18", { showProgress: true }));
    tasks.push(task("t18-root", "p18"), task("t18-child", "p18", { parentTaskId: "t18-root" }));
    for (const [id, extra] of [
      ["p19-past", { twelveWeekStartDate: OLD_CYCLE }], ["p19-non", { twelveWeekStartDate: "" }],
      ["p19-inactive", { status: "suspended" }], ["p19-future", { twelveWeekStartDate: "2026-11-07" }]
    ]) {
      projects.push(project(id, { showProgress: true, ...extra }));
      tasks.push(task(`t-${id}`, id));
    }
    projects.push(project("p17-deleted"));
    tracks.push(numeric("n-deleted", "p17-deleted", { deleted: true }));

    const addBoundaryNumeric = (owner, id, value, extra = {}, observed = TODAY) => {
      projects.push(project(owner)); tracks.push(numeric(id, owner, extra));
      measurements.push(measurement(id, value, observed));
    };
    addBoundaryNumeric("pb-stale7", "b-stale7", 10, {}, "2026-08-17");
    addBoundaryNumeric("pb-stale8", "b-stale8", 10, {}, "2026-08-16");
    const toleranceTrack = { startDate: "2026-08-17", deadline: "2026-08-31", goalValue: 14, valueStep: .1 };
    addBoundaryNumeric("pb-tol-plus", "b-tol-plus", 10.5, toleranceTrack);
    addBoundaryNumeric("pb-tol-over", "b-tol-over", 10.6, toleranceTrack);
    addBoundaryNumeric("pb-tol-minus", "b-tol-minus", 3.5, toleranceTrack);
    addBoundaryNumeric("pb-tol-under", "b-tol-under", 3.4, toleranceTrack);
    addBoundaryNumeric("pb-dec-ahead", "b-dec-ahead", 5, { baselineValue: 20, goalValue: 0 });
    addBoundaryNumeric("pb-dec-warn", "b-dec-warn", 15, { baselineValue: 20, goalValue: 0 });
    addBoundaryNumeric("pb-num-today", "b-num-today", 50, { startDate: "2026-08-01", deadline: TODAY, goalValue: 100 });
    addBoundaryNumeric("pb-num-yesterday", "b-num-yesterday", 50, { startDate: "2026-08-01", deadline: "2026-08-23", goalValue: 100 });
    projects.push(project("pb-ms-today"), project("pb-ms-yesterday"), project("pb-ms-midlate"));
    tracks.push(
      milestoneTrack("b-ms-today", "pb-ms-today", [milestone("bt", "当日", TODAY)]),
      milestoneTrack("b-ms-yesterday", "pb-ms-yesterday", [milestone("by", "前日", "2026-08-23")]),
      milestoneTrack("b-ms-midlate", "pb-ms-midlate", [milestone("bm1", "中間", "2026-08-23"), milestone("bm2", "最終", "2026-09-05")])
    );

    const xss = '\"><img src=x onerror="window.__v260Xss=true"><input data-v260-breached="';
    projects.push(project("pxss-num"), project("pxss-ms"), project("pxss-old", { title: xss, twelveWeekStartDate: OLD_CYCLE }));
    tracks.push(numeric(xss, "pxss-num", { unit: xss }), milestoneTrack("xss-ms", "pxss-ms", [milestone("xm", xss, "2026-09-01")]));
    measurements.push(measurement(xss, 10, TODAY, "mxss"));

    await seed({ projects, tasks, tracks, measurements });

    const stateCheck = async (trackId, label, cls) => {
      const chip = row(trackId).locator(".t-state");
      return await chip.textContent() === label && await chip.evaluate((el, expected) => el.classList.contains(expected), cls);
    };
    check("B-6 #1 numeric先行", await stateCheck("n-ahead", "先行", "s-ahead")
      && (await row("n-ahead").locator(".twy-pace").textContent()).includes("+5u")
      && await row("n-ahead").locator(".twy-bar").evaluate((el) => el.classList.contains("s-ahead"))
      && await row("n-ahead").locator(".twy-bar > span").getAttribute("style") === "width:75%"
      && await row("n-ahead").locator(".twy-bar > i").getAttribute("style") === "left:50%");
    check("B-6 #2 numeric順調", await stateCheck("n-ontrack", "順調", "s-ontrack"));
    check("B-6 #3 numeric要注意", await stateCheck("n-warn", "要注意", "s-warn")
      && (await row("n-warn").locator(".twy-pace").textContent()).includes("-5u"));
    check("B-6 #4 numeric期限超過", await stateCheck("n-overdue", "期限超過", "s-overdue"));
    check("B-6 #5 numeric未更新", await stateCheck("n-stale", "未更新", "s-stale")
      && (await row("n-stale").textContent()).includes("ペース不明") && (await row("n-stale").textContent()).includes("8日前")
      && await row("n-stale").locator(".twy-val").evaluate((el) => Number(getComputedStyle(el).opacity) < 1));
    check("B-6 #6 numeric完了", await stateCheck("n-done", "完了", "s-done")
      && await row("n-done").locator(".twy-correct").textContent() === "訂正"
      && (await row("n-done").textContent()).includes("8/20 達成")
      && await row("n-done").locator(".twy-meta").textContent() === "期限 9/3"
      && await row("n-done").locator(".twy-bar > i").count() === 0);
    check("B-6 #7 numeric invalid", await stateCheck("n-invalid", "順調", "s-ontrack")
      && await row("n-invalid").locator(".twy-pace").count() === 0 && await row("n-invalid").locator(".twy-bar > i").count() === 0);
    check("B-6 #8 milestone先行", await stateCheck("ms-ahead", "先行", "s-ahead"));
    const msOntrack = {
      state: await stateCheck("ms-ontrack", "順調", "s-ontrack"),
      next: await row("ms-ontrack").locator(".twy-ms-node.next").count(),
      oldDate: await row("ms-ontrack").locator(".twy-ms-date del").textContent(),
      text: await row("ms-ontrack").textContent()
    };
    check("B-6 #9 milestone順調", msOntrack.state && msOntrack.next === 1 && msOntrack.oldDate === "8/28"
      && msOntrack.text.includes("8/30 予定変更済"), JSON.stringify(msOntrack));
    check("B-6 #10 milestone要注意", await stateCheck("ms-warn", "要注意", "s-warn"));
    check("B-6 #11 milestone期限超過", await stateCheck("ms-overdue", "期限超過", "s-overdue")
      && await row("ms-overdue").locator(".twy-ms-node.late").count() === 1);
    check("B-6 #12 milestone完了", await stateCheck("ms-done", "完了", "s-done")
      && await row("ms-done").locator(".twy-correct").textContent() === "訂正"
      && (await row("ms-done").textContent()).includes("8/21 達成")
      && !(await row("ms-done").textContent()).includes("8/22"));
    check("B-6 #13 track無し現サイクル", await projectCard("p13").locator(".twy-row,.twy-stale-note").count() === 0);
    check("B-6 #14 track無し前サイクル", await projectCard("p14").locator(".twy-stale-note").count() === 1
      && await projectCard("p14").locator(".twy-row").count() === 0);
    check("B-6 #15 trackあり前サイクルは注記+行", await projectCard("p15").locator(".twy-stale-note").count() === 1
      && await projectCard("p15").locator('.twy-row[data-twy-track-id="n-old"]').count() === 1);
    check("B-6 #16 非12WY", await projectCard("p16").locator(".twy-row,.twy-stale-note").count() === 0);
    check("B-6 #17 closed track", await projectCard("p17").locator(".twy-row,.twy-stale-note").count() === 0);
    check("B-6 #18 現サイクルactive 12WYの第三の進捗非表示", await projectCard("p18").locator(".wbs-progress-row").count() === 0
      && await projectCard("p18").locator(".wbs-progress-agg").count() === 0
      && (await projectCard("p18").locator(".wbs-project-meta").textContent()).includes("[12WY]"));
    check("B-6 #19 対象外Task/Project進捗は維持", (await Promise.all(["p19-past", "p19-non", "p19-inactive", "p19-future"].map(async (id) =>
      await projectCard(id).locator(".wbs-task-meta").count() === 1 && await projectCard(id).locator(".wbs-progress-agg").count() === 1))).every(Boolean));

    check("STALE_DAYS 7/8日境界", await stateCheck("b-stale7", "順調", "s-ontrack")
      && await stateCheck("b-stale8", "未更新", "s-stale"));
    check("numeric tolerance +ちょうど/超", await stateCheck("b-tol-plus", "順調", "s-ontrack")
      && await stateCheck("b-tol-over", "先行", "s-ahead"));
    check("numeric tolerance -ちょうど/未満", await stateCheck("b-tol-minus", "順調", "s-ontrack")
      && await stateCheck("b-tol-under", "要注意", "s-warn"));
    check("減少目標・先行はraw負値のままpos(緑)", await stateCheck("b-dec-ahead", "先行", "s-ahead")
      && await row("b-dec-ahead").locator(".twy-pace.pos").count() === 1
      && await row("b-dec-ahead").locator(".twy-pace.neg").count() === 0
      && (await row("b-dec-ahead").locator(".twy-pace").textContent()).includes("-5u"));
    check("減少目標・遅れはraw正値のままneg(橙)", await stateCheck("b-dec-warn", "要注意", "s-warn")
      && await row("b-dec-warn").locator(".twy-pace.neg").count() === 1
      && await row("b-dec-warn").locator(".twy-pace.pos").count() === 0
      && (await row("b-dec-warn").locator(".twy-pace").textContent()).includes("+5u"));
    check("milestone diffNorm 0/+1/-1境界", await stateCheck("ms-ontrack", "順調", "s-ontrack")
      && await stateCheck("ms-ahead", "先行", "s-ahead") && await stateCheck("ms-warn", "要注意", "s-warn"));
    check("numeric期限 当日/翌日境界", (await row("b-num-today").locator(".t-state").textContent()) !== "期限超過"
      && await stateCheck("b-num-yesterday", "期限超過", "s-overdue"));
    check("milestone期限 当日/翌日境界", (await row("b-ms-today").locator(".t-state").textContent()) !== "期限超過"
      && await stateCheck("b-ms-yesterday", "期限超過", "s-overdue"));
    check("milestoneノードlate 当日/前日・全体期限と独立", await row("b-ms-today").locator(".twy-ms-node.late").count() === 0
      && await row("b-ms-midlate").locator(".twy-ms-node.late").count() === 1
      && await row("b-ms-midlate").locator(".t-state.s-warn").textContent() === "要注意");
    check("deleted trackはtrack無し扱い", await projectCard("p17-deleted").locator(".twy-row,.twy-stale-note").count() === 0);
    const xssResult = await page.evaluate((payload) => ({
      breached: document.querySelectorAll("[data-v260-breached]").length,
      executed: window.__v260Xss === true,
      trackId: [...document.querySelectorAll("[data-twy-track-id]")].some((el) => el.dataset.twyTrackId === payload),
      text: document.querySelector("main").textContent
    }), xss);
    check("unit/track.id/milestone.labelをescapeHTML", xssResult.breached === 0 && !xssResult.executed
      && xssResult.trackId && xssResult.text.includes(xss), JSON.stringify(xssResult));

    for (const theme of ["light", "dark", "cockpit"]) {
      const colors = await page.evaluate((themeName) => {
        document.documentElement.dataset.theme = themeName;
        return [...document.querySelectorAll(".t-state")].slice(0, 6).map((el) => getComputedStyle(el).color);
      }, theme);
      check(`${theme}テーマで状態色が解決される`, colors.length === 6 && colors.every((color) => color && color !== "rgba(0, 0, 0, 0)"));
    }
    for (const width of [390, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      check(`${width}pxでWBS全体に横スクロールなし`, noOverflow);
    }
    check("今日の理想ラベルを行端でクリップしない", await row("n-ahead").evaluate((el) => getComputedStyle(el).overflow === "visible"));

    await seed({ projects: [], tasks: [], tracks: [], measurements: [] });
    check("空stateでもrenderWBSが例外を投げず空表示", await page.locator("main").count() === 1
      && await page.locator(".twy-row,.twy-stale-note").count() === 0);
    await seed({ projects: [project("p-unset", { twelveWeekStartDate: OLD_CYCLE, showProgress: true })],
      tasks: [task("t-unset", "p-unset")], settingCycle: "" });
    check("12WY未設定では前サイクル注記を出さない", await projectCard("p-unset").locator(".twy-stale-note").count() === 0
      && await projectCard("p-unset").locator(".wbs-task-meta,.wbs-progress-agg").count() === 2);

    console.log("[3] E2E条件1: フォーム登録→WBS状態表示");
    async function openProjectEditor(projectId) {
      await page.locator(`[data-wbs-row-id="${projectId}"] > .wbs-project-head > .wbs-row-menu-toggle`).click();
      await page.locator(`[data-action="edit-project"][data-id="${projectId}"]`).click();
      await page.waitForSelector("[data-twy-track]", { state: "attached" });
    }
    await seed({ projects: [project("p-form-numeric")], tasks: [task("t-form-num", "p-form-numeric")] });
    await openProjectEditor("p-form-numeric");
    await page.locator('[data-action="twy-kind-numeric"]').click();
    await page.locator('[data-modal-field="twyName"]').fill("読書");
    await page.locator('[data-modal-field="twyStartDate"]').fill(TODAY);
    await page.locator('[data-modal-field="twyBaseline"]').fill("0");
    await page.locator('[data-modal-field="twyGoal"]').fill("20");
    await page.locator('[data-modal-field="twyUnit"]').fill("章");
    await page.locator('[data-modal-field="twyDeadline"]').fill("2026-09-13");
    await page.locator('[data-modal-field="twyStep"]').fill("1");
    await page.locator('[data-action="modal-save"]').click();
    let saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    let active = saved.tracks.find((item) => item.ownerId === "p-form-numeric" && item.status === "active");
    check("numericをフォーム保存するとWBS行へ状態表示", active?.kind === "numeric"
      && await row(active.id).locator(".t-state").count() === 1 && (await row(active.id).locator(".t-state").textContent()).length > 0);

    await seed({ projects: [project("p-form-ms")], tasks: [task("t-form-ms", "p-form-ms")] });
    await openProjectEditor("p-form-ms");
    await page.locator('[data-action="twy-kind-milestone"]').click();
    for (const [label, date] of [["初稿", "2026-08-30"], ["提出", "2026-09-10"]]) {
      await page.locator('[data-action="twy-ms-add"]').click();
      const editRow = page.locator(".twy-ms-edit-row").last();
      await editRow.locator("[data-twy-ms-label]").fill(label);
      await editRow.locator("[data-twy-ms-date]").fill(date);
    }
    await page.locator('[data-action="modal-save"]').click();
    saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    active = saved.tracks.find((item) => item.ownerId === "p-form-ms" && item.status === "active");
    check("milestoneをフォーム保存するとWBS行へ状態+ノード表示", active?.kind === "milestone"
      && await row(active.id).locator(".t-state").count() === 1 && await row(active.id).locator(".twy-ms-node").count() === 2);
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nv260: 全件成功" : `\nv260: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
