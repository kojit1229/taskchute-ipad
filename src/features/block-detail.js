import { DAILY_OPERATIONS } from "./daily-operations.js";
import { markDailyReadingEdit } from "../core/daily-reading.js";

// Compose registered builders inside the existing editor's single transaction.
export function buildBlockDetailDraft(state, before, edited, fields, deps) {
  let draft = { ...state, blocks: state.blocks.filter(row => row.id !== edited.id).concat({ ...edited,
    actualStartAt: before?.actualStartAt || "", actualEndAt: before?.actualEndAt || "",
    completed: Boolean(before?.completed) }) };
  const effects = [];
  const apply = (name, input) => {
    const result = DAILY_OPERATIONS[name].build(draft, { kind: "block", id: edited.id, ...input }, deps);
    if (result.confirmEnd) throw new Error("実行中の予定を完了するには実績終了を入力してください");
    for (const row of result.records || []) {
      const id = row.before?.id || row.after.id;
      const rows = draft[row.kind] || [];
      draft[row.kind] = rows.some(old => old.id === id) ? rows.flatMap(old => old.id === id ? row.after ? [row.after] : [] : [old])
        : rows.concat(row.after ? [row.after] : []);
    }
    for (const value of result.values || []) {
      if (value.kind == null) draft[value.key] = value.after;
      else draft[value.kind] = { ...draft[value.kind], [value.key]: value.after };
    }
    return result;
  };
  apply("daily-plan-times-save", { values: { date: edited.date, start: edited.plannedStartAt, end: edited.plannedEndAt } });
  if (!before?.actualStartAt && edited.actualStartAt) {
    apply("daily-block-start", { declare: false, startDraft: { at: edited.actualStartAt, declarationId: "" } });
  }
  // Manual corrections retain the entered time; reopening never supplies the current clock.
  draft.blocks = draft.blocks.map(row => row.id === edited.id ? { ...row, actualStartAt: edited.actualStartAt } : row);
  const reports = (state.declarations || []).filter(row => !row.deleted && row.blockId === edited.id && before?.actualEndAt && row.reportedAt === before.actualEndAt);
  const report = reports.length === 1 ? reports[0] : null;
  const reportChanged = (fields.resultNote || "") !== (report?.resultNote || "") || (fields.outcome || "") !== (report?.outcome || "");
  if (edited.actualEndAt && (edited.actualEndAt !== before?.actualEndAt || edited.actualStartAt !== before?.actualStartAt || reportChanged)) {
    apply("daily-block-end", { endDraft: { date: edited.date, actualStartAt: edited.actualStartAt,
      actualEndAt: edited.actualEndAt, declarationId: report?.id || "", fallbackId: `detail-end_${edited.id}_${edited.actualEndAt}` },
      values: { actualEndAt: edited.actualEndAt, completed: edited.completed }, note: fields.resultNote, outcome: fields.outcome, updateReport: Boolean(report) });
  } else {
    if ((fields.resultNote || fields.outcome) && !edited.actualEndAt) throw new Error("結果の保存には実績終了を入力してください");
    draft.blocks = draft.blocks.map(row => row.id === edited.id ? { ...row, actualEndAt: edited.actualEndAt } : row);
  }
  apply("daily-plan-complete", { desiredCompleted: edited.completed });
  const linkedTask = state.tasks.find(row => row.id === fields.completionTaskId && !row.deleted);
  if (fields.taskCompleted !== undefined && fields.taskCompleted !== (linkedTask?.status === "completed")) {
    if (fields.completionTaskId !== edited.taskId) throw new Error("紐づくTaskを変更した場合は保存後に完了状態を編集してください");
    const result = apply("daily-task-complete", { kind: "task", id: edited.taskId, desiredCompleted: fields.taskCompleted });
    if (fields.taskCompleted) apply("daily-plan-complete", { desiredCompleted: true });
    if (result.records.length) effects.push(() => deps.taskCompletionEffect?.(result));
  }
  const block = markDailyReadingEdit(before, draft.blocks.find(row => row.id === edited.id));
  return { block, apply(target) {
    // Only lifecycle owners are copied; recurrence edits remain owned by the legacy editor.
    for (const kind of ["tasks", "declarations", "weeklyCommitments", "pomodoro"]) target[kind] = draft[kind];
    const keys = ["actualStartAt", "actualEndAt", "everStartedAt", "completed", "comment"];
    target.blocks = target.blocks.map(row => {
      if (row.id === edited.id) return row; // Legacy completion may have appended a gym summary.
      const next = draft.blocks.find(item => item.id === row.id), old = state.blocks.find(item => item.id === row.id);
      return next && JSON.stringify(next) !== JSON.stringify(old) ? { ...row, ...Object.fromEntries(keys.map(key => [key, next[key]])) } : row;
    });
  }, effects };
}
