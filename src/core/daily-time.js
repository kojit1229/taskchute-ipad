const invalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });
function day(value, offset = 0) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) throw invalid("日付を確認してください");
  const [, y, m, d] = match.map(Number), date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d)
    throw invalid("日付を確認してください");
  date.setDate(d + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function time(value, date, next = false) {
  const match = /^(?:(\d{4}-\d{2}-\d{2})T)?(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw invalid("時刻を確認してください");
  const [, explicit, h, m, s = "00"] = match;
  if (+h > 24 || +m > 59 || +s > 59 || (+h === 24 && (+m || +s)))
    throw invalid("時刻を確認してください");
  return `${day(explicit || date, +h === 24 || (!explicit && next) ? 1 : 0)}T${+h === 24 ? "00" : h}:${m}:${s}`;
}

// Only an explicit date edit moves the Block; numeric Date constructors handle month/year rollover.
export function validateDailyTimes(values, block) {
  const date = day(values.date ?? block.date);
  const { start, end } = values;
  if (typeof start !== "string" || typeof end !== "string") throw invalid("時刻を入力してください");
  if ((!start) !== (!end)) throw invalid("開始と終了を両方入力するか、両方を未定にしてください");
  let plannedStartAt = start ? time(start, date) : "";
  let plannedEndAt = end ? time(end, date, values.endNextDay === true || values.endNextDay === "true") : "";
  // Merely displaying a minute picker must not strip existing seconds.
  if (/^\d{2}:\d{2}$/.test(start) && plannedStartAt.slice(0, 16) === block.plannedStartAt?.slice(0, 16))
    plannedStartAt = block.plannedStartAt;
  if (/^\d{2}:\d{2}$/.test(end) && plannedEndAt.slice(0, 16) === block.plannedEndAt?.slice(0, 16))
    plannedEndAt = block.plannedEndAt;
  if (plannedStartAt && plannedEndAt <= plannedStartAt) throw invalid("終了は開始より後にしてください。翌日の場合は明示してください");
  return { date, plannedStartAt, plannedEndAt };
}

export function buildDailyTimes(state, input) {
  const block = state.blocks.find(row => row.id === input.id && !row.deleted);
  if (!block || !["block", "schedule"].includes(input.kind)) throw invalid("対象が変更されました");
  const after = { ...block, ...validateDailyTimes(input.values || input, block) };
  return { records: Object.keys(after).every(key => after[key] === block[key]) ? []
    : [{ kind: "blocks", before: block, after }], block: after };
}

export function cancelDailyTimes(state, input) {
  const block = state.blocks.find(row => row.id === input.id && !row.deleted);
  if (!block || !["block", "schedule"].includes(input.kind)) throw invalid("対象が変更されました");
  return { records: [], block };
}
