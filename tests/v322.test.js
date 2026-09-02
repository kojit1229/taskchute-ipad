// v322: ジャーナル自由記述の拡大とAI依頼欄の折りたたみ・既存保存契約を固定する。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-03";
const FOCUS_KEY = "taskchute-journal-today-focus-v1";
const FIXED_NOW = new Date(2026, 8, 3, 10, 0, 0, 0);
const JOURNAL_REQUEST_SECTION = [
  "### 依頼",
  "(AIへの依頼はこの見出しの下に1行1件で書いてください。例:「相場帳のバグを直して」)"
].join("\n");
let failures = 0;

function defaultJournal(date) {
  return [
    `# ${date} のジャーナル`, "", "## 🙏 感謝(3 つ)", "1. ", "2. ", "3. ", "",
    "## ✨ 今日のハイライト", "", "", "## 💡 気付き・学び", "", "",
    "## 📝 自由記述", "", "", JOURNAL_REQUEST_SECTION, ""
  ].join("\n");
}

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

  const seed = async (view, aiRequest = "") => {
    await page.evaluate(({ key, focusKey, today, view, aiRequest, journal }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = view;
      state.selectedDate = today;
      state.settings.autoSync = false;
      state.settings.lastOpenedDate = today;
      state.journals[today] = journal;
      state.journalMeta[today] = {
        aiImported: false, ideal: "", textUpdatedAt: "", aiTaskCandidates: [],
        ...(state.journalMeta[today] || {}), aiRequest
      };
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem(focusKey, JSON.stringify({
        sections: { side: true, journal: true, life: true },
        restore: { side: true, journal: true, life: true }
      }));
    }, { key: STATE_KEY, focusKey: FOCUS_KEY, today: TODAY, view, aiRequest, journal: defaultJournal(TODAY) });
    await page.reload();
    await page.waitForSelector(view === "today" ? ".today-tower" : ".journal-tower");
  };

  const switchView = async (view) => {
    await page.locator(`#bottomNav [data-action="nav"][data-view="${view}"]`).click();
    await page.waitForSelector(view === "today" ? ".today-tower" : ".journal-tower");
  };

  const inputSizes = (root) => page.locator(root).evaluate((node) =>
    [...node.querySelectorAll("input, textarea")].map((input) => ({
      id: input.id, size: parseFloat(getComputedStyle(input).fontSize)
    })));

  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] Today 390px: 自由記述40vh・AI依頼は空なら閉じる");
    await seed("today");
    const todayMobile = await page.evaluate(() => ({
      height: document.querySelector(".tower-journal-free").getBoundingClientRect().height,
      viewport: innerHeight,
      open: document.querySelector(".tower-journal-ai-fold").open,
      summary: document.querySelector(".tower-journal-ai-fold > summary").textContent.trim(),
      rows: document.querySelector(".tower-journal-ai").rows,
      aiMinHeight: parseFloat(getComputedStyle(document.querySelector(".tower-journal-ai")).minHeight)
    }));
    check("自由記述は表示高の38%以上", todayMobile.height >= todayMobile.viewport * .38, JSON.stringify(todayMobile));
    check("AI依頼はsummary表示・空なら閉・2行44px", !todayMobile.open
      && todayMobile.summary.includes("AIに依頼すること") && todayMobile.summary.includes("夜のバッチ向け")
      && todayMobile.rows === 2 && todayMobile.aiMinHeight >= 44, JSON.stringify(todayMobile));
    const todayFonts = await inputSizes(".today-tower");
    check("Todayのinput/textareaは16px以上", todayFonts.every(({ size }) => size >= 16), JSON.stringify(todayFonts));

    console.log("[2] Today: AI依頼ありなら開き、既存SAVEで2値を保存する");
    await page.locator(".tower-journal-ai-fold > summary").click();
    await page.locator("#towerJournalFree").fill("更新した自由記述");
    await page.locator("#towerJournalAi").fill("夜のバッチへ依頼");
    await page.locator('[data-action="save-tower-journal"]').click();
    await page.waitForFunction(({ key, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      return state.journals[today] === "更新した自由記述"
        && state.journalMeta[today]?.aiRequest === "夜のバッチへ依頼";
    }, { key: STATE_KEY, today: TODAY });
    check("Today保存後はAI依頼あり規則で開く", await page.locator(".tower-journal-ai-fold").evaluate((node) => node.open));
    await seed("today", "既存のAI依頼");
    check("当日AI依頼ありの初期描画は開く", await page.locator(".tower-journal-ai-fold").evaluate((node) => node.open));

    console.log("[3] Today 1280px: 右列の過半を自由記述へ割り当てる");
    await seed("today");
    await page.setViewportSize({ width: 1280, height: 900 });
    const todayPc = await page.evaluate(() => ({
      free: document.querySelector(".tower-journal-free").getBoundingClientRect().height,
      body: document.querySelector(".tower-journal-body").getBoundingClientRect().height,
      panel: document.querySelector(".tower-journal").getBoundingClientRect().height,
      right: document.querySelector(".tower-col-right").getBoundingClientRect().height,
      panelFlex: getComputedStyle(document.querySelector(".tower-journal")).flex,
      bodyFlex: getComputedStyle(document.querySelector(".tower-journal-body")).flex,
      freeFlex: getComputedStyle(document.querySelector(".tower-journal-free")).flex
    }));
    check("PC自由記述は右列高の過半", todayPc.free > todayPc.right / 2, JSON.stringify(todayPc));

    console.log("[4] ジャーナル 390px: 本文40vh・AI依頼2行・入力フォーカス維持");
    await page.setViewportSize({ width: 390, height: 844 });
    await seed("journal");
    const journalMobile = await page.evaluate(() => ({
      height: document.querySelector(".journal-free").getBoundingClientRect().height,
      viewport: innerHeight,
      open: document.querySelector(".journal-request-fold").open,
      rows: document.querySelector(".journal-ai").rows,
      aiMinHeight: parseFloat(getComputedStyle(document.querySelector(".journal-ai")).minHeight)
    }));
    check("ジャーナル本文は表示高の38%以上", journalMobile.height >= journalMobile.viewport * .38, JSON.stringify(journalMobile));
    check("ジャーナルAI依頼は空なら閉・2行44px", !journalMobile.open
      && journalMobile.rows === 2 && journalMobile.aiMinHeight >= 44, JSON.stringify(journalMobile));
    const journalFonts = await inputSizes(".journal-tower");
    check("ジャーナルのinput/textareaは16px以上", journalFonts.every(({ size }) => size >= 16), JSON.stringify(journalFonts));
    await page.locator(".journal-free").evaluate((node) => { window.__v322JournalNode = node; });
    const editedJournal = `${defaultJournal(TODAY)}\nフォーカスを保つ本文`;
    await page.locator(".journal-free").fill(editedJournal);
    const patchState = await page.evaluate(() => ({
      same: window.__v322JournalNode === document.querySelector(".journal-free"),
      focused: document.activeElement === document.querySelector(".journal-free")
    }));
    check("本文入力中は全再描画せずnodeとfocusを維持", patchState.same && patchState.focused, JSON.stringify(patchState));
    check("ジャーナル側IDはToday TOWERと重複しない", await page.locator("#journalFreeText").count() === 1
      && await page.locator("#journalAiRequest").count() === 1
      && await page.locator(".journal-tower #towerJournalFree, .journal-tower #towerJournalAi").count() === 0);

    console.log("[5] ジャーナルAI依頼は閉じたまま入力時保存し、値あり規則で再描画後に開く");
    check("ジャーナルAI依頼に専用SAVEボタンを出さない",
      await page.locator('.journal-tower [data-action="save-tower-journal"]').count() === 0);
    await page.locator(".journal-ai").evaluate((node) => {
      node.value = "ジャーナルタブから依頼";
      node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: node.value }));
    });
    await page.waitForFunction(({ key, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      return state.journalMeta[today]?.aiRequest === "ジャーナルタブから依頼";
    }, { key: STATE_KEY, today: TODAY });
    check("detailsを閉じたままAI依頼を保存", !(await page.locator(".journal-request-fold").evaluate((node) => node.open)));
    await switchView("today");
    await switchView("journal");
    check("再描画後はAI依頼あり規則で開く", await page.locator(".journal-request-fold").evaluate((node) => node.open));
    check("再描画後もAI依頼値を復元", await page.locator(".journal-ai").inputValue() === "ジャーナルタブから依頼");

    console.log("[6] AI依頼を空に戻すと閉じ、手動overrideは日付移動でリセットする");
    await page.locator(".journal-ai").fill("");
    await page.waitForFunction(({ key, today }) =>
      JSON.parse(localStorage.getItem(key)).journalMeta[today]?.aiRequest === "", { key: STATE_KEY, today: TODAY });
    await switchView("today");
    await switchView("journal");
    check("空へ戻したAI依頼は再描画後に閉じる", !(await page.locator(".journal-request-fold").evaluate((node) => node.open)));
    await page.locator(".journal-request-fold > summary").click();
    check("同一日付では手動openが有効", await page.locator(".journal-request-fold").evaluate((node) => node.open));
    await page.locator('[data-action="date-next"]').click();
    check("翌日では前日の手動overrideを無視して閉じる", !(await page.locator(".journal-request-fold").evaluate((node) => node.open)));
    await page.locator('[data-action="date-prev"]').click();
    check("元の日付へ戻っても古いoverrideは復活しない", !(await page.locator(".journal-request-fold").evaluate((node) => node.open)));

    const savedChannels = await page.evaluate(({ key, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      return { journal: state.journals[today], aiRequest: state.journalMeta[today]?.aiRequest };
    }, { key: STATE_KEY, today: TODAY });
    check("本文の### 依頼節は従来どおりstate.journalsに残る",
      savedChannels.journal.includes(JOURNAL_REQUEST_SECTION), savedChannels.journal);
    check("journalMeta.aiRequestは本文と別チャネルのまま", savedChannels.aiRequest === "");

    console.log("[7] 390px横スクロール・pageerror");
    const widths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth
    }));
    check("390px横スクロールなし", widths.scrollWidth <= widths.viewportWidth + 1, JSON.stringify(widths));
    check("pageerror 0", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\n✅ v322 ALL PASS" : `\n❌ v322: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
