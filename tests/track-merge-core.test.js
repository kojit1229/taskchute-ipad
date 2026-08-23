// track-merge-core.test.js — 12WY二軸MVPの特殊マージ純関数テスト。
const path = require("path");
const { pathToFileURL } = require("url");

const MODULE_PATH = path.join(__dirname, "..", "src", "core", "merge.js");
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function milestone(overrides = {}) {
  return {
    id: "ms_1", label: "節目", plannedDate: "2026-09-01", originalPlannedDate: "2026-09-01",
    doneAt: "", doneChangedAt: "", updatedAt: "2026-08-23T10:00:00", deleted: false,
    ...overrides
  };
}

function track(overrides = {}) {
  return {
    id: "trk_1", name: "Track", milestones: [], updatedAt: "2026-08-23T10:00:00", deleted: false,
    ...overrides
  };
}

function item(overrides = {}) {
  return {
    id: "wci_2026-08-22_b1", recordType: "item", title: "Block", source: "confirmed", lane: "task",
    excused: false, excusedReason: "", excusedChangedAt: "", completedAt: "", completedChangedAt: "",
    updatedAt: "2026-08-23T10:00:00", deleted: false, ...overrides
  };
}

(async () => {
  const { mergeTracksPreferNewer, mergeWeeklyCommitments } = await import(pathToFileURL(MODULE_PATH).href);

  console.log("[tracks-1] トラックレコード勝者選択");
  {
    const local = track({ name: "local", updatedAt: "2026-08-23T10:00:00" });
    const remote = track({ name: "remote", updatedAt: "2026-08-23T11:00:00" });
    const newer = mergeTracksPreferNewer([local], [remote], "local")[0];
    check("updatedAtが新しいremoteレコードが勝つ", newer === remote);

    const deleted = track({ name: "deleted", updatedAt: remote.updatedAt, deleted: true });
    const tombstone = mergeTracksPreferNewer([remote], [deleted], "local")[0];
    check("同時刻は親トラックのtombstoneがtieWinnerより優先される", tombstone === deleted);
  }

  console.log("[tracks-2] 節目和集合と同一節目フィールド別マージ");
  {
    const localOnly = milestone({ id: "ms_local" });
    const remoteOnly = milestone({ id: "ms_remote" });
    const union = mergeTracksPreferNewer(
      [track({ milestones: [localOnly] })],
      [track({ milestones: [remoteOnly], updatedAt: "2026-08-23T11:00:00" })],
      "local"
    )[0];
    check("節目id単位の和集合になる", union.milestones.length === 2
      && union.milestones.some((m) => m.id === "ms_local")
      && union.milestones.some((m) => m.id === "ms_remote"));

    const localDone = milestone({
      doneAt: "2026-08-23", doneChangedAt: "2026-08-23T12:00:00", updatedAt: "2026-08-23T10:00:00"
    });
    const remotePlanned = milestone({
      plannedDate: "2026-09-10", doneAt: "", doneChangedAt: "2026-08-23T09:00:00",
      updatedAt: "2026-08-23T11:00:00"
    });
    const combined = mergeTracksPreferNewer(
      [track({ milestones: [localDone] })],
      [track({ milestones: [remotePlanned], updatedAt: "2026-08-23T11:00:00" })],
      "remote"
    )[0].milestones[0];
    check("doneAtとplannedDateの同時編集が両立する",
      combined.doneAt === "2026-08-23" && combined.plannedDate === "2026-09-10",
      JSON.stringify(combined));
  }

  console.log("[tracks-3] 節目tombstone・doneChangedAt同秒tie");
  {
    const alive = milestone({ updatedAt: "2026-08-23T10:00:00" });
    const deleted = milestone({ updatedAt: "2026-08-23T11:00:00", deleted: true });
    const tombstone = mergeTracksPreferNewer(
      [track({ milestones: [alive] })],
      [track({ milestones: [deleted], updatedAt: "2026-08-23T11:00:00" })],
      "local"
    )[0].milestones[0];
    check("節目deletedはupdatedAtが新しい側から採る", tombstone.deleted === true);

    const local = milestone({ doneAt: "local", doneChangedAt: "2026-08-23T12:00:00" });
    const remote = milestone({ doneAt: "remote", doneChangedAt: "2026-08-23T12:00:00" });
    const tieLocal = mergeTracksPreferNewer(
      [track({ milestones: [local] })], [track({ milestones: [remote] })], "local"
    )[0].milestones[0];
    const tieRemote = mergeTracksPreferNewer(
      [track({ milestones: [local] })], [track({ milestones: [remote] })], "remote"
    )[0].milestones[0];
    check("doneChangedAt同秒tieは親と同じtieWinnerで決定する",
      tieLocal.doneAt === "local" && tieRemote.doneAt === "remote");

    const localDeleted = milestone({
      doneAt: "deleted", doneChangedAt: "2026-08-23T12:00:00", deleted: true
    });
    const tombstoneTie = mergeTracksPreferNewer(
      [track({ milestones: [localDeleted] })], [track({ milestones: [remote] })], "remote"
    )[0].milestones[0];
    check("doneChangedAt同秒tieでも節目tombstoneがtieWinnerより優先される",
      tombstoneTie.doneAt === "deleted" && tombstoneTie.deleted === true);
  }

  console.log("[tracks-4] 参照安定性");
  {
    const winnerMilestone = milestone({ updatedAt: "2026-08-23T11:00:00" });
    const winner = track({ milestones: [winnerMilestone], updatedAt: "2026-08-23T11:00:00" });
    const loser = track({ milestones: [milestone()], updatedAt: "2026-08-23T10:00:00" });
    const result = mergeTracksPreferNewer([winner], [loser], "remote")[0];
    check("合成内容が勝者milestonesと同一なら勝者トラック参照を返す", result === winner);

    const loserWithoutMilestones = track({ milestones: undefined, updatedAt: "2026-08-23T10:00:00" });
    const winnerWithoutMilestones = track({ milestones: undefined, updatedAt: "2026-08-23T12:00:00" });
    const guarded = mergeTracksPreferNewer([loserWithoutMilestones], [winnerWithoutMilestones], "remote")[0];
    check("勝者milestonesが非配列でも例外化せず空配列相当で参照を保つ", guarded === winnerWithoutMilestones);
  }

  console.log("[weekly-1] week manual優先");
  {
    const manual = { id: "wcw_2026-08-22", recordType: "week", committedVia: "manual", updatedAt: "2026-08-23T09:00:00" };
    const auto = { id: manual.id, recordType: "week", committedVia: "auto", updatedAt: "2026-08-23T12:00:00" };
    check("manualはupdatedAtが古くてもautoに勝つ",
      mergeWeeklyCommitments([manual], [auto], "remote")[0] === manual);
  }

  console.log("[weekly-2] item独立フィールド・優先順位マージ");
  {
    const local = item({
      title: "local", excused: true, excusedReason: "休養", excusedChangedAt: "2026-08-23T12:00:00",
      completedAt: "", completedChangedAt: "2026-08-23T09:00:00", updatedAt: "2026-08-23T10:00:00"
    });
    const remote = item({
      title: "remote", completedAt: "2026-08-23T11:00:00", completedChangedAt: "2026-08-23T11:00:00",
      excusedChangedAt: "2026-08-23T09:00:00", updatedAt: "2026-08-23T11:00:00"
    });
    const combined = mergeWeeklyCommitments([local], [remote], "remote")[0];
    check("excused系とcompletedAt系の同時編集が両立する",
      combined.excused === true && combined.excusedReason === "休養"
      && combined.completedAt === "2026-08-23T11:00:00" && combined.title === "remote",
      JSON.stringify(combined));

    const added = item({ source: "added", updatedAt: "2026-08-23T09:00:00" });
    const auto = item({ source: "auto", updatedAt: "2026-08-23T12:00:00" });
    check("sourceはupdatedAtよりadded優先で後退しない",
      mergeWeeklyCommitments([added], [auto], "remote")[0].source === "added");

    for (const [higher, lower] of [["added", "confirmed"], ["confirmed", "auto"]]) {
      const higherOlder = item({ source: higher, updatedAt: "2026-08-23T09:00:00" });
      const lowerNewer = item({ source: lower, updatedAt: "2026-08-23T12:00:00" });
      check(`source隣接順位${higher}>${lower}は高順位側が旧でも勝つ`,
        mergeWeeklyCommitments([higherOlder], [lowerNewer], "remote")[0].source === higher);

      const lowerOlder = item({ source: lower, updatedAt: "2026-08-23T09:00:00" });
      const higherNewer = item({ source: higher, updatedAt: "2026-08-23T12:00:00" });
      check(`source隣接順位${higher}>${lower}は高順位側が新でも勝つ`,
        mergeWeeklyCommitments([lowerOlder], [higherNewer], "remote")[0].source === higher);
    }

    const cycle = item({ lane: "cycle", updatedAt: "2026-08-23T09:00:00" });
    const taskNewer = item({ lane: "task", updatedAt: "2026-08-23T12:00:00" });
    const once = mergeWeeklyCommitments([cycle], [taskNewer], "remote")[0];
    const twice = mergeWeeklyCommitments([once], [item({ lane: "task", updatedAt: "2026-08-23T13:00:00" })], "remote")[0];
    check("laneはcycle>taskで再upsertしても後退しない", once.lane === "cycle" && twice.lane === "cycle");
  }

  console.log("[weekly-3] tombstone・ChangedAt同秒tie・参照安定性");
  {
    const deleted = item({ deleted: true });
    const alive = item({ deleted: false });
    const tombstone = mergeWeeklyCommitments([deleted], [alive], "remote")[0];
    check("updatedAt同値のitemはtombstoneが勝つ", tombstone.deleted === true);

    const local = item({
      excused: true, excusedReason: "local", excusedChangedAt: "2026-08-23T12:00:00",
      completedAt: "local", completedChangedAt: "2026-08-23T12:00:00", updatedAt: "2026-08-23T10:00:00"
    });
    const remoteBase = item({
      excused: false, excusedReason: "remote", excusedChangedAt: "2026-08-23T12:00:00",
      completedAt: "remote", completedChangedAt: "2026-08-23T12:00:00", updatedAt: "2026-08-23T11:00:00"
    });
    const tied = mergeWeeklyCommitments([local], [remoteBase], "local")[0];
    check("各ChangedAt同秒tieはupdatedAtで選ばれたベース側を採る",
      tied.excused === false && tied.excusedReason === "remote" && tied.completedAt === "remote");

    const older = item({ updatedAt: "2026-08-23T10:00:00", source: "auto", lane: "task" });
    const winner = item({ updatedAt: "2026-08-23T11:00:00", source: "added", lane: "cycle" });
    const stable = mergeWeeklyCommitments([older], [winner], "local")[0];
    check("フィールド別マージ結果がベースと同一ならベース参照を返す", stable === winner);
  }

  console.log(failures === 0 ? "\ntrack-merge-core: 全件成功" : `\ntrack-merge-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
