import { mergeRecords } from "./merge.js";

// JSON保存値のキー順だけを揃える。元のレコードは変更しない。
function contentKey(value) {
  if (Array.isArray(value)) return `[${value.map(contentKey).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${contentKey(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? String(value);
}

function dateDay(value) {
  const match = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return NaN;
  const [, year, month, day] = match.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return NaN;
  return Date.UTC(year + 400, month - 1, day) / 86400000;
}

function validDateTime(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value)
    && Number.isFinite(dateDay(value.slice(0, 10)));
}

// 予定1の検査関数が公開されたら rules.isValid から注入できる暫定境界。
function validSchedule(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)
    || typeof record.id !== "string" || !record.id.trim()
    || typeof record.title !== "string" || !record.title.trim()) return false;
  if (!validDateTime(record.plannedStartAt) || !validDateTime(record.plannedEndAt)
    || record.date !== record.plannedStartAt.slice(0, 10)
    || record.plannedEndAt <= record.plannedStartAt) return false;
  const span = dateDay(record.plannedEndAt.slice(0, 10)) - dateDay(record.date);
  if (span < 0 || span > 1) return false;
  if (["createdAt", "updatedAt"].some(key => record[key] !== undefined
    && record[key] !== "" && !validDateTime(record[key]))) return false;
  if (["completed", "deleted"].some(key => record[key] !== undefined && typeof record[key] !== "boolean")
    || (record.note !== undefined && typeof record.note !== "string")) return false;
  if (["seriesId", "occurrenceKey"].some(key => record[key] !== undefined && record[key] !== "")) return false;
  return record.overrides === undefined || (record.overrides !== null
    && typeof record.overrides === "object" && !Array.isArray(record.overrides)
    && Object.keys(record.overrides).length === 0);
}

export function mergeSingleSchedules(local, remote, { isValid = validSchedule } = {}) {
  if (!Array.isArray(local) || !Array.isArray(remote)) throw new TypeError("single-schedule-array-required");
  const badIds = new Set(), invalid = new Set(), keys = new Map();
  for (const list of [local, remote]) {
    const seen = new Map();
    for (const record of list) {
      const key = contentKey(record);
      keys.set(record, key);
      if (!isValid(record)) { invalid.add(record); if (record?.id) badIds.add(record.id); }
      if (record?.id && seen.has(record.id) && seen.get(record.id) !== key) badIds.add(record.id);
      if (record?.id) seen.set(record.id, key);
    }
  }
  const excluded = record => invalid.has(record) || badIds.has(record?.id);
  const preservedByKey = new Map();
  for (const record of [...local, ...remote]) {
    if (excluded(record)) preservedByKey.set(keys.get(record), record);
  }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const preserved = [...preservedByKey.values()].sort((a, b) =>
    compare(String(a?.id ?? ""), String(b?.id ?? "")) || compare(keys.get(a), keys.get(b)));
  const warnings = preserved.length ? [{ code: "invalid-records", count: preserved.length }] : [];
  const compareAt = record => record.updatedAt || record.createdAt || "";
  const records = mergeRecords(local.filter(record => !excluded(record)), remote.filter(record => !excluded(record)), {
    compareAt,
    tieBreak: (l, r) => {
      const winner = !!l.deleted !== !!r.deleted ? (r.deleted ? r : l) : l;
      if (keys.get(l) !== keys.get(r)) warnings.push({ code: "same-time-conflict", id: l.id,
        rule: !!l.deleted !== !!r.deleted ? "deleted-first" : "local-first", selected: winner === l ? "local" : "remote" });
      return winner;
    }
  }).sort((a, b) => compare(a.id, b.id));
  const uniqueWarnings = [...new Map(warnings.map(warning => [contentKey(warning), warning])).values()]
    .sort((a, b) => compare(contentKey(a), contentKey(b)));
  // recordsは同期用なので削除印も含む。占有の入口はdeletedだけを除外する。
  return { records, preserved, warnings: uniqueWarnings };
}
