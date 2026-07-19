// v120: AutoSleep CSVの表記揺れ、同一ファイル再選択、部分取込の警告を検証する。
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
const short = (s) => { const p = s.split("-"); return `${+p[1]}/${+p[2]}`; };
const loose = (s, time) => { const p = s.split("-"); return `${p[0]}/${+p[1]}/${+p[2]} ${time}`; };
const HEADER = "起床時間,就寝時間,睡眠,寝床,深さ,質,効率性,睡眠心拍数,睡眠心拍変動,平均SpO2";
const row = (wake, bed, sleep = "7:10") => `${wake},${bed},${sleep},7:40,1:20,4:30,93.5,55,62,97.1`;

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const warnings = [];
  page.on("console", (msg) => { if (msg.type() === "warning") warnings.push(msg.text()); });
  page.on("pageerror", (e) => { failures++; console.log("  ✗ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const TODAY = iso(new Date());
  const YESTERDAY = iso(new Date(Date.now() - 86400000));
  const TWO_DAYS_AGO = iso(new Date(Date.now() - 172800000));
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

    console.log("[1] 1桁月日/時・スラッシュ区切り・秒なしを取り込む");
    const robustCsv = [HEADER, row(loose(TODAY, "7:05"), loose(YESTERDAY, "23:15"))].join("\n");
    await page.setInputFiles("input[data-sleep-csv-upload]", file(robustCsv));
    await page.waitForTimeout(500);
    const robustLog = await page.evaluate(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).sleep.logs[TODAY], { KEY, TODAY });
    check("起床日が正規化される", !!robustLog);
    check("1桁時刻がゼロ埋めされる", robustLog?.wake === "07:05" && robustLog?.bed === "23:15", JSON.stringify(robustLog));
    check("秒なしの睡眠時間を読める", Math.abs((robustLog?.sleepH || 0) - (7 + 10 / 60)) < 0.01);

    console.log("[2] 読取不能後も同じファイルを再選択できる");
    const badCsv = [HEADER, row("読取不能-同一ファイル", loose(YESTERDAY, "23:00"))].join("\n");
    const badFile = file(badCsv);
    const input = page.locator("input[data-sleep-csv-upload]");
    const warnBefore = warnings.length;
    await input.setInputFiles(badFile);
    await page.waitForTimeout(200);
    check("file inputのvalueがリセットされる", await input.evaluate((el) => el.value === ""));
    await input.setInputFiles(badFile);
    await page.waitForTimeout(200);
    check("同一ファイルの2回目も取込処理が走る", warnings.length === warnBefore + 2, warnings.join(" | "));

    console.log("[3] 部分取込の範囲・スキップ数・今朝欠落を警告する");
    const rawBadWake = `読取不能-${TODAY}`;
    const partialCsv = [
      HEADER,
      row(loose(TWO_DAYS_AGO, "6:10"), loose(TWO_DAYS_AGO, "0:10")),
      row(loose(YESTERDAY, "6:20"), loose(TWO_DAYS_AGO, "23:20")),
      row(rawBadWake, loose(YESTERDAY, "23:30"))
    ].join("\n");
    await page.setInputFiles("input[data-sleep-csv-upload]", file(partialCsv));
    await page.waitForTimeout(300);
    const toast = await page.locator(".toast").textContent();
    check("取込日付範囲を表示", toast.includes(`${short(TWO_DAYS_AGO)}〜${short(YESTERDAY)}`), toast);
    check("スキップ件数を表示", toast.includes("1行をスキップ"), toast);
    check("今朝の分が無い警告を表示", toast.includes("今朝の分はCSVにありませんでした"), toast);
    check("console.warnに起床時間の生値を出す", warnings.some((w) => w.includes(rawBadWake)), warnings.join(" | "));
  } catch (e) {
    failures++; console.log("  ✗ 実行エラー:", e.message);
  } finally {
    await browser.close(); server.close();
  }
  if (failures) { console.log(`v120: ${failures}件失敗`); process.exit(1); }
  console.log("v120: 全チェック通過");
})();
