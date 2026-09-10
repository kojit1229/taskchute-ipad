import { nextCopyOrder } from "./daily-order.js";

export const COPY_DEFAULTS = {
  taskId: "", date: "", title: "", category: "", plannedStartAt: "", plannedEndAt: "", estimateMin: null,
  expectedCharge: "", expectedDischarge: "", leverageType: "", actualStartAt: "", actualEndAt: "", everStartedAt: "",
  completed: false, charge: 0, discharge: 0, pomodoroCount: 0, interruptions: [], incompleteReason: null,
  comment: "", recurrenceGroupId: "", migratedTo: "", carryCount: 0, isMIT: false,
  source: "", oneTap: false, externalRef: "", label: "", timeswitchStart: false, copiedFromId: "", orderIndex: 0, deleted: false
};
const allowed = ["taskId", "date", "title", "category", "plannedStartAt", "plannedEndAt", "estimateMin", "expectedCharge", "expectedDischarge", "leverageType"];
const invalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });

export function assertCopyable(block, isReadingBlock, state) {
  if (!block || block.deleted) throw invalid("対象が変更されました");
  // The reading owner knows both legacy recurrence IDs and AI identities. Missing ownership fails closed.
  if (typeof isReadingBlock !== "function" || isReadingBlock(block, state) !== false)
    throw invalid("閲覧用Blockは複製できません");
}

export function copyBlockPlan(block, blocks, identity) {
  if (!identity.id || identity.id === block.id || blocks.some(row => row.id === identity.id) || !identity.createdAt)
    throw invalid("複製の識別子を確認してください");
  const plan = Object.fromEntries(allowed.filter(key => Object.hasOwn(block, key)).map(key => [key, block[key]]));
  return { ...COPY_DEFAULTS, ...plan, interruptions: [], id: identity.id, createdAt: identity.createdAt,
    copiedFromId: block.id, orderIndex: nextCopyOrder(blocks, block.id) };
}

export function buildBlockCopy(state, input, deps) {
  const block = state.blocks.find(row => row.id === input.id);
  assertCopyable(block, deps.isReadingBlock, state);
  if (input.kind !== "block" || input.originDate !== state.selectedDate) throw invalid("対象日が変更されました");
  return { records: [{ kind: "blocks", before: null, after: copyBlockPlan(block, state.blocks, input.copyIdentity) }] };
}
