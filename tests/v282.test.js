// v282: 12WY milestoneの件数・進捗率・目標値進捗を、完了判定と独立して入力・表示する。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { isDeepStrictEqual } = require("util");
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
function noop() {}
function configureSync(syncMod) {
  syncMod.configureGithubSync({
    normalizeState: (value) => value, nowDateTime: () => "2026-08-27T12:00:00",
    todayISO: () => "2026-08-27", addDays: (date) => date, isTouchedBlock: () => false,
    RECURRENCE_KEEP_PAST_DAYS: 7, RECURRENCE_FUTURE_DAYS: 31, SWIPE_TRIAGE_LOG_MAX: 200,
    showToast: noop, maintainRecurrences: noop, render: noop, runDailyOpen: () => false, saveState: noop,
    requireGitHubConfig: noop, fetchGitHubFileSHA: noop, personalDataReady: () => true, personalDataFileConfig: noop,
    gitHubContentsURL: noop, githubHeaders: noop, gitHubErrorMessage: noop, fromBase64: noop, toBase64: noop,
    sanitizedStateForGitHub: noop, maybeWriteBackupSnapshot: noop, updateAutoSaveStatus: noop, updateSyncDot: noop,
    renderSyncBanner: noop, pruneExpiredSuggestedThemes: (value) => value, _startupDataModifiedAt: ""
  });
}
function syncState(extra = {}) {
  return {
    journalMeta: {}, settings: { journalTemplate: "", morningEnergyLog: {}, github: {} },
    journals: {}, feedback: {}, condition: { logs: {} }, sleep: { logs: {} },
    blocks: [], zeroThinking: { entries: [], suggestedThemes: [] }, dailyDeclarations: {}, weeklyWishes: {},
    bodyScans: [], tasks: [], projects: [], storeVisits: [], tracks: [], trackMeasurements: [],
    weeklyCommitments: [], swipeTriageLog: [], gardenLog: {}, coachLog: { settings: {}, meals: [] },
    aiStepProcessedIds: [], aiStepDismissedIds: [], aiStepPendingRequests: [], recurrences: [],
    declarations: [], questions: [], experiments: [], earlyBird: { logs: {} }, ...extra
  };
}

(async () => {
  const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const trackCore = await import(pathToFileURL(path.join(ROOT, "src", "core", "track.js")).href);
  const mergeCore = await import(pathToFileURL(path.join(ROOT, "src", "core", "merge.js")).href);
  const storeMod = await import(pathToFileURL(path.join(ROOT, "src", "state", "store.js")).href);
  const syncMod = await import(pathToFileURL(path.join(ROOT, "src", "sync", "github.js")).href);
  configureSync(syncMod);

  console.log("[1] progress型ガードとratio全分岐");
  const count = { type: "count", current: 3, target: 10, start: null, unit: "章" };
  const percent = { type: "percent", current: 30, target: null, start: null, unit: "" };
  const value = { type: "value", current: 45, target: 80, start: null, unit: "kg" };
  const decreasing = { type: "value", current: 65, target: 60, start: 70, unit: "kg" };
  check("count/percent/valueを換算", trackCore.milestoneProgressRatio(count) === .3
    && trackCore.milestoneProgressRatio(percent) === .3
    && trackCore.milestoneProgressRatio(value) === 45 / 80);
  check("開始値つき増加・減少方向", trackCore.milestoneProgressRatio(
    { type: "value", current: 15, target: 20, start: 10, unit: "点" }) === .5
    && trackCore.milestoneProgressRatio(decreasing) === .5);
  check("0除算・start===targetはnull", trackCore.milestoneProgressRatio(
    { type: "count", current: 1, target: 0, start: null, unit: "章" }) === null
    && trackCore.milestoneProgressRatio(
      { type: "value", current: 10, target: 10, start: 10, unit: "kg" }) === null);
  check("範囲外は0〜1へclamp", trackCore.milestoneProgressRatio(
    { type: "count", current: -2, target: 10, start: null, unit: "章" }) === 0
    && trackCore.milestoneProgressRatio(
      { type: "count", current: 20, target: 10, start: null, unit: "章" }) === 1
    && trackCore.milestoneProgressRatio(
      { type: "count", current: 0, target: 10, start: null, unit: "章" }) === 0
    && trackCore.milestoneProgressRatio(
      { type: "count", current: 10, target: 10, start: null, unit: "章" }) === 1);
  check("減少方向はstart・非中間値・target・超過を正しく換算", trackCore.milestoneProgressRatio(
    { type: "value", current: 70, target: 60, start: 70, unit: "kg" }) === 0
    && trackCore.milestoneProgressRatio(
      { type: "value", current: 68, target: 60, start: 70, unit: "kg" }) === .2
    && trackCore.milestoneProgressRatio(
      { type: "value", current: 60, target: 60, start: 70, unit: "kg" }) === 1
    && trackCore.milestoneProgressRatio(
      { type: "value", current: 55, target: 60, start: 70, unit: "kg" }) === 1);
  check("非数・文字列・壊れた型はnull/undefined", trackCore.milestoneProgressRatio(
    { type: "count", current: "3", target: 10, start: null, unit: "章" }) === null
    && trackCore.normalizeMilestoneProgress({ type: "other", current: 1, target: 2, start: null, unit: "" }) === undefined
    && trackCore.normalizeMilestoneProgress({ type: "percent", current: 30, target: 100, start: null, unit: "" }) === undefined
    && trackCore.normalizeMilestoneProgress({ type: "percent", current: 101, target: null, start: null, unit: "" }) === undefined
    && trackCore.normalizeMilestoneProgress({ type: "percent", current: 30, target: null, start: 0, unit: "%" }) === undefined);
  const invalidProgresses = [
    { ...count, current: NaN }, { ...count, current: Infinity }, { ...count, target: NaN },
    { ...count, target: Infinity }, { ...count, start: NaN }, { ...count, start: Infinity },
    { ...percent, current: -1 }, { ...count, unit: 1 }
  ];
  check("NaN・Infinity・percent下限・unit型を各フィールドで拒否",
    invalidProgresses.every((entry) => trackCore.normalizeMilestoneProgress(entry) === undefined));
  check("巨大な有限値も例外なくclamp", trackCore.milestoneProgressRatio(
    { type: "value", current: 1e300, target: 1e200, start: null, unit: "点" }) === 1);
  const paceTrack = { kind: "milestone", milestones: [{ id: "m", plannedDate: "2026-09-01", doneAt: "", deleted: false }] };
  const paceBefore = trackCore.paceMilestone(paceTrack, "2026-08-27");
  const paceAfter = trackCore.paceMilestone({ ...paceTrack, milestones: [{ ...paceTrack.milestones[0], progress: count }] }, "2026-08-27");
  check("progressはpaceMilestoneへ混入しない", JSON.stringify(paceBefore) === JSON.stringify(paceAfter));

  console.log("[2] 更新・クリア・同期・Project再保存の保持契約");
  const updateSource = sourceBetween(appSource, "function updateTrackMilestone(", "// v39: 開いている問い");
  const dataSandbox = {
    Object, Array, state: {}, normalizeMilestoneProgress: trackCore.normalizeMilestoneProgress,
    dateParts: trackCore.dateParts, now: "2026-08-27T12:00:00", nowDateTime: () => dataSandbox.now, saveCalls: 0,
    saveState: () => { dataSandbox.saveCalls += 1; }
  };
  vm.createContext(dataSandbox);
  vm.runInContext(updateSource, dataSandbox);
  require('./support/app-connection-transform.cjs').installTwelveWeekVm(dataSandbox);
  const baseMs = { id: "m1", label: "本文", plannedDate: "2026-09-01", originalPlannedDate: "2026-09-01",
    doneAt: "", doneChangedAt: "", updatedAt: "2026-08-01T00:00:00", deleted: false };
  dataSandbox.state = { tracks: [{ id: "t1", kind: "milestone", status: "active", deleted: false,
    updatedAt: "2026-08-01T00:00:00", milestones: [baseMs] }] };
  let result = dataSandbox.updateTrackMilestone("t1", "m1", { progress: count });
  let saved = dataSandbox.state.tracks[0].milestones[0];
  check("progress保存で節目・親updatedAtが進みdoneAtは不変", result.ok && saved.progress.current === 3
    && saved.updatedAt === "2026-08-27T12:00:00" && dataSandbox.state.tracks[0].updatedAt === saved.updatedAt
    && saved.doneAt === "" && dataSandbox.saveCalls === 1);
  const beforeInvalid = JSON.stringify(dataSandbox.state);
  result = dataSandbox.updateTrackMilestone("t1", "m1", { progress: { ...count, current: "bad" } });
  check("不正progressは保存せずstate不変", !result.ok && JSON.stringify(dataSandbox.state) === beforeInvalid
    && dataSandbox.saveCalls === 1);
  dataSandbox.now = "2026-08-27T13:00:00";
  result = dataSandbox.updateTrackMilestone("t1", "m1", { progress: undefined });
  saved = dataSandbox.state.tracks[0].milestones[0];
  check("クリアはprogressキーを除去して節目・親updatedAtを進める", result.ok
    && !Object.prototype.hasOwnProperty.call(saved, "progress") && saved.updatedAt === dataSandbox.now
    && dataSandbox.state.tracks[0].updatedAt === dataSandbox.now && dataSandbox.saveCalls === 2);
  const staleRemoteTrack = { id: "t1", updatedAt: "2026-08-27T12:00:00", milestones: [{ ...baseMs,
    updatedAt: "2026-08-27T12:00:00", progress: count }] };
  const clearedMerge = mergeCore.mergeTracksPreferNewer(dataSandbox.state.tracks, [staleRemoteTrack], "remote")[0];
  check("クリア済みlocalへ古いremote progressが復活しない",
    !Object.prototype.hasOwnProperty.call(clearedMerge.milestones[0], "progress"));

  const mergeSource = sourceBetween(appSource, "function mergeEditedMilestones(", "function saveTrackFromForm(");
  const formSandbox = { Map, Set, Object };
  vm.createContext(formSandbox); vm.runInContext(mergeSource, formSandbox);
  const formProgress = { ...count };
  const existingForForm = [{ ...baseMs, progress: formProgress }];
  const fieldsWithoutProgress = [{ id: "m1", label: "本文", plannedDate: "2026-09-01" }];
  const incomingWithoutProgress = [{ ...baseMs }];
  const formMerged = formSandbox.mergeEditedMilestones(
    existingForForm, fieldsWithoutProgress, incomingWithoutProgress, "2026-08-27T14:00:00"
  )[0];
  check("Projectフォーム再保存の実動作でprogressとmilestone.updatedAtを保持",
    isDeepStrictEqual(formMerged.progress, formProgress) && formMerged.updatedAt === baseMs.updatedAt);

  const localProgress = { type: "count", current: 2, target: 10, start: null, unit: "章" };
  const remoteProgress = { type: "count", current: 7, target: 10, start: null, unit: "章" };
  const localTrack = { id: "t-sync", name: "local-parent", updatedAt: "2026-08-27T15:00:00", deleted: false,
    milestones: [{ ...baseMs, id: "m-sync", updatedAt: "2026-08-27T10:00:00", progress: localProgress }] };
  const remoteTrack = { id: "t-sync", name: "remote-parent", updatedAt: "2026-08-27T14:00:00", deleted: false,
    milestones: [{ ...baseMs, id: "m-sync", updatedAt: "2026-08-27T16:00:00", progress: remoteProgress }] };
  const localSyncState = syncState({ tracks: [localTrack] });
  const remoteSyncState = syncState({ tracks: [remoteTrack] });
  storeMod.setState(JSON.parse(JSON.stringify(localSyncState)));
  const pushRemote = JSON.parse(JSON.stringify(remoteSyncState));
  const pushMerge = syncMod.computeSyncMerge(pushRemote, "local");
  syncMod.applySyncMergeToRemote(pushMerge, pushRemote);
  const pushed = pushRemote.tracks[0];
  storeMod.setState(JSON.parse(JSON.stringify(localSyncState)));
  const pullMerge = syncMod.computeSyncMerge(JSON.parse(JSON.stringify(remoteSyncState)), "remote");
  syncMod.applySyncMergeToLocal(pullMerge);
  const pulled = storeMod.state.tracks[0];
  check("computeSyncMergeのpush/pull両方向で親local新・節目progress remote新を統合",
    pushed.name === "local-parent" && pulled.name === "local-parent"
    && pushed.milestones[0].progress.current === 7 && pulled.milestones[0].progress.current === 7);
  check("同期結果はprogress normalize後も保持", isDeepStrictEqual(
    trackCore.normalizeMilestoneProgress(pushed.milestones[0].progress), remoteProgress)
    && isDeepStrictEqual(trackCore.normalizeMilestoneProgress(pulled.milestones[0].progress), remoteProgress));

  console.log("[3] 表示HTML・エスケープ・iOS入力属性");
  const renderSource = sourceBetween(appSource, "function twyMilestoneProgressHTML(", "function renderTwyTrackRow(");
  const escapeHTML = (input) => String(input).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const renderSandbox = { normalizeMilestoneProgress: trackCore.normalizeMilestoneProgress,
    milestoneProgressRatio: trackCore.milestoneProgressRatio, escapeHTML, state: { trackMeasurements: [] },
    _twyOpenEditorIds: new Set(), latestMeasurement: trackCore.latestMeasurement };
  vm.createContext(renderSandbox);
  vm.runInContext(renderSource, renderSandbox);
  const displayCases = [
    [count, "3/10章"], [percent, "30%"], [value, "45/80kg"], [decreasing, "70→65/60kg"]
  ];
  for (const [progress, text] of displayCases) {
    const html = renderSandbox.twyMilestoneProgressHTML(progress, "本文");
    check(`${text}とミニバーを表示`, html.includes(text) && html.includes('role="progressbar"'));
  }
  const barCases = [
    [count, "width:30%", 'aria-valuenow="30"'],
    [value, "width:56.3%", 'aria-valuenow="56.3"'],
    [{ ...count, current: -1 }, "width:0%", 'aria-valuenow="0"'],
    [{ ...count, current: 20 }, "width:100%", 'aria-valuenow="100"']
  ];
  check("ミニバーの幅・ARIA値はcount/value/clampの具体値に一致", barCases.every(([progress, width, aria]) => {
    const html = renderSandbox.twyMilestoneProgressHTML(progress, "本文");
    return html.includes(width) && html.includes(aria) && html.includes('aria-label="本文の進捗"');
  }));
  check("ratio不能時はテキストだけ表示", renderSandbox.twyMilestoneProgressHTML(
    { type: "count", current: 3, target: 0, start: null, unit: "章" }).includes("3/0章")
    && !renderSandbox.twyMilestoneProgressHTML(
      { type: "count", current: 3, target: 0, start: null, unit: "章" }).includes('role="progressbar"'));
  const xssHTML = renderSandbox.twyMilestoneProgressHTML(
    { ...count, unit: '<img data-v282-breached="1">' }, '"><img data-v282-label-breached="1">'
  );
  check("単位とaria-labelをHTMLエスケープ", !xssHTML.includes("<img")
    && xssHTML.includes("&lt;img") && xssHTML.includes("&quot;&gt;&lt;img"));
  const editorHTML = renderSandbox.twyMilestoneEditorHTML({ id: "t1", kind: "milestone",
    milestones: [{ ...baseMs, progress: decreasing }] });
  check("一覧にも進捗を表示し進捗フォームをdata-action化", editorHTML.includes("70→65/60kg")
    && editorHTML.includes('data-action="twy-ms-toggle-progress"')
    && editorHTML.includes('data-action="twy-ms-save-progress"')
    && editorHTML.includes('data-action="twy-ms-clear-progress"'));
  check("型select・数値input・既存date inputをネイティブ型で描画", editorHTML.includes("<select data-twy-progress-type>")
    && (editorHTML.match(/type="number"/g) || []).length === 3 && editorHTML.includes('type="date"'));

  console.log("[4] 実ブラウザ(裁定A-13): 節目progressの行内編集の入口が無く、読み取り表示だけが出る");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1024, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);
  const TODAY = "2026-08-27", CYCLE = "2026-08-15", INITIAL = "2026-08-15T00:00:00";
  const EDIT_ENTRANCES = ['[data-action="twy-open-editor"]', '[data-action="twy-ms-toggle-progress"]',
    '[data-action="twy-ms-save-progress"]', '[data-action="twy-ms-clear-progress"]', '[data-action="twy-ms-edit-date"]',
    '[data-action="twy-ms-toggle-done"]', "[data-twy-ms-progress-editor]", "[data-twy-progress-type]",
    "[data-twy-progress-current]", ".twy-editor", ".twy-ms-edit-item"].join(",");
  async function go(view) {
    await page.evaluate(({ key, view }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = view;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, view });
    await page.reload();
    await page.waitForSelector("main");
    if (view === "twelveweek") {
      await page.waitForSelector(".twy-cycle-fold", { state: "attached" });
      if (!await page.locator(".twy-cycle-fold").evaluate((el) => el.open)) await page.locator(".twy-cycle-fold > summary").click();
      await page.waitForSelector(".twy-goals-panel", { state: "visible" });
    } else {
      await page.waitForSelector('[data-work-group="p1"]');
    }
  }
  try {
    await page.clock.setFixedTime(new Date(2026, 7, 27, 12, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.evaluate(({ key, today, cycle, initial }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.selectedDate = today; state.settings.twelveWeekStartDate = cycle;
      state.settings.showSuspended = true; state.settings.wbsHideCompleted = false;
      state.projects = [{ id: "p1", kind: "normal", title: "執筆", status: "active", priority: "中",
        category: "", startDate: cycle, dueDate: "", description: "", twelveWeekStartDate: cycle,
        showProgress: false, collapsed: false, createdAt: initial, updatedAt: initial, deleted: false }];
      state.tasks = [{ id: "task-1", projectId: "p1", parentTaskId: "", title: "既存WBS操作", status: "todo",
        progressNum: 0, progressDen: 10, deleted: false }];
      state.blocks = []; state.recurrences = []; state.trackMeasurements = [];
      state.tracks = [{ id: "t1", ownerType: "project", ownerId: "p1", cycleStartDate: cycle,
        kind: "milestone", name: "本文", unit: "", startDate: cycle, deadline: "", baselineValue: 0,
        goalValue: 0, valueStep: 1, status: "active", closedAt: "", closedReason: "",
        supersedesTrackId: "", carriedFromTrackId: "", createdAt: initial, updatedAt: initial, deleted: false,
        milestones: [{ id: "m1", label: "本文", plannedDate: "2026-09-10", originalPlannedDate: "2026-09-10",
          doneAt: "", doneChangedAt: "", updatedAt: initial, deleted: false,
          progress: { type: "count", current: 3, target: 10, start: null, unit: "章" } }] }];
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY, cycle: CYCLE, initial: INITIAL });
    await go("wbs");
    const before = await page.evaluate((key) => JSON.stringify(JSON.parse(localStorage.getItem(key)).tracks), STATE_KEY);
    check("A-13 作業一覧に節目progress・予定日・完了の編集入口が無い", await page.locator(EDIT_ENTRANCES).count() === 0);
    check("作業一覧のProject見出しに「12週計画 第N週」が出る",
      /12週計画 第[0-9]+週/.test(await page.locator('[data-work-group="p1"] > summary').textContent()));
    await go("twelveweek");
    check("A-13 12週計画タブに節目progress・予定日・完了の編集入口が無い", await page.locator(EDIT_ENTRANCES).count() === 0);
    const row = page.locator('.twy-goals-panel .twy-row[data-twy-track-id="t1"]');
    check("GOALSに節目トラックの行が読み取り表示される", await row.count() === 1);
    check("GOALSの行は読み取り専用(input/select/編集ボタンなし)",
      await row.locator("input, select, button").count() === 0);
    await page.setViewportSize({ width: 390, height: 844 });
    check("390pxでも外側横スクロールを作らない", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check("表示だけでは節目progressを含むトラックが変わらない",
      await page.evaluate((key) => JSON.stringify(JSON.parse(localStorage.getItem(key)).tracks), STATE_KEY) === before);
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures) { console.log(`\n❌ v282: ${failures}件失敗`); process.exit(1); }
  console.log("\n✅ v282: 全テスト成功");
})().catch((error) => { console.error(error); process.exit(1); });
