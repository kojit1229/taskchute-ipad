// v269: ATISのAI表示・再プランstatus kind・CSS 40/44pxタップ標的を実DOMで検証する。
const fs = require("fs");
const path = require("path");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}

function isReddish(cssColor) {
  const [red = 0, green = 0, blue = 0] = (String(cssColor).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  return red > green * 1.35 && red > blue * 1.2;
}

(async () => {
  const injectionAnchors = [
    ["ATIS作業結果フック", "let cachedAiWorkResults = null;"],
    ["saveState計測フック", "function saveState() {"],
    ["再プランUIフック", "function stopReplanPolling() {"]
  ];
  const injectionCounts = Object.fromEntries(injectionAnchors.map(([name, anchor]) => [
    name, appSource.split(anchor).length - 1
  ]));
  for (const [name] of injectionAnchors) check(`${name}を一意に注入`, injectionCounts[name] === 1, JSON.stringify(injectionCounts));
  if (Object.values(injectionCounts).some((count) => count !== 1)) {
    throw new Error(`v269 instrumentation anchors changed: ${JSON.stringify(injectionCounts)}`);
  }
  const instrumentedApp = appSource
    .replace("let cachedAiWorkResults = null;", `let cachedAiWorkResults = null;
window.__v269SetAtisWork = (items, processedIds = []) => {
  cachedAiWorkResults = items;
  state.aiWorkProcessedIds = processedIds;
  render();
};`)
    .replace("function saveState() {", "function saveState() { window.__v269SaveCalls = (window.__v269SaveCalls || 0) + 1;")
    .replace("function stopReplanPolling() {", "window.__v269SetReplanUi = setReplanUi;\n\nfunction stopReplanPolling() {");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1024, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);
  let replanRequestPayload = null;
  let replanResponseMode = "error";
  await page.route((url) => url.pathname.endsWith("/contents/taskchute/requests/replan-request.json"), async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }
    const body = JSON.parse(route.request().postData() || "{}");
    replanRequestPayload = JSON.parse(Buffer.from(body.content || "", "base64").toString("utf8"));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "v269-request-sha" } }) });
  });
  await page.route((url) => url.pathname.endsWith("/contents/taskchute/requests/replan-response.json"), async (route) => {
    const status = replanResponseMode;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        requestId: replanRequestPayload?.requestId || "not-this-request",
        status,
        reason: status === "error" ? "v269_worker_failed" : undefined,
        date: TODAY,
        generatedAt: `${TODAY}T10:01:00+09:00`,
        plan: status === "ok" ? [{
          title: "v269 実経路の再プラン", taskId: "", start: "14:00", minutes: 30,
          category: "重要", reason: "実経路の色を固定"
        }] : [],
        skipped: []
      })
    });
  });
  await page.route(`http://localhost:${PORT}/app.js`, (route) => route.fulfill({
    status: 200, contentType: "application/javascript; charset=utf-8", body: instrumentedApp
  }));

  const now = new Date();
  now.setHours(10, 0, 0, 0);
  const pad2 = (value) => String(value).padStart(2, "0");
  const isoDate = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const TODAY = isoDate(now);
  const PREVIOUS_DAY = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const result = (id, status = "queued") => ({
    resultId: `${TODAY}__${id}`, taskId: id, title: `AI作業 ${id}`, status,
    summary: `要約 ${id}`, outputPath: "", minutes: status === "completed" ? 15 : 0
  });

  try {
    console.log("[1] 静的契約: 既知kindだけを通し、warn系トークンで色分けする");
    check("再プランkindはidleを含む7種をホワイトリスト化",
      /REPLAN_UI_KINDS\s*=\s*new Set\(\["idle", "sending", "pending", "error", "success", "limit", "timeout"\]\)/.test(appSource));
    const statusCss = stylesSource.slice(stylesSource.indexOf(".tower-atis-status"), stylesSource.indexOf("@media (max-width: 520px)"));
    check("status色分けはcyan/green/amberだけで赤トークンを使わない",
      statusCss.includes("var(--tower-cyan)") && statusCss.includes("var(--tower-green)")
      && statusCss.includes("var(--tower-amber)") && !/red|danger/i.test(statusCss), statusCss);

    await page.clock.setFixedTime(now);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.goto(`http://localhost:${PORT}/styles.css`);
    await page.evaluate(({ key, today, previousDay }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "today";
      state.selectedDate = today;
      state.feedback = { [today]: `## サマリー\n既存FB本文_v269\n## 詳細\n詳細` };
      state.journalMeta[previousDay] = {
        ...(state.journalMeta[previousDay] || {}), aiTaskCandidates: ["件数対象外の候補チップ_v269"]
      };
      state.aiLinkFreshness = { feedbackAt: today, planAt: today };
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY, previousDay: PREVIOUS_DAY });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector(".sec-atis [data-atis-status]");

    console.log("[2] 未処理バッジはAI作業結果の未処理だけを0/1/n件で数え、表示保存を行わない");
    await page.evaluate(() => { window.__v269SaveCalls = 0; window.__v269SetAtisWork([], []); });
    check("0件ではバッジを表示しない", await page.locator("[data-atis-pending-count]").count() === 0);
    check("候補チップは表示されても未処理件数へ含めない",
      await page.locator("[data-atis-task-candidates]").count() === 1 && await page.locator("[data-atis-pending-count]").count() === 0);

    await page.evaluate((item) => window.__v269SetAtisWork([item], []), result("one", "completed"));
    check("1件は件数一致で表示", (await page.locator("[data-atis-pending-count]").textContent()).trim() === "未処理 1件"
      && await page.locator(".ai-work-row").count() === 1);
    const badgeColors = await page.locator("[data-atis-pending-count]").evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--tower-amber)";
      element.parentElement.appendChild(probe);
      const amber = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(element);
      return { color: style.color, border: style.borderTopColor, amber };
    });
    check("未処理バッジはamber実色で赤系ではない", badgeColors.color === badgeColors.amber
      && badgeColors.border === badgeColors.amber
      && !isReddish(badgeColors.color) && !isReddish(badgeColors.border), JSON.stringify(badgeColors));

    const threeResults = [result("done", "completed"), result("blocked", "blocked"), result("queued")];
    await page.evaluate(({ items, processed }) => window.__v269SetAtisWork(items, processed), {
      items: threeResults, processed: [`${TODAY}__done`]
    });
    check("n件は処理済みを除いた件数と行数が一致", (await page.locator("[data-atis-pending-count]").textContent()).trim() === "未処理 2件"
      && await page.locator(".ai-work-row").count() === 2);
    check("バッジ表示3経路はsaveState 0回", await page.evaluate(() => window.__v269SaveCalls) === 0);

    console.log("[3] statusは全kindをdata-kindへ付け、不正kindをidleへフォールバックする");
    const tokenColors = await page.evaluate(() => {
      const resolved = {};
      const host = document.querySelector(".today-tower");
      for (const token of ["--tower-text", "--tower-cyan", "--tower-green", "--tower-amber"]) {
        const probe = document.createElement("span");
        probe.style.color = `var(${token})`;
        host.appendChild(probe);
        resolved[token] = getComputedStyle(probe).color;
        probe.remove();
      }
      return resolved;
    });
    const expectedTokenByKind = {
      idle: "--tower-text", sending: "--tower-cyan", pending: "--tower-cyan",
      error: "--tower-amber", success: "--tower-green", limit: "--tower-amber", timeout: "--tower-amber"
    };
    const colors = {};
    for (const kind of ["idle", "sending", "pending", "error", "success", "limit", "timeout"]) {
      await page.evaluate((value) => window.__v269SetReplanUi(value, `status ${value}`), kind);
      const status = page.locator("[data-atis-status]");
      colors[kind] = await status.evaluate((element) => getComputedStyle(element).color);
      check(`${kind}をdata-kindへ付与`, await status.getAttribute("data-kind") === kind);
      const expectedToken = expectedTokenByKind[kind];
      check(`${kind}は${expectedToken}の実色`, colors[kind] === tokenColors[expectedToken],
        JSON.stringify({ actual: colors[kind], expected: tokenColors[expectedToken], token: expectedToken }));
    }
    await page.evaluate(() => window.__v269SetReplanUi("unexpected", "未知kind"));
    check("不正kindはidleへフォールバック", await page.locator("[data-atis-status]").getAttribute("data-kind") === "idle");
    await page.evaluate(() => window.__v269SetReplanUi('evil" data-v269-injected="yes', "属性注入負例"));
    check("属性注入を狙うkindもidleへ閉じ、属性を増やさない",
      await page.locator("[data-atis-status]").getAttribute("data-kind") === "idle"
      && await page.locator("[data-v269-injected]").count() === 0);
    check("warn3種の実色は赤系でない",
      [colors.error, colors.limit, colors.timeout].every((color) => !isReddish(color)), JSON.stringify(colors));
    check("status表示更新もsaveState 0回", await page.evaluate(() => window.__v269SaveCalls) === 0);

    console.log("[4] 実際の再プラン失敗/成功分岐からfinishReplan経由のkind色を固定する");
    let replanMinute = 0;
    async function runActualReplan(mode, expectedText, expectedKind, expectedToken) {
      replanResponseMode = mode;
      replanRequestPayload = null;
      await page.locator(".sec-atis [data-replan-button]").click();
      await page.waitForFunction(() => (document.querySelector("[data-atis-status]")?.textContent || "").includes("依頼受付済み・数分後に反映"));
      replanMinute += 1;
      await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, replanMinute, 0, 0));
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await page.waitForFunction((text) => (document.querySelector("[data-atis-status]")?.textContent || "").includes(text), expectedText);
      const actual = await page.locator("[data-atis-status]").evaluate((element) => ({
        kind: element.dataset.kind,
        color: getComputedStyle(element).color
      }));
      check(`実経路${mode}は${expectedKind}/${expectedToken}色`, actual.kind === expectedKind
        && actual.color === tokenColors[expectedToken], JSON.stringify({ actual, expectedToken, tokenColors }));
    }
    await runActualReplan("error", "再プランの生成に失敗しました: v269_worker_failed", "error", "--tower-amber");
    await runActualReplan("ok", "下書きが届きました。タイムラインで確認してください", "success", "--tower-green");

    console.log("[5] チップ40px・操作ボタン44pxを1024px/390pxのcomputed styleと実寸で固定する");
    async function readTargetMetrics(width) {
      await page.setViewportSize({ width, height: 900 });
      return page.evaluate(() => ({
        chip: (() => { const el = document.querySelector(".atis-chip"); const cs = getComputedStyle(el); return { minHeight: cs.minHeight, height: el.getBoundingClientRect().height }; })(),
        chipButtons: Array.from(document.querySelectorAll(".atis-chip > button")).map((el) => ({
          minHeight: getComputedStyle(el).minHeight, height: el.getBoundingClientRect().height
        })),
        actions: Array.from(document.querySelectorAll(".atis-btn")).map((el) => ({
          minHeight: getComputedStyle(el).minHeight, height: el.getBoundingClientRect().height, fontSize: getComputedStyle(el).fontSize
        }))
      }));
    }
    for (const width of [1024, 390]) {
      const targetMetrics = await readTargetMetrics(width);
      check(`${width}pxで候補チップと内包buttonは40px以上`, targetMetrics.chip.minHeight === "40px" && targetMetrics.chip.height >= 40
        && targetMetrics.chipButtons.length === 2 && targetMetrics.chipButtons.every((metric) => metric.minHeight === "40px" && metric.height >= 40), JSON.stringify(targetMetrics));
      check(`${width}pxでATIS操作3ボタンは44px/11px`, targetMetrics.actions.length === 3
        && targetMetrics.actions.every((metric) => metric.minHeight === "44px" && metric.height >= 44 && metric.fontSize === "11px"), JSON.stringify(targetMetrics));
    }

    console.log("[6] ATIS既存DOM・data-action・表示順序を維持する");
    // [4]の実経路再プランがAI作業キャッシュを更新するため、[6]の期待DOM(ai-work-row 2件)を再seedして自己完結させる
    await page.evaluate(({ items, processed }) => window.__v269SetAtisWork(items, processed), {
      items: [result("done", "completed"), result("blocked", "blocked"), result("queued")], processed: [`${TODAY}__done`]
    });
    const dom = await page.locator("[data-atis-panel]").evaluate((panel) => {
      const body = panel.querySelector(".tower-atis-body");
      const selectors = [".ai-freshness-line", ".ai-work-row", ".tower-atis-feedback", ".tower-atis-chips", ".tower-atis-actions"];
      const nodes = selectors.map((selector) => body.querySelector(selector));
      const status = body.querySelector("[data-atis-status]");
      const directContract = [
        [".ai-freshness-line", "DIV", 1], [".ai-work-row", "DIV", 2],
        [".tower-atis-feedback", "DETAILS", 1], [".tower-atis-chips", "DIV", 1],
        [".tower-atis-actions", "DIV", 1], ["[data-atis-status]", "DIV", 1]
      ].map(([selector, tag, count]) => {
        const matches = Array.from(body.querySelectorAll(selector));
        return {
          selector, expectedTag: tag, expectedCount: count, count: matches.length,
          tags: matches.map((node) => node.tagName), direct: matches.every((node) => node.parentElement === body)
        };
      });
      return {
        panelTag: panel.tagName,
        panelDirectTags: Array.from(panel.children, (node) => node.tagName),
        headingMeta: panel.querySelector(":scope > h2 > span")?.textContent,
        present: nodes.map(Boolean),
        ordered: nodes.every((node, index) => index === 0 || !node || !nodes[index - 1]
          || Boolean(nodes[index - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)),
        directContract,
        statusIsLast: status === body.lastElementChild,
        actions: Array.from(panel.querySelectorAll(".tower-atis-actions > [data-action]"), (node) => node.dataset.action)
      };
    });
    check("鮮度/work/FB/チップ/操作ボタンの存在と順序不変", dom.present.every(Boolean) && dom.ordered, JSON.stringify(dom));
    check("ATIS panel/bodyのタグ・直親子・重複なし・status末尾を固定", dom.panelTag === "SECTION"
      && JSON.stringify(dom.panelDirectTags) === JSON.stringify(["H2", "DIV"])
      && dom.directContract.every((entry) => entry.count === entry.expectedCount && entry.direct
        && entry.tags.every((tag) => tag === entry.expectedTag))
      && dom.statusIsLast, JSON.stringify(dom));
    check("見出し補助文言と既存3 data-action不変", dom.headingMeta === "AIから"
      && JSON.stringify(dom.actions) === JSON.stringify(["ai-morning-plan", "ai-schedule", "today-replan"]), JSON.stringify(dom));
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((error) => { console.error(error); process.exit(1); });
