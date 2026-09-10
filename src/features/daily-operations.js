import { assertNotInsideBuild } from "../core/commit.js";

const invalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });
const unwired = name => ({ build: () => { throw invalid(`not wired: ${name}`); } });
const legacy = name => ({ legacy: true, run: (input, deps) => deps.legacy[name](input) });

export const DAILY_OPERATIONS = {
  "daily-plan-times-save": unwired("daily-plan-times-save"),
  "daily-plan-times-cancel": unwired("daily-plan-times-cancel"),
  "daily-plan-complete": unwired("daily-plan-complete"),
  "daily-block-start": unwired("daily-block-start"),
  "daily-block-end": unwired("daily-block-end"),
  "daily-block-duplicate": unwired("daily-block-duplicate"),
  "daily-duplicate-undo": unwired("daily-duplicate-undo"),
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
  if (input.id != null) {
    const kind = Object.hasOwn(collections, input.kind) && collections[input.kind];
    record = kind && state[kind]?.find(row => row.id === input.id && !row.deleted);
    if (!record) throw invalid("target changed");
  }
  const date = input.date ?? input.values?.date;
  if (date != null && (date !== state.selectedDate || (record?.date && date !== record.date)))
    throw invalid("date changed");
  if (input.baseFingerprint != null
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
  try {
    return deps.commitCandidate({
      state: deps.state, input, persist: deps.persist, now: deps.now, floors: deps.floors,
      build: (state, values) => {
        validateCurrent(state, values, deps);
        return op.build(state, values, deps);
      },
      effects: result => {
        op.effects?.(result, input, deps);
        if (!result.unchanged) deps.scheduleSync?.(result);
      }
    });
  } catch (error) {
    if (error.code !== "DAILY_OPERATION_INVALID") throw error;
    return { ok: false, status: "invalid", error };
  }
}
