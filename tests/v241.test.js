// v241: Todayフォーカスモードの個別表示・端末ローカル保持・CABIN TIMER固定配置・ticker継続。
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
    check("専用キー未設定では現行2セクションを描画",
      await page.locator(".tower-col-center > .sec-gates").count() === 1
      && await page.locator(".tower-col-right > .sec-journal").count() === 1);
    check("右カラム直下はJOURNAL 1個だけ", await page.locator(".tower-col-right > *").count() === 1);
    check("CABIN TIMERはNOW LANDINGと同じ上帯2直下",
      await page.locator(".today-tower > .tower-band2 > .today-pomodoro").count() === 1
      && await page.locator(".today-tower > .tower-band2 > .tower-runway").count() === 1);
    check("既定値の読取だけでは専用キーを書かない", await page.evaluate((key) => localStorage.getItem(key) === null, FOCUS_KEY));
    const focusButtonSelectors = [
      '[data-action="focus-mode"]',
      '[data-action="focus-toggle-gate"]',
      '[data-action="focus-toggle-journal"]'
    ];
    let focusWaitError = "";
    await page.waitForFunction((selectors) => selectors.every((selector) => {
      const button = document.querySelector(`.today-focus-bar ${selector}`);
      if (!button || !button.isConnected) return false;
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }), focusButtonSelectors).catch((error) => { focusWaitError = error.message; });
    const tapRects = await page.evaluate((selectors) => selectors.map((selector) => {
      const button = document.querySelector(`.today-focus-bar ${selector}`);
      if (!button) return { selector, missing: true, x: 0, y: 0, width: 0, height: 0 };
      const rect = button.getBoundingClientRect();
      return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }), focusButtonSelectors);
    check("FOCUSと2チップはすべて44px以上",
      !focusWaitError && tapRects.length === 3 && tapRects.every(({ width, height }) => width >= 44 && height >= 44),
      JSON.stringify({ focusWaitError, tapRects }));

    console.log("[2] 個別トグルはDOM生成を省略し、状態をリロード後も維持する");
    await page.click('[data-action="focus-toggle-gate"]');
    await page.waitForSelector(".sec-gates", { state: "detached" });
    check("ルーティンだけ消え、JOURNALは残る",
      await page.locator(".sec-gates").count() === 0 && await page.locator(".sec-journal").count() === 1);
    await page.reload();
    await page.waitForSelector(".today-tower");
    check("ルーティン非表示はリロード後も維持", await page.locator(".sec-gates").count() === 0);
    await page.click('[data-action="focus-toggle-gate"]');
    await page.waitForSelector(".sec-gates");
    await page.click('[data-action="focus-toggle-journal"]');
    await page.waitForSelector(".sec-journal", { state: "detached" });
    check("ジャーナルチップでJOURNALだけ消える", await page.locator(".sec-gates").count() === 1);

    console.log("[3] FOCUSは2つを一括非表示にし、直前の個別状態へ復元する");
    await page.click('[data-action="focus-mode"]');
    await page.waitForSelector('.today-tower[data-focus-mode="1"]');
    check("FOCUSで2セクションのDOMがすべて無い", await page.locator(".sec-gates, .sec-journal").count() === 0);
    await page.click('[data-action="focus-mode"]');
    await page.waitForSelector('.today-tower[data-focus-mode="0"]');
    check("解除で直前状態(gate表示・journal非表示)へ復元",
      await page.locator(".sec-gates").count() === 1 && await page.locator(".sec-journal").count() === 0);
    await page.click('[data-action="focus-toggle-journal"]');
    await page.waitForSelector(".sec-journal");

    console.log("[4] 1280px以上ではFOCUS状態に関係なくCABIN TIMERを上帯2の30%側へ固定する");
    const desktopNormalLayout = await page.evaluate(() => {
      const band = document.querySelector(".tower-band2").getBoundingClientRect();
      const runway = document.querySelector(".tower-band2 > .tower-runway").getBoundingClientRect();
      const timer = document.querySelector(".tower-band2 > .today-pomodoro").getBoundingClientRect();
      const ring = document.querySelector(".today-pomodoro .pomo-circle-wrap").getBoundingClientRect();
      return { bandX: band.x, bandWidth: band.width, runwayX: runway.x, runwayWidth: runway.width,
        timerX: timer.x, timerWidth: timer.width, ringWidth: ring.width };
    });
    check("PC非FOCUS時はNOW 70% / CABIN TIMER 30%の上帯2",
      desktopNormalLayout.runwayX === desktopNormalLayout.bandX
      && desktopNormalLayout.runwayWidth > desktopNormalLayout.timerWidth
      && desktopNormalLayout.timerX > desktopNormalLayout.runwayX
      && Math.abs(desktopNormalLayout.ringWidth - 112) < 0.5,
      JSON.stringify(desktopNormalLayout));
    await page.click('[data-action="focus-mode"]');
    await page.waitForSelector('.today-tower[data-focus-mode="1"]');
    const desktopFocusLayout = await page.evaluate(() => {
      const timer = document.querySelector(".today-pomodoro");
      const rect = timer.getBoundingClientRect();
      const ring = timer.querySelector(".pomo-circle-wrap").getBoundingClientRect();
      const tower = document.querySelector(".today-tower");
      const legacyAttr = ["data-focus", "pomodoro-right"].join("-");
      return { timerX: rect.x, timerWidth: rect.width, ringWidth: ring.width,
        inBand2: timer.parentElement.classList.contains("tower-band2"), legacyAttr: tower.hasAttribute(legacyAttr) };
    });
    check("PCフォーカス時もCABIN TIMERは上帯2の同じ位置・幅・112pxリングを維持",
      desktopFocusLayout.inBand2 && !desktopFocusLayout.legacyAttr
      && Math.abs(desktopFocusLayout.timerX - desktopNormalLayout.timerX) < 1
      && Math.abs(desktopFocusLayout.timerWidth - desktopNormalLayout.timerWidth) < 1
      && Math.abs(desktopFocusLayout.ringWidth - 112) < 0.5, JSON.stringify(desktopFocusLayout));
    await page.click('[data-action="focus-mode"]');
    await page.waitForSelector(".sec-journal");

    console.log("[5] iPhone幅では上帯2をNOW LANDING→CABIN TIMERの縦一列にする");
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileNormal = await page.evaluate(() => {
      const timer = document.querySelector(".today-pomodoro");
      const runway = document.querySelector(".tower-runway").getBoundingClientRect();
      const timerRect = timer.getBoundingClientRect();
      const standing = document.querySelector(".so-row").getBoundingClientRect();
      const focus = document.querySelector(".today-focus-bar").getBoundingClientRect();
      return { inBand2: timer.parentElement.classList.contains("tower-band2"), standingBottom: standing.bottom,
        runwayTop: runway.top, runwayBottom: runway.bottom, timerTop: timerRect.top, timerBottom: timerRect.bottom,
        focusTop: focus.top, ringWidth: timer.querySelector(".pomo-circle-wrap").getBoundingClientRect().width };
    });
    check("iPhoneはSTANDING ORDERS→NOW LANDING→CABIN TIMER→FOCUSの縦順",
      mobileNormal.inBand2 && mobileNormal.standingBottom <= mobileNormal.runwayTop
      && mobileNormal.runwayBottom <= mobileNormal.timerTop && mobileNormal.timerBottom <= mobileNormal.focusTop
      && Math.abs(mobileNormal.ringWidth - 112) < 0.5, JSON.stringify(mobileNormal));
    await page.click('[data-action="focus-mode"]');
    await page.waitForSelector('.today-tower[data-focus-mode="1"]');
    const mobileLayout = await page.evaluate(() => {
      const timer = document.querySelector(".today-pomodoro");
      const timerRect = timer.getBoundingClientRect();
      return { inBand2: timer.parentElement.classList.contains("tower-band2"), timerTop: timerRect.top,
        timerWidth: timerRect.width, ringWidth: timer.querySelector(".pomo-circle-wrap").getBoundingClientRect().width };
    });
    check("iPhoneフォーカス時も上帯2内・112pxリングを維持",
      mobileLayout.inBand2 && Math.abs(mobileLayout.ringWidth - 112) < 0.5,
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
