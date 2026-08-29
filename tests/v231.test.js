// v231: 日報の「12週 今週の進捗」へ、topband.jsを単一正本とするWeek n/12を追加。
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY, generateReportThroughGate } = require("./helpers");

const PORT = randomPort();
const REPORT_DATE = "2026-08-22";
const CYCLE_START = "2026-08-08";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const topband = await import(pathToFileURL(path.join(__dirname, "../src/features/topband.js")).href);
  let settings = { twelveWeekStartDate: "2026-08-08" };
  topband.configureTopband({
    escapeHTML: (value) => String(value ?? ""),
    todayISO: () => REPORT_DATE,
    getSettings: () => settings
  });

  console.log("[1] cycleWeekForDateの週境界と未設定時フォールバック");
  check("開始日当日はWeek 1/12", topband.cycleWeekForDate("2026-08-08") === 1);
  check("開始日の7日後はWeek 2/12", topband.cycleWeekForDate("2026-08-15") === 2);
  check("開始日の84日後はWeek 12/12へクランプ", topband.cycleWeekForDate("2026-10-31") === 12);
  settings = { twelveWeekStartDate: "" };
  check("開始日未設定でもWeek 1/12", topband.cycleWeekForDate(REPORT_DATE) === 1);

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  async function seedReport(startDate) {
    await page.evaluate(({ key, reportDate, startDate }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "journal";
      state.selectedDate = reportDate;
      state.settings.twelveWeekStartDate = startDate;
      state.blocks = [];
      state.tasks = [];
      state.projects = [];
      state.reports[reportDate] = "";
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, reportDate: REPORT_DATE, startDate });
    await page.reload();
    await page.waitForSelector('[data-action="generate-report"]');
    await generateReportThroughGate(page);
    await page.waitForFunction(({ key, reportDate }) => {
      const state = JSON.parse(localStorage.getItem(key));
      return Boolean(state.reports?.[reportDate]);
    }, { key: STATE_KEY, reportDate: REPORT_DATE });
    return page.evaluate(({ key, reportDate }) => (
      JSON.parse(localStorage.getItem(key)).reports[reportDate] || ""
    ), { key: STATE_KEY, reportDate: REPORT_DATE });
  }

  try {
    await page.clock.setFixedTime(new Date(2026, 7, 22, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[2] 固定開始日の日報に対象日の週番号が出る");
    const week3Report = await seedReport(CYCLE_START);
    check(
      "日報行にWeek 3/12が含まれる",
      week3Report.includes("| 12週 今週の進捗(Week 3/12) | 0 / 0 | 0% |"),
      week3Report.slice(0, 700)
    );

    console.log("[3] 開始日未設定の日報はWeek 1/12で生成できる");
    const week1Report = await seedReport("");
    check(
      "日報行にWeek 1/12が含まれる",
      week1Report.includes("| 12週 今週の進捗(Week 1/12) | 0 / 0 | 0% |"),
      week1Report.slice(0, 700)
    );
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ v231 ALL PASS" : `\n❌ v231: ${failures} 件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
