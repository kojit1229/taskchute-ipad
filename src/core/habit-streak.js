// v252: 固定化ルーティンのストリーク計算。stateを参照しない純粋な葉モジュール。
// 日付文字列は数値へ分解して扱い、iOS Safariでずれるnew Date("文字列")は使わない。
function dateParts(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  const [year, month, day] = parts;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= monthDays[month - 1] ? parts : null;
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
    return { currentStreak: 0, bestStreak: 0, totalCount: 0, challengeDay: 0, successRate: 0, last28: [] };
  }
  const logs = habit?.logs && typeof habit.logs === "object" ? habit.logs : {};
  let currentStreak = 0;
  let bestStreak = 0;
  let totalCount = 0;
  let applicableCount = 0;
  let challengeDay = 0;
  let cursor = since;
  let guard = 0;
  while (cursor && cursor <= todayIso && guard++ < 20000) {
    challengeDay++;
    if (appliesOn(rule, cursor)) {
      const checked = !!logs[cursor];
      if (checked || cursor !== todayIso) applicableCount++;
      if (checked) {
        currentStreak++;
        totalCount++;
      }
      else if (cursor !== todayIso) currentStreak = 0;
      bestStreak = Math.max(bestStreak, currentStreak);
    }
    cursor = shiftDate(cursor, 1);
  }
  const last28 = [];
  cursor = shiftDate(todayIso, -27);
  for (let i = 0; i < 28; i++) {
    const applicable = cursor >= since && appliesOn(rule, cursor);
    last28.push({ date: cursor, applicable, checked: applicable && !!logs[cursor] });
    cursor = shiftDate(cursor, 1);
  }
  return { currentStreak, bestStreak, totalCount, challengeDay,
    successRate: applicableCount ? Math.round((totalCount / applicableCount) * 100) : 0, last28 };
}

// v280: 固定化解除済みの閉区間だけを集計する。期間外ログは参照せず、非該当曜日は分母から除く。
function habitStreakPeriodStats(rule, habit, fromIso, toIso) {
  if (!dateParts(fromIso) || !dateParts(toIso) || fromIso > toIso || !["daily", "weekdays"].includes(rule?.kind)) {
    return { bestStreak: 0, totalCount: 0, successRate: 0 };
  }
  const logs = habit?.logs && typeof habit.logs === "object" && !Array.isArray(habit.logs) ? habit.logs : {};
  let bestStreak = 0;
  let currentStreak = 0;
  let totalCount = 0;
  let applicableCount = 0;
  let cursor = fromIso;
  let guard = 0;
  while (cursor && cursor <= toIso && guard++ < 20000) {
    if (appliesOn(rule, cursor)) {
      applicableCount++;
      if (logs[cursor]) {
        currentStreak++;
        totalCount++;
        bestStreak = Math.max(bestStreak, currentStreak);
      } else currentStreak = 0;
    }
    cursor = shiftDate(cursor, 1);
  }
  return {
    bestStreak,
    totalCount,
    successRate: applicableCount ? Math.round((totalCount / applicableCount) * 100) : 0
  };
}

export { habitStreakStats, habitStreakPeriodStats };
