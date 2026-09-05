// src/features/twelve-week.js — 12WYタブ R1a: タブ骨格+CYCLE面のVISION帯/GOALS(design.md §2.1・order-r1-cycle.md)。
// fund.js/topband.jsと同じ依存注入型feature(app.js側の未export関数はconfigureTwelveWeek(deps)で受け取る)。
import { state } from "../state/store.js";
import { activeTrackForProject, isProjectInCurrentCycle } from "../core/track.js";
import { taskWeekTriple, cycleWeeksSummary } from "../core/plan.js";
import { registerActions } from "../ui/actions.js";

let escapeHTML, renderHeader, todayISO, weekRange, renderTwyTrackReadOnly, modalHeaderHTML, renderModal, saveAndRender, closeModal, twyTrackIsDone;

function configureTwelveWeek(deps) {
  ({ escapeHTML, renderHeader, todayISO, weekRange, renderTwyTrackReadOnly, modalHeaderHTML, renderModal, saveAndRender, closeModal, twyTrackIsDone } = deps);
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

// inReview(第13週が当週)のときだけ達成トラック数を1行足す。done判定はHTML文字列マッチではなく
// twyTrackIsDone(deps注入、trackStatus()の戻り値をboolean化したもの)を使う(B-H1)。
function twyReviewNoteHTML(eligible) {
  const done = eligible.filter((project) => {
    const track = activeTrackForProject(state.tracks || [], project.id);
    return track && twyTrackIsDone(track);
  }).length;
  return `<p class="twy-goal-review">達成トラック <b>${done}</b> / ${eligible.length}</p>`;
}

// order-r1-cycle.md §B: 「今週を確定」導線は既存openTwyCommitSheet(WBS側と文言統一)。
function twyCommitLinkHTML() {
  return `<button type="button" class="btn ghost twy-commit-open" data-action="twy-open-commit">今週を確定 ›</button>`;
}

function twyGoalsPanelHTML(cycleStart, weekStart, inReview) {
  const eligible = twyGoalCandidates(cycleStart);
  const shown = eligible.slice(0, 3);
  const warn = eligible.length > 3
    ? `<p class="twy-goal-warn">3件を超えています(全${eligible.length}件中3件を表示)</p>` : "";
  const body = shown.length
    ? shown.map((project, index) => twyGoalCardHTML(project, index, weekStart)).join("")
    : `<p class="twy-goal-empty">対象の12WYプロジェクトがありません</p>`;
  return `<section class="panel tower-panel-box twy-goals-panel">
    <h2>12WY GOALS<span>${shown.length} / 最大3</span></h2>
    ${twyCommitLinkHTML()}
    <div class="twy-goal-grid">${body}</div>${warn}${inReview && eligible.length ? twyReviewNoteHTML(eligible) : ""}
  </section>`;
}

// review-r1-claude-a2.md H1: .twy-week(グリッド行=122px)は.twy-week-pct(実行率ラベル、
// styles.css .twy-week-pct = line-height 15px + margin-bottom 2px = 17px固定)と
// .twy-week-col(バー本体)をflexカラムで縦積みする。design §2.1「バー高=pct%×(グラフ高−
// 上下ラベル高)」どおり、バーの可用域はラベル高を差し引いた105px(=122-17)であって
// 行高122pxそのものではない。旧実装は122pxを基準にしていたため、pct86%以上でインライン
// heightがflex-shrinkにより105pxへ強制的に縮められ、86〜100%が同じ高さに潰れていた
// (100%バー上端が85%目標線と重なる実害)。TWY_WEEKS_BAR_HはCSS側の可用域(105px)と
// 一致させ、ラベル高が変わる場合は両ファイルを同時に直す(styles.css .twy-week-pctのコメント参照)。
const TWY_WEEKS_LABEL_H = 17;
const TWY_WEEKS_ROW_H = 122;
const TWY_WEEKS_BAR_H = TWY_WEEKS_ROW_H - TWY_WEEKS_LABEL_H;
function twyWeekBarPx(pct) {
  return Math.max(0, Math.round((Number(pct) || 0) / 100 * TWY_WEEKS_BAR_H));
}

// M1: weekStart〜weekEndの実スパンをtitle属性(ネイティブツールチップ)で見せる。非土曜開始の
// cycleStartDateでは暦週とweekNo判定(cycleWeekForDate基準)が最大6日ずれうるため、バー側にも
// 実際の日付範囲を出して利用者が確認できるようにする(plan.js側コメント参照)。
function twyWeekSpanText(week) {
  return `W${week.weekNo}(${week.weekStart}〜${week.weekEnd}` + (week.isCurrent ? "・今週" : "") + `)`;
}

function twyWeekColHTML(week) {
  const label = week.status === "scored" ? String(week.pct) : week.status === "na" ? "—" : "·";
  const barStyle = week.status === "scored" ? ` style="height:${twyWeekBarPx(week.pct)}px"` : "";
  return `<div class="twy-week" data-status="${escapeHTML(week.status)}"${week.isCurrent ? ` data-current="1"` : ""}${week.isReviewWeek ? ` data-review="1"` : ""} title="${escapeHTML(twyWeekSpanText(week))}">
    <span class="twy-week-pct">${escapeHTML(label)}</span>
    <div class="twy-week-col"${barStyle}></div>
  </div>`;
}

function twyWeekLabelHTML(week) {
  return `<span class="twy-week-lab"${week.isCurrent ? ` data-current="1"` : ""} title="${escapeHTML(twyWeekSpanText(week))}">W${week.weekNo}</span>`;
}

function twyWeeksBarHTML(summary) {
  if (!summary.weeks.length) return "";
  const cols = summary.weeks.map(twyWeekColHTML).join("");
  const labels = summary.weeks.map(twyWeekLabelHTML).join("");
  const avgText = summary.avg12 === null ? "12週平均 —" : `12週平均 <b>${summary.avg12}%</b>`;
  const refText = summary.avgWithReview !== null
    ? `参考: 振り返り週込み <b>${summary.avgWithReview}%</b>`
    : `振り返り週: 確定${summary.reviewWeek.committedCount}件(参考算入なし)`;
  return `<section class="panel tower-panel-box twy-weeks-panel"><h2>13 WEEKS</h2>
    <div class="twy-weeks-wrap">
      <div class="twy-weeks">
        <div class="twy-weeks-line" style="bottom:${twyWeekBarPx(summary.target)}px"><span>${summary.target}%</span></div>
        ${cols}
      </div>
      <div class="twy-weeks-labels">${labels}</div>
    </div>
    <div class="twy-weeks-foot"><span>${avgText}</span><span>${refText}</span><span>残 <b>${summary.remainingDays}日</b></span></div>
  </section>`;
}

function renderTwelveWeek() {
  const settings = state.settings || {};
  const cycleStart = settings.twelveWeekStartDate || "";
  const weekStart = weekRange(todayISO()).weekStart;
  const summary = cycleStart ? cycleWeeksSummary(state.weeklyCommitments || [], settings, cycleStart, todayISO()) : null;
  const inReview = Boolean(summary?.weeks[12]?.isCurrent);
  const ended = Boolean(summary?.cycleEnded); // A-M1: W13末を過ぎたら「サイクル総括(終了)」にする。
  const headline = ended ? "サイクル総括(終了)" : inReview ? "サイクル総括" : "12週間実行サイクル";
  const goalsHTML = cycleStart ? twyGoalsPanelHTML(cycleStart, weekStart, inReview)
    : `<section class="panel tower-panel-box twy-goals-panel"><h2>12WY GOALS</h2>
      <p class="twy-goal-empty">12WYサイクルが未設定です(設定 › サイクル開始日)</p></section>`;
  const weeksHTML = summary ? twyWeeksBarHTML(summary) : "";
  return `<div class="today-tower twy-tower" data-twy-face="cycle">
    ${renderHeader(headline, "12WY")}
    ${twyFaceChipsHTML()}
    <section class="panel tower-panel-box twy-vision-panel"><h2>VISION</h2>${twyVisionBandHTML(settings)}</section>
    ${goalsHTML}
    ${weeksHTML}
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
