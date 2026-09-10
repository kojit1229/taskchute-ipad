const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const early = "2026-09-10T09:00:00", late = "2026-09-10T10:00:00";
const schedule = (id = "x", extra = {}) => ({ id, title: "fixture", date: "2026-09-10",
  plannedStartAt: early, plannedEndAt: late, completed: false, note: "", deleted: false,
  createdAt: early, updatedAt: early, seriesId: "", occurrenceKey: "", overrides: {}, ...extra });
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS ${name}`); }

(async () => {
  const { mergeSingleSchedules: merge } = await import(pathToFileURL(path.join(__dirname,
    "../src/core/single-schedule-merge.js")).href);
  const cases = [
    ["newer remote", { updatedAt: early }, { updatedAt: late }, "remote"],
    ["newer local", { updatedAt: late }, { updatedAt: early }, "local"],
    ["createdAt fallback", { updatedAt: "", createdAt: early }, { updatedAt: "", createdAt: late }, "remote"],
    ["missing updatedAt", { updatedAt: undefined, createdAt: late }, { updatedAt: undefined }, "local"],
    ["updatedAt first", { updatedAt: early, createdAt: late }, { updatedAt: late }, "remote"],
    ["both empty", { updatedAt: "", createdAt: "" }, { updatedAt: "", createdAt: "" }, "local"],
    ["both missing", { updatedAt: undefined, createdAt: undefined }, { updatedAt: undefined, createdAt: undefined }, "local"],
    ["same time edit", {}, {}, "local"],
    ["remote deletion", {}, { deleted: true }, "remote"],
    ["local deletion", { deleted: true }, {}, "local"],
    ["both deleted", { deleted: true }, { deleted: true }, "local"],
    ["later edit revives", { deleted: true }, { updatedAt: late }, "remote"],
    ["older deletion loses", { updatedAt: late }, { deleted: true }, "local"]
  ];
  for (const [name, l, r, winner] of cases) check(name, () => {
    const local = freeze(schedule("x", { ...l, note: "local", extra: { nested: [1, 2] } }));
    const remote = freeze(schedule("x", { ...r, note: "remote", extra: { nested: [3] } }));
    const inputs = freeze([[local], [remote]]), before = JSON.stringify(inputs);
    const result = merge(...inputs);
    assert.strictEqual(result.records[0], winner === "local" ? local : remote);
    assert.deepEqual(result.preserved, []);
    assert.equal(JSON.stringify(inputs), before);
    const again = merge(result.records, inputs[1]);
    assert.deepEqual(again.records, result.records, "same-input remerge preserves merged content");
    assert.deepEqual(again.preserved, result.preserved);
    assert.deepEqual(merge(inputs[0], result.records).records, result.records);
    assert.deepEqual(merge(result.records, result.records).records, result.records);
  });
  check("normal id union, stable order, completed occupancy and deletion retention", () => {
    const a = schedule("a", { completed: true }), b = schedule("b"), tomb = schedule("c", { deleted: true });
    const result = merge([tomb, b], [a]);
    assert.deepEqual(result.records, [a, b, tomb]);
    assert.deepEqual(result.records.filter(record => !record.deleted), [a, b]);
    assert.deepEqual(merge([a], [b, tomb]), result);
  });
  check("equal-time edits keep each device's whole record in both directions", () => {
    const a = schedule("x", { title: "device-a", plannedEndAt: "2026-09-10T11:00:00" });
    const b = schedule("x", { title: "device-b", note: "remote-note" });
    for (const [local, remote] of [[a, b], [b, a]]) {
      const result = merge([local], [remote]);
      assert.strictEqual(result.records[0], local);
      assert.deepEqual(result.warnings, [{ code: "same-time-conflict", id: "x", rule: "local-first", selected: "local" }]);
      assert.equal(result.records[0].updatedAt, early);
    }
  });
  check("newer content and equal-time deletion converge in both directions and after pull", () => {
    for (const winner of [schedule("x", { updatedAt: late, title: "new" }), schedule("x", { deleted: true })]) {
      const older = schedule("x");
      const a = merge([older], [winner]), b = merge([winner], [older]);
      assert.deepEqual(a.records, b.records);
      assert.strictEqual(a.records[0], winner);
      assert.deepEqual(merge([older], a.records).records, b.records);
      assert.deepEqual(merge([winner], b.records).records, a.records);
    }
  });
  check("identical resends deduplicate and key order does not imply a conflict", () => {
    const a = schedule("x", { extra: { b: 2, a: { z: 1, y: [2, 1] } } });
    const b = { ...a, extra: { a: { y: [2, 1], z: 1 }, b: 2 } };
    const result = merge([a, b], [b, a]);
    assert.deepEqual(result, { records: [b], preserved: [], warnings: [] });
  });
  const badRecords = [null, false, 7, "bad", [], {}, schedule(""), schedule("x", { id: 42 }),
    schedule("x", { title: "  " }), schedule("x", { title: 7 }),
    schedule("x", { plannedStartAt: "2026-02-30T09:00:00", date: "2026-02-30" }),
    schedule("x", { plannedStartAt: "2026-09-10T24:00:00" }),
    schedule("x", { plannedStartAt: "2026-09-10 09:00:00" }),
    schedule("x", { plannedEndAt: early }), schedule("x", { plannedEndAt: "2026-09-10T08:00:00" }),
    schedule("x", { plannedEndAt: "2026-09-12T00:00:00" }),
    schedule("x", { plannedEndAt: "2026-09-10T10:60:00" }),
    schedule("x", { date: "2026-09-09" }), schedule("x", { updatedAt: "broken" }),
    schedule("x", { createdAt: null }), schedule("x", { deleted: "false" }),
    schedule("x", { completed: 1 }), schedule("x", { note: {} }),
    schedule("x", { seriesId: "future" }), schedule("x", { occurrenceKey: "2026-09-10" }),
    schedule("x", { overrides: { title: "future" } }), schedule("x", { overrides: [] }),
    schedule("x", { overrides: null })];
  badRecords.forEach((bad, index) => check(`invalid record ${index}: retain raw and isolate occupancy`, () => {
    freeze(bad);
    const good = freeze(schedule("normal"));
    for (const [local, remote] of [[[bad], [good]], [[good], [bad]]]) {
      const result = merge(freeze(local), freeze(remote));
      assert.deepEqual(result.records, [good]);
      assert.deepEqual(result.preserved, [bad]);
      assert.strictEqual(result.preserved[0], bad);
      assert.deepEqual(result.warnings, [{ code: "invalid-records", count: 1 }]);
      assert.deepEqual(merge([...result.records, ...result.preserved], remote), result);
    }
  }));
  check("one invalid side preserves every valid candidate with the same id", () => {
    const valid = schedule("x"), bad = schedule("x", { plannedEndAt: "bad", note: "secret-text" });
    const good = schedule("good"), newer = schedule("x", { updatedAt: late });
    const a = merge([valid, newer, good], [bad]);
    const b = merge([bad], [newer, valid, good]);
    assert.deepEqual(a, b);
    assert.deepEqual(a.records, [good]);
    assert.equal(a.preserved.length, 3);
    for (const record of [bad, valid, newer]) assert.ok(a.preserved.includes(record));
    assert.deepEqual(merge([...a.records, ...a.preserved], [bad]), a);
    assert.ok(!JSON.stringify(a.warnings).includes("secret-text"));
  });
  check("conflicting duplicate ids within either array are preserved regardless of timestamps", () => {
    const a = schedule("x"), b = schedule("x", { updatedAt: late }), c = schedule("ok");
    const expected = merge([a, b, c], []);
    assert.deepEqual(expected.records, [c]);
    assert.equal(expected.preserved.length, 2);
    for (const inputs of [[[], [b, a, c]], [[a, b], [c]], [[c], [b, a]], [[a, b, a], [a, c]]]) {
      assert.deepEqual(merge(...inputs), expected);
    }
    assert.deepEqual(merge([...expected.records, ...expected.preserved], [a, b]), expected);
  });
  check("preserved JSON union uses deep sorted keys and preserves distinct array order", () => {
    const a = { id: "x", extra: { b: 2, a: [1, 2] } };
    const same = { extra: { a: [1, 2], b: 2 }, id: "x" };
    const distinct = { ...a, extra: { b: 2, a: [2, 1] } };
    const result = merge([a, null, distinct], [same, null, distinct]);
    assert.equal(result.preserved.length, 3);
    assert.deepEqual(merge([same, null, distinct], [distinct, a, null]), result);
    assert.deepEqual(merge(result.preserved, result.preserved), result);
    assert.deepEqual(result.records, []);
  });
  check("valid leap dates, next-day and year boundary remain unchanged", () => {
    for (const [start, end] of [["2024-02-29T23:00:00", "2024-03-01T23:59:59"],
      ["2026-12-31T23:00:00", "2027-01-01T00:00:00"], ["2000-02-29T00:00:00", "2000-02-29T01:00:00"]]) {
      const record = schedule("x", { date: start.slice(0, 10), plannedStartAt: start, plannedEndAt: end });
      assert.deepEqual(merge([record], []), { records: [record], preserved: [], warnings: [] });
    }
    const invalid = schedule("x", { date: "1900-02-29", plannedStartAt: "1900-02-29T00:00:00" });
    assert.deepEqual(merge([invalid], []).preserved, [invalid]);
  });
  check("optional defaults need no mutation and unknown fields survive", () => {
    const record = freeze({ id: "minimum", title: "fixture", date: "2026-09-10", plannedStartAt: early,
      plannedEndAt: late, unknown: { future: [1, 2] } });
    assert.strictEqual(merge([record], []).records[0], record);
    assert.deepEqual(merge([], []), { records: [], preserved: [], warnings: [] });
  });
  check("malformed containers stop adoption instead of becoming a successful empty list", () => {
    for (const bad of [undefined, null, false, {}, "[]"]) {
      assert.throws(() => merge(bad, []), /single-schedule-array-required/);
      assert.throws(() => merge([], bad), /single-schedule-array-required/);
    }
  });
  check("validation boundary is injectable and failures propagate without logging content", () => {
    const record = schedule("x");
    assert.deepEqual(merge([record], [], { isValid: () => false }).preserved, [record]);
    assert.throws(() => merge([record], [], { isValid() { throw new Error("injected validation failure"); } }),
      /injected validation failure/);
  });
  console.log(`single-schedule-merge: ${checks} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
