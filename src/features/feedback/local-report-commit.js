// Synchronous local boundary. Raw storage stays inside injected adapters, never in a request DTO.
import { commitCandidate } from "../../core/commit.js";
export function createLocalReportCommit({ getState, canSave, persist, readStored, writeStored, now, floors = [] } = {}) {
  if ([getState, canSave, persist, readStored, writeStored, now].some(fn => typeof fn !== 'function')) throw Error('local_configuration_required');
  return (candidate) => {
    if (canSave() !== true) return { ok: false, reason: 'local_save_blocked' };
    const state = getState();
    if ((state.archivedDates || []).includes(candidate.date) || state.journals?.[candidate.date] !== candidate.journalText)
      return { ok: false, reason: 'local_input_changed' };
    let raw;
    try { raw = readStored(); } catch { return { ok: false, reason: 'local_read_failed' }; }
    if (raw !== null && typeof raw !== 'string') return { ok: false, reason: 'local_read_failed' };
    const result = commitCandidate({ state, now, floors,
      // Same report text declares no change, so no stamp or persist happens (design 03: stamps only on content diffs).
      build: before => ({ records: [], values: before.reports[candidate.date] === candidate.reportMarkdown ? []
        : [{ kind: 'reports', key: candidate.date, before: before.reports[candidate.date], after: candidate.reportMarkdown }] }),
      persist: () => {
        try {
          if (persist() !== true) throw Error('local_save_failed');
          const stored = JSON.parse(readStored());
          if (stored.reports?.[candidate.date] !== candidate.reportMarkdown || stored.journals?.[candidate.date] !== candidate.journalText)
            throw Error('local_readback_mismatch');
          return true;
        } catch (error) { return { ok: false, error }; }
      } });
    if (!result.ok) {
      // No await occurs inside this transaction. Restore the previous storage image as well.
      try { writeStored(raw); } catch { return { ok: false, reason: 'local_rollback_unconfirmed' }; }
      return { ok: false, reason: 'local_save_failed' };
    }
    return { ok: true, date: candidate.date, reportMarkdown: candidate.reportMarkdown, journalText: candidate.journalText };
  };
}
