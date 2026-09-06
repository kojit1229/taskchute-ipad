// v364 R1-R5 specification tests: Node imports with real core normalization sections.
const path = require("path");
const { pathToFileURL } = require("url");

const fs = require("fs");
const vm = require("vm");
const clone = (value) => JSON.parse(JSON.stringify(value));
// Execute the production normalization sections, not an identity stub.
const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const normalizationSource = appSource.slice(appSource.indexOf('  if (!value.earlyBird'), appSource.indexOf('  const actualIronImport'))
  + appSource.slice(appSource.indexOf('  value.declarations = compactArr'), appSource.indexOf('  // v129:', appSource.indexOf('  value.declarations = compactArr')));
function normalizeCore(value) {
  return vm.runInNewContext(`(function(value) { ${normalizationSource}; return value; })(value)`, {
    value, compactArr: (a) => (Array.isArray(a) ? a : []).filter(x => x && typeof x === "object" && !Array.isArray(x)),
    dateParts: (d) => /^\d{4}-\d{2}-\d{2}$/.test(d), crypto: require("crypto")
  });
}
const coreKeys = vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/sync/github.js"), "utf8")
  .match(/const SYNC_CORE_COMPARE_KEYS = (\[[\s\S]*?\]);/)[1]);
const coreJSON = s => JSON.stringify(coreKeys.map(k => k.split(".").reduce((v, p) => v?.[p], s)));
let currentStore, timerCalls = [], timers = new Map(), timerId = 0;
global.setTimeout = (fn, ms) => { const id = ++timerId; timers.set(id, fn); timerCalls.push(ms); return id; };
global.clearTimeout = id => timers.delete(id);

const ROOT = path.join(__dirname, "..");
const SYNC_PATH = path.join(ROOT, "src", "sync", "github.js");
const STORE_PATH = path.join(ROOT, "src", "state", "store.js");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function noop() {}

// runAutoSyncPull()は_lastPullCheckAt(Date.now()ベース、モジュール内部の非exportな変数)で
// 60秒スロットルする(v134)。同一プロセス内で複数テストが連続してrunAutoSyncPull()を呼ぶと
// 2回目以降が早期returnし何もしないまま「成功」に見えてしまうため、Date.nowを差し替えて
// テストのたびに実時間を100秒進める(スロットルを確実に越えさせる。実プロダクトの時刻表示
// 用途はnowDateTime()側で別途スタブ済みのため、Date.now差し替えの影響はこのスロットル判定のみ)。
let _fakeNowMs = Date.now();
Date.now = () => _fakeNowMs;
function advanceClockPastPullThrottle() { _fakeNowMs += 100000; }

function installMemoryLocalStorage() {
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
}

// store-core.test.js / sync-load-confirm-snapshot.test.jsのbaseState()と同じ形
// (SYNC_CORE_COMPARE_KEYS一式+マージ対象コレクションを揃えた最小state)。
function baseState(extra) {
  return {
    journalMeta: {},
    settings: {
      journalTemplate: "", morningEnergyLog: {}, github: { token: "t", owner: "local-owner", repo: "local-repo", dataOwner: "o", dataRepo: "r" },
      avoidList: [], categories: [], lifeAreas: [], vision: "", affirmation: "",
      twelveWeekStartDate: "", twelveWeekScoreTarget: 85, birthDate: "", battery: {},
      gymExerciseList: [], visionDirectCategories: [], lastPushedAt: "", autoSync: true
    },
    journals: {}, feedback: {}, condition: { logs: {} }, sleep: { logs: {} },
    blocks: [], zeroThinking: { entries: [], suggestedThemes: [] },
    dailyDeclarations: {}, weeklyWishes: {}, bodyScans: [], tasks: [], projects: [], storeVisits: [],
    swipeTriageLog: [], gardenLog: {}, archivedDates: [],
    writeMeditations: [], aiStepProcessedIds: [], aiStepDismissedIds: [], aiReportReadIds: [],
    aiStepPendingRequests: [], coachLog: { meals: [] }, tracks: [], trackMeasurements: [], weeklyCommitments: [],
    recurrences: [], declarations: [], questions: [], experiments: [],
    earlyBird: {}, habitStreaks: {}, habitPinHistory: {},
    reports: {}, chainRuns: [], aiScheduleHistory: [], feedbackFiles: [], feedbackIngestedDates: [],
    migrationRitualLog: [], zeroSecThemeLog: [], aiWorkProcessedIds: [], ironImport: {},
    dataModifiedAt: "2026-09-05T08:00:00",
    ...extra
  };
}

async function loadModules() {
  const storeMod = await import(pathToFileURL(STORE_PATH).href);
  const syncMod = await import(pathToFileURL(SYNC_PATH).href);
  return { storeMod, syncMod };
}

// downloadGitHubStateTextが読むGETのbodyだけ返し、PUTは記録するfetchスタブ。
// writeBackupSnapshotBeforeLoadは注入関数として別途差し替えるため、backups/へのPUTはここでは来ない。
// getGate: 指定すると、GETのfetchはこのPromiseがresolveするまで待つ(syncFromGitHubOnStartupの
// 「GET待ち中に編集される」競合を、実際の並行処理無しに決定論的に再現するため)。
function installNodeStubs(syncMod, { remoteBodyText, snapshotImpl, autoSaveImpl, startupDataModifiedAt, getGate, normalizeImpl, renderImpl, nowDateTimeImpl, now = "2026-09-06T07:00:00" } = {}) {
  installMemoryLocalStorage();
  timerCalls = [];
  const calls = { toast: [], snapshotCalls: 0, putBodies: [], render: 0, deferred: 0, snapshots: [] };
  global.window = global.window || {};
  global.window.confirm = () => true;
  global.navigator = global.navigator || {};
  global.navigator.onLine = true;
  global.fetch = async (url, opts = {}) => {
    const method = (opts && opts.method) || "GET";
    if (method === "PUT") {
      calls.putBodies.push(opts.body);
      return { ok: true, json: async () => ({ content: { sha: "sha-after-put" } }) };
    }
    if (getGate) await getGate;
    return { ok: true, json: async () => ({ content: remoteBodyText, encoding: "base64", sha: "sha-remote-1" }) };
  };
  syncMod.configureGithubSync({
    normalizeState: normalizeImpl || normalizeCore,
    nowDateTime: nowDateTimeImpl || (() => now),
    todayISO: () => "2026-09-06",
    addDays: (d) => d,
    isTouchedBlock: () => false,
    RECURRENCE_KEEP_PAST_DAYS: 7,
    RECURRENCE_FUTURE_DAYS: 31,
    SWIPE_TRIAGE_LOG_MAX: 200,
    showToast: (msg) => calls.toast.push(msg),
    maintainRecurrences: noop, render: renderImpl || (() => { calls.render++; }), runDailyOpen: () => false,
    saveState: autoSaveImpl || noop,
    requireGitHubConfig: () => ({ owner: "o", repo: "r", branch: "main", token: "t" }),
    fetchGitHubFileSHA: async () => "sha-remote-1", personalDataReady: () => true,
    personalDataFileConfig: (c) => c,
    gitHubContentsURL: () => "https://api.github.com/fake/contents", githubHeaders: () => ({}),
    gitHubErrorMessage: async (r) => `HTTP ${r.status}`,
    fromBase64: (x) => x, toBase64: (x) => x,
    sanitizedStateForGitHub: () => clone(currentStore.state), maybeWriteBackupSnapshot: async () => {},
    writeBackupSnapshotBeforeLoad: async (...args) => {
      calls.snapshotCalls++;
      calls.snapshots.push(JSON.stringify(currentStore.state));
      if (snapshotImpl) return snapshotImpl(...args);
      return true;
    },
    updateAutoSaveStatus: noop, updateSyncDot: noop,
    renderSyncBanner: noop, clearSyncBannerDismissal: noop, clearPersonalDataAuthError: noop,
    pruneExpiredSuggestedThemes: (x) => x,
    renderDeferringForFocus: () => { calls.deferred++; },
    _startupDataModifiedAt: startupDataModifiedAt || ""
  });
  return calls;
}

// テストの共通フィクスチャ: ローカル=タスクA(09:00)+ジャーナル1件+未push、
// リモート=タスクA(10:00、バッチ相当の完了条件更新)+タスクB(リモートのみ)+0秒思考1件、
// recurrences r1をリモートの方が新しくして「コア不一致」を作る(syncCoreEqual=false)。
function makeFixture({ localDataModifiedAt = "2026-09-06T06:00:00", remoteDataModifiedAt = "2026-09-06T06:30:00" } = {}) {
  const local = baseState({
    dataModifiedAt: localDataModifiedAt,
    tasks: [{ id: "task-a", title: "ローカル版タイトル", updatedAt: "2026-09-06T00:00:00", deleted: false }],
    journals: { "2026-09-05": "# ローカルにしか無いジャーナル" },
    recurrences: [{ id: "r1", title: "ローカルのルール", updatedAt: "2026-09-06T00:00:00" }],
    zeroThinking: { entries: [{ id: "zt-local", body: "ローカルの0秒思考" }], suggestedThemes: [] }
  });
  local.settings.lastPushedAt = "2026-09-06T05:00:00";  // localDataModifiedAtより古い=未push
  const remote = JSON.parse(JSON.stringify(local));
  local.settings.vision = "old";
  local.settings.categories = [{id: "shared", name: "old"}, {id: "local-only", name: "local"}];
  remote.settings.vision = "new";
  remote.settings.categories = [{id: "remote-only", name: "remote"}, {id: "shared", name: "new"}];
  remote.settings.github = {token: "remote-token", owner: "remote-owner", repo: "remote-repo"};
  remote.dataModifiedAt = remoteDataModifiedAt;
  remote.tasks = [
    { id: "task-a", title: "バッチが更新したタイトル", updatedAt: "2026-09-06T06:00:00", deleted: false },
    { id: "task-b", title: "リモートのみのタスク", updatedAt: "2026-09-06T06:00:00", deleted: false }
  ];
  remote.recurrences = [{ id: "r1", title: "リモートのルール(新しい)", updatedAt: "2026-09-06T06:00:00" }];
  remote.zeroThinking = { entries: [{ id: "zt-remote", body: "リモートの0秒思考" }], suggestedThemes: [] };
  return { local: normalizeCore(local), remote: normalizeCore(remote) };
}

async function run() {
  const { storeMod, syncMod } = await loadModules();
  currentStore = storeMod;

  console.log("[1] runAutoSyncPull: hasUnpushed + コア不一致 → バナーなしで自動マージ、直後のpushでPUT1回");
  {
    const { local, remote } = makeFixture();
    storeMod.setState(local);
    const calls = installNodeStubs(syncMod, { remoteBodyText: JSON.stringify(remote) });
    advanceClockPastPullThrottle();
    await syncMod.runAutoSyncPull();
    const s = storeMod.state;
    check("バナーが出ない(_syncBannerが空)", !syncMod._syncBanner, String(syncMod._syncBanner));
    check("taskAはリモート版(新しい)が勝つ", s.tasks.find((t) => t.id === "task-a").title === "バッチが更新したタイトル",
      JSON.stringify(s.tasks));
    check("リモート限定のtaskBが増える", s.tasks.some((t) => t.id === "task-b"));
    check("ローカル限定のジャーナルが残る", (s.journals["2026-09-05"] || "").includes("ローカルにしか無い"));
    check("recurrences r1もリモート(新しい)が勝つ(コア自動マージ)",
      s.recurrences.find((r) => r.id === "r1").title === "リモートのルール(新しい)", JSON.stringify(s.recurrences));
    check("0秒思考が和集合", s.zeroThinking.entries.some((e) => e.id === "zt-local") && s.zeroThinking.entries.some((e) => e.id === "zt-remote"));
    check("lastPushedAt=remoteT", s.settings.lastPushedAt === remote.dataModifiedAt, s.settings.lastPushedAt);
    check("自動マージのトースト文言", calls.toast.includes("他端末の記録を取り込みました(自動マージ)"), JSON.stringify(calls.toast));

    const scheduled = timers.get(syncMod._autoSyncTimer);
    check("pull schedules push", !!scheduled);
    await scheduled();
    check("PUT carries merged core", coreJSON(JSON.parse(JSON.parse(calls.putBodies[0]).content)) === coreJSON(s));
    check("直後のpushでPUTが1回走る(和集合が届く)", calls.putBodies.length === 1, String(calls.putBodies.length));
  }

  console.log("[2] runAutoSyncPush: push前ガードでリモートが新しい+コア不一致 → 自動マージ→同tickでpush");
  {
    const { local, remote } = makeFixture({ localDataModifiedAt: "2026-09-06T06:00:00", remoteDataModifiedAt: "2026-09-06T06:30:00" });
    local.settings.lastPushedAt = "2026-09-06T05:00:00";
    storeMod.setState(local);
    const calls = installNodeStubs(syncMod, { remoteBodyText: JSON.stringify(remote) });
    await syncMod.runAutoSyncPush();
    const s = storeMod.state;
    check("バナーが出ない", !syncMod._syncBanner, String(syncMod._syncBanner));
    check("taskAはリモート版(新しい)が勝つ", s.tasks.find((t) => t.id === "task-a").title === "バッチが更新したタイトル");
    check("自動マージ後、同tickでpushが走る(PUTが1回)", calls.putBodies.length === 1, String(calls.putBodies.length));
    check("push does not schedule auto sync", timerCalls.length === 0);
    check("push defers rendering for focus", calls.deferred === 1 && calls.render === 0);
    check("push成功でlastPushedAtがdataModifiedAtに揃う", s.settings.lastPushedAt === s.dataModifiedAt,
      `lastPushedAt=${s.settings.lastPushedAt} dataModifiedAt=${s.dataModifiedAt}`);
  }

  console.log("[3] syncFromGitHubOnStartup: 編集中に取得(コア不一致) → 自動マージ、ローカル限定の記録が残る");
  {
    const { local, remote } = makeFixture({ localDataModifiedAt: "2026-09-06T06:00:00", remoteDataModifiedAt: "2026-09-06T06:30:00" });
    storeMod.setState(local);
    // GET待ち中の編集を実際の並行処理無しに再現するため、GETをgateで止めておく
    // (_startupDataModifiedAtは起動時点=06:00:00のスナップショット。呼び出し直後・GET解決前に
    // state.dataModifiedAtを進めることで「fetch待ち中にユーザーが編集した」を模す)。
    let releaseGate;
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    const calls = installNodeStubs(syncMod, {
      remoteBodyText: JSON.stringify(remote), startupDataModifiedAt: "2026-09-06T06:00:00", getGate: gate
    });
    const p = syncMod.syncFromGitHubOnStartup();
    storeMod.state.dataModifiedAt = "2026-09-06T06:05:00";  // fetch待ち中に編集された
    releaseGate();
    await p;
    const s = storeMod.state;
    check("バナーが出ない", !syncMod._syncBanner, String(syncMod._syncBanner));
    check("編集中の入力(ローカル限定ジャーナル相当)が残る", (s.journals["2026-09-05"] || "").includes("ローカルにしか無い"));
    check("taskAはリモート版(新しい)が勝つ", s.tasks.find((t) => t.id === "task-a").title === "バッチが更新したタイトル");
    check("renderDeferringForFocus経由で再描画される(render呼び出しあり)", calls.deferred === 1 && calls.render === 0);
  }

  console.log("[4] ローカルの方が新しいtaskはローカル勝ち、deleted:trueのtombstoneは復活しない");
  {
    const { local, remote } = makeFixture();
    // taskAをローカルの方が新しくする(バッチではなくユーザー編集が最新のケース)
    local.tasks = [{ id: "task-a", title: "ユーザーが直した最新タイトル", updatedAt: "2026-09-06T06:20:00", deleted: false }];
    remote.tasks = [
      { id: "task-a", title: "古いバッチ版", updatedAt: "2026-09-06T06:00:00", deleted: false },
      // task-cはローカルで削除済み(tombstone)。リモートは削除前の古い版のまま。
      { id: "task-c", title: "リモートにはまだ生きている", updatedAt: "2026-09-06T05:00:00", deleted: false }
    ];
    local.tasks.push({ id: "task-c", title: "ローカルで削除済み", updatedAt: "2026-09-06T06:10:00", deleted: true });
    storeMod.setState(local);
    const calls = installNodeStubs(syncMod, { remoteBodyText: JSON.stringify(remote) });
    advanceClockPastPullThrottle();
    await syncMod.runAutoSyncPull();
    const s = storeMod.state;
    check("バナーが出ない", !syncMod._syncBanner);
    check("ローカルの方が新しいtaskAはローカル勝ち", s.tasks.find((t) => t.id === "task-a").title === "ユーザーが直した最新タイトル",
      JSON.stringify(s.tasks));
    check("tombstone(deleted:true)は復活しない", s.tasks.find((t) => t.id === "task-c").deleted === true,
      JSON.stringify(s.tasks.find((t) => t.id === "task-c")));
    void calls;
  }

  console.log("[5] 控え失敗: helperは不変、その後callerはv135適用へ");
  {
    const { local, remote } = makeFixture();
    storeMod.setState(local);
    const calls = installNodeStubs(syncMod, {
      remoteBodyText: JSON.stringify(remote),
      snapshotImpl: async () => false
    });
    const before = JSON.stringify(storeMod.state);
    check("backup helper returns false", !await syncMod.autoMergeRemote(remote, remote.dataModifiedAt, "sha", {origin: "pull"}));
    check("backup helper preserves full state", before === JSON.stringify(storeMod.state));
    advanceClockPastPullThrottle();
    await syncMod.runAutoSyncPull();
    const s = storeMod.state;
    check("pull backup precedes fallback mutation", calls.snapshots.every(x => x === before));
    check("控え失敗時は従来バナーが出る", !!syncMod._syncBanner, String(syncMod._syncBanner));
    // R5: autoMergeRemote(false)の後にだけ、従来v135のコレクション適用へフォールバックする。
    check("taskAはマージ対象コレクションとして既存どおりリモート(新しい)が勝つ",
      s.tasks.find((t) => t.id === "task-a").title === "バッチが更新したタイトル", JSON.stringify(s.tasks));
    check("recurrences(v364のコア自動マージ対象)は控え失敗時ローカルのまま(採用されない)",
      s.recurrences.find((r) => r.id === "r1").title === "ローカルのルール");
    void calls;
  }

  console.log("[6] 手動loadFromGitHubのconfirmは従来どおり(未変更の回帰確認。詳細はsync-load-confirm-snapshot.test.js)");
  {
    const { local, remote } = makeFixture();
    storeMod.setState(local);
    let confirmCalled = false;
    const calls = installNodeStubs(syncMod, { remoteBodyText: JSON.stringify(remote) });
    global.window.confirm = (msg) => { confirmCalled = true; return true; };
    await syncMod.loadFromGitHub();
    check("手動読込はconfirmを経由する(LOSS_RISK_KEYS差分ありのため)", confirmCalled === true);
    void calls;
  }

  console.log("[7] R1/R2 whole-key choice, id order and missing timestamps");
  for (const newer of ["local", "remote", "equal"]) {
    const {local, remote} = makeFixture();
    if (newer === "local") local.dataModifiedAt = "2026-09-06T06:45:00";
    if (newer === "equal") local.dataModifiedAt = remote.dataModifiedAt;
    local.declarations = [{id: "d", reportedAt: "2026-09-06T06:40:00", resultNote: "done"}];
    remote.declarations = [{id: "d", resultNote: ""}];
    for (const key of ["earlyBird", "habitStreaks", "habitPinHistory", "aiScheduleHistory"]) {
      local[key] = key === "aiScheduleHistory" ? ["local"] : {local: {logs: {}}};
      remote[key] = key === "aiScheduleHistory" ? ["remote"] : {remote: {logs: {}}};
    }
    local.settings.battery = {local: 1}; remote.settings.battery = {remote: 2};
    local.settings.visionDirectCategories = ["local"]; remote.settings.visionDirectCategories = ["remote"];
    storeMod.setState(local);
    const before = JSON.stringify(local);
    const credentials = JSON.stringify(local.settings.github);
    const calls = installNodeStubs(syncMod);
    const selected = normalizeCore(clone(newer === "local" ? local : remote));
    check(`${newer}: adoption succeeds`, await syncMod.autoMergeRemote(remote, remote.dataModifiedAt, "sha", {origin: "push"}));
    check(`${newer}: scalar winner`, storeMod.state.settings.vision === (newer === "local" ? "old" : "new"));
    check(`${newer}: settings github immutable`, JSON.stringify(storeMod.state.settings.github) === credentials);
    check(`${newer}: backup once before mutation`, calls.snapshotCalls === 1 && calls.snapshots[0] === before);
    check(`${newer}: declarations missing updatedAt`, storeMod.state.declarations[0].resultNote === selected.declarations[0].resultNote);
    for (const key of ["earlyBird", "habitStreaks", "habitPinHistory", "aiScheduleHistory"])
      check(`${newer}: ${key} replaces whole key`, JSON.stringify(storeMod.state[key]) === JSON.stringify(selected[key]));
    check(`${newer}: battery and string array replace whole key`, JSON.stringify(storeMod.state.settings.battery) === JSON.stringify(selected.settings.battery)
      && JSON.stringify(storeMod.state.settings.visionDirectCategories) === JSON.stringify(selected.settings.visionDirectCategories));
    const cats = storeMod.state.settings.categories;
    check(`${newer}: categories rename without duplicates`, cats.length === 3 && cats.find(c => c.id === "shared").name === (newer === "local" ? "old" : "new"));
    check(`${newer}: categories preserve newer order`, JSON.stringify(cats.map(c => c.id)) === JSON.stringify(newer === "local" ? ["shared", "local-only", "remote-only"] : ["remote-only", "shared", "local-only"]));
    check(`${newer}: no push timer`, timerCalls.length === 0);
  }
  {
    const {local, remote} = makeFixture(); remote.settings.vision = "";
    storeMod.setState(local); installNodeStubs(syncMod);
    await syncMod.autoMergeRemote(remote, remote.dataModifiedAt, "sha", {origin: "push"});
    check("newer empty string is a value", storeMod.state.settings.vision === "");
  }
  console.log("[8] failures and side effects");
  for (const failure of ["backup", "normalize", "apply", "compute-null", "core-throw"]) {
    const {local, remote} = makeFixture(); storeMod.setState(local);
    if (failure === "compute-null") Object.defineProperty(remote, "archivedDates", {get() {throw Error("compute");}});
    if (failure === "core-throw") Object.defineProperty(remote, "recurrences", {get() { throw Error("core"); }});
    if (failure === "apply") Object.defineProperty(local, "recurrences", {value: local.recurrences, writable: false, enumerable: true});
    const before = JSON.stringify(local);
    const calls = installNodeStubs(syncMod, {
      snapshotImpl: () => failure !== "backup",
      normalizeImpl: failure === "normalize" ? () => {throw Error("normalize");} : normalizeCore
    });
    // A late collection write fails after earlier collection assignments.
    if (failure === "apply") Object.defineProperty(local, "tasks", {value: local.tasks, writable: false, enumerable: true});
    const ok = await syncMod.autoMergeRemote(remote, remote.dataModifiedAt, "sha", {origin: "push"});
    check(`${failure}: false`, !ok);
    check(`${failure}: whole state unchanged`, JSON.stringify(storeMod.state) === before);
    check(`${failure}: backup count`, calls.snapshotCalls === (["compute-null", "core-throw"].includes(failure) ? 0 : 1));
  }
  {
    const {local, remote} = makeFixture(); storeMod.setState(local);
    const calls = installNodeStubs(syncMod, {renderImpl: () => {throw Error("render");}});
    check("render exception does not reverse successful adoption", await syncMod.autoMergeRemote(remote, remote.dataModifiedAt, "sha", {origin: "push"}));
    check("toast still emitted after render exception", calls.toast.includes("他端末の記録を取り込みました(自動マージ)"));
  }
  console.log("[9] normalization invariants");
  {
    const {local, remote} = makeFixture();
    local.habitStreaks = {z: {logs: {}}, a: {logs: {}}}; remote.habitStreaks = {a: {logs: {}}, z: {logs: {}}};
    remote.recurrences = clone(local.recurrences); remote.settings = clone(local.settings);
    storeMod.setState(local); installNodeStubs(syncMod);
    await syncMod.autoMergeRemote(remote, remote.dataModifiedAt, "sha", {origin: "push"});
    check("habit key order converges after production normalization", syncMod.syncCoreEqual(normalizeCore(clone(remote))));
    const declarations = Array.from({length: 305}, (_, i) => ({id: `d${String(i).padStart(3, "0")}`, declaredAt: `2026-09-06T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00`}));
    remote.declarations = declarations;
    await syncMod.autoMergeRemote(remote, "2026-09-06T08:00:00", "sha", {origin: "push"});
    check("declarations production slice(-300)", storeMod.state.declarations.length === 300 && storeMod.state.declarations[0].id === "d005");
  }
  console.log("[10] two devices: A merge/push -> B merge/push -> A core-equal pull");
  {
    const {local: a, remote: b} = makeFixture();
    b.settings.lastPushedAt = "2026-09-06T05:00:00";
    storeMod.setState(a);
    const ca = installNodeStubs(syncMod, {remoteBodyText: JSON.stringify(b), now: "2026-09-06T07:00:00"});
    await syncMod.runAutoSyncPush();
    const aAfter = clone(storeMod.state);
    const aWire = JSON.parse(JSON.parse(ca.putBodies[0]).content);
    check("A push contains merged categories", aWire.settings.categories.length === 3);
    b.journals["2026-09-07"] = "B pending journal";
    storeMod.setState(b);
    const cb = installNodeStubs(syncMod, {remoteBodyText: JSON.stringify(aWire), now: "2026-09-06T07:01:00"});
    await syncMod.runAutoSyncPush();
    const bAfter = clone(storeMod.state);
    const bWire = JSON.parse(JSON.parse(cb.putBodies[0]).content);
    // Keep a local pending journal edit to exercise the existing core-equal pull branch.
    aAfter.journals["2026-09-08"] = "A pending journal";
    aAfter.dataModifiedAt = "2026-09-06T07:00:30";
    storeMod.setState(aAfter);
    const pull = installNodeStubs(syncMod, {remoteBodyText: JSON.stringify(bWire), now: "2026-09-06T07:02:00"});
    check("A pull enters core-equal branch", syncMod.syncCoreEqual(bWire));
    check("B journal is pending before final pull", !storeMod.state.journals["2026-09-07"]);
    advanceClockPastPullThrottle(); await syncMod.runAutoSyncPull();
    check("final pull imports B and retains A journal", storeMod.state.journals["2026-09-07"] === "B pending journal"
      && storeMod.state.journals["2026-09-08"] === "A pending journal");
    check("final pull records remote stamp", storeMod.state.settings.lastPushedAt === bWire.dataModifiedAt
      && storeMod.state.dataModifiedAt === "2026-09-06T07:02:00");
    const scheduled = timers.get(syncMod._autoSyncTimer);
    check("final pull schedules push", timerCalls.length === 1 && !!scheduled);
    if (scheduled) await scheduled();
    const finalWire = pull.putBodies[0] && JSON.parse(JSON.parse(pull.putBodies[0]).content);
    check("scheduled push delivers both journals", finalWire?.journals["2026-09-07"] === "B pending journal"
      && finalWire?.journals["2026-09-08"] === "A pending journal");
    check("two-device core JSON convergence", coreJSON(storeMod.state) === coreJSON(bAfter) && syncMod.syncCoreEqual(bAfter));
    check("finite PUT: A initial + B + A scheduled", ca.putBodies.length === 1 && cb.putBodies.length === 1 && pull.putBodies.length === 1);
    check("core-equal pull needs no auto-merge backup", pull.snapshotCalls === 0);
  }
  console.log("[11] edits during backup survive adoption and rollback");
  for (const failNormalize of [false, true]) {
    const {local, remote} = makeFixture(); storeMod.setState(local);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const calls = installNodeStubs(syncMod, {snapshotImpl: () => gate,
      normalizeImpl: failNormalize ? () => { throw Error("normalize after edit"); } : normalizeCore});
    const pending = syncMod.autoMergeRemote(remote, remote.dataModifiedAt, "sha", {origin: "push"});
    check("backup entered before edit", calls.snapshotCalls === 1);
    storeMod.state.journals["2026-09-09"] = "edited during backup";
    storeMod.state.settings.vision = "edited vision";
    storeMod.state.dataModifiedAt = "2026-09-06T06:50:00";
    const edited = JSON.stringify(storeMod.state);
    release(true);
    check(`backup edit adoption result ${failNormalize}`, await pending === !failNormalize);
    check(`backup edit preserved ${failNormalize}`, storeMod.state.journals["2026-09-09"] === "edited during backup"
      && storeMod.state.settings.vision === "edited vision");
    check(`backup not rewritten ${failNormalize}`, calls.snapshotCalls === 1);
    if (failNormalize) check("rollback retains whole edited state", JSON.stringify(storeMod.state) === edited);
  }
  console.log("[12] missing updatedAt and detached candidates");
  for (const localNewer of [false, true]) {
    const {local, remote} = makeFixture();
    local.recurrences[0].updatedAt = "2026-09-06T01:00:00";
    delete remote.recurrences[0].updatedAt;
    if (localNewer) local.dataModifiedAt = "2026-09-07";
    storeMod.setState(local);
    const remoteBefore = JSON.stringify(remote), localBefore = coreJSON(local);
    installNodeStubs(syncMod, {normalizeImpl: value => {
      value.recurrences[0].nested = {mutated: true}; value.settings.battery.mutated = true;
      throw Error("mutate detached candidate");
    }});
    check("mutating normalize fails", !await syncMod.autoMergeRemote(remote, remote.dataModifiedAt, "sha", {origin: "push"}));
    check("candidate shares no core references", JSON.stringify(remote) === remoteBefore && coreJSON(local) === localBefore);
    installNodeStubs(syncMod);
    await syncMod.autoMergeRemote(remote, remote.dataModifiedAt, "sha", {origin: "push"});
    check("one missing stamp selects newer side", storeMod.state.recurrences[0].title === (localNewer ? local.recurrences[0].title : remote.recurrences[0].title));
  }
  {
    const {local, remote} = makeFixture({localDataModifiedAt: "2026-09-06T00:00:00", remoteDataModifiedAt: "2026-09-06"});
    storeMod.setState(local); installNodeStubs(syncMod);
    await syncMod.autoMergeRemote(remote, remote.dataModifiedAt, "sha", {origin: "push"});
    check("normalized equal data stamps select remote", storeMod.state.settings.vision === "new");
  }
  console.log("[13] disjoint capped declarations converge in two rounds");
  {
    const {local: a, remote: b} = makeFixture();
    const records = Array.from({length: 600}, (_, i) => ({id: `d${String(i).padStart(3, "0")}`,
      declaredAt: i < 300 ? "2026-09-05T06:00:00" : "2026-09-06T06:00:00"}));
    a.declarations = records.filter((_, i) => i % 2 === 0).reverse();
    b.declarations = records.filter((_, i) => i % 2 === 1).reverse();
    let left = a, right = b;
    for (let round = 0; round < 2; round++) {
      if (round) { left.journals["2026-09-10"] = "round two"; left.dataModifiedAt = "2026-09-06T07:01:30"; }
      storeMod.setState(left);
      const ca = installNodeStubs(syncMod, {remoteBodyText: JSON.stringify(right), now: `2026-09-06T07:0${round * 2}:00`});
      localStorage.setItem("taskchute-journal-last-synced-sha", "sha-remote-1");
      await syncMod.runAutoSyncPush(); left = clone(storeMod.state);
      const wire = JSON.parse(JSON.parse(ca.putBodies[0]).content);
      if (round) { right.journals["2026-09-11"] = "B round two"; right.dataModifiedAt = "2026-09-06T07:01:40"; }
      storeMod.setState(right);
      const cb = installNodeStubs(syncMod, {remoteBodyText: JSON.stringify(wire), now: `2026-09-06T07:0${round * 2 + 1}:00`});
      localStorage.setItem("taskchute-journal-last-synced-sha", "sha-remote-1");
      await syncMod.runAutoSyncPush(); right = clone(storeMod.state);
      check(`capped round ${round} PUTs finite`, ca.putBodies.length === 1 && cb.putBodies.length === 1);
    }
    check("capped cores converge", coreJSON(left) === coreJSON(right));
    check("latest 300 in declaredAt/id order", JSON.stringify(left.declarations.map(d => d.id)) === JSON.stringify(records.slice(300).map(d => d.id)));
  }
  console.log("[14] caller fallback and success preserve same-second backup edits");
  for (const [origin, outcome] of [["pull", "backup-false"], ["pull", "normalize-throw"],
    ["startup", "backup-false"], ["startup", "normalize-throw"], ["pull", "success"]]) {
    const label = `${origin}/${outcome}`;
    const {local, remote} = makeFixture();
    storeMod.setState(local);
    const sameSecond = origin === "startup" ? "2026-09-06T06:05:00" : local.dataModifiedAt;
    let releaseBackup, enterBackup, releaseGet, backupResolved = false, normalizeThrows = 0;
    const backupGate = new Promise(resolve => { releaseBackup = resolve; });
    const backupEntered = new Promise(resolve => { enterBackup = resolve; });
    const getGate = new Promise(resolve => { releaseGet = resolve; });
    const nowDateTime = () => sameSecond;
    const calls = installNodeStubs(syncMod, {
      remoteBodyText: JSON.stringify(remote), nowDateTimeImpl: nowDateTime,
      startupDataModifiedAt: local.dataModifiedAt, getGate,
      snapshotImpl: () => { enterBackup(); return backupGate; },
      normalizeImpl: value => {
        if (backupResolved && outcome === "normalize-throw") {
          normalizeThrows++;
          throw Error("normalize after same-second edit");
        }
        return normalizeCore(value);
      }
    });
    advanceClockPastPullThrottle();
    const pending = origin === "pull" ? syncMod.runAutoSyncPull() : syncMod.syncFromGitHubOnStartup();
    // startupはGET中の変更で競合分岐へ入り、その後の控え中編集は同一秒に固定する。
    if (origin === "startup") storeMod.state.dataModifiedAt = nowDateTime();
    releaseGet();
    await backupEntered;
    const beforeStamp = storeMod.state.dataModifiedAt;
    check(`${label}: backup captured before edit`, calls.snapshotCalls === 1
      && !JSON.parse(calls.snapshots[0]).journals["2026-09-09"]);
    storeMod.state.journals["2026-09-09"] = "same-second backup edit";
    storeMod.state.dataModifiedAt = nowDateTime();
    // coreValuesの無条件再計算も検証する(ローカル限定のid配列要素)。
    storeMod.state.recurrences.push({id: "during-backup", title: "same-second rule"});
    check(`${label}: data stamp unchanged`, storeMod.state.dataModifiedAt === beforeStamp);
    backupResolved = true;
    releaseBackup(outcome !== "backup-false");
    await pending;
    check(`${label}: journal survives caller`, storeMod.state.journals["2026-09-09"] === "same-second backup edit");
    check(`${label}: core edit survives`, storeMod.state.recurrences.some(r => r.id === "during-backup"));
    check(`${label}: backup remains once`, calls.snapshotCalls === 1);
    check(`${label}: normalize failure exercised`, normalizeThrows === (outcome === "normalize-throw" ? 1 : 0));
    check(`${label}: remote collection applied`, storeMod.state.tasks.some(t => t.id === "task-b"));
    check(`${label}: expected caller branch`, outcome === "success"
      ? !syncMod._syncBanner && calls.toast.includes("他端末の記録を取り込みました(自動マージ)")
      : !!syncMod._syncBanner && !calls.toast.includes("他端末の記録を取り込みました(自動マージ)"));
  }
  console.log(failures === 0 ? "\nv364: 全チェック通過" : `\nv364: ${failures}件失敗`);
}

run().then(() => process.exit(failures === 0 ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
