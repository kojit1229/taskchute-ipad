# CHANGES v86

## 概要

K指示(2026-07-13、原文の趣旨):
1. 「フィードバックの内容をタスクシュートの未完了タスク、0秒思考のテーマ一覧に自動的に追加してください」
2. 「0秒思考に登録されたテーマで不要なものを削除するようにしてください」

v75で作った「AIフィードバックの提案から選んで追加する」UIを、確認なしで確定登録する自動取り込みへ
方針転換した。あわせて0秒思考テーマ一覧にワンタップ削除を追加し、自動追加で失われがちな
「否定シグナル」を削除という行為で回収して学習ループ(zeroSecThemeLog)へ戻す設計にした。

## [A] AIフィードバックの自動取り込み(方針転換: 選定 → 自動登録)

### 設計

新規関数 `autoIngestFeedback(date, text)`(app.js)を `hydrateStaticMarkdown()` の中で、
当日/前日いずれかの新着フィードバック本文(`todayFb`/`prevFb`)が取得できたタイミングで呼ぶ。

- **「## 明日への提案」→ 当日の未完了タスク**: 既存の `extractMITCandidatesFromReport()`
  (v42〜v75で確立済みのMIT候補抽出。頑健化パターンはそのまま)を流用し、各候補を
  `makeTask({ title, dueDate: todayISO() })` で `state.tasks` へ登録する。`projectId` は
  空文字("単発Task")——WBSの `add-task` フォームに元々ある `<option value="">単発Task</option>`
  と同じ、既存の一級パターンをそのまま使っている。ホームの「未完了タスク」パネル
  (`homeBacklog`)は `kind==="wish"` / `kind==="other"` の Project だけを除外表示するため、
  空文字はここに自然に出る(K指示の「dueDateは当日」は Task 特有のフィールド名であり、
  この読みが Task 経路を選んだ根拠でもある)。
- **「## 0秒思考テーマ」→ 0秒思考テーマ一覧**: 既存の `extractZeroSecThemesFromReport()`
  (v77)を流用し、`state.zeroThinking.themes` へ `{ ..., source: "ai-feedback" }` として登録する。
  `source` はテーマの新規フィールド(既定 `null` = 手動/旧経路)で、後述の削除時のAI由来判定に使う。

### 冪等性

`state.feedbackIngestedDates`(新規配列、`aiPlanSkippedLog`/`zeroSecThemeLog`と同じ軽量ログの
思想。上限300件)に、取り込んだフィードバック自身の日付("YYYY-MM-DD"。today/prevどちらの
枠から来たかは問わない)を記録する。`autoIngestFeedback`はこの配列に対象日付が既にあれば
即 `null` を返し何もしない。

冪等ゲートを `hydrateStaticMarkdown`側(fetch判定)ではなく`autoIngestFeedback`側(登録判定)に
置いたのには理由がある——`cachedFeedback`はページ再読込のたびにリセットされる非永続キャッシュ
なので、同じ.mdファイルは複数セッションに跨いで何度も再fetchされうる(v57以降の設計どおり)。
fetch自体は何度起きてもよく、実際にstateへ書き込む段階でだけ1回性を保証すればよいと判断した。

### 重複排除

- タスク: 現在生きている(`!deleted && status in ("todo","doing")`)タスクに同名があれば
  スキップする。dueDateやprojectIdを問わないため、前日以前から残っている繰越タスクとの
  重複も防ぐ。
- テーマ: `zeroThinking.themes`は日付を持たない永続リストなので、既存テキストとの一致判定が
  そのまま「前日から残っているもの」も含めた重複排除になる。

### トースト通知

取り込みで実際に1件以上追加されたときだけ `🤖 AIの提案からタスクN件・テーマM件を追加しました`
を表示する(0件のときは何も表示しない——選定UIが無くなった分、何が起きたかの透明性はここで
担保する)。

### v75選定UIの整理

`runAiMorningPlan()`内でAIフィードバック_*.md由来のzeroSecThemesを取得していた
`fetchZeroSecThemesFromFeedback()`(v77)は削除した。理由:
`autoIngestFeedback`が`hydrateStaticMarkdown`側で既に直接`zeroThinking.themes`へ登録するため、
同じ.mdをここでも独立にfetchして選定カード(追加/見送り)へ合流させると、「もう自動で
追加済みのものを、もう一度選ばせる」二重体験になる。

AIプラン_*.json由来(`fetchZeroSecThemes`)の選定カードはそのまま残した——こちらは自動登録の
対象にしておらず(K指示は「フィードバックの内容」に限定)、引き続き人の判断を挟む設計のため。
念のため、プラン由来の候補が既に`zeroThinking.themes`に入っている(=自動取り込み済みで
重複する)場合はカードから除く一手も足した(二重提示防止)。

## [B] 0秒思考テーマのワンタップ削除 + AI由来削除の学習ループ接続

### UI

`renderZtThemeTab()`のテーマ行に削除ボタン(`.zt-theme-del`、44×44px当たり判定、styles.css)を
追加した。AI由来テーマ(`source==="ai-feedback"`)には「🤖 AI提案」バッジを表示し、由来を
一目で分かるようにした。

### 削除確認

`zeroThinking.themes`にはBlock/Question等と違い `deleted` フラグ(軟削除)が無く、削除は
即座に配列から取り除く(復元不可)。復元できない操作のため軽い`confirm()`を挟んだ
(スキル方針「undo可能ならconfirm省略・無理ならconfirm」に従う)。

### AI由来削除 → zeroSecThemeLogへの記録

`deleteZtTheme(id)`は、削除対象のテーマが`source==="ai-feedback"`のときだけ、
`state.zeroSecThemeLog`へ `{ date: todayISO(), theme, reason: "", outcome: "skipped", at }`
を追記する。`outcome`の値は既存のv75選定UI(`decideZeroSecTheme`の「見送り」)と同じ
`"skipped"`文字列を再利用した(スキーマを増やさず、将来バッチ側が「採否」を見るときに
値の種類を増やさないため)。手動追加テーマ(`source:null`)の削除はAIの提案ではないため
記録しない。

これにより、自動追加(=人の事前承認を経ない)で失われていた「本当は要らなかった」という
否定シグナルを、削除という行為を通じて回収し、v75で作った採否ログ(zeroSecThemeLog)に
再接続した。

## [C] バッチ側(loop/scripts)との整合確認(読み取りのみ、コード変更なし)

`loop/scripts/plan-daily-extract.py` / `weekly-extract.py` を読み、新設の「単発Task」
(`projectId=""`)がWish混入事故(2026-07-11、Wish配下タスクのdueDateが登録日のまま
翌日プランに混入した件)の再発にならないか確認した。

- `plan-daily-extract.py`のWish除外は `t.get("projectId") not in wish_project_ids`
  (`wish_project_ids`はWish種別Projectの実IDのみの集合)で判定しており、`projectId=""`は
  この集合に含まれない実IDなので、Wishとして誤除外/誤混入されることはない
  (正しく「今日のopen task」として扱われる——これは望ましい挙動)。
- `weekly-extract.py`の「WBS棚卸し」(`wbs_stale`)・12週プロジェクト集計もprojectIdをキーに
  Project辞書を引くだけで、未知/空のprojectIdでも`project_titles.get(pid, "")`が空文字を返す
  だけでクラッシュしない。
- `zeroSecThemeLog`/`zeroThinking`はどちらのスクリプトからも参照されておらず、今回の変更
  (テーマ増加・source/skippedログ追加)による影響は無い。

結論: 既存のWish除外ガードは実IDでの集合判定であり、空文字projectIdは元から安全側に
倒れる設計だった。誤動作の懸念なし(コード変更不要)。

## [D] レビューshould-fix対応(2件)

初回実装のレビュー(must-fixゼロ・should-fix2件)を受けて追加修正した。

1. **`hydrateStaticMarkdown`末尾の再描画ゲートに`"zero"`(0秒思考タブ)を追加**。
   autoIngestFeedbackがテーマを自動追加しても、0秒思考タブを開いたまま待っていると
   一覧がライブ更新されなかった(既存の`vision`/`journal`/`weekly`/`home`と同じ並びに追加しただけ)。
2. **autoIngestのtoday枠をrealToday(実際の今日)に限定**。`today = state.selectedDate`は
   セッション中に日付ピッカーで過去日へ移動すると、その値も過去日になる(v76以降の既存仕様)。
   過去日を閲覧中に、その日のフィードバックが未キャッシュだと`todayFb`にその過去日の本文が
   入り得るが、`autoIngestFeedback`内部のタスク生成は`dueDate: todayISO()`(呼び出し時点の
   実今日)固定のため、過去日を見ているだけで過去のフィードバックの提案が実今日のタスクとして
   注入されてしまう不具合があった。`if (todayFb && today === realToday)`で実今日を閲覧中の
   ときだけ取り込むよう制限した(`prev`枠は`addDays(todayISO(), -1)`で`selectedDate`に依らず
   常に実際の昨日固定のため、この制限は不要で現状のまま)。

## テスト

- `tests/v86.test.js`(新規、should-fix対応で1ケース追加): ①新着FBからの自動取り込み
  (タスク+テーマ+トースト) ②冪等性(同日付の二重hydrateで二重登録しない。内容が変わっても
  同日付なら再登録しない) ③重複スキップ(同名タスク・同文テーマ) **③b 過去日を日付ピッカーで
  閲覧中にその日のFB(today枠)が新規fetchされても実今日のタスク/テーマとして注入されない
  (should-fix2の回帰、v57.test.js[1]と同じ日付ピッカー操作の手法)** ④テーマ削除+AI由来の
  不採用記録(手動テーマは記録しない/確認キャンセルで削除されない、も含む) ⑤旧形式FB
  (見出し無し)で何も起きない。
- `tests/v77.test.js`[6]を更新: v75選定UIとの役割分担が変わった(FB由来は選定カードを介さず
  自動登録、AIプランjson由来は引き続き選定カードで扱い自動登録済みの同名テーマは再掲しない)
  ことに合わせて回帰観点を書き換えた。あわせて`seed()`ヘルパーに`feedbackIngestedDates`
  リセットを追加(サブテスト間の冪等マーカー汚染防止)し、test[4]の実行後に`feedbackFixture`を
  明示的にリセットする1行を追加した(自動取り込みの副作用が後続テストの下書き候補に
  紛れ込むのを防ぐため)。
- `sw.js`: `CACHE_NAME`を`v85`→`v86`。
- `npm test`(全量) **ALL PASS** を確認済み。

## 自信がない箇所・懸念点

- MIT候補(「明日への提案」)の登録先を「単発Task(projectId="")」にした判断は、K指示文中の
  「dueDateは当日」という言い回し(Task特有のフィールド名)を根拠にした推測である。もし
  K の意図が実際には既存の「今日の主役(MIT Block、isMIT）」だった場合は、ホームの
  「未完了タスク」パネルではなく「今日の主役」パネルに出したい可能性がある——現物のUIで
  一度確認してもらうのが安全。
- 単発Task(projectId="")はWBSタブの `renderProjectTree` がProjectごとにタスクをグルーピング
  する都合上、WBS一覧には出ない(元々`taskProject`セレクトに「単発Task」という選択肢がある
  以上、この挙動自体は本機能が持ち込んだものではなく既存の仕様)。ホームの「未完了タスク」
  パネルには出るので実用上は問題ないはずだが、K自身がWBSタブでも見えることを期待していた
  場合はギャップになる。
- v75で作った旧選定UI(`aiFeedbackCandidatesHTML`のMIT候補ボタン、`journalMeta.aiMitCandidates`
  経由の`aiMitChips`/`buildAiImportModal`)は今回あえて手を付けていない。同じ「明日への提案」
  テキストを別経路でも表示し続けるため、自動登録済みの項目が「＋主役に」ボタンとしても
  重複して見える可能性がある(実害は「もう登録済みのタスクと似た名前のMIT Blockを追加で作れる」
  程度で、データ破損や事故には繋がらない)。今回のK指示の範囲外と判断し、スコープを広げなかった。
  気になるようなら別タスクとして整理したい。
