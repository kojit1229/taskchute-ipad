// Today-only table projection; existing common rows retain their detail/action contract.
export const isTodayActual = row => row.kind === "block" && Boolean(row.item.completed || row.item.actualEndAt);

export function renderTodayTableRow(row, { escapeHTML: e, estimate, detailsHTML, running, nowTime }) {
  const actual = isTodayActual(row);
  const rowState = row.item.completed ? "done" : row.status === "running" ? "running" : !actual && !row.item.actualStartAt && row.time && row.time < nowTime ? "late" : "open";
  const time = (actual ? row.item.actualStartAt : row.time) || "";
  const clock = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(time)?.[1] || (actual ? "未記録" : "未定");
  return `<details class="work-list-row daily-table-entry" data-work-key="${e(row.key)}" data-row-state="${rowState}">
    <summary class="daily-table-row" role="row" aria-label="${e(row.title)}の内訳">
      <span role="cell">${e(clock)}</span>
      <span role="cell"><button type="button" class="work-list-title" data-action="edit-${row.kind}" data-id="${e(row.id)}">${row.item.isMIT === true ? '<span class="mit-star" aria-label="MIT">★</span>' : ""}${e(row.title || "（名称なし）")}</button>${row.project?.title ? `<span class="daily-table-tag">${e(row.project.title)}</span>` : ""}${rowState === "late" ? '<span class="daily-table-late">遅れ</span>' : ""}</span>
      <span role="cell">${e(estimate == null ? "—" : `${estimate}分`)}</span>
      ${row.kind === "block" && !actual && !row.item.actualStartAt && row.item.plannedStartAt && !running ? `<button type="button" class="daily-table-pick" data-action="today-pick-next" data-id="${e(row.id)}">▶ これを次に</button>` : ""}
    </summary>
    <div class="daily-table-detail">${detailsHTML}<p>${e([row.date, row.due ? `作業期限 ${row.due}` : "", (row.task || row.item).dueDate ? `外部期限 ${(row.task || row.item).dueDate}` : ""].filter(Boolean).join(" ・ "))}</p></div>
  </details>`;
}

export function renderTodayTable(rows, renderRow, active) {
  const group = (name, actual) => {
    const items = rows.filter(row => isTodayActual(row) === actual);
    return `<div role="rowgroup" data-today-table-group="${name}"${active !== name ? " hidden" : ""}>${items.map(renderRow).join("") || '<p class="muted">該当する予定・実績はありません。</p>'}</div>`;
  };
  return `<div class="daily-table" role="table" aria-label="今日の予定・実績の表"><div class="daily-table-row daily-table-head" role="row">
    ${["時刻", "タスク", "見積"].map(label => `<span role="columnheader">${label}</span>`).join("")}
  </div>${group("plans", false)}${group("actuals", true)}</div>`;
}
