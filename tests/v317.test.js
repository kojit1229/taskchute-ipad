// v317: ジャーナルを日付軸ライフログ(朝→身体→行動→心→暮らし→お金→本文)へ再配置する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-02";
const PREV = "2026-09-01";
const FUND_SUMMARY_60 = "1234567890".repeat(6);
const FUND_BODY = `### ${FUND_SUMMARY_60}切り捨て対象\n2行目は要約に含めない`;
let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function block(id, date, start, end, completed, charge = 0, discharge = 0) {
  return {
    id, taskId: `task-${id}`, date, title: `Block ${id}`, category: "作業",
    plannedStartAt: `${date}T${start}`, plannedEndAt: `${date}T${end || start}`,
    actualStartAt: `${date}T${start}`, actualEndAt: end ? `${date}T${end}` : "", completed,
    charge, discharge, comment: "", recurrenceGroupId: "", source: "", deleted: false,
    createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`
  };
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);

  const health = {
    schema: 1, generated_at: "2026-09-02T10:00:00+09:00",
    days: [PREV, TODAY].map((date, index) => ({
      date, sleep_min: 420 + index * 5, bed_time: "23:45", wake_time: "06:50",
      steps: 7000 + index * 1000, resting_hr: 58, hrv_sdnn: 41, weight_kg: 60
    }))
  };
  const reportIndex = {
    generatedAt: "2026-09-02T01:00:00Z",
    files: [{ name: `FABLE FUND日誌_${TODAY}.md`, date: TODAY, kind: "fundJournal" }]
  };
  await page.route((url) => url.hostname === "api.github.com", (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.endsWith("/contents/karada/health-daily.json")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(health) });
    }
    if (path.endsWith("/contents/taskchute/report-index.json")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reportIndex) });
    }
    if (path.endsWith(`/contents/taskchute/FABLE FUND日誌_${TODAY}.md`)) {
      return route.fulfill({ status: 200, contentType: "text/markdown", body: FUND_BODY });
    }
    return route.fallback();
  });

  const todayBlocks = [
    block("done-1", TODAY, "08:00", "08:30", true, 2, 0),
    block("done-2", TODAY, "09:00", "09:30", true, 0, 1),
    block("done-3", TODAY, "10:00", "10:30", true, 3, 1),
    block("running", TODAY, "11:00", "", false, 5, 0),
    { ...block("unstarted", TODAY, "12:00", "", false, 0, 4), actualStartAt: "" }
  ];
  const prevBlock = block("prev-done", PREV, "15:00", "15:45", true, 1, 2);

  async function seed({ blocks = [...todayBlocks, prevBlock], scans = true, stores = true, date = TODAY } = {}) {
    await page.evaluate(({ key, TODAY, PREV, blocks, scans, stores, date }) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.currentView = "journal";
      s.selectedDate = date;
      s.settings.aiReportType = "fundJournal";
      s.projects = [{ id: "project-v317", title: "P", status: "active", deleted: false }];
      s.tasks = blocks.map((b) => ({ id: b.taskId, projectId: "project-v317", title: b.title, status: "active", kind: "project", deleted: false }));
      s.blocks = blocks;
      s.condition.logs[TODAY] = {
        morningRecordedAt: `${TODAY}T07:00`, meds: true, capacity: "normal", eveningMood: 7,
        eveningNote: "穏やかな一日", gym: [
          { id: "gym-1", exercise: "スクワット", weight: 60, reps: 8, at: `${TODAY}T18:00`, updatedAt: `${TODAY}T18:00` },
          { id: "gym-2", exercise: "ベンチプレス", weight: 40, reps: 10, at: `${TODAY}T18:10`, updatedAt: `${TODAY}T18:10` }
        ]
      };
      s.settings.morningEnergyLog[TODAY] = 7;
      s.sleep.logs[TODAY] = { bed: "23:30", wake: "06:30", sleepH: 7, eff: 90, deepH: 1.5 };
      s.bodyScans = scans ? [
        { id: "scan-1", dateTime: `${TODAY}T10:30`, fatigue: 2, recovery: 1, updatedAt: `${TODAY}T10:30` },
        { id: "scan-2", dateTime: `${TODAY}T18:30`, fatigue: 3, recovery: 4, updatedAt: `${TODAY}T18:30` }
      ] : [];
      s.writeMeditations = [{ id: `wm_${TODAY}`, date: TODAY, discharge: [{ id: "d", text: "疲れ" }], charge: [{ id: "c", text: "散歩" }], dischargeTalk: "", chargeTalk: "", updatedAt: `${TODAY}T20:00`, deleted: false }];
      s.storeVisits = stores ? [{ id: "store-v317", date: TODAY, name: "テスト書店", url: "", comment: "よかった", createdAt: `${TODAY}T17:00`, updatedAt: `${TODAY}T17:00`, deleted: false }] : [];
      s.journals[TODAY] = "# v317本文";
      s.journals[PREV] = "# 前日本文";
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, TODAY, PREV, blocks, scans, stores, date });
    await page.reload();
    await page.waitForSelector('#app[data-view="journal"]');
  }

  try {
    await page.clock.setFixedTime(new Date(2026, 8, 2, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.waitForFunction(() => document.querySelector(".bm-health-src")?.textContent.includes("09-02時点"));
    await seed();

    console.log("[1] 全種別と節のDOM順");
    check("本文キャッシュ無しでは一覧に日誌があってもMONEY節を省略", await page.locator('[data-journal-section="money"]').count() === 0);
    await page.locator('[data-action="nav"][data-view="ai-reports"]').first().evaluate((button) => button.click());
    await page.waitForSelector(`[data-report-file="FABLE FUND日誌_${TODAY}.md"][data-report-loaded="1"]`);
    await page.locator('[data-action="nav"][data-view="journal"]').first().evaluate((button) => button.click());
    await page.waitForSelector('[data-journal-section="money"]');
    const order = await page.locator(".journal-panel-today > [data-journal-section]").evaluateAll((nodes) => nodes.map((node) => node.dataset.journalSection));
    check("節が MORNING→BODY→FLIGHT LOG→MIND→LIFE→MONEY→JOURNAL LOG 順", JSON.stringify(order) === JSON.stringify(["morning", "body", "flight", "mind", "life", "money", "journal"]), JSON.stringify(order));
    check("進行中・未着手Blockの充放電を除外して日付サマリを表示", (await page.locator(".journal-daysummary").textContent()).includes("着手率 80%・完了 3 Block・充放電 +3"));
    const journalText = await page.locator(".journal-panel-today").textContent();
    check("筋トレ2セット・身体スキャン集計・健康日次・睡眠・書く瞑想・お店が同じ日付ページにある",
      ["スクワット", "ベンチプレス", "疲労Σ5・回復Σ5・2件", "歩数 8,000", "前夜の睡眠", "疲れ", "テスト書店"].every((text) => journalText.includes(text)), journalText);
    check("FLIGHT LOGは終了実績3件だけ", await page.locator(".journal-flight-row").count() === 3);
    check("MONEYは取得済み本文の見出し記号を除いた先頭60字だけ表示", (await page.locator('[data-journal-section="money"] > .fold-body').textContent()).trim() === FUND_SUMMARY_60);
    check("日報ボタン群はJOURNAL LOG節の先頭", await page.locator('[data-journal-section="journal"] > .fold-body > .row [data-action="generate-report"]').count() === 1);
    check("新設3節は既定open", await page.locator('[data-journal-section="body"][open], [data-journal-section="flight"][open], [data-journal-section="money"][open]').count() === 3);
    for (const section of ["body", "flight", "money"]) await page.locator(`[data-journal-section="${section}"] > summary`).click();
    await page.click('[data-action="toggle-meds"]');
    check("bodyLog/flightLog/moneyの手動closedを再描画後も記憶", await page.locator('[data-journal-section="body"]:not([open]), [data-journal-section="flight"]:not([open]), [data-journal-section="money"]:not([open])').count() === 3);

    console.log("[2] 表駆動: 条件付き表示と入力節");
    const cases = [
      { name: "flightあり", blocks: [todayBlocks[0]], scans: false, stores: false, flight: true, scan: false, store: false },
      { name: "flightなし", blocks: [todayBlocks[3]], scans: false, stores: false, flight: false, scan: false, store: false },
      { name: "scanあり", blocks: [todayBlocks[3]], scans: true, stores: false, flight: false, scan: true, store: false },
      { name: "scanなし", blocks: [todayBlocks[3]], scans: false, stores: false, flight: false, scan: false, store: false },
      { name: "storeあり", blocks: [todayBlocks[3]], scans: false, stores: true, flight: false, scan: false, store: true },
      { name: "storeなし", blocks: [todayBlocks[3]], scans: false, stores: false, flight: false, scan: false, store: false }
    ];
    for (const testCase of cases) {
      await seed(testCase);
      const actual = {
        flight: await page.locator('[data-journal-section="flight"]').count() === 1,
        scan: await page.locator(".journal-bodyscan").count() === 1,
        store: (await page.locator(".store-visit-card").textContent()).includes("テスト書店")
      };
      const inputsRemain = await page.locator('[data-journal-section="morning"], [data-journal-section="body"], [data-journal-section="mind"], [data-journal-section="life"], [data-journal-section="journal"]').count() === 5;
      check(`${testCase.name}: 空表示と入力節`, actual.flight === testCase.flight && actual.scan === testCase.scan && actual.store === testCase.store && inputsRemain, JSON.stringify(actual));
    }

    console.log("[3] 書く瞑想・お店の差分DOMパッチ");
    await seed();
    await page.locator(".journal-segment-writeMeditation > summary").click();
    await page.evaluate(() => { window.__journalNode317 = document.querySelector("[data-journal-date]"); });
    await page.fill("#km-charge-input", "差分追加");
    await page.click('[data-action="km-chip-add"][data-kind="charge"]');
    const kmPatch = await page.evaluate(() => ({ same: window.__journalNode317 === document.querySelector("[data-journal-date]"), focused: document.activeElement?.id === "km-charge-input" }));
    check("書く瞑想追加は本文nodeとinput focusを維持", kmPatch.same && kmPatch.focused, JSON.stringify(kmPatch));
    await page.click('[data-action="store-visit-add"]');
    await page.fill('[data-modal-field="name"]', "差分カフェ");
    await page.click('[data-action="modal-save"]');
    const storePatch = await page.evaluate(() => window.__journalNode317 === document.querySelector("[data-journal-date]"));
    check("お店追加は本文nodeを維持して一覧だけ更新", storePatch && (await page.locator(".store-visit-card").textContent()).includes("差分カフェ"));
    await page.evaluate(() => {
      window.__v317SetItem = Storage.prototype.setItem;
      window.__v317ClassAdd = DOMTokenList.prototype.add;
      window.__v317ToastShows = 0;
      Storage.prototype.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
      DOMTokenList.prototype.add = function(...tokens) {
        if (this === document.getElementById("toast")?.classList && tokens.includes("show")) window.__v317ToastShows++;
        return window.__v317ClassAdd.apply(this, tokens);
      };
    });
    await page.click('[data-action="store-visit-add"]');
    await page.fill('[data-modal-field="name"]', "容量超過テスト店");
    await page.click('[data-action="modal-save"]');
    const quotaToast = await page.evaluate(() => ({ count: window.__v317ToastShows, text: document.getElementById("toast")?.textContent || "" }));
    await page.evaluate(() => {
      Storage.prototype.setItem = window.__v317SetItem;
      DOMTokenList.prototype.add = window.__v317ClassAdd;
    });
    check("お店の保存失敗時は容量超過トーストだけを1回表示", quotaToast.count === 1 && quotaToast.text.includes("保存に失敗") && !quotaToast.text.includes("お店を記録しました"), JSON.stringify(quotaToast));

    console.log("[4] 過去日と健康日次の完全一致");
    await seed();
    await page.click('[data-action="date-prev"]');
    check("前日は前日の完了Blockだけ", await page.locator(".journal-flight-row").count() === 1 && (await page.locator(".journal-flight-row").textContent()).includes("prev-done"));
    check("前日健康行がある時だけ前日値", (await page.locator('[data-journal-section="morning"] .bm-health').textContent()).includes("歩数 7,000"));
    check("FUND日誌が無い過去日はMONEY節ごと省略", await page.locator('[data-journal-section="money"]').count() === 0);
    await page.click('[data-action="date-prev"]');
    check("同日健康行が無い過去日は健康日次を省略", await page.locator('[data-journal-section="morning"] .bm-health').count() === 0);
    check("stateに無い過去日のBlockはFLIGHT LOG節ごと省略", await page.locator('[data-journal-section="flight"]').count() === 0);

    console.log("[5][6] 390px・表示専用・pageerror");
    await seed();
    const before = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await page.waitForTimeout(200);
    const after = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    check("390×844で横スクロールなし", await page.evaluate(() => document.documentElement.scrollWidth <= 390));
    check("表示だけではstate不変", before === after);
    check("pageerror 0", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ v317 ALL PASS" : `\n❌ v317: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
