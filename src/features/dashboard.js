// src/features/dashboard.js — app.js分割・段階4-1(ダッシュボードの閲覧専用render抽出)。
//
// 契約(prep-stage4-dashboard.md、src/sync/github.js冒頭コメントと同じ依存注入パターン):
//   1. state の再代入はしない(importした state の読み取り・プロパティ変更のみ)。
//   2. src/配下からapp.jsをimportしない(循環import禁止)。escapeHTML/clamp/parseDate/addDays/
//      dateToISO/localDateTimeToMs/todayISO/fmtMinShort/renderMarkdown/getCategoryColor/
//      personalDataReady/fetchGitHubRawResult/renderDeferringForFocus/render/renderHeaderは
//      いずれもまだsrc/**へ抽出されておらずapp.js側に残る汎用ヘルパーのため、
//      configureDashboard(deps) による依存注入で受け取る(github.js方式と同じ)。
//      app.js はモジュール読み込み直後・stateの初期化直後に一度だけこれを呼ぶ。
//   3. src/**/*.js を追加したら sw.js の APP_SHELL へ必ず追加し、CACHE_NAME を +1 する。
//
// 抽出元: app.js(v166時点)の以下の関数群+モジュール変数。ロジックは一切変更していない
// (移動+依存注入化のみ。挙動は抽出前と完全に同一)。
//   isDashboardDate/dashboardWeekStart/computeDashboardMetrics/defaultDashboardDate/
//   currentDashboardDate/setDashboardDate/shiftDashboardDate/dashboardRateHTML/
//   dashboardTrendBarsHTML/renderDashboard/hydrateDashboardFeedback/requestDashboardFeedback
//   dashboardSelectedDate/dashboardDateTouched/_dashboardFeedbackFetchState(モジュール専用、
//   他機能から未参照。設計書§2で確認済み)
//
// cachedFeedbackはHomeタブ「AIから」カードとこのファイルの両方が読み書きする共有オブジェクトのため、
// 独立モジュール src/state/feedback-cache.js へ切り出し、双方からimportする(設計書§9 Must級)。
//
// characterization test: tests/dashboard-core.test.js。

import { state } from "../state/store.js";
import { cachedFeedback } from "../state/feedback-cache.js";

// ---- 依存注入(configureDashboard) ----
let renderHeader, escapeHTML, clamp, parseDate, addDays, dateToISO, localDateTimeToMs;
let todayISO, fmtMinShort, renderMarkdown, getCategoryColor, personalDataReady;
let fetchGitHubRawResult, renderDeferringForFocus, render;

function configureDashboard(deps) {
  ({
    renderHeader, escapeHTML, clamp, parseDate, addDays, dateToISO, localDateTimeToMs,
    todayISO, fmtMinShort, renderMarkdown, getCategoryColor, personalDataReady,
    fetchGitHubRawResult, renderDeferringForFocus, render
  } = deps);
}

// ---- ここから抽出したコード本体(app.js:v166時点から移動。ロジック無改変) ----

// v163: ダッシュボード固有の日付カーソルと任意日フィードバック取得状態。いずれも非永続。
let dashboardSelectedDate = "";
// v163 batch2(レビュー是正、Codex P2): ユーザーが未操作の間は起動時hydration完了後の
// 最新フィードバック日を追随させたいので、「一度でも手で日付を変えたか」を別フラグで持つ。
let dashboardDateTouched = false;
const _dashboardFeedbackFetchState = {};  // { 'YYYY-MM-DD': 'loading'|'ready'|'missing' }

// v163: 月曜始まりの選択週と、その週で終わる8週窓の実績を決定論で集計する。
// taskchute-dashboard-build.py と同じく、削除済み・未来日のBlockは全指標から除外する。
function isDashboardDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  return dateToISO(parseDate(date)) === date;
}

function dashboardWeekStart(date) {
  const day = parseDate(date).getDay();
  return addDays(date, -((day + 6) % 7));
}

function computeDashboardMetrics(blocks, selectedDate, todayDate = todayISO(), categories = state.settings?.categories || []) {
  const weekStart = dashboardWeekStart(selectedDate);
  const weekEnd = addDays(weekStart, 6);
  const windowStart = addDays(weekStart, -49);
  const allPast = (Array.isArray(blocks) ? blocks : []).filter((b) =>
    !b.deleted && isDashboardDate(b.date) && b.date <= todayDate
  );
  const weekBlocks = allPast.filter((b) => b.date >= weekStart && b.date <= weekEnd);
  const windowBlocks = allPast.filter((b) => b.date >= windowStart && b.date <= weekEnd);
  const rate = (done, total) => total ? done / total * 100 : null;
  const recordedCount = (items) => items.filter((b) => b.actualStartAt && b.actualEndAt).length;
  const completedCount = (items) => items.filter((b) => b.completed).length;

  const categoryNames = [...new Set((Array.isArray(categories) ? categories : [])
    .map((c) => c?.name).filter(Boolean))];
  const categoryMinutes = Object.fromEntries(categoryNames.map((name) => [name, 0]));
  let otherMinutes = 0;
  let excludedNoTime = 0;
  weekBlocks.forEach((b) => {
    let minutes = null;
    if (typeof b.estimateMin === "number" && Number.isFinite(b.estimateMin) && b.estimateMin !== 0) {
      minutes = b.estimateMin;
    } else {
      const startMs = localDateTimeToMs(b.plannedStartAt);
      const endMs = localDateTimeToMs(b.plannedEndAt);
      if (startMs && endMs) minutes = Math.max(0, (endMs - startMs) / 60000);
    }
    if (minutes === null) {
      excludedNoTime++;
      return;
    }
    if (Object.prototype.hasOwnProperty.call(categoryMinutes, b.category || "")) categoryMinutes[b.category] += minutes;
    else otherMinutes += minutes;
  });
  const categoryRows = categoryNames.map((name) => ({ name, minutes: categoryMinutes[name] }));
  if (otherMinutes) categoryRows.push({ name: "その他", minutes: otherMinutes });

  const overallRecorded = recordedCount(allPast);
  const weekRecorded = recordedCount(weekBlocks);
  const weekCompleted = completedCount(weekBlocks);
  const mitBlocks = windowBlocks.filter((b) => b.isMIT);
  const mitCompleted = completedCount(mitBlocks);
  const routineBlocks = weekBlocks.filter((b) => b.recurrenceGroupId);
  const routineCompleted = completedCount(routineBlocks);

  // v163 batch 2: 記録率・完了率・ルーティン遵守の8週推移(taskchute-dashboard-build.pyの
  // build_weeks/週次バーと同じ窓・同じ月曜始まり週割り)。windowBlocksは既にwindowStart〜weekEndに
  // 絞られているため、週ごとに再フィルタするだけでよい。
  const weeklyWeeks = [];
  for (let i = 7; i >= 0; i--) {
    const wStart = addDays(weekEnd, -6 - 7 * i);
    weeklyWeeks.push({ start: wStart, end: addDays(wStart, 6), label: wStart.slice(5).replace("-", "/") });
  }
  const weeklyTrend = weeklyWeeks.map((w) => {
    const items = windowBlocks.filter((b) => b.date >= w.start && b.date <= w.end);
    const routineItems = items.filter((b) => b.recurrenceGroupId);
    return {
      ...w,
      recordRate: rate(recordedCount(items), items.length),
      completionRate: rate(completedCount(items), items.length),
      routineRate: rate(completedCount(routineItems), routineItems.length)
    };
  });

  return {
    weekStart, weekEnd, windowStart,
    recordOverall: { recorded: overallRecorded, total: allPast.length, rate: rate(overallRecorded, allPast.length) },
    recordWeek: { recorded: weekRecorded, total: weekBlocks.length, rate: rate(weekRecorded, weekBlocks.length) },
    categoryRows, excludedNoTime,
    completion: { completed: weekCompleted, total: weekBlocks.length, rate: rate(weekCompleted, weekBlocks.length) },
    mit: { completed: mitCompleted, total: mitBlocks.length, rate: rate(mitCompleted, mitBlocks.length) },
    routine: { completed: routineCompleted, total: routineBlocks.length, rate: rate(routineCompleted, routineBlocks.length) },
    weeklyTrend
  };
}

function defaultDashboardDate() {
  const dates = [
    ...(Array.isArray(state.feedbackFiles) ? state.feedbackFiles : []),
    ...Object.keys(state.feedback || {})
  ].filter(isDashboardDate);
  if (!dates.length) return addDays(todayISO(), -1);
  dates.sort();
  return dates[dates.length - 1];
}

function currentDashboardDate() {
  // v163 batch2(レビュー是正): 手で操作するまでは毎回defaultDashboardDate()を取り直す。
  // 起動直後の初回renderはhydrateStaticMarkdown()の完了(前日フィードバックの発見・記録)より
  // 先に走るため、固定してしまうとhydration後も古いカーソルのまま追随しなかった(Codex P2)。
  if (!dashboardDateTouched || !isDashboardDate(dashboardSelectedDate)) {
    dashboardSelectedDate = defaultDashboardDate();
  }
  return dashboardSelectedDate;
}

function setDashboardDate(date) {
  if (!isDashboardDate(date)) return;
  dashboardSelectedDate = date;
  dashboardDateTouched = true;
  render();
}

function shiftDashboardDate(delta) {
  setDashboardDate(addDays(currentDashboardDate(), delta));
}

function dashboardRateHTML(metric, noun) {
  if (metric.rate === null) return `<div class="muted">対象データなし</div>`;
  const pct = Math.round(metric.rate);
  return `
    <div class="dashboard-metric"><strong>${pct}%</strong><span>${metric.completed ?? metric.recorded}/${metric.total} ${noun}</span></div>
    <div class="progress"><span style="width:${clamp(pct, 0, 100)}%"></span></div>`;
}

// v163 batch 2: 8週推移ミニバー。計器盤(renderStats)の.stats-bars/.stats-bar-fillをそのまま再利用する
// (幅固定のtrackを使わないため、achievement-columnがどの幅でも横あふれしない)。
function dashboardTrendBarsHTML(weeklyTrend, key) {
  return `
    <div class="stats-bars">
      ${weeklyTrend.map((w) => {
        const v = w[key];
        const title = `${w.label}〜: ${v === null ? "記録なし" : `${Math.round(v)}%`}`;
        return `<div class="stats-bar-cell" title="${escapeHTML(title)}">
          <div class="stats-bar">${v === null ? "" : `<div class="stats-bar-fill" style="height:${clamp(Math.round(v), 0, 100)}%"></div>`}</div>
        </div>`;
      }).join("")}
    </div>
    <div class="muted stats-axis">${weeklyTrend[0].label} 〜 選択週(8週推移)</div>`;
}

function renderDashboard() {
  const date = currentDashboardDate();
  const metrics = computeDashboardMetrics(state.blocks, date);
  requestDashboardFeedback(date);
  const feedback = cachedFeedback[date] || state.feedback?.[date] || "";
  const categoryRows = metrics.categoryRows.filter((row) => row.minutes !== 0);
  const categoryMax = Math.max(1, ...categoryRows.map((row) => row.minutes));
  const recordPct = metrics.recordOverall.rate;
  const gateOpen = recordPct !== null && recordPct >= 50;
  const weekLabel = `${metrics.weekStart.replace(/-/g, "/")}〜${metrics.weekEnd.replace(/-/g, "/")}`;
  return `
    ${renderHeader("実績とAIの振り返り", "ダッシュボード", `
      <div class="dashboard-date-nav">
        <button class="btn" data-action="dashboard-date-prev" aria-label="前日">←</button>
        <input class="input dashboard-date-input" type="date" data-dashboard-date value="${date}">
        <button class="btn" data-action="dashboard-date-next" aria-label="翌日">→</button>
      </div>`)}
    <div class="muted dashboard-week-label">集計週: ${weekLabel}(月曜始まり)</div>
    <section class="stats-grid dashboard-grid">
      <div class="dashboard-achievement-column">
        <div class="stats-grid">
          <div class="panel stack">
            <h2>実績記録率</h2>
            <div class="muted">全期間</div>
            ${dashboardRateHTML(metrics.recordOverall, "件")}
            <div class="muted">選択週</div>
            ${dashboardRateHTML(metrics.recordWeek, "件")}
            ${dashboardTrendBarsHTML(metrics.weeklyTrend, "recordRate")}
            <div class="dashboard-gate-note">${recordPct === null
              ? "実績記録がたまると、バッチ2の解放条件を判定できます。"
              : gateOpen
                ? "50%に達しました。バッチ2の見積精度・時間帯分析を解放できます。"
                : "50%以上になると、バッチ2の見積精度・時間帯分析が解放されます。"}</div>
            <div class="muted stats-axis">集計方法: actualStartAtとactualEndAtが両方ある過去Block ÷ 対象の過去Block。</div>
          </div>
          <div class="panel stack stats-wide">
            <h2>週次カテゴリ別 計画時間</h2>
            ${categoryRows.length ? categoryRows.map((row) => `
              <div class="dashboard-category-row">
                <div class="row"><span>${escapeHTML(row.name)}</span><strong>${fmtMinShort(row.minutes)}</strong></div>
                <div class="progress"><span style="width:${clamp(Math.round(row.minutes / categoryMax * 100), 0, 100)}%; background:${escapeHTML(getCategoryColor(row.name))}"></span></div>
              </div>`).join("") : `<div class="muted">計画時間のあるBlockはありません。</div>`}
            <div class="muted">時間情報なしで除外: ${metrics.excludedNoTime}件</div>
            <div class="muted stats-axis">集計方法: estimateMinを優先し、無ければplannedEndAt−plannedStartAtをカテゴリ別に合計。</div>
          </div>
          <div class="panel stack">
            <h2>週次完了率</h2>
            ${dashboardRateHTML(metrics.completion, "件完了")}
            ${dashboardTrendBarsHTML(metrics.weeklyTrend, "completionRate")}
            <div class="muted stats-axis">集計方法: completed=trueの件数 ÷ 選択週の過去Block数。</div>
          </div>
          <div class="panel stack">
            <h2>MIT達成(8週)</h2>
            ${dashboardRateHTML(metrics.mit, "件完了")}
            <div class="muted stats-axis">集計方法: 選択週で終わる直近8週のisMIT=trueを単一集計。</div>
          </div>
          <div class="panel stack">
            <h2>ルーティン遵守</h2>
            ${dashboardRateHTML(metrics.routine, "件完了")}
            ${dashboardTrendBarsHTML(metrics.weeklyTrend, "routineRate")}
            <div class="muted stats-axis">集計方法: recurrenceGroupIdを持つ選択週Blockのcompleted ÷ 件数。</div>
          </div>
          <div class="panel stack stats-wide">
            <h2>今回の対象外</h2>
            <div>${recordPct === null
              ? "見積精度・中断分析は、実績記録率をまだ算出できないため対象外です。"
              : gateOpen
                ? "見積精度・中断分析はバッチ1の対象外です。実績記録率の条件を満たしたため、バッチ2で解放できます。"
                : "見積精度・中断分析は、実績記録率が50%未満のため対象外です。"}</div>
            <div class="muted stats-axis">集計方法: 数値は表示せず、実績記録率50%の解放条件だけを判定。</div>
          </div>
        </div>
      </div>
      <div class="panel stack dashboard-feedback-column">
        <h2>AIフィードバック</h2>
        <div class="muted">${date}</div>
        <div class="dashboard-feedback-body md-render readonly-md">${feedback
          ? renderMarkdown(feedback)
          : "この日のAIフィードバックはありません。"}</div>
      </div>
    </section>
  `;
}

// v163: ダッシュボードで選んだ任意日のAIフィードバックを1セッション1回だけ確認する。
// 404・空ファイル・通信失敗はいずれもmissingへ倒し、本文領域は静かな空表示にする。
async function hydrateDashboardFeedback(date) {
  if (!isDashboardDate(date)) return false;
  if (!personalDataReady(state.settings.github)) return false;
  if ((state.feedback?.[date] || "").trim() || (cachedFeedback[date] || "").trim()) {
    _dashboardFeedbackFetchState[date] = "ready";
    return false;
  }
  if (_dashboardFeedbackFetchState[date]) return false;
  _dashboardFeedbackFetchState[date] = "loading";
  const result = await fetchGitHubRawResult(`AIフィードバック_${date}.md`);
  if (result.ok && result.text.trim()) {
    const changed = result.text !== cachedFeedback[date];
    cachedFeedback[date] = result.text;
    _dashboardFeedbackFetchState[date] = "ready";
    return changed;
  }
  _dashboardFeedbackFetchState[date] = "missing";
  return false;
}

function requestDashboardFeedback(date) {
  hydrateDashboardFeedback(date)
    .then((changed) => {
      if (changed && state.currentView === "dashboard" && currentDashboardDate() === date) {
        renderDeferringForFocus();
      }
    })
    .catch(() => { _dashboardFeedbackFetchState[date] = "missing"; });
}

export {
  configureDashboard,
  isDashboardDate, dashboardWeekStart, computeDashboardMetrics,
  defaultDashboardDate, currentDashboardDate, setDashboardDate, shiftDashboardDate,
  dashboardRateHTML, dashboardTrendBarsHTML, renderDashboard,
  hydrateDashboardFeedback, requestDashboardFeedback
};
