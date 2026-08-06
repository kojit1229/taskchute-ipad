// src/features/today.js — v182「今日」コックピット(P1〜P4)、v183(P5〜P7)。
// stateはlive bindingで読み取り、app.js側の汎用ヘルパーはconfigureToday(deps)で注入する。
// tickerは表示だけを差分更新し、日跨ぎ時だけ全再描画する。state変更・saveStateは行わない。

import { state } from "../state/store.js";
import { registerActions } from "../ui/actions.js";

let escapeHTML, todayISO, blocksForDate, minutesOf, timeFromDateTime;
let localDateTimeToMs, resolveEstimateMin, computeProjectedEnd;
let routineRate, getCategoryColor, clamp, isStaleBlock, render, renderDeferringForFocus;
let renderCircularProgress, remainingText, remainingTextNormal;
let renderPomodoroInterruptControls, getCachedReadingHighlights;
let beginTodayZeroWrite, saveTodayZeroEntry, discardTodayZeroWrite, getTodayZeroWriteState;
let homeSyncAlertBanner;
let getScheduleData, makeBlock, saveState, openBlockEditor;
let todayTickerId = null;
let todayHeavyTickCount = 0;
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
    localDateTimeToMs, resolveEstimateMin, computeProjectedEnd,
    routineRate, getCategoryColor, clamp, isStaleBlock, render, renderDeferringForFocus,
    renderCircularProgress, remainingText, remainingTextNormal,
    renderPomodoroInterruptControls, getCachedReadingHighlights,
    beginTodayZeroWrite, saveTodayZeroEntry, discardTodayZeroWrite, getTodayZeroWriteState,
    homeSyncAlertBanner, getScheduleData, makeBlock, saveState, openBlockEditor
  } = deps);
  registerActions({
    "today-kindle-prev": () => moveTodayKindle(-1),
    "today-kindle-next": () => moveTodayKindle(1),
    "today-kindle-random": () => randomTodayKindle(),
    "today-zero-prev": () => moveTodayZero(-1),
    "today-zero-next": () => moveTodayZero(1),
    "today-zero-write": ({ id, target }) => { todayZeroDraft = ""; beginTodayZeroWrite(id, target.dataset.kind === "suggestion"); },
    "today-zero-save": () => { saveTodayZeroEntry(); todayZeroDraft = ""; },
    "today-zero-cancel": () => { discardTodayZeroWrite(); todayZeroDraft = ""; },
    "today-import-external": ({ target }) => importTodayExternal(target.dataset.externalId || "")
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
  // v191(C2): ルーティン系は「未実施チップ」経由の即完了に一本化するため、
  // NOW FOCUSの対象(=実行中ブロック)からは除外する。
  return (blocks || [])
    .filter((b) => b.actualStartAt && !b.actualEndAt && b.category !== "ルーティン")
    .sort((a, b) => localDateTimeToMs(b.actualStartAt) - localDateTimeToMs(a.actualStartAt))[0] || null;
}

function queueBlocksOf(blocks) {
  // v191(C2): ルーティンはNEXT QUEUEに出さず、ROUTINEパネルのチップへ一本化する。
  return (blocks || [])
    .filter((b) => !b.completed && !b.actualStartAt && !isStaleBlock(b) && !b.oneTap && b.category !== "ルーティン")
    .sort((a, b) => {
      const aMin = a.plannedStartAt ? minutesOf(a.plannedStartAt) : Number.POSITIVE_INFINITY;
      const bMin = b.plannedStartAt ? minutesOf(b.plannedStartAt) : Number.POSITIVE_INFINITY;
      return aMin - bMin || (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0);
    })
    .slice(0, 5);
}

function routineBandFor(block) {
  const minute = block.plannedStartAt ? minutesOf(block.plannedStartAt) : 0;
  if (minute < 9 * 60) return "朝";
  if (minute < 12 * 60) return "午前";
  if (minute < 18 * 60) return "午後";
  return "夜";
}

function routineBandsOf(blocks) {
  // v191(C2): routineRate()(src/features/routine.js)は実績記録専用のoneTap Blockを
  // 除外して集計するため、帯合計=routineRate と一致させるためここでも揃える。
  const bands = ["朝", "午前", "午後", "夜"].map((label) => ({ label, done: 0, total: 0 }));
  (blocks || []).filter((b) => b.category === "ルーティン" && !b.oneTap).forEach((block) => {
    const band = bands.find((item) => item.label === routineBandFor(block));
    band.total += 1;
    if (block.completed) band.done += 1;
  });
  return bands;
}

// v191(C2)、v191レビュー反映(修正2): ROUTINEパネルの「未実施」チップ列の対象(当日の未完了・未削除・
// 非oneTapルーティンBlock)。oneTap(計時タブのカテゴリタイマー等、実績記録専用Block)は
// 誤タップで完了させる導線が無いはずのため除外する(routineRate/routineBandsOfと同じ除外)。
function undoneRoutineBlocksOf(blocks) {
  return (blocks || []).filter((b) => b.category === "ルーティン" && !b.completed && !b.deleted && !b.oneTap);
}

function actualMinutes(block, nowMs = Date.now()) {
  const startMs = localDateTimeToMs(block.actualStartAt);
  if (!startMs) return 0;
  const endMs = localDateTimeToMs(block.actualEndAt) || nowMs;
  return Math.max(0, Math.floor((endMs - startMs) / 60000));
}

function twelveWeekMinutes(blocks, nowMs = Date.now()) {
  const goalProjectIds = new Set((state.projects || [])
    .filter((p) => !p.deleted && p.kind === "normal" && p.status === "active" && p.twelveWeekStartDate)
    .map((p) => p.id));
  const goalTaskIds = new Set((state.tasks || [])
    .filter((t) => !t.deleted && goalProjectIds.has(t.projectId))
    .map((t) => t.id));
  return (blocks || []).filter((b) => goalTaskIds.has(b.taskId))
    .reduce((sum, block) => sum + actualMinutes(block, nowMs), 0);
}

function formatDuration(minutes) {
  const value = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(value / 60);
  return hours ? `${hours}時間${value % 60}分` : `${value}分`;
}

function formatElapsed(seconds) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

// C1(v192): 見積超過は警告(is-warn/is-late)ではなく中立の継続表示にする。
// サンプル(cockpit-today-fusion-sample.html JS 889-897)準拠の文言。
function nowEstimateLabel(over, estimate) {
  return over ? `見積 ${estimate}分 超過 — 完了まで計測継続` : `経過 / 見積 ${estimate}分`;
}

function projectedInfo(blocks, now = new Date()) {
  const remaining = (blocks || []).filter((b) => !b.completed);
  if (!remaining.length) return { text: "完了", comparison: "", remainingMin: 0 };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const endMin = computeProjectedEnd(todayISO(), nowMin);
  const plannedEnd = Math.max(0, ...(blocks || [])
    .filter((b) => b.plannedStartAt)
    .map((b) => minutesOf(b.plannedEndAt || b.plannedStartAt)));
  const hh = Math.floor((endMin % 1440) / 60);
  const mm = endMin % 60;
  const text = `${endMin >= 1440 ? "翌" : ""}${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  const delta = plannedEnd ? endMin - plannedEnd : 0;
  const comparison = plannedEnd ? `計画比 ${delta >= 0 ? "+" : "−"}${Math.abs(delta)}分` : "計画終端なし";
  return { text, comparison, remainingMin: Math.max(0, endMin - nowMin) };
}

function projectForBlock(block) {
  const task = (state.tasks || []).find((item) => item.id === block?.taskId);
  if (!task) return null;
  return (state.projects || []).find((project) =>
    project.id === task.projectId && !project.deleted && project.kind === "normal"
    && project.status === "active" && project.twelveWeekStartDate) || null;
}

function sectionInfo(now = new Date()) {
  const minute = now.getHours() * 60 + now.getMinutes();
  if (minute < 9 * 60) return { label: "朝", remaining: 9 * 60 - minute };
  if (minute < 12 * 60) return { label: "午前", remaining: 12 * 60 - minute };
  if (minute < 18 * 60) return { label: "午後", remaining: 18 * 60 - minute };
  return { label: "夜", remaining: Math.max(0, 24 * 60 - minute) };
}

function categoryChip(block) {
  if (!block?.category) return "";
  const color = getCategoryColor(block.category);
  return `<span class="today-chip" style="--today-category:${escapeHTML(color)}">${escapeHTML(block.category)}</span>`;
}

function panelHeading(en, ja, source) {
  return `<h2 class="today-panel-title">${en}<span>${ja}</span><b>${source}</b></h2>`;
}

function renderNowFocus(blocks, queue) {
  const running = runningBlockOf(blocks);
  if (!running) {
    const next = queue[0];
    return `<section class="today-panel today-now-focus today-span-2">
      ${panelHeading("NOW FOCUS", "いまの1手", "READY")}
      <div class="today-now-empty">
        <div><strong>${next ? escapeHTML(next.title) : "今日のBlockはありません"}</strong>
          <span>${next ? "次の1手を開始できます" : "タイムラインで今日のBlockを追加してください"}</span></div>
        ${next ? `<button class="btn primary" data-action="now-start" data-id="${escapeHTML(next.id)}">▶ 開始</button>` : ""}
      </div>
    </section>`;
  }
  const startMs = localDateTimeToMs(running.actualStartAt);
  const elapsedSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  const estimate = resolveEstimateMin(running);
  const ratio = estimate > 0 ? elapsedSec / (estimate * 60) : 0;
  const over = ratio >= 1;
  const after = queue[0];
  const goal = projectForBlock(running);
  return `<section class="today-panel today-now-focus today-span-2">
    ${panelHeading("NOW FOCUS", "いまの1手", "LIVE")}
    <div class="today-now-label"><i></i>実行中 — これだけをやる</div>
    <div class="today-now-task" data-action="edit-block" data-id="${escapeHTML(running.id)}">${escapeHTML(running.title)}</div>
    <div class="today-now-meta">${categoryChip(running)}
      <span class="today-chip">開始 ${escapeHTML(timeFromDateTime(running.actualStartAt))}</span>
      <span class="today-chip">見積 ${estimate}分</span></div>
    <div class="today-now-elapsed"><strong id="todayNowElapsed">${formatElapsed(elapsedSec)}</strong><span id="todayNowEstimate">${nowEstimateLabel(over, estimate)}</span></div>
    <div class="today-progress"><i id="todayNowProgress" class="${over ? "over" : ""}" style="width:${clamp(ratio * 100, 0, 100)}%"></i></div>
    <div class="today-now-actions">
      <button class="btn green" data-action="complete-block-with-actual" data-id="${escapeHTML(running.id)}">■ 完了</button>
      <button class="btn" data-action="now-conveyor-complete" data-id="${escapeHTML(running.id)}">▶ 次へ</button>
    </div>
    <div class="today-now-next">この後 → <em>${after ? escapeHTML(after.title) : "キューなし"}</em>
      ${goal ? ` / 12WY連動中: <em>${escapeHTML(goal.title)}</em>` : ""}</div>
  </section>`;
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

function renderNextQueue(queue) {
  return `<section class="today-panel today-next-queue today-span-2">
    ${panelHeading("NEXT QUEUE", "この後の発進順", "PLAN")}
    <div class="today-queue">${queue.length ? queue.map((block, index) => `
      <div class="today-queue-row ${index === 0 ? "is-first" : ""} ${index >= 2 ? "is-dim" : ""}">
        <span>#${index + 1}</span><time>${escapeHTML(timeFromDateTime(block.plannedStartAt) || "未定")}</time>
        <strong data-action="edit-block" data-id="${escapeHTML(block.id)}">${escapeHTML(block.title)}</strong>
        <small>${resolveEstimateMin(block)}分</small>
        ${index === 0 ? `<button data-action="now-start" data-id="${escapeHTML(block.id)}">▶ 繰上げ開始</button>` : ""}
      </div>`).join("") : `<div class="today-empty">未着手のBlockはありません</div>`}</div>
  </section>`;
}

function renderDayGauge(blocks) {
  const done = blocks.filter((b) => b.completed).length;
  const total = blocks.length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const projected = projectedInfo(blocks);
  return `<section class="today-panel today-day-gauge">
    ${panelHeading("DAY GAUGE", "今日の計器", "LIVE")}
    <div class="today-gauge-count"><strong>${done}</strong><span>/ ${total} Block完了</span></div>
    <div class="today-progress"><i style="width:${pct}%"></i></div>
    <div class="today-progress-cap"><span>0%</span><b>${pct}%</b><span>100%</span></div>
    <div class="today-kv">
      <div><span>着地予定</span><strong id="todayProjectedLanding">${projected.text}</strong><small id="todayProjectedComparison">${projected.comparison}</small></div>
      <div><span>残り見積</span><strong id="todayRemainingEstimate">${formatDuration(projected.remainingMin)}</strong></div>
      <div><span>12WY 今日</span><strong id="todayTwelveWeek">${formatDuration(twelveWeekMinutes(blocks))}</strong><small>投資済</small></div>
    </div>
  </section>`;
}

function renderRoutine(blocks) {
  const summary = routineRate(blocks);
  const bands = routineBandsOf(blocks);
  const undone = undoneRoutineBlocksOf(blocks);
  return `<section class="today-panel today-routine" data-routine-done="${summary.done}" data-routine-total="${summary.total}">
    ${panelHeading("ROUTINE", "ルーティン消化", "LIVE")}
    <div class="today-routine-list">${bands.map((band) => {
      const pct = band.total ? Math.round(band.done / band.total * 100) : 0;
      return `<div class="today-routine-row"><span>${band.label}</span>
        <div><i style="width:${pct}%"></i></div><b>${band.done} / ${band.total}</b></div>`;
    }).join("")}</div>
    <div class="today-routine-total">合計 完了${summary.done}件・対象${summary.total}件(${summary.pct}%)</div>
    ${undone.length ? `<div class="today-routine-undone">
      <div class="today-routine-undone-label">未実施 — タップで完了</div>
      <div class="today-routine-undone-chips">${undone.map((b) => {
        // v191レビュー反映(修正3): 実行中(actualStartAtあり・actualEndAtなし)はチップに残しつつ視覚区別する。
        // v191レビュー反映(修正7・2周目): タップは now-conveyor-complete(app.js既存アクション)を使う。
        // state.pomodoro.blockId と一致すればcompletePomodoro()(Block完了+ポモ後始末を一括)、
        // 一致しなければ従来どおりtoggleBlock(id)に委譲される(新規ロジックは追加していない)。
        const running = Boolean(b.actualStartAt && !b.actualEndAt);
        return `<button type="button" class="today-chip today-routine-chip${running ? " is-running" : ""}" data-action="now-conveyor-complete" data-id="${escapeHTML(b.id)}">${running ? "▶ " : ""}${escapeHTML(b.title)}</button>`;
      }).join("")}</div>
    </div>` : ""}
  </section>`;
}

function flightPosition(minute) {
  return clamp((minute - 6 * 60) / (18 * 60) * 100, 0, 100);
}

function todayExternalEvents() {
  const data = typeof getScheduleData === "function" ? getScheduleData() : undefined;
  return (data?.events || []).filter((event) =>
    event.date === todayISO() && event.label === "こーじ" && !event.allDay
    && event.startAt && event.endAt);
}

function importedExternalBlock(externalId) {
  return (state.blocks || []).find((block) =>
    !block.deleted && block.externalRef === externalId) || null;
}

function externalDateTime(date, time) {
  return date && time ? `${date}T${time}:00` : "";
}

function importTodayExternal(externalId) {
  if (!externalId || importedExternalBlock(externalId)) return;
  const event = todayExternalEvents().find((item) => item.externalId === externalId);
  if (!event) return;
  const block = makeBlock({
    date: event.date,
    title: event.title,
    category: "",
    externalRef: event.externalId,
    label: event.label,
    plannedStartAt: externalDateTime(event.date, event.startAt),
    plannedEndAt: externalDateTime(event.date, event.endAt)
  });
  block.externalRef = event.externalId;
  block.label = event.label;
  state.blocks.push(block);
  saveState();
  render();
  openBlockEditor(block.id);
}

function renderFlightPlan(blocks) {
  // v191(C2): ルーティンはFLIGHT PLANの帯に出さない(ROUTINEパネルへ一本化)。
  // TimeTree外部予定(todayExternalEvents由来)の扱いは現状維持。
  const candidates = blocks.filter((b) => b.plannedStartAt && b.category !== "ルーティン").map((block, index) => {
    const start = minutesOf(block.plannedStartAt);
    const rawEnd = block.plannedEndAt ? minutesOf(block.plannedEndAt) : start + resolveEstimateMin(block);
    const end = rawEnd < start ? 24 * 60 : rawEnd;
    if (end <= 6 * 60 || start >= 24 * 60) return null;
    return { block, index, start: Math.max(6 * 60, start), end: Math.min(24 * 60, Math.max(start + 1, end)) };
  }).filter(Boolean).sort((a, b) => a.start - b.start || a.index - b.index);
  const laneEnds = [];
  const externalLaneEnds = [];
  const external = todayExternalEvents().map((event, index) => {
    const start = minutesOf(event.startAt);
    const rawEnd = minutesOf(event.endAt);
    const end = rawEnd <= start ? 24 * 60 : rawEnd;
    if (end <= 6 * 60 || start >= 24 * 60) return null;
    return {
      event,
      index,
      start: Math.max(6 * 60, start),
      end: Math.min(24 * 60, Math.max(start + 1, end))
    };
  }).filter(Boolean).sort((a, b) => a.start - b.start || a.index - b.index)
    .map(({ event, start, end }) => {
      let lane = externalLaneEnds.findIndex((laneEnd) => laneEnd <= start);
      if (lane === -1) lane = externalLaneEnds.length;
      externalLaneEnds[lane] = end;
      const left = flightPosition(start);
      const right = flightPosition(end);
      const imported = Boolean(importedExternalBlock(event.externalId));
      return `<button type="button" class="today-flight-tt${imported ? " is-imported" : ""}"
        style="left:${left}%;width:${Math.max(0.8, right - left)}%;top:${20 + lane * 18}px"
        data-action="today-import-external" data-external-id="${escapeHTML(event.externalId)}"
        title="${escapeHTML(event.title)}">TT ${escapeHTML(event.title)}</button>`;
    });
  const plannedTop = 24 + externalLaneEnds.length * 18;
  const planned = candidates.map(({ block, start, end }) => {
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = end;
    const left = flightPosition(start);
    const right = flightPosition(end);
    const status = block.completed ? "is-done" : block.actualStartAt && !block.actualEndAt ? "is-now" : "is-todo";
    return `<button class="today-flight-block ${status}" style="left:${left}%;width:${Math.max(0.8, right - left)}%;top:${plannedTop + lane * 33}px"
      data-action="edit-block" data-id="${escapeHTML(block.id)}" title="${escapeHTML(block.title)}">${escapeHTML(block.title)}</button>`;
  });
  const now = new Date();
  const nowPos = flightPosition(now.getHours() * 60 + now.getMinutes());
  const grid = [6, 9, 12, 15, 18, 21, 24].map((hour) =>
    `<i class="today-flight-hour ${hour === 24 ? "is-end" : ""}" style="left:${flightPosition(hour * 60)}%"><span>${String(hour).padStart(2, "0")}</span></i>`).join("");
  const trackHeight = 72 + externalLaneEnds.length * 18 + Math.max(0, laneEnds.length - 1) * 33;
  return `<section class="today-panel today-flight-plan today-span-2">
    ${panelHeading("FLIGHT PLAN", "今日の航路 — 緑=完了 / 青=実行中 / 灰=これから", "PLAN")}
    <div class="today-flight-track" style="--today-flight-track-height:${trackHeight}px">${grid}${external.join("")}${planned.join("")}
      <i class="today-flight-now" id="todayFlightNow" style="left:${nowPos}%"></i>
      ${planned.length || external.length ? "" : `<span class="today-flight-empty">予定Blockはありません</span>`}
    </div>
    <div class="today-flight-cap"><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
  </section>`;
}

function renderToday() {
  const dateISO = todayISO();
  todayRenderedDateISO = dateISO;
  const blocks = blocksForDate(dateISO);
  const queue = queueBlocksOf(blocks);
  const done = blocks.filter((b) => b.completed).length;
  const progress = blocks.length ? Math.round(done / blocks.length * 100) : 0;
  const projected = projectedInfo(blocks);
  const section = sectionInfo();
  const now = new Date();
  startTodayTicker();
  // v183: 同期停止の赤帯バナーはhome専用だったが、起動ビューがtodayになったため
  //       「1日中開きっぱなし」の本ビューにも出す(出さないと同期停止に気づけない。CI v134で検出)
  return `<div class="today-cockpit">
    ${homeSyncAlertBanner()}
    <header class="today-header">
      <div><div class="today-eyebrow">TASKCHUTE DECK</div><h1>今日 <span>管制室</span></h1></div>
      <div class="today-head-stats">PROGRESS <b id="todayHeaderProgress">${done}/${blocks.length} (${progress}%)</b> /
        着地 <b id="todayHeaderLanding">${projected.text}</b> /
        <span id="todayHeaderSection">${section.label} 残り ${section.remaining}分</span></div>
      <div class="today-clock"><strong id="todayClock">${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}</strong>
        <span id="todayDate">${dateISO} (${["日", "月", "火", "水", "木", "金", "土"][now.getDay()]})</span></div>
    </header>
    <div class="today-deck">
      ${renderNowFocus(blocks, queue)}
      ${renderTodayPomodoro(blocks, queue)}
      ${renderNextQueue(queue)}
      ${renderDayGauge(blocks)}
      ${renderRoutine(blocks)}
      ${renderFlightPlan(blocks)}
      ${renderTodayKindle()}
      ${renderTodayZero()}
    </div>
  </div>`;
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
  const clock = document.getElementById("todayClock");
  if (!clock) return;
  if (document.hidden) return;
  const dateISO = todayISO();
  if (todayRenderedDateISO !== null && dateISO !== todayRenderedDateISO) {
    todayRenderedDateISO = dateISO;
    renderDeferringForFocus();
    return;
  }
  const now = new Date();
  clock.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const blocks = blocksForDate(dateISO);
  const running = runningBlockOf(blocks);
  const elapsed = document.getElementById("todayNowElapsed");
  const bar = document.getElementById("todayNowProgress");
  if (running && elapsed) {
    const seconds = Math.max(0, Math.floor((Date.now() - localDateTimeToMs(running.actualStartAt)) / 1000));
    const estimate = resolveEstimateMin(running);
    const ratio = estimate > 0 ? seconds / (estimate * 60) : 0;
    const over = ratio >= 1;
    elapsed.textContent = formatElapsed(seconds);
    if (bar) {
      bar.style.width = `${clamp(ratio * 100, 0, 100)}%`;
      bar.classList.toggle("over", over);
    }
    const estimateEl = document.getElementById("todayNowEstimate");
    if (estimateEl) estimateEl.textContent = nowEstimateLabel(over, estimate);
  }
  const runHeavyUpdates = todayHeavyTickCount === 0;
  todayHeavyTickCount = (todayHeavyTickCount + 1) % 30;
  if (runHeavyUpdates) {
    const projected = projectedInfo(blocks, now);
    const landing = document.getElementById("todayProjectedLanding");
    const comparison = document.getElementById("todayProjectedComparison");
    const remaining = document.getElementById("todayRemainingEstimate");
    const headerLanding = document.getElementById("todayHeaderLanding");
    if (landing) landing.textContent = projected.text;
    if (comparison) comparison.textContent = projected.comparison;
    if (remaining) remaining.textContent = formatDuration(projected.remainingMin);
    if (headerLanding) headerLanding.textContent = projected.text;
    const twelveWeek = document.getElementById("todayTwelveWeek");
    if (twelveWeek) twelveWeek.textContent = formatDuration(twelveWeekMinutes(blocks));
  }
  const section = document.getElementById("todayHeaderSection");
  const sectionValue = sectionInfo(now);
  if (section) section.textContent = `${sectionValue.label} 残り ${sectionValue.remaining}分`;
  const nowLine = document.getElementById("todayFlightNow");
  if (nowLine) nowLine.style.left = `${flightPosition(now.getHours() * 60 + now.getMinutes())}%`;
  updateTodayPomodoroTick();
  updateTodayZeroTick();
  updateTodayKindleAutoAdvance(Date.now());
}

function startTodayTicker() {
  if (todayTickerId !== null || typeof document === "undefined") return;
  todayHeavyTickCount = 0;
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
  isTodayTickerRunning, runningBlockOf, queueBlocksOf, routineBandsOf,
  undoneRoutineBlocksOf, twelveWeekMinutes, projectedInfo, flightPosition,
  deterministicReadingDeck, todayZeroDeck
};
