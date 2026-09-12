import { createDailyDraftStore } from "./daily-draft.js";
import { isArchivedDate, ARCHIVED_READONLY_MESSAGE } from "./archive-date-protection.js";
import { nextMutationStamp } from "../core/mutation-stamp.js";

const invalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });
export const towerJournalOperation = {
  prepare: input => input,
  build(state, input, deps) {
    const { id: date, value, beforeValue, beforeStamp, observedAt, connection } = input;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof value !== "string" || connection !== deps.journalConnection())
      throw invalid("保存する日付・接続先を確認してください");
    if (isArchivedDate(state, date)) throw invalid(ARCHIVED_READONLY_MESSAGE);
    const meta = state.journalMeta[date];
    if ((state.journals[date] || "") !== beforeValue || (meta?.textUpdatedAt || "") !== beforeStamp)
      throw invalid("保存前の本文が更新されました。入力は下書きに残しています");
    if (value === beforeValue) return { values: [] };
    return { candidates: [beforeStamp], values: [{ kind: "journals", key: date, before: state.journals[date], after: value },
      { kind: "journalMeta", key: date, before: meta, after: { aiImported: false, ideal: "", aiTaskCandidates: [], aiRequest: "",
        ...meta, textUpdatedAt: nextMutationStamp({ now: observedAt, candidates: [beforeStamp] }) } }] };
  },
  effects: (result, input, deps) => { if (!result.unchanged) deps.journalSaved?.(input.id); }
};

export function createTowerJournal({ state, connection, now, run, document, drafts = createDailyDraftStore({ restore: true }) }) {
  const timers = new Map(), composing = new Set(), statuses = new Map();
  const owner = (date, key = connection()) => ({ kind: "journal", id: date, draftId: "text", connection: key });
  const keyOf = value => JSON.stringify([value.id, value.connection]);
  const currentElement = () => document.querySelector('[data-tower-journal-date]');
  const elementOwner = el => owner(el.dataset.towerJournalDate, el.dataset.journalConnection || connection());
  function status(value, message) {
    statuses.set(keyOf(value), message);
    const el = currentElement();
    if (el && keyOf(elementOwner(el)) === keyOf(value)) el.parentElement.querySelector('[data-journal-save-status]').textContent = message;
  }
  function save(value) {
    const key = keyOf(value); clearTimeout(timers.get(key)); timers.delete(key);
    const draft = drafts.get(value);
    if (!draft || composing.has(key)) return false;
    const result = run(draft);
    if (result.ok) { drafts.clear(value, "saved"); status(value, result.unchanged ? "変更はありません" : "端末に保存しました"); }
    else status(value, result.status === "invalid" ? `${result.error.message}。入力は残しています`
      : "端末に保存できませんでした。入力は残しています");
    return result.ok;
  }
  function input(el, isComposing = false) {
    if (!el?.matches('[data-tower-journal-date]')) return false;
    const value = elementOwner(el), key = keyOf(value);
    if (el.readOnly || isArchivedDate(state(), value.id)) { status(value, ARCHIVED_READONLY_MESSAGE); return true; }
    const prior = drafts.get(value);
    drafts.put({ ...value, beforeValue: prior?.beforeValue ?? (state().journals[value.id] || ""),
      beforeStamp: prior?.beforeStamp ?? (state().journalMeta[value.id]?.textUpdatedAt || ""),
      value: el.value, start: el.selectionStart, end: el.selectionEnd, observedAt: now() });
    status(value, "未保存の入力があります"); clearTimeout(timers.get(key));
    if (!isComposing && !composing.has(key)) timers.set(key, setTimeout(() => save(value), 600));
    return true;
  }
  return {
    input,
    composition(el, active) {
      if (!el?.matches('[data-tower-journal-date]')) return;
      const value = elementOwner(el), key = keyOf(value);
      if (active) { composing.add(key); clearTimeout(timers.get(key)); }
      else { composing.delete(key); input(el); save(value); }
    },
    saveElement(el) { if (!el?.matches('[data-tower-journal-date]')) return false; input(el); return save(elementOwner(el)); },
    restore(focus = false) {
      const el = currentElement(); if (!el) return;
      el.dataset.journalConnection = connection();
      const value = elementOwner(el), draft = drafts.get(value);
      if (draft && !el.readOnly) { el.value = draft.value; el.setSelectionRange(draft.start, draft.end); }
      status(value, statuses.get(keyOf(value)) || (draft ? "未保存の入力があります" : ""));
      if (focus) el.focus({ preventScroll: true });
    }
  };
}
