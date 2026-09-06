// No persistent schema: every prune permission is evidence for this connection and exact text.
const MAPS = ["journals", "reports", "feedback"];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const map = value => value && typeof value === "object" && !Array.isArray(value);
export const ARCHIVED_READONLY_MESSAGE = "アーカイブ済みの日の本文は閲覧専用です。検索の「アーカイブも検索」で元の記録を確認できます。";
export const isArchivedDate = (state, date) => (state.archivedDates || []).includes(date);
export function archiveConflict() {
  const error = new Error("アーカイブと一致しない記録、または確認できない記録があるため同期を停止しました。端末の追記は保持しています。");
  error.name = "ArchiveTextConflict";
  return error;
}
function entries(local, remote) {
  const dates = new Set([...(local.archivedDates || []), ...(remote?.archivedDates || [])]);
  const result = [];
  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw archiveConflict();
    for (const key of MAPS) for (const side of [local, remote]) {
      if (side && own(side[key], date)) {
        const text = side[key][date];
        if (typeof text !== "string") throw archiveConflict();
        result.push([key, date, text]);
      }
    }
  }
  return result;
}
const signature = record => JSON.stringify(record);
const snapshot = state => JSON.stringify([state?.archivedDates, ...MAPS.map(key => state?.[key]), state?.journalMeta]);

export function createArchiveProtection({ getState, getConnection, readArchive }) {
  let evidence = new Set(), connection = null, generation = 0;
  const key = () => JSON.stringify(getConnection());
  function assert(remote) {
    const pending = entries(getState(), remote);
    if (!pending.length) return;
    if (connection !== key() || pending.some(row => !evidence.has(signature(row)))) throw archiveConflict();
  }
  async function prepare(remote) {
    const epoch = ++generation;
    evidence = new Set(); connection = null;
    try {
      const pending = entries(getState(), remote);
      if (!pending.length) return;
      const startKey = key(), localBefore = snapshot(getState()), remoteBefore = snapshot(remote);
      const config = { ...getConnection() }, verified = new Set();
      // Read each year once. Missing archive is not proof that local text can be deleted.
      for (const year of new Set(pending.map(([, date]) => date.slice(0, 4)))) {
        const archive = await readArchive(year, config);
        if (epoch !== generation || key() !== startKey || snapshot(getState()) !== localBefore || snapshot(remote) !== remoteBefore) throw archiveConflict();
        if (!map(archive) || MAPS.some(name => own(archive, name) && !map(archive[name]))) throw archiveConflict();
        for (const row of pending.filter(([, date]) => date.startsWith(year + "-"))) {
          const [name, date, text] = row;
          if (!own(archive[name], date) || archive[name][date] !== text) throw archiveConflict();
          verified.add(signature(row));
        }
      }
      evidence = verified;
      connection = startKey;
    } catch {
      // Revoke earlier evidence too; a failing new check must never expose stale permission.
      evidence = new Set(); connection = null;
      throw archiveConflict();
    }
  }
  return { prepare, assert };
}
