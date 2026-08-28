// v288: WBS内Project/Task検索と、新規Projectの既定collapsed=true。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-08-28";
const OLD_MODIFIED = "2026-08-01T00:00:00";
const FIXED_NOW = new Date(2026, 7, 28, 10, 0, 0);
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function project(id, title, extra = {}) {
  return {
    id, kind: "normal", title, category: "仕事", status: "active", priority: "中",
    description: "", dueDate: "", twelveWeekStartDate: "", showProgress: false,
    collapsed: false, createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`,
    deleted: false, ...extra
  };
}

function task(id, projectId, title, extra = {}) {
  return {
    id, projectId, parentTaskId: "", title, category: "", status: "todo", dueDate: "",
    description: "", progressNum: 0, progressDen: 10, collapsed: false,
    createdAt: `${TODAY}T09:00:00`, updatedAt: `${TODAY}T09:00:00`,
    deleted: false, ...extra
  };
}

async function stateNow(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
}

async function seed(page, values = {}) {
  await page.evaluate(({ key, values, today, oldModified }) => {
    const state = JSON.parse(localStorage.getItem(key));
    Object.assign(state, {
      projects: values.projects || [], tasks: values.tasks || [], blocks: [], recurrences: [],
      tracks: values.tracks || [], trackMeasurements: values.trackMeasurements || [],
      currentView: "wbs", selectedDate: today, dataModifiedAt: oldModified
    });
    state.settings = {
      ...state.settings, showSuspended: false, wbsHideCompleted: false,
      wbsCategoryFilter: "", wbsEditMode: false, twelveWeekStartDate: "",
      ...(values.settings || {})
    };
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: STATE_KEY, values, today: TODAY, oldModified: OLD_MODIFIED });
  await page.reload();
  await page.waitForSelector('#app[data-view="wbs"] #wbs-search-input');
}

async function installSpies(page) {
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    window.__v288StateWrites = 0;
    Storage.prototype.setItem = function patchedSetItem(k, value) {
      if (k === key) window.__v288StateWrites += 1;
      return original.call(this, k, value);
    };
    window.__v288Scrolled = null;
    Element.prototype.scrollIntoView = function scrollSpy(options) {
      window.__v288Scrolled = { id: this.dataset.wbsRowId || "", options };
    };
  }, STATE_KEY);
}

async function search(page, query) {
  const input = page.locator("#wbs-search-input");
  await input.fill(query);
  await page.waitForFunction((q) => {
    const results = document.querySelector("#wbs-search-results");
    return results?.textContent.toLowerCase().includes(q.trim().toLowerCase());
  }, query);
}

async function clickResult(page, id) {
  await page.locator(`[data-action="wbs-search-jump"][data-id="${id}"]`).click();
  await page.waitForFunction((wanted) => window.__v288Scrolled?.id === wanted, id);
}

async function verifySearchAndDebounce(page) {
  console.log("[1] 検索: Project/Task部分一致・案内・0件・削除/XSS負例・上限50件");
  const p = project("p-search", "ALPHA案件");
  const tasks = [
    task("t-alpha", p.id, "alpha設計"),
    task("t-deleted", p.id, "削除済みTask", { deleted: true }),
    task("t-live-under-deleted", "p-deleted", "削除配下の生Task")
  ];
  await seed(page, {
    projects: [p, project("p-uncat", "危険<img src=x onerror=alert(1)>", { category: "" }),
      project("p-deleted", "削除済みProject", { deleted: true })], tasks
  });
  check("初期案内は2文字以上", (await page.locator("#wbs-search-results").textContent()).trim() === "2文字以上で検索します。");
  await page.locator("#wbs-search-input").fill("a");
  await page.waitForFunction(() => document.querySelector("#wbs-search-results")?.textContent.trim() === "2文字以上で検索します。");

  await search(page, "alpha");
  const alphaRows = await page.$$eval('[data-action="wbs-search-jump"]', (rows) => rows.map((row) => ({
    kind: row.dataset.kind, id: row.dataset.id,
    label: row.querySelector(".search-kind")?.textContent,
    category: row.querySelector(".search-date")?.textContent,
    title: row.querySelector(".search-snippet")?.textContent
  })));
  check("大文字小文字を区別せずProject/Taskを部分一致", JSON.stringify(alphaRows) === JSON.stringify([
    { kind: "project", id: "p-search", label: "Project", category: "仕事", title: "ALPHA案件" },
    { kind: "task", id: "t-alpha", label: "Task", category: "仕事", title: "alpha設計" }
  ]), JSON.stringify(alphaRows));

  await search(page, "危険");
  check("タイトルはescapeHTMLされタグを生成しない", await page.locator("#wbs-search-results img").count() === 0
    && (await page.locator('[data-id="p-uncat"] .search-snippet').textContent()).includes("<img")
    && await page.locator('[data-id="p-uncat"] .search-date').textContent() === "未分類");
  await search(page, "削除");
  check("削除Project/Taskと削除Project配下Taskはヒットしない",
    await page.locator('[data-action="wbs-search-jump"]').count() === 0
    && (await page.locator("#wbs-search-results").textContent()).includes("一致するものはありません"));
  await search(page, "存在しない");
  check("0件メッセージは入力値を表示", (await page.locator("#wbs-search-results").textContent()).includes("「存在しない」に一致するものはありません。"));

  await seed(page, { projects: Array.from({ length: 51 }, (_, index) => project(`p-limit-${index}`, `上限対象${String(index).padStart(2, "0")}`)) });
  await search(page, "上限");
  check("51件中上位50件だけ表示", await page.locator('[data-action="wbs-search-jump"]').count() === 50
    && (await page.locator("#wbs-search-results > .muted").textContent()).trim() === "51件(上位50件を表示)");

  console.log("[2] 150msデバウンスは結果だけを差分更新し、focus/IME相当のinput同一性を維持");
  await seed(page, { projects: [project("p-focus", "連続入力検索対象")] });
  await page.evaluate(() => {
    const input = document.querySelector("#wbs-search-input");
    window.__v288InputNode = input;
    input.focus();
    input.value = "連続";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "続" }));
    input.value = "連続入力";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "入力" }));
  });
  await page.waitForFunction(() => document.querySelector('[data-action="wbs-search-jump"][data-id="p-focus"]'));
  const focusState = await page.evaluate((key) => ({
    sameNode: window.__v288InputNode === document.querySelector("#wbs-search-input"),
    focused: document.activeElement === document.querySelector("#wbs-search-input"),
    modified: JSON.parse(localStorage.getItem(key)).dataModifiedAt
  }), STATE_KEY);
  check("連続入力後も同じinputがfocus中で全体renderなし", focusState.sameNode && focusState.focused, JSON.stringify(focusState));
  check("検索入力だけでは保存・dataModifiedAt更新なし", focusState.modified === OLD_MODIFIED, focusState.modified);
}

async function verifyJumpPaths(page) {
  console.log("[3] ジャンプ: ProjectとTask depth 0/1/2、祖先展開、scroll、保存、updatedAt不変");
  const p = project("p-tree", "階層Project", { collapsed: true });
  const root = task("t-root", p.id, "ルート対象", { collapsed: true });
  const child = task("t-child", p.id, "中間対象", { parentTaskId: root.id, collapsed: true });
  const grand = task("t-grand", p.id, "末端対象", { parentTaskId: child.id, collapsed: true });
  const originalUpdated = { p: p.updatedAt, root: root.updatedAt, child: child.updatedAt, grand: grand.updatedAt };

  async function run({ id, query, expectedOpen, expectedStillClosed = [], filter = "仕事" }) {
    await seed(page, { projects: [p], tasks: [root, child, grand], settings: { wbsCategoryFilter: filter } });
    await installSpies(page);
    await search(page, query);
    await clickResult(page, id);
    const state = await stateNow(page);
    const byId = Object.fromEntries(state.tasks.map((item) => [item.id, item]));
    check(`${query}: Projectと必要な祖先だけ展開`, !state.projects.find((item) => item.id === p.id).collapsed
      && expectedOpen.every((taskId) => byId[taskId]?.collapsed === false)
      && expectedStillClosed.every((taskId) => byId[taskId]?.collapsed === true));
    check(`${query}: scrollIntoView smooth/center`, await page.evaluate((wanted) => window.__v288Scrolled?.id === wanted
      && window.__v288Scrolled.options?.behavior === "smooth" && window.__v288Scrolled.options?.block === "center", id));
    check(`${query}: saveStateを1回通りdataModifiedAt更新`, await page.evaluate(() => window.__v288StateWrites) === 1
      && state.dataModifiedAt !== OLD_MODIFIED, JSON.stringify({ writes: await page.evaluate(() => window.__v288StateWrites), modified: state.dataModifiedAt }));
    check(`${query}: Project/TaskのupdatedAtは全て不変`, state.projects.find((item) => item.id === p.id).updatedAt === originalUpdated.p
      && byId[root.id].updatedAt === originalUpdated.root && byId[child.id].updatedAt === originalUpdated.child
      && byId[grand.id].updatedAt === originalUpdated.grand);
    return state;
  }

  let state = await run({ id: p.id, query: "階層", expectedOpen: [], expectedStillClosed: [root.id, child.id, grand.id] });
  check("カテゴリ一致なら不要な絞り込み解除・showSuspended変更なし",
    state.settings.wbsCategoryFilter === "仕事" && state.settings.showSuspended === false);
  await run({ id: root.id, query: "ルート", expectedOpen: [], expectedStillClosed: [root.id, child.id, grand.id] });
  await run({ id: child.id, query: "中間", expectedOpen: [root.id], expectedStillClosed: [child.id, grand.id] });
  await run({ id: grand.id, query: "末端", expectedOpen: [root.id, child.id], expectedStillClosed: [grand.id] });

  console.log("[4] 非表示ガード: category不一致・中断Project/Task/祖先・不正kind/id");
  const pausedProject = project("p-paused", "中断Project対象", { category: "仕事", status: "paused", collapsed: true });
  await seed(page, { projects: [pausedProject], settings: { wbsCategoryFilter: "学び", showSuspended: false } });
  await installSpies(page);
  await search(page, "中断Project");
  await clickResult(page, pausedProject.id);
  state = await stateNow(page);
  check("カテゴリ不一致をすべてへ戻し、中断Projectを表示", state.settings.wbsCategoryFilter === ""
    && state.settings.showSuspended === true && state.projects.find((item) => item.id === pausedProject.id).collapsed === false);

  const activeProject = project("p-susp-task", "中断Task案件", { collapsed: true });
  const suspendedRoot = task("t-susp-root", activeProject.id, "中断祖先", { status: "suspended", collapsed: true });
  const activeGrand = task("t-active-grand", activeProject.id, "祖先配下対象", { parentTaskId: suspendedRoot.id });
  await seed(page, { projects: [activeProject], tasks: [suspendedRoot, activeGrand] });
  await installSpies(page);
  await search(page, "祖先配下");
  await clickResult(page, activeGrand.id);
  state = await stateNow(page);
  check("中断祖先が対象を隠す場合もshowSuspended=true", state.settings.showSuspended === true
    && state.tasks.find((item) => item.id === suspendedRoot.id).collapsed === false);

  const suspendedTarget = task("t-susp-target", activeProject.id, "中断Task自身", { status: "suspended" });
  await seed(page, { projects: [activeProject], tasks: [suspendedTarget] });
  await installSpies(page);
  await search(page, "中断Task自身");
  await clickResult(page, suspendedTarget.id);
  check("中断Task自身へのジャンプもshowSuspended=true", (await stateNow(page)).settings.showSuspended === true);

  await seed(page, { projects: [project("p-invalid", "不正操作対象")] });
  await installSpies(page);
  await search(page, "不正操作");
  const before = await stateNow(page);
  await page.locator('[data-action="wbs-search-jump"][data-id="p-invalid"]').evaluate((row) => { row.dataset.kind = "invalid"; });
  await page.locator('[data-action="wbs-search-jump"][data-id="p-invalid"]').click();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  const afterInvalidKind = await stateNow(page);
  check("不正kindはfail-quietで保存しない", JSON.stringify(afterInvalidKind) === JSON.stringify(before)
    && await page.evaluate(() => window.__v288StateWrites) === 0);
  await page.locator('[data-action="wbs-search-jump"][data-kind="invalid"]').evaluate((row) => { row.dataset.kind = "project"; row.dataset.id = "missing"; });
  await page.locator('[data-action="wbs-search-jump"][data-id="missing"]').click();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  check("存在しないidもfail-quietで保存しない", await page.evaluate(() => window.__v288StateWrites) === 0);
}

async function verifyRegressionAndProjectDefault(page) {
  console.log("[5] 12WYトラック/週次実行計画は検索・ジャンプでstate/UI/並び順不変");
  const cycle = "2026-08-15";
  const p = project("p-plan", "計画Project", { twelveWeekStartDate: cycle });
  const parent = task("t-plan-parent", p.id, "計画親", { planTarget: true, order: 1000 });
  const stepA = task("t-plan-a", p.id, "検索する計画A", { parentTaskId: parent.id, owner: "k", order: 1000 });
  const stepB = task("t-plan-b", p.id, "計画B", { parentTaskId: parent.id, owner: "ai", aiWork: true, order: 2000 });
  const track = {
    id: "track-v288", ownerType: "project", ownerId: p.id, cycleStartDate: cycle,
    kind: "numeric", name: "週次KPI", unit: "件", startDate: cycle, deadline: "2026-09-30",
    baselineValue: 0, goalValue: 10, valueStep: 1, milestones: [], status: "active",
    closedAt: "", closedReason: "", supersedesTrackId: "", carriedFromTrackId: "",
    createdAt: `${cycle}T00:00:00`, updatedAt: `${cycle}T00:00:00`, deleted: false
  };
  await seed(page, { projects: [p], tasks: [parent, stepA, stepB], tracks: [track], settings: { twelveWeekStartDate: cycle } });
  const initialWbsTreeSnapshot = await page.locator('#app[data-view="wbs"] section.section.grid')
    .evaluate((tree) => tree.innerHTML);
  const initialSearchValue = await page.locator("#wbs-search-input").inputValue();
  await page.locator('#bottomNav [data-action="nav"][data-view="today"]').click();
  await page.waitForSelector('#app[data-view="today"]');
  await page.locator('#bottomNav [data-action="nav"][data-view="more"]').click();
  await page.waitForSelector('#app[data-view="more"]');
  await page.locator('.more-tower-grid [data-action="nav"][data-view="wbs"]').click();
  await page.waitForSelector('#app[data-view="wbs"] #wbs-search-input');
  const rerenderedWbsTreeSnapshot = await page.locator('#app[data-view="wbs"] section.section.grid')
    .evaluate((tree) => tree.innerHTML);
  const rerenderedSearchValue = await page.locator("#wbs-search-input").inputValue();
  check("検索未使用の再render後も12WY Project/Task行DOM断片は完全一致",
    initialSearchValue === "" && rerenderedSearchValue === ""
    && rerenderedWbsTreeSnapshot === initialWbsTreeSnapshot,
    JSON.stringify({
      initialSearchValue, rerenderedSearchValue,
      initialLength: initialWbsTreeSnapshot.length, rerenderedLength: rerenderedWbsTreeSnapshot.length
    }));
  const snapshot = await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    const taskFields = state.tasks.filter((item) => item.id.startsWith("t-plan"))
      .map(({ id, parentTaskId, planTarget, owner, aiWork, order, status, updatedAt }) => ({ id, parentTaskId, planTarget, owner, aiWork, order, status, updatedAt }));
    const order = [...document.querySelectorAll('span[data-action="edit-task"][data-id^="t-plan"]')].map((el) => el.dataset.id);
    const actions = [...document.querySelectorAll('[data-action="toggle-plan-owner"],[data-action="move-plan-step"],[data-action="add-plan-step-below"]')]
      .map((el) => `${el.dataset.action}:${el.dataset.id}:${el.dataset.direction || ""}:${el.textContent.trim()}`);
    return { tracks: state.tracks, taskFields, order, actions, trackRows: document.querySelectorAll('[data-twy-track-id="track-v288"]').length };
  }, STATE_KEY);
  await installSpies(page);
  await search(page, "検索する計画");
  await clickResult(page, stepA.id);
  const after = await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    const taskFields = state.tasks.filter((item) => item.id.startsWith("t-plan"))
      .map(({ id, parentTaskId, planTarget, owner, aiWork, order, status, updatedAt }) => ({ id, parentTaskId, planTarget, owner, aiWork, order, status, updatedAt }));
    const order = [...document.querySelectorAll('span[data-action="edit-task"][data-id^="t-plan"]')].map((el) => el.dataset.id);
    const actions = [...document.querySelectorAll('[data-action="toggle-plan-owner"],[data-action="move-plan-step"],[data-action="add-plan-step-below"]')]
      .map((el) => `${el.dataset.action}:${el.dataset.id}:${el.dataset.direction || ""}:${el.textContent.trim()}`);
    return { tracks: state.tracks, taskFields, order, actions, trackRows: document.querySelectorAll('[data-twy-track-id="track-v288"]').length };
  }, STATE_KEY);
  check("12WY track state/row数は不変", JSON.stringify(after.tracks) === JSON.stringify(snapshot.tracks)
    && snapshot.trackRows === 1 && after.trackRows === 1, JSON.stringify({ before: snapshot.trackRows, after: after.trackRows }));
  check("週次実行計画のstate・操作UI・Task並び順は不変", JSON.stringify(after.taskFields) === JSON.stringify(snapshot.taskFields)
    && JSON.stringify(after.actions) === JSON.stringify(snapshot.actions)
    && JSON.stringify(after.order) === JSON.stringify(snapshot.order));

  console.log("[6] 新規Projectは既定collapsed=trueで保存・再読込後も折りたたみ");
  await seed(page, { projects: [] });
  await installSpies(page);
  await page.locator("#projectTitle").fill("新規closed案件");
  await page.locator('[data-action="add-project"]').click();
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).projects.some((item) => item.title === "新規closed案件"), STATE_KEY);
  let state = await stateNow(page);
  const added = state.projects.find((item) => item.title === "新規closed案件");
  check("add-project直後collapsed=true・saveState 1回・dataModifiedAt更新", added?.collapsed === true
    && await page.evaluate(() => window.__v288StateWrites) === 1 && state.dataModifiedAt !== OLD_MODIFIED, JSON.stringify(added));
  check("WBS上も展開用caretで折りたたみ表示", await page.locator(`[data-wbs-row-id="${added.id}"] [data-action="toggle-project-collapse"]`).getAttribute("aria-label") === "展開");
  await page.reload();
  await page.waitForSelector(`[data-wbs-row-id="${added.id}"]`);
  state = await stateNow(page);
  check("リロード後もcollapsed=trueを保持", state.projects.find((item) => item.id === added.id)?.collapsed === true
    && await page.locator(`[data-wbs-row-id="${added.id}"] [aria-label="展開"]`).count() === 1);
}

async function verifyResponsive(page) {
  console.log("[7] 390px: 検索input/結果/既存WBS行に横スクロールなし、input 16px・結果44px以上");
  await page.setViewportSize({ width: 390, height: 844 });
  const p = project("p-mobile", "モバイル対象Project");
  const longTitle = `モバイル対象${"長いタイトル".repeat(12)}`;
  await seed(page, { projects: [p], tasks: [task("t-mobile", p.id, longTitle)] });
  await search(page, "モバイル対象");
  const metrics = await page.evaluate(() => {
    const doc = document.scrollingElement || document.documentElement;
    const input = document.querySelector("#wbs-search-input");
    const results = document.querySelector("#wbs-search-results");
    const row = document.querySelector('[data-wbs-row-id="p-mobile"]');
    const rects = [input, results, row].map((el) => el.getBoundingClientRect());
    const heights = [...document.querySelectorAll('[data-action="wbs-search-jump"]')].map((el) => el.getBoundingClientRect().height);
    return {
      noDocOverflow: doc.scrollWidth <= doc.clientWidth + 1,
      rectsInside: rects.every((rect) => rect.left >= -1 && rect.right <= innerWidth + 1),
      fontSize: parseFloat(getComputedStyle(input).fontSize), heights
    };
  });
  check("390pxでdocument/input/結果/Project行に横スクロールなし", metrics.noDocOverflow && metrics.rectsInside, JSON.stringify(metrics));
  check("検索input 16px以上・全結果タップ標的44px以上", metrics.fontSize >= 16
    && metrics.heights.length === 2 && metrics.heights.every((height) => height >= 44), JSON.stringify(metrics));
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await blockGithubApiByDefault(page);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await verifySearchAndDebounce(page);
    await verifyJumpPaths(page);
    await verifyRegressionAndProjectDefault(page);
    await verifyResponsive(page);
    const unexpectedConsoleErrors = consoleErrors.filter((message) =>
      !message.startsWith("Failed to load resource: the server responded with a status of 404"));
    check("全経路でpageerror/予期しないconsole errorなし", pageErrors.length === 0 && unexpectedConsoleErrors.length === 0,
      JSON.stringify({ pageErrors, unexpectedConsoleErrors, expectedBlockedApi404s: consoleErrors.length - unexpectedConsoleErrors.length }));
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }
  console.log(failures === 0 ? "\n✅ v288: 全テスト成功" : `\n❌ v288: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
