const assert = require('node:assert/strict');
const { chromium, launchOptions, startServer, randomPort, passGithubGate } = require('./helpers');
const KEY = 'taskchute-journal-pwa-state-v1', date = '2026-09-11';
const invalidRow = { id: 'future-invalid', date: '2026-02-30', title: '元値保全', seriesId: 'future-series', occurrenceKey: 'first', overrides: { future: ['untouched'] } };

(async () => {
  const server = startServer(randomPort()), browser = await chromium.launch(launchOptions());
  try {
    for (const connection of ['today', 'detail']) {
      const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'ja-JP', serviceWorkers: 'block' });
      try {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        // Install before the pause target so elapsed setup time cannot move it into the past.
        await page.clock.install({ time: new Date(2026, 8, 11, 11) });
        await page.clock.pauseAt(new Date(2026, 8, 11, 12));
        await page.route('https://**', route => route.abort());
        await page.route('**/app.js', async route => {
          const response = await route.fetch();
          await route.fulfill({ response, body: await response.text() + `
import { getSingleScheduleDraft as flowDraft } from '/src/features/single-schedule.js';
import { contentKey as flowFingerprint } from '/src/core/single-schedule-merge.js';
import { scheduleDisplay as flowDisplay } from '/src/features/single-schedule-view.js';
const flowDeps = { ...dailyOperationDeps, get state() { return state; }, connection: '${connection}' };
window.flow = { get: () => state, persist: persistLocalNoSchedule, sanitized: sanitizedStateForGitHub,
  run: (action, input) => runDailyOperation('daily-schedule-' + action, { kind: 'schedule', ...input }, flowDeps),
  draft: (action, input) => flowDraft(action, { kind: 'schedule', ...input }, flowDeps), fp: flowFingerprint,
  show(date) { state.selectedDate = date; state.currentView = 'today'; render(); },
  display: date => flowDisplay(state, date), availability: date => plannedAvailability(state, date),
  validate: draft => validatePlannedDraft(state, draft) };
` });
        });
        await page.goto(`http://localhost:${server.address().port}/styles.css`);
        await page.evaluate(({ KEY, date, invalidRow }) => localStorage.setItem(KEY, JSON.stringify({
          selectedDate: date, currentView: 'today', singleSchedules: [invalidRow], settings: {},
          tasks: [{ id: 'side-task', title: '保持', status: 'todo' }], blocks: [], declarations: []
        })), { KEY, date, invalidRow });
        await page.goto(`http://localhost:${server.address().port}`);
        await passGithubGate(page);
        await page.waitForFunction(() => !!window.flow);
        const conflicts = await page.evaluate(date => {
          const draft = { date, items: [{ id: 'own', start: 600, minutes: 30 }], otherDraftIntervals: [
            { id: 'other-a', plannedStartAt: `${date}T13:00`, plannedEndAt: `${date}T14:00` },
            { id: 'other-b', plannedStartAt: `${date}T13:30`, plannedEndAt: `${date}T14:30` }] };
          const unrelated = flow.validate(draft).error;
          draft.items[0].start = 810;
          return { unrelated, own: flow.validate(draft).error };
        }, date);
        assert.equal(conflicts.unrelated, ''); assert.match(conflicts.own, /重なり/);
        const side = () => page.evaluate(() => JSON.stringify({ tasks: flow.get().tasks, blocks: flow.get().blocks, declarations: flow.get().declarations }));
        const beforeSide = await side();
        const rows = () => page.evaluate(() => flow.get().singleSchedules);
        const failStorage = fail => page.evaluate(({ KEY, fail }) => {
          window.originalSetItem ||= Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (fail && key === KEY) throw new DOMException('fixture quota', 'QuotaExceededError');
            return originalSetItem.call(this, key, value);
          };
        }, { KEY, fail });
        const run = (action, input) => page.evaluate(({ action, input }) => flow.run(action, input), { action, input });
        const reload = async () => { await page.reload(); await page.waitForFunction(() => !!window.flow); };
        const values = { title: '通し予定', date, start: '23:00', end: '05:00', endNextDay: true, note: '入力保持' };
        const before = await rows();
        await failStorage(true);
        assert.equal((await run('add', { requestId: 'create', values })).ok, false);
        assert.deepEqual(await rows(), before);
        const candidate = await page.evaluate(() => flow.draft('add', { requestId: 'create' }));
        assert.deepEqual(candidate.values, values); assert.equal(candidate.connection, connection);
        await reload();
        assert.equal(await page.evaluate(() => flow.draft('add', { requestId: 'create' }).candidateId), candidate.candidateId);
        assert.equal((await run('add', { requestId: 'create' })).ok, true);
        assert.equal((await run('add', { requestId: 'create' })).unchanged, true);
        let live = (await rows()).find(row => row.id === candidate.candidateId);
        assert.equal(live.plannedEndAt, '2026-09-12T05:00:00');
        await page.evaluate(date => flow.show(date), date);
        assert.ok(await page.locator(`[data-schedule-id="${live.id}"]`).count());
        if (connection === 'detail') {
          await page.locator(`[data-action="schedule-view-details"][data-id="${live.id}"]`).first().click();
          assert.equal(await page.evaluate(() => flow.get().modal.type), 'singleScheduleView');
        }
        console.log(`PASS ${connection}: registry add/quota/input/candidate/reload/resend/visible connection`);

        const fingerprint = await page.evaluate(id => flow.fp(flow.get().singleSchedules.find(row => row.id === id)), live.id);
        await failStorage(true);
        const editedValues = { ...values, title: '編集済み', start: '23:30', note: '編集を保持' };
        assert.equal((await run('edit', { id: live.id, requestId: 'edit', baseFingerprint: fingerprint, values: editedValues })).ok, false);
        assert.equal((await rows()).find(row => row.id === live.id).title, '通し予定');
        await reload();
        assert.deepEqual(await page.evaluate(id => flow.draft('edit', { id, requestId: 'edit' }).values, live.id), editedValues);
        assert.equal((await run('edit', { id: live.id, requestId: 'edit' })).ok, true);
        assert.equal((await run('edit', { id: live.id, requestId: 'edit' })).unchanged, true);
        live = (await rows()).find(row => row.id === live.id);
        const occupied = await page.evaluate(date => flow.availability(date).occupied, date);
        const completeInput = { id: live.id, requestId: 'complete', desiredCompleted: true,
          baseFingerprint: await page.evaluate(id => flow.fp(flow.get().singleSchedules.find(row => row.id === id)), live.id) };
        assert.equal((await run('complete', completeInput)).ok, true);
        assert.equal((await run('complete', completeInput)).unchanged, true);
        assert.deepEqual(await page.evaluate(date => flow.availability(date).occupied, date), occupied);
        await page.evaluate(() => flow.show('2026-09-12'));
        const next = await page.evaluate(() => ({ display: flow.display('2026-09-12'), occupancy: flow.availability('2026-09-12') }));
        assert.equal(next.display.records.find(row => row.id === live.id).date, date);
        assert.equal(next.display.records.filter(row => row.id === live.id).length, 1);
        assert.deepEqual(next.occupancy.occupied, [[240, 300]]);
        assert.equal(next.display.warnings[0].count, 1);
        assert.equal(await side(), beforeSide);
        console.log(`PASS ${connection}: edit rollback/reload/desired completion/previous-day continuation/unchanged Task Block actuals`);

        // Real sync functions, synthetic GET/PUT only. Missing arrays model an older peer.
        const syncFlow = () => page.evaluate(async ({ KEY, date }) => {
          const sync = await import('/src/sync/github.js'), io = { puts: [], remote: null, seq: 0 };
          const configure = () => { const state = flow.get(); state.settings.github = { token: 'fixture', dataOwner: 'fixture', dataRepo: 'fixture', branch: 'test', path: 'app-state.json' }; state.settings.autoSync = true; state.settings.lastPushedAt = '2026-09-11T11:00:00'; };
          window.confirm = () => true;
          window.fetch = async (url, options = {}) => {
            if (!String(url).startsWith('https://api.github.com/repos/fixture/fixture/')) throw Error('unexpected fixture URL');
            if (options.method === 'PUT') {
              const payload = JSON.parse(options.body), bytes = Uint8Array.from(atob(payload.content), c => c.charCodeAt(0));
              io.puts.push({ backup: String(url).includes('/backups/'), state: JSON.parse(new TextDecoder().decode(bytes)) });
              return { ok: true, json: async () => ({ content: { sha: 'sent-' + io.seq } }) };
            }
            const bytes = new TextEncoder().encode(JSON.stringify(io.remote));
            return { ok: true, json: async () => ({ encoding: 'base64', sha: 'remote-' + io.seq,
              content: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')) }) };
          };
          const snapshots = [];
          for (const method of ['loadFromGitHub', 'runAutoSyncPull', 'syncFromGitHubOnStartup', 'saveToGitHub', 'runAutoSyncPush']) {
            configure(); io.seq++; io.remote = flow.sanitized(); delete io.remote.singleSchedules;
            io.remote.dataModifiedAt = `2026-09-11T12:${String(10 + io.seq).padStart(2, '0')}:00`;
            if (method === 'loadFromGitHub') io.remote.aiScheduleHistory = [{ id: 'force-full-adoption' }];
            sync.setLastSyncedSha('before-' + io.seq);
            const putCount = io.puts.length;
            const before = structuredClone(flow.get().singleSchedules);
            await sync[method]();
            snapshots.push({ method, before, rows: structuredClone(flow.get().singleSchedules),
              saved: JSON.parse(localStorage.getItem(KEY)).singleSchedules, puts: io.puts.slice(putCount) });
          }
          flow.get().settings.autoSync = false; flow.persist();
          return snapshots;
        }, { KEY, date });
        const synced = await syncFlow();
        const expected = await rows();
        for (const snapshot of synced) {
          assert.deepEqual(snapshot.rows, expected, snapshot.method);
          assert.deepEqual(snapshot.saved, expected, snapshot.method + ' persisted');
          if (['saveToGitHub', 'runAutoSyncPush'].includes(snapshot.method)) assert.ok(snapshot.puts.some(put => !put.backup));
          for (const put of snapshot.puts) assert.deepEqual(put.state.singleSchedules, put.backup ? snapshot.before : expected);
        }
        await reload(); assert.deepEqual(await rows(), expected);
        console.log(`PASS ${connection}: manual full adoption/auto pull/startup pull/manual push/auto push/legacy missing array/reload`);

        const deletion = { id: live.id, requestId: 'delete', confirmed: true,
          baseFingerprint: await page.evaluate(id => flow.fp(flow.get().singleSchedules.find(row => row.id === id)), live.id) };
        await failStorage(true);
        assert.equal((await run('delete', deletion)).ok, false);
        assert.equal((await rows()).find(row => row.id === live.id).deleted, false);
        await failStorage(false);
        assert.equal((await run('delete', deletion)).ok, true);
        assert.equal((await run('delete', deletion)).unchanged, true);
        assert.deepEqual(await page.evaluate(date => flow.availability(date).gaps, date), [[240, 1440]]);
        assert.deepEqual(await page.evaluate(() => flow.availability('2026-09-12').gaps), [[240, 1440]]);
        const deletedRows = await rows();
        for (const snapshot of await syncFlow()) {
          assert.deepEqual(snapshot.rows, deletedRows, snapshot.method + ' keeps deletion');
          assert.deepEqual(snapshot.saved, deletedRows);
          for (const put of snapshot.puts) assert.deepEqual(put.state.singleSchedules, put.backup ? snapshot.before : deletedRows);
        }
        await reload();
        assert.equal((await run('delete', deletion)).unchanged, true);
        assert.equal((await rows()).filter(row => row.id === live.id).length, 1);
        assert.deepEqual((await rows()).find(row => row.id === invalidRow.id), invalidRow);
        assert.equal(await side(), beforeSide);
        assert.deepEqual(errors, []);
        console.log(`PASS ${connection}: delete failure/retry/tombstone reload/empty time restored/invalid future source preserved`);
      } finally { await context.close(); }
    }
    console.log('PASS both connections completed the schedule lifecycle');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
