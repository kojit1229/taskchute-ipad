# v156 ADHD支援「①仕分けモード S3(Undo)」

仕分けモード(v152ボタン版/v154スワイプ)の三択実行後に5秒間のUndoトーストを出し、押すと
直前の1操作だけを完全に巻き戻す(designs/03-task-swipe.md §③「誤操作対策」、K確定事項
2026-07-27「手放すの復元はUndoトースト(直後のみ)で足りる。復元一覧画面は作らない」)。
これでADHD支援2機能シリーズ(①仕分けモード/②今日の庭)の実装ステップが完了する。

データモデルへの新フィールド追加はゼロ(`_triageUndo`はモジュールレベルの非永続変数のみ)。
新しいトースト機構は作らず、v150の完了トースト機構(`showToast`のアクションボタン+
pointer-events対策)を汎用化して再利用した。

**本ファイルは初回実装+2系統レビュー(Claude+Codex)対応後の最終版**。1〜5節は初回実装の
説明(ログ取り消し方式は6節の記述で上書き済み)、6節が2系統レビュー対応の追加分。

## 1. showToastの汎用化(app.js)

v150時点の`showToast(message, { blockId, actionLabel })`は`complete-block-with-actual`
固定のボタンしか出せなかった。`{ action, id, label, durationMs }`を受けられるよう拡張し、
`blockId`指定は後方互換のショートハンド(`action="complete-block-with-actual"`)として残した。
既存呼び出し(v150の完了直後トースト)は無変更のまま動く。`durationMs`はUndo用に5秒
(設計書どおり)を個別指定できるようにし、未指定時は従来どおり4.5秒。

5秒経過後の失効はv150で確立済みの機構(タイマー満了で`show`/`has-action`を外す+
`.toast:not(.show) { pointer-events: none !important; }`)にそのまま乗る。新しい期限管理
コードは書いていない。

## 2. Undoの実装方針(app.js、`triageAction`内)

`triageAction`の6分岐(kind: block/wish × action: today/drop/defer)それぞれに、

1. 変更前の対象レコードを**丸ごとスナップショット**(`{ ...record }`)
2. 新規作成されるレコード(`carryOverBlock`が作る複製Block、`moveBlockToWish`が作るWish、
   `wishSubtaskToTasks`が作るBlock)は**id集合の差分検出**で特定する(これらの関数は既存の
   共有関数〈`requestCarryOver`パネル等からも呼ばれる〉のため、戻り値やシグネチャを変えず
   に済む安全な方法を選んだ)
3. `_triageUndo = { guardId: id, revert() {...} }` を成立時にのみセットし、Undoトーストを表示

を追加した。`revert()`は「新規レコードの削除」+「スナップショットでの丸ごと置換
(`updatedAt`のみ`nowDateTime()`で現在時刻へ)」+「`swipeTriageLog`/`migrationRitualLog`の
該当エントリを取り消す(方式は6節参照。初回実装の`.slice(0, -1)`案は2系統レビュー対応で
参照一致方式へ置き換えた)」+「`_triageSessionDone`から対象idを外す(キューへ再浮上させる)」
を行うだけの純粋なstate操作で、呼び出し元の`triageUndo(id)`が
`saveAndRender("元に戻しました")`をまとめて行う。

**Undo対象**: 直前の1操作のみ(スタック無し)。`_triageUndo`は次の`triageAction`成立時に
上書きされるだけで自然に失効する(明示的なクリア処理は不要)。

## 3. kind×action別の巻き戻し内容

| kind | action | 生成物の取り消し | 復元するフィールド |
|---|---|---|---|
| block | today | `carryOverBlock`が作った複製Blockを削除 | 元Block丸ごと(`migratedTo`含む) |
| block | drop | なし(deleted化のみ) | 元Block丸ごと(`deleted`含む) |
| block | defer | `moveBlockToWish`が作った新規Wishを削除 | 元Block丸ごと(`deleted`含む) |
| wish | today | `wishSubtaskToTasks`が作ったBlockを削除 | 対象(サブタスク or 本体自身)丸ごと。サブタスク経由の場合は本体のupdatedAt巻き戻しも含む |
| wish | drop | なし(カスケードdeleted化のみ) | 本体+カスケード削除された全子孫を、削除に使った同じid集合でそれぞれ丸ごと復元(取り違え防止) |
| wish | defer | なし(targetMonth/targetYear変更のみ) | 元Wish丸ごと(`targetMonth`/`targetYear`のロールオーバー〈12月→翌年1月〉も含めて復元) |

wish/todayの「対象がサブタスクか本体自身か」は既存の`nextStepOf(id)`判定をそのまま使い、
Undo側もこの分岐に対応する2種類のスナップショット(`targetSnapshot`/`bodySnapshot`)を持つ
だけで、状態遷移ロジック自体(既存関数呼び出し)には一切手を入れていない。

`wishSubtaskToTasks`は「既に今日Block済み」等のガードで何もしない場合があり、その場合は
新規Blockのid差分が検出できない(=何も実際には起きていない)ため、**Undoを登録せず
既存の(ガード用)トーストをそのまま出す**ようにした(何も起きていない操作にUndoを
出すと利用者を混乱させるため)。

## 4. updatedAtは復元時に現在時刻(設計書どおり)

すべての復元で`updatedAt`だけはスナップショットの値を使わず`nowDateTime()`(現在時刻)に
する。id+updatedAtマージ方式の同期(v135〜)で、復元した値が「古いデータ扱い」されて
他端末の同期時に負けないようにするため(タスク指示・decisions.md双方の要求どおり)。

**既知の副作用**: Wish系(today/drop/defer)の復元はWishバックログの並び順
(`triageQueue`のwishQueueは`updatedAt`昇順)にも影響する。`updatedAt`を現在時刻へ更新する
ため、Undoした直後のWishはキューの**末尾**へ回り、直前のカードとして即座には再表示され
ない(テストではUndo後に別の単独フィクスチャへ切り替えて確認しているため、この副作用は
表面化していない)。一方Block系(carryableBlocks()は`updatedAt`でソートしない)は元の
配列位置がそのまま保たれるため、Undo直後は元のカードが（他に処理待ちが無ければ）そのまま
再表示される。この非対称はdecisions.md 2026-07-27の「updatedAtは現在時刻」という明示指示を
優先した結果であり、意図的なトレードオフとして残した。

## 5. 既存テストへの影響

`triageAction`のシグネチャ・戻り値(boolean)は無変更。既存分岐の先頭に「スナップショット
取得」を追加しただけで、状態遷移そのもの(既存関数呼び出し・条件分岐)には一切手を
入れていない。`showToast`は後方互換を保ったまま引数を汎用化しただけ。

- `tests/v152.test.js`(ボタン版、全54チェック): 無変更でALL PASS
- `tests/v154.test.js`(スワイプ、全39チェック): 無変更でALL PASS
- `tests/v150.test.js`(完了トーストのアクションボタン機構、pointer-events対策込み): 無変更で
  ALL PASS(`showToast`の汎用化が既存の`blockId`経路を壊していないことを確認)

## 6. 2系統レビュー対応(2026-07-28、Claude+Codex)

### 6-1. ログ取り消しの堅牢化(必須1)

初回実装の`.slice(0, -1)`(末尾1件を捨てる)方式は2点弱点があった: (a) 位置(末尾かどうか)に
暗黙に依存しており、将来の変更で不変条件が崩れると誤ったエントリを消しかねない、
(b) 上限(200件/300件)到達時にトリムで押し出された最古エントリを復元しておらず、Undo後の
件数が199件/299件に減ってしまう(欠損)。

対応: `logSwipeTriage`/`logMigrationRitual`の戻り値を`{ entry, evicted }`に変更した
(`entry`=積んだエントリそのものへの参照、`evicted`=上限超過で押し出された最古エントリの
配列。既存の戻り値未使用の呼び出し元には影響なし)。`triageAction`側は新設の
`triageUndoLogArray(arr, entry, evicted)`ヘルパーで、`arr.filter((e) => e !== entry)`
(**参照一致**でエントリを除去。位置に依存しない)→ `evicted`があれば先頭へ復元、という
2ステップで巻き戻す。no-op経路(`wishSubtaskToTasks`のガード等で`_triageUndo`が
登録されない場合)は、そもそも`entry`への参照を持つrevertクロージャ自体が作られないため、
誤って別のエントリを消す余地が構造的に存在しない。

### 6-2. 5秒失効の完全化(必須2、Codex指摘)

CSSの`pointer-events: none`は「マウス/タッチでの押下」しか防げず、Undoボタンに既に
キーボードフォーカスが当たっていた場合、5秒経過後でもEnter/Spaceでの活性化がCSSを無視して
素通りしてしまう欠陥があった。`showToast`に`onExpire`コールバックを追加し(タイマー満了と
同時に呼ばれる)、`triageUndoToastOpts()`がここで`_triageUndo`を明示的に`null`化するように
した。`triageUndo(id)`は`guardId`不一致(または`_triageUndo`が`null`)なら即returnするため、
期限切れ後にEnterで発動しても実質無害になる。`showToast`自体は他機能でも使う汎用関数の
ため、この挙動は`onExpire`という汎用フックとして実装し、triage固有の知識を持ち込んでいない。

### 6-3. 推奨修正(すべて対応)

- **`_lastSaveError`ガード(推奨4)**: block/today・wish/today経路は`carryOverBlock`/
  `wishSubtaskToTasks`の内部`saveAndRender`が容量超過警告を出した直後に、`triageAction`が
  無条件で`showToast(...)`を呼び直しUndoトーストへ**上書き**していたため、警告が握り潰される
  欠陥があった(`saveAndRender`自体は`_lastSaveError`を見て警告を優先する実装だが、triage側の
  追加`showToast`呼び出しはそのガードを経由していなかった)。両箇所に`if (!_lastSaveError)`を
  追加した(`saveAndRender`を直接使うdrop/defer分岐はもともと内部でガードされており対象外)。
- **showToast汎用経路のlabel必須化(推奨5)**: `{ action, id }`だけでラベル省略時に
  「実績を編集」という無関係な既定文言が出てしまう余地があったため、汎用経路
  (`hasGenericAction`)は`label`必須にし、未指定ならボタン自体を出さない(`hasAction=false`)
  ようにした。`blockId`指定の後方互換経路のみ従来どおり`actionLabel`省略時「実績を編集」に
  フォールバックする。
- **テストヘッダのコメント項番ズレ修正(推奨6)**: `tests/v156.test.js`冒頭の「検証項目」一覧が
  本文の実際の`[4]`〜`[9]`番号とズレていたため修正した(本文コード自体の番号は当初から
  正しかった)。本ファイル・handoff.mdの「43チェック」は実数(68チェック、下記参照)へ修正した。
- **追加テスト2件(推奨7)**: `tests/v156.test.js`に`[12]`(スワイプ経由・via:"swipe"のUndo)・
  `[13]`(v150完了トーストとの混在シーケンス)を追加した(詳細は「検証」節参照)。

## 検証

`tests/v156.test.js`(全68チェック、`[1]`〜`[13]`)。

- **[1]-[3] Block(今日やる/手放す/延期)**: それぞれUndo後、元Blockが`updatedAt`を除く
  全フィールドで一致(`sameExceptUpdatedAt`)し、生成物(複製Block/新規Wish)が消え、
  `swipeTriageLog`/`migrationRitualLog`が該当1件ぶん0件へ戻ることを検証
- **[4]-[5] Wish今日やる(サブタスク無し/有りの2ケース)**: 対象(本体 or サブタスク)の
  完全復元、サブタスク経由の場合の本体updatedAt巻き戻し、作られたBlockの消滅を検証
- **[6] Wish手放す(カスケード3階層)**: 本体+子孫すべてが同じid集合で正しく(取り違えなく)
  復元することを検証
- **[7] Wish延期(12月→翌年1月ロールオーバー)**: `targetMonth`/`targetYear`とも元の値へ
  戻ることを検証
- **[8] 5秒失効**: v150 A11と同じ検証方式(実際のポインタ座標への`page.mouse.click`)で、
  5秒経過後は`#toast.has-action`が外れ、その位置への実クリックでもUndoが発火しないことを検証
- **[9] 次の操作での失効/連続操作時の対象取り違えなし**: 対象A(今日やる)→対象B(手放す)の
  順で処理後、表示中のUndo(B用)をクリックしてもAには一切影響せず、Bだけが復元されること、
  `swipeTriageLog`もA分の1件だけが残ることを検証
- **[10] 上限到達時のUndo**: `swipeTriageLog`を200件(上限)で満たした状態でアクション→
  トリムで最古(`old-0`)が押し出される→Undo→200件のまま元の200件と`JSON.stringify`完全一致
  (押し出されていた`old-0`の復元込み)を検証
- **[11] 5秒失効の完全化**: Undoボタンへ`focus()`した状態で5秒経過後、`page.keyboard.press
  ("Enter")`を送っても発動しないこと(`_triageUndo`のnull化)を検証
- **[12] スワイプ経由(via:"swipe")のUndo**: `page.mouse`によるスワイプ確定分もボタン経由と
  同様に完全復元することを検証
- **[13] v150完了トーストとの混在**: 仕分けのUndoトースト表示中に別Blockをホームで完了すると、
  古いUndoボタンが残らず、v150の「実績を編集」ボタンへ正しく置き換わり、かつ仕分け側の
  状態は誤って巻き戻らないことを検証

`node tests/v156.test.js`単体実行で全PASS(68/68、連続2回実行してフレーキーでないことを確認)。
`node tests/run-all.js v156 v152 v154 v150`を実行し全PASS(既存スイートに回帰無し)。
`npm run test:core`(直近5バージョン+固定横断コア5本、フォアグラウンド実行)を実行し
全PASS(190.5s)。

push前・CIでの全量実行(`npm test`)は別途必要。

## 対応できなかった項目・懸念点

- **Wish系Undoのキュー位置副作用**(4節既述): updatedAtを現在時刻へ更新する設計上の要求と、
  「Undo直後に同じカードがすぐ再表示されてほしい」というUX上の期待が両立しない。今回は
  decisions.mdの明示指示(updatedAtは現在時刻)を優先し、キュー末尾へ回る挙動をそのまま
  残した。実運用で違和感が強ければ、Wishのソートキーを別途持たせる再設計が要る。
- **ホームの「仕分けするN件」バナー**: designs/03-task-swipe.md §⑤S3の一部だが、K確定
  事項(2026-07-27)には含まれておらず、今回の依頼書(v156)のスコープにも明記が無かった
  ため未実装。後続ステップとして別途判断を仰ぐ。
- **swipeTriageLog/migrationRitualLogの取り消し方式**(6-1節で解決済みだが記録として残す):
  「参照一致で除去+押し出された最古エントリを復元」方式は、あくまで「Undoは操作を無かった
  ことにする」という設計思想のもとログエントリも削除する。「取消記録を追記」方式
  (append-onlyのまま`outcome:"undone"`等を別途積み、削除はしない)の方が監査ログとしての
  完全性は高い可能性があり、バッチ側で「Undoされた操作」自体を学習シグナルとして使いたい
  要求が将来出た場合は、そちらへの再設計を検討する余地がある。
