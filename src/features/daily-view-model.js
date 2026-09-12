import { validateDailyContract } from "../ui/daily-parts/contract.js";
import { renderPlanRow } from "../ui/daily-parts/plan-row.js";
import { renderActualRow } from "../ui/daily-parts/actual-row.js";
import { isValidSingleSchedule } from "../core/single-schedule.js";
import { plannedMinute, plannedOccupancy } from "../core/planned-occupancy.js";

// Read-only projection. app.js supplies live Task lookup and the existing time/estimate helpers.
// No draft, action registration or persistence belongs to this adapter.
export function buildDailyViewModel(block, deps, actual = false) {
  if (deps.kind === "schedule") return buildScheduleModel(block, deps.date, actual);
  const invalid = () => { const error = new TypeError("Invalid daily Block display");
    error.code = "DAILY_VIEW_MODEL_INVALID"; throw error; };
  if (!block || typeof block !== "object" || Array.isArray(block)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(block))
    || Object.values(Object.getOwnPropertyDescriptors(block)).some(field => !Object.hasOwn(field, "value"))) invalid();
  const task = block.taskId ? deps.getTask(block.taskId) : null;
  const linkedTask = task && !task.deleted ? task : null;
  const text = value => value == null ? "" : typeof value === "string" ? value : invalid();
  const time = value => {
    if (!value) return "";
    if (typeof value !== "string") invalid();
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
    if (!parts) return "";
    const date = new Date(deps.localDateTimeToMs(value));
    if ([date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]
      .some((part, index) => part !== Number(parts[index + 1] || 0))) return "";
    const result = deps.timeFromDateTime(value);
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result) ? result : "";
  };
  const planCompleted = Boolean(block.completed);
  const running = Boolean(block.actualStartAt && !block.actualEndAt);
  const taskCompleted = linkedTask?.status === "done";
  const kind = actual ? "actual" : "block";
  const display = {
    key: `${kind}:${block.id}`, kind, id: block.id, dateLabel: text(block.date), title: text(block.title),
    subtitle: [text(block.category), linkedTask ? text(deps.projectName(linkedTask.projectId)) : ""].filter(Boolean).join(" ・ "),
    statusLabel: "", busy: false, error: "",
    // This is the only common-row action with a production receiver in this unit.
    actions: { "edit-block": deps.canEdit === true }
  };
  if (!validateDailyContract("display", display).valid) invalid();
  const estimate = deps.estimateMinutesForBlock(block, "block");
  if (estimate != null && (!Number.isFinite(estimate) || estimate < 0)) invalid();
  const plannedStartText = time(block.plannedStartAt), plannedEndText = time(block.plannedEndAt);
  const startDate = text(block.plannedStartAt).slice(0, 10), endDate = text(block.plannedEndAt).slice(0, 10);
  const plan = {
    plannedStartText, plannedEndText, endNextDay: Boolean(plannedStartText && plannedEndText && endDate > startDate),
    estimateText: estimate ? `見積${estimate}分` : "", overlapLabel: "",
    planCompleted, taskCompleted, running, canStart: !running && !planCompleted && !block.actualEndAt,
    canEnd: running, canDuplicate: false, highlighted: block.isMIT === true,
    saving: false, undoAvailable: false, draftId: null, draft: null
  };
  if (!actual) {
    const timing = plannedOccupancy({ blocks: [block] }, block.date);
    plan.overlapLabel = timing.invalid.length ? "予定時刻を訂正してください" : timing.intervals[0]?.estimatedEnd
      ? "終了未定・仮の長さ" : plannedStartText && !timing.intervals[0]?.range ? "時間軸外（4〜24時）" : "";
  }
  const actualStartText = time(block.actualStartAt), actualEndText = time(block.actualEndAt);
  const duration = actualStartText && actualEndText
    ? (deps.localDateTimeToMs(block.actualEndAt) - deps.localDateTimeToMs(block.actualStartAt)) / 60000 : NaN;
  const measured = Number.isFinite(duration) && duration >= 0;
  const energy = value => value == null ? "" : typeof value === "number" && Number.isFinite(value) ? String(value) : invalid();
  const actualRow = {
    blockId: block.id, taskId: linkedTask?.id || null, actualStartText, actualEndText,
    durationText: measured ? `${Math.round(duration)}分` : "", planCompleted, taskCompleted,
    chargeText: energy(block.charge), dischargeText: energy(block.discharge), commentText: text(block.comment),
    missingTimeLabel: measured ? "" : "開始・終了の記録を確認してください"
  };
  for (const values of [plan, actualRow]) {
    if (!validateDailyContract("notification", { action: "edit-block", kind: "block", id: block.id,
      draftId: null, requestId: null, baseFingerprint: null, values }).valid) invalid();
  }
  return { display, plan, actual: actualRow };
}

function buildScheduleModel(record, date, actual) {
  if (actual || !isValidSingleSchedule(record) || record.deleted || !Number.isFinite(plannedMinute(record.plannedStartAt, date)))
    throw Object.assign(new TypeError("Invalid single schedule display"), { code: "DAILY_VIEW_MODEL_INVALID" });
  const start = plannedMinute(record.plannedStartAt, date), end = plannedMinute(record.plannedEndAt, date);
  const range = [Math.max(240, start), Math.min(1440, end)];
  return { display: { key: `schedule:${record.id}`, kind: "schedule", id: record.id,
    dateLabel: record.date, title: `${start <= -1440 ? "以前から · " : start < 0 ? "前日から · " : ""}${record.title}`,
    subtitle: "単発予定", statusLabel: record.completed ? "予定完了" : "予定", busy: false, error: "", actions: {} },
    plan: { planCompleted: Boolean(record.completed), canStart: false, canEnd: false,
      plannedStartText: record.plannedStartAt.slice(11,16), plannedEndText: record.plannedEndAt.slice(11,16),
      endNextDay: record.plannedEndAt.slice(0,10) > record.date, start, end,
      range: range[0] < range[1] ? range : null, outsideWindow: end <= 240 || start >= 1440 },
    note: record.note || "" };
}

export function renderDailyBlockDetails(block, deps, actual = false) {
  let model;
  try { model = buildDailyViewModel(block, deps, actual); }
  catch (error) {
    if (error.code !== "DAILY_VIEW_MODEL_INVALID") throw error;
    // Legacy text can contain literal HTML syntax rejected by the common contract.
    // Keep its existing escaped row and edit controls usable; never rewrite saved text.
    return '<p role="status">この内訳は表示できません。編集から元の記録を確認してください。</p>';
  }
  return actual ? renderActualRow(model.display, model.actual, deps.escapeHTML)
    : renderPlanRow(model.display, model.plan, deps.escapeHTML);
}
