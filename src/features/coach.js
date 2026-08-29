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
let todayISO, saveState;
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

function markCoachMealDeleted(meals, id) {
  const updatedAt = new Date().toISOString();
  return (Array.isArray(meals) ? meals : []).map((meal) =>
    meal?.id === id ? { ...meal, deleted: true, updatedAt } : meal);
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
  ({ todayISO, saveState } = deps);
  registerActions({
    "coach-quick-add": ({ target }) => {
      const key = `${target.dataset.label}|${target.dataset.kcal}`;
      if (key === suppressedQuickKey && Date.now() < suppressQuickUntil) return;
      appendQuickMeal(target.dataset.label, Number(target.dataset.kcal));
    }
  });
  installLongPressDelegation();
}

export {
  configureCoach, trimCoachMeals, markCoachMealDeleted, QUICK_MEALS
};
