// src/features/timeline-layout.js — app.js分割・段階4-5(タイムライン抽出・段階A:
//   純粋レーン割付計算のみ)。prep-stage4-timeline.md §7「段階A」。
//
// 対象: assignBlocksToLanes(重なり判定+レーン割当)・adjustLaneTopPositions(top/height算出)。
// 抽出元: app.js(v170時点) assignBlocksToLanes:6569-6635 / adjustLaneTopPositions:6640-6649。
// 呼び出し元(renderTimeline、app.js残留)は無改修(importの参照先が変わるのみ)。
//
// 契約(wish.js/journal.js/routine.js冒頭コメントと同じconfigureXxx(deps)パターン):
//   1. state を一切参照しない(引数のみに依存)。src/state/store.js を import しない。
//   2. src/**/*.js を追加したら sw.js の APP_SHELL へ必ず追加し、CACHE_NAME を +1 する。
//
// 監督者裁定・設計書との食い違い(release v171 uncertainties参照):
//   prep-stage4-timeline.md §4/§7は本ファイルを「引数のみで完結するためconfigureXxx
//   パターン自体が不要」と評価していたが、実装着手前の確認でassignBlocksToLanesが
//   minutesOf(文字列パースのみで純粋)とnowDateTime(new Date()依存・非決定的、actualモードで
//   actualEndAt未設定のBlockの終了時刻フォールバックにのみ使用)をapp.js側のグローバル関数として
//   直接呼んでいることが判明した。ロジック無改変の原則を保ちつつこの依存を外へ出すため、
//   routine.js等と同型のconfigureTimelineLayout(deps)によるDIパターンへ切り替えた
//   (設計書本体の修正は監督者側で別途行う)。
//
// characterization test: tests/timeline-layout-core.test.js。

// ---- 依存注入(configureTimelineLayout) ----
let minutesOf, nowDateTime;

function configureTimelineLayout(deps) {
  ({ minutesOf, nowDateTime } = deps);
}

// ---- ここから抽出したコード本体(app.js:v170時点から移動。ロジック無改変) ----

// v26: Block をレーンに割り当てる。重なり合うブロック群(クラスタ)ごとに
// 使用レーン数 laneCount を求め、横幅 = 100/laneCount で配置できるようにする。
// (重なりが無ければ laneCount=1 で全幅、2つ重なれば 2 で 50:50)
// v150(UI改善計画Phase4b・R9): 第4引数rowHeightを追加。adjustLaneTopPositions が描画時に
// 適用する min-height(38px、5分未満は14px)ぶんの見た目の高さ膨張を、クラスタ判定(=重なり
// 検出)の側にも分単位で織り込む(「実効終了時刻」clusterEnd)。これにより、実時間では
// 連続していて重ならない短時間Block同士(例: 15分刻みのルーティンが連続)でも、描画上の
// 高さが次のBlockのtopへ食い込む場合は既存の横レーン分割(段差配置)の対象になり、物理的な
// 重なりが解消される。top(開始時刻の絶対位置)自体は adjustLaneTopPositions 側で従来どおり
// 一切補正しない(タイムライン絶対配置の正典ルールに抵触しない)。
function assignBlocksToLanes(blocks, mode, maxLanes, rowHeight) {
  // 開始時刻でソート(同じ時刻なら短いもの優先)
  const sorted = [...blocks]
    .map((b) => {
      const startStr = mode === "actual" ? b.actualStartAt : b.plannedStartAt;
      const endStr = mode === "actual" ? (b.actualEndAt || nowDateTime()) : (b.plannedEndAt || null);
      if (!startStr) return null;
      const start = minutesOf(startStr);
      const end = endStr ? minutesOf(endStr) : start + 1;  // 終了未定なら最低1分
      const realEnd = Math.max(end, start + 1);
      // v150レビュー対応(項目6、監督者裁定): min-height換算の実効終了時刻による横レーン分割は
      // 実所要20分未満のBlockだけに限定する。20分以上まで延長すると、min-height(38px)との
      // 差が大きい30分Block同士が一日中50%幅に分割されてしまう(実測)。実所要20分以上の
      // Blockどうしの数px〜十数px程度の食い込み(v149以前からの既存挙動)はこの変更では
      // 対応しない(許容、CHANGES_v150.md参照)。
      const durationMin = realEnd - start;
      let clusterEnd = realEnd;
      if (durationMin < 20) {
        const minHeightPx = durationMin < 5 ? 14 : 38;
        const minDurationMin = rowHeight > 0 ? (minHeightPx / rowHeight) * 60 : 0;
        clusterEnd = Math.max(realEnd, start + minDurationMin);
      }
      return { block: b, start, end: realEnd, clusterEnd, startStr, endStr };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start));

  const result = [];
  let cluster = [];          // 現在のクラスタの項目(lane 付与済み)
  let clusterLaneEnds = [];  // クラスタ内・各レーンの終了時刻(分、見た目の高さ込み=clusterEnd基準)
  let clusterMaxEnd = -1;    // クラスタ内の最遅終了時刻(同上)

  const flushCluster = () => {
    const laneCount = Math.max(1, clusterLaneEnds.length);
    for (const it of cluster) result.push({ ...it, laneCount });
    cluster = [];
    clusterLaneEnds = [];
    clusterMaxEnd = -1;
  };

  for (const item of sorted) {
    // 現クラスタのどのブロックとも重ならない(全て終了済み)なら、クラスタを確定
    if (clusterMaxEnd >= 0 && item.start >= clusterMaxEnd) {
      flushCluster();
    }
    // クラスタ内で空いているレーン(終了 ≤ 自分の開始)を探す
    let lane = -1;
    for (let i = 0; i < clusterLaneEnds.length; i++) {
      if (clusterLaneEnds[i] <= item.start) { lane = i; break; }
    }
    let isOverflow = false;
    if (lane === -1) {
      if (clusterLaneEnds.length < maxLanes) {
        lane = clusterLaneEnds.length;     // 新しいレーンを追加
        clusterLaneEnds.push(-1);
      } else {
        lane = maxLanes - 1;               // 上限超過: 最後のレーンに重ねる
        isOverflow = true;
      }
    }
    clusterLaneEnds[lane] = Math.max(clusterLaneEnds[lane], item.clusterEnd);
    clusterMaxEnd = Math.max(clusterMaxEnd, item.clusterEnd);
    cluster.push({ ...item, lane, isOverflow });
  }
  flushCluster();
  return result;
}

// v15: 開始時刻 = top を厳守(レーンによる補正・連続重なりの縦ずらしを撤廃)
// 同じ開始時刻なら必ず同じ高さに表示される
// 異なる開始時刻なら、その時刻通りの top に配置される(階段表示=時刻違いの可視化)
function adjustLaneTopPositions(assignments, rowHeight, startHour) {
  return assignments.map((a) => {
    const top = ((a.start - startHour * 60) / 60) * rowHeight;
    const durationMin = a.end - a.start;
    const isShort = durationMin < 5;
    const minHeight = isShort ? 14 : 38;
    const height = Math.max(minHeight, (durationMin / 60) * rowHeight);
    return { ...a, top, height, isShort };
  });
}

export { configureTimelineLayout, assignBlocksToLanes, adjustLaneTopPositions };
