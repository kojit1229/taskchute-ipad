import { validSchedule, mergeSingleSchedules, contentKey } from "./single-schedule-merge.js";

export const isValidSingleSchedule = validSchedule;

export function singleSchedulesEqual(left, right) {
  const keys = value => normalizeSingleSchedules(value).stored.map(contentKey).sort();
  return JSON.stringify(keys(left)) === JSON.stringify(keys(right));
}

export function mergeStoredSingleSchedules(local, remote) {
  const result = mergeSingleSchedules(normalizeSingleSchedules(local).stored,
    normalizeSingleSchedules(remote).stored, { isValid: isValidSingleSchedule });
  return { ...result, stored: [...result.records, ...result.preserved] };
}

export function validateSingleScheduleContainer(value) {
  if (value !== undefined && !Array.isArray(value)) {
    const error = new TypeError("保存データの singleSchedules の形式が不正です");
    error.name = "StateContainerError";
    throw error;
  }
}

// Only absent defaults are filled. Invalid rows (including a duplicate-id group) stay verbatim.
export function normalizeSingleSchedules(value) {
  validateSingleScheduleContainer(value);
  const source = value === undefined ? [] : value;
  const counts = new Map();
  for (const row of source) if (row?.id) counts.set(row.id, (counts.get(row.id) || 0) + 1);
  const records = [], preserved = [];
  const stored = source.map(row => {
    if (!isValidSingleSchedule(row) || counts.get(row.id) !== 1) {
      preserved.push(row);
      return row;
    }
    const defaults = { completed: false, note: "", createdAt: "", updatedAt: "", deleted: false,
      seriesId: "", occurrenceKey: "", overrides: {} };
    const record = { ...row };
    for (const [key, fallback] of Object.entries(defaults))
      if (!Object.hasOwn(record, key)) record[key] = fallback;
    records.push(record);
    return record;
  });
  return { stored, records, preserved,
    warnings: preserved.length ? [{ code: "invalid-records", count: preserved.length }] : [] };
}

// Callers receive the warning alongside readable rows; warnings never enter synchronized state.
export function schedulesForDate(state, date) {
  const result = normalizeSingleSchedules(state.singleSchedules);
  return { records: result.records.filter(row => row.date === date && !row.deleted), warnings: result.warnings };
}
