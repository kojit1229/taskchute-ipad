import { plannedOccupancy, plannedMinute } from "../core/planned-occupancy.js";
import { normalizeSingleSchedules } from "../core/single-schedule.js";
import { contentKey } from "../core/single-schedule-merge.js";
import { placementTimes } from "../core/placement.js";

const requests = new WeakMap();
const invalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });

export function draftPlannedIntervals(draft) {
  if (draft == null) return [];
  if (!Array.isArray(draft.items)) return null;
  return draft.items.map(item => {
    const time = item && Number.isInteger(item.start)
      ? `${String(Math.floor(item.start / 60)).padStart(2,"0")}:${String(item.start % 60).padStart(2,"0")}` : "";
    return { id: item?.id, ...(placementTimes(draft.date, time, item?.minutes)
      || { plannedStartAt: "", plannedEndAt: "" }) };
  });
}

export function plannedAvailability(state, date, options = {}) {
  const stopped = error => ({ error, warnings: [], invalid: [], intervals: [], occupied: [], gaps: [], overlaps: [] });
  let source;
  try { source = options.readSchedules ? options.readSchedules(state)
    : { status: state.singleSchedules === undefined ? "unavailable" : "ready", value: state.singleSchedules }; }
  catch { return stopped("単発予定の取得に失敗しました。配置を停止しています"); }
  if (source?.status !== "ready") return stopped(source?.status === "failed"
    ? "単発予定の取得に失敗しました。配置を停止しています" : "単発予定を未取得です。配置を停止しています");
  if (!Array.isArray(source.value)) return stopped("単発予定の容器が不正です。配置を停止しています");
  if (!Array.isArray(state.blocks)) return stopped("Blockの容器が不正です。配置を停止しています");
  const schedules = normalizeSingleSchedules(source.value);
  const result = plannedOccupancy({ blocks: state.blocks.filter(row => !options.excludeBlockIds?.has(row?.id)),
    schedules: schedules.records, draftIntervals: options.draftIntervals === undefined ? [] : options.draftIntervals }, date, options.window || [240,1440]);
  return { ...result, warnings: schedules.warnings, error: result.invalid.length
    ? result.invalid.map(row => `${row.kind}:${row.id ?? "?"} ${row.reason}`).join(" / ") : "" };
}

export function gapWarning(warnings) {
  const count = warnings.reduce((sum, warning) => sum + warning.count, 0);
  return count ? `不正な単発予定${count}件を除外しました。除外分との重なりは判定できません。` : "";
}

function prepareGap(kind, input, deps) {
  if (input.kind !== kind || typeof input.requestId !== "string" || !input.requestId.trim()
      || typeof input.id !== "string" || typeof input.baseFingerprint !== "string") throw invalid("配置の対象と要求を確認してください");
  if (!requests.has(deps)) requests.set(deps, new Map());
  const owners = requests.get(deps), signature = contentKey({ kind, id: input.id, date: input.date,
    start: input.start, end: input.end, baseFingerprint: input.baseFingerprint });
  let draft = owners.get(input.requestId);
  if (draft && draft.signature !== signature) throw invalid("配置の要求が変わりました。入力を残しています");
  if (!draft) {
    const rows = deps.state[kind === "block" ? "blocks" : "tasks"];
    if (!Array.isArray(rows)) throw invalid("対象の容器が不正です");
    const source = rows.find(row => row?.id === input.id && !row.deleted);
    if (!source || contentKey(source) !== input.baseFingerprint) throw invalid("対象が更新されています。選び直してください");
    draft = { signature, kind, id: input.id, baseFingerprint: input.baseFingerprint,
      candidate: kind === "block" ? null : deps.makeBlock({ date: input.date, taskId: source.id, title: source.title,
        category: source.category || deps.projectName?.(source.projectId) || "", plannedStartAt: "", plannedEndAt: "" }) };
    owners.set(input.requestId, draft);
  }
  return { ...input, gapDraft: draft };
}

export function buildGapPlacement(state, input, deps) {
  const draft = input.gapDraft;
  if (!draft || input.date !== state.selectedDate || input.basis !== "planned") throw invalid("表示日と計画の空きを選び直してください");
  if (!Array.isArray(state.blocks) || !Array.isArray(state.tasks)) throw invalid("BlockまたはTaskの容器が不正です");
  const candidateId = draft.kind === "block" ? draft.id : draft.candidate.id;
  const existing = state.blocks?.find(row => row?.id === candidateId);
  if (draft.savedFingerprint) {
    if (!existing || existing.deleted || contentKey(existing) !== draft.savedFingerprint)
      throw invalid("保存した予定が更新されています。再配置はしていません");
    return { records: [], block: existing, warnings: [] };
  }
  const source = state[draft.kind === "block" ? "blocks" : "tasks"]?.find(row => row?.id === draft.id);
  if (state[draft.kind === "block" ? "blocks" : "tasks"].filter(row => row?.id === draft.id).length !== 1)
    throw invalid("対象の識別子が重複しています");
  if (!source || source.deleted || contentKey(source) !== draft.baseFingerprint)
    throw invalid("対象の日付・見積・状態が変わりました。入力を残しています");
  if (draft.kind === "block" && (source.date !== input.date || source.completed || source.migratedTo
      || source.actualStartAt || source.actualEndAt || source.plannedStartAt || source.plannedEndAt))
    throw invalid("未定の未着手Blockを選んでください");
  if (draft.kind === "task" && (!["todo", "doing"].includes(source.status) || existing))
    throw invalid("未完了Taskと新しい候補IDを確認してください");
  const estimate = source.estimateMin;
  if (estimate != null && (typeof estimate !== "number" || !Number.isFinite(estimate) || estimate < 0))
    throw invalid("見積を確認してください");
  const duration = estimate >= 15 ? estimate : Number(input.duration);
  const start = plannedMinute(`${input.date}T${input.start}`, input.date), end = plannedMinute(`${input.date}T${input.end}`, input.date);
  if (!Number.isSafeInteger(duration) || duration < 15 || !Number.isFinite(start) || !Number.isFinite(end)
      || start < 240 || end > 1440 || start >= end || start + duration > end)
    throw invalid("4〜24時の空きと15分以上の長さを確認してください。短縮・分割はしません");
  const availability = plannedAvailability(state, input.date, { readSchedules: deps.readSchedules,
    draftIntervals: deps.draftIntervals ? deps.draftIntervals(state) : [], excludeBlockIds: new Set(draft.kind === "block" ? [draft.id] : []) });
  if (availability.error) throw invalid(availability.error);
  if (!availability.gaps.some(([from, to]) => from <= start && end <= to))
    throw invalid("選んだ区間が埋まりました。入力を残しています。空きを選び直してください");
  const times = placementTimes(input.date, input.start, duration);
  if (!times) throw invalid("日付・開始・長さが不正です");
  const after = { ...(draft.kind === "block" ? source : { ...draft.candidate, estimateMin: duration }),
    plannedStartAt: `${times.plannedStartAt}:00`, plannedEndAt: `${times.plannedEndAt}:00` };
  return { records: [{ kind: "blocks", before: draft.kind === "block" ? source : null, after }],
    block: after, warnings: availability.warnings };
}

export function gapPlacementOperation(kind) {
  return { prepare: (input, deps) => prepareGap(kind, input, deps), build: buildGapPlacement,
    effects: (result, input, deps) => {
      input.gapDraft.savedFingerprint = contentKey(result.records[0]?.after || result.block);
      if (!result.unchanged) deps.gapPlacementEffect?.(result, input);
    } };
}
