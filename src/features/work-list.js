import { state } from "../state/store.js";
import { registerActions } from "../ui/actions.js";
import { existingPlacement } from "../core/placement.js";
import { renderSearchFrame, patchSearchFrame } from "../ui/daily-parts/search-frame.js";
import { buildThreeScreenRows, renderScreenGroups } from "./three-screen-rows.js";
import { renderScheduleSection } from "./single-schedule-view.js";

let escapeHTML, todayISO, dueDate, renderBlock, resolveEstimateMin, leverageTypeMarkHTML, dailyBlockDetails;
let modalOrigin;
let renderFocus;
let screenDeps;
const views = new Map();
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
  if (scope.startsWith("exec") && row.kind === "block") return `<div data-work-key="${escapeHTML(row.key)}"><div class="work-list-date">${escapeHTML(row.date)}</div>${renderBlock(row.item)}</div>`;
  const status = { completed: "完了", ended: "終了・未完了", running: "実行中", open: "未完了", suspended: "中断" }[row.status];
  const estimate = row.kind === "block" ? resolveEstimateMin(row.item) : row.item.estimateMin;
  const externalDue = (row.task || row.item).dueDate || "";
  return `<div class="work-list-row" data-work-key="${escapeHTML(row.key)}">
    <button type="button" class="btn ghost work-list-title" data-action="edit-${row.kind}" data-id="${escapeHTML(row.id)}">${row.kind === "block" && row.item.isMIT === true ? '<span class="mit-star" aria-label="MIT">★</span> ' : ""}${escapeHTML(row.title || "（名称なし）")}</button>
    <div class="work-list-meta">${escapeHTML([row.kind === "block" ? row.date + " " + (row.time.slice(11, 16) || "時刻未定") : row.kind === "project" ? "Project" : "Task", row.project?.title, row.category, estimate ? `見積${estimate}分` : "", row.due ? `作業期限 ${row.due}` : "期限なし", externalDue && externalDue !== row.due ? `外部期限 ${externalDue}` : "", status].filter(Boolean).join(" ・ "))}${row.kind === "task" && leverageTypeMarkHTML ? leverageTypeMarkHTML(row.item.leverageType) : ""}</div>
    ${scope === "today" && row.kind === "block" && dailyBlockDetails ? dailyBlockDetails(row.item, Boolean(row.item.completed || row.item.actualEndAt), false) : ""}
    ${placementActions(row, scope)}
    ${scope === "wbs" && row.project && !row.project.deleted ? `<button class="btn ghost search-hit" data-action="wbs-search-jump" data-kind="${row.kind}" data-id="${escapeHTML(row.id)}"><span class="search-kind">${row.kind === "task" ? "Task" : "Project"}</span> <span class="search-date">${escapeHTML(row.category || "未分類")}</span> <span class="search-snippet">${escapeHTML(row.title)}</span> — ツリーで見る</button>` : ""}
  </div>`;
}
function rowsHTML(model, scope) { return scope.startsWith("wbs-") ? screenDeps.wbsSearchRows(model, scope) : scope === "wbs" ? model.shown.map(row => listRow(row, scope)).join("") : renderScreenGroups(model.shown, row => listRow(row, scope)); }
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
function renderWorkList(scope) {
  const model = rowsFor(scope);
  if (scope.startsWith("wbs-")) return `<section data-work-list="${escapeHTML(scope)}">${renderSearchFrame(searchModel(scope, model), {
    escapeHTML, resultsHTML: rowsHTML(model, scope), clearAction: "work-list-clear",
    filterKeys: scope === "wbs-projects" ? [] : ["status", "category", "due"],
    queryLabel: scope === "wbs-projects" ? "Projectの名前・説明を検索" : "選択ProjectのTaskを検索", queryId: scope + "-query"
  })}</section>`;
  return `<section class="work-list tower-panel-box${scope === "today" ? " sec-arrivals" : scope === "exec-actual" ? " exec-done-section" : ""}" data-work-list="${scope}">
    <h2>${scope === "wbs" ? "Project / Task を探す" : scope === "today" ? "今日の予定・実績" : scope === "exec-candidates" ? "追加候補（今日へ追加）" : scope === "exec-actual" ? "やったこと" : "予定一覧"}${scope === "wbs" ? "" : ` <span>${scope === "today" ? "今日" : "選択日"} ${escapeHTML(model.date)}</span>`}</h2>
    ${scope === "today" ? renderScheduleSection(state, model.date, escapeHTML) : ""}
    ${renderSearchFrame(searchModel(scope, model), { escapeHTML, resultsHTML: rowsHTML(model, scope), clearAction: "work-list-clear", queryId: scope === "wbs" ? "wbs-search-input" : "work-search-" + scope })}
    ${scope === "today" ? '<p><button class="btn" data-action="nav" data-view="exec">予定へ</button><button class="btn" data-action="nav" data-view="journal">記録へ</button></p>' : ""}
    ${scope === "exec" ? '<p class="muted">Taskは <button class="btn ghost" data-action="nav" data-view="wbs">作業一覧で見る</button></p>' : ""}
  </section>`;
}
function patchWorkList(root, reset = false) {
  if (root.dataset.workComposing === "1") return;
  const scope = root.dataset.workList, model = rowsFor(scope);
  // Compare browser-serialized HTML so attribute whitespace never replaces unchanged rows.
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = rowsHTML(model, scope);
  patchSearchFrame(root, searchModel(scope, model), { escapeHTML, resultsHTML: template.innerHTML, reset });
}
function handleWorkListInput(target) {
  const root = target.closest?.("[data-work-list]");
  if (!root || !target.matches("[data-work-filter]")) return false;
  const ui = view(root.dataset.workList), key = target.dataset.workFilter;
  if (!["query", "status", "project", "category", "due", "mode"].includes(key)) return false;
  // Native change fires again on query blur: do not scroll away the clicked row.
  if (ui[key] === target.value) return true;
  ui[key] = target.value;
  patchWorkList(root, true);
  return true;
}
function handleWorkListComposition(target, composing) {
  const root = target.closest?.("[data-work-list]");
  if (!root || !target.matches("[data-work-filter]")) return;
  root.dataset.workComposing = composing ? "1" : "0";
  if (!composing) {
    view(root.dataset.workList)[target.dataset.workFilter] = target.value;
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
function updateWorkLists() { document.querySelectorAll("[data-work-list]").forEach(root => patchWorkList(root)); }
function rememberWorkListScroll() {
  const button = document.activeElement;
  const root = button?.closest?.('[data-work-list]'), row = button?.closest?.('[data-work-key]');
  renderFocus = button?.matches?.('button[data-action]') && root && row
    ? { element: button, scope: root.dataset.workList, key: row.dataset.workKey,
      action: button.dataset.action, id: button.dataset.id, blockId: button.dataset.blockId,
      view: state.currentView, date: state.selectedDate, today: todayISO?.() } : null;
  document.querySelectorAll("[data-work-list]").forEach(root => {
    const ui = view(root.dataset.workList);
    ui.scroll = root.querySelector("[data-work-list-rows]").scrollTop;
    ui.input = root.querySelector('[data-work-filter="query"]');
    ui.inputFocused = ui.input === button;
    ui.composing = root.dataset.workComposing;
  });
}
function restoreWorkListScroll() {
  document.querySelectorAll("[data-work-list]").forEach(root => {
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
export { view as workListConditions, configureWorkList, renderWorkList, handleWorkListInput, handleWorkListComposition, rememberWorkListOrigin, restoreWorkListOrigin, updateWorkLists, rememberWorkListScroll, restoreWorkListScroll };
