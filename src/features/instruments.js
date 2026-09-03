// src/features/instruments.js(予定パス)— TaskChute Journal スリム化P4・レーンC(新計器盤)。
//
// 契約(p4-interface.md §3。dashboard.js/wish.js と同じ configureXxx(deps) DIパターンだが、
// state store・ui/actions.js等は直接importせず、表示用の純関数だけを葉モジュールからimportする。
//   deps: { getState, escapeHTML, todayISO, addDays, weekRange, renderHeader, registerActions }
//
// stateスキーマ(p4-interface.md §1、凍結。正本データの書き込みはP3側・GATE ROUTINE実装が担う):
//   state.earlyBird.logs["YYYY-MM-DD"] = { checkedAt: "YYYY-MM-DDTHH:mm" }
//   state.condition.logs["YYYY-MM-DD"].gym = [{ exercise, weight, reps, at, blockId? }]
// いずれも未定義でも落ちない防御的読み取りにする(P4時点でP3のstate反映が先行しているとは限らない)。
//
// settingsキー(p4-interface.md §2、凍結。normalizeStateへの既定値追記は統合時に監督者が実施):
//   settings.ironDailyTarget(既定2000) / settings.ironManualBaseKg(既定0)
//
// ストリーク定義(p4-interface.md §3、凍結・逸脱禁止):
//   「logs[date]が存在する日の連続。存在しない日で切断。todayIso当日は未チェックでも
//    切断しない(進行中扱い)」。当日未チェックの場合は当日をカウントに含めないが、
//    前日以前の連続はそのまま(切断せず)遡って数える。
//
// iOS Safariでずれる日時文字列のDateパースは禁止(p4-interface.md §6)。日付の加減算は
// すべてdeps.addDays(app.js本体版は数値コンストラクタnew Date(y,m,d)を使うためTZ安全)を
// 経由し、このモジュール自身では日時文字列をパースしない。
//
// data-action(凍結): instruments-open-iron-log — このモジュールは登録のみ行う。
// 実処理(IRON LOG画面への遷移)は統合時にapp.js側でnav結線する(p4-interface.md §3の指定。
// navigate系のdepsがこのモジュールに渡されていないため、ここでは安全なno-opを登録し、
// 統合時にapp.js側がregisterActionsで同名アクションを実処理へ上書きする想定)。
//
// 非目標(p4-interface.md §6): 旧計器盤のヒートマップ・相関・ドーナツ等は持ち込まない。
// v247の月別×種目別重量グラフは構造化セットだけを読む独立した表示専用集計とする。
//
// characterization test: instruments-core.test.js(同ディレクトリ、ブラウザ不要)。

import { habitStreakPeriodStats, habitStreakStats } from "../core/habit-streak.js";
import { cachedHealthData, conditionCommentText, conditionFromHealth } from "./health.js";
import { bmSummary } from "./today-tower.js";

// ---- 依存注入(configureInstruments) ----
// 呼び出し前のフォールバック(単体で読み込んだだけでは壊れないようにするための最小スタブ。
// 実際の描画・ロジック検証はconfigureInstruments(deps)呼び出し後の値を使う)。
let getState = () => ({});
let escapeHTML = (value) => String(value ?? "");
let todayISO = () => "";
let addDays = (date) => date;
let weekRange = (date) => ({ weekStart: date, weekEnd: date });
let renderHeader = (eyebrow, title) => `<h1>${eyebrow} / ${title}</h1>`;
let registerActions = () => {};

function configureInstruments(deps) {
  ({ getState, escapeHTML, todayISO, addDays, weekRange, renderHeader, registerActions } = deps || {});
  if (typeof registerActions === "function") {
    registerActions({
      // 統合時にapp.js側がnav結線するまでのプレースホルダ(p4-interface.md §3参照)。
      "instruments-open-iron-log": () => {}
    });
  }
}

// ---- 純粋ロジック ----

const LAST_WINDOW_DAYS = 28; // 直近4週

// EARLY BIRD統計(p4-interface.md §3で凍結された返り値の形)。
// state.earlyBird が未定義でも落ちない。
function earlyBirdStats(state, todayIso) {
  const logs = (state && state.earlyBird && state.earlyBird.logs) || {};

  // 現在ストリーク: 当日チェック済みなら当日を1として含め、前日以前へ遡って連続日数を数える。
  // 当日未チェックのときは当日をカウントに含めないが、前日から始まる連続はそのまま数える
  // (「当日は進行中扱いで切断しない」= 前日以前の連続を壊さない、という凍結定義)。
  let currentStreak = logs[todayIso] ? 1 : 0;
  let cursor = addDays(todayIso, -1);
  while (logs[cursor]) {
    currentStreak++;
    cursor = addDays(cursor, -1);
  }

  // 累計回数・自己ベスト: 全ログを日付昇順に並べ、暦日で連続する最長run長を求める
  // (配列の並び順ではなく addDays(prev, 1) === cur で暦日連続かどうかを判定する)。
  const dates = Object.keys(logs).filter((d) => logs[d]).sort();
  const totalCount = dates.length;
  const yearStart = `${todayIso.slice(0, 4)}-01-01`;
  const yearCount = dates.filter((date) => date >= yearStart && date <= todayIso).length;
  let bestStreak = 0;
  let runLength = 0;
  let prevDate = null;
  for (const d of dates) {
    runLength = (prevDate && addDays(prevDate, 1) === d) ? runLength + 1 : 1;
    if (runLength > bestStreak) bestStreak = runLength;
    prevDate = d;
  }
  // 進行中の当日ストリークが過去の最長runを超えていれば、それ自体が新しい自己ベスト。
  bestStreak = Math.max(bestStreak, currentStreak);

  // 直近28日窓: today-27日目 〜 today(古い→新しいの昇順、todayを含む)。
  const last28 = [];
  let d = addDays(todayIso, -(LAST_WINDOW_DAYS - 1));
  for (let i = 0; i < LAST_WINDOW_DAYS; i++) {
    last28.push({ date: d, checked: !!logs[d] });
    d = addDays(d, 1);
  }

  return { currentStreak, bestStreak, totalCount, yearCount, last28 };
}

const GRAPH_COLORS = [
  "var(--tower-amber)", "var(--tower-green)", "var(--tower-cyan)", "var(--tower-purple)",
  "color-mix(in srgb, var(--tower-amber) 65%, var(--tower-purple))",
  "color-mix(in srgb, var(--tower-green) 65%, var(--tower-cyan))"
];

const finiteNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
function shiftIso(iso, delta) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function gymKgForDate(state, date) {
  return (state?.condition?.logs?.[date]?.gym || []).reduce((sum, set) => set?.deleted
    ? sum : sum + (Number(set?.weight) || 0) * (Number(set?.reps) || 0), 0);
}
function weekSummary(days, state, todayIso) {
  const dates = Array.from({ length: 7 }, (_, index) => shiftIso(todayIso, index - 6));
  const byDate = new Map((Array.isArray(days) ? days : []).map((day) => [day?.date, day]));
  const series = (key) => dates.map((date) => ({ date, value: finiteNumber(byDate.get(date)?.[key]) }));
  const values = (points) => points.filter((point) => point.value !== null);
  const average = (points) => {
    const present = values(points);
    return present.length ? present.reduce((sum, point) => sum + point.value, 0) / present.length : null;
  };
  const sleep = series("sleep_min"), steps = series("steps"), hrv = series("hrv_sdnn");
  const hrvValues = values(hrv);
  const gym = dates.map((date) => ({ date, value: gymKgForDate(state, date) || null }));
  const scans = Array.isArray(state?.bodyScans) ? state.bodyScans : [];
  const bodyScans = dates.map((date) => {
    const daily = scans.filter((scan) => !scan?.deleted && String(scan?.dateTime || "").startsWith(date)
      && finiteNumber(scan?.fatigue) !== null);
    return { date, value: daily.length ? bmSummary(daily).fatigue / daily.length : null };
  });
  const gymValues = values(gym), bodyValues = values(bodyScans);
  const gymMax = gymValues.reduce((best, point) => !best || point.value > best.value ? point : best, null);
  return {
    dates, from: dates[0], to: dates[6],
    sleep: { points: sleep, average: average(sleep), missing: 7 - values(sleep).length },
    steps: { points: steps, average: average(steps), yesterday: steps[5]?.value ?? null },
    hrv: { points: hrv, first: hrvValues[0]?.value ?? null,
      middle: hrvValues[Math.floor(hrvValues.length / 2)]?.value ?? null, last: hrvValues.at(-1)?.value ?? null },
    gym: { points: gym, count: gymValues.length, maxKg: gymMax?.value ?? null, maxDate: gymMax?.date ?? null },
    bodyScans: { points: bodyScans, average: average(bodyScans),
      max: bodyValues.length ? Math.max(...bodyValues.map((point) => point.value)) : null }
  };
}

function durationText(minutes) {
  if (minutes === null) return "—";
  const rounded = Math.round(minutes);
  return `${Math.floor(rounded / 60)}h${String(rounded % 60).padStart(2, "0")}m`;
}
function shortDate(iso) { return iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : "—"; }
function generatedTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ""));
  return match ? `${Number(match[2])}/${Number(match[3])} ${match[4]}:${match[5]}` : "未取得";
}
function metricHTML(label, value, detail, wide = false) {
  return `<div class="instr-kpi${wide ? " instr-kpi-wide" : ""}"><strong>${escapeHTML(value)}</strong><span>${label}</span><small>${escapeHTML(detail)}</small></div>`;
}
function todayPanelHTML(state, todayIso, health) {
  const days = Array.isArray(health?.days) ? health.days : [];
  const row = days.find((day) => day?.date === todayIso);
  const heading = `<h2>からだ ─ 今日 <span>Apple Health ${escapeHTML(generatedTime(health?.generated_at))}</span></h2>`;
  if (!row) return `<section class="instr-panel-box instr-today">${heading}<div class="instr-today-empty">今朝の睡眠データはまだありません</div></section>`;
  const cond = conditionFromHealth(days, todayIso);
  const detail = (value, text) => value === null ? "未記録" : text;
  const kpis = [
    metricHTML("睡眠", durationText(cond.sleepMin), detail(cond.sleepMin, cond.bedTime && cond.wakeTime ? `${cond.bedTime}→${cond.wakeTime}` : "未記録")),
    metricHTML("安静時HR", cond.restingHr?.toLocaleString("ja-JP") ?? "—", detail(cond.restingHr, "bpm")),
    metricHTML("HRV", cond.hrv?.toLocaleString("ja-JP") ?? "—", detail(cond.hrv, "ms")),
    metricHTML("昨日の歩数", cond.ySteps?.toLocaleString("ja-JP") ?? "—", detail(cond.ySteps, "歩")),
    metricHTML("昨日の運動", cond.yExerciseMin?.toLocaleString("ja-JP") ?? "—", detail(cond.yExerciseMin, "分"), true),
    metricHTML("昨日の活動", cond.yActiveKcal?.toLocaleString("ja-JP") ?? "—", detail(cond.yActiveKcal, "kcal"), true)
  ].join("");
  const comment = conditionCommentText({ ...cond, yGymKg: gymKgForDate(state, shiftIso(todayIso, -1)) });
  return `<section class="instr-panel-box instr-today">${heading}<div class="instr-kpis">${kpis}</div><div class="instr-condition-text">${escapeHTML(comment)}</div></section>`;
}
function sparklineHTML(points, type, color, highlightDate = "") {
  const present = points.map((point, index) => ({ ...point, index })).filter((point) => point.value !== null);
  const max = Math.max(1, ...present.map((point) => point.value));
  const min = type === "line" ? Math.min(...present.map((point) => point.value), max) : 0;
  const coords = present.map((point) => ({ ...point, x: point.index / 6 * 100,
    y: type === "line" ? (max === min ? 14 : 25 - (point.value - min) / (max - min) * 22) : 27 - point.value / max * 24 }));
  const marks = type === "line"
    ? `<polyline fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke" points="${coords.map((p) => `${p.x},${p.y}`).join(" ")}"/>${coords.map((p) => `<circle class="instr-spark-point" data-date="${p.date}" cx="${p.x}" cy="${p.y}" r=".8" fill="${color}"/>`).join("")}`
    : coords.map((p) => `<rect class="instr-spark-point" data-date="${p.date}" x="${p.index / 7 * 100 + 2.8}" y="${p.y}" width="8.7" height="${27 - p.y}" fill="${p.date === highlightDate ? "#55d9e8" : color}"/>`).join("");
  return `<svg class="instr-spark" preserveAspectRatio="none" viewBox="0 0 100 28" width="100%" height="28" aria-hidden="true">${marks}</svg>`;
}
function weekPanelHTML(summary) {
  const number = (value) => value === null ? "—" : Math.round(value).toLocaleString("ja-JP");
  const bodySummary = summary.bodyScans.average === null ? "未記録"
    : `疲労 平均 ${summary.bodyScans.average.toFixed(1)}(最大 ${number(summary.bodyScans.max)})`;
  const line = (key, label, graph, value, extra = "") => `<div class="instr-week-row ${extra}" data-series="${key}"><span>${label}</span>${graph}<strong>${value}</strong></div>`;
  return `<section class="instr-panel-box instr-week"><h2>直近7日 <span>${shortDate(summary.from)} – ${shortDate(summary.to)} ・ 平均</span></h2>
    ${line("sleep", "睡眠", sparklineHTML(summary.sleep.points, "line", "#55d9e8"), `平均 ${durationText(summary.sleep.average)} ・ 欠測 ${summary.sleep.missing}日`)}
    ${line("steps", "歩数", sparklineHTML(summary.steps.points, "bar", "#25384d", shiftIso(summary.to, -1)), `平均 ${number(summary.steps.average)} ・ 昨日 ${number(summary.steps.yesterday)}`)}
    ${line("hrv", "HRV", sparklineHTML(summary.hrv.points, "line", "#55d9e8"), `${number(summary.hrv.first)} → ${number(summary.hrv.middle)} → ${number(summary.hrv.last)}ms`)}
    ${line("gym", "筋トレ", sparklineHTML(summary.gym.points, "bar", "#f2b84b"), `${summary.gym.count}回 ・ ${number(summary.gym.maxKg)}kg(${shortDate(summary.gym.maxDate)})`)}
    ${line("body", "身体スキャン", sparklineHTML(summary.bodyScans.points, "bar", "#25384d"), bodySummary, "instr-week-body")}
  </section>`;
}

// 期間統計は構造化セットのatだけを正本とする。日付を持たないironImport.importedTotalKgと
// ironManualBaseKgはIRON LOGの累計には残すが、週・年・月別へ配賦できないため含めない。
function ironPeriodStats(state, todayIso) {
  const logs = state?.condition?.logs || {};
  const year = todayIso.slice(0, 4);
  const yearStart = `${year}-01-01`;
  const monthCount = Number(todayIso.slice(5, 7)) || 1;
  const months = Array.from({ length: monthCount }, (_, index) => ({
    key: `${year}-${String(index + 1).padStart(2, "0")}`,
    label: `${index + 1}月`, totalKg: 0, byExercise: Object.create(null)
  }));
  const currentWeek = weekRange(todayIso);
  const activeWeeks = new Set();
  const weekDates = new Set();
  const weekByExercise = Object.create(null);
  const exercises = new Set();
  let bestSet = null;
  let weekKg = 0;
  let yearKg = 0;

  for (const entry of Object.values(logs)) {
    for (const set of Array.isArray(entry?.gym) ? entry.gym : []) {
      if (set?.deleted) continue;
      const match = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}/.exec(String(set?.at || ""));
      const date = match?.[1] || "";
      if (!date || date > todayIso) continue;
      const kg = (Number(set?.weight) || 0) * (Number(set?.reps) || 0);
      const exercise = String(set?.exercise || "その他");
      activeWeeks.add(weekRange(date).weekStart);
      if (date >= currentWeek.weekStart && date <= currentWeek.weekEnd) {
        weekKg += kg;
        weekDates.add(date);
        weekByExercise[exercise] = (weekByExercise[exercise] || 0) + kg;
      }
      const weight = Number(set?.weight) || 0;
      const reps = Number(set?.reps) || 0;
      if (!bestSet || weight > bestSet.weight || (weight === bestSet.weight && reps > bestSet.reps)) {
        bestSet = { exercise, weight, reps, date };
      }
      if (date < yearStart) continue;
      yearKg += kg;
      exercises.add(exercise);
      const month = months[Number(date.slice(5, 7)) - 1];
      if (month) {
        month.totalKg += kg;
        month.byExercise[exercise] = (month.byExercise[exercise] || 0) + kg;
      }
    }
  }

  let gymStreakWeeks = 0;
  let cursor = activeWeeks.has(currentWeek.weekStart) ? currentWeek.weekStart : addDays(currentWeek.weekStart, -7);
  while (activeWeeks.has(cursor)) {
    gymStreakWeeks++;
    cursor = addDays(cursor, -7);
  }
  return { gymStreakWeeks, weekKg, weekCount: weekDates.size, weekByExercise, bestSet,
    yearKg, months, exercises: [...exercises].sort((a, b) => a.localeCompare(b, "ja")) };
}

// ---- 描画 ----

function streakDotsHTML(last28) {
  return last28
    .map((day) => `<span class="instr-dot${day.checked ? " is-checked" : day.applicable === false ? " is-skipped" : ""}" title="${escapeHTML(day.date)}${day.applicable === false ? " (対象外)" : ""}"></span>`)
    .join("");
}

function streakPanelHTML({ className, name, meta, stats, cells, dotsLabel = "" }) {
  const metrics = cells.map((cell) => `<div class="instr-stat-cell instr-metric"><span>${cell.label}</span><strong>${cell.value}<small>${cell.unit}</small></strong></div>`).join("");
  return `<article class="instr-record-row ${className}">
    <div class="instr-record-label"><strong>${name}</strong><span>${meta}</span></div>
    <div class="instr-stats-row"><div class="instr-streak-hero instr-metric${stats.currentStreak ? "" : " is-zero"}"><span>いま</span><strong>${stats.currentStreak}<small>日連続</small></strong></div>${metrics}</div>
    ${dotsLabel ? `<div class="instr-dots" aria-label="${dotsLabel}">${streakDotsHTML(stats.last28)}</div>` : ""}
  </article>`;
}

function habitPanelsHTML(state, todayIso) {
  const rules = (state.recurrences || []).filter((rule) => !rule?.deleted && rule.streakSince).slice(0, 3);
  if (!rules.length) return '<div class="instr-empty-row">固定化したルーティンはありません(ルーティンタブで固定化すると連続記録がここに出ます)</div>';
  return rules
    .map((rule, index) => {
      const stats = habitStreakStats(rule, state.habitStreaks?.[rule.id], todayIso);
      const challenge = stats.challengeDay <= 30 ? `${stats.challengeDay}/30日目` : `達成済み(${stats.challengeDay}日目)`;
      return streakPanelHTML({
        className: `instr-habit-panel ${index === 0 ? "is-primary" : "is-secondary"}`,
        name: escapeHTML(rule.title || "固定化ルーティン"), stats,
        meta: `固定化 ${Number(rule.streakSince.slice(5, 7))}/${Number(rule.streakSince.slice(8, 10))}〜 ・ 30日チャレンジ <span class="instr-habit-challenge"><strong>${challenge}</strong></span>`,
        cells: [
          { label: "自己ベスト", value: stats.bestStreak, unit: "日" },
          { label: "累計", value: stats.totalCount, unit: "回" },
          { label: "固定化後の実施率", value: stats.successRate, unit: "%" }
        ]
      });
    }).join("");
}

function pinArchiveHTML(state) {
  let sequence = 0;
  const entries = Object.entries(state.habitPinHistory || {}).flatMap(([ruleId, periods]) =>
    (Array.isArray(periods) ? periods : [])
      .filter((period) => typeof period?.from === "string" && typeof period?.to === "string" && period.from <= period.to)
      .map((period) => ({ ruleId, period, sequence: sequence++ }))
  ).sort((a, b) => b.period.to.localeCompare(a.period.to)
    || b.period.from.localeCompare(a.period.from) || b.sequence - a.sequence);
  if (!entries.length) return "";
  const cards = entries.map(({ ruleId, period }) => {
    const rule = (state.recurrences || []).find((item) => item?.id === ruleId);
    const title = rule?.title || "(削除済みルーティン)";
    const periodKind = ["daily", "weekdays"].includes(period.kind) ? period.kind : rule?.kind;
    const stats = habitStreakPeriodStats(
      { kind: ["daily", "weekdays"].includes(periodKind) ? periodKind : "daily" },
      state.habitStreaks?.[ruleId], period.from, period.to
    );
    return `<article class="instr-pin-archive-card" data-rule-id="${escapeHTML(ruleId)}">
      <h3>${escapeHTML(title)}</h3>
      <time datetime="${escapeHTML(period.from)}">${escapeHTML(period.from)} 〜 ${escapeHTML(period.to)}</time>
      <div class="instr-stats-row">
        <div class="instr-stat-cell"><span>連続BEST</span><strong>${stats.bestStreak}<small>日</small></strong></div>
        <div class="instr-stat-cell"><span>累計</span><strong>${stats.totalCount}<small>回</small></strong></div>
        <div class="instr-stat-cell"><span>実施率</span><strong>${stats.successRate}<small>%</small></strong></div>
      </div>
    </article>`;
  }).join("");
  return `<section class="instr-panel-box instr-pin-archive" aria-label="固定化の履歴">
    <h2>固定化の履歴</h2>
    <div class="instr-pin-archive-list">${cards}</div>
  </section>`;
}

function ironChartHTML(stats) {
  const maxKg = Math.max(1, ...stats.months.map((month) => month.totalKg));
  const bars = stats.months.map((month) => `<div class="instr-chart-month" data-month="${month.key}">
    <div class="instr-chart-bar${month.totalKg ? "" : " is-empty"}" title="${month.label} ${month.totalKg.toLocaleString()}kg">${stats.exercises.map((exercise, index) => {
      const kg = month.byExercise[exercise] || 0;
      return `<span data-exercise="${escapeHTML(exercise)}" style="height:${(kg / maxKg) * 100}%;background:${GRAPH_COLORS[index % GRAPH_COLORS.length]}" title="${escapeHTML(exercise)} ${kg.toLocaleString()}kg"></span>`;
    }).join("")}</div><small>${month.label}</small></div>`).join("");
  const legend = stats.exercises.length ? stats.exercises.map((exercise, index) =>
    `<span class="instr-chart-legend-item"><i style="background:${GRAPH_COLORS[index % GRAPH_COLORS.length]}"></i>${escapeHTML(exercise)}</span>`
  ).join("") : '<span class="instr-chart-empty">構造化セットの記録はまだありません</span>';
  const recent = stats.months.slice(-2).map((month) => `${month.label} ${(month.totalKg / 1000).toFixed(1)}t`).join(" ・ ");
  return `<div class="instr-chart-scroll"><div class="instr-chart">${bars}</div></div><div class="instr-chart-legend"><span>${legend}</span><span class="instr-chart-recent">${recent}</span></div>`;
}

// 新計器盤(EARLY BIRD + IRON LOGサマリ + 年間PAYLOADグラフ)。
// today-tower.js等と同じTOWERテイストの --tower-* トークンを使うため、ルートに
// "today-tower" クラスを付けてトークンをスコープ内に持ち込む(styles.cssの重複定義はしない。
// p4-interface.md §4)。
function renderInstruments() {
  const state = getState();
  const todayIso = todayISO();
  const health = cachedHealthData();
  const weekly = weekSummary(health?.days, state, todayIso);
  const eb = earlyBirdStats(state, todayIso);
  const period = ironPeriodStats(state, todayIso);
  const archivePanel = pinArchiveHTML(state);
  const earlyBirdPanel = streakPanelHTML({
    className: "instr-early-bird", name: "早起き(06:00まで)", meta: "直近28日", stats: eb,
    cells: [
      { label: "自己ベスト", value: eb.bestStreak, unit: "日" },
      { label: "今年", value: eb.yearCount, unit: "回" },
      { label: "累計", value: eb.totalCount, unit: "回" }
    ],
    dotsLabel: "早起きの直近28日"
  });
  const breakdown = Object.entries(period.weekByExercise).map(([name, kg]) => `${escapeHTML(name)} ${kg.toLocaleString()}kg`).join(" ・ ") || "今週の記録なし";
  const best = period.bestSet;
  const bestText = best ? `${escapeHTML(best.exercise)} ${best.weight.toLocaleString()}kg×${best.reps} (${Number(best.date.slice(5, 7))}/${Number(best.date.slice(8, 10))})` : "記録なし";

  return `
    <div class="today-tower instr-view${archivePanel ? " has-pin-archive" : ""}">
      ${renderHeader("計器盤", "INSTRUMENTS")}

      ${todayPanelHTML(state, todayIso, health)}

      ${weekPanelHTML(weekly)}

      <section class="instr-panel-box instr-continuation">
        <h2>継続の記録 <span>早起き ・ 固定化ルーティン ・ 累計</span></h2>
        ${earlyBirdPanel}${habitPanelsHTML(state, todayIso)}
      </section>

      <section class="instr-panel-box instr-iron-log" data-action="instruments-open-iron-log">
        <h2>筋トレの記録 <span>IRON LOG</span></h2>
        <div class="instr-stats-row instr-iron-stats">
          <div class="instr-stat-cell instr-iron-today"><span>今週</span><strong>${period.weekKg.toLocaleString()}<small>kg</small></strong></div>
          <div class="instr-stat-cell"><span>今年</span><strong>${(period.yearKg / 1000).toFixed(1)}<small>t</small></strong></div>
          <div class="instr-stat-cell"><span>今週の回数</span><strong>${period.weekCount}<small>回</small></strong></div>
        </div>
        <div class="instr-fact-row"><span>内訳</span><strong>${breakdown}</strong></div>
        <div class="instr-fact-row"><span>自己ベスト</span><strong>${bestText}</strong></div>
        <button type="button" class="instr-open-btn" data-action="instruments-open-iron-log">IRON LOG を開く ›</button>
      </section>

      <section class="instr-panel-box instr-iron-chart">
        <h2>月別の積み上げ <span>今年 ・ 種目別</span></h2>
        ${ironChartHTML(period)}
        <div class="instr-panel-foot">今年の構造化セット(at基準)のみ。日付のない過去コメント移行分は含みません</div>
      </section>

      ${archivePanel}
    </div>
  `;
}

export { configureInstruments, renderInstruments, earlyBirdStats, ironPeriodStats, weekSummary };
