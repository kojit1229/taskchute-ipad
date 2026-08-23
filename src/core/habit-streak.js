// v252: 固定化ルーティンのストリーク計算。stateを参照しない純粋な葉モジュール。
// 日付文字列は数値へ分解して扱い、iOS Safariでずれるnew Date("文字列")は使わない。
function dateParts(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return match ? match.slice(1).map(Number) : null;
}

function shiftDate(iso, days) {
  const parts = dateParts(iso);
  if (!parts) return "";
  const date = new Date(parts[0], parts[1] - 1, parts[2] + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function appliesOn(rule, iso) {
  if (rule?.kind === "daily") return true;
  if (rule?.kind !== "weekdays") return false;
  const parts = dateParts(iso);
  if (!parts) return false;
  const weekday = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
  return weekday >= 1 && weekday <= 5;
}

function habitStreakStats(rule, habit, todayIso) {
  const since = rule?.streakSince;
  if (!dateParts(since) || !dateParts(todayIso) || since > todayIso || !["daily", "weekdays"].includes(rule?.kind)) {
    return { currentStreak: 0, bestStreak: 0 };
  }
  const logs = habit?.logs && typeof habit.logs === "object" ? habit.logs : {};
  let currentStreak = 0;
  let bestStreak = 0;
  let cursor = since;
  let guard = 0;
  while (cursor && cursor <= todayIso && guard++ < 20000) {
    if (appliesOn(rule, cursor)) {
      if (logs[cursor]) currentStreak++;
      else if (cursor !== todayIso) currentStreak = 0;
      bestStreak = Math.max(bestStreak, currentStreak);
    }
    cursor = shiftDate(cursor, 1);
  }
  return { currentStreak, bestStreak };
}

export { habitStreakStats };
