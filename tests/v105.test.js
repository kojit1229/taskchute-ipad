// v105 検証: ジャーナルタブの睡眠CSV取込(AutoSleep書き出し)
// (a) 今日を開いていて未取込 → 赤帯警告 + dangerボタン
// (b) CSVアップロード → state.sleep.logs に起床日キーで保存、カードがサマリ表示に変わる
// (c) 同日複数セッション行は睡眠が長い方を採用、複数日を一括取込できる
// (d) normalizeState 後方互換: 旧stateに sleep が補完され、journalTemplate から
//     未記入の睡眠セクションが除去される(新規ジャーナルにも睡眠欄が出ない)
// (e) 過去日で未取込のときは赤帯ではなく控えめ表示
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// AutoSleepの書き出しCSV(ヘッダーは実物と同一。値行は今日起床+昨日起床+今日の昼寝の3行)
function fixtureCsv(today, yesterday) {
  const header = "ISO8601,開始日,終了日,就寝時間,起床時間,寝床,覚醒,寝入り,セッション,睡眠,7日間の平均睡眠,効率性,7日間の平均効率性,質,7日間の平均の質,深さ,7日間の平均の深さ,睡眠心拍数,7日間の平均心拍数,1日の心拍数,7日間の1日の平均心拍数,起床時心拍数,7日間の平均起床時心拍数,心拍変動,7日間の平均心拍変動,睡眠心拍変動,7日間の睡眠心拍変動,平均SpO2,最小SpO2,最大SpO2,平均呼吸,最小呼吸,最大呼吸,無呼吸,タグ,メモ";
  const row = (bedDate, bedTime, wakeDate, wakeTime, sleep, eff, deep, hr, hrv) =>
    `${wakeDate}T20:59:59+09:00,"${bedDate} 金曜日","${wakeDate} 土曜日",${bedDate} ${bedTime},${wakeDate} ${wakeTime},08:00:00,00:30:00,00:00:00,1,${sleep},07:00:00,${eff},94.8,05:00:00,04:56:00,${deep},01:39:41,${hr},58.4,72.6,75.8,54.0,52.8,88,110,${hrv},76,97.4,94,99,,,,,,`;
  return [
    header,
    row(yesterday, "23:10:00", today, "06:30:00", "07:20:00", "97.4", "02:10:00", "55.0", "61"),
    row(yesterday, "22:50:00", yesterday, "06:00:00", "06:40:00", "92.0", "01:40:00", "57.0", "48"),
    // 同日(今日)の昼寝セッション: 睡眠が短いので夜の行が勝つこと
    row(today, "13:00:00", today, "14:00:00", "01:00:00", "100.0", "00:20:00", "60.0", "30")
  ].join("\n");
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const TODAY = iso(new Date());
  const YESTERDAY = iso(new Date(Date.now() - 86400000));

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    console.log("[1] normalizeState 後方互換: sleep補完 + テンプレから睡眠セクション除去");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.sleep;  // 旧stateを模擬
      s.settings.journalTemplate = [
        "# 2026-01-01 のジャーナル", "",
        "## 🛏 睡眠", "就寝: __:__  /  起床: __:__", "質: ★★★☆☆", "",
        "## 🙏 感謝(3 つ)", "1. ", "2. ", "3. ", ""
      ].join("\n");
      s.journals = {}; s.selectedDate = TODAY; s.currentView = "journal";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(600);
    const migrated = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
    check("state.sleep.logs が補完される", migrated.sleep && typeof migrated.sleep.logs === "object");
    check("テンプレから🛏睡眠セクションが消える", !migrated.settings.journalTemplate.includes("🛏 睡眠"));
    check("テンプレの感謝セクションは残る", migrated.settings.journalTemplate.includes("## 🙏 感謝"));
    check("新規ジャーナル本文にも睡眠欄が無い", !(migrated.journals[TODAY] || "").includes("🛏 睡眠"));

    console.log("[2] 未取込 + 今日 → 赤帯警告");
    const warn = page.locator("text=前夜の睡眠CSVが未アップロードです");
    check("赤帯警告が表示される", await warn.count() === 1);
    check("アップロードボタンがdanger", await page.locator("label.btn.danger:has-text('睡眠CSV')").count() === 1);

    console.log("[3] CSVアップロード → 取込 + サマリ表示");
    await page.setInputFiles("input[data-sleep-csv-upload]", {
      name: "AutoSleep.csv", mimeType: "text/csv",
      buffer: Buffer.from(fixtureCsv(TODAY, YESTERDAY), "utf-8")
    });
    await page.waitForTimeout(800);
    const after = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
    const todayLog = after.sleep.logs[TODAY];
    check("今日(起床日)のログが保存される", !!todayLog, JSON.stringify(after.sleep.logs));
    check("昨日のログも一括取込される", !!after.sleep.logs[YESTERDAY]);
    check("就寝・起床が抽出される", todayLog && todayLog.bed === "23:10" && todayLog.wake === "06:30");
    check("睡眠時間が時間換算される", todayLog && Math.abs(todayLog.sleepH - (7 + 20 / 60)) < 0.01);
    check("効率・深さ・HR/HRVが数値で入る", todayLog && todayLog.eff === 97.4 && todayLog.hrvSleep === 61);
    check("昼寝セッションより夜の睡眠が勝つ", todayLog && todayLog.sleepH > 2);
    check("赤帯警告が消える", await warn.count() === 0);
    check("サマリカードが表示される", await page.locator("text=前夜の睡眠").count() >= 1);

    console.log("[4] 過去日で未取込 → 控えめ表示(赤帯なし)");
    // 起動時は selectedDate が必ず今日に戻る(app.js末尾)ため、日付バーの「前日」で遷移する
    await page.evaluate(({ KEY, YESTERDAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.sleep.logs[YESTERDAY];
      s.currentView = "journal";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, YESTERDAY });
    await page.reload();
    await page.waitForTimeout(600);
    await page.locator('[data-action="date-prev"]').first().click();
    await page.waitForTimeout(400);
    check("過去日は控えめ表示", await page.locator("text=この日の睡眠ログはありません").count() === 1);
    check("過去日では赤帯を出さない", await page.locator("text=前夜の睡眠CSVが未アップロードです").count() === 0);
  } catch (e) {
    failures++;
    console.log("  ❌ 実行エラー:", e.message);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) { console.log(`v105: ${failures}件失敗`); process.exit(1); }
  console.log("v105: 全チェック通過");
})();
