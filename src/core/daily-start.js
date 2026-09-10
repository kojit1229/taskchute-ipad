import { mergeRecords } from "./merge.js";

const invalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });

// Everything returned here is saved by the registry's single candidate boundary.
export function buildBlockStart(state, input, deps) {
  const block = state.blocks?.find(row => row.id === input.id && !row.deleted);
  if (!block || input.kind !== "block") throw invalid("開始する予定を確認してください");
  if (block.actualStartAt) return { records: [], block, declarationId: input.startDraft.declarationId,
    values: input.timer === true ? [{ kind: null, key: "pomodoro", before: state.pomodoro,
      after: deps.pomodoroForStart(typeof deps.now === "function" ? deps.now() : deps.now, block.id) }] : [],
    timerStarted: input.timer === true };
  const { at, declarationId } = input.startDraft;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(at)) throw invalid("開始時刻を確認してください");
  const records = [], values = [];
  const add = (kind, before, after) => records.push({ kind, before, after });
  const started = { ...block, actualStartAt: at, everStartedAt: block.everStartedAt || at };
  add("blocks", block, started);
  const task = state.tasks?.find(row => row.id === block.taskId && !row.deleted);
  if (task?.status === "todo") add("tasks", task, { ...task, status: "doing" });
  if (input.declare !== false) {
    const entry = { id: declarationId, blockId: block.id, date: block.date, title: block.title || "",
      estimateMin: input.estimateMin ?? null, note: String(input.note || "").trim(),
      declaredAt: at, reportedAt: "", outcome: "", resultNote: "" };
    const declarations = mergeRecords(state.declarations, [entry], {
      compareAt: row => row.updatedAt || row.declaredAt, tieBreak: local => local
    });
    for (const removed of declarations.slice(0, Math.max(0, declarations.length - 300)))
      add("declarations", removed, null);
    if (!state.declarations.some(row => row.id === declarationId)) add("declarations", null, entry);
  }
  let pomodoro = state.pomodoro;
  for (const other of state.blocks) {
    if (other.id === block.id || other.deleted || !other.actualStartAt || other.actualEndAt || other.category !== "ルーティン") continue;
    add("blocks", other, { ...other, completed: false,
      actualEndAt: other.date < at.slice(0, 10) ? `${other.date}T23:59:00` : at });
    if (pomodoro?.running && pomodoro.blockId === other.id) pomodoro = { ...pomodoro,
      running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus", paused: false, pausedRemainMs: 0 };
  }
  if (input.timer === true || (state.settings?.focusTimerAuto && !pomodoro?.running))
    pomodoro = deps.pomodoroForStart(at, block.id);
  if (pomodoro !== state.pomodoro) values.push({ kind: null, key: "pomodoro", before: state.pomodoro, after: pomodoro });
  if (state.settings?.twelveWeekStartDate) {
    const weekStart = deps.weekRange(block.date).weekStart;
    const weekly = state.weeklyCommitments;
    if (weekStart === deps.weekRange(at.slice(0, 10)).weekStart
        && !weekly.some(row => row.id === `wcw_${weekStart}` && !row.deleted)) {
      const candidates = deps.candidateBlocksForWeek(state, weekStart);
      if (candidates.some(row => row.id === block.id)) {
        const incoming = candidates.map(row => deps.commitmentItemForBlock(state, row, weekStart, "auto", at));
        incoming.push({ id: `wcw_${weekStart}`, recordType: "week", weekStart,
          cycleStartDate: state.settings.twelveWeekStartDate, committedAt: at, committedVia: "auto",
          selectedBlockIds: [], createdAt: at, deleted: false });
        const comparisonRows = incoming.map(row => ({ ...row,
          updatedAt: [at, weekly.find(old => old.id === row.id)?.updatedAt || ""].sort().at(-1) }));
        const merged = deps.mergeWeeklyCommitments(weekly.filter(row => !row.deleted
          || !incoming.some(next => next.id === row.id)), comparisonRows, (_, remote) => remote);
        for (const after of merged) {
          const before = weekly.find(row => row.id === after.id) || null;
          if (JSON.stringify(before) !== JSON.stringify(after)) add("weeklyCommitments", before, after);
        }
      }
    }
  }
  return { records, values, block: started, declarationId: input.declare === false ? "" : declarationId,
    timerStarted: pomodoro !== state.pomodoro && pomodoro?.running };
}
