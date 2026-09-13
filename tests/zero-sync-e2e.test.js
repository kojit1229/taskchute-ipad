const assert = require('node:assert/strict');
const { fixture, action, read, drafts, write } = require('./zero-ui-fixture');
const { mergeById } = require('../src/core/merge.js');
const { nextMutationStamp } = require('../src/core/mutation-stamp.js');
const { STATE_KEY } = require('./helpers');
(async () => {
  const f = await fixture();
  let failures = 0;
  try {
    const old = { id: 'timed', body: 'same', durationSec: 5, createdAt: '2026-09-08T23:59:40', updatedAt: null };
    const newer = { ...old, durationSec: 20, updatedAt: nextMutationStamp({ now: old.createdAt, candidates: [old.createdAt] }) };
    for (const pair of [[[old], [newer]], [[newer], [old]]]) assert.equal(mergeById(...pair)[0].durationSec, 20);
    console.log('PASS M: time-only newer candidate wins both argument orders');
    for (const name of ['syncFromGitHubOnStartup', 'loadFromGitHub', 'runAutoSyncPull', 'saveToGitHub', 'runAutoSyncPush']) {
      const p = await f.page(), a = await f.page();
      try {
        await write(a, 'a', 'Aの未完了本文');
        const remote = await read(a);
        remote.settings.autoSync = true;
        remote.dataModifiedAt = '2026-09-09T00:01:00';
        remote.zeroThinking.entries = [{ id: 'remote', date: '2026-09-08', theme: '完成A', body: 'Aの完成回答', createdAt: '2026-09-08T23:59:45', updatedAt: null, durationSec: 5 }];
        await write(p, 'b', 'Bの未完了本文');
        await p.evaluate(async () => {
          const { state } = await import('/src/state/store.js');
          state.zeroThinking.entries.push({ id: 'local', date: '2026-09-08', theme: '完成B', body: 'Bの未同期回答', createdAt: '2026-09-08T23:59:46', updatedAt: null, durationSec: 20 });
          state.zeroThinking.themes.push({ id: 'only-b', text: 'Bだけで追加したテーマ', fav: false });
          state.settings.autoSync = true;
          state.dataModifiedAt = '2026-09-08T23:59:46'; state.settings.lastPushedAt = '2026-09-08T23:00:00';
          localStorage.setItem('taskchute-journal-last-synced-sha', 'old-sha');
        });
        if (name === 'saveToGitHub') {
          // Manual push requires equal non-mergeable core: A's question touch is a separate conflict.
          remote.questions = (await read(p)).questions;
          assert.equal(await p.evaluate(async remote => (await import('/src/sync/github.js')).syncCoreEqual(remote), remote), true);
        }
        let release, started;
        const blocked = new Promise(resolve => { release = resolve; });
        const entered = new Promise(resolve => { started = resolve; });
        let gets = 0, puts = 0;
        await p.route('https://api.github.com/**', async route => {
          if (route.request().method() === 'PUT') { puts++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: 'saved-sha' } }) }); }
          if (!route.request().url().includes('fixture.json')) return route.fulfill({ status: 404, body: '{}' });
          gets++; started(); await blocked;
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'remote-sha', encoding: 'base64', content: Buffer.from(JSON.stringify(remote), 'utf8').toString('base64') }) });
        });
        const syncing = p.evaluate(async name => { await (await import('/src/sync/github.js'))[name](); }, name);
        // If readiness prevents a GET, the operation's completion is itself evidence of the failed path.
        const reached = await Promise.race([entered.then(() => true), syncing.then(() => false)]);
        assert.equal(reached, true, `${name}: GET must start`);
        await p.locator('#zt-write-input').fill('GET待ち中のBの入力'); await p.clock.runFor(600);
        await a.locator('#zt-write-input').fill('取得中もAは自動保存'); await a.clock.runFor(600);
        release(); await syncing;
        const state = await read(p);
        assert.ok(gets > 0); if (name.includes('Push') || name === 'saveToGitHub') assert.ok(puts > 0, 'PUT must complete');
        assert.ok(state.zeroThinking.entries.some(e => e.id === 'local'), 'local unsynced answer retained');
        assert.ok(state.zeroThinking.entries.some(e => e.id === 'remote'), 'remote answer merged');
        assert.ok((await drafts(p)).some(d => d.body === 'GET待ち中のBの入力'));
        assert.ok((await drafts(a)).some(d => d.body === '取得中もAは自動保存'));
        assert.equal(await p.locator('#zt-write-input').inputValue(), 'GET待ち中のBの入力');
        assert.ok(state.zeroThinking.themes.some(t => t.id === 'only-b'), 'B-only theme must survive remote adoption');
        console.log(`PASS M: ${name} answers/drafts/GET-wait input/themes`);
      } catch (error) { failures++; console.error(`FAIL M: ${name}`, error); }
      finally { await p.context().close(); await a.context().close(); }
    }
    for (const remoteNewer of [true, false]) {
      for (const name of ['syncFromGitHubOnStartup', 'loadFromGitHub', 'runAutoSyncPull', 'saveToGitHub', 'runAutoSyncPush']) {
        const p = await f.page();
        try {
          const early = '2026-09-08T20:00:00', late = '2026-09-08T21:00:00';
          const theme = (id, text, createdAt, updatedAt) => ({ id, text, fav: false, createdAt, updatedAt });
          const localThemes = [theme('only-b', 'B-only'), theme('local-new', 'B-new', early, late),
            theme('remote-new', 'B-old', late, early), theme('tie', 'B-tie', early, late),
            theme('created-only', 'B-created-old', early), theme('unstamped', 'B-unstamped')];
          const remoteThemes = [theme('only-a', 'A-only'), theme('local-new', 'A-old', late, early),
            theme('remote-new', 'A-new', early, late), theme('tie', 'A-tie', early, late),
            theme('created-only', 'A-created-new', late), theme('unstamped', 'A-unstamped')];
          await p.evaluate(async ({ localThemes, name }) => {
            const { state } = await import('/src/state/store.js');
            state.zeroThinking.themes = localThemes;
            // Legacy gardenLog is otherwise absent and its empty-map merge is an unrelated send reason.
            state.gardenLog = {};
            state.settings.autoSync = true;
            state.dataModifiedAt = '2026-09-08T23:00:00';
            state.settings.lastPushedAt = name.includes('Push') || name === 'saveToGitHub'
              ? '2026-09-08T19:00:00' : state.dataModifiedAt;
            localStorage.setItem('taskchute-journal-last-synced-sha', 'old-sha');
          }, { localThemes, name });
          const remote = await read(p);
          remote.zeroThinking.themes = remoteThemes;
          remote.dataModifiedAt = remoteNewer ? '2026-09-09T00:01:00' : '2026-09-08T22:00:00';
          assert.equal(await p.evaluate(async remote => (await import('/src/sync/github.js')).syncCoreEqual(remote), remote), true,
            'theme-only differences must stay outside SYNC_CORE_COMPARE_KEYS');
          let gets = 0;
          const sent = [];
          await p.route('https://api.github.com/**', async route => {
            if (!route.request().url().includes('fixture.json')) return route.fulfill({ status: 404, body: '{}' });
            if (route.request().method() === 'PUT') {
              sent.push(JSON.parse(Buffer.from(route.request().postDataJSON().content, 'base64').toString('utf8')));
              return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: 'saved-sha' } }) });
            }
            gets++;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'remote-sha', encoding: 'base64', content: Buffer.from(JSON.stringify(remote), 'utf8').toString('base64') }) });
          });
          await p.evaluate(async name => { await (await import('/src/sync/github.js'))[name](); }, name);
          const state = await read(p);
          assert.ok(gets > 0, 'theme-only scenario must reach GET');
          const expected = { 'only-b': 'B-only', 'only-a': 'A-only', 'local-new': 'B-new', 'remote-new': 'A-new',
            tie: 'B-tie', 'created-only': 'A-created-new', unstamped: 'B-unstamped' };
          const bodies = value => Object.fromEntries(value.zeroThinking.themes.map(t => [t.id, t.text]));
          assert.equal(state.zeroThinking.themes.length, 7, 'union must not duplicate theme IDs');
          assert.deepEqual(bodies(state), expected);
          assert.deepEqual(bodies(await p.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY)), expected);
          if (name === 'saveToGitHub') {
            assert.equal(sent.length, 1, 'manual push sends the theme union');
            assert.deepEqual(bodies(sent[0]), expected);
          }
          if (name === 'runAutoSyncPush') {
            assert.equal(sent.length, 0, 'theme-only merge keeps the existing automatic send decision');
            assert.equal(state.dataModifiedAt, remote.dataModifiedAt);
            assert.equal(state.settings.lastPushedAt, remote.dataModifiedAt);
          }
          console.log('PASS fixR3Bbase: ' + name + ' remoteNewer=' + remoteNewer + ' theme-only union/newer/tie/createdAt/missing stamps/core exclusion');
        } catch (error) { failures++; console.error('FAIL fixR3Bbase: ' + name + ' remoteNewer=' + remoteNewer, error); }
        finally { await p.context().close(); }
      }
    }
    assert.equal(failures, 0, 'all five synchronization paths must preserve answers, drafts and themes');
  } finally { await f.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
