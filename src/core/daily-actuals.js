const invalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });

// Local calendar arithmetic: never parse a date string through Date.
function actualTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value || "");
  if (!match) return null;
  const [y, m, d, h, min, sec] = match.slice(1).map(v => Number(v || 0));
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d); date.setUTCHours(h, min, sec, 0);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    && date.getUTCHours() === h && date.getUTCMinutes() === min && date.getUTCSeconds() === sec ? date.getTime() : null;
}

export function actualDurationMinutes(block) {
  const start = actualTime(block.actualStartAt), end = actualTime(block.actualEndAt);
  return start == null || end == null || end < start ? null : Math.round((end - start) / 60000);
}

export function dailyActuals(blocks, date) {
  return (blocks || []).filter(block => !block.deleted && (date == null || block.date === date) && block.actualEndAt)
    .sort((a, b) => String(a.actualEndAt).localeCompare(String(b.actualEndAt))
      || String(a.actualStartAt || "").localeCompare(String(b.actualStartAt || "")) || String(a.id).localeCompare(String(b.id)));
}

export function buildActualEdit(state, input) {
  const block = state.blocks?.find(row => row.id === input.id && !row.deleted);
  if (!block || !["block", "actual"].includes(input.kind)) throw invalid("訂正する実績を確認してください");
  if (!block.actualEndAt) throw invalid("終了実績がありません。先に終了を保存してください");
  const values = input.values || {}, after = { ...block };
  if (values.date != null && values.date !== block.date) throw invalid("実績訂正では帰属日を変更できません");
  for (const key of ["actualStartAt", "actualEndAt"]) {
    const value = values[key] ?? block[key] ?? "";
    if (value !== "" && actualTime(value) == null) throw invalid("実績時刻を確認してください");
    after[key] = value && value.length === 16 ? `${value}:00` : value;
  }
  if (!after.actualEndAt || (after.actualStartAt && actualDurationMinutes(after) == null))
    throw invalid("終了は開始以降の日付・時刻を指定してください");
  for (const key of ["charge", "discharge"]) if (values[key] != null) {
    const number = Number(values[key]);
    if (!Number.isInteger(number) || number < 0 || number > 5) throw invalid("充放電は0〜5で指定してください");
    after[key] = number;
  }
  if (values.comment != null) after.comment = String(values.comment);
  return { records: Object.keys(after).every(key => after[key] === block[key]) ? []
    : [{ kind: "blocks", before: block, after }], block: after };
}
