import { createDailyDraftStore } from "./daily-draft.js";
import { createSeriesMergeCandidate } from "../core/schedule-series-merge.js";
import { scheduleSeriesDates } from "../core/schedule-series.js";
import { contentKey } from "../core/single-schedule-merge.js";
import { SCHEDULE_SERIES_ENABLED, mergeStoredScheduleState, scheduleStateEqual } from "../core/schedule-series-storage.js";
import { nextMutationStamp, stamped } from "../core/mutation-stamp.js";

const stores = new WeakMap();
export const seriesEnabled = deps => deps?.scheduleSeriesEnabled ?? SCHEDULE_SERIES_ENABLED;
export const seriesInvalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });
function owner(action, input, deps) {
  if (!seriesEnabled(deps) || input?.kind !== "schedule" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input.requestId || ""))
    throw seriesInvalid("繰り返し予定は未公開、または要求番号が不正です");
  if (!stores.has(deps)) stores.set(deps, createDailyDraftStore({ restore: true, storage: deps.draftStorage || (() => globalThis.sessionStorage) }));
  return { store: stores.get(deps), key: { kind: "schedule", id: input.id || input.requestId,
    draftId: `series-${action}:${input.requestId}`, connection: deps.connection || "local" } };
}
export function prepareSeriesRegistration(action, input, deps) {
  const { store, key } = owner(action, input, deps), before = store.get(key);
  if (before) {
    if (contentKey(before.values) !== contentKey(input.values) || before.baseFingerprint !== (input.baseFingerprint || null))
      throw seriesInvalid("入力を変える場合は新しい要求として保存してください");
    return { ...input, seriesDraft: before };
  }
  try {
    const origin = action === "convert" ? deps.state.singleSchedules.find(row => row?.id === input.id) : null;
    if (action === "convert" && (!origin || origin.seriesId || contentKey(origin) !== input.baseFingerprint))
      throw seriesInvalid("元の単発予定が変わっています。最新値を確認してください");
    const createdAt = typeof deps.now === "function" ? deps.now() : deps.now;
    const updatedAt = nextMutationStamp({ now: createdAt, candidates: [origin?.updatedAt] });
    const candidate = createSeriesMergeCandidate({ pattern: input.values.pattern,
      ...(origin ? { originSchedule: origin } : { anchorDate: input.values.anchorDate, defaults: input.values.defaults }),
      id: (deps.newId || (() => crypto.randomUUID()))(), createdAt, updatedAt, changeId: input.requestId });
    const parent = candidate.scheduleSeries[0];
    if (!origin && !scheduleSeriesDates(parent.creation.value.anchorDate, parent.creation.value.pattern).length)
      throw seriesInvalid("発生する回がありません。期間を確認してください");
    candidate.scheduleSeries = [stamped(parent, updatedAt)];
    const draft = { ...key, action, values: input.values, baseFingerprint: input.baseFingerprint || null, candidate };
    if (!store.put(draft).ok) throw seriesInvalid("下書きの控えを保存できません。入力を残しています");
    return { ...input, seriesDraft: draft };
  } catch (error) { throw seriesInvalid(error.message); }
}
export function buildSeriesRegistration(state, input, deps) {
  const draft = input?.seriesDraft;
  if (!seriesEnabled(deps) || !draft?.candidate) throw seriesInvalid("系列の下書きを確認してください");
  const parent = draft.candidate.scheduleSeries[0];
  const origin = (state.singleSchedules || []).find(row => row?.id === parent.originScheduleId);
  if (draft.action === "convert" && !origin?.seriesId && contentKey(origin) !== draft.baseFingerprint)
    throw seriesInvalid("元の単発予定が更新されています。下書きを残しています");
  const result = mergeStoredScheduleState(state, draft.candidate);
  if (!result.readable.scheduleSeries.some(row => row.id === parent.id)) throw seriesInvalid("系列の保存形式を確認してください");
  return { records: [], candidates: [parent.updatedAt], values: scheduleStateEqual(state, result) ? [] : ["scheduleSeries", "singleSchedules"].map(key =>
    ({ kind: null, key, before: state[key], after: result[key] })), series: result.readable.scheduleSeries.find(row => row.id === parent.id) };
}
export function seriesRegistrationOperation(action) {
  return { prepare: (input, deps) => prepareSeriesRegistration(action, input, deps), build: buildSeriesRegistration };
}

export function seriesRegistrationForm(record, escapeHTML) {
  const field = (name, type, value = "") => `<input style="font-size:16px" data-series-field="${name}" type="${type}" ${type === "time" ? 'step="300"' : ""} value="${escapeHTML(value)}">`;
  const date = record?.date || "";
  return `<section data-series-form data-origin="${escapeHTML(record?.id || "")}" data-fingerprint="${escapeHTML(record ? contentKey(record) : "")}">
    <p>${record ? "この予定を繰り返す" : "繰り返し予定を登録"}</p>
    ${record ? "" : `<label>予定名${field("title", "text")}</label><label>開始日${field("date", "date", date)}</label>
      <label>開始${field("startTime", "time")}</label><label>終了${field("endTime", "time")}</label>
      <label>翌日終了<input data-series-field="endNextDay" type="checkbox"></label><label>メモ<textarea style="font-size:16px" data-series-field="note"></textarea></label>`}
    <label>頻度<select style="font-size:16px" data-series-field="frequency"><option value="daily">毎日</option><option value="weekdays">平日</option><option value="weekly">毎週</option></select></label>
    <label>終了日${field("until", "date", date)}</label><button type="button" data-action="series-register-save">繰り返しを保存</button></section>`;
}
export function submitSeriesRegistration(target, deps, run) {
  if (!seriesEnabled(deps.operationDeps)) return;
  const form = target.closest("[data-series-form]"), read = name => form.querySelector(`[data-series-field="${name}"]`)?.value;
  const id = form.dataset.origin, values = { pattern: { frequency: read("frequency"), until: read("until") } };
  if (!id) Object.assign(values, { anchorDate: read("date"), defaults: { title: read("title"), note: read("note"),
    time: { startTime: read("startTime"), endTime: read("endTime"), endDayOffset: form.querySelector('[data-series-field="endNextDay"]').checked ? 1 : 0 } } });
  const inputKey = contentKey(values);
  if (target.dataset.inputKey !== inputKey) { target.dataset.requestId = crypto.randomUUID(); target.dataset.inputKey = inputKey; }
  const result = run(`daily-series-${id ? "convert" : "add"}`, { kind: "schedule", ...(id ? { id, baseFingerprint: form.dataset.fingerprint } : {}),
    requestId: target.dataset.requestId, values }, deps.operationDeps);
  if (!result.ok) { deps.notify(result.error?.message || "保存できません。入力を残しています"); return; }
  deps.state().modal = null; deps.render(); deps.notify("この端末で保存・同期待ち");
}
