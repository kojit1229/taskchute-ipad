// src/features/routine.js — app.js分割・段階4-4(ルーティンタブのドメインロジック+UI+連続ルーティン
// (チェーン)+今日の庭+保護系ルーティン+過集中ブレーカー+繰り返し実体化エンジンの抽出)。
//
// 契約(prep-stage4-routine.md §7、wish.js/journal.js冒頭コメントと同じ
// configureXxx(deps)パターン):
//   1. state の再代入はしない(src/state/store.jsからlive binding importし、プロパティ変更のみ)。
//   2. escapeHTML/renderHeader/renderDateBar/todayISO/addDays/parseDate/minutesOf/timeFromDateTime/
//      pad2/nowDateTime/getCategoryColor/showToast/saveAndRender/render/setView/closeModal/renderModal/
//      blocksForDate/isTouchedBlock/WEEKDAY_LABELS/RECURRENCE_KEEP_PAST_DAYS/RECURRENCE_FUTURE_DAYS は
//      まだapp.js側に残る汎用ヘルパー・定数のため、configureRoutine(deps) による依存注入で受け取る
//      (wish.js/journal.js方式と同一)。persistLocalNoScheduleはsrc/storage/local.jsの
//      静的export(app.js非常駐の真の葉)なのでdeps注入せず直接importする(stateと同じ扱い)。
//   3. src/**/*.js を追加したら sw.js の APP_SHELL へ必ず追加し、CACHE_NAME を +1 する。
//
// 抽出元: app.js(v169時点)の以下の関数群+モジュール変数+定数。ロジックは一切変更していない
// (移動+依存注入化のみ)。
//   [今日の庭+保護系ルーティン+過集中ブレーカー+チェーンのデータ操作(Homeタブと共有、
//   prep-stage4-routine.md §1-B)]: routineRate/gardenStageRank/updateGardenLog/pruneGardenLog/
//   overdueUncheckedRoutines/anchorActivityExistsOn/computeProtectionMissedStreak/protectionRuleFor/
//   protectionStreakBadgeHTML/completeRoutineForToday/fallbackRuleFor/executeRoutineFallback/
//   fallbackButtonHTML/pendingProtectionRoutines/maybeOpenHyperfocusGate/buildHyperfocusGateModal/
//   hyperfocusGateFallback/hyperfocusGateMakeBlock/chainRunKey/findChainRun/ensureChainRun/
//   openChainRun/closeChainRun/chainStepComplete/renderChainRun
//   +今日の庭S2(タブ専用UI、§1-A): gardenPixelCalendarHTML/gardenPixelRank/addMonthsKey/
//   gardenPixelDayAriaLabel + モジュール定数GARDEN_LOG_KEEP_DAYS/GARDEN_STAGE_YOUNG_PCT
//   (元はapp.js冒頭、routine.js以外から参照されないためここへ移動)。
//   [繰り返し実体化エンジン、§1-C]: recurrenceMatchesDate/makeRecurrenceInstance/
//   findActiveDuplicateRecurrenceRule/createRecurrenceRule/triggerAnchorPlacements/maintainRecurrences。
//   isTouchedBlock/removeUntouchedInstances/recurrenceKindLabel/inferRecurrenceKind/
//   migrateRecurrencesIfNeeded はTimeline側(Block編集モーダル・旧データ移行)専用のためapp.js残留
//   (§9参照、下記コメントで詳述)。
//   [タブ本体+チェーンUI、§1-A]: renderRoutine/chainSectionHTML/anchorLabelFor/chainCardHTML/
//   renderRoutineCard/renderRoutineNowMarker/openRoutineForWeekday/bulkCheckRoutinesUpToNow/
//   openChainEditor/anchorCandidateOptions/parseChainStepsText/chainStepsToText/buildChainModal/
//   saveChainFromModal/deleteChain。
//
// 監督者裁定・逸脱点(完了報告に詳細記載):
//   a) createRecurrenceRule/maintainRecurrences/triggerAnchorPlacements/makeRecurrenceInstance を
//      実grepしたところ、saveBlockFromModal(Timeline Block編集モーダル、app.js残留)・importData・
//      runDailyOpen・configureGithubSync(deps)からも呼ばれることを確認した(prep-stage4-routine.md
//      §9が「呼び出し元未確認」としていた懸念の実測結果)。app.js側はwish.js/journal.js
//      と同じ「src/features/*.jsから静的importして直接呼ぶ」既存パターンをそのまま踏襲でき、
//      routine.js側からTimeline側への逆依存は発生しない(循環importにならない)ため、エンジンは
//      移動する判断とした(app.js残置案は不要と判断)。
//   b) anchorCandidateOptions(チェーン編集モーダル専用として調査されていた)は、実grepで
//      buildBlockModal(Timeline Block編集モーダルのアンカー選択、app.js残留)からも呼ばれることが
//      判明した。これもexportしてapp.js側からimportする既存パターンで解決した。
//   c) recurrenceMatchesDate(設計書の§1-C表に未掲載)はmaintainRecurrences専用の純粋関数のため、
//      エンジンと一緒に移動対象へ追加した。
//   d) renderMain(app.js残留)が_activeChainId(チェーン進行中フラグ)を直接読んでいた
//      (「_activeChainIdは4関数のみで完結」という設計書の前提から漏れていた実際の参照箇所)。
//      モジュール変数自体を露出させず、新設のisChainRunActive()を経由させることで解決した。
//   e) click dispatcher(app.js残留)のgarden-pixel-monthアクションが_gardenPixelMonth/
//      _gardenPixelMonthNavigatedを直接書き換えていた(同じく設計書に未記載の参照箇所)。新設の
//      navigateGardenPixelMonth(delta)へロジックをそのまま移し、dispatcher側は1行の呼び出しに
//      変えた(ロジック自体は無改変)。
//
// characterization test: tests/routine-core.test.js。

import { state } from "../state/store.js";
import { persistLocalNoSchedule } from "../storage/local.js";
import { registerActions } from "../ui/actions.js";

// ---- 依存注入(configureRoutine) ----
let escapeHTML, renderHeader, renderDateBar, todayISO, addDays, parseDate;
let minutesOf, timeFromDateTime, pad2, nowDateTime, getCategoryColor;
let showToast, saveAndRender, render, setView, closeModal, renderModal;
let blocksForDate, isTouchedBlock, WEEKDAY_LABELS;
let RECURRENCE_KEEP_PAST_DAYS, RECURRENCE_FUTURE_DAYS;
let aiInsightsPanelHTML = () => "";

function configureRoutine(deps) {
  ({
    escapeHTML, renderHeader, renderDateBar, todayISO, addDays, parseDate,
    minutesOf, timeFromDateTime, pad2, nowDateTime, getCategoryColor,
    showToast, saveAndRender, render, setView, closeModal, renderModal,
    blocksForDate, isTouchedBlock, WEEKDAY_LABELS,
    RECURRENCE_KEEP_PAST_DAYS, RECURRENCE_FUTURE_DAYS
  } = deps);
  aiInsightsPanelHTML = deps.aiInsightsPanelHTML || (() => "");
  // v173: app.js分割・段階5-2(prep-stage5-dispatcher.md案A)。click dispatcherのルーティンタブ+
  // 今日の庭+過集中ゲート+連続ルーティン(チェーン)分岐をレジストリへ移行する(ロジック無改変)。
  // body-scan-*(ポモドーロ身体スキャン、別ドメイン・未抽出)は対象外(app.js残留)。
  registerActions({
    "routine-mode": (ctx) => {
      state.routineViewMode = ctx.target.dataset.mode || "routine";
      persistLocalNoSchedule();
      render();
    },
    "garden-pixel-month": (ctx) => {
      navigateGardenPixelMonth(Number(ctx.target.dataset.delta || 0));
      render();
    },
    "routine-bulk-check": () => bulkCheckRoutinesUpToNow(),
    "routine-fallback": (ctx) => executeRoutineFallback(ctx.id),
    "hyperfocus-gate-fallback": (ctx) => hyperfocusGateFallback(ctx.id),
    "hyperfocus-gate-make-block": (ctx) => hyperfocusGateMakeBlock(ctx.id),
    "hyperfocus-gate-later": () => closeModal(),
    "chain-run-open": (ctx) => openChainRun(ctx.id),
    "chain-step-complete": () => chainStepComplete(),
    "chain-run-close": () => closeChainRun(),
    "chain-new": () => openChainEditor(""),
    "chain-edit": (ctx) => openChainEditor(ctx.id),
    "routine-clear-day": () => {
      state.settings.routineDayFilter = null;
      persistLocalNoSchedule();
      render();
    }
  });
}

// v115: 連続ルーティン(チェーン、提案G②)進行中フラグ。他機能から参照されないモジュール
// プライベート変数だが、renderMain(app.js残留、全ビューに優先するフルスクリーン判定)だけは
// このフラグの有無を読む必要があるため、変数自体は露出させずisChainRunActive()を経由させる
// (上記「監督者裁定・逸脱点 d)」参照)。
let _activeChainId = "";

// ---- ここから抽出したコード本体(app.js:v169時点から移動。ロジック無改変) ----

// v153: 今日の庭(ADHD支援、罰なしゲーミフィケーション。設計書§③④)。gardenLogの保持上限
// (13ヶ月=月間ピクセルの参照レンジを安全に超える幅)と、段階(土/芽/若木/開花)を分ける
// 閾値を1箇所に集約する(罰なしルール③「閾値は定数1箇所に」)。
const GARDEN_LOG_KEEP_DAYS = 400;
const GARDEN_STAGE_YOUNG_PCT = 50;  // これ未満=芽(薄緑)、これ以上=若木(緑)。全完了のみ開花(濃緑)

// v33: ルーティン実行率
function routineRate(blocks) {
  // 率計器は計画Blockの消化を測るため、実績記録専用のoneTap Blockは除外する。
  const list = blocks.filter((b) => b.category === "ルーティン" && !b.oneTap);
  const done = list.filter((b) => b.completed).length;
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}

// v153: 今日の庭。routineRate()の戻り値({done,total,pct})から段階ランクを導く
// (新しい完了率計算は書かない、既存routineRate()の再利用。設計書§③)。
//   -1 = 非表示(その日のルーティンが0件) / 0 = 土(達成0件、罰なし=中立表示)
//    1 = 芽(薄緑、1件以上かつpct<GARDEN_STAGE_YOUNG_PCT) / 2 = 若木(緑、pct以上かつ未全完了)
//    3 = 開花(濃緑、全完了。※decisions.md 2026-07-27 K確定の段階配色(薄緑/緑/濃緑)をS1にも適用)
function gardenStageRank(rate) {
  if (!rate.total) return -1;
  if (!rate.done) return 0;
  if (rate.pct < GARDEN_STAGE_YOUNG_PCT) return 1;
  return rate.done < rate.total ? 2 : 3;
}

// v153: saveState()の唯一のフックから呼ばれ、指定日のルーティン完了スナップショットを
// state.gardenLogへupsertする。悪化上書き禁止(罰なしルール①のデータ層版、2系統レビュー対応
// 2026-07-28): 繰り返し実体がRECURRENCE_KEEP_PAST_DAYS超過でpurgeされて分母(total)が縮む、
// または当日中に完了を取り消してdoneが減る、いずれの場合もgardenLog(データ層)は下げない。
// 初版は「done/totalとも既存値未満なら据え置き」という一括ガードだったが、done同値・total縮小
// (例: 既存{done:4,total:5}に対し実体purgeで再計算{done:4,total:4})だとガードを素通りして
// 4/5(80%)が4/4(100%=全完了)へ改竄される穴があった(両レビュー一致で指摘)。
// フィールド別max(設計書§③「doneの大きい方を採用」と同じ加点式マージ思想をtotalにも適用)へ
// 修正し、done/totalそれぞれ独立に「今まで見た最大値」を保持するようにした。
function updateGardenLog(dateISO) {
  if (!state.gardenLog || typeof state.gardenLog !== "object") state.gardenLog = {};
  const r = routineRate(blocksForDate(dateISO));
  const existing = state.gardenLog[dateISO];
  // レビュー対応: ルーティン0件の日にまで空エントリ{0,0}を書き込むと、選択日移動のたびに
  // GARDEN_LOG_KEEP_DAYS分の無駄なキーが積み上がる。何も記録すべきものが無い(total===0)かつ
  // 既存エントリも無いなら、何もせず抜ける(既存エントリがある場合はmaxマージへ進み、
  // 既存の非ゼロ値を保持する)。
  if (!r.total && !existing) return;
  state.gardenLog[dateISO] = {
    done: Math.max(r.done, existing?.done ?? 0),
    total: Math.max(r.total, existing?.total ?? 0)
  };
}

// v153: gardenLogの保持上限(GARDEN_LOG_KEEP_DAYS)超過分をprune(既存KEEP_DAYS系の慣例)。
function pruneGardenLog() {
  if (!state.gardenLog) return;
  const cutoff = addDays(todayISO(), -GARDEN_LOG_KEEP_DAYS);
  for (const key of Object.keys(state.gardenLog)) {
    if (key < cutoff) delete state.gardenLog[key];
  }
}

// v155: 今日の庭 S2(月間ピクセル、ルーティンタブ先頭)。表示中の月("YYYY-MM")。
// _triageCurrentCardId等と同じ「純粋なUI状態は非永続」の扱い(stateに乗せるとpersist/sync
// 対象が無駄に増えるため意図的にモジュール変数)。実際の巻き戻し挙動はgardenPixelCalendarHTML()
// 側のロジック(下記_gardenPixelMonthNavigatedとの組み合わせ)を参照——「タブ再訪・リロードで
// 常に当月へ戻る」わけではなく、「ユーザーが月送り操作をしていない間は、保持月が当月より
// 過去になった時点(=PWAを開きっぱなしのまま月をまたいだ場合を含む)で当月へ同期し直す」。
let _gardenPixelMonth = null;
// v155レビュー対応(2026-07-28、Codex指摘): 月送り操作をしたかどうかのフラグ。falseの間は
// gardenPixelCalendarHTML()が保持月を都度当月へ同期し直す(月跨ぎバグの修正)。一度でも
// 月送り操作をした後はtrueのままにし、ユーザーが選んだ過去月表示を自動では戻さない
// (通常のカレンダーアプリの慣習どおり、明示操作後の位置は尊重する)。
let _gardenPixelMonthNavigated = false;

// v155: 今日の庭 S2。指定日のgardenLogスナップショットから段階ランクを返す(新しい完了率
// 計算はせず、既存gardenStageRank()を再利用)。エントリなし/total===0/done===0はいずれも
// -1にまとめ、呼び出し側で「空白セル」として何も描画しない(decisions.md 2026-07-27 K確定
// 「0件の日は空白のまま」=罰なしルール②のピクセル版。S1の「土」表示とは異なり、S2は
// 沈黙そのものが未達日の表現)。
function gardenPixelRank(dateISO) {
  const entry = state.gardenLog && state.gardenLog[dateISO];
  if (!entry || !entry.total || !entry.done) return -1;
  const pct = Math.round((entry.done / entry.total) * 100);
  return gardenStageRank({ done: entry.done, total: entry.total, pct });
}

// v155: "YYYY-MM"同士の月加減算。addDays/parseDateと同じ思想で、文字列パース
// (new Date("文字列")、iOS Safari UTC誤解釈の原因)を経由せず数値コンストラクタのみを使う。
function addMonthsKey(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

// v155レビュー対応(2026-07-28): VoiceOver向けの日別aria-label。加点表現のみ(罰なしルール⑥を
// aria文言にも適用)。0件・記録なしの日は日付だけを読み上げ、否定語(「未達」「できなかった」等)
// は一切含めない。
function gardenPixelDayAriaLabel(month, day, rank) {
  const base = `${month}月${day}日`;
  if (rank === 3) return `${base} 全部できた`;
  if (rank === 2) return `${base} 半分以上できた`;
  if (rank === 1) return `${base} 少しできた`;
  return base;
}

// v155: 今日の庭 S2(月間ピクセル)。ルーティンタブ(renderRoutine())先頭に置く月間カレンダー
// (設計書§②配置指定)。設計書§④は「達成順の累積方式」(モチーフ絵に穴を見せない方式)を
// 本命としていたが、decisions.md 2026-07-27でK確定した点灯仕様は「完了1件=薄緑/50%以上=緑/
// 全完了=濃緑、0件の日は空白」という**段階表示**で、これは実カレンダー(日付位置固定)前提の
// 仕様(累積方式には「50%以上」等の段階概念がそもそも無い)。今回はK確定のこの仕様をそのまま
// 実装し、累積方式・モチーフ絵は不採用にした(詳細は完了報告の「設計書S2との差分」に記載)。
// 未達日(rank<=0、gardenLogが無い日も含む)は色を塗らない=罰なしルール②の空白のまま。
function gardenPixelCalendarHTML() {
  const curMonthKey = todayISO().slice(0, 7);
  if (!_gardenPixelMonth) _gardenPixelMonth = curMonthKey;
  // v155レビュー対応(2026-07-28、Codex指摘・月跨ぎバグ): PWAを開きっぱなしのまま月をまたぐと
  // renderRoutine()は都度呼ばれるだけで_gardenPixelMonthは前回値のまま固定され、月初に
  // 再訪しても前月表示が残り続けていた。月送り操作をしていない初期状態でだけ、保持月が
  // 当月より過去なら当月へ同期し直す。
  if (!_gardenPixelMonthNavigated && _gardenPixelMonth < curMonthKey) _gardenPixelMonth = curMonthKey;
  const monthKey = _gardenPixelMonth;
  const [y, m] = monthKey.split("-").map(Number);
  const firstDow = new Date(y, m - 1, 1).getDay();  // 0=日曜(数値コンストラクタのみ使用)
  const numDays = new Date(y, m, 0).getDate();       // 当月の末日(「翌月0日目」の標準テクニック)
  const isCurrentMonth = monthKey === curMonthKey;

  const weekdayRow = WEEKDAY_LABELS.map((w) => `<span class="garden-pixel-weekday">${w}</span>`).join("");

  const cells = [];
  // v155レビュー対応: paddingセル(前月分の空き)はグリッド整列のためだけの装飾要素なので
  // aria-hidden="true"でVoiceOverの読み上げ対象から外す(role="list"の子として不要なitemに
  // ならないようにする)。
  for (let i = 0; i < firstDow; i++) cells.push(`<span class="garden-pixel-cell" aria-hidden="true"></span>`);
  let litCount = 0;
  for (let day = 1; day <= numDays; day++) {
    const dateISO = `${monthKey}-${pad2(day)}`;
    const rank = gardenPixelRank(dateISO);
    const cls = rank >= 1 ? ` lv${rank}` : "";
    if (rank >= 1) litCount++;
    const ariaLabel = gardenPixelDayAriaLabel(m, day, rank);
    cells.push(`<span class="garden-pixel-cell in-month${cls}" data-date="${dateISO}" role="listitem" aria-label="${ariaLabel}"></span>`);
  }

  // v155: 罰なしルール④(比較しない)。「全日点灯」という自己完結の事実だけを言う一言
  // (設計書§④「月間完成時は絵の下に1行出すのみ」のトーン踏襲。先月比較・平均比較はしない)。
  const complete = litCount > 0 && litCount === numDays
    ? `<div class="garden-pixel-complete">${m}月の庭が咲きそろった 🌸</div>` : "";

  return `<section class="panel garden-pixel-card">
    <div class="home-plabel green">庭の記録</div>
    <div class="garden-pixel-nav">
      <button class="btn ghost" data-action="garden-pixel-month" data-delta="-1" aria-label="前の月">◀</button>
      <span class="garden-pixel-month-label">${y}年${m}月</span>
      <button class="btn ghost" data-action="garden-pixel-month" data-delta="1" aria-label="次の月"${isCurrentMonth ? " disabled" : ""}>▶</button>
    </div>
    <div class="garden-pixel-weekdays" aria-hidden="true">${weekdayRow}</div>
    <div class="garden-pixel-grid" role="list" aria-label="${y}年${m}月の庭の記録">${cells.join("")}</div>
    <div class="garden-pixel-legend muted">
      <span class="garden-pixel-cell in-month lv1 swatch"></span>薄
      <span class="garden-pixel-cell in-month lv2 swatch"></span>中
      <span class="garden-pixel-cell in-month lv3 swatch"></span>濃
    </div>
    ${complete}
  </section>`;
}

// v186 F3: gardenLogは疎な履歴として扱い、記録のない日は値を作らず空欄にする。
function routineRecentSummaryHTML() {
  const today = todayISO();
  const liveRate = routineRate(blocksForDate(today));
  // v186レビュー(P2-3): 当日gardenLogのstoredスナップショットとlive routineRateを
  // フィールド別max(updateGardenLogと同じマージ思想)で合成する。live側だけを直接使うと、
  // 完了→解除(チェック取り消し)でliveのdone/totalが一時的に下がった瞬間、既にgardenLogへ
  // 記録済みの当日実績より低い値で「7日で実施できた日数」やトレンド点が退行してしまう。
  const storedToday = state.gardenLog?.[today];
  const currentRate = {
    done: Math.max(liveRate.done, Number(storedToday?.done || 0)),
    total: Math.max(liveRate.total, Number(storedToday?.total || 0))
  };
  const recentSeven = Array.from({ length: 7 }, (_, index) => addDays(today, index - 6));
  const daysDone = recentSeven.filter((date) => {
    const entry = date === today ? currentRate : state.gardenLog?.[date];
    return Number(entry?.done || 0) > 0;
  }).length;
  const recentThirty = Array.from({ length: 30 }, (_, index) => addDays(today, index - 29));
  const trend = recentThirty.map((date) => {
    const stored = state.gardenLog?.[date];
    if (!stored) return { date, pct: null };
    const entry = date === today ? currentRate : stored;
    const total = Number(entry.total || 0);
    return { date, pct: total ? Math.round(Number(entry.done || 0) / total * 100) : 0 };
  });
  return `<section class="panel routine-summary">
    <div class="home-plabel green">できた日の記録</div>
    <div class="routine-week-days">直近7日で実施できた日数 <strong>${daysDone}/7</strong></div>
    <div class="routine-trend" role="img" aria-label="記録のある日の30日実施率">
      ${trend.map((item) => item.pct == null
        ? `<span class="routine-trend-day is-missing" aria-hidden="true"></span>`
        : `<span class="routine-trend-day is-recorded" data-date="${item.date}" title="${item.date} ${item.pct}%" style="--routine-rate:${item.pct}%"><i></i></span>`).join("")}
    </div>
    <div class="muted routine-trend-note">30日実施率トレンド・記録のある日のみ</div>
  </section>`;
}

// v155: click dispatcher("garden-pixel-month"分岐、app.js残留)から呼ばれる月送りロジック本体。
// 元は dispatcher 内に直書きされていたが、_gardenPixelMonth/_gardenPixelMonthNavigated が
// このモジュールのプライベート変数になったため、書き換えをこの1関数へ集約した(ロジック自体は
// 無改変。上記「監督者裁定・逸脱点 e)」参照)。データではなく表示状態だけの変更のため
// persistLocalNoScheduleは呼ばない(元のdispatcherも呼んでいなかった)。
function navigateGardenPixelMonth(delta) {
  if (!_gardenPixelMonth) _gardenPixelMonth = todayISO().slice(0, 7);
  const next = addMonthsKey(_gardenPixelMonth, delta);
  if (next <= todayISO().slice(0, 7)) _gardenPixelMonth = next;
  _gardenPixelMonthNavigated = true;  // v155レビュー対応: 以後は当月への自動巻き戻しを止める
}

// v89: ゼロ摩擦ルーティンチェック(ROADMAP v93)。「予定時刻を過ぎているのに未チェック」の
// ルーティンBlockを返す(一括確定ボタン・提案バナー共通のソース。決定論・副作用なし)。
// plannedStartAt/nowDateTimeはどちらも"YYYY-MM-DDTHH:mm"形式のローカル文字列のため、
// Dateを経由せず文字列比較でよい(iOS Safari注意点そのまま踏襲)。
function overdueUncheckedRoutines(blocks) {
  const now = nowDateTime();
  return blocks
    .filter((b) => !b.deleted && b.category === "ルーティン" && !b.completed && b.plannedStartAt && b.plannedStartAt <= now)
    .sort((a, b) => a.plannedStartAt.localeCompare(b.plannedStartAt));
}

// v114: 保護系ルーティン(提案F、2026-07-16)。運動・睡眠・内省・家族時間など「制約
// (集中力・体力)を保護するメンテナンス工程」は実行率で裁かず、Atomic HabitsのNever miss
// twice原則(1回のミスは事故、2回目が習慣を殺す)に基づく連続欠落日数で見せる。
// 判定は loop/scripts/canary-check.py の compute_missed_streak と同じロジックのJS版
// (決定論・AI呼び出し無し)。recurrenceGroupIdでBlock群と突合する点のみ、タイトル突合の
// Python版と異なる(アプリ内はルールIDで一意に紐づくため)。
//   対象日にBlockが1件も無い → そこで打ち切り(データ欠落。それ以前は数えない)
//   1件でもcompleted=trueがある → そこで打ち切り
//   全件completed=falseなら → 連続加算して前日へ
// MAX_LOOKBACK_DAYSは canary-check.py の既定14日と揃える(無限ループ防止)。
const PROTECTION_MAX_LOOKBACK_DAYS = 14;

// v115追補(独立レビュー指摘 severity:high対応、2026-07-16): anchor付きルールは
// maintainRecurrences()で通常の日次実体化から除外されるため(アンカー元完了直後にしか
// Blockが生成されない)、「対象日にBlockが1件も無い」だけを見て即座に打ち切ると、
// アンカー元が崩れて未完了なだけの日を「データ欠落」と誤判定し、streakを過小カウントする
// (アンカー元が今日崩れているとstreak=0で警告自体が消えるHIGH指摘)。
// アンカー元(ruleの指すルーティンまたはチェーン)にその日の「活動」(ルールなら
// recurrenceGroupId一致のBlock、チェーンならchainRunsのその日のrun)が存在するかどうかで、
// 「本当のデータ欠落(アンカー元自体も動いていない日)」と「アンカー元は存在するが
// まだ完了していないだけの日」を切り分ける。完了有無ではなく存在有無で判定するのは、
// アンカー元が完了済みの日でもアンカー対象Blockが後から(RECURRENCE_KEEP_PAST_DAYS超過の
// purge等で)失われているケースを「データ欠落」と誤判定しないため(decisions.md参照)。
function anchorActivityExistsOn(anchorId, date) {
  if (!anchorId) return false;
  const hasRuleBlock = state.blocks.some((b) =>
    !b.deleted && b.recurrenceGroupId === anchorId && b.date === date);
  if (hasRuleBlock) return true;
  return Boolean(findChainRun(anchorId, date));
}

function computeProtectionMissedStreak(ruleId, targetDateISO) {
  const rule = (state.recurrences || []).find((r) => r.id === ruleId && !r.deleted);
  let date = targetDateISO;
  let missed = 0;
  for (let i = 0; i < PROTECTION_MAX_LOOKBACK_DAYS; i++) {
    const dayBlocks = state.blocks.filter((b) =>
      !b.deleted && b.recurrenceGroupId === ruleId && b.date === date);
    if (dayBlocks.some((b) => b.completed)) break;
    if (!dayBlocks.length) {
      // v115追補: anchor付きルールのみ、アンカー元の当日の活動有無で継続/打ち切りを判定する。
      // anchor無しルールは従来どおり「Blockが1件も無ければ即打ち切り」のまま(回帰なし)。
      if (rule && rule.anchor && anchorActivityExistsOn(rule.anchor, date)) {
        missed += 1;
        date = addDays(date, -1);
        continue;
      }
      break;
    }
    missed += 1;
    date = addDays(date, -1);
  }
  return missed;
}

// block(実体化されたBlock)が保護系(protection:true)の繰り返しルールに属していれば
// そのルールを返す。属していない/ルールが見つからない/削除済み/protection:falseなら null。
function protectionRuleFor(block) {
  if (!block || !block.recurrenceGroupId) return null;
  const rule = (state.recurrences || []).find((r) => r.id === block.recurrenceGroupId && !r.deleted);
  return (rule && rule.protection) ? rule : null;
}

// 保護系ルーティンの表示バッジ: 実行率%の代わりに「今日から見た連続欠落日数」を出す。
// 0〜1日は通常表示(警告なし。「1回のミスは事故」を許容)、2日以上は軽い警告色+
// 責めないトーンの復帰喚起(v93 homeRoutineCheckBannerと同じ文体を踏襲。煽り表現は使わない)。
function protectionStreakBadgeHTML(block) {
  const rule = protectionRuleFor(block);
  if (!rule) return "";
  const streak = computeProtectionMissedStreak(rule.id, todayISO());
  if (streak >= 2) {
    return `<span class="protection-badge warn" data-protection-streak="${streak}">🛡 連続${streak}日欠落・今日やれば止められます</span>`;
  }
  return `<span class="protection-badge" data-protection-streak="${streak}">🛡 連続欠落 ${streak}日</span>`;
}

// v115: 縮退版(提案G①)。指定ruleIdの「今日のBlock」を完了扱いにする共通ヘルパー
// (無ければ繰り返し実体化と同じ makeRecurrenceInstance で作ってから完了させる)。
// 縮退実行(executeRoutineFallback)・連続ルーティン(チェーン)のステップ完了の両方から呼ぶ。
// v114の連続欠落判定は「その日にcompleted:trueのBlockが1件でもあれば打ち切り」なので、
// 経路によらずこの1関数を通せば連続欠落日数がリセットされる。呼び出し後にアンカー配置
// (③、triggerAnchorPlacements)も一括で行う。
function completeRoutineForToday(ruleId, { titleSuffix = "", note = "" } = {}) {
  const rule = (state.recurrences || []).find((r) => r.id === ruleId && !r.deleted);
  if (!rule) return null;
  const today = todayISO();
  let block = state.blocks.find((b) => !b.deleted && b.recurrenceGroupId === ruleId && b.date === today);
  if (!block) {
    block = makeRecurrenceInstance(rule, today);
    state.blocks.push(block);
  }
  const blockId = block.id;
  const completionTime = nowDateTime();
  state.blocks = state.blocks.map((b) => {
    if (b.id !== blockId) return b;
    const title = titleSuffix && !b.title.includes(titleSuffix) ? `${b.title}${titleSuffix}` : b.title;
    const comment = note ? [b.comment, note].filter(Boolean).join(" / ") : b.comment;
    return { ...b, completed: true, actualEndAt: b.actualEndAt || completionTime, title, comment, updatedAt: completionTime };
  });
  triggerAnchorPlacements(ruleId, completionTime);  // v115③: このルーティンをアンカーにする後続の自動配置
  return blockId;
}

// ブロックが「縮退版が設定された繰り返しルール」に属していればそのルールを返す(無ければnull)。
function fallbackRuleFor(block) {
  if (!block || !block.recurrenceGroupId) return null;
  const rule = (state.recurrences || []).find((r) => r.id === block.recurrenceGroupId && !r.deleted);
  return (rule && rule.fallbackTitle) ? rule : null;
}

// 縮退版でルーティンを実行する。通常のBlock完了(toggleBlock)とは別経路として、タイトルに
// "(縮退版)" を付記し、コメントに縮退版の詳細(タイトル・所要分)を残す(責めない・簡潔な記録)。
function executeRoutineFallback(ruleId) {
  const rule = (state.recurrences || []).find((r) => r.id === ruleId && !r.deleted);
  if (!rule || !rule.fallbackTitle) return;
  const note = `縮退版で実行: ${rule.fallbackTitle}${rule.fallbackMinutes ? `(${rule.fallbackMinutes}分)` : ""}`;
  completeRoutineForToday(ruleId, { titleSuffix: "(縮退版)", note });
  saveAndRender(`縮退版「${rule.fallbackTitle}」で実行しました(連続記録は継続)`);
}

// 「縮退版で実行」ボタン(fallbackTitleが設定されたルールに属し、当日・未完了の時だけ表示)。
function fallbackButtonHTML(block, isToday) {
  if (!isToday || block.completed) return "";
  const rule = fallbackRuleFor(block);
  if (!rule) return "";
  const label = `${rule.fallbackTitle}${rule.fallbackMinutes ? `・${rule.fallbackMinutes}分` : ""}`;
  return `<button class="btn ghost fallback-btn" data-action="routine-fallback" data-id="${rule.id}" title="${escapeHTML(label)}">縮退版で実行</button>`;
}

// =============================================================
// v117(C): 過集中ブレーカーのゲート化。PC側のWeb Push通知(loop/hyperfocus-breaker.sh)は
// 見られず行動につながらなかった(2026-07-16 K記録)ため、アプリ内の「手が止まる瞬間」
// (Block完了操作の直後)に軽量モーダルで気づかせる方式に変える。
// 頻度ガード(90分)はモジュール変数のみで永続化しない(K指示。表示した時点を起点にする=
// 「あとで」を押さず何もしなかった場合も同じ90分抑止でよい)。
// =============================================================
let _hyperfocusGateSuppressedUntil = 0;
const HYPERFOCUS_GATE_SUPPRESS_MS = 90 * 60 * 1000;

// 当日まだ実行されていない保護系ルーティン。computeProtectionMissedStreak内の
// 「dayBlocks.some(completed)で打ち切り」と同じ条件(当日・完了記録の有無)をそのまま
// 1日分だけ再利用する(ストリーク計算自体は不要なので呼ばない)。
function pendingProtectionRoutines() {
  const today = todayISO();
  return (state.recurrences || []).filter((r) => !r.deleted && r.protection).filter((r) =>
    !state.blocks.some((b) => !b.deleted && b.recurrenceGroupId === r.id && b.date === today && b.completed));
}

// Block完了操作の直後に呼ぶ。90分の頻度ガード内、または対象ルーティンが無ければ何もしない。
function maybeOpenHyperfocusGate() {
  if (Date.now() < _hyperfocusGateSuppressedUntil) return;
  const pending = pendingProtectionRoutines();
  if (!pending.length) return;
  _hyperfocusGateSuppressedUntil = Date.now() + HYPERFOCUS_GATE_SUPPRESS_MS;  // 表示した時点で90分抑止
  state.modal = { type: "hyperfocusGate" };
  renderModal(buildHyperfocusGateModal(pending));
}

function buildHyperfocusGateModal(rules) {
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">🛡 保護ルーティンが残っています</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        ${rules.map((r) => `
          <div class="row" style="justify-content:space-between; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid var(--line)">
            <span>${escapeHTML(r.title)}</span>
            ${r.fallbackTitle
              ? `<button class="btn ghost" data-action="hyperfocus-gate-fallback" data-id="${r.id}">${escapeHTML(r.fallbackTitle)}${r.fallbackMinutes ? `・${r.fallbackMinutes}分` : ""}で実行</button>`
              : `<button class="btn ghost" data-action="hyperfocus-gate-make-block" data-id="${r.id}">Block作成</button>`}
          </div>`).join("")}
      </div>
      <div class="modal-footer">
        <button class="btn" data-action="hyperfocus-gate-later">あとで</button>
      </div>
    </div>
  `;
}

// 縮退版ワンタップ実行(既存のexecuteRoutineFallbackを再利用。保存・トーストも既存側で完結)
function hyperfocusGateFallback(ruleId) {
  executeRoutineFallback(ruleId);
  closeModal();
}

// 未実行ルーティンのBlockを作成するだけ(完了の偽装をしないため完了はさせない。既存の
// makeRecurrenceInstanceを再利用し、Timelineで通常どおり開始/完了できる状態にする)。
function hyperfocusGateMakeBlock(ruleId) {
  const rule = (state.recurrences || []).find((r) => r.id === ruleId && !r.deleted);
  closeModal();
  if (!rule) return;
  const today = todayISO();
  const already = state.blocks.some((b) => !b.deleted && b.recurrenceGroupId === ruleId && b.date === today);
  if (!already) state.blocks.push(makeRecurrenceInstance(rule, today));
  saveAndRender(`「${rule.title}」のBlockを作成しました`);
}

// =============================================================
// v115: 連続ルーティン(チェーン、提案G②)。複数の小ルーティンを順序付きで1つにまとめ、
// 開始→ステップを1つずつ表示→完了で構成要素すべてに記録を落とす(例:「朝の整えチェーン10分」
// = 目薬30秒→深呼吸2分→瞑想7分)。steps=[{id,title,estimatedMinutes}]は「タイトル文字列」で
// 既存の繰り返しルールと突合する(idでの厳密リンクではなくタイトル一致方式。
// canary-check.pyの突合方式と同じ考え方で、ステップ入力を平文テキストのままにできる。
// 判断根拠はtaskchute-notes/decisions.md参照)。
// =============================================================

function chainRunKey(chainId, date) {
  return `${chainId}_${date}`;
}

function findChainRun(chainId, date) {
  return (state.chainRuns || []).find((r) => r.id === chainRunKey(chainId, date));
}

// 今日分のrunを取得、無ければ作る(currentIndex=0から)。
function ensureChainRun(chainId) {
  state.chainRuns ||= [];
  const today = todayISO();
  let run = findChainRun(chainId, today);
  if (!run) {
    run = {
      id: chainRunKey(chainId, today), chainId, date: today, currentIndex: 0,
      scheduledStartAt: "", startedAt: "", completedAt: "", stepLog: [],
      createdAt: nowDateTime(), updatedAt: nowDateTime()
    };
    state.chainRuns.push(run);
  }
  return run;
}

// チェーンの進行(フルスクリーン、Now画面の実行コンベアと同じ「今の1件だけ」パターン)を開始/再開する。
function openChainRun(chainId) {
  const chain = (state.routineChains || []).find((c) => c.id === chainId && !c.deleted);
  if (!chain) return;
  const run = ensureChainRun(chainId);
  run.startedAt ||= nowDateTime();
  _activeChainId = chainId;
  saveAndRender();
}

function closeChainRun() {
  _activeChainId = "";
  render();
}

// 現在のステップを完了し、次のステップへ進む。全ステップ完了ならチェーン自体を完了させ、
// アンカー配置(③)もトリガーする。
function chainStepComplete() {
  if (!_activeChainId) return;
  const chain = (state.routineChains || []).find((c) => c.id === _activeChainId && !c.deleted);
  if (!chain) { _activeChainId = ""; return; }
  const run = ensureChainRun(_activeChainId);
  const step = chain.steps[run.currentIndex];
  if (!step) return;
  // タイトルが一致する既存の繰り返しルーティンがあれば、そのルールの今日のBlockも完了化する
  // (=v114の連続欠落日数がリセットされる)。一致するルールが無いステップは記録のみで良い。
  const linkedRule = (state.recurrences || []).find(
    (r) => !r.deleted && (r.title || "").trim() === (step.title || "").trim());
  if (linkedRule) completeRoutineForToday(linkedRule.id);
  run.stepLog = [...(run.stepLog || []), { stepId: step.id, completedAt: nowDateTime() }];
  run.currentIndex += 1;
  run.updatedAt = nowDateTime();
  if (run.currentIndex >= chain.steps.length) {
    run.completedAt = nowDateTime();
    _activeChainId = "";
    triggerAnchorPlacements(chain.id, run.completedAt);  // v115③: このチェーンをアンカーにする後続の自動配置
    saveAndRender(`「${chain.title}」を完了しました`);
    return;
  }
  saveAndRender();
}

function renderChainRun() {
  if (!_activeChainId) return "";
  const chain = (state.routineChains || []).find((c) => c.id === _activeChainId && !c.deleted);
  if (!chain) { _activeChainId = ""; return ""; }
  const run = ensureChainRun(_activeChainId);
  const step = chain.steps[run.currentIndex];
  const closeBtn = `<button class="now-fullscreen-close" data-action="chain-run-close" aria-label="閉じる" title="閉じる">✕</button>`;
  if (!step) {
    return `<div class="now-fullscreen" id="chainRunFullscreen">${closeBtn}
      <div class="now-fullscreen-content">
        <div class="now-eyebrow">🔗 ${escapeHTML(chain.title)}</div>
        <div class="now-empty">すべてのステップが完了しました。</div>
      </div></div>`;
  }
  return `<div class="now-fullscreen" id="chainRunFullscreen">${closeBtn}
    <div class="now-fullscreen-content">
      <div class="now-eyebrow">🔗 ${escapeHTML(chain.title)}(${run.currentIndex + 1}/${chain.steps.length})</div>
      <div class="now-title">${escapeHTML(step.title)}</div>
      ${step.estimatedMinutes ? `<div class="now-meta">目安 ${step.estimatedMinutes}分</div>` : ""}
      <div class="now-actions">
        <button class="btn green now-btn" data-action="chain-step-complete">✓ 完了して次へ</button>
      </div>
    </div>
  </div>`;
}

// renderMain(app.js残留、Now画面と並ぶ「全ビューに優先するフルスクリーン」判定)専用のアクセサ。
// _activeChainId自体は露出させない(上記コメント参照)。
function isChainRunActive() {
  return Boolean(_activeChainId);
}

// ===== v23: 繰り返しエンジン(ルール + ローリングウィンドウ materialization) =====
// 繰り返しは state.recurrences[] にルールとして保持する。表示用の Block は
// 「今日を中心とした一定期間」だけ実体化し、期間外で未編集のものは破棄する。
// これにより、以前のように 1 シリーズ 400 件を恒久保存することがなくなる。
// 期間の定数 RECURRENCE_KEEP_PAST_DAYS / RECURRENCE_FUTURE_DAYS はapp.js冒頭で定義され、
// configureRoutine(deps)経由で受け取る(src/sync/github.jsのconfigureGithubSyncと同じ理由。
// buildBlockModal等Timeline側の表示文言でも参照されるため、app.js側に定数自体は残した)。
// isTouchedBlock/removeUntouchedInstances/recurrenceKindLabel/inferRecurrenceKind/
// migrateRecurrencesIfNeededはTimeline側のBlock編集モーダル・旧データ移行専用のためapp.js残留。

// ルールが指定日付に発生するか
function recurrenceMatchesDate(rule, isoDate) {
  if (!rule || rule.deleted) return false;
  if (rule.anchorDate && isoDate < rule.anchorDate) return false;
  if (Array.isArray(rule.exceptionDates) && rule.exceptionDates.includes(isoDate)) return false;
  const d = parseDate(isoDate);
  const wd = d.getDay();  // 0=日曜
  switch (rule.kind) {
    case "daily":    return true;
    case "weekdays": return wd >= 1 && wd <= 5;
    case "weekly":   return rule.anchorDate ? wd === parseDate(rule.anchorDate).getDay() : true;
    case "monthly":  return rule.anchorDate ? d.getDate() === parseDate(rule.anchorDate).getDate() : true;
    default:         return false;
  }
}

// ルール + 日付 から表示用 Block(実体)を生成
function makeRecurrenceInstance(rule, isoDate) {
  return {
    id: `rec_${rule.id}_${isoDate}`,
    taskId: rule.taskId || "",
    date: isoDate,
    title: rule.title || "繰り返しBlock",
    category: rule.category || "",
    plannedStartAt: rule.startTime ? `${isoDate}T${rule.startTime}` : "",
    plannedEndAt: rule.endTime ? `${isoDate}T${rule.endTime}` : "",
    actualStartAt: "",
    actualEndAt: "",
    completed: false,
    // v33: ルーティンはルールの既定 充電/放電 をすべての実体に適用
    charge: rule.category === "ルーティン" ? (Number(rule.expectedCharge) || 0) : 0,
    discharge: rule.category === "ルーティン" ? (Number(rule.expectedDischarge) || 0) : 0,
    expectedCharge: rule.expectedCharge ?? "",
    expectedDischarge: rule.expectedDischarge ?? "",
    comment: "",
    recurrenceGroupId: rule.id,
    pomodoroCount: 0,
    migratedTo: "",
    carryCount: 0,  // v61: ルーティン実体は繰り越し対象外(carryableBlocksで除外)
    orderIndex: 0,
    isMIT: false,
    source: rule.source || "",
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
}

// Block(テンプレート)から新しい繰り返しルールを作成
// v108: 同タイトル・同開始時刻のアクティブな(deletedでない)繰り返しルールが既にあれば
//       新規作成しない(保存の二重発火等で同一内容のルールが重複生成される事故の再発防止、
//       2026-05-22実害・2026-07-15調査で確定)。削除済みルールは対象外(誤ブロックしない)。
function findActiveDuplicateRecurrenceRule(title, startTime) {
  const t = (title || "").trim();
  return (state.recurrences || []).find(
    (r) => !r.deleted && (r.title || "").trim() === t && (r.startTime || "") === (startTime || ""));
}

// 戻り値: 作成したルール。重複検知時は作成せず null(呼び出し側はトースト表示済みとして扱う)。
function createRecurrenceRule(block, kind) {
  const title = block.title || "繰り返しBlock";
  const startTime = block.plannedStartAt ? (block.plannedStartAt.split("T")[1] || "") : "";
  if (findActiveDuplicateRecurrenceRule(title, startTime)) {
    showToast(`「${title}」の繰り返しルールは既にあるため作成しませんでした`);
    return null;
  }
  const rule = {
    id: crypto.randomUUID(),
    title,
    category: block.category || "",
    taskId: block.taskId || "",
    kind,
    startTime,
    endTime: block.plannedEndAt ? (block.plannedEndAt.split("T")[1] || "") : "",
    anchorDate: block.date || todayISO(),
    expectedCharge: block.expectedCharge ?? "",
    expectedDischarge: block.expectedDischarge ?? "",
    source: block.source || "",
    exceptionDates: [],
    protection: false,  // v114: 保護系ルーティン(提案F)。既定false、編集モーダルでON可能
    fallbackTitle: "",  // v115: 縮退版(提案G①)。既定未設定
    fallbackMinutes: null,
    anchor: "",  // v115: アンカー(提案G③)。既定未設定
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
  state.recurrences ||= [];
  state.recurrences.push(rule);
  return rule;
}

// v115: アンカー配置(習慣スタッキング、提案G③)。anchorIdが「今日完了」したタイミングで、
// anchorがそれと一致する後続のルーティン/チェーンを直後の時刻に自動配置する。
// ルーティン側(state.recurrences)は既存の繰り返し実体化(makeRecurrenceInstance)を再利用し、
// 時刻だけ「アンカー完了時刻の1分後」に差し替える。チェーン側(state.routineChains)は
// Blockという概念を持たないため、当日分のrunにscheduledStartAtを記録するだけに留める
// (Routineタブのチェーンカードに開始目安として表示する。詳細はdecisions.md参照)。
function triggerAnchorPlacements(anchorId, completedAtDateTime) {
  if (!anchorId || !completedAtDateTime) return;
  const today = todayISO();
  const afterMin = Math.min(23 * 60 + 59, minutesOf(completedAtDateTime) + 1);
  const startTime = `${pad2(Math.floor(afterMin / 60))}:${pad2(afterMin % 60)}`;
  (state.recurrences || []).forEach((r) => {
    if (r.deleted || r.anchor !== anchorId) return;
    const already = state.blocks.some((b) => !b.deleted && b.recurrenceGroupId === r.id && b.date === today);
    if (already) return;
    const inst = makeRecurrenceInstance(r, today);
    const durMin = (r.startTime && r.endTime)
      ? Math.max(1, minutesOf(`${today}T${r.endTime}`) - minutesOf(`${today}T${r.startTime}`))
      : 10;
    const endMin = Math.min(23 * 60 + 59, afterMin + durMin);
    inst.plannedStartAt = `${today}T${startTime}`;
    inst.plannedEndAt = `${today}T${pad2(Math.floor(endMin / 60))}:${pad2(endMin % 60)}`;
    state.blocks.push(inst);
  });
  (state.routineChains || []).forEach((c) => {
    if (c.deleted || c.anchor !== anchorId) return;
    const run = ensureChainRun(c.id);
    if (!run.completedAt) run.scheduledStartAt = `${today}T${startTime}`;
  });
}

// 指定期間に繰り返し Block を実体化(既存があれば温存)。
// purge=true で「期間外 かつ 未編集」の繰り返し実体を破棄しファイルを小さく保つ。
function maintainRecurrences({ purge = false } = {}) {
  state.recurrences ||= [];
  state.blocks ||= [];
  const rules = state.recurrences.filter((r) => !r.deleted);
  const today = todayISO();
  const from = addDays(today, -RECURRENCE_KEEP_PAST_DAYS);
  const to = addDays(today, RECURRENCE_FUTURE_DAYS);
  // 既存の (ruleId + date) を索引化(削除済みも含めて重複生成を防ぐ)
  const existing = new Set();
  for (const b of state.blocks) {
    if (b.recurrenceGroupId) existing.add(`${b.recurrenceGroupId}|${b.date}`);
  }
  // 期間内の発生日を実体化
  for (const rule of rules) {
    // v115: アンカー(提案G③)を持つルールは、通常のスケジュール実体化から除外する。
    //       このルールのBlockは「アンカーが完了した直後」にtriggerAnchorPlacementsだけが
    //       生成する(=事前に毎日分が生成されてしまうと「完了直後に配置」の意味が無くなるため)。
    if (rule.anchor) continue;
    let cur = from;
    let guard = 0;
    while (cur <= to && guard < 800) {
      guard++;
      if (recurrenceMatchesDate(rule, cur) && !existing.has(`${rule.id}|${cur}`)) {
        state.blocks.push(makeRecurrenceInstance(rule, cur));
        existing.add(`${rule.id}|${cur}`);
      }
      cur = addDays(cur, 1);
    }
  }
  // 破棄: 繰り返し実体 かつ 期間外 かつ 未編集 のものを取り除く
  if (purge) {
    const ruleIds = new Set(state.recurrences.map((r) => r.id));
    state.blocks = state.blocks.filter((b) => {
      const isRecInstance = b.recurrenceGroupId && ruleIds.has(b.recurrenceGroupId);
      if (!isRecInstance) return true;                   // 通常 Block は残す
      if (b.date >= from && b.date <= to) return true;   // 期間内は残す
      if (isTouchedBlock(b)) return true;                // 実績ありは履歴として残す
      return false;                                      // 期間外・未編集は破棄
    });
  }
}

// v19: ルーティンタブ(Structured 風、上から順にいま何をするか)
function renderRoutine() {
  // 表示モード: "routine"(ルーティンのみ) / "all"(ルーティン + タイムライン Block)
  const viewMode = state.routineViewMode || "routine";
  const allBlocks = blocksForDate(state.selectedDate);
  let blocks;
  if (viewMode === "routine") {
    blocks = allBlocks.filter((b) => b.category === "ルーティン");
  } else {
    // "all" モード: ルーティン + 通常のスケジュール Block(タイムライン由来も含む)
    blocks = allBlocks.filter((b) => b.plannedStartAt);
  }
  // 開始時刻でソート
  blocks = blocks.filter((b) => b.plannedStartAt).sort((a, b) =>
    a.plannedStartAt.localeCompare(b.plannedStartAt)
  );

  // 現在時刻
  const now = new Date();
  const isToday = state.selectedDate === todayISO();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // 各 Block の位置を判定
  const enriched = blocks.map((b) => {
    const startMin = minutesOf(b.plannedStartAt);
    const endMin = b.plannedEndAt ? minutesOf(b.plannedEndAt) : startMin + 1;
    let phase = "past";  // past / current / next / future
    // v37: 完了判定を最優先(過去日を見返したとき、完了済みが「予定」表示になっていた)
    if (b.completed) {
      phase = "done";
    } else if (!isToday) {
      phase = state.selectedDate > todayISO() ? "future" : "past";
    } else if (nowMin >= startMin && nowMin < endMin) {
      phase = "current";
    } else if (nowMin < startMin) {
      phase = "future";
    } else {
      phase = "past";
    }
    return { ...b, startMin, endMin, phase, isTodayCard: isToday };  // v115: 縮退版ボタンの表示判定用
  });

  // 現在時刻の挿入位置を決定(まだ来てないBlockの直前)
  let nowInsertedAt = -1;
  if (isToday) {
    for (let i = 0; i < enriched.length; i++) {
      if (enriched[i].startMin > nowMin && nowInsertedAt < 0) {
        nowInsertedAt = i;
        break;
      }
    }
    if (nowInsertedAt < 0 && enriched.length > 0) {
      const lastBlock = enriched[enriched.length - 1];
      if (nowMin >= lastBlock.endMin) {
        nowInsertedAt = enriched.length;
      }
    }
  }

  // v40: エネルギー構造からの曜日フィルタ(該当曜日の直近日へジャンプ済み)。チップで解除可能。
  const dayFilter = state.settings.routineDayFilter;
  const dayChip = (dayFilter !== null && dayFilter !== undefined)
    ? `<div class="row" style="margin-bottom:10px; gap:8px; align-items:center">
        <span class="cat-chip" style="background:rgba(0,122,255,.12); color:var(--accent); border:1px solid rgba(0,122,255,.3)">${WEEKDAY_LABELS[dayFilter]}曜のルーティン(エネルギー構造から)</span>
        <button class="btn ghost" data-action="routine-clear-day" style="font-size:12px">解除 ✕</button>
      </div>`
    : "";

  // v89: ゼロ摩擦ルーティンチェック — viewMode(表示絞り込み)に関わらず、カテゴリ「ルーティン」の
  // 予定時刻超過・未チェックはallBlocksから常に判定する(主戦場となる一括確定ボタン)。
  const overdueRoutines = isToday ? overdueUncheckedRoutines(allBlocks) : [];

  return `
    ${renderHeader("今やること、次にやること", "ルーティン")}
    ${renderDateBar()}
    ${aiInsightsPanelHTML("routine")}
    ${gardenPixelCalendarHTML()}
    ${routineRecentSummaryHTML()}
    ${dayChip}

    <div class="segmented" style="margin-bottom:14px">
      <button class="${viewMode === "routine" ? "active" : ""}" data-action="routine-mode" data-mode="routine">↻ ルーティンのみ</button>
      <button class="${viewMode === "all" ? "active" : ""}" data-action="routine-mode" data-mode="all">↻+📅 ルーティン+予定</button>
    </div>

    ${overdueRoutines.length ? `
      <button class="btn primary" data-action="routine-bulk-check" style="width:100%; margin-bottom:14px">
        ✓ ここまで全部やった(${overdueRoutines.length}件を一括チェック)
      </button>
    ` : ""}

    ${enriched.length === 0 ? `
      <section class="panel muted" style="padding:32px; text-align:center; font-size:13px">
        ${viewMode === "routine"
          ? "カテゴリ「ルーティン」の Block がまだありません。<br>タイムラインで Block を作って、カテゴリを「ルーティン」にすると、ここに表示されます。"
          : "本日の Block がまだありません。"}
      </section>
    ` : `
      <div class="routine-stack">
        ${enriched.map((b, i) => `
          ${nowInsertedAt === i ? renderRoutineNowMarker(now) : ""}
          ${renderRoutineCard(b)}
        `).join("")}
        ${nowInsertedAt === enriched.length ? renderRoutineNowMarker(now) : ""}
      </div>
    `}

    ${chainSectionHTML()}
  `;
}

// v115: 連続ルーティン(チェーン、提案G②)の一覧セクション。ルーティンタブの末尾に表示する。
function chainSectionHTML() {
  const chains = (state.routineChains || []).filter((c) => !c.deleted);
  return `
    <section class="panel" style="margin-top:14px">
      <div class="home-plabel">🔗 連続ルーティン(チェーン)</div>
      ${chains.length
        ? chains.map((c) => chainCardHTML(c)).join("")
        : `<div class="muted" style="font-size:13px">複数の小ルーティンを1つにまとめて、開始→順送り表示→完了を一括化できます。</div>`}
      <button class="btn ghost" data-action="chain-new" style="width:100%; margin-top:8px">+ 新規チェーン</button>
    </section>
  `;
}

// アンカーid(ruleId/chainId)からラベル(タイトル)を解決する。見つからなければ空文字。
function anchorLabelFor(anchorId) {
  if (!anchorId) return "";
  const rule = (state.recurrences || []).find((r) => r.id === anchorId && !r.deleted);
  if (rule) return rule.title;
  const chain = (state.routineChains || []).find((c) => c.id === anchorId && !c.deleted);
  return chain ? chain.title : "";
}

function chainCardHTML(chain) {
  const run = findChainRun(chain.id, todayISO());
  const total = chain.steps.length;
  const done = run?.completedAt ? total : (run?.currentIndex || 0);
  const isDone = Boolean(run?.completedAt);
  const statusLabel = isDone ? "✓ 完了(今日)" : (done > 0 ? `進行中 ${done}/${total}` : "未実施(今日)");
  const btnLabel = isDone ? "" : (done > 0 ? "▶ 続きから" : "▶ 開始");
  const anchorTitle = anchorLabelFor(chain.anchor);
  return `
    <div class="chain-card" data-action="chain-edit" data-id="${chain.id}">
      <div class="chain-card-title">🔗 ${escapeHTML(chain.title)}</div>
      <div class="chain-card-steps muted" style="font-size:12px">${chain.steps.map((s) => escapeHTML(s.title)).join(" → ")}</div>
      ${anchorTitle ? `<div class="muted" style="font-size:11px">起点: ${escapeHTML(anchorTitle)}の直後</div>` : ""}
      <div class="chain-card-foot">
        <span class="chain-card-status ${isDone ? "done" : ""}">${statusLabel}</span>
        ${btnLabel ? `<button class="btn primary" data-action="chain-run-open" data-id="${chain.id}">${btnLabel}</button>` : ""}
      </div>
    </div>
  `;
}

function renderRoutineCard(block) {
  const start = block.plannedStartAt ? timeFromDateTime(block.plannedStartAt) : "—";
  const end = block.plannedEndAt ? timeFromDateTime(block.plannedEndAt) : "";
  const catColor = block.category ? getCategoryColor(block.category) : "#8E8E93";
  const phaseClass = `routine-card-${block.phase}`;
  const phaseLabel = {
    done: "✓ 完了",
    current: "▶ 進行中",
    past: "(過ぎた)",
    future: "・予定",
  }[block.phase] || "";
  const duration = block.endMin && block.startMin ? `${block.endMin - block.startMin}分` : "";
  return `
    <div class="routine-card ${phaseClass}" style="border-left:4px solid ${catColor}" data-action="edit-block" data-id="${block.id}">
      <div class="routine-card-time">
        <div class="routine-card-time-start">${start}</div>
        ${end ? `<div class="routine-card-time-end">${end}</div>` : ""}
        ${duration ? `<div class="routine-card-time-dur">${duration}</div>` : ""}
      </div>
      <div class="routine-card-body">
        <div class="routine-card-title">${escapeHTML(block.title)}</div>
        <div class="routine-card-meta">
          ${block.category ? `<span class="cat-chip" style="background:${catColor}1f; color:${catColor}; border:1px solid ${catColor}66">${escapeHTML(block.category)}</span>` : ""}
          ${protectionStreakBadgeHTML(block)}
          <span class="muted" style="font-size:11px">${phaseLabel}</span>
        </div>
        ${fallbackButtonHTML(block, block.isTodayCard)}
      </div>
      <button class="checkbox-button ${block.completed ? "done" : ""}" data-action="toggle-block" data-id="${block.id}">✓</button>
    </div>
  `;
}

function renderRoutineNowMarker(now) {
  const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  return `
    <div class="routine-now-marker">
      <span class="routine-now-dot"></span>
      <span class="routine-now-label">いま ${time}</span>
      <span class="routine-now-line"></span>
    </div>
  `;
}

// v40: エネルギー構造の曜日 finding から、その曜日の直近日へ移動して routine を見る
function openRoutineForWeekday(dayIndex) {
  if (!Number.isInteger(dayIndex)) return setView("routine");
  let d = todayISO();
  for (let i = 0; i < 7; i++) {
    if (parseDate(d).getDay() === dayIndex) break;
    d = addDays(d, -1);
  }
  state.selectedDate = d;
  state.settings.routineDayFilter = dayIndex;
  persistLocalNoSchedule();  // UI カーソル(dataModifiedAt を汚さない)
  setView("routine");
}

// v89: ゼロ摩擦ルーティンチェック — 「ここまで全部やった」一括確定(ROADMAP v93)。
// 現在時刻以前で未完了のルーティンBlockだけをまとめてcompleted化する(toggleBlockと同じ
// 副作用=taskId連動のtask status更新・actualEndAt補完を1件ずつ適用)。今日以外では発火させない
// (ボタン自体もisToday時のみ描画されるが、二重の防御として関数側にも入れておく)。
// 個別解除は既存のtoggle-block(チェックボックス)でそのまま行える——「強制しない」の方針どおり、
// 一括ONの取り消しは1件ずつのタップに委ねる。連打的な祝福演出は出さず、まとめて1回のトーストのみ
// (N件同時の完了エフェクトは視覚的にうるさく、責めない/派手すぎないトーンの方針に合わないため)。
function bulkCheckRoutinesUpToNow() {
  if (state.selectedDate !== todayISO()) return;
  const targets = overdueUncheckedRoutines(blocksForDate(state.selectedDate));
  if (!targets.length) return;
  const targetIds = new Set(targets.map((b) => b.id));
  state.blocks = state.blocks.map((block) => {
    if (!targetIds.has(block.id)) return block;
    if (block.taskId) {
      state.tasks = state.tasks.map((task) =>
        task.id === block.taskId && task.status === "todo" ? { ...task, status: "doing", updatedAt: nowDateTime() } : task);
    }
    return { ...block, completed: true, actualEndAt: block.actualEndAt || nowDateTime(), updatedAt: nowDateTime() };
  });
  saveAndRender(`${targets.length}件のルーティンをまとめて記録しました`);
}

// v115: 連続ルーティン(チェーン、提案G②)の新規作成/編集モーダル。idが空文字なら新規。
function openChainEditor(id) {
  const chain = id
    ? (state.routineChains || []).find((c) => c.id === id && !c.deleted)
    : { id: "", title: "", steps: [], anchor: "" };
  if (!chain) return;
  state.modal = { type: "chain", id: id || "" };
  renderModal(buildChainModal(chain));
}

// ---------- Chain(連続ルーティン)モーダル ---------- v115: 提案G②③

// アンカー候補(既存の繰り返しルール+他の連続ルーティン)。excludeIdで自分自身を除外する
// (idはルール・チェーンで衝突しないUUIDのため、両方まとめて1つの除外引数でよい)。
// v170実測: buildChainModal(このモジュール内)に加えて、buildBlockModal(Timeline Block編集
// モーダルのアンカー選択、app.js残留)からも呼ばれる(prep-stage4-routine.md §9の「呼び出し元
// 未確認」懸念の実測結果。上記「監督者裁定・逸脱点 b)」参照)。
function anchorCandidateOptions(excludeId) {
  const ruleOpts = (state.recurrences || [])
    .filter((r) => !r.deleted && r.id !== excludeId)
    .map((r) => ({ id: r.id, label: `↻ ${r.title}` }));
  const chainOpts = (state.routineChains || [])
    .filter((c) => !c.deleted && c.id !== excludeId)
    .map((c) => ({ id: c.id, label: `🔗 ${c.title}` }));
  return [...ruleOpts, ...chainOpts];
}

// ステップ入力(1行1ステップ「タイトル, 見積分」)⇄ steps配列の変換。
// ダイアログでの動的な行追加UIを避け、平文テキストで簡潔に入力できるようにするための往復変換。
function parseChainStepsText(text) {
  return (text || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [titlePart, minPart] = line.split(",");
    const title = (titlePart || "").trim() || "ステップ";
    const minutes = minPart !== undefined && minPart.trim() !== "" ? Number(minPart.trim()) : null;
    return { id: crypto.randomUUID(), title, estimatedMinutes: Number.isFinite(minutes) ? minutes : null };
  });
}

function chainStepsToText(steps) {
  return (steps || []).map((s) => `${s.title}${s.estimatedMinutes != null ? `, ${s.estimatedMinutes}` : ""}`).join("\n");
}

function buildChainModal(chain) {
  const isNew = !chain.id;
  const anchorOptions = anchorCandidateOptions(chain.id);
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">${isNew ? "新規チェーン" : "チェーンを編集"}</div>
      <div class="modal-body">
        <div class="field">
          <label class="field-label">タイトル</label>
          <input class="input" data-modal-field="title" value="${escapeHTML(chain.title || "")}" placeholder="例: 朝の整えチェーン10分">
        </div>
        <div class="field">
          <label class="field-label">ステップ(1行1ステップ。「タイトル, 見積分」)</label>
          <textarea class="textarea" data-modal-field="stepsText" style="min-height:100px">${escapeHTML(chainStepsToText(chain.steps))}</textarea>
          <div class="muted" style="font-size:11px; margin-top:4px">例: 目薬, 0.5 / 深呼吸, 2 / 瞑想, 7(1行ずつ)。同じタイトルの繰り返しルーティンが既にあれば、完了時にそのルーティンの連続欠落日数もリセットされます。</div>
        </div>
        <div class="field">
          <label class="field-label">アンカー(このチェーンを始める目安)</label>
          <select class="select" data-modal-field="anchor">
            <option value="" ${!chain.anchor ? "selected" : ""}>(アンカーなし。手動で開始)</option>
            ${anchorOptions.map((o) => `<option value="${o.id}" ${chain.anchor === o.id ? "selected" : ""}>${escapeHTML(o.label)}</option>`).join("")}
          </select>
          <div class="muted" style="font-size:11px; margin-top:4px">選んだルーティン/チェーンが完了した直後の時刻を、このチェーンの開始目安として自動設定します。</div>
        </div>
      </div>
      <div class="modal-footer">
        ${isNew ? "" : `<button class="btn danger" data-action="modal-delete">削除</button>`}
        <button class="btn" data-action="modal-close">キャンセル</button>
        <button class="btn primary" data-action="modal-save">保存</button>
      </div>
    </div>
  `;
}

function saveChainFromModal(id, fields) {
  const steps = parseChainStepsText(fields.stepsText);
  if (!steps.length) { showToast("ステップを1つ以上入力してください"); return; }
  const existing = id ? (state.routineChains || []).find((c) => c.id === id) : null;
  const chain = {
    id: existing ? existing.id : crypto.randomUUID(),
    title: (fields.title || "").trim() || "新規チェーン",
    steps,
    anchor: fields.anchor || "",
    createdAt: existing?.createdAt || nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
  state.routineChains ||= [];
  if (existing) {
    state.routineChains = state.routineChains.map((c) => c.id === chain.id ? chain : c);
  } else {
    state.routineChains.push(chain);
  }
  closeModal();
  saveAndRender(existing ? "チェーンを更新しました" : "チェーンを作成しました");
}

function deleteChain(id) {
  state.routineChains = (state.routineChains || []).map((c) => c.id === id
    ? { ...c, deleted: true, updatedAt: nowDateTime() } : c);
  saveAndRender("チェーンを削除しました");
}

export {
  configureRoutine,
  // 今日の庭(S1/S2)
  routineRate, gardenStageRank, updateGardenLog, pruneGardenLog,
  gardenPixelCalendarHTML, gardenPixelRank, addMonthsKey, gardenPixelDayAriaLabel,
  navigateGardenPixelMonth,
  // ゼロ摩擦チェック・保護系ルーティン・縮退版
  overdueUncheckedRoutines, anchorActivityExistsOn, computeProtectionMissedStreak,
  protectionRuleFor, protectionStreakBadgeHTML, completeRoutineForToday,
  fallbackRuleFor, executeRoutineFallback, fallbackButtonHTML,
  // 過集中ブレーカー
  pendingProtectionRoutines, maybeOpenHyperfocusGate, buildHyperfocusGateModal,
  hyperfocusGateFallback, hyperfocusGateMakeBlock,
  // 連続ルーティン(チェーン)データ操作+進行UI
  chainRunKey, findChainRun, ensureChainRun, openChainRun, closeChainRun,
  chainStepComplete, renderChainRun, isChainRunActive,
  // 繰り返し実体化エンジン
  recurrenceMatchesDate, makeRecurrenceInstance, findActiveDuplicateRecurrenceRule,
  createRecurrenceRule, triggerAnchorPlacements, maintainRecurrences,
  // タブ本体+チェーンUI
  renderRoutine, chainSectionHTML, anchorLabelFor, chainCardHTML,
  renderRoutineCard, renderRoutineNowMarker, openRoutineForWeekday, bulkCheckRoutinesUpToNow,
  openChainEditor, anchorCandidateOptions, parseChainStepsText, chainStepsToText,
  buildChainModal, saveChainFromModal, deleteChain
};
