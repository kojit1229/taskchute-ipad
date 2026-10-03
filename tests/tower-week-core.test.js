import assert from "node:assert/strict";
import {
  mondayOfISO, blockActualSeconds, weekTowers, towerScale, ringState, beatYesterday
} from "../src/core/tower-week.js";

function toMs(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return NaN;
  const [, year, month, day, hour, minute] = match.map(Number);
  const second = Number(match[6] || 0);
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

const today = "2026-09-30";
const now = toMs(`${today}T10:00:00`);
function ended(date, start = "09:00:00", end = "09:10:00", extra = {}) {
  return { date, actualStartAt: `${date}T${start}`, actualEndAt: `${date}T${end}`, completed: true, ...extra };
}

// (a) Monday/Sunday, month/year boundaries and leap day.
assert.equal(mondayOfISO("2026-09-28"), "2026-09-28");
assert.equal(mondayOfISO("2026-10-04"), "2026-09-28");
assert.equal(mondayOfISO("2026-10-01"), "2026-09-28");
assert.equal(mondayOfISO("2026-12-31"), "2026-12-28");
assert.equal(mondayOfISO("2027-01-03"), "2026-12-28");
assert.equal(mondayOfISO("2024-02-29"), "2024-02-26");
assert.equal(mondayOfISO("2024-03-03"), "2024-02-26");
assert.deepEqual(weekTowers([], today, now, toMs), [
  { date: "2026-09-28", seconds: 0, isToday: false, isFuture: false },
  { date: "2026-09-29", seconds: 0, isToday: false, isFuture: false },
  { date: "2026-09-30", seconds: 0, isToday: true, isFuture: false },
  { date: "2026-10-01", seconds: 0, isToday: false, isFuture: true },
  { date: "2026-10-02", seconds: 0, isToday: false, isFuture: true },
  { date: "2026-10-03", seconds: 0, isToday: false, isFuture: true },
  { date: "2026-10-04", seconds: 0, isToday: false, isFuture: true }
]);

// (b) Midnight crossing belongs entirely to the Block's date.
const crossing = { date: "2026-10-04", actualStartAt: "2026-10-04T23:50:00",
  actualEndAt: "2026-10-05T00:10:00", completed: true };
assert.equal(weekTowers([crossing], "2026-10-04", now, toMs)[6].seconds, 1200);
assert.deepEqual(weekTowers([crossing], "2026-10-05", now, toMs).map(tower => tower.seconds), Array(7).fill(0));

// (c) Per-Block minimum, reverse times, missing/completed starts and malformed times.
assert.equal(blockActualSeconds(ended(today, "09:00:00", "09:00:10"), now, toMs), 60);
assert.equal(blockActualSeconds(ended(today, "09:10:00", "09:00:00"), now, toMs), 60);
assert.equal(blockActualSeconds(ended(today, "09:00:00", "09:00:00"), now, toMs), 60);
assert.equal(blockActualSeconds(ended(today, "09:00", "09:02"), now, toMs), 120);
assert.equal(blockActualSeconds({}, now, toMs), 0);
assert.equal(blockActualSeconds(null, now, toMs), 0);
assert.equal(blockActualSeconds({ actualEndAt: `${today}T09:10` }, now, toMs), 0);
assert.equal(blockActualSeconds({ actualStartAt: `${today}T09:00`, completed: true }, now, toMs), 0);
for (const value of ["broken", "2026-09-30 09:00", "2026-09-30T99:99", "2026-00-30T09:00",
  "2026-13-30T09:00", "2026-09-00T09:00", "2026-09-32T09:00", "2026-09-30T24:00",
  "2026-09-30T09:60", 1234, {}]) {
  assert.equal(blockActualSeconds({ actualStartAt: value }, now, toMs), 0);
  assert.equal(blockActualSeconds({ actualStartAt: `${today}T09:00`, actualEndAt: value }, now, toMs), 0);
}
assert.equal(blockActualSeconds(ended(today), now, () => NaN), 0);
assert.equal(blockActualSeconds({ actualStartAt: `${today}T09:00` }, Infinity, toMs), 0);

// (d) Running seconds grow with injected time; ring and tower use the same sum.
const running = { date: today, actualStartAt: `${today}T09:50:00`, actualEndAt: "", completed: false };
assert.equal(blockActualSeconds(running, now, toMs), 600);
assert.equal(blockActualSeconds(running, now + 300000, toMs), 900);
assert.equal(blockActualSeconds(running, toMs(`${today}T09:50:10`), toMs), 60);
const mixed = [running, ended(today, "09:00:00", "09:00:10"), ended(today, "09:01:00", "09:01:10")];
for (const current of [now, now + 300000]) {
  const tower = weekTowers(mixed, today, current, toMs).find(item => item.isToday);
  assert.equal(tower.seconds, (current - toMs(running.actualStartAt)) / 1000 + 120);
  assert.equal(ringState(mixed, today, current, toMs).totalSeconds, tower.seconds);
}
const runningCrossing = { ...crossing, actualEndAt: "", completed: false };
const nextMondayNow = toMs("2026-10-05T00:10:00");
assert.equal(weekTowers([runningCrossing], "2026-10-04", nextMondayNow, toMs)[6].seconds, 1200);
assert.equal(weekTowers([runningCrossing], "2026-10-05", nextMondayNow, toMs)[0].seconds, 0);
assert.equal(ringState([runningCrossing], "2026-10-05", nextMondayNow, toMs).totalSeconds, 0);

// (e) Scale ceiling is the maximum; reference lines round up in two-hour steps.
assert.deepEqual(towerScale(weekTowers([], today, now, toMs)), { ceilingSeconds: 7200, lines: [7200] });
assert.deepEqual(towerScale([{ seconds: 7201 }, { seconds: 60 }]), { ceilingSeconds: 7201, lines: [7200, 14400] });
assert.deepEqual(towerScale([{ seconds: 21600 }]), { ceilingSeconds: 21600, lines: [7200, 14400, 21600] });

// (f) Thirty-minute lap boundaries retain seconds.
assert.deepEqual(ringState([ended(today, "09:00:00", "09:29:59")], today, now, toMs),
  { totalSeconds: 1799, laps: 0, lapProgress: 1799 / 1800 });
assert.deepEqual(ringState([ended(today, "09:00:00", "09:30:00")], today, now, toMs),
  { totalSeconds: 1800, laps: 1, lapProgress: 0 });
assert.deepEqual(ringState([ended(today, "08:00:00", "09:30:00")], today, now, toMs),
  { totalSeconds: 5400, laps: 3, lapProgress: 0 });
assert.deepEqual(ringState([], today, now, toMs), { totalSeconds: 0, laps: 0, lapProgress: 0 });

// (g) Yesterday must be nonzero and strictly beaten, including a previous week's Sunday.
assert.deepEqual(beatYesterday([ended(today)], today, now, toMs), { today: 600, yesterday: 0, beaten: false });
assert.deepEqual(beatYesterday([ended(today), ended("2026-09-29")], today, now, toMs),
  { today: 600, yesterday: 600, beaten: false });
assert.deepEqual(beatYesterday([ended(today, "09:00:00", "09:11:00"), ended("2026-09-29")], today, now, toMs),
  { today: 660, yesterday: 600, beaten: true });
assert.deepEqual(beatYesterday([ended("2026-10-05", "09:00:00", "09:21:00"), crossing], "2026-10-05", now, toMs),
  { today: 1260, yesterday: 1200, beaten: true });
assert.deepEqual(beatYesterday([ended("2026-09-29")], today, now, toMs), { today: 0, yesterday: 600, beaten: false });

// (h) Deleted records never count; no aggregation mutates the array or its Blocks.
const blocks = [...mixed, ended(today, "08:00:00", "09:00:00", { deleted: true }),
  ended("2026-09-29", "08:00:00", "09:00:00", { deleted: true })];
const before = JSON.stringify(blocks);
blocks.forEach(Object.freeze);
Object.freeze(blocks);
assert.equal(weekTowers(blocks, today, now, toMs)[2].seconds, 720);
assert.equal(weekTowers(blocks, today, now, toMs)[1].seconds, 0);
assert.equal(ringState(blocks, today, now, toMs).totalSeconds, 720);
assert.deepEqual(beatYesterday(blocks, today, now, toMs), { today: 720, yesterday: 0, beaten: false });
const towers = weekTowers(blocks, today, now, toMs);
const towersBefore = JSON.stringify(towers);
towers.forEach(Object.freeze);
towerScale(Object.freeze(towers));
assert.equal(JSON.stringify(towers), towersBefore);
assert.equal(JSON.stringify(blocks), before);

console.log("PASS: tower-week core (week boundaries, actual seconds, towers, scale, ring, yesterday, immutability)");
