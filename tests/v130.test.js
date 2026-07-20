// v130: 睡眠CSV取込の失敗メッセージを、原因(ファイルが空/表記が読めない)で区別する。
// 従来はどちらも「睡眠データを読み取れませんでした」で原因不明だった。
//
// (a) データ行が無いCSV(ヘッダーのみ)→「データ行がありませんでした」の専用メッセージ
// (b) 完全に空のファイル(ヘッダーすら無い)→ 同じ専用メッセージ(parseSleepCsvが[]を返す経路)
// (c) データ行はあるが起床時間が全件パース不能 → 「起床時間を読み取れず全N行をスキップ」
// (d) 部分成功(一部だけ読める)は従来どおり(v120で検証済み、ここでは回帰確認のみ)
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
}

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const HEADER = "起床時間,就寝時間,睡眠,寝床,深さ,質,効率性,睡眠心拍数,睡眠心拍変動,平均SpO2";
const row = (wake, bed, sleep = "7:10") => `${wake},${bed},${sleep},7:40,1:20,4:30,93.5,55,62,97.1`;

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ✗ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const TODAY = iso(new Date());
  const YESTERDAY = iso(new Date(Date.now() - 86400000));
  const file = (body) => ({ name: "AutoSleep.csv", mimeType: "text/csv", buffer: Buffer.from(body, "utf-8") });

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(400);
    await passGithubGate(page);
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "journal"; s.selectedDate = TODAY; s.sleep.logs = {};
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(500);
    const input = () => page.locator("input[data-sleep-csv-upload]");

    console.log("[1] ヘッダーのみ(データ行0件)のCSV → 専用メッセージ");
    await input().setInputFiles(file(HEADER));
    await page.waitForTimeout(300);
    const toast1 = await page.locator(".toast").textContent();
    check("「データ行がありませんでした」が出る", toast1.includes("データ行がありませんでした"), toast1);
    check("旧来の汎用メッセージではない(原因が特定できる文言に変わった)", !toast1.includes("行をスキップ"), toast1);
    const s1 = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).sleep.logs, KEY);
    check("stateは変化しない(sleep.logsは空のまま)", Object.keys(s1).length === 0, JSON.stringify(s1));

    console.log("[2] 完全に空のファイル(改行のみ、ヘッダー行も無い)→ 同じ専用メッセージ");
    await input().setInputFiles(file("\n"));
    await page.waitForTimeout(300);
    const toast2 = await page.locator(".toast").textContent();
    check("空ファイルでも「データ行がありませんでした」が出る", toast2.includes("データ行がありませんでした"), toast2);

    console.log("[3] データ行はあるが起床時間が全件パース不能 → スキップ件数を明示したメッセージ");
    const allBadCsv = [
      HEADER,
      row("読取不能1", "読取不能1"),
      row("読取不能2", "読取不能2")
    ].join("\n");
    await input().setInputFiles(file(allBadCsv));
    await page.waitForTimeout(300);
    const toast3 = await page.locator(".toast").textContent();
    check("「起床時間を読み取れず全2行をスキップ」が出る", toast3.includes("起床時間を読み取れず全2行をスキップ"), toast3);
    check("「データ行がありませんでした」ではない(区別されている)", !toast3.includes("データ行がありませんでした"), toast3);

    console.log("[4] 回帰: 部分成功(一部だけ読める)は従来どおり成功メッセージ(v120と同じ経路)");
    const partialOkCsv = [HEADER, row(`${TODAY} 07:00`, `${YESTERDAY} 23:00`)].join("\n");
    await input().setInputFiles(file(partialOkCsv));
    await page.waitForTimeout(300);
    const toast4 = await page.locator(".toast").textContent();
    check("成功時は「取り込みました」が出る(空/全滅メッセージと混同しない)", toast4.includes("取り込みました"), toast4);
    const s4 = await page.evaluate(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).sleep.logs[TODAY], { KEY, TODAY });
    check("正常時はstateに反映される", !!s4, JSON.stringify(s4));
  } catch (e) {
    failures++; console.log("  ✗ 実行エラー:", e.message);
  } finally {
    await browser.close(); server.close();
  }
  if (failures) { console.log(`v130: ${failures}件失敗`); process.exit(1); }
  console.log("v130: 全チェック通過");
})();
