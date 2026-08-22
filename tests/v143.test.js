// v143 回帰検証: Home「AIから」カードと、撤去済みAIフィードバック手動取込UI。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  try {
    await page.clock.setFixedTime(new Date(2026, 6, 31, 20, 0, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    console.log("[1] Home『AIから』カードがstate.feedbackを表示する");
    const PREV = "2026-07-30";
    await page.evaluate(({ KEY, PREV }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = [];
      s.feedback = { [PREV]: "## 明日への提案\n\n- [ ] v143回帰確認用マーカー\n" };
      s.feedbackFiles = [PREV];
      s.selectedDate = "2026-07-31";
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, PREV });
    await page.reload();
    await page.waitForTimeout(700);
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(150);
    check("ホーム『AIから』の本文閲覧detailsが出る", await page.locator(".home-ai-feedback-read").count() === 1);
    const homeText = await page.locator("main").textContent();
    check("state.feedback由来の前日フィードバック本文が読める",
      homeText.includes("v143回帰確認用マーカー"), homeText.slice(0, 300));

    console.log("[2] 撤去済みのAIフィードバック手動取込UIが出ない");
    await page.click('[data-action="nav"][data-view="journal"]');
    await page.waitForTimeout(300);
    check(".mdアップロード欄が無い", await page.locator("input[data-feedback-upload]").count() === 0);
    check("data-feedback-date欄が無い", await page.locator("[data-feedback-date]").count() === 0);
    check("AI返信から取り込みボタンが無い", await page.locator('[data-action="journal-import-ai"]').count() === 0);

    console.log(failures === 0 ? "\n✅ v143 ALL PASS" : `\n❌ v143: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }

  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
