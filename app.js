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

render();
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
  if (action === "reset-demo") resetDemoData();
  if (action === "start-pomodoro") startPomodoro(target.dataset.blockId || "");
  if (action === "stop-pomodoro") stopPomodoro();
  if (action === "complete-pomodoro") completePomodoro();
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
  if (target.matches("#importData")) importData(target.files?.[0]);
});

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seedState();
  try {
    return { ...seedState(), ...JSON.parse(raw) };
  } catch {
    return seedState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
      journalPanes: { leftWidthPct: 25, centerWidthPct: 50, rightWidthPct: 25 }
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
        </div>
        <button class="btn danger" data-action="delete-project" data-id="${project.id}">削除</button>
      </div>
      <div class="progress"><span style="width:${progress}%"></span></div>
      <div class="stack">
        ${tasks.length ? tasks.map(renderTaskRow).join("") : `<div class="muted">Task未登録</div>`}
      </div>
    </div>
  `;
}

function renderTaskRow(task) {
  return `
    <div class="row" style="border-top:1px solid var(--line-soft); padding-top:8px">
      <div class="title-line">
        <button class="checkbox-button ${task.status === "completed" ? "done" : ""}" data-action="toggle-task" data-id="${task.id}">✓</button>
        <span>${escapeHTML(task.title)}</span>
        <span class="badge">${task.status}</span>
      </div>
      <div class="row">
        <button class="btn" data-action="task-today" data-id="${task.id}">今日へ</button>
        <button class="btn danger" data-action="delete-task" data-id="${task.id}">削除</button>
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
        <button class="btn danger" data-action="delete-block" data-id="${block.id}">削除</button>
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
  return `
    ${renderHeader("集中タイマー", "ポモドーロ")}
    <section class="panel" style="display:grid; place-items:center; min-height:360px">
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
  return `
    ${renderHeader("方向性を見失わないための場所", "ビジョン")}
    <section class="grid two">
      <div class="panel">
        <h2>Vision.md</h2>
        <textarea class="textarea" data-vision-field="vision">${escapeHTML(state.settings.vision || "")}</textarea>
      </div>
      <div class="panel">
        <h2>Affirmation.md</h2>
        <textarea class="textarea" data-vision-field="affirmation">${escapeHTML(state.settings.affirmation || "")}</textarea>
      </div>
    </section>
  `;
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
        <h2>GitHub Pages</h2>
        <div class="muted">このフォルダをGitHubリポジトリへpushし、Pagesの公開元をルートにすると公開できます。</div>
        <div class="muted">端末間同期はまだありません。まずはローカル保存 + JSONエクスポート運用です。</div>
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
      state = JSON.parse(String(reader.result));
      saveAndRender("データをインポートしました");
    } catch {
      showToast("JSONを読み込めませんでした");
    }
  };
  reader.readAsText(file);
}

function resetDemoData() {
  state = seedState();
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
  timerTicker = setInterval(() => {
    if (!state.pomodoro.running) return;
    if (new Date(state.pomodoro.endsAt).getTime() <= Date.now()) {
      completePomodoro();
      return;
    }
    if (state.currentView === "pomodoro") renderMain();
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
  const time = dateTime.includes("T") ? dateTime.split("T")[1] : dateTime;
  const [hour, minute] = time.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function timeFromDateTime(dateTime) {
  return dateTime ? dateTime.split("T")[1]?.slice(0, 5) || "" : "";
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
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // localhost / https 以外では登録されない。開発中は無視してよい。
    });
  });
}
