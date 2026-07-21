# v135 tasks/projectsのマージ保護(v134のCI green後、K承認済み、2026-07-21)

## 背景(実際に起きた事故、2026-07-20〜21)

リモート側でtasksを外部修正(wish期日99件のNULL化)した30分後、端末が古いローカル状態を
丸ごとpushして修正が消えた。同じ事故が2回発生している。原因: tasks/projectsは
v106のマージ可能コレクション(journals/blocks/体調/睡眠/0秒思考/dailyDeclarations/
weeklyWishes/bodyScans)に含まれておらず、同期は常に「どちらかの丸ごと採用」だった。

## 設計判断

### 1. updatedAtの整備

`updatedAt: nowDateTime()` は実際にはv95前後から既にtasks/projectsのほぼ全ミューテーション
経路(updateTaskField / saveTaskFromModal / status変更各種 / makeTask / saveProjectFromModal /
deleteTask・deleteProject / toggleTask / toggleMIT 等)で保守されていた。現物grep
(`state.tasks = ` / `state.tasks.push` / `state.projects = ` / `state.projects.push` の
全出現箇所を確認)で見つかったギャップは2点のみ:

- **normalizeStateの既定値補完漏れ**: 旧Task/旧Projectに `updatedAt` フィールド自体が
  無かった場合の後方互換補完が無かった。既存値優先で `updatedAt: ""` を補完するよう追加
  (空="不明"のまま扱う。値を推測して埋めると誤った新旧判定を招くため、あえて空のままにする)。
- **カテゴリ改名カスケード** (`updateCategoryField`): カテゴリ名変更に追従してProject/Task/
  Blockの `category` を書き換える処理が `updatedAt` を更新していなかった。改名は実質的な
  内容変更であり、更新しないと同期マージ時に「新しい方が勝つ」判定を素通りして改名が消える
  (=まさに本バージョンが塞ごうとしている事故と同種)ため、3コレクションとも更新を追加。

**意図的にupdatedAtを更新しないと決めた箇所**: `toggleProjectCollapse` / `toggleTaskCollapse` /
`wbs-collapse-all`(WBSの折りたたみ開閉、UI表示状態のみ)。これらは全ミューテーション経路の
「等」に該当しうるが、あえて対象外とした。理由: 折りたたみはUIの見た目状態でしかなく、
頻繁に(閲覧のたびに)発生しうる。もしこれがupdatedAtを更新すると、単なる開閉操作が
「このProject/Taskの内容が更新された」という信号として扱われ、他端末の実際の内容編集が
たまたまその直前に行われていた場合、内容編集の方が古いupdatedAtと判定されてマージで
負けてしまう(=折りたたみ操作が実質的な編集を上書きするナローな形の同じ事故を新たに
作り込むことになる)。UI状態と内容変更を同じ1フィールドで表現している以上のトレードオフとして、
UI状態側を犠牲にする(=マージで古い方の開閉状態が復元されることがある、実害はない)方を選んだ。

### 2. マージ関数

`mergeByIdPreferNewer(localList, remoteList)`: idキー和集合。比較は `updatedAt` のみ
(mergeById[v103、blocks/zeroThinking用]と異なりcreatedAtへフォールバックしない —
tasks/projectsは全経路でupdatedAtを保守する運用のため不要)。同値(両方空を含む)は
第2引数(remote)を採用する。文字列比較の性質(空文字列は常に非空文字列より小さい)により、
この1つの比較規則で「両方値あり→新しい方」「片方だけ空→値がある方」
「両方空(レガシー)→remote」の3条件を同時に満たす。`mergeTaskArrays`/`mergeProjectArrays`
はこれをそのまま使う薄いラッパー。

`両方空→remote` を選んだ理由(K仕様どおり): v135以前、tasks/projectsは全量の新旧二択
(dataModifiedAt比較でremote全量採用 or local維持)だった。updatedAtが両方空(レガシー
データ)の場合、remoteが採用される分岐では最終的にremoteの値がstateに入っていた。
tie-breakをremote優先にすることで、この「従来最終的にstateに入っていた値」と一致させた
(=後方互換)。

### 3. 適用箇所(2経路 + push境界)

既存のマージ可能コレクションと同じ2経路(`computeSyncMerge`→`applySyncMergeToLocal`/
`applySyncMergeToRemote`)へ、既存パターン(blocks/bodyScansと同じ `sameArrayByReference`
による変化検知)を完全踏襲して組み込んだ。`SYNC_CORE_COMPARE_KEYS` から `tasks`/`projects`
を除外(マージ対応済みのため、差分があっても人間判断の競合バナーへは送らない。blocksが
最初からこの一覧に入っていなかったのと同じ扱いに揃えた)。

**push境界の追加修正(`saveToGitHub`)**: 上記2経路だけでは事故を再現よく防げないことが
判明したため、push時のガードも修正した。旧実装は「リモートの方が全体として新しい時だけ」
マージを試みており、端末側で他の編集をしてローカルのdataModifiedAtが先に進んでいると、
リモートの外部修正(dataModifiedAtの更新漏れがあれば尚更 — 2026-07-10実障害と同種)を
合流せずローカルの丸ごとpushで上書きしていた。これがまさに実際の事故の再現条件。
gitのblob SHAは内容が変われば必ず変わる(dataModifiedAtフィールドの更新忘れに依存しない)
ため、`sha !== lastSynced`(リモートが動いたか)だけを判定に使い、dataModifiedAtの大小に
関係なく必ず一度マージを試みるよう変更した。マージ未対応のコア(recurrences/declarations/
questions/experiments)が一致すればそのままpush、一致しなければ人間判断バナーへ、という
判断ロジック自体は既存パターンを踏襲。

**副作用の修正(`runAutoSyncPush`)**: 上記push境界の修正により、`saveToGitHub`内部で
`dataModifiedAt` がさらに進む場合が生じたため、呼び出し元が「呼び出し前の`dataModifiedAt`」
を`lastPushedAt`に記録する旧実装だと、実際にpushされた内容より古い値を記録してしまい
未push判定(v134の同期停止アラートの判定式と同一)が永久に消えなくなるバグを誘発する。
`saveToGitHub`呼び出し**後**の`dataModifiedAt`を見るよう修正した。

### 4. wishシングルトンの重複防止

`reconcileWishProjectDuplicates(mergedTasks, mergedProjects)`: 両端末が同期前に別々に
Wish Project(kind:"wish")を作っていた場合、id和集合だけでは2つ並存してしまう
(normalizeStateの「1つも無ければ作る」保証は「複数ある」ケースを検知しないため、
マージ後に別途ガードする必要があった)。最も古い`createdAt`の1つを正本として残し、
他は論理削除(deleted:true、updatedAt更新のtombstone)。子Task(projectId参照)は
正本へ付け替える(単純deleteだとWishタブから子Taskが消えるため)。`computeSyncMerge`内で
tasks/projectsのマージ直後に適用する。

## 効果の検証

`tests/v135.test.js`(E2E、5シナリオ):
- (a) リモート外部修正(updatedAt付き)がローカル全体としては新しい状況でもpush系フローで
  消えない(実際の事故の直接再現。`saveToGitHub`のPUT内容とローカルstateの両方を検証)
- (b) リモート採用(remoteが全体として新しい)時もローカル編集(updatedAt新)のtaskが消えない
- (c) 削除(deleted:true、updatedAt新)が古い生存コピーで復活しない
- (d) updatedAt両方空の従来データ同士は、remote側の値が採用され従来挙動と一致する(後方互換)
- (e) wishシングルトンの重複防止(両端末が別々に作った場合も1つに集約、子Taskは付け替え)

## 回帰

- `tests/v72.test.js`(privacy/同期ゲート): 無改変で全PASS
- `tests/v106.test.js`(v106双方向マージ): 無改変で全PASS
- `tests/v118.test.js`(GET待ち中編集ロスト競合): tasks/projectsがマージ可能になったことで
  「Project差分のみ」は今はコア一致とみなされ自動解消される(以前は無条件で競合バナー行き
  だった)ため、シナリオ[1]の期待値を更新。本来の目的である「state=adoptedによる全置換が
  起きていない」ことの検証は、ローカル編集とremote限定Projectの両方が生き残ることで継続
  確認する。マージ未対応のコア(questions)が同時に分岐する場合は従来どおりバナーが出ることを
  新規シナリオ[1b]で追加確認。シナリオ[2](編集無し正常ケース)も、remote採用時にローカル
  限定Projectが消えずに合流するよう期待値を更新(journals/blocksが既に持っていた
  「採用前にローカル限定の記録を合流させる」既存パターンにProjectも乗っただけで、
  新しい仕組みを追加したわけではない)
- `tests/v133.test.js`: 無改変で全PASS
- `npm run test:core` および `npm test`(全量): 全PASS

## 自信がない箇所

- `updatedAt`網羅性の確認方法は現物grep(`state.tasks = ` / `state.tasks.push` /
  `state.projects = ` / `state.projects.push` の全出現箇所を1件ずつ目視)によるもので、
  将来UIから間接的にtasks/projectsを書き換える新しいコードパスが追加された際に
  `updatedAt`更新を忘れるリスクは構造的には残る(型システムやlintでの強制はしていない)。
- `saveToGitHub`のpush前ガード修正により、`sha !== lastSynced`が真になるたびに追加のGET
  リクエストが1回発生するようになった(以前は`remoteT > dataModifiedAt`の時だけ)。頻度は
  「前回同期後にリモートが動いた場合のみ」なので通常運用での増加は僅かだが、ネットワーク
  コスト面の影響は未計測。
- wishシングルトンの正本選定は`createdAt`の最古を採用しているが、`createdAt`も欠損している
  極端なレガシーデータ(空文字)が複数ある場合は`localeCompare`の安定ソート順(=配列の
  出現順、実質ローカル優先)に落ちる。実運用でこのケースが発生する可能性は低いと判断し、
  追加のフォールバック設計はしていない。
