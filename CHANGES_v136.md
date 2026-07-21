# v136 レビュー2系統の指摘対応(Claude reviewer PASS + Codexレビュー High3/Med4、K承認済み、2026-07-21)

v135(tasks/projectsのマージ保護)完了後、Claude reviewerとCodexレビューの2系統に通した。
Claude reviewerはPASS(軽微2件、コード変更不要)、CodexレビューがHigh3件・Med4件を検出
(いずれも実コード行の裏取り付き、監督者裁定で妥当と判断)。本バージョンで全件対応する。

## High-1: saveToGitHubのfail-open修正(fail-closedへ)

**指摘**: SHA不一致検知後、リモート本文取得失敗(`catch {}`で握り潰し)・
`normalizedRemoteCopy()`がnull・`computeSyncMerge()`失敗のいずれの場合も、マージせずに
取得済みSHA付きPUTへ進んでしまう。読めなかったリモート変更をローカル全量で上書きできる。

**対応**: `saveToGitHub()`の該当分岐を、取得・正規化・マージ計算のいずれかが失敗した時点で
`fetchFailed || !remoteText || !remoteNorm || !syncMerge` を判定し、保存を中止(fail-closed)
するよう変更した。中止時は`setSyncBanner()`で「リモートの変更を取得できなかったため保存を
保留しました。次回保存で再試行します」を通知する(silent時は`updateAutoSaveStatus`)。
何もpersistしないため、次回の保存(手動・自動いずれも)で自然に再試行される。

## High-2: mergeByIdPreferNewerにtieWinnerパラメータを追加

**指摘**: updatedAtが同値・両空のtie-breakが常にremote採用固定だったため、ローカルが
全体としては新しい分岐(applySyncMergeToLocal経由)でも、同一idの内容だけ古いremoteへ
巻き戻ってしまう。旧データ(updatedAt空)同士は特に全件該当し、従来挙動(ローカル維持)と
不一致だった。

**対応**: `mergeByIdPreferNewer(localList, remoteList, tieWinner)`にtieWinner("local"|"remote")
を追加し、`mergeTaskArrays`/`mergeProjectArrays`/`computeSyncMerge`まで一貫して引き回した。
呼び出し元は「ローカルを基準に残す経路(`applySyncMergeToLocal`が最終的に使う)」では
`"local"`、「リモートを採用する経路(`applySyncMergeToRemote`が最終的に使う)」では
`"remote"`を明示する。全9箇所の呼び出し元(`saveToGitHub`、`runAutoSyncPush`、
`runAutoSyncPull`の3分岐、`loadFromGitHub`、`syncFromGitHubOnStartup`の3分岐)を洗い出し、
それぞれの適用先に合わせて設定した。

**実装上の注意**: `computeSyncMerge`は従来、1つの関数呼び出しの結果を複数分岐(どちらの
`applySyncMergeTo*`を使うかは実行時の条件分岐で決まる)で使い回していた。tieWinnerは
分岐ごとに異なるため、`runAutoSyncPull`/`syncFromGitHubOnStartup`は各分岐の内側で個別に
`computeSyncMerge`を呼ぶよう再構成した(実行されるのは常に1分岐のみのため、計算コストの
増加は無い)。

## High-3: 同秒タイでの削除復活を防止(トゥームストーン優先)

**指摘**: updatedAtが同値の場合、削除(deleted:true)側を優先しないと、「同じ秒にlocal削除・
remote編集」のような競合で削除が復活してしまう。

**対応**: `mergeByIdPreferNewer`の優先順位を「1. updatedAtが新しい方 → 2. 同値ならdeleted:true
側 → 3. 同値・同じdeletedフラグならtieWinner」に変更した。tieWinnerより先にトゥームストーン
判定を行うため、tieWinner="remote"の文脈でも、ローカルの新しい削除がremoteの同秒の生存
コピーに復活させられることはない(逆方向も同様)。

## Med-4: Wish正本選定にid辞書順のtie-breakを追加

**指摘**: createdAt同値・欠損時のtie-breakが無く、端末非依存の決定性が保証されていなかった。

**対応**: `pickCanonicalSingleton(candidates)`を新設し、`createdAt`が同値の場合は`id`の
辞書順で決定する(以前は配列の出現順=実質ローカル優先という暗黙の依存があった)。

## Med-5: kind:"other"シングルトンの重複を汎用ガードへ拡張

**指摘**: `getOtherTask()`(Blockのtaskid受け皿)も`getWishProject()`と同じ`.find()`先勝ち
方式で参照されており、Wish同様の重複リスクを持つのに対応していなかった。

**対応**: `reconcileWishProjectDuplicates`を`reconcileSingletonDuplicates(mergedTasks,
mergedProjects, mergedBlocks)`へ汎用化した。Project側シングルトン(kind:"wish","other")の
重複排除は従来どおり子Task(projectId参照)を正本へ付け替え、加えてTask側シングルトン
(kind:"other"のTask自体)の重複も検知し、参照するBlock(taskid)を正本へ付け替えるように
した。`computeSyncMerge`内でblocks(mergeBlockLists後)・tasks・projectsを合わせて渡し、
3コレクションの整合を1箇所で確定させる。

## Med-6: v134赤帯の偽陽性を解消

**指摘**: 手動保存・legacy 30秒自動保存(autoSync=false)の成功時に`lastPushedAt`を
更新していなかったため、v134の同期停止アラート判定(`dataModifiedAt!==lastPushedAt`)が
「変更なし」でも6時間後に赤帯を出す偽陽性を招いていた(autoSync運用のpushだけ
`runAutoSyncPush`側で個別に更新していた)。

**対応**: `saveToGitHub()`の成功パスに`state.settings.lastPushedAt = state.dataModifiedAt;`
を追加した。push経路(手動・legacy自動保存・autoSync)を問わず、この関数を経由する限り
必ず更新される。あわせて、fail-closedで出したバナーが残ったままにならないよう
`clearSyncBanner()`も成功時に呼ぶようにした。

## Med-7: remote 404(ファイル消失)の暗黙再作成を防止

**指摘**: `lastSynced`が存在するのに現在のremote SHAが空(ファイル消失・権限喪失等)の場合、
旧実装は`sha && sha !== lastSynced`のガードが丸ごとスキップされ、初回作成と区別せず
暗黙のSHAなしPUT(=新規作成扱い)で上書きしていた。

**対応**: ガード条件を`sha !== lastSynced`に変更した(`sha`の真偽で先にふるい落とさない)。
`lastSynced`が空(真の初回)の場合は従来どおり素通り、`lastSynced`が非空でSHAが空になった
場合はHigh-1のfail-closedと同じ経路(リモート取得を試み、失敗すれば保存を中止)へ合流する。

## テスト

`tests/v136.test.js`(E2E、6シナリオ): [1]High-1(fail-closed)、[7]Med-7(remote消失)、
[6]Med-6(赤帯偽陽性解消)、[2]High-2(tieWinner=localでのtie)、[3]High-3(同秒タイの
トゥームストーン優先)、[5]Med-5(kind:"other"の重複防止・Block付け替え)。

**テスト実装時に発見した既存テストのバグ(v135(a)を修正)**: `page.evaluate()`で
`localStorage`に直接注入した変更は、実行中ページのメモリ上`state`(`loadState()`は
起動時に1回しか走らない)には反映されない。`v135.test.js`のシナリオ(a)はreload無しで
`save-github`をクリックしていたため、「ローカルに古いtaskが無く、remoteのtaskだけが
和集合で追加された」という別のケースを偶然テストしてしまっており、本来検証したかった
「同一idで新旧が競合し新しい方が勝つ」ケースを検証できていなかった(アサーション自体は
たまたま同じ結果になり合格していた)。注入後に`page.reload()`を挟むよう修正した
(弱体化ではなく検証精度の向上。`tests/v136.test.js`の[1]でも同じ注意が必要だったため
最初から reload込みで実装した)。

## 既存テストの仕様追随更新

`tests/v94.test.js`(保存先パス正規化)が、High-1のfail-closed化と衝突していた。同テストは
複数回連続で`save-github`を叩く前提で、GETを常に404返すモックを使っていたが、1回目の
保存成功後は`lastSyncedSha`が確定するため、2回目以降のGET 404が「リモートが読めない」
(=Med-7で塞いだのと同じ状況)として正しくfail-closed発動し、PUTされなくなっていた。
これは仕様変更に伴う正当な挙動変化であり、テストのモックを「pushした内容が次のGETで
読める」という実際のGitHubに近い挙動へ修正した(検証内容=保存先パスの正規化そのものは
無変更・弱体化なし)。

## 回帰

- `tests/v72.test.js` `v106.test.js` `v118.test.js` `v134.test.js` `v135.test.js`:
  無改変(v118は既にv135で仕様追随済み)で全PASS
- `node tests/run-all.js v136 v135 v134 v118 v106 v72`: ALL PASS
- `npm run test:core`: ALL PASS
- `npm test`(全量、86スイート。フォアグラウンドで3バッチに分割して実行): 全PASS
  (v94.test.jsの1件は上記のとおりモック更新で対応)

## 自信がない箇所

- tieWinnerの割り当ては9箇所の呼び出し元をすべて手動で洗い出して割り当てたもので、
  将来新しい呼び出し元(新しい同期経路)が追加された際に割り当てを誤ると、High-2で
  修正した問題が形を変えて再発するリスクがある。型システムでの強制はしていない。
  (`computeSyncMerge`のtieWinner引数は必須にしていない=未指定時はmergeByIdPreferNewer側で
  暗黙に"local"扱いになる。呼び出し忘れに気づきにくい設計であり、将来lintルール等での
  強制を検討する余地がある)
- Low項目(トゥームストーン・複数端末IDの単調増加)はコード対応せず、
  `taskchute-notes/review.md`に記録のみ。将来の圧縮処理は未設計。
- `reconcileSingletonDuplicates`のTask側(kind:"other")重複解消で、正本以外のTaskを
  `deleted:true`にした際、そのTaskに紐づいていたサブタスク(parentTaskId参照)がある場合の
  扱いは明示的にテストしていない(その他Taskは通常サブタスクを持たない運用のため実害は
  低いと判断したが、未検証)。
