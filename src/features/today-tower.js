// src/features/today-tower.js — v229: ARRIVALS見積列・GATE編集・早起きゲートを統合。
// state・保存・action登録には触れず、時刻・便状態・信条は既存1秒tickerから差分更新する。

import { renderLifeBand, renderStandingOrders } from "./topband.js";

let escapeHTML, todayISO, syncAlertBanner, blocksForDate, towerFlights;
let runningBlockOf, queueBlocksOf, localDateTimeToMs, resolveEstimateMin, minutesOf, timeFromDateTime, clamp;
let isStaleBlock;
let towerMotionSetting;
let renderTodayPomodoro;
let todayFocusVisibility, renderTodayFocusBar;
let journalForDate;
let gateRules, earlyBirdLogForDate, earlyRiseTarget, linkedGymBlock, gateEditMode;
let scheduledTasksForDate;
let bodyScansForDate;
let _bmWeeklyOpen = false;  // v297: BODY/MINDウィジェットの週推移開閉(表示専用・stateへは書かない)
let flipListenerBound = false;
// undefined=セッション初回(未観測)。復元描画では接地の瞬間ではないためフラッシュを出さない
// (起動時同期404後の全体render()と競合して非決定にもなる)。null=実行中なしを観測済み。
let lastLandingId;
let lastGateDocked;
// undefined=未観測。復元描画では満灯フラッシュを出さない(lastLandingIdと同じ意味論)。
let lastGateFull;
let lastFlightLogDate;
let lastFlightLogKeys;
let _towerArrivalSelectedId = null;

function setTowerArrivalSelection(id) {
  _towerArrivalSelectedId = id || null;
  if (typeof document !== "undefined") {
    const now = new Date();
    const blocks = blocksForDate(todayISO());
    updateTowerArrivalSelection(blocks, boardFlights(blocks, now.getHours() * 60 + now.getMinutes(), scheduledTasksForDate(todayISO(), blocks)), true);
  }
}

function configureTodayTower(deps) {
  ({
    escapeHTML, todayISO, syncAlertBanner, blocksForDate, towerFlights,
    runningBlockOf, queueBlocksOf, localDateTimeToMs, resolveEstimateMin, minutesOf, timeFromDateTime, clamp, isStaleBlock,
    towerMotionSetting, renderTodayPomodoro, todayFocusVisibility, renderTodayFocusBar, journalForDate,
    gateRules, earlyBirdLogForDate, earlyRiseTarget, linkedGymBlock, scheduledTasksForDate, gateEditMode,
    bodyScansForDate
  } = deps);
  if (!flipListenerBound && typeof document !== "undefined") {
    document.addEventListener("animationend", (event) => {
      if (event.target.classList?.contains("tower-touchdown")) event.target.remove();
      else if (event.target.classList?.contains("tower-status")) event.target.classList.remove("is-flip");
      else if (event.target.classList?.contains("tower-log-row")) event.target.classList.remove("is-flip");
      else if (event.target.classList?.contains("tower-gate")) event.target.classList.remove("is-docking");
      else if (event.target.classList?.contains("tower-gates")) event.target.classList.remove("is-full-flash");
    });
    document.addEventListener("visibilitychange", () => {
      const root = document.querySelector(".today-tower");
      if (root) root.dataset.paused = document.hidden ? "1" : "0";
    });
    flipListenerBound = true;
  }
}

function clockText(now) {
  return [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((value) => String(value).padStart(2, "0")).join(":");
}

function dayLeftText(now) {
  const seconds = 24 * 60 * 60 - (now.getHours() * 60 * 60 + now.getMinutes() * 60 + now.getSeconds());
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function isNightHour(hour) {
  return hour >= 21 || hour < 5;
}

// v274: GLASSのぼかし縮退は端末ローカル専用。stateや保存経路へ混ぜず、描画時に読むだけにする。
function glassBlurOff() {
  try {
    return globalThis.localStorage?.getItem("taskchute-journal-glass-blur-off") === "1";
  } catch {
    return false;
  }
}

function boardFlights(blocks, nowMin, tasks = []) {
  const candidates = blocks.filter((block) => !block.completed && !block.actualEndAt && block.category !== "ルーティン" && !block.oneTap);
  const byId = new Map(candidates.map((block) => [String(block.id), block]));
  const blockFlights = towerFlights(candidates, nowMin).map((flight) => ({
    ...flight, estimateMin: resolveEstimateMin(byId.get(String(flight.id)))
  }));
  const taskFlights = tasks.map((task) => ({
    id: `task:${task.id}`, taskId: task.id, kind: "task-plan", title: task.title,
    plannedMin: null, estimateMin: Number(task.estimateMin), status: "scheduled", label: "予定"
  }));
  return [...blockFlights, ...taskFlights];
}

// v311: ARRIVALSのBlock便を再利用し、NOW LANDING便だけを先頭の強調枠へ分離する。
function pomodoroLinkFlights() {
  const now = new Date();
  const blocks = blocksForDate(todayISO());
  const flights = boardFlights(blocks, now.getHours() * 60 + now.getMinutes());
  const running = runningBlockOf(blocks);
  const nowFlight = running ? flights.find((flight) => String(flight.id) === String(running.id)) || {
    ...running, plannedMin: minutesOf(running.plannedStartAt || running.actualStartAt)
  } : null;
  return {
    nowFlight,
    arrivals: flights.filter((flight) => !nowFlight || String(flight.id) !== String(nowFlight.id))
  };
}

function arrivalWindow(flights) {
  if (!flights.length) return { rows: [], omitted: 0 };
  let center = flights.findIndex((flight) => flight.status === "landing");
  if (center < 0) center = flights.findIndex((flight) => flight.status === "final");
  // レビューM1反映: 全便未着手のまま時間が過ぎた日は「直近の過去便(最後のリスロット)」を中心にする(朝への張り付き防止)。
  if (center < 0) for (let i = flights.length - 1; i >= 0; i--) if (flights[i].status === "resloted") { center = i; break; }
  if (center < 0) center = flights.findIndex((flight) => flight.status === "holding");
  if (center < 0) center = flights.findIndex((flight) => flight.status === "scheduled");
  if (center < 0) center = flights.length - 1;
  const rows = flights.slice(Math.max(0, center - 5), center + 6);
  return { rows, omitted: flights.length - rows.length };
}

function flightTime(minute) {
  if (minute === null) return "--:--";
  return `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function flightSetKey(flights) {
  return flights.map((flight) => encodeURIComponent(String(flight.id))).join(",");
}

function runwayMetrics(running, nowMs) {
  const startMs = localDateTimeToMs(running.actualStartAt);
  const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const estimate = running.estimateMin === 0 ? 0 : resolveEstimateMin(running);
  const ratio = estimate > 0 ? elapsedSec / (estimate * 60) : 0;
  const over = estimate > 0 && ratio >= 1;
  const minutes = over
    ? Math.max(0, Math.ceil(elapsedSec / 60 - estimate))
    : Math.max(0, Math.ceil(estimate - elapsedSec / 60));
  return {
    x: clamp(ratio * 100, 0, 100), over,
    start: timeFromDateTime(running.actualStartAt) || "--:--",
    landing: estimate > 0 ? flightTime(minutesOf(running.actualStartAt) + estimate) : "--:--",
    pct: Math.round(clamp(ratio * 100, 0, 100)),
    remain: estimate <= 0 ? "見積なし" : over ? `ロングフライト +${minutes}分` : `残り ${minutes}分`
  };
}

function runwayArrivalSelection(blocks, flights) {
  const fallback = queueBlocksOf(blocks)[0] || null;
  const blocksById = new Map(blocks.map((block) => [String(block.id), block]));
  const candidates = arrivalWindow(flights).rows.filter((flight) => flight.kind !== "task-plan"
    && ["holding", "final", "resloted"].includes(flight.status)
    && !isStaleBlock(blocksById.get(String(flight.id))));
  const selected = candidates.find((flight) => String(flight.id) === String(_towerArrivalSelectedId))
    || candidates.find((flight) => String(flight.id) === String(fallback?.id)) || fallback;
  return { candidates, selected };
}

function towerArrivalOptions(selection) {
  const next = selection.selected;
  if (!next || !selection.candidates.length) return "";
  const selectedInWindow = selection.candidates.some((flight) => String(flight.id) === String(next.id));
  const optionFlights = selectedInWindow ? selection.candidates : [{
    id: next.id, title: next.title, plannedMin: next.plannedStartAt ? minutesOf(next.plannedStartAt) : null, hidden: true
  }, ...selection.candidates];
  return optionFlights.map((flight) => `<option value="${escapeHTML(flight.id)}" ${String(flight.id) === String(next.id) ? "selected" : ""} ${flight.hidden ? "hidden" : ""}>${flightTime(flight.plannedMin)} ${escapeHTML(flight.title)}</option>`).join("");
}

function towerArrivalSelectionKey(selection) {
  return `${encodeURIComponent(String(selection.selected?.id || ""))}|${flightSetKey(selection.candidates)}`;
}

function renderTowerRunway(now, blocks, flights) {
  const running = runningBlockOf(blocks);
  const selection = running ? null : runwayArrivalSelection(blocks, flights);
  const next = selection?.selected || null;
  const metrics = running ? runwayMetrics(running, now.getTime()) : { x: 0 };
  // フラッシュは#towerPlaneの兄弟でCSS変数を継承しないため、自身にも機体位置を持たせる(レビューM1)。
  const touchdown = running && lastLandingId !== undefined && running.id !== lastLandingId
    ? `<i class="tower-touchdown" aria-hidden="true" style="--tower-plane-x:${metrics.x}%"></i>` : "";
  lastLandingId = running ? running.id : null;
  let hud = '<div class="tower-nowhud" data-status="empty">滑走路オープン ─ 次の便を選んで開始できます</div>';
  if (running) {
    const id = escapeHTML(running.id);
    const ironLink = typeof linkedGymBlock === "function"
      && linkedGymBlock(blocks, now.getHours() * 60 + now.getMinutes())
      ? '<button class="tower-ironlog-link" data-action="open-iron-log">▶ IRON LOG</button>' : "";
    hud = `<div class="tower-nowhud" data-status="${metrics.over ? "long" : "landing"}">
      <button type="button" class="tower-now-title" data-action="edit-block" data-id="${id}">${escapeHTML(running.title)}</button>
      <span class="tower-now-pct" id="towerNowPct">進捗 ${metrics.pct}%</span>
      <strong id="towerNowRemain">${metrics.remain}</strong>
      <div class="tower-now-actions">
        ${ironLink}
        <button type="button" class="btn green" data-action="complete-block-with-actual" data-id="${id}">■ 完了</button>
        <button type="button" class="btn" data-action="now-conveyor-complete" data-id="${id}">▶ 次へ</button>
      </div>
    </div>`;
  } else if (next) {
    const id = escapeHTML(next.id);
    const candidateOptions = towerArrivalOptions(selection);
    hud = `<div class="tower-nowhud" data-status="ready">
      <button type="button" class="tower-now-title" data-action="edit-block" data-id="${id}">${escapeHTML(next.title)}</button>
      ${candidateOptions ? `<select class="tower-arrival-select" data-tower-arrival-select data-arrival-set="${escapeHTML(towerArrivalSelectionKey(selection))}" aria-label="開始するARRIVALS便">${candidateOptions}</select>` : ""}
      <button type="button" class="btn primary" data-action="now-start" data-id="${id}">▶ 開始</button>
    </div>`;
  }
  return `<section class="tower-runway sec-rwy now-hero">
    <h2>NOW LANDING <span>滑走路</span></h2>
    <div class="tower-runway-strip">
      <i id="towerPlane" aria-hidden="true" style="--tower-plane-x:${metrics.x}%">✈</i>${touchdown}
      ${running ? `<span class="tower-rwy-mark start">${escapeHTML(metrics.start)} 開始</span>
      <span class="tower-rwy-mark end">${escapeHTML(metrics.landing)} 着陸予定</span>` : ""}
    </div>
    ${hud}
  </section>`;
}

function flightRow(flight) {
  const status = `<span class="tower-status" data-status="${escapeHTML(flight.status)}">${escapeHTML(flight.label)}</span>`;
  if (flight.kind === "task-plan") {
    return `<button type="button" class="tower-flight-row tower-arrival-row tower-task-plan" data-flight-id="${escapeHTML(flight.id)}" data-kind="task-plan" data-status="scheduled" data-action="task-today" data-id="${escapeHTML(flight.taskId)}">
      <time>--:--</time><span class="tower-flight-title">${escapeHTML(flight.title)}</span>
      <span class="tower-flight-est">${escapeHTML(flight.estimateMin)}分</span>${status}
    </button>`;
  }
  return `<div class="tower-flight-row tower-arrival-row" data-flight-id="${escapeHTML(flight.id)}" data-status="${escapeHTML(flight.status)}">
    <time>${flightTime(flight.plannedMin)}</time>
    <button type="button" class="tower-flight-title" data-action="edit-block" data-id="${escapeHTML(flight.id)}">${escapeHTML(flight.title)}</button>
    <span class="tower-flight-est">${escapeHTML(flight.estimateMin)}分</span>${status}
  </div>`;
}

function renderTowerBoard(arrivalFlights) {
  const arrivals = arrivalWindow(arrivalFlights);
  return `<section class="tower-board sec-arrivals">
    <div class="tower-arrivals"><h2>ARRIVALS <span>本日</span></h2>
      <div id="towerArrivalRows" data-flight-set="${flightSetKey(arrivalFlights)}">${arrivals.rows.map((flight) => flightRow(flight)).join("")}</div>
      <div class="tower-flight-summary" id="towerArrivalSummary">${arrivals.omitted ? `他 ${arrivals.omitted} 便` : ""}</div>
    </div>
  </section>`;
}

function flightLogDuration(block) {
  if (!block.actualStartAt || !block.actualEndAt) return "—";
  const minutes = Math.max(0, Math.round((localDateTimeToMs(block.actualEndAt) - localDateTimeToMs(block.actualStartAt)) / 60000));
  return `${minutes}分`;
}

function renderFlightLog(date, blocks) {
  const completed = blocks
    .filter((block) => block.actualEndAt)
    .sort((a, b) => String(a.actualEndAt).localeCompare(String(b.actualEndAt)));
  const keys = new Set(completed.map((block) => `${block.id}:${block.actualEndAt}`));
  const latest = completed[completed.length - 1];
  const latestKey = latest ? `${latest.id}:${latest.actualEndAt}` : "";
  const flashLatest = lastFlightLogDate === date && lastFlightLogKeys instanceof Set
    && latestKey && !lastFlightLogKeys.has(latestKey);
  lastFlightLogDate = date;
  lastFlightLogKeys = keys;
  const rows = completed.map((block) => {
    const isLatest = flashLatest && block === latest;
    const start = timeFromDateTime(block.actualStartAt) || "--:--";
    const end = timeFromDateTime(block.actualEndAt) || "--:--";
    return `<button type="button" class="tower-log-row${isLatest ? " is-flip" : ""}" data-flight-id="${escapeHTML(block.id)}" data-action="edit-block" data-id="${escapeHTML(block.id)}">
      <time>${start}-${end}</time><span class="tower-log-title">${escapeHTML(block.title)}</span>
      <span class="tower-log-dur">${flightLogDuration(block)}</span>
      <span class="tower-log-state" data-state="${block.completed ? "completed" : "ended"}">${block.completed ? "完了" : "終了"}</span>
      ${isLatest ? '<i class="tower-touchdown" aria-hidden="true" style="--tower-plane-x:50%"></i>' : ""}
    </button>`;
  }).join("");
  return `<section class="tower-panel-box sec-log">
    <h2>FLIGHT LOG <span>本日の航跡・終了実績</span></h2>
    <div id="towerFlightLog">${rows || '<div class="tower-log-empty">終了実績はまだありません</div>'}</div>
    <div class="tower-log-foot">終了実績を時系列で表示</div>
  </section>`;
}

function renderTowerJournal(date) {
  const journal = journalForDate(date);
  return `<section class="tower-panel-box sec-journal">
    <h2>JOURNAL <span>ジャーナル</span></h2>
    <div class="tower-journal-body">
      <label class="tower-journal-label" for="towerJournalFree">FREE NOTE <span>自由記述</span></label>
      <textarea id="towerJournalFree" placeholder="気づき・所感をそのまま書く">${escapeHTML(journal.free)}</textarea>
      <label class="tower-journal-label" for="towerJournalAi">AI DISPATCH <span>AIに依頼すること</span></label>
      <textarea id="towerJournalAi" placeholder="夜のAIバッチへの依頼・質問">${escapeHTML(journal.aiRequest)}</textarea>
      <button type="button" class="tower-journal-save" data-action="save-tower-journal" data-date="${escapeHTML(date)}">SAVE 記録</button>
    </div>
  </section>`;
}

function orderedGateRules() {
  return (gateRules() || []).map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => !rule.deleted && rule.category === "ルーティン")
    .sort((a, b) => (Number.isFinite(a.rule.order) ? a.rule.order : a.index)
      - (Number.isFinite(b.rule.order) ? b.rule.order : b.index))
    .map(({ rule }) => rule);
}

// v276: app.jsのワンタップ実績補完とGATE描画で母集団条件を共有する。
// oneTapだけを条件にすると非ルーティンが混入するため、categoryを正本にして除外条件も揃える。
export function isRoutineGateBlock(block) {
  return block?.category === "ルーティン" && !block.oneTap && !block.deleted;
}

function orderedGateBlocks(blocks) {
  const order = new Map(orderedGateRules().map((rule, index) => [String(rule.id), Number.isFinite(rule.order) ? rule.order : index]));
  return blocks.filter(isRoutineGateBlock)
    .map((block, index) => ({ block, index }))
    .sort((a, b) => (order.get(String(a.block.recurrenceGroupId)) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(String(b.block.recurrenceGroupId)) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
    .map(({ block }) => block);
}

function earlyBirdGate() {
  const log = earlyBirdLogForDate(todayISO());
  const checkedAt = String(log?.checkedAt || "");
  const checkedTime = checkedAt.match(/T(\d{2}:\d{2})/)?.[1] || "";
  const target = earlyRiseTarget();
  return { checked: Boolean(log), checkedTime, target, late: Boolean(checkedTime && checkedTime > target) };
}

function earlyBirdHTML(early, docking = false) {
  return `<button type="button" class="tower-gate tower-gate-fixed${docking ? " is-docking" : ""}${early.late ? " is-late" : ""}"
    data-action="early-bird-check" data-id="__early_bird__" data-docked="${early.checked ? 1 : 0}" aria-pressed="${early.checked ? "true" : "false"}">
    <span>G01 ☀</span><strong>早起き(${escapeHTML(early.target)}まで)</strong><i aria-hidden="true"></i>
    <span class="tower-gate-lock">🔒 固定枠(削除不可)</span>
  </button>`;
}

function regularGateHTML(block, index, docking = false) {
  return `<button type="button" class="tower-gate${docking ? " is-docking" : ""}" data-action="now-conveyor-complete" data-id="${escapeHTML(block.id)}" data-docked="${block.completed ? 1 : 0}">
    <span>G${String(index + 2).padStart(2, "0")}</span><strong>${escapeHTML(block.title)}</strong><i aria-hidden="true"></i>
  </button>`;
}

function gateEditorHTML(early) {
  const rules = orderedGateRules();
  const rows = rules.map((rule, index) => `<div class="tower-gate-edit-row" data-rule-id="${escapeHTML(rule.id)}">
    <span>G${String(index + 2).padStart(2, "0")}</span><strong>${escapeHTML(rule.title)}</strong><time>${escapeHTML(rule.startTime || "--:--")}</time>
    ${["daily", "weekdays"].includes(rule.kind) ? `<label class="tower-gate-streak-toggle" title="固定化">
      <input type="checkbox" data-action="tower-gate-streak-toggle" data-rule-id="${escapeHTML(rule.id)}" aria-label="固定" ${rule.streakSince ? "checked" : ""}><span aria-hidden="true">📌</span>
    </label>` : "<span></span>"}
    <button type="button" data-action="tower-gate-move" data-rule-id="${escapeHTML(rule.id)}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="上へ">↑</button>
    <button type="button" data-action="tower-gate-move" data-rule-id="${escapeHTML(rule.id)}" data-direction="1" ${index === rules.length - 1 ? "disabled" : ""} aria-label="下へ">↓</button>
    <button type="button" class="danger" data-action="tower-gate-delete" data-rule-id="${escapeHTML(rule.id)}">削除</button>
  </div>`).join("");
  return `${earlyBirdHTML(early)}<div class="tower-gate-editor">${rows || '<div class="tower-gate-edit-empty">登録済みゲートはありません</div>'}
    <div class="tower-gate-add"><input id="towerGateTitle" type="text" placeholder="タイトル" aria-label="ゲートタイトル">
      <input id="towerGateTime" type="time" step="300" aria-label="ゲート時刻">
      <button type="button" data-action="tower-gate-add">＋ 登録</button></div>
  </div>`;
}

function renderTowerGates(blocks) {
  const gates = orderedGateBlocks(blocks);
  const early = earlyBirdGate();
  const done = gates.filter((block) => block.completed).length + (early.checked ? 1 : 0);
  const gateSet = [`early:${early.checked ? 1 : 0}`, ...gates.map((block) => `${encodeURIComponent(String(block.id))}:${block.completed ? 1 : 0}`)].join(",");
  const docked = new Set([...(early.checked ? ["__early_bird__"] : []), ...gates.filter((block) => block.completed).map((block) => String(block.id))]);
  const firstRender = lastGateDocked === undefined;
  const buttons = gates.map((block, index) => {
    const id = String(block.id);
    const docking = !firstRender && block.completed && !lastGateDocked.has(id);
    return regularGateHTML(block, index, docking);
  }).join("");
  const earlyDocking = !firstRender && early.checked && !lastGateDocked.has("__early_bird__");
  const total = gates.length + 1;
  const full = done === total;
  // レビューM2反映: フラッシュは「満灯へ遷移した瞬間」だけ(is-dockingと同じ意味論)。
  // 復元描画(lastGateFull===undefined)では定常is-fullのみでアニメを走らせない。
  const fullFlash = full && lastGateFull === false;
  lastGateDocked = docked;
  lastGateFull = full;
  return `<section class="tower-gates sec-gates${full ? " is-full" : ""}${fullFlash ? " is-full-flash" : ""}">
    <h2>GATE ROUTINE <button type="button" class="tower-gate-edit" data-action="tower-gate-edit-toggle">${gateEditMode() ? "DONE 完了" : "EDIT 編集"}</button></h2>
    <div id="towerGateStrip" data-gate-set="${gateSet}">${gateEditMode() ? gateEditorHTML(early) : `${earlyBirdHTML(early, earlyDocking)}${buttons}`}</div>
    ${early.late ? `<div class="tower-gate-warning">⚠ ${escapeHTML(early.checkedTime)}打刻 — 目標${escapeHTML(early.target)}より遅いチェックです</div>` : ""}
    <div id="towerGateCount">${done}/${total}便 就航</div>
  </section>`;
}

// v297: BODY/MINDウィジェット(2軸身体スキャンの日次積み上げ+週推移。表示専用・stateへ書かない)。
// 日付演算はtopband.jsのaddDaysLocalと同じ思想で自己完結させる(新規depsを増やさない)。
function bmAddDays(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// recovery=nullは「未記録」であり「回復0」ではないため、Σ回復にも件数にも算入しない。
function bmSummary(scans) {
  let fatigue = 0, recovery = 0, recoveryCount = 0;
  scans.forEach((s) => {
    fatigue += Number(s.fatigue) || 0;
    if (typeof s.recovery === "number") { recovery += s.recovery; recoveryCount += 1; }
  });
  return { fatigue, recovery, recoveryCount, total: scans.length };
}

function bmNetLine({ fatigue, recovery, recoveryCount, total }) {
  const net = recovery - fatigue;
  const tilt = recoveryCount === 0 ? "回復の記録はありません"
    : net > 0 ? "回復が疲労を上回っています" : net < 0 ? "疲労が回復を上回っています" : "疲労と回復が拮抗しています";
  const note = recoveryCount < total ? `(回復記録 ${recoveryCount}/${total}件)` : "";
  return `差引（回復−疲労） <strong>${net > 0 ? "+" : ""}${net}</strong>・${tilt}${note}`;
}

function bmListHTML(scans, blocks) {
  const byId = new Map(blocks.map((block) => [String(block.id), block]));
  const recent = [...scans].sort((a, b) => String(b.dateTime).localeCompare(String(a.dateTime))).slice(0, 3);
  return recent.map((s) => {
    const title = byId.get(String(s.pomodoroBlockId))?.title || "—";
    const recoveryText = typeof s.recovery === "number" ? String(s.recovery) : "—";
    const fatigueText = String(Number.isFinite(s.fatigue) ? s.fatigue : 0);
    return `<div class="bm-item">
      <span class="bm-item-time">${escapeHTML(timeFromDateTime(s.dateTime) || "--:--")}</span>
      <span class="bm-item-name">${escapeHTML(title)}${escapeHTML(s.part ? `（${s.part}）` : "")}</span>
      <span class="bm-item-tag fat">疲労${escapeHTML(fatigueText)}</span>
      <span class="bm-item-tag rec">回復${escapeHTML(recoveryText)}</span>
    </div>`;
  }).join("");
}

function bmWeeklyHTML(today) {
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(bmAddDays(today, -i));
  const sums = days.map((date) => ({ date, ...bmSummary(bodyScansForDate(date)) }));
  const max = Math.max(1, ...sums.map((d) => Math.max(d.fatigue, d.recovery)));
  const cols = sums.map((d) => `<div class="bm-col${d.date === today ? " is-today" : ""}" data-date="${escapeHTML(d.date)}" data-fat="${d.fatigue}" data-rec="${d.recovery}">
      <div class="bm-col-bars"><i class="bm-sbar fat" style="height:${Math.round(d.fatigue / max * 100)}%"></i><i class="bm-sbar rec" style="height:${Math.round(d.recovery / max * 100)}%"></i></div>
      <span>${escapeHTML(d.date.slice(5))}</span>
    </div>`).join("");
  return `<div class="bm-weekly"><div class="bm-weekly-title">週の推移（日別 Σ疲労 / Σ回復）</div><div class="bm-spark">${cols}</div></div>`;
}

function renderTowerBodyMind(today, blocks) {
  const scans = bodyScansForDate(today);
  if (!scans.length) {
    return `<section class="tower-panel-box sec-bodymind">
      <h2>BODY / MIND <span>今日の積み上げ</span></h2>
      <div class="bm-empty">今日の記録はまだありません</div>
    </section>`;
  }
  const summary = bmSummary(scans);
  const max = Math.max(1, summary.fatigue, summary.recovery);
  const open = _bmWeeklyOpen;
  return `<section class="tower-panel-box sec-bodymind">
    <h2><button type="button" class="bm-toggle" data-action="tower-bodymind-toggle" aria-expanded="${open ? "true" : "false"}">BODY / MIND<span>今日の積み上げ・タップで週推移</span><i class="bm-chev${open ? " open" : ""}" aria-hidden="true">▸</i></button></h2>
    <div class="bm-bars">
      <div class="bm-row"><span class="bm-label">🏋️ 身体の疲労</span><span class="bm-track"><i class="bm-fill fat" style="width:${Math.round(summary.fatigue / max * 100)}%"></i></span><span class="bm-val">Σ${summary.fatigue}</span></div>
      <div class="bm-row"><span class="bm-label">🧠 ココロの回復</span><span class="bm-track"><i class="bm-fill rec" style="width:${Math.round(summary.recovery / max * 100)}%"></i></span><span class="bm-val">Σ${summary.recovery}</span></div>
    </div>
    <div class="bm-net">${bmNetLine(summary)}</div>
    <div class="bm-list">${bmListHTML(scans, blocks)}</div>
    ${open ? bmWeeklyHTML(today) : ""}
  </section>`;
}

// app.jsのregisterActions("tower-bodymind-toggle")から呼ぶ(today-tower.jsはaction登録自体を持たない
// 既存方針=tower-gate-edit-toggle等と同じ「トグルはexport、登録はapp.js側」の分業を踏襲)。
function toggleTowerBodyMindWeekly() {
  _bmWeeklyOpen = !_bmWeeklyOpen;
}

function renderTodayTower() {
  const now = new Date();
  const today = todayISO();
  const date = escapeHTML(today);
  const blocks = blocksForDate(today);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const flights = boardFlights(blocks, nowMin, scheduledTasksForDate(today, blocks));
  const focusVisibility = todayFocusVisibility();
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][now.getDay()];
  return `<div class="today-tower" data-motion="${escapeHTML(towerMotionSetting())}" data-night="${isNightHour(now.getHours()) ? 1 : 0}" data-paused="${document.hidden ? 1 : 0}" data-focus-mode="${Object.values(focusVisibility).some(Boolean) ? 0 : 1}"${glassBlurOff() ? ' data-glass-blur="off"' : ""}>
    ${syncAlertBanner()}
    <div class="tower-band1 band1">${renderLifeBand()}<section class="tower-glass-panel clock-box" aria-label="現在時刻"><time id="towerClock">${clockText(now)}</time><span id="towerDate">${date} (${weekday})</span><strong class="dayleft" id="towerDayLeft">${dayLeftText(now)}</strong><span>本日残り</span></section>
    </div>
    ${renderStandingOrders()}
    <div class="tower-band2 band2" aria-label="NOW LANDING と CABIN TIMER">
      ${renderTowerRunway(now, blocks, flights)}
      ${renderTodayPomodoro(blocks, queueBlocksOf(blocks))}
    </div>
    ${renderTodayFocusBar(focusVisibility)}
    <div class="tower-col-left">
      ${renderTowerBoard(flights)}
      ${renderFlightLog(today, blocks)}
      ${renderTowerBodyMind(today, blocks)}
    </div>
    <div class="tower-col-center">${focusVisibility.gate ? renderTowerGates(blocks) : ""}</div>
    <div class="tower-col-right">${focusVisibility.journal ? renderTowerJournal(today) : ""}</div>
  </div>`;
}

function updateTowerRunway(now, blocks) {
  const running = runningBlockOf(blocks);
  const plane = document.getElementById("towerPlane");
  const hud = document.querySelector(".tower-nowhud");
  const pct = document.getElementById("towerNowPct");
  const remain = document.getElementById("towerNowRemain");
  const hudId = hud?.querySelector("button[data-id]")?.dataset.id;
  if (!running || !plane || !hud || !pct || !remain || hudId !== String(running.id)) return;
  const metrics = runwayMetrics(running, now.getTime());
  plane.style.setProperty("--tower-plane-x", `${metrics.x}%`);
  pct.textContent = `進捗 ${metrics.pct}%`;
  remain.textContent = metrics.remain;
  if (metrics.over && hud.dataset.status === "landing") hud.dataset.status = "long";
}

function updateTowerGates(blocks) {
  if (gateEditMode()) return;
  const gates = orderedGateBlocks(blocks);
  const early = earlyBirdGate();
  const gateSet = [`early:${early.checked ? 1 : 0}`, ...gates.map((block) => `${encodeURIComponent(String(block.id))}:${block.completed ? 1 : 0}`)].join(",");
  const container = document.getElementById("towerGateStrip");
  if (!container || container.dataset.gateSet === gateSet || container.contains(document.activeElement)) return;
  const previous = new Set([...container.querySelectorAll('[data-docked="1"]')].map((gate) => gate.dataset.id));
  const done = gates.filter((block) => block.completed).length + (early.checked ? 1 : 0);
  container.innerHTML = earlyBirdHTML(early, early.checked && !previous.has("__early_bird__"))
    + gates.map((block, index) => regularGateHTML(block, index, block.completed && !previous.has(String(block.id)))).join("");
  container.dataset.gateSet = gateSet;
  const total = gates.length + 1;
  const full = done === total;
  const section = container.closest(".tower-gates");
  if (section) {
    // レビューM2反映: フラッシュは「満灯へ遷移した瞬間」だけ。復元・再構築では光らせない。
    if (full && lastGateFull === false) section.classList.add("is-full-flash");
    section.classList.toggle("is-full", full);
    if (!full) section.classList.remove("is-full-flash");
  }
  lastGateFull = full;
  const count = document.getElementById("towerGateCount");
  if (count) count.textContent = `${done}/${total}便 就航`;
  lastGateDocked = new Set([...(early.checked ? ["__early_bird__"] : []), ...gates.filter((block) => block.completed).map((block) => String(block.id))]);
}

function updateTowerArrivalSelection(blocks, flights, userSelection = false) {
  const hud = document.querySelector('.tower-nowhud[data-status="ready"]');
  if (!hud) return;
  const select = hud.querySelector("[data-tower-arrival-select]");
  if (select === document.activeElement && !userSelection) return;
  const selection = runwayArrivalSelection(blocks, flights);
  const next = selection.selected;
  if (!next) return;
  const title = hud.querySelector(".tower-now-title");
  const start = hud.querySelector('[data-action="now-start"]');
  if (title) { title.dataset.id = String(next.id); title.textContent = next.title; }
  if (start) start.dataset.id = String(next.id);
  if (select === document.activeElement) return;
  const options = towerArrivalOptions(selection);
  if (!options) { select?.remove(); return; }
  const selectionKey = towerArrivalSelectionKey(selection);
  if (!select) {
    start?.insertAdjacentHTML("beforebegin", `<select class="tower-arrival-select" data-tower-arrival-select data-arrival-set="${escapeHTML(selectionKey)}" aria-label="開始するARRIVALS便">${options}</select>`);
  } else if (select.dataset.arrivalSet !== selectionKey) {
    select.innerHTML = options;
    select.dataset.arrivalSet = selectionKey;
  }
}

function updateTodayTowerTick() {
  const now = new Date();
  const root = document.querySelector(".today-tower");
  if (root) {
    const night = isNightHour(now.getHours()) ? "1" : "0";
    if (root.dataset.night !== night) root.dataset.night = night;
  }
  const blocks = blocksForDate(todayISO());
  const clock = document.getElementById("towerClock");
  const dayLeft = document.getElementById("towerDayLeft");
  if (!clock || !dayLeft) return;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  clock.textContent = clockText(now);
  dayLeft.textContent = dayLeftText(now);
  updateTowerRunway(now, blocks);
  updateTowerGates(blocks);
  const flights = boardFlights(blocks, nowMin, scheduledTasksForDate(todayISO(), blocks));
  updateTowerArrivalSelection(blocks, flights);
  const container = document.getElementById("towerArrivalRows");
  const rows = [...document.querySelectorAll(".tower-arrival-row")];
  const current = arrivalWindow(flights).rows;
  if (!container || container.dataset.flightSet !== flightSetKey(flights)) return;
  if (rows.length !== current.length || rows.some((row, index) => row.dataset.flightId !== String(current[index].id))) {
    // 集合は同じまま時間経過で±5便の窓がずれた場合、render()は来ないためtickで行を作り直す(11便超の日の凍結防止)。
    // レビューM3/Codex P2反映: ボード内にフォーカスがある間は作り直さず(タップ・支援技術の位置を守る)、次tickへ譲る。
    if (container.contains(document.activeElement)) return;
    const prevStatus = new Map(rows.map((row) => [row.dataset.flightId, row.dataset.status]));
    container.innerHTML = current.map((flight) => flightRow(flight)).join("");
    current.forEach((flight) => {
      const id = String(flight.id);
      if (!prevStatus.has(id) || prevStatus.get(id) === flight.status) return;
      container.querySelector(`[data-flight-id="${CSS.escape(id)}"] .tower-status`)?.classList.add("is-flip");
    });
    const summary = document.getElementById("towerArrivalSummary");
    if (summary) summary.textContent = flights.length > current.length ? `他 ${flights.length - current.length} 便` : "";
    return;
  }
  rows.forEach((row, index) => {
    const status = row.querySelector(".tower-status");
    const flight = current[index];
    if (!status || status.dataset.status === flight.status) return;
    row.dataset.status = flight.status;
    status.dataset.status = flight.status;
    status.textContent = flight.label;
    status.classList.add("is-flip");
  });
}

export {
  configureTodayTower, renderTodayTower, runwayArrivalSelection, setTowerArrivalSelection, updateTodayTowerTick,
  toggleTowerBodyMindWeekly, pomodoroLinkFlights
};
