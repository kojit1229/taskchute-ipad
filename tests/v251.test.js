// v251: ATISのAIフィードバック「## サマリー」常時表示と対象日明示。
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
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const now = new Date();
  now.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now);
  const prevDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const PREV = isoDate(prevDate);
  const TODAY_SHORT = TODAY.slice(5);
  const PREV_SHORT = PREV.slice(5);

  async function seed(feedback) {
    await page.goto(`http://localhost:${PORT}/styles.css`);
    await page.evaluate(({ KEY, feedback, TODAY }) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      state.feedback = feedback;
      state.feedbackFiles = [];
      state.selectedDate = TODAY;
      state.currentView = "today";
      localStorage.setItem(KEY, JSON.stringify(state));
    }, { KEY, feedback, TODAY });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector(".sec-atis");
  }

  try {
    await page.clock.setFixedTime(now);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] 当日FBのサマリーをescapeHTMLしてdetails直前へ常時表示する");
    const unsafe = '<img src=x onerror="window.__atisSummaryXss=1">';
    await seed({
      [TODAY]: `# AIコーチングフィードバック ${TODAY}\n\n## サマリー\n\n- 当日サマリー_v251\n- ${unsafe}\n\n## 詳細\n\n当日全文詳細_v251`,
      [PREV]: `# AIコーチングフィードバック ${PREV}\n\n## サマリー\n\n- 前日サマリー_v251\n\n## 詳細\n\n前日全文詳細_v251`
    });
    const summary = page.locator(".tower-atis-summary");
    const details = page.locator(".tower-atis-feedback");
    check("サマリー常時表示部が1つある", await summary.count() === 1);
    const summaryText = await summary.textContent();
    check("当日サマリーを選び、次の## 詳細は含めない",
      summaryText.includes("当日サマリー_v251") && !summaryText.includes("前日サマリー_v251") && !summaryText.includes("当日全文詳細_v251"), summaryText);
    check("本文直前に対象日MM-DDを表示する", summaryText.trim().startsWith(`対象日 ${TODAY_SHORT}`), summaryText);
    check("常時表示部が全文detailsの直前にある", await details.evaluate((el) => el.previousElementSibling?.classList.contains("tower-atis-summary")));
    const summaryHTML = await summary.locator(".tower-atis-summary-text").innerHTML();
    check("サマリー本文へescapeHTMLを適用する", summaryHTML.includes("&lt;img") && await summary.locator("img").count() === 0, summaryHTML);
    check("エスケープ対象が実行されない", await page.evaluate(() => window.__atisSummaryXss) === undefined);
    check("全文summaryに対象日を含める", (await details.locator(":scope > summary").textContent()).includes(`全文を読む(${TODAY_SHORT})`));

    console.log("[2] 全文detailsは従来どおり既定closedで開閉できる");
    check("detailsは既定closed", await details.getAttribute("open") === null);
    await details.locator(":scope > summary").click();
    check("クリックで全文を開ける", await details.getAttribute("open") !== null && await details.locator(".tower-atis-feedback-body").isVisible());
    await details.locator(":scope > summary").click();
    check("再クリックで全文を閉じられる", await details.getAttribute("open") === null);

    console.log("[3] サマリー節のない旧形式FBは常時表示せず全文detailsだけを残す");
    await seed({ [TODAY]: `# AIコーチングフィードバック ${TODAY}\n\n## 良かった点\n\n旧形式全文_v251` });
    check("旧形式ではサマリー常時表示部を出さない", await page.locator(".tower-atis-summary").count() === 0);
    check("旧形式でも全文detailsを残す", await page.locator(".tower-atis-feedback").count() === 1);
    check("旧形式の全文summaryにも日付を含める",
      (await page.locator(".tower-atis-feedback > summary").textContent()).includes(`全文を読む(${TODAY_SHORT})`));

    console.log("[4] 当日FBが無く前日FBだけなら前日サマリーと対象日を表示する");
    await seed({ [PREV]: `# AIコーチングフィードバック ${PREV}\n\n## サマリー\n\n- 前日だけのサマリー_v251\n\n## 詳細\n\n前日だけの全文_v251` });
    const prevSummaryText = await page.locator(".tower-atis-summary").textContent();
    check("前日サマリーを常時表示する", prevSummaryText.includes("前日だけのサマリー_v251"), prevSummaryText);
    check("前日分の本文直前に対象日MM-DDを表示する", prevSummaryText.trim().startsWith(`対象日 ${PREV_SHORT}`), prevSummaryText);
    check("前日分の全文summaryにも前日日付を含める",
      (await page.locator(".tower-atis-feedback > summary").textContent()).includes(`全文を読む(${PREV_SHORT})`));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
