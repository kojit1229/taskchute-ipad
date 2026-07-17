# CHANGES v118

## 概要

taskchute-notes/review.mdの未対応指摘(severity: high、対象: app.js:76,9583-9604 ※指摘時点の
行番号。現物調査の結果、該当箇所は`syncFromGitHubOnStartup()`(起動時pull・autoSync=false時の
旧経路))に対応。GET待ち中にユーザーが編集すると、その編集がremote全量採用で消えてしまう
競合を修正した。SW `CACHE_NAME` を v117 → v118 に更新。

## 問題

`syncFromGitHubOnStartup()`は、起動時点でスナップショットした`_startupDataModifiedAt`
(v37。fetch中にsaveStateが走ってもlocalTが進まないようにする意図的な設計)と、GETしてきた
remoteの`dataModifiedAt`を比較し、remoteが新しければ`state = adopted`でローカルstateを
まるごとremoteへ差し替えていた。

この比較自体はv37の意図どおりだが、**採用直前(`state = adopted`)までの間に、GETのawaitを
待っている間にユーザーが実際に編集した場合**、その編集内容がstateへ反映済みであっても
比較には使われず(`_startupDataModifiedAt`は起動時点で固定されたまま)、`state = adopted`で
編集ごとローカルstateが上書きされて消えてしまう。これがremote側に存在しないローカル限定の
記録(例: Project新規追加)であれば、マージ機構(v103〜v106の`applySyncMergeToRemote`)の
対象コレクション(journals/blocks/体調/睡眠/0秒思考/dailyDeclarations)に含まれないため、
グラフトもされずに完全消失する。

## 修正

`syncFromGitHubOnStartup()`内、GET(`downloadGitHubStateText`のawait)を発行する直前に
`preFetchDataModifiedAt = state.dataModifiedAt`を控えておき、remote採用が決まった直後
(`state = adopted`の直前)に**現在の`state.dataModifiedAt`がこのスナップショットと一致するか**
を再確認するガードを追加した。

- 一致(=GET待ち中に編集されていない) → 従来どおりremoteを全量採用。
- 不一致(=GET待ち中に編集された) → remote全量採用を中止し、`runAutoSyncPull()`
  (autoSync=trueの新経路)が「両方に未反映の変更」を処理する`hasUnpushed`分岐と
  **同じ設計・同じ既存関数**(`applySyncMergeToLocal`/`syncCoreEqual`/`setSyncBanner`/
  `clearSyncBanner`)で処理する:
  1. マージ可能コレクション(journals/blocks/体調/睡眠/0秒思考/dailyDeclarations)だけ
     remoteとの和集合をローカルへ先に合流させる。
  2. コア(`tasks`/`projects`/`recurrences`/`declarations`/`questions`/`experiments`)まで
     remoteと一致していれば、人間判断を待たず和集合を正として自動解消する
     (`lastPushedAt`をremoteへ追いつかせ、`dataModifiedAt`を進めてトースト表示)。
  3. コアが不一致(=GET待ち中の編集がコアに触れていた)なら、remote全量採用はせず、
     既存の競合バナー機構(`_syncBanner`/`.sync-banner`、設定画面遷移リンク付き)を
     そのまま再利用して告知するだけに留める。新しいUIは作っていない。ローカルの編集は
     一切破棄しない。

新しいUI・新しい状態フィールドは追加していない。既存の`_syncBanner`/`setSyncBanner`/
`clearSyncBanner`/`renderSyncBanner`(既にautoSync経路で使われている競合バナー機構)を
そのまま流用した。

## v103〜v106のマージ救済との整合

- コンフリクト検知後にまず`applySyncMergeToLocal`でマージ可能コレクションを合流させてから
  判定するため、v103〜v106が守っていた「ローカル限定の記録(iPhone分など)を消さない」という
  不変条件はこの分岐でも維持される。
- 一致判定でそのままremoteへ進む従来分岐(GET待ち中の編集が無いケース)は一切変更していない
  ため、v106テスト(既存スイート、legacy起動pullのマージ挙動)への影響はない
  (`node tests/v106.test.js`で回帰確認済み、下記「検証」参照)。

## autoSync=trueの新経路への影響

`syncFromGitHubOnStartup()`は`state.settings.autoSync === false`の時だけ呼ばれる関数
(`if (state.settings.autoSync) runAutoSyncPull(); else syncFromGitHubOnStartup();`)であり、
`runAutoSyncPull()`自体には一切手を入れていない。`v72.test.js`(トークンゲート・GitHub API
全般)・`v106.test.js`の`[3]`(autoSync経路の和集合自動解消)がいずれもPASSしており、新経路の
挙動が変わっていないことを確認した。

### sw.js

`CACHE_NAME`を`taskchute-journal-pwa-v118`に更新。

## 検証

- `node --check app.js` / `node --check sw.js` / `node --check tests/v118.test.js` すべてexit 0。
- `tests/v118.test.js`(新規)ALL PASS:
  (a) legacy起動pull(autoSync=false)のGET応答を`page.route`で意図的に遅延させ、待機中に
  実UI操作(WBSタブでProjectを追加、`data-action="add-project"`)を注入 →
  追加したローカルProjectが消えずに残る/remote限定のProjectは取り込まれない(=remote全量
  採用が起きていないことの確認)/既存の競合バナー(`.sync-banner`)が表示される、の3点を確認。
  (b) GET待ち中の編集が無い正常ケースでは、従来どおりremoteが全量採用される(remote限定
  Projectが反映され、ローカル限定だったProjectはremoteに無いので消える)ことを確認。
  **本テストが実際にバグを検知できることを、修正コードを一時的に元へ戻して同テストを実行し
  4件が想定どおり失敗する(remote限定Projectが混入し、ローカル編集が消え、バナーも出ない)
  ことを確認した上で、修正コードへ復元して再度ALL PASSを確認済み**(復元後、
  `grep -n "v118: 採用直前の不変確認" app.js`でパッチが残っていることも確認)。
- `node tests/run-all.js v118 v72 v117` → 3スイートともALL PASS。
- `npm run test:core`(直近5件+固定コア5件、動的選定でv118を含む10スイート:
  v118/v117/v116/v115/v114/v72/v59/v67/v50/v70) → 全10スイートALL PASS(所要約263秒)。
- 追加の回帰確認(必須要件外、任意で実施): `node tests/v106.test.js`(legacy起動pullの
  双方向マージ・autoSync自動和集合解消)ALL PASS。本修正が触れた関数の既存挙動が壊れて
  いないことを重ねて確認した。

## 未対応・懸念点

- コンフリクト時のバナー文言は、既存の`runAutoSyncPull()`の`hasUnpushed`分岐の文言
  (「リモートに新しいデータ。ローカルにも未pushの変更があります。設定から手動で確認して
  ください」)とは意図的に少し変えてある(「編集中に取得したため自動取込を中止しました」)。
  発生経路(GET待ち中の一瞬の競合 vs 通常の未push状態)が異なるため利用者に伝わりやすい
  文言にしたが、統一すべきかは判断が分かれる可能性がある。
- 「GET待ち中に編集」の検知窓は`downloadGitHubStateText`のawait1回分のみ。この関数呼び出し
  自体の前後(例: `normalizedRemoteCopy`/`computeSyncMerge`の同期処理中)はawaitを挟まない
  ため対象外(そもそも競合の起きようがない)。
- 本修正はローカルcommitしていない(指示どおり。監督者レビュー後にcommit・push予定)。
