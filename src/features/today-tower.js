// src/features/today-tower.js — v203: TOWERスキンの読み取り専用TWRヘッダ。
// state・保存・action登録には触れず、時刻表示はtoday.jsの既存1秒tickerから差分更新する。

let escapeHTML, todayISO, homeSyncAlertBanner;

function configureTodayTower(deps) {
  ({ escapeHTML, todayISO, homeSyncAlertBanner } = deps);
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
  </div>`;
}

function updateTodayTowerTick() {
  const clock = document.getElementById("towerClock");
  const dayLeft = document.getElementById("towerDayLeft");
  if (!clock || !dayLeft) return;
  const now = new Date();
  clock.textContent = clockText(now);
  dayLeft.textContent = dayLeftText(now);
}

export { configureTodayTower, renderTodayTower, updateTodayTowerTick };
