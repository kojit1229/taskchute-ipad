import { createZeroDraftSection } from "./daily-draft.js";
import { createZeroEntryDraft, sameZeroAnswer, stopZeroEntry } from "./zero-entry.js";

const copy = value => JSON.parse(JSON.stringify(value));
const own = (value, key) => Object.hasOwn(value, key);
const record = value => value && typeof value === "object" && !Array.isArray(value);
const validDraft = (draft, id, connection) => record(draft) && draft.version === 1
  && draft.kind === "zero" && draft.id === id && draft.draftId === id && draft.requestId === id
  && draft.connection === connection && typeof draft.body === "string"
  && typeof draft.themeId === "string" && record(draft.theme) && draft.theme.id === draft.themeId
  && typeof draft.baseFingerprint === "string" && typeof draft.date === "string";

// This adapter is the zeroDrafts receiver of zero-entry. It never writes synchronized state.
export function createZeroSession({ connection, storage, nowMs = () => Date.now() }) {
  const section = createZeroDraftSection({ storage }, connection);
  let data = { version: 1, connectionKey: connection, selectedThemeId: null, themeToDraft: {}, drafts: {} };
  let memoryOnly = false, loadError = null;
  const restored = new Set();
  try {
    const saved = section.get();
    if (saved) {
      if (saved.version !== 1 || saved.connectionKey !== connection || !record(saved.drafts)
          || !record(saved.themeToDraft) || !(saved.selectedThemeId === null || typeof saved.selectedThemeId === "string")
          || !Object.entries(saved.drafts).every(([id, draft]) => validDraft(draft, id, connection))
          || !Object.entries(saved.themeToDraft).every(([id, draftId]) => own(saved.drafts, draftId)
            && saved.drafts[draftId].themeId === id && !saved.drafts[draftId].completed)) throw Error("invalid zero session");
      data = saved;
      Object.keys(data.drafts).forEach(id => restored.add(id));
    }
  } catch (error) { loadError = error; }
  function persist() {
    try {
      const result = section.put(data);
      memoryOnly = !result.ok;
      return result;
    } catch (error) { memoryOnly = true; return { ok: false, memoryOnly: true, error }; }
  }
  const unbind = id => {
    for (const themeId of Object.keys(data.themeToDraft)) {
      if (data.themeToDraft[themeId] === id) delete data.themeToDraft[themeId];
    }
  };
  function put(draft) {
    try {
      if (!validDraft(draft, draft?.id, connection)) throw Error("zero owner changed");
      const value = copy(draft); // Reject unserializable input before replacing the in-memory draft.
      Object.defineProperty(data.drafts, draft.id, { value, writable: true, enumerable: true, configurable: true });
      if (draft.completed) unbind(draft.id);
      return persist();
    } catch (error) { return { ok: false, memoryOnly: true, error }; }
  }
  function remove(id) {
    unbind(id); delete data.drafts[id]; restored.delete(id);
    if (Object.keys(data.drafts).length) return persist();
    data.selectedThemeId = null;
    try { const ok = section.clear(); memoryOnly = !ok; return { ok, memoryOnly }; }
    catch (error) { memoryOnly = true; return { ok: false, memoryOnly: true, error }; }
  }
  function inspect(id, state) {
    const draft = own(data.drafts, id) ? data.drafts[id] : null;
    if (!draft) return { status: "missing" };
    const entry = state.zeroThinking?.entries?.find(row => row.id === id);
    if (entry) return { status: sameZeroAnswer(entry, draft) ? "completed" : "conflict", draft: copy(draft), entry: copy(entry) };
    const theme = state.zeroThinking?.themes?.find(row => row.id === draft.themeId);
    if (!theme || JSON.stringify(theme) !== draft.baseFingerprint || draft.completed)
      return { status: "conflict", draft: copy(draft) };
    return { status: restored.has(id) ? "confirm" : "ready", draft: copy(draft) };
  }
  function restore(id, state, confirmed = false) {
    const result = inspect(id, state);
    if (result.status === "completed") return { ...result, cleanup: remove(id) };
    if (result.status === "conflict" || result.status === "missing" || (result.status === "confirm" && !confirmed)) return result;
    restored.delete(id);
    data.selectedThemeId = result.draft.themeId;
    return { ...result, status: "ready", stored: persist() };
  }
  return {
    put,
    get: owner => owner?.connection === connection && own(data.drafts, owner.id) ? copy(data.drafts[owner.id]) : null,
    inspect, restore,
    snapshot: () => copy(data),
    status: () => ({ memoryOnly, loadError }),
    retry: persist,
    remaining: id => own(data.drafts, id) ? Math.max(0, Math.ceil((data.drafts[id].deadline - nowMs()) / 1000)) : 0,
    discard: id => own(data.drafts, id) ? remove(id) : { ok: false, status: "missing" },
    select(theme, fields, { state, confirmed = false, newWriting = false, currentDraft } = {}) {
      const oldId = own(data.themeToDraft, theme.id) ? data.themeToDraft[theme.id] : null;
      const selectedId = data.themeToDraft[data.selectedThemeId];
      currentDraft ||= own(data.drafts, selectedId) ? data.drafts[selectedId] : null;
      if (oldId && !newWriting) {
        if (currentDraft?.id === oldId && !restored.has(oldId)) return { status: "ready", draft: currentDraft };
        if (currentDraft && currentDraft.id !== oldId) {
          stopZeroEntry(currentDraft, nowMs());
          const saved = put(currentDraft); if (!saved.ok) return saved;
        }
        return restore(oldId, state, confirmed);
      }
      if (!fields?.id || own(data.drafts, fields.id)) return { ok: false, status: "id-conflict" };
      // A replacement must first retain the old stopped draft, including its fixed duration.
      const previous = currentDraft || (oldId ? data.drafts[oldId] : null);
      if (previous) {
        stopZeroEntry(previous, nowMs());
        const saved = put(previous); if (!saved.ok) return saved;
      }
      const draft = createZeroEntryDraft({ ...fields, theme, connection });
      const saved = put(draft);
      Object.defineProperty(data.themeToDraft, theme.id, { value: draft.id, writable: true, enumerable: true, configurable: true });
      data.selectedThemeId = theme.id;
      return { status: "ready", draft, stored: saved.ok ? persist() : saved };
    }
  };
}
