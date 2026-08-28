// v254: 12WY共通フック2本の全開始・完了導線結線。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const trackUiSource = fs.readFileSync(path.join(ROOT, "src", "features", "track-ui.js"), "utf8");
const PORT = randomPort();
const KEY = STATE_KEY;
let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function functionSource(name) {
  const start = appSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} source marker not found`);
  const brace = appSource.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < appSource.length; i++) {
    if (appSource[i] === "{") depth++;
    else if (appSource[i] === "}" && --depth === 0) return appSource.slice(start, i + 1);
  }
  throw new Error(`${name} closing brace not found`);
}

const instrumentedAppSource = appSource
  .replace("function saveState() {", `function saveState() {
  globalThis.__v254SaveCalls?.push("save");
  globalThis.__v254HookOrder?.push("save");`)
  .replace("function trackOnBlockStarted(block) {", `function trackOnBlockStarted(block) {
  globalThis.__v254StartCalls?.push(block?.id || "");
  globalThis.__v254HookOrder?.push("start");`)
  .replace(
    "function trackOnBlockCompletionChanged(block, isNowCompleted, { interactive = false } = {}) {",
    `function trackOnBlockCompletionChanged(block, isNowCompleted, { interactive = false } = {}) {
  globalThis.__v254CompletionCalls?.push({ blockId: block?.id || "", isNowCompleted, interactive });
  globalThis.__v254HookOrder?.push("completion");`
  )
  .replace(
    /  cachedAiWorkResults = items;\r?\n  return changed;/,
    "  cachedAiWorkResults = items;\n  globalThis.__v254AiWorkResults = items.map((item) => ({ ...item }));\n  return changed;"
  );
const instrumentedTrackUiSource = trackUiSource.replace(
  "function maybeShowTrackProgressToast(block) {",
  `function maybeShowTrackProgressToast(block) {
  globalThis.__v254ToastCalls?.push(block?.id || "");
  globalThis.__v254HookOrder?.push("toast");`
);

console.log("[0] 共通フック契約と全経路の機械検査");
{
  const hookStart = appSource.indexOf("function trackOnBlockStarted(");
  const hookEnd = appSource.indexOf("function excuseCommitmentItem(", hookStart);
  const calls = [];
  const hookSource = `function maybeShowTrackProgressToast(block) { calls.push(\`toast:\${block.id}\`); }\n`
    + appSource.slice(hookStart, hookEnd);
  const sandbox = {
    calls,
    autoCommitWeekIfNeeded: (block) => calls.push(`auto:${block.id}`),
    stampCommitmentCompletion: (block, completed) => calls.push(`stamp:${block.id}:${completed}`)
  };
  vm.createContext(sandbox);
  vm.runInContext(hookSource, sandbox);
  sandbox.trackOnBlockStarted({ id: "started" });
  check("開始フックは自動確定だけ", calls.join("|") === "auto:started", calls.join("|"));
  calls.length = 0;
  sandbox.trackOnBlockCompletionChanged({ id: "interactive" }, true, { interactive: true });
  check("interactive完了はauto→stamp→進捗トースト判定順",
    calls.join("|") === "auto:interactive|stamp:interactive:true|toast:interactive", calls.join("|"));
  calls.length = 0;
  sandbox.trackOnBlockCompletionChanged({ id: "cancel" }, false, { interactive: true });
  check("完了取消は進捗トースト判定を呼ばない",
    calls.join("|") === "auto:cancel|stamp:cancel:false", calls.join("|"));
  calls.length = 0;
  sandbox.trackOnBlockCompletionChanged({ id: "batch" }, true, { interactive: false });
  check("非interactive完了は進捗トースト判定を呼ばない",
    calls.join("|") === "auto:batch|stamp:batch:true", calls.join("|"));

  const completionRoutes = {
    toggleBlock: true,
    toggleTaskCompleteFromBlock: true,
    completePomodoro: true,
    finishBlockFromBreak: true,
    bulkApproveAsPlanned: false,
    saveActualEntryFromModal: false,
    saveBlockFromModal: false,
    approveAiWorkResult: false
  };
  for (const [name, interactive] of Object.entries(completionRoutes)) {
    const source = functionSource(name);
    check(`${name}が完了フックへ結線`, source.includes("trackOnBlockCompletionChanged"));
    check(`${name}のinteractive=${interactive}`,
      new RegExp(`interactive:\\s*${interactive}`).test(source));
  }
  for (const name of ["setBlockTime", "startPomodoro", "saveBlockFromModal", "saveActualEntryFromModal"]) {
    check(`${name}が開始フックへ結線`, functionSource(name).includes("trackOnBlockStarted"));
  }
  check("restore系は共通フック対象外", !/trackOnBlock(?:Started|CompletionChanged)/.test(functionSource("restoreBackup")));
  check("IRON LOG転記は共通フック対象外", !/trackOnBlock(?:Started|CompletionChanged)/.test(functionSource("transferIronLogToCompletedBlock")));
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 768, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);
  await page.route((url) => url.pathname.endsWith("/app.js"), (route) => route.fulfill({
    status: 200, contentType: "text/javascript", body: instrumentedAppSource
  }));
  await page.route((url) => url.pathname.endsWith("/src/features/track-ui.js"), (route) => route.fulfill({
    status: 200, contentType: "text/javascript", body: instrumentedTrackUiSource
  }));

  let aiWorkFixture = null;
  await page.route((url) => /\/AI作業結果_.*\.json$/.test(decodeURIComponent(url.pathname)), (route) => {
    if (aiWorkFixture === null) return route.fulfill({ status: 404, body: "not found (v254 fixture)" });
    return route.fulfill({ status: 200, contentType: "application/json", body: aiWorkFixture });
  });

  const now = new Date();
  now.setHours(10, 0, 0, 0);
  const pad2 = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const addDays = (value, delta) => {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + delta);
    return iso(date);
  };
  const TODAY = iso(now);
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const WEEK_START = addDays(TODAY, -((day.getDay() + 1) % 7));
  const CYCLE_START = addDays(TODAY, -30);
  const OLD = `${TODAY}T01:00:00`;

  const project = (id = "p1", extra = {}) => ({
    id, kind: "normal", title: id, status: "active", twelveWeekStartDate: CYCLE_START,
    createdAt: OLD, updatedAt: OLD, deleted: false, ...extra
  });
  const task = (id = "t1", projectId = "p1", extra = {}) => ({
    id, projectId, title: id, status: "todo", progressNum: 0, progressDen: 1,
    createdAt: OLD, updatedAt: OLD, deleted: false, ...extra
  });
  const block = (id, extra = {}) => ({
    id, taskId: "t1", title: id, category: "仕事", date: TODAY,
    plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
    actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
    recurrenceGroupId: "", migratedTo: "", createdAt: OLD, updatedAt: OLD, deleted: false, ...extra
  });
  const weekMeta = (weekStart = WEEK_START) => ({
    id: `wcw_${weekStart}`, recordType: "week", weekStart,
    cycleStartDate: CYCLE_START, committedAt: OLD, committedVia: "manual", selectedBlockIds: [],
    createdAt: OLD, updatedAt: OLD, deleted: false
  });
  const item = (blockId, extra = {}, weekStart = WEEK_START) => ({
    id: `wci_${weekStart}_${blockId}`, recordType: "item", weekStart,
    blockId, taskId: "t1", projectId: "p1", trackId: "", title: blockId,
    plannedDate: TODAY, source: "confirmed", lane: "cycle", excused: false,
    excusedReason: "", excusedChangedAt: "", completedAt: "", completedChangedAt: "",
    createdAt: OLD, updatedAt: OLD, deleted: false, ...extra
  });
  const recurrence = (id, title, extra = {}) => ({
    id, title, category: "ルーティン", taskId: "t1", kind: "daily",
    startTime: "09:00:00", endTime: "09:30:00", anchorDate: TODAY,
    expectedCharge: 1, expectedDischarge: 1, source: "", exceptionDates: [],
    createdAt: OLD, updatedAt: OLD, deleted: false, ...extra
  });

  async function seed({
    blocks = [], tasks = [task()], projects = [project()], weeklyCommitments = [], recurrences = [],
    settings = {}, pomodoro = null, view = "timeline"
  } = {}) {
    aiWorkFixture = null;
    await page.goto(`http://localhost:${PORT}/styles.css`);
    await page.evaluate(({ KEY, blocks, tasks, projects, weeklyCommitments, recurrences, settings, pomodoro, view, TODAY, CYCLE_START, OLD }) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      Object.assign(state, {
        blocks, tasks, projects, weeklyCommitments, recurrences, currentView: view,
        selectedDate: TODAY, timelineMode: "planned", dataModifiedAt: OLD,
        aiWorkProcessedIds: []
      });
      Object.assign(state.settings, {
        twelveWeekStartDate: CYCLE_START, focusTimerAuto: false, pomoGuidedAccessHint: false,
        lastOpenedDate: TODAY,
        ...settings
      });
      if (pomodoro) state.pomodoro = pomodoro;
      localStorage.setItem(KEY, JSON.stringify(state));
    }, { KEY, blocks, tasks, projects, weeklyCommitments, recurrences, settings, pomodoro, view, TODAY, CYCLE_START, OLD });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector(view === "timeline" ? ".timeline" : "#app");
  }

  const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
  const resetHookSpies = () => page.evaluate(() => {
    globalThis.__v254StartCalls = [];
    globalThis.__v254CompletionCalls = [];
    globalThis.__v254ToastCalls = [];
    globalThis.__v254SaveCalls = [];
    globalThis.__v254HookOrder = [];
  });
  const hookSpies = () => page.evaluate(() => ({
    starts: globalThis.__v254StartCalls || [],
    completions: globalThis.__v254CompletionCalls || [],
    toasts: globalThis.__v254ToastCalls || [],
    saves: globalThis.__v254SaveCalls || [],
    order: globalThis.__v254HookOrder || []
  }));
  async function clickAction(action, dataset = {}) {
    await page.evaluate(({ action, dataset }) => {
      const button = document.createElement("button");
      button.dataset.action = action;
      Object.assign(button.dataset, dataset);
      document.body.appendChild(button);
      button.click();
    }, { action, dataset });
  }
  async function stamped(blockId) {
    return page.evaluate(({ KEY, WEEK_START, blockId }) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      return state.weeklyCommitments.find((entry) => entry.id === `wci_${WEEK_START}_${blockId}`) || null;
    }, { KEY, WEEK_START, blockId });
  }
  async function waitForStamp(blockId) {
    return page.waitForFunction(({ KEY, WEEK_START, blockId }) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      return Boolean(state.weeklyCommitments.find((entry) =>
        entry.id === `wci_${WEEK_START}_${blockId}` && entry.completedAt));
    }, { KEY, WEEK_START, blockId }, { timeout: 5000 }).then(() => true).catch(() => false);
  }
  async function assertCompletionRoute(label, blockId, interactive, expectedSaveCalls) {
    await page.waitForFunction((blockId) => (globalThis.__v254CompletionCalls || [])
      .some((call) => call.blockId === blockId), blockId);
    const state = await stored();
    const record = state.weeklyCommitments.find((entry) => entry.id === `wci_${WEEK_START}_${blockId}`);
    const spies = await hookSpies();
    const routeCalls = spies.completions.filter((call) => call.blockId === blockId);
    check(`${label}: 完了フックを1回呼ぶ`, routeCalls.length === 1, JSON.stringify(spies));
    check(`${label}: interactive=${interactive}`,
      routeCalls[0]?.interactive === interactive && routeCalls[0]?.isNowCompleted === true,
      JSON.stringify(routeCalls));
    check(`${label}: interactive経路だけ進捗トースト判定を1回呼ぶ`,
      spies.toasts.filter((id) => id === blockId).length === (interactive ? 1 : 0), JSON.stringify(spies));
    check(`${label}: saveState呼び出し回数`, spies.saves.length === expectedSaveCalls,
      JSON.stringify(spies.order));
    const completionIndex = spies.order.indexOf("completion");
    check(`${label}: 保存確定後にフック、刻印後にも保存`,
      spies.order.slice(0, completionIndex).includes("save")
        && spies.order.slice(completionIndex + 1).includes("save"), JSON.stringify(spies.order));
    check(`${label}: completedChangedAt/item.updatedAt/dataModifiedAtを同時刻で永続化`,
      Boolean(record?.completedChangedAt) && record.completedChangedAt === record.updatedAt
        && record.updatedAt === state.dataModifiedAt && record.updatedAt > OLD,
      JSON.stringify({ record, dataModifiedAt: state.dataModifiedAt }));
    return record;
  }
  async function runCommittedCompletion(label, blockId, interactive, expectedSaveCalls, action, extra = {}) {
    await seed({
      blocks: [block(blockId, extra.block || {})],
      tasks: [task("t1", "p1", extra.task || {})],
      weeklyCommitments: [weekMeta(), item(blockId)],
      pomodoro: extra.pomodoro || null
    });
    await resetHookSpies();
    await action();
    const didStamp = await waitForStamp(blockId);
    check(`${label}で当週itemを刻印`, didStamp, JSON.stringify(await stored()));
    return assertCompletionRoute(label, blockId, interactive, expectedSaveCalls);
  }

  try {
    await page.clock.setFixedTime(now);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] 完了8経路を個別に刻印");
    await runCommittedCompletion("toggleBlock", "toggle", true, 4,
      () => clickAction("toggle-block", { id: "toggle" }));
    await clickAction("toggle-block", { id: "toggle" });
    await page.waitForFunction(({ KEY, WEEK_START }) => !JSON.parse(localStorage.getItem(KEY)).weeklyCommitments
      .find((entry) => entry.id === `wci_${WEEK_START}_toggle`)?.completedAt, { KEY, WEEK_START });
    check("toggleBlock完了取消で刻印を解除", (await stamped("toggle"))?.completedAt === "");

    await runCommittedCompletion("toggleTaskCompleteFromBlock", "task-route", true, 4,
      () => clickAction("toggle-task-complete", { id: "task-route" }));
    await runCommittedCompletion("completePomodoro", "pomo-route", true, 4, async () => {
      await clickAction("complete-pomodoro");
      await page.locator('[data-action="report-skip"]').click();
    }, { pomodoro: { running: true, blockId: "pomo-route", startedAt: `${TODAY}T10:00:00`, endsAt: `${TODAY}T10:50:00`, mode: "focus" } });
    await runCommittedCompletion("finishBlockFromBreak", "break-route", true, 3,
      () => clickAction("finish-block"), {
        pomodoro: { running: true, blockId: "", lastFocusBlockId: "break-route", startedAt: `${TODAY}T10:00:00`, endsAt: `${TODAY}T10:05:00`, mode: "break" }
      });
    await runCommittedCompletion("bulkApproveAsPlanned", "bulk-route", false, 4, async () => {
      page.once("dialog", (dialog) => dialog.accept());
      await clickAction("bulk-approve-planned");
    });
    await runCommittedCompletion("saveActualEntryFromModal", "actual-route", false, 4, async () => {
      await clickAction("complete-block-with-actual", { id: "actual-route" });
      await page.locator('[data-action="modal-save"]').click();
    });
    await runCommittedCompletion("Block編集モーダル完了保存", "block-modal-route", false, 4, async () => {
      await clickAction("edit-block", { id: "block-modal-route" });
      await page.locator('[data-modal-field="completed"]').check();
      await page.locator('[data-action="modal-save"]').click();
    });

    await seed({ blocks: [], weeklyCommitments: [], view: "today" });
    aiWorkFixture = JSON.stringify([
      { taskId: "t1", title: "AI完了経路", status: "completed", summary: "v254", minutes: 30 },
      { taskId: "t2", title: "AI質問経路", status: "blocked", summary: "v254 blocked question", minutes: 0 }
    ]);
    const aiWorkResponse = page.waitForResponse((response) => /\/AI作業結果_.*\.json$/.test(decodeURIComponent(new URL(response.url()).pathname)));
    await page.reload();
    const loadedAiWorkResponse = await aiWorkResponse;
    await loadedAiWorkResponse.finished();
    await page.waitForFunction(() => globalThis.__v254AiWorkResults?.length === 2);
    check("廃止済みAI作業ボタンを本番DOMへ戻さない",
      await page.locator('[data-action="ai-work-approve"], [data-action="ai-work-question"]').count() === 0);
    await resetHookSpies();
    await clickAction("ai-work-approve", { resultId: `${TODAY}__t1` });
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.some((entry) => entry.title === "AI完了経路"), KEY);
    const aiState = await stored();
    const aiBlock = aiState.blocks.find((entry) => entry.title === "AI完了経路");
    const aiItem = aiState.weeklyCommitments.find((entry) => entry.blockId === aiBlock?.id);
    check("approveAiWorkResultで自動確定後に刻印", Boolean(aiItem?.completedAt), JSON.stringify(aiItem));
    await assertCompletionRoute("approveAiWorkResult", aiBlock.id, false, 4);

    await clickAction("ai-work-question", { resultId: `${TODAY}__t2` });
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).questions
      .some((entry) => entry.text === "v254 blocked question"), KEY);
    const questionState = await stored();
    const aiQuestion = questionState.questions.find((entry) => entry.text === "v254 blocked question");
    check("raiseAiWorkQuestionでblocked summaryを問いへ追加", Boolean(aiQuestion), JSON.stringify(questionState.questions));
    check("raiseAiWorkQuestionのoriginはai", aiQuestion?.origin === "ai", JSON.stringify(aiQuestion));
    check("raiseAiWorkQuestionもresultIdを処理済みに記録",
      questionState.aiWorkProcessedIds.includes(`${TODAY}__t2`), JSON.stringify(questionState.aiWorkProcessedIds));

    console.log("[2] 開始3経路を個別に自動確定");
    async function checkAutoCommit(label, blockId, action, { completions = 0 } = {}) {
      await seed({ blocks: [block(blockId)], weeklyCommitments: [] });
      await resetHookSpies();
      await action();
      await page.waitForFunction(({ KEY, WEEK_START }) => JSON.parse(localStorage.getItem(KEY)).weeklyCommitments
        .some((entry) => entry.id === `wcw_${WEEK_START}`), { KEY, WEEK_START });
      const state = await stored();
      const meta = state.weeklyCommitments.find((entry) => entry.id === `wcw_${WEEK_START}`);
      check(`${label}でauto確定`, meta?.committedVia === "auto", JSON.stringify(meta));
      const spies = await hookSpies();
      check(`${label}で開始フックを1回呼ぶ`,
        spies.starts.filter((id) => id === blockId).length === 1, JSON.stringify(spies));
      check(`${label}の開始スパイは完了スパイと独立`,
        spies.completions.filter((call) => call.blockId === blockId).length === completions,
        JSON.stringify(spies));
    }
    await checkAutoCommit("setBlockTime", "start-set", async () => {
      await clickAction("now-start", { id: "start-set" });
      await page.locator('[data-action="declare-skip"]').click();
    });
    await checkAutoCommit("startPomodoro", "start-pomo", async () => {
      await clickAction("start-pomodoro", { blockId: "start-pomo" });
      await page.locator('[data-action="declare-skip"]').click();
    });
    await checkAutoCommit("Block編集モーダル開始保存", "start-modal", async () => {
      await clickAction("edit-block", { id: "start-modal" });
      await page.locator('[data-modal-field="actualStartAt"]').fill(`${TODAY}T09:05`);
      await page.locator('[data-action="modal-save"]').click();
    });
    await checkAutoCommit("実績編集モーダル開始保存", "start-actual", async () => {
      await clickAction("complete-block-with-actual", { id: "start-actual" });
      await page.locator('[data-action="modal-save"]').click();
    }, { completions: 1 });

    console.log("[2b] focusTimerAuto二重開始経路の無害化");
    await seed({
      blocks: [block("auto-double")], weeklyCommitments: [],
      settings: { focusTimerAuto: true, pomoGuidedAccessHint: false }
    });
    await resetHookSpies();
    await clickAction("now-start", { id: "auto-double" });
    await page.locator('[data-action="declare-skip"]').click();
    await page.waitForFunction(({ KEY, WEEK_START }) => JSON.parse(localStorage.getItem(KEY)).weeklyCommitments
      .some((entry) => entry.id === `wcw_${WEEK_START}`), { KEY, WEEK_START });
    const doubleState = await stored();
    const doubleSpies = await hookSpies();
    check("setBlockTime→startPomodoroでも実変化ガードで開始フックは1回", doubleSpies.starts
      .filter((id) => id === "auto-double").length === 1, JSON.stringify(doubleSpies));
    check("二重開始経路でも週メタは1件", doubleState.weeklyCommitments
      .filter((entry) => entry.id === `wcw_${WEEK_START}`).length === 1,
      JSON.stringify(doubleState.weeklyCommitments));
    check("二重開始経路でもBlock itemは1件", doubleState.weeklyCommitments
      .filter((entry) => entry.id === `wci_${WEEK_START}_auto-double`).length === 1,
      JSON.stringify(doubleState.weeklyCommitments));

    console.log("[3] 負例と非該当ガード");
    const completedMarker = `${TODAY}T08:00:00`;
    await seed({
      blocks: [block("task-off", { completed: true, actualEndAt: completedMarker })],
      tasks: [task("t1", "p1", { status: "completed" })],
      weeklyCommitments: [weekMeta(), item("task-off", { completedAt: completedMarker, completedChangedAt: OLD })]
    });
    const beforeOff = JSON.stringify(await stamped("task-off"));
    await clickAction("toggle-task-complete", { id: "task-off" });
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).tasks.find((entry) => entry.id === "t1")?.status !== "completed", KEY);
    check("toggleTaskCompleteFromBlockのOFF側はitem不変", JSON.stringify(await stamped("task-off")) === beforeOff);

    const PAST = addDays(WEEK_START, -1);
    const PAST_WEEK = addDays(WEEK_START, -7);
    await seed({ blocks: [block("past-actual", {
      date: PAST, plannedStartAt: `${PAST}T09:00:00`, plannedEndAt: `${PAST}T09:30:00`
    })], weeklyCommitments: [] });
    await clickAction("complete-block-with-actual", { id: "past-actual" });
    await page.locator('[data-action="modal-save"]').click();
    check("過去週Blockの実績編集では自動確定しない", (await stored()).weeklyCommitments.length === 0);

    const FUTURE = addDays(WEEK_START, 7);
    await seed({ blocks: [block("future", {
      date: FUTURE, plannedStartAt: `${FUTURE}T09:00:00`, plannedEndAt: `${FUTURE}T09:30:00`
    })], weeklyCommitments: [] });
    await clickAction("toggle-block", { id: "future" });
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks
      .find((entry) => entry.id === "future")?.completed, KEY);
    check("未来週Blockの完了では自動確定しない", (await stored()).weeklyCommitments.length === 0);

    const pastCompletedAt = `${PAST}T09:30:00`;
    await seed({
      blocks: [block("past-cancel", {
        date: PAST, plannedStartAt: `${PAST}T09:00:00`, plannedEndAt: `${PAST}T09:30:00`,
        actualStartAt: `${PAST}T09:00:00`, actualEndAt: pastCompletedAt, completed: true
      })],
      weeklyCommitments: [
        weekMeta(PAST_WEEK),
        item("past-cancel", {
          plannedDate: PAST, completedAt: pastCompletedAt,
          completedChangedAt: OLD, updatedAt: OLD
        }, PAST_WEEK)
      ]
    });
    const beforePastCancel = JSON.stringify((await stored()).weeklyCommitments
      .find((entry) => entry.id === `wci_${PAST_WEEK}_past-cancel`));
    await clickAction("toggle-block", { id: "past-cancel" });
    await page.waitForFunction((KEY) => !JSON.parse(localStorage.getItem(KEY)).blocks
      .find((entry) => entry.id === "past-cancel")?.completed, KEY);
    const afterPastCancel = JSON.stringify((await stored()).weeklyCommitments
      .find((entry) => entry.id === `wci_${PAST_WEEK}_past-cancel`));
    check("週跨ぎ後の完了取消は過去週itemを変更しない", afterPastCancel === beforePastCancel,
      afterPastCancel);

    await seed({ blocks: [block("unset")], weeklyCommitments: [], settings: { twelveWeekStartDate: "" } });
    await clickAction("toggle-block", { id: "unset" });
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.find((entry) => entry.id === "unset")?.completed, KEY);
    check("12WY未設定では完了フックが実質no-op", (await stored()).weeklyCommitments.length === 0);
    await seed({ blocks: [block("unset-start")], weeklyCommitments: [], settings: { twelveWeekStartDate: "" } });
    await clickAction("now-start", { id: "unset-start" });
    await page.locator('[data-action="declare-skip"]').click();
    check("12WY未設定では開始フックも実質no-op", (await stored()).weeklyCommitments.length === 0);

    await seed({
      blocks: [block("non-track")], projects: [project("p1", { twelveWeekStartDate: "" })],
      weeklyCommitments: []
    });
    await clickAction("toggle-block", { id: "non-track" });
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.find((entry) => entry.id === "non-track")?.completed, KEY);
    check("weeklyCommitments空でも12WY非該当ProjectのBlock完了は自動確定しない",
      (await stored()).weeklyCommitments.length === 0);

    const CYCLE_END = addDays(CYCLE_START, 83);
    await seed({
      blocks: [block("cycle-boundary-in")],
      projects: [project("p1", { twelveWeekStartDate: CYCLE_END })], weeklyCommitments: []
    });
    await clickAction("toggle-block", { id: "cycle-boundary-in" });
    await page.waitForFunction(({ KEY, WEEK_START }) => JSON.parse(localStorage.getItem(KEY)).weeklyCommitments
      .some((entry) => entry.id === `wcw_${WEEK_START}`), { KEY, WEEK_START });
    check("12WY期間終端(+83日)のProjectは候補になる", Boolean(await stamped("cycle-boundary-in")));

    await seed({
      blocks: [block("cycle-boundary-out")],
      projects: [project("p1", { twelveWeekStartDate: addDays(CYCLE_END, 1) })], weeklyCommitments: []
    });
    await clickAction("toggle-block", { id: "cycle-boundary-out" });
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks
      .find((entry) => entry.id === "cycle-boundary-out")?.completed, KEY);
    check("12WY期間終端の翌日(+84日)のProjectは候補外", (await stored()).weeklyCommitments.length === 0);

    console.log("[4] saveBlockFromModalの全正常保存出口");
    async function completeExistingModalExit(label, blockId, { recurrenceKind = "", expectedCharge = "" } = {}) {
      await clickAction("edit-block", { id: blockId });
      await page.locator('[data-modal-field="completed"]').check();
      if (recurrenceKind) {
        await page.locator('[data-modal-field="recurrenceKind"]').selectOption(recurrenceKind);
      }
      if (expectedCharge) {
        await page.locator('[data-modal-field="expectedCharge"]').selectOption(expectedCharge);
      }
      await resetHookSpies();
      await page.locator('[data-action="modal-save"]').click();
      await waitForStamp(blockId);
      await assertCompletionRoute(label, blockId, false, 4);
    }

    await seed({ blocks: [], weeklyCommitments: [] });
    await clickAction("timeline-new-block", { minute: "540" });
    await page.locator('[data-modal-field="title"]').fill("新規繰り返し出口_v254");
    await page.locator('[data-modal-field="taskId"]').selectOption("t1");
    await page.locator('[data-modal-field="completed"]').check();
    await page.locator('[data-modal-field="recurrenceKind"]').selectOption("daily");
    await resetHookSpies();
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForFunction(() => (globalThis.__v254CompletionCalls || []).length === 1);
    const newRecurringSpies = await hookSpies();
    const newRecurringId = newRecurringSpies.completions[0]?.blockId;
    await waitForStamp(newRecurringId);
    await assertCompletionRoute("新規繰り返し保存出口", newRecurringId, false, 4);
    check("新規繰り返し保存でルールを作成", (await stored()).recurrences.some((entry) => !entry.deleted));

    await seed({
      blocks: [block("series-end", {
        title: "シリーズ終了_v254", category: "ルーティン", recurrenceGroupId: "rule-end",
        comment: "fixture"
      })],
      weeklyCommitments: [weekMeta(), item("series-end")],
      recurrences: [recurrence("rule-end", "シリーズ終了_v254")]
    });
    await completeExistingModalExit("シリーズ終了保存出口", "series-end", { recurrenceKind: "__end__" });
    check("シリーズ終了保存でルールをdeleted化", (await stored()).recurrences
      .find((entry) => entry.id === "rule-end")?.deleted === true);

    await seed({
      blocks: [block("duplicate-rule", { title: "重複ルール_v254", comment: "fixture" })],
      weeklyCommitments: [weekMeta(), item("duplicate-rule")],
      recurrences: [recurrence("rule-duplicate", "重複ルール_v254", { category: "仕事" })]
    });
    await completeExistingModalExit("重複ルール保存出口", "duplicate-rule", { recurrenceKind: "daily" });
    check("重複ルール保存出口で新規ルールを増やさない", (await stored()).recurrences
      .filter((entry) => !entry.deleted).length === 1, JSON.stringify((await stored()).recurrences));

    await seed({
      blocks: [block("settings-update", {
        title: "設定更新_v254", category: "ルーティン", recurrenceGroupId: "rule-settings",
        expectedCharge: 1, expectedDischarge: 1, comment: "fixture"
      })],
      weeklyCommitments: [weekMeta(), item("settings-update")],
      recurrences: [recurrence("rule-settings", "設定更新_v254")]
    });
    await completeExistingModalExit("設定更新保存出口", "settings-update", { expectedCharge: "3" });
    check("設定更新保存出口で繰り返し既定値を更新", Number((await stored()).recurrences
      .find((entry) => entry.id === "rule-settings")?.expectedCharge) === 3);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nv254: 全件成功" : `\nv254: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
