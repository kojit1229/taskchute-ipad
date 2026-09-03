// v324: AI依頼入力欄を撤去し、本文の「### 依頼」節へ一本化する。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-03";
const FOCUS_KEY = "taskchute-journal-today-focus-v1";
const OLD_REQUEST = "旧依頼";
const REQUEST_GUIDE = "AIへの依頼は本文の『### 依頼』見出しの下に書く";
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({
    serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo"
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);

  const stateNow = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  const assertAiUiAbsent = async (screen) => {
    const count = await page.locator("#towerJournalAi, #journalAiRequest, .tower-journal-ai-fold, .journal-request-fold").count();
    check(`${screen}に旧AI依頼UIがない`, count === 0, String(count));
  };

  try {
    await page.clock.setFixedTime(new Date(2026, 8, 3, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.evaluate(({ key, focusKey, today, oldRequest }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "today";
      state.selectedDate = today;
      state.settings.autoSync = false;
      state.settings.lastOpenedDate = today;
      state.journals[today] = `# ${today} のジャーナル\n\n### 依頼\n本文経由の依頼`;
      state.journalMeta[today] = {
        aiImported: false, ideal: "", textUpdatedAt: "2026-09-03T08:00:00",
        aiTaskCandidates: [], aiRequest: oldRequest
      };
      state.blocks = [];
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem(focusKey, JSON.stringify({
        sections: { side: true, journal: true, life: true },
        restore: { side: true, journal: true, life: true }
      }));
    }, { key: STATE_KEY, focusKey: FOCUS_KEY, today: TODAY, oldRequest: OLD_REQUEST });
    await page.reload();
    await page.waitForSelector(".today-tower #towerJournalFree");

    console.log("[1][2] Today: 旧AI依頼UIなし・既存state非破壊");
    await assertAiUiAbsent("Today");
    check("Todayの案内placeholder", (await page.locator("#towerJournalFree").getAttribute("placeholder")).includes(REQUEST_GUIDE));
    check("Today描画後も旧aiRequestを保持", (await stateNow()).journalMeta[TODAY].aiRequest === OLD_REQUEST);

    console.log("[3] Today SAVE: 本文だけを保存しaiRequestを変更しない");
    const towerBody = `# ${TODAY} のジャーナル\n\n### 依頼\nTOWER本文から依頼`;
    await page.locator("#towerJournalFree").fill(towerBody);
    await page.locator('[data-action="save-tower-journal"]').click();
    await page.waitForFunction(({ key, today, body, oldRequest }) => {
      const state = JSON.parse(localStorage.getItem(key));
      return state.journals[today] === body
        && state.journalMeta[today]?.aiRequest === oldRequest
        && state.journalMeta[today]?.textUpdatedAt !== "2026-09-03T08:00:00";
    }, { key: STATE_KEY, today: TODAY, body: towerBody, oldRequest: OLD_REQUEST });

    console.log("[1][2] ジャーナル: 旧AI依頼UIなし・既存state非破壊");
    await page.locator('#bottomNav [data-action="nav"][data-view="journal"]').click();
    await page.waitForSelector(".journal-tower #journalFreeText");
    await assertAiUiAbsent("ジャーナル");
    check("ジャーナルの案内placeholder", (await page.locator("#journalFreeText").getAttribute("placeholder")).includes(REQUEST_GUIDE));
    check("ジャーナル描画後も旧aiRequestを保持", (await stateNow()).journalMeta[TODAY].aiRequest === OLD_REQUEST);

    console.log("[4] 既定テンプレの### 依頼と日報への本文掲載");
    await page.evaluate(({ key, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "journal";
      state.selectedDate = today;
      state.settings.journalTemplate = "";
      delete state.journals[today];
      delete state.reports[today];
      state.blocks = [];
      state.writeMeditations = [{
        id: `wm_${today}`, date: today, discharge: [],
        charge: [{ id: "c_v324", text: "テスト済み" }],
        dischargeTalk: "", chargeTalk: "", updatedAt: `${today}T09:00:00`, deleted: false
      }];
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY });
    await page.reload();
    await page.waitForSelector(".journal-tower #journalFreeText");
    const defaultBody = await page.locator("#journalFreeText").inputValue();
    check("既定テンプレに### 依頼節がある", defaultBody.includes("### 依頼"), defaultBody);
    const bodyWithRequest = `${defaultBody.trimEnd()}\n本文テンプレ経由の依頼`;
    await page.locator("#journalFreeText").fill(bodyWithRequest);
    await page.waitForFunction(({ key, today, body, oldRequest }) => {
      const state = JSON.parse(localStorage.getItem(key));
      return state.journals[today] === body && state.journalMeta[today]?.aiRequest === oldRequest;
    }, { key: STATE_KEY, today: TODAY, body: bodyWithRequest, oldRequest: OLD_REQUEST });
    await page.locator('[data-action="generate-report"]').click();
    await page.waitForFunction(({ key, today }) => Boolean(JSON.parse(localStorage.getItem(key)).reports[today]), { key: STATE_KEY, today: TODAY });
    const report = (await stateNow()).reports[TODAY];
    check("日報のジャーナル節へ### 依頼と本文依頼が載る",
      report.includes("## 8. ジャーナル") && report.includes("### 依頼") && report.includes("本文テンプレ経由の依頼"), report);

    console.log("[5] 390px・pageerror");
    const widths = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
    check("390px横スクロールなし", widths.scrollWidth <= widths.viewportWidth + 1, JSON.stringify(widths));
    check("pageerror 0", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\n✅ v324 ALL PASS" : `\n❌ v324: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
