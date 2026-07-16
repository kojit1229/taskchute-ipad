# CHANGES v107

## 概要

K報告(2026-07-15)「タスクシュートでBlockを完了したのにTaskが未完了一覧・WBSに残り、
進捗率も100%にならない」の調査・修正。調査の途中でKから2回の仕様補足・追加指示があり、
最終的な仕様は当初指示から変わっている(詳細は下記「調査で分かったこと」「仕様の経緯」)。

SW `CACHE_NAME` を v106 → v107 に更新。

## 調査で分かったこと(原因の分類)

現物データ(`repos/personal-data/taskchute/app-state.json`、該当タスク・Blockのみ読み取り)で
K報告の実例タスク「W1① ウイスキー: ch1 酒の分類とウイスキーの原料」を確認したところ、
Task.status は `todo`、紐づくBlockも `completed:false` のままだった。つまりK操作時点では
そもそも完了操作自体が(このタスク・Blockに関しては)確定保存されていない状態で、症状(a)(b)(c)は
「未実装のTask完了経路を使おうとして反映されなかった」ケースに近いと考えられる。

コード調査で判明した根本原因は **(a) 未実装**: Task本体を `status: "completed"` にする経路は
アプリ内に複数あり(WBSインライン編集・WBSチェックボックス(toggleTask)・Task編集モーダル
(saveTaskFromModal)・AI作業実績承認(approveAiWorkResult))、このうち **WBSインライン編集と
toggleTaskの2経路だけがv95の進捗連動(fillProgressOnComplete、分子=分母を揃える)にフックされて
おり、Task編集モーダルとAI作業実績承認の2経路はv95新設時(v95-3、5589ae9)にこのフックを
組み込み忘れていた**。WBS完了表示・未完了タスク一覧からの除外自体は `task.status` だけで
判定するため実は経路によらず機能していたが、進捗率(分子/分母)だけがズレて100%にならない
状態になり得た。(b)破損/(c)デグレではなく、当初から一部経路が未実装だった。

なお「Block完了(タスクシュート画面のチェック)がTaskの完了に反映されない」という当初の問題
理解自体は、K補足(下記)により**そもそも仕様として正しい動作**だったと判明した(1Taskに複数
Blockが紐づき得るため、Block完了はTask本体の完了を意味しない)。

## 仕様の経緯(当初指示からの訂正・追加、いずれもK・監督者から作業中に受領)

1. 当初指示: 「Blockが完了したらTaskを完了statusにする」だったが撤回。Block完了(作業枠の完了)
   とTask完了(タスク本体の完了)は別概念で、自動連動は実装しないことが確定。
2. 追加指示: タスクシュートのBlock行に、Block完了チェック(✓)とは別に「タスク完了」チェック
   (🏁)を新設。ONで対象Task本体を完了(v95連動込み)+そのBlock自身のみ完了化。他Blockには
   触れない(監督者推奨の仕様を採用)。OFFはTaskの完了のみ解除。
3. 追加指示: 未完了タスク一覧の仕様変更。期日未設定Taskを表示対象から除外(v97の「常に表示」を
   廃止)、期日昇順(超過が最上位)でソート。

## 変更内容

### app.js

- `saveTaskFromModal()`: 新規作成・更新の両分岐で、ステータスが `completed` になった瞬間に
  `fillProgressOnComplete()` で分子を分母へ揃える(WBSインライン編集と同じ方針)。
- `approveAiWorkResult()`: AI作業実績承認でTaskをcompleted化する際も同様に進捗を連動。
- `toggleTaskCompleteFromBlock(blockId)`(新設): タスクシュートBlock行の「タスク完了」チェック
  のハンドラ。ON=Task完了(v95連動)+当該Blockのみcompleted化。OFF=Taskの完了解除のみ
  (toggleTaskの完了解除と同じhasProgress判定でdoing/todoを決定)、Block側は解除しない。
- `renderBlockItem()`: Block完了チェックとタスク完了チェックを `.block-checks` でラップし、
  block-rowの3列グリッド構成を崩さずに2チェックを縦積み表示。
- `renderOpenTasks()`: 期日未設定Taskを除外するフィルタを追加。期日昇順(同一期日はタイトルの
  ja比較)でソートしてから表示範囲(当日〜7日後+超過/8日後以降の折りたたみ、v97)を適用。
- クリックデリゲーションに `toggle-task-complete` アクションを追加。

### styles.css

- `.task-complete-toggle` / `.task-complete-toggle.done`: 角丸四角+青(既存の丸緑✓・v99の
  四角🤖とは別の形・色・アイコン)。
- `.block-checks`: 2チェックの縦積みラッパー。

### tests

- `tests/v107.test.js`(新規、10シナリオ、2コミットに分割)。
- `tests/v97.test.js`: 「期日未設定Taskが表示される」アサーションを、K指示による仕様変更に
  合わせて「表示されない」へ更新(削除・弱体化ではなく仕様変更への追従)。

## テスト

`node --check app.js` / `node --check sw.js` / `node --check tests/v107.test.js` /
`node --check tests/v97.test.js` すべて exit 0。

`tests/v107.test.js` 全33チェック ALL PASS(修正前の状態(app.jsのみ一時的に巻き戻し)で
再現テスト(f)が失敗することを確認済み)。`tests/v97.test.js` / `tests/v95.test.js` /
`tests/v65.test.js` 個別実行 ALL PASS(既存経路への回帰なし)。

`npm run test:core`(直近5本=v103〜v107 + 固定コア5本=v50/v59/v67/v70/v72、計10本)ALL PASS。

## 残る懸念・未対応

- 実例タスク「W1①」は本対応では自動修復しない。Kがv107配信後にWBSでチェックする(または
  タスクシュートで新設の🏁「タスク完了」チェックを押す)と分子=分母・WBS完了・未完了一覧からの
  除外が反映される。
- `tests/v97.test.js` は本対応時点の実行で、既存の(無関係な)日付ハードコード起因の不具合が
  露見した(`TODAY = "2026-07-15"` が実行時点の実日付より過去になると、アプリの日跨ぎ復帰処理
  ―`runDailyOpen`―が `state.selectedDate` を実日付へ強制的に戻し、v97のウィンドウ計算がずれて
  「8日後Taskは表示されない」「トグルボタンが1個存在する」の2アサーションが失敗する)。
  HEAD(v106、本対応の変更を一切含まない状態)でも同じ2件が同条件で失敗することを確認済みで、
  **本対応が原因ではない、日付ハードコードに起因する既存のテスト脆弱性**。`npm run test:core` の
  対象(直近5本+固定コア5本)には `v97.test.js` が含まれないため今回のゲートには影響しないが、
  `npm test`(全量)を実行するタイミングによっては上記2件が失敗し得る。対応要否・方針(相対日付化
  等)はKの判断を仰ぐ別対応とする。
- AI作業実績承認(`approveAiWorkResult`)の進捗連動修正は、既存の`npm run test:core`スイート
  (v67.test.js、承認フロー自体は検証済み)では進捗連動までは明示的にアサーションしていない。
  ネットワークモック込みの専用E2E追加は本対応のスコープでは見送った(1行の対称性修正で
  リスクは低いと判断)。
- `repos/taskchute-notes/review.md` の2026-07-14全体レビュー(未対応 `- [ ]` 多数、200行超過
  コミットのCIゲート化を含む)は本対応のスコープ外のため着手していない。
