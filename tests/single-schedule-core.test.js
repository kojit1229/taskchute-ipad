const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { startServer, randomPort, chromium, launchOptions } = require("./helpers");
const KEY = "taskchute-journal-pwa-state-v1";
const row = (extra = {}) => ({ id: "s1", title: "fixture", date: "2026-09-11",
  plannedStartAt: "2026-09-11T23:00:00", plannedEndAt: "2026-09-12T00:00:00", ...extra });
let checks = 0;
function check(name, action) { action(); checks++; console.log(`PASS ${name}`); }
(async () => {
  const { normalizeSingleSchedules: normalize, schedulesForDate } = await import(pathToFileURL(
    path.join(__dirname, "../src/core/single-schedule.js")).href);
  check("absent only becomes empty; malformed containers stop", () => {
    assert.deepEqual(normalize(undefined).stored, []);
    for (const value of [null, {}, "[]", 7, false])
      assert.throws(() => normalize(value), { name: "StateContainerError" });
  });
  check("missing defaults only, no issued identity or timestamp; unknown fields survive", () => {
    const original = row({ extra: { keep: 1 } }), before = structuredClone(original);
    const record = normalize([original]).stored[0];
    assert.deepEqual(original, before);
    assert.deepEqual(record, { ...original, completed: false, note: "", createdAt: "", updatedAt: "",
      deleted: false, seriesId: "", occurrenceKey: "", overrides: {} });
    assert.deepEqual(normalize([record]).stored, [record]);
    const tomb = row({ deleted: true, updatedAt: "2026-09-11T09:00:00" });
    assert.equal(normalize([tomb]).records[0].updatedAt, tomb.updatedAt);
    assert.deepEqual(schedulesForDate({ singleSchedules: [tomb] }, tomb.date).records, []);
  });
  const bad = [null, "bad", row({ id: "" }), row({ title: " " }), row({ completed: null }),
    row({ date: "2026-02-30" }), row({ plannedStartAt: "2026-09-11T24:00:00" }),
    row({ plannedEndAt: "2026-09-13T00:00:00" }), row({ plannedEndAt: "2026-09-11T20:00:00" }),
    row({ note: 3 }), row({ seriesId: "future" }), row({ overrides: { title: "x" } })];
  check("invalid items stay verbatim; valid rows and warnings remain readable", () => {
    for (const value of bad) {
      const good = row({ id: "good", completed: true }), result = normalize([good, value]);
      assert.strictEqual(result.stored[1], value);
      assert.equal(result.records.length, 1);
      assert.deepEqual(result.warnings, [{ code: "invalid-records", count: 1 }]);
      const reloaded = JSON.parse(JSON.stringify(result.stored));
      assert.deepEqual(normalize(reloaded).stored, reloaded);
      assert.equal(schedulesForDate({ singleSchedules: reloaded }, good.date).records.length, 1);
    }
    for (const duplicate of [row(), row({ title: "other" }), row({ note: null })]) {
      const result = normalize([row(), duplicate]);
      assert.equal(result.records.length, 0);
      assert.equal(result.preserved.length, 2);
    }
  });
  const server = await startServer(randomPort()), browser = await chromium.launch(launchOptions());
  try {
    for (const singleSchedules of [undefined, [row(), null], null, "broken"]) {
      const context = await browser.newContext({ timezoneId: "Asia/Tokyo", locale: "ja-JP" });
      const page = await context.newPage();
      page.on("pageerror", error => console.log("browser error", error.message));
      await page.route("https://**", route => route.abort());
      const fixture = { singleSchedules, blocks: [], tasks: [], projects: [], settings: {} };
      const raw = JSON.stringify(fixture);
      await page.addInitScript(({ KEY, raw }) => localStorage.setItem(KEY, raw), { KEY, raw });
      await page.goto(`http://localhost:${server.address().port}`);
      if (singleSchedules === null || typeof singleSchedules === "string") {
        await page.waitForFunction(() => document.body.textContent.includes("保存と同期を停止"));
        assert.equal(await page.evaluate(KEY => localStorage.getItem(KEY), KEY), raw);
      } else {
        await page.waitForFunction(async () => !!(await import("/src/state/store.js")).state?.singleSchedules);
        const stored = await page.evaluate(async () => {
          const { state } = await import("/src/state/store.js");
          return { schedules: state.singleSchedules, blocks: state.blocks };
        });
        assert.deepEqual(stored.schedules, normalize(singleSchedules).stored);
        assert.deepEqual(stored.blocks, []);
      }
      checks++; console.log(`PASS real app startup ${JSON.stringify(singleSchedules)}`);
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  console.log(`${checks} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
