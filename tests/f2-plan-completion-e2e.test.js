// F2-1 planning-execution: Block completion buttons and persisted actual times.
const assert = require("node:assert/strict");
const { chromium, launchOptions, defaultContextOptions, startServer, randomPort,
  blockGithubApiByDefault, passGithubGate, STATE_KEY } = require("./helpers");

(async () => {
  const port = randomPort(), server = startServer(port);
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext({ ...defaultContextOptions(), serviceWorkers: "block" });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(2026, 8, 14, 10));
    await blockGithubApiByDefault(page);
    await page.goto(`http://localhost:${port}/`);
    await passGithubGate(page);
    await page.evaluate(key => {
      const state = JSON.parse(localStorage.getItem(key));
      const date = "2026-09-14", at = time => `${date}T${time}:00`;
      Object.assign(state, { currentView: "exec", selectedDate: date, tasks: [], projects: [], recurrences: [],
        blocks: ["plan", "actual"].map(id => ({ id, date, title: id, taskId: "", deleted: false,
          plannedStartAt: at("09:30"), plannedEndAt: at("10:00"), actualStartAt: "", actualEndAt: "",
          everStartedAt: "", completed: false, charge: 0, discharge: 0, comment: "",
          createdAt: at("08:00"), updatedAt: at("08:00"), recurrenceGroupId: "" })) });
      Object.assign(state.settings, { autoSync: false, focusTimerAuto: false, lastOpenedDate: date });
      localStorage.setItem(key, JSON.stringify(state));
    }, STATE_KEY);
    await page.reload();
    const actualButton = page.locator('.exec-row [data-action="complete-block-with-actual"][data-id="actual"]');
    await actualButton.waitFor();
    const size = await actualButton.boundingBox();
    assert(size.width >= 44 && size.height >= 44, "実績付きボタンは44px以上");
    assert.equal(await actualButton.textContent(), "実績付きで完了");
    assert(await actualButton.evaluate(el => el.previousElementSibling.dataset.action === "toggle-block"));
    assert(await actualButton.evaluate(el => {
      const button = el.getBoundingClientRect(), check = el.previousElementSibling.getBoundingClientRect();
      return button.left >= check.right && Math.abs(button.top - check.top) < 1;
    }), "実績付きボタンは✓の隣に並ぶ");
    await page.click('.exec-row [data-action="toggle-block"][data-id="plan"]');
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).blocks.find(b => b.id === "plan").completed, STATE_KEY);
    await page.reload();
    const plan = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).blocks.find(b => b.id === "plan"), STATE_KEY);
    assert.equal(plan.completed, true);
    assert.equal(plan.actualStartAt, ""); assert.equal(plan.actualEndAt, ""); assert.equal(plan.everStartedAt, "");
    console.log("PASS F2-1 ✓は実績なしの予定完了・再読込保持");
    await actualButton.click();
    await page.locator('#modalRoot [data-modal-field="actualStartAt"]').fill("2026-09-14T09:30");
    await page.locator('#modalRoot [data-modal-field="actualEndAt"]').fill("2026-09-14T10:00");
    await page.click('#modalRoot [data-action="modal-save"]');
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).blocks.find(b => b.id === "actual").completed, STATE_KEY);
    const actual = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).blocks.find(b => b.id === "actual"), STATE_KEY);
    assert(actual.actualStartAt.startsWith("2026-09-14T09:30"));
    assert(actual.actualEndAt.startsWith("2026-09-14T10:00"));
    assert.equal(actual.completed, true);
    console.log("PASS F2-1 実績付きボタンは実績ありの完了");
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
