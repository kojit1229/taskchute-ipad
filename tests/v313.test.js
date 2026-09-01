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

  const desktopLayout = () => page.evaluate(() => {
    const rect = (selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { x: box.x, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const root = document.querySelector(".today-tower");
    return {
      root: rect(".today-tower"), left: rect(".tower-col-left"), center: rect(".tower-col-center"),
      right: rect(".tower-col-right"), band2: rect(".tower-band2"),
      ringWidth: document.querySelector(".pomo-circle-wrap").getBoundingClientRect().width,
      side: root.dataset.viewSide, journal: root.dataset.viewJournal, life: root.dataset.viewLife,
      focusMode: root.dataset.focusMode
    };
  });

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
    await page.waitForSelector('.today-tower[data-view-side="1"][data-view-journal="1"][data-view-life="1"]');

    console.log("[1] 旧gate値を捨て、side/journal/lifeの3チップへ移行する");
    const actions = await page.$$eval(".today-focus-bar [data-action]", (nodes) => nodes.map((node) => ({
      action: node.dataset.action, text: node.textContent.trim(), pressed: node.getAttribute("aria-pressed")
    })));
    check("VIEWバーはFOCUS+運航・体調/ジャーナル/LIFE BANDの3チップ",
      JSON.stringify(actions.map(({ action }) => action)) === JSON.stringify([
        "focus-mode", "focus-toggle-side", "focus-toggle-journal", "focus-toggle-life"
      ]) && actions[1].text === "運航・体調" && actions[2].text === "ジャーナル" && actions[3].text === "LIFE BAND",
      JSON.stringify(actions));
    check("旧gate=falseを無視して左列・GATE・JOURNAL・上帯1を全表示",
      await page.locator(".tower-col-left > *").count() === 3
      && await page.locator(".tower-col-center > .sec-gates").count() === 1
      && await page.locator(".tower-col-right > .sec-journal").count() === 1
      && await page.locator(".tower-band1, .so-row").count() === 2);
    const initialFocus = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), FOCUS_KEY);
    check("初回読取だけでは旧localStorageを勝手に書き換えない", "gate" in initialFocus.sections && !("side" in initialFocus.sections));
    const stateBefore = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    const base = await desktopLayout();
    check("既定PC配置は左・中央・右の現行順を維持",
      base.left.x < base.center.x && base.center.x < base.right.x && Math.abs(base.ringWidth - 112) < 0.5,
      JSON.stringify(base));

    console.log("[2] side OFFでは左列だけを消し、中央GATEを左へ拡張する");
    await page.click('[data-action="focus-toggle-side"]');
    await page.waitForSelector('.today-tower[data-view-side="0"]');
    const sideOff = await desktopLayout();
    check("左列DOMを省略してGATE/JOURNALを維持",
      await page.locator(".tower-col-left > *").count() === 0
      && await page.locator(".sec-gates").count() === 1 && await page.locator(".sec-journal").count() === 1);
    // root.xはtoday-tower自体のborder-box起点でpaddingを含まないため、コンテンツ領域の
    // 左端はbase.left.x(padding後の実開始位置)と比較する(root.xとの直接比較はpadding分の
    // ずれで誤検出する、v313実測で発見)。
    check("中央列が左端(padding後のコンテンツ開始位置)へ移り左列幅を吸収",
      Math.abs(sideOff.center.x - base.left.x) < 1 && sideOff.center.width > base.center.width
      && Math.abs(sideOff.right.x - base.right.x) < 1, JSON.stringify({ base, sideOff }));

    console.log("[3] journal OFFでは右列だけを消し、中央GATEを右へ拡張する");
    await page.click('[data-action="focus-toggle-side"]');
    await page.click('[data-action="focus-toggle-journal"]');
    await page.waitForSelector('.today-tower[data-view-journal="0"]');
    const journalOff = await desktopLayout();
    check("JOURNAL DOMを省略して左列/GATEを維持",
      await page.locator(".tower-col-right > *").count() === 0
      && await page.locator(".tower-col-left > *").count() === 3 && await page.locator(".sec-gates").count() === 1);
    check("中央列が右端(padding後のコンテンツ終端位置)まで拡張",
      Math.abs(journalOff.center.x - base.center.x) < 1
      && Math.abs(journalOff.center.right - base.right.right) < 1
      && journalOff.center.width > base.center.width, JSON.stringify(journalOff));

    console.log("[4] side+journal OFFでは固定中央GATEを全幅にする");
    await page.click('[data-action="focus-toggle-side"]');
    await page.waitForSelector('.today-tower[data-view-side="0"][data-view-journal="0"]');
    const bothOff = await desktopLayout();
    check("中央列だけが残ってコンテンツ幅を全占有",
      await page.locator(".sec-gates").count() === 1
      && Math.abs(bothOff.center.x - base.left.x) < 1
      && Math.abs(bothOff.center.right - base.right.right) < 1, JSON.stringify(bothOff));

    console.log("[5] life OFFでは上帯1を消し、CABIN TIMERリングを156pxへ拡大する");
    await page.click('[data-action="focus-toggle-life"]');
    await page.waitForSelector('.today-tower[data-view-life="0"][data-focus-mode="1"]');
    const allOff = await desktopLayout();
    check("LIFE BAND・時計・STANDING ORDERSをDOMごと省略", await page.locator(".tower-band1, .so-row").count() === 0);
    check("上帯1の分だけ詰まりリングが156pxになる",
      allOff.band2.top < base.band2.top && Math.abs(allOff.ringWidth - 156) < 0.5, JSON.stringify({ base, allOff }));
    const beforeTick = await page.locator("#towerNowRemain").textContent();
    await page.clock.setFixedTime(new Date(2026, 8, 1, 10, 1, 0, 0));
    await page.waitForFunction((before) => document.querySelector("#towerNowRemain")?.textContent !== before, beforeTick);
    check("時計DOMが無いlife OFFでもNOW/GATE等の1秒tickerを止めない",
      (await page.locator("#towerNowRemain").textContent()) !== beforeTick);
    const persisted = await page.evaluate(({ stateKey, focusKey }) => ({
      focus: JSON.parse(localStorage.getItem(focusKey)), state: localStorage.getItem(stateKey)
    }), { stateKey: STATE_KEY, focusKey: FOCUS_KEY });
    check("保存内容はside/journal/lifeの3キーだけ",
      JSON.stringify(Object.keys(persisted.focus.sections).sort()) === JSON.stringify(["journal", "life", "side"])
      && Object.values(persisted.focus.sections).every((value) => value === false), JSON.stringify(persisted.focus));
    check("VIEW操作は同期stateへ一切書き込まない", persisted.state === stateBefore);

    console.log("[6] FOCUSは3キーを一括復元/消灯し、固定中央GATEを常時維持する");
    await page.click('[data-action="focus-mode"]');
    await page.waitForSelector('.today-tower[data-view-life="1"][data-focus-mode="0"]');
    check("直前の個別状態(side/journal OFF・life ON)へ復元",
      await page.locator(".tower-col-left > *, .tower-col-right > *").count() === 0
      && await page.locator(".tower-band1, .so-row").count() === 2 && await page.locator(".sec-gates").count() === 1);
    await page.click('[data-action="focus-mode"]');
    await page.waitForSelector('.today-tower[data-focus-mode="1"]');
    check("一括消灯後もGATE ROUTINEは常時表示", await page.locator(".tower-col-center > .sec-gates").count() === 1);
    await page.reload();
    await page.waitForSelector('.today-tower[data-view-side="0"][data-view-journal="0"][data-view-life="0"]');
    check("3キー状態はリロード後も維持", await page.locator(".sec-gates").count() === 1
      && await page.locator(".tower-col-left > *, .tower-col-right > *, .tower-band1, .so-row").count() === 0);

    console.log("[7] 390px縦積みでもOFF区画だけが消え、GATEは表示される");
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileGate = await page.locator(".sec-gates").evaluate((node) => node.getBoundingClientRect().width);
    check("狭幅でも非表示区画は復活せずGATEは実幅を持つ", mobileGate > 0
      && await page.locator(".tower-col-left > *, .tower-col-right > *, .tower-band1, .so-row").count() === 0,
      `${mobileGate}px`);
    check("pageerrorなし", pageErrors.length === 0, JSON.stringify(pageErrors));
    await page.setViewportSize({ width: 1440, height: 1100 });

    // Codexレビュー指摘: side/journal/lifeの8通りのうち110/100/010(life ONのままsideまたは
    // journalだけをOFFにする組み合わせ)が未検証だった。表駆動で全8通りを横スクロールなし・
    // GATE常時表示・対象区画のDOM有無だけの軽量チェックで網羅する。
    console.log("[8] side/journal/lifeの8通り全組み合わせでGATE常時表示・横スクロールなしを固定する");
    for (let mask = 0; mask < 8; mask++) {
      const side = Boolean(mask & 4);
      const journal = Boolean(mask & 2);
      const life = Boolean(mask & 1);
      await page.evaluate(({ key, sections }) => {
        localStorage.setItem(key, JSON.stringify({ sections, restore: sections }));
      }, { key: FOCUS_KEY, sections: { side, journal, life } });
      await page.reload();
      await page.waitForSelector(`.today-tower[data-view-side="${side ? 1 : 0}"][data-view-journal="${journal ? 1 : 0}"][data-view-life="${life ? 1 : 0}"]`);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth
      }));
      check(`side=${side} journal=${journal} life=${life}: GATE常時表示・左右列とLIFE行がキーどおり・横スクロールなし`,
        await page.locator(".sec-gates").count() === 1
        && await page.locator(".tower-col-left > *").count() === (side ? 3 : 0)
        && await page.locator(".tower-col-right > *").count() === (journal ? 1 : 0)
        && await page.locator(".tower-band1, .so-row").count() === (life ? 2 : 0)
        && overflow.scrollWidth <= overflow.innerWidth + 1,
        JSON.stringify({ side, journal, life, overflow }));
    }

    console.log("[9] 旧localStorageの型崩れ・部分データも安全な既定値へ正規化する");
    const migrationCases = [
      { label: "journalキーのみ(旧gateキー無し)", saved: { sections: { journal: false } } },
      { label: "side/lifeに不正な非boolean値が混入", saved: { sections: { side: "yes", journal: true, life: 1 } } },
      { label: "sectionsキー自体が無いオブジェクト", saved: {} }
    ];
    for (const { label, saved } of migrationCases) {
      await page.evaluate(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), { key: FOCUS_KEY, saved });
      await page.reload();
      await page.waitForSelector(".today-tower[data-view-side]");
      const normalized = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), FOCUS_KEY);
      const sections = await page.evaluate(() => {
        const root = document.querySelector(".today-tower");
        return { side: root.dataset.viewSide, journal: root.dataset.viewJournal, life: root.dataset.viewLife };
      });
      check(`${label}: side/lifeは不正値・欠落なら既定trueへ、journalはboolean値だけ尊重`,
        sections.side === "1" && sections.life === "1"
        && (typeof saved.sections?.journal !== "boolean" || sections.journal === (saved.sections.journal ? "1" : "0")),
        JSON.stringify({ saved, normalized, sections }));
    }
    check("[9]完了時点でpageerrorなし", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
