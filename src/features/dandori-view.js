let deps;
let renderedDate = null, tickerId = null;
let freeTitle = "";
if (typeof document !== "undefined") document.addEventListener("input", event => {
  if (event.target?.matches('[data-field="dandori-free-title"]')) freeTitle = event.target.value;
});
export function configureDandoriView(value) { deps = value; return { duplicateDandoriBlock }; }

if (typeof document !== "undefined") document.addEventListener("change", event => {
  const input = event.target;
  if (!input?.matches('[data-field="dandori-start"], [data-field="dandori-end"]')) return;
  const today = deps.todayISO(), block = pending(today).find(b => b.id === input.dataset.id);
  if (!block) return;
  const field = input.dataset.field === "dandori-start" ? "plannedStartAt" : "plannedEndAt";
  const restore = () => { input.value = deps.timeFromDateTime(block[field]) || ""; };
  if (!input.value) { restore(); return; }
  if (input.value === deps.timeFromDateTime(block[field])) return;
  const value = `${today}T${input.value}`;
  const start = field === "plannedStartAt" ? value : block.plannedStartAt;
  let end = field === "plannedEndAt" ? value : block.plannedEndAt;
  const fillEnd = field === "plannedStartAt" && !end;
  if (fillEnd) end = deps.dateToLocalDateTime(new Date(deps.localDateTimeToMs(start) + deps.resolveEstimateMin(block) * 60000));
  if (start && end && (end.slice(0, 10) !== today || deps.localDateTimeToMs(end) < deps.localDateTimeToMs(start))) {
    restore();
    deps.showToast("終了は開始より後にしてください");
    return;
  }
  if (!deps.updateBlockField(block.id, field, value)) return;
  if (fillEnd && !deps.updateBlockField(block.id, "plannedEndAt", end)) return;
  deps.render();
});

function updateDandoriTick() {
  const state = deps.getState();
  if (state.currentView !== "dandori") {
    clearInterval(tickerId);
    tickerId = null;
    return;
  }
  if (typeof document === "undefined" || document.hidden) return;
  const container = document.querySelector(".dandori-view");
  if (container?.contains(document.activeElement)) return;
  const today = deps.todayISO();
  if (renderedDate !== null && today !== renderedDate) {
    renderedDate = today;
    state.selectedDate = today;
    deps.renderDeferringForFocus();
  }
}

function pending(date) {
  return deps.blocksForDate(date).filter(b => !b.completed && !b.actualStartAt && !b.migratedTo && b.category !== "ルーティン");
}
function scheduled(taskId, date) {
  return deps.blocksForDate(date).some(b => b.taskId === taskId);
}
export function moveDandoriBlock(id, dir) {
  if (dir !== "up" && dir !== "down") return;
  const blocks = pending(deps.todayISO()), index = blocks.findIndex(b => b.id === id);
  const block = blocks[index], neighbor = blocks[index + (dir === "up" ? -1 : 1)];
  if (!block || !neighbor) return;
  if (!block.plannedStartAt || !neighbor.plannedStartAt) {
    deps.showToast("開始時刻のない予定とは入れ替えられません");
    return;
  }
  const duration = b => b.plannedEndAt
    ? deps.localDateTimeToMs(b.plannedEndAt) - deps.localDateTimeToMs(b.plannedStartAt)
    : deps.resolveEstimateMin(b) * 60000;
  const lengths = [duration(block), duration(neighbor)];
  [block.plannedStartAt, neighbor.plannedStartAt] = [neighbor.plannedStartAt, block.plannedStartAt];
  [block, neighbor].forEach((b, i) => {
    b.plannedEndAt = deps.dateToLocalDateTime(new Date(deps.localDateTimeToMs(b.plannedStartAt) + lengths[i]));
  });
  deps.saveAndRender();
}
export function addDandoriTask(id) {
  const today = deps.todayISO();
  const task = deps.fillGapTaskPool(today).find(t => t.id === id);
  if (!task || scheduled(id, today)) return;
  const plannedStartAt = tailStart(today);
  const block = deps.createBlockFromTask(id, { plannedStartAt, estimateMin: deps.resolveEstimateMin(task), silent: true });
  if (!block) return;
  block.date = today;
  deps.saveAndRender("今日のBlockに追加しました");
}
function tailStart(today) {
  const end = deps.blocksForDate(today).flatMap(b => [b.plannedEndAt || "", b.actualEndAt || ""]).sort().at(-1);
  let { plannedStartAt } = deps.defaultPlannedTimes(today);
  const match = end?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const minutes = Math.ceil((Number(match[2]) * 60 + Number(match[3]) + Number(match[4] || 0) / 60) / 5) * 5;
    const date = deps.addDays(match[1], Math.floor(minutes / 1440));
    plannedStartAt = `${date}T${String(Math.floor(minutes % 1440 / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;
  }
  return plannedStartAt;
}
function addCandidate(input) {
  const date = deps.todayISO(), plannedStartAt = tailStart(date);
  const block = deps.makeBlock({ ...input, date, plannedStartAt });
  if (input.copiedFromId) block.copiedFromId = input.copiedFromId;
  block.plannedEndAt = deps.dateToLocalDateTime(new Date(deps.localDateTimeToMs(plannedStartAt) + deps.resolveEstimateMin(block) * 60000));
  deps.getState().blocks.push(block);
  deps.saveAndRender("今日のBlockに追加しました");
}
function duplicateDandoriBlock(id) {
  const block = pending(deps.todayISO()).find(b => b.id === id);
  if (!block) return;
  addCandidate({ title: block.title, category: block.category, estimateMin: deps.resolveEstimateMin(block),
    taskId: block.taskId, copiedFromId: block.id });
}
export function addDandoriFree() {
  const input = document.querySelector('[data-field="dandori-free-title"]');
  const title = input?.value.trim();
  if (!title) return;
  input.value = "";
  freeTitle = "";
  addCandidate({ title, taskId: deps.getOtherTask()?.id || "", category: deps.getCategoryNames()[0] || "" });
}
export function renderDandoriView() {
  const { escapeHTML: e, getState, todayISO, addDays, blocksForDate, timeFromDateTime, resolveEstimateMin } = deps;
  const state = getState(), today = todayISO(), blocks = pending(today);
  renderedDate = today;
  if (tickerId === null && typeof document !== "undefined") tickerId = setInterval(updateDandoriTick, 1000);
  const carry = blocksForDate(addDays(today, -1)).filter(b => !b.completed && !b.migratedTo && b.category !== "ルーティン");
  const pool = deps.fillGapTaskPool(today)
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  const tasks = [...pool.filter(t => !scheduled(t.id, today)).slice(0, 10), ...pool.filter(t => scheduled(t.id, today))];
  const button = (action, id, label, extra = "") => `<button type="button" class="btn" data-action="${action}" data-id="${e(id)}" ${extra}>${label}</button>`;
  return `<section class="dandori-view" aria-label="段取り">
    ${state.selectedDate !== today ? "<p>時間軸は選択日、段取りは今日です</p>" : ""}
    <header><h2>段取り — 今日 ${e(today)}</h2><p>${blocks.length}件 ・ 見積 ${blocks.reduce((sum, b) => sum + resolveEstimateMin(b), 0)}分 ・ <span class="dandori-end">${e(deps.projectedEndText({ exclude: b => b.category === "ルーティン" }) || "見込み終了 —")}</span></p></header>
    <div class="dandori-columns"><section class="dandori-today"><h3>今日やる</h3>
      ${blocks.map((b, i) => `<article class="dandori-card" data-block-id="${e(b.id)}">
        <span class="dandori-number">${i + 1}</span><div class="dandori-info"><strong>${e(b.title)}</strong>
        <div class="dandori-times"><input type="time" step="300" data-field="dandori-start" data-id="${e(b.id)}" value="${e(timeFromDateTime(b.plannedStartAt) || "")}" aria-label="予定開始">〜<input type="time" step="300" data-field="dandori-end" data-id="${e(b.id)}" value="${e(timeFromDateTime(b.plannedEndAt) || "")}" aria-label="予定終了"></div>
        <small>見積 ${resolveEstimateMin(b)}分 ・ ${e(b.category || "未分類")}</small></div>
        <div class="dandori-ops">${button("dandori-move", b.id, "▲", `data-dir="up" aria-label="上へ"${i === 0 ? " disabled" : ""}`)}${button("dandori-move", b.id, "▼", `data-dir="down" aria-label="下へ"${i === blocks.length - 1 ? " disabled" : ""}`)}${button("edit-block", b.id, "直す")}${button("dandori-duplicate", b.id, "複製")}${button("dandori-remove", b.id, "外す")}</div></article>`).join("") || "<p>今日やることを候補から選びましょう。</p>"}
    </section><section class="dandori-candidates"><h3>候補</h3>
      <div class="dandori-free"><input data-field="dandori-free-title" value="${e(freeTitle)}" aria-label="自由追加" placeholder="自由に追加(Block名)" autocomplete="off">${button("dandori-add-free", "", "足す")}</div>
      <h4>昨日の持ち越し</h4><div class="dandori-options">
      ${carry.map(b => button("carry-over", b.id, `${e(b.title)}<small>${e(timeFromDateTime(b.plannedStartAt) || "--:--")}</small>`)).join("") || "<p>持ち越しはありません。</p>"}
      </div><h4>期限が近いタスク</h4><div class="dandori-options">
      ${tasks.map(t => button("dandori-add-task", t.id, `${e(t.title)}<small>${e(t.dueDate || "期限なし")}${scheduled(t.id, today) ? " ・ 追加済み" : ""}</small>`, scheduled(t.id, today) ? 'aria-disabled="true"' : "")).join("") || "<p>候補はありません。</p>"}
    </div></section></div></section>`;
}
