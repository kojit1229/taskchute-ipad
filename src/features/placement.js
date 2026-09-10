import { state } from "../state/store.js";
import { registerActions, registerModalHandler } from "../ui/actions.js";
import { existingPlacement, placementTimes, placementCandidate, buildTodayPlacement } from "../core/placement.js";
import { commitCandidate } from "../core/commit.js";
import { dailyFingerprint } from "./daily-operations.js";
import { updateWorkLists } from "./work-list.js";

let api;
let origin;
let draft;
let placing = false;
const pendingRequests = new Map();
const requestKey = request => "taskchute-journal-placement-v1:" + JSON.stringify([request.connection, request.block.taskId]);
const placementConnection = () => JSON.stringify([state.settings?.github?.dataOwner || "", state.settings?.github?.dataRepo || ""]);
function keepRequest(request) {
  pendingRequests.set(requestKey(request), request);
  try { sessionStorage.setItem(requestKey(request), JSON.stringify(request)); } catch { /* In-memory retry remains available. */ }
}
// Synchronous adapter: failure restores exact references before any timer can run.
export function commitPlacement(model, candidate, deps) {
  if (candidate.request) {
    try {
      return commitCandidate({ state: model, input: candidate, now: deps.now || deps.stamp, floors: deps.floors,
        build: (before, input) => buildTodayPlacement(before, input, dailyFingerprint),
        persist: deps.persist, effects: result => { if (!result.unchanged) deps.schedule?.(result); }
      }).ok;
    } catch (error) {
      if (error.code !== "PLACEMENT_INVALID") throw error;
      candidate.error = error.message; return false;
    }
  }
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
    "placement-add-today": ({ id }) => openTaskPlacement(id),
    "placement-add-another": ({ id }) => openTaskPlacement(id, "wbs", { separate: true }),
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

export function openTaskPlacement(taskId, source = "wbs", { separate = false } = {}) {
  // Background keyboard/click activation must not replace an active editor or placement.
  if (state.modal) return;
  const task = state.tasks.find(t => !t.deleted && t.id === taskId);
  if (!task) return api.showToast("元のタスクが見つかりません");
  origin = { view: state.currentView, date: state.selectedDate, wishOpenId: state.wishOpenId,
    taskId, source, scroll: window.scrollY, focusAction: document.activeElement?.dataset.action,
    scrollAreas: ["#app", "#main", '[data-work-list="wbs"] [data-work-list-rows]'].map(selector => [selector, document.querySelector(selector)?.scrollTop || 0]) };
  draft = { taskId, source, date: api.todayISO(), time: "", duration: Number(task.estimateMin) > 0 ? Number(task.estimateMin) : 30 };
  const existing = existingPlacement(state.blocks, taskId, draft.date);
  if (existing && !separate) return showPlaced(existing, true);
  if (source === "wbs") {
    if (task.status === "completed") return api.showToast("元のタスクは完了済みです。予定追加を中止しました。");
    const connection = placementConnection();
    const key = requestKey({ connection, block: { taskId } });
    const operation = separate ? "add-another-today" : "add-today";
    let request = pendingRequests.get(key);
    if (!request) try { request = JSON.parse(sessionStorage.getItem(key)); } catch { /* Use the in-memory request. */ }
    const saved = request?.block && state.blocks.find(block => block.id === request.block.id && !block.deleted);
    if (!request?.requestId || request.block?.taskId !== taskId || request.connection !== connection
        || (request.status !== "saved" && (request.baseFingerprint !== dailyFingerprint(task) || request.block.date !== draft.date))
        || request.operation !== operation || (request.status === "saved" && (separate || (saved && saved.date !== draft.date)))) {
      const block = api.makeBlock({ taskId, date: draft.date, title: task.title,
        category: task.category || api.projectName(task.projectId), estimateMin: task.estimateMin ?? null,
        plannedStartAt: "", plannedEndAt: "", actualStartAt: "", actualEndAt: "", completed: false });
      request = { requestId: block.id, operation, connection, block,
        baseFingerprint: dailyFingerprint(task), status: "pending" };
    }
    draft.request = request; draft.date = request.block.date;
    keepRequest(request);
  }
  state.modal = { type: "placement", id: taskId };
  renderPlacement(task);
}

function renderPlacement(task, error = "") {
  const h = api.escapeHTML;
  if (draft.request) {
    api.renderModal(`${api.modalHeaderHTML("今日の予定を追加", "tower-sheet")}
      <section class="tower-section placement-form"><h4>${h(task.title)}</h4>
      ${draft.request.operation === "add-another-today" ? "<p>同じTaskの別の予定を追加します。既存の予定は変更しません。</p>" : ""}
      <p>配置日：今日 <strong>${h(draft.date)}</strong></p><p>開始・終了は時刻なしで追加します。閲覧中の日付は変えません。</p>
      <p id="placement-error" role="alert">${h(error)}</p></section></div>
      <div class="modal-footer"><button class="btn" data-action="modal-close">取消</button>
      <button class="btn primary" data-action="modal-save">今日へ追加を確定</button></div></div>`);
    return;
  }
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
  if (state.modal?.type === "block" && state.modal.id === origin?.blockId && target.dataset.modalField === "plannedStartAt") {
    const block = state.blocks.find(row => row.id === state.modal.id && !row.deleted);
    const end = document.querySelector('#modalRoot [data-modal-field="plannedEndAt"]');
    const start = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::00)?$/.exec(target.value);
    // Untimed placements need an end in the legacy editor; keep this in the unsaved inputs only.
    if (block && !block.plannedEndAt && end && !end.value && start) {
      const estimate = Number(document.querySelector('#modalRoot [data-modal-field="estimateMin"]')?.value);
      const times = placementTimes(start[1], start[2], estimate > 0 ? estimate : 30);
      if (times) end.value = times.plannedEndAt;
    }
    return;
  }
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
  if (draft.request) return confirmTodayPlacement();
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

function confirmTodayPlacement() {
  if (placing) return false;
  const request = draft.request, today = api.todayISO();
  // The global day rollover can run while the confirmation is open.
  state.selectedDate = origin.date;
  if (request.block.date !== today) {
    request.block = { ...request.block, date: today }; draft.date = today;
    keepRequest(request);
    document.getElementById("placement-error").textContent = `日付が変わりました。追加先は今日 ${today} です。確認してもう一度確定してください。`;
    const date = document.querySelector(".placement-form strong");
    if (date) date.textContent = today;
    return false;
  }
  placing = true;
  const button = document.querySelector('.modal-footer [data-action="modal-save"]');
  if (button) button.disabled = true;
  try {
    const candidate = { request, today: api.todayISO(), connection: placementConnection() };
    if (!api.commit(candidate)) {
      document.getElementById("placement-error").textContent = candidate.error || "端末への保存に失敗しました。入力は保持しています。同じ要求で再試行してください。";
      return false;
    }
    request.status = "saved"; keepRequest(request);
    api.closeModal();
    state.selectedDate = origin.date;
    updateWorkLists();
    const focus = [...document.querySelectorAll('button[data-action][data-id]')]
      .find(button => button.dataset.action === origin.focusAction && button.dataset.id === origin.taskId);
    focus?.focus({ preventScroll: true });
    for (const [selector, top] of origin.scrollAreas) {
      const area = document.querySelector(selector);
      if (area) area.scrollTop = top;
    }
    window.scrollTo(0, origin.scroll);
    api.showToast("今日の予定に時刻なしで追加しました。");
    return true;
  } finally { placing = false; if (button) button.disabled = false; }
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
