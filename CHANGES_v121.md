# v121 今週のやりたいこと(Wish週次選定)

## 目的

ホーム画面で「今週のやりたいこと」をWishリストから選択・設定でき、未設定の週は
睡眠ログ風の赤帯アラートで気づける状態にする。

## 変更点

- 永続state `state.weeklyWishes` を追加: `{ [週キー]: { taskIds: string[], updatedAt } }`。
  週キーは既存の `weekRange()`(土曜起点)の `weekStart` をそのまま使い、週替わりは
  参照キーが自然に変わるだけで済む(専用のリセット処理は書いていない)。
  `normalizeState` に後方互換の補完を追加(`dailyDeclarations` と同じパターン)。
- 同期マージ: `mergeWeeklyWishMaps`(`mergeDailyDeclarationMaps` と同じ `updatedAt` 比較)を
  `computeSyncMerge` / `applySyncMergeToLocal` / `applySyncMergeToRemote` に組み込み、
  `changedVsLocal` / `changedVsRemote` 判定にも含めた。
- ホームUI(`homeWeeklyWishCard`): `homeDeclarationCard()` の直後に配置。
  - 今日を表示中かつ今週未設定(エントリ無し or `taskIds` 空)なら赤帯アラート
    + 「設定する」ボタン。
  - 設定済みの週は選択Wishのタイトル一覧 + 「変更」ボタンのカード。削除済み・実現済みに
    なったWishは `taskIds` を書き換えずに表示からだけ自然に外す。
  - 今日以外の日付では赤帯・カードとも出さない(過去日を振り返る時に警告するのは筋違い、
    という既存の宣言カードと同じ方針)。
- 選択モーダル(`buildWeeklyWishModal`): 未実現・未削除のトップレベルWishのみ一覧表示。
  最大3件、4件目のチェックは `data-action="weekly-wish-toggle"` のクリック委譲内で
  `preventDefault()` して拒否し、トースト「今週は3つまでに絞りましょう」を出す
  (checkboxの`checked`はclickイベントのpre-activationでリスナー実行前に反映済みのため、
  4件目時点で `target.checked && checked件数 > 3` を判定している)。
- イベントは既存の `document` click デリゲーション(`data-action`)のみ。個別
  `addEventListener` は追加していない。
- Service Workerキャッシュを v121 へ更新する。

## 検証手順

1. `node --check app.js`
2. `node tests/run-all.js v120 v121`
3. `node tests/run-core.js`(直近5件+固定横断コア5本、回帰確認)
4. ホームで赤帯「設定する」→モーダルで2件選択→保存→カード表示、「変更」で再度開くと
   既存選択がチェック済み、4件目選択が拒否される、過去日では出ない、をブラウザで目視確認。
