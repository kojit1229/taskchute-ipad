// src/features/today.js — v229: TOWERのGATE編集状態と早起き正本を依存注入する。
// stateはlive bindingで読み取り、TOWER描画層へ必要最小限の依存を注入する。

import { state } from "../state/store.js";
import { registerActions } from "../ui/actions.js";
import { configureTodayTower, renderTodayTower, updateTodayTowerTick } from "./today-tower.js";
import { linkedGymBlock } from "./iron-log.js";
import {
  runningBlockOf as coreRunningBlockOf, queueBlocksOf as coreQueueBlocksOf,
  towerFlights as coreTowerFlights
} from "../core/today-model.js";

let escapeHTML, todayISO, blocksForDate, minutesOf, timeFromDateTime;
let localDateTimeToMs, resolveEstimateMin;
let clamp, isStaleBlock, isTaskDead, renderDeferringForFocus;
let renderCircularProgress, remainingText, remainingTextNormal;
let renderPomodoroInterruptControls;
let syncAlertBanner;
let gateEditMode;
let todayTickerId = null;
let todayRenderedDateISO = null;
let todayFocusUi = null;

const TODAY_FOCUS_STORAGE_KEY = "taskchute-journal-today-focus-v1";
const DEFAULT_FOCUS_SECTIONS = Object.freeze({ gate: true, journal: true });

function normalizedFocusSections(value) {
  return {
    gate: typeof value?.gate === "boolean" ? value.gate : true,
    journal: typeof value?.journal === "boolean" ? value.journal : true
  };
}

function todayFocusUiState() {
  if (todayFocusUi) return todayFocusUi;
  try {
    const saved = JSON.parse(localStorage.getItem(TODAY_FOCUS_STORAGE_KEY) || "null");
    todayFocusUi = {
      sections: normalizedFocusSections(saved?.sections),
      restore: normalizedFocusSections(saved?.restore)
    };
  } catch {
    todayFocusUi = { sections: { ...DEFAULT_FOCUS_SECTIONS }, restore: { ...DEFAULT_FOCUS_SECTIONS } };
  }
  return todayFocusUi;
}

function persistTodayFocusUi(next) {
  todayFocusUi = next;
  try { localStorage.setItem(TODAY_FOCUS_STORAGE_KEY, JSON.stringify(next)); } catch {}
  renderDeferringForFocus();
}

function toggleTodayFocusSection(section) {
  const current = todayFocusUiState();
  const sections = { ...current.sections, [section]: !current.sections[section] };
  const hasVisibleSection = Object.values(sections).some(Boolean);
  persistTodayFocusUi({
    sections,
    restore: hasVisibleSection ? { ...sections } : { ...current.sections }
  });
}

function toggleTodayFocusMode() {
  const current = todayFocusUiState();
  const focused = !Object.values(current.sections).some(Boolean);
  const restore = normalizedFocusSections(current.restore);
  persistTodayFocusUi(focused
    ? { sections: Object.values(restore).some(Boolean) ? restore : { ...DEFAULT_FOCUS_SECTIONS }, restore }
    : { sections: { gate: false, journal: false }, restore: { ...current.sections } });
}

function renderTodayFocusBar(visibility = todayFocusUiState().sections) {
  const focused = !Object.values(visibility).some(Boolean);
  const chip = (section, label) => `<button type="button" class="today-focus-chip${visibility[section] ? " is-active" : ""}" data-action="focus-toggle-${section}" aria-pressed="${visibility[section]}">${label}</button>`;
  return `<nav class="today-focus-bar" aria-label="Today表示切替">
    <button type="button" class="today-focus-main${focused ? " is-active" : ""}" data-action="focus-mode" aria-pressed="${focused}">🎯 FOCUS</button>
    <div class="today-focus-chips" role="group" aria-label="セクション表示">
      ${chip("gate", "ルーティン")}${chip("journal", "ジャーナル")}
    </div>
  </nav>`;
}

function configureToday(deps) {
  ({
    escapeHTML, todayISO, blocksForDate, minutesOf, timeFromDateTime,
    localDateTimeToMs, resolveEstimateMin,
    clamp, isStaleBlock, isTaskDead, renderDeferringForFocus,
    renderCircularProgress, remainingText, remainingTextNormal,
    renderPomodoroInterruptControls,
    syncAlertBanner, gateEditMode
  } = deps);
  configureTodayTower({
    escapeHTML, todayISO, syncAlertBanner, blocksForDate, towerFlights,
    runningBlockOf, queueBlocksOf, localDateTimeToMs, resolveEstimateMin, minutesOf, timeFromDateTime, clamp, isStaleBlock,
    towerMotionSetting: () => state.settings.towerMotion,
    renderTodayPomodoro,
    todayFocusVisibility: () => todayFocusUiState().sections,
    renderTodayFocusBar,
    journalForDate: (date) => ({
      free: state.journals[date] || "",
      aiRequest: state.journalMeta[date]?.aiRequest || ""
    }),
    gateRules: () => state.recurrences || [],
    earlyBirdLogForDate: (date) => state.earlyBird?.logs?.[date] || null,
    earlyRiseTarget: () => state.settings.earlyRiseTarget,
    linkedGymBlock: (blocks, nowMinutes) => linkedGymBlock({ settings: state.settings, blocks }, nowMinutes),
    bodyScansForDate: (date) => (state.bodyScans || []).filter((s) => String(s.dateTime || "").startsWith(date)),
    scheduledTasksForDate: (date, blocks) => {
      const blockedTaskIds = new Set((blocks || []).map((block) => block.taskId).filter(Boolean));
      return (state.tasks || []).filter((task) => {
        const estimate = Number(task.estimateMin);
        return !task.deleted && !isTaskDead(task) && task.kind !== "other"
          && Boolean(task.dueDate) && task.dueDate <= date
          && Number.isFinite(estimate) && estimate > 0 && !blockedTaskIds.has(task.id);
      }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, "ja"));
    },
    gateEditMode
  });
  registerActions({
    "focus-toggle-gate": () => toggleTodayFocusSection("gate"),
    "focus-toggle-journal": () => toggleTodayFocusSection("journal"),
    "focus-mode": () => toggleTodayFocusMode()
  });
}

function runningBlockOf(blocks) {
  return coreRunningBlockOf(blocks, { localDateTimeToMs });
}

function queueBlocksOf(blocks) {
  return coreQueueBlocksOf(blocks, { minutesOf, isStaleBlock });
}

function panelHeading(en, ja, source) {
  return `<h2 class="today-panel-title">${en}<span>${ja}</span><b>${source}</b></h2>`;
}

function todayPomodoroDisplay(nowMs = Date.now()) {
  const pomodoro = state.pomodoro || {};
  if (!pomodoro.running) {
    return { running: false, mode: "focus", progress: 0, text: "50:00", color: "var(--faint)", label: "待機中" };
  }
  const endsAtMs = localDateTimeToMs(pomodoro.endsAt);
  const remainingMs = Math.max(0, endsAtMs - nowMs);
  if (pomodoro.mode === "break") {
    return {
      running: true,
      mode: "break",
      progress: 1 - remainingMs / (5 * 60 * 1000),
      text: remainingTextNormal(remainingMs),
      color: "var(--orange)",
      label: "休憩中"
    };
  }
  const startedAtMs = localDateTimeToMs(pomodoro.startedAt);
  const totalMs = Math.max(1, endsAtMs - startedAtMs);
  return {
    running: true,
    mode: "focus",
    progress: 1 - remainingMs / totalMs,
    text: remainingText(pomodoro.endsAt, true),
    color: "var(--accent)",
    label: "作業中"
  };
}

function renderTodayPomodoro(blocks, queue) {
  const display = todayPomodoroDisplay();
  const block = (state.blocks || []).find((item) => item.id === state.pomodoro?.blockId);
  // v191(C2): ルーティンBlockに紐づく実行中ポモは、タスク名を出さず汎用表記にする
  // (タイマー自体は継続。NOW FOCUS等からルーティンを除外した仕様との整合)。
  const isRoutinePomodoro = Boolean(block && block.category === "ルーティン");
  const startTarget = runningBlockOf(blocks) || queue[0] || null;
  let controls;
  if (display.running && display.mode === "focus") {
    controls = renderPomodoroInterruptControls(`
      <div class="today-pomodoro-actions">
        <button class="btn danger" data-action="stop-pomodoro">中断</button>
      </div>`);
  } else if (display.running) {
    controls = `<div class="today-pomodoro-actions">
      <button class="btn" data-action="end-break">休憩を終了</button>
    </div>`;
  } else if (startTarget) {
    controls = `<div class="today-pomodoro-actions">
      <button class="btn primary" data-action="start-pomodoro" data-block-id="${escapeHTML(startTarget.id)}">▶ 開始</button>
    </div>`;
  } else {
    controls = `<div class="today-empty">未着手Blockをキューに追加すると開始できます</div>`;
  }
  return `<section class="today-panel today-pomodoro today-span-2 pomo">
    ${panelHeading("CABIN TIMER", "NOW FOCUS連動 — 50:00を2倍速表示", display.running ? "LIVE" : "READY")}
    <div class="today-pomodoro-stage">
      ${renderCircularProgress(display.progress, display.text, display.color)}
      <div class="today-pomodoro-info">
        <strong id="todayPomodoroMode">${display.mode === "break" ? "BREAK" : "POMODORO"} — ${display.label}</strong>
        <span>${block ? (isRoutinePomodoro ? "ルーティン実行中" : escapeHTML(block.title)) : startTarget ? `開始候補: ${escapeHTML(startTarget.title)}` : "対象Blockなし"}</span>
        ${controls}
      </div>
    </div>
  </section>`;
}

function towerFlights(blocks, nowMin) {
  return coreTowerFlights(blocks, nowMin, { minutesOf });
}

function renderToday() {
  todayRenderedDateISO = todayISO();
  startTodayTicker();
  return renderTodayTower();
}

function updateTodayPomodoroTick() {
  const root = document.querySelector(".today-pomodoro");
  if (!root) return;
  const display = todayPomodoroDisplay();
  const overlay = root.querySelector(".pomo-time-overlay");
  const circle = root.querySelector(".pomo-progress-circle");
  const mode = document.getElementById("todayPomodoroMode");
  const radius = 90;
  const circumference = 2 * Math.PI * radius;
  if (overlay) overlay.textContent = display.text;
  if (circle) {
    circle.style.stroke = display.color;
    circle.style.strokeDasharray = String(circumference);
    circle.style.strokeDashoffset = String(circumference * (1 - clamp(display.progress, 0, 1)));
  }
  if (mode) mode.textContent = `${display.mode === "break" ? "BREAK" : "POMODORO"} — ${display.label}`;
}

function updateTodayTick() {
  if (state.currentView !== "today") {
    stopTodayTicker();
    return;
  }
  if (typeof document === "undefined" || document.hidden) return;
  const dateISO = todayISO();
  if (todayRenderedDateISO !== null && dateISO !== todayRenderedDateISO) {
    todayRenderedDateISO = dateISO;
    renderDeferringForFocus();
    return;
  }
  if (document.querySelector(".today-tower")) {
    updateTodayTowerTick();
    updateTodayPomodoroTick();
  }
}

function startTodayTicker() {
  if (todayTickerId !== null || typeof document === "undefined") return;
  todayTickerId = setInterval(updateTodayTick, 1000);
}

function stopTodayTicker() {
  if (todayTickerId !== null) {
    clearInterval(todayTickerId);
    todayTickerId = null;
  }
}

function isTodayTickerRunning() {
  return todayTickerId !== null;
}

export {
  configureToday, renderToday, updateTodayTick, startTodayTicker, stopTodayTicker,
  isTodayTickerRunning, runningBlockOf, queueBlocksOf, towerFlights,
  todayPomodoroDisplay, renderTodayPomodoro, updateTodayPomodoroTick
};
