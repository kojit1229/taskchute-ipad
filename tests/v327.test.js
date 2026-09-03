// v327: 計器盤A-2「からだ ─ 今日」と直近7日の集計・描画・非書込を固定する。
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-07";
const ROOT = path.join(__dirname, "..");
let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}${extra ? ` ${extra}` : ""}`); }
}
function row(date, sleep, steps, hrv) {
  return { date, sleep_min: sleep, bed_time: sleep === null ? null : "21:30", wake_time: sleep === null ? null : "05:04",
    steps, resting_hr: sleep === null ? null : 69, hrv_sdnn: hrv, exercise_min: steps === null ? null : 16,
    active_kcal: steps === null ? null : 439 };
}
const health = {
  schema: 1, generated_at: "2026-09-07T05:50:00+09:00", days: [
    row("2026-09-01", 300, 10000, 31), row("2026-09-02", null, null, null),
    row("2026-09-03", 320, 9000, 35), row("2026-09-04", 340, 8000, 38),
    row("2026-09-05", null, null, null), row("2026-09-06", 360, 4584, 50),
    row(TODAY, 442, 0, 68)
  ]
};
const conditionLog = (gym) => ({ sleepHours: null, meds: null, capacity: "", morningRecordedAt: "",
  eveningMood: null, eveningNote: "", eveningRecordedAt: "", gym });
const stateFixture = {
  condition: { logs: {
    "2026-09-03": conditionLog([{ id: "gym-a", exercise: "スクワット", weight: 50, reps: 10, at: "2026-09-03T18:00" }]),
    "2026-09-06": conditionLog([{ id: "gym-b", exercise: "スクワット", weight: 100, reps: 20, at: "2026-09-06T18:00" },
      { id: "gym-c", exercise: "ベンチプレス", weight: 150, reps: 10, at: "2026-09-06T18:10" }])
  } },
  bodyScans: [
    { id: "scan-a", dateTime: "2026-09-02T10:00", fatigue: 1, recovery: null, part: "", pomodoroBlockId: "" },
    { id: "scan-b", dateTime: "2026-09-04T10:00", fatigue: 2, recovery: null, part: "", pomodoroBlockId: "" },
    { id: "scan-c", dateTime: "2026-09-06T10:00", fatigue: 3, recovery: null, part: "", pomodoroBlockId: "" }
  ]
};

(async () => {
  console.log("[1] weekSummary 単体");
  const { weekSummary } = await import(pathToFileURL(path.join(ROOT, "src", "features", "instruments.js")).href);
  const summary = weekSummary(health.days, stateFixture, TODAY);
  check("睡眠平均・欠測2日", summary.sleep.average === 352.4 && summary.sleep.missing === 2, JSON.stringify(summary.sleep));
  check("歩数平均・昨日値", Math.abs(summary.steps.average - 6316.8) < .001 && summary.steps.yesterday === 4584, JSON.stringify(summary.steps));
  check("HRV最初・中央・最後", summary.hrv.first === 31 && summary.hrv.middle === 38 && summary.hrv.last === 68, JSON.stringify(summary.hrv));
  check("筋トレ2日・日別最大3500kg", summary.gym.count === 2 && summary.gym.maxKg === 3500 && summary.gym.maxDate === "2026-09-06", JSON.stringify(summary.gym));
  check("身体スキャンは記録がある日の平均・最大", summary.bodyScans.points.filter((point) => point.value !== null).length === 3
    && summary.bodyScans.average === 2 && summary.bodyScans.max === 3, JSON.stringify(summary.bodyScans));
  const noScans = weekSummary(health.days, { ...stateFixture, bodyScans: [] }, TODAY);
  check("身体スキャン全日欠測は平均null・最大null", noScans.bodyScans.average === null && noScans.bodyScans.max === null,
    JSON.stringify(noScans.bodyScans));

  console.log("[2] KPI・スパークライン・レスポンシブ・非書込");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 900 }, timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  const pageErrors = [];
  let healthBody = health;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === "api.github.com", (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    if (!pathname.endsWith("/contents/taskchute/karada/health-daily.json")) return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(healthBody) });
  });
  const seedAndReload = async (view, fixture = stateFixture) => {
    const expected = await page.evaluate(({ key, today, view, fixture }) => {
      const state = JSON.parse(localStorage.getItem(key));
      Object.assign(state, fixture, { currentView: view, selectedDate: today });
      state.settings.autoSync = false;
      state.settings.lastOpenedDate = today;
      localStorage.setItem(key, JSON.stringify(state));
      window.__v327Writes = [];
      return localStorage.getItem(key);
    }, { key: STATE_KEY, today: TODAY, view, fixture });
    const response = page.waitForResponse((item) => item.url().includes("karada/health-daily.json"));
    await page.reload();
    await response;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return { expected, actual: await page.evaluate((key) => localStorage.getItem(key), STATE_KEY),
      writes: await page.evaluate((key) => window.__v327Writes.filter((item) => item.key === key && item.changed).length, STATE_KEY) };
  };
  try {
    await page.addInitScript(() => {
      window.__v327Writes = [];
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (this === localStorage) window.__v327Writes.push({ key: String(key), changed: this.getItem(key) !== String(value) });
        return original.call(this, key, value);
      };
    });
    await page.clock.setFixedTime(new Date(2026, 8, 7, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    const todayState = await seedAndReload("today");
    await page.waitForSelector(".tower-condition-text");
    const towerComment = (await page.locator(".tower-condition-text").textContent()).trim();
    const instrumentsState = await seedAndReload("instruments");
    await page.waitForSelector(".instr-kpi");
    const kpiText = await page.locator(".instr-today").textContent();
    check("今日KPIとgenerated_at", ["7h22m", "21:30→05:04", "69", "68", "4,584", "16", "439", "Apple Health 9/7 05:50"]
      .every((text) => kpiText.includes(text)), kpiText);
    check("体調コメントはToday TOWERと同一", (await page.locator(".instr-condition-text").textContent()).trim() === towerComment,
      JSON.stringify({ towerComment, instruments: await page.locator(".instr-condition-text").textContent() }));

    const pointCounts = await page.locator(".instr-week-row").evaluateAll((rows) => Object.fromEntries(rows.map((item) => [
      item.dataset.series, item.querySelectorAll(".instr-spark-point").length
    ])));
    check("欠測を0として描かず有効日数だけ描画", pointCounts.sleep === 5 && pointCounts.steps === 5 && pointCounts.hrv === 5
      && pointCounts.gym === 2 && pointCounts.body === 3, JSON.stringify(pointCounts));
    const stepBars = await page.locator('[data-series="steps"] .instr-spark-point').evaluateAll((bars) => bars.map((bar) => ({
      date: bar.dataset.date, fill: bar.getAttribute("fill")
    })));
    check("昨日の歩数棒だけシアン", stepBars.filter((bar) => bar.fill === "#55d9e8").length === 1
      && stepBars.find((bar) => bar.fill === "#55d9e8")?.date === "2026-09-06"
      && stepBars.filter((bar) => bar.date !== "2026-09-06").every((bar) => bar.fill === "#25384d"), JSON.stringify(stepBars));

    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const week = rect(".instr-week"), continuation = rect(".instr-continuation");
        const iron = rect(".instr-iron-log"), monthly = rect(".instr-iron-chart");
        return { scroll: document.documentElement.scrollWidth, inner: innerWidth,
          bodyVisible: getComputedStyle(document.querySelector(".instr-week-body")).display !== "none",
          kpiVisible: [...document.querySelectorAll(".instr-kpi")].filter((node) => getComputedStyle(node).display !== "none").length,
          minRow: Math.min(...[...document.querySelectorAll(".instr-week-row")]
            .filter((node) => getComputedStyle(node).display !== "none").map((node) => node.getBoundingClientRect().height)),
          order: { weekTop: week.top, continuationTop: continuation.top, continuationBottom: continuation.bottom,
            ironTop: iron.top, ironBottom: iron.bottom, monthlyTop: monthly.top },
          weekMonthlyGap: monthly.top - week.bottom };
      });
      check(`${width}pxで横スクロールなし・44px行`, layout.scroll <= layout.inner + 1 && layout.minRow >= 44, JSON.stringify(layout));
      check(`${width}pxのKPI/身体スキャン表示`, layout.kpiVisible === (width >= 1280 ? 6 : 4) && layout.bodyVisible === (width >= 1280), JSON.stringify(layout));
      if (width === 1280) check("1280pxで左右の配置順・左下余白24px以内", layout.order.weekTop === layout.order.continuationTop
        && layout.order.continuationBottom < layout.order.ironTop && layout.order.ironBottom < layout.order.monthlyTop
        && layout.weekMonthlyGap >= 0 && layout.weekMonthlyGap <= 24, JSON.stringify(layout));
    }
    check("描画はstate非書込・pageerror 0", [todayState, instrumentsState].every((item) => item.expected === item.actual && item.writes === 0)
      && pageErrors.length === 0, JSON.stringify({ todayState, instrumentsState, pageErrors }));

    healthBody = { ...health, days: health.days.map((day) => day.date === TODAY ? { ...day, sleep_min: 478 } : day) };
    await seedAndReload("instruments");
    const roundedSleep = await page.locator('[data-series="sleep"] strong').textContent();
    check("睡眠平均359.6分は総分を丸めて6h00m", roundedSleep.includes("6h00m") && !roundedSleep.includes("5h60m"), roundedSleep);

    healthBody = { ...health, days: health.days.map((day) => day.date === TODAY
      ? { ...day, bed_time: "<b>21:30</b>", wake_time: "<img src=x onerror=alert(1)>05:04" } : day) };
    await seedAndReload("instruments");
    const sleepDetail = page.locator(".instr-kpi").first().locator("small");
    check("外部時刻HTMLは文字として表示", (await sleepDetail.textContent()).includes("<b>21:30</b>→<img src=x onerror=alert(1)>05:04")
      && await sleepDetail.locator("b,img").count() === 0, await sleepDetail.innerHTML());

    healthBody = { ...health, days: health.days.map((day) => day.date === TODAY ? { ...day, resting_hr: null } : day) };
    await seedAndReload("instruments");
    const restingHr = await page.locator(".instr-kpi").filter({ hasText: "安静時HR" }).textContent();
    check("部分欠測KPIは—・未記録", restingHr.includes("—") && restingHr.includes("未記録"), restingHr);

    healthBody = health;
    await seedAndReload("instruments", { ...stateFixture, bodyScans: [] });
    check("身体スキャン全日欠測は未記録", (await page.locator('[data-series="body"] strong').textContent()).trim() === "未記録");

    healthBody = { ...health, days: health.days.filter((day) => day.date !== TODAY) };
    const missingState = await seedAndReload("instruments");
    check("当日行なしはKPIなし・指定1行", await page.locator(".instr-kpi").count() === 0
      && (await page.locator(".instr-today-empty").textContent()).trim() === "今朝の睡眠データはまだありません"
      && missingState.expected === missingState.actual && missingState.writes === 0);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  const sources = ["src/features/instruments.js", "src/features/health.js"].map((file) => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");
  check('new Date(" 文字列パースなし', !/new Date\s*\(\s*["'`]/.test(sources));
  console.log(failures ? `\nv327: ${failures}件失敗` : "\nv327: 全件成功");
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
