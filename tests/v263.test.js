// v263: 12WY週次コミット確定シート(a)のB-9 #1〜#7/#20、負例、保存、既存モーダル回帰。
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
const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
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
  const ends = [nextAction, nextComment].filter((value) => value > start);
  return appSource.slice(start, Math.min(...ends));
}
function actionHandler(name, sandbox) {
  const source = actionSource(name).trim().replace(/,$/, "");
  return vm.runInContext(`({${source}})[${JSON.stringify(name)}]`, sandbox);
}
const instrumentedAppSource = appSource.replace(
  "function generateReport(dateArg, { quiet = false } = {}) {",
  "function generateReport(dateArg, { quiet = false } = {}) { window.__v263GenerateReportCalls = (window.__v263GenerateReportCalls || 0) + 1;"
);

console.log("[1] action契約・#4データ層負例");
for (const action of ["twy-commit-toggle-group", "twy-commit-toggle-block", "twy-commit-expand"]) {
  const source = actionSource(action);
  check(`${action}はsaveState/renderModalを呼ばない`, !/saveState|saveAndRender|renderModal/.test(source));
}
const commitAction = actionSource("twy-commit-week");
check("確定はsaveAndRender→renderModal", /saveAndRender/.test(commitAction)
  && /renderModal/.test(commitAction));
check("CSS.escape標準API・project.title裁定・日付文字列parse禁止を固定",
  appSource.includes("CSS.escape(taskId)") && appSource.includes("group.project?.title || \"\"")
  && !/new Date\s*\(\s*["'`]/.test(appSource.slice(appSource.indexOf("function openTwyCommitSheet"), appSource.indexOf("function openProjectEditor"))));
check("v263 CSSとService Worker更新", cssSource.includes(".twy-commit-sheet")
  && /\.modal-title span\s*\{[^}]*font-size:\s*\.8em;[^}]*color:\s*var\(--muted\)/s.test(cssSource)
  && !/\.twy-commit-open\s*\{[^}]*font-size:/s.test(cssSource)
  && swSource.includes('CACHE_NAME = "taskchute-journal-pwa-v264"'));
for (const action of ["twy-commit-toggle-group", "twy-commit-toggle-block"]) {
  const source = actionSource(action);
  check(`${action}は欠落groupガードをSet変更前に置きcheckedを戻す`, source.indexOf("if (!group)") < source.indexOf("selection.add")
    && source.includes("target.checked = !target.checked"));
}
const caretHelper = appSource.slice(appSource.indexOf("function twyCommitUpdateCaret"), appSource.indexOf("function openProjectEditor"));
const footerHelper = appSource.slice(appSource.indexOf("function twyCommitRefreshFooter"), appSource.indexOf("function twyCommitUpdateCaret"));
check("トグル時の候補フルスキャンは1回以下", !caretHelper.includes("twyCommitGroupByTaskId")
  && !footerHelper.includes("candidateBlocksForWeek"));

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
sandbox.maybeShowTrackProgressToast = () => {};
sandbox.saveState = () => { sandbox.saveCount += 1; };
vm.createContext(sandbox);
vm.runInContext(appSource.slice(coreStart, coreEnd), sandbox);
function coreState(blockDate) {
  return { settings: { twelveWeekStartDate: CYCLE }, projects: [{ id: "p", kind: "normal", status: "active", deleted: false }],
    tasks: [{ id: "t", projectId: "p", status: "todo", deleted: false }],
    blocks: [{ id: "candidate", taskId: "t", date: blockDate, title: "C", deleted: false }], tracks: [], weeklyCommitments: [] };
}
sandbox.state = coreState(WEEK); sandbox.commitWeek(WEEK, ["candidate", "outside"]);
let meta = sandbox.state.weeklyCommitments.find((record) => record.recordType === "week");
check("候補外blockIdはcommitWeekで除外", JSON.stringify(meta?.selectedBlockIds) === '["candidate"]'
  && !sandbox.state.weeklyCommitments.some((record) => record.blockId === "outside"));
for (const [label, week] of [["過去週", "2026-08-15"], ["未来週", "2026-08-29"]]) {
  sandbox.state = coreState(week); sandbox.saveCount = 0; sandbox.commitWeek(week, ["candidate"]);
  check(`${label}確定はno-op`, sandbox.state.weeklyCommitments.length === 0 && sandbox.saveCount === 0);
}

const commitHandler = actionHandler("twy-commit-week", sandbox);
const existingMeta = { id: `wcw_${WEEK}`, recordType: "week", weekStart: WEEK, committedVia: "auto", deleted: false };
const existingItem = { id: `wci_${WEEK}_candidate`, recordType: "item", weekStart: WEEK, blockId: "candidate", deleted: false };
sandbox.state = { ...coreState(WEEK), modal: { type: "twyCommit", id: WEEK }, weeklyCommitments: [existingMeta, existingItem] };
sandbox._twyCommitSelectedBlockIds = new Set(["candidate"]);
sandbox.twyCommittedWeekMeta = (weekStart) => sandbox.state.weeklyCommitments.find((record) =>
  record.id === `wcw_${weekStart}` && record.recordType === "week" && !record.deleted);
let commitCalls = 0, saveAndRenderCalls = 0, openedWeek = "", renderedWeek = "", toastMessage = "";
sandbox.commitWeek = () => { commitCalls += 1; };
sandbox.saveAndRender = () => { saveAndRenderCalls += 1; };
sandbox.buildTwyCommitSheetHTML = (weekStart) => weekStart;
sandbox.renderModal = (weekStart) => { renderedWeek = weekStart; };
sandbox.showToast = (message) => { toastMessage = message; };
sandbox.openTwyCommitSheet = () => { openedWeek = sandbox.weekRange(sandbox.todayISO()).weekStart;
  sandbox.state.modal = { type: "twyCommit", id: openedWeek }; };
const committedBefore = JSON.stringify(sandbox.state.weeklyCommitments);
commitHandler();
check("送信直前に生きた週メタを再確認し上書き・manual化しない", commitCalls === 0 && saveAndRenderCalls === 0
  && JSON.stringify(sandbox.state.weeklyCommitments) === committedBefore && existingMeta.committedVia === "auto"
  && sandbox.state.weeklyCommitments.includes(existingItem) && renderedWeek === WEEK
  && toastMessage.includes("他端末で確定済み"));

sandbox.state = { ...coreState("2026-08-15"), modal: { type: "twyCommit", id: "2026-08-15" } };
commitCalls = 0; saveAndRenderCalls = 0; openedWeek = ""; renderedWeek = ""; toastMessage = "";
const commitmentsBeforeRollover = JSON.stringify(sandbox.state.weeklyCommitments);
commitHandler();
check("週跨ぎ送信はデータ不変・偽成功なしで当週シートへ開き直す", commitCalls === 0 && saveAndRenderCalls === 0
  && JSON.stringify(sandbox.state.weeklyCommitments) === commitmentsBeforeRollover && openedWeek === WEEK
  && sandbox.state.modal.id === WEEK && toastMessage.includes("週が変わった") && !toastMessage.includes("確定しました"));

(async () => {
  console.log("[2] B-9 #1〜#7/#20・保存回数・C'追従・既存モーダル回帰");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1024, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await page.route("**/app.js", (route) => route.fulfill({
    status: 200, contentType: "text/javascript; charset=utf-8", body: instrumentedAppSource
  }));
  await blockGithubApiByDefault(page);
  const xss = '\"><img src=x onerror="window.__v263Xss=true"><span data-v263-breach="';
  const project = (id, title, extra = {}) => ({ id, kind: "normal", title, status: "active", priority: "中",
    category: "", startDate: CYCLE, dueDate: "", description: "", twelveWeekStartDate: CYCLE,
    showProgress: false, collapsed: false, createdAt: `${CYCLE}T00:00:00`, updatedAt: `${CYCLE}T00:00:00`, deleted: false, ...extra });
  const task = (id, projectId, title, extra = {}) => ({ id, projectId, parentTaskId: "", title, category: "",
    status: "todo", dueDate: "", description: "", progressNum: 0, progressDen: 10,
    createdAt: `${CYCLE}T00:00:00`, updatedAt: `${CYCLE}T00:00:00`, deleted: false, ...extra });
  const block = (id, taskId, date, title, extra = {}) => ({ id, taskId, date, title, category: "",
    plannedStartAt: `${date}T07:00:00`, plannedEndAt: `${date}T07:25:00`, estimateMin: 25,
    completed: false, deleted: false, migratedTo: "", createdAt: `${date}T00:00:00`, updatedAt: `${date}T00:00:00`, ...extra });
  const track = { id: "trk-xss", ownerType: "project", ownerId: "p2", cycleStartDate: CYCLE,
    kind: "numeric", name: xss, unit: "<u>", baselineValue: 0, goalValue: 10, valueStep: 1,
    status: "active", createdAt: `${CYCLE}T00:00:00`, updatedAt: `${CYCLE}T00:00:00`, deleted: false };
  const base = () => ({
    projects: [project("p1", "Project 1"), project("p2", xss)],
    tasks: [task("t1", "p1", "Task grouped"), task('t"2', "p2", xss)],
    blocks: [block("b1", "t1", WEEK, "B1", { recurrenceGroupId: "r1" }),
      block("b2", "t1", "2026-08-24", "B2", { recurrenceGroupId: "r1" }), block('b"3', 't"2', "2026-08-26", "B3")],
    tracks: [track], recurrences: [{ id: "r1", taskId: "t1", kind: "weekdays", anchor: "skip-maintenance", deleted: false }],
    weeklyCommitments: []
  });
  async function seed(overrides = {}, cycleStart = CYCLE) {
    const fixture = { ...base(), ...overrides };
    await page.evaluate(({ key, today, cycleStart, fixture }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "wbs"; state.selectedDate = today; state.settings.twelveWeekStartDate = cycleStart;
      Object.assign(state, fixture); localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY, cycleStart, fixture });
    await page.reload(); await page.waitForSelector('[data-action="toggle-wbs-edit"]');
    if (cycleStart) await page.waitForSelector('button[data-action="twy-open-commit"]');
  }
  async function resetSaveProbe() {
    await page.evaluate((key) => {
      window.__v263OriginalSetItem ||= Storage.prototype.setItem;
      const original = window.__v263OriginalSetItem; window.__v263SaveCount = 0;
      window.__v263GenerateReportCalls = 0;
      Storage.prototype.setItem = function(k, value) { if (k === key) window.__v263SaveCount += 1; return original.call(this, k, value); };
    }, STATE_KEY);
  }
  const saveCount = () => page.evaluate(() => window.__v263SaveCount || 0);
  const generateReportCount = () => page.evaluate(() => window.__v263GenerateReportCalls || 0);
  const openSheet = () => page.locator('.twy-commit-open[data-action="twy-open-commit"]').click();
  const group = (taskId) => page.locator(`.twy-commit-row[data-twy-task-id="${taskId.replaceAll('"', '\\"')}"]`);
  try {
    await page.clock.setFixedTime(new Date(2026, 7, 25, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`); await passGithubGate(page); await seed({}, "");
    check("12WY未設定ならWBS入口を表示しない", await page.locator('[data-action="twy-open-commit"]').count() === 0);
    await seed();

    await resetSaveProbe(); await openSheet();
    check("#1 WBS入口から当週pre-commitを開き既定全チェック", await page.locator(".twy-commit-row").count() === 2
      && await page.locator('.twy-commit-row input[type="checkbox"]:checked').count() === 2
      && (await page.locator("[data-twy-commit-count]").textContent()).includes("選択中 3コマ"));
    check("集約・recurrence・単発Block×1・時刻表示", (await group("t1").textContent()).includes("平日のみ")
      && (await page.locator(".twy-commit-row").nth(1).textContent()).includes("単発Block×1"));
    const escaped = await page.evaluate(() => ({ breached: document.querySelectorAll("[data-v263-breach]").length,
      ran: window.__v263Xss === true, ids: [...document.querySelectorAll("[data-twy-task-id]")].map((el) => el.dataset.twyTaskId) }));
    check("task/project/track/unit/taskId/blockIdをescapeHTML", escaped.breached === 0 && !escaped.ran
      && escaped.ids.includes('t"2') && (await page.locator(".twy-commit-sheet").textContent()).includes(xss), JSON.stringify(escaped));
    check("track注記はtrack名(単位)形式", (await page.locator(".twy-commit-sheet").textContent()).includes(`${xss}(<u>)`));

    const caret = group("t1").locator(".c-caret");
    await caret.click();
    check("#5 展開で子2行をDOM挿入し▾へ", await page.locator('.twy-commit-sub[data-twy-task-id="t1"]').count() === 2
      && (await caret.textContent()).includes("▾"));
    const parent = group("t1").locator('input[data-action="twy-commit-toggle-group"]');
    await parent.click();
    check("#3 集約OFFで配下全解除・カウンタ更新", await page.locator('.twy-commit-sub[data-twy-task-id="t1"] input:checked').count() === 0
      && (await page.locator("[data-twy-commit-count]").textContent()).includes("選択中 1コマ")
      && (await caret.textContent()).startsWith("0/2"));
    await parent.click();
    const child = page.locator('.twy-commit-sub[data-twy-task-id="t1"] input').first();
    await child.click();
    check("#4 Block個別OFFで親indeterminate・カウンタ同期", await parent.evaluate((el) => !el.checked && el.indeterminate)
      && (await page.locator("[data-twy-commit-count]").textContent()).includes("選択中 2コマ"));
    await child.click();
    check("Block再ONで親checked・indeterminate解除", await parent.evaluate((el) => el.checked && !el.indeterminate));
    await caret.click();
    check("#5 再展開で子行削除・▸へ", await page.locator('.twy-commit-sub[data-twy-task-id="t1"]').count() === 0
      && (await caret.textContent()).includes("▸"));
    check("E-3 トグル/展開はsaveState 0回", await saveCount() === 0);

    await parent.click();
    await page.locator('[data-action="modal-close"]').click();
    check("#20 ×で閉じる", await page.locator("#modalRoot.open").count() === 0);
    await openSheet();
    check("#20 再openで選択を全件初期化", (await page.locator("[data-twy-commit-count]").textContent()).includes("選択中 3コマ"));
    await page.evaluate(() => document.querySelector("#modalRoot").click());
    check("#20 背景タップでも閉じる", await page.locator("#modalRoot.open").count() === 0 && await saveCount() === 0);

    await openSheet();
    const beforeRollover = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).weeklyCommitments, STATE_KEY);
    await page.clock.setFixedTime(new Date(2026, 7, 31, 10, 0, 0));
    await page.locator('[data-action="twy-commit-week"]').click();
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("週が変わった"));
    const rolloverToast = await page.locator("#toast").textContent();
    check("週跨ぎは偽成功なし・保存なし・当週シートへ遷移", JSON.stringify(await page.evaluate((key) =>
      JSON.parse(localStorage.getItem(key)).weeklyCommitments, STATE_KEY)) === JSON.stringify(beforeRollover)
      && !rolloverToast.includes("確定しました") && (await page.locator(".modal-title").textContent()).includes("08/29"));
    await page.clock.setFixedTime(new Date(2026, 7, 25, 10, 0, 0)); await seed();

    await openSheet(); await group("t1").locator(".c-caret").click();
    await page.locator('.twy-commit-sub[data-twy-task-id="t1"] input').first().click();
    await page.evaluate(() => {
      const fake = document.createElement("input"); fake.type = "checkbox"; fake.dataset.action = "twy-commit-toggle-block";
      fake.dataset.twyBlockId = "outside"; fake.dataset.twyTaskId = "t1"; fake.dataset.twySelection = "commit";
      document.querySelector(".twy-commit-sheet").append(fake); fake.click();
    });
    await resetSaveProbe(); await page.locator('[data-action="twy-commit-week"]').click();
    await page.waitForSelector(".twy-commit-meta");
    let saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    meta = saved.weeklyCommitments.find((record) => record.recordType === "week");
    const items = saved.weeklyCommitments.filter((record) => record.recordType === "item");
    check("#6 選択1件以上でmanual確定・selectedBlockIds一致・source confirmed", meta?.committedVia === "manual"
      && JSON.stringify(meta.selectedBlockIds) === '["b2","b\\"3"]' && items.length === 2
      && items.every((item) => item.source === "confirmed") && !items.some((item) => item.blockId === "outside"), JSON.stringify({ meta, items }));
    check("確定はsaveState計2回・generateReport呼び出し0回", await saveCount() === 2 && await generateReportCount() === 0);
    check("確定後はrenderModalでC'へ切替", (await page.locator(".twy-commit-meta").textContent()).includes("確定済")
      && await page.locator('[data-twy-commit-item]').count() === 2
      && await page.locator('[data-action="twy-commit-week"]').count() === 0);
    check("saveAndRender後もWBS表示・入口に退行なし", await page.locator('.twy-commit-open[data-action="twy-open-commit"]').count() === 1);

    await seed(); await openSheet();
    for (const checkbox of await page.locator('.twy-commit-row input[data-action="twy-commit-toggle-group"]').all()) await checkbox.click();
    await resetSaveProbe(); await page.locator('[data-action="twy-commit-week"]').click();
    saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    meta = saved.weeklyCommitments.find((record) => record.recordType === "week");
    check("#7 選択0件でもmanual確定", meta?.committedVia === "manual" && meta.selectedBlockIds.length === 0
      && saved.weeklyCommitments.filter((record) => record.recordType === "item").length === 0 && await saveCount() === 2);

    await seed({ blocks: [], recurrences: [] }); await openSheet();
    check("#2 候補0件は案内のみ・確定ボタンなし", (await page.locator(".twy-commit-meta").textContent()).includes("候補Blockがありません")
      && await page.locator('[data-action="twy-commit-week"]').count() === 0);

    const autoMeta = { id: `wcw_${WEEK}`, recordType: "week", weekStart: WEEK, cycleStartDate: CYCLE,
      committedAt: `${WEEK}T07:00:00`, committedVia: "auto", selectedBlockIds: [],
      createdAt: `${WEEK}T07:00:00`, updatedAt: `${WEEK}T07:00:00`, deleted: false };
    await seed({ weeklyCommitments: [autoMeta] }); await openSheet();
    check("auto週メタ既存時もC'表示", (await page.locator(".twy-commit-meta").first().textContent()).includes("確定済")
      && await page.locator(".twy-commit-row").count() === 0);

    await seed();
    await page.locator('[data-action="edit-project"][data-id="p1"]').first().click();
    await page.locator('[data-modal-field="title"]').fill("Project saved"); await page.locator('[data-action="modal-save"]').click();
    saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    check("既存projectモーダル開閉保存に退行なし", saved.projects.find((entry) => entry.id === "p1")?.title === "Project saved");
    await page.locator('[data-action="edit-task"][data-id="t1"]').first().click();
    await page.locator('[data-modal-field="title"]').fill("Task saved"); await page.locator('[data-action="modal-save"]').click();
    saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    check("既存taskモーダル開閉保存に退行なし", saved.tasks.find((entry) => entry.id === "t1")?.title === "Task saved");
    await page.evaluate(() => { const button = document.createElement("button"); button.dataset.action = "edit-block";
      button.dataset.id = "b1"; document.body.append(button); button.click(); button.remove(); });
    await page.locator('[data-modal-field="title"]').fill("Block saved"); await page.locator('[data-action="modal-save"]').click();
    saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    check("既存blockモーダル開閉保存に退行なし", saved.blocks.find((entry) => entry.id === "b1")?.title === "Block saved");

    await page.setViewportSize({ width: 390, height: 844 }); await openSheet();
    check("390pxでWBS/確定シートに横スクロールなし", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  } catch (error) {
    failures++; console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close(); server.close();
  }

  console.log(failures === 0 ? "\nv263: 全件成功" : `\nv263: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
