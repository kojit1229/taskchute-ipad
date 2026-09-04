// v325: MIT直下の体調コメントを健康日次から決定論で描画し、stateへ保存しない。
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-04";
const TOMORROW = "2026-09-05";
const FIXED_NOW = new Date(2026, 8, 4, 10, 0, 0, 0);
const HEALTH_PATH = path.join(__dirname, "..", "src", "features", "health.js");
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function addDaysSafe(iso, delta) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const THRESHOLDS = {
  baselineLookbackDays: 28, baselineMinSamples: 7,
  hrvDeficitPct: -15, hrvLowPct: -5, hrDeficitBpm: 5, hrLowBpm: 2,
  sleepDeficitH: 5.5, sleepLowH: 6.5
};

function healthDays({ today = TODAY, sleepMin = 442, yesterdaySteps = 7000, otherSteps = 7000, hrv = 100, includeToday = true } = {}) {
  const prior = Array.from({ length: 7 }, (_, index) => ({
    date: addDaysSafe(today, -(index + 1)), sleep_min: 420,
    bed_time: "22:30", wake_time: "05:30", steps: index === 0 ? yesterdaySteps : otherSteps,
    resting_hr: 60, hrv_sdnn: 100, active_kcal: 400, exercise_min: 30
  }));
  return [...prior.reverse(), ...(includeToday ? [{
    date: today, sleep_min: sleepMin, bed_time: "21:30", wake_time: "04:52",
    steps: 0, resting_hr: 60, hrv_sdnn: hrv, active_kcal: 0, exercise_min: 0
  }] : [])];
}

(async () => {
  console.log("[1] conditionFromHealthの中央値・標本数・欠測除外");
  const health = await import(pathToFileURL(HEALTH_PATH).href);
  let healthFetches = 0;
  let healthToday = TODAY;
  health.configureHealth({
    personalDataReady: () => true,
    fetchGitHubRawTextAtRoot: async () => { healthFetches++; return JSON.stringify({ schema: 1, days: healthDays() }); },
    escapeHTML: String,
    addDays: addDaysSafe, conditionThresholds: () => THRESHOLDS, todayISO: () => healthToday
  });
  await health.hydrateHealthData(health.HEALTH_REFRESH_INTERVAL_MS);
  await health.hydrateHealthData(health.HEALTH_REFRESH_INTERVAL_MS);
  healthToday = TOMORROW;
  await health.hydrateHealthData(health.HEALTH_REFRESH_INTERVAL_MS);
  check("日付が変われば6時間以内でも再fetch", healthFetches === 2, String(healthFetches));
  health.invalidateHealthCache();
  await health.hydrateHealthData(health.HEALTH_REFRESH_INTERVAL_MS);
  check("キャッシュ無効化後は6時間以内でも再fetch", healthFetches === 3, String(healthFetches));
  const medianDays = healthDays({ hrv: 80 });
  medianDays.slice(0, 7).forEach((day, index) => { day.hrv_sdnn = [80, 90, 100, 100, 100, 110, 120][index]; });
  const medianResult = health.conditionFromHealth(medianDays, TODAY);
  check("過去7件の中央値100に対するHRV −20%だけでdeficit", medianResult.level === "deficit"
    && medianResult.reasons.includes("HRV −20%") && !medianResult.reasons.some((reason) => reason.startsWith("睡眠")), JSON.stringify(medianResult));
  const mixedResult = health.conditionFromHealth(healthDays({ sleepMin: 380, hrv: 80 }), TODAY);
  check("low睡眠とdeficit HRVの混合時は重い根拠を先頭にする", mixedResult.reasons[0] === "HRV −20%"
    && health.conditionCommentText(mixedResult).startsWith("HRV −20% が低めです。"), JSON.stringify(mixedResult));

  const tooFew = health.conditionFromHealth(healthDays({ hrv: 1 }).slice(1), TODAY);
  check("HRV標本が7件未満なら判定をスキップ", tooFew.level === "normal" && tooFew.reasons.length === 0, JSON.stringify(tooFew));

  const missing = healthDays({ yesterdaySteps: 4500, otherSteps: 8000 });
  missing[1].steps = null;
  missing[2].hrv_sdnn = null;
  const missingResult = health.conditionFromHealth(missing, TODAY);
  check("歩数・HRVの欠測を平均と中央値から除外", missingResult.level === "normal"
    && Math.abs(missingResult.stepsAvg7 - (44500 / 6)) < 0.001 && missingResult.ySteps === 4500, JSON.stringify(missingResult));
  const noSleep = health.conditionFromHealth(healthDays().map((day) => day.date === TODAY ? { ...day, sleep_min: null } : day), TODAY);
  check("睡眠欠測を十分とは表現しない", !health.conditionCommentText(noSleep).includes("で十分")
    && health.conditionCommentText(noSleep).startsWith("今朝の睡眠データは未取得。"));
  const source = fs.readFileSync(HEALTH_PATH, "utf8");
  check("health.jsにnew Date(文字列)パースが無い", !/new Date\s*\(\s*["'`]/.test(source));

  console.log("[2] 4 fixture + HRV単独deficitの実DOM・順序・meta");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({
    serviceWorkers: "block", viewport: { width: 390, height: 900 }, timezoneId: "Asia/Tokyo"
  });
  const page = await context.newPage();
  const pageErrors = [];
  let currentDays = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === "api.github.com", (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    if (!pathname.endsWith("/contents/karada/health-daily.json")) return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: 1, days: currentDays }) });
  });

  const seedAndOpen = async (days, expectedText, gym = []) => {
    currentDays = days;
    const expected = await page.evaluate(({ key, today, gym }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "today";
      state.selectedDate = today;
      state.settings.autoSync = false;
      state.settings.lastOpenedDate = today;
      state.blocks = [];
      state.condition.logs["2026-09-03"] = {
        sleepHours: null, meds: null, capacity: "", morningRecordedAt: "",
        eveningMood: null, eveningNote: "", eveningRecordedAt: "", gym
      };
      localStorage.setItem(key, JSON.stringify(state));
      window.__v325StorageWrites = [];
      return localStorage.getItem(key);
    }, { key: STATE_KEY, today: TODAY, gym });
    const healthResponse = page.waitForResponse((response) => response.url().includes("karada/health-daily.json"));
    await page.reload();
    await healthResponse;
    const sourceDate = days.some((day) => day.date === TODAY) ? "09-04時点" : "09-03時点";
    await page.waitForFunction((expected) => document.querySelector(".bm-health-src")?.textContent.includes(expected), sourceDate);
    await page.waitForFunction((expected) => document.querySelector(".tower-condition-text")?.textContent.includes(expected), expectedText);
    return {
      expected,
      actual: await page.evaluate((key) => localStorage.getItem(key), STATE_KEY),
      changedWrites: await page.evaluate((key) => window.__v325StorageWrites.filter((item) => item.key === key && item.changed).length, STATE_KEY)
    };
  };

  try {
    await page.addInitScript(() => {
      window.__v325StorageWrites = [];
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (this === localStorage) window.__v325StorageWrites.push({ key: String(key), changed: this.getItem(key) !== String(value) });
        return originalSetItem.call(this, key, value);
      };
    });
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    const deficitState = await seedAndOpen(healthDays({ sleepMin: 260 }), "睡眠 4h20m");
    check("260分はdeficit文言", (await page.locator(".tower-condition-text").textContent()).trim()
      === "睡眠 4h20m と短めです。今日は重要なこと1つに絞り、午後に15分の休憩を入れましょう");
    check("knownは睡眠・HR・HRV・昨日歩数meta", (await page.locator(".tower-condition-meta").textContent()).trim()
      === "睡眠 4h20m ・ HR 60 ・ HRV 100ms ・ 昨日 7,000歩");

    const gym = [{ id: "v325-gym", exercise: "スクワット", weight: 50, reps: 10,
      at: "2026-09-03T18:00", createdAt: "2026-09-03T18:00", updatedAt: "2026-09-03T18:00" }];
    await seedAndOpen(healthDays({ sleepMin: 380, yesterdaySteps: 9000, otherSteps: 5500 }), "睡眠 6h20m", gym);
    check("380分+昨日歩数1.5倍はlowで筋トレも活動句へ付加", (await page.locator(".tower-condition-text").textContent()).trim()
      === "睡眠 6h20m。昨日は歩数 9,000・筋トレ 500kg と活動量が多め ─ 今日は詰め込まず MIT を優先しましょう");

    await seedAndOpen(healthDays({ sleepMin: 442, yesterdaySteps: 4500, otherSteps: 8000 }), "睡眠 7h22m");
    check("442分+昨日歩数0.6倍はnormalで控えめ句", (await page.locator(".tower-condition-text").textContent()).trim()
      === "睡眠 7h22m で十分。昨日の活動は控えめ(歩数 4,500) ─ 今日は集中の山を1つ作る日に");

    const unknownState = await seedAndOpen(healthDays({ includeToday: false }), "今朝の睡眠データはまだありません");
    const unknownText = (await page.locator(".tower-condition-text").textContent()).trim();
    const unknownMetaCount = await page.locator(".tower-condition-meta").count();
    check("当日行なしはunknown文言のみ", unknownText === "今朝の睡眠データはまだありません" && unknownMetaCount === 0,
      JSON.stringify({ unknownText, unknownMetaCount }));

    await seedAndOpen(healthDays({ sleepMin: 442, hrv: 80 }), "HRV −20%");
    check("HRV −20%だけでもdeficit", (await page.locator(".tower-condition-text").textContent()).trim()
      === "HRV −20% が低めです。今日は重要なこと1つに絞り、午後に15分の休憩を入れましょう");

    const layout = await page.locator(".tower-condition").evaluate((condition) => {
      const parent = condition.parentElement;
      const style = getComputedStyle(condition);
      const label = getComputedStyle(condition.querySelector(".tower-condition-label"));
      const text = getComputedStyle(condition.querySelector(".tower-condition-text"));
      const children = [...parent.children];
      return {
        afterMit: children[children.indexOf(condition) - 1]?.classList.contains("tower-mit"),
        beforeBand: !parent.querySelector(".tower-band1") || children.indexOf(condition) < children.indexOf(parent.querySelector(".tower-band1")),
        minHeight: parseFloat(style.minHeight), borderColor: style.borderColor,
        labelSize: parseFloat(label.fontSize), textSize: parseFloat(text.fontSize),
        metaSize: parseFloat(getComputedStyle(condition.querySelector(".tower-condition-meta")).fontSize),
        metaOpacity: parseFloat(getComputedStyle(condition.querySelector(".tower-condition-meta")).opacity),
        scrollWidth: document.documentElement.scrollWidth
      };
    });
    check("MIT直後・LIFE BAND前に常設", layout.afterMit && layout.beforeBand, JSON.stringify(layout));
    check("390pxで44px/13px・meta 11px/.7下限・横スクロールなし", layout.minHeight >= 44 && layout.labelSize >= 13
      && layout.textSize >= 13 && layout.metaSize >= 11 && layout.metaOpacity >= 0.7 && layout.scrollWidth <= 391
      && layout.borderColor === "rgb(31, 85, 96)", JSON.stringify(layout));
    await page.setViewportSize({ width: 1280, height: 900 });
    const pcLayout = await page.locator(".tower-condition").evaluate((condition) => {
      const center = (selector) => { const rect = condition.querySelector(selector).getBoundingClientRect(); return rect.top + rect.height / 2; };
      return { areas: getComputedStyle(condition).gridTemplateAreas,
        centers: [center(".tower-condition-label"), center(".tower-condition-text"), center(".tower-condition-meta")] };
    });
    check("PCはcond全幅・ラベル/文言/metaを1行配置", pcLayout.areas.includes("label text meta")
      && Math.max(...pcLayout.centers) - Math.min(...pcLayout.centers) < 1,
      JSON.stringify(pcLayout));
    const allText = await page.locator(".tower-condition").textContent();
    check("禁止語と赤系クラスを使わない", !/要注意|疲労|危険|警告/.test(allText)
      && await page.locator(".tower-condition.red, .tower-condition.deficit, .tower-condition.low").count() === 0);
    check("表示・健康取得はapp stateへ内容変更を書かない", [deficitState, unknownState].every((item) => item.expected === item.actual && item.changedWrites === 0),
      JSON.stringify({ deficitState, unknownState }));
    check("pageerror 0", pageErrors.length === 0, JSON.stringify(pageErrors));

    console.log("[3] 日跨ぎ復帰はpullスロットル中でも当日healthを再取得");
    const resumeContext = await browser.newContext({
      serviceWorkers: "block", viewport: { width: 390, height: 900 }, timezoneId: "Asia/Tokyo"
    });
    const resumePage = await resumeContext.newPage();
    let resumeDays = healthDays({ sleepMin: 442 });
    let resumeHealthRequests = 0;
    let resumePullRequests = 0;
    await resumePage.clock.install({ time: new Date(2026, 8, 4, 23, 57, 0, 0) });
    await blockGithubApiByDefault(resumePage);
    await resumePage.route((url) => url.hostname === "api.github.com", (route) => {
      const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
      if (pathname.endsWith("/contents/taskchute/app-state.json")) {
        resumePullRequests++;
        return route.fallback();
      }
      if (!pathname.endsWith("/contents/karada/health-daily.json")) return route.fallback();
      resumeHealthRequests++;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: 1, days: resumeDays }) });
    });
    await resumePage.goto(`http://localhost:${PORT}/`);
    const initialHealth = resumePage.waitForResponse((response) => response.url().includes("karada/health-daily.json"));
    await passGithubGate(resumePage);
    await initialHealth;
    await resumePage.waitForFunction(() => document.querySelector(".tower-condition-text")?.textContent.includes("睡眠 7h22m"));
    await resumePage.clock.pauseAt(new Date(2026, 8, 4, 23, 59, 50, 0));
    const recentPull = resumePage.waitForRequest((request) => request.url().includes("taskchute/app-state.json"));
    await resumePage.evaluate(() => {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.settingAutosync = "";
      input.checked = true;
      document.body.appendChild(input);
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.remove();
    });
    await recentPull;
    const requestsBeforeResume = { health: resumeHealthRequests, pull: resumePullRequests };
    resumeDays = healthDays({ today: TOMORROW, sleepMin: 260 });
    await resumePage.clock.setSystemTime(new Date(2026, 8, 5, 0, 0, 10, 0));
    await resumePage.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await resumePage.waitForFunction(() => document.querySelector(".tower-condition-text")?.textContent.includes("睡眠 4h20m"));
    check("pullスロットル中はapp-state fetchを増やさない", resumePullRequests === requestsBeforeResume.pull,
      JSON.stringify({ before: requestsBeforeResume, health: resumeHealthRequests, pull: resumePullRequests }));
    check("日跨ぎ復帰でhealth fetchを1回再発行して当日値へ更新", resumeHealthRequests === requestsBeforeResume.health + 1,
      JSON.stringify({ before: requestsBeforeResume, health: resumeHealthRequests, pull: resumePullRequests }));
    await resumeContext.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\n✅ v325 ALL PASS" : `\n❌ v325: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
