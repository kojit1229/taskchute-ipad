import { seriesEnabled, seriesInvalid } from "./schedule-series.js";
import { createDailyDraftStore } from "./daily-draft.js";
import { schedulesWithSeriesForDate } from "../core/schedule-series-derive.js";
import { scheduleSeriesFingerprint } from "../core/schedule-series.js";
import { mergeStoredScheduleState, scheduleStateEqual } from "../core/schedule-series-storage.js";
import { contentKey } from "../core/single-schedule-merge.js";
import { validateDailyTimes } from "../core/daily-time.js";
import { nextMutationStamp, stamped } from "../core/mutation-stamp.js";

const stores = new WeakMap();
function related(state, row) {
  const parent = (state.scheduleSeries || []).find(p => p?.id === row.seriesId);
  const counterpart = row.id === parent?.originScheduleId ? `schedule_${parent.id}_${parent.creation.value.anchorDate}` : row.id;
  return { scheduleSeries: parent ? [parent] : [], singleSchedules: (state.singleSchedules || []).filter(r => r?.id === row.id || r?.id === counterpart) };
}
export function occurrenceFingerprint(state, row) {
  return scheduleSeriesFingerprint({ ...related(state, row), kind: "schedule", id: row.id,
    occurrenceKey: row.occurrenceKey, date: row.date, display: row });
}
const stamps = value => !value || typeof value !== "object" ? [] : [value.updatedAt, ...Object.values(value).flatMap(stamps)];
function currentRow(state, input) {
  return schedulesWithSeriesForDate(state, input.date).records.find(r => r.id === input.id && r.seriesId === input.seriesId && r.occurrenceKey === input.occurrenceKey);
}
function draftOwner(action, input, deps) {
  if (!seriesEnabled(deps) || input.kind !== "schedule" || !input.id || !input.seriesId
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input.requestId || "")) throw seriesInvalid("この回の要求を確認してください");
  if (!stores.has(deps)) stores.set(deps, createDailyDraftStore({ restore: true, storage: deps.draftStorage || (() => globalThis.sessionStorage) }));
  return { store: stores.get(deps), key: { kind: "schedule", id: input.id,
    draftId: `occurrence-${action}:${input.requestId}`, connection: deps.connection || "local" } };
}
function changedFields(action, input, row) {
  if (action === "restore-time") return { time: input.restoreTime };
  if (action === "delete") { if (input.confirmed !== true) throw seriesInvalid("この回の削除を確認してください"); return { lifecycle: { deleted: true } }; }
  if (action === "complete") {
    if (typeof input.desiredCompleted !== "boolean") throw seriesInvalid("完了の希望値を確認してください");
    return row.completed === input.desiredCompleted ? {} : { completion: { completed: input.desiredCompleted } };
  }
  if (action !== "edit" || typeof input.values?.title !== "string" || !input.values.title.trim() || typeof input.values.note !== "string")
    throw seriesInvalid("名前とメモを確認してください");
  const times = validateDailyTimes({ ...input.values, start: input.values.start ?? input.values.startTime, end: input.values.end ?? input.values.endTime }, row);
  if (!times.plannedStartAt || !times.plannedEndAt) throw seriesInvalid("開始と終了を確認してください");
  const moved = times.date !== row.date, fields = {};
  if (moved) fields.date = times.date;
  for (const key of ["title", "note"]) if (moved || input.values[key] !== row[key]) fields[key] = key === "title" ? input.values[key].trim() : input.values[key];
  if (moved || times.plannedStartAt !== row.plannedStartAt || times.plannedEndAt !== row.plannedEndAt)
    fields.time = { startTime: times.plannedStartAt.slice(11), endTime: times.plannedEndAt.slice(11), endDayOffset: times.plannedEndAt.slice(0, 10) === times.date ? 0 : 1 };
  return fields;
}
export function prepareOccurrence(action, input, deps) {
  const { store, key } = draftOwner(action, input, deps);
  const signature = contentKey({ values: input.values ?? null, restoreTime: input.restoreTime ?? null, completed: input.desiredCompleted ?? null, confirmed: input.confirmed ?? null, base: input.baseFingerprint });
  const previous = store.get(key);
  if (previous) {
    if (previous.signature !== signature) throw seriesInvalid("入力を変えたら新しい要求として保存してください");
    return { ...input, occurrenceDraft: previous };
  }
  const row = currentRow(deps.state, input);
  if (!row || occurrenceFingerprint(deps.state, row) !== input.baseFingerprint) throw seriesInvalid("この回が更新されています。最新値と下書きを確認してください");
  const fields = changedFields(action, input, row), saved = (deps.state.singleSchedules || []).find(r => r?.id === row.id);
  const now = typeof deps.now === "function" ? deps.now() : deps.now;
  const updatedAt = nextMutationStamp({ now, candidates: stamps(related(deps.state, row)) });
  const candidate = Object.keys(fields).length ? stamped({ ...(saved || { id: row.id, seriesId: row.seriesId,
    occurrenceKey: row.occurrenceKey, formatVersion: 1, createdAt: now }), overrides: { ...saved?.overrides,
    ...Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, { ...(action === "restore-time" && value === null ? { cleared: true } : { value }), updatedAt, changeId: input.requestId }])) } }, updatedAt) : null;
  const draft = { ...key, signature, candidate, baseFingerprint: input.baseFingerprint };
  if (!store.put(draft).ok) throw seriesInvalid("下書きの控えを保存できません。入力を残しています");
  return { ...input, occurrenceDraft: draft };
}
export function buildOccurrence(state, input, deps) {
  const draft = input?.occurrenceDraft;
  if (!seriesEnabled(deps) || !draft) throw seriesInvalid("この回の下書きを確認してください");
  const row = currentRow(state, input);
  const result = mergeStoredScheduleState(state, { singleSchedules: draft.candidate ? [draft.candidate] : [] });
  const unchanged = scheduleStateEqual(state, result);
  if ((!row || occurrenceFingerprint(state, row) !== draft.baseFingerprint) && !unchanged)
    throw seriesInvalid("親またはこの回が更新されています。再確認してください");
  if (draft.candidate && !result.readable.singleSchedules.some(r => r.id === draft.candidate.id)) throw seriesInvalid("この回の保存形式を確認してください");
  return { records: [], candidates: [draft.candidate?.updatedAt], values: unchanged ? [] : [
    { kind: null, key: "singleSchedules", before: state.singleSchedules, after: result.singleSchedules }] };
}
export function occurrenceForm(row, escapeHTML, bulkControls = "") {
  const field = (name, type, value) => `<label>${({ title: "予定名", date: "日付", startTime: "開始", endTime: "終了" })[name]}<input style="font-size:16px" data-modal-field="${name}" data-occurrence-field="${name}" type="${type}" ${type === "time" ? 'step="300"' : ""} value="${escapeHTML(value)}"></label>`;
  return `<section data-occurrence-form data-id="${escapeHTML(row.id)}" data-series-id="${escapeHTML(row.seriesId)}" data-key="${row.occurrenceKey}" data-date="${row.date}" data-fingerprint="${escapeHTML(row.seriesFingerprint)}">
    ${field("title", "text", row.title)}${field("date", "date", row.date)}${field("startTime", "time", row.plannedStartAt.slice(11))}${field("endTime", "time", row.plannedEndAt.slice(11))}
    <label>翌日終了<input data-modal-field="endNextDay" data-occurrence-field="endNextDay" type="checkbox" ${row.plannedEndAt.slice(0, 10) !== row.date ? "checked" : ""}></label>
    <label>メモ<textarea style="font-size:16px" data-modal-field="note" data-occurrence-field="note">${escapeHTML(row.note)}</textarea></label>
    <button type="button" data-action="series-occurrence-save">この回だけ保存</button><button type="button" data-action="series-occurrence-delete">この回だけ削除</button>${bulkControls}</section>`;
}
export function submitOccurrence(action, target, deps, run) {
  if (!seriesEnabled(deps.operationDeps)) return;
  const form = target.closest("[data-occurrence-form]"), data = form.dataset;
  const values = Object.fromEntries([...form.querySelectorAll("[data-occurrence-field]")].map(el => [el.dataset.occurrenceField, el.type === "checkbox" ? el.checked : el.value]));
  if (action === "delete" && !globalThis.confirm("この回だけ削除しますか？")) return;
  const signature = contentKey(values);
  if (target.dataset.signature !== signature) { target.dataset.signature = signature; target.dataset.requestId = crypto.randomUUID(); }
  const result = run(`daily-schedule-${action}`, { kind: "schedule", id: data.id, seriesId: data.seriesId,
    occurrenceKey: data.key, date: data.date, baseFingerprint: data.fingerprint, requestId: target.dataset.requestId, values, confirmed: true }, deps.operationDeps);
  if (!result.ok) { deps.notify(result.error?.message || "保存できません。入力を残しています"); return; }
  deps.closeModal(); deps.render(); deps.notify("この端末で保存・同期待ち");
}
