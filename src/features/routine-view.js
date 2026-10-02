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
  draft = Object.fromEntries(["title", "kind", "startTime", "endTime", "category"].map(key => [key, form.querySelector(`[name="${key}"]`).value]));
  draft.days = [...form.querySelectorAll('[name="day"]:checked')].map(input => Number(input.value));
}
if (typeof document !== "undefined") {
  document.addEventListener("input", event => { if (event.target.closest(".routine-form")) rememberDraft(); });
  document.addEventListener("change", event => {
    if (!event.target.closest(".routine-form")) return;
    rememberDraft();
    event.target.closest(".routine-form").querySelector(".routine-days").hidden = draft.kind !== "weekly";
  });
}
function button(action, label, id = "") {
  return `<button type="button" data-action="routine-${action}" data-rule-id="${escape(id)}">${label}</button>`;
}
function editor() {
  const field = (name, label, type = "text") => `<label>${label}<input name="${name}" type="${type}"${type === "time" ? ' step="300"' : ""} value="${escape(draft[name])}"></label>`;
  return `<div class="routine-form">${field("title", "題名")}
    <label>種類<select name="kind">${Object.entries(kinds).map(([key, label]) => `<option value="${key}"${draft.kind === key ? " selected" : ""}>${label}</option>`).join("")}</select></label>
    <fieldset class="routine-days"${draft.kind !== "weekly" ? " hidden" : ""}><legend>曜日</legend>${weekdays.map((day, i) => `<label><input type="checkbox" name="day" value="${i}"${draft.days.includes(i) ? " checked" : ""}>${day}</label>`).join("")}</fieldset>
    ${field("startTime", "開始", "time")}${field("endTime", "終了", "time")}${field("category", "カテゴリ")}
    <div class="routine-ops">${button("save", "保存", editingId)}${button("cancel", "やめる")}</div></div>`;
}
function card(rule) {
  const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const delta = rule.startTime && rule.endTime ? minutes(rule.endTime) - minutes(rule.startTime) : null;
  const estimate = delta === null ? "—" : `${delta < 0 ? delta + 1440 : delta} 分`;
  const kind = isWeekend(rule) ? "週末" : kinds[rule.kind] || rule.kind;
  return `<article class="routine-card" data-rule-id="${escape(rule.id)}"><h3>${escape(rule.title)}</h3>
    <p>${escape(kind)}${rule.kind === "weekly" && !isWeekend(rule) ? ` ${escape((rule.days || []).map(day => weekdays[day]).join("・"))}` : ""}</p>
    <p>${escape(rule.startTime || "—")}〜${escape(rule.endTime || "—")} / 見積 ${estimate}</p><p>カテゴリ: ${escape(rule.category || "—")}</p>
    <div class="routine-editor">${editingId === rule.id ? editor() : button("edit", "編集", rule.id)}</div>
    ${button("end", "このルーティンを終了", rule.id)}</article>`;
}
export function renderRoutineView() {
  const rules = activeRules().sort((a, b) => (a.startTime || "99:99").localeCompare(b.startTime || "99:99"));
  return `<section class="routine-view"><h2>ルーティン</h2>${button("new", "+ 新しいルーティン")}
    <div class="routine-new">${editingId === "" ? editor() : ""}</div>
    <div class="routine-cards">${rules.map(card).join("") || "<p>ルーティンはまだありません</p>"}</div></section>`;
}
export function startRoutineEdit(id) {
  if (editingId !== null) { deps.showToast("編集中のルーティンを保存するか、やめるを押してください"); return; }
  const rule = id ? activeRules().find(item => item.id === id) : null;
  if (id && !rule) return;
  editingId = id;
  draft = { title: rule?.title || "", kind: rule ? (isWeekend(rule) ? "weekend" : rule.kind) : "daily",
    startTime: rule?.startTime?.slice(0, 5) || "", endTime: rule?.endTime?.slice(0, 5) || "", category: rule?.category || "", days: [...(rule?.days || [])] };
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
  const title = draft.title.trim(), category = draft.category.trim(), start = draft.startTime, end = draft.endTime;
  const kind = draft.kind === "weekend" ? "weekly" : draft.kind;
  const days = draft.kind === "weekend" ? [0, 6] : draft.days;
  if (!title || (kind === "weekly" && !days.length)) { deps.showToast("題名と曜日を入力してください"); return; }
  return deps.runRecurrenceChange(() => {
    const date = deps.todayISO();
    let rule = id ? activeRules().find(item => item.id === id) : deps.createRecurrenceRule({ title, date, category, taskId: "",
      plannedStartAt: start ? `${date}T${start}` : "", plannedEndAt: end ? `${date}T${end}` : "" }, kind);
    if (!rule) return;
    // isTouchedBlock compares titles against the old rule; classify instances before changing it.
    if (id) deps.removeUntouchedInstances(id, { fromDate: date });
    Object.assign(rule, { title, kind, days: kind === "weekly" ? days : [], startTime: start, endTime: end, category, updatedAt: deps.nowDateTime() });
    deps.maintainRecurrences();
    editingId = null; draft = null;
    deps.saveAndRender("ルーティンを保存しました");
  });
}
export function endRoutine(id, confirmed) {
  if (!confirmed) {
    const target = [...document.querySelectorAll('[data-action="routine-end"]')].find(node => node.dataset.ruleId === id);
    if (target) { target.dataset.action = "routine-end-confirm"; target.textContent = "本当に終了"; }
    return;
  }
  return deps.runRecurrenceChange(() => {
    if (!deps.endRecurrenceSeries(id)) return;
    if (editingId === id) { editingId = null; draft = null; }
    deps.saveAndRender("ルーティンを終了しました");
  });
}
