const assert = require('node:assert/strict');
const { fixture, action, read, drafts, NOW } = require('./zero-ui-fixture');

(async () => {
  const f = await fixture({ paused: true });
  try {
    const p = await f.page();
    await action(p, 'zt-write', { id: 'a' });
    const input = p.locator('#zt-write-input'), timer = p.locator('#zt-timer-time');
    assert.equal(await timer.textContent(), '01:00');
    await input.fill('日跨ぎ前の本文'); await p.clock.runFor(59000);
    assert.equal(await timer.textContent(), '00:01');
    await p.clock.runFor(1000); assert.equal(await timer.textContent(), '00:00');
    assert.equal((await read(p)).zeroThinking.entries.length, 0);
    await input.fill('60秒後も追記できる'); await p.clock.runFor(15000);
    assert.equal(await timer.textContent(), '00:00');
    await action(p, 'zt-save');
    const entry = (await read(p)).zeroThinking.entries[0];
    assert.equal(entry.body, '60秒後も追記できる'); assert.equal(entry.durationSec, 75);
    assert.equal(entry.date, '2026-09-08');
    console.log('PASS T: 59s=00:01, 60s=00:00; append/complete at 75s keeps original date across midnight');

    const q = await f.page();
    await action(q, 'zt-write', { id: 'a' });
    await q.locator('#zt-write-input').fill('20秒停止・保存再試行');
    await q.clock.runFor(20000);
    await q.evaluate(() => {
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v) {
        if (k === 'taskchute-journal-pwa-state-v1') throw Error('fixture save failure');
        return window.originalSetItem.call(this, k, v);
      };
    });
    await action(q, 'zt-save');
    assert.equal((await read(q)).zeroThinking.entries.length, 0);
    await q.clock.setSystemTime(NOW + 50000);
    await q.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await q.locator('#zt-timer-time').textContent(), '00:10');
    await q.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    await action(q, 'zt-draft-retry'); await action(q, 'zt-discard');
    const stopped = (await drafts(q)).find(d => d.themeId === 'a');
    assert.equal(stopped.durationSec, 20); assert.equal(stopped.stoppedAt, NOW + 20000);
    await q.reload(); await q.locator('[data-action="zt-write"]').first().waitFor();
    await action(q, 'zt-write', { id: 'a' });
    assert.equal(await q.locator('#zt-timer-time').textContent(), '00:10');
    assert.equal(await q.locator('#zt-write-input').inputValue(), stopped.body);
    await q.clock.setSystemTime(NOW + 90000);
    await q.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await q.locator('#zt-timer-time').textContent(), '00:00');
    await action(q, 'zt-save');
    const retried = (await read(q)).zeroThinking.entries[0];
    assert.equal(retried.durationSec, 20); assert.equal(retried.date, '2026-09-08');
    console.log('PASS T: background return uses deadline; reload/reselect/retry keeps 20s stop and original date');

    const r = await f.page();
    await r.clock.setSystemTime(NOW - 12 * 3600000);
    await action(r, 'zt-write', { id: 'b' });
    await r.evaluate(() => {
      window.clockWrites = { local: 0, tab: 0 };
      window.clockWriteOrigins = [];
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v) {
        window.clockWrites[this === sessionStorage ? 'tab' : 'local']++;
        window.clockWriteOrigins.push({ key: k, stack: new Error().stack });
        return original.call(this, k, v);
      };
    });
    await r.clock.runFor(59000); assert.equal(await r.locator('#zt-timer-time').textContent(), '00:01');
    await r.clock.runFor(1000); assert.equal(await r.locator('#zt-timer-time').textContent(), '00:00');
    assert.deepEqual(await r.evaluate(() => window.clockWrites), { local: 0, tab: 0 }, JSON.stringify(await r.evaluate(() => window.clockWriteOrigins)));
    assert.equal((await drafts(r)).length, 0); assert.equal((await read(r)).zeroThinking.entries.length, 0);
    console.log('PASS T: display-only full minute performs zero local/session writes and creates zero drafts/answers');
  } finally { await f.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
