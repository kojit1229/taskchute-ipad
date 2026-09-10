export const DAILY_DRAFT_KEY = "taskchute-journal-daily-draft-v1:";

// Deliberately memory-only reads: restoring a previous page session is a later release.
export function createDailyDraftStore({ storage = () => globalThis.sessionStorage } = {}) {
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
      const value = drafts.get(keyOf(owner));
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
