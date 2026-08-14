// src/features/today-tower.js — v204: 読み取り専用TOWERヘッダ+発着ボード。
// state・保存・action登録には触れず、時刻・便状態は既存1秒tickerから差分更新する。

let escapeHTML, todayISO, homeSyncAlertBanner, blocksForDate, towerFlights;
let flipListenerBound = false;

function configureTodayTower(deps) {
  ({ escapeHTML, todayISO, homeSyncAlertBanner, blocksForDate, towerFlights } = deps);
  if (!flipListenerBound && typeof document !== "undefined") {
    document.addEventListener("animationend", (event) => {
      if (event.target.classList?.contains("tower-status")) event.target.classList.remove("is-flip");
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

function boardFlights(date, nowMin) {
  const blocks = blocksForDate(date).filter((block) => block.category !== "ルーティン" && !block.oneTap);
  return towerFlights(blocks, nowMin);
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

function flightRow(flight, departure = false) {
  const status = departure ? "" : `<span class="tower-status" data-status="${escapeHTML(flight.status)}">${escapeHTML(flight.label)}</span>`;
  return `<div class="tower-flight-row ${departure ? "tower-departure-row" : "tower-arrival-row"}" data-flight-id="${escapeHTML(flight.id)}"${departure ? "" : ` data-status="${escapeHTML(flight.status)}"`}>
    <time>${flightTime(flight.plannedMin)}</time><span class="tower-callsign">${escapeHTML(flight.callsign)}</span>
    <button type="button" class="tower-flight-title" data-action="edit-block" data-id="${escapeHTML(flight.id)}">${escapeHTML(flight.title)}</button>${status}
  </div>`;
}

function renderTowerBoard(now) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const arrivalFlights = boardFlights(todayISO(), nowMin);
  const arrivals = arrivalWindow(arrivalFlights);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const departures = boardFlights(localISO(tomorrow), 0).slice(0, 3);
  return `<section class="tower-board">
    <div class="tower-arrivals"><h2>ARRIVALS <span>本日</span></h2>
      <div id="towerArrivalRows" data-flight-set="${flightSetKey(arrivalFlights)}">${arrivals.rows.map((flight) => flightRow(flight)).join("")}</div>
      <div class="tower-flight-summary" id="towerArrivalSummary">${arrivals.omitted ? `他 ${arrivals.omitted} 便` : ""}</div>
    </div>
    <div class="tower-departures"><h2>DEPARTURES <span>明日</span></h2>
      <div>${departures.map((flight) => flightRow(flight, true)).join("")}</div>
    </div>
  </section>`;
}

function renderTodayTower() {
  const now = new Date();
  const date = escapeHTML(todayISO());
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][now.getDay()];
  return `<div class="today-tower">
    ${homeSyncAlertBanner()}
    <header class="tower-header">
      <span class="tower-beacon" aria-hidden="true"><i></i></span>
      <div class="tower-identity"><span class="tower-eyebrow">TASKCHUTE TOWER</span><strong>TWR</strong></div>
      <div class="tower-time"><time id="towerClock">${clockText(now)}</time><span id="towerDate">${date} (${weekday})</span></div>
      <div class="tower-day-left"><span>本日残り</span><strong id="towerDayLeft">${dayLeftText(now)}</strong></div>
    </header>
    ${renderTowerBoard(now)}
  </div>`;
}

function updateTodayTowerTick() {
  const clock = document.getElementById("towerClock");
  const dayLeft = document.getElementById("towerDayLeft");
  if (!clock || !dayLeft) return;
  const now = new Date();
  clock.textContent = clockText(now);
  dayLeft.textContent = dayLeftText(now);
  const container = document.getElementById("towerArrivalRows");
  const rows = [...document.querySelectorAll(".tower-arrival-row")];
  const flights = boardFlights(todayISO(), now.getHours() * 60 + now.getMinutes());
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
