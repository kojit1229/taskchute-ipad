// v261(裁定A-13で置換): 12週トラックの編集入口(更新・訂正・節目の完了/予定日変更)は、
// 作業一覧(nav wbs)にも12週計画タブ(nav twelveweek)にも無い。表示(見出し・GOALSの読み取り表示)は残す。
const path = require("path");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}
const EDIT_ENTRANCES = ['[data-action="twy-open-editor"]', '[data-action="twy-close-editor"]',
  '[data-action="twy-save-measurement"]', '[data-action="twy-ms-toggle-done"]', '[data-action="twy-ms-edit-date"]',
  ".twy-editor", ".twy-track-editor", ".twy-correct", ".twy-ms-edit-item", "[data-twy-editor-value]"].join(",");

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1024, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);
  const TODAY = "2026-08-24", CYCLE = "2026-08-15", NOW = `${TODAY}T10:00:00`, INITIAL = `${CYCLE}T00:00:00`;
  const project = (id) => ({ id, kind: "normal", title: id, status: "active", priority: "中", category: "",
    startDate: CYCLE, dueDate: "", description: "", twelveWeekStartDate: CYCLE, showProgress: false,
    collapsed: false, createdAt: INITIAL, updatedAt: INITIAL, deleted: false });
  const numericTrack = (id, ownerId, extra = {}) => ({ id, ownerType: "project", ownerId, cycleStartDate: CYCLE,
    kind: "numeric", name: id, unit: "u", startDate: "2026-08-14", deadline: "2026-09-03", baselineValue: 0,
    goalValue: 20, valueStep: 1, milestones: [], status: "active", closedAt: "", closedReason: "",
    supersedesTrackId: "", carriedFromTrackId: "", createdAt: INITIAL, updatedAt: INITIAL, deleted: false, ...extra });
  const ms = (id, label, plannedDate, extra = {}) => ({ id, label, plannedDate, originalPlannedDate: plannedDate,
    doneAt: "", doneChangedAt: "", updatedAt: INITIAL, deleted: false, ...extra });
  const measurement = (id, trackId, value) => ({ id, trackId, value, observedAt: NOW, sourceKind: "wbs",
    blockId: "", note: "", createdAt: NOW, updatedAt: NOW, deleted: false });
  async function go(view) {
    await page.evaluate(({ key, view }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = view;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, view });
    await page.reload();
    await page.waitForSelector("main");
    if (view === "twelveweek") {
      await page.waitForSelector(".twy-cycle-fold", { state: "attached" });
      if (!await page.locator(".twy-cycle-fold").evaluate((el) => el.open)) await page.locator(".twy-cycle-fold > summary").click();
      await page.waitForSelector(".twy-goals-panel", { state: "visible" });
    } else {
      await page.waitForSelector('[data-work-group="p-num"]');
    }
  }
  try {
    await page.clock.setFixedTime(new Date(2026, 7, 24, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.evaluate(({ key, today, cycle, projects, tracks, measurements }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.selectedDate = today; state.settings.twelveWeekStartDate = cycle;
      state.settings.showSuspended = true; state.settings.wbsHideCompleted = false;
      state.projects = projects; state.tasks = [{ id: "task-1", projectId: "p-num", parentTaskId: "",
        title: "既存WBS操作", status: "todo", progressNum: 0, progressDen: 10, deleted: false }];
      state.blocks = []; state.recurrences = []; state.tracks = tracks; state.trackMeasurements = measurements;
      state.reports = {};
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY, cycle: CYCLE, projects: [project("p-num"), project("p-done"), project("p-ms")],
      tracks: [numericTrack("n-open", "p-num"), numericTrack("n-done", "p-done", { goalValue: 10 }),
        numericTrack("m-track", "p-ms", { kind: "milestone", unit: "", deadline: "", goalValue: 0,
          milestones: [ms("ms-b", "後の節目", "2026-09-10"), ms("ms-a", "先の節目", "2026-08-30")] })],
      measurements: [measurement("trm-open", "n-open", 5), measurement("trm-done", "n-done", 10)] });

    console.log("[1] 作業一覧(nav wbs): 編集入口が無く、見出しの表示は残る");
    await go("wbs");
    const before = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    check("A-13 作業一覧に更新・訂正・節目編集の入口が無い", await page.locator(EDIT_ENTRANCES).count() === 0);
    const summary = await page.locator('[data-work-group="p-num"] > summary').textContent();
    check("見出しに「12週計画 第N週」が出る", /12週計画 第[0-9]+週/.test(summary), summary);

    console.log("[2] 12週計画タブ(nav twelveweek): 編集入口が無く、GOALSは読み取り表示");
    await go("twelveweek");
    check("A-13 12週計画タブに更新・訂正・節目編集の入口が無い", await page.locator(EDIT_ENTRANCES).count() === 0);
    for (const id of ["n-open", "n-done", "m-track"]) {
      check(`GOALSに ${id} の目標・進捗が読み取り表示される`,
        await page.locator(`.twy-goals-panel .twy-row[data-twy-track-id="${id}"]`).count() === 1);
    }
    check("GOALSの行は読み取り専用(input/select/編集ボタンなし)", await page.locator(
      ".twy-goals-panel .twy-row input, .twy-goals-panel .twy-row select, .twy-goals-panel .twy-row button").count() === 0);
    await page.setViewportSize({ width: 390, height: 844 });
    check("390pxでも外側横スクロールを作らない", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const after = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    check("表示だけでは保存状態が変わらない(トラック・測定値)", JSON.stringify(JSON.parse(after).tracks) === JSON.stringify(JSON.parse(before).tracks)
      && JSON.stringify(JSON.parse(after).trackMeasurements) === JSON.stringify(JSON.parse(before).trackMeasurements));
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(failures === 0 ? "\nv261: 全件成功" : `\nv261: ${failures}件失敗`);
  if (failures) process.exit(1);
})().catch((error) => { console.error(error); process.exit(1); });
