import { state } from "../state/store.js";
import { registerActions } from "../ui/actions.js";
import { existingPlacement } from "../core/placement.js";
import { renderSearchFrame, patchSearchFrame } from "../ui/daily-parts/search-frame.js";
import { buildThreeScreenRows, renderScreenGroups } from "./three-screen-rows.js";
import { renderScheduleSection } from "./single-schedule-view.js";
import { isTodayActual, renderTodayTable, renderTodayTableRow } from "../ui/daily-parts/today-table.js";
import { collapseSeries } from "../core/work-series.js";

let escapeHTML, todayISO, dueDate, renderBlock, resolveEstimateMin, leverageTypeMarkHTML, dailyBlockDetails;
let modalOrigin;
let renderFocus;
let screenDeps;
const views = new Map();
const workDisplay = { expanded: new Set(), groups: new Map(), children: new Set() };
function view(scope) {
  if (!views.has(scope)) views.set(scope, { query: "", status: "", project: "", category: "", due: "", mode: "today", scroll: 0 });
  return views.get(scope);
}
function configureWorkList(deps) {
  screenDeps = deps;
  ({ escapeHTML, todayISO, dueDate, renderBlock, resolveEstimateMin, leverageTypeMarkHTML, dailyBlockDetails } = deps);
  const clear = ({ target }) => {
    const scope = target.closest("[data-work-list]").dataset.workList;
    Object.assign(view(scope), { query: "", status: "", project: "", category: "", due: "", scroll: 0 });
    const root = document.querySelector(`[data-work-list="${scope}"]`);
    root.querySelectorAll("[data-work-filter]").forEach(input => { if (input.dataset.workFilter !== "mode") input.value = ""; });
    patchWorkList(root, true);
  };
  registerActions({ "work-list-clear": clear, "daily-search-clear": clear,
    "work-list-toggle": ({ target, event }) => {
      const { kind, value } = target.dataset, root = target.closest('[data-work-list="wbs"]');
      if (kind === "project" && value !== "" && value !== "__none__" && !state.projects.some(p => !p.deleted && p.id === value)) return;
      if (kind === "series") workDisplay.expanded.has(value) ? workDisplay.expanded.delete(value) : workDisplay.expanded.add(value);
      else if (kind === "children") workDisplay.children.has(value) ? workDisplay.children.delete(value) : workDisplay.children.add(value);
      else if (kind === "group") { event.preventDefault(); workDisplay.groups.set(value, !target.closest("details").open); }
      else {
        if (kind === "due" && !view("wbs").due && value) workDisplay.children.clear();
        view("wbs")[kind] = view("wbs")[kind] === value ? "" : value;
      }
      patchWorkList(root, true);
    },
    "today-list-tab": ({ target }) => {
      const root = target.closest('[data-work-list="today"]');
      if (!root || !["plans", "actuals"].includes(target.dataset.tab)) return;
      view("today").todayTab = target.dataset.tab;
      patchWorkList(root, true);
    },
    "daily-search-change": ({ target }) => handleWorkListInput(target) });
}
function rowsFor(scope) {
  if (scope.startsWith("wbs-")) return screenDeps.wbsSearchModel(scope, view(scope));
  return buildThreeScreenRows(state, { scope, today: todayISO(), conditions: view(scope) }, screenDeps);
}
// v374(B-1修正): WBSのTask行(旧app.js renderTaskRow)が持っていた⚙資産/✂削減マーク
// (leverageTypeMarkHTML)は、app.js→src循環依存を避けるため複製していたが、timelineが既に
// 同じ関数をconfigureTimeline()経由で注入している前例(app.js:423)に倣い、こちらもDIへ統一した。
// 未注入(configureWorkList呼び出し漏れ)でも例外にせず空文字を返す(listRow内で分岐)。
function placementActions(row, scope) {
  if (!["wbs", "exec-candidates"].includes(scope) || row.kind !== "task") return "";
  const existing = existingPlacement(state.blocks, row.id, todayISO());
  const active = row.item.status !== "completed";
  if (!existing && !active) return "";
  return `<button class="btn" data-action="placement-add-today" data-id="${escapeHTML(row.id)}">${existing ? "予定を見る" : "今日へ追加"}</button>`
    + (existing && active ? `<button class="btn" data-action="placement-add-another" data-id="${escapeHTML(row.id)}">別の予定を追加</button>` : "");
}
function listRow(row, scope) {
  if (scope === "today") return renderTodayTableRow(row, { escapeHTML,
    running: state.blocks.some(b => b.date === todayISO() && !b.deleted && !b.migratedTo && b.actualStartAt && !b.actualEndAt),
    nowTime: `${todayISO()}T${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}:${String(new Date().getSeconds()).padStart(2, "0")}`,
    estimate: row.kind === "block" ? resolveEstimateMin(row.item) : row.item.estimateMin,
    detailsHTML: row.kind === "block" && dailyBlockDetails ? dailyBlockDetails(row.item, isTodayActual(row), false) : "" });
  if (scope.startsWith("exec") && row.kind === "block") return `<div data-work-key="${escapeHTML(row.key)}"><div class="work-list-date">${escapeHTML(row.date)}</div>${renderBlock(row.item)}</div>`;
  const status = { completed: "完了", ended: "終了・未完了", running: "実行中", open: "未完了", suspended: "中断" }[row.status];
  const estimate = row.kind === "block" ? resolveEstimateMin(row.item) : row.item.estimateMin;
  const externalDue = (row.task || row.item).dueDate || "";
  return `<div class="work-list-row" data-work-key="${escapeHTML(row.key)}">
    <button type="button" class="btn ghost work-list-title" data-action="edit-${row.kind}" data-id="${escapeHTML(row.id)}">${row.kind === "block" && row.item.isMIT === true ? '<span class="mit-star" aria-label="MIT">★</span> ' : ""}${escapeHTML(row.title || "（名称なし）")}</button>
    <div class="work-list-meta">${escapeHTML([row.kind === "block" ? row.date + " " + (row.time.slice(11, 16) || "時刻未定") : row.kind === "project" ? "Project" : "Task", row.project?.title, row.category, estimate ? `見積${estimate}分` : "", row.due ? `作業期限 ${row.due}` : "期限なし", externalDue && externalDue !== row.due ? `外部期限 ${externalDue}` : "", status].filter(Boolean).join(" ・ "))}${row.kind === "task" && leverageTypeMarkHTML ? leverageTypeMarkHTML(row.item.leverageType) : ""}</div>
    ${placementActions(row, scope)}
    ${scope === "wbs" && row.project && !row.project.deleted ? `<button class="btn ghost search-hit" data-action="wbs-search-jump" data-kind="${row.kind}" data-id="${escapeHTML(row.id)}"><span class="search-kind">${row.kind === "task" ? "Task" : "Project"}</span> <span class="search-date">${escapeHTML(row.category || "未分類")}</span> <span class="search-snippet">${escapeHTML(row.title)}</span> — ツリーで見る</button>` : ""}
  </div>`;
}
function rowsHTML(model, scope) { return scope === "today" ? renderTodayTable(model.shown, row => listRow(row, scope), view(scope).todayTab || "plans") : scope.startsWith("wbs-") ? screenDeps.wbsSearchRows(model, scope) : scope === "wbs" ? model.shown.map(row => listRow(row, scope)).join("") : renderScreenGroups(model.shown, row => listRow(row, scope), scope === "exec" && view(scope).mode === "upcoming"); }
function todayTabs(model) {
  return `<div class="daily-table-tabs" role="tablist" aria-label="予定と実績">${["plans", "actuals"].map(tab => `<button type="button" role="tab" data-action="today-list-tab" data-tab="${tab}" aria-selected="${(view("today").todayTab || "plans") === tab}">${tab === "plans" ? "次の予定" : "やったこと"} ${model.shown.filter(row => isTodayActual(row) === (tab === "actuals")).length}</button>`).join("")}</div>`;
}
function searchModel(scope, model, composing = false) {
  const ui = view(scope);
  const projects = state.projects.filter(project => !project.deleted).map(project => [String(project.id ?? ""), String(project.title ?? "")]);
  const categories = [...new Set(model.rows.map(row => String(row.category ?? "")).filter(Boolean))].sort();
  return { scope: scope.startsWith("wbs-") ? "wbs" : scope.startsWith("exec-") ? "today" : scope, query: ui.query, mode: ui.mode, composing,
    filters: { status: ui.status, project: ui.project, category: ui.category, due: ui.due },
    options: {
      status: scope === "exec-candidates" ? [["", "すべて"], ["no-wish", "やりたいことを除外"]] : [["", "すべて"], ["open", "未完了"], ["running", "実行中"], ["completed", "完了"], ...(!scope.startsWith("wbs") ? [["ended", "終了・未完了"]] : []), ...(scope.startsWith("wbs") ? [["suspended", "中断"]] : [])],
      project: [["", "すべて"], ["__none__", "Projectなし"], ...projects],
      category: [["", "すべて"], ...categories.map(name => [name, name])],
      due: [["", "すべて"], ["today", "対象日"], ["overdue", "超過"], ["none", "なし"], ...(scope === "exec-candidates" ? [["week", "期限7日以内"]] : [])]
    }, shownCount: model.shown.length, totalCount: model.rows.length,
    emptyMessage: "条件に一致する項目はありません。",
    resultRegionId: scope === "wbs" ? "wbs-search-results" : scope + "-search-results" };
}
function workDateLabel(date, weekday = false) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || "");
  if (!parts) return "";
  return `${Number(parts[2])}/${Number(parts[3])}${weekday ? `（${"日月火水木金土"[new Date(+parts[1], +parts[2] - 1, +parts[3]).getDay()]}曜）` : ""}`;
}
function workDueMatches(task, filter, today) {
  const due = dueDate(task);
  return !filter || (filter === "none" ? !due : filter === "overdue" ? due && due < today : filter === "today" ? due === today : due >= today && due <= screenDeps.addDays(today, 7));
}
function renderWorkTaskRow(t, { titleHTML = "", ghost = false, depth = 0 } = {}) {
  const e = escapeHTML, due = dueDate(t), today = todayISO();
  const status = { doing: "着手中", completed: "完了", suspended: "中断" }[t.status] || "";
  return `<div class="work-list-row work-task-row${ghost ? " work-context-parent" : ""}" data-work-key="task:${e(t.id)}" data-wbs-row-id="${e(t.id)}"><div class="work-task-name">
    <button class="checkbox-button ${t.status === "completed" ? "done" : ""}" data-action="toggle-task" data-id="${e(t.id)}" aria-label="${t.status === "completed" ? "完了を解除" : "完了"}">✓</button>
    ${titleHTML || `<button class="btn ghost work-list-title" data-action="edit-task" data-id="${e(t.id)}">${e(t.title || "（名称なし）")}</button>`}
  </div><div class="work-list-meta">
    ${e([status, ghost ? "(条件外の親)" : "", `進捗 ${Number(t.progressNum) || 0}/${Number(t.progressDen) || 0}`, due && due < today && ["todo", "doing"].includes(t.status) ? `超過 ${screenDeps.daysBetween(due, today)}日` : "", due ? `作業 ${workDateLabel(due)}` : ""].filter(Boolean).join(" ・ "))}
    ${depth < 2 ? `<button class="btn ghost" data-action="add-subtask" data-parent-task="${e(t.id)}">＋ サブ</button>` : ""}
    ${placementActions({ kind: "task", id: t.id, item: t }, "wbs")}
  </div><div class="work-task-due">
    <label>期日<input class="input" type="date" data-work-edit="dueDate" data-id="${e(t.id)}" value="${e(t.dueDate || "")}" aria-label="期日"></label>
    <label>見積 ${Number(t.estimateMin) || 0}分<input class="input" type="number" min="0" step="1" data-work-edit="estimateMin" data-id="${e(t.id)}" value="${Number(t.estimateMin) || 0}" aria-label="見積（分）"></label>
  </div></div>`;
}
function renderWbsList() {
  const ui = view("wbs"), today = todayISO(), e = escapeHTML, settings = state.settings;
  const projects = state.projects.filter(p => !p.deleted), byId = new Map(projects.map(p => [p.id, p]));
  const live = state.tasks.filter(t => !t.deleted && t.kind !== "other" && (!t.projectId || byId.has(t.projectId)));
  const unfinished = live.filter(t => ["todo", "doing"].includes(t.status));
  const visible = live.filter(t => (!settings.wbsHideCompleted || t.status !== "completed") && (settings.showSuspended || (t.status !== "suspended" && byId.get(t.projectId)?.status !== "paused")) && (!settings.wbsHideDoneProjects || byId.get(t.projectId)?.status !== "completed"));
  const q = ui.query.normalize("NFKC").trim().toLocaleLowerCase(), words = q.split(/\s+/).filter(Boolean);
  const hits = visible.filter(t => (!ui.project || (t.projectId || "__none__") === ui.project) && words.every(word => String(t.title || "").normalize("NFKC").toLocaleLowerCase().includes(word)) && (!ui.due || unfinished.includes(t) && workDueMatches(t, ui.due, today)));
  const hitIds = new Set(hits.map(t => t.id)), keep = new Map(hits.map(t => [t.id, t]));
  for (const task of hits) {
    let parent = live.find(t => t.id === task.parentTaskId && t.projectId === task.projectId);
    const seen = new Set([task.id]);
    while (parent && !seen.has(parent.id)) { seen.add(parent.id); keep.set(parent.id, parent); parent = live.find(t => t.id === parent.parentTaskId && t.projectId === task.projectId); }
  }
  const groupTasks = tasks => {
    const open = tasks.filter(t => !["completed", "suspended"].includes(t.status));
    return [...collapseSeries(open, { noCollapse: !!q }), ...tasks.filter(t => !open.includes(t)).map(task => ({ task, hidden: 0, rest: [] }))].sort((a,b) => Math.min(...[a.task,...a.rest].map(t=>tasks.indexOf(t))) - Math.min(...[b.task,...b.rest].map(t=>tasks.indexOf(t))));
  };
  const chip = (kind, value, title, count) => `<button class="btn" data-action="${kind === "project" ? "wbs-select-project" : "work-list-toggle"}" ${kind === "project" ? `data-id="${e(value)}"` : ""} data-kind="${kind}" data-value="${e(value)}" aria-pressed="${ui[kind] === value}">${e(title)} ${count}</button>`;
  const counts = [["overdue", "超過"], ["week", "7日以内"], ["none", "期日なし"]].map(([key, label]) => chip("due", key, label, key === "none" ? collapseSeries(unfinished.filter(t => !dueDate(t))).length : unfinished.filter(t => workDueMatches(t, key, today)).length)).join("");
  const row = ({ task: t, hidden, rest }, depth = 0, seen = new Set()) => {
    if (seen.has(t.id)) return "";
    const trail = new Set([...seen, t.id]), due = dueDate(t), ghost = !hitIds.has(t.id), expanded = workDisplay.expanded.has(t.id);
    const children = [...keep.values()].filter(k => k.parentTaskId === t.id && k.projectId === t.projectId);
    const childrenOpen = !workDisplay.children.has(t.id);
    const titleHTML = `${children.length ? `<button class="btn" data-action="work-list-toggle" data-kind="children" data-value="${e(t.id)}" aria-expanded="${childrenOpen}" aria-label="子タスクを開閉">${childrenOpen ? "▾" : "▸"}</button>` : ""}<button class="btn ghost work-list-title" data-action="edit-task" data-id="${e(t.id)}">${depth ? "└ " : ""}${e(t.title || "（名称なし）")}</button>${hidden ? `<button class="btn" data-action="work-list-toggle" data-kind="series" data-value="${e(t.id)}" aria-expanded="${expanded}">+${hidden}件</button>` : ""}`;
    return renderWorkTaskRow(t, { titleHTML, ghost, depth }) + (childrenOpen ? groupTasks(children).map(g => row(g, depth + 1, trail)).join("") : "") + (expanded ? rest.map(task => row({ task, hidden: 0, rest: [] }, depth, trail)).join("") : "");
  };
  const groups = [...projects, ...(live.some(t => !t.projectId) ? [{ id: "", title: "Projectなし" }] : [])].filter(p => !settings.wbsCategoryFilter || (p.category || "未分類") === settings.wbsCategoryFilter);
  const groupsHTML = groups.map(p => {
    const tasks = [...keep.values()].filter(t => (t.projectId || "") === p.id), matched = hits.filter(t => (t.projectId || "") === p.id);
    if (!tasks.length && ui.project !== (p.id || "__none__")) return "";
    const all = live.filter(t => (t.projectId || "") === p.id), progress = screenDeps.projectProgressAgg(all);
    const week = p.twelveWeekStartDate ? Math.floor(screenDeps.daysBetween(p.twelveWeekStartDate, today) / 7) + 1 : 0;
    const overdue = unfinished.filter(t => (t.projectId || "") === p.id && workDueMatches(t, "overdue", today)).length;
    const roots = tasks.filter(t => !tasks.some(parent => parent.id === t.parentTaskId));
    const open = workDisplay.groups.get(p.id) ?? (!!ui.project || !!q || !!ui.due || groupTasks(roots).length <= 6);
    return `<details class="work-project-group wbs-project-detail" data-work-group="${e(p.id)}" data-work-scope="wbs-tasks-${e(p.id)}" ${open ? "open" : ""}><summary data-action="work-list-toggle" data-kind="group" data-value="${e(p.id)}">${e(p.title)} <span>${e(p.category || "")} ${groupTasks(matched).length}/${matched.length}件 ・ 進捗 ${progress.num}/${progress.den} (${progress.pct}%)${week > 0 ? ` ・ 12週計画 第${week}週` : ""} ・ 期限超過 ${overdue}</span>${p.id ? `<button class="btn ghost" data-action="edit-project" data-id="${e(p.id)}">編集</button>` : ""}</summary>${groupTasks(roots).map(g => row(g)).join("") || '<p>該当するタスクはありません。</p>'}</details>`;
  }).join("");
  return `<section class="work-list work-decide-layout" data-work-list="wbs"><aside class="work-decide-sidebar"><div data-work-decide-link><button class="btn ghost" data-action="nav" data-view="decide">期日が決まっていないもの ${screenDeps.undecidedCount()} 件 → 決めること</button></div><div data-work-mode>一覧</div><div class="work-decide-chips" data-work-counts>${counts}</div>${screenDeps.renderWbsAddMenu()}<label class="work-decide-query">題名を検索<input class="input" type="search" id="wbs-projects-query" data-work-filter="query" value="${e(ui.query)}"></label><div class="work-decide-chips" data-work-projects data-work-list="wbs-projects" data-work-scope="wbs-projects">${chip("project", "", "すべて", groupTasks(visible).length)}${groups.map(p => chip("project", p.id || "__none__", p.title, groupTasks(visible.filter(t => (t.projectId || "") === p.id)).length)).join("")}</div><details><summary>その他</summary><button class="btn" data-action="toggle-wbs-hide-done">完了を隠す ${settings.wbsHideCompleted ? "ON" : "OFF"}</button><button class="btn" data-action="toggle-show-suspended">中断を表示 ${settings.showSuspended ? "ON" : "OFF"}</button></details></aside><div class="work-decide-groups" data-work-list-rows>${groupsHTML || '<p>該当するタスクはありません。</p>'}</div></section>`;
}
function renderWorkList(scope) {
  if (scope === "wbs") return renderWbsList();
  const model = rowsFor(scope);
  if (scope === "today") {
    const minutes = model.rows.reduce((sum, row) => sum + (Number(row.kind === "block" ? resolveEstimateMin(row.item) : row.item.estimateMin) || 0), 0);
    const search = renderSearchFrame(searchModel(scope, model), { escapeHTML, resultsHTML: rowsHTML(model, scope), compact: true, clearAction: "work-list-clear", queryId: "work-search-today" });
    const split = search.indexOf('<p class="work-list-count"');
    return `<section class="work-list tower-panel-box sec-arrivals" data-work-list="today">
      <h2>今日の予定・実績 <span>${model.rows.length}件 · 見積 ${minutes >= 60 ? `${Math.floor(minutes / 60)}時間` : ""}${minutes % 60}分</span></h2>
      ${todayTabs(model)}${renderScheduleSection(state, model.date, escapeHTML)}${search.slice(split)}
      <div class="daily-table-tools"><button class="btn" data-action="today-add-interruption">＋ 割り込み</button><button class="btn" data-action="today-add-actual">＋ 実績だけ</button>
        <details class="daily-table-search"><summary>検索・絞り込み ▸</summary>${search.slice(0, split)}</details><button class="btn" data-action="nav" data-view="exec">時間軸で見る ›</button></div>
    </section>`;
  }
  if (scope.startsWith("wbs-")) return `<section data-work-list="${escapeHTML(scope)}">${renderSearchFrame(searchModel(scope, model), {
    escapeHTML, resultsHTML: rowsHTML(model, scope), clearAction: "work-list-clear",
    filterKeys: scope === "wbs-projects" ? [] : ["status", "category", "due"],
    queryLabel: scope === "wbs-projects" ? "Projectの名前・説明を検索" : "選択ProjectのTaskを検索", queryId: scope + "-query"
  })}</section>`;
  return `<section class="work-list tower-panel-box${scope === "exec-actual" ? " exec-done-section" : ""}" data-work-list="${scope}">
    <h2>${scope === "wbs" ? "Project / Task を探す" : scope === "exec-candidates" ? "追加候補（今日へ追加）" : scope === "exec-actual" ? "やったこと" : "予定一覧"}${scope === "wbs" ? "" : ` <span>選択日 ${escapeHTML(model.date)}</span>`}</h2>
    ${renderSearchFrame(searchModel(scope, model), { escapeHTML, resultsHTML: rowsHTML(model, scope), clearAction: "work-list-clear", queryId: scope === "wbs" ? "wbs-search-input" : "work-search-" + scope })}
    ${scope === "exec" ? '<p class="muted">Taskは <button class="btn ghost" data-action="nav" data-view="wbs">作業一覧で見る</button></p>' : ""}
  </section>`;
}
function patchWorkList(root, reset = false, editedId = "") {
  if (root.dataset.workComposing === "1") return;
  if (root.dataset.workList === "wbs") {
    const template = root.ownerDocument.createElement("template"); template.innerHTML = renderWbsList();
    for (const selector of ["[data-work-decide-link]", "[data-work-counts]", "[data-work-projects]", "[data-work-list-rows]"]) {
      const current = root.querySelector(selector), next = template.content.querySelector(selector);
      if (selector === "[data-work-list-rows]" && editedId) {
        const rows = [...current.querySelectorAll("[data-work-key]")], nextRows = [...next.querySelectorAll("[data-work-key]")];
        if (rows.length === nextRows.length && rows.every((row, i) => row.dataset.workKey === nextRows[i].dataset.workKey)) {
          rows.forEach((row, i) => { if (row.innerHTML !== nextRows[i].innerHTML) row.innerHTML = nextRows[i].innerHTML; });
          const summaries = current.querySelectorAll(".work-project-group > summary");
          next.querySelectorAll(".work-project-group > summary").forEach((summary, i) => { if (summaries[i].innerHTML !== summary.innerHTML) summaries[i].innerHTML = summary.innerHTML; });
          continue;
        }
      }
      if (current.innerHTML !== next.innerHTML) current.innerHTML = next.innerHTML;
    }
    if (reset) root.querySelector("[data-work-list-rows]").scrollTop = 0;
    return;
  }
  const scope = root.dataset.workList, model = rowsFor(scope);
  // Compare browser-serialized HTML so attribute whitespace never replaces unchanged rows.
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = rowsHTML(model, scope);
  if (scope === "today") {
    const open = new Set([...root.querySelectorAll('details[data-work-key][open]')].map(el => el.dataset.workKey));
    template.content.querySelectorAll('details[data-work-key]').forEach(el => { el.open = open.has(el.dataset.workKey); });
    const tabs = root.querySelector('.daily-table-tabs');
    // Keep the focused tab itself in place while counts and selection change.
    const next = root.ownerDocument.createElement('template'); next.innerHTML = todayTabs(model);
    tabs.querySelectorAll('button').forEach((button, index) => {
      const replacement = next.content.querySelectorAll('button')[index];
      button.textContent = replacement.textContent; button.setAttribute('aria-selected', replacement.getAttribute('aria-selected'));
    });
  }
  patchSearchFrame(root, searchModel(scope, model), { escapeHTML, resultsHTML: template.innerHTML, reset });
}
function handleWorkListEdit(target) {
  if (!target.matches?.("[data-work-edit]")) return false;
  const { id, workEdit: field } = target.dataset, task = state.tasks.find(t => t.id === id && !t.deleted);
  if (!task || !["dueDate", "estimateMin"].includes(field)) return true;
  const value = field === "estimateMin" ? Number(target.value) : target.value;
  if (!target.validity.valid || (field === "estimateMin" && (!Number.isInteger(value) || value < 0))) {
    target.value = task[field] ?? (field === "estimateMin" ? 0 : "");
    return true;
  }
  const root = target.closest('[data-work-list="wbs"]');
  if (!screenDeps.updateTaskField(id, field, value)) target.value = task[field] ?? (field === "estimateMin" ? 0 : "");
  if (root) patchWorkList(root, false, id);
  else {
    const row = target.closest("[data-work-key]");
    if (row) row.outerHTML = renderWorkTaskRow(state.tasks.find(t => t.id === id));
  }
  return true;
}
function handleWorkListInput(target) {
  const root = target.closest?.("[data-work-list]");
  if (!root || !target.matches("[data-work-filter]")) return false;
  const ui = view(root.dataset.workList), key = target.dataset.workFilter;
  if (!["query", "status", "project", "category", "due", "mode"].includes(key)) return false;
  // Native change fires again on query blur: do not scroll away the clicked row.
  if (ui[key] === target.value) return true;
  if (root.dataset.workList === "wbs" && key === "query" && !ui.query && target.value) workDisplay.children.clear();
  ui[key] = target.value;
  patchWorkList(root, true);
  return true;
}
function handleWorkListComposition(target, composing) {
  const root = target.closest?.("[data-work-list]");
  if (!root || !target.matches("[data-work-filter]")) return;
  root.dataset.workComposing = composing ? "1" : "0";
  if (!composing) {
    const ui = view(root.dataset.workList);
    if (root.dataset.workList === "wbs" && target.dataset.workFilter === "query" && !ui.query && target.value) workDisplay.children.clear();
    ui[target.dataset.workFilter] = target.value;
    patchWorkList(root, true);
  }
}
function rememberWorkListOrigin(target) {
  if (!target.matches?.('[data-action="edit-task"],[data-action="edit-project"],[data-action="edit-block"],[data-action="task-today"],[data-action="placement-add-today"]')) return;
  const root = target.closest("[data-work-list]"), row = target.closest("[data-work-key]");
  if (root && row) modalOrigin = { scope: root.dataset.workList, key: row.dataset.workKey, action: target.dataset.action, view: state.currentView };
}
function restoreWorkListOrigin() {
  const origin = modalOrigin; modalOrigin = null;
  if (!origin) return;
  // Save may synchronously render after closeModal; restore to the final DOM.
  queueMicrotask(() => {
    // A save post-effect or navigation may already own focus in a new surface.
    if (state.modal || state.currentView !== origin.view || document.querySelector('#modalRoot.open, dialog[open]')) return;
    const root = document.querySelector(`[data-work-list="${origin.scope}"]`);
    const row = `[data-work-key="${CSS.escape(origin.key)}"]`;
    const button = root?.querySelector(`${row} button[data-action="${origin.action}"]:not(:disabled)`)
      || root?.querySelector(`${row} button[data-action="task-today"]:not(:disabled), ${row} button[data-action="placement-add-today"]:not(:disabled)`)
      || root?.querySelector(`${row} button:not(:disabled)`);
    (button || root?.querySelector('[data-work-filter="query"]'))?.focus({ preventScroll: true });
  });
}
function updateWorkLists() { document.querySelectorAll("[data-work-list]:not([data-work-projects])").forEach(root => patchWorkList(root)); }
function rememberWorkListScroll() {
  const button = document.activeElement;
  const root = button?.closest?.('[data-work-list]'), row = button?.closest?.('[data-work-key]');
  renderFocus = button?.matches?.('button[data-action]') && root && row
    ? { element: button, scope: root.dataset.workList, key: row.dataset.workKey,
      action: button.dataset.action, id: button.dataset.id, blockId: button.dataset.blockId,
      view: state.currentView, date: state.selectedDate, today: todayISO?.() } : null;
  document.querySelectorAll("[data-work-list]:not([data-work-projects])").forEach(root => {
    const ui = view(root.dataset.workList);
    ui.scroll = root.querySelector("[data-work-list-rows]").scrollTop;
    ui.input = root.querySelector('[data-work-filter="query"]');
    ui.inputFocused = ui.input === button;
    ui.composing = root.dataset.workComposing;
  });
}
function restoreWorkListScroll() {
  document.querySelectorAll("[data-work-list]:not([data-work-projects])").forEach(root => {
    const ui = view(root.dataset.workList), input = root.querySelector('[data-work-filter="query"]');
    root.querySelector("[data-work-list-rows]").scrollTop = ui.scroll;
    if (ui.input && input !== ui.input) {
      input.replaceWith(ui.input);
      root.dataset.workComposing = ui.composing || "0";
      if (ui.inputFocused && !state.modal) ui.input.focus({ preventScroll: true });
    }
    ui.input = null;
  });
  const saved = renderFocus; renderFocus = null;
  if (!saved || state.modal || state.currentView !== saved.view || state.selectedDate !== saved.date
    || todayISO?.() !== saved.today || document.querySelector('#modalRoot.open, dialog[open]')) return;
  const active = document.activeElement;
  // A new surface may have deliberately taken focus while the old list was replaced.
  if (active && active !== document.body && active !== saved.element && active.isConnected) return;
  const root = document.querySelector(`[data-work-list="${CSS.escape(saved.scope)}"]`);
  const identity = saved.id != null ? `[data-id="${CSS.escape(saved.id)}"]`
    : saved.blockId != null ? `[data-block-id="${CSS.escape(saved.blockId)}"]` : '';
  root?.querySelector(`[data-work-key="${CSS.escape(saved.key)}"] button[data-action="${CSS.escape(saved.action)}"]${identity}:not(:disabled)`)?.focus({ preventScroll: true });
}
export { renderWorkTaskRow, workDateLabel, workDueMatches, view as workListConditions, configureWorkList, renderWorkList, handleWorkListEdit, handleWorkListInput, handleWorkListComposition, rememberWorkListOrigin, restoreWorkListOrigin, updateWorkLists, rememberWorkListScroll, restoreWorkListScroll };
