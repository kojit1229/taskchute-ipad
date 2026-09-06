// src/features/twelve-week.js — 12WYタブ R1a: タブ骨格+CYCLE面のVISION帯/GOALS(design.md §2.1・order-r1-cycle.md)。
// fund.js/topband.jsと同じ依存注入型feature(app.js側の未export関数はconfigureTwelveWeek(deps)で受け取る)。
import { state } from "../state/store.js";
import { activeTrackForProject, dateParts, daysBetween } from "../core/track.js";
import { taskWeekTriple, cycleWeeksSummary, taskPlanGrid, remainingTarget, normalizeTwyPlan, weekStartOfISO } from "../core/plan.js";
import { registerActions } from "../ui/actions.js";

let escapeHTML, renderHeader, todayISO, weekRange, renderTwyTrackReadOnly, modalHeaderHTML, renderModal, saveAndRender, closeModal, twyTrackIsDone, render;

function configureTwelveWeek(deps) {
  ({ escapeHTML, renderHeader, todayISO, weekRange, renderTwyTrackReadOnly, modalHeaderHTML, renderModal, saveAndRender, closeModal, twyTrackIsDone, render } = deps);
}

// 上部チップ(CYCLE|PLAN|WEEK|REVIEW)。R2でPLANを有効化(design §2.1b)。WEEK/REVIEWは準備中のまま。
// 面切替はstateへ保存しない非永続の表示状態(design §A。_wbsSelectedProjectIdと同じ方式)。
const TWY_FACES = [
  { id: "cycle", label: "CYCLE", note: "俯瞰" }, { id: "plan", label: "PLAN", note: "計画" },
  { id: "week", label: "WEEK", note: "準備中" }, { id: "review", label: "REVIEW", note: "準備中" }
];
const TWY_ENABLED_FACES = new Set(["cycle", "plan"]);
let _twyActiveFace = "cycle";

function twyFaceChipsHTML(activeFace) {
  return `<div class="segmented twy-face-segmented" role="tablist" aria-label="12WY面切替">
    ${TWY_FACES.map((face) => TWY_ENABLED_FACES.has(face.id)
    ? `<button type="button" class="${face.id === activeFace ? "active" : ""}" aria-current="${face.id === activeFace}"
        data-action="twy-face-select" data-face="${face.id}">${escapeHTML(face.label)}<small>${escapeHTML(face.note)}</small></button>`
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

// R2 fix3 M2: 両側を土曜へ丸め、W1〜W12(0..83日)だけを包含する。
// track.jsのraw基準の既存呼び出し元は変えず、12WYタブの表示専用に扱う。
function isProjectInRoundedCycle(project, cycleStart) {
  if (!dateParts(cycleStart) || !dateParts(project?.twelveWeekStartDate)) return false;
  const offset = daysBetween(weekStartOfISO(cycleStart), weekStartOfISO(project.twelveWeekStartDate));
  return offset >= 0 && offset <= 83;
}

// GOALS候補: project.twelveWeekStartDateが現サイクル内・active・normalなProjectのみ(design §2.1)。
function twyGoalCandidates(cycleStart) {
  return (state.projects || []).filter((project) => !project.deleted && project.kind === "normal"
    && project.status === "active" && isProjectInRoundedCycle(project, cycleStart))
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

function twyCycleFaceHTML(cycleStart, weekStart, inReview, summary) {
  const settings = state.settings || {};
  const goalsHTML = cycleStart ? twyGoalsPanelHTML(cycleStart, weekStart, inReview)
    : `<section class="panel tower-panel-box twy-goals-panel"><h2>12WY GOALS</h2>
      <p class="twy-goal-empty">12WYサイクルが未設定です(設定 › サイクル開始日)</p></section>`;
  const weeksHTML = summary ? twyWeeksBarHTML(summary) : "";
  return `<section class="panel tower-panel-box twy-vision-panel"><h2>VISION</h2>${twyVisionBandHTML(settings)}</section>
    ${goalsHTML}
    ${weeksHTML}`;
}

function renderTwelveWeek() {
  const settings = state.settings || {};
  const cycleStartRaw = settings.twelveWeekStartDate || "";
  // K裁定2026-09-05: 表示側で直前の土曜へ丸めた値だけをCYCLE/PLAN両面の計算へ渡す(保存値は
  // 書き換えずupdatedAtも進めない=review-r1-claude-a3.md M1の2基準併存を解消)。
  const cycleStart = cycleStartRaw ? weekRange(cycleStartRaw).weekStart : "";
  const weekStart = weekRange(todayISO()).weekStart;
  const summary = cycleStart ? cycleWeeksSummary(state.weeklyCommitments || [], settings, cycleStart, todayISO()) : null;
  const inReview = Boolean(summary?.weeks[12]?.isCurrent);
  const ended = Boolean(summary?.cycleEnded); // A-M1: W13末を過ぎたら「サイクル総括(終了)」にする。
  const headline = ended ? "サイクル総括(終了)" : inReview ? "サイクル総括" : "12週間実行サイクル";
  const face = TWY_ENABLED_FACES.has(_twyActiveFace) ? _twyActiveFace : "cycle";
  const bodyHTML = face === "plan"
    ? twyPlanFaceHTML(cycleStart, summary)
    : twyCycleFaceHTML(cycleStart, weekStart, inReview, summary);
  return `<div class="today-tower twy-tower" data-twy-face="${face}">
    ${renderHeader(headline, "12WY")}
    ${twyFaceChipsHTML(face)}
    ${bodyHTML}
  </div>`;
}

// R2: PLAN面(design §2.1b・§2.0)。LINK(連動図5ノード)+12-WEEK PLANグリッド+「目安なし」一覧。
// 読み取り専用(taskPlanGrid/remainingTarget/cycleWeeksSummaryだけを使う。Block自動生成なし)。
// 各ノード下の「編集する画面」導線は既存nav/twy-open-commit/twy-face-selectを再利用する。
const TWY_PLAN_LINK_NODES = [
  { label: "12WYプロジェクト", editLabel: "WBS", attrs: `data-action="nav" data-view="wbs"` },
  { label: "WBSタスク(戦術)", editLabel: "WBS", attrs: `data-action="nav" data-view="wbs"` },
  { label: "Block(コマ)", editLabel: "タイムライン", attrs: `data-action="nav" data-view="timeline"` },
  { label: "週次コミット", editLabel: "今週を確定", attrs: `data-action="twy-open-commit"` },
  { label: "weeklyScore", editLabel: "CYCLE", attrs: `data-action="twy-face-select" data-face="cycle"` }
];

function twyPlanLinkHTML() {
  const nodes = TWY_PLAN_LINK_NODES.map((node, index) => `<div class="twy-plan-link-node">
      <span class="twy-plan-link-label">${escapeHTML(node.label)}</span>
      <button type="button" class="twy-plan-link-edit" ${node.attrs}>編集する画面: ${escapeHTML(node.editLabel)} ›</button>
    </div>${index < TWY_PLAN_LINK_NODES.length - 1 ? `<span class="twy-plan-link-arrow" aria-hidden="true">→</span>` : ""}`).join("");
  return `<section class="panel tower-panel-box twy-plan-link-panel"><h2>LINK</h2>
    <div class="twy-plan-link-row">${nodes}</div>
  </section>`;
}

// PLANグリッドの行対象: 12WYプロジェクト配下・todo/doingのTask(Wishは12WY候補自体に含まれない)。
function twyPlanTaskList(projectId) {
  return (state.tasks || []).filter((task) => !task.deleted && task.projectId === projectId
    && (task.status === "todo" || task.status === "doing"));
}

// セルの表示文言(design §2.1b): 過去/今週=k/m、future planned=n、short/unplanned=n(確定m)、
// unplannedかつ単発(fromWeek===toWeek)=「未作成」、none=空。
function twyPlanCellText(row, plan) {
  if (row.status === "planned") return String(row.target);
  // review-r2-claude-a L2: 「未作成」のみだと必要コマ数が読めなくなるためtargetを併記する。
  if (row.status === "unplanned" && plan.fromWeek === plan.toWeek) return `${row.target} (未作成)`;
  if (row.status === "short" || row.status === "unplanned") return `${row.target}(確定${row.confirmed})`;
  if (row.status === "none") return "";
  return `${row.done}/${row.confirmed}`; // met / missed-1-2 / missed-3+ / current
}

function twyPlanCellHTML(row, plan) {
  const uncreated = row.status === "unplanned" && plan.fromWeek === plan.toWeek;
  return `<td class="twy-plan-cell" data-status="${escapeHTML(row.status)}"${uncreated ? ` data-uncreated="1"` : ""}>${escapeHTML(twyPlanCellText(row, plan))}</td>`;
}

function twyPlanTaskRowHTML(task, weekStarts, cycleStart, currentWeekNo) {
  const plan = normalizeTwyPlan(task.twyPlan);
  const rows = taskPlanGrid([task], state.weeklyCommitments || [], cycleStart, weekStarts, currentWeekNo);
  // review-r2-claude-a M1: 右端の累計はmockupどおり過去週+当週のみを分母にする(未来週で
  // 「来週分を確定」した分まで足すと、来週分を前倒しで確定している利用者ほど分母だけ膨らみ
  // 達成率が実態より悪く見える)。remainingTargetは従来どおり未来週(currentWeekNo+1〜12)の
  // 目安合計のまま変えない。
  const current = Number(currentWeekNo);
  const countedRows = Number.isFinite(current) ? rows.filter((row) => row.weekNo <= current) : [];
  const totalConfirmed = countedRows.reduce((sum, row) => sum + row.confirmed, 0);
  const totalDone = countedRows.reduce((sum, row) => sum + row.done, 0);
  const remaining = remainingTarget(task, currentWeekNo);
  return `<tr class="twy-plan-task-row" data-task-id="${escapeHTML(task.id)}">
    <td class="twy-plan-task-name">${plan.keystone ? "★ " : ""}${escapeHTML(task.title || "")}</td>
    ${rows.map((row) => twyPlanCellHTML(row, plan)).join("")}
    <td class="twy-plan-total"><span class="twy-plan-total-km">${totalDone}/${totalConfirmed}</span><span class="twy-plan-remaining">残${remaining}</span></td>
  </tr>`;
}

function twyPlanGridHTML(projects, weeks12, cycleStart, currentWeekNo) {
  const weekStarts = weeks12.map((week) => week.weekStart);
  const colCount = weeks12.length + 2;
  const bodyRows = projects.map((project) => {
    const tasks = twyPlanTaskList(project.id).filter((task) => normalizeTwyPlan(task.twyPlan).perWeek > 0);
    if (!tasks.length) return "";
    return `<tr class="twy-plan-project-row"><td class="twy-plan-project-head" colspan="${colCount}">${escapeHTML(project.title || "")}</td></tr>
      ${tasks.map((task) => twyPlanTaskRowHTML(task, weekStarts, cycleStart, currentWeekNo)).join("")}`;
  }).join("");
  const headCols = weeks12.map((week, index) => `<th data-current="${index + 1 === currentWeekNo ? "1" : "0"}">W${index + 1}</th>`).join("");
  return `<div class="twy-plan-grid-wrap"><table class="twy-plan-grid">
    <thead><tr><th class="twy-plan-th-task">戦術</th>${headCols}<th>累計/残</th></tr></thead>
    <tbody>${bodyRows || `<tr><td class="twy-plan-guide" colspan="${colCount}">目安を設定したタスクがありません</td></tr>`}</tbody>
  </table></div>`;
}

// 最下段「目安なし」: perWeek===0のTaskは既存どおり採点対象のまま、目安入力への導線だけ出す
// (Task編集モーダルは既存openTaskEditor=edit-taskをそのまま再利用。新規data-actionは追加しない)。
function twyPlanNoneListHTML(projects) {
  const items = projects.flatMap((project) => twyPlanTaskList(project.id)
    .filter((task) => normalizeTwyPlan(task.twyPlan).perWeek === 0));
  return `<section class="panel tower-panel-box twy-plan-none-panel"><h2>目安なし</h2>
    ${items.length ? `<ul class="twy-plan-none-list">${items.map((task) => `<li><span>${escapeHTML(task.title || "")}</span>
        <button type="button" class="btn ghost" data-action="edit-task" data-id="${escapeHTML(task.id)}">目安を設定 ›</button></li>`).join("")}</ul>`
      : `<p class="twy-plan-none-empty">目安未設定のタスクはありません</p>`}
  </section>`;
}

function twyPlanFaceHTML(cycleStart, summary) {
  if (!cycleStart) {
    return `<section class="panel tower-panel-box twy-plan-link-panel"><h2>PLAN</h2>
      <p class="twy-plan-guide">12WYサイクルが未設定です(設定 › サイクル開始日)</p></section>`;
  }
  const weeks12 = (summary?.weeks || []).slice(0, 12);
  const currentIdx = weeks12.findIndex((week) => week.isCurrent);
  // review-r2-claude-a H1: W13(振り返り週)が当週の間はweeks[12].isCurrentがtrueになるが、
  // weeks12は先頭12件しか持たないためcurrentIdx=-1のまま(cycleEndedもまだfalse)になり、
  // currentWeekNoがundefined=W1〜W12が全部「未来」表示になっていた。weeks[12].isCurrentも
  // 見て13を渡し、W1〜W12を過去週として評価させる(サイクル終了後の全週過去扱いは従来どおり
  // cycleEndedでカバー)。
  const inReviewWeek = Boolean(summary?.weeks?.[12]?.isCurrent);
  // 開始前は当週なし。全12週を未来として残数に含め、累計から除外する。
  const currentWeekNo = currentIdx >= 0 ? currentIdx + 1 : ((inReviewWeek || summary?.cycleEnded) ? 13 : 0);
  const projects = twyGoalCandidates(cycleStart);
  return `${twyPlanLinkHTML()}
    <section class="panel tower-panel-box twy-plan-grid-panel"><h2>12-WEEK PLAN</h2>
      ${projects.length ? twyPlanGridHTML(projects, weeks12, cycleStart, currentWeekNo)
      : `<p class="twy-plan-guide">対象の12WYプロジェクトがありません</p>`}
    </section>
    ${projects.length ? twyPlanNoneListHTML(projects) : ""}`;
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
  },
  // R2: 面切替(CYCLE/PLAN)。design §A「面切替は非永続」どおりstateへ保存せずrender()のみ。
  "twy-face-select": ({ target }) => {
    const face = target.dataset.face;
    if (!TWY_ENABLED_FACES.has(face) || face === _twyActiveFace) return;
    _twyActiveFace = face;
    render();
  }
});

export { configureTwelveWeek, renderTwelveWeek };
