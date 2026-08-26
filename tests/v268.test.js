// v268: 12WYレビュー是正。未更新ペースとtolerance色をWBS/COUNTDOWNの実DOMで直接比較する。
const fs = require("fs");
const path = require("path");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}

(async () => {
  const instrumentedApp = appSource.replace("function saveState() {",
    "function saveState() { window.__v268SaveCalls = (window.__v268SaveCalls || 0) + 1;");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({
    serviceWorkers: "block", timezoneId: "Asia/Tokyo", viewport: { width: 1024, height: 900 }
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);
  await page.route(`http://localhost:${PORT}/app.js`, (route) => route.fulfill({
    status: 200, contentType: "application/javascript; charset=utf-8", body: instrumentedApp
  }));

  const TODAY = "2026-08-24", CYCLE = "2026-08-15", WEEK = "2026-08-22", NOW = `${TODAY}T10:00:00`;
  const project = (id) => ({ id, kind: "normal", title: id, status: "active", priority: "中", category: "",
    startDate: CYCLE, dueDate: "", description: "", twelveWeekStartDate: CYCLE, showProgress: false,
    collapsed: false, createdAt: NOW, updatedAt: NOW, deleted: false });
  const numericTrack = (id, ownerId) => ({ id, ownerType: "project", ownerId, cycleStartDate: CYCLE,
    kind: "numeric", name: id, unit: "章", startDate: "2026-08-17", deadline: "2026-08-31",
    baselineValue: 0, goalValue: 14, valueStep: .1, milestones: [], status: "active", closedAt: "",
    closedReason: "", createdAt: NOW, updatedAt: NOW, deleted: false });
  const milestoneTrack = (id, ownerId) => ({ ...numericTrack(id, ownerId), kind: "milestone", unit: "",
    startDate: "2026-08-01", deadline: "", baselineValue: 0, goalValue: 0, valueStep: 1,
    milestones: [
      { id: `${id}-1`, label: "初稿", plannedDate: "2026-08-25", originalPlannedDate: "2026-08-25",
        doneAt: "", doneChangedAt: "", updatedAt: NOW, deleted: false },
      { id: `${id}-2`, label: "提出", plannedDate: "2026-08-31", originalPlannedDate: "2026-08-31",
        doneAt: "", doneChangedAt: "", updatedAt: NOW, deleted: false }
    ] });
  const scored = [{ id: `wcw_${WEEK}`, recordType: "week", weekStart: WEEK, cycleStartDate: CYCLE,
    committedAt: NOW, committedVia: "manual", selectedBlockIds: ["score"], createdAt: NOW,
    updatedAt: NOW, deleted: false }, { id: `wci_${WEEK}_score`, recordType: "item", weekStart: WEEK,
    blockId: "score", taskId: "", projectId: "", trackId: "", title: "score", plannedDate: WEEK,
    source: "confirmed", lane: "cycle", completedAt: NOW, completedChangedAt: NOW, excused: false,
    excusedReason: "", excusedChangedAt: "", createdAt: NOW, updatedAt: NOW, deleted: false }];

  async function seed(track, observedAt = "", value = 0) {
    await page.evaluate(({ key, today, cycle, track, observedAt, value, scoredState }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "today";
      state.selectedDate = today;
      state.settings.twelveWeekStartDate = cycle;
      state.projects = [{ id: track.ownerId, kind: "normal", title: track.ownerId, status: "active",
        priority: "中", category: "", startDate: cycle, dueDate: "", description: "",
        twelveWeekStartDate: cycle, showProgress: false, collapsed: false,
        createdAt: `${today}T10:00:00`, updatedAt: `${today}T10:00:00`, deleted: false }];
      state.tasks = [];
      state.blocks = [];
      state.recurrences = [];
      state.tracks = [track];
      state.trackMeasurements = observedAt ? [{ id: `m-${track.id}`, trackId: track.id, value,
        observedAt, updatedAt: observedAt, deleted: false }] : [];
      state.weeklyCommitments = scoredState;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY, cycle: CYCLE, track, observedAt, value, scoredState: scored });
    await page.reload();
    await page.waitForSelector('.life-band [data-action="twy-score-toggle"]');
    await page.evaluate(() => { window.__v268SaveCalls = 0; });
  }

  async function readBoth(track) {
    const signal = page.locator('.life-band [data-action="twy-score-toggle"]');
    await signal.click();
    const countdown = page.locator(".life-band .twy-track-line");
    const result = { countdown: {
      state: await countdown.locator(".t-state").textContent(),
      pace: await countdown.locator(".t-pace").textContent(),
      cls: await countdown.locator(".t-pace").getAttribute("class")
    }, countdownSaveCalls: await page.evaluate(() => window.__v268SaveCalls || 0) };
    await page.locator('.nav-button[data-view="wbs"]').click();
    const wbs = page.locator(`.twy-row[data-twy-track-id="${track.id}"]`);
    await wbs.waitFor();
    await page.evaluate(() => { window.__v268SaveCalls = 0; });
    result.wbs = {
      state: await wbs.locator(".t-state").textContent(),
      pace: await wbs.locator(".twy-pace").textContent(),
      cls: await wbs.locator(".twy-pace").getAttribute("class")
    };
    result.wbsSaveCalls = await page.evaluate(() => window.__v268SaveCalls || 0);
    return result;
  }

  try {
    await page.clock.setFixedTime(new Date(2026, 7, 24, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] 未更新/更新済み×numeric/milestone表示と表示系saveState 0回");
    const stale = numericTrack("stale", "p-stale");
    await seed(stale, "2026-08-16T09:00:00", 3.5);
    const staleView = await readBoth(stale);
    check("未更新numericはCOUNTDOWN=不明、WBS=ペース不明で具体差を出さない",
      staleView.countdown.state === "未更新" && staleView.countdown.pace === "不明"
      && staleView.wbs.state === "未更新" && staleView.wbs.pace === "ペース不明"
      && !/[+-]\d/.test(staleView.countdown.pace), JSON.stringify(staleView));

    const current = numericTrack("current", "p-current");
    await seed(current, `${TODAY}T09:00:00`, 7);
    const currentView = await readBoth(current);
    check("更新済みnumericは両画面で状態・具体ペースを表示", currentView.countdown.state === "順調"
      && currentView.wbs.state === "順調" && currentView.countdown.pace === "0章" && currentView.wbs.pace === "0章",
    JSON.stringify(currentView));

    const milestone = milestoneTrack("milestone", "p-milestone");
    await seed(milestone);
    const milestoneView = await readBoth(milestone);
    check("milestoneは古いstartDateでも未更新にせず両画面へ表示", milestoneView.countdown.state !== "未更新"
      && milestoneView.wbs.state === milestoneView.countdown.state && milestoneView.countdown.pace === "—"
      && milestoneView.wbs.pace.includes("次:"), JSON.stringify(milestoneView));
    check("表示・展開・読取はsaveState 0回", [staleView, currentView, milestoneView]
      .every((view) => view.countdownSaveCalls === 0 && view.wbsSaveCalls === 0));

    console.log("[2] tolerance境界±1でWBS/COUNTDOWNの色を直接比較");
    const inside = numericTrack("inside", "p-inside");
    await seed(inside, `${TODAY}T09:00:00`, 4.5);
    const insideView = await readBoth(inside);
    check("-tolerance境界の内側+1は両画面pos", insideView.countdown.state === "順調"
      && insideView.wbs.state === "順調" && insideView.countdown.cls.includes("pos")
      && insideView.wbs.cls.includes("pos") && !insideView.countdown.cls.includes("neg")
      && !insideView.wbs.cls.includes("neg"), JSON.stringify(insideView));

    const outside = numericTrack("outside", "p-outside");
    await seed(outside, `${TODAY}T09:00:00`, 2.5);
    const outsideView = await readBoth(outside);
    check("-tolerance境界の外側-1は両画面neg", outsideView.countdown.state === "要注意"
      && outsideView.wbs.state === "要注意" && outsideView.countdown.cls.includes("neg")
      && outsideView.wbs.cls.includes("neg") && !outsideView.countdown.cls.includes("pos")
      && !outsideView.wbs.cls.includes("pos"), JSON.stringify(outsideView));
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\n❌ v268 tests: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\n✅ v268 tests passed");
})();
