// tests/action-registry-core.test.js
// v172: app.js分割・段階5-1(event dispatcherのレジストリ基盤導入)のcharacterization test。
// v173: 段階5-2(抽出済みfeatureのaction移行)で
// [3]を拡張した。
// v174: 段階5-3(残ドメイン=settings/sync/core(nav)、20分岐の相乗り移行)で[3]をさらに拡張した。
// [3]をさらに拡張した(独立レビュー対応: journal系71件見積りの一括移行は実行コード差分が
// 200行を超えるため、設計書§7どおり2コミットへ分割した)。
// v177: 段階5-6b(journal系残ドメインの後半=問い10+その他19、計29分岐の相乗り移行)で
// 計65分岐すべての移行が完了した。
// v174分(20件)+v176分(36件)+v177分(29件)=計85件は、いずれもsrc/features/journal.js等へ
// 未抽出(ハンドラ実体がapp.js残留)のため、app.js自身がregisterActionsを直接呼ぶ(4featureの
// configureXxxのようにdeps注入で呼び出す関数がない)。app.jsはDOM初期化を伴い素朴にはNode環境
// でimportできないため、この85件はダミー実行ではなく静的正規表現抽出(extractAppRegisteredActions、
// §2のextractClickActionsと同じ方式)で検証する。
// v178: 段階5-7a(modal系dispatcher分岐の移行・前半=WBS/Project/Task CRUD 18+モーダル起動系
// modal-close/modal-delete/lev-judge 3、計21分岐)で[3]をさらに拡張した。modal-saveは
// 過去判定どおりreturn意味論がありif連鎖に残置。ビジョンボード/実験ログ/AIスケジュール下書き/
// 検索(計21分岐)は200行予算のため次バージョンへ継続する。
// v178はさらに、submitModal/deleteFromModalのstate.modal.typeによるif-else連鎖(project/task/
// block/actualEntry/question/experiment/storeVisit)をregisterModalHandlerへ
// 全件移行した(段階5-8、prep-stage5-dispatcher.md §5のMust級指摘の解消)。[5]でこの7 typeの
// golden list exhaustiveness(if連鎖残存type+レジストリ登録type=全typeの完全一致)を検証する。
// v179: 段階5-7b(modal系dispatcher分岐の移行・後半=ビジョンボード6+実験ログ5+AIスケジュール
// 下書き8+検索2、計21分岐)で[3]をさらに拡張した。これでprep-stage5-dispatcher.md §2-Cの
// modalバケツ(44件)がすべて移行済みになった。
// v180: 段階5-8(timeline系dispatcher分岐の移行・前半=Block作成2+Block/Now9+ポモドーロ16、
// 計27分岐)で[3]をさらに拡張した。timeline系40分岐は200行予算に収まらないため2分割し、
// 後半(日付ナビ3+タイムライン設定/カテゴリフィルタ9+timeline-mode)はv181で継続する。
// v181: 段階5-8(timeline系dispatcher分岐の移行・後半=日付ナビ3+タイムライン設定/
// カテゴリフィルタ9、計12分岐)で[3]をさらに拡張した。ハンドラ実体がsrc/features/timeline.jsに
// 既にあるtimeline-mode(1件)は4feature側と同じ動的実測方式([3-b])で検証する
// (FEATURE_MODULE_PATHSにtimeline.jsを追加)。これでtimeline系40分岐(v180前半27+v181後半12+
// timeline-mode1)すべての移行が完了した。
// prep-stage5-dispatcher.md §6-1の方式どおり構成:
//   [1] src/ui/actions.jsの単体挙動(registerActions/dispatchAction、
//       registerModalHandler/dispatchModalSave/dispatchModalDelete、重複登録ガード、
//       未登録時のfalseフォールバック)。
//   [2] app.jsのclick dispatcher("event:click"、data-action分岐)から`action === "..."`を
//       静的抽出する(削除済み機能のactionを除く221件(v290でATIS孤児action4件=ai-work-approve/ai-work-question/ai-task-adopt/ai-task-dismissを削除、
//       v291でHome撤去(v230)後片付け孤児3件=open-questions/open-future-letter/open-vision-board
//       +重複登録1件=delete-blockを削除、v294で「書く瞑想」パネル3件=km-chip-add/km-chip-remove/
//       km-saveを追加)のゴールデンリストを維持したまま、段階5-2/5-3で移行済みの分だけif連鎖から
//       消えている前提)。
//   [3] 「if連鎖側の残存分岐リスト」(§2で静的抽出)と「レジストリ側の登録済みリスト」
//       (4featureのconfigureXxxを空depsで呼ぶ動的実測 + app.js自身のregisterActions呼び出しの
//       静的抽出)の**和集合が221件(上記[2]と同じ増減履歴)のゴールデンリストと完全一致・
//       重複ゼロ**であることを検証する(総数と名前一覧の保存則。段階5以降でさらに分岐を
//       移行する際もこの形式を維持する)。
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const ACTIONS_MODULE_PATH = path.join(ROOT, "src", "ui", "actions.js");
const FEATURE_MODULE_PATHS = [
  path.join(ROOT, "src", "features", "wish.js"),
  path.join(ROOT, "src", "features", "journal.js"),
  // v181: timeline-modeのハンドラ実体がこのファイルにあるため追加(configureTimeline({})を
  // 空depsで呼んでも、registerActions呼び出し自体はdepsを参照しないため安全に実測できる)。
  path.join(ROOT, "src", "features", "timeline.js"),
  path.join(ROOT, "src", "features", "today.js"),
  path.join(ROOT, "src", "features", "track-ui.js")
];

// wish.jsはモジュール読み込み時にdocument.addEventListener(pointerdown/move/up/cancel、月間ボード
// D&D)をトップレベルで呼ぶ(tests/wish-core.test.jsと同じ既知の事情)。Node環境にはdocumentが
// 無いため、4featureをimportする前に最小限のスタブを用意する(ドラッグ確定の検証はしない=
// ブラウザE2E側の責務のまま。actions.js自身はstateもDOMも参照しないため[1][2]には影響しない)。
global.document = { addEventListener: () => {}, querySelector: () => null };

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// §6-1: click dispatcherから確定させたゴールデンリスト(削除済み機能のactionを除く221件)。
// 増減・リネームがあれば、それが意図した変更(action追加/削除/移行)かどうかを必ず確認すること。
// v294: 「書く瞑想」パネル(充放電ログ改善R1a)のkm-chip-add/km-chip-remove/km-saveを
// 意図的に追加(218→221)。
// v235: set-sleepは主観睡眠の入力経路廃止に伴う意図的削除。
// v270: departures-open-tomorrowはDEPARTURES削除に伴う意図的削除。
// v288: wbs-search-inputはinputイベント用のno-op登録(app.js:571)だが、data-actionの保存則を
// 同じgolden listで検証するため、click専用前提のこの配列へ意図的に含める。
// v292: now-mode-open/now-mode-close/now-conveyor-skip/continue-focus/finish-block/ideal-retryは
// 低優先度棚卸し孤児掃除で削除(224→218)。now-conveyor-completeはsrc/features/today-tower.js
// (TOWER UI)から現役で発行されているため残置。complete-pomodoroもv129/v132の合成data-action
// 起点+completePomodoro()の唯一の呼び出し元として残置(K裁定2026-08-29)。
// v295: 身体スキャン2軸化でbody-scan-recovery/body-scan-recordを意図的に追加(221→223)。
// v299: グループA削除でtoday-replan/ai-morning-plan/zerosec-theme-add/
// zerosec-theme-skipを意図的に削除(223→219)。
// v300: 永久に空だった却下理由UIのaction 2件を意図的に削除(223→221)。
// v311: CABIN TIMERのLINK FLIGHT選択・一時停止・再開4actionを意図的に追加。
const GOLDEN_CLICK_ACTIONS = [
  "nav", "open-iron-log", "instruments-open-iron-log", "save-tower-journal",
  "focus-toggle-gate", "focus-toggle-journal", "focus-mode",
  "early-bird-check", "tower-gate-edit-toggle", "tower-bodymind-toggle", "tower-gate-add", "tower-gate-delete", "tower-gate-move", "tower-gate-streak-toggle",
  "date-prev", "date-next", "today",
  "set-morning", "toggle-meds", "set-capacity", "set-evening-mood",
  "add-gym-entry", "delete-gym-entry",
  "store-visit-add", "store-visit-edit", "store-visit-delete", "store-visit-year",
  "add-project", "delete-project", "add-task", "toggle-task", "toggle-criteria-request",
  "task-today", "delete-task",
  "toggle-project-collapse", "toggle-task-collapse",
  "wbs-search-input", "wbs-search-jump",
  "suspend-project", "resume-project", "suspend-task", "resume-task",
  "toggle-show-suspended", "toggle-wbs-hide-done", "toggle-wbs-hide-done-projects",
  "toggle-wbs-active-only", "toggle-wbs-compact", "toggle-tasks-show-future",
  "toggle-wbs-edit", "wbs-collapse-all",
  "add-block", "toggle-block", "toggle-task-complete", "now-start", "now-end",
  "bulk-approve-planned", "now-conveyor-complete",
  "generate-report", "download-report", "download-data", "save-github", "load-github",
  "gate-continue", "reset-demo",
  "toggle-mit",
  // v295: 身体スキャン2軸化(K裁定2026-08-29)でbody-scan-recovery/body-scan-recordを意図的に追加。
  "body-scan-fatigue", "body-scan-recovery", "body-scan-part", "body-scan-record", "body-scan-discard",
  "start-pomodoro", "open-pomodoro-link", "pomodoro-link-select", "pause-pomodoro", "resume-pomodoro",
  "stop-pomodoro", "interrupt-reason", "interrupt-reason-cancel",
  "complete-pomodoro", "declare-confirm", "declare-skip", "report-outcome", "report-skip",
  "incomplete-reason-chip", "incomplete-reason-skip",
  // v296: 書く瞑想dailyCloseゲート(充放電ログ改善R1b、K裁定2026-08-29=案A)。
  "km-gate-do-it", "km-gate-skip",
  "guided-access-dismiss",
  "go-break", "end-break",
  "edit-project", "edit-task", "edit-block",
  "twy-kind-numeric", "twy-kind-milestone", "twy-kind-none", "twy-ms-add", "twy-ms-del",
  "twy-open-editor", "twy-close-editor", "twy-save-measurement", "twy-ms-toggle-done", "twy-ms-edit-date",
  "twy-ms-toggle-progress", "twy-ms-save-progress", "twy-ms-clear-progress",
  "twy-toast-inc", "twy-toast-same", "twy-toast-other", "twy-toast-other-confirm", "twy-toast-later",
  "twy-carry-cycle", "twy-carry-confirm",
  // v266: COUNTDOWNスコア信号(1)
  "twy-score-toggle",
  // v263/v264: 週次コミット確定シート(12)
  "twy-open-commit", "twy-commit-toggle-group", "twy-commit-toggle-block", "twy-commit-expand", "twy-commit-week",
  "twy-excuse", "twy-excuse-confirm", "twy-excuse-cancel", "twy-unexcuse",
  "twy-add-item", "twy-add-item-confirm", "twy-add-item-cancel",
  "modal-close", "modal-save", "modal-delete",
  "lev-judge",
  "vision-section", "vision-board-tab", "vision-board-load",
  "vision-board-load-images", "vision-board-retry-images",
  "open-md-in-github", "reload-md", "ai-report-type", "ai-report-open-unread", "ai-report-refresh",
  "experiment-add", "edit-experiment", "experiment-keep", "experiment-drop",
  "experiment-copy-conclusion",
  "push-report", "add-task-to-project", "add-subtask",
  "toggle-plan-owner", "move-plan-step", "add-plan-step-below",  // v195: 実行計画UI
  "plan-step-request", "plan-step-approve", "plan-step-discard",  // v196: 実行計画の叩き台をAIに依頼
  "ai-step-confirm-send", "ai-step-confirm-later",  // v198: 完了トリガー→引き継ぎシート
  "timeline-new-block", "timeline-mode", "complete-block-with-actual",
  "drift-postpone", "time-comb-fill",  // v186: F2 DRIFT(明日へ送る)+TIME COMB(隙間補完)の意図的追加

  "add-category", "delete-category",
  "toggle-vision-direct-category", "vision-open-direct-settings",  // v189: F7 直結カテゴリ選択+誘導(設定ビュー)
  "tl-zoom", "tl-energy-mode",
  "toggle-journal-segment", "toggle-settings-sync",
  "toggle-sidebar",
  "add-wish", "open-wish", "add-wish-subtask", "toggle-wish-subtask",
  "wish-subtask-to-tasks", "wish-realize", "wish-unrealize", "delete-wish",
  "zt-add-toggle", "zt-add-cancel", "zt-add-submit", "zt-tab",
  "zt-fav-toggle", "zt-importance-toggle", "zt-theme-delete",
  "zt-suggestion-adopt", "zt-suggestion-dismiss",
  "zt-group-add", "zt-group-rename", "zt-group-delete", "zt-group-toggle",
  "zt-write", "zt-save", "zt-discard", "zt-entry-open", "zt-edit-close", "zt-edit-save",
  "zero-tab",
  "question-add", "question-edit", "question-to-theme", "question-settle", "question-reopen",
  "question-bridge", "question-bridge-submit", "question-delete",
  "entry-to-question",
  "report-copy-ai", "report-share-ai",
  "ai-schedule",
  "draft-confirm", "draft-discard", "draft-remove", "draft-undo",
  "weekly-suggest-add",
  "open-backup-list", "restore-backup",
  "run-archive",
  "open-search", "search-jump",
  "carry-over", "migration-ritual-choice",
  "energy-open-category",
  "timeline-clear-cat",
  "km-chip-add", "km-chip-remove", "km-save",  // v294: 「書く瞑想」パネルの意図的追加
  "km-chip-candidate"  // v296: 「書く瞑想」候補チップ(充放電ログ改善R1b)の意図的追加
];

// v173: 段階5-2で抽出済みfeatureの分岐をregisterActions経由のレジストリへ移行した
// (GOLDEN_CLICK_ACTIONSの部分集合)。
// ハンドラ本体はif連鎖からロジック無改変で移しただけで、追加・削除・リネームはしていない。
// body-scan-*(routineとは別ドメイン・未抽出)はif連鎖に残した
// (下のEXPECTED_REMAINING_IF_CHAINに含まれる)。
const MIGRATED_TO_REGISTRY_ACTIONS = [
  // src/features/wish.js(configureWish、Tier1のみ)
  "add-wish", "open-wish", "add-wish-subtask", "toggle-wish-subtask",
  "wish-subtask-to-tasks", "wish-realize", "wish-unrealize", "delete-wish",
  // src/features/journal.js(configureJournal、コンディションOS+運動記録+お店ログ)
  // v235: set-sleepは主観睡眠の入力経路廃止に伴う意図的削除。
  "set-morning", "toggle-meds", "set-capacity", "set-evening-mood",
  "add-gym-entry", "delete-gym-entry",
  "store-visit-add", "store-visit-edit", "store-visit-delete", "store-visit-year",
  // v294: 「書く瞑想」パネル(充放電ログ改善R1a)のチップ追加/削除/保存。
  "km-chip-add", "km-chip-remove", "km-save",
  // v296: 「書く瞑想」候補チップ(充放電ログ改善R1b)。
  "km-chip-candidate",
  // v181: src/features/timeline.js(configureTimeline)。ハンドラ実体(setTimelineMode)が
  // このファイルに既に存在するため、timeline系の中で唯一この動的実測方式で検証する。
  "timeline-mode",
  // v186: F2でtimeline.jsのregisterActionsへ意図的に追加(DRIFT送り+TIME COMB隙間補完)
  "drift-postpone", "time-comb-fill",
  // v241: src/features/today.jsの端末ローカル表示切替
  "focus-toggle-gate", "focus-toggle-journal", "focus-mode",
  // v262: src/features/track-ui.jsの12WY進捗トースト
  "twy-toast-inc", "twy-toast-same", "twy-toast-other", "twy-toast-other-confirm", "twy-toast-later"
];

// v174: 段階5-3で以下20件(settings 11 + sync 8 + core/nav 1)を、app.js自身が呼ぶ
// registerActions({...})(app.js内、src/features/への抽出はまだ行っていない)へ移行した。
// ハンドラ本体はif連鎖からロジック無改変で移しただけで、追加・削除・リネームはしていない。
//
// 同じくapp.js自身が呼ぶregisterActions({...})へ移行した(独立レビュー対応: journal系71件
// (見積り)の一括移行は実行コード差分が200行を超えるため、設計書§7どおり機械的に分割可能な
// v177: 段階5-6bで以下29件(journal系残ドメインの後半: 問い10+その他19)を、同じく
// app.js自身が呼ぶ別のregisterActions({...})呼び出しへ移行した。ハンドラ本体はいずれも
// if連鎖からロジック無改変で移しただけで、追加・削除・リネームはしていない。
// 完了した。
// v180: 段階5-8(前半)で以下27件(timeline系のBlock作成2+Block/Now9+ポモドーロ16)を、
// 同じくapp.js自身が呼ぶregisterActions({...})へ移行した。
// v181: 段階5-8(後半)で以下12件(timeline系の日付ナビ3+タイムライン設定/カテゴリフィルタ9)を、
// 同じくapp.js自身が呼ぶregisterActions({...})へ移行した(timeline-modeのみsrc/features/
// timeline.js側のMIGRATED_TO_REGISTRY_ACTIONSで検証する)。これでtimeline系40分岐すべての
// 移行が完了した。所属ドメインに確信が持てなかったaction(toggle-mit・home-tab・
// open-md-in-github・reload-md)、toggle-criteria-request/home-jump(WBS/ホーム寄り
  // で確信が持てない)、body-scan-*(ポモドーロ完了時トリガー)、
// は従来どおり移行せず、if連鎖に残した(下のEXPECTED_REMAINING_IF_CHAINに含まれる)。
const APP_JS_REGISTERED_ACTIONS = [
  "nav", "open-iron-log", "instruments-open-iron-log", "save-tower-journal",
  "early-bird-check", "tower-gate-edit-toggle", "tower-bodymind-toggle", "tower-gate-add", "tower-gate-delete", "tower-gate-move", "tower-gate-streak-toggle",
  "toggle-show-suspended", "toggle-wbs-hide-done", "toggle-wbs-hide-done-projects",
  "toggle-wbs-active-only", "toggle-wbs-compact", "toggle-tasks-show-future",
  "toggle-wbs-edit", "wbs-collapse-all",
  "add-category", "delete-category",
  "toggle-vision-direct-category", "vision-open-direct-settings",  // v189: F7 直結カテゴリ選択+誘導(設定ビュー)
  "toggle-sidebar", "toggle-settings-sync",
  "save-github", "load-github", "gate-continue", "reset-demo", "push-report",
  "open-backup-list", "restore-backup", "run-archive",
  // --- v176: 0秒思考(20。テーマ提案選定2actionはv299で削除) ---
  "zt-add-toggle", "zt-add-cancel", "zt-add-submit", "zt-tab",
  "zt-fav-toggle", "zt-importance-toggle", "zt-theme-delete",
  "zt-suggestion-adopt", "zt-suggestion-dismiss",
  "zt-group-add", "zt-group-rename", "zt-group-delete", "zt-group-toggle",
  "zt-write", "zt-save", "zt-discard", "zt-entry-open", "zt-edit-close", "zt-edit-save",
  "zero-tab",
  "weekly-suggest-add",
  // --- v177: 問い(9。open-questionsはv230のHome撤去で到達不能化、v291孤児掃除で削除
  //     =低優先度棚卸しK裁定2026-08-29) ---
  "question-add", "question-edit", "question-to-theme", "question-settle", "question-reopen",
  "question-bridge", "question-bridge-submit", "question-delete",
  "entry-to-question",
  // --- v177: その他(日報/AIレポート/AI連携/朝夜detailsトグル。open-future-letterは同じ理由で
  //     v291孤児掃除で削除) ---
  "ai-report-type", "ai-report-open-unread", "ai-report-refresh",
  "report-copy-ai", "report-share-ai",
  "generate-report", "download-report", "download-data",
  "carry-over", "migration-ritual-choice",
  // ideal-retryはv230のHome撤去で描画元を失い到達不能化、v292孤児掃除で
  // resolveIdealRetry/idealActiveEntryごと削除(低優先度棚卸しK裁定2026-08-29)。
  "toggle-journal-segment",
  // --- v178: WBS/Project/Task CRUD(17。delete-blockの重複登録はv291孤児掃除で削除) ---
  "add-project", "delete-project", "add-task", "toggle-task", "delete-task",
  "toggle-project-collapse", "toggle-task-collapse",
  "wbs-search-input", "wbs-search-jump",
  "suspend-project", "resume-project", "suspend-task", "resume-task",
  "add-task-to-project", "add-subtask",
  "toggle-plan-owner", "move-plan-step", "add-plan-step-below",  // v195: 実行計画UI
  "plan-step-request", "plan-step-approve", "plan-step-discard",  // v196: 実行計画の叩き台をAIに依頼
  "ai-step-confirm-send", "ai-step-confirm-later",  // v198: 完了トリガー→引き継ぎシート
  "add-block",
  "edit-project", "edit-task", "edit-block",
  // --- v258: 12WYトラックフォームのDOM局所操作(5) ---
  "twy-kind-numeric", "twy-kind-milestone", "twy-kind-none", "twy-ms-add", "twy-ms-del",
  // --- v261/v282: WBSトラック行インライン編集(8) ---
  "twy-open-editor", "twy-close-editor", "twy-save-measurement", "twy-ms-toggle-done", "twy-ms-edit-date",
  "twy-ms-toggle-progress", "twy-ms-save-progress", "twy-ms-clear-progress",
  // --- v259: 12WY新サイクル移行UI(2) ---
  "twy-carry-cycle", "twy-carry-confirm",
  // --- v266: COUNTDOWNスコア信号(1) ---
  "twy-score-toggle",
  // --- v263/v264: 週次コミット確定シート(12) ---
  "twy-open-commit", "twy-commit-toggle-group", "twy-commit-toggle-block", "twy-commit-expand", "twy-commit-week",
  "twy-excuse", "twy-excuse-confirm", "twy-excuse-cancel", "twy-unexcuse",
  "twy-add-item", "twy-add-item-confirm", "twy-add-item-cancel",
  // --- v178: モーダル起動系(3、modal-saveはreturn意味論のためif連鎖に残置) ---
  "modal-close", "modal-delete", "lev-judge",
  // --- v179: ビジョンボード(5。open-vision-boardはv291孤児掃除で削除) ---
  "vision-section", "vision-board-tab", "vision-board-load",
  "vision-board-load-images", "vision-board-retry-images",
  // --- v179: 実験ログ(5) ---
  "experiment-add", "edit-experiment", "experiment-keep", "experiment-drop",
  "experiment-copy-conclusion",
  // --- v179: スケジュール下書き(5。ai-morning-planはv299、却下理由UI 2件はv300で削除) ---
  "ai-schedule", "draft-confirm", "draft-discard", "draft-remove",
  "draft-undo",
  // --- v179: 検索(2) ---
  "open-search", "search-jump",
  // --- v180: Block作成(WBSからの「今日へ追加」) ---
  "task-today",
  // --- v180: Block/Now(6。now-mode-open/now-mode-close/now-conveyor-skipはv87でUI導線を
  //     撤去して以来到達不能化、v292孤児掃除で削除。now-conveyor-completeはsrc/features/
  //     today-tower.js(TOWER UI)から現役で発行されるため残置=低優先度棚卸しK裁定2026-08-29) ---
  "toggle-block", "toggle-task-complete", "now-start", "now-end", "bulk-approve-planned",
  "now-conveyor-complete",
  // --- v180: ポモドーロ(14。continue-focus/finish-blockはend-break単独UIへの統一で孤立、
  //     v292孤児掃除でcontinueFocusPomodoro/finishBlockFromBreakごと削除。complete-pomodoroは
  //     data-action経由の到達導線が無いが、v129身体スキャンモーダルの唯一の呼び出し元
  //     completePomodoro()をテスト(v129/v132)が合成data-action注入で使い続けているため残置
  //     =低優先度棚卸しK裁定2026-08-29) ---
  "start-pomodoro", "open-pomodoro-link", "pomodoro-link-select", "pause-pomodoro", "resume-pomodoro",
  "stop-pomodoro", "interrupt-reason", "interrupt-reason-cancel",
  "complete-pomodoro", "declare-confirm", "declare-skip", "report-outcome", "report-skip",
  "incomplete-reason-chip", "incomplete-reason-skip",
  // v296: 書く瞑想dailyCloseゲート(充放電ログ改善R1b、K裁定2026-08-29=案A)。
  "km-gate-do-it", "km-gate-skip",
  "guided-access-dismiss",
  "go-break", "end-break",
  // --- v181: 日付ナビ(3) ---
  "date-prev", "date-next", "today",
  // --- v181: タイムライン設定/カテゴリフィルタ(9) ---
  "timeline-new-block", "complete-block-with-actual", "tl-zoom", "tl-energy-mode",
  "energy-open-category", "timeline-clear-cat"
];

const EXPECTED_REMAINING_IF_CHAIN = GOLDEN_CLICK_ACTIONS.filter(
  (a) => !MIGRATED_TO_REGISTRY_ACTIONS.includes(a) && !APP_JS_REGISTERED_ACTIONS.includes(a)
);

function extractClickActions() {
  const startMarker = 'document.addEventListener("click", (event) => {';
  const endMarker = 'document.addEventListener("toggle", (event) => {';
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error("click dispatcherの境界マーカーが見つからない(app.js構造が変わった可能性)");
  }
  const body = appSource.slice(start, end);
  return [...body.matchAll(/action === "([^"]+)"/g)].map((m) => m[1]);
}

// v174: app.js自身が呼ぶregisterActions({...})(settings/sync/core、5-3で移行した20件)を
// 静的抽出する。app.jsはDOM初期化を伴うためNode環境でそのままimportできず、4featureの
// configureXxxのような「空depsで呼んで実測する」方式が使えない(§3-bコメント参照)。
// registerActions({...})の呼び出しは行頭が`"key":`の形で並ぶオブジェクトリテラルのため、
// 呼び出し開始位置から次の`let toastTimer = null;`(app.js固有の直後の行)までを切り出し、
// 行頭のクォート付きキーだけを拾う(showToastの引数文字列等、コロンを伴わない`"..."`は
// 拾わない)。
function extractAppRegisteredActions() {
  const startMarker = "registerActions({";
  const endMarker = "let toastTimer = null;";
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error("app.js内のregisterActions呼び出しの境界マーカーが見つからない(構造が変わった可能性)");
  }
  const body = appSource.slice(start, end);
  return [...body.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]);
}

// v178: 段階5-8。submitModal/deleteFromModalのstate.modal.typeによるif-else連鎖を
// registerModalHandlerへ全件移行した。§6-1で持ち越されていた「modalHandlersのgolden
// list exhaustiveness検証」をここで行う(click側と同じ保存則方式: if連鎖残存type+レジストリ
// 登録type=全typeの完全一致)。
const GOLDEN_MODAL_TYPES = [
  "project", "task", "block", "actualEntry", "question", "experiment", "storeVisit"
];
// 登録対象typeはすべてregisterModalHandlerへ移行済みのため、if連鎖側の残存は0件になる
// (将来型が増えてif連鎖に残った場合の退行を検知できるよう、ハードコードせずGOLDENからの
// filterで期待値を出す)。
const MIGRATED_TO_MODAL_REGISTRY = [
  "project", "task", "block", "actualEntry", "question", "experiment", "storeVisit"
];
const EXPECTED_REMAINING_MODAL_IF_CHAIN = GOLDEN_MODAL_TYPES.filter(
  (t) => !MIGRATED_TO_MODAL_REGISTRY.includes(t)
);

// submitModal/deleteFromModal本体(次のfunction buildProjectModalの手前まで)から
// `state.modal.type === "..."`の残存if-else分岐を静的抽出する。
function extractModalIfChainTypes() {
  const startMarker = "function submitModal() {";
  const endMarker = "function buildProjectModal(project) {";
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error("submitModal/deleteFromModalの境界マーカーが見つからない(app.js構造が変わった可能性)");
  }
  const body = appSource.slice(start, end);
  return [...body.matchAll(/state\.modal\.type === "([^"]+)"/g)].map((m) => m[1]);
}

// registerModalHandler("type", {...})呼び出しからtype文字列を静的抽出する。
function extractModalHandlerTypes() {
  return [...appSource.matchAll(/registerModalHandler\("([^"]+)"/g)].map((m) => m[1]);
}

(async () => {
  const actionsMod = await import(pathToFileURL(ACTIONS_MODULE_PATH).href);

  console.log("[1] registerActions/dispatchAction: 単体挙動");
  let calledWith = null;
  actionsMod.registerActions({
    "__test-action-a": (ctx) => { calledWith = ctx; }
  });
  const ctx = { event: { type: "click" }, target: { dataset: { id: "x" } }, id: "x" };
  const handled = actionsMod.dispatchAction("__test-action-a", ctx);
  check("登録済みactionはtrueを返しhandlerを呼ぶ", handled === true && calledWith === ctx);
  check("dispatchAction経由でctx(event/target/id)がそのままhandlerへ渡る",
    calledWith.event === ctx.event && calledWith.target === ctx.target && calledWith.id === "x");

  const unhandled = actionsMod.dispatchAction("__test-action-not-registered", ctx);
  check("未登録actionはfalseを返す(呼び出し側の既存if連鎖へフォールバックさせるため)", unhandled === false);

  let duplicateThrew = false;
  try {
    actionsMod.registerActions({ "__test-action-a": () => {} });
  } catch (e) {
    duplicateThrew = true;
  }
  check("同名actionの再登録は例外を投げる(重複登録ガード)", duplicateThrew === true);

  check("__debugActionNames()に登録済みaction名が現れる",
    actionsMod.__debugActionNames().includes("__test-action-a"));

  console.log("[2] registerModalHandler/dispatchModalSave/dispatchModalDelete: 単体挙動");
  let savedWith = null;
  let deletedWith = null;
  actionsMod.registerModalHandler("__test-type", {
    save: (id, fields) => { savedWith = { id, fields }; },
    delete: (id) => { deletedWith = id; }
  });
  const saveHandled = actionsMod.dispatchModalSave("__test-type", "id-1", { a: 1 });
  check("登録済みtypeのsaveはtrueを返しhandlerを呼ぶ",
    saveHandled === true && savedWith.id === "id-1" && savedWith.fields.a === 1);
  const deleteHandled = actionsMod.dispatchModalDelete("__test-type", "id-1");
  check("登録済みtypeのdeleteはtrueを返しhandlerを呼ぶ",
    deleteHandled === true && deletedWith === "id-1");

  const saveUnhandled = actionsMod.dispatchModalSave("__test-type-not-registered", "id-2", {});
  const deleteUnhandled = actionsMod.dispatchModalDelete("__test-type-not-registered", "id-2");
  check("未登録typeのsave/deleteは両方falseを返す", saveUnhandled === false && deleteUnhandled === false);

  let duplicateModalThrew = false;
  try {
    actionsMod.registerModalHandler("__test-type", { save: () => {} });
  } catch (e) {
    duplicateModalThrew = true;
  }
  check("同名typeの再登録は例外を投げる(重複登録ガード)", duplicateModalThrew === true);

  check("__debugModalTypes()に登録済みtypeが現れる",
    actionsMod.__debugModalTypes().includes("__test-type"));

  console.log("[3-a] click dispatcherのif連鎖側に残る分岐名を静的抽出し、移行済みactionを除いた期待値と一致するか");
  const extracted = extractClickActions();
  check(`if連鎖側の残存件数は期待どおり${EXPECTED_REMAINING_IF_CHAIN.length}件`,
    extracted.length === EXPECTED_REMAINING_IF_CHAIN.length,
    `実際: ${extracted.length}件`);
  check("if連鎖側の残存action名一覧はEXPECTED_REMAINING_IF_CHAINと完全一致(順序含む)",
    JSON.stringify(extracted) === JSON.stringify(EXPECTED_REMAINING_IF_CHAIN),
    `差分: 追加=${JSON.stringify(extracted.filter((a) => !EXPECTED_REMAINING_IF_CHAIN.includes(a)))} `
    + `消失=${JSON.stringify(EXPECTED_REMAINING_IF_CHAIN.filter((a) => !extracted.includes(a)))}`);
  check("if連鎖側の残存action名に重複がない",
    new Set(extracted).size === extracted.length);

  console.log("[3-b] 5feature(wish/journal/timeline/today/track-ui)のconfigureXxxを"
    + "空depsで呼び、registerActionsが実際に登録するaction名がMIGRATED_TO_REGISTRY_ACTIONSと"
    + "一致するか");
  // configureXxx本体はdestructuring代入+registerActions呼び出しのみで、渡されたdepsの中身は
  // ハンドラのクロージャ内で遅延参照されるだけ(登録時には呼ばれない)ため、空depsで安全に呼べる
  // (src/features/*.js側のconfigureXxx実装を参照。design doc §6-1の重複登録ガード確認も兼ねる)。
  const featureMods = await Promise.all(
    FEATURE_MODULE_PATHS.map((p) => import(pathToFileURL(p).href))
  );
  const [wishMod, journalMod, timelineMod, todayMod, trackUiMod] = featureMods;
  wishMod.configureWish({});
  journalMod.configureJournal({});
  timelineMod.configureTimeline({});
  todayMod.configureToday({});
  trackUiMod.configureTrackUi({});
  const registered = actionsMod.__debugActionNames().filter((name) => !name.startsWith("__test"));
  check(`レジストリ側の登録件数は期待どおり${MIGRATED_TO_REGISTRY_ACTIONS.length}件`,
    registered.length === MIGRATED_TO_REGISTRY_ACTIONS.length,
    `実際: ${registered.length}件 (${JSON.stringify(registered)})`);
  check("レジストリ側の登録action名一覧はMIGRATED_TO_REGISTRY_ACTIONSと集合として完全一致",
    new Set(registered).size === registered.length
    && registered.length === MIGRATED_TO_REGISTRY_ACTIONS.length
    && MIGRATED_TO_REGISTRY_ACTIONS.every((a) => registered.includes(a)),
    `差分: 追加=${JSON.stringify(registered.filter((a) => !MIGRATED_TO_REGISTRY_ACTIONS.includes(a)))} `
    + `消失=${JSON.stringify(MIGRATED_TO_REGISTRY_ACTIONS.filter((a) => !registered.includes(a)))}`);

  console.log("[3-b'] app.js自身が呼ぶregisterActions({...})(settings/sync/core、段階5-3)を静的抽出し、"
    + "APP_JS_REGISTERED_ACTIONSと一致するか(app.jsはDOM初期化を伴うためNode importで実測できず、"
    + "extractClickActionsと同じ静的抽出方式を用いる)");
  const appRegistered = extractAppRegisteredActions();
  check(`app.js直接登録の件数は期待どおり${APP_JS_REGISTERED_ACTIONS.length}件`,
    appRegistered.length === APP_JS_REGISTERED_ACTIONS.length,
    `実際: ${appRegistered.length}件 (${JSON.stringify(appRegistered)})`);
  check("app.js直接登録のaction名一覧はAPP_JS_REGISTERED_ACTIONSと集合として完全一致",
    new Set(appRegistered).size === appRegistered.length
    && appRegistered.length === APP_JS_REGISTERED_ACTIONS.length
    && APP_JS_REGISTERED_ACTIONS.every((a) => appRegistered.includes(a)),
    `差分: 追加=${JSON.stringify(appRegistered.filter((a) => !APP_JS_REGISTERED_ACTIONS.includes(a)))} `
    + `消失=${JSON.stringify(APP_JS_REGISTERED_ACTIONS.filter((a) => !appRegistered.includes(a)))}`);

  console.log("[3-c] 「if連鎖側の残存分岐」+「レジストリ側の登録済み(feature動的 + app.js直接静的)」の"
    + "和集合がゴールデンリストと完全一致・重複ゼロであること(保存則)");
  const union = [...extracted, ...registered, ...appRegistered];
  check("if連鎖側・feature側・app.js直接側の間で重複が無い",
    new Set(union).size === extracted.length + registered.length + appRegistered.length,
    `重複: ${JSON.stringify(union.filter((a, i) => union.indexOf(a) !== i))}`);
  check(`和集合の件数はゴールデンリストと同じ${GOLDEN_CLICK_ACTIONS.length}件`,
    union.length === GOLDEN_CLICK_ACTIONS.length,
    `実際: ${union.length}件`);
  check("和集合はゴールデンリストと集合として完全一致",
    new Set(union).size === GOLDEN_CLICK_ACTIONS.length
    && GOLDEN_CLICK_ACTIONS.every((a) => union.includes(a)),
    `差分: 追加=${JSON.stringify(union.filter((a) => !GOLDEN_CLICK_ACTIONS.includes(a)))} `
    + `消失=${JSON.stringify(GOLDEN_CLICK_ACTIONS.filter((a) => !union.includes(a)))}`);

  console.log("[4] 段階5-1のフック配線がapp.js内に存在すること(dispatch呼び出し箇所の接続契約)");
  check("click dispatcherの先頭にdispatchAction(action, { event, target, id })呼び出しがある",
    /if \(dispatchAction\(action, \{ event, target, id \}\)\) return;/.test(appSource));
  check("submitModal内にdispatchModalSave呼び出しがある(v178: 全type移行によりif-else連鎖を"
    + "撤去したため、もはや`if (...) return;`でラップされない単独呼び出しになった)",
    /dispatchModalSave\(state\.modal\.type, state\.modal\.id, fields\);/.test(appSource));
  check("deleteFromModalの先頭にdispatchModalDelete呼び出しがある",
    /if \(dispatchModalDelete\(state\.modal\.type, state\.modal\.id\)\) \{/.test(appSource));

  console.log("[5] submitModal/deleteFromModalのmodal typeレジストリ移行(段階5-8): "
    + "golden list exhaustiveness検証(if連鎖残存type+レジストリ登録type=全typeの完全一致)");
  const modalIfChainTypes = extractModalIfChainTypes();
  check(`if連鎖側に残るtypeは期待どおり${EXPECTED_REMAINING_MODAL_IF_CHAIN.length}件`,
    modalIfChainTypes.length === EXPECTED_REMAINING_MODAL_IF_CHAIN.length,
    `実際: ${modalIfChainTypes.length}件 (${JSON.stringify(modalIfChainTypes)})`);

  const modalHandlerTypes = extractModalHandlerTypes();
  check(`registerModalHandler登録typeの件数は期待どおり${MIGRATED_TO_MODAL_REGISTRY.length}件`,
    modalHandlerTypes.length === MIGRATED_TO_MODAL_REGISTRY.length,
    `実際: ${modalHandlerTypes.length}件 (${JSON.stringify(modalHandlerTypes)})`);
  check("registerModalHandler登録type一覧に重複がない",
    new Set(modalHandlerTypes).size === modalHandlerTypes.length);

  const modalUnion = [...modalIfChainTypes, ...modalHandlerTypes];
  check("if連鎖側・registerModalHandler側の間で重複が無い",
    new Set(modalUnion).size === modalIfChainTypes.length + modalHandlerTypes.length,
    `重複: ${JSON.stringify(modalUnion.filter((t, i) => modalUnion.indexOf(t) !== i))}`);
  check(`和集合の件数はgolden listと同じ${GOLDEN_MODAL_TYPES.length}件`,
    modalUnion.length === GOLDEN_MODAL_TYPES.length,
    `実際: ${modalUnion.length}件`);
  check("和集合はgolden listと集合として完全一致(typeのexhaustiveness)",
    new Set(modalUnion).size === GOLDEN_MODAL_TYPES.length
    && GOLDEN_MODAL_TYPES.every((t) => modalUnion.includes(t)),
    `差分: 追加=${JSON.stringify(modalUnion.filter((t) => !GOLDEN_MODAL_TYPES.includes(t)))} `
    + `消失=${JSON.stringify(GOLDEN_MODAL_TYPES.filter((t) => !modalUnion.includes(t)))}`);

  console.log(failures === 0 ? "\n✅ action-registry-core ALL PASS" : `\n❌ action-registry-core: ${failures} 件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
