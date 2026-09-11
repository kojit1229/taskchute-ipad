const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const validation = source.slice(source.indexOf('function validateStateContainers('), source.indexOf('function normalizeState('));
assert.ok(validation, 'the real validation function must exist');
// v387 ハーネス追随(監督者決定 2026-09-11、束B7 単位35): validateStateContainers が単発予定の容器検査 validateSingleScheduleContainer(src/core/single-schedule.js)を呼ぶようになったので、実物の関数本文を砂場へ同梱する(製品変更なし)。
const singleScheduleSource = fs.readFileSync(path.join(ROOT, 'src/core/single-schedule.js'), 'utf8').replace(/\r\n/g, '\n');
const containerCheck = singleScheduleSource.slice(singleScheduleSource.indexOf('export function validateSingleScheduleContainer('), singleScheduleSource.indexOf('\n}\n', singleScheduleSource.indexOf('export function validateSingleScheduleContainer(')) + 3).replace('export ', '');
assert.ok(containerCheck.includes('StateContainerError'), 'the real single-schedule container check must exist');
const validate = vm.runInNewContext(containerCheck + '\n' + validation + ';validateStateContainers');
const startupStart = source.indexOf('try {\n  setState(loadState(');
const startupEnd = source.indexOf('// v234:', startupStart);
assert.ok(startupStart > 0 && startupEnd > startupStart);
const startup = source.slice(startupStart, startupEnd);
const KEY = 'taskchute-journal-pwa-state-v1';
const seed = () => ({ settings: { github: {} }, journals: {}, recurrences: [] });
const normalize = value => { validate(value); value.journals ||= {}; value.recurrences ||= []; return value; };
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
(async () => {
  const storage = await import(pathToFileURL(path.join(ROOT, 'src/storage/local.js')));
  const store = await import(pathToFileURL(path.join(ROOT, 'src/state/store.js')));
  for (const key of ['journals', 'recurrences']) {
    const badValues = key === 'journals' ? ['bad', 42, true, false, 0, '', []] : ['bad', 42, true, false, 0, '', {}];
    for (const bad of badValues) {
      check(key + ' rejects ' + JSON.stringify(bad) + ' without mutation', () => {
        const value = { ...seed(), [key]: bad };
        const before = JSON.stringify(value);
        assert.throws(() => validate(value), { name: 'StateContainerError' });
        assert.equal(JSON.stringify(value), before);
      });
      for (const backupFails of [false, true]) {
        check(key + ' quarantines raw; backup failure=' + backupFails, () => {
          const raw = JSON.stringify({ ...seed(), [key]: bad });
          const backupSentinel = 'fixture-existing-recovery-copy';
          const memory = new Map([[KEY, raw], [KEY + '-corrupt-backup', backupSentinel]]);
          const writes = [];
          global.localStorage = {
            getItem: k => memory.get(k) ?? null,
            setItem: (k, value) => { writes.push(k); if (backupFails) throw new Error('fixture quota'); memory.set(k, value); }
          };
          const app = { innerHTML: '' };
          let adopted = false;
          assert.throws(() => vm.runInNewContext(startup, {
            app, loadState: storage.loadState, normalizeState: normalize, seedState: seed,
            setState: () => { adopted = true; }
          }), { name: 'StateContainerError' });
          assert.equal(memory.get(KEY), raw);
          assert.equal(writes.length, 0, 'quarantine must not write any storage key');
          assert.equal(adopted, false);
          assert.match(app.innerHTML, /保存と同期を停止/);
          assert.match(app.innerHTML, /href="\.\/"/);
          assert.equal(memory.get(KEY + '-corrupt-backup'), backupSentinel);
          // Simulate an explicit external recovery followed by reload, then normal save/reload.
          const restored = { ...seed(), journals: { '2026-09-06': 'fixture-restored' }, recurrences: [{ id: 'fixture-rule' }] };
          memory.set(KEY, JSON.stringify(restored));
          localStorage.setItem = (k, v) => memory.set(k, v);
          const loaded = storage.loadState(normalize, seed);
          store.setState(loaded); storage.persistLocalNoSchedule();
          assert.equal(storage.loadState(normalize, seed).journals['2026-09-06'], 'fixture-restored');
        });
      }
    }
  }
  check('other JSON corruption keeps existing backup fallback', () => {
    const malformed = '{broken-json';
    const memory = new Map([[KEY, malformed], [KEY + '-corrupt-backup', 'fixture-old-copy']]);
    global.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,v) };
    const loaded = storage.loadState(normalize, seed);
    assert.equal(memory.get(KEY + '-corrupt-backup'), malformed);
    assert.equal(loaded.settings.autoSync, false);
    assert.equal(loaded.settings.github.autoSave, false);
  });
  for (const value of [{}, { journals: null, recurrences: null }, seed()]) {
    check('legacy valid/missing/null defaults', () => assert.doesNotThrow(() => normalize(value)));
  }
  check('validation precedes all normalization mutations', () => {
    assert.match(source, /function normalizeState\(value\)\s*\{\s*validateStateContainers\(value\);/);
  });
  console.log(`PASS ${checks} checks`);
})().catch(error => { console.error(error); process.exitCode = 1; });
