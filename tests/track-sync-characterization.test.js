// 12WY同期characterization: 3コレクションの外部修正・ローカル編集・tombstone・
// updatedAt空・id和集合と、manual/auto・excused/completed・節目同時編集をNodeで固定する。
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
    normalizeState: (x) => x, nowDateTime: () => "2026-08-23T12:00:00",
    todayISO: () => "2026-08-23", addDays: (d) => d, isTouchedBlock: () => false,
    RECURRENCE_KEEP_PAST_DAYS: 7, RECURRENCE_FUTURE_DAYS: 31, SWIPE_TRIAGE_LOG_MAX: 200,
    showToast: noop, maintainRecurrences: noop, render: noop, runDailyOpen: () => false, saveState: noop,
    requireGitHubConfig: noop, fetchGitHubFileSHA: noop, personalDataReady: () => true, personalDataFileConfig: noop,
    gitHubContentsURL: noop, githubHeaders: noop, gitHubErrorMessage: noop, fromBase64: noop, toBase64: noop,
    sanitizedStateForGitHub: noop, maybeWriteBackupSnapshot: noop, updateAutoSaveStatus: noop, updateSyncDot: noop,
    renderSyncBanner: noop, pruneExpiredSuggestedThemes: (x) => x, _startupDataModifiedAt: ""
  });
}

function baseState(extra = {}) {
  return {
    journalMeta: {}, settings: { journalTemplate: "", morningEnergyLog: {}, github: {} },
    journals: {}, feedback: {}, condition: { logs: {} }, sleep: { logs: {} },
    blocks: [], zeroThinking: { entries: [], suggestedThemes: [] },
    dailyDeclarations: {}, weeklyWishes: {}, bodyScans: [], tasks: [], projects: [], storeVisits: [],
    tracks: [], trackMeasurements: [], weeklyCommitments: [], swipeTriageLog: [], gardenLog: {},
    coachLog: { settings: {}, meals: [] }, aiStepProcessedIds: [], aiStepDismissedIds: [], aiStepPendingRequests: [],
    recurrences: [], declarations: [], questions: [], experiments: [], earlyBird: { logs: {} },
    ...extra
  };
}

const track = (name, updatedAt, extra = {}) => ({
  id: "trk_shared", name, milestones: [], updatedAt, deleted: false, ...extra
});
const measurement = (value, updatedAt, extra = {}) => ({
  id: "trm_shared", trackId: "trk_shared", value, updatedAt, deleted: false, ...extra
});
const item = (title, updatedAt, extra = {}) => ({
  id: "wci_2026-08-22_b1", recordType: "item", weekStart: "2026-08-22", blockId: "b1",
  title, source: "confirmed", lane: "cycle", excused: false, excusedReason: "", excusedChangedAt: "",
  completedAt: "", completedChangedAt: "", updatedAt, deleted: false, ...extra
});

(async () => {
  const storeMod = await import(pathToFileURL(path.join(ROOT, "src", "state", "store.js")).href);
  const syncMod = await import(pathToFileURL(path.join(ROOT, "src", "sync", "github.js")).href);
  const { weeklyScore } = await import(pathToFileURL(path.join(ROOT, "src", "core", "track.js")).href);
  configureMinimalStubs(syncMod);

  console.log("[sync-1] リモート外部修正が3コレクションで生存する");
  {
    const local = baseState({
      tracks: [track("local-old", "2026-08-23T09:00:00")],
      trackMeasurements: [measurement(1, "2026-08-23T09:00:00")],
      weeklyCommitments: [item("local-old", "2026-08-23T09:00:00")]
    });
    const remote = baseState({
      tracks: [track("remote-new", "2026-08-23T10:00:00")],
      trackMeasurements: [measurement(2, "2026-08-23T10:00:00")],
      weeklyCommitments: [item("remote-new", "2026-08-23T10:00:00")]
    });
    storeMod.setState(local);
    const merged = syncMod.computeSyncMerge(remote, "local");
    check("changedVsLocalが立つ", merged.changedVsLocal === true);
    syncMod.applySyncMergeToLocal(merged);
    check("remoteのtrack/measurement/commitmentがローカルへ適用",
      storeMod.state.tracks[0].name === "remote-new" && storeMod.state.trackMeasurements[0].value === 2
      && storeMod.state.weeklyCommitments[0].title === "remote-new");
  }

  console.log("[sync-2] ローカル編集がリモート採用経路でも消えない");
  {
    const local = baseState({
      tracks: [track("local-new", "2026-08-23T11:00:00")],
      trackMeasurements: [measurement(3, "2026-08-23T11:00:00")],
      weeklyCommitments: [item("local-new", "2026-08-23T11:00:00")]
    });
    const remote = baseState({
      tracks: [track("remote-old", "2026-08-23T10:00:00")],
      trackMeasurements: [measurement(2, "2026-08-23T10:00:00")],
      weeklyCommitments: [item("remote-old", "2026-08-23T10:00:00")]
    });
    storeMod.setState(local);
    const merged = syncMod.computeSyncMerge(remote, "remote");
    check("changedVsRemoteが立つ", merged.changedVsRemote === true);
    syncMod.applySyncMergeToRemote(merged, remote);
    check("localのtrack/measurement/commitmentがremoteNormへ適用",
      remote.tracks[0].name === "local-new" && remote.trackMeasurements[0].value === 3
      && remote.weeklyCommitments[0].title === "local-new");
  }

  console.log("[sync-3] 新しいtombstoneは3コレクションで復活しない");
  {
    const local = baseState({
      tracks: [track("deleted", "2026-08-23T12:00:00", { deleted: true })],
      trackMeasurements: [measurement(3, "2026-08-23T12:00:00", { deleted: true })],
      weeklyCommitments: [item("deleted", "2026-08-23T12:00:00", { deleted: true })]
    });
    const remote = baseState({
      tracks: [track("alive", "2026-08-23T10:00:00")],
      trackMeasurements: [measurement(2, "2026-08-23T10:00:00")],
      weeklyCommitments: [item("alive", "2026-08-23T10:00:00")]
    });
    storeMod.setState(local);
    const merged = syncMod.computeSyncMerge(remote, "remote");
    check("track/measurement/commitmentのtombstoneが勝つ",
      merged.values.tracks[0].deleted && merged.values.trackMeasurements[0].deleted
      && merged.values.weeklyCommitments[0].deleted);
  }

  console.log("[sync-4] updatedAt空の後方互換は採用側tieWinnerに従う");
  {
    const local = baseState({ tracks: [track("local", "")], trackMeasurements: [measurement(1, "")], weeklyCommitments: [item("local", "")] });
    const remote = baseState({ tracks: [track("remote", "")], trackMeasurements: [measurement(2, "")], weeklyCommitments: [item("remote", "")] });
    storeMod.setState(local);
    const merged = syncMod.computeSyncMerge(remote, "remote");
    check("空updatedAtはremote採用経路と一致",
      merged.values.tracks[0].name === "remote" && merged.values.trackMeasurements[0].value === 2
      && merged.values.weeklyCommitments[0].title === "remote");
  }

  console.log("[sync-5] 同一idは3コレクションで重複しない");
  {
    const local = baseState({ tracks: [track("local", "")], trackMeasurements: [measurement(1, "")], weeklyCommitments: [item("local", "")] });
    const remote = baseState({ tracks: [track("remote", "")], trackMeasurements: [measurement(2, "")], weeklyCommitments: [item("remote", "")] });
    storeMod.setState(local);
    const values = syncMod.computeSyncMerge(remote, "local").values;
    check("各idのマージ結果は1件ずつ", values.tracks.length === 1
      && values.trackMeasurements.length === 1 && values.weeklyCommitments.length === 1);
  }

  console.log("[sync-5b] changedVsRemoteは3コレクションの単独差分を個別検出する");
  {
    const cases = [
      ["tracks", [track("local-only", "2026-08-23T10:00:00")]],
      ["trackMeasurements", [measurement(1, "2026-08-23T10:00:00")]],
      ["weeklyCommitments", [item("local-only", "2026-08-23T10:00:00")]]
    ];
    for (const [key, records] of cases) {
      storeMod.setState(baseState({ [key]: records }));
      const merged = syncMod.computeSyncMerge(baseState(), "remote");
      check(`${key}だけの差分でchangedVsRemoteが立つ`, merged?.changedVsRemote === true);
    }
  }

  console.log("[sync-5c] remoteNormの3キー欠損を空配列として扱う");
  {
    storeMod.setState(baseState());
    const remote = baseState();
    delete remote.tracks;
    delete remote.trackMeasurements;
    delete remote.weeklyCommitments;
    check("3キー欠損でもcomputeSyncMergeは非null", syncMod.computeSyncMerge(remote, "remote") !== null);
  }

  console.log("[sync-6] manual確定はautoより優先され、未選択候補はスコアへ復活しない");
  {
    const metaManual = {
      id: "wcw_2026-08-22", recordType: "week", weekStart: "2026-08-22", committedVia: "manual",
      selectedBlockIds: ["b1"], updatedAt: "2026-08-23T09:00:00", deleted: false
    };
    const metaAuto = { ...metaManual, committedVia: "auto", selectedBlockIds: [], updatedAt: "2026-08-23T12:00:00" };
    const selected = item("selected", "2026-08-23T09:00:00", { completedAt: "2026-08-23T10:00:00" });
    const autoExtra = item("auto-extra", "2026-08-23T12:00:00", {
      id: "wci_2026-08-22_b2", blockId: "b2", source: "auto"
    });
    storeMod.setState(baseState({ weeklyCommitments: [metaManual, selected] }));
    const commitments = syncMod.computeSyncMerge(
      baseState({ weeklyCommitments: [metaAuto, selected, autoExtra] }), "remote"
    ).values.weeklyCommitments;
    const meta = commitments.find((record) => record.recordType === "week");
    const score = weeklyScore(commitments, "2026-08-22");
    check("manualメタとselectedBlockIdsが勝つ", meta.committedVia === "manual" && meta.selectedBlockIds[0] === "b1");
    check("auto余剰itemは残ってもmanual未選択の分母へ復活しない", score.status === "scored" && score.total === 1 && score.pct === 100, JSON.stringify(score));
  }

  console.log("[sync-7] excusedとcompletedAtの同時編集が両立する");
  {
    const localItem = item("local", "2026-08-23T10:00:00", {
      excused: true, excusedReason: "休養", excusedChangedAt: "2026-08-23T12:00:00"
    });
    const remoteItem = item("remote", "2026-08-23T11:00:00", {
      completedAt: "2026-08-23T11:00:00", completedChangedAt: "2026-08-23T11:00:00"
    });
    storeMod.setState(baseState({ weeklyCommitments: [localItem] }));
    const combined = syncMod.computeSyncMerge(baseState({ weeklyCommitments: [remoteItem] }), "remote")
      .values.weeklyCommitments[0];
    check("excused系とcompleted系が双方生存", combined.excused === true && combined.excusedReason === "休養"
      && combined.completedAt === "2026-08-23T11:00:00", JSON.stringify(combined));
  }

  console.log("[sync-8] 同一節目のdoneAtとplannedDate同時編集が両立する");
  {
    const localMilestone = {
      id: "ms_1", label: "節目", plannedDate: "2026-09-01", originalPlannedDate: "2026-09-01",
      doneAt: "2026-08-23", doneChangedAt: "2026-08-23T12:00:00",
      updatedAt: "2026-08-23T10:00:00", deleted: false
    };
    const remoteMilestone = { ...localMilestone, plannedDate: "2026-09-10", doneAt: "",
      doneChangedAt: "2026-08-23T09:00:00", updatedAt: "2026-08-23T11:00:00" };
    storeMod.setState(baseState({ tracks: [track("local", "2026-08-23T10:00:00", { milestones: [localMilestone] })] }));
    const combined = syncMod.computeSyncMerge(
      baseState({ tracks: [track("remote", "2026-08-23T11:00:00", { milestones: [remoteMilestone] })] }), "remote"
    ).values.tracks[0].milestones[0];
    check("doneAtとplannedDateが双方生存", combined.doneAt === "2026-08-23" && combined.plannedDate === "2026-09-10", JSON.stringify(combined));
  }

  console.log(failures === 0 ? "\ntrack-sync-characterization: 全件成功" : `\ntrack-sync-characterization: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
