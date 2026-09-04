// 単位16 characterization: runArchiveのtombstone/archivedDates化が、第1回コードレビュー
// area-1-merge-tombstone.md H-2(repro-area1b相当)を解消したことをNodeで固定する。
//
// 検証内容(ブリーフ完了条件1〜2対応):
//   (a) アーカイブ済み端末とアーカイブ前端末が同期しても、剪定した journals/feedback は
//       archivedDates 除外により復活しない。
//   (b) 両端末で別日を archive → archivedDates が和集合になる。
//   (c) archive していない日付は従来どおり和集合マージされる(退行なし)。
//   (d) 180日超の block は物理削除されず、tombstone(deleted:true)化され、マージで復活しない。
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
    requireGitHubConfig: noop, fetchGitHubFileSHA: noop, personalDataReady: () => true, personalDataFileConfig: noop,
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

(async () => {
  const storeMod = await import(pathToFileURL(path.join(ROOT, "src", "state", "store.js")).href);
  const syncMod = await import(pathToFileURL(path.join(ROOT, "src", "sync", "github.js")).href);
  configureMinimalStubs(syncMod);

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
    const merged = syncMod.computeSyncMerge(remote, "local");
    const result = merged.values.blocks.find((b) => b.id === "b-old");
    check("tombstone(deleted:true)が勝つ・本文は蘇らない",
      !!result && result.deleted === true && !("title" in result), JSON.stringify(result));
  }

  console.log(failures === 0 ? "\narchive-tombstone-sync: 全件成功" : `\narchive-tombstone-sync: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
