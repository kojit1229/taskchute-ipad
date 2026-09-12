import { normalizeSingleSchedules } from "../core/single-schedule.js";
import { plannedMinute } from "../core/planned-occupancy.js";
import { contentKey } from "../core/single-schedule-merge.js";
import { buildDailyViewModel } from "./daily-view-model.js";
import { registerActions } from "../ui/actions.js";

export function configureScheduleView(deps) {
  const open = (id, date) => {
    const record = scheduleDisplay(deps.state(), date).records.find(row => row.id === id);
    if (!record) { deps.notify("予定を表示できません。最新の保存値を確認してください"); return; }
    deps.state().modal = { type: "singleScheduleView", id, date };
    deps.renderModal(deps.modalHeaderHTML("単発予定", "single-schedule-detail")
      + renderSchedule(record, date, deps.escapeHTML, { detail: true }) + "</div></div>");
  };
  registerActions({
    "schedule-view-details": ({ id, target }) => {
      const action = () => open(id, target.dataset.date);
      if (!deps.requestLeave(action)) action();
    },
    "schedule-view-complete": ({ id, target }) => {
      const action = () => {
        if (target.disabled) return;
        target.disabled = true;
        target.dataset.requestId ||= crypto.randomUUID();
        const detail = deps.state().modal?.type === "singleScheduleView";
        const result = deps.run({ kind: "schedule", id, requestId: target.dataset.requestId,
          baseFingerprint: target.dataset.fingerprint, desiredCompleted: target.dataset.completed === "true" });
        if (!result.ok) { target.disabled = false; deps.notify(result.error?.message || "保存できません。操作を残しています"); return; }
        deps.render();
        if (detail) open(id, target.dataset.date);
        deps.notify("この端末で保存・同期待ち");
      };
      if (!deps.requestLeave(action)) action();
    }
  });
}

// Same source records/IDs on all three surfaces, including the previous day's continuation.
export function scheduleDisplay(state, date) {
  try {
    if (state.singleSchedules === undefined) return { records: [], warnings: [], error: "単発予定は未取得です。配置を停止しています" };
    if (!Array.isArray(state.singleSchedules)) throw new TypeError("単発予定の容器が不正です");
    const { records, warnings } = normalizeSingleSchedules(state.singleSchedules);
    return { records: records.filter(row => !row.deleted && plannedMinute(row.plannedStartAt, date) < 1440
      && plannedMinute(row.plannedEndAt, date) > 0), warnings, error: "" };
  } catch (error) { return { records: [], warnings: [], error: "単発予定の保存形式を確認してください" }; }
}

export function renderScheduleSection(state, date, escapeHTML) {
  const display = scheduleDisplay(state, date);
  if (!display.records.length && !display.warnings.length && !display.error) return "";
  return `<section class="today-single-schedules" data-schedule-date="${escapeHTML(date)}"><h3>単発予定</h3>
    ${scheduleWarning(display, escapeHTML)}${display.records.map(record => renderSchedule(record, date, escapeHTML)).join("")}</section>`;
}

export function scheduleWarning(display, escapeHTML) {
  const count = display.warnings.reduce((sum, warning) => sum + warning.count, 0);
  const text = display.error || (count ? `不正な単発予定${count}件を表示から除外しました。除外分との重なりは判定できません` : "");
  return text ? `<p role="status">${escapeHTML(text)}</p>` : "";
}

export function renderSchedule(record, date, escapeHTML, { detail = false, style = "" } = {}) {
  const { display, plan, note } = buildDailyViewModel(record, { kind: "schedule", date });
  const id = escapeHTML(record.id), key = escapeHTML(contentKey(record));
  const time = `${record.plannedStartAt} – ${record.plannedEndAt}${plan.end === 1440 ? "（24:00）" : ""}`;
  const continuation = [plan.range && plan.start < 240 ? "前から継続" : "", plan.end > 1440 ? "翌日へ継続" : ""].filter(Boolean).join(" / ");
  return `<article class="single-schedule ${style ? "timeline-card" : ""} ${plan.planCompleted ? "completed" : ""}"
    data-kind="schedule" data-schedule-id="${id}" data-completed="${plan.planCompleted}" style="${style}${plan.planCompleted ? "opacity:.55;" : ""}">
    <button type="button" data-action="schedule-view-details" data-id="${id}" data-date="${escapeHTML(date)}">${escapeHTML(display.title)}</button>
    <span>単発予定 · ${escapeHTML(time)} · ${display.statusLabel}${plan.outsideWindow ? " · 時間軸外（4〜24時）" : ""}${continuation ? ` · ${continuation}` : ""}</span>
    <button type="button" data-action="schedule-view-complete" data-id="${id}" data-date="${escapeHTML(date)}"
      data-fingerprint="${key}" data-completed="${!plan.planCompleted}" aria-label="${plan.planCompleted ? "予定完了を解除" : "予定を完了"}">${style ? (plan.planCompleted ? "↺" : "○") : plan.planCompleted ? "予定完了を解除" : "予定を完了"}</button>
    ${detail ? `<p>${escapeHTML(note)}</p>` : ""}</article>`;
}

export function scheduleTimelineRows(state, date) {
  return scheduleDisplay(state, date).records.flatMap(record => {
    const { plan } = buildDailyViewModel(record, { kind: "schedule", date });
    if (!plan.range) return [];
    const time = minute => `${date}T${String(Math.floor(minute / 60)).padStart(2,"0")}:${String(Math.floor(minute % 60)).padStart(2,"0")}`;
    // Layout-only proxies. Original timestamps stay in the source record and all labels.
    return [{ ...record, scheduleRecord: record, timelineRange: plan.range, plannedStartAt: time(plan.range[0]), plannedEndAt: time(plan.range[1]) }];
  });
}
