// v330: 旧Project詳細ペインの回帰。週パネルの検査は発注02で撤去。
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

    console.log("[3] PC 2ペイン・12WY優先の既定選択・選択は非永続");
    check("1280pxは一覧/選択詳細が1:2の2列", await page.locator(".wbs-projects.is-desktop").isVisible()
      && await page.locator(".wbs-project-list").evaluate((element) => Math.abs(element.getBoundingClientRect().width * 2 - document.querySelector(".wbs-project-detail").getBoundingClientRect().width) < 1 && element.getBoundingClientRect().width > 0)
      && await page.locator('[data-wbs-detail-id="p-cycle"]').isVisible());
    check("既定選択は配列順ではなく12WY優先(先頭は!Alpha)", await page.locator('.wbs-project-choice').first().textContent()
      .then((text) => text.includes("!Alpha")) && await page.locator('[data-wbs-detail-id="p-cycle"]').isVisible());

    // v330修正(レビュー対応): fixture保存直後の値を基準に、選択・ビューポート切替を挟んでも
    // 内容が変わるsetItemが0回であることを検証する(以前は選択クリック前後だけの比較だった)。
    const stableValue = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await page.evaluate((key) => {
      window.__v330StateWrites = 0;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItemSpy(name, value) {
        if (this === localStorage && name === key && localStorage.getItem(name) !== value) window.__v330StateWrites += 1;
        return original.call(this, name, value);
      };
    }, STATE_KEY);
    await page.locator('[data-action="wbs-select-project"][data-id="p-other"]').click();
    check("選択で右ペインが切り替わる", await page.locator('[data-wbs-detail-id="p-other"]').isVisible());
    await page.setViewportSize({ width: 1279, height: 900 });
    await page.waitForFunction(() => { const a=document.querySelector('.wbs-project-list').getBoundingClientRect(), b=document.querySelector('.wbs-project-detail').getBoundingClientRect(); return b.top >= a.bottom; });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(50);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector(".wbs-projects.is-desktop");
    check("選択・ビューポート切替を通じstate/localStorageの内容が変わらない",
      await page.evaluate((key) => localStorage.getItem(key), STATE_KEY) === stableValue
        && await page.evaluate(() => window.__v330StateWrites) === 0);

    console.log("[4] 1279pxはProject選択とTask検索を縦置き");
    await page.setViewportSize({ width: 1279, height: 900 });
    await page.waitForFunction(() => { const a=document.querySelector('.wbs-project-list').getBoundingClientRect(), b=document.querySelector('.wbs-project-detail').getBoundingClientRect(); return b.top >= a.bottom; });
    const mobileLayout2 = { panes: await page.locator(".wbs-project-list, .wbs-project-detail").count(),
      choices: await page.locator('[data-action="wbs-select-project"]').count(),
      projects: await page.evaluate(key => JSON.parse(localStorage.getItem(key)).projects.filter(p => !p.deleted).length, STATE_KEY) };
    check("1279pxは選択Projectを保持し独立検索2枠と全Project/なし選択肢を縦に表示", mobileLayout2.panes === 2
      && mobileLayout2.choices === mobileLayout2.projects + 1
      && await page.locator('[data-wbs-detail-id="p-other"]').isVisible()
      && await page.locator('#wbs-projects-query').isVisible()
      && await page.locator('#wbs-tasks-p-other-query').isVisible(), JSON.stringify(mobileLayout2));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector(".wbs-projects.is-desktop");

    console.log("[5] 右ペインの操作チップは既存actionを再利用");
    await page.locator('[data-action="wbs-select-project"][data-id="p-other"]').click();
    await page.waitForSelector('[data-wbs-detail-id="p-other"]');
    check("中断前は「中断」チップ", await page.locator('[data-wbs-detail-id="p-other"] [data-action="suspend-project"]').isVisible());
    await page.locator('[data-wbs-detail-id="p-other"] [data-action="suspend-project"]').click();
    await page.waitForSelector('[data-wbs-detail-id="p-other"] [data-action="resume-project"]');
    check("suspend-project実行後は既存状態(中断)に反映され「再開」チップへ切り替わる",
      await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)).projects.find((p) => p.id === id).status === "paused",
        { key: STATE_KEY, id: other.id }));
    // 後片付け: 以降のテストに影響しないよう再開しておく。
    await page.locator('[data-wbs-detail-id="p-other"] [data-action="resume-project"]').click();
    await page.waitForSelector('[data-wbs-detail-id="p-other"] [data-action="suspend-project"]');

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
