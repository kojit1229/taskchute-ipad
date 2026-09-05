// src/features/twelve-week.js — 12WYタブ R1a: タブ骨格+CYCLE面のVISION帯/GOALS(design.md §2.1・order-r1-cycle.md)。
// fund.js/topband.jsと同じ依存注入型feature(app.js側の未export関数はconfigureTwelveWeek(deps)で受け取る)。
import { state } from "../state/store.js";
import { activeTrackForProject, isProjectInCurrentCycle } from "../core/track.js";
import { taskWeekTriple } from "../core/plan.js";
import { registerActions } from "../ui/actions.js";

let escapeHTML, renderHeader, todayISO, weekRange, renderTwyTrackReadOnly, modalHeaderHTML, renderModal, saveAndRender, closeModal;

function configureTwelveWeek(deps) {
  ({ escapeHTML, renderHeader, todayISO, weekRange, renderTwyTrackReadOnly, modalHeaderHTML, renderModal, saveAndRender, closeModal } = deps);
}

// 上部チップ(CYCLE|PLAN|WEEK|REVIEW)。R1aはCYCLEのみ有効・面切替は非永続(design §A)。
const TWY_FACES = [
  { id: "cycle", label: "CYCLE", note: "俯瞰" }, { id: "plan", label: "PLAN", note: "準備中" },
  { id: "week", label: "WEEK", note: "準備中" }, { id: "review", label: "REVIEW", note: "準備中" }
];

function twyFaceChipsHTML() {
  return `<div class="segmented twy-face-segmented" role="tablist" aria-label="12WY面切替">
    ${TWY_FACES.map((face) => face.id === "cycle"
    ? `<button type="button" class="active" aria-current="true">${escapeHTML(face.label)}<small>${escapeHTML(face.note)}</small></button>`
    : `<button type="button" disabled title="準備中">${escapeHTML(face.label)}<small>${escapeHTML(face.note)}</small></button>`).join("")}
  </div>`;
}

function twyVisionBandHTML(settings) {
  const vision = String(settings.twelveWeekVision || "").trim();
  const focus = String(settings.twelveWeekFocus || "").trim();
  const empty = `<span class="twy-vision-empty">未設定</span>`;
  const body = (vision || focus)
    ? `<div class="twy-vision-row"><small>3年ビジョン</small><p>${vision ? escapeHTML(vision) : empty}</p></div>
       <div class="twy-vision-row"><small>今サイクルの焦点</small><p>${focus ? escapeHTML(focus) : empty}</p></div>`
    : `<p class="twy-vision-guide">タップしてビジョンと今サイクルの焦点を書く</p>`;
  return `<button type="button" class="twy-vision-band" data-action="twy-vision-open">${body}</button>`;
}

// GOALS候補: project.twelveWeekStartDateが現サイクル内・active・normalなProjectのみ(design §2.1)。
function twyGoalCandidates(cycleStart) {
  return (state.projects || []).filter((project) => !project.deleted && project.kind === "normal"
    && project.status === "active" && isProjectInCurrentCycle(project, cycleStart))
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
      || String(a.id || "").localeCompare(String(b.id || "")));
}

// ★Keystone(task.twyPlan.keystone、R0)優先。無ければ最初のtodo/doingタスク。
function twyKeystoneTask(projectId) {
  const tasks = (state.tasks || []).filter((task) => !task.deleted && task.projectId === projectId);
  const keystone = tasks.find((task) => task.twyPlan?.keystone);
  if (keystone) return { task: keystone, isKeystone: true };
  const active = tasks.find((task) => task.status === "todo" || task.status === "doing");
  return active ? { task: active, isKeystone: false } : null;
}

// 今週コマ数 = プロジェクト配下タスクのtaskWeekTriple(plan.js、R0)のconfirmed合計。
function twyWeeklyBlockCount(projectId, weekStart) {
  const taskIds = (state.tasks || []).filter((task) => !task.deleted && task.projectId === projectId).map((task) => task.id);
  return taskIds.reduce((sum, taskId) =>
    sum + taskWeekTriple(state.weeklyCommitments || [], taskId, weekStart).confirmed, 0);
}

function twyGoalCardHTML(project, index, weekStart) {
  const track = activeTrackForProject(state.tracks || [], project.id);
  const keystone = twyKeystoneTask(project.id);
  const count = twyWeeklyBlockCount(project.id, weekStart);
  const actText = keystone ? `${keystone.isKeystone ? "★ " : ""}${escapeHTML(keystone.task.title || "")}` : "未設定";
  return `<article class="twy-goal">
    <div class="twy-goal-title"><span class="twy-goal-num">${index + 1}</span>${escapeHTML(project.title || "")}</div>
    ${track ? renderTwyTrackReadOnly(track) : `<p class="twy-goal-no-track">トラック未設定</p>`}
    <div class="twy-goal-foot"><span class="twy-goal-act">行動: ${actText}</span><span class="twy-goal-count">今週 <b>${count}</b>コマ</span></div>
  </article>`;
}

function twyGoalsPanelHTML(cycleStart, weekStart) {
  const eligible = twyGoalCandidates(cycleStart);
  const shown = eligible.slice(0, 3);
  const warn = eligible.length > 3
    ? `<p class="twy-goal-warn">3件を超えています(全${eligible.length}件中3件を表示)</p>` : "";
  const body = shown.length
    ? shown.map((project, index) => twyGoalCardHTML(project, index, weekStart)).join("")
    : `<p class="twy-goal-empty">対象の12WYプロジェクトがありません</p>`;
  return `<section class="panel tower-panel-box twy-goals-panel">
    <h2>12WY GOALS<span>${shown.length} / 最大3</span></h2>
    <div class="twy-goal-grid">${body}</div>${warn}
  </section>`;
}

function renderTwelveWeek() {
  const settings = state.settings || {};
  const cycleStart = settings.twelveWeekStartDate || "";
  const weekStart = weekRange(todayISO()).weekStart;
  const goalsHTML = cycleStart ? twyGoalsPanelHTML(cycleStart, weekStart)
    : `<section class="panel tower-panel-box twy-goals-panel"><h2>12WY GOALS</h2>
      <p class="twy-goal-empty">12WYサイクルが未設定です(設定 › サイクル開始日)</p></section>`;
  return `<div class="today-tower twy-tower" data-twy-face="cycle">
    ${renderHeader("12週間実行サイクル", "12WY")}
    ${twyFaceChipsHTML()}
    <section class="panel tower-panel-box twy-vision-panel"><h2>VISION</h2>${twyVisionBandHTML(settings)}</section>
    ${goalsHTML}
  </div>`;
}

function buildTwyVisionModalHTML(settings) {
  return `${modalHeaderHTML("VISION")}
    <div class="field"><label class="field-label">3年ビジョン</label>
      <input class="input" style="font-size:16px" data-twy-vision-field="twelveWeekVision"
        value="${escapeHTML(settings.twelveWeekVision || "")}" placeholder="3年後にどうなっていたいか"></div>
    <div class="field" style="margin-top:10px"><label class="field-label">今サイクルの焦点</label>
      <input class="input" style="font-size:16px" data-twy-vision-field="twelveWeekFocus"
        value="${escapeHTML(settings.twelveWeekFocus || "")}" placeholder="今期はこれに寄せる"></div>
  </div>
  <div class="modal-footer">
    <button class="btn" data-action="modal-close">キャンセル</button>
    <button class="btn primary" data-action="twy-vision-save">保存</button>
  </div>
</div>`;
}

registerActions({
  "twy-vision-open": () => {
    state.modal = { type: "twyVision", id: "" };
    renderModal(buildTwyVisionModalHTML(state.settings));
  },
  "twy-vision-save": () => {
    const vision = document.querySelector('[data-twy-vision-field="twelveWeekVision"]')?.value ?? "";
    const focus = document.querySelector('[data-twy-vision-field="twelveWeekFocus"]')?.value ?? "";
    state.settings.twelveWeekVision = vision;
    state.settings.twelveWeekFocus = focus;
    closeModal();
    saveAndRender("VISIONを保存しました");
  }
});

export { configureTwelveWeek, renderTwelveWeek };
