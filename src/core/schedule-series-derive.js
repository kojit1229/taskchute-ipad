import { scheduleSeriesDates, normalizeSeriesTime } from "./schedule-series.js";
import { chooseSeriesChange, mergeSeriesOverrides, mergeScheduleSeries } from "./schedule-series-merge.js";
import { normalizeSingleSchedules } from "./single-schedule.js";

// Calendar arithmetic is UTC numeric arithmetic, independent of browser timezone.
function shiftDate(value, offset) {
  scheduleSeriesDates(value, { frequency: "daily", until: value });
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year + 400, month - 1, day + offset));
  const pad = n => String(n).padStart(2, "0");
  return `${String(date.getUTCFullYear() - 400).padStart(4, "0")}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
const earlier = (a, b) => !a ? b : !b ? a : a < b ? a : b;
const latest = stamps => stamps.filter(Boolean).reduce((time, stamp) => stamp.updatedAt > time ? stamp.updatedAt : time, "");
const intersects = (row, date, next) => !row.deleted && row.plannedStartAt < `${next}T00:00:00`
  && row.plannedEndAt > `${date}T00:00:00`;
const change = (value, source) => ({ value, updatedAt: source.updatedAt, changeId: source.changeId });

function seriesSetting(parent, field, key, date) {
  let winner = change(parent.creation.value.defaults[field], parent.creation);
  for (const revision of parent.revisions) {
    if (revision.effectiveFrom <= key && revision.effectiveFrom <= date && field in revision.changes)
      winner = chooseSeriesChange(winner, change(revision.changes[field], revision), field);
  }
  return winner;
}

function seriesPattern(parent, key) {
  let winner;
  for (const revision of parent.revisions) {
    if (revision.effectiveFrom <= key && revision.changes.pattern)
      winner = chooseSeriesChange(winner, change(revision.changes.pattern, revision));
  }
  return winner || change(parent.creation.value.pattern, parent.creation);
}

function occurs(parent, key) {
  return scheduleSeriesDates(parent.creation.value.anchorDate, seriesPattern(parent, key).value).includes(key);
}

function displayRow(parent, key, saved) {
  const overrides = saved?.overrides || {};
  const date = overrides.date && !overrides.date.cleared ? overrides.date.value : key;
  const applied = [parent.creation, parent.lifecycle, seriesPattern(parent, key), ...Object.values(overrides)];
  const value = field => {
    const setting = seriesSetting(parent, field, key, date);
    const winner = chooseSeriesChange(setting, overrides[field], field);
    applied.push(setting, winner);
    return winner.cleared ? setting.value : winner.value;
  };
  const title = value("title"), note = value("note"), time = normalizeSeriesTime(value("time"));
  const lifecycle = overrides.lifecycle?.value || { deleted: false };
  return { id: saved?.id || `schedule_${parent.id}_${key}`, seriesId: parent.id, occurrenceKey: key,
    title, date, plannedStartAt: `${date}T${time.startTime}`,
    plannedEndAt: `${time.endDayOffset ? shiftDate(date, 1) : date}T${time.endTime}`,
    note, completed: overrides.completion?.value.completed ?? false, deleted: lifecycle.deleted,
    createdAt: saved ? saved.createdAt : parent.createdAt, updatedAt: latest(applied),
    individuallyModified: !!saved && !occurs(parent, key) };
}

function parentRows(parent, allSaved, date, previous, next) {
  if (parent.lifecycle.value.deleted) return [];
  const saved = allSaved.filter(row => row.seriesId === parent.id);
  const anchor = parent.creation.value.anchorDate;
  const origin = saved.find(row => row.id === parent.originScheduleId);
  const counterpart = saved.find(row => row.id === `schedule_${parent.id}_${anchor}`);
  // Pair only in this view. The general row and its deletion never move in storage.
  const representative = origin && counterpart ? { ...origin,
    overrides: mergeSeriesOverrides(origin.overrides, counterpart.overrides),
    createdAt: earlier(origin.createdAt, counterpart.createdAt) } : origin;
  const candidates = new Map();
  for (const key of [previous, date]) {
    if (key < anchor || !occurs(parent, key)) continue;
    if (parent.originScheduleId && key === anchor) {
      if (representative) candidates.set(representative.id, { key: anchor, saved: representative });
    } else candidates.set(`schedule_${parent.id}_${key}`, { key });
  }
  for (const row of saved) {
    if (origin && row === counterpart) continue;
    const isOrigin = row === origin;
    candidates.set(row.id, { key: isOrigin ? anchor : row.occurrenceKey, saved: isOrigin ? representative : row });
  }
  return [...candidates.values()].map(item => displayRow(parent, item.key, item.saved))
    .filter(row => intersects(row, date, next));
}

// 04-style {records,warnings}. Output rows are for display/occupancy only and must
// never be submitted as saved series children. No state, persistence or clock IO.
export function schedulesWithSeriesForDate(snapshot, date) {
  const previous = shiftDate(date, -1), next = shiftDate(date, 1);
  const merged = mergeScheduleSeries(snapshot, {});
  const plain = normalizeSingleSchedules(merged.singleSchedules.filter(row => !row.seriesId));
  const records = plain.records.filter(row => intersects(row, date, next));
  for (const parent of merged.scheduleSeries)
    records.push(...parentRows(parent, merged.singleSchedules, date, previous, next));
  records.sort((a, b) => a.plannedStartAt < b.plannedStartAt ? -1 : a.plannedStartAt > b.plannedStartAt ? 1
    : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { records, warnings: [...merged.warnings, ...plain.warnings] };
}

export function deriveScheduleSeries(snapshot, date) {
  return schedulesWithSeriesForDate(snapshot, date).records.filter(row => row.seriesId);
}
