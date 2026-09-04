// v259: 前サイクル12WY Projectのcarryフォームと新サイクル移行UIを検証する。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}
function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`source markerが見つかりません: ${startMarker}`);
  return source.slice(start, end);
}

(async () => {
  console.log("[1] carryフォーム読み取り・戻り値分岐・ハンドラ内ガード");
  const trackCore = await import(pathToFileURL(path.join(ROOT, "src", "core", "track.js")).href);
  const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const carryUiSource = sourceBetween(appSource, "function readCarryDraft(existing) {", "function readTrackDraft(fields) {");
  const errorEl = { hidden: true, textContent: "" };
  const sandbox = {
    String, Number, Boolean, calls: [], rows: [], inputs: {}, carryResult: { ok: true }, confirmResult: true,
    hasErrorElement: true,
    state: { modal: { type: "project", id: "p259" }, settings: { twelveWeekStartDate: "2026-08-15" },
      projects: [{ id: "p259", twelveWeekStartDate: "2026-05-23", deleted: false }], tracks: [] },
    modalRoot: {
      querySelector: (selector) => selector === "[data-twy-carry-errors]" && sandbox.hasErrorElement ? errorEl
        : (Object.hasOwn(sandbox.inputs, selector) ? { value: sandbox.inputs[selector] } : null),
      querySelectorAll: (selector) => selector === "[data-twy-carry-ms-row]" ? sandbox.rows : []
    },
    activeTrackForProject: (tracks, id) => tracks.find((track) => track.ownerId === id && track.status === "active"),
    isProjectInCurrentCycle: trackCore.isProjectInCurrentCycle,
    escapeHTML: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;"),
    window: { confirm: (message) => { sandbox.calls.push(["confirm", message]); return sandbox.confirmResult; } },
    carryProjectToNewCycle: (...args) => { sandbox.calls.push(["carry", ...args]); return sandbox.carryResult; },
    closeModal: () => sandbox.calls.push(["close"]),
    saveAndRender: (message) => sandbox.calls.push(["save-render", message]),
    openProjectEditor: (id) => sandbox.calls.push(["open", id]),
    showToast: (message) => sandbox.calls.push(["toast", message])
  };
  vm.createContext(sandbox);
  vm.runInContext(carryUiSource, sandbox);

  const numeric = { id: "trk-num", ownerId: "p259", kind: "numeric", status: "active" };
  sandbox.state.tracks = [numeric];
  sandbox.inputs = { "[data-twy-carry-deadline]": "2026-11-07", "[data-twy-carry-goal]": "" };
  let blankGoal = sandbox.readCarryDraft(numeric);
  check("numeric目標値未入力はgoalValueキー自体を渡さない", blankGoal.deadline === "2026-11-07"
    && !Object.hasOwn(blankGoal, "goalValue"), JSON.stringify(blankGoal));
  sandbox.inputs["[data-twy-carry-goal]"] = "42";
  const changedGoal = sandbox.readCarryDraft(numeric);
  check("numeric目標値入力はNumberへ変換して期限と渡す", changedGoal.goalValue === 42
    && changedGoal.deadline === "2026-11-07", JSON.stringify(changedGoal));

  const milestoneStub = { id: "trk-ms", ownerId: "p259", kind: "milestone", status: "active" };
  sandbox.rows = [
    { dataset: { twyCarryMsId: "ms-a" }, querySelector: () => ({ value: "2026-08-15" }) },
    { dataset: { twyCarryMsId: "ms-b" }, querySelector: () => ({ value: "2026-08-16" }) }
  ];
  check("milestone予定日は旧節目idキーのプレーンオブジェクトで渡す",
    JSON.stringify(sandbox.readCarryDraft(milestoneStub).milestonePlannedDates) === JSON.stringify({
      "ms-a": "2026-08-15", "ms-b": "2026-08-16"
    }));

  sandbox.state.tracks = [numeric];
  sandbox.inputs["[data-twy-carry-goal]"] = "";
  sandbox.calls = [];
  sandbox.confirmCarryProjectCycle();
  const numericCarryCall = sandbox.calls.find((call) => call[0] === "carry");
  check("通常numeric確定は新サイクル日とgoalValue無しdraftでデータ層を呼ぶ",
    numericCarryCall?.[1] === "p259" && numericCarryCall?.[2] === "2026-08-15"
    && numericCarryCall?.[3]?.deadline === "2026-11-07" && !Object.hasOwn(numericCarryCall[3], "goalValue"),
  JSON.stringify(numericCarryCall));
  check("track有り確定でも未保存編集の破棄を確認する", sandbox.calls[0]?.[0] === "confirm"
    && sandbox.calls[0][1].includes("モーダルの未保存の編集は破棄されます"));
  check("通常成功はモーダルを閉じてsaveAndRenderする",
    sandbox.calls.some((call) => call[0] === "close") && sandbox.calls.some((call) => call[0] === "save-render")
    && !sandbox.calls.some((call) => call[0] === "open"), JSON.stringify(sandbox.calls));

  sandbox.calls = []; sandbox.carryResult = { ok: false, errors: ["deadline必須"] };
  errorEl.hidden = true; errorEl.textContent = "";
  sandbox.confirmCarryProjectCycle();
  check("データ層エラーはフォームを維持してそのまま表示", !errorEl.hidden && errorEl.textContent === "deadline必須"
    && !sandbox.calls.some((call) => call[0] === "close" || call[0] === "open"));

  sandbox.calls = []; sandbox.hasErrorElement = false;
  sandbox.confirmCarryProjectCycle();
  check("フォーム内エラー欄が無ければtoastへフォールバック", sandbox.calls.some((call) =>
    call[0] === "toast" && call[1] === "deadline必須"));
  sandbox.hasErrorElement = true;

  sandbox.calls = []; sandbox.carryResult = { ok: true, carriedWithoutTrack: true };
  sandbox.confirmCarryProjectCycle();
  check("carriedWithoutTrackはcloseせず保存描画後にProjectモーダルを再構築",
    sandbox.calls.some((call) => call[0] === "save-render") && sandbox.calls.some((call) => call[0] === "open" && call[1] === "p259")
    && !sandbox.calls.some((call) => call[0] === "close"), JSON.stringify(sandbox.calls));

  sandbox.state.tracks = []; sandbox.calls = []; sandbox.carryResult = { ok: true }; sandbox.confirmResult = true;
  sandbox.confirmCarryProjectCycle();
  const noTrackCall = sandbox.calls.find((call) => call[0] === "carry");
  check("track無しは確認Yes後に空fieldsでデータ層を呼ぶ", sandbox.calls[0]?.[0] === "confirm"
    && noTrackCall?.[1] === "p259" && noTrackCall?.[2] === "2026-08-15"
    && Object.keys(noTrackCall?.[3] || {}).length === 0, JSON.stringify(sandbox.calls));
  check("track無し確認にも未保存編集の破棄を明記", sandbox.calls[0][1].includes("モーダルの未保存の編集は破棄されます"));
  sandbox.calls = []; sandbox.confirmResult = false;
  sandbox.confirmCarryProjectCycle();
  check("track無し確認Noはデータ層を呼ばない", !sandbox.calls.some((call) => call[0] === "carry"));

  for (const guard of [
    { name: "非12WY", projectDate: "", settingDate: "2026-08-15" },
    { name: "12WY未設定", projectDate: "2026-05-23", settingDate: "" },
    { name: "現サイクル一致", projectDate: "2026-08-15", settingDate: "2026-08-15" }
  ]) {
    sandbox.state.projects[0].twelveWeekStartDate = guard.projectDate;
    sandbox.state.settings.twelveWeekStartDate = guard.settingDate;
    sandbox.calls = [];
    sandbox.confirmCarryProjectCycle();
    check(`${guard.name}は直接確定されてもハンドラ内ガードで無処理`, sandbox.calls.length === 0);
  }

  console.log("[2] 実ブラウザの全carry経路・境界・既存Project回帰");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1024, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);
  let acceptDialog = false;
  let dialogs = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    if (acceptDialog) await dialog.accept(); else await dialog.dismiss();
  });
  const TODAY = "2026-08-24", OLD_CYCLE = "2026-05-23", NEW_CYCLE = "2026-08-15";
  function numericTrack(extra = {}) {
    return { id: "trk-v259", ownerType: "project", ownerId: "p259", cycleStartDate: OLD_CYCLE,
      kind: "numeric", name: "読書", unit: "章", startDate: OLD_CYCLE, deadline: "2026-08-14",
      baselineValue: 0, goalValue: 30, valueStep: 1, milestones: [], status: "active", closedAt: "",
      closedReason: "", supersedesTrackId: "", carriedFromTrackId: "", createdAt: "2026-05-23T00:00:00",
      updatedAt: "2026-05-23T00:00:00", deleted: false, ...extra };
  }
  function milestoneTrack(milestones, extra = {}) {
    return numericTrack({ kind: "milestone", name: "刊行", unit: "", deadline: "", baselineValue: 0,
      goalValue: 0, milestones, ...extra });
  }
  function milestone(id, label, plannedDate, doneAt = "") {
    return { id, label, plannedDate, originalPlannedDate: plannedDate, doneAt,
      doneChangedAt: doneAt ? `${doneAt}T12:00:00` : "", updatedAt: "2026-06-01T00:00:00", deleted: false };
  }
  async function seed({ projectCycle = OLD_CYCLE, settingCycle = NEW_CYCLE, tracks = [], measurements = [], title = "v259 Project" } = {}) {
    await page.evaluate(({ key, today, projectCycle, settingCycle, tracks, measurements, title }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "wbs";
      state.selectedDate = today;
      state.settings.twelveWeekStartDate = settingCycle;
      state.projects = [{ id: "p259", kind: "normal", title, status: "active", priority: "中", category: "",
        startDate: today, dueDate: "", description: "", twelveWeekStartDate: projectCycle, showProgress: false,
        createdAt: "2026-05-01T00:00:00", updatedAt: "2026-05-01T00:00:00", deleted: false }];
      state.tasks = [{ id: "task-v259", projectId: "p259", title: "実行する", status: "todo", deleted: false }];
      state.blocks = [];
      state.recurrences = [];
      state.tracks = tracks;
      state.trackMeasurements = measurements;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY, projectCycle, settingCycle, tracks, measurements, title });
    await page.reload();
    // v329: 行の副操作は…メニュー(排他)の中。reload直後は必ず閉じているため先に開く
    // (セレクタ追随・assert不変)
    await page.waitForSelector('[data-wbs-row-id="p259"] [data-action="wbs-row-menu-toggle"]');
    await page.locator('[data-wbs-row-id="p259"] [data-action="wbs-row-menu-toggle"]').first().click();
    await page.waitForTimeout(150);
    await page.waitForSelector('[data-action="edit-project"][data-id="p259"]');
    await page.locator('[data-action="edit-project"][data-id="p259"]').first().click();
    await page.waitForSelector("[data-twy-track]", { state: "attached" });
    dialogs = [];
    acceptDialog = false;
  }
  async function savedState() { return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY); }
  async function openCarryForm() {
    await page.locator('[data-action="twy-carry-cycle"]').click();
    await page.locator("[data-twy-carry-form]").waitFor({ state: "visible" });
    acceptDialog = true;
  }
  async function injectAndClickCarry() {
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.dataset.action = "twy-carry-confirm";
      document.querySelector(".modal-card")?.append(button);
      button.click();
    });
  }
  async function resetSaveCount() {
    await page.evaluate((key) => {
      const original = Storage.prototype.setItem;
      window.__v259SaveCount = 0;
      Storage.prototype.setItem = function patchedSetItem(name, value) {
        if (name === key) window.__v259SaveCount += 1;
        return original.call(this, name, value);
      };
    }, STATE_KEY);
  }

  try {
    await page.clock.setFixedTime(new Date(2026, 7, 24, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    for (const guard of [
      { name: "現サイクル", projectCycle: NEW_CYCLE, settingCycle: NEW_CYCLE },
      { name: "非12WY", projectCycle: "", settingCycle: NEW_CYCLE },
      { name: "12WY未設定", projectCycle: OLD_CYCLE, settingCycle: "" }
    ]) {
      await seed(guard);
      check(`${guard.name}Projectではcarryブロックを描画しない`, await page.locator("[data-twy-carry]").count() === 0);
      const before = JSON.stringify(await savedState());
      await injectAndClickCarry();
      check(`${guard.name}Projectの直接DOM操作もstateを変えない`, JSON.stringify(await savedState()) === before
        && await page.locator(".modal-root.open").count() === 1);
    }

    for (const boundary of [
      { name: "+1日", projectCycle: "2026-08-16" },
      { name: "+83日", projectCycle: "2026-11-06" },
      { name: "+84日(未来側)", projectCycle: "2026-11-07" }
    ]) {
      await seed({ projectCycle: boundary.projectCycle });
      check(`${boundary.name}はcarry対象外でボタン非表示`, await page.locator("[data-twy-carry]").count() === 0);
      const before = JSON.stringify(await savedState());
      await injectAndClickCarry();
      check(`${boundary.name}は直接確定されても無処理`, JSON.stringify(await savedState()) === before);
    }
    await seed({ projectCycle: "2026-08-14" });
    check("-1日の過去側はcarry可能", await page.locator("[data-twy-carry]").isVisible());

    await seed();
    const carryNotice = await page.locator("[data-twy-carry]").textContent();
    check("carry案内に未保存編集の破棄を明記", carryNotice.includes("モーダルの未保存の編集は破棄されます"));
    const is12WYToggle = page.locator('[data-modal-field="is12WY"]');
    await is12WYToggle.uncheck();
    check("is12WYを外すとcarryブロックも隠れる", !(await page.locator("[data-twy-carry]").isVisible()));
    await is12WYToggle.check();
    check("is12WYを戻すとcarryブロックも再表示", await page.locator("[data-twy-carry]").isVisible());

    await seed();
    check("前サイクルtrack無しProjectだけに移行導線を表示", await page.locator("[data-twy-carry]").isVisible()
      && await page.locator("[data-twy-carry-form]").count() === 0);
    acceptDialog = true;
    await resetSaveCount();
    await page.locator('[data-action="twy-carry-cycle"]').click();
    let state = await savedState();
    check("track無し確認YesはProject開始日だけ更新してモーダルを閉じる", dialogs.length === 1
      && state.projects[0].twelveWeekStartDate === NEW_CYCLE && state.tracks.length === 0
      && await page.locator(".modal-root.open").count() === 0, JSON.stringify({ dialogs, project: state.projects[0] }));
    check("track無し成功はデータ層+UI保存の既存前例どおり実質2回保存", await page.evaluate(() => window.__v259SaveCount) === 2);

    const measurements = [
      { id: "tm-old", trackId: "trk-v259", value: 8, observedAt: "2026-06-01T10:00:00", updatedAt: "2026-06-01T10:00:00", deleted: false },
      { id: "tm-new", trackId: "trk-v259", value: 12, observedAt: "2026-08-01T10:00:00", updatedAt: "2026-08-01T10:00:00", deleted: false }
    ];
    await seed({ tracks: [numericTrack()], measurements });
    check("numeric carryフォームは初期非表示", !(await page.locator("[data-twy-carry-form]").isVisible()));
    await openCarryForm();
    check("移行ボタンはrenderせずフォームだけ局所展開", await page.locator("[data-twy-carry-form]").isVisible()
      && await page.locator('[data-twy-carry-goal]').inputValue() === "");
    check("numeric未達では到達済み案内を表示しない", await page.locator("[data-twy-carry-goal-reached]").count() === 0);
    await page.locator("[data-twy-carry-deadline]").fill("2026-11-07");
    await page.locator("[data-twy-carry-goal]").focus();
    await page.locator("[data-twy-carry-goal]").blur();
    await resetSaveCount();
    await page.locator('[data-action="twy-carry-confirm"]').click();
    state = await savedState();
    let active = state.tracks.find((track) => track.status === "active");
    let old = state.tracks.find((track) => track.id === "trk-v259");
    check("numeric通常carryは最新測定をbaseline・旧goalを既定に新trackを作る", active?.id !== "trk-v259"
      && active?.baselineValue === 12 && active?.goalValue === 30 && active?.deadline === "2026-11-07"
      && active?.carriedFromTrackId === "trk-v259" && active?.cycleStartDate === NEW_CYCLE,
    JSON.stringify(active));
    check("numeric通常carryはProject時刻を進め旧trackをcarriedで閉じる", state.projects[0].updatedAt === `${TODAY}T10:00:00`
      && old?.closedReason === "carried" && old?.closedAt === `${TODAY}T10:00:00`
      && await page.locator(".modal-root.open").count() === 0, JSON.stringify(old));
    check("numeric通常成功も保存は実質2回", await page.evaluate(() => window.__v259SaveCount) === 2);
    check("track有り確認にも未保存編集の破棄を明記", dialogs.length === 1
      && dialogs[0].includes("モーダルの未保存の編集は破棄されます"));

    await seed({ tracks: [numericTrack()], measurements });
    await openCarryForm();
    await page.locator("[data-twy-carry-deadline]").fill("2026-11-07");
    await page.locator("[data-twy-carry-goal]").fill("45");
    await page.locator('[data-action="twy-carry-confirm"]').click();
    active = (await savedState()).tracks.find((track) => track.status === "active");
    check("numeric目標値変更carryは入力値を新goalに使う", active?.goalValue === 45);

    await seed({ tracks: [numericTrack()], measurements: [
      { id: "tm-done", trackId: "trk-v259", value: 30, observedAt: "2026-08-01T10:00:00", updatedAt: "2026-08-01T10:00:00", deleted: false }
    ] });
    await openCarryForm();
    check("numeric到達済みだけ終了案内を表示", await page.locator("[data-twy-carry-goal-reached]").isVisible()
      && (await page.locator("[data-twy-carry-goal-reached]").textContent()).includes("目標に到達しています"));
    await page.locator("[data-twy-carry-goal]").focus();
    await page.locator("[data-twy-carry-goal]").blur();
    await page.locator('[data-action="twy-carry-confirm"]').click();
    state = await savedState();
    check("numeric達成済みはgoalValue未指定のまま新trackを作らずcarriedで閉じる",
      !state.tracks.some((track) => track.status === "active") && state.tracks[0].closedReason === "carried"
      && state.projects[0].twelveWeekStartDate === NEW_CYCLE);
    check("numeric達成済みはモーダルを閉じずkind:noneで再構築して#7登録へ誘導",
      await page.locator(".modal-root.open").count() === 1
      && await page.locator('[data-modal-field="twyKind"]').inputValue() === "none"
      && (await page.locator(".toast").textContent()).includes("新しい目標"));

    const milestones = [
      milestone("ms-done", "構想", "2026-06-01", "2026-06-01"),
      milestone("ms-a", "初稿", "2026-07-01"), milestone("ms-b", "提出", "2026-08-01")
    ];
    await seed({ tracks: [milestoneTrack(milestones)] });
    await openCarryForm();
    check("milestone carryは完了済みを除外して未完了節目だけ表示", await page.locator("[data-twy-carry-ms-row]").count() === 2
      && !(await page.locator("[data-twy-carry-milestones]").textContent()).includes("構想")
      && !(await page.locator("[data-twy-carry-numeric]").isVisible()));
    const carryRows = page.locator("[data-twy-carry-ms-row]");
    await carryRows.nth(0).locator("[data-twy-carry-ms-date]").fill(NEW_CYCLE);
    await carryRows.nth(1).locator("[data-twy-carry-ms-date]").fill("2026-08-16");
    await page.locator('[data-action="twy-carry-confirm"]').click();
    state = await savedState();
    active = state.tracks.find((track) => track.status === "active");
    check("milestone境界当日/+1日は成立し新id・予定日・original・未完了で複製", active?.milestones.length === 2
      && active.milestones[0].id !== "ms-a" && active.milestones[0].plannedDate === NEW_CYCLE
      && active.milestones[0].originalPlannedDate === NEW_CYCLE && !active.milestones[0].doneAt
      && active.milestones[1].id !== "ms-b" && active.milestones[1].plannedDate === "2026-08-16"
      && active.carriedFromTrackId === "trk-v259", JSON.stringify(active));

    await seed({ tracks: [milestoneTrack(milestones)] });
    await openCarryForm();
    await carryRows.nth(0).locator("[data-twy-carry-ms-date]").fill(NEW_CYCLE);
    const beforeEmpty = JSON.stringify(await savedState());
    await page.locator('[data-action="twy-carry-confirm"]').click();
    check("milestone予定日1件空欄は全件未保存でフォームとstateを維持",
      await page.locator("[data-twy-carry-errors]").isVisible()
      && (await page.locator("[data-twy-carry-errors]").textContent()).includes("plannedDate必須")
      && JSON.stringify(await savedState()) === beforeEmpty);

    await seed({ tracks: [milestoneTrack(milestones)] });
    await openCarryForm();
    await carryRows.nth(0).locator("[data-twy-carry-ms-date]").fill("2026-08-14");
    await carryRows.nth(1).locator("[data-twy-carry-ms-date]").fill(NEW_CYCLE);
    const beforePast = JSON.stringify(await savedState());
    await page.locator('[data-action="twy-carry-confirm"]').click();
    check("milestone移行日前日(-1)はデータ層エラーでstate不変",
      (await page.locator("[data-twy-carry-errors]").textContent()).includes("plannedDateは新サイクル開始日以後が必須")
      && JSON.stringify(await savedState()) === beforePast);

    await seed({ tracks: [numericTrack()], measurements });
    await openCarryForm();
    const beforeDeadline = JSON.stringify(await savedState());
    await page.locator('[data-action="twy-carry-confirm"]').click();
    check("numeric期限空欄はデータ層エラーを表示しProject/trackを変えない",
      (await page.locator("[data-twy-carry-errors]").textContent()).includes("deadline必須")
      && JSON.stringify(await savedState()) === beforeDeadline && await page.locator("[data-twy-carry-form]").isVisible());
    await page.locator('[data-action="twy-carry-cycle"]').click();
    check("carryフォーム再展開時は古いエラーをクリア", !(await page.locator("[data-twy-carry-errors]").isVisible())
      && await page.locator("[data-twy-carry-errors]").textContent() === "");

    await seed({ tracks: [milestoneTrack([milestone("ms-done", "提出済み", "2026-08-01", "2026-08-01")])] });
    await openCarryForm();
    check("全節目達成済みは未完了0件の案内を表示", await page.locator("[data-twy-carry-ms-row]").count() === 0
      && (await page.locator("[data-twy-carry-milestones]").textContent()).includes("未完了の節目はありません"));
    await page.locator('[data-action="twy-carry-confirm"]').click();
    state = await savedState();
    check("全節目達成済みは新track無しでcarried後に登録フォームを再構築",
      !state.tracks.some((track) => track.status === "active") && state.tracks[0].closedReason === "carried"
      && await page.locator('[data-modal-field="twyKind"]').inputValue() === "none");

    const xss = '\"><img src=x onerror="window.__v259Xss=true"><input data-v259-breached="';
    await seed({ projectCycle: `2026-05-23${xss}`, settingCycle: `2026-08-15${xss}`,
      tracks: [milestoneTrack([milestone(xss, xss, "2026-08-01")])] });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const xssRow = page.locator("[data-twy-carry-ms-row]").first();
    const xssResult = {
      carryText: await page.locator("[data-twy-carry]").textContent(), rowId: await xssRow.getAttribute("data-twy-carry-ms-id"),
      rowText: await xssRow.textContent(), breached: await page.locator("[data-v259-breached]").count(),
      executed: await page.evaluate(() => window.__v259Xss === true)
    };
    check("Project/setting/節目id/節目名の同期値を全表示箇所でescapeHTMLする",
      xssResult.carryText.includes(`2026-05-23${xss}`) && xssResult.carryText.includes(`2026-08-15${xss}`)
      && xssResult.rowId === xss && xssResult.rowText.includes(xss)
      && xssResult.breached === 0 && !xssResult.executed, JSON.stringify(xssResult));

    await seed({ tracks: [numericTrack({ goalValue: xss })] });
    check("numeric旧goalのplaceholderもescapeHTMLして属性内へ封じ込める",
      await page.locator("[data-twy-carry-goal]").getAttribute("placeholder") === `現在の目標: ${xss}`
      && await page.locator("[data-v259-breached]").count() === 0);

    await seed({ projectCycle: NEW_CYCLE, settingCycle: NEW_CYCLE, tracks: [numericTrack({ cycleStartDate: NEW_CYCLE })] });
    const unchangedTrack = JSON.stringify((await savedState()).tracks[0]);
    await page.locator('[data-modal-field="title"]').fill("既存フォーム回帰OK");
    await page.locator('[data-action="modal-save"]').click();
    state = await savedState();
    check("現サイクルの既存Project/v258 trackフォーム保存はcarry追加後も退行しない",
      state.projects[0].title === "既存フォーム回帰OK" && JSON.stringify(state.tracks[0]) === unchangedTrack);
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nv259: 全件成功" : `\nv259: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
