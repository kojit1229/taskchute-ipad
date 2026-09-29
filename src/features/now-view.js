let getState, escapeHTML, todayISO, blocksForDate, localDateTimeToMs, timeFromDateTime, resolveEstimateMin;
let visibilityBound = false;

export function configureNowView(deps) {
  ({ getState, escapeHTML, todayISO, blocksForDate, localDateTimeToMs, timeFromDateTime, resolveEstimateMin } = deps);
  if (!visibilityBound && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      const root = document.querySelector(".now-view");
      if (root) root.dataset.paused = document.hidden ? "1" : "0";
      if (!document.hidden) updateNowViewTick();
    });
    visibilityBound = true;
  }
}

function hasDateTime(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
}

function elapsedText(block) {
  if (!hasDateTime(block.actualStartAt)) return "--:--";
  const seconds = Math.max(0, Math.floor((Date.now() - localDateTimeToMs(block.actualStartAt)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function recordTimeText(block) {
  if (!hasDateTime(block.actualStartAt)) return "時刻不明";
  if (!block.actualEndAt && block.completed) return `${timeFromDateTime(block.actualStartAt)}〜`;
  if (!hasDateTime(block.actualEndAt)) return "時刻不明";
  const start = localDateTimeToMs(block.actualStartAt);
  const end = new Date(Math.max(start + 60000, localDateTimeToMs(block.actualEndAt)));
  const pad = n => String(n).padStart(2, "0");
  const endDate = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
  const endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  return `${timeFromDateTime(block.actualStartAt)}〜${endDate !== block.actualStartAt.slice(0, 10) ? endDate + " " : ""}${endTime}`;
}

function recordHTML(block) {
  return `<article class="now-record" data-record-id="${escapeHTML(block.id)}">
    <strong>${escapeHTML(block.title)}</strong><p><time>${escapeHTML(recordTimeText(block))}</time></p>
    <p class="now-comment">${escapeHTML(block.comment || "")}</p></article>`;
}

export function renderNowView() {
  const state = getState(), today = todayISO(), blocks = blocksForDate(today);
  const pending = blocks.filter(b => !b.completed && !b.actualStartAt && !b.actualEndAt)
    .sort((a, b) => String(a.plannedStartAt || "~").localeCompare(String(b.plannedStartAt || "~")) || (a.orderIndex || 0) - (b.orderIndex || 0));
  const running = state.blocks.filter(b => !b.deleted && b.actualStartAt && !b.actualEndAt && !b.completed);
  const records = blocks.filter(b => b.completed || (b.actualStartAt && b.actualEndAt));
  const history = state.blocks.filter(b => !b.deleted && b.date < today && (b.completed || (b.actualStartAt && b.actualEndAt)))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.actualStartAt || "").localeCompare(String(a.actualStartAt || "")));
  return `<div class="now-view" data-motion="${escapeHTML(state.settings.towerMotion || "normal")}" data-paused="${document.hidden ? "1" : "0"}">
    <section class="now-start"><h2>開始</h2><div class="now-candidates">${pending.map(b => `<button type="button" data-action="now-start" data-id="${escapeHTML(b.id)}"><strong>${b.isMIT ? "★ " : ""}${escapeHTML(b.title)}</strong><small>${escapeHTML(timeFromDateTime(b.plannedStartAt) || "時刻未定")} · 見積 ${escapeHTML(resolveEstimateMin(b))}分</small></button>`).join("")}</div>
      ${!blocks.length ? '<p>今日やることはまだ決まっていません。</p><button type="button" data-action="nav" data-view="exec">段取りで決める</button>' : !pending.length ? '<p>未着手の Block はありません。</p>' : ""}</section>
    <section class="now-current"><h2>いま</h2>${running.map(b => `<article class="now-running" data-running-id="${escapeHTML(b.id)}"><div class="now-elapsed" data-elapsed-id="${escapeHTML(b.id)}">${elapsedText(b)}</div><small>経過</small><h3>${b.isMIT ? "★ " : ""}${escapeHTML(b.title)}</h3><button type="button" data-action="now-end" data-id="${escapeHTML(b.id)}">終了報告</button></article>`).join("") || '<p>実行中の Block はありません。開始するカードを選んでください。</p>'}</section>
    <section class="now-done"><h2>今日できた</h2>${records.map(recordHTML).join("") || '<p>終えたことが、ここに残ります。</p>'}
      ${history.length ? `<details><summary>これまでの履歴</summary>${history.slice(0, 30).map(b => `<div><small>${escapeHTML(b.date)}</small>${recordHTML(b)}</div>`).join("")}${history.length > 30 ? '<p>ほかの記録は実行タブの実績で見られます</p>' : ""}</details>` : ""}</section>
    <section class="now-stack"><h2>積み上げ</h2><div class="now-tower-frame" aria-label="タワーの枠"><span>今日の本</span></div><div class="now-ring-frame" aria-label="輪の枠"></div></section>
    <section class="now-next"><h2>これから</h2>${pending.map(b => `<p>${escapeHTML(timeFromDateTime(b.plannedStartAt))} ${escapeHTML(b.title)}</p>`).join("") || '<p>ひと息ついて、次のことへ。</p>'}</section>
  </div>`;
}

export function updateNowViewTick() {
  if (document.hidden) return;
  const root = document.querySelector(".now-view");
  if (!root) return;
  root.querySelectorAll("[data-elapsed-id]").forEach(container => {
    if (container.contains(document.activeElement)) return;
    const block = getState().blocks.find(b => String(b.id) === container.dataset.elapsedId);
    if (hasDateTime(block?.actualStartAt) && !block.actualEndAt) container.textContent = elapsedText(block);
  });
}
