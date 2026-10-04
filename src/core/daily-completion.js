const invalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });

function desiredCompletion(input) {
  if (input.desiredCompleted === true || input.desiredCompleted === "true") return true;
  if (input.desiredCompleted === false || input.desiredCompleted === "false") return false;
  throw invalid("希望する完了状態を確認してください");
}

export function buildPlanCompletion(state, input, deps) {
  const block = state.blocks?.find(row => row.id === input.id && !row.deleted);
  if (!block || !["block", "schedule"].includes(input.kind)) throw invalid("完了する予定を確認してください");
  const completed = desiredCompletion(input);
  if (Boolean(block.completed) === completed) return { records: [], block };
  if (completed && block.actualStartAt && !block.actualEndAt)
    return { records: [], block, confirmEnd: true };
  const after = { ...block, completed };
  if (input.fillActual === true && completed && !block.actualStartAt && !block.actualEndAt) {
    const end = typeof deps.now === "function" ? deps.now() : deps.now;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(end || "");
    if (!match) throw invalid("完了時刻を確認してください");
    const [, y, m, d, h, min, s] = match.map(Number);
    const minutes = Number.isFinite(block.estimateMin) && block.estimateMin > 0 ? block.estimateMin : 15;
    const start = new Date(y, m - 1, d, h, min - minutes, s);
    const pad = value => String(value).padStart(2, "0");
    after.actualStartAt = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:${pad(start.getMinutes())}:${pad(start.getSeconds())}`;
    after.actualEndAt = end;
  }
  return { records: [{ kind: "blocks", before: block, after }], block: after };
}

export function buildTaskCompletion(state, input, deps) {
  const task = state.tasks?.find(row => row.id === input.id && !row.deleted);
  if (!task || input.kind !== "task") throw invalid("完了するTaskを確認してください");
  const completed = desiredCompletion(input);
  if ((task.status === "completed") === completed) return { records: [], task };
  const hasProgress = state.blocks?.some(block => !block.deleted && block.taskId === task.id
    && (block.completed || block.actualStartAt));
  const after = completed ? deps.completedTask(task) : { ...task, status: hasProgress ? "doing" : "todo" };
  return { records: [{ kind: "tasks", before: task, after }], task: after, previousStatus: task.status };
}
