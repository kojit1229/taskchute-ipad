# CHANGES v103

## 概要

K最優先指示(2026-07-15)「0秒思考エントリ等のID付き追記型データをデバイス間で双方向マージ
(和集合)して、『後勝ち全量置換』による見えない/消える問題を解消する」への対応。

SW `CACHE_NAME` を v102 → v103 に更新。

## 実害の事実

- iPhoneで7/15に書いた0秒思考8件はサーバー(personal-data の app-state.json)に到達済みだった。
- しかしPCは再読み込みしても表示されなかった。原因は、PCローカルの `dataModifiedAt` が
  リモートより新しく、起動時pullが「remoteが古い」と判定して**全量スキップ**していたため
  (従来の同期は「新しい方の全量を採用/スキップ」の二択で、部分的な取り込みが無かった)。
- このままPCが保存すると、iPhoneの8件をサーバーごと上書きして消すリスクがあった
  (対応前の時点では未発生。サーバー側の8件は無事)。

## 変更内容

`zeroThinking.entries[]`(0秒思考の回答ログ、idキー・削除されない)と
`zeroThinking.suggestedThemes[]`(AI提案お題キュー、idキー。TTL物理削除あり)を対象に、
すべてのpull経路で双方向マージ(和集合)するようにした。

### マージ対象にしたもの・しなかったもの

- **対象**: `zeroThinking.entries[]` / `zeroThinking.suggestedThemes[]`。どちらもidキーで、
  ユーザーが「削除」する経路を持たない(entriesは削除UIが無い、suggestedThemesは
  adopted/dismissedへのstatus遷移のみでTTLによる物理削除以外に消える経路が無い)ため、
  和集合にしても「削除したはずのものが復活する」事故が起きない。
- **対象外: `zeroThinking.themes`**。ユーザーが明示的に削除できるフィールドのため、和集合に
  すると「PCで削除したテーマが、リモートにまだ残っていればマージで復活する」事故になる。
  tombstone(削除済みマーカー)を持たせて安全に和集合する設計は今回のスコープ外とした
  (K指示どおり)。
- **対象外: tasks/projects/journals等の他コレクション**。`review.md`の全体設計課題
  (2026-07-14レビュー、autoSync競合バナー周りの高severity指摘含む。app.js:9583-9604相当、
  この対応後は行番号がずれている)は本対応の直接の指摘先ではないが隣接領域であり、
  「pull全量置換」という同じ設計思想が残っている。今回はK指示どおり0秒思考2フィールドに
  範囲を絞り、他コレクションのマージ化は別対応とする。

### マージのタイミング(3つのpull経路すべて)

`syncFromGitHubOnStartup`(起動時)/ `runAutoSyncPull`(自動同期ON時)/ `loadFromGitHub`
(手動「GitHubから読込」)の3経路すべてで、以下の分岐を追加した:

- **(a) リモートを採用する場合**: `normalizeState(remote)` で置き換える前に、ローカルにしか
  無いidのentries/suggestedThemesをリモート側へ合流させてから採用する。合流で内容が
  リモートの元スナップショットから乖離した場合は `dataModifiedAt` を「今」へ進め(合流分を
  次回pushで届けるため)、`scheduleAutoSave()`/`scheduleAutoSync()` を呼ぶ。
- **(b) リモートが古くて採用しない場合**: リモートにしか無いidのentries/suggestedThemesを
  ローカルへ合流させる(**今回のPC症状はこの経路で治る**)。実際に内容が変化した場合だけ
  `saveState()` を呼び、`dataModifiedAt` の更新・保存・自動push予約(既存の保存系統)を行う。
  `runAutoSyncPull` の「両方に未反映の変更がある(hasUnpushed)」分岐も、他フィールドの
  自動適用(人間判断待ち)とは切り離してこの合流だけは行う。
- 同一idが両方に存在する場合は `updatedAt`(無ければ `createdAt`)の新しい方を採用する
  (`nowDateTime()` はゼロ埋め固定長のローカル日時文字列のため、既存の `dataModifiedAt`
  比較と同じ文字列比較の規約で安全に新旧判定できる)。
- マージ後は `suggestedThemes` に対して既存のTTL剪定(pending 3日 / adopted・dismissed 7日、
  v100)を再適用する。合流で期限切れ候補が紛れ込んでも、剪定関数を共有しているため即座に
  消える(下記テスト(e)で安全性を実証)。

### データ消失ガード

- マージ処理(`mergeZeroThinkingLists`)は例外をcatchし、失敗時は `null` を返して呼び出し側が
  従来動作(マージなし)へフォールバックする。
- リモート取得(`downloadGitHubStateText`)が失敗した場合は既存どおり例外がpull関数の
  `catch` まで伝播し、そもそもマージ処理自体が呼ばれない(空とマージすることはない)。

### 実装

- `pruneExpiredSuggestedThemes(list)`: v100で `normalizeState` にインラインだったTTL剪定を
  関数化。マージ後の再剪定と共有する。
- `mergeById(localList, remoteList)`: idキー配列の和集合マージ本体。
- `mergeZeroThinkingLists(localZt, remoteZt)`: entries/suggestedThemesだけをマージし、
  失敗時は `null`。
- `sameArrayByReference` / `zeroThinkingListsEqual`: マージで実際に内容が変わったかを
  安く判定する(`mergeById` は変更しなかった項目を同一参照で返すため、参照比較で足りる)。
- `mergeZeroThinkingIntoLocal(remoteZt)`: 上記(b)の合流本体。変化があれば
  `state.zeroThinking` を更新して `true` を返す。

## テスト

`tests/v103.test.js`(新規、7シナリオ):

1. 【本命】ローカルが新しい状態での起動pull → リモート限定entriesが合流して表示される
   (同一id重複なし・新しい方のupdatedAtが勝つ・`dataModifiedAt`が更新され次回pushの対象になる)
2. リモート採用時(remoteが新しい)にローカル限定entriesが失われない
3. themesはマージされない(ローカルで削除したテーマがリモートにまだ残っていても復活しない)
4. 期限切れsuggestedThemesが合流してもTTL剪定で即座に消える
5. リモート取得失敗(500)時は既存動作(マージなし・ローカル保持)を維持する
6. 補足: 自動同期ON時の `runAutoSyncPull`(remoteが古い)でも合流する
7. 補足: 手動「GitHubから読込」(`loadFromGitHub`)でもローカル限定entriesが失われない

`node --check app.js` / `node --check sw.js` / `node --check tests/v103.test.js` すべて exit 0。
`npm run test:core`(v103含む直近5本+固定コア5本)ALL PASS。
`node tests/github-state-blob-fallback.test.js`(1MB超フォールバック・データ消失ガードの回帰
テスト、v103と同じ3同期関数を検証)ALL PASS、回帰なし。

## 残る懸念・未対応

- `review.md` 2026-07-14レビューの高severity指摘「autoSync=false時の旧起動pullで、GET待ち中に
  編集すると競合がある(app.js:9583-9604相当)」は、今回のマージ対応と隣接領域だが対応して
  いない(0秒思考2フィールドへのスコープ限定というK指示どおり)。次サイクルでの対応候補。
- tasks/projects/journals等、他コレクションの「pull全量置換」は今回変更していない
  (`themes`同様、削除操作を持つフィールドが多く、tombstone設計無しでの安易な和集合化は
  危険なため)。
- 同一suggestedThemeを異なる端末でほぼ同時に採用/却下した場合(createdAtが同一かつ
  updatedAtフィールド自体を持たない)の競合解決は、`mergeById`の「新しい方が勝つ」比較が
  タイになり、実質「リモートの状態で上書き」(`Map.set`の後勝ち)になる。極めて稀なケースで
  今回のテストには含めていない。
