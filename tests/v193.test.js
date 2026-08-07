// v193: 「残り時間で再プラン」B2の4操作導線(GitHub同期・AI計画・UI表示)。
const fs = require("fs");
const path = require("path");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");

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

  const now = new Date();
  now.setHours(13, 0, 0, 0);
  const pad2 = (value) => String(value).padStart(2, "0");
  const TODAY = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  let requestPayload = null;
  let responseMode = "ok";
  let releaseHeldResponse = null;
  let responseRequestedResolve = null;
  let responseRequested = null;
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
  });
  await page.route((url) => url.pathname.endsWith("/contents/taskchute/requests/replan-response.json"), async (route) => {
    responseRequestCount += 1;
    const held = responseMode === "hold-ok";
    if (held && responseRequestedResolve) responseRequestedResolve();
    if (held) await new Promise((resolve) => { releaseHeldResponse = resolve; });
    if (responseMode === "missing") {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      if (responseRequestedResolve) responseRequestedResolve();
      return;
    }
    const status = responseMode === "hold-ok" ? "ok" : responseMode;
    const response = {
      requestId: requestPayload?.requestId || "not-this-request",
      status,
      reason: status === "error" ? "worker_failed" : undefined,
      date: TODAY,
      generatedAt: `${TODAY}T13:01:00+09:00`,
      plan: status === "ok" ? [{ title: "午後を立て直す", taskId: "", start: "14:00", minutes: 30, category: "重要", reason: "残り時間を優先" }] : [],
      skipped: []
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
    if (!held && responseRequestedResolve) responseRequestedResolve();
  });

  async function resetToday(mode) {
    responseMode = mode;
    requestPayload = null;
    releaseHeldResponse = null;
    responseRequested = new Promise((resolve) => { responseRequestedResolve = resolve; });
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
    await page.waitForSelector(".today-replan [data-replan-button]");
  }

  try {
    const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
    const replanSource = appSource.slice(appSource.indexOf("function setReplanUi"), appSource.indexOf("// v67: AIプラン_"));
    check("ポーリング間隔が60秒", /REPLAN_POLL_MS\s*=\s*60\s*\*\s*1000/.test(appSource));
    check("監視上限が15分", /REPLAN_TIMEOUT_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/.test(appSource));
    check("ポーリング例外をcatchしfinallyで再予約", /catch \(error\)[\s\S]*finally/.test(replanSource));
    check("応答経路に強制遷移や無条件renderがない", !/setView\(|\brender\(\)/.test(replanSource));

    await page.clock.setFixedTime(now);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('[data-action="gate-continue"]');
    await passGithubGate(page);

    console.log("[1] 押下→受付→response→下書きバー→承認");
    await resetToday("hold-ok");
    await page.locator(".today-replan [data-replan-button]").click();
    await page.waitForFunction(() => (document.querySelector(".today-replan-status")?.textContent || "").includes("依頼受付済み・数分後に反映"));
    check("受付表示中はボタンが無効", await page.locator(".today-replan [data-replan-button]").isDisabled());
    check("push直後にはresponseを即時取得しない", responseRequestCount === 0, String(responseRequestCount));
    await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 0, 30, 0));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    check("60秒未満の復帰でも初回取得しない", responseRequestCount === 0, String(responseRequestCount));
    await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 1, 0, 0));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await responseRequested;
    check("requestIdが押下時刻ms+乱数", /^\d+-[0-9a-f]{8}$/.test(requestPayload?.requestId || ""), requestPayload?.requestId);
    check("requestのdate/requestedAt/fromTimeが契約どおり",
      requestPayload?.date === TODAY && requestPayload?.fromTime === "13:00" && typeof requestPayload?.requestedAt === "string",
      JSON.stringify(requestPayload));
    releaseHeldResponse();
    await page.waitForFunction(() => (document.querySelector(".today-replan-status")?.textContent || "").includes("下書きが届きました。タイムラインで確認してください"));
    check("応答到着後も今日ビューから強制遷移しない", await page.locator("#app[data-view='today']").count() === 1);
    const requestCountBeforeRetry = requestPutCount;
    await page.locator(".today-replan [data-replan-button]").click();
    await page.waitForFunction(() => (document.querySelector(".today-replan-status")?.textContent || "").includes("未確定の下書きがあります"));
    check("既存下書きがある間は新しいrequestを送らない", requestPutCount === requestCountBeforeRetry);
    await page.locator('#sidebar [data-action="nav"][data-view="timeline"]').click();
    await page.waitForSelector("#app[data-view='timeline'] .draft-bar");
    const draftText = await page.locator(".draft-bar").textContent();
    check("responseがai-replan下書きとして既存バーへ届く", draftText.includes("AI再プラン由来"), draftText);
    await page.locator('[data-action="draft-confirm"]').click();
    await page.waitForFunction(({ key }) => JSON.parse(localStorage.getItem(key)).blocks.some((block) => block.title === "午後を立て直す"), { key: STATE_KEY });
    check("承認でBlockが確定", true);

    console.log("[2] budget_exceeded / limit_exceeded / error の表示分岐");
    for (const mode of ["budget_exceeded", "limit_exceeded"]) {
      await resetToday(mode);
      await page.locator(".today-replan [data-replan-button]").click();
      // レース対策: request-PUT(replan-request.json)の完了を待たずにクロックを進めて
      // visibilitychangeを発火すると、テストのresponseモックがrequestPayload未設定の
      // 状態でresponseを組み立ててしまい(requestId不一致でpollが空振り→以後は再照合の
      // きっかけが無いままタイムアウト)、CI実測で断続的に失敗していた。[1]と同じく
      // 「依頼受付済み」表示(=push完了)を必ず待ってから進める。
      await page.waitForFunction(() => (document.querySelector(".today-replan-status")?.textContent || "").includes("依頼受付済み・数分後に反映"));
      await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 1, 0, 0));
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await page.waitForFunction(() => (document.querySelector(".today-replan-status")?.textContent || "").includes("本日の再プラン上限"));
      check(`${mode}で本日の上限表示`, true);
    }
    await resetToday("error");
    await page.locator(".today-replan [data-replan-button]").click();
    await page.waitForFunction(() => (document.querySelector(".today-replan-status")?.textContent || "").includes("依頼受付済み・数分後に反映"));
    await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 1, 0, 0));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction(() => (document.querySelector(".today-replan-status")?.textContent || "").includes("再プランの生成に失敗しました: worker_failed"));
    check("errorでreason付き生成失敗表示", true);

    await resetToday("ok");
    await page.locator(".today-replan [data-replan-button]").click();
    await page.waitForFunction(() => (document.querySelector(".today-replan-status")?.textContent || "").includes("依頼受付済み・数分後に反映"));
    await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 13, 1, 0, 0));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction(() => (document.querySelector(".today-replan-status")?.textContent || "").includes("日付が変わったため前日の再プランを破棄しました"));
    check("日付境界を越えた応答を破棄", true);

    console.log("[3] 15分無応答でPC起動確認を表示");
    await resetToday("missing");
    await page.locator(".today-replan [data-replan-button]").click();
    check("無応答経路もpush直後にはresponseを即時取得しない", responseRequestCount === 0, String(responseRequestCount));
    await page.waitForFunction(() => (document.querySelector(".today-replan-status")?.textContent || "").includes("依頼受付済み・数分後に反映"));
    await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 1, 0, 0));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await responseRequested;
    await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 15, 0, 0));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction(() => (document.querySelector(".today-replan-status")?.textContent || "").includes("届いていません(PC起動を確認)"));
    check("15分無応答の案内", true);

    console.log("[4] トークン未設定端末では機能に到達できず、ゲート案内を表示");
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.settings.github.token = "";
      localStorage.setItem(key, JSON.stringify(state));
    }, STATE_KEY);
    await page.reload();
    await page.waitForSelector("[data-replan-guide]");
    check("未設定ゲートには再プランボタンを表示しない", await page.locator("[data-replan-button]").count() === 0);
    check("未設定案内が表示", (await page.locator("[data-replan-guide]").textContent()).includes("GitHubトークンを設定"));
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((error) => { console.error(error); process.exit(1); });
