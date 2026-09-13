const assert = require('node:assert/strict');
const { fixture, action, read, drafts, write, NOW } = require('./zero-ui-fixture');
const { setViewportAndWaitForStableLayout } = require('./helpers');
const path = require('node:path');
(async () => {
  const f = await fixture();
  try {
    const p = await f.page();
    await write(p, 'a', ' 本文A\n末尾を残す \n');
    let s = await read(p), a = (await drafts(p))[0];
    assert.equal(s.zeroThinking.entries.length, 0);
    assert.equal(a.date, '2026-09-08'); assert.equal(s.questions[0].lastTouchedAt, a.date);
    assert.equal(s.questions[0].status, 'deepening');
    const touch = s.questions[0].updatedAt;
    await p.clock.runFor(19400);
    await action(p, 'zt-discard');
    a = (await drafts(p))[0]; assert.equal(a.durationSec, 20);
    await write(p, 'b', '本文B');
    await action(p, 'zt-discard');
    await p.reload(); await p.locator('[data-action="zt-write"]').first().waitFor();
    await action(p, 'zt-write', { id: 'a' });
    assert.equal(await p.locator('#zt-write-input').inputValue(), a.body);
    assert.equal((await drafts(p)).length, 2);
    await p.clock.runFor(30000);
    await action(p, 'zt-save');
    s = await read(p);
    assert.equal(s.zeroThinking.entries.length, 1);
    assert.equal(s.zeroThinking.entries[0].id, a.id);
    assert.equal(s.zeroThinking.entries[0].date, '2026-09-08');
    assert.equal(s.zeroThinking.entries[0].durationSec, 20);
    assert.equal(s.zeroThinking.entries[0].body, a.body);
    assert.equal(s.zeroThinking.entries[0].updatedAt, null);
    assert.equal(s.zeroThinking.themes.some(t => t.id === 'a'), false);
    assert.equal(s.questions[0].updatedAt, touch);
    await action(p, 'zt-save'); assert.equal((await read(p)).zeroThinking.entries.length, 1);
    await p.locator('#zt-edit-input').fill('未確定の追記');
    assert.equal((await read(p)).zeroThinking.entries[0].body, a.body);
    await action(p, 'zt-edit-save', { id: a.id });
    assert.equal((await read(p)).zeroThinking.entries[0].body, '未確定の追記');
    console.log('PASS Z: autosave/cancel/A-B-reload-A/first touch once/completion/idempotence/date/duration/history');

    const q = await f.page();
    await action(q, 'zt-write', { id: 'a' });
    await q.evaluate(() => {
      window.originalSet = Storage.prototype.setItem;
      window.failTab = true; window.failState = true;
      Storage.prototype.setItem = function(k, v) {
        if ((this === sessionStorage && window.failTab) || (k === 'taskchute-journal-pwa-state-v1' && window.failState)) throw Error('fixture quota');
        return window.originalSet.call(this, k, v);
      };
    });
    await q.locator('#zt-write-input').fill('保存不能でも本文保持'); await q.clock.runFor(20000);
    assert.equal(await q.locator('#zt-draft-status').textContent(), 'この画面内にだけ残っています');
    await action(q, 'zt-save');
    assert.equal((await read(q)).zeroThinking.entries.length, 0);
    assert.equal((await read(q)).zeroThinking.themes.length, 2);
    assert.equal((await read(q)).questions[0].status, 'open');
    await q.clock.runFor(30000); await q.evaluate(() => { window.failState = false; });
    await action(q, 'zt-save');
    s = await read(q); assert.equal(s.zeroThinking.entries.length, 1);
    assert.equal(s.zeroThinking.entries[0].durationSec, 20); assert.equal(s.questions[0].status, 'deepening');
    console.log('PASS Z: unavailable session + failed completion rolls back; retry at 50s saves fixed 20s');

    const r = await f.page();
    await action(r, 'zt-write', { id: 'a' });
    const input = r.locator('#zt-write-input');
    await input.fill('   '); await r.clock.runFor(600);
    assert.equal((await drafts(r)).length, 0); assert.equal((await read(r)).questions[0].status, 'open');
    await input.evaluate(el => { el.focus(); el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.value = '日本語変換中'; el.setSelectionRange(2, 4); el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true })); window.originalInput = el; });
    await r.clock.runFor(1000);
    assert.equal((await drafts(r)).length, 0);
    assert.deepEqual(await input.evaluate(el => [el === window.originalInput, document.activeElement === el, el.selectionStart, el.selectionEnd, el.value]), [true, true, 2, 4, '日本語変換中']);
    await input.dispatchEvent('compositionend'); await r.clock.runFor(600);
    assert.equal((await drafts(r))[0].body, '日本語変換中');
    assert.equal(await input.evaluate(el => el === window.originalInput), true);
    console.log('PASS Z: whitespace does not allocate; IME body/caret/focus/node retained');

    const rejected = await f.page();
    await write(rejected, 'b', '復元を拒否する控え');
    await action(rejected, 'zt-discard');
    await rejected.reload(); await rejected.locator('[data-action="zt-write"]').first().waitFor();
    await write(rejected, 'a', '切替前の本文');
    rejected.removeAllListeners('dialog');
    let rejectedCount = 0;
    rejected.on('dialog', async d => { rejectedCount++; await d.dismiss(); });
    await rejected.evaluate(() => {
      window.beforeLeaveSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v) {
        if (this === sessionStorage) throw Error('fixture leave storage failure');
        return window.beforeLeaveSetItem.call(this, k, v);
      };
    });
    await action(rejected, 'zt-write', { id: 'b' });
    await rejected.locator('[data-action="draft-leave-save"]').waitFor();
    await rejected.evaluate(() => { Storage.prototype.setItem = window.beforeLeaveSetItem; });
    await action(rejected, 'draft-leave-save');
    await rejected.locator('#zt-write-input').waitFor({ state: 'detached' });
    assert.equal(rejectedCount, 1);
    assert.equal(await rejected.locator('#zt-write-input').count(), 0);
    assert.equal((await drafts(rejected)).find(d => d.themeId === 'a').body, '切替前の本文');
    assert.equal((await drafts(rejected)).find(d => d.themeId === 'b').body, '復元を拒否する控え');
    await write(rejected, 'a', '拒否後の追記も保存する');
    assert.equal((await drafts(rejected)).find(d => d.themeId === 'a').body, '拒否後の追記も保存する');
    console.log('PASS Z: declined restoration removes stale input and retains both drafts and subsequent input');

    const failed = await f.page();
    await write(failed, 'a', '端末保存の失敗を区別');
    assert.equal(await failed.locator('#zt-draft-status').textContent(), '下書きをこのタブに保存・端末保存済みの変更は同期待ち');
    await failed.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v) {
        if (k === 'taskchute-journal-pwa-state-v1') throw Error('fixture local failure');
        return original.call(this, k, v);
      };
    });
    await action(failed, 'zt-save');
    assert.equal(await failed.locator('#zt-draft-status').textContent(), '端末への保存に失敗しました。入力は残しています');
    assert.equal((await read(failed)).zeroThinking.entries.length, 0);
    assert.equal(await failed.locator('#zt-write-input').inputValue(), '端末保存の失敗を区別');

    const pending = await f.page();
    await write(pending, 'a', '問いの変更を確認');
    await pending.evaluate(async () => {
      const { state } = await import('/src/state/store.js');
      state.questions[0].title = '別端末で変更された問い';
      localStorage.setItem('taskchute-journal-pwa-state-v1', JSON.stringify(state));
      for (const key of Object.keys(sessionStorage).filter(k => k.startsWith('taskchute-journal-daily-draft-v1:'))) {
        const saved = JSON.parse(sessionStorage.getItem(key));
        Object.values(saved.drafts).forEach(d => { if (d.questionRequest) d.questionRequest.done = false; });
        sessionStorage.setItem(key, JSON.stringify(saved));
      }
    });
    await pending.reload(); await pending.locator('[data-action="zt-write"]').first().waitFor();
    await action(pending, 'zt-write', { id: 'a' });
    await pending.locator('#zt-write-input').waitFor();
    await action(pending, 'zt-draft-retry');
    assert.equal(await pending.locator('#zt-draft-status').textContent(), '下書き保存済み・問い更新待ち');
    await action(pending, 'zt-save');
    assert.equal(await pending.locator('#zt-draft-status').textContent(), '保存できませんでした。入力は残しています');
    console.log('PASS Z: memory-only, local persistence failure, question pending, completion failure and sync pending are distinct');

    {
      const c = await f.page();
      await c.clock.pauseAt(await c.evaluate(() => Date.now() + 1000));
      await action(c, 'zt-write', { id: 'b' });
      const complete = c.locator('.zt-write-actions [data-action="zt-save"]');
      assert.equal(await complete.textContent(), '早期完了');
      await c.locator('#zt-write-input').fill('期限後も残る本文');
      await c.clock.runFor(59000);
      assert.equal(await complete.textContent(), '早期完了');
      const before = await drafts(c), savedState = await read(c);
      await c.clock.runFor(1000);
      assert.equal(await complete.textContent(), '完了');
      assert.deepEqual(await drafts(c), before);
      assert.deepEqual(await read(c), savedState);
      assert.equal(await c.locator('#zt-write-input').inputValue(), '期限後も残る本文');
      await action(c, 'zt-discard'); await action(c, 'zt-write', { id: 'b' });
      assert.equal(await complete.textContent(), '完了');
      console.log('PASS Z: completion label changes at 60s and on reselect without saving at deadline');
    }

    const l = await f.page();
    await l.evaluate(async () => {
      const { state } = await import('/src/state/store.js');
      state.zeroThinking.groups = [{ id: 'group', title: '架空のグループ', order: 0 }];
      state.zeroThinking.themes[0].groupId = 'group';
      state.zeroThinking.entries = [{ id: 'history', date: '2026-09-07', theme: '過去のテーマ', body: '元の回答', durationSec: 42 }];
    });
    await action(l, 'zt-tab', { tab: 'other' });
    const widths = [390, 768, 1024, 1280, 1440];
    const dimensions = () => l.evaluate(() => {
      const root = document.querySelector('.zt-workspace');
      const visible = selector => [...root.querySelectorAll(selector)].filter(el => el.getClientRects().length);
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        fonts: visible('input,select,textarea').map(el => parseFloat(getComputedStyle(el).fontSize)),
        buttons: visible('button').map(el => ({ action: el.dataset.action, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })),
        libraryVisible: root.querySelector('.zt-library').getClientRects().length > 0,
        library: root.querySelector('.zt-library').getBoundingClientRect().toJSON(), editor: root.querySelector('.zt-editor').getBoundingClientRect().toJSON() };
    });
    const checkDimensions = d => {
      assert.ok(d.fonts.length > 0); assert.ok(d.fonts.every(n => n >= 16), JSON.stringify(d));
      assert.ok(d.buttons.length > 0); assert.ok(d.buttons.every(b => b.width >= 44 && b.height >= 44), JSON.stringify(d));
      assert.ok(d.scrollWidth <= d.width, JSON.stringify(d));
    };
    for (const width of widths) {
      await setViewportAndWaitForStableLayout(l, { width, height: 900 }, '.zt-workspace');
      const d = await dimensions(); checkDimensions(d);
      assert.equal(d.libraryVisible, true);
      console.log('MEASURE Z list:', JSON.stringify(d));
    }
    await l.locator('.zt-theme-go[data-id="a"]').click();
    const composing = l.locator('#zt-write-input');
    await composing.evaluate(el => { el.focus(); el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.value = '幅が変わっても日本語変換を保持'; el.setSelectionRange(2, 6); el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true })); window.layoutInput = el; });
    for (const width of widths) {
      await setViewportAndWaitForStableLayout(l, { width, height: 900 }, '.zt-workspace');
      await l.clock.runFor(1000);
      const d = await dimensions(); checkDimensions(d);
      assert.equal(d.libraryVisible, width >= 1280, JSON.stringify(d));
      if (width >= 1280) assert.ok(d.library.right <= d.editor.left && Math.abs(d.library.top - d.editor.top) < 2, JSON.stringify(d));
      assert.deepEqual(await composing.evaluate(el => [el === window.layoutInput, document.activeElement === el, el.selectionStart, el.selectionEnd, el.value]), [true, true, 2, 6, '幅が変わっても日本語変換を保持']);
      console.log('MEASURE Z composing:', JSON.stringify(d));
      if (process.env.ZERO_LAYOUT_EVIDENCE_DIR) await l.screenshot({ path: path.join(process.env.ZERO_LAYOUT_EVIDENCE_DIR, `zero-layout-${width}-${process.env.TZ}.png`), fullPage: true });
    }
    await composing.dispatchEvent('compositionend'); await l.clock.runFor(600);
    const savedLayoutDraft = (await drafts(l)).find(d => d.themeId === 'a');
    await setViewportAndWaitForStableLayout(l, { width: 390, height: 900 }, '.zt-workspace');
    await l.locator('.zt-editor .zt-back-btn').click();
    assert.equal(await l.locator('#zt-write-input').count(), 0);
    assert.equal(await l.locator('.zt-library').isVisible(), true);
    assert.equal((await drafts(l)).find(d => d.id === savedLayoutDraft.id).body, '幅が変わっても日本語変換を保持');
    await l.locator('.zt-theme-go[data-id="a"]').click();
    assert.equal(await composing.inputValue(), savedLayoutDraft.body);
    await setViewportAndWaitForStableLayout(l, { width: 1280, height: 900 }, '.zt-workspace');
    assert.ok((await l.locator('.zt-navigation').textContent()).includes('架空のグループ'));
    await l.locator('.zt-navigation [data-action="zt-entry-open"][data-id="history"]').click();
    await l.clock.runFor(70);
    await l.locator('#zt-edit-input').fill('まだ保存していない履歴の追記');
    await l.locator('.zt-navigation [data-action="zt-write"][data-id="b"]').click();
    await l.locator('[data-action="draft-leave-stay"]').click();
    assert.equal(await l.locator('#zt-edit-input').inputValue(), 'まだ保存していない履歴の追記');
    assert.equal((await read(l)).zeroThinking.entries.find(e => e.id === 'history').body, '元の回答');
    await l.locator('.zt-editor .zt-back-btn').click();
    await l.locator('[data-action="draft-leave-save"]').click();
    await l.locator('[data-action="zt-theme-delete"][data-id="b"]').click();
    assert.equal((await read(l)).zeroThinking.themes.some(t => t.id === 'b'), false);
    assert.equal((await read(l)).zeroThinking.groups[0].title, '架空のグループ');
    assert.equal((await read(l)).zeroThinking.entries.find(e => e.id === 'history').body, 'まだ保存していない履歴の追記');
    assert.equal((await read(l)).zeroThinking.entries.find(e => e.id === 'history').durationSec, 42);
    assert.equal((await drafts(l)).find(d => d.id === savedLayoutDraft.id).body, savedLayoutDraft.body);
    console.log('PASS Z layout: 5 widths, input>=16px/actions>=44px, desktop columns, narrow return, IME node/caret/focus, retained draft/group/history guard');
  } finally { await f.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
