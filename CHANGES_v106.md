# CHANGES v106

## 概要

K報告(2026-07-15)「iPhoneで入力したジャーナルやルーティンの実績がPC側で見えない。
双方向で入力・参照できるよう同期の仕組みを見直してほしい」への対応。

原因: 同期が「dataModifiedAtの新しい方の全量を採用/スキップ」の二択で、PC側が新しいと
iPhoneがサーバーへ届けた記録ごとスキップ→次のPC pushで上書き消失する構造だった
(v103で0秒思考だけ対症済み。今回それを日常記録全体へ一般化)。

SW `CACHE_NAME` を v105 → v106 に更新。

## 変更内容(app.js)

### 1. 双方向マージエンジン(新設)

「全量の新旧二択」の枠組みは維持しつつ、採用/スキップどちらの経路でも以下を和集合マージする:

| コレクション | マージ規則 |
|---|---|
| journals / feedback | 日付キー。①未記入テンプレでない方(ensureJournalの自動生成テンプレは「空」扱い) ②`journalMeta[date].textUpdatedAt`(v106追加。本文編集時に記録)の新しい方 ③長い方 |
| journalMeta | 本文で勝った側を採用(片側のみは合流) |
| condition.logs | 日付キー。朝グループ/夜グループを各recordedAtで独立採択、gym[]はid和集合 |
| sleep.logs | 日付キー。importedAtの新しい方 |
| settings.morningEnergyLog | 片側にしか無い日付のみ合流 |
| blocks(ルーティン実績を含む) | idキー和集合・updatedAtの新しい方。繰り返し実体のidは`rec_<ruleId>_<date>`で端末間決定論のため重複しない。リモートにしか無い「期間外・未編集の繰り返し実体」はパージ済みの蘇生になるため合流させない |
| zeroThinking | v103の既存マージをそのまま使用 |

マージ計算は`normalizedRemoteCopy()`(normalizeState済みのリモート別コピー)に対して行い、
失敗時はv103相当(0秒思考のみ)へフォールバックする(データ消失ガード)。

### 2. コア一致時の競合自動解消

マージ対象外のコア(`SYNC_CORE_COMPARE_KEYS` = tasks / projects / recurrences / declarations /
questions / experiments)がJSON比較で両端末一致なら、「両方に未反映の変更」の競合を
人間判断を待たず和集合で自動解消する(lastPushedAtをリモートへ追いつかせ、push見送りも解除)。
ジャーナル・ルーティン・体調・睡眠の日常記録だけなら同期が全自動で収束する。
コア自体が両側で動いていた場合は従来どおりバナー/見送りで人間判断に落とす。

### 3. 配線箇所(5経路)

- `runAutoSyncPull`(autoSync ON: 起動+復帰): 3分岐すべてでマージ。未push有+コア一致は自動解消
- `syncFromGitHubOnStartup`(legacy: 起動): 採用時はローカル分をグラフト、スキップ時はローカルへ合流
- `loadFromGitHub`(手動読込): 採用前にローカル分をグラフト
- `saveToGitHub`(手動/legacy自動push)のリモート新しいガード: コア一致ならマージして見送らずpush
- `runAutoSyncPush`(autoSync自動push)の同ガード: 同上(バナーで止めない)

### 4. その他

- ジャーナル本文の編集時に `journalMeta[date].textUpdatedAt` を記録(マージの新旧判定用)。
  `normalizeState()` に既定値補完を追加

## 既知の制限(スコープ外)

- tasks等のコアが両端末で同時に動いた場合は従来どおり全量二択+バナー(構造改善は
  review.md TCJ-R01系の別プロジェクト)
- 端末間の時計スキュー(リモートのdataModifiedAtが実時刻より未来)時は自動解消後のpushが
  次回編集まで遅延しうる
- review.md 26番(pull適用直前の編集消失レース)は本対応の範囲外で未解決のまま

## テスト

- `tests/v106.test.js` 追加(api.github.com偽装): legacy起動pullの採用+グラフト /
  スキップ+合流 / 同一日付ジャーナルのtextUpdatedAt解決 / autoSyncのコア一致自動解消
  (バナーなし・lastPushedAt追いつき)の15チェック。
- `node --check` / `node tests/v106.test.js` / `npm run test:core` 全通過。
