// AI Coach phase 1a: deterministic calorie budget + quick meal logging.
import { state } from "../state/store.js";
import { registerActions } from "../ui/actions.js";

const QUICK_MEALS = [
  ["定食", 700], ["丼・カレー", 800], ["コンビニ弁当", 600],
  ["麺類", 600], ["軽食", 300], ["飲料", 150]
];
const COACH_MEAL_KEEP_DAYS = 90;
const COACH_MEALS_MAX = 500;
const LONG_PRESS_MS = 500;
const DEFAULT_COACH = Object.freeze({
  meals: Object.freeze([]),
  settings: Object.freeze({ dailyKcal: 2278 })
});

let escapeHTML, todayISO, saveState, panelHeading, renderCircularProgress;
let pointerTracking = null;
let suppressedQuickKey = "";
let suppressQuickUntil = 0;
let pointerEventsInstalled = false;

function shiftISODate(dateISO, deltaDays) {
  const match = String(dateISO || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + deltaDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function trimCoachMeals(meals, anchorDate, keepDays = COACH_MEAL_KEEP_DAYS, maxMeals = COACH_MEALS_MAX) {
  const cutoff = shiftISODate(anchorDate, -(keepDays - 1));
  const validMeals = Array.isArray(meals) ? meals : [];
  const recentMeals = cutoff
    ? validMeals.filter((meal) =>
      meal && /^\d{4}-\d{2}-\d{2}$/.test(meal.date || "") && meal.date >= cutoff)
    : validMeals.slice();
  return recentMeals.slice(-maxMeals);
}

function coachSummaryForDate(meals, date, dailyKcal = 2278) {
  const entries = (Array.isArray(meals) ? meals : []).filter((meal) =>
    meal && meal.date === date && !meal.deleted);
  const total = entries.reduce((sum, meal) =>
    sum + (Number.isFinite(Number(meal.quickKcal)) ? Math.max(0, Number(meal.quickKcal)) : 0), 0);
  const budget = Number.isFinite(Number(dailyKcal)) && Number(dailyKcal) > 0 ? Number(dailyKcal) : 2278;
  return { entries, total, dailyKcal: budget, remaining: budget - total };
}

function markCoachMealDeleted(meals, id) {
  const updatedAt = new Date().toISOString();
  return (Array.isArray(meals) ? meals : []).map((meal) =>
    meal?.id === id ? { ...meal, deleted: true, updatedAt } : meal);
}

function currentCoach() {
  return state.coachLog && typeof state.coachLog === "object" ? state.coachLog : DEFAULT_COACH;
}

function formatKcal(value) {
  return Math.round(value).toLocaleString("ja-JP");
}

function renderCoachBody() {
  const coach = currentCoach();
  const date = todayISO();
  const summary = coachSummaryForDate(coach.meals, date, coach.settings?.dailyKcal ?? 2278);
  const color = summary.remaining > 500
    ? "var(--cockpit-go, var(--accent))"
    : summary.remaining >= 100 ? "var(--orange)" : "var(--red)";
  const message = summary.remaining < 100 ? "今日はここまで。次の食事でまた整えよう" : "この範囲でゆっくり選べます";
  const ring = renderCircularProgress(
    Math.max(0, summary.remaining) / summary.dailyKcal,
    `<strong>${formatKcal(summary.remaining)}</strong><small>kcal 残り</small>`, color
  );
  const buttons = QUICK_MEALS.map(([label, kcal]) =>
    `<button type="button" data-action="coach-quick-add" data-label="${escapeHTML(label)}" data-kcal="${kcal}">${escapeHTML(label)}${kcal}</button>`).join("");
  const entries = summary.entries.slice().reverse().map((meal) =>
    `<li><time>${escapeHTML(meal.time || "--:--")}</time><span>${escapeHTML(meal.label || "食事")}</span><b>${formatKcal(meal.quickKcal)} kcal</b>`
    + `<button type="button" data-action="coach-delete-meal" data-id="${escapeHTML(meal.id)}" aria-label="${escapeHTML(meal.label || "食事")}を取り消す">取り消す</button></li>`).join("");
  return `<div class="today-coach-stage">${ring}<div class="today-coach-numbers">
      <strong>残り ${formatKcal(summary.remaining)} kcal</strong><span>摂取 ${formatKcal(summary.total)} / 目安 ${formatKcal(summary.dailyKcal)} kcal</span><small>${message}</small>
    </div></div>
    <div class="today-coach-quick"><span>食事を記録 <small>長押しでkcalを変更</small></span><div>${buttons}</div></div>
    <ul class="today-coach-log">${entries || "<li class=\"is-empty\">今日の記録はまだありません</li>"}</ul>`;
}

function renderCoach() {
  return `<section class="today-panel today-coach today-span-2">
    ${panelHeading("AI COACH", "ボディメイク", "LIVE")}
    <div data-coach-body>${renderCoachBody()}</div>
  </section>`;
}

function patchCoach() {
  const root = typeof document === "undefined" ? null : document.querySelector("[data-coach-body]");
  if (root) root.innerHTML = renderCoachBody();
}

function appendQuickMeal(label, kcal) {
  const now = new Date();
  const date = todayISO();
  state.coachLog.meals = trimCoachMeals([...state.coachLog.meals, {
    id: `meal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    date,
    time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    kind: "quick", quickKcal: kcal, label, updatedAt: now.toISOString()
  }], date);
  patchCoach();
  saveState();
}

function deleteMeal(id) {
  if (!state.coachLog.meals.some((meal) => meal?.id === id && !meal.deleted)) return;
  state.coachLog.meals = markCoachMealDeleted(state.coachLog.meals, id);
  patchCoach();
  saveState();
}

function clearPointerTracking() {
  if (pointerTracking?.timer) clearTimeout(pointerTracking.timer);
  pointerTracking = null;
}

function installLongPressDelegation() {
  if (pointerEventsInstalled || typeof document === "undefined") return;
  pointerEventsInstalled = true;
  document.addEventListener("pointerdown", (event) => {
    const button = event.target?.closest?.('[data-action="coach-quick-add"]');
    if (!button || !event.isPrimary || event.button !== 0) return;
    const key = `${button.dataset.label}|${button.dataset.kcal}`;
    pointerTracking = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer: setTimeout(() => {
      suppressedQuickKey = key;
      const raw = globalThis.prompt?.(`${button.dataset.label}のkcal`, button.dataset.kcal);
      suppressQuickUntil = Date.now() + 1200;
      clearPointerTracking();
      if (raw == null) return;
      const kcal = /^\d{1,4}$/.test(raw.trim()) ? Number(raw) : 0;
      if (kcal > 0) appendQuickMeal(button.dataset.label, kcal);
      else globalThis.alert?.("kcalは1〜9999の整数で入力してください");
    }, LONG_PRESS_MS) };
  });
  document.addEventListener("pointermove", (event) => {
    if (!pointerTracking || event.pointerId !== pointerTracking.pointerId) return;
    if (Math.hypot(event.clientX - pointerTracking.x, event.clientY - pointerTracking.y) > 10) clearPointerTracking();
  });
  const endPointer = (event) => {
    if (pointerTracking && event.pointerId === pointerTracking.pointerId) clearPointerTracking();
  };
  document.addEventListener("pointerup", endPointer);
  document.addEventListener("pointercancel", endPointer);
}

function configureCoach(deps) {
  ({ escapeHTML, todayISO, saveState, panelHeading, renderCircularProgress } = deps);
  registerActions({
    "coach-quick-add": ({ target }) => {
      const key = `${target.dataset.label}|${target.dataset.kcal}`;
      if (key === suppressedQuickKey && Date.now() < suppressQuickUntil) return;
      appendQuickMeal(target.dataset.label, Number(target.dataset.kcal));
    },
    "coach-delete-meal": ({ id }) => deleteMeal(id)
  });
  installLongPressDelegation();
}

export {
  configureCoach, renderCoach, coachSummaryForDate, trimCoachMeals, markCoachMealDeleted, QUICK_MEALS
};
