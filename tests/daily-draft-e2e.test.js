const assert = require("node:assert/strict");
const { createDailyDraftStore, DAILY_DRAFT_KEY } = require("../src/features/daily-draft.js");
const { chromium, launchOptions, startServer, randomPort, STATE_KEY, passGithubGate,
  withLocalSaveFailure, expectRestored, defaultContextOptions } = require("./helpers");

function storeChecks() {
  const values = new Map(), storage = { setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const store = createDailyDraftStore({ storage: () => storage });
  const draft = { kind: "block", id: "fixture", draftId: "request-1", connection: "fixture/repo/main",
    fingerprint: "before", requestId: "request-1", candidateIds: ["candidate-1"],
    inputs: [{ value: "変換中の日本語", start: 1, end: 4, direction: "backward", checked: true }] };
  assert.equal(store.put(draft).ok, true);
  expectRestored(draft, store.get(draft)); // The same owner works for both row and detail.
  for (const key of ["kind", "id", "draftId", "connection"]) {
    assert.equal(store.get({ ...draft, [key]: "other" }), null, key);
    assert.equal(store.matches(draft, { ...draft, [key]: "other" }), false, key);
  }
  assert.equal(store.matches(draft, { ...draft, fingerprint: "remote edit" }), false);
  assert.equal(store.matches(draft, { ...draft, current: false }), false);
  assert.throws(() => store.put({ ...draft, draftId: "" }), TypeError);
  assert.equal(createDailyDraftStore({ storage: () => storage }).get(draft), null, "no reload restoration this release");
  const copy = store.get(draft); copy.inputs[0].value = "changed externally";
  expectRestored(draft, store.get(draft));
  assert.equal(store.clear(draft, "stay"), false);
  expectRestored(draft, store.get(draft));
  for (const reason of ["saved", "discard"]) {
    store.put(draft); assert.equal(store.clear(draft, reason), true);
    assert.equal(store.get(draft), null); assert.equal(values.size, 0);
  }
  withLocalSaveFailure((fail, evidence) => {
    const memory = createDailyDraftStore({ storage: () => ({ setItem: fail, removeItem: fail }) });
    assert.equal(memory.put(draft).memoryOnly, true); assert.equal(evidence.calls, 1);
    expectRestored(draft, memory.get(draft));
    assert.equal(memory.clear(draft, "saved"), false); assert.equal(memory.get(draft), null);
  });
  console.log("PASS shared draft owner/input/selection/request/candidate isolation, quota memory and explicit clear");
}

(async () => {
  storeChecks();
  const server = startServer(randomPort()), browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ ...defaultContextOptions(), locale: "ja-JP", serviceWorkers: "block", viewport: { width: 1280, height: 844 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).hostname === "localhost" ? route.continue() : route.abort());
    await page.clock.setFixedTime(new Date(2026, 8, 10, 10, 30));
    await page.goto(`http://localhost:${server.address().port}/`); await passGithubGate(page);
    await page.evaluate(key => {
      const s = JSON.parse(localStorage.getItem(key));
      s.currentView = "wbs"; s.selectedDate = "2026-09-10";
      s.settings.lastOpenedDate = "2026-09-10"; s.settings.autoSync = false; s.settings.github.autoSave = false;
      s.projects = [{ id: "p", title: "架空Project", kind: "normal", status: "active" }];
      s.tasks = [{ id: "t", title: "架空Task", projectId: "p", status: "todo", description: "元のメモ" }];
      s.blocks = [{ id: "b", title: "架空Block", taskId: "t", date: "2026-09-10", comment: "元のBlock", completed: false }];
      s.recurrences = []; s.tracks = [];
      s.zeroThinking = { themes: [{ id: "theme", text: "架空の問い", fav: true }], entries: [{ id: "past", date: "2026-09-09", theme: "過去", body: "元の回答" }] };
      localStorage.setItem(key, JSON.stringify(s));
    }, STATE_KEY);
    await page.reload(); await page.locator('#sidebar [data-action="nav"]').first().waitFor();
    const action = (name, id, view) => page.evaluate(({ name, id, view }) => {
      const button = document.createElement("button"); button.dataset.action = name;
      if (id) button.dataset.id = id; if (view) button.dataset.view = view;
      document.body.append(button); button.click(); button.remove();
    }, { name, id, view });
    const field = page.locator('#modalRoot [data-modal-field="description"]');
    const choose = name => page.locator(`[data-action="draft-leave-${name}"]`).click();
    const backups = () => page.evaluate(prefix => Object.keys(sessionStorage).filter(key => key.startsWith(prefix)).map(key => JSON.parse(sessionStorage.getItem(key))), DAILY_DRAFT_KEY);
    const resetBackup = () => page.evaluate(prefix => Object.keys(sessionStorage).filter(key => key.startsWith(prefix)).forEach(key => sessionStorage.removeItem(key)), DAILY_DRAFT_KEY);
    await action("edit-task", "t"); await field.fill("変換途中の日本語を保持");
    await field.evaluate(el => { el.focus(); el.setSelectionRange(1, 5, "backward"); el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); });
    await action("modal-close");
    assert.equal(await page.locator(".draft-leave-dialog").count(), 0);
    assert.equal(await field.inputValue(), "変換途中の日本語を保持");
    let saved = (await backups())[0];
    const input = saved.inputs.find(row => row.field === "description");
    assert.deepEqual([input.start, input.end, input.direction], [1, 5, "backward"]);
    assert(!JSON.stringify(saved).includes('"token"'), "no authentication fields in backup");
    await field.dispatchEvent("compositionend");
    await action("modal-close"); await choose("stay");
    assert.equal((await backups()).length, 1);
    assert.deepEqual(await field.evaluate(el => [el.selectionStart, el.selectionEnd]), [1, 5]);
    await action("modal-save"); assert.equal((await backups()).length, 0, "direct modal save clears held backup");
    console.log("PASS real modal composition, selection, stay and direct save cleanup");

    await action("edit-task", "t"); await field.fill("保存失敗でも残す入力");
    await page.evaluate(key => {
      window.__draftSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, value) {
        if (this === localStorage && k === key) throw new DOMException("fixture quota", "QuotaExceededError");
        return window.__draftSetItem.call(this, k, value);
      };
    }, STATE_KEY);
    await action("modal-close"); await choose("save");
    assert.equal(await field.inputValue(), "保存失敗でも残す入力"); assert.equal((await backups()).length, 1);
    await page.evaluate(() => { Storage.prototype.setItem = window.__draftSetItem; });
    await action("modal-save"); assert.equal((await backups()).length, 0);

    await action("edit-task", "t"); await field.fill("控えも容量不足");
    await page.evaluate(() => {
      Storage.prototype.setItem = function(k, value) {
        if (this === sessionStorage) throw new DOMException("fixture session quota", "QuotaExceededError");
        return window.__draftSetItem.call(this, k, value);
      };
    });
    await action("modal-close");
    assert(await page.getByText(/この画面内にだけ残っています/).count() > 0);
    await choose("stay"); assert.equal(await field.inputValue(), "控えも容量不足");
    await page.evaluate(() => { Storage.prototype.setItem = window.__draftSetItem; });
    await action("modal-close"); await choose("discard"); assert.equal((await backups()).length, 0);
    console.log("PASS local/session quota, retained input, retry and discard cleanup");

    for (const change of ["connection", "record", "target"]) {
      await action("edit-task", "t"); await field.fill("古い入力は適用しない");
      await action("modal-close");
      await page.evaluate(async change => {
        const { state } = await import("/src/state/store.js");
        if (change === "connection") { window.__draftPath = state.settings.github.path; state.settings.github.path = "other-fixture.json"; }
        if (change === "record") state.tasks.find(row => row.id === "t").description = "同期待ち更新";
        if (change === "target") state.modal = { type: "task", id: "other" };
      }, change);
      await choose("save"); assert.equal(await field.inputValue(), "古い入力は適用しない");
      assert.equal((await backups()).length, 1);
      assert.equal(await page.locator(".draft-leave-dialog").count(), 0);
      await page.evaluate(async change => {
        const { state } = await import("/src/state/store.js");
        if (change === "connection") state.settings.github.path = window.__draftPath;
      }, change);
      await action("edit-task", "t"); assert.notEqual(await field.inputValue(), "古い入力は適用しない");
      await action("modal-close"); await resetBackup();
    }
    // A remote edit before requesting leave is also rejected by the editor's original fingerprint.
    await action("edit-task", "t"); await field.fill("開始後の対象更新");
    await page.evaluate(async () => { const { state } = await import("/src/state/store.js"); state.tasks[0].description = "別更新"; });
    await action("modal-close"); assert.equal(await page.locator(".draft-leave-dialog").count(), 0);
    await action("modal-save"); assert.equal(await field.inputValue(), "開始後の対象更新");
    await action("edit-task", "t"); await action("modal-close"); await resetBackup();
    console.log("PASS connection/target/fingerprint changes reject old input, no unauthorized restore");

    await action("nav", null, "zero");
    for (const [open, id, selector, leave, save] of [
      ["zt-write", "theme", "#zt-write-input", "zt-discard", "zt-save"],
      ["zt-entry-open", "past", "#zt-edit-input", "zt-edit-close", "zt-edit-save"]
    ]) {
      await action(open, id); await page.clock.runFor(70); // Existing editor focus callback.
      await page.locator(selector).fill("行と同じ管理で保持");
      await action(leave); await choose("stay");
      assert.equal((await backups())[0].kind, "zero");
      await action(save, id); assert.equal((await backups()).length, 0, "direct row save clears backup");
    }
    await action("edit-task", "t"); await field.fill("再読込後に無断復元しない");
    await action("modal-close"); await choose("stay");
    assert.equal((await backups()).length, 1); await page.reload();
    await page.locator('#sidebar [data-action="nav"]').first().waitFor();
    assert.equal(await page.locator(".draft-leave-dialog").count(), 0);
    await action("edit-task", "t"); assert.notEqual(await field.inputValue(), "再読込後に無断復元しない");
    assert.equal((await backups()).length, 1, "reload does not consume backup");
    assert.deepEqual(errors, []);
    console.log("PASS row direct saves and reload without automatic restore; Chromium only");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
