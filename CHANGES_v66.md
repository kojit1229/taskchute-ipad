# CHANGES v66

## 概要

`../taskchute-notes/designs/10x-mechanism.md` のv65節2-2(レバレッジ台帳)・2-4(やめることリストの
運用強化)、およびv66節2-1後段(週次2x:10x時間比の可視化)を実装した。v65で入口だけ用意した
「leverageType属性」を、実際に**振り返りで使える形**まで押し上げるのが今回の狙い。アプリ内
Claude API呼び出しは追加していない(v60方針を維持)。

- **レバレッジ台帳** — `leverageType=asset` で完了したTask/Blockを「作った資産」として自動集計
  する週次レビュー内セクション。専用の永続ログ(`state.leverageLedger`)は新設せず、v65で
  既に付与できる属性の**完了実績そのもの**を都度集計する派生ビューにした(二重入力をさせない)。
  各行にタイトル・完了日・累計節約の自己申告メモ(任意1行、新設`leverageNote`フィールド)を表示。
  台帳先頭に「今週、資産を1つ作ったか?」の問いを置き、選択中週に資産の完了実績があれば
  「✓ 今週、資産を n 個作った」、無ければ問いだけを裁かずに表示する(週送りで自動的に切り替わる)。
- **2x:10x時間比トレンド(直近8週)** — v65の週次1行集計を発展させ、週ごとの
  資産+削減(10x)時間 と 単発+未設定(2x)時間 の比率を、直近8週分の小さなCSS横棒グラフで
  週次レビューに表示する(ライブラリ不使用)。記録の無い週は0除算せず「記録なし」と表示する。
- **Avoid List連携** — マイグレーション儀式(3回目以降の繰り越し確認モーダル)の選択肢に
  「Avoid Listへ記録して手放す」を追加(既存の`addAvoid`と同じ形の項目を`state.settings.avoidList`
  へ直接記録し、Blockは削除する)。3回以上繰り越されたタスクは「無自覚な繰り返し作業」の実データ
  そのものであり削除候補として精度が高い、という設計書2-4の狙いをそのまま実装した。
- **バッチ連携の下準備** — `weekly-extract.py`(`../../loop/scripts/weekly-extract.py`)が読む
  `app-state.json`は、GitHub保存時に`state.blocks`/`state.tasks`をほぼそのまま
  (`sanitizedStateForGitHub`はtoken除去とmodal破棄のみ)書き出している。v65で既に各Block/Taskへ
  `leverageType`が乗っているため、週次集計用に**アプリ側の状態構造を追加変更する必要はない**
  (バッチ側で`blocks[].leverageType`と`blocks[].date`/`completed`を読めば足りる)。今回はコード
  変更なし・現物確認のみで済ませた。

## 変更内容(app.js)

### 1. レバレッジ台帳(designs/10x-mechanism.md 2-2)

- **`normalizeState`**: `value.tasks`/`value.blocks` のmapに `leverageNote: ""` のデフォルトを
  追加(既存値優先で後方互換補完。v65の`leverageType`補完と同じ場所・同じ思想)。
- **`assetLedgerItems()`**(新規): `leverageType === "asset"` で完了した Block(`completed`)・
  Task(`status === "completed"`)を集計し、`{id, kind, title, date, note}` の配列を新しい順で返す。
  完了日はBlockなら`date`、Taskなら`realizedDate`(無ければ`updatedAt`日付部分)。
- **`assetLedgerCountForWeek(weekStart)`**(新規): 指定週(`weekDays`)に完了日が入る資産の件数。
- **`renderLeverageLedger(weekStart)`**(新規): 台帳セクション本体のHTML。先頭に問い/✓表示、
  下に一覧(タイトル・完了日・累計節約メモの`<input>`)。資産0件なら裁かない空状態メッセージ。
- **`renderWeekly`**: 「戦略/雑用/休息配分」「エネルギー構造」セクションの後に、新セクション
  「レバレッジ台帳」を追加。既存の`noRecord`(その週の完了Blockが0件)判定の**外側**に置き、
  記録ゼロの週でも台帳・問いは表示されるようにした(台帳は全期間の実績を見る道具のため)。
- **change イベント委譲**: `[data-ledger-note-id]` にマッチする入力を、`data-ledger-note-kind`
  (`"task"`/既定`"block"`)に応じて`updateTaskField`/`updateBlockField`の`leverageNote`フィールド
  へ委譲するハンドラを追加(既存の`data-block-field`と同じ「idで対象を特定→汎用フィールド更新」
  パターンを再利用)。

### 2. 2x:10x時間比トレンド(designs/10x-mechanism.md 2-1後段・v66節)

- **`leverageRatioHistory(weekStart, n = 8)`**(新規): `weeklyLeverageMinutes`(v65)を直近n週分
  (既定8週、`startRateHistory`と同じ「過去→現在」の`addDays(weekStart, -7*i)`ループパターンを
  再利用)呼び出し、`{week, tenXMin, twoXMin, totalMin, pct}` を返す。`totalMin === 0` の週は
  `pct: null` とし、呼び出し側で0除算・NaN%を出さないようにする。
- **`renderLeverageTrend(weekStart)`**(新規): 8週分を1行1週のCSS横棒(2セグメント: 10x/2x)として
  描画する。記録が無い週は空グレーのバー+「記録なし」表示に切り替える。ライブラリは使用しない。
- **`renderWeekly`**: 「レバレッジ台帳」の直前に「2x:10x 時間比トレンド(直近8週)」セクションを
  追加。

### 3. Avoid List連携(designs/10x-mechanism.md 2-4)

- **`buildMigrationRitualModal`**: 選択肢に「Avoid Listへ記録して手放す」(`data-choice="avoid"`)
  を追加(4択→5択)。既存の「手放す」(Wishへ移動 or 削除の二択を`window.confirm`で聞く)とは別の
  独立した選択肢とし、選ぶと即座にAvoid Listへ記録してBlockを削除する(確認ダイアログを挟まない
  — 儀式モーダル自体が既に「一呼吸置く」ステップになっているため、Avoid行きの意思決定にさらに
  ネストした確認を重ねるとかえって「削除の心理的コストを上げすぎない」設計原則に反すると判断した)。
- **`resolveMigrationRitual`**: `choice === "avoid"` の分岐を追加。`state.settings.avoidList`へ
  `addAvoid`と同形の項目(`{id, text, createdAt}`)を追記し、対象Blockを`deleted: true`にする。
  下書き経由(`origin === "draft"`)なら下書きからも除外する。選択ログ(`migrationRitualLog`)にも
  `choice: "avoid"`として記録される。

## 変更内容(styles.css)

- `.lev-trend*`: 2x:10x時間比トレンドのCSS横棒(週ラベル/2セグメントバー/%表示)。
  10xセグメントは既存の`--teal`、2xセグメントは`bucket-gauge`の未分類と同じ`#8E8E93`を再利用
  (新規カラー定義なし)。
- `.lev-ledger*`: レバレッジ台帳の問い/一覧(タイトル・完了日・メモ入力)のレイアウト。
  メモ入力は`.input`クラスをそのまま使い、font-sizeは上書きしない(iOS Safariの自動ズーム防止
  ルールを崩さないため — `.input`は既定で16px以上を満たしている)。

## 変更内容(sw.js)

- `CACHE_NAME` を `taskchute-journal-pwa-v65` → `taskchute-journal-pwa-v66` に更新。

## 実装判断(仕様から補った点)

1. **レバレッジ台帳は設計書2-2の「手動ログ配列」ではなく、既存leverageType属性の完了実績を
   都度集計する派生ビューとして実装した**: 設計書2-2本文は`state.leverageLedger`という新規の
   軽量配列+「資産を追加」ボタンでの手動記録を提案しているが、監督者からの実装指示は明確に
   「leverageType=asset の完了Block/完了タスクを『作った資産』として蓄積表示する専用ビュー」
   だった。v65で既にTask/Block編集モーダルにleverageType選択が入っているため、同じ事実を
   二重に記録させると「一番重要な10x行動を一番簡単な操作にする」という設計書2-2自身の原則
   (エフォートレス思考の引用)に反すると判断し、監督者指示に従って派生集計方式を採った。
2. **累計節約メモは新規`leverageNote`フィールドとしてTask/Blockに直接持たせた**: 台帳専用の
   別ストアを持つと、Task/Block削除時にメモだけ迷子になる・normalizeStateでの整合維持が二重に
   なるなどの複雑さが増すため、既存の`leverageType`と同じ場所(Task/Block自体)に相乗りさせた。
3. **Avoid List連携は`window.confirm`を使わず独立ボタンにした**: design書は「『手放す』の現行
   2択に第3の選択肢として足す」と書いており、既存releaseの`window.confirm`(Wishへ移動/削除の
   二択)へ選択肢をネストする実装も可能だったが、`confirm()`はOK/キャンセルの2値しか持てず
   3択化できない。儀式モーダル自体の選択肢を1つ増やす形(5択化)にした方が実装がシンプルで
   iOS Safari上でも一貫した挙動になるため、こちらを採用した(v61.test.jsの「4つの選択肢」
   アサーションを5つに更新)。
4. **バッチ連携の下準備(項目4)はコード変更なしと結論づけた**: `sanitizedStateForGitHub`が
   `state.blocks`/`state.tasks`をtoken除去以外ほぼそのまま書き出すため、v65で追加済みの
   `leverageType`フィールドが既に`app-state.json`に自然に含まれている。`weekly-extract.py`側の
   改修は本タスクのスコープ外(taskchute-ipad本体ではなく`loop/scripts/`配下)であり、監督者
   指示も「確認」止まりだったため、現物確認のみ行いコード変更はしていない。

## テスト

- `tests/v66.test.js`(新規)。以下を検証する:
  1. normalizeState後方互換: `leverageNote`フィールドが無い旧Task/旧Blockに`""`が補完される
     (既存の`leverageType`補完値は壊れない)
  2. レバレッジ台帳: 資産0件の週は「今週、資産を1つ作ったか?」を裁かずに表示し、台帳自体も
     空状態メッセージになる
  3. レバレッジ台帳: `leverageType=asset`で完了したTask/Blockが自動で一覧化される(タイトル・
     完了日)。`eliminate`のBlockは台帳に出ない。✓+件数表示。累計節約メモは入力→保存→
     リロード後も残る
  4. 問いの✓切替: 前週(資産0件)へ移動すると✓表示が消え、問いだけの表示に自動的に戻る
     (台帳の一覧自体は週に関係なく全期間の記録として残る)
  5. 2x:10x時間比トレンド: 常に8行描画される。記録の無い過去週は0除算せず「記録なし」表示
     (NaN%を出さない)。記録がある週は資産+削減:単発+未設定の比率(%)を正しく表示する
  6. マイグレーション儀式: 「Avoid Listへ記録して手放す」選択肢が表示され、選ぶと
     `state.settings.avoidList`へ記録されつつBlockが削除され、選択ログにも記録される
     (Avoid List画面に実際に表示されることまで確認)
- `tests/v61.test.js`(修正): 儀式の選択肢が4→5になったことに伴い、選択肢数のアサーションを
  5に更新(仕様変更に伴う既存テスト更新)。他の検証内容は無変更。
- 開発中は `node tests/run-all.js v61 v65 v66` で絞り込み実行。
- 納品前に全量 `npm test`(`node tests/run-all.js`)を実行し、15スイート全てALL PASSを確認済み。

## 変更ファイル

- `app.js`
- `styles.css`(`.lev-trend*` / `.lev-ledger*`)
- `sw.js`(`CACHE_NAME` を `v65` → `v66`)
- `tests/v61.test.js`(修正: 儀式選択肢数のアサーション更新)
- `tests/v66.test.js`(新規)
- `CHANGES_v66.md`(本ファイル)
- `../taskchute-notes/handoff.md`(notes リポジトリ側、本エントリ追記)

## 実機テスト手順

1. `sw.js?nocache=YYYYMMDD` を開き、1行目が `taskchute-journal-pwa-v66` になっていることを確認。
2. WBS/タスクシュートでTask・Blockのレバレッジを「資産」にして完了させ、週次レビュータブの
   「レバレッジ台帳」セクションにタイトル・完了日が自動で並ぶことを確認する。
3. 台帳の各行の「累計節約メモ」欄に1行メモを入力し、画面を離れて戻る(またはリロード)しても
   残っていることを確認する。
4. 資産を1つも完了していない週で「今週、資産を1つ作ったか?」の問いだけが静かに出て、資産を
   完了した週では「✓ 今週、資産を n 個作った」に切り替わることを、前週/次週ボタンで確認する。
5. 「2x:10x 時間比トレンド(直近8週)」に8本のバーが並び、記録の無い週は「記録なし」、記録が
   ある週は資産+削減の比率(%)が出ることを確認する。
6. 未完了Blockを3回繰り越し、儀式モーダルに「Avoid Listへ記録して手放す」ボタンが追加されて
   いることを確認する。選ぶとAvoid Listタブに同名の項目が追加され、元のBlockが消えることを
   確認する。
7. 既存のWBS/タスクシュート/タイムライン/朝プラン/週次レビュー/マイグレーション儀式の他機能
   (v39〜v65)の動作が壊れていないことを一通り確認する。

## 確認サイン

- [ ] 実機(iPad/iPhone)で上記手順を確認
- [ ] 確認者:
- [ ] 確認日:
