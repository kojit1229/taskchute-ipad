const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");
const load = file => import(pathToFileURL(path.join(root, file)).href);
const early = "2026-09-10T09:00:00", late = "2026-09-10T10:00:00";
let checks = 0;
function check(name, work) { work(); checks++; console.log(`PASS ${name}`); }
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function base(blocks) {
  return {
    settings: { journalTemplate: "", morningEnergyLog: {}, github: {} },
    journalMeta: {}, journals: {}, feedback: {}, reports: {},
    condition: { logs: {} }, sleep: { logs: {} }, blocks,
    zeroThinking: { entries: [], suggestedThemes: [] }, dailyDeclarations: {},
    weeklyWishes: {}, bodyScans: [], writeMeditations: [], tasks: [], projects: [],
    storeVisits: [], tracks: [], trackMeasurements: [], weeklyCommitments: [],
    swipeTriageLog: [], gardenLog: {}, coachLog: { settings: {}, meals: [] },
    aiStepProcessedIds: [], aiStepDismissedIds: [], aiReportReadIds: [],
    aiStepPendingRequests: [], recurrences: [], declarations: [], questions: [],
    experiments: [], earlyBird: { logs: {} }, archivedDates: []
  };
}

(async () => {
  const { mergeRecords } = await load("src/core/merge.js");
  const sync = await load("src/sync/github.js");
  const store = await load("src/state/store.js");
  sync.configureGithubSync({
    normalizeState: x => x, todayISO: () => "2026-09-10", nowDateTime: () => late,
    addDays: (_date, days) => days < 0 ? "2026-09-03" : "2026-10-11",
    isTouchedBlock: b => !!b.comment, RECURRENCE_KEEP_PAST_DAYS: 7,
    RECURRENCE_FUTURE_DAYS: 31, SWIPE_TRIAGE_LOG_MAX: 200,
    pruneExpiredSuggestedThemes: x => x, personalDataReady: () => true,
    personalDataFileConfig: () => ({ owner: "fixture", repo: "merge", branch: "main" })
  });
  const rules = {
    compareAt: b => b.updatedAt || b.createdAt || "",
    tieBreak: (l, r) => !!l.deleted !== !!r.deleted ? (r.deleted ? r : l) : l
  };
  const cases = [
    ["createdAt fallback", { createdAt: early }, { createdAt: late }, "remote"],
    ["createdAt reverse", { createdAt: late }, { createdAt: early }, "local"],
    ["empty updatedAt", { updatedAt: "", createdAt: early }, { createdAt: late }, "remote"],
    ["remote empty updatedAt", { createdAt: early }, { updatedAt: "", createdAt: late }, "remote"],
    ["only local updatedAt", { updatedAt: late }, { createdAt: early }, "local"],
    ["only remote updatedAt", { createdAt: early }, { updatedAt: late }, "remote"],
    ["updatedAt overrides createdAt", { updatedAt: early, createdAt: late }, { updatedAt: late }, "remote"],
    ["both clocks absent", {}, {}, "local"],
    ["both clocks empty", { updatedAt: "", createdAt: "" }, {}, "local"],
    ["remote same-time deletion", { updatedAt: early }, { updatedAt: early, deleted: true }, "remote"],
    ["local same-time deletion", { updatedAt: early, deleted: true }, { updatedAt: early }, "local"],
    ["both deleted tie", { updatedAt: early, deleted: true }, { updatedAt: early, deleted: true }, "local"],
    ["empty clocks deletion", {}, { deleted: true }, "remote"],
    ["new edit beats deletion", { updatedAt: early, deleted: true }, { updatedAt: late }, "remote"],
    ["old deletion loses", { updatedAt: late }, { updatedAt: early, deleted: true }, "local"]
  ];
  for (const [name, l, r, winner] of cases) {
    const local = freeze({ id: "view-block", title: "local", source: "view", viewDetail: { localOnly: true }, ...l });
    const remote = freeze({ id: "view-block", title: "remote", source: "view", viewDetail: { remoteOnly: true }, ...r });
    const expected = winner === "local" ? local : remote;
    const lists = freeze([[local], [remote]]), before = JSON.stringify(lists);
    check(name, () => {
      assert.strictEqual(mergeRecords(...lists, rules)[0], expected);
      assert.equal(JSON.stringify(lists), before);
    });
    for (const tieWinner of ["local", "remote"]) {
      const remoteState = base(lists[1]);
      store.setState(base(lists[0]));
      await sync.prepareArchiveMerge(remoteState);
      check(`${name}: sync ${tieWinner}`, () => {
        const merged = sync.computeSyncMerge(remoteState, tieWinner);
        assert.ok(merged, "sync computation must succeed");
        assert.strictEqual(merged.values.blocks[0], expected);
        assert.equal(JSON.stringify(lists), before);
      });
    }
  }
  check("invalid lists and records are ignored", () => {
    assert.deepEqual(mergeRecords(null, undefined, rules), []);
    assert.deepEqual(mergeRecords({}, "bad", rules), []);
    const valid = { id: "valid" };
    assert.deepEqual(mergeRecords([null, {}, valid], [false, { id: "" }], rules), [valid]);
  });
  check("injected comparison / tie rule and failure are observable", () => {
    const local = { id: "x", rank: 1 }, remote = { id: "x", rank: 2 };
    let ties = 0;
    const custom = { compareAt: b => b.rank, tieBreak: (_l, r) => { ties++; return r; } };
    assert.strictEqual(mergeRecords([local], [remote], custom)[0], remote);
    assert.equal(ties, 0);
    assert.strictEqual(mergeRecords([remote], [remote], custom)[0], remote);
    assert.equal(ties, 1);
    assert.throws(() => mergeRecords([local], [remote], { ...custom,
      compareAt() { throw new Error("injected comparison failure"); }
    }), /injected comparison failure/);
  });
  const recurring = (id, date, extra = {}) => ({ id, date, recurrenceGroupId: "r", ...extra });
  const local = freeze([recurring("known", "2020-01-01", { updatedAt: early })]);
  const remote = freeze([
    recurring("known", "2020-01-01", { updatedAt: late }),
    recurring("old", "2020-01-01"), recurring("future", "2030-01-01"),
    recurring("touched", "2020-01-01", { comment: "keep" }),
    recurring("in-range", "2026-09-10"), { id: "ordinary", date: "2020-01-01" }
  ]);
  store.setState(base(local));
  const remoteState = base(remote);
  await sync.prepareArchiveMerge(remoteState);
  check("recurrence filtering retained without changing known or touched blocks", () => {
    const result = sync.computeSyncMerge(remoteState, "remote").values.blocks;
    assert.deepEqual(result.map(b => b.id), ["known", "touched", "in-range", "ordinary"]);
    assert.strictEqual(result[0], remote[0]);
  });
  check("every mergeBlockLists caller fixes the device as local", () => {
    const source = fs.readFileSync(path.join(root, "src/sync/github.js"), "utf8");
    const calls = [...source.matchAll(/(?<!function )\bmergeBlockLists\(([^)]*)\)/g)];
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], "state.blocks, remoteNorm.blocks");
  });
  console.log(`daily-block-merge: ${checks} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
