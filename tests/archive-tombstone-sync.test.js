// 単位16 characterization: runArchiveのtombstone/archivedDates化が、第1回コードレビュー
// area-1-merge-tombstone.md H-2(repro-area1b相当)を解消したことをNodeで固定する。
//
// 検証内容(ブリーフ完了条件1〜2対応):
//   (a) アーカイブ済み端末とアーカイブ前端末が同期しても、剪定した journals/feedback は
//       archivedDates 除外により復活しない。
//   (b) 両端末で別日を archive → archivedDates が和集合になる。
//   (c) archive していない日付は従来どおり和集合マージされる(退行なし)。
//   (d) 90日超の block はtombstone(deleted:true)化され、マージで復活しない。
//
// computeSyncMerge/applySyncMergeToLocal は src/sync/github.js の純粋計算部分を直接呼ぶ
// (tests/track-sync-characterization.test.js と同じNode-levelパターン。ブラウザ不要)。
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function noop() {}

function configureMinimalStubs(syncMod) {
  syncMod.configureGithubSync({
    normalizeState: (x) => x, nowDateTime: () => "2026-09-05T12:00:00",
    todayISO: () => "2026-09-05", addDays: (d) => d, isTouchedBlock: () => false,
    RECURRENCE_KEEP_PAST_DAYS: 7, RECURRENCE_FUTURE_DAYS: 31, SWIPE_TRIAGE_LOG_MAX: 200,
    showToast: noop, maintainRecurrences: noop, render: noop, runDailyOpen: () => false, saveState: noop,
    requireGitHubConfig: noop, fetchGitHubFileSHA: noop, personalDataReady: () => true, personalDataFileConfig: () => ({ owner: "fixture", repo: "archive", branch: "main", token: "synthetic" }),
    readArchiveForSync: async () => ({ journals: { "2026-01-05": "古いジャーナル本文" }, feedback: { "2026-01-05": "古いフィードバック本文" }, reports: {} }),
    gitHubContentsURL: noop, githubHeaders: noop, gitHubErrorMessage: noop, fromBase64: noop, toBase64: noop,
    sanitizedStateForGitHub: noop, maybeWriteBackupSnapshot: noop, updateAutoSaveStatus: noop, updateSyncDot: noop,
    renderSyncBanner: noop, pruneExpiredSuggestedThemes: (x) => x, _startupDataModifiedAt: ""
  });
}

function baseState(extra = {}) {
  return {
    journalMeta: {}, settings: { journalTemplate: "", morningEnergyLog: {}, github: {} },
    journals: {}, feedback: {}, reports: {}, condition: { logs: {} }, sleep: { logs: {} },
    blocks: [], zeroThinking: { entries: [], suggestedThemes: [] },
    dailyDeclarations: {}, weeklyWishes: {}, bodyScans: [], writeMeditations: [],
    tasks: [], projects: [], storeVisits: [],
    tracks: [], trackMeasurements: [], weeklyCommitments: [], swipeTriageLog: [], gardenLog: {},
    coachLog: { settings: {}, meals: [] }, aiStepProcessedIds: [], aiStepDismissedIds: [], aiReportReadIds: [],
    aiStepPendingRequests: [],
    recurrences: [], declarations: [], questions: [], experiments: [], earlyBird: { logs: {} },
    archivedDates: [],
    ...extra
  };
}

// Execute the complete production normalizer and its real dependencies in Node.
async function createNormalizer(source) {
  const fs = require("node:fs"), vm = require("node:vm"), acorn = require("acorn");
  source ||= fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const names = new Set([
    "normalizeState", "validateStateContainers", "defaultGitHubSettings", "clamp",
    "defaultBatterySettings", "clampBatteryFieldValue", "defaultCategories", "defaultLifeAreas",
    "compactArr", "compactMap", "addDays", "parseDate", "dateToISO", "pad2", "nowDateTime",
    "dateToLocalDateTime", "todayISO", "metric", "daysBetween", "pruneExpiredSuggestedThemes",
    "localDateTimeToMs", "migrateRecurrencesIfNeeded", "inferRecurrenceKind", "isTouchedBlock"
  ]);
  const constants = new Set(["COACH_MEALS_MAX", "ZT_SUGGESTION_PENDING_TTL_MS", "ZT_SUGGESTION_RESOLVED_TTL_MS", "JOURNAL_REQUEST_SECTION"]);
  const code = [], identifiers = new Set();
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node.type === "Identifier") identifiers.add(node.name);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  for (const node of ast.body) {
    if (node.type === "FunctionDeclaration" && names.has(node.id.name)) {
      code.push(source.slice(node.start, node.end)); visit(node); names.delete(node.id.name);
    }
    if (node.type === "VariableDeclaration") for (const d of node.declarations) {
      if (constants.has(d.id.name)) { code.push(`const ${source.slice(d.start, d.end)};`); visit(d); constants.delete(d.id.name); }
    }
  }
  require("node:assert/strict").equal(names.size + constants.size, 0, "all real normalizer dependencies found");
  const context = { console, crypto: require("node:crypto").webcrypto };
  for (const node of ast.body.filter(n => n.type === "ImportDeclaration")) {
    const needed = node.specifiers.filter(s => identifiers.has(s.local.name));
    if (!needed.length) continue;
    const imported = await import(pathToFileURL(path.resolve(ROOT, node.source.value)).href);
    for (const spec of needed) context[spec.local.name] = imported[spec.imported.name];
  }
  vm.createContext(context); vm.runInContext(code.join("\n"), context);
  return { normalize: value => context.normalizeState(value), context, source, ast };
}

async function checkBlockWatermark(storeMod, syncMod) {
  const assert = require("node:assert/strict");
  const copy = value => JSON.parse(JSON.stringify(value));
  const { normalize, context, source, ast } = await createNormalizer();
  const block = (id, date, extra = {}) => ({ id, date, title: id, ...extra });
  const archived = (id, date) => block(id, date, { deleted: true, archivedAt: "2026-09-27T12:00:00", updatedAt: "2026-09-27T12:00:00" });
  const baseline = normalize(baseState({ blocks: [block("live", "2025-01-01"), block("user", "2026-03-01", { deleted: true }), block("old-user", "2025-01-01", { deleted: true })] }));
  const input = copy(baseline);
  input.blocks.push(archived("leap", "2024-02-29"), archived("last", "2025-12-31"));
  const result = normalize(input);
  assert.equal(result.archivedBlocksBefore, "2026-01-01");
  assert.deepEqual(copy(result.blocks), copy(baseline.blocks), "live old block and all user tombstones remain unchanged");
  for (const invalid of [undefined, null, 123, {}, "bad", "2026-1-01"]) {
    assert.equal(normalize({ ...copy(baseline), archivedBlocksBefore: invalid }).archivedBlocksBefore, "");
  }
  const boundary = normalize({ ...copy(baseline), archivedBlocksBefore: "2026-03-01" });
  assert.equal(boundary.archivedBlocksBefore, "2026-03-01");
  assert.deepEqual(copy(boundary.blocks), copy(baseline.blocks), "exclusive cutoff preserves same-day user tombstone");
  const userDeleted = normalize({ ...copy(baseline), archivedBlocksBefore: "2026-07-01" });
  assert.deepEqual(copy(userDeleted.blocks), copy(baseline.blocks), "user tombstone before cutoff survives GC unchanged");
  const leap = normalize({ ...copy(baseline), blocks: [archived("leap", "2024-02-29")] });
  assert.equal(leap.archivedBlocksBefore, "2024-03-01");
  assert.equal(leap.blocks.length, 0);
  for (const date of ["", "2026-6-1", "2026-01"]) {
    const tombstone = archived("invalid-date", date);
    for (const cutoff of ["", "2026-03-01"]) {
      const invalidDate = normalize(baseState({ archivedBlocksBefore: cutoff, blocks: [tombstone] }));
      assert.equal(invalidDate.archivedBlocksBefore, cutoff, "invalid tombstone date does not derive a watermark");
      assert.equal(invalidDate.blocks.length, 1, "invalid-date archived tombstone survives GC");
      assert.deepEqual(Object.keys(invalidDate.blocks[0]).sort(), ["archivedAt", "date", "deleted", "id", "updatedAt"]);
      assert.deepEqual(copy(invalidDate.blocks[0]), {
        id: tombstone.id, date, deleted: true, archivedAt: tombstone.archivedAt, updatedAt: tombstone.updatedAt
      }, "only the five tombstone fields remain without defaults");
    }
  }
  assert.deepEqual(copy(normalize(copy(result))), copy(result), "normalization is idempotent");
  const constant = ast.body.flatMap(n => n.declarations || []).find(d => d.id.name === "ARCHIVE_BLOCK_KEEP_DAYS");
  assert.equal(constant.init.value, 90);

  for (const [localCut, remoteCut] of [["2026-06-29", "2026-06-01"], ["2026-06-01", "2026-06-29"], ["", ""], ["2026-06-29", "2026-06-29"]]) {
    const local = baseState({ archivedBlocksBefore: localCut }), remote = baseState({ archivedBlocksBefore: remoteCut });
    storeMod.setState(local);
    await syncMod.prepareArchiveMerge(remote);
    const merged = syncMod.computeSyncMerge(remote, "local");
    const expected = [localCut, remoteCut].sort().at(-1);
    assert.equal(merged.values.archivedBlocksBefore, expected);
    assert.equal(merged.changedVsLocal, expected !== localCut, "watermark-only local change detection");
    assert.equal(merged.changedVsRemote, expected !== remoteCut, "watermark-only remote change detection");
    syncMod.applySyncMergeToLocal(merged);
    syncMod.applySyncMergeToRemote(merged, remote);
    assert.equal(storeMod.state.archivedBlocksBefore, expected);
    assert.equal(remote.archivedBlocksBefore, expected);
  }
  for (const tieWinner of ["local", "remote"]) {
    const local = baseState({ archivedBlocksBefore: "2026-06-29", blocks: [block("local-old", "2025-01-01"), block("known", "2025-01-01", { updatedAt: "2025-01-01T00:00:00" })] });
    const remote = baseState({ blocks: [block("stale", "2026-06-28"), block("edge", "2026-06-29"), block("new", "2026-06-30"), block("deleted", "2026-01-01", { deleted: true }), block("known", "2025-01-01", { updatedAt: "2026-09-27T00:00:00", title: "remote edit" })] });
    storeMod.setState(local); await syncMod.prepareArchiveMerge(remote);
    const merged = syncMod.computeSyncMerge(remote, tieWinner);
    assert.deepEqual(merged.values.blocks.map(b => b.id).sort(), ["deleted", "edge", "known", "local-old", "new"]);
    assert.equal(merged.values.blocks.find(b => b.id === "known").title, "remote edit");
  }

  for (const updatedAt of [undefined, "2026-06-28T23:59:00", "2026-06-29T00:00:00", "2026-09-27T10:00:00"]) {
    const local = baseState({ archivedBlocksBefore: "2026-06-29" });
    const remote = baseState({ blocks: [block("remote-only", "2026-06-01", updatedAt ? { updatedAt } : {})] });
    storeMod.setState(local); await syncMod.prepareArchiveMerge(remote);
    const merged = syncMod.computeSyncMerge(remote, "local");
    assert.deepEqual(merged.values.blocks, (updatedAt || "") >= local.archivedBlocksBefore ? remote.blocks : [], "old remote-only block merges only when edited on or after cutoff");
  }
  const deviceA = normalize(baseState({ archivedBlocksBefore: "2026-07-01", blocks: [
    block("x", "2026-06-01", { deleted: true, updatedAt: "2026-06-02T12:00:00" }),
    archived("gc", "2026-05-01")
  ] }));
  const deviceB = normalize(baseState({ blocks: [block("x", "2026-06-01", { updatedAt: "2026-06-01T12:00:00" })] }));
  assert.deepEqual(deviceA.blocks.map(b => b.id), ["x"], "archive GC retains the unsent user deletion");
  const directions = [];
  for (const [local, remote] of [[copy(deviceA), copy(deviceB)], [copy(deviceB), copy(deviceA)]]) {
    storeMod.setState(local); await syncMod.prepareArchiveMerge(remote);
    const merged = syncMod.computeSyncMerge(remote, "local");
    assert.deepEqual(copy(merged.values.blocks), copy(deviceA.blocks), "user deletion reaches both merge directions after GC");
    syncMod.applySyncMergeToLocal(merged);
    syncMod.applySyncMergeToRemote(merged, remote);
    assert.deepEqual(copy(normalize(remote).blocks), copy(deviceA.blocks));
    assert.deepEqual(copy(normalize(storeMod.state).blocks), copy(deviceA.blocks));
    directions.push(copy(merged.values.blocks));
  }
  assert.deepEqual(directions[0], directions[1], "user deletion converges symmetrically");

  // Real runArchive: cutoff advances only after all PUTs succeed, never backwards.
  const vm = require("node:vm");
  for (const name of ["collectArchivable", "runArchive"]) {
    const fn = ast.body.find(n => n.type === "FunctionDeclaration" && n.id.name === name);
    vm.runInContext(source.slice(fn.start, fn.end), context);
  }
  Object.assign(context, { ARCHIVE_TEXT_KEEP_DAYS: 90, ARCHIVE_BLOCK_KEEP_DAYS: constant.init.value,
    todayISO: () => "2026-09-27", personalDataReady: () => true, personalDataConn: x => x,
    personalDataPath: x => x, gitHubFileURL: (_, p) => p, fetchGitHubJSONFile: async () => null,
    githubHeaders: () => ({}), toBase64: x => x, gitHubErrorMessage: async () => "failed",
    showToast: noop, saveState: noop, render: noop });
  for (const existing of ["", "2026-07-01"]) {
    context.state = baseState({ archivedBlocksBefore: existing, blocks: [block("old", "2025-01-01")] });
    context.fetch = async () => ({ ok: false });
    const before = copy(context.state);
    await context.runArchive({ manual: true });
    assert.deepEqual(copy(context.state), before);
    context.fetch = async () => ({ ok: true });
    await context.runArchive({ manual: true });
    assert.equal(context.state.archivedBlocksBefore, existing || "2026-06-29");
    assert.equal(context.state.blocks[0].deleted, true);
  }
  console.log("  ✅ B18: normalize/GC/date boundaries/sync propagation/runArchive/90-day retention");
}

module.exports = { createNormalizer };

if (require.main === module) (async () => {
  const storeMod = await import(pathToFileURL(path.join(ROOT, "src", "state", "store.js")).href);
  const syncMod = await import(pathToFileURL(path.join(ROOT, "src", "sync", "github.js")).href);
  configureMinimalStubs(syncMod);

  await checkBlockWatermark(storeMod, syncMod);

  console.log("[a] archivedDates除外: リモートに残る古いjournals/feedbackキーが復活しない");
  {
    // ローカル(この端末)は既にrunArchiveで2026-01-05を剪定し、archivedDatesへ記録済み。
    const local = baseState({
      journals: {}, feedback: {}, archivedDates: ["2026-01-05"]
    });
    // リモート(まだarchiveを実行していない端末)は古いキーが残ったまま。
    const remote = baseState({
      journals: { "2026-01-05": "古いジャーナル本文" },
      feedback: { "2026-01-05": "古いフィードバック本文" },
      archivedDates: []
    });
    storeMod.setState(local);
    await syncMod.prepareArchiveMerge(remote); // Prove the archived copy before pruning stale device text.
    const merged = syncMod.computeSyncMerge(remote, "local");
    check("journalsが復活しない", !("2026-01-05" in merged.values.journals), JSON.stringify(merged.values.journals));
    check("feedbackが復活しない", !("2026-01-05" in merged.values.feedback), JSON.stringify(merged.values.feedback));
    check("archivedDatesが伝播する(和集合)", merged.values.archivedDates.includes("2026-01-05"));
    // リモートに古いキーが残っている以上、ローカル側は「変化あり」(=リモートへ剪定を押し戻す必要がある)
    check("changedVsRemoteが立つ(リモートの古いキーを剪定する必要がある)", merged.changedVsRemote === true);
    syncMod.applySyncMergeToLocal(merged);
    check("適用後もstate.journalsに残らない", !("2026-01-05" in storeMod.state.journals));
  }

  console.log("[b] 両端末で別日をarchive → archivedDatesが和集合になる");
  {
    const local = baseState({ archivedDates: ["2026-01-05"] });
    const remote = baseState({ archivedDates: ["2026-02-10"] });
    storeMod.setState(local);
    await syncMod.prepareArchiveMerge(remote); // Prove the archived copy before pruning stale device text.
    const merged = syncMod.computeSyncMerge(remote, "local");
    check("両日とも含まれる",
      merged.values.archivedDates.includes("2026-01-05") && merged.values.archivedDates.includes("2026-02-10")
      && merged.values.archivedDates.length === 2,
      JSON.stringify(merged.values.archivedDates));
  }

  console.log("[c] archiveしていない日付は従来どおり和集合マージされる(退行なし)");
  {
    const local = baseState({ journals: { "2026-09-01": "ローカルの新しい日記" }, archivedDates: [] });
    const remote = baseState({ journals: { "2026-09-02": "リモート限定の日記" }, archivedDates: [] });
    storeMod.setState(local);
    await syncMod.prepareArchiveMerge(remote); // Prove the archived copy before pruning stale device text.
    const merged = syncMod.computeSyncMerge(remote, "local");
    check("片側にしか無いキーは合流する",
      merged.values.journals["2026-09-01"] === "ローカルの新しい日記"
      && merged.values.journals["2026-09-02"] === "リモート限定の日記",
      JSON.stringify(merged.values.journals));
  }

  console.log("[d] tombstone化されたBlockはリモートの生きた古いBlockに巻き戻されない");
  {
    // ローカルはrunArchiveでBlockをtombstone化済み(id/date/deletedのみ、updatedAtが新しい)。
    const local = baseState({
      blocks: [{ id: "b-old", date: "2025-01-05", deleted: true, archivedAt: "2026-09-05T06:00:00", updatedAt: "2026-09-05T06:00:00" }]
    });
    // リモートはまだarchiveしておらず、生きたフル内容のBlockのまま(updatedAtは古い=編集されていない)。
    const remote = baseState({
      blocks: [{ id: "b-old", date: "2025-01-05", title: "古いBlock", deleted: false, updatedAt: "2025-01-05T09:00:00" }]
    });
    storeMod.setState(local);
    await syncMod.prepareArchiveMerge(remote); // Prove the archived copy before pruning stale device text.
    const merged = syncMod.computeSyncMerge(remote, "local");
    const result = merged.values.blocks.find((b) => b.id === "b-old");
    check("tombstone(deleted:true)が勝つ・本文は蘇らない",
      !!result && result.deleted === true && !("title" in result), JSON.stringify(result));
  }

  console.log(failures === 0 ? "\narchive-tombstone-sync: 全件成功" : `\narchive-tombstone-sync: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
