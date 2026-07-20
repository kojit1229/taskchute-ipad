// v128 検証: 体力予算(朝の睡眠心拍データから疲労を先取り判定)。K承認済み案件(2026-07-18)。
//
// (a) データなし: 当日sleep.logsが無い日はホームで灰色「データなし」、日報の行も省略される
// (b) 睡眠時間のみでの3段階判定(通常/低予算/赤字。ベースライン無し=サンプル不足でも判定できる)
// (c) HRVベースラインを反映した判定(7日分以上のサンプルがあれば心拍系も判定に使う)
// (d) 日報生成: `体力予算: ...`行がサマリの達成率表の後に出る/データなし日は行ごと省略
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
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);  // 実行時刻依存のフレーク回避(v117等と同じ方針)
  function isoOffset(n) {
    const d = new Date(now0);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const TODAY = isoOffset(0);

  function sleepLog({ sleepH = null, hrSleep = null, hrvSleep = null }) {
    return { bed: "23:00", wake: "07:00", sleepH, inBedH: null, deepH: null, qualityH: null,
      eff: null, hrSleep, hrvSleep, spo2Avg: null, importedAt: `${TODAY}T06:00:00` };
  }
  // 過去n日分、同一値のhr/hrvログを敷き詰める(ベースライン用サンプル)
  function baselineLogs(n, { hrSleep, hrvSleep }) {
    const out = {};
    for (let i = 1; i <= n; i++) out[isoOffset(-i)] = sleepLog({ sleepH: 7, hrSleep, hrvSleep });
    return out;
  }

  async function seed({ sleepLogs = {}, view = "home" } = {}) {
    await page.evaluate(({ KEY, sleepLogs, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.sleep = s.sleep || {};
      s.sleep.logs = sleepLogs;
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, sleepLogs, TODAY, view });
    await page.reload();
    await page.waitForTimeout(400);
  }
  const chipText = () => page.locator(".home-condition-budget-chip").innerText().catch(() => "");

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) データなし
    // ============================================================
    console.log("[1] 当日のsleep.logsが無い日はホームで「データなし」");
    await seed({ sleepLogs: {}, view: "home" });
    check("チップが1個出る", await page.locator(".home-condition-budget-chip").count() === 1);
    check("「データなし」と出る", (await chipText()).includes("データなし"), await chipText());

    // ============================================================
    // (b) 睡眠時間のみでの3段階判定
    // ============================================================
    console.log("[2] 睡眠7.5h(ベースラインなし)は「通常」");
    await seed({ sleepLogs: { [TODAY]: sleepLog({ sleepH: 7.5 }) }, view: "home" });
    check("「通常」と出る", (await chipText()).includes("通常"), await chipText());

    console.log("[3] 睡眠6.0h(5.5〜6.5h)は「低予算」・根拠に睡眠時間が出る");
    await seed({ sleepLogs: { [TODAY]: sleepLog({ sleepH: 6.0 }) }, view: "home" });
    check("「低予算」と出る", (await chipText()).includes("低予算"), await chipText());
    check("根拠に睡眠6.0hが出る", (await chipText()).includes("睡眠6.0h"), await chipText());

    console.log("[4] 睡眠5.0h(<5.5h)は「赤字」");
    await seed({ sleepLogs: { [TODAY]: sleepLog({ sleepH: 5.0 }) }, view: "home" });
    check("「赤字」と出る", (await chipText()).includes("赤字"), await chipText());
    check("根拠に睡眠5.0hが出る", (await chipText()).includes("睡眠5.0h"), await chipText());

    // ============================================================
    // (c) HRVベースラインを反映した判定
    // ============================================================
    console.log("[5] 過去7日分のHRVベースライン(50)に対し当日40(-20%)は「赤字」(睡眠時間は正常)");
    await seed({
      sleepLogs: { ...baselineLogs(7, { hrSleep: 60, hrvSleep: 50 }), [TODAY]: sleepLog({ sleepH: 8, hrSleep: 60, hrvSleep: 40 }) },
      view: "home"
    });
    check("「赤字」と出る", (await chipText()).includes("赤字"), await chipText());
    check("根拠にHRVが出る", (await chipText()).includes("HRV"), await chipText());

    console.log("[6] サンプル不足(3日分)だと心拍系は判定に使われず、睡眠時間だけで「通常」");
    await seed({
      sleepLogs: { ...baselineLogs(3, { hrSleep: 60, hrvSleep: 50 }), [TODAY]: sleepLog({ sleepH: 8, hrSleep: 90, hrvSleep: 10 }) },
      view: "home"
    });
    check("HRV/HRが極端でもサンプル不足なら「通常」(睡眠8hのみで判定)", (await chipText()).includes("通常"), await chipText());

    // ============================================================
    // (d) 日報生成
    // ============================================================
    console.log("[7] 日報生成: 低予算日は達成率表の後に体力予算行が出る");
    await seed({ sleepLogs: { [TODAY]: sleepLog({ sleepH: 6.0 }) }, view: "reports" });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(400);
    const reportText1 = await page.locator(".report-output").inputValue().catch(() => "");
    check("`体力予算: 低予算`行が出力される", reportText1.includes("体力予算: 低予算(睡眠6.0h)"), reportText1.slice(0, 400));
    check("達成率表の後に出る(12週の行より後)",
      reportText1.indexOf("12週 今週の進捗") < reportText1.indexOf("体力予算:"), reportText1.slice(0, 500));

    console.log("[8] 日報生成: データなし日は体力予算行が省略される");
    await seed({ sleepLogs: {}, view: "reports" });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(400);
    const reportText2 = await page.locator(".report-output").inputValue().catch(() => "");
    check("体力予算行が出ない", !reportText2.includes("体力予算:"), reportText2.slice(0, 400));

    // ============================================================
    // (e) 旧stateでも起動できる(normalizeStateの後方互換。sleep.logs自体は既存フィールドのため
    //     新規migrationは無いが、conditionBudget()を呼ぶ home render がクラッシュしないことを確認)
    // ============================================================
    console.log("[9] sleepフィールドが無い旧stateでも例外なく起動できる");
    const failuresBefore = failures;
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.sleep;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);
    check("旧stateでも例外なく起動できる(pageerrorなし)", failures === failuresBefore);
    check("チップは「データなし」で描画される", (await chipText()).includes("データなし"), await chipText());
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
