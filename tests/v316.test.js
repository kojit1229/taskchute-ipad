// v316 E2E: settings UIのsleep/condition等の生活記録export 6導線、CSV download、state不変。
const fs = require("fs");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);

  async function downloadFor(kind) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(`[data-action="life-export"][data-kind="${kind}"]`).click()
    ]);
    const body = fs.readFileSync(await download.path());
    return { filename: download.suggestedFilename(), text: body.toString("utf8") };
  }

  try {
    await page.clock.setFixedTime(new Date(2026, 8, 2, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "settings";
      state.settings.github.token = "SECRET_TOKEN_V316";
      state.condition.logs = {
        "2026-09-02": { gym: [{ id: "g2", at: "2026-09-02T08:00", exercise: "スクワット", weight: 80, reps: 5 }] },
        "2026-09-01": { gym: [{ id: "g1", at: "2026-09-01T08:00", exercise: "ベンチプレス", weight: 60, reps: 10 }] }
      };
      state.sleep.logs = {
        "2026-09-02": { bed: "23:00", wake: "06:30", sleepH: 7, eff: 90, deepH: 1.2, hrSleep: 50, hrvSleep: 45 }
      };
      state.storeVisits = [];
      localStorage.setItem(key, JSON.stringify(state));
    }, STATE_KEY);
    await page.reload();
    await page.waitForSelector('.nav-button[data-view="settings"].active');
    // v358で生活記録CSVのlife-exportボタンは「データ」群の「書き出し」行(行タップで展開する
    // 一覧行、_settingsExpandedRowId管理・非永続)へ移設された。openSettingsGroup("settings-sync")
    // は無関係になったため、該当行を直接タップして開く。
    const exportRow = page.locator('[data-settings-row="data-export"]');
    await exportRow.locator("summary").click();
    await page.waitForFunction(() => document.querySelector('[data-settings-row="data-export"]')?.open === true);
    const stateBefore = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);

    console.log("[1] 設定画面に共通actionの6ボタンが表示される");
    const buttons = page.locator('[data-action="life-export"]');
    check("ボタンは6個", await buttons.count() === 6, String(await buttons.count()));
    check("表示順・ラベル", (await buttons.allTextContents()).map((text) => text.trim()).join("|")
      === "筋トレ CSV|睡眠 CSV|体調 CSV|お店 CSV|身体スキャン CSV|書く瞑想 JSON");

    console.log("[2] 筋トレ・睡眠CSVのファイル名、BOM、ヘッダ、秘密情報除外");
    const gym = await downloadFor("gym");
    check("筋トレのファイル名", gym.filename === "taskchute_gym_2026-09-02.csv", gym.filename);
    check("筋トレCSVのBOM・ヘッダ", gym.text.startsWith("\uFEFFdate,at,exercise,weight,reps,kg,blockId\r\n"), JSON.stringify(gym.text.slice(0, 80)));
    check("筋トレCSVにtokenなし", !gym.text.includes("SECRET_TOKEN_V316"));
    const sleep = await downloadFor("sleep");
    check("睡眠のファイル名", sleep.filename === "taskchute_sleep_2026-09-02.csv", sleep.filename);
    check("睡眠CSVのBOM・ヘッダ", sleep.text.startsWith("\uFEFFdate,bedTime,wakeTime,sleepMin,efficiency,deep,hr,hrv\r\n"), JSON.stringify(sleep.text.slice(0, 90)));
    check("睡眠CSVにtokenなし", !sleep.text.includes("SECRET_TOKEN_V316"));

    console.log("[3] 0件種別はトーストのみでdownloadしない");
    const downloadProbe = page.waitForEvent("download", { timeout: 500 }).then(() => true, () => false);
    await page.locator('[data-action="life-export"][data-kind="store"]').click();
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent === "お店の記録はありません");
    check("0件トースト", await page.locator("#toast").textContent() === "お店の記録はありません");
    check("0件ではdownloadイベントなし", !(await downloadProbe));

    const stateAfter = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    check("エクスポート操作でstate不変", stateAfter === stateBefore);
    check("pageerror 0", pageErrors.length === 0, JSON.stringify(pageErrors));
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nv316: 全件成功" : `\nv316: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
