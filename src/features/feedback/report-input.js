import { reportActuals } from "../../core/daily-report.js";
// Capture only report dependencies. No application globals, authentication, persistence, or async work.
const fields = {
  blocks: 'id date title taskId category completed charge discharge isMIT pomodoroCount plannedStartAt plannedEndAt actualStartAt actualEndAt comment source recurrenceGroupId migratedTo deleted everStartedAt oneTap',
  tasks: 'id title projectId parentTaskId status deleted kind dueDate',
  projects: 'id title kind status deleted twelveWeekStartDate',
  recurrences: 'id deleted protection',
  questions: 'id text deleted status',
  bodyScans: 'dateTime fatigue recovery part',
  zero: 'date createdAt questionId theme body',
  meditation: 'date deleted dischargeTalk chargeTalk',
};
const fail = reason => { throw new Error(reason); };
function pick(value, keys) {
  const result = {};
  for (const key of keys.split(' ')) if (Object.hasOwn(value || {}, key)) {
    const field = value[key];
    if (field !== null && !['string', 'boolean', 'number', 'undefined'].includes(typeof field)) fail('invalid_report_field');
    result[key] = field;
  }
  return result;
}
function rows(value, keys) {
  if (!Array.isArray(value)) fail('invalid_report_collection');
  return value.map(row => pick(row, keys));
}
function rate(value, names) {
  const result = pick(value, names);
  for (const key of names.split(' ')) if (typeof result[key] !== 'number' || !Number.isFinite(result[key])) fail('invalid_report_derived');
  return result;
}
export function captureReportInput(source, date, derive) {
  if (!source || typeof date !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || typeof derive !== 'function') fail('report_input_required');
  if ((source.archivedDates || []).includes(date)) fail('archived_readonly');
  if (typeof source.journals?.[date] !== 'string' || !source.journals[date]) fail('journal_initialization_required');
  const state = {};
  for (const key of ['blocks', 'tasks', 'projects', 'recurrences', 'questions', 'bodyScans']) state[key] = rows(source[key] || [], fields[key]);
  state.blocks.forEach((block, i) => {
    if (source.blocks[i].incompleteReason) block.incompleteReason = pick(source.blocks[i].incompleteReason, 'chip note at');
  });
  state.zeroThinking = { entries: rows(source.zeroThinking?.entries || [], fields.zero) };
  state.writeMeditations = rows(source.writeMeditations || [], fields.meditation);
  state.writeMeditations.forEach((row, i) => {
    for (const key of ['charge', 'discharge']) row[key] = rows(source.writeMeditations[i][key] || [], 'text');
  });
  state.journals = { [date]: source.journals[date] };
  state.journalMeta = { [date]: pick(source.journalMeta?.[date], 'ideal') };
  state.settings = { ...pick(source.settings, 'twelveWeekStartDate'),
    morningEnergyLog: pick(source.settings?.morningEnergyLog, date) };
  state.sleep = { logs: {} };
  for (const [key, log] of Object.entries(source.sleep?.logs || {})) state.sleep.logs[key] = pick(log, 'sleepH hrSleep hrvSleep');
  const fixed = structuredClone(state);
  // The callback cannot mutate fixed input; it must synchronously derive from its separate copy.
  const result = derive(structuredClone(fixed), date);
  if (!result || typeof result.then === 'function') fail('synchronous_report_derived_required');
  const derived = {};
  for (const key of ['rateTaskchute', 'rateRoutine', 'rateCycleWeek']) derived[key] = rate(result[key], 'done total pct');
  derived.rateDeferral = rate(result.rateDeferral, 'pending started total');
  if (!Number.isFinite(result.cycleWeek)) fail('invalid_report_derived');
  derived.cycleWeek = result.cycleWeek;
  derived.conditionBudget = pick(result.conditionBudget, 'level reason');
  if (!['none', 'normal', 'low', 'deficit'].includes(derived.conditionBudget.level)
      || typeof derived.conditionBudget.reason !== 'string' || typeof result.conditionLabel !== 'string') fail('invalid_report_derived');
  derived.conditionLabel = result.conditionLabel;
  const blocks = fixed.blocks.filter(block => !block.deleted && block.date === date)
    .sort((a, b) => (a.plannedStartAt || '99').localeCompare(b.plannedStartAt || '99'));
  const actuals = reportActuals(fixed, date);
  return { date, state: fixed, blocks, derived, actuals };
}
