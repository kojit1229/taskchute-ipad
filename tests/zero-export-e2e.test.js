// R3-D: UI completion/session isolation and daily report export; chromium.launch is in zero-ui-fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, read, drafts } = require('./zero-ui-fixture');
const { STATE_KEY } = require('./helpers');
const DAYS = ['2026-09-07', '2026-09-08'];
const markers = { old: 'R3D旧完成回答', fresh: 'R3D20秒完成回答', cross: 'R3D日跨ぎ回答',
  partial: 'R3D途中限定', cancelled: 'R3D中止限定', expired: 'R3D60秒未完了限定', edit: 'R3D明示追記' };
const click = (p, action, id) => p.locator(`[data-action="${action}"]${id ? `[data-id="${id}"]` : ''}`).filter({ visible: true }).first().click();
async function snapshot(p) {
  const saved = await p.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  assert.deepEqual(saved.zeroThinking.entries, (await read(p)).zeroThinking.entries);
  const session = await drafts(p);
  const reports = await p.evaluate(async ({ saved, days }) => {
    const { captureReportInput } = await import('/src/features/feedback/report-input.js');
    const { deriveReportValues } = await import('/src/features/feedback/report-derived.js');
    const { buildReportMarkdown } = await import('/src/features/feedback/report-builder.js');
    return Object.fromEntries(days.map(date => [date, buildReportMarkdown(captureReportInput(saved, date, deriveReportValues))]));
  }, { saved, days: DAYS });
  assert.equal(saved.zeroThinking.entries.length, 3);
  for (const body of [markers.partial, markers.cancelled, markers.expired]) {
    assert.equal(JSON.stringify(saved).includes(body), false, 'unfinished body never enters normal state');
    assert.equal(session.filter(d => d.body === body).length, 1);
  }
  for (const date of DAYS) {
    const entries = saved.zeroThinking.entries.filter(e => e.date === date);
    assert.equal(entries.length, date === DAYS[0] ? 1 : 2);
    const section = reports[date].split('## 🧠 0秒思考\n')[1]?.split(/\n## /)[0];
    assert.ok(section, `daily report section for ${date}`);
    for (const entry of entries) assert.equal(section.split(entry.body).length - 1, 1);
    for (const entry of saved.zeroThinking.entries.filter(e => e.date !== date)) assert.equal(section.includes(entry.body), false);
    for (const body of [markers.partial, markers.cancelled, markers.expired]) assert.equal(reports[date].includes(body), false);
    assert.doesNotMatch(reports[date], /入力時間|durationSec/);
  }
  return { saved, session, reports };
}
(async () => {
  const f = await fixture({ paused: true });
  try {
    const p = await f.page();
    await p.evaluate(({ key, days, markers }) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.zeroThinking.themes = ['fresh', 'cross', 'partial', 'cancelled', 'expired'].map(id => ({ id, text: `架空${id}`, fav: false }));
      // Legacy completed input predates durationSec; all new answers below are made by real UI clicks.
      s.zeroThinking.entries = [{ id: 'legacy', date: days[1], theme: '架空旧回答', body: markers.old, createdAt: `${days[1]}T09:00:00` }];
      for (const date of days) s.journals[date] = '架空の日誌';
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, days: DAYS, markers });
    await p.reload();
    await p.clock.setSystemTime(Date.UTC(2026, 8, 7, 14, 59, 50));
    await click(p, 'zt-write', 'cross');
    await p.locator('#zt-write-input').fill(markers.cross);
    await p.clock.runFor(20000); await click(p, 'zt-save');
    let entries = (await read(p)).zeroThinking.entries;
    assert.equal(entries.find(e => e.body === markers.cross).date, DAYS[0]);
    await click(p, 'zt-write', 'fresh');
    await p.locator('#zt-write-input').fill(markers.fresh);
    await p.clock.runFor(20000); await click(p, 'zt-save');
    const fresh = (await read(p)).zeroThinking.entries.find(e => e.body === markers.fresh);
    assert.equal(fresh.durationSec, 20); assert.equal(fresh.date, DAYS[1]);
    console.log('PASS E1: legacy duration absent, UI 20-second completion and start-day attribution');
    await click(p, 'zt-write', 'partial');
    await p.locator('#zt-write-input').fill(markers.partial); await p.clock.runFor(600);
    await click(p, 'zt-write', 'cancelled');
    await p.locator('#zt-write-input').fill(markers.cancelled); await p.clock.runFor(600);
    await click(p, 'zt-discard');
    await click(p, 'zt-write', 'expired');
    await p.locator('#zt-write-input').fill(markers.expired); await p.clock.runFor(60000);
    assert.equal(await p.locator('#zt-timer-time').textContent(), '00:00');
    await click(p, 'zt-entry-open', fresh.id);
    await p.locator('#zt-edit-input').fill(`${markers.fresh}\n${markers.edit}`);
    const before = await snapshot(p);
    assert.equal(before.saved.zeroThinking.entries.find(e => e.id === fresh.id).body, markers.fresh);
    for (const report of Object.values(before.reports)) assert.equal(report.includes(markers.edit), false);
    console.log('PASS E2: partial/cancelled/expired stay in session; unconfirmed edit excluded from state and daily reports');
    await click(p, 'zt-edit-save', fresh.id);
    const after = await snapshot(p);
    assert.deepEqual(after.saved.zeroThinking.entries.map(e => [e.id, e.date, e.durationSec]), before.saved.zeroThinking.entries.map(e => [e.id, e.date, e.durationSec]));
    assert.equal(after.saved.zeroThinking.entries.find(e => e.id === fresh.id).body, `${markers.fresh}\n${markers.edit}`);
    // Saving closes the editor; reopen the same answer through the visible history before resaving.
    await click(p, 'zt-entry-open', fresh.id);
    await click(p, 'zt-edit-save', fresh.id);
    assert.deepEqual((await read(p)).zeroThinking.entries, after.saved.zeroThinking.entries);
    console.log('PASS E3: explicit edit preserves day/ID/duration; repeated save does not duplicate');
    // Optional evidence destination is write-only. The test has no dependency on files outside this repo.
    if (process.env.R3D_FIXTURE_OUT) {
      const root = path.resolve(process.env.R3D_FIXTURE_OUT);
      fs.mkdirSync(root, { recursive: true });
      for (const [name, value] of Object.entries({ 'app-state.json': before.saved, 'session-only.json': before.session,
        'app-state-after.json': after.saved, 'session-only-after.json': after.session,
        'daily-reports.json': before.reports, 'daily-reports-after.json': after.reports })) {
        fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n', 'utf8');
      }
    }
    console.log('PASS zero-export-e2e: 3 cases');
  } finally { await f.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
