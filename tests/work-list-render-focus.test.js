const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
function moduleURL(file) {
  const source = fs.readFileSync(file, 'utf8').replace(/from\s+(["'])(\.\.?\/[^"']+)\1/g,
    (_, quote, relative) => `from ${quote}${moduleURL(path.resolve(path.dirname(file), relative))}${quote}`);
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}
(async () => {
  const store = await import(moduleURL(path.resolve(__dirname, '../src/state/store.js')));
  const list = await import(moduleURL(path.resolve(__dirname, '../src/features/work-list.js')));
  const original = { document: global.document, CSS: global.CSS };
  let day, root, overlay, focused, calls, queries, rowPresent, targetIdentity;
  const body = { tagName: 'BODY', isConnected: true };
  global.CSS = { escape: value => String(value) };
  global.document = { body, get activeElement() { return focused; },
    querySelectorAll: () => root ? [root] : [],
    querySelector: selector => selector === '#modalRoot.open, dialog[open]' ? overlay
      : selector === '[data-work-list="exec"]' ? root : null };
  list.configureWorkList({ todayISO: () => day });
  function setup() {
    calls = []; queries = []; day = '2026-09-06'; overlay = null; rowPresent = true; targetIdentity = 'block-a';
    store.setState({ currentView: 'fillgap', selectedDate: day, modal: null });
    const rows = { scrollTop: 213 }, row = { dataset: { workKey: 'block:block-a' } };
    root = { dataset: { workList: 'exec' }, querySelector: selector => {
      if (selector === '[data-work-list-rows]') return rows;
      queries.push(selector);
      return rowPresent && selector.includes('[data-work-key="block:block-a"]') && selector.includes('[data-action="toggle-block"]')
        && selector.includes(`[data-id="${targetIdentity}"]`) ? { focus: options => calls.push(options) } : null;
    } };
    focused = { dataset: { action: 'toggle-block', id: 'block-a' }, isConnected: true, matches: selector => selector === 'button[data-action]',
      closest: selector => selector === '[data-work-list]' ? root : selector === '[data-work-key]' ? row : null };
    return rows;
  }
  const cases = [
    ['same rendered row', () => {}, true],
    ['new view', () => { store.state.currentView = 'today'; }, false],
    ['new selected date', () => { store.state.selectedDate = '2026-09-05'; }, false],
    ['midnight', () => { day = '2026-09-07'; }, false],
    ['modal state', () => { store.state.modal = { type: 'bodyScan' }; }, false],
    ['native dialog', () => { overlay = {}; }, false],
    ['row removed', () => { rowPresent = false; }, false],
    ['different id at same row', () => { targetIdentity = 'block-b'; }, false],
    ['root removed', () => { root = null; }, false],
    ['new surface takes focus', () => { focused = { isConnected: true, tagName: 'TEXTAREA' }; }, false],
  ];
  try {
    for (const [name, change, expected] of cases) {
      const rows = setup(); list.rememberWorkListScroll(); focused.isConnected = false; focused = body; rows.scrollTop = 0;
      change(); list.restoreWorkListScroll();
      assert.equal(calls.length, expected ? 1 : 0, name);
      if (expected) assert.deepEqual(calls[0], { preventScroll: true });
      if (root) assert.equal(rows.scrollTop, 213, 'list scroll retained');
      list.restoreWorkListScroll(); assert.equal(calls.length, expected ? 1 : 0, 'focus consumed once');
      console.log('PASS ' + name);
    }
    setup(); focused.matches = () => false; list.rememberWorkListScroll(); focused = body; list.restoreWorkListScroll();
    assert.equal(calls.length, 0, 'non-button editor not reconstructed by focus restoration');
    console.log('PASS non-button exclusion');
  } finally { global.document = original.document; global.CSS = original.CSS; }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
