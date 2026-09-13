// playwright-core via shared setup: journal/navigation and responsive health/iron/fund handover acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { STATE_KEY, setViewportAndWaitForStableLayout } = require('./helpers');
const { setup } = require('./remaining-twelveweek-layout.test');
const inventory = require('./remaining-handover-labels.cjs');
const output = process.env.ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'r4-handover-'));

async function navigate(page, view) {
  let button = page.locator('[data-action="nav"][data-view="' + view + '"]:visible').first();
  if (!await button.count()) {
    await page.locator('[data-action="nav"][data-view="more"]:visible').first().click();
    button = page.locator('.more-tower-item[data-view="' + view + '"]');
  }
  await button.click();
  await page.locator('#app[data-view="' + view + '"]').waitFor();
}

async function regression(page) {
  const day = '2026-07-25', next = '2026-07-26';
  await page.evaluate(({ key, day, next }) => {
    const s = JSON.parse(localStorage.getItem(key));
    s.settings.autoSync = false; s.settings.github.autoSave = false;
    s.settings.gymExerciseList = ['ベンチプレス', 'スクワット'];
    s.ironImport = { done: true, importedTotalKg: 0, importedDays: 0 };
    s.condition.logs[day] = { ...s.condition.logs[day], gym: [] };
    s.journals[day] = '架空の日報・健康と資産の往復で保持';
    s.journals[next] = '架空の翌日日報・日跨ぎでも既存本文を保持';
    s.blocks = [{ id: 'handover-gym', title: '架空の筋トレ', category: 'ジム', date: day,
      start: '09:00', end: '10:00', actualStartAt: day + 'T09:00:00', actualEndAt: null, deleted: false }];
    localStorage.setItem(key, JSON.stringify(s));
  }, { key: STATE_KEY, day, next });
  await page.reload();
  await navigate(page, 'instruments');
  await page.locator('button[data-action="instruments-open-iron-log"]').click();
  await page.locator('#ironRoot').waitFor();
  const weight = page.locator('#ironFormWeight'), reps = page.locator('#ironFormReps');
  const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  const baseline = await saved();
  for (const [kg, count] of [['-1', '10'], ['0', '10'], ['40', '1.5'], ['', '10']]) {
    await weight.fill(kg); await reps.fill(count);
    await page.locator('[data-action="iron-add-set"]').click();
    assert.deepEqual((await saved()).condition.logs, baseline.condition.logs, 'invalid set never persists');
    assert.ok((await page.locator('.iron-form-errors').innerText()).trim(), 'invalid value has explanation');
  }
  await weight.fill('42.5'); await reps.fill('8');
  for (const view of ['instruments', 'fund']) {
    await navigate(page, view); await navigate(page, 'iron-log');
    assert.equal(await weight.inputValue(), '42.5');
    assert.equal(await reps.inputValue(), '8');
  }
  await page.locator('[data-action="iron-add-set"]').click();
  const once = await saved();
  const set = once.condition.logs[day].gym;
  assert.equal(set.length, 1);
  assert.equal(set[0].weight * set[0].reps, 340);
  assert.equal(set[0].blockId, 'handover-gym');
  assert.deepEqual(once.journals, baseline.journals);
  assert.deepEqual(once.blocks, baseline.blocks);
  await page.reload(); await navigate(page, 'iron-log');
  assert.deepEqual((await saved()).condition.logs[day].gym, set, 'reload retains IDs and values');
  await weight.fill('45'); await reps.fill('6');
  await page.clock.setFixedTime(new Date(2026, 6, 26, 0, 1));
  await navigate(page, 'instruments'); await navigate(page, 'iron-log');
  assert.equal(await weight.inputValue(), '45');
  assert.equal(await reps.inputValue(), '6');
  assert.match(await page.locator('.iron-draft-date').innerText(), /2026-07-25.*2026-07-26/);
  await page.locator('[data-action="iron-add-set"]').click();
  const after = await saved();
  assert.deepEqual(after.condition.logs[day].gym, set, 'new day never modifies previous sets');
  assert.equal(after.condition.logs[next].gym.length, 1);
  assert.equal(after.condition.logs[next].gym[0].weight * after.condition.logs[next].gym[0].reps, 270);
  assert.ok(after.condition.logs[next].gym[0].at.startsWith(next));
  assert.deepEqual(after.journals, baseline.journals);
  console.log('PASS R4 integration: health→iron→fund round trips, invalid inputs, 340kg/270kg, linked ID, reload and day boundary');
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const { page, browser, server } = await setup();
  const errors = [], failures = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await setViewportAndWaitForStableLayout(page, { width: 390, height: 900 }, '#app');
    try { await regression(page); } catch (error) { failures.push('integration: ' + error.stack); }
    // Always collect every entry, even if a regression or an earlier label fails.
    try { await inventory(page, navigate, output); } catch (error) { failures.push('labels: ' + error.stack); }
    assert.deepEqual(errors, [], 'no browser errors');
    assert.deepEqual(failures, [], 'all R4 acceptance checks pass');
  } finally {
    fs.writeFileSync(path.join(output, 'handover-result.json'), JSON.stringify({ errors, failures }, null, 2), 'utf8');
    await page.context().close(); await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
