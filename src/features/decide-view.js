import { state } from "../state/store.js";
import { registerActions } from "../ui/actions.js";
import { collapseSeries } from "../core/work-series.js";
import { renderWorkTaskRow, workDateLabel, workDueMatches } from "./work-list.js";

let deps, selected = "";
function configureDecideView(injected) {
  deps = injected;
  registerActions({ "decide-filter": ({ target }) => {
    selected = selected === target.dataset.value ? "" : target.dataset.value;
    target.closest("[data-decide-view]").outerHTML = renderDecideView();
  }, "decide-adopt": ({ target, id }) => saveDecision(id, target.closest('[data-nudge-id]').dataset.suggestion, target),
  "decide-pick": ({ target, id }) => {
    const row = target.closest('[data-nudge-id]');
    if (!row.querySelector('[data-work-edit="decideDate"]')) target.insertAdjacentHTML('afterend', `<input class="input" style="font-size:16px" type="date" data-work-edit="decideDate" data-id="${deps.escapeHTML(id)}" aria-label="別の日">`);
    row.querySelector('[data-work-edit="decideDate"]').focus();
  } });
}
function decidedToday() {
  return state.tasks.filter(t => !t.deleted && t.dueDecidedAt === deps.todayISO()).length;
}
function saveDecision(id, date, target) {
  const task = state.tasks.find(t => t.id === id && !t.deleted);
  if (!task || !date || decidedToday() >= 5) return false;
  const ok = deps.saveDecision(() => {
    deps.updateTaskField(id, "dueDate", date);
    deps.updateTaskField(id, "dueDecidedAt", deps.todayISO());
    deps.updateTaskField(id, "dueNudge", null);
  });
  if (ok) target.closest('[data-decide-view]').outerHTML = renderDecideView();
  return ok;
}
function handleDecideEdit(target) {
  if (target.dataset.workEdit !== "decideDate") return false;
  if (!target.validity.valid || !saveDecision(target.dataset.id, target.value, target)) target.value = "";
  return true;
}
function managedTasks() {
  const projects = new Set(state.projects.filter(p => !p.deleted && p.dueManaged === true).map(p => p.id));
  return state.tasks.filter(t => !t.deleted && t.kind !== "other" && projects.has(t.projectId) && ["todo", "doing"].includes(t.status));
}
function undecidedCount() { return collapseSeries(managedTasks().filter(t => !deps.dueDate(t))).length; }
function suggestDue(task, today) {
  const project = state.projects.find(p => !p.deleted && p.id === task.projectId);
  const cycleDay = project?.twelveWeekStartDate ? deps.daysBetween(project.twelveWeekStartDate, today) : -1;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  const weekday = new Date(+parts[1], +parts[2] - 1, +parts[3]).getDay();
  const friday = deps.addDays(today, 4 - (weekday + 6) % 7);
  if (cycleDay >= 0 && cycleDay < 84 && friday >= today) return { date: friday, reason: "12週目標の週の金曜" };
  const created = /^\d{4}-\d{2}-\d{2}/.exec(task.createdAt || "")?.[0];
  const date = created && deps.addDays(created, 14);
  return date && date >= deps.addDays(today, 2) ? { date, reason: "作成から2週間" } : { date: deps.addDays(today, 5), reason: "作成から2週間を過ぎているので5日後" };
}
function renderDecideView() {
  const today = deps.todayISO(), e = deps.escapeHTML, tasks = managedTasks(), done = decidedToday();
  const matches = (t, key) => workDueMatches(t, key, today) && (key !== "week" || deps.dueDate(t) > today);
  const chips = [["overdue", "超過"], ["today", "今日"], ["week", "7日以内"], ["none", "期日なし"]].map(([key, label]) => {
    const count = key === "none" ? undecidedCount() : tasks.filter(t => matches(t, key)).length;
    return `<button class="btn" data-action="decide-filter" data-value="${key}" aria-pressed="${selected === key}">${label} ${count}</button>`;
  }).join("");
  const nudges = collapseSeries(tasks.filter(t => !deps.dueDate(t) && !state.tasks.find(p => !p.deleted && p.projectId === t.projectId && p.id === t.parentTaskId)?.dueDate))
    .map(g => g.task).sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""))).slice(0, Math.max(0, 5 - done));
  const proposals = nudges.map(t => {
    const proposal = suggestDue(t, today), project = state.projects.find(p => p.id === t.projectId);
    return `<article class="work-nudge" data-nudge-id="${e(t.id)}" data-suggestion="${e(proposal.date)}"><strong>${e(t.title)}</strong><div>${e(project.title)} ・ 提案 ${workDateLabel(proposal.date, true)} ${proposal.reason}</div><div class="work-decide-chips"><button class="btn" data-action="decide-adopt" data-id="${e(t.id)}">${workDateLabel(proposal.date)} に</button><button class="btn" data-action="decide-pick" data-id="${e(t.id)}" aria-label="別の日を選ぶ">📅</button><select class="select" style="font-size:16px" data-work-nudge-cycle="${e(t.id)}" aria-label="期日なしでよい。いつ再確認するか"><option value="">期日なし…</option></select></div></article>`;
  }).join("");
  const rows = selected ? tasks.filter(t => matches(t, selected)).map(t => renderWorkTaskRow(t)).join("") : "";
  return `<section class="tower-skin decide-view" data-decide-view>${deps.renderHeader("期日の管理", "決めること")}<h2>今日 ${done}/5 件</h2><div class="work-decide-chips">${chips}</div><h3>期日を決めてほしいもの</h3>${done >= 5 ? '<p>今日の分(5 件)は決め終わりました。続きは明日。</p>' : proposals || '<p>期日を決めるものはありません。</p>'}${selected ? `<div data-decide-results>${rows || '<p>該当するタスクはありません。</p>'}</div>` : ""}</section>`;
}
export { configureDecideView, renderDecideView, undecidedCount, handleDecideEdit };
