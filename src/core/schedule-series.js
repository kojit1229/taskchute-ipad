import { isValidSingleSchedule } from "./single-schedule.js";
import { contentKey } from "./single-schedule-merge.js";

const DAY_MS = 86400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const requireValue = (ok, field) => { if (!ok) throw new TypeError(`schedule-series: ${field}`); };
function dateDay(value) {
  const match = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  requireValue(match, "date");
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year + 400, month - 1, day));
  requireValue(year >= 1 && date.getUTCFullYear() === year + 400
    && date.getUTCMonth() === month - 1 && date.getUTCDate() === day, "date");
  return date.getTime() / DAY_MS;
}
function dateAt(day) {
  const date = new Date(day * DAY_MS), pad = n => String(n).padStart(2, "0");
  return `${String(date.getUTCFullYear() - 400).padStart(4, "0")}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
function clock(value) {
  requireValue(typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value), "time");
  return value.length === 5 ? `${value}:00` : value;
}
function dateTime(value) {
  requireValue(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value), "datetime");
  dateDay(value.slice(0, 10));
  return `${value.slice(0, 11)}${clock(value.slice(11))}`;
}

export function normalizeSeriesTime(value) {
  requireValue(value && (value.endDayOffset === 0 || value.endDayOffset === 1), "endDayOffset");
  const startTime = clock(value.startTime), endTime = clock(value.endTime);
  requireValue(value.endDayOffset === 1 || endTime > startTime, "end after start");
  return { ...value, startTime, endTime };
}

// The inclusive 367-date maximum bounds calculation, never the number of saved children.
export function scheduleSeriesDates(anchorDate, pattern) {
  const first = dateDay(anchorDate), last = dateDay(pattern?.until);
  requireValue(["daily", "weekdays", "weekly"].includes(pattern.frequency), "frequency");
  requireValue(last >= first && last - first <= 366, "range");
  const dates = [];
  for (let day = first; day <= last; day++) {
    const weekday = new Date(day * DAY_MS).getUTCDay();
    if (pattern.frequency === "daily" || (pattern.frequency === "weekdays" && weekday > 0 && weekday < 6)
      || (pattern.frequency === "weekly" && (day - first) % 7 === 0)) dates.push(dateAt(day));
  }
  return dates;
}

// Types are explicit so unknown fields, including arrays, keep their original meaning.
const FIELDS = {
  snapshot: { scheduleSeries: "series[]", singleSchedules: "schedule[]" },
  series: { creation: "creation", revisions: "revision[]", lifecycle: "stamp", createdAt: "datetime", updatedAt: "datetime" },
  creation: { value: "settings", updatedAt: "datetime" },
  settings: { anchorDate: "date", pattern: "pattern", defaults: "defaults" },
  pattern: { until: "date" },
  defaults: { time: "time", pattern: "pattern" },
  time: { startTime: "clock", endTime: "clock" },
  revision: { effectiveFrom: "date", changes: "defaults", updatedAt: "datetime" },
  stamp: { updatedAt: "datetime" },
  schedule: { date: "date", plannedStartAt: "datetime", plannedEndAt: "datetime",
    createdAt: "optionalDatetime", updatedAt: "optionalDatetime" }
};
const SINGLE_DEFAULTS = { completed: false, note: "", createdAt: "", updatedAt: "", deleted: false,
  seriesId: "", occurrenceKey: "", overrides: {} };
function normalizedJson(value, type = "", parents = new Set()) {
  if (type === "clock") return clock(value);
  if (type === "datetime" || (type === "optionalDatetime" && value !== "")) return dateTime(value);
  if (type === "date") { dateDay(value); return value; }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { requireValue(Number.isFinite(value), "finite JSON number"); return value; }
  requireValue(value && typeof value === "object" && !parents.has(value), "JSON value or cycle");
  requireValue(!Object.getOwnPropertySymbols(value).length, "JSON symbols");
  parents.add(value);
  let result;
  if (Array.isArray(value)) {
    requireValue(Object.keys(value).length === value.length
      && Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean), "dense JSON array");
    result = value.map(item => normalizedJson(item, type.endsWith("[]") ? type.slice(0, -2) : "", parents));
    if (type.endsWith("[]")) result.sort((a, b) => {
      const left = [String(a?.id ?? ""), contentKey(a)], right = [String(b?.id ?? ""), contentKey(b)];
      return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0;
    });
  } else {
    requireValue(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, "plain JSON object");
    if (type === "series") requireValue(value.formatVersion === 1, "formatVersion");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    requireValue(Object.values(descriptors).every(d => d.enumerable && Object.hasOwn(d, "value")), "JSON properties");
    const entries = Object.keys(value).map(key => [key, normalizedJson(value[key], FIELDS[type]?.[key] || "", parents)]);
    result = Object.fromEntries(entries);
    if (type === "schedule") for (const [key, fallback] of Object.entries(SINGLE_DEFAULTS))
      if (!Object.hasOwn(result, key)) result[key] = normalizedJson(fallback);
  }
  parents.delete(value);
  return result;
}

// Snapshot input: {scheduleSeries, singleSchedules, ...otherComparisonFields}.
// Only schema-defined sets are reordered. This is the full comparison text, not a hash.
export function scheduleSeriesFingerprint(snapshot) {
  return contentKey(normalizedJson(snapshot, "snapshot"));
}

// Returns candidates only. The caller supplies one request id and both clocks;
// commitCandidate will own persistence. Revisions start empty and are append-only later.
export function createScheduleSeries(input) {
  const data = normalizedJson(input), origin = data.originSchedule ?? null;
  requireValue(UUID.test(data.changeId), "changeId");
  const createdAt = dateTime(data.createdAt), updatedAt = dateTime(data.updatedAt);
  requireValue(origin === null || (isValidSingleSchedule(origin) && !origin.deleted), "originSchedule");
  const anchorDate = origin ? origin.date : data.anchorDate;
  requireValue(!origin || data.anchorDate === undefined || data.anchorDate === anchorDate, "origin anchor");
  const id = origin ? `series_${origin.id}` : data.id;
  requireValue(origin || UUID.test(id), "id");
  const defaults = origin ? { title: origin.title, note: origin.note ?? "", time: {
    startTime: origin.plannedStartAt.slice(11), endTime: origin.plannedEndAt.slice(11),
    endDayOffset: dateDay(origin.plannedEndAt.slice(0, 10)) - dateDay(origin.date) } } : data.defaults;
  requireValue(defaults && typeof defaults.title === "string" && defaults.title.trim()
    && typeof defaults.note === "string", "defaults");
  const normalizedDefaults = { ...defaults, time: normalizeSeriesTime(defaults.time) };
  requireValue(!origin || data.defaults === undefined
    || contentKey({ ...data.defaults, time: normalizeSeriesTime(data.defaults.time) }) === contentKey(normalizedDefaults), "origin defaults");
  scheduleSeriesDates(anchorDate, data.pattern);
  const stamp = { updatedAt, changeId: data.changeId };
  const series = { id, formatVersion: 1, originScheduleId: origin?.id || "",
    creation: { value: { anchorDate, pattern: data.pattern, defaults: normalizedDefaults }, ...stamp },
    revisions: [], lifecycle: { value: { deleted: false }, ...stamp }, createdAt, updatedAt, deleted: false };
  const singleSchedules = origin ? [{ ...origin, seriesId: id, occurrenceKey: anchorDate, overrides: {}, updatedAt }] : [];
  return { scheduleSeries: [series], singleSchedules };
}
