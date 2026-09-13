const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, launchOptions, startServer, randomPort, STATE_KEY, passGithubGate } = require("./helpers");
const DAY = "2026-09-06";
(async () => {
  const server = startServer(randomPort());
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 844 }, serviceWorkers: "block", locale: "ja-JP", timezoneId: "Asia/Tokyo" });
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
      s.zeroThinking = { themes: [{ id: "theme", text: "架空の問い", fav: true }, { id: "other", text: "別の問い", fav: true }], entries: [{ id: "past", date: "2026-09-05", theme: "過去の問い", body: "元の回答" }] };
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
    await nav('wbs');
    await page.waitForFunction(() => Object.keys(sessionStorage).some(k => {
      const d = JSON.parse(sessionStorage.getItem(k)); return Object.values(d?.drafts || {}).some(draft => draft.kind === 'zero' && draft.body === '新しい回答を保持');
    }));
    assert.equal(await page.locator('[data-action="draft-leave-stay"]').count(), 0);
    let entries = (await readState()).zeroThinking.entries;
    assert.equal(entries.length, 1);
    assert.equal((await readState()).currentView, 'wbs');
    const drafts = () => page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('taskchute-journal-daily-draft-v1:')).flatMap(k => Object.values(JSON.parse(sessionStorage.getItem(k)).drafts || {})));
    assert.equal((await drafts()).filter(d => d.kind === 'zero' && d.body === '新しい回答を保持').length, 1, JSON.stringify(await drafts()));
    await nav('zero'); await action('zt-write', 'theme'); await input.fill('中止でも保持する回答');
    await action('zt-discard');
    await page.waitForFunction(() => Object.keys(sessionStorage).some(k => {
      const d = JSON.parse(sessionStorage.getItem(k)); return Object.values(d?.drafts || {}).some(draft => draft.kind === 'zero' && draft.body === '中止でも保持する回答');
    }));
    assert.equal(await page.locator('[data-action="draft-leave-stay"]').count(), 0);
    assert.equal((await readState()).zeroThinking.entries.length, entries.length);
    assert.equal((await drafts()).filter(d => d.body === '中止でも保持する回答').length, 1);
    const retained = (await drafts()).find(d => d.themeId === 'theme');
    await action('zt-write', 'other'); await input.fill('別テーマの控え'); await action('zt-discard');
    const other = (await drafts()).find(d => d.themeId === 'other');
    assert.equal(other.body, '別テーマの控え');
    page.on('dialog', dialog => dialog.accept());
    await page.reload(); await page.locator('#sidebar [data-action="nav"]').first().waitFor();
    await nav('zero'); await action('zt-write', 'theme');
    assert.equal(await input.inputValue(), retained.body);
    assert.equal((await drafts()).find(d => d.themeId === 'theme').id, retained.id);
    assert.equal((await readState()).zeroThinking.entries.length, entries.length);
    assert.deepEqual((await drafts()).find(d => d.themeId === 'other'), other);
    console.log('PASS zero draft contract: reload restores the same ID/body; other theme preserved');
    await action('zt-save');
    const completedDraft = (await drafts()).find(d => d.id === retained.id);
    const completedBinding = await page.evaluate(id => Object.keys(sessionStorage)
      .filter(k => k.startsWith('taskchute-journal-daily-draft-v1:'))
      .some(k => Object.values(JSON.parse(sessionStorage.getItem(k)).themeToDraft || {}).includes(id)), retained.id);
    console.log('Completion evidence:', JSON.stringify({ retainedInDrafts: Boolean(completedDraft), completed: completedDraft?.completed, boundToTheme: completedBinding }));
    assert.equal(completedDraft?.completed, true, 'Completion retains a marked draft until canonical reconciliation');
    assert.equal(completedBinding, false, 'Completed draft is not a theme restoration candidate');
    assert.deepEqual((await drafts()).find(d => d.themeId === 'other'), other);
    assert.equal((await readState()).zeroThinking.entries.find(e => e.id === retained.id).body, retained.body);
    assert.equal((await readState()).zeroThinking.entries.length, entries.length + 1);
    console.log('PASS zero draft contract: completion saves one answer and preserves the other theme');
    await page.reload(); await page.locator('#sidebar [data-action="nav"]').first().waitFor();
    const reconciled = await page.evaluate(async ({ id, connection, key }) => {
      const { createZeroSession } = await import('/src/features/zero-session.js');
      const session = createZeroSession({ connection });
      const canonical = JSON.parse(localStorage.getItem(key));
      const newer = structuredClone(canonical);
      newer.zeroThinking.entries.find(e => e.id === id).body = '正本側の新しい本文';
      const before = JSON.stringify(session.snapshot());
      const conflict = session.restore(id, newer, true);
      const conflictPreserved = before === JSON.stringify(session.snapshot());
      const candidateStatuses = Object.values(session.snapshot().drafts).map(d => [d.id, session.inspect(d.id, canonical).status]);
      const complete = session.restore(id, canonical, true);
      return { conflict: conflict.status, conflictPreserved, newerBody: newer.zeroThinking.entries.find(e => e.id === id).body,
        candidateStatuses, complete: complete.status, cleanup: complete.cleanup?.ok, after: session.inspect(id, canonical).status,
        canonicalUnchanged: JSON.stringify(canonical) === localStorage.getItem(key) };
    }, { id: retained.id, connection: completedDraft.connection, key: STATE_KEY });
    assert.equal(reconciled.conflict, 'conflict');
    assert.equal(reconciled.conflictPreserved, true);
    assert.equal(reconciled.newerBody, '正本側の新しい本文');
    assert.deepEqual(reconciled.candidateStatuses.find(([id]) => id === retained.id), [retained.id, 'completed']);
    assert.equal(reconciled.complete, 'completed'); assert.equal(reconciled.cleanup, true);
    assert.equal(reconciled.after, 'missing'); assert.equal(reconciled.canonicalUnchanged, true);
    assert.equal((await drafts()).some(d => d.id === retained.id), false);
    assert.deepEqual((await drafts()).find(d => d.id === other.id), other);
    console.log('PASS zero draft contract: canonical mismatch preserves both; matching completed draft reconciles without restoring/overwriting');
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
    for (const corrupt of ['{invalid-json', JSON.stringify({ version: 999, drafts: {}, themeToDraft: {} }), JSON.stringify({ version: 1, drafts: { broken: { kind: 'zero' } }, themeToDraft: {} })]) {
      await page.evaluate(value => {
        const key = Object.keys(sessionStorage).find(k => k.startsWith('taskchute-journal-daily-draft-v1:') && JSON.parse(sessionStorage.getItem(k)).drafts);
        if (!key) throw Error('fixture draft key missing');
        sessionStorage.setItem(key, value);
      }, corrupt);
      await page.reload(); await page.locator('#sidebar [data-action="nav"]').first().waitFor();
      await nav('zero'); await action('zt-write', 'other');
      assert.equal(await input.inputValue(), '');
      await input.fill('不正な控えでも入力できる'); await action('zt-discard');
      assert.equal((await drafts()).find(d => d.themeId === 'other').body, '不正な控えでも入力できる');
      assert.equal((await readState()).zeroThinking.entries.length, entries.length + 1);
    }
    console.log('PASS zero draft contract: invalid JSON, unknown version and malformed draft do not block startup/input');
    assert.deepEqual(errors, []);
    console.log('PASS zero draft: new/past keep/save/discard/nav/quota/retry/date retention; Chromium only');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
