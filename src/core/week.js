// 今週面の表示専用集計。採点母集団はtrack.jsと共有する。
import { weeklyCommittedItems, dateParts } from "./track.js";
import { addDaysISO } from "./plan.js";

const WEEK_LABELS = ["土", "日", "月", "火", "水", "木", "金"];
const unfinished = (item) => !item.excused && !item.completedAt;
const missedBefore = (item, todayISO) => unfinished(item) && !!item.plannedDate && item.plannedDate < todayISO;
const blockTime = (block) => String(block?.plannedStartAt || "").slice(11, 16);

function weekOutlook(weeklyCommitments, weekStart, todayISO, target = 85) {
  const scope = weeklyCommittedItems(weeklyCommitments, weekStart);
  const active = scope.filter((item) => !item.excused);
  const total = active.length, done = active.filter((item) => item.completedAt).length;
  const todayPlanned = active.filter((item) => unfinished(item) && item.plannedDate === todayISO).length;
  const missed = active.filter((item) => missedBefore(item, todayISO)).length;
  const needed = Math.max(0, Math.ceil(total * target / 100) - done);
  const pctOf = (count) => total ? Math.round(count / total * 100) : null;
  return {
    status: !scope.length ? "uncommitted" : total ? "scored" : "na",
    committed: scope.length, excused: scope.length - total, total, done, todayPlanned, missed,
    pct: pctOf(done), pctIfTodayDone: pctOf(done + todayPlanned),
    needTodayForTarget: total && needed <= todayPlanned ? needed : null,
    pctIfRecovered: pctOf(done + todayPlanned + missed)
  };
}

function weekDayStrip(weeklyCommitments, weekStart, todayISO) {
  const scope = weeklyCommittedItems(weeklyCommitments, weekStart), p = dateParts(weekStart);
  if (!p) return [];
  return WEEK_LABELS.map((label, offset) => {
    const dateISO = addDaysISO(weekStart, offset);
    const items = scope.filter((item) => item.plannedDate === dateISO);
    const active = items.filter((item) => !item.excused);
    return { dateISO, label, total: active.length, done: active.filter((item) => item.completedAt).length,
      excused: items.length - active.length, missed: active.filter((item) => missedBefore(item, todayISO)).length,
      isToday: dateISO === todayISO, isPast: dateISO < todayISO };
  });
}

function todayTwyBlocks(weeklyCommitments, blocks, weekStart, todayISO) {
  const byId = new Map((blocks || []).map((block) => [block.id, block]));
  return weeklyCommittedItems(weeklyCommitments, weekStart)
    .filter((item) => !item.excused && item.plannedDate === todayISO)
    .map((item) => {
      const block = byId.get(item.blockId);
      return { blockId: item.blockId, taskId: item.taskId, projectId: item.projectId,
        title: item.title || block?.title || "", plannedStartAt: block?.plannedStartAt || "",
        time: blockTime(block), estimateMin: block?.estimateMin ?? null, done: !!item.completedAt };
    }).sort((a, b) => (!a.plannedStartAt - !b.plannedStartAt)
      || a.plannedStartAt.localeCompare(b.plannedStartAt) || a.title.localeCompare(b.title));
}

function missedTwyItems(weeklyCommitments, weekStart, todayISO) {
  return weeklyCommittedItems(weeklyCommitments, weekStart).filter((item) => missedBefore(item, todayISO))
    .map(({ id, blockId, taskId, projectId, title, plannedDate }) => ({ id, blockId, taskId, projectId, title, plannedDate }))
    .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
}

function projectWeekScore(weeklyCommitments, weekStart, projectId) {
  const items = weeklyCommittedItems(weeklyCommitments, weekStart).filter((item) => item.projectId === projectId && !item.excused);
  const total = items.length, done = items.filter((item) => item.completedAt).length;
  return { done, total, pct: total ? Math.round(done / total * 100) : null };
}

function taskDayChips(weeklyCommitments, blocks, weekStart, taskId, todayISO) {
  const byId = new Map((blocks || []).map((block) => [block.id, block]));
  const labels = new Map(weekDayStrip(weeklyCommitments, weekStart, todayISO).map((day) => [day.dateISO, day.label]));
  return weeklyCommittedItems(weeklyCommitments, weekStart).filter((item) => item.taskId === taskId && item.plannedDate)
    .map((item) => ({ dateISO: item.plannedDate, label: labels.get(item.plannedDate) || "",
      time: blockTime(byId.get(item.blockId)), state: item.excused ? "excused" : item.completedAt ? "done"
        : missedBefore(item, todayISO) ? "missed" : item.plannedDate === todayISO ? "today" : "planned" }))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || (!a.time - !b.time) || a.time.localeCompare(b.time));
}

export { weekOutlook, weekDayStrip, todayTwyBlocks, missedTwyItems, projectWeekScore, taskDayChips };
