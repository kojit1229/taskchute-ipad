import { mergeScheduleSeries } from "./schedule-series-merge.js";
import { scheduleSeriesDates, normalizeSeriesTime, scheduleSeriesFingerprint } from "./schedule-series.js";
import { mergeStoredSingleSchedules, validateSingleScheduleContainer } from "./single-schedule.js";
import { contentKey } from "./single-schedule-merge.js";
import { nextMutationStamp } from "./mutation-stamp.js";

// Release activation belongs to the all-device rollout. Tests inject true explicitly.
export const SCHEDULE_SERIES_ENABLED = false;
const requireValue = ok => { if (!ok) throw new TypeError("invalid schedule series record"); };
export function validateScheduleContainers(snapshot) {
  validateSingleScheduleContainer(snapshot.singleSchedules);
  if (snapshot.scheduleSeries !== undefined && !Array.isArray(snapshot.scheduleSeries)) {
    const error = new TypeError("保存データの scheduleSeries の形式が不正です");
    error.name = "StateContainerError"; throw error;
  }
}
const date = value => scheduleSeriesDates(value, { frequency: "daily", until: value });
function stamp(value) {
  requireValue(value && typeof value.changeId === "string"
    && /^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|legacy:[0-9a-f]+)$/.test(value.changeId));
  nextMutationStamp({ now: value.updatedAt });
}
function defaults(value) {
  requireValue(value && typeof value.title === "string" && value.title.trim() && typeof value.note === "string");
  normalizeSeriesTime(value.time);
}
function validate(row, parent) {
  requireValue(row && row.formatVersion === 1 && typeof row.id === "string" && row.id);
  nextMutationStamp({ now: row.createdAt }); nextMutationStamp({ now: row.updatedAt });
  if (parent) {
    requireValue(typeof row.originScheduleId === "string" && Array.isArray(row.revisions));
    stamp(row.creation); stamp(row.lifecycle); requireValue(typeof row.lifecycle.value?.deleted === "boolean");
    const { anchorDate, pattern, defaults: values } = row.creation.value;
    scheduleSeriesDates(anchorDate, pattern); defaults(values);
    for (const revision of row.revisions) {
      stamp(revision); requireValue(revision.id === revision.changeId); date(revision.effectiveFrom); defaults(revision.changes);
      if (revision.changes.pattern) scheduleSeriesDates(anchorDate, revision.changes.pattern);
    }
    scheduleSeriesFingerprint({ scheduleSeries: [row] });
  } else {
    date(row.occurrenceKey); requireValue(row.overrides && !Array.isArray(row.overrides));
    for (const [key, value] of Object.entries(row.overrides)) {
      requireValue(["title", "time", "note", "date", "completion", "lifecycle"].includes(key)); stamp(value);
      if (value.cleared === true) { requireValue(["title", "time", "note", "date"].includes(key) && !Object.hasOwn(value, "value")); continue; }
      if (key === "time") normalizeSeriesTime(value.value);
      else if (key === "date") date(value.value);
      else if (key === "completion" || key === "lifecycle") requireValue(typeof value.value?.[key === "completion" ? "completed" : "deleted"] === "boolean");
      else requireValue(typeof value.value === "string" && (key !== "title" || value.value.trim()));
    }
    if (row.legacyExtras) stamp(row.legacyExtras);
  }
}
const unique = rows => [...new Map(rows.map(row => [contentKey(row), row])).values()];
const ordered = rows => rows.sort((a, b) => {
  const x = `${a?.id || "\uffff"}\n${contentKey(a)}`, y = `${b?.id || "\uffff"}\n${contentKey(b)}`;
  return x < y ? -1 : x > y ? 1 : 0;
});
// Isolate an invalid parent/child component; raw records remain in the full payload.
export function mergeStoredScheduleState(local, remote = {}) {
  validateScheduleContainers(local); validateScheduleContainers(remote);
  const sources = [local, remote].map(s => ({ scheduleSeries: s.scheduleSeries || [], singleSchedules: s.singleSchedules || [] }));
  const allParents = sources.flatMap(s => s.scheduleSeries), allRows = sources.flatMap(s => s.singleSchedules);
  const origins = new Set(allParents.map(p => p?.originScheduleId).filter(Boolean));
  const plain = sources.map(s => s.singleSchedules.filter(r => !r?.seriesId && !origins.has(r?.id)));
  const singles = mergeStoredSingleSchedules(...plain);
  const result = { scheduleSeries: [], singleSchedules: singles.stored, readable: { scheduleSeries: [], singleSchedules: singles.records }, warnings: [...singles.warnings] };
  const ids = new Set([...allParents.map(p => p?.id), ...allRows.map(r => r?.seriesId).filter(Boolean)]);
  for (const id of ids) {
    const parents = allParents.filter(p => p?.id === id), originIds = new Set(parents.map(p => p?.originScheduleId).filter(Boolean));
    const member = row => (id && row?.seriesId === id) || (!row?.seriesId && originIds.has(row?.id));
    const rows = allRows.filter(member);
    try {
      requireValue(id && parents.length); parents.forEach(p => validate(p, true));
      rows.filter(r => r?.seriesId).forEach(r => validate(r, false));
      for (const source of sources) for (const collection of [source.scheduleSeries.filter(p => p?.id === id), source.singleSchedules.filter(member)])
        requireValue(new Set(collection.map(r => r.id)).size === unique(collection).length);
      requireValue(!allParents.some(p => p?.id !== id && originIds.has(p?.originScheduleId)));
      const parts = sources.map(s => ({ scheduleSeries: unique(s.scheduleSeries.filter(p => p?.id === id)), singleSchedules: unique(s.singleSchedules.filter(member)) }));
      const merged = mergeScheduleSeries(...parts);
      for (const key of ["scheduleSeries", "singleSchedules"]) { result[key].push(...merged[key]); result.readable[key].push(...merged[key]); }
    } catch {
      result.scheduleSeries.push(...unique(parents)); result.singleSchedules.push(...unique(rows));
      result.warnings.push({ code: "invalid-series", id, count: parents.length + rows.length });
    }
  }
  result.scheduleSeries = ordered(unique(result.scheduleSeries));
  result.singleSchedules = ordered(unique(result.singleSchedules));
  return result;
}
export function scheduleStateEqual(left, right) {
  validateScheduleContainers(left); validateScheduleContainers(right);
  return ["scheduleSeries", "singleSchedules"].every(key => contentKey(ordered([...(left[key] || [])])) === contentKey(ordered([...(right[key] || [])])));
}
