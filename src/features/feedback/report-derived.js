// Generated from verified current helpers; state is one detached capture clone. No shared mutable state.
const CONDITION_BUDGET_BASELINE_LOOKBACK_DAYS = 28;
const CONDITION_BUDGET_BASELINE_MIN_SAMPLES = 7;
const CONDITION_BUDGET_HRV_DEFICIT_PCT = -15;
const CONDITION_BUDGET_HRV_LOW_PCT = -5;
const CONDITION_BUDGET_HR_DEFICIT_BPM = 5;
const CONDITION_BUDGET_HR_LOW_BPM = 2;
const CONDITION_BUDGET_SLEEP_DEFICIT_H = 5.5;
const CONDITION_BUDGET_SLEEP_LOW_H = 6.5;
const CONDITION_BUDGET_LABELS = { deficit: "赤字", low: "低予算", normal: "通常" };
export function deriveReportValues(state, date) {
  if (!state || typeof date !== "string" || !date) throw Error("report_date_required");
  const getSettings = () => state.settings;
  const todayISO = () => { throw Error("implicit_report_date_forbidden"); };
function blocksForDate(date) {
  return state.blocks
    .filter((block) => !block.deleted && block.date === date)
    .sort((a, b) => (a.plannedStartAt || "99").localeCompare(b.plannedStartAt || "99"));
}
function cycleWeekProgress(dateISO) {
  const date = dateISO || state.selectedDate;
  // 12WY にチェック済みの Project のみ
  const goals = state.projects.filter((p) =>
    !p.deleted && p.kind === "normal" && p.status === "active" && p.twelveWeekStartDate);
  const goalIds = goals.map((p) => p.id);
  const allTasks = state.tasks.filter((t) => !t.deleted && goalIds.includes(t.projectId) && isTaskCountable(t));  // v35: 中断/中止は分母から除外
  const { weekStart, weekEnd } = weekRange(date);
  const weekTasks = allTasks.filter((t) => t.dueDate && t.dueDate >= weekStart && t.dueDate <= weekEnd);
  const done = weekTasks.filter((t) => t.status === "completed").length;
  const total = weekTasks.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
function weekRange(dateISO) {
  const d = parseDate(dateISO); // v56: new Date("...T00:00:00") は iOS で UTC 誤解釈のため parseDate に統一
  const dow = (d.getDay() + 1) % 7; // Sat=0, Sun=1, ... Fri=6
  const sat = addDays(dateISO, -dow);
  return { weekStart: sat, weekEnd: addDays(sat, 6) };
}
function isTaskCountable(t) {
  const s = t?.status || "todo";
  return s !== "suspended" && s !== "cancelled";
}
function taskchuteBlocks(blocks) {
  return blocks.filter((b) => {
    if (b.source === "timeline") return false;
    if (b.category === "ルーティン") return false;
    if (b.recurrenceGroupId) return false;
    if (!b.taskId) return false;
    if (b.migratedTo) return false;  // 1-H1: 翌日へ送済のBlockは今日の占有として残さない(K16)
    if (isStaleBlock(b)) return false;  // v48: 中断/中止/削除タスクの未完了分は分母から外す
    const task = state.tasks.find((t) => t.id === b.taskId);
    if (!task || !task.projectId) return false;
    if (task.kind === "other") return false;  // 単発ブロックは非表示
    return true;
  });
}
function isStaleBlock(b) {
  if (b.completed || !b.taskId) return false;
  const task = state.tasks.find((t) => t.id === b.taskId);
  if (!task) return false;
  return task.deleted || task.status === "suspended" || task.status === "cancelled";
}
function taskchuteStartRate(blocks) {
  const list = taskchuteBlocks(blocks);
  const done = list.filter((b) => b.completed || b.actualStartAt).length;
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}
function deferrableBlocks(blocks) {
  return (blocks || []).filter((b) => {
    if (b.deleted) return false;
    if (b.category === "ルーティン") return false;
    if (b.recurrenceGroupId) return false;
    if (b.source === "timeline") return false;
    if (isStaleBlock(b)) return false;
    return true;
  });
}
function deferralStats(blocks) {
  const list = deferrableBlocks(blocks);
  const started = list.filter(blockEverStarted).length;
  return { pending: list.length - started, started, total: list.length };
}
function blockEverStarted(b) {
  return Boolean(b && (b.completed || b.actualStartAt || b.everStartedAt));
}
function conditionBudget(date) {
  const found = latestSleepLogWithin(date);
  if (!found) return { level: "none", reason: "" };
  const { log, logDate, ageDays } = found;
  const baseline = conditionBudgetBaseline(date);
  const factors = [];
  const hrvSleep = toNumber(log.hrvSleep);
  if (baseline.hrvBaseline != null && hrvSleep !== null) {
    const pct = ((hrvSleep - baseline.hrvBaseline) / baseline.hrvBaseline) * 100;
    if (pct <= CONDITION_BUDGET_HRV_DEFICIT_PCT) factors.push({ severity: "deficit", text: `HRV ${pct >= 0 ? "+" : ""}${Math.round(pct)}%` });
    else if (pct <= CONDITION_BUDGET_HRV_LOW_PCT) factors.push({ severity: "low", text: `HRV ${pct >= 0 ? "+" : ""}${Math.round(pct)}%` });
  }
  const hrSleep = toNumber(log.hrSleep);
  if (baseline.hrBaseline != null && hrSleep !== null) {
    const diff = hrSleep - baseline.hrBaseline;
    if (diff >= CONDITION_BUDGET_HR_DEFICIT_BPM) factors.push({ severity: "deficit", text: `HR +${Math.round(diff)}bpm` });
    else if (diff >= CONDITION_BUDGET_HR_LOW_BPM) factors.push({ severity: "low", text: `HR +${Math.round(diff)}bpm` });
  }
  const sleepH = toNumber(log.sleepH);
  if (sleepH !== null) {
    if (sleepH < CONDITION_BUDGET_SLEEP_DEFICIT_H) factors.push({ severity: "deficit", text: `睡眠${sleepH.toFixed(1)}h` });
    else if (sleepH < CONDITION_BUDGET_SLEEP_LOW_H) factors.push({ severity: "low", text: `睡眠${sleepH.toFixed(1)}h` });
  }
  const level = factors.some((f) => f.severity === "deficit") ? "deficit" : factors.length ? "low" : "normal";
  const factorsText = factors.map((f) => f.text).join("・");
  // v131: フォールバック(ageDays>0)の場合、根拠が0件(通常判定)でも日付ラベルだけは必ず出す
  // (「今日は通常」と黙って誤読されないようにする)。
  const ageLabel = ageDays > 0 ? `${shortSleepDate(logDate)}朝` : "";
  const reason = ageLabel && factorsText ? `${ageLabel}: ${factorsText}` : (ageLabel || factorsText);
  return { level, reason };
}
function conditionBudgetBaseline(date) {
  const from = addDays(date, -CONDITION_BUDGET_BASELINE_LOOKBACK_DAYS);
  const to = addDays(date, -1);
  const hrVals = [], hrvVals = [];
  Object.entries(state.sleep.logs).forEach(([d, log]) => {
    if (d < from || d > to) return;
    const hrV = toNumber(log.hrSleep);
    if (hrV !== null) hrVals.push(hrV);
    const hrvV = toNumber(log.hrvSleep);
    if (hrvV !== null) hrvVals.push(hrvV);
  });
  return {
    hrBaseline: hrVals.length >= CONDITION_BUDGET_BASELINE_MIN_SAMPLES ? median(hrVals) : null,
    hrvBaseline: hrvVals.length >= CONDITION_BUDGET_BASELINE_MIN_SAMPLES ? median(hrvVals) : null
  };
}
function latestSleepLogWithin(date, maxAgeDays = 2) {
  for (let age = 0; age <= maxAgeDays; age++) {
    const d = addDays(date, -age);
    const log = state.sleep.logs[d];
    if (log) return { log, logDate: d, ageDays: age };
  }
  return null;
}
function shortSleepDate(s) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${+m[1]}/${+m[2]}` : s;
}
function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function toNumber(v) {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function parseDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function addDays(date, delta) {
  const d = parseDate(date);
  d.setDate(d.getDate() + delta);
  return dateToISO(d);
}
function dateToISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
function pad2(value) {
  return String(value).padStart(2, "0");
}
function routineRate(blocks, recurrences = []) {
  // 率計器は計画Blockの消化を測るため、実績記録専用のoneTap Blockは除外する。
  // v253: protectionは実行率で裁かない契約のため、対応するルールのBlockも母集団から除外する。
  const protectedIds = new Set(recurrences.filter((rule) => !rule.deleted && rule.protection).map((rule) => rule.id));
  const list = blocks.filter((b) => b.category === "ルーティン" && !b.oneTap && !protectedIds.has(b.recurrenceGroupId));
  const done = list.filter((b) => b.completed).length;
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}
function parseISO(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}
function isoOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
function addDaysLocal(iso, delta) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + delta);
  return isoOf(d);
}
function daysBetweenLocal(start, end) {
  const ms = parseISO(end).getTime() - parseISO(start).getTime();
  return Math.ceil(ms / 86400000);
}
function clampLocal(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}
function dateSpanMetric(today, start, end) {
  const total = Math.max(1, daysBetweenLocal(start, end));
  const elapsed = clampLocal(daysBetweenLocal(start, today), 0, total);
  const remaining = Math.max(0, daysBetweenLocal(today, end));
  const progress = Math.round((elapsed / total) * 100);
  return { total, elapsed, remaining, progress };
}
function cycleWeekNumber(elapsedDays) {
  return clampLocal(Math.floor(elapsedDays / 7) + 1, 1, 12);
}
function cycleWeekForDate(dateISO) {
  const date = dateISO || todayISO();
  const settings = (typeof getSettings === "function" ? getSettings() : {}) || {};
  const start = settings.twelveWeekStartDate || date;
  const cycle = dateSpanMetric(date, start, addDaysLocal(start, 84));
  return cycleWeekNumber(cycle.elapsed);
}
  const blocks = blocksForDate(date);
  const budget = conditionBudget(date);
  return { rateTaskchute: taskchuteStartRate(blocks), rateRoutine: routineRate(blocks, state.recurrences || []),
    rateCycleWeek: cycleWeekProgress(date), cycleWeek: cycleWeekForDate(date), rateDeferral: deferralStats(blocks),
    conditionBudget: budget, conditionLabel: CONDITION_BUDGET_LABELS[budget.level] || "" };
}
