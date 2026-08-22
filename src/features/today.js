// src/features/today.js — v221: 今日タブをTOWERへ一本化し、共有ANNEX機能だけを保持する。
// stateはlive bindingで読み取り、app.js側の汎用ヘルパーはconfigureToday(deps)で注入する。
// tickerは表示だけを差分更新し、日跨ぎ時だけ全再描画する。state変更・saveStateは行わない。

import { state } from "../state/store.js";
import { registerActions } from "../ui/actions.js";
import { configureCoach, coachSummaryForDate, QUICK_MEALS } from "./coach.js";
import { configureTodayTower, renderTodayTower, updateTodayTowerTick } from "./today-tower.js";
import {
  runningBlockOf as coreRunningBlockOf, queueBlocksOf as coreQueueBlocksOf,
  towerFlights as coreTowerFlights
} from "../core/today-model.js";

let escapeHTML, todayISO, blocksForDate, minutesOf, timeFromDateTime;
let localDateTimeToMs, resolveEstimateMin;
let clamp, isStaleBlock, render, renderDeferringForFocus;
let renderCircularProgress, remainingText, remainingTextNormal;
let renderPomodoroInterruptControls, getCachedReadingHighlights;
let beginTodayZeroWrite, saveTodayZeroEntry, discardTodayZeroWrite, getTodayZeroWriteState;
let homeSyncAlertBanner, renderReplanControlHTML, requestReplan;
let saveState;
let todayTickerId = null;
let todayRenderedDateISO = null;
let todayKindleIndex = 0;
let todayKindleAdvanceAtMs = 0;
let todayKindleDeckKey = "";
let todayZeroIndex = 0;
// v183レビュー反映: 書きかけ本文はDOMだけに置かず退避する。今日ビューは書きながら
// 他パネルの操作(完了・ポモ遷移等)で直接render()が走るため、DOMのみだと下書きが消える。
let todayZeroDraft = "";

function configureToday(deps) {
  ({
    escapeHTML, todayISO, blocksForDate, minutesOf, timeFromDateTime,
    localDateTimeToMs, resolveEstimateMin,
    clamp, isStaleBlock, render, renderDeferringForFocus,
    renderCircularProgress, remainingText, remainingTextNormal,
    renderPomodoroInterruptControls, getCachedReadingHighlights,
    beginTodayZeroWrite, saveTodayZeroEntry, discardTodayZeroWrite, getTodayZeroWriteState,
    homeSyncAlertBanner, renderReplanControlHTML, requestReplan,
    saveState
  } = deps);
  configureCoach({ todayISO, saveState });
  configureTodayTower({
    escapeHTML, todayISO, homeSyncAlertBanner, blocksForDate, towerFlights,
    runningBlockOf, queueBlocksOf, localDateTimeToMs, resolveEstimateMin, timeFromDateTime, minutesOf, clamp, QUICK_MEALS,
    coachSummaryToday: () => {
      const coach = state.coachLog && typeof state.coachLog === "object" ? state.coachLog : { meals: [], settings: { dailyKcal: 2278 } };
      return coachSummaryForDate(coach.meals, todayISO(), coach.settings?.dailyKcal ?? 2278);
    },
    towerMotionSetting: () => state.settings.towerMotion,
    renderTodayPomodoro, renderTodayKindle, renderTodayZero, renderReplanControlHTML
  });
  registerActions({
    "today-kindle-prev": () => moveTodayKindle(-1),
    "today-kindle-next": () => moveTodayKindle(1),
    "today-kindle-random": () => randomTodayKindle(),
    "today-zero-prev": () => moveTodayZero(-1),
    "today-zero-next": () => moveTodayZero(1),
    "today-zero-write": ({ id, target }) => { todayZeroDraft = ""; beginTodayZeroWrite(id, target.dataset.kind === "suggestion"); },
    "today-zero-save": () => { saveTodayZeroEntry(); todayZeroDraft = ""; },
    "today-zero-cancel": () => { discardTodayZeroWrite(); todayZeroDraft = ""; },
    "today-replan": () => requestReplan()
  });
}

function stableHash(text) {
  let hash = 0;
  const value = String(text || "");
  for (let i = 0; i < value.length; i++) hash = (Math.imul(hash, 31) + value.charCodeAt(i)) >>> 0;
  return hash;
}

// bookId+refで一度正規順へ揃えてから日付seedでFisher-Yatesする。
// 入力配列の順番が変わっても、同じ日・同じハイライト集合なら同じ並びになる純関数。
function deterministicReadingDeck(books, dateISO) {
  const deck = [];
  (Array.isArray(books) ? books : []).forEach((book, bookIndex) => {
    (Array.isArray(book?.highlights) ? book.highlights : []).forEach((highlight, highlightIndex) => {
      const text = String(highlight?.text || "").trim();
      if (!text) return;
      const bookId = String(book?.id || bookIndex);
      const ref = String(highlight?.ref || highlightIndex);
      deck.push({
        key: `${bookId}|${ref}`,
        bookId,
        bookTitle: String(book?.title || ""),
        author: String(book?.author || ""),
        ref,
        text
      });
    });
  });
  deck.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  let seed = stableHash(dateISO) || 0x9e3779b9;
  for (let i = deck.length - 1; i > 0; i--) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const j = (seed >>> 0) % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function todayZeroDeck(zeroThinking) {
  const zt = zeroThinking || {};
  const suggestions = (Array.isArray(zt.suggestedThemes) ? zt.suggestedThemes : [])
    .filter((item) => item?.status === "pending" && item.text)
    .map((item) => ({ id: item.id, text: item.text, kind: "suggestion", meta: "AI提案 — 採用して書く" }));
  const themes = (Array.isArray(zt.themes) ? zt.themes : []).filter((item) => item?.text);
  const toCard = (item) => ({
    id: item.id,
    text: item.text,
    kind: "theme",
    meta: item.importance === "高" ? "重要度 高" : item.fav ? "★ お気に入り" : "テーマ"
  });
  return [
    ...suggestions,
    ...themes.filter((item) => item.importance === "高").map(toCard),
    ...themes.filter((item) => item.importance !== "高").map(toCard)
  ];
}

function runningBlockOf(blocks) {
  return coreRunningBlockOf(blocks, { localDateTimeToMs });
}

function queueBlocksOf(blocks) {
  return coreQueueBlocksOf(blocks, { minutesOf, isStaleBlock });
}

function formatElapsed(seconds) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
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
  return `<section class="today-panel today-pomodoro today-span-2">
    ${panelHeading("POMODORO", "NOW FOCUS連動 — 50:00を2倍速表示", display.running ? "LIVE" : "READY")}
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

function readingDeckForToday() {
  const books = typeof getCachedReadingHighlights === "function" ? getCachedReadingHighlights() : null;
  return deterministicReadingDeck(books, todayISO());
}

function syncTodayKindleDeck(deck) {
  const nextKey = `${todayISO()}|${deck.map((item) => item.key).join("\u001f")}`;
  if (nextKey !== todayKindleDeckKey) {
    todayKindleDeckKey = nextKey;
    todayKindleIndex = 0;
  } else if (deck.length) {
    todayKindleIndex %= deck.length;
  }
}

function renderTodayKindle() {
  const deck = readingDeckForToday();
  syncTodayKindleDeck(deck);
  if (!deck.length) {
    stopTodayKindleAutoAdvance();
    return "";
  }
  const card = deck[todayKindleIndex];
  startTodayKindleAutoAdvance();
  return `<section class="today-panel today-kindle">
    ${panelHeading("KINDLE INSIGHT", "読書の再会 — 45秒ごとに自動送り", "BOOK")}
    <div class="today-deck-card today-kindle-card">
      <div data-today-kindle-text>${escapeHTML(card.text)}</div>
      <small data-today-kindle-book>— ${escapeHTML(card.bookTitle)}${card.author ? ` / ${escapeHTML(card.author)}` : ""}</small>
    </div>
    <div class="today-deck-nav">
      <button class="btn" data-action="today-kindle-prev">◀</button>
      <button class="btn primary" data-action="today-kindle-next">めくる ▶</button>
      <button class="btn" data-action="today-kindle-random">ランダム</button>
      <span id="todayKindleCount">${todayKindleIndex + 1} / ${deck.length}</span>
    </div>
  </section>`;
}

function patchTodayKindleCard() {
  if (typeof document === "undefined") return;
  const deck = readingDeckForToday();
  syncTodayKindleDeck(deck);
  if (!deck.length) return;
  const cardRoot = document.querySelector(".today-kindle-card");
  const text = cardRoot?.querySelector("[data-today-kindle-text]");
  const book = cardRoot?.querySelector("[data-today-kindle-book]");
  const count = document.getElementById("todayKindleCount");
  const card = deck[todayKindleIndex];
  if (text) text.textContent = card.text;
  if (book) book.textContent = `— ${card.bookTitle}${card.author ? ` / ${card.author}` : ""}`;
  if (count) count.textContent = `${todayKindleIndex + 1} / ${deck.length}`;
}

function moveTodayKindle(delta) {
  const deck = readingDeckForToday();
  syncTodayKindleDeck(deck);
  if (!deck.length) return;
  todayKindleIndex = (todayKindleIndex + delta + deck.length) % deck.length;
  patchTodayKindleCard();
  restartTodayKindleAutoAdvance();
}

function randomTodayKindle() {
  const deck = readingDeckForToday();
  syncTodayKindleDeck(deck);
  if (!deck.length) return;
  if (deck.length > 1) {
    const offset = 1 + Math.floor(Math.random() * (deck.length - 1));
    todayKindleIndex = (todayKindleIndex + offset) % deck.length;
  }
  patchTodayKindleCard();
  restartTodayKindleAutoAdvance();
}

function startTodayKindleAutoAdvance() {
  if (!todayKindleAdvanceAtMs) todayKindleAdvanceAtMs = Date.now() + 45 * 1000;
}

function stopTodayKindleAutoAdvance() {
  todayKindleAdvanceAtMs = 0;
}

function restartTodayKindleAutoAdvance() {
  todayKindleAdvanceAtMs = Date.now() + 45 * 1000;
}

function updateTodayKindleAutoAdvance(nowMs) {
  if (!todayKindleAdvanceAtMs || nowMs < todayKindleAdvanceAtMs) return;
  const deck = readingDeckForToday();
  syncTodayKindleDeck(deck);
  if (!deck.length) {
    stopTodayKindleAutoAdvance();
    return;
  }
  todayKindleIndex = (todayKindleIndex + 1) % deck.length;
  patchTodayKindleCard();
  todayKindleAdvanceAtMs = nowMs + 45 * 1000;
}

function currentTodayZeroDeck() {
  const deck = todayZeroDeck(state.zeroThinking);
  if (deck.length) todayZeroIndex = ((todayZeroIndex % deck.length) + deck.length) % deck.length;
  else todayZeroIndex = 0;
  return deck;
}

function moveTodayZero(delta) {
  const deck = currentTodayZeroDeck();
  if (!deck.length) return;
  todayZeroIndex = (todayZeroIndex + delta + deck.length) % deck.length;
  render();
}

function renderTodayZero() {
  const write = typeof getTodayZeroWriteState === "function" ? getTodayZeroWriteState() : null;
  if (write) {
    // 再描画の直前ならこの時点で旧DOMがまだ生きている。値を退避してから作り直す
    const prevTextarea = document.getElementById("todayZeroText");
    if (prevTextarea) todayZeroDraft = prevTextarea.value;
    const elapsedSec = Math.max(0, Math.floor((Date.now() - write.startedAtMs) / 1000));
    return `<section class="today-panel today-zero">
      ${panelHeading("ZERO-SEC LAUNCH", "0秒思考 — 1テーマ1分", "WRITING")}
      <div class="today-zero-theme">${escapeHTML(write.text)}</div>
      <textarea id="todayZeroText" class="today-zero-text" placeholder="頭に浮かんだままを書く。整えない。1分で。">${escapeHTML(todayZeroDraft)}</textarea>
      <div class="today-zero-writebar">
        <time id="todayZeroElapsed" class="${elapsedSec >= 60 ? "is-over" : ""}">${formatElapsed(elapsedSec)}</time>
        <span>経過</span>
        <button class="btn ghost" data-action="today-zero-cancel">破棄</button>
        <button class="btn green" data-action="today-zero-save">保存</button>
      </div>
    </section>`;
  }
  const deck = currentTodayZeroDeck();
  const card = deck[todayZeroIndex];
  return `<section class="today-panel today-zero">
    ${panelHeading("ZERO-SEC LAUNCH", "0秒思考 — めくって、そのまま書く", "MIND")}
    ${card ? `
      <div class="today-deck-card today-zero-card">
        <div>${escapeHTML(card.text)}</div><small>${escapeHTML(card.meta)}</small>
      </div>
      <div class="today-deck-nav">
        <button class="btn" data-action="today-zero-prev">◀</button>
        <button class="btn" data-action="today-zero-next">めくる ▶</button>
        <button class="btn primary" data-action="today-zero-write" data-id="${escapeHTML(card.id)}" data-kind="${card.kind}">このテーマで書く</button>
        <span>${todayZeroIndex + 1} / ${deck.length}</span>
      </div>` : `<div class="today-empty">0秒思考のテーマはありません</div>`}
  </section>`;
}

// v202: TOWER描画層へconfigureToday済みの時刻ヘルパーを中継する。
function towerFlights(blocks, nowMin) {
  return coreTowerFlights(blocks, nowMin, { minutesOf });
}

function renderToday() {
  const dateISO = todayISO();
  todayRenderedDateISO = dateISO;
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

function updateTodayZeroTick() {
  const elapsed = document.getElementById("todayZeroElapsed");
  const write = typeof getTodayZeroWriteState === "function" ? getTodayZeroWriteState() : null;
  if (!elapsed || !write) return;
  const seconds = Math.max(0, Math.floor((Date.now() - write.startedAtMs) / 1000));
  elapsed.textContent = formatElapsed(seconds);
  elapsed.className = seconds >= 60 ? "is-over" : "";
}

function updateTodayTick() {
  if (state.currentView !== "today") {
    stopTodayTicker();
    return;
  }
  if (typeof document === "undefined") return;
  if (document.hidden) return;
  const dateISO = todayISO();
  if (todayRenderedDateISO !== null && dateISO !== todayRenderedDateISO) {
    todayRenderedDateISO = dateISO;
    renderDeferringForFocus();
    return;
  }
  if (document.querySelector(".today-tower")) {
    updateTodayTowerTick();
    updateTodayPomodoroTick();
    updateTodayZeroTick();
    updateTodayKindleAutoAdvance(Date.now());
    return;
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
  stopTodayKindleAutoAdvance();
}

function isTodayTickerRunning() {
  return todayTickerId !== null;
}

export {
  configureToday, renderToday, updateTodayTick, startTodayTicker, stopTodayTicker,
  isTodayTickerRunning, runningBlockOf, queueBlocksOf, towerFlights,
  deterministicReadingDeck, todayZeroDeck
};
