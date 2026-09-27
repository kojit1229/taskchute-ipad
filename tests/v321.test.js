// 4回-08/4回-10 日本語化の契約追随(監督者決定 2026-09-10)
// v321: Today TOWERのMITカード・当日一覧全件・MIT星・空状態文言を固定する。
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
    if (!path.endsWith("/contents/karada/health-daily.json")) return route.fallback();
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
      // fixV404f(監督者追随 2026-09-14): v404(F1-2/M-16)で MIT は同日1件。2件目は MIT なしの通常予定。
      block("mit-next", "次の予定", "11:00", "11:30")
    ];
    await seed(mitTwo);
    // fixF6d(監督者決定2): F6-1でMITは上部帯の直下・LIFE BAND/NOW LANDINGより前の大見出しへ
    // 移動した(.tower-runwayへの内包は前提でなくなった)。同じ性質(存在・表示順・行数・★件数)を
    // 新配置で検査する: #dailyTodayPlansとNOW LANDING(.tower-runway)の両方より前に出ること。
    // v410: 独立MIT見出しを廃止。★の件数・対象・操作寸法を予定行と単一カードで維持する。
    check("MIT独立枠は無い", await page.locator('.tower-mit, .tower-mit-row, .tower-mit-empty').count() === 0);
    check("完了MITの予定行に★が1つ", await page.locator('[data-work-key="block:mit-done"] .mit-star').count() === 1);
    const cardLayout = await page.locator('.today-now-card').evaluate(card => {
      const plan = document.querySelector('#dailyTodayPlans');
      const button = card.querySelector('.tower-now-actions > .btn.primary');
      return { beforePlans: Boolean(card.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING),
        height: button.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(button).fontSize) };
    });
    check("カードは予定より前・主操作は44px/11px以上", cardLayout.beforePlans && cardLayout.height >= 44 && cardLayout.fontSize >= 11, JSON.stringify(cardLayout));
    await seed([block("plain", "通常予定", "11:00", "11:30")]);
    // v410: MIT未設定はカードと予定行に★を出さず、通常の次の予定を表示する。
    check("MIT 0件はカードと予定行の★なし", await page.locator('.today-now-card .mit-star, [data-work-list="today"] .mit-star').count() === 0
      && (await page.locator('.today-now-card .tower-now-title').textContent()).trim() === "通常予定");
    const mitPopulation = [
      block("mit-fourth", "当日4", "13:00", "13:30", { isMIT: true }),
      block("mit-other-day", "別日", "08:00", "08:30", { isMIT: true, date: "2026-09-02" }),
      block("mit-third", "当日3", "12:00", "12:30", { isMIT: true }),
      block("mit-deleted", "削除済み", "09:00", "09:30", { isMIT: true, deleted: true }),
      block("mit-second", "当日2", "11:00", "11:30", { isMIT: true }),
      block("mit-first", "当日1", "10:30", "11:00", { isMIT: true })
    ];
    await seed(mitPopulation);
    // fixT1c: 裁定Gでは複数MIT旧データのカード★は最大1つ、完了MITは記録側、独立枠は0件を検査する。
    check("複数MIT旧データでもカードの★は最大1つ", await page.locator('.today-now-card .mit-star').count() <= 1);
    check("複数MIT旧データでも独立MIT枠は無い", await page.locator('.tower-mit, .tower-mit-row, .tower-mit-empty').count() === 0);
    await seed([mitTwo[0], ...mitPopulation]);
    check("完了MITの★は記録側に1つ", await page.locator('.tower-log-title .mit-star').count() === 1
      && await page.locator('.tower-log-row[data-flight-id="mit-done"] .tower-log-title .mit-star').count() === 1);

    console.log("[2] LIFE BAND OFFでもMITカードを残し、同期stateへ書かない");
    await seed(mitTwo);
    const beforeLifeToggle = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await page.click('[data-action="today-plans-jump"]');
    await page.waitForSelector('[data-work-list="today"]');
    // v410: 移動後も人生/信条・カードを常設し、独立MIT枠は戻さない。
    check("予定へ移動しても人生/信条とカードを常設", await page.locator(".life-band, .so-row").count() === 2
      && await page.locator(".today-now-card").count() === 1 && await page.locator(".tower-mit").count() === 0);
    check("LIFE表示切替は同期state非書込", await page.evaluate((key) => localStorage.getItem(key), STATE_KEY) === beforeLifeToggle
      && await changedStateWrites() === 0);

    console.log("[3] 当日一覧は390px/1280pxとも時刻順全件");
    const arrivalsFrom = (firstMinute) => Array.from({ length: 12 }, (_, index) => {
      const minute = firstMinute + index * 30;
      const hour = Math.floor(minute / 60);
      const mm = minute % 60;
      const start = `${String(hour).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      const endMinute = minute + 30;
      const end = `${String(Math.floor(endMinute / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`;
      return block(`arrival-${index}`, `予定${index + 1}`, start, end);
    });
    const arrivalIds = () => page.locator('[data-work-list="today"] [data-work-key]').evaluateAll((rows) => rows.map((row) => row.dataset.workKey.replace(/^block:/, "")));
    await page.setViewportSize({ width: 390, height: 900 });
    await seed([
      block("past-1", "過去1", "06:00", "06:30"), block("past-2", "過去2", "07:00", "07:30"),
      block("past-3", "過去3", "08:00", "08:30"), block("past-4", "過去4", "09:00", "09:30")
    ]);
    check("4便すべて過去でも4件全表示・件数一致", await page.locator('[data-work-list="today"] [data-work-key]').count() === 4
      && (await page.locator('[data-work-list="today"] .work-list-count').textContent()).trim() === "4 / 4件 ・ 全件スクロール");
    await seed(arrivalsFrom(10 * 60 + 30));
    check("現在時刻より後の12件も全件表示", JSON.stringify(await arrivalIds()) === JSON.stringify(Array.from({ length: 12 }, (_, index) => `arrival-${index}`))
      && (await page.locator('[data-work-list="today"] .work-list-count').textContent()).trim() === "12 / 12件 ・ 全件スクロール", JSON.stringify(await arrivalIds()));
    await seed(arrivalsFrom(4 * 60));
    check("現在時刻より前の12件も全件表示", JSON.stringify(await arrivalIds()) === JSON.stringify(Array.from({ length: 12 }, (_, index) => `arrival-${index}`))
      && (await page.locator('[data-work-list="today"] .work-list-count').textContent()).trim() === "12 / 12件 ・ 全件スクロール", JSON.stringify(await arrivalIds()));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => document.querySelectorAll('[data-work-list="today"] [data-work-key]').length === 12
      && document.querySelector('[data-work-list="today"] [data-work-key]')?.dataset.workKey === "block:arrival-0");
    check("1280pxでも同じ12件を全件表示", JSON.stringify(await arrivalIds()) === JSON.stringify(Array.from({ length: 12 }, (_, index) => `arrival-${index}`))
      && (await page.locator('[data-work-list="today"] .work-list-count').textContent()).trim() === "12 / 12件 ・ 全件スクロール", JSON.stringify(await arrivalIds()));

    console.log("[4] 次の予定・やったこと・NOW LANDINGへMIT★を復元する");
    await page.setViewportSize({ width: 390, height: 900 });
    // fixV404f(監督者追随): 同日の MIT は1件なので、★を出す場所ごとに MIT を1件だけ立てて seed し直す。
    const starBlocks = mitId => [
      block("star-done", "完了MIT", "08:00", "08:30", {
        isMIT: mitId === "star-done", actualStartAt: `${TODAY}T08:00`, actualEndAt: `${TODAY}T08:30`, completed: true
      }),
      block("star-running", "進行MIT", "09:30", "10:30", { isMIT: mitId === "star-running", actualStartAt: `${TODAY}T09:30` }),
      block("star-next", "予定MIT", "11:00", "11:30", { isMIT: mitId === "star-next" })
    ];
    await seed(starBlocks("star-next"));
    check("次の予定のMIT行に★", await page.locator('[data-work-list="today"] [data-work-key="block:star-next"] .mit-star').count() === 1);
    await seed(starBlocks("star-done"));
    check("やったことのMIT行に★", await page.locator('.tower-log-row[data-flight-id="star-done"] .mit-star').count() === 1);
    check("今日の全件一覧の完了MIT行にも★", await page.locator('[data-work-list="today"] [data-work-key="block:star-done"] .mit-star').count() === 1);
    await seed(starBlocks("star-running"));
    check("NOW LANDINGのMITタイトルに★", await page.locator('.tower-now-title[data-id="star-running"] .mit-star').count() === 1);
    const runningWidths = await page.locator('.today-now-card').evaluate(card => ({
      page: document.documentElement.scrollWidth, viewport: window.innerWidth, card: card.clientWidth, content: card.scrollWidth
    }));
    check("390pxの実行中カードとページに横溢れなし", runningWidths.page <= runningWidths.viewport + 1
      && runningWidths.content <= runningWidths.card + 1, JSON.stringify(runningWidths));

    console.log("[6][7] 予定0件HUD・390px横スクロール・pageerror・state非書込");
    await seed([]);
    const beforeDisplay = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    check("予定0件は新HUD文言", (await page.locator('.tower-nowhud[data-status="empty"]').evaluate(el => [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(''))).trim()
      === "本日の予定はありません ─ タイムラインで追加できます");
    check("予定0件は実行の追加操作を残す", await page.locator('.tower-nowhud[data-status="empty"] [data-action="nav"][data-view="exec"]').count() === 1);
    const widths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth
    }));
    check("390px横スクロールなし", widths.scrollWidth <= widths.viewportWidth + 1, JSON.stringify(widths));
    check("表示のみで同期state非書込", await page.evaluate((key) => localStorage.getItem(key), STATE_KEY) === beforeDisplay
      && await changedStateWrites() === 0);
    check("pageerror 0", pageErrors.length === 0, JSON.stringify(pageErrors));
    console.log("[5] スキャン0件の健康行あり/なしで空状態文言を分ける");
    await page.locator('[data-action="nav"][data-view="more"]:visible').first().click();
    await page.locator('[data-action="nav"][data-view="instruments"]:visible').first().click();
    await page.waitForSelector('.instr-view .sec-bodymind');
    check("健康画面に身体記録を1つ表示", await page.locator('.instr-view .sec-bodymind').count() === 1);
    check("健康行なしは旧文言", (await page.locator(".bm-empty").textContent()).trim() === "今日の記録はまだありません");
    healthReady = true;
    await page.reload();
    await page.waitForFunction(() => document.querySelector(".bm-health-src")?.textContent.includes("09-03時点"));
    check("健康行ありは身体スキャンの事実文言", (await page.locator(".bm-empty").textContent()).trim() === "身体スキャンは作業の完了時に記録");

  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\n✅ v321 ALL PASS" : `\n❌ v321: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
