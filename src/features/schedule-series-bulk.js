import { seriesEnabled, seriesInvalid } from "./schedule-series.js";
import { createDailyDraftStore } from "./daily-draft.js";
import { scheduleSeriesDates, scheduleSeriesFingerprint, normalizeSeriesTime } from "../core/schedule-series.js";
import { schedulesWithSeriesForDate } from "../core/schedule-series-derive.js";
import { mergeStoredScheduleState } from "../core/schedule-series-storage.js";
import { contentKey } from "../core/single-schedule-merge.js";
import { nextMutationStamp, stamped } from "../core/mutation-stamp.js";

const stores = new WeakMap(), confirmations = new WeakMap();
const stamps = value => !value || typeof value !== "object" ? [] : [value.updatedAt, ...Object.values(value).flatMap(stamps)];
const conflict = () => Object.assign(seriesInvalid("対象が変わりました。最新一覧と入力を確認してください"), { status: "conflict" });
export function seriesBulkPreview(state, input, deps) {
  if (!seriesEnabled(deps) || input.kind !== "schedule" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input.requestId || "")) throw seriesInvalid("全件の要求を確認してください");
  const source = { scheduleSeries: (state.scheduleSeries || []).filter(p => p?.id === input.seriesId),
    singleSchedules: (state.singleSchedules || []).filter(r => r?.seriesId === input.seriesId) };
  const checked = mergeStoredScheduleState(source), parent = checked.readable.scheduleSeries[0];
  if (checked.warnings.length || !parent || parent.lifecycle.value.deleted) throw seriesInvalid("系列の保存形式を確認してください");
  const now = typeof deps.now === "function" ? deps.now() : deps.now, today = now.slice(0, 10), values = input.values;
  if (!values?.title?.trim() || typeof values.note !== "string") throw seriesInvalid("名前とメモを確認してください");
  const changes = { title: values.title.trim(), note: values.note, time: normalizeSeriesTime({ startTime: values.startTime,
    endTime: values.endTime, endDayOffset: values.endNextDay ? 1 : 0 }), pattern: values.pattern };
  scheduleSeriesDates(parent.creation.value.anchorDate, changes.pattern);
  const updatedAt = nextMutationStamp({ now, candidates: stamps(source) });
  const revision = { id: input.requestId, changeId: input.requestId, updatedAt, effectiveFrom: today, changes };
  const candidate = stamped({ ...parent, revisions: [...parent.revisions, revision] }, updatedAt);
  const after = { ...source, scheduleSeries: [candidate] };
  const patterns = [parent.creation.value.pattern, ...parent.revisions.map(r => r.changes.pattern).filter(Boolean), changes.pattern];
  const until = patterns.map(p => p.until).sort().at(-1);
  const dates = new Set([...scheduleSeriesDates(parent.creation.value.anchorDate, { frequency: "daily", until }),
    ...checked.readable.singleSchedules.map(r => r.overrides.date?.value || r.occurrenceKey)]);
  const collect = snapshot => new Map([...dates].flatMap(date => schedulesWithSeriesForDate(snapshot, date).records.filter(r => r.date === date)).map(r => [r.id, r]));
  const beforeRows = collect(source), afterRows = collect(after);
  const ids = new Set([...beforeRows.keys(), ...afterRows.keys(), ...source.singleSchedules.map(r => r.id)]);
  const rows = [...ids].sort().map(id => {
    const before = beforeRows.get(id), next = afterRows.get(id), saved = checked.readable.singleSchedules.find(r => r.id === id);
    const key = before?.occurrenceKey || next?.occurrenceKey || saved.occurrenceKey;
    const date = before?.date || next?.date || saved.overrides.date?.value || key;
    const deleted = saved?.overrides.lifecycle?.value.deleted || false;
    const target = key >= today && date >= today && !deleted;
    return { id, key, date, before: before || null, after: next || null, deleted, target,
      replaced: target && before ? ["title", "time", "note"].filter(f => saved?.overrides[f] && !saved.overrides[f].cleared).length : 0 };
  });
  const comparison = rows.map(row => ({ ...row, after: row.after ? { ...row.after, updatedAt: "" } : null }));
  return { fingerprint: scheduleSeriesFingerprint({ ...source, today, changes, rows: comparison }), candidate, rows, today };
}
export function prepareSeriesBulk(input, deps) {
  if (!stores.has(deps)) stores.set(deps, createDailyDraftStore({ restore: true, storage: deps.draftStorage || (() => globalThis.sessionStorage) }));
  const store = stores.get(deps), key = { kind: "schedule", id: input.seriesId, draftId: `series-bulk:${input.requestId}`, connection: deps.connection || "local" };
  const signature = contentKey({ values: input.values, confirmation: input.confirmation });
  const old = store.get(key);
  if (old) { if (old.signature !== signature) throw seriesInvalid("新しい要求で再確認してください"); return { ...input, bulkDraft: old }; }
  const preview = seriesBulkPreview(deps.state, input, deps);
  const draft = { ...key, signature, candidate: preview.candidate, values: input.values, fingerprint: input.confirmation };
  if (!store.put(draft).ok) throw seriesInvalid("下書きを保存できません。入力を残しています");
  return { ...input, bulkDraft: draft };
}
export function buildSeriesBulk(state, input, deps) {
  const draft = input.bulkDraft;
  if (!draft || !seriesEnabled(deps)) throw seriesInvalid("全件の下書きを確認してください");
  const current = (state.scheduleSeries || []).find(p => p?.id === input.seriesId);
  const saved = current?.revisions.find(r => r.id === input.requestId);
  if (saved && contentKey(saved) === contentKey(draft.candidate.revisions.at(-1))) return { records: [] };
  if (seriesBulkPreview(state, input, deps).fingerprint !== draft.fingerprint) throw conflict();
  const result = mergeStoredScheduleState(state, { scheduleSeries: [draft.candidate] });
  return { records: [], candidates: [draft.candidate.updatedAt], values: [
    { kind: null, key: "scheduleSeries", before: state.scheduleSeries, after: result.scheduleSeries }] };
}
export function seriesBulkControls(row, parent, escapeHTML) {
  const pattern = parent.revisions.filter(r => r.effectiveFrom <= row.occurrenceKey && r.changes.pattern)
    .sort((a, b) => a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : a.changeId < b.changeId ? -1 : 1).at(-1)?.changes.pattern || parent.creation.value.pattern;
  return `<details><summary>今日以降の全件変更</summary><label>頻度<select style="font-size:16px" data-modal-field="bulkFrequency" data-bulk-frequency>${["daily", "weekdays", "weekly"].map((f, i) => `<option value="${f}" ${f === pattern.frequency ? "selected" : ""}>${["毎日", "平日", "毎週"][i]}</option>`).join("")}</select></label>
    <label>終了日<input style="font-size:16px" type="date" data-modal-field="bulkUntil" data-bulk-until value="${escapeHTML(pattern.until)}"></label>
    <p>上の名前・時刻・メモを今日以降へ適用します。日付の移動と完了は変更しません。</p><button type="button" data-action="series-bulk-preview">影響一覧を確認</button><div data-bulk-impact></div></details>`;
}
function renderImpact(preview, escapeHTML) {
  const label = row => row ? `${row.title} / ${row.plannedStartAt}–${row.plannedEndAt} / ${row.note}` : "なし";
  return `<p>今日以降の同じ繰り返しを変更します。名前・時刻・メモの個別変更は置き換わります。過去・移動した日付・完了・削除はそのままです。未保存の他端末変更は含みません。</p>
    <p>置換する例外 ${preview.rows.reduce((n, r) => n + r.replaced, 0)}件 / 追加 ${preview.rows.filter(r => !r.before && r.after).length}件 / 対象外になる ${preview.rows.filter(r => r.before && !r.after).length}件 / 個別変更済みで残す ${preview.rows.filter(r => r.after?.individuallyModified).length}件</p>
    ${preview.rows.map(r => `<p>${escapeHTML(r.key)} → ${escapeHTML(r.date)} / ${r.target ? "対象内" : "対象外"}${r.deleted ? "・削除済み" : ""}: ${escapeHTML(label(r.before))} → ${escapeHTML(label(r.after))}</p>`).join("")}
    <button type="button" data-action="series-bulk-save">この一覧を確認して全件保存</button>`;
}
export function submitSeriesBulk(save, target, deps, run) {
  if (!seriesEnabled(deps.operationDeps)) return;
  const form = target.closest("[data-occurrence-form]"), read = name => form.querySelector(`[data-occurrence-field="${name}"]`);
  const values = { title: read("title").value, note: read("note").value, startTime: read("startTime").value, endTime: read("endTime").value,
    endNextDay: read("endNextDay").checked, pattern: { frequency: form.querySelector("[data-bulk-frequency]").value, until: form.querySelector("[data-bulk-until]").value } };
  const previous = confirmations.get(form), signature = contentKey(values);
  try {
    if (read("date").value !== form.dataset.date) throw seriesInvalid("全件変更では日付を移動できません");
    if (save && previous?.signature === signature) {
      const result = run("daily-series-bulk", previous.input, deps.operationDeps);
      if (result.ok) { deps.closeModal(); deps.render(); deps.notify("この端末で保存・同期待ち"); return; }
      if (result.status !== "conflict") { deps.notify(result.error?.message || "保存できません。入力を残しています"); return; }
      deps.notify(result.error.message);
    }
    const input = { kind: "schedule", seriesId: form.dataset.seriesId, requestId: crypto.randomUUID(), values };
    const preview = seriesBulkPreview(deps.state(), input, deps.operationDeps);
    confirmations.set(form, { signature, input: { ...input, confirmation: preview.fingerprint } });
    form.querySelector("[data-bulk-impact]").innerHTML = renderImpact(preview, deps.escapeHTML);
  } catch (error) { deps.notify(error.message); }
}
