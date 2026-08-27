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
// 日時のnew Date("文字列")パース禁止(iOS Safari。p4-interface.md §6)。日付の加減算は
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

// 1日分のジムセット配列から総重量kg(Σ weight × reps)を計算する。
function gymSetsTotalKg(sets) {
  if (!Array.isArray(sets)) return 0;
  return sets.reduce((sum, set) => sum + (Number(set?.weight) || 0) * (Number(set?.reps) || 0), 0);
}

// IRON LOGサマリ(p4-interface.md §3で凍結された返り値の形)。
// state.condition.logs が未定義でも落ちない。
function ironSummary(state, todayIso) {
  const conditionLogs = (state && state.condition && state.condition.logs) || {};
  const targetKg = Number(state?.settings?.ironDailyTarget) || 2000;
  const manualBaseKg = Number(state?.settings?.ironManualBaseKg) || 0;
  const importedTotalKg = Number(state?.ironImport?.importedTotalKg) || 0;

  const todayKg = gymSetsTotalKg(conditionLogs[todayIso]?.gym);

  let lifetimeKg = manualBaseKg + importedTotalKg;
  for (const date of Object.keys(conditionLogs)) {
    lifetimeKg += gymSetsTotalKg(conditionLogs[date]?.gym);
  }

  return { todayKg, targetKg, lifetimeKg };
}

const GRAPH_COLORS = [
  "var(--tower-amber)", "var(--tower-green)", "var(--tower-cyan)", "var(--tower-purple)",
  "color-mix(in srgb, var(--tower-amber) 65%, var(--tower-purple))",
  "color-mix(in srgb, var(--tower-green) 65%, var(--tower-cyan))"
];

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
  const exercises = new Set();
  let weekKg = 0;
  let yearKg = 0;

  for (const entry of Object.values(logs)) {
    for (const set of Array.isArray(entry?.gym) ? entry.gym : []) {
      const match = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}/.exec(String(set?.at || ""));
      const date = match?.[1] || "";
      if (!date || date > todayIso) continue;
      const kg = (Number(set?.weight) || 0) * (Number(set?.reps) || 0);
      activeWeeks.add(weekRange(date).weekStart);
      if (date >= currentWeek.weekStart && date <= currentWeek.weekEnd) weekKg += kg;
      if (date < yearStart) continue;
      yearKg += kg;
      const exercise = String(set?.exercise || "その他");
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
  return { gymStreakWeeks, weekKg, yearKg, months, exercises: [...exercises].sort((a, b) => a.localeCompare(b, "ja")) };
}

// ---- 描画 ----

function streakDotsHTML(last28) {
  return last28
    .map((day) => `<span class="instr-dot${day.checked ? " is-checked" : day.applicable === false ? " is-skipped" : ""}" title="${escapeHTML(day.date)}${day.applicable === false ? " (対象外)" : ""}"></span>`)
    .join("");
}

function streakPanelHTML({ className, title, subtitle, stats, cells, dotsLabel, foot }) {
  return `<section class="instr-panel-box ${className}">
        <h2>${title} <span>${subtitle}</span></h2>
        <div class="instr-streak-hero"><strong>${stats.currentStreak}</strong><span>日連続</span></div>
        <div class="instr-stats-row">${cells.map((cell) => `
          <div class="instr-stat-cell${cell.className ? ` ${cell.className}` : ""}">
            <span>${cell.label}</span><strong>${cell.value}<small>${cell.unit}</small></strong>
          </div>`).join("")}
        </div>
        <div class="instr-dots" aria-label="${dotsLabel}">${streakDotsHTML(stats.last28)}</div>
        <div class="instr-panel-foot">${foot}</div>
      </section>`;
}

function habitPanelsHTML(state, todayIso) {
  return (state.recurrences || []).filter((rule) => !rule?.deleted && rule.streakSince)
    .slice(0, 3).map((rule, index) => {
      const stats = habitStreakStats(rule, state.habitStreaks?.[rule.id], todayIso);
      const challenge = stats.challengeDay <= 30
        ? { value: `${stats.challengeDay}/30`, unit: "日目" }
        : { value: "達成済み", unit: `(${stats.challengeDay}日目)` };
      return streakPanelHTML({
        className: `instr-habit-panel ${index === 0 ? "is-primary" : "is-secondary"}`,
        title: `HABIT ${index + 1}`, subtitle: escapeHTML(rule.title || "固定化ルーティン"), stats,
        cells: [
          { label: "自己ベスト", value: stats.bestStreak, unit: "日" },
          { label: "累計", value: stats.totalCount, unit: "回" },
          { label: "30日チャレンジ", ...challenge, className: "instr-habit-challenge" }
        ],
        dotsLabel: `${escapeHTML(rule.title || "固定化ルーティン")}の直近28日`,
        foot: "直近4週(28日) — ● 達成・－ 非該当日"
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
  return `<section class="instr-panel-box instr-pin-archive" aria-label="PIN ARCHIVE">
    <h2>PIN ARCHIVE <span>固定化履歴</span></h2>
    <div class="instr-pin-archive-list">${cards}</div>
  </section>`;
}

function ironChartHTML(stats) {
  const maxKg = Math.max(1, ...stats.months.map((month) => month.totalKg));
  const bars = stats.months.map((month) => `<div class="instr-chart-month" data-month="${month.key}">
    <div class="instr-chart-bar" title="${month.label} ${month.totalKg.toLocaleString()}kg">${stats.exercises.map((exercise, index) => {
      const kg = month.byExercise[exercise] || 0;
      return `<span data-exercise="${escapeHTML(exercise)}" style="height:${(kg / maxKg) * 100}%;background:${GRAPH_COLORS[index % GRAPH_COLORS.length]}" title="${escapeHTML(exercise)} ${kg.toLocaleString()}kg"></span>`;
    }).join("")}</div><small>${month.label}</small></div>`).join("");
  const legend = stats.exercises.length ? stats.exercises.map((exercise, index) =>
    `<span class="instr-chart-legend-item"><i style="background:${GRAPH_COLORS[index % GRAPH_COLORS.length]}"></i>${escapeHTML(exercise)}</span>`
  ).join("") : '<span class="instr-chart-empty">構造化セットの記録はまだありません</span>';
  return `<div class="instr-chart-scroll"><div class="instr-chart">${bars}</div></div><div class="instr-chart-legend">${legend}</div>`;
}

// 新計器盤(EARLY BIRD + IRON LOGサマリ + 年間PAYLOADグラフ)。
// today-tower.js等と同じTOWERテイストの --tower-* トークンを使うため、ルートに
// "today-tower" クラスを付けてトークンをスコープ内に持ち込む(styles.cssの重複定義はしない。
// p4-interface.md §4)。
function renderInstruments() {
  const state = getState();
  const todayIso = todayISO();
  const eb = earlyBirdStats(state, todayIso);
  const iron = ironSummary(state, todayIso);
  const period = ironPeriodStats(state, todayIso);
  const targetPct = iron.targetKg > 0 ? Math.min(100, Math.round((iron.todayKg / iron.targetKg) * 100)) : 0;
  const earlyBirdPanel = streakPanelHTML({
    className: "instr-early-bird", title: "EARLY BIRD", subtitle: "早起き", stats: eb,
    cells: [
      { label: "自己ベスト", value: eb.bestStreak, unit: "日" },
      { label: "累計", value: eb.totalCount, unit: "回" },
      { label: "今年", value: eb.yearCount, unit: "回" }
    ],
    dotsLabel: "直近4週の達成カレンダー", foot: "直近4週(28日) — ● は早起きゲート達成日"
  });

  return `
    <div class="today-tower instr-view">
      ${renderHeader("計器盤", "INSTRUMENTS")}

      ${earlyBirdPanel}
      ${habitPanelsHTML(state, todayIso)}

      <section class="instr-panel-box instr-iron-log" data-action="instruments-open-iron-log">
        <h2>IRON LOG <span>筋トレサマリ</span></h2>
        <div class="instr-iron-today">
          <strong>${iron.todayKg.toLocaleString()}<small>kg</small></strong>
          <span>/ 目標 ${iron.targetKg.toLocaleString()}kg</span>
        </div>
        <div class="instr-iron-bar"><span style="width:${targetPct}%"></span></div>
        <div class="instr-stats-row instr-iron-stats">
          <div class="instr-stat-cell"><span>週ストリーク</span><strong>${period.gymStreakWeeks}<small>週</small></strong></div>
          <div class="instr-stat-cell"><span>今週</span><strong>${period.weekKg.toLocaleString()}<small>kg</small></strong></div>
          <div class="instr-stat-cell"><span>今年</span><strong>${period.yearKg.toLocaleString()}<small>kg</small></strong></div>
        </div>
        <div class="instr-iron-lifetime">
          <span>累計</span>
          <strong>${(iron.lifetimeKg / 1000).toFixed(1)}<small>t</small></strong>
        </div>
        <button type="button" class="instr-open-btn" data-action="instruments-open-iron-log">IRON LOGを開く ▶</button>
      </section>

      <section class="instr-panel-box instr-iron-chart">
        <h2>ANNUAL PAYLOAD <span>月別 × 種目別</span></h2>
        ${ironChartHTML(period)}
        <div class="instr-panel-foot">今年の構造化セット(at基準)のみ。日付のない過去コメント移行分は含みません</div>
      </section>

      ${pinArchiveHTML(state)}
    </div>
  `;
}

export { configureInstruments, renderInstruments, earlyBirdStats, ironSummary, ironPeriodStats };
