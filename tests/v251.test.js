// v251由来回帰 / v285追従: 新旧AIフィードバック全文をAIレポートタブで読める。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, GITHUB_API_HOST, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const NOW = new Date(2026, 7, 27, 10, 0, 0, 0);
const TODAY = "2026-08-27";
const PREVIOUS = "2026-08-26";
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.clock.setFixedTime(NOW);
  await blockGithubApiByDefault(page);

  const latestName = `AIフィードバック_${TODAY}.md`;
  const oldName = `AIフィードバック_${PREVIOUS}.md`;
  const xssPayload = '<img data-v251-xss src="x" onerror="globalThis.__v251FeedbackXss = true"><script data-v251-script>globalThis.__v251FeedbackXss = true</script>';
  const bodies = {
    [latestName]: `# AIコーチングフィードバック ${TODAY}\n\n## サマリー\n\n- 新形式サマリー_v251\n\n## 詳細\n\n新形式全文詳細_v251\n\n${xssPayload}`,
    [oldName]: `# AIコーチングフィードバック ${PREVIOUS}\n\n## 良かった点\n\n旧形式全文_v251`
  };
  await page.route((url) => url.hostname === GITHUB_API_HOST, (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    if (/\/contents\/taskchute\/report-index\.json$/.test(pathname)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        generatedAt: "2026-08-27T01:00:00Z",
        files: [
          { name: latestName, date: TODAY, kind: "feedback" },
          { name: oldName, date: PREVIOUS, kind: "feedback" }
        ]
      }) });
    }
    if (/\/contents\/taskchute$/.test(pathname)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    const md = pathname.match(/\/contents\/taskchute\/([^/]+\.md)$/);
    if (md) return route.fulfill({ status: 200, contentType: "text/markdown", body: bodies[md[1]] || "" });
    return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "ai-reports";
      state.settings.aiReportType = "feedback";
      localStorage.setItem(key, JSON.stringify(state));
    }, STATE_KEY);
    await page.reload();
    await page.waitForFunction((marker) => document.querySelector(".md-render")?.textContent.includes(marker), "新形式全文詳細_v251");

    console.log("[1] 新形式フィードバックはサマリーと詳細を含む全文を表示する");
    check("feedbackセグメントを表示", await page.locator('[data-action="ai-report-type"][data-type="feedback"]').count() === 1);
    check("feedbackセグメントがactive", await page.locator('[data-action="ai-report-type"][data-type="feedback"].active').count() === 1);
    check("廃止済みhealthセグメントを表示しない", await page.locator('[data-action="ai-report-type"][data-type="health"]').count() === 0);
    check("廃止済みbatchセグメントを表示しない", await page.locator('[data-action="ai-report-type"][data-type="batch"]').count() === 0);
    check("本文コンテナへ読込成功とファイル名を刻印",
      await page.locator(`.md-render[data-report-file="${latestName}"][data-report-loaded="1"]`).count() === 1);
    const latestText = await page.locator(".md-render").textContent();
    check("新形式サマリーを読める", latestText.includes("新形式サマリー_v251"), latestText);
    check("新形式の詳細まで省略せず読める", latestText.includes("新形式全文詳細_v251"), latestText);
    check("feedback一覧は日付降順", JSON.stringify(await page.$$eval('[data-ai-report-date] option', (nodes) => nodes.map((node) => node.value))) === JSON.stringify([TODAY, PREVIOUS]));
    check("攻撃fixtureのscript要素/onerror属性を実DOM化しない",
      await page.locator('.md-render script[data-v251-script], .md-render [onerror]').count() === 0);
    check("攻撃fixtureのイベントコードを実行しない", await page.evaluate(() => globalThis.__v251FeedbackXss) === undefined);
    const initialReadIds = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).aiReportReadIds, STATE_KEY);
    check("初期表示した新形式ファイルを既読化", initialReadIds.includes(latestName), JSON.stringify(initialReadIds));
    check("新形式ファイルの既読IDを重複登録しない", initialReadIds.filter((name) => name === latestName).length === 1, JSON.stringify(initialReadIds));

    console.log("[2] 日付切替後も旧形式フィードバック全文を表示する");
    await page.selectOption("[data-ai-report-date]", PREVIOUS);
    await page.waitForFunction((marker) => document.querySelector(".md-render")?.textContent.includes(marker), "旧形式全文_v251");
    const oldText = await page.locator(".md-render").textContent();
    check("旧形式の見出しと本文を読める", oldText.includes("良かった点") && oldText.includes("旧形式全文_v251"), oldText);
    check("日付selectは旧形式の日付を選択済み", await page.locator("[data-ai-report-date]").inputValue() === PREVIOUS);
    check("日付切替で旧形式ファイルも既読化", await page.evaluate(({ key, name }) => JSON.parse(localStorage.getItem(key)).aiReportReadIds.includes(name), { key: STATE_KEY, name: oldName }));
    const finalReadIds = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).aiReportReadIds, STATE_KEY);
    check("新旧2ファイルの既読IDをソート保持", JSON.stringify(finalReadIds) === JSON.stringify([oldName, latestName]), JSON.stringify(finalReadIds));
    check("pageerrorなし", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
