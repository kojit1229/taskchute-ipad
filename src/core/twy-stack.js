import { addDaysISO } from "./plan.js";

export function weekCounts(blocks, tasks, weekStart) {
  const eligible = new Set(tasks.filter(task => !task.deleted && task.twyPlan?.perWeek > 0).map(task => task.id));
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysISO(weekStart, i);
    const daily = blocks.filter(block => !block.deleted && eligible.has(block.taskId) && block.date === date);
    return { date, done: daily.filter(block => block.completed).length, planned: daily.length };
  });
}

export function ringRatio(done, planned) {
  return planned > 0 ? Math.min(1, Math.max(0, done / planned)) : 0;
}
