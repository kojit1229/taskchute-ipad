import { mergeRecords } from "./merge.js";

const invalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });
function timestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value || "");
  if (!match) throw invalid("実績日時を確認してください");
  const [y, m, d, h, min, sec] = match.slice(1).map(v => Number(v || 0));
  const date = new Date(y, m - 1, d, h, min, sec);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d
      || date.getHours() !== h || date.getMinutes() !== min || date.getSeconds() !== sec)
    throw invalid("実績日時を確認してください");
  return value.length === 16 ? `${value}:00` : value;
}

export function buildBlockEnd(state, input, deps) {
  const block = state.blocks?.find(row => row.id === input.id && !row.deleted);
  if (!block || input.kind !== "block") throw invalid("終了する予定を確認してください");
  const draft = input.endDraft, values = input.values || {};
  if (draft.date !== block.date) throw invalid(`帰属日が${block.date}に変わりました。再確認してください`);
  if (draft.actualStartAt !== block.actualStartAt) throw invalid("開始時刻が変わりました。終了入力を確認してください");
  const actualEndAt = timestamp(values.actualEndAt ?? draft.actualEndAt);
  if (block.actualStartAt && actualEndAt < timestamp(block.actualStartAt)) throw invalid("終了は開始以降にしてください");
  const list = state.declarations || [];
  const outcome = input.outcome || "", note = String(input.note || "").trim();
  const hasReport = Boolean(outcome || note || input.completeTask === true);
  let entry = list.find(row => row.id === draft.declarationId) || list.find(row => row.id === draft.fallbackId);
  if (entry && entry.blockId !== block.id) throw invalid("開始宣言の対象が違います");
  if (hasReport && !entry && !draft.declarationId) {
    let matches = list.filter(row => row.blockId === block.id && block.actualStartAt
      && row.declaredAt === block.actualStartAt && !row.reportedAt);
    if (!matches.length && block.actualEndAt) matches = list.filter(row => row.blockId === block.id
      && row.reportedAt === block.actualEndAt && (!row.declaredAt || row.declaredAt === block.actualStartAt));
    if (matches.length > 1) throw invalid("開始宣言が複数あります。宣言番号を確認してください");
    entry = matches[0];
  }
  if (!["", "done", "partial", "derailed"].includes(outcome)) throw invalid("終了結果を確認してください");
  const reported = { ...(entry || { id: draft.fallbackId, blockId: block.id, date: block.date,
    title: block.title || "", estimateMin: null, note: "", declaredAt: "" }),
    reportedAt: actualEndAt, outcome, resultNote: note };
  const after = { ...block, actualEndAt };
  if (values.completed !== undefined && typeof values.completed !== "boolean") throw invalid("予定完了を確認してください");
  if (values.completed !== undefined) after.completed = values.completed;
  else if (outcome === "done" || input.timer === true) after.completed = true;
  if (note && !String(block.comment || "").split(/\r?\n/).includes(note))
    after.comment = block.comment ? `${block.comment}${block.comment.endsWith("\n") ? "" : "\n"}${note}` : note;
  for (const key of ["charge", "discharge"]) if (values[key] !== undefined) {
    if (!Number.isFinite(values[key]) || values[key] < 0 || values[key] > 5) throw invalid("充放電を確認してください");
    after[key] = values[key];
  }
  const records = [], add = (kind, before, next) => {
    if (JSON.stringify(before) !== JSON.stringify(next)) records.push({ kind, before, after: next });
  };
  if (input.timer === true && !block.actualEndAt) after.pomodoroCount = Number(block.pomodoroCount || 0) + 1;
  add("blocks", block, after);
  if (hasReport) {
    add("declarations", entry || null, reported);
    const merged = mergeRecords(list, [reported], { compareAt: row => row.updatedAt || row.reportedAt || row.declaredAt,
      tieBreak: (_, remote) => remote });
    for (const row of merged.slice(0, Math.max(0, merged.length - 300)))
      if (row.id !== reported.id) add("declarations", list.find(old => old.id === row.id), null);
  }
  if (input.completeTask !== undefined && typeof input.completeTask !== "boolean") throw invalid("Task完了を確認してください");
  if (input.completeTask === true) {
    const task = state.tasks?.find(row => row.id === block.taskId && !row.deleted);
    if (!task) throw invalid("完了するTaskを確認してください");
    if (task.status !== "completed") add("tasks", task, deps.completedTask(task));
  }
  const valuesToSave = [];
  if (state.pomodoro?.running && state.pomodoro.blockId === block.id) valuesToSave.push({ kind: null,
    key: "pomodoro", before: state.pomodoro, after: { ...state.pomodoro, running: false, blockId: "",
      startedAt: "", endsAt: "", mode: "focus", paused: false, pausedRemainMs: 0 } });
  return { records, values: valuesToSave, block: after, declaration: hasReport ? reported : null,
    declarationId: hasReport ? reported.id : draft.declarationId, justCompleted: !block.completed && after.completed };
}
