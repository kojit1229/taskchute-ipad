// src/features/twelve-week.js — 12WYタブ R1a: タブ骨格+CYCLE面のVISION帯/GOALS(design.md §2.1・order-r1-cycle.md)。
// fund.js/topband.jsと同じ依存注入型feature(app.js側の未export関数はconfigureTwelveWeek(deps)で受け取る)。
import { state } from "../state/store.js";
import { activeTrackForProject, dateParts, daysBetween, dedupeById, latestMeasurement } from "../core/track.js";
import { taskWeekTriple, cycleWeeksSummary, taskPlanGrid, remainingTarget, normalizeTwyPlan, weekStartOfISO, addDaysISO } from "../core/plan.js";
import { registerActions } from "../ui/actions.js";
import { weekOutlook, weekDayStrip, todayTwyBlocks, missedTwyItems, projectWeekScore, taskDayChips } from "../core/week.js";

let escapeHTML, renderHeader, todayISO, weekRange, renderTwyTrackReadOnly, modalHeaderHTML, renderModal, saveAndRender, closeModal, twyTrackIsDone, render, candidateBlocksForWeek, nowDateTime;
let recordTrackMeasurement, saveState, openProjectEditor;
let makeBlock, isTouchedBlock, createRecurrenceRule, maintainRecurrences, createTwyTask;
const twyDayNames = ["日", "月", "火", "水", "木", "金", "土"];

function configureTwelveWeek(deps) {
  ({ makeBlock, isTouchedBlock, createRecurrenceRule, maintainRecurrences, createTwyTask } = deps);
  ({ escapeHTML, renderHeader, todayISO, weekRange, renderTwyTrackReadOnly, modalHeaderHTML, renderModal, saveAndRender, closeModal, twyTrackIsDone, render, candidateBlocksForWeek, nowDateTime } = deps);
  ({ recordTrackMeasurement, saveState, openProjectEditor } = deps);
}

function upsertWeeklyReview(weekStart, projectId, patch) {
  const id = `wr_${weekStart}_${projectId}`, now = nowDateTime();
  const reviews = state.twyWeeklyReviews || (state.twyWeeklyReviews = []);
  const index = reviews.findIndex((entry) => entry.id === id);
  const previous = reviews[index];
  const record = {
    cycleStartDate: "", aim: "", wentWell: "", obstacles: "", reviewedAt: "", deleted: false,
    ...previous, ...patch, id, weekStart, projectId,
    createdAt: previous?.createdAt || now, updatedAt: now
  };
  if (index < 0) reviews.push(record);
  else reviews[index] = record;
  return record;
}

function deleteWeeklyReview(id) {
  const record = (state.twyWeeklyReviews || []).find((entry) => entry.id === id);
  if (!record) return null;
  record.deleted = true;
  record.updatedAt = nowDateTime();
  return record;
}

// 発注53: 3つの面。旧サイクル面は「今週を決める」の折りたたみへ。
// 面切替はstateへ保存しない非永続の表示状態(design §A。_wbsSelectedProjectIdと同じ方式)。
const TWY_FACES = [
  { id: "plan", label: "今週を決める", note: "予定を確認" },
  { id: "week", label: "今日やる", note: "毎日" }, { id: "review", label: "ふりかえる", note: "土曜の朝" }
];
const TWY_ENABLED_FACES = new Set(TWY_FACES.map((face) => face.id));
let _twyActiveFace = "";
let _twyShowCycle = false;

function twyReviewFinished(weekStart) {
  const previousWeek = addDaysISO(weekStart, -7);
  return (state.twyWeeklyReviews || []).some((review) => !review.deleted && review.weekStart === previousWeek
    && String(review.reviewedAt || "").slice(0, 10) >= weekStart
    && String(review.reviewedAt || "").slice(0, 10) <= todayISO());
}

function twyDefaultFace(weekStart) {
  return todayISO() === weekStart ? (twyReviewFinished(weekStart) ? "plan" : "review") : "week";
}

function twyFaceChipsHTML(activeFace) {
  return `<div class="segmented twy-face-segmented" role="tablist" aria-label="12週計画の面切替">
    ${TWY_FACES.map((face) => `<button type="button" style="min-height:44px;min-width:0" class="${face.id === activeFace ? "active" : ""}" aria-current="${face.id === activeFace}"
        data-action="twy-face-select" data-face="${face.id}">${escapeHTML(face.label)}<small>${escapeHTML(face.note)}</small></button>`).join("")}
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
  const actText = keystone ? `${keystone.isKeystone ? "★ 重要な行動: " : ""}${escapeHTML(keystone.task.title || "")}` : "未設定";
  return `<article class="twy-goal">
    <div class="twy-goal-title"><span class="twy-goal-num">${index + 1}</span>${escapeHTML(project.title || "")}</div>
    ${track ? renderTwyTrackReadOnly(track) : `<p class="twy-goal-no-track">進捗の記録が未設定</p>`}
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
  return `<p class="twy-goal-review">達成した目標 <b>${done}</b> / ${eligible.length}</p>`;
}

// order-r1-cycle.md §B: 「今週を確定」導線は既存openTwyCommitSheet(WBS側と文言統一)。
function twyCommitLinkHTML() {
  return `<button type="button" class="btn ghost twy-commit-open" data-action="twy-open-commit">今週を確定 ›</button>`;
}

function twyGoalWarningHTML(count) {
  return count > 3 ? `<p class="twy-goal-warn">3件を超えています(全${count}件中3件を表示)</p>` : "";
}

function twyGoalsPanelHTML(cycleStart, weekStart, inReview) {
  const eligible = twyGoalCandidates(cycleStart);
  const shown = eligible.slice(0, 3);
  const warn = twyGoalWarningHTML(eligible.length);
  const body = shown.length
    ? shown.map((project, index) => twyGoalCardHTML(project, index, weekStart)).join("")
    : `<p class="twy-goal-empty">対象の12週のプロジェクトがありません</p>`;
  return `<section class="panel tower-panel-box twy-goals-panel">
    <h2>12週の目標<span>${shown.length} / 最大3</span></h2>
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
  return `${week.weekNo}週${week.isReviewWeek ? "・振り返り" : ""}(${week.weekStart}〜${week.weekEnd}` + (week.isCurrent ? "・今週" : "") + `)`;
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
  return `<span class="twy-week-lab"${week.isCurrent ? ` data-current="1"` : ""} title="${escapeHTML(twyWeekSpanText(week))}">${week.weekNo}週</span>`;
}

function twyWeeksBarHTML(summary) {
  if (!summary.weeks.length) return "";
  const cols = summary.weeks.map(twyWeekColHTML).join("");
  const labels = summary.weeks.map(twyWeekLabelHTML).join("");
  const avgText = summary.avg12 === null ? "12週平均 —" : `12週平均 <b>${summary.avg12}%</b>`;
  const refText = summary.avgWithReview !== null
    ? `参考: 振り返り週込み <b>${summary.avgWithReview}%</b>`
    : `振り返り週: 確定${summary.reviewWeek.committedCount}件(参考算入なし)`;
  return `<section class="panel tower-panel-box twy-weeks-panel"><h2>12週と振り返り週</h2>
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
    : `<section class="panel tower-panel-box twy-goals-panel"><h2>12週の目標</h2>
      <p class="twy-goal-empty">12週のサイクルが未設定です(設定 › サイクル開始日)</p></section>`;
  const weeksHTML = summary ? twyWeeksBarHTML(summary) : "";
  return `<section class="panel tower-panel-box twy-vision-panel"><h2>ビジョン</h2>${twyVisionBandHTML(settings)}</section>
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
  const face = TWY_ENABLED_FACES.has(_twyActiveFace) ? _twyActiveFace : twyDefaultFace(weekStart);
  const bodyHTML = face === "plan"
    ? `${twyDecideFaceHTML(cycleStart)}<details class="twy-cycle-fold" style="grid-column:1/-1;min-width:0" ${_twyShowCycle ? "open" : ""}>
        <summary class="btn" style="min-height:44px">12週の目標と進み具合</summary>
        ${twyCycleFaceHTML(cycleStart, weekStart, inReview, summary)}${twyPlanFaceHTML(cycleStart, summary)}</details>`
    : face === "week" ? twyWeekFaceHTML(cycleStart, weekStart) : twyReviewFaceHTML(cycleStart, weekStart);
  return `<div class="today-tower twy-tower" data-twy-face="${face}">
    ${renderHeader(headline, "12週計画")}
    ${twyFaceChipsHTML(face)}
    ${bodyHTML}
  </div>`;
}

function twyDecideWeek() {
  const today = todayISO(), week = weekStartOfISO(today);
  return today === week ? week : addDaysISO(week, 7);
}
function twyDecideDates(week) { return Array.from({ length: 7 }, (_, i) => addDaysISO(week, i)); }
function twyDecideDay(date) { return (daysBetween(weekStartOfISO(date), date) + 6) % 7; }
function twyDecideRule(task) { return (state.recurrences || []).find((r) => !r.deleted && r.taskId === task.id); }
function twyDecideDays(rule) {
  if (!rule) return [];
  if (rule.kind === "daily") return [0, 1, 2, 3, 4, 5, 6];
  if (rule.kind === "weekdays") return [1, 2, 3, 4, 5];
  return rule.kind === "weekly" ? (rule.days?.length ? rule.days : rule.anchorDate ? [twyDecideDay(rule.anchorDate)] : []) : [];
}
function twyDecideBlocks(taskId, week) {
  return (state.blocks || []).filter((b) => !b.deleted && b.taskId === taskId && b.date >= week && b.date <= addDaysISO(week, 6));
}
function twyDecideMeta(week) { return (state.weeklyCommitments || []).find((r) => !r.deleted && r.recordType === "week" && r.weekStart === week); }
function twyDecideFaceHTML(cycleStart) {
  const week = twyDecideWeek(), previous = addDaysISO(week, -7), projects = twyGoalCandidates(cycleStart);
  const tasks = projects.flatMap((p) => twyPlanTaskList(p.id)), blocks = tasks.flatMap((t) => twyDecideBlocks(t.id, week));
  const count = (t) => { const r = twyDecideRule(t); return r?.kind === "monthly" ? twyDecideDates(week).filter((d) => d.slice(8) === r.anchorDate?.slice(8)).length : r ? twyDecideDays(r).length : normalizeTwyPlan(t.twyPlan).perWeek; };
  const missing = tasks.map((t) => ({ t, n: Math.max(0, count(t) - twyDecideBlocks(t.id, week).length) })).filter(({ t, n }) => n && twyDecideRule(t)?.kind !== "monthly");
  const last = tasks.reduce((n, t) => n + twyDecideBlocks(t.id, previous).length, 0);
  const minutes = blocks.reduce((n, b) => {
    const value = (s) => { const [h, m] = String(s || "").slice(11, 16).split(":").map(Number); return h * 60 + m; };
    return n + (Math.max(0, value(b.plannedEndAt) - value(b.plannedStartAt)) || Number(b.estimateMin) || 30);
  }, 0);
  const crowded = twyDecideDates(week).filter((date) => blocks.filter((b) => b.date === date).length > 5);
  const meta = twyDecideMeta(week), ids = new Set(tasks.map((t) => t.id));
  const changed = meta?.committedAt && [...(state.blocks || []).filter((b) => ids.has(b.taskId) && b.date >= week && b.date <= addDaysISO(week, 6)), ...(state.recurrences || []).filter((r) => ids.has(r.taskId))].some((r) => r.updatedAt > meta.committedAt);
  return `<section class="twy-decide" data-decide-week="${week}"><section class="panel tower-panel-box"><h2>次の週 W${cycleStart ? Math.floor(daysBetween(cycleStart, week) / 7) + 1 : "—"} のやること</h2><p>${week}〜${addDaysISO(week, 6)}</p>
    ${projects.map((p) => {
      const score = projectWeekScore(state.weeklyCommitments || [], previous, p.id);
      const review = (state.twyWeeklyReviews || []).find((r) => !r.deleted && r.weekStart === week && r.projectId === p.id);
      return `<section data-decide-project="${escapeHTML(p.id)}"><h3>${escapeHTML(p.title)} <small>先週 できた ${score.done}/${score.total} · まだ ${score.total - score.done}</small></h3>
        <label>今週めざすこと(任意 1 行)<input class="input" data-action="twy-decide-aim" data-id="${escapeHTML(p.id)}" value="${escapeHTML(review?.aim || "")}"></label>
        ${twyPlanTaskList(p.id).map((t) => {
          const rule = twyDecideRule(t), n = count(t), m = twyDecideBlocks(t.id, week).length, k = n - m;
          const when = rule?.kind === "monthly" ? `毎月 ${Number(rule.anchorDate?.slice(8)) || "未設定"} 日 · この週は ${n} 回` : `${rule ? (twyDecideDays(rule).map((d) => twyDayNames[d]).join("・") || "毎週(曜日未設定)") + " " + escapeHTML(rule.startTime || "") : "未設定"} → 週 ${n} 回${rule ? "(ルール)" : ""}`;
          const memo = escapeHTML(String(t.memo || "").split(/\r\n|\r|\n/)[0]);
          return `<div class="twy-decide-task" data-decide-task="${escapeHTML(t.id)}"><h4>${t.twyPlan?.keystone ? "★ " : ""}${escapeHTML(t.title)} <small data-decide-memo-preview>${memo}</small></h4><p>いつ: ${when} · この週の予定 ${m} 件${rule?.kind === "monthly" ? "" : ` · ${k > 0 ? `あと ${k} 件` : k < 0 ? `${-k} 件 多い` : "✓ 足りています"}`}</p>
            <button class="btn" data-action="twy-decide-when" data-id="${escapeHTML(t.id)}">曜日・時刻を変える</button> ${k > 0 && rule?.kind !== "monthly" ? `<button class="btn" data-action="twy-decide-when" data-add-missing="true" data-id="${escapeHTML(t.id)}">予定を ${k} 件足す</button>` : ""}
            <details><summary>今回やる内容(メモ)</summary><input class="input" aria-label="今回やる内容(メモ)" data-action="twy-decide-memo" data-id="${escapeHTML(t.id)}" value="${memo}"></details></div>`;
        }).join("")}<button class="btn" data-action="twy-decide-add-task" data-id="${escapeHTML(p.id)}">+ やることを足す</button> <button class="btn ghost" data-action="nav" data-view="wbs">作業一覧で編集 ›</button></section>`;
    }).join("") || "<p>対象の12週の目標がありません</p>"}</section>
    <section class="panel tower-panel-box twy-decide-total"><h2>決める</h2><p>W${cycleStart ? Math.floor(daysBetween(cycleStart, week) / 7) + 1 : "—"} の予定: ${blocks.length} 回 · 約 ${Math.round(minutes / 6) / 10} 時間(先週 ${last} 回)</p>
    <p>まだ予定が無い分: ${missing.map(({ t, n }) => `${escapeHTML(t.title)} ${n} 件`).join(" / ") || "なし"}</p><p>${crowded.length ? `! 1 日に 5 回を超える日があります(${crowded.map((d) => twyDayNames[twyDecideDay(d)]).join("・")})` : "✓ 1 日に 5 回を超える日はありません"}</p>
    <button class="btn primary" data-action="twy-open-commit" data-week-start="${week}">確定シートで予定を確認 ›</button>${meta ? `<p>${changed ? "! 確定後に変更あり" : `✓ 確定済み(${escapeHTML(meta.committedAt || "")})`}</p>` : ""}</section></section>`;
}
function openTwyDecideTask(id) {
  const project = state.projects.find((p) => !p.deleted && p.id === id); if (!project) return;
  state.modal = { type: "twyDecideTask", id, weekStart: twyDecideWeek() };
  renderModal(`${modalHeaderHTML(`やることを足す — ${escapeHTML(project.title)}`)}<div class="twy-decide-sheet">
    <label>名前(動詞で)<input class="input" data-modal-field="title" placeholder="例: Anki 復習する"></label>
    <p>いつやる?(曜日)</p><div class="twy-decide-days">${[6, 0, 1, 2, 3, 4, 5].map((d) => `<button class="btn" data-action="twy-decide-day" data-day="${d}" aria-pressed="false">${twyDayNames[d]}</button>`).join("")}</div>
    <label>時刻<input class="input" type="time" step="300" data-modal-field="time" value="07:30"></label>
    <label class="twy-decide-key"><input type="checkbox" data-modal-field="keystone">いちばん大事(★)</label>
    <p>週 <span data-decide-count>0</span> 回</p><p data-decide-message role="status"></p>
    <button class="btn primary" data-action="twy-decide-create">足す</button> <button class="btn" data-action="modal-close">やめる</button></div></div></div>`);
  document.querySelector(".twy-decide-sheet").closest(".modal-card").classList.add("twy-decide-dialog");
}
function saveTwyDecideTask() {
  const { id, weekStart: week, type } = state.modal || {}; if (type !== "twyDecideTask") return;
  const root = document.querySelector(".twy-decide-sheet"), title = root.querySelector('[data-modal-field="title"]').value.trim();
  const days = [...root.querySelectorAll('[data-day][aria-pressed="true"]')].map((b) => Number(b.dataset.day)).sort((a, b) => a - b);
  const time = root.querySelector('[data-modal-field="time"]'), message = root.querySelector("[data-decide-message]");
  if (!title || !days.length || !time.value || !time.checkValidity()) { message.textContent = "名前・曜日・時刻を入力してください"; return; }
  const [h, m] = time.value.split(":").map(Number), end = Math.min(1439, h * 60 + m + 30);
  const kind = days.length === 7 ? "daily" : days.join() === "1,2,3,4,5" ? "weekdays" : "weekly";
  const saved = createTwyTask({ title, projectId: id, twyPerWeek: days.length, twyKeystone: root.querySelector('[data-modal-field="keystone"]').checked }, (task) => {
    const rule = createRecurrenceRule({ taskId: task.id, title, date: week, plannedStartAt: `${week}T${time.value}`,
      plannedEndAt: `${week}T${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` }, kind, { sameTaskOnly: true });
    if (!rule) return false;
    if (kind === "weekly") rule.days = days;
    maintainRecurrences({ persist: false }); return true;
  });
  if (!saved) message.textContent = "追加できませんでした。名前・時刻や保存状態を確認してください";
}
function twyDecideAdd(id) {
  const task = state.tasks.find((t) => !t.deleted && t.id === id); if (!task) return;
  const rule = twyDecideRule(task), days = twyDecideDays(rule), week = twyDecideWeek();
  if (!days.length) { openTwyDecideWhen(id); return; }
  for (const date of twyDecideDates(week)) if (days.includes(twyDecideDay(date)) && !twyDecideBlocks(id, week).some((b) => b.date === date)) {
    state.blocks.push(makeBlock({ taskId: id, title: task.title, category: task.category || "", date,
      plannedStartAt: rule.startTime ? `${date}T${rule.startTime}` : "", plannedEndAt: rule.endTime ? `${date}T${rule.endTime}` : "" }));
  }
  saveAndRender("足りない曜日に予定を追加しました");
}
function openTwyDecideWhen(id) {
  const task = state.tasks.find((t) => !t.deleted && t.id === id); if (!task) return;
  const week = twyDecideWeek(), rule = twyDecideRule(task), blocks = twyDecideBlocks(id, week);
  const days = twyDecideDays(rule);
  state.modal = { type: "twyDecideWhen", id, weekStart: week };
  renderModal(`${modalHeaderHTML(`いつやる? — ${escapeHTML(task.title)}`)}<div class="twy-decide-sheet">
    ${rule && !days.length ? "<p>これからずっとを選ぶと、選んだ曜日の毎週の繰り返しに置き換えます。</p>" : ""}
    <div class="twy-decide-days">${[6, 0, 1, 2, 3, 4, 5].map((d) => `<button class="btn" data-action="twy-decide-day" data-day="${d}" aria-pressed="${days.includes(d)}">${twyDayNames[d]}</button>`).join("")}</div>
    <label>時刻<input class="input" type="time" step="300" data-modal-field="time" value="${escapeHTML(blocks[0]?.plannedStartAt?.slice(11, 16) || rule?.startTime || "07:30")}"></label>
    <label>適用する範囲<select class="select" data-modal-field="scope"><option value="week">今週だけ</option><option value="always">これからずっと</option></select></label><p data-decide-message role="status"></p>
    <button class="btn primary" data-action="twy-decide-save">これで決める</button></div></div></div>`);
}
function saveTwyDecideWhen() {
  const { id, weekStart: week } = state.modal || {}, task = state.tasks.find((t) => !t.deleted && t.id === id); if (!task) return;
  const root = document.querySelector(".twy-decide-sheet"), days = [...root.querySelectorAll('[data-day][aria-pressed="true"]')].map((b) => Number(b.dataset.day)).sort((a, b) => a - b);
  const time = root.querySelector('[data-modal-field="time"]'), always = root.querySelector('[data-modal-field="scope"]').value === "always";
  if (!time.value || !time.checkValidity() || (always && !days.length)) { root.querySelector("[data-decide-message]").textContent = "時刻と、繰り返す場合は曜日を選んでください"; return; }
  const dates = twyDecideDates(week).filter((d) => days.includes(twyDecideDay(d))), now = nowDateTime();
  let rule = twyDecideRule(task);
  const minute = (v) => { const [h, m] = String(v || "").split(":").map(Number); return h * 60 + m; };
  const duration = Math.max(0, minute(rule?.endTime) - minute(rule?.startTime)) || 30;
  const end = Math.min(1439, minute(time.value) + duration), endTime = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  const template = (date) => ({ taskId: id, title: task.title, category: task.category || "", date, plannedStartAt: `${date}T${time.value}`, plannedEndAt: `${date}T${endTime}`, estimateMin: duration });
  const editable = (b) => {
    const r = (state.recurrences || []).find((r) => r.id === b.recurrenceGroupId);
    const normalized = (v) => String(v || "").slice(0, 16);
    return !isTouchedBlock(b) && b.title === task.title
      && (!r || (normalized(b.plannedStartAt) === normalized(r.startTime ? `${b.date}T${r.startTime}` : "") && normalized(b.plannedEndAt) === normalized(r.endTime ? `${b.date}T${r.endTime}` : "")));
  };
  if (always) {
    const kind = rule && !twyDecideDays(rule).length ? "weekly" : days.length === 7 ? "daily" : days.join() === "1,2,3,4,5" ? "weekdays" : "weekly";
    const replace = new Set((state.blocks || []).filter((b) => rule && b.date >= week && b.recurrenceGroupId === rule.id
      && (editable(b) || (b.deleted && b.source === "twy-decide-week"))));
    if (!rule) { if (!createRecurrenceRule(template(week), kind)) return; rule = twyDecideRule(task); if (!rule) return; }
    Object.assign(rule, { kind, startTime: time.value, endTime, anchorDate: week, anchor: "", updatedAt: now });
    if (kind === "weekly") rule.days = days; else delete rule.days;
    for (const b of twyDecideBlocks(id, week)) if (!b.recurrenceGroupId && editable(b)) { b.deleted = true; b.updatedAt = now; }
    for (const b of replace) {
      if (days.includes(twyDecideDay(b.date))) { Object.assign(b, template(b.date), { deleted: false, updatedAt: now }); if (b.source === "twy-decide-week") b.source = ""; }
      else Object.assign(b, { deleted: true, updatedAt: now, source: "twy-decide-week" });
    }
    maintainRecurrences({ persist: false });
  } else {
    for (const b of twyDecideBlocks(id, week)) {
      if (!editable(b)) continue;
      b.deleted = true; b.updatedAt = now; if (b.recurrenceGroupId) b.source = "twy-decide-week";
    }
    for (const date of dates) if (!twyDecideBlocks(id, week).some((b) => b.date === date)) state.blocks.push(makeBlock(template(date)));
  }
  const savedTask = state.tasks.find((t) => t.id === id);
  if (always) { savedTask.twyPlan = { ...normalizeTwyPlan(savedTask.twyPlan), perWeek: days.length }; savedTask.updatedAt = now; }
  closeModal(); saveAndRender("曜日と時刻を保存しました");
}

function twyReviewResultsHTML(cycleStart, weekStart) {
  const projects = twyGoalCandidates(cycleStart), previousWeek = addDaysISO(weekStart, -7);
  const button = (label, action, id) => `<button type="button" class="btn" style="min-height:44px;max-width:100%;white-space:normal" data-action="${action}" data-id="${escapeHTML(id)}">${label}</button>`;
  return `<section class="panel tower-panel-box twy-review-results" style="overflow-wrap:anywhere"><h2>② 結果の数字を入れる</h2>${projects.map(project => {
    const active = activeTrackForProject(state.tracks || [], project.id);
    const tracks = [active, ...(state.tracks || []).filter(t => !t.deleted && t.status === "closed"
      && t.ownerType === "project" && t.ownerId === project.id && (t.closedReason === "achieved" || twyTrackIsDone(t)))].filter(Boolean);
    return `<section data-review-project="${escapeHTML(project.id)}"><h3>${escapeHTML(project.title)}</h3>${tracks.length ? tracks.map(track => {
      const measurement = latestMeasurement(state.trackMeasurements || [], track.id), done = track.closedReason === "achieved" || twyTrackIsDone(track);
      const value = measurement?.value ?? track.baselineValue, date = String(measurement?.observedAt || track.startDate).slice(0, 10);
      const tag = track.status === "closed" || (done && date < weekStart) ? "details" : "div", heading = tag === "details" ? "summary" : "p";
      if (track.kind === "milestone") return `<${tag} data-review-track="${escapeHTML(track.id)}"><${heading} style="min-height:44px">${escapeHTML(track.name)}${done ? " · ✓ 達成" : ""}</${heading}>${renderTwyTrackReadOnly(track)}${button("編集", "twy-review-edit", project.id)}</${tag}>`;
      return `<${tag} data-review-track="${escapeHTML(track.id)}" style="padding:12px 0;border-bottom:1px solid var(--border)"><${heading} style="min-height:44px">${escapeHTML(track.name)} · いま <span data-review-current>${escapeHTML(value)}</span> / 目標 ${escapeHTML(track.goalValue)} ${escapeHTML(track.unit || "")}${tag === "details" ? ` · ✓ 達成(${escapeHTML(date)})` : ""}</${heading}>
        ${done ? `<p>✓ 達成(${escapeHTML(date)})</p>` : `<label>いまの数字<input class="input" type="number" inputmode="decimal" step="any" style="font-size:16px;width:100%;min-width:120px;box-sizing:border-box" data-review-value value="${escapeHTML(value)}"></label>
        ${button("この数字を記録", "twy-review-record", track.id)} ${button("数字は同じ", "twy-review-same", project.id)}`}
        ${button("編集", "twy-review-edit", project.id)}<p data-review-message role="status"></p></${tag}>`;
    }).join("") : "<p>まだ物差しが無い</p>"}${button("+ 結果の数字を追加・変更", "twy-review-add", project.id)}</section>`;
  }).join("")}<details class="twy-review-notes"><summary style="min-height:44px;display:flex;align-items:center">書きたい時だけ: よかったこと・困ったこと</summary>${projects.map(project => {
    const review = (state.twyWeeklyReviews || []).find(r => !r.deleted && r.weekStart === previousWeek && r.projectId === project.id);
    return `<section><h3>${escapeHTML(project.title)}</h3>${[["wentWell", "よかったこと"], ["obstacles", "困ったこと"]].map(([field, label]) => `<label>${label}<textarea class="input" style="font-size:16px;width:100%;box-sizing:border-box" data-action="twy-review-note" data-id="${escapeHTML(project.id)}" data-review-field="${field}">${escapeHTML(review?.[field] || "")}</textarea></label>`).join("")}</section>`;
  }).join("")}</details></section>`;
}

function twyReviewFaceHTML(cycleStart, weekStart) {
  const previousWeek = addDaysISO(weekStart, -7), today = todayISO(), records = state.weeklyCommitments || [];
  const score = weekOutlook(records, previousWeek, today);
  const days = weekDayStrip(records, previousWeek, today);
  const labels = new Map(days.map((day) => [day.dateISO, day.label]));
  const missed = missedTwyItems(records, previousWeek, today);
  const largest = Math.max(0, ...days.map((day) => day.missed));
  const bias = largest ? `まだの${missed.length}回のうち${days.filter((day) => day.missed === largest).map((day) => day.label + "曜").join("・")}が各${largest}回。次の週を決める材料に。`
    : "予定日を過ぎてまだの物はありません。";
  const weekNo = cycleStart ? Math.floor(daysBetween(cycleStart, previousWeek) / 7) + 1 : 0;
  const title = weekNo >= 1 && weekNo <= 12 ? `W${weekNo}` : "先週";
  return `<section data-review-week="${previousWeek}"><section class="panel tower-panel-box twy-review-score" style="overflow-wrap:anywhere">
    <h2>① ${title}を見る <small>${previousWeek}〜${addDaysISO(previousWeek, 6)}</small></h2>
    <div class="twy-week-score-big">${score.pct === null ? "—" : `${score.pct}%`}</div>
    <p>できた割合 · 予定 ${score.committed}回のうち できた ${score.done} · まだ ${score.total - score.done} · 点数に含めない ${score.excused}</p>
    ${score.status === "uncommitted" ? "<p>先週の予定は決めていませんでした</p>" : ""}
    <ul>${missed.map((item) => `<li>${labels.get(item.plannedDate) || ""} ${escapeHTML(item.title || "名前のない予定")}${twyWeekProjectTag(item.projectId)}</li>`).join("")}</ul>
    <p>${bias}</p></section>
    ${twyReviewResultsHTML(cycleStart, weekStart)}
    <section class="panel tower-panel-box twy-review-finish"><h2>③ 終える</h2>
    ${twyReviewFinished(weekStart) ? "<p>✓ ふりかえり済み</p>" : ""}
    <button type="button" class="btn primary" style="min-height:44px;max-width:100%;white-space:normal" data-action="twy-review-finish">ふりかえりを終えて『次の週を決める』へ ›</button></section></section>`;
}

// R2: PLAN面(design §2.1b・§2.0)。LINK(連動図5ノード)+12-WEEK PLANグリッド+「目安なし」一覧。
// 読み取り専用(taskPlanGrid/remainingTarget/cycleWeeksSummaryだけを使う。Block自動生成なし)。
// 各ノード下の「編集する画面」導線は既存nav/twy-open-commit/twy-face-selectを再利用する。
const TWY_PLAN_LINK_NODES = [
  { label: "12週のプロジェクト", editLabel: "作業一覧", attrs: `data-action="nav" data-view="wbs"` },
  { label: "タスク", editLabel: "作業一覧", attrs: `data-action="nav" data-view="wbs"` },
  { label: "予定・実行記録", editLabel: "タイムライン", attrs: `data-action="nav" data-view="timeline"` },
  { label: "今週の確定分", editLabel: "今週を確定", attrs: `data-action="twy-open-commit"` },
  { label: "今週の進み具合", editLabel: "サイクル", attrs: `data-action="twy-face-select" data-face="cycle"` }
];

function twyPlanLinkHTML() {
  const nodes = TWY_PLAN_LINK_NODES.map((node, index) => `<div class="twy-plan-link-node">
      <span class="twy-plan-link-label">${escapeHTML(node.label)}</span>
      <button type="button" class="twy-plan-link-edit" ${node.attrs}>編集する画面: ${escapeHTML(node.editLabel)} ›</button>
    </div>${index < TWY_PLAN_LINK_NODES.length - 1 ? `<span class="twy-plan-link-arrow" aria-hidden="true">→</span>` : ""}`).join("");
  return `<section class="panel tower-panel-box twy-plan-link-panel"><h2>計画と記録のつながり</h2>
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
    <td class="twy-plan-task-name">${plan.keystone ? "★ 重要な行動: " : ""}${escapeHTML(task.title || "")}</td>
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
  const headCols = weeks12.map((week, index) => `<th data-current="${index + 1 === currentWeekNo ? "1" : "0"}">${index + 1}週</th>`).join("");
  return `<div class="twy-plan-grid-wrap"><table class="twy-plan-grid">
    <thead><tr><th class="twy-plan-th-task">行動</th>${headCols}<th>累計/残</th></tr></thead>
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
    return `<section class="panel tower-panel-box twy-plan-link-panel"><h2>計画</h2>
      <p class="twy-plan-guide">12週のサイクルが未設定です(設定 › サイクル開始日)</p></section>`;
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
    <section class="panel tower-panel-box twy-plan-grid-panel"><h2>12週の計画</h2>
      ${projects.length ? twyPlanGridHTML(projects, weeks12, cycleStart, currentWeekNo)
      : `<p class="twy-plan-guide">対象の12週のプロジェクトがありません</p>`}
    </section>
    ${projects.length ? twyPlanNoneListHTML(projects) : ""}`;
}

// W2: stateを書き換えず、既存の確定シート・開始・作業一覧へつなぐ。
function twyWeekProjectTag(projectId) {
  const project = (state.projects || []).find((entry) => entry.id === projectId);
  return `<span class="twy-proj-tag">${escapeHTML(project?.title || "")}</span>`;
}

function twyWeekScoreHTML(weekStart, today, records, target) {
  const score = weekOutlook(records, weekStart, today, target);
  const meta = dedupeById(records).find((record) => record.recordType === "week" && record.weekStart === weekStart && !record.deleted);
  const strip = weekDayStrip(records, weekStart, today).map((day) => `<span data-today="${day.isToday ? "1" : "0"}" data-missed="${day.missed ? "1" : "0"}">
    ${day.label}${day.isToday ? ` <b class="twy-week-today">今日</b>` : ""}<small>${day.done}/${day.total}${day.excused ? ` 免${day.excused}` : ""}${day.missed ? ` 落${day.missed}` : ""}</small></span>`).join("");
  const outlook = [
    score.todayPlanned === 0 || score.pctIfTodayDone === null ? "" : `<p>今日の${score.todayPlanned}コマを終えると <b>${score.pctIfTodayDone}%</b></p>`,
    score.needTodayForTarget === null ? "" : score.needTodayForTarget === 0 ? `<p>目標 ${target}% に到達済み</p>` : `<p>目標${target}%には今日 <b>あと${score.needTodayForTarget}コマ</b> でとどく</p>`,
    score.missed === 0 || score.pctIfRecovered === null ? "" : `<p>落ちた${score.missed}コマを取り戻せば <b>${score.pctIfRecovered}%</b></p>`
  ].join("");
  const body = meta ? `<div class="twy-week-score-big" data-under="${score.pct !== null && score.pct < target ? "1" : "0"}">${score.pct === null ? "—" : `${score.pct}<small>%</small>`}</div>
    <div class="twy-week-score-meta">今週決めたコマ <b>${score.committed}</b>(免除 ${score.excused} は数えない → 点数の対象 <b>${score.total}</b>)<br>
      完了 ${score.done} · 今日の予定 ${score.todayPlanned} · 落ちた ${score.missed} · 目標 ${target}%</div>
    <div class="twy-week-strip">${strip}</div><div class="twy-week-outlook">${outlook}</div>
    <div class="twy-week-commit">確定済み ${escapeHTML(String(meta.committedAt || "").replace("T", " ").slice(0, 16))}
      <button type="button" class="btn ghost" data-action="twy-open-commit">確定シートを開く</button></div>`
    : `<div class="twy-week-commit"><span>今週はまだ確定していません · 候補 <b>${candidateBlocksForWeek(state, weekStart).length}</b>コマ</span>
      <button type="button" class="btn primary" data-action="twy-open-commit">今週を確定する</button></div>`;
  return `<section class="panel tower-panel-box twy-week-score"><h2>今週のスコア</h2>${body}
    <div class="twy-week-legend"><span data-kind="done">緑=済み</span> / <span data-kind="today">琥珀=今日</span> / <span data-kind="missed">赤枠=落ちた</span> / <span data-kind="excused">取り消し線=免除</span> / 枠だけ=予定 / ★=要となる行動</div></section>`;
}

function twyWeekTodayHTML(weekStart, today, records) {
  const items = todayTwyBlocks(records, state.blocks || [], weekStart, today);
  const rows = items.map((item) => `<div class="twy-week-today-row"><time>${escapeHTML(item.time || "—")}</time>
    <span class="twy-week-item-title">${escapeHTML(item.title)}${twyWeekProjectTag(item.projectId)}</span>
    <span>${item.estimateMin === null ? "—" : `${escapeHTML(String(item.estimateMin))}分`}</span>
    ${item.done ? `<span class="twy-week-done">済</span>` : `<button type="button" class="btn ghost" data-action="now-start" data-id="${escapeHTML(item.blockId)}">▶開始</button>`}</div>`).join("");
  const minutes = items.reduce((sum, item) => sum + (Number(item.estimateMin) || 0), 0);
  return `<section class="panel tower-panel-box twy-week-today"><h2>今日のコマ</h2>
    <div class="twy-today-list">${rows || `<p>今日の12週のコマはありません</p>`}</div>
    <div class="twy-week-sum">合計 ${items.length}コマ · ${minutes}分 · 完了 ${items.filter((item) => item.done).length}</div></section>`;
}

function twyWeekMissedHTML(weekStart, today, records) {
  const items = missedTwyItems(records, weekStart, today);
  if (!items.length) return "";
  const labels = new Map(weekDayStrip(records, weekStart, today).map((day) => [day.dateISO, day.label]));
  return `<section class="panel tower-panel-box twy-week-missed"><h2>落ちたコマ</h2>${items.map((item) => `<div class="twy-week-missed-row">
    <span class="twy-week-item-title">${escapeHTML(item.title || "")}${twyWeekProjectTag(item.projectId)}</span>
    <span>${escapeHTML(labels.get(item.plannedDate) || "")} ${escapeHTML(item.plannedDate.slice(5).replace("-", "/"))} · 未実施</span>
    <button type="button" class="btn ghost" data-action="twy-open-commit">確定シートで免除にする</button>
    <button type="button" class="btn ghost" data-action="nav" data-view="wbs">作業一覧で予定を足す</button></div>`).join("")}</section>`;
}

function twyWeekThemeCardHTML(project, index, weekStart, today, records) {
  const score = projectWeekScore(records, weekStart, project.id);
  const track = activeTrackForProject(state.tracks || [], project.id);
  const tasks = twyPlanTaskList(project.id).map((task) => {
    const plan = normalizeTwyPlan(task.twyPlan), triple = taskWeekTriple(records, task.id, weekStart);
    const committed = triple.confirmed + triple.excused;
    if (!plan.perWeek && !committed) return "";
    const short = Math.max(0, plan.perWeek - committed);
    const chips = taskDayChips(records, state.blocks || [], weekStart, task.id, today)
      .map((chip) => `<span class="twy-day-chip" data-state="${chip.state}">${escapeHTML(chip.label)}<small>${escapeHTML(chip.time)}</small></span>`).join("");
    return `<div class="twy-week-task" data-task-id="${escapeHTML(task.id)}">
      <div>${plan.keystone ? "★ " : ""}${escapeHTML(task.title || "")}</div>
      <div>目安 ${plan.perWeek} · 今週決めた ${committed} · 完了 ${triple.done}${short ? ` <span class="twy-week-short">(${short} コマ不足)</span>` : ""}</div>
      <div class="twy-week-days">${chips}</div></div>`;
  }).join("");
  return `<article class="panel tower-panel-box twy-week-theme">
    <header class="twy-week-theme-head"><span class="twy-goal-num">${index + 1}</span><h2>${escapeHTML(project.title || "")}</h2>
      <span class="twy-week-theme-score">${score.pct === null ? "—" : `${score.pct}%`} (${score.done}/${score.total})</span>
      <span class="twy-proj-tag">${track ? "成果あり" : "成果の指標なし"}</span></header>
    <div class="twy-week-cols"><div><h3>やること</h3>${tasks || `<p>今週のやることはありません</p>`}</div>
      <div><h3>成果</h3>${track ? renderTwyTrackReadOnly(track) : `<p class="twy-goal-no-track">成果の指標なし</p>`}</div></div></article>`;
}

function twyWeekThemesHTML(cycleStart, weekStart, today, records) {
  const projects = twyGoalCandidates(cycleStart);
  if (!projects.length) return `<section class="panel tower-panel-box"><p class="twy-goal-empty">対象の12週のプロジェクトがありません</p></section>`;
  return projects.slice(0, 3).map((project, index) => twyWeekThemeCardHTML(project, index, weekStart, today, records)).join("")
    + twyGoalWarningHTML(projects.length);
}

function twyWeekFaceHTML(cycleStart, weekStart) {
  if (!cycleStart) return `<section class="panel tower-panel-box"><p>12週のサイクルが未設定です(設定 › サイクル開始日)</p></section>`;
  const records = state.weeklyCommitments || [], today = todayISO();
  const rawTarget = Number(state.settings?.twelveWeekScoreTarget), target = Number.isFinite(rawTarget) ? rawTarget : 85;
  return `${twyWeekScoreHTML(weekStart, today, records, target)}${twyWeekTodayHTML(weekStart, today, records)}${twyWeekMissedHTML(weekStart, today, records)}${twyWeekThemesHTML(cycleStart, weekStart, today, records)}`;
}

function buildTwyVisionModalHTML(settings) {
  return `${modalHeaderHTML("ビジョン")}
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
  "twy-decide-memo": ({ event, id, target }) => {
    if (event.type !== "change") return;
    const task = state.tasks.find((t) => !t.deleted && t.id === id); if (!task) return;
    const memo = String(task.memo || ""), boundary = memo.search(/\r\n|\r|\n/);
    task.memo = target.value + (boundary < 0 ? "" : memo.slice(boundary)); task.updatedAt = nowDateTime(); saveState();
    target.closest("[data-decide-task]").querySelector("[data-decide-memo-preview]").textContent = target.value;
  },
  "twy-decide-add-task": ({ id }) => openTwyDecideTask(id),
  "twy-decide-create": () => saveTwyDecideTask(),
  "twy-decide-aim": ({ event, id, target }) => {
    if (event.type !== "change") return;
    upsertWeeklyReview(target.closest("[data-decide-week]").dataset.decideWeek, id, { aim: target.value }); saveState();
  },
  "twy-decide-when": ({ id, target }) => target.dataset.addMissing ? twyDecideAdd(id) : openTwyDecideWhen(id),
  "twy-decide-day": ({ target }) => {
    target.setAttribute("aria-pressed", String(target.getAttribute("aria-pressed") !== "true"));
    const root = target.closest(".twy-decide-sheet"), count = root.querySelector("[data-decide-count]");
    if (count) count.textContent = root.querySelectorAll('[data-day][aria-pressed="true"]').length;
  },
  "twy-decide-save": () => saveTwyDecideWhen(),
  "twy-review-record": ({ id, target }) => {
    const row = target.closest("[data-review-track]"), input = row.querySelector("[data-review-value]");
    if (!input.value.trim() || !input.checkValidity()) { row.querySelector("[data-review-message]").textContent = "数字を入れてください"; return; }
    const result = recordTrackMeasurement(id, Number(input.value), { sourceKind: "twy-review" });
    if (!result.ok) { row.querySelector("[data-review-message]").textContent = result.errors.join(" / "); return; }
    row.querySelector("[data-review-current]").textContent = String(result.measurement.value);
    row.querySelector("[data-review-message]").textContent = `記録しました(${String(result.measurement.observedAt).slice(0, 10)})`;
  },
  "twy-review-same": ({ id, target }) => {
    upsertWeeklyReview(target.closest("[data-review-week]").dataset.reviewWeek, id, { reviewedAt: nowDateTime() });
    saveState(); target.closest("[data-review-track]").querySelector("[data-review-message]").textContent = "数字は同じ · 確認しました";
  },
  "twy-review-note": ({ event, id, target }) => {
    if (event.type !== "change" || !["wentWell", "obstacles"].includes(target.dataset.reviewField)) return;
    upsertWeeklyReview(target.closest("[data-review-week]").dataset.reviewWeek, id, { [target.dataset.reviewField]: target.value }); saveState();
  },
  "twy-review-edit": ({ id }) => openProjectEditor(id),
  "twy-review-add": ({ id }) => openProjectEditor(id),
  "twy-review-finish": ({ target }) => {
    const previousWeek = target.closest("[data-review-week]").dataset.reviewWeek;
    const rawStart = state.settings?.twelveWeekStartDate || "";
    const cycleStart = rawStart ? weekRange(rawStart).weekStart : "";
    const projects = twyGoalCandidates(cycleStart);
    for (const projectId of projects.length ? projects.map((project) => project.id) : [""]) {
      upsertWeeklyReview(previousWeek, projectId, { reviewedAt: nowDateTime(), cycleStartDate: cycleStart, deleted: false });
    }
    _twyActiveFace = "plan";
    _twyShowCycle = false;
    saveAndRender("ふりかえりを終えました");
  },
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
    saveAndRender("ビジョンを保存しました");
  },
  // 旧PLAN内のサイクル導線も折りたたみへつなぐ。面切替は非永続。
  "twy-face-select": ({ target }) => {
    const face = target.dataset.face === "cycle" ? "plan" : target.dataset.face;
    if (!TWY_ENABLED_FACES.has(face)) return;
    _twyShowCycle = target.dataset.face === "cycle";
    _twyActiveFace = face;
    render();
  }
});

export { configureTwelveWeek, renderTwelveWeek, upsertWeeklyReview, deleteWeeklyReview };
