# CHANGES v68

## 概要

非同期AI対話(日報の「AIへの質問」→翌朝コーチが冒頭で回答)と、人生実験機構
(`state.experiments`、同時1件のみ推奨のカードUI)を実装した。アプリ側(app.js/styles.css/sw.js)と
バッチ側(`loop/coach/daily-review.md`・`loop/coach/weekly-review.md`・
`loop/scripts/weekly-extract.py`・`loop/scripts/weekly-review-validate.py`)の両方を扱う。
`../taskchute-notes/designs/v67-plus-claude-vision.md`のv68節をベースにしつつ、監督者指示により
仮説カードの型(`state.hypotheses`)を人生実験カード(`state.experiments`、status:
running/kept/dropped)に置き換えて実装している。アプリ内Claude API呼び出しは追加していない
(v60方針を維持)。

- **非同期AI対話** — 日報タブに「今日AIに聞きたいこと(任意・1行)」入力を追加。日報生成時、
  入力があれば`origin: "user"`の問い(v39 `state.questions`をそのまま再利用)を1件作り、
  日報に「## AIへの質問」節として出す(空なら節ごと省略)。`coach-daily.sh`は前日日報全文を
  そのままプロンプトへ渡す実装のため、この節を追加するだけで翌朝のAIコーチングが読める
  (バッチ側の入力組み立ては無改修 — 詳細は「実装判断」参照)。`loop/coach/daily-review.md`に
  「日報に『AIへの質問』節があれば、フィードバック冒頭に『## 質問への回答』節で誠実に回答する」
  指示を追記した。回答はフィードバックmd経由で既存のジャーナル表示にそのまま届く(アプリ側の
  表示ロジックは無改修)。
- **人生実験機構** — `state.experiments[]`(`{id, hypothesis, metric, startDate, endDate,
  status: running|kept|dropped, conclusion}`)を新設。ジャーナル/週次レビュー両タブに共有の
  実験カードを表示する。同時に走らせる実験は1つまでという思想を、ガード関数(2件目を
  作ろうとすると「1つに絞りましょう」のトーストで抑止)で実装した。終了日を過ぎると
  カードが「続ける(kept)/手放す(dropped)」+結論1行入力の判定UIに切り替わる。`kept`にした
  実験は「原則(アファメーション)への昇格候補」として結論をコピーしやすく表示する
  (`Daily_Affirmation.md`の自動書き換えはしない — Vision/Affirmationの編集はKの領分)。
  朝プラン・コーチングの提案を手動でカード化する導線として、ジャーナルのAIフィードバック欄に
  「🧪 実験にする」ボタンを追加(手動入力補助のみ、自動抽出はしない)。
- **バッチ側(週次)** — `weekly-extract.py`に`experiments`集計(`current`: 実験中カードの
  仮説・判定材料に加え、開始日〜今日までのBlock実行率・充放電の機械集計。`recentlyClosed`:
  直近7日間に終了した`kept`/`dropped`実験)を追加。`weekly-review.md`に任意見出し
  「## 実験の判定材料」を追記(v64の「## AIプラン精度」と同じ後方互換の思想 — 実験中が無ければ
  見出しごと省略してよい)。`weekly-review-validate.py`は複数の任意見出しを扱えるよう一般化した。

## 変更内容(app.js)

### 1. 非同期AI対話

- **`normalizeState`**: `state.questions`のorigin注記コメントに`'user'`を追加(型自体は
  既存の自由文字列のため後方互換の実処理は不要 — 既存の`makeQuestion`/`normalizeState`が
  そのまま扱える)。
- **`renderReports`**: `#reportAskInput`(`font-size:16px`明示)を追加。「日報生成時に
  『## AIへの質問』節として日報へ加わり、翌朝のAIコーチングが冒頭で回答する」旨の説明文を添えた。
- **クリックハンドラ(`generate-report`)**: `#reportAskInput`に入力があれば
  `makeQuestion({text, origin: "user"})`を`state.questions`へpushし、入力欄をクリアしてから
  `generateReport()`を呼ぶ(ジャーナルタブの「日報を生成」ボタンには`#reportAskInput`が
  無いため、この分岐は何もしない=安全)。
- **`generateReport`**: サマリ節の直後に、`origin === "user" && status !== "settled"`な
  問いを列挙する「## AIへの質問」節を追加(該当が無ければ節ごと省略)。既存の
  「いま持ち続けている『問い』:」節(v39、origin不問で全open/deepening問いを列挙)とは別物
  として実装した(混同すると全問いが毎回日報に載ってしまうため)。

### 2. 人生実験機構

- **`normalizeState`**: `value.experiments`を配列として補完し、各エントリに
  `hypothesis/metric/startDate/endDate/status(既定"running")/conclusion/createdAt/updatedAt/deleted`
  の既定値を補完(既存値優先)。
- **`makeExperiment`**(新規): `id`採番、`endDate`未指定時は`startDate`+14日を既定にする。
- **`activeExperiment()`/`latestKeptExperiment()`**(新規): 実験中(running)は先頭1件のみを
  「実験中」として扱う(アプリ側は常に高々1件になるようガードするが、他端末同期等での
  想定外の複数running発生に備え、表示側も1件に丸める防御的実装)。昇格候補は
  結論つき`kept`のうち`updatedAt`最新の1件。
- **`addExperimentOrGuard`**(新規): 「+ 実験を始める」「別の実験を試したい」「🧪 実験にする」
  共通の入口。実験中があればモーダルを開かず「実験は1つに絞りましょう — 今の実験の結論を
  出してから次へ」とトースト表示するだけ。
- **`openExperimentEditor`/`buildExperimentModal`/`saveExperimentFromModal`/`deleteExperiment`**
  (新規): 既存のQuestionモーダル(v39)と同型の専用モーダル(`state.modal.type === "experiment"`)。
  `submitModal`/`deleteFromModal`にも分岐を追加。新規作成の保存直前にも二重ガードを入れている
  (モーダルを開いたまま他端末同期でrunningが増える競合への保険)。`deleteFromModal`側で
  既に確認ダイアログ済みのため、`deleteExperiment`自身は`window.confirm`を重ねない
  (`deleteProject`/`deleteTask`/`deleteBlock`と同じ流儀)。
- **`readExperimentConclusionInput`/`keepExperiment`/`dropExperiment`**(新規): 終了日超過時に
  表示される`#exp-conclusion-input`(都度state再描画に晒さない一回読み取り、`zt-add-text`等と
  同じパターン)から結論1行を読み、空なら「結論を1行、書いてください」で拒否する。
- **`copyExperimentConclusion`**(新規): `navigator.clipboard.writeText`+execCommandフォールバック
  (`copyReportToClipboard`と同じ二段構え)でkept実験の結論をコピーする。
- **`renderExperimentSection`**(新規): ジャーナル/週次レビュー両タブで共有する実験カード本体。
  実験中が無ければ「+ 実験を始める」、あれば仮説・判定材料・期間を表示し、終了日超過なら
  結論入力+続ける/手放すボタン、未超過なら編集/「別の実験を試したい」を出す。kept実験があれば
  末尾に昇格候補ボックスを続ける。
- **クリックハンドラ**: `experiment-add`/`edit-experiment`/`experiment-keep`/`experiment-drop`/
  `experiment-copy-conclusion`を追加。
- **`renderJournal`**: `renderDateBar()`直後に`renderExperimentSection()`、AIフィードバック欄の
  ボタン行に「🧪 実験にする」を追加。
- **`renderWeekly`**: 週ナビ直後に`renderExperimentSection()`を追加(ジャーナルと同じ関数を共有)。

## 変更内容(styles.css)

- `.exp-card .exp-hypothesis`/`.exp-card .exp-judge`/`.exp-card .exp-promote .exp-hypothesis`:
  実験カードの仮説文・終了日超過時の判定ボックス(オレンジ系の控えめな枠)・昇格候補の結論文
  (緑系)。既存の`.weekly-sec`/`.field`/`.btn`等をそのまま流用し、新規クラスは最小限にした。

## 変更内容(sw.js)

- `CACHE_NAME`を`taskchute-journal-pwa-v67`→`taskchute-journal-pwa-v68`に更新。
  `AI作業結果_*.json`と同じ「新規静的アセットの追加はしていない」変更のため、`APP_SHELL`の
  変更は無い。

## 変更内容(バッチ側: loop/)

### 1. `loop/coach/daily-review.md`

- 「## 質問への回答(v68・日報に『AIへの質問』節がある場合のみ)」の指示節を追加。データを
  引ける質問はデータで、判断系の質問は率直な意見(根拠1文つき)で答えるよう指定。
- 出力形式(厳守)ブロックの先頭に、任意節「## 質問への回答」を追記(無ければ省略し
  「## 良かった点」からそのまま始める)。

### 2. `loop/coach-daily.sh`(調査のみ、変更なし)

- **不要と判断した**: `prompt_input`組み立て(`echo "---- 前日日報全文 ----"; cat "$JOURNAL"`)は
  日報ファイルの全文をそのままプロンプトへ渡しており、アプリ側で追加した「## AIへの質問」節も
  この全文コピーに自然に含まれる。日報の自動push経路(`generateReport`ラップの
  `autoSave`連動push、`pushReportToGitHub`)もいずれも`state.reports[date]`(生成markdown全文)を
  そのまま`日報_<date>.md`として書き出すため、節の有無に関わらずコード変更は不要と確認した。

### 3. `loop/scripts/weekly-extract.py`

- `state.experiments`から`experiments.current`(実験中1件。無ければ`null`。仮説・判定材料の
  自由記述に加え、開始日〜今日までのBlock実行率・充放電を機械集計した`stats`を添える)と
  `experiments.recentlyClosed`(直近7日間に終了日を迎えた`kept`/`dropped`実験の配列)を
  出力トップレベルキーに追加。`metric`の自由記述をそのまま計算することはできないため、
  `stats`は汎用的な進捗シグナル(実行率・充放電)として位置づけた。

### 4. `loop/coach/weekly-review.md`

- 入力データの読み方に`experiments`キーの説明を追加。
- 出力形式(厳守)ブロックに任意見出し「## 実験の判定材料」を追加(`experiments.current`が
  無ければ見出しごと省略してよい、`overdue`なら判定を促す一言を添える、判定そのもの(続ける/
  手放す)はKが行うため断定的な結論は書かない、という指示を明記)。既存6見出し+
  「## AIプラン精度」との相対順序ルール(必須見出しより後、任意見出し同士の順序は問わない)を
  追記。

### 5. `loop/scripts/weekly-review-validate.py`

- `OPTIONAL_H2_AFTER_REQUIRED`を単一文字列からリストへ一般化し、「## AIプラン精度」
  「## 実験の判定材料」の両方を独立に(存在すれば必須見出しより後か)検証するようにした。
  既存の「## AIプラン精度」単体の挙動は変えていない(後方互換)。

## 実装判断(仕様から補った点)

1. **仮説カードの型を設計書(`state.hypotheses`)から変更した**: `v67-plus-claude-vision.md`は
   `state.hypotheses`(`judgeCriteria`/`promotedToAffirmation`等)を提案していたが、監督者の
   実装指示は`state.experiments`(`metric`/`status: running|kept|dropped`/`conclusion`、
   終了日既定14日後)という別スキーマだった。実装指示を優先し、本変更は`state.experiments`で
   統一している。バッチ側(`weekly-extract.py`/`weekly-review.md`)もこのスキーマに合わせた。
2. **「## AIへの質問」節の挿入位置**: 日報内のどこに置いても`coach-daily.sh`は全文をそのまま
   渡すため機能上の影響は無いが、Kが日報を読み返す際に見つけやすいよう、サマリ節(冒頭)の
   直後に配置した。
3. **`metric`(判定に使う数字の説明)は自由記述のまま、`weekly-extract.py`側で機械計算はしない**:
   Kが書く`metric`は「該当タスクの着手率」のような自然文であり、これをプログラムで厳密に
   再現計算することは範囲外(誤読・過剰な自動化のリスク)と判断した。代わりに、実験の
   開始日〜今日までのBlock実行率・充放電という汎用的な進捗シグナルを`stats`として添え、
   AIコーチには`metric`の文言と`stats`の数字の両方を判断材料として使うよう指示した
   (「判定は人間、集計は機構」という既存の`state.questions`(v39)/`migrationRitualLog`(v61)と
   同じ分業思想を踏襲)。
4. **実験中は「最初の1件」のみを表示対象にした**: アプリ側のガード(`addExperimentOrGuard`)は
   2件目の新規作成を抑止するが、他端末同期・手動JSON編集等で複数`running`が並存する可能性は
   ゼロにできない。`activeExperiment()`/`weekly-extract.py`の`current_experiment`探索は、
   いずれも最初に見つかった1件だけを扱うことで、表示・集計の両方を「常に高々1件」という
   UI上の思想と一致させた(想定外データでもクラッシュしない防御的実装)。
5. **削除確認ダイアログの二重化を避けた**: 既存の`deleteFromModal()`が`window.confirm`を
   一括で持つ設計(`deleteProject`/`deleteTask`/`deleteBlock`は内部で確認しない)に合わせ、
   `deleteExperiment`にも確認ダイアログを持たせなかった(`deleteQuestion`は一覧からの直接削除
   ボタンでも呼ばれるため独自confirmを持つ既存の非対称があるが、実験カードには一覧直接削除
   ボタンを設けていないためこの非対称は踏襲しなかった)。

## テスト

- `tests/v68.test.js`(新規)。以下を検証する:
  1. normalizeState後方互換: `experiments`キー自体が無い旧stateに`[]`が補完される。旧エントリ
     (`status`/`conclusion`等が無い)にも既定値が補完される
  2. `generateReport()`: `origin:"user"`かつ未解決の問いだけが「## AIへの質問」節に出る
     (`settled`済み・`origin`違いは出ない。既存v39の「いま持ち続けている『問い』」節との
     混線が無いことを節単位で切り出して検証)
  3. 該当する問いが無ければ「## AIへの質問」節ごと省略される
  4. `#reportAskInput`に1行入力→「日報を生成」で`origin:"user"`の問いが1件作られ、日報にも
     反映され、入力欄がクリアされる
  5. 実験カード: 「+ 実験を始める」→モーダル(仮説/判定材料/開始日/終了日=既定14日後)を
     入力して保存→`running`で1件作られる
  6. 実験中に2件目を作ろうとすると「1つに絞りましょう」トーストが出て、モーダルは開かない
     (実験中カードの「別の実験を試したい」ボタン経由)
  7. ジャーナルのAIフィードバック欄「🧪 実験にする」ボタンも同じガードがかかる
  8. 終了日未超過の実験中は「編集」から更新でき、「削除」で`deleted:true`になり
     「+ 実験を始める」に戻る
  9. 終了日超過: 結論入力欄+続ける/手放すボタンが出る。結論が空だと拒否される
  10. 結論を書いて「続ける(kept)」→`status:kept`+結論保存、「原則(アファメーション)への
      昇格候補」として結論とコピーボタンが表示される
  11. 週次レビュータブにも同じ実験セクション(実験中カード・昇格候補)が出る
  12. 終了日超過→「手放す(dropped)」→`status:dropped`、昇格候補には出ない
  - v67と同じ理由(本番バッチが日次で`AIプラン_*.json`/`AIフィードバック_*.md`/
    `週次レビュー_*.md`を実際にcommitする)で、これら3種の実ファイルfetchを`page.route`で
    常に404隔離し、リポジトリの実ファイル有無に結果が左右されないようにした。
- 開発中は`node tests/v68.test.js`または`node tests/run-all.js v68`で単独実行して確認(ALL PASS)。
- 【全量確認】リポジトリ直下に本番バッチ生成済みの`AIプラン_2026-07-10.json`が存在する状態で、
  全量`npm test`(`node tests/run-all.js`、v68含む全17スイート)を実行し**ALL PASS**を確認済み。
- 【バッチ側】`bash loop/guardrails/verify.sh`(shellスクリプト構文チェック、19検査)green。
  `bash loop/weekly-review.sh --dry-run`で見出し検証(`weekly-review-validate.py`)通過を確認
  (dry-runのダミー候補mdは既存どおり「## 実験の判定材料」を含まないが、任意見出しのため検証OK
  = 後方互換が壊れていないことの確認を兼ねる)。加えて、`weekly-extract.py`単体を実験中/直近終了
  それぞれのフィクスチャで手動実行し、`current.stats`(Block実行率・充放電が終了日でなく
  `min(endDate, today)`で打ち切られること)・`recentlyClosed`(範囲外の実験が混入しないこと)を
  個別に確認した。`bash loop/coach-daily.sh --dry-run`も既存の冪等スキップ経路(対象日報なし)で
  正常終了を確認(`daily-review.md`はプロンプトのみの変更のためスクリプト側の回帰は無い)。

## 変更ファイル

- `app.js`
- `styles.css`(`.exp-card` 系)
- `sw.js`(`CACHE_NAME`を`v67`→`v68`)
- `tests/v68.test.js`(新規)
- `CHANGES_v68.md`(本ファイル)
- `../taskchute-notes/handoff.md`(notes リポジトリ側、本エントリ追記)
- `../../loop/coach/daily-review.md`(バッチ側、リポジトリ外)
- `../../loop/coach/weekly-review.md`(バッチ側、リポジトリ外)
- `../../loop/scripts/weekly-extract.py`(バッチ側、リポジトリ外)
- `../../loop/scripts/weekly-review-validate.py`(バッチ側、リポジトリ外)

## 実機テスト手順

1. `sw.js?nocache=YYYYMMDD`を開き、1行目が`taskchute-journal-pwa-v68`になっていることを確認。
2. 日報タブで「今日AIに聞きたいこと」に1行入力→「日報を生成」。生成された日報に
   「## AIへの質問」節が出ることを確認する(空欄のまま生成すると節が出ないことも確認)。
3. 翌朝(または`coach-daily.sh`を手動実行)、AIフィードバックの冒頭に「## 質問への回答」節が
   出て、質問に答えていることを確認する。
4. ジャーナル/週次レビュータブに「🧪 人生実験」カードが出ることを確認。「+ 実験を始める」で
   仮説・判定材料・期間(既定14日後)を入力して保存する。もう一度「実験を始める」を試みると
   (実験中カードの「別の実験を試したい」から)モーダルが開かず、「1つに絞りましょう」の
   トーストが出ることを確認する。
5. 実験の終了日を過去にして(または14日待って)、カードが結論入力+続ける/手放すボタンに
   切り替わることを確認する。結論を書いて「続ける(kept)」を押すと、「原則(アファメーション)
   への昇格候補」として結論とコピーボタンが表示されることを確認する。
6. 既存のWBS/タスクシュート/タイムライン/朝プラン/週次レビュー/レバレッジ台帳/AI連携鮮度/
   AI作業ワーカー連携(v39〜v67)の動作が壊れていないことを一通り確認する。

## 確認サイン

- [ ] 実機(iPad/iPhone)で上記手順を確認
- [ ] 確認者:
- [ ] 確認日:
