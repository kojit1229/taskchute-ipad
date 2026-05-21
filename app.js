const STORAGE_KEY = "taskchute-journal-pwa-state-v1";

const navItems = [
  { id: "home", label: "ホーム", mark: "H" },
  { id: "wbs", label: "WBS", mark: "W" },
  { id: "wish", label: "やりたい", mark: "✦" },
  { id: "avoid", label: "やらない", mark: "✕" },
  { id: "tasks", label: "タスクシュート", mark: "T" },
  { id: "timeline", label: "タイムライン", mark: "L" },
  { id: "pomodoro", label: "ポモドーロ", mark: "P" },
  { id: "journal", label: "ジャーナル", mark: "J" },
  { id: "vision", label: "ビジョン", mark: "V" },
  { id: "reports", label: "日報", mark: "R" },
  { id: "settings", label: "設定", mark: "S" }
];

const mobileNav = [
  { id: "home", label: "ホーム" },
  { id: "wbs", label: "WBS" },
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
let toastTimer = null;
let timerTicker = null;
let cachedVisionMd = "";
let cachedAffirmationMd = "";
const cachedFeedback = {};  // { 'YYYY-MM-DD': '...md text...' }

render();
hydrateStaticMarkdown();
registerServiceWorker();
startTimerTicker();

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
  if (action === "delete-task") deleteTask(id);
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
  // v14: 開始前に既存セッションを強制リセット(中断/完了/休憩後の再開でも確実に50:00から)
  if (action === "start-pomodoro") {
    forceResetPomodoroSession();
    startPomodoro(target.dataset.blockId || "");
  }
  if (action === "stop-pomodoro") stopPomodoro();
  if (action === "complete-pomodoro") completePomodoro();
  if (action === "go-break") goBreakPomodoro();
  if (action === "end-break") endBreakPomodoro();
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
  if (action === "request-notification-permission") requestNotificationPermission();
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
  // v10: タイムラインズーム
  if (action === "tl-zoom") {
    state.timelineZoom = Number(target.dataset.zoom) || 1;
    saveAndRender();
  }
  // v11: サイドバー折りたたみ
  if (action === "toggle-sidebar") {
    state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
    saveAndRender();
  }
  // v12: ポモドーロ全画面切替
  if (action === "toggle-pomo-fullscreen") {
    state.pomodoro.fullscreen = !state.pomodoro.fullscreen;
    saveAndRender();
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
  if (target.matches("[data-vision-field]")) {
    state.settings[target.dataset.visionField] = target.value;
    saveState();
  }
  if (target.matches("[data-github-field]")) {
    state.settings.github[target.dataset.githubField] = target.value.trim();
    saveState();
  }
  // === v9: カテゴリ編集 ===
  if (target.matches("[data-cat-id][data-cat-field]")) {
    updateCategoryField(target.dataset.catId, target.dataset.catField, target.value);
  }
  // === v9: 休憩メッセージ編集 ===
  if (target.matches("[data-msg-id][data-msg-field]")) {
    updateBreakMessageField(target.dataset.msgId, target.dataset.msgField, target.value);
  }
  // === v16: やりたいことリスト ===
  if (action === "add-wish") addWish();
  if (action === "open-wish") toggleWishOpen(id);
  if (action === "add-wish-subtask") addWishSubtask(id);
  if (action === "toggle-wish-subtask") toggleWishSubtask(id);
  if (action === "wish-subtask-to-tasks") wishSubtaskToTasks(id);
  if (action === "wish-realize") realizeWish(id);
  if (action === "wish-unrealize") unrealizeWish(id);
  if (action === "delete-wish") deleteWish(id);
  // === v17: Avoid List ===
  if (action === "add-avoid") addAvoid();
  if (action === "delete-avoid") deleteAvoid(id);
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-date-picker]")) setSelectedDate(target.value);
  if (target.matches("[data-block-field]")) {
    updateBlockField(target.dataset.id, target.dataset.blockField, target.value);
  }
  if (target.matches("[data-setting-field]")) {
    state.settings[target.dataset.settingField] = target.value;
    saveState();
    render();
  }
  if (target.matches('[data-github-field="autoSave"]')) {
    state.settings.github.autoSave = target.checked;
    saveState();
    updateAutoSaveStatus();
    if (target.checked) {
      showToast("自動保存を有効にしました");
    }
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
    return normalizeState(seedState());
  }
}

function saveState() {
  // state.modal は永続化しない(モーダル状態はメモリのみ)
  const persisted = { ...state, modal: null };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  scheduleAutoSave();
}

function normalizeState(value) {
  value.settings ||= {};
  value.settings.staticFilesLoaded ||= { vision: false, affirmation: false };
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
  // v16/v17: 既存 Task に Wish + Habit Stacking 用フィールドのデフォルト値を補完(後方互換)
  value.tasks = value.tasks.map((task) => ({
    targetYear: null,
    lifeArea: "",
    motivation: "",
    realized: false,
    realizedDate: "",
    trigger: "",
    celebrate: "",
    ...task
  }));
  value.blocks ||= [];
  // v17: 既存 Block に isMIT のデフォルト値を補完(後方互換)
  value.blocks = value.blocks.map((block) => ({
    isMIT: false,
    source: "",
    ...block
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
  value.journals ||= {};
  value.feedback ||= {};
  value.reports ||= {};
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
    <select class="select" data-modal-field="category">
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
}

function renderSidebar() {
  // v11: 折りたたみ状態を反映
  const collapsed = state.settings?.sidebarCollapsed || false;
  if (collapsed) sidebar.classList.add("collapsed");
  else sidebar.classList.remove("collapsed");
  sidebar.innerHTML = `
    <div class="brand">
      <div class="brand-title">${collapsed ? "TJ" : "TaskChute Journal"}</div>
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
  if (view === "timeline") main.innerHTML = renderTimelineView();
  if (view === "pomodoro") main.innerHTML = renderPomodoro();
  if (view === "journal") main.innerHTML = renderJournal();
  if (view === "vision") main.innerHTML = renderVision();
  if (view === "reports") main.innerHTML = renderReports();
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

function renderHome() {
  const morning = state.settings.morningEnergyLog[state.selectedDate];
  const metrics = computeMetrics();
  const todayBlocks = blocksForDate(state.selectedDate);

  // v17: 今日の MIT(今日の主役)Block
  const mitBlocks = todayBlocks.filter((b) => b.isMIT);
  const mitDone = mitBlocks.filter((b) => b.completed).length;
  // v17: 前日の日報から「明日の MIT 候補」を抽出して当日に表示
  const previous = addDays(state.selectedDate, -1);
  const prevReport = state.reports?.[previous] || "";
  const yesterdayCandidates = extractMITCandidatesFromReport(prevReport);

  return `
    ${renderHeader("今日の入口", "ホーム", `<button class="btn primary" data-action="today">今日へ</button>`)}
    ${renderDateBar()}

    <section class="panel" style="margin-bottom:12px">
      <div class="row" style="margin-bottom:8px; align-items:center">
        <h2>✦ 今日の主役 (MIT)</h2>
        <div class="muted" style="font-size:13px">${mitDone} / ${mitBlocks.length} 達成</div>
      </div>
      ${mitBlocks.length === 0 ? `
        <div class="muted" style="font-size:13px; padding:8px 0">
          ${yesterdayCandidates.length > 0
            ? `<div style="margin-bottom:10px; padding:10px; background:rgba(255,214,10,0.08); border-radius:8px; border-left:3px solid #FFD60A">
                <div style="font-weight:600; color:var(--text); margin-bottom:6px">📌 昨日のあなたが提案した MIT 候補</div>
                ${yesterdayCandidates.map((c) => `<div style="margin:2px 0">• ${escapeHTML(c)}</div>`).join("")}
              </div>`
            : ""}
          今日特に集中することを <strong>1〜3 個</strong> 選びましょう。<br>
          タスクシュート画面の各 Block 横の <strong>☆</strong> ボタンで設定。
          <div style="margin-top:8px"><button class="btn primary" data-action="nav" data-view="tasks">タスクシュートへ</button></div>
        </div>
      ` : `
        <div class="grid" style="gap:8px">
          ${mitBlocks.map((b) => `
            <div class="row" style="align-items:center; padding:8px 10px; background:rgba(255,214,10,0.08); border-radius:8px; border-left:3px solid #FFD60A">
              <span style="font-size:18px">${b.completed ? "✅" : "⬜"}</span>
              <strong style="flex:1; ${b.completed ? "text-decoration:line-through; opacity:0.6" : ""}">${escapeHTML(b.title)}</strong>
              <button class="btn ghost" data-action="nav" data-view="tasks">行く</button>
            </div>
          `).join("")}
        </div>
      `}
    </section>

    <section class="panel">
      <h2>朝の体調</h2>
      <div class="segmented">
        ${energyLevels.map((level) => `
          <button class="${Number(morning) === level.value ? "active" : ""}" data-action="set-morning" data-value="${level.value}">
            ${level.label} ${level.value}
          </button>
        `).join("")}
      </div>
    </section>

    <section class="section grid two">
      ${metrics.map((metric) => `
        <div class="panel metric">
          <div class="metric-label">${metric.label}</div>
          <div class="metric-value">${metric.value}</div>
          <div class="progress"><span style="width:${clamp(metric.progress, 0, 100)}%"></span></div>
          <div class="muted">${metric.note}</div>
        </div>
      `).join("")}
    </section>
  `;
}

// v17: 前日の日報から「明日の MIT 候補」を抽出する
function extractMITCandidatesFromReport(reportText) {
  if (!reportText) return [];
  // 「明日の MIT 候補:」の行から数行抽出(箇条書きまたは1行)
  const lines = reportText.split("\n");
  const idx = lines.findIndex((line) => /明日の\s*MIT\s*候補/i.test(line));
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
      ? `<section class="panel" style="margin-top:12px; text-align:center; padding:32px"><div class="muted">${filter.area ? `「${filter.area}」のやりたいことはまだありません` : "やりたいことを追加してみましょう(壮大なものでもOK)"}</div></section>`
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
  const block = makeBlock({
    date: state.selectedDate,
    title: task.title,
    category: task.category || "回復",
    taskId: task.id,
    expectedCharge: 4,
    expectedDischarge: 1
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

  return `
    ${renderHeader("ビジョンを実行へ落とす", "WBS")}
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
      ${sorted.map(renderProjectTree).join("")}
    </section>
  `;
}

function renderProjectTree(project) {
  const allTasksOfProject = state.tasks.filter((task) => !task.deleted && task.projectId === project.id);
  const rootTasks = allTasksOfProject.filter((t) => !t.parentTaskId);
  const progress = taskProgress(allTasksOfProject);
  const is12WY = Boolean(project.twelveWeekStartDate);
  return `
    <div class="item">
      <div class="row">
        <div class="title-line">
          <span class="badge ${project.kind === "wish" ? "purple" : "blue"}">${project.kind === "wish" ? "Wish" : "Project"}</span>
          ${is12WY ? `<span class="badge green">12WY</span>` : ""}
          <strong>${escapeHTML(project.title)}</strong>
          ${project.category ? `<span class="cat-chip" style="background:${getCategoryColor(project.category)}1f; color:${getCategoryColor(project.category)}; border:1px solid ${getCategoryColor(project.category)}66">${escapeHTML(project.category)}</span>` : ""}
        </div>
        <div class="row">
          <button class="btn" data-action="add-task-to-project" data-id="${project.id}">+ タスク</button>
          <button class="btn" data-action="edit-project" data-id="${project.id}">編集</button>
        </div>
      </div>
      ${project.description ? `<div class="muted" style="font-size:12px">${escapeHTML(project.description)}</div>` : ""}
      <div class="progress"><span style="width:${progress}%"></span></div>
      <div class="stack">
        ${rootTasks.length
          ? rootTasks.map((t) => renderTaskTree(t, allTasksOfProject, 0)).join("")
          : `<div class="muted">Task未登録</div>`}
      </div>
    </div>
  `;
}

function renderTaskTree(task, allTasksOfProject, depth) {
  const children = allTasksOfProject.filter((t) => t.parentTaskId === task.id);
  const indent = depth * 18;
  return `
    <div style="margin-left:${indent}px">
      ${renderTaskRow(task, depth)}
      ${children.map((c) => renderTaskTree(c, allTasksOfProject, depth + 1)).join("")}
    </div>
  `;
}

function renderTaskRow(task, depth = 0) {
  const dueLabel = task.dueDate ? ` / 期限 ${task.dueDate}` : "";
  const canAddSub = depth < 2;  // 最大 3 階層(0,1,2)、depth=2 の子はもう作らない
  return `
    <div class="row" style="border-top:1px solid var(--line-soft); padding-top:8px">
      <div class="title-line">
        ${depth > 0 ? `<span class="muted" style="font-size:11px">${"└".padStart(depth, "　")}</span>` : ""}
        <button class="checkbox-button ${task.status === "completed" ? "done" : ""}" data-action="toggle-task" data-id="${task.id}">✓</button>
        <span>${escapeHTML(task.title)}</span>
        <span class="badge">${task.status}</span>
        ${task.category ? `<span class="cat-chip" style="background:${getCategoryColor(task.category)}1f; color:${getCategoryColor(task.category)}; border:1px solid ${getCategoryColor(task.category)}66">${escapeHTML(task.category)}</span>` : ""}
        <span class="muted" style="font-size:11px">${dueLabel}</span>
      </div>
      <div class="row">
        <button class="btn" data-action="task-today" data-id="${task.id}">今日へ</button>
        ${canAddSub ? `<button class="btn" data-action="add-subtask" data-parent-task="${task.id}">+ サブ</button>` : ""}
        <button class="btn" data-action="edit-task" data-id="${task.id}">編集</button>
      </div>
    </div>
  `;
}

function renderTasks() {
  return `
    ${renderHeader("今日の実行リスト", "タスクシュート")}
    ${renderDateBar()}
    <section class="form-strip">
      <input id="blockTitle" class="input" placeholder="Block名">
      <select id="blockCategory" class="select">
        <option value="仕事">仕事</option>
        <option value="開発">開発</option>
        <option value="生活">生活</option>
        <option value="回復">回復</option>
        <option value="内省">内省</option>
      </select>
      <button class="btn primary" data-action="add-block">Block追加</button>
    </section>

    <section class="section grid">
      ${blocksForDate(state.selectedDate).filter((b) => b.source !== "timeline").map(renderBlockItem).join("") || emptyPanel("この日のBlockはまだありません(タイムラインで追加したものは時間タブに表示)")}
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
  const taskIDsInBlocks = new Set(state.blocks.filter((block) => !block.deleted && block.date === state.selectedDate).map((block) => block.taskId));
  const open = state.tasks.filter((task) => !task.deleted && task.status !== "completed" && !taskIDsInBlocks.has(task.id));
  if (!open.length) return emptyPanel("持ち越すTaskはありません");
  return open.map((task) => {
    const dueLabel = task.dueDate ? ` / 期限 ${task.dueDate}` : "";
    const isOverdue = task.dueDate && task.dueDate < state.selectedDate;
    return `
      <div class="item" ${isOverdue ? 'style="background:var(--red-soft)"' : ""}>
        <div class="row">
          <div style="min-width:0; flex:1">
            <strong>${escapeHTML(task.title)}</strong>
            <div class="muted" style="font-size:12px">${escapeHTML(projectName(task.projectId))} / ${escapeHTML(task.category || "カテゴリなし")}${dueLabel}</div>
          </div>
          <div class="row">
            <button class="btn" data-action="task-today" data-id="${task.id}">今日へ</button>
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
  return `
    <div class="item block-row ${isMIT ? "is-mit" : ""}" ${leftBorder ? `style="${leftBorder}"` : ""}>
      <button class="checkbox-button ${block.completed ? "done" : ""}" data-action="toggle-block" data-id="${block.id}">✓</button>
      <div class="stack">
        <div class="title-line">
          ${isMIT ? `<span class="mit-star" title="今日の主役" style="color:#F5A623; font-weight:700">★</span>` : ""}
          <strong>${escapeHTML(block.title)}</strong>
          <span class="badge ${block.completed ? "green" : "blue"}">${start}${end ? `-${end}` : ""}</span>
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
      <div class="row">
        <button class="btn ${isMIT ? "" : "ghost"}" data-action="toggle-mit" data-id="${block.id}" title="${isMIT ? "今日の主役から外す" : "今日の主役にする(最大3個)"}" style="${isMIT ? "color:#F5A623; font-weight:700" : ""}">${isMIT ? "★" : "☆"}</button>
        <button class="btn" data-action="now-start" data-id="${block.id}">開始</button>
        <button class="btn" data-action="now-end" data-id="${block.id}">終了</button>
        <button class="btn orange" data-action="start-pomodoro" data-block-id="${block.id}">25分</button>
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
      <span class="muted" style="font-size:12px">空き時間タップで追加 / ○タップで完了登録 / カードタップで編集</span>
    </div>
    ${renderTimeline({ compact: false, mode })}
  `;
}

function setTimelineMode(mode) {
  state.timelineMode = mode;
  saveState();
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
      ${renderEnergyGraph(allBlocks, rowHeight, startHour, endHour)}
    </div>
  `;
}

// v10: Blockをレーンに割り当てる(時刻軸方向の重なりを横並びに展開)
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

  // 各レーンの「最後の終了時刻(分単位)」を管理
  const laneEnds = new Array(maxLanes).fill(-1);
  const result = [];
  for (const item of sorted) {
    // 空いているレーン(最後の終了 ≤ 自分の開始)を探す
    let lane = -1;
    for (let i = 0; i < maxLanes; i++) {
      if (laneEnds[i] <= item.start) {
        lane = i;
        break;
      }
    }
    let isOverflow = false;
    if (lane === -1) {
      // 全レーン満杯: 最後のレーンに重ねる(視覚的に "+N" にする)
      lane = maxLanes - 1;
      isOverflow = true;
    }
    laneEnds[lane] = Math.max(laneEnds[lane], item.end);
    result.push({ ...item, lane, isOverflow });
  }
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
  const { block, startStr, endStr, lane, isOverflow, top, height, isShort } = positioned;

  // v10: レーン位置(0〜maxLanes-1) を % で配置
  const widthPercent = 100 / maxLanes;
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
      return `
        <section class="panel" style="display:grid; place-items:center; min-height:380px; padding:24px">
          ${renderCircularProgress(progress, breakDisplay, "var(--orange)")}
          <div style="text-align:center; margin-top:14px">
            <div style="font-size:13px; font-weight:700; color:var(--orange)">☕️ 休憩中</div>
            <div class="muted" style="font-size:11px; margin-top:4px">5:00 → 0:00(実時間)</div>
            ${message ? `<div style="margin-top:10px; font-size:14px; font-weight:600; color:var(--text)">${escapeHTML(message)}</div>` : ""}
          </div>
          <div style="margin-top:18px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap">
            <button class="btn green" data-action="end-break">✓ 休憩終了</button>
          </div>
        </section>
        <section class="panel stack" style="margin-top:12px">
          <div class="muted" style="font-size:12px">次にとりかかるタスクを選択(休憩を終了して即開始)</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap">
            ${blockOptions.length
              ? blockOptions.map((block) => `
                <button class="btn orange" data-action="start-pomodoro" data-block-id="${block.id}">${escapeHTML(block.title)}</button>
              `).join("")
              : `<div class="muted">選択可能な Block がありません</div>`}
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

function renderPassiveSettings(passive) {
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `
    <label class="checkbox-line">
      <input type="checkbox" data-passive-field="enabled" ${passive.enabled ? "checked" : ""}>
      常時タイマーを有効にする
    </label>
    <div class="field">
      <label class="field-label">対象曜日</label>
      <div style="display:flex; gap:6px; flex-wrap:wrap">
        ${weekdays.map((label, i) => `
          <label class="checkbox-line" style="background:var(--panel-soft); padding:4px 10px; border-radius:6px">
            <input type="checkbox" data-passive-weekday="${i}" ${passive.activeWeekdays[i] ? "checked" : ""}> ${label}
          </label>
        `).join("")}
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label class="field-label">開始時刻</label>
        <input class="input" type="time" data-passive-field="activeStartHHMM" value="${passive.activeStartHHMM}">
      </div>
      <div class="field">
        <label class="field-label">終了時刻</label>
        <input class="input" type="time" data-passive-field="activeEndHHMM" value="${passive.activeEndHHMM}">
      </div>
    </div>
    <div class="row">
      <button class="btn" data-action="request-notification-permission">通知を許可</button>
      <button class="btn ghost" data-action="passive-test-start">▶ テスト開始(今すぐ)</button>
    </div>
    <div class="muted" style="font-size:11px">通知の状態: ${getNotificationPermissionLabel()}</div>
    <div class="muted" style="font-size:11px; line-height:1.6">
      ※ ホーム画面に追加した PWA でないと通知が動かない場合があります。<br>
      ※ アプリを閉じている間は通知が出ません。
    </div>
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

// テスト開始(今すぐ常時タイマーを発火)
function passiveTestStart() {
  state.pomodoro.passive ||= defaultPassivePomodoro();
  const now = new Date();
  state.pomodoro.passive.lastFiredAt = Date.now();
  state.pomodoro.passive.lastFiredKey = `TEST_${Date.now()}`;
  saveState();
  fireNotification("ポモドーロ開始(テスト)", "25分の集中タイム");
  setTimeout(() => fireNotification("作業終了", "5分の休憩を取りましょう"), 25 * 60 * 1000);
  setTimeout(() => fireNotification("休憩終了", "次の集中タイムまで余裕があります"), 30 * 60 * 1000);
  showToast("テスト開始しました");
  render();
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

function renderMarkdown(text) {
  if (typeof window.marked === "undefined") {
    return `<pre style="white-space:pre-wrap; font-family:inherit">${escapeHTML(text)}</pre>`;
  }
  try {
    return window.marked.parse(text || "", { breaks: true, gfm: true });
  } catch {
    return `<pre style="white-space:pre-wrap; font-family:inherit">${escapeHTML(text)}</pre>`;
  }
}

function renderReports() {
  const report = state.reports[state.selectedDate] || "";
  return `
    ${renderHeader("生成AIへ渡す素材", "日報")}
    ${renderDateBar()}
    <div class="row" style="margin-bottom:12px">
      <button class="btn primary" data-action="generate-report">日報を生成</button>
      <button class="btn" data-action="download-report">Markdown保存</button>
    </div>
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
          <input class="input" type="date" data-setting-field="birthDate" value="${state.settings.birthDate || ""}">
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
      </div>
      <div class="panel stack">
        <h2>GitHub保存(クラウド永続化)</h2>
        <div class="muted" style="font-size:12px; line-height:1.6">
          Safari の PWA からは iCloud Drive に直接書き込めないため、GitHub への保存でクラウド永続化を実現します。
          自動保存を ON にすると変更後 30 秒で自動的に push されます。
        </div>
        <label>Owner
          <input class="input" data-github-field="owner" value="${escapeHTML(github.owner)}" autocomplete="off">
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
          <input class="input" type="password" data-github-field="token" value="${escapeHTML(github.token)}" autocomplete="off" placeholder="GitHub token">
        </label>
        <label class="checkbox-line">
          <input type="checkbox" data-github-field="autoSave" ${github.autoSave ? "checked" : ""}>
          自動保存を有効にする(変更後 30 秒のデバウンス)
        </label>
        <div class="muted" data-auto-save-status style="font-size:12px">
          ${github.lastSavedAt ? `最終保存: ${github.lastSavedAt.replace("T", " ")}` : (github.autoSave ? "自動保存: 有効(まだ保存していません)" : "自動保存: 無効")}
        </div>
        <div class="row">
          <button class="btn primary" data-action="save-github">今すぐGitHubへ保存</button>
          <button class="btn" data-action="load-github">GitHubから読込</button>
        </div>
        <div class="muted" style="font-size:11px">TokenはGitHubへ保存しません。この端末のブラウザ内だけに保持します。</div>
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
          <input type="color" data-cat-id="${c.id}" data-cat-field="color" value="${c.color}" style="width:36px; height:36px; padding:0; border:none; background:transparent; cursor:pointer">
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
            <input class="input" type="number" min="0" max="300" data-msg-id="${m.id}" data-msg-field="fromSec" value="${m.fromSec}" style="width:70px">
            <span class="muted">〜</span>
            <input class="input" type="number" min="0" max="301" data-msg-id="${m.id}" data-msg-field="toSec" value="${m.toSec}" style="width:70px">
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

function renderDateBar() {
  return `
    <div class="datebar">
      <button class="btn" data-action="date-prev">前日</button>
      <input class="input" type="date" data-date-picker value="${state.selectedDate}">
      <button class="btn" data-action="date-next">翌日</button>
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
    // v17: Habit Stacking
    trigger: "",        // 何の後にやる?(例: "朝のコーヒー")
    celebrate: "",      // 完了時の祝福メッセージ(例: "Yes! 一歩進んだ!")
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
}

// Project 配下に Task を直接追加(prompt でタイトル入力)
function addTaskToProject(projectId) {
  const title = window.prompt("タスク名を入力してください");
  if (!title || !title.trim()) return;
  const task = makeTask({ projectId, title: title.trim() });
  state.tasks.push(task);
  saveAndRender("Taskを追加しました");
  // 即座に編集モーダルを開いて詳細を編集できるように
  setTimeout(() => openTaskEditor(task.id), 50);
}

// Task のサブタスクを追加(prompt でタイトル入力、親と同じ projectId を継承)
function addSubtask(parentTaskId) {
  const parent = state.tasks.find((t) => t.id === parentTaskId);
  if (!parent) return;
  // 階層制限: 既に depth 2 の Task に対しては作らない
  const depth = getTaskDepth(parent);
  if (depth >= 2) {
    showToast("これ以上の階層は作れません(最大 3 階層)");
    return;
  }
  const title = window.prompt(`「${parent.title}」のサブタスク名を入力`);
  if (!title || !title.trim()) return;
  const task = makeTask({
    projectId: parent.projectId,
    parentTaskId,
    title: title.trim(),
    category: parent.category || ""
  });
  state.tasks.push(task);
  saveAndRender("サブタスクを追加しました");
  setTimeout(() => openTaskEditor(task.id), 50);
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
  state.tasks = state.tasks.map((task) => {
    if (task.id !== id) return task;
    return { ...task, status: task.status === "completed" ? "todo" : "completed", updatedAt: nowDateTime() };
  });
  saveAndRender("Taskを更新しました");
}

function deleteTask(id) {
  state.tasks = state.tasks.map((task) => task.id === id ? { ...task, deleted: true, updatedAt: nowDateTime() } : task);
  state.blocks = state.blocks.map((block) => block.taskId === id ? { ...block, taskId: "", updatedAt: nowDateTime() } : block);
  saveAndRender("Taskを削除しました");
}

function createBlockFromTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  state.blocks.push(makeBlock({
    taskId,
    date: state.selectedDate,
    title: task.title,
    category: task.category || projectName(task.projectId)
  }));
  saveAndRender("今日のBlockに追加しました");
}

function addBlock() {
  const title = document.querySelector("#blockTitle")?.value.trim();
  const category = document.querySelector("#blockCategory")?.value || "";
  if (!title) return showToast("Block名を入力してください");
  state.blocks.push(makeBlock({ date: state.selectedDate, title, category }));
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
  // v17: 完了時の演出(花火 + celebrate メッセージ)
  if (justCompleted && completedBlock) {
    // 紐づく Task に celebrate メッセージがあれば取得
    const task = completedBlock.taskId ? state.tasks.find((t) => t.id === completedBlock.taskId) : null;
    const celebrateMsg = (task && task.celebrate) ? task.celebrate : (completedBlock.isMIT ? "Yes! 主役を1つやり切った!" : "");
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

// v17: 完了時の演出(花火 + celebrate メッセージ)
function triggerCompletionEffect(message, isMIT) {
  // DOM に演出要素を挿入(画面中央付近)
  const container = document.createElement("div");
  container.className = "completion-effect";
  // 粒子(8〜14個、ランダムな角度)
  const particleCount = isMIT ? 14 : 8;
  for (let i = 0; i < particleCount; i++) {
    const angle = (i / particleCount) * Math.PI * 2 + Math.random() * 0.5;
    const distance = 60 + Math.random() * 60;
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance - 20;  // 少し上方向に
    const particle = document.createElement("span");
    particle.className = "ce-particle";
    particle.textContent = isMIT ? "✦" : "✨";
    particle.style.setProperty("--tx", `${tx}px`);
    particle.style.setProperty("--ty", `${ty}px`);
    particle.style.setProperty("--delay", `${i * 30}ms`);
    container.appendChild(particle);
  }
  // celebrate メッセージ
  if (message) {
    const msgEl = document.createElement("div");
    msgEl.className = "ce-message";
    msgEl.textContent = message;
    container.appendChild(msgEl);
  }
  document.body.appendChild(container);
  // 1.5 秒後に自動削除
  setTimeout(() => container.remove(), 1500);
}

function setBlockTime(id, field) {
  updateBlockField(id, field, nowDateTime());
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

function generateReport() {
  ensureJournal(state.selectedDate);
  const date = state.selectedDate;
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
  ];

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
  lines.push("");
  lines.push("の観点で、簡潔にフィードバックをください。");
  lines.push("(辛口でも構いません、ただし行動に繋がる具体性を重視)");
  lines.push("```");

  const report = lines.join("\n");
  state.reports[date] = report;
  saveAndRender("日報を生成しました(v17 仕様)");
  state.currentView = "reports";
  saveState();
  render();
}

function downloadReport() {
  const report = state.reports[state.selectedDate] || "";
  if (!report) return showToast("先に日報を生成してください");
  downloadText(`日報_${state.selectedDate}.md`, report, "text/markdown");
}

function downloadData() {
  downloadText(`taskchute_journal_backup_${todayISO()}.json`, JSON.stringify(state, null, 2), "application/json");
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state = normalizeState(JSON.parse(String(reader.result)));
      saveAndRender("データをインポートしました");
    } catch {
      showToast("JSONを読み込めませんでした");
    }
  };
  reader.readAsText(file);
}

async function saveToGitHub(silent = false) {
  try {
    const config = requireGitHubConfig();
    const sha = await fetchGitHubFileSHA(config);
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

    state.settings.github.lastSavedAt = nowDateTime();
    saveState();
    if (!silent) showToast("GitHubへ保存しました");
    if (silent) updateAutoSaveStatus();
  } catch (error) {
    if (!silent) showToast(`GitHub保存失敗: ${error.message}`);
    else updateAutoSaveStatus(`失敗: ${error.message}`);
  }
}

// 自動保存(変更後 30秒のデバウンス、Token + autoSave=true 時のみ)
let autoSaveTimer = null;
const AUTO_SAVE_DEBOUNCE_MS = 30000;

function scheduleAutoSave() {
  const cfg = state.settings.github || {};
  if (!cfg.autoSave) return;
  if (!cfg.token || !cfg.owner || !cfg.repo) return;
  clearTimeout(autoSaveTimer);
  updateAutoSaveStatus("変更検知 — 30秒後に保存予定");
  autoSaveTimer = setTimeout(() => {
    saveToGitHub(true);
  }, AUTO_SAVE_DEBOUNCE_MS);
}

function updateAutoSaveStatus(text) {
  const el = document.querySelector("[data-auto-save-status]");
  if (!el) return;
  const cfg = state.settings.github || {};
  if (text) {
    el.textContent = text;
    return;
  }
  if (cfg.lastSavedAt) {
    el.textContent = `最終保存: ${cfg.lastSavedAt.replace("T", " ")}`;
  } else {
    el.textContent = cfg.autoSave ? "自動保存: 有効(まだ保存していません)" : "自動保存: 無効";
  }
}

async function loadFromGitHub() {
  try {
    const config = requireGitHubConfig();
    const response = await fetch(`${gitHubContentsURL(config)}?ref=${encodeURIComponent(config.branch)}`, {
      headers: githubHeaders(config.token)
    });
    if (!response.ok) {
      throw new Error(await gitHubErrorMessage(response));
    }
    const payload = await response.json();
    const loaded = JSON.parse(fromBase64(payload.content || ""));
    const token = state.settings.github.token;
    state = normalizeState(loaded);
    state.settings.github = { ...config, token };
    saveAndRender("GitHubから読み込みました");
  } catch (error) {
    showToast(`GitHub読込失敗: ${error.message}`);
  }
}

function requireGitHubConfig() {
  const config = state.settings.github || defaultGitHubSettings();
  for (const key of ["owner", "repo", "branch", "path", "token"]) {
    if (!config[key]) throw new Error(`${key} を入力してください`);
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
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function gitHubErrorMessage(response) {
  try {
    const payload = await response.json();
    return payload.message || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

function sanitizedStateForGitHub() {
  const copy = structuredClone(state);
  if (copy.settings?.github) copy.settings.github.token = "";
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
    state.blocks = state.blocks.map((block) => block.id === blockId
      ? {
          ...block,
          pomodoroCount: Number(block.pomodoroCount || 0) + 1,
          actualEndAt: nowDateTime(),
          updatedAt: nowDateTime()
        }
      : block);
  }
  // v14: state.pomodoro を完全再構築
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
  saveAndRender("ポモドーロを完了しました");
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
  const now = Date.now();
  state.pomodoro = {
    tab: state.pomodoro?.tab || "manual",
    passive: state.pomodoro?.passive || defaultPassivePomodoro(),
    fullscreen: state.pomodoro?.fullscreen || false,
    running: true,
    blockId: "",
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
  }, 500);
}

function setView(view) {
  state.currentView = view;
  saveState();
  render();
}

function setSelectedDate(date) {
  if (!date) return;
  state.selectedDate = date;
  ensureJournal(date);
  saveState();
  render();
}

function shiftSelectedDate(delta) {
  setSelectedDate(addDays(state.selectedDate, delta));
}

function saveAndRender(message) {
  saveState();
  render();
  if (message) showToast(message);
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
  if (changed && (state.view === "vision" || state.currentView === "journal")) {
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
  saveState();
  render();
}

function setVisionBoardIndex(index) {
  state.settings.visionBoardIndex = index;
  saveState();
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
    state.journals[date] = state.settings.journalTemplate || defaultJournal(date);
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

function taskProgress(tasks) {
  if (!tasks.length) return 0;
  return Math.round((tasks.filter((task) => task.status === "completed").length / tasks.length) * 100);
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
  return `${dateToISO(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:00`;
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
  const d = new Date(dateTime);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getHours() * 60 + d.getMinutes();
}

function timeFromDateTime(dateTime) {
  if (!dateTime) return "";
  const d = new Date(dateTime);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
                <option value="${s}" ${status === s ? "selected" : ""}>${s}</option>
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
        <h3 class="modal-title">Task を編集</h3>
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
                <option value="${s}" ${status === s ? "selected" : ""}>${s}</option>
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
        <details class="field" style="padding:10px; background:var(--panel-soft); border-radius:8px">
          <summary style="cursor:pointer; font-size:13px; font-weight:600; color:var(--muted)">🔗 Habit Stacking(任意 - ルーティン向け)</summary>
          <div style="margin-top:10px; display:grid; gap:10px">
            <div class="field" style="margin:0">
              <label class="field-label">何の後にやる?(きっかけの習慣)</label>
              <input class="input" data-modal-field="trigger" value="${escapeHTML(task.trigger || "")}" placeholder="例: 朝のコーヒー、歯磨きの後">
            </div>
            <div class="field" style="margin:0">
              <label class="field-label">完了時の祝福メッセージ</label>
              <input class="input" data-modal-field="celebrate" value="${escapeHTML(task.celebrate || "")}" placeholder="例: Yes! 一歩進んだ!">
            </div>
            <div class="muted" style="font-size:11px; line-height:1.6">
              「<strong>何の後にやる?</strong>」を書くと、既存の習慣にぶら下げて新しい行動を定着させやすくなります(Atomic Habits / Habit Stacking)。<br>
              「<strong>祝福メッセージ</strong>」は完了時に画面に表示されます(BJ Fogg / Tiny Habits)。
            </div>
          </div>
        </details>
      </div>
      <div class="modal-footer">
        <button class="btn danger" data-action="modal-delete">削除</button>
        <button class="btn" data-action="modal-close">キャンセル</button>
        <button class="btn primary" data-action="modal-save">保存</button>
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
      trigger: fields.trigger || "",
      celebrate: fields.celebrate || "",
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
            <input class="input" type="datetime-local" data-modal-field="plannedStartAt" value="${toLocalInput(block.plannedStartAt)}">
          </div>
          <div class="field">
            <label class="field-label">予定終了</label>
            <input class="input" type="datetime-local" data-modal-field="plannedEndAt" value="${toLocalInput(block.plannedEndAt)}">
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">実績開始</label>
            <input class="input" type="datetime-local" data-modal-field="actualStartAt" value="${toLocalInput(block.actualStartAt)}">
          </div>
          <div class="field">
            <label class="field-label">実績終了</label>
            <input class="input" type="datetime-local" data-modal-field="actualEndAt" value="${toLocalInput(block.actualEndAt)}">
          </div>
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
        ${block._isNew ? `
        <div class="field" style="background:var(--accent-soft); padding:10px; border-radius:8px">
          <label class="field-label" style="color:var(--accent); font-weight:700">🔁 繰り返し設定(新規作成時のみ)</label>
          <select class="select" data-modal-field="recurrenceKind" id="recurrenceKindSelect">
            <option value="">繰り返さない(1 つだけ作成)</option>
            <option value="daily">毎日</option>
            <option value="weekdays">平日のみ(月〜金)</option>
            <option value="weekly">毎週(同じ曜日)</option>
            <option value="monthly">毎月(同じ日)</option>
          </select>
          <label class="field-label" style="margin-top:8px">終了日(これより前まで生成)</label>
          <input class="input" type="date" data-modal-field="recurrenceUntil" value="${addDays(block.date || todayISO(), 90)}">
          <div class="muted" style="font-size:11px; margin-top:4px">同じ groupId で複数の Block を一括生成します</div>
        </div>
        ` : ""}
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
    expectedCharge: existing?.expectedCharge ?? "",
    expectedDischarge: existing?.expectedDischarge ?? "",
    recurrenceGroupId: existing?.recurrenceGroupId || "",
    pomodoroCount: existing?.pomodoroCount || 0,
    migratedTo: existing?.migratedTo || "",
    orderIndex: existing?.orderIndex || 0,
    createdAt: existing?.createdAt || nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
  if (isNew) {
    state.blocks.push(updated);
    // 繰り返し指定があれば、追加で生成
    if (fields.recurrenceKind && fields.recurrenceUntil) {
      const generated = generateRecurringBlocks(updated, fields.recurrenceKind, fields.recurrenceUntil);
      closeModal();
      saveAndRender(`Blockを ${1 + generated.length} 件作成しました(繰り返し含む)`);
      return;
    }
    closeModal();
    saveAndRender("Blockを追加しました");
  } else {
    state.blocks = state.blocks.map((b) => b.id === id ? updated : b);
    closeModal();
    saveAndRender("Blockを更新しました");
  }
}

// 繰り返し Block を一括生成
function generateRecurringBlocks(template, kind, untilDate) {
  const groupId = crypto.randomUUID();
  // 既存(template)にもgroupIdを付ける
  state.blocks = state.blocks.map((b) => b.id === template.id ? { ...b, recurrenceGroupId: groupId } : b);

  const startDate = parseDate(template.date);
  const endDate = parseDate(untilDate);
  const startTimeStr = template.plannedStartAt ? template.plannedStartAt.split("T")[1] || "" : "";
  const endTimeStr = template.plannedEndAt ? template.plannedEndAt.split("T")[1] || "" : "";

  const generated = [];
  let cursor = new Date(startDate);
  cursor.setDate(cursor.getDate() + 1);  // 翌日から
  let safety = 0;
  const maxIter = 400;  // 安全策

  while (cursor.getTime() <= endDate.getTime() && safety < maxIter) {
    safety++;
    const wd = cursor.getDay();
    let matches = false;
    if (kind === "daily") {
      matches = true;
    } else if (kind === "weekdays") {
      matches = wd >= 1 && wd <= 5;
    } else if (kind === "weekly") {
      matches = wd === startDate.getDay();
    } else if (kind === "monthly") {
      matches = cursor.getDate() === startDate.getDate();
    }
    if (matches) {
      const date = dateToISO(cursor);
      const newBlock = {
        ...template,
        id: crypto.randomUUID(),
        date,
        plannedStartAt: startTimeStr ? `${date}T${startTimeStr}` : "",
        plannedEndAt: endTimeStr ? `${date}T${endTimeStr}` : "",
        actualStartAt: "",
        actualEndAt: "",
        completed: false,
        recurrenceGroupId: groupId,
        createdAt: nowDateTime(),
        updatedAt: nowDateTime()
      };
      state.blocks.push(newBlock);
      generated.push(newBlock);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return generated;
}

// タイムラインの空き時間行クリックで新規Block作成モーダル
function openTimelineNewBlock(startMinute) {
  const hour = Math.floor(startMinute / 60);
  const minute = startMinute % 60;
  const date = state.selectedDate;
  const startISO = `${date}T${pad2(hour)}:${pad2(minute)}:00`;
  const endISO = `${date}T${pad2(hour + 1)}:${pad2(minute)}:00`;
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
  // ISO 8601 (例: 2026-05-17T14:30:00Z) → datetime-local の値 (2026-05-17T14:30)
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return "";
  // datetime-local の値 ('YYYY-MM-DDTHH:mm') をそのまま使う(UTC変換しない)
  // 秒を追加して 'YYYY-MM-DDTHH:mm:00' にする
  return value.length === 16 ? `${value}:00` : value;
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

function getPassivePomodoroStatus() {
  const p = state.pomodoro?.passive || defaultPassivePomodoro();
  if (!p.enabled) return "無効";
  const now = new Date();
  const weekday = now.getDay();
  const dayLabel = ["日", "月", "火", "水", "木", "金", "土"][weekday];
  if (!p.activeWeekdays[weekday]) return `今日(${dayLabel})は対象外`;
  const currentHHMM = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  if (currentHHMM < p.activeStartHHMM || currentHHMM > p.activeEndHHMM) {
    return `時間帯外 (${p.activeStartHHMM}〜${p.activeEndHHMM})`;
  }
  return `アクティブ — 次の発火: 毎時 00 分 / 30 分`;
}

function getNotificationPermissionLabel() {
  if (!("Notification" in window)) return "このブラウザは通知非対応";
  if (Notification.permission === "granted") return "✓ 許可済み";
  if (Notification.permission === "denied") return "拒否(Safariの設定から変更可能)";
  return "未許可";
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    showToast("このブラウザは通知に対応していません");
    return;
  }
  if (Notification.permission === "granted") {
    showToast("既に許可されています");
    return;
  }
  const result = await Notification.requestPermission();
  showToast(result === "granted" ? "通知を許可しました" : "通知が許可されませんでした");
  render();
}

function setPomodoroTab(tab) {
  state.pomodoro.tab = tab;
  saveState();
  render();
}

function checkPassivePomodoro() {
  const p = state.pomodoro?.passive;
  if (!p?.enabled) return;
  const now = new Date();
  const weekday = now.getDay();
  if (!p.activeWeekdays[weekday]) return;
  const currentHHMM = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  if (currentHHMM < p.activeStartHHMM) return;
  if (currentHHMM > p.activeEndHHMM) return;
  const minute = now.getMinutes();
  if (minute !== 0 && minute !== 30) return;
  // 重複発火防止
  const fireKey = `${now.toDateString()} ${pad2(now.getHours())}:${pad2(minute)}`;
  if (state.pomodoro.passive.lastFiredKey === fireKey) return;
  state.pomodoro.passive.lastFiredKey = fireKey;
  state.pomodoro.passive.lastFiredAt = Date.now();
  saveState();
  fireNotification(
    "ポモドーロ開始",
    `${pad2(now.getHours())}:${pad2(minute)} から 25 分の集中タイム`
  );
  // 25分後の作業終了通知をスケジュール
  setTimeout(() => {
    fireNotification("ポモドーロ作業終了", "5 分の休憩を取りましょう");
  }, 25 * 60 * 1000);
  // 30分後(休憩終了)
  setTimeout(() => {
    fireNotification("休憩終了", "次の集中タイムまで余裕があります");
  }, 30 * 60 * 1000);
}

function fireNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body,
      icon: "./assets/icon.svg",
      tag: "passive-pomodoro",
      silent: false
    });
  } catch (e) {
    console.warn("Notification failed:", e);
  }
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
ensurePassivePomodoro();

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
const _originalGenerateReport = generateReport;
generateReport = function() {
  _originalGenerateReport();
  // 設定: autoSave が ON なら日報も自動 push
  const cfg = state.settings.github;
  if (cfg?.autoSave && cfg?.token && cfg?.owner) {
    const date = state.selectedDate;
    const report = state.reports[date];
    if (report) {
      pushFileToGitHub(`日報_${date}.md`, report, `日報 ${date}`);
    }
  }
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
            <input class="input" type="datetime-local" data-modal-field="actualStartAt" value="${toLocalInput(defaultStart)}">
          </div>
          <div class="field">
            <label class="field-label">実績終了</label>
            <input class="input" type="datetime-local" data-modal-field="actualEndAt" value="${toLocalInput(defaultEnd)}">
          </div>
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
