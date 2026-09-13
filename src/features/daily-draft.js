export const DAILY_DRAFT_KEY = "taskchute-journal-daily-draft-v1:";

// Zero sessions share this namespace and connection owner; no independent storage key.
export function createZeroDraftSection(options, connection) {
  const store = createDailyDraftStore({ ...options, restore: true });
  const owner = { kind: "zero", id: "session", draftId: "session", connection };
  return { get: () => store.get(owner), put: value => store.put({ ...value, ...owner }),
    clear: () => store.clear(owner, "discard") };
}

// Reload recovery requires a matching live editor; single schedules may read their exact key.
export function createDailyDraftStore({ storage = () => globalThis.sessionStorage, restore = false } = {}) {
  const drafts = new Map();
  const keyOf = owner => {
    if (!owner || ![owner.kind, owner.id, owner.draftId, owner.connection].every(v => typeof v === "string" && v))
      throw new TypeError("draft owner requires kind/id/draftId/connection");
    return DAILY_DRAFT_KEY + JSON.stringify([owner.kind, owner.id, owner.draftId, owner.connection]);
  };
  const copy = value => JSON.parse(JSON.stringify(value));
  const reload = new Map(), recovered = new Map();
  try {
    const source = storage();
    for (let i = 0; i < source.length; i++) {
      const key = source.key(i);
      if (!key?.startsWith(DAILY_DRAFT_KEY)) continue;
      try {
        const value = JSON.parse(source.getItem(key));
        if (value && keyOf(value) === key) reload.set(key, value);
      } catch { /* Leave malformed backups untouched. */ }
    }
  } catch { /* Storage denial leaves current-page drafts available. */ }
  return {
    recover(owner, apply) {
      if (!owner?.current || !owner.fingerprint || owner.fingerprint === "null") return false;
      const matches = [...reload].filter(([, saved]) => saved.current !== false
        && ["kind", "id", "connection", "date", "fingerprint"].every(field => saved[field] === owner[field]));
      if (matches.length !== 1) return false;
      const [key, saved] = matches[0];
      if (!apply(copy(saved))) return false;
      recovered.set(keyOf(owner), { key, draftId: saved.draftId, requestId: saved.requestId });
      drafts.set(key, copy(saved));
      reload.delete(key);
      return true;
    },
    put(draft) {
      const alias = recovered.get(keyOf(draft));
      const key = alias?.key || keyOf(draft), value = copy(alias
        ? { ...draft, draftId: alias.draftId, requestId: alias.requestId } : draft);
      drafts.set(key, value);
      try { storage().setItem(key, JSON.stringify(value)); return { ok: true }; }
      catch (error) { return { ok: false, memoryOnly: true, error }; }
    },
    get(owner) {
      const key = recovered.get(keyOf(owner))?.key || keyOf(owner);
      if (restore && !drafts.has(key)) {
        try {
          const saved = JSON.parse(storage().getItem(key));
          if (saved && keyOf(saved) === key) drafts.set(key, saved);
        } catch { /* A broken draft never changes synchronized state. */ }
      }
      const value = drafts.get(key);
      return value ? copy(value) : null;
    },
    clear(owner, reason) {
      if (!["saved", "discard"].includes(reason)) return false;
      const key = recovered.get(keyOf(owner))?.key || keyOf(owner);
      drafts.delete(key);
      reload.delete(key);
      try { storage().removeItem(key); return true; } catch { return false; }
    },
    matches(a, b) { return Boolean(a && b && b.current !== false && keyOf(a) === keyOf(b) && a.fingerprint === b.fingerprint); }
  };
}
