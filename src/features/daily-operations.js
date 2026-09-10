import { assertNotInsideBuild } from "../core/commit.js";
import { buildDailyTimes, cancelDailyTimes } from "../core/daily-time.js";
import { assertCopyable, buildBlockCopy } from "../core/block-copy.js";
import { orderDailyBlocks } from "../core/daily-order.js";
import { createCopyUndoTicket, buildCopyUndo } from "../core/copy-undo.js";

const copyReady = Symbol("saved copy source");
const copyRequests = new WeakMap();
const undoReady = Symbol("copy undo owner");
const copyTickets = new WeakMap();

const invalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });
const unwired = name => ({ build: () => { throw invalid(`not wired: ${name}`); } });
const legacy = name => ({ legacy: true, run: (input, deps) => deps.legacy[name](input) });

export const DAILY_OPERATIONS = {
  "daily-plan-times-save": { build: buildDailyTimes, effects: dailyTimesEffects },
  "daily-plan-times-cancel": { build: cancelDailyTimes, effects: dailyTimesEffects },
  "daily-plan-complete": unwired("daily-plan-complete"),
  "daily-block-start": unwired("daily-block-start"),
  "daily-block-end": unwired("daily-block-end"),
  "daily-block-duplicate": { build: buildBlockCopy, effects: copyEffects },
  "daily-duplicate-undo": { build: (state, input, deps) => buildCopyUndo(state, input, { copyFingerprint: dailyFingerprint }), effects: copyUndoEffects },
  "daily-schedule-edit": unwired("daily-schedule-edit"),
  "daily-actual-edit": unwired("daily-actual-edit"),
  "daily-task-complete": unwired("daily-task-complete"),
  "daily-search-change": unwired("daily-search-change"),
  "daily-search-clear": unwired("daily-search-clear"),
  "edit-block": legacy("edit-block"),
  "edit-task": legacy("edit-task"),
  "edit-project": legacy("edit-project"),
  "modal-save": legacy("modal-save"),
  "modal-close": legacy("modal-close"),
  "modal-delete": legacy("modal-delete")
};

function dailyTimesEffects(result, input, deps) {
  const block = result.records[0]?.after || result.block;
  const row = input.target?.closest?.("[data-daily-key]");
  if (row) {
    for (const [name, value] of Object.entries({ start: block.plannedStartAt?.slice(11, 16) || "",
      end: block.plannedEndAt?.slice(11, 16) || "", endNextDay: Boolean(block.plannedEndAt && block.plannedEndAt.slice(0, 10) > block.date) })) {
      const field = row.querySelector(`[data-daily-field="${name}"]`);
      if (field) { if (name === "endNextDay") field.checked = value; else field.value = value; }
    }
  }
  deps.planTimesEffect?.(block, input);
}

// The delegated app entry supplies the element; read draft inputs before entering the pure build.
function dailyInput(input) {
  if (input.values) return input;
  const row = input.target?.closest?.("[data-daily-key]");
  const start = row?.querySelector('[data-daily-field="start"]');
  const end = row?.querySelector('[data-daily-field="end"]');
  return start && end ? { ...input, values: { start: start.value, end: end.value,
    endNextDay: Boolean(row.querySelector('[data-daily-field="endNextDay"]')?.checked) } } : input;
}

function copyEffects(result, input, deps) {
  const copy = result.records[0].after;
  if (!copyTickets.has(deps)) copyTickets.set(deps, new Map());
  copyTickets.get(deps).set(copy.id, createCopyUndoTicket(copy, dailyFingerprint));
  deps.copyEffect?.({ copy, ordered: orderDailyBlocks(deps.state.blocks), highlightedId: copy.id, undoAvailable: true });
  deps.notify?.(copy.plannedStartAt ? "複製しました。同じ予定時刻の枠があります" : "複製しました");
}

export function getCopyUndoTicket(deps, copyId) {
  return copyTickets.get(deps)?.get(copyId) || null;
}

function copyUndoEffects(result, input, deps) {
  if (result.undoStatus === "changed") deps.notify?.("複製は変更されています。詳細から削除してください");
  else if (!result.unchanged) deps.notify?.("この端末で取消・同期待ち");
  deps.copyUndoEffect?.({ id: input.id, status: result.undoStatus, unchanged: Boolean(result.unchanged) });
}

function duplicateDailyBlock(input, deps) {
  const source = deps.state.blocks?.find(row => row.id === input.id && !row.deleted);
  assertCopyable(source, deps.isReadingBlock, deps.state);
  if (input.kind !== "block") throw invalid("Blockを指定してください");
  const key = input.requestId ?? Symbol("copy request");
  if (!copyRequests.has(deps)) copyRequests.set(deps, new Map());
  const requests = copyRequests.get(deps), signature = dailyFingerprint({ id: input.id, values: input.values || null });
  let request = requests.get(key);
  if (request && request.signature !== signature) throw invalid("request changed");
  if (request?.pending) return { ok: false, status: "busy" };
  if (request?.result) return { ...request.result, unchanged: true };
  if (!request) {
    validateCurrent(deps.state, input, deps);
    request = { signature, originDate: deps.state.selectedDate,
      identity: { id: (deps.newId || (() => crypto.randomUUID()))(), createdAt: typeof deps.now === "function" ? deps.now() : deps.now } };
    requests.set(key, request);
  }
  request.pending = true;
  try {
    if (!request.savedInput) {
      const saved = runDailyOperation("daily-plan-times-save", { ...input,
        values: input.values || { start: source.plannedStartAt || "", end: source.plannedEndAt || "" } }, deps);
      if (!saved.ok) {
        if (saved.status === "invalid") requests.delete(key);
        return { ...saved, sourceSaved: false };
      }
      const current = deps.state.blocks.find(row => row.id === input.id);
      request.savedInput = { ...input, values: undefined, date: current.date, originDate: request.originDate,
        baseFingerprint: (deps.fingerprint || dailyFingerprint)(current), copyIdentity: request.identity, [copyReady]: true };
    }
    const result = runDailyOperation("daily-block-duplicate", request.savedInput, deps);
    if (result.ok) request.result = { ...result, sourceSaved: true };
    else deps.notify?.("元の保存は成功しました。複製は保存できませんでした");
    return request.result || { ...result, sourceSaved: true };
  } finally { request.pending = false; }
}

// Supply normalized records (including optional defaults) when issuing fingerprints.
export function dailyFingerprint(value) {
  const ordered = item => !item || typeof item !== "object" ? item
    : Array.isArray(item) ? item.map(ordered)
      : Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered(item[key])]));
  return JSON.stringify(ordered(value));
}

function validateCurrent(state, input, deps) {
  const collections = { block: "blocks", schedule: "blocks", actual: "blocks", task: "tasks", project: "projects" };
  let record;
  if (input.id != null && !input[undoReady]) {
    const kind = Object.hasOwn(collections, input.kind) && collections[input.kind];
    record = kind && state[kind]?.find(row => row.id === input.id && !row.deleted);
    if (!record) throw invalid("target changed");
  }
  const date = input.date ?? record?.date ?? input.values?.date;
  if (!input[copyReady] && !input[undoReady] && date != null && (date !== state.selectedDate || (record?.date && date !== record.date)))
    throw invalid("date changed");
  if (!input[undoReady] && input.baseFingerprint != null
      && (!record || (deps.fingerprint || dailyFingerprint)(record) !== input.baseFingerprint))
    throw invalid("fingerprint changed");
  // Request owners provide a synchronous lookup against this latest state.
  // A supplied request must never pass when no owner is connected.
  if (input.requestId != null && (!deps.currentRequest
      || deps.currentRequest(state, input) !== input.requestId)) throw invalid("request changed");
}

/** Candidate rows use commitCandidate's exact result/rollback contract.
 * Legacy rows already own a transaction and must not enter another boundary.
 * currentRequest(state, input) and fingerprint(record) belong to request/record owners.
 */
export function runDailyOperation(name, input, deps) {
  if (!Object.hasOwn(DAILY_OPERATIONS, name)) throw new Error(`unknown operation: ${name}`);
  assertNotInsideBuild("runDailyOperation");
  const op = DAILY_OPERATIONS[name];
  if (op.legacy) return op.run(input, deps);
  if (["daily-plan-times-save", "daily-plan-times-cancel", "daily-block-duplicate"].includes(name)) input = dailyInput(input);
  if (name === "daily-duplicate-undo") input = { ...input, undoTicket: getCopyUndoTicket(deps, input.id), [undoReady]: true };
  try {
    if (name === "daily-block-duplicate" && !input[copyReady]) return duplicateDailyBlock(input, deps);
    return deps.commitCandidate({
      state: deps.state, input, persist: deps.persist, now: deps.now, floors: deps.floors,
      build: (state, values) => {
        validateCurrent(state, values, deps);
        return op.build(state, values, deps);
      },
      effects: result => {
        // fixB3(73a F1): 保存はすでに成立しているので、同期予約は effects(描画・通知)の成否に依存させない。
        // effects の例外は commitCandidate の契約どおり呼び出し元へ伝える(飲み込まない)。
        try { op.effects?.(result, input, deps); }
        finally { if (!result.unchanged) deps.scheduleSync?.(result); }
      }
    });
  } catch (error) {
    if (error.code !== "DAILY_OPERATION_INVALID") throw error;
    return { ok: false, status: "invalid", error };
  }
}
