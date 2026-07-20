# v129 ポモドーロ身体スキャン

## 背景

没入中は身体信号が届かない特性への対策。50分ごとに必ず手が止まるポモドーロ完了時を
強制サンプリングポイントにし、疲労1-5+任意部位を2タップで記録する。

## 変更点(app.js)

- 新state `state.bodyScans = []`(要素: `{id, dateTime, fatigue(1-5), part(""/目/肩/胃/頭),
  pomodoroBlockId}`)。`normalizeState()`で既存値優先の後方互換補完を追加し、v106系の
  マージ可能コレクションとして**mergeById(idキー和集合)**で`computeSyncMerge` /
  `applySyncMergeToLocal` / `applySyncMergeToRemote`へ組み込んだ(0秒思考entriesと同じ
  パターンをそのまま踏襲。上限件数は設けていない)。
- `completePomodoro()`完了時、直接ゲート判定を呼んでいた末尾を`openBodyScanModal(blockId)`に
  差し替えた。2タップの軽量モーダル:
  1. `buildBodyScanStep1Modal()`: 「いまの疲労感は?」1〜5の大きめボタン(タップで
     `bodyScanRecordFatigue()`→ステップ2へ)。
  2. `buildBodyScanStep2Modal()`: 部位チップ(目/肩/胃/頭。タップで`bodyScanRecordPart(part)`)
     + 「スキップして記録」ボタン(`part=""`で記録)。
  - どちらのステップでも「記録せず閉じる」(`bodyScanDiscard()`)、ヘッダの×、背景タップの
    いずれでも中断できる(摩擦最小・強制しない。背景タップ等の暗黙クローズは`closeModal()`側で
    `_pendingBodyScanCtx`を破棄する既存の`_pendingLifecycleCtx`と同じ扱いにした=記録せず終わる)。
- **v117(C)過集中ゲートとの順序**: モーダルは1枚ずつしか出せないため、身体スキャンフロー
  (保存/スキップ/discardいずれの終わり方でも)を`closeBodyScanFlow()`が閉じた**後**に
  `maybeOpenHyperfocusGate()`を呼ぶ(既存の90分抑止ガード・blockId必須条件はそのまま維持)。
  `finishReport()`(v87の終了報告モーダル解決)→`resumeLifecycleFinish()`→`completePomodoro()`
  という既存の単一導線をそのまま利用しているため、report-modalとの相互作用は無改修。
- 日報`generateReport()`: `## 5. 時間の使い方`の`### 実行 Block(時刻順)`表の直後に、
  当日分`bodyScans`があれば`### 身体スキャン`表(時刻・疲労・部位)を出力する。0件の日は
  節ごと省略。

## 変更点(loop側)

- `loop/scripts/daily-report-fallback.py`: `### 身体スキャン`節を同じ位置・同じ書式で実装
  (dateTimeの日付部分一致でフィルタ、時刻昇順)。
- `loop/FORMAT_CONTRACT.md`: 突合表の`## 5. 時間の使い方`行の備考へ追記、専用の日付節を追加。
- `loop/coach/daily-review.md`: 「観点」に8点目を追加。身体スキャンがある日は、疲労4以上の
  時刻とその直前の実行Blockを突き合わせ、疲れの直前に何をしていたかのパターンに1項目触れる
  (データなしの日は省略)。

## 既存テストへの影響

- `tests/v117.test.js`の[13](ポモドーロ完了での過集中ゲート検証)は、ポモドーロ完了直後に
  今回追加した身体スキャンモーダルが割り込むため、ゲート判定の前に
  `[data-action="body-scan-discard"]`を挟むよう更新した(仕様変更に伴う正当な更新。弱体化ではない)。
- `tests/v87.test.js`(宣言→終了報告ループ)は完走を確認済み(身体スキャンモーダルが割り込んでも
  toast・state・z-index検証のいずれにも影響しない)。

## 検証手順

1. `node --check app.js` / `node --check sw.js`
2. `node tests/run-all.js v129 v117 v87`
3. `node tests/run-core.js`(直近5件+固定横断コア5本、回帰確認)
4. `PYTHONUTF8=1 python loop/scripts/daily-report-fallback.py <date> <合成app-state.json> <出力.md>`
   で`### 身体スキャン`表が時刻順・フィルタ通りに出ることを手動確認。
