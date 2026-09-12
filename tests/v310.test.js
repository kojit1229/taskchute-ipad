// v310/v319 tower/pomodoro/render表示: NOW LANDINGとポモドーロを上帯2へ統合するcharacterization test。
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
    await page.waitForSelector('.today-tower[data-daily-view="today"]');
  }

  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] 現在作業領域へ主役とタイマーを収める");
    await seed([runningBlock()]);
    check("現在作業/主役/ポモドーロは各1つ", await page.locator('.tower-runway.now-hero').count() === 1
      && await page.locator('.tower-runway > .today-pomodoro.pomo').count() === 1 && await page.locator('.tower-runway > .tower-mit').count() === 1);
    check("予定は左、実績/ルーティン/本文は記録列、健康は別画面", await page.locator('#dailyTodayPlans > [data-work-list="today"]').count() === 1
      && await page.locator('.daily-today-records > .sec-log').count() === 1 && await page.locator('.daily-today-records > .sec-gates').count() === 1
      && await page.locator('.daily-today-records > .sec-journal').count() === 1 && await page.locator('.sec-bodymind').count() === 0);
    const layout = await page.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      return { life: r('.life-band').toJSON(), creed: r('.so-row').toJSON(), current: r('.tower-runway').toJSON(), timer: r('.today-pomodoro').toJSON(), plans: r('#dailyTodayPlans').toJSON() };
    });
    check("現在作業は人生/信条の下、予定の上", layout.current.top >= Math.max(layout.life.bottom, layout.creed.bottom) && layout.plans.top >= layout.current.bottom, JSON.stringify(layout));
    check("タイマーは現在作業の内側で正の寸法", layout.timer.width > 0 && layout.timer.height > 0 && layout.timer.left >= layout.current.left && layout.timer.right <= layout.current.right
      && layout.timer.top >= layout.current.top && layout.timer.bottom <= layout.current.bottom, JSON.stringify(layout));

    console.log("[2] NOWヒーロー強調とポモドーロ 56px SVGリングを適用する");
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
    check("PCの共通タスク名1rem・残り時間26px", visual.titleSize === 16 && visual.remainSize === 26, JSON.stringify(visual));
    check("ポモドーロ見出し・56px SVG円弧・--tower-purpleと厳密一致するstrokeを使う",
      (await page.locator(".today-pomodoro .today-panel-title").textContent()).includes("ポモドーロ")
      && Math.abs(visual.ringWidth - 56) < 0.5 && visual.ringTag === "svg"
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

    console.log('[3] 旧表示属性で新配置のリングを変形させない');
    const expanded = await page.evaluate(() => {
      const ring = document.querySelector(".pomo-circle-wrap");
      ring.style.transition = "none";
      document.querySelector(".today-tower").dataset.viewLife = "0";
      return ring.getBoundingClientRect().width;
    });
    check("旧LIFE属性でも56pxリング", Math.abs(expanded - 56) < 0.5, `${expanded}px`);

    console.log("[4] 実行便なしでも上帯2内の既存empty分岐を維持する");
    await seed([]);
    const empty = page.locator('.tower-runway .tower-nowhud[data-status="empty"]');
    check("empty HUDが上帯2内に1つ", await empty.count() === 1);
    check("未計画の空表示は追加案内、開始操作は無い", (await empty.textContent()).includes("本日の予定はありません")
      && await empty.locator('[data-action="nav"][data-view="exec"]').count() === 1
      && await empty.locator('[data-action="now-start"]').count() === 0);
    await empty.locator('[data-action="nav"][data-view="exec"]').click();
    await page.waitForSelector('#app[data-view="exec"]');
    // v374修正: normalizeState()は「その他」Project/Task(kind:"other")の存在を必ず保証する
    // (v28からの既定仕様。seed()のreload時にも必ず再生成される、実行タブへの遷移とは無関係の
    // 常設プレースホルダ)。この検査の意図は「実行タブへの遷移そのものが予定/Taskを自動生成
    // しない」ことの確認なので、この常設の「その他」Task以外に新規Task/Blockが増えていない
    // ことを見る(tasks.length===0という以前の前提はこの既定Taskを踏まえておらず誤り)。
    check("空状態の追加導線で実行へ移動しても予定を自動作成しない", await page.evaluate((key) => {
      const value = JSON.parse(localStorage.getItem(key));
      const nonOtherTasks = value.tasks.filter((t) => t.kind !== "other");
      return value.blocks.length === 0 && nonOtherTasks.length === 0;
    }, STATE_KEY));

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
