// v164: app.js分割・段階1(最初の抽出)。純粋関数はsrc/core/**へ抽出し、依存グラフの葉として
//   importする(src/core/**はstateを一切参照しない。claude-review-result.md §7の契約)。
import { mergeById, mergeByIdPreferNewer } from "./src/core/merge.js";
// v165: app.js分割・段階2(Avoid Listの読み取り専用render抽出)。src/features/avoid.jsは
//   stateもapp.js自身もimportしない(呼び出し側が引数で渡す。src/features/avoid.js冒頭コメント参照)。
// v173: 段階5-2(dispatcher分岐のレジストリ移行)でconfigureAvoid(deps)を追加。addAvoid/deleteAvoid
//   本体は段階2の監督者裁定どおりapp.js残留のまま、dispatcher登録だけをavoid.js側へ委譲する。
import { configureAvoid, renderAvoid } from "./src/features/avoid.js";
// v166: app.js分割・段階3(state store + storage/sync gateway)。stateの再代入はsetState()
//   経由のみ(claude-review-result.md §2 Blocker-1)。store.jsは何もimportしない真の葉。
import { state, setState } from "./src/state/store.js";
// loadState/persistLocalNoScheduleはsrc/storage/local.jsへ抽出済み。saveStateはscheduleAutoSave等
// app.js側の多数の関数へ依存するためapp.js側に残す(src/storage/local.js冒頭コメント参照)。
import { loadState, persistLocalNoSchedule, _lastSaveError } from "./src/storage/local.js";
// v167: app.js分割・段階4-1(ダッシュボードの閲覧専用render抽出)。cachedFeedbackはHomeの
//   「AIから」カードとダッシュボードの共有オブジェクトのため独立モジュール化した
//   (src/state/feedback-cache.js冒頭コメント参照)。
import { cachedFeedback } from "./src/state/feedback-cache.js";
// src/features/dashboard.jsはstateをimportするがapp.js自身はimportしない(循環import回避)。
// escapeHTML/renderMarkdown等の残る汎用ヘルパーはconfigureDashboard(deps)で注入する
// (src/features/dashboard.js冒頭コメントの契約参照)。
import {
  configureDashboard,
  renderDashboard, setDashboardDate, shiftDashboardDate,
  currentDashboardDate, hydrateDashboardFeedback
} from "./src/features/dashboard.js";
// v168: app.js分割・段階4-2(WishタブTier1のCRUD・描画・月間ボードD&D抽出)。src/features/wish.js
//   はstateをimportするがapp.js自身はimportしない(循環import回避)。renderWishTriage(仕分けモード、
//   Tier3=非移動)を含む残りの汎用ヘルパーはconfigureWish(deps)で注入する
//   (src/features/wish.js冒頭コメントの契約参照)。getWishProject/nextStepOf/wishSubtaskToTasks/
//   wishHasTodayBlockはTier3側(moveBlockToWish/buildWeeklyWishModal/triageAction/triageQueue、
//   いずれもapp.js残留)からも共有importする。
import {
  configureWish,
  getWishProject, nextStepOf, wishSubtaskToTasks, wishHasTodayBlock,
  renderWish, scrollWishBoardToCurrentMonth,
  addWish, toggleWishOpen, addWishSubtask, toggleWishSubtask,
  realizeWish, unrealizeWish, deleteWish
} from "./src/features/wish.js";
// v169: app.js分割・段階4-3(ジャーナルタブ本体+コンディションOS・運動記録・お店ログ抽出)。
//   src/features/journal.jsはstateをimportするがapp.js自身はimportしない(循環import回避)。
//   ensureConditionLog(コンディションログの遅延初期化)は、journal.js側の各setXxx関数に加えて
//   app.js側のinputイベントdispatcher(data-condition-note-date分岐、夜のひとこと)からも
//   呼ばれるため、wishHasTodayBlockと同じ「journal.js側へ移しexportし、app.js側はここから
//   importして参照を切り替える」扱いにした(journal.js冒頭コメントの契約参照)。
//   _journalSegmentOverride(朝/夜/本文detailsの手動開閉オーバーライド)はclick dispatcher
//   ("toggle-journal-segment"分岐、app.js残留)とrenderJournalの両方が読み書きする共有オブジェクト
//   のため、cachedFeedbackと同じ理由でsrc/state/journal-fold.jsへ切り出し、双方からimportする。
import { _journalSegmentOverride } from "./src/state/journal-fold.js";
import {
  configureJournal,
  ensureConditionLog,
  renderJournal, ensureJournal, defaultJournal,
  setMorningEnergy, setConditionSleep, toggleConditionMeds, setConditionCapacity, setEveningMood,
  addGymEntry, deleteGymEntry,
  openStoreVisitEditor, openStoreVisitsYearModal, deleteStoreVisitWithConfirm,
  saveStoreVisitFromModal, deleteStoreVisit
} from "./src/features/journal.js";
// v170: app.js分割・段階4-4(ルーティンタブのドメインロジック+UI+連続ルーティン(チェーン)+
//   今日の庭+保護系ルーティン+過集中ブレーカー+繰り返し実体化エンジン抽出)。
//   src/features/routine.jsはstateをimportするがapp.js自身はimportしない(循環import回避)。
//   createRecurrenceRule/maintainRecurrences/triggerAnchorPlacements/anchorCandidateOptionsは
//   実grepの結果、saveBlockFromModal/buildBlockModal(Timeline Block編集モーダル)・importData・
//   runDailyOpen・configureGithubSync(deps)からも呼ばれることが判明したため、既存のimport参照
//   切替パターンで解決した(routine.js冒頭コメントの契約参照)。isChainRunActive/
//   navigateGardenPixelMonthは、renderMain・click dispatcherがモジュールプライベート変数
//   (_activeChainId/_gardenPixelMonth)を直接参照していた箇所を解消するために新設した。
import {
  configureRoutine,
  routineRate, gardenStageRank, overdueUncheckedRoutines,
  protectionStreakBadgeHTML, fallbackButtonHTML,
  updateGardenLog, pruneGardenLog, navigateGardenPixelMonth,
  maybeOpenHyperfocusGate, hyperfocusGateFallback, hyperfocusGateMakeBlock,
  renderChainRun, isChainRunActive, openChainRun, chainStepComplete, closeChainRun,
  createRecurrenceRule, maintainRecurrences, triggerAnchorPlacements, anchorCandidateOptions,
  renderRoutine, openRoutineForWeekday, bulkCheckRoutinesUpToNow,
  openChainEditor, saveChainFromModal, deleteChain, executeRoutineFallback
} from "./src/features/routine.js";
// v171: app.js分割・段階4-5(タイムライン抽出・段階A: 純粋レーン割付計算のみ)。
//   src/features/timeline-layout.jsはstateもDOMも参照しない引数のみの純粋関数だが、
//   minutesOf/nowDateTime(いずれもapp.js側の汎用ヘルパー)を呼ぶためconfigureTimelineLayout(deps)
//   による依存注入で受け取る(routine.js等と同型のパターン。src/features/timeline-layout.js
//   冒頭コメントの契約参照)。呼び出し元のrenderTimeline(app.js残留)は無改修。
import {
  configureTimelineLayout,
  assignBlocksToLanes, adjustLaneTopPositions
} from "./src/features/timeline-layout.js";
// v175: app.js分割・段階4-6(タイムライン抽出・段階B: 描画系)。prep-stage4-timeline.md §7
//   「段階B」①renderTimelineCard②renderEnergyGraph③renderTimeline/renderTimelineView/
//   renderTimelineRail/setTimelineMode。src/features/timeline.jsはstateをimportするが
//   app.js自身はimportしない(循環import回避)。draftBarHTML/zeroSecThemeBarHTML/
//   draftRejectReasonPickerHTML/renderDraftLayer(下書きスケジュール機能、別関心事のため
//   app.js残留)・render・blocksForDate・formatDisplayDate等はconfigureTimeline(deps)で注入する
//   (src/features/timeline.js冒頭コメントの契約参照)。_scheduleDraftはモジュールプライベート
//   変数を露出させず新設のscheduleDraftActive()経由でDIする(routine.jsのisChainRunActiveと
//   同じ方式)。updateBatteryTick(app.js残留)からのrenderEnergyGraph呼び出しは、この
//   importでの名前解決先切替のみで配線を維持する(呼び出し箇所は無改修)。
import {
  configureTimeline,
  renderTimelineRail, renderTimelineView, setTimelineMode, renderTimeline,
  renderTimelineCard, renderEnergyGraph
} from "./src/features/timeline.js";
// computeSyncMerge/syncCoreEqual/5フロー(saveToGitHub/runAutoSyncPush/runAutoSyncPull/
// loadFromGitHub/syncFromGitHubOnStartup)等はsrc/sync/github.jsへ抽出済み。src/sync/github.js
// 冒頭コメントの契約(configureGithubSyncによる依存注入)を参照。
import {
  configureGithubSync,
  saveToGitHub, runAutoSyncPull, loadFromGitHub, syncFromGitHubOnStartup,
  scheduleAutoSave, scheduleAutoSync,
  clearSyncBanner, _syncBanner,
  autoSaveTimer, _autoSyncTimer,
  getLastSyncPushAt, getLastSyncPullAt
} from "./src/sync/github.js";
// v172: app.js分割・段階5-1(event dispatcherのレジストリ基盤導入)。src/ui/actions.jsは
//   click dispatcher/submitModal/deleteFromModalへ「登録済みactionはレジストリ経由・未登録は
//   既存if連鎖へフォールバック」という器だけを追加する(prep-stage5-dispatcher.md案A)。
//   stateもapp.js自身もimportしない純粋なMapベースのレジストリ。v172時点ではどのfeatureも
//   まだ何も登録しないため、dispatchAction/dispatchModalSave/dispatchModalDeleteは常にfalseを
//   返し、既存if連鎖が今までどおり全件実行される(挙動は完全に無変更。action分岐の移行自体は
//   段階5-2以降)。
// v174: 段階5-3(残ドメインのaction相乗り移行)。settings/sync/core(nav)の20分岐は
//   src/features/へ未抽出のため、既存extractファイルのconfigureXxxパターンとは異なり、
//   registerActions自体をapp.jsが直接importしてこのファイル内で呼ぶ(prep-stage5-dispatcher.md
//   §4の「相乗り方式」。ハンドラ実体はapp.js内の既存関数のまま、将来featureが抽出される時に
//   登録ブロックごと一緒に移せる形にしてある)。
import {
  registerActions, dispatchAction, dispatchModalSave, dispatchModalDelete
} from "./src/ui/actions.js";

// v91: 「### 依頼」節(機械可読契約: loop/scripts/journal-requests-extract.py が検出する)。
//      ガイド文は丸括弧で囲み、抽出スクリプト側で「丸括弧だけの行は例示であり実際の依頼では
//      ない」と判定できるようにする(空欄のまま運用してもバッチが誤検出しない設計)。
//      定義位置に注意: defaultJournal() の直前ではなくファイル先頭に置く必要がある。
//      理由 = 下の `setState(loadState(normalizeState, seedState));`(旧く言えば起動処理、
//      v166でsrc/state/store.js導入に伴い記法を変更)が起動直後の同期実行で
//      normalizeState() を呼び、そこがこの定数を参照するため。normalizeState() 経由の初回呼び出し
//      はファイル末尾の起動処理(v38コメント参照)より前に走るので、const をその位置に置くと
//      TDZ(Temporal Dead Zone)で "Cannot access before initialization" となり起動不能になる
//      (JOURNAL_PROMPTS 未初期化事故の再発、v38コメント・12671行目付近参照)。
const JOURNAL_REQUEST_SECTION = [
  `### 依頼`,
  `(AIへの依頼はこの見出しの下に1行1件で書いてください。例:「相場帳のバグを直して」)`
].join("\n");

// v23: 繰り返し Block を実体化する期間(今日を基準)
const RECURRENCE_KEEP_PAST_DAYS = 7;    // 過去はこの日数だけ実体を保持
const RECURRENCE_FUTURE_DAYS = 31;      // 未来はこの日数先まで実体化

// v152: 仕分けモード(designs/03-task-swipe.md §④)のログ上限。migrationRitualLogと同じ思想。
// v166: configureGithubSync()(このすぐ下の起動処理)がこの定数を参照するため、元の宣言位置
// (5416行目付近、computeSyncMerge内で使う箇所の近く)からファイル冒頭へ移動した
// (constのTDZ回避。値・用途は一切変更していない)。
const SWIPE_TRIAGE_LOG_MAX = 200;

// v153: 今日の庭(ADHD支援、罰なしゲーミフィケーション。設計書§③④)のGARDEN_LOG_KEEP_DAYS/
// GARDEN_STAGE_YOUNG_PCTはv170でsrc/features/routine.jsへ移動した(app.js分割・段階4-4。
// routine.js以外から参照されないため、configureRoutine(deps)へは注入せずroutine.js側の
// モジュール定数として再宣言している)。

// v170: WEEKDAY_LABELS(曜日ラベル、元は9856行目付近)は、configureRoutine()
// (このすぐ下の起動処理)がこの定数を参照するため、SWIPE_TRIAGE_LOG_MAXと同じ理由で
// ファイル冒頭へ移動した(constのTDZ回避。値・用途は一切変更していない)。
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// v100: AI提案お題キュー(zeroThinking.suggestedThemes)のハウスキーピングTTL。
//       採用されないまま溜まり続けるのを防ぐため、読み込み時(normalizeState)に物理削除する
//       (2026-07-15 K指示)。adopted/dismissedは履歴表示しないため7日で消してよい判断
//       (採否の学習利用が将来必要になれば別ログへ再設計する。CHANGES_v100.md参照)。
const ZT_SUGGESTION_PENDING_TTL_MS = 3 * 24 * 60 * 60 * 1000;   // pending: 3日(72時間)
const ZT_SUGGESTION_RESOLVED_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // adopted/dismissed: 7日

// v103: 上記TTLでの物理削除本体。normalizeState() と、リモートpull時の0秒思考マージ後の
//       再剪定(mergeZeroThinkingIntoLocal、app.js後方の同期関数群を参照)の両方から呼ぶ
//       共有関数にした(合流で期限切れ候補が復活しても、この関数を再適用すれば即座に消える)。
//       localDateTimeToMs は new Date(文字列) を経由しない(iOS Safari TZ誤解釈回避、
//       既存の isWishStagnant と同じパターン)。createdAt欠損・不正値は0扱い=即時削除対象。
function pruneExpiredSuggestedThemes(list) {
  return (Array.isArray(list) ? list : []).filter((s) => {
    const ageMs = Date.now() - localDateTimeToMs(s.createdAt);
    const ttlMs = s.status === "pending" ? ZT_SUGGESTION_PENDING_TTL_MS : ZT_SUGGESTION_RESOLVED_TTL_MS;
    return ageMs <= ttlMs;
  });
}

// v71: タブ順 — 利用頻度・時間帯順に並び替え(CHANGES_v71.md参照)。
//   実行系(ホーム/タスクシュート/タイムライン/WBS/ルーティン)を先頭に、
//   日次1回系(ジャーナル/週次/日報)→参照系(計器盤/やりたい/やらない/ビジョン/0秒思考)→
//   ポモドーロ(v70でBlock開始時に自動起動するため独立タブの優先度を下げた)→設定 の順。
//   v33の順序: ホーム/ジャーナル/0秒思考/ビジョン/タスクシュート/WBS/タイムライン/
//              ルーティン/ポモドーロ/やりたい/やらない/日報/週次/計器盤/設定
const navItems = [
  { id: "home", label: "ホーム", mark: "H" },
  { id: "tasks", label: "タスクシュート", mark: "T" },
  { id: "timeline", label: "タイムライン", mark: "L" },
  { id: "wbs", label: "WBS", mark: "W" },
  { id: "routine", label: "ルーティン", mark: "↻" },
  { id: "journal", label: "ジャーナル", mark: "J" },
  { id: "weekly", label: "週次", mark: "◷" },
  { id: "reports", label: "日報", mark: "R" },
  { id: "ai-reports", label: "AIレポート", mark: "A" },  // v92: コンテンツ総括・自己分析等の月次/不定期AIレポートビューア
  { id: "dashboard", label: "ダッシュボード", mark: "D" },  // v163: 実績値ダッシュボード+AIフィードバック横並び
  { id: "stats", label: "計器盤", mark: "◔" },  // v53
  { id: "wish", label: "やりたい", mark: "✦" },
  { id: "avoid", label: "やらない", mark: "✕" },
  { id: "vision", label: "ビジョン", mark: "V" },
  { id: "zero", label: "0秒思考", mark: "○" },
  { id: "pomodoro", label: "ポモドーロ", mark: "P" },  // v70: Block開始で自動起動するため独立タブの優先度を下げた
  { id: "settings", label: "設定", mark: "S" }
];

// v82: UX監査B1 — 日課動線(朝: ホーム→ジャーナルで体調記録)を1タップにするため、
//      不定期にしか触らないWBSを「その他」へ降ろし、ジャーナルをbottom-navへ昇格した。
//      WBSはrenderMore(その他グリッド)の受け皿に含まれる(除外リストから外すだけで自動的に出る)。
const mobileNav = [
  { id: "home", label: "ホーム" },
  { id: "journal", label: "ジャーナル" },
  { id: "tasks", label: "実行" },
  { id: "timeline", label: "時間" },
  { id: "more", label: "その他" }
];

// v169: energyLevels(5段階ラベル定数)はsrc/features/journal.jsへ移動した(app.js分割・段階4-3)。

const app = document.querySelector("#app");
const sidebar = document.querySelector("#sidebar");
const main = document.querySelector("#main");
const timelineRail = document.querySelector("#timelineRail");
const bottomNav = document.querySelector("#bottomNav");
const toastEl = document.querySelector("#toast");

// v166: state本体の所有はsrc/state/store.jsへ移した。stateの初期化はここで明示的に行う
//   (store.js自身の先頭でloadStateを呼ぶとTDZ相当のリスクを生むため。store.js冒頭コメント参照)。
setState(loadState(normalizeState, seedState));
// v37: 起動時点のデータ更新時刻を退避。
//      起動同期(syncFromGitHubOnStartup)の新旧比較はこの値と行う。
//      (fetch 完了前にユーザー操作で saveState が走っても比較が壊れないように)
const _startupDataModifiedAt = state.dataModifiedAt || "";
// v166: src/sync/github.jsは循環import回避のためapp.js側の関数をimportできない
//   (src/配下からapp.jsをimportしない契約)。必要な関数・定数を1回だけ注入する。
configureGithubSync({
  normalizeState, nowDateTime, todayISO, addDays, isTouchedBlock,
  RECURRENCE_KEEP_PAST_DAYS, RECURRENCE_FUTURE_DAYS, SWIPE_TRIAGE_LOG_MAX,
  showToast, maintainRecurrences, render, runDailyOpen, saveState,
  requireGitHubConfig, fetchGitHubFileSHA, personalDataReady, personalDataFileConfig,
  gitHubContentsURL, githubHeaders, gitHubErrorMessage, fromBase64, toBase64,
  sanitizedStateForGitHub, maybeWriteBackupSnapshot, updateAutoSaveStatus, updateSyncDot,
  renderSyncBanner, pruneExpiredSuggestedThemes,
  _startupDataModifiedAt
});
// v167: src/features/dashboard.jsも同じ理由(循環import回避)で依存注入する。
configureDashboard({
  renderHeader, escapeHTML, clamp, parseDate, addDays, dateToISO, localDateTimeToMs,
  todayISO, fmtMinShort, renderMarkdown, getCategoryColor, personalDataReady,
  fetchGitHubRawResult, renderDeferringForFocus, render
});
// v168: src/features/wish.jsも同じ理由(循環import回避)で依存注入する。renderWishTriage
// (仕分けモード、Tier3)はapp.js側に残るためここで注入する(prep-stage4-wish.md §7の(a)案、
// 循環importはconfigureXxx(deps)注入のため発生しない)。
configureWish({
  escapeHTML, renderHeader, todayISO, localDateTimeToMs, makeTask, makeBlock,
  defaultPlannedTimes, showToast, nowDateTime, saveAndRender, render, updateTaskField,
  renderWishTriage
});
// v169: src/features/journal.jsも同じ理由(循環import回避)で依存注入する。renderExperimentSection
// (週次レビューと共有、app.js残留)はここで注入する(prep-stage4-journal.md §0/§4/§9 Must級、
// 「呼ぶだけで実体は移さない」をdeps注入で満たす)。
configureJournal({
  escapeHTML, renderHeader, renderDateBar, renderMarkdown, renderModal, closeModal,
  addDays, todayISO, weekRange, weekDays, showToast, nowDateTime, saveAndRender,
  personalDataReady, latestSleepLogWithin, shortSleepDate, upsertMorningLine,
  renderExperimentSection, JOURNAL_REQUEST_SECTION
});
// v170: src/features/routine.jsも同じ理由(循環import回避)で依存注入する。
// isTouchedBlock/blocksForDate/WEEKDAY_LABELS/RECURRENCE_KEEP_PAST_DAYS/RECURRENCE_FUTURE_DAYSは
// Timeline側(app.js残留)とも共有するためapp.js側に残したまま注入する
// (configureGithubSyncと同じ「複数モジュールへ同じ定数/関数を注入する」パターン)。
configureRoutine({
  escapeHTML, renderHeader, renderDateBar, todayISO, addDays, parseDate,
  minutesOf, timeFromDateTime, pad2, nowDateTime, getCategoryColor,
  showToast, saveAndRender, render, setView, closeModal, renderModal,
  blocksForDate, isTouchedBlock, WEEKDAY_LABELS,
  RECURRENCE_KEEP_PAST_DAYS, RECURRENCE_FUTURE_DAYS
});
// v171: src/features/timeline-layout.jsも同じ理由(循環import回避)で依存注入する。
configureTimelineLayout({ minutesOf, nowDateTime });
// v175: src/features/timeline.jsも同じ理由(循環import回避)で依存注入する。timelineRail/app
// (起動時に1回だけdocument.querySelectorした固定DOM参照)はtimelineRailEl/appRootElとして渡す。
configureTimeline({
  escapeHTML, getCategoryColor, migrationBadgeHTML, leverageTypeMarkHTML,
  minutesOf, todayISO, pad2, clamp, formatDisplayDate,
  renderHeader, renderDateBar,
  defaultBatterySettings, batteryCurvePoints, conditionBudget,
  draftBarHTML, zeroSecThemeBarHTML, draftRejectReasonPickerHTML, renderDraftLayer,
  scheduleDraftActive, render, blocksForDate,
  timelineRailEl: timelineRail, appRootEl: app
});
// v173: src/features/avoid.jsのdispatcher登録(段階5-2)。addAvoid/deleteAvoidはapp.js残留の
// ままなので関数参照を渡すだけ(dashboard.js等のconfigureXxxと同じ「呼ぶだけ」の注入パターン)。
configureAvoid({ addAvoid, deleteAvoid });
// v174: app.js分割・段階5-3(残ドメインのaction相乗り移行)。settings(11)+sync(8)+core/nav(1)の
// 計20分岐を、click dispatcherのif連鎖からregisterActions経由のレジストリへ移行した
// (prep-stage5-dispatcher.md §4の相乗り方式。この20件はまだsrc/features/へ抽出されていない
// ため、ハンドラは既存のapp.js関数・module変数をそのまま参照する形で登録する。ロジック自体は
// if連鎖からの機械的な移動のみで無改変)。
registerActions({
  "nav": ({ target }) => setView(target.dataset.view),
  // --- settings(11): サイドバー/WBS表示設定/カテゴリ・休憩メッセージ管理 ---
  "toggle-show-suspended": () => {
    state.settings.showSuspended = !state.settings.showSuspended;
    saveAndRender();
  },
  "toggle-wbs-hide-done": () => {
    state.settings.wbsHideCompleted = !state.settings.wbsHideCompleted;
    persistLocalNoSchedule();
    render();
  },
  "toggle-tasks-show-future": () => {
    state.settings.tasksShowFuture = !state.settings.tasksShowFuture;
    persistLocalNoSchedule();
    render();
  },
  "toggle-wbs-edit": () => {
    state.settings.wbsEditMode = !state.settings.wbsEditMode;
    persistLocalNoSchedule();
    render();
  },
  "wbs-collapse-all": () => {
    // v126: WishもWBS一覧に表示されるため、一括開閉の対象からWishだけ除く理由がなくなった
    const targets = state.projects.filter((p) => !p.deleted);
    const collapse = !targets.every((p) => p.collapsed);  // 全閉なら開く、そうでなければ閉じる
    state.projects = state.projects.map((p) =>
      !p.deleted ? { ...p, collapsed: collapse } : p);
    saveAndRender();
  },
  "add-category": () => addCategory(),
  "delete-category": ({ target }) => deleteCategory(target.dataset.catId),
  "add-break-message": () => addBreakMessage(),
  "delete-break-message": ({ target }) => deleteBreakMessage(target.dataset.msgId),
  "toggle-sidebar": () => {
    state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
    persistLocalNoSchedule();
    render();
  },
  "toggle-settings-sync": ({ target }) => {
    const parent = target.closest("details");
    if (parent) _settingsSyncOpenOverride = !parent.open;  // クリック時点ではまだ未反映のため反転
  },
  // --- sync(8): GitHub保存/読込/バックアップ/アーカイブ/デモリセット ---
  "save-github": () => saveToGitHub(),
  "load-github": () => loadFromGitHub(),
  "gate-continue": () => {
    syncGitHubFieldsFromDOM();
    if (!personalDataReady(state.settings.github)) {
      showToast("Owner・Repository・トークンをすべて入力してください");
    } else {
      render();
      syncFromGitHubOnStartup().then(() => hydrateStaticMarkdown());
    }
  },
  "reset-demo": () => resetDemoData(),
  "push-report": () => pushReportToGitHub(),
  "open-backup-list": () => openBackupListModal(),
  "restore-backup": ({ target }) => restoreBackup(target.dataset.date),
  "run-archive": () => runArchive({ manual: true })
});
let toastTimer = null;
let timerTicker = null;
// v144: エネルギーバッテリーの差分更新(updateBatteryTick)のスロットル用。
let _lastBatteryTickAt = 0;
const BATTERY_TICK_INTERVAL_MS = 60000;
// v148: 「動的にopen既定が変わるdetails」(ジャーナル朝/夜・設定「データと同期」)の手動開閉
// オーバーライド(セッション内のみ、非永続 = リロードで消える)。これらのdetailsは現在時刻や
// 同期異常の有無から既定open/closedを毎回計算するため、通常のhomeFoldSection(localStorage
// 記憶)をそのまま使うと「動的にopenのまま描画されただけで、ブラウザがdetailsの'toggle'
// イベントを自動発火する仕様(実測確認済み)」により、ユーザーが触ってもいないのに
// 『手動で開いた』扱いでlocalStorageへ永続化されてしまう(条件が変わっても二度と元に
// 戻らなくなる)。'toggle'イベントは信用せず、<summary>への本物のクリック(data-action=
// "toggle-journal-segment"/"toggle-settings-sync")だけをここへ記録し、render()時は
// 動的条件 || このオーバーライド、の優先順で使う(動的open自体は永続化しない)。
// v169: _journalSegmentOverrideはsrc/state/journal-fold.jsへ切り出し、冒頭でimportした
// (app.js分割・段階4-3。click dispatcherのtoggle-journal-segment分岐とrenderJournalの共有)。
let _settingsSyncOpenOverride = null;  // null=未操作、true/false=ユーザーが実際にクリックした最新状態
// v149レビュー対応(必須6): ホームタブの信条/寿命は「タブを開くたび既定で展開、手動で閉じたら
// そのセッション中(reloadまで)だけ閉じる」。localStorage永続のisHomeFoldOpenは使わず、
// 上記_journalSegmentOverrideと同じ非永続セッションオーバーライド方式にする。
let _homeReflectFoldOverride = {};  // { creed: bool, lifespan: bool }
let cachedVisionMd = "";
let cachedAffirmationMd = "";
// v85: ビジョンボード(45/80/nowの各PDF)はpersonal-dataリポジトリのtaskchute/content/配下にあり、
// GitHub Pages(このアプリの同一オリジン)にはv72移行時から存在しない。Contents APIから認証ヘッダ付きで
// バイナリ取得し、Blob URL化してから<object>に埋め込む(取得できるまでは埋め込まない=公開URLへの
// フォールバックはしない。壊れたsrcを一瞬でも出さないため)。
const cachedVisionPdfUrls = {};      // { 'now_vision.pdf': 'blob:...' }(取得成功後のみキーが増える)
const _visionPdfLoadInFlight = {};   // { 'now_vision.pdf': true }(多重fetch防止)
// v125: ビジョンボードは事前にページ画像(JPEG)化したものを content/vision-pages/ 配下に置き、
// manifest.json({ 'now_vision.pdf': { pages, files, w, h }, ... })でファイル一覧を持つ。
// PDFの<object>/<iframe>埋め込み(v85→v101で撤去)には戻さない。
let _visionManifest = null;          // manifest.json をパースした{ pdfファイル名: {pages,files,w,h} }。未取得はnull
let _visionManifestFailed = false;   // manifest.json 取得/パース失敗(→従来のPDF別タブ方式へフォールバック)
let _visionManifestLoadInFlight = false;
const cachedVisionPageUrls = {};     // { 'now_vision-p01.jpg': 'blob:...' }(ページ画像単位、取得成功後のみキーが増える)
const _visionPageLoadInFlight = {};  // { 'now_vision.pdf': true }(ボード単位の多重fetch防止)
// v125追補(Codex P2): ページ画像の取得失敗を追跡する。取得成功 or 再試行開始でキーを消す
// (=キーが残っている間だけ「再読み込み」ボタンを出す対象)。
const _visionPageFailed = {};        // { 'now_vision-p01.jpg': true }
// v167: cachedFeedback/dashboardSelectedDate/dashboardDateTouched/_dashboardFeedbackFetchStateは
//   src/features/dashboard.js・src/state/feedback-cache.jsへ移した(ダッシュボード抽出)。
const cachedWeeklyReviewMd = {};  // v62: { '週開始土曜YYYY-MM-DD': '...md text...' }(自宅PCバッチ生成)
// v157: AI機能1「今日の敵」。loop/scripts/today-enemy.sh が personal-data/taskchute/ へ
// 今日の敵_<date>.md(ラスボス風ナレーション1段落のプレーンテキスト)をpushする(契約は
// loop/FORMAT_CONTRACT.md「今日の敵_YYYY-MM-DD.mdの契約」)。実際の今日分のみを扱う
// (AIフィードバックのような前日1日分の無条件fetchは行わない。過去日を読み返す機能ではないため)。
const cachedTodayEnemyMd = {};  // { 'YYYY-MM-DD': '...1段落プレーンテキスト...' }
// v158: AI機能2「勝手に格言」。loop/scripts/quote-forge.sh が personal-data/taskchute/ へ
// 勝手に格言_<date>.json({"quote","author","note","date"})をpushする(契約は
// loop/FORMAT_CONTRACT.md「勝手に格言_YYYY-MM-DD.jsonの契約」)。今日の敵と同じく実際の
// 今日分のみを扱う(前日1日分の無条件fetchは行わない)。値は{quote,author}のパース済みJSON、
// またはfetch未完了/該当ファイル無し/JSONパース失敗/quote・author欠損ならundefined。
const cachedQuoteJson = {};  // { 'YYYY-MM-DD': {quote, author} | undefined }
// v159: AI機能3「未来の自分からの手紙」。loop/scripts/future-letter.sh が personal-data/taskchute/
// へ 未来からの手紙_<YYYY-MM>.md(1年後の自分視点の手紙本文プレーンテキスト)を月次でpushする
// (契約は loop/FORMAT_CONTRACT.md「未来からの手紙_YYYY-MM.mdの契約」)。ホームの導線表示は
// 「当月分の存在有無」だけを知ればよいため、今日の敵/勝手に格言と同じく実際の当月キーのみを
// セッション内で1回だけ確認する(前月以前の無条件fetchは行わない。過去の手紙自体はAIレポート
// 画面の一覧〈AI_REPORT_TYPES〉から読む導線に任せる)。
const cachedFutureLetterMd = {};  // { 'YYYY-MM': '...手紙本文...' | undefined }
// v161: AI機能第5弾(最終)「エネルギーカーブ」。loop/scripts/energy-curve.sh が
// personal-data/taskchute/ へ energy-curve.json({generatedAt,days,hourly:[{hour,count,netAvg,
// startRate}...24件]}、直近28日の完了Block実績から決定論集計した時間帯別の実行量/充放電net/
// 着手率)を**単一の上書きファイル**として日次でpushする(契約は
// loop/FORMAT_CONTRACT.md「energy-curve.jsonの契約」)。集計はバッチ側のみ(K発注仕様
// 「アプリに分析ロジックを足さない」)、アプリは描画のみ。
// 2026-07-28レビュー対応(Codex P1): today-enemy/勝手に格言のような日付キー方式(「今日分は
// 1回だけ確認」)にすると、バッチが同日中に再生成しても新しい内容が翌日まで反映されない
// (単一の上書きファイルという性質上、同じ「今日」のキーの中身が日中に変わりうるため)。
// そのため日付キーではなく**取得時刻ベースのTTLキャッシュ**にし、既存のAIフィードバック等の
// 定期再fetch機構(FEEDBACK_REFRESH_INTERVAL_MS=30分、visibilitychange復帰時 or 定期tick経由の
// maybeRefreshFeedback→hydrateStaticMarkdown)にそのまま乗せる。fetchedAt=0(初回)、または
// 前回取得から30分以上経過していれば再fetchする(成功・失敗を問わずfetchedAtは更新し、
// 失敗が続いても30分に1回だけリトライする=連打しない)。
let cachedEnergyCurveJson = { fetchedAt: 0, data: undefined };  // data: {generatedAt,days,hourly:[...]} | undefined
// v67: AI作業結果_<today>.json のパース済み配列(非永続、当日分のみ)。二重登録防止のIDは state.aiWorkProcessedIds 側で永続化する。
let cachedAiWorkResults = null;
// v74: 読書複利化 — taskchute/reading/highlights.json の books 配列(null=未取得。永続化しない、
//      他のcached*と同じくアプリ内メモリのみ。ハイライト本体は個人データリポジトリが正)
let cachedReadingHighlights = null;
// v92: AIレポートビューア(コンテンツ総括・自己分析・基盤ヘルス・週次レビューをアプリ内で横断閲覧)。
// v110: バッチ実行サマリを追加。
// taskchute/直下の一覧を取得し、種類ごとにファイル名prefixでローカルにフィルタする
// (セッションキャッシュ、手動更新ボタンでのみ再取得。自動ポーリングはしない)。
// v138: 一覧の取得元は2段(report-index.json優先→無ければContents APIディレクトリ一覧に
// フォールバック。fetchReportIndex/triggerAiReportDirLoad参照)。_aiReportDirCacheの形状は
// どちらの取得元でも{name,type:"file"}配列に揃えている。
let _aiReportDirCache = null;        // 一覧(index or Contents API)のレスポンス配列(null=未取得)
let _aiReportDirError = false;       // 直近の一覧取得が失敗したか(静かなエラー表示 + 再試行ボタン用)
let _aiReportDirLoadInFlight = false;
// v140(Codexレビュー High-1): 手動「一覧を更新」時だけtrueにするフラグ。次のtriggerAiReportDirLoad
// 呼び出しでreport-index.jsonとContents APIディレクトリ一覧の両方を取得し、name単位でunionする
// (index側が1000件超過等で一部欠落していても、手動更新時だけは即座に補完できるようにする設計)。
let _aiReportForceUnionRefresh = false;
const _aiReportBodyCache = {};       // { 'コンテンツ総括_2026-07-14.md': '...md text...' }(取得成功分のみ。失敗はここに入れない)
const _aiReportBodyLoadInFlight = {};
// v137(review.md:29): 失敗を成功キャッシュしなくなった分、render()のたびに再fetchが走ると
// 一過性の失敗が続く間API呼び出しを連打してしまう(renderAiReportBody→body===undefined→
// triggerAiReportBodyLoad→失敗→render()→…の無限ループになりうる)。feedbackHydrateと同じ
// 「直近失敗からの最短間隔」ガードで連打だけを防ぐ(手動更新ボタンはこのガードを明示的に無視する)。
const _aiReportBodyFailedAt = {};    // { fileName: Date.now() }
const AI_REPORT_BODY_RETRY_COOLDOWN_MS = 15 * 1000;
const _aiReportSelectedDate = {};    // { content: '2026-07-14', self: '2026-07', ... }(種類ごとの選択中日付)
// v77: AIフィードバック等の自動再表示(起動時fetchのみだと開きっぱなしのPWAで新着に気づけない)。
//      visibilitychange復帰時 + 定期(30分毎)にhydrateStaticMarkdownを再実行するためのスロットル状態。
//      非永続(端末内メモリのみ、再起動すれば起動時fetchからやり直しでよい)。
let _lastFeedbackHydrateAt = Date.now();  // 起動時に一度hydrateStaticMarkdown()を呼ぶため、その時刻を起点にする
let _feedbackHydrateInFlight = false;     // 多重発火防止(同時に複数fetchを走らせない)
const FEEDBACK_REFRESH_INTERVAL_MS = 30 * 60 * 1000;  // 定期再fetchの間隔(30分)
const FEEDBACK_REFRESH_MIN_GAP_MS = 60 * 1000;        // visibilitychange連打等の多重発火防止(60秒)
// v137: hydrateStaticMarkdownの新着render延期(review.md:28)。journal等の入力中に全render()が
//       走るとfocus/選択範囲/IME未確定文字が飛ぶため、(a)入力系要素にフォーカス中、または
//       (b)IME変換中(compositionstart〜compositionend)は render() を即実行せず「保留」フラグを
//       立てるだけにし、フォーカスが外れた瞬間(focusout)またはIME確定した瞬間(compositionend)に
//       1回だけ実行する。非永続(端末内メモリのみ)。
// v140(Codexレビュー Med-2/Med-3、仕様精緻化。CHANGES_v140.md参照):
//   Med-2: v137時点はcompositionend時に「フォーカスが同じ入力欄に残っていても即render」して
//     いたが、IME確定直後は続けて入力するのが通例(変換→次の単語入力、を繰り返す)ため、
//     まだフォーカスが入力欄にあるならフォーカスが外れるまで延期を継続するよう変更した
//     (未確定文字消失というv137の核心的リスクは解消したままだが、フォーカス/カーソル位置は
//     compositionendのたびに失われないほうが実際の入力体験としてより安全と判断)。
//   Med-3: compositionendイベントが何らかの理由(ブラウザ実装差・IME実装差)で発火しなかった
//     場合、_imeComposing=trueのまま固着し新着が永久に反映されなくなるリスクがあった。
//     (a) focusoutハンドラで_imeComposingを無条件クリアしてから判定する(フォーカス喪失を
//     跨いでIME変換が継続することは無いため安全)。(b) さらに保険として、延期発生から
//     DEFERRED_RENDER_FAILSAFE_MS(60秒)経過してもまだ保留中なら、500ms周期のtimerTicker
//     (startTimerTicker)からフォーカス/IME状態に関わらず強制flushする。
let _imeComposing = false;
let _deferredRenderPending = false;
let _deferredRenderPendingSince = 0;  // _deferredRenderPendingがtrueになった時刻(Date.now()、フェイルセーフ用)
const DEFERRED_RENDER_FAILSAFE_MS = 60 * 1000;
function isFocusInEditableElement() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable === true;
}
// hydrateStaticMarkdown等の「新着があれば再描画」用の入口。入力中/IME変換中なら即renderせず
// 保留し、focusout/compositionend(またはフェイルセーフのタイムアウト)で自動的に1回だけ実行させる。
function renderDeferringForFocus() {
  if (_imeComposing || isFocusInEditableElement()) {
    if (!_deferredRenderPending) _deferredRenderPendingSince = Date.now();
    _deferredRenderPending = true;
    return;
  }
  render();
}
// compositionend/focusoutの両方から呼ばれる共通の実行判定。
// 60秒以上延期され続けている場合は、取りこぼしイベントへの保険としてフォーカス/IME状態に
// 関わらず強制的に実行する(それ以外は「まだフォーカス中/IME変換中なら延期を継続」)。
function attemptFlushDeferredRender() {
  if (!_deferredRenderPending) return;
  const overdue = _deferredRenderPendingSince > 0 && (Date.now() - _deferredRenderPendingSince > DEFERRED_RENDER_FAILSAFE_MS);
  if (!overdue && (_imeComposing || isFocusInEditableElement())) return;  // まだ延期を継続
  _deferredRenderPending = false;
  _deferredRenderPendingSince = 0;
  render();
}
// v74: 自分が保存した言語化の当日分エコー表示用({ 'YYYY-MM-DD': '入力文字列' }、非永続)。
//      保存済み内容の真実は reflections.json 側。リロード時は hydrateReadingData() が再取得する
const cachedReadingReflections = {};
// v74: taskchute/reading/summary_YYYY-MM.md(月次AI要約、自宅PCバッチ生成予定・404はフェイルソフト)
const cachedReadingSummaryMd = {};

// v34: 0秒思考 — 画面内の一時状態(永続化しない)
let ztTab = "other";          // "other" | "fav"
let ztAddOpen = false;         // テーマ追加パネルの開閉
let ztCurrent = null;          // 書く画面の対象 { id, text, fav } / null=一覧
let ztSearch = "";             // 履歴検索ワード
let ztTimerInterval = null;    // 書く画面のカウントダウン
let ztTimerLeft = 60;
let ztEditId = null;           // v102: 回答済みentryの追記編集対象entry id / null=非編集
let ztWriteStartedAt = null;   // v104: 書く画面を開いた時刻(Date.now())。durationSec計測の起点 / null=非計測中

// v70: Now画面(実行コンベア)— 画面内の一時状態(永続化しない。normalizeStateは不要)
let nowMode = false;             // trueの間、renderMain()は通常ビューの代わりに全画面コンベアを描く
let _nowSkippedIds = new Set();  // このNowセッション中に「スキップ」したBlock id(セッションを抜けるとクリア)
// v70: フォーカスタイマー「中断」の理由ワンタップピッカー(チョコ停記録)。非永続。
let _pendingInterruptBlockId = null;
// v87: 宣言/終了報告モーダルが解決するまでの一時コンテキスト。非永続。
// { blockId, phase: "declare"|"report", kind: "pomodoro"|"block" }
let _pendingLifecycleCtx = null;
// v108: Block保存モーダルの二重送信ガード(iOS Safariでの保存ボタン二重発火対策)。非永続。
//       saveBlockFromModal の実行中だけ true になり、完了/失敗いずれも finally で必ず解除する。
let _blockSaveInFlight = false;
// v170: _activeChainId(連続ルーティン進行中フラグ)はsrc/features/routine.jsへ移動した
// (app.js分割・段階4-4)。renderMainはisChainRunActive()を経由して参照する(下記コメント参照)。
// v149(UI改善計画Phase4a): ホームの2タブ(今日/ホーム)切替。非永続(state外)—
// K指定「起動時は常に今日」を満たすため、リロード/再起動のたびに既定へ戻る。
let homeTab = "today";  // "today" | "home"
// v168: 月間プランニングボードのドラッグ状態(_wishDrag)はsrc/features/wish.jsへ移動した
// (app.js分割・段階4-2。wish.js冒頭コメント参照)。

// v71: ホームの折りたたみカード(details)の開閉状態。端末ローカルのUI状態であり、
//      GitHub同期やエクスポートの対象になる state オブジェクトとは意図的に分離するため、
//      専用の localStorage キーに保存する(AUTO_MORNING_PLAN_KEY等と同じ「非致命・try/catch」流儀)。
const HOME_FOLD_KEY = "taskchute-journal-home-fold-v1";
function readHomeFoldMap() {
  try { return JSON.parse(localStorage.getItem(HOME_FOLD_KEY) || "{}"); } catch { return {}; }
}
function isHomeFoldOpen(id, defaultOpen) {
  const stored = readHomeFoldMap()[id];
  return typeof stored === "boolean" ? stored : Boolean(defaultOpen);
}
function setHomeFoldOpen(id, open) {
  try {
    const map = readHomeFoldMap();
    map[id] = open;
    localStorage.setItem(HOME_FOLD_KEY, JSON.stringify(map));
  } catch { /* 保存できなくても致命的ではない(UI状態のみ) */ }
}
// 折りたたみカードの共通ラッパー。bodyHTML が空なら(非表示条件を満たさない場合)カードごと出さない。
// wrapperClass は details 自体に付与(既存の .home-creed 等のパネル装飾をそのまま活かすため)。
function homeFoldSection(id, defaultOpen, wrapperClass, summaryClass, summaryText, bodyHTML) {
  if (!bodyHTML) return "";
  const open = isHomeFoldOpen(id, defaultOpen);
  return `<details class="home-fold panel ${wrapperClass || ""}" data-fold-id="${id}" ${open ? "open" : ""}>
    <summary class="home-fold-summary ${summaryClass || ""}"><span class="home-fold-chevron">▶</span>${escapeHTML(summaryText)}</summary>
    <div class="home-fold-body">${bodyHTML}</div>
  </details>`;
}
// v149レビュー対応(必須6): homeFoldSectionのlocalStorage永続版とは別に、非永続セッション
// オーバーライド版(_homeReflectFoldOverride参照)。data-fold-idを持たない(=グローバルの
// "toggle"イベント委譲によるlocalStorage永続化を意図的に受けない)。既定は常にopen。
function homeReflectFoldSection(id, wrapperClass, summaryClass, summaryText, bodyHTML) {
  if (!bodyHTML) return "";
  const open = id in _homeReflectFoldOverride ? _homeReflectFoldOverride[id] : true;
  return `<details class="home-fold panel ${wrapperClass || ""}" ${open ? "open" : ""}>
    <summary class="home-fold-summary ${summaryClass || ""}" data-action="toggle-home-reflect-fold" data-segment="${id}"><span class="home-fold-chevron">▶</span>${escapeHTML(summaryText)}</summary>
    <div class="home-fold-body">${bodyHTML}</div>
  </details>`;
}

// v38: 起動処理(maintainRecurrences / render / 各種初期化)はファイル末尾で実行する。
//      ここで render() を呼ぶと、後方で宣言される const(JOURNAL_PROMPTS 等)が
//      未初期化のまま参照され、最後に開いていた画面によっては起動時に例外で全停止していた。

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;
  const id = target.dataset.id;

  // v172: レジストリ経由のactionが登録されていればそちらを優先する(段階5-1時点では
  // どのfeatureもまだ何も登録していないため常にfalseで、既存if連鎖が今までどおり
  // 全件実行される。フォールバック分岐は1行も変更していない)。
  if (dispatchAction(action, { event, target, id })) return;

  // v174: navはapp.js内のregisterActionsへ移行した。
  if (action === "date-prev") shiftSelectedDate(-1);
  if (action === "date-next") shiftSelectedDate(1);
  // v173: dashboard-date-prev/nextはsrc/features/dashboard.jsのregisterActionsへ移行した。
  if (action === "today") setSelectedDate(todayISO());
  // v173: set-morning〜store-visit-yearはsrc/features/journal.jsのregisterActionsへ移行した。
  if (action === "add-project") addProject();
  if (action === "delete-project") deleteProject(id);
  if (action === "add-task") addTask();
  if (action === "toggle-task") toggleTask(id);
  if (action === "toggle-criteria-request") toggleCriteriaRequest(id);  // v99: 翌朝AI設定依頼トグル
  if (action === "task-today") createBlockFromTask(id);
  if (action === "home-add-today") addTaskToToday(id);
  // v33: ホームのスコアボード → 対応ゾーンへスクロール
  // v71: ジャンプ先が折りたたみ(details)の中にある場合は、閉じたままだと中身が見えないので開く
  if (action === "home-jump") {
    const el = document.getElementById(id);
    if (el) {
      const fold = el.matches?.("details[data-fold-id]") ? el : el.querySelector?.("details[data-fold-id]");
      if (fold && !fold.open) { fold.open = true; setHomeFoldOpen(fold.dataset.foldId, true); }
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  if (action === "delete-task") deleteTask(id);
  // v33: WBS の折りたたみ
  if (action === "toggle-project-collapse") toggleProjectCollapse(id);
  if (action === "toggle-task-collapse") toggleTaskCollapse(id);
  // v35: 中断 / 再開
  if (action === "suspend-project") suspendProject(id);
  if (action === "resume-project") resumeProject(id);
  if (action === "suspend-task") suspendTask(id);
  if (action === "resume-task") resumeTask(id);
  // v174: toggle-show-suspended〜wbs-collapse-allはapp.js内のregisterActionsへ移行した。
  if (action === "add-block") addBlock();
  if (action === "toggle-block") toggleBlock(id);
  // v107: Block行の「タスク完了」チェック(Block完了とは別枠、K指示 2026-07-15)
  if (action === "toggle-task-complete") toggleTaskCompleteFromBlock(id);
  // v87: 開始/終了に「宣言→終了報告ループ」を軽量に挿入(ROADMAP v91)。
  //      宣言・報告はいずれもスキップ可能で、スキップ時は従来どおり即座に実行される。
  if (action === "now-start") openDeclareModal(id, "block");
  if (action === "now-end") openReportModal(id, "block");
  if (action === "delete-block") deleteBlock(id);
  // v70: 「予定通りだった」一括承認(当日の未記録Blockに計画時刻を実績としてコピー+completed化)
  if (action === "bulk-approve-planned") bulkApproveAsPlanned();
  // v70: Now画面(実行コンベア)の開閉 + 3ボタン(開始はnow-startを再利用)
  if (action === "now-mode-open") openNowMode();
  if (action === "now-mode-close") closeNowMode();
  if (action === "now-conveyor-complete") nowConveyorComplete(id);
  if (action === "now-conveyor-skip") { _nowSkippedIds.add(id); render(); }
  // v68: 日報生成前に「今日AIに聞きたいこと」欄(#reportAskInput、日報タブのみ存在)があれば
  //      origin:"user" の問いとして1件積む(空なら何もしない=節ごと省略される)
  if (action === "generate-report") {
    const askInput = document.querySelector("#reportAskInput");
    const askText = (askInput?.value || "").trim();
    if (askText) {
      state.questions.push(makeQuestion({ text: askText, origin: "user" }));
      askInput.value = "";
      // v162 2系統レビュー対応(必須3): モーダルキュー(理由チップ)が続けて開き、その間に
      // PWAがkillされる/リモート側の状態が先に同期採用される等が起きると、ここで積んだ
      // 問いが保存されないまま消える窓があった。即座にsaveState()して閉じる。
      saveState();
    }
    // v162: 日次締め導線。今日を見ている時、理由未記録かつ未スキップの未完了Blockが残っていれば
    // 先に理由チップ(スキップ可)を1件ずつ挟んでから日報を生成する(既に理由が付いたBlock・
    // 同セッション内で既にスキップ済みのBlockは再質問しない — 2系統レビュー対応・推奨4)。
    const pendingReasonIds = state.selectedDate === todayISO()
      ? blocksForDate(state.selectedDate).filter((b) => !b.completed && !hasIncompleteReason(b) && !_dailyCloseReasonSkipped.has(b.id)).map((b) => b.id)
      : [];
    if (pendingReasonIds.length) {
      openIncompleteReasonModal(pendingReasonIds, "dailyClose");
    } else {
      generateReport();
    }
  }
  if (action === "download-report") downloadReport();
  if (action === "download-data") downloadData();
  // v174: save-github/load-github/gate-continue/reset-demoはapp.js内のregisterActionsへ移行した。
  // v17: MIT(今日の主役)の切替(最大3個)
  if (action === "toggle-mit") toggleMIT(id);
  // v38: AIフィードバックのMIT候補 → 今日の主役ブロック化
  if (action === "mit-candidate-add") addMITCandidate(target.dataset.title);
  // v173: routine-mode/garden-pixel-month/routine-bulk-check/routine-fallback/
  // hyperfocus-gate-*/chain-*はsrc/features/routine.jsのregisterActionsへ移行した。
  // body-scan-*(ポモドーロ身体スキャン)はroutine.jsに未抽出のためここに残す。
  if (action === "body-scan-fatigue") bodyScanRecordFatigue(Number(target.dataset.value));
  if (action === "body-scan-part") bodyScanRecordPart(target.dataset.part || "");
  if (action === "body-scan-discard") bodyScanDiscard();
  // v14: 開始前に既存セッションを強制リセット(中断/完了/休憩後の再開でも確実に50:00から)
  // v87: ポモドーロ開始も宣言ループの対象(スキップ可能)。実際の強制リセット+開始は
  //      resumeLifecycleStart() 内で行う(宣言確定/スキップいずれの経路からも通る)。
  if (action === "start-pomodoro") {
    openDeclareModal(target.dataset.blockId || "", "pomodoro");
  }
  // v70: 「中断」は理由ワンタップピッカーを経由する(チョコ停記録)。実際の停止(stopPomodoro)は
  //      理由選択後に行う。紐づくBlockが無いセッションは記録の意味が無いので従来通り即中断する。
  if (action === "stop-pomodoro") {
    if (state.pomodoro.blockId) {
      _pendingInterruptBlockId = state.pomodoro.blockId;
      render();
    } else {
      stopPomodoro();
    }
  }
  if (action === "interrupt-reason") {
    if (_pendingInterruptBlockId) recordBlockInterruption(_pendingInterruptBlockId, target.dataset.reason || "その他");
    _pendingInterruptBlockId = null;
    stopPomodoro();
  }
  if (action === "interrupt-reason-cancel") {
    _pendingInterruptBlockId = null;
    render();
  }
  // v87: ポモドーロ完了も終了報告ループの対象(スキップ可能)。実際の完了処理は
  //      resumeLifecycleFinish() 内で行う(報告確定/スキップいずれの経路からも通る)。
  if (action === "complete-pomodoro") openReportModal(state.pomodoro.blockId, "pomodoro");
  // v87: 宣言/報告モーダルの操作
  if (action === "declare-confirm") confirmDeclare();
  if (action === "declare-skip") skipDeclare();
  if (action === "report-outcome") {
    const note = modalRoot.querySelector("[data-report-note]")?.value || "";
    finishReport(target.dataset.outcome || "", note);
  }
  if (action === "report-skip") finishReport("", "");
  // v162: 未完了理由クイック入力モーダル(チップ1タップで確定/スキップ両方可)
  if (action === "incomplete-reason-chip") recordIncompleteReasonChip(target.dataset.chip || "");
  if (action === "incomplete-reason-skip") skipIncompleteReasonModal();
  // v111: ポモドーロ開始時のガイド付きアクセス案内(閉じる/×どちらも同じ扱い)。
  //       「今後表示しない」がチェックされていれば設定へ永続化してから閉じる。
  if (action === "guided-access-dismiss") {
    if (modalRoot.querySelector("[data-guided-access-suppress]")?.checked) {
      state.settings.pomoGuidedAccessHint = false;
      saveState();
    }
    closeModal();
  }
  if (action === "go-break") goBreakPomodoro();
  if (action === "end-break") endBreakPomodoro();
  // v19: 休憩中の3択
  if (action === "continue-focus") continueFocusPomodoro();
  if (action === "finish-block") finishBlockFromBreak();
  // === v2: 編集モーダル ===
  if (action === "edit-project") openProjectEditor(id);
  if (action === "edit-task") openTaskEditor(id);
  if (action === "edit-block") openBlockEditor(id);
  if (action === "modal-close") closeModal();
  if (action === "modal-save") {
    // v108: Block編集モーダルの保存ボタンのみ、連打・二重発火防止でdisableする
    //       (他モーダルの保存ボタンはスコープ外)。バリデーション失敗等でモーダルが
    //       開いたまま戻った場合は再度押せるよう再有効化する。
    if (state.modal?.type === "block") {
      if (target.disabled) return;
      target.disabled = true;
      submitModal();
      if (state.modal) target.disabled = false;
    } else {
      submitModal();
    }
  }
  if (action === "modal-delete") deleteFromModal();
  // v65: 10x機構 — 10秒判定3問(任意ヘルプ)のチェック数をその場で数え、
  //      leverageType セレクトへ反映するだけ(state未変更・保存は「保存」ボタン時のみ)
  if (action === "lev-judge") {
    const card = target.closest(".modal-card");
    const checkedCount = card ? card.querySelectorAll("[data-lev-q]:checked").length : 0;
    const select = card?.querySelector('[data-modal-field="leverageType"]');
    if (select) {
      select.value = checkedCount >= 2 ? "asset" : "";
      showToast(checkedCount >= 2 ? "⚙ 「資産」を提案しました(保存で反映)" : "迷うなら未設定のままでOK");
    }
  }
  // === v2: ビジョン画面のセグメント切替 ===
  if (action === "vision-section") setVisionSection(target.dataset.section);
  // v149レビュー対応(必須3): ホーム「80歳ビジョン」カードからビジョンボードの該当ページへ
  if (action === "open-vision-board") openVisionBoard(Number(target.dataset.index) || 0);
  if (action === "vision-board-tab") setVisionBoardIndex(Number(target.dataset.index));
  if (action === "vision-board-load") loadVisionBoardPdf(target.dataset.file);  // v101(原本PDF、v125からは補助扱い)
  if (action === "vision-board-load-images") loadVisionBoardImages(target.dataset.file);  // v125
  if (action === "vision-board-retry-images") loadVisionBoardImages(target.dataset.file);  // v125追補(Codex P2): 失敗ページの再試行
  if (action === "open-md-in-github") openMdInGithub(target.dataset.path);
  if (action === "reload-md") reloadStaticMarkdown();
  // v92: AIレポートビューア — 種類タブ切替 / 一覧・本文の手動更新
  if (action === "ai-report-type") setAiReportType(target.dataset.type);
  if (action === "ai-report-refresh") refreshAiReports();
  // v159: ホームの「✉️ 未来からの手紙が届いています」導線 — AIレポート画面の「未来からの手紙」
  //       タブへ直接遷移する。2026-07-28レビュー対応・推奨修正6: setAiReportType()経由だと
  //       それ自体のrender()+setView()のrender()で2回描画してしまうため、open-questions等と
  //       同じ「設定を直接書き換え→persistLocalNoSchedule→setView」の型(render()は1回のみ)に揃える。
  if (action === "open-future-letter") { state.settings.aiReportType = "letter"; persistLocalNoSchedule(); setView("ai-reports"); }
  // v67: AI作業ワーカー連携(柱2) — 実績還流カードのワンタップ承認 / 質問への橋渡し
  if (action === "ai-work-approve") approveAiWorkResult(target.dataset.resultId);
  if (action === "ai-work-question") raiseAiWorkQuestion(target.dataset.resultId);
  // v74: 読書複利化 — 今日の1冊カードの言語化を保存
  if (action === "reading-save") saveReadingReflection();
  // v68: 人生実験機構(実験中カードのCRUD + 昇格候補コピー)
  if (action === "experiment-add") addExperimentOrGuard();
  if (action === "edit-experiment") openExperimentEditor(id);
  if (action === "experiment-keep") keepExperiment(id);
  if (action === "experiment-drop") dropExperiment(id);
  if (action === "experiment-copy-conclusion") copyExperimentConclusion(id);
  // === v3: ポモドーロ常時起動 ===
  if (action === "pomo-tab") setPomodoroTab(target.dataset.tab);
  // v174: push-reportはapp.js内のregisterActionsへ移行した。
  // === v6: サブタスク追加 / Project直下にTask追加 ===
  if (action === "add-task-to-project") addTaskToProject(id);
  if (action === "add-subtask") addSubtask(target.dataset.parentTask);
  // === v6: タイムラインから新規Block追加 ===
  if (action === "timeline-new-block") {
    const minute = Number(target.dataset.minute || 0);
    openTimelineNewBlock(minute);
  }
  // === v7: タイムライン予定/実績切替 + 完了マーカー ===
  if (action === "timeline-mode") setTimelineMode(target.dataset.mode);
  if (action === "complete-block-with-actual") {
    event.stopPropagation();
    completeBlockWithActual(id);
  }
  // v174: add-category〜delete-break-messageはapp.js内のregisterActionsへ移行した。
  // v10: タイムラインズーム(v37: UI 操作なので dataModifiedAt を汚さない)
  if (action === "tl-zoom") {
    state.timelineZoom = Number(target.dataset.zoom) || 1;
    persistLocalNoSchedule();
    render();
  }
  // v148(UI改善計画Phase3-5): エネルギーグラフの表示モード切替(UI状態、dataModifiedAtは汚さない)
  if (action === "tl-energy-mode") {
    state.settings.timelineEnergyGraphMode = target.dataset.mode === "battery" ? "battery" : "energy";
    persistLocalNoSchedule();
    render();
  }
  // v148: ジャーナル朝/夜detailsの手動開閉(_journalSegmentOverride参照)。ブラウザの
  // ネイティブ<summary>クリックが既にdetails.openを見た目どおり切り替えてくれるため、
  // ここではセッション内オーバーライドの記録だけ行い、render()は呼ばない
  // (無用な全体再描画・スクロール位置巻き戻りを避ける)。
  if (action === "toggle-journal-segment") {
    const seg = target.dataset.segment;
    const parent = target.closest("details");
    if (seg && parent) _journalSegmentOverride[seg] = !parent.open;  // クリック時点ではまだ未反映のため反転
  }
  // v149レビュー対応(必須6): ホーム「信条/寿命」の手動開閉(_homeReflectFoldOverride参照)。
  // 上のtoggle-journal-segmentと同じ方式(ネイティブ<summary>クリックの見た目トグルに任せ、
  // ここではセッション内オーバーライドの記録だけ行う)。
  if (action === "toggle-home-reflect-fold") {
    const seg = target.dataset.segment;
    const parent = target.closest("details");
    if (seg && parent) _homeReflectFoldOverride[seg] = !parent.open;  // クリック時点ではまだ未反映のため反転
  }
  // v174: toggle-settings-sync/toggle-sidebarはapp.js内のregisterActionsへ移行した。
  // v12: ポモドーロ全画面切替(v37: 同上)
  if (action === "toggle-pomo-fullscreen") {
    state.pomodoro.fullscreen = !state.pomodoro.fullscreen;
    persistLocalNoSchedule();
    render();
  }
  // v84: Study With Me トグル(UI操作なのでfullscreenと同じくdataModifiedAtは汚さない)
  if (action === "toggle-study-with-me") {
    state.pomodoro.studyWithMeOn = !state.pomodoro.studyWithMeOn;
    persistLocalNoSchedule();
    render();
  }
  // v173: add-wish〜wish-board-jump-currentはsrc/features/wish.jsのregisterActionsへ移行した。
  // triage-*(仕分けモード、Tier3=wish.js未抽出)はapp.js残留のためここに残す。
  // v152: 仕分けモード(先送りBlock+Wishバックログの三択トリアージ、ボタン版=S1)
  if (action === "triage-choice") triageAction(target.dataset.kind, id, target.dataset.choice);
  // v156: 仕分けモードUndo(S3)。トースト内「元に戻す」ボタン(v150の機構を再利用)
  if (action === "triage-undo") triageUndo(id);
  // v162: 仕分けの「手放す/延期」直後に出るインライン理由チップ欄
  if (action === "triage-reason-chip") recordTriageInlineReason(target.dataset.chip || "");
  if (action === "triage-reason-skip") skipTriageInlineReason();
  // v173: add-avoid/delete-avoidはsrc/features/avoid.jsのregisterActionsへ移行した。
  // v34: 0秒思考
  if (action === "zt-add-toggle") {
    ztAddOpen = !ztAddOpen;
    render();
    if (ztAddOpen) setTimeout(() => document.querySelector("#zt-add-text")?.focus(), 60);
  }
  if (action === "zt-add-cancel") { ztAddOpen = false; render(); }
  if (action === "zt-add-submit") ztAddSubmit();
  if (action === "zt-tab") { ztTab = target.dataset.tab || "other"; render(); }
  // v149: ホームの2タブ(今日/ホーム)。非永続・view/dateは変えないため自動スクロールは発火しない。
  if (action === "home-tab") { homeTab = target.dataset.tab === "home" ? "home" : "today"; render(); }
  if (action === "zt-fav-toggle") ztToggleFav(id);
  if (action === "zt-importance-toggle") ztToggleImportance(id);  // v119: 重要度「高」トグル
  if (action === "zt-theme-delete") deleteZtTheme(id);  // v86: テーマのワンタップ削除
  // v100: AI提案お題キュー(採用/却下)
  if (action === "zt-suggestion-adopt") ztSuggestionAdopt(id);
  if (action === "zt-suggestion-dismiss") ztSuggestionDismiss(id);
  // v90: テーマ一覧の大テーマ(グループ)階層。追加/リネーム/削除は既存のカテゴリ管理
  //      (addCategory等)と同じ軽量な window.prompt/confirm 方式に揃えた(モーダルを増やさない)。
  if (action === "zt-group-add") ztGroupAdd();
  if (action === "zt-group-rename") ztGroupRename(id);
  if (action === "zt-group-delete") ztGroupDelete(id);
  if (action === "zt-group-toggle") ztGroupToggleOpen(id);
  if (action === "zt-write") openZtWrite(id);
  if (action === "zt-save") saveZtEntry();
  if (action === "zt-discard") discardZtWrite();
  // v102: 過去entry(回答済み)を開いて追記・編集
  if (action === "zt-entry-open") openZtEntry(id);
  if (action === "zt-edit-close") closeZtEdit();
  if (action === "zt-edit-save") saveZtEdit(id);
  // v39: 0秒思考の上位タブ(テーマ / 問い)
  if (action === "zero-tab") {
    state.settings.zeroTab = target.dataset.tab || "theme";
    persistLocalNoSchedule();  // UI状態(dataModifiedAt を汚さない)
    render();
  }
  // v39: 問い
  if (action === "question-add") openQuestionEditor("");
  if (action === "question-edit") openQuestionEditor(id);
  if (action === "question-to-theme") questionToTheme(id);
  if (action === "question-settle") settleQuestion(id);
  if (action === "question-reopen") reopenQuestion(id);
  if (action === "question-bridge") openQuestionBridge(id);          // v44
  if (action === "question-bridge-submit") submitQuestionBridge();   // v44
  if (action === "question-delete") deleteQuestion(id);
  if (action === "entry-to-question") entryToQuestion(id);
  if (action === "open-questions") { state.settings.zeroTab = "question"; persistLocalNoSchedule(); setView("zero"); }
  // v39/v40: 週次レビュー
  if (action === "open-weekly") setView("weekly");
  if (action === "weekly-prev") shiftWeeklyWeek(-1);
  if (action === "weekly-next") shiftWeeklyWeek(1);
  if (action === "weekly-change-theme") weeklyChangeTheme(target.dataset.week);
  if (action === "weekly-download") downloadWeekly(target.dataset.week);
  if (action === "weekly-push") pushWeeklyToGitHub(target.dataset.week);
  if (action === "weekly-open-question") { state.settings.zeroTab = "question"; persistLocalNoSchedule(); setView("zero"); }
  // v45: 12週サイクルレビュー
  if (action === "open-cycle") setView("cycle");
  if (action === "cycle-prev") shiftCycle(-1);
  if (action === "cycle-next") shiftCycle(1);
  if (action === "cycle-start-new") cycleStartNew();
  if (action === "cycle-download") downloadCycle(target.dataset.cycle);
  if (action === "cycle-push") pushCycleToGitHub(target.dataset.cycle);
  // v42: AIループ搬送
  if (action === "report-copy-ai") copyReportToClipboard();
  if (action === "report-share-ai") shareReport();
  // v143: journal-import-ai(手動貼り付け取込ボタン)はv141でジャーナルのAIフィードバック列
  // 自体を撤去した際に到達不能になっていたため、ハンドラごと削除した(openAiImportModal一式・
  // ai-import-submitも同様。CHANGES_v143.md参照)。
  if (action === "ai-mit-adopt") adoptAiMit(Number(target.dataset.index));
  // v133: タスク候補チップ(採用/却下)
  if (action === "ai-task-adopt") adoptAiTaskCandidate(Number(target.dataset.index));
  if (action === "ai-task-dismiss") dismissAiTaskCandidate(Number(target.dataset.index));
  // v121: 今週のやりたいこと(Wishからの週次選定)
  if (action === "weekly-wish-open") openWeeklyWishModal();
  if (action === "weekly-wish-submit") submitWeeklyWish();
  if (action === "weekly-wish-toggle") {
    // checkboxのchecked切替はclickイベントのpre-activationでリスナー実行前に反映済みのため、
    // target.checkedは既に新しい値(チェック後)。4件目でpreventDefaultすると
    // canceled-activation-stepsによりブラウザ側が自動でchecked=falseへ戻す。
    if (target.checked && modalRoot.querySelectorAll("input[data-wish-id]:checked").length > 3) {
      event.preventDefault();
      showToast("今週は3つまでに絞りましょう");
    }
  }
  // v60: 下書きスケジュール(空き時間への決定論配置 → D&D調整 → 確定)
  if (action === "ai-schedule") runAiSchedule();
  // v59: 朝の一括プランニング(繰越+WBS+MIT候補 → 空き時間へ仮配置)
  if (action === "ai-morning-plan") runAiMorningPlan();
  // v75: 0秒思考テーマ提案(zeroSecThemes)のワンタップ選定
  if (action === "zerosec-theme-add") decideZeroSecTheme(Number(target.dataset.idx), "added");
  if (action === "zerosec-theme-skip") decideZeroSecTheme(Number(target.dataset.idx), "skipped");
  if (action === "draft-confirm") confirmScheduleDraft();
  if (action === "draft-discard" && _scheduleDraft) {
    // v52: 破棄も「この提案は不要だった」という学習シグナルとして記録(v62: source区別も記録)
    // v145レビュー対応: 複数sourceの項目が合流した下書き(例: 朝プラン+回復提案)でも、
    // 学習ログには項目ごとの出どころ(it.source)を優先して残す(無ければ従来どおり下書き全体のsource)。
    _scheduleDraft.items.forEach((it) => recordScheduleHistory(it, "discarded", _scheduleDraft.date, it.source || _scheduleDraft.source || "deterministic"));
    _scheduleDraft = null;
    _draftUndo = null;  // v62: 破棄はUndo対象外(下書き自体が消える)
    _draftUndoHistoryEntry = null;
    saveState();
    render();
    showToast("下書きを破棄しました");
  }
  if (action === "draft-remove" && _scheduleDraft) {
    const removed = _scheduleDraft.items.find((x) => x.id === id);
    let removedHistoryEntry = null;
    // v145レビュー対応: item.source優先(合流下書きでの出どころ誤ラベル防止。draft-discardと同じ方針)
    if (removed) removedHistoryEntry = recordScheduleHistory(removed, "removed", _scheduleDraft.date, removed.source || _scheduleDraft.source || "deterministic");  // v52: 却下シグナル
    // v62(m2): 削除直前の下書き状態を1段Undoとして退避。このremovedエントリも一緒に退避し、
    //          Undoで取り消せるようにする(Undo→再確定でremoved/confirmedが二重計上されないため)。
    snapshotDraftForUndo(removedHistoryEntry);
    _scheduleDraft.items = _scheduleDraft.items.filter((x) => x.id !== id);
    if (!_scheduleDraft.items.length) _scheduleDraft = null;
    // v62: 却下理由をワンタップで選べる軽量ピッカーを出す(任意・非ブロッキング。選ばなくても削除は既に完了している)
    if (removed && removedHistoryEntry) _pendingRejectReason = { title: removed.title, entry: removedHistoryEntry };
    saveState();
    render();
  }
  if (action === "draft-undo" && _draftUndo) {
    // v62: 下書きレイヤ操作(×削除・ドラッグ移動/リサイズ)の直前状態へ1段だけ戻す
    _scheduleDraft = _draftUndo;
    _draftUndo = null;
    // v62(m2): 削除操作のUndoなら、その削除で積んだremovedエントリも取り消す(aiScheduleHistoryの
    //          二重計上防止。ドラッグ操作由来のUndoでは_draftUndoHistoryEntryがnullなので何もしない)
    if (_draftUndoHistoryEntry) {
      const idx = state.aiScheduleHistory.indexOf(_draftUndoHistoryEntry);
      if (idx !== -1) state.aiScheduleHistory.splice(idx, 1);
      if (_pendingRejectReason && _pendingRejectReason.entry === _draftUndoHistoryEntry) {
        _pendingRejectReason = null;  // 取り消したentryを参照していた却下理由ピッカーも畳む
      }
      _draftUndoHistoryEntry = null;
    }
    saveState();
    render();
    showToast("元に戻しました");
  }
  if (action === "draft-remove-reason" && _pendingRejectReason) {
    // v62: 却下理由のワンタップ選択(今日は無理/価値が薄い/時間帯が合わない/その他)。aiScheduleHistoryへ追記する
    _pendingRejectReason.entry.reason = target.dataset.reason || "";
    _pendingRejectReason = null;
    saveState();
    render();
  }
  if (action === "draft-remove-reason-dismiss") {
    _pendingRejectReason = null;
    render();
  }
  // v62: 週次レビュー_*.md の「来週のタスク提案」から1件ずつWBSへ登録(一括登録はしない)
  if (action === "weekly-suggest-add") {
    addWeeklySuggestedTask(target.dataset.week, Number(target.dataset.index));
  }
  // v174: open-backup-list/restore-backup/run-archiveはapp.js内のregisterActionsへ移行した。
  // v53: 計器盤の期間切替(UI状態)
  if (action === "stats-range") {
    state.settings.statsRange = target.dataset.range || "4w";
    persistLocalNoSchedule();
    render();
  }
  // v49: 横断検索
  if (action === "open-search") openSearchModal();
  if (action === "search-jump") {
    const view = target.dataset.view || "home";
    const date = target.dataset.date || "";
    const zeroTab = target.dataset.zeroTab || "";
    const ztQuery = target.dataset.ztSearch;
    closeModal();
    if (zeroTab) state.settings.zeroTab = zeroTab;
    if (ztQuery !== undefined) ztSearch = ztQuery;  // 0秒思考の履歴検索に引き継ぐ
    if (date) { state.selectedDate = date; ensureJournal(date); }
    state.currentView = view;
    persistLocalNoSchedule();  // 画面移動は UI 操作(dataModifiedAt を汚さない)
    render();
  }
  if (action === "carry-over") requestCarryOver(id);  // v46: 未完了ブロックを今日へ繰り越し(v61: 3回目以降は儀式モーダルを挟む)
  if (action === "migration-ritual-choice") resolveMigrationRitual(target.dataset.choice);  // v61: マイグレーション儀式の選択
  if (action === "ideal-retry") resolveIdealRetry(target.dataset.choice);  // v61: 今日の理想の3日リトライ(続ける/手放す)
  // v39/v40: エネルギー構造からの行動導線
  if (action === "energy-open-routine") openRoutineForWeekday(Number(target.dataset.day));
  if (action === "energy-open-category") {
    state.settings.timelineCategoryFilter = target.dataset.cat || "";
    persistLocalNoSchedule();
    setView("timeline");
  }
  if (action === "timeline-clear-cat") {
    state.settings.timelineCategoryFilter = "";
    persistLocalNoSchedule();
    render();
  }
  // v173: routine-clear-dayはsrc/features/routine.jsのregisterActionsへ移行した。
});

// v71: ホームの折りたたみカード(details)の開閉をlocalStorageへ即時記憶する。
// "toggle" イベントは bubbles しない仕様のため、document への委譲はキャプチャフェーズで行う
// (キャプチャは非バブリングイベントでもターゲットまでの経路を通過するため、これで拾える)。
document.addEventListener("toggle", (event) => {
  const el = event.target;
  if (!el?.dataset?.foldId) return;
  setHomeFoldOpen(el.dataset.foldId, el.open);
}, true);

// v137: hydrateStaticMarkdownの新着render延期(review.md:28)。IME変換中フラグの追跡と、
// 変換確定/フォーカス離脱のタイミングでの保留render実行。
// v140(Med-2): compositionendはフォーカスがまだ入力欄に残っていれば延期を継続する
// (attemptFlushDeferredRenderが両条件を見て判定する)。
document.addEventListener("compositionstart", () => { _imeComposing = true; });
document.addEventListener("compositionend", () => {
  _imeComposing = false;
  attemptFlushDeferredRender();
});
document.addEventListener("focusout", () => {
  // v140(Med-3): compositionendイベントを取りこぼした場合のフェイルセーフとして、
  // _imeComposingをここで無条件クリアしてから判定する(フォーカス喪失を跨いでIME変換が
  // 継続することは無いため安全)。次のタスクへずらすのは、focusout発火時点ではactiveElement
  // がまだ旧要素のことがあるため。
  setTimeout(() => {
    _imeComposing = false;
    attemptFlushDeferredRender();
  }, 0);
}, true);

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches("[data-journal-date]")) {
    const d = target.dataset.journalDate;
    state.journals[d] = target.value;
    // v106: 本文の編集時刻を記録(端末間マージの新旧判定に使用)
    const meta = (state.journalMeta[d] ||= { aiMitCandidates: [], aiImported: false, ideal: "", aiTaskCandidates: [] });
    meta.textUpdatedAt = nowDateTime();
    saveState();
  }
  // v61: 今日の理想ワンライナー(入力中も保存。全再描画しないのでフォーカスは維持される)
  if (target.matches("[data-ideal-date]")) {
    const d = target.dataset.idealDate;
    const meta = (state.journalMeta[d] ||= { aiMitCandidates: [], aiImported: false, ideal: "", aiTaskCandidates: [] });
    meta.ideal = target.value;
    saveState();
  }
  // v143: data-feedback-date(ジャーナルAIフィードバック欄の入力ハンドラ)はv141で該当欄自体を
  // 撤去した際に到達不能になっていたため削除した(paste用の別ハンドラも同様。CHANGES_v143.md参照)。
  // v73: コンディションOS — 夜のひとこと(入力中も保存。全再描画しないのでフォーカスは維持される)
  if (target.matches("[data-condition-note-date]")) {
    const d = target.dataset.conditionNoteDate;
    const log = ensureConditionLog(d);
    log.eveningNote = target.value;
    log.eveningRecordedAt ||= nowDateTime();
    saveState();
  }
  // v39: 週次レビューメモ(実データ = saveState)
  if (target.matches("[data-weekly-md]")) {
    const wk = target.dataset.weeklyMd;
    const prev = state.weeklyReviews[wk] || { md: "", changeThemeCreated: false, createdAt: nowDateTime() };
    state.weeklyReviews[wk] = { ...prev, md: target.value, updatedAt: nowDateTime() };
    saveState();
  }
  // v45: 12週サイクルレビューメモ
  if (target.matches("[data-cycle-md]")) {
    const cs = target.dataset.cycleMd;
    const prev = state.cycleReviews[cs] || { md: "", createdAt: nowDateTime() };
    state.cycleReviews[cs] = { ...prev, md: target.value, updatedAt: nowDateTime() };
    saveState();
  }
  // v34: 0秒思考の履歴検索(全体を再描画せず履歴リストだけ更新 → 入力フォーカス維持)
  if (target.matches("#zt-search")) {
    ztSearch = target.value;
    const listEl = document.querySelector("#zt-history-list");
    const cntEl = document.querySelector("#zt-history-count");
    if (listEl) listEl.innerHTML = ztHistoryListHTML();
    if (cntEl) cntEl.textContent = ztHistoryCountLabel();
  }
  if (target.matches("[data-vision-field]")) {
    state.settings[target.dataset.visionField] = target.value;
    saveState();
  }
  // v84: Study With Me のURL貼り付けから動画ID・開始秒を自動抽出。
  //      貼り付け直後の1入力イベントで完結するため render() してよいが、他の入力欄の
  //      フォーカスを奪わないよう、対象2フィールドはDOM直接更新に留める(vision/github欄と同じ方針)。
  if (target.matches("#study-with-me-url-input")) {
    const parsed = parseYouTubeUrl(target.value);
    if (parsed.videoId) {
      state.settings.studyWithMe.videoId = parsed.videoId;
      if (parsed.startSec !== null) state.settings.studyWithMe.startSec = parsed.startSec;
      saveState();
      const idEl = document.querySelector('[data-swm-field="videoId"]');
      const secEl = document.querySelector('[data-swm-field="startSec"]');
      if (idEl) idEl.value = state.settings.studyWithMe.videoId;
      if (secEl) secEl.value = state.settings.studyWithMe.startSec;
      showToast(`Study With Me: 動画ID/開始秒を抽出しました(${parsed.videoId} / ${state.settings.studyWithMe.startSec}秒)`);
    }
  }
  if (target.matches("[data-github-field]")) {
    // v37: autoSave チェックボックスもこのセレクタに一致してしまい、
    //      value("on"という文字列)で autoSave を上書き + OFF操作でも自動保存を予約していた。
    //      チェックボックスは change ハンドラ側で処理するのでここでは除外する。
    if (target.type === "checkbox") return;
    state.settings.github[target.dataset.githubField] = target.value.trim();
    saveState();
  }
  // v49: 横断検索(結果リストだけ差し替え = 入力フォーカス維持。0秒思考検索と同じ手法)
  if (target.matches("#cross-search-input")) {
    clearTimeout(_searchTimer);
    const query = target.value;
    _searchTimer = setTimeout(() => {
      const box = document.querySelector("#cross-search-results");
      if (box) box.innerHTML = crossSearchResultsHTML(query);
    }, 150);
  }
  // === v9: カテゴリ編集 ===
  if (target.matches("[data-cat-id][data-cat-field]")) {
    updateCategoryField(target.dataset.catId, target.dataset.catField, target.value);
  }
  // === v9: 休憩メッセージ編集 ===
  if (target.matches("[data-msg-id][data-msg-field]")) {
    updateBreakMessageField(target.dataset.msgId, target.dataset.msgField, target.value);
  }
  // v34: ここにあった Wish/Avoid のクリック処理(add-wish 等)は
  //      input リスナーでは action/id が未定義で動かず、毎入力で例外を投げていた。
  //      → click リスナー(上部)へ移設して修正済み。
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-date-picker]")) setSelectedDate(target.value);
  if (target.matches("[data-dashboard-date]")) setDashboardDate(target.value);
  // v117(A): 今日の宣言(change時に保存)。
  // v149レビュー対応(必須5、Codexレビュー指摘): 旧実装はsaveAndRender()で全再描画していたが、
  // 宣言入力欄はホームタブ専用・警告表示先の.home-today-statusは今日タブ専用で、blur時点の
  // 現在DOMには互いに存在しない(タブが排他のため)。にもかかわらず全再描画すると、宣言を
  // blurした直後にタブボタンへ直接タップした1回目のクリックがDOM入れ替えに巻き込まれて
  // 消費されてしまう(2回目でようやく切り替わる)。この保存は実際には即時再描画を必要としない
  // (タブ切替自体が別途render()するため、状態は次の描画で自然に反映される)ため、保存のみに
  // 留める。
  if (target.matches("[data-declaration-date]")) {
    const d = target.dataset.declarationDate;
    state.dailyDeclarations[d] = { text: target.value.trim(), updatedAt: nowDateTime() };
    saveState();
    if (_lastSaveError) showToast("⚠️ 端末内保存に失敗(容量超過の可能性)。設定からGitHubへ保存してください");
  }
  // v92: AIレポートビューアの履歴セレクタ(種類ごとに選択中の日付をUIキャッシュに保持)
  if (target.matches("[data-ai-report-date]")) {
    _aiReportSelectedDate[target.dataset.typeId] = target.value;
    render();
  }
  // v109: WBS 画面上部のカテゴリ絞り込みプルダウン(UI状態、選択カテゴリのProjectのみ表示)
  if (target.matches('[data-action="wbs-category-filter"]')) {
    state.settings.wbsCategoryFilter = target.value || "";
    persistLocalNoSchedule();
    render();
  }
  // v55: WBS インライン編集(期限/状態/カテゴリを行内で直接編集)
  if (target.matches("[data-wbs-edit]")) {
    const field = target.dataset.wbsEdit;
    const id = target.dataset.id;
    // v95: ステータスを手動で「完了」にした時も、分子を分母へ揃える(チェックボックス完了と挙動を揃える)
    if (field === "status" && target.value === "completed") {
      const t = state.tasks.find((x) => x.id === id);
      if (t) updateTaskField(id, "progressNum", fillProgressOnComplete(t));
    }
    updateTaskField(id, field, target.value);
    render();  // 状態変更での並び替え・完了非表示などを即反映(change なので入力を妨げない)
  }
  // v95: WBS進捗(分子/分母)のインライン編集。ステータス連動込みで updateTaskProgress が処理する
  if (target.matches("[data-wbs-progress]")) {
    const field = target.dataset.wbsProgress === "num" ? "progressNum" : "progressDen";
    updateTaskProgress(target.dataset.id, field, target.value);
    render();
  }
  if (target.matches("[data-block-field]")) {
    updateBlockField(target.dataset.id, target.dataset.blockField, target.value);
    render();  // v33: 充電/放電などの変更を画面に即反映
  }
  // v66: レバレッジ台帳の累計節約メモ(任意1行)。Block/Taskどちらの資産かで更新先を分ける。
  if (target.matches("[data-ledger-note-id]")) {
    const noteId = target.dataset.ledgerNoteId;
    if (target.dataset.ledgerNoteKind === "task") {
      updateTaskField(noteId, "leverageNote", target.value);
    } else {
      updateBlockField(noteId, "leverageNote", target.value);
    }
  }
  if (target.matches("[data-setting-field]")) {
    state.settings[target.dataset.settingField] = target.value;
    saveState();
    render();
  }
  // v59: 朝の一括プランニングの自動下書きトグル
  if (target.matches("[data-ai-automorningplan]")) {
    state.settings.ai.autoMorningPlan = target.checked;
    saveState();
    if (target.checked) showToast("朝の一括プランニングを有効にしました(翌朝から)");
  }
  // v53: 自動アーカイブのトグル
  if (target.matches("[data-setting-autoarchive]")) {
    state.settings.autoArchive = target.checked;
    saveState();
  }
  // v70: Block開始でフォーカスタイマーを自動起動するかのトグル
  if (target.matches("[data-setting-focustimerauto]")) {
    state.settings.focusTimerAuto = target.checked;
    saveState();
  }
  // v111: ポモドーロ開始時のiOSガイド付きアクセス案内のトグル(モーダル内「今後表示しない」と同じ設定)
  if (target.matches("[data-setting-pomoguidedaccesshint]")) {
    state.settings.pomoGuidedAccessHint = target.checked;
    saveState();
  }
  // v116: 1日バッファ(分)の手入力。空欄・不正入力は0(=未設定のフェイルソフト表示)に倒す。
  //       自動計算はしない設計のため、ここでの値クランプ以外の補正は行わない。
  if (target.matches("[data-setting-dailybuffermin]")) {
    const n = parseInt(target.value, 10);
    state.settings.dailyBufferMin = Number.isFinite(n) ? n : 0;
    saveState();
    render();
  }
  // v116(K追加要件): 1日の締め時刻(時)。計画過積載ガードの可処分枠の終端にのみ使う。
  //       空欄・不正入力・0以下は既定24へ倒す(バッファ分数と異なり「未設定」概念を持たない)。
  if (target.matches("[data-setting-dayclosehours]")) {
    const n = parseFloat(target.value);
    state.settings.dayCloseHours = (Number.isFinite(n) && n > 0) ? n : 24;
    saveState();
    render();
  }
  // v144: エネルギーバッテリーのパラメタ手入力(開始値3種・減衰率・減衰開始時刻・上限)。
  //       "start.deficit"のようにドット区切りでstart配下のキーを指定できる汎用ハンドラ。
  //       レビュー対応(M3/M4): 境界検証はclampBatteryFieldValue()に一本化し、
  //       normalizeStateと同じ基準でここでも強制する(手入力の異常値をその場で弾く)。
  if (target.matches("[data-setting-battery-field]")) {
    const field = target.dataset.settingBatteryField;
    state.settings.battery ||= defaultBatterySettings();
    if (field === "decayStartMinutes") {
      // v144レビュー対応: iOS規約によりtype="time"に変更(分単位で保存)
      state.settings.battery.decayStartMinutes = clampBatteryFieldValue(field, parseTimeInputToMinutes(target.value));
    } else if (field.startsWith("start.")) {
      const key = field.split(".")[1];
      const val = clampBatteryFieldValue(field, target.value);
      state.settings.battery.start = { ...state.settings.battery.start, [key]: val };
    } else {
      state.settings.battery[field] = clampBatteryFieldValue(field, target.value);
    }
    saveState();
    render();
  }
  // v145: 行動接続(残量低下時の回復Block下書き提案)のopt-inトグル。既定OFF。
  if (target.matches("[data-setting-battery-recoverydraft]")) {
    state.settings.battery ||= defaultBatterySettings();
    state.settings.battery.recoveryDraft = target.checked;
    saveState();
  }
  // v84: Study With Me の動画ID・開始秒(直接編集)
  if (target.matches("[data-swm-field]")) {
    const field = target.dataset.swmField;
    if (field === "startSec") {
      state.settings.studyWithMe.startSec = Math.max(0, Math.floor(Number(target.value) || 0));
    } else {
      state.settings.studyWithMe.videoId = target.value.trim();
    }
    saveState();
    render();
  }
  // v53: 横断検索のアーカイブ合流トグル(lazy fetch)
  if (target.matches("#cross-search-archive")) {
    if (target.checked) loadArchiveForSearch();
    else refreshSearchResults();
  }
  if (target.matches('[data-github-field="autoSave"]')) {
    state.settings.github.autoSave = target.checked;
    saveState();
    updateAutoSaveStatus();
    if (target.checked) {
      showToast("GitHub 自動保存を有効にしました");
      scheduleAutoSave();
    }
  }
  // v43: 自動同期トグル
  if (target.matches("[data-setting-autosync]")) {
    state.settings.autoSync = target.checked;
    saveState();
    if (target.checked) {
      showToast("自動同期を有効にしました");
      runAutoSyncPull();  // 有効化直後に一度 pull を試す
      scheduleAutoSync();
    } else {
      clearTimeout(_autoSyncTimer);
      clearSyncBanner();
    }
    render();
  }
  if (target.matches("#importData")) importData(target.files?.[0]);
  // v143: data-feedback-upload(.mdアップロード欄)はv141で該当欄自体を撤去した際に到達不能に
  // なっていたため、ハンドラとuploadFeedbackFile()本体を削除した(CHANGES_v143.md参照)。
  // v120: AutoSleep書き出しCSVの取込。値を先に消し、同じファイルも再選択可能にする。
  if (target.matches("[data-sleep-csv-upload]")) {
    const file = target.files?.[0];
    if (file) {
      target.value = "";
      importSleepCsv(file);
    }
  }
  // v9: 編集モーダルのカテゴリselectで「+ 新規カテゴリ追加」を選んだ時
  if (target.matches('[data-modal-field="category"]') && target.value === "__ADD_NEW__") {
    handleAddCategoryFromModal(target);
  }
  // v16: Wish フィルタ・編集
  if (target.matches('[data-action="wish-filter-area"]')) {
    state.wishFilter = { ...(state.wishFilter || {}), area: target.value };
    render();
  }
  if (target.matches('[data-action="wish-toggle-realized"]')) {
    state.wishFilter = { ...(state.wishFilter || {}), showRealized: target.checked };
    render();
  }
  if (target.matches('[data-action="wish-set-year"]')) {
    const id = target.dataset.id;
    const val = target.value ? Number(target.value) : null;
    updateTaskField(id, "targetYear", val);
  }
  if (target.matches('[data-action="wish-set-area"]')) {
    updateTaskField(target.dataset.id, "lifeArea", target.value);
  }
  // v79: Wish編集の期限(任意)。表示側(バッジ等)は作らない — 週次レビューが読むだけ。
  if (target.matches('[data-action="wish-set-duedate"]')) {
    updateTaskField(target.dataset.id, "dueDate", target.value);
  }
  // v79: 月間プランニングボードのカード上「月選択」(タップ代替)。
  //      updateTaskFieldはsaveStateのみでrenderしないため、これを呼ばないとカードが
  //      新しい月枠へ視覚的に移動せず「未定」プールに残ったまま見える(データは保存済み)。
  //      ボードの主眼=空間配置を成立させるため、選択直後に再描画する。
  if (target.matches('[data-action="wish-set-month"]')) {
    updateTaskField(target.dataset.id, "targetMonth", target.value ? Number(target.value) : null);
    render();
  }
  // v90: 0秒思考テーマの大テーマ割り当て(v79月間ボードの月選択と同じ「select常時同居」の
  //      タップ代替。ドラッグ&ドロップは作らない)。選択直後にグループ間の見た目の移動を
  //      反映するため render() する。
  if (target.matches('[data-action="zt-theme-set-group"]')) {
    ztThemeSetGroup(target.dataset.id, target.value || null);
    render();
  }
});

// v16: Wish 関連のリアルタイム編集(input イベント = 入力中も保存)
document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches('[data-action="wish-set-motivation"]')) {
    updateTaskField(target.dataset.id, "motivation", target.value);
  }
  if (target.matches('[data-action="wish-subtask-title"]')) {
    updateTaskField(target.dataset.id, "title", target.value);
  }
  // v17: Avoid List のテキスト編集
  if (target.matches('[data-avoid-id][data-avoid-field="text"]')) {
    updateAvoidText(target.dataset.avoidId, target.value);
  }
});

// loadState/persistLocalNoSchedule: src/storage/local.js へ抽出済み(v166)。冒頭のimportを参照。
// _lastSaveErrorも同ファイルからimport済み(読み取り専用。再代入はpersistLocalNoSchedule内のみ)。

let _quotaToastShown = false;

function saveState() {
  // v25: 実データの変更時刻を記録(端末間の「新しい方が勝つ」判定に使用)。
  //      persistLocalNoSchedule(リモート採用・GitHub保存)では更新しない。
  state.dataModifiedAt = nowDateTime();
  // v153: 今日の庭。saveState()を通るすべての操作でupsert(配線漏れ防止、設計書§③)。
  //       当日 + 選択日(異なる場合のみ)の2キーをスナップショットしてからprune。
  updateGardenLog(todayISO());
  if (state.selectedDate && state.selectedDate !== todayISO()) updateGardenLog(state.selectedDate);
  pruneGardenLog();
  // v23: localStorage 書き込み失敗で例外を投げない(画面が固まるのを防ぐ)
  persistLocalNoSchedule();
  // v37: 容量超過などで保存できていない場合、黙って入力を失わせず一度は知らせる
  //      (ジャーナル入力は keystroke ごとにここを通るため、毎回は出さない)
  if (_lastSaveError && !_quotaToastShown) {
    _quotaToastShown = true;
    showToast("⚠ 端末への保存に失敗しています(容量不足の可能性)。エクスポートでバックアップを取ってください");
  } else if (!_lastSaveError) {
    _quotaToastShown = false;
  }
  scheduleAutoSave();
  scheduleAutoSync();  // v43: 自動同期 ON のとき 3分デバウンスで push
}

// v151: テーマ解決・適用。index.htmlの起動時同期スクリプト(フラッシュ防止用、
// 同じ判定ロジックを重複実装)と役割分担している——ここは「状態が変わった後」
// (設定変更・render毎・OS設定変化)の反映を担当する。
// data-theme="dark"のCSSトークンはstyles.cssの:root[data-theme="dark"]に一本化してあるため
// (メディアクエリは使わない、CHANGES_v151.md参照)、"auto"の実体解決は常にここで行う。
// v151レビュー対応(必須5): 分岐の「形」をindex.htmlの同期スクリプトと完全一致させる
// (mode!=="auto"ならlight/darkを直接判定、autoのときだけmatchMediaを見る)。
// どちらかだけ書き換えるとドリフトするため、変更時は両方を見比べること。
const THEME_COLOR_BY_MODE = { light: "#f7f7fa", dark: "#111216" };
function resolveTheme(mode) {
  if (mode !== "auto") return mode === "light" ? "light" : "dark";
  return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
}
function applyTheme() {
  const resolved = resolveTheme(state.settings.theme);
  document.documentElement.setAttribute("data-theme", resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR_BY_MODE[resolved]);
  return resolved;
}

function normalizeState(value) {
  value.settings ||= {};
  // v31: 残り時間表示用の生年月日(未設定なら補完)
  if (!value.settings.birthDate) value.settings.birthDate = "1992-12-29";
  value.settings.staticFilesLoaded ||= { vision: false, affirmation: false };
  // v37: インポート/同期で欠けていると描画がクラッシュするキーを補完
  value.settings.morningEnergyLog ||= {};
  value.pomodoro ||= { running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
  // v84: Study With Me(YouTube埋め込み)のトグル状態。既定OFF(常時ロード禁止のため)。
  //      pomodoroオブジェクトが既にある既存端末でもここで補完する(既存値優先)。
  if (typeof value.pomodoro.studyWithMeOn !== "boolean") value.pomodoro.studyWithMeOn = false;
  // v84: Study With Me の動画設定(動画ID・開始秒)。既定はKが指定した動画。既存値優先。
  value.settings.studyWithMe ||= {};
  value.settings.studyWithMe.videoId ||= "WgxzRsiIwb8";
  if (typeof value.settings.studyWithMe.startSec !== "number") value.settings.studyWithMe.startSec = 1986;
  value.settings.github ||= defaultGitHubSettings();
  value.settings.github.owner ||= "kojit1229";
  value.settings.github.repo ||= "taskchute-ipad";
  value.settings.github.branch ||= "main";
  value.settings.github.path ||= "app-state.json";
  // v94: 保存先パス(settings.github.path)に taskchute/ プレフィックスが混入していた場合の
  // 自己修復。personalDataPath() が taskchute/ を常に自動付与するため、path 自体に
  // taskchute/ を含んでいると実リクエストが taskchute/taskchute/... の二重プレフィックスに
  // なりデータが読めなくなる(K報告 2026-07-14)。混入経路は主に loadFromGitHub() が
  // requireGitHubConfig() の変換済みconfig(pathに既に taskchute/ 付与済み)をそのまま
  // state.settings.github へ書き戻していたバグ(本コミットで修正)。同期でリモートへ伝播した
  // 汚染済みstateもここで読込のたびに直る。大文字小文字・taskchute/taskchute/の多重付与も剥がす。
  {
    let p = value.settings.github.path;
    while (/^taskchute\/+/i.test(p)) p = p.replace(/^taskchute\/+/i, "");
    value.settings.github.path = p || "app-state.json";
  }
  value.settings.github.token ||= "";
  if (typeof value.settings.github.autoSave !== "boolean") {
    value.settings.github.autoSave = false;
  }
  value.settings.github.lastSavedAt ||= "";
  // v72: 個人データ用リポジトリ(既定 kojit1229/personal-data)。token/branchは既存フィールド共用。
  value.settings.github.dataOwner ||= "kojit1229";
  value.settings.github.dataRepo ||= "personal-data";
  // v60: Claude API 直接呼び出しは全廃した(コスト理由。AI活用は自宅PCのバッチ→ファイル連携に限定)。
  //      APIキー・モデル選択・プロンプトテンプレ・朝イチ自動レビューの設定UIは削除済み。
  //      過去に保存されたキー等が端末のlocalStorageに残らないよう、既存値があれば明示的に消す。
  value.settings.ai ||= {};
  delete value.settings.ai.apiKey;
  delete value.settings.ai.model;
  delete value.settings.ai.prompts;
  delete value.settings.ai.autoMorningReview;
  // v59: 朝の一括プランニングの自動下書き(既定OFF。ONなら10:00以前の初回起動・当日の非ルーティンBlock0件時に自動実行)。
  //      v60でAI呼び出しは無くなったが、決定論配置の自動下書き機能として引き続き有効。
  if (typeof value.settings.ai.autoMorningPlan !== "boolean") value.settings.ai.autoMorningPlan = false;
  // v52: スケジュール実績ログ(決定論配置の元値に対するユーザの採否・修正を記録)。
  if (!Array.isArray(value.aiScheduleHistory)) value.aiScheduleHistory = [];
  // v62: aiScheduleHistory の各エントリに source/reason のデフォルトを補完(後方互換。
  //      v62以前のエントリには無いフィールドのため、既存値優先で埋める)
  value.aiScheduleHistory = value.aiScheduleHistory.map((h) => ({ source: "unknown", reason: "", ...h }));
  // v53: 計器盤の期間カーソル(UI状態)と自動アーカイブ設定
  value.settings.statsRange ||= "4w";
  // v148(UI改善計画Phase3-5): タイムラインのエネルギーグラフ表示モード(UI状態)。
  // 既定"energy"(従来どおりエネルギー実績/予測線)。"battery"でバッテリー残量線のみ表示。
  if (value.settings.timelineEnergyGraphMode !== "energy" && value.settings.timelineEnergyGraphMode !== "battery") {
    value.settings.timelineEnergyGraphMode = "energy";
  }
  // v151(ダークモード既定化、K指示2026-07-27): "light"|"dark"|"auto"(OS追従)の3択。
  // 既定"dark"。既存端末も次回起動からdarkになる(autoを選べば従来どおりOS追従に戻せる)。
  // 実際のhtml要素への反映(data-theme属性・meta theme-color)はapplyTheme()が行う。
  if (value.settings.theme !== "light" && value.settings.theme !== "dark" && value.settings.theme !== "auto") {
    value.settings.theme = "dark";
  }
  if (typeof value.settings.autoArchive !== "boolean") value.settings.autoArchive = true;
  value.settings.lastArchivedAt ||= "";
  // v43: 自動同期(既定OFF・保守的)。lastPushedAt = 最後に push した時の dataModifiedAt。
  if (typeof value.settings.autoSync !== "boolean") value.settings.autoSync = false;
  // v70: Block開始でフォーカスタイマー(ポモドーロ)を自動起動するか(既定ON)。
  if (typeof value.settings.focusTimerAuto !== "boolean") value.settings.focusTimerAuto = true;
  // v111: ポモドーロ開始時、iOS系端末にガイド付きアクセスのリマインドを出すか(既定ON)。
  //       「今後表示しない」チェックでfalseに倒す。設定画面のトグルで再度ONにできる。
  if (typeof value.settings.pomoGuidedAccessHint !== "boolean") value.settings.pomoGuidedAccessHint = true;
  // v116: 1日バッファ(分)。ROADMAP「TOC由来の提案E: 1日バッファ+消化率メーター」
  //       (クリティカルチェーン法の個人適用。学生症候群・パーキンソンの法則対策で、
  //       各Blockの見積もりに個別の余裕を足さず、余裕は1日末尾のバッファ1つに集約する)。
  //       自動計算はしない(Kが手で設定、既定60分)。未設定/文字列混入等の不正値のみ
  //       既定値を補う。明示的な0以下の値はそのまま尊重し、「バッファ未設定」の
  //       フェイルソフト表示(bufferMeterHTML参照)に使う。
  if (!Number.isFinite(value.settings.dailyBufferMin)) value.settings.dailyBufferMin = 60;
  // v116(K追加要件・計画過積載ガード): 1日の締め時刻(0時からの経過時間、単位=時)。
  //       既定24(=24:00/翌0時)。Kのビジョン「23:30以降のPC使用は24時で仕切る」(ROADMAP
  //       Atomic Habits由来 提案K)に合わせた既定値。0以下や非数はここで常に24へ補正する
  //       (バッファ分数と違い「未設定」を表現する必要が無いため||=相当の強制補正でよい)。
  if (!Number.isFinite(value.settings.dayCloseHours) || value.settings.dayCloseHours <= 0) {
    value.settings.dayCloseHours = 24;
  }
  // v144: エネルギーバッテリーモデルのパラメタ(設計提案書§3、2026-07-26 K確定値)。
  //       開始値(体力予算連動)3種・減衰率・減衰開始時刻・上限を設定画面から変更できる。
  //       既存値優先で補完しつつ、レビュー対応(M3/M4)でclampBatteryFieldValue()により
  //       フィールド別の境界を毎回強制する(手入力だけでなく同期データ経由の異常値も弾く)。
  value.settings.battery ||= {};
  {
    const def = defaultBatterySettings();
    const b = value.settings.battery;
    // v144レビュー対応(M4): 旧decayStartHour(時単位)からdecayStartMinutes(分単位、
    // type="time"入力に対応)への移行。既存のdecayStartHourがあればそれを分に換算して
    // 引き継ぐ(K確定の「07:00固定」という意味自体は不変)。移行後はdecayStartHourを持たない
    // (二重管理を避ける)。
    if (!Number.isFinite(b.decayStartMinutes)) {
      b.decayStartMinutes = Number.isFinite(b.decayStartHour) ? b.decayStartHour * 60 : def.decayStartMinutes;
    }
    delete b.decayStartHour;
    const rawStart = b.start || {};
    b.start = {
      deficit: clampBatteryFieldValue("start.deficit", Number.isFinite(rawStart.deficit) ? rawStart.deficit : def.start.deficit),
      low: clampBatteryFieldValue("start.low", Number.isFinite(rawStart.low) ? rawStart.low : def.start.low),
      normal: clampBatteryFieldValue("start.normal", Number.isFinite(rawStart.normal) ? rawStart.normal : def.start.normal)
    };
    b.decayPerHour = clampBatteryFieldValue("decayPerHour", Number.isFinite(b.decayPerHour) ? b.decayPerHour : def.decayPerHour);
    b.decayStartMinutes = clampBatteryFieldValue("decayStartMinutes", b.decayStartMinutes);
    b.max = clampBatteryFieldValue("max", Number.isFinite(b.max) ? b.max : def.max);
    // v145: 行動接続(残量低下時の回復Block下書き提案)。既定OFF・しきい値40%(既存値優先で補完)。
    if (typeof b.recoveryDraft !== "boolean") b.recoveryDraft = def.recoveryDraft;
    b.recoveryThresholdPct = clampBatteryFieldValue("recoveryThresholdPct", Number.isFinite(b.recoveryThresholdPct) ? b.recoveryThresholdPct : def.recoveryThresholdPct);
  }
  // v145: 回復Block下書き提案の1日1回冪等マーカー(feedbackIngestedDatesと同じ軽量配列の思想)。
  // v150レビュー対応(項目5、Codex指摘): 旧形式は日付文字列の配列だった。PWA破棄後の再構築
  // (maybeRebuildRecoveryDraft)で「元々どのタイトルを提案したか」を復元できるよう、
  // 各要素を{date, titles}へ拡張する。旧形式(文字列)は{date, titles:[]}へ移行する
  // (titles不明のため、その日は再構築の対象外=スキップになる。既存の冪等性=「その日はもう
  // 新規発火しない」という意味自体は維持)。
  if (!Array.isArray(value.batteryRecoveryDraftDates)) value.batteryRecoveryDraftDates = [];
  value.batteryRecoveryDraftDates = value.batteryRecoveryDraftDates
    .map((entry) => {
      if (typeof entry === "string") return { date: entry, titles: [] };
      if (entry && typeof entry === "object" && typeof entry.date === "string") {
        return { date: entry.date, titles: Array.isArray(entry.titles) ? entry.titles.filter((t) => typeof t === "string") : [] };
      }
      return null;
    })
    .filter(Boolean);
  if (!("lastPushedAt" in value.settings)) value.settings.lastPushedAt = null;
  if (!("lastPulledAt" in value.settings)) value.settings.lastPulledAt = null;
  // v25: データ最終更新時刻(端末間で「新しい方が勝つ」判定に使用)
  value.dataModifiedAt ||= "";
  // v35: WBS で中断中の項目を表示するかどうか(既定は非表示)
  if (typeof value.settings.showSuspended !== "boolean") {
    value.settings.showSuspended = false;
  }
  value.settings.visionSection ||= "vision";
  if (typeof value.settings.visionBoardIndex !== "number") {
    value.settings.visionBoardIndex = 0;
  }
  // v92: AIレポートビューアで選択中のタブ(コンテンツ総括/自己分析/基盤ヘルス/週次レビュー/バッチ実行サマリ/英語表現集)
  value.settings.aiReportType ||= "content";
  // v9: カテゴリーマスタ
  if (!Array.isArray(value.settings.categories) || value.settings.categories.length === 0) {
    value.settings.categories = defaultCategories();
  }
  // v9: 休憩メッセージマスタ
  if (!Array.isArray(value.settings.breakMessages) || value.settings.breakMessages.length === 0) {
    value.settings.breakMessages = defaultBreakMessages();
  }
  // v16: やりたいことリスト用の人生領域マスタ
  if (!Array.isArray(value.settings.lifeAreas) || value.settings.lifeAreas.length === 0) {
    value.settings.lifeAreas = defaultLifeAreas();
  }
  // v17: Avoid List(やらないこと)
  if (!Array.isArray(value.settings.avoidList)) {
    value.settings.avoidList = [];
  }
  value.projects ||= [];
  value.tasks ||= [];
  // v16/v18: 既存 Task にWish + ルーティン連携 用フィールドのデフォルト値を補完(後方互換)
  value.tasks = value.tasks.map((task) => {
    // v18: 古い trigger/celebrate フィールドは削除(あれば)
    const { trigger, celebrate, ...rest } = task;
    return {
      targetYear: null,
      targetMonth: null,  // v79: 月間プランニングボード用(1-12 or null="未定"。targetYearとは独立)
      lifeArea: "",
      motivation: "",
      realized: false,
      realizedDate: "",
      nextRoutineId: "",
      leverageType: "",  // v65: 10x機構(2-1)。"asset"|"eliminate"|"oneoff"|""(未設定)
      leverageNote: "",  // v66: 10x機構(2-2レバレッジ台帳)。資産の累計節約・成果の自己申告メモ(任意1行)
      aiWork: false,      // v67: AI作業ワーカー連携(柱2)。trueならバッチ側がこのTaskを拾って作業する
      aiWorkBrief: "",    // v67: 何をしてほしいか・成果物の置き場希望(1〜2行)
      progressNum: 0,     // v95: WBS進捗(分子)。旧Taskは未着手(0)扱いで補完
      progressDen: 10,    // v95: WBS進捗(分母)。既定10
      doneCriteria: "",   // v96: 完了条件(終わったら残る物を1文で。既定は空欄=未設定)
      firstStep: "",       // v96: スモールステップ(5〜15分で終わる最初の行動。既定は空欄=未設定)
      criteriaRequest: false,  // v99: 翌朝バッチへdoneCriteria/firstStep自動設定orサブタスク生成を依頼するフラグ。
                                // trueで翌朝loop/task-criteria.shが処理し、処理後は自動でfalseに戻る(アプリ側での解除処理は不要)
      selfDueOff: false,  // v117(B): 自己締切の自動前倒し。既定false=前倒しON(dueDateの2日前を有効締切にする)
      updatedAt: "",  // v135: 同期マージ用。既存値優先で補完(空="不明"のまま扱う。回復不能なので推測しない)
      ...rest
    };
  });
  value.blocks ||= [];
  // v17: 既存 Block に isMIT のデフォルト値を補完(後方互換)
  // v18: 壊れた時刻データを修復(text化で不正形式になった可能性に対応)
  const fixDateTime = (val) => {
    if (!val) return val;
    const s = String(val).trim();
    // 正しい形式 "YYYY-MM-DDTHH:mm:ss" or "YYYY-MM-DDTHH:mm"
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) {
      return s.length === 16 ? `${s}:00` : s;
    }
    // 不正形式は空に
    return "";
  };
  value.blocks = value.blocks.map((block) => ({
    isMIT: false,
    source: "",
    estimateMin: null,   // v41: 見積時間(分)。null は解決順で埋める(入力必須にしない)
    carryCount: 0,        // v61: マイグレーション儀式(提案1)。繰り越された回数(未繰り越しは0)
    leverageType: "",     // v65: 10x機構(2-1)。"asset"|"eliminate"|"oneoff"|""(未設定)
    leverageNote: "",     // v66: 10x機構(2-2レバレッジ台帳)。資産の累計節約・成果の自己申告メモ(任意1行)
    interruptions: [],    // v70: フォーカスタイマー中断(チョコ停)記録 [{at, reason}]
    incompleteReason: null,  // v162: 未完了理由クイック入力 {chip, note, at} | null
    ...block,
    plannedStartAt: fixDateTime(block.plannedStartAt),
    plannedEndAt: fixDateTime(block.plannedEndAt),
    actualStartAt: fixDateTime(block.actualStartAt),
    actualEndAt: fixDateTime(block.actualEndAt),
    interruptions: Array.isArray(block.interruptions) ? block.interruptions : [],  // 壊れた形状は初期化
    // v162: 壊れた形状(chip欠落等)はnullへ落とす。日報生成・トリアージ双方がchip truthyを前提にするため
    incompleteReason: (block.incompleteReason && typeof block.incompleteReason === "object" && block.incompleteReason.chip)
      ? { chip: String(block.incompleteReason.chip), note: String(block.incompleteReason.note || ""), at: String(block.incompleteReason.at || "") }
      : null
  }));
  // v16: Wish Project が削除/未作成なら自動作成(必ず1つ存在を保証)
  if (!value.projects.some((p) => p.kind === "wish" && !p.deleted)) {
    value.projects.push({
      id: crypto.randomUUID(),
      kind: "wish",
      title: "Wish",
      category: "回復",
      status: "active",
      twelveWeekStartDate: "",
      createdAt: nowDateTime(),
      updatedAt: nowDateTime(),
      deleted: false
    });
  }
  // v28: 「その他」Project(タスクシュート画面から直接追加した Block の受け皿)。
  //      必ず1つ存在を保証する。
  let otherProject = value.projects.find((p) => p.kind === "other" && !p.deleted);
  if (!otherProject) {
    otherProject = {
      id: crypto.randomUUID(),
      kind: "other",
      title: "その他",
      category: "",
      status: "active",
      twelveWeekStartDate: "",
      createdAt: nowDateTime(),
      updatedAt: nowDateTime(),
      deleted: false
    };
    value.projects.push(otherProject);
  }
  // v28: 「その他」Project 直下の受け皿 Task。直接追加した Block はこれに紐づく。
  //      normalizeState は state 確定前にも走るため、makeTask は使わず直接構築する。
  let otherTask = value.tasks.find((t) => t.kind === "other" && !t.deleted);
  if (!otherTask) {
    otherTask = {
      id: crypto.randomUUID(),
      kind: "other",
      projectId: otherProject.id,
      parentTaskId: "",
      title: "その他",
      category: "",
      status: "active",
      dueDate: "",
      description: "",
      targetYear: null,
      targetMonth: null,  // v79: 月間プランニングボード用(1-12 or null)
      lifeArea: "",
      motivation: "",
      realized: false,
      realizedDate: "",
      nextRoutineId: "",
      createdAt: nowDateTime(),
      updatedAt: nowDateTime(),
      deleted: false
    };
    value.tasks.push(otherTask);
  }
  // v28: 既存の孤立 Block(タスクシュート画面で追加されたが Task 未紐づけ)を
  //      「その他」Task に紐づけ、タスクシュート画面に表示されるようにする。
  //      timeline 由来・ルーティン・繰り返し系列は対象外。
  for (const block of value.blocks) {
    if (block.deleted) continue;
    if (block.taskId) continue;
    if (block.source === "timeline") continue;
    if (block.category === "ルーティン") continue;
    if (block.recurrenceGroupId) continue;
    block.taskId = otherTask.id;
  }
  value.journals ||= {};
  // v117(A): 今日の宣言。日付キー{text, updatedAt}。state.declarations(v87の作業単位宣言ログ)
  // とは別物(名前衝突を避けるため dailyDeclarations という別名にした)。
  if (!value.dailyDeclarations || typeof value.dailyDeclarations !== "object") value.dailyDeclarations = {};
  // v121: 今週のやりたいこと(Wishからの週次選定)。週キー=weekRange().weekStart、
  // {taskIds: string[], updatedAt} の週次マップ。dailyDeclarationsと同じ後方互換パターン。
  if (!value.weeklyWishes || typeof value.weeklyWishes !== "object") value.weeklyWishes = {};
  // v42: 日ごとのメタ(AIフィードバック取り込み由来。journals は文字列なので別ストア)
  value.journalMeta ||= {};
  Object.values(value.journalMeta).forEach((j) => {
    if (!Array.isArray(j.aiMitCandidates)) j.aiMitCandidates = [];
    if (!("aiImported" in j)) j.aiImported = false;
    if (!("ideal" in j)) j.ideal = "";  // v61: 今日の理想ワンライナー(提案8)
    if (!("textUpdatedAt" in j)) j.textUpdatedAt = "";  // v106: 本文編集時刻(同期マージの新旧判定)
    // v133: AIフィードバックから抽出したタスク候補(aiMitCandidatesと同じ「溜めて＋で採用」方式へ回帰。
    //       詳細はautoIngestFeedbackのコメント参照)
    if (!Array.isArray(j.aiTaskCandidates)) j.aiTaskCandidates = [];
  });
  // v61: マイグレーション儀式(3回目以降の繰り越し確認)の選択ログ。将来のバッチ分析用に軽量記録。
  if (!Array.isArray(value.migrationRitualLog)) value.migrationRitualLog = [];
  // v152: 仕分けモード(先送りBlock+Wishバックログの三択トリアージ)の選択ログ。
  //      migrationRitualLogと同じ軽量append-only配列の思想(上限はSWIPE_TRIAGE_LOG_MAX)。
  if (!Array.isArray(value.swipeTriageLog)) value.swipeTriageLog = [];
  // v65(v64設計§3残余): AIプラン自身が「配置しない」と判断した候補のログ({date,title,reason,at}、上限300件)。
  //      migrationRitualLog/aiScheduleHistoryと同じ軽量配列の思想。v62でAIプラン取り込みは実装済みだったが
  //      skippedのkind:"ai"分は永続化されておらず、v64設計§3の「AIプランのskipped理由」学習シグナルが
  //      アプリ側で欠けていたため今回吸収する。
  if (!Array.isArray(value.aiPlanSkippedLog)) value.aiPlanSkippedLog = [];
  // v75: AIプラン_*.json の zeroSecThemes(0秒思考テーマ提案)に対する採否ログ。
  //      aiPlanSkippedLog/migrationRitualLogと同じ軽量配列の思想(学習ループ用データ)。
  if (!Array.isArray(value.zeroSecThemeLog)) value.zeroSecThemeLog = [];
  // v86: AIフィードバック自動取り込み(autoIngestFeedback)の冪等マーカー。取り込み済みの
  //      フィードバック日付("YYYY-MM-DD")を記録し、同じ.mdからの二重登録を防ぐ。
  if (!Array.isArray(value.feedbackIngestedDates)) value.feedbackIngestedDates = [];
  // v67: AI連携の鮮度インジケータ(柱1b)。最後に取得成功した AIフィードバック_*.md /
  //      AIプラン_*.json の日付("YYYY-MM-DD")。取得成功のたびに前進のみさせる(後退させない)。
  if (!value.aiLinkFreshness || typeof value.aiLinkFreshness !== "object") value.aiLinkFreshness = {};
  if (!("feedbackAt" in value.aiLinkFreshness)) value.aiLinkFreshness.feedbackAt = null;
  if (!("planAt" in value.aiLinkFreshness)) value.aiLinkFreshness.planAt = null;
  // v67: AI作業結果_*.json の処理済みresultId(taskId+dateから合成)。二重登録防止用。
  if (!Array.isArray(value.aiWorkProcessedIds)) value.aiWorkProcessedIds = [];
  value.feedback ||= {};
  value.reports ||= {};
  // v56: GitHub に push 済みの AIフィードバック_*.md の日付を記録する集合。
  //      起動時の optional fetch を「存在が判っている日付」に限定し、404ノイズを出さない。
  if (!Array.isArray(value.feedbackFiles)) value.feedbackFiles = [];
  // v34: 0秒思考(未知フィールドはデフォルトに足すだけで既存データを壊さない)
  value.zeroThinking ||= { themes: [], entries: [] };
  if (!Array.isArray(value.zeroThinking.themes)) value.zeroThinking.themes = [];
  if (!Array.isArray(value.zeroThinking.entries)) value.zeroThinking.entries = [];
  // v90: 大テーマ(グループ)。WBSのProjectと同じ「大枠→中身」の階層をテーマ一覧に持たせる。
  //      groups自体が欠損している旧端末データでもここで[]補完されるため消えない。
  if (!Array.isArray(value.zeroThinking.groups)) value.zeroThinking.groups = [];
  // v39: 問い(Question)エンティティ。効率化(2x)ではなく価値の中身(10x)を掘る器。
  if (!Array.isArray(value.questions)) value.questions = [];
  value.questions = value.questions.map((q) => ({
    origin: "manual",       // 'manual' | 'zero' | 'review' | 'ai' | 'user'(v68: 日報の「今日AIに聞きたいこと」)
    status: "open",         // 'open' | 'deepening' | 'settled'
    settledNote: "",
    settledAt: null,
    lastTouchedAt: null,
    linkedProjectId: null,  // v44: 結論を実行に移した先(what→how の橋)
    linkedTaskId: null,     // v44
    ...q
  }));
  // v68: 人生実験カード。1件のみ「実験中(running)」を推奨する軽量ログ
  //      (migrationRitualLog/aiPlanSkippedLogと同じ思想。判定は結論欄にKが書く=機構は集計まで)。
  if (!Array.isArray(value.experiments)) value.experiments = [];
  value.experiments = value.experiments.map((e) => ({
    hypothesis: "",
    metric: "",
    startDate: todayISO(),
    endDate: addDays(todayISO(), 14),
    status: "running",   // 'running' | 'kept' | 'dropped'
    conclusion: "",
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false,
    ...e
  }));
  // v39: theme / entry に questionId を補完(どの問いの下で書かれたか)
  value.zeroThinking.themes = value.zeroThinking.themes.map((t) =>
    "questionId" in t ? t : { ...t, questionId: null });
  // v86: theme に source を補完(既存データはnull=手動/旧経路。自動取り込み分は"ai-feedback"。
  //      ワンタップ削除時にAI由来かどうかを判定し、AI由来ならzeroSecThemeLogへ不採用記録する)。
  value.zeroThinking.themes = value.zeroThinking.themes.map((t) =>
    "source" in t ? t : { ...t, source: null });
  // v90: theme に groupId を補完(既存テーマは全て未分類=null。既存値優先で上書きしない)。
  value.zeroThinking.themes = value.zeroThinking.themes.map((t) =>
    "groupId" in t ? t : { ...t, groupId: null });
  // v119: theme に importance を補完("" | "高" の2値運用。既存テーマは全て""=既存値優先)。
  value.zeroThinking.themes = value.zeroThinking.themes.map((t) =>
    "importance" in t ? t : { ...t, importance: "" });
  value.zeroThinking.entries = value.zeroThinking.entries.map((e) =>
    "questionId" in e ? e : { ...e, questionId: null });
  // v102: entryに updatedAt を補完(既存データはnull=未追記。回答済みentryの追記編集で更新される)。
  value.zeroThinking.entries = value.zeroThinking.entries.map((e) =>
    "updatedAt" in e ? e : { ...e, updatedAt: null });
  // v104: entryに durationSec を補完(既存データはnull=未計測。書き始め→保存の実経過秒数)。
  value.zeroThinking.entries = value.zeroThinking.entries.map((e) =>
    "durationSec" in e ? e : { ...e, durationSec: null });
  // v100: AI提案お題キュー(週次抽象化/日次コーチングのバッチが suggestedThemes[] へ
  //       pending候補を追記する契約。生成・削除はバッチ側の責務で、アプリは表示・採用・却下
  //       [status遷移]のみを担う)。旧端末データは配列自体が欠損しているため[]で補完する。
  if (!Array.isArray(value.zeroThinking.suggestedThemes)) value.zeroThinking.suggestedThemes = [];
  value.zeroThinking.suggestedThemes = value.zeroThinking.suggestedThemes.map((s) => ({
    source: "daily",
    reason: "",
    status: "pending",
    adoptedThemeId: null,
    createdAt: nowDateTime(),
    ...s
  }));
  // v100: 期限切れ候補の物理削除(pending 3日 / adopted・dismissed 7日)。v103で関数化。
  value.zeroThinking.suggestedThemes = pruneExpiredSuggestedThemes(value.zeroThinking.suggestedThemes);
  // v39: 週次レビュー(キー = 週開始土曜 'YYYY-MM-DD')。指標は都度計算、メモのみ永続化。
  if (!value.weeklyReviews || typeof value.weeklyReviews !== "object") value.weeklyReviews = {};
  // v45: 12週サイクルレビュー(キー = サイクル開始日)。メモのみ永続化、指標は都度計算。
  if (!value.cycleReviews || typeof value.cycleReviews !== "object") value.cycleReviews = {};
  if (!("cycleSelectedStart" in value.settings)) value.settings.cycleSelectedStart = null;
  // v40: 週カーソル / ルーティン曜日フィルタ(UI状態、null=未設定)
  if (!("weeklySelectedWeek" in value.settings)) value.settings.weeklySelectedWeek = null;
  if (!("routineDayFilter" in value.settings)) value.settings.routineDayFilter = null;
  // v41: 日次オープン処理が最後に走った日付
  value.settings.lastOpenedDate ||= "";
  // v47: WBS の完了タスク非表示(UI状態、既定は表示)
  if (typeof value.settings.wbsHideCompleted !== "boolean") value.settings.wbsHideCompleted = false;
  // v97: タスクシュート画面「未完了タスク」の表示範囲(当日〜7日後+期日超過が既定。
  //      8日後以降は折りたたみ。UI状態、既定OFF=畳んだまま)
  if (typeof value.settings.tasksShowFuture !== "boolean") value.settings.tasksShowFuture = false;
  // v55: WBS のインライン編集モード(UI状態、既定OFF)
  if (typeof value.settings.wbsEditMode !== "boolean") value.settings.wbsEditMode = false;
  // v109: WBS のカテゴリ絞り込み(UI状態、既定は空文字="すべて")
  if (typeof value.settings.wbsCategoryFilter !== "string") value.settings.wbsCategoryFilter = "";
  // v23: 繰り返しをルール方式へ(旧データは初回のみ自動移行)
  value.recurrences ||= [];
  migrateRecurrencesIfNeeded(value);
  // v114: 保護系ルーティン(提案F、2026-07-16 K採用)。運動・睡眠・内省・家族時間など「制約
  // (集中力・体力)を保護するメンテナンス工程」は実行率で裁かず、連続欠落日数で見せるための
  // ルール属性。既定false(後方互換。既存ルールは従来どおりの表示・挙動のまま)。
  value.recurrences = value.recurrences.map((r) => ({ protection: false, ...r }));
  // v115: 縮退版(ROADMAP提案G①、2026-07-16 K採用)。保護系ルーティンが崩れた日でも
  // ワンタップで最小構成実行できるよう、繰り返しルールに縮退版のタイトル/所要分を持たせる。
  // 既定は未設定("" / null。ボタンは表示されない=後方互換)。
  value.recurrences = value.recurrences.map((r) => ({ fallbackTitle: "", fallbackMinutes: null, ...r }));
  // v115: アンカー(ROADMAP提案G③、習慣スタッキング)。既存の別ルーティン(繰り返しルールid)
  // または連続ルーティン(チェーンid)を指定すると、それが当日完了した直後の時刻にこの
  // ルーティンのBlockを自動生成する。既定は未設定("")。
  value.recurrences = value.recurrences.map((r) => ({ anchor: "", ...r }));
  // v115: 連続ルーティン(チェーン、ROADMAP提案G②)。複数の小ルーティンを順序付きでまとめ、
  // 開始→順送り表示→完了で構成要素すべてに記録を落とす。既存端末には配列自体が無いため
  // []で補完する(anchorは提案G③、既定は未設定)。
  if (!Array.isArray(value.routineChains)) value.routineChains = [];
  value.routineChains = value.routineChains.map((c) => ({
    title: "新規チェーン", steps: [], anchor: "", deleted: false,
    createdAt: nowDateTime(), updatedAt: nowDateTime(), ...c
  }));
  // v115: チェーンの当日進行状態(id=`${chainId}_${date}`)。既存端末には配列自体が無いため
  // []で補完する。currentIndexは次に完了すべきステップの添字、completedAtが付けば全ステップ完了。
  if (!Array.isArray(value.chainRuns)) value.chainRuns = [];
  value.chainRuns = value.chainRuns.map((r) => ({
    currentIndex: 0, scheduledStartAt: "", startedAt: "", completedAt: "", stepLog: [],
    createdAt: nowDateTime(), updatedAt: nowDateTime(), ...r
  }));
  // v63: WIP上限アラート(提案2)用の優先度フィールド(高/中/低)。既存Projectは「中」で後方互換補完。
  //      wish/other の自動生成Projectもここで拾われる(map は自動生成の push より後に実行するため)。
  // v95: WBS進捗率(Σ分子/Σ分母)の表示トグルを追加。既定OFF(未使用Projectでバーが乱立しないように)
  value.projects = value.projects.map((p) => ({ priority: "中", showProgress: false, updatedAt: "", ...p }));
  // v63: 戦略/雑用/休息ゲージ(提案6)用のカテゴリ属性。未設定は空文字("未分類")のまま正直に扱う。
  value.settings.categories = (value.settings.categories || []).map((c) => ({ bucket: "", ...c }));
  // v73: コンディションOS — 睡眠/服薬/余力/夜の記録/運動ログの軽量ログ(日付キー)。
  //      体調そのもの(1〜10相当)は既存の朝の体調ピッカー(state.settings.morningEnergyLog)を
  //      引き続き使い、二重管理にしない(CHANGES_v73.md参照)。
  if (!value.condition || typeof value.condition !== "object") value.condition = {};
  if (!value.condition.logs || typeof value.condition.logs !== "object") value.condition.logs = {};
  value.condition.logs = Object.fromEntries(
    Object.entries(value.condition.logs).map(([date, log]) => [date, {
      sleepHours: null,
      meds: null,
      capacity: "",
      morningRecordedAt: "",
      eveningMood: null,
      eveningNote: "",
      eveningRecordedAt: "",
      gym: [],
      ...(log || {}),
      gym: Array.isArray(log?.gym) ? log.gym : []
    }])
  );
  // v87: 宣言→終了報告ログ(ROADMAP v91)。上限300件で永続化肥大化を防ぐ(既存値優先で補完)。
  if (!Array.isArray(value.declarations)) value.declarations = [];
  value.declarations = value.declarations.slice(-300).map((d) => ({
    id: d.id || crypto.randomUUID(),
    blockId: d.blockId || "",
    date: d.date || "",
    title: d.title || "",
    estimateMin: d.estimateMin ?? null,
    note: d.note || "",
    declaredAt: d.declaredAt || "",
    reportedAt: d.reportedAt || "",
    outcome: d.outcome || "",
    resultNote: d.resultNote || "",
    ...d
  }));
  // v129: ポモドーロ身体スキャン(50分ごとのポモドーロ完了時に疲労1-5+任意部位を強制サンプリング)。
  // v106系のマージ可能コレクションとしてmergeById(idキー和集合)で扱う(0秒思考entriesと
  // 同じパターン。computeSyncMerge/applySyncMergeToLocal/applySyncMergeToRemote参照)。上限は
  // 設けない(zeroThinking.entriesと同じ思想)。
  if (!Array.isArray(value.bodyScans)) value.bodyScans = [];
  value.bodyScans = value.bodyScans.map((s) => ({
    id: s.id || crypto.randomUUID(),
    dateTime: s.dateTime || "",
    fatigue: s.fatigue || null,
    part: s.part || "",
    pomodoroBlockId: s.pomodoroBlockId || "",
    ...s
  }));
  // v141: 「今日行ったお店」ログ(ジャーナルタブから店名/URL/感想を記録、年間一覧で振り返る)。
  // 1日に複数件登録・編集・削除(tombstone)できるため、tasks/projectsと同じ
  // mergeByIdPreferNewer(updatedAt優先マージ)で多端末同期する(computeSyncMerge参照)。
  if (!Array.isArray(value.storeVisits)) value.storeVisits = [];
  value.storeVisits = value.storeVisits.map((sv) => ({
    id: sv.id || crypto.randomUUID(),
    date: sv.date || "",
    name: sv.name || "",
    url: sv.url || "",
    comment: sv.comment || "",
    createdAt: sv.createdAt || nowDateTime(),
    updatedAt: sv.updatedAt || "",
    deleted: false,
    ...sv
  }));
  // v91: 「### 依頼」節を日報テンプレの機械可読契約として追加(K指示: 依頼はこの見出し配下に
  //      書く運用へ)。既存のjournalTemplateを上書きせず、まだ持っていない端末にだけ追記する
  //      (ユーザーが自由記述欄等をカスタマイズしていても壊さない)。
  if (typeof value.settings.journalTemplate === "string" && value.settings.journalTemplate &&
      !value.settings.journalTemplate.includes("### 依頼")) {
    value.settings.journalTemplate = `${value.settings.journalTemplate.replace(/\s+$/, "")}\n\n${JOURNAL_REQUEST_SECTION}`;
  }
  // v105: 睡眠実測はAutoSleepのCSV取込(state.sleep.logs、起床日キー)に一本化。
  //       ジャーナルテンプレの手書き睡眠欄は廃止する。既存テンプレからは「未記入の
  //       デフォルト形」のみを除去し、ユーザーが値や文言を書き換えたテンプレは触らない。
  if (!value.sleep || typeof value.sleep !== "object") value.sleep = {};
  if (!value.sleep.logs || typeof value.sleep.logs !== "object") value.sleep.logs = {};
  if (typeof value.settings.journalTemplate === "string") {
    value.settings.journalTemplate = value.settings.journalTemplate
      .replace(/## 🛏 睡眠\n就寝: __:__ +\/ +起床: __:__\n質: ★+☆*\n*/, "");
  }
  // v153: 今日の庭(ADHD支援、罰なしゲーミフィケーション)。日別のルーティン完了スナップショット
  // (date ISO → {done, total})。繰り返し実体はRECURRENCE_KEEP_PAST_DAYS超過で物理削除され
  // 過去日の分母(total)が失われるため、saveState()経路のフック(updateGardenLog)で
  // 当日・選択日を都度スナップショットして保持する(設計書§③)。既存stateには存在しない
  // だけなので後方互換は自明(空オブジェクト補完のみ、過去分の遡及生成はしない)。
  if (!value.gardenLog || typeof value.gardenLog !== "object" || Array.isArray(value.gardenLog)) {
    value.gardenLog = {};
  }
  value.modal = null;  // 起動時はモーダル閉じた状態
  return value;
}

// v9: カテゴリーマスタのデフォルト
function defaultCategories() {
  return [
    { id: crypto.randomUUID(), name: "開発", color: "#007AFF" },
    { id: crypto.randomUUID(), name: "内省", color: "#34C759" },
    { id: crypto.randomUUID(), name: "営業", color: "#FF9500" },
    { id: crypto.randomUUID(), name: "学習", color: "#AF52DE" },
    { id: crypto.randomUUID(), name: "休息", color: "#8E8E93" },
    { id: crypto.randomUUID(), name: "回復", color: "#5AC8FA" }
  ];
}

// v9: 休憩メッセージマスタのデフォルト(残り秒ベース)
function defaultBreakMessages() {
  return [
    { id: crypto.randomUUID(), fromSec: 0,   toSec: 30,  message: "もうすぐ次のセッション。深呼吸して準備を。" },
    { id: crypto.randomUUID(), fromSec: 30,  toSec: 120, message: "ゆっくり水を一口。" },
    { id: crypto.randomUUID(), fromSec: 120, toSec: 240, message: "立ち上がって、肩を回しましょう。" },
    { id: crypto.randomUUID(), fromSec: 240, toSec: 301, message: "目を閉じて、息を整えて。" }
  ];
}

// v16: 人生領域マスタ(やりたいことリストのカテゴリ)
function defaultLifeAreas() {
  return [
    { id: crypto.randomUUID(), name: "健康", color: "#34C759" },
    { id: crypto.randomUUID(), name: "仕事", color: "#007AFF" },
    { id: crypto.randomUUID(), name: "家族", color: "#FF2D55" },
    { id: crypto.randomUUID(), name: "趣味", color: "#FF9500" },
    { id: crypto.randomUUID(), name: "旅",   color: "#5AC8FA" },
    { id: crypto.randomUUID(), name: "学び", color: "#AF52DE" },
    { id: crypto.randomUUID(), name: "経験", color: "#FFCC00" },
    { id: crypto.randomUUID(), name: "持物", color: "#8E8E93" }
  ];
}

// v18: Block 完了時の祝福メッセージ プール(ランダム表示用)
const CELEBRATE_MESSAGES = [
  "やったね、一歩前進!",
  "ナイス、その調子だよ",
  "お疲れさま、ちゃんとやり切れたね",
  "すごい、毎日ちゃんと動けてる",
  "えらいえらい、ちゃんと動けてるね",
  "キミならできると思ってた!",
  "その一歩、未来に効いてるよ",
  "ふぁいと、ふぁいとー!",
  "見てたよ、ナイスファイト",
  "うん、いい感じ。一緒にがんばろ",
  "うんうん、その調子その調子"
];

function getRandomCelebrate() {
  return CELEBRATE_MESSAGES[Math.floor(Math.random() * CELEBRATE_MESSAGES.length)];
}

// v9: カラーパレット(iOS 標準色)
const CATEGORY_COLOR_PRESETS = [
  "#007AFF", "#34C759", "#FF9500", "#AF52DE", "#FF2D55",
  "#5AC8FA", "#FFCC00", "#FF3B30", "#5856D6", "#8E8E93"
];

// v9: カテゴリ追加(設定画面の「+ カテゴリを追加」)
function addCategory() {
  const name = (window.prompt("新しいカテゴリ名") || "").trim();
  if (!name) return;
  const cats = state.settings.categories || [];
  if (cats.some((c) => c.name === name)) {
    showToast("同名のカテゴリが既にあります");
    return;
  }
  const usedColors = cats.map((c) => c.color);
  const nextColor = CATEGORY_COLOR_PRESETS.find((c) => !usedColors.includes(c)) || CATEGORY_COLOR_PRESETS[0];
  state.settings.categories = [...cats, {
    id: crypto.randomUUID(),
    name,
    color: nextColor
  }];
  saveAndRender(`カテゴリ「${name}」を追加しました`);
}

// v9: カテゴリ削除
function deleteCategory(catId) {
  const cat = (state.settings.categories || []).find((c) => c.id === catId);
  if (!cat) return;
  // 既存の Project/Task/Block で使用中なら警告
  const usedCount = countCategoryUsage(cat.name);
  const msg = usedCount > 0
    ? `カテゴリ「${cat.name}」を削除しますか?\n(${usedCount} 件のレコードで使用中。既存のレコードのカテゴリ表示はグレーになります)`
    : `カテゴリ「${cat.name}」を削除しますか?`;
  if (!window.confirm(msg)) return;
  state.settings.categories = (state.settings.categories || []).filter((c) => c.id !== catId);
  saveAndRender(`カテゴリ「${cat.name}」を削除しました`);
}

// v9: 指定カテゴリ名を使用している Project/Task/Block の合計数
function countCategoryUsage(name) {
  let n = 0;
  for (const p of state.projects || []) if (!p.deleted && p.category === name) n++;
  for (const t of state.tasks || []) if (!t.deleted && t.category === name) n++;
  for (const b of state.blocks || []) if (!b.deleted && b.category === name) n++;
  return n;
}

// v9: カテゴリのフィールド編集(name / color)
function updateCategoryField(catId, field, value) {
  const cats = state.settings.categories || [];
  const idx = cats.findIndex((c) => c.id === catId);
  if (idx < 0) return;
  const oldCat = cats[idx];
  const newCat = { ...oldCat, [field]: value };
  // 名前変更時は、既存の Project/Task/Block の category 値も追従させる
  if (field === "name" && value && value !== oldCat.name) {
    // v135: カテゴリ改名は実質的な内容変更のため、追従させるProject/Task/BlockのupdatedAtも
    // 更新する(更新しないと、同期マージ時に「新しい方が勝つ」判定を素通りして改名が消える)。
    state.projects = state.projects.map((p) => p.category === oldCat.name ? { ...p, category: value, updatedAt: nowDateTime() } : p);
    state.tasks = state.tasks.map((t) => t.category === oldCat.name ? { ...t, category: value, updatedAt: nowDateTime() } : t);
    state.blocks = state.blocks.map((b) => b.category === oldCat.name ? { ...b, category: value, updatedAt: nowDateTime() } : b);
    // v37: 繰り返しルールにも追従(これを忘れると、明日以降に実体化されるブロックが旧名のまま生成され、
    //      「ルーティン」カテゴリの改名ではルーティン画面から消える)
    state.recurrences = (state.recurrences || []).map((r) => r.category === oldCat.name ? { ...r, category: value } : r);
  }
  state.settings.categories = cats.map((c, i) => i === idx ? newCat : c);
  saveState();
  scheduleAutoSave();
  // 色変更はリアルタイムで見えてほしいので、メイン画面のみ再描画(設定画面入力中はフォーカスを失わないように)
  if (field === "color") {
    // 設定画面では再描画しない(カラーピッカーが閉じる) → タイムライン rail などは次回ナビ時に更新される
    // ただし、メインのレンダリングを軽く更新
  }
}

// v9: 休憩メッセージ追加
function addBreakMessage() {
  const msgs = state.settings.breakMessages || [];
  state.settings.breakMessages = [...msgs, {
    id: crypto.randomUUID(),
    fromSec: 0,
    toSec: 30,
    message: "新しいメッセージ"
  }];
  saveAndRender("休憩メッセージを追加しました");
}

// v9: 休憩メッセージ削除
function deleteBreakMessage(msgId) {
  if (!window.confirm("このメッセージを削除しますか?")) return;
  state.settings.breakMessages = (state.settings.breakMessages || []).filter((m) => m.id !== msgId);
  saveAndRender("削除しました");
}

// v9: 休憩メッセージのフィールド編集
function updateBreakMessageField(msgId, field, value) {
  const msgs = state.settings.breakMessages || [];
  const idx = msgs.findIndex((m) => m.id === msgId);
  if (idx < 0) return;
  const parsed = (field === "fromSec" || field === "toSec") ? Number(value) : value;
  state.settings.breakMessages = msgs.map((m, i) => i === idx ? { ...m, [field]: parsed } : m);
  saveState();
  scheduleAutoSave();
}

// v9: カテゴリー名から色を取得(マスタ未登録ならグレー)
function getCategoryColor(name) {
  if (!name) return "#8E8E93";
  const cats = state.settings?.categories || [];
  const found = cats.find((c) => c.name === name);
  return found ? found.color : "#8E8E93";
}

// v9: カテゴリー名一覧(編集モーダルのドロップダウン用)
function getCategoryNames() {
  return (state.settings?.categories || []).map((c) => c.name);
}

// v9: 休憩中の残り秒に対応するメッセージを取得
function getBreakMessage(remainingSec) {
  const msgs = state.settings?.breakMessages || [];
  const sec = Math.max(0, Math.floor(remainingSec));
  const found = msgs.find((m) => sec >= m.fromSec && sec < m.toSec);
  return found ? found.message : "";
}

function defaultGitHubSettings() {
  return {
    owner: "kojit1229",
    repo: "taskchute-ipad",
    branch: "main",
    path: "app-state.json",
    token: "",
    autoSave: false,
    lastSavedAt: "",
    // v72: 個人データ(app-state.json/日報/AIフィードバック/AIプラン/週次レビュー/AI作業結果/
    // Vision・Affirmation)は private リポジトリへ分離する。token/branch は上記フィールドを共用し、
    // 保存先の owner/repo だけをこの2フィールドで切り替える(既定 kojit1229/personal-data)。
    dataOwner: "kojit1229",
    dataRepo: "personal-data"
  };
}

// v9: 編集モーダルのカテゴリselectで「+ 新規カテゴリ追加」が選ばれた時の処理
function handleAddCategoryFromModal(selectEl) {
  const name = (window.prompt("新しいカテゴリ名を入力") || "").trim();
  if (!name) {
    // キャンセル: 元の値に戻す
    selectEl.value = selectEl.dataset.prevValue || "";
    return;
  }
  // 既存にあれば追加せず選択するだけ
  const existing = (state.settings.categories || []).find((c) => c.name === name);
  if (!existing) {
    const usedColors = (state.settings.categories || []).map((c) => c.color);
    const nextColor = CATEGORY_COLOR_PRESETS.find((c) => !usedColors.includes(c)) || CATEGORY_COLOR_PRESETS[0];
    state.settings.categories = [...(state.settings.categories || []), {
      id: crypto.randomUUID(),
      name,
      color: nextColor
    }];
    saveState();
    showToast(`カテゴリ「${name}」を追加しました`);
  }
  // モーダル全体を再描画して、追加されたカテゴリを反映
  rerenderActiveModal();
  // 再描画後、追加したカテゴリを選択状態にする(rerenderActiveModal で select が再生成される)
  setTimeout(() => {
    const newSelect = modalRoot.querySelector('[data-modal-field="category"]');
    if (newSelect) newSelect.value = name;
  }, 0);
}

// v9: 現在開いているモーダルを再描画(state.modal の type を見て該当 editor を再オープン)
// v146レビュー対応: 第1引数で「復元しない(=再オープン後の新しい値をそのまま見せる)フィールド」を
// 追加指定できるようにした(既定は従来どおりcategoryのみ除外)。呼び出し側の操作そのものが
// 意図的に変えた値(例: 🏁トグルによるcompleted)まで、キャッシュした古い値で巻き戻さないための
// 汎用化(既存のcategory除外ロジックと同じ仕組みを共用する)。
function rerenderActiveModal(extraExcludeFields = []) {
  if (!state.modal) return;
  const excludeFields = new Set(["category", ...extraExcludeFields]);
  // モーダル再描画前に現在のフォーム入力値を退避(除外フィールド以外の編集中の値を失わない)
  const cached = {};
  modalRoot.querySelectorAll("[data-modal-field]").forEach((el) => {
    const key = el.dataset.modalField;
    cached[key] = el.type === "checkbox" ? el.checked : el.value;
  });
  const { type, id } = state.modal;
  // モーダルを再オープン
  if (type === "project") openProjectEditor(id);
  else if (type === "task") openTaskEditor(id);
  else if (type === "block") openBlockEditor(id);
  else return;
  // 入力中の値を復元(除外フィールド以外)
  modalRoot.querySelectorAll("[data-modal-field]").forEach((el) => {
    const key = el.dataset.modalField;
    if (key in cached && !excludeFields.has(key)) {
      if (el.type === "checkbox") el.checked = cached[key];
      else el.value = cached[key];
    }
  });
}
function renderCategorySelect(currentName) {
  const names = getCategoryNames();
  // 現在の値がマスタに無い旧データの場合は、それも候補として表示(失わせない)
  const inMaster = names.includes(currentName);
  const extraOption = (currentName && !inMaster)
    ? `<option value="${escapeHTML(currentName)}" selected>${escapeHTML(currentName)}(マスタ外)</option>`
    : "";
  return `
    <select class="select" data-modal-field="category" data-prev-value="${escapeHTML(currentName || "")}">
      <option value="" ${!currentName ? "selected" : ""}>(カテゴリなし)</option>
      ${extraOption}
      ${names.map((n) => `<option value="${escapeHTML(n)}" ${n === currentName ? "selected" : ""}>${escapeHTML(n)}</option>`).join("")}
      <option value="__ADD_NEW__">+ 新規カテゴリ追加…</option>
    </select>
  `;
}

function seedState() {
  const today = todayISO();
  const projectId = crypto.randomUUID();
  const wishId = crypto.randomUUID();
  const taskA = crypto.randomUUID();
  const taskB = crypto.randomUUID();
  const taskC = crypto.randomUUID();

  return {
    currentView: "home",
    selectedDate: today,
    zeroThinking: { themes: [], entries: [], groups: [], suggestedThemes: [] },  // v90: groups=大テーマ / v100: suggestedThemes=AI提案お題キュー
    settings: {
      birthDate: "",
      twelveWeekStartDate: today,
      morningEnergyLog: {},
      journalTemplate: defaultJournal(today),
      vision: "# Vision\n\n人生の目的に沿ったプロジェクトを、日々の実行と振り返りで前に進める。",
      affirmation: "# Affirmation\n\n今日の一歩を、未来の自分に渡す。",
      journalPanes: { leftWidthPct: 25, centerWidthPct: 50, rightWidthPct: 25 },
      staticFilesLoaded: { vision: false, affirmation: false },
      github: defaultGitHubSettings()
    },
    projects: [
      {
        id: wishId,
        kind: "wish",
        title: "Wish",
        category: "回復",
        status: "active",
        twelveWeekStartDate: "",
        createdAt: nowDateTime(),
        updatedAt: nowDateTime(),
        deleted: false
      },
      {
        id: projectId,
        kind: "normal",
        title: "Web版 TaskChute Journal を育てる",
        category: "開発",
        status: "active",
        twelveWeekStartDate: today,
        createdAt: nowDateTime(),
        updatedAt: nowDateTime(),
        deleted: false
      }
    ],
    tasks: [
      {
        id: taskA,
        projectId,
        title: "PWA版のMVPを確認する",
        category: "開発",
        status: "doing",
        dueDate: today,
        createdAt: nowDateTime(),
        updatedAt: nowDateTime(),
        deleted: false
      },
      {
        id: taskB,
        projectId,
        title: "GitHub Pages公開手順を決める",
        category: "開発",
        status: "todo",
        dueDate: addDays(today, 1),
        createdAt: nowDateTime(),
        updatedAt: nowDateTime(),
        deleted: false
      },
      {
        id: taskC,
        projectId: wishId,
        title: "気分が上がる散歩コースを試す",
        category: "回復",
        status: "todo",
        dueDate: "",
        createdAt: nowDateTime(),
        updatedAt: nowDateTime(),
        deleted: false
      }
    ],
    blocks: [
      makeBlock({ taskId: taskA, date: today, title: "PWA版をiPadで触る", category: "開発", plannedStartAt: `${today}T09:00:00`, plannedEndAt: `${today}T10:00:00`, charge: 2, discharge: 1 }),
      makeBlock({ date: today, title: "昼のジャーナル", category: "内省", plannedStartAt: `${today}T12:30:00`, plannedEndAt: `${today}T12:45:00`, charge: 1, discharge: 0 }),
      makeBlock({ taskId: taskB, date: today, title: "GitHub Pagesの公開準備", category: "開発", plannedStartAt: `${today}T15:00:00`, plannedEndAt: `${today}T16:00:00`, charge: 1, discharge: 2 })
    ],
    journals: {
      [today]: defaultJournal(today)
    },
    feedback: {},
    reports: {},
    pomodoro: {
      running: false,
      blockId: "",
      startedAt: "",
      endsAt: "",
      mode: "focus"
    }
  };
}

function makeBlock(input) {
  return {
    id: crypto.randomUUID(),
    taskId: input.taskId || "",
    date: input.date || todayISO(),
    title: input.title || "新規Block",
    category: input.category || "",
    plannedStartAt: input.plannedStartAt || "",
    plannedEndAt: input.plannedEndAt || "",
    actualStartAt: input.actualStartAt || "",
    actualEndAt: input.actualEndAt || "",
    completed: Boolean(input.completed),
    charge: Number(input.charge || 0),
    discharge: Number(input.discharge || 0),
    expectedCharge: input.expectedCharge ?? "",
    expectedDischarge: input.expectedDischarge ?? "",
    estimateMin: input.estimateMin ?? null,   // v41: 見積時間(分)
    comment: input.comment || "",
    recurrenceGroupId: input.recurrenceGroupId || "",
    pomodoroCount: Number(input.pomodoroCount || 0),
    migratedTo: "",
    carryCount: Number(input.carryCount || 0),  // v61: マイグレーション儀式(繰り越し回数)
    leverageType: input.leverageType || "",  // v65: 10x機構(2-1)
    interruptions: [],  // v70: フォーカスタイマー中断(チョコ停)記録
    incompleteReason: null,  // v162: 未完了理由クイック入力 {chip, note, at} | null
    orderIndex: 0,
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
}

function render() {
  // v151: 毎回の再描画でテーマを再適用(冪等)。設定変更経路を問わず常に最新のstate.settings.themeへ
  // html[data-theme]/meta[theme-color]を同期させ、適用漏れを作らない。
  applyTheme();
  // v72: トークン+個人データリポジトリ未設定の端末は、セットアップ画面だけを表示して
  // タイムライン等の中身を一切出さない(実質ログインゲート)。localStorageの設定有無判定のみで
  // 判定し、有効性はここでは検証しない(検証は初回API呼び出しの成否=401バナーに委ねる)。
  if (!personalDataReady(state.settings.github)) {
    app.dataset.view = "gate";
    renderGate();
    return;
  }
  app.dataset.view = state.currentView;
  renderSidebar();
  renderBottomNav();
  renderMain();
  renderTimelineRail();
  renderSyncBanner();  // v43: 全再描画で消えるバナーを再注入
  renderPersonalDataAuthBanner();  // v72: 401時の案内(全再描画で消えるため再注入)
  // v40: 着手ジュースは1回の描画で消費する(次の描画では付かない)。CSS アニメは挿入時に1回再生。
  state._justStartedBlockId = null;
  // v153: 今日の芽のフェードインも同様に1回の描画で消費する。
  state._gardenJustGrewDate = null;
}

// v72: 起動時セットアップ画面(トークンゲート)。sidebar/bottomNav/timelineRailは空にし、
// #main だけにフォーム(Owner/Repository/Token)を出す。data-github-fieldは既存の
// input/changeハンドラをそのまま再利用する(設定タブの実装と同じ属性名)。
function renderGate() {
  sidebar.innerHTML = "";
  bottomNav.innerHTML = "";
  timelineRail.innerHTML = "";
  const github = state.settings.github || defaultGitHubSettings();
  main.innerHTML = `
    <div style="max-width:480px; margin:48px auto; padding:0 16px">
      <div class="panel stack" style="padding:20px">
        <h2>🔒 個人データの保護設定</h2>
        <div class="muted" style="font-size:13px; line-height:1.7">
          このアプリは日報・ジャーナル・AIフィードバックなどの個人データを、あなた専用の
          private GitHubリポジトリ(既定 <code>${escapeHTML(github.dataOwner || "kojit1229")}/${escapeHTML(github.dataRepo || "personal-data")}</code>)へ
          GitHub API 経由で保存します。正しく設定されるまでアプリの中身は表示されません。
        </div>
        <div class="muted" style="font-size:12px; line-height:1.8">
          <b>設定手順</b><br>
          1. GitHubで private リポジトリ(既定名 <code>personal-data</code>)を作成<br>
          2. Fine-grained Personal Access Token を発行し、そのリポジトリへの
          <b>Contents: Read and write</b> 権限を付与<br>
          3. 下の欄にトークンと Owner / Repository を入力して「設定してはじめる」
        </div>
        <form class="stack" autocomplete="on" onsubmit="return false">
          <label>Owner
            <input class="input" data-github-field="dataOwner" value="${escapeHTML(github.dataOwner || "")}"
              id="gh-owner" name="gh-username" autocomplete="username"
              autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="kojit1229">
          </label>
          <label>Repository
            <input class="input" data-github-field="dataRepo" value="${escapeHTML(github.dataRepo || "")}"
              autocomplete="off" placeholder="personal-data">
          </label>
          <label>Fine-grained token
            <input class="input" type="password" data-github-field="token" value="${escapeHTML(github.token || "")}"
              id="gh-token" name="gh-token" autocomplete="current-password"
              autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="GitHub token">
          </label>
        </form>
        <button class="btn primary" data-action="gate-continue">設定してはじめる</button>
        ${_personalDataAuthError ? `<div class="muted" style="color:var(--red); font-size:12px; margin-top:6px">⚠ ${escapeHTML(_personalDataAuthError)}</div>` : ""}
      </div>
    </div>
  `;
}

function renderSidebar() {
  // v11: 折りたたみ状態を反映
  const collapsed = state.settings?.sidebarCollapsed || false;
  if (collapsed) sidebar.classList.add("collapsed");
  else sidebar.classList.remove("collapsed");
  sidebar.innerHTML = `
    <div class="brand">
      <div class="brand-title">${collapsed ? "TJ" : "TaskChute Journal"}<span class="sync-dot ${syncDotClass()}" title="同期状態"></span></div>
      ${collapsed ? "" : `<div class="brand-sub">PWA / Local-first MVP</div>`}
      <button class="sidebar-toggle" data-action="toggle-sidebar" aria-label="${collapsed ? "サイドバーを開く" : "サイドバーを折りたたむ"}" title="${collapsed ? "サイドバーを開く" : "サイドバーを折りたたむ"}">${collapsed ? "▶" : "◁"}</button>
    </div>
    <div class="nav-list">
      ${navItems.map((item) => `
        <button class="nav-button ${state.currentView === item.id ? "active" : ""}" data-action="nav" data-view="${item.id}" title="${item.label}">
          <span class="nav-mark">${item.mark}</span>
          <span class="nav-label">${item.label}</span>
        </button>
      `).join("")}
    </div>
  `;
}

// v148レビュー対応(Codex指摘・項目3): ルーティンは「その他」から実行系(タスクシュート)
// 上部リンクへ昇格した(moreGroupsから除外済み)ため、bottom-navの現在地表示も「その他」
// ではなく「実行」(mobileNavのid "tasks")をactiveにする。
function bottomNavEffectiveView(view) {
  return view === "routine" ? "tasks" : view;
}
function renderBottomNav() {
  const effectiveView = bottomNavEffectiveView(state.currentView);
  const active = mobileNav.some((item) => item.id === effectiveView) ? effectiveView : "more";
  bottomNav.innerHTML = mobileNav.map((item) => `
    <button class="${active === item.id ? "active" : ""}" data-action="nav" data-view="${item.id}">${item.label}</button>
  `).join("");
}

// v146(UI改善計画Phase1-2): タスクシュートの「着手中(無ければ次の未着手)Block」を求める。
// homeHero/nowConveyorTargetと同じ抽出ロジック(現在時刻に該当する未完了Block、無ければ
// 次の未着手)を使うが、対象はrenderTasks()が実際に描画するBlock集合に限定する
// (renderTasks()は単発Block・ルーティン・timeline由来・Project未紐づけTaskのBlock等を
// 描画しないため、それらを選ぶと自動スクロールが無言で不発になる。レビュー指摘対応)。
function tasksViewRenderedBlocks(dateISO) {
  return blocksForDate(dateISO).filter((b) => {
    if (b.source === "timeline") return false;
    if (b.category === "ルーティン") return false;
    if (b.recurrenceGroupId) return false;
    if (!b.taskId) return false;
    if (isStaleBlock(b)) return false;
    const task = state.tasks.find((t) => t.id === b.taskId);
    if (!task || !task.projectId) return false;
    return true;
  });
}
function currentOrNextTaskchuteBlockId(dateISO) {
  const isToday = dateISO === todayISO();
  const tl = tasksViewRenderedBlocks(dateISO)
    .filter((b) => b.plannedStartAt)
    .sort((a, b) => minutesOf(a.plannedStartAt) - minutesOf(b.plannedStartAt));
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const current = isToday ? tl.find((b) => !b.completed
    && minutesOf(b.plannedStartAt) <= nowMin
    && nowMin < minutesOf(b.plannedEndAt || b.plannedStartAt)) : null;
  const target = current || tl.find((b) => !b.completed && !b.actualStartAt);
  return target ? target.id : null;
}

// v146レビュー対応: 自動スクロールは「ビュー切替・日付切替・初回描画」のときだけ発火させる
// (直前のview/dateをここに記憶して比較する)。同一view+dateのままの再描画(チェック操作等
// によるsaveAndRender()経由のrender())では毎回スクロール位置を巻き戻さない
// (レビュー実測: ホーム1440px・タスクシュート1310pxの巻き戻りが起きていた)。
let _lastScrollView = null;
let _lastScrollDate = null;


function renderMain() {
  // v70: Now画面(実行コンベア)は全ビューに優先する全画面オーバーレイ(閉じるまで通常UIへ戻らない)
  if (nowMode) {
    main.innerHTML = renderNowConveyor();
    return;
  }
  // v115: 連続ルーティン(チェーン)の進行中も同様に全画面優先で表示する
  // v170: _activeChainIdはsrc/features/routine.jsのモジュールプライベート変数になったため、
  //       isChainRunActive()経由で判定する(値そのものは露出させない)。
  if (isChainRunActive()) {
    main.innerHTML = renderChainRun();
    return;
  }
  const view = state.currentView;
  // v146レビュー対応: フォーカスガードはmain.innerHTMLを差し替える「前」に評価する(差し替え後は
  // 旧main内のフォーカス要素がDOMごと消えてbodyへ戻ってしまい、判定が構造的に効かなくなるため)。
  // 自作ガードではなく既存のisFocusInEditableElement(input/textarea/contenteditable判定)を使う。
  const isNewViewOrDate = view !== _lastScrollView || state.selectedDate !== _lastScrollDate;
  const shouldAutoScroll = isNewViewOrDate && state.selectedDate === todayISO() && !isFocusInEditableElement();
  _lastScrollView = view;
  _lastScrollDate = state.selectedDate;

  if (view === "home") {
    main.innerHTML = renderHome();
    // v146: 今日を表示中なら「いま、これ」(=着手中/次の未着手Blockそのもの)へ自動スクロール
    // (タイムラインの.now-line自動スクロールと同じ「探す手間をなくす」目的)
    // v149レビュー対応(必須4、Codex指摘): ホームタブ滞在中は.home-heroが存在しないため、
    // 他ビューから戻ってきた際にscrollIntoViewが不発になり前のスクロール位置に取り残される。
    // .home-heroが無ければ.home-tabbar(常に両タブ共通で先頭にある)へフォールバックする。
    if (shouldAutoScroll) {
      setTimeout(() => {
        const target = document.querySelector(".home-hero") || document.querySelector(".home-tabbar");
        target?.scrollIntoView({ block: "start" });
      }, 50);
    }
  }
  if (view === "wbs") main.innerHTML = renderWBS();
  if (view === "wish") main.innerHTML = renderWish();
  if (view === "avoid") main.innerHTML = renderAvoid(state, escapeHTML, renderHeader);
  if (view === "tasks") {
    main.innerHTML = renderTasks();
    // v146: タスクシュートも着手中(無ければ次の未着手)Blockへ自動スクロール
    if (shouldAutoScroll) {
      const targetId = currentOrNextTaskchuteBlockId(state.selectedDate);
      if (targetId) {
        setTimeout(() => document.querySelector(`strong[data-action="edit-block"][data-id="${targetId}"]`)?.scrollIntoView({ block: "center" }), 50);
      }
    }
  }
  if (view === "routine") main.innerHTML = renderRoutine();
  if (view === "timeline") {
    main.innerHTML = renderTimelineView();
    // v47: 今日を表示中なら現在時刻ラインへ自動スクロール(探す手間をなくす)
    if (state.selectedDate === todayISO()) {
      setTimeout(() => document.querySelector(".now-line")?.scrollIntoView({ block: "center" }), 50);
    }
  }
  if (view === "pomodoro") main.innerHTML = renderPomodoro();
  if (view === "journal") main.innerHTML = renderJournal();
  if (view === "zero") main.innerHTML = renderZeroThinking();
  if (view === "vision") main.innerHTML = renderVision();
  if (view === "reports") main.innerHTML = renderReports();
  if (view === "ai-reports") main.innerHTML = renderAiReports();
  if (view === "weekly") main.innerHTML = renderWeekly();
  if (view === "cycle") main.innerHTML = renderCycle();
  if (view === "dashboard") main.innerHTML = renderDashboard();
  if (view === "stats") main.innerHTML = renderStats();  // v53: 計器盤
  if (view === "settings") main.innerHTML = renderSettings();
  if (view === "more") main.innerHTML = renderMore();
}

// v175: renderTimelineRailはsrc/features/timeline.jsへ移動した(app.js分割・段階4-6・段階B③)。
//   呼び出しはファイル冒頭のimportを参照する。

function renderHeader(eyebrow, title, action = "") {
  // v148(UI改善計画Phase3-1): 「その他」配下のビューを開いているとき、bottom-navは
  // 常に「その他」がactiveになり現在地が分からない(codex-ui-review N1)。ヘッダに
  // 「その他 › 群名」を1行添えるだけの軽い方式で現在地を示す(moreGroups参照)。
  const groupLabel = moreGroupLabelFor(state.currentView);
  const breadcrumb = groupLabel ? `<div class="view-breadcrumb">その他 › ${groupLabel}</div>` : "";
  return `
    <div class="view-header">
      <div>
        ${breadcrumb}
        <div class="eyebrow">${eyebrow}</div>
        <h1>${title}</h1>
      </div>
      ${action}
    </div>
    ${bufferMeterHTML()}
  `;
}

// =============================================================
// v31: ホーム(コックピット)— 信条 / 残り時間 / 行動パネル群
// =============================================================
// v71: 情報過多だったコックピットを整理。
// v146(UI改善計画Phase1-1): 行動優先の縦順序へ再編。
// v149(UI改善計画Phase4a、K指定2026-07-27): ホームを「今日」(行動系。既定タブ)/「ホーム」
//   (内省・参照系)の2タブへ分割。タブ選択はhomeTab(非永続・モジュール変数、起動時は常に
//   「今日」)。日付ナビ(前日/日付/翌日/今日へ/検索)はヘッダー領域(renderHeaderのaction欄)へ
//   統合し独立行を廃止(縦幅圧縮)。詳細な振り分け対応表はCHANGES_v149.md参照。
function renderHome() {
  const today = state.selectedDate;
  const isToday = today === todayISO();
  const blocks = blocksForDate(today);
  const metrics = computeMetrics();
  // v73: 縮退モード。今日を見ている時だけ発火する(過去日を振り返っている時にまで
  //      「最低限だけ」と出すのは意味が違うため)。
  const degraded = isToday && isConditionDegraded(today);
  return `
    <div class="home-header-wrap">
      ${renderHeader("今日の入口", "ホーム", `<div class="row" style="gap:8px; flex-wrap:wrap">
        <button class="btn orange" data-action="now-mode-open">▶ Now</button>
        ${renderDateBar()}
      </div>`)}
    </div>
    ${homeSyncAlertBanner()}
    <div class="segmented home-tabbar" style="margin-bottom:4px">
      <button class="${homeTab === "today" ? "active" : ""}" data-action="home-tab" data-tab="today">今日</button>
      <button class="${homeTab === "home" ? "active" : ""}" data-action="home-tab" data-tab="home">ホーム</button>
    </div>
    ${homeTab === "home"
      ? renderHomeReflectTab(metrics, blocks, isToday, degraded)
      : renderHomeTodayTab(blocks, isToday, degraded, metrics)}
  `;
}

// v149: 「今日」タブ本体 — 旧renderHomeの行動系すべて(hero〜足あと)。K指定の起動時既定タブ。
function renderHomeTodayTab(blocks, isToday, degraded, metrics) {
  return `
    ${homeHero(blocks, isToday)}
    ${homeTodayEnemyCard(isToday)}
    <div id="home-mit-anchor">${homeMIT(blocks)}</div>
    <div class="home-zone-block z-amber" id="homezone-1">
      <div class="home-zone amber">今日、すすめる${projectedEndBadge()}</div>
      <div class="home-grid single">
        ${homeTaskchute(blocks)}
      </div>
    </div>
    <div class="home-zone-block z-teal" id="homezone-2">
      ${degraded ? `
        <details class="home-fold" data-fold-id="zone2-degraded" ${isHomeFoldOpen("zone2-degraded", false) ? "open" : ""}>
          <summary class="home-zone teal home-fold-summary"><span class="home-fold-chevron">▶</span>今日のリズム(たたんでいます)・${homeZone2Summary(blocks)}</summary>
          <div class="home-fold-body">
            <div class="home-grid">
              ${homeFlow(blocks, isToday)}
              ${homeRoutine(blocks, isToday)}
            </div>
          </div>
        </details>
      ` : `
        <details class="home-fold" data-fold-id="zone2" ${isHomeFoldOpen("zone2", true) ? "open" : ""}>
          <summary class="home-zone teal home-fold-summary"><span class="home-fold-chevron">▶</span>今日のリズム・${homeZone2Summary(blocks)}</summary>
          <div class="home-fold-body">
            <div class="home-grid">
              ${homeFlow(blocks, isToday)}
              ${homeRoutine(blocks, isToday)}
            </div>
          </div>
        </details>
      `}
    </div>
    ${homeTodayStatusCard()}
    ${homeWeeklyWishCard()}
    ${degraded ? "" : homeReadingCard()}
    ${degraded ? homeDegradedBanner() : homeRoutineCheckBanner(blocks, isToday)}
    ${homeScoreboard(blocks)}
    <div id="homezone-3">${homeCycle(metrics)}</div>
    ${homeBacklog()}
    <div class="home-zone-block z-green" id="homezone-4">
      <details class="home-fold" data-fold-id="zone4" ${isHomeFoldOpen("zone4", false) ? "open" : ""}>
        <summary class="home-zone green home-fold-summary"><span class="home-fold-chevron">▶</span>今日の足あと</summary>
        <div class="home-fold-body">
          <div class="home-grid single">
            ${homeSteps(blocks)}
          </div>
        </div>
      </details>
    </div>
    ${homeQuoteCard(isToday)}
  `;
}

// v149: 「ホーム」タブ本体 — 内省・参照系(三つの信条/寿命/アファメーション=今日の理想・宣言/
// AIから/長い弧)。K指定「信条・寿命はこのタブでは既定展開(折りたたまない)」により、旧来
// defaultOpen=falseだったcreed/lifespanをtrueへ変更(ローカル記憶が無い初回のみ有効。
// 折りたたみ機構自体は残す)。「アファメーション」はK指示で「今日の理想/宣言まわりの該当カード」
// (homeIdeal/homeDeclarationCard)と対応付け(CHANGES_v149.md参照)。
function renderHomeReflectTab(metrics, blocks, isToday, degraded) {
  return `
    ${homeReflectFoldSection("creed", "home-creed", "home-creed-head", "三 つ の 信 条", homeCreedBody())}
    ${homeReflectFoldSection("lifespan", "home-lifespan", "", "寿命カウントダウン(残り時間)", homeLifespanBody(metrics))}
    ${homeIdeal(isToday)}
    ${homeDeclarationCard()}
    ${homeVisionCard()}
    ${homeFutureLetterLink()}
    ${degraded
      ? homeFoldSection("ai-hub-degraded", false, "home-ai-hub", "", "AIから(たたんでいます)", homeAiHubBody(blocks, isToday))
      : homeFoldSection("ai-hub", false, "home-ai-hub", "", "AIから", homeAiHubBody(blocks, isToday))}
    <div class="home-zone-block z-blue" id="home-arc-zone">
      <details class="home-fold" data-fold-id="zone3" ${isHomeFoldOpen("zone3", false) ? "open" : ""}>
        <summary class="home-zone blue home-fold-summary"><span class="home-fold-chevron">▶</span>長い弧をたしかめる</summary>
        <div class="home-fold-body">
          <div class="home-grid">
            ${homeQuestions()}
          </div>
          ${homeWeeklyLink()}
        </div>
      </details>
    </div>
  `;
}

// --- 三つの信条 ---
// v62: Daily_Affirmation.md v4.1(実データ裏付け型に刷新)と整合させ、ハードコードの
//      標語からKの実データ(MIT達成率100%・実行率と充電の無相関・朝型)に基づく文言へ更新。
// v71: 参照系セクションとして折りたたみ化(homeFoldSection)するため、本体行のみを返す
//      body専用関数にした(見出し「三 つ の 信 条」は折りたたみのsummary側で表示する)。
function homeCreedBody() {
  const creeds = [
    ["決めた一つは、", "必ずやり切れる(MIT達成率100%)"],
    ["進んだ量で測る。", "実行率で自分を裁かない"],
    ["朝に全部を注ぐ。", "夜は手放して充電する"]
  ];
  const nums = ["一", "二", "三"];
  return creeds.map((c, i) => `
    <div class="home-creed-row">
      <span class="home-creed-num">${nums[i]}</span>
      <span class="home-creed-text">${escapeHTML(c[0])}<br>${escapeHTML(c[1])}</span>
    </div>`).join("");
}

// --- 残り時間(今年 / 45歳 / 80歳)---
// v71: 参照系セクションとして折りたたみ化(homeFoldSection)するため、本体(.home-life グリッド)
//      のみを返すbody専用関数にした。
function homeLifespanBody(metrics) {
  const items = metrics.filter((m) => m.label !== "12WY");
  if (items.length === 0) return "";
  return `
    <div class="home-life">
      ${items.map((m) => `
        <div class="home-life-cell">
          <div class="home-life-top">
            <span class="home-life-label">${m.label}</span>
            <span class="home-life-pct">${Math.round(m.progress)}%経過</span>
          </div>
          <div class="home-life-num">${(m.value || "").replace("あと", "")}</div>
          <div class="progress"><span style="width:${clamp(m.progress, 0, 100)}%"></span></div>
        </div>`).join("")}
    </div>`;
}

// 予定時刻の範囲表示
function plannedRange(b) {
  const s = b.plannedStartAt ? timeFromDateTime(b.plannedStartAt) : "—";
  const e = b.plannedEndAt ? timeFromDateTime(b.plannedEndAt) : "—";
  return `${s} – ${e}`;
}

// v61: =========================================================
//  「今日の理想」ワンライナー + 3日リトライ(提案8)
//  朝イチで書く軽量版の理想(長期のVision/Affirmationとは別粒度)。
//  journalMeta[date].ideal に保存し、書いた日から3日間ホームに残す。3日目には
//  達成/未達を問わず「続けるか手放すか」だけを一言で尋ね、翌日以降も見えるようにする。
// =========================================================
const IDEAL_RETRY_WINDOW_DAYS = 3;

// 今日を起点に直近3日以内で最後に「今日の理想」が書かれた日を探す(今日→昨日→一昨日の順)。
// dayNum: 1=書いた当日 / 2=翌日 / 3=3日目(続ける/手放すを問う日)
function idealActiveEntry(today) {
  for (let offset = 0; offset < IDEAL_RETRY_WINDOW_DAYS; offset++) {
    const d = addDays(today, -offset);
    const text = state.journalMeta[d]?.ideal;
    if (text) return { date: d, text, dayNum: offset + 1 };
  }
  return null;
}

// ホームの「いま、これ」の上に表示する軽量カード。未入力日はUIを邪魔しない(空なら非表示に近い最小表示)。
function homeIdeal(isToday) {
  if (!isToday) return "";
  const today = todayISO();
  const active = idealActiveEntry(today);
  if (!active) {
    // v81: 未入力日は常時フル表示のカードでは場所を取りすぎるため(UX監査A5)、
    // 既存の折りたたみ機構(homeFoldSection)を再利用し、既定は閉じた1行プレースホルダに縮小する。
    // 保存ロジック(input handlerのdata-ideal-date処理)自体は変更しない。
    return homeFoldSection(
      "home-ideal-empty",
      false,
      "home-ideal home-ideal-empty",
      "muted",
      "今日の理想を一行で(任意・タップで記入)",
      `<input type="text" class="home-ideal-input" maxlength="60"
        placeholder="今日の理想を一行で(任意・スキップ可)"
        data-ideal-date="${today}" value="">`
    );
  }
  const retryDay = active.dayNum >= IDEAL_RETRY_WINDOW_DAYS;
  return `<section class="panel home-ideal">
    <div class="home-ideal-row">
      <span class="home-ideal-eyebrow">今日の理想(${active.dayNum}日目)</span>
      <span class="home-ideal-text">${escapeHTML(active.text)}</span>
    </div>
    ${retryDay ? `
      <div class="home-ideal-retry">
        <span class="muted" style="font-size:12px">3日間、この理想と過ごしました。続けますか、手放しますか?</span>
        <span class="row" style="gap:6px; margin-top:6px">
          <button class="btn" data-action="ideal-retry" data-choice="continue">続ける</button>
          <button class="btn ghost" data-action="ideal-retry" data-choice="release">手放す</button>
        </span>
      </div>` : ""}
  </section>`;
}

// v117(A): 今日の宣言。dailyDeclarations[date] = {text, updatedAt}。selectedDateごとに編集できる
// (過去日を振り返る時も同じ入力欄で確認・修正できる、他のjournal系日付キー入力と同じ思想)。
// homeIdealと異なりisTodayに関わらず常時表示する(過去日の宣言も見返せるようにするため)。
// v147: 未入力時の赤警告はここから撤去し、homeTodayStatusCard(「今日の状態」1枚化)へ統合した
// (UI改善計画Phase2 2-2。警告チップ4種の重複表示を避けるため)。
function homeDeclarationCard() {
  const date = state.selectedDate;
  const entry = state.dailyDeclarations[date] || { text: "", updatedAt: "" };
  return `<section class="panel home-declaration-card" style="padding:12px 14px">
    <div class="muted" style="font-size:12px; font-weight:700; margin-bottom:6px">📣 今日の宣言</div>
    <input type="text" class="input" style="font-size:16px" maxlength="80"
      data-declaration-date="${date}" placeholder="今日◯◯に着手する" value="${escapeHTML(entry.text || "")}">
  </section>`;
}

// v149レビュー対応(必須3): K指定リスト「80歳ビジョン」の導線カード。ホームには専用の
// 80歳ビジョンカードそのもの(PDF/画像表示)は無い(既存実装は「ビジョン」タブのビジョン
// ボード内サブページとしてのみ存在)ため、新規カードを追加せず既存のビジョンボードへの
// ワンタップ導線として実装した(機能そのものを複製しない)。
function homeVisionCard() {
  return `<section class="panel home-vision-card" style="padding:12px 14px; cursor:pointer" data-action="open-vision-board" data-index="2">
    <div class="row" style="justify-content:space-between; align-items:center">
      <span class="muted" style="font-size:12px; font-weight:700">🌅 80歳ビジョン</span>
      <span class="muted" style="font-size:12px">見る →</span>
    </div>
  </section>`;
}

// v128: 体力予算チップ。conditionBudget()の判定を宣言カード付近に表示する。
// 過去日を見ている時も(睡眠ログがあれば)その日の判定をそのまま出す(睡眠カードと同じ流儀)。
function homeConditionBudgetChip() {
  const budget = conditionBudget(state.selectedDate);
  // v147(UI改善計画Phase2 2-2 色ルール): 赤は同期異常等データ保全系の異常だけに使う。
  // 体力予算「赤字」はデータ破損ではないため、他の低調状態(low)と同じオレンジへ統一する
  // (taskchute-notes/decisions.md 2026-07-27参照)。
  const style = {
    deficit: { bg: "var(--orange-soft)", fg: "var(--orange-text)" },
    low: { bg: "var(--orange-soft)", fg: "var(--orange-text)" },
    normal: { bg: "var(--green-soft)", fg: "var(--green-text)" },
    none: { bg: "var(--panel-soft)", fg: "var(--muted)" }
  }[budget.level];
  const label = budget.level === "none" ? "データなし" : CONDITION_BUDGET_LABELS[budget.level];
  return `
    <div class="row home-condition-budget-chip" style="margin-bottom:10px; padding:8px 12px; border-radius:10px; background:${style.bg}; align-items:center; gap:8px; flex-wrap:wrap">
      <span style="font-size:13px; font-weight:700; color:${style.fg}">🔋 体力予算: ${label}</span>
      ${budget.reason ? `<span class="muted" style="font-size:12px">${escapeHTML(budget.reason)}</span>` : ""}
    </div>`;
}

// v147レビュー対応: 電池残量の「良好/要注意」を判定する単一の閾値。旧実装はチップの警告色
// (旧: pct<60でオレンジ)と今日の状態カードの非表示条件(旧: pct>=30で良好)が別の値で
// 不整合だった。既存のrecoveryThresholdPct既定値(40)と揃え、以後はこの1箇所だけを見る。
const BATTERY_OK_PCT = 40;

// v144/v147: 電池残量の計算(homeBatteryChip・homeTodayStatusCardの両方が必要とするため
// 共通ヘルパーへ統一。旧実装は同じ計算を2箇所に重複していた)。当日限定(呼び出し側でtoday判定)。
function computeHomeBatteryInfo(date) {
  const def = defaultBatterySettings();
  const cfg = state.settings.battery || def;
  const max = Number.isFinite(cfg.max) ? cfg.max : def.max;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const level = computeBatteryLevel(date, nowMinutes);
  const pct = max > 0 ? clamp((level / max) * 100, 0, 100) : 0;
  return { level, max, pct, ok: pct >= BATTERY_OK_PCT };
}

// v144: エネルギーバッテリーチップ。computeBatteryLevel()の現在残量を数値+簡易バーで表示する
// だけの受け身の表示(点滅・バッジ・通知は一切なし=静かな計器の最低線を守る)。当日の完了Block
// 変更(充放電編集・完了登録)は他のdata-actionハンドラが呼ぶrender()で自然に再描画され、
// 時間経過(減衰)はupdateBatteryTick()(startTimerTicker経由、約1分間隔)が差分更新する。
// レビュー対応(監督者裁定): 既定パラメタでは過去日は構造的に残量0(≒毎回赤ゲージ)になり
// 「裁かない」思想に反するため、当日限定で表示する(homeDeclarationCardと同じ型)。
function homeBatteryChip() {
  const date = state.selectedDate;
  if (date !== todayISO()) return "";
  const { level, pct, ok } = computeHomeBatteryInfo(date);
  // v147(UI改善計画Phase2 2-2 色ルール): 赤は同期異常等データ保全系の異常だけに使う。
  // 電池残量の低下はデータ破損ではないため赤を使わず、低残量=オレンジ/健全=緑の2段にする。
  // レビュー対応: 文字色(AA対応の-textトークン)とバー塗り色(装飾、素の彩色トークン)を分ける
  // — バーはAA対応の対象外(装飾要素)なので暗くする必要が無く、視認性の良い元の彩度に戻す。
  const textColor = ok ? "var(--green-text)" : "var(--orange-text)";
  const barColor = ok ? "var(--green)" : "var(--orange)";
  return `
    <div class="row home-battery-chip" style="margin-bottom:10px; padding:8px 12px; border-radius:10px; background:var(--panel-soft); align-items:center; gap:8px; flex-wrap:wrap">
      <span style="font-size:13px; font-weight:700; color:${textColor}">🔋 残量 ${Math.round(level)}</span>
      <span class="home-battery-bar" style="flex:1; min-width:60px; height:8px; border-radius:4px; background:var(--line); overflow:hidden">
        <span style="display:block; height:100%; width:${pct}%; background:${barColor}; border-radius:4px"></span>
      </span>
    </div>`;
}

// v121: 今週のやりたいこと(Wishからの週次選定)。homeDeclarationCardと同じ思想で、
// 今日を見ている時だけ判定・表示する(過去日を振り返っている時に警告するのは筋違い)。
// 週キーはweekRange().weekStart(土曜起点、12週サイクルの週定義と統一)をそのまま使う
// ため、週替わり時のリセット処理は不要(参照するキーが自然に変わるだけ)。
// v147: 未設定時の赤警告バナーはここから撤去し、homeTodayStatusCard(「今日の状態」1枚化)へ
// 統合した(UI改善計画Phase2 2-2)。設定済みの一覧表示(以下)は無変更。
function homeWeeklyWishCard() {
  const date = state.selectedDate;
  if (date !== todayISO()) return "";
  const weekKey = weekRange(date).weekStart;
  const entry = state.weeklyWishes[weekKey];
  const taskIds = (entry && entry.taskIds) || [];
  if (taskIds.length === 0) return "";
  // 削除済み・実現済みになったWishはtaskIdsを書き換えず、表示からだけ自然に外す
  const wishes = taskIds
    .map((wid) => state.tasks.find((t) => t.id === wid))
    .filter((t) => t && !t.deleted && !t.realized);
  // v122: 各Wishに「今日へ」ボタンを追加(wishSubtaskToTasksを再利用)。既に今日Block化済みなら
  // ボタンの代わりに控えめな「済」表示にする(二重登録は既存関数側のトーストガードでも弾かれる)。
  const wishRowHTML = (w) => {
    const blockedToday = state.blocks.some((b) => !b.deleted && b.taskId === w.id && b.date === date);
    return `
      <li class="row" style="justify-content:space-between; align-items:center; gap:8px; padding:3px 0">
        <span>${escapeHTML(w.title)}</span>
        ${blockedToday
          ? `<span class="muted" style="font-size:11px">済</span>`
          : `<button class="btn ghost" style="font-size:13px; padding:4px 9px" data-action="wish-subtask-to-tasks" data-id="${w.id}">今日へ</button>`}
      </li>`;
  };
  return `
    <section class="panel home-weekly-wish-card" style="padding:12px 14px; margin-bottom:10px">
      <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:6px">
        <span class="muted" style="font-size:12px; font-weight:700">🌟 今週のやりたいこと</span>
        <button class="btn ghost" style="font-size:16px; padding:6px 10px" data-action="weekly-wish-open">変更</button>
      </div>
      ${wishes.length
        ? `<ul style="margin:0; padding-left:0; list-style:none; font-size:14px">${wishes.map(wishRowHTML).join("")}</ul>`
        : `<div class="muted" style="font-size:12px">選択したやりたいことは表示できなくなりました</div>`}
    </section>`;
}

// v147:「今日の状態」1枚化(UI改善計画Phase2 2-2)。宣言未入力・体力予算・電池残量・週Wish
// 未設定の4種を1つの折りたたみカードへ統合する。<summary>行(常時表示)に1〜2行の要約を出し、
// 個別チップ・個別アラートの本体はdetails内(既定closed、home-foldの共通パターンを流用)。
// 4つとも良好(宣言済み・週Wish設定済み・体力予算が正常/データなし・電池残量BATTERY_OK_PCT
// (=40)以上)なら何も返さずカードごと非表示にする(「未対応0件+状態正常なら非表示」)。
// バッテリーの良好判定はhomeBatteryChip()の警告色閾値と同じcomputeHomeBatteryInfo()を使う
// (レビュー対応: 旧実装はpct>=30(非表示)とpct<60(チップの警告色)が別値で不整合だった)。
// 過去日を見ている時は電池/宣言未入力/週Wishの警告がそもそも対象外(homeBatteryChip等と同じ
// 「今日限定」の思想)なので、体力予算チップだけを単独表示する従来の見え方を維持する。
function homeTodayStatusCard() {
  const date = state.selectedDate;
  if (date !== todayISO()) {
    return `<div class="home-chip-2col">${homeConditionBudgetChip()}</div>`;
  }
  const declEntry = state.dailyDeclarations[date] || { text: "" };
  const declFilled = !!(declEntry.text || "").trim();
  const budget = conditionBudget(date);
  const budgetOK = budget.level === "normal" || budget.level === "none";
  const { level, ok: batteryOK } = computeHomeBatteryInfo(date);
  const weekKey = weekRange(date).weekStart;
  const wishEntry = state.weeklyWishes[weekKey];
  const wishSet = !!(wishEntry && wishEntry.taskIds && wishEntry.taskIds.length);
  if (declFilled && wishSet && budgetOK && batteryOK) return "";  // 未対応0件+状態正常
  const budgetLabel = budget.level === "none" ? "データなし" : CONDITION_BUDGET_LABELS[budget.level];
  const summary = `エネルギー: ${budgetLabel}・残量${Math.round(level)} / 準備: ${declFilled ? "宣言済み" : "宣言未入力"}・${wishSet ? "週Wish設定済み" : "週Wish未設定"}`;
  const body = `<div class="home-chip-2col">${homeConditionBudgetChip()}${homeBatteryChip()}</div>
    ${!declFilled ? `<div class="home-today-status-item muted" style="font-size:12px; margin-top:6px; display:flex; align-items:center; gap:8px; flex-wrap:wrap">📣 今日の宣言が未入力です<button class="btn ghost" style="font-size:13px; padding:3px 9px" data-action="home-tab" data-tab="home">ホームタブへ →</button></div>` : ""}
    ${!wishSet ? `<div class="home-today-status-item muted" style="font-size:12px; margin-top:6px; display:flex; align-items:center; gap:8px; flex-wrap:wrap">🌟 今週のやりたいことが未設定です<button class="btn ghost" style="font-size:13px; padding:3px 9px" data-action="weekly-wish-open">設定する</button></div>` : ""}`;
  return homeFoldSection("today-status", false, "home-today-status", "", summary, body);
}

// 選択モーダルを開く(設定する/変更どちらも同じモーダル。既存選択はチェック済みで開く)
function openWeeklyWishModal() {
  state.modal = { type: "weeklyWish" };
  renderModal(buildWeeklyWishModal());
}
function buildWeeklyWishModal() {
  const wishProject = getWishProject();
  const weekKey = weekRange(todayISO()).weekStart;
  const selected = new Set(((state.weeklyWishes[weekKey] || {}).taskIds) || []);
  // 未実現・未削除のトップレベルWishのみ選択対象
  const candidates = wishProject
    ? state.tasks.filter((t) => !t.deleted && t.projectId === wishProject.id && !t.parentTaskId && !t.realized)
    : [];
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">🌟 今週のやりたいこと(最大3つ)</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        ${candidates.length ? candidates.map((w) => `
          <label class="row" style="gap:8px; align-items:center; padding:6px 0; font-size:16px">
            <input type="checkbox" style="width:20px; height:20px" data-action="weekly-wish-toggle" data-wish-id="${w.id}" ${selected.has(w.id) ? "checked" : ""}>
            <span>${escapeHTML(w.title)}</span>
          </label>`).join("")
          : `<div class="muted">Wishリストが空です。先にWishタブで追加してください</div>`}
      </div>
      <div class="modal-footer">
        <button class="btn" data-action="modal-close">キャンセル</button>
        <button class="btn primary" data-action="weekly-wish-submit">保存</button>
      </div>
    </div>`;
}
function submitWeeklyWish() {
  // v124: UI層(preventDefault)に加え保存側でも3件ハードキャップ(reviewer指摘: 支援技術等で
  // 4件checkedになった場合の防波堤。先頭3件を採用)
  const ids = Array.from(modalRoot.querySelectorAll("input[data-wish-id]:checked")).map((el) => el.dataset.wishId).slice(0, 3);
  const weekKey = weekRange(todayISO()).weekStart;
  state.weeklyWishes[weekKey] = { taskIds: ids, updatedAt: nowDateTime() };
  closeModal();
  saveAndRender(ids.length ? "今週のやりたいことを設定しました" : "今週のやりたいことをクリアしました");
}

// 3日目の「続ける/手放す」選択を解決する
function resolveIdealRetry(choice) {
  const today = todayISO();
  const active = idealActiveEntry(today);
  if (!active || active.dayNum < IDEAL_RETRY_WINDOW_DAYS) return;
  if (choice === "continue") {
    // 今日を起点に新しい3日間サイクルを始める(同じ理想のまま継続)
    const meta = (state.journalMeta[today] ||= { aiMitCandidates: [], aiImported: false, ideal: "", aiTaskCandidates: [] });
    meta.ideal = active.text;
    saveAndRender("理想を続けます");
  } else {
    // 手放す: 元の理想を空にして3日間の表示窓を閉じる(否定ではなく次への区切り)
    const meta = state.journalMeta[active.date];
    if (meta) meta.ideal = "";
    saveAndRender("また次の理想を見つけましょう");
  }
}

// v74: 読書複利化 — =========================================================
//  既存49冊分のKindleハイライト(個人データリポジトリ taskchute/reading/highlights.json)を
//  日替わりで1件だけ提示し、「自分の言葉で1行言語化する」入力を reading/reflections.json へ
//  push する。新しいタブは作らず、ホームカード1枚+週次レビューの折りたたみで完結させる。
// =========================================================

// 文字列から決定論的な整数ハッシュを作る(日付ごとに毎回違う書籍/ハイライトを選ぶため。
// 「日にち mod 冊数」だと月をまたいで同じ選ばれ方に偏るので、日付文字列全体をハッシュ化する)
function dateHashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
  return h;
}

// 今日提示するハイライトを1件選ぶ(cachedReadingHighlights未取得/0件ならnull)
function todaysReadingPick() {
  const books = cachedReadingHighlights;
  if (!Array.isArray(books) || books.length === 0) return null;
  const date = todayISO();
  const bookIdx = dateHashSeed(date) % books.length;
  const book = books[bookIdx];
  const highlights = Array.isArray(book?.highlights) ? book.highlights : [];
  if (highlights.length === 0) return null;
  const hIdx = dateHashSeed(`${date}|${book.id || bookIdx}`) % highlights.length;
  const h = highlights[hIdx];
  return {
    bookId: book.id || "",
    bookTitle: book.title || "",
    author: book.author || "",
    ref: h.ref || "",
    text: h.text || ""
  };
}

// ホームカード: 今日のハイライト提示 + 1行言語化の入力欄。ハイライトが引けない
// (未取得・personal-data未設定・0冊)なら何も出さない(既存の404フェイルソフトと同じ流儀)
function homeReadingCard() {
  const pick = todaysReadingPick();
  if (!pick) return "";
  const date = todayISO();
  const saved = cachedReadingReflections[date] || "";
  // v82(B3): 常時フル表示だとホームの一等地を占有するため既定closedの折りたたみへ縮小。
  //      ただし1行言語化の入力があるカードなので、朝の動線で気づけるよう書名+記入状況を
  //      summary行に出す(タップで展開すればハイライト本文と入力欄が現れる。保存ロジックは無変更)。
  const body = `
    <div class="home-reading-book">${escapeHTML(pick.bookTitle)}${pick.author ? `<span class="muted" style="font-size:12px"> — ${escapeHTML(pick.author)}</span>` : ""}</div>
    <div class="home-reading-highlight">${escapeHTML(pick.text)}</div>
    <textarea class="home-reading-input" data-reading-reflection-input rows="2"
      placeholder="読んで何を思うか、一行で">${escapeHTML(saved)}</textarea>
    <div class="row" style="justify-content:flex-end;margin-top:6px">
      <button class="btn primary" data-action="reading-save">保存</button>
    </div>`;
  const summary = `今日の1冊から: ${pick.bookTitle}${saved ? "(記入済み)" : "(未記入)"}`;
  return homeFoldSection("home-reading", false, "home-reading", "", summary, body);
}

// v74: personal-data リポジトリのサブディレクトリpath("reading/reflections.json"等)への
// 書き込み専用PUT。既存 pushFileToGitHub は `personalDataPath(encodeURIComponent(filename))`
// という組み立てのため、filename に "/" が含まれると丸ごと%2Fにエンコードされてしまい
// サブディレクトリを正しく指せない(既存の呼び出し元は全てフラットなファイル名のため顕在化して
// いなかった)。fetchGitHubRawText / gitHubContentsURL と同じ「セグメントごとにencodeして"/"で
// 結合」方式で正しいURLを組み立てる。
async function pushGitHubPath(relPath, content, label) {
  const raw = state.settings.github;
  if (!personalDataReady(raw)) {
    throw new Error("GitHub設定(個人データリポジトリ・token)が未入力です");
  }
  const cfg = personalDataConn(raw);
  const branch = cfg.branch || "main";
  const encPath = personalDataPath(relPath).split("/").map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${encPath}`;
  let sha = "";
  try {
    const head = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, {
      headers: githubHeaders(cfg.token)
    });
    if (head.ok) {
      const payload = await head.json();
      sha = payload.sha || "";
    }
  } catch (e) {
    // 新規ファイル
  }
  const response = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(cfg.token),
    body: JSON.stringify({
      message: `chore: update ${relPath} ${new Date().toISOString()}`,
      content: toBase64(content),
      branch,
      ...(sha ? { sha } : {})
    })
  });
  if (!response.ok) {
    throw new Error(await gitHubErrorMessage(response));
  }
  if (label) showToast(`📤 ${label} をGitHubへpushしました`);
}

// reflections.json のスキーマ(このアプリが正): { "entries": [{ date, bookId, bookTitle, author,
// highlightRef, highlightText, reflection, savedAt }, ...] }。1日1件(同じdateは上書き)。
// loop/scripts/reading-monthly-extract.py の寛容パース仕様(トップレベル配列 or {entries:[...]}、
// 各要素は "date" キー必須)に適合させている。
function parseReadingReflections(raw) {
  if (!raw) return [];
  let data;
  try { data = JSON.parse(raw); } catch { return []; }
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.entries)) return data.entries;
  return [];
}

// 今日の言語化入力を読み→マージ→書き込みする(読み込み専用GET + 書き込み専用PUTの単純flow。
// 楽観排他はしない設計。他日のエントリを消さないよう、必ず既存entriesを取得してから
// 今日の分だけ差し替える)
async function saveReadingReflection() {
  const el = document.querySelector("[data-reading-reflection-input]");
  if (!el) return;
  const text = (el.value || "").trim();
  if (!text) { showToast("言語化を入力してください"); return; }
  if (!personalDataReady(state.settings.github)) {
    showToast("GitHub設定(個人データリポジトリ)が未入力です");
    return;
  }
  const pick = todaysReadingPick();
  if (!pick) { showToast("今日のハイライトを取得できていません"); return; }
  const date = todayISO();
  try {
    // v74 should-fix: 404(本当に無い)と401/5xx/ネットワーク例外(読めたかどうか分からない)を
    // 区別する。後者を「まだ無い」として空配列から始めてしまうと、一過性の読み失敗の直後に
    // pushGitHubPathが成功した場合、reflections.jsonが「今日の1件だけ」に上書きされ、
    // 過去の全言語化が消失しうる。そのため非404失敗時は空ベースでの上書きを禁止し、保存自体を
    // 中断する(throw → 下のcatchでtoast表示、pushGitHubPathは呼ばれない)。
    const result = await fetchGitHubRawResult("reading/reflections.json");
    let entries;
    if (result.ok) {
      entries = parseReadingReflections(result.text);
    } else if (result.status === 404) {
      entries = [];  // 真の404(初回保存)のみ空から始めてよい
    } else {
      throw new Error(`既存データの読み込みに失敗したため保存を中止しました(status: ${result.status || "network"})`);
    }
    entries = entries.filter((e) => !(e && e.date === date));
    entries.push({
      date,
      bookId: pick.bookId,
      bookTitle: pick.bookTitle,
      author: pick.author,
      highlightRef: pick.ref,
      highlightText: pick.text,
      reflection: text,
      savedAt: nowDateTime()
    });
    entries.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    await pushGitHubPath("reading/reflections.json", JSON.stringify({ entries }, null, 2) + "\n", "読書の言語化");
    cachedReadingReflections[date] = text;
    saveAndRender("言語化を保存しました");
  } catch (e) {
    showToast(`保存失敗: ${e.message}`);
  }
}

// hydrateStaticMarkdown から呼ばれる。(1) highlights.json は一度取得できたらキャッシュのまま
// 使い回す(ほぼ静的データのため)。(2) 当日分の reflections.json は起動のたび1回だけ取得し、
// 既に保存済みなら入力欄をプリフィルする。(3) 今月の summary_YYYY-MM.md は月1回だけ取得を試み、
// 404はフェイルソフト(非表示のまま)。戻り値: 再描画が必要な変更があったか
async function hydrateReadingData() {
  let changed = false;
  if (cachedReadingHighlights === null) {
    const raw = await fetchGitHubRawText("reading/highlights.json");
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.books)) {
          cachedReadingHighlights = data.books;
          changed = true;
        }
      } catch { /* 壊れたJSONは無視。cachedReadingHighlightsはnullのままで次回起動時に再取得を試みる */ }
    }
  }
  const date = todayISO();
  if (!(date in cachedReadingReflections)) {
    const raw = await fetchGitHubRawText("reading/reflections.json");
    const entry = parseReadingReflections(raw).find((e) => e && e.date === date);
    cachedReadingReflections[date] = (entry && typeof entry.reflection === "string") ? entry.reflection : "";
    changed = true;
  }
  const month = date.slice(0, 7);
  if (!(month in cachedReadingSummaryMd)) {
    const md = await fetchGitHubRawText(`reading/summary_${month}.md`);
    cachedReadingSummaryMd[month] = md || "";
    if (md) changed = true;
  }
  return changed;
}

// v74: 週次レビュータブの折りたたみ表示。今月分が無ければ(バッチ未生成/404)何も出さない
function readingMonthlySummarySectionHTML() {
  const month = todayISO().slice(0, 7);
  const md = cachedReadingSummaryMd[month] || "";
  if (!md) return "";
  return homeFoldSection(`reading-summary-${month}`, false, "", "",
    `📖 今月の読書ふりかえり(${month})`,
    `<div class="md-render readonly-md">${renderMarkdown(md)}</div>`);
}

// --- いま、これ(進行中 / 次のブロック)── v33: フル幅・2カラム ---
function homeHero(blocks, isToday) {
  // タイムラインと同じ対象(カテゴリ「ルーティン」は除外)。時刻順にソート
  // v48: 中断/中止タスクの未完了 Block は「いま、これ」に出さない
  const tl = blocks
    .filter((b) => b.category !== "ルーティン" && b.plannedStartAt && !isStaleBlock(b))
    .sort((a, b) => minutesOf(a.plannedStartAt) - minutesOf(b.plannedStartAt));
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  // タイムラインの「現在時刻ブロック」= 予定時間が今を含む未完了Block
  const current = isToday ? tl.find((b) => !b.completed
    && minutesOf(b.plannedStartAt) <= nowMin
    && nowMin < minutesOf(b.plannedEndAt || b.plannedStartAt)) : null;
  // 現在時刻にブロックが無ければ、次の未着手ブロック
  const target = current || tl.find((b) => !b.completed && !b.actualStartAt);
  if (!target) {
    return `<section class="panel home-hero">
      <div class="eyebrow" style="color:var(--orange-text)">いま、これ</div>
      <div style="font-size:15px;font-weight:700;color:var(--green-text);padding:8px 0">
        ${tl.length ? "いまの時間のブロックはありません。" : "今日のブロックはまだありません。"}</div>
    </section>`;
  }
  const started = Boolean(target.actualStartAt);
  let mid;
  if (target === current) {
    const s = minutesOf(target.plannedStartAt);
    const e = minutesOf(target.plannedEndAt || target.plannedStartAt);
    const pct = e > s ? clamp(Math.round(((nowMin - s) / (e - s)) * 100), 0, 100) : 0;
    const left = Math.max(0, e - nowMin);
    mid = `<div class="progress" style="margin:12px 0 8px"><span style="width:${pct}%"></span></div>
      <div style="font-size:13.5px">${started ? "取り組み中" : "いまの時間です"} — 残り <strong>${left}分</strong></div>`;
  } else {
    mid = `<div style="font-size:13.5px;margin-top:12px">まだ着手していません。</div>
      <div style="font-size:12.5px;color:var(--orange-text);font-weight:600;margin-top:3px">まず5分でいい。やれば乗ってくる。</div>`;
  }
  // v150(UI改善計画Phase4b・R3): 完了作法統一。即完了(toggle-block)へ変更、実績は
  // 完了直後のトースト「実績を編集」から直す(下記toggleBlock参照)。
  const btn = started
    ? `<button class="btn green home-hero-btn" data-action="toggle-block" data-id="${target.id}">✓ 完了にする</button>`
    : `<button class="btn orange home-hero-btn" data-action="now-start" data-id="${target.id}">▶ いま着手する</button>`;
  // このあとのブロック
  // v37: 「target の次」は target 自身を除いた最初の未来ブロック。
  //      以前の [current ? 0 : 1] は、target が過去枠(期限切れの未着手)のときに
  //      本来の次ブロックを飛ばして2番目を表示していた。
  const after = tl.find((b) => !b.completed && b !== target && minutesOf(b.plannedStartAt) > nowMin);
  const nextBox = after
    ? `<div class="home-hero-next"><span class="home-hero-next-lab">このあと</span>
        <strong>${after.plannedStartAt ? timeFromDateTime(after.plannedStartAt) : ""}</strong> ${escapeHTML(after.title)}</div>`
    : "";
  const heroJuice = target.id === state._justStartedBlockId ? " just-started" : "";  // v40: 着手ジュース
  return `<section class="panel home-hero${heroJuice}">
    <div class="eyebrow" style="color:var(--orange-text)">いま、これ</div>
    <div class="home-hero-grid">
      <div class="home-hero-main">
        <div class="home-hero-title" data-action="edit-block" data-id="${target.id}">${escapeHTML(target.title)}</div>
        <div class="muted" style="font-size:12.5px;margin-top:5px">予定 ${plannedRange(target)}${
          target.category ? `<span class="home-hero-cat">${escapeHTML(target.category)}</span>` : ""}</div>
        ${mid}
      </div>
      <div class="home-hero-side">
        ${btn}
        ${nextBox}
      </div>
    </div>
  </section>`;
}

// v157: AI機能1「今日の敵」。自宅PCバッチ(loop/scripts/today-enemy.sh)が生成した
// 今日の敵_<today>.md(ラスボス風ナレーション1段落)を、hero直後に既定openの折りたたみカードで
// 表示する。ファイルが無い日(cachedTodayEnemyMdに当日分が無い)は、下記の
// `if (!raw) return "";` で早期returnし何も出さない(homeFoldSection自体の
// 「bodyHTMLが空ならカードごと出さない」仕様には到達しない。2026-07-28レビュー対応・項目7:
// 実際のガード箇所を指す記述に修正)。
// 過去日を閲覧中(isToday===false)は出さない(当日の演出であり、過去日を読み返す機能ではないため)。
const TODAY_ENEMY_MAX_CHARS = 4000;  // today-enemy-validate.pyのバッチ側上限と揃える(表示側の二重防御)
function homeTodayEnemyCard(isToday) {
  if (!isToday) return "";
  const raw = (cachedTodayEnemyMd[todayISO()] || "").trim();
  if (!raw) return "";
  const clipped = raw.length > TODAY_ENEMY_MAX_CHARS
    ? `${raw.slice(0, TODAY_ENEMY_MAX_CHARS)}…`
    : raw;
  // v157: バッチ生成物はMarkdownではなくプレーンテキスト契約(FORMAT_CONTRACT.md)のため
  // renderMarkdownは使わず、escapeHTML済みテキストをそのまま表示する(内部のMarkdown/HTML記法を
  // 誤って実行させないための防御。改行はwhite-space:pre-wrapで見た目だけ保持する)。
  const bodyHTML = `
    <div style="white-space:pre-wrap; line-height:1.6">${escapeHTML(clipped)}</div>
    <div class="muted" style="font-size:11px; margin-top:8px">※AI演出(自動生成のジョーク文章です)</div>
  `;
  return homeFoldSection("today-enemy", true, "home-today-enemy", "", "👹 今日の敵", bodyHTML);
}

// v158: AI機能2「勝手に格言」。自宅PCバッチ(loop/scripts/quote-forge.sh)が生成した
// 勝手に格言_<today>.json(前日の行動にちなんだ偉人風の捏造格言)を、今日タブ最下部
// (「今日の足あと」の下)に小さな1行カードで表示する。ファイルが無い日/JSONパース失敗/
// quote・author欠損(cachedQuoteJsonに当日分が無い、hydrateStaticMarkdown側でフェイルソフト
// 済み)は何も出さない。過去日を閲覧中(isToday===false)も出さない(今日の敵と同じ「当日限定」
// 演出の思想)。表示側でもバッチ側の上限(quote200字/author80字)と揃えた二重防御クリップを行う。
const QUOTE_CARD_QUOTE_MAX_CHARS = 200;   // quote-forge-validate.pyのQUOTE_MAX_CHARSと揃える
const QUOTE_CARD_AUTHOR_MAX_CHARS = 80;   // quote-forge-validate.pyのAUTHOR_MAX_CHARSと揃える
function homeQuoteCard(isToday) {
  if (!isToday) return "";
  const q = cachedQuoteJson[todayISO()];
  if (!q || !q.quote || !q.author) return "";
  // 2026-07-28レビュー対応・項目1(Codex指摘): 絵文字等はJSの.length/.sliceだとUTF-16
  // コード単位(サロゲートペアは2単位)で数えるため、境界がサロゲートの途中に落ちると
  // 文字化け(孤立サロゲート「�」)を起こす。Array.fromでコードポイント単位に分割してから
  // クリップし、バッチ側(quote-forge-validate.py、Pythonのlen()=コードポイント単位)と
  // 数え方を一致させる。
  const clip = (s, max) => {
    const codePoints = Array.from(s);
    return codePoints.length > max ? `${codePoints.slice(0, max).join("")}…` : s;
  };
  const quote = clip(q.quote, QUOTE_CARD_QUOTE_MAX_CHARS);
  const author = clip(q.author, QUOTE_CARD_AUTHOR_MAX_CHARS);
  // v158: "※AIによる捏造です" はJSONの"note"フィールドを読まず、固定文言としてここで
  // 常時付ける(quote-forge-validate.py側の信頼境界と対称。バッチが将来壊れても注記自体は
  // 必ず出る)。
  return `<div class="panel home-quote-card" style="font-size:12px; padding:8px 12px; display:flex; align-items:baseline; gap:6px; flex-wrap:wrap">
    <span>📜 ${escapeHTML(quote)} — ${escapeHTML(author)}</span>
    <span class="muted">※AIによる捏造です</span>
  </div>`;
}

// v33: 12週サイクル「今週の進捗」(homeCycle と同一ロジック)
function cycleWeekProgress(dateISO) {
  const date = dateISO || state.selectedDate;
  // v33: 12WY にチェック済みの Project のみ(homeCycle と一致)
  const goals = state.projects.filter((p) =>
    !p.deleted && p.kind === "normal" && p.status === "active" && p.twelveWeekStartDate);
  const goalIds = goals.map((p) => p.id);
  const allTasks = state.tasks.filter((t) => !t.deleted && goalIds.includes(t.projectId) && isTaskCountable(t));  // v35: 中断/中止は分母から除外
  const { weekStart, weekEnd } = weekRange(date);
  const weekTasks = allTasks.filter((t) => t.dueDate && t.dueDate >= weekStart && t.dueDate <= weekEnd);
  const done = weekTasks.filter((t) => t.status === "completed").length;
  const total = weekTasks.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

// v33: 今日のタスクシュート対象ブロック(homeTaskchute と着手率で共用)
//   Project に紐づく Block のみ。単発ブロック(kind:"other" の受け皿 Task)は除外。
// v48: 紐づく Task が中断/中止/削除された未完了 Block は「もう実行しない計画」。
//      一覧・着手率・繰り越し提案から外す(完了済み Block は実績として残す)。
//      Task 完了時の残 Block は toggleTask の確認ダイアログで人が整理する(自動では隠さない)。
function isStaleBlock(b) {
  if (b.completed || !b.taskId) return false;
  const task = state.tasks.find((t) => t.id === b.taskId);
  if (!task) return false;
  return task.deleted || task.status === "suspended" || task.status === "cancelled";
}

function taskchuteBlocks(blocks) {
  return blocks.filter((b) => {
    if (b.source === "timeline") return false;
    if (b.category === "ルーティン") return false;
    if (b.recurrenceGroupId) return false;
    if (!b.taskId) return false;
    if (isStaleBlock(b)) return false;  // v48: 中断/中止/削除タスクの未完了分は分母から外す
    const task = state.tasks.find((t) => t.id === b.taskId);
    if (!task || !task.projectId) return false;
    if (task.kind === "other") return false;  // 単発ブロックは非表示
    return true;
  });
}

// v33: タスクシュート着手率(homeTaskchute と同一の抽出)
function taskchuteStartRate(blocks) {
  const list = taskchuteBlocks(blocks);
  const done = list.filter((b) => b.completed || b.actualStartAt).length;
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}

// v170: routineRate〜renderChainRun(今日の庭S1/S2・保護系ルーティン・過集中ブレーカー・
// 連続ルーティン(チェーン)データ操作、計467行)はsrc/features/routine.jsへ移動した
// (app.js分割・段階4-4)。Homeタブ側(homeRoutine/homeScoreboard/homeZone2Summary/
// homeRoutineCheckBanner)はimportで参照する(冒頭import文参照)。

// --- ひと目スコアボード(4つの達成率)── v33 ---
function homeScoreboard(blocks) {
  const tc = taskchuteStartRate(blocks);
  const rt = routineRate(blocks);
  const wk = cycleWeekProgress();
  const mit = blocks.filter((b) => b.isMIT);
  const mitDone = mit.filter((b) => b.completed).length;
  const mitPct = mit.length ? Math.round((mitDone / mit.length) * 100) : 0;
  const cell = (cls, lab, num, unit, frac, pct, jump) => `
    <div class="home-score ${cls}" data-action="home-jump" data-id="${jump}">
      <div class="home-score-lab">${lab}</div>
      <div class="home-score-val">
        <span class="home-score-num">${num}</span><span class="home-score-unit">${unit}</span>
        <span class="home-score-frac">${frac}</span>
      </div>
      <div class="progress home-score-bar"><span style="width:${pct}%"></span></div>
    </div>`;
  // v71: 「今日の主役」はhomeMITがトップ(home-mit-anchor)に移動したため、ジャンプ先もそこに追従
  const body = `<div class="home-scoreboard">
    ${cell("orange", "タスクシュート着手", tc.pct, "%", `${tc.done}/${tc.total}`, tc.pct, "homezone-1")}
    ${cell("orange", "今日の主役", mitDone, `/${mit.length}`, "MIT", mitPct, "home-mit-anchor")}
    ${cell("green", "ルーティン実行", rt.pct, "%", `${rt.done}/${rt.total}`, rt.pct, "homezone-2")}
    ${cell("blue", "12週 今週", wk.pct, "%", `${wk.done}/${wk.total}`, wk.pct, "homezone-3")}
  </div>`;
  // v82(B3): ホーム常時表示スリム化のため既定closedの折りたたみへ。集計値自体は
  //      summary行に要約表示するので、閉じたままでも「ひと目」の用は足りる。
  const summary = `ひと目スコア: 着手${tc.pct}% ・ 主役${mitDone}/${mit.length} ・ ルーティン${rt.pct}% ・ 12週${wk.pct}%`;
  return homeFoldSection("home-scoreboard", false, "", "", summary, body);
}

// チェック+編集できる行(Block 用)
// v33: ホーム行のインライン充電/放電セレクト(編集画面を開かず記録)
function homeChargeSelects(b) {
  return `<span class="home-cd-wrap">
    <span class="home-cd-lab c">充</span>
    <select class="home-cd" data-block-field="charge" data-id="${b.id}" aria-label="充電(0-5)">${rangeOptions(0, 5, b.charge || 0)}</select>
    <span class="home-cd-lab d">放</span>
    <select class="home-cd" data-block-field="discharge" data-id="${b.id}" aria-label="放電(0-5)">${rangeOptions(0, 5, b.discharge || 0)}</select>
  </span>`;
}

// v114: 第4引数extraBadgeは保護系ルーティンの連続欠落バッジ用(任意、既存呼び出しは
// 渡さないため常に空文字扱いで従来どおり)。
// v115: 第5引数extraButtonは縮退版実行ボタン用(任意、既存呼び出しは渡さないため常に
// 空文字扱いで従来どおり)。
function homeCheckRow(b, star, showCD, extraBadge, extraButton) {
  // v150(UI改善計画Phase4b・R3): 完了作法統一により、完了/未完了どちらもtoggle-blockに一本化
  // (旧: 未完了→complete-block-with-actualで実績モーダルが割り込んでいた)。
  return `<div class="home-ck ${b.completed ? "done" : ""}">
    <span class="home-box" data-action="toggle-block" data-id="${b.id}">${b.completed ? "✓" : ""}</span>
    <span class="home-ck-name" data-action="edit-block" data-id="${b.id}">${escapeHTML(b.title)}</span>
    ${star ? `<span class="home-star">${star}</span>` : ""}
    ${extraBadge || ""}
    ${extraButton || ""}
    ${showCD ? homeChargeSelects(b) : ""}
  </div>`;
}

// --- 今日の主役(MIT)---
// v71: 前日AIフィードバックのMIT候補ブロックは「AIから」カード(homeAiHub / aiFeedbackCandidatesHTML)へ
//      移動した(散らばったAI系表示の集約)。追加アクション自体(mit-candidate-add)は変更していない。
function homeMIT(blocks) {
  const mit = blocks.filter((b) => b.isMIT);
  const done = mit.filter((b) => b.completed).length;
  const rows = mit.length
    ? mit.map((b) => homeCheckRow(b, "★")).join("")
    : `<div class="muted" style="font-size:13px;padding:6px 0">タスクシュート画面の ☆ で、今日の主役(最大3)を設定できます。</div>`;
  return `<section class="panel">
    <div class="home-plabel orange">今日の主役<span class="home-count">${done} / ${mit.length}</span></div>
    ${rows}
    ${mit.length ? `<div class="home-foot">今日はこの${mit.length}つ。ここに集中する。</div>` : ""}
  </section>`;
}

// v38: AIフィードバックのMIT候補を、今日の主役ブロックとして追加する
function addMITCandidate(title) {
  const text = (title || "").trim();
  if (!text) return;
  const today = todayISO();
  const sameDayMITs = state.blocks.filter((b) => !b.deleted && b.date === today && b.isMIT);
  if (sameDayMITs.length >= 3) return showToast("今日の主役は最大3個まで。先に他を外してください");
  const block = makeBlock({ date: today, title: text });
  block.isMIT = true;
  state.blocks.push(block);
  saveAndRender("✦ 今日の主役に追加しました(時間はタスクシュート画面で設定できます)");
}

// --- 今日のタスクシュート(着手率)---
// v147(UI改善計画Phase2 2-1a): 分母をヒートマップ等と同じ「当日の全Block」へ統一すると、
// この関数自体が一覧表示する対象(Project紐づきBlockのみ)と分母がズレて「X/Yブロック」の
// 表記がY≠一覧件数になり別の混乱を生む(母数統一が意味を壊すケース)。そのため分母は
// 従来どおりProject紐づきBlockのままとし、見出しへ「(Project紐づき)」を明示する代替案を採る
// (taskchute-notes/decisions.md 2026-07-27参照)。
function homeTaskchute(blocks) {
  // v33: Project に紐づく Block のみ(単発ブロックは taskchuteBlocks で除外)
  const list = taskchuteBlocks(blocks);
  if (!list.length) {
    return `<section class="panel"><div class="home-plabel orange">今日のタスクシュート(Project紐づき)</div>
      <div class="muted" style="font-size:13px">Projectに紐づくBlockがありません。</div></section>`;
  }
  const started = list.filter((b) => b.completed || b.actualStartAt).length;
  const pct = Math.round((started / list.length) * 100);
  const rows = list.map((b) => {
    const st = b.completed ? "done" : (b.actualStartAt ? "doing" : "todo");
    const badge = st === "doing" ? `<span class="home-badge doing">着手中</span>`
      : (st === "todo" ? `<span class="home-badge todo">未着手</span>` : "");
    // v150(UI改善計画Phase4b・R3): 完了作法統一。toggle-blockに一本化(homeCheckRow同様)。
    return `<div class="home-tc ${st}">
      <span class="home-dot ${st}" data-action="toggle-block" data-id="${b.id}">${b.completed ? "✓" : ""}</span>
      <span class="home-tc-name" data-action="edit-block" data-id="${b.id}">${escapeHTML(b.title)}</span>${badge}
      ${homeChargeSelects(b)}</div>`;
  }).join("");
  return `<section class="panel"><div class="home-plabel orange">今日のタスクシュート(Project紐づき)</div>
    <div class="home-rate"><span class="home-rate-cap">着手率</span>
      <span class="home-rate-pct">${pct}%</span>
      <span class="home-rate-frac">${started} / ${list.length} ブロック</span></div>
    <div class="progress" style="margin-bottom:10px"><span style="width:${pct}%;background:var(--orange)"></span></div>
    ${rows}</section>`;
}

// --- 今日のながれ ---
function homeFlow(blocks, isToday) {
  // タイムラインと同様、カテゴリ「ルーティン」は除外
  const list = blocks.filter((b) => b.category !== "ルーティン");
  if (!list.length) {
    return `<section class="panel"><div class="home-plabel">今日のながれ</div>
      <div class="muted" style="font-size:13px">本日のブロックがありません。</div></section>`;
  }
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const rows = list.map((b) => {
    const s = minutesOf(b.plannedStartAt);
    const e = minutesOf(b.plannedEndAt || b.plannedStartAt);
    const isNow = isToday && !b.completed && nowMin >= s && nowMin < e;
    const cls = b.completed ? "done" : (isNow ? "now" : "");
    return `<div class="home-flow ${cls}">
      <span class="home-flow-time">${b.plannedStartAt ? timeFromDateTime(b.plannedStartAt) : "—"}</span>
      <span class="home-dot ${b.completed ? "done" : ""}" data-action="toggle-block" data-id="${b.id}">${b.completed ? "✓" : ""}</span>
      <span class="home-flow-name" data-action="edit-block" data-id="${b.id}">${escapeHTML(b.title)}</span>
      ${isNow ? `<span class="home-badge doing">NOW</span>` : ""}
      ${homeChargeSelects(b)}</div>`;
  }).join("");
  return `<section class="panel"><div class="home-plabel">今日のながれ</div>${rows}</section>`;
}

// v153: 今日の芽(zone2ルーティンカード内)。4状態(土/芽/若木/開花)を静的パスの出し分けだけで
// 表現する(成長トゥイーンは作らない。homeSteps()と同じテンプレートリテラルSVG方式、
// createElementNS不使用)。色は3段階の緑濃淡のみ(decisions.md 2026-07-27 K確定:
// 完了1件=薄緑/50%以上=緑/全完了=濃緑。オレンジの花は使わない)。
// justGrewはtoggleBlock()が完了操作直後にだけ立てる非永続フラグ由来(state._justStartedBlockIdと
// 同じ「1回の描画で消費」パターン)。文言は罰なしルール⑥(加点表現のみ)に従い、
// done===0(土)のときは何も言わず沈黙する(「まだ」「未達」等は出さない)。
function gardenSproutHTML(rank, done, justGrew) {
  if (rank < 0) return "";  // その日ルーティン0件 → 非表示(設計書§④)
  const pot = `<path d="M9 39 L37 39 L33 45 L13 45 Z" fill="none" stroke="var(--line)" stroke-width="2"/>
    <ellipse cx="23" cy="39" rx="13" ry="3" fill="var(--line-soft)"/>`;
  // v153レビュー対応(2026-07-28): 塗り色は<g class="g-stageN">側のCSS color(--garden-pale/
  // mid/deep)に一本化し、パス側はcurrentColorだけを参照する(段階配色をCSSトークン化した
  // ことで、opacity半透明合成のテーマ依存問題を避ける。stylesheet参照)。
  let plant = "", stageCls = "", emoji = "";
  if (rank === 1) {  // 芽: 双葉
    stageCls = "g-stage1"; emoji = "🌱";
    plant = `<path d="M23 39 L23 30" stroke="currentColor" stroke-width="2" fill="none"/>
      <path d="M23 32 Q17 28 15 32 Q19 36 23 32" fill="currentColor"/>
      <path d="M23 32 Q29 28 31 32 Q27 36 23 32" fill="currentColor"/>`;
  } else if (rank === 2) {  // 若木: 茎+葉
    stageCls = "g-stage2"; emoji = "🌿";
    plant = `<path d="M23 39 L23 18" stroke="currentColor" stroke-width="2.5" fill="none"/>
      <path d="M23 26 Q15 22 14 28 Q19 32 23 26" fill="currentColor"/>
      <path d="M23 22 Q31 18 32 24 Q27 28 23 22" fill="currentColor"/>`;
  } else if (rank === 3) {  // 開花: 茎+葉+花
    stageCls = "g-stage3"; emoji = "🌸";
    plant = `<path d="M23 39 L23 16" stroke="currentColor" stroke-width="2.5" fill="none"/>
      <path d="M23 26 Q15 22 14 28 Q19 32 23 26" fill="currentColor"/>
      <circle cx="23" cy="12" r="5" fill="currentColor"/>
      <circle cx="17" cy="14" r="3.5" fill="currentColor"/>
      <circle cx="29" cy="14" r="3.5" fill="currentColor"/>
      <circle cx="23" cy="8" r="3.5" fill="currentColor"/>`;
  }
  const svg = `<svg class="home-garden-svg${justGrew ? " garden-grew" : ""}" width="46" height="46"
    viewBox="0 0 46 46" aria-hidden="true">${pot}<g class="${stageCls}">${plant}</g></svg>`;
  const caption = done ? `<div class="home-garden-caption">今日は${done}件できた ${emoji}</div>` : "";
  return `<div class="home-garden">${svg}${caption}</div>`;
}

// --- 今日のルーティン(実行率)---
// v89: isToday引数を追加(ゼロ摩擦ルーティンチェックの一括確定ボタンは今日のみ表示するため)。
function homeRoutine(blocks, isToday) {
  const r = blocks.filter((b) => b.category === "ルーティン");
  const done = r.filter((b) => b.completed).length;
  const pct = r.length ? Math.round((done / r.length) * 100) : 0;
  const rows = r.length
    // v114: 保護系ルーティン(protection:true)は実行率でなく連続欠落バッジを追加表示する
    // (protectionRuleForがnullを返す=protection:falseの既存ルーティンはバッジ無しで従来どおり)。
    ? r.map((b) => homeCheckRow(b, "", true, protectionStreakBadgeHTML(b), fallbackButtonHTML(b, isToday))).join("")
    : `<div class="muted" style="font-size:13px">カテゴリ「ルーティン」のBlockがここに表示されます。</div>`;
  const overdue = isToday ? overdueUncheckedRoutines(r) : [];
  // v153: 今日の芽。カードの日付は呼び出し元(renderHomeTodayTab)でstate.selectedDateに固定。
  const gardenRank = gardenStageRank({ done, total: r.length, pct });
  const gardenJustGrew = gardenRank >= 0 && state._gardenJustGrewDate === state.selectedDate;
  return `<section class="panel"><div class="home-plabel green">今日のルーティン</div>
    ${gardenSproutHTML(gardenRank, done, gardenJustGrew)}
    ${r.length ? `<div class="home-rate"><span class="home-rate-cap">実行率</span>
      <span class="home-rate-pct green">${pct}%</span>
      <span class="home-rate-frac">${done} / ${r.length}</span></div>
      <div class="progress" style="margin-bottom:10px"><span style="width:${pct}%"></span></div>` : ""}
    ${overdue.length ? `<button class="btn primary" data-action="routine-bulk-check" style="width:100%; margin-bottom:10px">✓ ここまで全部やった(${overdue.length}件を一括チェック)</button>` : ""}
    ${rows}</section>`;
}

// v82(B2): 「今日のリズム」ゾーンを既定折りたたみにする際、集計値(ながれの完了数・
//      ルーティン実行率)を失わないよう畳んだsummary行に要約表示するための文言。
//      degraded/非degradedの両方のsummaryで共用する。
function homeZone2Summary(blocks) {
  const flowList = blocks.filter((b) => b.category !== "ルーティン");
  const flowDone = flowList.filter((b) => b.completed).length;
  const rt = routineRate(blocks);
  const parts = [];
  if (flowList.length) parts.push(`ながれ ${flowDone}/${flowList.length}`);
  if (rt.total) parts.push(`ルーティン実行 ${rt.pct}%(${rt.done}/${rt.total})`);
  return parts.length ? parts.join(" ・ ") : "記録なし";
}

// 週の範囲(12週サイクル用) v33: 土曜〜金曜を1週とみなす
function weekRange(dateISO) {
  const d = parseDate(dateISO); // v56: new Date("...T00:00:00") は iOS で UTC 誤解釈のため parseDate に統一
  const dow = (d.getDay() + 1) % 7; // Sat=0, Sun=1, ... Fri=6
  const sat = addDays(dateISO, -dow);
  return { weekStart: sat, weekEnd: addDays(sat, 6) };
}

// --- 12週サイクル(B案: Project=目標 / Task=戦術)---
function homeCycle(metrics) {
  const m12 = metrics.find((m) => m.label === "12WY");
  const start = state.settings.twelveWeekStartDate || todayISO();
  // v147レビュー対応: 週番号(Week N)も残り日数と同じtodayISO()基準に統一する(選択中の日付を
  // 動かすとWeek Nだけ変わり、同じウィジェット内の「残り○日」と矛盾する状態を避けるため)。
  const wk = clamp(Math.floor(daysBetween(start, todayISO()) / 7) + 1, 1, 12);
  // v33: 12WY にチェック(twelveWeekStartDate あり)の Project のみをサイクル目標とする
  const goals = state.projects.filter((p) =>
    !p.deleted && p.kind === "normal" && p.status === "active" && p.twelveWeekStartDate);
  const goalIds = goals.map((p) => p.id);
  const allTasks = state.tasks.filter((t) => !t.deleted && goalIds.includes(t.projectId) && isTaskCountable(t));  // v35: 中断/中止は分母から除外
  const overall = allTasks.length
    ? Math.round((allTasks.filter((t) => t.status === "completed").length / allTasks.length) * 100) : 0;
  const { weekStart, weekEnd } = weekRange(state.selectedDate);
  const weekTasks = allTasks.filter((t) => t.dueDate && t.dueDate >= weekStart && t.dueDate <= weekEnd);
  const weekPct = weekTasks.length
    ? Math.round((weekTasks.filter((t) => t.status === "completed").length / weekTasks.length) * 100) : 0;
  const goalHTML = goals.length ? goals.map((p) => {
    const tac = state.tasks
      .filter((t) => !t.deleted && t.projectId === p.id && !isTaskDead(t))
      .sort((a, b) => (a.dueDate || "99").localeCompare(b.dueDate || "99"))
      .slice(0, 4);
    return `<div class="home-goal">
      <div class="home-goal-title">${escapeHTML(p.title)}</div>
      ${tac.length ? tac.map((t) => `<div class="home-ck">
        <span class="home-box" data-action="toggle-task" data-id="${t.id}"></span>
        <span class="home-ck-name" data-action="edit-task" data-id="${t.id}">${escapeHTML(t.title)}</span>
      </div>`).join("") : `<div class="muted" style="font-size:12px;padding-left:2px">未完了のタスクなし</div>`}
    </div>`;
  }).join("") : `<div class="muted" style="font-size:13px">WBSでProjectの「12WY期間に登録する」にチェックすると、ここにサイクル目標として表示されます。</div>`;
  // v147: 残り日数の基準日をtodayISO()に統一(週次側と食い違っていた。taskchute-notes/decisions.md参照)
  return `<section class="panel"><div class="home-plabel blue">12週サイクル</div>
    <div class="home-wk"><span>Week <strong>${wk}</strong> / 12</span>
      <span class="home-wk-days">残り ${Math.max(0, daysBetween(todayISO(), addDays(start, 84)))}日</span></div>
    <div class="home-stat"><span class="home-stat-cap">全体の進捗</span>
      <div class="progress"><span style="width:${overall}%"></span></div>
      <span class="home-stat-pct">${overall}%</span></div>
    <div class="home-stat"><span class="home-stat-cap">今週の進捗</span>
      <div class="progress"><span style="width:${weekPct}%"></span></div>
      <span class="home-stat-pct">${weekPct}%</span></div>
    <div class="home-divider"></div>
    ${goalHTML}</section>`;
}

// v39: 開いている問い(Zone 3)。最大3件、deepening を lastTouchedAt 降順で優先。
//      バッチ思考対策として全表示しない(CONCEPT §5.1)。空なら何も出さない。
function homeQuestions() {
  const qs = (state.questions || []).filter((q) => !q.deleted && q.status !== "settled");
  if (!qs.length) return "";
  const sorted = [...qs].sort((a, b) => {
    if ((a.status === "deepening") !== (b.status === "deepening")) return a.status === "deepening" ? -1 : 1;
    return (b.lastTouchedAt || "").localeCompare(a.lastTouchedAt || "");
  }).slice(0, 3);
  return `<section class="panel">
    <div class="home-plabel blue">開いている問い<span class="home-count">${qs.length}</span></div>
    ${sorted.map((q) => `<div class="home-q" data-action="open-questions">
      <span class="home-q-badge ${q.status}">${q.status === "deepening" ? "深" : "開"}</span>
      <span class="home-q-text">${escapeHTML(q.text)}</span>
    </div>`).join("")}
    ${qs.length > 3 ? `<div class="home-foot">ほか ${qs.length - 3} 件 — タップで一覧へ</div>` : `<div class="home-foot">10xの問いを、少しずつ掘る。</div>`}
  </section>`;
}

// v39: 週次レビューへの静かな導線(土曜のみ、催促なし。CONCEPT §5.4)
function homeWeeklyLink() {
  const links = [];
  if (weekRange(state.selectedDate).weekStart === state.selectedDate) {  // 土曜 = 週の起点
    links.push(`<div class="home-weekly-link" data-action="open-weekly">
      <span>🗓 今週をふりかえる</span><span class="home-weekly-arrow">週次レビュー →</span></div>`);
  }
  // v45: 12週サイクルの節目(残り7日以内)は、静かにサイクルレビューへ誘導
  const start12 = state.settings.twelveWeekStartDate;
  if (start12) {
    const left = daysBetween(todayISO(), addDays(start12, 84));
    if (left >= 0 && left <= 7) {
      links.push(`<div class="home-weekly-link" data-action="open-cycle">
        <span>◷ 12週サイクルの節目(残り ${left} 日)</span><span class="home-weekly-arrow">サイクルレビュー →</span></div>`);
    }
  }
  return links.join("");
}

// --- 未完了タスク(今日に追加できる)---
// v88: 表示過多対策として「当日〜+3日」を既定表示、「+4日以降」は既存のhomeFoldSection
// (details、開閉記憶あり)に格納する(完全非表示にはしない=見えなくなる事故防止)。
// 期限切れ(dueDate < 当日)は従来どおり最優先で常時表示(当日+3日の枠に自然に含まれる)。
// 期限なしタスクは従来から除外(t.dueDate の真偽チェック)で、この扱いは変更していない。
// v126: Wish除外を撤去。「期日付きWishはタスクと同じ」の原則により、このリストは元々
//       dueDate必須(下のfilterでt.dueDateを見る)なので、期日を持つWishだけが自然に混ざる。
function homeBacklog() {
  const excluded = state.projects
    .filter((p) => p.kind === "other")
    .map((p) => p.id);
  // v33: 期限切れ + 当日から1週間以内のタスクのみ(期限なしは除外)。量が多すぎる対策。
  // v88: この7日という全体の取得上限は維持し、その中を「当日+3日」で表示/折りたたみに分ける。
  const limit = addDays(state.selectedDate, 7);
  const nearLimit = addDays(state.selectedDate, 3);
  // v117(B): 表示範囲・並び順は effectiveDueDate()(自己締切の自動前倒し)を基準にする。
  //          存在チェック(t.dueDate)自体は実期日のまま(前倒しで空文字にはならないため影響なし)。
  const tasks = state.tasks
    .filter((t) => !t.deleted && !isTaskDead(t) && !excluded.includes(t.projectId)
      && t.dueDate && effectiveDueDate(t) <= limit)
    .sort((a, b) => (effectiveDueDate(a) || "99").localeCompare(effectiveDueDate(b) || "99"));
  // v112: 当日Block登録済みでも未完了なら再追加できるようにする(K依頼2026-07-15。1日に
  //       複数ブロックを登録したいという要望に対し、以前はscheduled済みタスクの追加ボタンを
  //       disabledにしていたため矛盾していた)。タスクシュート画面のrenderOpenTasksと同じ思想
  //       (件数はブロックせず「本日N件」バッジで示すだけ)に揃え、blockCountByTaskIdの流儀を
  //       ここでも再利用する。
  const todayCountByTaskId = {};
  blocksForDate(state.selectedDate).forEach((b) => {
    if (b.taskId) todayCountByTaskId[b.taskId] = (todayCountByTaskId[b.taskId] || 0) + 1;
  });
  const renderRow = (t) => {
    const todayCount = todayCountByTaskId[t.id] || 0;
    const eff = effectiveDueDate(t);
    const overdue = eff < state.selectedDate;
    // v117(B): 前倒しが効いているタスクは「締切 M/D(実 M/D)」で自己締切・実期日を併記する
    const due = eff !== t.dueDate
      ? `締切 ${eff.slice(5).replace("-", "/")}(実 ${t.dueDate.slice(5).replace("-", "/")})`
      : `締切 ${t.dueDate.slice(5).replace("-", "/")}`;
    const todayBadgeHTML = todayCount > 0
      ? ` <span style="color:var(--green-text); font-weight:600">/ 本日 ${todayCount} 件追加済み</span>` : "";
    return `<div class="home-due${overdue ? " overdue" : ""}">
      <div class="home-due-main" data-action="edit-task" data-id="${t.id}">
        <div class="home-due-name">${escapeHTML(t.title)}</div>
        <div class="home-due-sub">${escapeHTML(projectName(t.projectId))} ・ ${due}${overdue ? "(期限切れ)" : ""}${todayBadgeHTML}</div>
      </div>
      <button class="btn ghost home-add" data-action="home-add-today" data-id="${t.id}" style="font-size:11px;padding:7px 10px">＋今日に追加</button>
    </div>`;
  };
  const nearTasks = tasks.filter((t) => effectiveDueDate(t) <= nearLimit);
  const farTasks = tasks.filter((t) => effectiveDueDate(t) > nearLimit);
  const nearRows = nearTasks.slice(0, 8).map(renderRow).join("");
  const farRows = farTasks.map(renderRow).join("");
  // v88: homeBacklog()自体が既に<section class="panel">なので、homeFoldSection()の
  // 自動付与"panel"クラスは二重の箱に見えてしまう。zone2〜4と同じ「既存パネル内の
  // 素の<details class="home-fold">」パターンを使う(開閉記憶はisHomeFoldOpenを直接利用)。
  const farFold = farTasks.length
    ? `<details class="home-fold" data-fold-id="home-backlog-far" ${isHomeFoldOpen("home-backlog-far", false) ? "open" : ""}>
        <summary class="home-fold-summary"><span class="home-fold-chevron">▶</span>＋4日以降 ${farTasks.length}件</summary>
        <div class="home-fold-body">${farRows}</div>
      </details>`
    : "";
  return `<section class="panel"><div class="home-plabel blue">未完了タスク<span class="home-count">${tasks.length}件</span></div>
    ${nearTasks.length ? nearRows : `<div class="muted" style="font-size:13px">期限が近い未完了タスクはありません。</div>`}
    ${farFold}</section>`;
}

// --- 今日の足あと ---
function homeSteps(blocks) {
  const done = blocks.filter((b) => b.completed);
  const total = blocks.length || 1;
  const charge = done.reduce((s, b) => s + Number(b.charge || 0), 0);
  const discharge = done.reduce((s, b) => s + Number(b.discharge || 0), 0);
  const net = charge - discharge;  // v33: エネルギー量(集計値)
  const C = 226.2;
  const off = (C * (1 - done.length / total)).toFixed(1);
  return `<section class="panel"><div class="home-plabel green">今日の足あと</div>
    <div class="home-steps">
      <div class="home-ring">
        <svg width="78" height="78" viewBox="0 0 84 84">
          <circle cx="42" cy="42" r="36" fill="none" stroke="var(--line-soft)" stroke-width="7"/>
          <circle cx="42" cy="42" r="36" fill="none" stroke="var(--green)" stroke-width="7"
            stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}"
            transform="rotate(-90 42 42)"/>
        </svg>
        <div class="home-ring-txt">${done.length}/${blocks.length}</div>
      </div>
      <div style="flex:1;min-width:0">
        ${done.length
          ? done.map((b) => `<div class="muted" style="font-size:12.5px">✓ ${escapeHTML(b.title)}</div>`).join("")
          : `<div class="muted" style="font-size:12.5px">まだ完了したブロックがありません。</div>`}
        <div class="home-energy">
          <span class="home-energy-item">充電 <strong style="color:var(--green-text)">+${charge}</strong></span>
          <span class="home-energy-item">放電 <strong style="color:var(--orange-text)">−${discharge}</strong></span>
          <span class="home-energy-item">エネルギー <strong style="color:${net >= 0 ? "var(--green)" : "var(--orange)"}">${net >= 0 ? "+" : ""}${net}</strong></span>
        </div>
      </div>
    </div></section>`;
}

// v31: 未完了タスクを今日のBlockにして編集画面を開く(予定時刻を入力できる)
function addTaskToToday(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const { plannedStartAt, plannedEndAt } = defaultPlannedTimes();
  const block = makeBlock({
    taskId,
    date: state.selectedDate,
    title: task.title,
    category: task.category || projectName(task.projectId),
    plannedStartAt,
    plannedEndAt
  });
  state.blocks.push(block);
  saveState();
  openBlockEditor(block.id);
}

// v17: 前日の日報から「明日の MIT 候補」を抽出する
// v42: =========================================================
//  AIループ搬送自動化(日報 ⇄ AI の運搬だけを自動化。思考は自動化しない)
// =========================================================

// 出力: 1タップ搬出(コピー / 共有)
async function copyReportToClipboard() {
  const report = state.reports[state.selectedDate];
  if (!report) return showToast("先に日報を生成してください");
  try {
    await navigator.clipboard.writeText(report);
    showToast("コピーしました — AIに貼り付けてください");
  } catch {
    // フォールバック: textarea を選択して execCommand
    const ta = document.querySelector(".report-output");
    if (ta) { ta.removeAttribute("readonly"); ta.select(); try { document.execCommand("copy"); } catch {} ta.setAttribute("readonly", ""); showToast("コピーしました"); }
    else showToast("コピーに失敗しました");
  }
}
async function shareReport() {
  const report = state.reports[state.selectedDate];
  if (!report) return showToast("先に日報を生成してください");
  try { await navigator.share({ text: report }); } catch { /* キャンセル等は無視 */ }
}

// v143: 貼り付け取込モーダル一式(parseAiFeedback/openAiImportModal/buildAiImportModal/
// submitAiImport/_aiImportCtx)を削除した。v141でジャーナルのAIフィードバック欄自体を撤去して
// 以来、これらを呼び出す唯一の経路(data-feedback-date paste・journal-import-aiボタン)が
// 到達不能になっており、事実上の死コードだったため(CHANGES_v143.md参照)。
// AIフィードバックからの提案取込は現在 autoIngestFeedback()(hydrateStaticMarkdown内、
// 確認なしで候補チップへ自動登録)に一本化されている — このコメントの直後にある
// aiMitChips/adoptAiMitはそちらとは別系統(state.journalMeta.aiMitCandidates)のため削除して
// いない。

// タスクシュート上部の MIT候補チップ(前日フィードバックの取り込み分、当日限り)
function aiMitChips() {
  const today = todayISO();
  if (state.selectedDate !== today) return "";
  const prev = addDays(today, -1);
  const cands = state.journalMeta[prev]?.aiMitCandidates || [];
  if (!cands.length) return "";
  return `<div class="ai-mit-chips">
    <span class="ai-mit-cap">MIT候補(昨日のAIより):</span>
    ${cands.map((t, i) => `<button class="ai-mit-chip" data-action="ai-mit-adopt" data-index="${i}">＋ ${escapeHTML(t)}</button>`).join("")}
  </div>`;
}
function adoptAiMit(index) {
  const prev = addDays(todayISO(), -1);
  const meta = state.journalMeta[prev];
  const title = meta?.aiMitCandidates?.[index];
  if (!title) return;
  const today = todayISO();
  const sameDayMITs = state.blocks.filter((b) => !b.deleted && b.date === today && b.isMIT);
  if (sameDayMITs.length >= 3) return showToast("今日の主役は最大3個まで。先に他を外してください");
  const block = makeBlock({ date: today, title });
  block.isMIT = true;
  state.blocks.push(block);
  meta.aiMitCandidates.splice(index, 1);  // 採用したら候補から外す
  saveAndRender("✦ 今日の主役に追加しました");
}

// v133: タスクシュート上部の AIタスク候補チップ(前日フィードバックの取り込み分、当日限り)。
//       aiMitChips/adoptAiMitと全く同じ「溜めて＋で採用」設計。採用せず消す×(却下)だけは
//       候補が溜まり続けないよう追加した(aiMitChipsには無い機能)。
function aiTaskChips() {
  const today = todayISO();
  if (state.selectedDate !== today) return "";
  const prev = addDays(today, -1);
  const cands = state.journalMeta[prev]?.aiTaskCandidates || [];
  if (!cands.length) return "";
  return `<div class="ai-mit-chips">
    <span class="ai-mit-cap">タスク候補(昨日のAIより):</span>
    ${cands.map((t, i) => `
      <span class="ai-mit-chip" style="display:inline-flex; align-items:center; gap:4px">
        <button data-action="ai-task-adopt" data-index="${i}" style="border:none; background:none; padding:0; font:inherit; color:inherit">＋ ${escapeHTML(t)}</button>
        <button data-action="ai-task-dismiss" data-index="${i}" aria-label="候補を却下" style="border:none; background:none; padding:0 2px; font:inherit; color:inherit; opacity:0.6">×</button>
      </span>`).join("")}
  </div>`;
}
function adoptAiTaskCandidate(index) {
  const prev = addDays(todayISO(), -1);
  const meta = state.journalMeta[prev];
  const title = meta?.aiTaskCandidates?.[index];
  if (!title) return;
  const task = makeTask({ title, dueDate: todayISO() });
  state.tasks.push(task);
  meta.aiTaskCandidates.splice(index, 1);  // 採用したら候補から外す
  saveAndRender("✚ タスクに追加しました");
}
function dismissAiTaskCandidate(index) {
  const prev = addDays(todayISO(), -1);
  const meta = state.journalMeta[prev];
  if (!meta?.aiTaskCandidates?.[index]) return;
  meta.aiTaskCandidates.splice(index, 1);  // 採用せず候補から外す
  saveAndRender("");
}

// v60: =========================================================
//  Claude API 直接呼び出しは全廃した(コスト理由。AI活用は自宅PCのバッチ処理→
//  ファイル連携[AIフィードバック_日付.md の自動fetch・手動.mdアップロード]に限定)。
//  ここにあった callClaude / aiEnabled / aiPrompt / AI_DEFAULT_PROMPTS / AIタスク分解 /
//  AI一括編集 / AIレビュー(日報直接統合)は全て削除。詳細は CHANGES_v60.md 参照。
// =========================================================

// v60: =========================================================
//  ② スケジュール下書き(空き時間への仮配置 → D&Dで調整 → 確定)
//  AIがやるのは「並べる下書き」まで。動かす・削る・確定は人間。
//  下書きは非永続(確定するまで実データに触れない)。
// =========================================================
let _scheduleDraft = null;  // { date, items:[{id,title,taskId,category,start(分),minutes}], skipped:[{title,reason}], source } 非永続(v59でskippedを追加、v62でsourceを追加)
let _draftDrag = null;      // ドラッグ中の一時情報 非永続
let _draftUndo = null;      // v62: 下書きレイヤ操作(×削除・ドラッグ)の直前スナップショット(1段Undo)非永続
let _draftUndoHistoryEntry = null;  // v62(m2): _draftUndoが削除操作由来なら、その時記録したaiScheduleHistoryエントリの参照(Undoで取り消す)
let _pendingRejectReason = null;  // v62: ×直後の却下理由ワンタップ選択(任意・非ブロッキング)非永続 { title, entry }
// v145レビュー対応: runAiMorningPlanの非同期処理(AIプランJSONのfetch等)が完了するまでtrue。
// この間は他の非同期処理(残量低下時の回復Block下書き提案)が_scheduleDraftを取り合わないよう、
// ティッカー経路(updateBatteryTick)は本フラグが立っていれば静かにスキップする(冪等マーカーは
// 焼かない=次tickで再評価される)。起動時経路はrunAiMorningPlanのPromiseそのものに連鎖させる
// (maybeAutoMorningPlan参照)ため本フラグを直接は見ない。
let _morningPlanInFlight = false;
let _zeroSecThemeDraft = null;  // v75: AIプラン_*.jsonのzeroSecThemes提案(0秒思考テーマ)。{ date, items:[{theme,reason}] } 非永続(_scheduleDraftと同じ思想)

// v175: renderTimelineView(src/features/timeline.js側)は「下書きが1件も無い時だけ
// "下書きスケジュール"ボタンを出す」判定に_scheduleDraftの有無だけを見る。変数自体を
// 露出させず、この1関数越しにconfigureTimeline(deps)へ注入する(routine.jsの
// isChainRunActive()と同じ「モジュールプライベート変数を直接晒さない」方式)。
function scheduleDraftActive() {
  return Boolean(_scheduleDraft);
}

function minToHHMM(min) {
  const m = clamp(Math.round(min), 0, 24 * 60 - 1);
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

// v59: 空き時間計算(純粋関数)。plannedStartAt/plannedEndAt を持つ当日Block(ルーティンのrec Blockも含む)
//      から占有区間を作り、dayStartMin〜dayEndMin の空き枠([start,end] 分・昇順)を返す。
//      Date を経由せず minutesOf(文字列パース)で分抽出する(iOS Safari の9時間ズレ回避ルール)。
function computeFreeGaps(date, dayStartMin = 5 * 60, dayEndMin = 23 * 60) {
  if (dayEndMin <= dayStartMin) return [];
  const occupied = blocksForDate(date)
    .filter((b) => b.plannedStartAt && b.plannedEndAt)
    .map((b) => {
      const s = clamp(minutesOf(b.plannedStartAt), dayStartMin, dayEndMin);
      const e = clamp(minutesOf(b.plannedEndAt), dayStartMin, dayEndMin);
      return [Math.min(s, e), Math.max(s, e)];
    })
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  // 重複・隣接区間をマージ
  const merged = [];
  occupied.forEach(([s, e]) => {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  });
  // マージ済み占有区間の「隙間」を空き枠として拾う
  const gaps = [];
  let cursor = dayStartMin;
  merged.forEach(([s, e]) => {
    if (s > cursor) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  });
  if (cursor < dayEndMin) gaps.push([cursor, dayEndMin]);
  return gaps;
}

// 配置候補: 昨日のMIT候補 + WBSの未完了タスク(中断/今日Block化済みを除く、期限順)
// v77: 詰め込み防止の第一段 — dueDateが対象日より後(翌日以降)のタスクは候補から除外する。
//      期限なし(dueDate未設定)のタスクは対象に残す(wbsTaskCompareが "9999" 扱いで
//      最後尾ソートするため、期限付きタスクを圧迫せず、空いた枠があれば埋める filler として働く)。
//      期限が対象日以前(=期日超過・当日締切)のタスクは当然対象。
// v126: 「やりたいこと」もWBSのTaskとして扱い、期日を持つWishは通常タスクと全く同じ条件
//      (effectiveDueDate/wbsTaskCompare/15件cap)に乗せる。特別なrank・noteは付けない。
//      ただし「期日なし=filler」という通常WBSタスクのルールはWishには適用しない
//      (60件超のWishが未着手のまま溜まる運用のため、期日なしWishまでfillerとして
//      朝プランに溢れさせると収拾がつかなくなる。期日なしWishは候補から除外する)。
function aiScheduleCandidates(date) {
  const out = [];
  const prev = addDays(date, -1);
  (state.journalMeta[prev]?.aiMitCandidates || []).forEach((t, i) =>
    out.push({ id: `mit-${i}`, title: t, taskId: "", category: "", note: "MIT候補" }));
  const wishIds = new Set(state.projects.filter((p) => p.kind === "wish").map((p) => p.id));
  state.tasks
    .filter((t) => !t.deleted && (t.status === "todo" || t.status === "doing") && t.projectId)
    // v126: 期日なしWishのみ除外(期日付きWishは以降の通常フィルタへそのまま乗る)
    .filter((t) => !wishIds.has(t.projectId) || Boolean(t.dueDate))
    .filter((t) => !isTaskSuspended(t))
    // v77: 翌日以降が期限のタスクは今日の下書きに詰め込まない。v117(B): 自己締切前倒しを反映
    .filter((t) => !t.dueDate || effectiveDueDate(t) <= date)
    .filter((t) => !state.blocks.some((b) => !b.deleted && b.taskId === t.id && b.date === date))
    .sort(wbsTaskCompare)
    .slice(0, 15)
    .forEach((t) => out.push({
      id: t.id, title: t.title, taskId: t.id, category: t.category || "",
      note: t.dueDate ? `期限 ${t.dueDate}` : "",
      estimateMin: t.estimateMin || null  // v60: 決定論配置の見積分数(未設定なら fallbackMorningPlan が既定30分を使う)
    }));
  return out;
}

// v60: 空き時間に候補を機械的に前詰め配置する(Claude API 呼び出しは全廃したため決定論配置のみ)。
//      配置ロジックは runAiMorningPlan と共通の fallbackMorningPlan を再利用する
//      (この画面には繰越候補が無いため実質「MIT候補→WBS(期日付きWish含む)」の優先順。v126で
//      「今週のやりたいこと」専用段は撤去した)。
function runAiSchedule() {
  const date = state.selectedDate;
  const candidates = aiScheduleCandidates(date);
  if (!candidates.length) return showToast("配置できる候補がありません(WBSの未完了タスクが対象です)");
  const DAY_START = 5 * 60, DAY_END = 23 * 60;
  const isToday = date === todayISO();
  const now = new Date();
  const nowFloor = isToday ? Math.min(DAY_END, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15) : DAY_START;
  const freeGaps = computeFreeGaps(date, DAY_START, DAY_END)
    .map(([s, e]) => [Math.max(s, nowFloor), e])
    .filter(([s, e]) => e - s >= 15);
  if (!freeGaps.length) return showToast("空き時間がありません(予定が埋まっています)");
  const { items, skipped } = fallbackMorningPlan(candidates, freeGaps);
  if (!items.length) return showToast("空き時間に配置できる候補がありませんでした");
  _scheduleDraft = { date, items: items.slice(0, 6), skipped, source: "deterministic" };  // v62: source区別
  _draftUndo = null; _draftUndoHistoryEntry = null;  // v62: 新規下書きでは前セッションのUndoを持ち越さない
  state.timelineMode = "planned";
  setView("timeline");
  showToast("空き時間へ自動配置しました — ドラッグで調整して「確定」してください");
  render();
}

// タイムライン上の下書きレイヤ(点線ブロック。ドラッグ移動 / 下端で長さ調整 / ×で削除)
function renderDraftLayer(rowHeight, startHour) {
  if (!_scheduleDraft || _scheduleDraft.date !== state.selectedDate) return "";
  return `
    <div class="draft-layer" style="position:absolute; top:0; left:60px; right:100px; height:100%; z-index:6; pointer-events:none">
      ${_scheduleDraft.items.map((it) => {
        const top = ((it.start - startHour * 60) / 60) * rowHeight;
        const height = Math.max(26, (it.minutes / 60) * rowHeight);
        const catColor = it.category ? getCategoryColor(it.category) : null;
        // v61: 繰越由来の下書きは、確定するとこの回数の繰り越しになる、という予告バッジ
        const draftBadge = it.carryFromId ? migrationBadgeHTML(migrationNextCount(it.carryFromId)) : "";
        // v62: AIプラン由来の reason は下書きバー確認+ツールチップ(title属性)で見えるようにする
        // v65: AIプランのtitle先頭「[資産]」検出分は、下書き段階から控えめマークで見せる
        const draftLev = leverageTypeMarkHTML(it.leverageType || "");
        return `
        <div class="draft-block" data-draft-id="${it.id}" data-row-height="${rowHeight}"
             style="top:${top}px; height:${height}px; ${catColor ? `border-color:${catColor};` : ""}"
             ${it.reason ? `title="${escapeHTML(it.reason)}"` : ""}>
          <div class="draft-block-time">${minToHHMM(it.start)}〜${minToHHMM(it.start + it.minutes)}(${it.minutes}分)</div>
          <div class="draft-block-title">${escapeHTML(it.title)}${draftBadge}${draftLev}</div>
          ${it.reason ? `<div class="draft-block-reason">${escapeHTML(it.reason)}</div>` : ""}
          <button class="draft-remove" data-action="draft-remove" data-id="${it.id}" aria-label="この下書きを外す">×</button>
          <div class="draft-resize" data-draft-resize="${it.id}"></div>
        </div>`;
      }).join("")}
    </div>`;
}

function draftBarHTML() {
  if (!_scheduleDraft || _scheduleDraft.date !== state.selectedDate) return "";
  const skipped = _scheduleDraft.skipped || [];  // v59: 朝プランで「配置しない」と判断した候補
  // v62: AI由来(自宅PCバッチ生成のAIプラン)か決定論配置由来かを小さく区別表示する
  // v146(UI改善計画Phase1-6): battery-recovery(v145)由来は出どころ不明な「⚙ 決定論配置」
  // ではなく「🔋 回復候補」と表示し、機能名から来ていることが分かるようにする
  const sourceLabel = _scheduleDraft.source === "ai-plan" ? "🤖 AIプラン由来"
    : _scheduleDraft.source === "battery-recovery" ? "🔋 回復候補"
    : "⚙ 決定論配置";
  return `
    <div class="draft-bar">
      <span>📋 下書き ${_scheduleDraft.items.length}件(${sourceLabel}) — ドラッグで移動 / 下端をドラッグで長さ調整 / ×で外す</span>
      <span class="row" style="gap:6px">
        ${_draftUndo ? `<button class="btn ghost" data-action="draft-undo">↩ 元に戻す</button>` : ""}
        <button class="btn primary" data-action="draft-confirm">確定して登録</button>
        <button class="btn ghost" data-action="draft-discard">破棄</button>
      </span>
    </div>
    ${skipped.length ? `<div class="muted" style="font-size:11.5px; line-height:1.6; margin:-4px 0 8px">
      ${skipped.map((s) => {
        // v62(M1レビュー対応): kind="expired" は空き時間との不整合で個別ドロップされた項目
        // (判断の透明化のため「見送り」とは別ラベルで表示する)
        const label = s.kind === "expired" ? "時間切れで除外" : "見送り";
        return `${label}: ${escapeHTML(s.title)}${s.reason ? `(${escapeHTML(s.reason)})` : ""}`;
      }).join(" ／ ")}
    </div>` : ""}`;
}

// v75: 朝の一括プランニング(runAiMorningPlan)が取得したAIプラン_*.jsonの zeroSecThemes を、
//      下書きスケジュールバー(draftBarHTML)と同じタイムライン最上部に表示する。
//      スケジュール下書きの有無とは独立(_scheduleDraftがnullでも出す)。ワンタップで
//      「0秒思考リストに追加」または「見送り」を選べ、選ぶとカードから消える(新タブは作らない)。
function zeroSecThemeBarHTML() {
  if (!_zeroSecThemeDraft || _zeroSecThemeDraft.date !== state.selectedDate || !_zeroSecThemeDraft.items.length) return "";
  return `
    <div class="draft-bar" style="flex-direction:column; align-items:stretch; gap:6px">
      <span>🧠 0秒思考のテーマ提案</span>
      ${_zeroSecThemeDraft.items.map((t, i) => `
        <div class="home-ck" style="flex-wrap:wrap">
          <div style="flex:1; min-width:180px">
            <div class="home-ck-name">${escapeHTML(t.theme)}</div>
            ${t.reason ? `<div class="muted" style="font-size:11px">${escapeHTML(t.reason)}</div>` : ""}
          </div>
          <button class="btn ghost" style="font-size:11px; padding:5px 9px" data-action="zerosec-theme-add" data-idx="${i}">＋ 0秒思考リストに追加</button>
          <button class="btn ghost" style="font-size:11px; padding:5px 9px" data-action="zerosec-theme-skip" data-idx="${i}">見送り</button>
        </div>`).join("")}
    </div>`;
}

// v75: 上のカードの「追加」「見送り」ボタンの実処理。採否は zeroSecThemeLog へ記録し
//      (aiPlanSkippedLogと同じ学習ループの型)、対象は下書きから外す(再表示しない)。
function decideZeroSecTheme(idx, outcome) {
  if (!_zeroSecThemeDraft) return;
  const item = _zeroSecThemeDraft.items[idx];
  if (!item) return;
  if (outcome === "added") {
    const existing = new Set(state.zeroThinking.themes.map((t) => t.text));
    if (!existing.has(item.theme)) {
      state.zeroThinking.themes.push({ id: crypto.randomUUID(), text: item.theme, fav: false, questionId: null, createdAt: nowDateTime() });
    }
  }
  state.zeroSecThemeLog.push({ date: _zeroSecThemeDraft.date, theme: item.theme, reason: item.reason || "", outcome, at: nowDateTime() });
  if (state.zeroSecThemeLog.length > ZERO_SEC_THEME_LOG_MAX) {
    state.zeroSecThemeLog = state.zeroSecThemeLog.slice(-ZERO_SEC_THEME_LOG_MAX);
  }
  _zeroSecThemeDraft.items = _zeroSecThemeDraft.items.filter((_, i) => i !== idx);
  if (!_zeroSecThemeDraft.items.length) _zeroSecThemeDraft = null;
  saveAndRender(outcome === "added" ? "🧠 0秒思考リストに追加しました" : "見送りました");
}
const ZERO_SEC_THEME_LOG_MAX = 300;

// v62: 下書きレイヤ操作(×削除・ドラッグ移動/リサイズ)の直前状態を退避する(1段Undo)。
// _scheduleDraft は非永続のため、ここでの退避もモジュール変数のディープコピーで完結する。
// historyEntry: 削除操作由来のUndoなら、その削除で記録したaiScheduleHistoryエントリを渡す。
// ドラッグ操作由来のUndo(履歴レコードを伴わない)では省略する。
function snapshotDraftForUndo(historyEntry = null) {
  if (!_scheduleDraft) return;
  _draftUndo = JSON.parse(JSON.stringify(_scheduleDraft));
  _draftUndoHistoryEntry = historyEntry;
}

const DRAFT_REJECT_REASONS = ["今日は無理", "価値が薄い", "時間帯が合わない", "その他"];

// v62: ×で外した直後だけ出す軽量な却下理由ピッカー(任意・非ブロッキング)。
// モーダルにはしない(即座に削除は完了しており、理由選択はあとから追加できる情報)。
// aiScheduleHistory の該当entryへ直接reasonを書き込む(v64の学習データ)。
function draftRejectReasonPickerHTML() {
  if (!_pendingRejectReason) return "";
  return `
    <div class="draft-reject-picker">
      <span>「${escapeHTML(_pendingRejectReason.title)}」を外しました。理由(任意):</span>
      <span class="row" style="gap:6px; flex-wrap:wrap">
        ${DRAFT_REJECT_REASONS.map((r) => `<button class="btn ghost" data-action="draft-remove-reason" data-reason="${escapeHTML(r)}">${escapeHTML(r)}</button>`).join("")}
        <button class="btn ghost" data-action="draft-remove-reason-dismiss">閉じる</button>
      </span>
    </div>`;
}

// v60(旧v52): スケジュール実績ログ。決定論配置の元値(aiStart/aiMinutes、フィールド名は
//  互換のため維持)・ユーザ確定・却下を aiScheduleHistory に記録する。かつては
//  buildScheduleLearningDigest() がこれを集計してAIプロンプトへ注入していたが、
//  Claude API呼び出しの全廃に伴いその注入経路は削除した(digest生成自体が呼び出し元を
//  失ったため同時に削除)。ここでの記録自体は「配置提案に対する採否」の実データとして
//  引き続き蓄積する(将来、自宅PCバッチでの分析に使える可能性があるため残置)。
const AI_SCHED_HISTORY_MAX = 300;
// v53: 計器盤(統計)の時間帯×曜日ヒートマップでも使う(削除しないこと)
const SCHED_BANDS = [
  [5, 9, "早朝(5-9時)"],
  [9, 12, "午前(9-12時)"],
  [12, 15, "昼(12-15時)"],
  [15, 18, "午後(15-18時)"],
  [18, 23, "夜(18-23時)"]
];

// 採用/却下を1件記録(採用時は確定値も)。v62: source(ai-plan/deterministic)・reason(却下理由)を追加し、
// 呼び出し元が却下理由をあとから紐付けられるよう push した entry 自体を返す(v64の学習データ)。
function recordScheduleHistory(item, outcome, date, source = "deterministic", reason = "") {
  const entry = {
    date,
    title: item.title,
    category: item.category || "",
    aiStart: minToHHMM(item.aiStart ?? item.start),
    aiMin: item.aiMinutes ?? item.minutes,
    outcome,  // 'confirmed' | 'removed' | 'discarded'
    source,   // v62: 'ai-plan' | 'deterministic' — 提案の出どころ
    reason: reason || "",  // v62: 却下理由(removed時のみ、ワンタップ選択・任意)
    userStart: outcome === "confirmed" ? minToHHMM(item.start) : null,
    userMin: outcome === "confirmed" ? item.minutes : null,
    at: nowDateTime()
  };
  state.aiScheduleHistory.push(entry);
  if (state.aiScheduleHistory.length > AI_SCHED_HISTORY_MAX) {
    state.aiScheduleHistory = state.aiScheduleHistory.slice(-AI_SCHED_HISTORY_MAX);
  }
  return entry;
}

function confirmScheduleDraft() {
  if (!_scheduleDraft || !_scheduleDraft.items.length) return;
  const { date, items } = _scheduleDraft;
  const draftSource = _scheduleDraft.source || "deterministic";  // v62: 確定記録にも出どころを残す
  // v61: マイグレーション儀式 — 繰越由来(carryFromId)の項目が3回目の繰り越しになる場合は、
  //      一括確定の前に一呼吸置く。既に選択済み(_ritualResolved)の項目はスキップする。
  const ritualItem = items.find((it) =>
    it.carryFromId && !it._ritualResolved && migrationNextCount(it.carryFromId) >= MIGRATION_RITUAL_THRESHOLD);
  if (ritualItem) {
    openMigrationRitual(ritualItem.carryFromId, migrationNextCount(ritualItem.carryFromId),
      { origin: "draft", draftItemId: ritualItem.id });
    return;
  }
  items.forEach((it) => {
    const block = makeBlock({
      date,
      title: it.title,
      taskId: it.taskId || "",
      category: it.category || "",
      plannedStartAt: `${date}T${minToHHMM(it.start)}`,
      plannedEndAt: `${date}T${minToHHMM(it.start + it.minutes)}`,
      estimateMin: it.minutes
    });
    // v52: 決定論配置の元値を Block に残す(確定・実績との突き合わせ = 実績データ。フィールド名は互換のため維持)
    block.aiPlan = { start: minToHHMM(it.aiStart ?? it.start), minutes: it.aiMinutes ?? it.minutes };
    // v65: AIプランのtitle先頭「[資産]」検出分は確定時にleverageType=assetを引き継ぐ
    if (it.leverageType) block.leverageType = it.leverageType;
    if (it.forceMIT) {
      // v61: マイグレーション儀式で「今日やる」を選んだ項目はMIT化(既存の最大3個ルールは尊重する)
      const sameDayMITs = state.blocks.filter((b) => !b.deleted && b.date === date && b.isMIT);
      if (sameDayMITs.length < 3) block.isMIT = true;
    }
    if (it.carryFromId) {
      const src = blockById(it.carryFromId);
      block.carryCount = (src?.carryCount || 0) + 1;  // v61: 繰り越し回数を1つ積み上げる
    }
    state.blocks.push(block);
    // v145レビュー対応: item.source優先(合流下書きでの出どころ誤ラベル防止。draft-discard/removeと同じ方針)
    recordScheduleHistory(it, "confirmed", date, it.source || draftSource);
    // v59: 繰り越し由来の下書きは元Blockに migratedTo を設定(carryOverBlockと同じ二重繰越防止セマンティクス)
    if (it.carryFromId) {
      state.blocks = state.blocks.map((b) => b.id === it.carryFromId ? { ...b, migratedTo: block.id, updatedAt: nowDateTime() } : b);
    }
  });
  _scheduleDraft = null;
  _draftUndo = null; _draftUndoHistoryEntry = null;  // v62: 確定済みの下書きへのUndoは意味を持たない
  saveAndRender(`📋 ${items.length}件のBlockを登録しました`);
}

// v59: =========================================================
//  朝の一括プランニング(繰越+WBS+MIT候補 → 空き時間へ仮配置 → 既存の下書きUIで確定)
//  ②のAIスケジュール下書きを「1日ぶん全部」に拡張したもの。既存の draft 機構をそのまま使い、
//  新規UIは最小限(ホームAI行のボタン1つ + skipped の一覧表示)に留める。
// =========================================================

// 候補合成: 繰越(carryableBlocks)+ aiScheduleCandidates(MIT候補+WBS)。
// 同taskId/同titleが両方に居る場合は繰越側を優先して1本化する(繰越は既に実体Blockがあり、
// 二重に別候補として提案すると確定時に同じ作業が2件登録されてしまうため)。
function aiMorningPlanCandidates(date) {
  const carryList = carryableBlocks().map((b) => ({
    id: `carry-${b.id}`,
    title: b.title,
    taskId: b.taskId || "",
    category: b.category || "",
    note: b.plannedStartAt ? `昨日未完了・元は${timeFromDateTime(b.plannedStartAt)}` : "昨日未完了",
    carryFromId: b.id,
    estimateMin: resolveEstimateMin(b)
  }));
  const carriedTaskIds = new Set(carryList.filter((c) => c.taskId).map((c) => c.taskId));
  const carriedTitles = new Set(carryList.map((c) => c.title));
  const rest = aiScheduleCandidates(date).filter((c) =>
    !(c.taskId && carriedTaskIds.has(c.taskId)) && !carriedTitles.has(c.title));
  return [...carryList, ...rest];
}

// v60: 決定論配置(唯一の配置経路。旧称フォールバックのまま維持): MIT候補 → 繰越 → WBS(期日付き
// Wishも同列で含む。v126で「今週のやりたいこと」専用段は撤去した)の順に、
// 各候補の見積分数(estimateMin、無ければ30分)で空き枠へ前詰め配置する。
// 空き枠に入り切らない候補は skipped(理由: 空き枠なし)に回す。
// v77: 詰め込み防止の第二段 — (a) ブロック長は見積分数(estimateMin)にそのまま一致させる
//      (旧実装は15分刻みに丸めており、見積表示とズレていた)。(b) 空き時間合計の
//      CAPACITY_RATIO(65%。60-70%目安の中央値)を配置上限とし、超える候補は「配置しない」
//      (切り詰めない)。ただし1日の残り時間がもともと少ない(例: 終業間際で残り45分)日まで
//      機械的に締め出すと既存の「入り切る分は素直に置く」挙動を壊すため、
//      CAPACITY_MIN_FLOOR(60分)を下限として必ず確保する(実質、空き時間が短い日は
//      比率の影響を受けない。安全枠が効くのは空き時間が十分にある日のみ)。
//      (c) ブロック間に BUFFER_MIN(10分)の余白を残し、隙間なく連続配置しない。
//      いずれも既存の「入り切らなければ配置しない」方針(items.slice等での切り詰めはしない)を維持する。
const MORNING_PLAN_CAPACITY_RATIO = 0.65;
const MORNING_PLAN_CAPACITY_MIN_FLOOR = 60;
const MORNING_PLAN_BUFFER_MIN = 10;
function fallbackMorningPlan(candidates, freeGaps) {
  // v126: v122で追加した「今週のやりたいこと」専用rank(2段目)は撤去。期日付きWishは
  //       aiScheduleCandidates側で通常WBSタスクと同列に扱われるため、優先度は
  //       MIT=0 → 繰越=1 → WBS(Wish含む)=2 の3段階に戻す。
  const rank = (c) => (c.carryFromId ? 1 : (String(c.id).startsWith("mit-") ? 0 : 2));
  const ordered = [...candidates].sort((a, b) => rank(a) - rank(b));
  const gaps = freeGaps.map(([s, e]) => [s, e]);  // 前詰めで消費するのでコピーして破壊的に使う
  const totalFreeMin = gaps.reduce((sum, [s, e]) => sum + (e - s), 0);
  // v77: 空き時間を全部埋めない安全枠(空き時間が短い日は下限floorが優先され実質無効化される)
  const capacityMin = Math.max(MORNING_PLAN_CAPACITY_MIN_FLOOR, Math.floor(totalFreeMin * MORNING_PLAN_CAPACITY_RATIO));
  const items = [];
  const skipped = [];
  let placedMin = 0;
  ordered.forEach((c) => {
    const minutes = clamp(Math.round(c.estimateMin || 30), 15, 240);  // v77: 見積分数そのまま(15分丸め廃止)
    if (placedMin + minutes > capacityMin) { skipped.push({ title: c.title, reason: "安全枠超過(空き時間を埋め過ぎない)" }); return; }
    const gapIdx = gaps.findIndex((g) => g[1] - g[0] >= minutes);
    if (gapIdx === -1) { skipped.push({ title: c.title, reason: "空き枠なし" }); return; }
    const start = gaps[gapIdx][0];
    items.push({
      id: crypto.randomUUID(), title: c.title, taskId: c.taskId || "", category: c.category || "",
      start, minutes, aiStart: start, aiMinutes: minutes, carryFromId: c.carryFromId || ""
    });
    placedMin += minutes;
    gaps[gapIdx][0] += minutes + MORNING_PLAN_BUFFER_MIN;  // v77: ブロック間バッファ
    if (gaps[gapIdx][1] - gaps[gapIdx][0] < 15) gaps.splice(gapIdx, 1);  // 15分未満の端数はもう空き扱いしない
  });
  return { items: items.slice(0, 15), skipped };
}

// v62: 自宅PCバッチ生成の AIプラン_YYYY-MM-DD.json(plan-daily-validate.py が権威スキーマ。
// date/generatedAt/plan[]/skipped[]、plan項目はtitle/taskId/blockId/start/minutes/category/reason/carryFromId)
// を当日限定でfetchし、構造検証+現在状態との整合性(二重繰越参照・空き時間との重複)を確認する。
// 構造が壊れている(パース不能・日付不一致・型不正)場合はプラン全体を null にして決定論配置へ
// フォールバックするが、空き時間との不整合(過去時刻・既存Blockと衝突)は項目単位でドロップし、
// 採用可能な項目が1件も無い場合のみ null にする(M1レビュー対応: 一部だけ古くても全体を
// 捨てない)。
async function tryFetchAiPlan(date, freeGaps) {
  const raw = await fetchGitHubRawText(`AIプラン_${date}.json`);
  if (!raw) return null;  // 取得失敗(404含む。fetchTextは404で空文字を返す)
  let data;
  try { data = JSON.parse(raw); } catch { return null; }  // 不正JSON
  if (!data || typeof data !== "object") return null;
  if (data.date !== date) return null;  // 当日分でない(古い/取り違え)
  if (!Array.isArray(data.plan) || !Array.isArray(data.skipped)) return null;

  const START_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const items = [];
  for (const p of data.plan) {
    if (!p || typeof p !== "object") return null;
    if (typeof p.title !== "string" || !p.title.trim()) return null;
    if (typeof p.start !== "string" || !START_RE.test(p.start)) return null;
    if (typeof p.minutes !== "number" || !Number.isInteger(p.minutes) || p.minutes < 1 || p.minutes > 600) return null;
    const carryFromId = typeof p.carryFromId === "string" ? p.carryFromId : "";
    // v61の二重繰越防止セマンティクス(migratedTo)をAIプラン経由でも維持: 参照先が既に
    // 繰り越し済み/削除済み/存在しなければ、この項目だけ不採用にする(プラン全体は活かす)
    if (carryFromId) {
      const src = blockById(carryFromId);
      if (!src || src.deleted || src.migratedTo) continue;
    }
    const taskId = typeof p.taskId === "string" ? p.taskId : "";
    if (taskId) {
      const t = state.tasks.find((x) => x.id === taskId);
      if (!t || t.deleted || t.status === "completed") continue;  // 生成後に完了/削除済みなら不採用
    }
    const start = minutesOf(p.start);
    // v65レビュー対応: leverageType検出は元のtitle(プレフィックス付き)に対して行い、
    // 下書き・確定Blockのtitleにはプレフィックスを残さない(⚙資産マークと二重表示になるため)。
    const detectedLev = detectLeverageTypeFromTitle(p.title);
    items.push({
      id: crypto.randomUUID(),
      title: p.title.replace(/^\[資産\]\s*/, ""),
      taskId,
      category: typeof p.category === "string" ? p.category : "",
      start, minutes: p.minutes, aiStart: start, aiMinutes: p.minutes,
      carryFromId,
      reason: typeof p.reason === "string" ? p.reason : "",  // v62: 下書きバー/ツールチップで見せる
      leverageType: detectedLev  // v65: title先頭「[資産]」→ leverageType=asset を自動付与
    });
  }
  const skipped = [];
  for (const s of data.skipped) {
    if (!s || typeof s !== "object" || typeof s.title !== "string") return null;
    skipped.push({ title: s.title, reason: typeof s.reason === "string" ? s.reason : "", kind: "ai" });  // v62: AI自身が「配置しない」と判断した候補
  }
  if (!items.length) return null;  // 採用できる項目が無ければ決定論へフォールバック
  // v62(M1レビュー対応): 空き時間との整合性を項目単位で確認する。バッチ生成(05:00)から
  // fetch(数時間後もありうる)までの間に過去時刻になった・既存Blockと衝突した項目だけを
  // 個別にドロップし(プラン全体は活かす)、除外理由が見えるようskippedと同じ形で
  // 「時間切れで除外」として表示する(判断の透明化)。採用可能な項目が1件も残らない場合のみ
  // 決定論へフォールバックする。
  const fittingItems = [];
  for (const it of items) {
    const fits = freeGaps.some(([s, e]) => it.start >= s && it.start + it.minutes <= e);
    if (fits) fittingItems.push(it);
    else skipped.push({ title: it.title, reason: "", kind: "expired" });
  }
  if (!fittingItems.length) return null;  // 採用可能な項目が0件なら決定論へフォールバック
  return { items: fittingItems, skipped };
}

// v67: AIプラン_<date>.json の存在確認のみ(下書きへの適用はtryFetchAiPlan/runAiMorningPlanの専管)。
//      state.aiLinkFreshness.planAt 更新用の軽量シグナル。厳密な項目検証はしない(存在=鮮度の証拠で足りる)。
async function fetchAiPlanFreshnessDate(date) {
  const raw = await fetchGitHubRawText(`AIプラン_${date}.json`);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return (data && typeof data === "object" && data.date === date) ? date : null;
  } catch {
    return null;
  }
}

// v75: AIプラン_<date>.json トップレベルの zeroSecThemes([{theme,reason}])を取得する。
//      存在しない日もある(後方互換必須)ので、無い/壊れている場合は静かに null を返す。
//      tryFetchAiPlan(スケジュール項目の検証)とは独立: plan/skippedが空でzeroSecThemesだけの
//      日でも拾えるよう、専用に軽量fetchする。
async function fetchZeroSecThemes(date) {
  const raw = await fetchGitHubRawText(`AIプラン_${date}.json`);
  if (!raw) return null;
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== "object" || data.date !== date) return null;
  if (!Array.isArray(data.zeroSecThemes)) return null;
  const items = data.zeroSecThemes
    .filter((t) => t && typeof t.theme === "string" && t.theme.trim())
    .map((t) => ({ theme: t.theme.trim(), reason: typeof t.reason === "string" ? t.reason.trim() : "" }));
  return items.length ? items : null;
}

// v77: AIフィードバック_<date>.md 本文の「## 0秒思考テーマ」見出し(- [ ] テーマ: 理由 形式、
//      「## 明日への提案」と同じチェックボックス書式)から0秒思考テーマ候補を抽出する。
//      extractMITCandidatesFromReportと同じ頑健化パターン(見出し直後の空行スキップ・
//      コロン分割・全角:対応)を踏襲。存在しない/旧形式のFB(見出し自体が無い)では
//      空配列を返す(呼び出し側で length===0 を「該当なし」として扱えば後方互換になる)。
// v86: 呼び出し元は hydrateStaticMarkdown 内の autoIngestFeedback に一本化した(旧
//      fetchZeroSecThemesFromFeedback は同じ.mdの二重fetchになっていたため削除。
//      CHANGES_v86.md参照)。この抽出関数自体は変更していない。
function extractZeroSecThemesFromReport(reportText) {
  if (!reportText) return [];
  const lines = reportText.split("\n");
  const idx = lines.findIndex((line) => /0秒思考テーマ/.test(line));
  if (idx < 0) return [];
  const items = [];
  let sawContent = false;
  for (let i = idx + 1; i < Math.min(idx + 8, lines.length); i++) {
    const l = lines[i].trim();
    if (!l) { if (sawContent) break; else continue; }
    if (l.startsWith("##") || l.startsWith("#")) break;
    const m = l.match(/^[-・•*]\s*(.+)$/);
    if (!m) { sawContent = true; continue; }  // 箇条書きでない行(説明文等)は候補化しない
    const raw = m[1].replace(/^\[[ xX]\]\s*/, "").trim();
    const colonIdx = raw.search(/[:：]/);
    const theme = (colonIdx >= 0 ? raw.slice(0, colonIdx) : raw).trim();
    const reason = colonIdx >= 0 ? raw.slice(colonIdx + 1).trim() : "";
    if (theme) items.push({ theme, reason });
    sawContent = true;
  }
  return items.slice(0, 3);
}

// v75 should-fix: スケジュール側(繰越・WBS候補や空き時間)が0件で下書きを置けない日でも、
// zeroSecThemesの提案が残っていれば「何も起きなかった」ように見せず、タイムラインへ案内する。
// _zeroSecThemeDraftが無い/対象日と不一致/空なら何もせずfalseを返す(呼び出し元は従来どおりの
// 「候補なし」トーストを出す)。
function showZeroSecThemesOnlyIfAny(date, auto) {
  if (!_zeroSecThemeDraft || _zeroSecThemeDraft.date !== date || !_zeroSecThemeDraft.items.length) return false;
  if (!auto) { state.timelineMode = "planned"; setView("timeline"); }
  showToast("🧠 0秒思考のテーマ提案があります — タイムラインでご確認ください");
  render();
  return true;
}

// v60: 決定論配置(fallbackMorningPlan)を正規経路に昇格。Claude API 呼び出しは全廃。
// v62: 自宅PCバッチ生成のAIプランJSONを優先採用し、取得/検証に失敗した場合のみ決定論配置へ
//      フォールバックする(v60の経路は無傷で維持)。
async function runAiMorningPlan({ auto = false } = {}) {
  // v145レビュー対応: 完了(どの早期returnでもfinallyで確実に)までフラグを立て、回復Block
  // 下書き提案(ティッカー経路)がこの間に割り込んで_scheduleDraftを取り合わないようにする。
  _morningPlanInFlight = true;
  try {
  const date = todayISO();
  const DAY_START = 5 * 60, DAY_END = 23 * 60;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // 今日の当日プランなので、現在時刻より前は「空き」から除く(15分単位に切り上げ)
  const nowFloor = Math.min(DAY_END, Math.ceil(nowMin / 15) * 15);
  const freeGaps = computeFreeGaps(date, DAY_START, DAY_END)
    .map(([s, e]) => [Math.max(s, nowFloor), e])
    .filter(([s, e]) => e - s >= 15);

  // v75: zeroSecThemes はスケジュール配置(freeGaps/candidates)の成否と無関係に独立して取得する
  //      (下の早期returnより前で確定させ、配置できる候補が無い日でもテーマ提案だけは出す)。
  //      同日に既に採否判断済み(state.zeroSecThemeLog)のテーマは再提示しない。
  // v86: AIフィードバック_*.md内「## 0秒思考テーマ」見出し由来分は、hydrateStaticMarkdown側の
  //      autoIngestFeedbackが自動的にzeroThinking.themesへ直接登録するようになったため、ここでの
  //      取得・選定UIへの合流はやめた(v77で足したfetchZeroSecThemesFromFeedbackとのマージは削除)。
  //      AIプラン_*.json由来(fetchZeroSecThemes)だけを引き続きこの「追加/見送り」選定カードで
  //      扱う(JSON側は自動登録の対象にしていない、まだ人の判断を挟む設計のため)。
  //      取得失敗/zeroSecThemesキー無しなら null → 従来どおり _zeroSecThemeDraft は触らない
  //      (前回セッションの状態を保持)。既にzeroThinking.themesへ入っている(=自動取り込み済み)
  //      テーマ文字列は候補から除く(二重提示防止)。
  const planZeroSecThemes = await fetchZeroSecThemes(date);
  if (planZeroSecThemes) {
    const decided = new Set(state.zeroSecThemeLog.filter((l) => l.date === date).map((l) => l.theme));
    const existingThemeTexts = new Set(state.zeroThinking.themes.map((t) => t.text));
    const pending = planZeroSecThemes.filter((t) => !decided.has(t.theme) && !existingThemeTexts.has(t.theme));
    _zeroSecThemeDraft = pending.length ? { date, items: pending } : null;
  }

  const aiPlan = freeGaps.length ? await tryFetchAiPlan(date, freeGaps) : null;
  if (aiPlan) {
    _scheduleDraft = { date, items: aiPlan.items, skipped: aiPlan.skipped, source: "ai-plan" };
    _draftUndo = null; _draftUndoHistoryEntry = null;  // v62: 新規下書きでは前セッションのUndoを持ち越さない
    // v65(v64設計§3残余): AI自身が「配置しない」と判断した候補(kind:"ai")を永続ログへ記録。
    //      "expired"(空き時間との不整合で機械的に除外)は対象外 — AIの判断そのものではないため。
    const aiSkipped = aiPlan.skipped.filter((s) => s.kind === "ai");
    if (aiSkipped.length) {
      aiSkipped.forEach((s) => {
        state.aiPlanSkippedLog.push({ date, title: s.title, reason: s.reason || "", at: nowDateTime() });
      });
      if (state.aiPlanSkippedLog.length > AI_PLAN_SKIPPED_LOG_MAX) {
        state.aiPlanSkippedLog = state.aiPlanSkippedLog.slice(-AI_PLAN_SKIPPED_LOG_MAX);
      }
      saveState();
    }
    // v126: v122追補で足していた「今週のやりたいこと」のAIプラン合流ブロックは撤去した
    //       (state.weeklyWishesの週次選定ルートそのものを廃止。CHANGES_v126.md参照)。
    if (!auto) { state.timelineMode = "planned"; setView("timeline"); }
    showToast(auto
      ? "🌅 AIプランの下書きを置きました。タイムラインで調整→確定してください"
      : "🌅 AIプランを下書きに置きました — 確認して「確定」してください");
    render();
    return;
  }

  const candidates = aiMorningPlanCandidates(date);
  if (!candidates.length) {
    if (showZeroSecThemesOnlyIfAny(date, auto)) return;
    if (!auto) showToast("配置できる候補がありません(繰越・WBS未完了が対象です)");
    return;
  }
  if (!freeGaps.length) {
    if (showZeroSecThemesOnlyIfAny(date, auto)) return;
    if (!auto) showToast("今日は空き時間がありません(予定が埋まっています)");
    return;
  }

  const { items, skipped } = fallbackMorningPlan(candidates, freeGaps);
  if (!items.length) {
    if (showZeroSecThemesOnlyIfAny(date, auto)) return;
    render();
    if (!auto) showToast("空き時間に配置できる候補がありませんでした");
    return;
  }

  _scheduleDraft = { date, items, skipped, source: "deterministic" };
  _draftUndo = null; _draftUndoHistoryEntry = null;  // v62: 新規下書きでは前セッションのUndoを持ち越さない
  if (!auto) { state.timelineMode = "planned"; setView("timeline"); }
  showToast(auto
    ? "🌅 今日の下書きプランを置きました。タイムラインで調整→確定してください"
    : "🌅 空き時間へ自動配置しました — 確認して「確定」してください");
  render();
  } finally {
    _morningPlanInFlight = false;
  }
}

// v59: 朝の一括プランニングの自動起動(opt-in・既定OFF)。maybeAutoMorningReview と同じパターン。
//      その日初めてアプリを開いたのが10:00以前 かつ 当日の非ルーティンBlockが0件のときだけ実行し、
//      1日1回ガード(localStorage)。ガードは実行を決めた時点で立てるため、破棄しても再自動起動しない。
const AUTO_MORNING_PLAN_KEY = "taskchute-auto-morning-plan-date";  // 端末ローカル

// v145レビュー対応: 戻り値をvoidからPromise|nullへ変更した(実際にrunAiMorningPlanを起動した
// ときだけそのPromiseを返す。起動条件を満たさなかった場合はnull)。起動時経路(state.selectedDate
// ===todayISO()の起動シーケンス)が「朝プランの完了後に回復Block下書き提案を連鎖評価する」ために
// 参照する。既存の呼び出し箇所(setTimeout(maybeAutoMorningPlan, ...)、戻り値を使わない)は
// 戻り値の型変更による影響を受けない。
function maybeAutoMorningPlan() {
  if (!state.settings.ai?.autoMorningPlan) return null;
  const today = todayISO();
  try {
    if (localStorage.getItem(AUTO_MORNING_PLAN_KEY) === today) return null;  // 1日1回(失敗・破棄後も再試行しない)
  } catch { /* 読めなければ続行 */ }
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() > 10 * 60) return null;  // 10:00より後の初回起動は対象外
  const hasNonRoutineToday = state.blocks.some((b) =>
    !b.deleted && b.date === today && b.category !== "ルーティン" && !b.recurrenceGroupId);
  if (hasNonRoutineToday) return null;  // 既に当日のBlockがあれば白紙提案の出番ではない
  try { localStorage.setItem(AUTO_MORNING_PLAN_KEY, today); } catch { /* 記録できなくても続行 */ }
  // v62: runAiMorningPlan は AIプランJSONのfetchを含むため async 化した。同期 throw は
  //      try/catch で、非同期 reject は .catch() で拾い、どちらも静かに握りつぶす(手動実行は常に可能)。
  try {
    return runAiMorningPlan({ auto: true }).catch((error) => {
      console.warn("朝プラン自動下書きをスキップ:", error.message);
    });
  } catch (error) {
    console.warn("朝プラン自動下書きをスキップ:", error.message);
    return null;
  }
}

// D&D(Pointer Events = iPadタッチ / マウス両対応)。15分スナップ。
// ドラッグ中は該当要素の style だけ更新し、pointerup で正規化再描画(フォーカス・スクロール保護)。
document.addEventListener("pointerdown", (event) => {
  if (!_scheduleDraft) return;
  const resizeEl = event.target.closest("[data-draft-resize]");
  const blockEl = event.target.closest(".draft-block");
  if (!resizeEl && !blockEl) return;
  if (event.target.closest("[data-action]")) return;  // ×ボタンは click 側で処理
  const id = resizeEl ? resizeEl.dataset.draftResize : blockEl.dataset.draftId;
  const item = _scheduleDraft.items.find((x) => x.id === id);
  const el = resizeEl ? resizeEl.closest(".draft-block") : blockEl;
  if (!item || !el) return;
  const rowHeight = Number(el.dataset.rowHeight) || 60;
  snapshotDraftForUndo();  // v62: ドラッグ開始前の状態を1段Undoとして退避(historyEntryなし)
  _draftDrag = { id, mode: resizeEl ? "resize" : "move", startY: event.clientY, origStart: item.start, origMinutes: item.minutes, rowHeight, el };
  el.classList.add("is-dragging");
  event.preventDefault();
});
document.addEventListener("pointermove", (event) => {
  if (!_draftDrag || !_scheduleDraft) return;
  const item = _scheduleDraft.items.find((x) => x.id === _draftDrag.id);
  if (!item) return;
  const { rowHeight, el } = _draftDrag;
  const dMin = Math.round(((event.clientY - _draftDrag.startY) / rowHeight) * 60 / 15) * 15;
  if (_draftDrag.mode === "move") {
    item.start = clamp(_draftDrag.origStart + dMin, 5 * 60, 24 * 60 - item.minutes);
    el.style.top = `${((item.start - 5 * 60) / 60) * rowHeight}px`;
  } else {
    item.minutes = clamp(_draftDrag.origMinutes + dMin, 15, 24 * 60 - item.start);
    el.style.height = `${Math.max(26, (item.minutes / 60) * rowHeight)}px`;
  }
  const label = el.querySelector(".draft-block-time");
  if (label) label.textContent = `${minToHHMM(item.start)}〜${minToHHMM(item.start + item.minutes)}(${item.minutes}分)`;
  event.preventDefault();
});
const endDraftDrag = () => {
  if (!_draftDrag) return;
  _draftDrag.el.classList.remove("is-dragging");
  _draftDrag = null;
  render();  // 位置・ラベルを正規化
};
document.addEventListener("pointerup", endDraftDrag);
document.addEventListener("pointercancel", endDraftDrag);

// v168: 月間プランニングボードのカードD&D(pointerdown/move/up/cancelリスナー3件+
// WISH_DRAG_THRESHOLD)はsrc/features/wish.jsへ移動した(app.js分割・段階4-2)。

// v60: 週次/12週サイクルのAI壁打ち(runAiWeekly/runAiCycle)・0秒思考のまとめ所感
//      (runAiZeroComment)・今日のタスク提案(runAiTodaySuggest。朝の一括プランニングが
//      上位互換のため削除)・朝イチ自動レビュー(maybeAutoMorningReview)は、いずれも
//      Claude API 呼び出し前提の機能だったため全廃した。詳細は CHANGES_v60.md 参照。

// v49: =========================================================
//  横断検索(0秒思考・ジャーナル・問い・AIフィードバック・日報)
//  溜まったストックを一発で引けるようにする。モーダル内で完結し、ナビは増やさない。
// =========================================================
let _searchTimer = null;  // 入力デバウンス(非永続)
const SEARCH_MAX_RESULTS = 50;

function openSearchModal() {
  state.modal = { type: "search" };
  renderModal(buildSearchModal());
  setTimeout(() => document.querySelector("#cross-search-input")?.focus(), 60);
}

function buildSearchModal() {
  return `
    <div class="modal-card search-modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">🔍 横断検索</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <input class="input" id="cross-search-input" type="search" autocomplete="off"
          placeholder="0秒思考・ジャーナル・問い・AIフィードバック・日報 を検索">
        ${(state.settings.github?.token) ? `<label class="checkbox-line" style="font-size:12px; margin-top:8px">
          <input type="checkbox" id="cross-search-archive" ${_archiveCache ? "checked" : ""}>
          📦 アーカイブも検索(GitHubの archive/ から読込)
        </label>` : ""}
        <div id="cross-search-results" class="search-results">
          <div class="muted" style="font-size:12px">2文字以上で検索します。</div>
        </div>
      </div>
    </div>`;
}

// マッチ位置の前後を切り出し、ヒット部分を <mark> で強調(全体を escapeHTML してから組む)
function searchSnippet(text, idx, qlen) {
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + qlen + 45);
  const clean = (s) => escapeHTML(s.replace(/\s+/g, " "));
  return `${start > 0 ? "…" : ""}${clean(text.slice(start, idx))}<mark>${clean(text.slice(idx, idx + qlen))}</mark>${clean(text.slice(idx + qlen, end))}${end < text.length ? "…" : ""}`;
}

function crossSearchHits(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return null;
  const hits = [];
  const push = (kind, label, date, text, jump) => {
    const idx = (text || "").toLowerCase().indexOf(q);
    if (idx === -1) return;
    hits.push({ kind, label, date: date || "", snippet: searchSnippet(text, idx, q.length), jump });
  };
  (state.zeroThinking?.entries || []).forEach((e) => {
    push("zero", "0秒思考", e.date, `${e.theme || ""}\n${e.body || ""}`, { view: "zero", ztSearch: query.trim() });
  });
  Object.entries(state.journals || {}).forEach(([date, text]) => {
    push("journal", "ジャーナル", date, text, { view: "journal", date });
  });
  (state.questions || []).filter((x) => !x.deleted).forEach((x) => {
    push("question", "問い", (x.createdAt || "").slice(0, 10), `${x.text}\n${x.settledNote || ""}`, { view: "zero", zeroTab: "question" });
  });
  Object.entries(state.feedback || {}).forEach(([date, text]) => {
    push("feedback", "AIフィードバック", date, text, { view: "journal", date });
  });
  Object.entries(state.reports || {}).forEach(([date, text]) => {
    push("report", "日報", date, text, { view: "reports", date });
  });
  // v53: アーカイブ合流(オプトイン時のみ。ジャンプ先は無い=スニペット閲覧)
  if (_archiveCache && document.querySelector("#cross-search-archive")?.checked) {
    Object.entries(_archiveCache.journals || {}).forEach(([date, text]) => push("arch", "旧ジャーナル", date, text, null));
    Object.entries(_archiveCache.feedback || {}).forEach(([date, text]) => push("arch", "旧AIフィードバック", date, text, null));
    Object.entries(_archiveCache.reports || {}).forEach(([date, text]) => push("arch", "旧日報", date, text, null));
  }
  hits.sort((a, b) => b.date.localeCompare(a.date));  // 新しい順
  return hits;
}

function crossSearchResultsHTML(query) {
  // v53: アーカイブ読込中の表示
  const loadingNote = _archiveLoadState === "loading"
    ? `<div class="muted" style="font-size:11.5px; margin-bottom:6px">📦 アーカイブを読み込み中…</div>` : "";
  const hits = crossSearchHits(query);
  if (hits === null) return `${loadingNote}<div class="muted" style="font-size:12px">2文字以上で検索します。</div>`;
  if (!hits.length) return `${loadingNote}<div class="muted" style="font-size:12px">「${escapeHTML(query.trim())}」に一致するものはありません。</div>`;
  const shown = hits.slice(0, SEARCH_MAX_RESULTS);
  const inner = (h) => `
        <span class="search-kind search-kind-${h.kind}">${h.label}</span>
        <span class="search-date">${h.date}</span>
        <span class="search-snippet">${h.snippet}</span>`;
  return `
    ${loadingNote}
    <div class="muted" style="font-size:11.5px; margin-bottom:6px">${hits.length}件${hits.length > shown.length ? `(新しい順に${shown.length}件を表示)` : ""}</div>
    ${shown.map((h) => h.jump ? `
      <button class="search-hit" data-action="search-jump" data-view="${h.jump.view}"
        ${h.jump.date ? `data-date="${h.jump.date}"` : ""}
        ${h.jump.zeroTab ? `data-zero-tab="${h.jump.zeroTab}"` : ""}
        ${h.jump.ztSearch !== undefined ? `data-zt-search="${escapeHTML(h.jump.ztSearch)}"` : ""}>${inner(h)}
      </button>` : `
      <div class="search-hit is-archive" title="アーカイブ済み(閲覧のみ)">${inner(h)}</div>`).join("")}
  `;
}

// v46: =========================================================
//  未完了ブロックの繰り越し(先送り)。migratedTo を活用。
//  昨日分のみ提示 = バックログ化しない(CONCEPT §5.1)。判断は人間、搬送だけ自動。
// =========================================================
function carryableBlocks() {
  const prev = addDays(todayISO(), -1);
  return state.blocks.filter((b) => !b.deleted && b.date === prev && !b.completed && !b.migratedTo
    && b.category !== "ルーティン" && !b.recurrenceGroupId   // ルーティン/繰り返しは翌日自動生成されるので対象外
    && !isStaleBlock(b));                                    // v48: 中断/中止タスクの分は繰り越し提案しない
}
function carryOverPanel() {
  if (state.selectedDate !== todayISO()) return "";  // 今日を見ている時だけ
  const list = carryableBlocks();
  if (!list.length) return "";
  return `<div class="carryover-panel">
    <div class="carryover-cap">昨日の未完了(${list.length}件)— 今日に繰り越す?</div>
    ${list.map((b) => `<div class="carryover-row">
      <span class="carryover-title">${escapeHTML(b.title)}${migrationBadgeHTML(b.carryCount)}${b.plannedStartAt ? ` <span class="muted">${timeFromDateTime(b.plannedStartAt)}</span>` : ""}${b.category ? `<span class="cat-chip" style="background:${getCategoryColor(b.category)}1f; color:${getCategoryColor(b.category)}; border:1px solid ${getCategoryColor(b.category)}66">${escapeHTML(b.category)}</span>` : ""}</span>
      <button class="btn ghost" data-action="carry-over" data-id="${b.id}">→ 今日へ</button>
    </div>`).join("")}
  </div>`;
}

// v65: 10x機構(designs/10x-mechanism.md 2-1・§1)==============================
// Task/Blockに「資産を作る/繰り返しを消す/一回きり」を選べる任意属性(leverageType)。
// 「10xか2xか」を毎タスクに問うルーティン化はしない(設計書6章の歯止め)ため、
// 属性は完全に任意・未設定を裁かない。一覧・タイムラインには控えめなマークのみ出す。
function leverageTypeLabel(type) {
  return ({ asset: "資産", eliminate: "削減", oneoff: "単発" })[type] || "";
}
// 一覧・タイムライン用の控えめマーク。oneoff(単発=通常の2x)は視覚ノイズを増やさないため無表示。
function leverageTypeMarkHTML(type) {
  const icon = ({ asset: "⚙", eliminate: "✂" })[type];
  return icon ? `<span class="lev-mark lev-${type}" title="${leverageTypeLabel(type)}(10x機構)">${icon}${leverageTypeLabel(type)}</span>` : "";
}
// Task/Block編集モーダルの leverageType セレクト用オプション
function leverageTypeOptionsHTML(current) {
  const opts = [
    ["", "(未設定)"],
    ["asset", "⚙ 資産を作る(寝てても稼ぐ)"],
    ["eliminate", "✂ 繰り返しを消す"],
    ["oneoff", "・ 一回きり"]
  ];
  return opts.map(([v, label]) =>
    `<option value="${v}" ${(current || "") === v ? "selected" : ""}>${label}</option>`).join("");
}
// 設計書§1「10秒判定の3問」を、任意で開ける折りたたみヘルプとして編集モーダルに埋め込む。
// AI呼び出しはせず(v60方針)、チェック数をその場でカウントして leverageType セレクトへ反映するだけ。
// 保存(モーダルの「保存」ボタン)を押すまでは state に一切書き込まない。
// v147(UI改善計画Phase2 2-4a): 既定closedの<details>自体は既存どおり(v65から変更なし)。
// 判定済み(leverageType設定済み)なら、summary行に「未判定への招待文」ではなく判定結果を出す
// (currentType引数、任意。呼び出し元がTask/BlockそれぞれのleverageTypeを渡す)。
function leverageJudgeHelperHTML(currentType) {
  const judgedLabel = leverageTypeLabel(currentType || "");
  const summaryText = judgedLabel ? `10秒判定: 「${judgedLabel}」と判定済み(変更する)` : "10秒で判定する(任意)";
  return `
    <details class="lev-helper">
      <summary>${escapeHTML(summaryText)}</summary>
      <div class="lev-helper-body">
        <label class="checkbox-line"><input type="checkbox" data-lev-q="1"> 今日で終わらず、明日以降も自分の代わりに働き続けるか</label>
        <label class="checkbox-line"><input type="checkbox" data-lev-q="2"> やった後、同じ問題が来たとき自分の時間はもう要らなくなっているか</label>
        <label class="checkbox-line"><input type="checkbox" data-lev-q="3"> 代替可能な作業ではなく、自分にしか蓄積できない特殊知識か</label>
        <div class="row" style="gap:8px; margin-top:8px; align-items:center">
          <button type="button" class="btn" data-action="lev-judge">判定結果を反映</button>
          <span class="muted" style="font-size:11px">2問以上Yesなら「資産」。迷うなら未設定のままでOK。</span>
        </div>
      </div>
    </details>
  `;
}
// v65: AIプラン(自宅PCバッチ生成)側で付けた「[資産]」プレフィックスの検出(設計書2-3)。
// loop/plan/daily-plan.md に既に10x判定3問が入っており、AIがtitle先頭にこの印を付けたときだけ
// アプリ側がleverageType=assetを自動付与する(アプリ内AI呼び出しはしない。v60方針)。
const ASSET_TITLE_PREFIX = "[資産]";
function detectLeverageTypeFromTitle(title) {
  return (title || "").startsWith(ASSET_TITLE_PREFIX) ? "asset" : "";
}
// v65(v64設計§3残余): AIプランのskipped(kind:"ai")ログの上限。migrationRitualLogと同じ思想。
const AI_PLAN_SKIPPED_LOG_MAX = 300;

// v61: マイグレーション儀式(提案1)==============================
// 繰り越し回数(carryCount)を積み上げ、2回目以降は視覚マーク、3回目の繰り越しでは
// 即座に繰り越さず一呼吸置く確認モーダルを挟む。「書き写す手間が価値の審査になる」
// というバレットジャーナルの思想を、既存の carryOverBlock / 朝プラン確定(confirmScheduleDraft)
// の両経路に対して同じルールで適用する。
const MIGRATION_RITUAL_THRESHOLD = 3;
const MIGRATION_RITUAL_LOG_MAX = 300;
let _migrationRitualCtx = null;  // { srcId, nextCount, origin: 'panel'|'draft', draftItemId } 非永続

// SWIPE_TRIAGE_LOG_MAX: v166でファイル冒頭(RECURRENCE_FUTURE_DAYSの直後)へ移動した
// (configureGithubSync()のconstTDZ回避のため。値・用途は変更していない)。

// 2回目以降の繰り越しBlockに付ける小さなバッジ(派手にしない)
function migrationBadgeHTML(carryCount) {
  const n = Number(carryCount || 0);
  return n >= 2 ? `<span class="migration-badge" title="${n}回目の繰り越しです">↻${n}</span>` : "";
}

// この Block を今繰り越すと何回目になるか
function migrationNextCount(id) {
  const src = blockById(id);
  return (src?.carryCount || 0) + 1;
}

// carryOverPanel の「→ 今日へ」入口。3回目以降は儀式モーダルを先に出す。
function requestCarryOver(id) {
  const src = blockById(id);
  if (!src || src.migratedTo) return;
  const nextCount = migrationNextCount(id);
  if (nextCount >= MIGRATION_RITUAL_THRESHOLD) {
    openMigrationRitual(id, nextCount, { origin: "panel" });
    return;
  }
  carryOverBlock(id);
}

function carryOverBlock(id, { forceMIT = false } = {}) {
  const src = blockById(id);
  if (!src || src.migratedTo) return;
  const today = todayISO();
  const shift = (dt) => dt ? `${today}${dt.slice(10)}` : "";  // 予定時刻は同 HH:mm のまま今日へ
  const block = makeBlock({
    taskId: src.taskId, date: today, title: src.title, category: src.category,
    plannedStartAt: shift(src.plannedStartAt), plannedEndAt: shift(src.plannedEndAt),
    estimateMin: src.estimateMin
  });
  block.source = src.source || "";
  block.carryCount = (src.carryCount || 0) + 1;  // v61: 繰り越し回数を1つ積み上げる
  if (forceMIT) {
    // v61: 儀式で「今日やる」を選んだ場合はMIT化(既存の最大3個ルールは尊重する)
    const sameDayMITs = state.blocks.filter((b) => !b.deleted && b.date === today && b.isMIT);
    if (sameDayMITs.length < 3) block.isMIT = true;
  }
  state.blocks.push(block);
  // 旧ブロックを「繰り越し済み」に(未完了リストから外れ、再提案されない)
  state.blocks = state.blocks.map((b) => b.id === src.id ? { ...b, migratedTo: block.id, updatedAt: nowDateTime() } : b);
  saveAndRender("今日へ繰り越しました");
}

// 手放す選択時の「Wishへ移動」実行(Block削除は呼び出し側で行う)。
// 戻り値: 作成できたWishタスク本体(失敗時はfalse)。normalizeStateがWish Projectの存在を
// 必ず保証するため通常falseにはならないが、念のための防御(v61レビュー対応: トースト文言の
// 実態合わせ)。v152レビュー対応: 呼び出し元(仕分けモード)が作成後の新Wishのidを
// 参照できるよう、真偽値ではなくタスク本体を返す(既存の呼び出し元は真偽判定にしか
// 使っていないため後方互換)。
function moveBlockToWish(id) {
  const src = blockById(id);
  if (!src) return false;
  const wishProject = getWishProject();
  if (!wishProject) return false;
  const task = makeTask({ projectId: wishProject.id, title: src.title });
  // v79: addWish()と同じ理由でdueDateの「今日」既定を持ち込まない(Wishは期限任意)。
  task.dueDate = "";
  state.tasks.push(task);
  return task;
}

// 選択結果を軽量ログに記録(将来のバッチ分析用。aiScheduleHistoryと同じ思想)
// v156 2系統レビュー対応(必須1): logSwipeTriageと同じ理由で戻り値を { entry, evicted } にした。
// 既存の呼び出し元(戻り値未使用、下記5389行目)は影響なし。
function logMigrationRitual(block, choice) {
  const entry = {
    blockId: block?.id || "",
    title: block?.title || "",
    carryCount: (block?.carryCount || 0) + 1,
    choice,  // 'today' | 'decompose' | 'release' | 'avoid' | 'carry'
    at: nowDateTime()
  };
  state.migrationRitualLog.push(entry);
  let evicted = null;
  if (state.migrationRitualLog.length > MIGRATION_RITUAL_LOG_MAX) {
    evicted = state.migrationRitualLog.slice(0, state.migrationRitualLog.length - MIGRATION_RITUAL_LOG_MAX);
    state.migrationRitualLog = state.migrationRitualLog.slice(-MIGRATION_RITUAL_LOG_MAX);
  }
  return { entry, evicted };
}

function openMigrationRitual(srcId, nextCount, ctx) {
  const src = blockById(srcId);
  if (!src) return;
  _migrationRitualCtx = { srcId, nextCount, ...ctx };
  state.modal = { type: "migrationRitual", id: srcId };
  renderModal(buildMigrationRitualModal(src, nextCount));
}

function buildMigrationRitualModal(block, nextCount) {
  return `
    <div class="modal-card migration-ritual-modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">↻ ${nextCount}回目の繰り越しです</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <p class="migration-ritual-title">${escapeHTML(block.title)}</p>
        <p class="muted" style="font-size:13px; line-height:1.6">${nextCount}回持ち越しています。まだ価値がありますか?</p>
        <div class="migration-ritual-choices">
          <button class="btn" data-action="migration-ritual-choice" data-choice="today">今日やる(MIT候補に)</button>
          <button class="btn" data-action="migration-ritual-choice" data-choice="decompose">分解する(タイトル編集へ)</button>
          <button class="btn" data-action="migration-ritual-choice" data-choice="release">手放す(Wishへ移動 or 削除)</button>
          <button class="btn ghost" data-action="migration-ritual-choice" data-choice="avoid">Avoid Listへ記録して手放す</button>
          <button class="btn ghost" data-action="migration-ritual-choice" data-choice="carry">それでも繰り越す</button>
        </div>
      </div>
    </div>
  `;
}

function resolveMigrationRitual(choice) {
  if (!_migrationRitualCtx) return closeModal();
  const { srcId, origin, draftItemId } = _migrationRitualCtx;
  const src = blockById(srcId);
  logMigrationRitual(src, choice);
  _migrationRitualCtx = null;

  if (choice === "release") {
    const toWish = window.confirm(`「${src?.title || ""}」をWishへ移動しますか?\n(キャンセルで削除)`);
    // v61レビュー対応: Wish Projectが存在せず移動できなかった場合は、実態(削除のみ)に
    // 合わせてトースト文言を変える(normalizeStateが保証するため通常は起きないが念のため)。
    let releaseMsg = "手放しました(削除)";
    if (toWish) {
      releaseMsg = moveBlockToWish(srcId) ? "Wishへ移動しました" : "Blockを削除しました(Wishプロジェクトなし)";
    }
    state.blocks = state.blocks.map((b) => b.id === srcId ? { ...b, deleted: true, updatedAt: nowDateTime() } : b);
    if (origin === "draft" && _scheduleDraft) {
      _scheduleDraft.items = _scheduleDraft.items.filter((x) => x.id !== draftItemId);
      if (!_scheduleDraft.items.length) _scheduleDraft = null;
    }
    closeModal();
    saveAndRender(releaseMsg);
    return;
  }

  // v66: 10x機構(designs/10x-mechanism.md 2-4)。「手放す」の第3の選択肢 — 3回以上繰り越された
  // タスクは「無自覚な繰り返し作業」の実データそのものであり削除候補として精度が高いため、
  // 既存のAvoid List(state.settings.avoidList、addAvoidと同じ形の項目)へそのまま記録して手放す。
  // Wishへ迷わせず即座に「やらないこと」へ倒す点が release(Wish or 削除の二択)との違い。
  if (choice === "avoid") {
    const text = (src?.title || "").trim();
    if (text) {
      state.settings.avoidList = [...(state.settings.avoidList || []), {
        id: crypto.randomUUID(),
        text,
        createdAt: nowDateTime()
      }];
    }
    state.blocks = state.blocks.map((b) => b.id === srcId ? { ...b, deleted: true, updatedAt: nowDateTime() } : b);
    if (origin === "draft" && _scheduleDraft) {
      _scheduleDraft.items = _scheduleDraft.items.filter((x) => x.id !== draftItemId);
      if (!_scheduleDraft.items.length) _scheduleDraft = null;
    }
    closeModal();
    saveAndRender(text ? "Avoid Listへ記録し、手放しました" : "手放しました(削除)");
    return;
  }

  if (choice === "decompose") {
    if (origin === "draft" && _scheduleDraft) {
      _scheduleDraft.items = _scheduleDraft.items.filter((x) => x.id !== draftItemId);
      if (!_scheduleDraft.items.length) _scheduleDraft = null;
    }
    // v61レビュー対応: saveState()だけだと下書きから除外した項目がタイムラインに残存表示される
    // (renderModal はモーダル部分しか書き換えないため)。既存の saveAndRender 慣習に合わせ、
    // 先に render() で背後の画面(下書きレイヤ等)を最新化してからモーダルを開く。
    saveAndRender();
    openBlockEditor(srcId);  // タイトル編集モーダルへ(分解のきっかけ)。renderModalが上書きするのでcloseModal不要
    return;
  }

  if (choice === "today") {
    if (origin === "panel") {
      carryOverBlock(srcId, { forceMIT: true });
      closeModal();
    } else if (origin === "draft" && _scheduleDraft) {
      const it = _scheduleDraft.items.find((x) => x.id === draftItemId);
      if (it) { it.forceMIT = true; it._ritualResolved = true; }
      closeModal();
      confirmScheduleDraft();  // この項目は解決済みなので再スキャンでスキップされ、そのまま確定処理へ進む
    } else {
      closeModal();
    }
    return;
  }

  // choice === "carry"(それでも繰り越す)
  if (origin === "panel") {
    carryOverBlock(srcId);
    closeModal();
  } else if (origin === "draft" && _scheduleDraft) {
    const it = _scheduleDraft.items.find((x) => x.id === draftItemId);
    if (it) it._ritualResolved = true;
    closeModal();
    confirmScheduleDraft();
  } else {
    closeModal();
  }
}

function extractMITCandidatesFromReport(reportText) {
  if (!reportText) return [];
  // 「明日の MIT 候補:」の行から数行抽出(箇条書きまたは1行)
  // v75: loop/coach-daily.sh の実出力は「## 明日への提案」見出し + "- [ ] " チェックボックス箇条書き
  //      (「MIT候補」の文言は使われていない)ため、この見出しにも対応する(現物のAIフィードバック_*.mdで確認)。
  const lines = reportText.split("\n");
  const idx = lines.findIndex((line) => /(?:明日の)?\s*MIT\s*候補|明日への提案/i.test(line));  // v42: "## MIT候補" 固定フォーマットにも対応
  if (idx < 0) return [];
  const candidates = [];
  // 同じ行に「: 内容」がある場合
  const sameLine = lines[idx].split(/:|:/).slice(1).join(":").trim();
  if (sameLine) candidates.push(sameLine);
  // 次の数行が「- 」「・」始まりなら抽出(v75: 先頭の "[ ] "/"[x] " チェックボックス表記は候補文言から除く)
  // v75 should-fix2 対応中に判明: coach-daily.sh の実出力は見出しの直後に空行(Markdownの段落区切り)
  // を挟んでから箇条書きが始まる(例: "## 明日への提案\n\n- [ ] ...")。以前は最初の空行で即break
  // していたため、この見出し形式では候補抽出が常に0件だった。見出し直後の空行はスキップし、
  // 本文(箇条書き)が始まった後の空行でのみ終端するよう修正した。
  let sawContent = false;
  for (let i = idx + 1; i < Math.min(idx + 8, lines.length); i++) {
    const l = lines[i].trim();
    if (!l) { if (sawContent) break; else continue; }
    if (l.startsWith("##") || l.startsWith("#")) break;
    const m = l.match(/^[-・•*]\s*(.+)$/);
    if (m) {
      const raw = m[1].replace(/^\[[ xX]\]\s*/, "").trim();
      // v75 should-fix1: 「タスク名: 理由」形式(coach-daily.shの「明日への提案」実出力)は
      // 先頭コロン(半角:/全角:)より前のタスク名部分だけを候補にする。コロンが無ければ
      // 全文を候補にする(コロン無しの旧フォーマット互換)。
      const colonIdx = raw.search(/[:：]/);
      candidates.push((colonIdx >= 0 ? raw.slice(0, colonIdx) : raw).trim());
    } else if (!sawContent) {
      candidates.push(l);
    }
    sawContent = true;
  }
  return candidates.filter(Boolean).slice(0, 3);
}

// v168: WishタブTier1(CRUD・描画・月間ボードD&D)はsrc/features/wish.jsへ移動した
// (getWishProject/getSubtasksOf/wishProgress/nextStepOf/wishLastActivity/isWishStagnant/
// wishGroupKey/wishGroupLabel/lifeAreaColor/renderWish/renderWishBoard/
// scrollWishBoardToCurrentMonth/renderWishBoardCard/renderWishCard/renderWishDetail/
// renderWishSubtask/addWish/toggleWishOpen/addWishSubtask/toggleWishSubtask/
// wishSubtaskToTasks/realizeWish/unrealizeWish/deleteWish。app.js分割・段階4-2、
// wish.js冒頭コメント参照)。getWishProject/nextStepOf/wishSubtaskToTasksは
// 冒頭のimportで共有する。

// v152: 仕分けモード(designs/03-task-swipe.md S1「ボタン版」)==============================
// 決断疲れによる仕分けの先送りに対処するADHD支援機能。先送りBlock+Wishバックログを1枚ずつ
// 「今日やる/手放す/延期(来月)」の三択で処理する。データモデルへの新フィールド追加はゼロ
// (既存の migratedTo/carryCount/deleted/updatedAt/targetMonth/targetYear/status のみで表現)。
// 三択の意味は儀式(resolveMigrationRitual)の5択の部分集合に対応させ、新しい状態語彙は作らない。

// v152 2系統レビュー対応: セッション内(非永続・ページリロードで消える)の処理済みidセット。
// 「今日やる/延期」は元データを削除しない(Wish自体は残る)ため、これが無いとキューが
// updatedAt昇順で並び替わるだけで同じセッション内に何度も先頭へ再浮上し、終端しなかった。
let _triageSessionDone = new Set();
// 直近の描画で先頭に出したカードのid(二重タップガード。renderWishTriageで毎回更新)。非永続。
let _triageCurrentCardId = "";
// 直近に成立したtriageAction呼び出しの対象idと実行時刻(ms)。二重タップガード用。非永続。
let _triageLastActionId = "";
let _triageLastActionAt = 0;
// v154レビュー対応(FAIL修正、時間ベースの閾値だけでは解決不能と判明した経緯は下記):
//  - 「同一カードid」への短時間の二重発火は常にTRIAGE_ACTION_COOLDOWN_MS(350ms)ブロックする
//    (via問わず)。
//  - 「別カードへの操作」のブロックは**via==="button"の場合のみ**に限定する(スワイプは対象外)。
//    タップは指が触れた瞬間に完了する動作のため、新しく表示されたカードへ指の勢いで
//    そのまま反射的に触れてしまう事故(v152の「二重タップガード」テストが検出していた事故)が
//    起こりうるが、スワイプは閾値超のドラッグという物理的コストを伴う別ジェスチャのため、
//    直前の確定直後でも別カードへの正当な連続スワイプが起こりうる(=210ms間隔の連続スワイプの
//    2件目まで飲み込んでいたのが本バグ)。
//  検討過程の記録: 当初「直前の成功からの経過時間が短ければvia不問で一律ブロックする」
//  (quick guard)を試したが、Playwrightの`locator.click()`は要素の安定性待機のため
//  実測で二重クリックの間隔が41〜362msまで大きくばらつくことが分かり(page.evaluate内で
//  click()を直接呼ぶ場合はこの限りではない)、210ms間隔の意図的な連続スワイプと安全に
//  分離できる閾値が存在しなかった(どんな閾値でも一方を誤検知する)。via(呼び出し経路が
//  ボタンかスワイプか)という時間に依存しない構造的な条件に切り替えることで解決した。
const TRIAGE_ACTION_COOLDOWN_MS = 350;
// v162: 手放す/延期の直後に理由チップを尋ねる。全画面モーダルにするとUndoトースト
// (triageUndoToastOpts、5秒間)を覆ってタップ不能にしてしまうため、モーダルではなく
// 仕分けカードの下に出す控えめなインライン欄にする(下記_pendingInlineReason参照。
// 遅延setTimeoutは使わない=Undoトーストと同時に見えていて構わない設計にした)。

// v168: wishHasTodayBlock(Tier2)はsrc/features/wish.jsへ移動した(冒頭のimportで共有する。
// app.js分割・段階4-2、wish.js冒頭コメント参照)。

// キュー = 先送りBlock(carryableBlocks、既存順)→ Wishバックログ(未実現・updatedAt昇順)の順。
// wishes は呼び出し元(renderWish)が area/実現済みフィルタ済みのものをそのまま渡す
// (仕分けも今見ているフィルタ範囲に揃える。フィルタ無しなら全件)。
// v152レビュー対応(必須1): セッション内処理済み(_triageSessionDone)と、既に当日Block化済み
// (status=doing かつ wishHasTodayBlock)のWishをキューから除外し、全カード処理で必ず
// 「仕分け完了」(0件)へ到達するようにする。
function triageQueue(wishes) {
  const blocks = carryableBlocks().filter((b) => !_triageSessionDone.has(b.id));
  const wishQueue = (wishes || [])
    .filter((w) => !w.realized)
    .filter((w) => !_triageSessionDone.has(w.id))
    .filter((w) => !(w.status === "doing" && wishHasTodayBlock(w.id)))
    .slice()
    .sort((a, b) => (a.updatedAt || "").localeCompare(b.updatedAt || ""));
  return [
    ...blocks.map((b) => ({ kind: "block", id: b.id, item: b })),
    ...wishQueue.map((w) => ({ kind: "wish", id: w.id, item: w }))
  ];
}

// カードの出所バッジ(「昨日の先送り ↻N」/「Wish」)
function triageBadgeHTML(entry) {
  if (entry.kind === "block") {
    const n = Number(entry.item.carryCount || 0);
    return `<span class="triage-badge">昨日の先送り${n >= 1 ? ` ↻${n}` : ""}</span>`;
  }
  return `<span class="triage-badge">Wish</span>`;
}

// カードの補足1行(見積・カテゴリ or 動機・領域)
function triageSubtitleText(entry) {
  if (entry.kind === "block") {
    const b = entry.item;
    const parts = [];
    if (b.category) parts.push(b.category);
    if (b.estimateMin) parts.push(`見積${b.estimateMin}分`);
    return parts.join(" · ") || "先送りされたタスクです";
  }
  const w = entry.item;
  return w.motivation || (w.lifeArea ? `領域: ${w.lifeArea}` : "やりたいこと");
}

// 選択結果を軽量ログに記録(migrationRitualLogと同じ思想。集計・分析はバッチ側)
// v154: viaはtriageAction呼び出し元から渡される('button'|'swipe')。既定は後方互換のため'button'。
// v156 2系統レビュー対応(必須1): 戻り値を { entry, evicted } にした。呼び出し元(triageAction)が
// Undo用に「積んだエントリそのものへの参照」と「上限超過で押し出された最古エントリ」を保持できる
// ようにするため(詳細は_triageUndo付近のコメント参照)。既存の呼び出し元(戻り値未使用)は影響なし。
function logSwipeTriage(kind, targetId, action, carryCount, via = "button") {
  const entry = {
    at: nowDateTime(),
    targetId,
    kind,          // 'block' | 'wish'
    action,        // 'today' | 'drop' | 'defer'
    via,           // 'button' | 'swipe'(v154)
    carryCount: Number(carryCount || 0)
  };
  state.swipeTriageLog.push(entry);
  let evicted = null;
  if (state.swipeTriageLog.length > SWIPE_TRIAGE_LOG_MAX) {
    evicted = state.swipeTriageLog.slice(0, state.swipeTriageLog.length - SWIPE_TRIAGE_LOG_MAX);
    state.swipeTriageLog = state.swipeTriageLog.slice(-SWIPE_TRIAGE_LOG_MAX);
  }
  return { entry, evicted };
}

// v156: 仕分けモードUndo(designs/03-task-swipe.md S3、K確定2026-07-27「手放すの復元は
// Undoトースト(直後のみ)で足りる。復元一覧画面は作らない」)。直前1操作のみが対象で
// スタックは持たない——次のtriageAction成立(新しい三択操作)が_triageUndoを上書きするだけで
// 自動的に前のUndoは失効する(明示クリア不要)。
// v156 2系統レビュー対応(必須2、Codex指摘): 5秒の視覚的な非表示化(showToastの既存タイマー+
// `.toast:not(.show)`のpointer-events:noneガード)だけでは、ボタンに既にキーボードフォーカスが
// 当たっていた場合Enter/Spaceでの活性化がpointer-eventsを無視して素通りしてしまう。
// triageUndoToastOpts()のonExpireで、タイマー満了と同時に_triageUndoそのものを明示的にnull化
// することで、期限切れ後にEnterで発動しても実質的に無害(triageUndo側のguardId不一致で無視)に
// なるよう二重に防いだ。
// revertクロージャは「巻き戻し先の値」だけを持つデータで、state操作以外は一切行わない
// (呼び出し側のtriageUndo()がsaveAndRenderをまとめて行う)。
let _triageUndo = null; // { guardId, revert() } | null
// v162: 「手放す/延期」の直後、renderWishTriage()がカードの下にインラインで理由チップ欄を
// 出すためのフラグ(_triageUndoと同じ「単一スロット・非永続」の型)。triageAction()の冒頭で
// 三択が成立するたびに必ずnullへリセットしてから(2系統レビュー対応・推奨5)、
// block/drop・block/deferの分岐だけが自分のid向けへ改めてセットする。そのため
// 「今日やる」やWish系操作の後には出ない(前カード分が次カードの下に居座らない)。
// Undo(triageUndo)のrevertクロージャでも対象idが一致すればnull化する。
let _pendingInlineReason = null; // { blockId } | null

// Undoトースト用のtoastOpts(v150のアクション付きトースト機構を再利用。5秒固定は設計書§③)。
function triageUndoToastOpts(guardId) {
  return {
    action: "triage-undo", id: guardId, label: "元に戻す", durationMs: 5000,
    // guardId一致を確認してからnull化する(念のための防御。showToastは新規呼び出しのたびに
    // clearTimeoutで前のタイマーを破棄するため、実際にはこのonExpireが「既に上書きされた
    // 古いUndo」に対して発火することは無いはずだが、二重の安全策として残す)。
    onExpire: () => { if (_triageUndo && _triageUndo.guardId === guardId) _triageUndo = null; }
  };
}

// v156 2系統レビュー対応(必須1): swipeTriageLog/migrationRitualLogから「参照が一致する
// エントリ」だけを取り除き、上限超過(200/300件)で押し出されていた最古エントリ(あれば)を
// 先頭へ戻す。配列中の位置(末尾/添字)に一切依存しないため、上限トリムが絡んでも・将来ログへの
// 追記コードが増えても構造的に正しく動く(このtriageActionが呼ばれてからUndoされるまでの間に
// 他のtriageActionは起こらない=_triageUndoは次の成功で上書きされ古いrevertはもう呼ばれない、
// という不変条件はあるが、それに依存しない実装にした)。
function triageUndoLogArray(arr, entry, evicted) {
  const kept = arr.filter((e) => e !== entry);
  return evicted && evicted.length ? [...evicted, ...kept] : kept;
}

// トースト「元に戻す」ボタンの実行。guardIdが直近の_triageUndoと一致しない場合は無視する
// (v150二重タップガードと同じ「idが一致しなければ無視」パターン。古いトーストの残骸や
// 次の操作で既に失効したUndoへの誤発火を防ぐ)。
function triageUndo(id) {
  if (!_triageUndo || _triageUndo.guardId !== id) return;
  const revert = _triageUndo.revert;
  _triageUndo = null;
  revert();
  saveAndRender("元に戻しました");
}

// 三択ボタンの実行(kind: 'block'|'wish', action: 'today'|'drop'|'defer')。
// v152 2系統レビュー対応:
//  (a) 二重タップガード: 直前の実行からTRIAGE_ACTION_COOLDOWN_MS未満の呼び出し、または
//      現在描画中のカードid(_triageCurrentCardId)と一致しない呼び出しは無視する
//      (連打・再描画後の新カードへの誤爆を防ぐ)。
//  (b) logSwipeTriageは行動が実際に成立した箇所の直前(saveAndRender/委譲呼び出しの直前)に
//      移した。早期return(該当id無し等)ではログを一切積まない。
//  (c) 処理成立時は必ず_triageSessionDoneへidを積み、以後このセッションのキューから除外する。
//  (d) v154: 第4引数viaは呼び出し元('button'クリック or スワイプ確定)を示す。
//      logSwipeTriageへそのまま渡すほか、下記(e)のクールダウン判定にも使う(状態遷移の
//      分岐そのものには一切使わない=どの三択がどう作用するかはvia非依存のまま)。
// v154 2系統レビュー対応(FAIL修正):
//  (e) クールダウンの「別カードへの操作」ブロックをvia==="button"の場合に限定した
//      (詳細はTRIAGE_ACTION_COOLDOWN_MSの定義コメント参照)。旧実装は別カードへの操作も
//      viaを問わず一律350msブロックしていたため、退場アニメ180ms+短い間隔での連続スワイプが
//      2件目を飲み込んでいた(修正のテストはtests/v154.test.js「連続スワイプ」、既存の
//      二重タップガードの回帰確認はtests/v152.test.js参照)。
//  (f) 戻り値をboolean化(成立=true/不成立=false)。呼び出し元(スワイプの退場アニメ確定処理)は
//      falseの場合にカードを視覚的に原状復帰させる(state変更なしで見た目だけ消えるのを防ぐ)。
function triageAction(kind, id, action, via = "button") {
  const now = Date.now();
  const withinCooldown = now - _triageLastActionAt < TRIAGE_ACTION_COOLDOWN_MS;
  if (withinCooldown && id === _triageLastActionId) return false;  // 同一idの二重発火(via問わず)
  if (withinCooldown && via === "button") return false;  // 別カードへの操作はボタン限定でブロック
  if (_triageCurrentCardId && id !== _triageCurrentCardId) return false;
  // v162 2系統レビュー対応(推奨5): ここから先は必ず何らかの三択が成立するため、まず
  // 前カード分の_pendingInlineReasonを引っ込める(「今日やる」やWish系操作では再設定しない
  // ため、そのままだと次カードの下に前Blockの理由欄が居座り続けてしまう)。block/drop・
  // block/deferの分岐は、この直後に自分のid向けへ再セットする。
  _pendingInlineReason = null;

  if (kind === "block") {
    const block = blockById(id);
    if (!block || block.deleted) return false;
    if (action === "today") {
      // v156: Undo用に変更前のBlockを丸ごとスナップショットし、carryOverBlockが新規に
      // 作るBlockをid集合の差分で特定する(carryOverBlock自体は他の呼び出し元
      // 〈requestCarryOver〉とも共有する既存関数のため、戻り値を変えて対応するより
      // 差分検出のほうが安全=既存の挙動に一切触れない)。
      const blockSnapshot = { ...block };
      const blockIdsBefore = new Set(state.blocks.map((b) => b.id));
      _triageLastActionAt = now;
      _triageLastActionId = id;
      _triageSessionDone.add(id);
      const logResult = logSwipeTriage("block", id, action, block.carryCount, via);
      carryOverBlock(id);  // 内部でsaveAndRender済み(既定トースト「今日へ繰り越しました」)
      const newBlock = state.blocks.find((b) => !blockIdsBefore.has(b.id));
      if (newBlock) {
        _triageUndo = {
          guardId: id,
          revert: () => {
            state.blocks = state.blocks.filter((b) => b.id !== newBlock.id);  // 作成したBlockを取り消し
            state.blocks = state.blocks.map((b) => b.id === id ? { ...blockSnapshot, updatedAt: nowDateTime() } : b);  // 元(carryable)へ復元
            state.swipeTriageLog = triageUndoLogArray(state.swipeTriageLog, logResult.entry, logResult.evicted);
            _triageSessionDone.delete(id);
          }
        };
        // carryOverBlockの既定トーストをUndoボタン付きへ上書きする(#toastは#appの外にあり
        // carryOverBlock内のrender()では触れられないため、二重呼び出しでも問題ない)。
        // v156 2系統レビュー対応(推奨4): carryOverBlock内のsaveAndRenderが既に容量超過警告
        // (_lastSaveError)を出している場合は上書きしない(警告の握り潰し防止)。
        if (!_lastSaveError) showToast("今日へ繰り越しました", triageUndoToastOpts(id));
      }
      return true;
    }
    if (action === "drop") {
      // 儀式のavoid相当(designs/03-task-swipe.md §③表): deleted化+migrationRitualLogにも記録
      // (集計源を分裂させない。avoidListへの追記まではしない=表に明記された2アクションのみ)
      const blockSnapshot = { ...block };  // v156: Undo用
      _triageLastActionAt = now;
      _triageLastActionId = id;
      _triageSessionDone.add(id);
      const migResult = logMigrationRitual(block, "avoid");
      state.blocks = state.blocks.map((b) => b.id === id ? { ...b, deleted: true, updatedAt: nowDateTime() } : b);
      const logResult = logSwipeTriage("block", id, action, block.carryCount, via);
      // v156: deleted:trueを解除するだけで完全復元できる(新規レコード生成が無いため単純)。
      // migrationRitualLog/swipeTriageLogとも参照一致するエントリだけを取り消す(必須1)。
      _triageUndo = {
        guardId: id,
        revert: () => {
          state.blocks = state.blocks.map((b) => b.id === id ? { ...blockSnapshot, updatedAt: nowDateTime() } : b);
          state.migrationRitualLog = triageUndoLogArray(state.migrationRitualLog, migResult.entry, migResult.evicted);
          state.swipeTriageLog = triageUndoLogArray(state.swipeTriageLog, logResult.entry, logResult.evicted);
          _triageSessionDone.delete(id);
          // v162: Undoされたので理由チップ欄も引っ込める(このidが対象のままなら)
          if (_pendingInlineReason && _pendingInlineReason.blockId === id) _pendingInlineReason = null;
        }
      };
      // v162: インラインの理由チップ欄はrenderWishTriage()がこのフラグを見て描画するため、
      // saveAndRender()より前に立てておけば同じ render() で一緒に出る(Undoトーストと同時表示)。
      _pendingInlineReason = { blockId: id };
      saveAndRender("手放しました", triageUndoToastOpts(id));
      return true;
    }
    if (action === "defer") {
      // 儀式のrelease相当: Wishへ移動してから元Blockをdeleted化(moveBlockToWish自体は削除しない)。
      // v152レビュー対応(設計書§④明文の記録漏れ): logMigrationRitual(release)を追加し、
      // 集計源(migrationRitualLogが正)を分裂させない。
      // v154: 延期はボタン専用(スワイプの方向割当から廃止。CHANGES_v154.md参照)。
      const blockSnapshot = { ...block };  // v156: Undo用
      _triageLastActionAt = now;
      _triageLastActionId = id;
      _triageSessionDone.add(id);
      const moved = moveBlockToWish(id);
      // v152レビュー対応(必須1・終端性): moveBlockToWishが新規に作るWishは、この場で今まさに
      // 「延期する」と判断した対象そのものなので、同じセッションのキューへ即座に再浮上させない
      // (次回セッション=リロード後には通常のWishバックログとして自然に現れる)。
      if (moved) _triageSessionDone.add(moved.id);
      const migResult = logMigrationRitual(block, "release");
      state.blocks = state.blocks.map((b) => b.id === id ? { ...b, deleted: true, updatedAt: nowDateTime() } : b);
      const logResult = logSwipeTriage("block", id, action, block.carryCount, via);
      // v156: 生成物(moveBlockToWishが作ったWish)を丸ごと取り消し、元Blockのdeleted:trueを解除する。
      // ログは参照一致するエントリだけを取り消す(必須1)。
      _triageUndo = {
        guardId: id,
        revert: () => {
          if (moved) {
            state.tasks = state.tasks.filter((t) => t.id !== moved.id);
            _triageSessionDone.delete(moved.id);
          }
          state.blocks = state.blocks.map((b) => b.id === id ? { ...blockSnapshot, updatedAt: nowDateTime() } : b);
          state.migrationRitualLog = triageUndoLogArray(state.migrationRitualLog, migResult.entry, migResult.evicted);
          state.swipeTriageLog = triageUndoLogArray(state.swipeTriageLog, logResult.entry, logResult.evicted);
          _triageSessionDone.delete(id);
          if (_pendingInlineReason && _pendingInlineReason.blockId === id) _pendingInlineReason = null;
        }
      };
      _pendingInlineReason = { blockId: id };
      saveAndRender(moved ? "Wishへ移動しました" : "Blockを削除しました(Wishプロジェクトなし)", triageUndoToastOpts(id));
      return true;
    }
    return false;
  }

  if (kind === "wish") {
    const wish = state.tasks.find((t) => t.id === id && !t.deleted);
    if (!wish) return false;
    if (action === "today") {
      // ⑥未解決論点1の仮案(設計書に明記): 本体をカードにし、未完了サブタスクがあれば
      // 先頭(nextStepOf)をBlock化。サブタスクが無ければ本体自身をBlock化する。
      const next = nextStepOf(id);
      const targetId = next ? next.id : id;
      // v156: Undo用スナップショット。対象(サブタスク or 本体自身)のstatus/updatedAtと、
      // サブタスク経由の場合のみ更新される本体のupdatedAtも別途保持する(両者は別レコード)。
      const targetSnapshot = (() => {
        const t = state.tasks.find((x) => x.id === targetId);
        return t ? { ...t } : null;
      })();
      const bodySnapshot = next ? { ...wish } : null;
      const blockIdsBefore = new Set(state.blocks.map((b) => b.id));
      _triageLastActionAt = now;
      _triageLastActionId = id;
      _triageSessionDone.add(id);
      if (next) {
        // 対象がサブタスクの場合、wishSubtaskToTasksが更新するのはサブタスク側のupdatedAtのみ
        // (本体は変わらない)。本体(カード)のupdatedAtも合わせて進めておく(再出現防止の本体は
        // _triageSessionDone+wishHasTodayBlockだが、こちらもデータの一貫性として揃える)。
        state.tasks = state.tasks.map((t) => t.id === id ? { ...t, updatedAt: nowDateTime() } : t);
      }
      const logResult = logSwipeTriage("wish", id, action, 0, via);
      wishSubtaskToTasks(next ? next.id : id);
      const newBlock = state.blocks.find((b) => !blockIdsBefore.has(b.id));
      // 新規Blockが作られなかった場合(既に今日Block済み等のガードに当たった)は、
      // wishSubtaskToTasks自身が別の(Undo対象ではない)トーストを既に出しているため、
      // Undoは登録せず何も上書きしない。
      if (newBlock) {
        _triageUndo = {
          guardId: id,
          revert: () => {
            state.blocks = state.blocks.filter((b) => b.id !== newBlock.id);  // 作成したBlockを取り消し
            if (targetSnapshot) {
              state.tasks = state.tasks.map((t) => t.id === targetId ? { ...targetSnapshot, updatedAt: nowDateTime() } : t);  // 元(Wish)へ復元
            }
            if (bodySnapshot) {
              state.tasks = state.tasks.map((t) => t.id === id ? { ...bodySnapshot, updatedAt: nowDateTime() } : t);
            }
            state.swipeTriageLog = triageUndoLogArray(state.swipeTriageLog, logResult.entry, logResult.evicted);
            _triageSessionDone.delete(id);
          }
        };
        // v156 2系統レビュー対応(推奨4): wishSubtaskToTasks内のsaveAndRenderが既に容量超過
        // 警告を出している場合は上書きしない(block/todayと同じ理由)。
        if (!_lastSaveError) showToast("今日のタスクシュートに登録しました", triageUndoToastOpts(id));
      }
      return true;
    }
    if (action === "drop") {
      // 裁定(2026-07-28、2系統レビュー): 既存deleteWish()のセマンティクスに統一し、
      // 子孫サブタスクもカスケードでsoft-delete(deleted:true+updatedAt bump)する
      // (設計書§③表は「本体のみ」だが、本体だけ消して子孫が孤児のまま残る方が不整合なため
      // 統一を優先。理由はCHANGES_v152.md参照)。
      const allIds = new Set([id]);
      const collect = (parentId) => {
        state.tasks.forEach((t) => {
          if (!t.deleted && t.parentTaskId === parentId) {
            allIds.add(t.id);
            collect(t.id);
          }
        });
      };
      collect(id);
      // v156: Undo用に本体+全子孫のスナップショットをカスケード範囲と同じ集合で取る
      // (子孫だけ復元漏れ・取り違えが起きないよう、削除に使うallIdsをそのまま流用する)。
      const snapshots = [...allIds]
        .map((tid) => state.tasks.find((t) => t.id === tid))
        .filter(Boolean)
        .map((t) => ({ ...t }));
      _triageLastActionAt = now;
      _triageLastActionId = id;
      _triageSessionDone.add(id);
      state.tasks = state.tasks.map((t) => allIds.has(t.id) ? { ...t, deleted: true, updatedAt: nowDateTime() } : t);
      const logResult = logSwipeTriage("wish", id, action, 0, via);
      _triageUndo = {
        guardId: id,
        revert: () => {
          state.tasks = state.tasks.map((t) => {
            const snap = snapshots.find((s) => s.id === t.id);
            return snap ? { ...snap, updatedAt: nowDateTime() } : t;
          });
          state.swipeTriageLog = triageUndoLogArray(state.swipeTriageLog, logResult.entry, logResult.evicted);
          _triageSessionDone.delete(id);
        }
      };
      saveAndRender("手放しました", triageUndoToastOpts(id));
      return true;
    }
    if (action === "defer") {
      // targetMonthがあれば+1(12月→翌年1月)。targetYearが設定済みならそれも+1、未設定なら
      // 翌年(todayISO()年+1)を設定する(v152レビュー対応: 月間ボードはtargetMonthだけで
      // 並ぶため、年を進めないと1月枠=先頭へ見かけ上戻ってしまう=逆行して見えるため)。
      // targetMonth未設定は据え置き=updatedAtのみbumpしてキュー末尾へ(design §③表)。
      // v154: 延期はボタン専用(スワイプの方向割当から廃止。CHANGES_v154.md参照)。
      const wishSnapshot = { ...wish };  // v156: Undo用(targetMonth/targetYearとも変更前を保持)
      _triageLastActionAt = now;
      _triageLastActionId = id;
      _triageSessionDone.add(id);
      if (wish.targetMonth) {
        let month = wish.targetMonth + 1;
        let year = wish.targetYear;
        if (month > 12) {
          month = 1;
          year = year ? year + 1 : Number(todayISO().slice(0, 4)) + 1;
        }
        state.tasks = state.tasks.map((t) => t.id === id ? { ...t, targetMonth: month, targetYear: year, updatedAt: nowDateTime() } : t);
      } else {
        state.tasks = state.tasks.map((t) => t.id === id ? { ...t, updatedAt: nowDateTime() } : t);
      }
      const logResult = logSwipeTriage("wish", id, action, 0, via);
      _triageUndo = {
        guardId: id,
        revert: () => {
          state.tasks = state.tasks.map((t) => t.id === id ? { ...wishSnapshot, updatedAt: nowDateTime() } : t);
          state.swipeTriageLog = triageUndoLogArray(state.swipeTriageLog, logResult.entry, logResult.evicted);
          _triageSessionDone.delete(id);
        }
      };
      saveAndRender("延期しました", triageUndoToastOpts(id));
      return true;
    }
    return false;
  }
  return false;
}

// v162: 「手放す/延期」直後、_pendingInlineReasonが指す(まだUndoされていない)Blockについて、
// カードの下に控えめな理由チップ欄を出す(モーダルではない=Undoトーストと同時に見える設計。
// 上記TRIAGE_ACTION_COOLDOWN_MS付近のコメント参照)。対象Blockが無い/既に理由記録済みなら
// 何も出さない(壊れたctxを黙って無視するフェイルソフト)。
function triageInlineReasonHTML() {
  if (!_pendingInlineReason) return "";
  const block = blockById(_pendingInlineReason.blockId);
  if (!block || hasIncompleteReason(block)) return "";
  return `
    <section class="panel triage-inline-reason" style="margin-top:10px; padding:14px">
      <div class="muted" style="font-size:11px; margin-bottom:6px">よければ、未完了の理由をメモ(任意)</div>
      <div style="font-size:13px; margin-bottom:8px">「${escapeHTML(block.title)}」</div>
      <input class="input" style="font-size:16px; margin-bottom:8px; width:100%; box-sizing:border-box" data-triage-reason-note placeholder="状況など">
      <div class="row" style="gap:6px; flex-wrap:wrap">
        ${INCOMPLETE_REASON_CHIPS.map((c) => `<button class="btn ghost" data-action="triage-reason-chip" data-chip="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join("")}
        <button class="btn ghost" data-action="triage-reason-skip">スキップ</button>
      </div>
    </section>
  `;
}

// メインレンダリング(1枚ずつ表示+三択ボタン+残枚数。0件時は「仕分け完了」)
function renderWishTriage(wishes) {
  const queue = triageQueue(wishes);
  _triageCurrentCardId = queue.length ? queue[0].id : "";  // 二重タップガード用(毎描画で更新)
  if (!queue.length) {
    return `
      <section class="panel triage-panel" style="margin-top:14px; text-align:center; padding:40px 20px">
        <div style="font-size:16px">仕分け完了 🎉</div>
        <div class="muted" style="margin-top:6px; font-size:12px">先送り・Wishの未仕分けはありません</div>
      </section>
      ${triageInlineReasonHTML()}
    `;
  }
  const current = queue[0];
  return `
    <section class="panel triage-panel" style="margin-top:14px">
      <div class="muted" style="text-align:right; font-size:11px">あと ${queue.length} 枚</div>
      <div class="triage-card" data-triage-id="${current.id}" data-triage-kind="${current.kind}">
        <div class="triage-swipe-hint" aria-hidden="true"></div>
        ${triageBadgeHTML(current)}
        <div class="triage-card-title">${escapeHTML(current.item.title)}</div>
        <div class="triage-card-sub muted">${escapeHTML(triageSubtitleText(current))}</div>
      </div>
      <div class="triage-actions">
        <button class="btn primary triage-btn" data-action="triage-choice" data-kind="${current.kind}" data-id="${current.id}" data-choice="today">✅ 今日やる</button>
        <button class="btn ghost triage-btn" data-action="triage-choice" data-kind="${current.kind}" data-id="${current.id}" data-choice="drop">🕊 手放す</button>
        <button class="btn ghost triage-btn" data-action="triage-choice" data-kind="${current.kind}" data-id="${current.id}" data-choice="defer">🌙 延期(来月)</button>
      </div>
    </section>
    ${triageInlineReasonHTML()}
  `;
}

// v154: 仕分けモードのスワイプジェスチャ(designs/03-task-swipe.md S2)。=====================
// Pointer Events統一(pointerdown/move/up/cancel。touchstart等は使わない)。既存の
// _draftDrag(4880行〜)/ _wishDrag(4915行〜)と同じ「documentレベル委譲+移動量が閾値を
// 超えるまでドラッグ扱いにしない」流儀を踏襲する。確定ロジックはtriageActionへ完全委譲し
// (ロジックの二重化はしない)、三択ボタンは変更せず併存させる(設計書§③「必ずボタンでも
// 実行可能」)。
//
// v154 2系統レビュー対応(FAIL修正、監督者裁定2026-07-28):
//  - **スワイプは左右のみ**(右=今日やる/左=手放す)。上スワイプ=延期は廃止し延期はボタン専用に
//    した(仕分けビューは実測で縦スクロールが発生しており、touch-action:noneのカード上では
//    上フリック=通常のスクロール操作が取り消せない延期として誤確定する事故があったため)。
//    touch-actionも`none`→`pan-y`へ変更し、縦方向はブラウザのネイティブスクロールに譲る。
//  - **多指の誤確定防止**: pointerdownはevent.isPrimaryのみ受け付け、_triageSwipe.pointerIdを
//    保持してmove/up/cancelはpointerId一致のイベントだけを処理する(2本目の指のupで
//    誤って確定しない)。
//  - **setPointerCaptureをtry/catchで保護**(NotFoundError観測あり。ポインタが既に
//    リリース済み等の状況でも例外で処理全体を止めない)。

// ドラッグ中の一時情報(非永続)。{ id, kind, el, pointerId, startX, startY, moved }
let _triageSwipe = null;
const TRIAGE_SWIPE_MOVE_THRESHOLD = 8;   // px。これ未満はタップ扱い(_wishDrag踏襲。transform未適用)
const TRIAGE_SWIPE_CONFIRM_PX = 70;      // px。設計書「横60〜80px」の中間値
const TRIAGE_SWIPE_EXIT_MS = 180;        // 退場アニメの時間。styles.cssの.triage-cardのtransitionと一致させる

// 設計書§③の方向割当(v154改訂): 右=今日やる/左=手放す。縦方向(上下どちらも)は候補なし
// (=ネイティブの縦スクロールに譲る。touch-action:pan-yと対になる判定)。
function triageSwipeCandidate(dx, dy) {
  const absX = Math.abs(dx), absY = Math.abs(dy);
  if (absX < 4 || absX < absY) return null;  // ほぼ静止 or 縦優位はスクロール意図とみなし候補なし
  return dx > 0 ? "today" : "drop";
}

const TRIAGE_SWIPE_HINT_LABEL = { today: "✅ 今日やる", drop: "🕊 手放す" };

// スワイプ中の視覚フィードバック(方向ヒント表示)。進捗はTRIAGE_SWIPE_CONFIRM_PXに対する割合
function updateTriageSwipeHint(el, dx, dy) {
  const hint = el.querySelector(".triage-swipe-hint");
  if (!hint) return;
  const action = triageSwipeCandidate(dx, dy);
  hint.textContent = action ? TRIAGE_SWIPE_HINT_LABEL[action] : "";
  hint.className = "triage-swipe-hint" + (action ? ` hint-${action}` : "");
  hint.style.opacity = action ? String(Math.min(1, Math.abs(dx) / TRIAGE_SWIPE_CONFIRM_PX)) : "0";
}

// 確定時の退場方向(カードが画面外へ抜ける向き。左右のみ)
function triageExitTransform(action, dx, dy) {
  const vw = window.innerWidth || 800;
  return action === "today"
    ? `translate(${vw}px, ${dy}px) rotate(20deg)`
    : `translate(${-vw}px, ${dy}px) rotate(-20deg)`;
}

function triagePrefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

// カードの見た目を未操作状態へ完全に戻す(スナップバック/pointercancel/triageAction失敗時の
// 原状復帰で共通利用)。stateには一切触れない。
function resetTriageCardVisual(el) {
  el.style.transform = "translate(0,0) rotate(0deg)";
  el.style.opacity = "";
  el.style.pointerEvents = "";
  const hint = el.querySelector(".triage-swipe-hint");
  if (hint) hint.style.opacity = "0";
}

document.addEventListener("pointerdown", (event) => {
  const card = event.target.closest(".triage-card");
  if (!card) return;
  if (!event.isPrimary) return;  // 2本目以降の指は無視(多指操作の誤確定防止)
  if (_triageSwipe) return;  // 既にドラッグ中なら新規に開始しない(念のための二重防御)
  if (event.target.closest("[data-action]")) return;  // カード内に将来ボタンが増えても通常タップに譲る
  try { card.setPointerCapture(event.pointerId); } catch (e) { /* NotFoundError等は無害化して継続 */ }
  _triageSwipe = { id: card.dataset.triageId, kind: card.dataset.triageKind, el: card, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
});
document.addEventListener("pointermove", (event) => {
  if (!_triageSwipe || event.pointerId !== _triageSwipe.pointerId) return;
  const dx = event.clientX - _triageSwipe.startX;
  const dy = event.clientY - _triageSwipe.startY;
  if (!_triageSwipe.moved && Math.hypot(dx, dy) < TRIAGE_SWIPE_MOVE_THRESHOLD) return;
  _triageSwipe.moved = true;
  _triageSwipe.el.classList.add("is-dragging");  // transitionを止め、指に1:1追従させる
  _triageSwipe.el.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx * 0.05}deg)`;
  updateTriageSwipeHint(_triageSwipe.el, dx, dy);
  event.preventDefault();  // 横方向ジェスチャ中のみ働く(touch-action:pan-yにより縦はブラウザに譲る)
});
// 確定は指を離した時のみ(スワイプ中に発火しない)。閾値未満・縦方向優位はスナップバックして何もしない
const endTriageSwipe = (event) => {
  if (!_triageSwipe || (event && event.pointerId !== _triageSwipe.pointerId)) return;
  const { id, kind, el, moved, startX, startY } = _triageSwipe;
  const dx = event ? event.clientX - startX : 0;
  const dy = event ? event.clientY - startY : 0;
  _triageSwipe = null;
  if (!moved) return;  // 誤爆防止: 閾値未満の指の震え等はドラッグ扱いにすらしていない
  el.classList.remove("is-dragging");
  const candidate = triageSwipeCandidate(dx, dy);
  if (!candidate || Math.abs(dx) < TRIAGE_SWIPE_CONFIRM_PX) {
    resetTriageCardVisual(el);  // 元位置へスナップバック(誤爆防止。縦スクロール意図もここに含む)
    return;
  }
  if (triagePrefersReducedMotion()) {
    // reduced-motion時はアニメ無効・即時確定(設計書§③)
    const ok = triageAction(kind, id, candidate, "swipe");
    if (!ok) resetTriageCardVisual(el);  // クールダウン等でブロックされた場合は原状復帰
    return;
  }
  el.style.pointerEvents = "none";  // 退場アニメ中の再操作を防ぐ
  el.style.transform = triageExitTransform(candidate, dx, dy);
  el.style.opacity = "0";
  setTimeout(() => {
    const ok = triageAction(kind, id, candidate, "swipe");
    if (!ok) resetTriageCardVisual(el);  // 退場アニメ後にブロックされていたら見た目だけ戻す
  }, TRIAGE_SWIPE_EXIT_MS);
};
document.addEventListener("pointerup", endTriageSwipe);
// pointercancel時は必ずリセット(通話着信・システムジェスチャ等での中断。状態変更は一切しない)
document.addEventListener("pointercancel", (event) => {
  if (!_triageSwipe || (event && event.pointerId !== _triageSwipe.pointerId)) return;
  resetTriageCardVisual(_triageSwipe.el);
  _triageSwipe = null;
});

// 汎用: Task のフィールド更新(saveState のみ、再描画なし)
function updateTaskField(id, field, value) {
  state.tasks = state.tasks.map((t) => t.id === id
    ? { ...t, [field]: value, updatedAt: nowDateTime() }
    : t);
  saveState();
}

// v95: 進捗(分子/分母)からステータスを導出する。
//   分子<=0 → todo(未着手) / 0<分子<分母 → doing(着手中) / 分子>=分母 → completed。
//   suspended/cancelled は進捗編集では触らない(意図的な中断を上書きしない)。
//   分母<=0 は判定不能として現在のステータスを維持する。
function deriveStatusFromProgress(currentStatus, num, den) {
  if (currentStatus === "suspended" || currentStatus === "cancelled") return currentStatus;
  if (!(den > 0)) return currentStatus;
  if (num <= 0) return "todo";
  if (num >= den) return "completed";
  return "doing";
}
// v95: Task完了時、分子を分母に合わせる(分母<=0なら分子はそのまま)
function fillProgressOnComplete(task) {
  const den = Number(task.progressDen) || 0;
  return den > 0 ? den : (Number(task.progressNum) || 0);
}
// v95: WBS進捗の分子/分母インライン編集。値のクランプ + ステータス連動をまとめて行う
function updateTaskProgress(id, field, rawValue) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const n = Number(rawValue);
  const parsed = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  let num = field === "progressNum" ? parsed : (Number(task.progressNum) || 0);
  let den = field === "progressDen" ? parsed : (Number(task.progressDen) || 0);
  if (den > 0 && num > den) num = den;  // 分子>分母は分母に丸める
  const status = deriveStatusFromProgress(task.status, num, den);
  state.tasks = state.tasks.map((t) => t.id === id
    ? { ...t, progressNum: num, progressDen: den, status, updatedAt: nowDateTime() }
    : t);
  saveState();
}

// v99: WBS行の「翌朝AI設定を依頼」トグル。ONにすると翌朝の日次バッチ(loop/task-criteria.sh)が
//      doneCriteria/firstStepの自動設定またはサブタスク自動生成を行い、処理後はバッチ側がfalseへ
//      書き戻す(アプリ側で自動解除する必要はない。同期で受け取った結果を表示するだけ)。
function toggleCriteriaRequest(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  updateTaskField(id, "criteriaRequest", !task.criteriaRequest);
  render();
}

// =============================================================
// v17: Avoid List(やらないこと)タブ
// v165: renderAvoidはsrc/features/avoid.jsへ抽出済み(冒頭のimport参照)。
//   addAvoid/deleteAvoid/updateAvoidTextは操作系(state書き込み+保存ヘルパー依存)のため、
//   dispatcher整理の段階まで意図的にここへ残す(監督者裁定)。
// =============================================================

function addAvoid() {
  const input = document.querySelector("#avoidTitle");
  const text = input?.value.trim();
  if (!text) return showToast("やらないことを入力してください");
  const item = {
    id: crypto.randomUUID(),
    text,
    createdAt: nowDateTime()
  };
  state.settings.avoidList = [...(state.settings.avoidList || []), item];
  if (input) input.value = "";
  saveAndRender("やらないことを追加しました");
}

function deleteAvoid(id) {
  state.settings.avoidList = (state.settings.avoidList || []).filter((it) => it.id !== id);
  saveAndRender("削除しました");
}

function updateAvoidText(id, text) {
  state.settings.avoidList = (state.settings.avoidList || []).map((it) =>
    it.id === id ? { ...it, text, updatedAt: nowDateTime() } : it
  );
  saveState();
}

// =============================================================

// v63: WIP上限アラート(提案2)。「進行中の仕事は3つまで」の原則に対し、
//      アクティブ(status=active・kind=normal)なProjectが4件以上になったら気づかせる。
//      実行率で裁く色(赤系)ではなく、情報を渡すだけのアクセントトーンにする。
function renderWipBanner() {
  const activeNormal = state.projects.filter((p) =>
    !p.deleted && p.kind === "normal" && (p.status || "active") === "active");
  if (activeNormal.length < 4) return "";
  return `
    <div class="wip-banner">
      <div class="wip-banner-msg">進行中プロジェクトが${activeNormal.length}件。Kの原則は3件まで——1つ潜らせますか?</div>
      <div class="wip-banner-list">
        ${activeNormal.map((p) => `
          <div class="wip-banner-row">
            <span class="wip-banner-name">${escapeHTML(p.title)}</span>
            <button class="btn ghost" data-action="suspend-project" data-id="${p.id}">保留</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

// v109: WBS カテゴリ絞り込みプルダウンの選択肢。実在する Project の category から動的生成する
// (マスタ登録だけで未使用のカテゴリは含めない)。category未設定のProjectが1件でもあれば「未分類」を追加する。
function wbsCategoryOptions(projects) {
  const names = new Set();
  let hasUncategorized = false;
  projects.forEach((p) => {
    if (p.category) names.add(p.category);
    else hasUncategorized = true;
  });
  const sorted = [...names].sort((a, b) => a.localeCompare(b, "ja"));
  if (hasUncategorized) sorted.push("未分類");
  return sorted;
}

function renderWBS() {
  // v126: 「やりたいこと」もWBSのProject+Taskとして扱う(v16のWish除外を撤去。
  //       期日設定→WBS期日駆動フローでタスクシュート候補に載せられるようにする)。
  //       Wishタブ自体は専用ビュー(実現/未実現の絞り込み等)として存続する。
  const activeProjects = state.projects.filter((project) => !project.deleted);
  const sorted = [...activeProjects].sort((a, b) => a.title.localeCompare(b.title, "ja"));

  // v35: 中断中の項目は既定で非表示。トグルで再表示して再開できる。
  const showSusp = Boolean(state.settings.showSuspended);
  // v126: Wish配下タスクも一覧に表示されるようになったため、中断カウントも他Projectと同様に含める
  const suspCount = activeProjects.filter(isProjectSuspended).length
    + state.tasks.filter((t) => !t.deleted && t.kind !== "other" && isTaskSuspended(t)).length;
  const visibleProjects = sorted.filter((p) => showSusp || !isProjectSuspended(p));
  const toggleBtn = (suspCount > 0 || showSusp)
    ? `<button class="btn ${showSusp ? "primary" : "ghost"}" data-action="toggle-show-suspended">${showSusp ? "中断を隠す" : `中断を表示 (${suspCount})`}</button>`
    : "";
  // v47: 完了タスクの表示トグル + 全プロジェクトの一括開閉
  const hideDone = Boolean(state.settings.wbsHideCompleted);
  const allCollapsed = visibleProjects.length > 0 && visibleProjects.every((p) => p.collapsed);
  // v55: インライン編集モード
  const editMode = Boolean(state.settings.wbsEditMode);
  // v109: カテゴリ絞り込み(既定「すべて」)。未分類は category未設定のProjectを指す。
  const categoryFilter = state.settings.wbsCategoryFilter || "";
  const categoryNames = wbsCategoryOptions(activeProjects);
  const categorySelect = `
    <select class="select" data-action="wbs-category-filter" aria-label="カテゴリで絞り込み" style="width:auto; min-width:140px; font-size:16px">
      <option value="" ${!categoryFilter ? "selected" : ""}>すべて</option>
      ${categoryNames.map((n) => `<option value="${escapeHTML(n)}" ${categoryFilter === n ? "selected" : ""}>${escapeHTML(n)}</option>`).join("")}
    </select>`;
  const wbsTools = `
    <div class="row" style="gap:8px; flex-wrap:wrap; align-items:center">
      ${categorySelect}
      <button class="btn ${editMode ? "primary" : "ghost"}" data-action="toggle-wbs-edit">${editMode ? "✏️ 編集モード中" : "✏️ 編集モード"}</button>
      <button class="btn ${hideDone ? "primary" : "ghost"}" data-action="toggle-wbs-hide-done">${hideDone ? "完了を表示" : "完了を隠す"}</button>
      <button class="btn ghost" data-action="wbs-collapse-all">${allCollapsed ? "すべて展開" : "すべて折りたたむ"}</button>
      ${toggleBtn}
    </div>`;

  // v109: カテゴリ絞り込みの適用(未分類はcategory未設定のProjectを指す)
  const filteredProjects = categoryFilter
    ? visibleProjects.filter((p) => (p.category || "未分類") === categoryFilter)
    : visibleProjects;

  return `
    ${renderHeader("ビジョンを実行へ落とす", "WBS", wbsTools)}
    ${renderWipBanner()}
    <section class="form-strip">
      <input id="projectTitle" class="input" placeholder="Project名">
      <button class="btn primary" data-action="add-project">Project追加</button>
    </section>

    <section class="section form-strip">
      <input id="taskTitle" class="input" placeholder="Task名">
      <select id="taskProject" class="select">
        ${sorted.map((project) => `<option value="${project.id}">${escapeHTML(project.title)}</option>`).join("")}
        <option value="">単発Task</option>
      </select>
      <button class="btn primary" data-action="add-task">Task追加</button>
    </section>

    <section class="section grid">
      ${filteredProjects.length > 0 ? filteredProjects.map(renderProjectTree).join("")
        : `<div class="muted" style="padding:12px; text-align:center">このカテゴリのProjectはありません</div>`}
    </section>
  `;
}

// v48: WBS のタスク並び順 — 未完了(期限昇順・期限なしは後ろ)→ 完了は下に沈む
function wbsTaskCompare(a, b) {
  const ac = a.status === "completed", bc = b.status === "completed";
  if (ac !== bc) return ac ? 1 : -1;
  // v117(B): 自己締切の自動前倒し(effectiveDueDate)を並び順にも反映
  const ad = effectiveDueDate(a) || "9999", bd = effectiveDueDate(b) || "9999";
  if (ad !== bd) return ad < bd ? -1 : 1;
  return (a.createdAt || "").localeCompare(b.createdAt || "");
}

// v48: Task に費やした実績(完了 Block の回数と累計時間)
function taskBlockStats(taskId) {
  const done = state.blocks.filter((b) => !b.deleted && b.taskId === taskId && b.completed);
  let minutes = 0;
  done.forEach((b) => {
    const d = _actualDurationMin(b)
      ?? ((b.plannedStartAt && b.plannedEndAt) ? Math.max(0, minutesOf(b.plannedEndAt) - minutesOf(b.plannedStartAt)) : 0);
    minutes += d;
  });
  return { count: done.length, minutes };
}
function fmtMinShort(m) {
  if (!m) return "";
  const h = Math.floor(m / 60);
  return h ? `${h}h${m % 60 ? `${m % 60}m` : ""}` : `${m}m`;
}

// v95: WBS進捗(分子/分母)関連のユーティリティ
// 分母<=0は「まだ何もわからない」扱いで0%固定(0除算ガード)
function taskProgressPct(task) {
  const den = Number(task.progressDen) || 0;
  const num = Number(task.progressNum) || 0;
  if (den <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((num / den) * 100)));
}
// Project配下タスクのΣ分子/Σ分母(中断・中止は分母/分子ともに集計から除外し taskProgress() と揃える)
function projectProgressAgg(tasks) {
  const live = tasks.filter((t) => isTaskCountable(t));
  let num = 0, den = 0;
  live.forEach((t) => { num += Number(t.progressNum) || 0; den += Number(t.progressDen) || 0; });
  return { num, den, pct: den > 0 ? Math.max(0, Math.min(100, Math.round((num / den) * 100))) : 0 };
}
// Project行の進捗率集計バー(「進捗率を表示」ONの時のみ呼ばれる)
function renderProjectProgressAgg(liveTasks) {
  const { num, den, pct } = projectProgressAgg(liveTasks);
  return `
    <div class="wbs-progress-agg">
      <div class="progress"><span style="width:${pct}%"></span></div>
      <span class="muted" style="font-size:11px">進捗率 ${num} / ${den}(${pct}%)</span>
    </div>
  `;
}

function renderProjectTree(project) {
  const allTasksOfProject = state.tasks.filter((task) => !task.deleted && task.projectId === project.id);
  const progress = taskProgress(allTasksOfProject);
  const is12WY = Boolean(project.twelveWeekStartDate);
  const collapsed = Boolean(project.collapsed);  // v33: 折りたたみ
  // v35: 中断
  const showSusp = Boolean(state.settings.showSuspended);
  const suspended = isProjectSuspended(project);
  let visibleTasks = allTasksOfProject.filter((t) => showSusp || !isTaskSuspended(t));
  // v47: 完了を隠す(未完了の子孫を持つ完了タスクは、子を迷子にしないため残す)
  if (state.settings.wbsHideCompleted) {
    const hasOpenDescendant = (task) => allTasksOfProject.some((t) =>
      t.parentTaskId === task.id && (t.status !== "completed" || hasOpenDescendant(t)));
    visibleTasks = visibleTasks.filter((t) => t.status !== "completed" || hasOpenDescendant(t));
  }
  const rootTasks = visibleTasks.filter((t) => !t.parentTaskId).sort(wbsTaskCompare);  // v48: 未完了→期限順、完了は下へ
  // v48: プロジェクトの数値サマリ(進捗バーだけでは規模が見えない)
  const liveTasks = allTasksOfProject.filter(isTaskCountable);
  const doneCount = liveTasks.filter((t) => t.status === "completed").length;
  const projDue = project.dueDate ? ` ・ 期限 ${project.dueDate.slice(5).replace("-", "/")}` : "";
  return `
    <div class="item${suspended ? " is-suspended" : ""}">
      <div class="row">
        <div class="title-line">
          <button class="wbs-caret" data-action="toggle-project-collapse" data-id="${project.id}" aria-label="${collapsed ? "展開" : "折りたたむ"}">${collapsed ? "▸" : "▾"}</button>
          <span class="badge ${project.kind === "wish" ? "purple" : "blue"}">${project.kind === "wish" ? "Wish" : "Project"}</span>
          ${is12WY ? `<span class="badge green">12WY</span>` : ""}
          ${suspended ? `<span class="badge gray">中断</span>` : ""}
          <strong data-action="edit-project" data-id="${project.id}" style="cursor:pointer">${escapeHTML(project.title)}</strong>
          ${project.category ? `<span class="cat-chip" style="background:${getCategoryColor(project.category)}1f; color:${getCategoryColor(project.category)}; border:1px solid ${getCategoryColor(project.category)}66">${escapeHTML(project.category)}</span>` : ""}
        </div>
        <div class="row">
          <button class="btn" data-action="add-task-to-project" data-id="${project.id}">+ タスク</button>
          ${suspended
            ? `<button class="btn" data-action="resume-project" data-id="${project.id}">再開</button>`
            : `<button class="btn ghost" data-action="suspend-project" data-id="${project.id}">中断</button>`}
          <button class="btn" data-action="edit-project" data-id="${project.id}">編集</button>
        </div>
      </div>
      ${project.description ? `<div class="muted" style="font-size:12px">${escapeHTML(project.description)}</div>` : ""}
      <div class="progress"><span style="width:${progress}%"></span></div>
      <div class="muted wbs-proj-meta">${doneCount} / ${liveTasks.length} 完了${projDue}</div>
      ${project.showProgress ? renderProjectProgressAgg(liveTasks) : ""}
      ${collapsed
        ? `<div class="muted" style="font-size:12px; margin-top:6px">${rootTasks.length ? `${visibleTasks.length}件のタスク(折りたたみ中)` : "Task未登録"}</div>`
        : `<div class="stack">
            ${rootTasks.length
              ? rootTasks.map((t) => renderTaskTree(t, visibleTasks, 0)).join("")
              : `<div class="muted">Task未登録</div>`}
          </div>`}
    </div>
  `;
}

// v33: WBS の折りたたみトグル(状態は project/task に保存し永続化)
function toggleProjectCollapse(id) {
  state.projects = state.projects.map((p) =>
    p.id === id ? { ...p, collapsed: !p.collapsed } : p);
  saveAndRender();
}
function toggleTaskCollapse(id) {
  state.tasks = state.tasks.map((t) =>
    t.id === id ? { ...t, collapsed: !t.collapsed } : t);
  saveAndRender();
}

function renderTaskTree(task, allTasksOfProject, depth) {
  const children = allTasksOfProject.filter((t) => t.parentTaskId === task.id).sort(wbsTaskCompare);  // v48
  const indent = depth * 18;
  const collapsed = Boolean(task.collapsed);  // v33: 折りたたみ
  return `
    <div style="margin-left:${indent}px">
      ${renderTaskRow(task, depth, children.length > 0, collapsed)}
      ${children.length && !collapsed
        ? children.map((c) => renderTaskTree(c, allTasksOfProject, depth + 1)).join("")
        : ""}
    </div>
  `;
}

function renderTaskRow(task, depth = 0, hasChildren = false, collapsed = false) {
  const canAddSub = depth < 2;  // 最大 3 階層(0,1,2)、depth=2 の子はもう作らない
  // v33: 子を持つタスクには折りたたみキャレット、無ければ位置合わせのスペーサー
  const caret = hasChildren
    ? `<button class="wbs-caret" data-action="toggle-task-collapse" data-id="${task.id}" aria-label="${collapsed ? "展開" : "折りたたむ"}">${collapsed ? "▸" : "▾"}</button>`
    : `<span class="wbs-caret-spacer"></span>`;
  const suspended = isTaskSuspended(task);  // v35
  // v47: 期限切れは赤く、今日 Block 化済みならチップで示す(押した結果が見える)
  // v117(B): 自己締切の自動前倒し(effectiveDueDate)を期限切れ判定・表示に反映。
  //          前倒しが効いている時は「期限 M/D(実 M/D)」で自己締切・実期日を併記する。
  const effDue = effectiveDueDate(task);
  const overdue = task.dueDate && effDue < todayISO() && task.status !== "completed";
  const dueLabel = effDue && effDue !== task.dueDate
    ? `${effDue.slice(5).replace("-", "/")}(実 ${task.dueDate.slice(5).replace("-", "/")})`
    : (task.dueDate ? task.dueDate.slice(5).replace("-", "/") : "");
  const dueHTML = task.dueDate
    ? `<span class="${overdue ? "wbs-overdue" : "muted"}" style="font-size:11px">期限 ${dueLabel}${overdue ? "!" : ""}</span>`
    : "";
  const scheduledToday = state.blocks.some((b) => !b.deleted && b.taskId === task.id && b.date === todayISO());
  // v48: 子タスクの進捗(2/5)と、この Task に費やした実績(回数・累計時間)
  const kids = state.tasks.filter((t) => !t.deleted && t.parentTaskId === task.id && isTaskCountable(t));
  const kidsDone = kids.filter((t) => t.status === "completed").length;
  const stats = taskBlockStats(task.id);
  // v55: インライン編集モード — 期限/状態/カテゴリを行内で直接編集(モーダルを開かない)
  const editMode = Boolean(state.settings.wbsEditMode);
  const inlineEdit = editMode ? `
    <span class="wbs-inline">
      <select class="wbs-inline-input" data-wbs-edit="status" data-id="${task.id}" aria-label="状態">
        ${["todo", "doing", "completed", "suspended", "cancelled"].map((s) =>
          `<option value="${s}" ${task.status === s ? "selected" : ""}>${taskStatusLabel(s)}</option>`).join("")}
      </select>
      <input class="wbs-inline-input" type="date" data-wbs-edit="dueDate" data-id="${task.id}" value="${task.dueDate || ""}" aria-label="期限">
      <select class="wbs-inline-input" data-wbs-edit="category" data-id="${task.id}" aria-label="カテゴリ">
        <option value="">(カテゴリなし)</option>
        ${getCategoryNames().map((n) => `<option value="${escapeHTML(n)}" ${task.category === n ? "selected" : ""}>${escapeHTML(n)}</option>`).join("")}
      </select>
    </span>` : "";
  // v95: WBS進捗(分子/分母)— 編集モードに関わらず常時表示・その場で編集可能
  const progressNum = Number.isFinite(task.progressNum) ? task.progressNum : 0;
  const progressDen = Number.isFinite(task.progressDen) ? task.progressDen : 10;
  const progressPct = taskProgressPct(task);
  const progressHTML = `
    <div class="wbs-progress-row">
      <input class="wbs-inline-input wbs-progress-input" type="number" inputmode="numeric" min="0" step="1"
        data-wbs-progress="num" data-id="${task.id}" value="${progressNum}" aria-label="進捗 分子">
      <span class="muted" style="font-size:12px">/</span>
      <input class="wbs-inline-input wbs-progress-input" type="number" inputmode="numeric" min="0" step="1"
        data-wbs-progress="den" data-id="${task.id}" value="${progressDen}" aria-label="進捗 分母">
      <div class="progress wbs-progress-bar"><span style="width:${progressPct}%"></span></div>
      <span class="muted" style="font-size:11px">${progressPct}%</span>
    </div>`;
  return `
    <div class="row${suspended ? " is-suspended" : ""}" style="border-top:1px solid var(--line-soft); padding-top:8px">
      <div class="title-line">
        ${depth > 0 ? `<span class="muted" style="font-size:11px">${"└".padStart(depth, "　")}</span>` : ""}
        ${caret}
        <button class="checkbox-button ${task.status === "completed" ? "done" : ""}" data-action="toggle-task" data-id="${task.id}">✓</button>
        <button class="wbs-criteria-btn${task.criteriaRequest ? " on" : ""}" data-action="toggle-criteria-request" data-id="${task.id}"
          aria-pressed="${task.criteriaRequest ? "true" : "false"}"
          aria-label="${task.criteriaRequest ? "AI設定依頼中(タップで取消)" : "翌朝のAI設定を依頼"}"
          title="チェックすると翌朝の日次バッチが完了条件/スモールステップを自動設定(またはサブタスク生成)します。処理後は自動でOFFに戻ります">🤖</button>
        <span data-action="edit-task" data-id="${task.id}" style="cursor:pointer">${escapeHTML(task.title)}</span>
        ${editMode ? inlineEdit : `
        <span class="badge ${suspended ? "gray" : ""}">${taskStatusLabel(task.status)}</span>
        ${kids.length ? `<span class="badge">子 ${kidsDone}/${kids.length}</span>` : ""}
        ${scheduledToday ? `<span class="badge green">今日✓</span>` : ""}
        ${task.category ? `<span class="cat-chip" style="background:${getCategoryColor(task.category)}1f; color:${getCategoryColor(task.category)}; border:1px solid ${getCategoryColor(task.category)}66">${escapeHTML(task.category)}</span>` : ""}
        ${leverageTypeMarkHTML(task.leverageType)}
        ${task.aiWork ? `<span class="ai-work-flag" title="AIに作業依頼中${task.aiWorkBrief ? ": " + escapeHTML(task.aiWorkBrief) : ""}">🤝</span>` : ""}
        ${task.criteriaRequest ? `<span class="badge blue wbs-criteria-badge">🤖 AI設定待ち</span>` : ""}
        ${dueHTML}
        ${stats.count ? `<span class="muted" style="font-size:11px">⏱ ${stats.count}回${stats.minutes ? `・${fmtMinShort(stats.minutes)}` : ""}</span>` : ""}`}
      </div>
      ${progressHTML}
      <div class="row wbs-actions">
        <button class="btn" data-action="task-today" data-id="${task.id}">${scheduledToday ? "＋もう一度" : "今日へ"}</button>
        ${canAddSub ? `<button class="btn ghost" data-action="add-subtask" data-parent-task="${task.id}">+ サブ</button>` : ""}
        ${suspended
          ? `<button class="btn" data-action="resume-task" data-id="${task.id}">再開</button>`
          : `<button class="btn ghost" data-action="suspend-task" data-id="${task.id}">中断</button>`}
        <button class="btn ghost" data-action="edit-task" data-id="${task.id}">編集</button>
      </div>
    </div>
  `;
}

function renderTasks() {
  return `
    ${renderHeader("今日の実行リスト", "タスクシュート", projectedEndBadge())}
    ${renderDateBar()}
    <div class="row" style="margin-bottom:10px">
      <button class="btn ghost" data-action="nav" data-view="routine">↻ 今日使うルーティンを見る →</button>
    </div>
    ${aiMitChips()}
    ${aiTaskChips()}
    ${carryOverPanel()}
    <div class="row" style="margin-bottom:10px; flex-wrap:wrap; gap:8px">
      <button class="btn" data-action="ai-schedule">📋 下書きスケジュール</button>
      ${state.selectedDate === todayISO() ? `<button class="btn" data-action="ai-morning-plan">🌅 朝プラン</button>` : ""}
      <span class="muted" style="font-size:11.5px">下書き=空きに仮配置→ドラッグ調整→確定 / 朝プラン=繰越+WBS+MITをまとめて1日ぶん下書き</span>
    </div>
    <section class="form-strip">
      <input id="blockTitle" class="input" placeholder="Block名">
      <select id="blockCategory" class="select">
        ${getCategoryNames().map((n) => `<option value="${escapeHTML(n)}">${escapeHTML(n)}</option>`).join("")}
        <option value="">(カテゴリなし)</option>
      </select>
      <button class="btn primary" data-action="add-block">Block追加</button>
    </section>

    <section class="section grid">
      ${blocksForDate(state.selectedDate).filter((b) => {
        // v15: タイムライン由来は除外
        if (b.source === "timeline") return false;
        // v19: カテゴリ「ルーティン」は専用ルーティンタブで表示
        if (b.category === "ルーティン") return false;
        // v19: 繰り返し系列(recurrenceGroupId 持ち)もルーティンタブへ
        if (b.recurrenceGroupId) return false;
        // taskId 無しの単発 Block は除外
        if (!b.taskId) return false;
        // v48: 中断/中止/削除タスクの未完了 Block は表示しない(実績は残す)
        if (isStaleBlock(b)) return false;
        // 紐づく Task に Project がなければ単発 → 除外
        const task = state.tasks.find((t) => t.id === b.taskId);
        if (!task || !task.projectId) return false;
        return true;
      }).map(renderBlockItem).join("") || emptyPanel("この日のBlockはまだありません(Projectに紐づくTaskがここに表示されます。ルーティンは「ルーティン」タブへ)")}
    </section>

    <section class="section">
      <h2>未完了タスク</h2>
      ${renderOpenTasks()}
    </section>
  `;
}

function renderOpenTasks() {
  // v19: 今日に既に Block 化されていても表示し続ける(1日に複数回追加することもあるため)
  // v28: 「その他」受け皿 Task は実体のあるタスクではないので未完了リストから除外
  // v35: 中断・中止したタスクは未完了リストから外す(途中でやめたものを残さない)
  // v126: v37で入れたWish Project除外を撤去。「期日付きWishはタスクと同じ」の原則により、
  //       このリストは元々dueDate必須(下のBoolean(task.dueDate))なので、期日を持つWishだけが
  //       通常タスクと同列に表示される(期日なしWishは従来どおり出てこない)。
  // v107: K指示により期日未設定Taskは一覧から除外する(v97時点は「期日未設定は常に表示」
  //       だったが、期日昇順ソートの導入とあわせて廃止。データは消さない=期日を設定すれば表示される)。
  const open = state.tasks.filter((task) => !task.deleted && !isTaskDead(task) && task.kind !== "other"
    && Boolean(task.dueDate));
  if (!open.length) return emptyPanel("未完了のTaskはありません");
  // v107: 期日昇順(期日超過が最上位)。同一期日はタイトルのja比較で安定ソート(renderWBSの
  //       Project一覧ソートと同じ流儀)
  open.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, "ja"));
  // 今日 Block 化済みのカウント(参考表示用)
  const blockCountByTaskId = {};
  state.blocks
    .filter((b) => !b.deleted && b.date === state.selectedDate)
    .forEach((b) => {
      if (b.taskId) blockCountByTaskId[b.taskId] = (blockCountByTaskId[b.taskId] || 0) + 1;
    });
  // v97: 既定表示は「当日(=選択中の日付)〜7日後 + 期日超過」まで。
  //      それより先(8日後以降)は畳み、トグルで表示する(データは消さない)。
  //      アンカーは既存の isOverdue と同じ state.selectedDate に揃える(選択日を進めれば
  //      窓もスライドする一貫した挙動にする)。
  const futureLimit = addDays(state.selectedDate, 7);
  const isFarFuture = (task) => Boolean(task.dueDate) && task.dueDate > futureLimit;
  const visible = open.filter((task) => !isFarFuture(task));
  const folded = open.filter(isFarFuture);
  const showFuture = Boolean(state.settings.tasksShowFuture);

  const renderItem = (task) => {
    const dueLabel = task.dueDate ? ` / 期限 ${task.dueDate}` : "";
    const isOverdue = task.dueDate && task.dueDate < state.selectedDate;
    const todayCount = blockCountByTaskId[task.id] || 0;
    // v96: 完了条件・スモールステップは空欄なら何も出さない(行を開かずに見える行内サブテキスト)
    const doneCriteriaHTML = task.doneCriteria
      ? `<div class="muted task-done-criteria" style="font-size:11.5px; margin-top:2px">🎯 ${escapeHTML(task.doneCriteria)}</div>` : "";
    const firstStepHTML = task.firstStep
      ? `<div class="muted task-first-step" style="font-size:11.5px; margin-top:2px">👣 ${escapeHTML(task.firstStep)}</div>` : "";
    return `
      <div class="item" ${isOverdue ? 'style="background:var(--red-soft)"' : ""}>
        <div class="row">
          <div style="min-width:0; flex:1">
            <strong>${escapeHTML(task.title)}</strong>
            <div class="muted" style="font-size:12px">${escapeHTML(projectName(task.projectId))} / ${escapeHTML(task.category || "カテゴリなし")}${dueLabel}${todayCount > 0 ? ` <span style="color:var(--green-text); font-weight:600">/ 本日 ${todayCount} 件 Block 追加済み</span>` : ""}</div>
            ${doneCriteriaHTML}
            ${firstStepHTML}
          </div>
          <div class="row">
            <button class="btn" data-action="task-today" data-id="${task.id}">今日へ追加</button>
            <button class="btn ghost" data-action="suspend-task" data-id="${task.id}">中断</button>
            <button class="btn" data-action="edit-task" data-id="${task.id}">編集</button>
          </div>
        </div>
      </div>
    `;
  };

  const toggleHTML = folded.length
    ? `<div class="row" style="margin-bottom:8px">
        <button class="btn ${showFuture ? "primary" : "ghost"}" data-action="toggle-tasks-show-future">${showFuture ? "8日後以降を隠す" : `8日後以降を表示 (${folded.length}件)`}</button>
      </div>`
    : "";
  const emptyVisibleHTML = (!visible.length && !(showFuture && folded.length))
    ? emptyPanel("表示範囲(当日〜7日後・期日超過)に未完了のTaskはありません")
    : "";

  return `
    ${toggleHTML}
    <div class="grid">
      ${visible.map(renderItem).join("")}
      ${showFuture ? folded.map(renderItem).join("") : ""}
      ${emptyVisibleHTML}
    </div>
  `;
}

function renderBlockItem(block) {
  const start = block.plannedStartAt ? timeFromDateTime(block.plannedStartAt) : "未定";
  const end = block.plannedEndAt ? timeFromDateTime(block.plannedEndAt) : "";
  const task = block.taskId ? state.tasks.find((item) => item.id === block.taskId) : null;
  const catColor = block.category ? getCategoryColor(block.category) : null;
  // v17: MIT(今日の主役)
  const isMIT = block.isMIT === true;
  // MIT なら金色の左ボーダーを優先
  const leftBorder = isMIT
    ? `border-left:4px solid var(--gold, #FFD60A); background:linear-gradient(90deg, rgba(255,214,10,0.06), transparent 30%)`
    : (catColor ? `border-left:3px solid ${catColor}` : "");
  const justStarted = block.id === state._justStartedBlockId ? " just-started" : "";  // v40: 着手ジュース
  // v47: 開始/終了は状態に応じて片方だけ(常時両方はボタン過多で迷う)
  const started = Boolean(block.actualStartAt);
  const doing = started && !block.completed && !block.actualEndAt;
  const startEndBtn = block.completed
    ? ""
    : (!started
      ? `<button class="btn" data-action="now-start" data-id="${block.id}">▶ 開始</button>`
      : (doing
        ? `<button class="btn green" data-action="now-end" data-id="${block.id}">■ 終了</button>`
        : ""));
  return `
    <div class="item block-row ${isMIT ? "is-mit" : ""}${doing ? " is-doing" : ""}${justStarted}" ${leftBorder ? `style="${leftBorder}"` : ""}>
      <div class="block-checks">
        <button class="checkbox-button ${block.completed ? "done" : ""}" data-action="toggle-block" data-id="${block.id}" title="Block完了" aria-label="Block完了">✓</button>
      </div>
      <div class="stack">
        <div class="title-line">
          ${isMIT ? `<span class="mit-star" title="今日の主役" style="color:#F5A623; font-weight:700">★</span>` : ""}
          <strong data-action="edit-block" data-id="${block.id}" style="cursor:pointer">${escapeHTML(block.title)}</strong>
          <span class="badge ${block.completed ? "green" : "blue"}">${start}${end ? `-${end}` : ""}</span>
          ${doing ? `<span class="badge orange">着手中 ${timeFromDateTime(block.actualStartAt)}〜</span>` : ""}
          ${task ? `<span class="badge">${escapeHTML(projectName(task.projectId))}</span>` : `<span class="badge orange">単発</span>`}
          ${block.category ? `<span class="cat-chip" style="background:${catColor}1f; color:${catColor}; border:1px solid ${catColor}66">${escapeHTML(block.category)}</span>` : ""}
          ${leverageTypeMarkHTML(block.leverageType)}
        </div>
        <div class="block-meta">
          <label>充電
            <select class="mini-select" data-block-field="charge" data-id="${block.id}">
              ${rangeOptions(0, 5, block.charge)}
            </select>
          </label>
          <label>放電
            <select class="mini-select" data-block-field="discharge" data-id="${block.id}">
              ${rangeOptions(0, 5, block.discharge)}
            </select>
          </label>
        </div>
      </div>
      <div class="row block-actions">
        <button class="btn ${isMIT ? "" : "ghost"}" data-action="toggle-mit" data-id="${block.id}" title="${isMIT ? "今日の主役から外す" : "今日の主役にする(最大3個)"}" style="${isMIT ? "color:#F5A623; font-weight:700" : ""}">${isMIT ? "★" : "☆"}</button>
        ${startEndBtn}
        ${block.completed ? "" : `<button class="btn orange" data-action="start-pomodoro" data-block-id="${block.id}">25分</button>`}
        <button class="btn" data-action="edit-block" data-id="${block.id}">編集</button>
      </div>
    </div>
  `;
}

// v175: renderTimelineView/setTimelineMode/renderTimeline/renderTimelineCard/renderEnergyGraphは
//   src/features/timeline.jsへ移動した(app.js分割・段階4-6・段階B①②③)。呼び出しはファイル
//   冒頭のimportを参照する。updateBatteryTick(このファイル後方)からのrenderEnergyGraph呼び出しも
//   同じimport経由(呼び出し箇所は無改修)。

// v170: renderRoutine〜renderRoutineNowMarker(ルーティンタブ本体、計196行)は
// src/features/routine.jsへ移動した(app.js分割・段階4-4)。renderMainからのimport参照に
// 切り替えた(冒頭import文参照)。

// v171: assignBlocksToLanes/adjustLaneTopPositionsはsrc/features/timeline-layout.jsへ
//   移動した(app.js分割・段階4-5・段階A)。呼び出しはファイル冒頭のimportを参照する。

function renderPomodoro() {
  const running = state.pomodoro.running;
  const mode = state.pomodoro.mode || "focus";
  // focus は 2倍速で 50:00 → 0:00、break は等速で 5:00 → 0:00
  const remaining = running
    ? remainingText(state.pomodoro.endsAt, mode === "focus")
    : "50:00";
  // v10: ポモドーロには「ルーティン」カテゴリの Block は表示しない
  const blockOptions = blocksForDate(state.selectedDate)
    .filter((block) => !block.completed)
    .filter((block) => block.category !== "ルーティン");
  const pomoTab = state.pomodoro.tab || "manual";
  // v12: 全画面モード
  const fullscreen = state.pomodoro.fullscreen || false;
  if (fullscreen) {
    return renderPomodoroFullscreen(running, remaining, blockOptions, pomoTab);
  }
  const studyWithMeOn = state.pomodoro.studyWithMeOn || false;  // v84
  return `
    ${renderHeader("集中タイマー", "ポモドーロ", `
      <button class="btn" data-action="toggle-pomo-fullscreen">⛶ 全画面</button>
      <button class="btn ${studyWithMeOn ? "primary" : ""}" data-action="toggle-study-with-me">🎥 Study With Me</button>
    `)}
    ${studyWithMeOn ? renderStudyWithMeFrame() : ""}
    <div class="segmented" style="margin-bottom:14px">
      <button class="${pomoTab === "manual" ? "active" : ""}" data-action="pomo-tab" data-tab="manual">任意タイマー</button>
      <button class="${pomoTab === "passive" ? "active" : ""}" data-action="pomo-tab" data-tab="passive">常時タイマー</button>
    </div>
    ${pomoTab === "manual" ? renderManualPomodoro(running, remaining, blockOptions) : renderPassivePomodoro()}
  `;
}

// v84: Study With Me — ポモドーロ画面に「疑似同席」のBGM的環境としてYouTube動画を埋め込む。
// ONの間だけiframeをDOM生成し、OFF/タブ離脱(main.innerHTMLの全再描画)で自然に破棄される
// (常時ロード禁止 — iOS PWAのメモリとタブの軽さを守るため)。500ms tickによる頻繁な
// 全再描画でiframeが再読込されないよう、startTimerTicker側はこの表示中、時刻・進捗の
// 差分パッチ(updatePomodoroTick)に切り替える。autoplay は一切付与しない(iOS Safariは
// 音付き自動再生不可なので、再生開始は常にユーザーのタップに委ねる)。
// v88: src組み立てを共通化(通常表示の16:9埋め込みと、全画面背景レイヤの両方から使う)。
// 静的URLのみを組み立てる(トークン等の個人情報は一切含めない)。videoId未設定なら空文字。
function studyWithMeSrc() {
  const swm = state.settings.studyWithMe || {};
  const videoId = String(swm.videoId || "").trim();
  if (!videoId) return "";
  const startSec = Math.max(0, Math.floor(Number(swm.startSec) || 0));
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?start=${startSec}`;
}

function renderStudyWithMeFrame() {
  const src = studyWithMeSrc();
  if (!src) {
    return `<div class="muted" style="margin:0 0 10px; font-size:12px">Study With Me: 設定 → Study With Me で動画IDを指定してください</div>`;
  }
  return `
    <div class="study-with-me-frame-wrap">
      <iframe class="study-with-me-frame" src="${escapeHTML(src)}" title="Study With Me"
        allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>
    </div>
  `;
}

// v88: ポモドーロ全画面モードの背景レイヤ。Study With Me ON時、YouTube iframeを
// 画面いっぱいに(16:9を維持したままCSSのmax()でcover相当に拡大・中央クリップ)敷き、
// 円形プログレス+残り時間のHUD(.pomo-fullscreen-content)を半透明で前面に重ねる。
// タップ制御: HUD全体をpointer-events:noneにし(styles.css)、動画の初回再生タップを
// どこからでも妨げないようにする。ボタン・select・input・aだけCSS側で個別にautoへ戻す
// (YouTube IFrame APIでの再生状態監視は行わない — 過剰実装を避けた)。
function renderStudyWithMeFullscreenBg() {
  const src = studyWithMeSrc();
  if (!src) return "";
  return `
    <div class="pomo-fs-bg-wrap">
      <iframe class="pomo-fs-bg-iframe" src="${escapeHTML(src)}" title="Study With Me"
        allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>
    </div>
  `;
}

// v84: YouTube URL文字列から videoId / 開始秒 を抽出する(正規表現のみ、new Date は使わない)。
// 対応形式: watch?v=/youtu.be//embed//shorts/ の videoId、t=/start= の秒数指定(数値 or 1h2m3s形式)。
function parseYouTubeUrl(text) {
  const s = String(text || "").trim();
  const idMatch = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
  const videoId = idMatch ? idMatch[1] : "";
  let startSec = null;
  const tMatch = s.match(/[?&#](?:t|start)=([0-9hms]+)/i);
  if (tMatch) {
    const raw = tMatch[1];
    if (/^\d+$/.test(raw)) {
      startSec = Number(raw);
    } else {
      const hm = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
      if (hm && (hm[1] || hm[2] || hm[3])) {
        startSec = Number(hm[1] || 0) * 3600 + Number(hm[2] || 0) * 60 + Number(hm[3] || 0);
      }
    }
  }
  return { videoId, startSec };
}

// v12: ポモドーロ全画面モード(背景動画 + 半透明フィルタ + 中央タイマー)
// v88: Study With Me ON時は背景をYouTube iframe(画面いっぱいにcover表示)へ切り替える。
function renderPomodoroFullscreen(running, remaining, blockOptions, pomoTab) {
  const studyWithMeOn = state.pomodoro?.studyWithMeOn || false;
  const swmBgHTML = studyWithMeOn ? renderStudyWithMeFullscreenBg() : "";
  const hasSwmBg = Boolean(swmBgHTML);  // videoId未設定ならOFF扱いと同じ(mp4背景にフォールバック)
  return `
    <div class="pomo-fullscreen${hasSwmBg ? " has-swm-bg" : ""}" id="pomoFullscreen">
      ${hasSwmBg ? swmBgHTML : `
      <video class="pomo-bg-video" autoplay muted loop playsinline poster="">
        <source src="./study_with_me.mp4" type="video/mp4">
      </video>`}
      <div class="pomo-bg-overlay"></div>
      <div class="pomo-fullscreen-content">
        <button class="pomo-fullscreen-close" data-action="toggle-pomo-fullscreen" aria-label="全画面を解除" title="全画面を解除">✕</button>
        <button class="pomo-fullscreen-swm-toggle ${studyWithMeOn ? "active" : ""}" data-action="toggle-study-with-me" aria-label="Study With Me切替" title="Study With Me切替">🎥</button>
        <div class="segmented pomo-fs-tabs">
          <button class="${pomoTab === "manual" ? "active" : ""}" data-action="pomo-tab" data-tab="manual">任意</button>
          <button class="${pomoTab === "passive" ? "active" : ""}" data-action="pomo-tab" data-tab="passive">常時</button>
        </div>
        <div class="pomo-fs-stage">
          ${pomoTab === "manual" ? renderManualPomodoro(running, remaining, blockOptions) : renderPassivePomodoro()}
        </div>
      </div>
    </div>
  `;
}

function renderManualPomodoro(running, remaining, blockOptions) {
  // v14セーフガード強化: running フラグが残っていても、以下のいずれかなら未起動扱いに矯正:
  //   1. endsAt が空
  //   2. endsAt が過去(セッション切れ)
  //   3. startedAt から60分以上経過(休憩込みでも30分なので、60分超は異常)
  //   4. startedAt が未来(時計巻き戻し)
  if (running) {
    const endsAtMs = state.pomodoro.endsAt ? localDateTimeToMs(state.pomodoro.endsAt) : 0;
    const startedAtMs = state.pomodoro.startedAt ? localDateTimeToMs(state.pomodoro.startedAt) : 0;
    const now = Date.now();
    const isInvalid =
      !endsAtMs ||
      endsAtMs <= now ||
      (startedAtMs && (now - startedAtMs) > 60 * 60 * 1000) ||
      (startedAtMs && startedAtMs > now + 60 * 1000);
    if (isInvalid) {
      // 自動修復: state も書き戻して 50:00 を保証
      state.pomodoro = {
        tab: state.pomodoro?.tab || "manual",
        passive: state.pomodoro?.passive || defaultPassivePomodoro(),
        fullscreen: state.pomodoro?.fullscreen || false,
        studyWithMeOn: state.pomodoro?.studyWithMeOn || false,  // v84
        running: false,
        blockId: "",
        startedAt: "",
        endsAt: "",
        mode: "focus"
      };
      saveState();
      running = false;
      remaining = "50:00";
    }
  }
  if (running) {
    const mode = state.pomodoro.mode || "focus";
    const endsAtMs = localDateTimeToMs(state.pomodoro.endsAt);
    const remainingMs = Math.max(0, endsAtMs - Date.now());
    const remainingSec = Math.floor(remainingMs / 1000);
    const currentBlock = state.blocks.find((b) => b.id === state.pomodoro.blockId);

    if (mode === "break") {
      // 休憩フェーズ: 等速 5:00 → 0:00、オレンジ色
      const breakTotalMs = 5 * 60 * 1000;
      const progress = 1 - remainingMs / breakTotalMs;
      const breakDisplay = remainingTextNormal(remainingMs);
      const message = getBreakMessage(remainingSec);
      // v19: 休憩前の Block 情報(続ける/完了 の選択肢用)
      const lastBlockId = state.pomodoro.lastFocusBlockId;
      const lastBlock = lastBlockId ? state.blocks.find((b) => b.id === lastBlockId && !b.deleted) : null;
      return `
        <section class="panel" style="display:grid; place-items:center; min-height:380px; padding:24px">
          ${renderCircularProgress(progress, breakDisplay, "var(--orange)")}
          <div style="text-align:center; margin-top:14px">
            <div style="font-size:13px; font-weight:700; color:var(--orange-text)">☕️ 休憩中</div>
            <div class="muted" style="font-size:11px; margin-top:4px">5:00 → 0:00(実時間)</div>
            ${message ? `<div style="margin-top:10px; font-size:14px; font-weight:600; color:var(--text)">${escapeHTML(message)}</div>` : ""}
          </div>
          ${lastBlock ? `
            <div style="margin-top:14px; padding:10px; background:var(--panel-soft); border-radius:8px; text-align:center; max-width:340px">
              <div class="muted" style="font-size:11px; margin-bottom:4px">直前のセッション:</div>
              <strong style="font-size:13px">${escapeHTML(lastBlock.title)}</strong>
              <div style="margin-top:10px; display:flex; gap:6px; justify-content:center; flex-wrap:wrap">
                <button class="btn green" data-action="continue-focus">🔁 同じBlockで続ける</button>
                <button class="btn primary" data-action="finish-block">✅ ここで完了する</button>
              </div>
            </div>
          ` : ""}
          <div style="margin-top:14px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap">
            <button class="btn" data-action="end-break">✕ 別のタスクへ</button>
          </div>
        </section>
        <section class="panel stack" style="margin-top:12px">
          <div class="muted" style="font-size:12px">次にとりかかる別のBlockを選択(休憩を終了して即開始)</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap">
            ${blockOptions.length
              ? blockOptions.filter((b) => b.id !== lastBlockId).map((block) => `
                <button class="btn orange" data-action="start-pomodoro" data-block-id="${block.id}">${escapeHTML(block.title)}</button>
              `).join("")
              : `<div class="muted">他に選択可能な Block がありません</div>`}
          </div>
        </section>
      `;
    }
    // focus フェーズ: 50:00 → 00:00、青色、2倍速
    const startedAtMs = localDateTimeToMs(state.pomodoro.startedAt);
    const totalMs = endsAtMs - startedAtMs;
    const progress = 1 - remainingMs / totalMs;
    return `
      <section class="panel" style="display:grid; place-items:center; min-height:380px; padding:24px">
        ${renderCircularProgress(progress, remaining, "var(--accent)")}
        <div style="text-align:center; margin-top:14px">
          <div class="muted" style="font-size:12px">作業中(50:00 → 00:00 を 2 倍速で進行)</div>
          ${currentBlock ? `<div style="margin-top:4px; font-weight:700">${escapeHTML(currentBlock.title)}</div>` : ""}
        </div>
        ${_pendingInterruptBlockId === state.pomodoro.blockId ? interruptReasonPickerHTML() : `
        <div style="margin-top:18px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap">
          <button class="btn green" data-action="complete-pomodoro">✓ 完了</button>
          <button class="btn orange" data-action="go-break">☕ 休憩へ</button>
          <button class="btn danger" data-action="stop-pomodoro">中断</button>
        </div>`}
      </section>
    `;
  }
  return `
    <section class="panel" style="display:grid; place-items:center; min-height:300px; padding:24px">
      <div style="text-align:center">
        ${renderCircularProgress(0, "50:00", "var(--faint)")}
        <div class="muted" style="margin-top:14px">Blockを選んで開始</div>
        <div style="margin-top:18px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap; max-width:320px">
          ${blockOptions.map((block) => `
            <button class="btn orange" data-action="start-pomodoro" data-block-id="${block.id}">${escapeHTML(block.title)}</button>
          `).join("") || `<button class="btn" data-action="nav" data-view="tasks">Blockを作る</button>`}
        </div>
      </div>
    </section>
  `;
}

// 円形プログレスバー — progress: 0(始まり) 〜 1(終わり)、表示文字、進捗色
function renderCircularProgress(progress, displayText, color = "var(--accent)") {
  const R = 90;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - Math.min(1, Math.max(0, progress)));
  return `
    <div class="pomo-circle-wrap">
      <svg viewBox="0 0 200 200" class="pomo-circle">
        <circle cx="100" cy="100" r="${R}" class="pomo-bg-circle"></circle>
        <circle cx="100" cy="100" r="${R}" class="pomo-progress-circle"
          style="stroke: ${color}; stroke-dasharray: ${C}; stroke-dashoffset: ${offset};"
          transform="rotate(-90 100 100)"></circle>
      </svg>
      <div class="pomo-time-overlay">${displayText}</div>
    </div>
  `;
}

function renderPassivePomodoro() {
  // 常時タイマーは壁時計ベースで常に動作中
  const session = getPassiveSessionStatus();
  const remainingDisplay = session.phase === "focus"
    ? remainingText2x(session.remainingMs)
    : remainingTextNormal(session.remainingMs);
  const color = session.phase === "focus" ? "var(--accent)" : "var(--orange)";
  const now = new Date();
  const cycleStartMin = Math.floor(now.getMinutes() / 30) * 30;
  const cycleStartLabel = `${pad2(now.getHours())}:${pad2(cycleStartMin)}`;
  // 休憩中は残り秒に応じた文言を表示(v9)
  const breakMsg = session.phase === "break"
    ? getBreakMessage(Math.floor(session.remainingMs / 1000))
    : "";
  return `
    <section class="panel" style="display:grid; place-items:center; min-height:400px; padding:24px">
      ${renderCircularProgress(session.progress, remainingDisplay, color)}
      <div style="text-align:center; margin-top:14px">
        <div style="font-size:13px; font-weight:700; color:${color}">
          ${session.phase === "focus" ? "🎯 集中タイム" : "☕️ 休憩"}
        </div>
        <div class="muted" style="font-size:11px; margin-top:4px">
          ${session.phase === "focus" ? "50:00 → 00:00 を 2 倍速で進行(実時間 25 分)" : "残り休憩時間(実時間)"}
        </div>
        ${breakMsg ? `<div style="margin-top:10px; font-size:14px; font-weight:600; color:var(--text)">${escapeHTML(breakMsg)}</div>` : ""}
        <div class="muted" style="font-size:11px; margin-top:8px">
          現サイクル開始: ${cycleStartLabel} / 毎時 00 分・30 分にリセット
        </div>
      </div>
    </section>
  `;
}


// 現在の常時タイマーセッションの状態を返す(壁時計モデル: 常にアクティブ)
// 30分サイクル(0〜24分59秒=集中、25〜29分59秒=休憩)を時計から直接読む
function getPassiveSessionStatus() {
  const now = new Date();
  const minutesInCycle = now.getMinutes() % 30 + now.getSeconds() / 60 + now.getMilliseconds() / 60000;
  const FOCUS_MIN = 25;
  const BREAK_MIN = 5;
  if (minutesInCycle < FOCUS_MIN) {
    // 集中フェーズ(0〜24:59)
    const elapsedMs = minutesInCycle * 60 * 1000;
    const focusMs = FOCUS_MIN * 60 * 1000;
    return {
      active: true,
      phase: "focus",
      progress: elapsedMs / focusMs,
      remainingMs: focusMs - elapsedMs
    };
  }
  // 休憩フェーズ(25:00〜29:59)
  const elapsedInBreakMs = (minutesInCycle - FOCUS_MIN) * 60 * 1000;
  const breakMs = BREAK_MIN * 60 * 1000;
  return {
    active: true,
    phase: "break",
    progress: elapsedInBreakMs / breakMs,
    remainingMs: breakMs - elapsedInBreakMs
  };
}

function remainingText2x(remainingMs) {
  // 2倍速: 500ms = 表示1秒 として扱う(1秒ずつ自然に減る)
  const display = Math.max(0, Math.floor(remainingMs / 500));
  return `${pad2(Math.floor(display / 60))}:${pad2(display % 60)}`;
}

function remainingTextNormal(remainingMs) {
  const sec = Math.max(0, Math.floor(remainingMs / 1000));
  return `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`;
}


// v169: renderMorningEnergyPicker/renderConditionMorningExtra/renderEveningConditionCard/
// lastGymRecord/renderGymLogCard(+CONDITION_SLEEP_PRESETS/CONDITION_CAPACITY_OPTIONS/
// CONDITION_GYM_PRESETS)はsrc/features/journal.jsへ移動した(app.js分割・段階4-3)。

// v141: 今日行ったお店ログ =========================================================
// ジャーナルタブから店名/URL(任意)/感想を記録する。1日に複数件登録可。年間一覧はモーダルで
// 月別グループ表示する(state.storeVisitsはtasks/projectsと同じmergeByIdPreferNewerで
// 多端末マージ・tombstone削除。normalizeState参照)。

// v169: safeExternalUrl/storeVisitsForDate/renderStoreVisitsCard/openStoreVisitEditor/
// buildStoreVisitModal/saveStoreVisitFromModal/deleteStoreVisit/deleteStoreVisitWithConfirm/
// openStoreVisitsYearModal/buildStoreVisitsYearModalはsrc/features/journal.jsへ移動した
// (app.js分割・段階4-3)。saveStoreVisitFromModal/deleteStoreVisit/openStoreVisitEditor/
// openStoreVisitsYearModal/deleteStoreVisitWithConfirmはclick/modal dispatcher(app.js残留)から
// も呼ばれるため冒頭でimportして参照を切り替えた。
// ========================================================================

// v105: 睡眠CSV(AutoSleep書き出し) =============================================
// 実測睡眠はAutoSleepアプリの書き出しCSVをジャーナルタブから取り込む(手書き欄は廃止)。
// キーは「起床日」= その朝のこと。selectedDateのログ=前夜の睡眠。
// パースはiOSルールに従いDateオブジェクトを経由せず正規表現の文字列抽出のみで行う。

function parseSleepCsv(text) {
  // AutoSleep書き出し用の最小CSVパーサ(引用符・""エスケープ対応。フィールド内改行は
  // AutoSleepのメモ未使用運用では発生しないため非対応と割り切る)
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const parseLine = (line) => {
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const header = parseLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = parseLine(l);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

function hmsToHours(s) {
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec((s || "").trim());
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60 + Number(m[3] || 0) / 3600;
}

function sleepNumOrNull(s) {
  const v = Number((s || "").trim());
  return (s || "").trim() && Number.isFinite(v) ? v : null;
}

// v120: AutoSleepのロケール差(1桁月日/時、-/./区切り、秒省略)を文字列だけで吸収する。
function parseSleepDateTime(s) {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2})(?::\d{2})?/.exec((s || "").trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59) return null;
  return { date: `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`, time: `${h.padStart(2, "0")}:${mi}` };
}

function parseSleepTime(s) {
  const m = /(?:^|[ T])(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec((s || "").trim());
  return m && +m[1] <= 23 && +m[2] <= 59 ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

function shortSleepDate(s) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${+m[1]}/${+m[2]}` : s;
}

// v131: AutoSleepは各日レコードを夜21:00に確定するため、朝の時点では前夜分がまだCSVに
// 含まれない(構造的な制約。実データ解析で確認済み)。当日キーが無ければ直近2日以内を
// 遡ってフォールバックし、どの日のデータかを呼び出し側が明示できるようにする。
// 見つかった場合 {log, logDate, ageDays}(ageDays=0なら当日、1なら前日…)、無ければnull。
function latestSleepLogWithin(date, maxAgeDays = 2) {
  for (let age = 0; age <= maxAgeDays; age++) {
    const d = addDays(date, -age);
    const log = state.sleep.logs[d];
    if (log) return { log, logDate: d, ageDays: age };
  }
  return null;
}

// v128: 体力予算 ==================================================================
// 疲労を主観で気づく前に、朝の睡眠心拍データ(state.sleep.logs、AutoSleep CSV取込)で
// 先取りする。ベースラインは当日を含まない過去28日分のhrSleep/hrvSleepの中央値
// (7日分未満なら心拍系の判定はスキップし、sleepHのみで判定する)。
// 閾値は初期値であり、CONDITION_BUDGET_* 定数を調整すればよい(daily-report-fallback.pyの
// condition_budget()と同じ式・同じ定数値に必ず揃えること。突合はFORMAT_CONTRACT.md参照)。
const CONDITION_BUDGET_BASELINE_LOOKBACK_DAYS = 28;
const CONDITION_BUDGET_BASELINE_MIN_SAMPLES = 7;
const CONDITION_BUDGET_HRV_DEFICIT_PCT = -15;  // ベースライン比。これ以下(より低い)で赤字
const CONDITION_BUDGET_HRV_LOW_PCT = -5;       // これ以下(より低い)で低予算
const CONDITION_BUDGET_HR_DEFICIT_BPM = 5;     // ベースライン比+この値以上で赤字
const CONDITION_BUDGET_HR_LOW_BPM = 2;         // これ以上で低予算
const CONDITION_BUDGET_SLEEP_DEFICIT_H = 5.5;  // これ未満で赤字
const CONDITION_BUDGET_SLEEP_LOW_H = 6.5;      // これ未満で低予算
const CONDITION_BUDGET_LABELS = { deficit: "赤字", low: "低予算", normal: "通常" };

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// v137(review.md:39): conditionBudgetがsleepHにだけ.toFixed(1)を直接呼んでおり、sleepHが
// 数値文字列の非正規stateだとTypeErrorになる(hr/hrvは算術式内で暗黙変換されるため安全、
// という非対称があった)。loop/scripts/daily-report-fallback.py の to_number() と同じ変換
// ルールに揃え、hr/hrv/sleepHすべてこの関数を経由させる(null/undefined/boolはnull、
// 数値・数値文字列はNumber化、NaNになるものはnullを返す)。
function toNumber(v) {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// dateを含まない過去CONDITION_BUDGET_BASELINE_LOOKBACK_DAYS日分から、hr/hrvそれぞれの
// 中央値ベースラインを求める。サンプル不足(7日未満)ならそのベースラインはnull。
function conditionBudgetBaseline(date) {
  const from = addDays(date, -CONDITION_BUDGET_BASELINE_LOOKBACK_DAYS);
  const to = addDays(date, -1);
  const hrVals = [], hrvVals = [];
  Object.entries(state.sleep.logs).forEach(([d, log]) => {
    if (d < from || d > to) return;
    const hrV = toNumber(log.hrSleep);
    if (hrV !== null) hrVals.push(hrV);
    const hrvV = toNumber(log.hrvSleep);
    if (hrvV !== null) hrvVals.push(hrvV);
  });
  return {
    hrBaseline: hrVals.length >= CONDITION_BUDGET_BASELINE_MIN_SAMPLES ? median(hrVals) : null,
    hrvBaseline: hrvVals.length >= CONDITION_BUDGET_BASELINE_MIN_SAMPLES ? median(hrvVals) : null
  };
}

// 当日の睡眠ログ(state.sleep.logs[date])から体力予算を3段階(deficit/low/normal)判定する。
// v131: 当日キーが無ければlatestSleepLogWithin()で直近2日以内にフォールバックする(AutoSleepが
// 前夜分を21:00にしか確定しないため、朝の時点では当日キーが存在しないのが通常運転)。
// フォールバックした日はreason先頭に「M/D朝」を明示し、黙って当日扱いしない。
// 2日以内に1件も無い日は level:"none"(データなし)。ベースライン計算は従来どおりdate基準
// (フォールバック元のlogDateではない)で過去28日を見る(仕様どおり変更していない)。
function conditionBudget(date) {
  const found = latestSleepLogWithin(date);
  if (!found) return { level: "none", reason: "" };
  const { log, logDate, ageDays } = found;
  const baseline = conditionBudgetBaseline(date);
  const factors = [];
  const hrvSleep = toNumber(log.hrvSleep);
  if (baseline.hrvBaseline != null && hrvSleep !== null) {
    const pct = ((hrvSleep - baseline.hrvBaseline) / baseline.hrvBaseline) * 100;
    if (pct <= CONDITION_BUDGET_HRV_DEFICIT_PCT) factors.push({ severity: "deficit", text: `HRV ${pct >= 0 ? "+" : ""}${Math.round(pct)}%` });
    else if (pct <= CONDITION_BUDGET_HRV_LOW_PCT) factors.push({ severity: "low", text: `HRV ${pct >= 0 ? "+" : ""}${Math.round(pct)}%` });
  }
  const hrSleep = toNumber(log.hrSleep);
  if (baseline.hrBaseline != null && hrSleep !== null) {
    const diff = hrSleep - baseline.hrBaseline;
    if (diff >= CONDITION_BUDGET_HR_DEFICIT_BPM) factors.push({ severity: "deficit", text: `HR +${Math.round(diff)}bpm` });
    else if (diff >= CONDITION_BUDGET_HR_LOW_BPM) factors.push({ severity: "low", text: `HR +${Math.round(diff)}bpm` });
  }
  const sleepH = toNumber(log.sleepH);
  if (sleepH !== null) {
    if (sleepH < CONDITION_BUDGET_SLEEP_DEFICIT_H) factors.push({ severity: "deficit", text: `睡眠${sleepH.toFixed(1)}h` });
    else if (sleepH < CONDITION_BUDGET_SLEEP_LOW_H) factors.push({ severity: "low", text: `睡眠${sleepH.toFixed(1)}h` });
  }
  const level = factors.some((f) => f.severity === "deficit") ? "deficit" : factors.length ? "low" : "normal";
  const factorsText = factors.map((f) => f.text).join("・");
  // v131: フォールバック(ageDays>0)の場合、根拠が0件(通常判定)でも日付ラベルだけは必ず出す
  // (「今日は通常」と黙って誤読されないようにする)。
  const ageLabel = ageDays > 0 ? `${shortSleepDate(logDate)}朝` : "";
  const reason = ageLabel && factorsText ? `${ageLabel}: ${factorsText}` : (ageLabel || factorsText);
  return { level, reason };
}

// =========================================================
// v144: エネルギーバッテリーモデル(設計提案書§3、2026-07-26 K確定パラメタ)
// 「朝30あったエネルギーがデフォルトで徐々に減る。適宜回復させないと!という意識になるように
// したい」というK指示に基づく、通知・アラート無しの決定論・都度計算モデル(保存はしない)。
// 静かな計器の最低線(催促・裁かない)を守るため、表示は数値+バーのみで完結させる。
// =========================================================

// 設定未保存(旧state・テストのopts省略時)のフォールバック既定値。normalizeStateの
// マイグレーションと computeBatteryLevel の両方から参照する単一の正本。
// v144レビュー対応(M4): 減衰開始時刻はtype="time"入力に対応するため分単位
// (decayStartMinutes)で保持する(420=07:00固定。K確定の意味自体は不変)。
// v145: 行動接続(残量低下時の回復Block下書き提案)のパラメタを追加。既定は全面OFF/40%
// (opt-in。既存の3パラメタと同じくnormalizeStateのマイグレーション対象)。
function defaultBatterySettings() {
  return {
    start: { deficit: 30, low: 40, normal: 50 },
    decayPerHour: 3,
    decayStartMinutes: 420,
    max: 50,
    recoveryDraft: false,
    recoveryThresholdPct: 40
  };
}

// v144レビュー対応(M3/M4): エネルギーバッテリー設定のフィールド別の境界値をここ1箇所に
// まとめ、保存ハンドラ(change委譲)・normalizeStateの両方から呼ぶ(手入力・同期データ経由の
// 異常値をどちらの経路からも同じ基準で弾く)。
// - start.*(体力予算連動の開始値): 有限かつ0〜200にクランプ
// - decayPerHour: 0以上(上限なし)
// - decayStartMinutes: 0〜1439の有限値のみ許可、それ以外は既定420(07:00)へ
// - max: 1以上(空欄・0・負値は静かな計器の趣旨に反する=常時赤ゲージになるため、
//   Math.max(1, …)側へ倒す)
function clampBatteryFieldValue(field, raw) {
  const n = Number(raw);
  const finite = Number.isFinite(n) ? n : null;
  if (field.startsWith("start.")) return clamp(finite ?? 0, 0, 200);
  if (field === "decayPerHour") return Math.max(0, finite ?? 0);
  if (field === "max") return Math.max(1, finite ?? 1);
  if (field === "decayStartMinutes") return (finite !== null && finite >= 0 && finite <= 1439) ? finite : 420;
  // v145: 回復提案の発火しきい値(開始値に対する%)。1〜100の範囲外・非数は既定40へ倒す。
  if (field === "recoveryThresholdPct") return (finite !== null && finite >= 1 && finite <= 100) ? finite : 40;
  return finite ?? 0;
}

// type="time"の入力値("HH:mm")を0時からの経過分に変換する。不正な形式はNaNを返し、
// 呼び出し側のclampBatteryFieldValueが既定420(07:00)へ倒す。
function parseTimeInputToMinutes(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ""));
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

// 0時からの経過分をtype="time"のvalue属性用文字列("HH:mm")に変換する。
function minutesToTimeInputValue(minutes) {
  const m = Number.isFinite(minutes) ? clamp(minutes, 0, 1439) : 420;
  return `${pad2(Math.floor(m / 60))}:${pad2(Math.floor(m % 60))}`;
}

// 残量 = 開始値 − 減衰率×(減衰開始時刻からの経過時間h) + Σ(当日完了Blockのcharge−discharge)
// を 0〜上限でクランプして返す純関数。
// - dateKey: 対象日(YYYY-MM-DD)
// - nowMinutes: 評価時点の「0時からの経過分」(呼び出し側が new Date() 等から算出して渡す。
//   テスト容易性のため必ず引数で受け取り、関数内部では現在時刻を取得しない)
// - opts.budgetLevel: conditionBudget(dateKey).level を上書きしたい場合に指定(未指定なら算出する)
// - opts.blocks: 集計対象のBlock配列を上書きしたい場合に指定(未指定なら blocksForDate(dateKey))
// レビュー対応(監督者裁定): 電池チップ(現在残量)は既存のエネルギー実線
// (renderEnergyGraphの実績カーブ)と同じ「当日ぶん丸ごと」思想に揃え、完了Blockの
// actualEndAt時刻によるフィルタは行わない(実績終了が未来時刻・翌日時刻でも当日合計に入れる)。
// 減衰は分単位で連続計算する(1時間ごとの階段状にはしない。理由: 電池チップとタイムライン
// 重ね描きの両方で同じ考え方を使い回すため、階段だと重ね描きの折れ線が不自然にカクつく)。
function computeBatteryLevel(dateKey, nowMinutes, opts = {}) {
  const def = defaultBatterySettings();
  const cfg = state.settings.battery || def;
  const startCfg = { ...def.start, ...(cfg.start || {}) };
  const budgetLevel = opts.budgetLevel || conditionBudget(dateKey).level;
  // level:"none"(睡眠データなし)は normal 扱い(設計提案書§3の明記どおり)
  const startKey = budgetLevel === "deficit" ? "deficit" : budgetLevel === "low" ? "low" : "normal";
  const start = Number(startCfg[startKey]);

  const decayStartMin = Number.isFinite(cfg.decayStartMinutes) ? cfg.decayStartMinutes : def.decayStartMinutes;
  const decayPerHour = Number.isFinite(cfg.decayPerHour) ? cfg.decayPerHour : def.decayPerHour;
  const elapsedH = Math.max(0, nowMinutes - decayStartMin) / 60;
  const decay = decayPerHour * elapsedH;

  const blocks = opts.blocks || blocksForDate(dateKey);
  const netSum = blocks
    .filter((b) => b.completed)
    .reduce((sum, b) => sum + (Number(b.charge) || 0) - (Number(b.discharge) || 0), 0);

  const max = Number.isFinite(cfg.max) ? cfg.max : def.max;
  return clamp(start - decay + netSum, 0, max);
}

// actualEndAtの日付部分がdateKeyと同日ならその日の分(minutesOf)、日付が異なる(日またぎ、
// 例えば深夜作業でBlockの所属日=dateKeyだが実績終了が翌日になった等)場合は[0,1440]に
// クランプした位置を返す(dateKeyより後の日付なら当日末尾=1440、前の日付なら当日先頭=0)。
// actualEndAt自体が無ければnull。
function batteryEventMinuteForDate(dateKey, actualEndAt) {
  if (!actualEndAt) return null;
  const datePart = actualEndAt.slice(0, 10);
  if (datePart === dateKey) return minutesOf(actualEndAt);
  return datePart > dateKey ? 1440 : 0;
}

// タイムラインの既存エネルギーグラフへ重ね描きする、当日のバッテリー実カーブの点列。
// 減衰は区間ごとに傾き一定の直線、完了Block時点でのみ値が変わるため、イベント時刻
// (0時・減衰開始時刻・各完了Blockの位置・現在時刻)だけをサンプリングすれば数学的に正確な
// 折れ線になる。レビュー対応: 充放電のある完了イベントは「直前値」「直後値」の2点を同じ分に
// 置き、斜めの補間でなく垂直な段差として描く(実際に値が瞬時に変わることを正しく表現する)。
// opts.budgetLevel/opts.blocksを渡せば呼び出し側で1回だけ計算した結果を使い回せる
// (conditionBudget()/blocksForDate()をイベント点の数だけ繰り返し呼ばないためのレビュー対応)。
function batteryCurvePoints(dateKey, nowMinutes, opts = {}) {
  const def = defaultBatterySettings();
  const cfg = state.settings.battery || def;
  const startCfg = { ...def.start, ...(cfg.start || {}) };
  const budgetLevel = opts.budgetLevel || conditionBudget(dateKey).level;
  const startKey = budgetLevel === "deficit" ? "deficit" : budgetLevel === "low" ? "low" : "normal";
  const start = Number(startCfg[startKey]);
  const decayStartMin = Number.isFinite(cfg.decayStartMinutes) ? cfg.decayStartMinutes : def.decayStartMinutes;
  const decayPerHour = Number.isFinite(cfg.decayPerHour) ? cfg.decayPerHour : def.decayPerHour;
  const max = Number.isFinite(cfg.max) ? cfg.max : def.max;

  const blocks = opts.blocks || blocksForDate(dateKey);
  const events = blocks
    .filter((b) => b.completed && b.actualEndAt)
    .map((b) => ({ minute: batteryEventMinuteForDate(dateKey, b.actualEndAt), net: (Number(b.charge) || 0) - (Number(b.discharge) || 0) }))
    .filter((e) => e.minute !== null && e.minute <= nowMinutes);

  const rawAt = (m, cumNet) => start - (decayPerHour * Math.max(0, m - decayStartMin) / 60) + cumNet;

  // 0時・減衰開始時刻(傾きが変わる「折れ」の点。ジャンプは無い)・各充放電イベント(直前/直後の
  // 2点でジャンプを表現)・現在時刻を、時刻昇順に1本の累積計算で処理する。
  const breakpoints = [
    { minute: 0, kind: "plain" },
    ...(decayStartMin > 0 && decayStartMin <= nowMinutes ? [{ minute: decayStartMin, kind: "plain" }] : []),
    ...events.map((e) => ({ minute: e.minute, kind: "event", net: e.net })),
    { minute: nowMinutes, kind: "plain" }
  ].sort((a, b) => a.minute - b.minute);

  const points = [];
  let cum = 0;
  for (const bp of breakpoints) {
    if (bp.kind === "event") {
      points.push({ minute: bp.minute, value: clamp(rawAt(bp.minute, cum), 0, max) });  // 直前値
      cum += bp.net;
      points.push({ minute: bp.minute, value: clamp(rawAt(bp.minute, cum), 0, max) });  // 直後値(垂直段差)
    } else {
      points.push({ minute: bp.minute, value: clamp(rawAt(bp.minute, cum), 0, max) });
    }
  }
  return points;
}

// =========================================================
// v145: エネルギーバッテリー「行動接続」— 残量低下時の回復Block下書き提案(opt-in・既定OFF)。
// 設計提案書§3「行動接続(後続フェーズ・任意)」の実装。新しいUIは作らず、既存の
// _scheduleDraft+draftレイヤ(runAiMorningPlanと同じ機構)へ1〜2件の下書きBlockとして
// 静かに流し込むだけ(通知・アラート・トーストは出さない)。
// =========================================================

const BATTERY_RECOVERY_LOOKBACK_DAYS = 28;          // 「直近4週」固定(判定用途のため。P2 rule1と同じ考え方)
const BATTERY_RECOVERY_MIN_SAMPLES = 3;             // n>=3件揃わないタイトルは候補にしない(過剰解釈防止)
const BATTERY_RECOVERY_MAX_ITEMS = 2;               // 提案は最大2件
const BATTERY_RECOVERY_DURATION_FALLBACK_MIN = 20;  // 実績時間が1件も無いタイトル用の既定所要時間
const BATTERY_RECOVERY_DATES_MAX = 180;             // feedbackIngestedDates等と同じ軽量配列の上限思想

// 完了Blockのタイトル別net(charge−discharge)中央値(回復提案の候補選定専用)。
// computeChargeTopCategories(カテゴリ単位、v143。計器盤「今週のヒント」用)と同じ思想だが、
// K指示は「ルーティン/タイトル単位」のため別実装にした(カテゴリだと粒度が粗く、個々の
// 充電系ルーティン・タスクを名指しできないため)。n>=3・net中央値>0のみ、中央値降順。
// durationMinは同タイトルの実績所要時間(_actualDurationMin)の中央値。1件も無ければ
// BATTERY_RECOVERY_DURATION_FALLBACK_MINへフォールバックする(下書き配置の長さに使う)。
function computeChargeTopTitles(since, today) {
  const doneInRange = state.blocks.filter((b) => !b.deleted && b.completed && b.title && b.date >= since && b.date <= today);
  const byTitle = {};
  doneInRange.forEach((b) => {
    const entry = (byTitle[b.title] ||= { nets: [], durations: [], category: "" });
    entry.nets.push(Number(b.charge || 0) - Number(b.discharge || 0));
    const d = _actualDurationMin(b);
    if (d != null) entry.durations.push(d);
    if (b.category) entry.category = b.category;  // 表示・下書き配置用に直近の完了分のカテゴリを採用
  });
  return Object.entries(byTitle)
    .filter(([, v]) => v.nets.length >= BATTERY_RECOVERY_MIN_SAMPLES)
    .map(([title, v]) => ({
      title,
      med: median(v.nets),
      n: v.nets.length,
      category: v.category,
      durationMin: v.durations.length ? Math.round(median(v.durations)) : BATTERY_RECOVERY_DURATION_FALLBACK_MIN
    }))
    .filter((r) => r.med > 0)
    .sort((a, b) => b.med - a.med);
}

// [start,end)区間の配列(occupied)を、gaps(同じく[start,end)の配列)から差し引く。
// computeFreeGapsは実Block(plannedStartAt/plannedEndAt)しか占有として見ないため、
// 「_scheduleDraftの既存下書き項目」のような非永続の占有区間を追加で差し引くための汎用ヘルパー
// (v145レビュー対応: 朝プラン下書きの真上に回復提案が重なる事故の根絶)。
function subtractOccupiedIntervals(gaps, occupied) {
  if (!occupied.length) return gaps.map(([s, e]) => [s, e]);
  return occupied.reduce((acc, [os, oe]) => {
    const next = [];
    acc.forEach(([s, e]) => {
      if (oe <= s || os >= e) { next.push([s, e]); return; }  // 重ならない
      if (os > s) next.push([s, os]);
      if (oe < e) next.push([oe, e]);
    });
    return next;
  }, gaps.map(([s, e]) => [s, e]));
}

// 判定(決定論・1日1回冪等)+配置。opt-in設定がONで、当日の残量が閾値
// (開始値×settings.battery.recoveryThresholdPct%)を下回っていれば、直近4週の
// computeChargeTopTitles上位1〜2件を空き時間(computeFreeGaps)へ下書きBlockとして配置する。
// 冪等ガード(state.batteryRecoveryDraftDates)は「発火条件が成立した時点」で立てる
// (maybeAutoMorningPlanと同じ思想: 候補0件・空き時間0件で何も置けなかった日も再試行しない)。
// 戻り値は「新規に下書きを追加したか」(呼び出し側のrender()要否判定に使う)。
function maybeSuggestRecoveryDraft(nowMinutes) {
  if (!state.settings.battery?.recoveryDraft) return false;  // 既定OFF・opt-in
  const today = todayISO();
  // v145レビュー対応: 朝プラン(runAiMorningPlan)の非同期処理と_scheduleDraftを取り合わないよう、
  // 処理中はこのtickをスキップする(冪等マーカーは焼かない=次tickで再評価される)。
  if (_morningPlanInFlight) return false;
  if (!Array.isArray(state.batteryRecoveryDraftDates)) state.batteryRecoveryDraftDates = [];
  // v150レビュー対応(項目5、Codex指摘): マーカーは{date, titles}のオブジェクト配列(下記参照)。
  if (state.batteryRecoveryDraftDates.some((e) => e && e.date === today)) return false;  // 冪等: 1日1回

  const def = defaultBatterySettings();
  const cfg = state.settings.battery || def;
  const startCfg = { ...def.start, ...(cfg.start || {}) };
  const budgetLevel = conditionBudget(today).level;
  const startKey = budgetLevel === "deficit" ? "deficit" : budgetLevel === "low" ? "low" : "normal";
  const startValue = Number(startCfg[startKey]);
  const thresholdPct = Number.isFinite(cfg.recoveryThresholdPct) ? cfg.recoveryThresholdPct : def.recoveryThresholdPct;
  const threshold = startValue * (thresholdPct / 100);
  const level = computeBatteryLevel(today, nowMinutes, { budgetLevel });
  if (level >= threshold) return false;  // 閾値以上なら対象外

  // ここから先は「発火条件が成立した」とみなし、結果(候補0件・空き枠0件含む)に関わらず
  // 1日1回のガードを立てる(空振りのたびに毎分再試行しないため)。titlesは実際に配置できた
  // ぶんをplaceRecoveryDraftCandidates側で後から書き込む(まずは空配列で冪等マーカーだけ立てる)。
  const marker = { date: today, titles: [] };
  state.batteryRecoveryDraftDates.push(marker);
  if (state.batteryRecoveryDraftDates.length > BATTERY_RECOVERY_DATES_MAX) {
    state.batteryRecoveryDraftDates = state.batteryRecoveryDraftDates.slice(-BATTERY_RECOVERY_DATES_MAX);
  }

  return placeRecoveryDraftCandidates(today, nowMinutes);
}

// v150(UI改善計画Phase4b・S7): 候補計算+配置+_scheduleDraftへのマージ本体。
// maybeSuggestRecoveryDraft(新規発火時)と maybeRebuildRecoveryDraft(下記、PWA破棄後の
// 再構築時)の両方から呼ぶ共有部分に切り出した。冪等マーカー・閾値判定は呼び出し側の
// 責務(ここでは行わない)。
// v150レビュー対応(項目5、Codex指摘): 第3引数opts.restoreTitlesを指定すると「再構築モード」
// になる。新規発火(上位N件を毎回計算し直す)とは違い、渡されたタイトル一覧のうち当日まだ
// 実Block化されていない(=未確定)ものだけを対象にする——次点候補が繰り上がって新規提案
// されることはない。
function placeRecoveryDraftCandidates(today, nowMinutes, opts = {}) {
  const restoreTitles = Array.isArray(opts.restoreTitles) ? opts.restoreTitles : null;
  // v145レビュー対応(当日重複候補の除外): aiScheduleCandidates(app.js:3848近辺)の規約に
  // 合わせ、「当日すでに同名Blockが存在する」「当日の_scheduleDraftに同名項目がある」タイトルは
  // 候補から除外する(夕方発火時に今日もうやった「散歩」を再提案しない)。MAX_ITEMSへ絞る前に
  // 除外することで、除外後も上位2件をきちんと拾えるようにする。
  const existingDraftForToday = (_scheduleDraft && _scheduleDraft.date === today) ? _scheduleDraft : null;
  const todaysBlockTitles = new Set(state.blocks.filter((b) => !b.deleted && b.date === today).map((b) => b.title));
  const todaysDraftTitles = new Set((existingDraftForToday?.items || []).map((it) => it.title));
  const since = addDays(today, -(BATTERY_RECOVERY_LOOKBACK_DAYS - 1));
  let candidates;
  if (restoreTitles) {
    // 再構築モード: 元々提案したタイトルのうち未確定のものだけを、統計(所要時間・カテゴリ・
    // net中央値)と突き合わせて復元する。computeChargeTopTitles側で該当タイトルが見つからない
    // (直近4週データの入れ替わり等)場合は静かにスキップする(クラッシュしない)。
    const pool = new Map(computeChargeTopTitles(since, today).map((c) => [c.title, c]));
    candidates = restoreTitles
      .filter((t) => !todaysBlockTitles.has(t) && !todaysDraftTitles.has(t))
      .map((t) => pool.get(t))
      .filter(Boolean);
  } else {
    candidates = computeChargeTopTitles(since, today)
      .filter((c) => !todaysBlockTitles.has(c.title) && !todaysDraftTitles.has(c.title))
      .slice(0, BATTERY_RECOVERY_MAX_ITEMS);
  }
  if (!candidates.length) { saveState(); return false; }

  const DAY_START = 5 * 60, DAY_END = 23 * 60;
  const nowFloor = Math.min(DAY_END, Math.ceil(nowMinutes / 15) * 15);
  const rawGaps = computeFreeGaps(today, DAY_START, DAY_END)
    .map(([s, e]) => [Math.max(s, nowFloor), e])
    .filter(([s, e]) => e - s >= 15);
  // v145レビュー対応(既存下書きとの重なり防止): computeFreeGapsは実Blockしか見ないため、
  // 当日の既存_scheduleDraft項目(朝プラン等)の占有区間を追加で差し引く。
  const draftOccupied = (existingDraftForToday?.items || []).map((it) => [it.start, it.start + it.minutes]);
  const gaps = subtractOccupiedIntervals(rawGaps, draftOccupied).filter(([s, e]) => e - s >= 15);

  const placed = [];
  candidates.forEach((c) => {
    const minutes = clamp(c.durationMin, 15, 120);
    const gapIdx = gaps.findIndex((g) => g[1] - g[0] >= minutes);
    if (gapIdx === -1) return;  // 入り切らなければ配置しない(詰め込まない、既存方針と同じ)
    const start = gaps[gapIdx][0];
    placed.push({
      id: crypto.randomUUID(), title: c.title, taskId: "", category: c.category || "",
      start, minutes, aiStart: start, aiMinutes: minutes,
      source: "battery-recovery",  // v145レビュー対応: 合流時も学習ログでitem単位の出どころを残す
      reason: `回復提案: 直近4週の充電効果(net中央値${signed(Math.round(c.med))})が高いBlock`
    });
    // v145レビュー対応: 既存のfallbackMorningPlanと同じブロック間バッファを空ける
    gaps[gapIdx][0] += minutes + MORNING_PLAN_BUFFER_MIN;
    if (gaps[gapIdx][1] - gaps[gapIdx][0] < 15) gaps.splice(gapIdx, 1);
  });

  // v150レビュー対応(項目5): 新規発火時(restoreTitles無し)だけ、実際に配置できたタイトルを
  // マーカーへ書き戻す(将来のmaybeRebuildRecoveryDraftが参照する「元々提案した候補」)。
  // 再構築モード(restoreTitles指定時)はマーカーを書き換えない——「元の提案どおり」を保つ。
  // saveState()より前に反映することで、この後の1回のsaveStateでまとめて永続化する。
  if (placed.length && !restoreTitles) {
    const marker = state.batteryRecoveryDraftDates.find((e) => e && e.date === today);
    if (marker) marker.titles = placed.map((p) => p.title);
  }

  saveState();
  if (!placed.length) return false;

  // 既存の下書き(朝プラン等)があれば末尾に合流させ、無ければ新規に作る。
  // source:"battery-recovery" はdraftBarHTMLの表示分岐(ai-plan以外は「⚙ 決定論配置」表示)に
  // そのまま乗る — 新規ラベル・新規UIは作らない。
  if (existingDraftForToday) {
    _scheduleDraft.items = [..._scheduleDraft.items, ...placed];
    // v145レビュー対応: 新規追加分がある以上、前セッションのUndoは意味を持たないため
    // 新規作成時と対称にリセットする(mergeでも同じ扱いに揃える)。
    _draftUndo = null; _draftUndoHistoryEntry = null;
  } else {
    _scheduleDraft = { date: today, items: placed, skipped: [], source: "battery-recovery" };
    _draftUndo = null; _draftUndoHistoryEntry = null;
  }
  return true;
}

// v150(UI改善計画Phase4b・S7): 回復候補ドラフトの再構築(PWA破棄対策)。
// _scheduleDraft はセッション限りの非永続変数のため、iOSがプロセスを破棄した後の再起動では
// 「冪等マーカー(state.batteryRecoveryDraftDates)は当日分が立ったまま、_scheduleDraftの
// battery-recovery項目だけが消えている」状態になりうる(提案が出た事実だけが残り、Homeの
// 「回復候補」→Timelineの導線が失われる、決定10の指摘)。新規stateフィールドは追加せず、
// 「当日の冪等マーカーあり(=発火条件は成立済み)+現在のdraftにbattery-recovery項目が無い
// +その候補がまだ実Blockとして確定していない(=未確定)」を起動時に検知したときだけ、
// 候補計算(placeRecoveryDraftCandidates、閾値判定は再実行しない)をもう一度走らせて
// 再構築する。呼び出しは起動シーケンス内で1回のみ(下記起動処理を参照)。
// updateBatteryTickの毎分ループには載せない — 同一セッション内でユーザーが確定/却下した
// 直後にも「マーカーあり+draft無し」の条件は一致してしまうため、そこで再度呼ぶと
// 確定・却下済みの提案を蒸し返してしまう(このtradeoffは「新規フィールドを増やさない」方針を
// 優先した結果。詳細はCHANGES_v150.md参照)。
// v150レビュー対応(項目5、Codex指摘): マーカーには「その日実際に提案したタイトル一覧」も
// 記録している(placeRecoveryDraftCandidates参照)。再構築はこの記録済みタイトルのうち
// 未解決(=当日まだ同名の実Blockが無い)ものだけを復元対象にし、
// computeChargeTopTitlesを素で再実行した「次点候補」を新規に繰り上げ提案することはない。
// 旧形式(titles不明、文字列だった頃のマーカー)はtitlesが空配列のまま補完される
// (normalizeState参照)ため、再構築の対象から自然に外れる(「旧形式の日は再構築スキップ」)。
function maybeRebuildRecoveryDraft(nowMinutes) {
  if (!state.settings.battery?.recoveryDraft) return false;
  const today = todayISO();
  const marker = Array.isArray(state.batteryRecoveryDraftDates)
    ? state.batteryRecoveryDraftDates.find((e) => e && e.date === today)
    : null;
  if (!marker || !Array.isArray(marker.titles) || !marker.titles.length) return false;
  const alreadyLive = _scheduleDraft && _scheduleDraft.date === today
    && _scheduleDraft.items.some((it) => it.source === "battery-recovery");
  if (alreadyLive) return false;  // このブート内では何も失っていない
  if (_morningPlanInFlight) return false;  // 朝プランと競合しないよう待つ(既存方針と同じ)
  return placeRecoveryDraftCandidates(today, nowMinutes, { restoreTitles: marker.titles });
}

async function importSleepCsv(file) {
  let records;
  try {
    records = parseSleepCsv(await file.text());
  } catch (e) {
    showToast("CSVの読み込みに失敗しました");
    return;
  }
  // v130: CSVにデータ行が無い(空ファイル・ヘッダー行のみ)場合は、下の「起床時間を読み取れず
  // 全件スキップ」(行はあるがパース失敗)と区別して明確なメッセージを出す。従来は両方とも
  // 「睡眠データを読み取れませんでした」で、原因(ファイルが空/表記が読めない)が分からなかった。
  if (records.length === 0) {
    showToast("睡眠CSVにデータ行がありませんでした(空のファイル、またはヘッダー行のみの可能性があります)");
    return;
  }
  const imported = {};  // 起床日 → ログ。同日複数行(昼寝セッション)は睡眠が長い方を採用
  const skippedWakeValues = [];
  records.forEach((r) => {
    const wakeRaw = r["起床時間"] || "";
    const wake = parseSleepDateTime(wakeRaw);
    if (!wake) { skippedWakeValues.push(wakeRaw); return; }
    const rec = {
      bed: parseSleepTime(r["就寝時間"]),
      wake: wake.time,
      sleepH: hmsToHours(r["睡眠"]),
      inBedH: hmsToHours(r["寝床"]),
      deepH: hmsToHours(r["深さ"]),
      qualityH: hmsToHours(r["質"]),
      eff: sleepNumOrNull(r["効率性"]),
      hrSleep: sleepNumOrNull(r["睡眠心拍数"]),
      hrvSleep: sleepNumOrNull(r["睡眠心拍変動"]),
      spo2Avg: sleepNumOrNull(r["平均SpO2"]),
      importedAt: new Date().toISOString()
    };
    const date = wake.date;
    if (!imported[date] || (rec.sleepH || 0) > (imported[date].sleepH || 0)) imported[date] = rec;
  });
  if (skippedWakeValues.length) console.warn("睡眠CSV: 起床時間を読めずスキップ", skippedWakeValues);
  const dates = Object.keys(imported).sort();
  const count = dates.length;
  if (!count) {
    // v130: ここに到達する時点でrecords.length > 0(空CSVは上で分岐済み)のため、
    // 全行が起床時間パース失敗だったと確定できる。原因を特定できる文言にする。
    showToast(`起床時間を読み取れず全${skippedWakeValues.length}行をスキップしました(表記形式をご確認ください)`);
    return;
  }
  Object.assign(state.sleep.logs, imported);
  const latest = dates[dates.length - 1];
  const range = dates.length === 1 ? shortSleepDate(dates[0]) : `${shortSleepDate(dates[0])}〜${shortSleepDate(latest)}`;
  const skipped = skippedWakeValues.length ? ` / ${skippedWakeValues.length}行をスキップ` : "";
  const missingToday = latest < todayISO() ? " / ⚠️ 今朝の分はCSVにありませんでした" : "";
  saveAndRender(`睡眠ログ ${count}日分(${range})を取り込みました${skipped}${missingToday}`);
}

// v169: hoursLabel/renderSleepCardはsrc/features/journal.jsへ移動した(app.js分割・段階4-3)。

// v142: 日次結合ヘルパー ============================================================
// sleep.logs(実測)/condition.logs(主観)/blocksの実績(着手率・完了数・充放電)を
// dateKeyで突き合わせて1つのオブジェクトに結合する純関数。保存はしない(renderStatsと同じ
// 都度計算思想)。実測と主観は統合しない(現状維持) — 分析側では実測(sleepH)を主とし、
// 欠損時のみ主観(condition.logs.sleepHours、プリセット値)をsleepHFinalへフォールバックする
// (sleepHIsSubjectiveで注釈できるようにする)。
// sleep.logsは起床日をキーに持つため、dateKeyのblocks実績とそのまま組み合わせれば
// 「前夜の睡眠→その日の実績」の対応になる(日付シフト不要)。
// opts.blocksByDate: buildBlocksByDateMap()で事前構築したMapを渡すと、1日ごとの
// state.blocks全走査(O(日数×全Block数))を避けられる(v142、全期間レンジでの一括集計向け)。
// 単発呼び出し(opts省略)は従来どおりstate.blocksをその場でfilterする。
function computeDailyMetrics(dateKey, opts = {}) {
  const sleepLog = state.sleep.logs[dateKey] || null;
  const condLog = state.condition.logs[dateKey] || null;
  const sleepH = sleepLog ? toNumber(sleepLog.sleepH) : null;
  const sleepHoursSubjective = condLog ? toNumber(condLog.sleepHours) : null;

  const dayBlocks = opts.blocksByDate
    ? (opts.blocksByDate.get(dateKey) || [])
    : state.blocks.filter((b) => !b.deleted && b.date === dateKey);
  const plannedBlocks = dayBlocks.filter((b) => b.plannedStartAt);
  const startedCount = plannedBlocks.filter((b) => b.actualStartAt).length;
  const completed = dayBlocks.filter((b) => b.completed);
  const chargeSum = completed.reduce((s, b) => s + Number(b.charge || 0), 0);
  const dischargeSum = completed.reduce((s, b) => s + Number(b.discharge || 0), 0);

  return {
    date: dateKey,
    // 実測(state.sleep.logs)
    bed: sleepLog ? sleepLog.bed || null : null,
    wake: sleepLog ? sleepLog.wake || null : null,
    sleepH,
    eff: sleepLog ? toNumber(sleepLog.eff) : null,
    deepH: sleepLog ? toNumber(sleepLog.deepH) : null,
    hrSleep: sleepLog ? toNumber(sleepLog.hrSleep) : null,
    hrvSleep: sleepLog ? toNumber(sleepLog.hrvSleep) : null,
    // 主観(state.condition.logs)
    sleepHours: sleepHoursSubjective,
    capacity: condLog ? (condLog.capacity ?? null) : null,
    gym: condLog ? (condLog.gym ?? null) : null,
    meds: condLog ? (condLog.meds ?? null) : null,
    // 実測を主・主観をフォールバックとした結合値(欠損時のみ主観を使う。注釈用フラグ付き)
    sleepHFinal: sleepH != null ? sleepH : sleepHoursSubjective,
    sleepHIsSubjective: sleepH == null && sleepHoursSubjective != null,
    // 実績(state.blocks)
    startPct: plannedBlocks.length ? Math.round((startedCount / plannedBlocks.length) * 100) : null,
    startTotal: plannedBlocks.length,
    completedCount: completed.length,
    chargeSum, dischargeSum, net: chargeSum - dischargeSum
  };
}

// v169: renderJournal(+JOURNAL_PROMPTS)はsrc/features/journal.jsへ移動した(app.js分割・段階4-3。
// 冒頭でimportして参照を切り替えた)。

// v92: =========================================================
//  AIレポートビューア — コンテンツ総括・自己分析・基盤ヘルス・週次レビュー・バッチ実行サマリ・
//  英語表現集を「その他 > AIレポート」タブから横断閲覧する。生成は自宅PCのloop側バッチが担い、
//  アプリ側はpersonal-dataリポジトリ(taskchute/直下)のContents API一覧+本文取得のみ。
//  (アプリ内Claude API呼び出しはv60で全廃済み。ここでも新規に増やさない — SKILL.md参照)
// =========================================================
const AI_REPORT_TYPES = [
  { id: "content", label: "コンテンツ総括", prefix: "コンテンツ総括_",
    guide: "ジャーナルの「### 依頼」に「今年一年どう?」のように書くと、不定期または四半期ごとに生成されます" },
  { id: "self", label: "自己分析", prefix: "自己分析_",
    guide: "毎月1日に前月分が自動生成されます" },
  { id: "health", label: "基盤ヘルス", prefix: "基盤ヘルス_",
    guide: "自宅PCの日次バッチが自動生成します。しばらく実行されていない場合は生成されません" },
  { id: "weekly", label: "週次レビュー", prefix: "週次レビュー_",
    guide: "毎週末に自動生成されます(「週次」タブの来週のタスク提案と同じファイルです)" },
  // v110: 自宅PCのloop各バッチ(日報依頼検知・お題提案・コーチング等)の毎朝の実行結果サマリ。
  //       loop/batch-summary.sh が personal-data/taskchute/ へ生成する(K依頼2026-07-16)。
  { id: "batch", label: "バッチ実行サマリ", prefix: "バッチ実行サマリ_",
    guide: "自宅PCの日次バッチ群の実行結果を毎朝自動生成します。しばらく実行されていない場合は生成されません" },
  // v113: 英語ジャーナルのAIフィードバック「💬 使える表現」から loop/english-phrases.sh が
  //       日次で自動統合する表現集。personal-data/taskchute/ へ生成する(K依頼2026-07-16)。
  { id: "english", label: "英語表現集", prefix: "英語表現集_",
    guide: "英語ジャーナルのAIフィードバックから使える表現を毎日自動でまとめます。しばらく実行されていない場合は生成されません" },
  // v159: AI機能3「未来の自分からの手紙」。loop/scripts/future-letter.sh が
  //       personal-data/taskchute/ へ月次で生成する(K依頼2026-07-27)。
  { id: "letter", label: "未来からの手紙", prefix: "未来からの手紙_",
    guide: "毎月「1年後の自分」視点の手紙を自動生成します。しばらく実行されていない場合は生成されません" },
  // v160: AI機能4「言い訳ハンター」。loop/scripts/excuse-ledger.sh(日次・決定論)が
  //       日報の未完了理由・言い訳に相当する箇所を台帳へ蓄積し、loop/scripts/excuse-report.sh
  //       (週次・AI)が personal-data/taskchute/ へパターンのランキングレポートを生成する
  //       (K依頼2026-07-27)。この機能はホーム導線を作らず、既存のAIレポートタブに
  //       相乗りするのみ(K発注仕様「淡々と」)。
  { id: "excuse", label: "言い訳レポート", prefix: "言い訳レポート_",
    guide: "毎週、未完了だったタスクのコメントからパターンを淡々とまとめます。しばらく実行されていない場合は生成されません" }
];

// _aiReportDirCache(taskchute/直下の一覧)から、種類のprefixに合致する.mdファイルを
// 日付降順(新しい順)で返す。一覧未取得ならnullを返し、呼び出し側で読み込みをトリガーさせる。
function aiReportFilesForType(prefix) {
  if (!Array.isArray(_aiReportDirCache)) return null;
  return _aiReportDirCache
    .filter((entry) => entry && entry.type === "file" && entry.name.startsWith(prefix) && entry.name.endsWith(".md"))
    .map((entry) => ({ name: entry.name, date: entry.name.slice(prefix.length, -3) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// v140: report-index.jsonのgeneratedAt("YYYY-MM-DDTHH:mm:ssZ"、UTC)をmsへ変換する。
// localDateTimeToMs(ローカル時刻文字列専用、Zサフィックス無し)とは別に用意する理由:
// あちらはUTC文字列にそのまま使うとローカルタイムゾーン分(日本なら9時間)ズレる。
// new Date(string)は経由せずDate.UTC()の数値コンストラクタで組み立てる
// (iOS Safariのnew Date(string)誤解釈対策と同じ方針。Date.UTCは文字列パースの曖昧さが無い)。
function parseUtcIsoToMs(s) {
  if (!s || typeof s !== "string") return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(s);
  if (!m) return 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

// v138(review.md:31): AIレポート履歴一覧の第1段。loop側 report-index-build.py が生成する
// taskchute/report-index.json(スキーマは{generatedAt, files:[{name,date,kind}]}。契約の詳細は
// FORMAT_CONTRACT.md参照)をfetchする。
// v140(Codexレビュー High-1、3点の堅牢性強化):
//   (i) files配列の各要素はstring型nameを持つものだけ採用し、有効な要素が0件ならindex自体を
//       不採用にする(壊れたindexで履歴が全消えするのを防ぐ)。
//   (ii) generatedAtが現在時刻からREPORT_INDEX_MAX_AGE_MSを超えて古い(≒バッチが長期間止まって
//       いる)場合もindexを不採用にする(古いindexが新着ファイルを覆い隠し続ける事故を防ぐ)。
//       generatedAtが無い/パース不能な場合も同様に不採用とする(鮮度を確認できないため)。
//   (iii) この関数自体はもう_aiReportDirCache/_aiReportDirErrorへ直接触れない(副作用フリー)。
//       手動更新(refreshAiReports)からはfetchPersonalDataDirListと同時に呼ばれ、呼び出し元
//       (triggerAiReportDirLoad)がname単位でunionする。indexが1000件超のディレクトリで
//       一部欠落していても、手動更新時だけはContents APIで即座に補完できる設計。
// 戻り値: 採用可能な{name,type:"file"}配列、または不採用(404/スキーマ不正/0件/古すぎ)ならnull。
const REPORT_INDEX_MAX_AGE_MS = 48 * 60 * 60 * 1000;
async function fetchReportIndex() {
  const result = await fetchGitHubRawResult("report-index.json");
  if (!result.ok) return null;
  let parsed;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return null;  // 壊れたJSON(生成中の書き込み競合等)
  }
  if (!parsed || !Array.isArray(parsed.files)) return null;
  const generatedAtMs = parseUtcIsoToMs(parsed.generatedAt);
  if (!generatedAtMs || Date.now() - generatedAtMs > REPORT_INDEX_MAX_AGE_MS) return null;
  const files = parsed.files
    .filter((f) => f && typeof f.name === "string" && f.name)
    .map((f) => ({ name: f.name, type: "file" }));
  return files.length > 0 ? files : null;
}

// v140: indexFiles([{name,type:"file"}]、report-index.json由来)とdirList
// ([{name,type,path}]、Contents API由来)をname単位でunionする。dirList側を正(type/path等の
// 完全な情報を持つ)とし、dirListに無い名前だけindexFiles側から補う。いずれかがnull/配列以外の
// 場合は無視する(両方失敗の場合は呼び出し元で_aiReportDirCacheへ代入しない=再試行対象に残す)。
function unionAiReportEntries(indexFiles, dirList) {
  const merged = new Map();
  (Array.isArray(dirList) ? dirList : []).forEach((e) => { if (e && e.name) merged.set(e.name, e); });
  (Array.isArray(indexFiles) ? indexFiles : []).forEach((e) => { if (e && e.name && !merged.has(e.name)) merged.set(e.name, e); });
  return [...merged.values()];
}

// v159 2026-07-28レビュー対応・必須修正2: report-index.jsonは日次バッチ(coach-daily.sh)が
// 再生成する索引であり、月次の未来からの手紙_*.mdの新着が同日中に反映されない期間が起こりうる
// (鮮度チェック自体は48時間以内なので通ってしまう=「indexにはまだ載っていないが実際には
// 存在する」状態)。hydrateStaticMarkdown()が直接fetchGitHubRawTextで実在を確認できた月は
// cachedFutureLetterMdに記録済みのため、それをindex/Contents API由来の一覧へunionすることで、
// index側の反映遅延に関わらずAIレポート画面の「未来からの手紙」タブが空にならないようにする
// (今日の敵/勝手に格言は当日限定のホームカード表示のみでAIレポート一覧タブの対象外のため、
// 本unionは未来からの手紙のみを対象とする)。
function knownFutureLetterEntries() {
  return Object.keys(cachedFutureLetterMd)
    .filter((month) => cachedFutureLetterMd[month])
    .map((month) => ({ name: `未来からの手紙_${month}.md`, type: "file" }));
}
function unionKnownFutureLetters(entries) {
  const merged = new Map();
  (Array.isArray(entries) ? entries : []).forEach((e) => { if (e && e.name) merged.set(e.name, e); });
  knownFutureLetterEntries().forEach((e) => { if (!merged.has(e.name)) merged.set(e.name, e); });
  return [...merged.values()];
}

// 一覧の読み込みをトリガーする(多重fetch防止のin-flightガード付き)。完了後、まだ
// AIレポート画面を見ていれば再描画してセレクタ/本文を反映する。
// v138: まずreport-index.json(fetchReportIndex)を試し、無ければ従来のContents API
// ディレクトリ一覧取得(fetchPersonalDataDirList)へフォールバックする2段構成にした。
// v140: 手動更新(_aiReportForceUnionRefresh)時は両方を並行取得しname単位でunionする。
async function triggerAiReportDirLoad() {
  if (_aiReportDirLoadInFlight || _aiReportDirCache) return;
  _aiReportDirLoadInFlight = true;
  const forceUnion = _aiReportForceUnionRefresh;
  _aiReportForceUnionRefresh = false;
  if (forceUnion) {
    const [indexFiles, dirList] = await Promise.all([fetchReportIndex(), fetchPersonalDataDirList()]);
    // dirList取得(fetchPersonalDataDirList)は失敗時に_aiReportDirErrorを自ら立てる。
    // indexFiles/dirListのいずれかが得られていれば、その旨を反映して使える結果として採用する
    // (indexのみ成功・dirListのみ失敗、というケースでエラーバナーが誤って残らないようにする)。
    if (indexFiles || dirList) {
      _aiReportDirCache = unionAiReportEntries(indexFiles, dirList);
      _aiReportDirError = false;
    }
    // 両方nullなら_aiReportDirCacheはnullのままにし、_aiReportDirErrorはfetchPersonalDataDirList
    // 側の失敗パスで既にtrueになっている想定(再試行UIへ委ねる)。
  } else {
    const indexFiles = await fetchReportIndex();
    if (indexFiles) {
      _aiReportDirCache = indexFiles;
      _aiReportDirError = false;
    } else {
      await fetchPersonalDataDirList();  // 内部で_aiReportDirCache/_aiReportDirErrorを設定する(従来どおり)
    }
  }
  // v159 2026-07-28レビュー対応・必須修正2: 一覧を確定させた直後、hydrateStaticMarkdown()の
  // 直接fetchで既に実在を確認済みの未来からの手紙(cachedFutureLetterMd)を必ずunionする
  // (report-index.json由来の一覧が新着分をまだ反映していなくても、タブが空にならないように
  // する自衛策。knownFutureLetterEntries()/unionKnownFutureLetters()参照)。
  if (Array.isArray(_aiReportDirCache)) {
    _aiReportDirCache = unionKnownFutureLetters(_aiReportDirCache);
  }
  _aiReportDirLoadInFlight = false;
  if (state.currentView === "ai-reports") render();
}

// 選択中ファイル本文の読み込みをトリガーする(同上のin-flightガード付き)。
// v137: fetchGitHubRawText(成功/失敗を区別せず空文字を返す)ではなく fetchGitHubRawResult を使う。
//       一過性の取得失敗(401/5xx/ネットワーク例外)を空文字として_aiReportBodyCacheへ書き込むと、
//       renderAiReportBody側の`body === undefined`判定に引っかからなくなり、二度と再取得されない
//       (=空文字の「本文」が表示され続ける)バグがあった。失敗時はキャッシュへ書かず、次回描画で
//       再度triggerAiReportBodyLoadが呼ばれてリトライできるようにする。
async function triggerAiReportBodyLoad(fileName) {
  if (_aiReportBodyLoadInFlight[fileName]) return;
  const failedAt = _aiReportBodyFailedAt[fileName];
  if (failedAt && Date.now() - failedAt < AI_REPORT_BODY_RETRY_COOLDOWN_MS) return;  // 連打防止
  _aiReportBodyLoadInFlight[fileName] = true;
  const result = await fetchGitHubRawResult(fileName);
  if (result.ok) {
    _aiReportBodyCache[fileName] = result.text;
    delete _aiReportBodyFailedAt[fileName];
  } else {
    _aiReportBodyFailedAt[fileName] = Date.now();
  }
  delete _aiReportBodyLoadInFlight[fileName];
  if (state.currentView === "ai-reports") render();
}

// 手動更新ボタン: 一覧キャッシュを破棄し、現在表示中ファイルの本文キャッシュも破棄して
// 再取得させる(rate limit配慮のため、他の種類・日付の本文キャッシュはそのまま残す)。
// v137: 「表示中ファイル」は renderAiReportBody と同じフォールバック(明示選択が無ければ files[0])
//       で決める。以前は _aiReportSelectedDate に明示選択が入っている場合しかinvalidateせず、
//       未選択のまま(=files[0]がそのまま表示されている)状態で更新ボタンを押しても本文キャッシュが
//       残り、内容が更新されていても古い本文が表示され続けるバグがあった。失敗クールダウン
//       (_aiReportBodyFailedAt)も明示的にクリアし、直近失敗直後でも手動更新は即座に再試行する。
function refreshAiReports() {
  const type = AI_REPORT_TYPES.find((t) => t.id === (state.settings.aiReportType || "content")) || AI_REPORT_TYPES[0];
  const filesBefore = aiReportFilesForType(type.prefix);
  const sel = (_aiReportSelectedDate[type.id] && filesBefore && filesBefore.some((f) => f.date === _aiReportSelectedDate[type.id]))
    ? _aiReportSelectedDate[type.id]
    : (filesBefore && filesBefore[0] ? filesBefore[0].date : null);
  if (sel) {
    const fileName = `${type.prefix}${sel}.md`;
    delete _aiReportBodyCache[fileName];
    delete _aiReportBodyFailedAt[fileName];
  }
  _aiReportDirCache = null;
  _aiReportDirError = false;
  // v140(Codexレビュー High-1 (iii)): 手動更新は必ずContents API listingも取得し、
  // report-index.jsonとname単位でunionする(triggerAiReportDirLoad参照)。
  _aiReportForceUnionRefresh = true;
  render();
  showToast("最新の一覧を取得しています…");
}

function renderAiReports() {
  if (!personalDataReady(state.settings.github)) {
    return `
      ${renderHeader("AIが書いた振り返りをまとめて読む", "AIレポート")}
      <div class="panel"><p>設定画面で個人データリポジトリ(Owner/Repository/Token)を接続すると読めます。</p></div>
    `;
  }
  const activeId = state.settings.aiReportType || "content";
  const activeType = AI_REPORT_TYPES.find((t) => t.id === activeId) || AI_REPORT_TYPES[0];
  const refreshBtn = `<button class="btn ghost" data-action="ai-report-refresh">🔄 一覧を更新</button>`;
  return `
    ${renderHeader("AIが書いた振り返りをまとめて読む", "AIレポート", refreshBtn)}
    <div class="segmented">
      ${AI_REPORT_TYPES.map((t) => `
        <button class="${t.id === activeId ? "active" : ""}" data-action="ai-report-type" data-type="${t.id}">${escapeHTML(t.label)}</button>
      `).join("")}
    </div>
    ${renderAiReportBody(activeType)}
  `;
}

function renderAiReportBody(type) {
  if (_aiReportDirError) {
    return `
      <div class="panel">
        <p>⚠ 一覧の取得に失敗しました。通信状況を確認して再試行してください。</p>
        <button class="btn" data-action="ai-report-refresh">再試行</button>
      </div>
    `;
  }
  const files = aiReportFilesForType(type.prefix);
  if (files === null) {
    triggerAiReportDirLoad();
    return `<div class="panel"><p class="muted">読み込み中...</p></div>`;
  }
  if (files.length === 0) {
    return `
      <div class="panel">
        <p>まだ生成されていません。</p>
        <p class="muted" style="font-size:12px">${escapeHTML(type.guide)}</p>
      </div>
    `;
  }
  const selectedDate = (_aiReportSelectedDate[type.id] && files.some((f) => f.date === _aiReportSelectedDate[type.id]))
    ? _aiReportSelectedDate[type.id] : files[0].date;
  const file = files.find((f) => f.date === selectedDate) || files[0];
  const body = _aiReportBodyCache[file.name];
  if (body === undefined) triggerAiReportBodyLoad(file.name);
  return `
    <div class="row" style="margin:10px 0">
      <select data-ai-report-date data-type-id="${type.id}" style="font-size:16px">
        ${files.map((f) => `<option value="${escapeHTML(f.date)}" ${f.date === selectedDate ? "selected" : ""}>${escapeHTML(f.date)}</option>`).join("")}
      </select>
    </div>
    <div class="panel">
      <div class="md-render readonly-md">${body === undefined ? "読み込み中..." : renderMarkdown(body || "（本文を取得できませんでした）")}</div>
    </div>
  `;
}

function renderVision() {
  const section = state.settings.visionSection || "vision";
  return `
    ${renderHeader("方向性を見失わないための場所", "ビジョン")}
    <div class="segmented">
      <button class="${section === "vision" ? "active" : ""}" data-action="vision-section" data-section="vision">ビジョン</button>
      <button class="${section === "affirmation" ? "active" : ""}" data-action="vision-section" data-section="affirmation">アファメーション</button>
      <button class="${section === "board" ? "active" : ""}" data-action="vision-section" data-section="board">ビジョンボード</button>
    </div>
    <div class="vision-stage">
      ${section === "vision" ? renderVisionMd("vision") : ""}
      ${section === "affirmation" ? renderVisionMd("affirmation") : ""}
      ${section === "board" ? renderVisionBoard() : ""}
    </div>
  `;
}

function renderVisionMd(kind) {
  const path = kind === "vision" ? "Vision.md" : "Daily_Affirmation.md";
  const cached = kind === "vision" ? cachedVisionMd : cachedAffirmationMd;
  const rendered = renderMarkdown(cached || "（読み込み中...)");
  return `
    <div class="vision-actions">
      <span class="vision-source">📄 <code>${path}</code></span>
      <button class="btn" data-action="reload-md">最新を取得</button>
      <button class="btn ghost" data-action="open-md-in-github" data-path="${path}">GitHubで編集</button>
    </div>
    <div class="panel">
      <div class="md-render">${rendered}</div>
    </div>
  `;
}

// v85: ビジョンボードPDF(45/80/now)は個人データリポジトリ(taskchute/content/配下)にあり、
// GitHub Pagesの同一オリジンには存在しない(v72の個人データ分離移行時に除去済み)。
// K報告「ビジョンボードが見れない」の原因はこれ — 旧実装が `./now_vision.pdf` という
// 同一オリジン相対パスをそのまま<object>のsrcに使っており、v72後は404で見れなくなっていた
// (Vision.md/Daily_Affirmation.mdはfetchGitHubRawText経由に既に直っていたが、PDF側だけ
// 取り残されていた)。fetchGitHubRawBlob→Blob URL化で埋め込む(personalDataReadyゲート下)。
//
// v101: K報告「PCブラウザでビジョンタブを開くと毎回固まる」の修正。
// 原因(現物調査): タブ切替のたびにv85実装の `ensureVisionPdfLoaded()` が自動fetchし、
// 取得完了後は無条件で `<object data="blob:...">` にインライン埋め込んでいた。実データの
// 80_vision.pdfは約18MB(45_vision.pdf=3.4MB / now_vision.pdf=3.6MBに対し突出)。
// Playwright+実Chromiumで18MB相当のPDF(1ページ・高解像度画像埋め込み)を使い、ビジョンタブを
// 開いた瞬間からのメインスレッド応答性をハートビート計測(15ms間隔tick)で調べたところ、
// 本体アプリのJSメインスレッド自体の目立った長時間ブロックは確認できなかった(最大tick間隔
// 145.6ms、タブ切替クリック→UI反映239ms)。つまりブロッキングはこのタブ内のJS実行ではなく、
// `<object>` が起動するブラウザ内蔵PDFビューア(別プロセス/別レンダラ)側の大容量ページ描画に
// あり、それがSPA自身のタブの描画・入力キューと競合して「固まる」体感を生んでいると判断した
// (JS heapは正常なのに画面全体が無応答に見える症状と整合)。
// 対策: 自動fetch・自動インライン埋め込みをやめ、「読み込む」ボタンの明示クリックでのみfetchし、
// 取得後も<object>では埋め込まず実アンカー(<a target="_blank">、v85から既存の「別タブで開く」
// と同じ仕組み)経由でブラウザ本来の独立したPDFビューア(別タブ)に描画を完全に委ねる形に変えた。
// これによりSPA本体のタブは重いPDF描画と一切競合しなくなる。UX変更点: 従来は自動でPDFが
// インライン表示されていたが、v101からは「① 読み込む→② 別タブで開く」の2クリックが必要になる
// (詳細はCHANGES_v101.md)。
//
// v125: 「別タブに飛ばさず同一画面内で見たい」というK要望への対応。ただしv85/v101の教訓上、
// PDFそのものの<object>/<iframe>インライン埋め込みには戻さない(重いPDF描画とSPA本体タブの
// 描画・入力キューが競合してブラウザが固まる問題が再発するため)。かわりに各PDFを事前にページ
// 画像(JPEG)へ変換したものを personal-data リポジトリ taskchute/content/vision-pages/ に配置し
// (manifest.jsonでファイル一覧を管理)、アプリ側は軽量な画像を<img>として同一画面に並べる。
// 画像なら<object>のような専用ビューアプロセスを起動せずブラウザの通常の画像デコード/描画
// パイプラインで表示できるため、v101が回避した「固まる」問題を作らずに同一画面内表示が実現できる。
// 原本PDFの「別タブで開く」導線(v101方式)は補助として残す(画像化ミス等の保険、UI上は控えめに)。
function renderVisionBoard() {
  const boards = [
    { name: "今(33歳)", file: "now_vision.pdf" },
    { name: "45歳", file: "45_vision.pdf" },
    { name: "80歳", file: "80_vision.pdf" }
  ];
  const idx = clamp(state.settings.visionBoardIndex || 0, 0, boards.length - 1);
  const current = boards[idx];
  const tabs = `
    <div class="vision-pdf-tabs">
      ${boards.map((b, i) => `
        <button class="${i === idx ? "active" : ""}" data-action="vision-board-tab" data-index="${i}">${escapeHTML(b.name)}</button>
      `).join("")}
    </div>
  `;
  if (!personalDataReady(state.settings.github)) {
    return `
      ${tabs}
      <div class="panel"><p>設定画面で個人データリポジトリ(Owner/Repository/Token)を接続すると、ビジョンボードを読み込めます。</p></div>
    `;
  }
  // v125: 初回はページ画像一覧(manifest.json)だけを軽量fetchする。失敗時は従来のPDF別タブ方式へ。
  if (_visionManifest === null && !_visionManifestFailed) loadVisionManifest();
  if (_visionManifestFailed) return `${tabs}${renderVisionBoardPdfFallback(current)}`;
  if (_visionManifest === null) {
    return `${tabs}<div class="panel" style="padding:24px; text-align:center"><p>確認中...</p></div>`;
  }
  return `${tabs}${renderVisionBoardImages(current)}`;
}

// v125: manifest.jsonに載っているページ画像を<img>で同一画面に並べる(縦スクロール)。
// 「読み込む」明示クリックまでは何もfetchしない(v101の「多重fetch・自動fetch防止」方針を踏襲)。
function renderVisionBoardImages(current) {
  const entry = _visionManifest[current.file];
  if (!entry || !Array.isArray(entry.files) || !entry.files.length) {
    // manifestにこのボードのエントリが無い(想定外データ) → PDF別タブ方式へフォールバック
    return renderVisionBoardPdfFallback(current);
  }
  const files = entry.files;
  // v125追補(Codex P2): 「まだ何も試していない」かどうかの判定は成功キャッシュだけでなく
  // 失敗フラグも含める必要がある。失敗のみ(成功0件)の場合、修正後はloadVisionBoardImages完了時に
  // loading=falseへ戻るため、anyCachedだけで判定すると「未着手」の初期読み込みボタン画面に
  // 逆戻りしてしまい、再読み込みボタンへ辿り着けなくなる(全滅ケースで固まって見える問題の一部)。
  const anyAttempted = files.some((f) => cachedVisionPageUrls[f] || _visionPageFailed[f]);
  const loading = !!_visionPageLoadInFlight[current.file];
  const pdfSrc = cachedVisionPdfUrls[current.file] || "";
  const pdfLoading = !!_visionPdfLoadInFlight[current.file];
  const pdfLink = pdfSrc
    ? `<a class="vision-pdf-fallback-link" href="${pdfSrc}" target="_blank" rel="noopener">📂 原本PDFを別タブで開く</a>`
    : `<button class="vision-pdf-fallback-link" data-action="vision-board-load" data-file="${escapeHTML(current.file)}">📂 ${pdfLoading ? "原本PDFを読み込み中..." : "原本PDFを別タブで開く"}</button>`;

  if (!anyAttempted && !loading) {
    return `
      <div class="vision-actions" style="margin-bottom:8px"><span class="vision-source">📄 <code>${current.file}</code>${files.length > 1 ? `(${files.length}ページ)` : ""}</span></div>
      <div class="panel" style="padding:24px; text-align:center">
        <p class="muted" style="margin-bottom:12px">画像として読み込みます。</p>
        <button class="btn primary" data-action="vision-board-load-images" data-file="${escapeHTML(current.file)}">📥 読み込む</button>
      </div>
      <p style="text-align:center; margin-top:12px">${pdfLink}</p>
    `;
  }

  const pages = files.map((f, i) => {
    const src = cachedVisionPageUrls[f];
    const label = files.length > 1 ? `<div class="vision-page-label">${i + 1} / ${files.length}</div>` : "";
    if (src) {
      return `
        <div class="vision-page">
          <img src="${src}" alt="${escapeHTML(current.name)} ${i + 1}ページ目" loading="lazy" />
          ${label}
        </div>
      `;
    }
    // v125追補(Codex P2): このページの取得が既に失敗している場合は「読み込み中...」のまま
    // 固定表示せず、再試行できる「再読み込み」ボタンを出す(ボード単位の再fetchで残り全ページを
    // 対象にする。成功済みページはキャッシュ済みなので再fetchされない)。
    if (_visionPageFailed[f]) {
      return `
        <div class="vision-page vision-page-placeholder vision-page-failed">
          <p class="muted" style="margin-bottom:8px">この画像の読み込みに失敗しました</p>
          <button class="btn" data-action="vision-board-retry-images" data-file="${escapeHTML(current.file)}">🔄 再読み込み</button>
          ${label}
        </div>
      `;
    }
    return `
      <div class="vision-page vision-page-placeholder">
        <p class="muted">読み込み中...</p>
        ${label}
      </div>
    `;
  }).join("");

  return `
    <div class="vision-actions" style="margin-bottom:8px"><span class="vision-source">📄 <code>${current.file}</code></span></div>
    <div class="vision-pages">${pages}</div>
    <p style="text-align:center; margin-top:16px">${pdfLink}</p>
  `;
}

// v101方式(PDFを丸ごとBlob化して別タブで開く)。v125からは (a) manifest.json自体の取得/パース失敗時、
// (b) manifestに該当ボードのエントリが無い想定外データ時、の2ケースでのみ使うフォールバック表示。
function renderVisionBoardPdfFallback(current) {
  const src = cachedVisionPdfUrls[current.file] || "";
  const loading = !!_visionPdfLoadInFlight[current.file];
  if (!src) {
    return `
      <div class="vision-actions" style="margin-bottom:8px"><span class="vision-source">📄 <code>${current.file}</code></span></div>
      <div class="panel" style="padding:24px; text-align:center">
        ${loading
          ? `<p>読み込み中...</p>`
          : `<p class="muted" style="margin-bottom:12px">サイズの大きいPDFのため、タブを開いただけでは読み込みません。</p>
             <button class="btn primary" data-action="vision-board-load" data-file="${escapeHTML(current.file)}">📥 このPDFを読み込む</button>`}
      </div>
    `;
  }
  return `
    <div class="vision-actions" style="margin-bottom:8px">
      <span class="vision-source">📄 <code>${current.file}</code></span>
      <a class="btn primary" href="${src}" target="_blank" rel="noopener">📂 別タブで開く</a>
    </div>
    <div class="panel" style="padding:24px; text-align:center">
      <p>読み込み済みです。上の <strong>「📂 別タブで開く」</strong> から表示してください
      (別タブのブラウザ内蔵ビューアに描画を任せることで、このアプリ自体が固まるのを防いでいます)。</p>
    </div>
  `;
}

// v101: personal-data から取得したPDFをBlob URL化してキャッシュする(1ファイル1回だけfetch)。
// v85と異なりタブを開いただけでは呼ばれず、「読み込む」ボタンの明示クリック
// (data-action="vision-board-load")からのみ呼ばれる。取得後、ビジョンボードを
// 開いたままなら再描画して「別タブで開く」ボタンへ切り替える(未取得中の再renderは何もしない)。
function loadVisionBoardPdf(file) {
  if (!file || cachedVisionPdfUrls[file] || _visionPdfLoadInFlight[file]) return;
  if (!personalDataReady(state.settings.github)) return;
  _visionPdfLoadInFlight[file] = true;
  render();  // 「読み込み中...」表示への切替
  fetchGitHubRawBlob(`content/${file}`)
    .then((blob) => {
      if (blob) {
        cachedVisionPdfUrls[file] = URL.createObjectURL(blob);
      } else {
        showToast("PDFの取得に失敗しました");
      }
    })
    .catch((error) => {
      console.warn("ビジョンボードPDFの取得に失敗:", error?.message || error);
      showToast("PDFの取得に失敗しました");
    })
    .finally(() => {
      _visionPdfLoadInFlight[file] = false;
      if (state.currentView === "vision" && (state.settings.visionSection || "vision") === "board") render();
    });
}

// v125: ビジョンボードのページ画像一覧(manifest.json)を軽量fetchする。テキストなので
// fetchGitHubRawText経由(PDF本体のfetchGitHubRawBlobとは別経路)。取得失敗/パース失敗時は
// _visionManifestFailed=true にして、以降は従来のPDF別タブ方式(renderVisionBoardPdfFallback)
// へ恒久的にフォールバックする(再訪問のたびに再試行はしない。personalDataReadyな限り
// manifest.jsonは配置済み前提のファイルのため、失敗は「今回だけ読めなかった」ではなく
// 「画像化されていない/経路が壊れている」と見なす)。
function loadVisionManifest() {
  if (_visionManifest !== null || _visionManifestFailed || _visionManifestLoadInFlight) return;
  if (!personalDataReady(state.settings.github)) return;
  _visionManifestLoadInFlight = true;
  fetchGitHubRawText("content/vision-pages/manifest.json")
    .then((text) => {
      if (!text) { _visionManifestFailed = true; return; }
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") {
          _visionManifest = parsed;
        } else {
          _visionManifestFailed = true;
        }
      } catch (error) {
        console.warn("ビジョンボードmanifest.jsonのパースに失敗:", error?.message || error);
        _visionManifestFailed = true;
      }
    })
    .catch((error) => {
      console.warn("ビジョンボードmanifest.jsonの取得に失敗:", error?.message || error);
      _visionManifestFailed = true;
    })
    .finally(() => {
      _visionManifestLoadInFlight = false;
      if (state.currentView === "vision" && (state.settings.visionSection || "vision") === "board") render();
    });
}

// v125: 選択中ボードのページ画像を「読み込む」明示クリックから順次fetchする(1ファイル1回だけ)。
// 80歳版のように複数ページある場合も Promise.all で一斉取得せず、1枚ずつ await して取得完了の
// たびに再描画する — 1ページ目から順に表示が始まり、全ページ完了を待たせない(要件どおり)。
// v125追補(Codex P2対応): (1) 一部ページのfetch失敗を_visionPageFailedで追跡し、失敗ページは
// 「読み込み中...」に固定せず再読み込みボタンへ切り替える。(2) 「読み込む」ボタン初回クリックと
// 「再読み込み」ボタンのretryは同じこの関数を呼ぶだけでよい — cachedVisionPageUrlsに無いページ
// (=未取得 or 前回失敗)だけをループが再fetch対象にするため、成功済みページは再fetchされない。
// (3) 全ページ失敗時にビューが「読み込み中...」のまま固まらないよう、in-flightフラグを
// クリアした**後**に最終renderを必ず1回追加した(従来はループ最後の差し込みrenderがフラグ
// クリア前に走っており、loading=trueのまま再描画が起きず固まって見えていた)。
function loadVisionBoardImages(file) {
  const entry = file && _visionManifest && _visionManifest[file];
  if (!entry || !Array.isArray(entry.files) || !entry.files.length) return;
  if (_visionPageLoadInFlight[file]) return;
  if (!personalDataReady(state.settings.github)) return;
  const files = entry.files;
  if (files.every((f) => cachedVisionPageUrls[f])) return;  // 全ページ取得済み
  _visionPageLoadInFlight[file] = true;
  render();  // 「読み込み中...」プレースホルダへの切替
  (async () => {
    for (const pageFile of files) {
      if (cachedVisionPageUrls[pageFile]) continue;  // 既にキャッシュ済み(タブ往復後の再訪問等)
      delete _visionPageFailed[pageFile];  // 再試行(1回目の挑戦含む)のたびに前回の失敗表示をクリア
      try {
        const blob = await fetchGitHubRawBlob(`content/vision-pages/${pageFile}`);
        if (blob) {
          cachedVisionPageUrls[pageFile] = URL.createObjectURL(blob);
        } else {
          _visionPageFailed[pageFile] = true;
          showToast(`ビジョンボード画像の取得に失敗しました(${pageFile})`);
        }
      } catch (error) {
        _visionPageFailed[pageFile] = true;
        console.warn("ビジョンボード画像の取得に失敗:", error?.message || error);
        showToast(`ビジョンボード画像の取得に失敗しました(${pageFile})`);
      }
      // 取得完了ごとに差し込み表示(全ページ完了を待たせない)。この時点ではまだ
      // _visionPageLoadInFlight[file]はtrueのまま(ループ途中の一時render)。
      if (state.currentView === "vision" && (state.settings.visionSection || "vision") === "board") render();
    }
    _visionPageLoadInFlight[file] = false;
    // ループ完了後、in-flightフラグをクリアしてから最終renderを必ず行う。
    // これが無いと、最後のページが失敗で終わった場合に直前のrender()がloading=trueのまま
    // 描画してしまい、以降renderが呼ばれず「読み込み中...」のまま固まって見える(Codex P2指摘)。
    if (state.currentView === "vision" && (state.settings.visionSection || "vision") === "board") render();
  })();
}

// v37: marked の出力から危険な要素・属性を取り除く。
//      ジャーナルやAIフィードバック(貼り付け/アップロード/GitHub同期)経由の
//      HTMLがそのまま実行されると、localStorage のトークン窃取まで可能になるため。
//      見出し・リスト・強調などの安全なHTMLはそのまま残す。
// v137(review.md:35): XSS否定テスト追加時に発見した2件の穴を塞いだ(いずれも本アプリの
// 実際の挿入経路=ライブ要素へのinnerHTML代入では実行はされない=実XSSではないと確認済みだが、
// サニタイザ自体の契約(危険な要素・属性を取り除く)としては穴だったため、安全側に倒して修正):
//   (1) el.tagName はSVG名前空間の要素だと大文字正規化されない(例: <svg><script>...</script></svg>
//       のtagNameは"script"であって"SCRIPT"ではない)ため、BLOCKED_TAGSの大文字比較をすり抜けて
//       いた。tagNameを大文字化してから比較するよう修正。
//   (2) javascript: スキームの検知が href/src/xlink:href の3属性限定だったため、
//       style="background:url(javascript:...)" のような他属性経由の混入を見逃していた。
// v140(Codexレビュー Low-5/Low-6、v137の(2)を精緻化):
//   Low-5: v137で(2)への対応として全属性を走査対象にしたが、これはtitle等の正当なテキスト
//     属性(例: title="Java Script: overview")まで「javascript:を含む」として属性ごと
//     消してしまう過剰検知だった。URL系属性(href/src/xlink:href/action/formaction)と
//     style属性だけに走査対象を戻した(on*属性の検知は従来どおり全属性が対象のまま)。
//   Low-6: data: スキームの扱いを属性ごとに分ける。href/xlink:hrefはdata:を全面拒否
//     (data:text/htmlのようなナビゲーション用途はここにしか出てこない)。srcはdata:image/
//     (png|jpeg|gif|webp)のみ許可し、それ以外(data:image/svg+xml等。SVG内に<script>を
//     埋め込めるため個別に拒否)は拒否する。
const SANITIZE_URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction"]);
const SANITIZE_SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpeg|gif|webp)[;,]/;
function sanitizeHTML(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const BLOCKED_TAGS = ["SCRIPT", "IFRAME", "OBJECT", "EMBED", "STYLE", "LINK", "META", "FORM", "BASE"];
  const walk = (node) => {
    for (const el of [...node.querySelectorAll("*")]) {
      if (BLOCKED_TAGS.includes(el.tagName.toUpperCase())) { el.remove(); continue; }
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const val = String(attr.value || "").replace(/\s+/g, "").toLowerCase();
        if (name.startsWith("on")) { el.removeAttribute(attr.name); continue; }        // onerror= 等
        if (name === "style") {
          if (val.includes("javascript:")) el.removeAttribute(attr.name);
          continue;
        }
        if (!SANITIZE_URL_ATTRS.has(name)) continue;  // URL系属性以外はjavascript:/data:検知の対象外
        if (val.includes("javascript:")) { el.removeAttribute(attr.name); continue; }
        if (val.startsWith("data:")) {
          const allowed = name === "src" && SANITIZE_SAFE_DATA_IMAGE_RE.test(val);
          if (!allowed) el.removeAttribute(attr.name);
        }
      }
    }
  };
  walk(template.content);
  return template.innerHTML;
}

// v83: UX監査B8 — renderMarkdownの結果メモ化。
// ジャーナル/ホーム「AIから」/日報タブは再描画(完了トグル1回等)のたびに前日分まで
// marked.parse→sanitizeHTMLを再実行していた(B7と重複する無駄な再計算)。
// 入力テキストそのものをキー、サニタイズ済みHTMLを値とする単純キャッシュで再計算を避ける。
// cachedFeedback[date]は新着fetchで文字列自体が変わるため、キーが変わり自然に新規parseされる
// (=明示的invalidationは不要)。上限件数を超えたら最も古く触っていないものから捨てる(簡易LRU)。
const MARKDOWN_RENDER_CACHE_LIMIT = 50;
const markdownRenderCache = new Map();

function renderMarkdown(text) {
  const key = text || "";
  if (markdownRenderCache.has(key)) {
    const cached = markdownRenderCache.get(key);
    // Map挿入順=最終アクセス順として使うため、ヒット時は末尾へ移動(簡易LRU)
    markdownRenderCache.delete(key);
    markdownRenderCache.set(key, cached);
    return cached;
  }
  const html = renderMarkdownUncached(key);
  markdownRenderCache.set(key, html);
  if (markdownRenderCache.size > MARKDOWN_RENDER_CACHE_LIMIT) {
    const oldestKey = markdownRenderCache.keys().next().value;
    markdownRenderCache.delete(oldestKey);
  }
  return html;
}

function renderMarkdownUncached(text) {
  if (typeof window.marked === "undefined") {
    return `<pre style="white-space:pre-wrap; font-family:inherit">${escapeHTML(text)}</pre>`;
  }
  try {
    return sanitizeHTML(window.marked.parse(text || "", { breaks: true, gfm: true }));
  } catch {
    return `<pre style="white-space:pre-wrap; font-family:inherit">${escapeHTML(text)}</pre>`;
  }
}

function renderReports() {
  const report = state.reports[state.selectedDate] || "";
  // v75: 日報を書く前に前日のAIフィードバックを参照できるよう、既定closedのdetailsで表示する
  //      (フェイルソフト: 無ければ何も出さない)。読み取り経路は「AIから」カードと同じcachedFeedback。
  const prevDate = addDays(state.selectedDate, -1);
  const prevFb = cachedFeedback[prevDate] || state.feedback[prevDate] || "";
  const prevFeedbackHTML = prevFb ? `
    <details class="report-prev-feedback" style="margin-bottom:12px">
      <summary class="muted" style="cursor:pointer; font-size:12px; font-weight:600">🤖 前日(${escapeHTML(prevDate)})のAIフィードバックを見る</summary>
      <div class="md-render readonly-md" style="margin-top:8px">${renderMarkdown(prevFb)}</div>
    </details>` : "";
  return `
    ${renderHeader("生成AIへ渡す素材", "日報")}
    ${renderDateBar()}
    ${prevFeedbackHTML}
    <div class="field" style="margin-bottom:10px">
      <label class="field-label">今日AIに聞きたいこと(任意・1行)</label>
      <input class="input" id="reportAskInput" style="font-size:16px" placeholder="例: 来週の12WY目標、このペースで間に合いそう?">
      <div class="muted" style="font-size:11px; margin-top:4px">日報生成時に「## AIへの質問」節として日報へ加わり、翌朝のAIコーチングが冒頭で回答します。空欄なら節ごと省略されます。</div>
    </div>
    <div class="row" style="margin-bottom:12px; flex-wrap:wrap; gap:8px">
      <button class="btn primary" data-action="generate-report">日報を生成</button>
      ${report ? `<button class="btn" data-action="report-copy-ai">📋 AI用にコピー</button>` : ""}
      ${report && typeof navigator !== "undefined" && navigator.share ? `<button class="btn" data-action="report-share-ai">↗ 共有</button>` : ""}
      <button class="btn" data-action="download-report">Markdown保存</button>
    </div>
    ${report ? `<div class="muted" style="font-size:11.5px; margin-bottom:10px; line-height:1.6">コピー/共有で外部AIへ渡し、返信はジャーナルの「AIフィードバック」欄に貼り付け(または .md アップロード)で取り込めます。</div>` : ""}
    <textarea class="textarea report-output" readonly>${escapeHTML(report || "まだ日報がありません。")}</textarea>
  `;
}

// v148(UI改善計画Phase3-2): 設定13パネルを目的別4群のdetails(既定閉、homeFoldSection流用)へ。
// 既定open判定は群ごとに1つだけ持つ(現在「異常」を検出できるのはデータと同期のsyncAlertMessage()
// のみ。他3群は判定材料が無いため既定false=閉。将来異常検出を増やす場合はここへ足す)。
function renderSettingsProfilePanel() {
  return `
    <h3>プロフィール</h3>
    <label>生年月日
      <input class="input" type="date" data-setting-field="birthDate" value="${escapeHTML(state.settings.birthDate || "")}">
    </label>
    <label>12WY開始日
      <input class="input" type="date" data-setting-field="twelveWeekStartDate" value="${state.settings.twelveWeekStartDate || todayISO()}">
    </label>
  `;
}

function renderSettingsBufferPanel() {
  return `
    <h3>⏳ 1日バッファ</h3>
    <div class="muted" style="font-size:12px; line-height:1.6">
      個々のBlockの見積もりに余裕を足さず、1日の終わりに置く「バッファ」1つに余裕を
      集約します(クリティカルチェーン法)。ヘッダーの「バッファ残量」は今日を表示中の
      ときだけ出ます。0以下にすると未設定扱いになり、メーターは表示されません。
    </div>
    <label>バッファサイズ(分)
      <input class="input" type="number" min="0" step="5" data-setting-dailybuffermin
        value="${Number.isFinite(state.settings.dailyBufferMin) ? state.settings.dailyBufferMin : ""}">
    </label>
    <label>1日の締め時刻(0時から何時間後。既定24=24:00/翌0時)
      <input class="input" type="number" min="1" step="0.5" data-setting-dayclosehours
        value="${Number.isFinite(state.settings.dayCloseHours) ? state.settings.dayCloseHours : ""}">
    </label>
    <div class="muted" style="font-size:11px; line-height:1.6">
      締め時刻は「計画過積載ガード」(その日最初の予定Blockの開始時刻〜締め時刻の枠に
      見積合計+バッファが収まらない場合の警告)にのみ使います。タスクの自動削除・
      移動・並べ替えはしません(気づきの提示のみ)。
    </div>
  `;
}

function renderSettingsBatteryPanel() {
  return `
    <h3>🔋 エネルギーバッテリー</h3>
    <div class="muted" style="font-size:12px; line-height:1.6">
      朝の残量が時間とともに自動で減り、完了Blockの充電/放電で増減します(通知・アラートは
      出しません。表示だけで「回復させないと」に気づくための計器です)。開始値は体力予算
      (🔋体力予算チップ)の判定に連動します。
    </div>
    <label>開始値・体力予算「赤字」の日(0〜200)
      <input class="input" type="number" min="0" max="200" step="1" data-setting-battery-field="start.deficit"
        value="${state.settings.battery.start.deficit}">
    </label>
    <label>開始値・体力予算「低予算」の日(0〜200)
      <input class="input" type="number" min="0" max="200" step="1" data-setting-battery-field="start.low"
        value="${state.settings.battery.start.low}">
    </label>
    <label>開始値・体力予算「通常」の日(睡眠データ無しの日もこれ、0〜200)
      <input class="input" type="number" min="0" max="200" step="1" data-setting-battery-field="start.normal"
        value="${state.settings.battery.start.normal}">
    </label>
    <label>減衰率(1時間あたり、0以上)
      <input class="input" type="number" min="0" step="0.5" data-setting-battery-field="decayPerHour"
        value="${state.settings.battery.decayPerHour}">
    </label>
    <label>減衰開始時刻(既定07:00)
      <input class="input" type="time" step="300" data-setting-battery-field="decayStartMinutes"
        value="${minutesToTimeInputValue(state.settings.battery.decayStartMinutes)}">
    </label>
    <label>残量の上限(1以上)
      <input class="input" type="number" min="1" step="1" data-setting-battery-field="max"
        value="${state.settings.battery.max}">
    </label>
    <label class="checkbox-line">
      <input type="checkbox" data-setting-battery-recoverydraft ${state.settings.battery.recoveryDraft ? "checked" : ""}>
      🔋 残量低下時に回復Blockを下書き提案する(既定OFF)
    </label>
    <label>提案する残量のしきい値(開始値に対する%、既定40)
      <input class="input" type="number" min="1" max="100" step="1" data-setting-battery-field="recoveryThresholdPct"
        value="${state.settings.battery.recoveryThresholdPct}">
    </label>
    <div class="muted" style="font-size:11px; line-height:1.6">
      ONの場合、当日の残量がこのしきい値を下回った時点で1日1回、直近4週の実績で充電効果
      (充電−放電の中央値)が高いBlockを1〜2件、タイムラインの下書きへ静かに配置します
      (通知・アラートは出しません)。承認/個別却下/ドラッグ調整/一括確定は既存の下書き
      バーの操作(📋 下書きスケジュールと同じ)をそのまま使います。
    </div>
  `;
}

function renderSettingsDataPanel() {
  return `
    <h3>データ</h3>
    <button class="btn primary" data-action="download-data">JSONエクスポート</button>
    <label class="btn" style="text-align:center">
      JSONインポート
      <input id="importData" type="file" accept="application/json" hidden>
    </label>
    <button class="btn danger" data-action="reset-demo">デモデータに戻す</button>
    <div style="border-top:1px solid var(--line); padding-top:10px">
      <div style="font-weight:700; font-size:13.5px; margin-bottom:6px">📦 アーカイブ(容量対策)</div>
      <div class="muted" style="font-size:11.5px; line-height:1.7">
        端末内データ: <b>${stateSizeLabel()}</b>(localStorage の目安上限 約5MB)<br>
        ${ARCHIVE_TEXT_KEEP_DAYS}日より古い日報・AIフィードバック・ジャーナルと、${ARCHIVE_BLOCK_KEEP_DAYS}日より古いBlockを
        <code>archive/archive-年.json</code> へ退避して本体を軽く保ちます。退避分は横断検索の「アーカイブも検索」から読めます。
        ${state.settings.lastArchivedAt ? `<br>最終アーカイブ: ${state.settings.lastArchivedAt.replace("T", " ")}` : ""}
      </div>
      <label class="checkbox-line">
        <input type="checkbox" data-setting-autoarchive ${state.settings.autoArchive ? "checked" : ""}>
        自動アーカイブ(1日1回、GitHub保存の書き込み成功後にのみ削除)
      </label>
      <button class="btn" data-action="run-archive" style="margin-top:6px">今すぐアーカイブ</button>
    </div>
  `;
}

function renderSettingsCloudPanel(github) {
  return `
    <h3>クラウド保存(個人データリポジトリ)</h3>
    <div class="muted" style="font-size:12px; line-height:1.6">
      個人データ(app-state.json・日報・AIフィードバック・AIプラン・週次レビュー・AI作業結果・
      Vision/Affirmation)は、あなた専用の <b>private</b> GitHubリポジトリの <code>taskchute/</code> 配下に
      Contents API 経由で保存します(v72。旧・同一オリジンfetchへのフォールバックはありません)。<br>
      自動保存を ON にすると変更後 30 秒で push。起動時に GitHub 側が新しければ自動で取り込みます(新しい方を採用)。
    </div>
    <form class="stack" autocomplete="on" onsubmit="return false">
      <label>Owner
        <input class="input" data-github-field="dataOwner" value="${escapeHTML(github.dataOwner || "")}"
          id="gh-owner" name="gh-username" autocomplete="username"
          autocapitalize="off" autocorrect="off" spellcheck="false">
      </label>
      <label>Repository
        <input class="input" data-github-field="dataRepo" value="${escapeHTML(github.dataRepo || "")}" autocomplete="off" placeholder="personal-data">
      </label>
      <label>Branch
        <input class="input" data-github-field="branch" value="${escapeHTML(github.branch)}" autocomplete="off">
      </label>
      <label>保存先ファイル名(taskchute/配下。taskchute/は自動付与されるため入力不要)
        <input class="input" data-github-field="path" value="${escapeHTML(github.path)}" autocomplete="off" placeholder="app-state.json(taskchute/は付けない)">
      </label>
      <div class="muted" style="font-size:11px">推奨: <code>app-state.json</code>(taskchute/ は自動で付くので<b>ここには含めないでください</b>。実際の保存先は <code>taskchute/app-state.json</code>)</div>
      <label>Fine-grained token
        <input class="input" type="password" data-github-field="token" value="${escapeHTML(github.token)}"
          id="gh-token" name="gh-token" autocomplete="current-password"
          autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="GitHub token">
      </label>
      <div class="muted" style="font-size:11px; line-height:1.6">
        🔑 Owner と Token を入力すると、iOS が「パスワードを保存」を提案します。保存すると次回から
        <b>タップで自動入力</b>でき、iCloud キーチェーン経由で他の Apple 端末にも同期されます
        (トークンは端末内の安全な保管庫にのみ保存され、GitHub には送られません)。
      </div>
    </form>
    <label class="checkbox-line">
      <input type="checkbox" data-github-field="autoSave" ${github.autoSave ? "checked" : ""}>
      自動保存を有効にする(変更後 30 秒のデバウンス)
    </label>
    <div class="muted" data-auto-save-status style="font-size:12px">
      ${github.lastSavedAt ? `最終保存: ${github.lastSavedAt.replace("T", " ")}` : (github.autoSave ? "自動保存: 有効(まだ保存していません)" : "自動保存: 無効")}
    </div>
    <label class="checkbox-line">
      <input type="checkbox" data-setting-autosync ${state.settings.autoSync ? "checked" : ""}>
      🔄 自動同期(push 3分デバウンス + 起動/復帰時に pull)
    </label>
    <div class="muted" style="font-size:11px; line-height:1.7">
      ${state.settings.autoSync ? `<span class="sync-dot ${syncDotClass()}"></span> 有効` : "無効(既定)"}
      ${state.settings.github.lastSavedAt ? ` ・ 最終push: ${state.settings.github.lastSavedAt.replace("T", " ")}` : ""}
      ${state.settings.lastPulledAt ? ` ・ 最終pull: ${state.settings.lastPulledAt.replace("T", " ")}` : ""}
      <br>競合(両方に未反映の変更)時は自動適用せず、手動判断に委ねます。
    </div>
    <div class="muted" style="font-size:11px; line-height:1.7">
      この端末: ${getLastSyncPushAt() ? `push成功 ${getLastSyncPushAt().replace("T", " ").slice(0, 16)}` : "push成功 記録なし"}
      ・ ${getLastSyncPullAt() ? `pull成功 ${getLastSyncPullAt().replace("T", " ").slice(0, 16)}` : "pull成功 記録なし"}
    </div>
    <div class="row">
      <button class="btn primary" data-action="save-github">今すぐGitHubへ保存</button>
      <button class="btn" data-action="load-github">GitHubから読込</button>
    </div>
    <div class="muted" style="font-size:11px">TokenはGitHubへ保存しません。この端末のブラウザ内(＋任意でiOSキーチェーン)だけに保持します。</div>
    <button class="btn" data-action="open-backup-list">📦 バックアップ世代から復元</button>
    <div class="muted" style="font-size:11px; line-height:1.6">
      GitHub保存時に1日1回、<code>backups/app-state-日付.json</code> の日次スナップショットを自動で残します(直近14日分)。
      誤った同期で上書きしてしまった時は、ここから任意の日の状態に戻せます。
    </div>
  `;
}

function renderSettingsMorningPlanPanel() {
  return `
    <h3>朝の一括プランニング</h3>
    <div class="muted" style="font-size:12px; line-height:1.6">
      v60でアプリ内からのClaude API直接呼び出しは廃止しました(コスト理由)。「📋 下書きスケジュール」
      「🌅 朝プラン」は、繰越・WBS・MIT候補を空き時間へ機械的に前詰め配置する決定論ロジックで動作します
      (APIキーは不要)。AI活用は自宅PCのバッチ処理からのファイル連携(下記AIフィードバック欄)に限定しています。
    </div>
    <label class="checkbox-line">
      <input type="checkbox" data-ai-automorningplan ${state.settings.ai?.autoMorningPlan ? "checked" : ""}>
      🌅 朝の一括プランニングを自動実行(10:00までの初回起動で当日の予定が空なら、繰越+WBS+MITの下書きを自動配置)
    </label>
  `;
}

function renderSettingsExecPanel() {
  return `
    <h3>実行</h3>
    <div class="muted" style="font-size:12px; line-height:1.6">
      Blockを開始する(▶いま開始/いま着手する/Now画面の開始)と、既存のポモドーロUIを流用した
      フォーカスタイマー(25分)を自動で起動します。既に別のタイマーが動いている場合は乗っ取りません。
    </div>
    <label class="checkbox-line">
      <input type="checkbox" data-setting-focustimerauto ${state.settings.focusTimerAuto ? "checked" : ""}>
      ⏱ Block開始でフォーカスタイマーを自動起動
    </label>
  `;
}

function renderSettingsGuidedAccessPanel() {
  return `
    <h3>🔒 ガイド付きアクセス案内</h3>
    <div class="muted" style="font-size:12px; line-height:1.6">
      iPad/iPhoneでポモドーロタイマーを開始すると、ガイド付きアクセス(画面ロック)の
      操作方法を案内するポップアップを出します。PWAから自動でロックすることはiOSの制約上
      できないため、手動操作の案内のみです。ポップアップの「今後表示しない」でもOFFにできます。
    </div>
    <label class="checkbox-line">
      <input type="checkbox" data-setting-pomoguidedaccesshint ${state.settings.pomoGuidedAccessHint ? "checked" : ""}>
      🔒 ポモドーロ開始時にガイド付きアクセスを案内(iPad/iPhoneのみ)
    </label>
  `;
}

// v151(ダークモード既定化): テーマ選択。select要素はfont-size 16px以上のiOS規約に従い
// .selectクラス(body既定16px継承)をそのまま使う。変更はdata-setting-field汎用ハンドラ
// (change イベント、state.settings[field]=value; saveState(); render();)に乗せるため、
// 専用のイベントハンドラを新設しない。render()内でapplyTheme()を毎回呼ぶ設計のため、
// 保存直後のrender()でhtml[data-theme]/meta[theme-color]も自動的に追従する。
function renderSettingsThemePanel() {
  const theme = (state.settings.theme === "light" || state.settings.theme === "auto") ? state.settings.theme : "dark";
  return `
    <h3>🌗 テーマ</h3>
    <div class="muted" style="font-size:12px; line-height:1.6">
      画面配色です。既定はダーク。「OS追従」を選ぶと端末の外観設定(ライト/ダーク)に自動で合わせます。
    </div>
    <label>テーマ
      <select class="select" data-setting-field="theme">
        <option value="dark" ${theme === "dark" ? "selected" : ""}>ダーク</option>
        <option value="light" ${theme === "light" ? "selected" : ""}>ライト</option>
        <option value="auto" ${theme === "auto" ? "selected" : ""}>OS追従</option>
      </select>
    </label>
  `;
}

function renderSettingsStudyWithMePanel() {
  return `
    <h3>🎥 Study With Me</h3>
    <div class="muted" style="font-size:12px; line-height:1.6">
      ポモドーロタブの「Study With Me」トグルで表示するYouTube動画です。ONの間だけ埋め込み、
      OFF・タブ離脱で破棄します(常時ロードしません)。再生はタップで開始してください(自動再生なし)。
    </div>
    <label>YouTube URLを貼り付け(動画ID・開始秒を自動抽出)
      <input class="input" type="text" id="study-with-me-url-input" placeholder="https://www.youtube.com/watch?v=...&t=...s" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    </label>
    <label>動画ID
      <input class="input" type="text" data-swm-field="videoId" value="${escapeHTML(state.settings.studyWithMe.videoId)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    </label>
    <label>開始秒
      <input class="input" type="number" min="0" step="1" data-swm-field="startSec" value="${state.settings.studyWithMe.startSec}">
    </label>
  `;
}

function renderSettingsBreakMessagesPanel() {
  return `
    <h3>休憩メッセージ</h3>
    <div class="muted" style="font-size:12px; line-height:1.6">
      休憩中(任意・常時タイマー)に、残り秒数の範囲に応じて表示されるメッセージです。
    </div>
    ${renderBreakMessagesSettings()}
    <button class="btn primary" data-action="add-break-message">+ メッセージを追加</button>
  `;
}

function renderSettingsFileStructurePanel() {
  return `
    <details class="panel home-fold settings-file-structure">
      <summary class="home-fold-summary"><span class="home-fold-chevron">▶</span>現在のファイル構成</summary>
      <div class="home-fold-body">
        <pre style="background:var(--panel-soft); padding:10px; border-radius:6px; font-size:11px; overflow-x:auto; margin:0">リポジトリ直下:
├── app-state.json          ← メインデータ(自動保存先)
├── Vision.md
├── Daily_Affirmation.md
├── now_vision.pdf
├── 45_vision.pdf
└── 80_vision.pdf</pre>
        <div class="muted" style="font-size:11px; margin-top:8px">
          現状はすべてリポジトリのルート直下に配置。git の commit 履歴がデータ履歴になるので、復元可能。<br>
          整理したい場合は <code>data/</code> サブフォルダに移動して、上の「保存先パス」と app.js のパスも合わせて変更してください。
        </div>
      </div>
    </details>
  `;
}

function renderSettingsCategoryPanel() {
  return `
    <h3>カテゴリ管理</h3>
    <div class="muted" style="font-size:12px; line-height:1.6">
      Project / Task / Block で選択できるカテゴリと色を管理します。タイムラインのブロック色などに反映されます。
    </div>
    ${renderCategoriesSettings()}
    <button class="btn primary" data-action="add-category">+ カテゴリを追加</button>
  `;
}

function renderSettingsPagesPanel() {
  return `
    <h3>GitHub Pages</h3>
    <div class="muted">このフォルダをGitHubリポジトリへpushし、Pagesの公開元をルートにすると公開できます。</div>
  `;
}

function renderSettings() {
  const github = state.settings.github || defaultGitHubSettings();
  const groups = [
    {
      id: "settings-daily", label: "日々の使い方(バッファ・電池・朝プラン・実行)",
      body: [renderSettingsBufferPanel(), renderSettingsBatteryPanel(), renderSettingsMorningPlanPanel(), renderSettingsExecPanel()]
    },
    {
      id: "settings-display", label: "表示・タイマー(テーマ・Study With Me・ガイド付きアクセス・休憩)",
      body: [renderSettingsThemePanel(), renderSettingsStudyWithMePanel(), renderSettingsGuidedAccessPanel(), renderSettingsBreakMessagesPanel()]
    },
    {
      id: "settings-master", label: "マスタ・詳細(プロフィール・カテゴリ管理・ファイル構成)",
      body: [renderSettingsProfilePanel(), renderSettingsCategoryPanel(), renderSettingsFileStructurePanel()]
    }
  ];
  return `
    ${renderHeader("Web版の保存と公開", "設定")}
    <section class="settings-grid">
      ${homeFoldSection(groups[0].id, false, "settings-group", "settings-group-summary", groups[0].label,
        `<div class="stack" style="gap:16px">${groups[0].body.join("")}</div>`)}
      ${homeFoldSection(groups[1].id, false, "settings-group", "settings-group-summary", groups[1].label,
        `<div class="stack" style="gap:16px">${groups[1].body.join("")}</div>`)}
      ${renderSettingsSyncGroup(github)}
      ${homeFoldSection(groups[2].id, false, "settings-group", "settings-group-summary", groups[2].label,
        `<div class="stack" style="gap:16px">${groups[2].body.join("")}</div>`)}
    </section>
  `;
}

// v148レビュー対応(2系統レビューFAIL項目2): 「データと同期」群だけ、他3群と違って
// homeFoldSection(localStorage記憶)を使わない専用実装にする(_settingsSyncOpenOverrideの
// 宣言・経緯コメントはファイル冒頭のモジュール変数群を参照)。
function renderSettingsSyncGroup(github) {
  // v148レビュー対応(項目5): 認証エラーバナー(pd-auth-banner、personalDataAuthError)からの
  // 設定遷移でもこの群を自動openにし、トークン再入力欄に直行できるようにする
  // (syncAlertMessage()と同じ「異常」の意味合いで扱う)。
  const dynamicOpen = Boolean(syncAlertMessage()) || Boolean(_personalDataAuthError);
  const open = dynamicOpen || Boolean(_settingsSyncOpenOverride);
  const body = [renderSettingsDataPanel(), renderSettingsCloudPanel(github), renderSettingsPagesPanel()].join("");
  return `
    <details class="home-fold panel settings-group" data-settings-sync ${open ? "open" : ""}>
      <summary class="home-fold-summary settings-group-summary" data-action="toggle-settings-sync"><span class="home-fold-chevron">▶</span>データと同期(データ管理・クラウド保存・GitHub Pages)</summary>
      <div class="home-fold-body"><div class="stack" style="gap:16px">${body}</div></div>
    </details>
  `;
}

// v9: カテゴリ管理 UI(設定画面用)
function renderCategoriesSettings() {
  const cats = state.settings.categories || [];
  if (!cats.length) return `<div class="muted">カテゴリ未登録</div>`;
  return `
    <div class="stack" style="gap:6px">
      ${cats.map((c) => `
        <div class="row" style="gap:8px; align-items:center; background:var(--panel-soft); padding:8px; border-radius:6px">
          <input type="color" data-cat-id="${escapeHTML(c.id)}" data-cat-field="color" value="${escapeHTML(c.color)}" style="width:36px; height:36px; padding:0; border:none; background:transparent; cursor:pointer">
          <input class="input" data-cat-id="${c.id}" data-cat-field="name" value="${escapeHTML(c.name)}" style="flex:1">
          <select class="select" data-cat-id="${escapeHTML(c.id)}" data-cat-field="bucket" style="flex:0 0 auto" aria-label="バケット(戦略/雑用/休息)">
            ${["", "strategy", "chore", "rest"].map((b) =>
              `<option value="${b}" ${(c.bucket || "") === b ? "selected" : ""}>${bucketLabel(b)}</option>`).join("")}
          </select>
          <button class="btn danger" data-action="delete-category" data-cat-id="${c.id}" aria-label="削除">×</button>
        </div>
      `).join("")}
    </div>
  `;
}

// v63: 戦略/雑用/休息ゲージ(提案6)のバケット表示ラベル
function bucketLabel(bucket) {
  return ({ strategy: "戦略", chore: "雑用", rest: "休息" })[bucket] || "未分類";
}

// v9: 休憩メッセージ管理 UI
function renderBreakMessagesSettings() {
  const msgs = state.settings.breakMessages || [];
  if (!msgs.length) return `<div class="muted">未登録</div>`;
  return `
    <div class="stack" style="gap:6px">
      ${msgs.map((m) => `
        <div class="stack" style="background:var(--panel-soft); padding:8px; border-radius:6px; gap:6px">
          <div class="row" style="gap:6px; align-items:center; font-size:12px">
            <span class="muted">残り</span>
            <input class="input" type="number" min="0" max="300" data-msg-id="${escapeHTML(m.id)}" data-msg-field="fromSec" value="${Number(m.fromSec) || 0}" style="width:70px">
            <span class="muted">〜</span>
            <input class="input" type="number" min="0" max="301" data-msg-id="${escapeHTML(m.id)}" data-msg-field="toSec" value="${Number(m.toSec) || 0}" style="width:70px">
            <span class="muted">秒</span>
            <button class="btn danger" data-action="delete-break-message" data-msg-id="${m.id}" style="margin-left:auto">×</button>
          </div>
          <input class="input" data-msg-id="${m.id}" data-msg-field="message" value="${escapeHTML(m.message)}" placeholder="メッセージ">
        </div>
      `).join("")}
    </div>
  `;
}

// v148(UI改善計画Phase3-1): 「その他」の目的別4群。navItemsとは別の配列にする理由 —
//   navItems.markはサイドバー(デスクトップ)でも使う頭文字1字(W/R/A等)で、日本語ラベルと
//   対応しないという指摘(codex-ui-review N4)はこの「その他」グリッド固有の問題のため、
//   サイドバー側(navItems)は変更せずここだけ既存絵文字(アプリ内の他画面で既に使っている
//   もの)へ差し替える。ルーティンは実行系(タスクシュート)の上部リンクへ昇格したため、
//   この4群からは除外する(renderTasks参照)。
const moreGroups = [
  { id: "plan", label: "計画", items: [
    { id: "wbs", label: "WBS", mark: "🧩" },
    { id: "wish", label: "やりたい", mark: "✦" },
    { id: "avoid", label: "やらない", mark: "✕" },
    { id: "vision", label: "ビジョン", mark: "🧭" }
  ] },
  { id: "think", label: "思考", items: [
    { id: "zero", label: "0秒思考", mark: "💡" }
  ] },
  { id: "review", label: "振り返り", items: [
    { id: "weekly", label: "週次", mark: "🗓" },
    { id: "dashboard", label: "ダッシュボード", mark: "📈" },  // v163: 実績値ダッシュボード+AIフィードバック横並び
    { id: "stats", label: "計器盤", mark: "📊" },
    { id: "ai-reports", label: "AIレポート", mark: "🤖" },
    { id: "reports", label: "日報", mark: "📤" }
  ] },
  { id: "tools", label: "ツール", items: [
    { id: "pomodoro", label: "ポモドーロ", mark: "🍅" },
    { id: "settings", label: "設定", mark: "⚙️" }
  ] }
];

// v148: renderHeader()から呼び、現在のビューがmoreGroupsのどれかに属していれば
// 「その他 › 群名」を返す(その他配下での現在地表示。codex-ui-review N1対応)。
// 属さない(home/journal/tasks/timeline/routine等)場合は空文字。
function moreGroupLabelFor(viewId) {
  const group = moreGroups.find((g) => g.items.some((item) => item.id === viewId));
  return group ? group.label : "";
}

function renderMore() {
  return `
    ${renderHeader("追加画面", "その他")}
    ${moreGroups.map((group) => `
      <div class="more-group">
        <h2 class="more-group-title">${group.label}</h2>
        <section class="grid">
          ${group.items.map((item) => `
            <button class="item row" data-action="nav" data-view="${item.id}">
              <strong>${item.label}</strong>
              <span class="badge">${item.mark}</span>
            </button>
          `).join("")}
        </section>
      </div>
    `).join("")}
  `;
}

// v39: =========================================================
//  週次レビュー + エネルギー構造分析
//  日(日報)と84日(12週)の間に抜けている「週スケール」を埋める。
//  週定義 = 土曜〜金曜(既存 weekRange の起点が土曜)。
// =========================================================

// 週開始(土曜)を返す。既存 weekRange を再利用し new Date(string) を新規に使わない。
function weekStartFor(dateStr) { return weekRange(dateStr).weekStart; }
function weekDays(weekStart) { return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)); }
function weekLabelShort(weekStart) {
  const end = addDays(weekStart, 6);
  return `${weekStart.slice(5).replace("-", "/")} 〜 ${end.slice(5).replace("-", "/")}`;
}

// v63: 戦略/雑用/休息ゲージ(提案6)。カテゴリ名からバケット(strategy/chore/rest)を引く。
//      カテゴリ未登録・bucket未設定は空文字("未分類"として扱う)。
function getCategoryBucket(name) {
  if (!name) return "";
  const cat = (state.settings?.categories || []).find((c) => c.name === name);
  return cat?.bucket || "";
}

// v63: 指定週の完了Blockを戦略/雑用/休息/未分類の4バケットで時間集計する(分)。
//      既存のカテゴリ別ドーナツ集計(renderStats)と同じ「実績優先・無ければ計画」の時間算出を再利用。
function weeklyBucketMinutes(weekBlocks) {
  const totals = { strategy: 0, chore: 0, rest: 0, unclassified: 0 };
  weekBlocks.filter((b) => !b.deleted && b.completed).forEach((b) => {
    const min = _actualDurationMin(b) ?? (b.plannedStartAt && b.plannedEndAt
      ? Math.max(0, minutesOf(b.plannedEndAt) - minutesOf(b.plannedStartAt)) : 0);
    if (min <= 0) return;
    const bucket = getCategoryBucket(b.category) || "unclassified";
    totals[bucket] = (totals[bucket] || 0) + min;
  });
  return totals;
}

// v63: 戦略/雑用/休息ゲージのHTML(横棒 + 時間・%併記の凡例)。目標値は持たず現実を見るだけ。
function renderBucketGauge(weekBlocks) {
  const totals = weeklyBucketMinutes(weekBlocks);
  const totalMin = totals.strategy + totals.chore + totals.rest + totals.unclassified;
  if (totalMin <= 0) {
    return `<div class="muted" style="font-size:13px">この週は完了Blockの記録がありません。</div>`;
  }
  const order = [
    { key: "strategy", label: "戦略" },
    { key: "chore", label: "雑用" },
    { key: "rest", label: "休息" },
    { key: "unclassified", label: "未分類" }
  ];
  const bar = order.map(({ key }) => {
    const pct = (totals[key] / totalMin) * 100;
    return pct > 0 ? `<span class="bucket-gauge-seg ${key}" style="width:${pct.toFixed(2)}%" title="${bucketLabel(key === "unclassified" ? "" : key)}"></span>` : "";
  }).join("");
  const legend = order.map(({ key, label }) => {
    const pct = Math.round((totals[key] / totalMin) * 100);
    return `<div class="bucket-gauge-legend-row">
      <span class="bucket-gauge-swatch ${key}"></span>
      <span class="bucket-gauge-name">${label}</span>
      <span class="bucket-gauge-val">${fmtMinShort(totals[key]) || "0m"} ・ ${pct}%</span>
    </div>`;
  }).join("");
  return `<div class="bucket-gauge"><div class="bucket-gauge-bar">${bar}</div><div class="bucket-gauge-legend">${legend}</div></div>`;
}

// v65: 10x機構(designs/10x-mechanism.md 2-1)の最小集計。指定週の完了Blockを
// leverageType(asset/eliminate/oneoff/未設定)別に時間集計する(分)。本格可視化はv66で。
function weeklyLeverageMinutes(weekBlocks) {
  const totals = { asset: 0, eliminate: 0, oneoff: 0, unset: 0 };
  weekBlocks.filter((b) => !b.deleted && b.completed).forEach((b) => {
    const min = _actualDurationMin(b) ?? (b.plannedStartAt && b.plannedEndAt
      ? Math.max(0, minutesOf(b.plannedEndAt) - minutesOf(b.plannedStartAt)) : 0);
    if (min <= 0) return;
    const key = ["asset", "eliminate", "oneoff"].includes(b.leverageType) ? b.leverageType : "unset";
    totals[key] += min;
  });
  return totals;
}
// weeklyLeverageMinutes の集計を1行テキストにする(bucketゲージの下に添える控えめな表示)。
function renderLeverageSummaryLine(weekBlocks) {
  const totals = weeklyLeverageMinutes(weekBlocks);
  const totalMin = totals.asset + totals.eliminate + totals.oneoff + totals.unset;
  if (totalMin <= 0) return "";
  return `<div class="muted lev-week-summary" style="font-size:12px; margin-top:6px">
    ⚙資産 ${fmtMinShort(totals.asset) || "0m"} ・ ✂削減 ${fmtMinShort(totals.eliminate) || "0m"} ・
    単発 ${fmtMinShort(totals.oneoff) || "0m"} ・ 未設定 ${fmtMinShort(totals.unset) || "0m"}
  </div>`;
}

// v66: 10x機構(designs/10x-mechanism.md 2-1後段)。週次の1行集計(v65)を発展させ、
// 直近n週の「10x時間(資産+削減) : 2x時間(単発+未設定)」比をならしたトレンドを見る。
// ライブラリは使わずCSSの横棒セグメントのみで表現する。総時間0の週は割り算せず「記録なし」扱いにする。
function leverageRatioHistory(weekStart, n = 8) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const ws = addDays(weekStart, -7 * i);
    const totals = weeklyLeverageMinutes(blocksForWeek(ws));
    const tenXMin = totals.asset + totals.eliminate;
    const twoXMin = totals.oneoff + totals.unset;
    const totalMin = tenXMin + twoXMin;
    out.push({ week: ws, tenXMin, twoXMin, totalMin, pct: totalMin > 0 ? Math.round((tenXMin / totalMin) * 100) : null });
  }
  return out;
}

// leverageRatioHistory を週ごとの小さな横棒(2セグメント)として描画する。
function renderLeverageTrend(weekStart) {
  const history = leverageRatioHistory(weekStart, 8);
  const rows = history.map((h) => {
    const label = h.week.slice(5).replace("-", "/");
    if (h.totalMin <= 0) {
      return `<div class="lev-trend-row">
        <span class="lev-trend-label">${label}</span>
        <div class="lev-trend-bar"><span class="lev-trend-empty" title="この週は完了Blockの記録がありません"></span></div>
        <span class="lev-trend-pct muted">記録なし</span>
      </div>`;
    }
    const tenXPct = (h.tenXMin / h.totalMin) * 100;
    const twoXPct = 100 - tenXPct;
    return `<div class="lev-trend-row">
      <span class="lev-trend-label">${label}</span>
      <div class="lev-trend-bar">
        <span class="lev-trend-seg tenx" style="width:${tenXPct.toFixed(2)}%" title="10x(資産+削減) ${fmtMinShort(h.tenXMin) || "0m"}"></span>
        <span class="lev-trend-seg twox" style="width:${twoXPct.toFixed(2)}%" title="2x(単発+未設定) ${fmtMinShort(h.twoXMin) || "0m"}"></span>
      </div>
      <span class="lev-trend-pct">${h.pct}%</span>
    </div>`;
  }).join("");
  return `<div class="lev-trend">${rows}</div>`;
}

// v66: 10x機構(designs/10x-mechanism.md 2-2レバレッジ台帳)。専用の永続ログは持たず、
// leverageType=asset を付けて完了したTask/Blockそのものを「作った資産」の実データとして
// 都度集計する(二重入力をさせない — v65で既にleverageTypeを付けているならそれで足りる)。
function assetLedgerItems() {
  const blockItems = (state.blocks || [])
    .filter((b) => !b.deleted && b.completed && b.leverageType === "asset")
    .map((b) => ({
      id: b.id, kind: "block", title: b.title,
      date: b.date || (b.actualEndAt ? b.actualEndAt.slice(0, 10) : ""),
      note: b.leverageNote || ""
    }));
  const taskItems = (state.tasks || [])
    .filter((t) => !t.deleted && t.status === "completed" && t.leverageType === "asset")
    .map((t) => ({
      id: t.id, kind: "task", title: t.title,
      date: t.realizedDate || (t.updatedAt ? t.updatedAt.slice(0, 10) : ""),
      note: t.leverageNote || ""
    }));
  return [...blockItems, ...taskItems]
    .filter((it) => it.date)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// 指定週(weekStart起点7日)に完了した資産の件数。「今週、資産を1つ作ったか?」の判定に使う。
function assetLedgerCountForWeek(weekStart) {
  const days = new Set(weekDays(weekStart));
  return assetLedgerItems().filter((it) => days.has(it.date)).length;
}

// レバレッジ台帳セクション本体。先頭に「今週、資産を1つ作ったか?」の問い(作った週は✓+件数、
// 作っていない週は問いだけを裁かずに表示)、その下に全期間の資産一覧(タイトル/完了日/
// 累計節約の自己申告メモ=任意1行入力)を積む。
function renderLeverageLedger(weekStart) {
  const items = assetLedgerItems();
  const weekCount = assetLedgerCountForWeek(weekStart);
  const prompt = weekCount > 0
    ? `<div class="lev-ledger-prompt lev-ledger-prompt-yes">✓ 今週、資産を ${weekCount} 個作った</div>`
    : `<div class="lev-ledger-prompt muted">今週、資産を1つ作ったか?</div>`;
  const list = items.length
    ? `<div class="lev-ledger-list">${items.map((it) => `
        <div class="lev-ledger-row">
          <span class="lev-ledger-date muted">${it.date.slice(5)}</span>
          <span class="lev-ledger-title">${escapeHTML(it.title)}</span>
          <input type="text" class="input lev-ledger-note" placeholder="累計節約メモ(任意・自己申告)"
            value="${escapeHTML(it.note)}" data-ledger-note-id="${it.id}" data-ledger-note-kind="${it.kind}">
        </div>`).join("")}</div>`
    : `<div class="muted" style="font-size:13px; margin-top:8px">
        まだ「資産」に分類して完了したTask/Blockがありません。Task/Block編集モーダルで
        レバレッジ(10x機構)を「資産」にして完了すると、ここに自動で積み上がります。
      </div>`;
  return `<div class="lev-ledger">${prompt}${list}</div>`;
}

function blocksForWeek(weekStart) {
  const days = new Set(weekDays(weekStart));
  return state.blocks.filter((b) => !b.deleted && days.has(b.date));
}

// 週の実行スコア・エネルギー(blocks から都度計算、非正規化しない)
function computeWeeklyMetrics(weekStart) {
  const days = weekDays(weekStart);
  const weekBlocks = blocksForWeek(weekStart);
  const tc = taskchuteStartRate(weekBlocks);
  const rt = routineRate(weekBlocks);
  const mit = weekBlocks.filter((b) => b.isMIT);
  const mitDone = mit.filter((b) => b.completed).length;
  const completedW = weekBlocks.filter((b) => b.completed);
  const charge = completedW.reduce((s, b) => s + Number(b.charge || 0), 0);
  const discharge = completedW.reduce((s, b) => s + Number(b.discharge || 0), 0);
  const daily = days.map((d) => {
    const db = weekBlocks.filter((b) => b.date === d);
    const dtc = taskchuteStartRate(db);
    const drt = routineRate(db);  // v73: 週次の体調×実行率ミニ相関で使う日別ルーティン実行率
    const dc = db.filter((b) => b.completed);
    const net = dc.reduce((s, b) => s + Number(b.charge || 0) - Number(b.discharge || 0), 0);
    return {
      date: d, wd: weekdayLabel(d),
      startPct: dtc.pct, startTotal: dtc.total,
      routinePct: drt.pct, routineTotal: drt.total,
      net
    };
  });
  const start12 = state.settings.twelveWeekStartDate;
  // v147: 週番号・残り日数とも基準日をtodayISO()に統一(ホーム側と食い違っていた+同一ウィジェット内で
  // Week Nと残り日数の基準がズレる新たな不整合を避けるため。taskchute-notes/decisions.md参照)
  const wkNum = start12 ? clamp(Math.floor(daysBetween(start12, todayISO()) / 7) + 1, 1, 12) : null;
  const daysLeft12 = start12 ? Math.max(0, daysBetween(todayISO(), addDays(start12, 84))) : null;
  return {
    days, tc, rt,
    mit: { done: mitDone, total: mit.length, pct: mit.length ? Math.round((mitDone / mit.length) * 100) : 0 },
    charge, discharge, net: charge - discharge, daily, wkNum, daysLeft12
  };
}

// v40: エネルギー構造分析。weekStart を含む直近 weeks 週の completed blocks から
//      放電超過(曜日別平均・カテゴリ別合計)を上位3件だけ返す。
//      対象期間の completed が 28件未満なら eligible:false(不正確な "構造" を見せない)。
// v170: WEEKDAY_LABELSはファイル冒頭へ移動した(configureRoutine()のTDZ回避、上記コメント参照)。
function computeEnergyStructure(weekStart, weeks = 4) {
  const startDate = addDays(weekStart, -7 * (weeks - 1));
  const endDate = addDays(weekStart, 6);
  const inRange = state.blocks.filter((b) => !b.deleted && b.completed && b.date >= startDate && b.date <= endDate);
  if (inRange.length < weeks * 7) return { eligible: false, findings: [] };  // 28件未満

  // 曜日別 平均差引(n>=3、平均が負)
  const wd = WEEKDAY_LABELS.map((label, i) => ({ dayIndex: i, label: `${label}曜`, net: 0, n: 0 }));
  inRange.forEach((b) => {
    const i = parseDate(b.date).getDay();  // 0=日..6=土(parseDate=安全な数値コンストラクタ)
    wd[i].net += Number(b.charge || 0) - Number(b.discharge || 0);
    wd[i].n += 1;
  });
  const worstWeekday = wd.filter((r) => r.n >= 3 && r.net / r.n < 0)
    .map((r) => ({ type: "weekday", dayIndex: r.dayIndex, label: r.label, value: r.net / r.n, n: r.n }))
    .sort((a, b) => a.value - b.value)[0];
  // カテゴリ別 差引合計(n>=3、合計が負)
  const cat = {};
  inRange.forEach((b) => {
    const c = b.category || "未分類";
    (cat[c] ||= { net: 0, n: 0 });
    cat[c].net += Number(b.charge || 0) - Number(b.discharge || 0);
    cat[c].n += 1;
  });
  const worstCats = Object.entries(cat).filter(([, v]) => v.n >= 3 && v.net < 0)
    .map(([key, v]) => ({ type: "category", key, label: `〈${key}〉`, value: v.net, n: v.n }))
    .sort((a, b) => a.value - b.value);
  // 曜日の信号がカテゴリ合計に埋もれないよう、曜日1件を先頭に置いてから上位3件
  const findings = [];
  if (worstWeekday) findings.push(worstWeekday);
  worstCats.forEach((c) => { if (findings.length < 3) findings.push(c); });
  return { eligible: true, findings };
}

// v73: コンディションOS — 体調×ルーティン実行率×タスク実行率の週次ミニ相関。
// 深い分析(相関係数等)はバッチの領分。ここでは7日分を横並びで見せるだけの軽い可視化に留める。
function renderConditionCorrelation(m) {
  const rows = m.daily.map((d) => {
    const mood = state.settings.morningEnergyLog[d.date];
    const log = state.condition.logs[d.date];
    return { ...d, mood, eveningMood: log?.eveningMood };
  });
  const hasAny = rows.some((r) => r.mood !== undefined || r.eveningMood !== undefined && r.eveningMood !== null);
  if (!hasAny) return "";
  const moodLabel = (v) => (v === undefined || v === null) ? "—" : `${v}`;
  return `
    <div class="weekly-sec">
      <h3>体調 × 実行率(7日)</h3>
      <div class="cond-corr-table">
        <div class="cond-corr-row cond-corr-head">
          <span>曜日</span><span>朝体調</span><span>夜体調</span><span>タスク着手</span><span>ルーティン</span>
        </div>
        ${rows.map((r) => `
          <div class="cond-corr-row">
            <span>${r.wd}</span>
            <span>${moodLabel(r.mood)}</span>
            <span>${moodLabel(r.eveningMood)}</span>
            <span>${r.startTotal ? `${r.startPct}%` : "—"}</span>
            <span>${r.routineTotal ? `${r.routinePct}%` : "—"}</span>
          </div>`).join("")}
      </div>
      <div class="muted stats-axis">数値の並びを見るだけの軽い一覧です(相関係数などの分析はしていません)。</div>
    </div>
  `;
}

function renderEnergyStructure(weekStart) {
  const { eligible, findings } = computeEnergyStructure(weekStart);
  if (!eligible) return "";  // 4週分(28件)のデータが無ければ非表示
  if (!findings.length) {
    return `<div class="weekly-sec"><h3>エネルギー構造(直近4週)</h3>
      <div class="muted" style="font-size:13px">構造的な放電超過は見つかりません。いい状態です。</div></div>`;
  }
  return `<div class="weekly-sec"><h3>エネルギー構造(直近4週)</h3>
    ${findings.map((r, i) => r.type === "weekday"
      ? `<div class="weekly-struct-row">
          <span class="weekly-struct-desc">${i + 1}. ${escapeHTML(r.label)}が構造的にマイナス(平均 ${r.value.toFixed(1)})</span>
          <button class="btn ghost" data-action="energy-open-routine" data-day="${r.dayIndex}">${escapeHTML(r.label)}のルーティンを見る</button>
        </div>`
      : `<div class="weekly-struct-row">
          <span class="weekly-struct-desc">${i + 1}. ${escapeHTML(r.label)}が放電超過(${signed(r.value)})</span>
          <button class="btn ghost" data-action="energy-open-category" data-cat="${escapeHTML(r.key)}">ブロックを見る</button>
        </div>`).join("")}
  </div>`;
}

// v40: 直近 n 週の着手率(スパークライン用。古い→新しい)
function startRateHistory(weekStart, n = 4) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const ws = addDays(weekStart, -7 * i);
    const r = taskchuteStartRate(blocksForWeek(ws));
    out.push({ week: ws, pct: r.pct, total: r.total });
  }
  return out;
}

// v53: =========================================================
//  計器盤(統計ダッシュボード)
//  溜まったデータの長期トレンドを見る「静かな計器」。目標線・達成色分け・催促なし。
//  集計は都度計算(保存しない)。データ不足のセクションは出さない。
// =========================================================
function statsRangeWeeks() {
  const r = state.settings.statsRange || "4w";
  if (r === "4w") return 4;
  if (r === "12w") return 12;
  // all: ローカルに残っている最古Blockの週から今週まで(表示上限2年)
  const dates = state.blocks.filter((b) => !b.deleted && b.date).map((b) => b.date);
  if (!dates.length) return 4;
  const oldest = dates.reduce((a, b) => (a < b ? a : b));
  return clamp(Math.ceil((daysBetween(oldest, todayISO()) + 1) / 7) + 1, 4, 104);
}

// v142: 計器盤「睡眠」セクション ==================================================
// renderStatsの肥大化を避けるため別関数に切り出し、renderStatsからは呼ぶだけにする。
// 3部品(帯グラフ/トレンド/帯別比較)はいずれも自前のデータ有無ガードを持ち、
// 何も描けない部品は空文字を返す(静かな計器)。3部品すべて空ならセクション自体を隠す。
function sleepValuesForRange(from, to) {
  const vals = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const log = state.sleep.logs[d];
    const v = log ? toNumber(log.sleepH) : null;
    if (v != null) vals.push({ date: d, v });
  }
  return vals;
}

// state.sleep.logsのうち最古の日付キー(1件も無ければnull)。
// 「全期間」レンジの起点をBlockだけでなく睡眠ログの最古日も考慮して決めるために使う。
function oldestSleepLogDate() {
  const dates = Object.keys(state.sleep.logs);
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
}

// dateごとのBlock配列を1回だけ構築するMap。renderSleepBucketCardのような「日ごとに
// computeDailyMetricsを繰り返し呼ぶ」用途でstate.blocks全走査(O(日数×全Block数))を
// 避けるために使う(v142、Codexレビュー指摘)。
function buildBlocksByDateMap() {
  const map = new Map();
  state.blocks.forEach((b) => {
    if (b.deleted) return;
    if (!map.has(b.date)) map.set(b.date, []);
    map.get(b.date).push(b);
  });
  return map;
}

// 就寝・起床の帯グラフ(直近4週固定。stats-rangeには追従しない)
function renderSleepBandCard(today) {
  const AXIS_START = 20 * 60;  // 20:00起点
  const AXIS_SPAN = 14 * 60;   // 20:00〜翌10:00の14時間窓
  const axisMinutes = (t) => {
    const raw = minutesOf(t);
    return raw < AXIS_START ? raw + 1440 : raw;
  };
  const pctOf = (m) => clamp(((m - AXIS_START) / AXIS_SPAN) * 100, 0, 100);

  const days = [];
  for (let d = addDays(today, -27); d <= today; d = addDays(d, 1)) days.push(d);
  const rows = days.map((d) => {
    const log = state.sleep.logs[d];
    if (!log || !log.bed || !log.wake) return { date: d, bar: null };
    const left = pctOf(axisMinutes(log.bed));
    const right = pctOf(axisMinutes(log.wake));
    if (right <= left) return { date: d, bar: null };  // 軸窓外の異常値は描画しない(裁かず黙って省く)
    return { date: d, bar: { left, width: right - left, bed: log.bed, wake: log.wake } };
  });
  if (!rows.some((r) => r.bar)) return "";
  return `
    <div class="stats-sleep-sub">
      <h3 class="stats-sleep-subhead">就寝・起床(直近4週)</h3>
      <div class="stats-sleep-band">
        ${rows.map((r) => `
          <div class="stats-sleep-band-row">
            <span class="stats-sleep-band-date">${shortSleepDate(r.date)}</span>
            <span class="stats-sleep-band-track">
              ${r.bar ? `<span class="stats-sleep-band-bar" style="left:${r.bar.left.toFixed(1)}%; width:${r.bar.width.toFixed(1)}%" title="${escapeHTML(r.date)}: ${escapeHTML(r.bar.bed)}→${escapeHTML(r.bar.wake)}"></span>` : ""}
            </span>
          </div>`).join("")}
      </div>
      <div class="muted stats-axis">バーの左端=就寝、右端=起床(軸: 20時〜翌10時)。日付は起床日(就寝バーは前夜分)。ログが無い日は空欄</div>
    </div>`;
}

// 睡眠時間トレンド+直近28日中央値ベースライン(閾値5.5h/6.5hの帯は控えめに表示)
function renderSleepTrendCard(since, today) {
  const trendVals = sleepValuesForRange(since, today);
  if (trendVals.length < 2) return "";
  const baselineVals = sleepValuesForRange(addDays(today, -27), today).map((x) => x.v);
  const baseline = baselineVals.length >= CONDITION_BUDGET_BASELINE_MIN_SAMPLES ? median(baselineVals) : null;

  const yMax = Math.max(9, ...trendVals.map((x) => x.v));
  const yMin = Math.min(3, ...trendVals.map((x) => x.v));
  const W = 100, H = 44, padY = 4;
  const span = Math.max(1, daysBetween(since, today));
  const xOf = (d) => (daysBetween(since, d) / span) * W;
  const yOf = (v) => padY + (1 - (v - yMin) / (yMax - yMin)) * (H - padY * 2);
  const poly = trendVals.map((p) => `${xOf(p.date).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(" ");
  const dots = trendVals.map((p) => `<circle cx="${xOf(p.date).toFixed(1)}" cy="${yOf(p.v).toFixed(1)}" r="1" fill="var(--accent)"/>`).join("");
  const bandLine = (h) => (h >= yMin && h <= yMax)
    ? `<line x1="0" y1="${yOf(h).toFixed(1)}" x2="${W}" y2="${yOf(h).toFixed(1)}" stroke="var(--red)" stroke-width="0.4" stroke-dasharray="2,2" opacity=".35"/>`
    : "";
  const baselineLine = baseline != null
    ? `<line x1="0" y1="${yOf(baseline).toFixed(1)}" x2="${W}" y2="${yOf(baseline).toFixed(1)}" stroke="var(--accent)" stroke-width="0.5" stroke-dasharray="1,1.5" opacity=".55"/>`
    : "";
  return `
    <div class="stats-sleep-sub">
      <h3 class="stats-sleep-subhead">睡眠時間トレンド</h3>
      <svg class="stats-line-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="睡眠時間の推移">
        ${bandLine(CONDITION_BUDGET_SLEEP_DEFICIT_H)}
        ${bandLine(CONDITION_BUDGET_SLEEP_LOW_H)}
        ${baselineLine}
        <polyline points="${poly}" fill="none" stroke="var(--accent)" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
      </svg>
      <div class="muted stats-axis">点線(赤)=5.5h/6.5hの目安 ${baseline != null ? `・点線(青)=直近28日の中央値(${baseline.toFixed(1)}h)` : ""} ・${trendVals.length}日分</div>
    </div>`;
}

// 睡眠時間帯別(<5.5 / 5.5-6.5 / 6.5-7.5 / >7.5h)の当日着手率・エネルギーnet中央値比較
const SLEEP_BUCKETS = [
  { key: "lt55", label: "5.5h未満", test: (h) => h < 5.5 },
  { key: "55to65", label: "5.5〜6.5h", test: (h) => h >= 5.5 && h < 6.5 },
  { key: "65to75", label: "6.5〜7.5h", test: (h) => h >= 6.5 && h < 7.5 },
  { key: "gt75", label: "7.5h以上", test: (h) => h >= 7.5 }
];
const SLEEP_BUCKET_MIN_SAMPLES = 3;  // 帯そのものだけでなく着手率/net個別の対サンプルにも適用する
function renderSleepBucketCard(since, today, blocksByDate) {
  // v143レビュー対応: 集計ロジックはcomputeSleepBucketStats()に一本化(重複コピーを廃止)。
  // 3件未満の帯は非表示(renderStats既存ガードを踏襲、computeSleepBucketStats内で適用済み)。
  const rows = computeSleepBucketStats(since, today, blocksByDate);
  if (!rows.length) return "";
  // startVals/netValsはそれぞれr.n(帯の睡眠件数)以下になりうる(Blockが無い/未完了の日がある
  // ため)。帯自体がn>=3でも、実際に使う対サンプルが3件未満なら中央値を出さず「—」にする
  // (着手率側の欠損表示と揃える。Codexレビュー指摘: netが空でも0=「+0」と表示されていた問題も解消)。
  const netMedians = rows.map((r) => (r.netVals.length >= SLEEP_BUCKET_MIN_SAMPLES ? median(r.netVals) : null));
  const maxAbsNet = Math.max(1, ...netMedians.filter((v) => v != null).map(Math.abs));
  return `
    <div class="stats-sleep-sub">
      <h3 class="stats-sleep-subhead">睡眠帯別 当日実績(中央値)</h3>
      ${rows.map((r, i) => {
        const startMed = r.startVals.length >= SLEEP_BUCKET_MIN_SAMPLES ? Math.round(median(r.startVals)) : null;
        const netMed = netMedians[i];
        const w = netMed != null ? Math.round((Math.abs(netMed) / maxAbsNet) * 50) : 0;
        const pos = netMed != null && netMed > 0, neg = netMed != null && netMed < 0;
        return `
        <div class="stats-sleep-bucket-row">
          <span class="stats-sleep-bucket-label">${r.label} <span class="muted">(${r.n}日)</span></span>
          <span class="stats-sleep-bucket-metric">
            <span class="muted">着手率</span>
            <span class="progress stats-sleep-bucket-bar"><span style="width:${startMed ?? 0}%"></span></span>
            <b>${startMed != null ? `${startMed}%` : "—"}</b>
          </span>
          <span class="stats-sleep-bucket-metric">
            <span class="muted">net</span>
            <span class="stats-div-track stats-sleep-bucket-bar">
              <span class="stats-div-neg">${neg ? `<span style="width:${w}%"></span>` : ""}</span>
              <span class="stats-div-axis"></span>
              <span class="stats-div-pos">${pos ? `<span style="width:${w}%"></span>` : ""}</span>
            </span>
            <b class="${neg ? "neg" : pos ? "pos" : ""}">${netMed != null ? signed(Math.round(netMed * 10) / 10) : "—"}</b>
          </span>
        </div>`;
      }).join("")}
      <div class="muted stats-axis">3件未満の帯は表示しません。着手率=計画Blockのうち実際に着手した割合、net=Σ(充電−放電)</div>
    </div>`;
}

function renderSleepStats(since, today, blocksByDate) {
  const bandCard = renderSleepBandCard(today);
  const trendCard = renderSleepTrendCard(since, today);
  const bucketCard = renderSleepBucketCard(since, today, blocksByDate);
  if (!bandCard && !trendCard && !bucketCard) return "";  // 睡眠データが1件も無ければセクションごと非表示
  return `
    <div class="panel stack stats-wide stats-sleep-panel">
      <h2>睡眠</h2>
      ${bandCard}${trendCard}${bucketCard}
    </div>`;
}

// v161: AI機能第5弾(最終)「エネルギーカーブ」。計器盤の詳細層に置く時間帯別(24枠)の
// 棒グラフ。K発注仕様「タスクの中身ではなく『いつやるか』の最適化に振り切る」「集計は
// バッチ側、アプリに分析ロジックを足さない」に基づき、本関数はcachedEnergyCurveJson.dataの
// 値をそのまま描画するだけで、アプリ側での再集計・フィルタは一切行わない。
// 2026-07-28レビュー対応:
//   - 必須修正3: hourly全件が実行数0(=表示すべき実データが無い)ならセクションごと非表示にする
//     (既存の「n不足のセルは出さない」ガード思想を、節全体の空表示防止にも適用)。
//   - 必須修正5: startRateはtitle属性(ツールチップ)頼みだとiOS実機で読めないため、
//     既存ヒートマップ(stats-hm-cell、数値をセル自身の可視テキストとして出す)と同じ方式で
//     バー下に小さく数値表示する(%記号は軸注記側にまとめ、セル内は数字のみで幅を節約)。
//   - 推奨修正9: 既存.stats-histとは別クラス(.energy-curve-*)にして、将来.stats-hist系の
//     件数を数える既存/新規テストとの意図しない衝突を避ける(専用CSSも新設)。
// null時間帯(バッチ側で3件未満と判定)は数値・色付けを出さず空表示にする。
function renderEnergyCurveCard() {
  const data = cachedEnergyCurveJson.data;
  if (!data || !Array.isArray(data.hourly) || data.hourly.length !== 24) return "";
  const hasAnyData = data.hourly.some((r) => (Number(r.count) || 0) > 0);
  if (!hasAnyData) return "";  // 2026-07-28レビュー対応・必須修正3: 全時間帯0件なら節ごと非表示
  const maxCount = Math.max(1, ...data.hourly.map((r) => Number(r.count) || 0));
  const bars = data.hourly.map((r) => {
    const hour = Number(r.hour) || 0;
    const count = Number(r.count) || 0;
    const netAvg = typeof r.netAvg === "number" && Number.isFinite(r.netAvg) ? r.netAvg : null;
    const startRate = typeof r.startRate === "number" && Number.isFinite(r.startRate) ? r.startRate : null;
    const heightPct = count > 0 ? Math.round((count / maxCount) * 100) : 0;
    const netClass = netAvg == null ? "" : netAvg > 0 ? "pos" : netAvg < 0 ? "neg" : "";
    const titleParts = [`${hour}時台: 実行${count}件`];
    if (netAvg != null) titleParts.push(`net ${signed(netAvg)}`);
    if (startRate != null) titleParts.push(`着手率${startRate}%`);
    return `<div class="energy-curve-cell" data-hour="${hour}" data-net-class="${netClass}" title="${escapeHTML(titleParts.join(" / "))}">
      <div class="energy-curve-bar">${count ? `<div class="energy-curve-fill ${netClass}" style="height:${heightPct}%"></div>` : ""}</div>
      <div class="energy-curve-rate">${startRate != null ? startRate : ""}</div>
      <div class="energy-curve-lab">${hour % 3 === 0 ? hour : ""}</div>
    </div>`;
  }).join("");
  return `
    <div class="panel stack stats-wide">
      <h2>エネルギーカーブ(時間帯別)</h2>
      <div class="energy-curve-grid">${bars}</div>
      <div class="muted stats-axis">棒の高さ=実行数、色=充放電net(緑=充電傾向・赤=放電傾向、0または3件未満は無色)。バー下の数値=着手率%(3件未満は空欄)。直近${data.days || 28}日集計</div>
    </div>`;
}

// v148(UI改善計画Phase3-3): 計器盤の常時表示に置く「睡眠1行要約」。renderSleepStats(詳細、
// details格納)を開かなくても直近の睡眠状況が一目で分かるよう、中央値だけを1行で示す。
// データが1件も無ければ非表示(既存の静かな計器の方針を踏襲)。
function renderSleepSummaryLine(since, today) {
  const vals = sleepValuesForRange(since, today).map((x) => x.v);
  if (!vals.length) return "";
  const med = median(vals);
  // v148レビュー対応: 「直近」は期間セレクタ(4週/12週/全期間、最大104週)によっては
  // 誤解を招く(全期間選択時は最大2年分の中央値になりうる)ため、選択中の期間全体を指す
  // 「期間中央値」に統一する。
  return `
    <div class="panel stats-wide stats-sleep-summary">
      <span class="muted">💤 睡眠</span> 期間中央値 <b>${med.toFixed(1)}h</b>
      <span class="muted">(${vals.length}日分。詳細は下の「詳細を見る」)</span>
    </div>`;
}

// v143: 計器盤「今週のヒント」========================================================
// 既存の集計(エネルギー構造/ヒートマップ/見積精度/睡眠帯)を専用の純関数へ集約し、
// renderStats()内の各チャートとcomputeInsights()の両方から呼べるようにする(二重実装回避)。
// 決定論のみ・保存しない・観察文のみ(「〜すべき」を出さない)。0件なら節ごと非表示(静かな計器)。

// 時間帯(SCHED_BANDS)×曜日の着手率グリッド。renderStatsのヒートマップと同一ロジックを共有する。
// n<3のセルはrate=nullで返す(ノイズ抑制。既存のヒートマップ表示仕様を踏襲)。
function computeHeatmapCells(since, today) {
  const past = state.blocks.filter((b) => !b.deleted && b.date >= since && b.date <= today && b.plannedStartAt);
  const wdOrder = [6, 0, 1, 2, 3, 4, 5];  // 週定義に合わせて 土曜始まり
  const wdLabels = ["土", "日", "月", "火", "水", "木", "金"];
  const cells = [];
  SCHED_BANDS.forEach(([s, e, bandLabel], bandIdx) => {
    wdOrder.forEach((wd, i) => {
      const cellBlocks = past.filter((b) => {
        if (parseDate(b.date).getDay() !== wd) return false;
        const m = minutesOf(b.plannedStartAt);
        return m >= s * 60 && m < e * 60;
      });
      const n = cellBlocks.length;
      const rate = n >= 3 ? cellBlocks.filter((b) => b.actualStartAt).length / n : null;  // n不足はノイズなので出さない
      cells.push({ bandIdx, bandLabel, dayIndex: wd, wdLabel: wdLabels[i], n, rate });
    });
  });
  return cells;
}

// 見積 vs 実績(見積・実績時刻が両方あるBlock)。renderStatsの見積カードと同一ロジックを共有する。
// 5件未満は非対象(既存の見積カード仕様を踏襲)。
function computeEstimateStats(since, today) {
  const past = state.blocks.filter((b) => !b.deleted && b.date >= since && b.date <= today && b.plannedStartAt);
  const est = past
    .filter((b) => b.completed && Number(b.estimateMin) > 0)
    .map((b) => ({ b, actual: _actualDurationMin(b) }))
    .filter((x) => x.actual && x.actual > 0);
  if (est.length < 5) return { eligible: false, est: [], catRows: [] };
  const ratios = est.map((x) => x.actual / Number(x.b.estimateMin));
  const medRatio = Math.round(median(ratios) * 100);
  const meanAbsErr = Math.round(est.reduce((s, x) => s + Math.abs(x.actual - Number(x.b.estimateMin)), 0) / est.length);
  const byCat = {};
  est.forEach((x) => { (byCat[x.b.category || "未分類"] ||= []).push(x.actual / Number(x.b.estimateMin)); });
  const catRows = Object.entries(byCat)
    .filter(([, arr]) => arr.length >= 3)
    .map(([cat, arr]) => ({ cat, med: median(arr), n: arr.length }))
    .sort((a, b) => Math.abs(b.med - 1) - Math.abs(a.med - 1))
    .slice(0, 5);
  return { eligible: true, est, medRatio, meanAbsErr, catRows };
}

// 睡眠帯別(SLEEP_BUCKETS)の当日着手率/net。renderSleepBucketCard・computeInsightsのヒント4が
// 共に本関数を呼ぶ単一実装(v143レビュー対応: renderSleepBucketCard側の重複コピーを廃止)。
// blocksByDateは呼び出し元(renderStats)で1回だけ構築したMapを受け取る(全期間=最大728日の
// 描画でbuildBlocksByDateMapのO(全Block数)走査が二重に走らないようにするため)。
// n/datesは「その帯にsleepHが該当する日」全体(Blockが無い日も含む)を数える一方、
// startVals/netValsはそれぞれ実際に値がある日だけを積む非対称があったため(v143レビュー指摘)、
// startDates/netDatesをstartVals/netValsと同じ絞り込みで返し、ドリルダウン先や件数表示が
// 実際に使った日とズレないようにする。
function computeSleepBucketStats(since, today, blocksByDate) {
  const days = [];
  for (let d = since; d <= today; d = addDays(d, 1)) days.push(d);
  const metrics = days.map((d) => computeDailyMetrics(d, { blocksByDate })).filter((m) => m.sleepH != null);
  return SLEEP_BUCKETS
    .map((b) => {
      const inBucket = metrics.filter((m) => b.test(m.sleepH));
      const startRows = inBucket.filter((m) => m.startTotal > 0);
      const netRows = inBucket.filter((m) => m.completedCount > 0);
      return {
        ...b,
        n: inBucket.length,
        startVals: startRows.map((m) => m.startPct),
        startDates: startRows.map((m) => m.date),  // v143: startValsと同じ絞り込みの日付(ドリルダウン用)
        netVals: netRows.map((m) => m.net),
        netDates: netRows.map((m) => m.date)
      };
    })
    .filter((r) => r.n >= SLEEP_BUCKET_MIN_SAMPLES);
}

// 完了Blockのカテゴリ別net中央値(充電効果上位の抽出専用。n>=3・net中央値が正のもののみ)。
function computeChargeTopCategories(since, today) {
  const doneInRange = state.blocks.filter((b) => !b.deleted && b.date >= since && b.date <= today && b.completed);
  const byCat = {};
  doneInRange.forEach((b) => {
    const c = b.category || "未分類";
    (byCat[c] ||= []).push(Number(b.charge || 0) - Number(b.discharge || 0));
  });
  return Object.entries(byCat)
    .filter(([, arr]) => arr.length >= 3)
    .map(([cat, arr]) => ({ cat, med: median(arr), n: arr.length }))
    .filter((r) => r.med > 0)
    .sort((a, b) => b.med - a.med);
}

// computeInsights: 5ルールを評価し、該当したものだけ最大5件(ルールにつき最大1件)を返す
// 決定論関数。文体は観察文のみ(「〜すべき」を出さない、催促・評価語を使わない)。
// 各findingにドリルダウン導線(既存 energy-open-routine/energy-open-category/search-jump の
// data-actionパターンを流用)を持たせる。
function computeInsights(since, today, blocksByDate) {
  const findings = [];

  // 1) 放電超過カテゴリ/曜日(既存computeEnergyStructureの結果を統合表示。二重実装しない)
  // v143レビュー対応(監督者裁定): computeEnergyStructureは足切り条件を含め本体は変更せず、
  // 従来どおり直近4週固定で評価する(他の4ルールはstats-rangeに追従するため、その旨を
  // ヒント文中に明記して混同を防ぐ)。
  const weekStart = weekStartFor(today);
  const struct = computeEnergyStructure(weekStart);
  if (struct.eligible && struct.findings.length) {
    const top = struct.findings[0];
    findings.push({
      id: "discharge",
      text: top.type === "weekday"
        ? `${top.label}が構造的にマイナス(平均 ${top.value.toFixed(1)}、直近4週で評価)`
        : `${top.label}が放電超過(${signed(top.value)}、直近4週で評価)`,
      actions: top.type === "weekday"
        ? [{ action: "energy-open-routine", data: { day: top.dayIndex }, label: `${top.label}のルーティンを見る` }]
        : [{ action: "energy-open-category", data: { cat: top.key }, label: "ブロックを見る" }]
    });
  }

  // 2) 時間帯×曜日の着手率(予定ベース)の上位・下位セルを言語化
  const hmCells = computeHeatmapCells(since, today).filter((c) => c.rate != null);
  if (hmCells.length >= 2) {
    const best = hmCells.reduce((a, b) => (b.rate > a.rate ? b : a));
    const worst = hmCells.reduce((a, b) => (b.rate < a.rate ? b : a));
    if (best !== worst) {
      const bandName = (label) => label.replace(/\(.+\)/, "");
      findings.push({
        id: "heatmap",
        text: `${best.wdLabel}曜${bandName(best.bandLabel)}は着手率${Math.round(best.rate * 100)}%、${worst.wdLabel}曜${bandName(worst.bandLabel)}は${Math.round(worst.rate * 100)}%`,
        actions: [
          { action: "energy-open-routine", data: { day: best.dayIndex }, label: `${best.wdLabel}曜のルーティンを見る` },
          { action: "energy-open-routine", data: { day: worst.dayIndex }, label: `${worst.wdLabel}曜のルーティンを見る` }
        ]
      });
    }
  }

  // 3) 見積誤差が大きいカテゴリ(既存の見積vs実績集計を流用、5件未満ガード踏襲)
  // v143レビュー対応: 丸め後pctではなく生のmedで「意味のある誤差か(±5%以上)」を判定し、
  // 長引きがち/早く終わりがちの方向もmed基準にする(丸め誤差で「100%(早く終わりがち)」の
  // ような自己矛盾文が出ないようにする)。
  const estStats = computeEstimateStats(since, today);
  if (estStats.eligible && estStats.catRows.length) {
    const c = estStats.catRows[0];
    if (Math.abs(c.med - 1) >= 0.05) {  // ±5%未満のズレは観察するほどの意味を持たないため出さない
      const pct = Math.round(c.med * 100);
      findings.push({
        id: "estimate",
        text: `〈${c.cat}〉は実績が見積の${pct}%(${c.med > 1 ? "長引きがち" : "早く終わりがち"}、${c.n}件)`,
        actions: [{ action: "energy-open-category", data: { cat: c.cat }, label: "ブロックを見る" }]
      });
    }
  }

  // 4) 睡眠帯×実績の観察(全体中央値比でもっとも差が大きい帯。3件未満の帯・対サンプルは対象外)
  const bucketRows = computeSleepBucketStats(since, today, blocksByDate)
    .map((r) => ({ ...r, startMed: r.startVals.length >= SLEEP_BUCKET_MIN_SAMPLES ? median(r.startVals) : null }))
    .filter((r) => r.startMed != null);
  if (bucketRows.length >= 2) {
    const overallMed = median(bucketRows.flatMap((r) => r.startVals));
    const worst = bucketRows.reduce((a, b) => (b.startMed - overallMed < a.startMed - overallMed ? b : a));
    const diff = Math.round(worst.startMed - overallMed);
    if (diff <= -5) {  // 全体比-5pt以上の落ち込みだけを観察対象にする(恣意的な閾値。過剰検出を避ける目的)
      // v143レビュー対応: 件数・ドリルダウン先はworst.n(帯の睡眠件数、Blockが無い日も含む)ではなく
      // worst.startVals/startDates(実際に着手率計算に使った日)で揃える。
      const recentDate = worst.startDates.length ? worst.startDates[worst.startDates.length - 1] : null;
      findings.push({
        id: "sleep",
        text: `睡眠${worst.label}の日は着手率が${signed(diff)}pt(全体比、${worst.startVals.length}日)`,
        actions: recentDate ? [{ action: "search-jump", data: { view: "journal", date: recentDate }, label: "直近の該当日を見る" }] : []
      });
    }
  }

  // 5) 充電効果の高いカテゴリ上位(完了Blockのnet中央値、n>=3・正のみ)
  const chargeTop = computeChargeTopCategories(since, today);
  if (chargeTop.length) {
    const c = chargeTop[0];
    findings.push({
      id: "charge",
      text: `〈${c.cat}〉は充電効果が高い(net中央値 ${signed(Math.round(c.med * 10) / 10)}、${c.n}件)`,
      actions: [{ action: "energy-open-category", data: { cat: c.cat }, label: "ブロックを見る" }]
    });
  }

  return findings.slice(0, 5);
}

// 「今週のヒント」節(計器盤の最上部に表示)。0件なら節ごと非表示(静かな計器)。
function renderInsights(since, today, blocksByDate) {
  const findings = computeInsights(since, today, blocksByDate);
  if (!findings.length) return "";
  return `
    <div class="panel stack stats-wide stats-insights-panel">
      <h2>今週のヒント</h2>
      ${findings.map((f) => `
        <div class="stats-insight-row">
          <span class="stats-insight-text">${escapeHTML(f.text)}</span>
          ${f.actions.map((a) => `<button class="btn ghost" data-action="${a.action}"${
            Object.entries(a.data || {}).map(([k, v]) => ` data-${k}="${escapeHTML(String(v))}"`).join("")
          }>${escapeHTML(a.label)}</button>`).join("")}
        </div>`).join("")}
      <div class="muted stats-axis">着手率(予定ベース)=計画Blockのうち実際に着手した割合(ヒートマップ・睡眠帯別と同じ定義。taskchute-notes/decisions.md 2026-07-26参照)。観察のみで判断は含みません</div>
    </div>`;
}

// v167: isDashboardDate/dashboardWeekStart/computeDashboardMetrics/defaultDashboardDate/
//   currentDashboardDate/setDashboardDate/shiftDashboardDate/dashboardRateHTML/
//   dashboardTrendBarsHTML/renderDashboardはsrc/features/dashboard.jsへ移した
//   (app.js冒頭のimportからrenderDashboard等を参照する)。

function renderStats() {
  const range = state.settings.statsRange || "4w";
  const weeks = statsRangeWeeks();
  const thisWeek = weekStartFor(todayISO());
  const today = todayISO();
  const since = addDays(thisWeek, -7 * (weeks - 1));
  // v143: 見積カードの集計をcomputeEstimateStats()へ切り出したため、ここでのローカルmedian()は
  // 不要になった(グローバルなmedian()を各所が使う)。

  // 1) 着手率の週次推移
  const hist = startRateHistory(thisWeek, weeks);
  const withData = hist.filter((h) => h.total > 0);
  const rateChart = withData.length >= 2 ? `
    <div class="panel stack">
      <h2>着手率の週次推移</h2>
      <div class="stats-bars">
        ${hist.map((h) => `
          <div class="stats-bar-cell" title="${h.week}〜: ${h.total ? `${h.pct}%(${h.total}件)` : "記録なし"}">
            <div class="stats-bar">${h.total ? `<div class="stats-bar-fill" style="height:${h.pct}%"></div>` : ""}</div>
          </div>`).join("")}
      </div>
      <div class="muted stats-axis">${hist[0].week.slice(5).replace("-", "/")} 〜 今週 ・ 記録週の平均 ${Math.round(withData.reduce((s, h) => s + h.pct, 0) / withData.length)}%</div>
    </div>` : "";

  // 2) エネルギー収支の週次推移(完了Blockの Σ(充電−放電))
  const nets = hist.map((h) => {
    const done = blocksForWeek(h.week).filter((b) => b.completed);
    return { week: h.week, n: done.length, net: done.reduce((s, b) => s + Number(b.charge || 0) - Number(b.discharge || 0), 0) };
  });
  const netMax = Math.max(1, ...nets.map((x) => Math.abs(x.net)));
  const energyChart = nets.filter((x) => x.n > 0).length >= 2 ? `
    <div class="panel stack">
      <h2>エネルギー収支の週次推移</h2>
      <div class="stats-bars">
        ${nets.map((x) => `
          <div class="stats-bar-cell" title="${x.week}〜: ${x.n ? signed(x.net) : "記録なし"}">
            <div class="wk-net-bar">
              <div class="wk-net-pos">${x.net > 0 ? `<span style="height:${Math.round((x.net / netMax) * 100)}%"></span>` : ""}</div>
              <div class="wk-net-zero"></div>
              <div class="wk-net-neg">${x.net < 0 ? `<span style="height:${Math.round((-x.net / netMax) * 100)}%"></span>` : ""}</div>
            </div>
          </div>`).join("")}
      </div>
      <div class="muted stats-axis">週ごとの Σ(充電 − 放電)。上=充電超過 / 下=放電超過</div>
    </div>` : "";

  // 3) 時間帯 × 曜日の着手ヒートマップ(計画Blockのうち実際に着手した率)
  // v143: セル集計はcomputeHeatmapCells()へ切り出し済み(computeInsightsのヒント2と共有。二重実装しない)
  const hmCells = computeHeatmapCells(since, today);
  const hmHasData = hmCells.some((c) => c.rate != null);
  const hmRows = SCHED_BANDS.map(([, , label], bandIdx) => {
    const rowCells = hmCells.filter((c) => c.bandIdx === bandIdx);
    const cells = rowCells.map((c) => c.rate == null
      ? `<td class="stats-hm-cell empty"></td>`  // n不足はノイズなので出さない
      : `<td class="stats-hm-cell" style="background:rgba(47,185,109,${(0.08 + c.rate * 0.5).toFixed(2)})" title="${c.wdLabel}曜 ${label}: 着手${Math.round(c.rate * 100)}%(${c.n}件)">${Math.round(c.rate * 100)}</td>`
    ).join("");
    return `<tr><th class="stats-hm-band">${label}</th>${cells}</tr>`;
  }).join("");
  const wdLabels = ["土", "日", "月", "火", "水", "木", "金"];
  const heatmap = hmHasData ? `
    <div class="panel stack">
      <h2>時間帯 × 曜日の着手率</h2>
      <div style="overflow-x:auto">
        <table class="stats-hm">
          <tr><th></th>${wdLabels.map((w) => `<th class="stats-hm-wd">${w}</th>`).join("")}</tr>
          ${hmRows}
        </table>
      </div>
      <div class="muted stats-axis">計画Blockのうち実際に着手した率(%)。3件未満のマスは表示しません</div>
    </div>` : "";

  // 4) 見積 vs 実績(見積と実績時刻が両方あるBlock)
  // v143: 集計はcomputeEstimateStats()へ切り出し済み(computeInsightsのヒント3と共有。二重実装しない)
  const estStatsForCard = computeEstimateStats(since, today);
  let estimateCard = "";
  if (estStatsForCard.eligible) {
    const { est, medRatio, meanAbsErr, catRows } = estStatsForCard;
    estimateCard = `
      <div class="panel stack">
        <h2>見積 vs 実績</h2>
        <div class="stats-est-head">実績は見積の中央値 <b>${medRatio}%</b> ・ 平均のズレ <b>${meanAbsErr}分</b> <span class="muted">(${est.length}件)</span></div>
        ${catRows.length ? `
          <table class="stats-est">
            <tr><th>カテゴリ</th><th>実績/見積(中央値)</th><th>件数</th></tr>
            ${catRows.map((r) => `<tr><td>${escapeHTML(r.cat)}</td><td>${Math.round(r.med * 100)}%</td><td>${r.n}</td></tr>`).join("")}
          </table>
          <div class="muted stats-axis">見積からのズレが大きい順(100%=見積どおり)。3件未満のカテゴリは表示しません</div>` : ""}
      </div>`;
  }

  // 範囲内の完了Block(カテゴリ集計・折れ線・ヒストグラムで共用)
  const doneInRange = state.blocks.filter((b) => !b.deleted && b.date >= since && b.date <= today && b.completed);

  // 5) カテゴリ別 時間配分(ドーナツ / inline SVG)
  const catMin = {};
  doneInRange.forEach((b) => {
    const min = _actualDurationMin(b) ?? (b.plannedStartAt && b.plannedEndAt ? Math.max(0, minutesOf(b.plannedEndAt) - minutesOf(b.plannedStartAt)) : 0);
    if (min > 0) catMin[b.category || "未分類"] = (catMin[b.category || "未分類"] || 0) + min;
  });
  const catEntries = Object.entries(catMin).sort((a, b) => b[1] - a[1]);
  const totalMin = catEntries.reduce((s, [, m]) => s + m, 0);
  let donutCard = "";
  if (catEntries.length && totalMin > 0) {
    // 上位6 + その他(凡例が長くなりすぎないように)
    const top = catEntries.slice(0, 6);
    const restMin = catEntries.slice(6).reduce((s, [, m]) => s + m, 0);
    const segs = top.map(([cat, m]) => ({ cat, m, color: getCategoryColor(cat) }));
    if (restMin > 0) segs.push({ cat: "その他", m: restMin, color: "#8E8E93" });
    // r=15.915 → 円周≈100。各弧は dasharray="長さ (100-長さ)"、offset を累積。
    // セグメント間に 1 単位の隙間(surface gap)を入れて隣接を分離。
    const GAP = segs.length > 1 ? 1 : 0;
    let offset = 25;  // 12時方向から開始
    const circles = segs.map((sg) => {
      const frac = (sg.m / totalMin) * 100;
      const len = Math.max(0, frac - GAP);
      const c = `<circle cx="21" cy="21" r="15.915" fill="none" stroke="${sg.color}" stroke-width="7"
        stroke-dasharray="${len.toFixed(2)} ${(100 - len).toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>`;
      offset -= frac;  // 次の弧の開始位置(反時計回りに減算)
      return c;
    }).join("");
    const legend = segs.map((sg) =>
      `<div class="stats-legend-row"><span class="stats-swatch" style="background:${sg.color}"></span>
        <span class="stats-legend-name">${escapeHTML(sg.cat)}</span>
        <span class="stats-legend-val">${fmtMinShort(sg.m)} ・ ${Math.round((sg.m / totalMin) * 100)}%</span></div>`).join("");
    donutCard = `
      <div class="panel stack">
        <h2>カテゴリ別 時間配分</h2>
        <div class="stats-donut-wrap">
          <svg class="stats-donut" viewBox="0 0 42 42" role="img" aria-label="カテゴリ別の時間配分">
            <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--panel-soft)" stroke-width="7"></circle>
            ${circles}
            <text x="21" y="20.5" class="stats-donut-c1">${fmtMinShort(totalMin)}</text>
            <text x="21" y="25" class="stats-donut-c2">合計</text>
          </svg>
          <div class="stats-legend">${legend}</div>
        </div>
        <div class="muted stats-axis">完了Blockの実績時間(無ければ計画時間)をカテゴリ別に集計</div>
      </div>`;
  }

  // 6) カテゴリ別 エネルギー収支(横向き双極バー)
  const catNet = {};
  doneInRange.forEach((b) => {
    const n = Number(b.charge || 0) - Number(b.discharge || 0);
    const c = b.category || "未分類";
    if (!catNet[c]) catNet[c] = { net: 0, n: 0 };
    catNet[c].net += n; catNet[c].n++;
  });
  const netRows = Object.entries(catNet).map(([cat, v]) => ({ cat, ...v })).sort((a, b) => b.net - a.net);
  let catEnergyCard = "";
  if (doneInRange.length >= 5 && netRows.length) {
    const maxAbs = Math.max(1, ...netRows.map((r) => Math.abs(r.net)));
    const rows = netRows.map((r) => {
      const w = Math.round((Math.abs(r.net) / maxAbs) * 50);  // 中央から最大50%
      const pos = r.net > 0, neg = r.net < 0;
      return `<div class="stats-div-row" title="${escapeHTML(r.cat)}: ${signed(r.net)}(${r.n}件)">
        <span class="stats-div-label">${escapeHTML(r.cat)}</span>
        <span class="stats-div-track">
          <span class="stats-div-neg">${neg ? `<span style="width:${w}%"></span>` : ""}</span>
          <span class="stats-div-axis"></span>
          <span class="stats-div-pos">${pos ? `<span style="width:${w}%"></span>` : ""}</span>
        </span>
        <span class="stats-div-val ${neg ? "neg" : pos ? "pos" : ""}">${signed(r.net)}</span>
      </div>`;
    }).join("");
    catEnergyCard = `
      <div class="panel stack">
        <h2>カテゴリ別 エネルギー収支</h2>
        ${rows}
        <div class="muted stats-axis">Σ(充電 − 放電)。右(緑)=充電源 / 左(赤)=放電源</div>
      </div>`;
  }

  // 7) 主要指標の推移(複数折れ線 / inline SVG)。着手率 / MIT / ルーティン。
  const trend = hist.map((h) => {
    const wb = blocksForWeek(h.week);
    const mit = wb.filter((b) => b.isMIT);
    const rt = routineRate(wb);
    return {
      week: h.week,
      start: h.total ? h.pct : null,
      mit: mit.length ? Math.round((mit.filter((b) => b.completed).length / mit.length) * 100) : null,
      routine: rt.total ? rt.pct : null
    };
  });
  const trendSeries = [
    { key: "start", label: "着手率", color: "var(--accent)" },
    { key: "routine", label: "ルーティン", color: "var(--green)" },
    { key: "mit", label: "MIT", color: "var(--orange)" }
  ].filter((s) => trend.filter((t) => t[s.key] !== null).length >= 2);
  let trendCard = "";
  if (trend.filter((t) => t.start !== null).length >= 2 && trendSeries.length) {
    const W = 100, H = 44, padY = 4;
    const xOf = (i) => trend.length > 1 ? (i / (trend.length - 1)) * W : W / 2;
    const yOf = (pct) => padY + (1 - pct / 100) * (H - padY * 2);
    // 注記: viewBox は非等比(preserveAspectRatio=none)で横に伸びるため、SVG内にテキストは置かない
    //       (歪む)。最新値は凡例側に直値表示する = コントラスト WARN の緑/橙も識別できる直ラベル。
    const latest = {};
    const lines = trendSeries.map((s) => {
      const pts = trend.map((t, i) => ({ i, v: t[s.key] })).filter((p) => p.v !== null);
      latest[s.key] = pts.length ? pts[pts.length - 1].v : null;
      const poly = pts.map((p) => `${xOf(p.i).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(" ");
      const dots = pts.map((p) => `<circle cx="${xOf(p.i).toFixed(1)}" cy="${yOf(p.v).toFixed(1)}" r="1" fill="${s.color}"/>`).join("");
      return `<polyline points="${poly}" fill="none" stroke="${s.color}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
    }).join("");
    const legend = trendSeries.map((s) =>
      `<span class="stats-legend-inline"><span class="stats-swatch" style="background:${s.color}"></span>${s.label}${latest[s.key] !== null ? ` <b>${latest[s.key]}%</b>` : ""}</span>`).join("");
    trendCard = `
      <div class="panel stack stats-wide">
        <h2>主要指標の推移</h2>
        <div class="stats-legend-inline-row">${legend}</div>
        <svg class="stats-line-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="着手率・ルーティン・MITの週次推移">
          <line x1="0" y1="${yOf(50)}" x2="${W}" y2="${yOf(50)}" stroke="var(--line)" stroke-width="0.4" stroke-dasharray="2,2"/>
          ${lines}
        </svg>
        <div class="muted stats-axis">週次の実行率(%)。点線=50%。凡例の太字が最新週の値</div>
      </div>`;
  }

  // 8) 記録の継続(コントリビューション・カレンダー / CSS grid)
  const actScore = {};
  const bump = (d, n = 1) => { if (d) actScore[d] = (actScore[d] || 0) + n; };
  Object.entries(state.journals || {}).forEach(([d, t]) => { if (d >= since && d <= today && String(t).trim()) bump(d); });
  Object.entries(state.reports || {}).forEach(([d, t]) => { if (d >= since && d <= today && String(t).trim()) bump(d); });
  (state.zeroThinking?.entries || []).forEach((e) => { if (e.date >= since && e.date <= today) bump(e.date); });
  doneInRange.forEach((b) => bump(b.date));
  const activeDays = Object.keys(actScore).length;
  let calendarCard = "";
  if (activeDays >= 3) {
    // 週(列)× 曜日(行、土→金)。since を含む週の土曜から今週まで。
    const firstSat = weekStartFor(since);
    const weekCols = [];
    for (let ws = firstSat; ws <= thisWeek; ws = addDays(ws, 7)) weekCols.push(ws);
    const bucket = (n) => n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3;  // 強度4段階
    const rows = [0, 1, 2, 3, 4, 5, 6].map((row) => {
      const cells = weekCols.map((ws) => {
        const d = addDays(ws, row);
        if (d > today) return `<span class="stats-cal-cell out"></span>`;
        const n = actScore[d] || 0;
        return `<span class="stats-cal-cell lv${bucket(n)}" title="${d}: 活動 ${n}"></span>`;
      }).join("");
      return `<div class="stats-cal-row">${cells}</div>`;
    }).join("");
    calendarCard = `
      <div class="panel stack stats-wide">
        <h2>記録の継続</h2>
        <div class="stats-cal-scroll"><div class="stats-cal">${rows}</div></div>
        <div class="stats-cal-legend muted">
          <span>少</span>
          <span class="stats-cal-cell lv0"></span><span class="stats-cal-cell lv1"></span><span class="stats-cal-cell lv2"></span><span class="stats-cal-cell lv3"></span>
          <span>多</span>
          <span style="margin-left:auto">記録した日=${activeDays}日(日報・ジャーナル・0秒思考・完了Block)</span>
        </div>
      </div>`;
  }

  // 9) 時間帯別の活動量(ヒストグラム)。実際に着手した時刻の分布。
  const hourStart = 5, hourEnd = 23;
  const hourCounts = Array.from({ length: hourEnd - hourStart + 1 }, () => 0);
  let startTotal = 0;
  state.blocks.filter((b) => !b.deleted && b.date >= since && b.date <= today && b.actualStartAt).forEach((b) => {
    const h = Math.floor(minutesOf(b.actualStartAt) / 60);
    if (h >= hourStart && h <= hourEnd) { hourCounts[h - hourStart]++; startTotal++; }
  });
  let histCard = "";
  if (startTotal >= 5) {
    const hmax = Math.max(1, ...hourCounts);
    const bars = hourCounts.map((c, i) => {
      const hr = hourStart + i;
      return `<div class="stats-hist-cell" title="${hr}時台: ${c}件">
        <div class="stats-hist-bar">${c ? `<div class="stats-hist-fill" style="height:${Math.round((c / hmax) * 100)}%"></div>` : ""}</div>
        <div class="stats-hist-lab">${hr % 3 === (hourStart % 3) ? hr : ""}</div>
      </div>`;
    }).join("");
    histCard = `
      <div class="panel stack stats-wide">
        <h2>時間帯別の活動量</h2>
        <div class="stats-hist">${bars}</div>
        <div class="muted stats-axis">実際に着手した時刻の分布(${startTotal}件)</div>
      </div>`;
  }

  // v142(Codexレビュー指摘): sinceはstatsRangeWeeks()経由でBlockの最古日から決まるため、
  // 「全期間」でもBlockより古い睡眠ログが集計から漏れうる。全期間選択時だけ、睡眠ログの最古日
  // (oldestSleepLogDate)がsinceより前ならそちらを起点にする(他チャートの共有sinceは変えない
  // よう、睡眠セクション専用のローカル変数に限定する)。
  const oldestSleep = range === "all" ? oldestSleepLogDate() : null;
  const sleepSince = oldestSleep && oldestSleep < since ? oldestSleep : since;
  // v143レビュー対応: buildBlocksByDateMap()(state.blocks全走査)は睡眠帯集計の2箇所
  // (renderSleepStats経由とrenderInsights経由)から呼ばれるため、renderStatsでここで1回だけ
  // 構築して両方へ渡す(全期間=最大728日の描画でO(全Block数)走査が二重に走らないようにする)。
  const blocksByDate = buildBlocksByDateMap();
  const sleepStatsCard = renderSleepStats(sleepSince, today, blocksByDate);  // v142: 睡眠セクション(別関数に切り出し済み)
  const insightsCard = renderInsights(since, today, blocksByDate);  // v143: 「今週のヒント」(計器盤の最上部・別関数に切り出し済み)
  // v148(UI改善計画Phase3-3): 計器盤を「常時表示(要約)→詳細(details、既定閉)」の2層にする。
  // 節の配置ルール(固定・新しい節を足すときもこの順を守る):
  //   常時表示 = ヒント(insightsCard)→ 主要指標(rateChart=着手率週次)→ 睡眠1行要約
  //   詳細     = エネルギー収支(energyChart)→ カテゴリ配分(donutCard)→
  //              カテゴリ収支(catEnergyCard)→ 週次推移(trendCard)→ 時間帯×曜日(heatmap)→
  //              時間帯別(histCard)→ 見積(estimateCard)→ 記録の継続(calendarCard)→
  //              睡眠詳細(sleepStatsCard)→ エネルギーカーブ時間帯別(energyCurveCard、v161)
  // 既存チャートは1つも削除せず、詳細detailsへ格納するだけ(claude-ux-review S2/S3対応)。
  const sleepSummaryCard = renderSleepSummaryLine(sleepSince, today);
  const energyCurveCard = renderEnergyCurveCard();  // v161: バッチ生成物が無ければ空文字(節ごと非表示)
  const summaryBody = insightsCard + rateChart + sleepSummaryCard;
  const detailBody = energyChart + donutCard + catEnergyCard + trendCard + heatmap + histCard + estimateCard + calendarCard + sleepStatsCard + energyCurveCard;
  return `
    ${renderHeader("数字で見る実行の実態", "計器盤")}
    <div class="segmented" style="margin-bottom:10px">
      ${[["4w", "4週"], ["12w", "12週"], ["all", "全期間"]].map(([k, l]) =>
        `<button class="${range === k ? "active" : ""}" data-action="stats-range" data-range="${k}">${l}</button>`).join("")}
    </div>
    ${range === "all" ? `<div class="muted" style="font-size:11px; margin-bottom:10px">全期間 = この端末に残っているデータの範囲(アーカイブ済みの期間は含みません)</div>` : ""}
    ${summaryBody ? `<section class="stats-grid">${summaryBody}</section>` : ""}
    ${detailBody ? homeFoldSection("stats-details", false, "stats-details", "", `詳細を見る(時間・エネルギー・見積・継続・睡眠詳細・エネルギーカーブ)`, `<section class="stats-grid">${detailBody}</section>`) : ""}
    ${(!summaryBody && !detailBody) ? emptyPanel("まだ十分なデータがありません。実績が数週間分たまると表示されます。") : ""}
  `;
}

// v170: openRoutineForWeekday(エネルギー構造タブからの遷移先)はsrc/features/routine.jsへ
// 移動した(app.js分割・段階4-4)。呼び出し元(energy-open-routine分岐)はimportで参照する。

function currentWeeklyWeek() {
  // v40: 既定 = 直近の「完了した週」。今日が土曜なら先週、それ以外は今週(進行中)。
  const ws = weekStartFor(todayISO());
  const def = todayISO() === ws ? addDays(ws, -7) : ws;
  return state.settings.weeklySelectedWeek || def;
}

function shiftWeeklyWeek(dir) {
  const next = addDays(currentWeeklyWeek(), dir * 7);
  if (next > weekStartFor(todayISO())) return;  // v40: 未来週へは進めない(今週まで)
  state.settings.weeklySelectedWeek = next;
  persistLocalNoSchedule();  // 週カーソルは UI 状態
  render();
}

// v62: 週次レビュー_*.md の「## 来週のタスク提案」節から `- [ ]` 行を抜き出し、
// それ以外は通常のMarkdownとして renderMarkdown() に渡せるよう本文を分離する。
function splitWeeklyReviewMd(md) {
  const lines = md.split("\n");
  const startIdx = lines.findIndex((l) => l.trim() === "## 来週のタスク提案");
  if (startIdx === -1) return { rest: md, tasks: [], sectionNote: "" };
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { endIdx = i; break; }
  }
  const sectionLines = lines.slice(startIdx + 1, endIdx);
  const tasks = [];
  const noteLines = [];
  sectionLines.forEach((l) => {
    const m = /^-\s*\[ \]\s*(.+)$/.exec(l.trim());
    if (m) tasks.push(m[1].trim());
    else if (l.trim()) noteLines.push(l.trim());
  });
  const rest = [...lines.slice(0, startIdx), ...lines.slice(endIdx)].join("\n");
  return { rest, tasks, sectionNote: noteLines.join(" ") };
}

const _weeklySuggestRegistered = new Set();  // v62: 二重登録防止(セッション内のみ、非永続) "week:index"

// v62: 週次レビュータブの「AI週次レビュー」セクション。直近土曜分のみ表示し、無ければ空文字
// (=非表示)。renderMarkdown() は「来週のタスク提案」節以外に使い、その節だけは行ごとに
// 「+登録」ボタンを添えた独自リストにする(一括登録はしない。Kが1件ずつ判断する)。
function aiWeeklyReviewSectionHTML() {
  const week = weekStartFor(todayISO());
  const md = cachedWeeklyReviewMd[week] || "";
  if (!md) return "";
  const { rest, tasks, sectionNote } = splitWeeklyReviewMd(md);
  return `
    <div class="weekly-sec">
      <h3>🤖 AI週次レビュー(${week})</h3>
      <div class="md-render readonly-md">${renderMarkdown(rest)}</div>
      ${tasks.length ? `
        <div class="ai-weekly-suggest">
          <div class="ai-weekly-suggest-cap">来週のタスク提案</div>
          ${sectionNote ? `<div class="muted" style="font-size:11.5px; margin-bottom:6px">${escapeHTML(sectionNote)}</div>` : ""}
          ${tasks.map((t, i) => {
            const key = `${week}:${i}`;
            const registered = _weeklySuggestRegistered.has(key);
            return `
            <div class="ai-weekly-suggest-row">
              <span class="ai-weekly-suggest-text">${escapeHTML(t)}</span>
              ${registered
                ? `<span class="muted" style="font-size:12px">✓ 登録済み</span>`
                : `<button class="btn ghost" data-action="weekly-suggest-add" data-week="${week}" data-index="${i}">+登録</button>`}
            </div>`;
          }).join("")}
        </div>` : ""}
    </div>`;
}

// v62(m7): 提案行末尾の見積表記「(30分)」「(45分)」(半角/全角括弧どちらも)を estimateMin へ
// 抜き出し、タイトルからは取り除く。無ければそのまま(estimateMinはnull)。
const SUGGEST_ESTIMATE_RE = /[((]\s*(\d+)\s*分\s*[))]\s*$/;
function parseSuggestedTaskTitle(raw) {
  const m = SUGGEST_ESTIMATE_RE.exec(raw.trim());
  if (!m) return { title: raw.trim(), estimateMin: null };
  return { title: raw.slice(0, m.index).trim(), estimateMin: Number(m[1]) };
}

// 「来週のタスク提案」の1行をWBSタスク(todo、「その他」Project直下)として登録する。
// 一括登録はしない設計のため、この関数は常に1件のみを扱う。
function addWeeklySuggestedTask(week, idx) {
  if (!week || !Number.isInteger(idx)) return;
  const key = `${week}:${idx}`;
  if (_weeklySuggestRegistered.has(key)) return;
  const md = cachedWeeklyReviewMd[week] || "";
  const { tasks } = splitWeeklyReviewMd(md);
  const raw = tasks[idx];
  if (!raw) return;
  const { title, estimateMin } = parseSuggestedTaskTitle(raw);
  if (!title) return;
  const otherProject = state.projects.find((p) => p.kind === "other" && !p.deleted);
  if (!otherProject) return showToast("登録先プロジェクトが見つかりません");
  const task = makeTask({ projectId: otherProject.id, title });
  if (estimateMin) task.estimateMin = estimateMin;  // v62(m7): 見積分数をWBSの estimateMin に反映
  state.tasks.push(task);
  _weeklySuggestRegistered.add(key);
  saveAndRender(`「${title}」をWBSに登録しました`);
}

function renderWeekly() {
  const week = currentWeeklyWeek();
  const m = computeWeeklyMetrics(week);
  const review = state.weeklyReviews[week] || { md: "", changeThemeCreated: false };
  const thisWeek = weekStartFor(todayISO());
  const inProgress = week === thisWeek;              // v40: 進行中の週か
  const atCurrent = week >= thisWeek;                // これ以上先へは進めない
  const weekBlocks = blocksForWeek(week);
  const noRecord = weekBlocks.length === 0;          // v40: 記録ゼロの週

  // v40: 実行スコアの4週推移スパークライン(目標線・達成色分けなし=鏡)
  const spark = startRateHistory(week, 4);
  const sparkMax = Math.max(100, ...spark.map((s) => s.pct));
  const sparkHTML = `<div class="wk-spark" title="直近4週の着手率">
    ${spark.map((s, i) => `<div class="wk-spark-bar" style="height:${Math.round((s.pct / sparkMax) * 100)}%" title="${s.week}: ${s.pct}%"></div>`).join("")}
    <span class="wk-spark-val">${spark.map((s) => `${s.pct}%`).join(" → ")}</span>
  </div>`;

  // 日別バー(着手率)
  const execBars = m.daily.map((d) => `
    <div class="wk-bar-cell">
      <div class="wk-bar"><div class="wk-bar-fill" style="height:${d.startPct}%"></div></div>
      <div class="wk-bar-lab">${d.wd}</div>
    </div>`).join("");
  // v40: 日別差引バー(ゼロ軸中央、正=teal / 負=red)
  const netMax = Math.max(1, ...m.daily.map((d) => Math.abs(d.net)));
  const energyBars = m.daily.map((d) => {
    const h = Math.round((Math.abs(d.net) / netMax) * 100);
    return `<div class="wk-bar-cell">
      <div class="wk-net-bar">
        <div class="wk-net-pos">${d.net > 0 ? `<span style="height:${h}%"></span>` : ""}</div>
        <div class="wk-net-zero"></div>
        <div class="wk-net-neg">${d.net < 0 ? `<span style="height:${h}%"></span>` : ""}</div>
      </div>
      <div class="wk-net-val ${d.net < 0 ? "neg" : d.net > 0 ? "pos" : ""}">${d.net === 0 ? "0" : signed(d.net)}</div>
      <div class="wk-bar-lab">${d.wd}</div>
    </div>`;
  }).join("");

  // 問いの動き
  const days = new Set(m.days);
  const weekEntries = (state.zeroThinking?.entries || []).filter((e) => days.has(e.date) && e.questionId);
  const movedMap = {};
  weekEntries.forEach((e) => { movedMap[e.questionId] = (movedMap[e.questionId] || 0) + 1; });
  const moved = Object.entries(movedMap)
    .map(([qid, cnt]) => ({ q: state.questions.find((x) => x.id === qid), cnt }))
    .filter((x) => x.q && !x.q.deleted);
  const stalled = (state.questions || []).filter((q) =>
    !q.deleted && q.status !== "settled" && q.lastTouchedAt && daysBetween(q.lastTouchedAt, todayISO()) >= 14);
  const anyQuestions = (state.questions || []).some((q) => !q.deleted);

  // 12週の弧: この週に締切があるサイクル目標タスク
  const goals = state.projects.filter((p) => !p.deleted && p.kind === "normal" && p.status === "active" && p.twelveWeekStartDate);
  const goalIds = goals.map((p) => p.id);
  const weekTasks = state.tasks.filter((t) => !t.deleted && goalIds.includes(t.projectId)
    && t.dueDate && days.has(t.dueDate));

  return `
    ${renderHeader("週スケールでふりかえる", "週次レビュー")}
    <div class="weekly-nav">
      <button class="btn" data-action="weekly-prev">◀ 前週</button>
      <div class="weekly-week">${weekLabelShort(week)}<span class="weekly-week-dow">(土〜金)${inProgress ? " ・進行中" : ""}</span></div>
      <button class="btn" data-action="weekly-next" ${atCurrent ? "disabled" : ""}>次週 ▶</button>
    </div>

    ${renderExperimentSection()}

    ${noRecord ? `<div class="weekly-sec"><div class="muted" style="font-size:13px">この週は記録がありません。記録ゼロという事実も、ふり返りの対象です。</div></div>` : `
    <div class="weekly-sec">
      <h3>実行スコア</h3>
      <div class="weekly-metric-row">
        <div class="weekly-metric"><span class="weekly-metric-lab">タスクシュート着手</span>
          <span class="weekly-metric-val">${m.tc.pct}<small>%</small></span><span class="weekly-metric-sub">${m.tc.done}/${m.tc.total}</span></div>
        <div class="weekly-metric"><span class="weekly-metric-lab">今日の主役</span>
          <span class="weekly-metric-val">${m.mit.done}<small>/${m.mit.total}</small></span><span class="weekly-metric-sub">${m.mit.pct}%</span></div>
        <div class="weekly-metric"><span class="weekly-metric-lab">ルーティン実行</span>
          <span class="weekly-metric-val">${m.rt.pct}<small>%</small></span><span class="weekly-metric-sub">${m.rt.done}/${m.rt.total}</span></div>
      </div>
      <div class="wk-spark-wrap"><span class="wk-spark-cap">着手率の推移(4週)</span>${sparkHTML}</div>
      <div class="wk-bars">${execBars}</div>
    </div>

    <div class="weekly-sec">
      <h3>エネルギー収支</h3>
      <div class="weekly-energy-tot">充電 <b class="pos">+${m.charge}</b> / 放電 <b class="neg">-${m.discharge}</b> / 差引 <b class="${m.net < 0 ? "neg" : "pos"}">${signed(m.net)}</b></div>
      <div class="wk-bars">${energyBars}</div>
    </div>

    <div class="weekly-sec">
      <h3>戦略 / 雑用 / 休息 配分</h3>
      ${renderBucketGauge(weekBlocks)}
      <div class="muted stats-axis">完了Blockの実績時間(無ければ計画時間)をカテゴリ管理の「バケット」で集計。目標値は設定しません — まず現実を見るための道具です。</div>
      ${renderLeverageSummaryLine(weekBlocks)}
    </div>

    ${renderConditionCorrelation(m)}

    ${renderEnergyStructure(week)}
    `}

    <div class="weekly-sec">
      <h3>2x:10x 時間比トレンド(直近8週)</h3>
      ${renderLeverageTrend(week)}
      <div class="muted stats-axis">完了Blockの実績時間で、資産化+削減(10x)と単発+未設定(2x)の比率を週ごとにならしただけです。目標値はありません。</div>
    </div>

    <div class="weekly-sec">
      <h3>レバレッジ台帳</h3>
      ${renderLeverageLedger(week)}
    </div>

    ${m.wkNum ? `<div class="weekly-sec">
      <h3>12週の弧</h3>
      <div class="weekly-12wy">第 <b>${m.wkNum}</b> 週 / 12週　<span class="muted">残り ${m.daysLeft12} 日</span></div>
      ${weekTasks.length
        ? `<div class="weekly-tasklist">${weekTasks.map((t) => `<div class="home-ck">
            <span class="home-box" data-action="toggle-task" data-id="${t.id}">${t.status === "completed" ? "✓" : ""}</span>
            <span class="home-ck-name" data-action="edit-task" data-id="${t.id}">${escapeHTML(t.title)}</span>
          </div>`).join("")}</div>`
        : `<div class="muted" style="font-size:13px">この週に締切のサイクル目標タスクはありません。</div>`}
    </div>` : ""}

    ${anyQuestions ? `<div class="weekly-sec">
      <h3>問いの動き</h3>
      ${moved.length ? moved.map((x) => `<div class="weekly-q-row" data-action="weekly-open-question"><span class="weekly-q-move">動いた</span>${escapeHTML(x.q.text)} <span class="muted">(+${x.cnt} 本)</span></div>`).join("") : `<div class="muted" style="font-size:13px">この週に問いへ紐づく0秒思考はありませんでした。</div>`}
      ${stalled.map((q) => `<div class="weekly-q-row" data-action="weekly-open-question"><span class="weekly-q-stall">止まっている</span>${escapeHTML(q.text)} <span class="muted">(${daysBetween(q.lastTouchedAt, todayISO())}日)</span></div>`).join("")}
    </div>` : ""}

    ${aiWeeklyReviewSectionHTML()}

    ${readingMonthlySummarySectionHTML()}

    <div class="weekly-cycle-link" data-action="open-cycle">◷ 12週サイクルをふりかえる(節目のレビュー) →</div>

    <div class="weekly-sec weekly-close">
      <h3>締め</h3>
      <button class="btn primary weekly-change-btn" data-action="weekly-change-theme" data-week="${week}">
        ${review.changeThemeCreated ? "✓ 発行済み — もう一度テーマ化する" : "この週から何を変えるか → 0秒思考へ"}
      </button>
      <textarea class="textarea" data-weekly-md="${week}" style="min-height:120px; margin-top:12px" placeholder="この週の気づき・来週変えることをメモ(Markdown)">${escapeHTML(review.md || "")}</textarea>
      <div class="row" style="gap:8px; margin-top:10px; flex-wrap:wrap">
        <button class="btn" data-action="weekly-download" data-week="${week}">週次mdをダウンロード</button>
        ${personalDataReady(state.settings.github) ? `<button class="btn" data-action="weekly-push" data-week="${week}">GitHubへpush</button>` : ""}
      </div>
    </div>
  `;
}

function weeklyChangeTheme(week) {
  if (!week) return;
  const label = weekLabelShort(week);
  state.zeroThinking.themes.push({
    id: crypto.randomUUID(),
    text: `【週次】${label} の週から、何を変えるか?`,
    fav: false, questionId: null, createdAt: nowDateTime()
  });
  const prev = state.weeklyReviews[week] || { md: "", createdAt: nowDateTime() };
  state.weeklyReviews[week] = { ...prev, changeThemeCreated: true, updatedAt: nowDateTime() };
  state.settings.zeroTab = "theme";
  ztTab = "other";
  saveAndRender("「変えること」をテーマにしました");
  setView("zero");
}

function buildWeeklyMarkdown(week) {
  const m = computeWeeklyMetrics(week);
  const review = state.weeklyReviews[week] || { md: "" };
  const lines = [
    `# 週次レビュー ${weekLabelShort(week)}(土〜金)`,
    "",
    "## 実行スコア",
    `- タスクシュート着手: ${m.tc.pct}%(${m.tc.done}/${m.tc.total})`,
    `- 今日の主役(MIT): ${m.mit.done}/${m.mit.total}`,
    `- ルーティン実行: ${m.rt.pct}%(${m.rt.done}/${m.rt.total})`,
    "",
    "## エネルギー収支",
    `- 充電 +${m.charge} / 放電 -${m.discharge} / 差引 ${signed(m.net)}`,
    ""
  ];
  if (m.wkNum) { lines.push("## 12週の弧", `- 第 ${m.wkNum} 週 / 12週(残り ${m.daysLeft12} 日)`, ""); }
  if (review.md && review.md.trim()) { lines.push("## メモ", "", review.md, ""); }
  return lines.join("\n");
}

function downloadWeekly(week) {
  if (!week) return;
  downloadText(`週次_${week}.md`, buildWeeklyMarkdown(week), "text/markdown");
}

async function pushWeeklyToGitHub(week) {
  if (!week) return;
  if (!state.settings.github?.token) return showToast("GitHub設定が未入力です");
  await pushFileToGitHub(`週次_${week}.md`, buildWeeklyMarkdown(week), `週次 ${week}`);
}

// v45: =========================================================
//  12週サイクルの節目レビュー(「第13週」の儀式)
//  日(日報)・週(週次)の上に、最長の実行ループ(12週=84日)を閉じる。
//  指標は都度計算、締めのメモのみ永続化。CONCEPT §4.4 の最長スケール。
// =========================================================
function cycleDays(cycleStart) { return Array.from({ length: 84 }, (_, i) => addDays(cycleStart, i)); }
function cycleLabelShort(cycleStart) {
  return `${cycleStart.replace(/-/g, "/")} 〜 ${addDays(cycleStart, 83).replace(/-/g, "/")}`;
}
function currentCycleStart() {
  return state.settings.cycleSelectedStart || state.settings.twelveWeekStartDate || todayISO();
}
function shiftCycle(dir) {
  const next = addDays(currentCycleStart(), dir * 84);
  const cur = state.settings.twelveWeekStartDate || todayISO();
  if (next > cur) return;  // 未来サイクルへは進めない
  state.settings.cycleSelectedStart = next;
  persistLocalNoSchedule();  // サイクルカーソルは UI 状態
  render();
}
function computeCycleMetrics(cycleStart) {
  const start = cycleStart, end = addDays(cycleStart, 83);
  const inRange = state.blocks.filter((b) => !b.deleted && b.date >= start && b.date <= end);
  const tc = taskchuteStartRate(inRange);
  const rt = routineRate(inRange);
  const completed = inRange.filter((b) => b.completed);
  const charge = completed.reduce((s, b) => s + Number(b.charge || 0), 0);
  const discharge = completed.reduce((s, b) => s + Number(b.discharge || 0), 0);
  const mit = inRange.filter((b) => b.isMIT);
  const mitDone = mit.filter((b) => b.completed).length;
  const goals = state.projects.filter((p) => !p.deleted && p.kind === "normal" && p.status === "active" && p.twelveWeekStartDate);
  const goalStats = goals.map((p) => {
    const tasks = state.tasks.filter((t) => !t.deleted && t.projectId === p.id && isTaskCountable(t));
    const done = tasks.filter((t) => t.status === "completed").length;
    return { title: p.title, done, total: tasks.length, pct: tasks.length ? Math.round(done / tasks.length * 100) : 0 };
  });
  const days = new Set(cycleDays(cycleStart));
  const movedQ = new Set((state.zeroThinking?.entries || []).filter((e) => e.questionId && days.has(e.date)).map((e) => e.questionId)).size;
  const inCycle = (d) => d && d >= start && d <= end;
  const settledQ = (state.questions || []).filter((q) => !q.deleted && q.status === "settled" && inCycle(q.settledAt)).length;
  const bridgedQ = (state.questions || []).filter((q) => !q.deleted && q.linkedProjectId && inCycle(q.settledAt)).length;
  const isCurrent = cycleStart === (state.settings.twelveWeekStartDate || cycleStart);
  const weekNo = isCurrent ? clamp(Math.floor(daysBetween(cycleStart, todayISO()) / 7) + 1, 1, 12) : 12;
  const daysLeft = isCurrent ? Math.max(0, daysBetween(todayISO(), addDays(cycleStart, 84))) : 0;
  return { start, end, tc, rt, charge, discharge, net: charge - discharge, mit: { done: mitDone, total: mit.length }, goalStats, movedQ, settledQ, bridgedQ, weekNo, daysLeft, isCurrent };
}

function renderCycle() {
  const cycleStart = currentCycleStart();
  const m = computeCycleMetrics(cycleStart);
  const review = state.cycleReviews[cycleStart] || { md: "" };
  const atCurrent = cycleStart >= (state.settings.twelveWeekStartDate || todayISO());
  const spark = startRateHistory(weekStartFor(m.end), 12);  // 12週の週次着手率
  const sparkMax = Math.max(100, ...spark.map((s) => s.pct));
  return `
    ${renderHeader("12週スケールでふりかえる", "12週サイクル")}
    <div class="weekly-nav">
      <button class="btn" data-action="cycle-prev">◀ 前サイクル</button>
      <div class="weekly-week">${cycleLabelShort(cycleStart)}<span class="weekly-week-dow">${m.isCurrent ? `・第${m.weekNo}週/12(残り${m.daysLeft}日)` : "・完了"}</span></div>
      <button class="btn" data-action="cycle-next" ${atCurrent ? "disabled" : ""}>次サイクル ▶</button>
    </div>

    <div class="weekly-sec">
      <h3>サイクルの実行スコア</h3>
      <div class="weekly-metric-row">
        <div class="weekly-metric"><span class="weekly-metric-lab">タスクシュート着手</span>
          <span class="weekly-metric-val">${m.tc.pct}<small>%</small></span><span class="weekly-metric-sub">${m.tc.done}/${m.tc.total}</span></div>
        <div class="weekly-metric"><span class="weekly-metric-lab">今日の主役(MIT)</span>
          <span class="weekly-metric-val">${m.mit.done}<small>/${m.mit.total}</small></span><span class="weekly-metric-sub">12週合計</span></div>
        <div class="weekly-metric"><span class="weekly-metric-lab">ルーティン実行</span>
          <span class="weekly-metric-val">${m.rt.pct}<small>%</small></span><span class="weekly-metric-sub">${m.rt.done}/${m.rt.total}</span></div>
      </div>
      <div class="wk-spark-wrap"><span class="wk-spark-cap">週次着手率(12週)</span>
        <div class="wk-spark">${spark.map((s) => `<div class="wk-spark-bar" style="height:${Math.round((s.pct / sparkMax) * 100)}%" title="${s.week}: ${s.pct}%"></div>`).join("")}</div></div>
    </div>

    <div class="weekly-sec">
      <h3>エネルギー収支(12週合計)</h3>
      <div class="weekly-energy-tot">充電 <b class="pos">+${m.charge}</b> / 放電 <b class="neg">-${m.discharge}</b> / 差引 <b class="${m.net < 0 ? "neg" : "pos"}">${signed(m.net)}</b></div>
    </div>

    ${m.goalStats.length ? `<div class="weekly-sec">
      <h3>サイクル目標の到達</h3>
      ${m.goalStats.map((g) => `<div class="cycle-goal">
        <div class="cycle-goal-top"><span>${escapeHTML(g.title)}</span><span class="muted">${g.done}/${g.total} ・ ${g.pct}%</span></div>
        <div class="progress"><span style="width:${g.pct}%"></span></div>
      </div>`).join("")}
    </div>` : ""}

    <div class="weekly-sec">
      <h3>問いの動き(このサイクル)</h3>
      <div class="weekly-q-row" data-action="open-questions">動いた問い <b>${m.movedQ}</b> ・ 結論に至った <b>${m.settledQ}</b> ・ 実行へ橋渡し <b>${m.bridgedQ}</b></div>
    </div>

    <div class="weekly-sec weekly-close">
      <h3>締め — 次の12週へ</h3>
      <div class="muted" style="font-size:12.5px; margin-bottom:10px; line-height:1.7">
        次サイクルの主役プロジェクトは <span data-action="nav" data-view="wbs" style="color:var(--accent);cursor:pointer">WBS</span> の「12WY期間に登録する」で選び直せます。持ち越す問いは 0秒思考の「問い」タブに残ります。
      </div>
      <textarea class="textarea" data-cycle-md="${cycleStart}" style="min-height:120px" placeholder="この12週の総括・次サイクルで変えること(Markdown)">${escapeHTML(review.md || "")}</textarea>
      <div class="row" style="gap:8px; margin-top:10px; flex-wrap:wrap">
        <button class="btn" data-action="cycle-download" data-cycle="${cycleStart}">サイクルmdをダウンロード</button>
        ${personalDataReady(state.settings.github) ? `<button class="btn" data-action="cycle-push" data-cycle="${cycleStart}">GitHubへpush</button>` : ""}
      </div>
      <button class="btn primary" data-action="cycle-start-new" style="margin-top:12px; width:100%">新しい12週を今日から始める</button>
    </div>
  `;
}

function cycleStartNew() {
  if (!window.confirm("新しい12週サイクルを今日から始めますか?\n(12WY開始日を今日に更新します)")) return;
  state.settings.twelveWeekStartDate = todayISO();
  state.settings.cycleSelectedStart = todayISO();
  saveAndRender("新しい12週を始めました。次の主役プロジェクトを WBS で選びましょう");
  setView("wbs");
}
function buildCycleMarkdown(cs) {
  const m = computeCycleMetrics(cs);
  const review = state.cycleReviews[cs] || { md: "" };
  const lines = [
    `# 12週サイクルレビュー ${cycleLabelShort(cs)}`, "",
    "## 実行スコア",
    `- タスクシュート着手: ${m.tc.pct}%(${m.tc.done}/${m.tc.total})`,
    `- 今日の主役(MIT): ${m.mit.done}/${m.mit.total}`,
    `- ルーティン実行: ${m.rt.pct}%(${m.rt.done}/${m.rt.total})`, "",
    "## エネルギー収支(12週合計)",
    `- 充電 +${m.charge} / 放電 -${m.discharge} / 差引 ${signed(m.net)}`, "",
    "## サイクル目標の到達",
    ...(m.goalStats.length ? m.goalStats.map((g) => `- ${g.title}: ${g.pct}%(${g.done}/${g.total})`) : ["- (サイクル目標なし)"]), "",
    "## 問いの動き",
    `- 動いた ${m.movedQ} / 結論 ${m.settledQ} / 実行へ橋渡し ${m.bridgedQ}`, ""
  ];
  if (review.md && review.md.trim()) lines.push("## 総括", "", review.md, "");
  return lines.join("\n");
}
function downloadCycle(cs) { if (cs) downloadText(`12週_${cs}.md`, buildCycleMarkdown(cs), "text/markdown"); }
async function pushCycleToGitHub(cs) {
  if (!cs) return;
  if (!state.settings.github?.token) return showToast("GitHub設定が未入力です");
  await pushFileToGitHub(`12週_${cs}.md`, buildCycleMarkdown(cs), `12週 ${cs}`);
}

// v39: =========================================================
//  問い(Question)エンティティ
//  数週間〜12週スパンで持ち続ける「10xの問い」を第一級オブジェクトにし、
//  0秒思考テーマ化 → entry紐づけ → 日報AIループ → 週次レビューに接続する。
// =========================================================
function makeQuestion({ text = "", origin = "manual" } = {}) {
  return {
    id: crypto.randomUUID(),
    text,
    origin,               // 'manual' | 'zero'(気づきから昇格) | 'review'(週次から)
    status: "open",       // 'open' | 'deepening' | 'settled'
    settledNote: "",
    settledAt: null,
    lastTouchedAt: null,  // 最後に entry が紐づいた日(鮮度判定)
    linkedProjectId: null,  // v44: 結論を実行に移した先
    linkedTaskId: null,     // v44
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
}

// 問いに紐づく entry 数
function questionEntryCount(qId) {
  return (state.zeroThinking?.entries || []).filter((e) => e.questionId === qId).length;
}

const QUESTION_STATUS_LABEL = { open: "未着手", deepening: "深掘り中", settled: "結論" };

function renderQuestionCard(q) {
  const count = questionEntryCount(q.id);
  // 鮮度: 最後の紐づけから30日以上の open/deepening はグレー(自動削除・警告はしない=静かな道具)
  const stale = q.status !== "settled" && q.lastTouchedAt && daysBetween(q.lastTouchedAt, todayISO()) >= 30;
  const touched = q.lastTouchedAt ? `最終 ${q.lastTouchedAt.slice(5).replace("-", "/")}` : "未着手";
  return `
    <div class="q-card ${q.status}${stale ? " is-stale" : ""}">
      <div class="q-card-main">
        <span class="q-badge ${q.status}">${QUESTION_STATUS_LABEL[q.status]}</span>
        <span class="q-text" data-action="question-edit" data-id="${q.id}">${escapeHTML(q.text)}</span>
      </div>
      <div class="q-card-meta">
        <span>${count} 本</span><span class="q-dot"></span><span>${touched}</span>
      </div>
      ${q.status === "settled" && q.settledNote ? `<div class="q-settled-note">${escapeHTML(q.settledNote)}</div>` : ""}
      ${q.status === "settled" && q.linkedProjectId
        ? `<div class="q-linked" data-action="nav" data-view="wbs">→ 実行中: ${escapeHTML(projectName(q.linkedProjectId))}</div>` : ""}
      <div class="q-card-actions">
        ${q.status === "settled"
          ? `${q.linkedProjectId ? "" : `<button class="btn primary" data-action="question-bridge" data-id="${q.id}">→ 実行へ</button>`}
             <button class="btn ghost" data-action="question-reopen" data-id="${q.id}">再び開く</button>`
          : `<button class="btn primary" data-action="question-to-theme" data-id="${q.id}">この問いで書く →</button>
             <button class="btn ghost" data-action="question-settle" data-id="${q.id}">結論にする</button>`}
        <button class="btn ghost" data-action="question-edit" data-id="${q.id}">編集</button>
        <button class="btn ghost" data-action="question-delete" data-id="${q.id}">削除</button>
      </div>
    </div>`;
}

function renderZtQuestionTab() {
  const qs = (state.questions || []).filter((q) => !q.deleted);
  const active = qs.filter((q) => q.status !== "settled").sort((a, b) => {
    // deepening を上に、次に lastTouchedAt 降順
    if ((a.status === "deepening") !== (b.status === "deepening")) return a.status === "deepening" ? -1 : 1;
    return (b.lastTouchedAt || "").localeCompare(a.lastTouchedAt || "");
  });
  const settled = qs.filter((q) => q.status === "settled")
    .sort((a, b) => (b.settledAt || "").localeCompare(a.settledAt || ""));
  return `
    <div class="zt-lead">効率化(2x)ではなく<b>価値の中身(10x)</b>を掘る問い。数週間〜12週で持ち続け、0秒思考で少しずつ深める。</div>
    <section class="panel zt-section">
      <div class="zt-plabel">
        開いている問い
        <span class="zt-plabel-count">${active.length} 件</span>
        <span class="zt-plabel-spacer"></span>
        <button class="zt-mini-btn" data-action="question-add">+ 問いを追加</button>
      </div>
      ${active.length
        ? `<div class="q-list">${active.map(renderQuestionCard).join("")}</div>`
        : `<div class="zt-empty">問いがありません。<span class="zt-empty-sub">「+ 問いを追加」で立てるか、履歴の気づきから昇格できます。</span></div>`}
    </section>
    ${settled.length ? `
      <details class="panel zt-section">
        <summary class="zt-plabel" style="cursor:pointer">結論が出た問い <span class="zt-plabel-count">${settled.length} 件</span></summary>
        <div class="q-list" style="margin-top:12px">${settled.map(renderQuestionCard).join("")}</div>
      </details>` : ""}
  `;
}

// ---- 問い CRUD ----
function openQuestionEditor(id) {
  const q = id ? state.questions.find((x) => x.id === id) : null;
  state.modal = { type: "question", id: id || "" };
  renderModal(buildQuestionModal(q));
}

function buildQuestionModal(q) {
  const isNew = !q;
  const status = q?.status || "open";
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">${isNew ? "問いを追加" : "問いを編集"}</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label class="field-label">問い(数週間持ち続ける "10x" の問い)</label>
          <textarea class="textarea" data-modal-field="text" style="min-height:96px" placeholder="例: SEJ案件で「効率化提案」を「経営指標提案」に変えるには何が要るか">${escapeHTML(q?.text || "")}</textarea>
        </div>
        ${isNew ? "" : `
          <div class="field">
            <label class="field-label">ステータス</label>
            <select class="select" data-modal-field="status">
              ${["open", "deepening", "settled"].map((s) => `<option value="${s}" ${status === s ? "selected" : ""}>${QUESTION_STATUS_LABEL[s]}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label class="field-label">結論・行動化したこと(任意)</label>
            <textarea class="textarea" data-modal-field="settledNote" style="min-height:72px">${escapeHTML(q?.settledNote || "")}</textarea>
          </div>`}
      </div>
      <div class="modal-footer">
        ${isNew ? "" : `<button class="btn danger" data-action="modal-delete">削除</button>`}
        <button class="btn" data-action="modal-close">キャンセル</button>
        <button class="btn primary" data-action="modal-save">保存</button>
      </div>
    </div>`;
}

function saveQuestionFromModal(id, fields) {
  const text = (fields.text || "").trim();
  if (!text) return showToast("問いを入力してください");
  if (id) {
    state.questions = state.questions.map((q) => {
      if (q.id !== id) return q;
      const status = fields.status || q.status;
      return {
        ...q, text, status,
        settledNote: fields.settledNote ?? q.settledNote,
        // settled になった瞬間だけ settledAt を刻む。外れたら消す。
        settledAt: status === "settled" ? (q.settledAt || todayISO()) : null,
        updatedAt: nowDateTime()
      };
    });
  } else {
    state.questions.push(makeQuestion({ text, origin: "manual" }));
  }
  closeModal();
  saveAndRender(id ? "問いを更新しました" : "問いを追加しました");
}

// この問いで 0秒思考を書く(テーマ化 → 書く画面へ)
function questionToTheme(qId) {
  const q = state.questions.find((x) => x.id === qId);
  if (!q) return;
  const theme = { id: crypto.randomUUID(), text: q.text, fav: false, questionId: qId, createdAt: nowDateTime() };
  state.zeroThinking.themes.push(theme);
  saveState();            // テーマを永続化してから
  openZtWrite(theme.id);  // 1分書く画面へ
}

function settleQuestion(qId) {
  state.questions = state.questions.map((q) => q.id === qId
    ? { ...q, status: "settled", settledAt: q.settledAt || todayISO(), updatedAt: nowDateTime() }
    : q);
  saveState();
  render();
  openQuestionBridge(qId);  // v44: 結論を実行へ渡す(what→how)。スキップ可。
}

// v44: 問い→プロジェクト橋。結論を 12WY プロジェクト/タスクに接続する。
function openQuestionBridge(qId) {
  const q = state.questions.find((x) => x.id === qId);
  if (!q || q.linkedProjectId) return;  // 既に橋渡し済みなら何もしない
  state.modal = { type: "questionBridge", id: qId };
  renderModal(buildQuestionBridgeModal(q));
}
function buildQuestionBridgeModal(q) {
  const defaultText = (q.settledNote || "").trim() || q.text;
  const projects = state.projects.filter((p) => !p.deleted && p.kind === "normal");
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">問いを実行へ</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div class="muted" style="font-size:12.5px; line-height:1.6; margin-bottom:12px">「${escapeHTML(q.text)}」に結論が出ました。<br>この結論を実行に移しますか?(スキップも可)</div>
        <div class="field">
          <label class="field-label">実行内容</label>
          <textarea class="textarea" data-qb-text style="min-height:72px">${escapeHTML(defaultText)}</textarea>
        </div>
        <div class="field">
          <label class="field-label">接続先</label>
          <select class="select" data-qb-target>
            <option value="__new__" selected>＋ 新規 12WY プロジェクトにする</option>
            ${projects.map((p) => `<option value="${p.id}">＋ タスクとして追加: ${escapeHTML(p.title)}</option>`).join("")}
            <option value="__skip__">接続しない(結論だけ残す)</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-action="modal-close">スキップ</button>
        <button class="btn primary" data-action="question-bridge-submit">この結論を実行へ</button>
      </div>
    </div>`;
}
function submitQuestionBridge() {
  if (!state.modal || state.modal.type !== "questionBridge") return;
  const qId = state.modal.id;
  const q = state.questions.find((x) => x.id === qId);
  const text = (modalRoot.querySelector("[data-qb-text]")?.value || "").trim();
  const target = modalRoot.querySelector("[data-qb-target]")?.value || "__skip__";
  if (!text || target === "__skip__") { closeModal(); return saveAndRender(); }
  const note = `問いから: ${q ? q.text : ""}`;
  if (target === "__new__") {
    const proj = {
      id: crypto.randomUUID(), kind: "normal", title: text, category: "", status: "active",
      twelveWeekStartDate: state.settings.twelveWeekStartDate || todayISO(),
      description: note, createdAt: nowDateTime(), updatedAt: nowDateTime(), deleted: false
    };
    state.projects.push(proj);
    if (q) { q.linkedProjectId = proj.id; q.updatedAt = nowDateTime(); }
    closeModal();
    saveAndRender("結論を 12WY プロジェクトにしました");
  } else {
    const task = makeTask({ projectId: target, title: text });
    task.description = note;
    state.tasks.push(task);
    if (q) { q.linkedProjectId = target; q.linkedTaskId = task.id; q.updatedAt = nowDateTime(); }
    closeModal();
    saveAndRender("結論をタスクにしました");
  }
  setView("wbs");  // 実行先(WBS)へ。view 遷移は永続化される。
}

function reopenQuestion(qId) {
  state.questions = state.questions.map((q) => q.id === qId
    ? { ...q, status: "deepening", settledAt: null, updatedAt: nowDateTime() }
    : q);
  saveAndRender("問いを再び開きました");
}

function deleteQuestion(qId) {
  if (!window.confirm("この問いを削除しますか?(復元可能)")) return;
  state.questions = state.questions.map((q) => q.id === qId
    ? { ...q, deleted: true, updatedAt: nowDateTime() } : q);
  saveAndRender("問いを削除しました");
}

// 0秒思考の気づき(履歴 entry)を問いに昇格する
function entryToQuestion(entryId) {
  const e = (state.zeroThinking?.entries || []).find((x) => x.id === entryId);
  if (!e) return;
  state.questions.push(makeQuestion({ text: e.theme || (e.body || "").split("\n")[0] || "問い", origin: "zero" }));
  state.settings.zeroTab = "question";
  saveAndRender("この気づきを問いにしました");
}

// v68: =========================================================
//  人生実験カード(state.experiments)
//  仮説を1つだけ走らせ、期限で「続ける(kept)/手放す(dropped)」を判定する軽量ログ。
//  同時に複数走らせない思想(migrationRitualLog/aiPlanSkippedLogと同じ軽量配列の型見本を踏襲)。
//  判定材料の自動集計はバッチ(weekly-extract.py)側。結論はKが書く(機構は集計まで=v39問いと同じ分業)。
// =========================================================
function makeExperiment({ hypothesis = "", metric = "", startDate = "", endDate = "" } = {}) {
  const start = startDate || todayISO();
  return {
    id: crypto.randomUUID(),
    hypothesis,
    metric,
    startDate: start,
    endDate: endDate || addDays(start, 14),
    status: "running",   // 'running' | 'kept' | 'dropped'
    conclusion: "",
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
}

// 「実験中(running)」は常に高々1件(2件目は addExperimentOrGuard() で抑止する)
function activeExperiment() {
  return (state.experiments || []).find((e) => !e.deleted && e.status === "running") || null;
}

// アファメーション昇格候補として表示する、直近の kept 実験(結論があるもののみ)
function latestKeptExperiment() {
  return (state.experiments || [])
    .filter((e) => !e.deleted && e.status === "kept" && e.conclusion)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0] || null;
}

// 「+ 実験を始める」「別の実験を試したい」の共通入口。実験中があれば開かず、絞る文言だけ返す。
function addExperimentOrGuard() {
  if (activeExperiment()) {
    showToast("実験は1つに絞りましょう — 今の実験の結論を出してから次へ");
    return;
  }
  openExperimentEditor(null);
}

function openExperimentEditor(id) {
  const e = id ? state.experiments.find((x) => x.id === id) : null;
  state.modal = { type: "experiment", id: id || "" };
  renderModal(buildExperimentModal(e));
}

function buildExperimentModal(e) {
  const isNew = !e;
  const startDate = e?.startDate || todayISO();
  const endDate = e?.endDate || addDays(startDate, 14);
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">${isNew ? "実験を始める" : "実験を編集"}</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div class="muted" style="font-size:11.5px; line-height:1.6; margin-bottom:10px">同時に走らせる実験は1つまで。仮説を1つ選び、期限を決めて試し、期限が来たら「続ける/手放す」を判定します。</div>
        <div class="field">
          <label class="field-label">仮説(1文)</label>
          <textarea class="textarea" data-modal-field="hypothesis" style="min-height:72px; font-size:16px" placeholder="例: 締切を1日前倒しすると着手率が上がる">${escapeHTML(e?.hypothesis || "")}</textarea>
        </div>
        <div class="field">
          <label class="field-label">判定に使う数字(任意)</label>
          <input class="input" data-modal-field="metric" style="font-size:16px" placeholder="例: 該当タスクの着手率" value="${escapeHTML(e?.metric || "")}">
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">開始日</label>
            <input class="input" type="date" data-modal-field="startDate" value="${startDate}">
          </div>
          <div class="field">
            <label class="field-label">終了日(既定14日後)</label>
            <input class="input" type="date" data-modal-field="endDate" value="${endDate}">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        ${isNew ? "" : `<button class="btn danger" data-action="modal-delete">削除</button>`}
        <button class="btn" data-action="modal-close">キャンセル</button>
        <button class="btn primary" data-action="modal-save">${isNew ? "始める" : "保存"}</button>
      </div>
    </div>`;
}

function saveExperimentFromModal(id, fields) {
  const hypothesis = (fields.hypothesis || "").trim();
  if (!hypothesis) return showToast("仮説を入力してください");
  const metric = (fields.metric || "").trim();
  const startDate = fields.startDate || todayISO();
  const endDate = fields.endDate || addDays(startDate, 14);
  if (id) {
    state.experiments = state.experiments.map((e) => e.id === id
      ? { ...e, hypothesis, metric, startDate, endDate, updatedAt: nowDateTime() }
      : e);
    closeModal();
    saveAndRender("実験を更新しました");
    return;
  }
  // v68: 新規作成の直前にもう一度ガード(モーダルを開いた後に他端末同期等で実験中になった場合の保険)
  if (activeExperiment()) {
    closeModal();
    return showToast("実験は1つに絞りましょう — 今の実験の結論を出してから次へ");
  }
  state.experiments.push(makeExperiment({ hypothesis, metric, startDate, endDate }));
  closeModal();
  saveAndRender("実験を始めました(終了日を過ぎたら判定を促します)");
}

// deleteFromModal() 側で既に確認ダイアログ済みのため、ここでは重ねて confirm しない
// (deleteProject/deleteTask/deleteBlockと同じ流儀)
function deleteExperiment(id) {
  state.experiments = state.experiments.map((e) => e.id === id
    ? { ...e, deleted: true, updatedAt: nowDateTime() } : e);
  saveAndRender("実験を削除しました");
}

// 終了日超過後の判定: 結論(1行)は #exp-conclusion-input から読む(zt-add-text等と同じ、
// 都度再描画を避けるため state には都度バインドしない一回読み取りパターン)
function readExperimentConclusionInput() {
  return (document.querySelector("#exp-conclusion-input")?.value || "").trim();
}

function keepExperiment(id) {
  const conclusion = readExperimentConclusionInput();
  if (!conclusion) return showToast("結論を1行、書いてください");
  state.experiments = state.experiments.map((e) => e.id === id
    ? { ...e, status: "kept", conclusion, updatedAt: nowDateTime() }
    : e);
  saveAndRender("実験を続けることにしました — 原則への昇格候補に残ります");
}

function dropExperiment(id) {
  const conclusion = readExperimentConclusionInput();
  if (!conclusion) return showToast("結論を1行、書いてください");
  state.experiments = state.experiments.map((e) => e.id === id
    ? { ...e, status: "dropped", conclusion, updatedAt: nowDateTime() }
    : e);
  saveAndRender("実験を手放しました");
}

// kept実験の結論を Daily_Affirmation.md への追記候補としてコピーしやすくする(自動書き換えはしない)
async function copyExperimentConclusion(id) {
  const e = (state.experiments || []).find((x) => x.id === id);
  if (!e || !e.conclusion) return;
  try {
    await navigator.clipboard.writeText(e.conclusion);
    showToast("コピーしました — Daily_Affirmation.mdへの追記候補として使えます");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = e.conclusion;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); showToast("コピーしました"); } catch { showToast("コピーに失敗しました"); }
    document.body.removeChild(ta);
  }
}

// ジャーナル/週次レビュー両タブで共有する実験カード。
function renderExperimentSection() {
  const exp = activeExperiment();
  const kept = latestKeptExperiment();
  const overdue = Boolean(exp && exp.endDate && todayISO() > exp.endDate);
  const runningHTML = !exp
    ? `
      <div class="muted" style="font-size:12.5px; line-height:1.6; margin-bottom:10px">今、走らせている実験はありません。仮説を1つ選び、期限を決めて試します(同時に走らせる実験は1つまで)。</div>
      <button class="btn primary" data-action="experiment-add">+ 実験を始める</button>`
    : `
      <div class="exp-hypothesis">${escapeHTML(exp.hypothesis)}</div>
      ${exp.metric ? `<div class="muted" style="font-size:12px; margin-top:4px">判定材料: ${escapeHTML(exp.metric)}</div>` : ""}
      <div class="muted" style="font-size:11.5px; margin-top:6px">${exp.startDate} 〜 ${exp.endDate}${overdue ? "・終了日を過ぎています" : ""}</div>
      ${overdue ? `
        <div class="exp-judge" style="margin-top:10px">
          <label class="field-label">結論(1行)</label>
          <input class="input" id="exp-conclusion-input" style="font-size:16px" placeholder="続ける/手放す理由を1行で">
          <div class="row" style="gap:8px; margin-top:8px; flex-wrap:wrap">
            <button class="btn primary" data-action="experiment-keep" data-id="${exp.id}">続ける(kept)</button>
            <button class="btn" data-action="experiment-drop" data-id="${exp.id}">手放す(dropped)</button>
          </div>
        </div>` : `
        <div class="row" style="gap:8px; margin-top:10px; flex-wrap:wrap">
          <button class="btn ghost" data-action="edit-experiment" data-id="${exp.id}" style="font-size:12px">編集</button>
          <button class="btn ghost" data-action="experiment-add" style="font-size:12px">別の実験を試したい</button>
        </div>`}`;
  const keptHTML = kept ? `
    <div class="exp-promote" style="margin-top:14px; padding-top:12px; border-top:1px solid var(--line-soft)">
      <div class="muted" style="font-size:11.5px; margin-bottom:4px">原則(アファメーション)への昇格候補</div>
      <div class="exp-hypothesis">${escapeHTML(kept.conclusion)}</div>
      <button class="btn ghost" data-action="experiment-copy-conclusion" data-id="${kept.id}" style="font-size:12px; margin-top:8px">結論をコピー</button>
    </div>` : "";
  return `
    <div class="weekly-sec exp-card">
      <h3>🧪 人生実験</h3>
      ${runningHTML}
      ${keptHTML}
    </div>`;
}

// v34: =========================================================
//  0秒思考(Zero Second Thinking)
//  - 一覧: テーマ追加(トグル)/ タブ(それ以外・お気に入り)/ ★切替 / 書く
//  - 書く: 1分カウントダウン(0で停止・入力は継続可)/ 保存で履歴へ
//  - 保存: ★テーマは残す、それ以外は書いたら一覧から消える
//  - 日報: generateReport にその日の 0秒思考を出力
// =========================================================
function renderZeroThinking() {
  if (ztCurrent) return renderZtWrite();
  if (ztEditId) return renderZtEdit();  // v102: 回答済みentryの追記編集画面

  const zt = state.zeroThinking || { themes: [], entries: [] };
  const todayCount = zt.entries.filter((e) => e.date === todayISO()).length;
  const zeroTab = state.settings.zeroTab || "theme";  // v39: テーマ / 問い の2タブ
  const openQ = (state.questions || []).filter((q) => !q.deleted && q.status !== "settled").length;

  return `
    <div class="view-header">
      <div>
        <div class="view-breadcrumb">その他 › ${moreGroupLabelFor("zero")}</div>
        <div class="eyebrow">0 SECOND THINKING</div>
        <h1>0秒思考</h1>
      </div>
      <div class="zt-day-count">
        <div class="zt-day-count-v">今日 <b>${todayCount}</b> 本</div>
        <div class="zt-day-count-sub">→ 日報に含まれます</div>
      </div>
    </div>
    <div class="zt-toptab-row">
      <button class="zt-toptab ${zeroTab === "theme" ? "active" : ""}" data-action="zero-tab" data-tab="theme">テーマ</button>
      <button class="zt-toptab ${zeroTab === "question" ? "active" : ""}" data-action="zero-tab" data-tab="question">問い <span class="zt-tab-count">${openQ}</span></button>
    </div>
    ${zeroTab === "question" ? renderZtQuestionTab() : renderZtThemeTab()}
  `;
}

// v39: テーマタブ(従来の 0秒思考 一覧)
// v90: テーマ1件分の行(グループ表示・未分類表示・グループ無しのフラット表示すべてで共用)。
//      groupsSorted は <select> の選択肢生成に使う(グループ移動のタップ代替)。
function ztRenderThemeItem(t, groupsSorted) {
  const important = t.importance === "高";
  return `
        <div class="zt-theme-item ${t.fav ? "is-fav" : ""}">
          <button class="zt-star ${t.fav ? "on" : ""}" data-action="zt-fav-toggle" data-id="${t.id}" title="お気に入り">${t.fav ? "★" : "☆"}</button>
          <button class="zt-important-toggle ${important ? "on" : ""}" data-action="zt-importance-toggle" data-id="${t.id}" title="重要度: 高⇔なし" aria-label="重要度を切り替え">${important ? "❗" : "❕"}</button>
          <div class="zt-theme-text" data-action="zt-write" data-id="${t.id}">${important ? `<span class="zt-theme-important">高</span>` : ""}${escapeHTML(t.text)}${t.questionId ? `<span class="zt-theme-qtag">問い</span>` : ""}${t.source === "ai-feedback" ? `<span class="zt-theme-qtag">🤖 AI提案</span>` : ""}</div>
          ${groupsSorted.length ? `
          <select class="select zt-theme-group-select" data-action="zt-theme-set-group" data-id="${t.id}" aria-label="大テーマを選ぶ" title="大テーマへ割り当て">
            <option value="">未分類</option>
            ${groupsSorted.map((g) => `<option value="${g.id}" ${t.groupId === g.id ? "selected" : ""}>${escapeHTML(g.title)}</option>`).join("")}
          </select>` : ""}
          <button class="zt-theme-go" data-action="zt-write" data-id="${t.id}">書く →</button>
          <button class="zt-theme-del" data-action="zt-theme-delete" data-id="${t.id}" title="削除" aria-label="このテーマを削除">×</button>
        </div>`;
}

// v90: 1つの大テーマ(グループ)見出し+配下テーマ。折りたたみ状態はztGroupIsOpenで記憶。
function ztRenderGroupSection(group, themesInGroup, groupsSorted) {
  const open = ztGroupIsOpen(group.id);
  return `
      <div class="zt-group">
        <div class="zt-group-head">
          <button class="zt-group-caret" data-action="zt-group-toggle" data-id="${group.id}" aria-label="${open ? "折りたたむ" : "展開"}">${open ? "▾" : "▸"}</button>
          <span class="zt-group-title" data-action="zt-group-rename" data-id="${group.id}" title="タップして名前変更">${escapeHTML(group.title)}</span>
          <span class="zt-plabel-count">${themesInGroup.length} 件</span>
          <span class="zt-plabel-spacer"></span>
          <button class="zt-mini-btn" data-action="zt-group-delete" data-id="${group.id}" title="大テーマを削除(配下は未分類に戻ります)">削除</button>
        </div>
        ${open ? `<div class="zt-group-body">${themesInGroup.map((t) => ztRenderThemeItem(t, groupsSorted)).join("")}</div>` : ""}
      </div>`;
}

// v119: 重要度「高」のテーマを同一グループ内で先頭へ(安定ソートで既存の並び順を壊さず前置)。
function ztSortByImportance(list) {
  return list.slice().sort((a, b) => (b.importance === "高" ? 1 : 0) - (a.importance === "高" ? 1 : 0));
}

// v90: グループが1件も無ければ従来どおりのフラット表示(既存ユーザーの見た目を変えない)。
//      グループを作った時点で初めて、グループ見出し + 末尾「未分類」ゾーンの階層表示に切り替わる。
function ztThemeListHTML(items, groupsSorted) {
  if (!groupsSorted.length) return ztSortByImportance(items).map((t) => ztRenderThemeItem(t, groupsSorted)).join("");
  const sections = groupsSorted.map((g) => {
    const inGroup = ztSortByImportance(items.filter((t) => t.groupId === g.id));
    return inGroup.length ? ztRenderGroupSection(g, inGroup, groupsSorted) : "";
  }).filter(Boolean);
  const groupIds = new Set(groupsSorted.map((g) => g.id));
  const ungrouped = ztSortByImportance(items.filter((t) => !t.groupId || !groupIds.has(t.groupId)));
  if (ungrouped.length) {
    sections.push(`
      <div class="zt-group zt-group-unclassified">
        <div class="zt-group-head static">
          <span class="zt-group-title">未分類</span>
          <span class="zt-plabel-count">${ungrouped.length} 件</span>
        </div>
        <div class="zt-group-body">${ungrouped.map((t) => ztRenderThemeItem(t, groupsSorted)).join("")}</div>
      </div>`);
  }
  return sections.join("");
}

// v100: AI提案お題セクション。pending 0件ならセクション自体を出さない。
function renderZtSuggestions() {
  const pending = ztPendingSuggestions();
  if (!pending.length) return "";
  return `
    <section class="panel zt-section zt-suggest-section">
      <div class="zt-plabel blue">
        AI提案お題
        <span class="zt-plabel-count">${pending.length} 件</span>
      </div>
      <div class="zt-suggest-list">
        ${pending.map((s) => `
        <div class="zt-suggest-item">
          <div class="zt-suggest-body">
            <div class="zt-suggest-text">${escapeHTML(s.text)}</div>
            ${s.reason ? `<div class="zt-suggest-reason">${escapeHTML(s.reason)}</div>` : ""}
          </div>
          <div class="zt-suggest-actions">
            <button class="btn primary" data-action="zt-suggestion-adopt" data-id="${s.id}">採用</button>
            <button class="zt-theme-del" data-action="zt-suggestion-dismiss" data-id="${s.id}" title="却下" aria-label="この提案を却下">×</button>
          </div>
        </div>`).join("")}
      </div>
    </section>
  `;
}

function renderZtThemeTab() {
  const zt = state.zeroThinking || { themes: [], entries: [], groups: [] };
  const favList = zt.themes.filter((t) => t.fav);
  const otherList = zt.themes.filter((t) => !t.fav);
  const items = ztTab === "fav" ? favList : otherList;
  const groupsSorted = (zt.groups || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const themeItemsHTML = items.length
    ? ztThemeListHTML(items, groupsSorted)
    : ztTab === "fav"
      ? `<div class="zt-empty">お気に入りはまだありません。<span class="zt-empty-sub">☆ をタップして登録すると、書いてもここに残り続けます。</span></div>`
      : `<div class="zt-empty">テーマがありません。<span class="zt-empty-sub">「+ テーマを追加」から登録してください。</span></div>`;

  return `
    <div class="zt-lead">1テーマ・<b>1分</b>・手早く書き出す。<b>★お気に入り</b>はずっと残り、それ以外は書いたら消えます。</div>

    ${renderZtSuggestions()}

    <section class="panel zt-section">
      <div class="zt-plabel">
        テーマ一覧
        <span class="zt-plabel-count">全 ${zt.themes.length} 件</span>
        <span class="zt-plabel-spacer"></span>
        <button class="zt-mini-btn" data-action="zt-group-add">+ 大テーマ</button>
        <button class="zt-mini-btn ${ztAddOpen ? "is-on" : ""}" data-action="zt-add-toggle">${ztAddOpen ? "閉じる" : "+ テーマを追加"}</button>
      </div>

      <div class="zt-add-wrap ${ztAddOpen ? "show" : ""}">
        <textarea class="zt-add-text" id="zt-add-text" placeholder="例:&#10;昨日の提案で伝わらなかった理由は&#10;来期、室長として最初の一手は&#10;来週やめるべきことは"></textarea>
        <div class="zt-add-row">
          <button class="btn ghost" data-action="zt-add-cancel">閉じる</button>
          <button class="btn primary" data-action="zt-add-submit">追加する</button>
        </div>
        <div class="zt-add-hint">日報の「明日の0秒思考テーマ」をコピペすると、まとめて登録できます。</div>
      </div>

      <div class="zt-tab-row">
        <button class="zt-tab ${ztTab === "other" ? "active" : ""}" data-action="zt-tab" data-tab="other">それ以外 <span class="zt-tab-count">${otherList.length}</span></button>
        <button class="zt-tab ${ztTab === "fav" ? "active" : ""}" data-action="zt-tab" data-tab="fav">★ お気に入り <span class="zt-tab-count">${favList.length}</span></button>
      </div>

      <div class="zt-theme-list">${themeItemsHTML}</div>
    </section>

    <section class="panel zt-section">
      <div class="zt-plabel blue">
        過去のテーマ
        <span class="zt-plabel-count" id="zt-history-count">${ztHistoryCountLabel()}</span>
      </div>
      <div class="zt-search-row">
        <input class="zt-search-input" id="zt-search" type="search" placeholder="テーマや本文で検索" value="${escapeHTML(ztSearch)}">
      </div>
      <div class="zt-history-list" id="zt-history-list">${ztHistoryListHTML()}</div>
    </section>
  `;
}

function renderZtWrite() {
  const cur = ztCurrent;
  return `
    <div class="zt-write-head">
      <button class="zt-back-btn" data-action="zt-discard">← 一覧へ戻る(破棄)</button>
      <div class="zt-write-date">${escapeHTML(ztFormatDate(todayISO()))}</div>
    </div>

    <div class="zt-write-card run">
      <div class="zt-write-eyebrow"><span class="zt-write-sq"></span>WRITING — 1 MINUTE</div>
      <div class="zt-write-theme">${escapeHTML(cur.text)}</div>
      <div class="zt-timer-bar">
        <div class="zt-timer-time running" id="zt-timer-time">1:00</div>
        <div class="zt-timer-state running" id="zt-timer-state">進行中</div>
      </div>
      <textarea class="zt-write-input" id="zt-write-input" placeholder="・&#10;・&#10;・&#10;・"></textarea>
      <div class="zt-write-actions">
        <button class="btn ghost" data-action="zt-discard">破棄</button>
        <button class="btn green" data-action="zt-save">保存して一覧へ</button>
      </div>
      <div class="zt-write-tip">1分過ぎても入力は続けられます。短く・速く・素直に。完璧に書こうとしない。</div>
    </div>
  `;
}

// v102: 回答済みentryの追記編集画面。書く画面(renderZtWrite)の見た目・textareaを流用しつつ、
//       タイマー無し・既存本文プリフィル・全文編集可(末尾に追記するだけでもよい)にした。
//       元のdate/createdAtは書き換えず、保存時にupdatedAtだけ更新する(v102仕様の帰属維持)。
function renderZtEdit() {
  const zt = state.zeroThinking || { entries: [] };
  const e = (zt.entries || []).find((x) => x.id === ztEditId);
  if (!e) { ztEditId = null; return renderZeroThinking(); }  // entryが消えていた場合の保険
  return `
    <div class="zt-write-head">
      <button class="zt-back-btn" data-action="zt-edit-close">← 一覧へ戻る</button>
      <div class="zt-write-date">${escapeHTML(ztFormatDate(e.date))}</div>
    </div>

    <div class="zt-write-card">
      <div class="zt-write-eyebrow">回答済み — 追記・編集</div>
      <div class="zt-write-theme">${escapeHTML(e.theme || "")}</div>
      <textarea class="zt-write-input" id="zt-edit-input">${escapeHTML(e.body || "")}</textarea>
      <div class="zt-write-actions">
        <button class="btn ghost" data-action="zt-edit-close">閉じる</button>
        <button class="btn green" data-action="zt-edit-save" data-id="${e.id}">保存</button>
      </div>
      <div class="zt-write-tip">本文の続きに書き足すか、全文を書き直すかは自由です。元の日付・回答日時は変わりません。</div>
    </div>
  `;
}

// ---- 履歴(新しい順) ----
function ztFilteredHistory() {
  const zt = state.zeroThinking || { entries: [] };
  const ql = (ztSearch || "").trim().toLowerCase();
  return (zt.entries || [])
    .filter((e) => !ql || (e.theme || "").toLowerCase().includes(ql) || (e.body || "").toLowerCase().includes(ql))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}
function ztHistoryCountLabel() {
  const zt = state.zeroThinking || { entries: [] };
  const total = (zt.entries || []).length;
  const ql = (ztSearch || "").trim();
  return ql ? `${total} 件 ・ 一致 ${ztFilteredHistory().length}` : `${total} 件`;
}
function ztHistoryListHTML() {
  const zt = state.zeroThinking || { entries: [] };
  const list = ztFilteredHistory();
  if (!list.length) {
    return `<div class="zt-empty">${(zt.entries || []).length ? "該当なし" : "履歴はまだありません"}</div>`;
  }
  return list.map((h) => `
    <div class="zt-hi-item" data-action="zt-entry-open" data-id="${h.id}" title="タップして開く・追記">
      <div class="zt-hi-meta">${escapeHTML(h.date)}<span class="zt-hi-dot"></span>0秒思考${h.updatedAt ? `<span class="zt-hi-dot"></span>追記あり` : ""}
        <span class="zt-hi-spacer"></span>
        <button class="zt-hi-promote" data-action="entry-to-question" data-id="${h.id}" title="この気づきを問いにする">→ 問いにする</button>
      </div>
      <div class="zt-hi-theme">${escapeHTML(h.theme)}</div>
      <div class="zt-hi-snippet">${escapeHTML((h.body || "").replace(/\n/g, " / "))}</div>
    </div>`).join("");
}

function ztFormatDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${Number(y)}年${Number(m)}月${Number(d)}日 (${weekdayLabel(iso)})`;
}

// ---- 操作 ----
function ztAddSubmit() {
  const raw = document.querySelector("#zt-add-text")?.value || "";
  const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return showToast("テーマを入力してください");
  lines.forEach((text) => state.zeroThinking.themes.push({
    id: crypto.randomUUID(), text, fav: false, createdAt: nowDateTime()
  }));
  ztAddOpen = false;
  ztTab = "other";  // 追加したテーマはまず「それ以外」に出る
  saveAndRender(`${lines.length}件 追加しました`);
}

// v100: AI提案お題キュー(週次抽象化/日次コーチングのバッチが zeroThinking.suggestedThemes へ
//       追記したpending候補)。生成・削除はバッチ側の責務、ここでは表示用の抽出とstatus遷移のみ扱う。
function ztPendingSuggestions() {
  return (state.zeroThinking?.suggestedThemes || []).filter((s) => s.status === "pending");
}

// 採用: 既存の手動テーマ追加(ztAddSubmit)と同じ経路でテーマ化する。初期配置は未分類(groupId:null)。
// 候補は削除せずstatus="adopted"+adoptedThemeIdへ遷移させる(履歴はstateに残る。掃除はスコープ外)。
function ztSuggestionAdopt(id) {
  const s = (state.zeroThinking.suggestedThemes || []).find((x) => x.id === id && x.status === "pending");
  if (!s) return;
  const theme = { id: crypto.randomUUID(), text: s.text, fav: false, groupId: null, createdAt: nowDateTime() };
  state.zeroThinking.themes.push(theme);
  state.zeroThinking.suggestedThemes = state.zeroThinking.suggestedThemes.map((x) =>
    x.id === id ? { ...x, status: "adopted", adoptedThemeId: theme.id } : x);
  ztTab = "other";  // 採用したテーマはまず「それ以外」に出る(手動追加と同じ挙動)
  saveAndRender(`「${s.text}」を採用しました`);
}

// 却下: status="dismissed"へ遷移させるのみ(候補データ自体は消さない)。
function ztSuggestionDismiss(id) {
  const s = (state.zeroThinking.suggestedThemes || []).find((x) => x.id === id && x.status === "pending");
  if (!s) return;
  state.zeroThinking.suggestedThemes = state.zeroThinking.suggestedThemes.map((x) =>
    x.id === id ? { ...x, status: "dismissed" } : x);
  saveAndRender("却下しました");
}

function ztToggleFav(id) {
  const t = state.zeroThinking.themes.find((x) => x.id === id);
  if (!t) return;
  t.fav = !t.fav;
  saveAndRender();
}

// v119: 重要度トグル(""⇔"高")。fav同様の直接トグルに揃える(モーダルを増やさない)。
function ztToggleImportance(id) {
  const t = state.zeroThinking.themes.find((x) => x.id === id);
  if (!t) return;
  t.importance = t.importance === "高" ? "" : "高";
  saveAndRender();
}

// v86: テーマのワンタップ削除。themesスキーマにdeletedフラグ(=復元可能な軟削除)が無いため、
//      確認は軽めのconfirm()で行う(スキルの「undo可能ならconfirm省略・無理ならconfirm」に従う)。
//      AI由来テーマ(自動取り込みで追加された = source==="ai-feedback")の削除は「不採用」として
//      zeroSecThemeLogへ記録する。自動追加は人の事前承認を経ないため、否定シグナルが自動追加で
//      失われていた——削除という行為でそれを回収し、v75と同じ学習ループ(採否ログ)に乗せる。
//      手動追加のテーマ(source===null)はAIの提案ではないため記録しない。
function deleteZtTheme(id) {
  const t = state.zeroThinking.themes.find((x) => x.id === id);
  if (!t) return;
  if (!confirm(`「${t.text}」を削除しますか?`)) return;
  if (t.source === "ai-feedback") {
    state.zeroSecThemeLog.push({ date: todayISO(), theme: t.text, reason: "", outcome: "skipped", at: nowDateTime() });
    if (state.zeroSecThemeLog.length > ZERO_SEC_THEME_LOG_MAX) {
      state.zeroSecThemeLog = state.zeroSecThemeLog.slice(-ZERO_SEC_THEME_LOG_MAX);
    }
  }
  state.zeroThinking.themes = state.zeroThinking.themes.filter((x) => x.id !== id);
  saveAndRender("削除しました");
}

// ---- v90: テーマ一覧の大テーマ(グループ)階層 ----
// K指示「WBSのプロジェクトのように大テーマ、小テーマの階層構造にしてください」への対応。
// ドラッグ&ドロップは作らず、v79月間ボードのカード上「月選択」と同じ「select常時同居」の
// タップ代替のみで小テーマのグループ移動を成立させる(実装コストと誤操作リスクを避ける)。
// 開閉状態はホームの折りたたみカード(v71 isHomeFoldOpen/setHomeFoldOpen)と同じ
// localStorageベースの記憶機構をそのまま再利用する(専用のstate/永続化を増やさない)。
function ztGroupAdd() {
  const title = (window.prompt("大テーマ名を入力してください") || "").trim();
  if (!title) return;
  const groups = state.zeroThinking.groups || [];
  const nextOrder = groups.length ? Math.max(...groups.map((g) => g.order ?? 0)) + 1 : 0;
  state.zeroThinking.groups = [...groups, {
    id: crypto.randomUUID(), title, order: nextOrder, createdAt: nowDateTime()
  }];
  saveAndRender(`大テーマ「${title}」を追加しました`);
}

function ztGroupRename(id) {
  const g = (state.zeroThinking.groups || []).find((x) => x.id === id);
  if (!g) return;
  const title = (window.prompt("大テーマ名を変更", g.title) || "").trim();
  if (!title || title === g.title) return;
  state.zeroThinking.groups = state.zeroThinking.groups.map((x) => x.id === id ? { ...x, title } : x);
  saveAndRender("大テーマ名を変更しました");
}

// v90: グループ削除。配下テーマはグループごと消さず未分類(groupId:null)へ落とす
//      (指示どおり「テーマは消さない」。deleteProjectの子孫orphan方式とは違い、
//      ここでは明示的にgroupIdをnullへ書き戻す=未分類ゾーンへ実際に移動して見える)。
function ztGroupDelete(id) {
  const g = (state.zeroThinking.groups || []).find((x) => x.id === id);
  if (!g) return;
  const count = (state.zeroThinking.themes || []).filter((t) => t.groupId === id).length;
  const msg = count > 0
    ? `大テーマ「${g.title}」を削除しますか?(配下の${count}件のテーマは未分類に戻ります)`
    : `大テーマ「${g.title}」を削除しますか?`;
  if (!window.confirm(msg)) return;
  state.zeroThinking.themes = state.zeroThinking.themes.map((t) =>
    t.groupId === id ? { ...t, groupId: null } : t);
  state.zeroThinking.groups = state.zeroThinking.groups.filter((x) => x.id !== id);
  saveAndRender(`大テーマ「${g.title}」を削除しました`);
}

// v90: テーマのグループ移動(select常時同居によるタップ代替。change イベント経由)
function ztThemeSetGroup(themeId, groupId) {
  state.zeroThinking.themes = state.zeroThinking.themes.map((t) =>
    t.id === themeId ? { ...t, groupId: groupId || null } : t);
  saveState();
}

// v90: グループの折りたたみ開閉(既定=開いた状態。isHomeFoldOpenのdefaultOpen引数を再利用)
function ztGroupIsOpen(groupId) {
  return isHomeFoldOpen(`zt-group-${groupId}`, true);
}
function ztGroupToggleOpen(groupId) {
  setHomeFoldOpen(`zt-group-${groupId}`, !ztGroupIsOpen(groupId));
  render();
}

function openZtWrite(id) {
  const t = state.zeroThinking.themes.find((x) => x.id === id);
  if (!t) return;
  ztCurrent = { id: t.id, text: t.text, fav: t.fav, questionId: t.questionId || null };  // v39: 問い紐づけを保持
  ztWriteStartedAt = Date.now();  // v104: 実経過時間の計測開始(カウントダウン残数ではなくこちらを保存に使う)
  render();          // 書く画面を描画(DOM 確定)
  startZtTimer();    // その後にタイマー開始
  setTimeout(() => document.querySelector("#zt-write-input")?.focus(), 60);
}

function discardZtWrite() {
  const body = (document.querySelector("#zt-write-input")?.value || "").trim();
  if (body && !confirm("入力を破棄して一覧へ戻りますか?")) return;
  stopZtTimer();
  ztCurrent = null;
  ztWriteStartedAt = null;  // v104
  render();
}

function saveZtEntry() {
  if (!ztCurrent) return;
  const body = (document.querySelector("#zt-write-input")?.value || "").trim();
  if (!body) return showToast("空のままでは保存できません");
  const cur = ztCurrent;
  // v104: 書き始め→保存の実経過秒数(Date.now()差分、文字列パース無し)。60秒カウントダウンを
  //       超えて書き続けた場合も実測される。計測開始が無い異常系はnull。
  const durationSec = ztWriteStartedAt != null ? Math.max(0, Math.round((Date.now() - ztWriteStartedAt) / 1000)) : null;
  state.zeroThinking.entries.push({
    id: crypto.randomUUID(),
    date: todayISO(),
    theme: cur.text,
    body,
    questionId: cur.questionId || null,  // v39: どの問いの下で書いたか
    createdAt: nowDateTime(),
    updatedAt: null,  // v102: 追記編集した時にだけ埋まる(未編集はnull)
    durationSec  // v104: 参考情報。追記編集(saveZtEdit)では変更しない
  });
  // v39: 問いに紐づく entry なら、問いの鮮度を更新し open→deepening へ自動遷移
  if (cur.questionId) {
    state.questions = state.questions.map((q) => q.id === cur.questionId
      ? { ...q, lastTouchedAt: todayISO(), status: q.status === "open" ? "deepening" : q.status, updatedAt: nowDateTime() }
      : q);
  }
  // ★テーマは残す、それ以外は書いたら一覧から消す(履歴には残る)
  if (!cur.fav) {
    state.zeroThinking.themes = state.zeroThinking.themes.filter((x) => x.id !== cur.id);
  }
  stopZtTimer();
  ztCurrent = null;
  ztWriteStartedAt = null;  // v104
  saveAndRender(cur.fav ? "保存しました(★は残ります) — 日報に追加" : "保存しました — 日報に追加");
}

// v102: 過去のentry(回答済み)を開いて追記・編集する。書く画面(ztCurrent)とは別の
//       独立した一時状態(ztEditId)にしたのは、「テーマから新規に書く」と「回答済みを開き直す」で
//       意味が異なる(タイマー無し・questionId連動無し)ため、既存フローに割り込ませず並置した。
function openZtEntry(id) {
  const e = (state.zeroThinking?.entries || []).find((x) => x.id === id);
  if (!e) return;
  ztEditId = id;
  render();
  setTimeout(() => {
    const ta = document.querySelector("#zt-edit-input");
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }  // カーソルを末尾へ(追記しやすく)
  }, 60);
}

// 未保存の変更があるときだけ確認する(discardZtWriteと同じ「変更があれば確認」方針)。
function closeZtEdit() {
  const e = (state.zeroThinking?.entries || []).find((x) => x.id === ztEditId);
  const ta = document.querySelector("#zt-edit-input");
  if (e && ta && ta.value.trim() !== (e.body || "").trim() && !confirm("編集中の内容を破棄して戻りますか?")) return;
  ztEditId = null;
  render();
}

// 保存: 本文を丸ごと差し替え、updatedAtだけ更新する。date/createdAt(元の帰属日・回答日時)は
// 変更しない — export先(zero-thinking-export.py)が date でその日のmdへ振り分ける契約のため、
// 追記編集で日付が変わってしまうと過去の日報側の記録が壊れる。
function saveZtEdit(id) {
  const ta = document.querySelector("#zt-edit-input");
  const body = (ta?.value || "").trim();
  if (!body) return showToast("空のままでは保存できません");
  const found = state.zeroThinking.entries.some((e) => e.id === id);
  if (!found) return;
  state.zeroThinking.entries = state.zeroThinking.entries.map((e) =>
    e.id === id ? { ...e, body, updatedAt: nowDateTime() } : e);
  ztEditId = null;
  saveAndRender("追記を保存しました");
}

// ---- タイマー(1分カウントダウン。0で停止のみ、入力は継続可) ----
function startZtTimer() {
  clearInterval(ztTimerInterval);
  ztTimerLeft = 60;
  updateZtTimerDisplay();
  ztTimerInterval = setInterval(() => {
    ztTimerLeft--;
    updateZtTimerDisplay();
    if (ztTimerLeft <= 0) {
      clearInterval(ztTimerInterval);
      ztTimerInterval = null;
      const s = document.querySelector("#zt-timer-state");
      const t = document.querySelector("#zt-timer-time");
      if (s) { s.textContent = "終了 — 書き終えたら保存"; s.className = "zt-timer-state done"; }
      if (t) t.className = "zt-timer-time done";
    }
  }, 1000);
}
function updateZtTimerDisplay() {
  const left = Math.max(0, ztTimerLeft);
  const el = document.querySelector("#zt-timer-time");
  if (el) el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}
function stopZtTimer() {
  clearInterval(ztTimerInterval);
  ztTimerInterval = null;
}

function renderDateBar() {
  // v47: 別日を見ている時だけ「今日へ」を出す(戻り道を1タップに)
  const isToday = state.selectedDate === todayISO();
  return `
    <div class="datebar">
      <button class="btn" data-action="date-prev">前日</button>
      <input class="input" type="date" data-date-picker value="${state.selectedDate}">
      <button class="btn" data-action="date-next">翌日</button>
      ${isToday ? "" : `<button class="btn primary" data-action="today">今日へ</button>`}
      <button class="btn ghost" data-action="open-search" title="横断検索(0秒思考・ジャーナル・問い・日報)" aria-label="横断検索">🔍</button>
    </div>
  `;
}

function addProject() {
  const title = document.querySelector("#projectTitle")?.value.trim();
  const kind = document.querySelector("#projectKind")?.value || "normal";
  if (!title) return showToast("Project名を入力してください");
  state.projects.push({
    id: crypto.randomUUID(),
    kind,
    title,
    category: "",
    status: "active",
    priority: "中",  // v63: WIP上限アラート(提案2)
    twelveWeekStartDate: kind === "normal" ? state.settings.twelveWeekStartDate || "" : "",
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  });
  saveAndRender("Projectを追加しました");
}

function deleteProject(id) {
  // v127追補(Codex P1): やりたいことの唯一のコンテナ(kind:"wish")は削除させない。
  // 削除するとgetWishProject()が見つからなくなり、normalizeStateが新しい空のWish Projectを
  // 再生成してしまい、既存のWishタスクは旧projectIdのままWishタブから見えなくなる。
  // buildProjectModal側でも削除ボタン自体を出していない(UI/関数の二重ガード)。
  const target = state.projects.find((p) => p.id === id);
  if (target && target.kind === "wish") {
    return showToast("「Wish」はやりたいことの保存先のため削除できません");
  }
  state.projects = state.projects.map((project) => project.id === id ? { ...project, deleted: true, updatedAt: nowDateTime() } : project);
  saveAndRender("Projectを削除しました");
}

function addTask() {
  const title = document.querySelector("#taskTitle")?.value.trim();
  const projectId = document.querySelector("#taskProject")?.value || "";
  if (!title) return showToast("Task名を入力してください");
  state.tasks.push(makeTask({ projectId, title }));
  saveAndRender("Taskを追加しました");
}

function makeTask({ projectId = "", parentTaskId = "", title = "", category = "", dueDate = "", targetYear = null, targetMonth = null, lifeArea = "", motivation = "", leverageType = "" }) {
  // v127追補(Codex P2): Wish Project配下のTaskは「今日」の既定期日を付けない。
  //      addWish/addWishSubtaskは従来から作成後にdueDateを明示的に空へ戻していたが(v79)、
  //      WBS経由の汎用作成経路(addTask/openTaskCreator、いずれもこのmakeTaskを共有)は
  //      素通りしていたため、Wish Project配下に作った瞬間に当日期日が付き、addWish系との
  //      挙動不一致・バックログ/朝プラン候補への意図しない混入が起きていた。
  //      v133追補(K指示): 呼び出し元が明示的にdueDate引数を渡した場合はそれを尊重してしまう
  //      抜け道が残っていた(dueDate || (isWishProject ? "" : ...) は渡された値が真なら素通り)。
  //      Wish Project配下は明示的なdueDate引数も無視し、常に空にする(意図的な期日はWishタブの
  //      期限入力[wish-set-duedate、v79]から作成後に設定する運用のまま変えない)。
  const isWishProject = state.projects.some((p) => p.id === projectId && p.kind === "wish");
  return {
    id: crypto.randomUUID(),
    projectId,
    parentTaskId,
    title,
    category,
    status: "todo",
    dueDate: isWishProject ? "" : (dueDate || state.selectedDate),
    description: "",
    leverageType,  // v65: 10x機構(2-1)。"asset"|"eliminate"|"oneoff"|""(未設定)
    aiWork: false,      // v67: AI作業ワーカー連携(柱2)
    aiWorkBrief: "",    // v67: 何をしてほしいか・成果物の置き場希望(1〜2行)
    progressNum: 0,     // v95: WBS進捗(分子)。0=未着手扱い
    progressDen: 10,    // v95: WBS進捗(分母)。既定10
    doneCriteria: "",   // v96: 完了条件(終わったら残る物を1文で。既定は空欄=未設定)
    firstStep: "",       // v96: スモールステップ(5〜15分で終わる最初の行動。既定は空欄=未設定)
    criteriaRequest: false,  // v99: 翌朝バッチへのAI設定依頼フラグ(既定OFF)
    selfDueOff: false,  // v117(B): 自己締切の自動前倒し。既定false=前倒しON
    // v16: やりたいことリスト用フィールド
    targetYear,         // いつまでに(数字の年、null なら「いつか」)
    targetMonth,        // v79: 月間プランニングボード用(1-12、null なら「未定」。targetYearとは独立)
    lifeArea,           // 人生領域(健康/仕事/家族/趣味/旅/学び/経験/持物)
    motivation,         // なぜやりたいか(自由記述)
    realized: false,    // 実現済みか
    realizedDate: "",   // 実現日(YYYY-MM-DD)
    // v18: ルーティン連携(カテゴリ「ルーティン」の Task のみ意味を持つ)
    nextRoutineId: "",  // 完了時に「次:○○」として表示する後続ルーティン Task の ID
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
}

// Project 配下に Task を直接追加(prompt でタイトル入力)
// v47: prompt をやめ、最初から編集モーダルで新規作成(1画面で名前も詳細も入る)
function addTaskToProject(projectId) {
  openTaskCreator({ projectId });
}

// Task のサブタスクを追加(親と同じ projectId / カテゴリを継承)
function addSubtask(parentTaskId) {
  const parent = state.tasks.find((t) => t.id === parentTaskId);
  if (!parent) return;
  // 階層制限: 既に depth 2 の Task に対しては作らない
  const depth = getTaskDepth(parent);
  if (depth >= 2) {
    showToast("これ以上の階層は作れません(最大 3 階層)");
    return;
  }
  openTaskCreator({ projectId: parent.projectId, parentTaskId, category: parent.category || "" });
}

// v47: 新規タスク作成モーダル(既存のタスクモーダルを新規モードで流用)
function openTaskCreator({ projectId = "", parentTaskId = "", category = "" } = {}) {
  const stub = makeTask({ projectId, parentTaskId, category });
  stub.id = "";           // id 空 = 新規(保存時に採番)
  stub.title = "";
  state.modal = { type: "task", id: "" };
  renderModal(buildTaskModal(stub));
  setTimeout(() => modalRoot.querySelector('[data-modal-field="title"]')?.focus(), 60);
}

function getTaskDepth(task) {
  let depth = 0;
  let cur = task;
  while (cur?.parentTaskId) {
    depth++;
    if (depth > 5) break;  // 循環参照対策
    cur = state.tasks.find((t) => t.id === cur.parentTaskId);
  }
  return depth;
}

function toggleTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  if (task.status === "completed") {
    // v48: 完了解除時、Block の着手実績があれば doing に戻す(todo に落とすと実績が見えなくなる)
    const hasProgress = state.blocks.some((b) => !b.deleted && b.taskId === id && (b.completed || b.actualStartAt));
    state.tasks = state.tasks.map((t) => t.id === id
      ? { ...t, status: hasProgress ? "doing" : "todo", updatedAt: nowDateTime() } : t);
    saveAndRender("Taskを未完了に戻しました");
    return;
  }
  state.tasks = state.tasks.map((t) => t.id === id
    ? { ...t, status: "completed", progressNum: fillProgressOnComplete(t), updatedAt: nowDateTime() } : t);
  // v48: 完了した Task の今日以降の「未着手」予定 Block(ゾンビ予定)を確認つきで整理。
  //      完了済みはもちろん、着手済み(actualStartAt あり)も実績なので対象外。
  const stale = state.blocks.filter((b) => !b.deleted && b.taskId === id && !b.completed && !b.actualStartAt && b.date >= todayISO());
  if (stale.length && window.confirm(`このTaskの今日以降の未完了Block ${stale.length}件も削除しますか?\n(完了済みの実績はそのまま残ります)`)) {
    const ids = new Set(stale.map((b) => b.id));
    state.blocks = state.blocks.map((b) => ids.has(b.id) ? { ...b, deleted: true, updatedAt: nowDateTime() } : b);
  }
  saveAndRender("Taskを完了しました");
}

function deleteTask(id) {
  state.tasks = state.tasks.map((task) => task.id === id ? { ...task, deleted: true, updatedAt: nowDateTime() } : task);
  state.blocks = state.blocks.map((block) => block.taskId === id ? { ...block, taskId: "", updatedAt: nowDateTime() } : block);
  saveAndRender("Taskを削除しました");
}

function createBlockFromTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  // v29: 予定の開始/終了日時をデフォルトで入れる
  const { plannedStartAt, plannedEndAt } = defaultPlannedTimes();
  state.blocks.push(makeBlock({
    taskId,
    date: state.selectedDate,
    title: task.title,
    category: task.category || projectName(task.projectId),
    plannedStartAt,
    plannedEndAt
  }));
  saveAndRender("今日のBlockに追加しました");
}

// v28: 「その他」Project 直下の受け皿 Task を取得
function getOtherTask() {
  return state.tasks.find((t) => t.kind === "other" && !t.deleted);
}

// v29: Block 作成時のデフォルト予定時刻。
// 現在時刻を 15 分単位に切り捨てた時刻を開始、その 1 時間後を終了とする。
// 当日 23:59 を上限にクランプ。日付は既定で選択中の日付だが、
// v152レビュー対応: 呼び出し元が明示的に基準日(dateOverride)を渡せば
// それを使う(wishSubtaskToTasksのように「常に実時計の今日」が要件の経路向け。
// 他の既存呼び出し元は引数無しのまま=挙動不変)。
function defaultPlannedTimes(dateOverride) {
  const now = new Date();
  const maxMin = 24 * 60 - 1;  // 23:59
  let startMin = now.getHours() * 60 + Math.floor(now.getMinutes() / 15) * 15;
  if (startMin > maxMin) startMin = maxMin;
  let endMin = startMin + 60;
  if (endMin > maxMin) endMin = maxMin;
  const d = dateOverride || state.selectedDate;
  const fmt = (mins) => `${d}T${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}:00`;
  return { plannedStartAt: fmt(startMin), plannedEndAt: fmt(endMin) };
}

function addBlock() {
  const title = document.querySelector("#blockTitle")?.value.trim();
  const category = document.querySelector("#blockCategory")?.value || "";
  if (!title) return showToast("Block名を入力してください");
  // v28: タスクシュート画面から追加した Block は「その他」Project に自動で紐づける
  //      (Task 紐づけが無いとタスクシュート画面に表示されないため)
  const otherTask = getOtherTask();
  // v29: 予定の開始/終了日時をデフォルトで入れる
  const { plannedStartAt, plannedEndAt } = defaultPlannedTimes();
  state.blocks.push(makeBlock({
    date: state.selectedDate,
    title,
    category,
    taskId: otherTask ? otherTask.id : "",
    plannedStartAt,
    plannedEndAt
  }));
  saveAndRender("Blockを追加しました");
}

// v150レビュー対応(項目2): 実績開始時刻を「終了−予定所要」で巻き戻す際に使う。
// new Date(文字列)のTZ誤解釈(iOS Safari)を避けるため、localDateTimeToMsと同じ数値
// コンストラクタ経由で計算する(秒は切り捨て。用途がactualStartAtの丸め値のため秒精度は不要)。
function subtractMinutesFromDateTime(dateTimeStr, minutes) {
  const d = new Date(localDateTimeToMs(dateTimeStr) - minutes * 60000);
  return `${dateToISO(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// v150レビュー対応(項目2、両レビュー一致): 即完了で実績開始時刻を自動記録する際、
// 単純に「現在時刻」を入れると、未着手のまま先取り完了した場合にactualStartAt=actualEndAtの
// 0分実績になり、日報「時間実行」の集計(実績両方ありのBlockだけ分加算する分岐)が抜け落ちる。
// plannedStartAtがあればそれを使い(実態に近い)、無ければ終了時刻をそのまま使う。
// さらに、plannedStartAtが終了時刻より後(未来のBlockを先取り完了した等)で開始>終了に
// なってしまう場合は、終了−予定所要(estimateMinか、plannedStart/End差)ぶん巻き戻す
// (それも無ければ開始=終了、従来どおり0分実績を許容)。
// 日時文字列は "YYYY-MM-DDTHH:mm" 形式でゼロ埋めされているため、文字列としての大小比較が
// そのまま時系列の前後判定になる(既存のlocalDateTimeToMs節と同じ前提)。
function quickCompleteActualStart(block, endDateTime) {
  let start = block.actualStartAt || block.plannedStartAt || endDateTime;
  if (start > endDateTime) {
    let estimateMin = Number.isFinite(block.estimateMin) && block.estimateMin > 0 ? block.estimateMin : null;
    if (!estimateMin && block.plannedStartAt && block.plannedEndAt) {
      const d = minutesOf(block.plannedEndAt) - minutesOf(block.plannedStartAt);
      if (d > 0) estimateMin = d;
    }
    start = estimateMin ? subtractMinutesFromDateTime(endDateTime, estimateMin) : endDateTime;
  }
  return start;
}

// v150レビュー対応(項目4): 即完了(quick complete)で自動補完した値(実績時刻・充放電)を
// blockId単位で退避しておき、同セッション内で完了解除(トグルOFF)されたときに元へ戻す。
// セッション限りの非永続モジュール変数(セッションを跨いだ解除は現状維持=許容、CHANGES参照)。
// 各フィールドは { before, after } を持ち、「復元時点でも値がafterのまま(=自動補完後に
// 手で編集されていない)」ときだけbeforeへ戻す(実績編集モーダル等で意図的に直した値を
// 完了解除のたびに巻き戻してしまわないための安全策)。
let _quickCompleteSnapshots = {};

// v150(UI改善計画Phase4b・R3): 「完了」作法の統一。ホーム今日タブのドット/タスクシュートの✓/
// タイムラインの○/ながれのチェックなど、完了へ向かうすべての導線をこの関数(即完了)に一本化した
// (従来はtoggle-block=即完了 / complete-block-with-actual=実績モーダル、の2系統が混在し
// 入口によって挙動が変わっていた=T4/H4)。完了へ切り替わる瞬間に実績開始/終了時刻を
// (未設定なら)現在時刻ベースで補完し、充放電はprefillEnergy(過去実績の中央値)で自動記録する
// (v150レビュー対応: 手入力済みの充放電は上書きしない、項目3)。
// 従来どおり実績入力モーダル自体は削除せず、完了直後のトーストの「実績を編集」ボタンから
// 開けるようにした(saveAndRenderのtoastOpts、下記参照)。ポモドーロ完了経路(completePomodoro)
// は対象外(現行維持、K指示)。
function toggleBlock(id) {
  let justCompleted = false;
  let completedBlock = null;
  // v153: 今日の芽。段階が上がった直後だけ控えめなフェードインを掛けるため、トグル前後の
  // ルーティン実行率から段階ランクを比較する(v150の統一完了経路=このtoggleBlockのみが対象。
  // routine-bulk-check等の他経路は再描画で段階自体は即時反映されるが、フェード演出は付けない)。
  const toggledBlock = blockById(id);
  const gardenDate = toggledBlock && toggledBlock.category === "ルーティン" && !toggledBlock.deleted ? toggledBlock.date : null;
  const prevGardenRank = gardenDate ? gardenStageRank(routineRate(blocksForDate(gardenDate))) : -1;
  state.blocks = state.blocks.map((block) => {
    if (block.id !== id) return block;
    const completed = !block.completed;
    if (completed && block.taskId) {
      state.tasks = state.tasks.map((task) => task.id === block.taskId && task.status === "todo" ? { ...task, status: "doing", updatedAt: nowDateTime() } : task);
    }
    let next = { ...block, completed, updatedAt: nowDateTime() };
    if (completed) {
      justCompleted = true;
      const snapshot = {};
      if (!next.actualEndAt) {
        next.actualEndAt = nowDateTime();
        snapshot.actualEndAt = { before: block.actualEndAt, after: next.actualEndAt };
      }
      if (!next.actualStartAt) {
        // v150レビュー対応(項目2): plannedStartAt優先+開始>終了の丸め込み(上記関数参照)。
        next.actualStartAt = quickCompleteActualStart(block, next.actualEndAt);
        snapshot.actualStartAt = { before: block.actualStartAt, after: next.actualStartAt };
      }
      // v150レビュー対応(項目3、両レビュー一致): 充放電は実績モーダル(buildActualEntryModal)と
      // 同じprefillEnergyを使うが、既に手入力の値(charge/dischargeのどちらかが非0)がある場合は
      // 上書きしない(過去実績が3件未満ならprefillEnergy自体がnullを返し従来どおり無補完)。
      if (!block.charge && !block.discharge) {
        const pf = prefillEnergy(next);
        if (pf) {
          next.charge = pf.charge;
          next.discharge = pf.discharge;
          snapshot.charge = { before: block.charge, after: next.charge };
          snapshot.discharge = { before: block.discharge, after: next.discharge };
        }
      }
      if (Object.keys(snapshot).length) _quickCompleteSnapshots[id] = snapshot;
      else delete _quickCompleteSnapshots[id];
      completedBlock = next;
    } else {
      // v150レビュー対応(項目4): 完了解除。このセッション内でこのBlockを即完了したときの
      // 自動補完スナップショットがあれば、「補完後に手で変更されていない」フィールドだけ元へ戻す。
      const snap = _quickCompleteSnapshots[id];
      if (snap) {
        for (const field of ["actualStartAt", "actualEndAt", "charge", "discharge"]) {
          if (snap[field] && next[field] === snap[field].after) next[field] = snap[field].before;
        }
        delete _quickCompleteSnapshots[id];
      }
    }
    return next;
  });
  // v115: アンカー配置(提案G③)。完了したBlockが繰り返しルーティンに属していれば、
  // それをアンカーにする後続のルーティン/チェーンを直後の時刻に自動配置する。
  if (justCompleted && completedBlock && completedBlock.recurrenceGroupId) {
    triggerAnchorPlacements(completedBlock.recurrenceGroupId, nowDateTime());
  }
  // v153: 今日の芽。段階が上がっていれば非永続フラグを立てる(render()直後にクリア、
  // state._justStartedBlockIdと同じ「1回の描画で消費」パターン)。
  if (gardenDate) {
    const nextRank = gardenStageRank(routineRate(blocksForDate(gardenDate)));
    if (nextRank > prevGardenRank) state._gardenJustGrewDate = gardenDate;
  }
  if (justCompleted && completedBlock) {
    // v150: 完了直後だけ「実績を編集」ボタン付きトースト(既存の実績モーダルを編集導線として再利用)。
    saveAndRender("Blockを完了しました", { blockId: id, actionLabel: "実績を編集" });
  } else {
    saveAndRender("Blockを更新しました");
  }
  // v17/v18: 完了時の演出(常にランダム祝福)
  if (justCompleted && completedBlock) {
    const celebrateMsg = getRandomCelebrate();
    triggerCompletionEffect(celebrateMsg, completedBlock.isMIT);
  }
  // v117(C): 過集中ブレーカーのゲート化。○タップでの直接完了(「完了への状態変更」)の直後。
  if (justCompleted) maybeOpenHyperfocusGate();
}

// v107: タスクシュートのBlock行「タスク完了」チェック(K指示 2026-07-15)。
//   Block完了チェック(toggleBlock)とは意味が別: こちらは「Task本体」を完了にする。
//   ON: Task を completed 化(v95連動=分子を分母に揃える)+ この行のBlockのみ completed 化
//       (同じTaskに紐づく他のBlockには触れない。監督者推奨の仕様どおり)。
//   OFF: Task の完了だけ解除する(toggleTask の完了解除と同じ方針でdoing/todoを判定)。
//        Block側は解除しない(実績を消さないため。逆方向=Block解除だけではTaskは変えない、
//        という既存方針と対称)。
function toggleTaskCompleteFromBlock(blockId) {
  const block = state.blocks.find((b) => b.id === blockId);
  if (!block || !block.taskId) return;
  const task = state.tasks.find((t) => t.id === block.taskId);
  if (!task) return;
  const completing = task.status !== "completed";
  if (completing) {
    state.tasks = state.tasks.map((t) => t.id === task.id
      ? { ...t, status: "completed", progressNum: fillProgressOnComplete(t), updatedAt: nowDateTime() }
      : t);
    state.blocks = state.blocks.map((b) => b.id === blockId
      ? { ...b, completed: true, actualEndAt: b.actualEndAt || nowDateTime(), updatedAt: nowDateTime() }
      : b);
  } else {
    const hasProgress = state.blocks.some((b) => !b.deleted && b.taskId === task.id && (b.completed || b.actualStartAt));
    state.tasks = state.tasks.map((t) => t.id === task.id
      ? { ...t, status: hasProgress ? "doing" : "todo", updatedAt: nowDateTime() }
      : t);
  }
  saveAndRender(completing ? "Taskを完了しました" : "Taskを未完了に戻しました");
  // v146: 🏁はBlock編集モーダルへ移設した。render()はmodalRootを触らないため、モーダルを
  // 開いたままこのボタンを押した場合はここで明示的に再描画して状態(ラベル/色)を反映する。
  // v146レビュー対応: renderModal(buildBlockModal(...))の直呼びは編集中の他フィールド
  // (タイトル書きかけ等)を丸ごと破棄してしまうため、既存のrerenderActiveModal()(値の
  // 退避・復元パターン)を使う。ただし"completed"はこの操作自体で変わり得る値なので、
  // 古いキャッシュ値へ巻き戻さないよう復元対象から除外する(rerenderActiveModal側で
  // 再オープンされた時点の最新値=このトグル後の値がそのまま残る)。
  if (state.modal && state.modal.type === "block" && state.modal.id === blockId) {
    rerenderActiveModal(["completed"]);
  }
}

// v170: bulkCheckRoutinesUpToNow(ゼロ摩擦ルーティンチェックの一括確定)はsrc/features/routine.js
// へ移動した(app.js分割・段階4-4)。呼び出し元(routine-bulk-check分岐)はimportで参照する。

// v17: MIT(今日の主役)の切り替え。1日最大3個
function toggleMIT(blockId) {
  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) return;
  if (!block.isMIT) {
    // MIT に追加する場合、同日内の MIT 件数を確認
    const sameDayMITs = state.blocks.filter((b) => !b.deleted && b.date === block.date && b.isMIT);
    if (sameDayMITs.length >= 3) {
      return showToast("今日の主役は最大3個まで。先に他を外してください");
    }
  }
  state.blocks = state.blocks.map((b) => b.id === blockId
    ? { ...b, isMIT: !b.isMIT, updatedAt: nowDateTime() }
    : b);
  saveAndRender(block.isMIT ? "今日の主役から外しました" : "✦ 今日の主役に設定しました");
}

// v17: 完了時の演出(花火 + ランダム祝福メッセージ)
function triggerCompletionEffect(message, isMIT) {
  const container = document.createElement("div");
  container.className = "completion-effect";
  // 粒子(8〜14個、ランダムな角度)
  const particleCount = isMIT ? 14 : 8;
  for (let i = 0; i < particleCount; i++) {
    const angle = (i / particleCount) * Math.PI * 2 + Math.random() * 0.5;
    const distance = 60 + Math.random() * 60;
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance - 20;
    const particle = document.createElement("span");
    particle.className = "ce-particle";
    particle.textContent = isMIT ? "✦" : "✨";
    particle.style.setProperty("--tx", `${tx}px`);
    particle.style.setProperty("--ty", `${ty}px`);
    particle.style.setProperty("--delay", `${i * 30}ms`);
    container.appendChild(particle);
  }
  if (message) {
    const msgEl = document.createElement("div");
    msgEl.className = "ce-message";
    msgEl.textContent = message;
    container.appendChild(msgEl);
  }
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 1500);
}

function setBlockTime(id, field) {
  updateBlockField(id, field, nowDateTime());
  if (field === "actualStartAt") {
    // v48: 着手した瞬間に Task を doing へ(従来は Block 完了時のみで、
    //      「着手率>完了率」の哲学に反して着手が Task に反映されていなかった)
    const blk = blockById(id);
    if (blk?.taskId) {
      state.tasks = state.tasks.map((t) => t.id === blk.taskId && t.status === "todo"
        ? { ...t, status: "doing", updatedAt: nowDateTime() } : t);
      saveState();
    }
    // v40: 着手ジュース — 着手の瞬間だけ、その行に一度きりの感覚フィードバック。非永続。
    state._justStartedBlockId = id;
    // v70: Block開始でフォーカスタイマー(ポモドーロ)を自動起動(設定focusTimerAuto、既定ON)。
    //      既に別セッションが動いている場合は乗っ取らない(既存の集中を尊重)。
    //      startPomodoro自身がrender/toastまで行うので、この分岐では末尾のrender/toastを重ねない。
    if (state.settings.focusTimerAuto && !state.pomodoro.running) {
      forceResetPomodoroSession();
      startPomodoro(id);
      return;
    }
  }
  render();
  showToast(field === "actualStartAt" ? "開始時刻を入れました" : "終了時刻を入れました");
}

// v70: 「予定通りだった」一括承認。当日の未記録Block(plannedあり・actual一切なし・完了扱いにしたい
// もの)に計画時刻をそのまま実績としてコピーし、completed化する。確認は window.confirm 一回
// (既存の deleteProject 等と同じ流儀)。Taskの状態は toggleBlock と同じ思想で "todo"→"doing" のみ
// (自動で "completed" までは進めない — Task完了は既存フロー同様、人の判断に委ねる)。
function bulkApproveAsPlanned() {
  const today = todayISO();
  const targets = state.blocks.filter((b) =>
    !b.deleted && b.date === today && b.category !== "ルーティン" &&
    b.plannedStartAt && !b.completed && !b.actualStartAt && !b.actualEndAt && !isStaleBlock(b));
  if (!targets.length) return showToast("対象のBlockがありません(すでに実績があるか、予定が無いBlockのみ)");
  if (!window.confirm(`${targets.length}件のBlockを「予定通り」実績として記録しますか?\n(計画時刻をそのまま実績にコピーし、完了にします)`)) return;
  const ids = new Set(targets.map((b) => b.id));
  state.blocks = state.blocks.map((b) => ids.has(b.id)
    ? { ...b, actualStartAt: b.plannedStartAt, actualEndAt: b.plannedEndAt || b.plannedStartAt, completed: true, updatedAt: nowDateTime() }
    : b);
  const taskIds = new Set(targets.map((b) => b.taskId).filter(Boolean));
  if (taskIds.size) {
    state.tasks = state.tasks.map((t) => taskIds.has(t.id) && t.status === "todo"
      ? { ...t, status: "doing", updatedAt: nowDateTime() } : t);
  }
  saveAndRender(`${targets.length}件を予定通り完了にしました`);
}

// =============================================================
// v70: Now画面(実行コンベア)— 「今のBlock 1個」+ 開始/完了/スキップの3ボタンのみ。
// 新しい状態は nowMode(全画面フラグ)と _nowSkippedIds(このセッション中のスキップ集合)だけで、
// どちらも非永続のモジュール変数(normalizeStateへの補完は不要)。
// =============================================================
function openNowMode() {
  nowMode = true;
  _nowSkippedIds = new Set();
  if (state.selectedDate !== todayISO()) {
    setSelectedDate(todayISO());  // 内部でrender()まで行う
  } else {
    render();
  }
}

function closeNowMode() {
  nowMode = false;
  _nowSkippedIds = new Set();
  render();
}

// homeHero と同じ「現在時刻に該当するBlock、無ければ次(未着手優先)」の抽出ロジックに
// スキップ集合の除外を加えたもの。当日固定(Nowモードに入る時点でselectedDateは今日に揃えている)。
function nowConveyorTarget() {
  const today = todayISO();
  const tl = blocksForDate(today)
    .filter((b) => b.category !== "ルーティン" && b.plannedStartAt && !b.completed &&
      !isStaleBlock(b) && !_nowSkippedIds.has(b.id))
    .sort((a, b) => minutesOf(a.plannedStartAt) - minutesOf(b.plannedStartAt));
  if (!tl.length) return null;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const current = tl.find((b) =>
    minutesOf(b.plannedStartAt) <= nowMin && nowMin < minutesOf(b.plannedEndAt || b.plannedStartAt));
  return current || tl.find((b) => !b.actualStartAt) || tl[0];
}

// v70: Now画面の「完了」。フォーカスタイマーがこのBlockで動いていれば completePomodoro() に委ね
// (pomodoroCount加算・タイマー状態の後始末まで一致させる)、動いていなければ toggleBlock で完了化する。
function nowConveyorComplete(id) {
  if (state.pomodoro.running && state.pomodoro.blockId === id) {
    completePomodoro();
  } else {
    toggleBlock(id);
  }
}

function renderNowConveyor() {
  const target = nowConveyorTarget();
  const closeBtn = `<button class="now-fullscreen-close" data-action="now-mode-close" aria-label="閉じる" title="閉じる">✕</button>`;
  if (!target) {
    return `
      <div class="now-fullscreen" id="nowFullscreen">
        ${closeBtn}
        <div class="now-fullscreen-content">
          <div class="now-eyebrow">▶ Now</div>
          <div class="now-empty">今日のBlockはすべて片づきました。</div>
        </div>
      </div>`;
  }
  const started = Boolean(target.actualStartAt);
  return `
    <div class="now-fullscreen" id="nowFullscreen">
      ${closeBtn}
      <div class="now-fullscreen-content">
        <div class="now-eyebrow">いまのBlock</div>
        <div class="now-title">${escapeHTML(target.title)}</div>
        <div class="now-meta">予定 ${plannedRange(target)}${target.category ? `<span class="now-cat">${escapeHTML(target.category)}</span>` : ""}</div>
        ${started ? `<div class="now-status">着手中 ${timeFromDateTime(target.actualStartAt)}〜</div>` : ""}
        <div class="now-actions">
          <button class="btn orange now-btn" data-action="now-start" data-id="${target.id}" ${started ? "disabled" : ""}>▶ 開始</button>
          <button class="btn green now-btn" data-action="now-conveyor-complete" data-id="${target.id}">✓ 完了</button>
          <button class="btn now-btn" data-action="now-conveyor-skip" data-id="${target.id}">→ スキップ</button>
        </div>
      </div>
    </div>`;
}

function updateBlockField(id, field, value) {
  state.blocks = state.blocks.map((block) => {
    if (block.id !== id) return block;
    const normalized = ["charge", "discharge"].includes(field) ? Number(value) : value;
    return { ...block, [field]: normalized, updatedAt: nowDateTime() };
  });
  saveState();
}

function deleteBlock(id) {
  const target = state.blocks.find((b) => b.id === id);
  // v23: 繰り返し実体を削除したら、ルールの例外日に追加(再生成を防ぐ)
  if (target && target.recurrenceGroupId) {
    state.recurrences = (state.recurrences || []).map((r) =>
      r.id === target.recurrenceGroupId
        ? { ...r, exceptionDates: [...new Set([...(r.exceptionDates || []), target.date])], updatedAt: nowDateTime() }
        : r);
  }
  state.blocks = state.blocks.map((block) => block.id === id ? { ...block, deleted: true, updatedAt: nowDateTime() } : block);
  saveAndRender("Blockを削除しました");
}

// v169: setMorningEnergy/ensureConditionLog/conditionRecordedDates/conditionRecordedCountThisWeek/
// setConditionSleep/toggleConditionMeds/setConditionCapacity/setEveningMood/addGymEntry/
// deleteGymEntryはsrc/features/journal.jsへ移動した(app.js分割・段階4-3)。ensureConditionLogは
// inputイベントdispatcher(data-condition-note-date分岐)からも呼ばれるため冒頭でimportして
// 参照を切り替えた。isConditionDegraded/CONDITION_DEGRADED_THRESHOLD(Home縮退モード表示が
// 参照)はジャーナル専用ではないためapp.js側に残した。
// v73: 縮退モードの閾値。SPEC(condition-os/SPEC.md)は「体調1〜10・4以下」だが、既存の朝の
// 体調ピッカーは離散5段階(悪い0/少し悪い3/普通5/少し良い7/良い10)であり、二重のピッカーを
// 増やさずこの離散値へ読み替えた: 下位2段(悪い・少し悪い = 3以下)を縮退トリガーとする
// (CHANGES_v73.md参照)。
const CONDITION_DEGRADED_THRESHOLD = 3;
function isConditionDegraded(date) {
  const v = state.settings.morningEnergyLog[date];
  return typeof v === "number" && v <= CONDITION_DEGRADED_THRESHOLD;
}

// v51: dateArg で任意日を生成可能に(朝イチ自動レビュー・今日のタスク提案が昨日分を使う)。
//      quiet = 画面遷移・トーストなしで生成だけ行う(バックグラウンド用)。
function generateReport(dateArg, { quiet = false } = {}) {
  const date = dateArg || state.selectedDate;
  ensureJournal(date);
  const blocks = blocksForDate(date);
  const completed = blocks.filter((block) => block.completed);
  const charge = blocks.reduce((sum, block) => sum + Number(block.charge || 0), 0);
  const discharge = blocks.reduce((sum, block) => sum + Number(block.discharge || 0), 0);
  const morning = state.settings.morningEnergyLog[date] ?? 5;
  const net = morning + charge - discharge;

  // v61: 今日の理想ワンライナー(提案8)。達成/未達は判定せず、翌日以降も見えることだけを添える。
  const idealText = state.journalMeta[date]?.ideal || "";

  // v17: MIT(今日の主役)
  const mitBlocks = blocks.filter((b) => b.isMIT);
  const mitDone = mitBlocks.filter((b) => b.completed).length;

  // v17: ポモドーロ完了数
  const pomodoroCount = blocks.reduce((sum, b) => sum + Number(b.pomodoroCount || 0), 0);

  // v33: ホームの4つの達成率(スコアボードと同一ロジック)
  const rateTaskchute = taskchuteStartRate(blocks);
  const rateMIT = {
    done: mitDone,
    total: mitBlocks.length,
    pct: mitBlocks.length ? Math.round((mitDone / mitBlocks.length) * 100) : 0
  };
  const rateRoutine = routineRate(blocks);
  const rateCycleWeek = cycleWeekProgress(date);

  // v17: 計画 vs 実行
  const plannedMinutes = blocks.reduce((sum, b) => {
    if (b.plannedStartAt && b.plannedEndAt) {
      const s = minutesOf(b.plannedStartAt);
      const e = minutesOf(b.plannedEndAt);
      return sum + Math.max(0, e - s);
    }
    return sum;
  }, 0);
  const actualMinutes = blocks.filter((b) => b.completed).reduce((sum, b) => {
    if (b.actualStartAt && b.actualEndAt) {
      const s = minutesOf(b.actualStartAt);
      const e = minutesOf(b.actualEndAt);
      return sum + Math.max(0, e - s);
    } else if (b.plannedStartAt && b.plannedEndAt) {
      // 実績時刻が無い場合は予定で代替
      const s = minutesOf(b.plannedStartAt);
      const e = minutesOf(b.plannedEndAt);
      return sum + Math.max(0, e - s);
    }
    return sum;
  }, 0);
  const blockCompletionRate = blocks.length === 0 ? 0 : Math.round((completed.length / blocks.length) * 100);
  const timeCompletionRate = plannedMinutes === 0 ? 0 : Math.round((actualMinutes / plannedMinutes) * 100);
  const fmtMinutes = (m) => `${Math.floor(m / 60)}h${m % 60 > 0 ? `${m % 60}m` : ""}`;

  // v17: カテゴリ別時間配分(完了 Block のみ)
  const catTime = {};
  completed.forEach((b) => {
    if (!b.actualStartAt || !b.actualEndAt) {
      // 実績が無ければ予定時刻で代替
      if (b.plannedStartAt && b.plannedEndAt) {
        const dur = Math.max(0, minutesOf(b.plannedEndAt) - minutesOf(b.plannedStartAt));
        const cat = b.category || "未分類";
        catTime[cat] = (catTime[cat] || 0) + dur;
      }
      return;
    }
    const dur = Math.max(0, minutesOf(b.actualEndAt) - minutesOf(b.actualStartAt));
    const cat = b.category || "未分類";
    catTime[cat] = (catTime[cat] || 0) + dur;
  });
  const catTimeRows = Object.entries(catTime)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, min]) => `- ${cat}: ${fmtMinutes(min)}`);

  // v17: 12WY プロジェクトの今日進んだこと(完了 Block を Project ごとに集約)
  const projectProgress = {};
  completed.forEach((b) => {
    if (!b.taskId) return;
    const task = state.tasks.find((t) => t.id === b.taskId);
    if (!task) return;
    const project = state.projects.find((p) => p.id === task.projectId);
    if (!project || project.kind === "wish") return;  // Wish は別セクション
    if (!project.twelveWeekStartDate) return;  // 12WY プロジェクトのみ
    projectProgress[project.title] = projectProgress[project.title] || [];
    projectProgress[project.title].push(b.title);
  });

  // v17: 進んだ Wish(完了したサブタスクの親 Wish)
  const wishProgress = {};
  completed.forEach((b) => {
    if (!b.taskId) return;
    const task = state.tasks.find((t) => t.id === b.taskId);
    if (!task || !task.parentTaskId) return;
    const wish = state.tasks.find((t) => t.id === task.parentTaskId);
    if (!wish) return;
    const wishProject = state.projects.find((p) => p.id === wish.projectId);
    if (!wishProject || wishProject.kind !== "wish") return;
    wishProgress[wish.title] = wishProgress[wish.title] || [];
    wishProgress[wish.title].push(b.title);
  });

  // v17: やり残し
  const incomplete = blocks.filter((b) => !b.completed);

  // v17: Block コメント抽出(comment があるもの)
  const commentedBlocks = blocks.filter((b) => b.comment && b.comment.trim());

  // v162 2系統レビュー対応(必須1・必須2): 未完了理由(state.blocksを直接見る。仕分けの
  // 手放す/延期はBlockをdeleted:true化するため、!deleted限定のblocksForDate=blocksからは
  // 既に外れている。それでも「その日なぜ完了しなかったか」の記録は残すため、deleted済みも
  // 含めて拾う)。対象日の条件は2つのORで判定する:
  //  (a) b.date === date — その日の予定だったBlock(日次締めで当日に理由記録した通常ケース)
  //  (b) incompleteReason.at がdate — 仕分け対象(carryableBlocks、前日Block)は b.date が
  //      前日のままなので(a)だけでは当日の日報に一切載らない(=台帳に永久に届かない)。
  //      記録した「その日」の日報に載せるため、記録時刻(at)の日付でも拾う。
  // (必須2): !b.completed も条件に加える。記録後にBlockが完了へ転じた場合、偽の「言い訳」を
  // 台帳へ流さないよう欄から除外する(incompleteReason自体は削除しない。履歴として残すが
  // 表示条件から外すだけ)。
  const incompleteReasonAtDate = (b) => String(b.incompleteReason?.at || "").slice(0, 10);
  const incompleteReasons = state.blocks.filter((b) =>
    hasIncompleteReason(b) && !b.completed && (b.date === date || incompleteReasonAtDate(b) === date));

  // v117(A): 今日の宣言。未入力日も節自体は常に出す(バッチが未記載を検知するための契約。
  //          FORMAT_CONTRACT.md参照)。理想ワンライナーとは違い省略しない。
  const declarationText = (state.dailyDeclarations[date]?.text || "").trim();

  // v128: 体力予算。当日ログがある日のみ達成率表の後に1行出力する(データなし日は省略)。
  const conditionBudgetToday = conditionBudget(date);

  const lines = [
    `# 日報 ${date} (${weekdayLabel(date)})`,
    "",
    // v61: 今日の理想ワンライナー(未入力日は行ごと出さない)
    ...(idealText ? [`> 🌱 今日の理想: ${idealText}`, ""] : []),
    "## 📣 今日の宣言",
    "",
    declarationText || "(未入力)",
    "",
    "## 1. サマリ",
    "| 指標 | 値 |",
    "|---|---|",
    `| 朝の体調 | ${morning} / 10 |`,
    `| 充電収支 | +${charge} / -${discharge} = ${signed(net - morning)} (起点${morning}→終値${net}) |`,
    `| Block 実行 | ${completed.length} / ${blocks.length} (${blockCompletionRate}%) |`,
    `| 時間実行 | ${fmtMinutes(actualMinutes)} / ${fmtMinutes(plannedMinutes)} (${timeCompletionRate}%) |`,
    `| MIT 達成 | ${mitDone} / ${mitBlocks.length} |`,
    `| ポモドーロ | ${pomodoroCount} 回 |`,
    "",
    "### 達成率",
    "| 指標 | 達成 | 率 |",
    "|---|---|---|",
    `| タスクシュート着手率 | ${rateTaskchute.done} / ${rateTaskchute.total} | ${rateTaskchute.pct}% |`,
    `| 今日の主役 (MIT) | ${rateMIT.done} / ${rateMIT.total} | ${rateMIT.pct}% |`,
    `| ルーティン実行率 | ${rateRoutine.done} / ${rateRoutine.total} | ${rateRoutine.pct}% |`,
    `| 12週 今週の進捗 | ${rateCycleWeek.done} / ${rateCycleWeek.total} | ${rateCycleWeek.pct}% |`,
    "",
    ...(conditionBudgetToday.level !== "none"
      ? [`体力予算: ${CONDITION_BUDGET_LABELS[conditionBudgetToday.level]}${conditionBudgetToday.reason ? `(${conditionBudgetToday.reason})` : ""}`, ""]
      : []),
  ];

  // v68: 非同期AI対話 — 日報タブの「今日AIに聞きたいこと」(origin:"user")のうち未解決のものを
  //      「## AIへの質問」節として出す。空(該当なし)なら節ごと省略。coach-daily.sh は日報全文を
  //      そのまま読むため、この節を追加するだけで翌朝のAIコーチングが応答できる(バッチ側改修不要)。
  const userQuestions = (state.questions || []).filter((q) =>
    !q.deleted && q.origin === "user" && q.status !== "settled");
  if (userQuestions.length) {
    lines.push("## AIへの質問");
    userQuestions.forEach((q) => lines.push(`- ${q.text}`));
    lines.push("");
  }

  // v34/v39: 0秒思考(その日に書いたもの、書いた順)。v39 で問い別にグルーピング。
  const ztToday = (state.zeroThinking?.entries || [])
    .filter((e) => e.date === date)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  if (ztToday.length) {
    lines.push("## 🧠 0秒思考");
    lines.push("");
    const underQuestion = ztToday.filter((e) => e.questionId);
    const standalone = ztToday.filter((e) => !e.questionId);
    // 問いに紐づくものは問いごとにまとめる
    const byQ = {};
    underQuestion.forEach((e) => { (byQ[e.questionId] ||= []).push(e); });
    Object.entries(byQ).forEach(([qid, entries]) => {
      const q = (state.questions || []).find((x) => x.id === qid);
      lines.push(`### 【問い】${q ? q.text : entries[0].theme}`);
      lines.push("");
      entries.forEach((e) => {
        if (e.theme && e.theme !== (q && q.text)) lines.push(`**${e.theme}**`);
        lines.push(e.body);
        lines.push("");
      });
    });
    standalone.forEach((e) => {
      lines.push(`### ${e.theme}`);
      lines.push("");
      lines.push(e.body);
      lines.push("");
    });
  }

  // MIT セクション
  if (mitBlocks.length > 0) {
    lines.push("## 2. 今日の主役 (MIT)");
    mitBlocks.forEach((b) => {
      lines.push(`- ${b.completed ? "✅" : "⬜"} ${b.title}`);
    });
    lines.push("");
  }

  // 12WY プロジェクト進捗
  if (Object.keys(projectProgress).length > 0) {
    lines.push("## 3. 12WY プロジェクトの進捗");
    Object.entries(projectProgress).forEach(([projectName, items]) => {
      lines.push(`### ${projectName}`);
      items.forEach((t) => lines.push(`- ${t}`));
    });
    lines.push("");
  }

  // 進んだ Wish
  if (Object.keys(wishProgress).length > 0) {
    lines.push("## 4. 今日進んだ Wish");
    Object.entries(wishProgress).forEach(([wishTitle, items]) => {
      lines.push(`### ${wishTitle}`);
      items.forEach((t) => lines.push(`- ${t}`));
    });
    lines.push("");
  }

  // 時間の使い方
  lines.push("## 5. 時間の使い方");
  if (catTimeRows.length > 0) {
    lines.push("### カテゴリ別配分");
    lines.push(...catTimeRows);
    lines.push("");
  }
  lines.push("### 実行 Block(時刻順)");
  lines.push("| 時刻 | 内容 | カテゴリ | 充電/放電 | コメント |");
  lines.push("|---|---|---|---|---|");
  const sortedBlocks = [...blocks].sort((a, b) => (a.plannedStartAt || "").localeCompare(b.plannedStartAt || ""));
  sortedBlocks.forEach((b) => {
    const time = b.plannedStartAt ? timeFromDateTime(b.plannedStartAt) : "—";
    const status = b.completed ? "✅" : (b.isMIT ? "★" : "⬜");
    const comment = (b.comment || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${time} | ${status} ${b.title} | ${b.category || "—"} | +${b.charge || 0}/-${b.discharge || 0} | ${comment} |`);
  });
  lines.push("");

  // v129: 当日分の身体スキャン(ポモドーロ完了時の疲労1-5+任意部位)。時刻順。1件も無い日は節ごと省略。
  const bodyScansToday = (state.bodyScans || [])
    .filter((s) => (s.dateTime || "").startsWith(date))
    .sort((a, b) => (a.dateTime || "").localeCompare(b.dateTime || ""));
  if (bodyScansToday.length > 0) {
    lines.push("### 身体スキャン");
    lines.push("| 時刻 | 疲労 | 部位 |");
    lines.push("|---|---|---|");
    bodyScansToday.forEach((s) => {
      const time = s.dateTime ? timeFromDateTime(s.dateTime) : "—";
      lines.push(`| ${time} | ${s.fatigue ?? "—"} | ${s.part || "—"} |`);
    });
    lines.push("");
  }

  // やり残し
  if (incomplete.length > 0) {
    lines.push("## 6. やり残し");
    incomplete.forEach((b) => {
      lines.push(`- ${b.isMIT ? "★ " : ""}${b.title}${b.category ? ` (${b.category})` : ""}`);
    });
    lines.push("");
  }

  // Block コメント抜粋
  if (commentedBlocks.length > 0) {
    lines.push("## 7. Block 内のコメント");
    commentedBlocks.forEach((b) => {
      lines.push(`### ${b.title}`);
      lines.push(b.comment.trim());
      lines.push("");
    });
  }

  // v162: 未完了理由(理由が1件以上ある日のみ節を出す。excuse-ledger-extract.pyが
  // この節のみを機械パースする=FORMAT_CONTRACT.md参照。あえて番号を振らず既存の
  // 「## 6.」「## 7.」等の連番を崩さない=「## AIへの質問」等と同じ非番号見出しの型)
  if (incompleteReasons.length > 0) {
    lines.push("## 未完了理由");
    incompleteReasons.forEach((b) => {
      const note = (b.incompleteReason.note || "").replace(/\n/g, " ").trim();
      lines.push(`- [${b.title}] ${b.incompleteReason.chip}${note ? `: ${note}` : ""}`);
    });
    lines.push("");
  }

  // ジャーナル
  lines.push("## 8. ジャーナル");
  lines.push(state.journals[date] || "(ジャーナル記載なし)");
  lines.push("");

  // 明日への接続
  lines.push("## 9. 明日への接続");
  // v61: 達成/未達を自己申告させるのではなく、翌日以降もこの理想が見えることだけを示す(3日リトライ)
  if (idealText) {
    lines.push(`理想「${idealText}」は、明日・明後日もホームに小さく残ります。達成できたかどうかは問いません。3日目に続けるか手放すかだけ選びます。`);
    lines.push("");
  }
  lines.push("明日への一言:");
  lines.push("");
  lines.push("明日の MIT 候補:");
  lines.push("- ");
  lines.push("- ");
  lines.push("- ");
  lines.push("");

  // AI フィードバック用プロンプト(コピペ用)
  lines.push("---");
  lines.push("");
  lines.push("## 📋 AI へのコピペ用プロンプト");
  lines.push("```");
  lines.push("以下は今日の日報です。");
  lines.push("");
  lines.push("1. 客観事実から見える「良かった点・改善できる点」");
  lines.push("2. パターンとして気をつけたいこと");
  lines.push("3. 明日への具体的な提案(2〜3個)");
  lines.push("4. この日報を踏まえ、明日「0秒思考」で思考を深めるべきテーマ(2〜3個)");
  lines.push("   ※ 各テーマは1分で書き出せる問い形式で示すこと");
  lines.push("5. 明日の MIT 候補(最大3つ)");
  lines.push("   ※ 「明日のMIT候補」という見出しの下に「- 」の箇条書きで示すこと(アプリが読み取ります)");
  // v39: 開いている問い(10x)を提示し、問いを一段深める明日のテーマを求める
  const openQuestions = (state.questions || []).filter((q) => !q.deleted && q.status !== "settled");
  if (openQuestions.length) {
    lines.push("");
    lines.push("いま持ち続けている「問い」:");
    openQuestions.slice(0, 5).forEach((q) => lines.push(`- ${q.text}`));
    lines.push("");
    lines.push("6. 上の各問いを一段深める明日のテーマを最大2つ提案せよ。");
    lines.push("   答えを出すのではなく、より良い問いへの分解を優先すること。");
  }
  lines.push("");
  lines.push("の観点で、簡潔にフィードバックをください。");
  lines.push("(辛口でも構いません、ただし行動に繋がる具体性を重視)");
  lines.push("");
  lines.push("レビュー結果は Markdown 形式の .md ファイルとして出力してください。");
  // v42: 出力フォーマットを固定(アプリのパーサ前提)。頑健性はプロンプト側で買う。
  lines.push("");
  lines.push("回答は必ず次の見出し構成で出力してください。各候補は「- 」で始まる箇条書き。");
  lines.push("## フィードバック");
  lines.push("## 明日の0秒思考テーマ");
  lines.push("## MIT候補");
  lines.push("## 問い候補");
  lines.push("該当がないセクションは見出しごと省略してください。");
  lines.push("```");

  const report = lines.join("\n");
  state.reports[date] = report;
  if (quiet) { saveState(); return report; }  // v51: バックグラウンド生成(画面を動かさない)
  // v81: このあと currentView を "reports" に切り替えるが、トーストがそれを予告しないまま
  // 画面が切り替わり「押したら黙って画面が変わった」体験になっていた(UX監査A4)。
  // 遷移することを文言で明示する。
  saveAndRender("日報を生成しました → 日報タブに移動します");
  state.currentView = "reports";
  saveState();
  render();
  return report;
}

function downloadReport() {
  const report = state.reports[state.selectedDate] || "";
  if (!report) return showToast("先に日報を生成してください");
  downloadText(`日報_${state.selectedDate}.md`, report, "text/markdown");
}

function downloadData() {
  // v37: バックアップにトークンを含めない(共有・保管されるファイルに秘密情報を残さない)。
  //      GitHub保存(sanitizedStateForGitHub)と同じ方針。
  downloadText(`taskchute_journal_backup_${todayISO()}.json`, JSON.stringify(sanitizedStateForGitHub(), null, 2), "application/json");
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      // v37: 全処理が成功してから state を差し替える。
      //      途中で例外が出ると「読み込めませんでした」と表示しつつ
      //      中途半端な state で動き続ける事故を防ぐ。
      const token = state.settings?.github?.token || "";
      const next = normalizeState(JSON.parse(String(reader.result)));
      // バックアップはトークンを含まないので、この端末のトークンを引き継ぐ
      if (!next.settings.github.token) next.settings.github.token = token;
      setState(next);
      maintainRecurrences({ purge: true });
      saveAndRender("データをインポートしました");
    } catch {
      showToast("JSONを読み込めませんでした");
    }
  };
  reader.readAsText(file);
}

// LAST_SYNCED_SHA_KEY/getLastSyncedSha/setLastSyncedSha、LAST_SYNC_PUSH_KEY/LAST_SYNC_PULL_KEY/
// getLastSyncPushAt/recordSyncPushSuccess/getLastSyncPullAt/recordSyncPullSuccess:
// src/sync/github.js へ抽出済み(v166)。冒頭のimportを参照。getLastSyncPushAt/getLastSyncPullAtは
// すぐ下のsyncAlertMessage()がimportして使う。

const SYNC_PUSH_ALERT_HOURS = 6;
const SYNC_PULL_ALERT_HOURS = 24;

// 現在時刻(nowDateTime()形式の文字列)からの経過時間(時)。localDateTimeToMs(v56)を再利用し、
// new Date(文字列)のiOS Safari TZ解釈バグを避ける。
function hoursSinceLocalDateTime(dateTime) {
  if (!dateTime) return 0;
  return (localDateTimeToMs(nowDateTime()) - localDateTimeToMs(dateTime)) / 3600000;
}

// push停止/pull停止の警告文言を返す(無ければnull)。記録が無い初回状態(localStorage未記録)
// では警告を出さない(後方互換)。push側は「未push変更が実際にある」ときだけ発火する
// (syncDotClass()と同じ dataModifiedAt !== lastPushedAt の判定を流用)。
function syncAlertMessage() {
  if (!personalDataReady(state.settings.github)) return null;  // 同期未設定なら判定しない
  const pushAt = getLastSyncPushAt();
  const hasUnpushed = (state.dataModifiedAt || "") !== (state.settings.lastPushedAt || "");
  if (pushAt && hasUnpushed && hoursSinceLocalDateTime(pushAt) >= SYNC_PUSH_ALERT_HOURS) {
    const h = Math.floor(hoursSinceLocalDateTime(pushAt));
    return `GitHubへの保存が${h}時間止まっています(最終: ${pushAt.replace("T", " ").slice(0, 16)})。設定から手動保存を試してください`;
  }
  const pullAt = getLastSyncPullAt();
  if (pullAt && hoursSinceLocalDateTime(pullAt) >= SYNC_PULL_ALERT_HOURS) {
    const h = Math.floor(hoursSinceLocalDateTime(pullAt));
    return `GitHubからの取得が${h}時間止まっています(最終: ${pullAt.replace("T", " ").slice(0, 16)})。設定から手動読込を試してください`;
  }
  return null;
}

function homeSyncAlertBanner() {
  const msg = syncAlertMessage();
  if (!msg) return "";
  return `<div class="sync-alert-banner" data-action="nav" data-view="settings">⚠️ ${escapeHTML(msg)}</div>`;
}

// _githubSaveInFlight/saveToGitHub、autoSaveTimer/scheduleAutoSave、
// _autoSyncTimer/_lastPullCheckAt/_syncBanner/autoSyncReady/scheduleAutoSync/runAutoSyncPush、
// 0秒思考マージヘルパー群(mergeAppendOnlyLogByKey〜mergeZeroThinkingIntoLocal)、
// 同期の双方向マージ本体(SYNC_CORE_COMPARE_KEYS/normalizedRemoteCopy/syncCoreEqual/
// mergeDateStringMap等の各マージヘルパー/computeSyncMerge/applySyncMergeToLocal/
// applySyncMergeToRemote)、runAutoSyncPull、setSyncBanner/clearSyncBanner:
// src/sync/github.js へ抽出済み(v166)。冒頭のimportとsrc/sync/github.js冒頭コメントの
// configureGithubSync契約を参照。ロジックは一切変更していない(移動+依存注入化のみ)。

function renderSyncBanner() {
  const existing = document.querySelector(".sync-banner");
  if (existing) existing.remove();
  // モーダルで作業を止めず、#main 先頭に静かなバナー(タップで設定へ)
  if (_syncBanner && main) main.insertAdjacentHTML("afterbegin",
    `<div class="sync-banner" data-action="nav" data-view="settings">⚠ ${escapeHTML(_syncBanner)} — 設定へ</div>`);
}
function syncDotClass() {
  if (!state.settings.autoSync) return "off";
  return (state.dataModifiedAt && state.dataModifiedAt !== (state.settings.lastPushedAt || "")) ? "pending" : "ok";
}
function updateSyncDot() {
  const el = document.querySelector(".sync-dot");
  if (el) el.className = `sync-dot ${syncDotClass()}`;
}

function updateAutoSaveStatus(text) {
  const el = document.querySelector("[data-auto-save-status]");
  if (!el) return;
  const cfg = state.settings.github || {};
  if (text) { el.textContent = text; return; }
  if (cfg.lastSavedAt) {
    el.textContent = `最終保存: ${cfg.lastSavedAt.replace("T", " ")}`;
  } else {
    el.textContent = cfg.autoSave ? "自動保存: 有効(まだ保存していません)" : "自動保存: 無効";
  }
}

// downloadGitHubStateText/loadFromGitHub/syncFromGitHubOnStartup:
// src/sync/github.js へ抽出済み(v166)。冒頭のimportを参照。

// v37: 設定画面が開いている場合、DOM の入力値を state に同期する。
//      iOS のキーチェーン自動入力は input イベントを発火しないことがあり、
//      画面に値が見えているのに state が空のまま、というズレを防ぐ。
function syncGitHubFieldsFromDOM() {
  document.querySelectorAll("[data-github-field]").forEach((el) => {
    const key = el.dataset.githubField;
    if (el.type === "checkbox") return;  // autoSave は change ハンドラで処理済み
    const val = (el.value || "").trim();
    if (val !== (state.settings.github[key] || "")) {
      state.settings.github[key] = val;
    }
  });
}

// v72: =========================================================
//  個人データリポジトリ(既定 kojit1229/personal-data)への全面切替。
//  日報・AIフィードバック・AIプラン・週次レビュー・AI作業結果・app-state.json・
//  Vision/Affirmation は全てここ経由(taskchute/ 配下)で読み書きする。
//  token/branch は既存のGitHub設定フィールドを共用し、owner/repoだけを
//  dataOwner/dataRepo に差し替える(旧owner/repoフィールドはこの用途では使わない)。
// =========================================================
const PERSONAL_DATA_DIR = "taskchute";

function personalDataReady(rawCfg) {
  const cfg = rawCfg || state.settings.github || {};
  return !!(cfg.token && cfg.dataOwner && cfg.dataRepo);
}

// {owner, repo, branch, token} = 個人データリポジトリへの接続情報
function personalDataConn(rawCfg) {
  const cfg = rawCfg || state.settings.github || {};
  const defaults = defaultGitHubSettings();
  return {
    owner: cfg.dataOwner || defaults.dataOwner,
    repo: cfg.dataRepo || defaults.dataRepo,
    branch: cfg.branch || "main",
    token: cfg.token || ""
  };
}

function personalDataPath(name) {
  return `${PERSONAL_DATA_DIR}/${name}`;
}

// 接続情報 + 単一ファイルのpathをまとめて返す(gitHubContentsURL等の既存ヘルパーへそのまま渡せる形)
function personalDataFileConfig(rawCfg, name) {
  const cfg = rawCfg || state.settings.github || {};
  return { ...personalDataConn(cfg), path: personalDataPath(name || cfg.path || "app-state.json") };
}

// v72: personal-data リポジトリからの読み込み専用GET(Contents API、raw取得)。
// 未設定/404は静かに空文字を返す(既存fetchTextと同じ「無ければ無視」流儀)。
// 401(トークン権限不足)だけは具体的なバナーを出す(セットアップ画面通過後に起きうる)。
// v74: fetchGitHubRawText の内部実装。「本文」だけでなく「404(本当に無い)」と
// 「401/5xx/ネットワーク例外(読めたかどうか分からない)」を区別して返す。
// read-merge-write で書き戻す保存経路(saveReadingReflection)は、この区別が無いと
// 一過性の読み失敗を「まだ無い」と誤認し、空配列ベースで上書きして既存データを
// 消失させかねない(should-fixレビュー対応)。既存の呼び出し元(fetchGitHubRawText経由)
// への挙動は一切変えていない。
// v85: kind="blob" でバイナリ(PDF等)もこの経路で取得できるようにした。Accept: raw+json は
// GitHubのContents APIで1〜100MBのファイルに対してもraw bytesを返す(1MB以下限定ではない)ため、
// response.text() の代わりに response.blob() を使えばテキストと同じ経路で画像・PDFも読める。
// 既存呼び出し元(fetchGitHubRawText経由、kind省略=text)の挙動は一切変えていない。
async function fetchGitHubRawResult(name, kind = "text") {
  const cfg = state.settings.github || {};
  if (!personalDataReady(cfg)) return { ok: false, status: 0, text: "", blob: null };
  const conn = personalDataConn(cfg);
  try {
    const path = personalDataPath(name).split("/").map(encodeURIComponent).join("/");
    const url = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/contents/${path}?ref=${encodeURIComponent(conn.branch)}`;
    const response = await fetch(url, {
      headers: { ...githubHeaders(conn.token), "Accept": "application/vnd.github.raw+json" }
    });
    if (response.status === 401) {
      setPersonalDataAuthError("トークンに personal-data リポジトリの権限が必要です(Fine-grained tokenのRepository access / Contents権限を確認してください)");
      return { ok: false, status: 401, text: "", blob: null };
    }
    if (!response.ok) return { ok: false, status: response.status, text: "", blob: null };  // 404等
    clearPersonalDataAuthError();
    if (kind === "blob") return { ok: true, status: response.status, text: "", blob: await response.blob() };
    return { ok: true, status: response.status, text: await response.text(), blob: null };
  } catch {
    return { ok: false, status: 0, text: "", blob: null };  // ネットワーク例外(status: 0 = 通信自体が不成立)
  }
}

async function fetchGitHubRawText(name) {
  const result = await fetchGitHubRawResult(name);
  return result.ok ? result.text : "";
}

// v85: ビジョンボードPDF専用のバイナリ取得(personal-data Contents API → Blob)。
async function fetchGitHubRawBlob(name) {
  const result = await fetchGitHubRawResult(name, "blob");
  return result.ok ? result.blob : null;
}

// v92: AIレポートビューア専用 — personal-data リポジトリの taskchute/ 直下のディレクトリ一覧
// (GitHub Contents API、pathをファイルでなくディレクトリのままGETすると配列が返る)。
// fetchGitHubRawResult と同じくAccept: raw+json は使わない(一覧はJSON配列そのものが欲しいため既定Acceptのまま)。
// 401/404/ネットワーク例外いずれも _aiReportDirError=true にして呼び出し側の静かなエラー表示に委ねる。
async function fetchPersonalDataDirList() {
  const cfg = state.settings.github || {};
  if (!personalDataReady(cfg)) { _aiReportDirError = true; return null; }
  const conn = personalDataConn(cfg);
  try {
    const url = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/contents/${encodeURIComponent(PERSONAL_DATA_DIR)}?ref=${encodeURIComponent(conn.branch)}`;
    const response = await fetch(url, { headers: githubHeaders(conn.token) });
    if (response.status === 401) {
      setPersonalDataAuthError("トークンに personal-data リポジトリの権限が必要です(Fine-grained tokenのRepository access / Contents権限を確認してください)");
      _aiReportDirError = true;
      return null;
    }
    if (!response.ok) { _aiReportDirError = true; return null; }
    clearPersonalDataAuthError();
    const list = await response.json();
    _aiReportDirCache = Array.isArray(list) ? list : [];
    _aiReportDirError = false;
    return _aiReportDirCache;
  } catch {
    _aiReportDirError = true;
    return null;
  }
}

// v72: 401時のみ表示する具体的な案内バナー(非永続)。renderSyncBanner と同じ「モーダルで
// 作業を止めない」思想で、#main先頭に静かに差し込む。
let _personalDataAuthError = "";
function setPersonalDataAuthError(msg) {
  if (_personalDataAuthError === msg) return;
  _personalDataAuthError = msg;
  renderPersonalDataAuthBanner();
}
function clearPersonalDataAuthError() {
  if (!_personalDataAuthError) return;
  _personalDataAuthError = "";
  renderPersonalDataAuthBanner();
}
function renderPersonalDataAuthBanner() {
  const existing = document.querySelector(".pd-auth-banner");
  if (existing) existing.remove();
  if (_personalDataAuthError && main) {
    main.insertAdjacentHTML("afterbegin",
      `<div class="pd-auth-banner sync-banner" data-action="nav" data-view="settings">⚠ ${escapeHTML(_personalDataAuthError)} — 設定へ</div>`);
  }
}

function requireGitHubConfig() {
  syncGitHubFieldsFromDOM();
  const raw = state.settings.github || defaultGitHubSettings();
  const labels = { dataOwner: "個人データ Owner", dataRepo: "個人データ Repository", token: "Token" };
  for (const key of ["dataOwner", "dataRepo", "token"]) {
    if (!raw[key]) throw new Error(`${labels[key]} を入力してください`);
  }
  return personalDataFileConfig(raw, raw.path || "app-state.json");
}

async function fetchGitHubFileSHA(config) {
  const response = await fetch(`${gitHubContentsURL(config)}?ref=${encodeURIComponent(config.branch)}`, {
    headers: githubHeaders(config.token)
  });
  if (response.status === 404) return "";
  if (!response.ok) throw new Error(await gitHubErrorMessage(response));
  const payload = await response.json();
  return payload.sha || "";
}

function gitHubContentsURL(config) {
  return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${config.path.split("/").map(encodeURIComponent).join("/")}`;
}

function githubHeaders(token) {
  // v22: 前後の空白(全角スペース・改行・BOM 含む)を除去し、
  // HTTPヘッダーに使えない非 Latin-1 文字が混じっていたら分かりやすく弾く。
  const clean = String(token || "").trim();
  if (/[^\x00-\xFF]/.test(clean)) {
    throw new Error("トークンに使用できない文字が含まれています。設定画面でトークンを貼り直してください");
  }
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${clean}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function gitHubErrorMessage(response) {
  let raw;
  try {
    const payload = await response.json();
    raw = payload.message || `${response.status} ${response.statusText}`;
  } catch {
    raw = `${response.status} ${response.statusText}`;
  }
  // v37: よくある失敗は原因のヒント付きで返す(素の "Not Found" では対処が分からない)
  // v78: 【原因分析】K報告「日報生成でパスが違う趣旨のエラー」の実体はこの404ヒントだった。
  //      URL組み立て(personalDataPath/セグメントencode)自体は現物確認の結果すべての呼び出し元
  //      (日報/週次/12週/app-state.json)で正しく `taskchute/<file>` 一本に統一されており、
  //      二重プレフィックスやURL構築のバグは無かった(v76で疑われた懸念はこの環境の現物では
  //      再現しなかった)。一方 `repos/personal-data` の実コミット履歴を全数確認したところ、
  //      v72移行(2026-07-10)の初回移行コミット以降、アプリ自身が生成するはずのコミット
  //      (`chore: update <file> <ISO>`)が1件も存在しなかった(日報だけでなくapp-state.jsonの
  //      自動保存も同様)。これはCHANGES_v72.md記載の移行手順2「既存Fine-grained PATの
  //      Repository access に personal-data を追加し、Contents: Read and write権限を付与する」が
  //      未実施/不足のままアプリだけ新リポジトリ設定に切り替わった状態と整合する。GitHubは
  //      fine-grained tokenがアクセス権を持たないprivateリポジトリに対して(存在の有無を隠す
  //      ため)403ではなく404を返すため、実際の原因が「トークンの権限不足」であっても本ヒントは
  //      「パス/Owner/Repoの綴り」しか案内しておらず誤誘導になっていた。404のヒントに権限確認の
  //      案内を追記し、401/403/404はいずれもトークン設定の見直しが必要になり得るため、既存の
  //      読み込み失敗時(401)と同じ設定画面誘導バナーもあわせて出す(Kの端末のトークン実値・
  //      実際のRepository access設定はこの環境から確認できないため、アプリ側で確認可能な範囲=
  //      案内文言とバナー表示の是正までを対応した)。
  const hints = {
    401: "トークンが無効か期限切れです。設定画面で貼り直してください",
    403: "トークンにこのリポジトリへの権限がありません(Fine-grained tokenの Repository access / Contents 権限を確認)",
    404: "ファイルが見つからないか、トークンがこのリポジトリにアクセスできません。Owner / Repository / Branch / 保存先パスの綴り(保存先パスに taskchute/ を含めないでください。自動で付与されます)、またはFine-grained tokenの Repository access(対象repoが選択されているか)・Contents: Read and write 権限を確認してください"
  };
  const hint = hints[response.status];
  if ([401, 403, 404].includes(response.status)) {
    setPersonalDataAuthError("GitHub保存/読込に失敗しました。トークンのRepository access(personal-data)・Contents権限、またはOwner/Repository/Branch/パスの設定を確認してください");
  }
  return hint ? `${raw} — ${hint}` : raw;
}

function sanitizedStateForGitHub() {
  const copy = structuredClone(state);
  if (copy.settings?.github) copy.settings.github.token = "";
  copy.modal = null;  // v37: ローカル保存(persistLocalNoSchedule)と同様、モーダル状態は共有しない
  delete copy._justStartedBlockId;  // v40: 非永続の着手ジュースフラグは同期しない
  delete copy._gardenJustGrewDate;  // v153: 今日の芽のフェード演出フラグも同様に非永続
  return copy;
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(String(text).replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// v49: =========================================================
//  世代バックアップ(backups/app-state-YYYY-MM-DD.json)
//  app-state.json は単一ファイル上書きのため、誤同期すると過去に戻れない。
//  GitHub保存の成功後、1日1回だけ日次スナップショットを静かに残す(直近14日分)。
//  失敗しても本体同期は成功済みなので、トーストは出さず console.warn のみ。
// =========================================================
const BACKUP_LAST_DATE_KEY = "taskchute-backup-last-date";  // 端末ローカル(state を汚さない)
const BACKUP_KEEP_DAYS = 14;
const BACKUP_DIR = "taskchute/backups";  // v72: 個人データリポジトリのtaskchute/配下へ移動

function gitHubBackupURL(cfg, name) {
  const base = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${BACKUP_DIR}`;
  return name ? `${base}/${encodeURIComponent(name)}` : base;
}

async function maybeWriteBackupSnapshot() {
  const raw = state.settings.github || {};
  if (!personalDataReady(raw)) return;
  const cfg = personalDataConn(raw);  // v72: owner/repoは個人データリポジトリのものを使う
  const today = todayISO();
  try {
    if (localStorage.getItem(BACKUP_LAST_DATE_KEY) === today) return;  // 1日1回
  } catch { /* localStorage 不可でも続行(同日再PUTになるだけ) */ }
  try {
    const name = `app-state-${today}.json`;
    const url = gitHubBackupURL(cfg, name);
    // 同日ファイルが既にあれば sha を取得して上書き(別端末が先に書いた場合など)
    let sha = "";
    const head = await fetch(`${url}?ref=${encodeURIComponent(cfg.branch)}`, { headers: githubHeaders(cfg.token) });
    if (head.ok) {
      try { sha = (await head.json()).sha || ""; } catch { /* sha 不明なら新規作成として試す */ }
    }
    const put = await fetch(url, {
      method: "PUT",
      headers: githubHeaders(cfg.token),
      body: JSON.stringify({
        message: `backup: app-state snapshot ${today}`,
        content: toBase64(JSON.stringify(sanitizedStateForGitHub(), null, 2)),
        branch: cfg.branch,
        ...(sha ? { sha } : {})
      })
    });
    if (!put.ok) throw new Error(await gitHubErrorMessage(put));
    try { localStorage.setItem(BACKUP_LAST_DATE_KEY, today); } catch { /* 記録できなくても致命的ではない */ }
    pruneOldBackups(cfg, today);  // await しない(整理の失敗は本体に影響させない)
  } catch (error) {
    console.warn("世代バックアップをスキップ:", error.message);
  }
}

async function listBackups(cfg) {
  const resp = await fetch(`${gitHubBackupURL(cfg)}?ref=${encodeURIComponent(cfg.branch)}`, {
    headers: githubHeaders(cfg.token)
  });
  if (resp.status === 404) return [];  // まだバックアップなし
  if (!resp.ok) throw new Error(await gitHubErrorMessage(resp));
  const items = await resp.json();
  return (Array.isArray(items) ? items : [])
    .map((it) => {
      const m = String(it.name || "").match(/^app-state-(\d{4}-\d{2}-\d{2})\.json$/);
      return m ? { date: m[1], name: it.name, sha: it.sha || "" } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date));  // 新しい順
}

async function pruneOldBackups(cfg, today) {
  try {
    const cutoff = addDays(today, -BACKUP_KEEP_DAYS);
    const backups = await listBackups(cfg);
    for (const b of backups) {
      if (b.date >= cutoff || !b.sha) continue;
      await fetch(gitHubBackupURL(cfg, b.name), {
        method: "DELETE",
        headers: githubHeaders(cfg.token),
        body: JSON.stringify({ message: `backup: prune ${b.name}`, sha: b.sha, branch: cfg.branch })
      });
    }
  } catch (error) {
    console.warn("バックアップ整理をスキップ:", error.message);
  }
}

async function openBackupListModal() {
  try {
    const cfg = requireGitHubConfig();
    showToast("バックアップ一覧を取得中…");
    const backups = await listBackups(cfg);
    if (!backups.length) return showToast("バックアップはまだありません(次回のGitHub保存時に作成されます)");
    state.modal = { type: "backupList" };
    renderModal(buildBackupListModal(backups));
  } catch (error) {
    showToast(`一覧取得失敗: ${error.message}`);
  }
}

function buildBackupListModal(backups) {
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">📦 バックアップ世代から復元</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div class="muted" style="font-size:12px; line-height:1.6; margin-bottom:8px">
          各日の GitHub 保存時点のスナップショットです。復元するとこの端末のデータが置き換わり、
          次回の保存/自動同期で GitHub 側にも反映されます。
        </div>
        ${backups.map((b) => `
          <div class="backup-row">
            <span class="backup-date">📦 ${b.date}</span>
            <button class="btn" data-action="restore-backup" data-date="${b.date}">この時点に復元</button>
          </div>`).join("")}
      </div>
      <div class="modal-footer">
        <button class="btn" data-action="modal-close">閉じる</button>
      </div>
    </div>`;
}

async function restoreBackup(date) {
  const ok = window.confirm(
    `${date} 時点のバックアップに復元しますか?\n\n現在のデータは置き換わり、次回の保存/自動同期で GitHub にも反映されます。`
  );
  if (!ok) return;
  try {
    const cfg = requireGitHubConfig();
    const resp = await fetch(`${gitHubBackupURL(cfg, `app-state-${date}.json`)}?ref=${encodeURIComponent(cfg.branch)}`, {
      headers: githubHeaders(cfg.token)
    });
    if (!resp.ok) throw new Error(await gitHubErrorMessage(resp));
    const payload = await resp.json();
    const text = fromBase64(payload.content || "");
    // v72: スナップショットの settings.github(dataOwner/dataRepo/branch/path/token等)は
    // 復元時点の値であり得るため採用せず、常にこの端末の現在の接続設定をそのまま維持する
    // (cfg は requireGitHubConfig() の変換済み形状で owner/repo が dataOwner/dataRepo の値に
    //  なっているため、そのまま next.settings.github へ流し込むと dataOwner/dataRepo/path が
    //  壊れる。token を含め素の raw 設定を丸ごと引き継ぐのが正しい)。
    const currentGithubSettings = state.settings.github;
    clearTimeout(autoSaveTimer);
    const next = normalizeState(JSON.parse(text));
    next.settings.github = { ...next.settings.github, ...currentGithubSettings };
    setState(next);
    maintainRecurrences({ purge: true });
    closeModal();
    // saveState = dataModifiedAt を今に更新。「復元」をこの端末発の最新変更として扱うことで、
    // 直後の自動 pull がリモート(誤同期後の状態)で復元を黙って上書きするのを防ぐ。
    saveAndRender(`📦 ${date} 時点に復元しました。内容を確認してください`);
  } catch (error) {
    showToast(`復元失敗: ${error.message}`);
  }
}

// v53: =========================================================
//  自動アーカイブ(データ肥大対策)
//  localStorage は約5MBが上限で、日報・AIフィードバック・ジャーナル・Block は
//  無限に溜まり続ける。古い分を archive/archive-<年>.json へ退避して本体を軽く保つ。
//  最重要ルール: GitHub への書き込みが成功して初めてローカルから削除する。逆順は書かない。
// =========================================================
const ARCHIVE_LAST_DATE_KEY = "taskchute-archive-last-date";  // 端末ローカル(1日1回ガード)
const ARCHIVE_TEXT_KEEP_DAYS = 90;    // reports / feedback / journals の保持日数
const ARCHIVE_BLOCK_KEEP_DAYS = 180;  // Block の保持日数(生きている集計の最長84日を安全に超える幅)

function gitHubFileURL(cfg, filePath) {
  return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`;
}

// JSONファイルを取得(1MB超は Blob API へフォールバック)。404 は null。
async function fetchGitHubJSONFile(cfg, filePath) {
  const resp = await fetch(`${gitHubFileURL(cfg, filePath)}?ref=${encodeURIComponent(cfg.branch)}`, {
    headers: githubHeaders(cfg.token)
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(await gitHubErrorMessage(resp));
  const payload = await resp.json();
  let text;
  if (payload.content && payload.encoding === "base64") {
    text = fromBase64(payload.content);
  } else {
    const blobResp = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/git/blobs/${payload.sha}`,
      { headers: githubHeaders(cfg.token) }
    );
    if (!blobResp.ok) throw new Error(await gitHubErrorMessage(blobResp));
    text = fromBase64((await blobResp.json()).content || "");
  }
  return { obj: JSON.parse(text), sha: payload.sha || "" };
}

// 退避対象を年ごとに集める(削除はまだしない)
function collectArchivable() {
  const today = todayISO();
  const textCut = addDays(today, -ARCHIVE_TEXT_KEEP_DAYS);
  const blockCut = addDays(today, -ARCHIVE_BLOCK_KEEP_DAYS);
  const byYear = {};
  const bucket = (date) => (byYear[date.slice(0, 4)] ||= { reports: {}, feedback: {}, journals: {}, blocks: [] });
  Object.entries(state.reports || {}).forEach(([d, md]) => { if (d < textCut && md) bucket(d).reports[d] = md; });
  Object.entries(state.feedback || {}).forEach(([d, md]) => { if (d < textCut && md) bucket(d).feedback[d] = md; });
  Object.entries(state.journals || {}).forEach(([d, md]) => { if (d < textCut && md) bucket(d).journals[d] = md; });
  state.blocks.forEach((b) => { if (!b.deleted && b.date && b.date < blockCut) bucket(b.date).blocks.push(b); });
  return { byYear, textCut, blockCut };
}

async function runArchive({ manual = false } = {}) {
  const raw = state.settings.github || {};
  if (!personalDataReady(raw)) {
    if (manual) showToast("アーカイブには GitHub 設定(個人データリポジトリ・token)が必要です");
    return;
  }
  const cfg = personalDataConn(raw);  // v72: 個人データリポジトリへ
  const { byYear, textCut, blockCut } = collectArchivable();
  const years = Object.keys(byYear).sort();
  if (!years.length) {
    if (manual) showToast(`アーカイブ対象はありません(日報等は${ARCHIVE_TEXT_KEEP_DAYS}日・Blockは${ARCHIVE_BLOCK_KEEP_DAYS}日より古い分が対象)`);
    return;
  }
  if (manual) showToast("📦 アーカイブ中…");
  try {
    for (const year of years) {
      const filePath = personalDataPath(`archive/archive-${year}.json`);
      // 既存アーカイブを読み込んでマージ(日付キー / Block id で冪等)
      const existing = await fetchGitHubJSONFile(cfg, filePath);
      const merged = existing?.obj && typeof existing.obj === "object"
        ? { reports: {}, feedback: {}, journals: {}, blocks: [], ...existing.obj }
        : { reports: {}, feedback: {}, journals: {}, blocks: [] };
      Object.assign(merged.reports, byYear[year].reports);
      Object.assign(merged.feedback, byYear[year].feedback);
      Object.assign(merged.journals, byYear[year].journals);
      const seen = new Set(merged.blocks.map((b) => b.id));
      byYear[year].blocks.forEach((b) => { if (!seen.has(b.id)) merged.blocks.push(b); });
      const put = await fetch(gitHubFileURL(cfg, filePath), {
        method: "PUT",
        headers: githubHeaders(cfg.token),
        body: JSON.stringify({
          message: `archive: ${year} update ${todayISO()}`,
          content: toBase64(JSON.stringify(merged, null, 1)),
          branch: cfg.branch,
          ...(existing?.sha ? { sha: existing.sha } : {})
        })
      });
      if (!put.ok) throw new Error(await gitHubErrorMessage(put));
    }
    // ここまで到達 = 全ての年の書き込みに成功。初めてローカルから削除する。
    let removed = 0;
    for (const d of Object.keys(state.reports || {})) if (d < textCut) { delete state.reports[d]; removed++; }
    for (const d of Object.keys(state.feedback || {})) if (d < textCut) { delete state.feedback[d]; removed++; }
    for (const d of Object.keys(state.journals || {})) if (d < textCut) { delete state.journals[d]; removed++; }
    const before = state.blocks.length;
    state.blocks = state.blocks.filter((b) => !(b.date && b.date < blockCut));  // 削除済み(tombstone)も古ければ落とす
    removed += before - state.blocks.length;
    state.settings.lastArchivedAt = nowDateTime();
    _archiveCache = null;  // 検索キャッシュは次回読み直し
    saveState();
    render();
    showToast(`📦 ${removed}件をアーカイブへ退避しました(archive/)`);
  } catch (error) {
    // 何も削除していないので安全。手動時のみ通知、自動時は静かに。
    if (manual) showToast(`アーカイブ失敗: ${error.message}`);
    else console.warn("自動アーカイブをスキップ:", error.message);
  }
}

function maybeAutoArchive() {
  if (!state.settings.autoArchive) return;
  if (!personalDataReady(state.settings.github)) return;
  const today = todayISO();
  try {
    if (localStorage.getItem(ARCHIVE_LAST_DATE_KEY) === today) return;  // 1日1回(失敗しても再試行しない)
    localStorage.setItem(ARCHIVE_LAST_DATE_KEY, today);
  } catch { /* 記録できなければ続行(重複マージは冪等) */ }
  runArchive();
}

// 端末内データ量の目安表示(localStorage は UTF-16 なので文字数×2バイト換算)
function stateSizeLabel() {
  try {
    const bytes = JSON.stringify(state).length * 2;
    return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)}MB` : `${Math.round(bytes / 1024)}KB`;
  } catch {
    return "?";
  }
}

// ---- 横断検索へのアーカイブ合流(オプトイン・lazy fetch・非永続キャッシュ) ----
let _archiveCache = null;      // { reports:{}, feedback:{}, journals:{} } 全年マージ
let _archiveLoadState = "";    // "" | "loading" | "loaded" | "error"

function refreshSearchResults() {
  const input = document.querySelector("#cross-search-input");
  const box = document.querySelector("#cross-search-results");
  if (input && box) box.innerHTML = crossSearchResultsHTML(input.value);
}

async function loadArchiveForSearch() {
  if (_archiveCache) return refreshSearchResults();
  if (_archiveLoadState === "loading") return;
  const raw = state.settings.github || {};
  if (!personalDataReady(raw)) return showToast("アーカイブ検索には GitHub 設定(個人データリポジトリ)が必要です");
  const cfg = personalDataConn(raw);  // v72: 個人データリポジトリへ
  _archiveLoadState = "loading";
  refreshSearchResults();
  try {
    const dirResp = await fetch(`${gitHubFileURL(cfg, personalDataPath("archive"))}?ref=${encodeURIComponent(cfg.branch)}`, {
      headers: githubHeaders(cfg.token)
    });
    const merged = { reports: {}, feedback: {}, journals: {} };
    if (dirResp.status !== 404) {
      if (!dirResp.ok) throw new Error(await gitHubErrorMessage(dirResp));
      const items = await dirResp.json();
      const files = (Array.isArray(items) ? items : [])
        .map((it) => String(it.name || ""))
        .filter((n) => /^archive-\d{4}\.json$/.test(n));
      for (const name of files) {
        const file = await fetchGitHubJSONFile(cfg, personalDataPath(`archive/${name}`));
        if (!file?.obj) continue;
        Object.assign(merged.reports, file.obj.reports || {});
        Object.assign(merged.feedback, file.obj.feedback || {});
        Object.assign(merged.journals, file.obj.journals || {});
      }
    }
    _archiveCache = merged;
    _archiveLoadState = "loaded";
  } catch (error) {
    _archiveLoadState = "error";
    showToast(`アーカイブ読込失敗: ${error.message}`);
  }
  refreshSearchResults();
}

function resetDemoData() {
  setState(normalizeState(seedState()));
  saveAndRender("デモデータに戻しました");
}

// v111: ポモドーロ開始時のiOSガイド付きアクセス案内の対象端末判定。
// iPhone/iPodはUAに"iPhone"/"iPod"を含む。iPadOS(v13以降)は既定でデスクトップ版Safari同様
// "Macintosh"を名乗るため、"Macintosh"+タッチ対応(maxTouchPoints>1)で判定する
// (通常のデスクトップMacはmaxTouchPoints=0のため誤検知しない)。
function isIOSDevice() {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
}

// v111: ポモドーロ開始時、iOS系端末(iPad/iPhone)のみガイド付きアクセスのリマインドを出す。
// PWAからガイド付きアクセスを自動設定することはiOSの制約上不可能と調査済みのため、手動操作
// (サイドボタン/ホームボタン トリプルクリック)を案内するだけの軽いポップアップに留める。
// 呼び出し元(startPomodoro)で既にタイマーが開始済みのため、このポップアップは開始自体を
// ブロックしない(表示中も裏でタイマーは進行する)。設定 pomoGuidedAccessHint(既定true)を
// falseにすると恒久的に抑制できる(モーダルの「今後表示しない」または設定画面のトグル)。
function maybeShowGuidedAccessHint() {
  if (!isIOSDevice()) return;
  if (state.settings.pomoGuidedAccessHint === false) return;
  state.modal = { type: "guidedAccessHint" };
  renderModal(buildGuidedAccessHintModal());
}

function buildGuidedAccessHintModal() {
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">🔒 ガイド付きアクセスで画面をロックしますか?</h3>
        <button class="modal-close" data-action="guided-access-dismiss" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div style="font-size:14px; line-height:1.7">
          サイドボタン(ホームボタン搭載機種はホームボタン)をすばやく3回押すと、ガイド付き
          アクセスで画面をロックできます。事前に「設定 > アクセシビリティ > ガイド付きアクセス」
          をONにしておいてください。タイマーはこのまま動いています。
        </div>
        <label class="checkbox-line" style="margin-top:12px; font-size:13px">
          <input type="checkbox" data-guided-access-suppress>
          今後表示しない
        </label>
      </div>
      <div class="modal-footer">
        <button class="btn primary" data-action="guided-access-dismiss">閉じる</button>
      </div>
    </div>
  `;
}

function startPomodoro(blockId) {
  if (!blockId) return showToast("Blockを選んでください");
  // v14: state.pomodoro を完全再構築(spread を使わず、必要なフィールドだけ明示的に作成)
  // これで以前のセッションの endsAt/startedAt/mode が確実にリセットされる
  const tab = state.pomodoro?.tab || "manual";
  const passive = state.pomodoro?.passive || defaultPassivePomodoro();
  const fullscreen = state.pomodoro?.fullscreen || false;
  const studyWithMeOn = state.pomodoro?.studyWithMeOn || false;  // v84
  const now = Date.now();
  state.pomodoro = {
    tab,
    passive,
    fullscreen,
    studyWithMeOn,
    running: true,
    blockId,
    startedAt: dateToLocalDateTime(new Date(now)),
    endsAt: dateToLocalDateTime(new Date(now + 25 * 60 * 1000)),
    mode: "focus"
  };
  // v13: ポモドーロ開始時、Blockの実績開始時間を自動記録(既存値があれば維持)
  updateBlockField(blockId, "actualStartAt", blockById(blockId)?.actualStartAt || nowDateTime());
  saveAndRender("ポモドーロを開始しました(50:00 から)");
  // v111: タイマー開始後(非ブロッキング)にiOSガイド付きアクセスのリマインドを出す。
  //       modalRootはrender()と独立したDOMルートのため、直前のsaveAndRenderの再描画で
  //       消えることはない。
  maybeShowGuidedAccessHint();
}

// v14: ポモドーロセッションを強制完全リセット(他フィールド保持)
// click ハンドラで start-pomodoro の前に呼んで、中断/完了/休憩後の再開で確実に 50:00 から始まることを保証
function forceResetPomodoroSession() {
  state.pomodoro = {
    tab: state.pomodoro?.tab || "manual",
    passive: state.pomodoro?.passive || defaultPassivePomodoro(),
    fullscreen: state.pomodoro?.fullscreen || false,
    studyWithMeOn: state.pomodoro?.studyWithMeOn || false,  // v84
    running: false,
    blockId: "",
    startedAt: "",
    endsAt: "",
    mode: "focus"
  };
}

// v70: フォーカスタイマー「中断」時のチョコ停記録。中断そのもの(actualStartAtのクリア等)は
// 既存の stopPomodoro() の挙動をそのまま維持し、追加で block.interruptions[] に理由を積むだけ。
// 集計・分析は行わない(バッチ側の領分。設計方針「実行の道具に痩せさせる」に合わせる)。
const INTERRUPT_REASONS = ["割込み", "疲労", "迷い", "その他"];

function recordBlockInterruption(blockId, reason) {
  if (!blockId) return;
  state.blocks = state.blocks.map((b) => b.id === blockId
    ? { ...b, interruptions: [...(b.interruptions || []), { at: nowDateTime(), reason }], updatedAt: nowDateTime() }
    : b);
  saveState();
}

// 「中断」ボタン押下直後だけ出す軽量な理由ピッカー(v62の却下理由ピッカーと同じ思想)。
// キャンセルすればタイマーは止まらない(理由選択がトラップにならないよう退路を残す)。
function interruptReasonPickerHTML() {
  return `
    <div class="interrupt-reason-picker">
      <div class="muted" style="font-size:12px; margin-bottom:6px">中断の理由(チョコ停として記録します):</div>
      <div class="row" style="gap:6px; justify-content:center; flex-wrap:wrap">
        ${INTERRUPT_REASONS.map((r) => `<button class="btn ghost" data-action="interrupt-reason" data-reason="${escapeHTML(r)}">${escapeHTML(r)}</button>`).join("")}
        <button class="btn ghost" data-action="interrupt-reason-cancel">キャンセル</button>
      </div>
    </div>`;
}

function stopPomodoro() {
  // v13: 中断時、紐づくBlockの actualStartAt を消す(再開で改めて記録するため)
  const blockId = state.pomodoro.blockId;
  if (blockId) {
    state.blocks = state.blocks.map((block) => block.id === blockId
      ? { ...block, actualStartAt: "", updatedAt: nowDateTime() }
      : block);
  }
  // v14: state.pomodoro を完全再構築(再開時に確実に 50:00 から)
  state.pomodoro = {
    tab: state.pomodoro?.tab || "manual",
    passive: state.pomodoro?.passive || defaultPassivePomodoro(),
    fullscreen: state.pomodoro?.fullscreen || false,
    studyWithMeOn: state.pomodoro?.studyWithMeOn || false,  // v84
    running: false,
    blockId: "",
    startedAt: "",
    endsAt: "",
    mode: "focus"
  };
  saveAndRender("ポモドーロを中断しました(実績開始時刻をクリア)");
}

function completePomodoro() {
  const blockId = state.pomodoro.blockId;
  if (blockId) {
    // v19: 完了時、Block の完了フラグも立てる + 実績終了時刻記録
    state.blocks = state.blocks.map((block) => block.id === blockId
      ? {
          ...block,
          pomodoroCount: Number(block.pomodoroCount || 0) + 1,
          actualEndAt: nowDateTime(),
          completed: true,
          updatedAt: nowDateTime()
        }
      : block);
  }
  state.pomodoro = {
    tab: state.pomodoro?.tab || "manual",
    passive: state.pomodoro?.passive || defaultPassivePomodoro(),
    fullscreen: state.pomodoro?.fullscreen || false,
    studyWithMeOn: state.pomodoro?.studyWithMeOn || false,  // v84
    running: false,
    blockId: "",
    startedAt: "",
    endsAt: "",
    mode: "focus"
  };
  saveAndRender("ポモドーロを完了しました(Blockに完了チェック)");
  // v129: 身体スキャン(強制サンプリング)を先に見せ、閉じた後に過集中ゲート判定を行う
  // (モーダルは1枚ずつしか出せないため。ゲート自体はv117(C)のまま、blockId必須の条件も維持)。
  openBodyScanModal(blockId);
}

// v129: ポモドーロ身体スキャン ====================================================
// 没入中に身体信号が届かない特性への対策。50分ごとに必ず手が止まるポモドーロ完了時を
// 強制サンプリングポイントにし、疲労1-5→任意で部位、の2タップで記録する。摩擦最小のため
// どのステップでも「記録せず閉じる」で抜けられる(スキップを強制しない)。
// 順序: 身体スキャン→閉じた後にv117(C)過集中ゲート判定(既存の90分ガードはそのまま)。
// =============================================================
let _pendingBodyScanCtx = null;
const BODY_SCAN_PARTS = ["目", "肩", "胃", "頭"];

function openBodyScanModal(pomodoroBlockId) {
  _pendingBodyScanCtx = { pomodoroBlockId: pomodoroBlockId || "", fatigue: null };
  state.modal = { type: "bodyScan" };
  renderModal(buildBodyScanStep1Modal());
}

function buildBodyScanStep1Modal() {
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">🧘 いまの疲労感は?</h3>
        <button class="modal-close" data-action="body-scan-discard" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div class="row" style="gap:8px; justify-content:center; flex-wrap:wrap">
          ${[1, 2, 3, 4, 5].map((n) => `<button class="btn" style="font-size:20px; min-width:52px; min-height:52px" data-action="body-scan-fatigue" data-value="${n}">${n}</button>`).join("")}
        </div>
        <div class="muted" style="font-size:11px; text-align:center; margin-top:8px">1=元気 〜 5=かなり疲れた</div>
      </div>
      <div class="modal-footer">
        <button class="btn ghost" data-action="body-scan-discard">記録せず閉じる</button>
      </div>
    </div>`;
}

function buildBodyScanStep2Modal() {
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">どこが疲れていますか?(任意)</h3>
        <button class="modal-close" data-action="body-scan-discard" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div class="row" style="gap:8px; flex-wrap:wrap; justify-content:center">
          ${BODY_SCAN_PARTS.map((p) => `<button class="btn" style="font-size:16px; padding:10px 16px" data-action="body-scan-part" data-part="${p}">${p}</button>`).join("")}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn ghost" data-action="body-scan-part" data-part="">スキップして記録</button>
      </div>
    </div>`;
}

// 1タップ目: 疲労1-5を選び、2タップ目(部位)へ進む
function bodyScanRecordFatigue(value) {
  if (!_pendingBodyScanCtx) return;
  _pendingBodyScanCtx.fatigue = value;
  renderModal(buildBodyScanStep2Modal());
}

// 2タップ目: 部位を選ぶ(""ならスキップして記録)。エントリを保存して閉じる。
function bodyScanRecordPart(part) {
  if (!_pendingBodyScanCtx || !_pendingBodyScanCtx.fatigue) return;
  const entry = {
    id: crypto.randomUUID(),
    dateTime: nowDateTime(),
    fatigue: _pendingBodyScanCtx.fatigue,
    part: part || "",
    pomodoroBlockId: _pendingBodyScanCtx.pomodoroBlockId || ""
  };
  state.bodyScans = [...state.bodyScans, entry];
  closeBodyScanFlow(true);
}

// 「記録せず閉じる」: どのステップからでも呼べる(強制しない)
function bodyScanDiscard() {
  closeBodyScanFlow(false);
}

function closeBodyScanFlow(saved) {
  const ctx = _pendingBodyScanCtx;
  _pendingBodyScanCtx = null;
  closeModal();
  if (saved) saveAndRender("身体スキャンを記録しました");
  else render();
  // v117(C)と同じ条件(blockId必須)でゲート判定。身体スキャンを閉じた後に行う(順序契約)。
  if (ctx && ctx.pomodoroBlockId) maybeOpenHyperfocusGate();
}

// ============================================================
// v162: 未完了理由クイック入力(K裁定2026-07-28「言い訳ハンターの入力源」b案)
// 2つの入口がある:
//  (a) 仕分けモードの「手放す/延期」実行直後 — triageAction()が_pendingInlineReasonを立て、
//      renderWishTriage()(上記triageInlineReasonHTML参照)がカードの下にインラインで
//      理由チップ欄を出す。全画面モーダルにしないのは、Undoトースト(5秒間)を覆って
//      タップ不能にしないため(recordTriageInlineReason/skipTriageInlineReasonが処理)。
//  (b) 日次締め(「日報を生成」ボタン押下時に当日の未完了Blockが理由未記録のまま残っている
//      場合) — こちらはUndoトーストと同時に出る心配が無いため、通常のモーダル
//      (openIncompleteReasonModal以下)で複数件を1件ずつキューで尋ねる。
// どちらもv129身体スキャンと同じ「強制しない」設計(いつでもスキップ/×で抜けられる)。
// ============================================================
const INCOMPLETE_REASON_CHIPS = ["疲労", "時間切れ", "気分が乗らない", "割り込み", "見積り過大", "その他"];
let _pendingIncompleteReasonCtx = null; // { queue: string[](残りのblock id), mode: 'dailyClose' } | null
// v162 2系統レビュー対応(推奨4): 日次締めモーダルで「スキップ」したBlock idを積む
// (_triageSessionDoneと同じ「セッション内・非永続」の流儀)。同じセッション内で「日報を生成」を
// 再度押しても、既にスキップ済みのBlockは再質問しない(ページリロードで自然にリセットされる)。
let _dailyCloseReasonSkipped = new Set();

function hasIncompleteReason(block) {
  return Boolean(block && block.incompleteReason && block.incompleteReason.chip);
}

// (a) 仕分けモードのインライン理由チップ欄(triageInlineReasonHTML)の確定/スキップ。
// modalRootではなく#app本体に描画されるため、noteの取得は素直にdocument.querySelectorで行う。
function recordTriageInlineReason(chip) {
  if (!_pendingInlineReason || !chip) { skipTriageInlineReason(); return; }
  const blockId = _pendingInlineReason.blockId;
  const note = (document.querySelector("[data-triage-reason-note]")?.value || "").trim();
  state.blocks = state.blocks.map((b) => b.id === blockId
    ? { ...b, incompleteReason: { chip, note, at: nowDateTime() }, updatedAt: nowDateTime() }
    : b);
  _pendingInlineReason = null;
  // v162: saveAndRender()で新しいトーストを出すと、直前の手放す/延期のUndoトースト
  // (triageUndoToastOpts、5秒間有効)を上書きして「元に戻す」ボタンごと消してしまう。
  // 理由記録自体はUndo対象の一部(_triageUndoのrevertが完全に元へ戻す)であり続けたいので、
  // ここではトーストを出さずsaveState()+render()だけに留める(Undoの生存期間に触れない)。
  saveState();
  render();
}

function skipTriageInlineReason() {
  _pendingInlineReason = null;
  render();
}

// (b) 日次締めモーダル: blockIds を1件ずつ順に尋ねる。存在しないidは無視。空(または全件無効)なら
// mode==='dailyClose'の時だけそのままgenerateReport()へ進む(triageモードは何もしない)。
function openIncompleteReasonModal(blockIds, mode) {
  const queue = (blockIds || []).filter((bid) => blockById(bid));
  if (!queue.length) {
    if (mode === "dailyClose") generateReport();
    return;
  }
  _pendingIncompleteReasonCtx = { queue, mode };
  const first = blockById(queue[0]);
  state.modal = { type: "incompleteReason", id: queue[0] };
  renderModal(buildIncompleteReasonModal(first, queue.length));
}

function buildIncompleteReasonModal(block, remaining) {
  const counter = remaining > 1 ? `<div class="muted" style="font-size:11px; margin-bottom:6px">残り${remaining}件</div>` : "";
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">📝 未完了の理由(任意)</h3>
        <button class="modal-close" data-action="incomplete-reason-skip" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        ${counter}
        <div style="font-size:14px">「${escapeHTML(block.title)}」</div>
        <div class="field" style="margin-top:10px">
          <label class="field-label">一言(任意)</label>
          <input class="input" style="font-size:16px" data-incomplete-reason-note placeholder="状況など">
        </div>
        <div class="row" style="gap:8px; margin-top:10px; flex-wrap:wrap; justify-content:center">
          ${INCOMPLETE_REASON_CHIPS.map((c) => `<button class="btn ghost" data-action="incomplete-reason-chip" data-chip="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join("")}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn ghost" data-action="incomplete-reason-skip">スキップ</button>
      </div>
    </div>`;
}

// チップ1タップで確定(ノートは任意入力済みのものをそのまま使う)→ 次のキューへ
function recordIncompleteReasonChip(chip) {
  if (!_pendingIncompleteReasonCtx || !chip) { skipIncompleteReasonModal(); return; }
  const blockId = _pendingIncompleteReasonCtx.queue[0];
  const note = (modalRoot.querySelector("[data-incomplete-reason-note]")?.value || "").trim();
  state.blocks = state.blocks.map((b) => b.id === blockId
    ? { ...b, incompleteReason: { chip, note, at: nowDateTime() }, updatedAt: nowDateTime() }
    : b);
  saveState();
  advanceIncompleteReasonQueue();
}

// 「スキップ」/× / 背景タップ共通: 記録せず次のキューへ(罰なしトーンで軽く抜けられる)。
// v162 2系統レビュー対応(推奨4): スキップしたBlock idを_dailyCloseReasonSkippedへ積み、
// 同じセッション内で「日報を生成」を再度押しても再質問しないようにする。
function skipIncompleteReasonModal() {
  const blockId = _pendingIncompleteReasonCtx?.queue?.[0];
  if (blockId) _dailyCloseReasonSkipped.add(blockId);
  advanceIncompleteReasonQueue();
}

function advanceIncompleteReasonQueue() {
  if (!_pendingIncompleteReasonCtx) { closeModal(); return; }
  _pendingIncompleteReasonCtx.queue.shift();
  while (_pendingIncompleteReasonCtx.queue.length && !blockById(_pendingIncompleteReasonCtx.queue[0])) {
    _pendingIncompleteReasonCtx.queue.shift();  // 念のため(削除等で消えたidを読み飛ばす)
  }
  if (_pendingIncompleteReasonCtx.queue.length) {
    const next = blockById(_pendingIncompleteReasonCtx.queue[0]);
    state.modal = { type: "incompleteReason", id: next.id };
    renderModal(buildIncompleteReasonModal(next, _pendingIncompleteReasonCtx.queue.length));
    return;
  }
  const mode = _pendingIncompleteReasonCtx.mode;
  _pendingIncompleteReasonCtx = null;
  closeModal();
  if (mode === "dailyClose") generateReport();
  else render();
}

// ============================================================
// v87: 宣言→終了報告ループ(ROADMAP v91・実番号v87)
// Focusmateの効果成分のうち「目標の宣言」と「終了報告」だけを取り出す。摩擦最小のため
// どちらもワンタップで確定でき、スキップすれば従来どおりの動作(宣言/報告なし)になる。
// アプリ内Claude API呼び出しは全廃済み(v60)のため、フィードバックは決定論(定型文+簡易集計)
// のみ。宣言・報告ログは state.declarations に保存し(normalizeStateで上限300件・後方互換)、
// GitHub自動push(app-state.json)経由でバッチ側(coach-daily.sh)が翌朝読む。
// ============================================================

// ブロックの見積時間(分)。ポモドーロは固定25分、通常BlockはestimateMin→予定時刻差→無しの順。
function estimateMinutesForBlock(block, kind) {
  if (kind === "pomodoro") return 25;
  if (block && block.estimateMin != null && block.estimateMin !== "") return Number(block.estimateMin);
  if (block && block.plannedStartAt && block.plannedEndAt) {
    const diff = minutesOf(block.plannedEndAt) - minutesOf(block.plannedStartAt);
    if (diff > 0) return diff;
  }
  return null;
}

// 宣言ログを1件追加(上限300件は正規化側でも担保するが、ここでも即時に切り詰める)
function logDeclaration(blockId, note, estimateMin) {
  const block = state.blocks.find((b) => b.id === blockId);
  const entry = {
    id: crypto.randomUUID(),
    blockId,
    date: todayISO(),
    title: block?.title || "",
    estimateMin: estimateMin != null ? estimateMin : null,
    note: (note || "").trim(),
    declaredAt: nowDateTime(),
    reportedAt: "",
    outcome: "",
    resultNote: ""
  };
  state.declarations = [...(state.declarations || []), entry].slice(-300);
  return entry;
}

// 終了報告を記録する。当日・同じBlockで未報告の宣言があればそこに合流、無ければ
// 「宣言なしの終了報告」として新規エントリを作る(宣言・報告いずれも独立して任意のため)。
function reportForBlock(blockId, outcome, resultNote) {
  const today = todayISO();
  const list = state.declarations || [];
  let idx = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].blockId === blockId && list[i].date === today && !list[i].reportedAt) { idx = i; break; }
  }
  if (idx === -1) {
    const block = state.blocks.find((b) => b.id === blockId);
    const entry = {
      id: crypto.randomUUID(),
      blockId,
      date: today,
      title: block?.title || "",
      estimateMin: null,
      note: "",
      declaredAt: "",
      reportedAt: nowDateTime(),
      outcome: outcome || "",
      resultNote: (resultNote || "").trim()
    };
    state.declarations = [...list, entry].slice(-300);
    return entry;
  }
  const updated = { ...list[idx], reportedAt: nowDateTime(), outcome: outcome || "", resultNote: (resultNote || "").trim() };
  state.declarations = [...list.slice(0, idx), updated, ...list.slice(idx + 1)];
  return updated;
}

// 決定論フィードバック(定型文+簡易集計のみ。AI呼び出しはしない)
function buildDeclareFeedback(entry) {
  const parts = [];
  const outcomeLabel = { done: "できた", partial: "一部できた", derailed: "脱線した" }[entry.outcome] || "";
  if (outcomeLabel) parts.push(outcomeLabel);
  if (entry.declaredAt && entry.reportedAt) {
    const durMin = Math.max(0, Math.round((localDateTimeToMs(entry.reportedAt) - localDateTimeToMs(entry.declaredAt)) / 60000));
    const est = (entry.estimateMin != null && entry.estimateMin !== "") ? `(宣言時見積${entry.estimateMin}分)` : "";
    parts.push(`宣言→完了まで${durMin}分${est}`);
  }
  const today = todayISO();
  const todays = (state.declarations || []).filter((e) => e.date === today && e.declaredAt);
  if (todays.length > 0) {
    const achieved = todays.filter((e) => e.outcome === "done").length;
    parts.push(`今日の宣言達成 ${achieved}/${todays.length}`);
  }
  return parts.join("。");
}

// ---------- 宣言モーダル ----------

function openDeclareModal(blockId, kind) {
  const block = state.blocks.find((b) => b.id === blockId && !b.deleted);
  if (!block) {
    // Blockが見つからない(空id等)場合は宣言をスキップし従来どおり即実行
    resumeLifecycleStart({ blockId, kind });
    return;
  }
  _pendingLifecycleCtx = { blockId, phase: "declare", kind };
  state.modal = { type: "declare", id: blockId };
  renderModal(buildDeclareModal(block, estimateMinutesForBlock(block, kind)));
}

function buildDeclareModal(block, estimateMin) {
  const estText = estimateMin ? `${estimateMin}分` : "";
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">宣言</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div style="font-size:15px; font-weight:600">今から「${escapeHTML(block.title)}」を${estText}やる</div>
        <div class="field" style="margin-top:10px">
          <label class="field-label">一言(任意)</label>
          <input class="input" style="font-size:16px" data-declare-note placeholder="意気込み・やり方など">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-action="declare-skip">宣言せず開始</button>
        <button class="btn primary" data-action="declare-confirm">宣言して開始</button>
      </div>
    </div>
  `;
}

function resumeLifecycleStart(ctx) {
  if (ctx.kind === "pomodoro") {
    forceResetPomodoroSession();
    startPomodoro(ctx.blockId);
  } else {
    setBlockTime(ctx.blockId, "actualStartAt");
  }
}

function confirmDeclare() {
  if (!_pendingLifecycleCtx) return;
  const ctx = _pendingLifecycleCtx;
  const note = modalRoot.querySelector("[data-declare-note]")?.value || "";
  const block = state.blocks.find((b) => b.id === ctx.blockId);
  const estimateMin = estimateMinutesForBlock(block, ctx.kind);
  logDeclaration(ctx.blockId, note, estimateMin);
  _pendingLifecycleCtx = null;
  closeModal();
  resumeLifecycleStart(ctx);
}

function skipDeclare() {
  if (!_pendingLifecycleCtx) return;
  const ctx = _pendingLifecycleCtx;
  _pendingLifecycleCtx = null;
  closeModal();
  resumeLifecycleStart(ctx);
}

// ---------- 終了報告モーダル ----------

const REPORT_OUTCOMES = [
  { value: "done", label: "できた" },
  { value: "partial", label: "一部できた" },
  { value: "derailed", label: "脱線した" }
];

function openReportModal(blockId, kind) {
  const block = state.blocks.find((b) => b.id === blockId && !b.deleted);
  if (!block) {
    // Blockが見つからない(空id等)場合は報告をスキップし従来どおり即実行
    resumeLifecycleFinish({ blockId, kind });
    return;
  }
  _pendingLifecycleCtx = { blockId, phase: "report", kind };
  state.modal = { type: "report", id: blockId };
  renderModal(buildReportModal(block));
}

function buildReportModal(block) {
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">終了報告</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div style="font-size:14px">「${escapeHTML(block.title)}」お疲れさまでした</div>
        <div class="field" style="margin-top:10px">
          <label class="field-label">一言(任意)</label>
          <input class="input" style="font-size:16px" data-report-note placeholder="成果・気づきなど">
        </div>
      </div>
      <div class="modal-footer" style="flex-wrap:wrap">
        ${REPORT_OUTCOMES.map((o) => `<button class="btn" data-action="report-outcome" data-outcome="${o.value}">${o.label}</button>`).join("")}
        <button class="btn ghost" data-action="report-skip">スキップ</button>
      </div>
    </div>
  `;
}

function resumeLifecycleFinish(ctx) {
  if (ctx.kind === "pomodoro") completePomodoro();
  else setBlockTime(ctx.blockId, "actualEndAt");
}

// outcome が空("スキップ")の場合はログを残さず従来どおりの完了トーストのまま終える。
function finishReport(outcome, note) {
  if (!_pendingLifecycleCtx) return;
  const ctx = _pendingLifecycleCtx;
  _pendingLifecycleCtx = null;
  closeModal();
  const entry = outcome ? reportForBlock(ctx.blockId, outcome, note) : null;
  resumeLifecycleFinish(ctx);
  if (entry) {
    const feedback = buildDeclareFeedback(entry);
    if (feedback) showToast(feedback);
  }
  // v117(C): 過集中ブレーカーのゲート化。「■いま終了」(v70)が終了報告モーダルを解決した直後。
  if (ctx.kind === "block") maybeOpenHyperfocusGate();
}

// v9: 「☕ 休憩へ」: focus → break に遷移(現在のセッションを完了扱いに + 5分休憩開始)
function goBreakPomodoro() {
  const blockId = state.pomodoro.blockId;
  if (blockId) {
    state.blocks = state.blocks.map((block) => block.id === blockId
      ? { ...block, pomodoroCount: Number(block.pomodoroCount || 0) + 1, actualEndAt: block.actualEndAt || nowDateTime(), updatedAt: nowDateTime() }
      : block);
  }
  // v14: 完全再構築 + 5分休憩開始
  // v19: lastFocusBlockId に保存(休憩後に「続ける/完了」選択用)
  const now = Date.now();
  state.pomodoro = {
    tab: state.pomodoro?.tab || "manual",
    passive: state.pomodoro?.passive || defaultPassivePomodoro(),
    fullscreen: state.pomodoro?.fullscreen || false,
    studyWithMeOn: state.pomodoro?.studyWithMeOn || false,  // v84
    running: true,
    blockId: "",
    lastFocusBlockId: blockId || "",  // v19
    startedAt: dateToLocalDateTime(new Date(now)),
    endsAt: dateToLocalDateTime(new Date(now + 5 * 60 * 1000)),
    mode: "break"
  };
  saveAndRender("休憩を開始しました");
}

// v9: 「✓ 休憩終了」: break セッションを終わって未起動状態に
function endBreakPomodoro() {
  // v14: 完全再構築
  state.pomodoro = {
    tab: state.pomodoro?.tab || "manual",
    passive: state.pomodoro?.passive || defaultPassivePomodoro(),
    fullscreen: state.pomodoro?.fullscreen || false,
    studyWithMeOn: state.pomodoro?.studyWithMeOn || false,  // v84
    running: false,
    blockId: "",
    startedAt: "",
    endsAt: "",
    mode: "focus"
  };
  saveAndRender("休憩を終了しました");
}

// v19: 休憩中「🔁 同じBlockで続ける」: 休憩を打ち切り、同じBlockで新セッション開始
function continueFocusPomodoro() {
  const lastBlockId = state.pomodoro.lastFocusBlockId;
  if (!lastBlockId) return showToast("直前のBlock情報が見つかりません");
  forceResetPomodoroSession();
  startPomodoro(lastBlockId);
}

// v19: 休憩中「✅ ここで完了する」: Blockに完了フラグ + 実績終了時刻(=休憩開始時刻)を記録
function finishBlockFromBreak() {
  const lastBlockId = state.pomodoro.lastFocusBlockId;
  const breakStartedAt = state.pomodoro.startedAt;  // 休憩開始時刻 = 直前セッションの終了時刻
  if (lastBlockId) {
    state.blocks = state.blocks.map((b) => b.id === lastBlockId
      ? {
          ...b,
          completed: true,
          actualEndAt: breakStartedAt || b.actualEndAt || nowDateTime(),
          updatedAt: nowDateTime()
        }
      : b);
  }
  // タイマーを終了状態に
  state.pomodoro = {
    tab: state.pomodoro?.tab || "manual",
    passive: state.pomodoro?.passive || defaultPassivePomodoro(),
    fullscreen: state.pomodoro?.fullscreen || false,
    studyWithMeOn: state.pomodoro?.studyWithMeOn || false,  // v84
    running: false,
    blockId: "",
    startedAt: "",
    endsAt: "",
    mode: "focus"
  };
  saveAndRender("✅ Block を完了しました(実績終了時刻を記録)");
}

// v84: ポモドーロのtick更新(500ms毎)。Study With Me表示中は main.innerHTML の丸ごと
// 置換(renderMain())をせず、時刻テキストと進捗円のみをDOM直接更新する。
// renderPomodoro()が返す文字列自体は毎回同じでも、innerHTML代入はDOMノードを作り直すため、
// 埋め込み中のiframeがtick毎(1秒に2回)に再読込されてしまう(v34の検索欄差分パッチと同じ理由)。
// Study With Me非表示時は従来どおり renderMain() にフォールバックする(挙動変更なし)。
function updatePomodoroTick() {
  if (!state.pomodoro.studyWithMeOn || state.currentView !== "pomodoro") {
    renderMain();
    return;
  }
  const overlay = document.querySelector(".pomo-time-overlay");
  const circle = document.querySelector(".pomo-progress-circle");
  if (!overlay || !circle) { renderMain(); return; }  // 想定外の構造なら安全側でフル再描画
  const R = 90;
  const C = 2 * Math.PI * R;
  const pomoTab = state.pomodoro.tab || "manual";
  let text, progress, color;
  if (pomoTab === "passive") {
    const session = getPassiveSessionStatus();
    text = session.phase === "focus" ? remainingText2x(session.remainingMs) : remainingTextNormal(session.remainingMs);
    progress = session.progress;
    color = session.phase === "focus" ? "var(--accent)" : "var(--orange)";
  } else if (state.pomodoro.running) {
    const mode = state.pomodoro.mode || "focus";
    const endsAtMs = localDateTimeToMs(state.pomodoro.endsAt);
    const remainingMs = Math.max(0, endsAtMs - Date.now());
    if (mode === "break") {
      text = remainingTextNormal(remainingMs);
      progress = 1 - remainingMs / (5 * 60 * 1000);
      color = "var(--orange)";
    } else {
      const startedAtMs = localDateTimeToMs(state.pomodoro.startedAt);
      text = remainingText(state.pomodoro.endsAt, true);
      progress = 1 - remainingMs / (endsAtMs - startedAtMs);
      color = "var(--accent)";
    }
  } else {
    return;  // 手動タブ未起動時は表示が変化しないので何もしない
  }
  overlay.textContent = text;
  circle.style.stroke = color;
  circle.style.strokeDasharray = String(C);
  circle.style.strokeDashoffset = String(C * (1 - Math.min(1, Math.max(0, progress))));
}

function startTimerTicker() {
  clearInterval(timerTicker);
  timerTicker = setInterval(() => {
    // 任意タイマー
    if (state.pomodoro.running) {
      if (localDateTimeToMs(state.pomodoro.endsAt) <= Date.now()) {
        // 時間切れ: focus → 自動で break に、break → セッション終了
        if (state.pomodoro.mode === "break") {
          endBreakPomodoro();
        } else {
          // focus フェーズ終了 → 自動で休憩へ
          goBreakPomodoro();
        }
      } else if (state.currentView === "pomodoro" && personalDataReady(state.settings.github)) {
        // v72レビュー対応: renderMain()はrender()のトークンゲート判定を経由しないため、
        // トークン喪失等でゲートに戻るべき状態のままここが直接呼ばれると、ゲート画面の
        // 裏で#mainだけが再描画され続ける穴になる。ここでも同じ判定を明示的にかける。
        // v84: renderMain()直呼びをupdatePomodoroTick()に置換(Study With Me表示中に
        // iframeを500msごとに再生成させないため。中は従来どおりrenderMain()にフォールバック)
        updatePomodoroTick();
      }
    }
    // 常時タイマー(壁時計モデル): ポモドーロ画面を開いている間は常に再描画
    if (state.currentView === "pomodoro" && state.pomodoro?.tab === "passive" && personalDataReady(state.settings.github)) {
      updatePomodoroTick();
    }
    // v41: 見込み終了時刻は該当 span のみ差し替え(全再描画しない)
    updateProjectedEndTick();
    // v144レビュー対応: 電池チップ・タイムラインのバッテリー実カーブは時間経過(減衰)で
    // 値が変わるが、render()を呼ぶきっかけ(Block操作等)が無い限り表示が凍ったままになる。
    // 全再描画はせず該当要素だけを差分更新する(内部で1分間隔にスロットル)。
    updateBatteryTick();
    // v77: AIフィードバック等の定期再fetch(30分毎)。visibilitychange側と同じ入口・スロットルを共有する。
    if (Date.now() - _lastFeedbackHydrateAt >= FEEDBACK_REFRESH_INTERVAL_MS) maybeRefreshFeedback();
    // v140(Med-3): 延期中のrenderがcompositionend/focusoutを取りこぼして固着した場合の
    // フェイルセーフ。attemptFlushDeferredRender内部で60秒経過判定を行う(500ms周期でチェックする
    // だけなので、ここでは無条件に呼ぶだけでよい。60秒未満なら何もしない)。
    attemptFlushDeferredRender();
  }, 500);
}

function setView(view) {
  // v34: 0秒思考の書く画面から離脱するときはタイマー停止 + 一時状態リセット
  if (state.currentView === "zero" && view !== "zero") {
    stopZtTimer();
    ztCurrent = null;
    ztWriteStartedAt = null;  // v104
  }
  state.currentView = view;
  // v37: 画面切替は「データの変更」ではない。dataModifiedAt を汚すと
  //      端末間の新旧比較が壊れる(タブを触っただけの古い端末が「最新」扱いになる)ため、
  //      永続化のみ行い、更新時刻スタンプと自動保存はしない。
  persistLocalNoSchedule();
  render();
}

// v149レビュー対応(必須3): ホーム「80歳ビジョン」カードから、ビジョン画面のビジョンボード
// (該当ページ)へ直接遷移する。setVisionSection/setVisionBoardIndexと同じフィールドを
// 使い回すため、状態の実体は1つだけ(ビジョンタブ側の選択状態を上書きするだけで複製しない)。
function openVisionBoard(index) {
  state.settings.visionSection = "board";
  state.settings.visionBoardIndex = index;
  setView("vision");
}

function setSelectedDate(date) {
  if (!date) return;
  state.selectedDate = date;
  ensureJournal(date);
  persistLocalNoSchedule();  // v37: 日付移動も UI 操作(setView と同じ理由)
  render();
}

function shiftSelectedDate(delta) {
  setSelectedDate(addDays(state.selectedDate, delta));
}

// v150: 第2引数toastOptsはshowToastへそのまま渡す(「実績を編集」トースト用、任意)。
function saveAndRender(message, toastOpts) {
  saveState();
  render();
  // v23: 端末内保存に失敗したら、その旨を優先して伝える(操作自体は反映済み)
  if (_lastSaveError) {
    showToast("⚠️ 端末内保存に失敗(容量超過の可能性)。設定からGitHubへ保存してください");
  } else if (message) {
    showToast(message, toastOpts);
  }
}

// v86: AIフィードバック_<date>.md の新着本文から「## 明日への提案」→当日の未完了タスク、
//      「## 0秒思考テーマ」→0秒思考テーマ一覧、へ自動登録する(K指示: v75の「選んでから追加」
//      UIに代わり、確認なしで確定登録する方針へ転換)。
//      冪等性: state.feedbackIngestedDates にこのフィードバック自身の日付("YYYY-MM-DD"。
//      today/prevどちらの枠から呼ばれたかは問わない)を記録し、同じ日付からの取り込みは1回のみ
//      行う。hydrateStaticMarkdownはcachedFeedbackがセッション(ページ再読込)毎にリセットされる
//      ため同じ.mdを複数セッションに跨いで何度も再fetchしうるが、ここが唯一の冪等ゲートになる。
//      重複排除: タスクは現在生きている未完了(todo/doing)タスクに同名があればスキップする
//      (前日以前から残っている繰越タスクとの重複も防ぐ)。テーマは zeroThinking.themes の
//      既存テキストと同名ならスキップする(themesは日付を持たず永続なので、前日から残っている
//      ものも自然に対象になる)。
//      テーマには source:"ai-feedback" を付け、手動追加(source:null)と区別する。ワンタップ削除
//      (deleteZtTheme)がAI由来かどうかを判定し、AI由来ならzeroSecThemeLogへ不採用記録する。
// v133: タスク側のみ方針転換(K指示)。v86で「確認なしで直接state.tasksへpush」に自動化した
//      挙動を撤回し、aiMitChips/adoptAiMit(journalMeta[date].aiMitCandidates)と全く同じ
//      「候補として溜めておき、チップの＋タップで初めて実体化」方式に戻す。テーマ側(0秒思考)の
//      自動追加は今回のスコープ外で変更しない(上のコメント・下のthemeCandidates節は従来どおり)。
//      候補はjournalMeta[date].aiTaskCandidatesへ格納し、aiTaskChips()/adoptAiTaskCandidate()/
//      dismissAiTaskCandidate()で表示・採用・却下する(表示は常にjournalMeta[前日].aiTaskCandidates
//      のみ、aiMitChipsと同じ表示条件)。addedTasksの意味は「タスクとして直接追加した件数」から
//      「候補として追加した件数」に変わった(変数名はそのまま流用)。
function autoIngestFeedback(date, text) {
  if (!text) return null;
  if (!Array.isArray(state.feedbackIngestedDates)) state.feedbackIngestedDates = [];
  if (state.feedbackIngestedDates.includes(date)) return null;  // 冪等: 同じ日付は1回のみ

  let addedTasks = 0, addedThemes = 0;

  const mitCandidates = extractMITCandidatesFromReport(text);
  if (mitCandidates.length) {
    const meta = (state.journalMeta[date] ||= { aiMitCandidates: [], aiImported: false, ideal: "", aiTaskCandidates: [] });
    if (!Array.isArray(meta.aiTaskCandidates)) meta.aiTaskCandidates = [];
    // v133: 重複排除対象は「現在生きている(todo/doing)タスクのtitle」に加え、
    //       「既にaiTaskCandidatesに入っているtitle」も含める(日をまたいだ重複チップ防止)。
    const liveTitles = new Set(state.tasks
      .filter((t) => !t.deleted && (t.status === "todo" || t.status === "doing"))
      .map((t) => t.title));
    meta.aiTaskCandidates.forEach((t) => liveTitles.add(t));
    mitCandidates.forEach((title) => {
      if (liveTitles.has(title)) return;  // 重複排除(繰越・既存候補含む)
      meta.aiTaskCandidates.push(title);
      liveTitles.add(title);
      addedTasks++;
    });
  }

  const themeCandidates = extractZeroSecThemesFromReport(text);
  if (themeCandidates.length) {
    const existingThemeTexts = new Set(state.zeroThinking.themes.map((t) => t.text));
    themeCandidates.forEach(({ theme }) => {
      if (existingThemeTexts.has(theme)) return;  // 重複排除(前日から残っているもの含む)
      state.zeroThinking.themes.push({
        id: crypto.randomUUID(), text: theme, fav: false, questionId: null,
        createdAt: nowDateTime(), source: "ai-feedback"
      });
      existingThemeTexts.add(theme);
      addedThemes++;
    });
  }

  state.feedbackIngestedDates.push(date);
  if (state.feedbackIngestedDates.length > FEEDBACK_INGESTED_DATES_MAX) {
    state.feedbackIngestedDates = state.feedbackIngestedDates.slice(-FEEDBACK_INGESTED_DATES_MAX);
  }
  return { addedTasks, addedThemes };
}
const FEEDBACK_INGESTED_DATES_MAX = 300;  // aiPlanSkippedLog/zeroSecThemeLogと同じ軽量上限の思想

// v167: hydrateDashboardFeedback/requestDashboardFeedbackはsrc/features/dashboard.jsへ移した
//   (app.js冒頭のimportからhydrateDashboardFeedbackを参照する。requestDashboardFeedbackは
//   app.js側から直接呼ばれていないためimportしていない)。

async function hydrateStaticMarkdown() {
  // v72: 個人データリポジトリ(taskchute/content/配下)からのGitHub API取得に切替(同一オリジンfetch廃止)
  const visionPromise = fetchGitHubRawText("content/Vision.md");
  const affirmPromise = fetchGitHubRawText("content/Daily_Affirmation.md");
  const [visionText, affirmText] = await Promise.all([visionPromise, affirmPromise]);
  let changed = false;
  if (visionText && visionText !== cachedVisionMd) {
    cachedVisionMd = visionText;
    changed = true;
  }
  if (affirmText && affirmText !== cachedAffirmationMd) {
    cachedAffirmationMd = affirmText;
    changed = true;
  }
  // AI フィードバック: 当日と前日を取得
  // v56: push 済みが判っていて、かつ手元に本文が無い日付のみ fetch。
  //      これで存在しない .md への 404(コンソールノイズ)を出さない。
  // v57: 前日1日分だけは、ローカルAIコーチングがリポジトリ直下へ直接pushしたケース
  //      (アプリ内アップロードを経ていない=feedbackFiles未登録)を拾うため、
  //      feedbackFiles未登録でも常に fetch を試す。404は fetchText 側で静かに無視される。
  const files = Array.isArray(state.feedbackFiles) ? state.feedbackFiles : [];
  const today = state.selectedDate;
  // v76: 「前日1日分の無条件fetch」対象は selectedDate(閲覧中の日付)ではなく、常に
  //      実際の今日から見た昨日(todayISO()基準)に固定する。旧実装は prev = addDays(today, -1)
  //      と selectedDate に連動しており、ホーム/ジャーナルで過去日を閲覧している間(state.selectedDate
  //      が今日以外)は wantFetchPrev(d) の d===addDays(todayISO(),-1) 判定に一致せず、fetchそのものが
  //      発火しなくなっていた(= 「ホームのAIからで昨日のフィードバックが読めない」の実バグ。
  //      state.selectedDateはタブ間で共有され前回セッションの閲覧日がそのまま永続化されるため、
  //      再現条件は珍しくない)。CHANGES_v76.md参照。
  const prev = addDays(todayISO(), -1);
  const wantFetch = (d) => files.includes(d) && !(state.feedback[d] || "").trim() && !cachedFeedback[d];
  const wantFetchPrev = (d) => !(state.feedback[d] || "").trim() && !cachedFeedback[d];
  const [todayFb, prevFb] = await Promise.all([
    wantFetch(today) ? fetchGitHubRawText(`AIフィードバック_${today}.md`) : Promise.resolve(""),
    wantFetchPrev(prev) ? fetchGitHubRawText(`AIフィードバック_${prev}.md`) : Promise.resolve("")
  ]);
  if (todayFb && todayFb !== cachedFeedback[today]) {
    cachedFeedback[today] = todayFb;
    changed = true;
  }
  if (prevFb && prevFb !== cachedFeedback[prev]) {
    cachedFeedback[prev] = prevFb;
    changed = true;
    // v57: 直push検知した前日分は、以後の起動時fetchが正規ルートに乗るよう記録する
    if (!files.includes(prev)) recordFeedbackFile(prev);
  }
  if (state.currentView === "dashboard" && await hydrateDashboardFeedback(currentDashboardDate())) {
    changed = true;
  }
  // v67: AI連携の鮮度インジケータ(柱1b)。todayFbは selectedDate 連動の fetch なので「今日」を
  //      見ているときの結果のみ鮮度シグナルに採用する(過去日ブラウズ中のfetchはその日の閲覧目的
  //      であり、パイプライン鮮度とは無関係)。前進のみ(後退させない)。
  //      v76: prevFbは上記のとおり selectedDate に依らず常に実際の昨日分なので、この鮮度判定も
  //      selectedDateに関わらず反映してよい(todayとprevで判定を分離)。
  const realToday = todayISO();
  let freshnessDirty = false;
  if (today === realToday) {
    if (todayFb && (!state.aiLinkFreshness.feedbackAt || state.aiLinkFreshness.feedbackAt < today)) {
      state.aiLinkFreshness.feedbackAt = today;
      freshnessDirty = true;
    }
  }
  if (prevFb && (!state.aiLinkFreshness.feedbackAt || state.aiLinkFreshness.feedbackAt < prev)) {
    state.aiLinkFreshness.feedbackAt = prev;
    freshnessDirty = true;
  }
  // v86: 新着フィードバックの自動取り込み(K指示: 「選んでから追加」を廃し自動追加へ方針転換)。
  //      冪等判定はautoIngestFeedback内部(state.feedbackIngestedDates)で行うため、ここでは
  //      新着本文(todayFb/prevFb)があるときに渡すだけでよい(cachedFeedbackはセッション毎に
  //      リセットされ同じ.mdを何度も再取得しうるが、feedbackIngestedDatesは永続化されるため
  //      実際の登録は日付ごとに1回だけ発生する)。
  // v86 should-fix: today枠は state.selectedDate 連動のfetchのため、過去日を閲覧中にその日の
  //      FBがまだキャッシュされていないと todayFb に過去日のフィードバックが入ることがある。
  //      それをそのまま自動登録すると「過去日を見ているだけ」で過去FBの提案候補が
  //      journalMeta[過去日]へ紐付いてしまう(v133でタスクは候補化したため実タスクの誤注入は
  //      なくなったが、候補チップはjournalMeta[実今日の前日]しか見ないため、実今日以外への
  //      登録はどのみち二度と表示されず宙に浮く。取り込み自体をtoday===realTodayに限定して防ぐ)。
  //      today === realToday(実際の今日を閲覧中)のときだけ取り込む。prev枠は selectedDateに
  //      依らず常に実際の昨日固定のフェッチなので、この制限は不要(現状のままでよい)。
  let ingestedTasksTotal = 0, ingestedThemesTotal = 0;
  if (todayFb && today === realToday) {
    const r = autoIngestFeedback(today, todayFb);
    if (r) { ingestedTasksTotal += r.addedTasks; ingestedThemesTotal += r.addedThemes; }
  }
  if (prevFb) {
    const r = autoIngestFeedback(prev, prevFb);
    if (r) { ingestedTasksTotal += r.addedTasks; ingestedThemesTotal += r.addedThemes; }
  }
  if (ingestedTasksTotal || ingestedThemesTotal) {
    changed = true;
    saveState();
    // v133: タスクは直接追加ではなく候補チップ化したため、テーマのみの文言と分けて案内する
    const parts = [];
    if (ingestedTasksTotal) parts.push(`🤖 AIの提案でタスク候補${ingestedTasksTotal}件が届きました(タスクシュート上部から追加できます)`);
    if (ingestedThemesTotal) parts.push(`テーマ${ingestedThemesTotal}件を追加しました`);
    showToast(parts.join("・"));
  }
  // v62: AI週次レビュー(自宅PCバッチ生成)。直近土曜1件のみ、無ければ404を静かに無視する
  //      (fetchTextの仕様どおり)。週次レビュータブを開くたび同じ週の再fetchはしない。
  const weeklyReviewWeek = weekStartFor(todayISO());
  if (!cachedWeeklyReviewMd[weeklyReviewWeek]) {
    const weeklyReviewMd = await fetchGitHubRawText(`週次レビュー_${weeklyReviewWeek}.md`);
    if (weeklyReviewMd && weeklyReviewMd !== cachedWeeklyReviewMd[weeklyReviewWeek]) {
      cachedWeeklyReviewMd[weeklyReviewWeek] = weeklyReviewMd;
      changed = true;
    }
  }
  // v157: AI機能1「今日の敵」/ v158: AI機能2「勝手に格言」。どちらも実際の今日分のみ、
  //      未取得なら1回だけfetchする(前日分の無条件fetchは行わない。ファイルが無い日は
  //      404を静かに無視し、カード自体を出さない)。
  //      2026-07-28レビュー対応・項目3(取得試行済みの明示化): `!cachedXxx[realToday]`という
  //      falsy判定だけだと、fetch失敗/該当ファイル無しの日は値がundefinedのままキャッシュに
  //      「登録されない」ため、日付をまたがず同一セッション内で再度hydrateStaticMarkdownが
  //      走るたび(タブ切替・visibilitychange復帰等)に404を毎回再発行してしまっていた。
  //      `realToday in cachedXxx`(キーの有無)で判定し、取得を試みたら成否に関わらず
  //      `cachedXxx[realToday] = 値 || undefined`を明示代入することで、「1セッション1回だけ
  //      試す」をコメントどおりの実挙動にする。
  //      2026-07-28レビュー対応・項目4(並列化): 今日の敵と勝手に格言は別ファイル・別キャッシュで
  //      互いに独立しているため、逐次awaitではなくPromise.allで並列fetchしレイテンシを縮める。
  // v159: 「未来からの手紙」は月次ファイルのため、判定キーは日付ではなく当月(YYYY-MM)。
  //      今日の敵/勝手に格言と同じ「1セッション1回だけ試す」設計をそのまま月キーに適用する。
  //      2026-07-28レビュー対応・必須修正3: GitHub(personal-data)連携が未設定
  //      (personalDataReady()===false)の間はどの`want*Fetch`も立てない。fetchGitHubRawText
  //      自体は未設定時に静かに空文字を返す(=フェッチ「済み」に見えてしまう)ため、これを
  //      ゲートせずに`cachedXxx[key] = 値 || undefined`していると、セットアップ画面通過前に
  //      1回でもhydrateStaticMarkdownが走った時点で「取得試行済み(undefined)」がキャッシュに
  //      固定されてしまい、直後の`gate-continue`(セットアップ完了、449行目
  //      `syncFromGitHubOnStartup().then(() => hydrateStaticMarkdown())`)で再度呼ばれても
  //      `realToday/realCurrentMonth in cachedXxx`が既にtrueのため二度とフェッチされなくなる
  //      (今日の敵/勝手に格言/未来からの手紙が永久に出ない実害バグだった)。
  const ghReady = personalDataReady(state.settings.github);
  const realCurrentMonth = realToday.slice(0, 7);
  const wantTodayEnemyFetch = ghReady && !(realToday in cachedTodayEnemyMd);
  const wantQuoteFetch = ghReady && !(realToday in cachedQuoteJson);
  const wantFutureLetterFetch = ghReady && !(realCurrentMonth in cachedFutureLetterMd);
  // v161(2026-07-28レビュー対応・必須修正4): 日付キーではなくTTL(FEEDBACK_REFRESH_INTERVAL_MS
  // =30分)で判定する(単一の上書きファイルのため、同日中の再pushを拾えるようにする)。
  const wantEnergyCurveFetch = ghReady && (Date.now() - cachedEnergyCurveJson.fetchedAt >= FEEDBACK_REFRESH_INTERVAL_MS);
  const [todayEnemyMd, quoteRaw, futureLetterMd, energyCurveRaw] = await Promise.all([
    wantTodayEnemyFetch ? fetchGitHubRawText(`今日の敵_${realToday}.md`) : Promise.resolve(undefined),
    wantQuoteFetch ? fetchGitHubRawText(`勝手に格言_${realToday}.json`) : Promise.resolve(undefined),
    wantFutureLetterFetch ? fetchGitHubRawText(`未来からの手紙_${realCurrentMonth}.md`) : Promise.resolve(undefined),
    wantEnergyCurveFetch ? fetchGitHubRawText("energy-curve.json") : Promise.resolve(undefined),
  ]);
  if (wantTodayEnemyFetch) {
    cachedTodayEnemyMd[realToday] = todayEnemyMd || undefined;
    if (todayEnemyMd) changed = true;
  }
  if (wantFutureLetterFetch) {
    cachedFutureLetterMd[realCurrentMonth] = futureLetterMd || undefined;
    if (futureLetterMd) {
      changed = true;
      // 2026-07-28レビュー対応・必須修正2: AIレポート一覧が既にキャッシュ済み(=ユーザーが
      // 既にAIレポート画面を開いたことがある)場合、triggerAiReportDirLoad()は一覧を1度
      // 取得すると再fetchしない(_aiReportDirCacheが truthy な間は早期return)ため、ここで
      // 直接unionしないと index側の反映を待つまでタブが空のまま残ってしまう。
      if (Array.isArray(_aiReportDirCache)) {
        _aiReportDirCache = unionKnownFutureLetters(_aiReportDirCache);
        // 本関数末尾の`if (changed && (state.currentView === "vision" || ...))`のview一覧に
        // "ai-reports"は含まれない(このunion専用の分岐なので、その一般ルールに相乗りせず
        // triggerAiReportDirLoad()/triggerAiReportBodyLoad()と同じ「ai-reports表示中のみ
        // 即render」を個別に行う。これが無いと、AIレポート画面を開いたまま新着の手紙fetchが
        // 完了しても一覧・本文が更新されないまま=タブが古い表示に固着する)。
        if (state.currentView === "ai-reports") render();
      }
    }
  }
  if (wantQuoteFetch) {
    // 生成物はJSON契約(FORMAT_CONTRACT.md)だが、バッチ側の壊れ・仕様変更でもアプリが落ちない
    // よう、JSON.parse失敗・オブジェクトでない・quote/author欠損はすべてフェイルソフトで
    // 「取得できなかった扱い」(undefined)にする。"note"フィールドは信用しない(UI側で固定
    // 文言を出す。quote-forge-validate.py冒頭コメントと対称の信頼境界)。
    let parsedQuote;
    if (quoteRaw) {
      try {
        const parsed = JSON.parse(quoteRaw);
        if (parsed && typeof parsed.quote === "string" && parsed.quote.trim()
          && typeof parsed.author === "string" && parsed.author.trim()) {
          parsedQuote = { quote: parsed.quote.trim(), author: parsed.author.trim() };
        }
      } catch (e) {
        // 壊れたJSON。フェイルソフト(parsedQuoteはundefinedのまま=カード非表示)。
      }
    }
    cachedQuoteJson[realToday] = parsedQuote;
    if (parsedQuote) changed = true;
  }
  if (wantEnergyCurveFetch) {
    // v161: energy-curve.json はファイル名が日付を含まない単一の上書きファイルのため、
    // 判定はJSONパース+スキーマ検証の成否のみで行う(勝手に格言と同じフェイルソフト方針。
    // バッチが壊れて配信していても、アプリは静かにセクション非表示へ倒す。hourlyは必ず24件・
    // hour昇順を要求し、要素数が違えば丸ごと不採用にする)。
    let parsedEnergyCurve;
    if (energyCurveRaw) {
      try {
        const parsed = JSON.parse(energyCurveRaw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.hourly) && parsed.hourly.length === 24
          && parsed.hourly.every((row, i) => row && typeof row === "object" && Number(row.hour) === i
            && Number.isFinite(Number(row.count))
            && (row.netAvg === null || Number.isFinite(Number(row.netAvg)))
            && (row.startRate === null || Number.isFinite(Number(row.startRate))))) {
          parsedEnergyCurve = {
            generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
            days: Number.isFinite(Number(parsed.days)) ? Number(parsed.days) : 28,
            hourly: parsed.hourly.map((row) => ({
              hour: Number(row.hour),
              count: Number(row.count) || 0,
              netAvg: row.netAvg === null ? null : Number(row.netAvg),
              startRate: row.startRate === null ? null : Number(row.startRate),
            })),
          };
        }
      } catch (e) {
        // 壊れたJSON。フェイルソフト(parsedEnergyCurveはundefinedのまま=セクション非表示)。
      }
    }
    // 2026-07-28レビュー対応・必須修正4: 日付キーではなくfetchedAtで更新する(TTLキャッシュ)。
    // 成否に関わらずfetchedAtは進める(失敗が続いても30分に1回だけリトライ=連打しない)。
    // changedは「前回と内容が変わった場合」だけ立てる(30分ごとに同じ内容を再取得しても
    // 無駄な再描画をしない。JSON.stringify比較で十分。オブジェクトが小さいため許容)。
    const prevEnergyCurveData = cachedEnergyCurveJson.data;
    cachedEnergyCurveJson = { fetchedAt: Date.now(), data: parsedEnergyCurve };
    if (parsedEnergyCurve && JSON.stringify(parsedEnergyCurve) !== JSON.stringify(prevEnergyCurveData)) {
      changed = true;
    }
  }
  // v67: AIプラン_<今日>.json の存在確認(下書きへの適用はrunAiMorningPlan側の専管で、
  //      ここでは鮮度シグナル専用の軽量fetch)。既に今日分を確認済みなら再fetchしない。
  if (!state.aiLinkFreshness.planAt || state.aiLinkFreshness.planAt < realToday) {
    const planDate = await fetchAiPlanFreshnessDate(realToday);
    if (planDate) {
      state.aiLinkFreshness.planAt = planDate;
      freshnessDirty = true;
      changed = true;
    }
  }
  // v67: 鮮度シグナルはユーザー操作を経ないため、autoSyncのpush対象(saveState)にはせず
  //      ローカル保存のみで足す(端末をまたいだ鮮度比較は現状不要。過剰なpushを避ける)。
  if (freshnessDirty) persistLocalNoSchedule();
  // v67: AI作業結果_<今日>.json(柱2・実績還流)。当日分のみ、network-first(sw.jsのjson扱いを流用)。
  const gotAiWork = await hydrateAiWorkResults();
  if (gotAiWork) changed = true;
  // v74: 読書複利化 — 今日のハイライト(初回のみ) + 当日の言語化(起動毎) + 今月の要約(月1回)
  const gotReading = await hydrateReadingData();
  if (gotReading) changed = true;
  // v37: state.view というプロパティは存在しない(正しくは currentView)。
  //      このタイポのせいで、ビジョン画面を開いたまま読み込みが終わっても再描画されなかった。
  // v86 should-fix: "zero"(0秒思考タブ)を追加。autoIngestFeedbackがテーマを自動追加しても、
  //      このタブを開いたまま待っていると一覧がライブ更新されなかったため。
  // v133: "tasks"(タスクシュート)を追加。修正1でAI提案タスクがaiTaskChips経由の候補チップに
  //      なったため、このタブを開いたまま待っていてもチップがライブ表示されない同種の不具合が
  //      新たに生じていた(tests/v133.test.jsで検出)。
  // v137: 入力中/IME変換中は即renderせず保留する(review.md:28。renderDeferringForFocus参照)。
  // v161: "stats"(計器盤)を追加。エネルギーカーブの新着fetchが完了してもこの画面を開いた
  //       ままだと再描画されず節が出ないままになる不具合を防ぐ(他view追加時と同じ理由)。
  // v163: "dashboard"も任意日AIフィードバック取得完了後に同じライブ再描画が必要。
  if (changed && (state.currentView === "vision" || state.currentView === "journal" || state.currentView === "weekly" || state.currentView === "home" || state.currentView === "zero" || state.currentView === "tasks" || state.currentView === "stats" || state.currentView === "dashboard")) {
    renderDeferringForFocus();
  }
}

// v77: AIフィードバック等の自動再表示 — visibilitychange復帰時 + 定期(30分毎、startTimerTickerの
//      500msティックに相乗り)に呼ぶ入口。personalDataReadyでない(GitHub未接続)なら何もしない。
//      多重発火防止(_feedbackHydrateInFlight)+ 最短間隔ガード(FEEDBACK_REFRESH_MIN_GAP_MS)を掛け、
//      失敗は静かに握りつぶして次回タイミング(次のvisibilitychangeか30分後)に任せる(即時リトライしない)。
function maybeRefreshFeedback() {
  if (!personalDataReady(state.settings.github)) return;
  if (_feedbackHydrateInFlight) return;
  const now = Date.now();
  if (now - _lastFeedbackHydrateAt < FEEDBACK_REFRESH_MIN_GAP_MS) return;
  _lastFeedbackHydrateAt = now;
  _feedbackHydrateInFlight = true;
  hydrateStaticMarkdown()
    .catch((error) => console.warn("AIフィードバック等の自動再取得をスキップ:", error?.message || error))
    .finally(() => { _feedbackHydrateInFlight = false; });
}

async function reloadStaticMarkdown() {
  cachedVisionMd = "";
  cachedAffirmationMd = "";
  showToast("最新を取得中...");
  await hydrateStaticMarkdown();
  render();
  showToast("最新を読み込みました");
}

// v67: =========================================================
//  AI作業ワーカー連携(柱2・実績還流) — AI作業結果_YYYY-MM-DD.json の取り込み表示
//  スキーマ(権威): [{taskId,title,status:"completed"|"blocked"|"queued",summary,outputPath,minutes}]
//  当日分のみ同一オリジンfetch(AIプラン_*.jsonと同じ流儀)。アプリ側は自動登録せず、
//  completedはワンタップ承認(実績Block化)、blockedは既存state.questionsへ橋渡し、
//  queuedは表示のみ(K指示「最終判断はK」)。
// =========================================================

// 当日の AI作業結果_<today>.json を取得・検証し cachedAiWorkResults を更新する。
// resultId は taskId(無ければ配列index)+日付で合成し、二重登録防止の照合キーにする。
async function hydrateAiWorkResults() {
  const date = todayISO();
  const raw = await fetchGitHubRawText(`AI作業結果_${date}.json`);
  if (!raw) { cachedAiWorkResults = null; return false; }
  let data;
  try { data = JSON.parse(raw); } catch { cachedAiWorkResults = null; return false; }
  if (!Array.isArray(data)) { cachedAiWorkResults = null; return false; }
  const VALID_STATUS = ["completed", "blocked", "queued"];
  const items = [];
  data.forEach((r, idx) => {
    if (!r || typeof r !== "object") return;
    if (!VALID_STATUS.includes(r.status)) return;
    const taskId = typeof r.taskId === "string" ? r.taskId : "";
    items.push({
      resultId: `${date}__${taskId || `idx${idx}`}`,
      taskId,
      title: typeof r.title === "string" ? r.title : "",
      status: r.status,
      summary: typeof r.summary === "string" ? r.summary : "",
      outputPath: typeof r.outputPath === "string" ? r.outputPath : "",
      minutes: Number.isFinite(r.minutes) ? r.minutes : 0
    });
  });
  const changed = JSON.stringify(items) !== JSON.stringify(cachedAiWorkResults);
  cachedAiWorkResults = items;
  return changed;
}

// 未処理(state.aiWorkProcessedIds に無い)の結果のみをホームカードへ出す
function pendingAiWorkResults() {
  if (!Array.isArray(cachedAiWorkResults)) return [];
  const processed = new Set(state.aiWorkProcessedIds || []);
  return cachedAiWorkResults.filter((r) => !processed.has(r.resultId));
}

function markAiWorkResultProcessed(resultId) {
  if (!Array.isArray(state.aiWorkProcessedIds)) state.aiWorkProcessedIds = [];
  if (!state.aiWorkProcessedIds.includes(resultId)) state.aiWorkProcessedIds.push(resultId);
}

// completed: ワンタップで実績Blockとして承認登録する(自動登録はしない — 最終判断はK)。
// カテゴリ"AI作業"、所要minutes分。空き時間があればそこへ、無ければ現在時刻付近の適当な枠でよい
// (設計注記どおり厳密な衝突検知はしない)。紐づくtaskIdがあればTaskも完了化する。
function approveAiWorkResult(resultId) {
  const r = (cachedAiWorkResults || []).find((x) => x.resultId === resultId);
  if (!r) return;
  markAiWorkResultProcessed(resultId);
  const date = todayISO();
  const minutes = clamp(Math.round(r.minutes || 30), 1, 24 * 60);
  const gaps = computeFreeGaps(date).filter(([s, e]) => e - s >= minutes);
  let start;
  if (gaps.length) {
    start = gaps[0][0];
  } else {
    const now = new Date();
    start = clamp(now.getHours() * 60 + now.getMinutes(), 0, 24 * 60 - minutes);
  }
  const block = makeBlock({
    date,
    title: r.title || "AI作業",
    taskId: r.taskId || "",
    category: "AI作業",
    plannedStartAt: `${date}T${minToHHMM(start)}`,
    plannedEndAt: `${date}T${minToHHMM(start + minutes)}`,
    actualStartAt: `${date}T${minToHHMM(start)}`,
    actualEndAt: `${date}T${minToHHMM(start + minutes)}`,
    estimateMin: minutes,
    completed: true,
    comment: r.summary || ""
  });
  state.blocks.push(block);
  if (r.taskId) {
    // v107: ここも「statusをcompletedにする経路」の一つ。saveTaskFromModalと同じくv95連動漏れがあったため統一
    state.tasks = state.tasks.map((t) => (t.id === r.taskId && !t.deleted)
      ? { ...t, status: "completed", progressNum: fillProgressOnComplete(t), updatedAt: nowDateTime() }
      : t);
  }
  saveAndRender("AIの作業実績を登録しました");
}

// blocked: 既存の問い(state.questions)機構へ橋渡しする(v39のmakeQuestionをそのまま使う)
function raiseAiWorkQuestion(resultId) {
  const r = (cachedAiWorkResults || []).find((x) => x.resultId === resultId);
  if (!r) return;
  markAiWorkResultProcessed(resultId);
  const q = makeQuestion({ text: r.summary || r.title || "AIからの質問", origin: "ai" });
  state.questions.push(q);
  saveAndRender("AIからの質問を「問い」に積みました");
}

function aiWorkResultRowHTML(r) {
  const title = escapeHTML(r.title || "(無題)");
  if (r.status === "completed") {
    return `<div class="ai-work-row">
      <div class="ai-work-row-main">
        <div class="ai-work-title">${title}</div>
        ${r.summary ? `<div class="ai-work-summary">${escapeHTML(r.summary)}</div>` : ""}
        ${r.minutes ? `<div class="muted" style="font-size:11px">所要 ${r.minutes}分</div>` : ""}
      </div>
      <button class="btn primary" data-action="ai-work-approve" data-result-id="${r.resultId}">実績として登録</button>
    </div>`;
  }
  if (r.status === "blocked") {
    return `<div class="ai-work-row">
      <div class="ai-work-row-main">
        <div class="ai-work-title">${title}</div>
        <div class="ai-work-summary">${escapeHTML(r.summary || "(質問内容なし)")}</div>
      </div>
      <button class="btn" data-action="ai-work-question" data-result-id="${r.resultId}">質問として積む</button>
    </div>`;
  }
  // queued: 表示のみ(PC側のqueueで承認待ち。アプリ側からの操作はない)
  return `<div class="ai-work-row">
    <div class="ai-work-row-main">
      <div class="ai-work-title">${title}</div>
      <div class="muted" style="font-size:12px">承認待ち(PC側のqueueにあります)</div>
    </div>
  </div>`;
}

// v71: 散らばっていたAI系表示(鮮度インジケータ・AI作業結果・前日AIフィードバックのMIT候補)を
//      「AIから」1カードに集約した(旧homeAiWork+旧aiFreshnessLine単独表示+旧homeMIT内候補を統合)。
//      個々の中身(pendingAiWorkResults/aiWorkResultRowHTML/aiFreshnessLine/
//      extractMITCandidatesFromReport)自体は変更せず、置き場所だけをまとめている。
// v73: 縮退モードでhomeFoldSection(details)に相乗りできるよう、外側の<section>無しの
//      中身だけを返す形に分離した(中身自体は無変更)。
// v146: 通常時も既定closedの折りたたみへ変更したため(UI改善計画Phase1-1)、外側<section>で
//      包むhomeAiHub()は両呼び出し元がhomeFoldSection+本関数の直接呼び出しに統一され不要になり削除した。
// v159: AI機能3「未来の自分からの手紙」。自宅PCバッチ(loop/scripts/future-letter.sh)が
// 月次で生成した 未来からの手紙_<当月>.md が存在する間だけ、「AIから」カードの近くに小さな
// 導線を1行出す(タップでAIレポート画面の「未来からの手紙」タブへ)。無い月は何も出さない
// (cachedFutureLetterMdに当月分が無い=フェイルソフト)。本文そのものはここでは表示せず、
// 既存のAIレポート一覧・本文表示機構(AI_REPORT_TYPES/renderAiReportBody)に相乗りする。
function homeFutureLetterLink() {
  const month = todayISO().slice(0, 7);
  if (!(cachedFutureLetterMd[month] || "").trim()) return "";
  return `<div class="panel home-future-letter-link" data-action="open-future-letter" style="font-size:13px; padding:8px 12px; cursor:pointer">
    ✉️ 未来からの手紙が届いています
  </div>`;
}

function homeAiHubBody(blocks, isToday) {
  const workItems = isToday ? pendingAiWorkResults() : [];
  const workHTML = workItems.length ? `
    <div class="home-divider"></div>
    <div class="home-ai-sub">AIが処理した作業<span class="home-count">${workItems.length}</span></div>
    ${workItems.map((r) => aiWorkResultRowHTML(r)).join("")}` : "";
  const candidatesHTML = isToday ? aiFeedbackCandidatesHTML(blocks) : "";
  // v75: 「AIから」カードは鮮度表示とMIT候補抽出のみで、フィードバック本文そのものを読む手段が
  //      無かった(README不具合「ホームAIからでAIフィードバックが見れない」の実体)。ジャーナルタブと
  //      同じ「details 既定closed」パターンで本文を読めるようにする(新規UIコンポーネントは作らず流用)。
  // v76: isToday(= state.selectedDate === 今日)でゲートしていたため、Home で過去日を閲覧中は
  //      本文があってもこのdetails自体が出なかった(homeAiFeedbackReadHTML側もselectedDate基準の
  //      不具合を併発しており、二重の原因で「読めない」symptomになっていた。CHANGES_v76.md参照)。
  //      読む機能自体は閲覧中の日付に関係なく常に出す。
  const readHTML = homeAiFeedbackReadHTML();
  return `
    <div class="home-plabel orange">AIから</div>
    ${aiFreshnessLine()}
    ${workHTML}
    ${readHTML}
    ${candidatesHTML}
  `;
}

// v75: 「AIから」カードから、当日/前日のAIフィードバック本文を読めるようにする(既定closed)。
//      読み取り経路は cachedFeedback(hydrateStaticMarkdown が personal-data API=fetchGitHubRawText
//      経由で埋める。v72から同一オリジンfetchは使っていない)をそのまま流用する。
// v76: today を state.selectedDate ではなく実際の今日(todayISO())に固定した。selectedDateは
//      タブ間で共有・永続化されるため、Homeで過去日を閲覧している間はここが「今日」ではなく
//      「閲覧中の日付」を基準にしてしまい、hydrateStaticMarkdown側が埋めた cachedFeedback[実際の昨日]
//      と鍵が一致せず本文が出ない不具合があった(CHANGES_v76.md参照)。
function homeAiFeedbackReadHTML() {
  const today = todayISO();
  const prev = addDays(today, -1);
  const todayFb = cachedFeedback[today] || state.feedback[today] || "";
  const prevFb = cachedFeedback[prev] || state.feedback[prev] || "";
  if (!todayFb && !prevFb) return "";
  return `
    <div class="home-divider"></div>
    <details class="home-ai-feedback-read">
      <summary class="muted" style="cursor:pointer; font-size:12px; font-weight:600">🤖 AIフィードバックを読む</summary>
      <div style="margin-top:8px">
        ${todayFb ? `<div class="md-render readonly-md">${renderMarkdown(todayFb)}</div>` : ""}
        ${prevFb ? (todayFb ? `
        <details style="margin-top:10px">
          <summary class="muted" style="cursor:pointer; font-size:11.5px">前日(${escapeHTML(prev)})のフィードバックも見る</summary>
          <div class="md-render readonly-md" style="margin-top:6px; opacity:0.85">${renderMarkdown(prevFb)}</div>
        </details>` : `<div class="md-render readonly-md">${renderMarkdown(prevFb)}</div>`) : ""}
      </div>
    </details>`;
}

// v73: コンディションOS — 縮退モードの案内バナー。責めない・煽らないトーン(wip-bannerと同じ
// 「情報を渡すだけ」の思想)。タップでジャーナル(体調記録の入口)へ。
function homeDegradedBanner() {
  return `<div class="cond-degraded-banner" data-action="nav" data-view="journal">
    今日は最低限だけでいい日です。MITと体調記録だけ見えていれば十分。
  </div>`;
}

// v89: ゼロ摩擦ルーティンチェック — 時刻ベースの自動チェック提案バナー(ROADMAP v93)。
// 「予定時刻を過ぎた未チェックのルーティンがある」ときだけ、責めないトーンで一括確定へ誘導する。
// 呼び出し元(renderHome)でdegraded(v73縮退モード)日はhomeDegradedBannerと排他表示にする
// (縮退モードの日にまで「やっていないこと」を思い出させるのは方針に反するため)。
// タップでルーティンタブへ(そこで「ここまで全部やった」ボタンから一括確定できる)。
function homeRoutineCheckBanner(blocks, isToday) {
  if (!isToday) return "";
  const overdue = overdueUncheckedRoutines(blocks);
  if (!overdue.length) return "";
  return `<div class="routine-check-banner" data-action="nav" data-view="routine">
    ${overdue.length}件のルーティン、やっていたら1タップで記録 →
  </div>`;
}

// v71: homeMIT内にあった「前日AIフィードバックのMIT候補」提示を分離(枠が空いている日のみ)。
//      ワンタップで今日の主役ブロックに追加できる(mit-candidate-add アクションは既存のまま)。
function aiFeedbackCandidatesHTML(blocks) {
  const mit = blocks.filter((b) => b.isMIT);
  if (mit.length >= 3) return "";
  const prev = addDays(state.selectedDate, -1);
  const feedbackText = cachedFeedback[prev] || state.feedback[prev] || "";
  const existingTitles = new Set(blocks.map((b) => b.title));
  const candidates = extractMITCandidatesFromReport(feedbackText)
    .filter((c) => !existingTitles.has(c))
    .slice(0, 3 - mit.length);
  if (!candidates.length) return "";
  return `
    <div class="home-divider"></div>
    <div class="home-ai-sub">🤖 昨日のフィードバックからの候補</div>
    ${candidates.map((c) => `
      <div class="home-ck">
        <button class="btn ghost" style="font-size:11px; padding:5px 9px" data-action="mit-candidate-add" data-title="${escapeHTML(c)}">＋ 主役に</button>
        <span class="home-ck-name">${escapeHTML(c)}</span>
      </div>`).join("")}`;
}

// v67: AI連携の鮮度インジケータ(柱1b)。フィードバック/プランそれぞれの最終取得成功日からの
// 経過日数を1行表示する。3日以上(どちらか)途絶えたら sync-banner と同じ静かな見た目で注意喚起
// する(責める色は使わない)。
function aiFreshnessLine() {
  const today = todayISO();
  const fbAt = state.aiLinkFreshness?.feedbackAt || null;
  const planAt = state.aiLinkFreshness?.planAt || null;
  const fbDays = fbAt ? daysBetween(fbAt, today) : null;
  const planDays = planAt ? daysBetween(planAt, today) : null;
  const fmt = (d) => d === null ? "まだ届いていません" : (d === 0 ? "今日届いた" : `${d}日前`);
  const stale = fbDays === null || fbDays >= 3 || planDays === null || planDays >= 3;
  return `
    <div class="ai-freshness-line">
      <span class="ai-freshness-dot ${stale ? "warn" : "ok"}"></span>
      AI連携: フィードバック ${fmt(fbDays)} / プラン ${fmt(planDays)}
    </div>
    ${stale ? `<div class="ai-freshness-banner" data-action="nav" data-view="settings">⚠ AI連携が止まっているかも。PCのタスクスケジューラを確認 — 設定へ</div>` : ""}
  `;
}

// v72レビュー対応: Vision/Affirmationの実体は個人データリポジトリの taskchute/content/ 配下に
// 移行済みのため、旧 state.settings.github の owner/repo(=このアプリ自身のpublicリポジトリ)
// ではなく personalDataConn/personalDataPath で個人データリポジトリ側の編集URLを組む
// (呼び出し元 renderVisionMd の data-path は "Vision.md"/"Daily_Affirmation.md" のままでよく、
// ここで "content/" プレフィックスを補う)。
function openMdInGithub(path) {
  const cfg = state.settings.github || {};
  if (!personalDataReady(cfg)) {
    showToast("設定画面で個人データリポジトリ(Owner/Repository/Token)を入れてください");
    return;
  }
  const conn = personalDataConn(cfg);
  const fullPath = personalDataPath(`content/${path}`);
  const url = `https://github.com/${conn.owner}/${conn.repo}/edit/${conn.branch}/${fullPath}`;
  window.open(url, "_blank", "noopener");
}

function setVisionSection(section) {
  state.settings.visionSection = section;
  persistLocalNoSchedule();  // v37: UI 操作(dataModifiedAt を汚さない)
  render();
}

function setVisionBoardIndex(index) {
  state.settings.visionBoardIndex = index;
  persistLocalNoSchedule();  // v37: 同上
  render();
}

// v92: AIレポートビューアの種類タブ切替(UI選択のみ、dataModifiedAtは汚さない)
function setAiReportType(typeId) {
  if (!AI_REPORT_TYPES.some((t) => t.id === typeId)) return;
  state.settings.aiReportType = typeId;
  persistLocalNoSchedule();
  render();
}

// v150(UI改善計画Phase4b・R3): 第2引数は完了直後の「実績を編集」導線用(任意)。
// { blockId, actionLabel } を渡すと、既存の実績登録モーダル(complete-block-with-actual)を
// 開くボタンをトースト内に添える。既存の呼び出し(第2引数なし)は完全に従来どおりの見た目・挙動。
// v156レビュー対応(仕分けモードUndo、S3): actionOptsを汎用化した。{ action, id, label,
// durationMs, onExpire } を渡せば任意のdata-action/data-idボタンを同じ機構(pointer-events
// 対策・タイマー管理込み)で出せる。blockId指定は従来どおり action="complete-block-with-actual"の
// ショートハンドとして後方互換を維持する(新しいトースト機構は作らず、この1つを再利用する)。
// v156 2系統レビュー対応:
//  (項目5) 汎用経路(action/id指定)はlabelを必須にした(既定値「実績を編集」を出さない)。
//    blockId経路(旧来の呼び出し)だけが従来どおりactionLabel省略時「実績を編集」にフォールバック
//    する(後方互換のためこちらだけ残す)。
//  (項目2) onExpireはタイマー満了(視覚的な非表示化)と同時に呼ばれるコールバック。CSSの
//    pointer-events:noneは「マウス/タッチでの押下」しか防げず、キーボードでボタンへ既に
//    フォーカスしていた場合はEnter/Spaceでの活性化がpointer-eventsを無視して素通りする
//    (Codex指摘)。呼び出し側(triageUndoToastOpts)はここで自身の状態(_triageUndo)を
//    明示的に無効化し、期限切れ後にEnterで発動しても何も起きないようにする。
function showToast(message, actionOpts) {
  clearTimeout(toastTimer);
  const hasGenericAction = Boolean(actionOpts && actionOpts.action && actionOpts.id && actionOpts.label);
  const hasBlockAction = !hasGenericAction && Boolean(actionOpts && actionOpts.blockId);
  const hasAction = hasGenericAction || hasBlockAction;
  if (hasAction) {
    const actionName = hasGenericAction ? actionOpts.action : "complete-block-with-actual";
    const dataId = hasGenericAction ? actionOpts.id : actionOpts.blockId;
    const label = hasGenericAction ? actionOpts.label : (actionOpts.actionLabel || "実績を編集");
    // v150レビュー対応(項目9): dataIdはBlock/Task自身のidをそのままdata-idへ埋め込むだけだが、
    // 念のためescapeHTMLを通す(他のdata-id埋め込み箇所と同じ防御の一貫性のため)。
    toastEl.innerHTML = `<span class="toast-msg"></span><button type="button" class="toast-action" data-action="${escapeHTML(actionName)}" data-id="${escapeHTML(dataId)}">${escapeHTML(label)}</button>`;
    toastEl.querySelector(".toast-msg").textContent = message;
  } else {
    toastEl.textContent = message;
  }
  toastEl.classList.toggle("has-action", hasAction);
  toastEl.classList.add("show");
  // アクション付きは操作の猶予を長めに(既定4.5秒。durationMsで個別に上書き可能——
  // v156の仕分けUndoは設計書どおり5秒にする)。
  // v150レビュー対応(項目1、両レビュー一致・最重要): "show"だけでなく"has-action"も外す。
  // has-actionが残ると、非表示化後もopacity:0のままpointer-events:autoの透明領域が
  // ボトムナビ中央3ボタンの上に居座り続け、タップがトーストのボタンへ吸われてしまっていた
  // (実測でモーダルが開くことを確認済み)。CSS側にも`.toast:not(.show)`の保険を追加している
  // (styles.css参照)。
  const durationMs = hasAction ? (actionOpts.durationMs || 4500) : 2200;
  const onExpire = hasGenericAction && typeof actionOpts.onExpire === "function" ? actionOpts.onExpire : null;
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show", "has-action");
    if (onExpire) onExpire();
  }, durationMs);
}

// v169: ensureJournal/defaultJournalはsrc/features/journal.jsへ移動した(app.js分割・段階4-3)。
// JOURNAL_REQUEST_SECTION(ファイル冒頭のconst)はnormalizeStateとdefaultJournal(journal.js)の
// 両方が参照するため、configureJournal(deps)経由で値のまま注入している(TDZ回避の既存事情は
// ファイル冒頭コメント参照)。冒頭でensureJournal/defaultJournalをimportして参照を切り替えた。

function upsertMorningLine(markdown, line) {
  // v17: 睡眠セクションがある新テンプレ、もしくは旧テンプレの両方に対応
  // 朝の体調はホーム画面で記録するため、ここでは追記しない(将来的に削除可)
  if (markdown.includes("朝の体調:")) {
    return markdown.replace(/^朝の体調:.*$/m, line);
  }
  if (markdown.includes("## 🛏 睡眠")) {
    // 新テンプレ: 睡眠セクションの後に体調行を追記しない(分離原則)
    return markdown;
  }
  if (markdown.includes("## 朝")) {
    return markdown.replace("## 朝", `## 朝\n${line}`);
  }
  return `${line}\n\n${markdown}`;
}

function computeMetrics() {
  const today = state.selectedDate;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const yearEnd = `${today.slice(0, 4)}-12-31`;
  const start12 = state.settings.twelveWeekStartDate || today;
  const end12 = addDays(start12, 84);
  const metrics = [
    metric("12WY", today, start12, end12),
    metric("今年", today, yearStart, yearEnd)
  ];
  if (state.settings.birthDate) {
    metrics.push(ageMetric("45歳まで", today, state.settings.birthDate, 45));
    metrics.push(ageMetric("80歳まで", today, state.settings.birthDate, 80));
  }
  return metrics;
}

function metric(label, today, start, end) {
  const total = Math.max(1, daysBetween(start, end));
  const elapsed = clamp(daysBetween(start, today), 0, total);
  const remaining = Math.max(0, daysBetween(today, end));
  return {
    label,
    value: `あと${remaining}日`,
    progress: Math.round((elapsed / total) * 100),
    note: `${elapsed}/${total}日 経過`
  };
}

function ageMetric(label, today, birthDate, age) {
  const target = addYears(birthDate, age);
  const remaining = Math.max(0, daysBetween(today, target));
  // v10: 開始(生年月日) → 目標年齢 までの経過日数進捗
  const totalDays = Math.max(1, daysBetween(birthDate, target));
  const elapsedDays = Math.max(0, daysBetween(birthDate, today));
  const progress = Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));
  return {
    label,
    value: `あと${remaining.toLocaleString()}日`,
    progress,
    note: `${target} (${progress.toFixed(1)}% 経過)`
  };
}

// ===== v23: 繰り返しエンジン(ルール + ローリングウィンドウ materialization) =====
// 繰り返しは state.recurrences[] にルールとして保持する。表示用の Block は
// 「今日を中心とした一定期間」だけ実体化し、期間外で未編集のものは破棄する。
// これにより、以前のように 1 シリーズ 400 件を恒久保存することがなくなる。
// 期間の定数 RECURRENCE_KEEP_PAST_DAYS / RECURRENCE_FUTURE_DAYS はファイル先頭で定義。

// 「実績・編集が入っている」= 履歴として残すべき Block か
function isTouchedBlock(b) {
  // v37: タイトルがルールから変えられている実体も「編集済み」として保持する
  //      (リネームしただけの未完了インスタンスが期間外パージで消えていた)
  const rule = b.recurrenceGroupId
    ? (state.recurrences || []).find((r) => r.id === b.recurrenceGroupId)
    : null;
  const renamed = rule ? b.title !== rule.title : false;
  return Boolean(
    b.completed || b.actualStartAt || b.actualEndAt ||
    Number(b.pomodoroCount || 0) > 0 || (b.comment || "").trim() ||
    b.isMIT || Number(b.charge || 0) > 0 || Number(b.discharge || 0) > 0 ||
    renamed
  );
}

// v37: 指定ルールの「未編集の実体」を取り除く(fromDate 以降のみ / 編集中のブロックは除外)。
//      シリーズ終了・種別変更時の掃除に使う。実績のある実体は isTouchedBlock が守る。
function removeUntouchedInstances(ruleId, { fromDate = "", excludeId = "" } = {}) {
  state.blocks = state.blocks.filter((b) => {
    if (b.recurrenceGroupId !== ruleId) return true;
    if (excludeId && b.id === excludeId) return true;
    if (fromDate && b.date < fromDate) return true;
    return isTouchedBlock(b);
  });
}

function recurrenceKindLabel(kind) {
  return { daily: "毎日", weekdays: "平日のみ", weekly: "毎週", monthly: "毎月" }[kind] || kind || "";
}

// v170: recurrenceMatchesDate〜maintainRecurrences(繰り返し実体化エンジン、計166行)は
// src/features/routine.jsへ移動した(app.js分割・段階4-4)。isTouchedBlock/
// removeUntouchedInstances/recurrenceKindLabel(直前に残置)はTimeline側のBlock編集モーダル・
// 旧データ移行専用のためapp.js残留。createRecurrenceRule/maintainRecurrences/
// triggerAnchorPlacements/makeRecurrenceInstanceの呼び出し元(saveBlockFromModal/importData/
// runDailyOpen/configureGithubSync等)はimportで参照する(冒頭import文参照)。

// 旧データ(繰り返し Block を恒久展開)を、ルール方式へ一度だけ移行する
function inferRecurrenceKind(sortedDates) {
  const uniq = [...new Set(sortedDates)].sort();
  if (uniq.length < 3) return "daily";
  const diffs = [];
  for (let i = 1; i < Math.min(uniq.length, 40); i++) {
    diffs.push(daysBetween(uniq[i - 1], uniq[i]));
  }
  if (diffs.every((d) => d === 1)) return "daily";
  if (diffs.every((d) => d === 7)) return "weekly";
  const allWeekday = uniq.slice(0, 40).every((d) => {
    const wd = parseDate(d).getDay();
    return wd >= 1 && wd <= 5;
  });
  if (allWeekday && diffs.every((d) => d === 1 || d === 3)) return "weekdays";
  if (diffs.every((d) => d >= 28 && d <= 31)) return "monthly";
  return "daily";
}

function migrateRecurrencesIfNeeded(value) {
  value.recurrences ||= [];
  if (value.recurrences.length > 0) return;          // 既に移行済み
  const recBlocks = (value.blocks || []).filter((b) => b.recurrenceGroupId);
  if (recBlocks.length === 0) return;                // 繰り返しデータが無い
  const groups = {};
  for (const b of recBlocks) {
    (groups[b.recurrenceGroupId] ||= []).push(b);
  }
  const rules = [];
  for (const [groupId, blocks] of Object.entries(groups)) {
    const dates = blocks.map((b) => b.date).filter(Boolean).sort();
    const rep = blocks.slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""))[0];
    rules.push({
      id: groupId,  // 既存 Block の recurrenceGroupId をそのままルール ID に再利用
      title: rep.title || "繰り返しBlock",
      category: rep.category || "",
      taskId: rep.taskId || "",
      kind: inferRecurrenceKind(dates),
      startTime: rep.plannedStartAt ? (rep.plannedStartAt.split("T")[1] || "") : "",
      endTime: rep.plannedEndAt ? (rep.plannedEndAt.split("T")[1] || "") : "",
      anchorDate: dates[0] || todayISO(),
      expectedCharge: rep.expectedCharge ?? "",
      expectedDischarge: rep.expectedDischarge ?? "",
      source: rep.source || "",
      exceptionDates: [],
      createdAt: nowDateTime(),
      updatedAt: nowDateTime(),
      deleted: false
    });
  }
  value.recurrences = rules;
  // 繰り返し Block は「実績あり」だけ履歴として残し、未編集の展開分は破棄。
  // 削除済み Block もこの機会に物理削除する。
  value.blocks = (value.blocks || []).filter((b) => {
    if (b.deleted) return false;
    if (!b.recurrenceGroupId) return true;
    return isTouchedBlock(b);
  });
}

function blocksForDate(date) {
  return state.blocks
    .filter((block) => !block.deleted && block.date === date)
    .sort((a, b) => (a.plannedStartAt || "99").localeCompare(b.plannedStartAt || "99"));
}

function blockById(id) {
  return state.blocks.find((block) => block.id === id);
}

function projectName(projectId) {
  if (!projectId) return "単発";
  return state.projects.find((project) => project.id === projectId)?.title || "Projectなし";
}

// v35: 進捗の分母は「まだ生きているタスク」だけ。中断/中止は完了扱いせず分母からも外す。
function taskProgress(tasks) {
  const live = tasks.filter((task) => isTaskCountable(task));
  if (!live.length) return 0;
  return Math.round((live.filter((task) => task.status === "completed").length / live.length) * 100);
}

// =========================================================
// v35: 「中断」ステータス
//   途中でやらなくなったものをずっと残さないための状態。
//   Project は status:"paused"、Task は status:"suspended" を「中断」とみなす。
//   中断したものは一覧・進捗から外れ、WBS の「中断を表示」でいつでも再開できる。
// =========================================================
function isProjectSuspended(p) { return (p?.status || "active") === "paused"; }
function isTaskSuspended(t) { return (t?.status || "todo") === "suspended"; }
// 進捗の分母に含めるか(完了は含める / 中断・中止は含めない)
function isTaskCountable(t) {
  const s = t?.status || "todo";
  return s !== "suspended" && s !== "cancelled";
}
// これ以上進めない(完了・中断・中止)= 未完了リストから外す対象
function isTaskDead(t) {
  const s = t?.status || "todo";
  return s === "completed" || s === "suspended" || s === "cancelled";
}
// 日本語ステータスラベル(関数宣言=巻き上げされるので描画前でも安全)
function projectStatusLabel(s) {
  return ({ active: "進行中", paused: "中断", completed: "完了", archived: "アーカイブ", cancelled: "中止" })[s] || s || "進行中";
}
function taskStatusLabel(s) {
  return ({ todo: "未着手", doing: "着手中", completed: "完了", suspended: "中断", cancelled: "中止" })[s] || s || "未着手";
}

function suspendProject(id) {
  state.projects = state.projects.map((p) => p.id === id ? { ...p, status: "paused", updatedAt: nowDateTime() } : p);
  saveAndRender("プロジェクトを中断しました");
}
function resumeProject(id) {
  state.projects = state.projects.map((p) => p.id === id ? { ...p, status: "active", updatedAt: nowDateTime() } : p);
  saveAndRender("プロジェクトを再開しました");
}
function suspendTask(id) {
  state.tasks = state.tasks.map((t) => t.id === id ? { ...t, status: "suspended", updatedAt: nowDateTime() } : t);
  saveAndRender("タスクを中断しました");
}
function resumeTask(id) {
  state.tasks = state.tasks.map((t) => t.id === id ? { ...t, status: "todo", updatedAt: nowDateTime() } : t);
  saveAndRender("タスクを再開しました");
}

function energyPoints(blocks, rowHeight, startHour) {
  let value = Number(state.settings.morningEnergyLog[state.selectedDate] ?? 5);
  return blocks
    .filter((block) => block.completed || block.actualEndAt)
    .sort((a, b) => (a.actualEndAt || a.plannedEndAt || "").localeCompare(b.actualEndAt || b.plannedEndAt || ""))
    .map((block) => {
      value += Number(block.charge || 0) - Number(block.discharge || 0);
      const time = block.actualEndAt || block.plannedEndAt || block.plannedStartAt;
      const top = Math.max(8, ((minutesOf(time) - startHour * 60) / 60) * rowHeight);
      return { top, value, right: 80 - clamp(value, -20, 20) * 3 };
    });
}

function rangeOptions(min, max, selected) {
  let html = "";
  for (let i = min; i <= max; i += 1) {
    html += `<option value="${i}" ${Number(selected) === i ? "selected" : ""}>${i}</option>`;
  }
  return html;
}

function emptyPanel(message) {
  return `<div class="panel muted">${message}</div>`;
}

function todayISO() {
  return dateToISO(new Date());
}

function nowDateTime() {
  return dateToLocalDateTime(new Date());
}

function dateToISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dateToLocalDateTime(date) {
  // v37: 秒を切り捨てない(ポモドーロの endsAt に使われるため、
  //      切り捨てると 10:00:45 開始のセッションが 10:25:00 で終わり最大59秒短くなる)
  return `${dateToISO(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function parseDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// v56: ローカル日時文字列 "YYYY-MM-DDTHH:mm[:ss]"(または "YYYY-MM-DD")を、
//      new Date(string) の TZ 解釈を経由せず数値コンストラクタで ms に変換する。
//      iOS Safari は timezone 無しの ISO 風文字列を UTC と誤解釈するため、
//      endsAt/startedAt/updatedAt を new Date(str) で読むと最大9時間ズレる。
function localDateTimeToMs(dateTime) {
  if (!dateTime) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(dateTime);
  if (!m) return 0;
  return new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
  ).getTime();
}

function addDays(date, delta) {
  const d = parseDate(date);
  d.setDate(d.getDate() + delta);
  return dateToISO(d);
}

// v117(B): 自己締切の自動前倒し。dueDate未設定なら""(呼び出し側は既存の t.dueDate 真偽判定を
// 維持する)。selfDueOff=trueは実期日をそのまま尊重、既定(false)はdueDateの2日前を「有効締切」
// として表示・期限切れ判定・ソートに使う(app-state.json自体のdueDateは書き換えない)。
// Wish(state.projects kind:"wish" 配下のTask)・Project自体のdueDate(projDue)はこの関数の対象外
// (呼び出し箇所側で対象を絞る。Wishタブの描画コードからは呼ばない)。
function effectiveDueDate(task) {
  if (!task || !task.dueDate) return "";
  if (task.selfDueOff) return task.dueDate;
  return addDays(task.dueDate, -2);
}

function addYears(date, years) {
  const d = parseDate(date);
  d.setFullYear(d.getFullYear() + years);
  return dateToISO(d);
}

function daysBetween(start, end) {
  const ms = parseDate(end).getTime() - parseDate(start).getTime();
  return Math.ceil(ms / 86400000);
}

function minutesOf(dateTime) {
  if (!dateTime) return 0;
  // v18: Date を経由せず、文字列から直接抽出(iOS Safari の TZ 解釈バグを回避)
  // "YYYY-MM-DDTHH:mm[:ss]" 形式から時:分を取り出す
  const m1 = /T(\d{1,2}):(\d{2})/.exec(dateTime);
  if (m1) return Number(m1[1]) * 60 + Number(m1[2]);
  // "HH:mm" 単独
  const m2 = /^(\d{1,2}):(\d{2})/.exec(dateTime);
  if (m2) return Number(m2[1]) * 60 + Number(m2[2]);
  return 0;
}

function timeFromDateTime(dateTime) {
  if (!dateTime) return "";
  // v18: Date を経由せず、文字列から直接抽出(TZ 解釈バグ回避)
  const m = /T(\d{1,2}):(\d{2})/.exec(dateTime);
  if (m) return `${pad2(Number(m[1]))}:${m[2]}`;
  return "";
}

function formatDisplayDate(date) {
  return `${date} (${weekdayLabel(date)})`;
}

function weekdayLabel(date) {
  return ["日", "月", "火", "水", "木", "金", "土"][parseDate(date).getDay()];
}

function remainingText(end, doubleSpeed = false) {
  const remainingMs = Math.max(0, localDateTimeToMs(end) - Date.now());
  // 2倍速: 500ms = 表示1秒 として扱う(実時間25分で 50:00 → 0:00、1秒ずつ自然に減る)
  const display = doubleSpeed
    ? Math.floor(remainingMs / 500)
    : Math.floor(remainingMs / 1000);
  return `${pad2(Math.floor(display / 60))}:${pad2(display % 60)}`;
}

function signed(value) {
  return value >= 0 ? `+${value}` : String(value);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            // 新しい SW がインストール完了、既存の SW がいる(=更新)
            showToast("新しいバージョンを取得中...");
            newWorker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
      // 起動時にも更新チェック
      reg.update?.();
    }).catch(() => {
      // localhost / https 以外では登録されない。開発中は無視してよい。
    });
  });
}

// ============================================================
// 編集モーダル(Project / Task / Block)
// ============================================================

const modalRoot = document.querySelector("#modalRoot");

function openProjectEditor(id) {
  const project = state.projects.find((p) => p.id === id);
  if (!project) return;
  state.modal = { type: "project", id };
  renderModal(buildProjectModal(project));
}

function openTaskEditor(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  state.modal = { type: "task", id };
  renderModal(buildTaskModal(task));
}

function openBlockEditor(id) {
  const block = state.blocks.find((b) => b.id === id);
  if (!block) return;
  state.modal = { type: "block", id };
  renderModal(buildBlockModal(block));
}

// v170: openChainEditor(チェーン新規作成/編集モーダルの起動)はsrc/features/routine.jsへ
// 移動した(app.js分割・段階4-4)。呼び出し元(chain-new/chain-edit分岐)はimportで参照する。

function renderModal(innerHTML) {
  modalRoot.innerHTML = innerHTML;
  modalRoot.classList.add("open");
  modalRoot.setAttribute("aria-hidden", "false");
  // 背景クリックで閉じる
  modalRoot.onclick = (event) => {
    if (event.target !== modalRoot) return;
    // v132(Codexレビュー[med]対応): 身体スキャン表示中の背景タップはcloseModal()を直接
    // 呼ぶと_pendingBodyScanCtxが破棄されるだけでcloseBodyScanFlow()(ゲート判定を呼ぶ)を
    // 経由しない。明示ボタン(body-scan-discard等)と同じ「記録せず閉じる」経路へ揃える。
    if (state.modal && state.modal.type === "bodyScan") { bodyScanDiscard(); return; }
    // v162: 未完了理由モーダルも同じ理由(_pendingIncompleteReasonCtxが残ったまま
    // dailyCloseモードのgenerateReport()が呼ばれなくなる事故を防ぐ)でskip経路へ揃える。
    if (state.modal && state.modal.type === "incompleteReason") { skipIncompleteReasonModal(); return; }
    closeModal();
  };
}

function closeModal() {
  state.modal = null;
  modalRoot.classList.remove("open");
  modalRoot.setAttribute("aria-hidden", "true");
  modalRoot.innerHTML = "";
  modalRoot.onclick = null;
  _migrationRitualCtx = null;  // v61: 選択せずに閉じた場合も一時状態を残さない
  _pendingLifecycleCtx = null;  // v87: 宣言/報告モーダルを×で閉じた場合は開始/終了自体も取り消す
  // v129: 背景タップ等の暗黙クローズは記録せず破棄する(_pendingLifecycleCtxと同じ扱い)。
  // 明示的な保存/discard経路(closeBodyScanFlow)は既にnull化済みのため、ここは冪等。
  _pendingBodyScanCtx = null;
}

function readModalFields() {
  const fields = {};
  modalRoot.querySelectorAll("[data-modal-field]").forEach((el) => {
    const key = el.dataset.modalField;
    if (el.type === "checkbox") {
      fields[key] = el.checked;
    } else if (el.type === "number" || el.dataset.modalKind === "number") {
      fields[key] = el.value === "" ? null : Number(el.value);
    } else {
      fields[key] = el.value;
    }
  });
  return fields;
}

function submitModal() {
  if (!state.modal) return;
  const fields = readModalFields();
  // v172: レジストリ経由のmodal handlerが登録されていればそちらを優先する(段階5-1時点では
  // どのtypeもまだ何も登録していないため常にfalseで、既存if-else連鎖が今までどおり実行される)。
  if (dispatchModalSave(state.modal.type, state.modal.id, fields)) return;
  if (state.modal.type === "project") {
    saveProjectFromModal(state.modal.id, fields);
  } else if (state.modal.type === "task") {
    saveTaskFromModal(state.modal.id, fields);
  } else if (state.modal.type === "block") {
    saveBlockFromModal(state.modal.id, fields);
  } else if (state.modal.type === "actualEntry") {
    saveActualEntryFromModal(state.modal.id, fields);
  } else if (state.modal.type === "question") {
    saveQuestionFromModal(state.modal.id, fields);  // v39
  } else if (state.modal.type === "experiment") {
    saveExperimentFromModal(state.modal.id, fields);  // v68
  } else if (state.modal.type === "chain") {
    saveChainFromModal(state.modal.id, fields);  // v115: 連続ルーティン(提案G②)
  } else if (state.modal.type === "storeVisit") {
    saveStoreVisitFromModal(state.modal.id, fields);  // v141: 今日行ったお店ログ
  }
}

function deleteFromModal() {
  if (!state.modal) return;
  const ok = window.confirm("削除しますか? この操作は取り消せます(deleted フラグ)。");
  if (!ok) return;
  // v172: 同上(submitModal参照)。登録済みhandlerが処理した場合もcloseModal()は必ず呼ぶ。
  if (dispatchModalDelete(state.modal.type, state.modal.id)) {
    closeModal();
    return;
  }
  if (state.modal.type === "project") {
    deleteProject(state.modal.id);
  } else if (state.modal.type === "task") {
    deleteTask(state.modal.id);
  } else if (state.modal.type === "block") {
    deleteBlock(state.modal.id);
  } else if (state.modal.type === "question") {
    deleteQuestion(state.modal.id);  // v39
  } else if (state.modal.type === "experiment") {
    deleteExperiment(state.modal.id);  // v68
  } else if (state.modal.type === "chain") {
    deleteChain(state.modal.id);  // v115: 連続ルーティン(提案G②)
  } else if (state.modal.type === "storeVisit") {
    deleteStoreVisit(state.modal.id);  // v141: 今日行ったお店ログ
  }
  closeModal();
}

// v170: anchorCandidateOptions〜deleteChain(チェーン編集モーダル一式、計91行)は
// src/features/routine.jsへ移動した(app.js分割・段階4-4)。anchorCandidateOptionsは
// buildBlockModal(Timeline Block編集モーダルのアンカー選択、実grepで判明)からも参照するため
// importで解決した。submitModal/deleteFromModal(直前、app.js残留)のchain分岐は
// saveChainFromModal/deleteChainのimport参照へ切り替えただけで巨大if連鎖の構造は無改変。

// ---------- Project モーダル ----------

function buildProjectModal(project) {
  const status = project.status || "active";
  const kind = project.kind || "normal";
  const is12WY = Boolean(project.twelveWeekStartDate);
  // v127追補(Codex P1): やりたいことの唯一のコンテナ(kind:"wish")は種別変更・削除ができると
  // getWishProject()の前提が壊れる(既存Wishタスクが迷子になる)ため、編集モーダル側でも
  // 種別プルダウンをdisabledにして固定表示にし、削除ボタン自体を出さない(deleteProject側の
  // ガードと二重防御)。
  const isWishSingleton = kind === "wish";
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">Project を編集</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label class="field-label">タイトル</label>
          <input class="input" data-modal-field="title" value="${escapeHTML(project.title || "")}">
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">種別</label>
            <select class="select" data-modal-field="kind" ${isWishSingleton ? "disabled" : ""}>
              <option value="normal" ${kind === "normal" ? "selected" : ""}>Project</option>
              <option value="wish" ${kind === "wish" ? "selected" : ""}>Wish</option>
            </select>
            ${isWishSingleton ? `<span class="muted" style="font-size:11px">やりたいことの保存先のため種別は変更できません</span>` : ""}
          </div>
          <div class="field">
            <label class="field-label">ステータス</label>
            <select class="select" data-modal-field="status">
              ${["active", "paused", "completed", "archived", "cancelled"].map((s) => `
                <option value="${s}" ${status === s ? "selected" : ""}>${projectStatusLabel(s)}</option>
              `).join("")}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field-label">優先度</label>
          <select class="select" data-modal-field="priority">
            ${["高", "中", "低"].map((pr) => `
              <option value="${pr}" ${(project.priority || "中") === pr ? "selected" : ""}>${pr}</option>
            `).join("")}
          </select>
        </div>
        <div class="field">
          <label class="field-label">カテゴリ</label>
          ${renderCategorySelect(project.category || "")}
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">開始日</label>
            <input class="input" type="date" data-modal-field="startDate" value="${project.startDate || ""}">
          </div>
          <div class="field">
            <label class="field-label">期限</label>
            <input class="input" type="date" data-modal-field="dueDate" value="${project.dueDate || ""}">
          </div>
        </div>
        <div class="field">
          <label class="checkbox-line">
            <input type="checkbox" data-modal-field="is12WY" ${is12WY ? "checked" : ""}>
            12WY 期間に登録する(現在の 12WY 開始日: ${state.settings.twelveWeekStartDate || "未設定"})
          </label>
        </div>
        <div class="field">
          <label class="checkbox-line">
            <input type="checkbox" data-modal-field="showProgress" ${project.showProgress ? "checked" : ""}>
            進捗率を表示(配下Taskの分子/分母を合計してバー表示)
          </label>
        </div>
        <div class="field">
          <label class="field-label">説明 / メモ</label>
          <textarea class="textarea" data-modal-field="description" style="min-height:120px">${escapeHTML(project.description || "")}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        ${isWishSingleton ? "" : `<button class="btn danger" data-action="modal-delete">削除</button>`}
        <button class="btn" data-action="modal-close">キャンセル</button>
        <button class="btn primary" data-action="modal-save">保存</button>
      </div>
    </div>
  `;
}

function saveProjectFromModal(id, fields) {
  const twelveWeekStartDate = fields.is12WY ? (state.settings.twelveWeekStartDate || todayISO()) : "";
  state.projects = state.projects.map((p) => {
    if (p.id !== id) return p;
    return {
      ...p,
      title: (fields.title || "").trim() || p.title,
      // v127追補(Codex P1): やりたいことの唯一のコンテナ(kind:"wish")はUIをdisabledにしているが、
      // 保存関数側でも二重に固定する(disabled selectのDOM改変等を経由した変更を防ぐ最終防波堤)。
      kind: p.kind === "wish" ? "wish" : (fields.kind || p.kind || "normal"),
      status: fields.status || p.status || "active",
      priority: fields.priority || p.priority || "中",  // v63: WIP上限アラート(提案2)
      category: fields.category || "",
      startDate: fields.startDate || "",
      dueDate: fields.dueDate || "",
      description: fields.description || "",
      twelveWeekStartDate,
      showProgress: Boolean(fields.showProgress),  // v95: WBS進捗率(Σ分子/Σ分母)の表示トグル
      updatedAt: nowDateTime()
    };
  });
  closeModal();
  saveAndRender("Projectを更新しました");
}

// ---------- Task モーダル ----------

function buildTaskModal(task) {
  const status = task.status || "todo";
  const projectOptions = [
    `<option value="" ${!task.projectId ? "selected" : ""}>単発Task</option>`,
    ...state.projects
      .filter((p) => !p.deleted)
      .map((p) => `<option value="${p.id}" ${task.projectId === p.id ? "selected" : ""}>${escapeHTML(p.title)}</option>`)
  ].join("");
  // 親候補: 同じ projectId の他の Task で、自分自身でなく、自分の子孫でないもの
  const parentCandidates = state.tasks.filter((t) =>
    !t.deleted && t.projectId === task.projectId && t.id !== task.id && !isDescendantOf(t, task.id)
  );
  const parentOptions = [
    `<option value="" ${!task.parentTaskId ? "selected" : ""}>(親なし = ルート)</option>`,
    ...parentCandidates.map((t) => `<option value="${t.id}" ${task.parentTaskId === t.id ? "selected" : ""}>${escapeHTML(t.title)}</option>`)
  ].join("");
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">${task.id ? "Task を編集" : "Task を追加"}</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label class="field-label">タイトル</label>
          <input class="input" data-modal-field="title" value="${escapeHTML(task.title || "")}">
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">紐づくProject</label>
            <select class="select" data-modal-field="projectId">${projectOptions}</select>
          </div>
          <div class="field">
            <label class="field-label">ステータス</label>
            <select class="select" data-modal-field="status">
              ${["todo", "doing", "completed", "suspended", "cancelled"].map((s) => `
                <option value="${s}" ${status === s ? "selected" : ""}>${taskStatusLabel(s)}</option>
              `).join("")}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field-label">親 Task(サブタスクにする場合)</label>
          <select class="select" data-modal-field="parentTaskId">${parentOptions}</select>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">カテゴリ</label>
            ${renderCategorySelect(task.category || "")}
          </div>
          <div class="field">
            <label class="field-label">期限</label>
            <input class="input" type="date" data-modal-field="dueDate" value="${task.dueDate || ""}">
          </div>
        </div>
        <div class="field">
          <label class="checkbox-line">
            <input type="checkbox" data-modal-field="selfDueEnabled" ${task.selfDueOff ? "" : "checked"}>
            ⏪ 自己締切(期日−2日)
          </label>
        </div>
        <div class="field">
          <label class="field-label">完了条件(任意)</label>
          <textarea class="textarea" data-modal-field="doneCriteria" style="min-height:48px; font-size:16px" placeholder="行動でなく“終わったら残る物”で書く">${escapeHTML(task.doneCriteria || "")}</textarea>
        </div>
        <div class="field">
          <label class="field-label">スモールステップ(任意)</label>
          <textarea class="textarea" data-modal-field="firstStep" style="min-height:48px; font-size:16px" placeholder="5〜15分で終わる最初の行動">${escapeHTML(task.firstStep || "")}</textarea>
        </div>
        <div class="field">
          <label class="field-label">レバレッジ(10x機構・任意)</label>
          <select class="select" data-modal-field="leverageType">
            ${leverageTypeOptionsHTML(task.leverageType || "")}
          </select>
          ${leverageJudgeHelperHTML(task.leverageType)}
        </div>
        <div class="field">
          <label class="field-label">🤝 AI作業ワーカー連携(任意)</label>
          <label class="checkbox-line">
            <input type="checkbox" data-modal-field="aiWork" ${task.aiWork ? "checked" : ""}>
            このTaskをAI(Claude Code)に作業してもらう
          </label>
          <textarea class="textarea" data-modal-field="aiWorkBrief" style="min-height:48px; font-size:16px" placeholder="何をしてほしいか・成果物の置き場希望(1〜2行)">${escapeHTML(task.aiWorkBrief || "")}</textarea>
        </div>
        <div class="field">
          <label class="field-label">説明 / メモ</label>
          <textarea class="textarea" data-modal-field="description" style="min-height:120px">${escapeHTML(task.description || "")}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        ${task.id ? `<button class="btn danger" data-action="modal-delete">削除</button>` : ""}
        <button class="btn" data-action="modal-close">キャンセル</button>
        <button class="btn primary" data-action="modal-save">${task.id ? "保存" : "追加"}</button>
      </div>
    </div>
  `;
}

// 循環参照防止: targetId が ancestor の子孫かチェック
function isDescendantOf(candidate, ancestorId) {
  let cur = candidate;
  let safety = 0;
  while (cur?.parentTaskId && safety < 10) {
    if (cur.parentTaskId === ancestorId) return true;
    cur = state.tasks.find((t) => t.id === cur.parentTaskId);
    safety++;
  }
  return false;
}

function saveTaskFromModal(id, fields) {
  // v47: id 空 = 新規作成モード(WBS の「+ タスク」「+ サブ」から)
  if (!id) {
    const title = (fields.title || "").trim();
    if (!title) return showToast("タスク名を入力してください");
    const task = makeTask({
      projectId: fields.projectId || "",
      parentTaskId: fields.parentTaskId || "",
      title,
      category: fields.category || "",
      dueDate: fields.dueDate || "",
      leverageType: fields.leverageType || ""  // v65: 10x機構
    });
    task.status = fields.status || "todo";
    // v107: 新規作成時点で「完了」を選んだ場合もWBSインライン編集(v95)と同じくv95連動を発火
    if (task.status === "completed") task.progressNum = fillProgressOnComplete(task);
    task.description = fields.description || "";
    task.aiWork = Boolean(fields.aiWork);  // v67: AI作業ワーカー連携
    task.aiWorkBrief = (fields.aiWorkBrief || "").trim();
    task.doneCriteria = (fields.doneCriteria || "").trim();  // v96: 完了条件
    task.firstStep = (fields.firstStep || "").trim();        // v96: スモールステップ
    // v117(B): チェックボックスは「自己締切ON」の意味で表示しているため、保存時に反転する
    // (selfDueOffは既定false=ON。data-modal-field自体を反転名にはしていない=readModalFields
    // は素直にchecked値を渡すだけの共通関数のため、ここで意味を戻す)。
    task.selfDueOff = fields.selfDueEnabled !== undefined ? !fields.selfDueEnabled : false;
    state.tasks.push(task);
    closeModal();
    saveAndRender("Taskを追加しました");
    return;
  }
  state.tasks = state.tasks.map((t) => {
    if (t.id !== id) return t;
    const status = fields.status || t.status || "todo";
    // v107: タスク編集モーダルの保存経路がv95連動(分子=分母)を素通りしていたバグ修正。
    //       WBSインライン編集(data-wbs-edit)のfillProgressOnComplete呼び出しと同じ方針で、
    //       「完了」を選んで保存した瞬間に分子を分母へ揃える(完了以外への変更では触らない)。
    const progressNum = status === "completed" ? fillProgressOnComplete(t) : t.progressNum;
    return {
      ...t,
      title: (fields.title || "").trim() || t.title,
      projectId: fields.projectId || "",
      parentTaskId: fields.parentTaskId || "",
      status,
      progressNum,
      category: fields.category || "",
      dueDate: fields.dueDate || "",
      description: fields.description || "",
      leverageType: fields.leverageType !== undefined ? fields.leverageType : (t.leverageType || ""),  // v65: 10x機構
      aiWork: Boolean(fields.aiWork),  // v67: AI作業ワーカー連携
      aiWorkBrief: (fields.aiWorkBrief || "").trim(),
      doneCriteria: (fields.doneCriteria || "").trim(),  // v96: 完了条件
      firstStep: (fields.firstStep || "").trim(),        // v96: スモールステップ
      // v117(B): チェックボックス表示は反転(「自己締切ON」)なので保存時に戻す
      selfDueOff: fields.selfDueEnabled !== undefined ? !fields.selfDueEnabled : Boolean(t.selfDueOff),
      // v37: モーダルに nextRoutineId の入力欄はないため、undefined なら既存値を保持
      //      (以前は保存のたびに "" で消えていた)
      nextRoutineId: fields.nextRoutineId !== undefined ? fields.nextRoutineId : (t.nextRoutineId || ""),
      updatedAt: nowDateTime()
    };
  });
  closeModal();
  saveAndRender("Taskを更新しました");
}

// ---------- Block モーダル ----------

function buildBlockModal(block) {
  const taskOptions = [
    `<option value="" ${!block.taskId ? "selected" : ""}>単発(Task紐づけなし)</option>`,
    ...state.tasks
      .filter((t) => !t.deleted)
      .map((t) => `<option value="${t.id}" ${block.taskId === t.id ? "selected" : ""}>${escapeHTML(t.title)}</option>`)
  ].join("");
  // v146(UI改善計画Phase1-3): 🏁(タスク完了)はタスクシュート行から誤タップ対策で撤去し、
  // ここ(Block編集モーダル)へ移設した。挙動(toggleTaskCompleteFromBlock)自体は無変更。
  const linkedTask = block.taskId ? state.tasks.find((t) => t.id === block.taskId) : null;
  const taskCompleteHTML = linkedTask ? `
        <div class="field">
          <button class="btn task-complete-toggle-btn ${linkedTask.status === "completed" ? "green" : "orange"}"
            data-action="toggle-task-complete" data-id="${block.id}" style="min-height:44px; width:100%">
            🏁 ${linkedTask.status === "completed" ? "タスク完了済み(タップで戻す)" : "紐づくTaskも完了にする"}
          </button>
        </div>` : "";
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">Block を編集</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label class="field-label">タイトル</label>
          <input class="input" data-modal-field="title" value="${escapeHTML(block.title || "")}">
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">日付</label>
            <input class="input" type="date" data-modal-field="date" value="${block.date || todayISO()}">
          </div>
          <div class="field">
            <label class="field-label">カテゴリ</label>
            ${renderCategorySelect(block.category || "")}
          </div>
        </div>
        <div class="field">
          <label class="field-label">紐づくTask</label>
          <select class="select" data-modal-field="taskId">${taskOptions}</select>
        </div>
        <div class="field">
          <label class="field-label">レバレッジ(10x機構・任意)</label>
          <select class="select" data-modal-field="leverageType">
            ${leverageTypeOptionsHTML(block.leverageType || "")}
          </select>
          ${leverageJudgeHelperHTML(block.leverageType)}
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">予定開始</label>
            <input class="input" type="datetime-local" step="300" data-modal-field="plannedStartAt" value="${toLocalInput(block.plannedStartAt)}">
          </div>
          <div class="field">
            <label class="field-label">予定終了</label>
            <input class="input" type="datetime-local" step="300" data-modal-field="plannedEndAt" value="${toLocalInput(block.plannedEndAt)}">
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">実績開始</label>
            <input class="input" type="datetime-local" step="300" data-modal-field="actualStartAt" value="${toLocalInput(block.actualStartAt)}">
          </div>
          <div class="field">
            <label class="field-label">実績終了</label>
            <input class="input" type="datetime-local" step="300" data-modal-field="actualEndAt" value="${toLocalInput(block.actualEndAt)}">
          </div>
        </div>
        <div class="field">
          <label class="field-label">見積時間(分・任意)</label>
          <input class="input" type="number" min="0" step="5" data-modal-field="estimateMin" data-modal-kind="number" value="${block.estimateMin ?? ""}" placeholder="空欄なら過去実績/30分で自動">
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">充電 (0-5)</label>
            <select class="select" data-modal-field="charge" data-modal-kind="number">
              ${rangeOptions(0, 5, block.charge || 0)}
            </select>
          </div>
          <div class="field">
            <label class="field-label">放電 (0-5)</label>
            <select class="select" data-modal-field="discharge" data-modal-kind="number">
              ${rangeOptions(0, 5, block.discharge || 0)}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="checkbox-line">
            <input type="checkbox" data-modal-field="completed" ${block.completed ? "checked" : ""}>
            完了済み(Block)
          </label>
        </div>
        ${taskCompleteHTML}
        <div class="field">
          <label class="field-label">コメント</label>
          <textarea class="textarea" data-modal-field="comment" style="min-height:100px">${escapeHTML(block.comment || "")}</textarea>
        </div>
        <div class="field" style="background:var(--accent-soft); padding:10px; border-radius:8px">
          <label class="field-label" style="color:var(--accent); font-weight:700">🔁 繰り返し設定</label>
          ${(() => {
            const liveRule = block.recurrenceGroupId
              ? (state.recurrences || []).find((r) => r.id === block.recurrenceGroupId && !r.deleted)
              : null;
            if (liveRule) {
              return `
                <select class="select" data-modal-field="recurrenceKind">
                  <option value="__keep__" selected>シリーズ設定を維持(変更しない)</option>
                  <option value="daily">毎日に変更</option>
                  <option value="weekdays">平日のみに変更</option>
                  <option value="weekly">毎週に変更</option>
                  <option value="monthly">毎月に変更</option>
                  <option value="__end__">繰り返しを終了する</option>
                </select>
                <div class="muted" style="font-size:11px; margin-top:6px; line-height:1.5">
                  この Block は繰り返しシリーズ(${recurrenceKindLabel(liveRule.kind)})の一部です。<br>
                  実績・コメント・完了の編集は<strong>この日のみ</strong>に反映されます。<br>
                  「終了する」を選ぶと今後の自動生成が止まります(過去の実績は残ります)。
                </div>
                ${block.category === "ルーティン" ? `
                <div class="field-row" style="margin-top:10px">
                  <div class="field">
                    <label class="field-label">充電の既定値 (0-5)</label>
                    <select class="select" data-modal-field="expectedCharge" data-modal-kind="number">${rangeOptions(0, 5, Number(liveRule.expectedCharge) || 0)}</select>
                  </div>
                  <div class="field">
                    <label class="field-label">放電の既定値 (0-5)</label>
                    <select class="select" data-modal-field="expectedDischarge" data-modal-kind="number">${rangeOptions(0, 5, Number(liveRule.expectedDischarge) || 0)}</select>
                  </div>
                </div>
                <div class="muted" style="font-size:11px; margin-top:4px">既定値を変更すると、未完了のすべての繰り返しに充電/放電が一括適用されます(個別の日の値はホーム画面で変更できます)。</div>
                <div class="field" style="margin-top:10px">
                  <label class="checkbox-line">
                    <input type="checkbox" data-modal-field="protection" ${liveRule.protection ? "checked" : ""}>
                    制約保護系(運動・睡眠・内省・家族時間など)
                  </label>
                  <div class="muted" style="font-size:11px; margin-top:4px">ONにすると実行率(%)の代わりに「連続欠落日数」で表示します(実行率で裁かない。2日連続から責めないトーンで案内)。</div>
                </div>
                ${liveRule.protection ? `
                <div class="field" style="margin-top:10px">
                  <label class="field-label">縮退版(崩れた日の最小構成)</label>
                  <input class="input" type="text" data-modal-field="fallbackTitle" value="${escapeHTML(liveRule.fallbackTitle || "")}" placeholder="例: 自宅スクワット5分">
                  <input class="input" type="number" min="0" step="1" data-modal-field="fallbackMinutes" data-modal-kind="number" value="${liveRule.fallbackMinutes ?? ""}" placeholder="分(任意)" style="margin-top:6px; max-width:120px">
                  <div class="muted" style="font-size:11px; margin-top:4px">設定すると、ルーティンタブ・ホームに「縮退版で実行」ボタンが出ます。フルで出来ない日もワンタップで実行でき、連続欠落日数がリセットされます。</div>
                </div>
                <div class="field" style="margin-top:10px">
                  <label class="field-label">アンカー(既存の別ルーティン/チェーンの直後に自動配置)</label>
                  <select class="select" data-modal-field="anchor">
                    <option value="" ${!liveRule.anchor ? "selected" : ""}>(アンカーなし)</option>
                    ${anchorCandidateOptions(liveRule.id).map((o) => `<option value="${o.id}" ${liveRule.anchor === o.id ? "selected" : ""}>${escapeHTML(o.label)}</option>`).join("")}
                  </select>
                  <div class="muted" style="font-size:11px; margin-top:4px">選んだルーティン/チェーンが完了した直後の時刻に、このルーティンのBlockを自動生成します。</div>
                </div>
                ` : ""}
                ` : ""}
              `;
            }
            return `
              <select class="select" data-modal-field="recurrenceKind">
                <option value="" selected>繰り返さない(この日のみ)</option>
                <option value="daily">毎日</option>
                <option value="weekdays">平日のみ(月〜金)</option>
                <option value="weekly">毎週(同じ曜日)</option>
                <option value="monthly">毎月(同じ日)</option>
              </select>
              <div class="muted" style="font-size:11px; margin-top:6px">繰り返しはルールとして保存され、表示は直近${RECURRENCE_KEEP_PAST_DAYS + RECURRENCE_FUTURE_DAYS}日分のみ実体化されます。</div>
            `;
          })()}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn danger" data-action="modal-delete" style="margin-right:auto">削除</button>
        <button class="btn" data-action="modal-close">キャンセル</button>
        <button class="btn primary" data-action="modal-save">保存</button>
      </div>
    </div>
  `;
}

function saveBlockFromModal(id, fields) {
  // v108: 保存の二重送信ガード(iOS Safari 保存ボタン二重発火対策、2026-05-22実害の再発防止)。
  //       実行中の多重呼び出しはブロックし、完了/失敗いずれも finally で必ず解除する。
  //       (以下、本体のインデントは変更なし=差分最小化のため)
  if (_blockSaveInFlight) return;
  _blockSaveInFlight = true;
  try {
  const existing = state.blocks.find((b) => b.id === id);
  const isNew = !existing;
  const updated = {
    id: isNew ? id : existing.id,
    title: (fields.title || "").trim() || (existing?.title || "新規Block"),
    date: fields.date || existing?.date || todayISO(),
    category: fields.category || "",
    taskId: fields.taskId || "",
    plannedStartAt: fromLocalInput(fields.plannedStartAt),
    plannedEndAt: fromLocalInput(fields.plannedEndAt),
    actualStartAt: fromLocalInput(fields.actualStartAt),
    actualEndAt: fromLocalInput(fields.actualEndAt),
    charge: Number(fields.charge) || 0,
    discharge: Number(fields.discharge) || 0,
    completed: Boolean(fields.completed),
    comment: fields.comment || "",
    expectedCharge: fields.expectedCharge != null ? Number(fields.expectedCharge) : (existing?.expectedCharge ?? ""),
    expectedDischarge: fields.expectedDischarge != null ? Number(fields.expectedDischarge) : (existing?.expectedDischarge ?? ""),
    recurrenceGroupId: existing?.recurrenceGroupId || "",
    pomodoroCount: existing?.pomodoroCount || 0,
    migratedTo: existing?.migratedTo || "",
    carryCount: existing?.carryCount || 0,  // v61: マイグレーション儀式(繰り越し回数、編集では変えない)
    leverageType: fields.leverageType !== undefined ? fields.leverageType : (existing?.leverageType || ""),  // v65: 10x機構
    orderIndex: existing?.orderIndex || 0,
    isMIT: existing?.isMIT || false,
    source: existing?.source || "",
    // v41: 見積時間(分)。空欄は null(解決順で補完)
    estimateMin: (fields.estimateMin != null && fields.estimateMin !== "") ? Number(fields.estimateMin) : (existing?.estimateMin ?? null),
    createdAt: existing?.createdAt || nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
  // v29: 予定の開始・終了日時は必須。空のままでは登録/保存させない。
  if (!updated.plannedStartAt || !updated.plannedEndAt) {
    showToast("予定の開始・終了日時を入力してください");
    return;
  }
  if (isNew) {
    const rk = fields.recurrenceKind;
    if (rk && rk !== "__keep__" && rk !== "__end__") {
      // v23: 新規 Block を繰り返しシリーズ化(ルールを作り、期間分だけ実体化)
      const rule = createRecurrenceRule(updated, rk);
      // v108: 重複ルール検知時(トーストはcreateRecurrenceRule内で表示済み)は
      //       Block自体も作成せずモーダルを開いたままにする(黙って握りつぶさない)。
      if (!rule) return;
      updated.recurrenceGroupId = rule.id;
      state.blocks.push(updated);
      maintainRecurrences();
      closeModal();
      saveAndRender(`繰り返し「${recurrenceKindLabel(rk)}」を設定しました`);
      return;
    }
    state.blocks.push(updated);
    closeModal();
    saveAndRender("Blockを追加しました");
  } else {
    // v37: 繰り返しインスタンスの日付を動かした場合、元の日付をルールの例外日に登録する。
    //      登録しないと次回の実体化(起動時)で元の日付に同じブロックが再生成され、
    //      「明日に延期したのに今日にも残っている」二重状態になる。
    if (existing.recurrenceGroupId && updated.date !== existing.date) {
      state.recurrences = (state.recurrences || []).map((r) =>
        r.id === existing.recurrenceGroupId && !r.deleted
          ? { ...r, exceptionDates: [...new Set([...(r.exceptionDates || []), existing.date])], updatedAt: nowDateTime() }
          : r);
    }
    state.blocks = state.blocks.map((b) => b.id === id ? updated : b);
    const rk = fields.recurrenceKind;
    // v23: "__keep__"・空・未指定 → この Block の編集のみ(シリーズ設定は不変)
    if (rk && rk !== "__keep__") {
      if (rk === "__end__") {
        // シリーズ終了(以降の自動生成を停止。実績履歴はそのまま残る)
        if (existing.recurrenceGroupId) {
          state.recurrences = (state.recurrences || []).map((r) =>
            r.id === existing.recurrenceGroupId
              ? { ...r, deleted: true, updatedAt: nowDateTime() }
              : r);
          // v37: 実体化済みの未来分(未編集)も取り除く。
          //      残すと「終了したのに31日先まで表示され続ける」状態になる。
          removeUntouchedInstances(existing.recurrenceGroupId, { fromDate: todayISO(), excludeId: id });
        }
        closeModal();
        saveAndRender("繰り返しシリーズを終了しました");
        return;
      }
      // kind 変更、または 単発 Block の新規シリーズ化
      const liveRule = (state.recurrences || []).find(
        (r) => r.id === existing.recurrenceGroupId && !r.deleted);
      if (liveRule) {
        state.recurrences = state.recurrences.map((r) =>
          r.id === liveRule.id
            ? {
                ...r,
                kind: rk,
                title: updated.title,
                category: updated.category,
                taskId: updated.taskId,
                startTime: updated.plannedStartAt ? (updated.plannedStartAt.split("T")[1] || "") : "",
                endTime: updated.plannedEndAt ? (updated.plannedEndAt.split("T")[1] || "") : "",
                expectedCharge: updated.expectedCharge,
                expectedDischarge: updated.expectedDischarge,
                // v114: 保護系ルーティン。チェックボックス自体はliveRule前提の表示なので
                // fields.protectionが来ていればそれを使い、来ていなければ既存値を維持する。
                protection: fields.protection !== undefined ? Boolean(fields.protection) : (r.protection || false),
                // v115: 縮退版(提案G①)。protection欄と同じくフィールドがliveRule.protection前提の
                // 表示なので、来ていなければ既存値を維持する。
                fallbackTitle: fields.fallbackTitle !== undefined ? (fields.fallbackTitle || "").trim() : (r.fallbackTitle || ""),
                fallbackMinutes: fields.fallbackMinutes !== undefined ? fields.fallbackMinutes : (r.fallbackMinutes ?? null),
                // v115: アンカー(提案G③)。同じくliveRule.protection前提の表示なので、
                // 来ていなければ既存値を維持する。
                anchor: fields.anchor !== undefined ? (fields.anchor || "") : (r.anchor || ""),
                updatedAt: nowDateTime()
              }
            : r);
        // v37: 旧kindで実体化済みの未来分(未編集)を取り除いてから再実体化する。
        //      残すと「毎日→毎週」に変えても毎日分が31日先まで表示され続ける。
        removeUntouchedInstances(liveRule.id, { fromDate: todayISO(), excludeId: id });
      } else {
        const rule = createRecurrenceRule(updated, rk);
        if (!rule) {
          // v108: 重複ルール検知(トーストはcreateRecurrenceRule内で表示済み)。
          //      シリーズ化はスキップし、直前(state.blocks.map)で確定済みのBlock本体の
          //      編集だけ保存する(黙って握りつぶさない)。
          closeModal();
          saveAndRender("Blockを更新しました");
          return;
        }
        updated.recurrenceGroupId = rule.id;
        state.blocks = state.blocks.map((b) => b.id === id ? updated : b);
      }
      maintainRecurrences();
      closeModal();
      saveAndRender("繰り返し設定を更新しました");
      return;
    }
    // v33: ルーティンの「既定の充電/放電」を変更したら、ルールと未完了の全実体に一括適用
    if (existing.recurrenceGroupId && fields.expectedCharge != null) {
      const rule = (state.recurrences || []).find(
        (r) => r.id === existing.recurrenceGroupId && !r.deleted);
      if (rule && (Number(rule.expectedCharge) !== updated.expectedCharge
        || Number(rule.expectedDischarge) !== updated.expectedDischarge)) {
        state.recurrences = state.recurrences.map((r) => r.id === rule.id
          ? { ...r, expectedCharge: updated.expectedCharge, expectedDischarge: updated.expectedDischarge, updatedAt: nowDateTime() }
          : r);
        // 未完了の全実体に既定値を適用(完了済みは履歴として保持。編集中の当日Blockは除く)
        state.blocks = state.blocks.map((b) =>
          (b.recurrenceGroupId === rule.id && !b.completed && b.id !== id)
            ? { ...b, charge: updated.expectedCharge, discharge: updated.expectedDischarge,
                expectedCharge: updated.expectedCharge, expectedDischarge: updated.expectedDischarge }
            : b);
      }
    }
    // v114: 保護系ルーティン(protection)の変更をルールへ反映(kind変更を伴わない編集のみ。
    //      kind変更時は上のrewriteで既に反映済みのためここには来ない=return済み)
    if (existing.recurrenceGroupId && fields.protection !== undefined) {
      const rule = (state.recurrences || []).find(
        (r) => r.id === existing.recurrenceGroupId && !r.deleted);
      if (rule && Boolean(rule.protection) !== Boolean(fields.protection)) {
        state.recurrences = state.recurrences.map((r) => r.id === rule.id
          ? { ...r, protection: Boolean(fields.protection), updatedAt: nowDateTime() }
          : r);
      }
    }
    // v115: 縮退版(fallbackTitle/fallbackMinutes)の変更をルールへ反映(kind変更を伴わない編集のみ。
    //      kind変更時は上のrewriteで既に反映済みのためここには来ない=return済み)
    if (existing.recurrenceGroupId && (fields.fallbackTitle !== undefined || fields.fallbackMinutes !== undefined)) {
      const rule = (state.recurrences || []).find(
        (r) => r.id === existing.recurrenceGroupId && !r.deleted);
      if (rule) {
        const nextTitle = fields.fallbackTitle !== undefined ? (fields.fallbackTitle || "").trim() : (rule.fallbackTitle || "");
        const nextMinutes = fields.fallbackMinutes !== undefined ? fields.fallbackMinutes : (rule.fallbackMinutes ?? null);
        if ((rule.fallbackTitle || "") !== nextTitle || (rule.fallbackMinutes ?? null) !== nextMinutes) {
          state.recurrences = state.recurrences.map((r) => r.id === rule.id
            ? { ...r, fallbackTitle: nextTitle, fallbackMinutes: nextMinutes, updatedAt: nowDateTime() }
            : r);
        }
      }
    }
    // v115: アンカー(anchor)の変更をルールへ反映(kind変更を伴わない編集のみ。
    //      kind変更時は上のrewriteで既に反映済みのためここには来ない=return済み)
    if (existing.recurrenceGroupId && fields.anchor !== undefined) {
      const rule = (state.recurrences || []).find(
        (r) => r.id === existing.recurrenceGroupId && !r.deleted);
      if (rule && (rule.anchor || "") !== (fields.anchor || "")) {
        state.recurrences = state.recurrences.map((r) => r.id === rule.id
          ? { ...r, anchor: fields.anchor || "", updatedAt: nowDateTime() }
          : r);
      }
    }
    closeModal();
    saveAndRender("Blockを更新しました");
  }
  } finally {
    _blockSaveInFlight = false;
  }
}

// タイムラインの空き時間行クリックで新規Block作成モーダル
function openTimelineNewBlock(startMinute) {
  // v37: 23時台や最下段の目盛りから追加しても "24:00"/"25:00" という
  //      不正な時刻を作らない(datetime-local が空欄になり保存できなかった)
  const clampedStart = Math.min(Math.max(0, startMinute), 23 * 60);
  const endMinute = Math.min(clampedStart + 60, 23 * 60 + 59);
  const date = state.selectedDate;
  const startISO = `${date}T${pad2(Math.floor(clampedStart / 60))}:${pad2(clampedStart % 60)}:00`;
  const endISO = `${date}T${pad2(Math.floor(endMinute / 60))}:${pad2(endMinute % 60)}:00`;
  const newBlock = {
    id: crypto.randomUUID(),
    title: "",
    date,
    category: "",
    taskId: "",
    plannedStartAt: startISO,
    plannedEndAt: endISO,
    actualStartAt: "",
    actualEndAt: "",
    completed: false,
    charge: 0,
    discharge: 0,
    expectedCharge: "",
    expectedDischarge: "",
    comment: "",
    recurrenceGroupId: "",
    pomodoroCount: 0,
    migratedTo: "",
    orderIndex: 0,
    source: "timeline",  // v15: タイムライン由来。タスクシュート画面では非表示
    _isNew: true,  // モーダル表示時に繰り返し設定を表示するためのフラグ
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
  state.modal = { type: "block", id: newBlock.id };
  // state.blocks に push せずに、モーダル表示してから保存時に push する
  renderModal(buildBlockModal(newBlock));
  // タイトル input にフォーカス
  setTimeout(() => {
    const titleInput = modalRoot.querySelector('[data-modal-field="title"]');
    titleInput?.focus();
  }, 50);
}

// ---------- datetime-local 変換 ----------

function toLocalInput(isoString) {
  if (!isoString) return "";
  // v18: Date を経由せず、文字列をそのまま使う(TZ 変換バグを避ける)
  // 既に "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss" 形式ならそのまま 16 文字に整形
  const s = String(isoString);
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (m) return `${m[1]}T${m[2]}:${m[3]}`;
  return "";
}

function fromLocalInput(value) {
  if (!value) return "";
  // v18: text input で柔軟に受け付ける
  let v = String(value).trim();
  // スラッシュ区切りをハイフンに(YYYY/MM/DD → YYYY-MM-DD)
  v = v.replace(/\//g, "-");
  // スペース区切りを T に(YYYY-MM-DD HH:MM → YYYY-MM-DDTHH:MM)
  v = v.replace(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/, (_, d, t) => {
    const [h, m] = t.split(":");
    return `${d}T${h.padStart(2, "0")}:${m}`;
  });
  // 単独の HH:MM の時刻パディング(8:30 → 08:30)
  if (/^\d{1,2}:\d{2}$/.test(v)) {
    const [h, m] = v.split(":");
    return `${h.padStart(2, "0")}:${m}`;
  }
  // YYYY-MM-DDTHH:MM の 16 文字なら :00 を追加
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) {
    return `${v}:00`;
  }
  // YYYY-MM-DD だけの 10 文字
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return v;
  }
  return v;
}

// ESC キーでモーダルを閉じる
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.modal) {
    closeModal();
  }
});

// ============================================================
// ポモドーロ常時起動 (v3)
// ============================================================

function defaultPassivePomodoro() {
  return {
    enabled: false,
    activeWeekdays: [false, true, true, true, true, true, false],  // 平日
    activeStartHHMM: "08:00",
    activeEndHHMM: "19:00",
    lastFiredKey: ""
  };
}




function setPomodoroTab(tab) {
  state.pomodoro.tab = tab;
  persistLocalNoSchedule();  // v37: タブ切替は UI 操作(dataModifiedAt を汚さない)
  render();
}



// normalizeState の補完
function ensurePassivePomodoro() {
  state.pomodoro ||= {};
  state.pomodoro.passive ||= defaultPassivePomodoro();
  // activeWeekdays が配列でない / 7 要素未満の場合フォールバック
  if (!Array.isArray(state.pomodoro.passive.activeWeekdays) || state.pomodoro.passive.activeWeekdays.length !== 7) {
    state.pomodoro.passive.activeWeekdays = [false, true, true, true, true, true, false];
  }
}

// ============================================================
// AI フィードバック アップロード + 日報 GitHub push (v3)
// ============================================================

// v56: AIフィードバック_<date>.md を push した日付を記録(重複なし)。
//      起動時 hydrate はこの記録に載る日付だけを fetch し、存在しないファイルへの
//      リクエスト(=DevTools コンソールに残る 404)を出さない。
function recordFeedbackFile(date) {
  if (!Array.isArray(state.feedbackFiles)) state.feedbackFiles = [];
  if (!state.feedbackFiles.includes(date)) {
    state.feedbackFiles.push(date);
    saveState();
  }
}

// v143: uploadFeedbackFile()(.mdアップロード欄の処理本体)は削除した。唯一の呼び出し元
// だったdata-feedback-uploadハンドラがv141以来到達不能だったため(CHANGES_v143.md参照)。
// recordFeedbackFile()はhydrateStaticMarkdown側からも呼ばれているため残す。

async function pushReportToGitHub() {
  const date = state.selectedDate;
  const report = state.reports[date];
  if (!report) {
    showToast("日報がまだ生成されていません");
    return;
  }
  if (!personalDataReady(state.settings.github)) {
    showToast("GitHub設定(個人データリポジトリ)が未入力です");
    return;
  }
  await pushFileToGitHub(`日報_${date}.md`, report, `日報 ${date}`);
}

// v72: 個人データリポジトリ(taskchute/配下)への書き込み専用PUT
// v76: URL組み立てを personalDataPath(encodeURIComponent(filename)) から
//      personalDataPath(filename).split("/").map(encodeURIComponent).join("/") に統一した。
//      旧実装は filename に "/" が含まれると丸ごと %2F にエンコードされサブディレクトリを
//      指せなくなる欠陥があり(v74で発覚、pushGitHubPathを新設して回避していた)、
//      本体側は直っていなかった(v74レビューのnit)。日報_*.md 等の呼び出し元(filenameに"/"を
//      含まない)では旧実装と生成URLは完全に一致する(既存の正常系は無変更)ため、
//      安全な統一である。fetchGitHubRawResult/gitHubContentsURL/pushGitHubPathと同じ方式。
async function pushFileToGitHub(filename, content, label) {
  try {
    const raw = state.settings.github;
    if (!personalDataReady(raw)) {
      throw new Error("GitHub設定(個人データリポジトリ・token)が未入力です");
    }
    const cfg = personalDataConn(raw);
    const branch = cfg.branch || "main";
    const encPath = personalDataPath(filename).split("/").map(encodeURIComponent).join("/");
    const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${encPath}`;
    // 既存ファイルのSHAを取得
    let sha = "";
    try {
      const head = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, {
        headers: githubHeaders(cfg.token)
      });
      if (head.ok) {
        const payload = await head.json();
        sha = payload.sha || "";
      }
    } catch (e) {
      // 新規ファイル
    }
    const response = await fetch(url, {
      method: "PUT",
      headers: githubHeaders(cfg.token),
      body: JSON.stringify({
        message: `chore: update ${filename} ${new Date().toISOString()}`,
        content: toBase64(content),
        branch,
        ...(sha ? { sha } : {})
      })
    });
    if (!response.ok) {
      throw new Error(await gitHubErrorMessage(response));
    }
    showToast(`📤 ${label} をGitHubへpushしました`);
  } catch (e) {
    showToast(`push失敗: ${e.message}`);
  }
}

// generateReport の最後で自動 push する(設定で auto なら)
// v51: 引数(dateArg / quiet)と戻り値を素通しする。以前は握りつぶしていたため、
//      任意日・quiet 指定の生成が常に「selectedDate・画面遷移あり」になっていた。
//      quiet(バックグラウンド生成)のときは自動 push もしない。
const _originalGenerateReport = generateReport;
generateReport = function(dateArg, opts = {}) {
  const result = _originalGenerateReport(dateArg, opts);
  const cfg = state.settings.github;
  if (!opts.quiet && cfg?.autoSave && personalDataReady(cfg)) {
    const date = dateArg || state.selectedDate;
    const report = state.reports[date];
    if (report) {
      pushFileToGitHub(`日報_${date}.md`, report, `日報 ${date}`);
    }
  }
  return result;
};

// 日付変更時に AI フィードバックを再 fetch
const _originalSetSelectedDate = setSelectedDate;
setSelectedDate = function(date) {
  _originalSetSelectedDate(date);
  hydrateStaticMarkdown();
};

// ============================================================
// 実績登録モーダル (v7) — タイムラインの○ボタンから呼ばれる
// ============================================================

function completeBlockWithActual(blockId) {
  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) return;
  // 予定をデフォルトに、なければ現在時刻
  const defaultStart = block.actualStartAt || block.plannedStartAt || nowDateTime();
  const defaultEnd = block.actualEndAt || block.plannedEndAt || nowDateTime();
  state.modal = { type: "actualEntry", id: blockId };
  renderModal(buildActualEntryModal(block, defaultStart, defaultEnd));
}

function buildActualEntryModal(block, defaultStart, defaultEnd) {
  // v41: 充電/放電プリフィル(過去実績の中央値)。注記は付けない — 静かに入っているだけ。
  const pf = prefillEnergy(block);
  const chargeSel = pf ? pf.charge : (block.charge || 0);
  const dischargeSel = pf ? pf.discharge : (block.discharge || 0);
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">✅ 実績を登録</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div style="background:var(--green-soft); padding:10px; border-radius:8px">
          <strong>${escapeHTML(block.title)}</strong>
          <div class="muted" style="font-size:12px; margin-top:4px">
            予定: ${block.plannedStartAt ? timeFromDateTime(block.plannedStartAt) : "未定"}${block.plannedEndAt ? `-${timeFromDateTime(block.plannedEndAt)}` : ""}
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">実績開始</label>
            <input class="input" type="datetime-local" step="300" data-modal-field="actualStartAt" value="${toLocalInput(defaultStart)}">
          </div>
          <div class="field">
            <label class="field-label">実績終了</label>
            <input class="input" type="datetime-local" step="300" data-modal-field="actualEndAt" value="${toLocalInput(defaultEnd)}">
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">充電 (0-5)</label>
            <select class="select" data-modal-field="charge" data-modal-kind="number">
              ${rangeOptions(0, 5, chargeSel)}
            </select>
          </div>
          <div class="field">
            <label class="field-label">放電 (0-5)</label>
            <select class="select" data-modal-field="discharge" data-modal-kind="number">
              ${rangeOptions(0, 5, dischargeSel)}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field-label">コメント</label>
          <textarea class="textarea" data-modal-field="comment" style="min-height:80px" placeholder="所感、振り返りなど">${escapeHTML(block.comment || "")}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-action="modal-close">キャンセル</button>
        <button class="btn green" data-action="modal-save">完了として登録</button>
      </div>
    </div>
  `;
}

function saveActualEntryFromModal(blockId, fields) {
  state.blocks = state.blocks.map((b) => {
    if (b.id !== blockId) return b;
    return {
      ...b,
      actualStartAt: fromLocalInput(fields.actualStartAt),
      actualEndAt: fromLocalInput(fields.actualEndAt),
      charge: Number(fields.charge) || 0,
      discharge: Number(fields.discharge) || 0,
      comment: fields.comment || "",
      completed: true,
      updatedAt: nowDateTime()
    };
  });
  // Task の状態を doing に
  const block = state.blocks.find((b) => b.id === blockId);
  if (block?.taskId) {
    state.tasks = state.tasks.map((t) =>
      t.id === block.taskId && t.status === "todo"
        ? { ...t, status: "doing", updatedAt: nowDateTime() }
        : t
    );
  }
  closeModal();
  // 実績モードに切り替えて表示
  state.timelineMode = "actual";
  saveAndRender("✅ 実績を登録しました");
}

// ============================================================
// v41: =========================================================
//  自動化(実行系の質改善)— 搬送は自動化、判断は自動化しない。
// =========================================================

// §2 日次オープン: 日付が変わって最初の起動/復帰でルーティンを自動展開。
//   展開の冪等性は maintainRecurrences 側(recurrenceGroupId×date 既存なら skip)で担保。
//   変えた日を lastOpenedDate に記録。新しい日を検出したら true を返す。
function runDailyOpen({ force = false } = {}) {
  const today = todayISO();
  const isNewDay = state.settings.lastOpenedDate !== today;
  if (!force && !isNewDay) return false;
  maintainRecurrences({ purge: true });  // 既存の展開ロジックを流用
  if (isNewDay) {
    state.settings.lastOpenedDate = today;
    // v85: 日をまたいでの復帰(前回操作日から暦日が変わった)は、閲覧中の日付を「今日」へ戻す。
    // ここはvisibilitychange復帰時にも通る唯一の日跨ぎ検知ポイントなので、起動時リセット(モジュール
    // 末尾)と合わせてこの1箇所だけで「各タブは基本的に今日を表示」の(a)(b)を満たす。
    // セッション中に日をまたがずに行った意図的な日付移動(date-prev/date-next等)はここを通らない
    // ため上書きされない((c)を維持)。
    state.selectedDate = today;
    ensureJournal(today);
    saveState();  // 実データ変更(dataModifiedAt 更新)
  }
  return isNewDay;
}

// §3 見込み終了時刻 -------------------------------------------------
function _energyMedian(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
function _actualDurationMin(b) {
  if (!b.actualStartAt || !b.actualEndAt) return null;
  const d = minutesOf(b.actualEndAt) - minutesOf(b.actualStartAt);
  return d > 0 ? d : null;
}
// 見積の解決順: ①手入力 estimateMin → ②同 recurrenceGroupId の過去実績中央値 → ③30分
function resolveEstimateMin(block) {
  if (Number.isFinite(block.estimateMin) && block.estimateMin > 0) return block.estimateMin;
  if (block.recurrenceGroupId) {
    const past = state.blocks
      .filter((b) => !b.deleted && b.completed && b.recurrenceGroupId === block.recurrenceGroupId && b.id !== block.id)
      .map(_actualDurationMin).filter((v) => v != null);
    const med = _energyMedian(past);
    if (med) return med;
  }
  return 30;
}
// 見込み終了(分)= 今 + Σ(残りブロックの残見積)
function computeProjectedEnd(dateISO, nowMin) {
  let sum = 0;
  blocksForDate(dateISO).filter((b) => !b.completed).forEach((b) => {
    const est = resolveEstimateMin(b);
    if (b.actualStartAt) {
      const elapsed = Math.max(0, nowMin - minutesOf(b.actualStartAt));  // 着手中は残りのみ
      sum += Math.max(0, est - elapsed);
    } else {
      sum += est;  // 未着手は満額
    }
  });
  return nowMin + sum;
}
// テキスト部分だけ返す(毎分の textContent 差し替えで使う)。残なし/今日以外は空。
function projectedEndText() {
  const today = todayISO();
  if (state.selectedDate !== today) return "";
  const remaining = blocksForDate(today).filter((b) => !b.completed);
  if (!remaining.length) return "";
  const now = new Date();
  const end = computeProjectedEnd(today, now.getHours() * 60 + now.getMinutes());
  const hh = Math.floor((end % 1440) / 60);
  const mm = end % 60;
  const over = end >= 1440 ? "翌" : "";
  return `見込み終了 ${over}${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
// 表示要素(色分け・警告なし。有限性を時刻で見せるだけ。CONCEPT §4.8）
function projectedEndBadge() {
  const t = projectedEndText();
  return t ? `<span class="projected-end" id="projected-end">${t}</span>` : `<span class="projected-end" id="projected-end"></span>`;
}
// 毎分ティックで該当 span のみ差し替え(全再描画しない=入力フォーカス破壊防止)
function updateProjectedEndTick() {
  const el = document.getElementById("projected-end");
  if (el) el.textContent = projectedEndText();
}

// v144レビュー対応: エネルギーバッテリーは時間経過(減衰)だけで値が変わるため、render()の
// きっかけ(Block操作等)が無いまま時間が過ぎると電池チップ・タイムライン実カーブの表示が
// 凍ったままになる。startTimerTicker(500ms周期)に載せて軽量な差分更新をするが、減衰は
// 1時間3程度の緩やかな変化のためBATTERY_TICK_INTERVAL_MS(既定1分)でスロットルする。
// 全再描画(render())はしない — 検索入力のフォーカス・IME入力中の状態を飛ばさないため、
// 該当要素(.home-today-status / .energy-graph-overlay)だけをouterHTMLで差し替える。
// v147レビュー対応: 旧実装は`.home-battery-chip`だけを差し替えており、それを包む
// `.home-today-status`(homeFoldSectionの<summary>、常時表示の「残量N」要約)は初回描画時の
// まま凍っていた。カード全体をouterHTMLで差し替える(homeFoldSectionはlocalStorageの
// fold開閉状態(isHomeFoldOpen)を再読込するため、開閉状態は自然に保持される)。さらに、
// 全て良好でカード自体が非表示だった場合でも、電池残量が減衰でBATTERY_OK_PCTを割った
// 可能性があるため、その場合だけ全再描画(renderDeferringForFocus)で初めてカードを出す。
function updateBatteryTick() {
  if (Date.now() - _lastBatteryTickAt < BATTERY_TICK_INTERVAL_MS) return;
  _lastBatteryTickAt = Date.now();
  if (state.selectedDate !== todayISO()) return;
  // v145: 残量が閾値を下回った時点で回復Block下書きを1回だけ静かに提案する(opt-in・冪等)。
  // 冪等ガードは関数内部(state.batteryRecoveryDraftDates)にあり、新規追加時のみtrueが返る。
  // 新規下書き追加(1日高々1回)は draft-layer/draft-bar という新しいDOMを出す必要があるため、
  // このtickに限り再描画するが、検索入力・IME変換中を壊さないよう既存の
  // renderDeferringForFocus()(v137/v140、focusout/compositionendまで延期+60秒フェイルセーフ)
  // を使う(v145レビュー対応: render()直呼びをやめた)。
  {
    const now = new Date();
    if (maybeSuggestRecoveryDraft(now.getHours() * 60 + now.getMinutes())) { renderDeferringForFocus(); return; }
  }
  // v149レビュー対応(必須1): 「今日の状態」カード(.home-today-status)は今日タブにしか
  // 存在しないため、ホームタブ滞在中はstatusCardが常にnullになり、残量40%未満の間
  // else if分岐(renderDeferringForFocus)が毎分発火し続けてしまう(宣言入力等を脅かす)。
  // 今日タブ滞在中だけに絞る。
  if (state.currentView === "home" && homeTab === "today") {
    const statusCard = document.querySelector(".home-today-status");
    if (statusCard) {
      statusCard.outerHTML = homeTodayStatusCard();
    } else if (!computeHomeBatteryInfo(state.selectedDate).ok) {
      // 「今日の状態」カードが非存在(=前回描画時は全て良好で非表示だった)のに、
      // 電池残量が閾値を割った → カードを新たに出す必要があるため全再描画する。
      renderDeferringForFocus();
    }
  } else if (state.currentView === "timeline") {
    const layer = document.querySelector(".energy-graph-overlay");
    if (layer) {
      const allBlocks = blocksForDate(state.selectedDate);
      const rowHeight = 60 * (state.timelineZoom || 1);
      layer.outerHTML = renderEnergyGraph(allBlocks, rowHeight, 5, 24);
    }
  }
}

// §3b 1日バッファ+消化率メーター(v116) ------------------------------
// ROADMAP「TOC由来の提案E」。クリティカルチェーン法の個人適用: 各Blockの見積もりに
// 個別の安全余裕を足すと学生症候群・パーキンソンの法則で消えるため、余裕は1日末尾の
// バッファ1つに集約し、個々の遅れではなく「バッファ残量」という1つの数字だけを見る。
// 残量 = バッファサイズ − Σ(当日の完了Blockの 実績時間 − 見積時間)。
// 集計対象は通常のタイムラインBlockのみ(ルーティン・保護系は対象外。v114のprotection
// 集計除外と同じ思想: 保護系は実行率/バッファ消化で裁く対象ではない)。
// 見積(estimateMin、resolveEstimateMinのフォールバック値は使わない生の手入力値)か
// 実績(actualStartAt/actualEndAt)のどちらか一方でも欠けているBlockは集計から除外する。
function computeBufferRemaining(dateISO) {
  const bufferMinRaw = state.settings.dailyBufferMin;
  const hasBuffer = Number.isFinite(bufferMinRaw) && bufferMinRaw > 0;
  const usedMin = blocksForDate(dateISO)
    .filter((b) => !b.deleted && b.completed && b.category !== "ルーティン")
    .reduce((sum, b) => {
      const est = b.estimateMin;
      if (!Number.isFinite(est) || est <= 0) return sum;  // 見積無しは除外
      const actual = _actualDurationMin(b);
      if (actual == null) return sum;  // 実績無しは除外
      return sum + (actual - est);
    }, 0);
  if (!hasBuffer) {
    return { hasBuffer: false, bufferMin: 0, usedMin, remainingMin: null, percent: null };
  }
  const remainingMin = bufferMinRaw - usedMin;
  const percent = Math.round((remainingMin / bufferMinRaw) * 100);
  return { hasBuffer: true, bufferMin: bufferMinRaw, usedMin, remainingMin, percent };
}
// 3段階の色分け(残40%以上=緑/40%未満=黄/0以下=赤)。バッファ未設定はunset。
function bufferMeterLevel(percent) {
  if (percent === null || percent === undefined) return "unset";
  if (percent <= 0) return "red";
  if (percent < 40) return "yellow";
  return "green";
}
// ヘッダーの1行常時表示。「今日」を表示中の時だけ出す(過去日・未来日を振り返る文脈には
// 出さない。当日の残量が「今やばいか」を判断する材料であるという性質上、v114の連続欠落
// バッジ〈常に今日基準〉と同じく「今日固定」の情報として扱う)。
// v116(K追加要件、2026-07-16・計画過積載ガード): 「積む余裕なくタスクを詰め込んだら
// バッファの意味がない」ため、バッファメーター(実行中の消化率の見える化)とは別に、
// 計画段階で1日を見積もりで埋め尽くしていないかを検出する。自動でタスクの削除・移動・
// 並べ替えは一切しない(検出して知らせるだけ。既存の朝プラン・下書き機構の挙動も変えない)。
// 可処分枠 = 「1日の締め時刻」(state.settings.dayCloseHours、既定24=24:00) −
// 「その日最初に予定時刻を持つBlockの開始時刻」(予定時刻を持つBlockが無ければ0時=
// 丸1日を可処分枠として扱う)。見積合計はresolveEstimateMin(手入力優先、無ければ過去
// 実績中央値→30分既定)を使い、完了/未完了を問わず当日の通常Block(ルーティン除く)
// 全件を対象にする(「計画時点の総荷重」を見るため、実行済みかどうかは関係ない)。
// バッファ自体が未設定(hasBuffer=false)の日は判定しない(何と比べて過積載かが決まらない)。
function computeDailyOverload(dateISO) {
  const bufferInfo = computeBufferRemaining(dateISO);
  if (!bufferInfo.hasBuffer) return { overloaded: false, shortfallMin: 0 };
  const blocks = blocksForDate(dateISO).filter((b) => !b.deleted && b.category !== "ルーティン");
  if (!blocks.length) return { overloaded: false, shortfallMin: 0 };
  const estimateTotal = blocks.reduce((sum, b) => sum + resolveEstimateMin(b), 0);
  const starts = blocks
    .map((b) => (b.plannedStartAt ? minutesOf(b.plannedStartAt) : null))
    .filter((v) => Number.isFinite(v));
  const earliestStartMin = starts.length ? Math.min(...starts) : 0;
  const closeMin = Number.isFinite(state.settings.dayCloseHours) && state.settings.dayCloseHours > 0
    ? state.settings.dayCloseHours * 60 : 24 * 60;
  const availableMin = Math.max(0, closeMin - earliestStartMin);
  const shortfall = Math.round((estimateTotal + bufferInfo.bufferMin) - availableMin);
  return { overloaded: shortfall > 0, shortfallMin: Math.max(0, shortfall) };
}

// v146(UI改善計画Phase1-4): バッファ残量帯は「今日を扱う」画面だけに限定する(UX監査N3。
// 設定・計器盤・その他等の無関係画面から常時26px帯を消す)。
const BUFFER_METER_VIEWS = ["home", "tasks", "timeline", "journal", "reports"];
function bufferMeterHTML() {
  if (!BUFFER_METER_VIEWS.includes(state.currentView)) return "";
  if (state.selectedDate !== todayISO()) return "";
  const info = computeBufferRemaining(state.selectedDate);
  // v146レビュー対応(計画1-4の明記事項): 未設定時は帯自体を出さない(空文字を返す)。
  // 設定への導線は設定画面内の「⏳ 1日バッファ」パネルの説明文で維持しているため、
  // 全画面ヘッダーへ「設定してください」の常時帯を出す必要はない。
  if (!info.hasBuffer) return "";
  const overload = computeDailyOverload(state.selectedDate);
  if (overload.overloaded) {
    // 第4状態(灰色): 通常の緑/黄/赤の代わりに「計画時点でバッファ未確保」を表示する。
    // 責めないトーン(v93 homeRoutineCheckBannerと同じ文体)で提案するだけに留める。
    return `
      <div class="buffer-meter overload" data-buffer-level="overload" data-overload-shortfall="${overload.shortfallMin}">計画時点でバッファ未確保(${overload.shortfallMin}分不足)</div>
      <div class="buffer-overload-hint">見積もりが1日の枠を超えています。タスクを減らすか、見積もりを見直しませんか</div>
    `;
  }
  const level = bufferMeterLevel(info.percent);
  return `<div class="buffer-meter ${level}" data-buffer-level="${level}" data-buffer-percent="${info.percent}" data-buffer-remaining="${info.remainingMin}">バッファ残量 ${info.percent}%(${info.remainingMin}分)</div>`;
}

// §4 充電/放電プリフィル -------------------------------------------
// 過去実績(直近8週・3件以上)の中央値を初期値に。満たなければ null(既定値のまま)。
function prefillEnergy(block) {
  const since = addDays(todayISO(), -56);
  const pool = (pred) => state.blocks.filter((b) =>
    !b.deleted && b.completed && b.id !== block.id && b.date >= since && pred(b));
  const src = block.recurrenceGroupId
    ? pool((b) => b.recurrenceGroupId === block.recurrenceGroupId)
    : pool((b) => b.title && b.title === block.title);
  if (src.length < 3) return null;
  return {
    charge: _energyMedian(src.map((b) => Number(b.charge || 0))),
    discharge: _energyMedian(src.map((b) => Number(b.discharge || 0)))
  };
}

// v38: 起動処理 — 必ずモジュール末尾で実行する。
// これより上のすべての関数・const が初期化済みであることを保証するため。
// (以前はファイル先頭付近で render() していて、ジャーナル画面を開いたまま
//  再起動すると JOURNAL_PROMPTS 未初期化の例外でアプリ全体が起動不能だった)
// ============================================================
// v85: 各タブは基本的に「今日」を表示する(K報告: 過去日を見たまま離脱すると次回起動も
// 過去日のままだった)。永続化された selectedDate(前回セッションの閲覧日)をそのまま初期表示に
// 使わず、起動時は必ず todayISO() へ強制する。セッション中にユーザーが意図的に日付移動した場合
// (date-prev/date-next/日付ピッカー)はそのまま尊重し続ける — ここでのリセットは起動直後の
// 一度きりで、以後はrunDailyOpen()の「日をまたいだ場合」のみが再度リセットする(下記参照)。
state.selectedDate = todayISO();
ensureJournal(state.selectedDate);
persistLocalNoSchedule();

ensurePassivePomodoro();
// v151: テーマ設定が"auto"のとき、アプリを開いたままOSの外観(ライト/ダーク)が切り替わったら
// 追従する(iOS設定アプリからの変更・日没での自動切替など)。addEventListenerが無い古いWebKitへの
// フォールバックとしてaddListenerも試す(iOS Safariの実機バリエーション対策)。
if (window.matchMedia) {
  const _themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const _onOsThemeChange = () => { if (state.settings.theme === "auto") applyTheme(); };
  if (_themeMediaQuery.addEventListener) _themeMediaQuery.addEventListener("change", _onOsThemeChange);
  else if (_themeMediaQuery.addListener) _themeMediaQuery.addListener(_onOsThemeChange);
}
// v23/v41: 起動時に繰り返し Block を実体化(期間外・未編集は破棄)+ 日次オープン記録
runDailyOpen({ force: true });
render();
hydrateStaticMarkdown();
registerServiceWorker();
startTimerTicker();
// v25/v43: 起動後の pull。自動同期 ON なら v43 の pull(競合バナー付き)、OFF なら従来の起動時同期。
if (state.settings.autoSync) runAutoSyncPull();
else syncFromGitHubOnStartup();
// v59: 朝の一括プランニングの自動下書き(opt-in・既定OFF)。起動直後は同期(pull)に少し譲ってから実行する。
// v145レビュー対応: 回復Block下書き提案(下記)は朝プランの非同期処理(AIプランJSONのfetch等)と
// _scheduleDraftを取り合うため、同時に走らせず「朝プランの完了を待ってから」評価するよう
// 1本のsetTimeoutへ連鎖させた(以前は独立した2本のsetTimeout(4500ms/5000ms)で、朝プランの
// fetchがわずかに長引くと回復提案が先に走り、後から朝プランが_scheduleDraftを上書きして
// 提案だけ消える一方、冪等マーカーは焼けたままになる事故があった)。
setTimeout(() => {
  const morningPlanPromise = maybeAutoMorningPlan();
  // v145: 残量低下時の回復Block下書き提案(opt-in・既定OFF)。起動直後にも1回チェックする
  // (アプリを開いたまま日をまたいだ後の初回起動や、当日最初の起動時点で既に残量が閾値を
  // 下回っているケースに対応。以後はupdateBatteryTick経由のティッカーが1分間隔で見る)。
  const checkRecoveryDraft = () => {
    if (state.selectedDate !== todayISO()) return;  // v145レビュー対応: ティッカー側と対称のガード
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (maybeSuggestRecoveryDraft(nowMinutes)) { renderDeferringForFocus(); return; }
    // v150(UI改善計画Phase4b・S7): 今回の起動で新規に発火しなかった場合だけ、
    // 「前回セッションで発火済み(マーカーあり)なのにPWA破棄でdraftが消えた」パターンを
    // 起動時に1回だけ検知して再構築する(maybeRebuildRecoveryDraft参照)。
    if (maybeRebuildRecoveryDraft(nowMinutes)) renderDeferringForFocus();
  };
  // maybeAutoMorningPlanが実際に起動した場合のみPromiseが返る(起動条件を満たさなければnull)。
  // その場合は朝プランの完了(_scheduleDraft確定 or 何もせず終了)を待ってから評価する。
  if (morningPlanPromise && typeof morningPlanPromise.then === "function") {
    morningPlanPromise.then(checkRecoveryDraft);
  } else {
    checkRecoveryDraft();
  }
}, 4500);
// v53: 自動アーカイブ(既定ON・1日1回)。同期・自動レビューの後に静かに実行。
setTimeout(maybeAutoArchive, 8000);
// v41/v43: 復帰時。自動同期 ON なら pull(内部で日次オープン)、OFF なら日次オープンのみ。
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (state.settings.autoSync) runAutoSyncPull();
  else if (runDailyOpen()) render();
  setTimeout(maybeAutoMorningPlan, 4500);    // v59: 日をまたいで復帰したケース
  setTimeout(maybeAutoArchive, 8000);        // v53: 同上
  maybeRefreshFeedback();                    // v77: フォアグラウンド復帰時にAIフィードバック等を再fetch
});

// v143: data-feedback-date欄への貼り付けで取込モーダルを開くpasteリスナー(v42)は削除した。
// v141で該当欄自体を撤去して以来、イベントが発火しようがない到達不能コードだったため
// (CHANGES_v143.md参照)。
