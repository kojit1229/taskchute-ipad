// v320: ルーティンチップの折り返し・完了の常時表示/取消・安定G番号を固定する。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY, dismissBodyScanIfOpen
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-03";
const FIXED_NOW = new Date(2026, 8, 3, 10, 0, 0, 0);
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({
    serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo"
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);

  const changedStateWrites = () => page.evaluate((key) =>
    window.__v320StorageWrites.filter((entry) => entry.key === key && entry.changed).length, STATE_KEY);
  const layoutAt = async (width) => {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return page.locator("#towerGateStrip").evaluate((strip) => {
      const style = getComputedStyle(strip);
      return {
        display: style.display, flexWrap: style.flexWrap,
        chipHeights: [...strip.querySelectorAll(".tower-gate")].map(chip => chip.getBoundingClientRect().height),
        clientWidth: strip.clientWidth, scrollWidth: strip.scrollWidth,
        pageWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth
      };
    });
  };

  try {
    await page.addInitScript(() => {
      window.__v320StorageWrites = [];
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (this === localStorage) {
          window.__v320StorageWrites.push({ key: String(key), changed: this.getItem(key) !== String(value) });
        }
        return originalSetItem.call(this, key, value);
      };
    });
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    const completedIds = await page.evaluate(({ key, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      const stamp = `${today}T06:00:00`;
      const rules = Array.from({ length: 13 }, (_, index) => ({
        id: `v320-rule-${index + 1}`, title: `ルーティン${index + 1}`, category: "ルーティン",
        taskId: "", kind: "daily", startTime: `${String(6 + Math.floor(index / 6)).padStart(2, "0")}:${String((index % 6) * 5).padStart(2, "0")}`,
        endTime: "", anchorDate: today, anchor: "v320-fixture-anchor", order: index,
        protection: false, fallbackTitle: "", fallbackMinutes: null, streakSince: null,
        exceptionDates: [], createdAt: stamp, updatedAt: stamp, deleted: false
      }));
      const blocks = rules.map((rule, index) => ({
        id: `v320-block-${index + 1}`, taskId: "", date: today, title: rule.title, category: "ルーティン",
        plannedStartAt: `${today}T${rule.startTime}`, plannedEndAt: "", actualStartAt: "", actualEndAt: "",
        completed: index >= 10, deleted: false, oneTap: false, recurrenceGroupId: rule.id,
        charge: 0, discharge: 0, estimateMin: 5, comment: "", pomodoroCount: 0,
        createdAt: stamp, updatedAt: stamp
      }));
      state.currentView = "today";
      state.selectedDate = today;
      state.settings.autoSync = false;
      state.settings.lastOpenedDate = today;
      state.journals[today] = `# ${today} のジャーナル`;
      state.blocks = blocks;
      state.recurrences = rules;
      state.earlyBird = { logs: { [today]: { checkedAt: `${today}T05:30:00` } } };
      localStorage.setItem(key, JSON.stringify(state));
      window.__v320StorageWrites = [];
      return blocks.filter((block) => block.completed).map((block) => block.id);
    }, { key: STATE_KEY, today: TODAY });
    await page.reload();
    await page.waitForSelector('.tower-gate[data-id="v320-block-1"]');
    // 起動時normalizeStateの既存保存は対象外にし、表示操作以降の書き込みだけを監視する。
    await page.evaluate(() => { window.__v320StorageWrites = []; });

    console.log("[1] 未完了10件・完了3件・早起き済みを常時チップ表示する");
    const initialIds = await page.locator("#towerGateStrip .tower-gate").evaluateAll((tiles) => tiles.map((tile) => tile.dataset.id));
    const expectedIds = ["__early_bird__", ...Array.from({ length: 13 }, (_, i) => `v320-block-${i + 1}`)];
    check("早起きと全13Blockのチップを重複なく表示", JSON.stringify([...initialIds].sort()) === JSON.stringify([...expectedIds].sort()), JSON.stringify(initialIds));
    const completedChips = await page.locator('#towerGateStrip .tower-gate[data-docked="1"]').evaluateAll(chips => chips.map(chip => ({
      id: chip.dataset.id, struck: getComputedStyle(chip.querySelector("strong")).textDecorationLine.includes("line-through")
    })));
    check("完了3件と早起き済みはdata-dockedと取り消し線を持つ", completedChips.length === 4 && completedChips.every(chip => chip.struck)
      && JSON.stringify(completedChips.map(chip => chip.id).sort()) === JSON.stringify(["__early_bird__", ...completedIds].sort()), JSON.stringify(completedChips));
    check("見出しは未完了10 · 完了4、表示切替なし", (await page.locator(".sec-gates h2").textContent()).includes("未完了10 · 完了4")
      && await page.locator('.tower-gate-showdone').count() === 0);

    console.log("[2] 390px・1280pxともチップを折り返し、44pxと横はみ出しなしを保つ");
    for (const width of [390, 1280]) {
      const layout = await layoutAt(width);
      check(`${width}px: flexでチップを折り返す`, layout.display === "flex" && layout.flexWrap === "wrap", JSON.stringify(layout));
      check(`${width}px: 全14チップが44px以上`, layout.chipHeights.length === 14 && layout.chipHeights.every(height => height >= 44), JSON.stringify(layout));
      check(`${width}px: 枠内・ページとも横スクロールなし`, layout.scrollWidth <= layout.clientWidth + 1
        && layout.pageWidth <= layout.viewportWidth + 1, JSON.stringify(layout));
    }
    check("表示・viewport変更では同期stateへ内容変更書込なし", await changedStateWrites() === 0,
      JSON.stringify(await page.evaluate(() => window.__v320StorageWrites)));

    console.log("[3] tickerのupdateTowerGates差分更新で完了チップ・件数・G番号を更新する");
    const stableCallsign = await page.locator('.tower-gate[data-id="v320-block-2"] span').textContent();
    await page.evaluate(async () => {
      const { state } = await import("./src/state/store.js");
      const target = state.blocks.find((block) => block.id === "v320-block-1");
      target.completed = true;
      target.actualEndAt = "2026-09-03T10:00:00";
      document.querySelector(".tower-gates").dataset.v320PatchSentinel = "kept";
    });
    await page.waitForFunction(() => document.querySelector('.tower-gate[data-id="v320-block-1"]')?.dataset.docked === "1");
    check("全体renderなしの差分更新で全14チップを保ち、対象が完了に変わる",
      await page.locator('.tower-gates[data-v320-patch-sentinel="kept"]').count() === 1
      && await page.locator("#towerGateStrip .tower-gate").count() === 14
      && await page.locator('.tower-gate[data-id="v320-block-1"][data-docked="1"]').count() === 1);
    check("差分更新後の件数は未完了9件・完了5件", (await page.locator(".sec-gates h2").textContent()).includes("未完了9 · 完了5"));
    check("絞り込み前の位置を使うため後続G番号は不変", stableCallsign === "G03"
      && await page.locator('.tower-gate[data-id="v320-block-2"] span').textContent() === stableCallsign);
    check("ticker差分更新は同期stateを書き込まない", await changedStateWrites() === 0);

    console.log("[4] 完了チップは常時表示され、既存actionで完了を取り消せる");
    const shownTiles = await page.locator("#towerGateStrip .tower-gate").evaluateAll((tiles) => tiles.map((tile) => ({
      id: tile.dataset.id, done: tile.dataset.docked === "1", callsign: tile.querySelector("span")?.textContent.trim(),
      action: tile.dataset.action, visible: tile.getBoundingClientRect().height > 0
    })));
    check("完了5件を含む全14チップは同じ並びで見え、既存actionを保つ", JSON.stringify(shownTiles.map(tile => tile.id)) === JSON.stringify(initialIds)
      && shownTiles.filter(tile => tile.done).length === 5 && shownTiles.every(tile => tile.visible
        && tile.action === (tile.id === "__early_bird__" ? "early-bird-check" : "now-conveyor-complete")), JSON.stringify(shownTiles));
    check("完了表示中も元位置のG番号を維持", shownTiles.find((tile) => tile.id === "v320-block-1")?.callsign === "G02"
      && shownTiles.find((tile) => tile.id === "v320-block-11")?.callsign === "G12", JSON.stringify(shownTiles));
    await page.locator('.tower-gate[data-action="now-conveyor-complete"][data-id="v320-block-11"]').click();
    await page.waitForFunction(() => document.querySelector('.tower-gate[data-id="v320-block-11"]')?.dataset.docked === "0");
    check("完了Blockを再タップして取消できる", (await page.locator(".sec-gates h2").textContent()).includes("未完了10 · 完了4")
      && await page.locator('.tower-gate[data-id="v320-block-11"] strong').evaluate(el => !getComputedStyle(el).textDecorationLine.includes("line-through")));
    await page.locator('.tower-gate[data-action="early-bird-check"]').click();
    await page.waitForFunction(() => document.querySelector('.tower-gate[data-action="early-bird-check"]')?.dataset.docked === "0");
    check("早起き済みも再タップして取消できる", (await page.locator(".sec-gates h2").textContent()).includes("未完了11 · 完了3")
      && await page.locator('.tower-gate[data-action="early-bird-check"] strong').evaluate(el => !getComputedStyle(el).textDecorationLine.includes("line-through")));
    // 全完了・復元・編集の既存検査に向けて早起きを再完了する。
    await page.locator('.tower-gate[data-action="early-bird-check"]').click();
    await page.waitForFunction(() => document.querySelector('.tower-gate[data-action="early-bird-check"]')?.dataset.docked === "1");
    await page.evaluate(async () => {
      const { state } = await import("./src/state/store.js");
      state.blocks.filter((block) => block.date === "2026-09-03" && block.category === "ルーティン")
        .forEach((block) => { block.completed = true; });
      document.querySelector(".tower-gates").dataset.v320AllDonePatchSentinel = "kept";
    });
    await page.waitForFunction(() => document.querySelectorAll('#towerGateStrip .tower-gate[data-docked="1"]').length === 14);
    check("差分更新で全14件が完了チップに変わり件数も更新", await page.locator('.tower-gates[data-v320-all-done-patch-sentinel="kept"]').count() === 1
      && (await page.locator(".sec-gates h2").textContent()).includes("未完了0 · 完了14"));

    console.log("[5] 全完了でもチップを維持し、編集モードは390px・1280pxとも右端操作を保つ");
    await page.evaluate(({ key, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.blocks = state.blocks.map((block) => block.date === today && block.category === "ルーティン"
        ? { ...block, completed: true, actualEndAt: block.actualEndAt || `${today}T10:00:00` }
        : block);
      localStorage.setItem(key, JSON.stringify(state));
      window.__v320StorageWrites = [];
    }, { key: STATE_KEY, today: TODAY });
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#towerGateStrip .tower-gate[data-docked="1"]').length === 14);
    const allDoneChips = await page.locator("#towerGateStrip .tower-gate").evaluateAll(chips => chips.map(chip => ({
      id: chip.dataset.id, height: chip.getBoundingClientRect().height,
      struck: getComputedStyle(chip.querySelector("strong")).textDecorationLine.includes("line-through")
    })));
    check("全完了でも全14チップを44px以上で表示", JSON.stringify(allDoneChips.map(chip => chip.id).sort()) === JSON.stringify([...expectedIds].sort())
      && allDoneChips.every(chip => chip.height >= 44), JSON.stringify(allDoneChips));
    check("全完了チップはすべて取り消し線で表示", allDoneChips.length === 14 && allDoneChips.every(chip => chip.struck), JSON.stringify(allDoneChips));
    check("全完了の件数文言と表示切替の廃止", (await page.locator(".sec-gates h2").textContent()).includes("未完了0 · 完了14")
      && await page.locator(".tower-gate-showdone").count() === 0);
    check("全完了の復元描画ではstate非書込", await changedStateWrites() === 0, String(await changedStateWrites()));

    const beforeEdit = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('[data-action="tower-gate-edit-toggle"]').click();
    await page.waitForSelector(".tower-gate-editor");
    check("編集モードは完了済みを含む13ルールと早起き固定席を表示",
      await page.locator(".tower-gate-edit-row").count() === 13
      && await page.locator('.tower-gate-fixed[data-docked="1"]').count() === 1);
    check("編集モード切替でもstate非書込", await page.evaluate((key) => localStorage.getItem(key), STATE_KEY) === beforeEdit
      && await changedStateWrites() === 0);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const editorLayout = await page.locator(".tower-gate-edit-row").first().evaluate((row) => {
        const strip = document.querySelector("#towerGateStrip");
        const button = row.querySelector('button[data-action="tower-gate-delete"]');
        const stripRect = strip.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        return { overflowX: getComputedStyle(strip).overflowX, stripRect, rowRect, buttonRect,
          pageWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
      });
      check(`${width}px編集モードは削除ボタンの44px領域をクリップしない`, editorLayout.overflowX === (width >= 1280 ? "auto" : "visible")
        && editorLayout.buttonRect.width >= 44 && editorLayout.buttonRect.height >= 44
        && editorLayout.buttonRect.left >= editorLayout.stripRect.left - 1
        && editorLayout.buttonRect.right <= editorLayout.stripRect.right + 1
        && editorLayout.buttonRect.top >= editorLayout.stripRect.top - 1
        && editorLayout.buttonRect.bottom <= editorLayout.stripRect.bottom + 1
        && editorLayout.pageWidth <= editorLayout.viewportWidth + 1, JSON.stringify(editorLayout));
    }
    await page.setViewportSize({ width: 390, height: 900 });

    console.log("[6] 日付跨ぎでも完了を含む翌日チップへticker差分更新する");
    await page.locator('[data-action="tower-gate-edit-toggle"]').click();
    await page.waitForSelector('.tower-gate[data-docked="1"]');
    await page.evaluate(async () => {
      const { state } = await import("./src/state/store.js");
      const source = state.blocks[0];
      state.blocks.push(
        { ...source, id: "v320-next-open", date: "2026-09-04", completed: false, actualEndAt: "", recurrenceGroupId: "v320-rule-1" },
        { ...source, id: "v320-next-done", date: "2026-09-04", completed: true, recurrenceGroupId: "v320-rule-2" }
      );
      state.earlyBird.logs["2026-09-04"] = { checkedAt: "2026-09-04T05:30:00" };
    });
    await page.clock.setFixedTime(new Date(2026, 8, 4, 10, 0, 0, 0));
    await page.waitForFunction(() => document.querySelector(".sec-gates h2")?.textContent.includes("未完了1 · 完了2"));
    const nextDayGate = await page.evaluate(() => ({
      ids: [...document.querySelectorAll("#towerGateStrip .tower-gate")].map((gate) => ({
        id: gate.dataset.id, callsign: gate.querySelector("span")?.textContent.trim(), done: gate.dataset.docked
      })),
      count: document.querySelector(".sec-gates h2")?.textContent || ""
    }));
    check("翌日は未完了・完了・早起き済みを表示しG番号を保つ",
      nextDayGate.ids.length === 3 && nextDayGate.ids.some(chip => chip.id === "v320-next-open" && chip.callsign === "G02" && chip.done === "0")
        && nextDayGate.ids.some(chip => chip.id === "v320-next-done" && chip.done === "1")
        && nextDayGate.ids.some(chip => chip.id === "__early_bird__" && chip.done === "1"),
      JSON.stringify(nextDayGate));
    check("pageerror 0", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\n✅ v320 ALL PASS" : `\n❌ v320: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
