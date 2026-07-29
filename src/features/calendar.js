// src/features/calendar.js — v188 家族4ラベルのTimeTree予定を俯瞰する閲覧専用カレンダー。
// schedule-inboxの取得はtimeswitch.jsの既存キャッシュをDIで共有し、stateは変更しない。

import { registerActions } from "../ui/actions.js";

const CALENDAR_LABELS = [
  { name: "こーじ", color: "var(--tt-koji)" },
  { name: "予定", color: "var(--tt-plan)" },
  { name: "翠", color: "var(--tt-midori)" },
  { name: "デート", color: "var(--tt-date)" }
];
const CALENDAR_LABEL_NAMES = new Set(CALENDAR_LABELS.map((item) => item.name));

let escapeHTML, todayISO, parseDate, addDays, dateToISO, renderHeader, render, getScheduleData;
let calendarMonth = "";
let calendarPopoverDate = "";

function configureCalendar(deps) {
  ({
    escapeHTML, todayISO, parseDate, addDays, dateToISO, renderHeader, render, getScheduleData
  } = deps);
  registerActions({
    "calendar-prev-month": () => shiftCalendarMonth(-1),
    "calendar-next-month": () => shiftCalendarMonth(1),
    "calendar-open-day": ({ target }) => openCalendarDay(target.dataset.date || ""),
    "calendar-close-popover": () => closeCalendarPopover()
  });
}

function currentCalendarMonth() {
  if (!calendarMonth) calendarMonth = `${todayISO().slice(0, 7)}-01`;
  return calendarMonth;
}

function shiftCalendarMonth(delta) {
  const month = parseDate(currentCalendarMonth());
  calendarMonth = dateToISO(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  calendarPopoverDate = "";
  render();
}

function openCalendarDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  calendarPopoverDate = date;
  render();
}

function closeCalendarPopover() {
  calendarPopoverDate = "";
  render();
}

function scheduleEvents() {
  const data = typeof getScheduleData === "function" ? getScheduleData() : undefined;
  return (data?.events || []).filter((event) => CALENDAR_LABEL_NAMES.has(event.label));
}

function eventsForDate(date) {
  return scheduleEvents().filter((event) => event.date === date)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay)
      || (a.startAt || "").localeCompare(b.startAt || "")
      || a.title.localeCompare(b.title, "ja"));
}

function labelMeta(label) {
  return CALENDAR_LABELS.find((item) => item.name === label) || CALENDAR_LABELS[0];
}

function renderCalendarLegend() {
  return `<div class="calendar-legend" aria-label="TimeTreeラベル凡例">
    ${CALENDAR_LABELS.map((item) => `<span data-label="${escapeHTML(item.name)}"
      style="--calendar-label-color:${item.color}"><i></i>${escapeHTML(item.name)}</span>`).join("")}
  </div>`;
}

function renderCalendarDay(date, monthPrefix, rangeStart, rangeEnd) {
  const outOfRange = date < rangeStart || date > rangeEnd;
  const outsideMonth = !date.startsWith(monthPrefix);
  const events = outOfRange ? [] : eventsForDate(date);
  return `<button type="button"
    class="calendar-day${outOfRange ? " is-out-of-range" : ""}${outsideMonth ? " is-outside-month" : ""}"
    data-action="calendar-open-day" data-date="${date}">
    <time datetime="${date}">${Number(date.slice(8, 10))}</time>
    <span class="calendar-day-chips">${events.map((event) => {
      const meta = labelMeta(event.label);
      return `<span class="calendar-chip" data-label="${escapeHTML(event.label)}"
        style="--calendar-label-color:${meta.color}"
        title="${escapeHTML(event.title)}">${event.allDay ? "終日 " : ""}${escapeHTML(event.title)}</span>`;
    }).join("")}</span>
  </button>`;
}

function renderCalendarPopover(rangeStart, rangeEnd) {
  if (!calendarPopoverDate) return "";
  const outOfRange = calendarPopoverDate < rangeStart || calendarPopoverDate > rangeEnd;
  const events = outOfRange ? [] : eventsForDate(calendarPopoverDate);
  return `<div class="calendar-popover" role="dialog" aria-modal="false" aria-label="${calendarPopoverDate}の予定">
    <div class="calendar-popover-head">
      <strong>${calendarPopoverDate}</strong>
      <button type="button" data-action="calendar-close-popover" aria-label="閉じる">×</button>
    </div>
    <div class="calendar-popover-list">${events.length ? events.map((event) => {
      const meta = labelMeta(event.label);
      const time = event.allDay ? "終日" : [event.startAt, event.endAt].filter(Boolean).join("–") || "時刻なし";
      return `<div class="calendar-popover-item" style="--calendar-label-color:${meta.color}">
        <span data-label="${escapeHTML(event.label)}">${escapeHTML(event.label)}</span>
        <time>${escapeHTML(time)}</time>
        <strong>${escapeHTML(event.title)}</strong>
      </div>`;
    }).join("") : `<p>${outOfRange ? "予定データの取得範囲外です。" : "予定はありません。"}</p>`}</div>
  </div>`;
}

function renderCalendar() {
  const monthISO = currentCalendarMonth();
  const monthDate = parseDate(monthISO);
  const rangeStart = todayISO();
  const rangeEnd = addDays(rangeStart, 35);
  const gridStart = addDays(monthISO, -monthDate.getDay());
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const monthPrefix = monthISO.slice(0, 7);
  return `<div class="calendar-view">
    ${renderHeader("FAMILY SCHEDULE", "カレンダー")}
    <section class="panel calendar-panel">
      <div class="calendar-toolbar">
        <button type="button" class="btn" data-action="calendar-prev-month" aria-label="前月">◀</button>
        <h2>${monthDate.getFullYear()}年${monthDate.getMonth() + 1}月</h2>
        <button type="button" class="btn" data-action="calendar-next-month" aria-label="翌月">▶</button>
      </div>
      ${renderCalendarLegend()}
      <div class="calendar-weekdays" aria-hidden="true">
        ${["日", "月", "火", "水", "木", "金", "土"].map((day) => `<span>${day}</span>`).join("")}
      </div>
      <div class="calendar-grid">${days.map((date) =>
        renderCalendarDay(date, monthPrefix, rangeStart, rangeEnd)).join("")}</div>
      ${renderCalendarPopover(rangeStart, rangeEnd)}
    </section>
  </div>`;
}

export { configureCalendar, renderCalendar };
