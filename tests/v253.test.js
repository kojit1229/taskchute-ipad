// v253: 固定化ルーティンの計器盤表示とprotection実行率除外。
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");

const PORT = randomPort();
const KEY = STATE_KEY;
const TODAY = "2026-08-24";
let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const { habitStreakStats } = await import(pathToFileURL(path.join(__dirname, "..", "src", "core", "habit-streak.js")).href);
  const longRun = habitStreakStats({ kind: "daily", streakSince: "2026-07-20" }, { logs: {} }, TODAY);
  check("30日超のchallengeDayを暦日起点で返す", longRun.challengeDay === 36, JSON.stringify(longRun));

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  const rule = (id, title, kind, streakSince, extra = {}) => ({
    id, title, category: "習慣", taskId: "", kind, streakSince,
    startTime: "09:00", endTime: "09:30", anchorDate: streakSince || TODAY,
    exceptionDates: [], createdAt: `${TODAY}T07:00`, updatedAt: `${TODAY}T07:00`, deleted: false, ...extra
  });
  const block = (id, ruleId) => ({
    id, title: "朝の読書", recurrenceGroupId: ruleId, category: "習慣", taskId: "", date: TODAY,
    plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`, actualStartAt: "", actualEndAt: "",
    completed: false, charge: 0, discharge: 0, comment: "", createdAt: `${TODAY}T08:00`, updatedAt: `${TODAY}T08:00`, deleted: false
  });

  async function seed({ recurrences = [], habitStreaks = {}, blocks = [], view = "instruments", earlyBird = {}, gym = [] }) {
    await page.goto(`http://localhost:${PORT}/styles.css`);
    await page.evaluate(({ KEY, recurrences, habitStreaks, blocks, view, earlyBird, gym, TODAY }) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      Object.assign(state, { recurrences, habitStreaks, blocks, currentView: view, selectedDate: TODAY, timelineMode: "planned" });
      state.earlyBird = { logs: earlyBird };
      state.condition ||= { logs: {} };
      state.condition.logs = { [TODAY]: { gym } };
      localStorage.setItem(KEY, JSON.stringify(state));
    }, { KEY, recurrences, habitStreaks, blocks, view, earlyBird, gym, TODAY });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector(view === "instruments" ? ".instr-view" : ".timeline");
  }

  try {
    await page.clock.setFixedTime(new Date(2026, 7, 24, 12, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] dailyを2日連続完了すると計器盤へストリーク2・2/30日目を表示");
    const daily = rule("daily", "朝の読書", "daily", "2026-08-23");
    await seed({ recurrences: [daily], habitStreaks: { daily: { logs: { "2026-08-23": { doneAt: "2026-08-23T09:30" } } } }, blocks: [block("daily-block", "daily")], view: "timeline" });
    await page.locator('[data-action="toggle-block"][data-id="daily-block"]').click();
    await page.waitForFunction(({ KEY, TODAY }) => Boolean(JSON.parse(localStorage.getItem(KEY)).habitStreaks.daily.logs[TODAY]), { KEY, TODAY });
    await page.evaluate((KEY) => { const state = JSON.parse(localStorage.getItem(KEY)); state.currentView = "instruments"; localStorage.setItem(KEY, JSON.stringify(state)); }, KEY);
    await page.reload();
    const primary = page.locator(".instr-habit-panel.is-primary");
    check("固定化1枠目を主役パネルで表示", await primary.count() === 1);
    check("現在ストリーク2", (await primary.locator(".instr-streak-hero strong").textContent()) === "2日連続");
    check("2/30日目", (await primary.locator(".instr-habit-challenge strong").textContent()) === "2/30日目");

    console.log("[2] weekdaysは土日をスキップし、未完了日は現在値だけリセット");
    const rules = [
      daily,
      rule("weekday", "平日の片づけ", "weekdays", "2026-08-21"),
      rule("reset", "日記", "daily", "2026-08-20")
    ];
    const habits = {
      daily: { logs: { "2026-08-23": {}, [TODAY]: {} } },
      weekday: { logs: { "2026-08-21": {}, [TODAY]: {} } },
      reset: { logs: { "2026-08-20": {}, "2026-08-21": {}, [TODAY]: {} } }
    };
    await seed({ recurrences: rules, habitStreaks: habits });
    const panels = page.locator(".instr-habit-panel");
    check("固定化3件を順番どおり表示", await panels.count() === 3);
    check("2・3枠目はsecondary", await page.locator(".instr-habit-panel.is-secondary").count() === 2);
    check("weekdaysの金曜→月曜は2連続", (await panels.nth(1).locator(".instr-streak-hero strong").textContent()) === "2日連続");
    check("weekdays実施率は土日を分母から除外", (await panels.nth(1).locator(".instr-stat-cell strong").nth(2).textContent()) === "100%");
    check("未完了日後は現在1・自己ベスト2", (await panels.nth(2).locator(".instr-streak-hero strong").textContent()) === "1日連続"
      && (await panels.nth(2).locator(".instr-stat-cell strong").first().textContent()) === "2日");

    console.log("[3] 固定化0件・解除・削除済みルールは非表示");
    await seed({ recurrences: [rule("off", "解除済み", "daily", null), rule("deleted", "削除済み", "daily", "2026-08-01", { deleted: true })] });
    check("対象外ルールだけなら習慣パネル0件", await page.locator(".instr-habit-panel").count() === 0);

    console.log("[4] EARLY BIRD・IRONの既存主要DOMと表示値を維持");
    const earlyBird = { "2026-08-22": {}, "2026-08-23": {}, [TODAY]: {} };
    const gym = [{ exercise: "ベンチプレス", weight: 60, reps: 10, at: `${TODAY}T09:00` }];
    await seed({ earlyBird, gym });
    check("早起きは3日連続・自己ベスト3・累計3・28ドット", (await page.locator(".instr-early-bird .instr-streak-hero strong").textContent()) === "3日連続"
      && (await page.locator(".instr-early-bird .instr-stat-cell strong").allTextContents()).join("|") === "3日|3回|3回"
      && await page.locator(".instr-early-bird .instr-dot").count() === 28);
    check("IRONは600kg・既存actionを維持", (await page.locator(".instr-iron-today strong").textContent()).includes("600")
      && await page.locator('.instr-iron-log[data-action="instruments-open-iron-log"]').count() === 1);

    console.log("[5] 30日超は静かな達成済み表現、390pxで横崩れなし");
    await seed({ recurrences: [rule("long", "長い習慣名でも崩れない固定化ルーティン", "daily", "2026-07-20")] });
    check("達成済み(36日目)を表示", (await page.locator(".instr-habit-challenge strong").textContent()) === "達成済み(36日目)");
    const layout = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    check("390pxで画面全体の横スクロールなし", layout.scroll <= layout.client, JSON.stringify(layout));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nv253: 全件成功" : `\nv253: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
