// src/features/today.js — v182「今日」コックピット(P1〜P4)。
// stateはlive bindingで読み取り、app.js側の汎用ヘルパーはconfigureToday(deps)で注入する。
// tickerは表示だけを差分更新し、state変更・saveState・renderを一切行わない。

import { state } from "../state/store.js";

let escapeHTML, todayISO, blocksForDate, minutesOf, timeFromDateTime;
let localDateTimeToMs, resolveEstimateMin, computeProjectedEnd;
let routineRate, getCategoryColor, clamp;
let todayTickerId = null;

function configureToday(deps) {
  ({
    escapeHTML, todayISO, blocksForDate, minutesOf, timeFromDateTime,
    localDateTimeToMs, resolveEstimateMin, computeProjectedEnd,
    routineRate, getCategoryColor, clamp
  } = deps);
}

function runningBlockOf(blocks) {
  return (blocks || [])
    .filter((b) => b.actualStartAt && !b.actualEndAt)
    .sort((a, b) => localDateTimeToMs(b.actualStartAt) - localDateTimeToMs(a.actualStartAt))[0] || null;
}

function queueBlocksOf(blocks) {
  return (blocks || [])
    .filter((b) => !b.completed && !b.actualStartAt)
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
  const bands = ["朝", "午前", "午後", "夜"].map((label) => ({ label, done: 0, total: 0 }));
  (blocks || []).filter((b) => b.category === "ルーティン").forEach((block) => {
    const band = bands.find((item) => item.label === routineBandFor(block));
    band.total += 1;
    if (block.completed) band.done += 1;
  });
  return bands;
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
  return `<span class="today-chip" style="--today-category:${color}">${escapeHTML(block.category)}</span>`;
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
  const level = ratio >= 1 ? "is-late" : ratio >= 0.8 ? "is-warn" : "";
  const after = queue[0];
  const goal = projectForBlock(running);
  return `<section class="today-panel today-now-focus today-span-2 ${level}">
    ${panelHeading("NOW FOCUS", "いまの1手", "LIVE")}
    <div class="today-now-label"><i></i>実行中 — これだけをやる</div>
    <div class="today-now-task" data-action="edit-block" data-id="${escapeHTML(running.id)}">${escapeHTML(running.title)}</div>
    <div class="today-now-meta">${categoryChip(running)}
      <span class="today-chip">開始 ${escapeHTML(timeFromDateTime(running.actualStartAt))}</span>
      <span class="today-chip">見積 ${estimate}分</span></div>
    <div class="today-now-elapsed"><strong id="todayNowElapsed">${formatElapsed(elapsedSec)}</strong><span>経過 / 見積 ${estimate}分</span></div>
    <div class="today-progress"><i id="todayNowProgress" style="width:${clamp(ratio * 100, 0, 100)}%"></i></div>
    <div class="today-now-actions">
      <button class="btn green" data-action="complete-block-with-actual" data-id="${escapeHTML(running.id)}">■ 完了</button>
      <button class="btn" data-action="now-conveyor-complete" data-id="${escapeHTML(running.id)}">▶ 次へ</button>
    </div>
    <div class="today-now-next">この後 → <em>${after ? escapeHTML(after.title) : "キューなし"}</em>
      ${goal ? ` / 12WY連動中: <em>${escapeHTML(goal.title)}</em>` : ""}</div>
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
  return `<section class="today-panel today-routine" data-routine-done="${summary.done}" data-routine-total="${summary.total}">
    ${panelHeading("ROUTINE", "ルーティン消化", "LIVE")}
    <div class="today-routine-list">${bands.map((band) => {
      const pct = band.total ? Math.round(band.done / band.total * 100) : 0;
      return `<div class="today-routine-row"><span>${band.label}</span>
        <div><i style="width:${pct}%"></i></div><b>${band.done} / ${band.total}</b></div>`;
    }).join("")}</div>
    <div class="today-routine-total">合計 完了${summary.done}件・対象${summary.total}件(${summary.pct}%)</div>
  </section>`;
}

function flightPosition(minute) {
  return clamp((minute - 6 * 60) / (18 * 60) * 100, 0, 100);
}

function renderFlightPlan(blocks) {
  const planned = blocks.filter((b) => b.plannedStartAt).map((block) => {
    const start = minutesOf(block.plannedStartAt);
    const end = block.plannedEndAt ? minutesOf(block.plannedEndAt) : start + resolveEstimateMin(block);
    if (end <= 6 * 60 || start >= 24 * 60) return "";
    const left = flightPosition(start);
    const right = flightPosition(Math.max(start + 1, end));
    const status = block.completed ? "is-done" : block.actualStartAt && !block.actualEndAt ? "is-now" : "is-todo";
    return `<button class="today-flight-block ${status}" style="left:${left}%;width:${Math.max(0.8, right - left)}%"
      data-action="edit-block" data-id="${escapeHTML(block.id)}" title="${escapeHTML(block.title)}">${escapeHTML(block.title)}</button>`;
  }).filter(Boolean);
  const now = new Date();
  const nowPos = flightPosition(now.getHours() * 60 + now.getMinutes());
  const grid = [6, 9, 12, 15, 18, 21, 24].map((hour) =>
    `<i class="today-flight-hour" style="left:${flightPosition(hour * 60)}%"><span>${String(hour).padStart(2, "0")}</span></i>`).join("");
  return `<section class="today-panel today-flight-plan today-span-2">
    ${panelHeading("FLIGHT PLAN", "今日の航路 — 緑=完了 / 青=実行中 / 灰=これから", "PLAN")}
    <div class="today-flight-track">${grid}${planned.join("")}
      <i class="today-flight-now" id="todayFlightNow" style="left:${nowPos}%"></i>
      ${planned.length ? "" : `<span class="today-flight-empty">予定Blockはありません</span>`}
    </div>
    <div class="today-flight-cap"><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
  </section>`;
}

function renderToday() {
  const blocks = blocksForDate(todayISO());
  const queue = queueBlocksOf(blocks);
  const done = blocks.filter((b) => b.completed).length;
  const progress = blocks.length ? Math.round(done / blocks.length * 100) : 0;
  const projected = projectedInfo(blocks);
  const section = sectionInfo();
  const now = new Date();
  startTodayTicker();
  return `<div class="today-cockpit">
    <header class="today-header">
      <div><div class="today-eyebrow">TASKCHUTE DECK</div><h1>今日 <span>管制室</span></h1></div>
      <div class="today-head-stats">PROGRESS <b id="todayHeaderProgress">${done}/${blocks.length} (${progress}%)</b> /
        着地 <b id="todayHeaderLanding">${projected.text}</b> /
        <span id="todayHeaderSection">${section.label} 残り ${section.remaining}分</span></div>
      <div class="today-clock"><strong id="todayClock">${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}</strong>
        <span id="todayDate">${todayISO()} (${["日", "月", "火", "水", "木", "金", "土"][now.getDay()]})</span></div>
    </header>
    <div class="today-deck">
      ${renderNowFocus(blocks, queue)}
      ${renderNextQueue(queue)}
      ${renderDayGauge(blocks)}
      ${renderRoutine(blocks)}
      ${renderFlightPlan(blocks)}
    </div>
  </div>`;
}

function updateTodayTick() {
  if (state.currentView !== "today") {
    stopTodayTicker();
    return;
  }
  if (typeof document === "undefined" || document.hidden) return;
  const now = new Date();
  const clock = document.getElementById("todayClock");
  if (clock) clock.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const blocks = blocksForDate(todayISO());
  const running = runningBlockOf(blocks);
  const elapsed = document.getElementById("todayNowElapsed");
  const bar = document.getElementById("todayNowProgress");
  if (running && elapsed) {
    const seconds = Math.max(0, Math.floor((Date.now() - localDateTimeToMs(running.actualStartAt)) / 1000));
    const estimate = resolveEstimateMin(running);
    const ratio = estimate > 0 ? seconds / (estimate * 60) : 0;
    elapsed.textContent = formatElapsed(seconds);
    elapsed.className = ratio >= 1 ? "is-late" : ratio >= 0.8 ? "is-warn" : "";
    if (bar) {
      bar.style.width = `${clamp(ratio * 100, 0, 100)}%`;
      bar.className = ratio >= 1 ? "is-late" : ratio >= 0.8 ? "is-warn" : "";
    }
  }
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
  const section = document.getElementById("todayHeaderSection");
  const sectionValue = sectionInfo(now);
  if (section) section.textContent = `${sectionValue.label} 残り ${sectionValue.remaining}分`;
  const nowLine = document.getElementById("todayFlightNow");
  if (nowLine) nowLine.style.left = `${flightPosition(now.getHours() * 60 + now.getMinutes())}%`;
}

function startTodayTicker() {
  if (todayTickerId !== null || typeof document === "undefined") return;
  todayTickerId = setInterval(updateTodayTick, 1000);
}

function stopTodayTicker() {
  if (todayTickerId === null) return;
  clearInterval(todayTickerId);
  todayTickerId = null;
}

function isTodayTickerRunning() {
  return todayTickerId !== null;
}

export {
  configureToday, renderToday, updateTodayTick, startTodayTicker, stopTodayTicker,
  isTodayTickerRunning, runningBlockOf, queueBlocksOf, routineBandsOf,
  twelveWeekMinutes, projectedInfo, flightPosition
};
