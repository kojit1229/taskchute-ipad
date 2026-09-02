// v320: ルーティン未完了タイルの2列×4行・完了一時表示・安定G番号を固定する。
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
      const tile = strip.querySelector(".tower-gate");
      const tileHeight = tile?.getBoundingClientRect().height || 0;
      const gap = parseFloat(style.rowGap) || 0;
      const maxFourRows = tileHeight * 4 + gap * 3
        + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      strip.scrollTop = strip.scrollHeight;
      return {
        height: strip.getBoundingClientRect().height, maxFourRows,
        clientHeight: strip.clientHeight, scrollHeight: strip.scrollHeight, scrollTop: strip.scrollTop,
        clientWidth: strip.clientWidth, scrollWidth: strip.scrollWidth,
        columns: style.gridTemplateColumns.trim().split(/\s+/).filter(Boolean),
        overflowX: style.overflowX, overflowY: style.overflowY,
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

    console.log("[1] 非編集モードは未完了10件だけを描画し、完了済みと早起き済みを隠す");
    const initialIds = await page.locator("#towerGateStrip .tower-gate").evaluateAll((tiles) => tiles.map((tile) => tile.dataset.id));
    check(".tower-gateは未完了Blockの10件だけ", initialIds.length === 10
      && initialIds.every((id) => /^v320-block-(?:[1-9]|10)$/.test(id)), JSON.stringify(initialIds));
    check("完了済み3件のdata-idと早起き固定席はDOMにない", completedIds.every((id) => !initialIds.includes(id))
      && await page.locator('.tower-gate-fixed, .tower-gate[data-docked="1"]').count() === 0);
    check("件数行は早起き済みも算入した完了表示ボタン", (await page.locator("#towerGateCount").textContent()) === "未完了10件・完了4件を表示"
      && await page.locator('.tower-gate-showdone[data-action="tower-gate-showdone-toggle"]').count() === 1);

    console.log("[2] 390px・1280pxとも2列×4行の高さで縦スクロールし、横へはみ出さない");
    for (const width of [390, 1280]) {
      const layout = await layoutAt(width);
      check(`${width}px: 2列grid`, layout.columns.length === 2, JSON.stringify(layout));
      check(`${width}px: 4行相当以下で9件目以降へ縦スクロール可`, layout.height <= layout.maxFourRows + 1
        && layout.scrollHeight > layout.clientHeight && layout.scrollTop > 0 && layout.overflowY === "auto", JSON.stringify(layout));
      check(`${width}px: 枠内・ページとも横スクロールなし`, layout.scrollWidth <= layout.clientWidth + 1
        && layout.pageWidth <= layout.viewportWidth + 1 && layout.overflowX === "hidden", JSON.stringify(layout));
    }
    check("表示・viewport変更では同期stateへ内容変更書込なし", await changedStateWrites() === 0,
      JSON.stringify(await page.evaluate(() => window.__v320StorageWrites)));

    console.log("[3] tickerのupdateTowerGates差分更新で消去・繰り上げ・件数・G番号を更新する");
    const stableCallsign = await page.locator('.tower-gate[data-id="v320-block-2"] span').textContent();
    await page.evaluate(async () => {
      const { state } = await import("./src/state/store.js");
      const target = state.blocks.find((block) => block.id === "v320-block-1");
      target.completed = true;
      target.actualEndAt = "2026-09-03T10:00:00";
      document.querySelector(".tower-gates").dataset.v320PatchSentinel = "kept";
    });
    await page.waitForFunction(() => !document.querySelector('.tower-gate[data-id="v320-block-1"]'));
    check("全体renderなしの差分更新で完了タイルが消え、未完了9件へ繰り上がる",
      await page.locator('.tower-gates[data-v320-patch-sentinel="kept"]').count() === 1
      && await page.locator("#towerGateStrip .tower-gate").count() === 9);
    check("差分更新後の件数は未完了9件・完了5件", (await page.locator("#towerGateCount").textContent()) === "未完了9件・完了5件を表示");
    check("絞り込み前の位置を使うため後続G番号は不変", stableCallsign === "G03"
      && await page.locator('.tower-gate[data-id="v320-block-2"] span').textContent() === stableCallsign);
    check("ticker差分更新は同期stateを書き込まない", await changedStateWrites() === 0);

    console.log("[4] 完了表示ボタンは未完了の後ろへ完了タイルを一時表示し、再度隠せる");
    await page.locator('[data-action="tower-gate-showdone-toggle"]').click();
    await page.waitForSelector('.tower-gate[data-id="v320-block-1"][data-docked="1"]');
    const shownTiles = await page.locator("#towerGateStrip .tower-gate").evaluateAll((tiles) => tiles.map((tile) => ({
      id: tile.dataset.id, done: tile.dataset.docked === "1", callsign: tile.querySelector("span")?.textContent.trim()
    })));
    const firstDone = shownTiles.findIndex((tile) => tile.done);
    check("完了5件は未完了9件の後ろに並び、既存data-actionを保つ", shownTiles.length === 14 && firstDone === 9
      && shownTiles.slice(firstDone).every((tile) => tile.done)
      && await page.locator('#towerGateStrip .tower-gate[data-docked="1"][data-action]').count() === 5, JSON.stringify(shownTiles));
    check("完了表示中も元位置のG番号を維持", shownTiles.find((tile) => tile.id === "v320-block-1")?.callsign === "G02"
      && shownTiles.find((tile) => tile.id === "v320-block-11")?.callsign === "G12", JSON.stringify(shownTiles));
    const showDoneStyle = await page.locator(".tower-gate-showdone").evaluate((button) => ({
      text: button.textContent.trim(), height: button.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(button).fontSize)
    }));
    check("表示ボタンは『隠す』へ変わり44px・11px以上", showDoneStyle.text === "完了5件を隠す"
      && showDoneStyle.height >= 44 && showDoneStyle.fontSize >= 11, JSON.stringify(showDoneStyle));
    await page.locator('[data-action="tower-gate-showdone-toggle"]').click();
    await page.waitForFunction(() => document.querySelectorAll("#towerGateStrip .tower-gate").length === 9);
    check("再タップで完了タイルを隠す", (await page.locator("#towerGateCount").textContent()) === "未完了9件・完了5件を表示");
    await page.evaluate(async () => {
      const { state } = await import("./src/state/store.js");
      state.blocks.filter((block) => block.date === "2026-09-03" && block.category === "ルーティン")
        .forEach((block) => { block.completed = true; });
      document.querySelector(".tower-gates").dataset.v320AllDonePatchSentinel = "kept";
    });
    await page.waitForSelector(".tower-gate-alldone");
    check("差分更新で全完了行へ遷移し件数も更新", await page.locator('.tower-gates[data-v320-all-done-patch-sentinel="kept"] .tower-gate-alldone').count() === 1
      && (await page.locator("#towerGateCount").textContent()) === "未完了0件・完了14件を表示");

    console.log("[5] 全完了は中立な1行表示、編集モードは390px・1280pxとも右端操作を保つ");
    await page.evaluate(({ key, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.blocks = state.blocks.map((block) => block.date === today && block.category === "ルーティン"
        ? { ...block, completed: true, actualEndAt: block.actualEndAt || `${today}T10:00:00` }
        : block);
      localStorage.setItem(key, JSON.stringify(state));
      window.__v320StorageWrites = [];
    }, { key: STATE_KEY, today: TODAY });
    await page.reload();
    await page.waitForSelector(".tower-gate-alldone");
    const allDoneStyle = await page.locator(".tower-gate-alldone").evaluate((element) => ({
      text: element.textContent.trim(), height: element.getBoundingClientRect().height,
      animationName: getComputedStyle(element).animationName, color: getComputedStyle(element).color,
      opacity: getComputedStyle(element).opacity
    }));
    check("全完了は『ルーティン完了』1行だけ", allDoneStyle.text === "ルーティン完了"
      && await page.locator("#towerGateStrip .tower-gate").count() === 0 && allDoneStyle.height >= 44, JSON.stringify(allDoneStyle));
    check("全完了行はアニメーションなしの中立表示", allDoneStyle.animationName === "none"
      && Number(allDoneStyle.opacity) < 1, JSON.stringify(allDoneStyle));
    check("全完了の件数文言と表示ボタン", (await page.locator("#towerGateCount").textContent()) === "未完了0件・完了14件を表示");
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
      check(`${width}px編集モードは削除ボタンの44px領域をクリップしない`, editorLayout.overflowX === "visible"
        && editorLayout.buttonRect.width >= 44 && editorLayout.buttonRect.height >= 44
        && editorLayout.buttonRect.left >= editorLayout.stripRect.left - 1
        && editorLayout.buttonRect.right <= editorLayout.stripRect.right + 1
        && editorLayout.pageWidth <= editorLayout.viewportWidth + 1, JSON.stringify(editorLayout));
    }
    await page.setViewportSize({ width: 390, height: 900 });

    console.log("[6] 日付跨ぎで完了表示トグルをOFFへ戻し、ticker差分更新する");
    await page.locator('[data-action="tower-gate-edit-toggle"]').click();
    await page.locator('[data-action="tower-gate-showdone-toggle"]').click();
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
    await page.waitForFunction(() => document.querySelector(".tower-gate-showdone")?.textContent.trim() === "完了2件を表示");
    const nextDayGate = await page.evaluate(() => ({
      ids: [...document.querySelectorAll("#towerGateStrip .tower-gate")].map((gate) => ({
        id: gate.dataset.id, callsign: gate.querySelector("span")?.textContent.trim(), done: gate.dataset.docked
      })),
      count: document.querySelector("#towerGateCount")?.textContent || ""
    }));
    check("翌日はトグルOFFで完了を隠し、翌日未完了だけを表示",
      nextDayGate.ids.length === 1 && nextDayGate.ids[0].id === "v320-next-open" && nextDayGate.ids[0].callsign === "G02",
      JSON.stringify(nextDayGate));
    check("pageerror 0", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\n✅ v320 ALL PASS" : `\n❌ v320: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
