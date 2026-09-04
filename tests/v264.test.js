// v264: 12WY週次コミット確定シート(b)のB-9 #8〜#19、負例、保存、回帰。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const cssSource = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const PORT = randomPort();
const TODAY = "2026-08-25", WEEK = "2026-08-22", CYCLE = "2026-08-15";
let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}
function actionSource(name) {
  const start = appSource.indexOf(`"${name}":`);
  if (start < 0) throw new Error(`${name} action marker not found`);
  const nextAction = appSource.indexOf("\n  \"", start + name.length + 3);
  const nextComment = appSource.indexOf("\n  //", start + name.length + 3);
  return appSource.slice(start, Math.min(...[nextAction, nextComment].filter((value) => value > start)));
}
function actionHandler(name, sandbox) {
  const source = actionSource(name).trim().replace(/,$/, "");
  return vm.runInContext(`({${source}})[${JSON.stringify(name)}]`, sandbox);
}

const instrumentedAppSource = appSource
  .replace("function generateReport(dateArg, { quiet = false } = {}) {",
    "function generateReport(dateArg, { quiet = false } = {}) { window.__v264GenerateReportCalls = (window.__v264GenerateReportCalls || 0) + 1;")
  .replace("function excuseCommitmentItem(itemId, reason) {",
    "function excuseCommitmentItem(itemId, reason) { window.__v264ExcuseCalls = (window.__v264ExcuseCalls || 0) + 1;")
  .replace("function unexcuseCommitmentItem(itemId) {",
    "function unexcuseCommitmentItem(itemId) { window.__v264UnexcuseCalls = (window.__v264UnexcuseCalls || 0) + 1;")
  .replace("function addCommitmentItems(weekStart, blockIds) {",
    "function addCommitmentItems(weekStart, blockIds) { window.__v264AddCalls = (window.__v264AddCalls || 0) + 1;")
  .replace("function openProjectEditor(id) {",
    "window.__v264SelectionProbe = () => ({ commit: [..._twyCommitSelectedBlockIds], add: [..._twyAddCandidateSelectedIds] });\nfunction openProjectEditor(id) {");

console.log("[1] 静的契約・データ層負例");
const successful = ["twy-excuse-confirm", "twy-unexcuse", "twy-add-item-confirm"];
check("成功3操作はsaveAndRender→renderModalの順", successful.every((name) => {
  const source = actionSource(name);
  return source.indexOf("saveAndRender") < source.lastIndexOf("renderModal");
}));
for (const action of ["twy-excuse", "twy-excuse-cancel", "twy-add-item", "twy-add-item-cancel"]) {
  check(`${action}は表示切替のみ`, /renderModal/.test(actionSource(action)) && !/saveState|saveAndRender/.test(actionSource(action)));
}
check("空白理由ガードはデータ層呼び出しより前", actionSource("twy-excuse-confirm").indexOf("reason.trim")
  < actionSource("twy-excuse-confirm").indexOf("excuseCommitmentItem"));
check("addトグルは専用候補・専用Set・専用カウンタへ結線", /ctx === "add"\s*\? twyAddCandidates/.test(appSource)
  && /ctx === "add" \? _twyAddCandidateSelectedIds/.test(appSource)
  && appSource.includes("[data-twy-add-count]"));
check("C'はweeklyScore import・item.titleスナップショット・理由escapeを使用", appSource.includes("trackDefinitionChanged, weeklyScore")
  && appSource.includes("escapeHTML(item.title)") && appSource.includes("escapeHTML(item.excusedReason)"));
check("免除入力はtext型・16px以上", appSource.includes('type="text" data-twy-excuse-reason')
  && /\.twy-excuse-form input\s*\{[^}]*font-size:\s*16px/s.test(cssSource));
check("免除/解除だけが44pxのpointer標的", /\.c-when\[data-action\]\s*\{[^}]*min-height:\s*44px[^}]*cursor:\s*pointer/s.test(cssSource)
  && !/\.twy-commit-sheet \.c-when\s*\{[^}]*cursor:\s*pointer/s.test(cssSource));

const coreStart = appSource.indexOf("function candidateBlocksForWeek(value, weekStart) {");
const coreEnd = appSource.indexOf("// v257: 12WYトラック定義CRUD", coreStart);
if (coreStart < 0 || coreEnd < 0) throw new Error("commit core source marker not found");
const sandbox = { Map, Set, String, Boolean, saveCount: 0 };
sandbox.todayISO = () => TODAY;
sandbox.nowDateTime = () => `${TODAY}T10:00:00`;
sandbox.parseDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
sandbox.addDays = (iso, delta) => { const date = sandbox.parseDate(iso); date.setDate(date.getDate() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
sandbox.weekRange = (iso) => { const date = sandbox.parseDate(iso), dow = (date.getDay() + 1) % 7;
  const weekStart = sandbox.addDays(iso, -dow); return { weekStart, weekEnd: sandbox.addDays(weekStart, 6) }; };
sandbox.isProjectInCurrentCycle = () => true;
sandbox.activeTrackForProject = () => null;
sandbox.saveState = () => { sandbox.saveCount += 1; };
vm.createContext(sandbox);
vm.runInContext(appSource.slice(coreStart, coreEnd), sandbox);
sandbox.state = { settings: { twelveWeekStartDate: CYCLE },
  projects: [{ id: "p", kind: "normal", status: "active", deleted: false }],
  tasks: [{ id: "t", projectId: "p", status: "todo", deleted: false }],
  blocks: [{ id: "candidate", taskId: "t", date: WEEK, title: "candidate", deleted: false }],
  tracks: [], weeklyCommitments: [] };
sandbox.addCommitmentItems(WEEK, ["candidate"]);
check("週メタ不存在のaddCommitmentItemsはstate不変・保存0回", sandbox.state.weeklyCommitments.length === 0 && sandbox.saveCount === 0);

const uiSandbox = { Set, state: {}, _twyAddCandidateSelectedIds: new Set(), _twyExcuseOpenItemId: null, _twyAddPanelOpen: false };
vm.createContext(uiSandbox);
const uiHandlers = Object.fromEntries([
  "twy-excuse", "twy-excuse-confirm", "twy-excuse-cancel", "twy-unexcuse",
  "twy-add-item", "twy-add-item-confirm", "twy-add-item-cancel"
].map((name) => [name, actionHandler(name, uiSandbox)]));
let uiCalls;
function resetUiProbe(modal = { type: "twyCommit", id: WEEK }, records = []) {
  uiSandbox.state = { modal, weeklyCommitments: records };
  uiSandbox._twyAddCandidateSelectedIds = new Set(); uiSandbox._twyExcuseOpenItemId = null; uiSandbox._twyAddPanelOpen = false;
  uiCalls = { excuse: 0, unexcuse: 0, add: 0, save: 0, render: 0, open: 0, toast: "" };
  uiSandbox.twyCurrentCommitModalWeek = () => uiSandbox.state.modal?.type === "twyCommit" && uiSandbox.state.modal?.id === WEEK ? WEEK : "";
  uiSandbox.twyCommitItemForWeek = (id, weekStart) => uiSandbox.state.weeklyCommitments.find((entry) =>
    entry.id === id && entry.recordType === "item" && entry.weekStart === weekStart && !entry.deleted);
  uiSandbox.twyCommittedWeekMeta = (weekStart) => uiSandbox.state.weeklyCommitments.find((entry) =>
    entry.id === `wcw_${weekStart}` && entry.recordType === "week" && !entry.deleted);
  uiSandbox.twyAddCandidates = () => [{ id: "b4" }, { id: "b5" }];
  uiSandbox.excuseCommitmentItem = () => { uiCalls.excuse += 1; };
  uiSandbox.unexcuseCommitmentItem = () => { uiCalls.unexcuse += 1; };
  uiSandbox.addCommitmentItems = () => { uiCalls.add += 1; };
  uiSandbox.saveAndRender = () => { uiCalls.save += 1; };
  uiSandbox.renderModal = () => { uiCalls.render += 1; };
  uiSandbox.buildTwyCommitSheetHTML = (weekStart) => weekStart;
  uiSandbox.showToast = (message) => { uiCalls.toast = message; };
  uiSandbox.openTwyCommitSheet = () => { uiCalls.open += 1; uiSandbox.state.modal = { type: "twyCommit", id: WEEK }; };
}
const currentMeta = { id: `wcw_${WEEK}`, recordType: "week", weekStart: WEEK, deleted: false };
const currentOpen = { id: `wci_${WEEK}_open`, recordType: "item", weekStart: WEEK, completedAt: "", excused: false, deleted: false };
const currentExcused = { ...currentOpen, id: `wci_${WEEK}_excused`, excused: true };
resetUiProbe(undefined, [currentMeta, currentOpen]);
uiHandlers["twy-excuse-confirm"]({ id: currentOpen.id, target: { closest: () => ({ querySelector: () => ({ value: "   " }) }) } });
check("#10 空白理由はexcuseCommitmentItem呼び出し0回", uiCalls.excuse === 0 && uiCalls.save === 0);
resetUiProbe(undefined, [currentMeta]);
uiHandlers["twy-add-item-confirm"]();
check("#16 選択0件はaddCommitmentItems呼び出し0回", uiCalls.add === 0 && uiCalls.save === 0);
resetUiProbe(undefined, [{ ...currentMeta, deleted: true }]); uiSandbox._twyAddCandidateSelectedIds = new Set(["b4"]);
uiHandlers["twy-add-item-confirm"]();
check("削除済み週メタへの計画追加はUI action経路でno-op", uiCalls.add === 0 && uiCalls.save === 0 && uiCalls.render === 0);
resetUiProbe(undefined, [currentMeta]); uiSandbox._twyAddCandidateSelectedIds = new Set(["removed"]); uiSandbox.twyAddCandidates = () => [];
uiHandlers["twy-add-item-confirm"]();
check("候補フィルタ後0件は偽成功せず正直なtoast", uiCalls.add === 0 && uiCalls.save === 0
  && uiCalls.render === 0 && uiCalls.toast.includes("追加できる候補がありません"));
for (const [name, args, callKey] of [
  ["twy-excuse-confirm", { id: currentOpen.id, target: null }, "excuse"],
  ["twy-unexcuse", { id: currentExcused.id }, "unexcuse"],
  ["twy-add-item-confirm", {}, "add"]
]) {
  resetUiProbe({ type: "twyCommit", id: "2026-08-15" }, [currentMeta, currentOpen, currentExcused]);
  uiSandbox._twyAddCandidateSelectedIds = new Set(["b4"]); uiHandlers[name](args);
  check(`${name}は週跨ぎ時にデータ層no-op・当週シート再open・正直なtoast`, uiCalls[callKey] === 0
    && uiCalls.save === 0 && uiCalls.open === 1 && uiCalls.toast === "週が変わったため当週のシートを開き直しました");
}
for (const name of ["twy-excuse", "twy-excuse-cancel", "twy-add-item", "twy-add-item-cancel"]) {
  resetUiProbe(null, [currentMeta, currentOpen]); uiHandlers[name]({ id: currentOpen.id });
  check(`${name}はmodal type/id欠落時に防御no-op`, uiCalls.render === 0 && uiCalls.save === 0);
}

(async () => {
  console.log("[2] C'表示・B-9 #8〜#19・永続化・回帰");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1024, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await page.route("**/app.js", (route) => route.fulfill({
    status: 200, contentType: "text/javascript; charset=utf-8", body: instrumentedAppSource
  }));
  await blockGithubApiByDefault(page);
  const xss = '\"><img src=x onerror="window.__v264Xss=true"><span data-v264-breach="';
  const idXss = '\"><img src=x onerror="window.__v264IdXss=true" data-v264-id-breach="';
  const project = (id = "p1", title = "Project", extra = {}) => ({ id, kind: "normal", title, status: "active", priority: "中",
    category: "", startDate: CYCLE, dueDate: "", description: "", twelveWeekStartDate: CYCLE,
    showProgress: false, collapsed: false, createdAt: `${CYCLE}T00:00:00`, updatedAt: `${CYCLE}T00:00:00`, deleted: false, ...extra });
  const task = (id = "t1", projectId = "p1", title = "Task", extra = {}) => ({ id, projectId, parentTaskId: "", title,
    category: "", status: "todo", dueDate: "", description: "", progressNum: 0, progressDen: 10,
    createdAt: `${CYCLE}T00:00:00`, updatedAt: `${CYCLE}T00:00:00`, deleted: false, ...extra });
  const block = (id, date, title, extra = {}) => ({ id, taskId: "t1", date, title, category: "",
    plannedStartAt: `${date}T07:00:00`, plannedEndAt: `${date}T07:25:00`, estimateMin: 25,
    completed: false, deleted: false, migratedTo: "", createdAt: `${date}T00:00:00`, updatedAt: `${date}T00:00:00`, ...extra });
  const meta = (via = "manual", selected = ["b1", "b2", "b3"], extra = {}) => ({ id: `wcw_${WEEK}`, recordType: "week",
    weekStart: WEEK, cycleStartDate: CYCLE, committedAt: `${WEEK}T07:41:00`, committedVia: via, selectedBlockIds: selected,
    createdAt: `${WEEK}T07:41:00`, updatedAt: `${WEEK}T07:41:00`, deleted: false, ...extra });
  const item = (id, plannedDate, extra = {}) => ({ id: `wci_${WEEK}_${id}`, recordType: "item", weekStart: WEEK,
    blockId: id, taskId: "t1", projectId: "p1", trackId: "", title: `Snapshot ${id}`, plannedDate,
    source: "confirmed", lane: "cycle", excused: false, excusedReason: "", excusedChangedAt: "",
    completedAt: "", completedChangedAt: "", createdAt: `${WEEK}T07:41:00`, updatedAt: `${WEEK}T07:41:00`, deleted: false, ...extra });
  const base = () => ({ projects: [project()], tasks: [task()],
    blocks: [block("b1", WEEK, "LIVE title"), block("b2", "2026-08-23", "B2"), block("b3", "2026-08-24", "B3"),
      block("b4", "2026-08-25", "B4"), block("b5", "2026-08-26", "B5")], recurrences: [], tracks: [],
    weeklyCommitments: [meta(), item("b1", WEEK, { title: xss }), item("b2", "2026-08-23", { completedAt: "2026-08-23T08:00:00" }),
      item("b3", "2026-08-24", { excused: true, excusedReason: xss, excusedChangedAt: `${WEEK}T08:00:00` }),
      item("added-old", "2026-08-24", { source: "added" })] });
  async function seed(overrides = {}) {
    const fixture = { ...base(), ...overrides };
    await page.evaluate(({ key, today, cycle, fixture }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "wbs"; state.selectedDate = today; state.settings.twelveWeekStartDate = cycle;
      Object.assign(state, fixture); localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY, cycle: CYCLE, fixture });
    await page.reload(); await page.waitForSelector('button[data-action="twy-open-commit"]');
  }
  async function resetSaveProbe() {
    await page.evaluate((key) => {
      window.__v264OriginalSetItem ||= Storage.prototype.setItem;
      const original = window.__v264OriginalSetItem; window.__v264SaveCount = 0;
      window.__v264GenerateReportCalls = 0; window.__v264ExcuseCalls = 0;
      window.__v264UnexcuseCalls = 0; window.__v264AddCalls = 0;
      Storage.prototype.setItem = function(k, value) { if (k === key) window.__v264SaveCount += 1; return original.call(this, k, value); };
    }, STATE_KEY);
  }
  const saveCount = () => page.evaluate(() => window.__v264SaveCount || 0);
  const callCounts = () => page.evaluate(() => ({ generateReport: window.__v264GenerateReportCalls || 0,
    excuse: window.__v264ExcuseCalls || 0, unexcuse: window.__v264UnexcuseCalls || 0, add: window.__v264AddCalls || 0 }));
  const savedState = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  const openSheet = () => page.locator('.twy-commit-open[data-action="twy-open-commit"]').click();
  const row = (id) => page.locator(`[data-twy-commit-item][data-id="wci_${WEEK}_${id}"]`);
  try {
    await page.clock.setFixedTime(new Date(2026, 7, 25, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`); await passGithubGate(page); await seed(); await resetSaveProbe(); await openSheet();
    const sheetText = await page.locator(".twy-commit-sheet").textContent();
    check("C'はitemを平坦列挙しスナップショット・状態・追加ラベル・weeklyScoreを表示", await page.locator("[data-twy-commit-item]").count() === 4
      && sheetText.includes(xss) && !sheetText.includes("LIVE title") && sheetText.includes("✓ 完了")
      && sheetText.includes("免除中(タップで解除)") && sheetText.includes("確定後に追加")
      && sheetText.includes("確定済 2026-08-22 07:41")
      && sheetText.includes("完了 1 / 免除 1 / 分母 3 → 実行 33%"));
    const orderedIds = await page.locator("[data-twy-commit-item]").evaluateAll((rows) => rows.map((entry) => entry.dataset.id));
    check("C'はplannedDate昇順", orderedIds.indexOf(`wci_${WEEK}_b1`) < orderedIds.indexOf(`wci_${WEEK}_b2`)
      && orderedIds.indexOf(`wci_${WEEK}_b2`) < orderedIds.indexOf(`wci_${WEEK}_b3`), JSON.stringify(orderedIds));
    check("item.title/免除理由のXSSをescape", await page.locator("[data-v264-breach]").count() === 0
      && await page.evaluate(() => window.__v264Xss !== true));
    check("完了済みitemに免除導線が出ない", await row("b2").locator('[data-action="twy-excuse"]').count() === 0
      && await row("b2").locator(".c-done").count() === 1);
    check("免除/解除タップ標的はmin-height 44px", await row("b1").locator('[data-action="twy-excuse"]')
      .evaluate((el) => parseFloat(getComputedStyle(el).minHeight) >= 44));

    await row("b1").locator('[data-action="twy-excuse"]').click();
    check("#8 免除フォームをインライン展開・表示切替は保存0回", await page.locator("[data-twy-excuse-form]").count() === 1 && await saveCount() === 0);
    await page.locator("[data-twy-excuse-reason]").fill("   ");
    await page.locator('[data-action="twy-excuse-confirm"]').click();
    let saved = await savedState();
    check("#10 空白理由はtoast・フォーム維持・UI/データ層ともno-op", !saved.weeklyCommitments.find((entry) => entry.blockId === "b1").excused
      && await page.locator("[data-twy-excuse-form]").count() === 1 && (await page.locator("#toast").textContent()).includes("免除理由")
      && await saveCount() === 0 && (await callCounts()).excuse === 0);
    await page.locator('[data-action="twy-excuse-cancel"]').click();
    check("#11 cancelは変更・保存なしでフォームを閉じる", await page.locator("[data-twy-excuse-form]").count() === 0 && await saveCount() === 0);

    await row("b1").locator('[data-action="twy-excuse"]').click(); await page.locator("[data-twy-excuse-reason]").fill("  体調不良  ");
    await resetSaveProbe(); await page.locator('[data-action="twy-excuse-confirm"]').click(); saved = await savedState();
    let changed = saved.weeklyCommitments.find((entry) => entry.blockId === "b1").excusedChangedAt;
    check("#9 理由あり免除はtrim保存・表示更新・saveState計2回", saved.weeklyCommitments.find((entry) => entry.blockId === "b1").excused
      && saved.weeklyCommitments.find((entry) => entry.blockId === "b1").excusedReason === "体調不良"
      && await row("b1").locator('[data-action="twy-unexcuse"]').count() === 1 && await saveCount() === 2
      && (await callCounts()).generateReport === 0);

    await page.clock.setFixedTime(new Date(2026, 7, 25, 10, 1, 0)); await resetSaveProbe();
    await row("b1").locator('[data-action="twy-unexcuse"]').click(); saved = await savedState();
    const unexcusedAt = saved.weeklyCommitments.find((entry) => entry.blockId === "b1").excusedChangedAt;
    check("#12 解除は確認なし単タップ・理由消去・saveState計2回", !saved.weeklyCommitments.find((entry) => entry.blockId === "b1").excused
      && saved.weeklyCommitments.find((entry) => entry.blockId === "b1").excusedReason === "" && unexcusedAt !== changed && await saveCount() === 2
      && (await callCounts()).generateReport === 0);
    await page.clock.setFixedTime(new Date(2026, 7, 25, 10, 2, 0));
    await row("b1").locator('[data-action="twy-excuse"]').click(); await page.locator("[data-twy-excuse-reason]").fill("再免除");
    await page.locator('[data-action="twy-excuse-confirm"]').click(); saved = await savedState(); changed = saved.weeklyCommitments.find((entry) => entry.blockId === "b1").excusedChangedAt;
    check("免除→解除→再免除はexcusedChangedAtを毎回更新し最終操作を反映", changed !== unexcusedAt
      && saved.weeklyCommitments.find((entry) => entry.blockId === "b1").excusedReason === "再免除");

    await resetSaveProbe(); await page.locator('[data-action="twy-add-item"]').click();
    check("#13 計画追加は候補2件・既定全未選択・保存0回", await page.locator("[data-twy-add-panel]").count() === 1
      && await page.locator('[data-twy-add-panel] input[type="checkbox"]:checked').count() === 0
      && (await page.locator("[data-twy-add-count]").textContent()).includes("選択中 0コマ") && await saveCount() === 0);
    const addGroup = page.locator('[data-twy-add-panel] .twy-commit-row[data-twy-selection="add"]');
    const commitSelectionBeforeAdd = JSON.stringify((await page.evaluate(() => window.__v264SelectionProbe())).commit);
    check("#14 add展開前のキャレットは▸", (await addGroup.locator(".c-caret").textContent()).includes("▸"));
    await addGroup.locator(".c-caret").click();
    check("#14 add展開で▾・子行表示", (await addGroup.locator(".c-caret").textContent()).includes("▾")
      && await page.locator('[data-twy-add-panel] .twy-commit-sub[data-twy-selection="add"]').count() === 2);
    await addGroup.locator(".c-caret").click();
    check("#14 add折りたたみで▸・子行消去", (await addGroup.locator(".c-caret").textContent()).includes("▸")
      && await page.locator('[data-twy-add-panel] .twy-commit-sub[data-twy-selection="add"]').count() === 0);
    await addGroup.locator(".c-caret").click();
    await addGroup.locator('input[data-action="twy-commit-toggle-group"]').click();
    const addChildren = page.locator('[data-twy-add-panel] .twy-commit-sub[data-twy-selection="add"] input');
    await addChildren.first().click();
    check("#14 ctx=addの展開/group/blockが専用Set・親indeterminate・カウンタを更新し保存0回",
      await addChildren.count() === 2 && await addGroup.locator('input[data-action="twy-commit-toggle-group"]').evaluate((el) => !el.checked && el.indeterminate)
      && (await page.locator("[data-twy-add-count]").textContent()).includes("選択中 1コマ") && await saveCount() === 0
      && JSON.stringify((await page.evaluate(() => window.__v264SelectionProbe())).commit) === commitSelectionBeforeAdd);
    const itemCountBeforeAdd = (await savedState()).weeklyCommitments.filter((entry) => entry.recordType === "item").length;
    await resetSaveProbe(); await page.locator('[data-action="twy-add-item-confirm"]').click(); saved = await savedState();
    const added = saved.weeklyCommitments.find((entry) => entry.blockId === "b5");
    check("#15 選択あり追加はsource:added・パネル閉鎖・ラベル表示・saveState計2回", added?.source === "added"
      && await page.locator("[data-twy-add-panel]").count() === 0 && (await row("b5").textContent()).includes("確定後に追加")
      && !saved.weeklyCommitments.some((entry) => entry.blockId === "b4")
      && saved.weeklyCommitments.filter((entry) => entry.recordType === "item").length === itemCountBeforeAdd + 1
      && await saveCount() === 2 && (await callCounts()).generateReport === 0);

    await page.locator('[data-action="twy-add-item"]').click(); await resetSaveProbe();
    const beforeZero = JSON.stringify((await savedState()).weeklyCommitments);
    await page.locator('[data-action="twy-add-item-confirm"]').click();
    check("#16 選択0件confirmはadd no-call・保存0回・パネル維持", JSON.stringify((await savedState()).weeklyCommitments) === beforeZero
      && await saveCount() === 0 && (await callCounts()).add === 0 && await page.locator("[data-twy-add-panel]").count() === 1);
    await page.locator('[data-action="twy-add-item-cancel"]').click();
    check("#17 cancelは追加・保存なしでパネルを閉じる", JSON.stringify((await savedState()).weeklyCommitments) === beforeZero
      && await saveCount() === 0 && await page.locator("[data-twy-add-panel]").count() === 0);

    const allItems = [item("b1", WEEK), item("b2", "2026-08-23"), item("b3", "2026-08-24"), item("b4", "2026-08-25"), item("b5", "2026-08-26")];
    await seed({ weeklyCommitments: [meta("manual", ["b1", "b2", "b3", "b4", "b5"]), ...allItems] }); await openSheet();
    await page.locator('[data-action="twy-add-item"]').click();
    check("#18 候補0件は案内と閉じるだけ", (await page.locator("[data-twy-add-panel]").textContent()).includes("追加できる未コミット候補がありません")
      && await page.locator('[data-twy-add-panel] input').count() === 0 && await page.locator('[data-action="twy-add-item-confirm"]').count() === 0);

    const immutable = [
      item("past-e", "2026-08-15", { id: "wci_2026-08-15_past-e", weekStart: "2026-08-15" }),
      item("future-e", "2026-08-29", { id: "wci_2026-08-29_future-e", weekStart: "2026-08-29" }),
      item("past-u", "2026-08-15", { id: "wci_2026-08-15_past-u", weekStart: "2026-08-15", excused: true, excusedReason: "keep" }),
      item("future-u", "2026-08-29", { id: "wci_2026-08-29_future-u", weekStart: "2026-08-29", excused: true, excusedReason: "keep" })
    ];
    await seed({ weeklyCommitments: [...base().weeklyCommitments, ...immutable] }); await openSheet();
    for (const [label, action, id] of [
      ["過去週免除", "twy-excuse-confirm", "wci_2026-08-15_past-e"],
      ["未来週免除", "twy-excuse-confirm", "wci_2026-08-29_future-e"],
      ["過去週解除", "twy-unexcuse", "wci_2026-08-15_past-u"],
      ["未来週解除", "twy-unexcuse", "wci_2026-08-29_future-u"]
    ]) {
      const beforeState = JSON.stringify(await savedState());
      const currentBefore = JSON.stringify((await savedState()).weeklyCommitments.filter((entry) => entry.weekStart === WEEK));
      await resetSaveProbe();
      await page.evaluate(({ id, action }) => {
        const host = document.createElement("div");
        if (action === "twy-excuse-confirm") {
          host.className = "twy-excuse-form";
          host.innerHTML = `<input data-twy-excuse-reason value="blocked"><button data-action="${action}" data-id="${id}">x</button>`;
        } else host.innerHTML = `<button data-action="${action}" data-id="${id}">x</button>`;
        document.querySelector(".twy-commit-sheet").append(host); host.querySelector("button").click();
      }, { id, action });
      const counts = await callCounts();
      check(`#19 ${label}は全state/当週item不変・データ層/保存0回`, JSON.stringify(await savedState()) === beforeState
        && JSON.stringify((await savedState()).weeklyCommitments.filter((entry) => entry.weekStart === WEEK)) === currentBefore
        && await saveCount() === 0 && counts.excuse === 0 && counts.unexcuse === 0);
    }

    const outside = item("outside", "2026-08-27", { source: "auto" });
    await seed({ weeklyCommitments: [meta("manual", ["b1"]), item("b1", WEEK), outside] }); await openSheet();
    const outsideRow = page.locator(`[data-twy-commit-item][data-id="${outside.id}"]`);
    check("manual週のスコープ外itemは静的な対象外・スコープ内itemは免除導線", (await outsideRow.textContent()).includes("対象外")
      && await outsideRow.locator('[data-action="twy-excuse"]').count() === 0 && await row("b1").locator('[data-action="twy-excuse"]').count() === 1);

    const allExcused = [item("b1", WEEK, { excused: true, excusedReason: "a" }), item("b2", "2026-08-23", { excused: true, excusedReason: "b" })];
    await seed({ weeklyCommitments: [meta("manual", ["b1", "b2"]), ...allExcused] }); await openSheet();
    check("C'全件免除はN/A", (await page.locator(".twy-commit-count").textContent()).includes("N/A(全件免除)"));
    await seed({ weeklyCommitments: [meta("manual", [])] }); await openSheet();
    check("C' item0件は確定済みと今週は対象なしを矛盾なく表示", (await page.locator(".twy-commit-sheet").textContent()).includes("確定itemがありません")
      && (await page.locator(".twy-commit-count").textContent()).includes("今週は対象なし")
      && !(await page.locator(".twy-commit-count").textContent()).includes("未確定"));

    const evilIdItem = item("evil", WEEK, { id: idXss, blockId: "evil", source: "added", title: "safe" });
    await seed({ weeklyCommitments: [meta("manual", []), evilIdItem] }); await openSheet();
    check("C' item.id属性値XSSをescape", await page.locator("[data-v264-id-breach]").count() === 0
      && await page.evaluate(() => window.__v264IdXss !== true));

    const autoItem = item("b1", WEEK, { source: "auto" });
    await seed({ weeklyCommitments: [meta("auto", []), autoItem] }); await openSheet(); saved = await savedState();
    check("auto週メタでもC'を表示しmanual上書きしない", (await page.locator(".twy-commit-meta").textContent()).includes("確定済")
      && await page.locator('[data-action="twy-commit-week"]').count() === 0
      && saved.weeklyCommitments.find((entry) => entry.recordType === "week").committedVia === "auto");

    await seed({ weeklyCommitments: [] }); await openSheet();
    check("v263 pre-commit経路を維持", await page.locator('[data-action="twy-commit-week"]').count() === 1
      && await page.locator('[data-twy-commit-group]').count() === 1);
    await page.locator('[data-twy-commit-group] .c-caret').click();
    check("pre-commit見積表示spanにpointerが出ない", await page.locator('.twy-commit-sub .c-when').first()
      .evaluate((el) => getComputedStyle(el).cursor !== "pointer"));
    await page.locator('[data-action="modal-close"]').click();
    // v329: 行の副操作は…メニュー(排他)の中。閉じている時だけ開く(セレクタ追随・assert不変)
    const p1MenuOpen = await page.evaluate(() => {
      const panel = document.querySelector('[data-wbs-row-id="p1"] .wbs-row-menu-panel');
      return panel ? !panel.hidden : false;
    });
    if (!p1MenuOpen) {
      await page.click('[data-wbs-row-id="p1"] [data-action="wbs-row-menu-toggle"]');
      await page.waitForTimeout(150);
    }
    await page.locator('[data-action="edit-project"][data-id="p1"]').first().click();
    await page.locator('[data-modal-field="title"]').fill("Project saved"); await page.locator('[data-action="modal-save"]').click();
    check("既存projectモーダル保存に退行なし", (await savedState()).projects.find((entry) => entry.id === "p1").title === "Project saved");

    await seed(); await page.setViewportSize({ width: 390, height: 844 }); await openSheet();
    await row("b1").locator('[data-action="twy-excuse"]').click();
    check("390px C'に横スクロールなし・免除inputは16px", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
      && await page.locator("[data-twy-excuse-reason]").evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16));
  } catch (error) {
    failures++; console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close(); server.close();
  }
  console.log(failures === 0 ? "\nv264: 全件成功" : `\nv264: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
