// v262: 12WY Block進捗トーストのB-7全13経路、保存3回、日報、WBS UI/CSS、Service Workerを検証する。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const trackUiSource = fs.readFileSync(path.join(ROOT, "src", "features", "track-ui.js"), "utf8");
const indexSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const cssSource = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
// v265: CACHE_NAME期待値をreleases最大版から導出(v255と同方式。リリースごとの追従漏れでCIが割れるクラスの根絶)
const maxRelease = Math.max(...fs.readdirSync(path.join(ROOT, "releases")).map((f) => /^v(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number));
const PORT = randomPort();
const TODAY = "2026-08-25", CYCLE = "2026-08-15", NOW = `${TODAY}T10:00:00`;
// 監督者裁定: recordTrackMeasurement 1 + generateReport quiet 1 + saveAndRender 1。
const SUCCESS_SAVE_CALLS = 3;
let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}
function sourceOf(name) {
  const start = appSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} source marker not found`);
  const openParen = appSource.indexOf("(", start);
  let parenDepth = 0, closeParen = -1;
  for (let i = openParen; i < appSource.length; i++) {
    if (appSource[i] === "(") parenDepth++;
    else if (appSource[i] === ")" && --parenDepth === 0) { closeParen = i; break; }
  }
  const brace = appSource.indexOf("{", closeParen);
  let depth = 0;
  for (let i = brace; i < appSource.length; i++) {
    if (appSource[i] === "{") depth++;
    else if (appSource[i] === "}" && --depth === 0) return appSource.slice(start, i + 1);
  }
  throw new Error(`${name} closing brace not found`);
}
function escapeHTML(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

class FakeInput {
  constructor(value = "") {
    this.value = value;
    this.classes = new Set();
    this.classList = { add: (name) => this.classes.add(name) };
  }
}
class FakeToast {
  constructor() { this.reset(); }
  reset() { this.hidden = true; this._html = ""; this.input = null; }
  set innerHTML(value) {
    this._html = value;
    const match = /data-twy-toast-other-input[^>]*|<input[^>]*data-twy-toast-other-input[^>]*>/i.exec(value);
    if (match) this.input = new FakeInput((/value="([^"]*)"/.exec(value) || [])[1] || "");
    else this.input = null;
  }
  get innerHTML() { return this._html; }
  querySelector(selector) { return selector === "[data-twy-toast-other-input]" ? this.input : null; }
}

(async () => {
  const toast = new FakeToast();
  const timers = new Map();
  let timerSeq = 0;
  const realSetTimeout = global.setTimeout, realClearTimeout = global.clearTimeout;
  global.document = { querySelector: (selector) => selector === "#trackToast" ? toast : null };
  global.setTimeout = (callback, ms) => {
    const id = ++timerSeq;
    timers.set(id, { callback, ms });
    return id;
  };
  global.clearTimeout = (id) => timers.delete(id);

  const store = await import(pathToFileURL(path.join(ROOT, "src", "state", "store.js")).href);
  const actions = await import(pathToFileURL(path.join(ROOT, "src", "ui", "actions.js")).href);
  const trackUi = await import(pathToFileURL(path.join(ROOT, "src", "features", "track-ui.js")).href);
  let today = TODAY;
  let saveCalls, reportCalls, renderCalls, recordCalls, forceRecordFailure;

  const project = (extra = {}) => ({ id: "p1", title: "P", status: "active",
    twelveWeekStartDate: CYCLE, deleted: false, ...extra });
  const task = (extra = {}) => ({ id: "task1", projectId: "p1", deleted: false, ...extra });
  const block = (extra = {}) => ({ id: "block1", taskId: "task1", deleted: false, ...extra });
  const track = (extra = {}) => ({ id: "track1", ownerType: "project", ownerId: "p1",
    cycleStartDate: CYCLE, kind: "numeric", name: "読書", unit: "章", baselineValue: 0,
    goalValue: 20, valueStep: 2, status: "active", createdAt: NOW, deleted: false, ...extra });
  function stateFixture({ projectExtra = {}, taskExtra = {}, blockExtra = {}, trackExtra = {},
    settingsExtra = {}, tracks } = {}) {
    const nextTrack = track(trackExtra);
    return {
      settings: { twelveWeekStartDate: CYCLE, ...settingsExtra }, projects: [project(projectExtra)],
      tasks: [task(taskExtra)], blocks: [block(blockExtra)],
      tracks: tracks === undefined ? [nextTrack] : tracks, trackMeasurements: [{
        id: "before", trackId: nextTrack.id, value: 10, observedAt: `${TODAY}T09:00:00`,
        updatedAt: `${TODAY}T09:00:00`, deleted: false
      }], _trackToastLog: {}
    };
  }
  function reset(options = {}) {
    timers.clear();
    toast.reset();
    today = TODAY;
    saveCalls = 0; reportCalls = []; renderCalls = []; recordCalls = [];
    forceRecordFailure = false;
    const nextState = stateFixture(options);
    store.setState(nextState);
    trackUi.configureTrackUi({
      escapeHTML, todayISO: () => today,
      recordTrackMeasurement: (trackId, value, opts) => {
        recordCalls.push({ trackId, value, opts });
        const active = nextState.tracks.find((entry) => entry.id === trackId && entry.status === "active"
          && !entry.deleted && entry.kind === "numeric");
        if (forceRecordFailure || !active) return { ok: false, errors: ["対象なし"] };
        const measurement = { id: `after-${recordCalls.length}`, trackId, value, observedAt: NOW,
          updatedAt: NOW, deleted: false, ...opts };
        nextState.trackMeasurements.push(measurement);
        saveCalls += 1;
        return { ok: true, measurement };
      },
      generateReport: (...args) => { reportCalls.push(args); saveCalls += 1; },
      saveAndRender: (message) => { renderCalls.push(message); saveCalls += 1; }
    });
    return nextState;
  }
  function actionTarget(action, overrides = {}) {
    const marker = `data-action="${action}"`;
    const markerAt = toast.innerHTML.indexOf(marker);
    const tagAt = toast.innerHTML.lastIndexOf("<button", markerAt);
    const end = toast.innerHTML.indexOf(">", markerAt);
    const tag = markerAt >= 0 ? toast.innerHTML.slice(tagAt, end) : "";
    const dataset = {};
    for (const match of tag.matchAll(/data-([a-z0-9-]+)="([^"]*)"/g)) {
      const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      dataset[key] = match[2];
    }
    return { dataset: { ...dataset, ...overrides } };
  }
  function dispatch(action, target = actionTarget(action)) {
    return actions.dispatchAction(action, { target, event: { type: "click" }, id: "" });
  }
  function runTimers() {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach(({ callback }) => callback());
  }
  function show(blockToShow = store.state.blocks[0]) { trackUi.maybeShowTrackProgressToast(blockToShow); }

  try {
    console.log("[1] B-7 #1〜#9: 表示・全ボタン・消滅・同日抑止");
    let state = reset();
    show();
    check("B-7 #1 対象完了で表示し、表示時点で当日ログをメモリ記録", !toast.hidden
      && state._trackToastLog.track1 === TODAY && timers.size === 1 && [...timers.values()][0].ms === 8000);
    check("E-3 表示だけではsaveState 0回", saveCalls === 0);

    state = reset(); show(); dispatch("twy-toast-inc");
    check("B-7 #2 +stepは絶対値12・toast/blockIdで記録", recordCalls[0]?.value === 12
      && recordCalls[0]?.opts.sourceKind === "toast" && recordCalls[0]?.opts.blockId === "block1");
    check("+step成功はquiet日報1回・保存3回・閉じてrender", reportCalls.length === 1
      && reportCalls[0][0] === TODAY && reportCalls[0][1]?.quiet === true
      && saveCalls === SUCCESS_SAVE_CALLS && toast.hidden && renderCalls[0] === "記録しました");

    state = reset(); state.trackMeasurements[0].value = 12.5; show();
    check("P2 非整合latestはゼロ基点へ丸めず12.5+2=14.5", toast.innerHTML.includes(">14.5章まで進んだ</button>"));
    dispatch("twy-toast-inc");
    check("非整合latestの+1step絶対値を記録", recordCalls[0]?.value === 14.5);

    state = reset({ trackExtra: { goalValue: 1, valueStep: 0.1 } });
    state.trackMeasurements[0].value = 0.2; show(); dispatch("twy-toast-inc");
    check("小数stepは浮動小数ノイズなしで0.2+0.1=0.3", recordCalls[0]?.value === 0.3);

    state = reset({ trackExtra: { goalValue: 1, valueStep: "1e-7" } });
    state.trackMeasurements[0].value = 2e-7; show();
    check("指数表記stepも小数桁へ展開して厳密に加算", toast.innerHTML.includes(">0.0000003章まで進んだ</button>"));
    dispatch("twy-toast-inc");
    check("指数表記stepの次値を記録", recordCalls[0]?.value === 3e-7);

    state = reset(); show(); dispatch("twy-toast-same");
    check("B-7 #3 変化なしはlatest同値10を鮮度更新として記録", recordCalls[0]?.value === 10);
    check("同値成功もquiet日報1回・保存3回", reportCalls.length === 1 && saveCalls === SUCCESS_SAVE_CALLS);

    state = reset(); show(); dispatch("twy-toast-other");
    check("B-7 #4 その他はトースト内number入力へ展開", !toast.hidden
      && toast.innerHTML.includes('type="number"') && toast.innerHTML.includes('inputmode="decimal"'));
    runTimers();
    check("その他展開で8秒タイマー解除・測定なし・開いたまま", timers.size === 0
      && recordCalls.length === 0 && !toast.hidden);

    toast.input.value = "12.5"; dispatch("twy-toast-other-confirm");
    check("B-7 #5 その他正常値をそのまま記録", recordCalls[0]?.value === 12.5
      && recordCalls[0]?.opts.blockId === "block1");
    check("その他成功もquiet日報1回・保存3回", reportCalls.length === 1 && saveCalls === SUCCESS_SAVE_CALLS);

    for (const raw of ["", "not-number"]) {
      state = reset(); show(); dispatch("twy-toast-other"); toast.input.value = raw;
      dispatch("twy-toast-other-confirm");
      check(`B-7 #6 その他「${raw || "空欄"}」はエラー・記録せず開いたまま`, !toast.hidden
        && toast.input.classes.has("is-error") && recordCalls.length === 0 && reportCalls.length === 0 && saveCalls === 0);
    }

    state = reset(); show(); dispatch("twy-toast-later");
    check("B-7 #7 閉じるは測定・日報・保存なし", toast.hidden
      && recordCalls.length === 0 && reportCalls.length === 0 && saveCalls === 0);
    state = reset(); show(); dispatch("twy-toast-other"); dispatch("twy-toast-later");
    check("B-7 #7 その他展開後も閉じるは同じ非保存契約", toast.hidden && saveCalls === 0);

    state = reset(); show(); state.blocks = []; dispatch("twy-toast-other");
    check("L-3 block再検索なしでもその他入力を展開", toast.input !== null);
    state = reset(); show(); state.tracks[0].status = "closed"; dispatch("twy-toast-other");
    check("L-3 展開時にもactive numericを再検証", toast.input === null && recordCalls.length === 0);

    state = reset(); show(); runTimers();
    check("B-7 #8 8秒自動消滅は測定・日報・保存なし", toast.hidden
      && recordCalls.length === 0 && reportCalls.length === 0 && saveCalls === 0);

    state = reset(); show(); dispatch("twy-toast-later"); show();
    check("B-7 #9 同一track同日2回目は再表示しない", toast.hidden && timers.size === 0);

    state = reset(); show(); dispatch("twy-toast-other"); toast.input.value = "12.5";
    const editingInput = toast.input;
    state.projects.push(project({ id: "p2", title: "P2" }));
    state.tasks.push(task({ id: "task2", projectId: "p2" }));
    state.blocks.push(block({ id: "block2", taskId: "task2" }));
    state.tracks.push(track({ id: "track2", ownerId: "p2" }));
    state.trackMeasurements.push({ id: "before2", trackId: "track2", value: 5,
      observedAt: `${TODAY}T09:30:00`, updatedAt: `${TODAY}T09:30:00`, deleted: false });
    show(state.blocks[1]);
    check("M-2 その他入力中の別track発火は入力を維持しログ未スタンプ", toast.input === editingInput
      && toast.input.value === "12.5" && state._trackToastLog.track2 === undefined);
    dispatch("twy-toast-later"); show(state.blocks[1]);
    check("M-2 ガード後は別trackトーストを再発火可能", !toast.hidden
      && state._trackToastLog.track2 === TODAY && toast.input === null);

    global.document.querySelector = () => null;
    state = reset(); show();
    check("L-2 #trackToast不在時は表示ログをスタンプしない", state._trackToastLog.track1 === undefined);
    global.document.querySelector = (selector) => selector === "#trackToast" ? toast : null;
    state = reset(); delete state._trackToastLog; show();
    check("L-1 日次ログ欠落時も初期化して表示", state._trackToastLog?.track1 === TODAY && !toast.hidden);

    console.log("[2] B-7 #10〜#13: 全負例・interactive契約・方向・日跨ぎ");
    const negativeCases = [
      ["非12WY", { projectExtra: { twelveWeekStartDate: "" } }],
      ["前サイクル", { projectExtra: { twelveWeekStartDate: "2026-08-14" } }],
      ["12WY未設定", { settingsExtra: { twelveWeekStartDate: "" } }],
      ["milestone型", { trackExtra: { kind: "milestone" } }],
      ["activeトラック無し(closedのみ)", { tracks: [track({ status: "closed" })] }],
      ["非active project", { projectExtra: { status: "suspended" } }]
    ];
    for (const [label, options] of negativeCases) {
      state = reset(options); show();
      check(`B-7 #10 ${label}は発火しない`, toast.hidden && Object.keys(state._trackToastLog).length === 0);
    }
    for (const valueStep of [0, "", "not-number"]) {
      state = reset({ trackExtra: { valueStep } }); show();
      check(`M-1 valueStep=${JSON.stringify(valueStep)}は進んだボタン非表示`,
        !toast.innerHTML.includes('data-action="twy-toast-inc"'));
      dispatch("twy-toast-inc");
      check(`M-1 valueStep=${JSON.stringify(valueStep)}のtap経路も記録しない`, recordCalls.length === 0);
    }

    const completionRoutes = {
      bulkApproveAsPlanned: false, saveActualEntryFromModal: false,
      saveBlockFromModal: false, approveAiWorkResult: false
    };
    for (const [name, interactive] of Object.entries(completionRoutes)) {
      const source = sourceOf(name);
      check(`B-7 #11 ${name}はinteractive:falseで共通フックへ結線`, source.includes("trackOnBlockCompletionChanged")
        && new RegExp(`interactive:\\s*${interactive}`).test(source));
    }
    const hookSource = sourceOf("trackOnBlockCompletionChanged");
    const hookCalls = [];
    const hookSandbox = {
      autoCommitWeekIfNeeded: () => hookCalls.push("auto"),
      stampCommitmentCompletion: () => hookCalls.push("stamp"),
      maybeShowTrackProgressToast: () => hookCalls.push("toast")
    };
    vm.createContext(hookSandbox);
    vm.runInContext(hookSource, hookSandbox);
    hookSandbox.trackOnBlockCompletionChanged({}, false, { interactive: true });
    hookSandbox.trackOnBlockCompletionChanged({}, true, { interactive: false });
    check("完了取消・非interactiveはトースト判定を呼ばない", !hookCalls.includes("toast"));

    state = reset({ trackExtra: { baselineValue: 20, goalValue: 0, valueStep: 2 } }); show();
    check("B-7 #12 減少目標はラベルもlatest 10→8方向", toast.innerHTML.includes(">8章まで進んだ</button>"));
    dispatch("twy-toast-inc");
    check("減少目標は8の絶対値measurementを記録", recordCalls[0]?.value === 8);

    state = reset(); show(); dispatch("twy-toast-later"); today = "2026-08-26"; show();
    check("B-7 #13 日付跨ぎは同一trackでも再発火", !toast.hidden
      && state._trackToastLog.track1 === "2026-08-26");

    console.log("[3] stale安全・escapeHTML・DOM/CSS/SW・#5/#9/#10非干渉");
    state = reset(); show(); forceRecordFailure = true; dispatch("twy-toast-inc");
    check("staleウィンドウの{ok:false}は例外なし・日報/render/保存なし・開いたまま", !toast.hidden
      && reportCalls.length === 0 && renderCalls.length === 0 && saveCalls === 0);

    const xss = '\"><img src=x data-v262-breached="';
    state = reset({ blockExtra: { id: xss }, trackExtra: {
      id: xss, name: xss, unit: xss, valueStep: xss
    } });
    show();
    const normalXssHTML = toast.innerHTML;
    dispatch("twy-toast-other", { dataset: { twyToastTrackId: xss, twyToastBlockId: xss } });
    check("D-2 track.name/unit/id/block.id/valueStepを全escapeHTML", !normalXssHTML.includes("<img")
      && !toast.innerHTML.includes("<img") && normalXssHTML.includes(escapeHTML(xss))
      && toast.innerHTML.includes(escapeHTML(xss)));
    check("閉じるaria-labelは追補#1どおり", toast.innerHTML.includes('aria-label="閉じる"'));

    check("#trackToastは#app/#modalRoot外で既存#toast直後の独立要素", indexSource.indexOf('id="trackToast"')
      > indexSource.indexOf('id="toast"') && indexSource.indexOf('id="trackToast"') > indexSource.indexOf('id="modalRoot"'));
    check("専用CSSは44pxタップ・number 16px・#toastと異なるbottom", /\.twy-toast button\s*\{[^}]*min-height:\s*44px[^}]*min-width:\s*44px/s.test(cssSource)
      && /\.twy-toast input\s*\{[^}]*font-size:\s*16px/s.test(cssSource)
      && /\.toast\s*\{[^}]*bottom:\s*18px/s.test(cssSource)
      && /\.twy-toast\s*\{[^}]*bottom:\s*calc\(96px/s.test(cssSource));
    check("L-7 その他入力は既存input classと太枠・背景のエラー表現を使う",
      trackUiSource.includes('class="input"')
      && /\.twy-toast input\.is-error\s*\{[^}]*border:\s*2px[^}]*background:\s*var\(--red-soft\)/s.test(cssSource));
    check(`SWはtrack-uiをAPP_SHELL登録し現行CACHE_NAMEがreleases最大版v${maxRelease}と一致`, swSource.includes('"./src/features/track-ui.js"')
      && new RegExp(`^const CACHE_NAME = "taskchute-journal-pwa-v${maxRelease}";`, "m").test(swSource));

    check("app.js配線はimport+configure+スタブ削除+共通フック1行置換", appSource.includes(
      'import { configureTrackUi, maybeShowTrackProgressToast } from "./src/features/track-ui.js";')
      && appSource.includes("configureTrackUi({ escapeHTML, todayISO, saveAndRender, generateReport, recordTrackMeasurement });")
      && !appSource.includes("showTrackProgressToastStub")
      && hookSource.includes("if (interactive && isNowCompleted) maybeShowTrackProgressToast(block);"));
    check("#5フックのauto→stamp→toast順とシグネチャは不変", /function trackOnBlockCompletionChanged\(block, isNowCompleted, \{ interactive = false \} = \{\}\)/.test(hookSource)
      && hookSource.indexOf("autoCommitWeekIfNeeded") < hookSource.indexOf("stampCommitmentCompletion")
      && hookSource.indexOf("stampCommitmentCompletion") < hookSource.indexOf("maybeShowTrackProgressToast"));
    check("既存quiet日報7箇所(#10の1+従来6)を維持し、#11はfeature内1箇所だけ追加",
      (appSource.match(/generateReport\([^\n]+\{ quiet: true \}\)/g) || []).length === 7
      && (trackUiSource.match(/generateReport\(todayISO\(\), \{ quiet: true \}\)/g) || []).length === 1);
    check("#9/#10所有関数をtrack-uiへ複製せずrecordTrackMeasurementをDI再利用", appSource.includes("function renderTwyTrackRow(track)")
      && appSource.includes("function recordTrackMeasurement(trackId, value,")
      && !trackUiSource.includes("state.trackMeasurements =") && !trackUiSource.includes("function recordTrackMeasurement("));
    check("track-uiは個別addEventListener/new Date文字列パースを追加しない", !trackUiSource.includes("addEventListener")
      && !/new Date\s*\(\s*[`'"]/.test(trackUiSource));
  } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }

  console.log("[4] 実ブラウザE2E: interactive完了→トースト→測定→WBS→同日抑止");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);
  try {
    await page.clock.setFixedTime(new Date(2026, 7, 25, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.evaluate(({ key, today, cycle, now }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "wbs";
      state.selectedDate = today;
      state.settings.twelveWeekStartDate = cycle;
      state.projects = [{ id: "p-e2e", kind: "normal", title: "E2E Project", status: "active",
        priority: "中", category: "", startDate: cycle, dueDate: "", description: "",
        twelveWeekStartDate: cycle, showProgress: false, collapsed: false,
        createdAt: now, updatedAt: now, deleted: false }];
      state.tasks = [{ id: "task-e2e", projectId: "p-e2e", parentTaskId: "", title: "読む",
        status: "todo", progressNum: 0, progressDen: 10, createdAt: now, updatedAt: now, deleted: false }];
      state.blocks = [{ id: "block-e2e", taskId: "task-e2e", title: "読む", category: "仕事", date: today,
        plannedStartAt: `${today}T09:00:00`, plannedEndAt: `${today}T09:30:00`, actualStartAt: "",
        actualEndAt: "", completed: false, charge: 0, discharge: 0, recurrenceGroupId: "",
        migratedTo: "", createdAt: now, updatedAt: now, deleted: false }];
      state.tracks = [{ id: "track-e2e", ownerType: "project", ownerId: "p-e2e", cycleStartDate: cycle,
        kind: "numeric", name: "読書", unit: "章", startDate: cycle, deadline: "2026-10-01",
        baselineValue: 0, goalValue: 20, valueStep: 2, milestones: [], status: "active", closedAt: "",
        closedReason: "", supersedesTrackId: "", carriedFromTrackId: "", createdAt: now,
        updatedAt: now, deleted: false }];
      state.trackMeasurements = [{ id: "before-e2e", trackId: "track-e2e", value: 10,
        observedAt: `${today}T09:00:00`, sourceKind: "wbs", blockId: "", note: "",
        createdAt: now, updatedAt: now, deleted: false }];
      state.weeklyCommitments = [];
      state._trackToastLog = {};
      state.recurrences = [];
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY, cycle: CYCLE, now: NOW });
    await page.reload();
    await page.waitForSelector('.twy-row[data-twy-track-id="track-e2e"]');
    const toggle = () => page.evaluate(() => {
      const button = document.createElement("button");
      button.dataset.action = "toggle-block";
      button.dataset.id = "block-e2e";
      document.body.appendChild(button);
      button.click();
      button.remove();
    });
    await toggle();
    await page.waitForSelector("#trackToast:not([hidden])");
    check("interactive完了で専用トーストが実DOM表示", (await page.locator("#trackToast").innerText()).includes("12章まで進んだ"));
    check("既存#toastと#trackToastが同時表示して内容を保持", (await page.locator("#toast").innerText()).trim().length > 0
      && (await page.locator("#trackToast").innerText()).includes("TRACK"));
    const inc = page.locator('#trackToast [data-action="twy-toast-inc"]');
    check("実ブラウザでもトーストボタンのタップ領域44px以上", await inc.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width >= 44 && rect.height >= 44;
    }));
    await inc.click();
    await page.waitForFunction(() => document.querySelector("#trackToast")?.hidden === true);
    const after = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    const recorded = after.trackMeasurements.find((entry) => entry.sourceKind === "toast");
    check("1タップで絶対値12・blockId付きmeasurementを永続化", recorded?.value === 12
      && recorded.blockId === "block-e2e" && recorded.trackId === "track-e2e");
    check("saveAndRender後にWBS現在値が12/20章へ更新", (await page.locator(
      '.twy-row[data-twy-track-id="track-e2e"] .twy-val').innerText()).replace(/\s/g, "") === "12/20章");
    await toggle();
    await toggle();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).blocks
      .find((entry) => entry.id === "block-e2e")?.completed === true, STATE_KEY);
    check("実ブラウザでも同日2回目は再表示しない", await page.locator("#trackToast:not([hidden])").count() === 0);
    check("390pxで専用トーストが外側横スクロールを作らない", await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\nv262: 全件成功" : `\nv262: ${failures}件失敗`);
  if (failures) process.exit(1);
})().catch((error) => { console.error(error); process.exit(1); });
