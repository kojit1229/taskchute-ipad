// v319: TOWER見出し日本語化・文字サイズ11px下限・入力欄16px下限を実DOMで固定する。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-03";
const PREVIOUS = "2026-09-02";
const WEEK_START = "2026-08-29";
const FIXED_NOW = new Date(2026, 8, 3, 10, 0, 0, 0);
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

  const openView = async (view, selector, fixtureMode = "") => {
    const expected = await page.evaluate(({ key, viewName, today, previous, weekStart, fixtureMode }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = viewName;
      state.selectedDate = today;
      state.settings.autoSync = false;
      state.settings.lastOpenedDate = today;
      state.journals[today] = state.journals[today] || "# v319 本文";
      state.journals[previous] = state.journals[previous] || "# v319 前日";
      state.journalMeta[today] = { aiImported: false, ideal: "", textUpdatedAt: "", aiTaskCandidates: [],
        ...(state.journalMeta[today] || {}), aiRequest: "" };
      if (fixtureMode.startsWith("today")) {
        const stamp = `${today}T09:00:00`;
        state.settings.twelveWeekStartDate = weekStart;
        state.settings.twelveWeekScoreTarget = 85;
        state.projects = [];
        state.tasks = [];
        state.blocks = [];
        state.tracks = [];
        state.trackMeasurements = [];
        state.weeklyCommitments = fixtureMode === "today-score" ? [
          { id: `wcw_${weekStart}`, recordType: "week", weekStart, cycleStartDate: weekStart,
            committedAt: stamp, committedVia: "manual", selectedBlockIds: ["v319-score"],
            createdAt: stamp, updatedAt: stamp, deleted: false },
          { id: `wci_${weekStart}_v319-score`, recordType: "item", weekStart, lane: "cycle",
            blockId: "v319-score", taskId: "", projectId: "", trackId: "", title: "展開確認",
            plannedDate: today, completedAt: stamp, completedChangedAt: stamp, excused: false,
            excusedReason: "", source: "confirmed", createdAt: stamp, updatedAt: stamp, deleted: false }
        ] : [];
        if (fixtureMode === "today-banner") {
          state.projects = [{ id: "v319-project", kind: "normal", title: "12WY確認", status: "active",
            priority: "中", category: "", startDate: weekStart, dueDate: "", description: "",
            twelveWeekStartDate: weekStart, createdAt: stamp, updatedAt: stamp, deleted: false }];
          state.tasks = [{ id: "v319-task", projectId: "v319-project", parentTaskId: "", title: "候補確認",
            category: "", status: "todo", dueDate: "", description: "", progressNum: 0, progressDen: 1,
            createdAt: stamp, updatedAt: stamp, deleted: false }];
          state.blocks = [{ id: "v319-block", taskId: "v319-task", date: today, title: "未確定候補",
            plannedStartAt: `${today}T10:30`, plannedEndAt: `${today}T11:00`, completed: false,
            actualStartAt: "", actualEndAt: "", migratedTo: "", createdAt: stamp, updatedAt: stamp, deleted: false }];
        }
        state.recurrences = [{ id: "v319-gate", title: "朝の確認", category: "ルーティン", taskId: "",
          kind: "daily", startTime: "06:30", endTime: "", anchorDate: today, order: 0,
          exceptionDates: [], createdAt: stamp, updatedAt: stamp, deleted: false }];
      }
      localStorage.setItem(key, JSON.stringify(state));
      window.__v319StorageWrites = [];
      return localStorage.getItem(key);
    }, { key: STATE_KEY, viewName: view, today: TODAY, previous: PREVIOUS, weekStart: WEEK_START, fixtureMode });
    await page.reload();
    await page.waitForSelector(selector);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return {
      expected,
      actual: await page.evaluate((key) => localStorage.getItem(key), STATE_KEY),
      writes: await page.evaluate((key) => ({
        count: window.__v319StorageWrites.length,
        keys: window.__v319StorageWrites.map((w) => w.key),
        state: window.__v319StorageWrites.filter((w) => w.key === key && w.changed).length
      }), STATE_KEY)
    };
  };

  const typography = (selector) => page.locator(selector).evaluate((root) => {
    const undersizedText = [root, ...root.querySelectorAll("*")]
      .map((element) => ({
        tag: element.tagName, cls: element.className || "", text: element.textContent.trim().slice(0, 40),
        size: parseFloat(getComputedStyle(element).fontSize)
      }))
      .filter((row) => row.size < 11);
    const undersizedInputs = [...root.querySelectorAll("input, select, textarea")]
      .map((element) => ({
        tag: element.tagName, type: element.type || "", id: element.id || "", cls: element.className || "",
        size: parseFloat(getComputedStyle(element).fontSize)
      }))
      .filter((row) => row.size < 16);
    return { undersizedText, undersizedInputs };
  });

  const openAllDetails = (selector) => page.locator(selector).evaluate((root) => {
    root.querySelectorAll("details").forEach((details) => { details.open = true; });
  });

  const horizontalLayout = (selectors) => page.evaluate((targets) => ({
    pageFit: document.documentElement.scrollWidth <= window.innerWidth + 1,
    elements: targets.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return { selector, present: false };
      const rect = element.getBoundingClientRect();
      return { selector, present: true, left: rect.left, right: rect.right,
        clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, scrollLeft: element.scrollLeft,
        contentFit: element.scrollWidth <= element.clientWidth + 1 };
    })
  }), selectors);

  try {
    await page.addInitScript((key) => {
      window.__v319StorageWrites = [];
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(storageKey, value) {
        // 同値の再保存(起動時のnormalizeState→saveState)は「内容変更なし」として区別する
        if (this === localStorage) window.__v319StorageWrites.push({ key: String(storageKey), changed: this.getItem(storageKey) !== String(value) });
        return originalSetItem.call(this, storageKey, value);
      };
    }, STATE_KEY);
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] Today TOWERの日本語見出しと旧英語見出しの撤去");
    const todayState = await openView("today", ".today-tower");
    const todayHeadings = await page.locator(".today-tower").evaluate((root) => ({
      runway: root.querySelector(".tower-runway h2")?.textContent.trim() || "",
      arrivals: root.querySelector(".sec-arrivals h2")?.textContent.trim() || "",
      log: root.querySelector(".sec-log h2")?.textContent.trim() || "",
      gate: root.querySelector(".sec-gates h2")?.textContent.trim() || "",
      body: root.querySelector(".sec-bodymind h2")?.textContent.trim() || "",
      journal: root.querySelector(".sec-journal h2")?.textContent.trim() || "",
      free: root.querySelector('label[for="towerJournalFree"]')?.textContent.trim() || "",
      ai: root.querySelector('label[for="towerJournalAi"]')?.textContent.trim() || "",
      timer: root.querySelector(".today-pomodoro .today-panel-title")?.textContent.trim() || "",
      all: root.textContent
    }));
    check("日本語見出し・併記・ジャーナルラベルを描画",
      todayHeadings.runway.includes("NOW LANDING") && todayHeadings.runway.includes("いま")
      && todayHeadings.arrivals.includes("次の予定") && todayHeadings.arrivals.includes("本日")
      && todayHeadings.log.includes("やったこと") && todayHeadings.log.includes("本日の終了実績")
      && todayHeadings.gate.includes("ルーティン") && todayHeadings.body.includes("からだのきろく")
      && todayHeadings.journal.includes("ジャーナル") && todayHeadings.journal.includes("本日")
      && todayHeadings.free === "自由記述" && todayHeadings.ai === "AIに依頼すること"
      && todayHeadings.timer.includes("ポモドーロ"), JSON.stringify(todayHeadings));
    check("Today DOMに旧英語見出しが残らない",
      !/ARRIVALS|FLIGHT LOG|GATE ROUTINE|BODY \/ MIND|CABIN TIMER/.test(todayHeadings.all));

    console.log("[2] ジャーナルタブの日本語見出し");
    const journalState = await openView("journal", ".journal-tower");
    const journalHeadings = await page.locator(".journal-tower").evaluate((root) => ({
      previous: root.querySelector(".journal-panel-prev > summary")?.textContent.trim() || "",
      morning: root.querySelector(".journal-segment-morning > summary")?.textContent.trim() || "",
      evening: root.querySelector(".journal-segment-evening > summary")?.textContent.trim() || "",
      body: root.querySelector(".journal-segment-body > summary")?.textContent.trim() || "",
      all: root.textContent
    }));
    check("前日・けさ・よる・自由記述を描画",
      journalHeadings.previous.includes("前日") && journalHeadings.morning.includes("けさ")
      && journalHeadings.evening.includes("よる") && journalHeadings.body.includes("自由記述")
      && journalHeadings.body.includes("本文"), JSON.stringify(journalHeadings));
    check("ジャーナルDOMに置換対象の旧英語見出しが残らない",
      !/LOG PREV|MORNING BRIEF|NIGHT BRIEF|JOURNAL LOG/.test(journalHeadings.all));

    console.log("[3] 文字サイズ・入力欄・390px・state非書込・pageerror");
    await openAllDetails(".journal-tower");
    const journalType = await typography(".journal-tower");
    const journalLayout = await horizontalLayout([".journal-tower", ".journal-segment-evening"]);
    check("ジャーナルの全要素は11px以上", journalType.undersizedText.length === 0, JSON.stringify(journalType.undersizedText));
    check("ジャーナルのinput/select/textareaは16px以上", journalType.undersizedInputs.length === 0, JSON.stringify(journalType.undersizedInputs));
    check("全details展開済みジャーナルは390pxで横スクロールなし", journalLayout.pageFit
      && journalLayout.elements.every((element) => element.present && element.left >= -1 && element.right <= 391 && element.contentFit),
      JSON.stringify(journalLayout));
    check("ジャーナル初期描画はfixture不変・app stateキーへの内容変更書込0回", journalState.expected === journalState.actual
      && journalState.writes.state === 0, JSON.stringify({ unchanged: journalState.expected === journalState.actual, writes: journalState.writes }));

    await openView("today", ".today-tower", "today-score");
    const scoreToggle = page.locator('[data-action="twy-score-toggle"]');
    if (await scoreToggle.getAttribute("aria-expanded") !== "true") await scoreToggle.click();
    await page.waitForSelector(".twy-score-detail");
    await page.locator('[data-action="tower-gate-edit-toggle"]').click();
    await page.waitForSelector(".tower-gate-edit-row");
    await openAllDetails(".today-tower");
    const todayType = await typography(".today-tower");
    const todayLayout = await horizontalLayout([".today-tower", ".twy-score-detail", ".tower-gates",
      "#towerGateStrip", ".tower-gate-editor", ".tower-gate-edit-row"]);
    check("Today TOWERの全要素は11px以上", todayType.undersizedText.length === 0, JSON.stringify(todayType.undersizedText));
    check("Today TOWERのinput/select/textareaは16px以上", todayType.undersizedInputs.length === 0, JSON.stringify(todayType.undersizedInputs));
    check("12WY・GATE編集展開済みTodayは390pxで横スクロールなし", todayLayout.pageFit
      && todayLayout.elements.every((element) => element.present && element.left >= -1 && element.right <= 391 && element.contentFit),
      JSON.stringify(todayLayout));
    check("Today初期描画はfixture不変・app stateキーへの内容変更書込0回", todayState.expected === todayState.actual
      && todayState.writes.state === 0, JSON.stringify({ unchanged: todayState.expected === todayState.actual, writes: todayState.writes }));

    await openView("today", ".twy-commit-banner", "today-banner");
    await page.locator('[data-action="tower-gate-edit-toggle"]').click();
    await page.waitForSelector(".tower-gate-edit-row");
    await openAllDetails(".today-tower");
    const bannerType = await typography(".today-tower");
    const bannerLayout = await horizontalLayout([".today-tower", ".twy-commit-banner", ".tower-gates",
      "#towerGateStrip", ".tower-gate-editor", ".tower-gate-edit-row"]);
    check("未確定バナーを含むToday全要素は11px以上", bannerType.undersizedText.length === 0, JSON.stringify(bannerType.undersizedText));
    check("未確定バナー・GATE編集展開済みTodayは390pxで横スクロールなし", bannerLayout.pageFit
      && bannerLayout.elements.every((element) => element.present && element.left >= -1 && element.right <= 391 && element.contentFit),
      JSON.stringify(bannerLayout));
    check("pageerror 0", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ v319 ALL PASS" : `\n❌ v319: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
