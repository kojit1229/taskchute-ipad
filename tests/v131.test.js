// v131 検証: 体力予算・睡眠カードの鮮度フォールバック(AutoSleepが前夜分を21:00にしか
// 確定しないため、朝の時点では当日キーが構造的に無い問題への対策)。K承認済み案件(2026-07-20)。
//
// (a) 当日あり: 従来どおり(ラベル無し)
// (b) 前日のみ(2日前まで遡ってフォールバック): 睡眠カード・チップ・日報行に「M/D朝」ラベル
// (c) 2日前のみ: 同上(境界値maxAgeDays=2)
// (d) 3日以上前しかない/1件も無い: 赤警告+「データなし」(フォールバック対象外)
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
  now0.setHours(10, 0, 0, 0);
  function isoOffset(n) {
    const d = new Date(now0);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const TODAY = isoOffset(0);
  const YEST = isoOffset(-1);
  const TWO_AGO = isoOffset(-2);
  const THREE_AGO = isoOffset(-3);
  const shortDate = (s) => { const p = s.split("-"); return `${+p[1]}/${+p[2]}`; };

  function sleepLog({ sleepH = 7.5 }) {
    return { bed: "23:00", wake: "07:00", sleepH, inBedH: null, deepH: null, qualityH: null,
      eff: null, hrSleep: null, hrvSleep: null, spo2Avg: null, importedAt: `${YEST}T06:00:00` };
  }

  // v147レビュー対応: 体力予算チップは「今日の状態」カード(homeTodayStatusCard)のdetails内に
  // 移動しており、そのカードは宣言済み+週Wish設定済み+体力予算正常+電池残量健全の4つが
  // 揃うと非表示になる。このテストは体力予算のフォールバック判定ロジックだけを見たいため、
  // 宣言・週Wishを明示的に毎回未設定へリセットし(dailyDeclarations/weeklyWishes={})、カードが
  // 常に表示されることを保証する(「一度開けば済む」という暗黙の前提に依存しない)。
  async function seed({ sleepLogs = {}, view = "home" } = {}) {
    await page.evaluate(({ KEY, sleepLogs, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.sleep = s.sleep || {};
      s.sleep.logs = sleepLogs;
      s.dailyDeclarations = {};
      s.weeklyWishes = {};
      // v162: seedState()の当日デモBlock(未完了)が残っていると「日報を生成」クリックが
      // 未完了理由モーダルに横取りされてしまう(日報生成テストが本題ではないため)。
      s.blocks = [];
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, sleepLogs, TODAY, view });
    await page.reload();
    await page.waitForTimeout(400);
  }
  // v230: home体力予算チップ撤去後の同等出力は日報の体力予算行で検証する。
  const chipText = async () => {
    if (await page.locator('#app[data-view="journal"]').count() === 0) {
      await page.click('[data-action="nav"][data-view="journal"]');
      await page.waitForTimeout(150);
    }
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(250);
    const report = await page.evaluate(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).reports[TODAY] || "", { KEY, TODAY });
    return report.split("\n").find((line) => line.startsWith("体力予算:")) || "";
  };
  const sleepCardText = () => page.locator(".row").filter({ hasText: "睡眠" }).first().innerText().catch(() => "");

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) 当日あり: 従来どおり(ラベル無し)
    // ============================================================
    console.log("[1] 当日分のログがあればラベル無しで通常表示");
    await seed({ sleepLogs: { [TODAY]: sleepLog({ sleepH: 6.0 }) }, view: "home" });
    check("チップに「低予算」が出る", (await chipText()).includes("低予算"), await chipText());
    check("日付ラベル(M/D朝)は出ない", !(await chipText()).includes("朝"), await chipText());

    // ============================================================
    // (b) 前日のみ: フォールバックしラベルが付く
    // ============================================================
    console.log("[2] 前日のみログがある場合、チップ・睡眠カードに「M/D朝」ラベルが付く");
    await seed({ sleepLogs: { [YEST]: sleepLog({ sleepH: 6.0 }) }, view: "home" });
    check("チップに「低予算」が出る(前日分をフォールバック)", (await chipText()).includes("低予算"), await chipText());
    check(`チップに「${shortDate(YEST)}朝」ラベルが出る`, (await chipText()).includes(`${shortDate(YEST)}朝`), await chipText());

    await seed({ sleepLogs: { [YEST]: sleepLog({ sleepH: 7.5 }) }, view: "journal" });
    check(`睡眠カードのヘッダに「${shortDate(YEST)}朝のデータ」が出る`,
      (await sleepCardText()).includes(`${shortDate(YEST)}朝のデータ`), await sleepCardText());
    check("「AutoSleep未確定」の注記が出る", (await sleepCardText()).includes("AutoSleep未確定"), await sleepCardText());

    console.log("[3] 日報生成: 前日分をフォールバックした体力予算行に日付ラベルが付く");
    await seed({ sleepLogs: { [YEST]: sleepLog({ sleepH: 6.0 }) }, view: "journal" });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(400);
    const reportText1 = await page.evaluate(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).reports[TODAY] || "", { KEY, TODAY });
    check(`日報に「体力予算: 低予算(${shortDate(YEST)}朝: 睡眠6.0h)」が出る`,
      reportText1.includes(`体力予算: 低予算(${shortDate(YEST)}朝: 睡眠6.0h)`), reportText1.slice(0, 500));

    // ============================================================
    // (c) 2日前のみ: 境界値(maxAgeDays=2)でも同様にフォールバックする
    // ============================================================
    console.log("[4] 2日前のみログがある場合もフォールバックする(境界値)");
    await seed({ sleepLogs: { [TWO_AGO]: sleepLog({ sleepH: 7.5 }) }, view: "home" });
    check("「通常」が出る(2日前分をフォールバック)", (await chipText()).includes("通常"), await chipText());
    check(`チップに「${shortDate(TWO_AGO)}朝」ラベルが出る(根拠0件でもラベルは出る)`,
      (await chipText()).includes(`${shortDate(TWO_AGO)}朝`), await chipText());

    // ============================================================
    // (d) 3日以上前しかない/1件も無い: フォールバック対象外、赤警告+データなし
    // ============================================================
    console.log("[5] 3日前のログしか無い場合はフォールバック対象外(赤警告+データなし)");
    await seed({ sleepLogs: { [THREE_AGO]: sleepLog({ sleepH: 5.0 }) }, view: "home" });
    check("対象ログが無ければ日報に体力予算行を出さない", (await chipText()) === "", await chipText());

    await seed({ sleepLogs: { [THREE_AGO]: sleepLog({ sleepH: 5.0 }) }, view: "journal" });
    check("睡眠カードは赤警告のまま(3日前は対象外)",
      await page.locator(".row", { hasText: "⚠️ 前夜の睡眠CSVが未アップロードです" }).count() === 1);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
