import { state } from "../state/store.js";
import { registerActions } from "../ui/actions.js";
import { workListRows, filterWorkList } from "../core/work-list.js";

let escapeHTML, todayISO, dueDate, renderBlock, resolveEstimateMin;
let modalOrigin;
let renderFocus;
const views = new Map();
function view(scope) {
  if (!views.has(scope)) views.set(scope, { query: "", status: "", project: "", category: "", due: "", mode: "today", scroll: 0 });
  return views.get(scope);
}
function configureWorkList(deps) {
  ({ escapeHTML, todayISO, dueDate, renderBlock, resolveEstimateMin } = deps);
  registerActions({ "work-list-clear": ({ target }) => {
    const scope = target.closest("[data-work-list]").dataset.workList;
    Object.assign(view(scope), { query: "", status: "", project: "", category: "", due: "", scroll: 0 });
    const root = document.querySelector(`[data-work-list="${scope}"]`);
    root.querySelectorAll("[data-work-filter]").forEach(input => { if (input.dataset.workFilter !== "mode") input.value = ""; });
    patchWorkList(root, true);
  }});
}
function rowsFor(scope) {
  const date = todayISO();
  const rows = workListRows(state, { scope, date, mode: view(scope).mode, dueDate });
  return { date, rows, shown: filterWorkList(rows, view(scope), date) };
}
function option(value, label, selected) { return `<option value="${escapeHTML(value)}"${value === selected ? " selected" : ""}>${escapeHTML(label)}</option>`; }
function select(scope, key, label, entries) {
  return `<label>${label}<select class="select" data-work-filter="${key}" aria-label="${label}">${entries.map(([value, title]) => option(value, title, view(scope)[key])).join("")}</select></label>`;
}
function listRow(row, scope) {
  if (scope === "exec" && row.kind === "block") return `<div data-work-key="${escapeHTML(row.key)}"><div class="work-list-date">${escapeHTML(row.date)}</div>${renderBlock(row.item)}</div>`;
  const status = { completed: "完了", ended: "終了・未完了", running: "実行中", open: "未完了", suspended: "中断" }[row.status];
  const estimate = row.kind === "block" ? resolveEstimateMin(row.item) : row.item.estimateMin;
  const externalDue = (row.task || row.item).dueDate || "";
  return `<div class="work-list-row" data-work-key="${escapeHTML(row.key)}">
    <button type="button" class="btn ghost work-list-title" data-action="edit-${row.kind}" data-id="${escapeHTML(row.id)}">${row.kind === "block" && row.item.isMIT === true ? '<span class="mit-star" aria-label="MIT">★</span> ' : ""}${escapeHTML(row.title || "（名称なし）")}</button>
    <div class="work-list-meta">${escapeHTML([row.kind === "block" ? row.date + " " + (row.time.slice(11, 16) || "時刻未定") : row.kind === "project" ? "Project" : "Task", row.project?.title, row.category, estimate ? `見積${estimate}分` : "", row.due ? `作業期限 ${row.due}` : "期限なし", externalDue && externalDue !== row.due ? `外部期限 ${externalDue}` : "", status].filter(Boolean).join(" ・ "))}</div>
    ${scope === "wbs" && row.project && !row.project.deleted ? `<button class="btn ghost search-hit" data-action="wbs-search-jump" data-kind="${row.kind}" data-id="${escapeHTML(row.id)}"><span class="search-kind">${row.kind === "task" ? "Task" : "Project"}</span> <span class="search-date">${escapeHTML(row.category || "未分類")}</span> <span class="search-snippet">${escapeHTML(row.title)}</span> — ツリーで見る</button>` : ""}
  </div>`;
}
function rowsHTML(model, scope) { return model.shown.length ? model.shown.map(row => listRow(row, scope)).join("") : '<p class="muted work-list-empty">条件に一致する項目はありません。</p>'; }
function renderWorkList(scope) {
  const model = rowsFor(scope), ui = view(scope);
  const projects = state.projects.filter(project => !project.deleted).map(project => [project.id, project.title]);
  const categories = [...new Set(model.rows.map(row => row.category).filter(Boolean))].sort();
  return `<section class="work-list tower-panel-box${scope === "today" ? " sec-arrivals" : ""}" data-work-list="${scope}">
    <h2>${scope === "wbs" ? "Project / Task を探す" : scope === "today" ? "今日の予定・実績" : "予定一覧"}${scope === "wbs" ? "" : ` <span>今日 ${escapeHTML(model.date)}</span>`}</h2>
    <div class="work-list-filters">
      ${scope === "exec" ? select(scope, "mode", "表示期間", [["today", "今日"], ["upcoming", "これから"]]) : ""}
      <label class="work-list-query">検索<input ${scope === "wbs" ? 'id="wbs-search-input"' : ""} class="input" type="search" data-work-filter="query" value="${escapeHTML(ui.query)}" placeholder="名称・メモ・完了条件・Project" aria-label="名称・メモ・完了条件・Projectを検索"></label>
      ${select(scope, "status", "状態", [["", "すべて"], ["open", "未完了"], ["running", "実行中"], ["completed", "完了"], ...(scope !== "wbs" ? [["ended", "終了・未完了"]] : []), ...(scope === "wbs" ? [["suspended", "中断"]] : [])])}
      ${select(scope, "project", "Project", [["", "すべて"], ["__none__", "Projectなし"], ...projects])}
      ${select(scope, "category", "カテゴリ", [["", "すべて"], ...categories.map(name => [name, name])])}
      ${select(scope, "due", "作業期限（自分締切）", [["", "すべて"], ["today", "対象日"], ["overdue", "超過"], ["none", "なし"]])}
      <button type="button" class="btn" data-action="work-list-clear">条件を解除</button>
    </div>
    <p class="work-list-count" aria-live="polite">${model.shown.length} / ${model.rows.length}件 ・ 全件スクロール</p>
    <div ${scope === "wbs" ? 'id="wbs-search-results"' : ""} class="work-list-rows" data-work-list-rows tabindex="0" aria-label="${scope === "wbs" ? "検索結果" : "予定一覧"}">${rowsHTML(model, scope)}</div>
    ${scope === "exec" ? '<p class="muted">未配置のTaskは <button class="btn ghost" data-action="nav" data-view="wbs">WBSで見る</button></p>' : ""}
  </section>`;
}
function patchWorkList(root, reset = false) {
  if (root.dataset.workComposing === "1") return;
  const scope = root.dataset.workList, model = rowsFor(scope), rows = root.querySelector("[data-work-list-rows]");
  // Expanded Block memo/select edits must survive the Today ticker too.
  if (rows.contains(document.activeElement) && !reset) return;
  const html = rowsHTML(model, scope);
  if (rows.innerHTML !== html) {
    const top = reset ? 0 : rows.scrollTop;
    rows.innerHTML = html; rows.scrollTop = top;
  } else if (reset) rows.scrollTop = 0;
  root.querySelector(".work-list-count").textContent = `${model.shown.length} / ${model.rows.length}件 ・ 全件スクロール`;
}
function handleWorkListInput(target) {
  const root = target.closest?.("[data-work-list]");
  if (!root || !target.matches("[data-work-filter]")) return false;
  const ui = view(root.dataset.workList), key = target.dataset.workFilter;
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
  if (!target.matches?.('[data-action="edit-task"],[data-action="edit-project"],[data-action="edit-block"]')) return;
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
    const button = root?.querySelector(`[data-work-key="${CSS.escape(origin.key)}"] button[data-action="${origin.action}"]:not(:disabled)`);
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
    view(root.dataset.workList).scroll = root.querySelector("[data-work-list-rows]").scrollTop;
  });
}
function restoreWorkListScroll() {
  document.querySelectorAll("[data-work-list]").forEach(root => {
    root.querySelector("[data-work-list-rows]").scrollTop = view(root.dataset.workList).scroll;
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
export { configureWorkList, renderWorkList, handleWorkListInput, handleWorkListComposition, rememberWorkListOrigin, restoreWorkListOrigin, updateWorkLists, rememberWorkListScroll, restoreWorkListScroll };
