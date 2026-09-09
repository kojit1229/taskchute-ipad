import { state } from "../state/store.js";
import { registerActions, registerModalHandler } from "../ui/actions.js";
import { existingPlacement, placementTimes, placementCandidate } from "../core/placement.js";
import { commitCandidate } from "../core/commit.js";

let api;
let origin;
let draft;
// Synchronous adapter: failure restores exact references before any timer can run.
export function commitPlacement(model, candidate, deps) {
  return commitCandidate({ state: model, now: deps.now || deps.stamp, floors: deps.floors,
    build: before => ({ records: ["blocks", "tasks"].flatMap(kind =>
      candidate[kind].filter(after => !model[kind].includes(after)).map(after =>
        ({ kind, before: before[kind].find(item => item.id === after.id), after }))) }),
    persist: deps.persist, effects: result => { if (!result.unchanged) deps.schedule?.(result); }
  }).ok;
}
export function configurePlacement(deps) {
  if (typeof deps.requestLeave !== "function") throw new TypeError("placement requires requestLeave adapter");
  api = deps;
  registerModalHandler("placement", { save: (_id, fields) => confirmPlacement(fields) });
  registerActions({
    "placement-edit": ({ id }) => api.openBlockEditor(id),
    "placement-return": () => {
      if (!origin) return;
      const destination = { ...origin, scrollAreas: origin.scrollAreas.map(row => [...row]) };
      const owner = { type: state.modal?.type, id: state.modal?.id };
      let resumed = false;
      const leave = () => {
        if (resumed) return;
        resumed = true;
        if (state.modal && (state.modal.type !== owner.type || state.modal.id !== owner.id)) return;
        api.closeModal();
        if (state.modal) return;
        state.selectedDate = destination.date;
        state.wishOpenId = destination.wishOpenId;
        api.setView(destination.view);
        const action = destination.source === "wish" ? "wish-subtask-to-tasks" : "task-today";
        const button = [...document.querySelectorAll(`[data-action="${action}"]`)].find(el => el.dataset.id === destination.taskId);
        button?.focus({ preventScroll: true });
        for (const [selector, top] of destination.scrollAreas) {
          const area = document.querySelector(selector);
          if (area) area.scrollTop = top;
        }
        window.scrollTo(0, destination.scroll);
      };
      if (!api.requestLeave(leave)) leave();
    }
  });
}

export function placementBackHTML(block) {
  if (!origin || block.id !== origin.blockId || block.taskId !== origin.taskId) return "";
  return `<button class="btn" data-action="placement-return">元の${origin.source === "wish" ? "Wish" : "Task"}へ戻る</button>`;
}

export function openTaskPlacement(taskId, source = "wbs") {
  // Background keyboard/click activation must not replace an active editor or placement.
  if (state.modal) return;
  const task = state.tasks.find(t => !t.deleted && t.id === taskId);
  if (!task) return api.showToast("元のタスクが見つかりません");
  origin = { view: state.currentView, date: state.selectedDate, wishOpenId: state.wishOpenId,
    taskId, source, scroll: window.scrollY,
    scrollAreas: ["#app", "#main", '[data-work-list="wbs"] [data-work-list-rows]'].map(selector => [selector, document.querySelector(selector)?.scrollTop || 0]) };
  draft = { taskId, source, date: api.todayISO(), time: "", duration: Number(task.estimateMin) > 0 ? Number(task.estimateMin) : 30 };
  const existing = existingPlacement(state.blocks, taskId, draft.date);
  if (existing) return showPlaced(existing, true);
  state.modal = { type: "placement", id: taskId };
  renderPlacement(task);
}

function renderPlacement(task, error = "") {
  const h = api.escapeHTML;
  api.renderModal(`${api.modalHeaderHTML("今日の予定を追加", "tower-sheet")}
    <section class="tower-section placement-form">
      <h4>${h(task.title)}</h4><p>配置日：今日 <strong>${h(draft.date)}</strong></p>
      <p>閲覧中の日付に関係なく、今日の予定へ追加します。</p>
      <div class="field"><label class="field-label" for="placement-duration">所要時間（分）${Number(task.estimateMin) > 0 ? "" : "・未設定のため仮に30分"}</label>
      <input id="placement-duration" class="input" style="font-size:16px" type="number" min="1" step="1" data-modal-field="duration" value="${draft.duration}"></div>
      <div class="field"><label class="field-label" for="placement-time">開始時刻（必須）</label>
      <input id="placement-time" class="input" style="font-size:16px" type="time" step="300" required data-modal-field="time" value="${h(draft.time)}"></div>
      <p id="placement-end" aria-live="polite">開始時刻を選択してください。</p>
      <p id="placement-error" role="alert">${h(error)}</p>
    </section></div><div class="modal-footer"><button class="btn" data-action="modal-close">取消</button>
    <button class="btn primary" data-action="modal-save">この時刻で確定</button></div></div>`);
}

export function placementInput(target) {
  if (state.modal?.type !== "placement" || !["time", "duration"].includes(target.dataset.modalField)) return;
  draft[target.dataset.modalField] = target.value;
  const times = placementTimes(draft.date, draft.time, draft.duration);
  const end = document.getElementById("placement-end");
  if (end) end.textContent = times ? `終了予定：${times.plannedEndAt.replace("T", " ")}${times.plannedEndAt.slice(0, 10) !== draft.date ? "（翌日以降）" : ""}` : "開始時刻と所要時間を確認してください。";
}

// Guard save keeps navigation with the captured leave continuation.
export function savePlacementDraft(fields) {
  return confirmPlacement(fields, { leaving: true });
}
function confirmPlacement(fields, { leaving = false } = {}) {
  if (state.modal?.type !== "placement" || !draft) return false;
  Object.assign(draft, { time: fields.time, duration: fields.duration });
  const today = api.todayISO();
  const result = placementCandidate(state, draft, { today, stamp: api.nowDateTime(), makeBlock: api.makeBlock, projectName: api.projectName });
  if (result.error) {
    if (draft.date !== today) {
      draft.date = today; draft.time = "";
      const task = state.tasks.find(t => !t.deleted && t.id === draft.taskId);
      if (task) { renderPlacement(task, result.error); return false; }
    }
    document.getElementById("placement-error").textContent = result.error;
    return false;
  }
  if (result.existing) {
    if (leaving) { api.closeModal(); return true; }
    showPlaced(result.existing, true); return true;
  }
  if (!api.commit(result)) {
    document.getElementById("placement-error").textContent = "端末への保存に失敗しました。入力は保持しています。容量などを確認して再試行してください。";
    return false;
  }
  if (leaving) { api.closeModal(); return true; }
  showPlaced(result.block, false);
  return true;
}

function showPlaced(block, existing) {
  const h = api.escapeHTML;
  origin.blockId = block.id;
  api.closeModal();
  state.selectedDate = block.date;
  api.setView(draft.source === "wish" ? "exec" : "today");
  state.modal = { type: "placementResult", id: block.id };
  api.renderModal(`${api.modalHeaderHTML(existing ? "今日の予定を開きました" : "今日の予定に追加しました", "tower-sheet")}
    <section class="tower-section"><h4>${h(block.title)}</h4><p>今日 ${h(block.date)}</p>
    <p>開始：${h((block.plannedStartAt || "未設定").replace("T", " "))}<br>終了：${h((block.plannedEndAt || "未設定").replace("T", " "))}</p>
    <p>${existing ? "既存の予定を表示しています。重複追加はしていません。" : "選択した時刻を保存しました。"}</p></section>
    </div><div class="modal-footer"><button class="btn" data-action="placement-return">元の${draft.source === "wish" ? "Wish" : "Task"}へ戻る</button>
    <button class="btn primary" data-action="placement-edit" data-id="${h(block.id)}">予定の時刻を編集</button></div></div>`);
}
