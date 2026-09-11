import { mergeRecords } from "./merge.js";
import { contentKey, mergeSingleSchedules, validSchedule } from "./single-schedule-merge.js";
import { normalizeSingleSchedules } from "./single-schedule.js";
import { createScheduleSeries } from "./schedule-series.js";

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const earlier = (a, b) => !a ? b : !b ? a : a < b ? a : b;
const latest = values => values.reduce((a, b) => a > (b || "") ? a : b || "", "");
const ordered = rows => rows.sort((a, b) => compare(a.id, b.id));
const fail = message => { throw new TypeError(`schedule-series-merge: ${message}`); };
const initial = stamp => stamp?.changeId?.startsWith("legacy:") && stamp.value?.deleted === false;

// One field's fixed order. No clock/request issuance, even for legacy candidates.
export function chooseSeriesChange(left, right, field = "") {
  if (!left || !right) return left || right;
  if (left.updatedAt === right.updatedAt && left.changeId === right.changeId
    && contentKey(left) !== contentKey(right)) fail("conflicting changeId");
  const rank = value => field === "lifecycle" && initial(value) ? 0 : 1;
  const cmp = (field === "lifecycle" ? compare(rank(left), rank(right)) : 0)
    || compare(left.updatedAt, right.updatedAt)
    || compare(!!left.value?.deleted, !!right.value?.deleted)
    || compare(!!left.cleared, !!right.cleared) || compare(left.changeId, right.changeId);
  return cmp >= 0 ? left : right;
}

function union(left, right, combine) {
  return ordered(mergeRecords(left, right, { compareAt: () => "", tieBreak: combine }));
}

export function mergeSeriesOverrides(left = {}, right = {}) {
  return Object.fromEntries([...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    .map(field => [field, chooseSeriesChange(left[field], right[field], field)]));
}

// The 04 defaults and ALL unknown fields participate in the full UTF-8 legacy id.
export function legacySeriesOccurrence(single, parent) {
  if (!validSchedule(single) || (single.formatVersion !== undefined && single.formatVersion !== 1)
    || single.id !== parent.originScheduleId) fail("invalid origin single");
  const row = normalizeSingleSchedules([single]).records[0];
  const changeId = "legacy:" + Array.from(new TextEncoder().encode(contentKey(row)),
    byte => byte.toString(16).padStart(2, "0")).join("");
  const stamp = { updatedAt: row.updatedAt, changeId };
  const values = { title: row.title, date: row.date, time: {
    startTime: row.plannedStartAt.slice(11), endTime: row.plannedEndAt.slice(11),
    endDayOffset: row.plannedEndAt.slice(0, 10) === row.date ? 0 : 1 }, note: row.note,
  completion: { completed: row.completed }, lifecycle: { deleted: row.deleted } };
  const known = new Set(["id", "title", "date", "plannedStartAt", "plannedEndAt", "note", "completed",
    "deleted", "createdAt", "updatedAt", "seriesId", "occurrenceKey", "overrides", "formatVersion"]);
  const extras = Object.fromEntries(Object.entries(row).filter(([key]) => !known.has(key)));
  return { id: row.id, seriesId: parent.id, occurrenceKey: row.date, formatVersion: 1,
    overrides: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, ...stamp }])),
    legacyExtras: { value: extras, ...stamp }, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

// R2-02's transitional child overwrites updatedAt; use the untouched input here.
export function createSeriesMergeCandidate(input) {
  const candidate = createScheduleSeries(input);
  if (input.originSchedule) candidate.singleSchedules = [legacySeriesOccurrence(input.originSchedule, candidate.scheduleSeries[0])];
  return candidate;
}

function parentPair(left, right) {
  if (left.originScheduleId !== right.originScheduleId) fail("origin identity");
  const creation = chooseSeriesChange(left.creation, right.creation);
  const revisions = union(left.revisions, right.revisions, (a, b) => {
    if (contentKey(a) !== contentKey(b)) fail("conflicting revision id");
    return a;
  });
  const lifecycle = chooseSeriesChange(left.lifecycle, right.lifecycle, "lifecycle");
  return { ...left, creation, revisions, lifecycle, createdAt: earlier(left.createdAt, right.createdAt),
    updatedAt: latest([creation.updatedAt, lifecycle.updatedAt, ...revisions.map(row => row.updatedAt)]),
    deleted: lifecycle.value.deleted };
}

function childPair(left, right) {
  if (left.seriesId !== right.seriesId) fail("series identity");
  const overrides = mergeSeriesOverrides(left.overrides, right.overrides);
  const legacyExtras = chooseSeriesChange(left.legacyExtras, right.legacyExtras, "legacyExtras");
  return { id: left.id, seriesId: left.seriesId, formatVersion: 1,
    occurrenceKey: earlier(left.occurrenceKey, right.occurrenceKey), overrides,
    ...(legacyExtras ? { legacyExtras } : {}), createdAt: earlier(left.createdAt, right.createdAt),
    updatedAt: latest([...Object.values(overrides), legacyExtras].filter(Boolean).map(row => row.updatedAt)) };
}

function checked(rows, kind) {
  if (!Array.isArray(rows)) fail(`${kind} array required`);
  for (const row of rows) {
    if (!row?.id || row.formatVersion !== 1) fail(`${kind} format`);
    if (kind === "parent" && (!row.creation || !row.lifecycle || !Array.isArray(row.revisions))) fail("parent fields");
    if (kind === "child" && (!row.seriesId || !row.occurrenceKey || !row.overrides
      || ["title", "date", "plannedStartAt", "plannedEndAt", "note", "completed", "deleted"].some(key => key in row)))
      fail("transitional or invalid child; supply original single to createSeriesMergeCandidate");
  }
  return rows;
}

// Validated candidates only. Invalid input throws without altering either input;
// the later sync boundary owns verbatim preservation/quarantine.
export function mergeScheduleSeries(local, remote) {
  const parents = [...checked(local.scheduleSeries ?? [], "parent"), ...checked(remote.scheduleSeries ?? [], "parent")];
  const scheduleSeries = parents.reduce((rows, row) => union(rows, [row], parentPair), [])
    .map(row => parentPair(row, row));
  const byOrigin = new Map(scheduleSeries.filter(row => row.originScheduleId).map(row => [row.originScheduleId, row]));
  const byId = new Map(scheduleSeries.map(row => [row.id, row]));
  const split = source => {
    if (!Array.isArray(source)) fail("singleSchedules array required");
    const children = [], singles = [];
    for (const row of source) {
      if (row?.seriesId) {
        checked([row], "child");
        const parent = byId.get(row.seriesId);
        if (!parent || (row.id !== parent.originScheduleId && row.id !== `schedule_${row.seriesId}_${row.occurrenceKey}`)) fail("child identity");
        children.push(row);
      } else if (byOrigin.has(row?.id)) children.push(legacySeriesOccurrence(row, byOrigin.get(row.id)));
      else singles.push(row);
    }
    return { children, singles };
  };
  const left = split(local.singleSchedules ?? []), right = split(remote.singleSchedules ?? []);
  const children = [...left.children, ...right.children].reduce((rows, row) => union(rows, [row], childPair), [])
    .map(row => childPair(row, row));
  const singles = mergeSingleSchedules(left.singles, right.singles);
  return { scheduleSeries, singleSchedules: ordered([...children, ...singles.records, ...singles.preserved]), warnings: singles.warnings };
}
