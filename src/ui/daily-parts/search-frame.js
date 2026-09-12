import { DAILY_ACTIONS } from "./contract.js";

const filterLabels = { status: "状態", project: "Project", category: "カテゴリ", due: "作業期限（自分締切）" };

function validateSearch(model) {
  if (!model || !["today", "exec", "wbs"].includes(model.scope)
    || typeof model.query !== "string" || typeof model.composing !== "boolean"
    || typeof model.emptyMessage !== "string" || typeof model.resultRegionId !== "string"
    || !model.resultRegionId.trim() || !model.filters || !model.options
    || !Number.isSafeInteger(model.shownCount) || !Number.isSafeInteger(model.totalCount)
    || model.shownCount < 0 || model.totalCount < model.shownCount)
    throw new TypeError("Invalid daily search frame");
  for (const key of Object.keys(filterLabels)) {
    if (typeof model.filters[key] !== "string" || !Array.isArray(model.options[key])
      || !model.options[key].every(entry => Array.isArray(entry) && entry.length === 2
        && entry.every(value => typeof value === "string")))
      throw new TypeError("Invalid daily search filter");
  }
  if (model.scope === "exec" && !["today", "upcoming"].includes(model.mode))
    throw new TypeError("Invalid daily search mode");
}
const countText = model => `${model.shownCount} / ${model.totalCount}件 ・ 全件スクロール`;
// resultsHTML is trusted row-renderer output, never a saved HTML field.
function resultHTML(model, resultsHTML, escapeHTML) {
  return model.shownCount ? resultsHTML : `<p class="muted work-list-empty">${escapeHTML(model.emptyMessage)}</p>`;
}
export function renderSearchFrame(model, { escapeHTML, resultsHTML, clearAction = "daily-search-clear", filterKeys = Object.keys(filterLabels), queryLabel = "名称・メモ・完了条件・Projectを検索", queryId = model.scope === "wbs" ? "wbs-search-input" : "" }) {
  validateSearch(model);
  // Keep the existing work-list adapter's alias for the shared clear action.
  if (!DAILY_ACTIONS.includes(clearAction === "work-list-clear" ? "daily-search-clear" : clearAction))
    throw new TypeError("Invalid daily search action");
  const e = escapeHTML;
  const select = (key, label, entries, selected) => `<label>${label}<select class="select" data-work-filter="${key}" data-action="daily-search-change" aria-label="${label}">${entries.map(([value, title]) => `<option value="${e(value)}"${value === selected ? " selected" : ""}>${e(title)}</option>`).join("")}</select></label>`;
  return `<div class="work-list-filters">
    ${model.scope === "exec" ? select("mode", "表示期間", [["today", "今日"], ["upcoming", "これから"]], model.mode) : ""}
    <label class="work-list-query">検索<input id="${e(queryId)}" class="input" type="search" data-work-filter="query" value="${e(model.query)}" placeholder="${e(queryLabel)}" aria-label="${e(queryLabel)}"></label>
    ${filterKeys.map(key => select(key, filterLabels[key], model.options[key], model.filters[key])).join("")}
    <button type="button" class="btn" data-action="${e(clearAction)}">条件を解除</button>
  </div>
  <p class="work-list-count" aria-live="polite">${countText(model)}</p>
  <div id="${e(model.resultRegionId)}" class="work-list-rows" data-work-list-rows tabindex="0" aria-label="${model.scope === "wbs" ? "検索結果" : "予定一覧"}">${resultHTML(model, resultsHTML, e)}</div>`;
}
// No input replacement, listeners, state, storage or network dependencies.
export function patchSearchFrame(root, model, { resultsHTML, escapeHTML, reset = false }) {
  validateSearch(model);
  if (model.composing) return false;
  const rows = root.querySelector("[data-work-list-rows]");
  const count = root.querySelector(".work-list-count");
  if (!rows || !count) throw new TypeError("Missing daily search regions");
  // Expanded Block memo/select edits must survive the Today ticker too.
  if (rows.contains(root.ownerDocument.activeElement) && !reset) return false;
  const html = resultHTML(model, resultsHTML, escapeHTML);
  if (rows.innerHTML !== html) {
    const top = reset ? 0 : rows.scrollTop;
    rows.innerHTML = html;
    rows.scrollTop = top;
  } else if (reset) rows.scrollTop = 0;
  count.textContent = countText(model);
  return true;
}
