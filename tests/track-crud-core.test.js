// 12WY track CRUDデータ層のfast-node検証。app.js常駐関数をVM抽出し、UIなしで副作用境界を固定する。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
function sourceBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`source markerが見つかりません: ${startMarker}`);
  return appSource.slice(start, end);
}
const trackSource = sourceBetween("function closeTracksForOwner(ownerType, ownerId, reason) {", "// v39: 開いている問い");
const deleteSource = sourceBetween("function deleteProject(id) {", "function addTask() {");
const projectSaveSource = sourceBetween("function saveProjectFromModal(id, fields) {", "// ---------- Task モーダル");

let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures += 1; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}
const clone = (value) => JSON.parse(JSON.stringify(value));

(async () => {
  const trackCore = await import(pathToFileURL(path.join(ROOT, "src", "core", "track.js")).href);
  let currentNow = "2026-08-24T12:34:56";
  let uuidCount = 0;
  let confirmResult = true;
  const sandbox = {
    String, Number, Boolean, Map, Set,
    activeTrackForProject: trackCore.activeTrackForProject,
    dateParts: trackCore.dateParts,
    latestMeasurement: trackCore.latestMeasurement,
    validateTrackDraft: trackCore.validateTrackDraft,
    trackDefinitionChanged: trackCore.trackDefinitionChanged,
    nowDateTime: () => currentNow,
    todayISO: () => "2026-08-24",
    crypto: { randomUUID: () => `uuid-${++uuidCount}` },
    window: { confirm: () => { sandbox.confirmCount += 1; return confirmResult; } },
    saveState: () => { sandbox.saveCount += 1; },
    saveAndRender: () => { sandbox.saveAndRenderCount += 1; sandbox.saveState(); },
    closeModal: () => { sandbox.closeModalCount += 1; },
    showToast: () => { sandbox.toastCount += 1; }
  };
  vm.createContext(sandbox);
  vm.runInContext(trackSource + deleteSource + projectSaveSource, sandbox);

  function project(id = "p1", extra = {}) {
    return {
      id, kind: "normal", title: id, status: "active", priority: "中", category: "",
      startDate: "", dueDate: "", description: "", twelveWeekStartDate: "2026-06-01",
      showProgress: false, createdAt: "2026-06-01T00:00:00", updatedAt: "2026-06-01T00:00:00",
      deleted: false, ...extra
    };
  }
  function numericTrack(id = "trk-old", projectId = "p1", extra = {}) {
    return {
      id, ownerType: "project", ownerId: projectId, cycleStartDate: "2026-06-01",
      kind: "numeric", name: "執筆", unit: "ページ", startDate: "2026-06-01", deadline: "2026-08-31",
      baselineValue: 0, goalValue: 100, valueStep: 5, milestones: [], status: "active",
      closedAt: "", closedReason: "", supersedesTrackId: "", carriedFromTrackId: "",
      createdAt: "2026-06-01T00:00:00", updatedAt: "2026-06-01T00:00:00", deleted: false, ...extra
    };
  }
  function milestoneTrack(id = "trk-ms-old", projectId = "p1", extra = {}) {
    return {
      ...numericTrack(id, projectId), kind: "milestone", name: "刊行", unit: "", deadline: "",
      baselineValue: 0, goalValue: 0, valueStep: 1,
      milestones: [
        { id: "ms-open", label: "初稿", plannedDate: "2026-08-20", originalPlannedDate: "2026-08-20", doneAt: "", doneChangedAt: "", updatedAt: "2026-06-01T00:00:00", deleted: false },
        { id: "ms-done", label: "構成", plannedDate: "2026-07-01", originalPlannedDate: "2026-07-01", doneAt: "2026-06-30", doneChangedAt: "2026-06-30T00:00:00", updatedAt: "2026-06-30T00:00:00", deleted: false },
        { id: "ms-deleted", label: "削除", plannedDate: "2026-08-01", originalPlannedDate: "2026-08-01", doneAt: "", doneChangedAt: "", updatedAt: "2026-07-01T00:00:00", deleted: true }
      ], ...extra
    };
  }
  function baseState(extra = {}) {
    return {
      settings: { twelveWeekStartDate: "2026-06-01" }, projects: [project()], tracks: [],
      trackMeasurements: [], ...extra
    };
  }
  function setState(value) {
    sandbox.state = value;
    sandbox.saveCount = 0;
    sandbox.saveAndRenderCount = 0;
    sandbox.closeModalCount = 0;
    sandbox.toastCount = 0;
    sandbox.confirmCount = 0;
    uuidCount = 0;
  }
  const numericFields = {
    name: "執筆", unit: "ページ", startDate: "2026-08-24", deadline: "2026-11-16",
    baselineValue: 0, goalValue: 120, valueStep: 5
  };
  const milestoneFields = {
    name: "刊行", milestones: [{ label: "初稿", plannedDate: "2026-09-10" }]
  };

  console.log("[1] closeTracksForOwnerと重複activeの操作契約");
  {
    const untouched = numericTrack("other", "p2");
    const closed = numericTrack("closed", "p1", { status: "closed", updatedAt: "old" });
    setState(baseState({ tracks: [numericTrack("a"), numericTrack("b"), untouched, closed] }));
    sandbox.closeTracksForOwner("project", "p1", "manual");
    check("同一ownerのactive全件だけを同じ理由で閉じる", sandbox.state.tracks.filter((t) => ["a", "b"].includes(t.id))
      .every((t) => t.status === "closed" && t.closedReason === "manual" && t.updatedAt === currentNow)
      && sandbox.saveCount === 0);
    check("別ownerと既closedは不変", sandbox.state.tracks[2] === untouched && sandbox.state.tracks[3] === closed);
    setState(baseState({ tracks: [numericTrack("a"), numericTrack("b")] }));
    check("操作しない限り重複activeは残り、読取だけが決定論で1本を選ぶ",
      sandbox.activeTrackForProject(sandbox.state.tracks, "p1").id === "a"
        && sandbox.state.tracks.filter((t) => t.status === "active").length === 2);
  }

  console.log("[2] saveTrackFromFormの新規作成・同一定義編集");
  {
    setState(baseState());
    const result = sandbox.saveTrackFromForm("p1", "numeric", numericFields);
    check("numericを完全なactive track形状で新規作成", result.ok && result.track.id === "trk_uuid-1"
      && result.track.ownerId === "p1" && result.track.cycleStartDate === "2026-06-01"
      && result.track.goalValue === 120 && result.track.milestones.length === 0 && result.track.createdAt === currentNow,
    JSON.stringify(result));
    check("新規作成はsaveStateを1回だけ呼ぶ", sandbox.saveCount === 1);

    setState(baseState());
    const milestoneResult = sandbox.saveTrackFromForm("p1", "milestone", milestoneFields);
    const milestone = milestoneResult.track.milestones[0];
    check("milestoneを子id・originalPlannedDate付きで新規作成", milestoneResult.ok
      && milestone.id === "ms_uuid-1" && milestone.originalPlannedDate === "2026-09-10"
      && milestone.doneAt === "" && !("createdAt" in milestone) && sandbox.saveCount === 1, JSON.stringify(milestoneResult));

    const existingMilestone = milestoneTrack("trk-ms-edit", "p1", { ownerType: "task" });
    setState(baseState({ tracks: [existingMilestone] }));
    const editedMilestone = sandbox.saveTrackFromForm("p1", "milestone", {
      name: "刊行", milestones: [{ id: "ms-done", label: "構成", plannedDate: "2026-07-01" }]
    });
    const editedDone = editedMilestone.track.milestones.find((item) => item.id === "ms-done");
    const omittedOpen = editedMilestone.track.milestones.find((item) => item.id === "ms-open");
    const priorTombstone = editedMilestone.track.milestones.find((item) => item.id === "ms-deleted");
    check("同一定義編集は脱落節目をtombstone化し既存tombstoneも保持", editedMilestone.ok
      && omittedOpen.deleted && omittedOpen.updatedAt === currentNow
      && priorTombstone.deleted && priorTombstone.updatedAt === "2026-07-01T00:00:00");
    check("省略された原予定日・完了日時を保持し未編集節目のupdatedAtを進めない",
      editedDone.originalPlannedDate === "2026-07-01" && editedDone.doneAt === "2026-06-30"
      && editedDone.doneChangedAt === "2026-06-30T00:00:00"
      && editedDone.updatedAt === "2026-06-30T00:00:00" && sandbox.saveCount === 1);
    check("同一定義編集は既存ownerTypeを明示的に保持", editedMilestone.track.ownerType === "task");

    const existing = numericTrack();
    setState(baseState({ tracks: [existing] }));
    const edited = sandbox.saveTrackFromForm("p1", "numeric", { ...numericFields, goalValue: 150, deadline: "2026-12-01" });
    check("目標値・期限だけの編集は同一id/createdAtを保ちsupersedeしない", edited.ok
      && sandbox.state.tracks.length === 1 && edited.track.id === existing.id
      && edited.track.createdAt === existing.createdAt && edited.track.updatedAt === currentNow
      && edited.track.goalValue === 150 && edited.track.deadline === "2026-12-01"
      && edited.track.supersedesTrackId === "" && sandbox.saveCount === 1);

    setState(baseState({ tracks: [numericTrack()] }));
    const whitespaceUnit = sandbox.saveTrackFromForm("p1", "numeric", { ...numericFields, unit: " ページ " });
    check("unitの前後空白だけではsupersedeせずtrimして同一trackへ保存", whitespaceUnit.ok
      && sandbox.state.tracks.length === 1 && whitespaceUnit.track.id === "trk-old"
      && whitespaceUnit.track.unit === "ページ" && sandbox.saveCount === 1);
  }

  console.log("[3] kind/unit変更のsupersedeと失敗時不変");
  {
    setState(baseState({ tracks: [numericTrack()] }));
    const changedKind = sandbox.saveTrackFromForm("p1", "milestone", milestoneFields);
    check("kind変更は旧trackをsupersededで閉じ新trackへ参照を残す", changedKind.ok
      && sandbox.state.tracks[0].closedReason === "superseded"
      && changedKind.track.kind === "milestone" && changedKind.track.supersedesTrackId === "trk-old"
      && sandbox.saveCount === 1);

    setState(baseState({ tracks: [numericTrack("a"), numericTrack("b", "p1", { createdAt: "2026-06-02T00:00:00" })] }));
    const changedUnit = sandbox.saveTrackFromForm("p1", "numeric", { ...numericFields, unit: "章" });
    check("unit変更は重複active全件を閉じて1本だけ新規作成", changedUnit.ok
      && sandbox.state.tracks.slice(0, 2).every((track) => track.status === "closed" && track.closedReason === "superseded")
      && sandbox.state.tracks.filter((track) => track.status === "active").length === 1
      && changedUnit.track.unit === "章" && changedUnit.track.supersedesTrackId === "a" && sandbox.saveCount === 1);

    setState(baseState({ tracks: [numericTrack()] }));
    const before = clone(sandbox.state);
    const invalid = sandbox.saveTrackFromForm("p1", "numeric", { ...numericFields, deadline: "" });
    check("バリデーション失敗はstate不変かつ保存しない", !invalid.ok
      && JSON.stringify(sandbox.state) === JSON.stringify(before) && sandbox.saveCount === 0, JSON.stringify(invalid));
    check("データ層はrender/toast/closeModal/saveAndRenderを呼ばない",
      !/(?:saveAndRender|showToast|closeModal|\brender)\s*\(/.test(trackSource));
  }

  console.log("[4] closeActiveTrackManual");
  {
    setState(baseState({ tracks: [] }));
    sandbox.closeActiveTrackManual("p1");
    check("active無しは保存もしないno-op", sandbox.saveCount === 0 && sandbox.state.tracks.length === 0);
    setState(baseState({ tracks: [numericTrack("a"), numericTrack("b")] }));
    sandbox.closeActiveTrackManual("p1");
    check("manual closeは重複active全件を閉じ1回保存", sandbox.saveCount === 1
      && sandbox.state.tracks.every((track) => track.status === "closed" && track.closedReason === "manual"));
  }

  console.log("[5] carryProjectToNewCycle numeric");
  {
    const invalidCycleDates = ["", "2026-02-30"].map((cycleDate) => {
      setState(baseState());
      const before = clone(sandbox.state);
      const result = sandbox.carryProjectToNewCycle("p1", cycleDate, {});
      return !result.ok && sandbox.saveCount === 0
        && JSON.stringify(sandbox.state) === JSON.stringify(before);
    });
    check("空文字・不正な新サイクル開始日はtrack無しでもstate不変・未保存", invalidCycleDates.every(Boolean));

    setState(baseState());
    const noTrack = sandbox.carryProjectToNewCycle("p1", "2026-08-24", {});
    check("track無しでもproject開始日とupdatedAtだけ更新して保存", noTrack.ok && sandbox.saveCount === 1
      && sandbox.state.projects[0].twelveWeekStartDate === "2026-08-24"
      && sandbox.state.projects[0].updatedAt === currentNow && sandbox.state.tracks.length === 0);

    setState(baseState({ tracks: [numericTrack()] }));
    const before = clone(sandbox.state);
    const missingDeadline = sandbox.carryProjectToNewCycle("p1", "2026-08-24", {});
    check("numeric deadline欠落は全state不変・未保存", !missingDeadline.ok
      && JSON.stringify(missingDeadline.errors) === JSON.stringify(["deadline必須"]) && sandbox.saveCount === 0
      && JSON.stringify(sandbox.state) === JSON.stringify(before), JSON.stringify(missingDeadline));

    setState(baseState({
      tracks: [numericTrack()],
      trackMeasurements: [
        { id: "old", trackId: "trk-old", value: 20, observedAt: "2026-08-20T10:00:00", updatedAt: "2026-08-20T10:00:00" },
        { id: "new", trackId: "trk-old", value: 35, observedAt: "2026-08-23T10:00:00", updatedAt: "2026-08-23T10:00:00" }
      ]
    }));
    const carried = sandbox.carryProjectToNewCycle("p1", "2026-08-24", { deadline: "2026-11-16", goalValue: 150 });
    check("numeric carryは最新測定をbaselineにし旧全件close後に新trackを作る", carried.ok
      && sandbox.state.tracks[0].closedReason === "carried" && carried.track.baselineValue === 35
      && carried.track.goalValue === 150 && carried.track.startDate === "2026-08-24"
      && carried.track.deadline === "2026-11-16" && carried.track.carriedFromTrackId === "trk-old"
      && carried.track.cycleStartDate === "2026-08-24" && sandbox.saveCount === 1, JSON.stringify(carried));

    setState(baseState({ tracks: [numericTrack("fallback", "p1", { baselineValue: 12 })] }));
    const fallback = sandbox.carryProjectToNewCycle("p1", "2026-08-24", { deadline: "2026-11-16", goalValue: 80 });
    check("measurement 0件時は旧baselineを使う", fallback.ok && fallback.track.baselineValue === 12);

    setState(baseState({
      tracks: [numericTrack()],
      trackMeasurements: [{ id: "goal", trackId: "trk-old", value: 100,
        observedAt: "2026-08-23T10:00:00", updatedAt: "2026-08-23T10:00:00" }]
    }));
    const completed = sandbox.carryProjectToNewCycle("p1", "2026-08-24", {});
    check("目標到達済みnumericは旧trackだけcarriedで閉じ新trackを作らない", completed.ok
      && completed.carriedWithoutTrack && !("track" in completed) && sandbox.state.tracks.length === 1
      && sandbox.state.tracks[0].closedReason === "carried"
      && sandbox.state.projects[0].twelveWeekStartDate === "2026-08-24" && sandbox.saveCount === 1);
  }

  console.log("[6] carryProjectToNewCycle milestone");
  {
    setState(baseState({ tracks: [milestoneTrack()] }));
    const carried = sandbox.carryProjectToNewCycle("p1", "2026-08-24", {
      milestonePlannedDates: { "ms-open": "2026-09-15" }
    });
    check("未完了・未削除節目だけを新idで複製し予定日を再初期化", carried.ok
      && carried.track.milestones.length === 1 && carried.track.milestones[0].id !== "ms-open"
      && carried.track.milestones[0].label === "初稿" && carried.track.milestones[0].plannedDate === "2026-09-15"
      && carried.track.milestones[0].originalPlannedDate === "2026-09-15"
      && carried.track.milestones[0].doneAt === "" && carried.track.carriedFromTrackId === "trk-ms-old"
      && carried.track.startDate === "2026-08-24" && sandbox.saveCount === 1,
    JSON.stringify(carried));

    setState(baseState({ tracks: [milestoneTrack()] }));
    const before = clone(sandbox.state);
    const invalid = sandbox.carryProjectToNewCycle("p1", "2026-08-24", {
      milestonePlannedDates: { "ms-open": "2026-08-23" }
    });
    check("開始日前plannedDateが1件でもあれば全件中断", !invalid.ok && sandbox.saveCount === 0
      && JSON.stringify(sandbox.state) === JSON.stringify(before), JSON.stringify(invalid));

    const allDone = milestoneTrack("trk-ms-done", "p1", {
      milestones: [{ id: "ms-done", label: "構成", plannedDate: "2026-07-01",
        originalPlannedDate: "2026-07-01", doneAt: "2026-06-30",
        doneChangedAt: "2026-06-30T00:00:00", updatedAt: "2026-06-30T00:00:00", deleted: false }]
    });
    setState(baseState({ tracks: [allDone] }));
    const completed = sandbox.carryProjectToNewCycle("p1", "2026-08-24", {});
    check("全節目doneのmilestoneは旧trackだけcarriedで閉じ新trackを作らない", completed.ok
      && completed.carriedWithoutTrack && !("track" in completed) && sandbox.state.tracks.length === 1
      && sandbox.state.tracks[0].closedReason === "carried"
      && sandbox.state.projects[0].twelveWeekStartDate === "2026-08-24" && sandbox.saveCount === 1);
  }

  console.log("[7] deleteProjectのtrack tombstoneと既存回帰");
  {
    const closed = numericTrack("closed", "p1", { status: "closed", updatedAt: "old" });
    const other = numericTrack("other", "p2");
    setState(baseState({ projects: [project("p1"), project("p2")], tracks: [numericTrack(), closed, other] }));
    sandbox.deleteProject("p1");
    check("削除projectのactive trackだけtombstone化", sandbox.state.tracks[0].deleted
      && sandbox.state.tracks[0].updatedAt === currentNow && sandbox.state.tracks[1] === closed && sandbox.state.tracks[2] === other);
    check("project削除は従来どおりupdatedAtを進めてsaveAndRender", sandbox.state.projects[0].deleted
      && sandbox.state.projects[0].updatedAt === currentNow && sandbox.saveAndRenderCount === 1 && sandbox.saveCount === 1);
    setState(baseState({ tracks: [] }));
    sandbox.deleteProject("p1");
    check("track無しproject削除も退行しない", sandbox.state.projects[0].deleted && sandbox.saveAndRenderCount === 1);
  }

  console.log("[8] saveProjectFromModalの12WY OFF確認分岐");
  const modalFields = {
    title: "編集後", kind: "normal", status: "active", priority: "高", category: "仕事",
    startDate: "2026-08-01", dueDate: "2026-12-01", description: "memo", is12WY: false, showProgress: true
  };
  {
    confirmResult = true;
    setState(baseState({ tracks: [numericTrack()] }));
    sandbox.saveProjectFromModal("p1", modalFields);
    check("確認Yesはmanual closeしつつ他フィールドと12WY OFFを保存", sandbox.confirmCount === 1
      && sandbox.state.tracks[0].status === "closed" && sandbox.state.tracks[0].closedReason === "manual"
      && sandbox.state.projects[0].twelveWeekStartDate === "" && sandbox.state.projects[0].title === "編集後"
      && sandbox.state.projects[0].category === "仕事" && sandbox.closeModalCount === 1
      && sandbox.saveAndRenderCount === 1 && sandbox.saveCount === 2);

    confirmResult = false;
    setState(baseState({ tracks: [numericTrack()] }));
    sandbox.saveProjectFromModal("p1", modalFields);
    check("確認Noは旧12WY日だけ戻し他フィールドを保存", sandbox.confirmCount === 1
      && sandbox.state.tracks[0].status === "active"
      && sandbox.state.projects[0].twelveWeekStartDate === "2026-06-01"
      && sandbox.state.projects[0].title === "編集後" && sandbox.state.projects[0].category === "仕事"
      && sandbox.saveCount === 1);

    confirmResult = true;
    setState(baseState({ tracks: [] }));
    sandbox.saveProjectFromModal("p1", modalFields);
    check("active track無しは確認せず通常保存", sandbox.confirmCount === 0
      && sandbox.state.projects[0].twelveWeekStartDate === "" && sandbox.state.projects[0].title === "編集後"
      && sandbox.saveCount === 1);
    check("確認文言は半角?、track追加は再代入スタイル", /12WYトラックを終了しますか\?/.test(projectSaveSource)
      && !/state\.tracks\.push\s*\(/.test(trackSource));
  }

  console.log(failures === 0 ? "\ntrack-crud-core: 全件成功" : `\ntrack-crud-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
