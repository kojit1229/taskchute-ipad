# CHANGES v67

## 概要

`../taskchute-notes/designs/v67-plus-claude-vision.md` のv67(2本柱)のうち、**アプリ側**分を
実装した。柱1(b) AI連携の鮮度インジケータ、柱2 AI作業ワーカー連携のアプリ側(aiWorkフラグ +
AI作業結果_YYYY-MM-DD.json の取り込み表示)。バッチ側(`loop/ai-work.sh`・`pipeline-health-check.sh`
等)は別セッションで並行実装中で、本変更のスコープ外。契約(AI作業結果_*.jsonのスキーマ)は
設計書と本変更が正であり、変更していない。アプリ内Claude API呼び出しは追加していない(v60方針を
維持)。

- **AI連携の鮮度インジケータ(柱1b)** — ホームに「AI連携: フィードバック○日前 / プラン○日前」の
  1行ステータスを追加。`state.aiLinkFreshness`に最後に取得成功した日付(`feedbackAt`/`planAt`)を
  記録し、経過日数を都度計算する(実データ保存はせず、v56の`state.feedbackFiles`と同じ「日付の
  記録だけ持つ」思想)。どちらかが3日以上(または一度も届いていない)なら、既存の
  `syncDotClass()`/`renderSyncBanner()`と同じ静かな見た目(責める色は使わない)で
  「AI連携が止まっているかも。PCのタスクスケジューラを確認」を表示する。
- **aiWorkフラグ(柱2アプリ側)** — WBSタスクに`aiWork`(bool)+`aiWorkBrief`(1〜2行、16px)を
  追加。編集モーダルにトグル+briefテキストエリア、WBS一覧に控えめな🤝マークを表示する。
  既存の`autoSync`(app-state.json自動push)が自然にバッチへ届けるため、追加の送信処理は無い。
- **AI作業結果の取り込み(柱2アプリ側)** — 当日の`AI作業結果_YYYY-MM-DD.json`をAIプランと同じ
  流儀(同一オリジンfetch・sw.jsのnetwork-first対象)で取得し、ホームに「AIが処理した作業」
  カードを表示する。`completed`は「実績として登録」ボタンのワンタップ承認(自動登録はしない —
  K指示「最終判断はK」に合わせる)、`blocked`は既存`state.questions`(v39)への橋渡し、`queued`は
  表示のみ。処理済みresultIdを`state.aiWorkProcessedIds`に記録し二重登録を防ぐ。

## 変更内容(app.js)

### 1. AI連携の鮮度インジケータ

- **`normalizeState`**: `value.aiLinkFreshness = { feedbackAt: null, planAt: null }`を後方互換
  補完(既存値優先)。
- **`hydrateStaticMarkdown`**: 「今日を見ているとき」のfeedback fetch成功時のみ
  `aiLinkFreshness.feedbackAt`を前進更新(過去日ブラウズ中のfetchは対象外 — その日の閲覧目的で
  あり、パイプライン鮮度とは無関係なため)。新設`fetchAiPlanFreshnessDate(date)`で
  `AIプラン_<今日>.json`の存在確認のみを行う軽量fetch(下書きへの適用はしない。
  `tryFetchAiPlan`/`runAiMorningPlan`の専管を侵さない)を追加し、`planAt`を更新する。
  鮮度フィールドの更新はローカル保存のみ(`persistLocalNoSchedule`)とし、`saveState`
  (autoSyncのpush対象)にはしない(端末をまたいだ鮮度比較は現状不要で、過剰なpushを避ける)。
  `changed`時の再描画対象ビューに`"home"`を追加。
- **`aiFreshnessLine()`**(新規): `state.aiLinkFreshness`から経過日数を算出し、1行ステータス+
  (該当時)注意バナーのHTMLを返す。`daysBetween`(既存ヘルパー)を再利用。
- **`renderHome`**: `renderDateBar()`の直後に`aiFreshnessLine()`を追加。

### 2. aiWorkフラグ

- **`normalizeState`**: `value.tasks`のmapに`aiWork: false`/`aiWorkBrief: ""`のデフォルトを追加
  (既存値優先。v65/v66の同種フィールド補完と同じ場所・同じ思想)。
- **`makeTask`**: 新規Task作成時の既定値にも同フィールドを追加。
- **`buildTaskModal`**: レバレッジ(10x機構)フィールドの直後に「🤝 AI作業ワーカー連携」の
  チェックボックス+briefテキストエリア(`style="min-height:48px; font-size:16px"` —
  iOS Safariの自動ズーム防止ルールを明示的に満たす)を追加。
- **`saveTaskFromModal`**: 新規作成・編集の両パスで`aiWork`/`aiWorkBrief`を保存する。
- **`renderTaskRow`**: `leverageTypeMarkHTML`の直後に、`task.aiWork`がtrueなら🤝マーク
  (`title`属性にbriefがあれば併記)を追加。

### 3. AI作業結果の取り込み

- **`normalizeState`**: `value.aiWorkProcessedIds = []`を後方互換補完(処理済みresultIdの記録先)。
- **`hydrateAiWorkResults()`**(新規): 当日の`AI作業結果_<today>.json`をfetch・JSON検証し、
  `{resultId, taskId, title, status, summary, outputPath, minutes}`の配列を非永続の
  `cachedAiWorkResults`(モジュールレベル変数)へ格納する。`resultId`は`taskId`(無ければ
  配列index)+日付で合成し、二重登録防止の照合キーにする。status不正な要素はスキップする。
- **`hydrateStaticMarkdown`**: 上記を呼び出し、変化があれば`changed`扱いにする(home再描画)。
- **`pendingAiWorkResults()`**(新規): `cachedAiWorkResults`から`state.aiWorkProcessedIds`
  済みを除いた未処理分を返す。
- **`approveAiWorkResult(resultId)`**(新規): `completed`のワンタップ承認。
  `computeFreeGaps`(既存・v59)で当日の空き時間を探し、無ければ現在時刻付近を使う
  (設計注記どおり厳密な衝突検知はしない)。`makeBlock`でカテゴリ"AI作業"・`completed: true`・
  指定`minutes`の実績Blockを作成し、`taskId`があれば紐づくTaskも`status: "completed"`にする。
  `resultId`を`markAiWorkResultProcessed`で記録してから`saveAndRender`。
- **`raiseAiWorkQuestion(resultId)`**(新規): `blocked`の質問を、既存`makeQuestion`
  (v39)で`origin: "ai"`の問いとして`state.questions`へ積む。
- **`aiWorkResultRowHTML(r)`**/**`homeAiWork(isToday)`**(新規): ステータス別の行HTML
  (completed=承認ボタン、blocked=質問文+ボタン、queued=表示のみ)とホームカード本体。
  未処理が無ければ静かに非表示。
- **クリックハンドラ**: `ai-work-approve` → `approveAiWorkResult`、`ai-work-question` →
  `raiseAiWorkQuestion` を追加。
- **`renderHome`**: `homeIdeal`の直後に`homeAiWork(isToday)`を追加。

## 変更内容(styles.css)

- `.ai-freshness-line`/`.ai-freshness-dot`(`.ok`/`.warn`): 鮮度インジケータの1行表示とドット。
  `.sync-dot`と同じ思想だが、v67設計書の指示どおり別クラス名にした(git同期とAI連携は別の鮮度
  シグナルのため)。
- `.ai-freshness-banner`: 注意バナー専用のクラス。**当初`.sync-banner`と併用したが、
  `renderSyncBanner()`が`document.querySelector(".sync-banner")`で最初に見つけた要素を無条件に
  `remove()`する実装だったため、`_syncBanner`(git同期のバナー文言)がnullの通常時に自分自身が
  誤って毎回削除される競合が発生した**(テストで発覚)。独立クラスにして`.sync-banner`と同じ
  見た目のCSSを複製することで解消した。
- `.ai-work-flag`/`.ai-work-row`/`.ai-work-row-main`/`.ai-work-title`/`.ai-work-summary`:
  WBS一覧の🤝マークと、ホーム「AIが処理した作業」カードの行レイアウト(`.home-due`と近い構造)。

## 変更内容(sw.js)

- `CACHE_NAME`を`taskchute-journal-pwa-v66`→`taskchute-journal-pwa-v67`に更新。
  `AI作業結果_*.json`は既存の「.jsonはnetwork-first」ルール(v62で`AIプラン_*.json`のために
  導入済み)にそのまま乗るため、sw.js側の追加変更は無い。

## 実装判断(仕様から補った点)

1. **AI連携鮮度の更新は「今日を見ているとき」のfetchのみを対象にした**: 監督者指示は
   「最後に取得成功した...の日付から算出」だったが、`hydrateStaticMarkdown`は過去日ブラウズ中
   にもその日のフィードバックをfetchする(既存v42由来の挙動)。これをそのまま鮮度シグナルに
   使うと、過去日を見ただけでパイプラインが健全に見えてしまう誤検知が起きるため、
   `state.selectedDate === todayISO()`のときのfetch結果だけを鮮度更新の対象にした。
2. **AIプランの鮮度は専用の軽量fetchを新設した**: `tryFetchAiPlan`は`runAiMorningPlan`
   (ユーザー操作 or `autoMorningPlan`設定がONの場合のみ)経由でしか呼ばれず、K宅の既定設定
   (`autoMorningPlan`はopt-in・既定OFF)では鮮度シグナルがほぼ更新されない懸念があった。
   下書き適用とは独立した`fetchAiPlanFreshnessDate(date)`(存在確認のみ、項目検証はしない)を
   `hydrateStaticMarkdown`から常時呼ぶことで、morning planを使わない運用でも鮮度が機能するように
   した。
3. **鮮度フィールドの更新はautoSyncのpush対象にしなかった**: 端末をまたいだ鮮度比較(K宅PC/iPad
   間で「いつ最後に届いたか」を同期する)は現時点で要件になく、鮮度は「取得した端末が知って
   いれば足りる」ローカル情報と判断した。`saveState`ではなく`persistLocalNoSchedule`を使い、
   `dataModifiedAt`も汚さない・不要なpushも起きないようにした。
4. **一度も届いていない(null)場合も「注意」扱いにした**: 設計書は「3日以上途絶えたら」とだけ
   書いており、未取得(null)の扱いは明記が無かった。未取得を「鮮度不明=OK」扱いにすると、
   v67導入直後や新規デバイスで実際には正常なのに警告が出ない盲点になるため、null も
   「まだ届いていません」+注意扱いとした(実際にはK宅の既存フローで初回読み込み時にすぐ
   `feedbackAt`/`planAt`が埋まるため、警告が長時間出続けることは想定していない)。
5. **AI作業結果のresultIdはtaskId基準で合成した**: 権威スキーマに`id`フィールドが無いため、
   `taskId`(無ければ配列index)+日付で二重登録防止キーを作った。同日内で同じtaskIdの結果が
   複数回来る想定はしていない(バッチ側の1日2回実行は別タスクを処理する前提。同一taskIdの
   再処理が要件化した場合は別途調整が必要)。
6. **実績Blockの配置時刻は「空き時間があれば先頭、無ければ現在時刻付近」とした**: 設計書の
   「当日の適当な空き時刻でよい」という指示どおり、既存Block・予定との厳密な衝突検知は
   行っていない(`computeFreeGaps`の既定範囲5:00〜23:00のみ利用)。
7. **【レビュー対応】`tests/v67.test.js`はAIプラン_*.json / AIフィードバック_*.md /
   週次レビュー_*.mdへのfetchを`page.route`で常に404にルーティングする**: このリポジトリには
   本番バッチ(`plan-daily.sh`等)が実際に`AIプラン_<今日>.json`を日次でcommitするため、
   `page.reload()`起動時の`hydrateStaticMarkdown`がその実ファイルを検出して`planAt`(場合により
   `feedbackAt`)を前進させてしまい、「未取得(null)」を前提にしたシナリオ(normalizeStateの
   鮮度補完テスト)が実行日によってはREDになる環境依存があった(Codexレビュー指摘)。
   `AI作業結果_<今日>.json`は本スイートが自前でファイルを書き/消して制御するため
   ルーティング対象から除外し(実際の取り込み表示の検証はそのまま本物のfetchで行う)、他の3種
   だけを遮断することで「リポジトリに実ファイルが有っても無くてもGREEN」にした。

## テスト

- `tests/v67.test.js`(新規)。以下を検証する:
  1. normalizeState後方互換: 旧Task(`aiWork`/`aiWorkBrief`無し)に`false`/`""`が補完される。
     旧state(`aiLinkFreshness`/`aiWorkProcessedIds`フィールド自体が無い)にも既定値が補完される
  2. Task編集モーダルで`aiWork`トグル+`aiWorkBrief`を保存でき、WBS一覧に🤝マークが出る
  3. AI連携鮮度: 両方新しければ注意バナー無し・テキストに経過日数(「今日届いた」等)が出る
  4. AI連携鮮度: フィードバックが3日途絶えると注意バナーが出る(責めない文言を確認)
  5. AI連携鮮度: 2日前(閾値未満)は注意バナーが出ない(境界値)
  6. AI連携鮮度: 未取得(null)も「まだ届いていません」+注意バナーになる
  7. AI作業結果_<今日>.jsonの3ステータス(completed/blocked/queued)がホームカードに正しい
     UI(承認ボタン/質問ボタン/表示のみ)で並ぶ
  8. completed: 「実績として登録」ワンタップで実績Block(カテゴリ"AI作業"・completed:true・
     指定minutes)が作成され、紐づくTaskも完了化される
  9. blocked: 「質問として積む」でstate.questionsにorigin:"ai"の問いが追加される
  10. 二重登録防止: 承認/質問済みのresultIdはstate.aiWorkProcessedIdsに記録され、リロード後
      (同じ結果ファイルを再fetchしても)再表示されない(実績Block・questionsの二重作成も無い)
- 開発中は`node tests/v67.test.js`または`node tests/run-all.js v67`で単独実行して確認。
- 【再取得結果】Codexレビュー指摘(F1)対応後、実際にリポジトリ直下へ本番バッチが生成した
  `AIプラン_2026-07-10.json`が存在する状態で`node tests/run-all.js v67`を実行し、全10シナリオ
  ALL PASSを確認。続けて同じ状態で全量`npm test`(`node tests/run-all.js`)を実行し、
  **16スイート全てALL PASS**を確認済み(v67以外のスイートに機能的な影響なし)。
  なお`tests/v62.test.js`/`tests/v65.test.js`は独自に`AIプラン_<実行日>.json`を一時生成し
  `finally`で削除する既存の仕組みを持つため、実行日が今日(バッチが実ファイルを置いた日付)と
  一致すると、テスト終了後にその実ファイルが作業ツリーから一時的に消える副作用が確認できた
  (テスト自体の合否には影響しない)。今回はテスト実行のたびに`git checkout -- "AIプラン_<日付>.json"`
  で復元して収めたが、これはv67より前から存在する別の環境依存であり本タスクのスコープ外
  (app.js変更不要の指示どおり不変更)のため、v62/v65側の対応要否は別途監督者判断を仰ぐ。

## 変更ファイル

- `app.js`
- `styles.css`(`.ai-freshness-*` / `.ai-work-*`)
- `sw.js`(`CACHE_NAME`を`v66`→`v67`)
- `tests/v67.test.js`(新規)
- `CHANGES_v67.md`(本ファイル)
- `../taskchute-notes/handoff.md`(notes リポジトリ側、本エントリ追記)

## 実機テスト手順

1. `sw.js?nocache=YYYYMMDD`を開き、1行目が`taskchute-journal-pwa-v67`になっていることを確認。
2. ホーム画面上部に「AI連携: フィードバック○日前 / プラン○日前」の1行が出ることを確認する。
   PCの自動化が数日止まった状態(または`state.aiLinkFreshness`を古い日付にして検証)で、
   「AI連携が止まっているかも。PCのタスクスケジューラを確認」の控えめなバナーが出ることを
   確認する(タップで設定画面へ遷移)。
3. WBS/タスクシュートでTaskを編集し、「🤝 AI作業ワーカー連携」をONにしてbriefを入力→保存。
   WBS一覧にそのTaskの🤝マークが出ることを確認する。
4. 自宅PC(または手動配置)で当日の`AI作業結果_YYYY-MM-DD.json`をリポジトリ直下に置き、
   ホームに「AIが処理した作業」カードが出ることを確認する。`completed`の「実績として登録」を
   押すと、タイムライン/タスクシュートに実績(カテゴリ"AI作業")が現れ、紐づくTaskが完了に
   なることを確認する。`blocked`の「質問として積む」を押すと、0秒思考タブの「問い」に
   AIからの質問が追加されることを確認する。`queued`は「承認待ち」表示のみでボタンが無いことを
   確認する。
5. 4を実行後、一度リロード(または再起動)しても、承認/質問済みの項目がカードに再表示されない
   ことを確認する(二重登録防止)。
6. 既存のWBS/タスクシュート/タイムライン/朝プラン/週次レビュー/レバレッジ台帳の他機能
   (v39〜v66)の動作が壊れていないことを一通り確認する。

## 確認サイン

- [ ] 実機(iPad/iPhone)で上記手順を確認
- [ ] 確認者:
- [ ] 確認日:
