# CHANGES v115

## 概要

ROADMAP「TOC由来の提案G: 縮退版+連続ルーティン(ハビットスタック)」(2026-07-16 K採用)。
v114(保護系ルーティンの連続欠落表示)の続き。制約保護(運動・睡眠・内省・家族時間)は
量より連続性が大事なので、崩れた日でも「縮退版」でワンタップ実行でき連続記録が
途切れないようにした(①)。また複数の小ルーティンを1つのチェーンにまとめて
開始・完了を一括化し(②)、既存ルーティンの直後に自動配置できるアンカー(③)を追加した。
SW `CACHE_NAME` を v114 → v115 に更新。

## 変更内容

### ① 縮退版(fallback)

- `state.recurrences[]`に`fallbackTitle`(string、既定"")/`fallbackMinutes`(number|null、
  既定null)を追加(`createRecurrenceRule()`の既定値 + `normalizeState()`の後方互換補完)。
- Block編集モーダル: `liveRule.protection`がtrueのルールにのみ、縮退版のタイトル/所要分の
  入力欄を表示(充電/放電・保護系チェックボックスと同じ表示条件パターン)。
- `completeRoutineForToday(ruleId, {titleSuffix, note})`: 指定ルールの今日のBlockを
  完了扱いにする共通ヘルパー(無ければ`makeRecurrenceInstance`と同じ方式で実体化してから
  完了させる)。縮退実行(①)・チェーンのステップ完了(②)の両方から呼ばれる。
- `executeRoutineFallback(ruleId)`: 縮退版で実行する。タイトルに"(縮退版)"を付記し、
  コメントに縮退版のタイトル・所要分を残す。通常のBlock完了(`toggleBlock`)とは別の記録経路。
- `fallbackButtonHTML(block, isToday)`: `fallbackTitle`が設定されたルールに属し、当日・
  未完了のときだけ「縮退版で実行」ボタンを表示(ルーティンタブ・ホーム両方に配線)。

### ② 連続ルーティン(チェーン)

- 新規配列`state.routineChains[]`(id/title/steps=[{id,title,estimatedMinutes}]/anchor/
  createdAt/updatedAt/deleted)を追加。既存の繰り返しルールへの相乗りではなく新規配列にした
  理由は decisions.md 参照(チェーンは「複数ルーティンの束」であり単一のルールに収まらない)。
- ステップは`title`文字列で既存の繰り返しルールと突合する(idでの厳密リンクではなく
  `loop/scripts/canary-check.py`と同じタイトル一致方式)。理由: ステップ入力を
  「1行1ステップ(タイトル, 見積分)」の平文テキストのままにでき、動的な行追加UIが不要になる。
- `state.chainRuns[]`(id=`${chainId}_${date}`、currentIndex/scheduledStartAt/startedAt/
  completedAt/stepLog)で当日の進行状態を永続化。
- `openChainRun`/`closeChainRun`/`chainStepComplete`: Now画面の実行コンベア(v70)と同じ
  「今の1件だけを全画面表示」パターンを踏襲(`.now-fullscreen`のCSSをそのまま再利用)。
  ステップ完了のたびにタイトル一致するルールがあれば`completeRoutineForToday`を呼び、
  全ステップ完了でチェーン自体を完了させ、アンカー配置(③)もトリガーする。
- チェーンのCRUD(新規作成/編集/削除)はモーダル(`state.modal.type === "chain"`)経由。
  ルーティンタブ末尾に一覧セクション(`chainSectionHTML`)を追加。

### ③ アンカー(習慣スタッキング)

- `state.recurrences[]`に`anchor`(string、既定"")を追加。値は既存の別ルーティンの
  繰り返しルールid、または連続ルーティン(チェーン)のidのいずれか(idはUUIDで
  衝突しないため1つの属性で両方を指せる)。`state.routineChains[]`にも同じ`anchor`属性がある。
- `triggerAnchorPlacements(anchorId, completedAtDateTime)`: anchorIdが「今日完了」した
  タイミングで、`anchor`がそれと一致する後続のルーティン/チェーンを直後の時刻(完了時刻の
  1分後)に自動配置する。ルーティン側は`makeRecurrenceInstance`を再利用し時刻だけ差し替えて
  Blockを生成、チェーン側はBlockという概念を持たないため`chainRuns`に`scheduledStartAt`を
  記録するだけに留める(詳細はdecisions.md参照)。
  `toggleBlock`(通常のチェック)・`completeRoutineForToday`(縮退実行・チェーンのステップ
  完了経由のルーティン完了)・チェーン全体完了の3箇所から呼ばれる。
- `maintainRecurrences()`: `anchor`が設定されたルールは通常のスケジュール実体化(毎日
  RECURRENCE_KEEP_PAST_DAYS〜RECURRENCE_FUTURE_DAYS分を先回りして生成する処理)から除外した。
  除外しないと「アンカー完了時にだけ配置する」前に通常の日次生成で先にBlockができてしまい、
  アンカー配置が常にスキップされてしまうため(理由の詳細はdecisions.md参照)。
- Block編集モーダル: `liveRule.protection`がtrueのルーティンに、アンカー選択欄
  (既存の繰り返しルール+連続ルーティンの一覧、自分自身は除外)を追加。チェーン編集モーダルにも
  同じ選択欄がある。

### styles.css

- `.fallback-btn`(縮退版で実行ボタン、行内に収まる小型ボタン)。
- `.chain-card` / `.chain-card-title` / `.chain-card-steps` / `.chain-card-foot` /
  `.chain-card-status`(連続ルーティン一覧カード)。

### sw.js

- `CACHE_NAME`を`taskchute-journal-pwa-v115`に更新。

## 検証

- `node --check app.js` / `node --check sw.js` / `node --check tests/v115.test.js`
  すべてexit 0。
- `tests/v115.test.js`(新規、27チェック)ALL PASS:
  (1) 縮退版(fallbackTitle未設定ルーティンにはボタンが出ない・実行で当日Block完了+
  タイトル/コメント付記+連続欠落日数が0にリセット)、(2) 連続ルーティン(開始→順送り
  表示→全ステップ完了、タイトル一致するルーティンの連続欠落日数もリセット)、
  (3) アンカー(アンカー元完了前は対象Block無し→完了直後の1分後に自動生成、チェーン側は
  scheduledStartAtのみ記録)、(4) Block編集モーダルの縮退版/アンカー入力欄の表示・保存反映。
- `npm run test:core`(直近5件 + 固定コア5件、v115含む計10スイート)ALL PASS
  (v111/v112/v113/v114/v115/v50/v59/v67/v70/v72、既存機能への回帰なし)。

## 未対応・懸念点

- チェーンの作成/編集UIは、ステップ入力を動的な行追加コンポーネントではなく
  「1行1ステップ(タイトル, 見積分)」の平文テキストエリアにした(実装コストと引き換えの
  UX簡略化)。K の実際の入力体験を見て、行追加式UIへの変更要望が出る可能性がある。
- チェーンのステップとルーティンの紐付けは「タイトル完全一致」方式のため、ルーティンの
  タイトルを変更するとチェーン側のステップとの連携が黙って切れる(streakリセットが
  効かなくなる)。エラー表示・警告は出していない。
- アンカーで自動配置されるルーティンは、`maintainRecurrences`の通常の日次生成から
  完全に除外される設計にした。そのため「アンカー元が完了しない日は、アンカー対象の
  ルーティンのBlockが一切生成されない」(=その日は連続欠落日数のカウントで「データ欠落」
  扱いになり、`computeProtectionMissedStreak`が該当日でカウントを打ち切ってしまう可能性が
  ある)。アンカー元が毎日確実に完了する運用であれば問題にならないが、アンカー元自体が
  崩れた日の挙動はK運用開始後に要観察。
- アンカー対象がチェーンの場合、`scheduledStartAt`は「開始目安」の記録に留まり、実際に
  Routineタブ上での時系列位置(タイムライン上の配置)には反映していない(チェーンカードの
  表示テキストのみ)。将来的にチェーンをタイムライン上へ視覚的に配置したい要望が出た場合は
  別途相談。
- 本コミット群はローカルcommitのみでpushしていない(指示どおり。監督者レビュー後にpush予定)。
