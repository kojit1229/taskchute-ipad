# v152 ADHD支援「①仕分けモード S1(ボタン版)」

決断疲れによる仕分けの先送りに対処する機能(designs/03-task-swipe.md、K承認事項2026-07-27)。
Wishタブに第3の表示モード「🃏 仕分け」を追加し、前日先送りBlock+Wishバックログを1枚ずつ
「今日やる/手放す/延期(来月)」の三択ボタンで処理する。スワイプ操作・Undoトースト・ホームバナーは
後続ステップ(S2/S3)。

**本ファイルは初回実装+2系統レビュー(FAIL判定、必須7件+裁定1件)対応後の最終版**。
初回実装で見つかったキュー終端性バグ・記録漏れ・端末間同期漏れ・二重タップ耐性の欠如を修正した。

## 1. データモデルへの影響: ゼロ

`tasks`/`blocks`/`projects` への新フィールド追加はなし。既存の
`migratedTo`/`carryCount`/`deleted`/`updatedAt`/`targetMonth`/`targetYear`/`status` だけで
三択すべてを表現する。追加はUI状態(`wishViewMode`の新値`"triage"`。既存の`|| "list"`
フォールバックで安全なため移行不要)とログ(`swipeTriageLog`、上限200件、`normalizeState`に
配列保証を1行追加)のみ。

## 2. キュー構築(`triageQueue`, app.js)と終端性(2系統レビュー必須1)

`renderWish()`が既に構築しているarea/実現済みフィルタ済みの`wishes`をそのまま
`renderWishTriage(wishes)`へ渡す(仕分けも今見ているフィルタ範囲に揃える。フィルタ無しなら全件)。

1. **先送りBlock**: `carryableBlocks()`(既存、前日未完了・未繰越・未削除)をそのままの順で
2. **Wishバックログ**: 渡された`wishes`から`!realized`のものを`updatedAt`昇順でソート

キューは毎回の描画で現在stateから再計算し、常に先頭(`queue[0]`)だけをカードとして表示する。

**初回実装のバグ(2系統レビュー最重要指摘)**: 「今日やる/延期」を選んだWishは元データを
削除しない(Wish自体は残る)ため、`updatedAt`bumpで末尾へ回るだけでは**同じセッション内に
何度も先頭へ再浮上し**、一巡後は「今日やる」を押してもトーストだけで無反応になっていた
(`wishSubtaskToTasks`が「既に今日のタスクシュートにあります」で早期returnするため)。

**修正**: 2段構えの除外を追加した。
1. **セッション内除外**(`_triageSessionDone`、モジュール変数・非永続のSet): `triageAction`が
   成立した`id`はkind/actionを問わず必ずここへ積み、`triageQueue`はこのSetに含まれる
   block/wishを除外する。ページリロードで空になる(=次回セッションでは通常どおり再評価される)。
2. **永続除外**(`wishHasTodayBlock`): `status==="doing"`かつ「本体または子孫サブタスクのいずれかが
   実時計の今日日付のBlockを持つ」Wishはキューから除外する。`_triageSessionDone`はリロードで
   消えるため、これが無いと新規セッション(ページリロード後)でも同じWishが再出現し続ける。

Block「延期」(`moveBlockToWish`)は新規Wishタスクを1件生成するため、素朴に実装すると
「1件処理して1件増える」で残枚数が減らない。生成された新Wishの`id`も同じ`triageAction`呼び出しの
中で`_triageSessionDone`へ即座に積むことで、この場で延期すると判断した対象が同じセッション中に
再度カードとして出てこないようにした(次回セッションでは通常のWishバックログとして自然に現れる)。
この結果、**残枚数はどの三択・どちらの種別を選んでも必ず「処理1件につき-1」で単調減少し、
全件処理すれば必ず「仕分け完了 🎉」(0件)へ収束する**(`tests/v152.test.js`で8件連続処理して
実際に0件へ到達することを検証)。

## 3. 三択の配線(`triageAction`, app.js)。既存関数を再利用し新しい状態語彙は作らない

| 対象 | 今日やる | 手放す | 延期(来月) |
|---|---|---|---|
| Block | `carryOverBlock(id)`(既存そのまま) | 儀式のavoid相当: `deleted:true`+`logMigrationRitual(block,"avoid")` | 儀式のrelease相当: `moveBlockToWish(id)`後に元Blockを`deleted:true`+`logMigrationRitual(block,"release")` |
| Wish | サブタスクがあれば先頭(`nextStepOf`)を、無ければ本体を`wishSubtaskToTasks(id)`でBlock化 | 本体+子孫サブタスクをカスケードで`deleted:true`+`updatedAt`bump | `targetMonth`があれば+1(12月→翌年1月。`targetYear`が設定済みならそれも+1、未設定なら翌年を新規設定)。未設定は据え置き=`updatedAt`のみbump |

### 3-1. Wishの「今日やる」とBlock日付の基準(2系統レビュー必須2)

`wishSubtaskToTasks`(既存、v16由来。Wishタブの個別「📋 今日やる」ボタンとも共有)が
`date: state.selectedDate`でBlockを作っていたため、**過去日を閲覧した直後に仕分けモードで
「今日やる」を押すと、過去日にBlockが作られる**不具合があった(文言は「今日のタスクシュートに
登録しました」なので実時計の今日が正しい)。`carryOverBlock`は`todayISO()`基準で統一済みだった
ため、これに合わせて`wishSubtaskToTasks`も`todayISO()`基準へ修正した(影響範囲: 仕分けモードだけ
でなくWishタブの既存「📋 今日やる」ボタンにも及ぶ正しい修正。既存テストは起動直後
=`selectedDate===todayISO()`の前提で書かれていたため実測値に差分は無く回帰なし)。
`defaultPlannedTimes()`も同様に`state.selectedDate`で予定時刻の日付部分を組み立てていたため、
呼び出し元が明示的な基準日を渡せるよう`defaultPlannedTimes(dateOverride)`へ拡張した(他の3箇所の
既存呼び出し元は引数無しのままで挙動不変)。`tests/v152.test.js` Part Bで、date-prevで3日前へ
移動した直後に「今日やる」を押しても、作られるBlockの日付が実時計の今日になることを検証した。

### 3-2. Blockの「延期」とmigrationRitualLog(2系統レビュー必須3)

設計書§④は「先送りBlockの『手放す/延期』は既存のlogMigrationRitualにも同時記録し、集計源を
分裂させない」と明記していたが、初回実装は「手放す」(`choice:"avoid"`)のみ記録し「延期」の
記録が漏れていた。`logMigrationRitual(block, "release")`を追加した。

Blockの「手放す」は表(§③)が明記する2アクション(`deleted:true`+`logMigrationRitual`)のみとし、
儀式のavoid選択が行うAvoid Listへの追記は行っていない(儀式はモーダルでの明示選択、仕分けは
高速処理が目的のため、表に無いアクションは追加しない判断を維持)。

### 3-3. 12月延期でtargetYear未設定の場合の年繰り上げ(2系統レビュー必須4)

`targetMonth`が12→1へラップする際、`targetYear`が未設定(「いつか」)だとそのままnullに
していたため、月間ボード(`targetMonth`だけで並ぶ)上は「1月枠=先頭」に見え、延期したはずが
**逆行して見える**問題があった。`targetYear`が既存値を持つ場合はそれを+1、未設定の場合は
`Number(todayISO().slice(0, 4)) + 1`(翌年)を新規に設定するよう修正した。

### 3-4. Wishの「手放す」はカスケードsoft-delete(裁定事項・2系統レビュー必須8)

設計書§③表の文言は「本体のみ`deleted:true`+`updatedAt`bump」だが、これだと子孫サブタスクが
孤児(親が消えているのに`deleted:false`のまま)として残ってしまう。既存の`deleteWish()`
(通常のWishタブの削除ボタン)は本体+子孫を再帰的にカスケードsoft-deleteしており、同じ「手放す」
という操作で挙動が違う(仕分けモード経由だけ孤児が残る)のは不整合と判断し、2系統レビューの
裁定により`deleteWish()`と同じカスケード方式に統一した(`window.confirm`は仕分けの高速処理という
目的に合わないため呼ばない。既存`deleteWish()`との差分はconfirmの有無のみ)。

### 3-5. Wishの「今日やる」でサブタスクをBlock化する場合の`updatedAt`

`wishSubtaskToTasks`が更新するのはサブタスク側の`updatedAt`のみで本体は変わらないため、
`triageAction`側で本体(カード)の`updatedAt`も合わせて進める処理を残している(実際の再出現防止の
主因は2.の`_triageSessionDone`だが、データの一貫性としても合わせておく)。

### 3-6. 二重タップガード(2系統レビュー必須6)

`triageAction`の先頭で(a)直前の処理成立から`TRIAGE_ACTION_COOLDOWN_MS`(350ms)未満の呼び出し、
(b)直近の描画で先頭に出したカードid(`_triageCurrentCardId`、毎`renderWishTriage`で更新)と
一致しない呼び出し、のいずれかなら無条件で無視する。連打や、処理直後に同じ画面位置へ再タップして
新しく表示されたカードを誤って処理してしまう事故を防ぐ。`tests/v152.test.js`で、待機無しの
連続クリックが1件しか処理されないことを検証した。

### 3-7. ログのpushタイミング(2系統レビュー必須7)

`logSwipeTriage`の呼び出しを、各アクションが実際に成立する直前(state変更+`saveAndRender`の
直前)へ移した。初回実装は`kind`判定の直後(行動の成否が確定する前)に呼んでいたため、想定外の
早期returnがあった場合に未保存のログエントリがメモリ上に残り、後続の無関係な保存タイミングへ
紛れ込む恐れがあった。

## 4. swipeTriageLogの端末間同期(2系統レビュー必須5、Codex指摘)

`computeSyncMerge`は`migrationRitualLog`等の軽量ログを一切マージしておらず(除外リストに無い
フィールドは同期の対象外)、`swipeTriageLog`も同様だった。汎用ヘルパー
`mergeAppendOnlyLogByKey(localList, remoteList, keyFn)`を新設し、`swipeTriageLogKey = (l) =>
\`${l.at}|${l.targetId}|${l.action}\``の複合キーで重複だけを排除した和集合を返すようにした
(新フィールド追加なし、既存スキーマのまま)。`computeSyncMerge`の`values`/`changedVsLocal`/
`changedVsRemote`、`applySyncMergeToLocal`/`applySyncMergeToRemote`にも配線し、他の同期対象
コレクションと同じ扱いにした。上限は`SWIPE_TRIAGE_LOG_MAX`(200件)のまま、マージ後に
`at`昇順で切り詰める。E2Eテストでは同期経路の検証が難しいため(2端末シミュレーションが必要)、
`node --check`とロジックレビューのみで検証している(自信がない箇所として引き継ぎに明記)。

## 5. UI(`renderWishTriage`, styles.css)

- segmented(☰リスト/🗓月間ボード)に「🃏 仕分け」を追加。
- カード: バッジ(「昨日の先送り ↻N」/「Wish」)+ タイトル + 補足1行(カテゴリ・見積 or 動機・領域)
  + 残枚数「あと N 枚」。
- 三択ボタンは`min-height:48px`(iOS規約の44px以上)。「手放す」は罰なしトーンの規約に従い
  `.btn.ghost`(赤色・危険表現なし)。
- 0件時は「仕分け完了 🎉」を控えめに表示(完了演出の派手さ抑制規約に準拠、きらめき等は使わない)。

## 6. ⑥未解決論点への対応(設計書の仮案を採用)

設計書§⑥-1「Wish本体とサブタスクのどちらをカード単位にするか」はK確認待ちの論点だったが、
設計書自身が明記する仮案(「本体をカードにし、サブタスクがあるものは先頭サブタスクをBlock化」)を
そのまま採用した。他の論点(延期の粒度=来月固定/手放すの復元=Undoトーストのみ)は
taskchute-notes/decisions.mdのK確定事項どおり。

設計書§⑥-3(繰越儀式との連結)についての実装上の帰結を明記する: 仕分けモードの「今日やる」は
Blockに対して`carryOverBlock(id)`を**直接**呼ぶため、3回目以降の繰り越しで通常発火する儀式モーダル
(`requestCarryOver`の`nextCount>=MIGRATION_RITUAL_THRESHOLD`分岐)は経由しない。これは設計書
§⑥-3の仮案(「スワイプの三択自体を儀式の記録として扱いモーダルは出さない」)どおりの意図した挙動
であり、バグではない(スワイプ/ボタンのテンポを儀式モーダルで止めない、という設計判断)。

## 検証

`tests/v152.test.js`を新規追加(全54チェック、Part A:メインフロー46チェック+Part B:過去日基準/
永続除外8チェック)。

- モード出入り(segmentedに「🃏 仕分け」、切替でtriage-panel表示)
- **キュー終端性**: Block/Wish合計8件を順に処理し、残枚数が8→7→6→5→4→3→2→1→0と単調減少して
  必ず「仕分け完了 🎉」へ到達すること(処理1件につき厳密に-1になることまで検証。Block「延期」で
  新規Wishが生成されても即座に加算・相殺されないことも含む)
- **二重タップガード**: 待機無しの連続クリックで2件目が無視され、migratedTo/複製Block/
  swipeTriageLogがいずれも1件だけになること
- Block三択: 今日やる(migratedTo付与+複製Block)/ 手放す(deleted化+migrationRitualLog"avoid")/
  延期(deleted化+Wishへ移動+migrationRitualLog"release")
- Wish三択: 今日やる(サブタスクBlock化、Block日付が実時計の今日)/ 手放す(本体+子孫サブタスクの
  カスケードdeleted化)/ 延期(targetYearあり=+1、targetYearなし=翌年新規設定、targetMonth
  未設定=据え置き)
- **Wish「今日やる」の日付基準**(Part B): date-prevで3日前へ移動した直後に「今日やる」を押しても、
  作られるBlockの日付が実時計の今日になること
- **永続除外**(Part B): `status:"doing"`+当日Block済みのWishが、新規ページ(=空の
  `_triageSessionDone`)でも最初からキューに出ないこと
- swipeTriageLogの記録内容(at/targetId/kind/action/via/carryCount)、行動成功後にのみ記録される
  こと
- 「手放す」ボタンが危険色クラスを持たないこと、`window.confirm`等のブロッキングダイアログが
  出ないこと(`page.on("dialog")`で検知)

`node tests/v152.test.js`単体実行で全PASS(54/54)。既存のWish/carryOverBlock/moveBlockToWish/
carryableBlocks/wishSubtaskToTasks関連スイート(v61/v79/v80/v81/v83/v122/v126、v122とv126は
`wishSubtaskToTasks`の日付基準変更の直接の回帰確認)を`node tests/run-all.js`でまとめて実行し
全PASSを確認(回帰なし)。`npm run test:core`(直近5バージョンv152/v150/v149/v148/v147+
固定横断コア5本v50/v59/v67/v70/v72、計10ファイル)を実行し全PASS(283.1s)。

push前・CIでの全量実行(`npm test`)は別途必要。
