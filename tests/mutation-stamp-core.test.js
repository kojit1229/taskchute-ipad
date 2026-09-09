// Pure mutation stamps for sync-storage: injected clocks, calendar validation and immutable records.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const acorn = require("acorn");
const modulePath = path.join(__dirname, "../src/core/mutation-stamp.js");
const api = () => import(pathToFileURL(modulePath).href);
const NOW = "2026-09-09T10:00:00";

for (const scope of ["global", "record"]) {
  test(`${scope}: same second and repeated edits advance exactly one second`, async () => {
    const { nextMutationStamp } = await api();
    const first = nextMutationStamp({ now: NOW, candidates: [NOW] });
    assert.equal(first, "2026-09-09T10:00:01");
    assert.equal(nextMutationStamp({ now: NOW, candidates: [first] }), "2026-09-09T10:00:02");
  });
}

test("real clock is also advanced when newer than every candidate", async () => {
  const { nextMutationStamp } = await api();
  assert.equal(nextMutationStamp({ now: NOW, candidates: ["2026-09-08T23:59:59"] }), "2026-09-09T10:00:01");
});

test("future clocks have no 300-second or long-term cutoff; only supplied records count", async () => {
  const { nextMutationStamp } = await api();
  for (const [candidate, expected] of [
    ["2026-09-09T10:05:00", "2026-09-09T10:05:01"],
    ["2026-09-09T10:05:01", "2026-09-09T10:05:02"],
    ["2400-02-29T12:34:56", "2400-02-29T12:34:57"]
  ]) assert.equal(nextMutationStamp({ now: NOW, candidates: [candidate] }), expected);
  const records = Object.freeze({ target: NOW, unrelated: "2500-01-01T00:00:00" });
  assert.equal(nextMutationStamp({ now: NOW, candidates: [records.target] }), "2026-09-09T10:00:01");
});

test("multiple unordered candidates use the maximum without changing the array", async () => {
  const { nextMutationStamp } = await api();
  const candidates = Object.freeze(["2026-09-09T13:00:00", NOW, "2026-09-09T11:00:00"]);
  assert.equal(nextMutationStamp({ now: NOW, candidates }), "2026-09-09T13:00:01");
  assert.equal(candidates[0], "2026-09-09T13:00:00");
});

test("day, month, year and Gregorian leap boundaries keep the seconds format", async () => {
  const { nextMutationStamp } = await api();
  for (const [now, expected] of [
    ["2026-09-09T23:59:59", "2026-09-10T00:00:00"],
    ["2026-04-30T23:59:59", "2026-05-01T00:00:00"],
    ["2026-12-31T23:59:59", "2027-01-01T00:00:00"],
    ["2024-02-28T23:59:59", "2024-02-29T00:00:00"],
    ["2000-02-29T23:59:59", "2000-03-01T00:00:00"],
    ["2100-02-28T23:59:59", "2100-03-01T00:00:00"],
    ["0099-12-31T23:59:59", "0100-01-01T00:00:00"],
    ["0000-02-28T23:59:59", "0000-02-29T00:00:00"],
    ["2026-03-08T01:59:59", "2026-03-08T02:00:00"]
  ]) assert.equal(nextMutationStamp({ now, candidates: [] }), expected);
});

test("empty candidates are ignored, while an empty real clock throws TypeError", async () => {
  const { nextMutationStamp } = await api();
  for (const empty of [null, undefined, "", []]) {
    assert.equal(nextMutationStamp({ now: NOW, candidates: empty }), "2026-09-09T10:00:01");
    assert.throws(() => nextMutationStamp({ now: empty, candidates: [NOW] }), TypeError);
    assert.equal(nextMutationStamp({ now: NOW, candidates: [empty, NOW] }), "2026-09-09T10:00:01");
  }
});

test("malformed and impossible timestamps fail even when older than the maximum", async () => {
  const { nextMutationStamp } = await api();
  const invalid = [" ", "2026-09-09", "2026-09-09T10:00", "2026-9-09T10:00:00",
    "2026-09-09 10:00:00", `${NOW}Z`, `${NOW}+09:00`, `${NOW}.000`, `${NOW}\n`,
    "2026-00-01T00:00:00", "2026-13-01T00:00:00", "2026-01-00T00:00:00",
    "2026-04-31T00:00:00", "2026-02-29T00:00:00", "1900-02-29T00:00:00",
    "2026-09-09T24:00:00", "2026-09-09T10:60:00", "2026-09-09T10:00:60",
    0, NaN, false, {}, [NOW]];
  for (const value of invalid) {
    assert.throws(() => nextMutationStamp({ now: value, candidates: [NOW] }), TypeError);
    assert.throws(() => nextMutationStamp({ now: NOW, candidates: [value, "2400-01-01T00:00:00"] }), TypeError);
  }
  for (const candidates of [NOW, 0, false, {}]) {
    assert.throws(() => nextMutationStamp({ now: NOW, candidates }), TypeError);
  }
});

test("an absent or empty real clock throws TypeError", async () => {
  const { nextMutationStamp } = await api();
  assert.throws(() => nextMutationStamp({}), TypeError);
  for (const now of [null, undefined, "", []]) {
    assert.throws(() => nextMutationStamp({ now, candidates: [null, undefined, "", []] }), TypeError);
  }
});

test("all-empty candidates advance the real clock by one second", async () => {
  const { nextMutationStamp } = await api();
  assert.equal(nextMutationStamp({ now: NOW, candidates: [null, undefined, "", []] }), "2026-09-09T10:00:01");
});

test("the four-digit year format cannot overflow", async () => {
  const { nextMutationStamp } = await api();
  assert.equal(nextMutationStamp({ now: "9999-12-31T23:59:58" }), "9999-12-31T23:59:59");
  assert.throws(() => nextMutationStamp({ now: "9999-12-31T23:59:59" }), TypeError);
  assert.throws(() => nextMutationStamp({ now: NOW, candidates: ["9999-12-31T23:59:59"] }), TypeError);
});

test("stamped returns a shallow copy, preserving the source and nested references", async () => {
  const { stamped } = await api();
  for (const record of [Object.freeze({ id: "fake", updatedAt: NOW, tags: Object.freeze(["fake"]) }), Object.freeze({ id: "new" })]) {
    const before = { ...record };
    const result = stamped(record, "2026-09-09T10:00:01");
    assert.notEqual(result, record);
    assert.deepEqual(result, { ...record, updatedAt: "2026-09-09T10:00:01" });
    assert.deepEqual(record, before);
    assert.equal(result.tags, record.tags);
  }
});

test("module has no imports, state, storage, app dependency or ambient clock", () => {
  const source = fs.readFileSync(modulePath, "utf8");
  const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const visit = node => {
    assert.notEqual(node.type, "ImportDeclaration");
    assert.notEqual(node.type, "ImportExpression");
    if (node.type === "Identifier") assert.ok(!["state", "localStorage", "sessionStorage", "require"].includes(node.name));
    if (node.type === "NewExpression" && node.callee.name === "Date") {
      assert.equal(node.arguments.length, 1);
      assert.equal(node.arguments[0].type, "Literal");
      assert.equal(typeof node.arguments[0].value, "number");
    }
    if (node.type === "MemberExpression" && node.object.name === "Date") assert.notEqual(node.property.name, "now");
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.filter(item => item?.type).forEach(visit);
      else if (child?.type) visit(child);
    }
  };
  visit(ast);
  assert.doesNotMatch(source, /app\.js/);
});
