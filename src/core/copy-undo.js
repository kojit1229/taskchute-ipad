import { COPY_DEFAULTS } from "./block-copy.js";

export function normalizeCopyRecord(block) {
  return { ...COPY_DEFAULTS, createdAt: "", updatedAt: "", ...block };
}

export function createCopyUndoTicket(block, fingerprint) {
  return Object.freeze({ copyId: block.id, fingerprint: fingerprint(normalizeCopyRecord(block)) });
}

export function canUndoCopy(block, ticket, fingerprint) {
  return Boolean(block && ticket && block.id === ticket.copyId && !block.deleted && !block.completed
    && !block.actualStartAt && !block.actualEndAt && !block.everStartedAt
    && fingerprint(normalizeCopyRecord(block)) === ticket.fingerprint);
}

export function buildCopyUndo(state, input, deps) {
  if (input.kind !== "block" || !input.id)
    throw Object.assign(new Error("Blockを指定してください"), { code: "DAILY_OPERATION_INVALID" });
  const block = state.blocks.find(row => row.id === input.id), ticket = input.undoTicket;
  if (!ticket) return { records: [], undoStatus: "hidden" };
  if (!block || block.deleted) return { records: [], undoStatus: "deleted" };
  if (!canUndoCopy(block, ticket, deps.copyFingerprint)) return { records: [], undoStatus: "changed" };
  return { records: [{ kind: "blocks", before: block, after: { ...block, deleted: true } }], undoStatus: "deleted" };
}
