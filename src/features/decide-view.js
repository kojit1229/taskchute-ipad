import { state } from "../state/store.js";
import { registerActions } from "../ui/actions.js";
import { collapseSeries, nudgeKey } from "../core/work-series.js";
import { addMonths } from "../core/daily-time.js";
import { renderWorkTaskRow, workDateLabel, workDueMatches } from "./work-list.js";

let deps, selected = "";
const cycles = { "1w": "1週間後に再確認", "1m": "1か月後に再確認", "3m": "3か月後に再確認", never: "促さない" };
function configureDecideView(injected) {
  deps = injected;
  registerActions({ "decide-filter": ({ target }) => {
    selected = selected === target.dataset.value ? "" : target.dataset.value;
    target.closest("[data-decide-view]").outerHTML = renderDecideView();
  }, "decide-adopt": ({ target, id }) => saveDecision(id, target.closest('[data-nudge-id]').dataset.suggestion, target),
  "decide-pick": ({ target, id }) => {
    if (!currentDecisionTask(id, target)) return;
    const row = target.closest('[data-nudge-id]');
    if (!row.querySelector('[data-work-edit="decideDate"]')) target.insertAdjacentHTML('afterend', `<input class="input" style="font-size:16px" type="date" data-work-edit="decideDate" data-id="${deps.escapeHTML(id)}" aria-label="別の日">`);
    row.querySelector('[data-work-edit="decideDate"]').focus();
  }, "decide-resume": ({ target, id }) => {
    const task = state.tasks.find(t => t.id === id && !t.deleted);
    if (task && deps.saveDecision(() => writeNudge(task, null))) target.closest('[data-decide-view]').outerHTML = renderDecideView();
  } });
}
function decidedToday() {
  return new Set(state.tasks.filter(t => !t.deleted && (t.dueDecidedAt === deps.todayISO() || t.dueNudge?.decidedAt === deps.todayISO())).map(t => t.dueDecidedAt === deps.todayISO() ? `adopt:${t.id}` : nudgeKey(t))).size;
}
function recheckedToday() {
  return new Set(state.tasks.filter(t => !t.deleted && t.dueNudge?.decidedAt === deps.todayISO() && t.dueNudge.count >= 2).map(nudgeKey)).size;
}
function writeNudge(task, value) {
  const key = nudgeKey(task);
  for (const member of state.tasks.filter(t => !t.deleted && nudgeKey(t) === key && (!value || ["todo", "doing"].includes(t.status)))) {
    deps.updateTaskField(member.id, "dueNudge", value ? { ...value } : null);
  }
}
function inheritDueNudge(id) {
  const task = state.tasks.find(t => t.id === id && !t.deleted);
  if (!task?.dueNudge) return;
  const next = collapseSeries(state.tasks.filter(t => !t.deleted && t.id !== id && ["todo", "doing"].includes(t.status) && nudgeKey(t) === nudgeKey(task)))[0]?.task;
  if (next && (!next.dueNudge || next.dueNudge.decidedAt < task.dueNudge.decidedAt)) deps.updateTaskField(next.id, "dueNudge", { ...task.dueNudge });
}
function updateDecideTaskField(id, field, value) {
  if (field !== "dueDate" || !value) return deps.updateTaskField(id, field, value);
  return deps.saveDecision(() => {
    deps.updateTaskField(id, field, value);
    const task = state.tasks.find(t => t.id === id && !t.deleted);
    if (task) writeNudge(task, null);
  });
}
function currentDecisionTask(id, target) {
  const task = managedTasks().find(t => t.id === id && !t.dueDate);
  if (!task) target.closest('[data-decide-view]').outerHTML = renderDecideView();
  return task;
}
function saveDecision(id, date, target) {
  const task = currentDecisionTask(id, target);
  if (!task || !date || decidedToday() >= 5) return false;
  const ok = deps.saveDecision(() => {
    deps.updateTaskField(id, "dueDate", date);
    deps.updateTaskField(id, "dueDecidedAt", deps.todayISO());
    writeNudge(task, null);
  });
  if (ok) target.closest('[data-decide-view]').outerHTML = renderDecideView();
  return ok;
}
function handleDecideEdit(target) {
  if (target.matches('[data-work-nudge-cycle]')) {
    const task = currentDecisionTask(target.dataset.workNudgeCycle, target), cycle = target.value, today = deps.todayISO();
    if (!task || !Object.hasOwn(cycles, cycle) || decidedToday() >= 5 || (task.dueNudge?.at <= today && recheckedToday() >= 2)) { target.value = ""; return true; }
    const at = cycle === "never" ? "9999-12-31" : cycle === "1w" ? deps.addDays(today, 7) : addMonths(today, cycle === "1m" ? 1 : 3);
    const nudge = { cycle, at, decidedAt: today, key: nudgeKey(task), count: (task.dueNudge?.count || 0) + 1 };
    if (deps.saveDecision(() => writeNudge(task, nudge))) target.closest('[data-decide-view]').outerHTML = renderDecideView();
    else target.value = "";
    return true;
  }
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
  const heads = collapseSeries(tasks.filter(t => !deps.dueDate(t))).map(g => g.task);
  const matches = (t, key) => key === "never" ? t.dueNudge?.cycle === "never" : key === "sleep" ? t.dueNudge?.cycle !== "never" && t.dueNudge?.at > today : workDueMatches(t, key, today) && (key !== "week" || deps.dueDate(t) > today);
  const chips = [["overdue", "超過"], ["today", "今日"], ["week", "7日以内"], ["none", "期日なし"], ["sleep", "再確認待ち"], ["never", "促さない"]].map(([key, label]) => {
    const reminder = ["sleep", "never"].includes(key);
    const count = key === "none" ? undecidedCount() : (reminder ? heads : tasks).filter(t => matches(t, key)).length;
    if (reminder && !count) return "";
    return `<button class="btn" data-action="decide-filter" data-value="${key}" aria-pressed="${selected === key}">${label} ${count}</button>`;
  }).join("");
  const eligible = heads.filter(t => !state.tasks.find(p => !p.deleted && p.projectId === t.projectId && p.id === t.parentTaskId)?.dueDate);
  const rechecks = eligible.filter(t => t.dueNudge?.cycle !== "never" && t.dueNudge?.at <= today).sort((a, b) => a.dueNudge.at.localeCompare(b.dueNudge.at)).slice(0, Math.max(0, 2 - recheckedToday()));
  const fresh = eligible.filter(t => !t.dueNudge).sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const nudges = [...rechecks, ...fresh].slice(0, Math.max(0, 5 - done));
  const proposals = nudges.map(t => {
    const proposal = suggestDue(t, today), project = state.projects.find(p => p.id === t.projectId);
    return `<article class="work-nudge" data-nudge-id="${e(t.id)}" data-suggestion="${e(proposal.date)}"><strong>${t.dueNudge ? '<span>再確認</span> ' : ''}${e(t.title)}</strong><div>${e(project.title)} ・ 提案 ${workDateLabel(proposal.date, true)} ${proposal.reason}</div><div class="work-decide-chips"><button class="btn" data-action="decide-adopt" data-id="${e(t.id)}">${workDateLabel(proposal.date)} に</button><button class="btn" data-action="decide-pick" data-id="${e(t.id)}" aria-label="別の日を選ぶ">📅</button><select class="select" style="font-size:16px;min-height:44px" data-work-edit="nudgeCycle" data-work-nudge-cycle="${e(t.id)}" aria-label="期日なしでよい。いつ再確認するか"><option value="">期日なし…</option>${Object.entries(cycles).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}</select></div></article>`;
  }).join("");
  const rows = selected ? (["sleep", "never"].includes(selected) ? heads : tasks).filter(t => matches(t, selected)).map(t => renderWorkTaskRow(t) + (selected === "never" ? `<button class="btn" data-action="decide-resume" data-id="${e(t.id)}">促さないを解除</button>` : "")).join("") : "";
  return `<section class="tower-skin decide-view" data-decide-view>${deps.renderHeader("期日の管理", "決めること")}<h2>今日 ${done}/5 件</h2><div class="work-decide-chips">${chips}</div><h3>期日を決めてほしいもの</h3>${done >= 5 ? '<p>今日の分(5 件)は決め終わりました。続きは明日。</p>' : proposals || '<p>期日を決めるものはありません。</p>'}${selected ? `<div data-decide-results>${rows || '<p>該当するタスクはありません。</p>'}</div>` : ""}</section>`;
}
export { configureDecideView, renderDecideView, undecidedCount, handleDecideEdit, inheritDueNudge, updateDecideTaskField };
