// Calendar minutes, independent of the device timezone. Never parse strings with Date.
function calendarDay(value) {
  const match = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return NaN;
  const [, year, month, day] = match.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return NaN;
  return Date.UTC(year + 400, month - 1, day) / 86400000;
}

export function plannedMinute(value, date) {
  const match = typeof value === "string"
    && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return NaN;
  const hour = Number(match[2]), minute = Number(match[3]), second = Number(match[4] || 0);
  if (hour > 24 || minute > 59 || second > 59 || (hour === 24 && (minute || second))) return NaN;
  return (calendarDay(match[1]) - calendarDay(date)) * 1440 + hour * 60 + minute + second / 60;
}

/** schedules must already be validated by their owner; warnings stay at the connection.
 * Drafts explicitly use { id, plannedStartAt, plannedEndAt }; no implicit state lookup.
 * intervals retain the original range, while occupied/gaps/overlaps use the window.
 */
export function plannedOccupancy({ blocks = [], schedules = [], draftIntervals = [] } = {}, date, window = [240, 1440]) {
  const intervals = [], occupied = [], gaps = [], overlaps = [], invalid = [];
  const result = { intervals, occupied, gaps, overlaps, invalid };
  const reject = (kind, row, reason) => invalid.push({ kind, id: row?.id ?? null, reason });
  if (!Number.isFinite(calendarDay(date)) || !Array.isArray(window) || window.length !== 2
      || !window.every(Number.isFinite) || window[0] >= window[1]) {
    reject("input", null, "日付または計算範囲が不正です");
    return result;
  }
  const [from, to] = window;
  for (const [kind, rows] of [["block", blocks], ["schedule", schedules], ["draft", draftIntervals]]) {
    if (!Array.isArray(rows)) { reject(kind, null, "区間の配列が不正です"); continue; }
    const ids = new Set();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)
          || typeof row.id !== "string" || !row.id.trim()) {
        reject(kind, row, "区間の識別子が不正です"); continue;
      }
      if (row.deleted || (kind === "block" && row.migratedTo)) continue;
      if (ids.has(row.id)) { reject(kind, row, "識別子が重複しています"); continue; }
      ids.add(row.id);
      const missingStart = row.plannedStartAt == null || row.plannedStartAt === "";
      const missingEnd = row.plannedEndAt == null || row.plannedEndAt === "";
      if (kind === "block" && missingStart && missingEnd) continue;
      const start = plannedMinute(row.plannedStartAt, date);
      let end = plannedMinute(row.plannedEndAt, date), estimatedEnd = false;
      if (kind === "block" && missingEnd && Number.isFinite(start)) {
        // Legacy blockOccupiedRange: estimate || 30, clamped to 15..240 minutes.
        const estimate = row.estimateMin || 30;
        if (typeof estimate !== "number" || !Number.isFinite(estimate)) {
          reject(kind, row, "終了欠落の見積が不正です"); continue;
        }
        end = start + Math.max(15, Math.min(240, estimate));
        estimatedEnd = true;
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        reject(kind, row, "予定の開始終了が不正です"); continue;
      }
      if (row.date != null && (!Number.isFinite(calendarDay(row.date))
          || row.date !== row.plannedStartAt.slice(0, 10))) {
        reject(kind, row, "帰属日と開始日が一致しません"); continue;
      }
      const range = [Math.max(from, start), Math.min(to, end)];
      intervals.push({ kind, id: row.id, start, end, estimatedEnd,
        plannedStartAt: row.plannedStartAt, plannedEndAt: row.plannedEndAt,
        range: range[0] < range[1] ? range : null });
    }
  }
  const visible = intervals.filter(row => row.range).sort((a, b) => a.range[0] - b.range[0]);
  for (let i = 0; i < visible.length; i++) {
    const row = visible[i], [start, end] = row.range;
    const last = occupied[occupied.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else occupied.push([start, end]);
    for (let j = i + 1; j < visible.length && visible[j].range[0] < end; j++) {
      const other = visible[j];
      overlaps.push({ left: { kind: row.kind, id: row.id }, right: { kind: other.kind, id: other.id },
        range: [Math.max(start, other.range[0]), Math.min(end, other.range[1])] });
    }
  }
  let cursor = from;
  for (const [start, end] of occupied) {
    if (cursor < start) gaps.push([cursor, start]);
    cursor = end;
  }
  if (cursor < to) gaps.push([cursor, to]);
  return result;
}
