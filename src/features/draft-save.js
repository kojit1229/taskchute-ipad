// Only synchronous, audited editor saves may enter this boundary. Never await in work.
import { commitCandidate } from "../core/commit.js";
const content = value => JSON.stringify(value, (key, item) =>
  ["updatedAt", "dataModifiedAt", "lastPushedAt"].includes(key) ? undefined : item);
function changedStamps(before, after) {
  if (!after || typeof after !== "object" || before === after) return [];
  if (Array.isArray(after)) {
    const byId = Array.isArray(before) ? new Map(before.filter(item => item?.id).map(item => [item.id, item])) : null;
    return after.flatMap((row, index) => changedStamps(row?.id && byId ? byId.get(row.id) : before?.[index], row));
  }
  return [after.updatedAt && content(before) !== content(after) ? after.updatedAt : undefined,
    ...Object.keys(after).flatMap(key => changedStamps(before?.[key], after[key]))];
}
export function createDraftSaveTransaction({ getState, setState, persist, now, floors = [], schedule, onFailure, onEffectError = () => {} }) {
  let current = null;
  function fail(error) {
    try { onFailure(error); } catch { /* Error reporting cannot prevent state restoration. */ }
  }
  function runEffect(effect) {
    try { effect(); } catch (error) {
      try { onEffectError(error); } catch { /* Persistence already succeeded; keep finishing the other effects. */ }
    }
  }
  const api = {
    get active() { return Boolean(current); },
    defer(effect, { post = false } = {}) {
      if (!current) return false;
      (post ? current.post : current.ui).push(effect);
      return true;
    },
    complete(effect) {
      if (!current) return false;
      current.ready = true;
      if (effect) current.ui.push(effect);
      return true;
    },
    run(work, { deferPost = false, kinds = null } = {}) {
      const before = getState();
      const transaction = { ready: false, ui: [], post: [] };
      let unchanged = false;
      try {
        const model = { ...before, fields: before };
        const result = commitCandidate({ state: model, now, floors,
          build: snapshot => {
            let draft;
            current = transaction;
            try {
              setState(kinds ? { ...snapshot.fields, ...JSON.parse(JSON.stringify(
                Object.fromEntries(kinds.map(kind => [kind, before[kind]])))) } : JSON.parse(JSON.stringify(before)));
              if (work()?.then) throw new Error("Editor save must remain synchronous");
              if (!transaction.ready) throw Object.assign(new Error("Invalid editor save"), { invalid: true });
              draft = getState();
            } finally { current = null; setState(before); }
            const records = [], values = [], orders = [], candidates = [];
            for (const kind of kinds || new Set([...Object.keys(before), ...Object.keys(draft)])) {
              if (kind === "dataModifiedAt" || content(before[kind]) === content(draft[kind])) continue;
              const old = snapshot[kind], next = draft[kind];
              candidates.push(...changedStamps(before[kind], next));
              if (Array.isArray(old) && Array.isArray(next) && [...old, ...next].every(row => row && typeof row === "object" && row.id)) {
                orders.push([kind, next.map(row => row.id)]);
                // id -> row maps keep editor saves linear in the collection size (review 58b).
                const priorById = new Map(old.map(row => [row.id, row])), nextIds = new Set(next.map(row => row.id));
                if (JSON.stringify([...priorById.keys()]) !== JSON.stringify([...nextIds]))
                  values.push({ kind: "fields", key: kind, before: snapshot.fields[kind], after: next });
                for (const row of old) if (!nextIds.has(row.id)) records.push({ kind, before: row, after: null });
                for (const after of next) {
                  const prior = priorById.get(after.id);
                  if (content(prior) !== content(after)) records.push({ kind, before: prior, after });
                }
              } else values.push({ kind: "fields", key: kind, before: snapshot.fields[kind], after: next });
            }
            transaction.kinds = orders;
            return { records, values, candidates,
              inputs: [{ target: { set value(state) { setState(state); } }, key: "value", before }] };
          },
          persist: saved => {
            setState({ ...saved.fields, ...Object.fromEntries(transaction.kinds.map(([kind, ids]) => {
              const byId = new Map(saved[kind].map(row => [row.id, row]));
              return [kind, ids.map(id => byId.get(id))];
            })), dataModifiedAt: saved.dataModifiedAt });
            return persist();
          }
        });
        if (!result.ok) { fail(result.error); return { ok: false, reason: "storage-failed" }; }
        unchanged = result.unchanged;
      } catch (error) {
        if (error.invalid) return { ok: false, reason: "invalid" };
        fail(error);
        return { ok: false, reason: "exception" };
      }
      if (!unchanged) runEffect(schedule);
      transaction.ui.forEach(runEffect);
      let postPending = true;
      const afterLeave = () => {
        if (!postPending) return;
        postPending = false;
        transaction.post.forEach(runEffect);
      };
      if (!deferPost) afterLeave();
      return { ok: true, afterLeave };
    }
  };
  return api;
}
