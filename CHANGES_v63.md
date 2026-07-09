# CHANGES v63

## 概要

ROADMAP(`../taskchute-notes/ROADMAP.md`)v63(週次レビューの「絞り込み」を数字で支援する)を実装した。
`workbench/out/2026-07-09-tcj-roadmap/book-inspired-features.md` の提案2(WIP上限アラート)・
提案6(戦略/雑用/休息ゲージ)の2つを、既存のWBS/カテゴリ管理/週次レビュー基盤への軽量な属性追加
+ 集計ロジックの再利用で実装した。アプリ内Claude API呼び出しは追加していない(v60方針を維持)。

- **WIP上限アラート(提案2)** — ProjectにHigh/中/Lowの優先度フィールドを追加。アクティブ
  (`status:"active"`・`kind:"normal"`)なProjectが4件以上になると、WBSタブ上部に控えめな
  バナーを表示し、各Projectをワンタップで保留(中断)できる導線を出す。
  「Kの原則は3件まで」(限りある時間の使い方)を裏付ける仕組みで、実行率を裁く色ではなく
  情報を渡すだけのアクセントトーン(青系)にした。
- **戦略/雑用/休息の3バケット配分ゲージ(提案6)** — カテゴリ管理に「バケット」属性
  (戦略/雑用/休息/未分類)を追加。週次レビュータブに、選択中の週(既存の週送りナビに連動)の
  完了Blockを3バケット+未分類で集計した横棒ゲージを表示する。時間と%を併記し、目標値は
  一切設定しない(「まず現実を見る道具」に徹する方針どおり)。

## 変更内容(app.js)

### 1. WIP上限アラート(提案2)

- **`normalizeState`**: `value.projects = value.projects.map((p) => ({ priority: "中", ...p }))`
  を追加。既存Projectは「中」で後方互換補完する。wish/other の自動生成Projectも、この map が
  自動生成のpush処理より後(`migrateRecurrencesIfNeeded` の直後)に実行されるため一緒に拾われる。
- **`addProject()`**: 新規Project作成時に `priority: "中"` を明示的に設定(normalizeStateは
  リロード/インポート時のみ走るため、作成直後の1件が優先度未設定のまま表示されないようにした)。
- **`buildProjectModal()` / `saveProjectFromModal()`**: Project編集モーダルに「優先度」
  (高/中/低のselect)を追加。保存時は `fields.priority || p.priority || "中"` で反映する。
- **`renderWipBanner()`**(新規): `state.projects` のうち `!deleted && kind==="normal" &&
  (status||"active")==="active"` を数え、4件未満なら空文字(非表示)、4件以上なら
  「進行中プロジェクトがN件。Kの原則は3件まで——1つ潜らせますか?」のバナーを返す。
  各Projectの行に「保留」ボタン(既存の `data-action="suspend-project"` をそのまま再利用。
  `suspendProject()` は `status:"paused"` にする既存の中断機構と同一)を並べる。
  `renderWBS()` のヘッダー直下に挿入した。

### 2. 戦略/雑用/休息の3バケット配分ゲージ(提案6)

- **`normalizeState`**: `value.settings.categories = (value.settings.categories ||
  []).map((c) => ({ bucket: "", ...c }))` を追加。既存カテゴリは空文字("未分類"扱い)で
  後方互換補完する。
- **`renderCategoriesSettings()`**: カテゴリ管理の各行に「バケット」select
  (戦略/雑用/休息/未分類)を追加。既存の `data-cat-id`/`data-cat-field` イベント委譲
  (`updateCategoryField`)にそのまま乗るため、専用ハンドラは不要だった。
- **`bucketLabel(bucket)`**(新規): `"strategy"→"戦略"` 等の表示ラベル変換。
- **`getCategoryBucket(name)`**(新規): カテゴリ名からバケットを引く(未登録は空文字)。
- **`weeklyBucketMinutes(weekBlocks)`**(新規): 指定週の完了Blockを4バケット
  (strategy/chore/rest/unclassified)で時間集計する。時間の算出は既存のカテゴリ別ドーナツ
  (`renderStats` 内)と同じ「実績優先(`_actualDurationMin`)・無ければ計画時間」ロジックを
  そのまま再利用した。
- **`renderBucketGauge(weekBlocks)`**(新規): 横棒ゲージ(4色セグメント)+ 凡例
  (時間・%併記)のHTMLを返す。完了Blockが0件の週は「記録がありません」の1行に留める。
  目標値の設定UIは作らない(指示どおり)。
- **`renderWeekly()`**: 「エネルギー収支」セクションの直後に「戦略 / 雑用 / 休息 配分」
  セクションを追加。`weekBlocks`(選択中の週。既存の週送り `◀ 前週` / `次週 ▶` ナビに連動)を
  そのまま渡す — 「直近7日」を today からの固定ローリング窓ではなく、週次レビュータブが
  既に持つ「選択中の週(土〜金)」の概念に揃えた(他の全指標がこの `week` に連動しているため、
  ここだけ別軸にすると一貫性が崩れると判断)。

## 変更内容(styles.css)

- `.wip-banner` / `.wip-banner-msg` / `.wip-banner-list` / `.wip-banner-row` /
  `.wip-banner-name`: WIP上限バナー。`.weekly-cycle-link` と同系統のアクセント(青)トーン
  (`rgba(0,122,255,.06)` 背景 + `rgba(0,122,255,.2)` ボーダー)。警告色(赤系)は使わない。
- `.bucket-gauge` / `.bucket-gauge-bar` / `.bucket-gauge-seg` / `.bucket-gauge-legend*` /
  `.bucket-gauge-swatch*`: 3バケット+未分類の横棒ゲージ。戦略=青・雑用=オレンジ・休息=緑・
  未分類=グレーで既存のiOS標準色パレット(`CATEGORY_COLOR_PRESETS`)と統一した配色にした。

## 実装判断(仕様から補った点)

1. **「保留(suspended)」は既存の中断機構(`status:"paused"`)を再利用した**: コード内では
   既に「中断」という語彙・`suspendProject()`/`isProjectSuspended()` が確立しており、
   WBSの通常行にも「中断」ボタンが既にある。指示文言の「保留」はUI上の見出しラベルとして
   バナー内のボタンにのみ使い(「保留」ボタン)、状態遷移そのものは新しいステータス値を
   増やさず既存の中断/再開導線に完全に乗せた(二重のステータス概念を作らない)。
2. **ゲージの集計対象は「直近7日固定」ではなく「週次レビュータブの選択中週」**: 提案書には
   「直近1週間」とあるが、週次レビュータブは既に土〜金の週送りナビと `weekBlocks` を持ち、
   実行スコア・エネルギー収支など他の全セクションがこの `week` に連動している。ゲージだけ
   `todayISO()` からの固定7日ローリング窓にすると、週送りで他の指標は過去週に切り替わるのに
   ゲージだけ「今日基準」のままという不整合が起きるため、既存の `week` 変数へ揃えた。
3. **優先度フィールドの用途は「4件バナー」のみに限定した**: 提案2本文には「優先度『中』の
   一覧フィルタ→一括Avoid List送り」も含まれるが、監督者からの実装指示にはこの一括操作は
   含まれていなかったため、今回は優先度フィールドの追加とバナー導線のみを実装した
   (フィールド自体はモーダルから編集可能なので、次サイクルでフィルタ/一括操作を足す余地は残る)。
4. **バナーの表示単位はProjectタイトル一覧**: 「1つ潜らせますか?」の導線として、対象4件超の
   Projectをすべてバナー内に列挙し、各行に個別の「保留」ボタンを置いた(どれを保留するかは
   Kが選ぶ。アプリ側が代わりに選定しない)。

## テスト

- `tests/v63.test.js`(新規)。以下を検証する:
  1. `normalizeState` 後方互換: 旧Project(priorityフィールド無し)に `"中"` が補完される
  2. `normalizeState` 後方互換: 旧カテゴリ(bucketフィールド無し)に `""` が補完される
  3. Project優先度の編集モーダルでの保存(高/中/低)
  4. WIPバナー: アクティブ(kind=normal・status=active)なProjectが3件では非表示、4件で表示
     される(wish/other/paused/kind違いはカウントから除外されることを含む)
  5. バナーの「保留」ワンタップで対象Projectが `status:"paused"` になり、バナーの対象件数が
     減る(3件に戻れば非表示になる)
  6. カテゴリ管理でバケット(戦略/雑用/休息)を選択→保存できる
  7. 週次レビューの3バケットゲージ: 戦略/雑用/休息/未分類カテゴリの完了Blockから
     正しい分数・%が算出される(既存のカテゴリ別集計ロジックとの整合を数値で確認)
  8. 完了Blockが0件の週はゲージが「記録がありません」表示になる
  9. 週送り(◀ 前週 / 次週 ▶)でゲージの集計対象が選択中の週に追従する
- 開発中は `node tests/run-all.js v63` で絞り込み実行。
- 納品前に全量 `npm test`(`node tests/run-all.js`)を実行し ALL PASS を確認済み(詳細は末尾)。

## 変更ファイル

- `app.js`
- `styles.css`(`.wip-banner*` / `.bucket-gauge*`)
- `sw.js`(`CACHE_NAME` を `v62` → `v63`)
- `tests/v63.test.js`(新規)
- `CHANGES_v63.md`(本ファイル)
- `../taskchute-notes/handoff.md`(notes リポジトリ側、本エントリ追記)

## 実機テスト手順

1. `sw.js?nocache=YYYYMMDD` を開き、1行目が `taskchute-journal-pwa-v63` になっていることを確認。
2. WBSタブでProjectを編集し、「優先度」が保存できることを確認する。
3. `kind:normal`・`status:active` のProjectを4件以上作る(または既存を編集)と、WBSタブ上部に
   バナーが出ること、色が赤系ではなくアクセント(青系)であることを確認する。
4. バナー内の「保留」を押すと、対象Projectが中断状態になり(WBS本体の「中断」バッジと同じ扱い)、
   3件以下に減るとバナーが消えることを確認する。
5. 設定 → カテゴリ管理で各カテゴリに「戦略/雑用/休息」のバケットを設定する。
6. 週次レビュータブで「戦略 / 雑用 / 休息 配分」ゲージが表示され、時間と%が併記されること、
   ◀前週/次週▶で週を切り替えるとゲージの内訳も切り替わることを確認する。
7. 既存のWBS中断/再開・カテゴリ管理・週次レビューの他セクション(実行スコア・エネルギー収支・
   12週の弧など、v39〜v62)の動作が壊れていないことを一通り確認する。

## 確認サイン

- [ ] 実機(iPad/iPhone)で上記手順を確認
- [ ] 確認者:
- [ ] 確認日:
