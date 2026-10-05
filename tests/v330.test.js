// v330 / A-3: Projectチップ・Project箱・表示切替の回帰。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-02";
let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}
function project(id, title, extra = {}) {
  return { id, kind: "normal", title, category: "仕事", status: "active", priority: "中",
    description: "", dueDate: "", twelveWeekStartDate: "", showProgress: false, collapsed: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, deleted: false, ...extra };
}
function task(id, projectId, title, extra = {}) {
  return { id, projectId, parentTaskId: "", title, category: "仕事", status: "todo",
    dueDate: "", selfDueOff: true, description: "", progressNum: 0, progressDen: 10, collapsed: false,
    criteriaRequest: false, planTarget: false, owner: "k", order: null,
    createdAt: `${TODAY}T09:00:00`, updatedAt: `${TODAY}T09:00:00`, deleted: false, ...extra };
}
function commitmentWeek(weekStart, ids) {
  return { id: `wcw_${weekStart}`, recordType: "week", weekStart, cycleStartDate: "2026-08-15",
    committedAt: `${TODAY}T07:00:00`, committedVia: "manual", selectedBlockIds: ids,
    createdAt: `${TODAY}T07:00:00`, updatedAt: `${TODAY}T07:00:00`, deleted: false };
}
function commitmentItem(weekStart, blockId, taskId, projectId, plannedDate, completed = false) {
  return { id: `wci_${weekStart}_${blockId}`, recordType: "item", weekStart, blockId, taskId, projectId,
    trackId: "track-cycle", title: taskId, plannedDate, source: "confirmed", lane: "cycle",
    excused: false, excusedReason: "", excusedChangedAt: "", completedAt: completed ? `${plannedDate}T10:00:00` : "",
    completedChangedAt: completed ? `${plannedDate}T10:00:00` : "", createdAt: `${TODAY}T07:00:00`,
    updatedAt: `${TODAY}T07:00:00`, deleted: false };
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 }, timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);
  try {
    await page.clock.setFixedTime(new Date(2026, 8, 2, 10, 0, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    // v330修正(レビュー対応): fixtureの先頭を非12WY Projectにして、既定選択が
    // 配列順ではなく12WY優先ロジック(renderWbsDesktopProjects)で決まることを検証する。
    // "!Alpha 先行 Project" は localeCompare("ja") で "12WY Project" より前に来る(確認済み)。
    const other = project("p-other", "!Alpha 先行 Project");
    const cycle = project("p-cycle", "12WY Project", { twelveWeekStartDate: "2026-08-15" });
    const wish = project("p-wish", "Wish", { kind: "wish" });
    const parent = task("t-parent", cycle.id, "今週の実行計画", { planTarget: true });
    const stepOpen = task("t-step-open", cycle.id, "確定 Step 未完了", { parentTaskId: parent.id, order: 1000 });
    const stepDone = task("t-step-done", cycle.id, "確定 Step 完了", { parentTaskId: parent.id, order: 2000,
      status: "completed", progressNum: 10 });
    const nextStep = task("t-next-step", cycle.id, "来週 Step", { parentTaskId: parent.id, order: 3000 });
    const currentDue = task("t-current-due", cycle.id, "今週期限・超過", { dueDate: "2026-09-01", progressNum: 2 });
    const nextDue = task("t-next-due", cycle.id, "来週期限", { dueDate: "2026-09-08" });
    const otherDue = task("t-other-due", other.id, "他Project今週期限", { dueDate: "2026-09-04" });
    const wishDue = task("t-wish-due", wish.id, "Wish今週期限", { dueDate: "2026-09-03" });
    // 「確定Stepかつ今週期限」の重複が1行に畳まれることを検証する専用タスク。
    const dupTask = task("t-dup", cycle.id, "確定+今週期限の重複", { dueDate: "2026-09-03" });
    // 中断中でも期限が今週なら母集団に入ることを検証する。
    const suspendedDue = task("t-suspended-due", other.id, "中断中・今週期限", { dueDate: "2026-09-05", status: "suspended" });
    // 週境界: 月曜(2026-08-31, 今週最初)〜日曜(2026-09-06, 今週最後)。前週日曜(08-30)・
    // 翌週月曜(09-07)は入らない。
    const boundaryPrevSun = task("t-boundary-prev-sun", other.id, "境界: 前週日曜", { dueDate: "2026-08-30" });
    const boundaryThisMon = task("t-boundary-this-mon", other.id, "境界: 今週月曜", { dueDate: "2026-08-31" });
    const boundaryThisSun = task("t-boundary-this-sun", other.id, "境界: 今週日曜", { dueDate: "2026-09-06" });
    const boundaryNextMon = task("t-boundary-next-mon", other.id, "境界: 来週月曜", { dueDate: "2026-09-07" });
    const projects = [other, cycle, wish];
    const tasks = [parent, stepOpen, stepDone, nextStep, currentDue, nextDue, otherDue, wishDue, dupTask,
      suspendedDue, boundaryPrevSun, boundaryThisMon, boundaryThisSun, boundaryNextMon];
    const currentIds = ["b-step-open", "b-step-done", "b-dup"];
    const nextIds = ["b-next-step"];
    const weeklyCommitments = [
      commitmentWeek("2026-08-29", currentIds),
      commitmentItem("2026-08-29", currentIds[0], stepOpen.id, cycle.id, "2026-09-02"),
      commitmentItem("2026-08-29", currentIds[1], stepDone.id, cycle.id, "2026-09-03", true),
      commitmentItem("2026-08-29", currentIds[2], dupTask.id, cycle.id, "2026-09-03"),
      commitmentWeek("2026-09-05", nextIds),
      commitmentItem("2026-09-05", nextIds[0], nextStep.id, cycle.id, "2026-09-08")
    ];
    await page.evaluate(({ key, projects, tasks, weeklyCommitments, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      Object.assign(state, { projects, tasks, weeklyCommitments, blocks: [], tracks: [], trackMeasurements: [],
        currentView: "wbs", selectedDate: today });
      Object.assign(state.settings, { twelveWeekStartDate: "2026-08-15", showSuspended: true,
        wbsHideCompleted: false, wbsHideDoneProjects: false, wbsCompactMode: false,
        wbsCategoryFilter: "", wbsEditMode: false });
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, projects, tasks, weeklyCommitments, today: TODAY });
    await page.reload();
    await page.waitForSelector('[data-work-list="wbs"]');
    check("週パネルは作業一覧に表示しない", await page.locator('.wbs-week-panel').count() === 0);

    console.log("[3] A-3: Project chips and boxes, non-persistent selection");
    const root = page.locator('[data-work-list="wbs"]');
    const chip = id => root.locator(`[data-kind="project"][data-value="${id}"]`);
    const box = id => root.locator(`[data-work-group="${id}"]`);
    check("既定はすべてのProject", await chip('').getAttribute('aria-pressed') === 'true'
      && await box('p-other').isVisible() && await box('p-cycle').isVisible());
    check("12週計画情報をProject箱に表示", (await box('p-cycle').locator('summary').textContent()).includes('12週計画 第3週'));
    const stableValue = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await page.evaluate((key) => {
      window.__v330StateWrites = 0;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItemSpy(name, value) {
        if (this === localStorage && name === key && localStorage.getItem(name) !== value) window.__v330StateWrites += 1;
        return original.call(this, name, value);
      };
    }, STATE_KEY);
    await chip('p-other').click();
    check("チップ選択で該当Project箱だけ残る", await box('p-other').isVisible() && await box('p-cycle').count() === 0);
    for (const width of [1279, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      check(`${width}pxでも選択・題名検索・Projectチップを保持`, await chip('p-other').getAttribute('aria-pressed') === 'true'
        && await box('p-other').isVisible() && await root.locator('[data-work-filter="query"]').isVisible()
        && await root.locator('[data-kind="project"]').count() === await page.evaluate(key => JSON.parse(localStorage.getItem(key)).projects.filter(p => !p.deleted).length + 1, STATE_KEY));
      check(`${width}pxで操作列と一覧が重ならない`, await root.evaluate(el => {
        const a = el.querySelector('.work-decide-sidebar').getBoundingClientRect(), b = el.querySelector('.work-decide-groups').getBoundingClientRect();
        return b.left >= a.right || b.top >= a.bottom;
      }));
    }
    check("選択・ビューポート切替を通じstate/localStorageの内容が変わらない",
      await page.evaluate((key) => localStorage.getItem(key), STATE_KEY) === stableValue
        && await page.evaluate(() => window.__v330StateWrites) === 0);
    console.log("[5] A-3: 中断Projectは表示設定に従う");
    // The old pane is gone; retain the existing delegated action's persistence contract.
    const projectAction = action => page.evaluate(action => {
      const button = document.createElement('button'); button.dataset.action = action; button.dataset.id = 'p-other';
      document.body.append(button); button.click(); button.remove();
    }, action);
    await projectAction('suspend-project');
    check("既存中断actionがProject状態を保存", await page.evaluate(key => JSON.parse(localStorage.getItem(key)).projects.find(p => p.id === 'p-other').status, STATE_KEY) === 'paused');
    const suspended = root.locator('[data-action="toggle-show-suspended"]');
    check("中断表示ONで中断Projectの行が見える", await root.locator('[data-work-key="task:t-other-due"]').count() === 1);
    await suspended.evaluate(el => el.closest('details').open = true); await suspended.click();
    check("中断表示OFFで行が消える", await root.locator('[data-work-key="task:t-other-due"]').count() === 0);
    await suspended.evaluate(el => el.closest('details').open = true); await suspended.click();
    check("中断表示ONで行が戻る", await root.locator('[data-work-key="task:t-other-due"]').count() === 1);
    await projectAction('resume-project');
    check("既存再開actionがProject状態を保存", await page.evaluate(key => JSON.parse(localStorage.getItem(key)).projects.find(p => p.id === 'p-other').status, STATE_KEY) === 'active');


    console.log("[8] レスポンシブ品質");
    async function noOverflow(width) {
      await page.setViewportSize({ width, height: 900 });
      return page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    }
    check("390px/1280pxで横スクロールなし", await noOverflow(390) && await noOverflow(1280));
    check("pageerror 0", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  if (failures) { console.error(`\n❌ v330 A-2: ${failures} failure(s)`); process.exit(1); }
  console.log("\n✅ v330 A-2: all checks passed");
})().catch((error) => { console.error(error); process.exit(1); });
