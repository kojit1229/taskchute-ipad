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

async function healthJapanese(page) {
  const days = Array.from({ length: 8 }, (_, i) => ({
    date: "2026-07-" + String(18 + i), sleep_min: i === 7 ? 450 : 420,
    bed_time: "22:00", wake_time: "05:30", resting_hr: i === 7 ? 73 : 60,
    hrv_sdnn: i === 7 ? 80 : 100, steps: 7000, exercise_min: 30,
    active_kcal: 400, weight_kg: null
  }));
  let failFetch = false;
  await page.route(url => url.pathname.endsWith("/karada/health-daily.json"), route =>
    route.fulfill({ status: failFetch ? 500 : 200, contentType: "application/json",
      body: failFetch ? "{}" : JSON.stringify({ schema: 1, generated_at: "2026-07-25T08:00:00", days }) }));
  const response = page.waitForResponse(res => new URL(res.url()).pathname.endsWith("/karada/health-daily.json"));
  await page.reload(); await response;
  await nav(page, "instruments");
  await page.waitForFunction(() => document.querySelectorAll(".instr-kpi").length === 6);
  const root = page.locator(".instr-view");
  assert.equal(await root.locator("h1").innerText(), "健康");
  const text = await root.innerText();
  for (const expected of ["7時間30分", "安静時心拍数", "拍/分", "心拍変動", "ミリ秒", "キロカロリー",
    "直近7日", "欠測 0日", "早起き(06:00まで)", "月別の積み上げ", "記録した日時が今年のセットのみ"]) assert.ok(text.includes(expected), expected);
  assert.ok((await root.locator(".instr-condition-text").innerText()).includes("心拍変動 −20% が低めです。"));
  assert.ok(await root.locator('[data-action="karada-import"]').isVisible());
  assert.equal(await root.locator('button[data-action="instruments-open-iron-log"]').innerText(), "筋トレの記録を開く ›");
  const checks = await page.evaluate(async days => {
    const health = await import("/src/features/health.js");
    const cond = health.conditionFromHealth(days, "2026-07-25");
    return { reasons: cond.reasons, level: cond.level,
      summary: health.healthSummaryHTML("2026-07-25", true),
      stale: health.healthSummaryHTML("2026-07-27"),
      missing: health.healthSummaryHTML("2026-07-26", true),
      comment: health.conditionCommentText({ ...cond, reasons: ["HR +13bpm"] }),
      low: health.conditionCommentText({ ...cond, level: "low", sleepMin: 380 }),
      unknown: health.conditionCommentText({ level: "unknown" }) };
  }, days);
  assert.equal(checks.level, "deficit");
  assert.ok(checks.reasons.includes("HRV −20%"));
  assert.ok(checks.reasons.includes("HR +13bpm"));
  for (const expected of ["安静時心拍数 73拍/分", "心拍変動 80ミリ秒", "歩数 7,000歩", "体重 —kg", "07-25時点"])
    assert.ok(checks.summary.includes(expected), expected);
  assert.ok(checks.stale.includes("07-25時点 (古い)"));
  assert.ok(checks.missing.includes("健康データ 未取得"));
  assert.ok(checks.comment.startsWith("安静時心拍数 +13拍/分 が高めです。"));
  assert.ok(checks.low.includes("睡眠 6時間20分。") && checks.low.includes("最も大切なことを優先"));
  assert.equal(checks.unknown, "今朝の睡眠データはまだありません");
  failFetch = true;
  const failed = await page.evaluate(async () => {
    const health = await import("/src/features/health.js");
    const result = await health.forceHealthData();
    return { ok: result.ok, summary: health.healthSummaryHTML("2026-07-25", true) };
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.summary, checks.summary, "failed fetch retains the previous values");
  await root.locator('button[data-action="instruments-open-iron-log"]').click();
  await page.waitForSelector('#app[data-view="iron-log"]', { state: "attached" });
  await nav(page, "instruments");
  assert.equal(await page.locator(".instr-view h1").innerText(), "健康");
  await nav(page, "today");
  // 4回-08 日本語化の契約追随(監督者決定 2026-09-10)
  assert.equal(await page.locator(".tower-condition").count(), 1, "Today condition panel count matches the baseline");
  assert.equal(await page.locator(".tower-condition > .tower-condition-label").count(), 1);
  assert.equal(await page.locator(".tower-condition > .tower-condition-text").count(), 1);
  assert.equal(await page.locator(".tower-condition > .tower-condition-meta").count(), 1);
  console.log("PASS health: Japanese labels/units/reasons, raw HR/HRV reasons, missing/stale/failed values and controls");
}

async function run() {
  const { page, browser, server } = await setup();
  try { await twelveWeek(page); await healthJapanese(page); }
  finally { await page.context().close(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
