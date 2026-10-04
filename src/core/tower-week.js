import { addDaysISO } from "./plan.js";

// Gregorian calendar day number; 1970-01-01 is day zero (Thursday).
function dayNumber(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const y = year - Number(month <= 2);
  const era = Math.floor(y / 400), yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  return era * 146097 + yearOfEra * 365 + Math.floor(yearOfEra / 4)
    - Math.floor(yearOfEra / 100) + dayOfYear - 719468;
}

export function mondayOfISO(dateISO) {
  const offset = ((dayNumber(dateISO) + 3) % 7 + 7) % 7;
  return addDaysISO(dateISO, -offset);
}

function validDateTime(value) {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!parts) return false;
  const [, , month, day, hour, minute] = parts.map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
    && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function blockActualSeconds(block, nowMs, toMs) {
  if (block?.completed && !block.actualStartAt) {
    if (validDateTime(block.plannedStartAt) && validDateTime(block.plannedEndAt)) {
      const seconds = (toMs(block.plannedEndAt) - toMs(block.plannedStartAt)) / 1000;
      if (Number.isFinite(seconds)) return Math.max(60, seconds);
    }
    return (Number.isFinite(block.estimateMin) && block.estimateMin > 0 ? block.estimateMin : 15) * 60;
  }
  if (!block || !validDateTime(block.actualStartAt)) return 0;
  const hasEnd = Boolean(block.actualEndAt);
  if (hasEnd ? !validDateTime(block.actualEndAt) : block.completed) return 0;
  const start = toMs(block.actualStartAt);
  const end = hasEnd ? toMs(block.actualEndAt) : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(60, (end - start) / 1000);
}

function secondsOnDate(blocks, date, nowMs, toMs) {
  return blocks.reduce((sum, block) => sum + (block && !block.deleted && block.date === date
    ? blockActualSeconds(block, nowMs, toMs) : 0), 0);
}

export function weekTowers(blocks, todayISO, nowMs, toMs) {
  const monday = mondayOfISO(todayISO);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDaysISO(monday, index);
    return { date, seconds: secondsOnDate(blocks, date, nowMs, toMs),
      isToday: date === todayISO, isFuture: date > todayISO };
  });
}

export function towerScale(towers) {
  const ceilingSeconds = Math.max(7200, ...towers.map(tower => tower.seconds));
  const lines = Array.from({ length: Math.ceil(ceilingSeconds / 7200) }, (_, i) => (i + 1) * 7200);
  return { ceilingSeconds, lines };
}

export function ringState(blocks, todayISO, nowMs, toMs) {
  const totalSeconds = secondsOnDate(blocks, todayISO, nowMs, toMs);
  return { totalSeconds, laps: Math.floor(totalSeconds / 1800), lapProgress: (totalSeconds % 1800) / 1800 };
}

export function beatYesterday(blocks, todayISO, nowMs, toMs) {
  const today = secondsOnDate(blocks, todayISO, nowMs, toMs);
  const yesterday = secondsOnDate(blocks, addDaysISO(todayISO, -1), nowMs, toMs);
  return { today, yesterday, beaten: yesterday > 0 && today > yesterday };
}
