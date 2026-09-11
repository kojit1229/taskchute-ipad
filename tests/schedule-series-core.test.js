// 114b / R2-02: pure series model, finite calendar range, candidate counts and fingerprints.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = path.join(__dirname, "..");
let count = 0;
function test(name, run) { run(); count++; console.log(`PASS ${name}`); }
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const input = () => ({ id: "11111111-1111-4111-8111-111111111111", anchorDate: "2026-09-08",
  pattern: { frequency: "daily", until: "2026-09-14" },
  defaults: { title: "朝の読書", time: { startTime: "09:00", endTime: "09:30", endDayOffset: 0 }, note: "元の\nメモ " },
  changeId: "22222222-2222-4222-8222-222222222222", createdAt: "2026-09-08T08:00:00", updatedAt: "2026-09-08T08:00:01" });
const single = () => ({ id: "legacy-1", title: "夜の読書", date: "2026-09-08",
  plannedStartAt: "2026-09-08T23:30:00", plannedEndAt: "2026-09-09T00:00:00", note: "そのまま",
  completed: true, createdAt: "2026-09-01T10:00:00", updatedAt: "2026-09-07T10:00:00", extra: { tags: ["b", "a"] } });

(async () => {
  const { scheduleSeriesDates: dates, normalizeSeriesTime: time, createScheduleSeries: create,
    scheduleSeriesFingerprint: fingerprint } = await import(pathToFileURL(path.join(root, "src/core/schedule-series.js")).href);
  test("September 8-14 daily / weekdays / weekly = 7 / 5 / 1; inclusive 15th = 2", () => {
    const expected = {
      daily: ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"],
      weekdays: ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14"], weekly: ["2026-09-08"]
    };
    for (const frequency of Object.keys(expected)) assert.deepEqual(dates("2026-09-08", { frequency, until: "2026-09-14" }), expected[frequency]);
    assert.deepEqual(dates("2026-09-08", { frequency: "weekly", until: "2026-09-15" }), ["2026-09-08", "2026-09-15"]);
  });
  test("366 days ahead accepted (367 dates); 367 days ahead and reversed range rejected", () => {
    const result = dates("2026-09-08", { frequency: "daily", until: "2027-09-09" });
    assert.equal(result.length, 367); assert.equal(result.at(-1), "2027-09-09");
    assert.throws(() => dates("2026-09-08", { frequency: "daily", until: "2027-09-10" }), /range/);
    assert.throws(() => dates("2026-09-08", { frequency: "daily", until: "2026-09-07" }), /range/);
  });
  test("same day, weekend, leap year, century, year change and years below 100", () => {
    assert.deepEqual(dates("2026-09-12", { frequency: "weekdays", until: "2026-09-13" }), []);
    assert.deepEqual(dates("2026-09-12", { frequency: "weekly", until: "2026-09-12" }), ["2026-09-12"]);
    assert.deepEqual(dates("2028-02-28", { frequency: "daily", until: "2028-03-01" }), ["2028-02-28", "2028-02-29", "2028-03-01"]);
    assert.equal(dates("2000-02-28", { frequency: "daily", until: "2000-03-01" }).length, 3);
    assert.equal(dates("2100-02-28", { frequency: "daily", until: "2100-03-01" }).length, 2);
    assert.deepEqual(dates("2026-12-31", { frequency: "daily", until: "2027-01-01" }), ["2026-12-31", "2027-01-01"]);
    for (const date of ["0001-01-01", "0099-12-31", "9999-12-31"]) assert.deepEqual(dates(date, { frequency: "daily", until: date }), [date]);
  });
  test("invalid dates, absent end date and unsupported frequency are rejected", () => {
    for (const value of ["2026-02-29", "2100-02-29", "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00",
      "0000-01-01", "2026-9-08", "2026-09-08T00:00", "2026-09-08Z", null, 20260908, ""]) {
      assert.throws(() => dates(value, { frequency: "daily", until: "2026-09-14" }), TypeError);
      assert.throws(() => dates("2026-09-08", { frequency: "daily", until: value }), TypeError);
    }
    for (const pattern of [{ frequency: "daily" }, { frequency: "monthly", until: "2026-09-14" }, null])
      assert.throws(() => dates("2026-09-08", pattern), TypeError);
  });
  test("time is second-normalized; midnight uses next-day offset", () => {
    assert.deepEqual(time({ startTime: "09:00", endTime: "09:30", endDayOffset: 0 }), { startTime: "09:00:00", endTime: "09:30:00", endDayOffset: 0 });
    assert.deepEqual(time({ startTime: "23:30", endTime: "00:00", endDayOffset: 1 }), { startTime: "23:30:00", endTime: "00:00:00", endDayOffset: 1 });
    for (const value of [{ startTime: "09:00", endTime: "09:00", endDayOffset: 0 },
      { startTime: "09:30", endTime: "09:00", endDayOffset: 0 }, { startTime: "09:00", endTime: "24:00", endDayOffset: 1 },
      { startTime: "9:00", endTime: "10:00", endDayOffset: 0 }, { startTime: "09:00:60", endTime: "10:00", endDayOffset: 0 },
      ...[2, -1, "1", null].map(endDayOffset => ({ startTime: "09:00", endTime: "10:00", endDayOffset }))])
      assert.throws(() => time(value), TypeError);
  });
  test("direct creation: parent 1, child 0; caller's request id and clocks retained", () => {
    const data = freeze(input()), before = JSON.stringify(data), result = create(data), parent = result.scheduleSeries[0];
    assert.equal(result.scheduleSeries.length, 1); assert.deepEqual(result.singleSchedules, []);
    assert.equal(parent.id, data.id); assert.equal(parent.formatVersion, 1); assert.equal(parent.originScheduleId, "");
    assert.deepEqual(parent.revisions, []); assert.equal(parent.creation.value.anchorDate, data.anchorDate);
    assert.equal(parent.creation.value.defaults.time.startTime, "09:00:00");
    assert.equal(parent.creation.changeId, data.changeId); assert.equal(parent.lifecycle.changeId, data.changeId);
    assert.equal(parent.createdAt, data.createdAt); assert.equal(parent.updatedAt, data.updatedAt);
    assert.deepEqual(parent.lifecycle.value, { deleted: false }); assert.equal(parent.deleted, false);
    dates(parent.creation.value.anchorDate, parent.creation.value.pattern);
    assert.deepEqual(result.singleSchedules, [], "enumeration must not save any occurrences");
    assert.equal(JSON.stringify(data), before);
  });
  test("conversion: deterministic parent 1 / original child 1, overnight data retained", () => {
    const data = input(); delete data.defaults; delete data.id; data.originSchedule = single();
    const before = JSON.stringify(data), result = create(freeze(data)), parent = result.scheduleSeries[0], child = result.singleSchedules[0];
    assert.equal(result.scheduleSeries.length, 1); assert.equal(result.singleSchedules.length, 1);
    assert.equal(parent.id, "series_legacy-1"); assert.equal(parent.originScheduleId, "legacy-1");
    assert.equal(parent.creation.value.defaults.time.endDayOffset, 1);
    assert.equal(parent.creation.value.defaults.time.endTime, "00:00:00");
    assert.deepEqual(child, { ...single(), seriesId: "series_legacy-1", occurrenceKey: "2026-09-08", overrides: {}, updatedAt: data.updatedAt });
    assert.equal(child.completed, true); assert.equal(child.createdAt, data.originSchedule.createdAt);
    assert.equal(JSON.stringify(data), before); assert.deepEqual(create(data), result, "same request is deterministic");
    assert.notEqual(child.extra, data.originSchedule.extra, "candidate has no shared mutable input objects");
  });
  test("conversion rejects deleted/invalid sources and conflicting anchor/defaults", () => {
    for (const origin of [false, "", [], {}, { ...single(), deleted: true }, { ...single(), seriesId: "already" }]) {
      const data = input(); delete data.defaults; data.originSchedule = origin;
      assert.throws(() => create(data), TypeError);
    }
    const data = input(); delete data.defaults; data.originSchedule = single(); data.anchorDate = "2026-09-09";
    assert.throws(() => create(data), /anchor/);
    assert.throws(() => create({ ...input(), originSchedule: single() }), /defaults/);
  });
  test("creation rejects bad UUIDs, clocks, title, note and out-of-range pattern", () => {
    for (const change of [{ id: "not-a-uuid" }, { changeId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
      { createdAt: "2026-02-30T10:00:00" }, { updatedAt: "2026-09-08T08:00:00Z" },
      { defaults: { ...input().defaults, title: "  " } }, { defaults: { ...input().defaults, note: null } },
      { pattern: { frequency: "daily", until: "2027-09-10" } }]) assert.throws(() => create({ ...input(), ...change }), TypeError);
  });
  test("fingerprint ignores object keys, known set order and minute/second spelling", () => {
    const a = create(input()), parent = a.scheduleSeries[0];
    const revision = (id, title) => ({ id, effectiveFrom: "2026-09-10", changes: { title, time: input().defaults.time, note: "" },
      updatedAt: "2026-09-09T08:00", changeId: id });
    parent.revisions = [revision("b", "後"), revision("a", "前")];
    a.scheduleSeries.push({ ...structuredClone(parent), id: "other" });
    a.singleSchedules = [single(), { ...single(), id: "another" }];
    const b = structuredClone(a); b.scheduleSeries.reverse(); b.singleSchedules.reverse();
    for (const series of b.scheduleSeries) { series.revisions.reverse(); series.creation.updatedAt = "2026-09-08T08:00:01";
      series.creation.value.defaults.time.startTime = "09:00"; }
    const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)])) : value;
    assert.equal(fingerprint(freeze(a)), fingerprint(reverseKeys(b)));
    assert.equal(fingerprint(a), fingerprint(a), "stable across calls");
  });
  test("fingerprint fills only allowed single defaults; null/absence/unknown data remain distinct", () => {
    const row = single(), a = { singleSchedules: [row] }, b = structuredClone(a);
    Object.assign(b.singleSchedules[0], { deleted: false, seriesId: "", occurrenceKey: "", overrides: {} });
    assert.equal(fingerprint(a), fingerprint(b));
    delete row.note; delete row.completed; delete row.createdAt; delete row.updatedAt;
    const c = structuredClone(a); Object.assign(c.singleSchedules[0], { note: "", completed: false, createdAt: "", updatedAt: "" });
    assert.equal(fingerprint(a), fingerprint(c));
    c.singleSchedules[0].note = null; assert.notEqual(fingerprint(a), fingerprint(c));
    assert.notEqual(fingerprint({}), fingerprint({ singleSchedules: [] }));
    const d = structuredClone(a); d.singleSchedules[0].extra.tags.reverse(); assert.notEqual(fingerprint(a), fingerprint(d));
  });
  test("fingerprint detects all meaningful edits and preserves ordinary text/array order", () => {
    const original = create(input()), base = fingerprint(original);
    for (const modify of [s => s.creation.value.defaults.title += " ", s => s.creation.value.defaults.note += "\n",
      s => s.creation.value.defaults.time.startTime = "09:05", s => s.creation.value.pattern.until = "2026-09-15",
      s => s.creation.value.pattern.frequency = "weekly", s => s.deleted = true,
      s => s.extra = null, s => s.extra = [1, 2], s => s.lifecycle.value.deleted = true]) {
      const changed = structuredClone(original); modify(changed.scheduleSeries[0]); assert.notEqual(base, fingerprint(changed));
    }
    assert.notEqual(fingerprint({ extra: [1, 2] }), fingerprint({ extra: [2, 1] }));
    assert.notEqual(fingerprint({ extra: "é" }), fingerprint({ extra: "e\u0301" }));
    assert.notEqual(fingerprint(original), fingerprint({ ...original, singleSchedules: [single()] }));
  });
  test("non-JSON values and unknown format versions fail explicitly", () => {
    const cycle = {}; cycle.self = cycle;
    for (const extra of [undefined, NaN, Infinity, 1n, () => 1, Symbol("x"), new Date(0), cycle, Array(2)])
      assert.throws(() => fingerprint({ extra }), TypeError);
    const unknown = create(input()); unknown.scheduleSeries[0].formatVersion = 2;
    assert.throws(() => fingerprint(unknown), /formatVersion/);
    assert.throws(() => fingerprint({ extra: { [Symbol("x")]: 1 } }), TypeError);
  });
  test("module is in APP_SHELL and impact mapping includes its exact suite", () => {
    const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
    assert.ok(sw.includes('"./src/core/schedule-series.js"'));
    const mapping = JSON.parse(fs.readFileSync(path.join(root, "tests/impact-regression-map.json"), "utf8"));
    const rows = Object.values(mapping).flatMap(value => value && typeof value === "object" ? Object.values(value) : []);
    assert.ok(rows.some(row => row?.paths?.some(pattern => new RegExp(pattern).test("src/core/schedule-series.js"))
      && row.suites.includes("schedule-series-core")));
  });
  console.log(`${count}/${count} passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
