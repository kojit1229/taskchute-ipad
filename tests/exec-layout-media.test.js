const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert/strict");
const acorn = require("acorn");

const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const tree = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
const declaration = name => {
  const node = tree.body.find(n => n.type === "FunctionDeclaration" && n.id.name === name);
  if (!node && ["captureFillGapLayoutInputs", "restoreFillGapLayoutInputs"].includes(name)) return `function ${name}() {}`;
  assert(node, name);
  return source.slice(node.start, node.end);
};
const registration = tree.body.find(n => n.type === "IfStatement"
  && source.slice(n.test.start, n.test.end) === "window.matchMedia"
  && source.slice(n.start, n.end).includes("_wbsDesktopMediaQuery"));
assert(registration, "production media registration exists");

function harness(legacy, preserve = false) {
  let width = 1280, height = 900, html = "", overlay = "", renders = 0, overlayWrites = 0;
  const ids = ["fillGapTitle", "fillGapLength", "fillGapCategory", "fillGapProject", "fillGapRoutine"];
  const sheets = { left: null, overlay: null };
  function replaceSheet(where, show) {
    if (sheets[where]) Object.values(sheets[where].fields).forEach(field => { field.isConnected = false; });
    const fields = Object.fromEntries(ids.map((id, index) => [id, { value: index === 1 ? "full" : "", isConnected: true,
      tagName: index ? "SELECT" : "INPUT", options: ["", "full", "25", "開発", "task:t1", "r1"].map(value => ({ value })),
      focus() { ctx.document.activeElement = this; }, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } }]));
    sheets[where] = show ? { fields, querySelector: selector => fields[selector.slice(1)] || null } : null;
  }
  const media = [];
  const matches = query => query.includes("prefers-color") ? false
    : query.includes(",") ? width >= 1280 || width >= 1024 && width > height
    : query.includes("1024") ? width >= 1024 && width > height : width >= 1280;
  const state = { currentView: "exec", selectedDate: "2026-09-04", settings: { theme: "light" }, _justStartedBlockId: null,
    modal: { type: "fillGap", date: "2026-09-04", start: "08:00", end: "09:00" } };
  const root = { classList: { remove() { overlay = ""; } }, setAttribute() {},
    set innerHTML(value) { overlay = value; replaceSheet("overlay", value.includes("fill-gap-sheet")); }, onclick: null };
  const ctx = { state, window: { matchMedia(query) {
    const entry = { query, matches: matches(query), listeners: [] };
    if (legacy) entry.addListener = fn => entry.listeners.push(fn);
    else entry.addEventListener = (event, fn) => { assert.equal(event, "change"); entry.listeners.push(fn); };
    media.push(entry);
    return entry;
  } }, _execMode: "plan", _scheduleDraft: null, projectedEndText: () => "",
  computeBufferRemaining: () => ({}), todayISO: () => state.selectedDate,
  renderTimelineView: () => '<div class="timeline"></div>',
  renderTasks: () => '<section data-work-list="exec"></section>', execDoneListHTML: () => '<div class="done-list"></div>',
  buildFillGapModal: () => '<div class="fill-gap-sheet"></div>', execFillGapAddButtonHTML: () => "",
  bufferMeterHTML: () => "", escapeHTML: s => s, renderDateBar: () => "", scheduleDraftActive: () => false,
  captureFillGapLayoutInputs() {}, restoreFillGapLayoutInputs() {}, modalRoot: root,
  renderModal: value => { overlayWrites++; overlay = value; replaceSheet("overlay", value.includes("fill-gap-sheet")); }, applyTheme() {},
  document: { body: {}, activeElement: { matches: () => false, value: "typed gap title" },
    querySelectorAll: () => Object.values(sheets).filter(Boolean),
    querySelector: selector => selector.includes("exec-pane-left") ? sheets.left : sheets.overlay },
  draftSaveTransaction: null, personalDataReady: () => true, app: { dataset: {} }, visionEditDraft: null,
  renderSidebar() {}, renderBottomNav() {}, rememberWorkListScroll() {}, restoreWorkListScroll() {}, restoreGlobalInputs() {},
  renderTimelineRail() {}, renderSyncBanner() {}, renderPersonalDataAuthBanner() {}, maybeMarkAiReportRead() {},
  renderMain() { renders++; html = vm.runInContext("renderExecView()", ctx); replaceSheet("left", html.includes("fill-gap-sheet")); } };
  vm.createContext(ctx);
  if (preserve) vm.runInContext('const FILL_GAP_LAYOUT_FIELDS = ' + JSON.stringify(ids) + '; let fillGapLayoutInputDraft = null;\n'
    + declaration("captureFillGapLayoutInputs") + "\n" + declaration("restoreFillGapLayoutInputs"), ctx);
  vm.runInContext(declaration("render") + "\n" + declaration("renderExecView") + "\n" + declaration("fillGapExecDesktop")
    + "\n" + source.slice(registration.start, registration.end), ctx);
  ctx.render();
  return { ctx, state, get html() { return html; }, get overlay() { return overlay; }, get renders() { return renders; },
    get overlayWrites() { return overlayWrites; },
    get fields() { return (sheets.left || sheets.overlay)?.fields; },
    clearSheets() { replaceSheet("left", false); replaceSheet("overlay", false); },
    get pending() { return vm.runInContext("fillGapLayoutInputDraft", ctx); },
    resize(w, h) {
      width = w; height = h;
      // Real MediaQueryList fires only when that registered query changes truth value.
      const changed = media.filter(entry => entry.listeners.length && entry.matches !== matches(entry.query));
      for (const entry of media) entry.matches = matches(entry.query);
      for (const entry of changed) for (const fn of entry.listeners) fn({ matches: entry.matches });
    } };
}

let checked = 0;
for (const legacy of [false, true]) {
  for (const mode of ["plan", "actual"]) {
    const h = harness(legacy);
    h.ctx._execMode = mode;
    h.ctx._scheduleDraft = { date: h.state.selectedDate };
    const before = JSON.stringify(h.state);
    for (const [w, height, two, left] of [
      [390, 844, false, false], [1279, 900, true, false], [1280, 900, true, true],
      [1024, 768, true, false], [1024, 1366, false, false], [1024, 768, true, false],
      [1023, 768, false, false], [1280, 900, true, true], [1279, 1300, false, false]
    ]) {
      h.resize(w, height);
      assert.equal(h.html.includes("exec-two-pane"), two, `${legacy}/${mode}/${w}x${height}: layout`);
      assert.equal(h.html.includes("fill-gap-sheet"), left, "left sheet must match 1280 contract");
      assert.equal(h.overlay.includes("fill-gap-sheet"), !left, "sheet must have exactly one destination");
      assert.equal(JSON.stringify(h.state), before, "resize must preserve full state and selected gap");
      checked++;
    }
  }
  for (const view of ["today", "wbs", "settings", "timeline"]) {
    const h = harness(legacy); h.state.currentView = view;
    h.resize(390, 844); const before = h.renders;
    h.resize(1279, 900);
    assert.equal(h.renders, before, "new landscape listener is exec-only"); checked++;
  }
  for (const type of ["block", "task", "placement", "placementResult", null]) {
    const h = harness(legacy); h.state.modal = type ? { type, date: h.state.selectedDate } : null;
    const before = JSON.stringify(h.state);
    h.resize(390, 844); h.resize(1279, 900); h.resize(1280, 900);
    assert(!h.html.includes("fill-gap-sheet") && !h.overlay.includes("fill-gap-sheet"));
    assert.equal(JSON.stringify(h.state), before); checked++;
  }
  const h = harness(legacy); h.state.modal.date = "2026-09-03";
  h.resize(390, 844); h.resize(1280, 900);
  assert(!h.html.includes("fill-gap-sheet"), "different-date gap cannot replace selected-date list"); checked++;
  const input = harness(legacy);
  input.resize(1024, 768);
  input.ctx.renderModal('<input value="typed unsaved gap title">');
  const writes = input.overlayWrites, element = input.ctx.document.activeElement;
  for (const [w, height] of [[1024, 1366], [1279, 900], [390, 844]]) {
    input.resize(w, height);
    assert.equal(input.overlayWrites, writes, "landscape-only event cannot rebuild overlay");
    assert.equal(input.overlay, '<input value="typed unsaved gap title">');
    assert.equal(input.ctx.document.activeElement, element);
    assert.equal(element.value, "typed gap title"); checked++;
  }
  const wide = harness(legacy), rendered = wide.renders;
  wide.resize(1280, 1600);
  assert.equal(wide.renders, rendered, "wide rotation cannot rebuild left-sheet inputs"); checked++;
}
for (const legacy of [false, true]) {
  const h = harness(legacy, true), before = JSON.stringify(h.state);
  const values = ["未保存の日本語タイトル", "25", "開発", "task:t1", "r1"];
  const set = vals => Object.values(h.fields).forEach((field, i) => { field.value = vals[i]; });
  const get = () => Object.values(h.fields).map(field => field.value);
  set(values); h.fields.fillGapTitle.focus(); h.fields.fillGapTitle.setSelectionRange(2, 5);
  for (const [w, height] of [[1279, 900], [1280, 900], [390, 844], [1280, 900]]) {
    h.resize(w, height); assert.deepEqual(get(), values);
    assert.equal(h.ctx.document.activeElement, h.fields.fillGapTitle);
    assert.equal(h.fields.fillGapTitle.selectionStart, 2); assert.equal(h.fields.fillGapTitle.selectionEnd, 5);
    assert.equal(JSON.stringify(h.state), before); checked++;
  }
  set(["", "", "", "", ""]); h.resize(1279, 900); h.resize(1280, 900);
  assert.deepEqual(get(), ["", "", "", "", ""]); checked++;
  set(values); h.ctx.captureFillGapLayoutInputs(); h.clearSheets(); h.ctx.restoreFillGapLayoutInputs();
  assert(h.pending, "missing destination keeps pending values"); h.ctx.render(); assert.deepEqual(get(), values); checked++;
  h.ctx.captureFillGapLayoutInputs(); h.clearSheets(); h.state.modal = { ...h.state.modal };
  h.ctx.render(); assert.equal(h.pending, null); assert.notDeepEqual(get(), values); checked++;
  for (const mutate of [m => { m.type = "block"; }, m => { m.date = "2026-09-03"; }, m => { m.start = "10:00"; }, m => { m.end = "10:30"; }]) {
    const other = harness(legacy, true); other.fields.fillGapTitle.value = "must not leak";
    other.ctx.captureFillGapLayoutInputs(); mutate(other.state.modal); other.ctx.restoreFillGapLayoutInputs();
    assert.equal(other.pending, null); checked++;
  }
  const absent = harness(legacy, true); absent.clearSheets(); absent.ctx.captureFillGapLayoutInputs();
  absent.ctx.render(); assert.equal(absent.pending, null); checked++;
}
console.log(`PASS exec layout media: ${checked} registered-event cases (browser not run)`);
