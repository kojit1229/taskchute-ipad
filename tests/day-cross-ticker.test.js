// tests/day-cross-ticker.test.js — 修正フェーズ 単位3(A3-H2)の機械検証。
// area-3-date-boundary-import.md: PWAを前面に置いたまま日付が変わると、visibilitychange等の
// 明示的な復帰イベントが無い限り runDailyOpen が呼ばれず、state.selectedDate/settings.lastOpenedDate
// が前日のまま固定されていた(深夜に追加したBlockが前日付けで記録される等)。
// 対応: startTimerTicker() の500ms周期ティック内で todayISO() !== lastOpenedDate を検知したら
// runDailyOpen() を呼ぶ(app.js内 startTimerTicker、コメント "A3-H2" 参照)。
//
// [1] 正例: アプリを開いたまま日付が変わると、visibilitychangeを一切発火させずに
//     ティッカーだけで selectedDate / settings.lastOpenedDate が新しい今日へ追従する。
// [2] 負例: 日付を跨がないティック(同日内)では lastOpenedDate は書き換わらない
//     (runDailyOpenの本体処理・saveStateが余計に走らないことの確認)。
// [3] 競合なし: 日跨ぎ後にvisibilitychangeも発火させて二重処理にならない
//     (lastOpenedDateが今日のまま・selectedDateが今日のまま壊れないことを確認)。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(23, 59, 0, 0);  // 日跨ぎ直前(23:59)からスタート
  const TODAY = isoDate(now0);
  const TOMORROW_DATE = new Date(now0.getTime() + 2 * 60 * 1000);  // 00:01 相当(2分後 = 日跨ぎ済み)
  const TOMORROW = isoDate(TOMORROW_DATE);

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    const before = await stateNow();
    check("前提: 起動直後は selectedDate/settings.lastOpenedDate が当日", before.selectedDate === TODAY && before.settings.lastOpenedDate === TODAY,
      JSON.stringify({ selectedDate: before.selectedDate, lastOpenedDate: before.settings.lastOpenedDate }));

    // ============================================================
    // [2] 負例: 日付を跨がないティック(23:59のまま)では何も変わらない
    // ============================================================
    console.log("[2] 日付を跨がないティックでは lastOpenedDate/selectedDate が書き換わらない");
    await page.waitForTimeout(1500);  // 500ms周期のティッカーを複数回通す(日は跨がない)
    const sameDay = await stateNow();
    check("同日内ティック後も lastOpenedDate は当日のまま", sameDay.settings.lastOpenedDate === TODAY, sameDay.settings.lastOpenedDate);
    check("同日内ティック後も selectedDate は当日のまま", sameDay.selectedDate === TODAY, sameDay.selectedDate);

    // ============================================================
    // [1] 正例: visibilitychangeを発火させずに、ティッカーだけで日跨ぎを検知する
    // ============================================================
    console.log("[1] visibilitychangeを発火させずに、ティッカーだけで日付が翌日へ追従する");
    await page.clock.setFixedTime(TOMORROW_DATE);  // 時刻だけ翌日00:01へ進める(イベントは発火しない)
    await page.waitForTimeout(1500);  // 500ms周期のティッカーが新しい日付を検知するのを待つ
    const afterCross = await stateNow();
    check("日跨ぎ後: settings.lastOpenedDate が翌日へ更新される(visibilitychange未発火)", afterCross.settings.lastOpenedDate === TOMORROW, afterCross.settings.lastOpenedDate);
    check("日跨ぎ後: selectedDate が翌日へ更新される(visibilitychange未発火)", afterCross.selectedDate === TOMORROW, afterCross.selectedDate);
    const todayBtnAfterCross = await page.locator('.datebar [data-action="today"]').count();
    check("日跨ぎ後は日付バーの『今日へ』ボタンが出ない(=新しい今日を見ている)", todayBtnAfterCross === 0);

    // ============================================================
    // [3] 競合なし: 日跨ぎ後にvisibilitychangeも発火させて二重処理にならない
    // ============================================================
    console.log("[3] 日跨ぎ検知後にvisibilitychangeが発火しても、二重処理で状態が壊れない(lastOpenedDateは翌日のまま)");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(400);
    const afterVisChange = await stateNow();
    check("visibilitychange後もlastOpenedDateは翌日のまま(巻き戻らない)", afterVisChange.settings.lastOpenedDate === TOMORROW, afterVisChange.settings.lastOpenedDate);
    check("visibilitychange後もselectedDateは翌日のまま(巻き戻らない)", afterVisChange.selectedDate === TOMORROW, afterVisChange.selectedDate);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ ALL PASS" : `\n❌ ${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
