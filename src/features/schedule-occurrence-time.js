import { seriesEnabled, seriesInvalid } from "./schedule-series.js";
import { occurrenceFingerprint, prepareOccurrence } from "./schedule-occurrence.js";
import { schedulesWithSeriesForDate } from "../core/schedule-series-derive.js";
import { plannedMinute } from "../core/planned-occupancy.js";

const tickets = new WeakMap();
export function prepareOccurrenceTime(input, deps) {
  const row = schedulesWithSeriesForDate(deps.state, input.date).records.find(r => r.id === input.id && r.seriesId === input.seriesId);
  if (!seriesEnabled(deps) || !row || deps.state.selectedDate !== input.date || row.date !== input.date)
    throw seriesInvalid("時間軸の日付とこの回を確認してください");
  const beforeTime = deps.state.singleSchedules.find(r => r?.id === row.id)?.overrides.time;
  if (input.timeline === "undo") {
    const ticket = tickets.get(deps)?.get(row.id);
    if (!ticket || occurrenceFingerprint(deps.state, row) !== ticket.fingerprint) throw seriesInvalid("対応する予定が更新されています。取消できません");
    return { ...prepareOccurrence("restore-time", { ...input, baseFingerprint: ticket.fingerprint,
      restoreTime: ticket.beforeTime && !ticket.beforeTime.cleared ? ticket.beforeTime.value : null }, deps), timelineBefore: beforeTime };
  }
  if (!["move", "resize"].includes(input.timeline) || ![-15, 15].includes(input.delta)) throw seriesInvalid("15分の移動・伸縮を選んでください");
  const start = plannedMinute(row.plannedStartAt, input.date) + (input.timeline === "move" ? input.delta : 0);
  const end = plannedMinute(row.plannedEndAt, input.date) + input.delta;
  if (start < 240 || end > 1440 || end - start < 15) throw seriesInvalid("時間軸では4〜24時・15分以上にしてください");
  const time = minute => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute % 60)).padStart(2, "0")}:${String(Math.round(minute % 1 * 60)).padStart(2, "0")}`;
  return { ...prepareOccurrence("edit", { ...input, values: { title: row.title, note: row.note, date: row.date,
    startTime: time(start), endTime: time(end), endNextDay: false } }, deps), timelineBefore: beforeTime || null };
}
export function occurrenceTimeEffects(result, input, deps) {
  if (!input.timeline || result.unchanged) return;
  if (!tickets.has(deps)) tickets.set(deps, new Map());
  if (input.timeline === "undo") { tickets.get(deps).delete(input.id); return; }
  const row = schedulesWithSeriesForDate(deps.state, input.date).records.find(r => r.id === input.id);
  tickets.get(deps).set(input.id, { beforeTime: input.timelineBefore, fingerprint: occurrenceFingerprint(deps.state, row) });
}
export function occurrenceTimeControls(row, date, deps, escapeHTML) {
  if (!seriesEnabled(deps) || !row.seriesId || row.date !== date) return "";
  const fingerprint = escapeHTML(row.seriesFingerprint || occurrenceFingerprint(deps.state, row));
  return [["move", -15, "15分前"], ["move", 15, "15分後"], ["resize", -15, "15分短縮"], ["resize", 15, "15分延長"],
    ...(tickets.get(deps)?.has(row.id) ? [["undo", 0, "時刻の変更を取り消す"]] : [])].map(([action, delta, label]) =>
    `<button type="button" data-action="series-time-change" data-id="${escapeHTML(row.id)}" data-series-id="${escapeHTML(row.seriesId)}" data-key="${row.occurrenceKey}" data-date="${date}" data-fingerprint="${fingerprint}" data-time-action="${action}" data-delta="${delta}">${label}</button>`).join("");
}
export function submitOccurrenceTime(target, deps, run) {
  const action = () => {
    const data = target.dataset;
    const result = run("daily-schedule-edit", { kind: "schedule", id: data.id, seriesId: data.seriesId, occurrenceKey: data.key,
      date: data.date, baseFingerprint: data.fingerprint, requestId: crypto.randomUUID(), timeline: data.timeAction, delta: Number(data.delta) }, deps.operationDeps);
    if (!result.ok) { deps.notify(result.error?.message || "時刻を保存できません"); return; }
    deps.render(); deps.notify("この端末で保存・同期待ち");
  };
  if (!deps.requestLeave(action)) action();
}
