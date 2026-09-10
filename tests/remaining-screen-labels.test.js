// playwright-core via shared setup. Remaining screen labels: twelve-week controls and Japanese guidance; responsive browser coverage.
const assert = require("node:assert/strict");
const { setup, nav } = require("./remaining-twelveweek-layout.test");
async function twelveWeek(page) {
  await nav(page, "twelveweek");
  const root = page.locator(".twy-tower");
  assert.ok((await root.innerText()).includes("12週間実行サイクル"));
  assert.equal(await root.locator('[data-action="twy-face-select"]').count(), 2);
  assert.equal(await root.locator(".twy-face-segmented button:disabled").count(), 2);
  for (const [action, text] of [["twy-vision-open", "架空の3年ビジョン"], ["twy-open-commit", "今週を確定"]]) {
    assert.ok((await root.locator('[data-action="' + action + '"]').innerText()).includes(text));
  }
  await root.locator('[data-action="twy-vision-open"]').click();
  assert.ok(await page.locator('[data-action="twy-vision-save"]').isVisible());
  const closeButtons = page.locator('[data-action="modal-close"]');
  assert.equal(await closeButtons.count(), 2);
  for (const button of await closeButtons.all()) assert.ok(await button.isVisible());
  await page.locator('[data-action="modal-close"]').first().click();
  await root.locator('[data-action="twy-face-select"][data-face="plan"]').click();
  assert.equal(await root.locator(".twy-plan-link-edit").count(), 5);
  for (const [selector, count] of [
    ['.twy-plan-link-edit[data-action="nav"][data-view="wbs"]', 2],
    ['.twy-plan-link-edit[data-action="nav"][data-view="timeline"]', 1],
    ['.twy-plan-link-edit[data-action="twy-open-commit"]', 1],
    ['.twy-plan-link-edit[data-action="twy-face-select"][data-face="cycle"]', 1]
  ]) assert.equal(await root.locator(selector).count(), count);
  assert.equal(await root.locator(".twy-plan-grid th").count(), 14);
  assert.equal(await root.locator(".twy-plan-cell").count(), 12);
  assert.ok((await root.locator(".twy-plan-none-panel").innerText()).includes("目安なし"));
  assert.equal(await root.locator('[data-action="edit-task"][data-id="layout-no-plan"]').innerText(), "目安を設定 ›");
  console.log("PASS twelve-week: headings, both faces, all existing controls and 12 columns");
}
async function run() {
  const { page, browser, server } = await setup();
  try { await twelveWeek(page); }
  finally { await page.context().close(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
