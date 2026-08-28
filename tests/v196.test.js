// v196: 実行計画の叩き台をAIに作らせる(第2弾b)。タスク編集モーダルの依頼ボタン→
// plan-request.json/plan-response.jsonのポーリング(v193再プランと同じ作法)→下書き承認→
// サブタスク生成までを固定する。応答の型不正・件数超過は下書き全体を不採用にすることも固定する。
const path = require("path");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY, dispatchRegisteredAction } = require("./helpers");

const PORT = randomPort();
let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);
  let replanRequestCount = 0;
  await page.route((url) => url.pathname.endsWith("/contents/taskchute/requests/replan-request.json"), async (route) => {
    replanRequestCount += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "unexpected" } }) });
  });

  const now = new Date();
  now.setHours(10, 0, 0, 0);

  const project = {
    id: "project-v196", kind: "normal", title: "実行計画AI叩き台", category: "", status: "active",
    priority: "中", description: "", dueDate: "", twelveWeekStartDate: "",
    createdAt: "2026-08-06T08:00", updatedAt: "2026-08-06T08:00", deleted: false,
    collapsed: false, showProgress: false
  };
  function makeFixtureTask(id, title, overrides = {}) {
    return {
      id, projectId: project.id, parentTaskId: "", title, category: "仕事", status: "todo",
      dueDate: "", selfDueOff: true, order: null, description: "", progressNum: 0, progressDen: 10,
      doneCriteria: "", firstStep: "", planTarget: false, owner: "k", aiWork: false,
      aiWorkBrief: "", aiBrief: "", aiStatus: "none", handoffNote: "", aiResultRef: "",
      createdAt: "2026-08-06T09:00", updatedAt: "2026-08-06T09:00", deleted: false, collapsed: false,
      ...overrides
    };
  }

  let requestPayload = null;
  let responseMode = "ok";
  let responseSteps = null;
  let releaseHeldResponse = null;
  let responseRequestedResolve = null;
  let responseRequested = null;
  let requestPutCount = 0;
  let responseRequestCount = 0;

  await page.route((url) => url.pathname.endsWith("/contents/taskchute/requests/plan-request.json"), async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }
    requestPutCount += 1;
    const body = JSON.parse(route.request().postData() || "{}");
    requestPayload = JSON.parse(Buffer.from(body.content || "", "base64").toString("utf8"));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "request-sha" } }) });
  });
  await page.route((url) => url.pathname.endsWith("/contents/taskchute/requests/plan-response.json"), async (route) => {
    responseRequestCount += 1;
    const held = responseMode === "hold-ok" || responseMode === "hold-invalid";
    if (held) {
      // レース対策: responseRequested を解決する**前**に releaseHeldResponse を差し替える。
      // 逆順だと、テスト側が `await responseRequested` 直後に呼ぶ releaseHeldResponse が
      // 前イテレーションの解決関数(または resetState が入れた null)のままになり、
      // 今回の hold が永久に解けずタイムアウトする(実測で断続的に発生)。
      const holdReleased = new Promise((resolve) => { releaseHeldResponse = resolve; });
      if (responseRequestedResolve) responseRequestedResolve();
      await holdReleased;
    }
    if (responseMode === "missing") {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      if (responseRequestedResolve) responseRequestedResolve();
      return;
    }
    const status = held ? "ok" : responseMode;
    const steps = status === "ok" ? (responseSteps || []) : [];
    const response = {
      requestId: requestPayload?.requestId || "not-this-request",
      taskId: requestPayload?.taskId || "not-this-task",
      status,
      reason: status === "error" ? "worker_failed" : undefined,
      generatedAt: "2026-08-06T10:01:00+09:00",
      steps
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
    if (!held && responseRequestedResolve) responseRequestedResolve();
  });

  async function resetState(tasks, settings = {}, mode = "ok", steps = null) {
    responseMode = mode;
    responseSteps = steps;
    requestPayload = null;
    releaseHeldResponse = null;
    responseRequested = new Promise((resolve) => { responseRequestedResolve = resolve; });
    requestPutCount = 0;
    responseRequestCount = 0;
    await page.clock.setFixedTime(now);
    await page.evaluate(({ key, project, tasks, settings }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.projects = [project];
      state.tasks = tasks;
      state.blocks = [];
      state.currentView = "wbs";
      state.settings = {
        ...state.settings,
        wbsHideCompleted: false, wbsCategoryFilter: "", wbsEditMode: false, showSuspended: false,
        ...settings
      };
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, project, tasks, settings });
    await page.reload();
    await page.waitForSelector('#app[data-view="wbs"]');
  }

  async function advanceAndPoll(seconds) {
    await page.clock.setFixedTime(new Date(now.getTime() + seconds * 1000));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  }

  async function storedTasks() {
    return page.evaluate(({ key }) => JSON.parse(localStorage.getItem(key)).tasks, { key: STATE_KEY });
  }

  try {
    const appSource = require("fs").readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
    check("ポーリング間隔・上限がv193再プランと同じ値", /PLAN_STEP_POLL_MS\s*=\s*60\s*\*\s*1000/.test(appSource)
      && /PLAN_STEP_TIMEOUT_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/.test(appSource));

    await page.clock.setFixedTime(now);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('[data-action="gate-continue"]');
    await passGithubGate(page);

    console.log("[1] 依頼→応答→下書き表示→承認でサブタスク生成(既存サブタスクは不変)");
    const mainTask = makeFixtureTask("task-plan", "レポートを仕上げる", {
      description: "月次レポートの下書きを完成させる", doneCriteria: "上長へ提出できる状態",
      firstStep: "先月分の数値を集める", dueDate: "2026-08-10"
    });
    const existingSub = makeFixtureTask("existing-sub", "既存ステップ", { parentTaskId: mainTask.id, owner: "k", status: "doing" });
    const okSteps = [
      { title: "資料を集める", owner: "k" },
      { title: "ドラフトを書く", owner: "ai", aiBrief: "章立てに沿って初稿を書く", note: "参考資料は共有フォルダ" },
      { title: "レビューを依頼する", owner: "k" }
    ];
    await resetState([mainTask, existingSub], {}, "hold-ok", okSteps);
    await page.locator('span[data-action="edit-task"][data-id="task-plan"]').click();
    await page.waitForSelector('[data-action="plan-step-request"]');
    // レビュー必須1対応: 依頼ボタンは押下直後にモーダルを再描画する。退避なしで再描画すると
    // 「説明を書いてから📋を押す」で未保存入力が消える(実測済み)。rerenderActiveModal 経由を固定する。
    await page.locator('[data-modal-field="description"]').fill("編集中のメモ(未保存)");
    await page.locator('[data-modal-field="doneCriteria"]').fill("未保存の完了条件");
    await page.locator('[data-action="plan-step-request"]').click();
    await page.waitForFunction(() => (document.querySelector(".plan-step-request .muted")?.textContent || "").includes("依頼受付済み・数分後に反映"));
    check("依頼しても未保存の入力が消えない",
      await page.locator('[data-modal-field="description"]').inputValue() === "編集中のメモ(未保存)"
      && await page.locator('[data-modal-field="doneCriteria"]').inputValue() === "未保存の完了条件");
    check("受付表示中はボタンが無効", await page.locator('[data-action="plan-step-request"]').isDisabled());
    check("push直後にはresponseを即時取得しない", responseRequestCount === 0, String(responseRequestCount));
    await advanceAndPoll(30);
    check("60秒未満の復帰でも初回取得しない", responseRequestCount === 0, String(responseRequestCount));
    await advanceAndPoll(60);
    await responseRequested;
    check("requestId/taskId/task契約どおりに送信", /^\d+-[0-9a-f]{8}$/.test(requestPayload?.requestId || "")
      && requestPayload?.taskId === "task-plan"
      && requestPayload?.task?.title === "レポートを仕上げる"
      && requestPayload?.task?.description === "月次レポートの下書きを完成させる"
      && requestPayload?.task?.doneCriteria === "上長へ提出できる状態"
      && requestPayload?.task?.firstStep === "先月分の数値を集める"
      && requestPayload?.task?.dueDate === "2026-08-10"
      && Array.isArray(requestPayload?.task?.existingSteps)
      && requestPayload.task.existingSteps.length === 1
      && requestPayload.task.existingSteps[0].title === "既存ステップ"
      && requestPayload.task.existingSteps[0].owner === "k"
      && requestPayload.task.existingSteps[0].status === "doing",
      JSON.stringify(requestPayload));
    releaseHeldResponse();
    await page.waitForFunction(() => (document.querySelector(".plan-step-draft .field-label")?.textContent || "").includes("AIが3個のステップを提案しています"));
    check("応答到着後もWBSビューから強制遷移しない", await page.locator("#app[data-view='wbs']").count() === 1);

    console.log("[1b] 承認中は相互排他で再プラン依頼を拒む(既存排他機構に倣う)");
    await page.locator('[data-action="modal-close"]').first().click();
    await page.locator('#sidebar [data-action="nav"][data-view="today"]').click();
    await page.waitForSelector(".today-tower");
    check("再プラン操作ボタンを本番DOMへ描画しない", await page.locator('[data-action="today-replan"]').count() === 0);
    await dispatchRegisteredAction(page, "today-replan");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    check("実行計画の下書き未決定中は再プランrequestを送らない", replanRequestCount === 0, String(replanRequestCount));
    await page.locator('#sidebar [data-action="nav"][data-view="wbs"]').click();
    await page.waitForSelector('#app[data-view="wbs"]');

    console.log("[1c] 承認でサブタスク作成、既存サブタスクは不変");
    await page.locator('span[data-action="edit-task"][data-id="task-plan"]').click();
    await page.waitForFunction(() => (document.querySelector(".plan-step-draft .field-label")?.textContent || "").includes("AIが3個のステップを提案しています"));
    await page.locator('[data-action="plan-step-approve"]').click();
    await page.waitForFunction(({ key }) =>
      JSON.parse(localStorage.getItem(key)).tasks.filter((t) => t.parentTaskId === "task-plan").length === 4,
      { key: STATE_KEY });
    const afterApprove = await storedTasks();
    const parentAfter = afterApprove.find((t) => t.id === "task-plan");
    const kept = afterApprove.find((t) => t.id === "existing-sub");
    const created = afterApprove.filter((t) => t.parentTaskId === "task-plan" && t.id !== "existing-sub")
      .sort((a, b) => a.order - b.order);
    check("親のplanTargetが自動ON・updatedAtが進む", parentAfter.planTarget === true && parentAfter.updatedAt !== mainTask.updatedAt);
    // レビュー必須4対応: 承認時は既存兄弟を先に1000刻みで採番してから追加する
    // (order有りと無しの混在で siblingTaskCompare が非一貫になり、新規が既存より上に出るため)。
    // よって order と updatedAt は動く。「追加のみ=削除・改名・担当変更・順序逆転が起きない」ことを固定する。
    check("既存サブタスクは中身を変えられない(採番のみ)",
      kept.title === "既存ステップ" && kept.owner === existingSub.owner && kept.status === existingSub.status
      && kept.deleted === false);
    check("既存サブタスクは採番後も新規ステップより前に並ぶ",
      Number.isFinite(kept.order) && created.every((t) => t.order > kept.order));
    // 既存兄弟1件が先に1000へ採番されるため、新規は2000から1000刻みで続く
    check("3件のサブタスクを既存の後ろへ1000刻みで作成", created.length === 3
      && created[0].order === 2000 && created[1].order === 3000 && created[2].order === 4000,
      JSON.stringify(created.map((t) => t.order)));
    check("生成ステップに期日が付かない", created.every((t) => t.dueDate === ""),
      JSON.stringify(created.map((t) => t.dueDate)));
    check("noteは引き継ぎメモへ入る", created[1].handoffNote === "参考資料は共有フォルダ", created[1].handoffNote);
    check("kステップにはaiBriefを残さない", created[0].aiBrief === "" && created[2].aiBrief === "");
    check("owner/aiWork/aiBriefを反映", created[1].owner === "ai" && created[1].aiWork === true
      && created[1].aiBrief === "章立てに沿って初稿を書く" && created[0].owner === "k" && created[0].aiWork === false,
      JSON.stringify(created));

    console.log("[2] 破棄では何も作らない");
    const discardTask = makeFixtureTask("task-discard", "破棄用タスク");
    await resetState([discardTask], {}, "hold-ok", okSteps);
    await page.locator('span[data-action="edit-task"][data-id="task-discard"]').click();
    await page.locator('[data-action="plan-step-request"]').click();
    // レース対策: request-PUT(plan-request.json)の完了を待たずにadvanceAndPollすると、
    // responseモックがrequestPayload未設定のままrequestId/taskId不一致のresponseを
    // 組み立ててしまい、pollが空振りして以後は再照合されずタイムアウトする(CI実測)。
    // [1]と同じく「依頼受付済み」表示(=push完了)を必ず待ってから進める。
    await page.waitForFunction(() => (document.querySelector(".plan-step-request .muted")?.textContent || "").includes("依頼受付済み・数分後に反映"));
    await advanceAndPoll(60);
    await responseRequested;
    releaseHeldResponse();
    await page.waitForSelector('[data-action="plan-step-discard"]');
    await page.locator('[data-action="plan-step-discard"]').click();
    await page.waitForSelector('[data-action="plan-step-request"]');
    const afterDiscard = await storedTasks();
    check("破棄ではサブタスクを作らない", afterDiscard.filter((t) => t.parentTaskId === "task-discard").length === 0);
    check("破棄後はボタンが再度有効", !(await page.locator('[data-action="plan-step-request"]').isDisabled()));

    console.log("[3] 応答の型不正・件数超過は下書き全体を不採用にする");
    const invalidCases = [
      { name: "件数超過(8件)", steps: Array.from({ length: 8 }, (_, i) => ({ title: `s${i}`, owner: "k" })) },
      { name: "件数不足(1件)", steps: [{ title: "ひとつだけ", owner: "k" }] },
      { name: "ownerが不正値", steps: [{ title: "a", owner: "x" }, { title: "b", owner: "k" }] },
      { name: "titleが31字以上", steps: [{ title: "あ".repeat(31), owner: "k" }, { title: "b", owner: "k" }] }
    ];
    for (const [i, invalidCase] of invalidCases.entries()) {
      const task = makeFixtureTask(`task-invalid-${i}`, `不正応答${i}`);
      await resetState([task], {}, "hold-invalid", invalidCase.steps);
      await page.locator(`span[data-action="edit-task"][data-id="task-invalid-${i}"]`).click();
      await page.locator('[data-action="plan-step-request"]').click();
      // レース対策: 上の[2]と同じ理由でpush完了を待ってから進める。
      await page.waitForFunction(() => (document.querySelector(".plan-step-request .muted")?.textContent || "").includes("依頼受付済み・数分後に反映"));
      await advanceAndPoll(60);
      await responseRequested;
      releaseHeldResponse();
      await page.waitForFunction(() => (document.querySelector(".plan-step-request .muted")?.textContent || "").includes("取得に失敗しました(内容を確認してください)"));
      check(`${invalidCase.name}は下書きを作らず取得失敗表示`, await page.locator('[data-action="plan-step-approve"]').count() === 0);
      const afterInvalid = await storedTasks();
      check(`${invalidCase.name}はサブタスクも作らない`, afterInvalid.filter((t) => t.parentTaskId === `task-invalid-${i}`).length === 0);
    }

    console.log("[4] budget_exceeded / limit_exceeded / error の表示分岐");
    for (const mode of ["budget_exceeded", "limit_exceeded"]) {
      const task = makeFixtureTask(`task-${mode}`, mode);
      await resetState([task], {}, mode);
      await page.locator(`span[data-action="edit-task"][data-id="task-${mode}"]`).click();
      await page.locator('[data-action="plan-step-request"]').click();
      // レース対策: 上の[2]と同じ理由でpush完了を待ってから進める。
      await page.waitForFunction(() => (document.querySelector(".plan-step-request .muted")?.textContent || "").includes("依頼受付済み・数分後に反映"));
      await advanceAndPoll(60);
      await page.waitForFunction(() => (document.querySelector(".plan-step-request .muted")?.textContent || "").includes("本日の実行計画作成の上限"));
      check(`${mode}で本日の上限表示`, true);
    }
    const errorTask = makeFixtureTask("task-error", "error用タスク");
    await resetState([errorTask], {}, "error");
    await page.locator('span[data-action="edit-task"][data-id="task-error"]').click();
    await page.locator('[data-action="plan-step-request"]').click();
    // レース対策: 上の[2]と同じ理由でpush完了を待ってから進める。
    await page.waitForFunction(() => (document.querySelector(".plan-step-request .muted")?.textContent || "").includes("依頼受付済み・数分後に反映"));
    await advanceAndPoll(60);
    await page.waitForFunction(() => (document.querySelector(".plan-step-request .muted")?.textContent || "").includes("生成に失敗しました: worker_failed"));
    check("errorでreason付き生成失敗表示", true);

    console.log("[5] 15分無応答でPC起動確認を表示");
    const missingTask = makeFixtureTask("task-missing", "無応答用タスク");
    await resetState([missingTask], {}, "missing");
    await page.locator('span[data-action="edit-task"][data-id="task-missing"]').click();
    await page.locator('[data-action="plan-step-request"]').click();
    // レース対策: 上の[2]と同じ理由でpush完了を待ってから進める。
    await page.waitForFunction(() => (document.querySelector(".plan-step-request .muted")?.textContent || "").includes("依頼受付済み・数分後に反映"));
    await advanceAndPoll(60);
    await responseRequested;
    await advanceAndPoll(15 * 60);
    await page.waitForFunction(() => (document.querySelector(".plan-step-request .muted")?.textContent || "").includes("届いていません(PC起動を確認)"));
    check("15分無応答の案内", true);

    console.log("[6] トークン未設定端末では機能に到達できず、ゲート案内を表示(既存ゲートと同じ)");
    const noTokenTask = makeFixtureTask("task-no-token", "トークン未設定用タスク");
    await resetState([noTokenTask]);
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.settings.github.token = "";
      localStorage.setItem(key, JSON.stringify(state));
    }, STATE_KEY);
    await page.reload();
    await page.waitForSelector("[data-replan-guide]");
    check("未設定ゲートには実行計画ボタンを表示しない", await page.locator('[data-action="plan-step-request"]').count() === 0);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((error) => { console.error(error); process.exit(1); });
