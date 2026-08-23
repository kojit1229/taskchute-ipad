// track-core.test.js — 12WYの週次実行スコア・成果ペース・状態判定を固定するfast-nodeテスト。
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const MODULE_PATH = path.join(__dirname, "..", "src", "core", "track.js");
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures += 1; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}

function same(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function meta(weekStart, committedVia = "auto", selectedBlockIds = []) {
  return { id: `w_${weekStart}`, recordType: "week", weekStart, committedVia, selectedBlockIds, updatedAt: "2026-08-01T00:00:00" };
}

function item(id, weekStart, extra = {}) {
  return {
    id, recordType: "item", weekStart, blockId: id, lane: "cycle", source: "auto",
    completedAt: "", excused: false, updatedAt: "2026-08-01T00:00:00", ...extra
  };
}

(async () => {
  const mod = await import(pathToFileURL(MODULE_PATH).href);
  const {
    dateParts, daysBetween, weeklyScore, latestMeasurement, paceNumeric, paceMilestone,
    trackStatus, forwardTracksForWeek, selectTrackFooter, activeTrackForProject,
    validateTrackDraft, trackDefinitionChanged, PACE_TOLERANCE_DAYS, STALE_DAYS
  } = mod;

  console.log("[1] 日付ヘルパーと依存ゼロ契約");
  check("datePartsは日付を数値へ分解する", same(dateParts("2026-08-23"), { y: 2026, m: 8, d: 23 }));
  check("うるう年跨ぎは2日", daysBetween("2024-02-28", "2024-03-01") === 2);
  check("月末跨ぎは1日", daysBetween("2026-04-30", "2026-05-01") === 1);
  check("不正日付はnull/NaN", dateParts("2026-02-30") === null && Number.isNaN(daysBetween("bad", "2026-01-01")));
  const source = fs.readFileSync(MODULE_PATH, "utf8");
  check("new Date(文字列)を使わない", !/new\s+Date\s*\(\s*["'`]/.test(source));
  check("state/store.js/app.jsをimportしない", !/^\s*import\s/m.test(source)
    && !/from\s*["'][^"']*(?:state|store\.js|app\.js)/.test(source));

  console.log("[1b] track保存前の構造バリデーションと計測定義変更");
  const validNumeric = {
    name: "執筆", unit: "ページ", startDate: "2026-08-24", deadline: "2026-11-16",
    baselineValue: 0, goalValue: 100, valueStep: 5
  };
  const validMilestone = { name: "刊行", milestones: [{ label: "初稿", plannedDate: "2026-09-10" }] };
  check("numeric最小構成は合格", validateTrackDraft("numeric", validNumeric).ok);
  check("milestone最小構成は合格", validateTrackDraft("milestone", validMilestone).ok);
  const invalidNumeric = [
    { ...validNumeric, deadline: "" },
    { ...validNumeric, startDate: validNumeric.deadline },
    { ...validNumeric, startDate: "2026-12-01" },
    { ...validNumeric, goalValue: validNumeric.baselineValue },
    { ...validNumeric, valueStep: 0 },
    { ...validNumeric, baselineValue: "not-number" }
  ];
  check("numeric各違反を個別に拒否", invalidNumeric.every((draft) => !validateTrackDraft("numeric", draft).ok),
    JSON.stringify(invalidNumeric.map((draft) => validateTrackDraft("numeric", draft))));
  const missingDates = validateTrackDraft("numeric", { ...validNumeric, startDate: "", deadline: "" });
  check("startDate必須はdeadline必須と独立に通知", missingDates.errors.includes("startDate必須")
    && missingDates.errors.includes("deadline必須"), JSON.stringify(missingDates));
  const invalidMilestones = [
    { ...validMilestone, milestones: [] },
    { ...validMilestone, milestones: [{ label: "", plannedDate: "2026-09-10" }] },
    { ...validMilestone, milestones: [{ label: "初稿", plannedDate: "" }] }
  ];
  check("milestone各違反を個別に拒否", invalidMilestones.every((draft) => !validateTrackDraft("milestone", draft).ok),
    JSON.stringify(invalidMilestones.map((draft) => validateTrackDraft("milestone", draft))));
  const existingDefinition = { kind: "numeric", unit: "ページ" };
  check("kind変更とunit変更だけをsupersede対象にする",
    trackDefinitionChanged(existingDefinition, "milestone", validMilestone)
      && trackDefinitionChanged(existingDefinition, "numeric", { ...validNumeric, unit: "章" })
      && !trackDefinitionChanged(existingDefinition, "numeric", { ...validNumeric, unit: " ページ " })
      && !trackDefinitionChanged(existingDefinition, "numeric", { ...validNumeric, goalValue: 200, deadline: "2026-12-01" }));

  console.log("[2] weeklyScore");
  const week = "2026-08-22";
  check("週メタなしは未確定", same(weeklyScore([], week), { status: "uncommitted" }));
  check("scope内item 0件は未確定", same(weeklyScore([meta(week), item("task", week, { lane: "task" })], week), { status: "uncommitted" }));
  check("全免除はN/A", same(weeklyScore([
    meta(week), item("a", week, { excused: true }), item("b", week, { excused: true })
  ], week), { status: "na" }));
  const rounded = weeklyScore([
    meta(week), item("a", week, { completedAt: "2026-08-23T10:00:00" }),
    item("b", week, { completedAt: "2026-08-24T10:00:00" }), item("c", week)
  ], week);
  check("四捨五入した整数%を返す", same(rounded, { status: "scored", done: 2, total: 3, pct: 67 }), JSON.stringify(rounded));
  const excused = weeklyScore([
    meta(week), item("a", week, { completedAt: "2026-08-23T10:00:00" }), item("b", week),
    item("c", week, { excused: true })
  ], week);
  check("免除itemは分母から除外する", same(excused, { status: "scored", done: 1, total: 2, pct: 50 }), JSON.stringify(excused));
  const manual = weeklyScore([
    meta(week, "manual", ["selected"]), item("selected", week, { completedAt: "2026-08-23T10:00:00" }),
    item("auto-extra", week, { completedAt: "2026-08-23T10:00:00" }), item("added", week, { source: "added" })
  ], week);
  check("manualは選択item+addedだけをscopeにする", same(manual, { status: "scored", done: 1, total: 2, pct: 50 }), JSON.stringify(manual));
  const deduped = weeklyScore([
    meta(week), item("dup", week, { updatedAt: "2026-08-01T00:00:00" }),
    item("dup", week, { completedAt: "2026-08-23T10:00:00", updatedAt: "2026-08-02T00:00:00" })
  ], week);
  check("同一idはupdatedAt最大の1件だけを採点する", same(deduped, { status: "scored", done: 1, total: 1, pct: 100 }), JSON.stringify(deduped));
  const pastRecords = [meta("2026-08-15"), item("past", "2026-08-15", { completedAt: "2026-08-16T10:00:00" })];
  const pastBefore = weeklyScore(pastRecords, "2026-08-15");
  const pastAfter = weeklyScore([...pastRecords, meta(week), item("current", week)], "2026-08-15");
  check("別週の追加で過去週スコアは変わらない", same(pastBefore, pastAfter), JSON.stringify(pastAfter));

  console.log("[3] paceNumeric");
  const numeric = { kind: "numeric", startDate: "2026-01-01", deadline: "2026-01-11", baselineValue: 0, goalValue: 100 };
  const linear = paceNumeric(numeric, 60, "2026-01-06");
  check("線形補間でexpected/diffを返す", linear.expected === 50 && linear.diffRaw === 10 && linear.diffNorm === 10, JSON.stringify(linear));
  check("toleranceは3.5日分", PACE_TOLERANCE_DAYS === 3.5 && linear.tolerance === 35, JSON.stringify(linear));
  const decreasing = paceNumeric({ ...numeric, baselineValue: 100, goalValue: 80 }, 85, "2026-01-06");
  check("減少目標でも目標方向を正に正規化する", decreasing.expected === 90 && decreasing.diffRaw === -5 && decreasing.diffNorm === 5, JSON.stringify(decreasing));
  const baselinePace = paceNumeric(numeric, latestMeasurement([], "trk")?.value, "2026-01-06");
  check("measurement 0件はbaselineValueを最新値に使う", baselinePace.diffRaw === -50 && baselinePace.diffNorm === -50, JSON.stringify(baselinePace));
  const atPositiveTolerance = paceNumeric(numeric, 85, "2026-01-06");
  const overPositiveTolerance = paceNumeric(numeric, 85.001, "2026-01-06");
  const atNegativeTolerance = paceNumeric(numeric, 15, "2026-01-06");
  const underNegativeTolerance = paceNumeric(numeric, 14.999, "2026-01-06");
  check("+3.5日境界は順調、超過で先行", trackStatus(numeric, atPositiveTolerance, 85, "2026-01-06", "2026-01-06").state === "ontrack"
    && trackStatus(numeric, overPositiveTolerance, 85.001, "2026-01-06", "2026-01-06").state === "ahead");
  check("-3.5日境界は順調、下回ると要注意", trackStatus(numeric, atNegativeTolerance, 15, "2026-01-06", "2026-01-06").state === "ontrack"
    && trackStatus(numeric, underNegativeTolerance, 14.999, "2026-01-06", "2026-01-06").state === "warn");
  const invalidPaces = [
    paceNumeric({ ...numeric, deadline: numeric.startDate }, 1, "2026-01-01"),
    paceNumeric({ ...numeric, deadline: "2025-12-31" }, 1, "2026-01-01"),
    paceNumeric({ ...numeric, goalValue: numeric.baselineValue }, 1, "2026-01-01")
  ];
  check("期限0日・逆転・goal=baselineは0除算せずinvalid", invalidPaces.every((pace) => same(pace, { invalid: true })), JSON.stringify(invalidPaces));

  console.log("[4] paceMilestone");
  const milestoneTrack = {
    kind: "milestone",
    milestones: [
      { id: "m1", label: "構成", plannedDate: "2026-01-05", doneAt: "2026-01-04" },
      { id: "m2", label: "初稿", plannedDate: "2026-01-10", doneAt: "" },
      { id: "m3", label: "日付未設定", plannedDate: "", doneAt: "" },
      { id: "m4", label: "削除済", plannedDate: "2026-01-31", doneAt: "", deleted: true }
    ]
  };
  const milestonePace = paceMilestone(milestoneTrack, "2026-01-06");
  check("節目のdone/expected/diffを返す", milestonePace.done === 1 && milestonePace.total === 3
    && milestonePace.expected === 1 && milestonePace.diffNorm === 0, JSON.stringify(milestonePace));
  check("空plannedDateをexpectedから除外する", milestonePace.expected === 1, JSON.stringify(milestonePace));
  check("未削除節目の最大plannedDateを期限にする", milestonePace.deadline === "2026-01-10", JSON.stringify(milestonePace));

  console.log("[5] trackStatus契約と判定順");
  const statusTrack = { ...numeric, deadline: "2026-01-20" };
  check("invalidは最優先で順調契約", same(trackStatus(statusTrack, { invalid: true }, 100, "", "2026-01-21"),
    { state: "ontrack", label: "順調", severity: 2 }));
  check("完了は期限超過より優先", same(trackStatus(statusTrack, { diffNorm: 0, tolerance: 1 }, 100, "2026-01-01", "2026-01-21"),
    { state: "done", label: "完了", severity: 0 }));
  check("期限超過は未更新より優先してseverity 5", same(trackStatus(statusTrack, { diffNorm: -9, tolerance: 1 }, 50, "2026-01-01", "2026-01-21"),
    { state: "warn", label: "期限超過", severity: 5 }));
  check("7日未更新はまだ順調", same(trackStatus(statusTrack, { diffNorm: 0, tolerance: 1 }, 50, "2026-01-03", "2026-01-10"),
    { state: "ontrack", label: "順調", severity: 2 }));
  check("8日未更新は先行判定より優先して未更新", STALE_DAYS === 8 && same(trackStatus(statusTrack, { diffNorm: 9, tolerance: 1 }, 50, "2026-01-02", "2026-01-10"),
    { state: "stale", label: "未更新", severity: 3 }));
  check("許容幅超の先行", same(trackStatus(statusTrack, { diffNorm: 2, tolerance: 1 }, 50, "2026-01-10", "2026-01-10"),
    { state: "ahead", label: "先行", severity: 1 }));
  check("許容幅内は順調", same(trackStatus(statusTrack, { diffNorm: -1, tolerance: 1 }, 50, "2026-01-10", "2026-01-10"),
    { state: "ontrack", label: "順調", severity: 2 }));
  check("許容幅を遅れると要注意", same(trackStatus(statusTrack, { diffNorm: -1.01, tolerance: 1 }, 50, "2026-01-10", "2026-01-10"),
    { state: "warn", label: "要注意", severity: 4 }));
  check("milestoneにはstale判定がない", trackStatus(milestoneTrack, { ...milestonePace, diffNorm: -1 }, 0, "2020-01-01", "2026-01-06").label === "要注意");

  console.log("[6] 前進判定");
  const progressTracks = [
    { id: "up", kind: "numeric", baselineValue: 0, goalValue: 20 },
    { id: "down", kind: "numeric", baselineValue: 100, goalValue: 80 },
    { id: "wrong", kind: "numeric", baselineValue: 0, goalValue: 10 },
    { id: "new", kind: "numeric", baselineValue: 0, goalValue: 10 },
    { id: "ms", kind: "milestone", milestones: [
      { label: "週内完了", doneAt: "2026-08-25" }, { label: "前週完了", doneAt: "2026-08-20" },
      { label: "削除済", doneAt: "2026-08-26", deleted: true }
    ] }
  ];
  const progressMeasurements = [
    { id: "u0", trackId: "up", value: 10, observedAt: "2026-08-21T10:00:00", updatedAt: "2026-08-21T10:00:00" },
    { id: "u1", trackId: "up", value: 12, observedAt: "2026-08-23T10:00:00", updatedAt: "2026-08-23T10:00:00" },
    { id: "u2", trackId: "up", value: 15, observedAt: "2026-08-24T10:00:00", updatedAt: "2026-08-24T10:00:00" },
    { id: "d0", trackId: "down", value: 95, observedAt: "2026-08-21T10:00:00", updatedAt: "2026-08-21T10:00:00" },
    { id: "d1", trackId: "down", value: 90, observedAt: "2026-08-24T10:00:00", updatedAt: "2026-08-24T10:00:00" },
    { id: "w0", trackId: "wrong", value: 5, observedAt: "2026-08-21T10:00:00", updatedAt: "2026-08-21T10:00:00" },
    { id: "w1", trackId: "wrong", value: 4, observedAt: "2026-08-24T10:00:00", updatedAt: "2026-08-24T10:00:00" },
    { id: "n1", trackId: "new", value: 2, observedAt: "2026-08-24T10:00:00", updatedAt: "2026-08-24T10:00:00" }
  ];
  const forwards = forwardTracksForWeek(progressTracks, progressMeasurements, "2026-08-22", "2026-08-28");
  check("numeric増加/減少とbaseline起点の前進だけを返す", same(forwards.slice(0, 3), [
    { trackId: "up", delta: 5 }, { trackId: "down", delta: -5 }, { trackId: "new", delta: 2 }
  ]), JSON.stringify(forwards));
  check("milestoneは週内完了ラベルをdeltaに返す", same(forwards[3], { trackId: "ms", delta: ["週内完了"] }), JSON.stringify(forwards));

  console.log("[7] TRACKSフッタ選抜");
  const footer = selectTrackFooter([
    { track: { id: "done", status: "active" }, status: { state: "done", severity: 0 } },
    { track: { id: "closed", status: "closed" }, status: { state: "warn", severity: 5 } },
    { track: { id: "on", status: "active" }, status: { state: "ontrack", severity: 2 } },
    { track: { id: "warn", status: "active" }, status: { state: "warn", severity: 4 } },
    { track: { id: "overdue", status: "active" }, status: { state: "warn", severity: 5 } },
    { track: { id: "stale", status: "active" }, status: { state: "stale", severity: 3 } }
  ]);
  check("severity降順でdone/closedを除外し最大2件", same(footer.map((entry) => entry.track.id), ["overdue", "warn"]), JSON.stringify(footer));
  const healthy = selectTrackFooter([
    { track: { id: "ahead", status: "active" }, status: { state: "ahead", severity: 1 } },
    { track: { id: "ontrack", status: "active" }, status: { state: "ontrack", severity: 2 } }
  ]);
  check("全てahead/ontrackなら先頭1件", healthy.length === 1 && healthy[0].track.id === "ontrack", JSON.stringify(healthy));
  check("0件なら非描画を表す空配列", same(selectTrackFooter([]), []));

  console.log("[8] measurement最新tieとactive track決定論");
  const tieMeasurements = [
    { id: "z", trackId: "t", value: 1, observedAt: "2026-08-23T10:00:00", updatedAt: "2026-08-23T11:00:00" },
    { id: "y", trackId: "t", value: 2, observedAt: "2026-08-23T11:00:00", updatedAt: "2026-08-23T10:00:00" },
    { id: "b", trackId: "t", value: 3, observedAt: "2026-08-23T11:00:00", updatedAt: "2026-08-23T12:00:00" },
    { id: "a", trackId: "t", value: 4, observedAt: "2026-08-23T11:00:00", updatedAt: "2026-08-23T12:00:00" },
    { id: "deleted", trackId: "t", value: 99, observedAt: "2026-08-24T11:00:00", updatedAt: "2026-08-24T12:00:00", deleted: true }
  ];
  check("observedAt最大→updatedAt最大→id辞書順昇順", latestMeasurement(tieMeasurements, "t")?.id === "a",
    JSON.stringify(latestMeasurement(tieMeasurements, "t")));
  const tracks = [
    { id: "later", ownerId: "p", status: "active", createdAt: "2026-08-23T11:00:00" },
    { id: "b", ownerId: "p", status: "active", createdAt: "2026-08-23T10:00:00" },
    { id: "a", ownerId: "p", status: "active", createdAt: "2026-08-23T10:00:00" },
    { id: "deleted", ownerId: "p", status: "active", createdAt: "2026-08-22T10:00:00", deleted: true },
    { id: "closed", ownerId: "p", status: "closed", createdAt: "2026-08-21T10:00:00" },
    { id: "other", ownerId: "q", status: "active", createdAt: "2026-08-20T10:00:00" }
  ];
  check("2端末重複activeはcreatedAt最小→id辞書順", activeTrackForProject(tracks, "p")?.id === "a",
    JSON.stringify(activeTrackForProject(tracks, "p")));
  check("該当active trackなしはnull", activeTrackForProject(tracks, "missing") === null);

  console.log(failures === 0 ? "\ntrack-core: 全件成功" : `\ntrack-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
