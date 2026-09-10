const text = (a, b) => String(a ?? "").localeCompare(String(b ?? ""));
const index = block => Number.isFinite(block.orderIndex) ? block.orderIndex : 0;
const identity = (a, b) => text(a.createdAt, b.createdAt) || text(a.id, b.id);

export function nextCopyOrder(blocks, parentId) {
  return blocks.reduce((max, block) => block.copiedFromId === parentId ? Math.max(max, index(block)) : max, 0) + 1;
}

// Work on references in a separate array; never rewrite the ordinary Block's orderIndex.
export function orderDailyBlocks(blocks) {
  const rows = blocks.filter(block => !block.deleted);
  const normal = (a, b) => text(a.date, b.date) || Number(!a.plannedStartAt) - Number(!b.plannedStartAt)
    || text(a.plannedStartAt, b.plannedStartAt)
    || index(a) - index(b) || identity(a, b);
  const byId = new Map(rows.map(block => [block.id, block]));
  const parents = new Map();
  for (const block of rows) {
    const parent = byId.get(block.copiedFromId);
    if (parent && parent.date === block.date && (parent.plannedStartAt || "") === (block.plannedStartAt || ""))
      parents.set(block.id, parent.id);
  }
  // A chain reaching a cycle has no reliable parent order; all such nodes use normal order.
  const cyclic = new Set();
  for (const block of rows) {
    const seen = new Set(); let id = block.id;
    while (parents.has(id) && !seen.has(id)) { seen.add(id); id = parents.get(id); }
    if (seen.has(id)) for (const member of seen) cyclic.add(member);
  }
  for (const id of cyclic) parents.delete(id);
  const children = new Map();
  for (const block of rows) {
    const parent = parents.get(block.id);
    if (parent != null) { if (!children.has(parent)) children.set(parent, []); children.get(parent).push(block); }
  }
  for (const siblings of children.values()) siblings.sort((a, b) => index(b) - index(a) || identity(a, b));
  const stack = rows.filter(block => !parents.has(block.id)).sort(normal).reverse(), ordered = [];
  while (stack.length) {
    const block = stack.pop(); ordered.push(block);
    const descendants = children.get(block.id) || [];
    for (let i = descendants.length - 1; i >= 0; i--) stack.push(descendants[i]);
  }
  return ordered;
}
