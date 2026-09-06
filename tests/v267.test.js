// v267: 12WY MVPの登録→週次確定→完了→COUNTDOWN→測定→同期、8日未更新、土曜0:00境界を統合検証する。
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { isDeepStrictEqual } = require("util");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY,
  dismissBodyScanIfOpen
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}

function configureSync(syncMod) {
  const noop = () => {};
  syncMod.configureGithubSync({
    normalizeState: (value) => value, nowDateTime: () => "2026-08-25T10:00:00",
    todayISO: () => "2026-08-25", addDays: (date) => date, isTouchedBlock: () => false,
    RECURRENCE_KEEP_PAST_DAYS: 7, RECURRENCE_FUTURE_DAYS: 31, SWIPE_TRIAGE_LOG_MAX: 200,
    showToast: noop, maintainRecurrences: noop, render: noop, runDailyOpen: () => false, saveState: noop,
    requireGitHubConfig: noop, fetchGitHubFileSHA: noop, personalDataReady: () => true,
    personalDataFileConfig: noop, gitHubContentsURL: noop, githubHeaders: noop, gitHubErrorMessage: noop,
    fromBase64: noop, toBase64: noop, sanitizedStateForGitHub: noop, maybeWriteBackupSnapshot: noop,
    updateAutoSaveStatus: noop, updateSyncDot: noop, renderSyncBanner: noop,
    pruneExpiredSuggestedThemes: (value) => value, _startupDataModifiedAt: ""
  });
}

(async () => {
  const storeMod = await import(pathToFileURL(path.join(ROOT, "src", "state", "store.js")).href);
  const syncMod = await import(pathToFileURL(path.join(ROOT, "src", "sync", "github.js")).href);
  configureSync(syncMod);

  const instrumentedApp = appSource
    .replace("function saveState() {", "function saveState() { window.__v267SaveCalls = (window.__v267SaveCalls || 0) + 1;")
    .replace("function candidateBlocksForWeek(value, weekStart) {",
      "window.__v267WeekStart = () => weekRange(todayISO()).weekStart;\nfunction candidateBlocksForWeek(value, weekStart) {");
  check("テスト計器のsource markerは各1件", instrumentedApp !== appSource
    && (instrumentedApp.match(/__v267WeekStart/g) || []).length === 1);

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({
    serviceWorkers: "block", timezoneId: "Asia/Tokyo", viewport: { width: 1024, height: 900 }
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);
  await page.route(`http://localhost:${PORT}/app.js`, (route) => route.fulfill({
    status: 200, contentType: "application/javascript; charset=utf-8", body: instrumentedApp
  }));

  const TODAY = "2026-08-25", CYCLE = "2026-08-15", WEEK = "2026-08-22", NOW = `${TODAY}T10:00:00`;
  const project = (id) => ({ id, kind: "normal", title: id, status: "active", priority: "中", category: "",
    startDate: CYCLE, dueDate: "", description: "", twelveWeekStartDate: CYCLE, showProgress: false,
    collapsed: false, createdAt: NOW, updatedAt: NOW, deleted: false });
  const task = (id, projectId) => ({ id, projectId, parentTaskId: "", title: id, category: "", status: "todo",
    dueDate: "", description: "", progressNum: 0, progressDen: 10, createdAt: NOW, updatedAt: NOW, deleted: false });
  const block = (id, taskId, hour) => ({ id, taskId, title: id, category: "仕事", date: TODAY,
    plannedStartAt: `${TODAY}T${hour}:00:00`, plannedEndAt: `${TODAY}T${hour}:30:00`, actualStartAt: "",
    actualEndAt: "", completed: false, charge: 0, discharge: 0, recurrenceGroupId: "", migratedTo: "",
    createdAt: NOW, updatedAt: NOW, deleted: false });

  const savedState = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  const resetSaveProbe = () => page.evaluate(() => { window.__v267SaveCalls = 0; });
  const saveCalls = () => page.evaluate(() => window.__v267SaveCalls || 0);
  const openProject = async (id) => {
    // v329: 行の副操作は…メニュー(排他)の中。DOM直操作のトグルはrenderを経ないため
    // 開閉状態がそのまま残ることがあり、閉じている時だけ開く(セレクタ追随・assert不変)
    const menuOpen = await page.evaluate((rowId) => {
      const panel = document.querySelector(`[data-wbs-row-id="${rowId}"] .wbs-row-menu-panel`);
      return panel ? !panel.hidden : false;
    }, id);
    if (!menuOpen) {
      await page.click(`[data-wbs-row-id="${id}"] [data-action="wbs-row-menu-toggle"]`);
      await page.waitForTimeout(150);
    }
    await page.locator(`[data-action="edit-project"][data-id="${id}"]`).first().click();
    await page.waitForSelector("[data-twy-track]", { state: "attached" });
  };
  const openScoreDetail = async () => {
    const score = page.locator('.life-band [data-action="twy-score-toggle"]');
    if (await score.getAttribute("aria-expanded") !== "true") await score.click();
    await page.waitForSelector(".life-band .twy-score-detail");
    return score;
  };
  const excuseCommitment = async (itemId, reason) => {
    const row = page.locator(`[data-twy-commit-item][data-id="${itemId}"]`);
    await row.locator('[data-action="twy-excuse"]').click();
    await page.locator("[data-twy-excuse-reason]").fill(reason);
    await page.locator(`[data-action="twy-excuse-confirm"][data-id="${itemId}"]`).click();
  };

  let baseline;
  try {
    console.log("[1] 追加E2E-d: 土曜0:00のローカル時刻境界");
    await page.clock.setFixedTime(new Date(Date.UTC(2026, 7, 28, 14, 59, 59)));
    await page.goto(`http://localhost:${PORT}/`); await passGithubGate(page);
    check("金曜23:59:59は旧週2026-08-22", await page.evaluate(() => window.__v267WeekStart()) === "2026-08-22");
    await page.clock.setFixedTime(new Date(Date.UTC(2026, 7, 28, 15, 0, 0)));
    check("土曜00:00:00で新週2026-08-29へ切替", await page.evaluate(() => window.__v267WeekStart()) === "2026-08-29");

    console.log("[2] 判定条件1〜4: 登録→確定→完了→COUNTDOWN→測定→同期の全通し");
    await page.clock.setFixedTime(new Date(Date.UTC(2026, 7, 25, 1, 0, 0)));
    await page.evaluate(({ key, today, cycle, projects, tasks, blocks }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "wbs"; state.selectedDate = today; state.settings.twelveWeekStartDate = cycle;
      state.projects = projects; state.tasks = tasks; state.blocks = blocks; state.tracks = [];
      state.trackMeasurements = []; state.weeklyCommitments = []; state._trackToastLog = {}; state.recurrences = [];
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY, cycle: CYCLE, projects: [project("p-num"), project("p-ms")],
      tasks: [task("t-num", "p-num"), task("t-ms", "p-ms")],
      blocks: [block("b-num", "t-num", "09"), block("b-ms", "t-ms", "11")] });
    // v328(既存): toggle-wbs-editは単独ボタンと「表示 ▾」ポップオーバー内の2箇所にあり、
    // 後者は既定非表示のためvisible待ちだと最初の1件(非表示側)で詰まる。ここではクリックせず
    // 存在確認だけなのでattachedで待つ(セレクタ追随・assert不変)
    await page.reload(); await page.waitForSelector('[data-action="toggle-wbs-edit"]', { state: "attached" }); baseline = await savedState();

    await openProject("p-num"); await page.locator('[data-action="twy-kind-numeric"]').click();
    for (const [field, value] of [["twyName", "読書"], ["twyStartDate", TODAY], ["twyBaseline", "0"],
      ["twyGoal", "20"], ["twyUnit", "章"], ["twyDeadline", "2026-10-31"], ["twyStep", "1"]]) {
      await page.locator(`[data-modal-field="${field}"]`).fill(value);
    }
    await page.locator('[data-action="modal-save"]').click();
    await openProject("p-ms"); await page.locator('[data-action="twy-kind-milestone"]').click();
    for (const [label, date] of [["初稿", "2026-09-10"], ["提出", "2026-10-20"]]) {
      await page.locator('[data-action="twy-ms-add"]').click();
      const row = page.locator(".twy-ms-edit-row").last();
      await row.locator("[data-twy-ms-label]").fill(label); await row.locator("[data-twy-ms-date]").fill(date);
    }
    await page.locator('[data-action="modal-save"]').click();
    let state = await savedState();
    const numeric = state.tracks.find((track) => track.ownerId === "p-num");
    const milestone = state.tracks.find((track) => track.ownerId === "p-ms");
    check("条件1 numeric/milestone登録がWBS状態行まで連鎖", numeric?.kind === "numeric" && milestone?.kind === "milestone"
      && await page.locator(`[data-twy-track-id="${numeric?.id}"] .t-state`).count() === 1
      && await page.locator(`[data-twy-track-id="${milestone?.id}"] .twy-ms-node`).count() === 2);

    // v329以前から: 12WY Projectが複数(p-num/p-ms)あると各行に同じ「今週を確定」ボタンが
    // 出るため2件に一致する。twy-open-commitはプロジェクト非依存のグローバルシートを開くため
    // どちらでもよく、.first()で明示する(セレクタ追随・assert不変)
    await page.locator('.twy-commit-open[data-action="twy-open-commit"]').first().click();
    check("条件2 確定前は候補2コマが既定選択", await page.locator('.twy-commit-row input[type="checkbox"]:checked').count() === 2);
    await resetSaveProbe(); await page.locator('[data-action="twy-commit-week"]').click();
    state = await savedState();
    const items = state.weeklyCommitments.filter((record) => record.recordType === "item");
    const completionSeed = items.find((item) => item.trackId === numeric.id);
    check("条件2 manual確定は実items=b-num,b-ms・2件目b-ms・決定論id非重複・保存2回", items.length === 2
      && items[0]?.blockId === "b-num" && items[1]?.blockId === "b-ms" && completionSeed?.blockId === "b-num"
      && new Set(items.map((item) => item.id)).size === 2 && items.every((item) => item.id === `wci_${WEEK}_${item.blockId}`)
      && await saveCalls() === 2, JSON.stringify({ items, saves: await saveCalls() }));
    await page.locator('[data-action="modal-close"]').click();
    await page.locator('.nav-button[data-view="exec"]').click();

    const completionButton = page.locator(
      `[data-action="toggle-block"][data-id="${completionSeed?.blockId || ""}"]`).first();
    check("条件2 完了対象は確定items由来の実DOM data-actionボタン", await completionButton.count() === 1
      && await completionButton.getAttribute("data-action") === "toggle-block");
    await resetSaveProbe(); await completionButton.click();
    await page.waitForSelector("#trackToast:not([hidden])"); state = await savedState();
    const completedItem = state.weeklyCommitments.find((record) => record.id === completionSeed.id);
    check("条件2 完了刻印は同秒tie契約・既存4保存", completedItem?.completedAt === NOW
      && completedItem.completedChangedAt === NOW && completedItem.updatedAt === NOW && await saveCalls() === 4,
    JSON.stringify({ completedItem, saves: await saveCalls() }));
    // v293追随: この完了(toggle-block、新規完了)は身体スキャンモーダルを開く。以降のnavクリック等が
    // 遮られるため、後続操作の前に片付ける(検証意図=完了刻印・保存回数は上のcheckで既に確定済み)。
    await dismissBodyScanIfOpen(page);
    await page.locator('.nav-button[data-view="today"]').click();
    const signal = await openScoreDetail();
    check("条件2 LIFE BAND実行率は1/2=50%・達成classなし", (await page.locator(".life-band .twy-score-detail").textContent()).includes("50% (1/2)")
      && (await signal.textContent()).includes("1/2・実行率 50%")
      && await signal.evaluate((element) => !element.matches(".is-good,.is-mid,.is-low")));

    await resetSaveProbe(); await page.locator('#trackToast [data-action="twy-toast-inc"]').click();
    await page.waitForFunction(() => document.querySelector("#trackToast")?.hidden === true); state = await savedState();
    const recorded = state.trackMeasurements.find((measurement) => measurement.sourceKind === "toast");
    check("条件3 トースト1タップは絶対値1・同秒永続化・保存3回", recorded?.trackId === numeric.id
      && recorded.value === 1 && recorded.blockId === completionSeed.blockId && recorded.observedAt === recorded.updatedAt
      && recorded.createdAt === recorded.updatedAt && await saveCalls() === 3, JSON.stringify({ recorded, saves: await saveCalls() }));
    await page.evaluate((key) => { const state = JSON.parse(localStorage.getItem(key)); state.currentView = "wbs";
      localStorage.setItem(key, JSON.stringify(state)); }, STATE_KEY);
    await page.reload(); await page.waitForSelector(`[data-twy-track-id="${numeric.id}"]`);
    check("条件3 measurement後のWBSは1/20章へ更新", (await page.locator(
      `[data-twy-track-id="${numeric.id}"] .twy-val`).textContent()).replace(/\s/g, "") === "1/20章");

    console.log("[2b] 判定条件2: 確定済み週の実DOM免除でCOUNTDOWN分母減・全免除N/A");
    // v329以前から: 12WY Projectが複数(p-num/p-ms)あると各行に同じ「今週を確定」ボタンが
    // 出るため2件に一致する。twy-open-commitはプロジェクト非依存のグローバルシートを開くため
    // どちらでもよく、.first()で明示する(セレクタ追随・assert不変)
    await page.locator('.twy-commit-open[data-action="twy-open-commit"]').first().click();
    const milestoneItem = items[1];
    await excuseCommitment(milestoneItem.id, "今週対象外");
    check("条件2 未完了1件の免除で確定シート分母は2→1", (await page.locator(".twy-commit-count").textContent())
      .includes("完了 1 / 免除 1 / 分母 1 → 実行 100%"));
    await page.locator('[data-action="modal-close"]').click();
    await page.locator('.nav-button[data-view="today"]').click();
    const reducedSignal = await openScoreDetail();
    check("条件2 LIFE BAND信号/展開内訳も1/1へ減る", (await reducedSignal.textContent()).includes("1/1・実行率 100%")
      && (await page.locator(".life-band .twy-score-detail").textContent()).includes("100% (1/1)"));

    // v331〜v334: execの計画一覧(renderExecNowRow/UpcomingRow)は未完了Blockだけを対象にし、
    // 実績タイムラインの完了解除ボタン(↺)も実績モードでは出さない設計になったため、完了済み
    // Blockへのtoggle-block直接クリックが届かなくなった。編集モーダルの「完了」チェックボックス
    // (data-modal-field="completed")で同じ状態変更を行う(セレクタ追随・assert不変)
    await page.locator('.nav-button[data-view="exec"]').click();
    await page.click('.exec-mode-segmented [data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForTimeout(200);
    await page.click(`[data-action="edit-block"][data-id="${completionSeed.blockId}"]`);
    await page.waitForSelector('[data-modal-field="completed"]', { state: "attached" });
    // v366追随: 完了済み(Block)チェックは頻度の低い項目として「詳細 ›」(既定閉)へ移設された。
    // 開いた後にvisible待ちで実際に到達可能であることを確認する(attachedだけでは
    // detailsが壊れて開かなくなっても検出できないため)。
    await page.locator(".modal-card details.tower-fold").evaluate((el) => { el.open = true; });
    await page.waitForSelector('[data-modal-field="completed"]');
    await page.uncheck('[data-modal-field="completed"]');
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(200);
    await page.locator('.nav-button[data-view="wbs"]').click();
    // v329以前から: 12WY Projectが複数(p-num/p-ms)あると各行に同じ「今週を確定」ボタンが
    // 出るため2件に一致する。twy-open-commitはプロジェクト非依存のグローバルシートを開くため
    // どちらでもよく、.first()で明示する(セレクタ追随・assert不変)
    await page.locator('.twy-commit-open[data-action="twy-open-commit"]').first().click();
    await excuseCommitment(completionSeed.id, "全件免除確認");
    check("条件2 確定シートは全免除でN/A", (await page.locator(".twy-commit-count").textContent()).includes("N/A(全件免除)"));
    await page.locator('[data-action="modal-close"]').click();
    await page.locator('.nav-button[data-view="today"]').click();
    const naSignal = await openScoreDetail();
    check("条件2 LIFE BAND信号/展開内訳も全免除N/A", (await naSignal.textContent()).includes("N/A・免除")
      && (await page.locator(".life-band .twy-score-detail").textContent()).includes("N/A(免除)"));
    state = await savedState();

    const remote = JSON.parse(JSON.stringify(baseline));
    storeMod.setState(JSON.parse(JSON.stringify(state)));
    const pushMerge = syncMod.computeSyncMerge(remote, "local"); syncMod.applySyncMergeToRemote(pushMerge, remote);
    storeMod.setState(JSON.parse(JSON.stringify(baseline)));
    const pullMerge = syncMod.computeSyncMerge(remote, "remote"); syncMod.applySyncMergeToLocal(pullMerge);
    const roundTrip = storeMod.state;
    const collectionNames = ["tracks", "trackMeasurements", "weeklyCommitments"];
    const canonical = (records) => records.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const blockIds = new Set(state.blocks.filter((entry) => !entry.deleted).map((entry) => entry.id));
    const trackIds = new Set(state.tracks.filter((entry) => !entry.deleted).map((entry) => entry.id));
    const exactRoundTrip = collectionNames.every((name) =>
      isDeepStrictEqual(canonical(roundTrip[name]), canonical(state[name])));
    const referencesSurvive = roundTrip.trackMeasurements.every((entry) =>
      trackIds.has(entry.trackId) && (!entry.blockId || blockIds.has(entry.blockId)))
      && roundTrip.weeklyCommitments.filter((entry) => entry.recordType === "item").every((entry) =>
        trackIds.has(entry.trackId) && blockIds.has(entry.blockId));
    check("条件4 同期往復は3コレクションの件数・ID集合・value・trackId/blockId参照まで全量一致",
      exactRoundTrip && referencesSurvive,
      JSON.stringify(collectionNames.map((name) => ({ name, before: canonical(state[name]), after: canonical(roundTrip[name]) }))));

    console.log("[3] 判定条件3-2: 同じ測定の7日/8日境界");
    await page.evaluate((key) => { const value = JSON.parse(localStorage.getItem(key)); value.currentView = "wbs";
      localStorage.setItem(key, JSON.stringify(value)); }, STATE_KEY);
    await page.clock.setFixedTime(new Date(Date.UTC(2026, 8, 1, 1, 0, 0))); await page.reload();
    await page.waitForSelector(`[data-twy-track-id="${numeric.id}"] .t-state`);
    check("同じ測定の7日後は未更新にならない", (await page.locator(
      `[data-twy-track-id="${numeric.id}"] .t-state`).textContent()) !== "未更新");
    await page.clock.setFixedTime(new Date(Date.UTC(2026, 8, 2, 1, 0, 0))); await page.reload();
    await page.waitForSelector(`[data-twy-track-id="${numeric.id}"] .t-state`);
    check("8日放置の統合ステップで状態ラベルが未更新", (await page.locator(
      `[data-twy-track-id="${numeric.id}"] .t-state`).textContent()) === "未更新");
  } catch (error) {
    failures++; console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close(); await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\nv267: 全件成功" : `\nv267: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
