import { workListRows, filterWorkList } from "../core/work-list.js";

// Read-only classification: Today uses the clock; execution uses the selected day.
export function candidateTasks(state, date, conditions = {}, deps) {
  const limit = conditions.due === "week" ? deps.addDays(date, 7) : "";
  return state.tasks.filter(task => !task.deleted && !deps.isTaskDead(task) && task.kind !== "other"
    && (conditions.status !== "no-wish" || !state.projects.some(project => project.id === task.projectId && project.kind === "wish"))
    && (!limit || Boolean(deps.dueDate(task)) && deps.dueDate(task) <= limit));
}

export function screenRowGroup(row) {
  if (row.kind !== "block") return "candidates";
  if (row.item.completed || row.item.actualEndAt) return "actuals";
  if (row.item.category === "ルーティン" && !row.item.oneTap) return "routines";
  if (!row.task || row.task.deleted || row.task.kind === "other") return "unlinked";
  return row.time ? "plans" : "untimed";
}

export function buildThreeScreenRows(state, { scope, today, conditions }, deps) {
  const date = scope.startsWith("exec") ? state.selectedDate : today;
  const candidates = scope === "exec-candidates";
  let rows = candidates
    ? workListRows({ ...state, tasks: candidateTasks(state, date, conditions, deps) }, { scope: "wbs", date, dueDate: deps.dueDate }).filter(row => row.kind === "task")
    : workListRows(state, { scope, date, mode: conditions.mode, dueDate: deps.dueDate });
  if (scope === "exec-actual") rows = rows.filter(row => screenRowGroup(row) === "actuals");
  const filters = candidates ? { ...conditions, status: "", due: conditions.due === "week" ? "" : conditions.due } : conditions;
  return { date, rows, shown: filterWorkList(rows, filters, date) };
}

export function renderScreenGroups(rows, renderRow) {
  const labels = { plans: "予定", untimed: "時刻未定の予定枠", unlinked: "その他の予定枠", routines: "ルーティン", actuals: "やったこと", candidates: "未完了Task" };
  return Object.entries(labels).map(([key, label]) => {
    const group = rows.filter(row => screenRowGroup(row) === key);
    return group.length ? `<section data-screen-group="${key}"><h3>${label}</h3>${group.map(renderRow).join("")}</section>` : "";
  }).join("");
}
