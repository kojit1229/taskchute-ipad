// src/features/twelve-week.js — 12WYタブ R1a: タブ骨格+CYCLE面のVISION帯/GOALS(design.md §2.1・order-r1-cycle.md)。
// fund.js/topband.jsと同じ依存注入型feature(app.js側の未export関数はconfigureTwelveWeek(deps)で受け取る)。
import { state } from "../state/store.js";
import { activeTrackForProject, dateParts, daysBetween, latestMeasurement } from "../core/track.js";
import { taskWeekTriple, cycleWeeksSummary, taskPlanGrid, remainingTarget, normalizeTwyPlan, weekStartOfISO, addDaysISO } from "../core/plan.js";
import { registerActions } from "../ui/actions.js";
import { weekOutlook, weekDayStrip, missedTwyItems, projectWeekScore } from "../core/week.js";
import { weekCounts, ringRatio } from "../core/twy-stack.js";

let escapeHTML, renderHeader, todayISO, weekRange, renderTwyTrackReadOnly, modalHeaderHTML, renderModal, saveAndRender, closeModal, twyTrackIsDone, nowDateTime;
let recordTrackMeasurement, saveState, openProjectEditor;
let makeBlock, isTouchedBlock, createRecurrenceRule, maintainRecurrences, createTwyTask, runRecurrenceChange, endRoutine;
const twyDayNames = ["日", "月", "火", "水", "木", "金", "土"];

function configureTwelveWeek(deps) {
  ({ makeBlock, isTouchedBlock, createRecurrenceRule, maintainRecurrences, createTwyTask, runRecurrenceChange, endRoutine } = deps);
  ({ escapeHTML, renderHeader, todayISO, weekRange, renderTwyTrackReadOnly, modalHeaderHTML, renderModal, saveAndRender, closeModal, twyTrackIsDone, nowDateTime } = deps);
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

function twyReviewFinished(weekStart) {
  const previousWeek = addDaysISO(weekStart, -7);
  return (state.twyWeeklyReviews || []).some((review) => !review.deleted && review.weekStart === previousWeek
    && String(review.reviewedAt || "").slice(0, 10) >= weekStart
    && String(review.reviewedAt || "").slice(0, 10) <= todayISO());
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
  const reviewOpen = typeof document !== "undefined" && document.querySelector(".twy-review-fold")?.open;
  const cycleOpen = typeof document !== "undefined" && document.querySelector(".twy-cycle-fold")?.open;
  const unrecorded = !twyReviewFinished(weekStart) && todayISO() >= addDaysISO(weekStart, -1);
  return `<div class="today-tower twy-tower">
    ${renderHeader(headline, "12週計画")}
    ${twyDecideFaceHTML(cycleStart)}${twyDoneHTML(cycleStart)}${twyStackHTML()}
    <details class="twy-review-fold" ${reviewOpen ? "open" : ""}><summary><h2>ふりかえる${unrecorded ? " <small>(未記録)</small>" : ""}</h2></summary>
      ${twyReviewFaceHTML(cycleStart, weekStart)}</details>
    <details class="twy-cycle-fold" ${cycleOpen ? "open" : ""}><summary class="btn"><h2>12週の目標と進み具合</h2></summary>
      ${twyCycleFaceHTML(cycleStart, weekStart, inReview, summary)}${twyPlanFaceHTML(cycleStart, summary)}</details>
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
function twyDecideTasks(projectId) {
  return twyPlanTaskList(projectId).map((task, index) => ({ task, order: Number.isFinite(task.order) ? task.order : index }))
    .sort((a, b) => a.order - b.order).map(({ task }) => task);
}
function twyDecideEstimate(task) {
  const rule = twyDecideRule(task), minutes = value => { const [h, m] = String(value || "").split(":").map(Number); return h * 60 + m; };
  return Number(task.estimateMin) || ((minutes(rule?.endTime) - minutes(rule?.startTime) + 1440) % 1440) || 25;
}
function twyDecideEnd(start, estimate) {
  const [h, m] = start.split(":").map(Number), end = (h * 60 + m + estimate) % 1440;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}
function twyDecideFaceHTML(cycleStart) {
  const week = twyDecideWeek(), previous = addDaysISO(week, -7), projects = twyGoalCandidates(cycleStart);
  const tasks = projects.flatMap((p) => twyDecideTasks(p.id)), blocks = tasks.flatMap((t) => twyDecideBlocks(t.id, week));
  const count = (t) => { const r = twyDecideRule(t); return r?.kind === "monthly" ? twyDecideDates(week).filter((d) => d.slice(8) === r.anchorDate?.slice(8)).length : twyDecideDays(r).length; };
  const minutes = tasks.reduce((n, t) => n + count(t) * twyDecideEstimate(t), 0);
  const crowded = twyDecideDates(week).filter((date) => blocks.filter((b) => b.date === date).length > 5);
  const meta = twyDecideMeta(week), ids = new Set(tasks.map((t) => t.id)), projectIds = new Set(projects.map((p) => p.id));
  const changed = meta?.committedAt && [...tasks, ...(state.blocks || []).filter((b) => ids.has(b.taskId) && b.date >= week && b.date <= addDaysISO(week, 6)), ...(state.recurrences || []).filter((r) => ids.has(r.taskId))].some((r) => r.updatedAt > meta.committedAt);
  const pool = state.tasks.filter((t) => !t.deleted && projectIds.has(t.projectId) && !ids.has(t.id) && t.status !== "done" && !twyDecideRule(t));
  return `<section class="twy-decide" data-decide-week="${week}"><h2>今週を決める — 次の週 W${cycleStart ? Math.floor(daysBetween(cycleStart, week) / 7) + 1 : "—"}</h2><p>${week}〜${addDaysISO(week, 6)}</p><div class="twy-decide-columns"><div>
    <section class="twy-decide-total"><h2>今週やる</h2><p>${tasks.length} 件 · 週 ${tasks.reduce((n, t) => n + count(t), 0)} 回 · 約 ${Math.round(minutes / 6) / 10} 時間</p>
    <p>${crowded.length ? `! 1 日に 5 回を超える日があります(${crowded.map((d) => twyDayNames[twyDecideDay(d)]).join("・")})` : "✓ 1 日に 5 回を超える日はありません"}</p>${meta ? `<p>${changed ? "! 確定後に変更あり" : `✓ 確定済み(${escapeHTML(meta.committedAt || "")})`}</p>` : ""}</section>
    ${projects.map((p) => {
      const score = projectWeekScore(state.weeklyCommitments || [], previous, p.id), rows = twyDecideTasks(p.id);
      const tracks = (state.tracks || []).filter((track) => !track.deleted && track.projectId === p.id).map((track) => `${track.name} ${track.kind === "numeric" ? `${latestMeasurement(state.trackMeasurements || [], track.id)?.value ?? track.baselineValue}/${track.goalValue} ${track.unit || ""}` : `${(track.milestones || []).filter((m) => !m.deleted && m.doneAt).length}/${(track.milestones || []).filter((m) => !m.deleted).length}`}`).join(" · ");
      const review = (state.twyWeeklyReviews || []).find((r) => !r.deleted && r.weekStart === week && r.projectId === p.id);
      return `<section class="twy-decide-goal" data-decide-project="${escapeHTML(p.id)}"><h4>${escapeHTML(p.title)} <small>先週 できた ${score.done}/${score.total} · ${escapeHTML(tracks)} · 今週 ${rows.length} 件 · 週 ${rows.reduce((n, t) => n + count(t), 0)} 回</small></h4>
        <label>今週めざすこと(任意 1 行)<input class="input" data-action="twy-decide-aim" data-id="${escapeHTML(p.id)}" value="${escapeHTML(review?.aim || "")}"></label>
        ${rows.map((t, index) => {
          const rule = twyDecideRule(t), days = twyDecideDays(rule), time = rule?.startTime || "07:30", estimate = twyDecideEstimate(t), id = escapeHTML(t.id);
          return `<article class="twy-decide-task" data-decide-task="${id}"><span data-decide-number>${index + 1}</span><div><strong>${t.twyPlan?.keystone ? "★ " : ""}${escapeHTML(t.title)}</strong><small>週 ${count(t)} 回 · 見積 ${estimate} 分 · <span data-decide-memo-preview>${escapeHTML(String(t.memo || "").split(/\r\n|\r|\n/)[0])}</span></small>
            ${rule?.kind === "monthly" ? `<small>毎月 ${Number(rule.anchorDate?.slice(8)) || "未設定"} 日 · この週は ${count(t)} 回。曜日を押すと毎週の繰り返しに置き換えます</small>` : ""}
            <div class="twy-decide-days">${[6, 0, 1, 2, 3, 4, 5].map((d) => `<button class="btn" data-action="twy-decide-day" data-id="${id}" data-day="${d}" aria-pressed="${days.includes(d)}">${twyDayNames[d]}</button>`).join("")}</div>
            <div class="twy-decide-time"><input class="input" aria-label="開始時刻" type="time" step="300" value="${escapeHTML(time)}" data-action="twy-decide-time" data-id="${id}" ${rule ? "" : "disabled"}>〜<input class="input" aria-label="終了時刻" type="time" step="300" value="${twyDecideEnd(time, estimate)}" data-decide-end readonly></div>
            <div class="twy-decide-ops">${[-1, 1].map((dir) => `<button class="btn" data-action="twy-decide-move" data-id="${id}" data-dir="${dir}" ${index + dir < 0 || index + dir >= rows.length ? "disabled" : ""}>${dir < 0 ? "▲" : "▼"}</button>`).join("")}<button class="btn" data-action="twy-decide-edit" data-id="${id}">直す</button><button class="btn" data-action="twy-decide-remove" data-id="${id}">外す</button></div></div></article>`;
        }).join("")}<div class="twy-decide-add"><input class="input" data-decide-title aria-label="この目標に足す" placeholder="+ この目標に足す(やること名)"><button class="btn" data-action="twy-decide-create" data-id="${escapeHTML(p.id)}">足す</button></div><p data-decide-message role="status"></p><button class="btn ghost" data-action="nav" data-view="wbs">作業一覧で編集 ›</button></section>`;
    }).join("") || "<p>対象の12週の目標がありません</p>"}<button class="btn primary" data-action="twy-open-commit" data-week-start="${week}">これで決める ›</button></div>
    <aside class="twy-decide-candidates"><h3>候補</h3><h4>先週やらなかった物</h4>${tasks.flatMap((t) => twyDecideBlocks(t.id, previous).filter((b) => !b.completed && !b.actualEndAt)).map((b) => {
      const added = twyDecideBlocks(b.taskId, week).some((item) => item.date === addDaysISO(b.date, 7));
      return `<button class="btn" data-action="twy-decide-candidate" data-id="${escapeHTML(b.id)}" ${added ? "disabled" : ""}>${escapeHTML(b.title)} · ${twyDayNames[twyDecideDay(b.date)]}${added ? " · 追加済み" : ""}</button>`;
    }).join("") || "<p>ありません</p>"}${pool.length ? `<section data-decide-pool><h4>目標の作業一覧から</h4>${pool.map((t) => `<button class="btn" data-action="twy-decide-pool" data-id="${escapeHTML(t.id)}">${escapeHTML(t.title)}</button>`).join("")}</section>` : ""}</aside></div></section>`;
}
function openTwyDecideTask(id) {
  const task = state.tasks.find((t) => !t.deleted && t.id === id); if (!task) return;
  state.modal = { type: "twyDecideTask", id };
  renderModal(`${modalHeaderHTML(`直す — ${escapeHTML(task.title)}`)}<div class="twy-decide-sheet">
    <label>メモ(1 行目)<input class="input" data-modal-field="memo" value="${escapeHTML(String(task.memo || "").split(/\r\n|\r|\n/)[0])}"></label>
    <label>見積(分)<input class="input" type="number" min="5" max="180" step="5" data-modal-field="estimateMin" value="${twyDecideEstimate(task)}"></label>
    <label class="twy-decide-key"><input type="checkbox" data-modal-field="keystone" ${task.twyPlan?.keystone ? "checked" : ""}>いちばん大事(★)</label>
    <button class="btn primary" data-action="twy-decide-save">保存</button><button class="btn" data-action="modal-close">やめる</button></div></div></div>`);
  document.querySelector(".twy-decide-sheet").closest(".modal-card").classList.add("twy-decide-dialog");
}
function saveTwyDecideTask() {
  const id = state.modal?.id, root = document.querySelector(".twy-decide-sheet"); if (!root) return;
  const estimate = root.querySelector('[data-modal-field="estimateMin"]'); if (!estimate.value || !estimate.checkValidity()) return;
  return runRecurrenceChange(() => {
    const task = state.tasks.find((t) => !t.deleted && t.id === id); if (!task) return;
    const memo = String(task.memo || ""), boundary = memo.search(/\r\n|\r|\n/);
    task.memo = root.querySelector('[data-modal-field="memo"]').value + (boundary < 0 ? "" : memo.slice(boundary)); task.estimateMin = Number(estimate.value);
    task.twyPlan = { ...normalizeTwyPlan(task.twyPlan), keystone: root.querySelector('[data-modal-field="keystone"]').checked }; task.updatedAt = nowDateTime();
    const rule = twyDecideRule(task); if (rule) applyTwyDecideSchedule(task.id, twyDecideDays(rule), rule.startTime);
    closeModal(); saveAndRender("保存しました");
  });
}
function applyTwyDecideSchedule(id, selectedDays, startTime = "07:30") {
  const task = state.tasks.find((t) => !t.deleted && t.id === id); if (!task) return false;
  const days = [...selectedDays].sort((a, b) => a - b), week = twyDecideWeek(), now = nowDateTime();
  let rule = twyDecideRule(task);
  const monthly = rule?.kind === "monthly" && !days.length;
  if (!days.length && !monthly) {
    if (rule) { endRoutine(rule.id, true, { runChange: runRecurrenceChange, fromDate: week, immediate: true, onEnd: () => { const t = state.tasks.find((t) => t.id === id); t.twyPlan = { ...normalizeTwyPlan(t.twyPlan), perWeek: 0 }; t.updatedAt = now; } }); return true; }
    task.twyPlan = { ...normalizeTwyPlan(task.twyPlan), perWeek: 0 }; task.updatedAt = now; return true;
  }
  const duration = twyDecideEstimate(task), endTime = twyDecideEnd(startTime, duration);
  const template = (date) => ({ taskId: id, title: task.title, category: task.category || "", date, plannedStartAt: `${date}T${startTime}`,
    plannedEndAt: `${endTime < startTime ? addDaysISO(date, 1) : date}T${endTime}`, estimateMin: duration });
  const editable = (b) => {
    const r = (state.recurrences || []).find((r) => r.id === b.recurrenceGroupId), normalized = (v) => String(v || "").slice(0, 16);
    return !isTouchedBlock(b) && b.title === task.title && (!r || (normalized(b.plannedStartAt) === normalized(r.startTime ? `${b.date}T${r.startTime}` : "")
      && normalized(b.plannedEndAt) === normalized(r.endTime ? `${r.endTime < r.startTime ? addDaysISO(b.date, 1) : b.date}T${r.endTime}` : "")));
  };
  const kind = monthly ? "monthly" : days.length === 7 ? "daily" : days.join() === "1,2,3,4,5" ? "weekdays" : "weekly";
  const replace = new Set((state.blocks || []).filter((b) => rule && b.date >= week && b.recurrenceGroupId === rule.id && (editable(b) || (b.deleted && b.source === "twy-decide-week"))));
  if (!rule) { rule = createRecurrenceRule(template(week), kind, { sameTaskOnly: true }); if (!rule) return false; }
  Object.assign(rule, { kind, startTime, endTime, anchorDate: monthly ? rule.anchorDate : week, anchor: "", updatedAt: now });
  if (kind === "weekly") rule.days = days; else delete rule.days;
  for (const b of twyDecideBlocks(id, week)) if (!b.recurrenceGroupId && editable(b)) { b.deleted = true; b.updatedAt = now; }
  for (const b of replace) {
    if (monthly ? b.date.slice(8) === rule.anchorDate?.slice(8) : days.includes(twyDecideDay(b.date))) { Object.assign(b, template(b.date), { deleted: false, updatedAt: now }); if (b.source === "twy-decide-week") b.source = ""; }
    else Object.assign(b, { deleted: true, updatedAt: now, source: "twy-decide-week" });
  }
  maintainRecurrences({ persist: false });
  const savedTask = state.tasks.find((t) => t.id === id); savedTask.twyPlan = { ...normalizeTwyPlan(savedTask.twyPlan), perWeek: monthly ? twyDecideDates(week).filter((date) => date.slice(8) === rule.anchorDate?.slice(8)).length : days.length }; savedTask.updatedAt = now;
  return true;
}
function twyDecideCreate(id, target) {
  const root = target.closest("[data-decide-project]"), title = root.querySelector("[data-decide-title]").value.trim(); if (!title) return;
  if (!createTwyTask({ title, projectId: id, estimateMin: 25, twyPerWeek: 0, twyKeystone: false }, (task) => applyTwyDecideSchedule(task.id, []))) root.querySelector("[data-decide-message]").textContent = "追加できませんでした";
}
function twyDecideMove(id, direction) {
  return runRecurrenceChange(() => {
    const task = state.tasks.find((t) => t.id === id); if (!task) return;
    const tasks = twyDecideTasks(task.projectId), index = tasks.indexOf(task), other = tasks[index + direction]; if (!other) return;
    tasks.forEach((t, i) => { t.order = i; t.updatedAt = nowDateTime(); });
    [task.order, other.order] = [other.order, task.order]; saveAndRender();
  });
}
function twyDecideAdd(id) {
  return runRecurrenceChange(() => {
    const block = state.blocks.find((b) => b.id === id && !b.deleted); if (!block) return;
    const date = addDaysISO(block.date, 7), task = state.tasks.find((t) => t.id === block.taskId), rule = task && twyDecideRule(task);
    if (twyDecideBlocks(block.taskId, twyDecideWeek()).some((b) => b.date === date)) return;
    const start = rule?.startTime || block.plannedStartAt?.slice(11, 16), end = rule?.endTime || block.plannedEndAt?.slice(11, 16);
    state.blocks.push(makeBlock({ taskId: block.taskId, title: block.title, category: block.category || "", date,
      plannedStartAt: start ? `${date}T${start}` : "", plannedEndAt: end ? `${end < start ? addDaysISO(date, 1) : date}T${end}` : "" })); saveAndRender();
  });
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
    <ul>${missed.map((item) => `<li>${labels.get(item.plannedDate) || ""} ${escapeHTML(item.title || "名前のない予定")}<span class="twy-proj-tag">${escapeHTML((state.projects || []).find(p => p.id === item.projectId)?.title || "")}</span></li>`).join("")}</ul>
    <p>${bias}</p></section>
    ${twyReviewResultsHTML(cycleStart, weekStart)}
    <section class="panel tower-panel-box twy-review-finish"><h2>③ 終える</h2>
    ${twyReviewFinished(weekStart) ? "<p>✓ ふりかえり済み</p>" : ""}
    <button type="button" class="btn primary" style="min-height:44px;max-width:100%;white-space:normal" data-action="twy-review-finish">ふりかえりを終えて『次の週を決める』へ ›</button></section></section>`;
}

// R2: PLAN面(design §2.1b・§2.0)。LINK(連動図5ノード)+12-WEEK PLANグリッド+「目安なし」一覧。
// 読み取り専用(taskPlanGrid/remainingTarget/cycleWeeksSummaryだけを使う。Block自動生成なし)。
// 各ノード下の「編集する画面」導線は既存nav/twy-open-commitとサイクルの折りたたみを再利用する。
const TWY_PLAN_LINK_NODES = [
  { label: "12週のプロジェクト", editLabel: "作業一覧", attrs: `data-action="nav" data-view="wbs"` },
  { label: "タスク", editLabel: "作業一覧", attrs: `data-action="nav" data-view="wbs"` },
  { label: "予定・実行記録", editLabel: "タイムライン", attrs: `data-action="nav" data-view="timeline"` },
  { label: "今週の確定分", editLabel: "今週を確定", attrs: `data-action="twy-open-commit"` },
  { label: "今週の進み具合", editLabel: "サイクル", attrs: `data-action="twy-cycle-open"` }
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

// M2: Blockの回数だけを表示。確定記録・保存値には触れない。
function twyDoneHTML(cycleStart) {
  const week = twyDecideWeek(), days = weekCounts(state.blocks || [], state.tasks || [], week);
  const done = days.reduce((n, d) => n + d.done, 0), planned = days.reduce((n, d) => n + d.planned, 0);
  const rows = twyGoalCandidates(cycleStart).map(project => {
    const counts = weekCounts(state.blocks || [], (state.tasks || []).filter(t => t.projectId === project.id), week);
    return `<p data-done-project="${escapeHTML(project.id)}">${escapeHTML(project.title)} · できた ${counts.reduce((n, d) => n + d.done, 0)}/${counts.reduce((n, d) => n + d.planned, 0)}</p>`;
  }).join("");
  return `<section class="panel tower-panel-box twy-done" data-week="${week}"><h2>今週のできた <small>${week}〜${addDaysISO(week, 6)}</small></h2>
    <div class="twy-done-score" data-done-percent>${planned ? Math.round(done / planned * 100) + "%" : "—"}</div><p>できた ${done}/${planned}</p>
    <div class="twy-done-days">${days.map((day, i) => `<span>${twyDayNames[(i + 6) % 7]}<small>${day.done}回</small></span>`).join("")}</div>${rows}</section>`;
}

function twyStackHTML() {
  const days = weekCounts(state.blocks || [], state.tasks || [], twyDecideWeek());
  const done = days.reduce((n, d) => n + d.done, 0), planned = days.reduce((n, d) => n + d.planned, 0), max = Math.max(1, ...days.map(d => d.done));
  return `<section class="panel tower-panel-box twy-stack"><h2>積み上げ</h2>
    <div class="twy-stack-bars">${days.map((day, i) => `<div role="img" aria-label="${twyDayNames[(i + 6) % 7]}曜 ${day.done} 回"><i style="height:${day.done / max * 100}%"></i><span>${twyDayNames[(i + 6) % 7]}</span></div>`).join("")}</div>
    <div class="twy-stack-ring" role="img" aria-label="${planned ? `今週 ${planned}回のうち ${done}回できた` : "予定なし"}">
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="twy-stack-ring-base" cx="50" cy="50" r="42"/><circle cx="50" cy="50" r="42" pathLength="1" stroke-dasharray="${ringRatio(done, planned)} 1"/></svg>
      <strong>${planned ? `${done}/${planned}` : "予定なし"}</strong></div></section>`;
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
  "twy-decide-create": ({ id, target }) => twyDecideCreate(id, target),
  "twy-decide-edit": ({ id }) => openTwyDecideTask(id),
  "twy-decide-save": () => saveTwyDecideTask(),
  "twy-decide-move": ({ id, target }) => twyDecideMove(id, Number(target.dataset.dir)),
  "twy-decide-candidate": ({ id }) => twyDecideAdd(id),
  "twy-decide-pool": ({ id }) => runRecurrenceChange(() => {
    const task = state.tasks.find((t) => !t.deleted && t.id === id); if (!task || twyDecideRule(task)) return;
    task.status = "todo"; applyTwyDecideSchedule(id, []); saveAndRender();
  }),
  "twy-decide-remove": ({ id, target }) => runRecurrenceChange(() => {
    const task = state.tasks.find((t) => !t.deleted && t.id === id); if (!task) return;
    endRoutine(twyDecideRule(task)?.id, Boolean(target.dataset.confirmAfter), { target, runChange: runRecurrenceChange, fromDate: twyDecideWeek(), onEnd: () => {
      const t = state.tasks.find((t) => t.id === id); t.twyPlan = { ...normalizeTwyPlan(t.twyPlan), perWeek: 0 }; t.updatedAt = nowDateTime();
    } });
  }),
  "twy-decide-aim": ({ event, id, target }) => {
    if (event.type !== "change") return;
    upsertWeeklyReview(target.closest("[data-decide-week]").dataset.decideWeek, id, { aim: target.value }); saveState();
  },
  "twy-decide-day": ({ id, target }) => runRecurrenceChange(() => {
    const task = state.tasks.find((t) => !t.deleted && t.id === id); if (!task) return;
    const rule = twyDecideRule(task), day = Number(target.dataset.day), days = twyDecideDays(rule);
    if (applyTwyDecideSchedule(id, days.includes(day) ? days.filter((d) => d !== day) : [...days, day], rule?.startTime || "07:30")) saveAndRender();
  }),
  "twy-decide-time": ({ event, id, target }) => {
    if (event.type !== "change" || !target.value || !target.checkValidity()) return;
    return runRecurrenceChange(() => { const task = state.tasks.find((t) => t.id === id), rule = task && twyDecideRule(task);
      if (rule && applyTwyDecideSchedule(id, twyDecideDays(rule), target.value)) saveAndRender(); });
  },
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
    if (typeof document !== "undefined") { const fold = document.querySelector(".twy-review-fold"); if (fold) fold.open = false; }
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
  "twy-cycle-open": () => {
    const fold = document.querySelector(".twy-cycle-fold");
    if (fold) { fold.open = true; fold.scrollIntoView({ block: "start" }); }
  }
});

export { configureTwelveWeek, renderTwelveWeek, upsertWeeklyReview, deleteWeeklyReview };
