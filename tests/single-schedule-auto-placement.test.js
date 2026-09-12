const assert = require('node:assert/strict');
const { chromium, launchOptions, startServer, randomPort } = require('./helpers');
const KEY = 'taskchute-journal-pwa-state-v1', date = '2026-09-14';
const stamp = `${date}T07:00:00`;
const schedule = (id, start, end) => ({ id, title: id, date,
  plannedStartAt: `${date}T${start}:00`, plannedEndAt: `${date}T${end}:00`,
  completed: false, deleted: false, note: '', createdAt: stamp, updatedAt: stamp });
const block = (id, start, end, category = '') => ({ ...schedule(id, start, end), category,
  taskId: `task-${id}`, estimateMin: 30, actualStartAt: '', actualEndAt: '', migratedTo: '', carryCount: 0 });

(async () => {
  const server = startServer(randomPort()), browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ timezoneId: 'Asia/Tokyo', locale: 'ja-JP', serviceWorkers: 'block', viewport: { width: 1500, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    // Install before the pause target so elapsed setup time cannot move it into the past.
    await page.clock.install({ time: new Date(2026, 8, 14, 6) });
    await page.clock.pauseAt(new Date(2026, 8, 14, 7));
    await page.route('https://**', route => route.abort());
    await page.route('**/app.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
window.autoTest = {
  reset(value) { setState(normalizeState({ ...value, settings: {}, selectedDate: '${date}', currentView: 'exec' })); _scheduleDraft = null; _draftUndo = null; },
  gaps: (...args) => computeFreeGaps(...args), run: others => runAiSchedule(others),
  setDraft(draft) { _scheduleDraft = capturePlannedDraft(state, draft); _draftUndo = { marker: 'keep undo' }; render(); },
  confirm: () => confirmScheduleDraft(), get: () => ({ state, draft: _scheduleDraft, undo: _draftUndo })
};` });
    });
    await page.goto(`http://localhost:${server.address().port}`);
    await page.waitForFunction(() => !!window.autoTest);
    const reset = (blocks = [], singleSchedules = []) => page.evaluate(({ blocks, singleSchedules }) => {
      autoTest.reset({ blocks, singleSchedules, tasks: blocks.map(b => ({ id: b.taskId, title: b.title, status: 'todo', projectId: 'p' })), projects: [{ id: 'p', title: 'fixture', kind: 'normal', status: 'active' }] });
    }, { blocks, singleSchedules });
    const get = () => page.evaluate(() => autoTest.get());
    await reset([], [schedule('busy', '09:00', '10:00')]);
    const other = { id: 'other', plannedStartAt: `${date}T10:00`, plannedEndAt: `${date}T11:00` };
    assert.deepEqual(await page.evaluate(({ date, other }) => autoTest.gaps(date, 540, 720, null, [other]), { date, other }), [[660, 720]]);
    await page.evaluate(() => { autoTest.get().state.singleSchedules[0].completed = true; });
    assert.deepEqual(await page.evaluate(date => autoTest.gaps(date, 540, 600), date), []);
    console.log('PASS common occupancy: single/completed/explicit other draft');

    await reset([block('work', '09:00', '09:30', '仕事'), block('private', '08:00', '08:30')], [schedule('busy', '08:00', '10:00')]);
    await page.evaluate(other => autoTest.run([other]), other);
    let result = await get();
    assert.equal(result.draft.items.length, 2);
    assert.deepEqual(result.draft.items.map(row => row.start), [660, 700]);
    assert.equal(result.state.blocks[0].plannedStartAt, `${date}T09:00:00`);
    assert.ok(result.draft.items.every(row => row.start >= (row.category === '仕事' ? 540 : 480)
      && row.start + row.minutes <= (row.category === '仕事' ? 1080 : 1260)));
    const before = structuredClone(result.state.blocks);
    await page.evaluate(({ date, stamp }) => autoTest.get().state.singleSchedules.push({ id: 'incoming', title: 'incoming', date,
      plannedStartAt: `${date}T11:00:00`, plannedEndAt: `${date}T12:00:00`, createdAt: stamp, updatedAt: stamp }), { date, stamp });
    assert.equal(await page.evaluate(() => autoTest.confirm()), false);
    assert.deepEqual((await get()).state.blocks, before);
    assert.deepEqual((await get()).draft, result.draft);
    console.log('PASS work/private windows, 10 minute buffer, preview, latest schedule conflict');

    await reset([], []);
    await page.evaluate(({ date, other }) => autoTest.setDraft({ date, items: [{ id: 'one', title: 'one', start: 600, minutes: 30 }], otherDraftIntervals: [other] }), { date, other });
    assert.equal(await page.evaluate(() => autoTest.confirm()), false);
    assert.equal((await get()).state.blocks.length, 0);
    for (const patch of [{ start: 239 }, { minutes: 0 }, { start: 1430, minutes: 30 }]) {
      await page.evaluate(({ date, patch }) => autoTest.setDraft({ date, items: [{ id: 'invalid', title: 'invalid', start: 600, minutes: 30, ...patch }] }), { date, patch });
      assert.equal(await page.evaluate(() => autoTest.confirm()), false);
      assert.equal((await get()).state.blocks.length, 0);
    }
    console.log('PASS other draft conflict and invalid candidates save nothing');

    const legacy = block('legacy', '22:00', '23:59');
    await reset([legacy]);
    await page.evaluate(date => autoTest.setDraft({ date, items: [{ id: 'midnight', title: 'new midnight', start: 1439, minutes: 1 }] }), date);
    assert.equal(await page.evaluate(() => autoTest.confirm()), false);
    await page.evaluate(() => { autoTest.get().state.blocks[0].plannedStartAt = '2026-09-13T22:00:00'; autoTest.get().state.blocks[0].plannedEndAt = '2026-09-13T23:59:00'; autoTest.get().state.blocks[0].date = '2026-09-13'; });
    await page.evaluate(date => autoTest.setDraft({ date, items: [{ id: 'midnight', title: 'new midnight', start: 1425, minutes: 15 }] }), date);
    const old = (await get()).state.blocks;
    await page.evaluate(KEY => {
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) { if (key === KEY) throw new DOMException('fixture quota', 'QuotaExceededError'); return originalSetItem.call(this, key, value); };
    }, KEY);
    assert.equal(await page.evaluate(() => autoTest.confirm()), false);
    const failed = await get();
    assert.deepEqual(failed.state.blocks, old);
    assert.equal(failed.undo.marker, 'keep undo');
    assert.equal(failed.draft.items[0].title, 'new midnight');
    assert.ok(failed.draft.items[0].candidateId);
    assert.equal(failed.draft.items[0].candidateId, failed.draft.items[0].candidateBlock.id);
    await page.evaluate(() => { Storage.prototype.setItem = originalSetItem; });
    assert.equal(await page.evaluate(() => autoTest.confirm()), true);
    result = await get();
    assert.equal(result.draft, null); assert.equal(result.undo, null);
    assert.deepEqual(result.state.blocks[0], old[0]);
    assert.equal(result.state.blocks[1].id, failed.draft.items[0].candidateId);
    assert.equal(result.state.blocks[1].plannedEndAt, '2026-09-15T00:00');
    assert.deepEqual(await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)).blocks, KEY), result.state.blocks);
    await page.reload(); await page.waitForFunction(() => !!window.autoTest);
    assert.equal((await get()).state.blocks.filter(b => b.id === failed.draft.items[0].candidateId).length, 1);
    console.log('PASS quota rollback/input/undo/candidate retry/midnight/legacy 23:59/reload');

    await reset([block('move', '20:00', '20:30')]);
    await page.evaluate(date => autoTest.setDraft({ date, items: [{ id: 'move-draft', blockId: 'move', title: 'move', start: 1425, minutes: 15 }] }), date);
    assert.equal(await page.evaluate(() => autoTest.confirm()), true);
    assert.equal((await get()).state.blocks[0].plannedEndAt, '2026-09-15T00:00');
    await page.evaluate(date => autoTest.setDraft({ date, items: [{ id: 'stale', blockId: 'move', start: 600, minutes: 30 }] }), date);
    await page.evaluate(() => { autoTest.get().state.blocks[0].title = 'changed elsewhere'; });
    assert.equal(await page.evaluate(() => autoTest.confirm()), false);
    assert.equal((await get()).state.blocks[0].title, 'changed elsewhere');
    assert.deepEqual(errors, []);
    console.log('PASS moved midnight/source fingerprint; 7 scenario groups passed');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
