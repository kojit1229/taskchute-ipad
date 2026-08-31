// v310 tower/pomodoro/render表示: NOW LANDINGとCABIN TIMERを上帯2へ統合するcharacterization test。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");
const fs = require("fs");
const path = require("path");

const PORT = randomPort();
const TODAY = "2026-08-31";
const FIXED_NOW = new Date(2026, 7, 31, 10, 0, 0);

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function runningBlock() {
  return {
    id: "v310-running", taskId: "", date: TODAY, title: "上帯2の実行便", category: "仕事",
    plannedStartAt: `${TODAY}T09:30`, plannedEndAt: `${TODAY}T10:30`,
    actualStartAt: `${TODAY}T09:30`, actualEndAt: "", completed: false,
    charge: 0, discharge: 0, estimateMin: 60, comment: "", recurrenceGroupId: "",
    pomodoroCount: 0, migratedTo: "", orderIndex: 0, deleted: false,
    createdAt: `${TODAY}T09:00`, updatedAt: `${TODAY}T09:30`
  };
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  async function seed(blocks) {
    await page.evaluate(({ key, blocksValue, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      Object.assign(state, {
        blocks: blocksValue, tasks: [], projects: [], recurrences: [], currentView: "today", selectedDate: today,
        pomodoro: { running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" }
      });
      state.settings.focusTimerAuto = false;
      state.settings.autoSync = false;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, blocksValue: blocks, today: TODAY });
    await page.reload();
    await page.waitForSelector('.today-tower[data-focus-mode="0"]');
  }

  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] NOW LANDING 70% + CABIN TIMER 30%を上帯2へ固定配置する");
    await seed([runningBlock()]);
    check("上帯2直下にNOW LANDINGとCABIN TIMERを各1つ描画",
      await page.locator(".tower-band2 > .tower-runway.now-hero").count() === 1
      && await page.locator(".tower-band2 > .today-pomodoro.pomo").count() === 1);
    check("左列からNOW LANDINGを除去し、ARRIVALS/FLIGHT LOG/BODY-MINDの3パネルを残す",
      await page.locator(".tower-col-left > .tower-runway").count() === 0
      && await page.locator(".tower-col-left > .tower-board, .tower-col-left > .sec-log, .tower-col-left > .sec-bodymind").count() === 3);
    const layout = await page.evaluate(() => {
      const tower = document.querySelector(".today-tower");
      const band = document.querySelector(".tower-band2");
      const runway = band.querySelector(".tower-runway").getBoundingClientRect();
      const timer = band.querySelector(".today-pomodoro").getBoundingClientRect();
      return { areas: getComputedStyle(tower).gridTemplateAreas, runwayWidth: runway.width, timerWidth: timer.width };
    });
    const nowShare = layout.runwayWidth / (layout.runwayWidth + layout.timerWidth);
    check("PCグリッドはlife/so直後・focus直前にband2を持ちtimer専用行を持たない",
      layout.areas.includes("band2 band2 band2") && !layout.areas.includes("timer"), layout.areas);
    check("上帯2の実測比率は約70%/30%", nowShare > 0.69 && nowShare < 0.71, JSON.stringify({ ...layout, nowShare }));

    console.log("[2] NOWヒーロー強調とCABIN TIMER 112px SVGリングを適用する");
    const visual = await page.evaluate(() => {
      const hero = document.querySelector(".now-hero");
      const title = hero.querySelector(".tower-now-title");
      const remain = hero.querySelector("#towerNowRemain");
      const ring = document.querySelector(".pomo-circle-wrap");
      const progress = ring.querySelector(".pomo-progress-circle");
      // --tower-purpleの実際の解決色を、progressStrokeとの厳密一致検証に使う
      // (「none以外」という緩い検証では、cyanや旧色へ戻る回帰を検出できないため)。
      // --tower-purpleは.today-towerスコープ内でのみ定義されるため、documentの
      // ルートではなくhero配下(同じカスケード内)へプローブを差し込む。
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute; visibility:hidden; color: var(--tower-purple);";
      hero.appendChild(probe);
      const purpleColor = getComputedStyle(probe).color;
      probe.remove();
      return {
        heroBorder: getComputedStyle(hero).borderTopColor,
        heroShadow: getComputedStyle(hero).boxShadow,
        heroBackground: getComputedStyle(hero).backgroundImage,
        accentLine: getComputedStyle(hero, "::before").backgroundImage,
        titleSize: parseFloat(getComputedStyle(title).fontSize),
        remainSize: parseFloat(getComputedStyle(remain).fontSize),
        ringWidth: ring.getBoundingClientRect().width,
        ringTag: ring.querySelector("svg")?.tagName,
        progressStroke: getComputedStyle(progress).stroke,
        purpleColor
      };
    });
    check("amber縁・発光・明るめ地・上端アクセントラインを持つ",
      visual.heroBorder !== "rgba(0, 0, 0, 0)" && visual.heroShadow !== "none"
      && visual.heroBackground.includes("gradient") && visual.accentLine.includes("gradient"), JSON.stringify(visual));
    check("PCのタスク名22px・残り時間26px", visual.titleSize === 22 && visual.remainSize === 26, JSON.stringify(visual));
    check("CABIN TIMER見出し・112px SVG円弧・--tower-purpleと厳密一致するstrokeを使う",
      (await page.locator(".today-pomodoro .today-panel-title").textContent()).includes("CABIN TIMER")
      && Math.abs(visual.ringWidth - 112) < 0.5 && visual.ringTag === "svg"
      && visual.progressStroke === visual.purpleColor, JSON.stringify(visual));

    console.log('[2b] data-glass-blur="off"でもNOW LANDINGヒーローはGLASS縮退契約の半透明白背景を保つ');
    // v310レビュー(Codex)で発見: .now-heroのbackground-imageだけの検証では、`background`
    // ショートハンド(v274のGLASS縮退契約=.tower-runwayのbackground-colorを暗黙にtransparent
    // へ上書きする回帰)を検出できない。実際にblur-off状態を再現しbackgroundColorを直接見る。
    const BLUR_KEY = "taskchute-journal-glass-blur-off";
    await page.evaluate((key) => localStorage.setItem(key, "1"), BLUR_KEY);
    await page.reload();
    await page.waitForSelector('.today-tower[data-glass-blur="off"]');
    const blurOff = await page.locator(".now-hero").evaluate((hero) => ({
      backdropFilter: getComputedStyle(hero).backdropFilter,
      backgroundColor: getComputedStyle(hero).backgroundColor
    }));
    check("blur-off時もNOW LANDINGヒーローはv274のGLASS半透明白背景(rgba(255,255,255,0.07))を維持",
      blurOff.backdropFilter === "none" && blurOff.backgroundColor === "rgba(255, 255, 255, 0.07)",
      JSON.stringify(blurOff));
    await page.evaluate((key) => localStorage.removeItem(key), BLUR_KEY);
    await page.reload();
    await page.waitForSelector('.today-tower:not([data-glass-blur="off"])');

    console.log('[3] data-view-life="0"フックでリングだけ156pxへ拡大する');
    const expanded = await page.evaluate(() => {
      const ring = document.querySelector(".pomo-circle-wrap");
      ring.style.transition = "none";
      document.querySelector(".today-tower").dataset.viewLife = "0";
      return ring.getBoundingClientRect().width;
    });
    check("LIFE BAND非表示用フックで156px", Math.abs(expanded - 156) < 0.5, `${expanded}px`);

    console.log("[4] 実行便なしでも上帯2内の既存empty分岐を維持する");
    await seed([]);
    const empty = page.locator('.tower-band2 .tower-nowhud[data-status="empty"]');
    check("empty HUDが上帯2内に1つ", await empty.count() === 1);
    check("空表示は滑走路オープン案内", (await empty.textContent()).includes("次の便を選んで開始できます"));

    console.log("[5] 旧POMODORO右列退避コードと文字列replaceハックを残さない");
    const towerSource = fs.readFileSync(path.join(__dirname, "../src/features/today-tower.js"), "utf8");
    const cssSource = fs.readFileSync(path.join(__dirname, "../styles.css"), "utf8");
    const legacyAttr = ["data-focus", "pomodoro-right"].join("-");
    const legacyVariable = ["pomodoro", "Right"].join("");
    const legacyHeadingReplace = ['.replace(">', "POMODORO", '<span>"'].join("");
    const legacyTimerArea = ["grid-area", "timer"].join(": ");
    check("旧属性・JS変数・見出しreplaceがソースに無い",
      !towerSource.includes(legacyAttr) && !towerSource.includes(legacyVariable)
      && !towerSource.includes(legacyHeadingReplace));
    check("旧属性CSS・timer grid-areaが無い", !cssSource.includes(legacyAttr) && !cssSource.includes(legacyTimerArea));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
