// v128 検証: 体力予算(朝の睡眠心拍データから疲労を先取り判定)。K承認済み案件(2026-07-18)。
//
// (a) データなし: 当日sleep.logsが無い日は日報の体力予算行が省略される
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

  // v230でhomeタブと体力予算チップが撤去されたため、判定結果は現行の出力先である日報で検証する。
  async function seed({ sleepLogs = {}, view = "journal" } = {}) {
    await page.evaluate(({ KEY, sleepLogs, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.sleep = s.sleep || {};
      s.sleep.logs = sleepLogs;
      s.dailyDeclarations = {};
      s.weeklyWishes = {};
      // v162: seedState()の当日デモBlock(未完了)が残っていると「日報を生成」クリックが
      // 未完了理由モーダルに横取りされてしまう([7][8]の日報生成テストが本題ではないため)。
      s.blocks = [];
      s.selectedDate = TODAY;
      s.currentView = view;
      s.reports[TODAY] = "";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, sleepLogs, TODAY, view });
    await page.reload();
    await page.waitForTimeout(400);
  }
  async function generatedReport() {
    await page.click('[data-action="generate-report"]');
    await page.waitForFunction(({ KEY, TODAY }) => Boolean(JSON.parse(localStorage.getItem(KEY)).reports[TODAY]), { KEY, TODAY });
    return page.evaluate(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).reports[TODAY] || "", { KEY, TODAY });
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) データなし
    // ============================================================
    console.log("[1] 当日のsleep.logsが無い日は日報の体力予算行が省略される");
    await seed({ sleepLogs: {} });
    const noDataReport = await generatedReport();
    check("日報が生成される", noDataReport.startsWith(`# 日報 ${TODAY} (`), noDataReport.slice(0, 120));
    check("体力予算行が出ない", !noDataReport.includes("体力予算:"), noDataReport.slice(0, 400));

    // ============================================================
    // (b) 睡眠時間のみでの3段階判定
    // ============================================================
    console.log("[2] 睡眠7.5h(ベースラインなし)は「通常」");
    await seed({ sleepLogs: { [TODAY]: sleepLog({ sleepH: 7.5 }) } });
    const normalReport = await generatedReport();
    check("「通常」と出る", normalReport.includes("体力予算: 通常"), normalReport.slice(0, 400));

    console.log("[3] 睡眠6.0h(5.5〜6.5h)は「低予算」・根拠に睡眠時間が出る");
    await seed({ sleepLogs: { [TODAY]: sleepLog({ sleepH: 6.0 }) } });
    const lowReport = await generatedReport();
    check("「低予算」と出る", lowReport.includes("体力予算: 低予算"), lowReport.slice(0, 400));
    check("根拠に睡眠6.0hが出る", lowReport.includes("睡眠6.0h"), lowReport.slice(0, 400));

    console.log("[4] 睡眠5.0h(<5.5h)は「赤字」");
    await seed({ sleepLogs: { [TODAY]: sleepLog({ sleepH: 5.0 }) } });
    const deficitReport = await generatedReport();
    check("「赤字」と出る", deficitReport.includes("体力予算: 赤字"), deficitReport.slice(0, 400));
    check("根拠に睡眠5.0hが出る", deficitReport.includes("睡眠5.0h"), deficitReport.slice(0, 400));

    // ============================================================
    // (c) HRVベースラインを反映した判定
    // ============================================================
    console.log("[5] 過去7日分のHRVベースライン(50)に対し当日40(-20%)は「赤字」(睡眠時間は正常)");
    await seed({
      sleepLogs: { ...baselineLogs(7, { hrSleep: 60, hrvSleep: 50 }), [TODAY]: sleepLog({ sleepH: 8, hrSleep: 60, hrvSleep: 40 }) },
      view: "journal"
    });
    const hrvReport = await generatedReport();
    check("「赤字」と出る", hrvReport.includes("体力予算: 赤字"), hrvReport.slice(0, 400));
    check("根拠にHRVが出る", hrvReport.includes("HRV"), hrvReport.slice(0, 400));

    console.log("[6] サンプル不足(3日分)だと心拍系は判定に使われず、睡眠時間だけで「通常」");
    await seed({
      sleepLogs: { ...baselineLogs(3, { hrSleep: 60, hrvSleep: 50 }), [TODAY]: sleepLog({ sleepH: 8, hrSleep: 90, hrvSleep: 10 }) },
      view: "journal"
    });
    const insufficientReport = await generatedReport();
    check("HRV/HRが極端でもサンプル不足なら「通常」(睡眠8hのみで判定)",
      insufficientReport.includes("体力予算: 通常"), insufficientReport.slice(0, 400));

    // ============================================================
    // (d) 日報生成
    // ============================================================
    console.log("[7] 日報生成: 低予算日は達成率表の後に体力予算行が出る");
    await seed({ sleepLogs: { [TODAY]: sleepLog({ sleepH: 6.0 }) }, view: "journal" });
    const reportText1 = await generatedReport();
    check("`体力予算: 低予算`行が出力される", reportText1.includes("体力予算: 低予算(睡眠6.0h)"), reportText1.slice(0, 400));
    check("達成率表の後に出る(12週の行より後)",
      reportText1.indexOf("12週 今週の進捗") < reportText1.indexOf("体力予算:"), reportText1.slice(0, 500));

    console.log("[8] 日報生成: データなし日は体力予算行が省略される");
    await seed({ sleepLogs: {}, view: "journal" });
    const reportText2 = await generatedReport();
    check("体力予算行が出ない", !reportText2.includes("体力予算:"), reportText2.slice(0, 400));

    // ============================================================
    // (e) 旧stateでも起動できる(normalizeStateの後方互換。sleep.logs自体は既存フィールドのため
    //     新規migrationは無いが、conditionBudget()を呼ぶ日報生成がクラッシュしないことを確認)
    // ============================================================
    console.log("[9] sleepフィールドが無い旧stateでも例外なく起動できる");
    const failuresBefore = failures;
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.sleep;
      s.currentView = "journal";
      s.reports[TODAY] = "";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
    check("旧stateでも例外なく起動できる(pageerrorなし)", failures === failuresBefore);
    const legacyReport = await generatedReport();
    check("旧stateの日報では体力予算行が省略される", !legacyReport.includes("体力予算:"), legacyReport.slice(0, 400));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
