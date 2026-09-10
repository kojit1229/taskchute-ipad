import { nextMutationStamp, stamped } from "./mutation-stamp.js";

let active = false;
let commitGuard = null;
export function setCommitGuard(guard) { commitGuard = guard; }
let insideBuild = false;
let buildViolation = null;

export function assertNotInsideBuild(name) {
  if (insideBuild) throw (buildViolation = new Error(`${name} is forbidden inside build`));
}

// JSON state is exposed through a deep read-only view; returned records retain originals.
function buildView(state) {
  const views = new WeakMap(), originals = new WeakMap();
  const reject = () => { throw (buildViolation = new TypeError("build must not mutate state")); };
  const verify = commitGuard?.(state, reject) || (() => {});
  const view = value => {
    if (!value || typeof value !== "object") return value;
    if (!views.has(value)) {
      const proxy = new Proxy(value, {
        get: (target, key) => view(Reflect.get(target, key)),
        set: reject, deleteProperty: reject, defineProperty: reject,
        setPrototypeOf: reject, preventExtensions: reject
      });
      views.set(value, proxy);
      originals.set(proxy, value);
    }
    return views.get(value);
  };
  const unwrap = value => {
    if (!value || typeof value !== "object") return value;
    if (originals.has(value)) return originals.get(value);
    return Array.isArray(value) ? value.map(unwrap)
      : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrap(item)]));
  };
  return { state: view(state), unwrap, verify };
}

/** records: {kind: state collection key, key?: map key, before, after}; null means absent.
 * values: {kind, key, before, after}; replace values without adding record stamps.
 * values with kind:null replace a root field; syncStamp preserves an adopted/acknowledged clock.
 * inputs: {target, key, before}; candidates: pending/merged global stamp lower bounds.
 * persist(state) is synchronous and returns true/{ok:true}; effects errors propagate.
 */
export function commitCandidate({ state, input, build, effects = () => {}, persist, now, floors = [], syncStamp }) {
  assertNotInsideBuild("nested commitCandidate");
  if (active) throw new Error("nested commitCandidate is forbidden");
  active = true;
  try {
    const view = buildView(state);
    let candidate;
    insideBuild = true;
    buildViolation = null;
    try {
      candidate = build(view.state, input);
      if (candidate && typeof candidate.then === "function") {
        Promise.resolve(candidate).catch(() => {});
        throw new TypeError("build must be synchronous (no await/thenable)");
      }
      if (buildViolation) throw buildViolation;
    } finally { insideBuild = false; view.verify(); }
    if ((Object.hasOwn(candidate, "records") || Object.hasOwn(candidate, "values"))
        && !candidate.records?.length && !candidate.values?.length) {
      active = false;
      const result = { ...candidate, ok: true, unchanged: true };
      effects(result);
      return result;
    }
    const undo = [];
    let result;
    try {
      const clock = typeof now === "function" ? now() : now;
      const records = (candidate.records || []).map(record => {
        const before = view.unwrap(record.before), after = view.unwrap(record.after);
        return { ...record, before, after: after == null ? after : stamped(after,
          nextMutationStamp({ now: clock, candidates: [before?.updatedAt || before?.createdAt, after.updatedAt] })) };
      });
      const stamp = syncStamp ?? nextMutationStamp({ now: clock, candidates: [state.dataModifiedAt,
        state.lastPushedAt, state.settings?.lastPushedAt, ...(typeof floors === "function" ? floors() : floors), ...(candidate.candidates || []),
        ...records.flatMap(record => [record.before?.updatedAt || record.before?.createdAt, record.after?.updatedAt])] });
      // Work on replacement collections first; failure restores the exact prior references.
      const collections = new Map();
      for (const { kind, key, before, after } of records) {
        if (!Object.hasOwn(state, kind) || !state[kind] || typeof state[kind] !== "object") {
          throw new TypeError("record kind must name an existing state collection");
        }
        if (!collections.has(kind)) collections.set(kind,
          Array.isArray(state[kind]) ? [...state[kind]] : { ...state[kind] });
        const collection = collections.get(kind);
        if (Array.isArray(collection)) {
          const index = before == null ? collection.length : collection.indexOf(before);
          if (index < 0) throw new Error("record before is stale");
          collection.splice(index, before == null ? 0 : 1, ...(after == null ? [] : [after]));
        } else {
          if (key == null || collection[key] !== before) throw new Error("record key/before is stale");
          if (after == null) delete collection[key];
          else Object.defineProperty(collection, key, { value: after, writable: true, enumerable: true, configurable: true });
        }
      }
      for (const value of candidate.values || []) {
        const { kind, key } = value, before = view.unwrap(value.before), after = view.unwrap(value.after);
        const target = kind == null ? state : state[kind];
        if (!target || typeof target !== "object" || key == null || target[key] !== before)
          throw new Error("value kind/key/before is stale");
        if (kind == null) { collections.set(key, after); continue; }
        if (!collections.has(kind)) collections.set(kind,
          Array.isArray(state[kind]) ? [...state[kind]] : { ...state[kind] });
        const collection = collections.get(kind);
        Object.defineProperty(collection, key, { value: after, writable: true, enumerable: true, configurable: true });
      }
      for (const [key, value] of [...collections, ["dataModifiedAt", stamp]]) {
        const descriptor = Object.getOwnPropertyDescriptor(state, key);
        undo.push(() => descriptor ? Object.defineProperty(state, key, descriptor) : delete state[key]);
        state[key] = value;
      }
      const saved = persist(state);
      if (saved?.then || !(saved === true || saved?.ok === true)) {
        throw saved?.error || new Error("local persistence failed (synchronous success required)");
      }
      result = { ...candidate, records, dataModifiedAt: stamp, ok: true };
    } catch (error) {
      for (const restore of undo.reverse()) restore();
      for (const { target, key, before } of candidate?.inputs || []) target[key] = before;
      return { ok: false, error };
    }
    active = false;
    effects(result);
    return result;
  } finally { active = false; }
}
