let deps;
export function configureDandoriView(value) { deps = value; }

function pending(date) {
  return deps.blocksForDate(date).filter(b => !b.completed && !b.actualStartAt && !b.migratedTo);
}
function scheduled(taskId, date) {
  return deps.blocksForDate(date).some(b => b.taskId === taskId);
}
export function moveDandoriBlock(id, dir) {
  if (dir !== "up" && dir !== "down") return;
  const blocks = pending(deps.getState().selectedDate), index = blocks.findIndex(b => b.id === id);
  const block = blocks[index], neighbor = blocks[index + (dir === "up" ? -1 : 1)];
  if (!block || !neighbor) return;
  [block.plannedStartAt, neighbor.plannedStartAt] = [neighbor.plannedStartAt, block.plannedStartAt];
  [block.plannedEndAt, neighbor.plannedEndAt] = [neighbor.plannedEndAt, block.plannedEndAt];
  deps.saveAndRender();
}
export function addDandoriTask(id) {
  const state = deps.getState(), today = deps.todayISO();
  const task = state.tasks.find(t => t.id === id && !t.deleted && t.status !== "completed" && t.kind !== "other");
  if (!task || scheduled(id, today)) return;
  const last = pending(today).at(-1);
  let { plannedStartAt } = deps.defaultPlannedTimes(today);
  const match = last?.plannedEndAt?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const minutes = Math.ceil((Number(match[2]) * 60 + Number(match[3]) + Number(match[4] || 0) / 60) / 5) * 5;
    const date = deps.addDays(match[1], Math.floor(minutes / 1440));
    plannedStartAt = `${date}T${String(Math.floor(minutes % 1440 / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;
  }
  state.selectedDate = today;
  deps.createBlockFromTask(id, { plannedStartAt });
}
export function renderDandoriView() {
  const { escapeHTML: e, getState, todayISO, addDays, blocksForDate, timeFromDateTime, resolveEstimateMin, projectedEndText } = deps;
  const state = getState(), today = todayISO(), blocks = pending(state.selectedDate);
  const carry = blocksForDate(addDays(today, -1)).filter(b => !b.completed && !b.migratedTo);
  const tasks = state.tasks.filter(t => !t.deleted && t.status !== "completed" && t.kind !== "other")
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")).slice(0, 10);
  const button = (action, id, label, extra = "") => `<button type="button" class="btn" data-action="${action}" data-id="${e(id)}" ${extra}>${label}</button>`;
  return `<section class="dandori-view" aria-label="段取り">
    <header><h2>段取り</h2><p>${blocks.length}件 ・ 見積 ${blocks.reduce((sum, b) => sum + resolveEstimateMin(b), 0)}分 ・ <span class="dandori-end">${e(projectedEndText() || "見込み終了 —")}</span></p></header>
    <div class="dandori-columns"><section class="dandori-today"><h3>今日やる</h3>
      ${blocks.map((b, i) => `<article class="dandori-card" data-block-id="${e(b.id)}">
        <span class="dandori-number">${i + 1}</span><div class="dandori-info"><strong>${e(b.title)}</strong>
        <small>${e(timeFromDateTime(b.plannedStartAt) || "--:--")} ・ 見積 ${resolveEstimateMin(b)}分 ・ ${e(b.category || "未分類")}</small></div>
        <div class="dandori-ops">${button("dandori-move", b.id, "▲", `data-dir="up" aria-label="上へ"${i === 0 ? " disabled" : ""}`)}${button("dandori-move", b.id, "▼", `data-dir="down" aria-label="下へ"${i === blocks.length - 1 ? " disabled" : ""}`)}${button("edit-block", b.id, "直す")}${button("dandori-remove", b.id, "外す")}</div></article>`).join("") || "<p>今日やることを候補から選びましょう。</p>"}
    </section><section class="dandori-candidates"><h3>候補</h3><h4>昨日の持ち越し</h4><div class="dandori-options">
      ${carry.map(b => button("carry-over", b.id, `${e(b.title)}<small>${e(timeFromDateTime(b.plannedStartAt) || "--:--")}</small>`)).join("") || "<p>持ち越しはありません。</p>"}
      </div><h4>期限が近いタスク</h4><div class="dandori-options">
      ${tasks.map(t => button("dandori-add-task", t.id, `${e(t.title)}<small>${e(t.dueDate || "期限なし")}${scheduled(t.id, today) ? " ・ 追加済み" : ""}</small>`, scheduled(t.id, today) ? 'aria-disabled="true"' : "")).join("") || "<p>候補はありません。</p>"}
    </div></section></div></section>`;
}
