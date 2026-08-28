// v193由来回帰 / v285追従: 再プラン内部契約と全response分岐を、廃止済みUIを戻さず検証する。
const fs = require("fs");
const path = require("path");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY, dispatchRegisteredAction
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1300 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const replanUiAssignment = '  _replanUi = { kind: REPLAN_UI_KINDS.has(kind) ? kind : "idle", message };';
  const instrumentedAppSource = appSource.replace(
    replanUiAssignment,
    `${replanUiAssignment}\n  globalThis.__v193ReplanUi = { ..._replanUi };`
  );
  await page.route((url) => url.pathname.endsWith("/app.js"), (route) => route.fulfill({
    status: 200, contentType: "text/javascript", body: instrumentedAppSource
  }));

  const now = new Date();
  now.setHours(13, 0, 0, 0);
  const pad2 = (value) => String(value).padStart(2, "0");
  const TODAY = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  let requestPayload = null;
  let responseMode = "ok";
  let releaseHeldResponse = null;
  let responseRequestedResolve = null;
  let responseRequested = null;
  let requestPutResolve = null;
  let requestPut = null;
  let requestPutCount = 0;
  let responseRequestCount = 0;

  await page.route((url) => url.pathname.endsWith("/contents/taskchute/requests/replan-request.json"), async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }
    requestPutCount += 1;
    const body = JSON.parse(route.request().postData() || "{}");
    requestPayload = JSON.parse(Buffer.from(body.content || "", "base64").toString("utf8"));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "request-sha" } }) });
    requestPutResolve?.();
  });
  await page.route((url) => url.pathname.endsWith("/contents/taskchute/requests/replan-response.json"), async (route) => {
    responseRequestCount += 1;
    const held = responseMode === "hold-ok";
    if (held) responseRequestedResolve?.();
    if (held) await new Promise((resolve) => { releaseHeldResponse = resolve; });
    if (responseMode === "missing") {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      responseRequestedResolve?.();
      return;
    }
    const status = held ? "ok" : responseMode;
    const response = {
      requestId: requestPayload?.requestId || "not-this-request",
      status,
      reason: status === "error" ? "worker_failed" : undefined,
      date: TODAY,
      generatedAt: `${TODAY}T13:01:00+09:00`,
      plan: status === "ok"
        ? [{ title: "午後を立て直す", taskId: "", start: "14:00", minutes: 30, category: "重要", reason: "残り時間を優先" }]
        : [],
      skipped: []
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
    if (!held) responseRequestedResolve?.();
  });

  async function resetToday(mode) {
    responseMode = mode;
    requestPayload = null;
    releaseHeldResponse = null;
    responseRequested = new Promise((resolve) => { responseRequestedResolve = resolve; });
    requestPut = new Promise((resolve) => { requestPutResolve = resolve; });
    requestPutCount = 0;
    responseRequestCount = 0;
    await page.clock.setFixedTime(now);
    await page.evaluate(({ key, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "today";
      state.selectedDate = today;
      state.blocks = [];
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY });
    await page.reload();
    await page.waitForSelector(".today-tower");
  }

  async function dispatchReplanAndWaitForRequest() {
    await dispatchRegisteredAction(page, "today-replan");
    await requestPut;
    await page.waitForFunction(() => globalThis.__v193ReplanUi?.kind === "pending");
  }

  async function pollAt(hour, minute, dayOffset = 0) {
    await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute, 0, 0));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  }

  async function assertNoDraft(label) {
    await page.locator('#sidebar [data-action="nav"][data-view="timeline"]').click();
    await page.waitForSelector("#app[data-view='timeline']");
    check(`${label}で下書きバーを作らない`, await page.locator(".draft-bar, .draft-block").count() === 0);
    await page.locator('#sidebar [data-action="nav"][data-view="today"]').click();
    await page.waitForSelector("#app[data-view='today']");
  }

  try {
    const replanSource = appSource.slice(appSource.indexOf("function setReplanUi"), appSource.indexOf("// v67: AIプラン_"));
    check("setReplanUiのテスト計測器を注入", instrumentedAppSource !== appSource);
    check("ポーリング間隔が60秒", /REPLAN_POLL_MS\s*=\s*60\s*\*\s*1000/.test(appSource));
    check("監視上限が15分", /REPLAN_TIMEOUT_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/.test(appSource));
    check("ポーリング例外をcatchしfinallyで再予約", /catch \(error\)[\s\S]*finally/.test(replanSource));
    check("応答経路に強制遷移や無条件renderがない", !/setView\(|\brender\(\)/.test(replanSource));

    await page.clock.setFixedTime(now);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] 委譲action→受付→ok response→既存下書きバー→承認");
    await resetToday("hold-ok");
    check("再プラン操作ボタンを本番DOMへ描画しない", await page.locator('[data-action="today-replan"]').count() === 0);
    await dispatchReplanAndWaitForRequest();
    check("requestを1回だけPUT", requestPutCount === 1, String(requestPutCount));
    check("push直後にはresponseを即時取得しない", responseRequestCount === 0, String(responseRequestCount));
    check("内部statusはpending", (await page.evaluate(() => globalThis.__v193ReplanUi))?.kind === "pending");
    await pollAt(13, 0);
    check("60秒未満の復帰でも初回取得しない", responseRequestCount === 0, String(responseRequestCount));
    await pollAt(13, 1);
    await responseRequested;
    check("60秒到達後にresponseを取得", responseRequestCount === 1, String(responseRequestCount));
    check("requestIdが押下時刻ms+乱数", /^\d+-[0-9a-f]{8}$/.test(requestPayload?.requestId || ""), requestPayload?.requestId);
    check("requestのdate/requestedAt/fromTimeが契約どおり",
      requestPayload?.date === TODAY && requestPayload?.fromTime === "13:00" && typeof requestPayload?.requestedAt === "string",
      JSON.stringify(requestPayload));
    releaseHeldResponse();
    await page.waitForFunction(() => globalThis.__v193ReplanUi?.kind === "success");
    check("ok応答後もtodayから強制遷移しない", await page.locator("#app[data-view='today']").count() === 1);
    const requestCountBeforeRetry = requestPutCount;
    await dispatchRegisteredAction(page, "today-replan");
    await page.waitForFunction(() => globalThis.__v193ReplanUi?.message.includes("未確定の下書き"));
    check("既存下書きがある間は新しいrequestを送らない", requestPutCount === requestCountBeforeRetry);
    await page.locator('#sidebar [data-action="nav"][data-view="timeline"]').click();
    await page.waitForSelector("#app[data-view='timeline'] .draft-bar");
    const draftText = await page.locator(".draft-bar").textContent();
    check("responseがai-replan下書きとして既存バーへ届く", draftText.includes("AI再プラン由来"), draftText);
    await page.locator('[data-action="draft-confirm"]').click();
    await page.waitForFunction(({ key }) => JSON.parse(localStorage.getItem(key)).blocks.some((block) => block.title === "午後を立て直す"), { key: STATE_KEY });
    check("承認でBlockが確定", true);

    console.log("[2] budget_exceeded / limit_exceeded は上限を強制し下書きを作らない");
    for (const mode of ["budget_exceeded", "limit_exceeded"]) {
      await resetToday(mode);
      await dispatchReplanAndWaitForRequest();
      await pollAt(13, 1);
      await responseRequested;
      await page.waitForFunction(() => globalThis.__v193ReplanUi?.kind === "limit");
      const limitUi = await page.evaluate(() => globalThis.__v193ReplanUi);
      check(`${mode}をlimit分岐へ送る`, limitUi.kind === "limit", JSON.stringify(limitUi));
      check(`${mode}で本日の上限契約を維持`, limitUi.message.includes("本日の再プラン上限"), JSON.stringify(limitUi));
      await assertNoDraft(mode);
    }

    console.log("[3] error responseはreasonを保持し下書きを作らない");
    await resetToday("error");
    await dispatchReplanAndWaitForRequest();
    await pollAt(13, 1);
    await responseRequested;
    await page.waitForFunction(() => globalThis.__v193ReplanUi?.kind === "error");
    const errorUi = await page.evaluate(() => globalThis.__v193ReplanUi);
    check("error応答をerror分岐へ送る", errorUi.kind === "error", JSON.stringify(errorUi));
    check("errorでworker reasonを保持", errorUi.message.includes("worker_failed"), JSON.stringify(errorUi));
    check("error応答後もtodayから強制遷移しない", await page.locator("#app[data-view='today']").count() === 1);
    await assertNoDraft("error応答");

    console.log("[4] 日付境界を越えた応答を破棄し下書きを作らない");
    await resetToday("ok");
    await dispatchReplanAndWaitForRequest();
    await pollAt(13, 1, 1);
    await responseRequested;
    await page.waitForFunction(() => globalThis.__v193ReplanUi?.message.includes("日付が変わった"));
    const rolloverUi = await page.evaluate(() => globalThis.__v193ReplanUi);
    check("日付境界破棄はerror分岐", rolloverUi.kind === "error", JSON.stringify(rolloverUi));
    check("日付境界破棄の理由を保持", rolloverUi.message.includes("前日の再プランを破棄"), JSON.stringify(rolloverUi));
    await assertNoDraft("日付境界応答");

    console.log("[5] 15分無応答でtimeoutへ遷移し下書きを作らない");
    await resetToday("missing");
    await dispatchReplanAndWaitForRequest();
    check("無応答経路もpush直後にはresponseを取得しない", responseRequestCount === 0, String(responseRequestCount));
    await pollAt(13, 1);
    await responseRequested;
    check("無応答経路は最初のpollを実行", responseRequestCount === 1, String(responseRequestCount));
    await pollAt(13, 15);
    await page.waitForFunction(() => globalThis.__v193ReplanUi?.kind === "timeout");
    const timeoutUi = await page.evaluate(() => globalThis.__v193ReplanUi);
    check("15分無応答をtimeout分岐へ送る", timeoutUi.kind === "timeout", JSON.stringify(timeoutUi));
    check("timeoutでPC起動確認の案内を維持", timeoutUi.message.includes("PC起動を確認"), JSON.stringify(timeoutUi));
    await assertNoDraft("15分無応答");

    console.log("[6] トークン未設定端末はゲートで機能に到達できない");
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.settings.github.token = "";
      localStorage.setItem(key, JSON.stringify(state));
    }, STATE_KEY);
    await page.reload();
    await page.waitForSelector("[data-replan-guide]");
    check("未設定ゲートには再プランボタンを表示しない", await page.locator('[data-action="today-replan"]').count() === 0);
    check("未設定案内を表示", (await page.locator("[data-replan-guide]").textContent()).includes("GitHubトークンを設定"));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
