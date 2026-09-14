// v313 tower/view/render/表示: 3系統VIEWチップと列組み替えなしリフローのcharacterization test。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");

const PORT = randomPort();
const FOCUS_KEY = "taskchute-journal-today-focus-v1";
const FIXED_NOW = new Date(2026, 8, 1, 10, 0, 0, 0);
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);

  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.evaluate(({ stateKey, focusKey }) => {
      const state = JSON.parse(localStorage.getItem(stateKey));
      state.currentView = "today";
      state.selectedDate = "2026-09-01";
      state.blocks = [{
        id: "v313-running", date: "2026-09-01", title: "VIEW ticker便", category: "仕事",
        plannedStartAt: "2026-09-01T09:30", plannedEndAt: "2026-09-01T10:30",
        actualStartAt: "2026-09-01T09:30", actualEndAt: "", completed: false, deleted: false,
        charge: 0, discharge: 0, estimateMin: 60, comment: "", recurrenceGroupId: "", pomodoroCount: 0
      }];
      localStorage.setItem(stateKey, JSON.stringify(state));
      localStorage.setItem(focusKey, JSON.stringify({
        sections: { gate: false, journal: true }, restore: { gate: false, journal: true }
      }));
    }, { stateKey: STATE_KEY, focusKey: FOCUS_KEY });
    await page.reload();
    await page.waitForSelector('.today-tower[data-daily-view="today"]');
    const selectors = ['.daily-today-clock', '.life-band', '.so-row', '.tower-runway', '#dailyTodayPlans', '.sec-log', '.sec-gates', '.sec-journal'];
    const permanent = () => page.evaluate(selectors => selectors.every(s => document.querySelectorAll(s).length === 1), selectors);
    const oldStorage = await page.evaluate(key => localStorage.getItem(key), FOCUS_KEY);
    check('旧gate値でも8項目と固定GATEを常設', await permanent() && await page.locator('.tower-gate-fixed').count() === 1);
    check('初回読取は旧localStorageを1バイトも変更しない', oldStorage === JSON.stringify({ sections: { gate: false, journal: true }, restore: { gate: false, journal: true } }));
    const actions = await page.locator('.daily-today-clock nav button').evaluateAll(nodes => nodes.map(el => ({ action: el.dataset.action, text: el.textContent.trim() })));
    check('移動バーは予定へ/記録への完全な集合', JSON.stringify(actions) === JSON.stringify([{ action: 'today-plans-jump', text: '予定へ' }, { action: 'today-journal-jump', text: '記録へ' }]), JSON.stringify(actions));
    const stateBefore = await page.evaluate(key => localStorage.getItem(key), STATE_KEY);
    for (const action of ['today-plans-jump', 'today-journal-jump']) {
      await page.click('[data-action="' + action + '"]');
      check(action + ': 全8項目を保持', await permanent());
      check(action + ': 同期stateと旧専用キーへ非書込', await page.evaluate(({ stateKey, focusKey, stateBefore, oldStorage }) => localStorage.getItem(stateKey) === stateBefore && localStorage.getItem(focusKey) === oldStorage, { stateKey: STATE_KEY, focusKey: FOCUS_KEY, stateBefore, oldStorage }));
    }
    check('記録入口は常設本文にフォーカス', await page.locator('#towerJournalFree').evaluate(el => el === document.activeElement));
    const beforeTick = await page.locator('#towerNowRemain').textContent();
    await page.clock.setFixedTime(new Date(2026, 8, 1, 10, 1, 0, 0));
    await page.waitForFunction(before => document.querySelector('#towerNowRemain')?.textContent !== before, beforeTick);
    check('新移動操作後も実行中の1秒tickerを継続', (await page.locator('#towerNowRemain').textContent()) !== beforeTick);
    check('tickerも同期stateへ非書込', await page.evaluate(key => localStorage.getItem(key), STATE_KEY) === stateBefore);
    console.log('[8] 旧side/journal/life全8通りを両幅で検査');
    // fixF6d(監督者決定2、F6-1/F6-2/F6-3): MITはNOW LANDINGの外の独立見出しへ移動し、
    // LIFE BAND/信条は常に縦積み(旧「同高・同幅の2枠」は廃止)、予定/記録群/本文は
    // 1280px以上で横3列・767px以下で縦積みになった(v241と同じ新配置)。8通り×2幅の
    // 「常設・旧設定非適用・順序・包含・44px」という同じ性質を新配置の列(mit/records/journal
    // を含む)で検査する。
    const layoutSelectors = ['.daily-today-clock', '.tower-mit', '.life-band', '.so-row', '.tower-runway', '#dailyTodayPlans', '.daily-today-records', '.tower-journal'];
    for (const width of [1440, 390]) for (let mask = 0; mask < 8; mask++) {
      const sections = { side: Boolean(mask & 4), journal: Boolean(mask & 2), life: Boolean(mask & 1) };
      const saved = JSON.stringify({ sections, restore: sections });
      await page.evaluate(({ key, saved }) => localStorage.setItem(key, saved), { key: FOCUS_KEY, saved });
      await page.setViewportSize({ width, height: 1100 });
      await page.reload();
      await page.waitForSelector('.today-tower[data-daily-view="today"]');
      const layout = await page.evaluate(selectors => {
        const r = s => document.querySelector(s).getBoundingClientRect().toJSON();
        const root = document.querySelector('.today-tower');
        return { panels: selectors.map(r), timer: r('.today-pomodoro'), ring: r('.pomo-circle-wrap'),
          legacyAttributes: ['data-view-side','data-view-journal','data-view-life','data-focus-mode'].filter(a => root.hasAttribute(a)),
          scrollWidth: document.documentElement.scrollWidth, innerWidth };
      }, layoutSelectors);
      const [clock, mit, life, creed, current, plans, records, journal] = layout.panels;
      check(width + 'px mask=' + mask + ': 常設8項目・旧設定を非適用', await permanent() && layout.legacyAttributes.length === 0 && layout.panels.every(r => r.width > 0 && r.height > 0), JSON.stringify(layout));
      check(width + 'px mask=' + mask + ': 旧保存を保持', await page.evaluate(key => localStorage.getItem(key), FOCUS_KEY) === saved);
      check(width + 'px mask=' + mask + ': 固定GATE・単一タイマー・横溢れなし', await page.locator('.tower-gate-fixed').count() === 1 && await page.locator('.today-pomodoro').count() === 1 && layout.scrollWidth <= layout.innerWidth + 1, JSON.stringify(layout));
      check(width + 'px mask=' + mask + ': タイマーを現在作業内に包含・MITは独立', layout.timer.left >= current.left && layout.timer.right <= current.right && layout.timer.top >= current.top && layout.timer.bottom <= current.bottom && mit.bottom <= current.top && Math.abs(layout.ring.width - 56) < .5, JSON.stringify(layout));
      check(width + 'px mask=' + mask + ': 時計→MIT→値→作業→予定、記録順', mit.top >= clock.bottom && life.top >= mit.bottom && current.top >= Math.max(life.bottom, creed.bottom) && plans.top >= current.bottom, JSON.stringify(layout));
      if (width >= 1280) {
        check('PCは予定・記録群・本文が横3列で同じ高さ', Math.abs(plans.top - records.top) < 1 && Math.abs(plans.top - journal.top) < 1 && records.left > plans.right && journal.left > records.right, JSON.stringify(layout));
      } else {
        check('390pxは8項目が順に縦積み', layout.panels.every((r,i,a) => !i || r.top >= a[i-1].bottom) && layout.panels.every(r => Math.abs(r.left - current.left) < 1), JSON.stringify(layout));
      }
    }
    console.log('[9] 型崩れ/部分データも保持して8項目を常設');
    for (const saved of [{ sections: { journal: false } }, { sections: { side: 'yes', journal: true, life: 1 } }, {}]) {
      await page.evaluate(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), { key: FOCUS_KEY, saved });
      await page.reload();
      await page.waitForSelector('.today-tower[data-daily-view="today"]');
      check('壊れた旧値で必須欄を欠落させない ' + JSON.stringify(saved), await permanent());
      check('旧値を勝手に書換えない ' + JSON.stringify(saved), await page.evaluate(key => localStorage.getItem(key), FOCUS_KEY) === JSON.stringify(saved));
    }
    check('全操作でpageerrorなし', pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
