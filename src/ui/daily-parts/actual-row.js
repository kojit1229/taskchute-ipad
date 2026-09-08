import { validateDailyContract } from "./contract.js";

// A read-only projection of one Block. The adapter supplies text and owns all writes.
// As with renderPlanRow, pass the existing escapeHTML helper and connection flags.
export function renderActualRow(display, actual, escapeHTML) {
  const invalid = () => { throw new TypeError("Invalid daily actual row"); };
  if (!validateDailyContract("display", display).valid || display.kind !== "actual"
    || typeof escapeHTML !== "function") invalid();
  // Validate plain data before reading component fields; do not invoke getters.
  if (!validateDailyContract("notification", { action: "daily-actual-edit", kind: "actual",
    id: display.id, draftId: null, requestId: null, baseFingerprint: null, values: actual }).valid) invalid();
  const id = (value) => typeof value === "string" && value.trim().length > 0;
  if (!id(actual.blockId) || display.id !== actual.blockId
    || !(actual.taskId === null || id(actual.taskId))) invalid();
  for (const key of ["actualStartText", "actualEndText", "durationText", "chargeText",
    "dischargeText", "commentText", "missingTimeLabel"])
    if (typeof actual[key] !== "string") invalid();
  for (const key of ["planCompleted", "taskCompleted"])
    if (typeof actual[key] !== "boolean") invalid();
  if (actual.taskId === null && actual.taskCompleted) invalid();
  const e = escapeHTML;
  const start = actual.actualStartText.trim();
  const end = actual.actualEndText.trim();
  const missing = !start || !end || !!actual.missingTimeLabel.trim();
  // Never substitute planned time or a fabricated zero for incomplete measurements.
  const duration = missing || !actual.durationText.trim() ? "時刻未記録" : actual.durationText;
  const identity = (kind, targetId) => `data-kind="${kind}" data-id="${e(targetId)}"`;
  const button = (action, label, kind, targetId, extra = "") => display.actions[action] === true
    ? `<button type="button" data-action="${action}" ${identity(kind, targetId)}${extra}${display.busy ? " disabled" : ""}>${label}</button>` : "";
  const planStatus = actual.planCompleted ? "予定完了" : end ? "終了・未完了" : "予定未完了";
  return `<article class="daily-actual-row" data-daily-key="${e(display.key)}"
    ${identity("actual", actual.blockId)} aria-busy="${display.busy}">
    <div class="daily-actual-heading"><strong class="daily-actual-title">${e(display.title)}</strong><span>実績</span></div>
    <div class="daily-actual-meta">${e(display.dateLabel)} ${e(display.subtitle)}</div>
    <div class="daily-actual-times"><span>開始 ${e(start || "時刻未記録")}</span>
      <span>終了 ${e(end || "時刻未記録")}</span><span data-daily-duration>${e(duration)}</span></div>
    ${actual.missingTimeLabel.trim() ? `<div class="daily-actual-missing">時刻未記録：${e(actual.missingTimeLabel)}</div>` : ""}
    <div class="daily-actual-status"><span data-daily-status="plan">${planStatus}</span>
      ${actual.taskId !== null ? `<span data-daily-status="task">${actual.taskCompleted ? "Task完了" : "Task未完了"}</span>` : ""}
      <span>${e(display.statusLabel)}</span></div>
    <div class="daily-actual-energy"><span>充電 ${e(actual.chargeText || "未記録")}</span>
      <span>放電 ${e(actual.dischargeText || "未記録")}</span></div>
    <div class="daily-actual-comment">${e(actual.commentText)}</div>
    ${display.error ? `<div class="daily-actual-error" role="alert">${e(display.error)}</div>` : ""}
    <div class="daily-actual-actions">
      ${button("daily-actual-edit", "実績を訂正", "block", actual.blockId)}
      ${actual.taskId !== null ? button("daily-task-complete", actual.taskCompleted ? "Task完了を戻す" : "Taskを完了",
        "task", actual.taskId, ` data-desired-completed="${!actual.taskCompleted}"`) : ""}
      ${button("edit-block", "詳細", "block", actual.blockId)}
    </div></article>`;
}
