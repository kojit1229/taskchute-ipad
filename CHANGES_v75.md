# CHANGES v75

## 概要

1. ホーム「AIから」でAIフィードバックが見れない不具合の修正
2. 日報生成画面に前日のAIフィードバックを参照できるようにする
3. AIプラン_YYYY-MM-DD.json の新フィールド `zeroSecThemes`(0秒思考のテーマ提案)を
   タイムラインの「AIプラン取り込みUI」でワンタップ選定できるようにする

新しいタブは追加していない(いずれも既存タブ・既存データ構造への追記)。

---

## 1. 【不具合修正】ホーム「AIから」でAIフィードバックが見れない

### 1.1 事前診断(同一オリジンfetch説)は現物確認の結果、誤りだった

指示時点の想定原因は「AIフィードバック_YYYY-MM-DD.md の読み取りが同一オリジンfetch(公開Pages)
のまま残っている」だったが、`app.js` を全文grepして裏取りした結果、**該当箇所は存在しなかった**。
`hydrateStaticMarkdown()` のAIフィードバック取得は既に v72 の時点で `fetchGitHubRawText()`
(personal-data API = GitHub Contents API 経由、`kojit1229/personal-data` リポジトリの
`taskchute/` 配下)に切り替わっており、コード中にも
`// v72: 個人データリポジトリ...からのGitHub API取得に切替(同一オリジンfetch廃止)` という
コメントが残っている。AIプラン(`tryFetchAiPlan`/`fetchAiPlanFreshnessDate`)・週次レビュー・
AI作業結果・Vision/Daily_Affirmation・読書関連(highlights/reflections/summary)も同様に、
すべて `fetchGitHubRawText`/`fetchGitHubRawResult` 経由であることを確認済み(旧来の
同一オリジン専用 `fetchText` のような関数はコード上に存在しない)。`tests/v75.test.js` [2] に、
「同一オリジン(公開Pages相当の静的サーバ)への個人md/jsonリクエストが0件」であることを
否定アサーションとして追加し、この点を継続的に保証する。

### 1.2 実際の不具合: ホーム「AIから」カードにフィードバック本文を読む手段が無かった

v71の「散らばったAI系表示の集約」で、ホーム「AIから」カード(`homeAiHubBody`)は
「鮮度インジケータ」「AI作業結果」「前日フィードバックからのMIT候補(抽出テキストのみ)」の
3つに整理されたが、**フィードバック本文そのものを読む導線がこの時点から一度も存在しなかった**。
唯一本文を読めたのはジャーナルタブ(`renderJournal`)のみで、K が「ホームのAIからで見れない」と
感じていたのはこの導線の欠如そのものだった。

加えて、MIT候補抽出(`extractMITCandidatesFromReport`)の見出し検出が `MIT\s*候補` のみに
限定されており、実際の `loop/coach-daily.sh` の出力見出し(`## 明日への提案`、チェックボックス
箇条書き `- [ ] ...`)には一致しないため、実データでは常に候補0件になっていた
(`personal-data/taskchute/AIフィードバック_2026-07-09.md` の実ファイルで確認)。「AIから」カードに
実質何も読める内容が無かった実態は、この2つの不具合が重なった結果だった。

### 1.3 修正

- `extractMITCandidatesFromReport`: 見出し判定に `明日への提案` を追加(`MIT候補` 系の既存判定は
  維持、後方互換)。抽出時に先頭の `[ ]`/`[x]` チェックボックス表記を候補文言から除去するようにした。
- `homeAiHubBody` に `homeAiFeedbackReadHTML()` を追加。当日/前日のAIフィードバック本文を
  既定closedの `<details>`(ジャーナルタブの「前日のフィードバックも見る」と同じ確立済みパターン)
  で読めるようにした。読み取り経路は `cachedFeedback`(= `fetchGitHubRawText` 経由、1.1で
  確認済みの personal-data API 経路)をそのまま流用しており、新しい fetch は追加していない。

### 1.4 既存テスト `tests/v71.test.js` の更新(仕様に整合させるための正当な更新)

上記1.3の追加により `.home-ai-hub` の `textContent` には(既に候補から除外済み・MIT充足済みの
場合でも)フィードバックのraw本文がそのまま含まれるようになった。`tests/v71.test.js` の
[5]「追加後は候補カードから消える」[6]「MIT3件埋まっていれば候補は出ない」は、当時
`.home-ai-hub` 全体のtextContentに対象文字列が含まれないことで判定していたため、raw本文表示
追加後は意図とズレて失敗するようになった(検証対象の挙動自体、すなわち「候補として二重に
出さない」「MIT充足時に候補セクション自体を出さない」は無変更で正しく成立している)。
判定を「候補行(`[data-action="mit-candidate-add"]` ボタン)・候補見出し(`昨日のフィードバック
からの候補`)の有無」というより正確なスコープに絞り込み、検証意図を保ったまま更新した。
テストを削除・弱体化してはおらず、DOM構造の変化に合わせて判定箇所を正しく狭めただけ。

---

## 2. 日報生成画面に前日のAIフィードバックを表示

`renderReports()`(日報タブ、`生成AIへ渡す素材`)に、前日分のAIフィードバックを既定closedの
`<details class="report-prev-feedback">` で表示するようにした。読み取りは1.3と同じ
`cachedFeedback`/`state.feedback` 経路の流用(新規fetchなし)。前日分が無ければ `<details>` 自体を
出さない(フェイルソフト)。

---

## 3. AIプラン_YYYY-MM-DD.json の `zeroSecThemes`(0秒思考のテーマ提案)取り込みUI

バッチ側(`loop/plan-daily.sh` 系、本日実装済み)が生成する `AIプラン_YYYY-MM-DD.json` の
トップレベルに `"zeroSecThemes": [{"theme": "...", "reason": "..."}]` が入るようになった
(存在しない日もある = 後方互換必須)。

### 3.1 取得

`fetchZeroSecThemes(date)` を新設。`tryFetchAiPlan`(スケジュール項目の厳密な検証)とは独立に
`AIプラン_<date>.json` を取得し、`zeroSecThemes` 配列のみを軽量に検証する。スケジュール側
(`plan`/`skipped`)の成否に関わらず取得できるよう、`runAiMorningPlan()` の冒頭(空き時間・候補の
有無を見る前)で呼び出している。

### 3.2 表示: 「AIプラン取り込みUI」に相乗り

新しいUIタブ・新しいUIコンポーネント種別は作らず、既存の下書きスケジュールバー
(`draftBarHTML`、タイムライン最上部)の直下に `zeroSecThemeBarHTML()` を追加した。表示は
`_scheduleDraft`(スケジュール下書き)の有無とは独立(スケジュール側が決定論フォールバックに
落ちても、あるいは配置できる候補が0件でも、テーマ提案自体は別枠で出る)。各テーマに
「＋ 0秒思考リストに追加」「見送り」のワンタップボタンを添える。

### 3.3 追加先・採否の記録

- 「追加」: 既存の0秒思考テーマの実データ構造 `state.zeroThinking.themes`(`{id, text, fav,
  questionId, createdAt}`)へ、完全一致の重複が無ければ1件追加する。既存の
  手動追加(`ztAddSubmit`)・AIフィードバック手動取り込み(`submitAiImport`)と全く同じ追加パターン
  を再利用しており、0秒思考タブ側の表示・編集・お気に入り等は無改造で機能する。
- 採否ログ: 新設の永続配列 `state.zeroSecThemeLog`(`{date, theme, reason, outcome, at}`、上限
  300件)に、「追加」「見送り」どちらも記録する。既存の `aiPlanSkippedLog`/`aiScheduleHistory` と
  同じ「軽量配列に採否を貯めて将来のバッチ分析に使う」思想を踏襲した(学習ループに乗せる)。
- 決定後はカードから該当テーマを取り除く(再表示しない)。同日に既に採否判断済みのテーマは、
  再度「🌅 朝プラン」を実行しても再提示しない(`zeroSecThemeLog` の当日エントリで除外)。

### 3.4 後方互換

`zeroSecThemes` が無いJSON(バッチ未対応の日・旧フォーマット)では `fetchZeroSecThemes` が
`null` を返し、`_zeroSecThemeDraft` は更新されない(= カード自体が出ない)。スケジュール側の
下書き配置(`plan`/`skipped`)は従来どおり動作する。`tests/v75.test.js` [5] で回帰テスト化した。

---

## 4. Service Worker

- `sw.js`: `CACHE_NAME` を `taskchute-journal-pwa-v74` → `taskchute-journal-pwa-v75` に更新。
  ロジック変更なし。

---

## 5. テスト

`tests/v75.test.js`(新規。`tests/*.test.js` は本スイートを含め全23ファイル)。既存スイート
(v62/v72/v74)と同じ `page.route` によるAPIモック + `blockGithubApiByDefault`/`passGithubGate`
を使用。検証内容:

1. ホーム「AIから」カードで、personal-data API(`api.github.com`)経由で取得した当日/前日の
   AIフィードバック本文が既定closedの `<details>` から実際に読めることを、api.github.comへの
   実リクエスト発生と合わせて確認
2. 上記の読み取りで、同一オリジン(公開Pagesに相当する静的サーバ)へのAIフィードバック/
   AIプラン/週次レビュー/AI作業結果/Vision/Daily_Affirmationのリクエストが1件も発生しないこと
   (否定アサーション)
3. 日報生成画面に前日のAIフィードバックが既定closedの `<details>` で表示される。前日分が
   無い場合は `<details>` 自体が出ない(フェイルソフト)ことも確認
4. `zeroSecThemes` がタイムラインの下書きバー直下にテーマ提案として表示され、「追加」で
   `zeroThinking.themes` へ入りカードから消える、「見送り」で追加されずに `zeroSecThemeLog` へ
   記録されカードから消えることを確認
5. `zeroSecThemes` フィールドが無い(旧フォーマットの)AIプラン_*.json でもクラッシュせず、
   テーマ提案カードが出ないことを確認(後方互換)
6. **(should-fix1)** 繰越・WBS候補が0件でzeroSecThemesだけの日でも、「配置できる候補が
   ありません」で終わらせず、タイムラインへ遷移してテーマ提案カード自体を表示することを確認
7. **(should-fix2)** 「タスク名: 理由」形式のMIT候補行は、コロン(半角/全角)より前のタスク名
   部分だけが候補行に採用され、コロンより後の理由文言は候補として混入しないことを確認
   (コロン無しの行は従来どおり全文が候補になることも合わせて確認)

既存 `tests/v71.test.js` の [5][6] は 1.4 の理由で判定スコープを更新済み(検証意図は無変更)。

### should-fix対応で追加判明した実装バグ(`extractMITCandidatesFromReport`)

should-fix2のテスト([7])を実データに近い形式(見出し直後に空行を挟む
`"## 明日への提案\n\n- ..."`)で書いたところ、既存ループが最初の空行で即 `break` していたため
候補が一切抽出されないことが判明した。`loop/coach-daily.sh` の実出力は見出しと箇条書きの間に
必ず空行が入るため、この不具合を残したままでは1.3で追加した「明日への提案」見出し対応が
実データに対して機能しない状態だった。見出し直後の空行はスキップし、本文(箇条書き)が
始まった後の空行でのみ終端するよう修正した(該当箇所のコメントに経緯を明記)。

- `node --check app.js` / `node --check sw.js` / `node --check tests/v75.test.js`: いずれもOK
- `node tests/v75.test.js` 単体: ALL PASS
- 全量 `npm test`(23スイート、v75含む)フォアグラウンド実行で **ALL PASS**(exit code 0)を確認済み

---

## 変更ファイル

- `app.js`
  - `normalizeState`: `zeroSecThemeLog` の後方互換デフォルト補完を追加
  - `extractMITCandidatesFromReport`: 見出し判定に「明日への提案」を追加、チェックボックス表記の
    除去、**(should-fix1)** 「タスク名: 理由」形式はコロンより前のタスク名だけを候補にする、
    **(should-fix対応で判明したバグ修正)** 見出し直後の空行で即断していたループを、見出し直後の
    空行はスキップし本文開始後の空行でのみ終端するよう修正(実データの「見出し+空行+箇条書き」
    形式で候補が0件になっていた)
  - `homeAiHubBody`/新設 `homeAiFeedbackReadHTML`: 「AIから」カードにフィードバック本文の
    既定closed読み取りセクションを追加
  - `renderReports`: 前日AIフィードバックの既定closed表示を追加
  - 新設 `_zeroSecThemeDraft`(モジュール変数)・`fetchZeroSecThemes`・`zeroSecThemeBarHTML`・
    `decideZeroSecTheme`・`ZERO_SEC_THEME_LOG_MAX`・**(should-fix2)** 新設
    `showZeroSecThemesOnlyIfAny`(スケジュール側が候補0件で早期returnする3箇所すべてに適用し、
    zeroSecThemesがあればタイムラインへ遷移・専用トーストを出すよう変更)
  - `runAiMorningPlan`: 冒頭で `fetchZeroSecThemes` を呼び `_zeroSecThemeDraft` を更新
  - クリックイベント委譲に `zerosec-theme-add`/`zerosec-theme-skip` を追加
- `sw.js`(`CACHE_NAME` を `v74` → `v75`)
- `tests/v75.test.js`(新規)
- `tests/v71.test.js`(1.4の理由で[5][6]の判定スコープを更新)
- `CHANGES_v75.md`(本ファイル)
- `../taskchute-notes/handoff.md`(notes リポジトリ側、本エントリ追記)

---

## 実機テスト手順

1. `sw.js?nocache=YYYYMMDD` を開き、1行目が `taskchute-journal-pwa-v75` になっていることを確認する。
2. ホームタブの「AIから」カードで、「🤖 AIフィードバックを読む」をタップして開き、当日/前日の
   コーチングフィードバック本文が読めることを確認する。
3. 日報タブを開き、「🤖 前日のAIフィードバックを見る」が既定closedで出て、タップで前日分が
   読めることを確認する。
4. `loop/plan-daily.sh` が `zeroSecThemes` を含む `AIプラン_YYYY-MM-DD.json` を生成した日に
   「🌅 朝プラン」を実行し、タイムライン上部に「🧠 0秒思考のテーマ提案」カードが出ることを
   確認する。「＋ 0秒思考リストに追加」を押して0秒思考タブに反映されること、「見送り」でカードから
   消えて0秒思考リストには追加されないことを確認する。

## 確認サイン

- [ ] 実機(iPad/iPhone)で上記手順を確認
- [ ] 確認者:
- [ ] 確認日:
