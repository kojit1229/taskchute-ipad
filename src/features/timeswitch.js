// v187: 「計時」タブ。ワンタップ計時・当日Block・外部予定をblocks一本で実行記録する。
// stateはlive bindingで読み取り、app.js側の汎用ヘルパーはconfigureTimeswitch(deps)で注入する。

import { state } from "../state/store.js";
import { registerActions } from "../ui/actions.js";

const SCHEDULE_TTL_MS = 30 * 60 * 1000;
const SCHEDULE_FRESH_MS = 26 * 60 * 60 * 1000;
const SCHEDULE_FUTURE_TOLERANCE_MS = 10 * 60 * 1000;
const SCHEDULE_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const SCHEDULE_GENERATED_AT_RE = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

let escapeHTML, todayISO, nowDateTime, dateToLocalDateTime, localDateTimeToMs;
let blocksForDate, getCategoryColor, getOtherTask, makeBlock;
let fetchGitHubRawText, personalDataReady, saveState, saveAndRender, render;
let forceResetPomodoroSession, startPomodoro;
let timeswitchTickerId = null;
let timeswitchRenderedDate = "";
let pendingSwitch = null;
let scheduleCache = { fetchedAt: 0, data: undefined };

function configureTimeswitch(deps) {
  ({
    escapeHTML, todayISO, nowDateTime, dateToLocalDateTime, localDateTimeToMs,
    blocksForDate, getCategoryColor, getOtherTask, makeBlock,
    fetchGitHubRawText, personalDataReady, saveState, saveAndRender, render,
    forceResetPomodoroSession, startPomodoro
  } = deps);

  registerActions({
    "timeswitch-category": ({ target }) => handleCategoryTap(target.dataset.category || ""),
    "timeswitch-task": ({ id }) => handleTaskTap(id),
    "timeswitch-event": ({ target }) => handleEventTap(target.dataset.externalId || ""),
    "timeswitch-confirm-ok": () => confirmPendingSwitch(),
    "timeswitch-confirm-cancel": () => cancelPendingSwitch()
  });

}

function runningBlocks() {
  return state.blocks.filter((block) =>
    !block.deleted && block.actualStartAt && !block.actualEndAt);
}

function runningBlock() {
  return runningBlocks()
    .sort((a, b) => localDateTimeToMs(b.actualStartAt) - localDateTimeToMs(a.actualStartAt))[0] || null;
}

function isTimeswitchRunning(block) {
  return Boolean(block?.oneTap || block?.externalRef);
}

function finishBlock(block, { completed = true, at = nowDateTime() } = {}) {
  if (!block || block.actualEndAt) return;
  block.actualEndAt = at;
  block.completed = completed;
  block.updatedAt = at;
}

function finishAllRunning({ taskCompleted = false, exceptId = "" } = {}) {
  const at = nowDateTime();
  runningBlocks().forEach((block) => {
    if (block.id === exceptId) return;
    finishBlock(block, {
      completed: isTimeswitchRunning(block) ? true : taskCompleted,
      at
    });
    resetPomodoroForBlock(block.id);
  });
}

function closeOrphanedOneTap() {
  const today = todayISO();
  let changed = false;
  state.blocks.forEach((block) => {
    if (!block.deleted && block.oneTap && block.actualStartAt && !block.actualEndAt
        && /^\d{4}-\d{2}-\d{2}$/.test(block.date || "") && block.date < today) {
      finishBlock(block, { completed: true, at: `${block.date}T23:59:00` });
      changed = true;
    }
  });
  return changed;
}

// 既存のnow-start/ポモ開始から呼ぶフック。計時タブ由来の実行だけを確認なしで終了する。
function prepareTimeswitchForTaskStart(blockId) {
  closeOrphanedOneTap();
  const at = nowDateTime();
  state.blocks.forEach((block) => {
    if (block.id === blockId || block.deleted || block.actualEndAt || !block.actualStartAt) return;
    if (isTimeswitchRunning(block)) finishBlock(block, { completed: true, at });
  });
}

function resetPomodoroForBlock(blockId) {
  if (!state.pomodoro?.running || state.pomodoro.blockId !== blockId) return;
  state.pomodoro = {
    ...state.pomodoro,
    running: false,
    blockId: "",
    startedAt: "",
    endsAt: "",
    mode: "focus"
  };
}

function startTaskBlock(block) {
  if (!block) return;
  finishAllRunning({ taskCompleted: false, exceptId: block.id });
  const at = nowDateTime();
  block.actualStartAt = at;
  block.actualEndAt = "";
  block.completed = false;
  block.updatedAt = at;
  if (block.taskId) {
    state.tasks = state.tasks.map((task) =>
      task.id === block.taskId && task.status === "todo"
        ? { ...task, status: "doing", updatedAt: at }
        : task);
  }
  state._justStartedBlockId = block.id;
  if (state.settings.focusTimerAuto && !state.pomodoro.running) {
    forceResetPomodoroSession();
    startPomodoro(block.id);
  } else {
    saveAndRender("計時を開始しました");
  }
}

function startCategory(category) {
  finishAllRunning({ taskCompleted: false });
  const now = new Date();
  const at = dateToLocalDateTime(now);
  const block = makeBlock({
    taskId: getOtherTask()?.id,
    date: todayISO(),
    title: category,
    category,
    plannedStartAt: at,
    plannedEndAt: dateToLocalDateTime(new Date(now.getTime() + 30 * 60 * 1000)),
    actualStartAt: at
  });
  block.oneTap = true;
  state.blocks.push(block);
  saveAndRender(`${category}の計時を開始しました`);
}

function scheduleEventById(externalId) {
  return (scheduleCache.data?.events || []).find((event) =>
    event.externalId === externalId && event.date === todayISO() && event.label === "こーじ") || null;
}

function importedEventBlock(externalId) {
  return state.blocks.find((block) => !block.deleted && block.externalRef === externalId) || null;
}

function eventPlannedDateTime(date, time) {
  return SCHEDULE_TIME_RE.test(time || "") ? `${date}T${time}:00` : "";
}

function startEvent(event) {
  if (!event || importedEventBlock(event.externalId)) return;
  finishAllRunning({ taskCompleted: false });
  const at = nowDateTime();
  const block = makeBlock({
    date: todayISO(),
    title: event.title,
    category: "",
    plannedStartAt: event.allDay ? "" : eventPlannedDateTime(todayISO(), event.startAt),
    plannedEndAt: event.allDay ? "" : eventPlannedDateTime(todayISO(), event.endAt),
    actualStartAt: at
  });
  block.externalRef = event.externalId;
  block.label = event.label;
  state.blocks.push(block);
  saveAndRender(`${event.title}の計時を開始しました`);
}

function createRepeatBlock(source) {
  const block = makeBlock({
    taskId: source.taskId,
    date: todayISO(),
    title: source.title,
    category: source.category
  });
  state.blocks.push(block);
  return block;
}

function requestTaskSwitch(kind, payload, running) {
  pendingSwitch = {
    kind,
    payload,
    runningId: running.id,
    runningTitle: running.title || "実行中タスク"
  };
  render();
}

function handleCategoryTap(category) {
  if (!category) return;
  const running = runningBlock();
  if (running && !isTimeswitchRunning(running)) {
    if (running.category === category) return;
    requestTaskSwitch("category", category, running);
    return;
  }
  if (running?.oneTap && running.category === category) {
    finishAllRunning({ taskCompleted: false });
    saveAndRender("計時を停止しました");
    return;
  }
  startCategory(category);
}

function handleTaskTap(blockId) {
  const source = state.blocks.find((block) =>
    block.id === blockId && !block.deleted && block.date === todayISO() && !block.oneTap && !block.externalRef);
  if (!source) return;
  const running = runningBlock();
  if (running?.id === source.id) {
    const at = nowDateTime();
    finishAllRunning({ taskCompleted: false });
    source.completed = true;
    source.actualEndAt = at;
    source.updatedAt = at;
    saveAndRender("タスクを完了しました");
    return;
  }
  if (running && !isTimeswitchRunning(running)) {
    requestTaskSwitch("task", blockId, running);
    return;
  }
  const target = source.completed || source.actualStartAt || source.actualEndAt
    ? createRepeatBlock(source)
    : source;
  startTaskBlock(target);
}

function handleEventTap(externalId) {
  if (!externalId) return;
  const existing = importedEventBlock(externalId);
  const running = runningBlock();
  if (existing && running?.id === existing.id) {
    finishAllRunning({ taskCompleted: false });
    saveAndRender("予定の計時を停止しました");
    return;
  }
  if (existing) return;
  const event = scheduleEventById(externalId);
  if (!event) return;
  if (running && !isTimeswitchRunning(running)) {
    requestTaskSwitch("event", externalId, running);
    return;
  }
  startEvent(event);
}

function confirmPendingSwitch() {
  if (!pendingSwitch) return;
  const action = pendingSwitch;
  pendingSwitch = null;
  if (runningBlock()?.id !== action.runningId) {
    render();
    return;
  }
  const event = action.kind === "event" ? scheduleEventById(action.payload) : null;
  const source = action.kind === "task"
    ? state.blocks.find((block) => block.id === action.payload && !block.deleted)
    : null;
  if ((action.kind === "event" && !event) || (action.kind === "task" && !source)) {
    render();
    return;
  }
  finishAllRunning({ taskCompleted: false });
  if (action.kind === "category") {
    startCategory(action.payload);
  } else if (action.kind === "event") {
    startEvent(event);
  } else {
    const target = source.completed || source.actualStartAt || source.actualEndAt
      ? createRepeatBlock(source)
      : source;
    startTaskBlock(target);
  }
}

function cancelPendingSwitch() {
  pendingSwitch = null;
  render();
}

function parseScheduleInbox(raw) {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object"
        || !SCHEDULE_GENERATED_AT_RE.test(parsed.generatedAt || "")
        || !Array.isArray(parsed.events)) return undefined;
    const generatedAtMs = localDateTimeToMs(parsed.generatedAt);
    const ageMs = Date.now() - generatedAtMs;
    if (!generatedAtMs || ageMs > SCHEDULE_FRESH_MS || ageMs < -SCHEDULE_FUTURE_TOLERANCE_MS) {
      return undefined;
    }
    const seen = new Set();
    const events = parsed.events.flatMap((event) => {
      if (!event || typeof event !== "object") return [];
      const externalId = typeof event.externalId === "string" ? event.externalId.trim() : "";
      const title = typeof event.title === "string" ? event.title.trim() : "";
      const date = typeof event.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.date) ? event.date : "";
      if (!externalId || !title || !date || seen.has(externalId)) return [];
      seen.add(externalId);
      return [{
        externalId,
        title,
        date,
        startAt: typeof event.startAt === "string" && SCHEDULE_TIME_RE.test(event.startAt) ? event.startAt : "",
        endAt: typeof event.endAt === "string" && SCHEDULE_TIME_RE.test(event.endAt) ? event.endAt : "",
        allDay: event.allDay === true,
        label: typeof event.label === "string" ? event.label : "",
        calendarName: typeof event.calendarName === "string" ? event.calendarName : ""
      }];
    });
    return { generatedAt: parsed.generatedAt, events };
  } catch {
    return undefined;
  }
}

async function hydrateTimeswitchSchedule() {
  if (!personalDataReady(state.settings.github)) return false;
  if (Date.now() - scheduleCache.fetchedAt < SCHEDULE_TTL_MS) return false;
  const previous = scheduleCache.data;
  const raw = await fetchGitHubRawText("schedule-inbox.json");
  const data = parseScheduleInbox(raw);
  scheduleCache = { fetchedAt: Date.now(), data };
  return JSON.stringify(previous) !== JSON.stringify(data);
}

function safeColor(color) {
  return /^#[0-9a-f]{3,8}$/i.test(color || "") ? color : "var(--accent)";
}

function elapsedText(startAt) {
  const seconds = Math.max(0, Math.floor((Date.now() - localDateTimeToMs(startAt)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function elapsedHTML(block, slot) {
  return block
    ? `<span id="timeswitch-elapsed-${slot}" class="timeswitch-elapsed">${elapsedText(block.actualStartAt)}</span>`
    : "";
}

function renderCategoryTiles(active) {
  return (state.settings.categories || []).map((category) => {
    const isOneTap = Boolean(active?.oneTap && active.category === category.name);
    const isTask = Boolean(active && !isTimeswitchRunning(active) && active.category === category.name);
    const isActive = isOneTap || isTask;
    return `
      <button class="timeswitch-tile${isActive ? " is-active" : ""}${isTask ? " is-task" : ""}"
        style="--timeswitch-color:${safeColor(category.color || getCategoryColor(category.name))}"
        data-action="timeswitch-category" data-category="${escapeHTML(category.name)}">
        <span class="timeswitch-tile-name">${escapeHTML(category.name)}</span>
        ${isTask ? `<span class="timeswitch-task-label">▶ TASK</span>` : ""}
        ${isActive ? elapsedHTML(active, "category") : `<span class="timeswitch-tile-hint">タップで開始</span>`}
      </button>`;
  }).join("");
}

function renderTaskTiles(active) {
  const blocks = blocksForDate(todayISO()).filter((block) => !block.oneTap && !block.externalRef);
  if (!blocks.length) return `<p class="timeswitch-empty">今日のタスクはありません。</p>`;
  return blocks.map((block) => {
    const isActive = active?.id === block.id;
    const isDone = Boolean(block.completed || block.actualEndAt);
    return `
      <button class="timeswitch-task${isActive ? " is-active" : ""}${isDone ? " is-done" : ""}"
        style="--timeswitch-color:${safeColor(getCategoryColor(block.category))}"
        data-action="timeswitch-task" data-id="${escapeHTML(block.id)}" data-block-id="${escapeHTML(block.id)}">
        <span class="timeswitch-tile-name">${escapeHTML(block.title || "名称なし")}</span>
        <span class="timeswitch-tile-meta">${escapeHTML(block.category || "カテゴリなし")}</span>
        ${isActive ? elapsedHTML(block, "task") : `<span class="timeswitch-tile-hint">${isDone ? "もう一度記録" : "タップで開始"}</span>`}
      </button>`;
  }).join("");
}

function renderEventTiles(active) {
  const events = (scheduleCache.data?.events || []).filter((event) =>
    event.date === todayISO() && event.label === "こーじ");
  if (!events.length) return `<p class="timeswitch-empty">今日の予定はありません。</p>`;
  return events.map((event) => {
    const imported = importedEventBlock(event.externalId);
    const isActive = Boolean(imported && active?.id === imported.id);
    const time = event.allDay ? "終日" : [event.startAt, event.endAt].filter(Boolean).join("–");
    return `
      <button class="timeswitch-event${isActive ? " is-active" : ""}${imported && !isActive ? " is-imported" : ""}"
        data-action="timeswitch-event" data-external-id="${escapeHTML(event.externalId)}">
        <span class="timeswitch-tile-name">${escapeHTML(event.title)}</span>
        <span class="timeswitch-tile-meta">${escapeHTML(time || "時刻なし")}</span>
        ${isActive ? elapsedHTML(imported, "event") : `<span class="timeswitch-tile-hint">${imported ? "取込済" : "タップで開始"}</span>`}
      </button>`;
  }).join("");
}

function confirmationOverlay() {
  const isOpen = Boolean(pendingSwitch);
  const message = isOpen
    ? `実行中の「${escapeHTML(pendingSwitch.runningTitle)}」を未完了のまま終了して、計時を切り替えますか？`
    : "";
  return `
    <div id="cc-overlay" class="${isOpen ? "on" : ""}" role="presentation" aria-hidden="${isOpen ? "false" : "true"}">
      <div class="cc-box panel" role="dialog" aria-modal="true" aria-labelledby="timeswitch-confirm-message">
        <div class="cc-scanline"></div>
        <p class="cc-msg" id="timeswitch-confirm-message">${message}</p>
        <div class="cc-actions">
          <button class="btn" data-action="timeswitch-confirm-cancel">やめる</button>
          <button class="btn primary" data-action="timeswitch-confirm-ok">切り替える</button>
        </div>
      </div>
    </div>`;
}

function updateTimeswitchTick() {
  if (state.currentView !== "timeswitch") {
    stopTimeswitchTicker();
    return;
  }
  if (typeof document === "undefined") return;
  if (document.hidden) return;
  const today = todayISO();
  if (today !== timeswitchRenderedDate) {
    timeswitchRenderedDate = today;
    if (closeOrphanedOneTap()) saveState();
    render();
    return;
  }
  const active = runningBlock();
  for (const slot of ["category", "task", "event"]) {
    const elapsed = document.getElementById(`timeswitch-elapsed-${slot}`);
    if (elapsed && active) elapsed.textContent = elapsedText(active.actualStartAt);
  }
}

function startTimeswitchTicker() {
  stopTimeswitchTicker();
  timeswitchRenderedDate = todayISO();
  timeswitchTickerId = window.setInterval(updateTimeswitchTick, 1000);
}

function stopTimeswitchTicker() {
  if (timeswitchTickerId !== null) window.clearInterval(timeswitchTickerId);
  timeswitchTickerId = null;
}

function renderTimeswitch() {
  if (closeOrphanedOneTap()) saveState();
  const active = runningBlock();
  startTimeswitchTicker();
  return `
    <div class="timeswitch">
      <div class="view-header timeswitch-header">
        <div>
          <div class="eyebrow">ONE TAP TIME LOG</div>
          <h1>計時</h1>
          <p>カテゴリ・今日のタスク・予定をタップして、すぐ実行記録。</p>
        </div>
        <span class="timeswitch-status">${active ? "● 計時中" : "待機中"}</span>
      </div>
      <section class="panel timeswitch-section">
        <div class="timeswitch-section-head"><h2>カテゴリ</h2><span>いまの時間はどれ？</span></div>
        <div class="timeswitch-grid timeswitch-category-grid">${renderCategoryTiles(active)}</div>
      </section>
      <section class="panel timeswitch-section">
        <div class="timeswitch-section-head"><h2>今日のタスク</h2><span>タップで開始／実行中は再タップで完了</span></div>
        <div class="timeswitch-grid">${renderTaskTiles(active)}</div>
      </section>
      <section class="panel timeswitch-section">
        <div class="timeswitch-section-head"><h2>今日の予定</h2><span>TimeTree・こーじ</span></div>
        <div class="timeswitch-grid">${renderEventTiles(active)}</div>
      </section>
      ${confirmationOverlay()}
    </div>`;
}

export {
  configureTimeswitch,
  renderTimeswitch,
  startTimeswitchTicker,
  stopTimeswitchTicker,
  updateTimeswitchTick,
  hydrateTimeswitchSchedule,
  parseScheduleInbox,
  closeOrphanedOneTap,
  prepareTimeswitchForTaskStart
};
