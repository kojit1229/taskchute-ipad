const assert = require('node:assert/strict');
const { chromium, launchOptions, startServer, randomPort, STATE_KEY, defaultContextOptions, passGithubGate, dispatchRegisteredAction } = require('./helpers');
const NOW = Date.UTC(2026, 8, 8, 14, 59, 40);
async function fixture({ paused = false } = {}) {
  const server = startServer(randomPort());
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const browser = await chromium.launch(launchOptions());
  async function page() {
    const context = await browser.newContext({ ...defaultContextOptions(), viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const p = await context.newPage();
    await p.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.fulfill({ status: 404, body: '{}' }));
    await p.clock.install({ time: paused ? NOW - 60000 : NOW });
    if (paused) await p.clock.pauseAt(NOW);
    await p.goto(`http://localhost:${server.address().port}/`);
    await passGithubGate(p);
    await p.evaluate(({ key }) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.currentView = 'zero'; s.selectedDate = '2026-08-01';
      s.settings.lastOpenedDate = '2026-09-08'; s.settings.zeroTab = 'theme';
      s.settings.autoSync = false; s.settings.github.autoSave = false;
      s.settings.autoArchive = false;
      s.settings.github.dataOwner = 'fixture-owner'; s.settings.github.dataRepo = 'fixture-repo';
      s.settings.github.token = 'fixture-token'; s.settings.github.path = 'fixture.json';
      s.questions = [{ id: 'q', title: '架空の問い', status: 'open', lastTouchedAt: '', createdAt: '2026-09-01T10:00:00' }];
      s.zeroThinking = { themes: [{ id: 'a', text: 'テーマA', fav: false, questionId: 'q' }, { id: 'b', text: 'テーマB', fav: false }], entries: [], groups: [], suggestedThemes: [] };
      s.dataModifiedAt = '2026-09-08T23:00:00'; s.settings.lastPushedAt = s.dataModifiedAt;
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY });
    await p.reload(); await p.locator('[data-action="zt-write"][data-id="a"]').first().waitFor();
    p.on('dialog', d => d.accept());
    return p;
  }
  return { page, close: async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); } };
}
const action = (p, name, data = {}) => dispatchRegisteredAction(p, name, data);
const read = p => p.evaluate(async () => JSON.parse(JSON.stringify((await import('/src/state/store.js')).state)));
const drafts = p => p.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('taskchute-journal-daily-draft-v1:')).flatMap(k => Object.values(JSON.parse(sessionStorage.getItem(k)).drafts || {})));
async function write(p, theme, body) {
  await action(p, 'zt-write', { id: theme });
  await p.locator('#zt-write-input').fill(body);
  await p.clock.runFor(600);
  assert.equal((await drafts(p)).some(d => d.body === body), true);
}
module.exports = { fixture, action, read, drafts, write, NOW };
