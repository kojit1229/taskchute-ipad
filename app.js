const STORAGE_KEY = "taskchute-journal-pwa-state-v1";

const navItems = [
  { id: "home", label: "ホーム", mark: "H" },
  { id: "wbs", label: "WBS", mark: "W" },
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
  if (action === "start-pomodoro") startPomodoro(target.dataset.blockId || "");
  if (action === "stop-pomodoro") stopPomodoro();
  if (action === "complete-pomodoro") completePomodoro();
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
  if (target.matches("[data-passive-field]")) {
    const field = target.dataset.passiveField;
    state.pomodoro.passive ||= defaultPassivePomodoro();
    if (target.type === "checkbox") {
      state.pomodoro.passive[field] = target.checked;
    } else {
      state.pomodoro.passive[field] = target.value;
    }
    saveState();
    render();
  }
  if (target.matches("[data-passive-weekday]")) {
    const idx = Number(target.dataset.passiveWeekday);
    state.pomodoro.passive ||= defaultPassivePomodoro();
    state.pomodoro.passive.activeWeekdays[idx] = target.checked;
    saveState();
    render();
  }
  if (target.matches("#importData")) importData(target.files?.[0]);
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
  value.projects ||= [];
  value.tasks ||= [];
  value.blocks ||= [];
  value.journals ||= {};
  value.feedback ||= {};
  value.reports ||= {};
  value.modal = null;  // 起動時はモーダル閉じた状態
  return value;
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
  sidebar.innerHTML = `
    <div class="brand">
      <div class="brand-title">TaskChute Journal</div>
      <div class="brand-sub">PWA / Local-first MVP</div>
    </div>
    <div class="nav-list">
      ${navItems.map((item) => `
        <button class="nav-button ${state.currentView === item.id ? "active" : ""}" data-action="nav" data-view="${item.id}">
          <span class="nav-mark">${item.mark}</span>
          <span>${item.label}</span>
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
  if (state.currentView === "timeline" || state.currentView === "journal") {
    timelineRail.style.display = "none";
    app.style.gridTemplateColumns = "216px minmax(0, 1fr)";
    return;
  }
  timelineRail.style.display = "";
  app.style.gridTemplateColumns = "";
  timelineRail.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <h3>${formatDisplayDate(state.selectedDate)}</h3>
      <button class="btn ghost" data-action="nav" data-view="timeline">開く</button>
    </div>
    ${renderTimeline({ compact: true })}
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
  const todayBlocks = blocksForDate(state.selectedDate).slice(0, 4);

  return `
    ${renderHeader("今日の入口", "ホーム", `<button class="btn primary" data-action="today">今日へ</button>`)}
    ${renderDateBar()}
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

    <section class="section">
      <div class="row" style="margin-bottom:10px">
        <h2>今日のBlock</h2>
        <button class="btn ghost" data-action="nav" data-view="tasks">編集</button>
      </div>
      <div class="grid">
        ${todayBlocks.length ? todayBlocks.map(renderBlockItem).join("") : emptyPanel("まだBlockがありません")}
      </div>
    </section>
  `;
}

function renderWBS() {
  const activeProjects = state.projects.filter((project) => !project.deleted);
  const sorted = [...activeProjects].sort((a, b) => {
    if (a.kind === "wish" && b.kind !== "wish") return -1;
    if (a.kind !== "wish" && b.kind === "wish") return 1;
    return a.title.localeCompare(b.title, "ja");
  });

  return `
    ${renderHeader("ビジョンを実行へ落とす", "WBS")}
    <section class="form-strip">
      <input id="projectTitle" class="input" placeholder="Project名">
      <select id="projectKind" class="select">
        <option value="normal">通常Project</option>
        <option value="wish">Wish Project</option>
      </select>
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
  const tasks = state.tasks.filter((task) => !task.deleted && task.projectId === project.id);
  const progress = taskProgress(tasks);
  const is12WY = Boolean(project.twelveWeekStartDate);
  return `
    <div class="item">
      <div class="row">
        <div class="title-line">
          <span class="badge ${project.kind === "wish" ? "purple" : "blue"}">${project.kind === "wish" ? "Wish" : "Project"}</span>
          ${is12WY ? `<span class="badge green">12WY</span>` : ""}
          <strong>${escapeHTML(project.title)}</strong>
          ${project.category ? `<span class="badge">${escapeHTML(project.category)}</span>` : ""}
        </div>
        <div class="row">
          <button class="btn" data-action="edit-project" data-id="${project.id}">編集</button>
        </div>
      </div>
      ${project.description ? `<div class="muted" style="font-size:12px">${escapeHTML(project.description)}</div>` : ""}
      <div class="progress"><span style="width:${progress}%"></span></div>
      <div class="stack">
        ${tasks.length ? tasks.map(renderTaskRow).join("") : `<div class="muted">Task未登録</div>`}
      </div>
    </div>
  `;
}

function renderTaskRow(task) {
  const dueLabel = task.dueDate ? ` / 期限 ${task.dueDate}` : "";
  return `
    <div class="row" style="border-top:1px solid var(--line-soft); padding-top:8px">
      <div class="title-line">
        <button class="checkbox-button ${task.status === "completed" ? "done" : ""}" data-action="toggle-task" data-id="${task.id}">✓</button>
        <span>${escapeHTML(task.title)}</span>
        <span class="badge">${task.status}</span>
        ${task.category ? `<span class="badge">${escapeHTML(task.category)}</span>` : ""}
        <span class="muted" style="font-size:11px">${dueLabel}</span>
      </div>
      <div class="row">
        <button class="btn" data-action="task-today" data-id="${task.id}">今日へ</button>
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
      ${blocksForDate(state.selectedDate).map(renderBlockItem).join("") || emptyPanel("この日のBlockはまだありません")}
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
  return open.map((task) => `
    <div class="item">
      <div class="row">
        <div>
          <strong>${escapeHTML(task.title)}</strong>
          <div class="muted">${escapeHTML(projectName(task.projectId))} / ${escapeHTML(task.category || "カテゴリなし")}</div>
        </div>
        <button class="btn" data-action="task-today" data-id="${task.id}">今日へ</button>
      </div>
    </div>
  `).join("");
}

function renderBlockItem(block) {
  const start = block.plannedStartAt ? timeFromDateTime(block.plannedStartAt) : "未定";
  const end = block.plannedEndAt ? timeFromDateTime(block.plannedEndAt) : "";
  const task = block.taskId ? state.tasks.find((item) => item.id === block.taskId) : null;
  return `
    <div class="item block-row">
      <button class="checkbox-button ${block.completed ? "done" : ""}" data-action="toggle-block" data-id="${block.id}">✓</button>
      <div class="stack">
        <div class="title-line">
          <strong>${escapeHTML(block.title)}</strong>
          <span class="badge ${block.completed ? "green" : "blue"}">${start}${end ? `-${end}` : ""}</span>
          ${task ? `<span class="badge">${escapeHTML(projectName(task.projectId))}</span>` : `<span class="badge orange">単発</span>`}
        </div>
        <div class="block-meta">
          <span class="muted">${escapeHTML(block.category || "カテゴリなし")}</span>
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
        <button class="btn" data-action="now-start" data-id="${block.id}">開始</button>
        <button class="btn" data-action="now-end" data-id="${block.id}">終了</button>
        <button class="btn orange" data-action="start-pomodoro" data-block-id="${block.id}">25分</button>
        <button class="btn" data-action="edit-block" data-id="${block.id}">編集</button>
      </div>
    </div>
  `;
}

function renderTimelineView() {
  return `
    ${renderHeader("時間軸とエネルギー", "タイムライン")}
    ${renderDateBar()}
    ${renderTimeline({ compact: false })}
  `;
}

function renderTimeline({ compact }) {
  const blocks = blocksForDate(state.selectedDate).filter((block) => block.plannedStartAt);
  const rowHeight = compact ? 34 : 40;
  const startHour = 5;
  const endHour = 24;
  const rows = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
  const points = energyPoints(blocks, rowHeight, startHour);

  return `
    <div class="timeline" style="${compact ? "min-height:650px" : ""}">
      ${rows.map((hour) => `
        <div class="time-row" style="top:${(hour - startHour) * rowHeight}px;height:${rowHeight}px">${String(hour).padStart(2, "0")}:00</div>
      `).join("")}
      <div class="energy-line"></div>
      ${blocks.map((block) => renderTimelineCard(block, rowHeight, startHour)).join("")}
      ${points.map((point) => `<span class="energy-point" title="${point.value}" style="top:${point.top}px; right:${point.right}px"></span>`).join("")}
    </div>
  `;
}

function renderTimelineCard(block, rowHeight, startHour) {
  const start = minutesOf(block.plannedStartAt);
  const end = block.plannedEndAt ? minutesOf(block.plannedEndAt) : start + 30;
  const top = Math.max(0, ((start - startHour * 60) / 60) * rowHeight);
  const height = Math.max(32, ((end - start) / 60) * rowHeight);
  return `
    <div class="timeline-card ${block.completed ? "completed" : ""}" style="top:${top}px;height:${height}px">
      <strong>${escapeHTML(block.title)}</strong><br>
      ${timeFromDateTime(block.plannedStartAt)}-${block.plannedEndAt ? timeFromDateTime(block.plannedEndAt) : ""}
    </div>
  `;
}

function renderPomodoro() {
  const running = state.pomodoro.running;
  const remaining = running ? remainingText(state.pomodoro.endsAt) : "25:00";
  const blockOptions = blocksForDate(state.selectedDate).filter((block) => !block.completed);
  const passive = state.pomodoro.passive || defaultPassivePomodoro();
  const pomoTab = state.pomodoro.tab || "manual";
  return `
    ${renderHeader("集中タイマー", "ポモドーロ")}
    <div class="segmented" style="margin-bottom:14px">
      <button class="${pomoTab === "manual" ? "active" : ""}" data-action="pomo-tab" data-tab="manual">任意タイマー</button>
      <button class="${pomoTab === "passive" ? "active" : ""}" data-action="pomo-tab" data-tab="passive">常時タイマー</button>
    </div>
    ${pomoTab === "manual" ? renderManualPomodoro(running, remaining, blockOptions) : renderPassivePomodoro(passive)}
  `;
}

function renderManualPomodoro(running, remaining, blockOptions) {
  return `
    <section class="panel" style="display:grid; place-items:center; min-height:300px">
      <div style="text-align:center">
        <div class="metric-value" style="font-size:56px; font-variant-numeric:tabular-nums">${remaining}</div>
        <div class="muted">${running ? "任意タイマー実行中" : "Blockを選んで開始"}</div>
        <div style="margin-top:18px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap">
          ${running ? `
            <button class="btn green" data-action="complete-pomodoro">完了</button>
            <button class="btn danger" data-action="stop-pomodoro">中断</button>
          ` : blockOptions.map((block) => `
            <button class="btn orange" data-action="start-pomodoro" data-block-id="${block.id}">${escapeHTML(block.title)}</button>
          `).join("") || `<button class="btn" data-action="nav" data-view="tasks">Blockを作る</button>`}
        </div>
      </div>
    </section>
  `;
}

function renderPassivePomodoro(passive) {
  const status = getPassivePomodoroStatus();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `
    <section class="panel stack">
      <h2>常時タイマー</h2>
      <div class="muted" style="font-size:12px; line-height:1.6">
        指定した曜日・時間帯の毎時 00 分 / 30 分に自動的に通知が出ます。<br>
        PWA(またはブラウザタブ)が開いている間だけ動作します。
      </div>
      <div style="background:var(--panel-soft); padding:10px; border-radius:6px; font-size:13px">
        <strong>状態:</strong> ${status}
      </div>
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
        <span class="muted" style="font-size:12px">通知の状態: ${getNotificationPermissionLabel()}</span>
      </div>
      <div class="muted" style="font-size:11px; line-height:1.6">
        ※ iOS Safari の制約により、ホーム画面に追加した PWA でないと通知が動作しないことがあります。<br>
        ※ アプリを閉じている間は通知が出ません。
      </div>
    </section>
  `;
}

function renderJournal() {
  ensureJournal(state.selectedDate);
  const previous = addDays(state.selectedDate, -1);
  return `
    ${renderHeader("過去の自分・今の自分・外部視点", "ジャーナル")}
    ${renderDateBar()}
    <section class="journal-grid">
      <div class="panel">
        <h2>前日</h2>
        <div class="readonly-md">${escapeHTML(state.journals[previous] || "記載なし")}</div>
      </div>
      <div class="panel">
        <div class="row" style="margin-bottom:10px">
          <h2>当日編集</h2>
          <button class="btn primary" data-action="generate-report">日報生成</button>
        </div>
        <textarea class="textarea" data-journal-date="${state.selectedDate}">${escapeHTML(state.journals[state.selectedDate])}</textarea>
      </div>
      <div class="panel">
        <h2>AIフィードバック</h2>
        <textarea class="textarea" data-feedback-date="${state.selectedDate}" placeholder="外部AIの返答をここに貼り付け">${escapeHTML(state.feedback[state.selectedDate] || "")}</textarea>
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
        <h2>GitHub Pages</h2>
        <div class="muted">このフォルダをGitHubリポジトリへpushし、Pagesの公開元をルートにすると公開できます。</div>
      </div>
    </section>
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
  state.tasks.push({
    id: crypto.randomUUID(),
    projectId,
    title,
    category: "",
    status: "todo",
    dueDate: state.selectedDate,
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  });
  saveAndRender("Taskを追加しました");
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
  state.blocks = state.blocks.map((block) => {
    if (block.id !== id) return block;
    const completed = !block.completed;
    if (completed && block.taskId) {
      state.tasks = state.tasks.map((task) => task.id === block.taskId && task.status === "todo" ? { ...task, status: "doing", updatedAt: nowDateTime() } : task);
    }
    return { ...block, completed, actualEndAt: completed && !block.actualEndAt ? nowDateTime() : block.actualEndAt, updatedAt: nowDateTime() };
  });
  saveAndRender("Blockを更新しました");
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
  const blocks = blocksForDate(state.selectedDate);
  const completed = blocks.filter((block) => block.completed);
  const charge = blocks.reduce((sum, block) => sum + Number(block.charge || 0), 0);
  const discharge = blocks.reduce((sum, block) => sum + Number(block.discharge || 0), 0);
  const morning = state.settings.morningEnergyLog[state.selectedDate] ?? 5;
  const net = morning + charge - discharge;
  const report = [
    `# 日報 ${state.selectedDate} (${weekdayLabel(state.selectedDate)})`,
    "",
    `> 今日はBlock ${completed.length}/${blocks.length}件完了、エネルギー終値 ${signed(net)}。`,
    "",
    "## 0. メタ情報",
    `- 日付: ${state.selectedDate}`,
    `- 生成日時: ${nowDateTime().replace("T", " ")}`,
    "- データバージョン: Web MVP v1",
    "",
    "## 1. サマリー",
    `| 指標 | 値 |`,
    "|---|---|",
    `| 完了Block | ${completed.length} / ${blocks.length} |`,
    `| 充電累計 | +${charge} |`,
    `| 放電累計 | -${discharge} |`,
    `| 朝の体調 | ${morning} |`,
    `| 純エネルギー終値 | ${signed(net)} |`,
    "",
    "## 2. タスク実行",
    ...blocks.map((block) => `- [${block.completed ? "x" : " "}] ${block.title} | ${block.category || "カテゴリなし"} | 充電+${block.charge}/放電-${block.discharge}`),
    "",
    "## 3. ジャーナル",
    state.journals[state.selectedDate] || ""
  ].join("\n");
  state.reports[state.selectedDate] = report;
  saveAndRender("日報を生成しました");
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
  state.pomodoro = {
    running: true,
    blockId,
    startedAt: nowDateTime(),
    endsAt: dateToLocalDateTime(new Date(Date.now() + 25 * 60 * 1000)),
    mode: "focus"
  };
  updateBlockField(blockId, "actualStartAt", blockById(blockId)?.actualStartAt || nowDateTime());
  saveAndRender("ポモドーロを開始しました");
}

function stopPomodoro() {
  state.pomodoro.running = false;
  saveAndRender("ポモドーロを中断しました");
}

function completePomodoro() {
  const blockId = state.pomodoro.blockId;
  if (blockId) {
    state.blocks = state.blocks.map((block) => block.id === blockId ? { ...block, pomodoroCount: Number(block.pomodoroCount || 0) + 1, updatedAt: nowDateTime() } : block);
  }
  state.pomodoro.running = false;
  saveAndRender("ポモドーロを完了しました");
}

function startTimerTicker() {
  clearInterval(timerTicker);
  let secondsSinceLastPassiveCheck = 0;
  timerTicker = setInterval(() => {
    // 任意タイマー
    if (state.pomodoro.running) {
      if (new Date(state.pomodoro.endsAt).getTime() <= Date.now()) {
        completePomodoro();
      } else if (state.currentView === "pomodoro") {
        renderMain();
      }
    }
    // 常時タイマー(1 分に 1 回チェックすれば十分)
    secondsSinceLastPassiveCheck += 1;
    if (secondsSinceLastPassiveCheck >= 30) {
      secondsSinceLastPassiveCheck = 0;
      checkPassivePomodoro();
    }
  }, 1000);
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
  if (changed && state.view === "vision") {
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

function defaultJournal(date) {
  return `# ${date}\n\n## 朝\n\n今日の方針:\n\n## 昼\n\n## 夕方\n\n## 夜\n\n`;
}

function upsertMorningLine(markdown, line) {
  if (markdown.includes("朝の体調:")) {
    return markdown.replace(/^朝の体調:.*$/m, line);
  }
  if (markdown.includes("## 朝")) {
    return markdown.replace("## 朝", `## 朝\n${line}`);
  }
  return `## 朝\n${line}\n\n${markdown}`;
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
  return {
    label,
    value: `あと${remaining}日`,
    progress: 0,
    note: target
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

function remainingText(end) {
  const remaining = Math.max(0, Math.floor((new Date(end).getTime() - Date.now()) / 1000));
  return `${pad2(Math.floor(remaining / 60))}:${pad2(remaining % 60)}`;
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
          <input class="input" data-modal-field="category" value="${escapeHTML(project.category || "")}" placeholder="仕事 / 健康 / 学習 など">
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
        <div class="field-row">
          <div class="field">
            <label class="field-label">カテゴリ</label>
            <input class="input" data-modal-field="category" value="${escapeHTML(task.category || "")}">
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
        <button class="btn danger" data-action="modal-delete">削除</button>
        <button class="btn" data-action="modal-close">キャンセル</button>
        <button class="btn primary" data-action="modal-save">保存</button>
      </div>
    </div>
  `;
}

function saveTaskFromModal(id, fields) {
  state.tasks = state.tasks.map((t) => {
    if (t.id !== id) return t;
    return {
      ...t,
      title: (fields.title || "").trim() || t.title,
      projectId: fields.projectId || "",
      status: fields.status || t.status || "todo",
      category: fields.category || "",
      dueDate: fields.dueDate || "",
      description: fields.description || "",
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
            <input class="input" data-modal-field="category" value="${escapeHTML(block.category || "")}">
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
  state.blocks = state.blocks.map((b) => {
    if (b.id !== id) return b;
    return {
      ...b,
      title: (fields.title || "").trim() || b.title,
      date: fields.date || b.date || todayISO(),
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
      updatedAt: nowDateTime()
    };
  });
  closeModal();
  saveAndRender("Blockを更新しました");
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
