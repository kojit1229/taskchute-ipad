# v146 UI改善計画 Phase1(毎日の摩擦を消す)

入力: `workbench/out/2026-07-27-taskchute-ui-review/ui-improvement-plan.md`(承認済み計画。
claude-ux-review.md + codex-ui-review.mdの2系統レビューの統合)。K承認事項: Phase1〜3を連続
実装・push、ホーム画面は適宜2列グリッド分割OK(縦の長さ短縮のため。タップターゲットは維持)。
本コミット群はそのうち **Phase1(6項目)** の実装。

## 1-1. ホーム並び替え + 折りたたみ既定値

`renderHome()`(app.js)のカード順序を行動優先へ入替:

```
同期警告 / 日付バー
→ いま、これ(hero)
→ 今日の主役(MIT, #home-mit-anchor)
→ 今日、すすめる(タスクシュート, homezone-1)
→ 今日のリズム(zone2、既定 open に変更 ← 旧: closed)
→ 状態チップ類(理想/宣言/体力予算/バッテリー残量/週Wish/読書/ルーティン確認バナー)
→ 参照系(既定 closed。信条(creed)・寿命(lifespan)は既定を open→closed に変更。
   AIから(ai-hub)は常時表示のセクションから既定closedの折りたたみへ新規に変更。
   スコアボードは既存どおりclosed)
→ 長い弧(zone3)/ 今日の足あと(zone4、既存どおりclosed)
```

- `homeFoldSection("creed", true, ...)` → `false`、`("lifespan", true, ...)` → `false`
- `isHomeFoldOpen("zone2", false)`(非縮退時のみ) → `isHomeFoldOpen("zone2", true)`
  (縮退時の `zone2-degraded` は既定closedのまま無変更。縮退モードの「最低限だけ」思想を優先)
- 「AIから」は従来 `homeAiHub()` で `<section>` 常時表示していたが、`homeFoldSection("ai-hub", false, ...)`
  へ変更(縮退モードの`ai-hub-degraded`と対称の構造にした)。外側`<section>`で包むだけだった
  `homeAiHub()`関数は両呼び出し元が無くなったため削除(`homeAiHubBody()`は無変更で存続)
- K承認の「小さいチップの2列グリッド化」を、体力予算チップ+バッテリー残量チップの2つに適用
  (`.home-chip-2col`、CSS grid 2列。360px以下は1列にフォールバック。どちらもタップ対象を
  持たない受け身の表示チップなのでタップターゲットへの影響なし)

## 1-2. ホーム・タスクシュートの自動スクロール

タイムラインの既存実装(`.now-line`への`scrollIntoView`)と同じ考え方で、レンダー後に
「着手中(無ければ次の未着手)Block」へ自動スクロールする。

- `currentOrNextBlockId(dateISO)`(新規、app.js): `homeHero`/`nowConveyorTarget`と同じ抽出ロジック
  (現在時刻に該当する未完了Block、無ければ次の未着手)をBlock id専用に切り出した
- `isTypingInInput()`(新規): `document.activeElement`がINPUT/TEXTAREAなら true。検索入力等に
  フォーカス中は自動スクロールを発火させないためのガード
- ホーム表示時: `.home-hero`(=「いま、これ」自体がその日の対象Blockを表示するセクション)へ
  `scrollIntoView({block:"start"})`
- タスクシュート表示時: `currentOrNextBlockId`で求めたidの行(`strong[data-action="edit-block"][data-id]`)
  へ `scrollIntoView({block:"center"})`
- どちらも `state.selectedDate === todayISO()` かつ `!isTypingInInput()` のときだけ発火

## 1-3. 誤タップ対策(🏁の移設 + 44px当たり判定)

- タスクシュート行(`renderBlockItem`)から🏁(タスク完了、`data-action="toggle-task-complete"`)を
  撤去し、Block編集モーダル(`buildBlockModal`)内へ移設。挙動(`toggleTaskCompleteFromBlock`)自体は
  無変更。モーダルは通常の`render()`では再描画されない(`modalRoot`は別ルート)ため、モーダルを
  開いたままこのボタンを押した場合に限り`renderModal(buildBlockModal(...))`で明示的に再描画し、
  ボタンのラベル/色(completed↔紐づくTaskも完了にする、green↔orange)を反映する
- `.checkbox-button`(✓、タスクシュート/WBS/ルーティン共通)・`.tl-start-btn`(タイムライン▶/■)・
  `.modal-close`(モーダル閉じる✕)に、既存の`.home-box`/`.home-dot`と同じ「見た目は据え置き、
  `::before`/`::after`で当たり判定だけ44px相当に拡張」パターンを適用
  (それぞれ inset -7px/-11px/-6px。`.tl-complete-btn`は既にv81で対応済みだったため無変更)

## 1-4. バッファ残量帯の画面限定

`bufferMeterHTML()`が「今日を扱う」画面(`home`/`tasks`/`timeline`/`journal`/`reports`)以外では
空文字を返すようにした(`BUFFER_METER_VIEWS`)。設定・計器盤・その他・やりたい等の無関係画面から
常時26px帯(未設定時は「設定してください」帯)が消える。

## 1-5. ジャーナルの当日優先表示

- 720px以下(`@media (max-width:720px)`)で、`.journal-panel-today`(当日編集)に`order:1`、
  `.journal-panel-prev`(前日)に`order:2`を指定(CSSのみ。デスクトップの左右比較レイアウトは無変更)
- 前日パネルを`<div class="panel">`から`<details class="panel journal-panel-prev">`へ変更し、
  既定closedにした(summaryに「📓 前日 (日付)」を表示。当日編集パネルは`<div class="panel journal-panel-today">`のまま)

## 1-6. 設定画面の表示整理

- パネル見出しから内部バージョン表記を削除: 「⏳ 1日バッファ(v116)」→「⏳ 1日バッファ」、
  「🔋 エネルギーバッテリー(v144)」→「🔋 エネルギーバッテリー」、「実行(v70)」→「実行」、
  「🔒 ガイド付きアクセス案内(v111)」→「🔒 ガイド付きアクセス案内」、
  「🎥 Study With Me(v84)」→「🎥 Study With Me」。あわせて回復下書きのチェックボックス文言
  「(v145、既定OFF)」→「(既定OFF)」(見出しではないが同種の内部表記のため)。
  ※本文中の技術的な移行経緯の説明(例:「Contents API 経由で保存します(v72。...)」)は
  ユーザーの理解に資する文脈情報のため対象外(過剰削除しない)
- 「現在のファイル構成」パネルを`<div class="panel">`から`<details class="panel">`へ変更し、
  既定closedにした
- `draftBarHTML()`のsourceLabel分岐に`_scheduleDraft.source === "battery-recovery"`を追加し、
  「🔋 回復候補」と表示するようにした(旧: `ai-plan`以外は一律「⚙ 決定論配置」で、v145の
  回復下書きも出どころ不明な表示になっていた)

## 規約遵守

- `new Date("文字列")`は使っていない(現在時刻の取得は既存パターンの`new Date()`数値取得のみ)
- input/select/textareaの新規16px未満は追加していない
- `data-action`デリゲーション方式を維持(個別addEventListenerを増やしていない)
- sw.js: `CACHE_NAME`を v145→v146
- 機能の削除はしていない(信条・寿命・AIから・スコアボード等はいずれも「閉じる」だけで残存)

## 既存テストへの追随修正(仕様変更に伴う正当な更新。弱体化ではない)

- `tests/v71.test.js`: creed/lifespanの既定open期待→closedへ反転。AIからが既定closedの
  折りたたみになったため、候補ボタン操作前に開くステップを追加
- `tests/v82.test.js`: zone2の既定closed期待→openへ反転(トグル検証も開→閉の順に反転)。
  creed/lifespanの既定open期待→closedへ反転。AIからの「常時表示section」期待→
  「既定closedのdetails」期待へ変更。ジャンプ自動オープンの検証はzone2を明示的に一度閉じてから行う形へ変更
- `tests/v107.test.js`: 🏁がBlock編集モーダルへ移設されたことに伴い、行内クリックからモーダルを
  開いてクリックする手順へ変更。視覚区別の検証・390px幅検証も配置変更に追随
- `tests/v67.test.js`(コアセット): 「AIから」が既定closedになったことで、AI作業結果の
  承認/質問ボタンを操作する前に開くステップを追加(該当箇所のみ)

## テスト

`tests/v146.test.js`(新規)で6項目を直接検証:
1. ホーム折りたたみ既定値(creed/lifespan/ai-hub=closed、zone2=open、zone3/zone4/scoreboard=既存どおりclosed)
2. ホームの並び順(hero→MIT→zone1→zone2→参照系(creed/lifespan/ai-hub/scoreboard)→zone3→zone4、
   `#main`のinnerHTMLにおけるマーカー文字列のindexOf比較で検証)
3. ホームの自動スクロール(`scrollIntoView`をspyして`.home-hero`への呼び出しを確認)+
   検索入力フォーカス中は発火しないこと(プログラム的`.click()`でフォーカスを保持したまま再描画)
4. タスクシュートの自動スクロール(対象Block行への`scrollIntoView`呼び出しを確認)
5. 🏁が行に無くモーダルにあることの配置確認(状態遷移の詳細はv107.test.jsが担当)
6. `.checkbox-button`/`.tl-start-btn`/`.modal-close`の`::before`/`::after`insetが意図した値であることを`getComputedStyle(el, pseudo)`で確認
7. バッファ残量帯がhome/tasks/timeline/journal/reportsでのみ出て、settings/stats/moreでは出ないこと
8. ジャーナルの720px以下でのCSS order + 前日パネルのdetails既定closed
9. 設定パネル見出しにvNNNが無いこと + 「現在のファイル構成」のdetails既定closed
10. バッテリー回復下書き(source:"battery-recovery")のラベルが「🔋 回復候補」になること
   (`recoveryDraft`ON+実績データで実際に下書きを発火させて検証)

**実行結果(初回実装時点)**:
- `node tests/v146.test.js`単体: 全項目PASS
- `node tests/v71.test.js` / `v82.test.js` / `v107.test.js` / `v75.test.js`: 追随修正後、全項目PASS
- `npm run test:core`(v67修正含む): ALL PASS(263.3s)

## レビュー対応(2026-07-27、Claude+Codex 2系統レビュー、FAIL判定への修正)

1. **tests/v73.test.js:230の実落ち**: 「AIから」section→details化への追随がgrep代替検証止まりで
   実際のセレクタ更新が漏れていた。`section.home-ai-hub` → `details[data-fold-id="ai-hub"].home-ai-hub`
   (縮退用ではない通常side)へ修正
2. **自動スクロールの発火条件**: 毎render発火(実測でホーム1440px/タスクシュート1310pxの巻き戻り)
   を修正。`_lastScrollView`/`_lastScrollDate`をモジュール変数に保持し、**ビュー切替・日付切替・
   初回描画のときだけ**発火するようにした(同一view+dateの再描画では発火しない)。
   (a) フォーカスガードを`main.innerHTML`差し替えの**前**に評価する位置へ移動
   (b) 自作`isTypingInInput`を廃止し既存`isFocusInEditableElement()`(app.js)を使用
   (c) タスクシュートのスクロール対象は`tasksViewRenderedBlocks()`(renderTasks()と全く同じ絞り込み:
   timeline由来/ルーティン/recurrenceGroupId/taskId無し/Project未紐づけを除外)を通してから選ぶ
   ように変更(`currentOrNextTaskchuteBlockId`)。テストに「wbs→home」「tasks→home(フォーカス中)」
   「同一view内トグル操作」「wbs→tasksで renderTasks() 非描画Blockが選ばれないこと」を追加
3. **バッファ帯の未設定時非表示**: `bufferMeterHTML()`が`!info.hasBuffer`のとき`""`を返すよう変更
   (計画1-4の明記事項どおり)。設定への導線は設定画面内の「⏳ 1日バッファ」パネルの説明文で維持。
   `tests/v116.test.js`の該当ケース(dailyBufferMin<=0)を「未設定表示になる」→「帯自体が出ない」
   に追随修正。`tests/v146.test.js`にも未設定ケースを追加
4. **タイムライン▶の44px化の副作用**: 短時間Blockが物理的に隣接するため、縦方向まで-11pxで
   広げると隣接Blockの当たり判定を奪っていた(実測)。`.tl-start-btn::after`のinsetを
   `-3px -11px`(縦-3px/横-11px)に変更し、横方向の44px相当は維持したまま縦方向の越境を最小化。
   カードの重なり自体の解消はPhase4の対象
5. **🏁押下時に未保存編集が消える**: `renderModal(buildBlockModal(updated))`直呼びをやめ、
   既存`rerenderActiveModal()`(値の退避・復元パターン)を使うよう変更。第1引数で追加の除外
   フィールドを渡せるよう汎用化し(既定の"category"除外はそのまま)、`completed`を除外指定
   (`rerenderActiveModal(["completed"])`)して、🏁自体が変えた値は古いキャッシュへ巻き戻らない
   ようにした。「タイトル書きかけ→🏁→書きかけ保持+🏁の効果自体は反映」のテストを追加
6. 死にCSS `.task-complete-toggle` / `.task-complete-toggle.done`(app.js側は既に`.task-complete-toggle-btn`
   に置換済みで未参照だった)を削除
7. 新設2つの`<summary>`(ジャーナル前日パネル・設定「現在のファイル構成」)を既存foldパターン
   (`.home-fold` + `.home-fold-summary`(`::-webkit-details-marker`非表示込み)+ `.home-fold-chevron`
   + `.home-fold-body`)に統一。`.home-fold`の`margin-top:12px`がgrid(journal-grid/settings-grid)の
   `gap`と二重に空かないよう、既存の`.home-zone-block .home-fold`と同じ手法で0へ戻すルールを追加
8. `.home-chip-2col`を固定`1fr 1fr`から`repeat(auto-fit, minmax(140px, 1fr))`へ変更。子が1個
   (過去日でバッテリー残量チップが空になるケース)なら1列いっぱいに広がり、2個あるときだけ
   2列に分かれる(狭い幅では自然に1列へ畳まれるため個別`@media`指定も不要になった)
9. `tests/v107.test.js`に「390px幅でBlock編集モーダルを開くと🏁ボタンが可視状態である」を追加
10. 本節を追記(このセクション自体が対応)

## 検証(レビュー対応後、最終)

- `node tests/run-all.js v146 v73 v67 v71 v82 v107`(フォアグラウンド、timeout 600000明示): **✅ All suites passed**
- `npm run test:core`(フォアグラウンド、timeout 600000明示): **✅ All suites passed**(356.5s)
- 追加の目視回帰(`v116`/`v75`/`v83`。バッファ帯・AIから折りたたみ・チェックの丸形状/44px当たり判定に
  関連するため個別に再実行): `node tests/run-all.js v116 v75 v83` **ALL PASS**
- `npm test`(全量)は監督者側でpush前に実行するため本ラウンドでは未実行(指示どおり)

## 追加修正(2026-07-27、監督者側の全量npm test実行で発覚した追随漏れ2本目)

`tests/v112.test.js` [3]「タスクを完了にすると一覧から消える」が、行内の`[data-action="toggle-task-complete"]`
を直接クリックしようとして失敗していた(v107.test.jsと同じ、🏁のBlock編集モーダル移設への
追随漏れ)。`grep -r "toggle-task-complete" tests/`で全テストファイルを洗い出し、参照していたのは
`v107.test.js`(対応済み)・`v146.test.js`(新規時点から対応済み)・`v112.test.js`(未対応)の3本のみと
確認。`v112.test.js`をv107と同じパターン(edit-blockでモーダルを開く→モーダル内の
toggle-task-completeをクリック→modal-close)へ追随修正した。既存assert(Taskがcompletedになる/
一覧から消える等)は削除・緩和していない。

検証: `node tests/v112.test.js`単体PASS。`node tests/run-all.js v112 v107 v146` ALL PASS。
