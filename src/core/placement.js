// Calendar arithmetic only: persisted values remain local YYYY-MM-DDTHH:MM strings.
export function placementTimes(date, time, duration) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  const t = /^(\d{2}):(\d{2})$/.exec(time || "");
  const minutes = Number(duration);
  if (!d || !t || !Number.isSafeInteger(minutes) || minutes <= 0) return null;
  const [, y, m, day] = d.map(Number);
  const [, hour, minute] = t.map(Number);
  if (y < 100 || hour > 23 || minute > 59) return null;
  const start = new Date(Date.UTC(y, m - 1, day, hour, minute));
  if (start.getUTCFullYear() !== y || start.getUTCMonth() !== m - 1 || start.getUTCDate() !== day) return null;
  const end = new Date(start.getTime() + minutes * 60000);
  if (!Number.isFinite(end.getTime()) || end.getUTCFullYear() > 9999) return null;
  const pad = n => String(n).padStart(2, "0");
  const endDate = `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`;
  return { plannedStartAt: `${date}T${time}`, plannedEndAt: `${endDate}T${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}`, estimateMin: minutes };
}

export function existingPlacement(blocks, taskId, today) {
  return blocks.find(b => !b.deleted && b.taskId === taskId && b.date === today) || null;
}

// Candidate calculation is read-only. Persistence and side effects belong to the adapter.
export function placementCandidate(model, input, deps) {
  const task = model.tasks.find(t => !t.deleted && t.id === input.taskId);
  if (!task) return { error: "元のタスクが見つかりません。" };
  if (input.date !== deps.today) return { error: "日付が変わりました。今日の日付と時刻を確認し直してください。" };
  const existing = existingPlacement(model.blocks, task.id, deps.today);
  if (existing) return { existing };
  if (task.status === "completed") return { error: "元のタスクは完了済みです。予定追加を中止しました。閉じて最新の状態を確認してください。" };
  const times = placementTimes(input.date, input.time, input.duration);
  if (!times) return { error: "開始時刻と1分以上の所要時間を入力してください。" };
  const wish = input.source === "wish";
  const block = deps.makeBlock({ taskId: task.id, date: deps.today, title: task.title,
    category: task.category || (wish ? "回復" : deps.projectName(task.projectId)), ...times,
    ...(wish ? { expectedCharge: 4, expectedDischarge: 1 } : {}) });
  return { block, blocks: [...model.blocks, block], tasks: wish
    ? model.tasks.map(t => t.id === task.id ? { ...t, status: "doing", updatedAt: deps.stamp } : t)
    : model.tasks };
}
