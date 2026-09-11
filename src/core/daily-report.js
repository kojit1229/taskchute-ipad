import { dailyActuals, actualDurationMinutes } from "./daily-actuals.js";

export const REPORT_PENDING = "日報更新待ち";
export function reportActuals(state, date) {
  return dailyActuals(state.blocks, date).map(block => ({ blockId: block.id, date: block.date,
    actualStartAt: block.actualStartAt || "", actualEndAt: block.actualEndAt,
    minutes: actualDurationMinutes(block),
    taskCompleted: Boolean(state.tasks?.some(task => task.id === block.taskId && !task.deleted && task.status === "completed")) }));
}

export function affectedReportDates(state, result) {
  return [...new Set((result.records || []).flatMap(row => row.kind === "blocks"
    ? [row.before, row.after].filter(block => block?.actualEndAt).map(block => block.date)
    : row.kind === "tasks" ? state.blocks.filter(block => !block.deleted && block.actualEndAt
      && [row.before?.id, row.after?.id].includes(block.taskId)).map(block => block.date) : []))];
}

export function buildDailyReport(state, input, deps) {
  const date = input.reportDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || state.archivedDates?.includes(date))
    throw Object.assign(new Error("日報の日付を確認してください"), { code: "DAILY_OPERATION_INVALID" });
  let report, pending = false;
  try {
    report = deps.buildReport(deps.captureReport(state, date));
    if (typeof report !== "string" || !report) throw new Error("empty report");
  } catch { report = REPORT_PENDING; pending = true; }
  return { records: [], values: state.reports[date] === report ? []
    : [{ kind: "reports", key: date, before: state.reports[date], after: report }], date, report, pending };
}
