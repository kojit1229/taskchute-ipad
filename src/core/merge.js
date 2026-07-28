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

export { mergeById, mergeByIdPreferNewer };
