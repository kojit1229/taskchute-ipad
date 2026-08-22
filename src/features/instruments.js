// src/features/instruments.js(予定パス)— TaskChute Journal スリム化P4・レーンC(新計器盤)。
//
// 契約(p4-interface.md §3。dashboard.js/wish.js と同じ configureXxx(deps) DIパターンだが、
// 界面凍結書の指定どおり**他ファイルを一切importしない**(全依存はconfigureInstruments(deps)
// 経由のDIのみ。state store・ui/actions.js等への直接importはしない)。
//   deps: { getState, escapeHTML, todayISO, addDays, renderHeader, registerActions }
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
// 非目標(p4-interface.md §6): 旧計器盤の分析グラフ(ヒートマップ・相関・ドーナツ等)は
// 一切持ち込まない。app.js/styles.css/sw.js/index.html/normalizeStateへの変更もしない。
//
// characterization test: instruments-core.test.js(同ディレクトリ、ブラウザ不要)。

// ---- 依存注入(configureInstruments) ----
// 呼び出し前のフォールバック(単体で読み込んだだけでは壊れないようにするための最小スタブ。
// 実際の描画・ロジック検証はconfigureInstruments(deps)呼び出し後の値を使う)。
let getState = () => ({});
let escapeHTML = (value) => String(value ?? "");
let todayISO = () => "";
let addDays = (date) => date;
let renderHeader = (eyebrow, title) => `<h1>${eyebrow} / ${title}</h1>`;
let registerActions = () => {};

function configureInstruments(deps) {
  ({ getState, escapeHTML, todayISO, addDays, renderHeader, registerActions } = deps || {});
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

  return { currentStreak, bestStreak, totalCount, last28 };
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

  const todayKg = gymSetsTotalKg(conditionLogs[todayIso]?.gym);

  let lifetimeKg = manualBaseKg;
  for (const date of Object.keys(conditionLogs)) {
    lifetimeKg += gymSetsTotalKg(conditionLogs[date]?.gym);
  }

  return { todayKg, targetKg, lifetimeKg };
}

// ---- 描画 ----

function earlyBirdDotsHTML(last28) {
  return last28
    .map((day) => `<span class="instr-dot${day.checked ? " is-checked" : ""}" title="${escapeHTML(day.date)}"></span>`)
    .join("");
}

// 新計器盤(EARLY BIRD + IRON LOGサマリの2枚構成)。
// today-tower.js等と同じTOWERテイストの --tower-* トークンを使うため、ルートに
// "today-tower" クラスを付けてトークンをスコープ内に持ち込む(styles.cssの重複定義はしない。
// p4-interface.md §4)。
function renderInstruments() {
  const state = getState();
  const todayIso = todayISO();
  const eb = earlyBirdStats(state, todayIso);
  const iron = ironSummary(state, todayIso);
  const targetPct = iron.targetKg > 0 ? Math.min(100, Math.round((iron.todayKg / iron.targetKg) * 100)) : 0;

  return `
    <div class="today-tower instr-view">
      ${renderHeader("計器盤", "INSTRUMENTS")}

      <section class="instr-panel-box instr-early-bird">
        <h2>EARLY BIRD <span>早起き</span></h2>
        <div class="instr-streak-hero">
          <strong>${eb.currentStreak}</strong>
          <span>日連続</span>
        </div>
        <div class="instr-stats-row">
          <div class="instr-stat-cell">
            <span>自己ベスト</span>
            <strong>${eb.bestStreak}<small>日</small></strong>
          </div>
          <div class="instr-stat-cell">
            <span>累計</span>
            <strong>${eb.totalCount}<small>回</small></strong>
          </div>
        </div>
        <div class="instr-dots" aria-label="直近4週の達成カレンダー">${earlyBirdDotsHTML(eb.last28)}</div>
        <div class="instr-panel-foot">直近4週(28日) — ● は早起きゲート達成日</div>
      </section>

      <section class="instr-panel-box instr-iron-log" data-action="instruments-open-iron-log">
        <h2>IRON LOG <span>筋トレサマリ</span></h2>
        <div class="instr-iron-today">
          <strong>${iron.todayKg.toLocaleString()}<small>kg</small></strong>
          <span>/ 目標 ${iron.targetKg.toLocaleString()}kg</span>
        </div>
        <div class="instr-iron-bar"><span style="width:${targetPct}%"></span></div>
        <div class="instr-iron-lifetime">
          <span>累計</span>
          <strong>${(iron.lifetimeKg / 1000).toFixed(1)}<small>t</small></strong>
        </div>
        <button type="button" class="instr-open-btn" data-action="instruments-open-iron-log">IRON LOGを開く ▶</button>
      </section>
    </div>
  `;
}

export { configureInstruments, renderInstruments, earlyBirdStats, ironSummary };
