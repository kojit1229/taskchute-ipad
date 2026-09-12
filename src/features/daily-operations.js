import { assertNotInsideBuild } from "../core/commit.js";
import { markDailyReadingEdit } from "../core/daily-reading.js";
import { buildDailyTimes, cancelDailyTimes } from "../core/daily-time.js";
import { assertCopyable, buildBlockCopy } from "../core/block-copy.js";
import { orderDailyBlocks } from "../core/daily-order.js";
import { createCopyUndoTicket, buildCopyUndo } from "../core/copy-undo.js";
import { buildBlockStart } from "../core/daily-start.js";
import { buildBlockEnd } from "../core/daily-end.js";
import { buildPlanCompletion, buildTaskCompletion } from "../core/daily-completion.js";
import { createDailyDraftStore } from "./daily-draft.js";
import { singleScheduleOperation } from "./single-schedule.js";
import { buildActualEdit } from "../core/daily-actuals.js";
import { buildDailyReport, affectedReportDates } from "../core/daily-report.js";
import { gapPlacementOperation } from "./daily-gap-placement.js";
import { zeroEntryOperation } from "./zero-entry.js";
import { towerJournalOperation } from "./tower-journal.js";
import { dailyReadingOpenOperation, dailyReadingRecordOperation } from "./daily-reading.js";

const copyReady = Symbol("saved copy source");
const copyRequests = new WeakMap();
const undoReady = Symbol("copy undo owner");
const copyTickets = new WeakMap();
const startOwners = new WeakMap();

const invalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });
const unwired = name => ({ build: () => { throw invalid(`not wired: ${name}`); } });
const legacy = name => ({ legacy: true, run: (input, deps) => deps.legacy[name](input) });

export const DAILY_OPERATIONS = {
  "daily-reading-open": dailyReadingOpenOperation,
  "daily-reading-record": dailyReadingRecordOperation,
  "save-tower-journal": towerJournalOperation,
  "zero-draft-save": zeroEntryOperation("draft"),
  "zero-complete": zeroEntryOperation("complete"),
  "zero-leave": zeroEntryOperation("leave"),
  "daily-plan-times-save": { build: buildDailyTimes, effects: dailyTimesEffects },
  "daily-plan-times-cancel": { build: cancelDailyTimes, effects: dailyTimesEffects },
  "daily-plan-complete": { build: buildPlanCompletion, effects: planCompletionEffects },
  "daily-block-start": { build: buildBlockStart, effects: startEffects },
  "daily-block-end": { build: buildBlockEnd, effects: endEffects },
  "daily-block-duplicate": { build: buildBlockCopy, effects: copyEffects },
  "daily-duplicate-undo": { build: (state, input, deps) => buildCopyUndo(state, input, { copyFingerprint: dailyFingerprint }), effects: copyUndoEffects },
  "daily-schedule-add": singleScheduleOperation("add"),
  "daily-schedule-edit": singleScheduleOperation("edit"),
  "daily-schedule-complete": singleScheduleOperation("complete"),
  "daily-schedule-delete": singleScheduleOperation("delete"),
  "daily-gap-place": gapPlacementOperation("block"),
  "daily-gap-create": gapPlacementOperation("task"),
  "daily-actual-edit": { build: buildActualEdit, effects: actualEditEffects },
  "daily-report-refresh": { build: buildDailyReport, effects: (result, input, deps) => deps.reportEffect?.(result, input) },
  "daily-task-complete": { build: buildTaskCompletion, effects: taskCompletionEffects },
  "daily-search-change": unwired("daily-search-change"),
  "daily-search-clear": unwired("daily-search-clear"),
  "edit-block": legacy("edit-block"),
  "edit-task": legacy("edit-task"),
  "edit-project": legacy("edit-project"),
  "modal-save": legacy("modal-save"),
  "modal-close": legacy("modal-close"),
  "modal-delete": legacy("modal-delete")
};

function startOwner(deps, id) {
  if (!startOwners.has(deps)) startOwners.set(deps, createDailyDraftStore());
  return { store: startOwners.get(deps), owner: { kind: "block", id, draftId: "start",
    connection: deps.connection || "local" } };
}

export function getDailyStartDraft(deps, id) {
  const { store, owner } = startOwner(deps, id);
  const draft = store.get(owner), block = deps.state.blocks?.find(row => row.id === id && !row.deleted);
  if (draft?.saved && (draft.at !== block?.actualStartAt || (draft.declarationId
      && !deps.state.declarations?.some(row => row.id === draft.declarationId && row.blockId === id
        && row.declaredAt === block.actualStartAt && !row.deleted)))) return undefined;
  return draft;
}

function startInput(input, deps) {
  if (input.kind !== "block" || !deps.state.blocks?.some(row => row.id === input.id && !row.deleted))
    throw invalid("開始する予定を確認してください");
  const { store, owner } = startOwner(deps, input.id);
  let draft = getDailyStartDraft(deps, input.id);
  if (draft && input.requestId != null && draft.requestId !== input.requestId) throw invalid("request changed");
  if (!draft) {
    draft = { ...owner, requestId: input.requestId ?? null, date: deps.state.blocks.find(row => row.id === input.id).date,
      at: typeof deps.now === "function" ? deps.now() : deps.now,
      declarationId: (deps.newId || (() => crypto.randomUUID()))() };
    store.put(draft);
  }
  return { ...input, startDraft: draft };
}

function startEffects(result, input, deps) {
  if (result.unchanged) return;
  const { store, owner } = startOwner(deps, input.id);
  store.put({ ...owner, ...input.startDraft, declarationId: result.declarationId, saved: true });
  deps.startEffect?.(result, input);
}

export function prepareDailyEnd(input, deps) {
  const block = deps.state.blocks?.find(row => row.id === input.id && !row.deleted);
  if (!block || input.kind !== "block") throw invalid("終了する予定を確認してください");
  const { store, owner } = startOwner(deps, input.id);
  owner.draftId = "end";
  let draft = input.endDraft || store.get(owner);
  if (!input.endDraft && draft && (draft.actualStartAt !== block.actualStartAt
      || (draft.saved && draft.actualEndAt !== block.actualEndAt)
      || (draft.declarationId && !deps.state.declarations?.some(row => row.id === draft.declarationId
        && row.blockId === block.id && !row.deleted && (!row.declaredAt || row.declaredAt === block.actualStartAt))))) draft = null;
  if (draft && input.requestId != null && draft.requestId !== input.requestId) throw invalid("request changed");
  if (!draft) {
    const started = getDailyStartDraft(deps, input.id);
    const declarations = deps.state.declarations?.filter(row => row.blockId === block.id && !row.deleted
      && block.actualStartAt && row.declaredAt === block.actualStartAt) || [];
    draft = { ...owner, requestId: input.requestId ?? null, date: block.date, actualStartAt: block.actualStartAt,
      actualEndAt: (block.completed && block.actualEndAt) || (typeof deps.now === "function" ? deps.now() : deps.now),
      declarationId: started?.saved && started.at === block.actualStartAt ? started.declarationId
        : declarations.length === 1 ? declarations[0].id : "",
      fallbackId: (deps.newId || (() => crypto.randomUUID()))() };
  }
  if (input.confirmDate === block.date) draft = { ...draft, date: block.date };
  if (input.declarationId !== undefined) draft = { ...draft, declarationId: input.declarationId };
  store.put(draft);
  return { ...input, endDraft: draft };
}

function endEffects(result, input, deps) {
  if (result.unchanged) return;
  const { store, owner } = startOwner(deps, input.id);
  owner.draftId = "end";
  store.put({ ...input.endDraft, ...owner, declarationId: result.declarationId,
    actualEndAt: result.block.actualEndAt, saved: true });
  deps.endEffect?.(result, input);
}

function planCompletionEffects(result, input, deps) {
  if (result.confirmEnd) deps.requestPlanEnd?.(result.block, input);
  else if (!result.unchanged) deps.planCompletionEffect?.(result.block, input);
}

function taskCompletionEffects(result, input, deps) {
  if (!result.unchanged) deps.taskCompletionEffect?.(result, input);
}

function actualEditEffects(result, input, deps) {
  deps.actualEditEffect?.(result, input);
}

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
  // fixB4(78b 中1): 日付の照合は入力が日付を持つときだけ行う(対象 Block の date を既定にすると、
  // 日付なしの操作=開始・終了・複製・取消が閲覧日と違う日の Block(前日から続く実行中など)で拒否される)。
  const date = input.date ?? input.values?.date;
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
    if (op.prepare) input = op.prepare(input, deps);
    if (name === "daily-block-start") input = startInput(input, deps);
    if (name === "daily-block-end") input = prepareDailyEnd(input, deps);
    if (name === "daily-block-duplicate" && !input[copyReady]) return duplicateDailyBlock(input, deps);
    return deps.commitCandidate({
      state: deps.state, input, persist: deps.persist, now: deps.now, floors: deps.floors,
      build: (state, values) => {
        // Schedule owners validate candidate id/fingerprint, independent of the viewed date.
        if (!op.prepare) validateCurrent(state, values, deps);
        const candidate = op.build(state, values, deps);
        if (name !== "daily-reading-record" && candidate.records) candidate.records = candidate.records.map(row =>
          row.kind === "blocks" ? { ...row, after: markDailyReadingEdit(row.before, row.after) } : row);
        return candidate;
      },
      effects: result => {
        // fixB3(73a F1): 保存はすでに成立しているので、同期予約は effects(描画・通知)の成否に依存させない。
        // effects の例外は commitCandidate の契約どおり呼び出し元へ伝える(飲み込まない)。
        try { op.effects?.(result, input, deps); }
        finally {
          if (!result.unchanged) {
            try {
              if (name !== "daily-reading-record" && deps.refreshActualReports && (name !== "daily-plan-times-save"
                  || result.records.some(row => row.before?.date !== row.after?.date))) {
                const dates = affectedReportDates(deps.state, result);
                if (dates.length) deps.refreshActualReports(dates);
              }
            }
            finally { deps.scheduleSync?.(result); }
          }
        }
      }
    });
  } catch (error) {
    if (error.code !== "DAILY_OPERATION_INVALID") throw error;
    return { ok: false, status: "invalid", error };
  }
}
