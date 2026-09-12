import { readingMark } from "./daily-reading.js";
import { recurrenceMatchesDate, makeRecurrenceInstance } from "./recurrence.js";

const copy = value => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function readingSyncConflict() {
  const error = new Error("閲覧記録と対応設定・習慣の整合を確認できないため同期を停止しました。両側の記録を保持しています。");
  error.name = "DailyReadingSyncConflict";
  return error;
}
export function mergeReadingEvidence(local, remote, blocks, normalizeBlock = block => block) {
  const stop = () => { throw readingSyncConflict(); };
  const settings = side => {
    const raw = side.settings?.dailyReadingRoutineIds;
    if (raw === undefined) return { affirmation: "", visionBoard: "" };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)
        || Object.keys(raw).some(key => !["affirmation", "visionBoard"].includes(key))) stop();
    const ids = { affirmation: "", visionBoard: "", ...raw }, values = Object.values(ids);
    if (values.some(value => typeof value !== "string")) stop();
    if (values.every(value => value === "")) return ids;
    if (values.some(value => !value) || ids.affirmation === ids.visionBoard) stop();
    if (values.some(id => (side.recurrences || []).filter(rule => rule.id === id && !rule.deleted && rule.category === "ルーティン").length !== 1)) stop();
    return ids;
  };
  const ids = [settings(local), settings(remote)];
  let chosen = ids[0].affirmation ? 0 : 1;
  if (ids.every(value => value.affirmation) && !equal(...ids)) {
    if ((local.dataModifiedAt || "") === (remote.dataModifiedAt || "")) stop();
    chosen = (local.dataModifiedAt || "") > (remote.dataModifiedAt || "") ? 0 : 1;
  }
  const routineIds = ids[chosen], sides = [local, remote];
  if (routineIds.affirmation && sides.some(side => Object.values(routineIds).some(id =>
    (side.recurrences || []).filter(rule => rule.id === id && !rule.deleted && rule.category === "ルーティン").length !== 1))) stop();
  const habits = sides.map(side => copy(side.habitStreaks || {})), touched = new Set();
  const marked = block => block?.externalRef?.startsWith("daily-reading:v1:")
    || ["daily-reading-auto", "daily-reading-manual"].includes(block?.source);
  const recordIds = new Set(sides.flatMap(side => (side.blocks || []).filter(marked).map(block => block.id)));
  for (const id of recordIds) {
    const pair = sides.map(side => (side.blocks || []).filter(block => block.id === id));
    if (pair.some(rows => rows.length > 1)) stop();
    const records = pair.map(rows => rows[0]), winner = blocks.find(block => block.id === id);
    const marks = records.map(block => marked(block) ? readingMark(block, true) : null);
    if (records.some((block, i) => marked(block) && (!marks[i] || !["daily-reading-auto", "daily-reading-manual"].includes(block.source)))) stop();
    const mark = marks.find(Boolean), date = mark.recordedAt.slice(0, 10);
    if (marks.some(value => value && (value.kind !== mark.kind || value.recordedAt.slice(0, 10) !== date))) stop();
    if (sides.some(side => (side.archivedDates || []).includes(date))) stop();
    if (records.some((block, i) => block?.source === "daily-reading-auto" &&
        (block.deleted || block.date !== date || !block.completed || block.actualStartAt !== marks[i].recordedAt || block.actualEndAt !== marks[i].recordedAt))) stop();
    if (mark.kind === "feedback") {
      if (records.some((block, i) => block && !marks[i])) stop();
      continue;
    }
    const ruleId = routineIds[mark.kind];
    if (!ruleId || records.some(block => block && block.recurrenceGroupId !== ruleId)) stop();
    const rules = sides.map(side => side.recurrences.find(rule => rule.id === ruleId));
    if (!equal(...rules)) stop();
    if (rules.some(rule => !recurrenceMatchesDate(rule, date))) stop();
    const rule = rules[0], fixed = rule.streakSince && ["daily", "weekdays"].includes(rule.kind) && date >= rule.streakSince;
    if (fixed && !equal(local.habitPinHistory?.[ruleId], remote.habitPinHistory?.[ruleId])) stop();
    for (let i = 0; i < 2; i++) {
      const block = records[i], log = habits[i][ruleId]?.logs?.[date];
      if (block && !marks[i]) {
        const expected = normalizeBlock(makeRecurrenceInstance(rules[i], date)), observed = normalizeBlock(block);
        const fields = new Set([...Object.keys(expected), ...Object.keys(observed)]);
        if ([...fields].some(key => !["createdAt", "updatedAt"].includes(key) && !equal(observed[key], expected[key]))) stop();
      }
      if (fixed && marks[i]) {
        if (block.source === "daily-reading-auto" && !equal(log, { doneAt: marks[i].recordedAt })) stop();
        if (log && !equal(log, { doneAt: marks[i].recordedAt })) stop();
      } else if (fixed && log) stop();
    }
    if (!fixed) continue;
    const wi = records.indexOf(winner), winningMark = marks[wi];
    if (wi < 0) stop();
    const log = winningMark && winner.completed && !winner.deleted && winner.actualEndAt
      ? habits[wi][ruleId]?.logs?.[date] : undefined;
    for (const habit of habits) {
      habit[ruleId] = { ...habit[ruleId], logs: { ...habit[ruleId]?.logs } };
      if (log) habit[ruleId].logs[date] = copy(log); else delete habit[ruleId].logs[date];
    }
    touched.add(ruleId);
  }
  for (const id of touched) {
    const stamps = sides.map(side => side.habitStreaks?.[id]?.updatedAt || "");
    const stamp = stamps.slice().sort().at(-1);
    for (const habit of habits) { if (stamp) habit[id].updatedAt = stamp; }
  }
  const active = recordIds.size > 0;
  if ([...touched].some(id => !equal(habits[0][id], habits[1][id]))) stop();
  const mergedHabits = habits[(local.dataModifiedAt || "") <= (remote.dataModifiedAt || "") ? 1 : 0];
  return { routineIds, habitStreaks: active ? mergedHabits : local.habitStreaks,
    compareHabits: habits, active,
    changed: sides.map((side, i) => !equal(routineIds, ids[i]) || active && !equal(mergedHabits, side.habitStreaks || {})) };
}
