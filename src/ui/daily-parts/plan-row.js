import { validateDailyContract } from "./contract.js";

// Pure display: the adapter owns connection flags, readonly Block policy and draft identity.
// Pass the existing escapeHTML helper; no state, clock, registration or persistence here.
export function renderPlanRow(display, plan, escapeHTML) {
  const invalid = () => { throw new TypeError("Invalid daily plan row"); };
  if (!validateDailyContract("display", display).valid || !["block", "schedule"].includes(display.kind)
    || typeof escapeHTML !== "function") invalid();
  // Reuse the common safe-data check before reading component values (including getters).
  if (!validateDailyContract("notification", { action: "daily-plan-times-save", kind: display.kind,
    id: display.id, draftId: null, requestId: null, baseFingerprint: null, values: plan }).valid) invalid();
  for (const key of ["plannedStartText", "plannedEndText", "estimateText", "overlapLabel"])
    if (typeof plan[key] !== "string") invalid();
  for (const key of ["endNextDay", "planCompleted", "taskCompleted", "running", "canDuplicate",
    "canStart", "canEnd", "highlighted", "saving", "undoAvailable"])
    if (typeof plan[key] !== "boolean") invalid();
  if (plan.draftId !== null && (typeof plan.draftId !== "string" || !plan.draftId.trim())) invalid();
  const draft = plan.draft;
  const time = (value) => typeof value === "string" && /^(?:|(?:[01]\d|2[0-3]):[0-5]\d)$/.test(value);
  if (draft !== null && (!draft || Array.isArray(draft) || !plan.draftId
    || !time(draft.start) || !time(draft.end) || typeof draft.endNextDay !== "boolean"
    || typeof draft.dirty !== "boolean" || !Array.isArray(draft.errors)
    || !draft.errors.every((error) => typeof error === "string"))) invalid();
  const e = escapeHTML;
  const busy = display.busy || plan.saving;
  const disabled = busy ? " disabled" : "";
  const identity = `data-kind="${e(display.kind)}" data-id="${e(display.id)}"`
    + (plan.draftId ? ` data-draft-id="${e(plan.draftId)}"` : "");
  const connected = (action) => display.actions[action] === true;
  const button = (action, label, allowed = true, extra = "") => connected(action) && allowed
    ? `<button type="button" data-action="${action}" ${identity}${extra}${disabled}>${label}</button>` : "";
  const block = display.kind === "block";
  const editable = draft !== null && connected("daily-plan-times-save");
  const input = (field, label) => `<label>${label}<input type="time" step="300"
    data-daily-field="${field}" ${identity} value="${e(draft[field])}"${disabled}></label>`;
  const errors = [display.error, ...(draft ? draft.errors : [])].filter(Boolean);
  return `<article class="daily-plan-row${plan.planCompleted ? " is-plan-completed" : ""}${plan.highlighted ? " is-highlighted" : ""}"
    data-daily-key="${e(display.key)}" ${identity} aria-busy="${busy}">
    <div class="daily-plan-heading"><strong class="daily-plan-title">${e(display.title)}</strong>
      <span>${block ? "Block" : "単発予定"}</span></div>
    <div class="daily-plan-meta">${e(display.dateLabel)} ${e(display.subtitle)}</div>
    <div class="daily-plan-times"><span>開始 ${e(plan.plannedStartText || "未定")}</span>
      <span>終了 ${plan.endNextDay ? "翌日 " : ""}${e(plan.plannedEndText || "未定")}</span>
      <span>${e(plan.estimateText)}</span><span>${e(plan.overlapLabel)}</span></div>
    <div class="daily-plan-status"><span data-daily-status="plan">${plan.planCompleted ? "予定完了" : "予定未完了"}</span>
      ${block ? `<span data-daily-status="running">${plan.running ? "実行中" : "停止中"}</span>
      <span data-daily-status="task">${plan.taskCompleted ? "Task完了" : "Task未完了"}</span>` : ""}
      <span>${e(display.statusLabel)}</span></div>
    ${editable ? `<div class="daily-plan-draft">${input("start", "開始")}${input("end", "終了")}
      <label class="daily-plan-next-day"><input type="checkbox" data-daily-field="endNextDay" ${identity}
        ${draft.endNextDay ? "checked" : ""}${disabled}>翌日</label></div>` : ""}
    ${errors.length ? `<div class="daily-plan-error" role="alert">${errors.map((error) => e(error)).join("<br>")}</div>` : ""}
    <div class="daily-plan-actions">
      ${button("daily-plan-times-save", "時刻を確定", editable && draft.dirty)}
      ${button("daily-plan-times-cancel", "時刻を戻す", draft !== null && draft.dirty)}
      ${button("daily-plan-complete", plan.planCompleted ? "予定完了を戻す" : "予定を完了", true,
        ` data-desired-completed="${!plan.planCompleted}"`)}
      ${button("daily-block-start", "開始", block && plan.canStart)}
      ${button("daily-block-end", "終了", block && plan.canEnd)}
      ${button("daily-block-duplicate", "複製", block && plan.canDuplicate)}
      ${button("daily-duplicate-undo", "複製を取り消す", block && plan.undoAvailable)}
      ${button(block ? "edit-block" : "daily-schedule-edit", "詳細")}
    </div></article>`;
}
