// v314: personal-data健康日次をBODY/MINDへ出所・鮮度付きで表示し、同期stateへ保存しない。
const path = require("path");
const { pathToFileURL } = require("url");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const FIXED_NOW = new Date(2026, 8, 2, 10, 0, 0, 0);
const HEALTH_PATH = path.join(__dirname, "..", "src", "features", "health.js");
const HEALTH_URL_FRAGMENT = "/contents/taskchute/karada/health-daily.json";
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function fixture(date = "2026-09-02") {
  return {
    schema: 1,
    generated_at: "2026-06-01T00:30:00+09:00",
    days: [{
      date, sleep_min: 425, bed_time: "23:46", wake_time: "06:51", sleep_source: "Apple Watch",
      steps: 8120, resting_hr: 58, hrv_sdnn: 41, active_kcal: 430, exercise_min: 35,
      weight_kg: null, body_fat_pct: null
    }]
  };
}

function fixtureDays(dates) {
  return { ...fixture(), days: dates.map((date) => fixture(date).days[0]) };
}

(async () => {
  const health = await import(pathToFileURL(HEALTH_PATH).href);
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  console.log("[1] モジュールキャッシュ・スキーマ・失敗時の前回正常値維持");
  let ready = false;
  let fetches = 0;
  let result = JSON.stringify(fixture());
  health.configureHealth({
    escapeHTML, personalDataReady: () => ready,
    fetchGitHubRawText: async (name) => {
      fetches++;
      check("取得先はkarada/health-daily.json", name === "karada/health-daily.json", name);
      if (result instanceof Error) throw result;
      return result;
    }
  });
  const realDateNow = Date.now;
  let now = 100_000_000;
  Date.now = () => now;
  try {
    check("personal-data未設定なら取得しない", !(await health.hydrateHealthData(health.HEALTH_REFRESH_INTERVAL_MS)) && fetches === 0);
    ready = true;
    check("正常JSONを採用する", await health.hydrateHealthData(health.HEALTH_REFRESH_INTERVAL_MS));
    const normal = health.healthSummaryHTML("2026-09-02");
    check("睡眠・HR・HRV・歩数・null体重を整形", ["7h05m", "安静HR 58", "HRV 41", "歩数 8,120", "体重 —"].every((text) => normal.includes(text)), normal);
    check("generated_atではなく末尾dateを時点表示に使う", normal.includes("Apple Health経由 · 09-02時点") && !normal.includes("06-01"), normal);
    ready = false;
    check("設定解除後は残存キャッシュを表示しない", health.healthSummaryHTML("2026-09-02").includes("健康データ 未取得"));
    ready = true;
    now += health.HEALTH_REFRESH_INTERVAL_MS;
    result = "{broken";
    check("壊れたJSONでは前回値を維持", !(await health.hydrateHealthData(health.HEALTH_REFRESH_INTERVAL_MS)) && health.healthSummaryHTML("2026-09-02") === normal);
    now += health.HEALTH_REFRESH_INTERVAL_MS;
    result = new Error("404");
    check("取得失敗でも前回値を維持", !(await health.hydrateHealthData(health.HEALTH_REFRESH_INTERVAL_MS)) && health.healthSummaryHTML("2026-09-02") === normal);
    check("7日以内は採用、8日前は採用しない", health.latestHealthWithin("2026-09-09")?.date === "2026-09-02" && health.latestHealthWithin("2026-09-10") === null);

    console.log("[1b] 日付・保持件数・再取得間隔の境界");
    const dateCases = [
      {
        name: "1日前は採用し古い注記を付けない",
        dates: ["2026-09-01"], today: "2026-09-02", expectedDate: "2026-09-01",
        verifySummary: (summary) => summary.includes("09-01時点") && !summary.includes("(古い)")
      },
      {
        name: "未来行を除外して当日以前の最新行を採用",
        dates: ["2026-09-02", "2026-09-03"], today: "2026-09-02", expectedDate: "2026-09-02"
      },
      {
        name: "月末・年末跨ぎの前日を1日前として採用",
        dates: ["2025-12-31"], today: "2026-01-01", expectedDate: "2025-12-31",
        verifySummary: (summary) => summary.includes("12-31時点") && !summary.includes("(古い)")
      },
      {
        name: "不正日付2026-13-40を除外",
        dates: ["2026-13-40"], today: "2026-12-31", expectedDate: null
      },
      {
        name: "空日付を除外",
        dates: [""], today: "2026-09-02", expectedDate: null
      }
    ];
    for (const testCase of dateCases) {
      now += health.HEALTH_REFRESH_INTERVAL_MS;
      result = JSON.stringify(fixtureDays(testCase.dates));
      const changed = await health.hydrateHealthData(health.HEALTH_REFRESH_INTERVAL_MS);
      const latest = health.latestHealthWithin(testCase.today);
      const summary = health.healthSummaryHTML(testCase.today);
      const expected = testCase.expectedDate === null
        ? latest === null && summary.includes("健康データ 未取得")
        : latest?.date === testCase.expectedDate && (!testCase.verifySummary || testCase.verifySummary(summary));
      check(testCase.name, changed && expected, JSON.stringify({ latest: latest?.date ?? null, summary }));
    }

    const retainedDates = Array.from({ length: 61 }, (_, index) => {
      const date = new Date(2026, 0, index + 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    });
    now += health.HEALTH_REFRESH_INTERVAL_MS;
    result = JSON.stringify(fixtureDays(retainedDates));
    const retainedChanged = await health.hydrateHealthData(health.HEALTH_REFRESH_INTERVAL_MS);
    check("61件入力は末尾60件だけ保持",
      retainedChanged
        && health.latestHealthWithin(retainedDates[0], 0) === null
        && health.latestHealthWithin(retainedDates[1], 0)?.date === retainedDates[1]);

    result = JSON.stringify(fixture("2026-03-03"));
    const fetchesAtBoundaryStart = fetches;
    const refreshCases = [
      { name: "interval-1msでは再取得しない", advanceMs: health.HEALTH_REFRESH_INTERVAL_MS - 1, expectedFetches: 0, expectedChanged: false },
      { name: "interval到達時は再取得する", advanceMs: 1, expectedFetches: 1, expectedChanged: true }
    ];
    for (const testCase of refreshCases) {
      now += testCase.advanceMs;
      const changed = await health.hydrateHealthData(health.HEALTH_REFRESH_INTERVAL_MS);
      check(testCase.name,
        fetches - fetchesAtBoundaryStart === testCase.expectedFetches && changed === testCase.expectedChanged,
        JSON.stringify({ fetches: fetches - fetchesAtBoundaryStart, changed }));
    }
  } finally {
    Date.now = realDateNow;
  }

  console.log("[2] BODY/MIND実DOM・鮮度・未取得・state非書込");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1200 }, timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);

  let healthBody = JSON.stringify(fixture());
  let healthStatus = 200;
  let holdHealth = true;
  let releaseHealth;
  await page.route((url) => url.hostname === "api.github.com", async (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    if (pathname.endsWith("/contents/taskchute/karada/health-daily.json")) {
      if (holdHealth) await new Promise((resolve) => { releaseHealth = resolve; });
      return route.fulfill({ status: healthStatus, contentType: "application/json", body: healthBody });
    }
    return route.fallback();
  });

  async function reloadHealth(body, status, expectedText, label, exact = false) {
    healthBody = body;
    healthStatus = status;
    holdHealth = false;
    const healthResponse = page.waitForResponse((response) => response.url().includes(HEALTH_URL_FRAGMENT));
    await page.reload();
    const response = await healthResponse;
    const responseError = await response.finished();
    check(`${label}のhealth応答完了を観測`, response.status() === status && responseError === null,
      JSON.stringify({ status: response.status(), error: responseError?.message }));
    await page.waitForFunction(({ expectedText: expected, exactMatch }) => {
      const text = document.querySelector(".bm-health")?.textContent.trim();
      return exactMatch ? text === expected : text?.includes(expected);
    }, { expectedText, exactMatch: exact });
  }

  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    const healthResponse = page.waitForResponse((response) => response.url().includes(HEALTH_URL_FRAGMENT));
    await passGithubGate(page);
    const stateBefore = await page.evaluate((key) => {
      window.__healthOriginalSetItem = Storage.prototype.setItem;
      window.__healthStateWrites = 0;
      Storage.prototype.setItem = function(storageKey, value) {
        if (storageKey === key) window.__healthStateWrites++;
        return window.__healthOriginalSetItem.call(this, storageKey, value);
      };
      return localStorage.getItem(key);
    }, STATE_KEY);
    holdHealth = false;
    releaseHealth();
    await healthResponse;
    await page.waitForFunction(() => document.querySelector(".bm-health-src")?.textContent.includes("09-02時点"));

    const healthText = await page.locator(".bm-health").textContent();
    check("BODY/MINDに睡眠・HR・歩数を表示", ["睡眠 7h05m(23:46→06:51)", "安静HR 58", "歩数 8,120"].every((text) => healthText.includes(text)), healthText);
    check("出所と表示行の日付を表示", healthText.includes("Apple Health経由 · 09-02時点"), healthText);
    check("bodyScansが0件でも健康行とbm-emptyが共存", await page.locator(".sec-bodymind .bm-health").count() === 1 && await page.locator(".sec-bodymind .bm-empty").count() === 1);
    const stateAfter = await page.evaluate((key) => ({
      raw: localStorage.getItem(key), writes: window.__healthStateWrites,
      healthKeys: Object.keys(JSON.parse(localStorage.getItem(key))).filter((keyName) => /health/i.test(keyName))
    }), STATE_KEY);
    check("health取得・再描画はlocalStorageのapp stateを変更しない", stateAfter.raw === stateBefore && stateAfter.writes === 0, JSON.stringify(stateAfter));
    check("app state直下にhealth関連キーを書かない", stateAfter.healthKeys.length === 0, JSON.stringify(stateAfter.healthKeys));
    await page.evaluate(() => { Storage.prototype.setItem = window.__healthOriginalSetItem; });

    await reloadHealth(JSON.stringify(fixture("2026-08-31")), 200, "08-31時点 (古い)", "2日前ケース");
    check("2日前の最新行には古い表示を付ける", (await page.locator(".bm-health-src").textContent()).includes("08-31時点 (古い)"));

    await reloadHealth(JSON.stringify(fixture("2026-08-25")), 200, "健康データ 未取得", "8日前ケース", true);
    check("8日前しか無ければ未取得表示", (await page.locator(".bm-health").textContent()).trim() === "健康データ 未取得");

    await reloadHealth("{broken", 200, "健康データ 未取得", "壊れたJSONケース", true);
    check("壊れたJSONでも未取得表示", (await page.locator(".bm-health").textContent()).trim() === "健康データ 未取得");

    await reloadHealth("{}", 404, "健康データ 未取得", "404ケース", true);
    check("404でも未取得表示", (await page.locator(".bm-health").textContent()).trim() === "健康データ 未取得");
    check("全失敗ケースを含めpageerrorが0件", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    releaseHealth?.();
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\n❌ v314: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\n✅ v314: all checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
