// src/core/merge.js — app.js分割・段階1(最初の抽出)。
// 独立レビュー claude-review-result.md §7/§9 の契約:
//   1. state の再代入はここでは行わない(このファイルはこの契約と無関係だが、他モジュールも
//      同じ契約に従う: 再代入は src/state/store.js の setState() 経由のみ)。
//   2. src/core/** は store.js を import しない(純粋性の機械的な判定基準)。
//      本ファイルは state を一切参照しない完全な純粋関数のみで構成される。
//   3. src/**/*.js を追加したら sw.js の APP_SHELL へ必ず追加し、CACHE_NAME を +1 する
//      (2026-07-28のv164でsrc/core/merge.js追加時に実施済み)。
//
// 抽出元: app.js:14686-14700 (mergeById) / app.js:14972-14996 (mergeByIdPreferNewer)。
// 呼び出し元は app.js の computeSyncMerge 配下(mergeTaskArrays/mergeProjectArrays/storeVisits他)。
// 関数の中身のロジックは一切変更していない(純粋な移動+export化のみ)。
// characterization test: tests/merge-core.test.js。

// idキー和集合マージ(v103)。updatedAtが無ければcreatedAtへフォールバックする。
// 削除(tombstone)の概念を持たない旧世代のマージヘルパー(zeroThinking/blocks等で使用)。
function mergeById(localList, remoteList) {
  const merged = new Map();
  (Array.isArray(localList) ? localList : []).forEach((item) => {
    if (item && item.id) merged.set(item.id, item);
  });
  (Array.isArray(remoteList) ? remoteList : []).forEach((item) => {
    if (!item || !item.id) return;
    const cur = merged.get(item.id);
    if (!cur) { merged.set(item.id, item); return; }
    const curTs = cur.updatedAt || cur.createdAt || "";
    const itemTs = item.updatedAt || item.createdAt || "";
    if (itemTs > curTs) merged.set(item.id, item);
  });
  return Array.from(merged.values());
}

// v284: IRON LOGの旧セットはid無しで保存されていたため、mergeByIdでは全件破棄される。
// 内容キーは旧セットの同一性判定専用。移行IDはdata-id属性にも安全な英数字トークンにする。
const LEGACY_GYM_ID_PREFIX = "gymlegacy-";

function gymSetContentKey(set) {
  return JSON.stringify([
    String(set?.exercise ?? ""), String(set?.at ?? ""),
    String(set?.weight ?? ""), String(set?.reps ?? "")
  ]);
}

function gymLegacyId(date, key, occurrence) {
  const source = `${String(date || "")}\u001f${key}\u001f${occurrence}`;
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x85ebca6b) >>> 0;
  }
  return `${LEGACY_GYM_ID_PREFIX}${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

function normalizeGymSetIds(date, list) {
  const occurrences = new Map();
  return (Array.isArray(list) ? list : []).filter((set) =>
    set && typeof set === "object" && !Array.isArray(set)
  ).map((set) => {
    const key = gymSetContentKey(set);
    const occurrence = occurrences.get(key) || 0;
    occurrences.set(key, occurrence + 1);
    const normalized = { ...set, id: set.id ? String(set.id) : gymLegacyId(date, key, occurrence) };
    if (!set.deleted) return normalized;
    const deletedAt = String(set.deletedAt || set.updatedAt || set.createdAt || set.at || "");
    return { ...normalized, deleted: true, deletedAt, updatedAt: String(set.updatedAt || deletedAt) };
  });
}

function mergeGymById(local, remote) {
  const merged = new Map();
  for (const item of [...local, ...remote]) {
    if (!item.id) continue;
    const current = merged.get(item.id);
    if (!current) { merged.set(item.id, item); continue; }
    const currentTs = current.updatedAt || current.createdAt || "";
    const itemTs = item.updatedAt || item.createdAt || "";
    if (itemTs > currentTs || (itemTs === currentTs && item.deleted && !current.deleted)) {
      merged.set(item.id, item);
    }
  }
  return [...merged.values()];
}

function mergeGymSets(localList, remoteList) {
  const valid = (list) => (Array.isArray(list) ? list : [])
    .filter((set) => set && typeof set === "object" && !Array.isArray(set));
  const local = valid(localList);
  const remote = valid(remoteList);
  const idMerged = mergeGymById(local, remote);
  const keys = new Set([...local, ...remote].map(gymSetContentKey));
  const out = [];

  for (const key of keys) {
    const localGroup = local.filter((set) => gymSetContentKey(set) === key);
    const remoteGroup = remote.filter((set) => gymSetContentKey(set) === key);
    const idGroup = idMerged.filter((set) => gymSetContentKey(set) === key);
    const regular = idGroup.filter((set) => !String(set.id).startsWith(LEGACY_GYM_ID_PREFIX));
    const legacy = idGroup.filter((set) => String(set.id).startsWith(LEGACY_GYM_ID_PREFIX));
    const targetCount = Math.max(localGroup.length, remoteGroup.length, regular.length);
    const selected = [...regular, ...legacy].slice(0, targetCount);
    const rawLocal = localGroup.filter((set) => !set.id);
    const rawRemote = remoteGroup.filter((set) => !set.id);
    const rawCandidates = remoteGroup.length > localGroup.length
      ? [...rawRemote, ...rawLocal]
      : [...rawLocal, ...rawRemote];
    selected.push(...rawCandidates.slice(0, Math.max(0, targetCount - selected.length)));
    out.push(...selected);
  }
  return out.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}

// v135: ===============================================================
//  tasks/projectsのマージ保護。事故(2026-07-20〜21): リモート側でtaskを外部修正した直後に
//  端末が古いローカルの丸ごとpushで上書きし、修正が消えた(2回発生)。tasks/projectsは
//  v106のマージ可能コレクションに含まれず、同期は常に「どちらかの丸ごと採用」だったため。
//  全ミューテーション経路(normalizeState含む)がupdatedAtを保守している前提で、
//  idキー和集合+updatedAt比較のマージへ切り替える。
// ===============================================================

// idキー和集合マージ(updatedAtのみで比較。createdAtへはフォールバックしない — tasks/projectsは
// 全ミューテーション経路でupdatedAtを更新する運用のため、mergeById[v103]のフォールバックは不要)。
// v136(Codexレビュー High-2/High-3対応): 優先順位を明確化した。
//   1. updatedAtが新しい方が勝つ
//   2. 同値(両方空を含む)なら、削除側(deleted:true、トゥームストーン)が勝つ
//      (同じ秒にlocal削除・remote編集が起きた場合に削除が復活しないようにする)
//   3. 同値・同じdeletedフラグなら、呼び出し側が指定したtieWinner("local"|"remote")が勝つ
// tieWinnerは呼び出し分岐の文脈(ローカルを基準に残す経路か、リモートを採用する経路か)で
// 呼び出し元が指定する。v135時点は常にremote固定だったため、「ローカルが全体としては
// 新しいのに同一idの内容だけ古いremoteへ巻き戻る」誤りがあった(Codexレビュー指摘)。
function mergeByIdPreferNewer(localList, remoteList, tieWinner) {
  const merged = new Map();
  (Array.isArray(localList) ? localList : []).forEach((item) => {
    if (item && item.id) merged.set(item.id, item);
  });
  (Array.isArray(remoteList) ? remoteList : []).forEach((item) => {
    if (!item || !item.id) return;
    const cur = merged.get(item.id);
    if (!cur) { merged.set(item.id, item); return; }
    const curTs = cur.updatedAt || "";
    const itemTs = item.updatedAt || "";
    if (itemTs > curTs) { merged.set(item.id, item); return; }  // remote(item)が新しい
    if (itemTs < curTs) return;  // local(cur)が新しい → 何もしない
    // 同値(両方空を含む)
    const curDeleted = !!cur.deleted;
    const itemDeleted = !!item.deleted;
    if (curDeleted !== itemDeleted) {
      if (itemDeleted) merged.set(item.id, item);  // remote側が削除 → トゥームストーン優先
      return;  // local側が削除ならcurのまま(何もしない)
    }
    if (tieWinner === "remote") merged.set(item.id, item);
    // tieWinner === "local"(既定扱い)ならcurのまま(何もしない)
  });
  return Array.from(merged.values());
}

export { mergeById, mergeByIdPreferNewer, mergeGymSets, normalizeGymSetIds };

function preferNewerRecord(local, remote, tieWinner) {
  const localTs = local.updatedAt || "";
  const remoteTs = remote.updatedAt || "";
  if (remoteTs > localTs) return remote;
  if (remoteTs < localTs) return local;
  if (!!local.deleted !== !!remote.deleted) return remote.deleted ? remote : local;
  return tieWinner === "remote" ? remote : local;
}

function recordsById(list) {
  const records = new Map();
  (Array.isArray(list) ? list : []).forEach((record) => {
    if (record && record.id) records.set(record.id, record);
  });
  return records;
}

function sameRecordContent(a, b) {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length
    && aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key]);
}

function sameRecordArrayContent(a, b) {
  return Array.isArray(a) && a.length === b.length
    && a.every((record, index) => sameRecordContent(record, b[index]));
}

function changedFieldWinner(local, remote, changedAtField, base) {
  const localChangedAt = local[changedAtField] || "";
  const remoteChangedAt = remote[changedAtField] || "";
  if (remoteChangedAt > localChangedAt) return remote;
  if (remoteChangedAt < localChangedAt) return local;
  return base;
}

function mergeMilestonePair(local, remote, tieWinner) {
  const base = preferNewerRecord(local, remote, tieWinner);
  const doneSource = changedFieldWinner(local, remote, "doneChangedAt", base);
  if (doneSource.doneAt === base.doneAt && doneSource.doneChangedAt === base.doneChangedAt) return base;
  return { ...base, doneAt: doneSource.doneAt, doneChangedAt: doneSource.doneChangedAt };
}

function mergeMilestones(localList, remoteList, winner, tieWinner) {
  const local = recordsById(localList);
  const remote = recordsById(remoteList);
  const winnerIsRemote = winner === "remote";
  const winnerRecords = winnerIsRemote ? remote : local;
  const loserRecords = winnerIsRemote ? local : remote;
  const merged = [];
  winnerRecords.forEach((record, id) => {
    const localRecord = local.get(id);
    const remoteRecord = remote.get(id);
    merged.push(localRecord && remoteRecord
      ? mergeMilestonePair(localRecord, remoteRecord, tieWinner)
      : record);
  });
  loserRecords.forEach((record, id) => {
    if (!winnerRecords.has(id)) merged.push(record);
  });
  return merged;
}

function mergeTracksPreferNewer(localArr, remoteArr, tieWinner) {
  const merged = recordsById(localArr);
  recordsById(remoteArr).forEach((remote, id) => {
    const local = merged.get(id);
    if (!local) { merged.set(id, remote); return; }
    const winner = preferNewerRecord(local, remote, tieWinner);
    const winnerSide = winner === remote ? "remote" : "local";
    const milestones = mergeMilestones(local.milestones, remote.milestones, winnerSide, tieWinner);
    const winnerMilestones = Array.isArray(winner.milestones) ? winner.milestones : [];
    merged.set(id, sameRecordArrayContent(milestones, winnerMilestones)
      ? winner
      : { ...winner, milestones });
  });
  return Array.from(merged.values());
}

const SOURCE_PRIORITY = { auto: 0, confirmed: 1, added: 2 };
const LANE_PRIORITY = { task: 0, cycle: 1 };

function higherPriorityValue(base, other, field, priorities) {
  return (priorities[other[field]] ?? -1) > (priorities[base[field]] ?? -1)
    ? other[field]
    : base[field];
}

function mergeCommitmentItem(local, remote, tieWinner) {
  const base = preferNewerRecord(local, remote, tieWinner);
  const other = base === local ? remote : local;
  const excusedSource = changedFieldWinner(local, remote, "excusedChangedAt", base);
  const completedSource = changedFieldWinner(local, remote, "completedChangedAt", base);
  const fields = {
    excused: excusedSource.excused,
    excusedReason: excusedSource.excusedReason,
    excusedChangedAt: excusedSource.excusedChangedAt,
    completedAt: completedSource.completedAt,
    completedChangedAt: completedSource.completedChangedAt,
    source: higherPriorityValue(base, other, "source", SOURCE_PRIORITY),
    lane: higherPriorityValue(base, other, "lane", LANE_PRIORITY)
  };
  return Object.keys(fields).every((field) => fields[field] === base[field])
    ? base
    : { ...base, ...fields };
}

function mergeWeeklyCommitmentPair(local, remote, tieWinner) {
  if (local.recordType === "week" && remote.recordType === "week") {
    if (local.committedVia === "manual" && remote.committedVia === "auto") return local;
    if (remote.committedVia === "manual" && local.committedVia === "auto") return remote;
    return preferNewerRecord(local, remote, tieWinner);
  }
  if (local.recordType === "item" && remote.recordType === "item") {
    return mergeCommitmentItem(local, remote, tieWinner);
  }
  return preferNewerRecord(local, remote, tieWinner);
}

function mergeWeeklyCommitments(localArr, remoteArr, tieWinner) {
  const merged = recordsById(localArr);
  recordsById(remoteArr).forEach((remote, id) => {
    const local = merged.get(id);
    merged.set(id, local ? mergeWeeklyCommitmentPair(local, remote, tieWinner) : remote);
  });
  return Array.from(merged.values());
}

export { mergeTracksPreferNewer, mergeWeeklyCommitments };
