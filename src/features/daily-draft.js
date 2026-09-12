export const DAILY_DRAFT_KEY = "taskchute-journal-daily-draft-v1:";

// Zero sessions share this namespace and connection owner; no independent storage key.
export function createZeroDraftSection(options, connection) {
  const store = createDailyDraftStore({ ...options, restore: true });
  const owner = { kind: "zero", id: "session", draftId: "session", connection };
  return { get: () => store.get(owner), put: value => store.put({ ...value, ...owner }),
    clear: () => store.clear(owner, "discard") };
}

// Existing owners stay memory-only; single schedules opt into same-session restoration.
export function createDailyDraftStore({ storage = () => globalThis.sessionStorage, restore = false } = {}) {
  const drafts = new Map();
  const keyOf = owner => {
    if (!owner || ![owner.kind, owner.id, owner.draftId, owner.connection].every(v => typeof v === "string" && v))
      throw new TypeError("draft owner requires kind/id/draftId/connection");
    return DAILY_DRAFT_KEY + JSON.stringify([owner.kind, owner.id, owner.draftId, owner.connection]);
  };
  const copy = value => JSON.parse(JSON.stringify(value));
  return {
    put(draft) {
      const key = keyOf(draft), value = copy(draft);
      drafts.set(key, value);
      try { storage().setItem(key, JSON.stringify(value)); return { ok: true }; }
      catch (error) { return { ok: false, memoryOnly: true, error }; }
    },
    get(owner) {
      const key = keyOf(owner);
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
      const key = keyOf(owner);
      drafts.delete(key);
      try { storage().removeItem(key); return true; } catch { return false; }
    },
    matches(a, b) { return Boolean(a && b && b.current !== false && keyOf(a) === keyOf(b) && a.fingerprint === b.fingerprint); }
  };
}
