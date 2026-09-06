// Isolated real-UI acceptance. --case=number|draft|day|linked|keyboard|layout
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions, startServer, randomPort, blockGithubApiByDefault, passGithubGate, STATE_KEY } = require('./helpers');
const OUT = process.env.IRON_EVIDENCE_DIR || fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tc-iron-synthetic-'));
const DAY = '2026-09-06', NEXT = '2026-09-07';
const selected = process.argv.find(x => x.startsWith('--case='))?.slice(7) || 'all';
const cases = ['number', 'draft', 'day', 'linked', 'keyboard', 'layout'];
assert.ok(selected === 'all' || cases.includes(selected), 'unknown case');
const results = [];
fs.mkdirSync(OUT, { recursive: true });
async function runCase(browser, port, name, width = 390) {
  const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Asia/Tokyo', viewport: { width, height: 844 } });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', e => errors.push(e.message));
  let expired = false;
  const deadline = setTimeout(() => { expired = true; void context.close().catch(() => {}); }, 45000);
  const tag = `${name}-${width}`;
  const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  const sets = async (day = DAY) => (await saved()).condition?.logs?.[day]?.gym || [];
  const field = suffix => page.locator(`#ironForm${suffix}`);
  const add = () => page.locator('[data-action="iron-add-set"]').click();
  async function fill(weight, reps) { await field('Weight').fill(weight); await field('Reps').fill(reps); }
  async function nav(view) {
    const direct = page.locator(`#bottomNav [data-view="${view}"]:visible, #sidebar [data-view="${view}"]:visible`).first();
    if (await direct.count()) await direct.click();
    else {
      await page.locator('#bottomNav [data-view="more"]:visible, #sidebar [data-view="more"]:visible').first().click();
      await page.locator(`.more-tower-grid [data-view="${view}"]`).click();
    }
    await page.locator(`#app[data-view="${view}"]`).waitFor();
  }
  async function values(exercise, weight, reps) {
    assert.equal(await field('Exercise').inputValue(), exercise);
    assert.equal(await field('Weight').inputValue(), weight);
    assert.equal(await field('Reps').inputValue(), reps);
  }
  try {
    await blockGithubApiByDefault(page);
    await page.clock.setFixedTime(new Date(`${DAY}T23:59:00+09:00`));
    await page.goto(`http://localhost:${port}/`); await passGithubGate(page);
    await page.evaluate(({ key, day }) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.currentView = 'instruments'; s.selectedDate = day;
      s.settings.autoSync = false; s.settings.gymExerciseList = ['A', 'B'];
      s.projects = []; s.tasks = []; s.recurrenceRules = [];
      s.blocks = [{ id: 'fixture-gym-block', title: '筋トレ fixture', category: 'ジム', date: day,
        plannedStartAt: `${day}T23:00`, plannedEndAt: `${day}T23:59`, estimateMin: 60,
        actualStartAt: `${day}T23:00`, actualEndAt: '', completed: false, deleted: false, comment: 'original fixture' }];
      s.condition = { logs: { [day]: { gym: [] } } }; s.ironImport = { done: true, importedTotalKg: 0, importedDays: 0 };
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, day: DAY });
    await page.reload();
    await page.locator('button[data-action="instruments-open-iron-log"]').click();
    await field('Exercise').waitFor();
    if (name === 'linked' || name === 'layout') {
      const link = page.locator('.iron-linked [data-action="edit-block"]');
      assert.equal(await link.getAttribute('data-id'), 'fixture-gym-block');
      await link.scrollIntoViewIfNeeded(); const box = await link.boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, `link target ${JSON.stringify(box)}`);
      await link.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      const focus = await link.evaluate(el => { const s = getComputedStyle(el); return {
        active: document.activeElement === el, visible: el.matches(':focus-visible'),
        style: s.outlineStyle, width: parseFloat(s.outlineWidth), color: s.outlineColor }; });
      assert.ok(focus.active && focus.visible && focus.style !== 'none' && focus.width > 0 &&
        focus.color !== 'transparent' && !/rgba\([^)]*,\s*0\)/.test(focus.color), JSON.stringify(focus));
      fs.writeFileSync(path.join(OUT, `${tag}-link.json`), JSON.stringify({ box, focus }, null, 2));
      await page.screenshot({ path: path.join(OUT, `${tag}-link-focus.png`) });
    }
    if (name === 'number') {
      for (const [weight, reps] of [['', '10'], ['-1', '10'], ['0', '10'], ['40', ''], ['40', '-1'], ['40', '1.5']]) {
        const before = JSON.stringify(await saved());
        await fill(weight, reps); await add();
        assert.equal(JSON.stringify(await saved()), before, `invalid ${weight}/${reps} persisted`);
        assert.ok(await page.locator('.iron-form [aria-invalid="true"]').count());
        assert.ok((await page.locator('.iron-form-errors').innerText()).trim());
        await values('A', weight, reps);
      }
      await fill('', '10'); await field('Weight').pressSequentially('1e309');
      const raw = await field('Weight').inputValue();
      assert.ok(raw === '' || !Number.isFinite(Number(raw)), 'nonfinite input fixture');
      const before = JSON.stringify(await saved()); await add();
      assert.equal(JSON.stringify(await saved()), before); assert.ok((await page.locator('#ironErrorWeight').innerText()).trim());
      await fill('40', '10'); for (let i = 0; i < 3; i++) await add();
      const list = await sets(); assert.equal(list.length, 3); assert.equal(new Set(list.map(x => x.id)).size, 3);
      assert.equal(list.reduce((n, x) => n + x.weight * x.reps, 0), 1200);
      assert.ok(list.every(x => x.blockId === 'fixture-gym-block')); await values('A', '40', '10');
    }
    if (name === 'draft') {
      await field('Exercise').selectOption('B'); await fill('42.5', '8');
      await page.locator('#ironMenuName').fill('C'); await page.locator('[data-action="iron-menu-add"]').click();
      await values('B', '42.5', '8');
      await page.locator('[data-action="iron-menu-delete"][data-id="1"]').click();
      await values('B', '42.5', '8'); assert.deepEqual((await saved()).settings.gymExerciseList, ['A', 'C']);
      await nav('journal'); await nav('iron-log'); await values('B', '42.5', '8');
      await nav('fund'); await nav('iron-log'); await values('B', '42.5', '8');
      await field('Weight').fill(''); await nav('journal'); await nav('iron-log'); await values('B', '', '8');
      assert.equal((await sets()).length, 0);
    }
    if (name === 'day') {
      await field('Exercise').selectOption('B'); await fill('40', '10');
      const old = JSON.stringify(await sets());
      await page.clock.setFixedTime(new Date(`${NEXT}T00:01:00+09:00`));
      await nav('journal'); await nav('iron-log'); await values('B', '40', '10');
      assert.match(await page.locator('.iron-draft-date').innerText(), /2026-09-06.*2026-09-07/);
      assert.equal((await sets(NEXT)).length, 0); await add();
      assert.equal(JSON.stringify(await sets()), old); assert.equal((await sets(NEXT)).length, 1);
      assert.ok((await sets(NEXT))[0].at.startsWith(NEXT)); assert.equal(await page.locator('.iron-draft-date').count(), 0);
      await page.clock.setFixedTime(new Date('2026-09-08T00:01:00+09:00'));
      await nav('journal'); await nav('iron-log'); assert.equal(await page.locator('.iron-draft-date').count(), 1);
      await fill('-1', '10'); assert.equal((await sets('2026-09-08')).length, 0);
      await nav('journal'); await nav('iron-log'); assert.equal(await page.locator('.iron-draft-date').count(), 0);
      await page.clock.setFixedTime(new Date('2026-09-09T00:01:00+09:00'));
      await nav('journal'); await nav('iron-log'); await add();
      assert.equal((await sets('2026-09-09')).length, 0); assert.equal(await page.locator('.iron-draft-date').count(), 1);
      await values('B', '-1', '10');
    }
    if (name === 'linked') {
      await fill('42.5', '8');
      const open = () => page.locator('[data-action="edit-block"][data-id="fixture-gym-block"]').click();
      await open(); assert.equal(await page.locator('[data-modal-field="title"]').inputValue(), '筋トレ fixture');
      await page.locator('#modalRoot .modal-footer [data-action="modal-close"]').click(); await values('A', '42.5', '8');
      await open(); const discarded = page.locator('[data-modal-field="comment"]');
      if (!await discarded.isVisible()) await discarded.locator('xpath=ancestor::details[1]/summary').click();
      await discarded.fill('discarded fixture');
      await page.locator('#modalRoot .modal-footer [data-action="modal-close"]').click();
      await page.locator('[data-action="draft-leave-stay"]').click();
      assert.equal(await discarded.inputValue(),'discarded fixture');
      assert.equal((await saved()).blocks[0].comment,'original fixture');
      await page.locator('#modalRoot .modal-footer [data-action="modal-close"]').click();
      await page.locator('[data-action="draft-leave-discard"]').click();
      await page.waitForFunction(() => !document.querySelector('#modalRoot').classList.contains('open'));
      assert.equal(await page.locator('#modalRoot').evaluate(el => el.classList.contains('open')),false,'discard closes linked Block modal');
      await values('A','42.5','8'); assert.equal((await saved()).blocks[0].comment,'original fixture');
      await open(); const comment = page.locator('[data-modal-field="comment"]');
      if (!await comment.isVisible()) await comment.locator('xpath=ancestor::details[1]/summary').click();
      await comment.fill('saved fixture'); await page.locator('#modalRoot [data-action="modal-save"]').click();
      await page.waitForFunction(key => !document.querySelector('#modalRoot').classList.contains('open') &&
        JSON.parse(localStorage.getItem(key)).blocks.find(b => b.id === 'fixture-gym-block').comment === 'saved fixture', STATE_KEY);
      await values('A', '42.5', '8'); assert.equal((await saved()).blocks.length, 1);
      // Fixture transition only; assertions still use the actual rendered route.
      await page.evaluate(key => { const s = JSON.parse(localStorage.getItem(key)); s.blocks[0].deleted = true; localStorage.setItem(key, JSON.stringify(s)); }, STATE_KEY);
      await page.reload(); await field('Exercise').waitFor();
      assert.equal(await page.locator('.iron-linked [data-action="edit-block"]').count(), 0);
      await fill('40', '10'); await add(); assert.equal((await saved()).blocks.length, 1);
      assert.equal((await sets())[0].blockId, undefined);
    }
    if (name === 'keyboard') {
      await fill('42.5', '8'); await field('Weight').focus();
      await page.setViewportSize({ width, height: 360 });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'ironFormWeight'); await values('A', '42.5', '8');
      await page.locator('[data-action="iron-add-set"]').scrollIntoViewIfNeeded(); await add();
      assert.equal((await sets()).length, 1); await values('A', '42.5', '8');
      console.log('keyboard: viewport resize emulation only; physical keyboard/OS IME not tested');
    }
    if (name === 'layout') {
      await fill('40', '1.5'); await add();
      assert.equal((await sets()).length, 0); assert.ok((await page.locator('#ironErrorReps').innerText()).trim());
      for (const suffix of ['Exercise', 'Weight', 'Reps']) {
        await field(suffix).scrollIntoViewIfNeeded(); const box = await field(suffix).boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `${suffix} horizontal reachability`);
      }
      await fill('40', '10'); await add(); assert.equal((await sets()).length, 1); await values('A', '40', '10');
    }
    await page.screenshot({ path: path.join(OUT, `${tag}.png`), fullPage: true });
    assert.deepEqual(errors, [], 'pageerror'); assert.equal(expired, false, 'case deadline');
    results.push({ case: tag, status: 'PASS' }); console.log(`PASS ${tag}`);
  } catch (error) {
    await page.screenshot({ path: path.join(OUT, `${tag}-failure.png`), fullPage: true, timeout: 3000 }).catch(() => {});
    fs.writeFileSync(path.join(OUT, `${tag}-failure.txt`), JSON.stringify({ error: error.stack, errors, expired }, null, 2));
    results.push({ case: tag, status: 'FAIL', error: error.message }); throw error;
  } finally { clearTimeout(deadline); await context.close(); }
}
(async () => {
  const port = randomPort(), server = startServer(port); let browser;
  try {
    browser = await chromium.launch({ ...launchOptions(), timeout: 60000 });
    for (const name of cases.filter(x => selected === 'all' || selected === x)) {
      for (const width of [390, 768, 1024]) await runCase(browser, port, name, width);
    }
  } finally {
    if (browser) await browser.close(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(OUT, `results-${selected}.json`), JSON.stringify(results, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
