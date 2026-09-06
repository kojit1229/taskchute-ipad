const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, launchOptions, startServer, randomPort, STATE_KEY, passGithubGate } = require("./helpers");
const DAY = "2026-09-06";
(async () => {
  const server = startServer(randomPort());
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 844 }, serviceWorkers: "block" });
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
    await page.route("**/*", route => new URL(route.request().url()).hostname === "localhost" ? route.continue() : route.abort());
    await page.clock.setFixedTime(new Date(2026, 8, 6, 10, 30));
    await page.goto(`http://localhost:${server.address().port}/`);
    await passGithubGate(page);
    await page.evaluate(({ key, day }) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.currentView = "wbs"; s.selectedDate = day;
      s.settings.lastOpenedDate = day; s.settings.autoSync = false; s.settings.github.autoSave = false;
      s.projects = [{ id: "p", title: "架空Project", kind: "normal", status: "active", description: "元Projectメモ" }];
      s.tasks = [{ id: "t", title: "架空Task", projectId: "p", status: "todo", description: "元Taskメモ", doneCriteria: "成果物", firstStep: "最初の行動" }];
      s.blocks = [{ id: "b", title: "架空Block", taskId: "t", date: day, plannedStartAt: day + "T11:40:00", plannedEndAt: day + "T12:10:00", comment: "元Blockメモ", completed: false }];
      s.recurrences = []; s.tracks = [];
      s.zeroThinking = { themes: [{ id: "theme", text: "架空の問い", fav: true }], entries: [{ id: "past", date: "2026-09-05", theme: "過去の問い", body: "元の回答" }] };
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, day: DAY });
    await page.reload(); await page.locator('#sidebar [data-action="nav"]').first().waitFor();
    // Open via the real delegated entry point, independent of list layout/filters.
    const action = (name, id) => page.evaluate(({ name, id }) => {
      const button = document.createElement("button");
      button.dataset.action = name; if (id) button.dataset.id = id;
      document.body.append(button); button.click(); button.remove();
    }, { name, id });
    const field = name => page.locator(`#modalRoot [data-modal-field="${name}"]`);
    const choose = choice => page.locator(`[data-action="draft-leave-${choice}"]`).click();
    const readState = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    for (const [kind, id, memo] of [["task", "t", "description"], ["project", "p", "description"], ["block", "b", "comment"]]) {
      await action(`edit-${kind}`, id);
      await field(memo).fill("保存せずに書いた内容");
      await page.locator('#modalRoot [data-action="modal-close"]').first().click();
      await choose("stay");
      assert.equal(await field(memo).inputValue(), "保存せずに書いた内容");
      await page.keyboard.press("Escape"); await choose("discard");
      await page.waitForFunction(() => !document.querySelector("#modalRoot").classList.contains("open"));
      await action(`edit-${kind}`, id);
      assert.notEqual(await field(memo).inputValue(), "保存せずに書いた内容");
      await field(memo).fill("保存して戻る内容");
      await page.locator("#modalRoot").dispatchEvent("click");
      await choose("save");
      await page.waitForFunction(() => !document.querySelector("#modalRoot").classList.contains("open"));
      assert.equal((await readState())[kind === "project" ? "projects" : kind === "task" ? "tasks" : "blocks"].find(row => row.id === id)[memo], "保存して戻る内容");
      console.log(`PASS ${kind}: keep/discard/save via close/Escape/background`);
    }
    // A storage failure must leave the actual editable form and user input available.
    await action("edit-task", "t"); await field("description").fill("容量不足でも保持する内容");
    await page.evaluate(() => {
      window.__originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "taskchute-journal-pwa-state-v1") throw new DOMException("fixture quota", "QuotaExceededError");
        return window.__originalSetItem.call(this, key, value);
      };
    });
    await page.locator('#modalRoot [data-action="modal-close"]').first().click(); await choose("save");
    assert.equal(await field("description").inputValue(), "容量不足でも保持する内容", "quota failure retains form DOM");
    await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; });
    await page.locator('#modalRoot [data-action="modal-save"]').click();
    await action("edit-block", "b"); await field("comment").fill("身体スキャンへ渡すメモ");
    await action("toggle-task-complete", "b");
    assert.equal(await page.locator('[data-action="draft-leave-discard"]').count(), 0);
    await choose("save");
    await page.locator('[data-action="body-scan-discard"]').first().waitFor();
    assert.equal((await readState()).blocks.find(row => row.id === "b").comment, "身体スキャンへ渡すメモ");
    await page.locator('[data-action="body-scan-discard"]').first().click();
    const output = process.env.DETAIL_EVIDENCE_DIR;
    if (output) fs.mkdirSync(output, { recursive: true });
    for (const width of [390, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: width === 1024 ? 768 : 844 });
      for (const [kind, id] of [["task", "t"], ["block", "b"]]) {
        await action(`edit-${kind}`, id);
        assert(await page.locator(".detail-columns").evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${kind} ${width}: no horizontal overflow`);
        assert(await field(kind === "task" ? "description" : "comment").evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16), "readable input");
        if (width >= 1024) assert(await page.locator(".detail-columns").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length === 2), "landscape uses two columns");
        await page.locator('#modalRoot [data-action="modal-save"]').scrollIntoViewIfNeeded();
        assert(await page.locator('#modalRoot [data-action="modal-save"]').isVisible(), "save reachable");
        if (output) await page.screenshot({ path: path.join(output, `${kind}-${width}.png`) });
        await page.locator('#modalRoot [data-action="modal-close"]').first().click();
      }
    }
    assert.deepEqual(errors, [], "no pageerror");
    console.log("PASS detail drafts/layout; Chromium emulation only");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
