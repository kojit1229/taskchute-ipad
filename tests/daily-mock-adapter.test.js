// Node-only synthetic adapter checks; no browser profile, product storage or external files.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
const fixtures = JSON.parse(fs.readFileSync(path.join(root, "scripts/daily-mock/fixtures.json"), "utf8"));
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
(async () => {
  const { createMockAdapter, MOCK_STORAGE_KEY } = await import(pathToFileURL(path.join(root, "scripts/daily-mock/mock-adapter.js")).href);
  const { validateDailyContract, DAILY_ACTIONS } = await import(pathToFileURL(path.join(root, "src/ui/daily-parts/contract.js")).href);
  function setup() {
    const data = new Map([["synthetic-unrelated-key", "untouched"]]), calls = [];
    const storage = {
      getItem(key) { calls.push(["get", key]); return data.get(key) ?? null; },
      setItem(key, value) { calls.push(["set", key]); data.set(key, value); }
    };
    const adapter = createMockAdapter({ fixtures, storage });
    let sequence = 0;
    const notification = (action = "daily-plan-complete", values = { desiredCompleted: true }, extra = {}) => ({
      action, kind: "block", id: fixtures.entities[0].id, draftId: "mock-draft", requestId: `mock-request-${++sequence}`,
      baseFingerprint: adapter.fingerprint(), values, ...extra
    });
    const dispatch = (request, options) => {
      const answer = adapter.dispatchMockOperation(request, options);
      assert.deepEqual(validateDailyContract("result", answer), { valid: true, errors: [] });
      return answer;
    };
    return { adapter, storage, calls, data, notification, dispatch };
  }
  check("candidate is prepared before storage and state changes only after successful save", () => {
    const { adapter, storage, dispatch, notification, calls, data } = setup();
    const before = adapter.getState(), save = storage.setItem.bind(storage);
    storage.setItem = (key, text) => {
      assert.deepEqual(adapter.getState(), before);
      assert.deepEqual(JSON.parse(text), adapter.getCandidate());
      assert.equal(adapter.getCandidate().entities[0].planCompleted, true);
      save(key, text);
    };
    const answer = dispatch(notification());
    assert.equal(answer.status, "saved"); assert.equal(answer.syncStatus, null);
    assert.equal(adapter.getState().entities[0].planCompleted, true);
    assert.equal(adapter.getCandidate(), null);
    assert.deepEqual(JSON.parse(data.get(MOCK_STORAGE_KEY)), adapter.getState());
    assert.ok(calls.length >= 2); assert.ok(calls.every(([, key]) => key === MOCK_STORAGE_KEY));
    assert.equal(data.get("synthetic-unrelated-key"), "untouched");
  });
  check("injected failure restores original state, retains candidate and retries exactly once", () => {
    const { adapter, dispatch, notification, calls } = setup();
    const request = notification(), original = adapter.getState();
    assert.equal(dispatch(request, { scenario: "failure" }).status, "storage-failed");
    assert.deepEqual(adapter.getState(), original);
    assert.equal(adapter.getCandidate().entities[0].planCompleted, true);
    assert.equal(calls.filter(([op]) => op === "set").length, 0);
    assert.equal(dispatch({ ...request, values: { desiredCompleted: false } }).status, "conflict");
    assert.equal(dispatch(request, { scenario: "retry" }).status, "saved");
    assert.equal(dispatch(request, { scenario: "retry" }).status, "saved");
    assert.equal(calls.filter(([op]) => op === "set").length, 1);
    assert.equal(adapter.getState().revision, original.revision + 1);
  });
  check("real setItem exception is detected without changing state or saved bytes", () => {
    const { adapter, storage, data, dispatch, notification } = setup();
    assert.equal(dispatch(notification()).status, "saved");
    const before = adapter.getState(), saved = data.get(MOCK_STORAGE_KEY);
    const save = storage.setItem;
    storage.setItem = () => { throw new Error("synthetic quota failure"); };
    const request = notification("daily-plan-complete", { desiredCompleted: false });
    assert.equal(dispatch(request).status, "storage-failed");
    assert.deepEqual(adapter.getState(), before); assert.equal(data.get(MOCK_STORAGE_KEY), saved);
    storage.setItem = save;
    assert.equal(dispatch(request, { scenario: "retry" }).status, "saved");
  });
  check("cancel clears candidate and does not write; cancelled request remains cancelled on resend", () => {
    const { adapter, dispatch, notification, calls } = setup();
    const original = adapter.getState();
    dispatch(notification(), { scenario: "failure" });
    const request = notification("daily-plan-times-cancel", {});
    assert.equal(dispatch(request).status, "cancelled");
    assert.equal(adapter.getCandidate(), null);
    assert.equal(dispatch(request, { scenario: "retry" }).status, "cancelled");
    const scenarioRequest = notification();
    assert.equal(dispatch(scenarioRequest, { scenario: "cancel" }).status, "cancelled");
    assert.equal(dispatch(scenarioRequest).status, "cancelled");
    assert.deepEqual(adapter.getState(), original);
    assert.equal(calls.filter(([op]) => op === "set").length, 0);
  });
  check("successful receipt survives reload and repeated duplication never creates another entity", () => {
    const { adapter, storage, dispatch, notification, calls } = setup();
    const request = notification("daily-block-duplicate", {});
    const answer = dispatch(request);
    assert.equal(answer.status, "saved"); assert.ok(answer.undoToken);
    assert.deepEqual(dispatch(request), answer);
    const restored = createMockAdapter({ fixtures, storage });
    assert.deepEqual(restored.dispatchMockOperation(request), answer);
    assert.equal(restored.getState().entities.length, 2);
    assert.equal(calls.filter(([op]) => op === "set").length, 1);
    assert.equal(adapter.dispatchMockOperation({ ...request, action: "daily-plan-complete" }).status, "conflict");
  });
  check("duplicate undo deletes only the unchanged local copy, including failure and resend", () => {
    const { adapter, dispatch, notification } = setup();
    const copy = dispatch(notification("daily-block-duplicate", {}));
    const request = notification("daily-duplicate-undo", { undoToken: copy.undoToken }, { id: copy.entityId });
    const before = adapter.getState();
    assert.equal(dispatch(request, { scenario: "failure" }).status, "storage-failed");
    assert.deepEqual(adapter.getState(), before);
    const answer = dispatch(request, { scenario: "retry" });
    assert.equal(answer.status, "saved"); assert.deepEqual(dispatch(request), answer);
    assert.deepEqual(adapter.getState().entities, fixtures.entities);
  });
  check("undo refuses a locally changed copy and forged tokens", () => {
    const { adapter, dispatch, notification } = setup();
    const copy = dispatch(notification("daily-block-duplicate", {}));
    assert.equal(dispatch(notification("daily-plan-complete", { desiredCompleted: true }, { id: copy.entityId })).status, "saved");
    const before = adapter.getState();
    assert.equal(dispatch(notification("daily-duplicate-undo", { undoToken: copy.undoToken }, { id: copy.entityId })).status, "conflict");
    assert.equal(dispatch(notification("daily-duplicate-undo", { undoToken: JSON.stringify(before.entities[0]) })).status, "conflict");
    assert.deepEqual(adapter.getState(), before);
  });
  check("time pair validation, empty pair and next-day midnight use no Date string parsing", () => {
    const { adapter, dispatch, notification } = setup();
    for (const values of [{ start: "10:00", end: "10:30", endNextDay: false },
      { start: "23:30", end: "00:00", endNextDay: true }, { start: "", end: "", endNextDay: false }]) {
      assert.equal(dispatch(notification("daily-plan-times-save", values)).status, "saved");
      for (const key of Object.keys(values)) assert.equal(adapter.getState().entities[0][key], values[key]);
    }
    for (const values of [{ start: "24:00", end: "00:00", endNextDay: true },
      { start: "10:00", end: "", endNextDay: false }, { start: "11:00", end: "10:00", endNextDay: false },
      { start: "10:00", end: "10:00", endNextDay: false }, { start: "09:00", end: "10:00", endNextDay: "yes" },
      { start: "09:00", end: "10:00", endNextDay: false, unexpected: true }]) {
      const before = adapter.getState();
      assert.equal(dispatch(notification("daily-plan-times-save", values)).status, "invalid");
      assert.deepEqual(adapter.getState(), before);
    }
  });
  check("unknown or unconnected actions, invalid fields, stale basis and missing entity are rejected", () => {
    const { adapter, dispatch, notification, calls } = setup();
    const connected = ["daily-plan-times-save", "daily-plan-times-cancel", "daily-plan-complete", "daily-block-duplicate", "daily-duplicate-undo"];
    for (const action of ["unknown", "__proto__", ...DAILY_ACTIONS.filter(action => !connected.includes(action))])
      assert.equal(dispatch(notification(action)).status, "invalid");
    for (const extra of [{ requestId: null }, { kind: "task" }, { extra: true }, { values: { desiredCompleted: "true" } },
      { values: { desiredCompleted: true, other: 1 } }, { values: { html: "unsafe" } }])
      assert.equal(dispatch(notification("daily-plan-complete", { desiredCompleted: true }, extra)).status, "invalid");
    assert.equal(dispatch(notification(), { scenario: "unknown" }).status, "invalid");
    assert.equal(dispatch(notification("daily-block-duplicate", { unexpected: true })).status, "invalid");
    assert.equal(dispatch(notification("daily-plan-complete", { desiredCompleted: true }, { id: "missing" })).status, "conflict");
    assert.equal(dispatch(notification("daily-plan-complete", { desiredCompleted: true }, { baseFingerprint: "stale" })).status, "conflict");
    assert.deepEqual(adapter.getState(), fixtures); assert.equal(calls.length, 1);
  });
  check("getter and cyclic inputs are rejected without executing getters", () => {
    const { dispatch, notification } = setup();
    const request = notification(); let reads = 0;
    Object.defineProperty(request.values, "desiredCompleted", { get() { reads++; throw new Error("must not run"); } });
    assert.equal(dispatch(request).status, "invalid"); assert.equal(reads, 0);
    const cyclic = notification(); cyclic.values.self = cyclic;
    assert.equal(dispatch(cyclic).status, "invalid");
  });
  check("read failures and malformed stored data fail closed; snapshots cannot mutate adapter", () => {
    const { adapter, storage, data } = setup();
    const snapshot = adapter.getState(); snapshot.entities[0].title = "mutated";
    assert.deepEqual(adapter.getState(), fixtures);
    for (const stored of ["not json", "null", "{}", JSON.stringify({ ...fixtures, revision: -1 }),
      JSON.stringify({ ...fixtures, entities: [{ ...fixtures.entities[0], id: "real-1" }] })]) {
      data.set(MOCK_STORAGE_KEY, stored);
      assert.throws(() => createMockAdapter({ fixtures, storage }));
    }
    assert.throws(() => createMockAdapter({ fixtures: {}, storage }), TypeError);
    assert.throws(() => createMockAdapter({ fixtures, storage: { getItem() { throw new Error("synthetic read failure"); }, setItem() {} } }), /synthetic read failure/);
  });
  check("same request cannot reenter while storage is running", () => {
    const { adapter, storage, dispatch, notification } = setup();
    const request = notification(), save = storage.setItem.bind(storage);
    storage.setItem = (key, value) => { assert.equal(dispatch(request).status, "conflict"); save(key, value); };
    assert.equal(dispatch(request).status, "saved"); assert.equal(adapter.getState().revision, 1);
  });
  console.log(`daily-mock-adapter: ${checks} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
