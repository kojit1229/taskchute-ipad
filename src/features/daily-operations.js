import { assertNotInsideBuild } from "../core/commit.js";
import { buildDailyTimes, cancelDailyTimes } from "../core/daily-time.js";

const invalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });
const unwired = name => ({ build: () => { throw invalid(`not wired: ${name}`); } });
const legacy = name => ({ legacy: true, run: (input, deps) => deps.legacy[name](input) });

export const DAILY_OPERATIONS = {
  "daily-plan-times-save": { build: buildDailyTimes, effects: dailyTimesEffects },
  "daily-plan-times-cancel": { build: cancelDailyTimes, effects: dailyTimesEffects },
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
  const date = input.date ?? record?.date ?? input.values?.date;
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
  if (["daily-plan-times-save", "daily-plan-times-cancel"].includes(name)) input = dailyInput(input);
  try {
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
