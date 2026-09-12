import { nextMutationStamp, stamped } from "./mutation-stamp.js";
import { buildBlockStart } from "./daily-start.js";

export function readingReferenceDate(date, kind) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!match) return "";
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (kind === "feedback") day.setDate(day.getDate() - 1);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}
export function readingMark(block, moved = false) {
  try {
    if (!block?.externalRef?.startsWith("daily-reading:v1:")) return null;
    const mark = JSON.parse(block.externalRef.slice("daily-reading:v1:".length));
    if (!["affirmation", "visionBoard", "feedback"].includes(mark.kind)) return null;
    nextMutationStamp({ now: mark.recordedAt });
    const date = mark.recordedAt.slice(0, 10);
    if ((!moved && date !== block.date) || mark.referenceDate !== readingReferenceDate(date, mark.kind)) return null;
    if (mark.kind === "feedback" ? block.id !== `daily-reading-feedback_${date}` || Boolean(block.recurrenceGroupId)
      : !block.recurrenceGroupId || block.id !== `rec_${block.recurrenceGroupId}_${date}`) return null;
    return mark;
  } catch { return null; }
}
export function readingRule(state, kind, date, deps) {
  const ids = state.settings?.dailyReadingRoutineIds;
  if (!ids || typeof ids.affirmation !== "string" || !ids.affirmation || typeof ids.visionBoard !== "string"
      || !ids.visionBoard || ids.affirmation === ids.visionBoard) return null;
  const rules = [ids.affirmation, ids.visionBoard].map(id => state.recurrences.filter(rule => rule.id === id));
  if (rules.some(rows => rows.length !== 1 || rows[0].deleted || rows[0].category !== "ルーティン")) return null;
  const rule = rules.flat().find(row => row.id === ids[kind]);
  return rule && deps.readingMatches(rule, date) ? rule : null;
}
export function isDailyReadingBlock(block, state) {
  return Boolean(block?.externalRef?.startsWith("daily-reading:v1:")
    || ["daily-reading-auto", "daily-reading-manual"].includes(block?.source)
    || block?.id?.startsWith("daily-reading-feedback_") || block?.recurrenceGroupId
      && Object.values(state.settings?.dailyReadingRoutineIds || {}).includes(block.recurrenceGroupId));
}
export function markDailyReadingEdit(before, after) {
  if (!after || !readingMark(before, true) || JSON.stringify(before) === JSON.stringify(after)) return after;
  // Keep the original attribution in the marker (recordedAt) even after a move/deletion.
  return { ...after, source: "daily-reading-manual", externalRef: before.externalRef };
}
export function excludedReadingRule(state, id, date, deps) {
  return Boolean(id) && ["affirmation", "visionBoard"].some(kind => readingRule(state, kind, date, deps)?.id === id);
}
export function buildDailyReading(state, input, deps) {
  const { kind, date, referenceDate, recordedAt, routineIds } = input;
  const stop = message => ({ records: [], message });
  if (!input.displayed || !deps.readingCurrent(input) || date !== deps.today()
      || referenceDate !== readingReferenceDate(date, kind) || recordedAt?.slice(0, 10) !== date)
    return stop("閲覧のみ（日付・要求を再確認してください）");
  const stamp = nextMutationStamp({ now: recordedAt });
  if ((state.archivedDates || []).includes(date)) return stop("閲覧のみ（退避済みの日付）");
  if (!["affirmation", "visionBoard", "feedback"].includes(kind)) return stop("閲覧のみ");
  const rule = kind === "feedback" ? null : readingRule(state, kind, date, deps);
  if (kind !== "feedback" && (!rule || JSON.stringify(routineIds) !== JSON.stringify(state.settings.dailyReadingRoutineIds)))
    return stop("閲覧のみ（対応設定を確認してください）");
  const id = rule ? `rec_${rule.id}_${date}` : `daily-reading-feedback_${date}`;
  const matches = state.blocks.filter(block => block.id === id), before = matches[0];
  if (matches.length > 1 || before?.deleted || before && before.category !== "ルーティン" || before && before.date !== date
      || before && (before.recurrenceGroupId || "") !== (rule?.id || "")) return stop("閲覧のみ（対象を確認してください）");
  const mark = readingMark(before);
  if (before?.source === "daily-reading-auto" && mark && mark.kind === kind && before.completed
      && before.actualStartAt === mark.recordedAt && before.actualEndAt === mark.recordedAt) return stop("記録済み");
  if (before?.actualStartAt || before?.actualEndAt || before?.completed || before?.source || before?.externalRef || before && !rule)
    return stop(before?.actualStartAt && !before.actualEndAt ? "閲覧済み、計時中のため自動記録なし" : "閲覧のみ（既存記録を保持）");
  const base = before || (rule ? deps.readingInstance(rule, date) : { id, date, title: "昨日のAIフィードバック", taskId: "",
    recurrenceGroupId: "", category: "ルーティン", oneTap: true, plannedStartAt: "", plannedEndAt: "", estimateMin: null });
  if (base.source || base.externalRef) return stop("閲覧のみ（別用途の出所）");
  const after = stamped({ ...base, createdAt: before?.createdAt || recordedAt, actualStartAt: recordedAt, actualEndAt: recordedAt,
    completed: true, everStartedAt: base.everStartedAt || recordedAt, source: "daily-reading-auto",
    externalRef: `daily-reading:v1:${JSON.stringify({ kind, referenceDate, recordedAt })}` }, stamp);
  const records = [{ kind: "blocks", before: before || null, after }], values = [];
  if (rule?.streakSince && ["daily", "weekdays"].includes(rule.kind) && date >= rule.streakSince) {
    const habit = state.habitStreaks?.[rule.id];
    if (habit?.logs?.[date]) return stop("閲覧のみ（既存の習慣記録を保持）");
    values.push({ kind: null, key: "habitStreaks", before: state.habitStreaks, after: { ...state.habitStreaks,
      [rule.id]: stamped({ ...habit, logs: { ...habit?.logs, [date]: { doneAt: recordedAt } } }, stamp) } });
  }
  // Reuse the start builder's weekly candidates, discarding its timer/Task/other-Block changes.
  const draft = { ...state, settings: { ...state.settings, focusTimerAuto: false },
    blocks: state.blocks.filter(block => block.id !== id).concat({ ...base, actualStartAt: "" }) };
  const weekly = buildBlockStart(draft, { kind: "block", id, declare: false, startDraft: { at: recordedAt } }, deps)
    .records.filter(row => row.kind === "weeklyCommitments");
  const weekId = deps.weekRange ? `wci_${deps.weekRange(date).weekStart}_${id}` : "";
  const priorWeek = state.weeklyCommitments?.find(row => row.id === weekId && !row.deleted);
  if (priorWeek && !weekly.some(row => row.after.id === weekId)) weekly.push({ kind: "weeklyCommitments", before: priorWeek, after: priorWeek });
  records.push(...weekly.map(row => row.after.id === weekId ? { ...row, after: { ...row.after,
    completedAt: recordedAt, completedChangedAt: recordedAt } } : row));
  return state.settings?.dailyReadingRecordEnabled === true ? { records, values, message: "記録済み" }
    : { records: [], values: [], discarded: true, message: "記録済み(保存は無効)" };
}
