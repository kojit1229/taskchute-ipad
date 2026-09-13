const assert = require('node:assert/strict');
const { fixture, action, read, drafts, write, NOW } = require('./zero-ui-fixture');
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
  } finally { await f.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
