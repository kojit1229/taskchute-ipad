const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium, launchOptions, startServer, randomPort } = require("./helpers");
const KEY = "taskchute-journal-pwa-state-v1", T = "2026-09-11T12:00:00";
const schedule = (id, extra = {}) => ({ id, title: "fixture", date: "2026-09-11",
  plannedStartAt: "2026-09-11T13:00:00", plannedEndAt: "2026-09-11T14:00:00",
  completed: false, note: "", createdAt: T, updatedAt: T, deleted: false,
  seriesId: "", occurrenceKey: "", overrides: {}, ...extra });
const rows = [schedule("live"), schedule("tomb", { deleted: true }), null];
let checks = 0;
const pass = name => { checks++; console.log(`PASS ${name}`); };

async function nodeContracts() {
  const load = file => import(pathToFileURL(path.join(__dirname, "../src/", file)).href);
  const sync = await load("sync/github.js"), store = await load("state/store.js");
  const core = await load("core/single-schedule.js");
  const base = { settings: { github: {}, morningEnergyLog: {} }, journalMeta: {}, journals: {}, feedback: {},
    condition: { logs: {} }, sleep: { logs: {} }, zeroThinking: { entries: [], suggestedThemes: [] } };
  for (const key of ["blocks", "tasks", "projects", "bodyScans", "storeVisits", "swipeTriageLog",
    "aiStepProcessedIds", "aiStepDismissedIds", "aiStepPendingRequests"]) base[key] = [];
  sync.configureGithubSync({ personalDataFileConfig: x => x, pruneExpiredSuggestedThemes: x => x,
    todayISO: () => "2026-09-11", nowDateTime: () => T, addDays: x => x, isTouchedBlock: () => false });
  for (const tie of ["local", "remote"]) {
    const local = structuredClone({ ...base, singleSchedules: rows }), remote = structuredClone(base);
    store.setState(local);
    const merged = sync.computeSyncMerge(remote, tie);
    assert.ok(merged); assert.equal(merged.changedVsLocal, false); assert.equal(merged.changedVsRemote, true);
    assert.equal(sync.syncCoreEqual(remote), true, "individually merged schedules are not a core conflict");
    sync.applySyncMergeToRemote(merged, remote);
    assert.deepEqual(remote.singleSchedules, rows);
    const second = sync.computeSyncMerge(remote, tie);
    assert.equal(second.changedVsLocal, false); assert.equal(second.changedVsRemote, false);
    remote.singleSchedules = [schedule("live", { note: "remote", updatedAt: "2026-09-11T12:01:00" })];
    const newer = sync.computeSyncMerge(remote, tie);
    assert.equal(newer.changedVsLocal, true);
    sync.applySyncMergeToLocal(newer);
    assert.equal(store.state.singleSchedules[0].note, "remote");
    assert.equal(store.state.singleSchedules[1].deleted, true);
    pass(`node compute/changedVs/apply both targets: ${tie}`);
  }
  for (const bad of [null, {}, "[]"]) {
    store.setState(structuredClone(base));
    assert.equal(sync.computeSyncMerge({ ...base, singleSchedules: bad }, "local"), null);
    assert.equal(sync.syncCoreEqual({ ...base, singleSchedules: bad }), false);
  }
  assert.equal(core.singleSchedulesEqual([schedule("a")], [schedule("a", { updatedAt: "2026-09-11T12:01:00" })]), false);
  pass("node malformed containers stop and record timestamps participate in equality");
}

(async () => {
  await nodeContracts();
  const server = startServer(randomPort()), browser = await chromium.launch(launchOptions());
  async function fixture() {
    const context = await browser.newContext({ timezoneId: "Asia/Tokyo", locale: "ja-JP", serviceWorkers: "block" });
    const page = await context.newPage();
    page.on("console", message => { if (message.type() === "warning" || message.type() === "error") console.log("browser", message.text()); });
    await page.clock.install({ time: new Date(2026, 8, 11, 12) });
    await page.clock.pauseAt(new Date(2026, 8, 11, 12));
    await page.route("https://**", route => route.abort());
    await page.route("**/app.js", route => route.fulfill({ contentType: "text/javascript",
      body: fs.readFileSync(path.join(__dirname, "../app.js"), "utf8")
        + "\nwindow.__b7 = { normalizeState, getState: () => state, setState, render, sanitizedStateForGitHub, persistLocalNoSchedule, writeBackupSnapshotBeforeLoad, restoreBackup, importData, collectArchivable };" }));
    await page.addInitScript(({ KEY, rows, T }) => localStorage.setItem(KEY, JSON.stringify({
      singleSchedules: rows, dataModifiedAt: T, blocks: [], tasks: [], projects: [], settings: {}, selectedDate: "2026-09-11"
    })), { KEY, rows, T });
    await page.goto(`http://localhost:${server.address().port}`);
    await page.waitForFunction(() => !!window.__b7);
    await page.evaluate(async ({ T, KEY }) => {
      const app = window.__b7, sync = await import("/src/sync/github.js"), state = app.getState();
      window.__sync = sync;
      state.settings.github = { token: "fixture", dataOwner: "fixture", dataRepo: "fixture", branch: "test", path: "app-state.json" };
      state.settings.autoSync = true; state.settings.lastPushedAt = T; state.dataModifiedAt = T;
      state.blocks = []; state.recurrences = [];
      const io = window.__io = { remote: app.sanitizedStateForGitHub(), puts: [], failBackup: false, conflict: false };
      delete io.remote.singleSchedules;
      io.remote.dataModifiedAt = "2026-09-11T12:05:01";
      sync.setLastSyncedSha("before");
      window.confirm = () => true;
      window.fetch = async (url, options = {}) => {
        if (!String(url).startsWith("https://api.github.com/repos/fixture/fixture/")) throw Error("unexpected network " + url);
        const backup = String(url).includes("/backups/");
        if (options.method === "PUT") {
          if (backup && io.failBackup) return { ok: false, status: 403, json: async () => ({ message: "fixture denied" }) };
          if (!backup && io.conflict) { io.conflict = false; return { ok: false, status: 409, json: async () => ({ message: "fixture conflict" }) }; }
          const body = JSON.parse(options.body), bytes = Uint8Array.from(atob(body.content), c => c.charCodeAt(0));
          io.puts.push({ backup, state: JSON.parse(new TextDecoder().decode(bytes)) });
          if (io.putGate && !backup) await io.putGate;
          return { ok: true, json: async () => ({ content: { sha: "sent" } }) };
        }
        if (io.getGate && !backup) await io.getGate;
        const bytes = new TextEncoder().encode(JSON.stringify(backup ? io.backup : io.remote));
        return { ok: true, json: async () => ({ encoding: "base64", sha: "remote",
          content: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")) }) };
      };
      app.persistLocalNoSchedule();
      state.currentView = "today"; app.render();
      io.beforeRaw = localStorage.getItem(KEY);
    }, { T, KEY });
    return { context, page };
  }
  try {
    for (const method of ["loadFromGitHub", "runAutoSyncPull", "syncFromGitHubOnStartup", "saveToGitHub", "runAutoSyncPush"]) {
      const { context, page } = await fixture();
      try {
        await page.evaluate(async method => {
          if (method === "runAutoSyncPush") window.__b7.getState().settings.lastPushedAt = "2026-09-11T11:59:00";
          await window.__sync[method]();
        }, method);
        const result = await page.evaluate(({ KEY }) => ({ state: window.__b7.getState(),
          saved: JSON.parse(localStorage.getItem(KEY)), puts: window.__io.puts }), { KEY });
        assert.deepEqual(result.state.singleSchedules, rows, method);
        assert.deepEqual(result.saved.singleSchedules, rows, "persisted after adoption");
        assert.ok(result.state.dataModifiedAt > "2026-09-11T12:05:01", "remote +301 seconds cannot suppress union resend: "
          + JSON.stringify({ method, stamp: result.state.dataModifiedAt, toast: await page.locator("#toast").textContent() }));
        if (["saveToGitHub", "runAutoSyncPush"].includes(method)) {
          assert.ok(result.puts.some(put => !put.backup), "main PUT occurred");
          for (const put of result.puts) assert.deepEqual(put.state.singleSchedules, rows);
        }
        // Disable the initialization fixture before reload so actual persisted data is read.
        await page.evaluate(() => { window.__b7.getState().settings.autoSync = false; window.__b7.persistLocalNoSchedule(); });
        const raw = await page.evaluate(KEY => localStorage.getItem(KEY), KEY);
        const reloadPage = await context.newPage();
        await reloadPage.route("https://**", route => route.abort());
        await reloadPage.goto(`http://localhost:${server.address().port}`);
        await reloadPage.waitForFunction(async () => !!(await import("/src/state/store.js")).state);
        assert.deepEqual(await reloadPage.evaluate(async () => (await import("/src/state/store.js")).state.singleSchedules), rows);
        assert.deepEqual(JSON.parse(raw).singleSchedules, rows);
        pass(`browser ${method}: legacy missing array, tombstones, future clock, persisted reload`);
      } finally { await context.close(); }
    }
    for (const mode of ["backup-failure", "get-edit", "put-edit", "invalid", "auto-merge", "old-auto-pull", "pending-auto-pull", "conflict-retry", "exports", "restore", "import"]) {
      const { context, page } = await fixture();
      try {
        const result = await page.evaluate(async ({ mode, KEY, extra }) => {
          const app = window.__b7, sync = window.__sync, io = window.__io;
          const before = JSON.stringify(app.getState());
          if (mode === "backup-failure") {
            io.remote.aiScheduleHistory = [{ id: "different" }]; io.failBackup = true;
            await sync.loadFromGitHub();
            return { unchanged: JSON.stringify(app.getState()) === before, raw: localStorage.getItem(KEY) === io.beforeRaw };
          }
          if (mode === "invalid") {
            io.remote.singleSchedules = null;
            await sync.loadFromGitHub(); await sync.runAutoSyncPush();
            return { unchanged: JSON.stringify(app.getState()) === before, puts: io.puts.length };
          }
          if (mode === "get-edit") {
            io.getGate = new Promise(resolve => { io.releaseGet = resolve; });
            const pulling = sync.loadFromGitHub();
            app.getState().singleSchedules.push(extra); app.persistLocalNoSchedule();
            io.releaseGet(); await pulling;
          }
          if (mode === "put-edit") {
            io.putGate = new Promise(resolve => { io.releasePut = resolve; });
            window.__pendingPut = sync.saveToGitHub();
            return { pending: true };
          }
          if (mode === "auto-merge") {
            io.remote.declarations = [{ id: "other", declaredAt: "2026-09-11T09:00:00" }];
            await sync.autoMergeRemote(app.normalizeState(structuredClone(io.remote)), io.remote.dataModifiedAt, "remote");
          }
          if (mode === "old-auto-pull") { io.remote.dataModifiedAt = "2026-09-11T11:00:00"; await sync.runAutoSyncPull(); }
          if (mode === "pending-auto-pull") { app.getState().settings.lastPushedAt = "2026-09-11T11:00:00"; await sync.runAutoSyncPull(); }
          if (mode === "conflict-retry") {
            io.conflict = true; await sync.saveToGitHub();
            const failedRows = structuredClone(app.getState().singleSchedules), firstPuts = io.puts.filter(put => !put.backup).length;
            await sync.saveToGitHub();
            return { failedRows, firstPuts, sent: io.puts.find(put => !put.backup)?.state.singleSchedules };
          }
          if (mode === "exports") {
            await app.writeBackupSnapshotBeforeLoad();
            return { exported: app.sanitizedStateForGitHub().singleSchedules, backup: io.puts[0].state.singleSchedules,
              archive: app.collectArchivable().byYear, live: app.getState().singleSchedules };
          }
          if (mode === "restore") { io.backup = io.remote; await app.restoreBackup("app-state-2026-09-11.json"); }
          if (mode === "import") {
            app.importData(new File([JSON.stringify(io.remote)], "fixture.json", { type: "application/json" }));
            return { pending: true };
          }
          return { state: app.getState().singleSchedules };
        }, { mode, KEY, extra: schedule("during-get") });
        if (mode === "backup-failure") assert.deepEqual(result, { unchanged: true, raw: true });
        else if (mode === "invalid") assert.deepEqual(result, { unchanged: true, puts: 0 });
        else if (mode === "get-edit") assert.deepEqual(result.state, [schedule("during-get"), ...rows]);
        else if (mode === "conflict-retry") {
          assert.deepEqual(result.failedRows, rows); assert.equal(result.firstPuts, 0); assert.deepEqual(result.sent, rows);
        }
        else if (mode === "put-edit") {
          await page.waitForFunction(() => window.__io.puts.some(put => !put.backup));
          const result = await page.evaluate(async extra => {
            const state = window.__b7.getState(); state.singleSchedules.push(extra); state.dataModifiedAt = "2026-09-11T12:06:00";
            window.__b7.persistLocalNoSchedule(); window.__io.releasePut(); await window.__pendingPut;
            return { stamp: state.dataModifiedAt, pushed: state.settings.lastPushedAt, rows: state.singleSchedules };
          }, schedule("during-put"));
          assert.deepEqual(result.rows, [...rows, schedule("during-put")]); assert.ok(result.stamp > result.pushed);
        } else if (mode === "import") {
          await page.waitForFunction(() => window.__b7.getState().dataModifiedAt > "2026-09-11T12:05:01");
          assert.deepEqual(await page.evaluate(() => window.__b7.getState().singleSchedules), rows);
        } else if (mode === "exports") {
          assert.deepEqual(result.exported, rows); assert.deepEqual(result.backup, rows);
          assert.deepEqual(result.live, rows); assert.deepEqual(result.archive, {});
        } else assert.deepEqual(result.state, rows);
        pass(`browser ${mode}`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  console.log(`${checks} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
