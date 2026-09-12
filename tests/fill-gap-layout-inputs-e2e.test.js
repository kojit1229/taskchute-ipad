const assert = require("assert/strict");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");
const PORT = randomPort(), TODAY = "2026-09-04";
const IDS = ["fillGapTitle", "fillGapLength", "fillGapCategory", "fillGapProject", "fillGapRoutine"];

(async () => {
  const server = startServer(PORT);
  let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 }, timezoneId: "Asia/Tokyo" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await blockGithubApiByDefault(page);
    await page.clock.setFixedTime(new Date(2026, 8, 4, 10, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.evaluate(({ key, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "exec"; state.selectedDate = today; state.settings.autoSync = false;
      state.projects = [{ id: "gap-p", title: "保持確認Project", kind: "normal", status: "active", deleted: false }];
      state.tasks = [{ id: "gap-t", title: "保持確認Task", projectId: "gap-p", status: "todo", deleted: false, progressNum: 0, progressDen: 10 }];
      state.blocks = [];
      state.recurrences = [{ id: "gap-r", title: "保持確認Routine", kind: "daily", startTime: "06:00", endTime: "06:25",
        anchorDate: today, category: "仕事", exceptionDates: [], deleted: false }];
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY });
    await page.reload();
    await page.locator('.exec-header-actions [data-action="fill-gap-open"]').click();
    await page.waitForSelector(".exec-pane-left .fill-gap-sheet");
    // Pick existing options from the real form, then edit after routine prefill.
    for (const id of IDS.slice(1)) {
      const value = await page.locator(`#${id}`).evaluate(el => [...el.options].find(option => option.value && !option.disabled)?.value || "");
      await page.locator(`#${id}`).selectOption(value);
    }
    await page.locator("#fillGapTitle").fill("未保存の配置入力");
    await page.locator("#fillGapTitle").evaluate(el => { el.focus(); el.setSelectionRange(2, 5); });
    const values = () => page.evaluate(ids => ids.map(id => document.getElementById(id)?.value), IDS);
    const expected = await values();
    const before = await page.evaluate(async key => {
      window.__gapWrites = 0;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (...args) { window.__gapWrites++; return original.apply(this, args); };
      return { saved: localStorage.getItem(key), modal: JSON.stringify((await import("./src/state/store.js")).state.modal) };
    }, STATE_KEY);
    async function resize(width) {
      await page.setViewportSize({ width, height: 900 });
    }
    for (const width of [1279, 1280, 1023, 1024, 390, 1280]) {
      console.log("CHECK layout width", width);
      await resize(width);
      const destination = width >= 1024 ? ".exec-pane-left" : "#modalRoot.open";
      await page.waitForSelector(`${destination} .fill-gap-sheet`);
      assert.equal(await page.locator(".fill-gap-sheet").count(), 1);
      assert.deepEqual(await values(), expected);
      assert.deepEqual(await page.locator("#fillGapTitle").evaluate(el => [document.activeElement === el, el.selectionStart, el.selectionEnd]), [true, 2, 5]);
      assert.equal(await page.evaluate(async () => JSON.stringify((await import("./src/state/store.js")).state.modal)), before.modal);
    }
    await page.evaluate(ids => ids.forEach(id => { document.getElementById(id).value = ""; }), IDS);
    await resize(1279); await resize(1280);
    assert.deepEqual(await values(), ["", "", "", "", ""]);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), STATE_KEY), before.saved);
    assert.equal(await page.evaluate(() => window.__gapWrites), 0);
    await page.locator(".fill-gap-sheet .modal-close").click();
    await page.waitForSelector(".fill-gap-sheet", { state: "detached" });
    await page.locator('[data-action="nav"][data-view="wbs"]:visible').first().click();
    await page.locator('[data-work-list="wbs-projects"] [data-action="wbs-select-project"][data-id="gap-p"]').click();
    await page.locator('[data-work-list="wbs-tasks-gap-p"] .wbs-task-title[data-action="edit-task"][data-id="gap-t"]').click();
    await page.locator('[data-modal-field="title"]').fill("別の未保存Task入力");
    await page.evaluate(() => { window.__otherGapEditor = document.querySelector('[data-modal-field="title"]'); });
    await resize(1279); await resize(1280);
    assert.equal(await page.locator('[data-modal-field="title"]').inputValue(), "別の未保存Task入力");
    assert(await page.evaluate(() => window.__otherGapEditor === document.querySelector('[data-modal-field="title"]')));
    assert.equal(await page.locator(".fill-gap-sheet").count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS fill-gap input relocation: five values, selection, round trips, empty values, no writes, other modal");
    await context.close();
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
