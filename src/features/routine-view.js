import { findActiveDuplicateRecurrenceRule } from "../core/recurrence.js";
let deps, editingId = null, draft = null;
const kinds = { daily: "毎日", weekdays: "平日", weekend: "週末", weekly: "曜日", monthly: "毎月" };
const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
export function configureRoutineView(value) { deps = value; }
const activeRules = () => (deps.getState().recurrences || []).filter(rule => !rule.deleted);
const escape = value => deps.escapeHTML(String(value ?? ""));
const isWeekend = rule => rule.kind === "weekly" && rule.days?.length === 2 && rule.days.includes(0) && rule.days.includes(6);
function rememberDraft() {
  const form = document.querySelector(".routine-form");
  if (!form || editingId === null) return;
  const monthDay = form.querySelector('[name="monthDay"]')?.value ?? draft.monthDay;
  draft = Object.fromEntries(["title", "kind", "startTime", "endTime", "category"].map(key => [key, form.querySelector(`[name="${key}"]`).value]));
  draft.monthDay = monthDay;
  draft.days = [...form.querySelectorAll('[name="day"]:checked')].map(input => Number(input.value));
}
if (typeof document !== "undefined") {
  document.addEventListener("input", event => { if (event.target.closest(".routine-form")) rememberDraft(); });
  document.addEventListener("change", event => {
    if (!event.target.closest(".routine-form")) return;
    rememberDraft();
    event.target.closest(".routine-form").querySelector(".routine-days").hidden = draft.kind !== "weekly";
    event.target.closest(".routine-form").querySelector(".routine-month-day").hidden = draft.kind !== "monthly";
    if (event.target.name === "kind") event.target.closest(".routine-form").querySelector(".routine-month-day").innerHTML = monthDayInput();
  });
}
function button(action, label, id = "") {
  return `<button type="button" data-action="routine-${action}" data-rule-id="${escape(id)}">${label}</button>`;
}
function monthDayInput() {
  return draft.kind === "monthly" ? `日(1〜31)<input name="monthDay" type="number" min="1" max="31" step="1" value="${escape(draft.monthDay)}">` : "";
}
function editor() {
  const field = (name, label, type = "text") => `<label>${label}<input name="${name}" type="${type}"${type === "time" ? ' step="300"' : ""} value="${escape(draft[name])}"></label>`;
  return `<div class="routine-form">${field("title", "題名")}
    <label>種類<select name="kind">${Object.entries(kinds).map(([key, label]) => `<option value="${key}"${draft.kind === key ? " selected" : ""}>${label}</option>`).join("")}</select></label>
    <fieldset class="routine-days"${draft.kind !== "weekly" ? " hidden" : ""}><legend>曜日</legend>${weekdays.map((day, i) => `<label><input type="checkbox" name="day" value="${i}"${draft.days.includes(i) ? " checked" : ""}>${day}</label>`).join("")}</fieldset>
    <label class="routine-month-day"${draft.kind !== "monthly" ? " hidden" : ""}>${monthDayInput()}</label>
    ${field("startTime", "開始", "time")}${field("endTime", "終了", "time")}${field("category", "カテゴリ")}
    <div class="routine-ops">${button("save", "保存", editingId)}${button("cancel", "やめる")}</div></div>`;
}
function card(rule) {
  const state = deps.getState();
  const instance = state.blocks.find(block => !block.deleted && block.recurrenceGroupId === rule.id && block.date === deps.todayISO());
  const estimate = `${deps.resolveEstimateMin(instance || { ...rule, recurrenceGroupId: rule.id })} 分`;
  const kind = rule.kind === "monthly" ? `毎月 ${Number(rule.anchorDate.slice(8, 10))} 日`
    : rule.kind === "weekly" && !rule.days?.length ? "曜日未設定" : isWeekend(rule) ? "週末" : kinds[rule.kind] || rule.kind;
  const twy = state.tasks.some(task => task.id === rule.taskId && task.twyPlan);
  return `<article class="routine-card" data-rule-id="${escape(rule.id)}"><h3>${escape(rule.title)}${twy ? ' <span>12週</span>' : ""}</h3>
    <p>${escape(kind)}${rule.kind === "weekly" && !isWeekend(rule) ? ` ${escape((rule.days || []).map(day => weekdays[day]).join("・"))}` : ""}</p>
    <p>${escape(rule.startTime || "—")}〜${escape(rule.endTime || "—")} / 見積 ${estimate}</p><p>カテゴリ: ${escape(rule.category || "—")}</p>
    <div class="routine-editor">${editingId === rule.id ? editor() : button("edit", "編集", rule.id)}</div>
    ${button("end", "このルーティンを終了", rule.id)}</article>`;
}
export function renderRoutineView() {
  const rules = activeRules().sort((a, b) => (a.startTime || "99:99").localeCompare(b.startTime || "99:99"));
  return `${deps.renderHeader ? deps.renderHeader("いつものこと", "ルーティン") : ""}<section class="routine-view">${button("new", "+ 新しいルーティン")}
    <div class="routine-new">${editingId === "" ? editor() : ""}</div>
    <div class="routine-cards">${rules.map(card).join("") || "<p>ルーティンはまだありません</p>"}</div></section>`;
}
export function startRoutineEdit(id) {
  if (editingId !== null) { deps.showToast("編集中のルーティンを保存するか、やめるを押してください"); return; }
  const rule = id ? activeRules().find(item => item.id === id) : null;
  if (id && !rule) return;
  editingId = id;
  draft = { title: rule?.title || "", kind: rule ? (isWeekend(rule) ? "weekend" : rule.kind) : "daily",
    startTime: rule?.startTime?.slice(0, 5) || "", endTime: rule?.endTime?.slice(0, 5) || "", category: rule?.category || "", days: [...(rule?.days || [])],
    monthDay: Number((rule?.anchorDate || deps.todayISO()).slice(8, 10)) };
  const host = id ? [...document.querySelectorAll(".routine-card")].find(node => node.dataset.ruleId === id)?.querySelector(".routine-editor") : document.querySelector(".routine-new");
  if (host) host.innerHTML = editor();
}
export function cancelRoutineEdit() {
  editingId = null; draft = null;
  deps.render();
}
export function saveRoutine(id) {
  if (editingId !== id) return;
  rememberDraft();
  const title = draft.title.trim(), category = draft.category.trim() || "ルーティン", start = draft.startTime, end = draft.endTime;
  const kind = draft.kind === "weekend" ? "weekly" : draft.kind;
  const days = draft.kind === "weekend" ? [0, 6] : draft.days;
  if (kind === "weekly" && !days.length) { deps.showToast("曜日を 1 つ以上選んでください"); return; }
  if (!title) { deps.showToast("題名を入力してください"); return; }
  const monthDay = Number(draft.monthDay);
  if (kind === "monthly" && (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31)) {
    deps.showToast("日を 1〜31 で入力してください"); return;
  }
  const existing = id ? activeRules().find(item => item.id === id) : null;
  const unchanged = existing && title === existing.title && category === existing.category && kind === existing.kind
    && start === (existing.startTime || "").slice(0, 5) && end === (existing.endTime || "").slice(0, 5)
    && (kind !== "weekly" || [...days].sort().join() === [...(existing.days || [])].sort().join())
    && (kind !== "monthly" || monthDay === Number(existing.anchorDate.slice(8, 10)));
  if (unchanged) { cancelRoutineEdit(); return; }
  return deps.runRecurrenceChange(() => {
    if (id && findActiveDuplicateRecurrenceRule(title, start, undefined, { excludeId: id })) {
      deps.showToast(`「${title}」の繰り返しルールは既にあるため作成しませんでした`);
      return;
    }
    const date = deps.todayISO();
    let rule = id ? activeRules().find(item => item.id === id) : deps.createRecurrenceRule({ title, date, category, taskId: "",
      plannedStartAt: start ? `${date}T${start}` : "", plannedEndAt: end ? `${date}T${end}` : "" }, kind);
    if (!rule) return;
    // Compare titles and planned times against the old rule before changing it.
    if (id) deps.removeUntouchedInstances(id, { fromDate: date });
    Object.assign(rule, { title, kind, startTime: start, endTime: end, category, updatedAt: deps.nowDateTime() });
    if (kind === "monthly") {
      const [year, month] = rule.anchorDate.split("-").map(Number);
      let monthIndex = month - 1, anchor = new Date(year, monthIndex, monthDay);
      // Keep the requested day even when the anchor month is shorter (e.g. February 31).
      while (anchor.getDate() !== monthDay) anchor = new Date(year, ++monthIndex, monthDay);
      rule.anchorDate = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}-${String(monthDay).padStart(2, "0")}`;
    }
    if (kind === "weekly") rule.days = days; else delete rule.days;
    deps.maintainRecurrences();
    editingId = null; draft = null;
    deps.saveAndRender("ルーティンを保存しました");
  });
}
export function endRoutine(id, confirmed) {
  if (!confirmed) {
    const target = [...document.querySelectorAll('[data-action="routine-end"]')].find(node => node.dataset.ruleId === id);
    if (target) {
      target.dataset.action = "routine-end-confirm"; target.dataset.confirmAfter = String(Date.now() + 600);
      target.textContent = "本当に終了";
    }
    return;
  }
  const target = [...document.querySelectorAll('[data-action="routine-end-confirm"]')].find(node => node.dataset.ruleId === id);
  if (!target || !Number.isFinite(Number(target.dataset.confirmAfter)) || Date.now() < Number(target.dataset.confirmAfter)) return;
  return deps.runRecurrenceChange(() => {
    if (!deps.endRecurrenceSeries(id)) return;
    if (editingId === id) { editingId = null; draft = null; }
    deps.saveAndRender("ルーティンを終了しました");
  });
}
