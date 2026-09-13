import { prepareRelatedStamps } from "./twelve-week-save.js";
import { affectedReportDates, buildDailyReport } from "../core/daily-report.js";

const kinds = ["blocks", "tasks", "recurrences", "chainRuns", "weeklyCommitments", "tracks", "trackMeasurements", "declarations"];
const clone = value => JSON.parse(JSON.stringify(value));
function applyCandidate(state, result) {
  for (const { kind, before, after } of result.records || []) {
    const id = before?.id || after.id, rows = state[kind] || [];
    state[kind] = rows.some(row => row.id === id) ? rows.flatMap(row => row.id === id ? after ? [after] : [] : [row])
      : rows.concat(after ? [after] : []);
  }
  for (const { kind, key, after } of result.values || []) {
    if (kind == null) state[key] = after;
    else state[kind][key] = after;
  }
}

export function buildLifecycleDraft(input, deps) {
  const before = clone(deps.state());
  let result;
  const building = deps.transaction.lifecycleBuilding;
  deps.transaction.lifecycleBuilding = true;
  try {
  if (input.work) {
    input.work();
    result = { records: [] };
  } else {
    result = input.build(deps.state(), input.input);
    applyCandidate(deps.state(), result);
    deps.related(result, input.input);
  }
  } finally { deps.transaction.lifecycleBuilding = building; }
  const state = deps.state();
  const changes = kinds.flatMap(kind => (state[kind] || []).flatMap(after => {
    const prior = before[kind]?.find(row => row.id === after.id);
    return JSON.stringify(prior) === JSON.stringify(after) ? [] : [{ kind, before: prior, after }];
  }));
  for (const date of affectedReportDates(state, { records: changes })) {
    if (!state.archivedDates?.includes(date)) applyCandidate(state, buildDailyReport(state, { reportDate: date }, deps.reportDeps));
  }
  const stamp = prepareRelatedStamps(before, state, kinds, deps.now());
  for (const [id, habit] of Object.entries(state.habitStreaks || {})) {
    if (stamp && JSON.stringify(habit) !== JSON.stringify(before.habitStreaks?.[id])) habit.updatedAt = stamp;
  }
  result = { ...result, bundled: true, ok: true,
    unchanged: !changes.length && !(result.values || []).length };
  deps.transaction.complete(() => input.effects?.(result));
  return result;
}

export function commitLifecycleDraft(input, deps) {
  let result, failure;
  const saved = deps.transaction.run(() => {
    try { result = buildLifecycleDraft(input, deps); } catch (error) { failure = error; throw error; }
  });
  return saved.ok ? result : { ok: false, status: failure?.code === "DAILY_OPERATION_INVALID" ? "invalid" : undefined,
    error: failure || new Error("保存できませんでした。入力は残しています") };
}

export const lifecycleSaveOperation = {
  legacy: true, build: buildLifecycleDraft, run: commitLifecycleDraft
};
