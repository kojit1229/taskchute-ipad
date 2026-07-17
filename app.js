const STORAGE_KEY = "taskchute-journal-pwa-state-v1";

// v91: 「### 依頼」節(機械可読契約: loop/scripts/journal-requests-extract.py が検出する)。
//      ガイド文は丸括弧で囲み、抽出スクリプト側で「丸括弧だけの行は例示であり実際の依頼では
//      ない」と判定できるようにする(空欄のまま運用してもバッチが誤検出しない設計)。
//      定義位置に注意: defaultJournal() の直前ではなくファイル先頭に置く必要がある。
//      理由 = 下の `let state = loadState();`(旧く言えば起動処理)が起動直後の同期実行で
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
// v85: ビジョンボード(45/80/nowの各PDF)はpersonal-dataリポジトリのtaskchute/content/配下にあり、
// GitHub Pages(このアプリの同一オリジン)にはv72移行時から存在しない。Contents APIから認証ヘッダ付きで
// バイナリ取得し、Blob URL化してから<object>に埋め込む(取得できるまでは埋め込まない=公開URLへの
// フォールバックはしない。壊れたsrcを一瞬でも出さないため)。
const cachedVisionPdfUrls = {};      // { 'now_vision.pdf': 'blob:...' }(取得成功後のみキーが増える)
const _visionPdfLoadInFlight = {};   // { 'now_vision.pdf': true }(多重fetch防止)
const cachedFeedback = {};  // { 'YYYY-MM-DD': '...md text...' }
const cachedWeeklyReviewMd = {};  // v62: { '週開始土曜YYYY-MM-DD': '...md text...' }(自宅PCバッチ生成)
// v67: AI作業結果_<today>.json のパース済み配列(非永続、当日分のみ)。二重登録防止のIDは state.aiWorkProcessedIds 側で永続化する。
let cachedAiWorkResults = null;
// v74: 読書複利化 — taskchute/reading/highlights.json の books 配列(null=未取得。永続化しない、
//      他のcached*と同じくアプリ内メモリのみ。ハイライト本体は個人データリポジトリが正)
let cachedReadingHighlights = null;
// v92: AIレポートビューア(コンテンツ総括・自己分析・基盤ヘルス・週次レビューをアプリ内で横断閲覧)。
// v110: バッチ実行サマリを追加。
// taskchute/直下のディレクトリ一覧を1回のContents API呼び出しで取得し、種類ごとにファイル名prefixで
// ローカルにフィルタする(セッションキャッシュ、手動更新ボタンでのみ再取得。自動ポーリングはしない)。
let _aiReportDirCache = null;        // Contents APIのレスポンス配列(null=未取得)
let _aiReportDirError = false;       // 直近の一覧取得が失敗したか(静かなエラー表示 + 再試行ボタン用)
let _aiReportDirLoadInFlight = false;
const _aiReportBodyCache = {};       // { 'コンテンツ総括_2026-07-14.md': '...md text...' }(""=取得試行済だが空/失敗)
const _aiReportBodyLoadInFlight = {};
const _aiReportSelectedDate = {};    // { content: '2026-07-14', self: '2026-07', ... }(種類ごとの選択中日付)
// v77: AIフィードバック等の自動再表示(起動時fetchのみだと開きっぱなしのPWAで新着に気づけない)。
//      visibilitychange復帰時 + 定期(30分毎)にhydrateStaticMarkdownを再実行するためのスロットル状態。
//      非永続(端末内メモリのみ、再起動すれば起動時fetchからやり直しでよい)。
let _lastFeedbackHydrateAt = Date.now();  // 起動時に一度hydrateStaticMarkdown()を呼ぶため、その時刻を起点にする
let _feedbackHydrateInFlight = false;     // 多重発火防止(同時に複数fetchを走らせない)
const FEEDBACK_REFRESH_INTERVAL_MS = 30 * 60 * 1000;  // 定期再fetchの間隔(30分)
const FEEDBACK_REFRESH_MIN_GAP_MS = 60 * 1000;        // visibilitychange連打等の多重発火防止(60秒)
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
// v115: 連続ルーティン(チェーン、提案G②)— 現在フルスクリーンで進行中のチェーンid。非永続
// (nowModeと同じ方針。アプリ再読込で閉じても、各ステップの完了自体はstate.chainRunsに
// 残っているため「続きから」で再開できる)。空文字=非表示。
let _activeChainId = "";
// v79: 月間プランニングボードのカードドラッグ(Pointer Events。既存の下書きBlockドラッグ
//      (_draftDrag)と同じ「pointerdown/move/upで見た目だけ動かしupで正規化」方式を流用)。
//      { id, el, startX, startY, moved } 非永続。moved=trueになって初めてドラッグ確定(タップの
//      月選択セレクト操作を邪魔しないための閾値判定)。
let _wishDrag = null;

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
  // v73: コンディションOS(睡眠/服薬/余力/夜の記録/運動ログ)
  if (action === "set-sleep") setConditionSleep(state.selectedDate, Number(target.dataset.value));
  if (action === "toggle-meds") toggleConditionMeds(state.selectedDate);
  if (action === "set-capacity") setConditionCapacity(state.selectedDate, target.dataset.value);
  if (action === "set-evening-mood") setEveningMood(state.selectedDate, Number(target.dataset.value));
  if (action === "add-gym-entry") addGymEntry(target.dataset.date || state.selectedDate);
  if (action === "delete-gym-entry") deleteGymEntry(target.dataset.date || state.selectedDate, id);
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
  // v97: タスクシュート画面「未完了タスク」の8日後以降の折りたたみトグル(UI状態)
  if (action === "toggle-tasks-show-future") {
    state.settings.tasksShowFuture = !state.settings.tasksShowFuture;
    persistLocalNoSchedule();
    render();
  }
  // v55: WBS インライン編集モードの切替(UI状態)
  if (action === "toggle-wbs-edit") {
    state.settings.wbsEditMode = !state.settings.wbsEditMode;
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
    }
    generateReport();
  }
  if (action === "download-report") downloadReport();
  if (action === "download-data") downloadData();
  if (action === "save-github") saveToGitHub();
  if (action === "load-github") loadFromGitHub();
  // v72: セットアップ画面(トークンゲート)の「設定してはじめる」。dataOwner/dataRepo/token
  // 自体は data-github-field の input ハンドラで既に state.settings.github へ保存済みなので、
  // ここでは再判定して render() するだけ(未入力ならトーストで案内)。
  if (action === "gate-continue") {
    syncGitHubFieldsFromDOM();
    if (!personalDataReady(state.settings.github)) {
      showToast("Owner・Repository・トークンをすべて入力してください");
    } else {
      render();
      syncFromGitHubOnStartup().then(() => hydrateStaticMarkdown());
    }
  }
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
  // v89: ゼロ摩擦ルーティンチェック — 「ここまで全部やった」一括確定
  if (action === "routine-bulk-check") bulkCheckRoutinesUpToNow();
  // v115: 縮退版で実行(提案G①)。idはBlockではなく繰り返しルールのid。
  if (action === "routine-fallback") executeRoutineFallback(id);
  // v115: 連続ルーティン(チェーン、提案G②)— 開始/続きから・進行中の完了・閉じる
  if (action === "chain-run-open") openChainRun(id);
  if (action === "chain-step-complete") chainStepComplete();
  if (action === "chain-run-close") closeChainRun();
  // v115: チェーンのCRUD(新規作成・編集・削除は編集モーダル経由)
  if (action === "chain-new") openChainEditor("");
  if (action === "chain-edit") openChainEditor(id);
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
  if (action === "vision-board-tab") setVisionBoardIndex(Number(target.dataset.index));
  if (action === "vision-board-load") loadVisionBoardPdf(target.dataset.file);  // v101
  if (action === "open-md-in-github") openMdInGithub(target.dataset.path);
  if (action === "reload-md") reloadStaticMarkdown();
  // v92: AIレポートビューア — 種類タブ切替 / 一覧・本文の手動更新
  if (action === "ai-report-type") setAiReportType(target.dataset.type);
  if (action === "ai-report-refresh") refreshAiReports();
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
  // v84: Study With Me トグル(UI操作なのでfullscreenと同じくdataModifiedAtは汚さない)
  if (action === "toggle-study-with-me") {
    state.pomodoro.studyWithMeOn = !state.pomodoro.studyWithMeOn;
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
  // v79: 月間プランニングボードの表示切替(リスト⇔ボード。UI状態のみ)
  if (action === "wish-view-mode") {
    state.wishViewMode = target.dataset.mode || "list";
    persistLocalNoSchedule();
    render();
    // v80: ボードに切り替えた瞬間だけ現在月へ自動スクロール(縦積みリストで1月から
    // 探す手間を省く小さな補助。以後の再描画では毎回スクロール位置を戻さない=
    // ドラッグ中などにユーザーのスクロール位置を奪わないため、ここでの一度きりに限定)
    if (state.wishViewMode === "board") scrollWishBoardToCurrentMonth();
  }
  // v80: 「今月へ」ジャンプボタン(縦積みリストの一覧性補助)
  if (action === "wish-board-jump-current") scrollWishBoardToCurrentMonth();
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
  if (action === "journal-import-ai") {
    const d = target.dataset.date;
    openAiImportModal(d, parseAiFeedback(state.feedback[d] || cachedFeedback[d] || ""));
  }
  if (action === "ai-import-submit") submitAiImport();
  if (action === "ai-mit-adopt") adoptAiMit(Number(target.dataset.index));
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
    _scheduleDraft.items.forEach((it) => recordScheduleHistory(it, "discarded", _scheduleDraft.date, _scheduleDraft.source || "deterministic"));
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
    if (removed) removedHistoryEntry = recordScheduleHistory(removed, "removed", _scheduleDraft.date, _scheduleDraft.source || "deterministic");  // v52: 却下シグナル
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
  // v40: ルーティンの曜日フィルタ解除
  if (action === "routine-clear-day") {
    state.settings.routineDayFilter = null;
    persistLocalNoSchedule();
    render();
  }
});

// v71: ホームの折りたたみカード(details)の開閉をlocalStorageへ即時記憶する。
// "toggle" イベントは bubbles しない仕様のため、document への委譲はキャプチャフェーズで行う
// (キャプチャは非バブリングイベントでもターゲットまでの経路を通過するため、これで拾える)。
document.addEventListener("toggle", (event) => {
  const el = event.target;
  if (!el?.dataset?.foldId) return;
  setHomeFoldOpen(el.dataset.foldId, el.open);
}, true);

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches("[data-journal-date]")) {
    const d = target.dataset.journalDate;
    state.journals[d] = target.value;
    // v106: 本文の編集時刻を記録(端末間マージの新旧判定に使用)
    const meta = (state.journalMeta[d] ||= { aiMitCandidates: [], aiImported: false, ideal: "" });
    meta.textUpdatedAt = nowDateTime();
    saveState();
  }
  // v61: 今日の理想ワンライナー(入力中も保存。全再描画しないのでフォーカスは維持される)
  if (target.matches("[data-ideal-date]")) {
    const d = target.dataset.idealDate;
    const meta = (state.journalMeta[d] ||= { aiMitCandidates: [], aiImported: false, ideal: "" });
    meta.ideal = target.value;
    saveState();
  }
  if (target.matches("[data-feedback-date]")) {
    state.feedback[target.dataset.feedbackDate] = target.value;
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
  // v117(A): 今日の宣言(change時に保存。blur後の確定入力なので全再描画してよい=赤警告の
  // 表示/消灯を即座に反映する)
  if (target.matches("[data-declaration-date]")) {
    const d = target.dataset.declarationDate;
    state.dailyDeclarations[d] = { text: target.value.trim(), updatedAt: nowDateTime() };
    saveAndRender();
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
  if (target.matches("[data-feedback-upload]")) {
    const date = target.dataset.feedbackUpload;
    const file = target.files?.[0];
    if (file) uploadFeedbackFile(date, file);
  }
  // v105: AutoSleep書き出しCSVの取込(ジャーナルタブの睡眠カード)
  if (target.matches("[data-sleep-csv-upload]")) {
    const file = target.files?.[0];
    if (file) importSleepCsv(file);
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
    ...block,
    plannedStartAt: fixDateTime(block.plannedStartAt),
    plannedEndAt: fixDateTime(block.plannedEndAt),
    actualStartAt: fixDateTime(block.actualStartAt),
    actualEndAt: fixDateTime(block.actualEndAt),
    interruptions: Array.isArray(block.interruptions) ? block.interruptions : []  // 壊れた形状は初期化
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
  // v42: 日ごとのメタ(AIフィードバック取り込み由来。journals は文字列なので別ストア)
  value.journalMeta ||= {};
  Object.values(value.journalMeta).forEach((j) => {
    if (!Array.isArray(j.aiMitCandidates)) j.aiMitCandidates = [];
    if (!("aiImported" in j)) j.aiImported = false;
    if (!("ideal" in j)) j.ideal = "";  // v61: 今日の理想ワンライナー(提案8)
    if (!("textUpdatedAt" in j)) j.textUpdatedAt = "";  // v106: 本文編集時刻(同期マージの新旧判定)
  });
  // v61: マイグレーション儀式(3回目以降の繰り越し確認)の選択ログ。将来のバッチ分析用に軽量記録。
  if (!Array.isArray(value.migrationRitualLog)) value.migrationRitualLog = [];
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
  value.projects = value.projects.map((p) => ({ priority: "中", showProgress: false, ...p }));
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
    orderIndex: 0,
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
}

function render() {
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
        ${_personalDataAuthError ? `<div class="muted" style="color:#c0392b; font-size:12px; margin-top:6px">⚠ ${escapeHTML(_personalDataAuthError)}</div>` : ""}
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

function renderMain() {
  // v70: Now画面(実行コンベア)は全ビューに優先する全画面オーバーレイ(閉じるまで通常UIへ戻らない)
  if (nowMode) {
    main.innerHTML = renderNowConveyor();
    return;
  }
  // v115: 連続ルーティン(チェーン)の進行中も同様に全画面優先で表示する
  if (_activeChainId) {
    main.innerHTML = renderChainRun();
    return;
  }
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
  if (view === "ai-reports") main.innerHTML = renderAiReports();
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
    ${bufferMeterHTML()}
  `;
}

// =============================================================
// v31: ホーム(コックピット)— 信条 / 残り時間 / 行動パネル群
// =============================================================
// v71: 情報過多だったコックピットを整理。
//   最上部(常時表示・折りたたみ無し): Now(いま、これ)→ MIT(今日の主役)→ 「AIから」
//     (鮮度/AI作業結果/AIフィードバック候補の集約カード)→ スコアボード → 今日、すすめる/今日のリズム
//     (実行系ゾーンは従来どおり展開のまま)。
//   参照系(信条・寿命カウントダウン・長い弧・足あと)は折りたたみ既定closedにして下段へ。
//   開閉状態はlocalStorage記憶(homeFoldSection / isHomeFoldOpen+setHomeFoldOpen)。詳細はCHANGES_v71.md。
function renderHome() {
  const today = state.selectedDate;
  const isToday = today === todayISO();
  const blocks = blocksForDate(today);
  const metrics = computeMetrics();
  // v73: 縮退モード。今日を見ている時だけ発火する(過去日を振り返っている時にまで
  //      「最低限だけ」と出すのは意味が違うため)。
  const degraded = isToday && isConditionDegraded(today);
  return `
    ${renderHeader("今日の入口", "ホーム", `<div class="row" style="gap:8px">
      <button class="btn orange" data-action="now-mode-open">▶ Now</button>
      <button class="btn primary" data-action="today">今日へ</button>
    </div>`)}
    ${renderDateBar()}
    ${homeFoldSection("creed", true, "home-creed", "home-creed-head", "三 つ の 信 条", homeCreedBody())}
    ${homeFoldSection("lifespan", true, "", "", "寿命カウントダウン(残り時間)", homeLifespanBody(metrics))}
    ${homeIdeal(isToday)}
    ${homeDeclarationCard()}
    ${degraded ? "" : homeReadingCard()}
    ${degraded ? homeDegradedBanner() : homeRoutineCheckBanner(blocks, isToday)}
    ${homeHero(blocks, isToday)}
    <div id="home-mit-anchor">${homeMIT(blocks)}</div>
    ${degraded
      ? homeFoldSection("ai-hub-degraded", false, "home-ai-hub", "", "AIから(たたんでいます)", homeAiHubBody(blocks, isToday))
      : homeAiHub(blocks, isToday)}
    ${homeScoreboard(blocks)}
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
        <details class="home-fold" data-fold-id="zone2" ${isHomeFoldOpen("zone2", false) ? "open" : ""}>
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
    <div class="home-zone-block z-blue" id="homezone-3">
      <details class="home-fold" data-fold-id="zone3" ${isHomeFoldOpen("zone3", false) ? "open" : ""}>
        <summary class="home-zone blue home-fold-summary"><span class="home-fold-chevron">▶</span>長い弧をたしかめる</summary>
        <div class="home-fold-body">
          <div class="home-grid">
            ${homeCycle(metrics)}
            ${homeBacklog()}
            ${homeQuestions()}
          </div>
          ${homeWeeklyLink()}
        </div>
      </details>
    </div>
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
// 赤警告は「今日」を見ていて未入力の時だけ(過去日を振り返っているときに警告するのは筋違い)。
function homeDeclarationCard() {
  const date = state.selectedDate;
  const isToday = date === todayISO();
  const entry = state.dailyDeclarations[date] || { text: "", updatedAt: "" };
  const showAlert = isToday && !(entry.text || "").trim();
  return `<section class="panel home-declaration-card" style="padding:12px 14px">
    <div class="muted" style="font-size:12px; font-weight:700; margin-bottom:6px">📣 今日の宣言</div>
    <input type="text" class="input" style="font-size:16px" maxlength="80"
      data-declaration-date="${date}" placeholder="今日◯◯に着手する" value="${escapeHTML(entry.text || "")}">
    ${showAlert ? `<div class="home-declaration-alert" style="color:var(--red); font-size:12px; font-weight:700; margin-top:6px">⚠️ 今日の宣言が未入力です</div>` : ""}
  </section>`;
}

// 3日目の「続ける/手放す」選択を解決する
function resolveIdealRetry(choice) {
  const today = todayISO();
  const active = idealActiveEntry(today);
  if (!active || active.dayNum < IDEAL_RETRY_WINDOW_DAYS) return;
  if (choice === "continue") {
    // 今日を起点に新しい3日間サイクルを始める(同じ理想のまま継続)
    const meta = (state.journalMeta[today] ||= { aiMitCandidates: [], aiImported: false, ideal: "" });
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
  const act = b.completed ? "toggle-block" : "complete-block-with-actual";
  return `<div class="home-ck ${b.completed ? "done" : ""}">
    <span class="home-box" data-action="${act}" data-id="${b.id}">${b.completed ? "✓" : ""}</span>
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
  return `<section class="panel"><div class="home-plabel green">今日のルーティン</div>
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
// v88: 表示過多対策として「当日〜+3日」を既定表示、「+4日以降」は既存のhomeFoldSection
// (details、開閉記憶あり)に格納する(完全非表示にはしない=見えなくなる事故防止)。
// 期限切れ(dueDate < 当日)は従来どおり最優先で常時表示(当日+3日の枠に自然に含まれる)。
// 期限なしタスクは従来から除外(t.dueDate の真偽チェック)で、この扱いは変更していない。
function homeBacklog() {
  const excluded = state.projects
    .filter((p) => p.kind === "wish" || p.kind === "other")
    .map((p) => p.id);
  // v33: 期限切れ + 当日から1週間以内のタスクのみ(期限なしは除外)。量が多すぎる対策。
  // v88: この7日という全体の取得上限は維持し、その中を「当日+3日」で表示/折りたたみに分ける。
  const limit = addDays(state.selectedDate, 7);
  const nearLimit = addDays(state.selectedDate, 3);
  const tasks = state.tasks
    .filter((t) => !t.deleted && !isTaskDead(t) && !excluded.includes(t.projectId)
      && t.dueDate && t.dueDate <= limit)
    .sort((a, b) => (a.dueDate || "99").localeCompare(b.dueDate || "99"));
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
    const overdue = t.dueDate < state.selectedDate;
    const due = `締切 ${t.dueDate.slice(5).replace("-", "/")}`;
    const todayBadgeHTML = todayCount > 0
      ? ` <span style="color:var(--green); font-weight:600">/ 本日 ${todayCount} 件追加済み</span>` : "";
    return `<div class="home-due${overdue ? " overdue" : ""}">
      <div class="home-due-main" data-action="edit-task" data-id="${t.id}">
        <div class="home-due-name">${escapeHTML(t.title)}</div>
        <div class="home-due-sub">${escapeHTML(projectName(t.projectId))} ・ ${due}${overdue ? "(期限切れ)" : ""}${todayBadgeHTML}</div>
      </div>
      <button class="btn ghost home-add" data-action="home-add-today" data-id="${t.id}" style="font-size:11px;padding:7px 10px">＋今日に追加</button>
    </div>`;
  };
  const nearTasks = tasks.filter((t) => t.dueDate <= nearLimit);
  const farTasks = tasks.filter((t) => t.dueDate > nearLimit);
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
let _zeroSecThemeDraft = null;  // v75: AIプラン_*.jsonのzeroSecThemes提案(0秒思考テーマ)。{ date, items:[{theme,reason}] } 非永続(_scheduleDraftと同じ思想)

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

// 配置候補: 昨日のMIT候補 + WBSの未完了タスク(Wish/中断/今日Block化済みを除く、期限順)
// v77: 詰め込み防止の第一段 — dueDateが対象日より後(翌日以降)のタスクは候補から除外する。
//      期限なし(dueDate未設定)のタスクは対象に残す(wbsTaskCompareが "9999" 扱いで
//      最後尾ソートするため、期限付きタスクを圧迫せず、空いた枠があれば埋める filler として働く)。
//      期限が対象日以前(=期日超過・当日締切)のタスクは当然対象。
function aiScheduleCandidates(date) {
  const out = [];
  const prev = addDays(date, -1);
  (state.journalMeta[prev]?.aiMitCandidates || []).forEach((t, i) =>
    out.push({ id: `mit-${i}`, title: t, taskId: "", category: "", note: "MIT候補" }));
  const wishIds = new Set(state.projects.filter((p) => p.kind === "wish").map((p) => p.id));
  state.tasks
    .filter((t) => !t.deleted && (t.status === "todo" || t.status === "doing") && t.projectId && !wishIds.has(t.projectId))
    .filter((t) => !isTaskSuspended(t))
    .filter((t) => !t.dueDate || t.dueDate <= date)  // v77: 翌日以降が期限のタスクは今日の下書きに詰め込まない
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
//      (この画面には繰越候補が無いため実質「MIT候補→WBS」の優先順)。
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
  const sourceLabel = _scheduleDraft.source === "ai-plan" ? "🤖 AIプラン由来" : "⚙ 決定論配置";
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
    recordScheduleHistory(it, "confirmed", date, draftSource);
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

// v60: 決定論配置(唯一の配置経路。旧称フォールバックのまま維持): MIT候補 → 繰越 → WBS の順に、
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
  const rank = (c) => (c.carryFromId ? 1 : (String(c.id).startsWith("mit-") ? 0 : 2));  // MIT=0 → 繰越=1 → WBS=2
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
}

// v59: 朝の一括プランニングの自動起動(opt-in・既定OFF)。maybeAutoMorningReview と同じパターン。
//      その日初めてアプリを開いたのが10:00以前 かつ 当日の非ルーティンBlockが0件のときだけ実行し、
//      1日1回ガード(localStorage)。ガードは実行を決めた時点で立てるため、破棄しても再自動起動しない。
const AUTO_MORNING_PLAN_KEY = "taskchute-auto-morning-plan-date";  // 端末ローカル

function maybeAutoMorningPlan() {
  if (!state.settings.ai?.autoMorningPlan) return;
  const today = todayISO();
  try {
    if (localStorage.getItem(AUTO_MORNING_PLAN_KEY) === today) return;  // 1日1回(失敗・破棄後も再試行しない)
  } catch { /* 読めなければ続行 */ }
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() > 10 * 60) return;  // 10:00より後の初回起動は対象外
  const hasNonRoutineToday = state.blocks.some((b) =>
    !b.deleted && b.date === today && b.category !== "ルーティン" && !b.recurrenceGroupId);
  if (hasNonRoutineToday) return;  // 既に当日のBlockがあれば白紙提案の出番ではない
  try { localStorage.setItem(AUTO_MORNING_PLAN_KEY, today); } catch { /* 記録できなくても続行 */ }
  // v62: runAiMorningPlan は AIプランJSONのfetchを含むため async 化した。同期 throw は
  //      try/catch で、非同期 reject は .catch() で拾い、どちらも静かに握りつぶす(手動実行は常に可能)。
  try {
    runAiMorningPlan({ auto: true }).catch((error) => {
      console.warn("朝プラン自動下書きをスキップ:", error.message);
    });
  } catch (error) {
    console.warn("朝プラン自動下書きをスキップ:", error.message);
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

// v79: 月間プランニングボードのカードD&D(Pointer Events。iPadタッチ対応)。
// 上の下書きBlockドラッグと同じ「pointerdown/move/upで見た目だけ動かし、upでstateに反映して
// render()で正規化」方式を流用しつつ、こちらは連続位置ではなく「どの月枠の上で離したか」を
// document.elementFromPoint で判定する離散ドロップ。移動量が閾値未満はタップ(カード上の月選択
// セレクト操作)とみなし何もしない。
const WISH_DRAG_THRESHOLD = 8; // px
document.addEventListener("pointerdown", (event) => {
  const card = event.target.closest(".wish-board-card");
  if (!card) return;
  if (event.target.closest("[data-action]")) return;  // 月選択セレクトは通常のタップ操作に譲る
  _wishDrag = { id: card.dataset.wishDragId, el: card, startX: event.clientX, startY: event.clientY, moved: false };
});
document.addEventListener("pointermove", (event) => {
  if (!_wishDrag) return;
  const dx = event.clientX - _wishDrag.startX;
  const dy = event.clientY - _wishDrag.startY;
  if (!_wishDrag.moved && Math.hypot(dx, dy) < WISH_DRAG_THRESHOLD) return;
  _wishDrag.moved = true;
  _wishDrag.el.classList.add("is-dragging");
  _wishDrag.el.style.transform = `translate(${dx}px, ${dy}px)`;
  document.querySelectorAll(".month-zone.drag-over").forEach((z) => z.classList.remove("drag-over"));
  const zone = document.elementFromPoint(event.clientX, event.clientY)?.closest(".month-zone");
  if (zone) zone.classList.add("drag-over");
  event.preventDefault();
});
const endWishDrag = (event) => {
  if (!_wishDrag) return;
  const { id, el, moved } = _wishDrag;
  el.classList.remove("is-dragging");
  el.style.transform = "";
  document.querySelectorAll(".month-zone.drag-over").forEach((z) => z.classList.remove("drag-over"));
  if (moved && event) {
    const zone = document.elementFromPoint(event.clientX, event.clientY)?.closest(".month-zone");
    if (zone) {
      const monthStr = zone.dataset.month || "";
      updateTaskField(id, "targetMonth", monthStr ? Number(monthStr) : null);
    }
  }
  _wishDrag = null;
  if (moved) render();  // カード位置をstateどおりに正規化(ドロップ先が無ければ元の位置に戻る)
};
document.addEventListener("pointerup", endWishDrag);
document.addEventListener("pointercancel", () => {
  if (!_wishDrag) return;
  _wishDrag.el.classList.remove("is-dragging");
  _wishDrag.el.style.transform = "";
  document.querySelectorAll(".month-zone.drag-over").forEach((z) => z.classList.remove("drag-over"));
  _wishDrag = null;
});

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
function leverageJudgeHelperHTML() {
  return `
    <details class="lev-helper">
      <summary>10秒で判定する(任意)</summary>
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
// 戻り値: Wishタスクを実際に作成できたか。normalizeStateがWish Projectの存在を必ず保証する
// ため通常は false にならないが、念のための防御(v61レビュー対応: トースト文言の実態合わせ)。
function moveBlockToWish(id) {
  const src = blockById(id);
  if (!src) return false;
  const wishProject = getWishProject();
  if (!wishProject) return false;
  const task = makeTask({ projectId: wishProject.id, title: src.title });
  // v79: addWish()と同じ理由でdueDateの「今日」既定を持ち込まない(Wishは期限任意)。
  task.dueDate = "";
  state.tasks.push(task);
  return true;
}

// 選択結果を軽量ログに記録(将来のバッチ分析用。aiScheduleHistoryと同じ思想)
function logMigrationRitual(block, choice) {
  state.migrationRitualLog.push({
    blockId: block?.id || "",
    title: block?.title || "",
    carryCount: (block?.carryCount || 0) + 1,
    choice,  // 'today' | 'decompose' | 'release' | 'avoid' | 'carry'
    at: nowDateTime()
  });
  if (state.migrationRitualLog.length > MIGRATION_RITUAL_LOG_MAX) {
    state.migrationRitualLog = state.migrationRitualLog.slice(-MIGRATION_RITUAL_LOG_MAX);
  }
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
  const lastMs = localDateTimeToMs(last); // v56: updatedAt はローカル日時文字列。iOS TZ 誤解釈回避
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

  // v79: 表示切替(リスト⇔ボード)。UI状態のみ・dataModifiedAtは汚さない(routineViewModeと同じ扱い)。
  const viewMode = state.wishViewMode || "list";

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

    <div class="segmented" style="margin-top:8px">
      <button class="${viewMode === "list" ? "active" : ""}" data-action="wish-view-mode" data-mode="list">☰ リスト</button>
      <button class="${viewMode === "board" ? "active" : ""}" data-action="wish-view-mode" data-mode="board">🗓 月間ボード</button>
    </div>

    ${viewMode === "board" ? renderWishBoard(wishes) : (groupOrder.length === 0
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
      `).join(""))}
  `;
}

// v79: 月間プランニングボード ==============================
// 「未定」プール + 1〜12月の枠。ドラッグ&ドロップ(iPadタッチ対応: pointer events)+
// タップ代替(カード上の月選択セレクト)の両方で targetMonth を割り当てる。
// wishes は renderWish() で既にarea/showRealizedフィルタ済みのものをそのまま使う。
//
// v80: レイアウトを「小さい固定グリッド」から縦積みリスト型に変更。
// 理由(Kフィードバック: 「月カードが小さくて、入れるとやりたいことが見切れてしまう」):
// 旧実装は auto-fill grid(minmax(150px,1fr))で、主端末のiPhone(縦持ち・幅約390px)では
// 実質2列にしかならず、カード幅が狭すぎてタイトルが省略記号(ellipsis)で切れていた。
// 1〜12月を縦一列に並べれば、カード幅は画面幅いっぱいまで使えるためタイトルを折り返せる。
// 空月まで毎回フルサイズの枠を描くと12ヶ月分でスクロールが長大になるため、
// 中身が無い月はヘッダ行だけの薄い行に縮小する(=ドロップ先としても残す。month-zoneは
// 行全体に付けているので、空月でも「ヘッダだけの行」自体がドロップターゲットになる)。
function renderWishBoard(wishes) {
  const unassigned = wishes.filter((w) => !w.targetMonth);
  const currentMonth = Number(todayISO().slice(5, 7));  // "YYYY-MM-DD" の月部分(文字列抽出。new Date(string)は使わない)
  const monthGroups = Array.from({ length: 12 }, (_, i) => i + 1)
    .map((m) => ({ month: m, items: wishes.filter((w) => w.targetMonth === m) }));

  return `
    <section class="section wish-board" style="margin-top:14px">
      <div class="wish-board-pool">
        <div class="row" style="margin-bottom:6px; align-items:center">
          <h3>未定</h3>
          <div class="muted">${unassigned.length} 件</div>
        </div>
        <div class="wish-board-pool-body month-zone" data-month="">
          ${unassigned.length === 0
            ? `<div class="muted" style="font-size:12px; padding:8px">すべて月に割り当て済みです</div>`
            : unassigned.map(renderWishBoardCard).join("")}
        </div>
      </div>

      <div class="row wish-board-toolbar">
        <div class="muted" style="font-size:11px">1月〜12月を縦に並べています。空の月はヘッダのみ表示です。</div>
        <button class="btn ghost" data-action="wish-board-jump-current">📍 ${currentMonth}月(今月)へ</button>
      </div>

      <div class="wish-board-list">
        ${monthGroups.map(({ month, items }) => `
          <div class="wish-board-month-row month-zone ${items.length === 0 ? "is-empty" : ""} ${month === currentMonth ? "is-current" : ""}"
               data-month="${month}" data-month-row="${month}">
            <div class="wish-board-month-head">
              <strong>${month}月</strong>
              ${month === currentMonth ? `<span class="wish-board-current-badge">今月</span>` : ""}
              <span class="muted" style="font-size:11px">${items.length > 0 ? `${items.length}件` : "空き"}</span>
            </div>
            ${items.length > 0
              ? `<div class="wish-board-month-body">${items.map(renderWishBoardCard).join("")}</div>`
              : ""}
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

// v80: 月間ボードを現在月の行までスクロール(自動起動時・「今月へ」ボタン共用)
function scrollWishBoardToCurrentMonth() {
  const currentMonth = Number(todayISO().slice(5, 7));
  setTimeout(() => {
    document.querySelector(`[data-month-row="${currentMonth}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 60);
}

// 月間ボードのカード1個(ドラッグ対象 + タップ代替の月選択セレクト同居)。
// v80: タイトルを単一行ellipsisから2行までのline-clampへ変更(見切れ対策の本丸)。
function renderWishBoardCard(wish) {
  const areaColor = lifeAreaColor(wish.lifeArea);
  const monthOptions = [
    `<option value="">未定</option>`,
    ...Array.from({ length: 12 }, (_, i) => i + 1)
      .map((m) => `<option value="${m}" ${wish.targetMonth === m ? "selected" : ""}>${m}月</option>`)
  ].join("");
  return `
    <div class="wish-board-card" draggable="true" data-wish-drag-id="${wish.id}" style="border-left:3px solid ${areaColor}">
      <div class="wish-board-card-main">
        <span class="wish-board-card-title" title="${escapeHTML(wish.title)}">${escapeHTML(wish.title)}</span>
        ${wish.lifeArea ? `<span class="wish-board-card-area" style="color:${areaColor}">${escapeHTML(wish.lifeArea)}</span>` : ""}
      </div>
      <select class="select wish-board-card-month" data-action="wish-set-month" data-id="${wish.id}" aria-label="月を選ぶ">${monthOptions}</select>
    </div>
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
        <label class="wish-check-wrap">
          <input type="checkbox" class="wish-check" data-action="${wish.realized ? "wish-unrealize" : "wish-realize"}" data-id="${wish.id}" ${wish.realized ? "checked" : ""} title="実現済みにする" aria-label="実現済みにする">
        </label>
        <div style="flex:1; min-width:0">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap">
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
        <div class="muted" style="font-size:11px; margin-bottom:4px">期限(任意。週次レビューで参照)</div>
        <input class="input" type="date" data-action="wish-set-duedate" data-id="${wish.id}" value="${wish.dueDate || ""}">
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
  // v79: makeTask の dueDate 既定(未指定時="今日")はタスクシュート実行前提の値で、
  //      長期的な「やりたいこと」には合わないため、Wish作成時だけ空に戻す(期限は任意)。
  task.dueDate = "";
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
  // v79: addWish()と同じ理由でdueDateの「今日」既定を持ち込まない(Wishサブタスクも期限は任意)。
  //      Kフォローアップ指示: Wish関連の全作成経路でdueDateが既定で埋まらないようにする。
  sub.dueDate = "";
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
  // v79: ネイティブcheckboxはクリック時点でchecked属性が先に反転済みのため、confirmを
  // キャンセルしてここでreturnするだけだとチェックが見た目だけONに残ってしまう(state.realized
  // は変わっていないのに)。render()でDOMをstateに合わせて戻す。
  if (!window.confirm("このやりたいことを「実現済み」にしますか?")) { render(); return; }
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
  const overdue = task.dueDate && task.dueDate < todayISO() && task.status !== "completed";
  const dueHTML = task.dueDate
    ? `<span class="${overdue ? "wbs-overdue" : "muted"}" style="font-size:11px">期限 ${task.dueDate.slice(5).replace("-", "/")}${overdue ? "!" : ""}</span>`
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
    ${aiMitChips()}
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
  // v37: Wish Project 配下のタスクは専用「やりたい」タブで扱うため、ここには出さない
  //      (WBS・ホームの未完了リストと同じ除外基準に揃える)
  const wishProjectIds = state.projects.filter((p) => p.kind === "wish").map((p) => p.id);
  // v107: K指示により期日未設定Taskは一覧から除外する(v97時点は「期日未設定は常に表示」
  //       だったが、期日昇順ソートの導入とあわせて廃止。データは消さない=期日を設定すれば表示される)。
  const open = state.tasks.filter((task) => !task.deleted && !isTaskDead(task) && task.kind !== "other"
    && !wishProjectIds.includes(task.projectId) && Boolean(task.dueDate));
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
            <div class="muted" style="font-size:12px">${escapeHTML(projectName(task.projectId))} / ${escapeHTML(task.category || "カテゴリなし")}${dueLabel}${todayCount > 0 ? ` <span style="color:var(--green); font-weight:600">/ 本日 ${todayCount} 件 Block 追加済み</span>` : ""}</div>
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
        ${task ? `<button class="task-complete-toggle ${task.status === "completed" ? "done" : ""}" data-action="toggle-task-complete" data-id="${block.id}" title="タスク完了(Task本体を完了にします)" aria-label="タスク完了">🏁</button>` : ""}
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
      ${!_scheduleDraft ? `<button class="btn" data-action="ai-schedule">📋 下書きスケジュール</button>` : ""}
      ${mode === "planned" && state.selectedDate === todayISO()
        ? `<button class="btn" data-action="bulk-approve-planned">✅ 予定通りだった(一括承認)</button>` : ""}
      <span class="muted" style="font-size:12px">空き時間タップで追加 / ○タップで完了登録 / ▶いま開始・■いま終了でワンタップ実績 / カードタップで編集 / 赤線は現在時刻</span>
    </div>
    ${draftBarHTML()}
    ${zeroSecThemeBarHTML()}
    ${draftRejectReasonPickerHTML()}
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
  // v70: ワンタップ実績(▶いま開始 / ■いま終了)。既存○ボタン(完了登録モーダル)とは別の軽量アクション。
  //      実績モード・極小カード・完了済みは既存○ボタンと同じ理由で対象外。
  const started = Boolean(block.actualStartAt);
  const inProgress = started && !block.completed && !block.actualEndAt;
  const startEndBtn = (!isActual && !isShort && !block.completed)
    ? (!started
      ? `<button class="tl-start-btn" data-action="now-start" data-id="${block.id}" aria-label="いま開始">▶</button>`
      : (inProgress ? `<button class="tl-start-btn tl-end-btn" data-action="now-end" data-id="${block.id}" aria-label="いま終了">■</button>` : ""))
    : "";

  return `
    <div class="timeline-card ${block.completed ? "completed" : ""} ${isActual ? "is-actual" : ""} ${isShort ? "is-short" : ""}"
         ${overflowAttr}
         style="top:${top}px; height:${height}px; left:${leftPercent}%; width:calc(${widthPercent}% - 4px); ${catStyle}"
         data-action="edit-block" data-id="${block.id}">
      ${!isActual && !isShort ? `<button class="tl-complete-btn" data-action="complete-block-with-actual" data-id="${block.id}" aria-label="完了登録">○</button>` : ""}
      ${startEndBtn}
      <div class="tl-card-body">
        <strong>${escapeHTML(block.title)}${migrationBadgeHTML(block.carryCount)}${leverageTypeMarkHTML(block.leverageType)}</strong>
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


// v38: 朝の体調ピッカー(ジャーナル当日編集の上部)。
//      記録するとエネルギーグラフの始点と、ジャーナル本文の「朝の体調」行に反映される。
//      これまで setMorningEnergy は存在するのに呼び出すUIがなく、常に既定値(5)だった。
function renderMorningEnergyPicker(date) {
  const current = state.settings.morningEnergyLog?.[date];
  return `
    <div class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:10px; align-items:center">
      <span class="muted" style="font-size:12.5px; font-weight:700">🌅 朝の体調</span>
      ${energyLevels.map((l) => `
        <button class="btn ${current === l.value ? "primary" : "ghost"}" style="font-size:12px; padding:6px 10px; min-height:44px; display:inline-flex; align-items:center"
          data-action="set-morning" data-value="${l.value}">${l.label}</button>
      `).join("")}
      ${current === undefined ? `<span class="muted" style="font-size:11px">未記録(タップで記録 → エネルギーグラフの始点になります)</span>` : ""}
    </div>
  `;
}

// v73: コンディションOS ==========================================================
// 「朝の体調」欄(上のrenderMorningEnergyPicker)を入口として拡張する。体調の値そのものは
// 既存の morningEnergyLog を継続利用し(二重管理を避ける)、ここでは睡眠・服薬・今日の余力
// という新しい軽量フィールドだけを state.condition.logs[date] に足す。
const CONDITION_SLEEP_PRESETS = [5, 6, 7, 8, 9];  // 9は「9h+」表記
const CONDITION_CAPACITY_OPTIONS = [
  { value: "full", label: "全力でいける" },
  { value: "normal", label: "普通" },
  { value: "minimal", label: "最低限で" }
];

function renderConditionMorningExtra(date) {
  const log = state.condition.logs[date] || {};
  return `
    <div class="cond-row" style="margin-bottom:8px">
      <span class="muted cond-row-label">💤 睡眠</span>
      <span class="row cond-btn-row">
        ${CONDITION_SLEEP_PRESETS.map((h) => `
          <button class="btn ${log.sleepHours === h ? "primary" : "ghost"}" style="font-size:12px; padding:6px 10px; min-height:44px; display:inline-flex; align-items:center"
            data-action="set-sleep" data-value="${h}">${h}${h === 9 ? "h+" : "h"}</button>
        `).join("")}
      </span>
    </div>
    <div class="cond-row" style="margin-bottom:8px">
      <span class="muted cond-row-label">💊 服薬</span>
      <button class="btn ${log.meds ? "primary" : "ghost"}" style="font-size:12px; padding:6px 10px; min-height:44px; display:inline-flex; align-items:center" data-action="toggle-meds">
        ${log.meds ? "済み" : "まだ"}
      </button>
    </div>
    <div class="cond-row" style="margin-bottom:10px">
      <span class="muted cond-row-label">🔋 今日の余力</span>
      <span class="row cond-btn-row">
        ${CONDITION_CAPACITY_OPTIONS.map((c) => `
          <button class="btn ${log.capacity === c.value ? "primary" : "ghost"}" style="font-size:12px; padding:6px 10px; min-height:44px; display:inline-flex; align-items:center"
            data-action="set-capacity" data-value="${c.value}">${c.label}</button>
        `).join("")}
      </span>
    </div>
    <div class="muted cond-week-note" style="font-size:11px; margin-bottom:10px">📝 今週は${conditionRecordedCountThisWeek()}回書けました</div>
  `;
}

// 夜の記録: 体調(朝と同じ5段階を再利用)+ ひとこと(任意)。加点式のため空欄でも何も咎めない。
function renderEveningConditionCard(date) {
  const log = state.condition.logs[date] || {};
  return `
    <div class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px; align-items:center">
      <span class="muted" style="font-size:12.5px; font-weight:700">🌙 夜の体調</span>
      ${energyLevels.map((l) => `
        <button class="btn ${log.eveningMood === l.value ? "primary" : "ghost"}" style="font-size:12px; padding:6px 10px; min-height:44px; display:inline-flex; align-items:center"
          data-action="set-evening-mood" data-value="${l.value}">${l.label}</button>
      `).join("")}
    </div>
    <input type="text" class="cond-evening-note" maxlength="80" placeholder="今日のひとこと(任意)"
      data-condition-note-date="${date}" value="${escapeHTML(log.eveningNote || "")}" style="margin-bottom:10px">
  `;
}

// 運動記録: 体調記録の入口から1タップで追記。「①タスク名から目標重量を表示」は無理をせず見送り、
// 代わりに同じ種目の直近記録を軽い目安として添えるだけに留める(CHANGES_v73.md参照)。
const CONDITION_GYM_PRESETS = ["ベンチプレス", "デッドリフト", "スクワット"];

function lastGymRecord(exercise, excludeDate) {
  const rows = [];
  Object.entries(state.condition.logs).forEach(([date, log]) => {
    if (date === excludeDate) return;
    (log.gym || []).forEach((g) => { if (g.exercise === exercise) rows.push({ date, ...g }); });
  });
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return rows[0] || null;
}

function renderGymLogCard(date) {
  const log = state.condition.logs[date] || {};
  const entries = (log.gym || []).slice().reverse();
  return `
    <div class="cond-gym-card" style="margin-bottom:10px">
      <span class="muted" style="font-size:12.5px; font-weight:700">🏋 運動記録</span>
      <div class="row cond-gym-add" style="gap:6px; flex-wrap:wrap; margin-top:6px">
        <input type="text" id="gym-exercise-input" list="gym-exercise-presets" placeholder="種目" class="cond-gym-input" style="width:120px">
        <datalist id="gym-exercise-presets">${CONDITION_GYM_PRESETS.map((p) => `<option value="${escapeHTML(p)}">`).join("")}</datalist>
        <input type="number" id="gym-weight-input" placeholder="kg" class="cond-gym-input" style="width:70px" step="2.5" min="0">
        <span class="muted">kg ×</span>
        <input type="number" id="gym-reps-input" placeholder="回" class="cond-gym-input" style="width:60px" min="0">
        <button class="btn primary" style="font-size:12px; padding:6px 12px" data-action="add-gym-entry" data-date="${date}">記録</button>
      </div>
      ${entries.length ? `<div class="cond-gym-list" style="margin-top:8px">
        ${entries.map((g) => {
          const best = lastGymRecord(g.exercise, date);
          return `<div class="home-ck">
            <span class="home-ck-name">${escapeHTML(g.exercise)} ${g.weight}kg × ${g.reps}${best ? `<span class="muted" style="font-size:11px"> (前回 ${best.weight}kg×${best.reps} / ${best.date})</span>` : ""}</span>
            <button class="btn ghost" style="font-size:11px; padding:4px 8px" data-action="delete-gym-entry" data-date="${date}" data-id="${g.id}">×</button>
          </div>`;
        }).join("")}
      </div>` : `<div class="muted" style="font-size:11px; margin-top:6px">まだ記録がありません</div>`}
    </div>
  `;
}
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

async function importSleepCsv(file) {
  let records;
  try {
    records = parseSleepCsv(await file.text());
  } catch (e) {
    showToast("CSVの読み込みに失敗しました");
    return;
  }
  const imported = {};  // 起床日 → ログ。同日複数行(昼寝セッション)は睡眠が長い方を採用
  records.forEach((r) => {
    const wakeM = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/.exec(r["起床時間"] || "");
    if (!wakeM) return;
    const bedM = /(\d{2}):(\d{2}):\d{2}$/.exec(r["就寝時間"] || "");
    const rec = {
      bed: bedM ? `${bedM[1]}:${bedM[2]}` : "",
      wake: `${wakeM[2]}:${wakeM[3]}`,
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
    const date = wakeM[1];
    if (!imported[date] || (rec.sleepH || 0) > (imported[date].sleepH || 0)) imported[date] = rec;
  });
  const count = Object.keys(imported).length;
  if (!count) {
    showToast("睡眠データを読み取れませんでした(AutoSleepの書き出しCSVか確認してください)");
    return;
  }
  Object.assign(state.sleep.logs, imported);
  saveAndRender(`睡眠ログ ${count}日分を取り込みました`);
}

function hoursLabel(v) {
  if (v == null) return "–";
  return `${Math.floor(v)}h${String(Math.round((v % 1) * 60)).padStart(2, "0")}m`;
}

function renderSleepCard(date) {
  const log = state.sleep.logs[date];
  const uploadBtn = (danger) => `
    <label class="btn ${danger ? "danger" : "ghost"}" style="font-size:12px; padding:6px 10px; cursor:pointer; white-space:nowrap">
      📤 睡眠CSV
      <input type="file" accept=".csv,text/csv" data-sleep-csv-upload hidden>
    </label>`;
  if (!log) {
    // 未アップロード: 今日を開いている時は赤帯で警告(毎朝アップする運用)。過去日は控えめに。
    const isToday = date === todayISO();
    return `
      <div class="row" style="margin-bottom:10px; padding:10px 12px; border-radius:10px; justify-content:space-between; align-items:center; ${isToday ? "background:var(--red-soft); border:1.5px solid var(--red)" : "background:var(--panel-soft)"}">
        <span style="font-size:13px; font-weight:700; ${isToday ? "color:var(--red)" : "color:var(--muted)"}">${isToday ? "⚠️ 前夜の睡眠CSVが未アップロードです" : "💤 この日の睡眠ログはありません"}</span>
        ${uploadBtn(isToday)}
      </div>`;
  }
  const chip = (label, val) => `<span style="font-size:12px"><span class="muted">${label}</span> <b>${val}</b></span>`;
  return `
    <div class="row" style="margin-bottom:10px; padding:10px 12px; border-radius:10px; background:var(--panel-soft); justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px">
      <span class="row" style="gap:10px; flex-wrap:wrap; align-items:center">
        <span style="font-size:13px; font-weight:700">💤 前夜の睡眠</span>
        ${chip("就寝→起床", `${log.bed || "–"}→${log.wake || "–"}`)}
        ${chip("睡眠", hoursLabel(log.sleepH))}
        ${chip("効率", log.eff == null ? "–" : `${Math.round(log.eff)}%`)}
        ${chip("深さ", hoursLabel(log.deepH))}
        ${log.hrSleep != null ? chip("HR", Math.round(log.hrSleep)) : ""}
        ${log.hrvSleep != null ? chip("HRV", Math.round(log.hrvSleep)) : ""}
      </span>
      ${uploadBtn(false)}
    </div>`;
}

function renderJournal() {
  ensureJournal(state.selectedDate);
  const previous = addDays(state.selectedDate, -1);
  const date = state.selectedDate;
  // AIフィードバックは git ファイル(優先)→ なければ localStorage の textarea
  const feedbackFromFile = cachedFeedback[date];
  const feedbackFromState = state.feedback[date] || "";
  const feedbackText = feedbackFromFile || feedbackFromState;
  // v76: 「前日のフィードバックも見る」は選択中日付(previous = selectedDateの前日)基準ではなく、
  // 今日基準の前日(hydrateStaticMarkdownが無条件fetchする唯一の前日ファイル)に固定する。
  // 旧実装は selectedDate をジャーナルで過去日にめくると previous が実際に fetch 済みの
  // 日付と一致しなくなり、黙って非表示になっていた(ホーム「AIから」で読めない不具合の報告と
  // 同根の「選択日依存」問題)。新規fetchは追加せず cachedFeedback/state.feedback をそのまま流用する。
  const yesterdayReal = addDays(todayISO(), -1);
  const feedbackFromFilePrev = cachedFeedback[yesterdayReal] || state.feedback[yesterdayReal] || "";
  return `
    ${renderHeader("過去の自分・今の自分・外部視点", "ジャーナル")}
    ${renderDateBar()}
    ${renderExperimentSection()}
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
            ${personalDataReady(state.settings.github) ? `<button class="btn" data-action="push-report">📤 GitHubに日報push</button>` : ""}
          </div>
        </div>
        ${renderSleepCard(date)}
        ${renderMorningEnergyPicker(date)}
        ${renderConditionMorningExtra(date)}
        ${renderEveningConditionCard(date)}
        ${renderGymLogCard(date)}
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
          <button class="btn ghost" data-action="journal-import-ai" data-date="${date}" style="font-size:12px">🤖 AI返信から取り込み(テーマ/MIT/問い)</button>
          <button class="btn ghost" data-action="experiment-add" style="font-size:12px">🧪 実験にする</button>
        </div>
        ${feedbackFromFilePrev && yesterdayReal !== date ? `
          <details class="journal-yesterday-feedback" style="margin-top:14px">
            <summary class="muted" style="cursor:pointer; font-size:12px">🤖 昨日(${escapeHTML(yesterdayReal)})のAIフィードバックを見る</summary>
            <div class="md-render readonly-md" style="margin-top:6px; opacity:0.85">${renderMarkdown(feedbackFromFilePrev)}</div>
          </details>
        ` : ""}
      </div>
    </section>
  `;
}

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
    guide: "英語ジャーナルのAIフィードバックから使える表現を毎日自動でまとめます。しばらく実行されていない場合は生成されません" }
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

// 一覧の読み込みをトリガーする(多重fetch防止のin-flightガード付き)。完了後、まだ
// AIレポート画面を見ていれば再描画してセレクタ/本文を反映する。
async function triggerAiReportDirLoad() {
  if (_aiReportDirLoadInFlight || _aiReportDirCache) return;
  _aiReportDirLoadInFlight = true;
  await fetchPersonalDataDirList();
  _aiReportDirLoadInFlight = false;
  if (state.currentView === "ai-reports") render();
}

// 選択中ファイル本文の読み込みをトリガーする(同上のin-flightガード付き)。
async function triggerAiReportBodyLoad(fileName) {
  if (_aiReportBodyLoadInFlight[fileName]) return;
  _aiReportBodyLoadInFlight[fileName] = true;
  const text = await fetchGitHubRawText(fileName);
  _aiReportBodyCache[fileName] = text;
  delete _aiReportBodyLoadInFlight[fileName];
  if (state.currentView === "ai-reports") render();
}

// 手動更新ボタン: 一覧キャッシュを破棄し、現在表示中ファイルの本文キャッシュも破棄して
// 再取得させる(rate limit配慮のため、他の種類・日付の本文キャッシュはそのまま残す)。
function refreshAiReports() {
  _aiReportDirCache = null;
  _aiReportDirError = false;
  const type = AI_REPORT_TYPES.find((t) => t.id === (state.settings.aiReportType || "content")) || AI_REPORT_TYPES[0];
  const sel = _aiReportSelectedDate[type.id];
  if (sel) delete _aiReportBodyCache[`${type.prefix}${sel}.md`];
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
      <div class="panel"><p>設定画面で個人データリポジトリ(Owner/Repository/Token)を接続すると、ビジョンボードのPDFを読み込めます。</p></div>
    `;
  }
  const src = cachedVisionPdfUrls[current.file] || "";
  const loading = !!_visionPdfLoadInFlight[current.file];
  if (!src) {
    return `
      ${tabs}
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
    ${tabs}
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
        <h2>⏳ 1日バッファ(v116)</h2>
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
        <h2>クラウド保存(個人データリポジトリ)</h2>
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
        <h2>朝の一括プランニング</h2>
        <div class="muted" style="font-size:12px; line-height:1.6">
          v60でアプリ内からのClaude API直接呼び出しは廃止しました(コスト理由)。「📋 下書きスケジュール」
          「🌅 朝プラン」は、繰越・WBS・MIT候補を空き時間へ機械的に前詰め配置する決定論ロジックで動作します
          (APIキーは不要)。AI活用は自宅PCのバッチ処理からのファイル連携(下記AIフィードバック欄)に限定しています。
        </div>
        <label class="checkbox-line">
          <input type="checkbox" data-ai-automorningplan ${state.settings.ai?.autoMorningPlan ? "checked" : ""}>
          🌅 朝の一括プランニングを自動実行(10:00までの初回起動で当日の予定が空なら、繰越+WBS+MITの下書きを自動配置)
        </label>
      </div>
      <div class="panel stack">
        <h2>実行(v70)</h2>
        <div class="muted" style="font-size:12px; line-height:1.6">
          Blockを開始する(▶いま開始/いま着手する/Now画面の開始)と、既存のポモドーロUIを流用した
          フォーカスタイマー(25分)を自動で起動します。既に別のタイマーが動いている場合は乗っ取りません。
        </div>
        <label class="checkbox-line">
          <input type="checkbox" data-setting-focustimerauto ${state.settings.focusTimerAuto ? "checked" : ""}>
          ⏱ Block開始でフォーカスタイマーを自動起動
        </label>
      </div>
      <div class="panel stack">
        <h2>🔒 ガイド付きアクセス案内(v111)</h2>
        <div class="muted" style="font-size:12px; line-height:1.6">
          iPad/iPhoneでポモドーロタイマーを開始すると、ガイド付きアクセス(画面ロック)の
          操作方法を案内するポップアップを出します。PWAから自動でロックすることはiOSの制約上
          できないため、手動操作の案内のみです。ポップアップの「今後表示しない」でもOFFにできます。
        </div>
        <label class="checkbox-line">
          <input type="checkbox" data-setting-pomoguidedaccesshint ${state.settings.pomoGuidedAccessHint ? "checked" : ""}>
          🔒 ポモドーロ開始時にガイド付きアクセスを案内(iPad/iPhoneのみ)
        </label>
      </div>
      <div class="panel stack">
        <h2>🎥 Study With Me(v84)</h2>
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

function renderMore() {
  // v82: bottom-navの構成変更(B1)に追従。WBSはbottom-navから外れたためここに出す側へ、
  //      ジャーナルはbottom-navへ移ったため除外側へ入れ替えた。
  const moreItems = navItems.filter((item) => !["home", "journal", "tasks", "timeline"].includes(item.id));
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
  return `
        <div class="zt-theme-item ${t.fav ? "is-fav" : ""}">
          <button class="zt-star ${t.fav ? "on" : ""}" data-action="zt-fav-toggle" data-id="${t.id}" title="お気に入り">${t.fav ? "★" : "☆"}</button>
          <div class="zt-theme-text" data-action="zt-write" data-id="${t.id}">${escapeHTML(t.text)}${t.questionId ? `<span class="zt-theme-qtag">問い</span>` : ""}${t.source === "ai-feedback" ? `<span class="zt-theme-qtag" style="background:#eef; color:#448">🤖 AI提案</span>` : ""}</div>
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

// v90: グループが1件も無ければ従来どおりのフラット表示(既存ユーザーの見た目を変えない)。
//      グループを作った時点で初めて、グループ見出し + 末尾「未分類」ゾーンの階層表示に切り替わる。
function ztThemeListHTML(items, groupsSorted) {
  if (!groupsSorted.length) return items.map((t) => ztRenderThemeItem(t, groupsSorted)).join("");
  const sections = groupsSorted.map((g) => {
    const inGroup = items.filter((t) => t.groupId === g.id);
    return inGroup.length ? ztRenderGroupSection(g, inGroup, groupsSorted) : "";
  }).filter(Boolean);
  const groupIds = new Set(groupsSorted.map((g) => g.id));
  const ungrouped = items.filter((t) => !t.groupId || !groupIds.has(t.groupId));
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
  return {
    id: crypto.randomUUID(),
    projectId,
    parentTaskId,
    title,
    category,
    status: "todo",
    dueDate: dueDate || state.selectedDate,
    description: "",
    leverageType,  // v65: 10x機構(2-1)。"asset"|"eliminate"|"oneoff"|""(未設定)
    aiWork: false,      // v67: AI作業ワーカー連携(柱2)
    aiWorkBrief: "",    // v67: 何をしてほしいか・成果物の置き場希望(1〜2行)
    progressNum: 0,     // v95: WBS進捗(分子)。0=未着手扱い
    progressDen: 10,    // v95: WBS進捗(分母)。既定10
    doneCriteria: "",   // v96: 完了条件(終わったら残る物を1文で。既定は空欄=未設定)
    firstStep: "",       // v96: スモールステップ(5〜15分で終わる最初の行動。既定は空欄=未設定)
    criteriaRequest: false,  // v99: 翌朝バッチへのAI設定依頼フラグ(既定OFF)
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
  // v115: アンカー配置(提案G③)。完了したBlockが繰り返しルーティンに属していれば、
  // それをアンカーにする後続のルーティン/チェーンを直後の時刻に自動配置する。
  if (justCompleted && completedBlock && completedBlock.recurrenceGroupId) {
    triggerAnchorPlacements(completedBlock.recurrenceGroupId, nowDateTime());
  }
  saveAndRender("Blockを更新しました");
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

function setMorningEnergy(value) {
  state.settings.morningEnergyLog[state.selectedDate] = value;
  ensureJournal(state.selectedDate);
  const label = energyLevels.find((level) => level.value === value)?.label || "";
  state.journals[state.selectedDate] = upsertMorningLine(state.journals[state.selectedDate], `朝の体調: ${label} (${value})`);
  // v73: 「今週書けた日数」の加点式カウントに乗せるため、既存の朝の体調ピッカーだけを
  //      使った日もコンディションログの記録印(morningRecordedAt)を残す。
  ensureConditionLog(state.selectedDate).morningRecordedAt ||= nowDateTime();
  saveAndRender("朝の体調を保存しました");
}

// v73: コンディションOS ==========================================================
function ensureConditionLog(date) {
  state.condition.logs[date] ||= {
    sleepHours: null, meds: null, capacity: "",
    morningRecordedAt: "", eveningMood: null, eveningNote: "", eveningRecordedAt: "", gym: []
  };
  return state.condition.logs[date];
}

// 加点式: ストリーク・連続日数は出さない。「その週に書けた日数」だけを数える肯定表現用。
function conditionRecordedDates(days) {
  return days.filter((d) => {
    const log = state.condition.logs[d];
    return state.settings.morningEnergyLog[d] !== undefined || !!log?.morningRecordedAt || !!log?.eveningRecordedAt;
  });
}
function conditionRecordedCountThisWeek() {
  const { weekStart } = weekRange(todayISO());
  return conditionRecordedDates(weekDays(weekStart)).length;
}

// v73: 縮退モードの閾値。SPEC(condition-os/SPEC.md)は「体調1〜10・4以下」だが、既存の朝の
// 体調ピッカーは離散5段階(悪い0/少し悪い3/普通5/少し良い7/良い10)であり、二重のピッカーを
// 増やさずこの離散値へ読み替えた: 下位2段(悪い・少し悪い = 3以下)を縮退トリガーとする
// (CHANGES_v73.md参照)。
const CONDITION_DEGRADED_THRESHOLD = 3;
function isConditionDegraded(date) {
  const v = state.settings.morningEnergyLog[date];
  return typeof v === "number" && v <= CONDITION_DEGRADED_THRESHOLD;
}

function setConditionSleep(date, hours) {
  const log = ensureConditionLog(date);
  log.sleepHours = hours;
  log.morningRecordedAt ||= nowDateTime();
  saveAndRender("睡眠時間を記録しました");
}

function toggleConditionMeds(date) {
  const log = ensureConditionLog(date);
  log.meds = !log.meds;
  log.morningRecordedAt ||= nowDateTime();
  saveAndRender(log.meds ? "服薬済みを記録しました" : "服薬記録を戻しました");
}

function setConditionCapacity(date, capacity) {
  const log = ensureConditionLog(date);
  log.capacity = log.capacity === capacity ? "" : capacity;  // 同じボタンの再タップで解除
  log.morningRecordedAt ||= nowDateTime();
  saveAndRender("今日の余力を記録しました");
}

function setEveningMood(date, value) {
  const log = ensureConditionLog(date);
  log.eveningMood = value;
  log.eveningRecordedAt = nowDateTime();
  saveAndRender("夜の記録を保存しました");
}

function addGymEntry(date) {
  const exInput = document.querySelector("#gym-exercise-input");
  const wInput = document.querySelector("#gym-weight-input");
  const rInput = document.querySelector("#gym-reps-input");
  const exercise = (exInput?.value || "").trim();
  const weight = Number(wInput?.value || 0);
  const reps = Number(rInput?.value || 0);
  if (!exercise || !weight || !reps) {
    showToast("種目・重量・回数を入力してください");
    return;
  }
  const log = ensureConditionLog(date);
  log.gym.push({ id: crypto.randomUUID(), exercise, weight, reps, at: nowDateTime() });
  log.morningRecordedAt ||= nowDateTime();
  saveAndRender(`${exercise} ${weight}kg×${reps} を記録しました`);
}

function deleteGymEntry(date, entryId) {
  const log = ensureConditionLog(date);
  log.gym = log.gym.filter((g) => g.id !== entryId);
  saveAndRender("削除しました");
}
// ========================================================================

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

  // v117(A): 今日の宣言。未入力日も節自体は常に出す(バッチが未記載を検知するための契約。
  //          FORMAT_CONTRACT.md参照)。理想ワンライナーとは違い省略しない。
  const declarationText = (state.dailyDeclarations[date]?.text || "").trim();

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
        let remoteText = "";
        try {
          remoteText = (await downloadGitHubStateText(config)).text;
          remoteT = (JSON.parse(remoteText).dataModifiedAt) || "";
        } catch { /* 比較不能なら進む */ }
        if (remoteT && remoteT > (state.dataModifiedAt || "")) {
          // v106: コア(tasks等)が両端末で一致していれば、差分はマージ可能コレクションだけ。
          // 合流させてこのままpushしてよい(見送りの無限継続でiPhone分が届かない事故対策)。
          let resolved = false;
          const remoteNorm = remoteText ? normalizedRemoteCopy(remoteText) : null;
          if (remoteNorm && syncCoreEqual(remoteNorm)) {
            const syncMerge = computeSyncMerge(remoteNorm);
            if (syncMerge) {
              applySyncMergeToLocal(syncMerge);
              state.dataModifiedAt = nowDateTime();  // 和集合が最新であることを明示
              resolved = true;
            }
          }
          if (!resolved) {
            const msg = "GitHub側にこの端末より新しいデータがあります。「GitHubから読込」で取り込んでから保存してください";
            if (silent) { updateAutoSaveStatus(`見送り: ${msg}`); return; }
            showToast(`保存を中止: ${msg}`);
            return;
          }
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
  if (!personalDataReady(cfg)) return;
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
  if (!state.settings.autoSync || !personalDataReady(cfg)) return false;
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
    const remoteText = (await downloadGitHubStateText(personalDataFileConfig(cfg))).text;
    const remoteT = (JSON.parse(remoteText).dataModifiedAt) || "";
    if (remoteT && remoteT > (state.settings.lastPushedAt || "")) {
      // v106: コア(tasks等)が両端末で一致していれば、リモートの進み分はマージ可能
      // コレクションだけ。合流させてそのままpushする(バナー待ちでiPhone分が届かない事故対策)。
      let resolved = false;
      const remoteNorm = normalizedRemoteCopy(remoteText);
      if (remoteNorm && syncCoreEqual(remoteNorm)) {
        const syncMerge = computeSyncMerge(remoteNorm);
        if (syncMerge) {
          applySyncMergeToLocal(syncMerge);
          state.settings.lastPushedAt = remoteT;   // リモート分は取り込み済み
          state.dataModifiedAt = nowDateTime();    // 和集合を今回のpushで届ける
          persistLocalNoSchedule();
          resolved = true;
        }
      }
      if (!resolved) {
        setSyncBanner("リモートに新しいデータがあります。設定から pull を確認してください");
        return;
      }
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

// v103: ===============================================================
//  0秒思考の双方向マージ(entries[]/suggestedThemes[]のみ。idキーで和集合)。
//  背景: pullは従来「新しい方の全量を採用/スキップ」の二択で、iPhoneで書いた0秒思考entryが
//  サーバーへ到達済みでもPC側のdataModifiedAtの方が新しいと「remoteは古い」と判定して
//  スキップし、iPhoneの記録がPCから見えなくなる事故が起きた(2026-07-15 K報告)。このまま
//  PCが保存するとサーバー側のiPhone分ごと上書きされ消えるリスクがある。
//  themesは対象外(ユーザーが削除できるフィールドで、和集合にすると削除済みテーマが復活して
//  しまう。tombstone設計はスコープ外。K指示2026-07-15)。tasks/projects/journals等の他
//  コレクションも対象外(review.mdの全体設計課題=TCJ-R01系は別途、本対応の範囲外)。
// ===============================================================

// idキー配列の和集合マージ。同一idはupdatedAt(無ければcreatedAt)の新しい方を採用する。
// nowDateTime()の形式("YYYY-MM-DDTHH:mm:ss"、ゼロ埋め固定長)は文字列比較で新旧判定できる
// (既存のdataModifiedAt比較 remoteT > localT と同じ規約)。片方にしか無いidはそのまま合流する。
// id欠損の壊れた要素は無視する(マージ不能なものを取りこぼしても安全側に倒す)。
function mergeById(localList, remoteList) {
  const merged = new Map();
  (Array.isArray(localList) ? localList : []).forEach((item) => {
    if (item && item.id) merged.set(item.id, item);
  });
  (Array.isArray(remoteList) ? remoteList : []).forEach((item) => {
    if (!item || !item.id) return;
    const cur = merged.get(item.id);
    if (!cur) { merged.set(item.id, item); return; }
    const curTs = cur.updatedAt || cur.createdAt || "";
    const itemTs = item.updatedAt || item.createdAt || "";
    if (itemTs > curTs) merged.set(item.id, item);
  });
  return Array.from(merged.values());
}

// entries[]/suggestedThemes[]だけをマージした結果を返す。失敗(想定外の型など)はcatchして
// nullを返し、呼び出し側は従来動作(マージなし)へフォールバックする(データ消失ガード)。
function mergeZeroThinkingLists(localZt, remoteZt) {
  try {
    return {
      entries: mergeById(localZt?.entries, remoteZt?.entries),
      suggestedThemes: mergeById(localZt?.suggestedThemes, remoteZt?.suggestedThemes)
    };
  } catch (error) {
    console.warn("zeroThinkingマージをスキップ:", error.message);
    return null;
  }
}

// 配列参照の内容一致判定(同じ要素が同じ順序で並んでいるか)。mergeByIdは変更しなかった項目を
// 同一参照で返すため、これで「実際に変化したか」を安く判定できる。
function sameArrayByReference(a, b) {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

// mergedLists(mergeZeroThinkingListsの戻り値)が比較対象baseZtと実質同じ内容かどうか。
function zeroThinkingListsEqual(mergedLists, baseZt) {
  return sameArrayByReference(mergedLists.entries, (baseZt && baseZt.entries) || [])
    && sameArrayByReference(mergedLists.suggestedThemes, (baseZt && baseZt.suggestedThemes) || []);
}

// (b) リモートを採用しない(ローカルの方が新しい/同じ)場合の合流。リモートにしか無いid の
// entries/suggestedThemesをローカルへ合流させる(今回のPC症状はこの経路で治る)。合流後に
// suggestedThemesのTTLを再剪定する(期限切れ候補が合流してもnormalizeStateと同じ基準で
// 即座に消える)。実際に内容が変化した場合だけtrueを返す(呼び出し側はdataModifiedAtを
// 更新して保存する=次回pushでサーバーにも和集合が届く)。
function mergeZeroThinkingIntoLocal(remoteZt) {
  const merged = mergeZeroThinkingLists(state.zeroThinking, remoteZt);
  if (!merged) return false;
  const prunedSuggested = pruneExpiredSuggestedThemes(merged.suggestedThemes);
  const changed =
    !sameArrayByReference(merged.entries, state.zeroThinking.entries || []) ||
    !sameArrayByReference(prunedSuggested, state.zeroThinking.suggestedThemes || []);
  if (!changed) return false;
  state.zeroThinking.entries = merged.entries;
  state.zeroThinking.suggestedThemes = prunedSuggested;
  return true;
}

// v106: ===============================================================
//  同期の双方向マージ(K報告 2026-07-15: iPhoneで入力したジャーナル/ルーティン実績が
//  PC側で見えない)。v103の0秒思考マージを、非破壊に合流できるコレクション全体へ一般化する。
//  「全量の新旧二択」の枠組みは維持しつつ、採用/スキップのどちらの経路でも以下を和集合マージする:
//   - journals / feedback       … 日付キー文字列。journalMeta[date].textUpdatedAt(本版で追加。
//                                 ジャーナル本文の編集時に更新)の新しい方。無ければ長い方
//                                 (自動生成テンプレより書かれた本文が勝つ)
//   - journalMeta               … 本文で勝った側を採用(片側にしか無ければ合流)
//   - condition.logs            … 日付キー。朝グループ/夜グループを各recordedAtで独立採択、
//                                 gym[]はid和集合(idは端末別UUIDで衝突しない)
//   - sleep.logs                … 日付キー。importedAtの新しい方
//   - settings.morningEnergyLog … 日付キー数値。片側にしか無い日付だけ合流
//   - blocks                    … idキー和集合(updatedAtの新しい方)。繰り返し実体のidは
//                                 rec_<ruleId>_<date> で端末間決定論なので重複しない。
//                                 リモートにしか無い「期間外・未編集の繰り返し実体」は
//                                 パージ済みの蘇生になるため合流させない
//   - zeroThinking              … v103の既存マージ(mergeById)をそのまま使用
//  さらにマージ対象「以外」のコア(SYNC_CORE_COMPARE_KEYS)が両端末で一致していれば、
//  「両方に未反映の変更」の競合を人間判断を待たず和集合で自動解消し、pushの見送りも解除する
//  (ジャーナル・ルーティン・体調・睡眠の日常記録だけなら同期が全自動で収束する)。
//  tasks等のコア自体が両側で動いていた場合は従来どおりバナー/見送りで人間判断に落とす。
//  マージ計算はnormalizeState済みのリモートコピーに対して行うこと(生JSONはフィールド欠損があり、
//  そのままstateへ合流させると既定値補完を素通りするため)。
// ===============================================================

const SYNC_CORE_COMPARE_KEYS = ["tasks", "projects", "recurrences", "declarations", "questions", "experiments"];

// リモート生テキストからマージ・比較用のnormalize済みコピーを作る(失敗はnullで従来動作へ)
function normalizedRemoteCopy(text) {
  try { return normalizeState(JSON.parse(text)); } catch { return null; }
}

function syncCoreEqual(remoteNorm) {
  if (!remoteNorm) return false;
  try {
    return SYNC_CORE_COMPARE_KEYS.every((k) =>
      JSON.stringify(remoteNorm[k] ?? null) === JSON.stringify(state[k] ?? null));
  } catch { return false; }
}

// 日付キー文字列マップの和集合。競合時の優先順: ①未記入テンプレでない方(pristineOf指定時。
// ensureJournalが当日分のテンプレを自動生成するため、「テンプレ vs 書かれた本文」の競合は
// 日常的に発生する) → ②tsOf(side, date)の新しい方 → ③長い方。
function mergeDateStringMap(localMap, remoteMap, tsOf, pristineOf) {
  const out = {};
  const winners = {};
  let changedVsLocal = false, changedVsRemote = false;
  const dates = new Set([...Object.keys(localMap || {}), ...Object.keys(remoteMap || {})]);
  for (const d of dates) {
    const l = (localMap || {})[d];
    const r = (remoteMap || {})[d];
    let win;
    if (r == null) { win = "L"; changedVsRemote = true; }
    else if (l == null) { win = "R"; changedVsLocal = true; }
    else if (l === r) { win = "L"; }
    else {
      const lp = pristineOf ? pristineOf(l, d) : false;
      const rp = pristineOf ? pristineOf(r, d) : false;
      if (lp !== rp) {
        win = lp ? "R" : "L";
      } else {
        const lt = tsOf("L", d), rt = tsOf("R", d);
        win = lt !== rt ? (lt > rt ? "L" : "R") : (String(r).length > String(l).length ? "R" : "L");
      }
      if (win === "R") changedVsLocal = true; else changedVsRemote = true;
    }
    winners[d] = win;
    out[d] = win === "L" ? l : r;
  }
  return { map: out, winners, changedVsLocal, changedVsRemote };
}

// ジャーナルテンプレの日付ヘッダをその日の日付へ置換した「未記入本文」(ensureJournalと同じ変換)
function journalTemplateTextFor(tplSetting, date) {
  if (!tplSetting) return "";
  return tplSetting.replace(/^# \d{4}-\d{2}-\d{2} のジャーナル/m, `# ${date} のジャーナル`).trim();
}

// journalMeta: 本文マージの勝者側のメタを採用(片側にしか無ければそのまま合流)
function mergeJournalMetaByWinners(localMeta, remoteMeta, winners) {
  const out = {};
  const dates = new Set([
    ...Object.keys(localMeta || {}), ...Object.keys(remoteMeta || {}), ...Object.keys(winners || {})
  ]);
  for (const d of dates) {
    const l = (localMeta || {})[d];
    const r = (remoteMeta || {})[d];
    const v = winners[d] === "R" ? (r || l) : (l || r);
    if (v != null) out[d] = v;
  }
  return out;
}

const CONDITION_MORNING_FIELDS = ["sleepHours", "meds", "capacity", "morningRecordedAt"];
const CONDITION_EVENING_FIELDS = ["eveningMood", "eveningNote", "eveningRecordedAt"];

function mergeConditionLogMaps(localLogs, remoteLogs) {
  const out = {};
  const dates = new Set([...Object.keys(localLogs || {}), ...Object.keys(remoteLogs || {})]);
  for (const d of dates) {
    const l = (localLogs || {})[d];
    const r = (remoteLogs || {})[d];
    if (!r) { out[d] = l; continue; }
    if (!l) { out[d] = r; continue; }
    const merged = { ...l };
    if ((r.morningRecordedAt || "") > (l.morningRecordedAt || "")) {
      CONDITION_MORNING_FIELDS.forEach((k) => { merged[k] = r[k]; });
    }
    if ((r.eveningRecordedAt || "") > (l.eveningRecordedAt || "")) {
      CONDITION_EVENING_FIELDS.forEach((k) => { merged[k] = r[k]; });
    }
    merged.gym = mergeById(l.gym, r.gym);
    out[d] = merged;
  }
  return out;
}

function mergeSleepLogMaps(localLogs, remoteLogs) {
  const out = {};
  const dates = new Set([...Object.keys(localLogs || {}), ...Object.keys(remoteLogs || {})]);
  for (const d of dates) {
    const l = (localLogs || {})[d];
    const r = (remoteLogs || {})[d];
    if (!l) { out[d] = r; continue; }
    if (!r) { out[d] = l; continue; }
    out[d] = (r.importedAt || "") > (l.importedAt || "") ? r : l;
  }
  return out;
}

// 片側にしか無い日付だけ合流(両方にあればローカル優先。朝の体調は1日1回タップの運用)
function mergeMorningEnergyLogs(localLog, remoteLog) {
  return { ...(remoteLog || {}), ...(localLog || {}) };
}

// v117(A): 今日の宣言(dailyDeclarations)。日付キー{text,updatedAt}。v106のsleep.logsマージ
// (タイムスタンプ比較)と同じパターンをそのまま踏襲する。
function mergeDailyDeclarationMaps(localMap, remoteMap) {
  const out = {};
  const dates = new Set([...Object.keys(localMap || {}), ...Object.keys(remoteMap || {})]);
  for (const d of dates) {
    const l = (localMap || {})[d];
    const r = (remoteMap || {})[d];
    if (!l) { out[d] = r; continue; }
    if (!r) { out[d] = l; continue; }
    out[d] = (r.updatedAt || "") > (l.updatedAt || "") ? r : l;
  }
  return out;
}

function mergeBlockLists(localBlocks, remoteBlocks) {
  const localIds = new Set((localBlocks || []).map((b) => b && b.id).filter(Boolean));
  const today = todayISO();
  const from = addDays(today, -RECURRENCE_KEEP_PAST_DAYS);
  const to = addDays(today, RECURRENCE_FUTURE_DAYS);
  const addable = (remoteBlocks || []).filter((b) => {
    if (!b || !b.id || localIds.has(b.id)) return true;  // 既知idは mergeById の新旧判定に任せる
    // リモートにしか無いblockのうち、maintainRecurrencesのパージ対象(期間外・未編集の
    // 繰り返し実体)は合流させない(パージ→合流→パージの往復と蘇生を防ぐ)
    if (b.recurrenceGroupId && (b.date < from || b.date > to) && !isTouchedBlock(b)) return false;
    return true;
  });
  return mergeById(localBlocks, addable);
}

// マージ結果一式を計算する(stateはまだ書き換えない)。remoteNormはnormalizedRemoteCopy()の戻り値。
// 失敗時はnullを返し、呼び出し側はv103相当(0秒思考のみ)へフォールバックする。
function computeSyncMerge(remoteNorm) {
  try {
    const jt = (side, d) => side === "L"
      ? ((state.journalMeta[d] || {}).textUpdatedAt || "")
      : (((remoteNorm.journalMeta || {})[d] || {}).textUpdatedAt || "");
    // どちらの端末のテンプレとも一致する本文は「未記入」= 書かれた本文が常に勝つ
    const tplL = state.settings.journalTemplate || "";
    const tplR = (remoteNorm.settings || {}).journalTemplate || "";
    const journalPristine = (text, d) => {
      const t = String(text || "").trim();
      return t === "" || t === journalTemplateTextFor(tplL, d) || t === journalTemplateTextFor(tplR, d);
    };
    const journals = mergeDateStringMap(state.journals, remoteNorm.journals, jt, journalPristine);
    const journalMeta = mergeJournalMetaByWinners(state.journalMeta, remoteNorm.journalMeta, journals.winners);
    const feedback = mergeDateStringMap(state.feedback, remoteNorm.feedback, () => "");
    const conditionLogs = mergeConditionLogMaps(state.condition.logs, (remoteNorm.condition || {}).logs);
    const sleepLogs = mergeSleepLogMaps(state.sleep.logs, (remoteNorm.sleep || {}).logs);
    const morningEnergyLog = mergeMorningEnergyLogs(state.settings.morningEnergyLog, (remoteNorm.settings || {}).morningEnergyLog);
    const blocks = mergeBlockLists(state.blocks, remoteNorm.blocks);
    const zeroThinking = mergeZeroThinkingLists(state.zeroThinking, remoteNorm.zeroThinking);
    // v117(A): 今日の宣言もマージ可能コレクションへ追加
    const dailyDeclarations = mergeDailyDeclarationMaps(state.dailyDeclarations, remoteNorm.dailyDeclarations);
    const jsonChanged = (obj, base) => JSON.stringify(obj) !== JSON.stringify(base || {});
    const changedVsLocal =
      journals.changedVsLocal ||
      jsonChanged(journalMeta, state.journalMeta) ||
      feedback.changedVsLocal ||
      jsonChanged(conditionLogs, state.condition.logs) ||
      jsonChanged(sleepLogs, state.sleep.logs) ||
      jsonChanged(morningEnergyLog, state.settings.morningEnergyLog) ||
      jsonChanged(dailyDeclarations, state.dailyDeclarations) ||
      !sameArrayByReference(blocks, state.blocks) ||
      (zeroThinking ? !zeroThinkingListsEqual(zeroThinking, state.zeroThinking) : false);
    const changedVsRemote =
      journals.changedVsRemote ||
      jsonChanged(journalMeta, remoteNorm.journalMeta) ||
      feedback.changedVsRemote ||
      jsonChanged(conditionLogs, (remoteNorm.condition || {}).logs) ||
      jsonChanged(sleepLogs, (remoteNorm.sleep || {}).logs) ||
      jsonChanged(morningEnergyLog, (remoteNorm.settings || {}).morningEnergyLog) ||
      jsonChanged(dailyDeclarations, remoteNorm.dailyDeclarations) ||
      !sameArrayByReference(blocks, remoteNorm.blocks || []) ||
      (zeroThinking ? !zeroThinkingListsEqual(zeroThinking, remoteNorm.zeroThinking) : false);
    return {
      values: { journals: journals.map, journalMeta, feedback: feedback.map, conditionLogs, sleepLogs, morningEnergyLog, blocks, zeroThinking, dailyDeclarations },
      changedVsLocal, changedVsRemote
    };
  } catch (error) {
    console.warn("同期マージをスキップ:", error.message);
    return null;
  }
}

// マージ結果をローカルstateへ適用(「ローカルを基準に残す」経路用)。変化があればtrue。
function applySyncMergeToLocal(merged) {
  if (!merged || !merged.changedVsLocal) return false;
  const v = merged.values;
  state.journals = v.journals;
  state.journalMeta = v.journalMeta;
  state.feedback = v.feedback;
  state.condition.logs = v.conditionLogs;
  state.sleep.logs = v.sleepLogs;
  state.settings.morningEnergyLog = v.morningEnergyLog;
  state.blocks = v.blocks;
  state.dailyDeclarations = v.dailyDeclarations;  // v117(A)
  if (v.zeroThinking) {
    state.zeroThinking.entries = v.zeroThinking.entries;
    state.zeroThinking.suggestedThemes = pruneExpiredSuggestedThemes(v.zeroThinking.suggestedThemes);
  }
  return true;
}

// マージ結果をリモート(採用予定のremoteNorm)へ適用(「リモートを採用する」経路用)。
// ローカル限定の記録が採用で消えないようにする。remoteNormから乖離があればtrue
// (呼び出し側はdataModifiedAtを進めて次回pushで和集合を届ける)。
function applySyncMergeToRemote(merged, remoteNorm) {
  if (!merged || !merged.changedVsRemote) return false;
  const v = merged.values;
  remoteNorm.journals = v.journals;
  remoteNorm.journalMeta = v.journalMeta;
  remoteNorm.feedback = v.feedback;
  remoteNorm.condition.logs = v.conditionLogs;
  remoteNorm.sleep.logs = v.sleepLogs;
  remoteNorm.settings.morningEnergyLog = v.morningEnergyLog;
  remoteNorm.blocks = v.blocks;
  remoteNorm.dailyDeclarations = v.dailyDeclarations;  // v117(A)
  if (v.zeroThinking) {
    remoteNorm.zeroThinking.entries = v.zeroThinking.entries;
    remoteNorm.zeroThinking.suggestedThemes = pruneExpiredSuggestedThemes(v.zeroThinking.suggestedThemes);
  }
  return true;
}

// 自動 pull(起動 + visibilitychange、60秒スロットル)
async function runAutoSyncPull() {
  if (!autoSyncReady()) return;
  const now = Date.now();
  if (now - _lastPullCheckAt < AUTO_SYNC_PULL_THROTTLE_MS) return;
  _lastPullCheckAt = now;
  const cfg = state.settings.github;
  try {
    const { text, sha } = await downloadGitHubStateText(personalDataFileConfig(cfg));
    const remote = JSON.parse(text);
    const remoteT = remote.dataModifiedAt || "";
    const localT = state.dataModifiedAt || "";
    // v106: マージ計算はnormalize済みの別コピーで行う(remoteは採用フォールバック用に生のまま)
    const remoteNorm = normalizedRemoteCopy(text);
    const syncMerge = remoteNorm ? computeSyncMerge(remoteNorm) : null;
    if (!remoteT || remoteT <= localT) {
      // remote 古い/同じ。それでもリモート限定の記録は合流させる(v103の0秒思考対策を
      // v106でジャーナル/blocks/体調/睡眠へ一般化。PC側が新しくてもiPhone分が見える)。
      const changed = syncMerge ? applySyncMergeToLocal(syncMerge) : mergeZeroThinkingIntoLocal(remote.zeroThinking);
      if (changed) saveState();
      if (changed || runDailyOpen()) render();
      return;
    }
    const hasUnpushed = localT !== (state.settings.lastPushedAt || "");
    if (hasUnpushed) {
      // 両方に未反映の変更。マージ可能コレクションは合流させたうえで、
      // v106: コア(tasks等)が両端末で一致していれば差分はマージ済み分だけなので、
      // 人間判断を待たず「和集合を正」として自動解消する(push見送りも解除)。
      const changed = syncMerge ? applySyncMergeToLocal(syncMerge) : mergeZeroThinkingIntoLocal(remote.zeroThinking);
      if (syncMerge && syncCoreEqual(remoteNorm)) {
        state.settings.lastPushedAt = remoteT;   // リモート分は取り込み済み
        setLastSyncedSha(sha);
        state.dataModifiedAt = nowDateTime();    // 和集合を次のpushで届ける
        persistLocalNoSchedule();
        scheduleAutoSync();
        clearSyncBanner();
        runDailyOpen();
        render();
        showToast("他端末の記録を取り込みました");
        return;
      }
      if (changed) saveState();
      setSyncBanner("リモートに新しいデータ。ローカルにも未pushの変更があります。設定から手動で確認してください");
      if (changed || runDailyOpen()) render();
      return;
    }
    // 自動適用(ローカルに未push変更なし & remote が新しい)
    clearTimeout(autoSaveTimer);
    const token = cfg.token;
    // 採用前に、ローカルにしか無い記録を採用予定のリモートへ合流させる(採用で消さないため)。
    let addedLocal = false;
    let adopted;
    if (remoteNorm && syncMerge) {
      addedLocal = applySyncMergeToRemote(syncMerge, remoteNorm);
      adopted = remoteNorm;
    } else {
      // フォールバック(v103相当: 0秒思考のみ合流)
      const remoteZtBefore = remote.zeroThinking || {};
      const merged = mergeZeroThinkingLists(state.zeroThinking, remoteZtBefore);
      addedLocal = merged && !zeroThinkingListsEqual(merged, remoteZtBefore);
      if (merged) remote.zeroThinking = { ...remoteZtBefore, ...merged };
      adopted = normalizeState(remote);
    }
    state = adopted;
    state.settings.github = { ...cfg, token };
    state.settings.lastPushedAt = remoteT;   // 取り込んだ = リモートと一致
    state.settings.lastPulledAt = nowDateTime();
    setLastSyncedSha(sha);
    maintainRecurrences({ purge: true });
    runDailyOpen();  // §2: pull 後に日次オープン(古いstate展開→pullで消える事故を防ぐ)
    clearSyncBanner();
    if (addedLocal) {
      // 合流分はリモートの元スナップショットに無かった変更 → 次回pushで届くようにする
      // (lastPushedAtより新しいdataModifiedAtにして「未push」を成立させる)。
      state.dataModifiedAt = nowDateTime();
      scheduleAutoSave();
      scheduleAutoSync();
    }
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
    // v94: state.settings.github の復元には requireGitHubConfig() の変換済み形状(config。
    // owner/repo キー・personalDataPath()でtaskchute/付与済みのpath)ではなく、この端末の
    // 生の設定(rawSettings。dataOwner/dataRepo・taskchute/無しのpath)を使う。
    // 変換済みconfigをそのまま流し込むと dataOwner/dataRepo が失われ、path が
    // taskchute/taskchute/... の二重プレフィックスになる不具合があった(K報告 2026-07-14)。
    // syncFromGitHubOnStartup()/runAutoSyncPull()/restoreBackup() は元から生の設定を
    // 使っており対象外(state上書き前に cfg/currentGithubSettings として退避済み)。
    const rawSettings = state.settings.github;
    // v103→v106: リモート採用前に、ローカルにしか無い記録(0秒思考/ジャーナル/blocks/体調/睡眠)を
    // 合流させる(採用でローカル限定の記録を消さないため)。
    const remoteNorm = normalizedRemoteCopy(text);
    const syncMerge = remoteNorm ? computeSyncMerge(remoteNorm) : null;
    let addedLocal = false;
    let adopted;
    if (remoteNorm && syncMerge) {
      addedLocal = applySyncMergeToRemote(syncMerge, remoteNorm);
      adopted = remoteNorm;
    } else {
      // フォールバック(v103相当: 0秒思考のみ合流)
      const remoteZtBefore = loaded.zeroThinking || {};
      const merged = mergeZeroThinkingLists(state.zeroThinking, remoteZtBefore);
      addedLocal = merged && !zeroThinkingListsEqual(merged, remoteZtBefore);
      if (merged) loaded.zeroThinking = { ...remoteZtBefore, ...merged };
      adopted = normalizeState(loaded);
    }
    state = adopted;
    state.settings.github = { ...rawSettings };
    maintainRecurrences({ purge: true });
    if (addedLocal) {
      // 合流で内容がリモートの元スナップショットから乖離した場合だけ例外的にdataModifiedAtを
      // 進める(通常の手動読込は「採用のためdataModifiedAtは更新しない」が原則。合流分を
      // 次回pushで届けるための例外)。
      state.dataModifiedAt = nowDateTime();
      scheduleAutoSave();
      scheduleAutoSync();
    }
    persistLocalNoSchedule();  // 採用のため dataModifiedAt は更新しない(合流時を除く。上記参照)
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
  if (!personalDataReady(cfg)) return;  // 未設定なら何もしない
  try {
    const { text, sha } = await downloadGitHubStateText(personalDataFileConfig(cfg));
    const remote = JSON.parse(text);
    // v37: 比較は「起動時点のローカル更新時刻」と行う。
    //      fetch中にユーザーがタブを触るなどして saveState が走ると localT が進み、
    //      本来取り込むべき新しいリモートを永遠に取りこぼす問題への対策。
    const localT = _startupDataModifiedAt || "";
    const remoteT = remote.dataModifiedAt || "";
    // リモートが新しいときだけ採用(ISO 文字列なので辞書順比較でよい)
    // v106: どちらの分岐でもマージ可能コレクション(ジャーナル/blocks/体調/睡眠/0秒思考)は
    // 和集合で合流させる(iPhone分がPC起動pullで見えなくなる事故対策の一般化)。
    const remoteNorm = normalizedRemoteCopy(text);
    const syncMerge = remoteNorm ? computeSyncMerge(remoteNorm) : null;
    if (remoteT && remoteT > localT) {
      clearTimeout(autoSaveTimer);
      const token = state.settings.github.token;
      // リモート採用前に、ローカルにしか無い記録を合流させてから採用する(採用で消さないため)。
      let addedLocal = false;
      let adopted;
      if (remoteNorm && syncMerge) {
        addedLocal = applySyncMergeToRemote(syncMerge, remoteNorm);
        adopted = remoteNorm;
      } else {
        // フォールバック(v103相当: 0秒思考のみ合流)
        const remoteZtBefore = remote.zeroThinking || {};
        const merged = mergeZeroThinkingLists(state.zeroThinking, remoteZtBefore);
        addedLocal = merged && !zeroThinkingListsEqual(merged, remoteZtBefore);
        if (merged) remote.zeroThinking = { ...remoteZtBefore, ...merged };
        adopted = normalizeState(remote);
      }
      state = adopted;
      state.settings.github = { ...cfg, token };
      maintainRecurrences({ purge: true });
      if (addedLocal) {
        // 合流分はリモートの元スナップショットに無かった変更 → 次回pushで届くようにする
        state.dataModifiedAt = nowDateTime();
        scheduleAutoSave();
        scheduleAutoSync();
      }
      persistLocalNoSchedule();
      setLastSyncedSha(sha);   // v37: この端末はこのリモート状態と同期済み
      render();
      showToast("最新データを取り込みました");
    } else {
      // ローカルが新しい/同じ → 他フィールドは変更しない(次回保存で GitHub へ反映される)。
      // v38: リモートの現状は確認済みなので「同期済みSHA」だけ記録する。
      //      これが無いと、稼働中の既存端末が(SHA未記録のため)一度手動で
      //      「GitHubから読込」するまで自動保存を見送り続けてしまう。
      // v103→v106: リモートにしか無い記録(0秒思考に加えジャーナル/blocks/体調/睡眠)を
      // ローカルへ合流させる(iPhoneで書いた記録がPC起動pullで見えなくなる事故対策)。
      const changed = syncMerge ? applySyncMergeToLocal(syncMerge) : mergeZeroThinkingIntoLocal(remote.zeroThinking);
      if (changed) { saveState(); render(); }
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
  state = normalizeState(seedState());
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
    // v77: AIフィードバック等の定期再fetch(30分毎)。visibilitychange側と同じ入口・スロットルを共有する。
    if (Date.now() - _lastFeedbackHydrateAt >= FEEDBACK_REFRESH_INTERVAL_MS) maybeRefreshFeedback();
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
//      登録形状: タスクは既存の makeTask() 慣習をそのまま使う。projectId="" は WBS「単発Task」
//      (renderWBSのtaskProjectセレクトに存在する既存の一級パターン)を流用しており、ホームの
//      「未完了タスク」パネル(homeBacklog、wish/other種別のProjectだけを除外表示)には自然に
//      出る。dueDateは当日(K指示どおり——フィードバック自身の日付ではなく「Kが読む日」に
//      見えることが目的)。
//      テーマには source:"ai-feedback" を付け、手動追加(source:null)と区別する。ワンタップ削除
//      (deleteZtTheme)がAI由来かどうかを判定し、AI由来ならzeroSecThemeLogへ不採用記録する。
function autoIngestFeedback(date, text) {
  if (!text) return null;
  if (!Array.isArray(state.feedbackIngestedDates)) state.feedbackIngestedDates = [];
  if (state.feedbackIngestedDates.includes(date)) return null;  // 冪等: 同じ日付は1回のみ

  const todayDate = todayISO();
  let addedTasks = 0, addedThemes = 0;

  const mitCandidates = extractMITCandidatesFromReport(text);
  if (mitCandidates.length) {
    const liveTitles = new Set(state.tasks
      .filter((t) => !t.deleted && (t.status === "todo" || t.status === "doing"))
      .map((t) => t.title));
    mitCandidates.forEach((title) => {
      if (liveTitles.has(title)) return;  // 重複排除(繰越含む)
      state.tasks.push(makeTask({ title, dueDate: todayDate }));
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
  //      それをそのまま自動登録すると「過去日を見ているだけ」で過去FBの提案が実今日のタスクとして
  //      注入されてしまう(dueDateはautoIngestFeedback内部でtodayISO()固定のため)。
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
    showToast(`🤖 AIの提案からタスク${ingestedTasksTotal}件・テーマ${ingestedThemesTotal}件を追加しました`);
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
  if (changed && (state.currentView === "vision" || state.currentView === "journal" || state.currentView === "weekly" || state.currentView === "home" || state.currentView === "zero")) {
    render();
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
function homeAiHub(blocks, isToday) {
  return `<section class="panel home-ai-hub">${homeAiHubBody(blocks, isToday)}</section>`;
}

// v73: 縮退モードでhomeFoldSection(details)に相乗りできるよう、外側の<section>無しの
//      中身だけを返す形に分離した(homeAiHub自身の見た目・挙動は無変更)。
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
    ``,
    JOURNAL_REQUEST_SECTION,
    ``
  ].join("\n");
}

// v17: 各セクションの思考プロンプト(画面表示用、Markdown 出力時は省く)
const JOURNAL_PROMPTS = {
  // v105: 「🛏 睡眠」はテンプレ廃止(実測は睡眠CSV取込に一本化)に伴い削除
  "🙏 感謝(3 つ)": "当たり前すぎて忘れがちな何か。誰・何に対して?(例:朝のコーヒー、子の笑顔)",
  "✨ 今日のハイライト": "今日いちばん心が動いた瞬間は? 嬉しい・面白い・誇らしい、どれでも。",
  "💡 気付き・学び": "うまくいった/いかなかった理由は? 自分・他人・状況について、次に活かせること。",
  "📝 自由記述": "・いまなに考えてる?\n・言葉にならない違和感を、まず雑に書き出す。コントロールできないことは手放してOK。\n・夢・思いつき・心配ごと・読書メモ・なんでも。",
  // v91: 「### 依頼」見出し配下のヒント(JOURNAL_REQUEST_SECTIONの見出しテキストと対応させる)
  "依頼": "AIにやってほしいことがあれば、1行1件でここに書く(例:「相場帳のバグを直して」)。翌朝のバッチが読み取り、タスク登録・0秒思考テーマ登録・Wish追加などをホワイトリスト操作として試みます。"
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

// v115: 連続ルーティン(チェーン、提案G②)の新規作成/編集モーダル。idが空文字なら新規。
function openChainEditor(id) {
  const chain = id
    ? (state.routineChains || []).find((c) => c.id === id && !c.deleted)
    : { id: "", title: "", steps: [], anchor: "" };
  if (!chain) return;
  state.modal = { type: "chain", id: id || "" };
  renderModal(buildChainModal(chain));
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
  _migrationRitualCtx = null;  // v61: 選択せずに閉じた場合も一時状態を残さない
  _pendingLifecycleCtx = null;  // v87: 宣言/報告モーダルを×で閉じた場合は開始/終了自体も取り消す
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
  } else if (state.modal.type === "experiment") {
    saveExperimentFromModal(state.modal.id, fields);  // v68
  } else if (state.modal.type === "chain") {
    saveChainFromModal(state.modal.id, fields);  // v115: 連続ルーティン(提案G②)
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
  } else if (state.modal.type === "experiment") {
    deleteExperiment(state.modal.id);  // v68
  } else if (state.modal.type === "chain") {
    deleteChain(state.modal.id);  // v115: 連続ルーティン(提案G②)
  }
  closeModal();
}

// ---------- Chain(連続ルーティン)モーダル ---------- v115: 提案G②③

// アンカー候補(既存の繰り返しルール+他の連続ルーティン)。excludeIdで自分自身を除外する
// (idはルール・チェーンで衝突しないUUIDのため、両方まとめて1つの除外引数でよい)。
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
          ${leverageJudgeHelperHTML()}
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
        <div class="field">
          <label class="field-label">レバレッジ(10x機構・任意)</label>
          <select class="select" data-modal-field="leverageType">
            ${leverageTypeOptionsHTML(block.leverageType || "")}
          </select>
          ${leverageJudgeHelperHTML()}
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
        <button class="btn danger" data-action="modal-delete">削除</button>
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
    // GitHub(個人データリポジトリ)に設定があれば自動 push
    if (personalDataReady(state.settings.github)) {
      recordFeedbackFile(date); // v56: 起動時 fetch を存在既知の日付に限定(404ノイズ回避)
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

function bufferMeterHTML() {
  if (state.selectedDate !== todayISO()) return "";
  const info = computeBufferRemaining(state.selectedDate);
  if (!info.hasBuffer) {
    return `<div class="buffer-meter unset" data-buffer-level="unset">バッファ残量: 未設定(設定 &gt; 1日バッファ で分数を設定してください)</div>`;
  }
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
setTimeout(maybeAutoMorningPlan, 4500);
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
