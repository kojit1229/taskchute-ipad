// Common envelopes only; component-specific fields and business rules belong to their adapters.
export const DAILY_KINDS = Object.freeze(["block", "schedule", "actual", "task", "project"]);
export const DAILY_ACTIONS = Object.freeze([
  "daily-reading-open",
  // 124/R3-03: draft/question, explicit completion, and stopped-draft leave have distinct owners.
  "zero-draft-save", "zero-complete", "zero-leave",
  "daily-plan-times-save", "daily-plan-times-cancel", "daily-plan-complete",
  "daily-block-start", "daily-block-end", "daily-block-duplicate", "daily-duplicate-undo",
  "edit-block", "daily-schedule-edit", "daily-actual-edit", "daily-task-complete",
  // 38: registry-only schedule writes; D01 keeps their controls unpublished.
  "daily-schedule-add", "daily-schedule-complete", "daily-schedule-delete",
  // B8/41: separate same-Block placement and Task-to-new-Block requests.
  "daily-gap-place", "daily-gap-create",
  "daily-search-change", "daily-search-clear", "modal-save", "modal-close", "modal-delete",
  "edit-task", "edit-project",
  "daily-report-refresh" // 33 の日報再生成の登録行(監督者決定 2026-09-11、fixB6)
]);
export const DAILY_RESULT_STATUSES = Object.freeze([
  "saved", "unchanged", "invalid", "storage-failed", "conflict", "cancelled"
]);
// null = unconfigured. A failed sync does not undo a successful device save.
export const DAILY_SYNC_STATUSES = Object.freeze([null, "pending", "syncing", "synced", "failed"]);
const fields = Object.freeze({
  display: ["key", "kind", "id", "dateLabel", "title", "subtitle", "statusLabel", "busy", "error", "actions"],
  notification: ["action", "kind", "id", "draftId", "requestId", "baseFingerprint", "values"],
  result: ["status", "entityId", "errors", "syncStatus", "undoToken"]
});
const text = (value) => typeof value === "string" && !/<\s*[a-z!/?]/i.test(value);
const id = (value) => text(value) && value.trim().length > 0;
const nullableId = (value) => value === null || id(value);
const record = (value) => value !== null && typeof value === "object"
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const forbiddenKeys = ["__proto__", "prototype", "constructor", "html", "innerhtml", "outerhtml", "srcdoc"];

// Inspect descriptors before reading values: an accessor must not run during validation.
// Only plain JSON data is accepted; the depth bound also rejects cycles.
function safeData(value, depth = 0) {
  if (depth > 32) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return text(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (!record(value) && !Array.isArray(value)) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string" || forbiddenKeys.includes(key.toLowerCase())) return false;
    const field = Object.getOwnPropertyDescriptor(value, key);
    return Object.hasOwn(field, "value") && safeData(field.value, depth + 1);
  });
}
const errorsValid = (value) => (Array.isArray(value) || record(value))
  && Object.values(value).every(text);

/** validateDailyContract("display" | "notification" | "result", plainData)
 * Returns {valid, errors: string[]}; never renders, executes an action or persists data.
 * All envelope fields are required; absent identifiers use null, absent text uses "".
 */
export function validateDailyContract(type, value) {
  const errors = [];
  const check = (valid, field) => { if (!valid) errors.push(field); };
  if (typeof type !== "string" || !Object.hasOwn(fields, type)) return { valid: false, errors: ["type"] };
  if (!record(value) || !safeData(value)) return { valid: false, errors: ["data"] };
  const allowed = fields[type];
  for (const key of Reflect.ownKeys(value)) check(allowed.includes(key), `unknown:${key}`);
  for (const key of allowed) check(Object.hasOwn(value, key), `missing:${key}`);
  if (errors.length) return { valid: false, errors };
  if (type !== "result") check(DAILY_KINDS.includes(value.kind), "kind");
  if (type === "display") {
    check(id(value.id), "id");
    check(typeof value.kind === "string" && id(value.id) && value.key === `${value.kind}:${value.id}`, "key");
    for (const key of ["dateLabel", "title", "subtitle", "statusLabel", "error"]) check(text(value[key]), key);
    check(typeof value.busy === "boolean", "busy");
    check(record(value.actions) && Object.entries(value.actions).every(([action, visible]) =>
      DAILY_ACTIONS.includes(action) && typeof visible === "boolean"), "actions");
  } else if (type === "notification") {
    check(DAILY_ACTIONS.includes(value.action), "action");
    for (const key of ["id", "draftId", "requestId", "baseFingerprint"]) check(nullableId(value[key]), key);
    check(record(value.values), "values");
  } else {
    check(DAILY_RESULT_STATUSES.includes(value.status), "status");
    check(nullableId(value.entityId), "entityId");
    check(errorsValid(value.errors), "errors");
    check(DAILY_SYNC_STATUSES.includes(value.syncStatus), "syncStatus");
    check(nullableId(value.undoToken), "undoToken");
    if (value.status === "saved") {
      check(id(value.entityId), "saved:entityId");
      check(errorsValid(value.errors) && Object.keys(value.errors).length === 0, "saved:errors");
    }
  }
  return { valid: errors.length === 0, errors };
}
