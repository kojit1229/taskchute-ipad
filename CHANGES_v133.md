# v133 独立した2つの小修正(K承認済み、2026-07-21)

## 修正1: AI提案タスクの自動登録を廃止し、追加ボタン式(候補+ワンタップ採用)に戻す

- 背景: v86で `autoIngestFeedback(date, text)` は、AIコーチングフィードバックの
  「明日への提案」から抽出したタスク候補を確認なしで直接 `state.tasks` へ push していた。
  K指示によりこれを撤回し、既存の `aiMitChips`/`adoptAiMit`(journalMeta[date].aiMitCandidates)
  と全く同じ設計思想(候補を溜めておき、チップの「＋」タップで初めて実体化)に変更した。
  0秒思考テーマ側の自動追加は変更していない(スコープはタスクのみ)。
- 実装:
  - `journalMeta` の各要素に `aiTaskCandidates: []` を追加(normalizeState、および
    `journalMeta[d] ||= {...}` の3箇所の初期値)。
  - `autoIngestFeedback` のタスク候補ループを `state.tasks.push` から
    `journalMeta[date].aiTaskCandidates.push` へ変更。重複排除は「現在生きているtodo/doing
    タスクのtitle」に加え「既にaiTaskCandidatesに入っているtitle」も対象にした(日をまたいだ
    重複チップ防止)。`addedTasks` の意味は「候補として追加した件数」に変わった。
  - `aiTaskChips()`(aiMitChipsと同じ表示条件: 今日を見ているときだけ、journalMeta[前日]の
    候補を表示)を新設。各候補に「＋」(採用、data-action="ai-task-adopt")と「×」(却下、
    data-action="ai-task-dismiss"。aiMitChipsには無い機能で、候補が溜まり続けないよう追加)。
  - `adoptAiTaskCandidate(index)` / `dismissAiTaskCandidate(index)` を新設。adoptは
    `makeTask({title, dueDate: todayISO()})` を作成し候補から除去、dismissは候補から除去のみ。
  - `handleAction` に `ai-task-adopt`/`ai-task-dismiss` の分岐を追加。
  - `renderTasks()` の `${aiMitChips()}` の直後に `${aiTaskChips()}` を追加。
  - `hydrateStaticMarkdown()` のトースト文言を「🤖 AIの提案でタスク候補N件が届きました
    (タスクシュート上部から追加できます)」+テーマ分の文言へ変更。
  - **追加で発見・修正したバグ**: `hydrateStaticMarkdown` 末尾の「新着があれば再描画する」
    分岐が `vision/journal/weekly/home/zero` タブのみを対象にしており、`tasks`(タスクシュート)
    タブが含まれていなかった。修正1導入前は影響がなかったが、タスク候補チップが `tasks` タブに
    表示されるようになったことで、タスクシュートを開いたまま新着FBを待っていてもチップが
    ライブ表示されない不具合が新たに生じた(tests/v133.test.jsで検出)。`tasks` を対象に追加。

## 修正2: Wishプロジェクト配下タスクの期日を常にNULLにする(スコープを一部縮小・要確認)

- 背景: `makeTask()` はv127で「Wish Project配下のTaskは今日の既定期日を付けない」対応済み
  だったが、呼び出し元が明示的に `dueDate` を渡した場合はそれを尊重してしまう抜け道が残って
  いた(`dueDate || (isWishProject ? "" : ...)` は渡された値が真なら素通り)。
- **実装したもの(依頼書の(a)のみ)**: `makeTask()` を `dueDate: isWishProject ? "" : (dueDate
  || state.selectedDate)` に変更し、Wish配下では明示的な引数も無視して常に空にした。
- **実装を保留したもの(依頼書の(b)(c))**: 以下の理由により、タスク編集モーダルの期日入力の
  無効化(b)と、既存データを無条件で空に上書きするnormalizeStateクレンジング(c)は実装して
  いない。コード調査の結果、Wishプロジェクト配下タスクのdueDateには **v79で導入された
  「期限(任意。週次レビューで参照)」という別の意図的な機能**が既に存在する
  (`data-action="wish-set-duedate"`、app.js:5103/1006、Wishタブの詳細編集パネル)。さらに
  **v126では「期日付きWishは通常タスクと同列に扱う」設計**まで組まれている
  (`aiScheduleCandidates`/`homeBacklog`/`renderOpenTasks` がいずれも「期日を持つWishだけを
  候補・一覧に含める」形でこの機能に依存、app.js:3676, 3369-3370, 5754-5756)。
  依頼書の(b)(c)を文字通り実装すると、この既存の意図的な機能を破壊し、週次レビュー・AI朝
  プラン候補・ホーム未完了タスク一覧からWishが一切出なくなる回帰になる。このコンフリクトは
  依頼書の文面(「抜け道」という表現)からは意図的な機能として認識されていないように見え、
  勝手な判断で既存機能を壊すのは危険と考え、(a)のみ実装して(b)(c)はK確認待ちとした。
  K確認後の対応案:
  1. wish-set-duedateはそのまま残し、(b)(c)は撤回する(依頼の意図は「意図しない当日既定
     期日の混入を防ぐ」ことだけだった、という解釈)。
  2. wish-set-duedate・v126の関連ロジックごと撤去した上で(b)(c)を実装する(「Wishには
     dueDateという概念自体を無くす」という意図だった、という解釈。この場合は週次レビュー
     ・AI朝プラン・ホーム未完了リストのWish関連ロジックの見直しが別途必要)。

## テスト

- 新規 `tests/v133.test.js`: (1)(2)(3) 修正1のチップ表示・採用・却下フロー、
  (4)(5) 修正2(makeTaskの明示dueDate上書き、Wish以外は無変更の回帰)、
  (6) normalizeStateの`aiTaskCandidates`後方互換補完。ALL PASS。
- 既存スイートの更新: `tests/v86.test.js`(autoIngestFeedbackのタスク挙動アサーションを
  候補チップ前提に更新)、`tests/v77.test.js`(同様に1箇所更新)。両方ALL PASS。
- 関連回帰: `tests/run-all.js v75 v76 v77 v79 v86 v98 v106 v117 v121 v122 v126 v127 v58 v133`
  ALL PASS。`npm run test:core` ALL PASS(183.4s)。
- `node --check app.js` / `node --check sw.js` OK。

## その他

- `sw.js` の `CACHE_NAME` を `v132` → `v133` に更新。
