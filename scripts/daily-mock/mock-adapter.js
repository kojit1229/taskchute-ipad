import { validateDailyContract } from "../../src/ui/daily-parts/contract.js";

import { actualDurationMinutes, buildActualEdit } from "../../src/core/daily-actuals.js";

export const MOCK_STORAGE_KEY = "taskchute-daily-mock-m04";
const clone = value => JSON.parse(JSON.stringify(value));
const time = value => typeof value === "string" && /^(?:|(?:[01]\d|2[0-3]):[0-5]\d)$/.test(value);
const actions = ["modal-save", "daily-block-start", "daily-block-end", "daily-actual-edit", "daily-report-refresh", "daily-plan-times-save", "daily-plan-times-cancel", "daily-plan-complete", "daily-block-duplicate", "daily-duplicate-undo"];
const envelope = values => ({ action: "modal-save", kind: "block", id: null, draftId: null, requestId: null, baseFingerprint: null, values });
const entityValid = item => item && item.kind === "block" && typeof item.id === "string" && item.id.startsWith("mock-")
  && typeof item.title === "string" && time(item.start) && time(item.end)
  && ["actualStartAt", "actualEndAt"].every(key => item[key] == null || item[key] === "" || actualDurationMinutes({ actualStartAt: item[key], actualEndAt: item[key] }) === 0)
  && (item.completed == null || typeof item.completed === "boolean")
  && typeof item.endNextDay === "boolean" && typeof item.planCompleted === "boolean";
function stateValid(value) {
  return validateDailyContract("notification", envelope(value)).valid && Number.isSafeInteger(value.revision) && value.revision >= 0
    && (value.reports == null || (typeof value.reports === "object" && !Array.isArray(value.reports) && Object.values(value.reports).every(text => typeof text === "string")))
    && Array.isArray(value.entities) && value.entities.every(entityValid)
    && new Set(value.entities.map(item => item.id)).size === value.entities.length
    && Array.isArray(value.receipts) && value.receipts.every(item => typeof item.requestId === "string"
      && typeof item.signature === "string" && validateDailyContract("result", item.result).valid);
}

// Only synthetic records and this one key; storage injection also makes failures testable in Node.
export function createMockAdapter({ fixtures, storage }) {
  if (!stateValid(fixtures) || !storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function")
    throw new TypeError("Invalid mock fixtures or storage");
  let state = clone(fixtures), candidate = null;
  const attempts = new Map();
  const stored = storage.getItem(MOCK_STORAGE_KEY);
  if (stored !== null) {
    const restored = JSON.parse(stored);
    if (!stateValid(restored)) throw new TypeError("Invalid mock storage");
    state = restored;
  }
  const fingerprint = () => `mock:${state.revision}`;
  const result = (status, entityId = null, errors = [], undoToken = null) => ({ status, entityId, errors, syncStatus: null, undoToken });
  function dispatchMockOperation(notification, { scenario = "success" } = {}) {
    if (!validateDailyContract("notification", notification).valid)
      return result("invalid", null, ["操作通知が不正です"]);
    const { action, id, kind, requestId, baseFingerprint, values } = notification;
    if (!actions.includes(action) || !["success", "failure", "cancel", "retry"].includes(scenario) || kind !== "block" || !requestId)
      return result("invalid", id, ["未接続の操作、または不正な要求です"]);
    const signature = JSON.stringify(notification);
    const previous = state.receipts.find(item => item.requestId === requestId) || attempts.get(requestId);
    if (previous && previous.signature !== signature) return result("conflict", id, ["要求番号が重複しています"]);
    if (previous && previous.result.status !== "storage-failed") return clone(previous.result);
    const index = state.entities.findIndex(item => item.id === id);
    if ((index < 0 && !(action === "modal-save" && id === null) && action !== "daily-report-refresh") || baseFingerprint !== fingerprint()) return result("conflict", id, ["対象が変更されています"]);
    if (action === "daily-plan-times-cancel" || scenario === "cancel") {
      candidate = null; const answer = result("cancelled", id); attempts.set(requestId, { signature, result: answer }); return clone(answer);
    }
    candidate = clone(state);
    const item = candidate.entities[index];
    let entityId = id, undoToken = null;
    if (action === "modal-save") {
      const added = { ...item, ...values, kind: "block", id: id ?? `mock-${state.revision + 1}`, planCompleted: item?.planCompleted ?? false };
      if (Object.keys(values).some(key => !["title", "date", "start", "end", "endNextDay"].includes(key)) || !entityValid(added) || !/^\d{4}-\d{2}-\d{2}$/.test(added.date)
        || Boolean(added.start) !== Boolean(added.end) || (added.start && !added.endNextDay && added.end <= added.start)) { candidate = null; return result("invalid", id); }
      entityId = added.id;
      if (id === null) { if (state.entities.some(row => row.id === entityId)) { candidate = null; return result("conflict", id); } candidate.entities.push(added); }
      else candidate.entities[index] = added;
    } else if (["daily-block-start", "daily-block-end", "daily-actual-edit"].includes(action)) {
      try {
        if (action === "daily-actual-edit") candidate.entities[index] = buildActualEdit({ blocks: candidate.entities }, notification).block;
        else {
          const key = action === "daily-block-start" ? "actualStartAt" : "actualEndAt";
          if (Object.keys(values).some(field => ![key, ...(key === "actualEndAt" ? ["completed"] : [])].includes(field)) || !values[key]
            || (key === "actualEndAt" && typeof values.completed !== "boolean")) throw new Error("実績入力が不正です");
          Object.assign(item, values);
          if (!entityValid(item) || (item.actualStartAt && item.actualEndAt && actualDurationMinutes(item) == null)) throw new Error("実績時刻が不正です");
        }
      } catch (error) { candidate = null; return result("invalid", id, [error.message]); }
    } else if (action === "daily-report-refresh") {
      if (Object.keys(values).length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(values.reportDate)) { candidate = null; return result("invalid", id); }
      const total = candidate.entities.filter(row => row.date === values.reportDate).reduce((sum, row) => sum + (actualDurationMinutes(row) ?? 0), 0);
      (candidate.reports ??= {})[values.reportDate] = `計測合計: ${total}分`; entityId = values.reportDate;
    } else if (action === "daily-plan-times-save") {
      if (Object.keys(values).some(key => !["start", "end", "endNextDay"].includes(key))
        || !time(values.start) || !time(values.end) || typeof values.endNextDay !== "boolean"
        || Boolean(values.start) !== Boolean(values.end)
        || (values.start && !values.endNextDay && values.end <= values.start)) {
        candidate = null; return result("invalid", id, ["開始・終了を確認してください"]);
      }
      Object.assign(item, values);
    } else if (action === "daily-plan-complete") {
      if (Object.keys(values).length !== 1 || typeof values.desiredCompleted !== "boolean") {
        candidate = null; return result("invalid", id, ["完了状態が不正です"]);
      }
      item.planCompleted = values.desiredCompleted;
    } else if (action === "daily-block-duplicate") {
      if (Object.keys(values).length) { candidate = null; return result("invalid", id, ["複製入力が不正です"]); }
      entityId = `mock-copy-${state.revision + 1}`;
      if (state.entities.some(row => row.id === entityId)) { candidate = null; return result("conflict", id); }
      candidate.entities.push({ ...item, id: entityId });
      undoToken = JSON.stringify(candidate.entities.at(-1));
    } else if (action === "daily-duplicate-undo") {
      if (Object.keys(values).length !== 1 || !state.receipts.some(receipt => receipt.result.entityId === id
        && receipt.result.undoToken === values.undoToken && values.undoToken === JSON.stringify(item))) {
        candidate = null; return result("conflict", id, ["この端末で変更済みのため取消できません"]);
      }
      candidate.entities.splice(index, 1);
    }
    const answer = result("saved", entityId, [], undoToken);
    candidate.revision++;
    candidate.receipts.push({ requestId, signature, result: answer });
    attempts.set(requestId, { signature, result: result("conflict", id, ["保存中です"]) });
    try {
      if (scenario === "failure") throw new Error("injected mock storage failure");
      storage.setItem(MOCK_STORAGE_KEY, JSON.stringify(candidate));
    } catch {
      const failure = result("storage-failed", id, ["架空データの保存に失敗しました。入力を保持しています"]);
      attempts.set(requestId, { signature, result: failure }); return clone(failure);
    }
    state = candidate; candidate = null;
    return clone(answer);
  }
  return { dispatchMockOperation, fingerprint, getState: () => clone(state), getCandidate: () => clone(candidate) };
}
