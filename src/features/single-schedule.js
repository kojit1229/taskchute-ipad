import { createDailyDraftStore } from "./daily-draft.js";
import { validateDailyTimes } from "../core/daily-time.js";
import { isValidSingleSchedule, normalizeSingleSchedules } from "../core/single-schedule.js";
import { contentKey } from "../core/single-schedule-merge.js";

const stores = new WeakMap();
const invalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });
const textId = value => typeof value === "string" && Boolean(value.trim());
function ownerFor(action, input, deps) {
  if (input.kind !== "schedule" || !textId(input.requestId)
      || (action !== "add" && !textId(input.id))) throw invalid("予定と操作を確認してください");
  if (!stores.has(deps)) stores.set(deps, createDailyDraftStore({ restore: true,
    storage: deps.draftStorage || (() => globalThis.sessionStorage) }));
  return { store: stores.get(deps), owner: { kind: "schedule", id: action === "add" ? input.requestId : input.id,
    draftId: `${action}:${input.requestId}`, connection: deps.connection || "local" } };
}

export function getSingleScheduleDraft(action, input, deps) {
  const { store, owner } = ownerFor(action, input, deps);
  return store.get(owner);
}

// Called before commitCandidate: draft writes never occur inside the pure build.
// The caller supplies the fingerprint captured when editing/confirmation began.
export function prepareSingleSchedule(action, input, deps) {
  const { store, owner } = ownerFor(action, input, deps);
  let draft = store.get(owner);
  if (!draft) {
    if (action !== "add" && !textId(input.baseFingerprint)) throw invalid("編集開始時の予定を確認してください");
    draft = { ...owner, action, candidateId: action === "add" ? (deps.newId || (() => crypto.randomUUID()))() : input.id,
      createdAt: typeof deps.now === "function" ? deps.now() : deps.now,
      baseFingerprint: input.baseFingerprint || null, values: {} };
  }
  if (input.baseFingerprint != null && input.baseFingerprint !== draft.baseFingerprint)
    throw invalid("操作が変更されています。下書きと最新値を確認してください");
  const next = { ...draft, ...(input.values === undefined ? {} : { values: input.values }),
    ...(input.desiredCompleted === undefined ? {} : { desiredCompleted: input.desiredCompleted }),
    ...(input.confirmed === undefined ? {} : { confirmed: input.confirmed }) };
  if (draft.savedFingerprint && contentKey(next) !== contentKey(draft)) throw invalid("新しい操作として開いてください");
  if (!store.put(next).ok) throw invalid("下書きの控えを保存できません。入力を残しています");
  return { ...input, scheduleDraft: next };
}

function scheduleValues(values, before) {
  if (typeof values?.title !== "string" || !values.title.trim() || typeof values.note !== "string"
      || typeof values.date !== "string" || typeof values.endNextDay !== "boolean")
    throw invalid("名前・日付・翌日指定・メモを確認してください");
  const times = validateDailyTimes(values, before);
  if (!times.plannedStartAt || !times.plannedEndAt) throw invalid("開始と終了を入力してください");
  return { title: values.title.trim(), note: values.note, ...times };
}

export function buildSingleSchedule(state, input) {
  const draft = input.scheduleDraft;
  if (!draft) throw invalid("予定の下書きを確認してください");
  const normalized = normalizeSingleSchedules(state.singleSchedules);
  const matches = (state.singleSchedules || []).filter(row => row?.id === draft.candidateId);
  const before = matches[0];
  if (matches.length > 1 || (before && !normalized.records.some(row => row.id === before.id)))
    throw invalid("予定の保存形式を確認してください");
  const { action } = draft;
  if (action !== "add" && !before) throw invalid("対象の予定がありません。下書きを残しています");
  if (action === "delete" && draft.confirmed !== true) throw invalid("削除を確認してください");
  if (before?.deleted) {
    if (action === "delete") return { records: [], schedule: before };
    throw invalid("削除済みです。下書きを残しています");
  }
  if (action === "complete" && typeof draft.desiredCompleted !== "boolean") throw invalid("完了の希望値を確認してください");
  if (action !== "add" && contentKey(before) !== draft.baseFingerprint && contentKey(before) !== draft.savedFingerprint) {
    if (action === "complete" && before.completed === draft.desiredCompleted) return { records: [], schedule: before };
    throw invalid("予定が更新されています。最新値と下書きを確認してください");
  }
  let after;
  if (action === "add" || action === "edit") {
    const base = action === "add" ? { id: draft.candidateId, completed: false, deleted: false,
      note: "", createdAt: draft.createdAt, updatedAt: "", seriesId: "", occurrenceKey: "", overrides: {} } : before;
    after = { ...base, ...scheduleValues(draft.values, base) };
  } else after = { ...before, ...(action === "complete" ? { completed: draft.desiredCompleted } : { deleted: true }) };
  if (!isValidSingleSchedule(after)) throw invalid("予定の日付と開始・終了の組を確認してください");
  const same = before && contentKey({ ...before, updatedAt: "" }) === contentKey({ ...after, updatedAt: "" });
  if (action === "add" && before && !same) throw invalid("候補IDは保存済みです。最新値と下書きを確認してください");
  return { records: same ? [] : [{ kind: "singleSchedules", before: before || null, after }], schedule: after };
}

function singleScheduleEffects(result, input, deps) {
  const draft = input.scheduleDraft, { store } = ownerFor(draft.action, input, deps);
  const saved = result.records[0]?.after || result.schedule;
  store.put({ ...draft, savedFingerprint: contentKey(saved) });
  if (!result.unchanged) deps.singleScheduleEffect?.(result, input);
}

// Registry-only until D01; no modal handler or visible save action is installed.
export function singleScheduleOperation(action) {
  return { prepare: (input, deps) => prepareSingleSchedule(action, input, deps),
    build: buildSingleSchedule, effects: singleScheduleEffects };
}
