// src/features/today-tower.js — v205: 読み取り専用TOWERヘッダ+発着ボード+RWY/NOW LANDING。
// state・保存・action登録には触れず、時刻・便状態は既存1秒tickerから差分更新する。

let escapeHTML, todayISO, homeSyncAlertBanner, blocksForDate, towerFlights;
let runningBlockOf, queueBlocksOf, localDateTimeToMs, resolveEstimateMin, timeFromDateTime, clamp;
let flipListenerBound = false;
// undefined=セッション初回(未観測)。復元描画では接地の瞬間ではないためフラッシュを出さない
// (起動時同期404後の全体render()と競合して非決定にもなる)。null=実行中なしを観測済み。
let lastLandingId;

function configureTodayTower(deps) {
  ({
    escapeHTML, todayISO, homeSyncAlertBanner, blocksForDate, towerFlights,
    runningBlockOf, queueBlocksOf, localDateTimeToMs, resolveEstimateMin, timeFromDateTime, clamp
  } = deps);
  if (!flipListenerBound && typeof document !== "undefined") {
    document.addEventListener("animationend", (event) => {
      if (event.target.classList?.contains("tower-touchdown")) event.target.remove();
      else if (event.target.classList?.contains("tower-status")) event.target.classList.remove("is-flip");
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

function runwayMetrics(running, nowMs) {
  const startMs = localDateTimeToMs(running.actualStartAt);
  const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const estimate = resolveEstimateMin(running);
  const ratio = estimate > 0 ? elapsedSec / (estimate * 60) : 0;
  const over = estimate > 0 && ratio >= 1;
  const minutes = over
    ? Math.max(0, Math.ceil(elapsedSec / 60 - estimate))
    : Math.max(0, Math.ceil(estimate - elapsedSec / 60));
  return {
    x: clamp(ratio * 100, 0, 100), over,
    remain: estimate <= 0 ? "見積なし" : over ? `ロングフライト +${minutes}分` : `残り ${minutes}分`
  };
}

function renderTowerRunway(now) {
  const blocks = blocksForDate(todayISO());
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
    const scheduled = running.plannedStartAt ? timeFromDateTime(running.plannedStartAt) : "--:--";
    hud = `<div class="tower-nowhud" data-status="${metrics.over ? "long" : "landing"}">
      <span class="tower-now-label">NOW LANDING</span>
      <button type="button" class="tower-now-title" data-action="edit-block" data-id="${id}">${escapeHTML(running.title)}</button>
      <span class="tower-now-sched">定刻 ${escapeHTML(scheduled || "--:--")}</span>
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
  return `<section class="tower-runway">
    <h2>RWY 12/30 <span>滑走路</span></h2>
    <div class="tower-runway-strip">
      <i id="towerPlane" aria-hidden="true" style="--tower-plane-x:${metrics.x}%">✈</i>${touchdown}
    </div>
    ${hud}
  </section>`;
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
    ${renderTowerRunway(now)}
    ${renderTowerBoard(now)}
  </div>`;
}

function updateTowerRunway(now) {
  const running = runningBlockOf(blocksForDate(todayISO()));
  const plane = document.getElementById("towerPlane");
  const hud = document.querySelector(".tower-nowhud");
  const remain = document.getElementById("towerNowRemain");
  const hudId = hud?.querySelector("button[data-id]")?.dataset.id;
  if (!running || !plane || !hud || !remain || hudId !== String(running.id)) return;
  const metrics = runwayMetrics(running, now.getTime());
  plane.style.setProperty("--tower-plane-x", `${metrics.x}%`);
  remain.textContent = metrics.remain;
  if (metrics.over && hud.dataset.status === "landing") hud.dataset.status = "long";
}

function updateTodayTowerTick() {
  const clock = document.getElementById("towerClock");
  const dayLeft = document.getElementById("towerDayLeft");
  if (!clock || !dayLeft) return;
  const now = new Date();
  clock.textContent = clockText(now);
  dayLeft.textContent = dayLeftText(now);
  updateTowerRunway(now);
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
