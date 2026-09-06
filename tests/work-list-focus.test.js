const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Load unchanged ESM source in this repository's CommonJS Node test environment.
function moduleURL(file) {
  const source = fs.readFileSync(file, 'utf8').replace(/from\s+(["'])(\.\.?\/[^"']+)\1/g,
    (_, quote, relative) => `from ${quote}${moduleURL(path.resolve(path.dirname(file), relative))}${quote}`);
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}
(async () => {
const store = await import(moduleURL(path.resolve(__dirname, '../src/state/store.js')));
const { setState } = store;
const { rememberWorkListOrigin, restoreWorkListOrigin, rememberWorkListScroll, restoreWorkListScroll } = await import(moduleURL(path.resolve(__dirname, '../src/features/work-list.js')));

// Real module + minimal DOM boundary; no browser, storage, or application fixture data.
const saved = { document: globalThis.document, CSS: globalThis.CSS };
let root, overlay, calls;
globalThis.CSS = { escape: value => value };
globalThis.document = {
  querySelector(selector) {
    if (selector === '[data-work-list="today"]') return root;
    assert.equal(selector, '#modalRoot.open, dialog[open]', 'overlay selector covers modal and native dialog');
    return overlay;
  },
  querySelectorAll: () => root ? [root] : [],
};
function node(name) { return { focus: options => calls.push({ name, options }) }; }
function setup() {
  calls = []; overlay = null; setState({ currentView: 'today', modal: null });
  const rows = { scrollTop: 321 };
  root = { dataset: { workList: 'today' }, button: node('row'), query: node('query'), rows,
    querySelector(selector) {
      if (selector === '[data-work-list-rows]') return rows;
      return selector.includes('button[data-action=') ? this.button : this.query;
    } };
  const target = { dataset: { action: 'edit-task' }, matches: () => true,
    closest: selector => selector === '[data-work-list]' ? root : { dataset: { workKey: 'task:fixture' } } };
  rememberWorkListOrigin(target);
}
const cases = [
  ['same row after normal close', () => {}, 'row'],
  ['missing row uses query', () => { root.button = null; }, 'query'],
  ['final DOM after synchronous render', () => { root = { ...root, button: node('replacement') }; }, 'replacement'],
  ['body scan modal opened before microtask', () => { store.state.modal = { type: 'bodyScan' }; }, null],
  ['DOM modal opened before microtask', () => { overlay = { id: 'modalRoot' }; }, null],
  ['native leave dialog opened before microtask', () => { overlay = { tagName: 'DIALOG' }; }, null],
  ['view changed with old list still present', () => { store.state.currentView = 'health'; }, null],
  ['origin root removed', () => { root = null; }, null],
];
let failures = 0;
try {
  for (const [name, change, expected] of cases) {
    setup(); rememberWorkListScroll(); restoreWorkListOrigin(); change();
    if (root) { root.rows.scrollTop = 0; restoreWorkListScroll(); }
    await Promise.resolve();
    try {
      assert.deepEqual(calls, expected ? [{ name: expected, options: { preventScroll: true } }] : []);
      if (root) assert.equal(root.rows.scrollTop, 321);
      restoreWorkListOrigin(); await Promise.resolve();
      assert.equal(calls.length, expected ? 1 : 0, 'origin consumed once');
      console.log(`PASS ${name}`);
    } catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
  }
} finally {
  globalThis.document = saved.document; globalThis.CSS = saved.CSS;
}
assert.equal(failures, 0, 'focus restoration regressions');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
