// F2-2 pomodoro: expiry actuals, one candidate save, and rollback/retry.
const assert = require("node:assert/strict");
const { chromium, launchOptions, defaultContextOptions, startServer, randomPort,
  blockGithubApiByDefault, passGithubGate, STATE_KEY } = require("./helpers");

(async () => {
  const port = randomPort(), server = startServer(port);
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext({ ...defaultContextOptions(), serviceWorkers: "block" });
    const page = await context.newPage();
    await page.clock.install({ time: new Date(2026, 8, 14, 10) });
    await page.clock.pauseAt(new Date(2026, 8, 14, 10));
    await blockGithubApiByDefault(page);
    await page.goto(`http://localhost:${port}/`);
    await passGithubGate(page);
    const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    async function seed(actualStartAt, fail = false) {
      await page.clock.setSystemTime(new Date(2026, 8, 14, 10));
      await page.evaluate(({ key, actualStartAt }) => {
        const state = JSON.parse(localStorage.getItem(key));
        const date = "2026-09-14", at = time => `${date}T${time}:00`;
        Object.assign(state, { currentView: "today", selectedDate: date, tasks: [], projects: [], recurrences: [],
          blocks: [{ id: "focus", date, title: "focus", taskId: "", deleted: false,
            plannedStartAt: at("10:00"), plannedEndAt: at("11:00"), actualStartAt, actualEndAt: "",
            everStartedAt: actualStartAt, completed: false, charge: 0, discharge: 0, comment: "",
            createdAt: at("08:00"), updatedAt: at("08:00"), pomodoroCount: 0, recurrenceGroupId: "" }],
          pomodoro: { running: true, mode: "focus", blockId: "focus", startedAt: at("10:00"),
            endsAt: at("10:25"), paused: false, pausedRemainMs: 0 } });
        Object.assign(state.settings, { autoSync: false, autoArchive: false, lastOpenedDate: date, focusTimerAuto: false });
        localStorage.setItem(key, JSON.stringify(state));
      }, { key: STATE_KEY, actualStartAt });
      await page.reload();
      await page.locator(".today-pomodoro").waitFor();
      await page.evaluate(({ key, fail }) => {
        const original = Storage.prototype.setItem;
        window.f2Writes = []; window.f2Fail = fail;
        Storage.prototype.setItem = function(k, value) {
          if (k === key) {
            window.f2Writes.push(JSON.parse(value));
            if (window.f2Fail) throw new DOMException("F2 save failure", "QuotaExceededError");
          }
          return original.call(this, k, value);
        };
      }, { key: STATE_KEY, fail });
    }
    for (const start of ["", "2026-09-14T09:55:00"]) {
      await seed(start);
      await page.clock.fastForward(26 * 60 * 1000);
      const state = await read(), block = state.blocks.find(b => b.id === "focus");
      assert.equal(block.actualStartAt, start || "2026-09-14T10:00:00");
      assert.equal(block.actualEndAt, "2026-09-14T10:25:00");
      assert.equal(block.completed, false); assert.equal(block.pomodoroCount, 1);
      assert.equal(state.pomodoro.mode, "break");
      assert.equal(state.pomodoro.startedAt, "2026-09-14T10:26:00");
      const writes = await page.evaluate(() => window.f2Writes);
      assert.equal(writes.length, 1, `満了は候補保存1回: ${JSON.stringify(writes.map(row => ({
        pomodoro: row.pomodoro, block: row.blocks.find(b => b.id === "focus"), stamp: row.dataModifiedAt
      })))}`);
      assert.equal(writes[0].blocks.find(b => b.id === "focus").actualEndAt, block.actualEndAt);
      assert.equal(writes[0].pomodoro.mode, "break");
    }
    console.log("PASS F2-2 満了時刻で実績終了・未完了・開始補完/既存開始保持・保存1回");
    await seed("", true);
    const before = await read();
    await page.clock.fastForward(26 * 60 * 1000);
    assert.deepEqual(await read(), before, "保存失敗は永続stateを変えない");
    assert.equal(await page.evaluate(() => window.f2Writes.length), 1);
    await page.evaluate(() => { window.f2Fail = false; window.f2Writes = []; });
    await page.clock.fastForward(500);
    const retried = await read();
    assert.equal(retried.blocks.find(b => b.id === "focus").pomodoroCount, 1, "再試行で回数が重複しない");
    assert.equal(retried.blocks.find(b => b.id === "focus").actualEndAt, "2026-09-14T10:25:00");
    assert.equal(retried.blocks.find(b => b.id === "focus").completed, false);
    assert.equal(retried.pomodoro.mode, "break");
    assert.equal(await page.evaluate(() => window.f2Writes.length), 1);
    console.log("PASS F2-2 保存失敗を復元・次のtickで同じ満了時刻を1回保存");
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
