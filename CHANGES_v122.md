# v122 今週のやりたいことをスケジュールに載せる

## 目的

v121で選んだ「今週のやりたいこと」を、タスクシュートのスケジュールに実際に載せられる
ようにする(朝の一括プランニング候補への合流 + ホームカードからのワンタップ登録)。

## 変更点

- `aiScheduleCandidates(date)`: 対象dateの週の `state.weeklyWishes[weekRange(date).weekStart]`
  の `taskIds` のうち、未削除・未実現・かつその日にまだBlock化されていないWishタスクを
  候補として合流する。候補オブジェクトは既存形式(`{ id, title, taskId, category, note,
  estimateMin }`)に合わせ、`note: "今週のやりたいこと"` を目印として付与する。
  通常のWish除外フィルタ(`wishIds`)は他のWishには従来どおり適用し、今週選定分だけを
  例外にした(除外フィルタ自体は変更していない、別枠での合流)。
- `fallbackMorningPlan` の `rank` 関数を拡張: `MIT=0 → 繰越=1 → 今週のやりたいこと=2 →
  WBS=3`。判定は `note === "今週のやりたいこと"` を見るだけで、新しいid接頭辞は増設していない
  (既存の `carryFromId` フィールド判定・`mit-`接頭辞判定と同じ「候補オブジェクトの持つ
  値をそのまま見る」方式に揃えた)。
  `aiScheduleCandidates` は `runAiSchedule`(タイムラインの決定論配置)と
  `aiMorningPlanCandidates`(朝の一括プランニング、`runAiMorningPlan`/`autoMorningPlan`から
  呼ばれる)の両方から使われる共通関数のため、この2経路とも同じ優先順・除外条件で
  「今週のやりたいこと」が候補に入る。
- `homeWeeklyWishCard()`: 各Wish行に「今日へ」ボタンを追加。押すと既存の
  `wishSubtaskToTasks(taskId)` をそのまま再利用して今日のBlockを作成する(新規関数は
  作らず `data-action="wish-subtask-to-tasks"` の既存デリゲーションに乗せた)。
  このカードは「今日を表示中」の時だけ描画されるため(既存の`date !== todayISO()`ガード)、
  `wishSubtaskToTasks`内部の`state.selectedDate`は常に今日と一致する。
  対象日に既にBlock化済みのWishはボタンの代わりに控えめな「済」表示にし、二重登録の
  導線自体を出さない(押しても既存関数側のトーストガードで弾かれる作りと二重に守っている)。
- Service Workerキャッシュを v122 へ更新する。

## 設計判断

- rank判定を「id接頭辞の新設」ではなく「note文字列の完全一致」にした。理由: 既存の
  `mit-`接頭辞はcandidate.idの生成時に唯一使われている識別子だが、今回追加する
  「今週のやりたいこと」候補はWBS候補と同じく`id: t.id`(タスクの実IDそのもの)を
  使う必要がある(spec準拠・ダウンストリームの`taskId`との整合)ため、id空間を
  汚さずに区別できる`note`フィールド(候補オブジェクトが元々持つ表示用の目印)を
  判定に転用した。WBS候補のnoteは`期限 YYYY-MM-DD`または空文字のため衝突しない。
- ホームカードの「今日へ」は新規関数を作らず`wishSubtaskToTasks`を再利用した。
  Wishタブの既存ボタンと完全に同じ挙動(expectedCharge:4、status doing化、二重登録
  ガード)になり、動線が2つあっても実装・テストの重複を避けられる。

## 検証手順

1. `node --check app.js` / `node --check sw.js`
2. `node tests/run-all.js v121 v122`
3. `node tests/run-all.js v59 v60 v77`(朝の一括プランニング関連の既存回帰)
4. ブラウザで: ホームの「今週のやりたいこと」カードから「今日へ」→タイムラインに反映、
   朝プランで「今週のやりたいこと」がWBS候補より先に配置される、を目視確認。
