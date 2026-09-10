"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const acorn = require("acorn");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const names = ["modalDeleteMessage", "deleteFromModal", "deleteProject", "deleteTask", "deleteBlock"];
const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
const extracted = names.map(name => {
  const node = ast.body.find(item => item.type === "FunctionDeclaration" && item.id.name === name);
  assert(node, name);
  return source.slice(node.start, node.end);
}).join("\n");
const fixture = () => ({
  projects: [{ id: "p", title: "Project example" }, { id: "wish", kind: "wish" }],
  tasks: [{ id: "t", title: "Task example", projectId: "p" }, { id: "child", parentTaskId: "t" }],
  blocks: [{ id: "b", title: "Block example", taskId: "t", date: "2026-09-05", recurrenceGroupId: "r", actualStartAt: "2026-09-05T10:00:00" },
    { id: "next", date: "2026-09-06", recurrenceGroupId: "r" }],
  tracks: [{ id: "track", ownerType: "project", ownerId: "p", status: "active" },
    { id: "old", ownerType: "project", ownerId: "p", status: "completed" }],
  recurrences: [{ id: "r", exceptionDates: [] }],
  questions: [{ id: "q", text: "A question" }], experiments: [{ id: "e", hypothesis: "An experiment" }],
  storeVisits: [{ id: "s" }]
});
let checks = 0;
function setup(type, id, accept = true) {
  const effects = { messages: [], saved: 0, closed: 0 };
  const ctx = vm.createContext({ state: { ...fixture(), modal: { type, id } },
    window: { confirm: text => { effects.messages.push(text); return accept; } },
    nowDateTime: () => "2026-09-06T12:00:00", saveAndRender: () => effects.saved++, showToast: () => {}, render: () => {},
    closeModal: () => effects.closed++,
    // v381(束B2 16a): Task/Project の削除は候補保存境界(draftSaveTransaction→commitCandidate)経由になった。
    // この隔離試験は削除の影響範囲だけを見るので、境界は最小の代役(実行中フラグ・成功応答)で置き換える。
    stamped: (record, stamp) => ({ ...record, updatedAt: stamp }),
    draftSaveTransaction: { active: false, run(work) { this.active = true; try { work(); return { ok: true }; } finally { this.active = false; } } },
    // v381(束B2 15c): Block の削除は commitBlockChanges(Block+例外日を1候補)経由。代役は候補をそのまま採用して成功を返す。
    commitBlockChanges: (blocks, after, recurrences) => { ctx.state.blocks = blocks; if (recurrences) ctx.state.recurrences = recurrences; effects.saved++; if (typeof after === "function") after(); return true; } });
  vm.runInContext(extracted, ctx);
  ctx.dispatchModalDelete = (kind, key) => {
    const fn = { project: ctx.deleteProject, task: ctx.deleteTask, block: ctx.deleteBlock }[kind];
    if (!fn) return false;
    fn(key); return true;
  };
  return { ctx, effects };
}
function check(value, label) { assert(value, label); checks++; }
for (const [type, id] of [["task", ""], ["block", "new-unsaved-id"], ["project", "wish"], ["actualEntry", "b"]]) {
  const { ctx, effects } = setup(type, id);
  const before = JSON.stringify(ctx.state);
  ctx.deleteFromModal();
  check(JSON.stringify(ctx.state) === before && effects.messages.length === 0 && effects.closed === 0, `${type}: no accidental deletion/confirmation`);
}
for (const [type, id] of [["project", "p"], ["task", "t"], ["block", "b"]]) {
  const { ctx, effects } = setup(type, id, false);
  const before = JSON.stringify(ctx.state);
  ctx.deleteFromModal();
  check(JSON.stringify(ctx.state) === before && effects.saved === 0 && effects.closed === 0, `${type}: cancellation preserves all data`);
  check(effects.messages.length === 1 && !effects.messages[0].includes("取り消せます") && !effects.messages[0].includes("deleted"), `${type}: no invented undo/internal flags`);
}
{
  const { ctx, effects } = setup("project", "p");
  const before = JSON.stringify([ctx.state.tasks, ctx.state.blocks]);
  ctx.deleteFromModal();
  check(ctx.state.projects[0].deleted && ctx.state.tracks[0].deleted && !ctx.state.tracks[1].deleted, "project deletes active owned track only");
  check(JSON.stringify([ctx.state.tasks, ctx.state.blocks]) === before, "project does not cascade to tasks/blocks");
  check(effects.messages[0].includes("TaskとBlockは削除しません") && effects.saved === 1 && effects.closed === 1, "project impact agrees with save");
}
{
  const { ctx, effects } = setup("task", "t");
  ctx.deleteFromModal();
  check(ctx.state.tasks[0].deleted && !ctx.state.tasks[1].deleted, "task keeps children");
  check(ctx.state.blocks[0].taskId === "" && ctx.state.blocks[0].actualStartAt && !ctx.state.blocks[0].deleted, "task keeps block actuals and unlinks");
  check(effects.messages[0].includes("紐付けを外して残します"), "task impact agrees with unlink");
}
{
  const { ctx, effects } = setup("block", "b");
  ctx.deleteFromModal();
  check(ctx.state.blocks[0].deleted && !ctx.state.blocks[1].deleted && !ctx.state.tasks[0].deleted, "block keeps future and task");
  check(ctx.state.recurrences[0].exceptionDates.join() === "2026-09-05" && !ctx.state.recurrences[0].deleted, "block only adds selected-day exception");
  check(effects.messages[0].includes("2026-09-05") && effects.messages[0].includes("シリーズは残ります"), "recurrence scope explicit");
  const before = JSON.stringify(ctx.state);
  ctx.deleteFromModal();
  check(JSON.stringify(ctx.state) === before && effects.messages.length === 1, "already-deleted target is inert");
}
console.log(`PASS: modal delete impact (${checks} checks)`);
