// tests/day-cross-ticker.test.js — 修正フェーズ 単位3(A3-H2)の機械検証。
// area-3-date-boundary-import.md: PWAを前面に置いたまま日付が変わると、visibilitychange等の
// 明示的な復帰イベントが無い限り runDailyOpen が呼ばれず、state.selectedDate/settings.lastOpenedDate
// が前日のまま固定されていた(深夜に追加したBlockが前日付けで記録される等)。
// 対応: startTimerTicker() の500ms周期ティック内で todayISO() !== lastOpenedDate を検知したら
// runDailyOpen() を呼ぶ(app.js内 startTimerTicker、コメント "A3-H2" 参照)。
//
// [1] 正例: アプリを開いたまま日付が変わると、visibilitychangeを一切発火させずに
//     ティッカーだけで selectedDate / settings.lastOpenedDate が新しい今日へ追従する。
//     「今日へ」ボタンの有無は.datebarが実際にレンダリングされるtimelineビューで確認する
//     (第2回レビュー指摘: today/execビューには.datebarが無く、常にcount===0で空振りになっていた)。
// [2] 負例: 日付を跨がないティック(同日内)では lastOpenedDate は書き換わらない
//     (runDailyOpenの本体処理・saveStateが余計に走らないことの確認)。
// [3] 競合なし: 日跨ぎ検知後にvisibilitychangeも発火させても、dataModifiedAtが2回目は
//     進まない(=saveStateが再実行されない)ことを計数で検証する(第2回レビュー指摘:
//     旧版はlastOpenedDate/selectedDateの値だけを見ており、visibilitychange側のrunDailyOpen
//     呼び出し単体でも同じ値に収束するため、ティッカー側の修正が無くても偶然一致していた)。
//     時刻を跨がない範囲でさらに進めてからvisibilitychangeを発火させ、dataModifiedAtという
//     「実データ変更」の証跡が2回目は増えない(=saveState()を再度通っていない)ことで
//     二重処理が起きていないと判定する。
// [4a] 2日以上の日跨ぎ(アプリを開いたまま48h超スリープ/放置)でも、中間日に留まらず
//      最終日へ直接追従する。
// [4b] document.hidden(バックグラウンド相当)のまま日を跨ぎ、その後visibilitychangeで
//      復帰しても二重処理にならない。
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
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now0 = new Date();
  now0.setHours(23, 59, 0, 0);  // 日跨ぎ直前(23:59)からスタート
  const TODAY = isoDate(now0);
  const TOMORROW_DATE = new Date(now0.getTime() + 2 * 60 * 1000);  // 00:01 相当(2分後 = 日跨ぎ済み)
  const TOMORROW = isoDate(TOMORROW_DATE);
  // [3] 日は跨がないが時刻だけ少し進めた地点(saveStateの再実行有無をdataModifiedAtの変化で判定するため)
  const TOMORROW_LATER_DATE = new Date(TOMORROW_DATE.getTime() + 5000);
  // [4a] TOMORROWからさらに2日進める(中間日をまたいで最終日へ直接追従するか確認)
  const CROSS2_DATE = new Date(TOMORROW_LATER_DATE.getTime() + 2 * DAY_MS + 60000);
  const CROSS2 = isoDate(CROSS2_DATE);
  // [4b] CROSS2からさらに1日進める(document.hidden中の日跨ぎ用)
  const CROSS3_DATE = new Date(CROSS2_DATE.getTime() + DAY_MS + 60000);
  const CROSS3 = isoDate(CROSS3_DATE);
  const CROSS3_LATER_DATE = new Date(CROSS3_DATE.getTime() + 5000);

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }
  function setVisibility(value) {
    return page.evaluate((value) => {
      Object.defineProperty(document, "visibilityState", { value, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    }, value);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    const before = await stateNow();
    check("前提: 起動直後は selectedDate/settings.lastOpenedDate が当日", before.selectedDate === TODAY && before.settings.lastOpenedDate === TODAY,
      JSON.stringify({ selectedDate: before.selectedDate, lastOpenedDate: before.settings.lastOpenedDate }));

    // 「今日へ」ボタン(.datebar [data-action=\"today\"])はtoday/execビューには存在しないため、
    // .datebarが実際に出るtimelineビューへ切り替えてから以降の検証を行う。
    await page.click('[data-action="nav"][data-view="timeline"]');
    await page.waitForTimeout(300);
    check("前提: timelineビューに.datebarが実際に描画される", (await page.locator(".datebar").count()) === 1);

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
    check("日跨ぎ後、timelineビューの日付バーに『今日へ』ボタンが出ない(=新しい今日を見ている。前提: .datebarが実在するビュー)",
      todayBtnAfterCross === 0, todayBtnAfterCross);

    // ============================================================
    // [3] 競合なし: 日跨ぎ検知後にvisibilitychangeも発火させても、dataModifiedAtが
    //     2回目は進まない(=saveStateが再実行されない)
    // ============================================================
    console.log("[3] 日跨ぎ検知後にvisibilitychangeが発火しても、dataModifiedAtが増えない(saveStateの二重実行なし)");
    const dm1 = afterCross.dataModifiedAt;
    check("(準備)日跨ぎ直後にdataModifiedAtが記録されている", typeof dm1 === "string" && dm1.length > 0, dm1);
    // 日は跨がない範囲でさらに時刻を進める(nowDateTime()は秒精度なので、もし
    // visibilitychange側で余計にsaveState()が走れば、この後のdataModifiedAtは
    // 進んだ時刻を反映して dm1 と異なる値になるはず)
    await page.clock.setFixedTime(TOMORROW_LATER_DATE);
    await setVisibility("visible");
    await page.waitForTimeout(400);
    const afterVisChange = await stateNow();
    check("visibilitychange後もlastOpenedDateは翌日のまま(巻き戻らない)", afterVisChange.settings.lastOpenedDate === TOMORROW, afterVisChange.settings.lastOpenedDate);
    check("visibilitychange後もselectedDateは翌日のまま(巻き戻らない)", afterVisChange.selectedDate === TOMORROW, afterVisChange.selectedDate);
    check("visibilitychange後もdataModifiedAtが増えていない(=saveStateが再実行されていない。runDailyOpenの二重処理防止の実証)",
      afterVisChange.dataModifiedAt === dm1, JSON.stringify({ dm1, dm2: afterVisChange.dataModifiedAt }));

    // ============================================================
    // [4a] 2日以上の日跨ぎ: 中間日に留まらず最終日へ直接追従する
    // ============================================================
    console.log("[4a] 2日以上の日跨ぎ(アプリを開いたまま放置)でも、最終日へ直接追従する");
    await page.clock.setFixedTime(CROSS2_DATE);
    await page.waitForTimeout(1500);
    const after2DayCross = await stateNow();
    check("2日以上の日跨ぎ後: settings.lastOpenedDate が最終日へ直接更新される(中間日に留まらない)",
      after2DayCross.settings.lastOpenedDate === CROSS2, after2DayCross.settings.lastOpenedDate);
    check("2日以上の日跨ぎ後: selectedDate が最終日へ直接更新される(中間日に留まらない)",
      after2DayCross.selectedDate === CROSS2, after2DayCross.selectedDate);

    // ============================================================
    // [4b] document.hidden(バックグラウンド相当)のまま日を跨ぎ、その後visibilitychangeで
    //      復帰しても二重処理にならない
    // ============================================================
    console.log("[4b] document.hidden中に日を跨ぎ、visibilitychange復帰でも二重処理にならない");
    await setVisibility("hidden");  // アプリがバックグラウンドへ回った状態を模す
    await page.clock.setFixedTime(CROSS3_DATE);
    await page.waitForTimeout(1500);  // hidden中でもティッカー自体は動き続ける前提の確認
    const afterHiddenCross = await stateNow();
    check("hidden中でも日跨ぎがティッカーだけで検知される(visibilityStateに依存しない)",
      afterHiddenCross.settings.lastOpenedDate === CROSS3 && afterHiddenCross.selectedDate === CROSS3,
      JSON.stringify({ lastOpenedDate: afterHiddenCross.settings.lastOpenedDate, selectedDate: afterHiddenCross.selectedDate }));
    const dm3 = afterHiddenCross.dataModifiedAt;

    await page.clock.setFixedTime(CROSS3_LATER_DATE);  // 日を跨がない範囲でさらに進めてから復帰
    await setVisibility("visible");  // フォアグラウンド復帰
    await page.waitForTimeout(400);
    const afterHiddenResume = await stateNow();
    check("visible復帰後もlastOpenedDateは同じ日のまま(巻き戻り/余計な進行なし)",
      afterHiddenResume.settings.lastOpenedDate === CROSS3, afterHiddenResume.settings.lastOpenedDate);
    check("visible復帰後もselectedDateは同じ日のまま(巻き戻り/余計な進行なし)",
      afterHiddenResume.selectedDate === CROSS3, afterHiddenResume.selectedDate);
    check("visible復帰後もdataModifiedAtが増えていない(=hidden中のティッカー検知 + 復帰時visibilitychangeの二重処理なし)",
      afterHiddenResume.dataModifiedAt === dm3, JSON.stringify({ dm3, dm4: afterHiddenResume.dataModifiedAt }));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ ALL PASS" : `\n❌ ${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
