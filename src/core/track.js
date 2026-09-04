// src/core/track.js — v239: 12WY二軸MVPのスコア・成果トラック純関数。
// state / store.js / app.js に依存しない葉モジュールとして、日付もUTC数値演算だけで扱う。

const PACE_TOLERANCE_DAYS = 3.5;
const STALE_DAYS = 8;

function dateParts(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!match) return null;
  const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return m >= 1 && m <= 12 && d >= 1 && d <= monthDays[m - 1] ? { y, m, d } : null;
}

function daysBetween(aISO, bISO) {
  const a = dateParts(aISO), b = dateParts(bISO);
  if (!a || !b) return Number.NaN;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

// v259: 12WYの現サイクルは開始日から83日後までを包含する。
function isProjectInCurrentCycle(project, cycleStart) {
  if (!dateParts(cycleStart) || !dateParts(project?.twelveWeekStartDate)) return false;
  const offset = daysBetween(cycleStart, project.twelveWeekStartDate);
  return offset >= 0 && offset <= 83;
}

// v259: numeric目標の増加・減少方向を共通化し、到達超過も完了として扱う。
function numericGoalReached(track, latestValue) {
  const baseline = Number(track?.baselineValue), goal = Number(track?.goalValue), latest = Number(latestValue);
  const direction = Math.sign(goal - baseline);
  return Number.isFinite(baseline) && Number.isFinite(goal) && Number.isFinite(latest)
    && direction !== 0 && (latest - goal) * direction >= 0;
}

function dedupeById(records) {
  const byId = new Map();
  for (const record of records || []) {
    const current = byId.get(record.id);
    if (!current || String(record.updatedAt || "") > String(current.updatedAt || "")) byId.set(record.id, record);
  }
  return [...byId.values()];
}

// v336: weeklyScore/taskWeekTriple(plan.js)が共有する「その週の採点対象item」抽出。
// 週メタ無し・lane==="cycle"のitemが無い週は[]。committedVia==="manual"週はselectedBlockIds
// 経由 or source==="added"のitemだけへスコープを絞る(手動確定週の採点分母をここで一本化)。
function weeklyCommittedItems(weeklyCommitments, weekStart) {
  const records = dedupeById(weeklyCommitments);
  const meta = records.find((record) => record.recordType === "week" && record.weekStart === weekStart && !record.deleted);
  if (!meta) return [];
  const laneItems = records.filter((record) => record.recordType === "item" && record.weekStart === weekStart
    && !record.deleted && record.lane === "cycle");
  if (!laneItems.length) return [];
  const selected = new Set(Array.isArray(meta.selectedBlockIds) ? meta.selectedBlockIds : []);
  return meta.committedVia === "manual"
    ? laneItems.filter((item) => selected.has(item.blockId) || item.source === "added")
    : laneItems;
}

function weeklyScore(weeklyCommitments, weekStart) {
  const scope = weeklyCommittedItems(weeklyCommitments, weekStart);
  if (!scope.length) return { status: "uncommitted" };
  const active = scope.filter((item) => !item.excused);
  if (!active.length) return { status: "na" };
  const done = active.filter((item) => item.completedAt).length;
  return { status: "scored", done, total: active.length, pct: Math.round(done / active.length * 100) };
}

function latestMeasurement(measurements, trackId) {
  let latest = null;
  for (const measurement of measurements || []) {
    if (measurement.deleted || measurement.trackId !== trackId) continue;
    if (!latest
      || String(measurement.observedAt || "") > String(latest.observedAt || "")
      || (measurement.observedAt === latest.observedAt
        && String(measurement.updatedAt || "") > String(latest.updatedAt || ""))
      || (measurement.observedAt === latest.observedAt && measurement.updatedAt === latest.updatedAt
        && String(measurement.id || "") < String(latest.id || ""))) latest = measurement;
  }
  return latest;
}

function paceNumeric(track, latestValue, todayISO) {
  const baseline = Number(track?.baselineValue), goal = Number(track?.goalValue);
  const totalDays = daysBetween(track?.startDate, track?.deadline);
  if (!Number.isFinite(baseline) || !Number.isFinite(goal) || !Number.isFinite(totalDays)
    || totalDays <= 0 || goal === baseline) return { invalid: true };
  const elapsedRaw = daysBetween(track.startDate, todayISO);
  if (!Number.isFinite(elapsedRaw)) return { invalid: true };
  const elapsed = Math.max(0, Math.min(totalDays, elapsedRaw));
  const expected = baseline + (goal - baseline) * (elapsed / totalDays);
  const latest = latestValue === null || latestValue === undefined || latestValue === "" ? baseline : Number(latestValue);
  if (!Number.isFinite(latest)) return { invalid: true };
  const diffRaw = latest - expected;
  const diffNorm = diffRaw * Math.sign(goal - baseline);
  const tolerance = Math.abs(goal - baseline) / totalDays * PACE_TOLERANCE_DAYS;
  return { expected, diffRaw, diffNorm, tolerance };
}

function paceMilestone(track, todayISO) {
  const milestones = (track?.milestones || []).filter((milestone) => !milestone.deleted);
  const plannedDates = milestones.map((milestone) => milestone.plannedDate).filter(Boolean);
  const done = milestones.filter((milestone) => milestone.doneAt).length;
  const expected = milestones.filter((milestone) => milestone.plannedDate && milestone.plannedDate <= todayISO).length;
  const deadline = plannedDates.length ? plannedDates.reduce((latest, date) => date > latest ? date : latest) : "";
  return { done, total: milestones.length, expected, diffNorm: done - expected, deadline };
}

// v282: milestone進捗は完了判定・paceMilestoneとは独立した表示用メタデータ。
function normalizeMilestoneProgress(progress) {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return undefined;
  const type = progress.type;
  if (!["count", "percent", "value"].includes(type)
    || typeof progress.current !== "number" || !Number.isFinite(progress.current)
    || typeof progress.unit !== "string") return undefined;
  const start = progress.start;
  if (start !== null && (typeof start !== "number" || !Number.isFinite(start))) return undefined;
  if (type === "percent") {
    if (progress.target !== null || start !== null || progress.unit !== ""
      || progress.current < 0 || progress.current > 100) return undefined;
  } else if (typeof progress.target !== "number" || !Number.isFinite(progress.target)) return undefined;
  return { type, current: progress.current, target: progress.target, start, unit: progress.unit };
}

function milestoneProgressRatio(progress) {
  const value = normalizeMilestoneProgress(progress);
  if (!value) return null;
  let ratio;
  if (value.type === "percent") ratio = value.current / 100;
  else if (value.start !== null) {
    if (value.target === value.start) return null;
    ratio = (value.current - value.start) / (value.target - value.start);
  } else {
    if (value.target === 0) return null;
    ratio = value.current / value.target;
  }
  return Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : null;
}

function trackStatus(track, pace, latestValue, lastObservedISO, todayISO) {
  if (pace?.invalid) return { state: "ontrack", label: "順調", severity: 2 };
  const milestones = (track?.milestones || []).filter((milestone) => !milestone.deleted);
  const latest = latestValue === null || latestValue === undefined ? Number(track?.baselineValue) : Number(latestValue);
  const done = track?.kind === "milestone"
    ? milestones.length > 0 && milestones.every((milestone) => milestone.doneAt)
    : numericGoalReached(track, latest);
  if (done) return { state: "done", label: "完了", severity: 0 };
  const deadline = track?.kind === "milestone" ? (pace?.deadline || "") : (track?.deadline || "");
  if (deadline && todayISO > deadline) return { state: "warn", label: "期限超過", severity: 5 };
  if (track?.kind !== "milestone"
    && daysBetween(lastObservedISO || track?.startDate, todayISO) >= STALE_DAYS) {
    return { state: "stale", label: "未更新", severity: 3 };
  }
  const tolerance = track?.kind === "milestone" ? 0 : Number(pace?.tolerance);
  if (pace?.diffNorm > tolerance) return { state: "ahead", label: "先行", severity: 1 };
  if (pace?.diffNorm >= -tolerance) return { state: "ontrack", label: "順調", severity: 2 };
  return { state: "warn", label: "要注意", severity: 4 };
}

function forwardTracksForWeek(tracks, measurements, weekStart, weekEnd) {
  const results = [];
  for (const track of (tracks || []).filter((item) => !item.deleted)) {
    if (track.kind === "milestone") {
      const labels = (track.milestones || []).filter((milestone) => !milestone.deleted
        && milestone.doneAt >= weekStart && milestone.doneAt <= weekEnd).map((milestone) => milestone.label);
      if (labels.length) results.push({ trackId: track.id, delta: labels });
      continue;
    }
    const inWeek = (measurements || []).filter((measurement) => measurement.observedAt?.slice(0, 10) >= weekStart
      && measurement.observedAt.slice(0, 10) <= weekEnd);
    const beforeWeek = (measurements || []).filter((measurement) => measurement.observedAt?.slice(0, 10) < weekStart);
    const current = latestMeasurement(inWeek, track.id);
    if (!current) continue;
    const previous = latestMeasurement(beforeWeek, track.id);
    const previousValue = previous ? Number(previous.value) : Number(track.baselineValue);
    const delta = Number(current.value) - previousValue;
    const dir = Math.sign(Number(track.goalValue) - Number(track.baselineValue));
    if (Number.isFinite(delta) && delta * dir > 0) results.push({ trackId: track.id, delta });
  }
  return results;
}

function selectTrackFooter(entries) {
  const open = (entries || []).filter(({ track, status }) => track && status && !track.deleted
    && track.status !== "closed" && status.state !== "done").sort((a, b) => b.status.severity - a.status.severity);
  if (!open.length) return [];
  return open.every(({ status }) => status.state === "ahead" || status.state === "ontrack") ? open.slice(0, 1) : open.slice(0, 2);
}

function activeTrackForProject(tracks, projectId) {
  return (tracks || []).filter((track) => !track.deleted && track.status === "active" && track.ownerId === projectId)
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
      || String(a.id || "").localeCompare(String(b.id || "")))[0] || null;
}

function validateTrackDraft(kind, fields = {}) {
  const errors = [];
  if (kind === "numeric") {
    const numericKeys = ["baselineValue", "goalValue", "valueStep"];
    if (!fields.deadline) errors.push("deadline必須");
    if (!fields.startDate) errors.push("startDate必須");
    if (fields.startDate && fields.deadline
      && (!dateParts(fields.startDate) || !dateParts(fields.deadline) || fields.startDate >= fields.deadline)) {
      errors.push("startDateはdeadlineより前が必須");
    }
    if (numericKeys.some((key) => fields[key] === "" || fields[key] === null
      || !Number.isFinite(Number(fields[key])))) errors.push("数値フィールドは有限数が必須");
    if (Number(fields.goalValue) === Number(fields.baselineValue)) errors.push("goalValueはbaselineValueと異なる値が必須");
    if (!(Number(fields.valueStep) > 0)) errors.push("valueStepは0より大きい値が必須");
  } else if (kind === "milestone") {
    const milestones = (Array.isArray(fields.milestones) ? fields.milestones : []).filter((milestone) => !milestone?.deleted);
    if (!milestones.length) errors.push("milestoneは1件以上必須");
    if (milestones.some((milestone) => !String(milestone?.label || "").trim())) errors.push("各milestoneのlabel必須");
    if (milestones.some((milestone) => !dateParts(milestone?.plannedDate))) errors.push("各milestoneのplannedDate必須");
  } else {
    errors.push("kindはnumericまたはmilestoneが必須");
  }
  return { ok: errors.length === 0, errors };
}

function trackDefinitionChanged(existing, kind, fields = {}) {
  return Boolean(existing && (existing.kind !== kind
    || (kind === "numeric" && String(existing.unit || "").trim() !== String(fields.unit || "").trim())));
}

export {
  PACE_TOLERANCE_DAYS, STALE_DAYS, dateParts, daysBetween, isProjectInCurrentCycle, numericGoalReached,
  weeklyScore, weeklyCommittedItems, latestMeasurement,
  paceNumeric, paceMilestone, normalizeMilestoneProgress, milestoneProgressRatio,
  trackStatus, forwardTracksForWeek, selectTrackFooter, activeTrackForProject,
  validateTrackDraft, trackDefinitionChanged
};
