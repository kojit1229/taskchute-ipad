// v321: Today TOWERのMITカード・ARRIVALS 6/8件・MIT星・空状態文言を固定する。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-03";
const FOCUS_KEY = "taskchute-journal-today-focus-v1";
const FIXED_NOW = new Date(2026, 8, 3, 10, 0, 0, 0);
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function block(id, title, start, end, extra = {}) {
  return {
    id, taskId: "", date: TODAY, title, category: "作業", oneTap: false,
    plannedStartAt: `${TODAY}T${start}`, plannedEndAt: `${TODAY}T${end}`,
    actualStartAt: "", actualEndAt: "", completed: false, deleted: false,
    charge: 0, discharge: 0, estimateMin: 30, comment: "", recurrenceGroupId: "",
    orderIndex: 0, pomodoroCount: 0, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    ...extra
  };
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({
    serviceWorkers: "block", viewport: { width: 390, height: 900 }, timezoneId: "Asia/Tokyo"
  });
  const page = await context.newPage();
  const pageErrors = [];
  let healthReady = false;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === "api.github.com", (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (!path.endsWith("/contents/taskchute/karada/health-daily.json")) return route.fallback();
    const days = healthReady ? [{
      date: TODAY, sleep_min: 425, bed_time: "23:45", wake_time: "06:50",
      steps: 8000, resting_hr: 58, hrv_sdnn: 41, weight_kg: 60
    }] : [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: 1, days }) });
  });

  const changedStateWrites = () => page.evaluate((key) =>
    window.__v321StorageWrites.filter((entry) => entry.key === key && entry.changed).length, STATE_KEY);
  const seed = async (blocks, bodyScans = []) => {
    await page.evaluate(({ key, focusKey, today, blocks, bodyScans }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "today";
      state.selectedDate = today;
      state.blocks = blocks;
      state.tasks = [];
      state.bodyScans = bodyScans;
      state.settings.autoSync = false;
      state.settings.lastOpenedDate = today;
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem(focusKey, JSON.stringify({
        sections: { side: true, journal: true, life: true },
        restore: { side: true, journal: true, life: true }
      }));
    }, { key: STATE_KEY, focusKey: FOCUS_KEY, today: TODAY, blocks, bodyScans });
    await page.reload();
    await page.waitForSelector(".today-tower");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => { window.__v321StorageWrites = []; });
  };

  try {
    await page.addInitScript(() => {
      window.__v321StorageWrites = [];
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (this === localStorage) {
          window.__v321StorageWrites.push({ key: String(key), changed: this.getItem(key) !== String(value) });
        }
        return originalSetItem.call(this, key, value);
      };
    });
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] MIT 2件・0件とLIFE BANDより前の常設カード");
    const mitTwo = [
      block("mit-done", "朝のMIT", "08:00", "08:20", {
        isMIT: true, estimateMin: 20, actualStartAt: `${TODAY}T08:00`, actualEndAt: `${TODAY}T08:20`, completed: true
      }),
      block("mit-next", "次のMIT", "11:00", "11:30", { isMIT: true })
    ];
    await seed(mitTwo);
    const mitLayout = await page.locator(".tower-mit").evaluate((mit) => {
      const band = document.querySelector(".tower-band1");
      const style = getComputedStyle(mit);
      const rowStyle = getComputedStyle(mit.querySelector(".tower-mit-row"));
      return {
        beforeBand: Boolean(mit.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING),
        borderColor: style.borderColor, rowHeight: parseFloat(rowStyle.minHeight), fontSize: parseFloat(rowStyle.fontSize)
      };
    });
    check(".tower-mitはtower-band1より前に2行・各行★付き", mitLayout.beforeBand
      && await page.locator(".tower-mit-row").count() === 2
      && await page.locator(".tower-mit-row .mit-star").count() === 2, JSON.stringify(mitLayout));
    check("MIT行は44px・11px以上でアンバー枠", mitLayout.rowHeight >= 44 && mitLayout.fontSize >= 11
      && mitLayout.borderColor !== "rgba(0, 0, 0, 0)", JSON.stringify(mitLayout));
    await seed([block("plain", "通常予定", "11:00", "11:30")]);
    check("MIT 0件は指定の空文言1行", await page.locator(".tower-mit-row").count() === 0
      && (await page.locator(".tower-mit-empty").textContent()).trim() === "MITは未設定(実行タブの「これから」で行をタップ→☆)");
    const mitPopulation = [
      block("mit-fourth", "当日4", "13:00", "13:30", { isMIT: true }),
      block("mit-other-day", "別日", "08:00", "08:30", { isMIT: true, date: "2026-09-02" }),
      block("mit-third", "当日3", "12:00", "12:30", { isMIT: true }),
      block("mit-deleted", "削除済み", "09:00", "09:30", { isMIT: true, deleted: true }),
      block("mit-second", "当日2", "11:00", "11:30", { isMIT: true }),
      block("mit-first", "当日1", "10:30", "11:00", { isMIT: true })
    ];
    await seed(mitPopulation);
    const mitTitles = await page.locator(".tower-mit-title").allTextContents();
    check("MIT母集団は当日・未削除を時刻順で最大3件", JSON.stringify(mitTitles) === JSON.stringify(["当日1", "当日2", "当日3"]), JSON.stringify(mitTitles));

    console.log("[2] LIFE BAND OFFでもMITカードを残し、同期stateへ書かない");
    await seed(mitTwo);
    const beforeLifeToggle = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await page.click('[data-action="focus-toggle-life"]');
    await page.waitForSelector('.today-tower[data-view-life="0"]');
    check("tower-band1/SOだけが消えてtower-mitは残る", await page.locator(".tower-band1, .so-row").count() === 0
      && await page.locator(".tower-mit").count() === 1);
    check("LIFE表示切替は同期state非書込", await page.evaluate((key) => localStorage.getItem(key), STATE_KEY) === beforeLifeToggle
      && await changedStateWrites() === 0);

    console.log("[3] ARRIVALSは末尾クランプし、390pxで6件・1280pxで8件");
    const arrivalsFrom = (firstMinute) => Array.from({ length: 12 }, (_, index) => {
      const minute = firstMinute + index * 30;
      const hour = Math.floor(minute / 60);
      const mm = minute % 60;
      const start = `${String(hour).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      const endMinute = minute + 30;
      const end = `${String(Math.floor(endMinute / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`;
      return block(`arrival-${index}`, `予定${index + 1}`, start, end);
    });
    const arrivalIds = () => page.locator(".tower-flight-row").evaluateAll((rows) => rows.map((row) => row.dataset.flightId));
    await page.setViewportSize({ width: 390, height: 900 });
    await seed([
      block("past-1", "過去1", "06:00", "06:30"), block("past-2", "過去2", "07:00", "07:30"),
      block("past-3", "過去3", "08:00", "08:30"), block("past-4", "過去4", "09:00", "09:30")
    ]);
    check("4便すべて過去でも4件全表示・さらに無し", await page.locator(".tower-flight-row").count() === 4
      && (await page.locator("#towerArrivalSummary").textContent()).trim() === "");
    await seed(arrivalsFrom(10 * 60 + 30));
    check("中心が先頭なら先頭6件+さらに6件", JSON.stringify(await arrivalIds()) === JSON.stringify(Array.from({ length: 6 }, (_, index) => `arrival-${index}`))
      && (await page.locator("#towerArrivalSummary").textContent()).trim() === "さらに6件", JSON.stringify(await arrivalIds()));
    await seed(arrivalsFrom(4 * 60));
    check("中心が末尾なら末尾6件+さらに6件", JSON.stringify(await arrivalIds()) === JSON.stringify(Array.from({ length: 6 }, (_, index) => `arrival-${index + 6}`))
      && (await page.locator("#towerArrivalSummary").textContent()).trim() === "さらに6件", JSON.stringify(await arrivalIds()));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => document.querySelectorAll(".tower-flight-row").length === 8
      && document.querySelector(".tower-flight-row")?.dataset.flightId === "arrival-4");
    check("1280pxも末尾8件+さらに4件", JSON.stringify(await arrivalIds()) === JSON.stringify(Array.from({ length: 8 }, (_, index) => `arrival-${index + 4}`))
      && (await page.locator("#towerArrivalSummary").textContent()).trim() === "さらに4件", JSON.stringify(await arrivalIds()));

    console.log("[4] 次の予定・やったこと・NOW LANDINGへMIT★を復元する");
    await page.setViewportSize({ width: 390, height: 900 });
    const starBlocks = [
      block("star-done", "完了MIT", "08:00", "08:30", {
        isMIT: true, actualStartAt: `${TODAY}T08:00`, actualEndAt: `${TODAY}T08:30`, completed: true
      }),
      block("star-running", "進行MIT", "09:30", "10:30", { isMIT: true, actualStartAt: `${TODAY}T09:30` }),
      block("star-next", "予定MIT", "11:00", "11:30", { isMIT: true })
    ];
    await seed(starBlocks);
    check("次の予定のMIT行に★", await page.locator('.tower-arrival-row[data-flight-id="star-next"] .mit-star').count() === 1);
    check("やったことのMIT行に★", await page.locator('.tower-log-row[data-flight-id="star-done"] .mit-star').count() === 1);
    check("NOW LANDINGのMITタイトルに★", await page.locator('.tower-now-title[data-id="star-running"] .mit-star').count() === 1);

    console.log("[5] スキャン0件の健康行あり/なしで空状態文言を分ける");
    check("健康行なしは旧文言", (await page.locator(".bm-empty").textContent()).trim() === "今日の記録はまだありません");
    healthReady = true;
    await page.reload();
    await page.waitForFunction(() => document.querySelector(".bm-health-src")?.textContent.includes("09-03時点"));
    check("健康行ありは身体スキャンの事実文言", (await page.locator(".bm-empty").textContent()).trim() === "身体スキャンは Block 完了時に記録");

    console.log("[6][7] 予定0件HUD・390px横スクロール・pageerror・state非書込");
    await seed([]);
    const beforeDisplay = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    check("予定0件は新HUD文言", (await page.locator('.tower-nowhud[data-status="empty"]').textContent()).trim()
      === "本日の予定はありません ─ タイムラインで追加できます");
    const widths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth
    }));
    check("390px横スクロールなし", widths.scrollWidth <= widths.viewportWidth + 1, JSON.stringify(widths));
    check("表示のみで同期state非書込", await page.evaluate((key) => localStorage.getItem(key), STATE_KEY) === beforeDisplay
      && await changedStateWrites() === 0);
    check("pageerror 0", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\n✅ v321 ALL PASS" : `\n❌ v321: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
