const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { STATE_KEY, setViewportAndWaitForStableLayout } = require('./helpers');
const { setup, nav } = require('./remaining-twelveweek-layout.test');

module.exports = async function journalJapanese() {
  const { page, browser, server } = await setup();
  const date = '2026-07-25', previous = '2026-07-24';
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.evaluate(({ key, date, previous }) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.currentView = 'journal'; s.selectedDate = date;
      s.settings.autoSync = false; s.settings.github.autoSave = false;
      s.journals[date] = '### 自由記述\n入力を保持する架空の本文';
      s.journals[previous] = '前日だけの架空本文';
      s.reports = { [previous]: '# Previous report\n前日だけの生成本文' };
      s.writeMeditations = [{ id: 'wm_' + date, date, discharge: [{ id: 'd', text: '架空の疲れ' }],
        charge: [{ id: 'c', text: '架空の散歩' }], dischargeTalk: '', chargeTalk: '',
        updatedAt: date + 'T09:00:00', deleted: false }];
      s.blocks = [{ id: 'journal-label-done', date, title: '架空の終了実績', completed: true,
        actualStartAt: date + 'T08:00:00', actualEndAt: date + 'T08:15:00', deleted: false }];
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, date, previous });
    await page.reload();
    await page.locator('.journal-tower').waitFor();
    await page.evaluate(key => {
      window.__journalWrites = 0; window.__copies = []; window.__shares = [];
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, value) {
        if (k === key) window.__journalWrites++;
        return setItem.call(this, k, value);
      };
      Object.defineProperty(navigator, 'clipboard', { configurable: true,
        value: { writeText: async text => { window.__copies.push(text); } } });
      Object.defineProperty(navigator, 'share', { configurable: true,
        value: async payload => { window.__shares.push(payload); } });
    }, STATE_KEY);
    const root = page.locator('.journal-tower');
    assert.equal(await root.locator('h1').innerText(), '日報');
    assert.deepEqual(await root.locator('[data-journal-section]').evaluateAll(nodes => nodes.map(n => n.dataset.journalSection)),
      ['morning', 'body', 'flight', 'mind', 'life', 'money', 'journal']);
    for (const text of ['からだの記録', 'やったこと', '心の記録', '暮らしの記録', '資産の日誌', '終了実績 1件'])
      assert.ok((await root.innerText()).includes(text), text);
    assert.equal(await root.locator('.journal-report-empty').innerText(), 'この日の日報はまだ生成していません。');
    assert.equal(await root.locator('.journal-report-preview').count(), 0);
    assert.equal(await root.locator('[data-action="report-copy-ai"]').count(), 0);
    assert.equal(await root.locator('[data-action="report-share-ai"]').count(), 0);
    assert.ok((await root.locator('#journalFreeText').inputValue()).includes('入力を保持する架空の本文'));
    assert.equal(await root.locator('[data-action="download-report"]').innerText(), '日報ファイルを保存');
    assert.equal(await root.locator('[data-action="push-report"]').innerText(), '📤 日報をクラウドに保存');
    const read = () => page.evaluate(key => ({ state: JSON.parse(localStorage.getItem(key)), writes: window.__journalWrites }), STATE_KEY);
    const before = await read();
    const rendered = await page.evaluate(async () => (await import('/src/features/journal.js')).renderJournal());
    assert.ok(rendered.includes('この日の日報はまだ生成していません。'));
    assert.deepEqual(await read(), before, 'rendering never saves or changes persisted records');
    await root.locator('[data-action="generate-report"]').click();
    await root.locator('.journal-report-preview').waitFor();
    const generated = await read();
    assert.equal(generated.writes - before.writes, 1, 'generate keeps one candidate save');
    assert.deepEqual(generated.state.journals, before.state.journals);
    assert.deepEqual(generated.state.blocks, before.state.blocks);
    assert.equal(generated.state.reports[previous], before.state.reports[previous]);
    assert.ok(generated.state.reports[date].includes('入力を保持する架空の本文'));
    assert.ok(generated.state.reports[date].includes('MIT'), 'generated English heading is preserved');
    assert.equal(await root.locator('.journal-report-preview').getAttribute('data-report-date'), date);
    assert.equal(await root.locator('[data-action="generate-report"]').innerText(), '📊 日報を再生成');
    await root.locator('[data-action="report-copy-ai"]').click();
    await page.waitForFunction(() => window.__copies.length === 1);
    assert.equal(await page.evaluate(() => window.__copies[0]), (await read()).state.reports[date]);
    await root.locator('[data-action="report-share-ai"]').click();
    await page.waitForFunction(() => window.__shares.length === 1);
    assert.equal(await page.evaluate(() => window.__shares[0].text), (await read()).state.reports[date]);
    const downloadEvent = page.waitForEvent('download');
    await root.locator('[data-action="download-report"]').click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), '日報_' + date + '.md');
    assert.equal(fs.readFileSync(await download.path(), 'utf8'), (await read()).state.reports[date]);
    const output = process.env.ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'r4a-labels-'));
    fs.mkdirSync(output, { recursive: true });
    const measures = [];
    for (const width of [390, 1280]) {
      await setViewportAndWaitForStableLayout(page, { width, height: 900 }, '.journal-report');
      const measure = await root.evaluate(root => ({ width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        inputs: [...root.querySelectorAll('input,select,textarea')].map(el => ({ type: el.type,
          step: el.getAttribute('step'), fontSize: parseFloat(getComputedStyle(el).fontSize) })),
        actions: [...root.querySelectorAll('.journal-report-actions button')].map(el => el.getBoundingClientRect().height) }));
      assert.ok(measure.scrollWidth <= measure.width, width + ': no page overflow');
      for (const input of measure.inputs) {
        assert.ok(input.fontSize >= 16, 'iOS input font');
        if (['time', 'datetime-local'].includes(input.type)) assert.equal(input.step, '300');
      }
      assert.ok(measure.actions.every(height => height >= 44));
      measures.push({ viewport: width, ...measure });
      await page.screenshot({ path: path.join(output, 'journal-' + width + '.png'), fullPage: true });
    }
    fs.writeFileSync(path.join(output, 'journal-dimensions.json'), JSON.stringify(measures, null, 2), 'utf8');
    await root.locator('input[type="date"]').fill(previous);
    await root.locator('input[type="date"]').dispatchEvent('change');
    await page.locator('.journal-report-preview[data-report-date="' + previous + '"]').waitFor();
    assert.equal(await root.locator('.journal-report-preview').getAttribute('data-report-date'), previous);
    assert.ok((await root.locator('.journal-report-preview').innerText()).includes('前日だけの生成本文'));
    assert.deepEqual(errors, []);
    console.log('PASS journal: Japanese sections, inputs, one generate save, rendered report/date, copy/share/download, responsive dimensions');
  } finally {
    await page.context().close(); await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
};
