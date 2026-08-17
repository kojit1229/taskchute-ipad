// src/features/today-tower.js — v208: TOWERにRADARと無線ログを追加。
// state・保存・action登録には触れず、時刻・便状態は既存1秒tickerから差分更新する。

let escapeHTML, todayISO, homeSyncAlertBanner, blocksForDate, towerFlights;
let runningBlockOf, queueBlocksOf, localDateTimeToMs, resolveEstimateMin, timeFromDateTime, minutesOf, clamp;
let coachSummaryToday, QUICK_MEALS;
let flipListenerBound = false;
// undefined=セッション初回(未観測)。復元描画では接地の瞬間ではないためフラッシュを出さない
// (起動時同期404後の全体render()と競合して非決定にもなる)。null=実行中なしを観測済み。
let lastLandingId;
let lastFuelDeg;
let lastTrafficDeg;
let lastTrafficMin;
let lastGateDocked;
// undefined=未観測。復元描画では満灯フラッシュを出さない(lastLandingIdと同じ意味論)。
let lastGateFull;
const MAX_BLIPS = 20;
let lastRadioStatuses;
let lastRadioDate;
let radioLines = [];

function configureTodayTower(deps) {
  ({
    escapeHTML, todayISO, homeSyncAlertBanner, blocksForDate, towerFlights,
    runningBlockOf, queueBlocksOf, localDateTimeToMs, resolveEstimateMin, timeFromDateTime, minutesOf, clamp,
    coachSummaryToday, QUICK_MEALS
  } = deps);
  if (!flipListenerBound && typeof document !== "undefined") {
    document.addEventListener("animationend", (event) => {
      if (event.target.classList?.contains("tower-touchdown")) event.target.remove();
      else if (event.target.classList?.contains("tower-status")) event.target.classList.remove("is-flip");
      else if (event.target.classList?.contains("tower-gate")) event.target.classList.remove("is-docking");
      else if (event.target.classList?.contains("tower-gates")) event.target.classList.remove("is-full-flash");
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

function boardFlights(blocks, nowMin) {
  return towerFlights(blocks.filter((block) => block.category !== "ルーティン" && !block.oneTap), nowMin);
}

// レビューB1反映: APRONはARRIVALSと同じ母集団(boardFlights=非ルーティン・非oneTap)から
// 到着便だけを取り、callsignの採番をボードと一致させる。並びは実績終了(無ければ定刻)昇順。
function apronFlightsOf(flights, blocks) {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const arrivedAt = (flight) => {
    const block = byId.get(flight.id);
    return String(block?.actualEndAt || block?.plannedStartAt || "");
  };
  return flights.filter((flight) => flight.status === "arrived")
    .sort((a, b) => arrivedAt(a).localeCompare(arrivedAt(b)));
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

function radarFlights(flights, nowMin) {
  return flights.map((flight) => ({ ...flight, until: flight.plannedMin === null ? null : flight.plannedMin - nowMin }))
    .filter((flight) => flight.until !== null && flight.until >= 0 && flight.until <= 300)
    .sort((a, b) => a.until - b.until).slice(0, MAX_BLIPS);
}

function radarSetKey(flights) {
  return flights.map((flight) => `${encodeURIComponent(String(flight.id))}:${flight.until}`).join(",");
}

function blipPoint(flight) {
  const radius = 10 + flight.until / 300 * 32;
  const angle = (flight.plannedMin % 720) / 720 * 2 * Math.PI - Math.PI / 2;
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
}

function radarBlipsHTML(flights) {
  return flights.map((flight) => {
    const point = blipPoint(flight);
    return `<i class="tower-blip" data-blip-id="${escapeHTML(String(flight.id))}" style="left:${point.x}%;top:${point.y}%"></i>`;
  }).join("");
}

function renderTowerRadar(flights, nowMin) {
  const radar = radarFlights(flights, nowMin);
  return `<section class="tower-radar"><h2>RADAR <span>接近</span></h2>
    <div class="tower-radar-scope" id="towerRadarScope" data-radar-set="${radarSetKey(radar)}">
      <i class="tower-radar-ring"></i><i class="tower-radar-ring is-inner"></i>
      <i class="tower-radar-sweep" aria-hidden="true"></i><i class="tower-radar-core" aria-hidden="true"></i>
      ${radarBlipsHTML(radar)}
    </div>
  </section>`;
}

function radioObserve(flights) {
  // 日付が変わったら前日の実況・観測状態を破棄する(翌日へ持ち越さない。Codexレビュー反映)。
  const date = todayISO();
  if (lastRadioDate !== undefined && lastRadioDate !== date) {
    radioLines = [];
    lastRadioStatuses = undefined;
  }
  lastRadioDate = date;
  if (!radioLines.length) radioLines = ["TWR TASKCHUTE TOWER 運用開始"];
  const previous = lastRadioStatuses;
  lastRadioStatuses = new Map(flights.map((flight) => [String(flight.id), flight.status]));
  if (previous === undefined) return;
  const events = flights.flatMap((flight) => {
    if (!previous.has(String(flight.id)) || previous.get(String(flight.id)) === flight.status) return [];
    const suffix = {
      final: `最終進入 定刻 ${flightTime(flight.plannedMin)}`,
      landing: "着陸中",
      arrived: "スポット入り。おつかれさま",
      resloted: "リスロット"
    }[flight.status];
    return suffix ? [`<b>${escapeHTML(flight.callsign)}</b>〈${escapeHTML(flight.title)}〉${suffix}`] : [];
  });
  if (events.length) radioLines = radioLines.concat(events).slice(-3);
}

function radioLinesHTML() {
  return radioLines.map((line, index) => `<div class="tower-radio-line${index === radioLines.length - 1 ? " is-new" : ""}">${line}${index === radioLines.length - 1 ? '<i class="tower-radio-cursor" aria-hidden="true"></i>' : ""}</div>`).join("");
}

function radioSetKey() {
  return radioLines.map((line) => encodeURIComponent(line)).join(",");
}

function renderTowerRadio() {
  return `<section class="tower-radio"><div id="towerRadioLines" data-radio-set="${radioSetKey()}">${radioLinesHTML()}</div></section>`;
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

function renderTowerBoard(now, arrivalFlights) {
  const arrivals = arrivalWindow(arrivalFlights);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const departures = boardFlights(blocksForDate(localISO(tomorrow)), 0).slice(0, 3);
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

function gaugeSVG(needleId, deg, zonesHTML = "") {
  return `<svg viewBox="0 0 100 58" aria-hidden="true">
    <path class="tower-gauge-arc" d="M10 50 A40 40 0 0 1 90 50" pathLength="100"></path>${zonesHTML}
    <g class="tower-gauge-needle" id="${needleId}" style="--tower-needle-deg:${deg}deg">
      <line x1="50" y1="50" x2="50" y2="14"></line><circle cx="50" cy="50" r="3"></circle>
    </g>
  </svg>`;
}

function fuelDeg(summary) {
  return -90 + clamp(summary.remaining / summary.dailyKcal, 0, 1) * 180;
}

function trafficState(blocks, nowMin) {
  const ranges = blocks.filter((block) => !block.deleted && block.plannedStartAt).map((block) => {
    const start = minutesOf(block.plannedStartAt);
    const rawEnd = block.plannedEndAt ? minutesOf(block.plannedEndAt) : start + resolveEstimateMin(block);
    // minutesOfは日付を捨てるため、日跨ぎ(23:30→00:30)はend<startになる。翌日分として+1440で正規化(2系統レビュー共通指摘)。
    const end = rawEnd < start ? rawEnd + 1440 : rawEnd;
    return [Math.max(nowMin, start), Math.min(nowMin + 180, end)];
  }).filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  let occupied = 0;
  let mergedEnd = -Infinity;
  ranges.forEach(([start, end]) => {
    occupied += Math.max(0, end - Math.max(start, mergedEnd));
    mergedEnd = Math.max(mergedEnd, end);
  });
  const fraction = occupied / 180;
  if (fraction < 1 / 3) return { deg: -90 + fraction * 180, zone: "calm", label: "凪" };
  if (fraction < 2 / 3) return { deg: -90 + fraction * 180, zone: "cruise", label: "巡航" };
  return { deg: -90 + fraction * 180, zone: "dense", label: "過密" };
}

function renderTowerGauges(blocks, now) {
  const fuel = coachSummaryToday();
  const targetFuelDeg = fuelDeg(fuel);
  const traffic = trafficState(blocks, now.getHours() * 60 + now.getMinutes());
  const warn = fuel.remaining < 300;
  const lastMeal = fuel.entries[fuel.entries.length - 1];
  const buttons = QUICK_MEALS.map(([label, kcal]) =>
    `<button type="button" data-action="coach-quick-add" data-label="${escapeHTML(label)}" data-kcal="${kcal}">${escapeHTML(label)}${kcal}</button>`).join("");
  lastTrafficMin = undefined;
  // lastFuel/TrafficDeg=「最後に画面へ描いた角度」。renderは前回描画角のまま出し、次tickが目標角へ
  // 書き換えることでtransitionが振れる(スプリング)。renderでも記録しないと、初回tick前に記録操作が
  // 来た場合だけ針が瞬間ジャンプする(tick履歴依存の非決定)。
  const shownFuelDeg = lastFuelDeg !== undefined ? lastFuelDeg : targetFuelDeg;
  const shownTrafficDeg = lastTrafficDeg !== undefined ? lastTrafficDeg : traffic.deg;
  lastFuelDeg = shownFuelDeg;
  lastTrafficDeg = shownTrafficDeg;
  return `<section class="tower-gauges">
    <div class="tower-gauge tower-fuel" data-warn="${warn ? 1 : 0}">
      <h3>FUEL <span>残りkcal</span></h3>
      ${gaugeSVG("towerFuelNeedle", shownFuelDeg,
        '<path class="tower-gauge-zone" d="M10 50 A40 40 0 0 1 90 50" pathLength="100"></path>')}
      <div class="tower-gauge-read"><strong id="towerFuelValue">${fuel.remaining.toLocaleString("ja-JP")}</strong><span>/ ${fuel.dailyKcal.toLocaleString("ja-JP")} kcal</span></div>
      <div class="tower-fuel-warn" id="towerFuelWarn"${warn ? "" : " hidden"}>今日はここまでの合図</div>
      <div class="tower-fuel-actions">${buttons}<button type="button" class="tower-fuel-undo" data-action="coach-delete-meal" data-id="${lastMeal ? escapeHTML(lastMeal.id) : ""}"${lastMeal ? "" : " hidden"}>取り消す</button></div>
    </div>
    <div class="tower-gauge tower-traffic" data-zone="${traffic.zone}">
      <h3>TRAFFIC <span>この先3時間</span></h3>
      ${gaugeSVG("towerTrafficNeedle", shownTrafficDeg)}
      <div class="tower-gauge-read"><span id="towerTrafficZone">${traffic.label}</span></div>
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
  return `<section class="tower-gates${full ? " is-full" : ""}${fullFlash ? " is-full-flash" : ""}">
    <h2>GATE ROUTINE</h2><div id="towerGateStrip" data-gate-set="${gateSet}">${buttons}</div>
    <div id="towerGateCount">${done}/${gates.length}便 就航</div>
  </section>`;
}

function renderTowerApron(flights) {
  const apronSet = flights.map((flight) => `${encodeURIComponent(String(flight.id))}:1`).join(",");
  return `<section class="tower-apron"><h2>APRON</h2>
    <div id="towerApronStrip" data-apron-set="${apronSet}">${flights.map((flight) =>
      `<span class="tower-apron-plane">✈ ${escapeHTML(flight.callsign)}</span>`).join("")}</div>
  </section>`;
}

function renderTodayTower() {
  const now = new Date();
  const today = todayISO();
  const date = escapeHTML(today);
  const blocks = blocksForDate(today);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const flights = boardFlights(blocks, nowMin);
  const apronFlights = apronFlightsOf(flights, blocks);
  radioObserve(flights);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][now.getDay()];
  return `<div class="today-tower">
    ${homeSyncAlertBanner()}
    <header class="tower-header">
      <span class="tower-beacon" aria-hidden="true"><i></i></span>
      <div class="tower-identity"><span class="tower-eyebrow">TASKCHUTE TOWER</span><strong>TWR</strong></div>
      <div class="tower-time"><time id="towerClock">${clockText(now)}</time><span id="towerDate">${date} (${weekday})</span></div>
      <div class="tower-day-left"><span>本日残り</span><strong id="towerDayLeft">${dayLeftText(now)}</strong></div>
    </header>
    ${renderTowerRunway(now, blocks)}
    ${renderTowerRadar(flights, nowMin)}
    ${renderTowerGauges(blocks, now)}
    ${renderTowerGates(blocks)}
    ${renderTowerApron(apronFlights)}
    ${renderTowerBoard(now, flights)}
    ${renderTowerRadio()}
  </div>`;
}

function updateTowerRunway(now, blocks) {
  const running = runningBlockOf(blocks);
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

function updateTowerGauges(blocks, nowMin) {
  // coachSummaryForDateは最大500件のメモリ配列走査だけなので、既存1秒tickerで記録直後の差分を拾う。
  const fuel = coachSummaryToday();
  const fuelNeedle = document.getElementById("towerFuelNeedle");
  const fuelValue = document.getElementById("towerFuelValue");
  const fuelRoot = document.querySelector(".tower-fuel");
  const fuelWarn = document.getElementById("towerFuelWarn");
  const undo = document.querySelector(".tower-fuel-undo");
  const lastMeal = fuel.entries[fuel.entries.length - 1];
  if (fuelNeedle) fuelNeedle.style.setProperty("--tower-needle-deg", `${fuelDeg(fuel)}deg`);
  lastFuelDeg = fuelDeg(fuel);
  if (fuelValue) fuelValue.textContent = fuel.remaining.toLocaleString("ja-JP");
  if (fuelRoot) fuelRoot.dataset.warn = fuel.remaining < 300 ? "1" : "0";
  if (fuelWarn) fuelWarn.hidden = fuel.remaining >= 300;
  if (undo) { undo.hidden = !lastMeal; undo.dataset.id = lastMeal ? String(lastMeal.id) : ""; }
  if (lastTrafficMin === nowMin) return;
  const traffic = trafficState(blocks, nowMin);
  const trafficNeedle = document.getElementById("towerTrafficNeedle");
  const trafficRoot = document.querySelector(".tower-traffic");
  const trafficZone = document.getElementById("towerTrafficZone");
  if (trafficNeedle) trafficNeedle.style.setProperty("--tower-needle-deg", `${traffic.deg}deg`);
  if (trafficRoot) trafficRoot.dataset.zone = traffic.zone;
  if (trafficZone) trafficZone.textContent = traffic.label;
  lastTrafficDeg = traffic.deg;
  lastTrafficMin = nowMin;
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

function updateTowerApron(flights) {
  const apronSet = flights.map((flight) => `${encodeURIComponent(String(flight.id))}:1`).join(",");
  const container = document.getElementById("towerApronStrip");
  if (!container || container.dataset.apronSet === apronSet) return;
  container.innerHTML = flights.map((flight) => `<span class="tower-apron-plane">✈ ${escapeHTML(flight.callsign)}</span>`).join("");
  container.dataset.apronSet = apronSet;
}

function updateTowerRadar(flights, nowMin) {
  const radar = radarFlights(flights, nowMin);
  const radarSet = radarSetKey(radar);
  const container = document.getElementById("towerRadarScope");
  if (!container || container.dataset.radarSet === radarSet) return;
  // 既存blipはin-placeでleft/topだけ書き換え、CSS transitionで滑らかに動かす(remove→再生成では発火しない。2系統レビュー共通指摘)。
  const existing = new Map([...container.querySelectorAll(".tower-blip")].map((blip) => [blip.dataset.blipId, blip]));
  const keep = new Set();
  radar.forEach((flight) => {
    const id = String(flight.id);
    keep.add(id);
    const blip = existing.get(id);
    const point = blipPoint(flight);
    if (blip) {
      blip.style.left = `${point.x}%`;
      blip.style.top = `${point.y}%`;
    } else {
      container.insertAdjacentHTML("beforeend", radarBlipsHTML([flight]));
    }
  });
  existing.forEach((blip, id) => { if (!keep.has(id)) blip.remove(); });
  container.dataset.radarSet = radarSet;
}

function updateTowerRadio() {
  // innerHTML文字列比較はescapeHTMLの実体参照がシリアライズで戻り永久不一致になる(レビューM1)。datasetキー比較に統一。
  const container = document.getElementById("towerRadioLines");
  if (!container || container.dataset.radioSet === radioSetKey()) return;
  container.innerHTML = radioLinesHTML();
  container.dataset.radioSet = radioSetKey();
}

function updateTodayTowerTick() {
  const blocks = blocksForDate(todayISO());
  const clock = document.getElementById("towerClock");
  const dayLeft = document.getElementById("towerDayLeft");
  if (!clock || !dayLeft) return;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  clock.textContent = clockText(now);
  dayLeft.textContent = dayLeftText(now);
  updateTowerRunway(now, blocks);
  updateTowerGauges(blocks, nowMin);
  updateTowerGates(blocks);
  const flights = boardFlights(blocks, nowMin);
  updateTowerApron(apronFlightsOf(flights, blocks));
  updateTowerRadar(flights, nowMin);
  radioObserve(flights);
  updateTowerRadio();
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
