"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const acorn = require("acorn");
const root = path.join(__dirname, "..");
const feature = fs.readFileSync(path.join(root, "src/features/draft-leave.js"), "utf8").replace("export function", "function");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
const names = ["modalDraftSnapshot", "requestDraftLeave", "discardZtWrite", "closeZtEdit", "setView", "closeFillGapAware", "closeFillGapNow"];
const extracted = names.map(name => {
  const node = ast.body.find(n => n.type === "FunctionDeclaration" && n.id.name === name);
  assert(node, name);
  return source.slice(node.start, node.end);
}).join("\n");
let count = 0;
function check(value, label) { assert(value, label); count++; }
function setup({ modal = null, writing = false, editing = false, value = "draft", saved = "original", valid = true, storageError = false } = {}) {
  const effects = { saved: 0, left: 0, focus: 0, rendered: 0, dialogs: [] };
  const input = { value, isConnected: true, focus: () => effects.focus++ };
  const document = {
    activeElement: input,
    querySelector: selector => selector === "#zt-write-input" && writing || selector === "#zt-edit-input" && editing ? input : null,
    createElement: () => ({ setAttribute() {}, showModal() {}, close() {}, remove() {} }),
    body: { append: dialog => effects.dialogs.push(dialog) }
  };
  const fields = [{ dataset: { modalField: "comment" }, type: "textarea", value: saved }];
  const state = { modal, currentView: "zero", zeroThinking: { entries: [{ id: "past", body: saved, date: "2026-09-05" }] } };
  const ctx = vm.createContext({ document, state, today: "2026-09-06", todayISO: () => ctx.today, modalRoot: { firstElementChild: { isConnected: true }, classList: { contains: () => Boolean(ctx.state.modal) }, querySelectorAll: selector => selector === "[data-modal-field]" ? fields : [] },
    ztCurrent: writing ? { id: "theme" } : null, ztEditId: editing ? "past" : null,
    ztWriteStartedAt: 12, _execMode: "plan", _lastSaveError: storageError,
    stopZtTimer() {}, persistLocalNoSchedule() {}, fillGapExecDesktop: () => false,
    render: () => effects.rendered++, renderDeferringForFocus: () => effects.rendered++,
    submitModal: () => { effects.saved++; if (valid && !storageError) state.modal = null; return { ok: valid && !storageError }; },
    closeModal: () => { state.modal = null; },
    saveZtEntry: () => { effects.saved++; if (valid && !storageError) ctx.ztCurrent = null; return { ok: valid && !storageError }; },
    saveZtEdit: () => { effects.saved++; if (valid && !storageError) ctx.ztEditId = null; return { ok: valid && !storageError }; }
  });
  vm.runInContext(feature + "\nconst draftLeaveGuard = createDraftLeaveGuard(document); let modalDraftBaseline;\n" + extracted, ctx);
  vm.runInContext("modalDraftBaseline = modalDraftSnapshot()", ctx);
  fields[0].value = value;
  const resolve = choice => vm.runInContext(`draftLeaveGuard.resolve(${JSON.stringify(choice)})`, ctx);
  return { ctx, effects, fields, input, resolve, active: () => vm.runInContext("draftLeaveGuard.active", ctx) };
}
for (const kind of ["task", "project", "block"]) {
  for (const choice of ["save", "stay", "discard"]) {
    const x = setup({ modal: { type: kind, id: "item" } });
    x.ctx.setView("wbs");
    check(x.ctx.state.currentView === "zero" && x.active(), `${kind}: navigation deferred`);
    x.resolve(choice);
    check(x.ctx.state.currentView === (choice === "stay" ? "zero" : "wbs"), `${kind}: ${choice} navigation`);
    check(x.effects.saved === (choice === "save" ? 1 : 0), `${kind}: ${choice} save count`);
    if (choice === "stay") check(x.fields[0].value === "draft" && x.effects.focus === 1, `${kind}: draft/focus retained`);
  }
}
for (const mode of ["writing", "editing"]) {
  for (const choice of ["save", "stay", "discard"]) {
    const x = setup({ [mode]: true });
    x.ctx.setView("today");
    check(x.ctx.state.currentView === "zero" && x.active(), `${mode}: tab does not erase draft`);
    x.resolve(choice);
    check(x.ctx.state.currentView === (choice === "stay" ? "zero" : "today"), `${mode}: ${choice}`);
    check(x.effects.saved === (choice === "save" ? 1 : 0), `${mode}: saves only explicitly`);
  }
}
for (const options of [{ valid: false }, { storageError: true }]) {
  const x = setup({ modal: { type: "block" }, ...options });
  x.ctx.setView("today"); x.resolve("save");
  check(x.ctx.state.currentView === "zero", "validation/storage error prevents continuation");
}
{
  const x = setup({ modal: { type: "block" } });
  x.ctx.requestDraftLeave(() => x.effects.left++, { allowDiscard: false });
  check(!x.effects.dialogs[0].innerHTML.includes('data-action="draft-leave-discard"'), "instant completion offers no discard");
  x.resolve("discard");
  check(x.active() && x.effects.left === 0, "discard cannot bypass required save");
  x.resolve("save"); x.resolve("save");
  check(x.effects.saved === 1 && x.effects.left === 1, "double save executes once");
}
{
  const x = setup({ modal: { type: "task" }, value: "original" });
  x.ctx.closeFillGapAware();
  check(!x.active() && !x.ctx.state.modal, "unchanged form closes directly");
}
for (const mode of ["writing", "editing"]) {
  const x = setup({ [mode]: true });
  (mode === "writing" ? x.ctx.discardZtWrite : x.ctx.closeZtEdit)();
  check(x.active() && x.effects.rendered === 0, `${mode}: cancel uses same guard`);
  x.resolve("stay");
  check(x.input.value === "draft" && x.effects.rendered === 0, `${mode}: keep editing without redraw`);
}

// Owner changes must cancel the old action rather than save the replacement form.
for (const change of [
  x => { x.ctx.modalRoot.firstElementChild = { isConnected: true }; },
  x => { x.ctx.modalRoot.firstElementChild.isConnected = false; },
  x => { x.ctx.state.modal = null; },
  x => { x.ctx.state.currentView = "other-view"; }
]) for (const choice of ["save", "discard", "stay"]) {
  const x = setup({ modal: { type: "block", id: "item" } });
  x.ctx.requestDraftLeave(() => x.effects.left++); change(x); x.resolve(choice);
  check(x.effects.saved === 0 && x.effects.left === 0 && x.effects.focus === 0 && !x.active(), "stale modal owner stops every action");
}
for (const mode of ["writing", "editing"]) {
  const x = setup({ [mode]: true }); x.ctx.requestDraftLeave(() => x.effects.left++);
  if (mode === "writing") x.ctx.today = "2026-09-07";
  else x.ctx.state.zeroThinking.entries[0].date = "2026-09-04";
  x.resolve("save"); check(x.effects.saved === 0 && x.effects.left === 0, "changed zero-thinking date refuses save");
}

console.log(`PASS: draft leave guard (${count} checks)`);
