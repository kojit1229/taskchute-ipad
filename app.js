// v164: app.js分割・段階1(最初の抽出)。純粋関数はsrc/core/**へ抽出し、依存グラフの葉として
//   importする(src/core/**はstateを一切参照しない。claude-review-result.md §7の契約)。
import { mergeById, mergeByIdPreferNewer } from "./src/core/merge.js";
import {
  activeTrackForProject, dateParts, isProjectInCurrentCycle, latestMeasurement, numericGoalReached,
  paceMilestone, paceNumeric, trackStatus, daysBetween as trackDaysBetween,
  validateTrackDraft, trackDefinitionChanged, weeklyScore
} from "./src/core/track.js";
// v166: app.js分割・段階3(state store + storage/sync gateway)。stateの再代入はsetState()
//   経由のみ(claude-review-result.md §2 Blocker-1)。store.jsは何もimportしない真の葉。
import { state, setState } from "./src/state/store.js";
// loadState/persistLocalNoScheduleはsrc/storage/local.jsへ抽出済み。saveStateはscheduleAutoSave等
// app.js側の多数の関数へ依存するためapp.js側に残す(src/storage/local.js冒頭コメント参照)。
import { loadState, persistLocalNoSchedule, _lastSaveError } from "./src/storage/local.js";
// cachedFeedbackはHomeの「AIから」カードが使う共有キャッシュ
// (src/state/feedback-cache.js冒頭コメント参照)。
import { cachedFeedback } from "./src/state/feedback-cache.js";
// v223: TOWER上帯(STANDING ORDERS/COUNTDOWN)は自己完結featureへ依存注入する。
import { configureTopband, cycleWeekForDate } from "./src/features/topband.js";
// v233: P4第2弾。v232で配置済みのIRON LOG/INSTRUMENTSを画面結線する。
import {
  configureIronLog, renderIronLog, linkedGymBlock, gymCommentSummary, runIronImport
} from "./src/features/iron-log.js";
import { configureInstruments, renderInstruments } from "./src/features/instruments.js";
import { configureTrackUi, maybeShowTrackProgressToast } from "./src/features/track-ui.js";
// v182: 新トップレベル「今日」コックピット。既存featureと同じ依存注入型で循環importを避ける。
import { configureToday, renderToday } from "./src/features/today.js";
// v168: app.js分割・段階4-2(WishタブTier1のCRUD・描画を抽出)。src/features/wish.js
//   はstateをimportするがapp.js自身はimportしない(循環import回避)。
//   getWishProjectはapp.js側の週次Wish選定からも共有importする。
import {
  configureWish,
  getWishProject, renderWish,
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
  setMorningEnergy, toggleConditionMeds, setConditionCapacity, setEveningMood,
  addGymEntry, deleteGymEntry,
  openStoreVisitEditor, openStoreVisitsYearModal, deleteStoreVisitWithConfirm,
  saveStoreVisitFromModal, deleteStoreVisit
} from "./src/features/journal.js";
import {
  configureRecurrence,
  routineRate, createRecurrenceRule, maintainRecurrences,
  triggerAnchorPlacements, anchorCandidateOptions
} from "./src/core/recurrence.js";
// v171: app.js分割・段階4-5(タイムライン抽出・段階A: 純粋レーン割付計算のみ)。
//   src/features/timeline-layout.jsはstateもDOMも参照しない引数のみの純粋関数だが、
//   minutesOf/nowDateTime(いずれもapp.js側の汎用ヘルパー)を呼ぶためconfigureTimelineLayout(deps)
//   による依存注入で受け取る(src/features/timeline-layout.js
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
//   変数を露出させず新設のscheduleDraftActive()経由でDIする。updateBatteryTick(app.js残留)からの
//   renderEnergyGraph呼び出しは、この
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
// v178: 段階5-8。submitModal/deleteFromModalのstate.modal.typeによるif-else連鎖(project/task/
//   block/actualEntry/question/experiment/storeVisit)をregisterModalHandlerへ
//   全件移行するため、registerModalHandlerをimportに追加する(prep-stage5-dispatcher.md §5)。
import {
  registerActions, dispatchAction,
  registerModalHandler, dispatchModalSave, dispatchModalDelete
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

// v152で追加された仕分け履歴データの同期上限。UI削除後も既存データ互換のため保持する。
// v166: configureGithubSync()(このすぐ下の起動処理)がこの定数を参照するため、元の宣言位置
// (5416行目付近、computeSyncMerge内で使う箇所の近く)からファイル冒頭へ移動した
// (constのTDZ回避。値・用途は一切変更していない)。
const SWIPE_TRIAGE_LOG_MAX = 200;
// v201: AIコーチ食事ログは90日保持に加え、端末内の最大件数も制限する。
const COACH_MEALS_MAX = 500;

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// v100: AI提案お題キュー(zeroThinking.suggestedThemes)のハウスキーピングTTL。
//       採用されないまま溜まり続けるのを防ぐため、読み込み時(normalizeState)に物理削除する
//       (2026-07-15 K指示)。adopted/dismissedは履歴表示しないため7日で消してよい判断
//       (採否の学習利用が将来必要になれば別ログへ再設計する。CHANGES_v100.md参照)。
const ZT_SUGGESTION_PENDING_TTL_MS = 3 * 24 * 60 * 60 * 1000;   // pending: 3日(72時間)
const ZT_SUGGESTION_RESOLVED_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // adopted/dismissed: 7日

// v193: オンデマンド再プランはセッション限定のメールボックス監視。永続stateを増やさず、
// requestId一致の応答だけを最長15分・60秒間隔で受け取る。
const REPLAN_POLL_MS = 60 * 1000;
const REPLAN_TIMEOUT_MS = 15 * 60 * 1000;
let _replanPending = null;
let _replanPollTimer = null;
let _replanPollBusy = false;
let _replanUi = { kind: "idle", message: "残り時間の計画をAIへ依頼できます" };
// v229: GATE編集モードは画面状態だけなので永続stateへ混ぜず、セッション内だけ保持する。
let _towerGateEditMode = false;

// v196: 実行計画の叩き台をAIに作らせる(第2弾b)。ファイル契約はplan-request.json/
// plan-response.json(personal-data taskchute/requests/配下)。ポーリング機構はv193再プランと
// 同じ作法(即時1回はしない・60秒間隔・最長15分)をそのまま流用する。承認までapp-state.jsonは
// 一切書かない(下書きはセッション限定・非永続)。
const PLAN_STEP_POLL_MS = 60 * 1000;
const PLAN_STEP_TIMEOUT_MS = 15 * 60 * 1000;
let _planStepPending = null;   // { requestId, taskId, startedAtMs }
let _planStepPollTimer = null;
let _planStepPollBusy = false;
let _planStepDraft = null;     // { requestId, taskId, steps, generatedAt } 検証済みのみ保持
let _planStepUi = { kind: "idle", message: "", taskId: "" };

// v198(第3弾3e): 完了トリガー→引き継ぎシートの一時状態(いずれも非永続)。
// _aiStepPendingは「確認シート表示中(1件ロック)」の意味に限定する(request送信済みの追跡は
// aiStepRequestId/aiStepPendingRequests(3d実装済み・永続)が担うため、この変数を重複させない)。
let _aiStepPending = null;       // { stepTaskId, nextStepTaskId }
let _aiStepConfirmCtx = null;    // { stepTaskId, nextStepTaskId } 非永続

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

// v217: 振り返り系の専用3ビューを削除し、週次レビューはAIレポートに集約。
const navItems = [
  { id: "today", label: "今日", mark: "▶" },
  { id: "tasks", label: "タスクシュート", mark: "T" },
  { id: "timeline", label: "タイムライン", mark: "L" },
  { id: "wbs", label: "WBS", mark: "W" },
  { id: "journal", label: "ジャーナル", mark: "J" },
  { id: "ai-reports", label: "AIレポート", mark: "A" },  // v92: コンテンツ総括・自己分析等の月次/不定期AIレポートビューア
  { id: "wish", label: "やりたい", mark: "✦" },
  { id: "vision", label: "ビジョン", mark: "V" },
  { id: "zero", label: "0秒思考", mark: "○" },
  { id: "settings", label: "設定", mark: "S" }
];

// v82: UX監査B1 — 日課動線(朝: ホーム→ジャーナルで体調記録)を1タップにするため、
//      不定期にしか触らないWBSを「その他」へ降ろし、ジャーナルをbottom-navへ昇格した。
//      WBSはrenderMore(その他グリッド)の受け皿に含まれる(除外リストから外すだけで自動的に出る)。
const mobileNav = [
  { id: "today", label: "今日" },
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
// v234: normalizeState後に一度だけ過去のジムBlockコメントをIRON LOG累計へ移行する。
// doneをlocalStorageへ即時保存し、起動を繰り返しても再集計しない。
if (!state.ironImport.done) {
  runIronImport(state);
  persistLocalNoSchedule();
}
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
configureToday({
  escapeHTML, todayISO, blocksForDate, minutesOf, timeFromDateTime,
  localDateTimeToMs, resolveEstimateMin,
  clamp, isStaleBlock, isTaskDead, renderDeferringForFocus,
  renderCircularProgress, remainingText, remainingTextNormal,
  renderPomodoroInterruptControls,
  syncAlertBanner,
  renderAtisPanel,
  gateEditMode: () => _towerGateEditMode
});
configureTopband({
  escapeHTML,
  todayISO,
  getSettings: () => ({
    twelveWeekStartDate: state.settings.twelveWeekStartDate,
    birthDate: state.settings.birthDate
  })
});
configureTrackUi({ escapeHTML, todayISO, saveAndRender, generateReport, recordTrackMeasurement });
configureIronLog({
  getState: () => state,
  escapeHTML, todayISO, renderHeader, saveAndRender, registerActions
});
configureInstruments({
  getState: () => state,
  escapeHTML, todayISO, addDays, weekRange, renderHeader,
  // モジュールの凍結action名を保ち、プレースホルダだけ統合層の実遷移へ差し替える。
  registerActions: (handlers) => registerActions({
    ...handlers,
    "instruments-open-iron-log": () => setView("iron-log")
  })
});
// v168: src/features/wish.jsも同じ理由(循環import回避)で依存注入する。
configureWish({
  escapeHTML, renderHeader, todayISO, localDateTimeToMs, makeTask, makeBlock,
  defaultPlannedTimes, showToast, nowDateTime, saveAndRender, render, updateTaskField,
  aiInsightsPanelHTML,
  maybeQueueNextAiStep  // v198(第3弾3e): 完了6経路#6(Wish詳細のサブタスクチェックボックス)
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
// v218: getStateでstore.jsのstate再代入後も最新のlive bindingへ追従させる。
configureRecurrence({
  todayISO, addDays, parseDate, minutesOf, pad2, nowDateTime, showToast, isTouchedBlock,
  RECURRENCE_KEEP_PAST_DAYS, RECURRENCE_FUTURE_DAYS,
  getState: () => state
});
// v171: src/features/timeline-layout.jsも同じ理由(循環import回避)で依存注入する。
configureTimelineLayout({ minutesOf, nowDateTime });
// v175: src/features/timeline.jsも同じ理由(循環import回避)で依存注入する。timelineRail/app
// (起動時に1回だけdocument.querySelectorした固定DOM参照)はtimelineRailEl/appRootElとして渡す。
configureTimeline({
  escapeHTML, getCategoryColor, migrationBadgeHTML, leverageTypeMarkHTML,
  minutesOf, todayISO, pad2, clamp, formatDisplayDate, computeProjectedEnd, resolveEstimateMin,
  renderHeader, renderDateBar,
  defaultBatterySettings, batteryCurvePoints, conditionBudget,
  draftBarHTML, zeroSecThemeBarHTML, draftRejectReasonPickerHTML, renderDraftLayer,
  scheduleDraftActive, render, blocksForDate, postponeBlockToNextDay,
  makeBlock, getOtherTask, openBlockEditor, saveState, isStaleBlock,
  timelineRailEl: timelineRail, appRootEl: app
});
// v222: 設定へ残したAI再プランactionもapp.js側のレジストリで管理する。
// v174: app.js分割・段階5-3(残ドメインのaction相乗り移行)。settings(12)+sync(8)+core/nav(1)の
// 計20分岐を、click dispatcherのif連鎖からregisterActions経由のレジストリへ移行した
// (prep-stage5-dispatcher.md §4の相乗り方式。この20件はまだsrc/features/へ抽出されていない
// ため、ハンドラは既存のapp.js関数・module変数をそのまま参照する形で登録する。ロジック自体は
// if連鎖からの機械的な移動のみで無改変)。
registerActions({
  "nav": ({ target }) => setView(target.dataset.view),
  "open-iron-log": () => setView("iron-log"),
  "departures-open-tomorrow": () => {
    setSelectedDate(addDays(todayISO(), 1));
    setView("tasks");
  },
  "today-replan": () => requestReplan(),
  "save-tower-journal": ({ target }) => {
    const date = target.dataset.date || todayISO();
    const free = document.getElementById("towerJournalFree");
    const ai = document.getElementById("towerJournalAi");
    if (!free || !ai) return;
    state.journals[date] = free.value;
    const meta = (state.journalMeta[date] ||= { aiMitCandidates: [], aiImported: false, ideal: "", aiTaskCandidates: [], aiRequest: "" });
    meta.aiRequest = ai.value;
    meta.textUpdatedAt = nowDateTime();
    saveAndRender("ジャーナルを保存しました");
  },
  "early-bird-check": () => toggleEarlyBird(),
  "tower-gate-edit-toggle": () => {
    _towerGateEditMode = !_towerGateEditMode;
    render();
  },
  "tower-gate-add": () => addTowerGate(),
  "tower-gate-delete": ({ target }) => endGateRecurrence(target.dataset.ruleId),
  "tower-gate-move": ({ target }) => moveTowerGate(target.dataset.ruleId, Number(target.dataset.direction)),
  // --- settings(12): サイドバー/WBS表示設定/カテゴリ・休憩メッセージ管理・AI再プラン ---
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
  // v189レビューL4: ALIGNMENT誘導→設定のマスタ群(既定閉・localStorage記憶)を開いて着地させる
  "vision-open-direct-settings": () => {
    setFoldOpen("settings-master", true);
    setView("settings");
  },
  "toggle-vision-direct-category": ({ target }) => {
    toggleVisionDirectCategory(target.dataset.category || "", target.checked);
  },
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
// v176: app.js分割・段階5-6a(journal系dispatcher分岐の移行・前半)。設計書§7どおり、
// journal系残ドメイン71件(見積り)のうち機械的に分割可能な単位として、0秒思考(22)+
// 週次レビュー/12週サイクル(14)の計36分岐だけを、click dispatcherのif連鎖からregisterActions
// 経由のレジストリへ移行した(prep-stage5-dispatcher.md §4の相乗り方式)。この36件はいずれも
// src/features/journal.jsへ未抽出(ハンドラ実体がapp.js残留)のため、v174(settings/sync/core)
// と同じくapp.js自身がregisterActionsを直接呼ぶ形をとる。ロジック自体はif連鎖からの
// 機械的な移動のみで無改変。問い(10)+その他(19)の計29分岐は、実行コード差分を200行以下に
// 収めるため次リリース(段階5-6b)へ分割し、今回はif連鎖に残したまま。
registerActions({
  // --- 0秒思考(22): zt-*/zero-tab/zerosec-theme-* ---
  "zt-add-toggle": () => {
    ztAddOpen = !ztAddOpen;
    render();
    if (ztAddOpen) setTimeout(() => document.querySelector("#zt-add-text")?.focus(), 60);
  },
  "zt-add-cancel": () => { ztAddOpen = false; render(); },
  "zt-add-submit": () => ztAddSubmit(),
  "zt-tab": ({ target }) => { ztTab = target.dataset.tab || "other"; render(); },
  "zt-fav-toggle": ({ id }) => ztToggleFav(id),
  "zt-importance-toggle": ({ id }) => ztToggleImportance(id),
  "zt-theme-delete": ({ id }) => deleteZtTheme(id),
  "zt-suggestion-adopt": ({ id }) => ztSuggestionAdopt(id),
  "zt-suggestion-dismiss": ({ id }) => ztSuggestionDismiss(id),
  "zt-group-add": () => ztGroupAdd(),
  "zt-group-rename": ({ id }) => ztGroupRename(id),
  "zt-group-delete": ({ id }) => ztGroupDelete(id),
  "zt-group-toggle": ({ id }) => ztGroupToggleOpen(id),
  "zt-write": ({ id }) => openZtWrite(id),
  "zt-save": () => saveZtEntry(),
  "zt-discard": () => discardZtWrite(),
  "zt-entry-open": ({ id }) => openZtEntry(id),
  "zt-edit-close": () => closeZtEdit(),
  "zt-edit-save": ({ id }) => saveZtEdit(id),
  "zero-tab": ({ target }) => {
    state.settings.zeroTab = target.dataset.tab || "theme";
    persistLocalNoSchedule();
    render();
  },
  "zerosec-theme-add": ({ target }) => decideZeroSecTheme(Number(target.dataset.idx), "added"),
  "zerosec-theme-skip": ({ target }) => decideZeroSecTheme(Number(target.dataset.idx), "skipped"),
  // v217: 週次提案の1件登録はAIレポートへ移設して継続する。
  "weekly-suggest-add": ({ target }) => addWeeklySuggestedTask(target.dataset.week, Number(target.dataset.index))
});
// v177: app.js分割・段階5-6b(journal系dispatcher分岐の移行・後半)。段階5-6a(v176、0秒思考+
// 週次/12週サイクルの36分岐)に続き、問い(10)+その他(日報生成・AIレポートビューア・
// AI連携・マイグレーション儀式・朝夜detailsトグル)を、click dispatcher
// のif連鎖からregisterActions経由のレジストリへ移行した(prep-stage5-dispatcher.md §4の
// 相乗り方式)。この29件もいずれもsrc/features/journal.jsへ未抽出(ハンドラ実体がapp.js残留)
// のため、v176と同じくapp.js自身がregisterActionsを直接呼ぶ形をとる。ロジック自体はif連鎖
// からの機械的な移動のみで無改変。これでjournal系残ドメイン(0秒思考+週次/サイクル+問い+
// その他)の計65分岐すべての移行が完了した。
registerActions({
  // --- 問い(10) ---
  "question-add": () => openQuestionEditor(""),
  "question-edit": ({ id }) => openQuestionEditor(id),
  "question-to-theme": ({ id }) => questionToTheme(id),
  "question-settle": ({ id }) => settleQuestion(id),
  "question-reopen": ({ id }) => reopenQuestion(id),
  "question-bridge": ({ id }) => openQuestionBridge(id),
  "question-bridge-submit": () => submitQuestionBridge(),
  "question-delete": ({ id }) => deleteQuestion(id),
  "entry-to-question": ({ id }) => entryToQuestion(id),
  "open-questions": () => { state.settings.zeroTab = "question"; persistLocalNoSchedule(); setView("zero"); },
  // --- その他: 日報/AIレポート/AI連携/マイグレーション儀式/朝夜detailsトグル ---
  "ai-report-type": ({ target }) => setAiReportType(target.dataset.type),
  "ai-report-refresh": () => refreshAiReports(),
  "open-future-letter": () => {
    state.settings.aiReportType = "letter";
    persistLocalNoSchedule();
    setView("ai-reports");
  },
  "ai-work-approve": ({ target }) => approveAiWorkResult(target.dataset.resultId),
  "ai-work-question": ({ target }) => raiseAiWorkQuestion(target.dataset.resultId),
  "ai-task-adopt": ({ target }) => adoptAiTaskCandidate(Number(target.dataset.index)),
  "ai-task-dismiss": ({ target }) => dismissAiTaskCandidate(Number(target.dataset.index)),
  "report-copy-ai": () => copyReportToClipboard(),
  "report-share-ai": () => shareReport(),
  "generate-report": () => {
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
  },
  "download-report": () => downloadReport(),
  "download-data": () => downloadData(),
  "carry-over": ({ id }) => requestCarryOver(id),
  "migration-ritual-choice": ({ target }) => resolveMigrationRitual(target.dataset.choice),
  "ideal-retry": ({ target }) => resolveIdealRetry(target.dataset.choice),
  "toggle-journal-segment": ({ target }) => {
    const seg = target.dataset.segment;
    const parent = target.closest("details");
    if (seg && parent) _journalSegmentOverride[seg] = !parent.open;  // クリック時点ではまだ未反映のため反転
  },
});
// v178: app.js分割・段階5-7a(modal系dispatcher分岐の移行・前半)。prep-stage5-dispatcher.md
// §2-Cの「WBS/Project/Task CRUD(18)」+モーダル起動系(modal-close/modal-delete/lev-judge、3)の
// 計21分岐を、click dispatcherのif連鎖からregisterActions経由のレジストリへ移行した
// (相乗り方式。project/task/blockはsrc/features/へ未抽出のためapp.js関数をそのまま参照する)。
// modal-saveは過去判定どおりreturn意味論(disable連動のearly return)がありif連鎖に残置する。
// 後半(ビジョンボード6+実験ログ5+AIスケジュール下書き8+検索2、計21)はv179以降で継続する。
function twyEditorCommitted(message) {
  generateReport(todayISO(), { quiet: true });
  saveAndRender(message);
}

registerActions({
  // --- WBS/Project/Task CRUD(18) ---
  "add-project": () => addProject(),
  "delete-project": ({ id }) => deleteProject(id),
  "add-task": () => addTask(),
  "toggle-task": ({ id }) => toggleTask(id),
  "delete-task": ({ id }) => deleteTask(id),
  "toggle-project-collapse": ({ id }) => toggleProjectCollapse(id),
  "toggle-task-collapse": ({ id }) => toggleTaskCollapse(id),
  "suspend-project": ({ id }) => suspendProject(id),
  "resume-project": ({ id }) => resumeProject(id),
  "suspend-task": ({ id }) => suspendTask(id),
  "resume-task": ({ id }) => resumeTask(id),
  "add-task-to-project": ({ id }) => addTaskToProject(id),
  "add-subtask": ({ target }) => addSubtask(target.dataset.parentTask),
  "toggle-plan-owner": ({ id }) => togglePlanStepOwner(id),
  "move-plan-step": ({ id, target }) => movePlanStep(id, Number(target.dataset.direction)),
  "add-plan-step-below": ({ id }) => addPlanStepBelow(id),
  "plan-step-request": ({ id }) => requestPlanStep(id),  // v196: 実行計画の叩き台をAIに依頼
  "plan-step-approve": () => approvePlanStepDraft(),     // v196: 下書き承認→サブタスク作成
  "ai-step-confirm-send": () => resolveAiStepConfirmSend(),  // v198: 引き継ぎシート「AIに渡す」
  "ai-step-confirm-later": () => closeModal(),                // v198: 引き継ぎシート「あとで」
  "plan-step-discard": () => discardPlanStepDraft(),     // v196: 下書き破棄
  "add-block": () => addBlock(),
  "delete-block": ({ id }) => deleteBlock(id),
  "edit-project": ({ id }) => openProjectEditor(id),
  "edit-task": ({ id }) => openTaskEditor(id),
  "edit-block": ({ id }) => openBlockEditor(id),
  "twy-kind-numeric": () => setTrackKind("numeric"),
  "twy-kind-milestone": () => setTrackKind("milestone"),
  "twy-kind-none": () => setTrackKind("none"),
  "twy-ms-add": () => {
    modalRoot.querySelector("[data-twy-ms-list]")?.insertAdjacentHTML("beforeend", trackMilestoneRowHTML());
    refreshTrackForm();
  },
  "twy-ms-del": ({ target }) => { target.closest(".twy-ms-edit-row")?.remove(); refreshTrackForm(); },
  // v263: 週次確定シート。チェックと展開は入力保持のためモーダルDOMだけを更新する。
  "twy-open-commit": () => openTwyCommitSheet(),
  "twy-commit-toggle-group": ({ target }) => {
    const ctx = target.dataset.twySelection, taskId = target.dataset.twyTaskId;
    const selection = twyCommitSelectionFor(ctx), group = twyCommitGroupByTaskId(ctx, taskId);
    if (!group) { target.checked = !target.checked; return; }
    group.blocks.forEach((block) => target.checked ? selection.add(block.id) : selection.delete(block.id));
    target.indeterminate = false;
    modalRoot.querySelectorAll(`.twy-commit-sub[data-twy-task-id="${CSS.escape(taskId)}"][data-twy-selection="${ctx}"] input[type="checkbox"]`)
      .forEach((checkbox) => { checkbox.checked = target.checked; });
    twyCommitUpdateCaret(ctx, group);
    twyCommitRefreshFooter(ctx, group.candidateCount);
  },
  "twy-commit-toggle-block": ({ target }) => {
    const ctx = target.dataset.twySelection, taskId = target.dataset.twyTaskId;
    const selection = twyCommitSelectionFor(ctx), group = twyCommitGroupByTaskId(ctx, taskId);
    if (!group) { target.checked = !target.checked; return; }
    target.checked ? selection.add(target.dataset.twyBlockId) : selection.delete(target.dataset.twyBlockId);
    const checked = group.blocks.filter((block) => selection.has(block.id)).length;
    const parent = modalRoot.querySelector(`.twy-commit-row[data-twy-task-id="${CSS.escape(taskId)}"][data-twy-selection="${ctx}"] input[type="checkbox"]`);
    if (parent) { parent.checked = checked === group.blocks.length; parent.indeterminate = checked > 0 && checked < group.blocks.length; }
    twyCommitUpdateCaret(ctx, group, checked);
    twyCommitRefreshFooter(ctx, group.candidateCount);
  },
  "twy-commit-expand": ({ target }) => {
    const ctx = target.dataset.twySelection, taskId = target.dataset.twyTaskId;
    const group = twyCommitGroupByTaskId(ctx, taskId), row = target.closest(".twy-commit-row");
    if (!group || !row) return;
    const key = `${ctx}:${taskId}`;
    if (_twyCommitOpenGroupIds.has(key)) {
      _twyCommitOpenGroupIds.delete(key);
      modalRoot.querySelectorAll(`.twy-commit-sub[data-twy-task-id="${CSS.escape(taskId)}"][data-twy-selection="${ctx}"]`).forEach((el) => el.remove());
    } else {
      _twyCommitOpenGroupIds.add(key);
      row.insertAdjacentHTML("afterend", twyCommitSubRowsHTML(group, ctx));
    }
    twyCommitUpdateCaret(ctx, group);
  },
  "twy-commit-week": () => {
    const weekStart = state.modal?.id;
    if (!weekStart || state.modal?.type !== "twyCommit") return;
    if (weekStart !== weekRange(todayISO()).weekStart) {
      openTwyCommitSheet();
      showToast("週が変わったため当週のシートを開き直しました");
      return;
    }
    if (twyCommittedWeekMeta(weekStart)) {
      renderModal(buildTwyCommitSheetHTML(weekStart));
      showToast("他端末で確定済みのため読み取り表示へ切り替えました");
      return;
    }
    commitWeek(weekStart, [..._twyCommitSelectedBlockIds]);
    saveAndRender("今週を確定しました");
    renderModal(buildTwyCommitSheetHTML(weekStart));
  },
  // v264: 確定済み週の免除/解除と計画追加。データ層保存後にモーダルも明示更新する。
  "twy-excuse": ({ id }) => {
    const weekStart = twyCurrentCommitModalWeek();
    if (!weekStart || !twyCommitItemForWeek(id, weekStart)) return;
    _twyExcuseOpenItemId = id;
    renderModal(buildTwyCommitSheetHTML(weekStart));
  },
  "twy-excuse-confirm": ({ id, target }) => {
    const weekStart = twyCurrentCommitModalWeek();
    if (!weekStart) { openTwyCommitSheet(); showToast("週が変わったため当週のシートを開き直しました"); return; }
    const item = twyCommitItemForWeek(id, weekStart);
    if (!item || item.completedAt || item.excused) return;
    const reason = target.closest(".twy-excuse-form")?.querySelector("[data-twy-excuse-reason]")?.value || "";
    if (!reason.trim()) { showToast("免除理由を入力してください"); return; }
    excuseCommitmentItem(id, reason);
    _twyExcuseOpenItemId = null;
    saveAndRender("免除しました");
    renderModal(buildTwyCommitSheetHTML(weekStart));
  },
  "twy-excuse-cancel": () => {
    const weekStart = twyCurrentCommitModalWeek();
    if (!weekStart) return;
    _twyExcuseOpenItemId = null;
    renderModal(buildTwyCommitSheetHTML(weekStart));
  },
  "twy-unexcuse": ({ id }) => {
    const weekStart = twyCurrentCommitModalWeek();
    if (!weekStart) { openTwyCommitSheet(); showToast("週が変わったため当週のシートを開き直しました"); return; }
    const item = twyCommitItemForWeek(id, weekStart);
    if (!item?.excused) return;
    unexcuseCommitmentItem(id);
    saveAndRender("免除を解除しました");
    renderModal(buildTwyCommitSheetHTML(weekStart));
  },
  "twy-add-item": () => {
    const weekStart = twyCurrentCommitModalWeek();
    if (!weekStart || !twyCommittedWeekMeta(weekStart)) return;
    _twyAddPanelOpen = true;
    _twyAddCandidateSelectedIds = new Set();
    renderModal(buildTwyCommitSheetHTML(weekStart));
  },
  "twy-add-item-confirm": () => {
    const weekStart = twyCurrentCommitModalWeek();
    if (!weekStart) { openTwyCommitSheet(); showToast("週が変わったため当週のシートを開き直しました"); return; }
    if (!_twyAddCandidateSelectedIds.size || !twyCommittedWeekMeta(weekStart)) return;
    const selected = twyAddCandidates(weekStart).filter((block) => _twyAddCandidateSelectedIds.has(block.id)).map((block) => block.id);
    if (!selected.length) { showToast("追加できる候補がありませんでした"); return; }
    addCommitmentItems(weekStart, selected);
    _twyAddPanelOpen = false;
    saveAndRender("計画に追加しました");
    renderModal(buildTwyCommitSheetHTML(weekStart));
  },
  "twy-add-item-cancel": () => {
    const weekStart = twyCurrentCommitModalWeek();
    if (!weekStart) return;
    _twyAddPanelOpen = false;
    renderModal(buildTwyCommitSheetHTML(weekStart));
  },
  // v261: WBSトラック行のインラインエディタ。全操作をdata-actionデリゲーションへ集約する。
  "twy-open-editor": ({ id }) => { _twyOpenEditorIds.add(id); render(); },
  "twy-close-editor": ({ id }) => { _twyOpenEditorIds.delete(id); render(); },
  "twy-save-measurement": ({ id, target }) => {
    const input = target.closest(".twy-editor")?.querySelector("[data-twy-editor-value]");
    const raw = input?.value ?? "";
    if (raw === "" || !Number.isFinite(Number(raw))) { showToast("有効な数値を入力してください"); return; }
    const result = recordTrackMeasurement(id, Number(raw));
    if (!result.ok) { showToast(result.errors.join(" / ")); return; }
    _twyOpenEditorIds.delete(id);
    twyEditorCommitted("記録しました");
  },
  "twy-ms-toggle-done": ({ id, target }) => {
    const result = updateTrackMilestone(id, target.dataset.twyMsId,
      { doneAt: target.checked ? todayISO() : "" });
    if (!result.ok) { render(); showToast(result.errors.join(" / ")); return; }
    twyEditorCommitted(target.checked ? "節目を完了にしました" : "節目を未完了に戻しました");
  },
  "twy-ms-edit-date": ({ id, target }) => {
    const row = target.closest(".twy-ms-edit-item");
    const value = row?.querySelector("[data-twy-ms-date-input]")?.value || "";
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) { showToast("有効な日付を入力してください"); return; }
    const result = updateTrackMilestone(id, target.dataset.twyMsId, { plannedDate: value });
    if (!result.ok) { showToast(result.errors.join(" / ")); return; }
    twyEditorCommitted("予定日を変更しました");
  },
  // v259: carryは表示条件と同じガードを通し、フォーム再展開時に古いエラーを消す。
  "twy-carry-cycle": () => {
    const id = state.modal?.id;
    const project = state.projects.find((entry) => entry.id === id && !entry.deleted);
    if (!id || !canCarryProjectCycle(project)) return;
    if (!activeTrackForProject(state.tracks || [], id)) { confirmCarryProjectCycle(); return; }
    const errors = modalRoot.querySelector("[data-twy-carry-errors]");
    if (errors) { errors.hidden = true; errors.textContent = ""; }
    const form = modalRoot.querySelector("[data-twy-carry-form]");
    if (form) form.hidden = false;
  },
  "twy-carry-confirm": () => confirmCarryProjectCycle(),
  // --- モーダル起動系(3、modal-saveは残置) ---
  "modal-close": () => closeModal(),
  "modal-delete": () => deleteFromModal(),
  "lev-judge": ({ target }) => {
    const card = target.closest(".modal-card");
    const checkedCount = card ? card.querySelectorAll("[data-lev-q]:checked").length : 0;
    const select = card?.querySelector('[data-modal-field="leverageType"]');
    if (select) {
      select.value = checkedCount >= 2 ? "asset" : "";
      showToast(checkedCount >= 2 ? "⚙ 「資産」を提案しました(保存で反映)" : "迷うなら未設定のままでOK");
    }
  }
});
// v178: app.js分割・段階5-8。submitModal/deleteFromModalのstate.modal.typeによるif-else連鎖
// (project/task/block/actualEntry/question/experiment/storeVisit)を
// registerModalHandlerへ全件移行した(prep-stage5-dispatcher.md §5、Must級指摘の解消)。
// project/task/blockはsrc/features/へ未抽出のためapp.js内関数をそのまま参照する。
// storeVisitはjournal.jsからimport済みの関数をそのまま参照する。actualEntryは
// 従来からdeleteFromModal側に対応する型が無い(saveのみ)ためdelete keyを持たせない
// (dispatchModalDeleteがfalseを返し、deleteFromModal側の共通closeModal()へ素通りする——
// 移行前の「どの型にもマッチせずcloseModal()だけ実行される」挙動と完全に一致)。
registerModalHandler("project", {
  save: (id, fields) => saveProjectFromModal(id, fields),
  delete: (id) => deleteProject(id)
});
registerModalHandler("task", {
  save: (id, fields) => saveTaskFromModal(id, fields),
  delete: (id) => deleteTask(id)
});
registerModalHandler("block", {
  save: (id, fields) => saveBlockFromModal(id, fields),
  delete: (id) => deleteBlock(id)
});
registerModalHandler("actualEntry", {
  save: (id, fields) => saveActualEntryFromModal(id, fields)
});
registerModalHandler("question", {
  save: (id, fields) => saveQuestionFromModal(id, fields),  // v39
  delete: (id) => deleteQuestion(id)  // v39
});
registerModalHandler("experiment", {
  save: (id, fields) => saveExperimentFromModal(id, fields),  // v68
  delete: (id) => deleteExperiment(id)  // v68
});
registerModalHandler("storeVisit", {
  save: (id, fields) => saveStoreVisitFromModal(id, fields),  // v141: 今日行ったお店ログ
  delete: (id) => deleteStoreVisit(id)  // v141
});
// v179: 段階5-7b(モーダル系dispatcher移行・後半)。ビジョンボード6+実験ログ5+AIスケジュール
// 下書き8+検索2、計21分岐を相乗りregisterActionsへ移行(prep-stage5-dispatcher.md §4)。
// 下書き系4件の`&&<guard>`条件はハンドラ内early returnへ機械的に変換(guard偽時は何もしない
// fallthroughと等価)。ロジック無改変。
registerActions({
  // --- ビジョンボード(6) ---
  "vision-section": ({ target }) => setVisionSection(target.dataset.section),
  "open-vision-board": ({ target }) => openVisionBoard(Number(target.dataset.index) || 0),
  "vision-board-tab": ({ target }) => setVisionBoardIndex(Number(target.dataset.index)),
  "vision-board-load": ({ target }) => loadVisionBoardPdf(target.dataset.file),
  "vision-board-load-images": ({ target }) => loadVisionBoardImages(target.dataset.file),
  "vision-board-retry-images": ({ target }) => loadVisionBoardImages(target.dataset.file),
  // --- 実験ログ(5) ---
  "experiment-add": () => addExperimentOrGuard(),
  "edit-experiment": ({ id }) => openExperimentEditor(id),
  "experiment-keep": ({ id }) => keepExperiment(id),
  "experiment-drop": ({ id }) => dropExperiment(id),
  "experiment-copy-conclusion": ({ id }) => copyExperimentConclusion(id),
  // --- AIスケジュール下書き(8) ---
  "ai-schedule": () => runAiSchedule(),
  "ai-morning-plan": () => runAiMorningPlan(),
  "draft-confirm": () => confirmScheduleDraft(),
  "draft-discard": () => {
    if (!_scheduleDraft) return;
    // v52: 破棄も「この提案は不要だった」という学習シグナルとして記録(v62: source区別も記録)
    // 複数sourceの項目が合流した下書きでも、
    // 学習ログには項目ごとの出どころ(it.source)を優先して残す(無ければ従来どおり下書き全体のsource)。
    _scheduleDraft.items.forEach((it) => recordScheduleHistory(it, "discarded", _scheduleDraft.date, it.source || _scheduleDraft.source || "deterministic"));
    _scheduleDraft = null;
    _draftUndo = null;  // v62: 破棄はUndo対象外(下書き自体が消える)
    _draftUndoHistoryEntry = null;
    saveState();
    render();
    showToast("下書きを破棄しました");
  },
  "draft-remove": ({ id }) => {
    if (!_scheduleDraft) return;
    const removed = _scheduleDraft.items.find((x) => x.id === id);
    let removedHistoryEntry = null;
    // item.source優先(合流下書きでの出どころ誤ラベル防止。draft-discardと同じ方針)
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
  },
  "draft-undo": () => {
    if (!_draftUndo) return;
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
  },
  "draft-remove-reason": ({ target }) => {
    if (!_pendingRejectReason) return;
    // v62: 却下理由のワンタップ選択(今日は無理/価値が薄い/時間帯が合わない/その他)。aiScheduleHistoryへ追記する
    _pendingRejectReason.entry.reason = target.dataset.reason || "";
    _pendingRejectReason = null;
    saveState();
    render();
  },
  "draft-remove-reason-dismiss": () => {
    _pendingRejectReason = null;
    render();
  },
  // --- 検索(2) ---
  "open-search": () => openSearchModal(),
  "search-jump": ({ target }) => {
    const view = target.dataset.view || "today";
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
});
// v180: app.js分割・段階5-8(timeline系dispatcher分岐の移行・前半)。prep-stage5-dispatcher.md
// §7の見積りどおり、timeline系40分岐は200行予算に収まらないため2分割する(前半=Block作成2+
// Block/Now9+ポモドーロ16、計27分岐)。後半(日付ナビ3+タイムライン設定/カテゴリフィルタ9+
// timeline-mode)はv181で継続する。ハンドラ実体はいずれもapp.js残留のため相乗りregisterActions
// (v174方式)へ移行した。ロジック無改変。
registerActions({
  // --- Block作成(WBSからの「今日へ追加」) ---
  "task-today": ({ id }) => createBlockFromTask(id),
  // --- Block/Now(9) ---
  "toggle-block": ({ id }) => toggleBlock(id),
  "toggle-task-complete": ({ id }) => toggleTaskCompleteFromBlock(id),
  "now-start": ({ id }) => openDeclareModal(id, "block"),
  "now-end": ({ id }) => openReportModal(id, "block"),
  "bulk-approve-planned": () => bulkApproveAsPlanned(),
  "now-mode-open": () => openNowMode(),
  "now-mode-close": () => closeNowMode(),
  "now-conveyor-complete": ({ id }) => nowConveyorComplete(id),
  "now-conveyor-skip": ({ id }) => { _nowSkippedIds.add(id); render(); },
  // --- ポモドーロ(16) ---
  "start-pomodoro": ({ target }) => {
    const blockId = target.dataset.blockId || "";
    openDeclareModal(blockId, "pomodoro");
  },
  "stop-pomodoro": () => {
    if (state.pomodoro.blockId) {
      _pendingInterruptBlockId = state.pomodoro.blockId;
      render();
    } else {
      stopPomodoro();
    }
  },
  "interrupt-reason": ({ target }) => {
    if (_pendingInterruptBlockId) recordBlockInterruption(_pendingInterruptBlockId, target.dataset.reason || "その他");
    _pendingInterruptBlockId = null;
    stopPomodoro();
  },
  "interrupt-reason-cancel": () => {
    _pendingInterruptBlockId = null;
    render();
  },
  "complete-pomodoro": () => openReportModal(state.pomodoro.blockId, "pomodoro"),
  "declare-confirm": () => confirmDeclare(),
  "declare-skip": () => skipDeclare(),
  "report-outcome": ({ target }) => {
    const note = modalRoot.querySelector("[data-report-note]")?.value || "";
    finishReport(target.dataset.outcome || "", note);
  },
  "report-skip": () => finishReport("", ""),
  "incomplete-reason-chip": ({ target }) => recordIncompleteReasonChip(target.dataset.chip || ""),
  "incomplete-reason-skip": () => skipIncompleteReasonModal(),
  "guided-access-dismiss": () => {
    if (modalRoot.querySelector("[data-guided-access-suppress]")?.checked) {
      state.settings.pomoGuidedAccessHint = false;
      saveState();
    }
    closeModal();
  },
  "go-break": () => goBreakPomodoro(),
  "end-break": () => endBreakPomodoro(),
  "continue-focus": () => continueFocusPomodoro(),
  "finish-block": () => finishBlockFromBreak()
});
// v181: app.js分割・段階5-8(timeline系dispatcher分岐の移行・後半)。日付ナビ3+タイムライン設定/
// カテゴリフィルタ9の計12分岐を相乗りregisterActionsへ移行した(prep-stage5-dispatcher.md §4)。
// これでtimeline系40分岐(v180前半27+v181後半12+timeline-mode1)すべての移行が完了した。
// ハンドラ実体はいずれもapp.js残留のため相乗り(v174方式)。ロジック無改変。
registerActions({
  // --- 日付ナビ(3) ---
  "date-prev": () => shiftSelectedDate(-1),
  "date-next": () => shiftSelectedDate(1),
  "today": () => setSelectedDate(todayISO()),
  // --- タイムライン設定/カテゴリフィルタ(9) ---
  "timeline-new-block": ({ target }) => {
    const minute = Number(target.dataset.minute || 0);
    openTimelineNewBlock(minute);
  },
  "complete-block-with-actual": ({ event, id }) => {
    event.stopPropagation();
    completeBlockWithActual(id);
  },
  "tl-zoom": ({ target }) => {
    state.timelineZoom = Number(target.dataset.zoom) || 1;
    persistLocalNoSchedule();
    render();
  },
  "tl-energy-mode": ({ target }) => {
    state.settings.timelineEnergyGraphMode = target.dataset.mode === "battery" ? "battery" : "energy";
    persistLocalNoSchedule();
    render();
  },
  "energy-open-category": ({ target }) => {
    state.settings.timelineCategoryFilter = target.dataset.cat || "";
    persistLocalNoSchedule();
    setView("timeline");
  },
  "timeline-clear-cat": () => {
    state.settings.timelineCategoryFilter = "";
    persistLocalNoSchedule();
    render();
  }
});
let toastTimer = null;
let timerTicker = null;
// v144: エネルギーバッテリーの差分更新(updateBatteryTick)のスロットル用。
let _lastBatteryTickAt = 0;
const BATTERY_TICK_INTERVAL_MS = 60000;
// v148: 「動的にopen既定が変わるdetails」(ジャーナル朝/夜・設定「データと同期」)の手動開閉
// オーバーライド(セッション内のみ、非永続 = リロードで消える)。これらのdetailsは現在時刻や
// 同期異常の有無から既定open/closedを毎回計算するため、通常のfoldSection(localStorage
// 記憶)をそのまま使うと「動的にopenのまま描画されただけで、ブラウザがdetailsの'toggle'
// イベントを自動発火する仕様(実測確認済み)」により、ユーザーが触ってもいないのに
// 『手動で開いた』扱いでlocalStorageへ永続化されてしまう(条件が変わっても二度と元に
// 戻らなくなる)。'toggle'イベントは信用せず、<summary>への本物のクリック(data-action=
// "toggle-journal-segment"/"toggle-settings-sync")だけをここへ記録し、render()時は
// 動的条件 || このオーバーライド、の優先順で使う(動的open自体は永続化しない)。
// v169: _journalSegmentOverrideはsrc/state/journal-fold.jsへ切り出し、冒頭でimportした
// (app.js分割・段階4-3。click dispatcherのtoggle-journal-segment分岐とrenderJournalの共有)。
let _settingsSyncOpenOverride = null;  // null=未操作、true/false=ユーザーが実際にクリックした最新状態
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
const cachedWeeklyReviewMd = {};  // v62: { '週開始土曜YYYY-MM-DD': '...md text...' }(自宅PCバッチ生成)
// v159: AI機能3「未来の自分からの手紙」。loop/scripts/future-letter.sh が personal-data/taskchute/
// へ 未来からの手紙_<YYYY-MM>.md(1年後の自分視点の手紙本文プレーンテキスト)を月次でpushする
// (契約は loop/FORMAT_CONTRACT.md「未来からの手紙_YYYY-MM.mdの契約」)。ホームの導線表示は
// 「当月分の存在有無」だけを知ればよいため、実際の当月キーのみを
// セッション内で1回だけ確認する(前月以前の無条件fetchは行わない。過去の手紙自体はAIレポート
// 画面の一覧〈AI_REPORT_TYPES〉から読む導線に任せる)。
const cachedFutureLetterMd = {};  // { 'YYYY-MM': '...手紙本文...' | undefined }
// v190: coach-daily系バッチが生成する4ビュー共通のAI所見。stateへは保存せず、
// 取得成功時だけTTLキャッシュを更新する。
let cachedAiInsightsJson = { fetchedAt: 0, data: undefined };
const AI_INSIGHTS_STALE_MS = 26 * 60 * 60 * 1000;
const AI_INSIGHTS_GENERATED_AT_RE = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
// v67: AI作業結果_<today>.json のパース済み配列(非永続、当日分のみ)。二重登録防止のIDは state.aiWorkProcessedIds 側で永続化する。
let cachedAiWorkResults = null;
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
// hydrateStaticMarkdown等の新着反映やsetViewの画面切替用の入口。入力中/IME変換中なら即renderせず
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
// v261: 開いているWBSトラックエディタ。表示専用の非永続状態。
let _twyOpenEditorIds = new Set();
// v263: 週次確定シートの選択・展開状態。stateへ保存しないためnormalizeState不要。
let _twyCommitSelectedBlockIds = new Set();
let _twyCommitOpenGroupIds = new Set();
let _twyAddCandidateSelectedIds = new Set();
let _twyExcuseOpenItemId = null;
let _twyAddPanelOpen = false;
// v70: フォーカスタイマー「中断」の理由ワンタップピッカー(チョコ停記録)。非永続。
let _pendingInterruptBlockId = null;
// v87: 宣言/終了報告モーダルが解決するまでの一時コンテキスト。非永続。
// { blockId, phase: "declare"|"report", kind: "pomodoro"|"block" }
let _pendingLifecycleCtx = null;
// v108: Block保存モーダルの二重送信ガード(iOS Safariでの保存ボタン二重発火対策)。非永続。
//       saveBlockFromModal の実行中だけ true になり、完了/失敗いずれも finally で必ず解除する。
let _blockSaveInFlight = false;
// v168: 月間プランニングボードのドラッグ状態(_wishDrag)はsrc/features/wish.jsへ移動した
// (app.js分割・段階4-2。wish.js冒頭コメント参照)。

// 折りたたみカード(details)の開閉状態。端末ローカルのUI状態であり、
//      GitHub同期やエクスポートの対象になる state オブジェクトとは意図的に分離する。
const FOLD_KEY = "taskchute-journal-home-fold-v1";
function readFoldMap() {
  try { return JSON.parse(localStorage.getItem(FOLD_KEY) || "{}"); } catch { return {}; }
}
function isFoldOpen(id, defaultOpen) {
  const stored = readFoldMap()[id];
  return typeof stored === "boolean" ? stored : Boolean(defaultOpen);
}
function setFoldOpen(id, open) {
  try {
    const map = readFoldMap();
    map[id] = open;
    localStorage.setItem(FOLD_KEY, JSON.stringify(map));
  } catch { /* 保存できなくても致命的ではない(UI状態のみ) */ }
}
// 折りたたみカードの共通ラッパー。bodyHTML が空なら(非表示条件を満たさない場合)カードごと出さない。
function foldSection(id, defaultOpen, wrapperClass, summaryClass, summaryText, bodyHTML) {
  if (!bodyHTML) return "";
  const open = isFoldOpen(id, defaultOpen);
  return `<details class="fold panel ${wrapperClass || ""}" data-fold-id="${id}" ${open ? "open" : ""}>
    <summary class="fold-summary ${summaryClass || ""}"><span class="fold-chevron">▶</span>${escapeHTML(summaryText)}</summary>
    <div class="fold-body">${bodyHTML}</div>
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
  // v181: date-prev/date-next/todayはapp.js内のregisterActionsへ移行した。
  // v173: set-morning〜store-visit-yearはsrc/features/journal.jsのregisterActionsへ移行した。
  // v178: add-project/delete-project/add-task/toggle-taskはapp.js内のregisterActionsへ移行した。
  if (action === "toggle-criteria-request") toggleCriteriaRequest(id);  // v99: 翌朝AI設定依頼トグル
  // v178: delete-task/toggle-project-collapse/toggle-task-collapse/suspend-project/resume-project/
  // suspend-task/resume-task/add-blockはapp.js内のregisterActionsへ移行した。
  // v174: toggle-show-suspended〜wbs-collapse-allはapp.js内のregisterActionsへ移行した。
  // v180: toggle-block/toggle-task-complete/now-start/now-end/bulk-approve-planned/now-mode-open/
  // now-mode-close/now-conveyor-complete/now-conveyor-skipはapp.js内のregisterActionsへ移行した。
  // v177: generate-report/download-report/download-dataはapp.js内のregisterActionsへ移行した。
  // v174: save-github/load-github/gate-continue/reset-demoはapp.js内のregisterActionsへ移行した。
  // v17: MIT(今日の主役)の切替(最大3個)
  if (action === "toggle-mit") toggleMIT(id);
  // body-scan-*(ポモドーロ身体スキャン)はapp.jsに残す。
  if (action === "body-scan-fatigue") bodyScanRecordFatigue(Number(target.dataset.value));
  if (action === "body-scan-part") bodyScanRecordPart(target.dataset.part || "");
  if (action === "body-scan-discard") bodyScanDiscard();
  // v180: start-pomodoro/stop-pomodoro/interrupt-reason/interrupt-reason-cancel/complete-pomodoro/
  // declare-confirm/declare-skip/report-outcome/report-skip/incomplete-reason-chip/
  // incomplete-reason-skip/guided-access-dismiss/go-break/end-break/continue-focus/finish-block
  // はapp.js内のregisterActionsへ移行した。
  // === v2: 編集モーダル ===
  // v178: edit-project/edit-task/edit-block/modal-close/modal-delete/lev-judgeはapp.js内の
  // registerActionsへ移行した。modal-saveは過去判定どおりreturn意味論(disable連動のearly
  // return)がありif連鎖に残置する。
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
  // v179: vision-section〜vision-board-retry-images(ビジョンボード6)はapp.js内の
  // registerActionsへ移行した。
  if (action === "open-md-in-github") openMdInGithub(target.dataset.path);
  if (action === "reload-md") reloadStaticMarkdown();
  // v177: ai-report-type/ai-report-refresh/open-future-letter/ai-work-approve/ai-work-questionは
  // app.js内のregisterActionsへ移行した。
  // v179: experiment-add〜experiment-copy-conclusion(実験ログ5)はapp.js内の
  // registerActionsへ移行した。
  // v181: timeline-new-block/complete-block-with-actual/tl-zoom/tl-energy-modeは
  // app.js内のregisterActionsへ移行した。
  // timeline-modeのみハンドラ実体がsrc/features/timeline.js側のため、そちらの
  // registerActions(v173方式)へ移行した。
  // v174: push-reportはapp.js内のregisterActionsへ移行した。
  // v178: add-task-to-project/add-subtaskはapp.js内のregisterActionsへ移行した。
  // v177: toggle-journal-segmentはapp.js内のregisterActionsへ移行した。
  // v174: toggle-settings-sync/toggle-sidebarはapp.js内のregisterActionsへ移行した。
  // v173: Wish CRUDはsrc/features/wish.jsのregisterActionsへ移行した。
  // v176: zt-*/zero-tab/zerosec-theme-*(0秒思考)はapp.js内のregisterActionsへ移行した。
  // v177: question-*/open-questions/entry-to-question(問い)・report-copy-ai/report-share-ai/
  // ai-task-adopt/ai-task-dismiss(AI連携)はapp.js内のregisterActionsへ移行した
  // (段階5-6b)。
  // v143: journal-import-ai(手動貼り付け取込ボタン)はv141でジャーナルのAIフィードバック列
  // 自体を撤去した際に到達不能になっていたため、ハンドラごと削除した(openAiImportModal一式・
  // ai-import-submitも同様。CHANGES_v143.md参照)。
  // v179: ai-schedule/ai-morning-plan/draft-confirm/draft-discard/draft-remove/draft-undo/
  // draft-remove-reason/draft-remove-reason-dismiss(AIスケジュール下書き8)はapp.js内の
  // registerActionsへ移行した。
  // v176: zerosec-theme-add/zerosec-theme-skipはapp.js内のregisterActionsへ移行した。
  // v217: weekly-suggest-addはAIレポートの週次レビューから呼ぶ。
  // v174: open-backup-list/restore-backup/run-archiveはapp.js内のregisterActionsへ移行した。
  // v179: open-search/search-jump(検索2)はapp.js内のregisterActionsへ移行した。
  // v177: carry-over/migration-ritual-choice/ideal-retryはapp.js内のregisterActionsへ移行した。
  // v181: energy-open-category/timeline-clear-catはapp.js内のregisterActionsへ移行した。
});

// 折りたたみカード(details)の開閉をlocalStorageへ即時記憶する。
// "toggle" イベントは bubbles しない仕様のため、document への委譲はキャプチャフェーズで行う
// (キャプチャは非バブリングイベントでもターゲットまでの経路を通過するため、これで拾える)。
document.addEventListener("toggle", (event) => {
  const el = event.target;
  if (!el?.dataset?.foldId) return;
  setFoldOpen(el.dataset.foldId, el.open);
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
  if (target.closest("[data-twy-track]")) refreshTrackForm();
  if (target.matches("[data-journal-date]")) {
    const d = target.dataset.journalDate;
    state.journals[d] = target.value;
    // v106: 本文の編集時刻を記録(端末間マージの新旧判定に使用)
    const meta = (state.journalMeta[d] ||= { aiMitCandidates: [], aiImported: false, ideal: "", aiTaskCandidates: [], aiRequest: "" });
    meta.textUpdatedAt = nowDateTime();
    saveState();
  }
  // v61: 今日の理想ワンライナー(入力中も保存。全再描画しないのでフォーカスは維持される)
  if (target.matches("[data-ideal-date]")) {
    const d = target.dataset.idealDate;
    const meta = (state.journalMeta[d] ||= { aiMitCandidates: [], aiImported: false, ideal: "", aiTaskCandidates: [], aiRequest: "" });
    meta.ideal = target.value;
    saveState();
  }
  // v73: コンディションOS — 夜のひとこと(入力中も保存。全再描画しないのでフォーカスは維持される)
  if (target.matches("[data-condition-note-date]")) {
    const d = target.dataset.conditionNoteDate;
    const log = ensureConditionLog(d);
    log.eveningNote = target.value;
    log.eveningRecordedAt ||= nowDateTime();
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
  // v34: ここにあった Wish のクリック処理(add-wish 等)は
  //      input リスナーでは action/id が未定義で動かず、毎入力で例外を投げていた。
  //      → click リスナー(上部)へ移設して修正済み。
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches('[data-modal-field="is12WY"]')) {
    const section = modalRoot.querySelector("[data-twy-track]");
    if (section) section.hidden = !target.checked;
    // v259: 未保存の12WY切替にもcarry導線の表示を同期する。
    const carry = modalRoot.querySelector("[data-twy-carry]");
    if (carry) carry.hidden = !target.checked;
  }
  if (target.matches("[data-date-picker]")) setSelectedDate(target.value);
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
    // v198(第3弾3e): updateTaskFieldは汎用setterのためprevStatusをここで確保する(完了6経路#3)
    const prevStatus = state.tasks.find((x) => x.id === id)?.status;
    // v95: ステータスを手動で「完了」にした時も、分子を分母へ揃える(チェックボックス完了と挙動を揃える)
    if (field === "status" && target.value === "completed") {
      const t = state.tasks.find((x) => x.id === id);
      if (t) updateTaskField(id, "progressNum", fillProgressOnComplete(t));
    }
    updateTaskField(id, field, target.value);
    if (field === "status") maybeQueueNextAiStep(id, prevStatus);  // v198(第3弾3e): 完了6経路#3
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
  if (target.matches("[data-setting-field]")) {
    state.settings[target.dataset.settingField] = target.value;
    saveState();
    render();
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
});

// loadState/persistLocalNoSchedule: src/storage/local.js へ抽出済み(v166)。冒頭のimportを参照。
// _lastSaveErrorも同ファイルからimport済み(読み取り専用。再代入はpersistLocalNoSchedule内のみ)。

let _quotaToastShown = false;

function saveState() {
  // v25: 実データの変更時刻を記録(端末間の「新しい方が勝つ」判定に使用)。
  //      persistLocalNoSchedule(リモート採用・GitHub保存)では更新しない。
  state.dataModifiedAt = nowDateTime();
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
const THEME_COLOR_BY_MODE = { light: "#f7f7fa", dark: "#111216", cockpit: "#050a14" };
function resolveTheme(mode) {
  if (mode !== "auto") return ["light", "dark", "cockpit"].includes(mode) ? mode : "dark";
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
  const actualSettings = value.settings && typeof value.settings === "object" && !Array.isArray(value.settings)
    ? value.settings
    : {};
  value.settings = {
    earlyRiseTarget: "06:00",
    ironDailyTarget: 2000,
    ironManualBaseKg: 0,
    gymBlockKeywords: ["ジム", "筋トレ"],
    twelveWeekScoreTarget: 85,
    ...actualSettings
  };
  // v230: home撤去後も旧state・未知viewで白画面にしないため、todayへ縮退する。
  const allowedViews = new Set([
    "today", "wbs", "wish", "tasks", "timeline",
    "journal", "zero", "vision", "ai-reports", "settings", "more",
    "iron-log", "instruments"
  ]);
  if (!allowedViews.has(value.currentView)) value.currentView = "today";
  // v31: 残り時間表示用の生年月日(未設定なら補完)
  if (!value.settings.birthDate) value.settings.birthDate = "1992-12-29";
  value.settings.staticFilesLoaded ||= { vision: false, affirmation: false };
  // v37: インポート/同期で欠けていると描画がクラッシュするキーを補完
  value.settings.morningEnergyLog ||= {};
  value.pomodoro ||= { running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
  // v229: EARLY BIRDの正本。旧stateと壊れた形状は空ログへ後方互換正規化する。
  if (!value.earlyBird || typeof value.earlyBird !== "object" || Array.isArray(value.earlyBird)) value.earlyBird = {};
  if (!value.earlyBird.logs || typeof value.earlyBird.logs !== "object" || Array.isArray(value.earlyBird.logs)) value.earlyBird.logs = {};
  // v252: 固定化ルーティンの汎用ログ。ruleIdごとのnull/壊れた値も空ログへ補完する。
  if (!value.habitStreaks || typeof value.habitStreaks !== "object" || Array.isArray(value.habitStreaks)) value.habitStreaks = {};
  value.habitStreaks = Object.fromEntries(Object.entries(value.habitStreaks).sort().map(([ruleId, habit]) => [ruleId, {
    ...(habit && typeof habit === "object" && !Array.isArray(habit) ? habit : {}),
    logs: habit?.logs && typeof habit.logs === "object" && !Array.isArray(habit.logs) ? habit.logs : {}
  }]));
  const actualIronImport = value.ironImport && typeof value.ironImport === "object" && !Array.isArray(value.ironImport)
    ? value.ironImport
    : {};
  value.ironImport = { done: false, importedTotalKg: 0, importedDays: 0, ...actualIronImport };
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
  // v214: 朝プランの自動実行設定を廃止。手動実行と下書き機構は維持する。
  delete value.settings.ai.autoMorningPlan;
  // v52: スケジュール実績ログ(決定論配置の元値に対するユーザの採否・修正を記録)。
  if (!Array.isArray(value.aiScheduleHistory)) value.aiScheduleHistory = [];
  // v62: aiScheduleHistory の各エントリに source/reason のデフォルトを補完(後方互換。
  //      v62以前のエントリには無いフィールドのため、既存値優先で埋める)
  value.aiScheduleHistory = value.aiScheduleHistory.map((h) => ({ source: "unknown", reason: "", ...h }));
  // v148(UI改善計画Phase3-5): タイムラインのエネルギーグラフ表示モード(UI状態)。
  // 既定"energy"(従来どおりエネルギー実績/予測線)。"battery"でバッテリー残量線のみ表示。
  if (value.settings.timelineEnergyGraphMode !== "energy" && value.settings.timelineEnergyGraphMode !== "battery") {
    value.settings.timelineEnergyGraphMode = "energy";
  }
  // v185: "light"|"dark"|"cockpit"|"auto"(OS追従)の4択。既定"dark"は維持する。
  // 既定"dark"。既存端末も次回起動からdarkになる(autoを選べば従来どおりOS追従に戻せる)。
  // 実際のhtml要素への反映(data-theme属性・meta theme-color)はapplyTheme()が行う。
  if (!["light", "dark", "cockpit", "auto"].includes(value.settings.theme)) {
    value.settings.theme = "dark";
  }
  // v221: cockpitスキン廃止。旧stateも含め、互換フィールドはtower固定へ正規化する。
  value.settings.todaySkin = "tower";
  // v229: 早起きチェックは目標超過でも有効。ここは警告表示に使うHH:mmだけを正規化する。
  if (!/^\d{2}:\d{2}$/.test(value.settings.earlyRiseTarget || "")) value.settings.earlyRiseTarget = "06:00";
  // v243: 12WY週次コミット達成率の目安。整数へ丸め、設定可能範囲70〜100に収める。
  {
    const scoreTarget = Number(value.settings.twelveWeekScoreTarget);
    value.settings.twelveWeekScoreTarget = Number.isFinite(scoreTarget)
      ? clamp(Math.round(scoreTarget), 70, 100)
      : 85;
  }
  // v210: TOWERのモーション強度。未知値は通常へ。
  if (!["normal", "calm", "off"].includes(value.settings.towerMotion)) value.settings.towerMotion = "normal";
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
  }
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
  // v189 F7 migration: ビジョン直結カテゴリ名の複数選択。既存の配列はそのまま保持する。
  if (!Array.isArray(value.settings.visionDirectCategories)) {
    value.settings.visionDirectCategories = [];
  }
  // v16: やりたいことリスト用の人生領域マスタ
  if (!Array.isArray(value.settings.lifeAreas) || value.settings.lifeAreas.length === 0) {
    value.settings.lifeAreas = defaultLifeAreas();
  }
  // v17/v189: Avoid Listのstateデータはv214でも温存する。UI・書き込み経路を削除しても、
  // 既存データを同期・エクスポートで欠落させないため後方互換の正規化は維持する。
  if (!Array.isArray(value.settings.avoidList)) {
    value.settings.avoidList = [];
  }
  value.settings.avoidList = value.settings.avoidList
    .filter((it) => it && typeof it === "object")
    .map((it) => ({
      violations: [],
      ...it,
      violations: Array.isArray(it.violations) ? it.violations : []
    }));
  value.projects ||= [];
  value.tasks ||= [];
  // v16/v18: 既存 Task にWish + ルーティン連携 用フィールドのデフォルト値を補完(後方互換)
  value.tasks = value.tasks.map((task) => {
    // v18: 古い trigger/celebrate フィールドは削除(あれば)
    const { trigger, celebrate, ...rest } = task;
    // v195: ownerを実行主体の正典にし、既存のAIワーカー表示・バッチ用aiWorkを同期する。
    // **updatedAtは絶対に進めない**(v135): normalizeStateは起動時・同期時に走り、同期マージは
    // updatedAtの新しい方をオブジェクト丸ごと採択する。読み込んだだけで時刻が進むと、
    // 手を触れていないローカルの古い内容がリモートの新しい変更に勝って上書きしてしまう。
    // ここは既定値補完と同じ「読み取り時の純粋な整形」に留める。
    // owner未設定 + 旧clientが立てた aiWork:true は "ai" として引き取る(片方向導出だと
    // SW未更新の端末で🤝をONにしたタスクが、v195端末で読んだ瞬間にフラグを失い
    // ai-work-extract.py の発注対象から黙って消えるため)。
    const owner = (rest.owner === "ai" || (rest.owner === undefined && rest.aiWork === true)) ? "ai" : "k";
    const aiWork = owner === "ai";
    return {
      targetYear: null,
      targetMonth: null,  // v79: 月間プランニングボード用(1-12 or null="未定"。targetYearとは独立)
      lifeArea: "",
      motivation: "",
      realized: false,
      realizedDate: "",
      nextRoutineId: "",
      leverageType: "",  // v65: 10x機構(2-1)。"asset"|"eliminate"|"oneoff"|""(未設定)
      aiWork: false,      // v67: AI作業ワーカー連携(柱2)。v195以降はownerから導出
      aiWorkBrief: "",    // v67: 何をしてほしいか・成果物の置き場希望(1〜2行)
      planTarget: false,
      owner: "k",
      order: null,
      aiBrief: "",
      handoffNote: "",
      aiStatus: "none",
      aiResultRef: "",
      aiSummary: null,          // v197(第3弾3d): AIステップ結果の要旨。旧Taskは未設定(null)扱いで補完
      aiQuestion: null,         // v197(第3弾3d): 第4弾予約フィールド。旧Taskは未設定(null)扱いで補完
      aiStepRequestId: null,        // v197(第3弾3d, B-2/B-3): 保留中request永続化。旧Taskは未設定(null)扱いで補完
      aiStepRequestedAt: null,      // v197(第3弾3d, C-9): 送信時刻。旧Taskは未設定(null)扱いで補完
      progressNum: 0,     // v95: WBS進捗(分子)。旧Taskは未着手(0)扱いで補完
      progressDen: 10,    // v95: WBS進捗(分母)。既定10
      doneCriteria: "",   // v96: 完了条件(終わったら残る物を1文で。既定は空欄=未設定)
      firstStep: "",       // v96: スモールステップ(5〜15分で終わる最初の行動。既定は空欄=未設定)
      criteriaRequest: false,  // v99: 翌朝バッチへdoneCriteria/firstStep自動設定orサブタスク生成を依頼するフラグ。
                                // trueで翌朝loop/task-criteria.shが処理し、処理後は自動でfalseに戻る(アプリ側での解除処理は不要)
      selfDueOff: false,  // v117(B): 自己締切の自動前倒し。既定false=前倒しON(dueDateの2日前を有効締切にする)
      updatedAt: "",  // v135: 同期マージ用。既存値優先で補完(空="不明"のまま扱う。回復不能なので推測しない)
      ...rest,
      owner,
      aiWork
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
    interruptions: [],    // v70: フォーカスタイマー中断(チョコ停)記録 [{at, reason}]
    incompleteReason: null,  // v162: 未完了理由クイック入力 {chip, note, at} | null
    ...block,
    plannedStartAt: fixDateTime(block.plannedStartAt),
    plannedEndAt: fixDateTime(block.plannedEndAt),
    actualStartAt: fixDateTime(block.actualStartAt),
    everStartedAt: fixDateTime(block.everStartedAt) || fixDateTime(block.actualStartAt),
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
    if (typeof j.aiRequest !== "string") j.aiRequest = "";  // v228: TOWER JOURNALのAI依頼枠
  });
  // v61: マイグレーション儀式(3回目以降の繰り越し確認)の選択ログ。将来のバッチ分析用に軽量記録。
  if (!Array.isArray(value.migrationRitualLog)) value.migrationRitualLog = [];
  // AI Coach phase 1a: quick meal logs are append-only; deletion is a tombstone.
  if (!value.coachLog || typeof value.coachLog !== "object") value.coachLog = {};
  if (!Array.isArray(value.coachLog.meals)) value.coachLog.meals = [];
  const coachMealCutoff = addDays(todayISO(), -89);
  value.coachLog.meals = value.coachLog.meals
    .filter((meal) => meal?.date >= coachMealCutoff)
    .slice(-COACH_MEALS_MAX);
  if (!value.coachLog.settings || typeof value.coachLog.settings !== "object") value.coachLog.settings = {};
  if (!Number.isFinite(value.coachLog.settings.dailyKcal) || value.coachLog.settings.dailyKcal <= 0) {
    value.coachLog.settings.dailyKcal = 2278;
  }
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
  // v197(第3弾3d, S-3): AIステップの処理済み/取消済みrequestId集合(aiWorkProcessedIdsと同型)。
  // aiWorkProcessedIds自体は同期マージ対象外の既知の欠陥を持つが、それを直すのは本設計の
  // 対象外(3dでは触らない)。この2集合はcomputeSyncMergeのマージ対象へ新規に登録する(src/sync/github.js)。
  if (!Array.isArray(value.aiStepProcessedIds)) value.aiStepProcessedIds = [];
  value.aiStepProcessedIds = value.aiStepProcessedIds.filter((id) => typeof id === "string" && id);
  if (!Array.isArray(value.aiStepDismissedIds)) value.aiStepDismissedIds = [];
  value.aiStepDismissedIds = value.aiStepDismissedIds.filter((id) => typeof id === "string" && id);
  // v197(第3弾3d, C-4): 保留中request台帳(state直下)。{requestId, taskId, requestedAt}の配列。
  // タスク側のaiStepRequestIdがマージ事故(§1「updatedAtの更新」節のwhole-object競合)で
  // 消えても、この台帳を経由して復帰時照合が応答を拾えるようにする。requestIdが
  // aiStepProcessedIds∪aiStepDismissedIdsに入った時点で決定論的に剪定する
  // (剪定条件が和集合マージされる2集合から再導出されるため、全端末で同じ結果になり、
  // 和集合マージで削除済みエントリが復活することはない)。
  if (!Array.isArray(value.aiStepPendingRequests)) value.aiStepPendingRequests = [];
  const _aiStepSettledIds = new Set([...value.aiStepProcessedIds, ...value.aiStepDismissedIds]);
  value.aiStepPendingRequests = value.aiStepPendingRequests.filter((entry) =>
    entry && typeof entry === "object"
    && typeof entry.requestId === "string" && entry.requestId
    && typeof entry.taskId === "string" && entry.taskId
    && typeof entry.requestedAt === "string" && entry.requestedAt
    && !_aiStepSettledIds.has(entry.requestId));
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
  // v40: ルーティン曜日フィルタ(UI状態、null=未設定)
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
  // v229: GATE編集の表示順。既存ルールは従来の配列順を初期orderとして維持する。
  value.recurrences = value.recurrences.map((r, index) => ({
    ...r, order: Number.isFinite(r.order) ? r.order : index
  }));
  // v252: 固定化はdaily/weekdaysだけ。既存ruleのupdatedAtは移行で変更しない。
  value.recurrences = value.recurrences.map((r) => ({
    ...r, streakSince: ["daily", "weekdays"].includes(r.kind) && /^\d{4}-\d{2}-\d{2}$/.test(String(r.streakSince || ""))
      ? r.streakSince : null
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
  // v243: 12WY二軸MVPのトラック定義。normalizeでは既定値だけを補完し、updatedAtは進めない。
  if (!Array.isArray(value.tracks)) value.tracks = [];
  value.tracks = value.tracks.map((entry) => {
    const t = entry || {};
    return {
      ownerType: "project", ownerId: "", cycleStartDate: "", kind: "numeric",
      name: "", unit: "", startDate: "", deadline: "",
      baselineValue: 0, goalValue: 0, valueStep: 1,
      status: "active", closedAt: "", closedReason: "",
      supersedesTrackId: "", carriedFromTrackId: "", deleted: false,
      ...t,
      id: t.id || "trk_" + crypto.randomUUID(),
      createdAt: t.createdAt || nowDateTime(),
      updatedAt: t.updatedAt || "",
      milestones: (Array.isArray(t.milestones) ? t.milestones : []).map((milestone) => {
        const m = milestone || {};
        return {
          label: "", plannedDate: "", originalPlannedDate: "", doneAt: "",
          doneChangedAt: "", deleted: false, ...m,
          id: m.id || "ms_" + crypto.randomUUID(),
          updatedAt: m.updatedAt || ""
        };
      })
    };
  });
  // v243: numericトラックの絶対値測定履歴。
  if (!Array.isArray(value.trackMeasurements)) value.trackMeasurements = [];
  value.trackMeasurements = value.trackMeasurements.map((entry) => {
    const m = entry || {};
    return {
      trackId: "", value: 0, observedAt: "", sourceKind: "toast",
      blockId: "", note: "", deleted: false, ...m,
      id: m.id || "trm_" + crypto.randomUUID(),
      createdAt: m.createdAt || nowDateTime(),
      updatedAt: m.updatedAt || ""
    };
  });
  // v243: 週メタとコミットitemは形が異なるため、recordTypeで既定値を分離する。
  if (!Array.isArray(value.weeklyCommitments)) value.weeklyCommitments = [];
  value.weeklyCommitments = value.weeklyCommitments.map((entry) => {
    const r = entry || {};
    return r.recordType === "week" ? ({
      recordType: "week", weekStart: "", cycleStartDate: "", committedAt: "",
      committedVia: "manual", selectedBlockIds: [], deleted: false, ...r,
      id: r.id || (r.weekStart ? "wcw_" + r.weekStart : "wcw_" + crypto.randomUUID()),
      createdAt: r.createdAt || nowDateTime(),
      updatedAt: r.updatedAt || ""
    }) : ({
      weekStart: "", blockId: "", taskId: "", projectId: "", trackId: "",
      title: "", plannedDate: "", source: "confirmed", lane: "cycle",
      excused: false, excusedReason: "", excusedChangedAt: "",
      completedAt: "", completedChangedAt: "", deleted: false, ...r,
      recordType: "item",
      id: r.id || (r.weekStart && r.blockId
        ? "wci_" + r.weekStart + "_" + r.blockId
        : "wci_" + crypto.randomUUID()),
      createdAt: r.createdAt || nowDateTime(),
      updatedAt: r.updatedAt || ""
    });
  });
  if (!value._trackToastLog || typeof value._trackToastLog !== "object" || Array.isArray(value._trackToastLog)) {
    value._trackToastLog = {};
  }
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
  // v189: 直結カテゴリからも除去(残すと集計対象として生き続けるのにチェックUIから
  //       消え、解除手段が無くなる。レビューM2)
  state.settings.visionDirectCategories = (state.settings.visionDirectCategories || [])
    .filter((n) => n !== cat.name);
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
    // v189: ビジョン直結カテゴリも追従(他は全てカスケードするのにここだけ残すと、
    //       ALIGNMENTが無警告で0%になり設定チェックも外れて見える。レビューM1)
    state.settings.visionDirectCategories = (state.settings.visionDirectCategories || [])
      .map((n) => n === oldCat.name ? value : n);
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

function toggleVisionDirectCategory(category, checked) {
  if (!category) return;
  const selected = Array.isArray(state.settings.visionDirectCategories)
    ? state.settings.visionDirectCategories
    : [];
  state.settings.visionDirectCategories = checked
    ? [...new Set([...selected, category])]
    : selected.filter((name) => name !== category);
  saveState();
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
    currentView: "today",
    selectedDate: today,
    zeroThinking: { themes: [], entries: [], groups: [], suggestedThemes: [] },  // v90: groups=大テーマ / v100: suggestedThemes=AI提案お題キュー
    settings: {
      birthDate: "",
      twelveWeekStartDate: today,
      twelveWeekScoreTarget: 85,
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
    _trackToastLog: {},
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
    everStartedAt: input.everStartedAt || input.actualStartAt || "",
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
        <div class="muted" data-replan-guide style="font-size:12px">GitHubトークンを設定すると再プランを依頼できます</div>
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

function renderBottomNav() {
  const active = mobileNav.some((item) => item.id === state.currentView) ? state.currentView : "more";
  bottomNav.innerHTML = mobileNav.map((item) => `
    <button class="${active === item.id ? "active" : ""}" data-action="nav" data-view="${item.id}">${item.label}</button>
  `).join("");
}

// v146(UI改善計画Phase1-2): タスクシュートの「着手中(無ければ次の未着手)Block」を求める。
// nowConveyorTargetと同じ抽出ロジック(現在時刻に該当する未完了Block、無ければ
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
  const view = state.currentView;
  // v146レビュー対応: フォーカスガードはmain.innerHTMLを差し替える「前」に評価する(差し替え後は
  // 旧main内のフォーカス要素がDOMごと消えてbodyへ戻ってしまい、判定が構造的に効かなくなるため)。
  // 自作ガードではなく既存のisFocusInEditableElement(input/textarea/contenteditable判定)を使う。
  const isNewViewOrDate = view !== _lastScrollView || state.selectedDate !== _lastScrollDate;
  const shouldAutoScroll = isNewViewOrDate && state.selectedDate === todayISO() && !isFocusInEditableElement();
  _lastScrollView = view;
  _lastScrollDate = state.selectedDate;

  if (view === "today") main.innerHTML = renderToday();
  if (view === "wbs") main.innerHTML = renderWBS();
  if (view === "wish") main.innerHTML = renderWish();
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
  if (view === "timeline") {
    main.innerHTML = renderTimelineView();
    // v47: 今日を表示中なら現在時刻ラインへ自動スクロール(探す手間をなくす)
    if (state.selectedDate === todayISO()) {
      setTimeout(() => document.querySelector(".now-line")?.scrollIntoView({ block: "center" }), 50);
    }
  }
  if (view === "journal") main.innerHTML = renderJournal();
  if (view === "iron-log") main.innerHTML = renderIronLog();
  if (view === "instruments") main.innerHTML = renderInstruments();
  if (view === "zero") main.innerHTML = renderZeroThinking();
  if (view === "vision") main.innerHTML = renderVision();
  if (view === "ai-reports") main.innerHTML = renderAiReports();
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
// 「裁かない」思想に反するため、当日限定で表示する。
// 3日目の「続ける/手放す」選択を解決する
function resolveIdealRetry(choice) {
  const today = todayISO();
  const active = idealActiveEntry(today);
  if (!active || active.dayNum < IDEAL_RETRY_WINDOW_DAYS) return;
  if (choice === "continue") {
    // 今日を起点に新しい3日間サイクルを始める(同じ理想のまま継続)
    const meta = (state.journalMeta[today] ||= { aiMitCandidates: [], aiImported: false, ideal: "", aiTaskCandidates: [], aiRequest: "" });
    meta.ideal = active.text;
    saveAndRender("理想を続けます");
  } else {
    // 手放す: 元の理想を空にして3日間の表示窓を閉じる(否定ではなく次への区切り)
    const meta = state.journalMeta[active.date];
    if (meta) meta.ideal = "";
    saveAndRender("また次の理想を見つけましょう");
  }
}

// personal-data内の任意パスへ書き込む共通gateway。
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

// --- いま、これ(進行中 / 次のブロック)── v33: フル幅・2カラム ---
function cycleWeekProgress(dateISO) {
  const date = dateISO || state.selectedDate;
  // 12WY にチェック済みの Project のみ
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

// 今日のタスクシュート対象ブロック(着手率で共用)
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

// v200(B1): 「一度でも着手した」事実を保持する。actualStartAtはポモドーロ中断(stopPomodoro)で
// ""に戻るため、先送り判定にはeverStartedAtを使う。一度付いたら消さない(唯一の例外は
// quickCompleteの取り消し=下記toggleBlockのsnapshot復元。あれは「そもそも着手していなかった」
// を巻き戻す経路のため)。
function stampEverStarted(block) {
  if (!block || !block.actualStartAt || block.everStartedAt) return block;
  return { ...block, everStartedAt: block.actualStartAt };
}

// v200(B1): 先送りの母集合 = 「今日やると決めたこと」。taskchuteBlocksより広く、単発タスク
// (kind:"other")由来のBlockも含む。除外するのは「そもそも先送りという概念が当たらないもの」だけ:
// ルーティン(=習慣。ROUTINEパネルで別途集計)/繰り返し実体/タイムライン直接作成(=予定・拘束)/
// 中断・中止・削除タスク由来(isStaleBlock)。
function deferrableBlocks(blocks) {
  return (blocks || []).filter((b) => {
    if (b.deleted) return false;
    if (b.category === "ルーティン") return false;
    if (b.recurrenceGroupId) return false;
    if (b.source === "timeline") return false;
    if (isStaleBlock(b)) return false;
    return true;
  });
}

// v200(B1): 1分でも着手したか(完了は当然着手済み扱い)。
function blockEverStarted(b) {
  return Boolean(b && (b.completed || b.actualStartAt || b.everStartedAt));
}

// v200(B1): 先送り集計。pending=先送り予備軍(日中)/先送り確定値(日報生成時点)。
function deferralStats(blocks) {
  const list = deferrableBlocks(blocks);
  const started = list.filter(blockEverStarted).length;
  return { pending: list.length - started, started, total: list.length };
}

// タスクシュート着手率(同一の抽出)
function taskchuteStartRate(blocks) {
  const list = taskchuteBlocks(blocks);
  const done = list.filter((b) => b.completed || b.actualStartAt).length;
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}

// --- ひと目スコアボード── v33 ---
// --- 今日のタスクシュート(着手率)---
// v147(UI改善計画Phase2 2-1a): 分母をヒートマップ等と同じ「当日の全Block」へ統一すると、
// この関数自体が一覧表示する対象(Project紐づきBlockのみ)と分母がズレて「X/Yブロック」の
// 表記がY≠一覧件数になり別の混乱を生む(母数統一が意味を壊すケース)。そのため分母は
// 従来どおりProject紐づきBlockのままとし、見出しへ「(Project紐づき)」を明示する代替案を採る
// (taskchute-notes/decisions.md 2026-07-27参照)。
function weekRange(dateISO) {
  const d = parseDate(dateISO); // v56: new Date("...T00:00:00") は iOS で UTC 誤解釈のため parseDate に統一
  const dow = (d.getDay() + 1) % 7; // Sat=0, Sun=1, ... Fri=6
  const sat = addDays(dateISO, -dow);
  return { weekStart: sat, weekEnd: addDays(sat, 6) };
}

// v245: 12WY週次コミットの候補判定をこの純関数だけに閉じる。フェーズ2のtaskレーン追加時も
// 候補定義の変更点をここへ集約し、確定・自動確定・計画追加の母集合を分岐させない。
function candidateBlocksForWeek(value, weekStart) {
  const cycleStart = value?.settings?.twelveWeekStartDate || "";
  if (!cycleStart) return [];
  const range = weekRange(weekStart);
  const projects = new Map((value.projects || []).filter((project) =>
    !project.deleted && project.kind === "normal" && project.status === "active"
      && isProjectInCurrentCycle(project, cycleStart)
  ).map((project) => [project.id, project]));
  const tasks = new Map((value.tasks || []).filter((task) =>
    !task.deleted && projects.has(task.projectId)
  ).map((task) => [task.id, task]));
  return (value.blocks || []).filter((block) => {
    const task = tasks.get(block.taskId);
    return !block.deleted && !block.migratedTo && block.taskId && task
      && (block.completed || (task.status !== "suspended" && task.status !== "cancelled"))
      && block.date >= range.weekStart && block.date <= range.weekEnd;
  });
}

const COMMITMENT_SOURCE_PRIORITY = { auto: 0, confirmed: 1, added: 2 };

function commitmentItemForBlock(value, block, weekStart, source, now) {
  const id = `wci_${weekStart}_${block.id}`;
  const existing = (value.weeklyCommitments || []).find((record) => record.id === id);
  const task = (value.tasks || []).find((entry) => entry.id === block.taskId);
  const projectId = task?.projectId || "";
  const actualEndAt = block.completed ? (block.actualEndAt || now) : "";
  const completedAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(actualEndAt)
    ? actualEndAt + ":00"
    : actualEndAt;
  const incoming = {
    id, recordType: "item", weekStart, blockId: block.id,
    taskId: block.taskId, projectId,
    trackId: activeTrackForProject(value.tracks || [], projectId)?.id || "",
    title: block.title || "", plannedDate: block.date, source, lane: "cycle",
    excused: false, excusedReason: "", excusedChangedAt: "",
    completedAt, completedChangedAt: completedAt ? now : "",
    createdAt: existing?.createdAt || now, updatedAt: now, deleted: false
  };
  if (!existing) return incoming;
  const keepExcused = String(existing.excusedChangedAt || "") > String(incoming.excusedChangedAt || "");
  const keepCompleted = String(existing.completedChangedAt || "") > String(incoming.completedChangedAt || "");
  return {
    ...existing, ...incoming,
    source: (COMMITMENT_SOURCE_PRIORITY[existing.source] ?? -1) > COMMITMENT_SOURCE_PRIORITY[source]
      ? existing.source : source,
    lane: existing.lane === "cycle" ? "cycle" : incoming.lane,
    ...(keepExcused ? {
      excused: existing.excused, excusedReason: existing.excusedReason,
      excusedChangedAt: existing.excusedChangedAt
    } : {}),
    ...(keepCompleted ? {
      completedAt: existing.completedAt, completedChangedAt: existing.completedChangedAt
    } : {}),
    deleted: Boolean(existing.deleted)
  };
}

function upsertWeeklyCommitment(record) {
  state.weeklyCommitments = [
    ...(state.weeklyCommitments || []).filter((entry) => entry.id !== record.id),
    record
  ];
}

function commitWeek(weekStart, selectedBlockIds) {
  weekStart = weekRange(weekStart).weekStart;
  if (weekStart !== weekRange(todayISO()).weekStart) return;
  const candidates = candidateBlocksForWeek(state, weekStart);
  const byId = new Map(candidates.map((block) => [block.id, block]));
  const selected = [...new Set(Array.isArray(selectedBlockIds) ? selectedBlockIds : [])]
    .filter((id) => byId.has(id));
  const now = nowDateTime();
  selected.forEach((id) => upsertWeeklyCommitment(
    commitmentItemForBlock(state, byId.get(id), weekStart, "confirmed", now)
  ));
  const id = "wcw_" + weekStart;
  const existing = (state.weeklyCommitments || []).find((record) => record.id === id);
  upsertWeeklyCommitment({
    id, recordType: "week", weekStart,
    cycleStartDate: state.settings.twelveWeekStartDate || "",
    committedAt: now, committedVia: "manual", selectedBlockIds: selected,
    createdAt: existing?.createdAt || now, updatedAt: now, deleted: false
  });
  saveState();
}

function autoCommitWeekIfNeeded(block) {
  if (!block?.date) return;
  const weekStart = weekRange(block.date).weekStart;
  if (weekStart !== weekRange(todayISO()).weekStart) return;
  if ((state.weeklyCommitments || []).some((record) => record.id === "wcw_" + weekStart)) return;
  const candidates = candidateBlocksForWeek(state, weekStart);
  if (!candidates.some((candidate) => candidate.id === block.id)) return;
  const now = nowDateTime();
  candidates.forEach((candidate) => upsertWeeklyCommitment(
    commitmentItemForBlock(state, candidate, weekStart, "auto", now)
  ));
  upsertWeeklyCommitment({
    id: "wcw_" + weekStart, recordType: "week", weekStart,
    cycleStartDate: state.settings.twelveWeekStartDate || "",
    committedAt: now, committedVia: "auto", selectedBlockIds: [],
    createdAt: now, updatedAt: now, deleted: false
  });
  saveState();
}

function stampCommitmentCompletion(block, isNowCompleted) {
  if (!block?.date) return;
  const weekStart = weekRange(block.date).weekStart;
  if (weekStart !== weekRange(todayISO()).weekStart) return;
  const id = `wci_${weekStart}_${block.id}`;
  const item = (state.weeklyCommitments || []).find((record) => record.id === id && !record.deleted);
  if (!item) return;
  const now = nowDateTime();
  upsertWeeklyCommitment({
    ...item, completedAt: isNowCompleted ? now : "",
    completedChangedAt: now, updatedAt: now
  });
  saveState();
}

function trackOnBlockStarted(block) {
  autoCommitWeekIfNeeded(block);
}

function trackOnBlockCompletionChanged(block, isNowCompleted, { interactive = false } = {}) {
  autoCommitWeekIfNeeded(block);
  stampCommitmentCompletion(block, isNowCompleted);
  if (interactive && isNowCompleted) maybeShowTrackProgressToast(block);
}

function excuseCommitmentItem(itemId, reason) {
  const text = (reason || "").trim();
  if (!text) return;
  const item = (state.weeklyCommitments || []).find((record) =>
    record.id === itemId && record.recordType === "item" && !record.deleted);
  if (!item || item.weekStart !== weekRange(todayISO()).weekStart) return;
  const now = nowDateTime();
  upsertWeeklyCommitment({
    ...item, excused: true, excusedReason: text,
    excusedChangedAt: now, updatedAt: now
  });
  saveState();
}

function unexcuseCommitmentItem(itemId) {
  const item = (state.weeklyCommitments || []).find((record) =>
    record.id === itemId && record.recordType === "item" && !record.deleted);
  if (!item || item.weekStart !== weekRange(todayISO()).weekStart) return;
  const now = nowDateTime();
  upsertWeeklyCommitment({
    ...item, excused: false, excusedReason: "",
    excusedChangedAt: now, updatedAt: now
  });
  saveState();
}

function addCommitmentItems(weekStart, blockIds) {
  if (weekStart !== weekRange(todayISO()).weekStart) return;
  if (!(state.weeklyCommitments || []).some((record) =>
    record.id === "wcw_" + weekStart && record.recordType === "week" && !record.deleted)) return;
  const byId = new Map(candidateBlocksForWeek(state, weekStart).map((block) => [block.id, block]));
  const selected = [...new Set(Array.isArray(blockIds) ? blockIds : [])].filter((id) => byId.has(id));
  if (!selected.length) return;
  const now = nowDateTime();
  selected.forEach((id) => upsertWeeklyCommitment(
    commitmentItemForBlock(state, byId.get(id), weekStart, "added", now)
  ));
  saveState();
}

// v257: 12WYトラック定義CRUD。UI更新は呼び出し元に任せ、ここではstate保存だけを行う。
function closeTracksForOwner(ownerType, ownerId, reason) {
  const now = nowDateTime();
  let closed = 0;
  state.tracks = (state.tracks || []).map((track) => {
    if (track.deleted || track.status !== "active" || track.ownerType !== ownerType || track.ownerId !== ownerId) return track;
    closed += 1;
    return { ...track, status: "closed", closedAt: now, closedReason: reason, updatedAt: now };
  });
  return closed;
}

function trackRecord(projectId, kind, fields, now, links = {}) {
  const milestones = kind === "milestone" ? fields.milestones.map((milestone) => ({
    id: milestone.id || "ms_" + crypto.randomUUID(),
    label: String(milestone.label || "").trim(), plannedDate: milestone.plannedDate,
    originalPlannedDate: milestone.originalPlannedDate || milestone.plannedDate,
    doneAt: milestone.doneAt || "", doneChangedAt: milestone.doneChangedAt || "",
    updatedAt: now, deleted: Boolean(milestone.deleted)
  })) : [];
  return {
    id: "trk_" + crypto.randomUUID(), ownerType: "project", ownerId: projectId,
    cycleStartDate: state.settings.twelveWeekStartDate || "", kind,
    name: String(fields.name || "").trim(), unit: kind === "numeric" ? String(fields.unit || "").trim() : "",
    startDate: fields.startDate || "", deadline: kind === "numeric" ? fields.deadline : "",
    baselineValue: kind === "numeric" ? Number(fields.baselineValue) : 0,
    goalValue: kind === "numeric" ? Number(fields.goalValue) : 0,
    valueStep: kind === "numeric" ? Number(fields.valueStep) : 1, milestones,
    status: "active", closedAt: "", closedReason: "", supersedesTrackId: "", carriedFromTrackId: "",
    createdAt: now, updatedAt: now, deleted: false, ...links
  };
}

function mergeEditedMilestones(existing, fields, incoming, now) {
  const byId = new Map((existing || []).map((milestone) => [milestone.id, milestone]));
  const seen = new Set();
  const merged = incoming.map((next, index) => {
    const current = byId.get(fields[index].id);
    if (!current) return next;
    seen.add(current.id);
    for (const key of ["originalPlannedDate", "doneAt", "doneChangedAt", "deleted"]) {
      if (!Object.prototype.hasOwnProperty.call(fields[index], key)) next[key] = current[key];
    }
    const unchanged = ["label", "plannedDate", "originalPlannedDate", "doneAt", "deleted"]
      .every((key) => next[key] === current[key]);
    next.updatedAt = unchanged ? current.updatedAt : now;
    return next;
  });
  return [...merged, ...(existing || []).filter((milestone) => !seen.has(milestone.id))
    .map((milestone) => milestone.deleted ? milestone : { ...milestone, deleted: true, updatedAt: now })];
}

function saveTrackFromForm(projectId, kind, fields) {
  const validation = validateTrackDraft(kind, fields);
  if (!validation.ok) return validation;
  const existing = activeTrackForProject(state.tracks || [], projectId);
  const now = nowDateTime();
  let track;
  if (existing && !trackDefinitionChanged(existing, kind, fields)) {
    const incoming = trackRecord(projectId, kind, fields, now);
    if (kind === "milestone") incoming.milestones = mergeEditedMilestones(
      existing.milestones, fields.milestones, incoming.milestones, now
    );
    track = { ...existing, ...incoming, id: existing.id, cycleStartDate: existing.cycleStartDate,
      ownerType: existing.ownerType,
      createdAt: existing.createdAt, supersedesTrackId: existing.supersedesTrackId || "",
      carriedFromTrackId: existing.carriedFromTrackId || "" };
    state.tracks = state.tracks.map((entry) => entry.id === existing.id ? track : entry);
  } else {
    if (existing) closeTracksForOwner("project", projectId, "superseded");
    track = trackRecord(projectId, kind, fields, now, existing ? { supersedesTrackId: existing.id } : {});
    state.tracks = [...(state.tracks || []), track];
  }
  saveState();
  return { ok: true, track };
}

function closeActiveTrackManual(projectId) {
  if (!closeTracksForOwner("project", projectId, "manual")) return { ok: true };
  saveState();
  return { ok: true };
}

function carryProjectToNewCycle(projectId, newCycleStartDate, fields = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newCycleStartDate || "") || !dateParts(newCycleStartDate)) {
    return { ok: false, errors: ["newCycleStartDateは有効な日付が必須"] };
  }
  const project = state.projects.find((entry) => entry.id === projectId && !entry.deleted);
  if (!project) return { ok: false, errors: ["projectが見つかりません"] };
  const existing = activeTrackForProject(state.tracks || [], projectId);
  if (!existing) {
    const now = nowDateTime();
    state.projects = state.projects.map((entry) => entry.id === projectId
      ? { ...entry, twelveWeekStartDate: newCycleStartDate, updatedAt: now } : entry);
    saveState();
    return { ok: true };
  }
  const draft = existing.kind === "numeric" ? {
    name: existing.name, unit: existing.unit, startDate: newCycleStartDate, deadline: fields.deadline,
    baselineValue: latestMeasurement(state.trackMeasurements || [], existing.id)?.value ?? existing.baselineValue,
    goalValue: fields.goalValue ?? existing.goalValue, valueStep: existing.valueStep
  } : {
    name: existing.name, startDate: newCycleStartDate,
    milestones: (existing.milestones || []).filter((milestone) => !milestone.deleted && !milestone.doneAt)
      .map((milestone) => ({
        label: milestone.label, plannedDate: fields.milestonePlannedDates?.[milestone.id] || ""
      }))
  };
  // v259: 目標方向へ到達済みなら、超過分を逆向きの新trackとしてcarryしない。
  const carriedWithoutTrack = existing.kind === "milestone" ? draft.milestones.length === 0
    : fields.goalValue === undefined && numericGoalReached(existing, draft.baselineValue);
  const validation = carriedWithoutTrack ? { ok: true, errors: [] } : validateTrackDraft(existing.kind, draft);
  if (!carriedWithoutTrack && validation.ok && existing.kind === "milestone"
    && draft.milestones.some((milestone) => milestone.plannedDate < newCycleStartDate)) {
    validation.ok = false;
    validation.errors.push("plannedDateは新サイクル開始日以後が必須");
  }
  if (!validation.ok) return validation;
  const now = nowDateTime();
  state.projects = state.projects.map((entry) => entry.id === projectId
    ? { ...entry, twelveWeekStartDate: newCycleStartDate, updatedAt: now } : entry);
  closeTracksForOwner("project", projectId, "carried");
  if (carriedWithoutTrack) {
    saveState();
    return { ok: true, carriedWithoutTrack: true };
  }
  const track = trackRecord(projectId, existing.kind, draft, now, { carriedFromTrackId: existing.id });
  track.cycleStartDate = newCycleStartDate;
  state.tracks = [...state.tracks, track];
  saveState();
  return { ok: true, track };
}

// v261: WBS/後続トーストから共有する測定追記。UI副作用は呼び出し元へ任せる。
function recordTrackMeasurement(trackId, value, { sourceKind = "wbs", blockId = "", note = "" } = {}) {
  const track = (state.tracks || []).find((entry) => entry.id === trackId
    && entry.status === "active" && !entry.deleted && entry.kind === "numeric");
  if (!track) return { ok: false, errors: ["対象のトラックが見つかりません"] };
  if (!Number.isFinite(Number(value))) return { ok: false, errors: ["valueは有限数が必須"] };
  const now = nowDateTime();
  const latest = latestMeasurement(state.trackMeasurements || [], trackId);
  const observedAt = latest?.observedAt && latest.observedAt >= now
    ? dateToLocalDateTime(new Date(localDateTimeToMs(latest.observedAt) + 1000)) : now;
  const measurement = {
    id: "trm_" + crypto.randomUUID(), trackId, value: Number(value), observedAt,
    sourceKind, blockId, note, createdAt: now, updatedAt: now, deleted: false
  };
  state.trackMeasurements = [...(state.trackMeasurements || []), measurement];
  saveState();
  return { ok: true, measurement };
}

// v261: 既存節目1件だけをid指定で更新し、同期勝敗に使う親track.updatedAtも進める。
function updateTrackMilestone(trackId, milestoneId, patch) {
  const track = (state.tracks || []).find((entry) => entry.id === trackId
    && entry.status === "active" && !entry.deleted && entry.kind === "milestone");
  if (!track) return { ok: false, errors: ["対象のトラックが見つかりません"] };
  const milestone = (track.milestones || []).find((entry) => entry.id === milestoneId && !entry.deleted);
  if (!milestone) return { ok: false, errors: ["対象の節目が見つかりません"] };
  if (!patch || typeof patch !== "object" || Array.isArray(patch)
    || Object.keys(patch).some((key) => !["doneAt", "plannedDate"].includes(key))) {
    return { ok: false, errors: ["patchはdoneAt/plannedDateのみ指定できます"] };
  }
  if (Object.prototype.hasOwnProperty.call(patch, "doneAt")
    && patch.doneAt !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(patch.doneAt)) {
    return { ok: false, errors: ["doneAtは空またはYYYY-MM-DD形式が必須"] };
  }
  if (Object.prototype.hasOwnProperty.call(patch, "plannedDate") && !dateParts(patch.plannedDate)) {
    return { ok: false, errors: ["plannedDateは有効な日付が必須"] };
  }
  const now = nowDateTime();
  const nextMilestone = { ...milestone, ...patch, updatedAt: now };
  if (Object.prototype.hasOwnProperty.call(patch, "plannedDate")) nextMilestone.originalPlannedDate = milestone.originalPlannedDate || milestone.plannedDate;
  if (Object.prototype.hasOwnProperty.call(patch, "doneAt")) nextMilestone.doneChangedAt = now;
  const nextMilestones = track.milestones.map((entry) => entry.id === milestoneId ? nextMilestone : entry);
  const nextTrack = { ...track, milestones: nextMilestones, updatedAt: now };
  state.tracks = state.tracks.map((entry) => entry.id === trackId ? nextTrack : entry);
  saveState();
  return { ok: true, track: nextTrack };
}

// v39: 開いている問い(Zone 3)。最大3件、deepening を lastTouchedAt 降順で優先。
//      バッチ思考対策として全表示しない(CONCEPT §5.1)。空なら何も出さない。
async function copyReportToClipboard() {
  const report = state.reports[state.selectedDate];
  if (!report) return showToast("先に日報を生成してください");
  try {
    await navigator.clipboard.writeText(report);
    showToast("コピーしました — AIに貼り付けてください");
  } catch {
    // v214: 独立日報タブの出力textarea撤去後もiOSのClipboard API失敗時にコピーできるよう、
    // 一時textareaをDOMへ置いてexecCommandへフォールバックする(常設UIは増やさない)。
    const ta = document.createElement("textarea");
    ta.value = report;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.fontSize = "16px";
    document.body.appendChild(ta);
    ta.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch {}
    ta.remove();
    showToast(copied ? "コピーしました" : "コピーに失敗しました");
  }
}
async function shareReport() {
  const report = state.reports[state.selectedDate];
  if (!report) return showToast("先に日報を生成してください");
  try { await navigator.share({ text: report }); } catch { /* キャンセル等は無視 */ }
}

// v133: 前日フィードバックのAIタスク候補チップ。
//       候補を溜めて＋で採用し、採用せず消す×(却下)も提供する。
function aiTaskChips() {
  const today = todayISO();
  const prev = addDays(today, -1);
  const cands = state.journalMeta[prev]?.aiTaskCandidates || [];
  if (!cands.length) return "";
  return `<div class="tower-atis-chips" data-atis-task-candidates>
    ${cands.map((title, index) => `
      <span class="atis-chip">
        <button type="button" data-action="ai-task-adopt" data-index="${index}">＋ ${escapeHTML(title)}</button>
        <button type="button" data-action="ai-task-dismiss" data-index="${index}" aria-label="候補を却下">×</button>
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
// runAiMorningPlanの非同期処理(AIプランJSONのfetch等)が完了するまでtrue。
// 朝プラン処理中かどうかを、手動実行の多重起動防止と再プラン競合回避に使う。
let _morningPlanInFlight = false;
let _zeroSecThemeDraft = null;  // v75: AIプラン_*.jsonのzeroSecThemes提案(0秒思考テーマ)。{ date, items:[{theme,reason}] } 非永続(_scheduleDraftと同じ思想)

// v175: renderTimelineView(src/features/timeline.js側)は「下書きが1件も無い時だけ
// "下書きスケジュール"ボタンを出す」判定に_scheduleDraftの有無だけを見る。変数自体を
// 露出させず、この1関数越しにconfigureTimeline(deps)へ注入する。
function scheduleDraftActive() {
  return Boolean(_scheduleDraft);
}

function minToHHMM(min) {
  const m = clamp(Math.round(min), 0, 24 * 60 - 1);
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

// v199(3c): Blockの占有区間を[start,end](dayStartMin〜dayEndMinへclamp済み・分)で返す。
//   plannedStartAtが無ければnull(占有計算に使えない)。plannedEndAt欠落は
//   start+clamp(estimateMin||30,15,240)を占有、日跨ぎ(end<start)はstart→24:00を占有
//   (完全な空き扱いにしない。レビュー指摘=軽微5/重大2の解消)。computeFreeGapsと
//   runAiScheduleのskip再占有(重大1)で共用する。
function blockOccupiedRange(b, dayStartMin, dayEndMin) {
  if (!b.plannedStartAt) return null;
  const sRaw = minutesOf(b.plannedStartAt);
  let eRaw;
  if (b.plannedEndAt) {
    const eMin = minutesOf(b.plannedEndAt);
    eRaw = eMin < sRaw ? 24 * 60 : eMin;  // 日跨ぎはstart→24:00を占有
  } else {
    eRaw = sRaw + clamp(b.estimateMin || 30, 15, 240);
  }
  const s = clamp(sRaw, dayStartMin, dayEndMin);
  const e = clamp(eRaw, dayStartMin, dayEndMin);
  return e > s ? [s, e] : null;
}

// [start,end)区間の配列(occupied)を、gaps(同じく[start,end)の配列)から差し引く。
// computeFreeGapsは実Block(plannedStartAt/plannedEndAt)しか占有として見ないため、
// 「_scheduleDraftの既存下書き項目」のような非永続の占有区間を追加で差し引くための汎用ヘルパー
// (v145レビュー対応で導入。v214: 回復下書き提案の削除後もAI再配置が使用するため存置)。
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

// v59: 空き時間計算(純粋関数)。plannedStartAt を持つ当日Block(ルーティンのrec Blockも含む)
//      から占有区間を作り、dayStartMin〜dayEndMin の空き枠([start,end] 分・昇順)を返す。
//      Date を経由せず minutesOf(文字列パース)で分抽出する(iOS Safari の9時間ズレ回避ルール)。
// v199: excludeBlockIds(Set|null)を渡すと、そのidのBlockを占有計算から除外する
//   (再配置対象=可動Blockを一時的に「無いもの」として空き枠を算出するために使う。
//   省略時(null)は従来どおり全Blockを占有として扱うため既存呼び出し元は無改修)。
function computeFreeGaps(date, dayStartMin = 5 * 60, dayEndMin = 23 * 60, excludeBlockIds = null) {
  if (dayEndMin <= dayStartMin) return [];
  const occupied = blocksForDate(date)
    .filter((b) => !excludeBlockIds || !excludeBlockIds.has(b.id))
    .map((b) => blockOccupiedRange(b, dayStartMin, dayEndMin))
    .filter(Boolean)
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

// v199: 再配置の配置ウィンドウ(2026-08-10 K指示。空いていても早朝・深夜に詰め込まない)。
//   仕事Block(category==="仕事")は平日9-18のみ、それ以外(プライベート)は8-21のみ。
//   ウィンドウは定数で実装する(設定化は非目標)。
const AI_REARRANGE_WORK_WINDOW = [9 * 60, 18 * 60];
const AI_REARRANGE_PRIVATE_WINDOW = [8 * 60, 21 * 60];
const AI_REARRANGE_BUFFER_MIN = 10;  // fallbackMorningPlanのMORNING_PLAN_BUFFER_MINと同じ思想(項目間バッファ)
// v199: skipped理由の2種。runAiSchedule/draftBarHTML/rearrangeSkipMessageで共用し、
//   朝プラン/AIプラン由来のskipped理由とは無関係に保つ。
const AI_REARRANGE_SKIP_REASONS_CAPACITY = "空き時間不足(タスク過多)";
const AI_REARRANGE_SKIP_REASONS_HOLIDAY_WORK = "仕事タスクは平日9-18のみ";

// v199: dateISO("YYYY-MM-DD")が平日(月〜金)かどうか。parseDate経由でnew Date(string)のiOS TZ誤解釈を回避。
function isWeekdayDate(date) {
  const dow = parseDate(date).getDay();  // 0=日..6=土
  return dow >= 1 && dow <= 5;
}

// v199: 再配置対象Blockが配置できるウィンドウ。仕事Blockは休日はnull(=配置不可、呼び出し側でskipped行き)。
function aiRearrangeWindowFor(block, date) {
  if (block.category === "仕事") return isWeekdayDate(date) ? AI_REARRANGE_WORK_WINDOW : null;
  return AI_REARRANGE_PRIVATE_WINDOW;
}

// v199(3): 可動Blockの長さ(分)。plannedStartAt/EndAtの現予定長、日跨ぎ(end<start)は
//   (24:00−start)+end、いずれも無効ならclamp(estimateMin||30,15,240)。
//   算出方法によらず最終的に15〜240へクランプする(2026-08-11裁定: 巨大Blockが空き枠を
//   独占するのを防ぐ。fallbackMorningPlanの既存クランプ運用と揃える)。
function movableBlockMinutes(b) {
  let raw = 0;
  if (b.plannedStartAt && b.plannedEndAt) {
    const s = minutesOf(b.plannedStartAt), e = minutesOf(b.plannedEndAt);
    raw = e < s ? (24 * 60 - s) + e : e - s;  // 日跨ぎは翌日分を跨いだ長さとして数える
  }
  return clamp(raw > 0 ? raw : (b.estimateMin || 30), 15, 240);
}

// v199: 「📋 下書きスケジュール」を、当日のタスクシュート登録済みBlock(未着手のみ)を空き時間へ
//   重複なく再配置する機能へ変更(旧: WBS未Block化タスクの新規配置案。aiScheduleCandidates/
//   fallbackMorningPlanは朝プラン(runAiMorningPlan)専用として維持し、こちらは呼ばない)。
//   可動Block = taskchuteBlocks条件を満たす当日Blockのうち !completed && !actualStartAt。
//   それ以外の当日Block(ルーティン・timeline由来・完了済み・着手済み・単発Task由来)は
//   computeFreeGapsの占有計算にそのまま残す(可動Blockだけを占有から除外する)。
function runAiSchedule() {
  const date = state.selectedDate;
  const todayBlocks = blocksForDate(date);
  const movable = taskchuteBlocks(todayBlocks).filter((b) => !b.completed && !b.actualStartAt);
  if (!movable.length) return showToast("当日のタスクシュート登録タスクがありません");
  const DAY_START = 5 * 60, DAY_END = 23 * 60;
  const isToday = date === todayISO();
  const now = new Date();
  const nowFloor = isToday ? Math.min(DAY_END, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15) : DAY_START;

  // v199(重大1改訂・2026-08-11 r2裁定): 「skip確定Blockの元区間をgapsから差し引くだけ」の
  //   単純実装は、そのskipより先に(plannedStartAt昇順で)処理された可動Blockが同じ区間を
  //   先取りする「一手先取り穴」を塞げない(実機プローブ2件で確定後の実Block重複を再現)。
  //   代わりに「skipが1件でも出たら、そのBlockの元区間を固定占有に加えて可動Block全件の
  //   配置を最初からやり直す(再スタートループ)」。skipSetは1passにつき高々1件しか増えず
  //   (最初の新規skipを見つけた時点でpassを打ち切る)単調増加なので、
  //   最悪でも movable.length+1 回のpassで「新規skipが出ない」状態に収束する(決定論)。
  const skipSet = new Set();          // これまでのpassで確定したskip対象のBlock id
  const skipReasonById = new Map();   // blockId -> skipped理由
  let finalItems = [];
  for (let pass = 0; pass <= movable.length; pass += 1) {
    // skipSet済みのBlockはexcludeBlockIdsに含めない=通常の固定Blockと同じにcomputeFreeGapsが
    // 占有として数える(reoccupySkipの特別扱いを廃し、computeFreeGapsの通常経路に一本化)。
    const activeMovable = movable.filter((b) => !skipSet.has(b.id));
    const activeIds = new Set(activeMovable.map((b) => b.id));
    let gaps = computeFreeGaps(date, DAY_START, DAY_END, activeIds)
      .map(([s, e]) => [Math.max(s, nowFloor), e])
      .filter(([s, e]) => e - s >= 15);
    // plannedStartAt昇順(安定)で前詰め。空き枠プールは全Block共有(仕事/プライベートでウィンドウが
    // 重なる=9-18は8-21の部分集合のため、ウィンドウ別に空き枠を分けず同じgapsを実消費で共有する)。
    const ordered = [...activeMovable].sort((a, b) => (a.plannedStartAt || "99").localeCompare(b.plannedStartAt || "99"));
    const passItems = [];
    let newSkip = null;
    for (const b of ordered) {
      const win = aiRearrangeWindowFor(b, date);
      if (!win) { newSkip = { id: b.id, reason: AI_REARRANGE_SKIP_REASONS_HOLIDAY_WORK }; break; }
      const minutes = movableBlockMinutes(b);
      let start = null;
      for (const [s, e] of gaps) {
        const cs = Math.max(s, win[0]), ce = Math.min(e, win[1]);  // 空き枠とウィンドウの交差
        if (ce - cs >= minutes) { start = cs; break; }
      }
      if (start === null) { newSkip = { id: b.id, reason: AI_REARRANGE_SKIP_REASONS_CAPACITY }; break; }
      passItems.push({
        id: crypto.randomUUID(), blockId: b.id, title: b.title, taskId: b.taskId || "",
        category: b.category || "", start, minutes, aiStart: start, aiMinutes: minutes
      });
      // +10分バッファを空けてgapsプールから消費(fallbackMorningPlanと同じ思想)
      gaps = subtractOccupiedIntervals(gaps, [[start, start + minutes + AI_REARRANGE_BUFFER_MIN]])
        .filter(([s, e]) => e - s >= 15);
    }
    if (!newSkip) { finalItems = passItems; break; }  // このpassで新規skipが出なければ収束
    skipSet.add(newSkip.id);
    skipReasonById.set(newSkip.id, newSkip.reason);
    // ループ末尾: 次のpassでnewSkip.idはactiveMovableから外れ、computeFreeGapsが通常の
    // 固定Blockとして占有計算する(reoccupy済み状態からの再計算)。
  }
  const skipped = movable
    .filter((b) => skipSet.has(b.id))
    .map((b) => ({ title: b.title, reason: skipReasonById.get(b.id) }));
  _scheduleDraft = { date, items: finalItems, skipped, source: "deterministic" };  // v62: source区別
  _draftUndo = null; _draftUndoHistoryEntry = null;  // v62: 新規下書きでは前セッションのUndoを持ち越さない
  state.timelineMode = "planned";
  setView("timeline");
  // v199(4b・中3修正): 入り切らないBlockが1件以上あれば、成功トーストの代わりに理由別の
  //   通知を出す(draftBarHTML側の警告行と同旨・rearrangeSkipMessageで文言を共通化)。
  const skipMsg = rearrangeSkipMessage(skipped);
  showToast(skipMsg || "空き時間へ自動配置しました — ドラッグで調整して「確定」してください");
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

// v199(中3修正・2026-08-11裁定): draft barの警告行とトーストで共用する文言ビルダー。
//   従来は理由を区別せず常に「タスク過多」と表示していたため、休日の仕事Blockしかskipされて
//   いない日でも「タスク過多」と誤誘導していた。理由別に件数を分けて文言を組み立てる
//   (⚠を付けずに返すのはcaller側の責務。skipped無し/対象理由0件なら空文字を返す)。
function rearrangeSkipMessage(skipped) {
  const capacityCount = skipped.filter((s) => s.reason === AI_REARRANGE_SKIP_REASONS_CAPACITY).length;
  const holidayCount = skipped.filter((s) => s.reason === AI_REARRANGE_SKIP_REASONS_HOLIDAY_WORK).length;
  const parts = [];
  if (capacityCount) parts.push(`${capacityCount}件が空き時間に入り切りません(タスク過多)`);
  if (holidayCount) parts.push(`${holidayCount}件が休日のため配置されません(仕事タスクは平日9-18のみ)`);
  return parts.length ? `⚠ ${parts.join(" / ")}` : "";
}

function draftBarHTML() {
  if (!_scheduleDraft || _scheduleDraft.date !== state.selectedDate) return "";
  const skipped = _scheduleDraft.skipped || [];  // v59: 朝プランで「配置しない」と判断した候補
  // v62: AI由来(自宅PCバッチ生成のAIプラン)か決定論配置由来かを小さく区別表示する
  const sourceLabel = _scheduleDraft.source === "ai-plan" ? "🤖 AIプラン由来"
    : _scheduleDraft.source === "ai-replan" ? "🤖 AI再プラン由来"
    : "⚙ 決定論配置";
  // v199(4b・中3修正): 再配置で入り切らなかったBlockが1件以上あれば警告行を出す(トーストと同旨・
  //   理由別文言はrearrangeSkipMessageで共通化)。中2修正: 色は#c0392bのハードコードをやめ、
  //   ダーク実測運用済みの既存トークン--red(styles.css)に揃える(旧色は--panel上コントラスト比
  //   約2.9:1でWCAG AA未達だった)。
  const rearrangeSkipMsg = rearrangeSkipMessage(skipped);
  return `
    <div class="draft-bar">
      <span>📋 下書き ${_scheduleDraft.items.length}件(${sourceLabel}) — ドラッグで移動 / 下端をドラッグで長さ調整 / ×で外す</span>
      <span class="row" style="gap:6px">
        ${_draftUndo ? `<button class="btn ghost" data-action="draft-undo">↩ 元に戻す</button>` : ""}
        <button class="btn primary" data-action="draft-confirm">確定して登録</button>
        <button class="btn ghost" data-action="draft-discard">破棄</button>
      </span>
    </div>
    ${rearrangeSkipMsg ? `<div class="draft-overload-warning" style="font-size:12px; color:var(--red); margin:-4px 0 4px">
      ${escapeHTML(rearrangeSkipMsg)}
    </div>` : ""}
    ${skipped.length ? `<div class="draft-skipped-list muted" style="font-size:11.5px; line-height:1.6; margin:-4px 0 8px">
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
        <div class="check-row" style="flex-wrap:wrap">
          <div style="flex:1; min-width:180px">
            <div class="check-row-name">${escapeHTML(t.theme)}</div>
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
  let updatedCount = 0, createdCount = 0;  // v199(軽微3): 確定トーストを「登録」と「時刻更新」で書き分ける
  items.forEach((it) => {
    // v199: blockId付き項目(当日タスクシュート再配置)は既存Blockの時刻だけ更新する。
    //   makeBlockしない=新規Block化しない。migratedTo/carryCount系(繰越専用)も通さない。
    if (it.blockId) {
      // v199(軽微4): 下書き作成後に対象Blockが消えていた場合(削除等)は空振りさせない。
      //   状態変更なし・aiScheduleHistoryへも記録しない(「確定」と偽装しない)。
      if (!state.blocks.some((b) => b.id === it.blockId)) return;
      state.blocks = state.blocks.map((b) => b.id === it.blockId ? {
        ...b,
        plannedStartAt: `${date}T${minToHHMM(it.start)}`,
        plannedEndAt: `${date}T${minToHHMM(it.start + it.minutes)}`,
        updatedAt: nowDateTime()  // v135以降のid+updatedAtマージ対策
      } : b);
      recordScheduleHistory(it, "confirmed", date, it.source || draftSource);
      updatedCount += 1;
      return;
    }
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
    // item.source優先(合流下書きでの出どころ誤ラベル防止。draft-discard/removeと同じ方針)
    recordScheduleHistory(it, "confirmed", date, it.source || draftSource);
    // v59: 繰り越し由来の下書きは元Blockに migratedTo を設定(carryOverBlockと同じ二重繰越防止セマンティクス)
    if (it.carryFromId) {
      state.blocks = state.blocks.map((b) => b.id === it.carryFromId ? { ...b, migratedTo: block.id, updatedAt: nowDateTime() } : b);
    }
    createdCount += 1;
  });
  _scheduleDraft = null;
  _draftUndo = null; _draftUndoHistoryEntry = null;  // v62: 確定済みの下書きへのUndoは意味を持たない
  // v199(軽微3): blockId分岐は「登録」ではなく「時刻更新」のため、件数に応じて文言を書き分ける
  //   (旧文言「📋 N件のBlockを登録しました」を再配置フローにそのまま流用していたのは不正確だった)
  const confirmParts = [];
  if (updatedCount) confirmParts.push(`${updatedCount}件の時刻を更新`);
  if (createdCount) confirmParts.push(`${createdCount}件を登録`);
  saveAndRender(confirmParts.length ? `📋 ${confirmParts.join("・")}しました` : "対象のBlockが見つからず、確定できませんでした");
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
async function tryFetchAiPlan(date, freeGaps, providedData = null) {
  const raw = providedData ? JSON.stringify(providedData) : await fetchGitHubRawText(`AIプラン_${date}.json`);
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

function setReplanUi(kind, message) {
  _replanUi = { kind, message };
  if (app?.dataset.view === "today" || app?.dataset.view === "settings") renderDeferringForFocus();
}

function stopReplanPolling() {
  if (_replanPollTimer !== null) clearTimeout(_replanPollTimer);
  _replanPollTimer = null;
}

function finishReplan(kind, message) {
  stopReplanPolling();
  _replanPending = null;
  setReplanUi(kind, message);
}

async function requestReplan() {
  if (!personalDataReady(state.settings.github)) {
    setReplanUi("error", "GitHubトークンを設定すると再プランを依頼できます");
    return;
  }
  if (_morningPlanInFlight || _scheduleDraft) {
    setReplanUi("error", _morningPlanInFlight
      ? "朝プランを作成中です。完了後に再度お試しください"
      : "未確定の下書きがあります。タイムラインで確認してください");
    return;
  }
  // v196: 実行計画の叩き台(plan-step)の下書きと同時に走らせない(既存排他機構に倣う)。
  if (_planStepPending || _planStepDraft) {
    setReplanUi("error", "実行計画の依頼を処理中です。完了後に再度お試しください");
    return;
  }
  stopReplanPolling();
  const now = new Date();
  const request = {
    requestId: `${now.getTime()}-${crypto.randomUUID().slice(0, 8)}`,
    date: todayISO(),
    requestedAt: now.toISOString(),
    fromTime: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
  };
  _replanPending = { ...request, startedAtMs: now.getTime() };
  setReplanUi("sending", "再プラン依頼を送信中");
  try {
    await pushGitHubPath("requests/replan-request.json", `${JSON.stringify(request, null, 2)}\n`, "");
    setReplanUi("pending", "依頼受付済み・数分後に反映");
    scheduleReplanPoll();
  } catch {
    finishReplan("error", "依頼の送信に失敗しました");
  }
}

function scheduleReplanPoll() {
  stopReplanPolling();
  if (!_replanPending) return;
  _replanPollTimer = setTimeout(pollReplanResponse, REPLAN_POLL_MS);
}

async function pollReplanResponse() {
  if (!_replanPending || _replanPollBusy) return;
  _replanPollBusy = true;
  try {
    const result = await fetchGitHubRawResult("requests/replan-response.json", "text", { cache: "no-store" });
    if (result.ok) {
      let response;
      try { response = JSON.parse(result.text); } catch {
        finishReplan("error", "再プランの取得に失敗しました(応答形式を確認してください)");
        return;
      }
      if (response?.requestId === _replanPending.requestId) {
        if (_replanPending.date !== todayISO()) {
          finishReplan("error", "日付が変わったため前日の再プランを破棄しました");
          return;
        }
        if (response.status === "budget_exceeded" || response.status === "limit_exceeded") {
          finishReplan("limit", "本日の再プラン上限");
          return;
        }
        if (response.status === "error") {
          const reason = typeof response.reason === "string"
            ? response.reason.trim().replace(/\s+/g, " ").slice(0, 60) : "";
          finishReplan("error", `再プランの生成に失敗しました${reason ? `: ${reason}` : ""}`);
          return;
        }
        if (response.status !== "ok") {
          finishReplan("error", "再プランの取得に失敗しました(応答形式を確認してください)");
          return;
        }
        const now = new Date();
        const nowFloor = Math.min(23 * 60, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15);
        const freeGaps = computeFreeGaps(_replanPending.date, 5 * 60, 23 * 60)
          .map(([s, e]) => [Math.max(s, nowFloor), e]).filter(([s, e]) => e - s >= 15);
        const aiPlan = freeGaps.length ? await tryFetchAiPlan(_replanPending.date, freeGaps, response) : null;
        if (!aiPlan) {
          finishReplan("error", "再プランの取得に失敗しました(内容を確認してください)");
          return;
        }
        if (_morningPlanInFlight || _scheduleDraft) {
          finishReplan("error", "既存の下書きがあります。タイムラインで確認してから再度依頼してください");
          return;
        }
        _scheduleDraft = { date: _replanPending.date, items: aiPlan.items, skipped: aiPlan.skipped, source: "ai-replan" };
        _draftUndo = null; _draftUndoHistoryEntry = null;
        finishReplan("success", "下書きが届きました。タイムラインで確認してください");
        showToast("🤖 下書きが届きました。タイムラインで確認してください");
        return;
      }
    } else if (result.status === 401 || result.status === 403) {
      finishReplan("error", "再プランの取得に失敗しました(GitHub権限を確認してください)");
      return;
    }
  } catch (error) {
    console.warn("再プラン応答の取得を次回再試行します:", error?.message || error);
  } finally {
    _replanPollBusy = false;
    if (_replanPending) {
      if (Date.now() - _replanPending.startedAtMs >= REPLAN_TIMEOUT_MS) {
        finishReplan("timeout", "届いていません(PC起動を確認)");
      } else {
        scheduleReplanPoll();
      }
    }
  }
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
  // 再プラン応答も同じ_scheduleDraftへ届くため、依頼中は朝プランを並走させない。
  if (_replanPending) {
    if (!auto) showToast("再プラン依頼中です。応答後に朝プランを実行してください");
    return;
  }
  // 完了(どの早期returnでもfinallyで確実に)までフラグを立て、手動の多重実行で
  // _scheduleDraftを取り合わないようにする。
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
    push("report", "日報", date, text, { view: "journal", date });
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

function carryOverBlock(id, { forceMIT = false, toDate = todayISO(), toastMessage = "今日へ繰り越しました" } = {}) {
  const src = blockById(id);
  if (!src || src.migratedTo) return;
  const shift = (dt) => dt ? `${toDate}${dt.slice(10)}` : "";  // 予定時刻は同 HH:mm のまま送付先へ
  const block = makeBlock({
    taskId: src.taskId, date: toDate, title: src.title, category: src.category,
    plannedStartAt: shift(src.plannedStartAt), plannedEndAt: shift(src.plannedEndAt),
    estimateMin: src.estimateMin
  });
  block.source = src.source || "";
  block.carryCount = (src.carryCount || 0) + 1;  // v61: 繰り越し回数を1つ積み上げる
  if (forceMIT) {
    // v61: 儀式で「今日やる」を選んだ場合はMIT化(既存の最大3個ルールは尊重する)
    const sameDayMITs = state.blocks.filter((b) => !b.deleted && b.date === toDate && b.isMIT);
    if (sameDayMITs.length < 3) block.isMIT = true;
  }
  state.blocks.push(block);
  // 旧ブロックを「繰り越し済み」に(未完了リストから外れ、再提案されない)
  state.blocks = state.blocks.map((b) => b.id === src.id ? { ...b, migratedTo: block.id, updatedAt: nowDateTime() } : b);
  saveAndRender(toastMessage);
}

// v186 F2: DRIFTの提案は確認儀式を挟まず、既存の繰り越し意味論で今日から明日へ送る。
function postponeBlockToNextDay(id) {
  carryOverBlock(id, {
    toDate: addDays(todayISO(), 1),
    toastMessage: "明日へ送りました"
  });
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

// v168: WishタブTier1(CRUD・リスト描画)はsrc/features/wish.jsへ移動した
// (getWishProject/getSubtasksOf/wishProgress/nextStepOf/wishLastActivity/isWishStagnant/
// wishGroupKey/wishGroupLabel/lifeAreaColor/renderWish/renderWishCard/renderWishDetail/
// renderWishSubtask/addWish/toggleWishOpen/addWishSubtask/toggleWishSubtask/
// wishSubtaskToTasks/realizeWish/unrealizeWish/deleteWish。app.js分割・段階4-2、
// wish.js冒頭コメント参照)。getWishProject/nextStepOf/wishSubtaskToTasksは
// 冒頭のimportで共有する。

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
  maybeQueueNextAiStep(id, task.status);  // v198(第3弾3e): 完了6経路#5。task.statusはmap前のprevStatus
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
      ${state.settings.twelveWeekStartDate ? '<button class="btn ghost twy-commit-open" data-action="twy-open-commit">今週を確定</button>' : ""}
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

function nextSiblingOrder(siblings) {
  const maxOrder = siblings.reduce((max, task) =>
    Number.isFinite(task?.order) && (max === null || task.order > max) ? task.order : max, null);
  return maxOrder === null ? 1000 : maxOrder + 1000;
}

function midpointOrder(beforeOrder, afterOrder) {
  if (!Number.isFinite(beforeOrder) || !Number.isFinite(afterOrder)) return null;
  return (beforeOrder + afterOrder) / 2;
}

// v194: 実行計画の並び順 — **同一親の兄弟だけを並べる配列専用**の比較。両方に order が
// 入っているときだけ order 昇順を使い、それ以外は従来の wbsTaskCompare へ完全に委ねる
// (片方だけ order を持つ混在期に「完了は下に沈む」不変条件を壊さないため)。
// 親を跨ぐ配列(aiScheduleCandidates 等)へは使わない。推移律が壊れるため。
function siblingTaskCompare(a, b) {
  if (Number.isFinite(a.order) && Number.isFinite(b.order) && a.order !== b.order) {
    return a.order - b.order;
  }
  return wbsTaskCompare(a, b);
}

// v195: 実行計画UI。操作対象はplanTarget親の直下にいる兄弟だけに限定する。
function planParentFor(task) {
  if (!task?.parentTaskId) return null;
  const parent = state.tasks.find((t) => !t.deleted && t.id === task.parentTaskId);
  return parent?.planTarget ? parent : null;
}

function planStepSiblings(task) {
  return state.tasks
    .filter((t) => !t.deleted && t.parentTaskId === task.parentTaskId)
    .sort(siblingTaskCompare);
}

// v195: ↑↓の入れ替え相手と活性判定は「画面に見えている兄弟」で決める。全兄弟で判定すると、
// 完了を隠す/中断を隠す設定のときに非表示ステップとorderを交換して「押しても何も動かない」
// (2回押さないと動かない)状態になる。WBSの可視判定(renderProjectTree)と同じ規則。
function planStepVisibleSiblings(task) {
  const showSusp = Boolean(state.settings.showSuspended);
  const siblings = planStepSiblings(task).filter((t) => showSusp || !isTaskSuspended(t));
  if (!state.settings.wbsHideCompleted) return siblings;
  const hasOpenDescendant = (t) => state.tasks.some((c) => !c.deleted && c.parentTaskId === t.id
    && (c.status !== "completed" || hasOpenDescendant(c)));
  return siblings.filter((t) => t.status !== "completed" || hasOpenDescendant(t));
}

function ensurePlanSiblingOrders(task, changedAt, force = false) {
  const sorted = planStepSiblings(task);
  const needsNumbering = force || sorted.some((t, i) =>
    !Number.isFinite(t.order) || (i > 0 && t.order <= sorted[i - 1].order));
  if (!needsNumbering) return { siblings: sorted, changed: false };
  const orderById = new Map(sorted.map((t, i) => [t.id, (i + 1) * 1000]));
  state.tasks = state.tasks.map((t) => orderById.has(t.id)
    ? { ...t, order: orderById.get(t.id), updatedAt: changedAt }
    : t);
  const refreshed = new Map(state.tasks.map((t) => [t.id, t]));
  return { siblings: sorted.map((t) => refreshed.get(t.id)), changed: true };
}

// v198(第3弾3e): Kの完了操作(6経路)を引き金にAIステップを予約するトリガー。
// phase3-design.md §1の発火条件6つ(全部AND)を判定し、成立時だけ引き継ぎシートを開く。
// prevStatusは呼び出し元(各完了経路)が遷移前の値を渡す(updateTaskFieldのような汎用setter内には
// 置かない。実装設計書F節)。
function maybeQueueNextAiStep(stepTaskId, prevStatus) {
  if (prevStatus === "completed") return;  // 条件1: 遷移でのみ発火(再保存では発火しない)
  const step = state.tasks.find((t) => t.id === stepTaskId && !t.deleted);
  if (!step || step.status !== "completed") return;
  const parent = planParentFor(step);           // 条件2
  if (!parent) return;
  if (step.owner !== "k") return;                // 条件3
  const siblings = planStepSiblings(step);        // UI設定非依存(planStepVisibleSiblingsは誤用注意)
  const index = siblings.findIndex((t) => t.id === stepTaskId);
  if (index < 0) return;
  const next = siblings.slice(index + 1).find((t) => t.status !== "completed" && t.status !== "cancelled");
  if (!next || next.owner !== "ai") return;       // 条件4
  if (next.aiStatus !== "none" && next.aiStatus !== "error") return;  // 条件5
  if (!personalDataReady()) return;               // 条件6
  if (_replanPending || _scheduleDraft || _morningPlanInFlight || _planStepPending) return;
  if (_aiStepPending) {
    // 誤発火・多重発火の遮断(design§1): 一気に複数完了しても発火は同時に1件だけ
    showToast("AIステップは1件ずつ実行します");
    return;
  }
  openAiStepConfirm(stepTaskId, next);
}

// 完了の取り消し(6経路のうち「同じボタンで戻す」toggleTask/toggleTaskCompleteFromBlock)で
// 確認シートが対象ステップを開いたままなら閉じる(design§1「誤発火・多重発火の遮断」)。
function closeAiStepConfirmIfUndone(stepTaskId) {
  if (_aiStepConfirmCtx && _aiStepConfirmCtx.stepTaskId === stepTaskId
    && state.modal && state.modal.type === "aiStepConfirm") closeModal();
}

function openAiStepConfirm(stepTaskId, nextStep) {
  _aiStepPending = { stepTaskId, nextStepTaskId: nextStep.id };
  _aiStepConfirmCtx = { stepTaskId, nextStepTaskId: nextStep.id };
  state.modal = { type: "aiStepConfirm", id: nextStep.id };
  renderModal(buildAiStepConfirmModal(nextStep));
}

function buildAiStepConfirmModal(nextStep) {
  return `
    <div class="modal-card ai-step-confirm-modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">次のAIステップを実行します</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <p class="ai-step-confirm-title">▸ ${escapeHTML(nextStep.title)} <span class="chip">AI</span></p>
        <div style="margin-top:10px">
          <div class="muted" style="font-size:11px; margin-bottom:4px">引き継ぎメモ(任意)</div>
          <textarea class="textarea" data-ai-step-confirm-note rows="3" style="min-height:80px" placeholder="AIに伝えたいこと"></textarea>
        </div>
        <div class="row" style="margin-top:12px; gap:8px">
          <button class="btn primary" data-action="ai-step-confirm-send">AIに渡す</button>
          <button class="btn ghost" data-action="ai-step-confirm-later">あとで</button>
        </div>
      </div>
    </div>`;
}

// 「AIに渡す」押下時の状態確定(design§1「保留状態の永続化」)。この順で行う:
// handoffNote保存 → requestId発行 → aiStatus=queued永続化 → 保留台帳へ追記 → 送信シームを呼ぶ。
function resolveAiStepConfirmSend() {
  if (!_aiStepConfirmCtx) return;
  const { stepTaskId, nextStepTaskId } = _aiStepConfirmCtx;
  // v198(レビューR2→堅牢性レビュー修正4): シート表示中でも同期pull(visibilitychange→
  // runAutoSyncPull)で前提が崩れ得るため、送信直前に発火条件6つ全部(maybeQueueNextAiStepと
  // 同じ判定)を再検証する(シームより手前。3f+3gの実PUTでもそのまま効く)。崩れていたら
  // 送信せずシートを閉じ、aiStatusは変更しない。
  const srcStep = state.tasks.find((t) => t.id === stepTaskId && !t.deleted);
  const parent = srcStep ? planParentFor(srcStep) : null;  // 条件2
  const siblings = srcStep ? planStepSiblings(srcStep) : [];
  const srcIndex = siblings.findIndex((t) => t.id === stepTaskId);
  const recomputedNext = srcIndex < 0 ? null
    : siblings.slice(srcIndex + 1).find((t) => t.status !== "completed" && t.status !== "cancelled");
  const stillValid = srcStep && srcStep.status === "completed"  // 条件1
    && parent  // 条件2
    && srcStep.owner === "k"  // 条件3
    && recomputedNext && recomputedNext.id === nextStepTaskId && recomputedNext.owner === "ai"  // 条件4
    && (recomputedNext.aiStatus === "none" || recomputedNext.aiStatus === "error")  // 条件5
    && personalDataReady() && !(_replanPending || _scheduleDraft || _morningPlanInFlight || _planStepPending);  // 条件6
  if (!stillValid) {
    closeModal();
    showToast("状況が変わったため送信を取りやめました");
    return;
  }
  const nextStep = recomputedNext;
  const noteEl = document.querySelector("[data-ai-step-confirm-note]");
  const handoffNote = (noteEl?.value || "").trim();
  const now = new Date();
  const requestId = `${now.getTime()}-${crypto.randomUUID().slice(0, 8)}`;
  const requestedAt = now.toISOString();  // C-9: ミリ秒付きUTC(parseAiStepIsoToMs専用形式)
  const changedAt = nowDateTime();
  state.tasks = state.tasks.map((t) => t.id === nextStepTaskId
    ? { ...t, handoffNote, aiStatus: "queued", aiStepRequestId: requestId, aiStepRequestedAt: requestedAt, updatedAt: changedAt }
    : t);
  state.aiStepPendingRequests = [...state.aiStepPendingRequests, { requestId, taskId: nextStepTaskId, requestedAt }];
  saveState();
  closeModal();
  putAiStepRequest({ requestId, taskId: nextStepTaskId, handoffNote, requestedAt });
}

// v198(第3弾3e): request PUT・占有チェック(GET-then-PUT)は3f+3gの担当。この単位では
// 「必ず失敗する」スタブとして実装し、C-3の補償処理をその場で行う(理由: aiStatus="queued"の
// まま送信手段が無いと「永久にqueuedで動かないステップ」が作れてしまうため。補償に落とすことで
// どのコミット境界でも詰み状態を作らない)。3f+3gがこの中身を「占有チェック+実PUT(失敗時は
// 同じ補償)」へ差し替える。
function putAiStepRequest(payload) {
  compensateAiStepRequest(payload.requestId, payload.taskId);
  showToast("送信はまだ有効になっていません(次のリリースで有効化)");
}

// design§1「PUT失敗・結果不明の補償(C-3)」: requestIdをdismissedへ追加→aiStatus=error→
// aiStepRequestId/aiStepRequestedAtをnullへ戻す。取消と同じ規律(dismissed追加により、後から
// 届く応答があっても採用しない)。
function compensateAiStepRequest(requestId, taskId) {
  const changedAt = nowDateTime();
  if (requestId && !state.aiStepDismissedIds.includes(requestId)) {
    state.aiStepDismissedIds = [...state.aiStepDismissedIds, requestId];
  }
  state.tasks = state.tasks.map((t) => t.id === taskId
    ? { ...t, aiStatus: "error", aiStepRequestId: null, aiStepRequestedAt: null, updatedAt: changedAt }
    : t);
  state.aiStepPendingRequests = state.aiStepPendingRequests.filter((e) => e.requestId !== requestId);
  saveState();
}

function togglePlanStepOwner(id) {
  const task = state.tasks.find((t) => t.id === id && !t.deleted);
  if (!task || !planParentFor(task)) return;
  const changedAt = nowDateTime();
  ensurePlanSiblingOrders(task, changedAt);
  const owner = task.owner === "ai" ? "k" : "ai";
  state.tasks = state.tasks.map((t) => t.id === id
    ? { ...t, owner, aiWork: owner === "ai", updatedAt: changedAt }
    : t);
  saveAndRender(`担当を${owner === "ai" ? "AI" : "K"}に変更しました`);
}

function movePlanStep(id, direction) {
  if (direction !== -1 && direction !== 1) return;
  const task = state.tasks.find((t) => t.id === id && !t.deleted);
  if (!task || !planParentFor(task)) return;
  const changedAt = nowDateTime();
  const numbered = ensurePlanSiblingOrders(task, changedAt);
  // 入れ替え相手は「見えている兄弟」から選ぶ(非表示ステップと交換して無反応になるのを防ぐ)
  const visible = planStepVisibleSiblings(task);
  const index = visible.findIndex((t) => t.id === id);
  const other = index < 0 ? null : visible[index + direction];
  if (!other) {
    if (numbered.changed) saveAndRender("実行計画の順序を採番しました");
    return;
  }
  const ownOrder = visible[index].order;
  state.tasks = state.tasks.map((t) => {
    if (t.id === id) return { ...t, order: other.order, updatedAt: changedAt };
    if (t.id === other.id) return { ...t, order: ownOrder, updatedAt: changedAt };
    return t;
  });
  saveAndRender("ステップを移動しました");
}

function addPlanStepBelow(id) {
  const task = state.tasks.find((t) => t.id === id && !t.deleted);
  if (!task || !planParentFor(task)) return;
  const changedAt = nowDateTime();
  let numbered = ensurePlanSiblingOrders(task, changedAt);
  let index = numbered.siblings.findIndex((t) => t.id === id);
  let after = numbered.siblings[index + 1];
  let order = after ? midpointOrder(numbered.siblings[index].order, after.order) : nextSiblingOrder(numbered.siblings);
  if (after && !(order > numbered.siblings[index].order && order < after.order)) {
    numbered = ensurePlanSiblingOrders(task, changedAt, true);
    index = numbered.siblings.findIndex((t) => t.id === id);
    after = numbered.siblings[index + 1];
    order = midpointOrder(numbered.siblings[index].order, after.order);
  }
  if (numbered.changed) saveState();
  openTaskCreator({ projectId: task.projectId, parentTaskId: task.parentTaskId, category: task.category || "", order });
}

function aiStepStatusLabel(status) {
  return ({ queued: "待機中", running: "実行中", done: "完了", blocked: "質問あり", error: "失敗" })[status] || "";
}

// v196: 実行計画の叩き台をAIに作らせる(第2弾b)。plan-request.json契約(existingStepsは
// 既存サブタスクのtitle/owner/statusのみ同梱)。
function buildPlanStepRequestTask(task) {
  const existingSteps = state.tasks
    .filter((t) => !t.deleted && t.parentTaskId === task.id)
    .sort(siblingTaskCompare)
    .map((t) => ({ title: t.title || "", owner: t.owner === "ai" ? "ai" : "k", status: t.status || "todo" }));
  return {
    title: task.title || "", description: task.description || "",
    doneCriteria: task.doneCriteria || "", firstStep: task.firstStep || "",
    dueDate: task.dueDate || "", existingSteps
  };
}

// 応答検証(アプリ側)。requestId/taskId一致は呼び出し側で確認済み。stepsは2〜7件・
// title非空31字未満・ownerが"k"|"ai"以外は全体不採用(nullを返す。部分採用しない)。
function validatePlanStepDraftSteps(rawSteps) {
  if (!Array.isArray(rawSteps) || rawSteps.length < 2 || rawSteps.length > 7) return null;
  const steps = [];
  for (const raw of rawSteps) {
    if (!raw || typeof raw !== "object") return null;
    const title = raw.title;
    if (typeof title !== "string" || !title.trim() || title.length > 30) return null;
    const owner = raw.owner;
    if (owner !== "k" && owner !== "ai") return null;
    const aiBrief = raw.aiBrief;
    if (aiBrief !== undefined && (typeof aiBrief !== "string" || aiBrief.length > 200)) return null;
    const note = raw.note;
    if (note !== undefined && (typeof note !== "string" || note.length > 200)) return null;
    steps.push({
      title: title.trim(), owner,
      aiBrief: typeof aiBrief === "string" ? aiBrief.trim() : "",
      note: typeof note === "string" ? note.trim() : ""
    });
  }
  return steps;
}

function setPlanStepUi(kind, message, taskId) {
  _planStepUi = { kind, message, taskId: taskId !== undefined ? taskId : _planStepUi.taskId };
  refreshPlanStepModalIfOpen();
}

// 表示中のタスク編集モーダルが対象のとき「だけ」再描画する(他タブ・他モーダルへは波及させない)。
// **必ず rerenderActiveModal 経由にする**: 直接 renderModal(buildTaskModal(task)) を呼ぶと
// 未保存の入力(説明・完了条件など)が消える。この関数は依頼ボタン押下直後("sending")にも、
// 最長15分後の応答到着時にも走るため、「説明を書いてから📋を押す」で必ず踏む。
function refreshPlanStepModalIfOpen() {
  if (!state.modal || state.modal.type !== "task" || !state.modal.id) return;
  const task = state.tasks.find((t) => !t.deleted && t.id === state.modal.id);
  if (task) rerenderActiveModal();
}

function stopPlanStepPolling() {
  if (_planStepPollTimer !== null) clearTimeout(_planStepPollTimer);
  _planStepPollTimer = null;
}

function schedulePlanStepPoll() {
  stopPlanStepPolling();
  if (!_planStepPending) return;
  _planStepPollTimer = setTimeout(pollPlanStepResponse, PLAN_STEP_POLL_MS);
}

function finishPlanStep(kind, message) {
  const taskId = _planStepPending?.taskId || "";
  stopPlanStepPolling();
  _planStepPending = null;
  setPlanStepUi(kind, message, taskId);
}

async function requestPlanStep(taskId) {
  const task = state.tasks.find((t) => !t.deleted && t.id === taskId);
  if (!task) return;
  if (!personalDataReady(state.settings.github)) {
    setPlanStepUi("error", "GitHubトークンを設定すると実行計画をAIに依頼できます", taskId);
    return;
  }
  // v196: 再プラン・朝プランの下書きと同時に走らせない(既存排他機構に倣う)。
  if (_replanPending || _scheduleDraft || _morningPlanInFlight) {
    setPlanStepUi("error", "既存の下書き処理が進行中です。完了後に再度お試しください", taskId);
    return;
  }
  if (_planStepPending || _planStepDraft) {
    setPlanStepUi("error", "既に実行計画の依頼が進行中です", taskId);
    return;
  }
  stopPlanStepPolling();
  const now = new Date();
  const request = {
    requestId: `${now.getTime()}-${crypto.randomUUID().slice(0, 8)}`,
    taskId, requestedAt: now.toISOString(),
    task: buildPlanStepRequestTask(task)
  };
  _planStepPending = { requestId: request.requestId, taskId, startedAtMs: now.getTime() };
  setPlanStepUi("sending", "依頼を送信中", taskId);
  try {
    await pushGitHubPath("requests/plan-request.json", `${JSON.stringify(request, null, 2)}\n`, "");
    setPlanStepUi("pending", "依頼受付済み・数分後に反映", taskId);
    schedulePlanStepPoll();
  } catch {
    _planStepPending = null;
    setPlanStepUi("error", "依頼の送信に失敗しました", taskId);
  }
}

async function pollPlanStepResponse() {
  if (!_planStepPending || _planStepPollBusy) return;
  _planStepPollBusy = true;
  try {
    const result = await fetchGitHubRawResult("requests/plan-response.json", "text", { cache: "no-store" });
    if (result.ok) {
      let response;
      try { response = JSON.parse(result.text); } catch {
        finishPlanStep("error", "実行計画の取得に失敗しました(応答形式を確認してください)");
        return;
      }
      if (response?.requestId === _planStepPending.requestId && response?.taskId === _planStepPending.taskId) {
        if (response.status === "budget_exceeded" || response.status === "limit_exceeded") {
          finishPlanStep("limit", "本日の実行計画作成の上限");
          return;
        }
        if (response.status === "error") {
          const reason = typeof response.reason === "string"
            ? response.reason.trim().replace(/\s+/g, " ").slice(0, 60) : "";
          finishPlanStep("error", `生成に失敗しました${reason ? `: ${reason}` : ""}`);
          return;
        }
        if (response.status !== "ok") {
          finishPlanStep("error", "取得に失敗しました(応答形式を確認してください)");
          return;
        }
        const steps = validatePlanStepDraftSteps(response.steps);
        if (!steps) {
          finishPlanStep("error", "取得に失敗しました(内容を確認してください)");
          return;
        }
        _planStepDraft = { requestId: response.requestId, taskId: response.taskId, steps, generatedAt: response.generatedAt || "" };
        finishPlanStep("success", `AIが${steps.length}個のステップを提案しています`);
        showToast("🤖 実行計画の下書きが届きました");
        return;
      }
    } else if (result.status === 401 || result.status === 403) {
      finishPlanStep("error", "取得に失敗しました(GitHub権限を確認してください)");
      return;
    }
  } catch (error) {
    console.warn("実行計画応答の取得を次回再試行します:", error?.message || error);
  } finally {
    _planStepPollBusy = false;
    if (_planStepPending) {
      if (Date.now() - _planStepPending.startedAtMs >= PLAN_STEP_TIMEOUT_MS) {
        finishPlanStep("timeout", "届いていません(PC起動を確認)");
      } else {
        schedulePlanStepPoll();
      }
    }
  }
}

// 承認: ステップをサブタスクとして作成する(既存サブタスクは触らない・追加のみ)。
// orderは既存兄弟の後ろへ1000刻み、親のplanTargetを自動ON、owner==="ai"ならaiWorkも揃える(v195の規則)。
function approvePlanStepDraft() {
  if (!_planStepDraft) return;
  const { taskId, steps } = _planStepDraft;
  const task = state.tasks.find((t) => !t.deleted && t.id === taskId);
  if (!task) { _planStepDraft = null; _planStepUi = { kind: "idle", message: "", taskId: "" }; return; }
  const changedAt = nowDateTime();
  // 既存兄弟(通常はorder未設定)を先に1000刻みで採番してから追加する。v195の
  // togglePlanStepOwner/movePlanStep/addPlanStepBelow と同じ規律。これを省くと
  // 「order有り(新規)とorder無し(既存)」の混在で siblingTaskCompare が非一貫になり、
  // 新しいステップが既存ステップより上に描画される。title/status/owner は変えないので
  // 「追加のみ」の原則は維持される。
  const firstChild = state.tasks.find((t) => !t.deleted && t.parentTaskId === taskId);
  if (firstChild) ensurePlanSiblingOrders(firstChild, changedAt);
  let order = nextSiblingOrder(state.tasks.filter((t) => !t.deleted && t.parentTaskId === taskId));
  const newTasks = steps.map((s) => {
    const t = makeTask({ projectId: task.projectId, parentTaskId: taskId, title: s.title, category: task.category || "" });
    t.owner = s.owner;
    t.aiWork = s.owner === "ai";
    // aiBrief は owner==="ai" のときだけ意味を持つ(モーダルもその条件で表示する)。
    // kステップに入れると画面から見えない死にデータになるため落とす。
    t.aiBrief = s.owner === "ai" ? (s.aiBrief || "") : "";
    // note(Kへの補足)は捨てずに引き継ぎメモへ入れる
    t.handoffNote = s.note || "";
    // 実行計画のステップは既定で期日なし。makeTask は未指定だと state.selectedDate を入れるため
    // 明示的に空へ戻す(期日が付くと朝プラン候補・ホームの期限リストへ最大7件が無言で流入する)。
    t.dueDate = "";
    t.order = order;
    t.updatedAt = changedAt;
    order += 1000;
    return t;
  });
  state.tasks = state.tasks.map((t) => t.id === taskId ? { ...t, planTarget: true, updatedAt: changedAt } : t);
  state.tasks.push(...newTasks);
  const count = newTasks.length;
  _planStepDraft = null;
  _planStepUi = { kind: "idle", message: "", taskId: "" };
  closeModal();
  saveAndRender(`実行計画から${count}個のサブタスクを作成しました`);
}

function discardPlanStepDraft() {
  if (!_planStepDraft) return;
  _planStepDraft = null;
  setPlanStepUi("idle", "", "");
}

// タスク編集モーダル内の依頼ボタン/下書き承認UI。draftがこのtaskに届いていれば承認/破棄、
// なければ依頼ボタン(他タスクの依頼が進行中/未設定なら無効+案内)。
function renderPlanStepSectionHTML(task) {
  // 3階層制限(addSubtask/WBSの canAddSub と同じ規律)。depth2で依頼するとdepth3の子が
  // 2〜7件でき、「タスク→ステップ列はdepth1」という設計の不変条件が破れる。
  if (getTaskDepth(task) >= 2) return "";
  if (_planStepDraft && _planStepDraft.taskId === task.id) {
    const steps = _planStepDraft.steps;
    return `<div class="field plan-step-draft">
      <div class="field-label">📋 AIが${steps.length}個のステップを提案しています</div>
      <ul class="plan-step-draft-list">${steps.map((s) => `
        <li><b>${s.owner === "ai" ? "AI" : "K"}</b> ${escapeHTML(s.title)}
          ${s.aiBrief ? `<div class="muted" style="font-size:12px">${escapeHTML(s.aiBrief)}</div>` : ""}
          ${s.note ? `<div class="muted" style="font-size:12px">${escapeHTML(s.note)}</div>` : ""}</li>`).join("")}</ul>
      <div class="row" style="gap:8px">
        <button class="btn primary" data-action="plan-step-approve">サブタスクとして作成</button>
        <button class="btn" data-action="plan-step-discard">破棄</button>
      </div>
    </div>`;
  }
  const notReady = !personalDataReady(state.settings.github);
  // v196: 再プラン/朝プランの下書き処理中も相互排他でボタンを止める(既存排他機構に倣う)。
  const otherFlowBusy = !notReady && Boolean(_replanPending || _scheduleDraft || _morningPlanInFlight);
  const busyOther = !notReady && !otherFlowBusy
    && ((_planStepPending && _planStepPending.taskId !== task.id) || (_planStepDraft && _planStepDraft.taskId !== task.id));
  const busySelf = !notReady && !otherFlowBusy && !busyOther && _planStepPending && _planStepPending.taskId === task.id;
  let hint = "";
  if (notReady) hint = "GitHubトークンを設定すると実行計画をAIに依頼できます";
  else if (otherFlowBusy) hint = "再プラン等の下書き処理中です";
  else if (busyOther) hint = "他タスクの実行計画を処理中です";
  else if (busySelf) hint = _planStepUi.message || "依頼を処理中です";
  else if (_planStepUi.taskId === task.id && ["error", "limit", "timeout"].includes(_planStepUi.kind)) hint = _planStepUi.message;
  const disabled = notReady || otherFlowBusy || busyOther || busySelf;
  return `<div class="field plan-step-request">
    <button class="btn" data-action="plan-step-request" data-id="${task.id}" ${disabled ? "disabled" : ""}>📋 実行計画をAIに作らせる</button>
    ${hint ? `<div class="muted" style="font-size:12px">${escapeHTML(hint)}</div>` : ""}
  </div>`;
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

// v260: 12WY成果トラックはWBS内でstateを読むだけの表示専用行として描画する。
function renderTwyTrackBlock(project) {
  if (!project?.twelveWeekStartDate) return "";
  const track = activeTrackForProject(state.tracks || [], project.id);
  return `${canCarryProjectCycle(project) ? renderTwyStaleNote(project) : ""}${track ? renderTwyTrackRow(track) : ""}`;
}

function renderTwyStaleNote(project) {
  return `<div class="twy-stale-note" data-action="edit-project" data-id="${escapeHTML(project.id)}">
    前サイクルのプロジェクトです。タップして新サイクルへ移行
  </div>`;
}

function roundToStep(value, step) {
  const amount = Number(value), size = Number(step);
  if (!Number.isFinite(amount) || !(size > 0)) return "";
  const decimals = Math.min(10, (String(size).split(".")[1] || "").length);
  const rounded = Number((Math.round(amount / size) * size).toFixed(decimals));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function mdFmt(iso) {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return match ? `${Number(match[1])}/${Number(match[2])}` : "";
}

function twyNumericValueHTML(track, latestValue, pace, status, achievedISO) {
  const unit = escapeHTML(track.unit || "");
  const current = Number(latestValue), goal = Number(track.goalValue);
  let paceHTML = "";
  if (status.state === "done") {
    paceHTML = `<span class="twy-pace pos">${escapeHTML(mdFmt(achievedISO))} 達成</span>`;
  } else if (status.state === "stale") {
    paceHTML = `<span class="twy-pace">ペース不明</span>`;
  } else if (!pace.invalid) {
    const diff = roundToStep(pace.diffRaw, track.valueStep);
    if (diff !== "") paceHTML = `<span class="twy-pace ${pace.diffNorm >= 0 ? "pos" : "neg"}">${diff !== "0" && pace.diffRaw >= 0 ? "+" : ""}${diff}${unit}</span>`;
  }
  const valueHTML = Number.isFinite(current) && Number.isFinite(goal)
    ? `<span class="twy-val">${current}<small>/${goal}${unit}</small></span>` : "";
  return `${valueHTML}${paceHTML}`;
}

function twyMilestoneValueHTML(pace, status, milestones, today) {
  if (status.state === "done") {
    const latestDoneAt = milestones.reduce((latest, milestone) => {
      const doneAt = String(milestone.doneAt || "");
      return doneAt > latest ? doneAt : latest;
    }, "");
    return `<span class="twy-val">${pace.done}<small>/${pace.total}節目</small></span>
      <span class="twy-pace pos">${escapeHTML(mdFmt(latestDoneAt))} 達成</span>`;
  }
  const next = milestones.find((milestone) => !milestone.doneAt);
  const overdue = next?.plannedDate && next.plannedDate < today;
  const detail = next ? `${overdue ? "残" : "次"}: ${escapeHTML(next.label)}${overdue ? "" : ` ${escapeHTML(mdFmt(next.plannedDate))}`}` : "";
  return `<span class="twy-val">${pace.done}<small>/${pace.total}節目</small></span>
    ${detail ? `<span class="twy-pace${overdue ? " neg" : ""}">${detail}</span>` : ""}`;
}

function twyBarHTML(track, latestValue, pace, status) {
  const baseline = Number(track.baselineValue), goal = Number(track.goalValue);
  const pct = goal === baseline ? 0 : clamp((Number(latestValue) - baseline) / (goal - baseline) * 100, 0, 100);
  const markerPct = pace.invalid || status.state === "done" ? null
    : clamp((pace.expected - baseline) / (goal - baseline) * 100, 0, 100);
  const barClass = status.label === "期限超過" ? "s-warn" : status.state === "done" ? "s-ahead" : `s-${status.state}`;
  const unit = escapeHTML(track.unit || "");
  return `<div class="twy-bar ${barClass}"><span style="width:${pct}%"></span>
      ${markerPct === null ? "" : `<i style="left:${markerPct}%"></i>`}</div>
    <div class="twy-bar-scale"><span>${baseline}${unit}</span><span>${goal}${unit}</span></div>`;
}

function twyMilestoneChainHTML(milestones, today) {
  let nextAssigned = false;
  return `<div class="twy-ms">${milestones.map((milestone) => {
    const done = Boolean(milestone.doneAt), late = !done && milestone.plannedDate < today;
    const next = !done && !late && !nextAssigned;
    if (next) nextAssigned = true;
    const cls = done ? "done" : late ? "late" : next ? "next" : "";
    let dateHTML = escapeHTML(done ? `${mdFmt(milestone.doneAt)} 済`
      : late ? `${mdFmt(milestone.plannedDate)} 超過` : mdFmt(milestone.plannedDate));
    if (!done && milestone.originalPlannedDate && milestone.originalPlannedDate !== milestone.plannedDate) {
      dateHTML = `<del>${escapeHTML(mdFmt(milestone.originalPlannedDate))}</del>${escapeHTML(mdFmt(milestone.plannedDate))} 予定変更済`;
    }
    return `<span class="twy-ms-node ${cls}"><span class="twy-ms-dot">${done ? "✓" : late ? "!" : ""}</span>
      <span class="twy-ms-label">${escapeHTML(milestone.label)}</span><span class="twy-ms-date">${dateHTML}</span></span>`;
  }).join("")}</div>`;
}

// v261: 開いている行だけにエディタDOMを生成し、複数行の同時展開を許す。
function twyEditorHTML(track) {
  if (!_twyOpenEditorIds.has(track.id)) return "";
  return track.kind === "numeric" ? twyNumericEditorHTML(track) : twyMilestoneEditorHTML(track);
}

function twyNumericEditorHTML(track) {
  const measurement = latestMeasurement(state.trackMeasurements || [], track.id);
  const latest = measurement ? measurement.value : track.baselineValue;
  return `<div class="twy-editor">
    <label>現在値 <input type="number" inputmode="decimal" step="${escapeHTML(track.valueStep)}"
      value="${escapeHTML(latest)}" data-twy-editor-value></label>
    <span class="unit">${escapeHTML(track.unit)}</span>
    <button type="button" data-action="twy-save-measurement" data-id="${escapeHTML(track.id)}">記録</button>
    <button type="button" class="cancel" data-action="twy-close-editor" data-id="${escapeHTML(track.id)}">取消</button>
  </div>`;
}

function twyMilestoneEditorHTML(track) {
  const milestones = (track.milestones || []).filter((milestone) => !milestone.deleted)
    .slice().sort((a, b) => (a.plannedDate || "").localeCompare(b.plannedDate || ""));
  return `<div class="twy-editor twy-editor-ms">
    ${milestones.map((milestone) => `<div class="twy-ms-edit-item">
      <label class="checkbox-line"><input type="checkbox" data-action="twy-ms-toggle-done"
        data-id="${escapeHTML(track.id)}" data-twy-ms-id="${escapeHTML(milestone.id)}"
        ${milestone.doneAt ? "checked" : ""}>${escapeHTML(milestone.label)}</label>
      <input type="date" data-twy-ms-date-input value="${escapeHTML(milestone.plannedDate)}">
      <button type="button" data-action="twy-ms-edit-date" data-id="${escapeHTML(track.id)}"
        data-twy-ms-id="${escapeHTML(milestone.id)}">変更</button>
    </div>`).join("")}
    <button type="button" class="cancel" data-action="twy-close-editor"
      data-id="${escapeHTML(track.id)}">閉じる</button>
  </div>`;
}

function renderTwyTrackRow(track) {
  const today = todayISO();
  const measurement = latestMeasurement(state.trackMeasurements || [], track.id);
  const latestValue = track.kind === "numeric" ? (measurement ? Number(measurement.value) : Number(track.baselineValue)) : undefined;
  const lastObservedISO = measurement ? String(measurement.observedAt || "").slice(0, 10) : track.startDate;
  const pace = track.kind === "numeric" ? paceNumeric(track, latestValue, today) : paceMilestone(track, today);
  const status = trackStatus(track, pace, latestValue, lastObservedISO, today);
  const stateClass = status.label === "期限超過" ? "s-overdue" : `s-${status.state}`;
  const milestones = track.kind === "milestone" ? (track.milestones || []).filter((item) => !item.deleted)
    .slice().sort((a, b) => String(a.plannedDate || "").localeCompare(String(b.plannedDate || ""))) : [];
  const valueHTML = track.kind === "numeric"
    ? twyNumericValueHTML(track, latestValue, pace, status, lastObservedISO)
    : twyMilestoneValueHTML(pace, status, milestones, today);
  const metaHTML = track.kind === "numeric"
    ? (status.state === "done" ? `期限 ${mdFmt(track.deadline)}`
      : `最終 ${mdFmt(lastObservedISO)}${status.state === "stale" ? `・${trackDaysBetween(lastObservedISO, today)}日前` : ""}`)
    : `期限 ${mdFmt(pace.deadline)}${status.label === "期限超過" ? " 超過" : ""}`;
  return `<div class="twy-row s-${status.state}" data-twy-track-id="${escapeHTML(track.id)}">
    <div class="twy-row-top"><span class="t-state ${stateClass}">${escapeHTML(status.label)}</span>${valueHTML}
      <span class="twy-meta">${escapeHTML(metaHTML)}</span>
      <button type="button" class="twy-update-btn${status.state === "done" ? " twy-correct" : ""}"
        data-action="twy-open-editor" data-id="${escapeHTML(track.id)}">${status.state === "done" ? "訂正" : "更新"}</button>
    </div>
    ${track.kind === "numeric" ? twyBarHTML(track, latestValue, pace, status) : twyMilestoneChainHTML(milestones, today)}
    ${twyEditorHTML(track)}
  </div>`;
}

function renderProjectTree(project) {
  const allTasksOfProject = state.tasks.filter((task) => !task.deleted && task.projectId === project.id);
  const progress = taskProgress(allTasksOfProject);
  const is12WY = Boolean(project.twelveWeekStartDate);
  const hideOldProgress = is12WY && project.status === "active"
    && isProjectInCurrentCycle(project, state.settings.twelveWeekStartDate);
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
  const rootTasks = visibleTasks.filter((t) => !t.parentTaskId).sort(siblingTaskCompare);  // v48: 未完了→期限順、完了は下へ / v194: order優先
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
      ${renderTwyTrackBlock(project)}
      ${project.showProgress && !hideOldProgress ? renderProjectProgressAgg(liveTasks) : ""}
      ${collapsed
        ? `<div class="muted" style="font-size:12px; margin-top:6px">${rootTasks.length ? `${visibleTasks.length}件のタスク(折りたたみ中)` : "Task未登録"}</div>`
        : `<div class="stack">
            ${rootTasks.length
              ? rootTasks.map((t) => renderTaskTree(t, visibleTasks, 0, hideOldProgress)).join("")
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

function renderTaskTree(task, allTasksOfProject, depth, hideProgress = false) {
  const children = allTasksOfProject.filter((t) => t.parentTaskId === task.id).sort(siblingTaskCompare);  // v48 / v194: order優先
  const indent = depth * 18;
  const collapsed = Boolean(task.collapsed);  // v33: 折りたたみ
  return `
    <div style="margin-left:${indent}px">
      ${renderTaskRow(task, depth, children.length > 0, collapsed, hideProgress)}
      ${children.length && !collapsed
        ? children.map((c) => renderTaskTree(c, allTasksOfProject, depth + 1, hideProgress)).join("")
        : ""}
    </div>
  `;
}

function renderTaskRow(task, depth = 0, hasChildren = false, collapsed = false, hideProgress = false) {
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
  const planParent = planParentFor(task);
  const planSiblings = planParent ? planStepVisibleSiblings(task) : [];  // v195: 活性判定も可視兄弟基準
  const planIndex = planSiblings.findIndex((t) => t.id === task.id);
  const aiStatus = aiStepStatusLabel(task.aiStatus);
  const planMetaHTML = planParent ? `
        <button class="plan-owner-badge ${task.owner === "ai" ? "ai" : "k"}" data-action="toggle-plan-owner" data-id="${task.id}"
          aria-label="担当を${task.owner === "ai" ? "K" : "AI"}に切り替える">${task.owner === "ai" ? "AI" : "K"}</button>
        ${aiStatus ? `<span class="badge plan-status">${aiStatus}</span>` : ""}` : "";
  const planActionsHTML = planParent ? `
        <button class="btn ghost plan-move" data-action="move-plan-step" data-id="${task.id}" data-direction="-1" aria-label="1つ上へ" ${planIndex <= 0 ? "disabled" : ""}>↑</button>
        <button class="btn ghost plan-move" data-action="move-plan-step" data-id="${task.id}" data-direction="1" aria-label="1つ下へ" ${planIndex < 0 || planIndex >= planSiblings.length - 1 ? "disabled" : ""}>↓</button>
        <button class="btn ghost" data-action="add-plan-step-below" data-id="${task.id}">＋ 下に追加</button>` : "";
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
        ${planMetaHTML}
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
      ${hideProgress ? "" : progressHTML}
      <div class="row wbs-actions">
        ${planActionsHTML}
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
    ${carryOverPanel()}
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
  // v186レビュー(M-1): migratedTo付きBlock(翌日へ送済)は実行ビューからも消さず、控えめな
  // バッジ+減光で「送済」と分かるようにする(最小実装。タイムラインカードと同じ意匠)。
  const isMigrated = Boolean(block.migratedTo);
  const migratedBadgeHTML = isMigrated
    ? `<span class="migrated-badge" title="明日へ送りました">→送済</span>` : "";
  return `
    <div class="item block-row ${isMIT ? "is-mit" : ""}${doing ? " is-doing" : ""}${justStarted}${isMigrated ? " is-migrated" : ""}" ${leftBorder ? `style="${leftBorder}"` : ""}>
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
          ${migratedBadgeHTML}
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

// v171: assignBlocksToLanes/adjustLaneTopPositionsはsrc/features/timeline-layout.jsへ
//   移動した(app.js分割・段階4-5・段階A)。呼び出しはファイル冒頭のimportを参照する。

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

function remainingTextNormal(remainingMs) {
  const sec = Math.max(0, Math.floor(remainingMs / 1000));
  return `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`;
}

// v169: renderMorningEnergyPicker/renderConditionMorningExtra/renderEveningConditionCard/
// lastGymRecord/renderGymLogCard(+CONDITION_CAPACITY_OPTIONS/
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
function defaultBatterySettings() {
  return {
    start: { deficit: 30, low: 40, normal: 50 },
    decayPerHour: 3,
    decayStartMinutes: 420,
    max: 50
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
    guide: "毎週末に自動生成されます。来週のタスク提案は内容を確認して1件ずつWBSへ登録できます" },
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

// v197(第3弾3d, C-9): aiStepRequestedAt等(toISOString()が返すミリ秒付きUTC、
// "YYYY-MM-DDTHH:mm:ss.sssZ")をmsへ変換する。parseUtcIsoToMs(直上、ミリ秒付きを拒否)・
// localDateTimeToMs(ローカル時刻専用でZサフィックスを無視し9時間ズレる)のどちらも
// この用途には使えないため新設する。new Date(文字列)は経由しない(AGENTS.md規約、
// iOS Safariのnew Date(string)誤解釈対策と同じ方針。Date.UTCの数値コンストラクタなら曖昧さが無い)。
// パース不能な値はnullを返す(呼び出し側は経過時間判定をスキップし、表示を安全側へ倒す)。
function parseAiStepIsoToMs(s) {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const hour = Number(m[4]), minute = Number(m[5]), second = Number(m[6]);
  const millis = m[7] ? Number(m[7].padEnd(3, "0")) : 0;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  // v198(堅牢性レビュー修正5): Date.UTC()は月13・2月30日等の桁上がりをそのまま採用し、
  // 別の有効な日時へ正規化してしまう(new Date(文字列)と同種の危険)。作った値(数値msから
  // 構築するnew Date、文字列パースではないためAGENTS.md規約に抵触しない)から各要素を
  // 取り出し、入力値と完全一致するときだけ採用する(検証器loop/scripts/ai-step-validate.py
  // の同種修正と対応させる)。
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day
    || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second
    || check.getUTCMilliseconds() !== millis
  ) return null;
  return ms;
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
// index側の反映遅延に関わらずAIレポート画面の「未来からの手紙」タブが空にならないようにする。
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
    const weeklyPrefix = AI_REPORT_TYPES.find((type) => type.id === "weekly")?.prefix || "週次レビュー_";
    if (fileName.startsWith(weeklyPrefix) && fileName.endsWith(".md")) {
      cachedWeeklyReviewMd[fileName.slice(weeklyPrefix.length, -3)] = result.text;
    }
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
  const renderedBody = body === undefined
    ? "読み込み中..."
    : (type.id === "weekly"
      ? renderAiWeeklyReportBody(selectedDate, body)
      : renderMarkdown(body || "（本文を取得できませんでした）"));
  return `
    <div class="row" style="margin:10px 0">
      <select data-ai-report-date data-type-id="${type.id}" style="font-size:16px">
        ${files.map((f) => `<option value="${escapeHTML(f.date)}" ${f.date === selectedDate ? "selected" : ""}>${escapeHTML(f.date)}</option>`).join("")}
      </select>
    </div>
    <div class="panel">
      <div class="md-render readonly-md">${renderedBody}</div>
    </div>
  `;
}

// v217: 旧週次タブにあった「来週のタスク提案」をAIレポートの週次レビュー本文へ移設。
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

const _weeklySuggestRegistered = new Set();  // 二重登録防止(セッション内のみ) "week:index"

function renderAiWeeklyReportBody(week, md) {
  const { rest, tasks, sectionNote } = splitWeeklyReviewMd(md || "");
  const report = renderMarkdown(rest || "（本文を取得できませんでした）");
  if (!tasks.length) return report;
  return `${report}
    <div class="ai-weekly-suggest">
      <div class="ai-weekly-suggest-cap">来週のタスク提案</div>
      ${sectionNote ? `<div class="muted" style="font-size:11.5px; margin-bottom:6px">${escapeHTML(sectionNote)}</div>` : ""}
      ${tasks.map((task, index) => {
        const key = `${week}:${index}`;
        const registered = _weeklySuggestRegistered.has(key);
        return `
          <div class="ai-weekly-suggest-row">
            <span class="ai-weekly-suggest-text">${escapeHTML(task)}</span>
            ${registered
              ? `<span class="muted" style="font-size:12px">✓ 登録済み</span>`
              : `<button class="btn ghost" data-action="weekly-suggest-add" data-week="${week}" data-index="${index}">+登録</button>`}
          </div>`;
      }).join("")}
    </div>`;
}

const SUGGEST_ESTIMATE_RE = /[((]\s*(\d+)\s*分\s*[))]\s*$/;
function parseSuggestedTaskTitle(raw) {
  const m = SUGGEST_ESTIMATE_RE.exec(raw.trim());
  if (!m) return { title: raw.trim(), estimateMin: null };
  return { title: raw.slice(0, m.index).trim(), estimateMin: Number(m[1]) };
}

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
  if (estimateMin) task.estimateMin = estimateMin;
  state.tasks.push(task);
  _weeklySuggestRegistered.add(key);
  saveAndRender(`「${title}」をWBSに登録しました`);
}

function visionAlignmentData(date, directCategories, nowMs = Date.now()) {
  const direct = new Set(Array.isArray(directCategories) ? directCategories : []);
  const timeLog = statsTimeLogData(date, nowMs);
  const directSeconds = timeLog.categories
    .filter((item) => direct.has(item.category))
    .reduce((sum, item) => sum + item.seconds, 0);
  return {
    directSeconds,
    totalSeconds: timeLog.totalSeconds,
    percent: timeLog.totalSeconds > 0
      ? Math.round(directSeconds / timeLog.totalSeconds * 100)
      : 0
  };
}

function renderVisionAlignment() {
  const directCategories = Array.isArray(state.settings.visionDirectCategories)
    ? state.settings.visionDirectCategories
    : [];
  if (directCategories.length === 0) {
    return `
      <section class="panel vision-alignment">
        <h2>ALIGNMENT <span class="muted">今日のビジョン直結率</span></h2>
        <button class="btn primary" data-action="vision-open-direct-settings">直結カテゴリを設定</button>
      </section>
    `;
  }
  const alignment = visionAlignmentData(todayISO(), directCategories);
  return `
    <section class="panel vision-alignment">
      <h2>ALIGNMENT <span class="muted">今日のビジョン直結率</span></h2>
      <div class="vision-alignment-value">${alignment.percent}<small>%</small></div>
      <div class="vision-alignment-gauge" aria-label="ビジョン直結率 ${alignment.percent}%">
        <span style="width:${alignment.percent}%"></span>
      </div>
      <div class="muted vision-alignment-detail">
        実績のみ(ワンタップ計時を含む) ${statsHMS(alignment.directSeconds)} / ${statsHMS(alignment.totalSeconds)}
      </div>
      <div class="muted vision-alignment-categories">直結: ${directCategories.map(escapeHTML).join("・")}</div>
    </section>
  `;
}

function renderVision() {
  const section = state.settings.visionSection || "vision";
  return `
    ${renderHeader("方向性を見失わないための場所", "ビジョン")}
    ${renderVisionAlignment()}
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
// ジャーナル/ホーム「AIから」は再描画(完了トグル1回等)のたびに前日分まで
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

// 設定13パネルを目的別4群のdetails(既定閉、共有foldSection利用)へ。
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
      (APIキーは不要)。操作ボタンと候補チップは今日タブのATISへ集約しています。
    </div>
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
  const theme = ["light", "dark", "cockpit", "auto"].includes(state.settings.theme) ? state.settings.theme : "dark";
  const towerMotion = ["normal", "calm", "off"].includes(state.settings.towerMotion) ? state.settings.towerMotion : "normal";
  return `
    <h3>🌗 テーマ</h3>
    <div class="muted" style="font-size:12px; line-height:1.6">
      画面配色です。既定はダーク。コックピットは全画面を管制室調にします。「OS追従」は端末の外観設定に合わせます。
    </div>
    <label>テーマ
      <select class="select" data-setting-field="theme">
        <option value="dark" ${theme === "dark" ? "selected" : ""}>ダーク</option>
        <option value="light" ${theme === "light" ? "selected" : ""}>ライト</option>
        <option value="cockpit" ${theme === "cockpit" ? "selected" : ""}>コックピット</option>
        <option value="auto" ${theme === "auto" ? "selected" : ""}>OS追従</option>
      </select>
    </label>
    <label>タワーの動き
      <select class="select" data-setting-field="towerMotion">
        <option value="normal" ${towerMotion === "normal" ? "selected" : ""}>通常</option>
        <option value="calm" ${towerMotion === "calm" ? "selected" : ""}>控えめ(常時アニメを停止)</option>
        <option value="off" ${towerMotion === "off" ? "selected" : ""}>なし(数字の更新は続く)</option>
      </select>
    </label>
  `;
}

function renderSettingsFileStructurePanel() {
  return `
    <details class="panel fold settings-file-structure">
      <summary class="fold-summary"><span class="fold-chevron">▶</span>現在のファイル構成</summary>
      <div class="fold-body">
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
    <div class="muted vision-direct-note">
      「直結」はALIGNMENTの集計対象です。カテゴリ改名には追従しません。改名後はここで選び直してください。
    </div>
    <button class="btn primary" data-action="add-category">+ カテゴリを追加</button>
  `;
}

function renderSettingsPagesPanel() {
  return `
    <h3>GitHub Pages</h3>
    <div class="muted">このフォルダをGitHubリポジトリへpushし、Pagesの公開元をルートにすると公開できます。</div>
    <a class="btn" href="./concept.html" target="_blank" rel="noopener">設計思想(CONCEPT)</a>
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
      id: "settings-display", label: "表示・タイマー(テーマ・ガイド付きアクセス)",
      body: [renderSettingsThemePanel(), renderSettingsGuidedAccessPanel()]
    },
    {
      id: "settings-master", label: "マスタ・詳細(プロフィール・カテゴリ管理・ファイル構成)",
      body: [renderSettingsProfilePanel(), renderSettingsCategoryPanel(), renderSettingsFileStructurePanel()]
    }
  ];
  return `
    ${renderHeader("Web版の保存と公開", "設定")}
    <section class="settings-grid">
      ${foldSection(groups[0].id, false, "settings-group", "settings-group-summary", groups[0].label,
        `<div class="stack" style="gap:16px">${groups[0].body.join("")}</div>`)}
      ${foldSection(groups[1].id, false, "settings-group", "settings-group-summary", groups[1].label,
        `<div class="stack" style="gap:16px">${groups[1].body.join("")}</div>`)}
      ${renderSettingsSyncGroup(github)}
      ${foldSection(groups[2].id, false, "settings-group", "settings-group-summary", groups[2].label,
        `<div class="stack" style="gap:16px">${groups[2].body.join("")}</div>`)}
    </section>
  `;
}

// v148レビュー対応(2系統レビューFAIL項目2): 「データと同期」群だけ、他3群と違って
// foldSection(localStorage記憶)を使わない専用実装にする(_settingsSyncOpenOverrideの
// 宣言・経緯コメントはファイル冒頭のモジュール変数群を参照)。
function renderSettingsSyncGroup(github) {
  // v148レビュー対応(項目5): 認証エラーバナー(pd-auth-banner、personalDataAuthError)からの
  // 設定遷移でもこの群を自動openにし、トークン再入力欄に直行できるようにする
  // (syncAlertMessage()と同じ「異常」の意味合いで扱う)。
  const dynamicOpen = Boolean(syncAlertMessage()) || Boolean(_personalDataAuthError);
  const open = dynamicOpen || Boolean(_settingsSyncOpenOverride);
  const body = [renderSettingsDataPanel(), renderSettingsCloudPanel(github), renderSettingsPagesPanel()].join("");
  return `
    <details class="fold panel settings-group" data-settings-sync ${open ? "open" : ""}>
      <summary class="fold-summary settings-group-summary" data-action="toggle-settings-sync"><span class="fold-chevron">▶</span>データと同期(データ管理・クラウド保存・GitHub Pages)</summary>
      <div class="fold-body"><div class="stack" style="gap:16px">${body}</div></div>
    </details>
  `;
}

// v9: カテゴリ管理 UI(設定画面用)
function renderCategoriesSettings() {
  const cats = state.settings.categories || [];
  const visionDirect = new Set(
    Array.isArray(state.settings.visionDirectCategories)
      ? state.settings.visionDirectCategories
      : []
  );
  if (!cats.length) return `<div class="muted">カテゴリ未登録</div>`;
  return `
    <div class="stack" style="gap:6px">
      ${cats.map((c) => `
        <div class="row category-setting-row" style="gap:8px; align-items:center; background:var(--panel-soft); padding:8px; border-radius:6px">
          <input type="color" data-cat-id="${escapeHTML(c.id)}" data-cat-field="color" value="${escapeHTML(c.color)}" style="width:36px; height:36px; padding:0; border:none; background:transparent; cursor:pointer">
          <input class="input" data-cat-id="${c.id}" data-cat-field="name" value="${escapeHTML(c.name)}" style="flex:1">
          <label class="vision-direct-option">
            <input type="checkbox" data-action="toggle-vision-direct-category"
              data-category="${escapeHTML(c.name)}" ${visionDirect.has(c.name) ? "checked" : ""}>
            <span>直結</span>
          </label>
          <button class="btn danger" data-action="delete-category" data-cat-id="${c.id}" aria-label="削除">×</button>
        </div>
      `).join("")}
    </div>
  `;
}

// v230: 群見出しは描画せず、現在地breadcrumb用の分類だけ各項目へ保持する。
const moreItems = [
  { id: "wbs", label: "WBS", mark: "🧩", group: "計画" },
  { id: "wish", label: "やりたい", mark: "✦", group: "計画" },
  { id: "vision", label: "ビジョン", mark: "🧭", group: "計画" },
  { id: "zero", label: "0秒思考", mark: "💡", group: "思考" },
  { id: "ai-reports", label: "AIレポート", mark: "🤖", group: "振り返り" },
  { id: "instruments", label: "INSTRUMENTS", mark: "◉", group: "ツール" },
  { id: "iron-log", label: "IRON LOG", mark: "▰", group: "ツール" },
  { id: "settings", label: "設定", mark: "⚙️", group: "ツール" }
];

// v148: renderHeader()から呼び、現在のビューがmoreItemsのどれかに属していれば
// 「その他 › 群名」を返す(その他配下での現在地表示。codex-ui-review N1対応)。
// 属さないビューでは空文字。
function moreGroupLabelFor(viewId) {
  return moreItems.find((item) => item.id === viewId)?.group || "";
}

function renderMore() {
  return `<div class="tower-skin more-tower">
    ${renderHeader("追加画面", "その他")}
    <section class="more-tower-grid" aria-label="その他の画面">
      ${moreItems.map((item, index) => `<button type="button" class="more-tower-item" data-action="nav" data-view="${item.id}">
        <span class="more-tower-code">NAV ${String(index + 1).padStart(2, "0")}</span>
        <strong><span class="more-tower-mark" aria-hidden="true">${item.mark}</span>${item.label}</strong>
        <small>${item.group}</small>
      </button>`).join("")}
    </section>
  </div>`;
}

// v39: =========================================================
//  週次レビュー + エネルギー構造分析
// ジャーナルの週次コンディション集計で使用する7日展開。
function weekDays(weekStart) { return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)); }

function statsTimeLogData(date, nowMs = Date.now()) {
  // v184レビューM1: カテゴリ集計・合計は当日全体(00:00〜24:00)。早朝の実績を黙って落とさない。
  //                チャートだけは軸どおり06-24時にクランプする。
  const catStartMs = localDateTimeToMs(`${date}T00:00:00`);
  const chartStartMs = localDateTimeToMs(`${date}T06:00:00`);
  const dayEndMs = localDateTimeToMs(`${addDays(date, 1)}T00:00:00`);
  const categoryMap = new Map();
  const hourly = Array.from({ length: 18 }, () => new Map());
  state.blocks.filter((b) => !b.deleted && b.date === date && b.actualStartAt).forEach((b) => {
    const rawStartMs = localDateTimeToMs(b.actualStartAt);
    const rawEndMs = b.actualEndAt ? localDateTimeToMs(b.actualEndAt) : nowMs;
    const startMs = Math.max(catStartMs, rawStartMs);
    const endMs = Math.min(dayEndMs, rawEndMs);
    if (!rawStartMs || endMs <= startMs) return;
    const category = b.category || "未分類";
    const seconds = (endMs - startMs) / 1000;
    const current = categoryMap.get(category) || { category, seconds: 0, live: false };
    current.seconds += seconds;
    current.live ||= !b.actualEndAt;
    categoryMap.set(category, current);
    hourly.forEach((hourMap, index) => {
      const hourStartMs = chartStartMs + index * 60 * 60 * 1000;
      const overlapSec = Math.max(0, Math.min(endMs, hourStartMs + 60 * 60 * 1000) - Math.max(startMs, hourStartMs)) / 1000;
      if (overlapSec > 0) hourMap.set(category, (hourMap.get(category) || 0) + overlapSec);
    });
  });
  const categories = [...categoryMap.values()].sort((a, b) => a.category.localeCompare(b.category, "ja"));
  return { categories, hourly, totalSeconds: categories.reduce((sum, item) => sum + item.seconds, 0) };
}

function statsHMS(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 3600)}:${pad2(Math.floor((value % 3600) / 60))}:${pad2(value % 60)}`;
}

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
    ${modalHeaderHTML(isNew ? "問いを追加" : "問いを編集")}
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
    ${modalHeaderHTML("問いを実行へ")}
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
    ${modalHeaderHTML(isNew ? "実験を始める" : "実験を編集")}
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
    ${aiInsightsPanelHTML("zero")}
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
function ztSuggestionAdopt(id, options = {}) {
  const s = (state.zeroThinking.suggestedThemes || []).find((x) => x.id === id && x.status === "pending");
  if (!s) return null;
  const theme = { id: crypto.randomUUID(), text: s.text, fav: false, groupId: null, createdAt: nowDateTime() };
  state.zeroThinking.themes.push(theme);
  state.zeroThinking.suggestedThemes = state.zeroThinking.suggestedThemes.map((x) =>
    x.id === id ? { ...x, status: "adopted", adoptedThemeId: theme.id } : x);
  ztTab = "other";  // 採用したテーマはまず「それ以外」に出る(手動追加と同じ挙動)
  if (options.deferRender) {
    saveState();
    showToast(`「${s.text}」を採用しました`);
  } else {
    saveAndRender(`「${s.text}」を採用しました`);
  }
  return theme.id;
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
// 開閉状態は共通の折りたたみカード(isFoldOpen/setFoldOpen)と同じ
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

// v90: グループの折りたたみ開閉(既定=開いた状態。isFoldOpenのdefaultOpen引数を再利用)
function ztGroupIsOpen(groupId) {
  return isFoldOpen(`zt-group-${groupId}`, true);
}
function ztGroupToggleOpen(groupId) {
  setFoldOpen(`zt-group-${groupId}`, !ztGroupIsOpen(groupId));
  render();
}

function beginZtWrite(id) {
  const t = state.zeroThinking.themes.find((x) => x.id === id);
  if (!t) return false;
  ztCurrent = { id: t.id, text: t.text, fav: t.fav, questionId: t.questionId || null };  // v39: 問い紐づけを保持
  ztWriteStartedAt = Date.now();  // v104: 実経過時間の計測開始(カウントダウン残数ではなくこちらを保存に使う)
  return true;
}

function openZtWrite(id) {
  if (!beginZtWrite(id)) return;
  render();          // 書く画面を描画(DOM 確定)
  startZtTimer();    // その後にタイマー開始
  setTimeout(() => document.querySelector("#zt-write-input")?.focus(), 60);
}

function discardZtWrite(inputSelector = "#zt-write-input") {
  const body = (document.querySelector(inputSelector)?.value || "").trim();
  if (body && !confirm("入力を破棄して一覧へ戻りますか?")) return;
  stopZtTimer();
  ztCurrent = null;
  ztWriteStartedAt = null;  // v104
  render();
}

function saveZtEntry(inputSelector = "#zt-write-input") {
  if (!ztCurrent) return;
  const body = (document.querySelector(inputSelector)?.value || "").trim();
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
  const now = nowDateTime();
  state.tracks = (state.tracks || []).map((track) => track.ownerType === "project" && track.ownerId === id
    && !track.deleted && track.status === "active" ? { ...track, deleted: true, updatedAt: now } : track);
  state.projects = state.projects.map((project) => project.id === id ? { ...project, deleted: true, updatedAt: now } : project);
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
    planTarget: false,
    owner: "k",
    order: null,
    aiBrief: "",
    handoffNote: "",
    aiStatus: "none",
    aiResultRef: "",
    aiSummary: null,          // v197(第3弾3d): AIステップ結果の要旨(§4)。書き込みは後続単位(3f+3g)
    aiQuestion: null,         // v197(第3弾3d): 第4弾予約。フィールド定義とマージ追随のみ、本弾のアプリは書き込まない
    aiStepRequestId: null,        // v197(第3弾3d, B-2/B-3): 保留中request永続化。書き込みは後続単位(3e)
    aiStepRequestedAt: null,      // v197(第3弾3d, C-9): 送信時刻(ISO8601ミリ秒付きUTC)。書き込みは後続単位(3e)
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
function openTaskCreator({ projectId = "", parentTaskId = "", category = "", order = null } = {}) {
  const stub = makeTask({ projectId, parentTaskId, category });
  stub.id = "";           // id 空 = 新規(保存時に採番)
  stub.title = "";
  // v195: order は「実行計画の挿入(呼び出し元が明示指定)」と「planTarget親への末尾追加」だけに付ける。
  // 通常の「+ タスク」「+ サブ」で無条件に採番すると、兄弟2件が有限orderになった時点で
  // siblingTaskCompare が従来比較(完了下沈み→期限→createdAt)を迂回してしまうため。
  const planParent = parentTaskId
    ? state.tasks.find((t) => !t.deleted && t.id === parentTaskId && t.planTarget)
    : null;
  stub.order = Number.isFinite(order)
    ? order
    : (planParent
      ? nextSiblingOrder(state.tasks.filter((t) => !t.deleted && t.parentTaskId === parentTaskId))
      : null);
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
    closeAiStepConfirmIfUndone(id);  // v198(第3弾3e): 確認シート表示中に完了取消されたら閉じる
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
  maybeQueueNextAiStep(id, task.status);  // v198(第3弾3e): 完了6経路#1(WBS/一覧のチェックボタン)
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
  const categorySelect = document.querySelector("#blockCategory");
  const category = categorySelect ? categorySelect.value : (getCategoryNames()[0] || "");
  if (!title) return showToast("Block名を入力してください");
  const today = todayISO();
  // v28: タスクシュート画面から追加した Block は「その他」Project に自動で紐づける
  //      (Task 紐づけが無いとタスクシュート画面に表示されないため)
  const otherTask = getOtherTask();
  // v29: 予定の開始/終了日時をデフォルトで入れる
  const { plannedStartAt, plannedEndAt } = defaultPlannedTimes(today);
  state.blocks.push(makeBlock({
    date: today,
    title,
    category,
    taskId: otherTask ? otherTask.id : "",
    plannedStartAt,
    plannedEndAt
  }));
  state.selectedDate = today;
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

// v234: ジムBlockの完了4導線で共有するIRON LOG転記フック。
// v246: blockId付きセットを優先し、無ければ実績時間内の未連動セットだけを割り当てる。
function transferIronLogToCompletedBlock(blockId, { suppressEmptyToast = false } = {}) {
  const block = state.blocks.find((b) => b.id === blockId);
  if (!block?.completed) return;
  const probe = {
    ...block,
    actualStartAt: block.actualStartAt || block.plannedStartAt || `${block.date || todayISO()}T00:00`,
    actualEndAt: ""
  };
  if (!linkedGymBlock({ settings: state.settings, blocks: [probe] }, 0)) return;

  const allSets = state.condition?.logs?.[block.date]?.gym;
  const list = Array.isArray(allSets) ? allSets : [];
  const linkedSets = list.filter((set) => String(set?.blockId || "") === String(blockId));
  const startMs = localDateTimeToMs(block.actualStartAt);
  const endMs = localDateTimeToMs(block.actualEndAt);
  const sets = linkedSets.length ? linkedSets : list.filter((set) => {
    if (set?.blockId || !startMs || endMs < startMs) return false;
    const atMs = localDateTimeToMs(set?.at);
    return atMs >= startMs && atMs <= endMs;
  });
  const summary = gymCommentSummary(sets);
  if (!summary) {
    if (!suppressEmptyToast) {
      // 呼び出し元の完了トーストより後に表示し、警告が同一スタック内で上書きされるのを防ぐ。
      Promise.resolve().then(() => showToast("IRON LOGのセットが未記録です"));
    }
    return;
  }
  if (!linkedSets.length) sets.forEach((set) => { set.blockId = blockId; });
  const comment = String(block.comment || "");
  if (!comment.split(/\r?\n/).includes(summary)) {
    block.comment = comment ? `${comment}${comment.endsWith("\n") ? "" : "\n"}${summary}` : summary;
  }
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
  let changedBlock = null;
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
      next.everStartedAt = next.everStartedAt || next.actualStartAt;
      snapshot.everStartedAt = { before: block.everStartedAt, after: next.everStartedAt };
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
        for (const field of ["everStartedAt", "actualStartAt", "actualEndAt", "charge", "discharge"]) {
          if (snap[field] && next[field] === snap[field].after) next[field] = snap[field].before;
        }
        delete _quickCompleteSnapshots[id];
      }
    }
    changedBlock = next;
    return next;
  });
  syncHabitStreakForBlock(state.blocks.find((block) => block.id === id));
  // v115: アンカー配置(提案G③)。完了したBlockが繰り返しルーティンに属していれば、
  // それをアンカーにする後続のルーティン/チェーンを直後の時刻に自動配置する。
  if (justCompleted && completedBlock && completedBlock.recurrenceGroupId) {
    triggerAnchorPlacements(completedBlock.recurrenceGroupId, nowDateTime());
  }
  if (justCompleted && completedBlock) {
    transferIronLogToCompletedBlock(id);
    generateReport(completedBlock.date, { quiet: true });
    saveState();
    trackOnBlockCompletionChanged(changedBlock, true, { interactive: true });
    // v150: 完了直後だけ「実績を編集」ボタン付きトースト(既存の実績モーダルを編集導線として再利用)。
    saveAndRender("Blockを完了しました", { blockId: id, actionLabel: "実績を編集" });
  } else {
    if (changedBlock) {
      saveState();
      trackOnBlockCompletionChanged(changedBlock, false, { interactive: true });
    }
    saveAndRender("Blockを更新しました");
  }
  // v17/v18: 完了時の演出(常にランダム祝福)
  if (justCompleted && completedBlock) {
    const celebrateMsg = getRandomCelebrate();
    triggerCompletionEffect(celebrateMsg, completedBlock.isMIT);
  }
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
  const wasBlockCompleted = Boolean(block.completed);
  if (completing) {
    state.tasks = state.tasks.map((t) => t.id === task.id
      ? { ...t, status: "completed", progressNum: fillProgressOnComplete(t), updatedAt: nowDateTime() }
      : t);
    state.blocks = state.blocks.map((b) => b.id === blockId
      ? { ...b, completed: true, actualEndAt: b.actualEndAt || nowDateTime(), updatedAt: nowDateTime() }
      : b);
    syncHabitStreakForBlock(state.blocks.find((b) => b.id === blockId));
    transferIronLogToCompletedBlock(blockId);
    generateReport(block.date, { quiet: true });
  } else {
    const hasProgress = state.blocks.some((b) => !b.deleted && b.taskId === task.id && (b.completed || b.actualStartAt));
    state.tasks = state.tasks.map((t) => t.id === task.id
      ? { ...t, status: hasProgress ? "doing" : "todo", updatedAt: nowDateTime() }
      : t);
  }
  const changedBlock = state.blocks.find((b) => b.id === blockId);
  if (!wasBlockCompleted && changedBlock?.completed) {
    saveState();
    trackOnBlockCompletionChanged(changedBlock, true, { interactive: true });
  }
  saveAndRender(completing ? "Taskを完了しました" : "Taskを未完了に戻しました");
  // v198(第3弾3e): 完了6経路#2(タイムラインBlock行の「タスク完了」)。task.statusは
  // 上のstate.tasks.map前のprevStatus(taskの参照自体は再代入していないため保持される)。
  if (completing) maybeQueueNextAiStep(task.id, task.status);
  else closeAiStepConfirmIfUndone(task.id);
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

// v215: 計時タブ削除に伴い、旧timeswitch.jsのprepareTimeswitchForTaskStartからタブ非依存の
// 不変条件だけをapp.jsへ存置した(v191修正1: 新タスク開始時に放置中の実行ルーティンBlockを
// 未完了で自動クローズし、対象ポモドーロはfinishAllRunningと同じ後始末を行う)。
// 計時固有部(oneTap/isTimeswitchRunning/closeOrphanedOneTap)は仕様どおり削除済み。
function resetPomodoroForBlock(blockId) {
  if (!state.pomodoro?.running || state.pomodoro.blockId !== blockId) return;
  state.pomodoro = {
    ...state.pomodoro,
    running: false,
    blockId: "",
    startedAt: "",
    endsAt: "",
    mode: "focus"
  };
}

function autoCloseStaleRoutineRuns(blockId) {
  const at = nowDateTime();
  state.blocks.forEach((block) => {
    if (block.id === blockId || block.deleted || block.actualEndAt || !block.actualStartAt) return;
    if (block.category === "ルーティン") {
      // 過去日のBlockへ当日の終了時刻を書かない(旧finishBlockの二重防御を踏襲)。
      const finishedAt = block.date < todayISO() ? `${block.date}T23:59:00` : at;
      block.actualEndAt = finishedAt;
      block.completed = false;
      block.updatedAt = finishedAt;
      resetPomodoroForBlock(block.id);
    }
  });
}

function setBlockTime(id, field) {
  const wasStarted = Boolean(blockById(id)?.actualStartAt);
  if (field === "actualStartAt") autoCloseStaleRoutineRuns(id);
  updateBlockField(id, field, nowDateTime());
  if (field === "actualStartAt") {
    // v48: 着手した瞬間に Task を doing へ(従来は Block 完了時のみで、
    //      「着手率>完了率」の哲学に反して着手が Task に反映されていなかった)
    const blk = blockById(id);
    if (!wasStarted && blk?.actualStartAt) trackOnBlockStarted(blk);
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
    ? { ...b, actualStartAt: b.plannedStartAt, everStartedAt: b.everStartedAt || b.plannedStartAt, actualEndAt: b.plannedEndAt || b.plannedStartAt, completed: true, updatedAt: nowDateTime() }
    : b);
  targets.forEach((block) => syncHabitStreakForBlock(state.blocks.find((b) => b.id === block.id)));
  targets.forEach((block) => transferIronLogToCompletedBlock(block.id, { suppressEmptyToast: true }));
  generateReport(today, { quiet: true });
  const taskIds = new Set(targets.map((b) => b.taskId).filter(Boolean));
  if (taskIds.size) {
    state.tasks = state.tasks.map((t) => taskIds.has(t.id) && t.status === "todo"
      ? { ...t, status: "doing", updatedAt: nowDateTime() } : t);
  }
  saveState();
  targets.forEach((block) => {
    const completedBlock = state.blocks.find((entry) => entry.id === block.id);
    if (completedBlock?.completed) {
      trackOnBlockCompletionChanged(completedBlock, true, { interactive: false });
    }
  });
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

// 「現在時刻に該当するBlock、無ければ次(未着手優先)」の抽出ロジックに
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
    const next = { ...block, [field]: normalized, updatedAt: nowDateTime() };
    return field === "actualStartAt" ? stampEverStarted(next) : next;
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
// toggleConditionMeds/setConditionCapacity/setEveningMood/addGymEntry/
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
  const rateRoutine = routineRate(blocks, state.recurrences || []);
  const rateCycleWeek = cycleWeekProgress(date);
  const cycleWeek = cycleWeekForDate(date);
  const rateDeferral = deferralStats(blocks);

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
    `| 12週 今週の進捗(Week ${cycleWeek}/12) | ${rateCycleWeek.done} / ${rateCycleWeek.total} | ${rateCycleWeek.pct}% |`,
    `| 先送り | ${rateDeferral.pending}件 | ${rateDeferral.started} / ${rateDeferral.total} |`,
    "",
    ...(conditionBudgetToday.level !== "none"
      ? [`体力予算: ${CONDITION_BUDGET_LABELS[conditionBudgetToday.level]}${conditionBudgetToday.reason ? `(${conditionBudgetToday.reason})` : ""}`, ""]
      : []),
  ];

  // v68: 非同期AI対話 — origin:"user"の未解決質問を
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
      lines.push(`- ${b.isMIT ? "★ " : ""}${b.title}${b.category ? ` (${b.category})` : ""}${blockEverStarted(b) ? "" : " (未着手)"}`);
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
  // v214: 独立した日報タブを廃止したため、生成後もジャーナルに留まる。
  saveAndRender("日報を生成しました");
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

function syncAlertBanner() {
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
// v74: fetchGitHubRawText の内部実装。「本文」だけでなくHTTP statusも返し、呼び出し側が
// 404と認証・一時障害を区別できるようにする。
// v85: kind="blob" でバイナリ(PDF等)もこの経路で取得できるようにした。Accept: raw+json は
// GitHubのContents APIで1〜100MBのファイルに対してもraw bytesを返す(1MB以下限定ではない)ため、
// response.text() の代わりに response.blob() を使えばテキストと同じ経路で画像・PDFも読める。
// 既存呼び出し元(fetchGitHubRawText経由、kind省略=text)の挙動は一切変えていない。
async function fetchGitHubRawResult(name, kind = "text", fetchOptions = {}) {
  const cfg = state.settings.github || {};
  if (!personalDataReady(cfg)) return { ok: false, status: 0, text: "", blob: null };
  const conn = personalDataConn(cfg);
  try {
    const path = personalDataPath(name).split("/").map(encodeURIComponent).join("/");
    const url = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/contents/${path}?ref=${encodeURIComponent(conn.branch)}`;
    const response = await fetch(url, {
      headers: { ...githubHeaders(conn.token), "Accept": "application/vnd.github.raw+json" },
      ...fetchOptions
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
  delete copy._trackToastLog;  // v243: 12WY進捗トーストの1日1回制御は端末単位
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
    ${modalHeaderHTML("📦 バックアップ世代から復元")}
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
  const wasStarted = Boolean(blockById(blockId)?.actualStartAt);
  autoCloseStaleRoutineRuns(blockId);  // v215: 旧prepareTimeswitchForTaskStartのタブ非依存部
  // v14: state.pomodoro を完全再構築(spread を使わず、必要なフィールドだけ明示的に作成)
  // これで以前のセッションの endsAt/startedAt/mode が確実にリセットされる
  const now = Date.now();
  state.pomodoro = {
    running: true,
    blockId,
    startedAt: dateToLocalDateTime(new Date(now)),
    endsAt: dateToLocalDateTime(new Date(now + 25 * 60 * 1000)),
    mode: "focus"
  };
  // v13: ポモドーロ開始時、Blockの実績開始時間を自動記録(既存値があれば維持)
  updateBlockField(blockId, "actualStartAt", blockById(blockId)?.actualStartAt || nowDateTime());
  const startedBlock = blockById(blockId);
  if (!wasStarted && startedBlock?.actualStartAt) trackOnBlockStarted(startedBlock);
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

// v183: 中断理由ピッカーを今日ビューのタイマー表示から利用する。
// stop-pomodoroがセットする_pendingInterruptBlockIdを唯一の前提にし、通常時の操作HTMLは
// 呼び出し側から受け取る。
function renderPomodoroInterruptControls(defaultHTML) {
  return _pendingInterruptBlockId === state.pomodoro.blockId
    ? interruptReasonPickerHTML()
    : defaultHTML;
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
  const wasCompleted = Boolean(blockId && blockById(blockId)?.completed);
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
    syncHabitStreakForBlock(state.blocks.find((block) => block.id === blockId));
    transferIronLogToCompletedBlock(blockId);
  }
  const completedBlock = blockId ? state.blocks.find((block) => block.id === blockId) : null;
  if (completedBlock) generateReport(completedBlock.date, { quiet: true });
  state.pomodoro = {
    running: false,
    blockId: "",
    startedAt: "",
    endsAt: "",
    mode: "focus"
  };
  if (!wasCompleted && completedBlock?.completed) {
    saveState();
    trackOnBlockCompletionChanged(completedBlock, true, { interactive: true });
  }
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
}

// ============================================================
// v162: 日次締めの未完了理由クイック入力(K裁定2026-07-28「言い訳ハンターの入力源」b案)。
// 「日報を生成」ボタン押下時に当日の未完了Blockが理由未記録のまま残っている場合、
// 通常のモーダルで複数件を1件ずつ尋ねる。v129身体スキャンと同じ「強制しない」設計。
// ============================================================
const INCOMPLETE_REASON_CHIPS = ["疲労", "時間切れ", "気分が乗らない", "割り込み", "見積り過大", "その他"];
let _pendingIncompleteReasonCtx = null; // { queue: string[](残りのblock id), mode: 'dailyClose' } | null
// v162 2系統レビュー対応(推奨4): 日次締めモーダルで「スキップ」したBlock idを積む。
// 同じセッション内で「日報を生成」を
// 再度押しても、既にスキップ済みのBlockは再質問しない(ページリロードで自然にリセットされる)。
let _dailyCloseReasonSkipped = new Set();

function hasIncompleteReason(block) {
  return Boolean(block && block.incompleteReason && block.incompleteReason.chip);
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
    ${modalHeaderHTML("宣言")}
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
    ${modalHeaderHTML("終了報告")}
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
}

// v9: 「☕ 休憩へ」: focus → break に遷移(+5分休憩開始)
// C1(v192): 以前はここで block.actualEndAt を書いて暗黙的に「完了扱い」にしていたが、
// タイマー満了による自動発火(startTimerTicker)でNOW FOCUSが勝手に空になる副作用があった。
// 休憩は完了ではなく一時停止のため、actualEndAtは書かない(タスクの計測は完了操作まで継続する)。
// pomodoroCount加算のみ維持する(手動「☕ 休憩へ」・自動発火どちらの呼び出しも同じ関数のため統一)。
function goBreakPomodoro() {
  const blockId = state.pomodoro.blockId;
  if (blockId) {
    state.blocks = state.blocks.map((block) => block.id === blockId
      ? { ...block, pomodoroCount: Number(block.pomodoroCount || 0) + 1, updatedAt: nowDateTime() }
      : block);
  }
  // v14: 完全再構築 + 5分休憩開始
  // v19: lastFocusBlockId に保存(休憩後に「続ける/完了」選択用)
  const now = Date.now();
  state.pomodoro = {
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
  const wasCompleted = Boolean(lastBlockId && blockById(lastBlockId)?.completed);
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
    syncHabitStreakForBlock(state.blocks.find((b) => b.id === lastBlockId));
    transferIronLogToCompletedBlock(lastBlockId);
  }
  // タイマーを終了状態に
  state.pomodoro = {
    running: false,
    blockId: "",
    startedAt: "",
    endsAt: "",
    mode: "focus"
  };
  const completedBlock = lastBlockId ? blockById(lastBlockId) : null;
  if (!wasCompleted && completedBlock?.completed) {
    saveState();
    trackOnBlockCompletionChanged(completedBlock, true, { interactive: true });
  }
  saveAndRender("✅ Block を完了しました(実績終了時刻を記録)");
}

// タイマー表示の差分更新。独立タブ削除後は共有のToday表示だけを更新する。
function updatePomodoroTick() {
  const root = document.querySelector(".today-pomodoro");
  if (!root || !state.pomodoro.running) return;
  const overlay = root.querySelector(".pomo-time-overlay");
  const circle = root.querySelector(".pomo-progress-circle");
  if (!overlay || !circle) return;
  const radius = 90;
  const circumference = 2 * Math.PI * radius;
  const endsAtMs = localDateTimeToMs(state.pomodoro.endsAt);
  const remainingMs = Math.max(0, endsAtMs - Date.now());
  const isBreak = state.pomodoro.mode === "break";
  const startedAtMs = localDateTimeToMs(state.pomodoro.startedAt);
  const totalMs = isBreak ? 5 * 60 * 1000 : Math.max(1, endsAtMs - startedAtMs);
  const progress = 1 - remainingMs / totalMs;
  overlay.textContent = isBreak ? remainingTextNormal(remainingMs) : remainingText(state.pomodoro.endsAt, true);
  circle.style.stroke = isBreak ? "var(--orange)" : "var(--accent)";
  circle.style.strokeDasharray = String(circumference);
  circle.style.strokeDashoffset = String(circumference * (1 - clamp(progress, 0, 1)));
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
      } else if (state.currentView === "today" && personalDataReady(state.settings.github)) {
        updatePomodoroTick();
      }
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

function setView(view = "today") {
  // v34/v183: 0秒思考の書く画面(単体/今日インライン)から離脱するときは
  // タイマー停止 + 共通一時状態をリセットする。
  if ((state.currentView === "zero" && view !== "zero")
      || (state.currentView === "today" && view !== "today")) {
    stopZtTimer();
    ztCurrent = null;
    ztWriteStartedAt = null;  // v104
  }
  state.currentView = view;
  // v37: 画面切替は「データの変更」ではない。dataModifiedAt を汚すと
  //      端末間の新旧比較が壊れる(タブを触っただけの古い端末が「最新」扱いになる)ため、
  //      永続化のみ行い、更新時刻スタンプと自動保存はしない。
  persistLocalNoSchedule();
  renderDeferringForFocus();  // v256: JOURNAL等のIME未確定入力をタブ切替の全renderから守る
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
//      挙動を撤回し、「候補として溜めておき、チップの＋タップで初めて実体化」方式に戻す。
//      テーマ側(0秒思考)の
//      自動追加は今回のスコープ外で変更しない(上のコメント・下のthemeCandidates節は従来どおり)。
//      候補はjournalMeta[date].aiTaskCandidatesへ格納し、aiTaskChips()/adoptAiTaskCandidate()/
//      dismissAiTaskCandidate()で表示・採用・却下する(表示は常にjournalMeta[前日].aiTaskCandidates
//      のみ)。addedTasksの意味は「タスクとして直接追加した件数」から
//      「候補として追加した件数」に変わった(変数名はそのまま流用)。
function autoIngestFeedback(date, text) {
  if (!text) return null;
  if (!Array.isArray(state.feedbackIngestedDates)) state.feedbackIngestedDates = [];
  if (state.feedbackIngestedDates.includes(date)) return null;  // 冪等: 同じ日付は1回のみ

  let addedTasks = 0, addedThemes = 0;

  const mitCandidates = extractMITCandidatesFromReport(text);
  if (mitCandidates.length) {
    const meta = (state.journalMeta[date] ||= { aiMitCandidates: [], aiImported: false, ideal: "", aiTaskCandidates: [], aiRequest: "" });
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

// v190: ai-insights.jsonはバッチ出力を信用境界の外として扱う。トップレベルが正しいJSON
// オブジェクトでも、4フィールドは互いに独立して検証し、壊れたフィールドだけを捨てる。
function parseAiInsights(raw) {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const data = {
      generatedAt: typeof parsed.generatedAt === "string"
        && AI_INSIGHTS_GENERATED_AT_RE.test(parsed.generatedAt.trim())
        ? parsed.generatedAt.trim()
        : ""
    };
    if (Array.isArray(parsed.wishRipe)) {
      const rows = parsed.wishRipe
        .filter((row) => row && typeof row === "object"
          && typeof row.taskId === "string" && row.taskId.trim()
          && typeof row.title === "string" && row.title.trim()
          && typeof row.reason === "string" && row.reason.trim())
        .map((row) => ({
          taskId: row.taskId.trim(),
          title: row.title.trim(),
          reason: row.reason.trim()
        }));
      if (rows.length) data.wishRipe = rows;
    }
    if (parsed.zeroPattern && typeof parsed.zeroPattern === "object"
      && typeof parsed.zeroPattern.body === "string" && parsed.zeroPattern.body.trim()) {
      data.zeroPattern = { body: parsed.zeroPattern.body.trim() };
    }
    return data;
  } catch {
    return undefined;
  }
}

function aiInsightsFreshnessHTML(data) {
  const generatedAt = data?.generatedAt || "";
  const generatedAtMs = AI_INSIGHTS_GENERATED_AT_RE.test(generatedAt)
    ? localDateTimeToMs(generatedAt)
    : 0;
  const isStale = Boolean(generatedAtMs && Date.now() - generatedAtMs > AI_INSIGHTS_STALE_MS);
  const label = !generatedAtMs
    ? "鮮度不明"
    : isStale ? `古い・${generatedAt} 生成` : `${generatedAt} 生成`;
  return `<span class="ai-insights-freshness${isStale ? " is-stale" : ""}">${escapeHTML(label)}</span>`;
}

function aiInsightsPanelHTML(kind, taskId = "") {
  const data = cachedAiInsightsJson.data;
  if (!data) return "";
  const freshness = aiInsightsFreshnessHTML(data);
  if (kind === "wish" && Array.isArray(data.wishRipe)) {
    const row = data.wishRipe.find((item) => item.taskId === taskId);
    if (!row) return "";
    return `<section class="ai-insights" data-insight="wish">
      <div class="ai-insights-head"><strong>AI 熟成判定</strong>${freshness}</div>
      <div class="ai-insights-body">${escapeHTML(row.reason)}</div>
    </section>`;
  }
  if (kind === "zero" && data.zeroPattern) {
    return `<section class="panel ai-insights" data-insight="zero">
      <div class="ai-insights-head"><strong>AI 0秒思考パターン</strong>${freshness}</div>
      <div class="ai-insights-body">${escapeHTML(data.zeroPattern.body).replace(/\n/g, "<br>")}</div>
    </section>`;
  }
  return "";
}

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
  // v159: 「未来からの手紙」は月次ファイルのため、判定キーは日付ではなく当月(YYYY-MM)。
  //      実際の当月分だけを、1セッション1回取得する。
  //      2026-07-28レビュー対応・必須修正3: GitHub(personal-data)連携が未設定
  //      (personalDataReady()===false)の間はどの`want*Fetch`も立てない。fetchGitHubRawText
  //      自体は未設定時に静かに空文字を返す(=フェッチ「済み」に見えてしまう)ため、これを
  //      ゲートせずに`cachedXxx[key] = 値 || undefined`していると、セットアップ画面通過前に
  //      1回でもhydrateStaticMarkdownが走った時点で「取得試行済み(undefined)」がキャッシュに
  //      固定されてしまい、直後の`gate-continue`(セットアップ完了、449行目
  //      `syncFromGitHubOnStartup().then(() => hydrateStaticMarkdown())`)で再度呼ばれても
  //      `realCurrentMonth in cachedFutureLetterMd`が既にtrueのため二度とフェッチされなくなる。
  const ghReady = personalDataReady(state.settings.github);
  const realCurrentMonth = realToday.slice(0, 7);
  const wantFutureLetterFetch = ghReady && !(realCurrentMonth in cachedFutureLetterMd);
  const wantAiInsightsFetch = ghReady && (Date.now() - cachedAiInsightsJson.fetchedAt >= FEEDBACK_REFRESH_INTERVAL_MS);
  const [futureLetterMd, aiInsightsRaw] = await Promise.all([
    wantFutureLetterFetch ? fetchGitHubRawText(`未来からの手紙_${realCurrentMonth}.md`) : Promise.resolve(undefined),
    wantAiInsightsFetch ? fetchGitHubRawText("ai-insights.json").catch(() => undefined) : Promise.resolve(undefined),
  ]);
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
  if (wantAiInsightsFetch) {
    const parsedAiInsights = parseAiInsights(aiInsightsRaw);
    // v190レビュー反映: energy-curve型(設計§12の名指しパターン)に統一 —
    // 成否を問わずfetchedAtを進めて30分に1回だけリトライ(日付移動のたびの連打を防ぐ。
    // バッチ未結線期間は404が常態のため特に重要)。失敗時は前回の正常データを保持する。
    const previous = cachedAiInsightsJson.data;
    cachedAiInsightsJson = { fetchedAt: Date.now(), data: parsedAiInsights || previous };
    if (parsedAiInsights && JSON.stringify(previous) !== JSON.stringify(parsedAiInsights)) changed = true;
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
  if (changed && (state.currentView === "vision" || state.currentView === "journal" || state.currentView === "today" || state.currentView === "timeline" || state.currentView === "wish" || state.currentView === "zero" || state.currentView === "tasks")) {
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
    // v198(第3弾3e): maybeQueueNextAiStepは意図的に配線しない。旧・第1弾AI作業ワーカーの承認経路
    // であり、phase3-design.md §1が「絶対に呼ばない」と名指ししている(実装設計書B節参照)。
    state.tasks = state.tasks.map((t) => (t.id === r.taskId && !t.deleted)
      ? { ...t, status: "completed", progressNum: fillProgressOnComplete(t), updatedAt: nowDateTime() }
      : t);
  }
  saveState();
  trackOnBlockCompletionChanged(block, true, { interactive: false });
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

// v251: 新形式FBの「## サマリー」だけをATISへ常時表示する。旧形式は空を返して
// 従来の全文detailsだけを維持する。
function extractFeedbackSummary(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^##[ \t]+サマリー[ \t]*$/.test(line));
  if (start < 0) return "";
  const nextHeading = lines.findIndex((line, index) => index > start && /^##[ \t]+/.test(line));
  return lines.slice(start + 1, nextHeading < 0 ? undefined : nextHeading).join("\n").trim();
}

// v230: AIフィードバック本文・候補・操作導線を統合画面のATISへ集約する。
function atisFeedbackReadHTML() {
  const today = todayISO();
  const prev = addDays(today, -1);
  const todayFb = cachedFeedback[today] || state.feedback[today] || "";
  const prevFb = cachedFeedback[prev] || state.feedback[prev] || "";
  if (!todayFb && !prevFb) return "";
  const targetDate = todayFb ? today : prev;
  const targetFb = todayFb || prevFb;
  const shortDate = targetDate.slice(5);
  const summary = extractFeedbackSummary(targetFb);
  const summaryHTML = summary ? `<div class="tower-atis-summary">
    <div class="tower-atis-summary-date">対象日 ${escapeHTML(shortDate)}</div>
    <div class="tower-atis-summary-text">${escapeHTML(summary)}</div>
  </div>` : "";
  return `${summaryHTML}<details class="tower-atis-feedback">
    <summary>🤖 全文を読む(${escapeHTML(shortDate)})</summary>
    <div class="tower-atis-feedback-body">
      ${todayFb ? `<div class="md-render readonly-md">${renderMarkdown(todayFb)}</div>` : ""}
      ${prevFb ? (todayFb ? `<details>
        <summary>前日(${escapeHTML(prev)})のフィードバックも見る</summary>
        <div class="md-render readonly-md">${renderMarkdown(prevFb)}</div>
      </details>` : `<div class="md-render readonly-md">${renderMarkdown(prevFb)}</div>`) : ""}
    </div>
  </details>`;
}

function renderAtisPanel() {
  const workItems = pendingAiWorkResults();
  const workHTML = workItems.length ? `<div class="atis-divider"></div>
    <div class="tower-atis-sub">AIが処理した作業 <span>${workItems.length}</span></div>
    ${workItems.map((result) => aiWorkResultRowHTML(result)).join("")}` : "";
  const replanActive = _replanUi.kind === "sending" || _replanUi.kind === "pending";
  return `<section class="tower-panel-box sec-atis" data-atis-panel>
    <h2>ATIS <span>AIから</span></h2>
    <div class="tower-atis-body">
      ${aiFreshnessLine()}
      ${workHTML}
      ${atisFeedbackReadHTML()}
      ${aiTaskChips()}
      <div class="tower-atis-actions">
        <button type="button" class="atis-btn" data-action="ai-morning-plan">🌅 朝プラン</button>
        <button type="button" class="atis-btn" data-action="ai-schedule">📋 下書きスケジュール</button>
        <button type="button" class="atis-btn" data-action="today-replan" data-replan-button ${replanActive ? "disabled" : ""}>♻️ AI再プラン</button>
      </div>
      <div class="tower-atis-status" data-atis-status>${escapeHTML(_replanUi.message)}</div>
    </div>
  </section>`;
}

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

// v229: Block編集の「__end__」とGATE削除が共有するシリーズ終了本体。
// GATE側はendGateRecurrence()からこの既存分岐相当だけを呼ぶ薄いラッパーにする。
function endRecurrenceSeries(ruleId, { excludeId = "" } = {}) {
  const active = (state.recurrences || []).some((rule) => rule.id === ruleId && !rule.deleted);
  if (!active) return false;
  state.recurrences = state.recurrences.map((rule) => rule.id === ruleId
    ? { ...rule, deleted: true, updatedAt: nowDateTime() }
    : rule);
  removeUntouchedInstances(ruleId, { fromDate: todayISO(), excludeId });
  return true;
}

function endGateRecurrence(ruleId) {
  if (!endRecurrenceSeries(ruleId)) return;
  saveAndRender("ゲートの繰り返しシリーズを終了しました");
}

function addTowerGate() {
  const title = (document.getElementById("towerGateTitle")?.value || "").trim();
  const time = document.getElementById("towerGateTime")?.value || "";
  if (!title || !/^\d{2}:\d{2}$/.test(time)) {
    showToast("タイトルと時刻を入力してください");
    return;
  }
  const date = todayISO();
  const rule = createRecurrenceRule({
    title, date, category: "ルーティン", taskId: "",
    plannedStartAt: `${date}T${time}`, plannedEndAt: ""
  }, "daily");
  if (!rule) return;
  const orders = (state.recurrences || []).filter((item) => !item.deleted && item.category === "ルーティン" && item.id !== rule.id)
    .map((item) => item.order).filter(Number.isFinite);
  rule.order = orders.length ? Math.max(...orders) + 1 : 0;
  maintainRecurrences();
  saveAndRender("ゲートを登録しました");
}

function moveTowerGate(ruleId, direction) {
  if (direction !== -1 && direction !== 1) return;
  const rules = (state.recurrences || []).map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => !rule.deleted && rule.category === "ルーティン")
    .sort((a, b) => (Number.isFinite(a.rule.order) ? a.rule.order : a.index)
      - (Number.isFinite(b.rule.order) ? b.rule.order : b.index))
    .map(({ rule }) => rule);
  const from = rules.findIndex((rule) => rule.id === ruleId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= rules.length) return;
  [rules[from], rules[to]] = [rules[to], rules[from]];
  const orderById = new Map(rules.map((rule, index) => [rule.id, index]));
  const changedAt = nowDateTime();
  state.recurrences = state.recurrences.map((rule) => orderById.has(rule.id) && rule.order !== orderById.get(rule.id)
    ? { ...rule, order: orderById.get(rule.id), updatedAt: changedAt }
    : rule);
  saveAndRender("ゲートの順番を変更しました");
}

function toggleEarlyBird() {
  const date = todayISO();
  state.earlyBird ||= { logs: {} };
  state.earlyBird.logs ||= {};
  if (state.earlyBird.logs[date]) {
    delete state.earlyBird.logs[date];
    saveAndRender("早起きチェックを取り消しました");
    return;
  }
  const checkedAt = nowDateTime();
  state.earlyBird.logs[date] = { checkedAt };
  const checkedTime = checkedAt.match(/T(\d{2}:\d{2})/)?.[1] || "";
  const late = checkedTime > state.settings.earlyRiseTarget;
  saveAndRender(late ? "早起きを記録しました(目標時刻より遅いチェックです)" : "早起きを記録しました");
}

// v252: 完了UIに依存しない固定化ルーティンの書き込み口。当日実体だけをログ正本へ反映する。
function recordHabitStreakDone(ruleId, dateISO) {
  const rule = (state.recurrences || []).find((r) => r.id === ruleId && !r.deleted);
  if (!rule?.streakSince || !["daily", "weekdays"].includes(rule.kind) || dateISO < rule.streakSince) return false;
  state.habitStreaks ||= {};
  const habit = (state.habitStreaks[ruleId] ||= { logs: {} });
  habit.logs ||= {};
  habit.logs[dateISO] ||= { doneAt: nowDateTime() };
  return true;
}

function removeHabitStreakDone(ruleId, dateISO) {
  const logs = state.habitStreaks?.[ruleId]?.logs;
  if (!logs?.[dateISO]) return false;
  delete logs[dateISO];
  return true;
}

function syncHabitStreakForBlock(block) {
  if (!block?.recurrenceGroupId || block.date !== todayISO()) return;
  if (block.completed) recordHabitStreakDone(block.recurrenceGroupId, block.date);
  else removeHabitStreakDone(block.recurrenceGroupId, block.date);
}

function habitStreakEdit(rule, nextKind, requested) {
  if (!rule || !["daily", "weekdays"].includes(nextKind)) return { ok: true, value: null };
  if (requested === undefined) return { ok: true, value: rule.streakSince || null };
  if (!requested) return { ok: true, value: null };
  if (rule.streakSince) return { ok: true, value: rule.streakSince };
  const fixedCount = (state.recurrences || []).filter((r) => !r.deleted && r.id !== rule.id && r.streakSince).length;
  return fixedCount >= 3 ? { ok: false, value: null } : { ok: true, value: todayISO() };
}

function recurrenceKindLabel(kind) {
  return { daily: "毎日", weekdays: "平日のみ", weekly: "毎週", monthly: "毎月" }[kind] || kind || "";
}

// v218: recurrenceMatchesDate〜maintainRecurrences(繰り返し実体化エンジン)は
// src/core/recurrence.jsへ移動した。isTouchedBlock/
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

// v237: Project/Taskの中断・再開で共通のstatus更新と保存描画を一元化する。
function setEntityStatus(collectionKey, id, status, message) {
  state[collectionKey] = state[collectionKey].map((entity) => entity.id === id ? { ...entity, status, updatedAt: nowDateTime() } : entity);
  saveAndRender(message);
}
function suspendProject(id) { setEntityStatus("projects", id, "paused", "プロジェクトを中断しました"); }
function resumeProject(id) { setEntityStatus("projects", id, "active", "プロジェクトを再開しました"); }
function suspendTask(id) { setEntityStatus("tasks", id, "suspended", "タスクを中断しました"); }
function resumeTask(id) { setEntityStatus("tasks", id, "todo", "タスクを再開しました"); }

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

// v238: 完全同型の標準モーダル骨格だけを共通化する。専用class/actionの骨格は呼び出し側に残す。
// titleは呼び出し側でエスケープ済みであること(リテラル文字列のみ渡す)。
function modalHeaderHTML(title) {
  return `<div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">${title}</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">`;
}

function openTwyCommitSheet() {
  const weekStart = weekRange(todayISO()).weekStart;
  _twyCommitOpenGroupIds = new Set();
  _twyAddCandidateSelectedIds = new Set();
  _twyExcuseOpenItemId = null;
  _twyAddPanelOpen = false;
  const meta = twyCommittedWeekMeta(weekStart);
  _twyCommitSelectedBlockIds = meta ? new Set()
    : new Set(candidateBlocksForWeek(state, weekStart).map((block) => block.id));
  state.modal = { type: "twyCommit", id: weekStart };
  renderModal(buildTwyCommitSheetHTML(weekStart));
}

function buildTwyCommitSheetHTML(weekStart) {
  const meta = twyCommittedWeekMeta(weekStart);
  const range = weekRange(weekStart);
  const title = `WEEKLY COMMIT <span>${escapeHTML(twyDateLabel(range.weekStart))}〜${escapeHTML(twyDateLabel(range.weekEnd))}</span>`;
  return modalHeaderHTML(title) + `<div class="twy-commit-sheet">
    ${meta ? twyCommitPostHTML(weekStart) : twyCommitPreHTML(weekStart)}
    </div></div></div>`;
}

function twyCommitPreHTML(weekStart) {
  const candidates = candidateBlocksForWeek(state, weekStart);
  if (!candidates.length) return `<div class="twy-commit-meta">今週範囲に12WY候補Blockがありません。</div>`;
  const rows = twyCommitGroups(candidates).map((group) => twyCommitGroupRowHTML(group, "commit")).join("");
  return `<div class="twy-commit-meta">候補 = 今週範囲の12WYプロジェクト配下の予定Block(自動列挙・タスク単位に集約表示)。集約行のチェック=配下Block一括 / ▸で展開してBlock個別チェック</div>
    <div data-twy-commit-list>${rows}</div><div class="twy-commit-foot">
      <span class="twy-commit-count" data-twy-commit-count>${twyCommitCountLabel(candidates.length)}</span>
      <button type="button" class="commit-btn" data-action="twy-commit-week">今週を確定</button></div>`;
}

function twyCommitCountLabel(total) {
  return `選択中 ${_twyCommitSelectedBlockIds.size}コマ / 候補 ${total}コマ(Block単位で保存)`;
}

function twyCommitPostHTML(weekStart) {
  const meta = twyCommittedWeekMeta(weekStart);
  const items = (state.weeklyCommitments || []).filter((record) =>
    record.recordType === "item" && record.weekStart === weekStart && !record.deleted)
    .sort((a, b) => (a.plannedDate || "").localeCompare(b.plannedDate || ""));
  const selected = new Set(meta?.selectedBlockIds || []);
  const scoreItems = items.filter((item) => item.lane === "cycle"
    && (meta?.committedVia !== "manual" || selected.has(item.blockId) || item.source === "added"));
  const scoreItemIds = new Set(scoreItems.map((item) => item.id));
  const rows = items.map((item) => twyCommitItemRowHTML(item, scoreItemIds.has(item.id))).join("");
  return `<div class="twy-commit-meta">確定済 ${escapeHTML((meta?.committedAt || "").replace("T", " ").slice(0, 16))}</div>
    <div data-twy-commit-list>${rows || `<div class="twy-commit-meta">確定itemがありません。</div>`}</div>
    <div class="twy-commit-foot"><span class="twy-commit-count">${twyCommitScoreLabel(weeklyScore(state.weeklyCommitments || [], weekStart), Boolean(meta), scoreItems.filter((item) => item.excused).length)}</span>
      <button type="button" class="commit-btn" data-action="twy-add-item">+ 計画追加</button></div>
    ${_twyAddPanelOpen ? twyAddItemPanelHTML(weekStart) : ""}`;
}

function twyCommitScoreLabel(score, hasMeta = false, excusedCount = 0) {
  if (score.status === "uncommitted") return hasMeta ? "今週は対象なし" : "未確定";
  if (score.status === "na") return "N/A(全件免除)";
  return `完了 ${score.done}${excusedCount ? ` / 免除 ${excusedCount}` : ""} / 分母 ${score.total} → 実行 ${score.pct}%`;
}

function twyCommitItemRowHTML(item, inScoreScope = true) {
  const status = item.excused
    ? `<span class="c-when" data-action="twy-unexcuse" data-id="${escapeHTML(item.id)}">免除中(タップで解除)</span>`
    : item.completedAt ? `<span class="c-done">✓ 完了</span>`
      : inScoreScope ? `<span class="c-when" data-action="twy-excuse" data-id="${escapeHTML(item.id)}">未完了(タップで免除)</span>`
        : `<span class="c-when">対象外</span>`;
  return `<div class="twy-commit-row${item.excused ? " excused" : ""}${item.source === "added" ? " added" : ""}" data-twy-commit-item data-id="${escapeHTML(item.id)}">
    <input type="checkbox" checked disabled><span class="c-title">${escapeHTML(item.title)}(${escapeHTML(twyDateLabel(item.plannedDate))})
      ${item.excused ? `<small>免除理由: ${escapeHTML(item.excusedReason)}</small>` : ""}
      ${item.source === "added" ? `<small>確定後に追加</small>` : ""}</span>${status}</div>
    ${_twyExcuseOpenItemId === item.id ? twyExcuseFormHTML(item.id) : ""}`;
}

function twyExcuseFormHTML(itemId) {
  return `<div class="twy-excuse-form" data-twy-excuse-form><input type="text" data-twy-excuse-reason placeholder="免除理由(必須)">
    <button type="button" class="btn primary" data-action="twy-excuse-confirm" data-id="${escapeHTML(itemId)}">免除する</button>
    <button type="button" class="btn" data-action="twy-excuse-cancel">やめる</button></div>`;
}

function twyAddCandidates(weekStart) {
  const committed = new Set((state.weeklyCommitments || []).filter((record) =>
    record.recordType === "item" && record.weekStart === weekStart && !record.deleted).map((record) => record.blockId));
  return candidateBlocksForWeek(state, weekStart).filter((block) => !committed.has(block.id));
}

function twyAddItemPanelHTML(weekStart) {
  const candidates = twyAddCandidates(weekStart);
  if (!candidates.length) return `<div class="twy-add-panel" data-twy-add-panel><div class="twy-commit-meta">追加できる未コミット候補がありません。</div>
    <button type="button" class="btn" data-action="twy-add-item-cancel">閉じる</button></div>`;
  const rows = twyCommitGroups(candidates).map((group) => twyCommitGroupRowHTML(group, "add")).join("");
  return `<div class="twy-add-panel" data-twy-add-panel><div data-twy-commit-list>${rows}</div><div class="twy-commit-foot">
    <span class="twy-commit-count" data-twy-add-count>選択中 ${_twyAddCandidateSelectedIds.size}コマ</span>
    <button type="button" class="btn primary" data-action="twy-add-item-confirm">追加する</button>
    <button type="button" class="btn" data-action="twy-add-item-cancel">閉じる</button></div></div>`;
}

function twyCommitGroups(blocks) {
  const byTask = new Map();
  blocks.forEach((block) => { if (!byTask.has(block.taskId)) byTask.set(block.taskId, []); byTask.get(block.taskId).push(block); });
  return [...byTask.entries()].map(([taskId, taskBlocks]) => {
    const task = (state.tasks || []).find((entry) => entry.id === taskId);
    const project = (state.projects || []).find((entry) => entry.id === task?.projectId);
    const rule = (state.recurrences || []).find((entry) => !entry.deleted && entry.taskId === taskId);
    const sorted = taskBlocks.slice().sort((a, b) => (a.date + (a.plannedStartAt || "")).localeCompare(b.date + (b.plannedStartAt || "")));
    return { taskId, task, project, blocks: sorted, rule };
  }).sort((a, b) => (a.blocks[0]?.date || "").localeCompare(b.blocks[0]?.date || ""));
}

function twyCommitGroupRowHTML(group, ctx) {
  const selection = twyCommitSelectionFor(ctx);
  const checked = group.blocks.filter((block) => selection.has(block.id)).length, total = group.blocks.length;
  const track = group.project ? activeTrackForProject(state.tracks || [], group.project.id) : null;
  const sub = group.rule ? recurrenceKindLabel(group.rule.kind) : `単発Block×${total}`;
  const trackNote = track ? ` / ${escapeHTML(track.name)}${track.unit ? `(${escapeHTML(track.unit)})` : ""}` : "";
  const expanded = _twyCommitOpenGroupIds.has(`${ctx}:${group.taskId}`);
  return `<div class="twy-commit-row" data-twy-commit-group data-twy-task-id="${escapeHTML(group.taskId)}" data-twy-selection="${ctx}">
    <input type="checkbox" ${checked === total ? "checked" : ""} data-action="twy-commit-toggle-group" data-twy-task-id="${escapeHTML(group.taskId)}" data-twy-selection="${ctx}">
    <span class="c-title">${escapeHTML(group.task?.title || "")}<small>${escapeHTML(group.project?.title || "")}${trackNote} / ${escapeHTML(sub)}</small></span>
    <span class="c-caret" data-action="twy-commit-expand" data-twy-task-id="${escapeHTML(group.taskId)}" data-twy-selection="${ctx}">${checked}/${total}コマ ${expanded ? "▾" : "▸"}</span>
    </div>${expanded ? twyCommitSubRowsHTML(group, ctx) : ""}`;
}

function twyCommitSubRowsHTML(group, ctx) {
  const selection = twyCommitSelectionFor(ctx);
  return group.blocks.map((block) => `<div class="twy-commit-sub" data-twy-commit-sub data-twy-task-id="${escapeHTML(group.taskId)}" data-twy-block-id="${escapeHTML(block.id)}" data-twy-selection="${ctx}">
    <input type="checkbox" ${selection.has(block.id) ? "checked" : ""} data-action="twy-commit-toggle-block" data-twy-block-id="${escapeHTML(block.id)}" data-twy-task-id="${escapeHTML(group.taskId)}" data-twy-selection="${ctx}">
    <span class="c-title">${escapeHTML(twyDateLabel(block.date))}${block.plannedStartAt ? " " + escapeHTML(timeFromDateTime(block.plannedStartAt)) : ""}</span>
    <span class="c-when">${block.estimateMin ? escapeHTML(block.estimateMin) + "分" : ""}</span></div>`).join("");
}

function twyCommitSelectionFor(ctx) {
  return ctx === "add" ? _twyAddCandidateSelectedIds : _twyCommitSelectedBlockIds;
}

function twyCommittedWeekMeta(weekStart) {
  return (state.weeklyCommitments || []).find((record) =>
    record.id === "wcw_" + weekStart && record.recordType === "week" && !record.deleted);
}

function twyCurrentCommitModalWeek() {
  const weekStart = state.modal?.id;
  return state.modal?.type === "twyCommit" && weekStart === weekRange(todayISO()).weekStart ? weekStart : "";
}

function twyCommitItemForWeek(itemId, weekStart) {
  return (state.weeklyCommitments || []).find((record) =>
    record.id === itemId && record.recordType === "item" && record.weekStart === weekStart && !record.deleted);
}

function twyDateLabel(iso) {
  return `${iso.slice(5).replace("-", "/")}(${weekdayLabel(iso)})`;
}

function twyCommitGroupByTaskId(ctx, taskId) {
  const blocks = !state.modal?.id ? [] : ctx === "add"
    ? twyAddCandidates(state.modal.id) : ctx === "commit" ? candidateBlocksForWeek(state, state.modal.id) : [];
  const group = twyCommitGroups(blocks).find((entry) => entry.taskId === taskId);
  return group ? { ...group, candidateCount: blocks.length } : null;
}

function twyCommitRefreshFooter(ctx, candidateCount) {
  if (!state.modal?.id) return;
  const count = modalRoot.querySelector(ctx === "add" ? "[data-twy-add-count]" : "[data-twy-commit-count]");
  if (count) count.textContent = ctx === "add"
    ? `選択中 ${_twyAddCandidateSelectedIds.size}コマ` : twyCommitCountLabel(candidateCount);
}

function twyCommitUpdateCaret(ctx, group, checkedCount) {
  const selection = twyCommitSelectionFor(ctx);
  const checked = checkedCount ?? group.blocks.filter((block) => selection.has(block.id)).length;
  const caret = modalRoot.querySelector(`.twy-commit-row[data-twy-task-id="${CSS.escape(group.taskId)}"][data-twy-selection="${ctx}"] .c-caret`);
  if (caret) caret.textContent = `${checked}/${group.blocks.length}コマ ${_twyCommitOpenGroupIds.has(`${ctx}:${group.taskId}`) ? "▾" : "▸"}`;
}

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
  _aiStepConfirmCtx = null;  // v198(第3弾3e): ×/背景タップ等の暗黙クローズでも一時状態を残さない
  _aiStepPending = null;     // v198(第3弾3e): 確認シートを閉じたら多重発火ロックも解放する
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
  // v178: project/task/block/actualEntry/question/experiment/storeVisitを
  // registerModalHandlerへ移行済みのため、if-else連鎖は撤去した(dispatchModalSaveが必ずtrueを
  // 返す。未登録typeが将来増えた場合はfalseで素通りし、何もしない=移行前の「どのtypeにも
  // マッチしない」場合と同じ挙動)。
  dispatchModalSave(state.modal.type, state.modal.id, fields);
}

function deleteFromModal() {
  if (!state.modal) return;
  const ok = window.confirm("削除しますか? この操作は取り消せます(deleted フラグ)。");
  if (!ok) return;
  // v178: 同上(submitModal参照)。project/task/block/question/experiment/storeVisitは
  // dispatchModalDelete経由でcloseModal()まで実行する。actualEntryはdelete未登録
  // (従来からdeleteFromModal側に対応する型が無い)ため、dispatchModalDeleteがfalseを返し
  // 下のcloseModal()だけが実行される(移行前と同じ挙動)。
  if (dispatchModalDelete(state.modal.type, state.modal.id)) {
    closeModal();
    return;
  }
  closeModal();
}

// ---------- Project モーダル ----------
// v258: 12WYトラックフォームは入力中の値を守るため、kind/節目/警告をモーダルDOM内だけで更新する。

function trackMilestoneRowHTML(milestone = {}) {
  return `<div class="twy-ms-edit-row" data-twy-ms-id="${escapeHTML(milestone.id || "")}">
    <input class="input" data-twy-ms-label value="${escapeHTML(milestone.label || "")}" placeholder="節目">
    <input class="input" type="date" data-twy-ms-date value="${escapeHTML(milestone.plannedDate || "")}">
    <button type="button" data-action="twy-ms-del" aria-label="節目を削除">×</button></div>`;
}

function trackCarryMilestoneRowsHTML(track) {
  const milestones = (track?.milestones || []).filter((milestone) => !milestone.deleted && !milestone.doneAt);
  if (!milestones.length) return `<div class="muted">未完了の節目はありません(全節目達成済み)。このまま移行するとトラックは終了し、新しい目標を登録できます。</div>`;
  return milestones.map((milestone) => `<div class="twy-carry-ms-row" data-twy-carry-ms-row data-twy-carry-ms-id="${escapeHTML(milestone.id)}">
    <span>${escapeHTML(milestone.label)}</span>
    <input class="input" type="date" data-twy-carry-ms-date>
  </div>`).join("");
}

function readCarryDraft(existing) {
  if (existing.kind === "numeric") {
    const deadline = modalRoot.querySelector("[data-twy-carry-deadline]")?.value || "";
    const goalRaw = modalRoot.querySelector("[data-twy-carry-goal]")?.value ?? "";
    return { deadline, ...(goalRaw !== "" ? { goalValue: Number(goalRaw) } : {}) };
  }
  const milestonePlannedDates = {};
  modalRoot.querySelectorAll("[data-twy-carry-ms-row]").forEach((row) => {
    milestonePlannedDates[row.dataset.twyCarryMsId] = row.querySelector("[data-twy-carry-ms-date]")?.value || "";
  });
  return { milestonePlannedDates };
}

// v259: carry対象は現サイクル外のうち過去側だけに限定する。
function canCarryProjectCycle(project) {
  const cycleStart = state.settings.twelveWeekStartDate;
  return Boolean(project?.twelveWeekStartDate && cycleStart
    && !isProjectInCurrentCycle(project, cycleStart) && project.twelveWeekStartDate < cycleStart);
}

function confirmCarryProjectCycle() {
  const id = state.modal?.id;
  const project = state.projects.find((entry) => entry.id === id && !entry.deleted);
  const newCycleStartDate = state.settings.twelveWeekStartDate;
  if (!id || !canCarryProjectCycle(project)) return;
  const existing = activeTrackForProject(state.tracks || [], id);
  if (!window.confirm(`12WY開始日を新サイクル(${newCycleStartDate})へ更新しますか?\nモーダルの未保存の編集は破棄されます`)) return;
  const result = carryProjectToNewCycle(id, newCycleStartDate, existing ? readCarryDraft(existing) : {});
  if (!result.ok) {
    const errors = modalRoot.querySelector("[data-twy-carry-errors]");
    if (errors) { errors.hidden = false; errors.textContent = result.errors.join(" / "); }
    else showToast(result.errors.join(" / "));
    return;
  }
  if (result.carriedWithoutTrack) {
    saveAndRender("トラックを終了して新サイクルへ移行しました。新しい目標があれば登録してください");
    openProjectEditor(id);
    return;
  }
  closeModal();
  saveAndRender("新サイクルへ移行しました");
}

function readTrackDraft(fields) {
  const common = { name: fields.twyName || "", startDate: fields.twyStartDate || "" };
  if (fields.twyKind === "numeric") return { ...common, unit: fields.twyUnit || "", deadline: fields.twyDeadline || "",
    baselineValue: fields.twyBaseline, goalValue: fields.twyGoal, valueStep: fields.twyStep };
  return { ...common, milestones: [...modalRoot.querySelectorAll(".twy-ms-edit-row")].map((row) => ({
    ...(row.dataset.twyMsId ? { id: row.dataset.twyMsId } : {}),
    label: row.querySelector("[data-twy-ms-label]")?.value || "",
    plannedDate: row.querySelector("[data-twy-ms-date]")?.value || ""
  })) };
}

function trackDraftMatchesExisting(existing, kind, draft) {
  if (!existing || existing.kind !== kind
    || String(existing.name || "").trim() !== String(draft.name || "").trim()
    || (existing.startDate || "") !== (draft.startDate || "")) return false;
  if (kind === "numeric") return String(existing.unit || "").trim() === String(draft.unit || "").trim()
    && (existing.deadline || "") === (draft.deadline || "")
    && ["baselineValue", "goalValue", "valueStep"].every((key) =>
      draft[key] !== null && draft[key] !== "" && Number(existing[key]) === Number(draft[key]));
  const milestones = (existing.milestones || []).filter((milestone) => !milestone.deleted);
  return milestones.length === draft.milestones.length && milestones.every((milestone, index) => {
    const edited = draft.milestones[index];
    return milestone.id === edited.id && String(milestone.label || "").trim() === String(edited.label || "").trim()
      && (milestone.plannedDate || "") === (edited.plannedDate || "");
  });
}

function trackGuardHTML(projectId, kind, draft) {
  const taskIds = new Set((state.tasks || []).filter((task) => !task.deleted && task.projectId === projectId).map((task) => task.id));
  const range = weekRange(todayISO());
  const hasAction = (state.recurrences || []).some((rule) => !rule.deleted && taskIds.has(rule.taskId))
    || (state.blocks || []).some((block) => !block.deleted && !block.migratedTo && taskIds.has(block.taskId)
      && block.date >= range.weekStart && block.date <= range.weekEnd);
  const milestones = draft.milestones || [];
  const dates = milestones.map((m) => m.plannedDate).filter((date) => dateParts(date)).sort();
  const rows = [
    [kind === "numeric" ? draft.goalValue !== null && draft.goalValue !== ""
      && Number.isFinite(Number(draft.goalValue)) && Number(draft.goalValue) !== Number(draft.baselineValue) : milestones.length > 0, "完了条件が数値/節目で判定できる"],
    [kind === "numeric" ? Boolean(draft.deadline) : dates.length > 0, "期限がある"],
    [hasAction, "行動コマがある — 無ければ繰り返しコマか当週の単発コマを設定"]
  ];
  if (kind === "milestone") rows.push(
    [milestones.length >= 2, "節目が少ないと期限直前まで遅れを検出できません。2週に1本を目安に刻んでください"],
    [milestones.length >= 2 && dates.length === milestones.length
      && dates.slice(1).every((date, i) => daysBetween(dates[i], date) <= 21), "隣接節目は3週(21日)以内を目安にしてください"]
  );
  return `<div class="twy-guard-title">粒度ガード(3チェック・12WY 5ルールの簡略版)</div>${rows.map(([ok, text]) =>
    `<div class="twy-guard-item ${ok ? "ok" : "ng"}">${ok ? "✓" : "△"} ${text}</div>`).join("")}`;
}

function refreshTrackForm() {
  const section = modalRoot.querySelector("[data-twy-track]");
  if (!section) return;
  const kind = section.querySelector('[data-modal-field="twyKind"]')?.value || "none";
  section.querySelectorAll("[data-twy-kind]").forEach((button) => button.classList.toggle("sel", button.dataset.twyKind === kind));
  section.querySelector("[data-twy-details]").hidden = kind === "none";
  section.querySelector("[data-twy-numeric]").hidden = kind !== "numeric";
  section.querySelector("[data-twy-milestone]").hidden = kind !== "milestone";
  section.querySelector("[data-twy-guard]").hidden = kind === "none";
  section.querySelector("[data-twy-guard]").innerHTML = kind === "none" ? "" : trackGuardHTML(state.modal?.id, kind, readTrackDraft(readModalFields()));
  const errors = section.querySelector("[data-twy-errors]");
  errors.hidden = true; errors.textContent = "";
}

function setTrackKind(kind) {
  const input = modalRoot.querySelector('[data-modal-field="twyKind"]');
  if (input) { input.value = kind; refreshTrackForm(); }
}

function saveProjectTrackFromModal(id, fields) {
  if (!fields.is12WY) return true;
  const existing = activeTrackForProject(state.tracks || [], id);
  const kind = fields.twyKind || "none";
  if (kind === "none") {
    if (existing && !window.confirm("12WYトラックを終了しますか?(過去の記録は保持されます)")) {
      setTrackKind(existing.kind); return true;
    }
    if (existing) closeActiveTrackManual(id);
    return true;
  }
  const draft = readTrackDraft(fields);
  if (existing && trackDefinitionChanged(existing, kind, draft)
    && !window.confirm("計測方法が変わります。過去の記録を保持して新しいトラックを開始しますか?")) return false;
  if (trackDraftMatchesExisting(existing, kind, draft)) return true;
  const result = saveTrackFromForm(id, kind, draft);
  if (result.ok) return true;
  const errors = modalRoot.querySelector("[data-twy-errors]");
  if (errors) { errors.hidden = false; errors.textContent = result.errors.join(" / "); }
  return false;
}

function buildProjectModal(project) {
  const status = project.status || "active";
  const kind = project.kind || "normal";
  const is12WY = Boolean(project.twelveWeekStartDate);
  const track = activeTrackForProject(state.tracks || [], project.id);
  const trackKind = track?.kind || "none";
  // v259: 表示・action・確定の3経路で同じ過去側carry判定を使う。
  const canCarryCycle = is12WY && canCarryProjectCycle(project);
  const numericGoalIsReached = trackKind === "numeric" && numericGoalReached(track,
    latestMeasurement(state.trackMeasurements || [], track.id)?.value ?? track.baselineValue);
  // v127追補(Codex P1): やりたいことの唯一のコンテナ(kind:"wish")は種別変更・削除ができると
  // getWishProject()の前提が壊れる(既存Wishタスクが迷子になる)ため、編集モーダル側でも
  // 種別プルダウンをdisabledにして固定表示にし、削除ボタン自体を出さない(deleteProject側の
  // ガードと二重防御)。
  const isWishSingleton = kind === "wish";
  return `
    ${modalHeaderHTML("Project を編集")}
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
            12WY 期間に登録する(現在の 12WY 開始日: ${escapeHTML(state.settings.twelveWeekStartDate || "未設定")})
          </label>
        </div>
        ${canCarryCycle ? `<div class="twy-carry" data-twy-carry>
          <div class="twy-track-errors" style="background:transparent;color:var(--muted)">
            前サイクルのプロジェクトです(開始日: ${escapeHTML(project.twelveWeekStartDate)})。新サイクル(${escapeHTML(state.settings.twelveWeekStartDate)})へ移行できます。
            移行するとこのモーダルの未保存の編集は破棄されます。
          </div>
          <button type="button" class="btn" data-action="twy-carry-cycle">新サイクルへ移行</button>
          ${track ? `<div class="twy-form" data-twy-carry-form hidden>
            ${numericGoalIsReached ? `<div class="muted" data-twy-carry-goal-reached>目標に到達しています。空欄のまま確定するとトラックは終了し、新しい目標を登録できます。</div>` : ""}
            <div class="twy-grid2" data-twy-carry-numeric ${trackKind === "numeric" ? "" : "hidden"}>
              <label>新しい期限<input class="input" type="date" data-twy-carry-deadline></label>
              <label>新しい目標値(空欄=旧目標を引き継ぐ(達成済みなら終了))<input class="input" type="number" inputmode="decimal" data-twy-carry-goal
                placeholder="現在の目標: ${escapeHTML(track.goalValue ?? "")}"></label>
            </div>
            <div data-twy-carry-milestones ${trackKind === "milestone" ? "" : "hidden"}>
              ${trackKind === "milestone" ? trackCarryMilestoneRowsHTML(track) : ""}
            </div>
            <div class="twy-track-errors" data-twy-carry-errors role="alert" hidden></div>
            <button type="button" class="btn primary" data-action="twy-carry-confirm">移行を確定</button>
          </div>` : ""}
        </div>` : ""}
        <section class="twy-track-section" data-twy-track ${is12WY ? "" : "hidden"}>
          <div class="twy-track-title">12WY TRACK <span>任意・1プロジェクト1トラック</span></div>
          <div class="twy-kind">
            ${[["numeric", "数値", "章・kg・件・冊など"], ["milestone", "節目", "要件→設計→提出など"], ["none", "なし", "行動コマだけで運用"]].map(([value, label, hint]) =>
              `<button type="button" class="${trackKind === value ? "sel" : ""}" data-action="twy-kind-${value}" data-twy-kind="${value}"><b>${label}</b><i>${hint}</i></button>`).join("")}
          </div>
          <input type="hidden" data-modal-field="twyKind" value="${trackKind}">
          <div class="twy-form" data-twy-details ${trackKind === "none" ? "hidden" : ""}>
            <div class="twy-grid2">
              <label>トラック名<input class="input" data-modal-field="twyName" value="${escapeHTML(track?.name || "")}"></label>
              <label>開始日<input class="input" type="date" data-modal-field="twyStartDate" value="${escapeHTML(track?.startDate || todayISO())}"></label>
            </div>
            <div class="twy-grid3" data-twy-numeric ${trackKind === "numeric" ? "" : "hidden"}>
              <label>開始値<input class="input" type="number" inputmode="decimal" data-modal-field="twyBaseline" value="${escapeHTML(track?.baselineValue ?? 0)}"></label>
              <label>目標値<input class="input" type="number" inputmode="decimal" data-modal-field="twyGoal" value="${escapeHTML(track?.goalValue ?? 0)}"></label>
              <label>単位<input class="input" data-modal-field="twyUnit" value="${escapeHTML(track?.unit || "")}"></label>
              <label>期限<input class="input" type="date" data-modal-field="twyDeadline" value="${escapeHTML(track?.deadline || "")}"></label>
              <label>刻み幅<input class="input" type="number" inputmode="decimal" data-modal-field="twyStep" value="${escapeHTML(track?.valueStep ?? 1)}"></label>
            </div>
            <div class="twy-ms-edit" data-twy-milestone ${trackKind === "milestone" ? "" : "hidden"}>
              <div data-twy-ms-list>${(track?.milestones || []).filter((m) => !m.deleted).map(trackMilestoneRowHTML).join("")}</div>
              <button type="button" class="twy-ms-add" data-action="twy-ms-add">+ 節目を追加</button>
            </div>
            <div class="twy-track-errors" data-twy-errors role="alert" hidden></div>
            <div class="twy-guard" data-twy-guard ${trackKind === "none" ? "hidden" : ""}>${trackKind === "none" ? "" : trackGuardHTML(project.id, trackKind, {
              name: track?.name || "", startDate: track?.startDate || todayISO(), unit: track?.unit || "", deadline: track?.deadline || "",
              baselineValue: track?.baselineValue ?? 0, goalValue: track?.goalValue ?? 0, valueStep: track?.valueStep ?? 1,
              milestones: (track?.milestones || []).filter((m) => !m.deleted)
            })}</div>
          </div>
        </section>
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
  const existing = state.projects.find((project) => project.id === id);
  const previousCycleStartDate = state.settings.twelveWeekStartDate || "";
  let twelveWeekStartDate = fields.is12WY
    ? (previousCycleStartDate || existing?.twelveWeekStartDate || todayISO()) : "";
  if (fields.is12WY && !previousCycleStartDate) state.settings.twelveWeekStartDate = twelveWeekStartDate;
  if (!saveProjectTrackFromModal(id, fields)) {
    state.settings.twelveWeekStartDate = previousCycleStartDate;
    return;
  }
  if (existing?.twelveWeekStartDate && !fields.is12WY && activeTrackForProject(state.tracks || [], id)) {
    if (window.confirm("12WYトラックを終了しますか?")) closeActiveTrackManual(id);
    else twelveWeekStartDate = existing.twelveWeekStartDate;
  }
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
    ${modalHeaderHTML(task.id ? "Task を編集" : "Task を追加")}
        ${task.id ? "" : `<input type="hidden" data-modal-field="order" data-modal-kind="number" value="${Number.isFinite(task.order) ? task.order : ""}">`}
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
          <label class="checkbox-line">
            <input type="checkbox" data-modal-field="planTarget" ${task.planTarget ? "checked" : ""}>
            📋 実行計画を使う
          </label>
          <div class="muted" style="font-size:12px">AI作業 = タスク丸ごと発注 / 実行計画 = ステップに割って往復</div>
        </div>
        ${task.id ? renderPlanStepSectionHTML(task) : ""}
        ${task.owner === "ai" ? `<div class="field">
          <label class="field-label">AI指示文(実行計画のステップ用)</label>
          <textarea class="textarea" data-modal-field="aiBrief" style="min-height:72px; font-size:16px" placeholder="このステップでAIにしてほしいこと">${escapeHTML(task.aiBrief || "")}</textarea>
        </div>` : ""}
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
  // v198(第3弾3e): この新規作成分岐はmaybeQueueNextAiStepの対象外(意図的な除外)。作成時点では
  // taskがまだstate.tasksに存在せず、parentTaskIdがあってもplanParentFor()の判定が成立しないため
  // (実装設計書A節・phase3-design.md §1「対象外と明示するもの」参照)。
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
    task.owner = fields.aiWork ? "ai" : "k";
    task.aiWork = task.owner === "ai";  // v195: ownerを正典に既存ワーカーへ追随
    task.aiWorkBrief = (fields.aiWorkBrief || "").trim();
    task.planTarget = Boolean(fields.planTarget);
    task.aiBrief = (fields.aiBrief || "").trim();
    task.order = Number.isFinite(fields.order) ? fields.order : task.order;
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
  const changedAt = nowDateTime();
  const editingTask = state.tasks.find((t) => t.id === id && !t.deleted);
  if (editingTask && planParentFor(editingTask)) ensurePlanSiblingOrders(editingTask, changedAt);
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
      owner: fields.aiWork ? "ai" : "k",
      aiWork: Boolean(fields.aiWork),  // v195: ownerから導出。既存checkboxも同じ正典を書き換える
      aiWorkBrief: (fields.aiWorkBrief || "").trim(),
      planTarget: Boolean(fields.planTarget),
      aiBrief: fields.aiBrief !== undefined ? (fields.aiBrief || "").trim() : (t.aiBrief || ""),
      doneCriteria: (fields.doneCriteria || "").trim(),  // v96: 完了条件
      firstStep: (fields.firstStep || "").trim(),        // v96: スモールステップ
      // v117(B): チェックボックス表示は反転(「自己締切ON」)なので保存時に戻す
      selfDueOff: fields.selfDueEnabled !== undefined ? !fields.selfDueEnabled : Boolean(t.selfDueOff),
      // v37: モーダルに nextRoutineId の入力欄はないため、undefined なら既存値を保持
      //      (以前は保存のたびに "" で消えていた)
      nextRoutineId: fields.nextRoutineId !== undefined ? fields.nextRoutineId : (t.nextRoutineId || ""),
      updatedAt: changedAt
    };
  });
  closeModal();
  saveAndRender("Taskを更新しました");
  if (editingTask) maybeQueueNextAiStep(id, editingTask.status);  // v198(第3弾3e): 完了6経路#4
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
    ${modalHeaderHTML("Block を編集")}
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
                ${["daily", "weekdays"].includes(liveRule.kind) ? `
                <label class="checkbox-line" style="margin-top:10px">
                  <input type="checkbox" data-modal-field="streakFixed" ${liveRule.streakSince ? "checked" : ""}>
                  固定化してストリークを記録する
                </label>` : ""}
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
                  <label class="field-label">アンカー(既存の別ルーティン/チェーンの直後に自動配置)</label>
                  <select class="select" data-modal-field="anchor">
                    <option value="" ${!liveRule.anchor ? "selected" : ""}>(アンカーなし)</option>
                    ${anchorCandidateOptions(liveRule.id).map((o) => `<option value="${o.id}" ${liveRule.anchor === o.id ? "selected" : ""}>${escapeHTML(o.label)}</option>`).join("")}
                  </select>
                  <div class="muted" style="font-size:11px; margin-top:4px">選んだルーティン/チェーンが完了した直後の時刻に、このルーティンのBlockを自動生成します。</div>
                </div>
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
    everStartedAt: existing?.everStartedAt || fromLocalInput(fields.actualStartAt) || "",
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
    // v215: 旧版の実績記録マーカーは編集モーダルで落とさず、過去データの除外契約を維持する。
    oneTap: existing?.oneTap || false,
    externalRef: existing?.externalRef || "",
    label: existing?.label || "",
    timeswitchStart: existing?.timeswitchStart || false,
    createdAt: existing?.createdAt || nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
  const trackSavedBlockTransitions = () => {
    const savedBlock = state.blocks.find((block) => block.id === id);
    saveState();
    if (!existing?.actualStartAt && savedBlock?.actualStartAt) trackOnBlockStarted(savedBlock);
    if (Boolean(existing?.completed) !== Boolean(savedBlock?.completed)) {
      trackOnBlockCompletionChanged(savedBlock, Boolean(savedBlock?.completed), { interactive: false });
    }
  };
  // v29: 予定の開始・終了日時は必須。空のままでは登録/保存させない。
  if (!updated.plannedStartAt || !updated.plannedEndAt) {
    showToast("予定の開始・終了日時を入力してください");
    return;
  }
  const currentRule = existing?.recurrenceGroupId
    ? (state.recurrences || []).find((r) => r.id === existing.recurrenceGroupId && !r.deleted)
    : null;
  const requestedKind = fields.recurrenceKind;
  const nextRuleKind = requestedKind && !requestedKind.startsWith("__") ? requestedKind : currentRule?.kind;
  const streakEdit = habitStreakEdit(currentRule, nextRuleKind, fields.streakFixed);
  if (!streakEdit.ok) {
    showToast("固定化できるルーティンは3件までです");
    return;
  }
  // v191レビュー反映(修正9・3周目): 検証より後で呼ぶ(検証エラー中断時に実行中ルーティンが
  // 閉じられたまま巻き戻らない穴を防ぐ)。v215: 呼び先はタブ非依存の存置版に差し替え。
  if (updated.actualStartAt && !updated.actualEndAt) autoCloseStaleRoutineRuns(updated.id);
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
      trackSavedBlockTransitions();
      closeModal();
      saveAndRender(`繰り返し「${recurrenceKindLabel(rk)}」を設定しました`);
      return;
    }
    state.blocks.push(updated);
    trackSavedBlockTransitions();
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
    if (currentRule && currentRule.streakSince !== streakEdit.value) {
      state.recurrences = state.recurrences.map((r) => r.id === currentRule.id
        ? { ...r, streakSince: streakEdit.value, updatedAt: nowDateTime() }
        : r);
    }
    if (existing.completed !== updated.completed) syncHabitStreakForBlock(updated);
    if (!existing.completed && updated.completed) {
      transferIronLogToCompletedBlock(id);
      generateReport(updated.date, { quiet: true });
    }
    const rk = fields.recurrenceKind;
    // v23: "__keep__"・空・未指定 → この Block の編集のみ(シリーズ設定は不変)
    if (rk && rk !== "__keep__") {
      if (rk === "__end__") {
        // シリーズ終了(以降の自動生成を停止。実績履歴はそのまま残る)
        if (existing.recurrenceGroupId) endRecurrenceSeries(existing.recurrenceGroupId, { excludeId: id });
        trackSavedBlockTransitions();
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
          trackSavedBlockTransitions();
          closeModal();
          saveAndRender("Blockを更新しました");
          return;
        }
        updated.recurrenceGroupId = rule.id;
        state.blocks = state.blocks.map((b) => b.id === id ? updated : b);
      }
      maintainRecurrences();
      trackSavedBlockTransitions();
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
    trackSavedBlockTransitions();
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
  if (event.key === "Enter" && event.target?.id === "blockTitle") {
    if (_imeComposing || event.isComposing) return;
    event.preventDefault();
    addBlock();
    return;
  }
  if (event.key === "Escape" && state.modal) {
    closeModal();
  }
});

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
    ${modalHeaderHTML("✅ 実績を登録")}
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
  const previousBlock = state.blocks.find((b) => b.id === blockId);
  const wasCompleted = Boolean(previousBlock?.completed);
  state.blocks = state.blocks.map((b) => {
    if (b.id !== blockId) return b;
    return {
      ...b,
      actualStartAt: fromLocalInput(fields.actualStartAt),
      everStartedAt: b.everStartedAt || fromLocalInput(fields.actualStartAt),
      actualEndAt: fromLocalInput(fields.actualEndAt),
      charge: Number(fields.charge) || 0,
      discharge: Number(fields.discharge) || 0,
      comment: fields.comment || "",
      completed: true,
      updatedAt: nowDateTime()
    };
  });
  if (!wasCompleted) transferIronLogToCompletedBlock(blockId);
  // Task の状態を doing に
  const block = state.blocks.find((b) => b.id === blockId);
  if (!wasCompleted && block) syncHabitStreakForBlock(block);
  if (block?.taskId) {
    state.tasks = state.tasks.map((t) =>
      t.id === block.taskId && t.status === "todo"
        ? { ...t, status: "doing", updatedAt: nowDateTime() }
        : t
    );
  }
  if (block) generateReport(block.date, { quiet: true });
  closeModal();
  // 実績モードに切り替えて表示
  state.timelineMode = "actual";
  saveState();
  if (!previousBlock?.actualStartAt && block?.actualStartAt) trackOnBlockStarted(block);
  if (!wasCompleted && block?.completed) {
    trackOnBlockCompletionChanged(block, true, { interactive: false });
  }
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
  // v187: oneTap(ワンタップ計時)Blockは「いまの活動の記録」であり計画ではないため、
  //       着地予定・残り見積の母集合から除外する(設計§2.2。planned=actual同値の30分が
  //       予定作業として上乗せされる誤差を防ぐ)
  blocksForDate(dateISO).filter((b) => !b.completed && !b.migratedTo && !b.oneTap).forEach((b) => {
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
  const remaining = blocksForDate(today).filter((b) => !b.completed && !b.migratedTo);
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
// きっかけ(Block操作等)が無いまま時間が過ぎるとタイムライン実カーブの表示が
// 凍ったままになる。startTimerTicker(500ms周期)に載せて軽量な差分更新をするが、減衰は
// 1時間3程度の緩やかな変化のためBATTERY_TICK_INTERVAL_MS(既定1分)でスロットルする。
// 全再描画(render())はしない — 検索入力のフォーカス・IME入力中の状態を飛ばさないため、
// 該当要素(.energy-graph-overlay)だけをouterHTMLで差し替える。
function updateBatteryTick() {
  if (Date.now() - _lastBatteryTickAt < BATTERY_TICK_INTERVAL_MS) return;
  _lastBatteryTickAt = Date.now();
  if (state.selectedDate !== todayISO()) return;
  if (state.currentView === "timeline") {
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
const BUFFER_METER_VIEWS = ["tasks", "timeline", "journal"];
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
    // 責めないトーンで提案するだけに留める。
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
// v53: 自動アーカイブ(既定ON・1日1回)。同期・自動レビューの後に静かに実行。
setTimeout(maybeAutoArchive, 8000);
// v41/v43: 復帰時。自動同期 ON なら pull(内部で日次オープン)、OFF なら日次オープンのみ。
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  // PUT直後の復帰でも初回60秒待機は守る。1分経過後はiOSの停止タイマーを復帰時照合で補う。
  if (_replanPending && !_replanPollBusy
    && Date.now() - _replanPending.startedAtMs >= REPLAN_POLL_MS) {
    stopReplanPolling();
    pollReplanResponse();
  }
  // v196: 実行計画(plan-step)も再プランと同じ復帰時即照合を行う。
  if (_planStepPending && !_planStepPollBusy
    && Date.now() - _planStepPending.startedAtMs >= PLAN_STEP_POLL_MS) {
    stopPlanStepPolling();
    pollPlanStepResponse();
  }
  if (state.settings.autoSync) runAutoSyncPull();
  else if (runDailyOpen()) render();
  setTimeout(maybeAutoArchive, 8000);        // v53: 同上
  maybeRefreshFeedback();                    // v77: フォアグラウンド復帰時にAIフィードバック等を再fetch
});
