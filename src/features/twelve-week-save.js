import { nextMutationStamp } from "../core/mutation-stamp.js";

const content = value => JSON.stringify(value, (key, item) =>
  ["updatedAt", "completedChangedAt", "excusedChangedAt", "doneChangedAt"].includes(key) ? undefined : item);

// Supply one lower bound to commitCandidate; observations retain their real times.
export function prepareRelatedStamps(before, after, kinds, now) {
  const changed = kinds.flatMap(kind => {
    if (!Array.isArray(after[kind])) return [];
    const old = new Map((before[kind] || []).map(row => [row.id, row]));
    return after[kind].flatMap(row => content(old.get(row.id)) === content(row) ? [] : [{ before: old.get(row.id), after: row }]);
  });
  if (!changed.length) return;
  const nested = changed.flatMap(row => (row.after.milestones || []).flatMap(item => {
    const old = row.before?.milestones?.find(entry => entry.id === item.id);
    return content(old) === content(item) ? [] : [{ before: old, after: item }];
  }));
  const rows = [...changed, ...nested], fields = ["updatedAt", "completedChangedAt", "excusedChangedAt", "doneChangedAt"];
  const stamp = nextMutationStamp({ now, candidates: rows.flatMap(row =>
    [row.before?.createdAt, ...fields.flatMap(key => [row.before?.[key], row.after[key]])]) });
  const [y, m, d, h, min, sec] = stamp.match(/\d+/g).map(Number);
  const floor = new Date(0);
  floor.setUTCFullYear(y, m - 1, d); floor.setUTCHours(h, min, sec - 1, 0);
  for (const row of changed) row.after.updatedAt = floor.toISOString().slice(0, 19);
  for (const row of nested) row.after.updatedAt = stamp;
  for (const row of rows) for (const key of fields.slice(1)) {
    if (row.after[key] && row.after[key] !== row.before?.[key]) row.after[key] = stamp;
  }
}

export function buildTwelveWeekDraft(input, deps) {
  const before = JSON.parse(JSON.stringify(deps.state()));
  const value = input.work();
  prepareRelatedStamps(before, deps.state(), ["weeklyCommitments", "tracks", "trackMeasurements", "projects"], deps.now());
  if (value?.ok !== false) deps.transaction.complete();
  return value;
}

export const twelveWeekSaveOperation = {
  legacy: true, build: buildTwelveWeekDraft,
  run(input, deps) {
    if (deps.transaction.active) return buildTwelveWeekDraft(input, deps);
    let value;
    const result = deps.transaction.run(() => { value = buildTwelveWeekDraft(input, deps); },
      { kinds: ["weeklyCommitments", "tracks", "trackMeasurements", "projects"] });
    return result.ok ? value ?? { ok: true } : { ok: false, errors: ["保存できませんでした。入力は残しています"] };
  }
};
