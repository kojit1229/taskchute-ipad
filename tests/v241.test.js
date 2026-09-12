// v241/v313: Today VIEWの個別表示・端末ローカル保持・CABIN TIMER固定配置・ticker継続。
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

    console.log("[1] 必須8項目と主役/タイマーは単一DOMで常設する");
    const sections = ['.daily-today-clock', '.life-band', '.so-row', '.tower-runway', '#dailyTodayPlans', '.sec-log', '.sec-gates', '.sec-journal'];
    const allPresent = () => page.evaluate(selectors => selectors.every(s => document.querySelectorAll(s).length === 1), sections);
    check("必須8項目は全て1つ", await allPresent());
    check("予定欄は共通一覧1つ", await page.locator('#dailyTodayPlans > [data-work-list="today"]').count() === 1);
    check("記録列は実績/ルーティン/本文の3つ", JSON.stringify(await page.locator('.daily-today-records > *').evaluateAll(nodes => nodes.map(el => ['sec-log', 'sec-gates', 'sec-journal'].find(c => el.classList.contains(c))))) === JSON.stringify(['sec-log', 'sec-gates', 'sec-journal']));
    check("主役とタイマーは現在作業の内側に各1つ", await page.locator('.tower-runway > .tower-mit').count() === 1 && await page.locator('.tower-runway > .today-pomodoro').count() === 1);
    check("既定値の読取だけでは専用キーを書かない", await page.evaluate(key => localStorage.getItem(key) === null, FOCUS_KEY));
    const jumpActions = ['today-plans-jump', 'today-journal-jump'];
    const tapRects = await page.locator('.daily-today-clock nav button').evaluateAll(nodes => nodes.map(el => ({ action: el.dataset.action, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
    check("移動操作の集合は予定へ/記録へで44px以上", JSON.stringify(tapRects.map(r => r.action)) === JSON.stringify(jumpActions) && tapRects.every(r => r.width >= 44 && r.height >= 44), JSON.stringify(tapRects));

    console.log("[2] 旧非表示値を消去せず無視しリロード後も8項目を保持");
    for (const sections of [{ side: false, journal: true, life: true }, { side: true, journal: false, life: true }, { side: false, journal: false, life: false }]) {
      const legacy = JSON.stringify({ sections, restore: sections });
      await page.evaluate(({ key, legacy }) => localStorage.setItem(key, legacy), { key: FOCUS_KEY, legacy });
      await page.reload();
      await page.waitForSelector('.today-tower');
      check('旧値でも全項目表示 ' + legacy, await allPresent());
      check('旧値を保持 ' + legacy, await page.evaluate(key => localStorage.getItem(key), FOCUS_KEY) === legacy);
      check('旧設定でも固定GATEとタイマーは1つ', await page.locator('.sec-gates').count() === 1 && await page.locator('.today-pomodoro').count() === 1);
    }
    console.log("[3] 新移動操作は同期state/旧表示設定を変えない");
    const beforeNavigation = await page.evaluate(({ STATE_KEY, FOCUS_KEY }) => [localStorage.getItem(STATE_KEY), localStorage.getItem(FOCUS_KEY)], { STATE_KEY, FOCUS_KEY });
    for (const action of jumpActions) {
      await page.click('[data-action="' + action + '"]');
      check(action + ' 後も8項目常設', await allPresent());
      check(action + ' は保存を書き換えない', JSON.stringify(await page.evaluate(({ STATE_KEY, FOCUS_KEY }) => [localStorage.getItem(STATE_KEY), localStorage.getItem(FOCUS_KEY)], { STATE_KEY, FOCUS_KEY })) === JSON.stringify(beforeNavigation));
    }
    check('記録へは本文をフォーカス', await page.locator('#towerJournalFree').evaluate(el => el === document.activeElement));

    console.log("[4/5] PC/狭幅で順序・包含・寸法と非重複を保持");
    for (const width of [1440, 1280, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.evaluate(selectors => {
        const rect = s => document.querySelector(s).getBoundingClientRect().toJSON();
        return { panels: selectors.map(rect), mit: rect('.tower-mit'), timer: rect('.today-pomodoro'), ring: rect('.pomo-circle-wrap'), overflow: document.documentElement.scrollWidth > innerWidth };
      }, sections);
      const [clock, life, creed, current, plans, log, gate, journal] = layout.panels;
      check(width + 'pxは8項目全て正の寸法・横溢れなし', layout.panels.length === 8 && layout.panels.every(r => r.width > 0 && r.height > 0) && !layout.overflow, JSON.stringify(layout));
      check(width + 'pxで時計→人生/信条→現在作業→予定の順', life.top >= clock.bottom && current.top >= Math.max(life.bottom, creed.bottom) && plans.top >= current.bottom, JSON.stringify(layout));
      check(width + 'pxで主役とタイマーは現在作業の内側', [layout.mit, layout.timer].every(r => r.width > 0 && r.height > 0 && r.left >= current.left && r.right <= current.right && r.top >= current.top && r.bottom <= current.bottom), JSON.stringify(layout));
      check(width + 'pxで主役とタイマーは重ならない', layout.mit.right <= layout.timer.left || layout.mit.bottom <= layout.timer.top, JSON.stringify(layout));
      check(width + 'pxでも56pxの円形タイマー', Math.abs(layout.ring.width - 56) < .5 && Math.abs(layout.ring.height - 56) < .5, JSON.stringify(layout));
      if (width >= 1280) {
        check(width + 'pxは人生/信条が同高・同幅の2枠', Math.abs(life.top - creed.top) < 1 && Math.abs(life.height - creed.height) < 1 && Math.abs(life.width - creed.width) < 1 && creed.left > life.right, JSON.stringify(layout));
        check(width + 'pxは左予定・右記録', Math.abs(plans.top - log.top) < 1 && log.left > plans.right && gate.top >= log.bottom && journal.top >= gate.bottom, JSON.stringify(layout));
      } else {
        check(width + 'pxは人生→信条→現在作業→予定→実績→ルーティン→本文', layout.panels.every((r, i, all) => !i || r.top >= all[i - 1].bottom), JSON.stringify(layout));
        check(width + 'pxは8項目の左端が揃う', layout.panels.every(r => Math.abs(r.left - current.left) < 1), JSON.stringify(layout));
      }
    }

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
    await page.click('[data-action="today-plans-jump"]');
    await page.waitForSelector('.tower-runway .today-pomodoro');
    const timerState = await page.evaluate(({ STATE_KEY, FOCUS_KEY }) => {
      const state = JSON.parse(localStorage.getItem(STATE_KEY));
      const focus = JSON.parse(localStorage.getItem(FOCUS_KEY));
      return { running: state.pomodoro.running, blockId: state.pomodoro.blockId, focus, leaked: "todayFocus" in state || "focusVisibility" in state };
    }, { STATE_KEY, FOCUS_KEY });
    check("切替後もポモドーロstateは実行中の同一Block", timerState.running && timerState.blockId === "focus-timer-block", JSON.stringify(timerState));
    check("旧表示状態は専用キーに残り同期stateへ混入しない", !!timerState.focus && !timerState.leaked, JSON.stringify(timerState));
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
