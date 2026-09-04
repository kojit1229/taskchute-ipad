// v258: Projectモーダルの12WYトラック登録フォームと保存前分岐を検証する。
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
  console.log("[1] 保存前フローは正しい引数でv257データ層を呼び、No/エラー時は中断する");
  const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const draftSource = sourceBetween(appSource, "function readTrackDraft(fields) {", "function trackGuardHTML(projectId, kind, draft) {");
  const saveSource = sourceBetween(appSource, "function saveProjectTrackFromModal(id, fields) {", "function buildProjectModal(project) {");
  const trackCore = await import(pathToFileURL(path.join(ROOT, "src", "core", "track.js")).href);
  const errorEl = { hidden: true, textContent: "" };
  const sandbox = {
    Map, Set, String, Number, Boolean,
    state: { tracks: [] }, rows: [], calls: [], confirmResult: true,
    modalRoot: {
      querySelectorAll: (selector) => selector === ".twy-ms-edit-row" ? sandbox.rows : [],
      querySelector: (selector) => selector === "[data-twy-errors]" ? errorEl : null
    },
    activeTrackForProject: trackCore.activeTrackForProject,
    trackDefinitionChanged: trackCore.trackDefinitionChanged,
    window: { confirm: (message) => { sandbox.calls.push(["confirm", message]); return sandbox.confirmResult; } },
    saveTrackFromForm: (...args) => { sandbox.calls.push(["save", ...args]); return sandbox.saveResult || { ok: true }; },
    closeActiveTrackManual: (id) => { sandbox.calls.push(["close", id]); },
    setTrackKind: (kind) => { sandbox.calls.push(["kind", kind]); }
  };
  vm.createContext(sandbox);
  vm.runInContext(draftSource + saveSource, sandbox);
  const numericFields = { is12WY: true, twyKind: "numeric", twyName: "読書", twyStartDate: "2026-08-24",
    twyUnit: "章", twyDeadline: "2026-11-08", twyBaseline: 0, twyGoal: 27, twyStep: 1 };
  sandbox.saveProjectTrackFromModal("p258", numericFields);
  check("新規numericは全フィールドを対応付けてsaveTrackFromFormへ渡す",
    JSON.stringify(sandbox.calls[0]) === JSON.stringify(["save", "p258", "numeric", {
      name: "読書", startDate: "2026-08-24", unit: "章", deadline: "2026-11-08",
      baselineValue: 0, goalValue: 27, valueStep: 1
    }]), JSON.stringify(sandbox.calls));

  sandbox.calls = [];
  sandbox.rows = [
    { dataset: { twyMsId: "ms-old" }, querySelector: (s) => ({ value: s.includes("label") ? "要件" : "2026-09-01" }) },
    { dataset: { twyMsId: "" }, querySelector: (s) => ({ value: s.includes("label") ? "提出" : "2026-09-20" }) }
  ];
  sandbox.saveProjectTrackFromModal("p258", { is12WY: true, twyKind: "milestone", twyName: "刊行", twyStartDate: "2026-08-24" });
  const milestoneCall = sandbox.calls.find((call) => call[0] === "save");
  check("milestoneは入力順・既存id付きでlabel/plannedDateを渡す", JSON.stringify(milestoneCall?.[3]?.milestones) === JSON.stringify([
    { id: "ms-old", label: "要件", plannedDate: "2026-09-01" }, { label: "提出", plannedDate: "2026-09-20" }
  ]), JSON.stringify(milestoneCall));

  const existing = { id: "trk-old", ownerType: "project", ownerId: "p258", kind: "numeric", unit: "章",
    status: "active", createdAt: "2026-08-01T00:00:00", deleted: false };
  sandbox.state.tracks = [existing];
  sandbox.rows = [];
  sandbox.calls = [];
  sandbox.confirmResult = false;
  check("unit変更confirm Noは保存を中断", sandbox.saveProjectTrackFromModal("p258", { ...numericFields, twyUnit: "ページ" }) === false
    && !sandbox.calls.some((call) => call[0] === "save") && sandbox.calls[0]?.[0] === "confirm", JSON.stringify(sandbox.calls));
  sandbox.calls = [];
  sandbox.confirmResult = true;
  sandbox.saveProjectTrackFromModal("p258", { ...numericFields, twyUnit: "ページ" });
  check("unit変更confirm Yesはsupersedeをデータ層へ委譲", sandbox.calls[0]?.[0] === "confirm"
    && sandbox.calls[1]?.[0] === "save" && sandbox.calls[1]?.[2] === "numeric");

  sandbox.calls = [];
  sandbox.confirmResult = false;
  check("型なしconfirm Noは元kindへ戻してProject保存を続ける", sandbox.saveProjectTrackFromModal("p258", { is12WY: true, twyKind: "none" }) === true
    && JSON.stringify(sandbox.calls.map((call) => call[0])) === JSON.stringify(["confirm", "kind"])
    && sandbox.calls[1][1] === "numeric", JSON.stringify(sandbox.calls));
  sandbox.calls = [];
  sandbox.confirmResult = true;
  check("型なしconfirm Yesはcloseだけを呼ぶ", sandbox.saveProjectTrackFromModal("p258", { is12WY: true, twyKind: "none" }) === true
    && JSON.stringify(sandbox.calls.map((call) => call[0])) === JSON.stringify(["confirm", "close"]));

  sandbox.calls = [];
  sandbox.saveResult = { ok: false, errors: ["deadline必須"] };
  errorEl.hidden = true; errorEl.textContent = "";
  check("データ層エラーは表示して保存全体を中断", sandbox.saveProjectTrackFromModal("p258", numericFields) === false
    && !errorEl.hidden && errorEl.textContent === "deadline必須");

  console.log("[2] ブラウザ上の表示・DOM局所操作・全保存経路");
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
  const TODAY = "2026-08-24", CYCLE = "2026-08-17";
  function numericTrack(extra = {}) {
    return { id: "trk-v258", ownerType: "project", ownerId: "p258", cycleStartDate: CYCLE,
      kind: "numeric", name: "読書", unit: "章", startDate: TODAY, deadline: "2026-11-08",
      baselineValue: 0, goalValue: 27, valueStep: 1, milestones: [], status: "active", closedAt: "",
      closedReason: "", supersedesTrackId: "", carriedFromTrackId: "", createdAt: `${TODAY}T00:00:00`,
      updatedAt: `${TODAY}T00:00:00`, deleted: false, ...extra };
  }
  function milestoneTrack(extra = {}) {
    return numericTrack({ kind: "milestone", name: "刊行", unit: "", deadline: "",
      baselineValue: 0, goalValue: 0, valueStep: 1, milestones: [
        { id: "ms-keep", label: "初稿", plannedDate: "2026-09-01", originalPlannedDate: "2026-08-20",
          doneAt: "2026-08-31", doneChangedAt: "2026-08-31T12:00:00", updatedAt: "2026-08-31T12:00:00", deleted: false },
        { id: "ms-delete", label: "提出", plannedDate: "2026-09-20", originalPlannedDate: "2026-09-15",
          doneAt: "", doneChangedAt: "", updatedAt: `${TODAY}T00:00:00`, deleted: false }
      ], ...extra });
  }
  async function seed({ is12WY = true, tracks = [], withAction = false, cycle = CYCLE } = {}) {
    await page.evaluate(({ key, today, cycle, is12WY, tracks, withAction }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "wbs";
      state.selectedDate = today;
      state.settings.twelveWeekStartDate = cycle;
      state.projects = [{ id: "p258", kind: "normal", title: "v258 Project", status: "active", priority: "中",
        category: "", startDate: today, dueDate: "", description: "", twelveWeekStartDate: is12WY ? cycle : "",
        showProgress: false, createdAt: `${today}T00:00:00`, updatedAt: `${today}T00:00:00`, deleted: false }];
      state.tasks = [{ id: "task-v258", projectId: "p258", title: "実行する", status: "todo", deleted: false }];
      state.blocks = withAction ? [{ id: "block-v258", taskId: "task-v258", title: "実行する", date: today,
        completed: false, migratedTo: "", deleted: false }] : [];
      state.recurrences = [];
      state.tracks = tracks;
      state.trackMeasurements = [];
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY, cycle, is12WY, tracks, withAction });
    await page.reload();
    // v329: 行の副操作は…メニュー(排他)の中。reload直後は必ず閉じているため先に開く
    // (seed()は複数回呼ばれるがそのたびreloadする・セレクタ追随・assert不変)
    await page.waitForSelector('[data-wbs-row-id="p258"] [data-action="wbs-row-menu-toggle"]');
    await page.locator('[data-wbs-row-id="p258"] [data-action="wbs-row-menu-toggle"]').first().click();
    await page.waitForTimeout(150);
    await page.waitForSelector('[data-action="edit-project"][data-id="p258"]');
    await page.locator('[data-action="edit-project"][data-id="p258"]').first().click();
    await page.waitForSelector("[data-twy-track]", { state: "attached" });
    dialogs = [];
    acceptDialog = false;
  }
  async function savedState() {
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  }
  async function selectKind(kind) { await page.locator(`[data-action="twy-kind-${kind}"]`).click(); }
  async function fillNumeric({ unit = "章", goal = "27", deadline = "2026-11-08" } = {}) {
    await page.locator('[data-modal-field="twyName"]').fill("読書");
    await page.locator('[data-modal-field="twyStartDate"]').fill(TODAY);
    await page.locator('[data-modal-field="twyBaseline"]').fill("0");
    await page.locator('[data-modal-field="twyGoal"]').fill(goal);
    await page.locator('[data-modal-field="twyUnit"]').fill(unit);
    await page.locator('[data-modal-field="twyDeadline"]').fill(deadline);
    await page.locator('[data-modal-field="twyStep"]').fill("1");
  }
  async function addMilestone(label, date) {
    await page.locator('[data-action="twy-ms-add"]').click();
    const row = page.locator(".twy-ms-edit-row").last();
    await row.locator("[data-twy-ms-label]").fill(label);
    await row.locator("[data-twy-ms-date]").fill(date);
  }

  try {
    await page.clock.setFixedTime(new Date(2026, 7, 24, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    await seed({ is12WY: false });
    check("非12WY ProjectではTRACKセクションが非表示", !(await page.locator("[data-twy-track]").isVisible()));
    await page.locator('[data-modal-field="is12WY"]').check();
    check("12WY ONで全再描画せずTRACKセクションを表示", await page.locator("[data-twy-track]").isVisible());
    await selectKind("numeric");
    check("numeric選択時は数値欄だけを表示", await page.locator("[data-twy-numeric]").isVisible()
      && !(await page.locator("[data-twy-milestone]").isVisible()));
    await page.locator('[data-modal-field="twyName"]').fill("保持する名前");
    await selectKind("milestone");
    check("milestone選択時は節目欄だけを表示", await page.locator("[data-twy-milestone]").isVisible()
      && !(await page.locator("[data-twy-numeric]").isVisible()));
    await addMilestone("要件", "2026-09-01");
    await addMilestone("提出", "2026-09-20");
    await page.locator(".twy-ms-edit-row").first().locator('[data-action="twy-ms-del"]').click();
    check("節目追加/削除は他行の入力を保持", await page.locator(".twy-ms-edit-row").count() === 1
      && await page.locator(".twy-ms-edit-row [data-twy-ms-label]").inputValue() === "提出");
    check("節目2件未満は追加粒度警告を表示", (await page.locator("[data-twy-guard]").textContent()).includes("節目が少ない"));
    await selectKind("numeric");
    check("kind往復でも共通入力値を保持", await page.locator('[data-modal-field="twyName"]').inputValue() === "保持する名前");
    await fillNumeric();
    check("行動コマ無しは粒度警告を表示するが保存ボタンは有効", await page.locator(".twy-guard-item.ng").count() >= 1
      && !(await page.locator('[data-action="modal-save"]').isDisabled()));
    await page.locator('[data-action="modal-save"]').click();
    let state = await savedState();
    let active = state.tracks.find((track) => track.ownerId === "p258" && track.status === "active");
    check("新規numericを保存しProjectも12WY化", active?.kind === "numeric" && active.name === "読書"
      && active.unit === "章" && active.baselineValue === 0 && active.goalValue === 27 && active.valueStep === 1
      && active.deadline === "2026-11-08" && state.projects[0].twelveWeekStartDate === CYCLE, JSON.stringify(active));

    await seed({ is12WY: false, cycle: "" });
    await page.locator('[data-modal-field="is12WY"]').check();
    await selectKind("numeric");
    await fillNumeric();
    await page.locator('[data-action="modal-save"]').click();
    state = await savedState();
    active = state.tracks.find((track) => track.status === "active");
    check("開始日未設定の初回12WY化は同じfallbackをProjectとtrackへ保存", active?.cycleStartDate === TODAY
      && state.projects[0].twelveWeekStartDate === TODAY && state.settings.twelveWeekStartDate === TODAY,
    JSON.stringify({ track: active?.cycleStartDate, project: state.projects[0].twelveWeekStartDate,
      setting: state.settings.twelveWeekStartDate }));

    await seed({ is12WY: false });
    await page.locator('[data-modal-field="title"]').fill("既存操作OK");
    await page.locator('[data-action="modal-save"]').click();
    state = await savedState();
    check("非12WYの既存Project保存は退行せずtrackも作らない", state.projects[0].title === "既存操作OK" && state.tracks.length === 0);

    await seed({ tracks: [numericTrack()] });
    check("既存active trackを初期表示", await page.locator('[data-modal-field="twyKind"]').inputValue() === "numeric"
      && await page.locator('[data-modal-field="twyGoal"]').inputValue() === "27");
    const unchangedTrack = JSON.stringify((await savedState()).tracks[0]);
    await page.locator('[data-modal-field="title"]').fill("Project名だけ更新");
    await page.locator('[data-action="modal-save"]').click();
    state = await savedState();
    check("track無変更保存はupdatedAtを含むtrack全体を据え置いてProject編集を保存", state.projects[0].title === "Project名だけ更新"
      && JSON.stringify(state.tracks[0]) === unchangedTrack, JSON.stringify(state.tracks[0]));

    await seed({ tracks: [numericTrack()] });
    await page.locator('[data-modal-field="twyGoal"]').fill("30");
    await page.locator('[data-modal-field="twyDeadline"]').fill("2026-11-15");
    await page.locator('[data-action="modal-save"]').click();
    state = await savedState();
    active = state.tracks.find((track) => track.status === "active");
    check("目標値/期限だけの同一編集はconfirm無し・同じtrack id", dialogs.length === 0 && active?.id === "trk-v258"
      && active.goalValue === 30 && active.deadline === "2026-11-15", JSON.stringify({ dialogs, active }));

    await seed({ tracks: [numericTrack()] });
    const beforeNo = JSON.stringify((await savedState()).tracks);
    await page.locator('[data-modal-field="twyUnit"]').fill("ページ");
    await page.locator('[data-action="modal-save"]').click();
    check("unit変更confirm Noはモーダル維持・state不変", await page.locator(".modal-root.open").count() === 1
      && JSON.stringify((await savedState()).tracks) === beforeNo && dialogs.length === 1);
    dialogs = []; acceptDialog = true;
    await page.locator('[data-action="modal-save"]').click();
    state = await savedState();
    active = state.tracks.find((track) => track.status === "active");
    check("unit変更confirm Yesはsupersede", active?.unit === "ページ" && active.supersedesTrackId === "trk-v258"
      && state.tracks.find((track) => track.id === "trk-v258")?.closedReason === "superseded");

    await seed({ tracks: [numericTrack()] });
    await selectKind("milestone");
    await addMilestone("提出", "2026-09-20");
    acceptDialog = true;
    await page.locator('[data-action="modal-save"]').click();
    state = await savedState();
    active = state.tracks.find((track) => track.status === "active");
    check("kind変更confirm Yesはmilestoneへsupersede", dialogs.length === 1 && active?.kind === "milestone"
      && active.milestones[0].label === "提出" && active.milestones[0].id && active.supersedesTrackId === "trk-v258");

    await seed({ is12WY: true });
    await selectKind("milestone");
    await addMilestone("要件", "2026-09-01");
    await addMilestone("提出", "2026-09-20");
    await page.locator('[data-action="modal-save"]').click();
    state = await savedState();
    active = state.tracks.find((track) => track.status === "active");
    check("新規milestoneは入力順・id発行付きで保存", active?.kind === "milestone"
      && active.milestones.map((m) => m.label).join(",") === "要件,提出" && active.milestones.every((m) => m.id));

    await seed({ tracks: [milestoneTrack()] });
    const keepRow = page.locator('.twy-ms-edit-row[data-twy-ms-id="ms-keep"]');
    await keepRow.locator("[data-twy-ms-label]").fill("初稿 改訂");
    await keepRow.locator("[data-twy-ms-date]").fill("2026-09-05");
    await page.locator('.twy-ms-edit-row[data-twy-ms-id="ms-delete"] [data-action="twy-ms-del"]').click();
    await page.locator('[data-action="modal-save"]').click();
    state = await savedState();
    active = state.tracks.find((track) => track.status === "active");
    const kept = active?.milestones.find((milestone) => milestone.id === "ms-keep");
    const removed = active?.milestones.find((milestone) => milestone.id === "ms-delete");
    check("既存milestoneの往復編集はid・originalPlannedDate・doneAtを保持し削除行だけtombstone化",
      active?.id === "trk-v258" && kept?.label === "初稿 改訂" && kept?.plannedDate === "2026-09-05"
      && kept?.originalPlannedDate === "2026-08-20" && kept?.doneAt === "2026-08-31"
      && kept?.doneChangedAt === "2026-08-31T12:00:00" && removed?.deleted === true,
    JSON.stringify(active?.milestones));

    await seed({ tracks: [numericTrack()] });
    await page.locator('[data-modal-field="title"]').fill("Noでも保存するタイトル");
    await selectKind("none");
    await page.locator('[data-action="modal-save"]').click();
    state = await savedState();
    check("型なしconfirm NoはProject編集を保存してtrackだけ不変", await page.locator(".modal-root.open").count() === 0
      && state.projects[0].title === "Noでも保存するタイトル" && state.tracks[0].status === "active"
      && state.tracks[0].updatedAt === `${TODAY}T00:00:00` && dialogs.length === 1);
    await seed({ tracks: [numericTrack()] });
    await selectKind("none");
    acceptDialog = true;
    await page.locator('[data-action="modal-save"]').click();
    state = await savedState();
    check("型なしconfirm Yesはmanual close", dialogs.length === 1 && state.tracks[0].status === "closed"
      && state.tracks[0].closedReason === "manual");

    await seed({ tracks: [numericTrack()] });
    await page.locator('[data-modal-field="is12WY"]').uncheck();
    acceptDialog = true;
    await page.locator('[data-action="modal-save"]').click();
    state = await savedState();
    check("v268 is12WYチェックボックス直接OFF→confirm YesでProject解除+track close",
      dialogs.length === 1 && state.projects[0].twelveWeekStartDate === ""
      && state.tracks[0].status === "closed" && state.tracks[0].closedReason === "manual");

    await seed({ is12WY: false, cycle: "" });
    await page.locator('[data-modal-field="is12WY"]').check();
    await selectKind("numeric");
    await fillNumeric({ deadline: "" });
    const beforeInvalid = JSON.stringify(await savedState());
    await page.locator('[data-action="modal-save"]').click();
    check("構造エラーは表示しモーダル維持・Project/track state不変", await page.locator("[data-twy-errors]").isVisible()
      && (await page.locator("[data-twy-errors]").textContent()).includes("deadline必須")
      && await page.locator(".modal-root.open").count() === 1 && JSON.stringify(await savedState()) === beforeInvalid);

    await seed({ is12WY: true });
    await selectKind("numeric");
    await fillNumeric({ goal: "" });
    check("目標値空欄は粒度ガード①を合格表示にしない",
      await page.locator(".twy-guard-item", { hasText: "完了条件" }).evaluate((element) => element.classList.contains("ng")));
    await selectKind("milestone");
    check("節目0件は粒度ガード⑤を合格表示にしない",
      await page.locator(".twy-guard-item", { hasText: "隣接節目" }).evaluate((element) => element.classList.contains("ng")));

    const xssPayload = '\"><img src=x onerror="window.__twyXss=true"><input data-twy-breached="';
    await seed({ tracks: [numericTrack({ startDate: xssPayload, deadline: xssPayload,
      baselineValue: xssPayload, goalValue: xssPayload, valueStep: xssPayload })] });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const escapedValues = await page.locator('[data-modal-field="twyStartDate"], [data-modal-field="twyDeadline"], [data-modal-field="twyBaseline"], [data-modal-field="twyGoal"], [data-modal-field="twyStep"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("value")));
    check("同期由来の日付・数値5フィールドは引用符とタグを属性内へ封じ込める",
      escapedValues.length === 5 && escapedValues.every((value) => value === xssPayload)
      && await page.locator("[data-twy-breached]").count() === 0
      && !(await page.evaluate(() => window.__twyXss === true)), JSON.stringify(escapedValues));
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nv258: 全件成功" : `\nv258: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
