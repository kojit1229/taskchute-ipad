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
    const nav = view => page.evaluate(view => {
      const button = document.createElement('button'); button.dataset.action = 'nav';
      button.dataset.view = view; document.body.append(button); button.click(); button.remove();
    }, view);
    await nav('zero'); await action('zt-write', 'theme');
    const input = page.locator('#zt-write-input');
    await input.fill('新しい回答を保持');
    await action('zt-discard'); await choose('stay');
    assert.equal(await input.inputValue(), '新しい回答を保持');
    await nav('wbs'); await choose('save');
    let entries = (await readState()).zeroThinking.entries;
    assert.equal(entries.filter(e => e.body === '新しい回答を保持').length, 1);
    assert.equal((await readState()).currentView, 'wbs');
    await nav('zero'); await action('zt-write', 'theme'); await input.fill('破棄する新規回答');
    await action('zt-discard'); await choose('discard');
    assert.equal((await readState()).zeroThinking.entries.length, entries.length);
    await action('zt-entry-open', 'past');
    await page.clock.runFor(70); // Finish the existing 60ms editor focus/caret callback before typing.
    const edit = page.locator('#zt-edit-input');
    await edit.fill('過去の回答への追記');
    await action('zt-edit-close'); await choose('stay');
    assert.equal(await edit.inputValue(), '過去の回答への追記');
    await nav('wbs'); await choose('save');
    const past = (await readState()).zeroThinking.entries.find(e => e.id === 'past');
    assert.equal(past.body, '過去の回答への追記'); assert.equal(past.date, '2026-09-05');
    await nav('zero'); await action('zt-entry-open', 'past'); await page.clock.runFor(70); await edit.fill('保存失敗でも消えない');
    await page.evaluate(() => {
      window.__originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'taskchute-journal-pwa-state-v1') throw new DOMException('fixture quota', 'QuotaExceededError');
        return window.__originalSetItem.call(this, key, value);
      };
    });
    await nav('wbs'); await choose('save');
    assert.equal(await edit.inputValue(), '保存失敗でも消えない');
    assert.equal((await readState()).zeroThinking.entries.find(e => e.id === 'past').body, '過去の回答への追記');
    await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; });
    await nav('wbs'); await choose('save');
    assert.equal((await readState()).zeroThinking.entries.find(e => e.id === 'past').body, '保存失敗でも消えない');
    assert.deepEqual(errors, []);
    console.log('PASS zero draft: new/past keep/save/discard/nav/quota/retry/date retention; Chromium only');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
