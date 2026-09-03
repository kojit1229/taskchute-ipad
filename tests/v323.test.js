// v323: Today TOWERの達成色・警告灯を中立化し、PCでSTANDING ORDERSをLIFE BAND行へ畳む。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const FOCUS_KEY = "taskchute-journal-today-focus-v1";
const TODAY = "2026-09-03";
const WEEK = "2026-08-29";
const CYCLE = "2026-08-15";
const FIXED_NOW = new Date(2026, 8, 3, 12, 0, 0, 0);
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}

function routineBlock(completed) {
  return {
    id: "v323-routine", taskId: "", date: TODAY, title: "朝の整え", category: "ルーティン",
    plannedStartAt: `${TODAY}T06:30:00`, plannedEndAt: `${TODAY}T06:45:00`, actualStartAt: completed ? `${TODAY}T06:30:00` : "",
    actualEndAt: completed ? `${TODAY}T06:45:00` : "", completed, deleted: false, oneTap: false,
    recurrenceGroupId: "", createdAt: `${TODAY}T00:00:00`, updatedAt: `${TODAY}T12:00:00`
  };
}

function scoreRecords(done, total) {
  const blockIds = Array.from({ length: total }, (_, index) => `v323-score-${index + 1}`);
  return [{
    id: `wcw_${WEEK}`, recordType: "week", weekStart: WEEK, cycleStartDate: CYCLE,
    committedAt: `${WEEK}T07:00:00`, committedVia: "manual", selectedBlockIds: blockIds,
    updatedAt: `${TODAY}T10:00:00`, deleted: false
  }, ...blockIds.map((blockId, index) => ({
    id: `wci_${WEEK}_${blockId}`, recordType: "item", weekStart: WEEK, lane: "cycle", blockId,
    taskId: "", projectId: "", trackId: "", title: blockId, plannedDate: WEEK,
    completedAt: index < done ? `${TODAY}T09:00:00` : "", completedChangedAt: "",
    excused: false, excusedReason: "", source: "confirmed", updatedAt: `${TODAY}T10:00:00`, deleted: false
  }))];
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);

  async function seed({ completed = false, earlyChecked = false, score = null } = {}) {
    await page.evaluate(({ stateKey, focusKey, today, cycle, completed, earlyChecked, score, block }) => {
      const state = JSON.parse(localStorage.getItem(stateKey));
      state.currentView = "today";
      state.selectedDate = today;
      state.blocks = [block];
      state.recurrences = [];
      state.earlyBird = { logs: earlyChecked ? { [today]: { checkedAt: `${today}T12:00:00` } } : {} };
      state.settings.earlyRiseTarget = "06:00";
      state.settings.twelveWeekStartDate = score ? cycle : "";
      state.weeklyCommitments = score || [];
      state.tracks = [];
      state.trackMeasurements = [];
      localStorage.setItem(stateKey, JSON.stringify(state));
      localStorage.setItem(focusKey, JSON.stringify({
        sections: { side: true, journal: true, life: true }, restore: { side: true, journal: true, life: true }
      }));
    }, { stateKey: STATE_KEY, focusKey: FOCUS_KEY, today: TODAY, cycle: CYCLE, completed, earlyChecked,
      score, block: routineBlock(completed) });
    await page.reload();
    await page.waitForSelector(".today-tower .tower-gates");
  }

  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] 遅い早起き打刻と全完了を中立表示にする");
    await seed();
    const incompleteStyle = await page.locator(".tower-gates").evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderColor, animation: style.animationName };
    });
    await page.addInitScript(() => {
      const observation = { classHistory: [], tickerCycles: 0 };
      window.__v323GateObservation = observation;
      const hasTowerGatesClass = (className) => String(className || "").split(/\s+/).includes("tower-gates");
      const recordAddedSections = (node) => {
        if (!(node instanceof Element)) return;
        [node, ...node.querySelectorAll(".tower-gates")].filter((el) => el.matches(".tower-gates")).forEach((el) => {
          observation.classHistory.push({ phase: "added", className: el.getAttribute("class") || "" });
        });
      };
      new MutationObserver((mutations) => {
        mutations.forEach((mutation, index) => {
          if (mutation.type === "childList") {
            if (mutation.target instanceof Element && mutation.target.id === "towerClock") observation.tickerCycles++;
            mutation.addedNodes.forEach(recordAddedSections);
            return;
          }
          const currentClass = mutation.target.getAttribute("class") || "";
          if (!hasTowerGatesClass(mutation.oldValue) && !hasTowerGatesClass(currentClass)) return;
          const nextMutation = mutations.slice(index + 1)
            .find((candidate) => candidate.type === "attributes" && candidate.target === mutation.target);
          observation.classHistory.push({
            phase: "class-change",
            oldClassName: mutation.oldValue || "",
            className: nextMutation ? (nextMutation.oldValue || "") : currentClass
          });
        });
      }).observe(document, { subtree: true, childList: true, attributes: true,
        attributeFilter: ["class"], attributeOldValue: true });
    });
    await seed({ completed: true, earlyChecked: true });
    await page.waitForFunction(() => window.__v323GateObservation?.tickerCycles >= 2);
    const fullStyle = await page.locator(".tower-gates").evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderColor, animation: style.animationName };
    });
    const fullObservation = await page.evaluate(() => {
      const section = document.querySelector(".tower-gates");
      const observation = window.__v323GateObservation;
      return {
        classHistory: observation?.classHistory || [],
        tickerCycles: observation?.tickerCycles || 0,
        className: section?.getAttribute("class") || "<missing>",
        animationName: section ? getComputedStyle(section).animationName : "<missing>"
      };
    });
    const forbiddenFullHistory = fullObservation.classHistory.filter((entry) =>
      /(?:^|\s)is-full(?:-flash)?(?:\s|$)/.test(`${entry.oldClassName || ""} ${entry.className || ""}`));
    check("遅い打刻でも警告DOM・⚠文字が無い", await page.locator(".tower-gate-warning").count() === 0
      && !(await page.locator(".today-tower").textContent()).includes("⚠"));
    check("再読込後2 ticker周期もis-full/is-full-flashを一度も付けず完了事実は残す", forbiddenFullHistory.length === 0
      && !/(?:^|\s)is-full(?:-flash)?(?:\s|$)/.test(fullObservation.className)
      && await page.locator(".tower-gate-alldone", { hasText: "ルーティン完了" }).count() === 1,
      `classHistory=${JSON.stringify(fullObservation.classHistory)} tickerCycles=${fullObservation.tickerCycles}`);
    check("全完了と未完了で背景・枠色が同じ、animation-nameはnone", fullStyle.background === incompleteStyle.background
      && fullStyle.border === incompleteStyle.border && fullStyle.animation === "none"
      && fullObservation.animationName === "none", JSON.stringify({ incompleteStyle, fullStyle, fullObservation }));

    console.log("[2] 12WY実行率30/70/100%を同じ中立色と事実表示にする");
    const scoreCases = [{ done: 3, total: 10, pct: 30 }, { done: 7, total: 10, pct: 70 }, { done: 10, total: 10, pct: 100 }];
    const scoreStyles = [];
    for (const fixture of scoreCases) {
      await seed({ score: scoreRecords(fixture.done, fixture.total) });
      const stateBefore = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
      const signal = page.locator('.life-band [data-action="twy-score-toggle"]');
      const text = await signal.textContent();
      await signal.click();
      await page.waitForSelector(".twy-score-detail");
      scoreStyles.push(await page.evaluate(() => ({
        signal: getComputedStyle(document.querySelector(".twy-score-signal")).color,
        bar: getComputedStyle(document.querySelector(".twy-score-bar > span")).backgroundColor,
        shadow: getComputedStyle(document.querySelector(".twy-score-bar > span")).boxShadow
      })));
      const stateAfter = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
      check(`${fixture.pct}%は数値を表示し判定語・達成class・目安線なし`, text.includes(`${fixture.done}/${fixture.total}・実行率 ${fixture.pct}%`)
        && !/要注意|遅延|軌道内/.test(await page.locator(".life-band").textContent())
        && await page.locator(".twy-score-signal.is-good, .twy-score-signal.is-mid, .twy-score-signal.is-low, .twy-score-target, .twy-score-bar > i").count() === 0);
      check(`${fixture.pct}%表示の開閉は同期stateへ書き込まない`, stateAfter === stateBefore);
    }
    check("30/70/100%の文字色・バー色は単一で発光なし", scoreStyles.every((style) =>
      style.signal === scoreStyles[0].signal && style.bar === scoreStyles[0].bar && style.shadow === "none"), JSON.stringify(scoreStyles));

    console.log("[3] PCだけLIFE BANDとSTANDING ORDERSを同じ行に畳む");
    await page.setViewportSize({ width: 1280, height: 900 });
    const desktop = await page.evaluate(() => {
      const life = document.querySelector(".tower-band1").getBoundingClientRect();
      const standing = document.querySelector(".so-row").getBoundingClientRect();
      return { life: { top: life.top, bottom: life.bottom }, standing: { top: standing.top, bottom: standing.bottom } };
    });
    check("1280pxでは両領域の縦範囲が重なる", desktop.life.top < desktop.standing.bottom
      && desktop.standing.top < desktop.life.bottom && Math.abs(desktop.life.top - desktop.standing.top) < 1, JSON.stringify(desktop));
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => {
      const life = document.querySelector(".tower-band1").getBoundingClientRect();
      const standing = document.querySelector(".so-row").getBoundingClientRect();
      return { lifeBottom: life.bottom, standingTop: standing.top, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
    });
    check("390pxではSTANDING ORDERSがLIFE BANDの下の別行", mobile.standingTop > mobile.lifeBottom, JSON.stringify(mobile));
    check("390pxで横スクロールなし", mobile.scrollWidth <= mobile.clientWidth + 1, JSON.stringify(mobile));

    console.log("[4] LIFE BAND OFF契約・pageerror・state非書込");
    const stateBeforeFocus = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await page.locator('[data-action="focus-toggle-life"]').click();
    await page.waitForSelector(".tower-band1", { state: "detached" });
    check("LIFE BAND OFFでtower-band1とso-rowが両方消える", await page.locator(".tower-band1, .so-row").count() === 0);
    check("表示切替後も同期stateへ書き込まない", await page.evaluate((key) => localStorage.getItem(key), STATE_KEY) === stateBeforeFocus);
    check("pageerror 0", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
