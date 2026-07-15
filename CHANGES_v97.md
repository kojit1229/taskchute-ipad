# CHANGES v97

## 概要

K依頼(2026-07-15、依頼書「開発依頼書: 完了条件・スモールステップ欄の新設とAI自動設定、表示コンパクト化」のR3のみ)
「タスクシュート画面の表示範囲を絞る」への対応。

症状: タスクシュート画面(`renderTasks()`)の「未完了タスク」セクション(`renderOpenTasks()`)は
dueDateによる絞り込みが無く、1週間以上先の期日タスクまで全件並んで画面が長くなっていた。

SW `CACHE_NAME` を v96 → v97 に更新。

R2(日次バッチでのAI自動設定)/R4(縦方向コンパクト化)は別バージョンで対応する(本バッチはR3のみ)。

---

## 対象ビューの特定

依頼書の前提事実どおり、症状の原因は `renderTimeline()`(選択中の1日分のみ描画)ではなく、
`renderTasks()` 内 `renderOpenTasks()`(app.js 4966行目付近、dueDateベースの全件一覧)だった。
実データ(複数の期日を持つTask)を投入したPlaywright再現で確認してから着手した。

---

## 変更内容

### 既定の表示範囲

`renderOpenTasks()` に以下のフィルタを追加:
- **表示**: `dueDate` が空文字(期日未設定) / 期日超過(`dueDate < 選択中の日付`) /
  当日〜7日後(`選択中の日付 <= dueDate <= 選択中の日付+7日`、境界含む)
- **折りたたみ**: `dueDate > 選択中の日付+7日` のTask(8日後以降)

アンカーは既存の `isOverdue` 判定(`task.dueDate < state.selectedDate`)と同じ
`state.selectedDate` に揃えた。選択中の日付を進めれば表示窓もスライドする一貫した挙動になる
(タイムラインの「選択日基準」という既存メンタルモデルと合わせた)。

### 折りたたみUI

- 折りたたみ対象が1件以上あるときだけ、トグルボタン「8日後以降を表示 (N件)」/
  「8日後以降を隠す」を「未完了タスク」見出し直下に表示する
- **データは消さない**。折りたたみは表示フィルタのみで、`state.tasks` からは何も除外・削除しない
  (トグルで即座に復元できる)
- トグル状態は `state.settings.tasksShowFuture`(boolean、既定 `false`)。
  永続化要否は既存の同種UIトグル(WBSの `wbsHideCompleted`/`showSuspended`)の流儀に合わせて
  **永続化する**(`persistLocalNoSchedule()` + `render()`。既存の `toggle-wbs-hide-done` と
  同一パターン)。`normalizeState()` に既定値補完を追加(旧データ後方互換)
- 折りたたみ対象が0件のときはトグルボタン自体を出さない(既存の中断トグル
  `toggleBtn`(`suspCount > 0 || showSusp` 条件)と同じ「対象が無ければボタンを出さない」流儀)

---

## 変更ファイルと行数

taskchute-ipad リポジトリ、ローカルcommitのみ(push未実施):

1. app.js +43/-6 — `normalizeState`(既定値補完)+ アクションディスパッチャ
   (`toggle-tasks-show-future`)+ `renderOpenTasks()`(フィルタ・折りたたみ・トグルボタン)+
   `renderTasks()`(呼び出し側の`.grid`ラッパーを`renderOpenTasks()`側に統合)
2. sw.js +4/-1 — `CACHE_NAME` v96→v97、変更履歴コメント追加
3. tests/v97.test.js +217(新規) — E2Eテスト(a)〜(g)
4. 本ファイル: CHANGES_v97.md 追加

diffの合計が200行以下(43+4+217+本ファイル)のため、依頼書の「1コミット200行以下」分割方針上、
実装コミット・SW/CHANGESコミット・テストコミットの3つに分けてcommitする(各コミット単独でも
200行以下)。

---

## テスト: `tests/v97.test.js`(新設、7シナリオ)

- (a) 既定表示(`tasksShowFuture=false`)は当日〜7日後(境界含む)+期日超過+期日未設定のみ。
  8日後以降は行が出ない
- (b) 折りたたみ件数がトグルボタンに表示される(「8日後以降を表示 (1件)」)
- (c) トグルを押すと8日後以降のTaskも表示され、ボタン文言が切り替わる。`state.tasks`の件数・
  内容は一切変わらない(データは消えていない)
- (d) トグル状態(`state.settings.tasksShowFuture`)はリロード後も保持される
- (e) 期日超過Taskは既定表示に含まれ、赤系背景(`var(--red-soft)`)が付いたまま(既存挙動の回帰確認)
- (f) 折りたたみ対象が0件のときはトグルボタンが出ない(回帰: 誤って常時表示しない)
- (g) 390px幅のスクリーンショット取得(既定=折りたたみ状態 / トグル後=展開状態)

`npm run test:core`(直近5件が動的に v93〜v97 に更新 + 固定横断コア5件: v72/v59/v67/v50/v70、
計10本)を実行し、v96含め回帰0件を確認。

---

## 検証結果

- `node --check app.js`: OK(exit 0)
- `node tests/v97.test.js`: **ALL PASS**(7シナリオ、失敗0)
- `npm run test:core`: **✅ All suites passed**(所要150.7秒、v93〜v97 + 固定コア5本)
- タスクシュート画面のスクリーンショット(390px幅)を検証物として保存:
  - `scratchpad/v97-taskchute-390px-collapsed.png`(既定=8日後Taskが畳まれ、トグルボタン
    「8日後以降を表示 (1件)」が見える状態。当日/境界7日後/期日超過(赤背景)/期日未設定の
    各Taskは表示されている)
  - `scratchpad/v97-taskchute-390px-expanded.png`(トグル後、8日後Taskも表示された状態)

「作業済み・未検証」— 上記は機械的検証(1)+ローカルE2E実行の結果であり、DONE手順の
独立検証(fresh contextエージェントによるverify.md準拠レビュー)と最終判定はまだ通していない。

---

## 未対応・懸念点

- アンカーを `state.selectedDate`(選択中の日付)にしたため、過去日や未来日を選択している状態で
  タスクシュート画面を開くと表示窓もスライドする。「常に実際の今日」を期待する読み方をすると
  直感に反する可能性がある。ただし既存の `isOverdue` 判定も同じアンカーを使っており、画面内で
  一貫性は保たれている。挙動が合わない場合は `todayISO()` 固定への変更を検討(要K確認)
- トグル状態は選択中の日付に依存しないグローバル設定(`state.settings.tasksShowFuture`)。
  日付をまたいでも展開状態が引き継がれる(閉じ忘れると翌日以降も開いたまま)。WBS側の
  同種トグルも同じ「グローバル永続・日付非依存」の設計のため合わせたが、意図と違う場合は
  日付キー付きの状態に変更する余地あり
- R2(日次バッチ)/R4(縦コンパクト化)は本バッチ未対応(別バージョンで対応予定)
- 実機iOS Safariでの実地確認はこのセッションでは未実施(taskchute-ipad本体はcommit止まりで
  push禁止のため)。Playwright Chromium(390px viewport)での検証のみ
