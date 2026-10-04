import { weekTowers, towerScale, ringState, beatYesterday } from "../core/tower-week.js";

let getState, escapeHTML, todayISO, blocksForDate, localDateTimeToMs, timeFromDateTime, resolveEstimateMin;
let beatenShownFor = null;
const towerDays = ["月", "火", "水", "木", "金", "土", "日"];
let visibilityBound = false;
let declarationStartId = null;
const declarationDrafts = new Map();
if (typeof document !== "undefined") document.addEventListener("input", event => {
  if (event.target?.matches('[data-field="now-declaration"]')) declarationDrafts.set(event.target.dataset.id, event.target.value);
});

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
  const match = typeof value === "string" && value.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return Boolean(match && +match[1] >= 1 && +match[1] <= 12 && +match[2] >= 1 && +match[2] <= 31
    && +match[3] <= 23 && +match[4] <= 59);
}

function clearStartedDrafts() {
  for (const block of getState().blocks) {
    if (!block.actualStartAt) continue;
    const id = String(block.id);
    declarationDrafts.delete(id);
    if (declarationStartId === id) declarationStartId = null;
  }
}

// now-start によるモーダル生成後に初期値を渡す。
export function withNowDeclaration(action, startId) {
  const { currentView, settings } = getState();
  if (currentView !== "now" && !(currentView === "today" && settings.todaySkin === "now")) return action();
  if (startId !== undefined) declarationStartId = String(startId);
  if (declarationStartId === null) return action();
  const result = action();
  const modal = getState().modal, input = document.querySelector('[data-declare-note]');
  const id = String(modal?.id);
  if (modal?.type === "declare" && id === declarationStartId && input && declarationDrafts.has(id) && input.dataset.nowDraftId !== id) {
    input.value = declarationDrafts.get(id);
    input.dataset.nowDraftId = id;
  }
  return result;
}

function candidateHTML(block) {
  const id = escapeHTML(block.id), estimate = resolveEstimateMin(block);
  return `<article class="now-candidate">
    <div class="now-candidates"><button type="button" data-action="${isRoutineBlock(block) ? "now-routine-complete" : "now-start"}" data-id="${id}"><strong>${block.isMIT ? "★ " : ""}${escapeHTML(block.title)}</strong><small>${escapeHTML(timeFromDateTime(block.plannedStartAt) || "時刻未定")} · 見積 ${escapeHTML(estimate)}分</small></button></div>
    <button type="button" class="now-actual-button" data-action="complete-block-with-actual" data-id="${id}">実績付きで完了</button>
  </article>`;
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
    <div class="now-record-heading"><strong>${escapeHTML(block.title)}</strong><button type="button" data-action="edit-block" data-id="${escapeHTML(block.id)}">編集</button></div><p><time>${escapeHTML(recordTimeText(block))}</time></p>
    <p class="now-comment">${escapeHTML(block.comment || "")}</p></article>`;
}

function durationText(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}時間${String(minutes % 60).padStart(2, "0")}分`;
}

function stackData(blocks, today) {
  const nowMs = Date.now(), towers = weekTowers(blocks, today, nowMs, localDateTimeToMs);
  if (beatenShownFor !== today) beatenShownFor = null;
  return { towers, scale: towerScale(towers), ring: ringState(blocks, today, nowMs, localDateTimeToMs),
    beat: beatYesterday(blocks, today, nowMs, localDateTimeToMs) };
}

function beatenFlag(beat, today) {
  if (!beat.beaten || beatenShownFor === today) return "0";
  beatenShownFor = today;
  return "1";
}

function ringLabel(ring) {
  return `輪 ${ring.laps}周と ${Math.floor(ring.lapProgress * 30)}分`;
}

function stackHTML(blocks, today) {
  const { towers, scale, ring, beat } = stackData(blocks, today);
  return `<div class="now-tower-frame" aria-label="今週の実績"><div class="now-tower-plot" style="height:${scale.ceilingSeconds / scale.lines.at(-1) * 100}%">
    <div class="now-tower-lines">${scale.lines.map(seconds => `<div class="now-tower-line" style="bottom:${seconds / scale.ceilingSeconds * 100}%">${seconds / 3600}h</div>`).join("")}</div>
    ${towers.map((tower, index) => `<div class="now-tower-day"><div class="now-tower" role="img" data-date="${tower.date}" data-today="${tower.isToday ? "1" : "0"}" data-future="${tower.isFuture ? "1" : "0"}" style="height:${tower.seconds / scale.ceilingSeconds * 100}%" aria-label="${towerDays[index]}曜 ${durationText(tower.seconds)}"></div><span>${towerDays[index]}</span></div>`).join("")}</div></div>
    <div class="now-ring-frame" role="img" aria-label="${ringLabel(ring)}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" pathLength="1" stroke-dasharray="${ring.lapProgress} 1" /></svg><strong>${ring.laps}</strong></div>
    <p class="now-beaten" data-beaten="${beatenFlag(beat, today)}"${beat.beaten ? "" : " hidden"}>昨日を超えた</p><small class="now-yesterday">昨日 ${durationText(beat.yesterday)}</small>`;
}

function updateStackTick(root, blocks, today) {
  const stack = root.querySelector(".now-stack");
  if (!stack || stack.contains(document.activeElement)) return;
  const { towers, scale, ring, beat } = stackData(blocks, today);
  stack.querySelector(".now-tower-plot").style.height = `${scale.ceilingSeconds / scale.lines.at(-1) * 100}%`;
  towers.forEach((tower, index) => {
    const bar = stack.querySelector(`.now-tower[data-date="${tower.date}"]`);
    if (!bar) return;
    bar.style.height = `${tower.seconds / scale.ceilingSeconds * 100}%`;
    bar.setAttribute("aria-label", `${towerDays[index]}曜 ${durationText(tower.seconds)}`);
  });
  const lines = stack.querySelector(".now-tower-lines");
  while (lines.children.length > scale.lines.length) lines.lastElementChild.remove();
  scale.lines.forEach((seconds, index) => {
    const line = lines.children[index] || lines.appendChild(document.createElement("div"));
    line.className = "now-tower-line";
    line.style.bottom = `${seconds / scale.ceilingSeconds * 100}%`;
    line.textContent = `${seconds / 3600}h`;
  });
  const frame = stack.querySelector(".now-ring-frame");
  frame.setAttribute("aria-label", ringLabel(ring));
  frame.querySelector("circle").setAttribute("stroke-dasharray", `${ring.lapProgress} 1`);
  frame.querySelector("strong").textContent = ring.laps;
  const beaten = stack.querySelector(".now-beaten");
  beaten.hidden = !beat.beaten;
  if (beat.beaten && beatenShownFor !== today) beaten.dataset.beaten = beatenFlag(beat, today);
  stack.querySelector(".now-yesterday").textContent = `昨日 ${durationText(beat.yesterday)}`;
}

function isRoutineBlock(b) {
  return b.category === "ルーティン";
}

export function renderNowView() {
  clearStartedDrafts();
  const state = getState(), today = todayISO(), blocks = blocksForDate(today);
  const pending = blocks.filter(b => !b.completed && !b.actualStartAt && !b.actualEndAt)
    .sort((a, b) => String(a.plannedStartAt || "~").localeCompare(String(b.plannedStartAt || "~")) || (a.orderIndex || 0) - (b.orderIndex || 0));
  const pendingBlocks = pending.filter(b => !isRoutineBlock(b));
  const pendingRoutines = pending.filter(isRoutineBlock);
  const running = state.blocks.filter(b => !b.deleted && b.actualStartAt && !b.actualEndAt && !b.completed);
  const records = blocks.filter(b => b.completed || (b.actualStartAt && b.actualEndAt));
  const history = state.blocks.filter(b => !b.deleted && b.date < today && (b.completed || (b.actualStartAt && b.actualEndAt)))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.actualStartAt || "").localeCompare(String(a.actualStartAt || "")));
  const startSection = `<section class="now-start"><h2>開始</h2><div class="now-candidate-list" data-kind="block">${pendingBlocks.map(candidateHTML).join("")}
      ${!blocks.length ? '<p>今日やることはまだ決まっていません。</p><button type="button" data-action="nav" data-view="dandori">段取りで決める</button>' : !pendingBlocks.length ? '<p>未着手の Block はありません。</p>' : ""}</div>
      ${pendingRoutines.length ? `<div class="now-routine"><h3>ルーティン <button type="button" data-action="nav" data-view="routine">編集</button></h3><div class="now-candidate-list" data-kind="routine">${pendingRoutines.map(candidateHTML).join("")}</div></div>` : ""}</section>`;
  const currentSection = `<section class="now-current"><h2>いま</h2>${running.map(b => `<article class="now-running" data-running-id="${escapeHTML(b.id)}"><div class="now-elapsed" data-elapsed-id="${escapeHTML(b.id)}">${elapsedText(b)}</div><small>経過</small><h3>${b.isMIT ? "★ " : ""}${escapeHTML(b.title)}</h3><button type="button" data-action="now-end" data-id="${escapeHTML(b.id)}">終了報告</button></article>`).join("") || '<p>実行中の Block はありません。開始するカードを選んでください。</p>'}</section>`;
  return `<div class="now-view" data-running="${running.length ? "1" : "0"}" data-motion="${escapeHTML(state.settings.towerMotion || "normal")}" data-paused="${document.hidden ? "1" : "0"}">
    ${running.length ? currentSection + startSection : startSection + currentSection}
    <section class="now-done"><h2>今日できた</h2>${records.map(recordHTML).join("") || '<p>終えたことが、ここに残ります。</p>'}
      ${history.length ? `<details><summary>これまでの履歴</summary>${history.slice(0, 30).map(b => `<div><small>${escapeHTML(b.date)}</small>${recordHTML(b)}</div>`).join("")}${history.length > 30 ? '<p>ほかの記録は実行タブの実績で見られます</p>' : ""}</details>` : ""}
      <p class="now-journal-link"><button type="button" data-action="nav" data-view="journal">日報を書く ›</button></p></section>
    <section class="now-stack"><h2>積み上げ</h2>${stackHTML(state.blocks, today)}</section>
  </div>`;
}

export function updateNowViewTick() {
  clearStartedDrafts();
  if (document.hidden) return;
  const root = document.querySelector(".now-view");
  if (!root || root.dataset.paused === "1") return;
  root.querySelectorAll("[data-elapsed-id]").forEach(container => {
    if (container.contains(document.activeElement)) return;
    const block = getState().blocks.find(b => String(b.id) === container.dataset.elapsedId);
    if (hasDateTime(block?.actualStartAt) && !block.actualEndAt) container.textContent = elapsedText(block);
  });
  const blocks = getState().blocks;
  if (blocks.some(b => !b.deleted && !b.completed && hasDateTime(b.actualStartAt) && !b.actualEndAt)) updateStackTick(root, blocks, todayISO());
}
