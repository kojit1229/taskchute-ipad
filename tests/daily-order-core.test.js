const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), acorn = require('acorn');
const { orderDailyBlocks: order, nextCopyOrder } = require('../src/core/daily-order.js');
const { runDailyOperation } = require('../src/features/daily-operations.js');
const { commitCandidate } = require('../src/core/commit.js');
const { mergeRecords } = require('../src/core/merge.js');
const date = '2026-09-10', time = date + 'T10:00:00';
const block = (id, extra = {}) => ({ id, date, plannedStartAt: time, orderIndex: 0, createdAt: date + 'T09:00:00', ...extra });
const ids = rows => order(rows).map(b => b.id);
const base = [block('normal', { orderIndex: 6 }), block('p', { orderIndex: 5 }), block('c1', { copiedFromId: 'p', orderIndex: 1 }),
  block('c2', { copiedFromId: 'p', orderIndex: 2 }), block('grand', { copiedFromId: 'c2' }), block('early', { plannedStartAt: date + 'T01:01:00' }),
  block('unscheduled', { plannedStartAt: '' })];
const before = JSON.stringify(base); base.forEach(Object.freeze); Object.freeze(base);
assert.deepEqual(ids(base), ['early', 'p', 'c2', 'grand', 'c1', 'normal', 'unscheduled']);
assert.equal(JSON.stringify(base), before); assert.equal(nextCopyOrder(base, 'p'), 3);
assert.equal(nextCopyOrder([...base, block('deleted', { copiedFromId: 'p', orderIndex: 8, deleted: true })], 'p'), 9);
assert.equal(nextCopyOrder([block('ordinary', { orderIndex: 99 })], 'p'), 1);
assert.deepEqual(ids([block('b'), block('a', { orderIndex: 8 }), block('c', { orderIndex: 3 })]), ['b', 'c', 'a']);
const siblings = [block('p'), block('z', { copiedFromId: 'p', orderIndex: 1 }),
  block('a', { copiedFromId: 'p', orderIndex: 1 }), block('older', { copiedFromId: 'p', orderIndex: 1, createdAt: date + 'T08:00:00' })];
assert.deepEqual(ids(siblings), ['p', 'older', 'a', 'z']);
assert.deepEqual(ids([...siblings].reverse()), ids(siblings), 'same order on another device');
assert.deepEqual(ids([block('p', { deleted: true }), block('c', { copiedFromId: 'p' }), block('a')]), ['a', 'c']);
assert.deepEqual(ids([block('p', { date: '2026-09-11' }), block('c', { copiedFromId: 'p' }), block('a')]), ['a', 'c', 'p']);
assert.deepEqual(ids([block('p'), block('c', { copiedFromId: 'p', plannedStartAt: date + 'T09:00:00' })]), ['c', 'p']);
assert.deepEqual(ids([block('z', { copiedFromId: 'a' }), block('a', { copiedFromId: 'z' }), block('b'), block('self', { copiedFromId: 'self' })]), ['a', 'b', 'self', 'z']);
assert.deepEqual(ids([block('p', { plannedStartAt: '' }), block('c', { plannedStartAt: '', copiedFromId: 'p' }), block('early')]), ['early', 'p', 'c']);
console.log('PASS parent/sibling/descendant order, normal indexes, missing/deleted/moved parents, cycles and undetermined');

// Execute just the actual normalization assignment, without executing unrelated migrations.
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const normalizer = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'normalizeState');
const assignment = normalizer.body.body.find(n => n.type === 'ExpressionStatement'
  && n.expression.left?.object?.name === 'value' && n.expression.left?.property?.name === 'blocks'
  && n.expression.right?.callee?.property?.name === 'map');
assert(assignment);
const context = { value: { blocks: [block('missing'), block('existing', { copiedFromId: 'p' }), block('null', { copiedFromId: null })] }, fixDateTime: x => x || '' };
vm.runInNewContext(source.slice(assignment.start, assignment.end), context);
assert.equal(context.value.blocks[0].copiedFromId, ''); assert.equal(context.value.blocks[1].copiedFromId, 'p');
assert.equal(context.value.blocks[2].copiedFromId, null, 'only absence is defaulted');
const state = { selectedDate: date, blocks: context.value.blocks };
const result = runDailyOperation('daily-plan-times-save', { id: 'existing', kind: 'block', values: { start: '10:00', end: '10:01' } },
  { state, commitCandidate, persist: () => true, now: () => date + 'T12:00:00' });
assert.equal(result.ok, true); assert.equal(state.blocks[1].copiedFromId, 'p');
const remote = JSON.parse(JSON.stringify(state.blocks));
const merged = mergeRecords(context.value.blocks, remote, { compareAt: b => b.updatedAt || b.createdAt || '', tieBreak: local => local });
assert.equal(merged.find(b => b.id === 'existing').copiedFromId, 'p');
assert.equal(merged.find(b => b.id === 'existing').orderIndex, 0);
console.log('PASS actual normalization: missing only; registry edit, serialization and merge retain copy metadata');
let copyProperty;
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'VariableDeclarator' && node.id.name === 'updated' && node.init?.type === 'ObjectExpression')
    copyProperty = node.init.properties.find(p => p.key?.name === 'copiedFromId') || copyProperty;
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value?.type) visit(value);
}
visit(ast); assert(copyProperty, 'actual detail save explicitly preserves copiedFromId');
for (const existing of [undefined, {}, { copiedFromId: 'p' }, { copiedFromId: null }]) {
  const preserved = vm.runInNewContext(source.slice(copyProperty.value.start, copyProperty.value.end), { existing });
  assert.equal(preserved, existing && Object.hasOwn(existing, 'copiedFromId') ? existing.copiedFromId : '');
}
console.log('PASS actual detail-save expression preserves present copy values and defaults absence');
