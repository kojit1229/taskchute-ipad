const STORAGE_KEY = "taskchute-journal-pwa-state-v1";

// v23: 繰り返し Block を実体化する期間(今日を基準)
const RECURRENCE_KEEP_PAST_DAYS = 7;    // 過去はこの日数だけ実体を保持
const RECURRENCE_FUTURE_DAYS = 31;      // 未来はこの日数先まで実体化

// v33: タブ順 — WBS はタスクシュートの直下に配置
//   ホーム / ジャーナル / ビジョン / タスクシュート / WBS / タイムライン /
//   ルーティン / ポモドーロ / やりたい / やらない / 日報 / 設定
const navItems = [
  { id: "home", label: "ホーム", mark: "H" },
  { id: "journal", label: "ジャーナル", mark: "J" },
  { id: "zero", label: "0秒思考", mark: "○" },
  { id: "vision", label: "ビジョン", mark: "V" },
  { id: "tasks", label: "タスクシュート", mark: "T" },
  { id: "wbs", label: "WBS", mark: "W" },
  { id: "timeline", label: "タイムライン", mark: "L" },
  { id: "routine", label: "ルーティン", mark: "↻" },
  { id: "pomodoro", label: "ポモドーロ", mark: "P" },
  { id: "wish", label: "やりたい", mark: "✦" },
  { id: "avoid", label: "やらない", mark: "✕" },
  { id: "reports", label: "日報", mark: "R" },
  { id: "weekly", label: "週次", mark: "◷" },
  { id: "stats", label: "計器盤", mark: "◔" },  // v53
  { id: "settings", label: "設定", mark: "S" }
];

const mobileNav = [
  { id: "home", label: "ホーム" },
  { id: "wbs", label: "WBS" },
  { id: "tasks", label: "実行" },
  { id: "timeline", label: "時間" },
  { id: "more", label: "その他" }
];

// v51: AIプロンプトの既定値(設定画面で編集可能。空文字は「意図的に空」)。
//      出力フォーマット(JSON/見出し契約)はアプリが解析するためここには含めず、コード側で常に付与する。
//      ※ state 初期化(normalizeState)より前に宣言が必要。
const AI_DEFAULT_PROMPTS = {
  // 共通コンテキスト: すべてのAI呼び出しの冒頭に付く「私について」
  context: [
    "私について:",
    "- タスクシュート(1日の時間実行)× 12 Week Year(12週サイクル)× 0秒思考 × ジャーナルを1つにした自作アプリで自己管理している",
    "- 完了率より「着手率」を重視する。小さくても手を付けたことを評価する",
    "- エネルギー会計(充電/放電)で消耗と回復のバランスを見る。時間の量より質",
    "- 反省は必ず行動につなげる。気づきで終わる指摘は不要で、翌日実行できる形まで落とすこと",
    "- 詰め込みは私の失敗パターン。余白と休憩を残す計画を良しとする",
    "- 長期の方向は問い・12週目標で自分で決める。AIには判断ではなく、質の高い判断材料を求める"
  ].join("\n"),
  // カスタム指示: 文体・トーンなどの追加指示(自由に書き換える欄)
  custom: [
    "口調はフラットで簡潔に。忖度・一般論・抽象的な励ましは不要。",
    "事実(数字)を根拠に、明日の行動が変わる指摘だけをする。"
  ].join("\n"),
  // ① WBSタスク分解の指示部
  decompose: [
    "あなたはプロジェクトのWBS(作業分解)を手伝うアシスタントです。",
    "次のプロジェクトを、着手しやすいタスクに分解してください。",
    "",
    "条件:",
    "- タスクは3〜8個。各タスクは「最初の一歩に30〜60分で着手できる」粒度にする",
    "- 必要なら各タスクに最大3個のサブタスクを付けてよい",
    "- 曖昧な動詞(検討する・考える)を避け、完了が判定できる表現にする",
    "- 実行順に意味がある場合は、その順に並べる"
  ].join("\n"),
  // ② スケジュール下書きの指示部
  schedule: [
    "あなたはタスクシュート(1日のタイムボックス計画)を手伝うアシスタントです。",
    "スケジュールの空き時間に、候補タスクを仮配置してください。",
    "",
    "条件:",
    "- 提案は最大5件。全部を無理に配置しない(詰め込み禁物、休憩の余白を残す)",
    "- 確定済みの予定と時間を重ねない。時刻は15分刻み、1件は15〜120分",
    "- 期限が近いもの・MIT候補を優先する",
    "- 集中が必要な作業は午前などエネルギーが高い時間帯に置く"
  ].join("\n"),
  // 今日のタスク提案の指示部
  todaySuggest: [
    "あなたは1日の立ち上げを手伝うアシスタントです。",
    "昨日の日報とAIフィードバックを踏まえて、今日やるべきタスクを提案してください。",
    "",
    "条件:",
    "- 提案は最大5件。1日で現実的にこなせる量に絞る(詰め込み禁物)",
    "- 昨日のやり残し・昨日のフィードバックでの提案・期限が近いWBSタスクを優先する",
    "- 各提案に「なぜ今日か」を一言添える",
    "- すでに今日の予定にあるものは提案しない"
  ].join("\n")
};

const energyLevels = [
  { value: 10, label: "良い" },
  { value: 7, label: "少し良い" },
  { value: 5, label: "普通" },
  { value: 3, label: "少し悪い" },
  { value: 0, label: "悪い" }
];

const app = document.querySelector("#app");
const sidebar = document.querySelector("#sidebar");
const main = document.querySelector("#main");
const timelineRail = document.querySelector("#timelineRail");
const bottomNav = document.querySelector("#bottomNav");
const toastEl = document.querySelector("#toast");

let state = loadState();
// v37: 起動時点のデータ更新時刻を退避。
//      起動同期(syncFromGitHubOnStartup)の新旧比較はこの値と行う。
//      (fetch 完了前にユーザー操作で saveState が走っても比較が壊れないように)
const _startupDataModifiedAt = state.dataModifiedAt || "";
let toastTimer = null;
let timerTicker = null;
let cachedVisionMd = "";
let cachedAffirmationMd = "";
const cachedFeedback = {};  // { 'YYYY-MM-DD': '...md text...' }

// v34: 0秒思考 — 画面内の一時状態(永続化しない)
let ztTab = "other";          // "other" | "fav"
let ztAddOpen = false;         // テーマ追加パネルの開閉
let ztCurrent = null;          // 書く画面の対象 { id, text, fav } / null=一覧
let ztSearch = "";             // 履歴検索ワード
let ztTimerInterval = null;    // 書く画面のカウントダウン
let ztTimerLeft = 60;

// v38: 起動処理(maintainRecurrences / render / 各種初期化)はファイル末尾で実行する。
//      ここで render() を呼ぶと、後方で宣言される const(JOURNAL_PROMPTS 等)が
//      未初期化のまま参照され、最後に開いていた画面によっては起動時に例外で全停止していた。

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;
  const id = target.dataset.id;

  if (action === "nav") setView(target.dataset.view);
  if (action === "date-prev") shiftSelectedDate(-1);
  if (action === "date-next") shiftSelectedDate(1);
  if (action === "today") setSelectedDate(todayISO());
  if (action === "set-morning") setMorningEnergy(Number(target.dataset.value));
  if (action === "add-project") addProject();
  if (action === "delete-project") deleteProject(id);
  if (action === "add-task") addTask();
  if (action === "toggle-task") toggleTask(id);
  if (action === "task-today") createBlockFromTask(id);
  if (action === "home-add-today") addTaskToToday(id);
  // v33: ホームのスコアボード → 対応ゾーンへスクロール
  if (action === "home-jump") {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
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
  if (action === "toggle-show-suspended") {
    state.settings.showSuspended = !state.settings.showSuspended;
    saveAndRender();
  }
  // v47: WBS の完了非表示トグル(UI状態)と一括開閉
  if (action === "toggle-wbs-hide-done") {
    state.settings.wbsHideCompleted = !state.settings.wbsHideCompleted;
    persistLocalNoSchedule();
    render();
  }
  if (action === "wbs-collapse-all") {
    const targets = state.projects.filter((p) => !p.deleted && p.kind !== "wish");
    const collapse = !targets.every((p) => p.collapsed);  // 全閉なら開く、そうでなければ閉じる
    state.projects = state.projects.map((p) =>
      (!p.deleted && p.kind !== "wish") ? { ...p, collapsed: collapse } : p);
    saveAndRender();
  }
  if (action === "add-block") addBlock();
  if (action === "toggle-block") toggleBlock(id);
  if (action === "now-start") setBlockTime(id, "actualStartAt");
  if (action === "now-end") setBlockTime(id, "actualEndAt");
  if (action === "delete-block") deleteBlock(id);
  if (action === "generate-report") generateReport();
  if (action === "download-report") downloadReport();
  if (action === "download-data") downloadData();
  if (action === "save-github") saveToGitHub();
  if (action === "load-github") loadFromGitHub();
  if (action === "reset-demo") resetDemoData();
  // v17: MIT(今日の主役)の切替(最大3個)
  if (action === "toggle-mit") toggleMIT(id);
  // v38: AIフィードバックのMIT候補 → 今日の主役ブロック化
  if (action === "mit-candidate-add") addMITCandidate(target.dataset.title);
  // v19: ルーティンタブの表示モード切替
  if (action === "routine-mode") {
    state.routineViewMode = target.dataset.mode || "routine";
    persistLocalNoSchedule();  // v37: UI 操作(dataModifiedAt を汚さない)
    render();
  }
  // v14: 開始前に既存セッションを強制リセット(中断/完了/休憩後の再開でも確実に50:00から)
  if (action === "start-pomodoro") {
    forceResetPomodoroSession();
    startPomodoro(target.dataset.blockId || "");
  }
  if (action === "stop-pomodoro") stopPomodoro();
  if (action === "complete-pomodoro") completePomodoro();
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
  if (action === "modal-save") submitModal();
  if (action === "modal-delete") deleteFromModal();
  // === v2: ビジョン画面のセグメント切替 ===
  if (action === "vision-section") setVisionSection(target.dataset.section);
  if (action === "vision-board-tab") setVisionBoardIndex(Number(target.dataset.index));
  if (action === "open-md-in-github") openMdInGithub(target.dataset.path);
  if (action === "reload-md") reloadStaticMarkdown();
  // === v3: ポモドーロ常時起動 ===
  if (action === "pomo-tab") setPomodoroTab(target.dataset.tab);
  // === v3: 日報のGitHub push ===
  if (action === "push-report") pushReportToGitHub();
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
  // === v9: カテゴリ管理 / 休憩メッセージ管理 ===
  if (action === "add-category") addCategory();
  if (action === "delete-category") deleteCategory(target.dataset.catId);
  if (action === "add-break-message") addBreakMessage();
  if (action === "delete-break-message") deleteBreakMessage(target.dataset.msgId);
  // v10: タイムラインズーム(v37: UI 操作なので dataModifiedAt を汚さない)
  if (action === "tl-zoom") {
    state.timelineZoom = Number(target.dataset.zoom) || 1;
    persistLocalNoSchedule();
    render();
  }
  // v11: サイドバー折りたたみ(v37: 同上)
  if (action === "toggle-sidebar") {
    state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
    persistLocalNoSchedule();
    render();
  }
  // v12: ポモドーロ全画面切替(v37: 同上)
  if (action === "toggle-pomo-fullscreen") {
    state.pomodoro.fullscreen = !state.pomodoro.fullscreen;
    persistLocalNoSchedule();
    render();
  }
  // === v16: やりたいことリスト(v34: input リスナーから click へ移設) ===
  if (action === "add-wish") addWish();
  if (action === "open-wish") toggleWishOpen(id);
  if (action === "add-wish-subtask") addWishSubtask(id);
  if (action === "toggle-wish-subtask") toggleWishSubtask(id);
  if (action === "wish-subtask-to-tasks") wishSubtaskToTasks(id);
  if (action === "wish-realize") realizeWish(id);
  if (action === "wish-unrealize") unrealizeWish(id);
  if (action === "delete-wish") deleteWish(id);
  // === v17: Avoid List(v34: input リスナーから click へ移設) ===
  if (action === "add-avoid") addAvoid();
  if (action === "delete-avoid") deleteAvoid(id);
  // v34: 0秒思考
  if (action === "zt-add-toggle") {
    ztAddOpen = !ztAddOpen;
    render();
    if (ztAddOpen) setTimeout(() => document.querySelector("#zt-add-text")?.focus(), 60);
  }
  if (action === "zt-add-cancel") { ztAddOpen = false; render(); }
  if (action === "zt-add-submit") ztAddSubmit();
  if (action === "zt-tab") { ztTab = target.dataset.tab || "other"; render(); }
  if (action === "zt-fav-toggle") ztToggleFav(id);
  if (action === "zt-write") openZtWrite(id);
  if (action === "zt-save") saveZtEntry();
  if (action === "zt-discard") discardZtWrite();
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
  if (action === "journal-import-ai") {
    const d = target.dataset.date;
    openAiImportModal(d, parseAiFeedback(state.feedback[d] || cachedFeedback[d] || ""));
  }
  if (action === "ai-import-submit") submitAiImport();
  if (action === "ai-mit-adopt") adoptAiMit(Number(target.dataset.index));
  // v49: AIレビュー直接統合(日報 → Anthropic API → フィードバック)
  if (action === "report-ai-review") runAiReview(state.selectedDate);
  // v50: ① AIタスク分解(WBS)
  if (action === "ai-decompose") runAiDecompose(id);
  if (action === "ai-decompose-submit") submitAiDecompose();
  // v50: ② AIスケジュール下書き(仮配置 → D&D調整 → 確定)
  if (action === "ai-schedule") runAiSchedule();
  if (action === "draft-confirm") confirmScheduleDraft();
  if (action === "draft-discard" && _scheduleDraft) {
    // v52: 破棄も「この提案は不要だった」という学習シグナルとして記録
    _scheduleDraft.items.forEach((it) => recordScheduleHistory(it, "discarded", _scheduleDraft.date));
    _scheduleDraft = null;
    saveState();
    render();
    showToast("下書きを破棄しました");
  }
  if (action === "draft-remove" && _scheduleDraft) {
    const removed = _scheduleDraft.items.find((x) => x.id === id);
    if (removed) recordScheduleHistory(removed, "removed", _scheduleDraft.date);  // v52: 却下シグナル
    _scheduleDraft.items = _scheduleDraft.items.filter((x) => x.id !== id);
    if (!_scheduleDraft.items.length) _scheduleDraft = null;
    saveState();
    render();
  }
  // v50: ③ 週次 / 12週サイクルのAI壁打ち
  if (action === "weekly-ai") runAiWeekly(target.dataset.week);
  if (action === "cycle-ai") runAiCycle(target.dataset.cycle);
  // v50: ④ 0秒思考のまとめ所感
  if (action === "zt-ai-comment") runAiZeroComment();
  if (action === "zt-ai-import") openAiImportModal(todayISO(), parseAiFeedback(_ztAiComment?.text || ""));
  // v51: 今日のタスク提案(昨日の日報+フィードバックから)
  if (action === "ai-today-suggest") runAiTodaySuggest();
  if (action === "ai-today-submit") submitAiToday();
  // v51: プロンプトを既定に戻す
  if (action === "ai-prompt-reset") {
    const key = target.dataset.key;
    if (key in AI_DEFAULT_PROMPTS) {
      state.settings.ai.prompts[key] = AI_DEFAULT_PROMPTS[key];
      saveState();
      render();
      showToast("既定のプロンプトに戻しました");
    }
  }
  // v49: 世代バックアップ
  if (action === "open-backup-list") openBackupListModal();
  if (action === "restore-backup") restoreBackup(target.dataset.date);
  // v53: 計器盤の期間切替(UI状態)と手動アーカイブ
  if (action === "stats-range") {
    state.settings.statsRange = target.dataset.range || "4w";
    persistLocalNoSchedule();
    render();
  }
  if (action === "run-archive") runArchive({ manual: true });
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
  if (action === "carry-over") carryOverBlock(id);  // v46: 未完了ブロックを今日へ繰り越し
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
  // v40: ルーティンの曜日フィルタ解除
  if (action === "routine-clear-day") {
    state.settings.routineDayFilter = null;
    persistLocalNoSchedule();
    render();
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches("[data-journal-date]")) {
    state.journals[target.dataset.journalDate] = target.value;
    saveState();
  }
  if (target.matches("[data-feedback-date]")) {
    state.feedback[target.dataset.feedbackDate] = target.value;
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
  if (target.matches("[data-github-field]")) {
    // v37: autoSave チェックボックスもこのセレクタに一致してしまい、
    //      value("on"という文字列)で autoSave を上書き + OFF操作でも自動保存を予約していた。
    //      チェックボックスは change ハンドラ側で処理するのでここでは除外する。
    if (target.type === "checkbox") return;
    state.settings.github[target.dataset.githubField] = target.value.trim();
    saveState();
  }
  // v49: AIレビュー設定(APIキー。model の select は change ハンドラ側)
  if (target.matches("input[data-ai-field]")) {
    state.settings.ai[target.dataset.aiField] = target.value.trim();
    saveState();
  }
  // v51: プロンプトテンプレの編集(空文字も「意図的に空」として保存)
  if (target.matches("textarea[data-ai-prompt]")) {
    state.settings.ai.prompts[target.dataset.aiPrompt] = target.value;
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
  if (target.matches("[data-block-field]")) {
    updateBlockField(target.dataset.id, target.dataset.blockField, target.value);
    render();  // v33: 充電/放電などの変更を画面に即反映
  }
  if (target.matches("[data-setting-field]")) {
    state.settings[target.dataset.settingField] = target.value;
    saveState();
    render();
  }
  // v49: AIレビューのモデル選択
  if (target.matches("select[data-ai-field]")) {
    state.settings.ai[target.dataset.aiField] = target.value;
    saveState();
    render();
  }
  // v51: 朝イチ自動レビューのトグル
  if (target.matches("[data-ai-automorning]")) {
    state.settings.ai.autoMorningReview = target.checked;
    saveState();
    if (target.checked) showToast("朝イチ自動レビューを有効にしました(翌朝から)");
  }
  // v53: 自動アーカイブのトグル
  if (target.matches("[data-setting-autoarchive]")) {
    state.settings.autoArchive = target.checked;
    saveState();
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
  if (target.matches("[data-feedback-upload]")) {
    const date = target.dataset.feedbackUpload;
    const file = target.files?.[0];
    if (file) uploadFeedbackFile(date, file);
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

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return normalizeState(seedState());
  try {
    return normalizeState({ ...seedState(), ...JSON.parse(raw) });
  } catch {
    // v37: 壊れたデータを黙って捨てない。復旧用に退避してから初期状態で起動する。
    //      (そのまま自動保存が走ると、壊れる前のGitHub側データまで初期状態で上書きしかねない)
    try { localStorage.setItem(`${STORAGE_KEY}-corrupt-backup`, raw); } catch { /* 退避失敗はやむなし */ }
    console.error("保存データが壊れていたため初期状態で起動します(-corrupt-backup に退避済み)");
    const seeded = normalizeState(seedState());
    seeded.settings.github.autoSave = false;  // 事故防止: 自動保存は手動で入れ直してもらう
    return seeded;
  }
}

let _lastSaveError = null;

// localStorage への書き込みのみ(自動保存タイマーを再セットしない)。
// 保存ルーチン内部からの保存に使い、自動保存の無限ループを防ぐ。
function persistLocalNoSchedule() {
  // v40: _justStartedBlockId は非永続(modal と同様、シリアライズ時に落とす)
  const persisted = { ...state, modal: null, _justStartedBlockId: null };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    _lastSaveError = null;
  } catch (error) {
    _lastSaveError = error;
    console.error("ローカル保存に失敗:", error);
  }
}

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

function normalizeState(value) {
  value.settings ||= {};
  // v31: 残り時間表示用の生年月日(未設定なら補完)
  if (!value.settings.birthDate) value.settings.birthDate = "1992-12-29";
  value.settings.staticFilesLoaded ||= { vision: false, affirmation: false };
  // v37: インポート/同期で欠けていると描画がクラッシュするキーを補完
  value.settings.morningEnergyLog ||= {};
  value.pomodoro ||= { running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
  value.settings.github ||= defaultGitHubSettings();
  value.settings.github.owner ||= "kojit1229";
  value.settings.github.repo ||= "taskchute-ipad";
  value.settings.github.branch ||= "main";
  value.settings.github.path ||= "app-state.json";
  value.settings.github.token ||= "";
  if (typeof value.settings.github.autoSave !== "boolean") {
    value.settings.github.autoSave = false;
  }
  value.settings.github.lastSavedAt ||= "";
  // v49: AIレビュー(Anthropic API)。apiKey は GitHub token と同様に端末内のみ
  //      (同期・エクスポート時は sanitizedStateForGitHub で除去される)。
  value.settings.ai ||= {};
  value.settings.ai.apiKey ||= "";
  value.settings.ai.model ||= "claude-opus-4-8";
  // v51: プロンプト設定(共通コンテキスト・カスタム指示・機能別テンプレ)。
  //      空文字は「意図的に空」として尊重するため、未定義のときだけ既定を入れる。
  value.settings.ai.prompts ||= {};
  for (const k of Object.keys(AI_DEFAULT_PROMPTS)) {
    if (typeof value.settings.ai.prompts[k] !== "string") value.settings.ai.prompts[k] = AI_DEFAULT_PROMPTS[k];
  }
  // v51: 朝イチ自動レビュー(既定OFF。ONなら日付が変わって最初に開いた時、昨日の日報レビューを自動実行)
  if (typeof value.settings.ai.autoMorningReview !== "boolean") value.settings.ai.autoMorningReview = false;
  // v52: AIスケジュール学習ログ。AIの仮配置に対するユーザの採否・修正を記録し、
  //      次回のAIスケジューリング時に傾向として注入する(端末間で同期される)。
  if (!Array.isArray(value.aiScheduleHistory)) value.aiScheduleHistory = [];
  // v53: 計器盤の期間カーソル(UI状態)と自動アーカイブ設定
  value.settings.statsRange ||= "4w";
  if (typeof value.settings.autoArchive !== "boolean") value.settings.autoArchive = true;
  value.settings.lastArchivedAt ||= "";
  // v43: 自動同期(既定OFF・保守的)。lastPushedAt = 最後に push した時の dataModifiedAt。
  if (typeof value.settings.autoSync !== "boolean") value.settings.autoSync = false;
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
      lifeArea: "",
      motivation: "",
      realized: false,
      realizedDate: "",
      nextRoutineId: "",
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
    ...block,
    plannedStartAt: fixDateTime(block.plannedStartAt),
    plannedEndAt: fixDateTime(block.plannedEndAt),
    actualStartAt: fixDateTime(block.actualStartAt),
    actualEndAt: fixDateTime(block.actualEndAt)
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
  // v42: 日ごとのメタ(AIフィードバック取り込み由来。journals は文字列なので別ストア)
  value.journalMeta ||= {};
  Object.values(value.journalMeta).forEach((j) => {
    if (!Array.isArray(j.aiMitCandidates)) j.aiMitCandidates = [];
    if (!("aiImported" in j)) j.aiImported = false;
  });
  value.feedback ||= {};
  value.reports ||= {};
  // v34: 0秒思考(未知フィールドはデフォルトに足すだけで既存データを壊さない)
  value.zeroThinking ||= { themes: [], entries: [] };
  if (!Array.isArray(value.zeroThinking.themes)) value.zeroThinking.themes = [];
  if (!Array.isArray(value.zeroThinking.entries)) value.zeroThinking.entries = [];
  // v39: 問い(Question)エンティティ。効率化(2x)ではなく価値の中身(10x)を掘る器。
  if (!Array.isArray(value.questions)) value.questions = [];
  value.questions = value.questions.map((q) => ({
    origin: "manual",       // 'manual' | 'zero' | 'review' | 'ai'
    status: "open",         // 'open' | 'deepening' | 'settled'
    settledNote: "",
    settledAt: null,
    lastTouchedAt: null,
    linkedProjectId: null,  // v44: 結論を実行に移した先(what→how の橋)
    linkedTaskId: null,     // v44
    ...q
  }));
  // v39: theme / entry に questionId を補完(どの問いの下で書かれたか)
  value.zeroThinking.themes = value.zeroThinking.themes.map((t) =>
    "questionId" in t ? t : { ...t, questionId: null });
  value.zeroThinking.entries = value.zeroThinking.entries.map((e) =>
    "questionId" in e ? e : { ...e, questionId: null });
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
  // v23: 繰り返しをルール方式へ(旧データは初回のみ自動移行)
  value.recurrences ||= [];
  migrateRecurrencesIfNeeded(value);
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
    state.projects = state.projects.map((p) => p.category === oldCat.name ? { ...p, category: value } : p);
    state.tasks = state.tasks.map((t) => t.category === oldCat.name ? { ...t, category: value } : t);
    state.blocks = state.blocks.map((b) => b.category === oldCat.name ? { ...b, category: value } : b);
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
    lastSavedAt: ""
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
function rerenderActiveModal() {
  if (!state.modal) return;
  // モーダル再描画前に現在のフォーム入力値を退避(category 以外の編集中の値を失わない)
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
  // 入力中の値を復元(category 以外)
  modalRoot.querySelectorAll("[data-modal-field]").forEach((el) => {
    const key = el.dataset.modalField;
    if (key in cached && key !== "category") {
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
    zeroThinking: { themes: [], entries: [] },
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
    orderIndex: 0,
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
}

function render() {
  app.dataset.view = state.currentView;
  renderSidebar();
  renderBottomNav();
  renderMain();
  renderTimelineRail();
  renderSyncBanner();  // v43: 全再描画で消えるバナーを再注入
  // v40: 着手ジュースは1回の描画で消費する(次の描画では付かない)。CSS アニメは挿入時に1回再生。
  state._justStartedBlockId = null;
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

function renderMain() {
  const view = state.currentView;
  if (view === "home") main.innerHTML = renderHome();
  if (view === "wbs") main.innerHTML = renderWBS();
  if (view === "wish") main.innerHTML = renderWish();
  if (view === "avoid") main.innerHTML = renderAvoid();
  if (view === "tasks") main.innerHTML = renderTasks();
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
  if (view === "weekly") main.innerHTML = renderWeekly();
  if (view === "cycle") main.innerHTML = renderCycle();
  if (view === "stats") main.innerHTML = renderStats();  // v53: 計器盤
  if (view === "settings") main.innerHTML = renderSettings();
  if (view === "more") main.innerHTML = renderMore();
}

function renderTimelineRail() {
  // v11: サイドバーの幅(折りたたみ時 56px、通常 216px)
  const sbWidth = state.settings?.sidebarCollapsed ? "56px" : "216px";
  // v10: タスクシュート(tasks)時のみ右タイムライン rail を表示
  if (state.currentView !== "tasks") {
    timelineRail.style.display = "none";
    app.style.gridTemplateColumns = `${sbWidth} minmax(0, 1fr)`;
    return;
  }
  timelineRail.style.display = "";
  app.style.gridTemplateColumns = `${sbWidth} minmax(0, 1fr) 360px`;
  const mode = state.timelineMode || "planned";
  timelineRail.innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <h3>${formatDisplayDate(state.selectedDate)}</h3>
      <button class="btn ghost" data-action="nav" data-view="timeline">開く</button>
    </div>
    <div class="segmented" style="margin-bottom:10px">
      <button class="${mode === "planned" ? "active" : ""}" data-action="timeline-mode" data-mode="planned">予定</button>
      <button class="${mode === "actual" ? "active" : ""}" data-action="timeline-mode" data-mode="actual">実績</button>
    </div>
    ${renderTimeline({ compact: true, mode })}
  `;
}

function renderHeader(eyebrow, title, action = "") {
  return `
    <div class="view-header">
      <div>
        <div class="eyebrow">${eyebrow}</div>
        <h1>${title}</h1>
      </div>
      ${action}
    </div>
  `;
}

// =============================================================
// v31: ホーム(コックピット)— 信条 / 残り時間 / 行動パネル群
// =============================================================
function renderHome() {
  const today = state.selectedDate;
  const isToday = today === todayISO();
  const blocks = blocksForDate(today);
  const metrics = computeMetrics();
  return `
    ${renderHeader("今日の入口", "ホーム", `<button class="btn primary" data-action="today">今日へ</button>`)}
    ${renderDateBar()}
    ${homeCreed()}
    ${homeLifespan(metrics)}
    ${homeHero(blocks, isToday)}
    ${homeScoreboard(blocks)}
    <div class="home-zone-block z-amber" id="homezone-1">
      <div class="home-zone amber">今日、すすめる${projectedEndBadge()}</div>
      <div class="home-grid">
        ${homeMIT(blocks)}
        ${homeTaskchute(blocks)}
      </div>
    </div>
    <div class="home-zone-block z-teal" id="homezone-2">
      <div class="home-zone teal">今日のリズム</div>
      <div class="home-grid">
        ${homeFlow(blocks, isToday)}
        ${homeRoutine(blocks)}
      </div>
    </div>
    <div class="home-zone-block z-blue" id="homezone-3">
      <div class="home-zone blue">長い弧をたしかめる</div>
      <div class="home-grid">
        ${homeCycle(metrics)}
        ${homeBacklog()}
        ${homeQuestions()}
      </div>
      ${homeWeeklyLink()}
    </div>
    <div class="home-zone-block z-green" id="homezone-4">
      <div class="home-zone green">今日の足あと</div>
      <div class="home-grid single">
        ${homeSteps(blocks)}
      </div>
    </div>
  `;
}

// --- 三つの信条 ---
function homeCreed() {
  const creeds = [
    ["着手第一主義！", "雑でもいいからやればやる気が出てくる"],
    ["悩んだときは", "ヒンメルならどうするか考えて行動せよ"],
    ["笑顔でエネルギッシュで", "今日も最高の1日を過ごそう！"]
  ];
  const nums = ["一", "二", "三"];
  return `
    <section class="panel home-creed">
      <div class="home-creed-head">三 つ の 信 条</div>
      ${creeds.map((c, i) => `
        <div class="home-creed-row">
          <span class="home-creed-num">${nums[i]}</span>
          <span class="home-creed-text">${escapeHTML(c[0])}<br>${escapeHTML(c[1])}</span>
        </div>`).join("")}
    </section>`;
}

// --- 残り時間(今年 / 45歳 / 80歳)---
function homeLifespan(metrics) {
  const items = metrics.filter((m) => m.label !== "12WY");
  if (items.length === 0) return "";
  return `
    <section class="panel home-life">
      ${items.map((m) => `
        <div class="home-life-cell">
          <div class="home-life-top">
            <span class="home-life-label">${m.label}</span>
            <span class="home-life-pct">${Math.round(m.progress)}%経過</span>
          </div>
          <div class="home-life-num">${(m.value || "").replace("あと", "")}</div>
          <div class="progress"><span style="width:${clamp(m.progress, 0, 100)}%"></span></div>
        </div>`).join("")}
    </section>`;
}

// 予定時刻の範囲表示
function plannedRange(b) {
  const s = b.plannedStartAt ? timeFromDateTime(b.plannedStartAt) : "—";
  const e = b.plannedEndAt ? timeFromDateTime(b.plannedEndAt) : "—";
  return `${s} – ${e}`;
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
      <div class="eyebrow" style="color:var(--orange)">いま、これ</div>
      <div style="font-size:15px;font-weight:700;color:var(--green);padding:8px 0">
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
      <div style="font-size:12.5px;color:var(--orange);font-weight:600;margin-top:3px">まず5分でいい。やれば乗ってくる。</div>`;
  }
  const btn = started
    ? `<button class="btn green home-hero-btn" data-action="complete-block-with-actual" data-id="${target.id}">✓ 完了にする</button>`
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
    <div class="eyebrow" style="color:var(--orange)">いま、これ</div>
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

// v33: ルーティン実行率
function routineRate(blocks) {
  const list = blocks.filter((b) => b.category === "ルーティン");
  const done = list.filter((b) => b.completed).length;
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}

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
  return `<div class="home-scoreboard">
    ${cell("orange", "タスクシュート着手", tc.pct, "%", `${tc.done}/${tc.total}`, tc.pct, "homezone-1")}
    ${cell("orange", "今日の主役", mitDone, `/${mit.length}`, "MIT", mitPct, "homezone-1")}
    ${cell("green", "ルーティン実行", rt.pct, "%", `${rt.done}/${rt.total}`, rt.pct, "homezone-2")}
    ${cell("blue", "12週 今週", wk.pct, "%", `${wk.done}/${wk.total}`, wk.pct, "homezone-3")}
  </div>`;
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

function homeCheckRow(b, star, showCD) {
  const act = b.completed ? "toggle-block" : "complete-block-with-actual";
  return `<div class="home-ck ${b.completed ? "done" : ""}">
    <span class="home-box" data-action="${act}" data-id="${b.id}">${b.completed ? "✓" : ""}</span>
    <span class="home-ck-name" data-action="edit-block" data-id="${b.id}">${escapeHTML(b.title)}</span>
    ${star ? `<span class="home-star">${star}</span>` : ""}
    ${showCD ? homeChargeSelects(b) : ""}
  </div>`;
}

// --- 今日の主役(MIT)---
function homeMIT(blocks) {
  const mit = blocks.filter((b) => b.isMIT);
  const done = mit.filter((b) => b.completed).length;
  const rows = mit.length
    ? mit.map((b) => homeCheckRow(b, "★")).join("")
    : `<div class="muted" style="font-size:13px;padding:6px 0">タスクシュート画面の ☆ で、今日の主役(最大3)を設定できます。</div>`;
  // v38: 反省→行動ループの結線 — 前日のAIフィードバックの「明日のMIT候補」を提示し、
  //      ワンタップで今日の主役ブロックにできる(枠が空いている日のみ)
  let candidatesHTML = "";
  const isToday = state.selectedDate === todayISO();
  if (isToday && mit.length < 3) {
    const prev = addDays(state.selectedDate, -1);
    const feedbackText = cachedFeedback[prev] || state.feedback[prev] || "";
    const existingTitles = new Set(blocks.map((b) => b.title));
    const candidates = extractMITCandidatesFromReport(feedbackText)
      .filter((c) => !existingTitles.has(c))
      .slice(0, 3 - mit.length);
    if (candidates.length) {
      candidatesHTML = `
        <div class="home-divider"></div>
        <div class="muted" style="font-size:11.5px; font-weight:700; margin-bottom:6px">🤖 昨日のフィードバックからの候補</div>
        ${candidates.map((c) => `
          <div class="home-ck">
            <button class="btn ghost" style="font-size:11px; padding:5px 9px" data-action="mit-candidate-add" data-title="${escapeHTML(c)}">＋ 主役に</button>
            <span class="home-ck-name">${escapeHTML(c)}</span>
          </div>`).join("")}`;
    }
  }
  return `<section class="panel">
    <div class="home-plabel orange">今日の主役<span class="home-count">${done} / ${mit.length}</span></div>
    ${rows}
    ${mit.length ? `<div class="home-foot">今日はこの${mit.length}つ。ここに集中する。</div>` : ""}
    ${candidatesHTML}
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
function homeTaskchute(blocks) {
  // v33: Project に紐づく Block のみ(単発ブロックは taskchuteBlocks で除外)
  const list = taskchuteBlocks(blocks);
  if (!list.length) {
    return `<section class="panel"><div class="home-plabel orange">今日のタスクシュート</div>
      <div class="muted" style="font-size:13px">Projectに紐づくBlockがありません。</div></section>`;
  }
  const started = list.filter((b) => b.completed || b.actualStartAt).length;
  const pct = Math.round((started / list.length) * 100);
  const rows = list.map((b) => {
    const st = b.completed ? "done" : (b.actualStartAt ? "doing" : "todo");
    const badge = st === "doing" ? `<span class="home-badge doing">着手中</span>`
      : (st === "todo" ? `<span class="home-badge todo">未着手</span>` : "");
    const act = b.completed ? "toggle-block" : "complete-block-with-actual";
    return `<div class="home-tc ${st}">
      <span class="home-dot ${st}" data-action="${act}" data-id="${b.id}">${b.completed ? "✓" : ""}</span>
      <span class="home-tc-name" data-action="edit-block" data-id="${b.id}">${escapeHTML(b.title)}</span>${badge}
      ${homeChargeSelects(b)}</div>`;
  }).join("");
  return `<section class="panel"><div class="home-plabel orange">今日のタスクシュート</div>
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
      <span class="home-dot ${b.completed ? "done" : ""}" data-action="${b.completed ? "toggle-block" : "complete-block-with-actual"}" data-id="${b.id}">${b.completed ? "✓" : ""}</span>
      <span class="home-flow-name" data-action="edit-block" data-id="${b.id}">${escapeHTML(b.title)}</span>
      ${isNow ? `<span class="home-badge doing">NOW</span>` : ""}
      ${homeChargeSelects(b)}</div>`;
  }).join("");
  return `<section class="panel"><div class="home-plabel">今日のながれ</div>${rows}</section>`;
}

// --- 今日のルーティン(実行率)---
function homeRoutine(blocks) {
  const r = blocks.filter((b) => b.category === "ルーティン");
  const done = r.filter((b) => b.completed).length;
  const pct = r.length ? Math.round((done / r.length) * 100) : 0;
  const rows = r.length
    ? r.map((b) => homeCheckRow(b, "", true)).join("")
    : `<div class="muted" style="font-size:13px">カテゴリ「ルーティン」のBlockがここに表示されます。</div>`;
  return `<section class="panel"><div class="home-plabel green">今日のルーティン</div>
    ${r.length ? `<div class="home-rate"><span class="home-rate-cap">実行率</span>
      <span class="home-rate-pct green">${pct}%</span>
      <span class="home-rate-frac">${done} / ${r.length}</span></div>
      <div class="progress" style="margin-bottom:10px"><span style="width:${pct}%"></span></div>` : ""}
    ${rows}</section>`;
}

// 週の範囲(12週サイクル用) v33: 土曜〜金曜を1週とみなす
function weekRange(dateISO) {
  const d = new Date(dateISO + "T00:00:00");
  const dow = (d.getDay() + 1) % 7; // Sat=0, Sun=1, ... Fri=6
  const sat = addDays(dateISO, -dow);
  return { weekStart: sat, weekEnd: addDays(sat, 6) };
}

// --- 12週サイクル(B案: Project=目標 / Task=戦術)---
function homeCycle(metrics) {
  const m12 = metrics.find((m) => m.label === "12WY");
  const start = state.settings.twelveWeekStartDate || todayISO();
  const wk = clamp(Math.floor(daysBetween(start, state.selectedDate) / 7) + 1, 1, 12);
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
  return `<section class="panel"><div class="home-plabel blue">12週サイクル</div>
    <div class="home-wk"><span>Week <strong>${wk}</strong> / 12</span>
      <span class="home-wk-days">残り ${Math.max(0, daysBetween(state.selectedDate, addDays(start, 84)))}日</span></div>
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
function homeBacklog() {
  const excluded = state.projects
    .filter((p) => p.kind === "wish" || p.kind === "other")
    .map((p) => p.id);
  // v33: 期限切れ + 当日から1週間以内のタスクのみ(期限なしは除外)。量が多すぎる対策。
  const limit = addDays(state.selectedDate, 7);
  const tasks = state.tasks
    .filter((t) => !t.deleted && !isTaskDead(t) && !excluded.includes(t.projectId)
      && t.dueDate && t.dueDate <= limit)
    .sort((a, b) => (a.dueDate || "99").localeCompare(b.dueDate || "99"));
  const todayTaskIds = new Set(blocksForDate(state.selectedDate).map((b) => b.taskId).filter(Boolean));
  const rows = tasks.slice(0, 8).map((t) => {
    const scheduled = todayTaskIds.has(t.id);
    const overdue = t.dueDate < state.selectedDate;
    const due = `締切 ${t.dueDate.slice(5).replace("-", "/")}`;
    return `<div class="home-due${overdue ? " overdue" : ""}">
      <div class="home-due-main" data-action="edit-task" data-id="${t.id}">
        <div class="home-due-name">${escapeHTML(t.title)}</div>
        <div class="home-due-sub">${escapeHTML(projectName(t.projectId))} ・ ${due}${overdue ? "(期限切れ)" : ""}</div>
      </div>
      ${scheduled
        ? `<button class="btn ghost" disabled style="font-size:11px;padding:7px 10px">追加済み</button>`
        : `<button class="btn ghost home-add" data-action="home-add-today" data-id="${t.id}" style="font-size:11px;padding:7px 10px">＋今日に追加</button>`}
    </div>`;
  }).join("");
  return `<section class="panel"><div class="home-plabel blue">未完了タスク<span class="home-count">${tasks.length}件</span></div>
    ${tasks.length ? rows : `<div class="muted" style="font-size:13px">期限が近い未完了タスクはありません。</div>`}</section>`;
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
          <span class="home-energy-item">充電 <strong style="color:var(--green)">+${charge}</strong></span>
          <span class="home-energy-item">放電 <strong style="color:var(--orange)">−${discharge}</strong></span>
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

// 入力: 貼り付けテキストをセクション抽出(^## 見出しで分割し「- 」行を候補化)
function parseAiFeedback(text) {
  const out = { themes: [], mits: [], questions: [] };
  const map = [["0秒思考テーマ", "themes"], ["MIT候補", "mits"], ["問い候補", "questions"]];
  let cur = null;
  (text || "").split("\n").forEach((line) => {
    const h = line.match(/^#{1,6}\s*(.+?)\s*$/);
    if (h) { const hit = map.find(([kw]) => h[1].includes(kw)); cur = hit ? hit[1] : null; return; }
    if (cur) { const m = line.match(/^\s*[-・•*]\s*(.+?)\s*$/); if (m && m[1]) out[cur].push(m[1].trim()); }
  });
  return out;
}

let _aiImportCtx = null;  // { date, parsed } — 非永続
function openAiImportModal(date, parsed) {
  const total = parsed.themes.length + parsed.mits.length + parsed.questions.length;
  if (!total) return showToast("取り込める候補が見つかりませんでした(見出し構成をご確認ください)");
  _aiImportCtx = { date, parsed };
  state.modal = { type: "aiImport", id: date };
  renderModal(buildAiImportModal(parsed));
}
function buildAiImportModal(parsed) {
  const sec = (title, key, items) => items.length ? `
    <div class="ai-import-sec">
      <div class="ai-import-h">${title}</div>
      ${items.map((t, i) => `<label class="ai-import-row"><input type="checkbox" data-ai-type="${key}" data-ai-index="${i}" checked><span>${escapeHTML(t)}</span></label>`).join("")}
    </div>` : "";
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">🤖 AIフィードバックから取り込み</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        ${sec("💭 0秒思考テーマ", "themes", parsed.themes)}
        ${sec("★ MIT候補", "mits", parsed.mits)}
        ${sec("❓ 問い候補", "questions", parsed.questions)}
        <div class="muted" style="font-size:11.5px; line-height:1.6; margin-top:6px">チェックした項目だけ登録します。MIT候補は Block 化せず、翌日のタスクシュート上部に候補として並び、タップで採用します(採用判断は人間)。</div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-action="modal-close">キャンセル</button>
        <button class="btn primary" data-action="ai-import-submit">取り込む</button>
      </div>
    </div>`;
}
function submitAiImport() {
  if (!_aiImportCtx) return closeModal();
  const { date, parsed } = _aiImportCtx;
  const picked = { themes: [], mits: [], questions: [] };
  modalRoot.querySelectorAll("input[data-ai-type]:checked").forEach((el) => {
    picked[el.dataset.aiType].push(parsed[el.dataset.aiType][Number(el.dataset.aiIndex)]);
  });
  // テーマ: 完全一致は skip(二重防止)
  const existing = new Set(state.zeroThinking.themes.map((t) => t.text));
  picked.themes.forEach((text) => {
    if (!existing.has(text)) state.zeroThinking.themes.push({ id: crypto.randomUUID(), text, fav: false, questionId: null, createdAt: nowDateTime() });
  });
  // MIT候補: Block化せず journalMeta へ(翌日チップ表示、当日限り)
  const meta = (state.journalMeta[date] ||= { aiMitCandidates: [], aiImported: false });
  picked.mits.forEach((t) => { if (!meta.aiMitCandidates.includes(t)) meta.aiMitCandidates.push(t); });
  // 問い候補: origin:'ai' で追加
  picked.questions.forEach((text) => state.questions.push(makeQuestion({ text, origin: "ai" })));
  meta.aiImported = true;
  _aiImportCtx = null;
  closeModal();
  saveAndRender(`取り込みました(テーマ${picked.themes.length}・MIT${picked.mits.length}・問い${picked.questions.length})`);
}

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

// v49: =========================================================
//  AIレビュー直接統合(日報 → Anthropic Messages API → フィードバック)
//  搬送を完全自動化する。コピペ搬送(v42)は API 障害時の手動経路として残す。
//  APIキーは GitHub token と同じ扱い: この端末の localStorage のみに保持し、
//  同期・エクスポート(sanitizedStateForGitHub)からは必ず除去する。
// =========================================================
const AI_MODELS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 — 高品質(目安 ¥90〜180/月)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 — バランス(目安 ¥45〜110/月)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — 最安(目安 ¥25〜55/月)" }
];
let _aiReviewPending = false;  // 実行中ガード(非永続)

// iOS キーチェーンの自動入力は input イベントを発火しないことがある(GitHub 版と同じ対策)
function syncAiFieldsFromDOM() {
  document.querySelectorAll("input[data-ai-field]").forEach((el) => {
    const key = el.dataset.aiField;
    const val = (el.value || "").trim();
    if (val !== (state.settings.ai[key] || "")) state.settings.ai[key] = val;
  });
}

async function aiErrorMessage(response) {
  let raw;
  try {
    const payload = await response.json();
    raw = payload.error?.message || `${response.status} ${response.statusText}`;
  } catch {
    raw = `${response.status} ${response.statusText}`;
  }
  if (response.status === 400 && /credit|billing/i.test(raw)) {
    return `${raw} — クレジット残高を確認してください(Anthropic Console → Billing)`;
  }
  const hints = {
    401: "APIキーが無効です。設定画面で貼り直してください",
    403: "このAPIキーでは実行できません(Console でキーの状態を確認)",
    429: "レート制限中です。少し待ってから再実行してください",
    529: "Anthropic 側が混雑しています。少し待ってから再実行してください"
  };
  const hint = hints[response.status];
  return hint ? `${raw} — ${hint}` : raw;
}

// v50: 共通呼び出し(全AI機能で共用)。プロンプトを送りテキスト応答を返す。
//      呼び出し側が _aiReviewPending ガードとトースト演出を担当する。
async function callClaude(prompt, { maxTokens = 4096 } = {}) {
  syncAiFieldsFromDOM();
  const key = (state.settings.ai?.apiKey || "").trim();
  if (!key) throw new Error("設定画面で Anthropic APIキーを登録してください");
  if (/[^\x00-\xFF]/.test(key)) throw new Error("APIキーに使用できない文字が含まれています。貼り直してください");
  const model = state.settings.ai.model || "claude-opus-4-8";
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }]
  };
  // 4.6 以降のモデルは adaptive thinking(Haiku 4.5 は未対応なので付けない)
  if (model !== "claude-haiku-4-5") body.thinking = { type: "adaptive" };
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      // ブラウザから直接呼ぶための CORS オプトイン。キーは端末外に同期しない前提(単一ユーザー・自分の鍵)。
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await aiErrorMessage(response));
  const data = await response.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("応答が空でした。少し待ってから再実行してください");
  return text;
}

// v50: APIキーが登録済みか(AI系ボタンの表示ゲート)
function aiEnabled() {
  return Boolean((state.settings.ai?.apiKey || "").trim());
}

// v51: 機能別プロンプトテンプレ(設定で編集可。未編集なら既定値)
function aiPrompt(key) {
  const p = state.settings.ai?.prompts || {};
  return typeof p[key] === "string" ? p[key] : (AI_DEFAULT_PROMPTS[key] || "");
}

// v51: 全AI呼び出しの冒頭に付く共通前置き
//      = 共通コンテキスト(私について)+ 現在の12週目標(動的)+ カスタム指示
function aiCommonPreamble() {
  const parts = [];
  const context = aiPrompt("context").trim();
  if (context) parts.push(context);
  const goals = state.projects
    .filter((p) => !p.deleted && p.kind === "normal" && p.status === "active" && p.twelveWeekStartDate)
    .map((p) => p.title);
  if (goals.length) parts.push(`現在の12週サイクルの目標プロジェクト: ${goals.join(" / ")}`);
  const custom = aiPrompt("custom").trim();
  if (custom) parts.push(`追加の指示:\n${custom}`);
  return parts.length ? `${parts.join("\n\n")}\n\n---\n\n` : "";
}

// v50: 応答からJSONを取り出す(```json フェンス優先、無ければ最初の { 〜 最後の })
function extractAiJson(text) {
  const fence = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : String(text);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("応答からJSONを読み取れませんでした。もう一度実行してください");
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("応答のJSONが壊れていました。もう一度実行してください");
  }
}

async function runAiReview(date) {
  if (_aiReviewPending) return showToast("AIを実行中です。少し待ってください");
  // 日報が未生成なら先に生成(日報自体が AI へのプロンプトを含む = v42 のコピペ搬送と同じ素材を送る)
  if (!state.reports[date]) generateReport();
  const report = state.reports[date];
  if (!report) return showToast("日報を生成できませんでした");
  _aiReviewPending = true;
  render();  // ボタンを「レビュー中…」に
  try {
    const text = await callClaude(aiCommonPreamble() + report);  // v51: 共通コンテキストを前置き
    state.feedback[date] = text;  // ジャーナルの AIフィードバック欄と同じ置き場(貼り付けと等価)
    delete cachedFeedback[date];  // 過去に .md を読込済みでも、今回の新しいレビューを表示する
    saveState();
    render();
    showToast("🤖 AIレビューを受信しました");
    // テーマ / MIT / 問い の取り込み候補があれば、既存の取り込みモーダルへ(採用判断は人間)
    const parsed = parseAiFeedback(text);
    if (parsed.themes.length + parsed.mits.length + parsed.questions.length > 0) {
      openAiImportModal(date, parsed);
    }
  } catch (error) {
    showToast(`AIレビュー失敗: ${error.message}`);
  } finally {
    _aiReviewPending = false;
    render();
  }
}

// 日報ビュー / ジャーナルの AIフィードバック欄に置く実行ボタン
function aiReviewButton() {
  if (_aiReviewPending) return `<button class="btn" disabled>⏳ AIレビュー中…</button>`;
  if (!aiEnabled()) return `<button class="btn" disabled title="設定画面で Anthropic APIキーを登録すると使えます">🤖 AIレビュー(要APIキー)</button>`;
  return `<button class="btn primary" data-action="report-ai-review">🤖 AIレビュー実行</button>`;
}

// v50: =========================================================
//  ① AIタスク分解(WBS)
//  白紙のプロジェクトで最初の一歩が出ない問題に効かせる。
//  AIは候補を出すだけ、登録するものはチェックボックスで人間が選ぶ(v42と同型)。
// =========================================================
let _aiDecomposeCtx = null;  // { projectId, tasks:[{title, subtasks[]}] } 非永続

async function runAiDecompose(projectId) {
  if (_aiReviewPending) return showToast("AIを実行中です。少し待ってください");
  const project = state.projects.find((p) => p.id === projectId && !p.deleted);
  if (!project) return;
  const existing = state.tasks
    .filter((t) => !t.deleted && t.projectId === projectId)
    .map((t) => t.title);
  // v51: 指示部はテンプレ(設定で編集可)。データと出力契約はコード側で常に付与。
  const prompt = [
    aiCommonPreamble() + aiPrompt("decompose"),
    "",
    `プロジェクト名: ${project.title}`,
    project.description ? `説明: ${project.description}` : "",
    project.dueDate ? `期限: ${project.dueDate}` : "",
    project.twelveWeekStartDate ? `12週サイクル(12 Week Year)の目標プロジェクトです(開始 ${project.twelveWeekStartDate})` : "",
    existing.length ? `既存タスク(重複させないこと):\n${existing.map((t) => `- ${t}`).join("\n")}` : "",
    "",
    "回答は次の形式のJSONだけを ```json コードブロックで返してください。",
    '{"tasks":[{"title":"...","subtasks":["...","..."]}]}'
  ].filter(Boolean).join("\n");
  _aiReviewPending = true;
  render();
  try {
    const json = extractAiJson(await callClaude(prompt));
    const tasks = (Array.isArray(json.tasks) ? json.tasks : [])
      .map((t) => ({
        title: String(t?.title || "").trim(),
        subtasks: (Array.isArray(t?.subtasks) ? t.subtasks : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3)
      }))
      .filter((t) => t.title)
      .slice(0, 8);
    if (!tasks.length) throw new Error("タスク候補を読み取れませんでした");
    _aiDecomposeCtx = { projectId, tasks };
    state.modal = { type: "aiDecompose", id: projectId };
    renderModal(buildAiDecomposeModal(project, tasks));
  } catch (error) {
    showToast(`AIタスク分解失敗: ${error.message}`);
  } finally {
    _aiReviewPending = false;
    render();
  }
}

function buildAiDecomposeModal(project, tasks) {
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">🤖 AIタスク分解 — ${escapeHTML(project.title)}</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        ${tasks.map((t, i) => `
          <div class="ai-import-sec">
            <label class="ai-import-row"><input type="checkbox" data-ai-task="${i}" checked><span><b>${escapeHTML(t.title)}</b></span></label>
            ${t.subtasks.map((s, j) => `<label class="ai-import-row" style="margin-left:24px"><input type="checkbox" data-ai-subtask="${i}:${j}" checked><span>${escapeHTML(s)}</span></label>`).join("")}
          </div>`).join("")}
        <div class="muted" style="font-size:11.5px; line-height:1.6; margin-top:6px">チェックした項目だけWBSに登録します(タイトル・期限・粒度は登録後にいつでも編集できます)。</div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-action="modal-close">キャンセル</button>
        <button class="btn primary" data-action="ai-decompose-submit">WBSに登録</button>
      </div>
    </div>`;
}

function submitAiDecompose() {
  if (!_aiDecomposeCtx) return closeModal();
  const { projectId, tasks } = _aiDecomposeCtx;
  const project = state.projects.find((p) => p.id === projectId);
  let count = 0;
  tasks.forEach((t, i) => {
    const parentChecked = modalRoot.querySelector(`input[data-ai-task="${i}"]`)?.checked;
    const pickedSubs = t.subtasks.filter((s, j) => modalRoot.querySelector(`input[data-ai-subtask="${i}:${j}"]`)?.checked);
    if (!parentChecked && !pickedSubs.length) return;
    const parent = makeTask({ projectId, title: t.title, category: project?.category || "" });
    parent.dueDate = project?.dueDate || "";  // 期限は自動で付けない(全部「今日」になると翌日全て赤くなる)
    state.tasks.push(parent);
    count++;
    pickedSubs.forEach((s) => {
      const sub = makeTask({ projectId, parentTaskId: parent.id, title: s, category: project?.category || "" });
      sub.dueDate = "";
      state.tasks.push(sub);
      count++;
    });
  });
  _aiDecomposeCtx = null;
  closeModal();
  if (!count) return saveAndRender();
  saveAndRender(`🤖 ${count}件のタスクをWBSに登録しました`);
}

// v50: =========================================================
//  ② AIスケジュール下書き(空き時間への仮配置 → D&Dで調整 → 確定)
//  AIがやるのは「並べる下書き」まで。動かす・削る・確定は人間。
//  下書きは非永続(確定するまで実データに触れない)。
// =========================================================
let _scheduleDraft = null;  // { date, items:[{id,title,taskId,category,start(分),minutes}] } 非永続
let _draftDrag = null;      // ドラッグ中の一時情報 非永続

function minToHHMM(min) {
  const m = clamp(Math.round(min), 0, 24 * 60 - 1);
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

// 配置候補: 昨日のMIT候補 + WBSの未完了タスク(Wish/中断/今日Block化済みを除く、期限順)
function aiScheduleCandidates(date) {
  const out = [];
  const prev = addDays(date, -1);
  (state.journalMeta[prev]?.aiMitCandidates || []).forEach((t, i) =>
    out.push({ id: `mit-${i}`, title: t, taskId: "", category: "", note: "MIT候補" }));
  const wishIds = new Set(state.projects.filter((p) => p.kind === "wish").map((p) => p.id));
  state.tasks
    .filter((t) => !t.deleted && (t.status === "todo" || t.status === "doing") && t.projectId && !wishIds.has(t.projectId))
    .filter((t) => !isTaskSuspended(t))
    .filter((t) => !state.blocks.some((b) => !b.deleted && b.taskId === t.id && b.date === date))
    .sort(wbsTaskCompare)
    .slice(0, 15)
    .forEach((t) => out.push({ id: t.id, title: t.title, taskId: t.id, category: t.category || "", note: t.dueDate ? `期限 ${t.dueDate}` : "" }));
  return out;
}

async function runAiSchedule() {
  if (_aiReviewPending) return showToast("AIを実行中です。少し待ってください");
  const date = state.selectedDate;
  const candidates = aiScheduleCandidates(date);
  if (!candidates.length) return showToast("配置できる候補がありません(WBSの未完了タスクが対象です)");
  const existing = blocksForDate(date)
    .filter((b) => b.plannedStartAt && !isStaleBlock(b))
    .sort((a, b) => a.plannedStartAt.localeCompare(b.plannedStartAt))
    .map((b) => `- ${timeFromDateTime(b.plannedStartAt)}〜${b.plannedEndAt ? timeFromDateTime(b.plannedEndAt) : "?"} ${b.title}`);
  const isToday = date === todayISO();
  const now = new Date();
  // v52: 過去の採否・実績・エネルギー傾向を注入(あれば)
  const digest = buildScheduleLearningDigest(date);
  // v51: 指示部はテンプレ(設定で編集可)。データと動的制約・出力契約はコード側で常に付与。
  const prompt = [
    aiCommonPreamble() + aiPrompt("schedule"),
    "",
    `対象日: ${date}(${weekdayLabel(date)})`,
    state.settings.morningEnergyLog?.[date] !== undefined ? `今朝の体調: ${state.settings.morningEnergyLog[date]}/10(低い日は軽め・少なめに)` : "",  // v53
    "",
    "確定済みの予定(動かせない):",
    existing.length ? existing.join("\n") : "- (まだ予定はありません)",
    "",
    "候補タスク(id で指定すること):",
    candidates.map((c) => `- id:${c.id} ${c.title}${c.note ? `(${c.note})` : ""}`).join("\n"),
    digest ? `\n過去の実績から自動集計した傾向(過去のAI提案がどう修正・却下されたか、時間帯ごとの着手実態。これを踏まえて配置を最適化すること):\n${digest}` : "",
    "",
    `制約: 時刻は 05:00〜23:00 の範囲内${isToday ? `。現在時刻 ${pad2(now.getHours())}:${pad2(now.getMinutes())} より前には置かない` : ""}`,
    "",
    "回答は次の形式のJSONだけを ```json コードブロックで返してください。",
    '{"plan":[{"id":"候補のid","start":"HH:MM","minutes":45}]}'
  ].join("\n");
  _aiReviewPending = true;
  render();
  try {
    const json = extractAiJson(await callClaude(prompt));
    const byId = new Map(candidates.map((c) => [String(c.id), c]));
    const items = (Array.isArray(json.plan) ? json.plan : [])
      .map((p) => {
        const c = byId.get(String(p?.id));
        const m = String(p?.start || "").match(/^(\d{1,2}):(\d{2})$/);
        if (!c || !m) return null;
        const start = Number(m[1]) * 60 + Number(m[2]);
        if (start < 5 * 60 || start >= 24 * 60) return null;  // タイムラインの表示レンジ(5〜24時)内のみ
        const minutes = clamp(Math.round(Number(p?.minutes || 30) / 15) * 15 || 30, 15, 240);
        // v52: aiStart/aiMinutes = AIの元提案(D&Dで動かしても保持)。確定時に学習ログへ残す。
        return { id: crypto.randomUUID(), title: c.title, taskId: c.taskId, category: c.category, start, minutes, aiStart: start, aiMinutes: minutes };
      })
      .filter(Boolean)
      .slice(0, 6);
    if (!items.length) throw new Error("配置案を読み取れませんでした");
    _scheduleDraft = { date, items };
    state.timelineMode = "planned";
    setView("timeline");
    showToast("🤖 下書きを配置しました — ドラッグで調整して「確定」してください");
  } catch (error) {
    showToast(`AI下書き失敗: ${error.message}`);
  } finally {
    _aiReviewPending = false;
    render();
  }
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
        return `
        <div class="draft-block" data-draft-id="${it.id}" data-row-height="${rowHeight}"
             style="top:${top}px; height:${height}px; ${catColor ? `border-color:${catColor};` : ""}">
          <div class="draft-block-time">${minToHHMM(it.start)}〜${minToHHMM(it.start + it.minutes)}(${it.minutes}分)</div>
          <div class="draft-block-title">${escapeHTML(it.title)}</div>
          <button class="draft-remove" data-action="draft-remove" data-id="${it.id}" aria-label="この下書きを外す">×</button>
          <div class="draft-resize" data-draft-resize="${it.id}"></div>
        </div>`;
      }).join("")}
    </div>`;
}

function draftBarHTML() {
  if (!_scheduleDraft || _scheduleDraft.date !== state.selectedDate) return "";
  return `
    <div class="draft-bar">
      <span>🤖 下書き ${_scheduleDraft.items.length}件 — ドラッグで移動 / 下端をドラッグで長さ調整 / ×で外す</span>
      <span class="row" style="gap:6px">
        <button class="btn primary" data-action="draft-confirm">確定して登録</button>
        <button class="btn ghost" data-action="draft-discard">破棄</button>
      </span>
    </div>`;
}

// v52: =========================================================
//  AIスケジュールの学習ループ
//  AIの元提案(aiStart/aiMinutes)・ユーザ確定・却下を aiScheduleHistory に記録し、
//  実績(actualStartAt 等)は Block 側の aiPlan から突き合わせる。
//  次回の runAiSchedule / runAiTodaySuggest でこれらを集計した「傾向」を注入する。
//  ※ モデルの再学習ではなく、実データの要約をプロンプトに載せる方式(in-context)。
// =========================================================
const AI_SCHED_HISTORY_MAX = 300;
const SCHED_BANDS = [
  [5, 9, "早朝(5-9時)"],
  [9, 12, "午前(9-12時)"],
  [12, 15, "昼(12-15時)"],
  [15, 18, "午後(15-18時)"],
  [18, 23, "夜(18-23時)"]
];

function hhmmToMin(hhmm) {
  const m = String(hhmm || "").match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// 採用/却下を1件記録(採用時は確定値も)
function recordScheduleHistory(item, outcome, date) {
  state.aiScheduleHistory.push({
    date,
    title: item.title,
    category: item.category || "",
    aiStart: minToHHMM(item.aiStart ?? item.start),
    aiMin: item.aiMinutes ?? item.minutes,
    outcome,  // 'confirmed' | 'removed' | 'discarded'
    userStart: outcome === "confirmed" ? minToHHMM(item.start) : null,
    userMin: outcome === "confirmed" ? item.minutes : null,
    at: nowDateTime()
  });
  if (state.aiScheduleHistory.length > AI_SCHED_HISTORY_MAX) {
    state.aiScheduleHistory = state.aiScheduleHistory.slice(-AI_SCHED_HISTORY_MAX);
  }
}

// v53: 朝の体調(morningEnergyLog: 10/7/5/3/0 の5段階)と着手率の相関。
//      低い日(≤3)と良い日(≥7)で二分(普通=5 は除外)、各群 n≥5 のときだけ1行返す。
function morningEnergyCorrelation(pastBlocks) {
  const today = todayISO();
  const since = addDays(today, -56);
  const past = pastBlocks || state.blocks.filter((b) => !b.deleted && b.date >= since && b.date < today && b.plannedStartAt);
  const lowDays = new Set();
  const highDays = new Set();
  Object.entries(state.settings.morningEnergyLog || {}).forEach(([d, v]) => {
    if (d < since || d >= today) return;
    if (Number(v) <= 3) lowDays.add(d);
    else if (Number(v) >= 7) highDays.add(d);
  });
  const rateFor = (days) => {
    const bs = past.filter((b) => days.has(b.date));
    if (bs.length < 5) return null;
    return { pct: Math.round((bs.filter((b) => b.actualStartAt).length / bs.length) * 100), n: bs.length };
  };
  const low = rateFor(lowDays);
  const high = rateFor(highDays);
  if (!low || !high) return "";
  return `- 朝の体調が低い日(3以下)の着手率${low.pct}%(${low.n}件) / 良い日(7以上)は${high.pct}%(${high.n}件)`;
}

// 過去データを集計した「傾向」テキスト(スケジュール系プロンプトに注入)。
// 直近8週。n が少ない行は出さない(ノイズを学習させない)。
function buildScheduleLearningDigest(targetDate) {
  const lines = [];
  const today = todayISO();
  const since = addDays(today, -56);

  // 1) AI提案に対するユーザの採否・修正傾向(aiScheduleHistory)
  const hist = (state.aiScheduleHistory || []).filter((h) => h.date >= since);
  if (hist.length >= 3) {
    const conf = hist.filter((h) => h.outcome === "confirmed");
    lines.push(`- AI下書きの過去実績: ${hist.length}件提案 → 採用${conf.length} / 却下${hist.length - conf.length}`);
    SCHED_BANDS.forEach(([s, e, label]) => {
      const inBand = hist.filter((h) => { const m = hhmmToMin(h.aiStart); return m !== null && m >= s * 60 && m < e * 60; });
      if (inBand.length < 3) return;
      const bandConf = inBand.filter((h) => h.outcome === "confirmed" && h.userStart);
      const rejRate = Math.round(((inBand.length - bandConf.length) / inBand.length) * 100);
      let detail = "";
      if (bandConf.length) {
        const avgShift = Math.round(bandConf.reduce((sum, h) => sum + (hhmmToMin(h.userStart) - hhmmToMin(h.aiStart)), 0) / bandConf.length);
        const avgDur = Math.round(bandConf.reduce((sum, h) => sum + (h.userMin / Math.max(1, h.aiMin)), 0) / bandConf.length * 100);
        detail = `、採用時はユーザが平均 ${avgShift >= 0 ? "+" : ""}${avgShift}分 移動・所要時間を平均${avgDur}%に調整`;
      }
      lines.push(`  - ${label}への提案: ${inBand.length}件、却下率${rejRate}%${detail}`);
    });
  }

  // 2) 計画 vs 実績(全Block・時間帯別の着手率と開始ズレ)
  const past = state.blocks.filter((b) => !b.deleted && b.date >= since && b.date < today && b.plannedStartAt);
  if (past.length >= 5) {
    SCHED_BANDS.forEach(([s, e, label]) => {
      const inBand = past.filter((b) => { const m = minutesOf(b.plannedStartAt); return m >= s * 60 && m < e * 60; });
      if (inBand.length < 5) return;
      const started = inBand.filter((b) => b.actualStartAt);
      const rate = Math.round((started.length / inBand.length) * 100);
      let delayTxt = "";
      if (started.length >= 3) {
        const avgDelay = Math.round(started.reduce((sum, b) => sum + (minutesOf(b.actualStartAt) - minutesOf(b.plannedStartAt)), 0) / started.length);
        delayTxt = `、実際の開始は予定より平均 ${avgDelay >= 0 ? "+" : ""}${avgDelay}分`;
      }
      lines.push(`- ${label}の計画Block: 着手率${rate}%(${started.length}/${inBand.length})${delayTxt}`);
    });
    // AI下書き経由のBlockの着手率(提案どおり動けているか)
    const aiBlocks = past.filter((b) => b.aiPlan);
    if (aiBlocks.length >= 3) {
      const started = aiBlocks.filter((b) => b.actualStartAt).length;
      lines.push(`- AI下書き経由のBlock: ${aiBlocks.length}件、着手率${Math.round((started / aiBlocks.length) * 100)}%`);
    }
  }

  // 3) 対象日の曜日の傾向(直近8週の同曜日)
  const wd = parseDate(targetDate).getDay();
  const sameWd = past.filter((b) => parseDate(b.date).getDay() === wd);
  if (sameWd.length >= 5) {
    const started = sameWd.filter((b) => b.actualStartAt).length;
    lines.push(`- ${weekdayLabel(targetDate)}曜の過去8週: 計画${sameWd.length}件、着手率${Math.round((started / sameWd.length) * 100)}%`);
  }

  // 5) 朝の体調と着手率の相関(v53)
  const corr = morningEnergyCorrelation(past);
  if (corr) lines.push(corr);

  // 4) 時間帯別のエネルギー収支(完了Blockの充電-放電)
  const done = state.blocks.filter((b) => !b.deleted && b.completed && b.date >= since && (b.actualStartAt || b.plannedStartAt));
  const bandNet = SCHED_BANDS.map(([s, e, label]) => {
    const inBand = done.filter((b) => { const m = minutesOf(b.actualStartAt || b.plannedStartAt); return m >= s * 60 && m < e * 60; });
    if (inBand.length < 5) return null;
    const net = inBand.reduce((sum, b) => sum + Number(b.charge || 0) - Number(b.discharge || 0), 0) / inBand.length;
    return { label, net: Math.round(net * 10) / 10 };
  }).filter(Boolean);
  if (bandNet.length >= 2) {
    lines.push(`- 時間帯別の平均エネルギー収支: ${bandNet.map((x) => `${x.label} ${x.net >= 0 ? "+" : ""}${x.net}`).join(" / ")}`);
  }

  return lines.join("\n");
}

function confirmScheduleDraft() {
  if (!_scheduleDraft || !_scheduleDraft.items.length) return;
  const { date, items } = _scheduleDraft;
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
    // v52: AIの元提案を Block に残す(確定・実績との突き合わせ = 学習の元データ)
    block.aiPlan = { start: minToHHMM(it.aiStart ?? it.start), minutes: it.aiMinutes ?? it.minutes };
    state.blocks.push(block);
    recordScheduleHistory(it, "confirmed", date);
  });
  _scheduleDraft = null;
  saveAndRender(`🤖 ${items.length}件のBlockを登録しました`);
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

// v50: =========================================================
//  ③ 週次 / 12週サイクルレビューのAI壁打ち
//  所感はメモ欄に追記する(自分の総括を上書きしない)。変更案は1つに絞らせる。
// =========================================================
async function runAiWeekly(week) {
  if (!week) return;
  if (_aiReviewPending) return showToast("AIを実行中です。少し待ってください");
  _aiReviewPending = true;
  render();
  try {
    // v53: 朝の体調の補足(その週の平均 + 8週の相関)
    const wkDays = computeWeeklyMetrics(week).days;
    const wkMoods = wkDays.map((d) => state.settings.morningEnergyLog?.[d]).filter((v) => v !== undefined).map(Number);
    const corr = morningEnergyCorrelation();
    const moodLines = [];
    if (wkMoods.length) moodLines.push(`- この週の朝の体調平均: ${(wkMoods.reduce((a, b) => a + b, 0) / wkMoods.length).toFixed(1)}/10(記録${wkMoods.length}日)`);
    if (corr) moodLines.push(corr);
    const prompt = [
      aiCommonPreamble() + "以下は私の週次レビューです。",
      "",
      buildWeeklyMarkdown(week),
      moodLines.length ? `\n補足データ(朝の体調):\n${moodLines.join("\n")}` : "",
      "",
      "このデータから、簡潔にフィードバックをください(辛口可、行動に繋がる具体性を重視)。",
      "回答は必ず次の見出し構成のMarkdownで:",
      "## 気づき(構造・パターン)",
      "## 来週の変更案(1つだけ)"
    ].join("\n");
    const text = await callClaude(prompt, { maxTokens: 2048 });
    const prev = state.weeklyReviews[week] || { md: "", changeThemeCreated: false, createdAt: nowDateTime() };
    const sep = prev.md && prev.md.trim() ? "\n\n---\n" : "";
    state.weeklyReviews[week] = { ...prev, md: `${prev.md || ""}${sep}#### 🤖 AI壁打ち(${todayISO()})\n\n${text}`, updatedAt: nowDateTime() };
    saveState();
    render();
    showToast("🤖 AIの所感をメモ欄に追記しました");
  } catch (error) {
    showToast(`AI壁打ち失敗: ${error.message}`);
  } finally {
    _aiReviewPending = false;
    render();
  }
}

async function runAiCycle(cycleStart) {
  if (!cycleStart) return;
  if (_aiReviewPending) return showToast("AIを実行中です。少し待ってください");
  _aiReviewPending = true;
  render();
  try {
    const prompt = [
      aiCommonPreamble() + "以下は私の12週サイクル(12 Week Year)の節目レビューです。",
      "",
      buildCycleMarkdown(cycleStart),
      "",
      "この12週のデータから、簡潔にフィードバックをください(辛口可、行動に繋がる具体性を重視)。",
      "回答は必ず次の見出し構成のMarkdownで:",
      "## 気づき(構造・パターン)",
      "## 次サイクルの変更案(1つだけ)"
    ].join("\n");
    const text = await callClaude(prompt, { maxTokens: 2048 });
    const prev = state.cycleReviews[cycleStart] || { md: "", createdAt: nowDateTime() };
    const sep = prev.md && prev.md.trim() ? "\n\n---\n" : "";
    state.cycleReviews[cycleStart] = { ...prev, md: `${prev.md || ""}${sep}#### 🤖 AI壁打ち(${todayISO()})\n\n${text}`, updatedAt: nowDateTime() };
    saveState();
    render();
    showToast("🤖 AIの所感を総括メモに追記しました");
  } catch (error) {
    showToast(`AI壁打ち失敗: ${error.message}`);
  } finally {
    _aiReviewPending = false;
    render();
  }
}

// v50: =========================================================
//  ④ 0秒思考のまとめ所感
//  書く前ではなく「書いた後」の履歴に対してだけ使う(1分書き切りの趣旨を壊さない)。
//  直近7日分をまとめて送り、構造・見えていない角度・問い候補をもらう。所感自体は保存しない。
// =========================================================
let _ztAiComment = null;  // { text, count, since } 非永続

async function runAiZeroComment() {
  if (_aiReviewPending) return showToast("AIを実行中です。少し待ってください");
  const since = addDays(todayISO(), -7);
  const entries = (state.zeroThinking?.entries || [])
    .filter((e) => (e.date || "") >= since)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
    .slice(-20);
  if (entries.length < 2) return showToast("直近7日の0秒思考が2件以上たまってから使えます");
  const prompt = [
    aiCommonPreamble() + "以下は私が直近7日間に「0秒思考」(1テーマ1分の書き出し)で書いたメモです。",
    "1件ずつではなく、全体を眺めてまとめて所感をください。",
    "",
    ...entries.map((e) => `### ${e.date} ${e.theme || "(テーマなし)"}\n${e.body || ""}`),
    "",
    "観点: ①複数メモに共通する構造・思考のクセ ②本人に見えていなさそうな角度 ③このメモ群から立てるべき問い",
    "回答は必ず次の見出し構成のMarkdown(候補は「- 」の箇条書き):",
    "## 所感",
    "## 明日の0秒思考テーマ",
    "## 問い候補",
    "該当がないセクションは見出しごと省略してください。"
  ].join("\n");
  _aiReviewPending = true;
  render();
  try {
    const text = await callClaude(prompt);
    _ztAiComment = { text, count: entries.length, since };
    state.modal = { type: "ztAiComment" };
    renderModal(buildZtAiCommentModal());
  } catch (error) {
    showToast(`AI所感失敗: ${error.message}`);
  } finally {
    _aiReviewPending = false;
    render();
  }
}

function buildZtAiCommentModal() {
  if (!_ztAiComment) return "";
  return `
    <div class="modal-card search-modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">🤖 0秒思考への所感(直近7日・${_ztAiComment.count}件)</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body" style="max-height:58vh; overflow-y:auto">
        <div class="md-render">${renderMarkdown(_ztAiComment.text)}</div>
        <div class="muted" style="font-size:11.5px; line-height:1.6; margin-top:10px">この所感は保存されません(考える材料としてその場で読む用)。残したい部分はジャーナルへ。テーマ・問いは下のボタンで取り込めます。</div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-action="modal-close">閉じる</button>
        <button class="btn primary" data-action="zt-ai-import">テーマ/問いを取り込む</button>
      </div>
    </div>`;
}

// v51: =========================================================
//  今日のタスク提案(昨日の日報+フィードバック → 今日の候補 → 選択登録)
//  「今日、何から手を付けるか」の立ち上げを軽くする。登録判断は人間。
// =========================================================
let _aiTodayCtx = null;  // { date, suggestions:[{title,taskId,minutes,reason}] } 非永続

async function runAiTodaySuggest() {
  if (_aiReviewPending) return showToast("AIを実行中です。少し待ってください");
  const today = todayISO();
  const yest = addDays(today, -1);
  // 昨日の素材(日報が未生成なら静かに生成して使う)
  const report = state.reports[yest] || generateReport(yest, { quiet: true }) || "";
  const feedback = state.feedback[yest] || cachedFeedback[yest] || "";
  const wbsCands = aiScheduleCandidates(today).filter((c) => c.taskId);  // WBS未完了(今日Block化済み除外は共通)
  const todayBlocks = blocksForDate(today)
    .filter((b) => !isStaleBlock(b))
    .map((b) => `- ${b.title}${b.plannedStartAt ? `(${timeFromDateTime(b.plannedStartAt)})` : ""}`);
  const prompt = [
    aiCommonPreamble() + aiPrompt("todaySuggest"),
    "",
    `今日: ${today}(${weekdayLabel(today)})`,
    state.settings.morningEnergyLog?.[today] !== undefined ? `今朝の体調: ${state.settings.morningEnergyLog[today]}/10(低い日は軽め・少なめに)` : "",  // v53
    "",
    "今日すでに入っている予定(これらは提案しない):",
    todayBlocks.length ? todayBlocks.join("\n") : "- (まだありません)",
    "",
    "WBSの未完了タスク(該当があれば taskId で参照すること):",
    wbsCands.length ? wbsCands.map((c) => `- taskId:${c.id} ${c.title}${c.note ? `(${c.note})` : ""}`).join("\n") : "- (なし)",
    (() => { const d = buildScheduleLearningDigest(today); return d ? `\n過去の実績から自動集計した傾向(提案量・内容の目安にすること):\n${d}` : ""; })(),  // v52
    "",
    "----- 昨日の日報 -----",
    report || "(昨日の日報はありません)",
    feedback ? `\n----- 昨日のAIフィードバック -----\n${feedback}` : "",
    "",
    "回答は次の形式のJSONだけを ```json コードブロックで返してください。",
    '{"suggestions":[{"title":"...","taskId":"WBSのtaskIdまたは空文字","minutes":30,"reason":"なぜ今日か"}]}'
  ].join("\n");
  _aiReviewPending = true;
  render();
  try {
    const json = extractAiJson(await callClaude(prompt));
    const validIds = new Set(wbsCands.map((c) => String(c.id)));
    const suggestions = (Array.isArray(json.suggestions) ? json.suggestions : [])
      .map((s) => ({
        title: String(s?.title || "").trim(),
        taskId: validIds.has(String(s?.taskId || "")) ? String(s.taskId) : "",
        minutes: clamp(Math.round(Number(s?.minutes || 30) / 15) * 15 || 30, 15, 240),
        reason: String(s?.reason || "").trim()
      }))
      .filter((s) => s.title)
      .slice(0, 5);
    if (!suggestions.length) throw new Error("提案を読み取れませんでした");
    _aiTodayCtx = { date: today, suggestions };
    state.modal = { type: "aiToday" };
    renderModal(buildAiTodayModal(suggestions));
  } catch (error) {
    showToast(`AIタスク提案失敗: ${error.message}`);
  } finally {
    _aiReviewPending = false;
    render();
  }
}

function buildAiTodayModal(suggestions) {
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">🤖 今日のタスク提案(昨日の日報より)</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        ${suggestions.map((s, i) => `
          <label class="ai-import-row">
            <input type="checkbox" data-ai-today="${i}" checked>
            <span><b>${escapeHTML(s.title)}</b> <span class="muted" style="font-size:11px">約${s.minutes}分${s.taskId ? " ・ WBS連携" : ""}</span>
            ${s.reason ? `<br><span class="muted" style="font-size:11.5px">${escapeHTML(s.reason)}</span>` : ""}</span>
          </label>`).join("")}
        <div class="muted" style="font-size:11.5px; line-height:1.6; margin-top:6px">チェックした項目を今日のタスクシュートに登録します(時間は未定のまま。「🤖 下書きスケジュール」で空き時間に配置できます)。</div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-action="modal-close">キャンセル</button>
        <button class="btn primary" data-action="ai-today-submit">今日へ登録</button>
      </div>
    </div>`;
}

function submitAiToday() {
  if (!_aiTodayCtx) return closeModal();
  const { date, suggestions } = _aiTodayCtx;
  let count = 0;
  suggestions.forEach((s, i) => {
    if (!modalRoot.querySelector(`input[data-ai-today="${i}"]`)?.checked) return;
    state.blocks.push(makeBlock({ date, title: s.title, taskId: s.taskId || "", estimateMin: s.minutes }));
    count++;
  });
  _aiTodayCtx = null;
  closeModal();
  if (!count) return saveAndRender();
  saveAndRender(`🤖 ${count}件を今日のタスクシュートに登録しました`);
}

// v51: =========================================================
//  朝イチ自動レビュー(opt-in・既定OFF)
//  日付が変わって最初に開いた時、昨日の日報生成 → AIレビューをバックグラウンド実行。
//  朝は「読むだけ」になる。画面は動かさず、完了時にトーストだけ。
// =========================================================
const AUTO_REVIEW_DATE_KEY = "taskchute-auto-review-date";  // 端末ローカル(失敗リトライの暴走防止)

async function maybeAutoMorningReview() {
  if (!state.settings.ai?.autoMorningReview || !aiEnabled() || _aiReviewPending) return;
  const today = todayISO();
  const yest = addDays(today, -1);
  try {
    if (localStorage.getItem(AUTO_REVIEW_DATE_KEY) === today) return;  // 1日1回(失敗しても再試行しない)
  } catch { /* 読めなければ続行 */ }
  // 既にレビュー済み(他端末含む)なら何もしない
  if ((state.feedback[yest] || "").trim() || (cachedFeedback[yest] || "").trim()) return;
  // 昨日に実行データもジャーナルも無ければレビューする意味がない
  const hadActivity = blocksForDate(yest).length > 0 || (state.journals[yest] || "").trim();
  if (!hadActivity) return;
  try { localStorage.setItem(AUTO_REVIEW_DATE_KEY, today); } catch { /* 記録できなくても続行 */ }
  const report = state.reports[yest] || generateReport(yest, { quiet: true });
  if (!report) return;
  _aiReviewPending = true;
  try {
    const text = await callClaude(aiCommonPreamble() + report);
    state.feedback[yest] = text;
    delete cachedFeedback[yest];
    saveState();
    render();
    showToast("🤖 昨日のAIレビューが届いています(ジャーナルで確認)");
  } catch (error) {
    console.warn("朝イチ自動レビューをスキップ:", error.message);  // 静かに(手動実行は常に可能)
  } finally {
    _aiReviewPending = false;
  }
}

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
      <span class="carryover-title">${escapeHTML(b.title)}${b.plannedStartAt ? ` <span class="muted">${timeFromDateTime(b.plannedStartAt)}</span>` : ""}${b.category ? `<span class="cat-chip" style="background:${getCategoryColor(b.category)}1f; color:${getCategoryColor(b.category)}; border:1px solid ${getCategoryColor(b.category)}66">${escapeHTML(b.category)}</span>` : ""}</span>
      <button class="btn ghost" data-action="carry-over" data-id="${b.id}">→ 今日へ</button>
    </div>`).join("")}
  </div>`;
}
function carryOverBlock(id) {
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
  state.blocks.push(block);
  // 旧ブロックを「繰り越し済み」に(未完了リストから外れ、再提案されない)
  state.blocks = state.blocks.map((b) => b.id === src.id ? { ...b, migratedTo: block.id, updatedAt: nowDateTime() } : b);
  saveAndRender("今日へ繰り越しました");
}

function extractMITCandidatesFromReport(reportText) {
  if (!reportText) return [];
  // 「明日の MIT 候補:」の行から数行抽出(箇条書きまたは1行)
  const lines = reportText.split("\n");
  const idx = lines.findIndex((line) => /(?:明日の)?\s*MIT\s*候補/i.test(line));  // v42: "## MIT候補" 固定フォーマットにも対応
  if (idx < 0) return [];
  const candidates = [];
  // 同じ行に「: 内容」がある場合
  const sameLine = lines[idx].split(/:|:/).slice(1).join(":").trim();
  if (sameLine) candidates.push(sameLine);
  // 次の数行が「- 」「・」始まりなら抽出
  for (let i = idx + 1; i < Math.min(idx + 6, lines.length); i++) {
    const l = lines[i].trim();
    if (!l) break;
    if (l.startsWith("##") || l.startsWith("#")) break;
    const m = l.match(/^[-・•*]\s*(.+)$/);
    if (m) candidates.push(m[1].trim());
    else if (i === idx + 1 && !l.startsWith("##")) candidates.push(l);
  }
  return candidates.filter(Boolean).slice(0, 3);
}

// =============================================================
// v16: やりたいことリスト(Wish)タブ
// =============================================================

// Wish Project を取得(必ず1つ存在することは normalizeState で保証済み)
function getWishProject() {
  return state.projects.find((p) => p.kind === "wish" && !p.deleted);
}

// ある Wish (Task) のサブタスク(全階層)を再帰的に取得
function getSubtasksOf(taskId) {
  const direct = state.tasks.filter((t) => !t.deleted && t.parentTaskId === taskId);
  let all = [...direct];
  for (const child of direct) {
    all = all.concat(getSubtasksOf(child.id));
  }
  return all;
}

// Wish の進捗(完了サブタスク数 / 総サブタスク数)
function wishProgress(wishTaskId) {
  const subs = getSubtasksOf(wishTaskId);
  if (subs.length === 0) return { done: 0, total: 0, percent: 0 };
  const done = subs.filter((t) => t.status === "completed").length;
  return { done, total: subs.length, percent: Math.round((done / subs.length) * 100) };
}

// Wish の「次の一歩」= 未完了の最初のサブタスク
function nextStepOf(wishTaskId) {
  const subs = getSubtasksOf(wishTaskId).filter((t) => t.status !== "completed");
  if (subs.length === 0) return null;
  // dueDate がある順 → createdAt 順
  subs.sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });
  return subs[0];
}

// Wish の最終更新日(本体 or サブタスクの最も新しい updatedAt)
function wishLastActivity(wishTaskId) {
  const wish = state.tasks.find((t) => t.id === wishTaskId);
  if (!wish) return "";
  const subs = getSubtasksOf(wishTaskId);
  const times = [wish.updatedAt || "", ...subs.map((t) => t.updatedAt || "")].filter(Boolean);
  return times.sort().pop() || "";
}

// 60 日以上動いていないか
function isWishStagnant(wishTaskId) {
  const last = wishLastActivity(wishTaskId);
  if (!last) return false;
  const lastMs = new Date(last).getTime();
  return Date.now() - lastMs > 60 * 24 * 60 * 60 * 1000;
}

// 時期グループ判定: targetYear と現在年から「~Nまで(あと M 年)」のラベル
function wishGroupKey(wish) {
  if (wish.realized) return "realized";
  if (!wish.targetYear) return "someday";
  return `by-${wish.targetYear}`;
}

function wishGroupLabel(key) {
  if (key === "realized") return "✓ 実現済み";
  if (key === "someday") return "いつか";
  const year = Number(key.replace("by-", ""));
  const now = new Date().getFullYear();
  const diff = year - now;
  if (diff <= 0) return `~${year} (今年・期限到来)`;
  return `~${year} (あと ${diff} 年)`;
}

// 領域の色を取得
function lifeAreaColor(name) {
  const area = (state.settings.lifeAreas || []).find((a) => a.name === name);
  return area?.color || "#8E8E93";
}

// メインレンダリング
function renderWish() {
  const wishProject = getWishProject();
  if (!wishProject) {
    return `
      ${renderHeader("やりたいことリスト", "Wish")}
      <section class="panel">Wish Project が存在しません。リロードしてください。</section>
    `;
  }

  // フィルタ状態
  const filter = state.wishFilter || { area: "", showRealized: false };
  const wishes = state.tasks
    .filter((t) => !t.deleted && t.projectId === wishProject.id && !t.parentTaskId)
    .filter((t) => filter.area ? t.lifeArea === filter.area : true)
    .filter((t) => filter.showRealized ? true : !t.realized);

  // 実現率(全 Wish 中)
  const allWishes = state.tasks.filter((t) => !t.deleted && t.projectId === wishProject.id && !t.parentTaskId);
  const realizedCount = allWishes.filter((t) => t.realized).length;
  const overallRate = allWishes.length === 0 ? 0 : Math.round((realizedCount / allWishes.length) * 100);

  // 領域フィルタオプション
  const lifeAreas = state.settings.lifeAreas || [];

  // 時期グループでまとめる
  const groups = {};
  for (const w of wishes) {
    const key = wishGroupKey(w);
    groups[key] ||= [];
    groups[key].push(w);
  }
  // グループ順: 今年→未来→いつか→実現済み
  const groupOrder = Object.keys(groups).sort((a, b) => {
    const order = (k) => {
      if (k === "realized") return 9999;
      if (k === "someday") return 9998;
      return Number(k.replace("by-", "")) || 0;
    };
    return order(a) - order(b);
  });

  return `
    ${renderHeader("やりたいことリスト", "Wish")}
    <section class="panel" style="margin-bottom:12px">
      <div class="row" style="align-items:center; gap:8px; flex-wrap:wrap">
        <strong>実現率</strong>
        <div style="font-size:20px; font-weight:700; color:var(--accent)">${realizedCount} / ${allWishes.length}</div>
        <div class="muted">(${overallRate}%)</div>
        <div class="progress" style="flex:1; min-width:120px"><span style="width:${overallRate}%; background:var(--accent)"></span></div>
      </div>
    </section>

    <section class="form-strip">
      <input id="wishTitle" class="input" placeholder="やりたいこと(壮大でOK)">
      <button class="btn primary" data-action="add-wish">追加</button>
    </section>

    <section class="form-strip" style="margin-top:8px">
      <select id="wishFilterArea" class="select" data-action="wish-filter-area">
        <option value="">全領域</option>
        ${lifeAreas.map((a) => `<option value="${escapeHTML(a.name)}" ${filter.area === a.name ? "selected" : ""}>${escapeHTML(a.name)}</option>`).join("")}
      </select>
      <label class="row" style="gap:6px; align-items:center; padding:0 8px">
        <input type="checkbox" data-action="wish-toggle-realized" ${filter.showRealized ? "checked" : ""}>
        <span class="muted" style="font-size:12px">実現済みも表示</span>
      </label>
    </section>

    ${groupOrder.length === 0
      ? `<section class="panel" style="margin-top:12px; text-align:center; padding:32px"><div class="muted">${filter.area ? `「${escapeHTML(filter.area)}」のやりたいことはまだありません` : "やりたいことを追加してみましょう(壮大なものでもOK)"}</div></section>`
      : groupOrder.map((key) => `
        <section class="section" style="margin-top:14px">
          <div class="row" style="margin-bottom:8px">
            <h3>${wishGroupLabel(key)}</h3>
            <div class="muted">${groups[key].length} 件</div>
          </div>
          <div class="grid">
            ${groups[key].map(renderWishCard).join("")}
          </div>
        </section>
      `).join("")}
  `;
}

// Wish カード(1個)
function renderWishCard(wish) {
  const progress = wishProgress(wish.id);
  const nextStep = nextStepOf(wish.id);
  const stagnant = isWishStagnant(wish.id);
  const areaColor = lifeAreaColor(wish.lifeArea);
  return `
    <div class="panel wish-card ${wish.realized ? "is-realized" : ""}" style="border-left:4px solid ${areaColor}">
      <div class="row" style="align-items:center; gap:8px">
        <div style="flex:1; min-width:0">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap">
            ${wish.realized ? "<span style=\"color:var(--green);font-size:14px\">✓</span>" : ""}
            ${stagnant ? "<span title=\"60日以上動いていません\">🐢</span>" : ""}
            <strong style="${wish.realized ? "text-decoration:line-through; opacity:0.6" : ""}">${escapeHTML(wish.title)}</strong>
            ${wish.lifeArea ? `<span class="chip" style="background:${areaColor}22; color:${areaColor}; border:1px solid ${areaColor}55">${escapeHTML(wish.lifeArea)}</span>` : ""}
          </div>
          ${wish.motivation ? `<div class="muted" style="font-size:11px; margin-top:4px; font-style:italic">"${escapeHTML(wish.motivation)}"</div>` : ""}
        </div>
        <button class="btn ghost" data-action="open-wish" data-id="${wish.id}">${state.wishOpenId === wish.id ? "閉じる" : "開く"}</button>
      </div>

      <div class="row" style="align-items:center; gap:8px; margin-top:8px">
        <div class="muted" style="font-size:12px; white-space:nowrap">${progress.done} / ${progress.total}</div>
        <div class="progress" style="flex:1"><span style="width:${progress.percent}%"></span></div>
        ${nextStep
          ? `<div class="muted" style="font-size:11px; max-width:40%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${escapeHTML(nextStep.title)}">次: ${escapeHTML(nextStep.title)}</div>`
          : (wish.realized ? "" : "<div class=\"muted\" style=\"font-size:11px; color:var(--orange)\">↳ サブタスクを書く</div>")}
      </div>

      ${state.wishOpenId === wish.id ? renderWishDetail(wish) : ""}
    </div>
  `;
}

// Wish 詳細展開(サブタスク・編集)
function renderWishDetail(wish) {
  const subtasks = state.tasks.filter((t) => !t.deleted && t.parentTaskId === wish.id);
  // dueDate あれば優先、なければ createdAt 順
  subtasks.sort((a, b) => {
    if (a.status === "completed" && b.status !== "completed") return 1;
    if (a.status !== "completed" && b.status === "completed") return -1;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });
  const lifeAreas = state.settings.lifeAreas || [];
  const currentYear = new Date().getFullYear();
  const yearOptions = [
    `<option value="" ${!wish.targetYear ? "selected" : ""}>いつか</option>`,
    ...[0, 1, 2, 3, 5, 7, 10, 13, 20, 30].map((d) => {
      const y = currentYear + d;
      return `<option value="${y}" ${wish.targetYear === y ? "selected" : ""}>~${y} (${d === 0 ? "今年" : `あと${d}年`})</option>`;
    })
  ].join("");

  return `
    <div class="wish-detail" style="margin-top:12px; padding-top:12px; border-top:1px solid var(--line)">
      <div class="form-strip" style="margin-bottom:10px">
        <select class="select" data-action="wish-set-year" data-id="${wish.id}" style="flex:1">${yearOptions}</select>
        <select class="select" data-action="wish-set-area" data-id="${wish.id}" style="flex:1">
          <option value="">領域未設定</option>
          ${lifeAreas.map((a) => `<option value="${escapeHTML(a.name)}" ${wish.lifeArea === a.name ? "selected" : ""}>${escapeHTML(a.name)}</option>`).join("")}
        </select>
      </div>

      <div style="margin-bottom:10px">
        <div class="muted" style="font-size:11px; margin-bottom:4px">なぜやりたい(モチベーションの源)</div>
        <textarea class="textarea" data-action="wish-set-motivation" data-id="${wish.id}" rows="2" placeholder="子が小さいうちに3世代で旅したい…">${escapeHTML(wish.motivation || "")}</textarea>
      </div>

      <div class="row" style="margin-bottom:8px; align-items:center">
        <strong>サブタスク</strong>
        <button class="btn ghost" data-action="add-wish-subtask" data-id="${wish.id}">+ 追加</button>
      </div>
      <div class="grid">
        ${subtasks.length === 0
          ? `<div class="muted" style="padding:8px; font-size:12px">最初の一歩を1〜3個書いてみましょう。完璧でなくて大丈夫。</div>`
          : subtasks.map((sub) => renderWishSubtask(sub)).join("")}
      </div>

      <div class="row" style="margin-top:12px; gap:8px; flex-wrap:wrap">
        ${wish.realized
          ? `<button class="btn ghost" data-action="wish-unrealize" data-id="${wish.id}">↩ 未実現に戻す</button>`
          : `<button class="btn primary" data-action="wish-realize" data-id="${wish.id}">🎉 実現済みにする</button>`}
        <button class="btn danger ghost" data-action="delete-wish" data-id="${wish.id}">削除</button>
      </div>
    </div>
  `;
}

// サブタスク1行
function renderWishSubtask(sub) {
  const done = sub.status === "completed";
  return `
    <div class="row" style="gap:8px; align-items:center; padding:6px 8px; border-radius:8px; background:var(--panel-soft)">
      <input type="checkbox" data-action="toggle-wish-subtask" data-id="${sub.id}" ${done ? "checked" : ""}>
      <input type="text" class="input" value="${escapeHTML(sub.title)}" data-action="wish-subtask-title" data-id="${sub.id}" style="flex:1; ${done ? "text-decoration:line-through; opacity:0.6" : ""}">
      ${done
        ? ""
        : `<button class="btn ghost" data-action="wish-subtask-to-tasks" data-id="${sub.id}" title="今日のタスクシュートに登録">📋 今日やる</button>`}
      <button class="btn danger ghost" data-action="delete-task" data-id="${sub.id}" title="削除">✕</button>
    </div>
  `;
}

// =============================================================
// v16: Wish アクション
// =============================================================

function addWish() {
  const titleEl = document.querySelector("#wishTitle");
  const title = titleEl?.value.trim();
  if (!title) return showToast("やりたいことを入力してください");
  const wishProject = getWishProject();
  if (!wishProject) return showToast("Wish Project が見つかりません");
  const task = makeTask({ projectId: wishProject.id, title });
  state.tasks.push(task);
  state.wishOpenId = task.id;  // 追加後すぐに開く
  if (titleEl) titleEl.value = "";
  saveAndRender("やりたいことを追加しました(サブタスクを書いて一歩を)");
}

function toggleWishOpen(id) {
  state.wishOpenId = (state.wishOpenId === id) ? "" : id;
  render();
}

function addWishSubtask(parentTaskId) {
  const title = window.prompt("サブタスク(次の一歩)を入力してください") || "";
  if (!title.trim()) return;
  const parent = state.tasks.find((t) => t.id === parentTaskId);
  if (!parent) return;
  const sub = makeTask({ projectId: parent.projectId, parentTaskId, title: title.trim() });
  state.tasks.push(sub);
  saveAndRender("サブタスクを追加しました");
}

function toggleWishSubtask(id) {
  state.tasks = state.tasks.map((t) => t.id === id
    ? {
        ...t,
        status: t.status === "completed" ? "todo" : "completed",
        updatedAt: nowDateTime()
      }
    : t);
  saveAndRender("");
}

// Wish のサブタスクを今日のタスクシュート(Block)に登録
function wishSubtaskToTasks(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return showToast("タスクが見つかりません");
  // 既に今日の Block 化されていないか
  const exists = state.blocks.find((b) => !b.deleted && b.taskId === taskId && b.date === state.selectedDate);
  if (exists) return showToast("既に今日のタスクシュートにあります");
  // 新規 Block を作成。expectedCharge: 4(やりたいこと=充電源)を推奨値として
  // v29: 予定の開始/終了日時をデフォルトで入れる
  const { plannedStartAt, plannedEndAt } = defaultPlannedTimes();
  const block = makeBlock({
    date: state.selectedDate,
    title: task.title,
    category: task.category || "回復",
    taskId: task.id,
    expectedCharge: 4,
    expectedDischarge: 1,
    plannedStartAt,
    plannedEndAt
  });
  state.blocks.push(block);
  // Task の status を "doing" に
  state.tasks = state.tasks.map((t) => t.id === taskId ? { ...t, status: "doing", updatedAt: nowDateTime() } : t);
  saveAndRender("今日のタスクシュートに登録しました");
}

function realizeWish(id) {
  if (!window.confirm("このやりたいことを「実現済み」にしますか?")) return;
  const today = todayISO();
  state.tasks = state.tasks.map((t) => t.id === id
    ? { ...t, realized: true, realizedDate: today, status: "completed", updatedAt: nowDateTime() }
    : t);
  saveAndRender("🎉 おめでとうございます!実現済みにしました");
}

function unrealizeWish(id) {
  state.tasks = state.tasks.map((t) => t.id === id
    ? { ...t, realized: false, realizedDate: "", status: "todo", updatedAt: nowDateTime() }
    : t);
  saveAndRender("未実現に戻しました");
}

function deleteWish(id) {
  if (!window.confirm("このやりたいこと(およびサブタスク)を削除しますか?")) return;
  // 本体 + 子孫サブタスクをすべて deleted フラグ
  const allIds = new Set([id]);
  // 子孫を再帰的に集める
  const collect = (parentId) => {
    state.tasks.forEach((t) => {
      if (!t.deleted && t.parentTaskId === parentId) {
        allIds.add(t.id);
        collect(t.id);
      }
    });
  };
  collect(id);
  state.tasks = state.tasks.map((t) => allIds.has(t.id) ? { ...t, deleted: true, updatedAt: nowDateTime() } : t);
  if (state.wishOpenId === id) state.wishOpenId = "";
  saveAndRender("削除しました");
}

// 汎用: Task のフィールド更新(saveState のみ、再描画なし)
function updateTaskField(id, field, value) {
  state.tasks = state.tasks.map((t) => t.id === id
    ? { ...t, [field]: value, updatedAt: nowDateTime() }
    : t);
  saveState();
}

// =============================================================
// v17: Avoid List(やらないこと)タブ
// =============================================================

function renderAvoid() {
  const items = state.settings.avoidList || [];
  return `
    ${renderHeader("時間とエネルギーを守る", "やらないこと")}
    <section class="panel" style="margin-bottom:12px">
      <div class="muted" style="font-size:13px; line-height:1.6">
        やりたいことを増やす前に、<strong>やらないこと</strong>を決めるほうが効きます。<br>
        ここに書いたものは「自分との約束」。SNSのだらだら閲覧、夜の暴飲暴食、断れない誘いなど。
      </div>
    </section>

    <section class="form-strip">
      <input id="avoidTitle" class="input" placeholder="やらないことを 1 行で(例: 夜のスマホ、断れない誘い)">
      <button class="btn primary" data-action="add-avoid">追加</button>
    </section>

    <section class="section grid" style="margin-top:14px">
      ${items.length === 0
        ? `<div class="panel muted" style="padding:24px; text-align:center; font-size:13px">
            まだ何も書かれていません。<br>
            「これに時間を使うのを今日からやめる」を 1〜3 個書いてみましょう。
          </div>`
        : items.map((item, idx) => `
          <div class="panel" style="display:flex; align-items:center; gap:12px; padding:10px 14px">
            <span style="color:var(--coral, #FF3B30); font-size:18px; font-weight:700">✕</span>
            <input type="text" class="input" value="${escapeHTML(item.text)}" data-avoid-id="${item.id}" data-avoid-field="text" style="flex:1; border:none; background:transparent">
            <span class="muted" style="font-size:11px; white-space:nowrap">${item.createdAt ? item.createdAt.slice(0, 10) : ""}</span>
            <button class="btn danger ghost" data-action="delete-avoid" data-id="${item.id}" title="削除">✕</button>
          </div>
        `).join("")}
    </section>

    ${items.length > 0 ? `
      <section class="panel muted" style="margin-top:14px; font-size:11px; line-height:1.6; padding:12px">
        💡 ヒント:週に1回見直して、自分との約束を守れているか確認しましょう。<br>
        破ったら自分を責めるのではなく「なぜ破ったか」を観察するのが続けるコツ。
      </section>
    ` : ""}
  `;
}

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

function renderWBS() {
  // v16: Wish Project は WBS から除外(専用「やりたい」タブで表示)
  const activeProjects = state.projects.filter((project) => !project.deleted && project.kind !== "wish");
  const sorted = [...activeProjects].sort((a, b) => a.title.localeCompare(b.title, "ja"));

  // v35: 中断中の項目は既定で非表示。トグルで再表示して再開できる。
  const showSusp = Boolean(state.settings.showSuspended);
  const suspCount = activeProjects.filter(isProjectSuspended).length
    + state.tasks.filter((t) => !t.deleted && t.kind !== "other" && isTaskSuspended(t)
        && !(state.projects.find((p) => p.id === t.projectId)?.kind === "wish")).length;
  const visibleProjects = sorted.filter((p) => showSusp || !isProjectSuspended(p));
  const toggleBtn = (suspCount > 0 || showSusp)
    ? `<button class="btn ${showSusp ? "primary" : "ghost"}" data-action="toggle-show-suspended">${showSusp ? "中断を隠す" : `中断を表示 (${suspCount})`}</button>`
    : "";
  // v47: 完了タスクの表示トグル + 全プロジェクトの一括開閉
  const hideDone = Boolean(state.settings.wbsHideCompleted);
  const allCollapsed = visibleProjects.length > 0 && visibleProjects.every((p) => p.collapsed);
  const wbsTools = `
    <div class="row" style="gap:8px; flex-wrap:wrap">
      <button class="btn ${hideDone ? "primary" : "ghost"}" data-action="toggle-wbs-hide-done">${hideDone ? "完了を表示" : "完了を隠す"}</button>
      <button class="btn ghost" data-action="wbs-collapse-all">${allCollapsed ? "すべて展開" : "すべて折りたたむ"}</button>
      ${toggleBtn}
    </div>`;

  return `
    ${renderHeader("ビジョンを実行へ落とす", "WBS", wbsTools)}
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
      ${visibleProjects.map(renderProjectTree).join("")}
    </section>
  `;
}

// v48: WBS のタスク並び順 — 未完了(期限昇順・期限なしは後ろ)→ 完了は下に沈む
function wbsTaskCompare(a, b) {
  const ac = a.status === "completed", bc = b.status === "completed";
  if (ac !== bc) return ac ? 1 : -1;
  const ad = a.dueDate || "9999", bd = b.dueDate || "9999";
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
          ${aiEnabled() && !suspended ? `<button class="btn ghost" data-action="ai-decompose" data-id="${project.id}" title="AIにタスク分解の候補を出させる(登録は自分で選ぶ)" ${_aiReviewPending ? "disabled" : ""}>🤖 分解</button>` : ""}
          ${suspended
            ? `<button class="btn" data-action="resume-project" data-id="${project.id}">再開</button>`
            : `<button class="btn ghost" data-action="suspend-project" data-id="${project.id}">中断</button>`}
          <button class="btn" data-action="edit-project" data-id="${project.id}">編集</button>
        </div>
      </div>
      ${project.description ? `<div class="muted" style="font-size:12px">${escapeHTML(project.description)}</div>` : ""}
      <div class="progress"><span style="width:${progress}%"></span></div>
      <div class="muted wbs-proj-meta">${doneCount} / ${liveTasks.length} 完了${projDue}</div>
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
  const overdue = task.dueDate && task.dueDate < todayISO() && task.status !== "completed";
  const dueHTML = task.dueDate
    ? `<span class="${overdue ? "wbs-overdue" : "muted"}" style="font-size:11px">期限 ${task.dueDate.slice(5).replace("-", "/")}${overdue ? "!" : ""}</span>`
    : "";
  const scheduledToday = state.blocks.some((b) => !b.deleted && b.taskId === task.id && b.date === todayISO());
  // v48: 子タスクの進捗(2/5)と、この Task に費やした実績(回数・累計時間)
  const kids = state.tasks.filter((t) => !t.deleted && t.parentTaskId === task.id && isTaskCountable(t));
  const kidsDone = kids.filter((t) => t.status === "completed").length;
  const stats = taskBlockStats(task.id);
  return `
    <div class="row${suspended ? " is-suspended" : ""}" style="border-top:1px solid var(--line-soft); padding-top:8px">
      <div class="title-line">
        ${depth > 0 ? `<span class="muted" style="font-size:11px">${"└".padStart(depth, "　")}</span>` : ""}
        ${caret}
        <button class="checkbox-button ${task.status === "completed" ? "done" : ""}" data-action="toggle-task" data-id="${task.id}">✓</button>
        <span data-action="edit-task" data-id="${task.id}" style="cursor:pointer">${escapeHTML(task.title)}</span>
        <span class="badge ${suspended ? "gray" : ""}">${taskStatusLabel(task.status)}</span>
        ${kids.length ? `<span class="badge">子 ${kidsDone}/${kids.length}</span>` : ""}
        ${scheduledToday ? `<span class="badge green">今日✓</span>` : ""}
        ${task.category ? `<span class="cat-chip" style="background:${getCategoryColor(task.category)}1f; color:${getCategoryColor(task.category)}; border:1px solid ${getCategoryColor(task.category)}66">${escapeHTML(task.category)}</span>` : ""}
        ${dueHTML}
        ${stats.count ? `<span class="muted" style="font-size:11px">⏱ ${stats.count}回${stats.minutes ? `・${fmtMinShort(stats.minutes)}` : ""}</span>` : ""}
      </div>
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
    ${aiMitChips()}
    ${carryOverPanel()}
    ${aiEnabled() ? `<div class="row" style="margin-bottom:10px; flex-wrap:wrap; gap:8px">
      ${state.selectedDate === todayISO() ? `<button class="btn" data-action="ai-today-suggest" ${_aiReviewPending ? "disabled" : ""}>${_aiReviewPending ? "⏳ AI実行中…" : "🤖 今日のタスク提案"}</button>` : ""}
      <button class="btn" data-action="ai-schedule" ${_aiReviewPending ? "disabled" : ""}>${_aiReviewPending ? "⏳ AI実行中…" : "🤖 空き時間に下書きスケジュール"}</button>
      <span class="muted" style="font-size:11.5px">提案=昨日の日報から今日の候補 / 下書き=空きに仮配置→ドラッグ調整→確定</span>
    </div>` : ""}
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
      <div class="grid">
        ${renderOpenTasks()}
      </div>
    </section>
  `;
}

function renderOpenTasks() {
  // v19: 今日に既に Block 化されていても表示し続ける(1日に複数回追加することもあるため)
  // v28: 「その他」受け皿 Task は実体のあるタスクではないので未完了リストから除外
  // v35: 中断・中止したタスクは未完了リストから外す(途中でやめたものを残さない)
  // v37: Wish Project 配下のタスクは専用「やりたい」タブで扱うため、ここには出さない
  //      (WBS・ホームの未完了リストと同じ除外基準に揃える)
  const wishProjectIds = state.projects.filter((p) => p.kind === "wish").map((p) => p.id);
  const open = state.tasks.filter((task) => !task.deleted && !isTaskDead(task) && task.kind !== "other"
    && !wishProjectIds.includes(task.projectId));
  if (!open.length) return emptyPanel("未完了のTaskはありません");
  // 今日 Block 化済みのカウント(参考表示用)
  const blockCountByTaskId = {};
  state.blocks
    .filter((b) => !b.deleted && b.date === state.selectedDate)
    .forEach((b) => {
      if (b.taskId) blockCountByTaskId[b.taskId] = (blockCountByTaskId[b.taskId] || 0) + 1;
    });
  return open.map((task) => {
    const dueLabel = task.dueDate ? ` / 期限 ${task.dueDate}` : "";
    const isOverdue = task.dueDate && task.dueDate < state.selectedDate;
    const todayCount = blockCountByTaskId[task.id] || 0;
    return `
      <div class="item" ${isOverdue ? 'style="background:var(--red-soft)"' : ""}>
        <div class="row">
          <div style="min-width:0; flex:1">
            <strong>${escapeHTML(task.title)}</strong>
            <div class="muted" style="font-size:12px">${escapeHTML(projectName(task.projectId))} / ${escapeHTML(task.category || "カテゴリなし")}${dueLabel}${todayCount > 0 ? ` <span style="color:var(--green); font-weight:600">/ 本日 ${todayCount} 件 Block 追加済み</span>` : ""}</div>
          </div>
          <div class="row">
            <button class="btn" data-action="task-today" data-id="${task.id}">今日へ追加</button>
            <button class="btn ghost" data-action="suspend-task" data-id="${task.id}">中断</button>
            <button class="btn" data-action="edit-task" data-id="${task.id}">編集</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
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
      <button class="checkbox-button ${block.completed ? "done" : ""}" data-action="toggle-block" data-id="${block.id}">✓</button>
      <div class="stack">
        <div class="title-line">
          ${isMIT ? `<span class="mit-star" title="今日の主役" style="color:#F5A623; font-weight:700">★</span>` : ""}
          <strong data-action="edit-block" data-id="${block.id}" style="cursor:pointer">${escapeHTML(block.title)}</strong>
          <span class="badge ${block.completed ? "green" : "blue"}">${start}${end ? `-${end}` : ""}</span>
          ${doing ? `<span class="badge orange">着手中 ${timeFromDateTime(block.actualStartAt)}〜</span>` : ""}
          ${task ? `<span class="badge">${escapeHTML(projectName(task.projectId))}</span>` : `<span class="badge orange">単発</span>`}
          ${block.category ? `<span class="cat-chip" style="background:${catColor}1f; color:${catColor}; border:1px solid ${catColor}66">${escapeHTML(block.category)}</span>` : ""}
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

function renderTimelineView() {
  const nowMinute = (new Date().getHours() + 1) * 60;
  const mode = state.timelineMode || "planned";
  return `
    ${renderHeader("時間軸とエネルギー", "タイムライン")}
    ${renderDateBar()}
    <div class="segmented" style="margin-bottom:10px">
      <button class="${mode === "planned" ? "active" : ""}" data-action="timeline-mode" data-mode="planned">📅 予定</button>
      <button class="${mode === "actual" ? "active" : ""}" data-action="timeline-mode" data-mode="actual">✅ 実績</button>
    </div>
    <div class="row" style="margin-bottom:10px; gap:8px; flex-wrap:wrap">
      <button class="btn primary" data-action="timeline-new-block" data-minute="${nowMinute}">+ 新規Block</button>
      ${aiEnabled() && !_scheduleDraft ? `<button class="btn" data-action="ai-schedule" ${_aiReviewPending ? "disabled" : ""}>${_aiReviewPending ? "⏳ AI実行中…" : "🤖 下書きスケジュール"}</button>` : ""}
      <span class="muted" style="font-size:12px">空き時間タップで追加 / ○タップで完了登録 / カードタップで編集 / 赤線は現在時刻</span>
    </div>
    ${draftBarHTML()}
    ${state.settings.timelineCategoryFilter ? `<div class="row" style="margin-bottom:10px; gap:8px; align-items:center">
      <span class="cat-chip" style="background:${getCategoryColor(state.settings.timelineCategoryFilter)}1f; color:${getCategoryColor(state.settings.timelineCategoryFilter)}; border:1px solid ${getCategoryColor(state.settings.timelineCategoryFilter)}66">カテゴリ: ${escapeHTML(state.settings.timelineCategoryFilter)}</span>
      <button class="btn ghost" data-action="timeline-clear-cat" style="font-size:12px">フィルタ解除 ✕</button>
    </div>` : ""}
    ${renderTimeline({ compact: false, mode })}
  `;
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
    return { ...b, startMin, endMin, phase };
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

  return `
    ${renderHeader("今やること、次にやること", "ルーティン")}
    ${renderDateBar()}
    ${dayChip}

    <div class="segmented" style="margin-bottom:14px">
      <button class="${viewMode === "routine" ? "active" : ""}" data-action="routine-mode" data-mode="routine">↻ ルーティンのみ</button>
      <button class="${viewMode === "all" ? "active" : ""}" data-action="routine-mode" data-mode="all">↻+📅 ルーティン+予定</button>
    </div>

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
          <span class="muted" style="font-size:11px">${phaseLabel}</span>
        </div>
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



function setTimelineMode(mode) {
  state.timelineMode = mode;
  persistLocalNoSchedule();  // v37: 表示モード切替は UI 操作(dataModifiedAt を汚さない)
  render();
}

function renderTimeline({ compact, mode = "planned" }) {
  const allBlocks = blocksForDate(state.selectedDate);
  // モードに応じてフィルタリングと表示位置決定
  let blocksToRender;
  if (mode === "actual") {
    blocksToRender = allBlocks.filter((b) => b.actualStartAt);
  } else {
    // 予定モード: 未完了 + plannedStartAt あり(完了済みは予定から消す)
    blocksToRender = allBlocks.filter((b) => b.plannedStartAt && !b.completed);
  }
  // v19: カテゴリ「ルーティン」は専用ルーティンタブで表示するためタイムラインから除外
  blocksToRender = blocksToRender.filter((b) => b.category !== "ルーティン");
  // v39: エネルギー構造分析からのカテゴリフィルタ(UI状態)
  const catFilter = state.settings.timelineCategoryFilter || "";
  if (catFilter) blocksToRender = blocksToRender.filter((b) => (b.category || "未分類") === catFilter);
  // v10: ズームレベル(state.timelineZoom: 1.0 / 2.0 / 4.0 のいずれか)
  const zoom = compact ? 1 : (state.timelineZoom || 1);
  const rowHeight = (compact ? 48 : 60) * zoom;
  const startHour = 5;
  const endHour = 24;
  const rows = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
  // v10: レーン分割(PC 5、iPhone 3)
  const maxLanes = (typeof window !== "undefined" && window.innerWidth <= 720) ? 3 : 5;
  const laneAssignments = assignBlocksToLanes(blocksToRender, mode, maxLanes);
  // v10: 同レーン内で物理位置が重ならないよう top を調整
  const positioned = adjustLaneTopPositions(laneAssignments, rowHeight, startHour);
  // v10: ズームコントロール(コンパクトモードでは出さない)
  const zoomControls = compact ? "" : `
    <div class="tl-zoom-controls">
      <button class="btn ghost ${zoom === 1 ? "active" : ""}" data-action="tl-zoom" data-zoom="1">1x</button>
      <button class="btn ghost ${zoom === 2 ? "active" : ""}" data-action="tl-zoom" data-zoom="2">2x</button>
      <button class="btn ghost ${zoom === 4 ? "active" : ""}" data-action="tl-zoom" data-zoom="4">4x</button>
    </div>
  `;

  // v19: 現在時刻ライン(本日表示時のみ)
  const now = new Date();
  const isToday = state.selectedDate === todayISO();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = isToday && nowMinutes >= startHour * 60 && nowMinutes < endHour * 60
    ? ((nowMinutes - startHour * 60) / 60) * rowHeight
    : null;
  const nowLine = nowTop !== null ? `
    <div class="now-line" style="position:absolute; top:${nowTop}px; left:0; right:0; height:0; border-top:2px solid #FF3B30; z-index:5; pointer-events:none">
      <span style="position:absolute; left:0; top:-10px; background:#FF3B30; color:#fff; font-size:10px; padding:1px 6px; border-radius:8px; font-weight:700">${pad2(now.getHours())}:${pad2(now.getMinutes())}</span>
    </div>
  ` : "";

  return `
    ${zoomControls}
    <div class="timeline" style="position:relative; min-height:${rowHeight * (endHour - startHour + 1)}px">
      ${rows.map((hour) => `
        <div class="time-row" data-action="timeline-new-block" data-minute="${hour * 60}"
             style="top:${(hour - startHour) * rowHeight}px;height:${rowHeight}px; cursor:pointer;">${String(hour).padStart(2, "0")}:00</div>
      `).join("")}
      <div class="timeline-cards-area" style="position:absolute; top:0; left:60px; right:100px; height:100%;">
        ${positioned.map((a) => renderTimelineCard(a, mode, maxLanes)).join("")}
      </div>
      ${nowLine}
      ${!compact && mode === "planned" ? renderDraftLayer(rowHeight, startHour) : ""}
      ${renderEnergyGraph(allBlocks, rowHeight, startHour, endHour)}
    </div>
  `;
}

// v26: Block をレーンに割り当てる。重なり合うブロック群(クラスタ)ごとに
// 使用レーン数 laneCount を求め、横幅 = 100/laneCount で配置できるようにする。
// (重なりが無ければ laneCount=1 で全幅、2つ重なれば 2 で 50:50)
function assignBlocksToLanes(blocks, mode, maxLanes) {
  // 開始時刻でソート(同じ時刻なら短いもの優先)
  const sorted = [...blocks]
    .map((b) => {
      const startStr = mode === "actual" ? b.actualStartAt : b.plannedStartAt;
      const endStr = mode === "actual" ? (b.actualEndAt || nowDateTime()) : (b.plannedEndAt || null);
      if (!startStr) return null;
      const start = minutesOf(startStr);
      const end = endStr ? minutesOf(endStr) : start + 1;  // 終了未定なら最低1分
      return { block: b, start, end: Math.max(end, start + 1), startStr, endStr };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start));

  const result = [];
  let cluster = [];          // 現在のクラスタの項目(lane 付与済み)
  let clusterLaneEnds = [];  // クラスタ内・各レーンの終了時刻(分)
  let clusterMaxEnd = -1;    // クラスタ内の最遅終了時刻

  const flushCluster = () => {
    const laneCount = Math.max(1, clusterLaneEnds.length);
    for (const it of cluster) result.push({ ...it, laneCount });
    cluster = [];
    clusterLaneEnds = [];
    clusterMaxEnd = -1;
  };

  for (const item of sorted) {
    // 現クラスタのどのブロックとも重ならない(全て終了済み)なら、クラスタを確定
    if (clusterMaxEnd >= 0 && item.start >= clusterMaxEnd) {
      flushCluster();
    }
    // クラスタ内で空いているレーン(終了 ≤ 自分の開始)を探す
    let lane = -1;
    for (let i = 0; i < clusterLaneEnds.length; i++) {
      if (clusterLaneEnds[i] <= item.start) { lane = i; break; }
    }
    let isOverflow = false;
    if (lane === -1) {
      if (clusterLaneEnds.length < maxLanes) {
        lane = clusterLaneEnds.length;     // 新しいレーンを追加
        clusterLaneEnds.push(-1);
      } else {
        lane = maxLanes - 1;               // 上限超過: 最後のレーンに重ねる
        isOverflow = true;
      }
    }
    clusterLaneEnds[lane] = Math.max(clusterLaneEnds[lane], item.end);
    clusterMaxEnd = Math.max(clusterMaxEnd, item.end);
    cluster.push({ ...item, lane, isOverflow });
  }
  flushCluster();
  return result;
}

// v15: 開始時刻 = top を厳守(レーンによる補正・連続重なりの縦ずらしを撤廃)
// 同じ開始時刻なら必ず同じ高さに表示される
// 異なる開始時刻なら、その時刻通りの top に配置される(階段表示=時刻違いの可視化)
function adjustLaneTopPositions(assignments, rowHeight, startHour) {
  return assignments.map((a) => {
    const top = ((a.start - startHour * 60) / 60) * rowHeight;
    const durationMin = a.end - a.start;
    const isShort = durationMin < 5;
    const minHeight = isShort ? 14 : 38;
    const height = Math.max(minHeight, (durationMin / 60) * rowHeight);
    return { ...a, top, height, isShort };
  });
}

function renderTimelineCard(positioned, mode = "planned", maxLanes = 5) {
  const { block, startStr, endStr, lane, isOverflow, top, height, isShort, laneCount } = positioned;

  // v26: 横幅は「同時に重なっているブロック数(クラスタのレーン数)」で決まる。
  // 重なり無し → laneCount 1 → 全幅 / 2つ重なり → 2 → 50:50
  const lanes = Math.max(1, laneCount || 1);
  const widthPercent = 100 / lanes;
  const leftPercent = lane * widthPercent;

  const isActual = mode === "actual";
  // カテゴリ色を反映
  const catColor = block.category ? getCategoryColor(block.category) : null;
  const catStyle = catColor
    ? `background:${catColor}29; border-left:4px solid ${catColor}; color:${catColor};`
    : "";
  const overflowAttr = isOverflow ? `data-overflow="true"` : "";

  return `
    <div class="timeline-card ${block.completed ? "completed" : ""} ${isActual ? "is-actual" : ""} ${isShort ? "is-short" : ""}"
         ${overflowAttr}
         style="top:${top}px; height:${height}px; left:${leftPercent}%; width:calc(${widthPercent}% - 4px); ${catStyle}"
         data-action="edit-block" data-id="${block.id}">
      ${!isActual && !isShort ? `<button class="tl-complete-btn" data-action="complete-block-with-actual" data-id="${block.id}" aria-label="完了登録">○</button>` : ""}
      <div class="tl-card-body">
        <strong>${escapeHTML(block.title)}</strong>
      </div>
    </div>
  `;
}

function renderEnergyGraph(allBlocks, rowHeight, startHour, endHour) {
  const morning = state.settings.morningEnergyLog[state.selectedDate] ?? 5;
  const totalHeight = rowHeight * (endHour - startHour + 1);
  const startMinute = startHour * 60;
  const endMinute = endHour * 60;

  // 完了 Block を actualEndAt 順にソート(実線=実績)
  const completed = allBlocks
    .filter((b) => b.completed && b.actualEndAt)
    .sort((a, b) => a.actualEndAt.localeCompare(b.actualEndAt));

  // 累積実績点列
  const realPoints = [{ minute: 0, value: morning }];
  let cumulative = morning;
  for (const b of completed) {
    cumulative += Number(b.charge || 0) - Number(b.discharge || 0);
    realPoints.push({ minute: minutesOf(b.actualEndAt), value: cumulative });
  }
  // 現在時刻まで延伸
  const today = todayISO();
  if (state.selectedDate === today) {
    const now = new Date();
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    realPoints.push({ minute: nowMinute, value: cumulative });
  } else {
    // 過去日付なら 24:00 まで延伸
    realPoints.push({ minute: endMinute, value: cumulative });
  }

  // 予測点列(未完了 Block の planned ベース、expected_charge/discharge 使うが無ければ通常の charge/discharge を予測値として使う)
  const isToday = state.selectedDate === today;
  const futureBlocks = allBlocks
    .filter((b) => !b.completed && b.plannedEndAt)
    .sort((a, b) => a.plannedEndAt.localeCompare(b.plannedEndAt));
  const predictPoints = [];
  if (isToday && futureBlocks.length > 0) {
    let predict = cumulative;
    const now = new Date();
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    predictPoints.push({ minute: nowMinute, value: predict });
    for (const b of futureBlocks) {
      const ec = Number(b.expectedCharge ?? b.charge ?? 0);
      const ed = Number(b.expectedDischarge ?? b.discharge ?? 0);
      predict += ec - ed;
      predictPoints.push({ minute: minutesOf(b.plannedEndAt), value: predict });
    }
  }

  // X 軸スケール: 値を -maxAbs 〜 +maxAbs にマップ
  const allValues = [...realPoints, ...predictPoints].map((p) => Math.abs(p.value));
  const maxAbs = Math.max(20, ...allValues);
  // SVG viewBox 100x{totalHeight}、中央 x=50
  const yOf = (minute) => Math.min(totalHeight, Math.max(0, ((minute - startMinute) / (endMinute - startMinute)) * totalHeight));
  const xOf = (value) => 50 + (value / maxAbs) * 45;

  const polyline = (pts, dashed) => {
    if (pts.length < 2) return "";
    const points = pts.map((p) => `${xOf(p.value)},${yOf(p.minute)}`).join(" ");
    return `<polyline points="${points}" stroke="${dashed ? '#7b61ff' : '#2fb96d'}" stroke-width="1.5" fill="none" stroke-linejoin="round" ${dashed ? 'stroke-dasharray="3,2"' : ""}/>`;
  };
  const circles = (pts, color) =>
    pts.map((p) => `<circle cx="${xOf(p.value)}" cy="${yOf(p.minute)}" r="1.8" fill="${color}"/>`).join("");

  const endValue = realPoints[realPoints.length - 1]?.value ?? morning;

  return `
    <svg class="energy-svg" viewBox="0 0 100 ${totalHeight}" preserveAspectRatio="none"
         style="position:absolute; top:0; right:0; width:90px; height:${totalHeight}px; pointer-events:none;">
      <line x1="50" y1="0" x2="50" y2="${totalHeight}" stroke="#D1D1D6" stroke-width="0.4" stroke-dasharray="2,2"/>
      ${polyline(realPoints, false)}
      ${polyline(predictPoints, true)}
      ${circles(realPoints, "#2fb96d")}
    </svg>
    <div style="position:absolute; top:2px; right:2px; font-size:9px; color:var(--faint); pointer-events:none;">エネルギー</div>
    <div style="position:absolute; top:16px; right:2px; font-size:9px; color:var(--faint); pointer-events:none;">起点 ${morning}</div>
    <div style="position:absolute; bottom:2px; right:2px; font-size:9px; color:var(--green); pointer-events:none;">終値 ${endValue >= 0 ? '+' : ''}${endValue}</div>
  `;
}

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
  return `
    ${renderHeader("集中タイマー", "ポモドーロ", `<button class="btn" data-action="toggle-pomo-fullscreen">⛶ 全画面</button>`)}
    <div class="segmented" style="margin-bottom:14px">
      <button class="${pomoTab === "manual" ? "active" : ""}" data-action="pomo-tab" data-tab="manual">任意タイマー</button>
      <button class="${pomoTab === "passive" ? "active" : ""}" data-action="pomo-tab" data-tab="passive">常時タイマー</button>
    </div>
    ${pomoTab === "manual" ? renderManualPomodoro(running, remaining, blockOptions) : renderPassivePomodoro()}
  `;
}

// v12: ポモドーロ全画面モード(背景動画 + 半透明フィルタ + 中央タイマー)
function renderPomodoroFullscreen(running, remaining, blockOptions, pomoTab) {
  return `
    <div class="pomo-fullscreen" id="pomoFullscreen">
      <video class="pomo-bg-video" autoplay muted loop playsinline poster="">
        <source src="./study_with_me.mp4" type="video/mp4">
      </video>
      <div class="pomo-bg-overlay"></div>
      <div class="pomo-fullscreen-content">
        <button class="pomo-fullscreen-close" data-action="toggle-pomo-fullscreen" aria-label="全画面を解除" title="全画面を解除">✕</button>
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
    const endsAtMs = state.pomodoro.endsAt ? new Date(state.pomodoro.endsAt).getTime() : 0;
    const startedAtMs = state.pomodoro.startedAt ? new Date(state.pomodoro.startedAt).getTime() : 0;
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
    const endsAtMs = new Date(state.pomodoro.endsAt).getTime();
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
            <div style="font-size:13px; font-weight:700; color:var(--orange)">☕️ 休憩中</div>
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
    const startedAtMs = new Date(state.pomodoro.startedAt).getTime();
    const totalMs = endsAtMs - startedAtMs;
    const progress = 1 - remainingMs / totalMs;
    return `
      <section class="panel" style="display:grid; place-items:center; min-height:380px; padding:24px">
        ${renderCircularProgress(progress, remaining, "var(--accent)")}
        <div style="text-align:center; margin-top:14px">
          <div class="muted" style="font-size:12px">作業中(50:00 → 00:00 を 2 倍速で進行)</div>
          ${currentBlock ? `<div style="margin-top:4px; font-weight:700">${escapeHTML(currentBlock.title)}</div>` : ""}
        </div>
        <div style="margin-top:18px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap">
          <button class="btn green" data-action="complete-pomodoro">✓ 完了</button>
          <button class="btn orange" data-action="go-break">☕ 休憩へ</button>
          <button class="btn danger" data-action="stop-pomodoro">中断</button>
        </div>
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


// v38: 朝の体調ピッカー(ジャーナル当日編集の上部)。
//      記録するとエネルギーグラフの始点と、ジャーナル本文の「朝の体調」行に反映される。
//      これまで setMorningEnergy は存在するのに呼び出すUIがなく、常に既定値(5)だった。
function renderMorningEnergyPicker(date) {
  const current = state.settings.morningEnergyLog?.[date];
  return `
    <div class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:10px; align-items:center">
      <span class="muted" style="font-size:12.5px; font-weight:700">🌅 朝の体調</span>
      ${energyLevels.map((l) => `
        <button class="btn ${current === l.value ? "primary" : "ghost"}" style="font-size:12px; padding:6px 10px"
          data-action="set-morning" data-value="${l.value}">${l.label}</button>
      `).join("")}
      ${current === undefined ? `<span class="muted" style="font-size:11px">未記録(タップで記録 → エネルギーグラフの始点になります)</span>` : ""}
    </div>
  `;
}

function renderJournal() {
  ensureJournal(state.selectedDate);
  const previous = addDays(state.selectedDate, -1);
  const date = state.selectedDate;
  // AIフィードバックは git ファイル(優先)→ なければ localStorage の textarea
  const feedbackFromFile = cachedFeedback[date];
  const feedbackFromState = state.feedback[date] || "";
  const feedbackText = feedbackFromFile || feedbackFromState;
  const feedbackFromFilePrev = cachedFeedback[previous];
  return `
    ${renderHeader("過去の自分・今の自分・外部視点", "ジャーナル")}
    ${renderDateBar()}
    <section class="journal-grid">
      <div class="panel">
        <h2>📓 前日 (${previous})</h2>
        <div class="md-render readonly-md">${renderMarkdown(state.journals[previous] || "記載なし")}</div>
      </div>
      <div class="panel">
        <div class="row" style="margin-bottom:10px">
          <h2>📝 当日編集</h2>
          <div class="row">
            <button class="btn primary" data-action="generate-report">📊 日報を生成</button>
            ${(state.settings.github?.token && state.settings.github?.owner) ? `<button class="btn" data-action="push-report">📤 GitHubに日報push</button>` : ""}
          </div>
        </div>
        ${renderMorningEnergyPicker(date)}
        <details class="journal-prompts" style="margin-bottom:10px; padding:8px 12px; background:var(--panel-soft); border-radius:8px">
          <summary style="cursor:pointer; font-size:13px; color:var(--muted); font-weight:600">💡 思考のヒント(クリックで開閉)</summary>
          <div style="margin-top:10px; display:grid; gap:10px; font-size:12px">
            ${Object.entries(JOURNAL_PROMPTS).map(([section, prompt]) => `
              <div>
                <div style="font-weight:600; color:var(--text); margin-bottom:2px">${section}</div>
                <div class="muted" style="white-space:pre-line; line-height:1.5">${escapeHTML(prompt)}</div>
              </div>
            `).join("")}
          </div>
        </details>
        <textarea class="textarea" data-journal-date="${date}">${escapeHTML(state.journals[date])}</textarea>
      </div>
      <div class="panel">
        <div class="row" style="margin-bottom:10px">
          <h2>🤖 AIフィードバック</h2>
          <label class="btn ghost" style="font-size:12px; padding:6px 10px; cursor:pointer">
            📤 .mdアップロード
            <input type="file" accept=".md,text/markdown,text/plain" data-feedback-upload="${date}" hidden>
          </label>
        </div>
        ${feedbackFromFile ? `
          <div class="vision-source" style="margin-bottom:6px">📄 <code>AIフィードバック_${date}.md</code> から読込</div>
          <div class="md-render readonly-md">${renderMarkdown(feedbackFromFile)}</div>
        ` : `
          <textarea class="textarea" data-feedback-date="${date}" placeholder="外部AIの返答をここに貼り付け、または上のボタンで .md ファイルをアップロード">${escapeHTML(feedbackFromState)}</textarea>
        `}
        <div class="row" style="margin-top:8px; flex-wrap:wrap; gap:6px">
          ${aiReviewButton()}
          <button class="btn ghost" data-action="journal-import-ai" data-date="${date}" style="font-size:12px">🤖 AI返信から取り込み(テーマ/MIT/問い)</button>
        </div>
        ${feedbackFromFilePrev && previous !== date ? `
          <details style="margin-top:14px">
            <summary class="muted" style="cursor:pointer; font-size:12px">前日(${previous})のフィードバックも見る</summary>
            <div class="md-render readonly-md" style="margin-top:6px; opacity:0.85">${renderMarkdown(feedbackFromFilePrev)}</div>
          </details>
        ` : ""}
      </div>
    </section>
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

function renderVisionBoard() {
  const boards = [
    { name: "今(33歳)", file: "now_vision.pdf" },
    { name: "45歳", file: "45_vision.pdf" },
    { name: "80歳", file: "80_vision.pdf" }
  ];
  const idx = clamp(state.settings.visionBoardIndex || 0, 0, boards.length - 1);
  const current = boards[idx];
  const src = `./${current.file}`;
  return `
    <div class="vision-pdf-tabs">
      ${boards.map((b, i) => `
        <button class="${i === idx ? "active" : ""}" data-action="vision-board-tab" data-index="${i}">${escapeHTML(b.name)}</button>
      `).join("")}
    </div>
    <div class="vision-actions" style="margin-bottom:8px">
      <span class="vision-source">📄 <code>${current.file}</code></span>
      <a class="btn primary" href="${src}" target="_blank" rel="noopener">📂 別タブで開く</a>
    </div>
    <object data="${src}#view=FitH" type="application/pdf" class="vision-pdf-frame" aria-label="${escapeHTML(current.name)}">
      <div class="pdf-fallback">
        <p>このブラウザではPDFをインライン表示できません。</p>
        <p>上の <strong>「📂 別タブで開く」</strong> ボタンから表示してください。</p>
        <p style="margin-top:12px"><a class="btn primary" href="${src}" target="_blank" rel="noopener">${escapeHTML(current.name)} を開く</a></p>
      </div>
    </object>
  `;
}

// v37: marked の出力から危険な要素・属性を取り除く。
//      ジャーナルやAIフィードバック(貼り付け/アップロード/GitHub同期)経由の
//      HTMLがそのまま実行されると、localStorage のトークン窃取まで可能になるため。
//      見出し・リスト・強調などの安全なHTMLはそのまま残す。
function sanitizeHTML(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const BLOCKED_TAGS = ["SCRIPT", "IFRAME", "OBJECT", "EMBED", "STYLE", "LINK", "META", "FORM", "BASE"];
  const walk = (node) => {
    for (const el of [...node.querySelectorAll("*")]) {
      if (BLOCKED_TAGS.includes(el.tagName)) { el.remove(); continue; }
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const val = String(attr.value || "").replace(/\s+/g, "").toLowerCase();
        if (name.startsWith("on")) el.removeAttribute(attr.name);                       // onerror= 等
        else if ((name === "href" || name === "src" || name === "xlink:href")
          && (val.startsWith("javascript:") || val.startsWith("data:text/html"))) {
          el.removeAttribute(attr.name);
        }
      }
    }
  };
  walk(template.content);
  return template.innerHTML;
}

function renderMarkdown(text) {
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
  return `
    ${renderHeader("生成AIへ渡す素材", "日報")}
    ${renderDateBar()}
    <div class="row" style="margin-bottom:12px; flex-wrap:wrap; gap:8px">
      <button class="btn primary" data-action="generate-report">日報を生成</button>
      ${report ? aiReviewButton() : ""}
      ${report ? `<button class="btn" data-action="report-copy-ai">📋 AI用にコピー</button>` : ""}
      ${report && typeof navigator !== "undefined" && navigator.share ? `<button class="btn" data-action="report-share-ai">↗ 共有</button>` : ""}
      <button class="btn" data-action="download-report">Markdown保存</button>
    </div>
    ${report ? `<div class="muted" style="font-size:11.5px; margin-bottom:10px; line-height:1.6">「🤖 AIレビュー実行」でこの日報を Claude API へ直接送り、返信をジャーナルの「AIフィードバック」に自動反映します(テーマ/MIT候補/問い候補の取り込みモーダルも自動で開きます)。コピー/共有 → 手貼りの経路もそのまま使えます。</div>` : ""}
    <textarea class="textarea report-output" readonly>${escapeHTML(report || "まだ日報がありません。")}</textarea>
  `;
}

function renderSettings() {
  const github = state.settings.github || defaultGitHubSettings();
  return `
    ${renderHeader("Web版の保存と公開", "設定")}
    <section class="settings-grid">
      <div class="panel stack">
        <h2>プロフィール</h2>
        <label>生年月日
          <input class="input" type="date" data-setting-field="birthDate" value="${escapeHTML(state.settings.birthDate || "")}">
        </label>
        <label>12WY開始日
          <input class="input" type="date" data-setting-field="twelveWeekStartDate" value="${state.settings.twelveWeekStartDate || todayISO()}">
        </label>
      </div>
      <div class="panel stack">
        <h2>データ</h2>
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
      </div>
      <div class="panel stack">
        <h2>クラウド保存(GitHub)</h2>
        <div class="muted" style="font-size:12px; line-height:1.6">
          データは端末内(localStorage)を主とし、GitHub 上の 1 ファイルを端末間の同期・バックアップに使います。<br>
          自動保存を ON にすると変更後 30 秒で push。起動時に GitHub 側が新しければ自動で取り込みます(新しい方を採用)。
        </div>
        <form class="stack" autocomplete="on" onsubmit="return false">
          <label>Owner
            <input class="input" data-github-field="owner" value="${escapeHTML(github.owner)}"
              id="gh-owner" name="gh-username" autocomplete="username"
              autocapitalize="off" autocorrect="off" spellcheck="false">
          </label>
          <label>Repository
            <input class="input" data-github-field="repo" value="${escapeHTML(github.repo)}" autocomplete="off">
          </label>
          <label>Branch
            <input class="input" data-github-field="branch" value="${escapeHTML(github.branch)}" autocomplete="off">
          </label>
          <label>保存先パス
            <input class="input" data-github-field="path" value="${escapeHTML(github.path)}" autocomplete="off" placeholder="app-state.json">
          </label>
          <div class="muted" style="font-size:11px">推奨: <code>app-state.json</code>(リポジトリのルート直下)</div>
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
      </div>
      <div class="panel stack">
        <h2>AIレビュー(Anthropic API)</h2>
        <div class="muted" style="font-size:12px; line-height:1.6">
          日報の「🤖 AIレビュー実行」ボタンで Claude API を直接呼び、フィードバックをジャーナルに自動反映します。<br>
          従量課金です(<a href="https://console.anthropic.com/" target="_blank" rel="noopener">Anthropic Console</a> でAPIキーを発行し、クレジットを事前チャージ。最低 $5)。
        </div>
        <form class="stack" autocomplete="on" onsubmit="return false">
          <label>APIキー
            <input class="input" type="password" data-ai-field="apiKey" value="${escapeHTML(state.settings.ai?.apiKey || "")}"
              id="ai-api-key" name="anthropic-api-key" autocomplete="current-password"
              autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="sk-ant-...">
          </label>
        </form>
        <label>モデル
          <select class="input" data-ai-field="model">
            ${AI_MODELS.map((m) => `<option value="${m.id}" ${(state.settings.ai?.model || "claude-opus-4-8") === m.id ? "selected" : ""}>${escapeHTML(m.label)}</option>`).join("")}
          </select>
        </label>
        <div class="muted" style="font-size:11px; line-height:1.6">
          🔒 APIキーはこの端末のブラウザ内にのみ保存します。GitHub同期・JSONエクスポートには含まれません。<br>
          月額目安は「毎日1回の日報レビュー(入力2〜4千トークン+出力0.5〜1.5千トークン)」での概算です。
        </div>
        <label class="checkbox-line">
          <input type="checkbox" data-ai-automorning ${state.settings.ai?.autoMorningReview ? "checked" : ""}>
          🌅 朝イチ自動レビュー(日付が変わって最初に開いた時、昨日の日報レビューを自動実行)
        </label>
        <details>
          <summary style="cursor:pointer; font-size:13px; font-weight:700">🛠 プロンプト設定(上級)</summary>
          <div class="stack" style="margin-top:10px">
            <div class="muted" style="font-size:11.5px; line-height:1.6">
              すべてのAI機能に共通で付く「私について」と、機能別の指示部を編集できます。
              出力フォーマット(JSON・見出し)はアプリが解析するため固定で、ここには含まれません。空にすればその部分は送られません。
            </div>
            ${[
              ["context", "共通コンテキスト(私について — 全AI機能の冒頭に付く)"],
              ["custom", "カスタム指示(文体・トーンなどの追加指示)"],
              ["decompose", "WBSタスク分解の指示"],
              ["schedule", "スケジュール下書きの指示"],
              ["todaySuggest", "今日のタスク提案の指示"]
            ].map(([key, label]) => `
              <label>${label}
                <textarea class="textarea" data-ai-prompt="${key}" style="min-height:110px; font-size:12px">${escapeHTML(aiPrompt(key))}</textarea>
              </label>
              <button class="btn ghost" data-action="ai-prompt-reset" data-key="${key}" style="font-size:11.5px; align-self:flex-start">↺ 既定に戻す</button>
            `).join("")}
          </div>
        </details>
      </div>
      <div class="panel stack">
        <h2>現在のファイル構成</h2>
        <pre style="background:var(--panel-soft); padding:10px; border-radius:6px; font-size:11px; overflow-x:auto; margin:0">リポジトリ直下:
├── app-state.json          ← メインデータ(自動保存先)
├── Vision.md
├── Daily_Affirmation.md
├── now_vision.pdf
├── 45_vision.pdf
└── 80_vision.pdf</pre>
        <div class="muted" style="font-size:11px">
          現状はすべてリポジトリのルート直下に配置。git の commit 履歴がデータ履歴になるので、復元可能。<br>
          整理したい場合は <code>data/</code> サブフォルダに移動して、上の「保存先パス」と app.js のパスも合わせて変更してください。
        </div>
      </div>
      <div class="panel stack">
        <h2>カテゴリ管理</h2>
        <div class="muted" style="font-size:12px; line-height:1.6">
          Project / Task / Block で選択できるカテゴリと色を管理します。タイムラインのブロック色などに反映されます。
        </div>
        ${renderCategoriesSettings()}
        <button class="btn primary" data-action="add-category">+ カテゴリを追加</button>
      </div>
      <div class="panel stack">
        <h2>休憩メッセージ</h2>
        <div class="muted" style="font-size:12px; line-height:1.6">
          休憩中(任意・常時タイマー)に、残り秒数の範囲に応じて表示されるメッセージです。
        </div>
        ${renderBreakMessagesSettings()}
        <button class="btn primary" data-action="add-break-message">+ メッセージを追加</button>
      </div>
      <div class="panel stack">
        <h2>GitHub Pages</h2>
        <div class="muted">このフォルダをGitHubリポジトリへpushし、Pagesの公開元をルートにすると公開できます。</div>
      </div>
    </section>
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
          <button class="btn danger" data-action="delete-category" data-cat-id="${c.id}" aria-label="削除">×</button>
        </div>
      `).join("")}
    </div>
  `;
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

function renderMore() {
  const moreItems = navItems.filter((item) => !["home", "wbs", "tasks", "timeline"].includes(item.id));
  return `
    ${renderHeader("追加画面", "その他")}
    <section class="grid">
      ${moreItems.map((item) => `
        <button class="item row" data-action="nav" data-view="${item.id}">
          <strong>${item.label}</strong>
          <span class="badge">${item.mark}</span>
        </button>
      `).join("")}
    </section>
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
    const dc = db.filter((b) => b.completed);
    const net = dc.reduce((s, b) => s + Number(b.charge || 0) - Number(b.discharge || 0), 0);
    return { date: d, wd: weekdayLabel(d), startPct: dtc.pct, startTotal: dtc.total, net };
  });
  const start12 = state.settings.twelveWeekStartDate;
  const wkNum = start12 ? clamp(Math.floor(daysBetween(start12, weekStart) / 7) + 1, 1, 12) : null;
  const daysLeft12 = start12 ? Math.max(0, daysBetween(weekStart, addDays(start12, 84))) : null;
  return {
    days, tc, rt,
    mit: { done: mitDone, total: mit.length, pct: mit.length ? Math.round((mitDone / mit.length) * 100) : 0 },
    charge, discharge, net: charge - discharge, daily, wkNum, daysLeft12
  };
}

// v40: エネルギー構造分析。weekStart を含む直近 weeks 週の completed blocks から
//      放電超過(曜日別平均・カテゴリ別合計)を上位3件だけ返す。
//      対象期間の completed が 28件未満なら eligible:false(不正確な "構造" を見せない)。
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
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

function renderStats() {
  const range = state.settings.statsRange || "4w";
  const weeks = statsRangeWeeks();
  const thisWeek = weekStartFor(todayISO());
  const today = todayISO();
  const since = addDays(thisWeek, -7 * (weeks - 1));
  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
  };

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
  const past = state.blocks.filter((b) => !b.deleted && b.date >= since && b.date <= today && b.plannedStartAt);
  const wdOrder = [6, 0, 1, 2, 3, 4, 5];  // 週定義に合わせて 土曜始まり
  const wdLabels = ["土", "日", "月", "火", "水", "木", "金"];
  let hmHasData = false;
  const hmRows = SCHED_BANDS.map(([s, e, label]) => {
    const cells = wdOrder.map((wd, i) => {
      const cellBlocks = past.filter((b) => {
        if (parseDate(b.date).getDay() !== wd) return false;
        const m = minutesOf(b.plannedStartAt);
        return m >= s * 60 && m < e * 60;
      });
      if (cellBlocks.length < 3) return `<td class="stats-hm-cell empty"></td>`;  // n不足はノイズなので出さない
      hmHasData = true;
      const rate = cellBlocks.filter((b) => b.actualStartAt).length / cellBlocks.length;
      return `<td class="stats-hm-cell" style="background:rgba(47,185,109,${(0.08 + rate * 0.5).toFixed(2)})" title="${wdLabels[i]}曜 ${label}: 着手${Math.round(rate * 100)}%(${cellBlocks.length}件)">${Math.round(rate * 100)}</td>`;
    }).join("");
    return `<tr><th class="stats-hm-band">${label}</th>${cells}</tr>`;
  }).join("");
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
  const est = past
    .filter((b) => b.completed && Number(b.estimateMin) > 0)
    .map((b) => ({ b, actual: _actualDurationMin(b) }))
    .filter((x) => x.actual && x.actual > 0);
  let estimateCard = "";
  if (est.length >= 5) {
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

  const body = rateChart + energyChart + donutCard + catEnergyCard + trendCard + heatmap + histCard + estimateCard + calendarCard;
  return `
    ${renderHeader("数字で見る実行の実態", "計器盤")}
    <div class="segmented" style="margin-bottom:10px">
      ${[["4w", "4週"], ["12w", "12週"], ["all", "全期間"]].map(([k, l]) =>
        `<button class="${range === k ? "active" : ""}" data-action="stats-range" data-range="${k}">${l}</button>`).join("")}
    </div>
    ${range === "all" ? `<div class="muted" style="font-size:11px; margin-bottom:10px">全期間 = この端末に残っているデータの範囲(アーカイブ済みの期間は含みません)</div>` : ""}
    ${body ? `<section class="stats-grid">${body}</section>` : emptyPanel("まだ十分なデータがありません。実績が数週間分たまると表示されます。")}
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

    ${renderEnergyStructure(week)}
    `}

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

    <div class="weekly-cycle-link" data-action="open-cycle">◷ 12週サイクルをふりかえる(節目のレビュー) →</div>

    <div class="weekly-sec weekly-close">
      <h3>締め</h3>
      <button class="btn primary weekly-change-btn" data-action="weekly-change-theme" data-week="${week}">
        ${review.changeThemeCreated ? "✓ 発行済み — もう一度テーマ化する" : "この週から何を変えるか → 0秒思考へ"}
      </button>
      <textarea class="textarea" data-weekly-md="${week}" style="min-height:120px; margin-top:12px" placeholder="この週の気づき・来週変えることをメモ(Markdown)">${escapeHTML(review.md || "")}</textarea>
      <div class="row" style="gap:8px; margin-top:10px; flex-wrap:wrap">
        ${aiEnabled() ? `<button class="btn" data-action="weekly-ai" data-week="${week}" ${_aiReviewPending ? "disabled" : ""}>${_aiReviewPending ? "⏳ AI実行中…" : "🤖 AIと振り返る"}</button>` : ""}
        <button class="btn" data-action="weekly-download" data-week="${week}">週次mdをダウンロード</button>
        ${(state.settings.github?.token && state.settings.github?.owner) ? `<button class="btn" data-action="weekly-push" data-week="${week}">GitHubへpush</button>` : ""}
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
        ${aiEnabled() ? `<button class="btn" data-action="cycle-ai" data-cycle="${cycleStart}" ${_aiReviewPending ? "disabled" : ""}>${_aiReviewPending ? "⏳ AI実行中…" : "🤖 AIと振り返る"}</button>` : ""}
        <button class="btn" data-action="cycle-download" data-cycle="${cycleStart}">サイクルmdをダウンロード</button>
        ${(state.settings.github?.token && state.settings.github?.owner) ? `<button class="btn" data-action="cycle-push" data-cycle="${cycleStart}">GitHubへpush</button>` : ""}
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
          <textarea class="textarea" data-modal-field="text" style="min-height:96px" placeholder="例: SEJ案件で "効率化提案" を "経営指標提案" に変えるには何が要るか">${escapeHTML(q?.text || "")}</textarea>
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

// v34: =========================================================
//  0秒思考(Zero Second Thinking)
//  - 一覧: テーマ追加(トグル)/ タブ(それ以外・お気に入り)/ ★切替 / 書く
//  - 書く: 1分カウントダウン(0で停止・入力は継続可)/ 保存で履歴へ
//  - 保存: ★テーマは残す、それ以外は書いたら一覧から消える
//  - 日報: generateReport にその日の 0秒思考を出力
// =========================================================
function renderZeroThinking() {
  if (ztCurrent) return renderZtWrite();

  const zt = state.zeroThinking || { themes: [], entries: [] };
  const todayCount = zt.entries.filter((e) => e.date === todayISO()).length;
  const zeroTab = state.settings.zeroTab || "theme";  // v39: テーマ / 問い の2タブ
  const openQ = (state.questions || []).filter((q) => !q.deleted && q.status !== "settled").length;

  return `
    <div class="view-header">
      <div>
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
function renderZtThemeTab() {
  const zt = state.zeroThinking || { themes: [], entries: [] };
  const favList = zt.themes.filter((t) => t.fav);
  const otherList = zt.themes.filter((t) => !t.fav);
  const items = ztTab === "fav" ? favList : otherList;

  const themeItemsHTML = items.length
    ? items.map((t) => `
        <div class="zt-theme-item ${t.fav ? "is-fav" : ""}">
          <button class="zt-star ${t.fav ? "on" : ""}" data-action="zt-fav-toggle" data-id="${t.id}" title="お気に入り">${t.fav ? "★" : "☆"}</button>
          <div class="zt-theme-text" data-action="zt-write" data-id="${t.id}">${escapeHTML(t.text)}${t.questionId ? `<span class="zt-theme-qtag">問い</span>` : ""}</div>
          <button class="zt-theme-go" data-action="zt-write" data-id="${t.id}">書く →</button>
        </div>`).join("")
    : ztTab === "fav"
      ? `<div class="zt-empty">お気に入りはまだありません。<span class="zt-empty-sub">☆ をタップして登録すると、書いてもここに残り続けます。</span></div>`
      : `<div class="zt-empty">テーマがありません。<span class="zt-empty-sub">「+ テーマを追加」から登録してください。</span></div>`;

  return `
    <div class="zt-lead">1テーマ・<b>1分</b>・手早く書き出す。<b>★お気に入り</b>はずっと残り、それ以外は書いたら消えます。</div>

    <section class="panel zt-section">
      <div class="zt-plabel">
        テーマ一覧
        <span class="zt-plabel-count">全 ${zt.themes.length} 件</span>
        <span class="zt-plabel-spacer"></span>
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
      ${aiEnabled() ? `<button class="btn ghost" data-action="zt-ai-comment" style="font-size:12px; margin:2px 0 8px" ${_aiReviewPending ? "disabled" : ""}>${_aiReviewPending ? "⏳ AI実行中…" : "🤖 直近7日のメモにまとめて所感をもらう"}</button>` : ""}
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
    <div class="zt-hi-item">
      <div class="zt-hi-meta">${escapeHTML(h.date)}<span class="zt-hi-dot"></span>0秒思考
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

function ztToggleFav(id) {
  const t = state.zeroThinking.themes.find((x) => x.id === id);
  if (!t) return;
  t.fav = !t.fav;
  saveAndRender();
}

function openZtWrite(id) {
  const t = state.zeroThinking.themes.find((x) => x.id === id);
  if (!t) return;
  ztCurrent = { id: t.id, text: t.text, fav: t.fav, questionId: t.questionId || null };  // v39: 問い紐づけを保持
  render();          // 書く画面を描画(DOM 確定)
  startZtTimer();    // その後にタイマー開始
  setTimeout(() => document.querySelector("#zt-write-input")?.focus(), 60);
}

function discardZtWrite() {
  const body = (document.querySelector("#zt-write-input")?.value || "").trim();
  if (body && !confirm("入力を破棄して一覧へ戻りますか?")) return;
  stopZtTimer();
  ztCurrent = null;
  render();
}

function saveZtEntry() {
  if (!ztCurrent) return;
  const body = (document.querySelector("#zt-write-input")?.value || "").trim();
  if (!body) return showToast("空のままでは保存できません");
  const cur = ztCurrent;
  state.zeroThinking.entries.push({
    id: crypto.randomUUID(),
    date: todayISO(),
    theme: cur.text,
    body,
    questionId: cur.questionId || null,  // v39: どの問いの下で書いたか
    createdAt: nowDateTime()
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
  saveAndRender(cur.fav ? "保存しました(★は残ります) — 日報に追加" : "保存しました — 日報に追加");
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
    twelveWeekStartDate: kind === "normal" ? state.settings.twelveWeekStartDate || "" : "",
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  });
  saveAndRender("Projectを追加しました");
}

function deleteProject(id) {
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

function makeTask({ projectId = "", parentTaskId = "", title = "", category = "", dueDate = "", targetYear = null, lifeArea = "", motivation = "" }) {
  return {
    id: crypto.randomUUID(),
    projectId,
    parentTaskId,
    title,
    category,
    status: "todo",
    dueDate: dueDate || state.selectedDate,
    description: "",
    // v16: やりたいことリスト用フィールド
    targetYear,         // いつまでに(数字の年、null なら「いつか」)
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
    ? { ...t, status: "completed", updatedAt: nowDateTime() } : t);
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
// 当日 23:59 を上限にクランプ。日付は選択中の日付。
function defaultPlannedTimes() {
  const now = new Date();
  const maxMin = 24 * 60 - 1;  // 23:59
  let startMin = now.getHours() * 60 + Math.floor(now.getMinutes() / 15) * 15;
  if (startMin > maxMin) startMin = maxMin;
  let endMin = startMin + 60;
  if (endMin > maxMin) endMin = maxMin;
  const fmt = (mins) => `${state.selectedDate}T${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}:00`;
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

function toggleBlock(id) {
  let justCompleted = false;
  let completedBlock = null;
  state.blocks = state.blocks.map((block) => {
    if (block.id !== id) return block;
    const completed = !block.completed;
    if (completed) {
      justCompleted = true;
      completedBlock = block;
    }
    if (completed && block.taskId) {
      state.tasks = state.tasks.map((task) => task.id === block.taskId && task.status === "todo" ? { ...task, status: "doing", updatedAt: nowDateTime() } : task);
    }
    return { ...block, completed, actualEndAt: completed && !block.actualEndAt ? nowDateTime() : block.actualEndAt, updatedAt: nowDateTime() };
  });
  saveAndRender("Blockを更新しました");
  // v17/v18: 完了時の演出(常にランダム祝福)
  if (justCompleted && completedBlock) {
    const celebrateMsg = getRandomCelebrate();
    triggerCompletionEffect(celebrateMsg, completedBlock.isMIT);
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
  }
  render();
  showToast(field === "actualStartAt" ? "開始時刻を入れました" : "終了時刻を入れました");
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

function setMorningEnergy(value) {
  state.settings.morningEnergyLog[state.selectedDate] = value;
  ensureJournal(state.selectedDate);
  const label = energyLevels.find((level) => level.value === value)?.label || "";
  state.journals[state.selectedDate] = upsertMorningLine(state.journals[state.selectedDate], `朝の体調: ${label} (${value})`);
  saveAndRender("朝の体調を保存しました");
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

  const lines = [
    `# 日報 ${date} (${weekdayLabel(date)})`,
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
  ];

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

  // ジャーナル
  lines.push("## 8. ジャーナル");
  lines.push(state.journals[date] || "(ジャーナル記載なし)");
  lines.push("");

  // 明日への接続
  lines.push("## 9. 明日への接続");
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
  saveAndRender("日報を生成しました(v17 仕様)");
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
      state = next;
      maintainRecurrences({ purge: true });
      saveAndRender("データをインポートしました");
    } catch {
      showToast("JSONを読み込めませんでした");
    }
  };
  reader.readAsText(file);
}

// v37: 端末ごとの「最後に同期したリモートSHA」。
//      state 本体には持たせない(ファイル内容は自分自身のSHAを含められないため、端末ローカルに持つ)。
const LAST_SYNCED_SHA_KEY = "taskchute-journal-last-synced-sha";
function getLastSyncedSha() {
  try { return localStorage.getItem(LAST_SYNCED_SHA_KEY) || ""; } catch { return ""; }
}
function setLastSyncedSha(sha) {
  try { localStorage.setItem(LAST_SYNCED_SHA_KEY, sha || ""); } catch { /* 保存できなくても致命的ではない */ }
}

// v37: 保存の同時実行ガード(自動保存と手動保存が同じSHAでPUTして409になるのを防ぐ)
let _githubSaveInFlight = false;

async function saveToGitHub(silent = false) {
  if (_githubSaveInFlight) {
    if (!silent) showToast("GitHub保存が進行中です。少し待ってください");
    return;
  }
  _githubSaveInFlight = true;
  // 手動・自動どちらでも、これから保存するのだから待機中の自動保存は不要
  clearTimeout(autoSaveTimer);
  try {
    const config = requireGitHubConfig();
    const sha = await fetchGitHubFileSHA(config);
    const lastSynced = getLastSyncedSha();

    // v37: リモートが「この端末が最後に同期した状態」から進んでいる場合の保護。
    //      別端末の新しいデータを、この端末の古い全量で黙って上書きしない。
    if (sha && sha !== lastSynced) {
      if (!lastSynced) {
        // この端末はまだ一度も読込/保存していない(初期設定直後・localStorage消去後など)
        if (silent) {
          updateAutoSaveStatus("GitHubに既存データあり — 一度「GitHubから読込」してください(自動保存を見送りました)");
          return;
        }
        const ok = window.confirm(
          "GitHub 上に既存のデータがあります。\nこの端末の内容で上書きしますか?\n\n(別端末のデータを引き継ぐ場合は、キャンセルして先に「GitHubから読込」を押してください)"
        );
        if (!ok) { showToast("保存を中止しました"); return; }
      } else {
        // 読込以降にリモートが更新されている → 新しい方を優先
        let remoteT = "";
        try { remoteT = (JSON.parse((await downloadGitHubStateText(config)).text).dataModifiedAt) || ""; } catch { /* 比較不能なら進む */ }
        if (remoteT && remoteT > (state.dataModifiedAt || "")) {
          const msg = "GitHub側にこの端末より新しいデータがあります。「GitHubから読込」で取り込んでから保存してください";
          if (silent) { updateAutoSaveStatus(`見送り: ${msg}`); return; }
          showToast(`保存を中止: ${msg}`);
          return;
        }
      }
    }

    const content = JSON.stringify(sanitizedStateForGitHub(), null, 2);
    const response = await fetch(gitHubContentsURL(config), {
      method: "PUT",
      headers: githubHeaders(config.token),
      body: JSON.stringify({
        message: `chore: update app state ${new Date().toISOString()}`,
        content: toBase64(content),
        branch: config.branch,
        ...(sha ? { sha } : {})
      })
    });

    if (!response.ok) {
      throw new Error(await gitHubErrorMessage(response));
    }

    // 保存後のファイルSHAを記録(次回の競合判定に使う)
    try {
      const result = await response.json();
      if (result.content?.sha) setLastSyncedSha(result.content.sha);
    } catch { /* SHAが取れなくても次回の保存前チェックで補正される */ }

    state.settings.github.lastSavedAt = nowDateTime();
    persistLocalNoSchedule();  // v25: 自動保存タイマーを再セットしない(無限保存ループ防止)
    if (!silent) showToast("GitHubへ保存しました");
    if (silent) updateAutoSaveStatus();
    maybeWriteBackupSnapshot();  // v49: 保存成功後、1日1回の世代スナップショット(await しない)
  } catch (error) {
    if (!silent) showToast(`GitHub保存失敗: ${error.message}`);
    else updateAutoSaveStatus(`失敗: ${error.message}`);
  } finally {
    _githubSaveInFlight = false;
  }
}

// v25: 自動保存先は GitHub。token + owner + repo 設定済み & autoSave ON のときのみ。
let autoSaveTimer = null;
const AUTO_SAVE_DEBOUNCE_MS = 30000;  // 変更後この時間で GitHub へ自動保存

function scheduleAutoSave() {
  const cfg = state.settings?.github || {};
  // v43: 自動同期 ON のときは legacy 30秒 autoSave をバイパス(二重push防止)
  if (state.settings.autoSync) { clearTimeout(autoSaveTimer); return; }
  // v37: OFF になったら予約済みのタイマーも解除する
  //      (OFF直前の変更で予約された保存が30秒後に飛ぶのを防ぐ)
  if (!cfg.autoSave) { clearTimeout(autoSaveTimer); return; }
  if (!cfg.token || !cfg.owner || !cfg.repo) return;
  clearTimeout(autoSaveTimer);
  updateAutoSaveStatus("変更を検知 — 30秒後に保存します");
  autoSaveTimer = setTimeout(() => {
    saveToGitHub(true);
  }, AUTO_SAVE_DEBOUNCE_MS);
}

// v43: =========================================================
//  GitHub 自動同期(既定OFF・保守的・既存の手動push/pull関数の上に載せる)
//  マージはしない。競合時は必ず人間判断に落とす。自動系が壊れても手動は生きている。
// =========================================================
let _autoSyncTimer = null;
let _lastPullCheckAt = 0;      // Date.now() ベース(スロットル)。非永続。
let _syncBanner = null;        // 競合バナー文言。非永続。
const AUTO_SYNC_PUSH_MS = 3 * 60 * 1000;   // 3分デバウンス
const AUTO_SYNC_PULL_THROTTLE_MS = 60 * 1000;

function autoSyncReady() {
  const cfg = state.settings.github || {};
  if (!state.settings.autoSync || !cfg.token || !cfg.owner || !cfg.repo) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  return true;
}

// 自動 push(3分デバウンス)
function scheduleAutoSync() {
  if (!state.settings.autoSync) return;
  clearTimeout(_autoSyncTimer);
  _autoSyncTimer = setTimeout(runAutoSyncPush, AUTO_SYNC_PUSH_MS);
}
async function runAutoSyncPush() {
  if (!autoSyncReady()) return;
  const cfg = state.settings.github;
  if (!(state.dataModifiedAt && state.dataModifiedAt > (state.settings.lastPushedAt || ""))) return;  // 未変更
  try {
    // push前ガード: remote の dataModifiedAt を確認(別端末が進めていたら中止)
    const remoteT = (JSON.parse((await downloadGitHubStateText(cfg)).text).dataModifiedAt) || "";
    if (remoteT && remoteT > (state.settings.lastPushedAt || "")) {
      setSyncBanner("リモートに新しいデータがあります。設定から pull を確認してください");
      return;
    }
    const before = state.settings.github.lastSavedAt;
    const pushed = state.dataModifiedAt;
    await saveToGitHub(true);  // 既存の手動push経路(SHAガード付き)を共用
    if (state.settings.github.lastSavedAt !== before) {  // 成功
      state.settings.lastPushedAt = pushed;
      clearSyncBanner();
      persistLocalNoSchedule();
    }
    updateSyncDot();
  } catch { /* オフライン/APIエラー: 次のデバウンスで再試行(演出なし) */ }
}

// 自動 pull(起動 + visibilitychange、60秒スロットル)
async function runAutoSyncPull() {
  if (!autoSyncReady()) return;
  const now = Date.now();
  if (now - _lastPullCheckAt < AUTO_SYNC_PULL_THROTTLE_MS) return;
  _lastPullCheckAt = now;
  const cfg = state.settings.github;
  try {
    const { text, sha } = await downloadGitHubStateText(cfg);
    const remote = JSON.parse(text);
    const remoteT = remote.dataModifiedAt || "";
    const localT = state.dataModifiedAt || "";
    if (!remoteT || remoteT <= localT) { if (runDailyOpen()) render(); return; }  // remote 古い/同じ
    const hasUnpushed = localT !== (state.settings.lastPushedAt || "");
    if (hasUnpushed) {
      // 両方に未反映の変更 → 自動適用しない(どちらを取るかは人間)
      setSyncBanner("リモートに新しいデータ。ローカルにも未pushの変更があります。設定から手動で確認してください");
      if (runDailyOpen()) render();
      return;
    }
    // 自動適用(ローカルに未push変更なし & remote が新しい)
    clearTimeout(autoSaveTimer);
    const token = cfg.token;
    state = normalizeState(remote);
    state.settings.github = { ...cfg, token };
    state.settings.lastPushedAt = remoteT;   // 取り込んだ = リモートと一致
    state.settings.lastPulledAt = nowDateTime();
    setLastSyncedSha(sha);
    maintainRecurrences({ purge: true });
    runDailyOpen();  // §2: pull 後に日次オープン(古いstate展開→pullで消える事故を防ぐ)
    clearSyncBanner();
    persistLocalNoSchedule();
    render();
    showToast("最新データを取り込みました");
  } catch { if (runDailyOpen()) render(); }
}

function setSyncBanner(msg) { _syncBanner = msg; renderSyncBanner(); updateSyncDot(); }
function clearSyncBanner() { _syncBanner = null; renderSyncBanner(); updateSyncDot(); }
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

// GitHub から app-state を取得し { text, sha } を返す(1MB 超は Blob API 経由)
async function downloadGitHubStateText(config) {
  const response = await fetch(`${gitHubContentsURL(config)}?ref=${encodeURIComponent(config.branch)}`, {
    headers: githubHeaders(config.token)
  });
  if (!response.ok) throw new Error(await gitHubErrorMessage(response));
  const payload = await response.json();
  // v22: Contents API は 1MB 超のファイルの content を返さない → Blob API を使う
  let jsonText;
  if (payload.content && payload.encoding === "base64") {
    jsonText = fromBase64(payload.content);
  } else {
    if (!payload.sha) throw new Error("ファイル情報を取得できませんでした");
    const blobURL = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/blobs/${payload.sha}`;
    const blobResp = await fetch(blobURL, { headers: githubHeaders(config.token) });
    if (!blobResp.ok) throw new Error(await gitHubErrorMessage(blobResp));
    const blob = await blobResp.json();
    jsonText = fromBase64(blob.content || "");
  }
  if (!jsonText.trim()) throw new Error("ファイルが空です");
  return { text: jsonText, sha: payload.sha || "" };
}

// 手動「GitHubから読込」: リモートを採用(dataModifiedAt はリモートの値を維持)
async function loadFromGitHub() {
  try {
    const config = requireGitHubConfig();
    const { text, sha } = await downloadGitHubStateText(config);
    const loaded = JSON.parse(text);
    // v37: 読込前の編集で予約された自動保存を取り消す(読込直後の無意味なpush防止)
    clearTimeout(autoSaveTimer);
    const token = state.settings.github.token;
    state = normalizeState(loaded);
    state.settings.github = { ...config, token };
    maintainRecurrences({ purge: true });
    persistLocalNoSchedule();  // 採用のため dataModifiedAt は更新しない
    setLastSyncedSha(sha);     // v37: この端末はこのリモート状態と同期済み
    render();
    showToast("GitHubから読み込みました");
  } catch (error) {
    showToast(`GitHub読込失敗: ${error.message}`);
  }
}

// v25: 起動時、GitHub 側がローカルより新しければ取り込む(ローカルファースト)。
// ローカルを即描画した後にバックグラウンドで実行される。
async function syncFromGitHubOnStartup() {
  const cfg = state.settings.github || {};
  if (!cfg.token || !cfg.owner || !cfg.repo) return;  // 未設定なら何もしない
  try {
    const { text, sha } = await downloadGitHubStateText(cfg);
    const remote = JSON.parse(text);
    // v37: 比較は「起動時点のローカル更新時刻」と行う。
    //      fetch中にユーザーがタブを触るなどして saveState が走ると localT が進み、
    //      本来取り込むべき新しいリモートを永遠に取りこぼす問題への対策。
    const localT = _startupDataModifiedAt || "";
    const remoteT = remote.dataModifiedAt || "";
    // リモートが新しいときだけ採用(ISO 文字列なので辞書順比較でよい)
    if (remoteT && remoteT > localT) {
      clearTimeout(autoSaveTimer);
      const token = state.settings.github.token;
      state = normalizeState(remote);
      state.settings.github = { ...cfg, token };
      maintainRecurrences({ purge: true });
      persistLocalNoSchedule();
      setLastSyncedSha(sha);   // v37: この端末はこのリモート状態と同期済み
      render();
      showToast("最新データを取り込みました");
    } else {
      // ローカルが新しい/同じ → データは変更しない(次回保存で GitHub へ反映される)。
      // v38: ただしリモートの現状は確認済みなので「同期済みSHA」だけ記録する。
      //      これが無いと、稼働中の既存端末が(SHA未記録のため)一度手動で
      //      「GitHubから読込」するまで自動保存を見送り続けてしまう。
      setLastSyncedSha(sha);
    }
  } catch (error) {
    // 起動時の同期失敗は致命的でない(ローカルで動作継続)
    console.warn("起動時の GitHub 同期をスキップ:", error.message);
  }
}

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

function requireGitHubConfig() {
  syncGitHubFieldsFromDOM();
  const config = state.settings.github || defaultGitHubSettings();
  const labels = { owner: "Owner", repo: "Repository", branch: "Branch", path: "保存先パス", token: "Token" };
  for (const key of ["owner", "repo", "branch", "path", "token"]) {
    if (!config[key]) throw new Error(`${labels[key]} を入力してください`);
  }
  return config;
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
  const hints = {
    401: "トークンが無効か期限切れです。設定画面で貼り直してください",
    403: "トークンにこのリポジトリへの権限がありません(Fine-grained tokenの Repository access / Contents 権限を確認)",
    404: "ファイルが見つかりません。Owner / Repository / Branch / 保存先パスの綴りを確認してください"
  };
  const hint = hints[response.status];
  return hint ? `${raw} — ${hint}` : raw;
}

function sanitizedStateForGitHub() {
  const copy = structuredClone(state);
  if (copy.settings?.github) copy.settings.github.token = "";
  if (copy.settings?.ai) copy.settings.ai.apiKey = "";  // v49: AIのAPIキーも同期・エクスポートに含めない
  copy.modal = null;  // v37: ローカル保存(persistLocalNoSchedule)と同様、モーダル状態は共有しない
  delete copy._justStartedBlockId;  // v40: 非永続の着手ジュースフラグは同期しない
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
const BACKUP_DIR = "backups";

function gitHubBackupURL(cfg, name) {
  const base = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${BACKUP_DIR}`;
  return name ? `${base}/${encodeURIComponent(name)}` : base;
}

async function maybeWriteBackupSnapshot() {
  const cfg = state.settings.github || {};
  if (!cfg.token || !cfg.owner || !cfg.repo) return;
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
    // スナップショットは token / APIキー を含まないので、この端末の値を引き継ぐ
    const token = state.settings.github.token;
    const aiKey = state.settings.ai?.apiKey || "";
    clearTimeout(autoSaveTimer);
    const next = normalizeState(JSON.parse(text));
    next.settings.github = { ...next.settings.github, ...cfg, token };
    if (!next.settings.ai.apiKey) next.settings.ai.apiKey = aiKey;
    state = next;
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
  const cfg = state.settings.github || {};
  if (!cfg.token || !cfg.owner || !cfg.repo) {
    if (manual) showToast("アーカイブには GitHub 設定(token)が必要です");
    return;
  }
  const { byYear, textCut, blockCut } = collectArchivable();
  const years = Object.keys(byYear).sort();
  if (!years.length) {
    if (manual) showToast(`アーカイブ対象はありません(日報等は${ARCHIVE_TEXT_KEEP_DAYS}日・Blockは${ARCHIVE_BLOCK_KEEP_DAYS}日より古い分が対象)`);
    return;
  }
  if (manual) showToast("📦 アーカイブ中…");
  try {
    for (const year of years) {
      const filePath = `archive/archive-${year}.json`;
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
  const cfg = state.settings.github || {};
  if (!cfg.token || !cfg.owner || !cfg.repo) return;
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
  const cfg = state.settings.github || {};
  if (!cfg.token || !cfg.owner || !cfg.repo) return showToast("アーカイブ検索には GitHub 設定が必要です");
  _archiveLoadState = "loading";
  refreshSearchResults();
  try {
    const dirResp = await fetch(`${gitHubFileURL(cfg, "archive")}?ref=${encodeURIComponent(cfg.branch)}`, {
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
        const file = await fetchGitHubJSONFile(cfg, `archive/${name}`);
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
  state = normalizeState(seedState());
  saveAndRender("デモデータに戻しました");
}

function startPomodoro(blockId) {
  if (!blockId) return showToast("Blockを選んでください");
  // v14: state.pomodoro を完全再構築(spread を使わず、必要なフィールドだけ明示的に作成)
  // これで以前のセッションの endsAt/startedAt/mode が確実にリセットされる
  const tab = state.pomodoro?.tab || "manual";
  const passive = state.pomodoro?.passive || defaultPassivePomodoro();
  const fullscreen = state.pomodoro?.fullscreen || false;
  const now = Date.now();
  state.pomodoro = {
    tab,
    passive,
    fullscreen,
    running: true,
    blockId,
    startedAt: dateToLocalDateTime(new Date(now)),
    endsAt: dateToLocalDateTime(new Date(now + 25 * 60 * 1000)),
    mode: "focus"
  };
  // v13: ポモドーロ開始時、Blockの実績開始時間を自動記録(既存値があれば維持)
  updateBlockField(blockId, "actualStartAt", blockById(blockId)?.actualStartAt || nowDateTime());
  saveAndRender("ポモドーロを開始しました(50:00 から)");
}

// v14: ポモドーロセッションを強制完全リセット(他フィールド保持)
// click ハンドラで start-pomodoro の前に呼んで、中断/完了/休憩後の再開で確実に 50:00 から始まることを保証
function forceResetPomodoroSession() {
  state.pomodoro = {
    tab: state.pomodoro?.tab || "manual",
    passive: state.pomodoro?.passive || defaultPassivePomodoro(),
    fullscreen: state.pomodoro?.fullscreen || false,
    running: false,
    blockId: "",
    startedAt: "",
    endsAt: "",
    mode: "focus"
  };
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
    running: false,
    blockId: "",
    startedAt: "",
    endsAt: "",
    mode: "focus"
  };
  saveAndRender("ポモドーロを完了しました(Blockに完了チェック)");
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
    running: false,
    blockId: "",
    startedAt: "",
    endsAt: "",
    mode: "focus"
  };
  saveAndRender("✅ Block を完了しました(実績終了時刻を記録)");
}

function startTimerTicker() {
  clearInterval(timerTicker);
  timerTicker = setInterval(() => {
    // 任意タイマー
    if (state.pomodoro.running) {
      if (new Date(state.pomodoro.endsAt).getTime() <= Date.now()) {
        // 時間切れ: focus → 自動で break に、break → セッション終了
        if (state.pomodoro.mode === "break") {
          endBreakPomodoro();
        } else {
          // focus フェーズ終了 → 自動で休憩へ
          goBreakPomodoro();
        }
      } else if (state.currentView === "pomodoro") {
        renderMain();
      }
    }
    // 常時タイマー(壁時計モデル): ポモドーロ画面を開いている間は常に再描画
    if (state.currentView === "pomodoro" && state.pomodoro?.tab === "passive") {
      renderMain();
    }
    // v41: 見込み終了時刻は該当 span のみ差し替え(全再描画しない)
    updateProjectedEndTick();
  }, 500);
}

function setView(view) {
  // v34: 0秒思考の書く画面から離脱するときはタイマー停止 + 一時状態リセット
  if (state.currentView === "zero" && view !== "zero") {
    stopZtTimer();
    ztCurrent = null;
  }
  state.currentView = view;
  // v37: 画面切替は「データの変更」ではない。dataModifiedAt を汚すと
  //      端末間の新旧比較が壊れる(タブを触っただけの古い端末が「最新」扱いになる)ため、
  //      永続化のみ行い、更新時刻スタンプと自動保存はしない。
  persistLocalNoSchedule();
  render();
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

function saveAndRender(message) {
  saveState();
  render();
  // v23: 端末内保存に失敗したら、その旨を優先して伝える(操作自体は反映済み)
  if (_lastSaveError) {
    showToast("⚠️ 端末内保存に失敗(容量超過の可能性)。設定からGitHubへ保存してください");
  } else if (message) {
    showToast(message);
  }
}

async function hydrateStaticMarkdown() {
  const visionPromise = fetchText("./Vision.md");
  const affirmPromise = fetchText("./Daily_Affirmation.md");
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
  const today = state.selectedDate;
  const prev = addDays(today, -1);
  const [todayFb, prevFb] = await Promise.all([
    fetchText(`./AIフィードバック_${today}.md`),
    fetchText(`./AIフィードバック_${prev}.md`)
  ]);
  if (todayFb && todayFb !== cachedFeedback[today]) {
    cachedFeedback[today] = todayFb;
    changed = true;
  }
  if (prevFb && prevFb !== cachedFeedback[prev]) {
    cachedFeedback[prev] = prevFb;
    changed = true;
  }
  // v37: state.view というプロパティは存在しない(正しくは currentView)。
  //      このタイポのせいで、ビジョン画面を開いたまま読み込みが終わっても再描画されなかった。
  if (changed && (state.currentView === "vision" || state.currentView === "journal")) {
    render();
  }
}

async function reloadStaticMarkdown() {
  cachedVisionMd = "";
  cachedAffirmationMd = "";
  showToast("最新を取得中...");
  await hydrateStaticMarkdown();
  render();
  showToast("最新を読み込みました");
}

function openMdInGithub(path) {
  const cfg = state.settings.github || {};
  if (!cfg.owner || !cfg.repo) {
    showToast("設定画面でGitHubのowner/repoを入れてください");
    return;
  }
  const branch = cfg.branch || "main";
  const url = `https://github.com/${cfg.owner}/${cfg.repo}/edit/${branch}/${path}`;
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

async function fetchText(path) {
  try {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) return "";
    return await response.text();
  } catch {
    return "";
  }
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function ensureJournal(date) {
  if (!state.journals[date]) {
    // v38: journalTemplate には作成時の日付が「# YYYY-MM-DD のジャーナル」として
    //      焼き込まれているため、その日の日付に置き換えてから使う
    //      (毎日同じ日付のジャーナルが生成されていた)
    const tpl = state.settings.journalTemplate || defaultJournal(date);
    state.journals[date] = tpl.replace(/^# \d{4}-\d{2}-\d{2} のジャーナル/m, `# ${date} のジャーナル`);
  }
}

// v17: 統合版ジャーナルテンプレ(朝夜の分割を廃止、1ページに集約)
// 思考プロンプトは画面表示のヒントとしてのみ機能(Markdown には含めない)
function defaultJournal(date) {
  return [
    `# ${date} のジャーナル`,
    ``,
    `## 🛏 睡眠`,
    `就寝: __:__  /  起床: __:__`,
    `質: ★★★☆☆`,
    ``,
    `## 🙏 感謝(3 つ)`,
    `1. `,
    `2. `,
    `3. `,
    ``,
    `## ✨ 今日のハイライト`,
    ``,
    ``,
    `## 💡 気付き・学び`,
    ``,
    ``,
    `## 📝 自由記述`,
    ``,
    ``
  ].join("\n");
}

// v17: 各セクションの思考プロンプト(画面表示用、Markdown 出力時は省く)
const JOURNAL_PROMPTS = {
  "🛏 睡眠": "ぐっすり眠れた?夢は覚えてる?",
  "🙏 感謝(3 つ)": "当たり前すぎて忘れがちな何か。誰・何に対して?(例:朝のコーヒー、子の笑顔)",
  "✨ 今日のハイライト": "今日いちばん心が動いた瞬間は? 嬉しい・面白い・誇らしい、どれでも。",
  "💡 気付き・学び": "うまくいった/いかなかった理由は? 自分・他人・状況について、次に活かせること。",
  "📝 自由記述": "・いまなに考えてる?\n・言葉にならない違和感を、まず雑に書き出す。コントロールできないことは手放してOK。\n・夢・思いつき・心配ごと・読書メモ・なんでも。"
};

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
    orderIndex: 0,
    isMIT: false,
    source: rule.source || "",
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
}

// Block(テンプレート)から新しい繰り返しルールを作成
function createRecurrenceRule(block, kind) {
  const rule = {
    id: crypto.randomUUID(),
    title: block.title || "繰り返しBlock",
    category: block.category || "",
    taskId: block.taskId || "",
    kind,
    startTime: block.plannedStartAt ? (block.plannedStartAt.split("T")[1] || "") : "",
    endTime: block.plannedEndAt ? (block.plannedEndAt.split("T")[1] || "") : "",
    anchorDate: block.date || todayISO(),
    expectedCharge: block.expectedCharge ?? "",
    expectedDischarge: block.expectedDischarge ?? "",
    source: block.source || "",
    exceptionDates: [],
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
  state.recurrences ||= [];
  state.recurrences.push(rule);
  return rule;
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

function addDays(date, delta) {
  const d = parseDate(date);
  d.setDate(d.getDate() + delta);
  return dateToISO(d);
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
  const remainingMs = Math.max(0, new Date(end).getTime() - Date.now());
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

function renderModal(innerHTML) {
  modalRoot.innerHTML = innerHTML;
  modalRoot.classList.add("open");
  modalRoot.setAttribute("aria-hidden", "false");
  // 背景クリックで閉じる
  modalRoot.onclick = (event) => {
    if (event.target === modalRoot) closeModal();
  };
}

function closeModal() {
  state.modal = null;
  modalRoot.classList.remove("open");
  modalRoot.setAttribute("aria-hidden", "true");
  modalRoot.innerHTML = "";
  modalRoot.onclick = null;
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
  }
}

function deleteFromModal() {
  if (!state.modal) return;
  const ok = window.confirm("削除しますか? この操作は取り消せます(deleted フラグ)。");
  if (!ok) return;
  if (state.modal.type === "project") {
    deleteProject(state.modal.id);
  } else if (state.modal.type === "task") {
    deleteTask(state.modal.id);
  } else if (state.modal.type === "block") {
    deleteBlock(state.modal.id);
  } else if (state.modal.type === "question") {
    deleteQuestion(state.modal.id);  // v39
  }
  closeModal();
}

// ---------- Project モーダル ----------

function buildProjectModal(project) {
  const status = project.status || "active";
  const kind = project.kind || "normal";
  const is12WY = Boolean(project.twelveWeekStartDate);
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
            <select class="select" data-modal-field="kind">
              <option value="normal" ${kind === "normal" ? "selected" : ""}>Project</option>
              <option value="wish" ${kind === "wish" ? "selected" : ""}>Wish</option>
            </select>
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
          <label class="field-label">説明 / メモ</label>
          <textarea class="textarea" data-modal-field="description" style="min-height:120px">${escapeHTML(project.description || "")}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn danger" data-action="modal-delete">削除</button>
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
      kind: fields.kind || p.kind || "normal",
      status: fields.status || p.status || "active",
      category: fields.category || "",
      startDate: fields.startDate || "",
      dueDate: fields.dueDate || "",
      description: fields.description || "",
      twelveWeekStartDate,
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
      dueDate: fields.dueDate || ""
    });
    task.status = fields.status || "todo";
    task.description = fields.description || "";
    state.tasks.push(task);
    closeModal();
    saveAndRender("Taskを追加しました");
    return;
  }
  state.tasks = state.tasks.map((t) => {
    if (t.id !== id) return t;
    return {
      ...t,
      title: (fields.title || "").trim() || t.title,
      projectId: fields.projectId || "",
      parentTaskId: fields.parentTaskId || "",
      status: fields.status || t.status || "todo",
      category: fields.category || "",
      dueDate: fields.dueDate || "",
      description: fields.description || "",
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
            完了済み
          </label>
        </div>
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
        <button class="btn danger" data-action="modal-delete">削除</button>
        <button class="btn" data-action="modal-close">キャンセル</button>
        <button class="btn primary" data-action="modal-save">保存</button>
      </div>
    </div>
  `;
}

function saveBlockFromModal(id, fields) {
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
                updatedAt: nowDateTime()
              }
            : r);
        // v37: 旧kindで実体化済みの未来分(未編集)を取り除いてから再実体化する。
        //      残すと「毎日→毎週」に変えても毎日分が31日先まで表示され続ける。
        removeUntouchedInstances(liveRule.id, { fromDate: todayISO(), excludeId: id });
      } else {
        const rule = createRecurrenceRule(updated, rk);
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
    closeModal();
    saveAndRender("Blockを更新しました");
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

function uploadFeedbackFile(date, file) {
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result || "";
    // localStorage の state.feedback と cachedFeedback 両方に保存
    state.feedback[date] = text;
    cachedFeedback[date] = text;
    saveState();
    showToast(`AIフィードバック ${date} を保存しました`);
    render();
    // GitHub に設定があれば自動 push
    if (state.settings.github?.token && state.settings.github?.owner) {
      pushFileToGitHub(`AIフィードバック_${date}.md`, text, "アップロードAIフィードバック");
    }
  };
  reader.onerror = () => showToast("ファイル読込に失敗しました");
  reader.readAsText(file, "utf-8");
}

async function pushReportToGitHub() {
  const date = state.selectedDate;
  const report = state.reports[date];
  if (!report) {
    showToast("日報がまだ生成されていません");
    return;
  }
  if (!state.settings.github?.token) {
    showToast("GitHub設定が未入力です");
    return;
  }
  await pushFileToGitHub(`日報_${date}.md`, report, `日報 ${date}`);
}

async function pushFileToGitHub(filename, content, label) {
  try {
    const cfg = state.settings.github;
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      throw new Error("GitHub設定が未入力です");
    }
    const branch = cfg.branch || "main";
    const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(filename)}`;
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
  if (!opts.quiet && cfg?.autoSave && cfg?.token && cfg?.owner) {
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
ensurePassivePomodoro();
// v23/v41: 起動時に繰り返し Block を実体化(期間外・未編集は破棄)+ 日次オープン記録
runDailyOpen({ force: true });
render();
hydrateStaticMarkdown();
registerServiceWorker();
startTimerTicker();
// v25/v43: 起動後の pull。自動同期 ON なら v43 の pull(競合バナー付き)、OFF なら従来の起動時同期。
if (state.settings.autoSync) runAutoSyncPull();
else syncFromGitHubOnStartup();
// v51: 朝イチ自動レビュー(opt-in・既定OFF)。起動直後は同期(pull)に少し譲ってから実行し、
//      別端末で実行済みのフィードバックを取り込んだ後に重複実行しないようにする。
setTimeout(maybeAutoMorningReview, 4000);
// v53: 自動アーカイブ(既定ON・1日1回)。同期・自動レビューの後に静かに実行。
setTimeout(maybeAutoArchive, 8000);
// v41/v43: 復帰時。自動同期 ON なら pull(内部で日次オープン)、OFF なら日次オープンのみ。
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (state.settings.autoSync) runAutoSyncPull();
  else if (runDailyOpen()) render();
  setTimeout(maybeAutoMorningReview, 4000);  // v51: 日をまたいで復帰したケース
  setTimeout(maybeAutoArchive, 8000);        // v53: 同上
});

// v42: AIフィードバック欄への貼り付けで、構造化取り込みモーダルを開く
//      (抽出ゼロなら何もしない = 従来の自由貼り付けも壊さない)
document.addEventListener("paste", (event) => {
  const t = event.target;
  if (!t || !t.matches || !t.matches("[data-feedback-date]")) return;
  const date = t.dataset.feedbackDate;
  setTimeout(() => {
    const text = t.value || "";
    state.feedback[date] = text;
    saveState();
    const parsed = parseAiFeedback(text);
    if (parsed.themes.length + parsed.mits.length + parsed.questions.length > 0) openAiImportModal(date, parsed);
  }, 0);
});
