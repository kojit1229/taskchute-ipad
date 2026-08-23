// v241: Todayフォーカスモードの個別表示・端末ローカル保持・CABIN TIMER配置・ticker継続。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const STATE_KEY = "taskchute-journal-pwa-state-v1";
const FOCUS_KEY = "taskchute-journal-today-focus-v1";
const NOW = new Date(2026, 7, 23, 10, 0, 0, 0);
const TODAY = "2026-08-23";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  try {
    await page.clock.setFixedTime(NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.evaluate(({ STATE_KEY, FOCUS_KEY }) => {
      localStorage.removeItem(FOCUS_KEY);
      const state = JSON.parse(localStorage.getItem(STATE_KEY));
      state.currentView = "today";
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    }, { STATE_KEY, FOCUS_KEY });
    await page.reload();
    await page.waitForSelector(".today-tower");

    console.log("[1] 専用キー未設定の既定は全表示で、既存パネルDOM構造を維持する");
    check("専用キー未設定では全3セクションを描画",
      await page.locator(".tower-col-center > .sec-gates").count() === 1
      && await page.locator(".tower-col-right > .sec-atis").count() === 1
      && await page.locator(".tower-col-right > .sec-journal").count() === 1);
    check("CABIN TIMERは従来どおりtoday-tower直下",
      await page.locator(".today-tower > .today-pomodoro").count() === 1);
    check("既定値の読取だけでは専用キーを書かない", await page.evaluate((key) => localStorage.getItem(key) === null, FOCUS_KEY));
    await page.waitForFunction(() => {
      const buttons = [...document.querySelectorAll(".today-focus-bar button")];
      return buttons.length === 4 && buttons.every((button) => {
        const rect = button.getBoundingClientRect();
        return button.isConnected && rect.width > 0 && rect.height > 0;
      });
    });
    const tapSizes = await page.locator(".today-focus-bar button").evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    check("FOCUSと3チップはすべて44px以上", tapSizes.length === 4 && tapSizes.every(({ width, height }) => width >= 44 && height >= 44), JSON.stringify(tapSizes));

    console.log("[2] 個別トグルはDOM生成を省略し、状態をリロード後も維持する");
    await page.click('[data-action="focus-toggle-gate"]');
    await page.waitForSelector(".sec-gates", { state: "detached" });
    check("ルーティンだけ消え、ATIS/JOURNALは残る",
      await page.locator(".sec-gates").count() === 0 && await page.locator(".sec-atis, .sec-journal").count() === 2);
    await page.reload();
    await page.waitForSelector(".today-tower");
    check("ルーティン非表示はリロード後も維持", await page.locator(".sec-gates").count() === 0);
    await page.click('[data-action="focus-toggle-gate"]');
    await page.waitForSelector(".sec-gates");
    await page.click('[data-action="focus-toggle-atis"]');
    await page.waitForSelector(".sec-atis", { state: "detached" });
    check("AIチップでATISだけ消える", await page.locator(".sec-gates, .sec-journal").count() === 2);
    await page.click('[data-action="focus-toggle-atis"]');
    await page.click('[data-action="focus-toggle-journal"]');
    await page.waitForSelector(".sec-journal", { state: "detached" });
    check("ジャーナルチップでJOURNALだけ消える", await page.locator(".sec-gates, .sec-atis").count() === 2);

    console.log("[3] FOCUSは3つを一括非表示にし、直前の個別状態へ復元する");
    await page.click('[data-action="focus-mode"]');
    await page.waitForSelector('.today-tower[data-focus-mode="1"]');
    check("FOCUSで3セクションのDOMがすべて無い", await page.locator(".sec-gates, .sec-atis, .sec-journal").count() === 0);
    await page.click('[data-action="focus-mode"]');
    await page.waitForSelector('.today-tower[data-focus-mode="0"]');
    check("解除で直前状態(gate/atis表示・journal非表示)へ復元",
      await page.locator(".sec-gates, .sec-atis").count() === 2 && await page.locator(".sec-journal").count() === 0);
    await page.click('[data-action="focus-toggle-journal"]');
    await page.waitForSelector(".sec-journal");

    console.log("[4] 1280px以上ではATIS/JOURNAL非表示時だけCABIN TIMERを右列へ置く");
    await page.click('[data-action="focus-mode"]');
    await page.waitForSelector('.today-tower[data-focus-mode="1"]');
    const desktopFocusLayout = await page.evaluate(() => {
      const right = document.querySelector(".tower-col-right").getBoundingClientRect();
      const timer = document.querySelector(".today-pomodoro");
      const rect = timer.getBoundingClientRect();
      return { rightX: right.x, rightWidth: right.width, timerX: rect.x, timerWidth: rect.width, gridArea: getComputedStyle(timer).gridArea };
    });
    check("PCフォーカス時はCABIN TIMERが右列と同じ位置・幅",
      Math.abs(desktopFocusLayout.rightX - desktopFocusLayout.timerX) < 1
      && Math.abs(desktopFocusLayout.rightWidth - desktopFocusLayout.timerWidth) < 1
      && desktopFocusLayout.gridArea === "right", JSON.stringify(desktopFocusLayout));
    await page.click('[data-action="focus-mode"]');
    await page.waitForSelector(".sec-journal");
    const restoredArea = await page.locator(".today-pomodoro").evaluate((timer) => getComputedStyle(timer).gridArea);
    check("解除後は従来の全幅timer領域へ戻る", restoredArea === "timer", restoredArea);

    console.log("[5] iPhone幅ではフォーカス時もCABIN TIMERの既存縦順を保つ");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('[data-action="focus-mode"]');
    await page.waitForSelector('.today-tower[data-focus-mode="1"]');
    const mobileLayout = await page.evaluate(() => {
      const timer = document.querySelector(".today-pomodoro");
      const log = document.querySelector(".sec-log").getBoundingClientRect();
      const timerRect = timer.getBoundingClientRect();
      const standing = document.querySelector(".sec-creed").getBoundingClientRect();
      return { direct: timer.parentElement.classList.contains("today-tower"), logBottom: log.bottom, timerTop: timerRect.top, timerBottom: timerRect.bottom, standingTop: standing.top };
    });
    check("iPhoneはFLIGHT LOG→CABIN TIMER→STANDING ORDERSの縦順",
      mobileLayout.direct && mobileLayout.logBottom <= mobileLayout.timerTop && mobileLayout.timerBottom <= mobileLayout.standingTop,
      JSON.stringify(mobileLayout));
    await page.click('[data-action="focus-mode"]');
    await page.waitForSelector(".sec-journal");

    console.log("[6] ポモドーロ実行中の切替でもstateと1秒tickerが継続する");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`http://localhost:${PORT}/styles.css`);
    await page.evaluate(({ STATE_KEY, TODAY }) => {
      const state = JSON.parse(localStorage.getItem(STATE_KEY));
      state.currentView = "today";
      state.selectedDate = TODAY;
      state.blocks = (state.blocks || []).filter((block) => block.id !== "focus-timer-block");
      state.blocks.push({ id: "focus-timer-block", date: TODAY, title: "フォーカス継続テスト", category: "", completed: false, deleted: false });
      state.pomodoro = { running: true, blockId: "focus-timer-block", startedAt: `${TODAY}T10:00`, endsAt: `${TODAY}T10:05`, mode: "focus" };
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    }, { STATE_KEY, TODAY });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector(".today-pomodoro .pomo-time-overlay");
    const beforeTick = await page.locator(".today-pomodoro .pomo-time-overlay").textContent();
    await page.click('[data-action="focus-mode"]');
    await page.waitForSelector('.today-tower[data-focus-mode="1"] .today-pomodoro');
    const timerState = await page.evaluate(({ STATE_KEY, FOCUS_KEY }) => {
      const state = JSON.parse(localStorage.getItem(STATE_KEY));
      const focus = JSON.parse(localStorage.getItem(FOCUS_KEY));
      return { running: state.pomodoro.running, blockId: state.pomodoro.blockId, focus, leaked: "todayFocus" in state || "focusVisibility" in state };
    }, { STATE_KEY, FOCUS_KEY });
    check("切替後もポモドーロstateは実行中の同一Block", timerState.running && timerState.blockId === "focus-timer-block", JSON.stringify(timerState));
    check("表示状態は専用キーだけに保存され同期stateへ混入しない", !!timerState.focus && !timerState.leaked, JSON.stringify(timerState));
    await page.clock.setFixedTime(new Date(2026, 7, 23, 10, 1, 0, 0));
    await page.waitForFunction((before) => document.querySelector(".today-pomodoro .pomo-time-overlay")?.textContent !== before, beforeTick);
    const afterTick = await page.locator(".today-pomodoro .pomo-time-overlay").textContent();
    check("フォーカス切替後も計時表示が更新される", afterTick !== beforeTick, `${beforeTick} -> ${afterTick}`);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
