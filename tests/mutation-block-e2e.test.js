// Exercise the actual legacy entry points against the shared candidate boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const { fixedClock, withLocalSaveFailure, expectRestored, deepCommitGuard } = require('./helpers');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const functions = names => names.map(name => {
  const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node, `actual app entry: ${name}`);
  return source.slice(node.start, node.end);
}).join('\n');
const clone = value => JSON.parse(JSON.stringify(value));

// F5: real delegated buttons and the real local candidate-save boundary.
async function f5Browser(run) {
  const { chromium, launchOptions, defaultContextOptions, startServer, randomPort, blockGithubApiByDefault, STATE_KEY } = require('./helpers');
  const port = randomPort(), server = startServer(port);
  let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ ...defaultContextOptions(), serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(Date.UTC(2026, 8, 10, 1)));
    await blockGithubApiByDefault(page);
    await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: source +
      '\nwindow.__f5 = { getState: () => state, makeBlock, render, openDeclareModal, startPomodoro, openIncompleteReasonModal, openBodyScanModal };' }));
    await page.goto(`http://localhost:${port}`);
    await page.waitForFunction(() => Boolean(window.__f5));
    await page.evaluate(key => {
      const s = window.__f5.getState();
      Object.assign(s, { blocks: [], tasks: [], projects: [], recurrences: [], bodyScans: [], declarations: [],
        modal: null, currentView: 'today', selectedDate: '2026-09-10' });
      s.settings.autoSyncEnabled = false;
      s.settings.github = { token: 'fake-f5-token', dataOwner: 'fixture', dataRepo: 'fixture' };
      window.__f5.render();
      const original = Storage.prototype.setItem;
      window.__f5Save = { fail: false, writes: 0 };
      Storage.prototype.setItem = function(name, value) {
        if (name === key) {
          window.__f5Save.writes++;
          if (window.__f5Save.fail) throw new DOMException('F5 injected quota', 'QuotaExceededError');
        }
        return original.call(this, name, value);
      };
    }, STATE_KEY);
    try { await run(page, STATE_KEY); }
    catch (error) { console.error('F5 screen at failure:', await page.locator('body').innerText()); throw error; }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

test('F5-1 today interruption and actual-only entries use the new Block sheet and save once', async () => {
  await f5Browser(async (page, key) => {
    for (const interruption of [true, false]) {
      await page.locator(`[data-action="today-add-${interruption ? 'interruption' : 'actual'}"]`).click();
      const field = name => page.locator(`[data-modal-field="${name}"]`);
      assert.equal(await field('date').inputValue(), DATE);
      assert.equal(await field('plannedStartAt').inputValue(), '');
      assert.equal(await field('plannedEndAt').inputValue(), '');
      assert.equal(await field('actualStartAt').inputValue(), interruption ? DATE + 'T10:00' : '');
      assert.equal(await field('actualEndAt').inputValue(), '');
      assert.ok(await field('actualStartAt').isVisible());
      assert.equal(await field('actualStartAt').getAttribute('step'), '300');
      await field('title').fill(interruption ? '割り込み作業' : '後追い実績');
      if (!interruption) {
        await field('actualStartAt').fill(DATE + 'T08:00');
        await field('actualEndAt').fill(DATE + 'T08:30');
      }
      const before = await page.evaluate(() => window.__f5Save.writes);
      await page.locator('[data-action="modal-save"]').click();
      await page.waitForFunction(() => !window.__f5.getState().modal);
      assert.equal(await page.evaluate(() => window.__f5Save.writes), before + 1);
      const saved = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).blocks.at(-1), key);
      assert.equal(saved.plannedStartAt, '');
      assert.equal(saved.plannedEndAt, '');
      assert.equal(saved.actualStartAt, DATE + (interruption ? 'T10:00:00' : 'T08:00:00'));
      assert.equal(saved.actualEndAt, interruption ? '' : DATE + 'T08:30:00');
      assert.equal(saved.completed, false);
    }
  });
});

async function deletionFixture() {
  const f = await fixture(['deleteBlock', 'carryOverBlock', 'resolveMigrationRitual', 'bodyScanRecord', 'closeBodyScanFlow']);
  Object.assign(f.ctx, {
    window: { confirm: () => false }, _migrationRitualCtx: { srcId: 'b', origin: 'draft', draftItemId: 'draft-b' },
    logMigrationRitual: () => {}, bodyScanSyncCommentFromDom() {},
    _pendingBodyScanCtx: { fatigue: 2, recovery: 3, parts: ['neck'], comment: 'typed scan', pomodoroBlockId: 'b' }
  });
  f.ctx._scheduleDraft = { items: [{ id: 'draft-b' }] };
  f.ctx.state.bodyScans = [];
  return f;
}
const deletionEdits = [
  ['series deletion', f => {
    f.ctx.state.blocks[0].recurrenceGroupId = 'rule';
    Object.assign(f.ctx.state.recurrences[0], { kind: 'weekly', anchorDate: DATE, exceptionDates: [], updatedAt: FUTURE });
    return () => f.ctx.deleteBlock('b');
  }],
  ['carry', f => () => f.ctx.carryOverBlock('b', { toDate: '2026-09-11' })],
  ['release', f => () => f.ctx.resolveMigrationRitual('release')],
  ['ritual today', f => { f.ctx._migrationRitualCtx.origin = 'panel'; return () => f.ctx.resolveMigrationRitual('today'); }],
  ['ritual carry', f => { f.ctx._migrationRitualCtx.origin = 'panel'; return () => f.ctx.resolveMigrationRitual('carry'); }],
  ['body scan', f => () => f.ctx.bodyScanRecord()]
];
for (const [name, prepare] of deletionEdits) test(`15c ${name}: failure restores Blocks and editable context; retry succeeds`, async () => {
  const f = await deletionFixture(), execute = prepare(f), before = clone(f.ctx.state);
  const blocks = f.ctx.state.blocks, rules = f.ctx.state.recurrences;
  const ritual = f.ctx._migrationRitualCtx, scan = f.ctx._pendingBodyScanCtx, draft = clone(f.ctx._scheduleDraft);
  await withLocalSaveFailure(async (fail, injection) => {
    f.fail(fail);
    assert.equal(execute(), false);
    assert.equal(injection.calls, 1);
    assert.equal(f.ctx.state.blocks, blocks);
    assert.equal(f.ctx.state.recurrences, rules);
    expectRestored(before.blocks, clone(f.ctx.state.blocks));
    expectRestored(before.recurrences, clone(f.ctx.state.recurrences));
    assert.equal(f.ctx.state.dataModifiedAt, before.dataModifiedAt);
    assert.equal(f.ctx._migrationRitualCtx, ritual);
    assert.equal(f.ctx._pendingBodyScanCtx, scan);
    expectRestored(draft, clone(f.ctx._scheduleDraft));
    assert.equal(f.counts.render + f.counts.close + f.counts.timer + f.counts.autoSync + f.counts.autoSave, 0);
    if (name === 'body scan') assert.equal(f.ctx.state.bodyScans.length, 1); // related record retains its original position
    f.fail(null);
    execute();
    assert.equal(f.ctx.state.blocks[0].updatedAt, '2026-09-10T10:05:01');
    assert.equal(f.ctx.state.blocks[0].createdAt, before.blocks[0].createdAt);
    assert.deepEqual(f.persisted[0].blocks, clone(f.ctx.state.blocks));
    assert.deepEqual(clone(f.ctx.state.blocks[1]), before.blocks[1]);
    if (name === 'series deletion') {
      const { configureRecurrence, recurrenceMatchesDate } = await import('../src/core/recurrence.js');
      configureRecurrence({ parseDate: value => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); } });
      assert.equal(f.ctx.state.blocks[0].deleted, true);
      assert.deepEqual(clone(f.ctx.state.recurrences[0].exceptionDates), [DATE]);
      assert.equal(f.ctx.state.recurrences[0].updatedAt, '2026-09-10T10:05:01');
      assert.equal(recurrenceMatchesDate(f.ctx.state.recurrences[0], DATE), false);
      assert.equal(recurrenceMatchesDate(f.ctx.state.recurrences[0], '2026-09-17'), true);
      assert.deepEqual(f.persisted[0].recurrences, clone(f.ctx.state.recurrences));
      assert.equal(f.counts.writes, 2);
    } else if (name.includes('carry') || name === 'ritual today') {
      const carried = f.ctx.state.blocks.find(b => b.id === f.ctx.state.blocks[0].migratedTo);
      assert.ok(carried);
      assert.equal(carried.carryCount, 1);
      // 監督者 2026-09-10: 非MIT の表現は既存どおり未設定(undefined)も可。MIT かどうかの真偽だけを検査する。
      assert.equal(Boolean(carried.isMIT), name === 'ritual today');
    } else if (name === 'release') assert.equal(f.ctx.state.blocks[0].deleted, true);
    else assert.equal(f.ctx.state.blocks[0].comment, 'typed scan');
  });
});

test('15c repeated deletion and unchanged scan do not stamp Blocks again', async () => {
  const f = await deletionFixture();
  f.ctx.deleteBlock('b');
  const block = clone(f.ctx.state.blocks[0]), writes = f.counts.writes;
  f.ctx.deleteBlock('b');
  assert.equal(f.counts.writes, writes);
  f.ctx._pendingBodyScanCtx.comment = block.comment;
  f.ctx.bodyScanRecord();
  expectRestored(block, clone(f.ctx.state.blocks[0]));
});
const NOW = '2026-09-10T10:00:00', FUTURE = '2026-09-10T10:05:00', DATE = NOW.slice(0, 10);

async function f5RemainingFixture() {
  const f = await fixture(['remainingBlocks', 'adjustRemainingBlocks', 'renderRemainingActions']);
  Object.assign(f.ctx, { minutesOf: dt => Number(dt.slice(11, 13)) * 60 + Number(dt.slice(14, 16)),
    nowDateTime: () => NOW, addDays: () => '2026-09-11', window: { confirm: text => { f.confirmation = text; return true; } } });
  f.ctx.state.blocks = [
    { id: 'a', plannedStartAt: DATE + 'T08:00:00', plannedEndAt: DATE + 'T08:30:00', isMIT: true, comment: 'keep plan' },
    { id: 'b', plannedStartAt: DATE + 'T09:00:00', plannedEndAt: DATE + 'T23:50:00' },
    { id: 'running', actualStartAt: DATE + 'T09:00:00', plannedStartAt: DATE + 'T09:00:00' },
    { id: 'future', plannedStartAt: DATE + 'T11:00:00' },
    { id: 'done', completed: true, plannedStartAt: DATE + 'T09:00:00' },
    { id: 'moved', migratedTo: 'old-copy', plannedStartAt: DATE + 'T09:00:00' }
  ].map(b => ({ ...f.ctx.makeBlock({ date: DATE, title: b.id }), ...b }));
  return f;
}

async function f5OverlapSetup(page, timer = false) {
  await page.evaluate(timer => {
    const api = window.__f5, s = api.getState();
    s.blocks = [api.makeBlock({ date: '2026-09-10', title: '前の予定', actualStartAt: '2026-09-10T09:00:00' }),
      api.makeBlock({ date: '2026-09-10', title: '次の予定', plannedStartAt: '2026-09-10T10:00:00' })];
    s.declarations = []; s.pomodoro.running = false;
    window.__f5Save.writes = 0;
    if (timer) api.startPomodoro(s.blocks[1].id); else api.openDeclareModal(s.blocks[1].id, 'block');
  }, timer);
}

async function f5ReasonsSetup(page, mode = 'dailyClose') {
  await page.evaluate(mode => {
    const api = window.__f5, s = api.getState();
    s.blocks = Array.from({ length: 3 }, (_, i) => api.makeBlock({ date: '2026-09-10', title: `未完了${i + 1}` }));
    api.openIncompleteReasonModal(s.blocks.map(b => b.id), mode);
    window.__f5Save.writes = 0;
  }, mode);
}

test('F5-4 daily close lists all Blocks, saves selected rows once and leaves triage sequential', async () => {
  await f5Browser(async page => {
    await f5ReasonsSetup(page);
    const rows = page.locator('[data-reason-block]');
    assert.equal(await rows.count(), 3);
    assert.equal(await rows.first().locator('[data-chip]').count(), 6);
    for (const i of [0, 1]) {
      await rows.nth(i).locator('[data-chip]').first().click();
      await rows.nth(i).locator('input').fill(`理由${i}`);
    }
    assert.equal(await page.evaluate(() => window.__f5Save.writes), 0);
    await page.locator('[data-action="incomplete-reason-save"]').click();
    const result = await page.evaluate(() => ({ blocks: window.__f5.getState().blocks,
      writes: window.__f5Save.writes, modal: window.__f5.getState().modal }));
    assert.equal(result.writes, 1);
    assert.equal(result.blocks[0].incompleteReason.note, '理由0');
    assert.equal(result.blocks[1].incompleteReason.note, '理由1');
    assert.equal(result.blocks[0].incompleteReason.at, NOW);
    assert.ok(!result.blocks[2].incompleteReason?.chip);
    assert.equal(result.modal.type, 'writeMeditationGate');
    await f5ReasonsSetup(page);
    await page.locator('[data-action="incomplete-reason-skip"]').click();
    assert.equal(await page.evaluate(() => window.__f5Save.writes), 0);
    assert.equal(await page.evaluate(() => window.__f5.getState().modal.type), 'writeMeditationGate');
    await f5ReasonsSetup(page, 'triage');
    assert.equal(await page.locator('[data-incomplete-reason-note]').count(), 1);
    await page.locator('[data-action="incomplete-reason-chip"]').first().click();
    assert.equal(await page.evaluate(() => window.__f5Save.writes), 1);
    assert.match(await page.locator('#modalRoot').innerText(), /未完了2/);
  });
});

test('F5-4 failed reason bundle restores all Blocks and keeps every typed note and chip for retry', async () => {
  await f5Browser(async page => {
    await f5ReasonsSetup(page);
    const rows = page.locator('[data-reason-block]');
    for (const i of [0, 1]) {
      await rows.nth(i).locator('[data-chip]').first().click();
      await rows.nth(i).locator('input').fill(`保持${i}`);
    }
    const before = await page.evaluate(() => JSON.stringify(window.__f5.getState()));
    await page.evaluate(() => { window.__f5Save.fail = true; });
    await page.locator('[data-action="incomplete-reason-save"]').click();
    assert.equal(await page.evaluate(() => JSON.stringify(window.__f5.getState())), before);
    assert.equal(await page.evaluate(() => window.__f5Save.writes), 1);
    for (const i of [0, 1]) {
      assert.equal(await rows.nth(i).locator('input').inputValue(), `保持${i}`);
      assert.equal(await rows.nth(i).locator('[aria-pressed="true"]').count(), 1);
    }
    await page.evaluate(() => { window.__f5Save.fail = false; });
    await page.locator('[data-action="incomplete-reason-save"]').click();
    assert.equal(await page.evaluate(() => window.__f5Save.writes), 2);
  });
});

test('F5-3 overlap offers end, parallel and cancel; linked timer uses the same choice', async () => {
  await f5Browser(async page => {
    for (const choice of ['end', 'parallel', 'cancel', 'timer']) {
      await f5OverlapSetup(page, choice === 'timer');
      assert.match(await page.locator('#modalRoot').innerText(), /前の予定/);
      assert.equal(await page.evaluate(() => window.__f5Save.writes), 0);
      await page.locator(`[data-action="start-overlap-choice"][data-choice="${choice === 'timer' ? 'end' : choice}"]`).click();
      if (choice === 'end' || choice === 'parallel') {
        await page.locator('[data-declare-note]').fill('宣言は保持');
        await page.locator('[data-action="declare-confirm"]').click();
      }
      const result = await page.evaluate(() => ({ blocks: window.__f5.getState().blocks,
        declarations: window.__f5.getState().declarations, writes: window.__f5Save.writes, timer: window.__f5.getState().pomodoro }));
      assert.equal(result.blocks[0].completed, false);
      assert.equal(result.blocks[0].actualEndAt, ['end', 'timer'].includes(choice) ? NOW : '');
      assert.equal(result.blocks[1].actualStartAt, choice === 'cancel' ? '' : NOW);
      assert.equal(result.writes, choice === 'cancel' ? 0 : choice === 'parallel' ? 1 : 2);
      if (choice === 'end' || choice === 'parallel') assert.equal(result.declarations[0].note, '宣言は保持');
      if (choice === 'timer') assert.equal(result.timer.blockId, result.blocks[1].id);
    }
  });
});

test('F5-3 failed previous end restores both Blocks and does not start the next timer', async () => {
  await f5Browser(async page => {
    await f5OverlapSetup(page, true);
    const before = await page.evaluate(() => JSON.stringify(window.__f5.getState()));
    await page.evaluate(() => { window.__f5Save.fail = true; });
    await page.locator('[data-action="start-overlap-choice"][data-choice="end"]').click();
    assert.equal(await page.evaluate(() => JSON.stringify(window.__f5.getState())), before);
    assert.equal(await page.evaluate(() => window.__f5Save.writes), 1);
    assert.equal(await page.locator('[data-action="start-overlap-choice"][data-choice="end"]').count(), 1);
    await page.evaluate(() => { window.__f5Save.fail = false; });
    await page.locator('[data-action="start-overlap-choice"][data-choice="end"]').click();
    assert.equal(await page.evaluate(() => window.__f5Save.writes), 3);
    assert.equal(await page.evaluate(() => window.__f5.getState().blocks[1].actualStartAt), NOW);
  });
});

test('F5-2 remaining plans shift together or carry together, excluding running, done and future Blocks', async () => {
  for (const tomorrow of [false, true]) {
    const f = await f5RemainingFixture(), before = clone(f.ctx.state.blocks);
    assert.equal(f.ctx.adjustRemainingBlocks(tomorrow), true);
    assert.match(f.confirmation, /2件/);
    assert.equal(f.counts.writes, 1);
    assert.deepEqual(clone(f.ctx.state.blocks.slice(2, 6)), before.slice(2));
    if (tomorrow) {
      const copies = f.ctx.state.blocks.slice(6);
      assert.equal(copies.length, 2);
      assert.equal(copies[0].date, '2026-09-11');
      assert.equal(copies[0].plannedStartAt, '2026-09-11T08:00:00');
      assert.equal(copies[0].comment, 'keep plan');
      assert.equal(copies[0].isMIT, false);
      assert.equal(copies[0].carryCount, 1);
      assert.equal(f.ctx.state.blocks[0].migratedTo, copies[0].id);
      assert.match(f.ctx.renderRemainingActions(), /disabled/);
    } else {
      assert.equal(f.ctx.state.blocks[0].plannedStartAt, DATE + 'T10:00:00');
      assert.equal(f.ctx.state.blocks[0].plannedEndAt, DATE + 'T10:30:00');
      assert.equal(f.ctx.state.blocks[1].plannedStartAt, DATE + 'T11:00:00');
      assert.equal(f.ctx.state.blocks[1].plannedEndAt, DATE + 'T23:55:00');
    }
    f.ctx.state.selectedDate = '2026-09-11';
    assert.equal(f.ctx.renderRemainingActions(), '');
  }
});

test('F5-2 failed batch restores every Block and creates no carry copy or success effect', async () => {
  for (const tomorrow of [false, true]) {
    const f = await f5RemainingFixture(), before = clone(f.ctx.state);
    await withLocalSaveFailure(async fail => {
      f.fail(fail);
      assert.equal(f.ctx.adjustRemainingBlocks(tomorrow), false);
      expectRestored(before, clone(f.ctx.state));
      assert.equal(f.counts.writes, 1);
      assert.equal(f.counts.render + f.counts.autoSync, 0);
      assert.ok(f.ctx.lastToast);
    });
  }
});

test('F1-2 MIT replacement commits both Blocks once; failed save restores both, including modal entry', async () => {
  for (const entry of ['toggle', 'modal']) {
    const f = await fixture(['toggleMIT']);
    f.ctx.state.blocks[1].isMIT = true;
    f.ctx.state.blocks.push({ ...clone(f.ctx.state.blocks[1]), id: 'tomorrow', date: '2026-09-11' });
    const before = clone(f.ctx.state), input = { ...fields(f), isMIT: true };
    const execute = () => entry === 'toggle' ? f.ctx.toggleMIT('b') : f.ctx.saveBlockFromModal('b', input);
    await withLocalSaveFailure(async fail => {
      f.fail(fail); assert.equal(execute(), false); expectRestored(before, clone(f.ctx.state));
      assert.equal(f.counts.writes, 1); assert.equal(f.counts.autoSync, 0);
      f.fail(null); assert.equal(execute(), true);
    });
    assert.equal(f.counts.writes, 2); assert.equal(f.persisted.length, 1);
    assert.deepEqual(f.persisted[0].blocks.filter(b => b.date === DATE && b.isMIT).map(b => b.id), ['b']);
    assert.deepEqual(f.persisted[0].blocks, clone(f.ctx.state.blocks));
    for (const index of [0, 1])
      assert.ok(f.persisted[0].blocks[index].updatedAt > before.blocks[index].updatedAt);
    assert.deepEqual(f.persisted[0].blocks[2], before.blocks[2]);
  }
});

test('F1-2 legacy duplicate MITs display only the first per day without changing saved data', async () => {
  const { workListRows } = await import('../src/core/work-list.js');
  const f = await fixture();
  f.ctx.state.blocks.forEach(b => { b.isMIT = true; });
  f.ctx.state.blocks.push({ ...clone(f.ctx.state.blocks[1]), id: 'tomorrow', date: '2026-09-11' });
  const before = clone(f.ctx.state);
  const rows = workListRows(f.ctx.state, { scope: 'exec', date: DATE, mode: 'upcoming' });
  assert.deepEqual(rows.filter(r => r.item.isMIT).map(r => r.id), ['b', 'tomorrow']);
  expectRestored(before, clone(f.ctx.state));
  const toggle = vm.runInContext(functions(['toggleMIT']) + '\n toggleMIT', f.ctx);
  assert.equal(toggle('other'), true);
  assert.deepEqual(f.persisted[0].blocks.filter(b => b.date === DATE && b.isMIT).map(b => b.id), ['other']);
});

test('F1-4 actual entry defaults cap future plans at now and starts at end without saving', async () => {
  const f = await fixture(['completeBlockWithActual']);
  f.ctx.buildActualEntryModal = (block, start, end) => ({ start, end });
  for (const [plannedStart, plannedEnd, actualStart, actualEnd, start, end] of [
    ['09:00:00', '13:30:00', '', '', '09:00:00', '10:00:00'],
    ['11:00:00', '13:30:00', '', '', '10:00:00', '10:00:00'],
    ['08:00:00', '09:00:00', '', '', '08:00:00', '09:00:00'],
    ['', '', '', '', '10:00:00', '10:00:00'],
    ['', '09:00:00', '09:30:00', '', '09:30:00', '10:00:00'],
    ['08:00:00', '13:30:00', '', '09:45:00', '', '09:45:00'],
    ['08:00:00', '13:30:00', '08:15:00', '09:45:00', '08:15:00', '09:45:00']
  ]) {
    const at = value => value ? `${DATE}T${value}` : '';
    Object.assign(f.ctx.state.blocks[0], { plannedStartAt: at(plannedStart), plannedEndAt: at(plannedEnd),
      actualStartAt: at(actualStart), actualEndAt: at(actualEnd) });
    const before = clone(f.ctx.state.blocks);
    f.ctx.completeBlockWithActual('b');
    assert.deepEqual(f.ctx.displayedBlock, { start: at(start), end: at(end) });
    expectRestored(before, clone(f.ctx.state.blocks));
  }
  assert.equal(f.counts.writes, 0);
});

test('fixV404c delayed start at or after planned end defaults to now without saving', async () => {
  const f = await fixture(['completeBlockWithActual']);
  f.ctx.buildActualEntryModal = (block, start, end) => ({ start, end });
  for (const time of ['09:00:00', '09:30:00', '10:30:00']) {
    const start = DATE + 'T' + time;
    Object.assign(f.ctx.state.blocks[0], { plannedEndAt: DATE + 'T09:00:00', actualStartAt: start, actualEndAt: '' });
    const before = clone(f.ctx.state.blocks);
    f.ctx.completeBlockWithActual('b');
    assert.deepEqual(f.ctx.displayedBlock, { start: start > NOW ? NOW : start, end: NOW });
    expectRestored(before, clone(f.ctx.state.blocks));
  }
  assert.equal(f.counts.writes, 0);
});

test('F1-4 capped actual defaults use the existing atomic save and rollback path', async () => {
  const f = await lifecycleFixture();
  vm.runInContext(functions(['completeBlockWithActual']), f.ctx);
  f.ctx.buildActualEntryModal = (block, actualStartAt, actualEndAt) => ({ actualStartAt, actualEndAt });
  f.ctx.completeBlockWithActual('b');
  const input = { ...f.ctx.displayedBlock, charge: '0', discharge: '0', comment: 'F1-4' }, before = clone(f.ctx.state);
  assert.equal(input.actualEndAt, NOW);
  await withLocalSaveFailure(async fail => {
    f.fail(fail); assert.equal(f.ctx.saveActualEntryFromModal('b', input), false);
    expectRestored(before, clone(f.ctx.state));
    assert.equal(f.counts.autoSync, 0); assert.equal(f.counts.writes, 1);
    f.fail(null); assert.equal(f.ctx.saveActualEntryFromModal('b', input), true);
  });
  assert.equal(f.persisted.length, 1); assert.equal(f.counts.writes, 2);
  assert.equal(f.persisted[0].blocks[0].actualEndAt, NOW);
  assert.equal(f.persisted[0].blocks[0].completed, true);
});

async function pomodoroFixture() {
  const f = await fixture(['recordBlockInterruption', 'stopPomodoro', 'completePomodoro',
    'goBreakPomodoro', 'recordIncompleteReasonChip']);
  f.ctx.state.blocks[0].actualStartAt = `${DATE}T09:00:00`;
  f.ctx.state.pomodoro = { running: true, blockId: 'b', mode: 'focus',
    startedAt: `${DATE}T09:00:00`, endsAt: `${DATE}T10:30:00`, paused: false };
  Object.assign(f.ctx, {
    _pendingInterruptBlockId: 'b', _pendingIncompleteReasonCtx: { queue: ['b'] },
    dateToLocalDateTime: date => date.toISOString().slice(0, 19),
    advanceIncompleteReasonQueue: () => { f.ctx._pendingIncompleteReasonCtx.queue.shift(); f.counts.close++; },
    skipIncompleteReasonModal: () => { throw Error('unexpected skip'); },
    openBodyScanModal: () => f.ctx.draftSaveTransaction.defer(() => f.counts.close++)
  });
  f.note = { value: 'typed reason' };
  f.ctx.modalRoot.querySelector = () => f.note;
  return f;
}
const pomodoroEdits = [
  ['interruption', f => f.ctx.recordBlockInterruption('b', 'fatigue')],
  ['stop', f => f.ctx.stopPomodoro()],
  ['complete', f => f.ctx.completePomodoro()],
  ['break', f => f.ctx.goBreakPomodoro()],
  ['incomplete reason', f => f.ctx.recordIncompleteReasonChip('fatigue')]
];
for (const [name, execute] of pomodoroEdits) test(`15d ${name}: failure retains Block, timer and input; retry commits`, async () => {
  const f = await pomodoroFixture(), before = clone(f.ctx.state), blocks = f.ctx.state.blocks;
  const queue = clone(f.ctx._pendingIncompleteReasonCtx), pending = f.ctx._pendingInterruptBlockId;
  await withLocalSaveFailure(async (fail, injection) => {
    f.fail(fail);
    assert.equal(execute(f), false);
    assert.equal(injection.calls, 1);
    assert.equal(f.ctx.state.blocks, blocks);
    expectRestored(before, clone(f.ctx.state));
    expectRestored(queue, clone(f.ctx._pendingIncompleteReasonCtx));
    assert.equal(f.ctx._pendingInterruptBlockId, pending);
    assert.equal(f.note.value, 'typed reason');
    assert.equal(f.counts.render + f.counts.close + f.counts.tracking + f.counts.autoSync + f.counts.autoSave, 0);
    f.fail(null);
    assert.equal(execute(f), true);
    const block = f.ctx.state.blocks[0];
    assert.equal(block.updatedAt, '2026-09-10T10:05:01');
    assert.equal(block.createdAt, before.blocks[0].createdAt);
    assert.deepEqual(f.persisted[0].blocks, clone(f.ctx.state.blocks));
    assert.deepEqual(clone(f.ctx.state.blocks[1]), before.blocks[1]);
    if (name === 'interruption') assert.deepEqual(clone(block.interruptions), [{ at: NOW, reason: 'fatigue' }]);
    if (name === 'stop') { assert.equal(block.actualStartAt, ''); assert.equal(f.ctx.state.pomodoro.running, false); }
    if (name === 'complete') { assert.equal(block.completed, true); assert.equal(block.actualEndAt, NOW); assert.equal(block.pomodoroCount, 1); }
    if (name === 'break') { assert.equal(block.pomodoroCount, 1); assert.equal(f.ctx.state.pomodoro.mode, 'break'); assert.equal(f.ctx.state.pomodoro.running, true); }
    if (name === 'incomplete reason') { assert.deepEqual(clone(block.incompleteReason), { chip: 'fatigue', note: 'typed reason', at: NOW }); assert.equal(f.ctx._pendingIncompleteReasonCtx.queue.length, 0); }
  });
});

test('15d all five writers alternate with candidate edits in the same second', async () => {
  const { mergeById } = await import('../src/core/merge.js');
  for (const [, execute] of pomodoroEdits) {
    const f = await pomodoroFixture();
    execute(f);
    const older = clone(f.ctx.state.blocks[0]);
    f.ctx.commitBlockChanges(f.ctx.state.blocks.map(b => b.id === 'b' ? { ...b, comment: 'candidate' } : b));
    const candidate = clone(f.ctx.state.blocks[0]);
    f.ctx.updateBlockField('b', 'comment', 'latest');
    const latest = clone(f.ctx.state.blocks[0]);
    assert.ok(latest.updatedAt > candidate.updatedAt && candidate.updatedAt > older.updatedAt);
    assert.deepEqual(mergeById([older, candidate], [latest]), [latest]);
    assert.equal(latest.actualStartAt, older.actualStartAt);
    assert.equal(latest.actualEndAt, older.actualEndAt);
  }
});

test('15d interruption click retains its reason picker after a failed Block save', async () => {
  const f = await pomodoroFixture();
  let action;
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Property' && node.key.value === 'interrupt-reason') action = node.value;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
  assert.ok(action, 'actual delegated interruption action');
  const click = vm.runInContext(`(${source.slice(action.start, action.end)})`, f.ctx);
  const before = clone(f.ctx.state);
  await withLocalSaveFailure(async fail => {
    f.fail(fail);
    click({ target: { dataset: { reason: 'fatigue' } } });
    expectRestored(before, clone(f.ctx.state));
    assert.equal(f.ctx._pendingInterruptBlockId, 'b', 'failed save must retain the editable reason picker');
    assert.equal(f.counts.writes, 1, 'failed interruption must not proceed to stopPomodoro');
  });
});

async function fixture(extraNames = []) {
  const core = await import('../src/core/commit.js');
  core.setCommitGuard(deepCommitGuard);
  const { stamped } = await import('../src/core/mutation-stamp.js');
  const { createDraftSaveTransaction } = await import('../src/features/draft-save.js');
  const { buildBlockDetailDraft } = await import('../src/features/block-detail.js');
  const { commitLifecycleDraft } = await import('../src/features/lifecycle-save.js');
  // fixV398(監督者追随 2026-09-13): lifecycleSaveDeps が日報再生成を登録表の行 daily-report-refresh 経由にしたため実物の登録表を砂場へ渡す(製品変更なし)。
  const { runDailyOperation, DAILY_OPERATIONS } = await import('../src/features/daily-operations.js');
  // v388 契約追随(監督者決定 2026-09-11、束B8 41c+fixB8): confirmScheduleDraft が daily-gap-placement.js の validatePlannedDraft / gapWarning を呼ぶため実物を砂場へ渡す(製品変更なし、design/CHANGELOG.md)。
  const { validatePlannedDraft, gapWarning } = await import('../src/features/daily-gap-placement.js');
  const clock = fixedClock(Date.UTC(2026, 8, 10, 10));
  const counts = { writes: 0, autoSave: 0, autoSync: 0, render: 0, close: 0, timer: 0, tracking: 0 };
  let failure, raw, id = 0;
  const persisted = [];
  const ctx = vm.createContext({ ...core, stamped, createDraftSaveTransaction, validatePlannedDraft, gapWarning, console: { error() {} },
    // v393: run the real detail builder; lifecycleFixture supplies the full app wiring.
    buildBlockDetailDraft, commitLifecycleDraft, runDailyOperation, DAILY_OPERATIONS, dailyOperationDeps: {},
    _quickCompleteSnapshots: {}, _pendingInterruptBlockId: null,
    dailyReading: { open() {}, close() {}, current: () => null },
    recurrenceMatchesDate: () => false, makeRecurrenceInstance: () => null,
    isDailyReadingBlock: () => false, markDailyReadingEdit: value => value,
    zeroConnectionKey: () => 'fixture-connection', feedbackUiController: null, feedbackReportController: null,
    nowDateTime: () => new Date(clock()).toISOString().slice(0, 19), todayISO: () => DATE,
    draftSaveTransaction: null, _lastSaveError: null, _quotaToastShown: false, _blockSaveInFlight: false,
    _scheduleDraft: null, _draftUndo: { retained: true }, MIGRATION_RITUAL_THRESHOLD: 3,
    crypto: { randomUUID: () => `new-${++id}` },
    setState: value => { ctx.state = value; },
    persistLocalNoSchedule: () => {
      counts.writes++;
      ctx._lastSaveError = null;
      try { failure?.(); raw = JSON.stringify(ctx.state); persisted.push(JSON.parse(raw)); } catch (error) { ctx._lastSaveError = error; }
    },
    scheduleAutoSave: () => counts.autoSave++, scheduleAutoSync: () => counts.autoSync++,
    showToast: message => { ctx.lastToast = message; },
    render: () => { if (!ctx.draftSaveTransaction?.defer(() => ctx.render())) counts.render++; },
    closeModal: () => { if (!ctx.draftSaveTransaction?.defer(() => ctx.closeModal())) { counts.close++; ctx.state.modal = null; } },
    fromLocalInput: value => value ? (value.length === 16 ? `${value}:00` : value) : '',
    stampEverStarted: b => ({ ...b, everStartedAt: b.everStartedAt || b.actualStartAt || '' }),
    habitStreakEdit: () => ({ ok: true, value: '' }),
    syncHabitStreakForBlock() {}, transferIronLogToCompletedBlock() {}, generateReport() {},
    trackOnBlockStarted: () => ctx.draftSaveTransaction.defer(() => counts.tracking++),
    trackOnBlockCompletionChanged: () => ctx.draftSaveTransaction.defer(() => counts.tracking++),
    autoCloseStaleRoutineRuns() {}, openBodyScanModal() {},
    blockById: id => ctx.state.blocks.find(b => b.id === id),
    minToHHMM: min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`,
    pad2: n => String(n).padStart(2, '0'), migrationNextCount: () => 1,
    renderModal: block => { ctx.displayedBlock = block; }, buildBlockModal: b => b,
    setTimeout: callback => { callback(); }, modalRoot: { querySelector: selector =>
      selector === '[data-modal-field="taskCompleted"]' ? null : ({ focus() {} }) }
  });
  vm.runInContext(functions(['makeBlock', 'openTimelineNewBlock', 'commitBlockChanges', 'updateBlockField',
    'runLifecycleChange', 'lifecycleSaveDeps',
    'updateCategoryField', 'confirmScheduleDraft', 'saveBlockFromModal', 'saveState', 'saveAndRender', ...extraNames]), ctx);
  ctx.state = { blocks: [], singleSchedules: [] /* v388 契約追随: normalizeState が常に配列へ揃える前提(未取得は配置停止)。監督者決定 2026-09-11 */, tasks: [{ id: 'task', category: 'work', status: 'todo', updatedAt: NOW }],
    projects: [{ id: 'project', category: 'work', updatedAt: NOW }],
    recurrences: [{ id: 'rule', category: 'work', updatedAt: NOW }],
    weeklyCommitments: [{ id: 'week', updatedAt: NOW }],
    settings: { categories: [{ id: 'cat', name: 'work' }], lastPushedAt: FUTURE },
    reports: {}, pomodoro: { running: false }, selectedDate: DATE, dataModifiedAt: NOW, modal: { type: 'block', id: 'b' } };
  ctx.state.blocks = [{ ...ctx.makeBlock({ title: 'saved', category: 'work',
    plannedStartAt: `${DATE}T09:00:00`, plannedEndAt: `${DATE}T11:00:00` }), id: 'b', updatedAt: FUTURE },
  { ...ctx.makeBlock({ title: 'unrelated', category: 'other' }), id: 'other' }];
  const init = ast.body.find(n => n.type === 'ExpressionStatement' && n.expression.left?.name === 'draftSaveTransaction');
  vm.runInContext(source.slice(init.start, init.end), ctx);
  raw = JSON.stringify(ctx.state);
  return { ctx, counts, persisted, raw: () => raw, fail: fn => { failure = fn; } };
}

function fields(f) {
  return { ...clone(f.ctx.state.blocks[0]), title: 'typed title', recurrenceKind: '__keep__' };
}
const edits = [
  ['field', f => () => f.ctx.updateBlockField('b', 'comment', 'typed comment')],
  ['category', f => () => f.ctx.updateCategoryField('cat', 'name', 'renamed')],
  ['modal edit', f => { const input = fields(f); f.input = input; return () => f.ctx.saveBlockFromModal('b', input); }],
  ['modal create', f => { const input = fields(f); f.input = input; return () => f.ctx.saveBlockFromModal('fresh', input); }],
  ['draft update/create/carry', f => {
    f.ctx._scheduleDraft = { date: DATE, items: [{ id: 'd1', blockId: 'b', start: 630, minutes: 30 },  // v388 契約追随: 実物の下書き項目は必ず id を持つ(app.js _scheduleDraft の定義)。新しい占有検査は id 無しを拒否(監督者決定 2026-09-11)
      { id: 'd2', title: 'new', start: 700, minutes: 20, carryFromId: 'b' }] };
    return () => f.ctx.confirmScheduleDraft();
  }]
];
for (const [name, prepare] of edits) test(`${name}: failure restores state/input; explicit retry commits once`, async () => {
  const f = await fixture(), execute = prepare(f), before = clone(f.ctx.state), input = clone(f.input || {});
  const draft = f.ctx._scheduleDraft, undo = f.ctx._draftUndo, reference = f.ctx.state;
  await withLocalSaveFailure(async (fail, injection) => {
    f.fail(fail);
    assert.equal(execute(), false);
    assert.equal(injection.calls, 1);
    assert.match(f.ctx.lastToast, /端末.*保存/);
    expectRestored(before, clone(f.ctx.state));
    expectRestored(before, JSON.parse(f.raw()));
    expectRestored(input, clone(f.input || {}));
    assert.equal(f.ctx.state, reference);
    assert.equal(f.ctx._scheduleDraft, draft);
    assert.equal(f.ctx._draftUndo, undo);
    assert.equal(f.counts.close + f.counts.render + f.counts.autoSync + f.counts.autoSave + f.counts.timer, 0);
    f.fail(null);
    assert.equal(execute(), true);
    assert.equal(f.counts.writes, 2);
    assert.equal(f.counts.autoSync, 1);
    assert.equal(f.counts.autoSave, 1);
    assert.ok(f.ctx.state.dataModifiedAt > FUTURE);
    const changed = f.ctx.state.blocks.filter(b => !before.blocks.some(old => JSON.stringify(old) === JSON.stringify(b)));
    assert.ok(changed.length > 0);
    assert.ok(changed.every(b => b.updatedAt > (before.blocks.find(old => old.id === b.id)?.updatedAt || NOW)));
    assert.deepEqual(clone(f.ctx.state.blocks.find(b => b.id === 'other')), before.blocks[1]);
    assert.deepEqual(JSON.parse(f.raw()).blocks, clone(f.ctx.state.blocks));
  });
});

test('same-second legacy and candidate edits alternate; latest wins and observations stay unchanged', async () => {
  const f = await fixture(), { mergeById } = await import('../src/core/merge.js');
  f.ctx.state.blocks[0].actualStartAt = `${DATE}T09:13:00`;
  f.ctx.state.blocks[0].everStartedAt = `${DATE}T09:13:00`;
  const history = [];
  for (const execute of [() => f.ctx.updateBlockField('b', 'comment', 'first'),
    () => f.ctx.commitBlockChanges(f.ctx.state.blocks.map(b => b.id === 'b' ? { ...b, title: 'candidate' } : b)),
    () => f.ctx.saveBlockFromModal('b', fields(f)),
    () => f.ctx.updateCategoryField('cat', 'name', 'latest')]) {
    const previous = clone(f.ctx.state.blocks[0]);
    assert.equal(execute(), true);
    const current = clone(f.ctx.state.blocks[0]);
    assert.ok(current.updatedAt > previous.updatedAt);
    assert.equal(current.actualStartAt, previous.actualStartAt);
    assert.equal(current.createdAt, previous.createdAt);
    assert.equal(current.everStartedAt, previous.everStartedAt);
    history.push(previous);
    assert.deepEqual(mergeById([current], history), [current]);
    assert.deepEqual(mergeById(history, [current]), [current]);
  }
});

test('no content change issues no stamp, write or sync reservation', async () => {
  const f = await fixture(), before = clone(f.ctx.state);
  assert.equal(f.ctx.updateBlockField('b', 'title', 'saved'), true);
  assert.equal(f.ctx.updateCategoryField('cat', 'name', 'work'), true);
  expectRestored(before, clone(f.ctx.state));
  assert.equal(f.counts.writes + f.counts.autoSync, 0);
});

test('invalid modal input remains editable and is never persisted', async () => {
  const f = await fixture(), input = { ...fields(f), plannedStartAt: '' }, before = clone(f.ctx.state);
  assert.equal(f.ctx.saveBlockFromModal('b', input), false);
  expectRestored(before, clone(f.ctx.state));
  assert.equal(input.title, 'typed title');
  assert.equal(f.counts.writes + f.counts.close + f.counts.autoSync, 0);
});

test('factories keep unsaved timeline input out of state; persistence owns the stamp', async () => {
  const f = await fixture(), before = clone(f.ctx.state.blocks);
  f.ctx.openTimelineNewBlock(1440);
  const block = f.ctx.displayedBlock;
  assert.equal(block.plannedStartAt, `${DATE}T23:00:00`);
  assert.equal(block.plannedEndAt, `${DATE}T23:59:00`);
  assert.equal(block.createdAt, NOW);
  expectRestored(before, clone(f.ctx.state.blocks));
  assert.equal(f.counts.writes, 0);
  assert.equal(f.ctx.saveBlockFromModal(block.id, { ...block, title: 'timeline' }), true);
  assert.equal(f.counts.writes, 1);
  assert.ok(f.ctx.state.blocks.find(b => b.id === block.id).updatedAt > NOW);
});

async function lifecycleFixture() {
  const f = await fixture(['setBlockTime', 'resumeLifecycleStart', 'offerStartOverlap', 'toggleBlock', 'autoCloseStaleRoutineRuns',
    'weekRange', 'candidateBlocksForWeek', 'commitmentItemForBlock', 'parseDate', 'addDays',
    'dateToISO', 'dateToLocalDateTime', 'localDateTimeToMs',
    'saveActualEntryFromModal', 'toggleTaskCompleteFromBlock', 'bulkApproveAsPlanned',
    'completedTaskRecord']); // v385: extracted production dependency; assertions unchanged
  Object.assign(f.ctx, {
    runDailyOperation: (await import('../src/features/daily-operations.js')).runDailyOperation,
    mergeWeeklyCommitments: (await import('../src/core/merge.js')).mergeWeeklyCommitments,
    ...await import('../src/core/track.js'),
    queueMicrotask: callback => callback(),
    maybeShowGuidedAccessHint: () => { f.counts.guidedAccess = (f.counts.guidedAccess || 0) + 1; },
    _quickCompleteSnapshots: {}, requestDraftLeave: () => false,
    resetPomodoroForBlock: () => f.counts.timer++, forceResetPomodoroSession() {},
    startPomodoro: () => { f.counts.timer++; f.ctx.state.pomodoro.running = true; },
    quickCompleteActualStart: b => b.plannedStartAt,
    prefillEnergy: () => null, triggerAnchorPlacements() {}, getRandomCelebrate: () => 'done',
    triggerCompletionEffect() {}, fillProgressOnComplete: () => 1,
    maybeQueueNextAiStep() {}, closeAiStepConfirmIfUndone() {}, rerenderActiveModal() {},
    isStaleBlock: () => false, window: { confirm: () => true }, completePomodoro: () => f.counts.timer++
  });
  vm.runInContext(functions(['resetPomodoroForBlock']), f.ctx);
  const wiring = ast.body.filter(n => n.type === 'VariableDeclaration'
    && n.declarations.some(d => ['dailyOperationDeps', 'COMMITMENT_SOURCE_PRIORITY'].includes(d.id.name)));
  vm.runInContext(wiring.map(n => source.slice(n.start, n.end)).join('\n'), f.ctx);
  // B5 の契約追随(監督者決定 2026-09-10)
  f.counts.startEffect = 0;
  f.ctx.observeStartEffect = result => {
    f.counts.startEffect++;
    assert.equal(f.persisted.length, 1, 'startEffect runs after the successful candidate save');
    assert.deepEqual(f.persisted[0].pomodoro, clone(f.ctx.state.pomodoro));
    assert.equal(result.block.id, 'b');
  };
  vm.runInContext(`const originalStartEffect = dailyOperationDeps.startEffect;
    dailyOperationDeps.startEffect = result => { observeStartEffect(result); originalStartEffect(result); };`, f.ctx);
  return f;
}
const lifecycle = [
  ['start and close stale routine', f => {
    f.ctx.state.settings.focusTimerAuto = true;
    f.ctx.state.blocks.push({ ...clone(f.ctx.state.blocks[0]), id: 'stale', date: '2026-09-09',
      category: 'ルーティン', actualStartAt: '2026-09-09T23:10:00', actualEndAt: '' });
    return () => f.ctx.setBlockTime('b', 'actualStartAt');
  }],
  ['end', f => () => f.ctx.setBlockTime('b', 'actualEndAt')],
  ['complete', f => () => f.ctx.toggleBlock('b')],
  ['stale close', f => {
    f.ctx.state.blocks[0].category = 'ルーティン';
    f.ctx.state.blocks[0].date = '2026-09-09';
    f.ctx.state.blocks[0].actualStartAt = '2026-09-09T23:10:00';
    return () => f.ctx.autoCloseStaleRoutineRuns('another');
  }],
  ['actual modal', f => {
    f.input = { actualStartAt: `${DATE}T09:17`, actualEndAt: `${DATE}T09:53`, charge: '4', comment: 'typed' };
    return () => f.ctx.saveActualEntryFromModal('b', f.input);
  }],
  ['task completion', f => {
    f.ctx.state.blocks[0].taskId = 'task';
    f.ctx.state.tasks = [{ id: 'task', status: 'todo', progressDen: 1 }];
    return () => f.ctx.toggleTaskCompleteFromBlock('b');
  }],
  ['bulk approval', f => () => f.ctx.bulkApproveAsPlanned()]
];
// orders/244c: inject only inside the real run boundary, for four representative entries.
for (const mode of ['candidate-exception', 'invalid-clock']) {
  for (const [name, prepare] of [edits.find(([name]) => name === 'modal edit'), ...lifecycle.slice(0, 3)]) {
    test(`R2-15 ${mode}/${name}: zero writes, original references/input/draft, one-save retry`, async () => {
      const f = await lifecycleFixture(), execute = prepare(f);
      f.ctx._scheduleDraft = { date: DATE, items: [{ id: 'retained-draft', title: 'typed draft' }] };
      const before = clone(f.ctx.state), reference = f.ctx.state, stored = f.raw();
      const input = clone(f.input || {}), draft = f.ctx._scheduleDraft, undo = f.ctx._draftUndo;
      const draftValue = clone(draft), undoValue = clone(undo), quick = clone(f.ctx._quickCompleteSnapshots);
      const create = f.ctx.createDraftSaveTransaction;
      let injecting = true, injected = 0, failure, built = 0;
      const candidateError = new Error('R2-15 injected candidate exception');
      f.ctx.createDraftSaveTransaction = options => {
        const transaction = create({ ...options,
          now: () => {
            if (injecting && mode === 'invalid-clock') { injected++; return 'invalid-clock'; }
            return options.now();
          },
          onFailure: error => { failure = error; options.onFailure(error); }
        });
        const run = transaction.run;
        transaction.run = (work, options) => run(() => {
          const result = work();
          if (injecting) {
            assert.equal(transaction.active, true, 'injection is inside candidate build');
            assert.notEqual(f.ctx.state, reference, 'candidate uses a separate state');
            assert.notDeepEqual(clone(f.ctx.state.blocks), before.blocks, 'real entry built its changes');
            built++;
            if (mode === 'candidate-exception') { injected++; throw candidateError; }
          }
          return result;
        }, options);
        return transaction;
      };
      const init = ast.body.find(n => n.type === 'ExpressionStatement' && n.expression.left?.name === 'draftSaveTransaction');
      vm.runInContext(source.slice(init.start, init.end), f.ctx);
      f.ctx.createDraftSaveTransaction = create;
      assert.equal(execute(), false);
      assert.equal(built, 1); assert.equal(injected, 1, 'failure reached the real boundary once');
      if (mode === 'candidate-exception') assert.equal(failure, candidateError);
      else { assert(failure instanceof TypeError); assert.match(failure.stack, /nextMutationStamp/); }
      assert.equal(f.ctx.state, reference); expectRestored(before, clone(f.ctx.state));
      assert.equal(f.raw(), stored); assert.equal(f.counts.writes, 0); assert.equal(f.persisted.length, 0);
      expectRestored(input, clone(f.input || {}));
      assert.equal(f.ctx._scheduleDraft, draft); expectRestored(draftValue, clone(f.ctx._scheduleDraft));
      assert.equal(f.ctx._draftUndo, undo); expectRestored(undoValue, clone(f.ctx._draftUndo));
      expectRestored(quick, clone(f.ctx._quickCompleteSnapshots));
      assert.equal(f.counts.close + f.counts.render + f.counts.autoSync + f.counts.autoSave + f.counts.timer + f.counts.tracking + f.counts.startEffect + (f.counts.guidedAccess || 0), 0);
      injecting = false;
      execute();
      assert.equal(f.counts.writes, 1); assert.equal(f.persisted.length, 1);
      assert.equal(f.counts.autoSync, 1); assert.equal(f.counts.autoSave, 1);
      assert.notDeepEqual(clone(f.ctx.state.blocks), before.blocks);
      assert.deepEqual(f.persisted[0].blocks, clone(f.ctx.state.blocks));
      assert.deepEqual(clone(f.ctx.state.blocks[1]), before.blocks[1]);
    });
  }
}

for (const [name, prepare] of lifecycle) test(`${name}: Block failure prevents later effects; retry stamps once`, async () => {
  const f = await lifecycleFixture(), execute = prepare(f), before = clone(f.ctx.state);
  const input = clone(f.input || {}), blocks = f.ctx.state.blocks, snapshots = clone(f.ctx._quickCompleteSnapshots);
  await withLocalSaveFailure(async (fail, injection) => {
    f.fail(fail);
    assert.equal(execute(), false);
    assert.equal(injection.calls, 1);
    expectRestored(before.blocks, clone(f.ctx.state.blocks));
    assert.equal(f.ctx.state.blocks, blocks);
    assert.equal(f.ctx.state.dataModifiedAt, before.dataModifiedAt);
    expectRestored(input, clone(f.input || {}));
    expectRestored(snapshots, clone(f.ctx._quickCompleteSnapshots));
    assert.equal(f.counts.timer + f.counts.tracking + f.counts.close + f.counts.render + f.counts.autoSync + f.counts.autoSave, 0);
    if (name === 'task completion') {
      // fixR2C: Task and Block roll back together; retry the unchanged intent.
      assert.equal(f.ctx.state.tasks[0].status, 'todo');
      expectRestored(before.tasks, clone(f.ctx.state.tasks));
    }
    f.fail(null);
    execute();
    const changed = f.ctx.state.blocks[0];
    assert.equal(changed.updatedAt, '2026-09-10T10:05:01');
    assert.equal(changed.createdAt, before.blocks[0].createdAt);
    assert.deepEqual(f.persisted[0].blocks, clone(f.ctx.state.blocks));
    assert.deepEqual(clone(f.ctx.state.blocks[1]), before.blocks[1]);
    assert.equal(f.persisted.filter((image, i) => !i || image.blocks[0].updatedAt !== f.persisted[i - 1].blocks[0].updatedAt).length, 1);
    if (name === 'start and close stale routine') {
      assert.equal(changed.actualStartAt, NOW);
      assert.equal(f.ctx.state.blocks[2].actualEndAt, '2026-09-09T23:59:00');
      assert.equal(f.ctx.state.blocks[2].updatedAt, '2026-09-10T10:05:01');
      // B5 の契約追随(監督者決定 2026-09-10)
      assert.equal(f.counts.timer, 0, 'legacy timer functions are not called directly');
      assert.equal(f.counts.startEffect, 1);
      assert.deepEqual(f.persisted[0].pomodoro, {
        running: true, blockId: 'b', startedAt: NOW, endsAt: `${DATE}T10:25:00`,
        mode: 'focus', paused: false, pausedRemainMs: 0
      });
      assert.deepEqual(clone(f.ctx.state.pomodoro), f.persisted[0].pomodoro);
    }
    if (name === 'end') assert.equal(changed.actualEndAt, NOW);
    if (name === 'actual modal') {
      assert.equal(changed.actualStartAt, `${DATE}T09:17:00`);
      assert.equal(changed.actualEndAt, `${DATE}T09:53:00`);
    }
    if (name === 'stale close') assert.equal(changed.actualEndAt, '2026-09-09T23:59:00');
    if (name === 'bulk approval') assert.equal(changed.actualEndAt, before.blocks[0].plannedEndAt);
  });
});

test('plan completion keeps actuals empty; failed undo retains completion for retry', async () => {
  const f = await lifecycleFixture();
  f.ctx.toggleBlock('b');
  const completed = clone(f.ctx.state.blocks[0]);
  assert.equal(completed.completed, true);
  assert.equal(completed.actualStartAt, '');
  assert.equal(completed.actualEndAt, '');
  assert.equal(f.ctx._quickCompleteSnapshots.b, undefined);
  await withLocalSaveFailure(async fail => {
    f.fail(fail);
    assert.equal(f.ctx.toggleBlock('b'), false);
    expectRestored(completed, clone(f.ctx.state.blocks[0]));
    assert.equal(f.ctx._quickCompleteSnapshots.b, undefined);
    f.fail(null);
    f.ctx.toggleBlock('b');
    assert.equal(f.ctx.state.blocks[0].completed, false);
    assert.equal(f.ctx.state.blocks[0].actualStartAt, '');
    assert.equal(f.ctx.state.blocks[0].actualEndAt, '');
    assert.ok(f.ctx.state.blocks[0].updatedAt > completed.updatedAt);
  });
});

test('stale timer reset is persisted in the Block candidate without stamping Blocks again', async () => {
  const f = await lifecycleFixture();
  vm.runInContext(functions(['resetPomodoroForBlock']), f.ctx);
  f.ctx.state.blocks.push({ ...clone(f.ctx.state.blocks[0]), id: 'stale', category: 'ルーティン',
    actualStartAt: `${DATE}T09:00:00`, actualEndAt: '' });
  f.ctx.state.pomodoro = { running: true, blockId: 'stale', startedAt: `${DATE}T09:00:00` };
  const before = clone(f.ctx.state);
  await withLocalSaveFailure(async fail => {
    f.fail(fail);
    assert.equal(f.ctx.setBlockTime('b', 'actualStartAt'), false);
    expectRestored(before, clone(f.ctx.state));
    f.fail(null);
    f.ctx.setBlockTime('b', 'actualStartAt');
    // B5 の契約追随(監督者決定 2026-09-10)
    assert.equal(f.counts.writes, 2); // failed candidate write, successful Block + timer candidate write
    const saved = JSON.parse(f.raw());
    assert.equal(saved.pomodoro.running, false);
    assert.equal(saved.pomodoro.blockId, '');
    assert.equal(saved.blocks[0].actualStartAt, NOW);
    assert.equal(f.persisted.length, 1, 'Block and timer share one successful save');
    assert.deepEqual(f.persisted[0].blocks, clone(f.ctx.state.blocks));
    assert.deepEqual(f.persisted[0].pomodoro, clone(f.ctx.state.pomodoro));
    assert.deepEqual(f.persisted[0].blocks, saved.blocks);
    assert.deepEqual(f.persisted[0].pomodoro, saved.pomodoro);
    assert.equal(saved.blocks[0].updatedAt, '2026-09-10T10:05:01');
  });
});

test('all lifecycle writers alternate with candidate edits and survive merging old copies', async () => {
  const { mergeById } = await import('../src/core/merge.js');
  for (const [, prepare] of lifecycle) {
    const f = await lifecycleFixture(), execute = prepare(f);
    execute();
    const older = clone(f.ctx.state.blocks[0]);
    f.ctx.commitBlockChanges(f.ctx.state.blocks.map(b => b.id === 'b' ? { ...b, comment: 'new candidate' } : b));
    const candidate = clone(f.ctx.state.blocks[0]);
    f.ctx.updateBlockField('b', 'comment', 'last legacy edit');
    const latest = clone(f.ctx.state.blocks[0]);
    assert.ok(latest.updatedAt > candidate.updatedAt && candidate.updatedAt > older.updatedAt);
    assert.deepEqual(mergeById([older, candidate], [latest]), [latest]);
    assert.equal(latest.actualStartAt, older.actualStartAt);
    assert.equal(latest.actualEndAt, older.actualEndAt);
  }
});

test('browser modal keeps typed input after storage failure and saves once on retry', async () => {
  const { chromium, launchOptions, startServer, randomPort, blockGithubApiByDefault, STATE_KEY } = require('./helpers');
  const port = randomPort(), server = startServer(port);
  let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'ja-JP', serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.clock.install({ time: new Date(Date.UTC(2026, 8, 10, 1)) });
    await blockGithubApiByDefault(page);
    await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript',
      body: source + '\nwindow.__blockTest = { openTimelineNewBlock, getState: () => state };' }));
    await page.goto(`http://localhost:${port}`);
    await page.waitForFunction(() => Boolean(window.__blockTest));
    await page.evaluate(key => {
      const state = window.__blockTest.getState();
      state.blocks = [];
      state.selectedDate = '2026-09-10';
      state.settings.autoSyncEnabled = false;
      window.__blockTest.openTimelineNewBlock(600);
      const original = Storage.prototype.setItem;
      window.__storageTest = { fail: true, writes: 0 };
      Storage.prototype.setItem = function(name, value) {
        if (name === key) {
          window.__storageTest.writes++;
          if (window.__storageTest.fail) throw new DOMException('Injected quota', 'QuotaExceededError');
        }
        return original.call(this, name, value);
      };
    }, STATE_KEY);
    const title = page.locator('[data-modal-field="title"]');
    await title.fill('保存失敗でも保持');
    await page.locator('[data-action="modal-save"]').click();
    assert.equal(await title.inputValue(), '保存失敗でも保持');
    assert.equal(await page.evaluate(() => window.__blockTest.getState().blocks.length), 0);
    assert.equal(await page.evaluate(() => window.__storageTest.writes), 1);
    await page.evaluate(() => { window.__storageTest.fail = false; });
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForFunction(() => window.__blockTest.getState().blocks.length === 1);
    assert.equal(await page.evaluate(() => window.__storageTest.writes), 2);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).blocks[0], STATE_KEY);
    assert.equal(saved.title, '保存失敗でも保持');
    assert.equal(saved.plannedStartAt, `${DATE}T10:00:00`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('third carry-over draft confirmation keeps migration ritual outside the save boundary', async () => {
  const f = await fixture(['migrationNextCount', 'openMigrationRitual']);
  f.ctx._migrationRitualCtx = null;
  f.ctx.buildMigrationRitualModal = (block, count) => ({ id: block.id, count });
  f.ctx.state.blocks[0].carryCount = 2;
  f.ctx._scheduleDraft = { date: DATE, items: [{ id: 'draft', carryFromId: 'b', title: 'carry', start: 690, minutes: 30 }] };  // v388 契約追随: 繰越元 Block(9〜11時)と重ならない時刻へ(同日固定の便宜。新しい占有検査は繰越先の重なりを拒否する。監督者決定 2026-09-11)
  const blocks = clone(f.ctx.state.blocks), draft = clone(f.ctx._scheduleDraft);
  f.ctx.confirmScheduleDraft();
  assert.equal(f.ctx.state.modal.type, 'migrationRitual');
  assert.equal(f.ctx.state.modal.id, 'b');
  assert.equal(f.ctx._migrationRitualCtx.nextCount, 3);
  assert.deepEqual(clone(f.ctx.state.blocks), blocks);
  assert.deepEqual(clone(f.ctx._scheduleDraft), draft);
  assert.equal(f.counts.writes + f.counts.autoSave + f.counts.autoSync, 0);
});


test('fixB2 Block modal deletion failure retains modal, Block and recurrence exceptions', async () => {
  const f = await deletionFixture();
  vm.runInContext(functions(['deleteFromModal']), f.ctx);
  f.ctx.window.confirm = () => true;
  f.ctx.modalDeleteMessage = () => 'delete?';
  const actionSource = fs.readFileSync(path.join(__dirname, '../src/ui/actions.js'), 'utf8');
  const actionAst = acorn.parse(actionSource, { ecmaVersion: 'latest', sourceType: 'module' });
  const dispatcher = actionAst.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'dispatchModalDelete');
  f.ctx.modalHandlerRegistry = new Map([['block', { delete: id => f.ctx.deleteBlock(id) }]]);
  vm.runInContext(actionSource.slice(dispatcher.start, dispatcher.end), f.ctx);
  f.ctx.state.blocks[0].recurrenceGroupId = 'rule';
  Object.assign(f.ctx.state.recurrences[0], { kind: 'weekly', anchorDate: DATE, exceptionDates: [], updatedAt: FUTURE });
  const before = clone(f.ctx.state), blocks = f.ctx.state.blocks, rules = f.ctx.state.recurrences;
  await withLocalSaveFailure(async fail => {
    f.fail(fail);
    f.ctx.deleteFromModal();
    expectRestored(before, clone(f.ctx.state));
    assert.equal(f.ctx.state.blocks, blocks);
    assert.equal(f.ctx.state.recurrences, rules);
    assert.equal(f.counts.close + f.counts.autoSync, 0);
    f.fail(null);
    f.ctx.deleteFromModal();
    assert.equal(f.ctx.state.modal, null);
    assert.equal(f.ctx.state.blocks[0].deleted, true);
    assert.deepEqual(clone(f.ctx.state.recurrences[0].exceptionDates), [DATE]);
    assert.equal(f.counts.close, 1);
    assert.equal(f.counts.writes, 2);
  });
});

test('fixB2 interruption click retries only stop after the second Block save fails', async () => {
  const f = await pomodoroFixture();
  let action;
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Property' && node.key.value === 'interrupt-reason') action = node.value;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
  const click = vm.runInContext('(' + source.slice(action.start, action.end) + ')', f.ctx);
  vm.runInContext(functions(['renderPomodoroInterruptControls']), f.ctx);
  f.ctx.interruptReasonPickerHTML = () => 'reason picker';
  const timer = clone(f.ctx.state.pomodoro);
  await withLocalSaveFailure(async (fail, injection) => {
    f.fail(() => { if (f.counts.writes === 2) fail(); });
    click({ target: { dataset: { reason: 'fatigue' } } });
    assert.equal(injection.calls, 1);
    assert.equal(f.counts.writes, 2);
    assert.equal(f.ctx._pendingInterruptBlockId, 'b');
    assert.equal(f.ctx.renderPomodoroInterruptControls('default'), 'reason picker');
    expectRestored(timer, clone(f.ctx.state.pomodoro));
    assert.equal(f.ctx.state.blocks[0].actualStartAt, DATE + 'T09:00:00');
    assert.deepEqual(clone(f.ctx.state.blocks[0].interruptions), [{ at: NOW, reason: 'fatigue' }]);
    f.fail(null);
    click({ target: { dataset: { reason: 'fatigue' } } });
    assert.equal(f.ctx._pendingInterruptBlockId, null);
    assert.equal(f.ctx.state.pomodoro.running, false);
    assert.equal(f.ctx.state.blocks[0].actualStartAt, '');
    assert.equal(f.ctx.state.blocks[0].interruptions.length, 1);
    assert.equal(f.counts.writes, 4); // reason, failed stop, retry stop, timer effects
    assert.equal(f.ctx.state.blocks[0].updatedAt, '2026-09-10T10:05:02');
  });
});
