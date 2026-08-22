// src/features/today-tower.js — v228: JOURNAL 2枠とFLIGHT LOGを統合。
// state・保存・action登録には触れず、時刻・便状態・信条は既存1秒tickerから差分更新する。

import { renderStandingOrders, renderCountdown, renderTopbandPC, creedRotationLine } from "./topband.js";

let escapeHTML, todayISO, homeSyncAlertBanner, blocksForDate, towerFlights;
let runningBlockOf, queueBlocksOf, localDateTimeToMs, resolveEstimateMin, minutesOf, timeFromDateTime, clamp;
let towerMotionSetting;
let renderTodayPomodoro;
let journalForDate;
let flipListenerBound = false;
// undefined=セッション初回(未観測)。復元描画では接地の瞬間ではないためフラッシュを出さない
// (起動時同期404後の全体render()と競合して非決定にもなる)。null=実行中なしを観測済み。
let lastLandingId;
let lastGateDocked;
// undefined=未観測。復元描画では満灯フラッシュを出さない(lastLandingIdと同じ意味論)。
let lastGateFull;
let lastFlightLogDate;
let lastFlightLogKeys;

function configureTodayTower(deps) {
  ({
    escapeHTML, todayISO, homeSyncAlertBanner, blocksForDate, towerFlights,
    runningBlockOf, queueBlocksOf, localDateTimeToMs, resolveEstimateMin, minutesOf, timeFromDateTime, clamp,
    towerMotionSetting, renderTodayPomodoro, journalForDate
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

function localISO(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value, index) => String(value).padStart(index ? 2 : 4, "0")).join("-");
}

function isNightHour(hour) {
  return hour >= 21 || hour < 5;
}

function boardFlights(blocks, nowMin) {
  return towerFlights(blocks.filter((block) => !block.completed && block.category !== "ルーティン" && !block.oneTap), nowMin);
}

function arrivalWindow(flights) {
  if (!flights.length) return { rows: [], omitted: 0 };
  let center = flights.findIndex((flight) => flight.status === "landing");
  if (center < 0) center = flights.findIndex((flight) => flight.status === "final");
  // レビューM1反映: 全便未着手のまま時間が過ぎた日は「直近の過去便(最後のリスロット)」を中心にする(朝への張り付き防止)。
  if (center < 0) for (let i = flights.length - 1; i >= 0; i--) if (flights[i].status === "resloted") { center = i; break; }
  if (center < 0) center = flights.findIndex((flight) => flight.status === "holding");
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

function renderTowerRunway(now, blocks) {
  const running = runningBlockOf(blocks);
  const next = running ? null : queueBlocksOf(blocks)[0];
  const metrics = running ? runwayMetrics(running, now.getTime()) : { x: 0 };
  // フラッシュは#towerPlaneの兄弟でCSS変数を継承しないため、自身にも機体位置を持たせる(レビューM1)。
  const touchdown = running && lastLandingId !== undefined && running.id !== lastLandingId
    ? `<i class="tower-touchdown" aria-hidden="true" style="--tower-plane-x:${metrics.x}%"></i>` : "";
  lastLandingId = running ? running.id : null;
  let hud = '<div class="tower-nowhud" data-status="empty">本日の着陸予定はありません</div>';
  if (running) {
    const id = escapeHTML(running.id);
    hud = `<div class="tower-nowhud" data-status="${metrics.over ? "long" : "landing"}">
      <button type="button" class="tower-now-title" data-action="edit-block" data-id="${id}">${escapeHTML(running.title)}</button>
      <span class="tower-now-pct" id="towerNowPct">進捗 ${metrics.pct}%</span>
      <strong id="towerNowRemain">${metrics.remain}</strong>
      <div class="tower-now-actions">
        <button type="button" class="btn green" data-action="complete-block-with-actual" data-id="${id}">■ 完了</button>
        <button type="button" class="btn" data-action="now-conveyor-complete" data-id="${id}">▶ 次へ</button>
      </div>
    </div>`;
  } else if (next) {
    const id = escapeHTML(next.id);
    hud = `<div class="tower-nowhud" data-status="ready">
      <button type="button" class="tower-now-title" data-action="edit-block" data-id="${id}">${escapeHTML(next.title)}</button>
      <button type="button" class="btn primary" data-action="now-start" data-id="${id}">▶ 開始</button>
    </div>`;
  }
  return `<section class="tower-runway sec-rwy">
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
  return `<div class="tower-flight-row tower-arrival-row" data-flight-id="${escapeHTML(flight.id)}" data-status="${escapeHTML(flight.status)}">
    <time>${flightTime(flight.plannedMin)}</time><span class="tower-callsign">${escapeHTML(flight.callsign)}</span>
    <button type="button" class="tower-flight-title" data-action="edit-block" data-id="${escapeHTML(flight.id)}">${escapeHTML(flight.title)}</button>${status}
  </div>`;
}

function renderTowerBoard(now, arrivalFlights) {
  const arrivals = arrivalWindow(arrivalFlights);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const departures = boardFlights(blocksForDate(localISO(tomorrow)), 0);
  const firstDeparture = departures[0];
  const departureSummary = firstDeparture
    ? `明日 ${departures.length}便 / 最初は ${flightTime(firstDeparture.plannedMin)} ${escapeHTML(firstDeparture.title)}`
    : "明日の便はまだありません";
  return `<section class="tower-board sec-arrivals">
    <div class="tower-arrivals"><h2>ARRIVALS <span>本日</span></h2>
      <div id="towerArrivalRows" data-flight-set="${flightSetKey(arrivalFlights)}">${arrivals.rows.map((flight) => flightRow(flight)).join("")}</div>
      <div class="tower-flight-summary" id="towerArrivalSummary">${arrivals.omitted ? `他 ${arrivals.omitted} 便` : ""}</div>
      <button type="button" class="tower-departures" data-action="departures-open-tomorrow">
        <b>DEPARTURES ▸</b><span>${departureSummary}</span>
      </button>
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
    .filter((block) => block.completed && block.actualEndAt)
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
    return `<div class="tower-log-row${isLatest ? " is-flip" : ""}" data-flight-id="${escapeHTML(block.id)}">
      <time>${start}-${end}</time><span class="tower-log-title">${escapeHTML(block.title)}</span>
      <span class="tower-log-dur">${flightLogDuration(block)}</span>
      ${isLatest ? '<i class="tower-touchdown" aria-hidden="true" style="--tower-plane-x:50%"></i>' : ""}
    </div>`;
  }).join("");
  return `<section class="tower-panel-box sec-log">
    <h2>FLIGHT LOG <span>本日の航跡・完了便のみ</span></h2>
    <div id="towerFlightLog">${rows || '<div class="tower-log-empty">完了便はまだありません</div>'}</div>
    <div class="tower-log-foot">タスク完了のたびに自動追記 — 同時に日報mdを再生成</div>
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

function renderTowerGates(blocks) {
  const gates = blocks.filter((block) => block.category === "ルーティン" && !block.oneTap && !block.deleted);
  const done = gates.filter((block) => block.completed).length;
  const gateSet = gates.map((block) => `${encodeURIComponent(String(block.id))}:${block.completed ? 1 : 0}`).join(",");
  const docked = new Set(gates.filter((block) => block.completed).map((block) => String(block.id)));
  const firstRender = lastGateDocked === undefined;
  const buttons = gates.map((block, index) => {
    const id = String(block.id);
    const docking = !firstRender && block.completed && !lastGateDocked.has(id);
    return `<button type="button" class="tower-gate${docking ? " is-docking" : ""}" data-action="now-conveyor-complete" data-id="${escapeHTML(id)}" data-docked="${block.completed ? 1 : 0}">
      <span>G${String(index + 1).padStart(2, "0")}</span><strong>${escapeHTML(block.title)}</strong><i aria-hidden="true"></i>
    </button>`;
  }).join("");
  const full = done === gates.length && gates.length > 0;
  // レビューM2反映: フラッシュは「満灯へ遷移した瞬間」だけ(is-dockingと同じ意味論)。
  // 復元描画(lastGateFull===undefined)では定常is-fullのみでアニメを走らせない。
  const fullFlash = full && lastGateFull === false;
  lastGateDocked = docked;
  lastGateFull = full;
  return `<section class="tower-gates sec-gates${full ? " is-full" : ""}${fullFlash ? " is-full-flash" : ""}">
    <h2>GATE ROUTINE</h2><div id="towerGateStrip" data-gate-set="${gateSet}">${buttons}</div>
    <div id="towerGateCount">${done}/${gates.length}便 就航</div>
  </section>`;
}

function renderTodayTower() {
  const now = new Date();
  const today = todayISO();
  const date = escapeHTML(today);
  const blocks = blocksForDate(today);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const flights = boardFlights(blocks, nowMin);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][now.getDay()];
  return `<div class="today-tower" data-motion="${escapeHTML(towerMotionSetting())}" data-night="${isNightHour(now.getHours()) ? 1 : 0}" data-paused="${document.hidden ? 1 : 0}">
    ${homeSyncAlertBanner()}
    <div class="tower-topband">
      <header class="tower-header">
        <span class="tower-beacon" aria-hidden="true"><i></i></span>
        <div class="tower-identity"><span class="tower-eyebrow" id="towerEyebrow">${creedRotationLine(Math.floor(now.getTime() / 8000))}</span><strong>TWR</strong></div>
        <div class="tower-time"><time id="towerClock">${clockText(now)}</time><span id="towerDate">${date} (${weekday})</span></div>
        <div class="tower-day-left"><span>本日残り</span><strong id="towerDayLeft">${dayLeftText(now)}</strong></div>
      </header>
    </div>
    ${renderTopbandPC()}
    <div class="tower-col-left">
      ${renderTowerRunway(now, blocks)}
      ${renderTowerBoard(now, flights)}
      ${renderFlightLog(today, blocks)}
    </div>
    <div class="tower-col-center">${renderTowerGates(blocks)}</div>
    <div class="tower-col-right">${renderTowerJournal(today)}${renderStandingOrders()}${renderCountdown()}</div>
    ${renderTodayPomodoro(blocks, queueBlocksOf(blocks)).replace(">POMODORO<span>", ">CABIN TIMER<span>")}
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
  const gates = blocks.filter((block) => block.category === "ルーティン" && !block.oneTap && !block.deleted);
  const gateSet = gates.map((block) => `${encodeURIComponent(String(block.id))}:${block.completed ? 1 : 0}`).join(",");
  const container = document.getElementById("towerGateStrip");
  if (!container || container.dataset.gateSet === gateSet || container.contains(document.activeElement)) return;
  const previous = new Set([...container.querySelectorAll('[data-docked="1"]')].map((gate) => gate.dataset.id));
  const done = gates.filter((block) => block.completed).length;
  container.innerHTML = gates.map((block, index) => `<button type="button" class="tower-gate${block.completed && !previous.has(String(block.id)) ? " is-docking" : ""}" data-action="now-conveyor-complete" data-id="${escapeHTML(block.id)}" data-docked="${block.completed ? 1 : 0}">
    <span>G${String(index + 1).padStart(2, "0")}</span><strong>${escapeHTML(block.title)}</strong><i aria-hidden="true"></i>
  </button>`).join("");
  container.dataset.gateSet = gateSet;
  const full = done === gates.length && gates.length > 0;
  const section = container.closest(".tower-gates");
  if (section) {
    // レビューM2反映: フラッシュは「満灯へ遷移した瞬間」だけ。復元・再構築では光らせない。
    if (full && lastGateFull === false) section.classList.add("is-full-flash");
    section.classList.toggle("is-full", full);
    if (!full) section.classList.remove("is-full-flash");
  }
  lastGateFull = full;
  const count = document.getElementById("towerGateCount");
  if (count) count.textContent = `${done}/${gates.length}便 就航`;
  lastGateDocked = new Set(gates.filter((block) => block.completed).map((block) => String(block.id)));
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
  const eyebrow = document.getElementById("towerEyebrow");
  if (!clock || !dayLeft) return;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  clock.textContent = clockText(now);
  dayLeft.textContent = dayLeftText(now);
  if (eyebrow) {
    const creed = creedRotationLine(Math.floor(now.getTime() / 8000));
    if (eyebrow.innerHTML !== creed) eyebrow.innerHTML = creed;
  }
  updateTowerRunway(now, blocks);
  updateTowerGates(blocks);
  const flights = boardFlights(blocks, nowMin);
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

export { configureTodayTower, renderTodayTower, updateTodayTowerTick };
