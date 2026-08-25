// src/features/track-ui.js — 12WY進捗トースト(専用要素・render()非依存)。
import { activeTrackForProject, isProjectInCurrentCycle, latestMeasurement } from "../core/track.js";
import { state } from "../state/store.js";
import { registerActions } from "../ui/actions.js";

let escapeHTML, todayISO, saveAndRender, generateReport, recordTrackMeasurement;
let trackToastEl = null;
let trackToastTimer = null;

function configureTrackUi(deps) {
  ({ escapeHTML, todayISO, saveAndRender, generateReport, recordTrackMeasurement } = deps);
  trackToastEl = document.querySelector("#trackToast");
}

function resolveTrackToastTarget(block) {
  if (!block?.taskId) return null;
  const task = (state.tasks || []).find((entry) => entry.id === block.taskId && !entry.deleted);
  if (!task) return null;
  const project = (state.projects || []).find((entry) => entry.id === task.projectId && !entry.deleted);
  if (!project?.twelveWeekStartDate || project.status !== "active") return null;
  if (!isProjectInCurrentCycle(project, state.settings?.twelveWeekStartDate || "")) return null;
  const track = activeTrackForProject(state.tracks || [], project.id);
  if (!track || track.kind !== "numeric") return null;
  return { block, track };
}

function decimalPlaces(value) {
  const [coefficient, exponent = "0"] = String(value).toLowerCase().split("e");
  return Math.max(0, Math.min(100,
    (coefficient.split(".")[1] || "").length - Number(exponent)));
}

function nextStepValue(latest, step, direction) {
  const amount = Number(latest), size = Number(step);
  if (!Number.isFinite(amount) || !Number.isFinite(size) || !(size > 0)) return "";
  const next = amount + direction * size;
  if (!Number.isFinite(next)) return "";
  return next.toFixed(Math.max(decimalPlaces(latest), decimalPlaces(step)));
}

function latestTrackValue(track) {
  const value = latestMeasurement(state.trackMeasurements || [], track.id)?.value ?? track.baselineValue;
  return Number(value);
}

function trackToastHTML({ block, track }) {
  const latest = latestTrackValue(track);
  const direction = Math.sign(Number(track.goalValue) - Number(track.baselineValue)) || 1;
  const nextValue = nextStepValue(latest, track.valueStep, direction);
  const progressButton = nextValue === "" ? "" : `
    <button type="button" class="primary" data-action="twy-toast-inc"
      data-twy-toast-track-id="${escapeHTML(track.id)}" data-twy-toast-block-id="${escapeHTML(block.id)}"
      data-twy-toast-next-value="${nextValue}">${nextValue}${escapeHTML(track.unit)}まで進んだ</button>`;
  return `<span class="twy-toast-label">TRACK</span>
    <span class="twy-toast-cur">${escapeHTML(track.name)} — 現在 <b>${latest}${escapeHTML(track.unit)}</b></span>${progressButton}
    <button type="button" class="ghost" data-action="twy-toast-same"
      data-twy-toast-track-id="${escapeHTML(track.id)}" data-twy-toast-block-id="${escapeHTML(block.id)}"
      data-twy-toast-same-value="${latest}">変化なし</button>
    <button type="button" class="ghost" data-action="twy-toast-other"
      data-twy-toast-track-id="${escapeHTML(track.id)}" data-twy-toast-block-id="${escapeHTML(block.id)}">その他…</button>
    <button type="button" class="twy-toast-close" data-action="twy-toast-later" aria-label="閉じる">✕</button>`;
}

function trackToastOtherHTML({ block, track }) {
  return `<span class="twy-toast-label">TRACK</span>
    <input type="number" inputmode="decimal" class="input" step="${escapeHTML(track.valueStep)}"
      value="${latestTrackValue(track)}" data-twy-toast-other-input>
    <span class="unit">${escapeHTML(track.unit)}</span>
    <button type="button" class="primary" data-action="twy-toast-other-confirm"
      data-twy-toast-track-id="${escapeHTML(track.id)}" data-twy-toast-block-id="${escapeHTML(block.id)}">記録</button>
    <button type="button" class="twy-toast-close" data-action="twy-toast-later" aria-label="閉じる">✕</button>`;
}

function hideTrackToast() {
  clearTimeout(trackToastTimer);
  trackToastTimer = null;
  if (!trackToastEl) return;
  trackToastEl.hidden = true;
  trackToastEl.innerHTML = "";
}

function showTrackToast(target) {
  if (!trackToastEl) return false;
  clearTimeout(trackToastTimer);
  trackToastEl.innerHTML = trackToastHTML(target);
  trackToastEl.hidden = false;
  trackToastTimer = setTimeout(hideTrackToast, 8000);
  return true;
}

function expandTrackToastOtherInput(target) {
  const track = (state.tracks || []).find((entry) => entry.id === target.dataset.twyToastTrackId
    && entry.status === "active" && entry.kind === "numeric" && !entry.deleted);
  if (!trackToastEl || !track) return;
  clearTimeout(trackToastTimer);
  trackToastTimer = null;
  trackToastEl.innerHTML = trackToastOtherHTML({ block: { id: target.dataset.twyToastBlockId }, track });
}

function commitTrackToastMeasurement(target, value) {
  const result = recordTrackMeasurement(target.dataset.twyToastTrackId, value, {
    sourceKind: "toast", blockId: target.dataset.twyToastBlockId
  });
  if (!result.ok) return;
  generateReport(todayISO(), { quiet: true });
  hideTrackToast();
  saveAndRender("記録しました");
}

registerActions({
  "twy-toast-inc": ({ target }) => {
    const raw = target.dataset.twyToastNextValue;
    if (raw === "" || !Number.isFinite(Number(raw))) return;
    commitTrackToastMeasurement(target, Number(raw));
  },
  "twy-toast-same": ({ target }) =>
    commitTrackToastMeasurement(target, Number(target.dataset.twyToastSameValue)),
  "twy-toast-other": ({ target }) => expandTrackToastOtherInput(target),
  "twy-toast-other-confirm": ({ target }) => {
    const input = trackToastEl?.querySelector("[data-twy-toast-other-input]");
    const raw = input?.value ?? "";
    if (raw === "" || !Number.isFinite(Number(raw))) {
      input?.classList.add("is-error");
      return;
    }
    commitTrackToastMeasurement(target, Number(raw));
  },
  "twy-toast-later": () => hideTrackToast()
});

function maybeShowTrackProgressToast(block) {
  const target = resolveTrackToastTarget(block);
  if (!target) return;
  const toastLog = (state._trackToastLog ||= {});
  const today = todayISO();
  if (toastLog[target.track.id] === today) return;
  if (trackToastEl?.querySelector("[data-twy-toast-other-input]")) return;
  if (showTrackToast(target)) toastLog[target.track.id] = today;
}

export { configureTrackUi, maybeShowTrackProgressToast };
