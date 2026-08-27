// v261: 12WY WBSインラインエディタの表示・測定/節目保存・日報quiet再生成を検証する。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
// 監督者裁定A: 成功1操作はデータ層1回 + generateReport quiet既存保存1回 + saveAndRender 1回。
const SUCCESS_SAVE_CALLS = 3;
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
function clone(value) { return JSON.parse(JSON.stringify(value)); }

(async () => {
  const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const trackCore = await import(pathToFileURL(path.join(ROOT, "src", "core", "track.js")).href);

  console.log("[1] データ層2関数: 成功・失敗不変・保存回数・同期時刻契約");
  const dataSource = sourceBetween(appSource,
    "function recordTrackMeasurement(trackId, value,", "// v39: 開いている問い");
  const committedSource = sourceBetween(appSource, "function twyEditorCommitted", "registerActions({");
  let uuidSeq = 0;
  const dataCalls = [];
  const dataSandbox = {
    Number, String, Boolean, Object,
    state: { tracks: [], trackMeasurements: [] }, saveCalls: 0, now: "2026-08-24T10:00:00",
    crypto: { randomUUID: () => `uuid-${++uuidSeq}` },
    nowDateTime: () => dataSandbox.now,
    dateParts: trackCore.dateParts,
    latestMeasurement: trackCore.latestMeasurement,
    localDateTimeToMs: (value) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
      return m ? new Date(...m.slice(1).map(Number).map((part, index) => index === 1 ? part - 1 : part)).getTime() : 0;
    },
    dateToLocalDateTime: (date) => {
      const pad = (value) => String(value).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    },
    saveState: () => { dataSandbox.saveCalls += 1; },
    todayISO: () => "2026-08-24",
    generateReport: (...args) => { dataSandbox.saveCalls += 1; dataCalls.push(["report", ...args]); },
    saveAndRender: (message) => { dataSandbox.saveCalls += 1; dataCalls.push(["save-render", message]); }
  };
  vm.createContext(dataSandbox);
  vm.runInContext(`${dataSource}\n${committedSource}`, dataSandbox);
  const numeric = (id, extra = {}) => ({ id, kind: "numeric", status: "active", deleted: false, ...extra });
  const milestone = (id, extra = {}) => ({ id, label: id, plannedDate: "2026-09-01",
    originalPlannedDate: "2026-09-01", doneAt: "", doneChangedAt: "old-done-change",
    updatedAt: "2026-08-01T00:00:00", deleted: false, ...extra });
  const milestoneTrack = (id, milestones, extra = {}) => ({ id, kind: "milestone", status: "active",
    updatedAt: "2026-08-01T00:00:00", deleted: false, milestones, ...extra });

  dataSandbox.state = { tracks: [numeric("n1")], trackMeasurements: [] };
  dataSandbox.saveCalls = 0;
  const recorded = dataSandbox.recordTrackMeasurement("n1", 0,
    { sourceKind: "toast", blockId: "block-1", note: "note" });
  check("measurement 0を空欄と取り違えず絶対値で追記", recorded.ok
    && dataSandbox.state.trackMeasurements.length === 1 && recorded.measurement.value === 0);
  check("observedAtはnowDateTime固定、opts3項目を保持", recorded.measurement.observedAt === dataSandbox.now
    && recorded.measurement.sourceKind === "toast" && recorded.measurement.blockId === "block-1"
    && recorded.measurement.note === "note");
  check("measurement成功時saveStateは1回", dataSandbox.saveCalls === 1);
  const sameSecond = dataSandbox.recordTrackMeasurement("n1", 2);
  check("同秒の2回目はobservedAtを1秒進めてlatestとして解決", sameSecond.measurement.observedAt === "2026-08-24T10:00:01"
    && sameSecond.measurement.createdAt === dataSandbox.now
    && trackCore.latestMeasurement(dataSandbox.state.trackMeasurements, "n1").id === sameSecond.measurement.id);
  dataSandbox.now = "2026-08-24T10:01:00";
  dataSandbox.recordTrackMeasurement("n1", -1.5);
  check("連続測定は上書きせず追記し、既定sourceKindはwbs", dataSandbox.state.trackMeasurements.length === 3
    && dataSandbox.state.trackMeasurements[2].value === -1.5
    && dataSandbox.state.trackMeasurements[2].sourceKind === "wbs"
    && dataSandbox.state.trackMeasurements[2].blockId === "" && dataSandbox.state.trackMeasurements[2].note === "");

  const recordCases = [
    ["track不在", "missing", 1], ["closed track", "closed", 1], ["deleted track", "deleted", 1],
    ["kind不一致", "wrong-kind", 1], ["非有限値", "n1", NaN]
  ];
  dataSandbox.state.tracks = [numeric("n1"), numeric("closed", { status: "closed" }),
    numeric("deleted", { deleted: true }), milestoneTrack("wrong-kind", [milestone("m-kind")])];
  for (const [name, id, value] of recordCases) {
    dataSandbox.state.trackMeasurements = [];
    dataSandbox.saveCalls = 0;
    const before = JSON.stringify(dataSandbox.state);
    const result = dataSandbox.recordTrackMeasurement(id, value);
    check(`${name}の測定はok:false・state不変・保存0回`, !result.ok
      && JSON.stringify(dataSandbox.state) === before && dataSandbox.saveCalls === 0);
  }

  dataSandbox.state = { tracks: [milestoneTrack("ms-track", [milestone("ms-1"), milestone("ms-2")])],
    trackMeasurements: [] };
  dataSandbox.now = "2026-08-24T11:00:00";
  dataSandbox.saveCalls = 0;
  const dateUpdated = dataSandbox.updateTrackMilestone("ms-track", "ms-1", { plannedDate: "2026-01-01" });
  let updatedTrack = dataSandbox.state.tracks[0], updatedMs = updatedTrack.milestones[0];
  check("carry制約を持ち込まずサイクル前のplannedDateも更新", dateUpdated.ok
    && updatedMs.plannedDate === "2026-01-01");
  check("plannedDate変更でoriginalPlannedDate・doneChangedAtは不変", updatedMs.originalPlannedDate === "2026-09-01"
    && updatedMs.doneChangedAt === "old-done-change");
  check("節目と親trackのupdatedAtを同じnowへ伝播", updatedMs.updatedAt === dataSandbox.now
    && updatedTrack.updatedAt === dataSandbox.now);
  check("節目更新成功時saveStateは1回", dataSandbox.saveCalls === 1);

  dataSandbox.now = "2026-08-24T11:01:00";
  dataSandbox.updateTrackMilestone("ms-track", "ms-1", { doneAt: "2026-08-24" });
  updatedMs = dataSandbox.state.tracks[0].milestones[0];
  check("done ONでdoneAt/doneChangedAtを更新しoriginalは不変", updatedMs.doneAt === "2026-08-24"
    && updatedMs.doneChangedAt === dataSandbox.now && updatedMs.originalPlannedDate === "2026-09-01");
  dataSandbox.now = "2026-08-24T11:02:00";
  dataSandbox.updateTrackMilestone("ms-track", "ms-1", { doneAt: "" });
  updatedMs = dataSandbox.state.tracks[0].milestones[0];
  check("done OFF往復でdoneAtを空へ戻しdoneChangedAtだけ進める", updatedMs.doneAt === ""
    && updatedMs.doneChangedAt === dataSandbox.now && updatedMs.originalPlannedDate === "2026-09-01");

  dataSandbox.state = { tracks: [milestoneTrack("ms-original", [milestone("ms-empty", {
    plannedDate: "2026-09-10", originalPlannedDate: "" })])], trackMeasurements: [] };
  dataSandbox.updateTrackMilestone("ms-original", "ms-empty", { plannedDate: "2026-09-20" });
  check("空のoriginalPlannedDateは変更前plannedDateで1回だけ補完",
    dataSandbox.state.tracks[0].milestones[0].originalPlannedDate === "2026-09-10");

  const updateBase = [
    milestoneTrack("ms-ok", [milestone("ms-live"), milestone("ms-deleted", { deleted: true })]),
    milestoneTrack("ms-closed", [milestone("ms-c")], { status: "closed" }),
    milestoneTrack("ms-deleted-track", [milestone("ms-d")], { deleted: true }), numeric("n-wrong")
  ];
  const updateCases = [
    ["track不在", "missing", "ms-live", { doneAt: "2026-08-24" }],
    ["closed track", "ms-closed", "ms-c", { doneAt: "2026-08-24" }],
    ["deleted track", "ms-deleted-track", "ms-d", { doneAt: "2026-08-24" }],
    ["kind不一致", "n-wrong", "ms-live", { doneAt: "2026-08-24" }],
    ["milestone不在", "ms-ok", "missing", { doneAt: "2026-08-24" }],
    ["deleted milestone", "ms-ok", "ms-deleted", { doneAt: "2026-08-24" }],
    ["不正plannedDate", "ms-ok", "ms-live", { plannedDate: "2026-02-30" }],
    ["許可外patchキー", "ms-ok", "ms-live", { label: "上書き禁止" }],
    ["不正doneAt形式", "ms-ok", "ms-live", { doneAt: "2026/08/24" }]
  ];
  for (const [name, trackId, milestoneId, patchValue] of updateCases) {
    dataSandbox.state = { tracks: clone(updateBase), trackMeasurements: [] };
    dataSandbox.saveCalls = 0;
    const before = JSON.stringify(dataSandbox.state);
    const result = dataSandbox.updateTrackMilestone(trackId, milestoneId, patchValue);
    check(`${name}の節目更新はok:false・state不変・保存0回`, !result.ok
      && JSON.stringify(dataSandbox.state) === before && dataSandbox.saveCalls === 0);
  }
  check("データ層2関数はrender/toastを持たない", !dataSource.includes("render(") && !dataSource.includes("showToast("));

  dataSandbox.state = { tracks: [numeric("n-overall")], trackMeasurements: [] };
  dataSandbox.saveCalls = 0; dataCalls.length = 0;
  dataSandbox.recordTrackMeasurement("n-overall", 3);
  dataSandbox.twyEditorCommitted("記録しました");
  check("1操作全体はデータ層+quiet日報+saveAndRenderで保存3回", dataSandbox.saveCalls === SUCCESS_SAVE_CALLS);
  check("quiet日報はtodayISO・quiet:trueで1回だけ呼ぶ", dataCalls.filter((call) => call[0] === "report").length === 1
    && dataCalls[0][1] === "2026-08-24" && dataCalls[0][2]?.quiet === true);

  console.log("[2] 全data-action経路と_twyOpenEditorIds遷移");
  const handlerSource = sourceBetween(appSource, '"twy-open-editor":', "  // v259: carry");
  const actionCalls = [];
  const actionSandbox = {
    Number, Set, handlers: null, _twyOpenEditorIds: new Set(), recordResult: { ok: true }, updateResult: { ok: true },
    render: () => actionCalls.push(["render"]), showToast: (message) => actionCalls.push(["toast", message]),
    recordTrackMeasurement: (...args) => { actionCalls.push(["record", ...args]); return actionSandbox.recordResult; },
    updateTrackMilestone: (...args) => { actionCalls.push(["update", ...args]); return actionSandbox.updateResult; },
    twyEditorCommitted: (message) => actionCalls.push(["commit", message]), todayISO: () => "2026-08-24"
  };
  vm.createContext(actionSandbox);
  vm.runInContext(`handlers = ({${handlerSource}});`, actionSandbox);
  const numericTarget = (value) => ({ closest: () => ({ querySelector: () => ({ value }) }) });
  const dateTarget = (value, milestoneId = "ms-1") => ({ dataset: { twyMsId: milestoneId },
    closest: () => ({ querySelector: () => ({ value }) }) });
  actionSandbox.handlers["twy-open-editor"]({ id: "n1" });
  actionSandbox.handlers["twy-open-editor"]({ id: "ms1" });
  check("B-5 #1/#6 複数numeric/milestone行を同時展開", actionSandbox._twyOpenEditorIds.has("n1")
    && actionSandbox._twyOpenEditorIds.has("ms1") && actionSandbox._twyOpenEditorIds.size === 2);
  actionSandbox.handlers["twy-close-editor"]({ id: "n1" });
  check("B-5 #4 numeric取消は対象だけ閉じ、保存・commitなし", !actionSandbox._twyOpenEditorIds.has("n1")
    && actionSandbox._twyOpenEditorIds.has("ms1") && !actionCalls.some((call) => call[0] === "commit"));

  actionCalls.length = 0; actionSandbox._twyOpenEditorIds.add("n1");
  actionSandbox.handlers["twy-save-measurement"]({ id: "n1", target: numericTarget("0") });
  check("B-5 #2 値0を測定保存しnumericエディタだけ閉じる", actionCalls.some((call) => call[0] === "record" && call[2] === 0)
    && actionCalls.filter((call) => call[0] === "commit").length === 1
    && !actionSandbox._twyOpenEditorIds.has("n1") && actionSandbox._twyOpenEditorIds.has("ms1"));
  for (const raw of ["", "not-number"]) {
    actionCalls.length = 0; actionSandbox._twyOpenEditorIds.add("n1");
    actionSandbox.handlers["twy-save-measurement"]({ id: "n1", target: numericTarget(raw) });
    check(`B-5 #3 numeric「${raw || "空"}」はtoast・開いたまま・日報なし`, actionCalls.some((call) => call[0] === "toast")
      && !actionCalls.some((call) => call[0] === "record" || call[0] === "commit")
      && actionSandbox._twyOpenEditorIds.has("n1"));
  }
  actionCalls.length = 0; actionSandbox.recordResult = { ok: false, errors: ["対象なし"] };
  actionSandbox.handlers["twy-save-measurement"]({ id: "missing", target: numericTarget("1") });
  check("B-5 #13 データ層エラーはtoastフォールバック・commitなし", actionCalls.some((call) => call[0] === "toast")
    && !actionCalls.some((call) => call[0] === "commit"));
  actionSandbox.recordResult = { ok: true };

  actionCalls.length = 0;
  actionSandbox.handlers["twy-ms-toggle-done"]({ id: "ms1", target: { checked: true, dataset: { twyMsId: "ms-1" } } });
  check("B-5 #7 節目ONはtodayを渡しエディタ維持", actionCalls.some((call) => call[0] === "update"
    && call[1] === "ms1" && call[2] === "ms-1" && call[3].doneAt === "2026-08-24")
    && actionSandbox._twyOpenEditorIds.has("ms1") && actionCalls.some((call) => call[0] === "commit"));
  actionCalls.length = 0;
  actionSandbox.handlers["twy-ms-toggle-done"]({ id: "ms1", target: { checked: false, dataset: { twyMsId: "ms-1" } } });
  check("B-5 #8 節目OFF訂正はdoneAt空・エディタ維持", actionCalls.some((call) => call[0] === "update" && call[3].doneAt === "")
    && actionSandbox._twyOpenEditorIds.has("ms1"));
  actionCalls.length = 0; actionSandbox.state = { marker: "unchanged" };
  const stateBeforeMilestoneError = JSON.stringify(actionSandbox.state);
  actionSandbox.updateResult = { ok: false, errors: ["対象なし"] };
  actionSandbox.handlers["twy-ms-toggle-done"]({ id: "ms1", target: { checked: true, dataset: { twyMsId: "ms-1" } } });
  check("B-5 #13 milestoneデータ層エラーは再描画・toast・state不変・commitなし",
    actionCalls.some((call) => call[0] === "render") && actionCalls.some((call) => call[0] === "toast")
    && JSON.stringify(actionSandbox.state) === stateBeforeMilestoneError
    && !actionCalls.some((call) => call[0] === "commit"));
  actionSandbox.updateResult = { ok: true };
  actionCalls.length = 0;
  actionSandbox.handlers["twy-ms-edit-date"]({ id: "ms1", target: dateTarget("2026-01-01") });
  check("B-5 #9 予定日変更はボタンクリック経路で保存・エディタ維持", actionCalls.some((call) => call[0] === "update"
    && call[3].plannedDate === "2026-01-01") && actionSandbox._twyOpenEditorIds.has("ms1"));
  for (const value of ["", "2026/01/01"]) {
    actionCalls.length = 0;
    actionSandbox.handlers["twy-ms-edit-date"]({ id: "ms1", target: dateTarget(value) });
    check(`B-5 #10 日付「${value || "空"}」はtoast・保存/日報なし`, actionCalls.some((call) => call[0] === "toast")
      && !actionCalls.some((call) => call[0] === "update" || call[0] === "commit")
      && actionSandbox._twyOpenEditorIds.has("ms1"));
  }
  actionSandbox.handlers["twy-close-editor"]({ id: "ms1" });
  check("B-5 #11 milestone閉じるでSetから削除", !actionSandbox._twyOpenEditorIds.has("ms1"));

  console.log("[3] エディタHTML: 初期値・ソート・全escapeHTML・iOS入力属性");
  const editorSource = sourceBetween(appSource, "function twyMilestoneProgressHTML(", "function renderTwyTrackRow(track) {");
  const escapeHTML = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const renderSandbox = { state: { trackMeasurements: [] }, _twyOpenEditorIds: new Set(),
    latestMeasurement: trackCore.latestMeasurement,
    normalizeMilestoneProgress: trackCore.normalizeMilestoneProgress,
    milestoneProgressRatio: trackCore.milestoneProgressRatio, escapeHTML };
  vm.createContext(renderSandbox);
  vm.runInContext(editorSource, renderSandbox);
  const numericHtmlTrack = { id: "n-html", kind: "numeric", baselineValue: 2, valueStep: .5, unit: "章" };
  check("閉じたエディタは空文字で#9通常表示を変えない", renderSandbox.twyEditorHTML(numericHtmlTrack) === "");
  renderSandbox._twyOpenEditorIds.add("n-html");
  renderSandbox.state.trackMeasurements = [{ id: "trm", trackId: "n-html", value: 7,
    observedAt: "2026-08-24T10:00:00", updatedAt: "2026-08-24T10:00:00", deleted: false }];
  const numericHTML = renderSandbox.twyEditorHTML(numericHtmlTrack);
  check("numeric初期値は最新measurement、number/decimal/valueStep", numericHTML.includes('value="7"')
    && numericHTML.includes('type="number"') && numericHTML.includes('inputmode="decimal"')
    && numericHTML.includes('step="0.5"'));
  const xss = '\"><img src=x data-v261-breached="';
  const xssNumeric = renderSandbox.twyNumericEditorHTML({ id: xss, kind: "numeric", baselineValue: xss,
    valueStep: xss, unit: xss });
  check("numericのtrack.id/unit/valueStep/latestを全escape", !xssNumeric.includes("<img")
    && xssNumeric.includes(escapeHTML(xss)));
  renderSandbox._twyOpenEditorIds.add("ms-html");
  const milestoneHTML = renderSandbox.twyMilestoneEditorHTML({ id: "ms-html", kind: "milestone", milestones: [
    { id: "late", label: "後", plannedDate: "2026-09-02", deleted: false },
    { id: xss, label: xss, plannedDate: xss, deleted: false },
    { id: "early", label: "前", plannedDate: "2026-08-01", deleted: false },
    { id: "deleted", label: "削除", plannedDate: "2026-07-01", deleted: true }
  ] });
  check("milestoneはdeleted除外・plannedDate昇順", !milestoneHTML.includes("削除")
    && milestoneHTML.indexOf("前") < milestoneHTML.indexOf("後"));
  check("milestone.id/label/plannedDateとtrack.idを全escape", !milestoneHTML.includes("<img")
    && milestoneHTML.includes(escapeHTML(xss)) && milestoneHTML.includes('type="date"'));

  console.log("[4] 実ブラウザ: B-5 13経路・quiet日報・CSS・既存WBS回帰");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1024, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);
  const TODAY = "2026-08-24", CYCLE = "2026-08-15", NOW = `${TODAY}T10:00:00`;
  const project = (id) => ({ id, kind: "normal", title: id, status: "active", priority: "中", category: "",
    startDate: CYCLE, dueDate: "", description: "", twelveWeekStartDate: CYCLE, showProgress: false,
    collapsed: false, createdAt: `${CYCLE}T00:00:00`, updatedAt: `${CYCLE}T00:00:00`, deleted: false });
  const numericTrack = (id, ownerId, extra = {}) => ({ id, ownerType: "project", ownerId, cycleStartDate: CYCLE,
    kind: "numeric", name: id, unit: "章", startDate: CYCLE, deadline: "2026-09-30", baselineValue: 0,
    goalValue: 20, valueStep: 1, milestones: [], status: "active", closedAt: "", closedReason: "",
    supersedesTrackId: "", carriedFromTrackId: "", createdAt: `${CYCLE}T00:00:00`,
    updatedAt: `${CYCLE}T00:00:00`, deleted: false, ...extra });
  const ms = (id, label, plannedDate, extra = {}) => ({ id, label, plannedDate,
    originalPlannedDate: plannedDate, doneAt: "", doneChangedAt: "", updatedAt: `${CYCLE}T00:00:00`,
    deleted: false, ...extra });
  const measurement = (id, trackId, value) => ({ id, trackId, value, observedAt: NOW, sourceKind: "wbs",
    blockId: "", note: "", createdAt: NOW, updatedAt: NOW, deleted: false });
  async function savedState() { return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY); }
  async function resetReportAndCounter() {
    await page.evaluate(({ key, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      delete state.reports[today];
      window.__v261OriginalSetItem.call(localStorage, key, JSON.stringify(state));
      window.__v261SaveCalls = 0;
    }, { key: STATE_KEY, today: TODAY });
  }
  try {
    await page.clock.setFixedTime(new Date(2026, 7, 24, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    const tracks = [
      numericTrack("n-open", "p-num"),
      numericTrack("n-done", "p-done", { goalValue: 10 }),
      numericTrack("n-closed", "p-closed", { status: "closed", closedReason: "manual" }),
      numericTrack("m-track", "p-ms", { kind: "milestone", unit: "", deadline: "", baselineValue: 0,
        goalValue: 0, milestones: [ms("ms-b", "後の節目", "2026-09-10"), ms("ms-a", "先の節目", "2026-08-30"),
          ms("ms-x", "削除済み", "2026-08-20", { deleted: true })] })
    ];
    await page.evaluate(({ key, today, cycle, projects, tracks, measurements }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "wbs"; state.selectedDate = today; state.settings.twelveWeekStartDate = cycle;
      state.projects = projects; state.tasks = [{ id: "task-1", projectId: "p-num", parentTaskId: "",
        title: "既存WBS操作", status: "todo", progressNum: 0, progressDen: 10, deleted: false }];
      state.blocks = []; state.recurrences = []; state.tracks = tracks; state.trackMeasurements = measurements;
      state.reports = {};
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY, cycle: CYCLE,
      projects: [project("p-num"), project("p-done"), project("p-ms"), project("p-closed")], tracks,
      measurements: [measurement("trm-open", "n-open", 5), measurement("trm-done", "n-done", 10)] });
    await page.reload();
    await page.waitForSelector('.twy-row[data-twy-track-id="n-open"]');
    await page.evaluate((key) => {
      window.__v261OriginalSetItem = Storage.prototype.setItem;
      window.__v261SaveCalls = 0;
      Storage.prototype.setItem = function(k, value) {
        if (k === key) window.__v261SaveCalls += 1;
        return window.__v261OriginalSetItem.call(this, k, value);
      };
    }, STATE_KEY);
    const row = (id) => page.locator(`.twy-row[data-twy-track-id="${id}"]`);

    check("B-5 #12 closed trackは行・openボタンとも非描画", await row("n-closed").count() === 0
      && await page.locator('[data-action="twy-open-editor"][data-id="n-closed"]').count() === 0);
    await row("n-open").locator('[data-action="twy-open-editor"]').click();
    const numericInput = row("n-open").locator("[data-twy-editor-value]");
    check("B-5 #1 numericを最新値5で展開", await numericInput.inputValue() === "5");
    check("numeric inputはiOS属性と16pxを満たす", await numericInput.getAttribute("type") === "number"
      && await numericInput.getAttribute("inputmode") === "decimal" && await numericInput.getAttribute("step") === "1"
      && await numericInput.evaluate((el) => getComputedStyle(el).fontSize) === "16px");
    await row("m-track").locator('[data-action="twy-open-editor"]').click();
    check("B-5 #6 複数行同時展開・節目昇順/deleted除外", await page.locator(".twy-editor").count() === 2
      && await row("m-track").locator(".twy-ms-edit-item").count() === 2
      && (await row("m-track").locator(".checkbox-line").allTextContents()).join("|") === "先の節目|後の節目");
    const dateInput = row("m-track").locator('[data-twy-ms-id="ms-a"]').locator("xpath=ancestor::div[contains(@class,'twy-ms-edit-item')]").locator("[data-twy-ms-date-input]");
    check("milestone date inputはtype=date・16px", await dateInput.getAttribute("type") === "date"
      && await dateInput.evaluate((el) => getComputedStyle(el).fontSize) === "16px");

    const beforeCancel = await savedState();
    await row("n-open").locator('[data-action="twy-close-editor"]').click();
    const afterCancel = await savedState();
    check("B-5 #4 numeric取消は未保存・対象だけ閉じる", await row("n-open").locator(".twy-editor").count() === 0
      && await row("m-track").locator(".twy-editor").count() === 1
      && afterCancel.trackMeasurements.length === beforeCancel.trackMeasurements.length
      && await page.evaluate(() => window.__v261SaveCalls) === 0);

    await row("n-open").locator('[data-action="twy-open-editor"]').click();
    await resetReportAndCounter();
    await row("n-open").locator("[data-twy-editor-value]").fill("");
    await row("n-open").locator('[data-action="twy-save-measurement"]').click();
    let stateAfter = await savedState();
    check("B-5 #3 空欄はtoast・開いたまま・保存/日報なし", (await page.locator(".toast").textContent()).includes("有効な数値")
      && await row("n-open").locator(".twy-editor").count() === 1 && stateAfter.trackMeasurements.length === 2
      && !stateAfter.reports[TODAY] && await page.evaluate(() => window.__v261SaveCalls) === 0);

    await resetReportAndCounter();
    await row("n-open").locator("[data-twy-editor-value]").fill("1");
    await row("n-open").locator('[data-action="twy-save-measurement"]').evaluate((el) => { el.dataset.id = "missing"; });
    await row("n-open").locator('[data-action="twy-save-measurement"]').click();
    stateAfter = await savedState();
    check("B-5 #13 stale data-idはデータ層ok:false→toast・state不変", (await page.locator(".toast").textContent()).includes("見つかりません")
      && stateAfter.trackMeasurements.length === 2 && !stateAfter.reports[TODAY]
      && await page.evaluate(() => window.__v261SaveCalls) === 0);
    await row("n-open").locator('[data-action="twy-save-measurement"]').evaluate((el) => { el.dataset.id = "n-open"; });

    await resetReportAndCounter();
    await row("n-open").locator("[data-twy-editor-value]").fill("0");
    await row("n-open").locator('[data-action="twy-save-measurement"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-twy-track-id="n-open"] .twy-editor'));
    stateAfter = await savedState();
    const latestNumeric = stateAfter.trackMeasurements.at(-1);
    check("B-5 #2 値0を追記・同秒observedAtを1秒繰り上げ・sourceKind:wbs", latestNumeric.trackId === "n-open"
      && latestNumeric.value === 0 && latestNumeric.observedAt === `${TODAY}T10:00:01`
      && latestNumeric.createdAt === NOW && latestNumeric.sourceKind === "wbs");
    check("numeric成功はWBS表示・quiet日報・保存全体3回", (!stateAfter.currentView || stateAfter.currentView === "wbs")
      && !!stateAfter.reports[TODAY] && await page.evaluate(() => window.__v261SaveCalls) === SUCCESS_SAVE_CALLS);

    check("B-5 #5 done trackは訂正ボタン", await row("n-done").locator(".twy-correct").textContent() === "訂正");
    await row("n-done").locator(".twy-correct").click();
    check("訂正は通常numericと同じエディタ", await row("n-done").locator("[data-twy-editor-value]").inputValue() === "10");
    await resetReportAndCounter();
    await row("n-done").locator("[data-twy-editor-value]").fill("9");
    await row("n-done").locator('[data-action="twy-save-measurement"]').click();
    stateAfter = await savedState();
    check("done後訂正は新measurementを追記", stateAfter.trackMeasurements.at(-1).trackId === "n-done"
      && stateAfter.trackMeasurements.at(-1).value === 9 && !!stateAfter.reports[TODAY]);

    const msRow = row("m-track");
    const checkbox = (id) => msRow.locator(`[data-action="twy-ms-toggle-done"][data-twy-ms-id="${id}"]`);
    await resetReportAndCounter();
    await checkbox("ms-a").click();
    stateAfter = await savedState();
    let msTrackState = stateAfter.tracks.find((track) => track.id === "m-track");
    let msState = msTrackState.milestones.find((entry) => entry.id === "ms-a");
    check("B-5 #7 節目ONはdoneAt=today・親updatedAt伝播・開いたまま", msState.doneAt === TODAY
      && msState.doneChangedAt === NOW && msTrackState.updatedAt === NOW
      && await msRow.locator(".twy-editor").count() === 1);
    check("節目ONはquiet日報・保存全体3回", !!stateAfter.reports[TODAY]
      && await page.evaluate(() => window.__v261SaveCalls) === SUCCESS_SAVE_CALLS);

    await resetReportAndCounter();
    await checkbox("ms-a").click();
    stateAfter = await savedState();
    msTrackState = stateAfter.tracks.find((track) => track.id === "m-track");
    msState = msTrackState.milestones.find((entry) => entry.id === "ms-a");
    check("B-5 #8 節目OFF訂正はdoneAt空・original不変・開いたまま", msState.doneAt === ""
      && msState.originalPlannedDate === "2026-08-30" && await msRow.locator(".twy-editor").count() === 1
      && !!stateAfter.reports[TODAY] && await page.evaluate(() => window.__v261SaveCalls) === SUCCESS_SAVE_CALLS);
    const doneChangedBeforeDate = msState.doneChangedAt;

    await resetReportAndCounter();
    const msItem = msRow.locator('.twy-ms-edit-item:has([data-twy-ms-id="ms-a"])');
    await msItem.locator("[data-twy-ms-date-input]").fill("2026-01-01");
    await msItem.locator('[data-action="twy-ms-edit-date"]').click();
    stateAfter = await savedState();
    msTrackState = stateAfter.tracks.find((track) => track.id === "m-track");
    msState = msTrackState.milestones.find((entry) => entry.id === "ms-a");
    check("B-5 #9 サイクル前予定日も保存しoriginal/doneChangedAt不変", msState.plannedDate === "2026-01-01"
      && msState.originalPlannedDate === "2026-08-30" && msState.doneChangedAt === doneChangedBeforeDate);
    check("予定日成功もエディタ維持・quiet日報・保存全体3回", await msRow.locator(".twy-editor").count() === 1
      && !!stateAfter.reports[TODAY] && await page.evaluate(() => window.__v261SaveCalls) === SUCCESS_SAVE_CALLS);

    await resetReportAndCounter();
    await msItem.locator("[data-twy-ms-date-input]").fill("");
    await msItem.locator('[data-action="twy-ms-edit-date"]').click();
    stateAfter = await savedState();
    check("B-5 #10 空日付はtoast・state/日報/保存なし・開いたまま", (await page.locator(".toast").textContent()).includes("有効な日付")
      && stateAfter.tracks.find((track) => track.id === "m-track").milestones.find((entry) => entry.id === "ms-a").plannedDate === "2026-01-01"
      && !stateAfter.reports[TODAY] && await page.evaluate(() => window.__v261SaveCalls) === 0
      && await msRow.locator(".twy-editor").count() === 1);
    await msRow.locator('[data-action="twy-close-editor"]').click();
    check("B-5 #11 milestone閉じるは保存せずエディタだけ閉じる", await msRow.locator(".twy-editor").count() === 0
      && await page.evaluate(() => window.__v261SaveCalls) === 0);

    await page.locator('[data-action="toggle-project-collapse"][data-id="p-num"]').click();
    stateAfter = await savedState();
    check("既存WBS Project折りたたみ操作は退行なし", stateAfter.projects.find((entry) => entry.id === "p-num").collapsed === true);
    await page.locator('[data-action="toggle-project-collapse"][data-id="p-num"]').click();
    await row("m-track").locator('[data-action="twy-open-editor"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    check("390pxでもエディタが外側横スクロールを作らない", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\nv261: 全件成功" : `\nv261: ${failures}件失敗`);
  if (failures) process.exit(1);
})().catch((error) => { console.error(error); process.exit(1); });
