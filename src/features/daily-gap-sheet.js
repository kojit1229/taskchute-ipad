import { plannedMinute } from "../core/planned-occupancy.js";
import { contentKey } from "../core/single-schedule-merge.js";
import { gapWarning } from "./daily-gap-placement.js";

export function createDailyGapSheet(deps) {
  const blocked = () => {
    let input = deps.isComposing() ? document.activeElement : null;
    for (const row of document.querySelectorAll('[data-daily-key^="block:"]')) {
      const block = deps.state().blocks.find(item => item.id === row.dataset.dailyKey.slice(6));
      const start = row.querySelector('[data-daily-field="start"]'), end = row.querySelector('[data-daily-field="end"]');
      const next = row.querySelector('[data-daily-field="endNextDay"]');
      if (block && start && end && (start.value !== (block.plannedStartAt || "").slice(11,16)
          || end.value !== (block.plannedEndAt || "").slice(11,16)
          || Boolean(next?.checked) !== Boolean(block.plannedEndAt && block.plannedEndAt.slice(0,10) > block.date))) input = start;
    }
    if (deps.state().modal?.basis === "planned") input ||= [...document.querySelectorAll('#fillGapLength, #fillGapProject')].find(field => field.value);
    if (!input) return false;
    input.focus(); deps.notify("入力を保存または取消してから、計画の空きを選んでください"); return true;
  };
  const open = (start, end, date) => {
    const show = () => {
      if (blocked()) return;
      const availability = deps.availability(date), from = plannedMinute(`${date}T${start}`, date), to = plannedMinute(`${date}T${end}`, date);
      if (date !== deps.state().selectedDate || availability.error || to - from < 15
          || !availability.gaps.some(([s,e]) => s <= from && to <= e)) {
        deps.notify(availability.error || "配置できる空き時間がありません。選び直してください"); return;
      }
      const fingerprints = {};
      for (const [kind, rows] of [["block", deps.state().blocks], ["task", deps.state().tasks]])
        for (const row of rows) if (row?.id) fingerprints[`${kind}:${row.id}`] = contentKey(row);
      deps.show({ type: "fillGap", basis: "planned", date, start, end, gapRequestId: crypto.randomUUID(), fingerprints });
    };
    if (!deps.requestLeave(show)) show();
  };
  const choose = () => {
    const show = () => {
      if (blocked()) return;
      const date = deps.state().selectedDate, availability = deps.availability(date), escape = deps.escapeHTML;
      const time = minute => `${String(Math.floor(minute / 60)).padStart(2,"0")}:${String(minute % 60).padStart(2,"0")}`;
      deps.showPicker(deps.modalHeaderHTML("計画の空き", "planned-gap-picker")
        + `<p role="status">${escape(availability.error || gapWarning(availability.warnings))}</p>`
        + (availability.error ? "" : availability.gaps.filter(([s,e]) => e - s >= 15).map(([s,e]) => `<button type="button" class="btn" data-action="fill-gap-open" data-basis="planned" data-date="${escape(date)}" data-start="${time(s)}" data-end="${time(e)}">${time(s)} – ${time(e)}</button>`).join("") || "配置できる空き時間がありません") + "</div></div>");
    };
    if (!deps.requestLeave(show)) show();
  };
  const build = modal => {
    const escape = deps.escapeHTML, state = deps.state(), availability = deps.availability(modal.date);
    const length = plannedMinute(`${modal.date}T${modal.end}`, modal.date) - plannedMinute(`${modal.date}T${modal.start}`, modal.date);
    const blocks = state.blocks.filter(row => !row.deleted && row.date === modal.date && !row.plannedStartAt
      && !row.plannedEndAt && !row.completed && !row.migratedTo && !row.actualStartAt && !row.actualEndAt);
    const tasks = state.tasks.filter(row => !row.deleted && row.kind !== "other" && ["todo","doing"].includes(row.status));
    const tooLong = row => row.estimateMin > length;
    const label = row => `${row.title} · ${row.estimateMin >= 15 ? `見積${row.estimateMin}分` : "配置する長さを入力"}${tooLong(row) ? " · 時間不足" : ""}`;
    return deps.modalHeaderHTML(`計画の空きへ配置 ${escape(modal.start)} – ${escape(modal.end)} · ${length}分`, "fill-gap-sheet")
      + `<p role="status">${escape(availability.error || gapWarning(availability.warnings))}</p>
      <div class="fill-gap-list"><h3>今日の時刻未定Block</h3>${blocks.map(row => `<div class="item fill-gap-row"><span>${escape(label(row))}</span>
        <button type="button" class="btn" data-action="fill-gap-place" data-kind="block" data-id="${escape(row.id)}" ${availability.error || tooLong(row) ? "disabled" : ""}>ここに置く</button></div>`).join("") || "未定Blockはありません"}</div>
      <div class="fill-gap-new"><label>見積なし・15分未満の配置長さ（分）<input class="input" id="fillGapLength" type="number" min="15" step="5" data-modal-field="duration" style="font-size:16px" value=""></label>
      <h3>未完了Taskから新しいBlockを作る</h3><select class="select" id="fillGapProject" style="font-size:16px"><option value="">Taskを選ぶ</option>${tasks.map(row => `<option value="${escape(row.id)}" ${tooLong(row) ? "disabled" : ""}>${escape(label(row))}</option>`).join("")}</select>
      <button type="button" class="btn primary" data-action="fill-gap-create" ${availability.error ? "disabled" : ""}>新Blockを作る</button></div>
      <p>短縮・分割はしません。確定前に選んだ区間全体を確認します。</p></div></div>`;
  };
  const place = (kind, id, target) => {
    const modal = deps.state().modal;
    if (modal?.basis !== "planned" || target?.disabled || deps.isComposing()) return;
    if (target) target.disabled = true;
    const input = { kind, id, date: modal.date, start: modal.start, end: modal.end, basis: "planned",
      requestId: `${modal.gapRequestId}:${kind}:${id}`, baseFingerprint: modal.fingerprints[`${kind}:${id}`],
      duration: document.querySelector('#fillGapLength')?.value };
    const result = deps.run(kind === "block" ? "daily-gap-place" : "daily-gap-create", input);
    if (!result.ok) { if (target) target.disabled = false; deps.notify(result.error?.message || "保存できません。入力を残しています"); return; }
    deps.done(); deps.notify(`${gapWarning(result.warnings)}${modal.start} に配置・この端末で保存・同期待ち`);
  };
  return { open, build, place, choose };
}
