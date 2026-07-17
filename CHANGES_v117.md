# CHANGES v117

## 概要

K承認済み案件を3機能まとめて実装(v117一本)。
(A) 今日の宣言(ホーム画面の1行宣言+日報連携)、(B) 自己締切の自動前倒し(タスクの表示上の
締切をdueDateの2日前へ前倒しし、期日ぎりぎりの着手を防ぐ)、(C) 過集中ブレーカーのゲート化
(PC側のWeb Push通知が見られなかった反省から、Block完了という「手が止まる瞬間」にアプリ内
モーダルで保護系ルーティンの未実行を気づかせる)。
SW `CACHE_NAME` を v116 → v117 に更新。

## 変更内容

### 機能A: 今日の宣言

- `state.dailyDeclarations = { "YYYY-MM-DD": { text, updatedAt } }`を新設(`normalizeState`)。
  v87の作業単位宣言ログ`state.declarations`とは別物(名前衝突回避)。
- ホーム画面(`homeDeclarationCard`)に1行入力カードを追加。`renderHome()`内、`homeIdeal`
  (今日の理想)の直後・`homeReadingCard`/`homeHero`(いまこれ)より上に配置。
  `selectedDate`ごとに編集可能(過去日の宣言も見返せる)。change時に保存(`document.addEventListener
  ("change", ...)`へ`data-declaration-date`ハンドラを追加)。
- 赤警告は「今日を見ていて未入力」の時だけ(過去日を振り返っている時は出さない)。
- v106のマージ可能コレクション(`computeSyncMerge`/`applySyncMergeToLocal`/`applySyncMergeToRemote`)
  へ`dailyDeclarations`を追加。既存の`mergeSleepLogMaps`(updatedAtタイムスタンプ比較)と同じ
  パターンを踏襲(`mergeDailyDeclarationMaps`)。
- `generateReport()`に`## 📣 今日の宣言`節を追加。挿入位置は理想ワンライナーの直後・
  「## 1. サマリ」の前。**理想ワンライナーと異なり未入力日も節自体は省略しない**(本文を
  `(未入力)`にする)契約にした——バッチが未記載を検知できるようにするため(K指示)。

### 機能B: 自己締切の自動前倒し

- Taskに`selfDueOff`(既定false=前倒しON)を追加(`normalizeState`のtasks.map + `makeTask`)。
- `effectiveDueDate(task)`ヘルパーを新設(`addDays`の直後)。dueDate未設定は""、
  selfDueOff=trueならdueDateそのまま、既定(false)ならdueDateの2日前。
- 適用箇所: `homeBacklog`(未完了タスクの表示範囲・ソート・期限切れ判定・締切ラベル)、
  `aiScheduleCandidates`(朝プラン候補の期限フィルタ)、`wbsTaskCompare`(WBSの並び順)、
  `renderTaskRow`(WBS行の期限切れ表示・締切ラベル)。**Wish(kind:"wish"配下のTask)・
  Project自体の期限(projDue)は対象外**(WBSはwishプロジェクトを最初から除外描画するため、
  これらのコードパスに触れていない)。
- 前倒しが効いている(実期日とズレている)時だけ「M/D(実 M/D)」と併記。selfDueOff=trueや
  期限なしの時は実期日のみ表示(従来どおり)。
- タスク編集モーダルにチェックボックス「⏪ 自己締切(期日−2日)」を追加(既定チェックON)。
  UI上は「自己締切が有効か」という正の意味で表示するため、`data-modal-field="selfDueEnabled"`
  という別名フィールドにして保存時に反転させている(`selfDueOff = !fields.selfDueEnabled`)。
  `readModalFields()`(checkbox値をそのまま渡す共通関数)自体は変更していない。
- `app-state.json`の`dueDate`実データは書き換えない(表示・判定だけが前倒しされる)。

### 機能C: 過集中ブレーカーのゲート化

- `pendingProtectionRoutines()`: `state.recurrences`のprotection:trueルールのうち、当日
  完了記録が無いものを返す(v114の`computeProtectionMissedStreak`が使う「dayBlocks.some
  (completed)」と同じ判定パターンを1日分だけ再利用)。
- `maybeOpenHyperfocusGate()`: 90分の頻度ガード(モジュール変数のみ、永続化しない)を通れば
  軽量モーダルを開く。「保護系ルーティンが1件以上残っている」時だけ発火。
- トリガー箇所は3つ: (1) `toggleBlock()`のBlock直接完了(○タップ)直後、(2) `finishReport()`
  の`ctx.kind === "block"`(v70「■いま終了」が終了報告モーダルを解決した直後)、
  (3) `completePomodoro()`の完了確定直後(独立レビュー指摘により追加。このアプリはポモドーロが
  主要な完了導線であるため「Blockの完了操作」に含めるべきと判定された。`completePomodoro()`は
  `state.pomodoro.blockId`のBlockに`completed:true`を直接立てる経路で、`toggleBlock`/
  `finishReport`のどちらも経由しないため、`saveAndRender()`直後に`blockId`があれば
  `maybeOpenHyperfocusGate()`を呼ぶ最小差分を追加した。90分ガード・当日判定など既存ロジックは
  無改修でそのまま効く)。
  **タスク完了チェック・一括承認・チェーンのステップ完了など他の完了経路には意図的に
  フックしていない**(スコープを「単一Blockを明示的に完了させる主要3導線」に絞った。
  詳細は下記「未対応・懸念点」参照)。
- モーダル内: 縮退版(`fallbackTitle`)が設定されたルーティンは既存の`executeRoutineFallback`を
  再利用したワンタップ実行ボタン、無ければ`makeRecurrenceInstance`を再利用した「Block作成」
  ボタン(**完了はさせない**——完了の偽装をしない、というK指示どおり)。下部に「あとで」ボタン。
- 「あとで」を押さなくても、モーダルを表示した時点で90分の抑止を開始する(表示だけで何も
  しなかった場合も同じ扱いでよい、という解釈)。

### sw.js

`CACHE_NAME`を`taskchute-journal-pwa-v117`に更新。

### loop側

- `loop/scripts/daily-report-fallback.py`: `## 📣 今日の宣言`節を同位置(タイトル直後・
  サマリ前)で追加。`dailyDeclarations[date]`が無い/空でも例外にせず`(未入力)`を出す。
  合成データ(宣言あり/なし)で手動実行し、両パターンの出力を確認済み(下記「検証」参照)。
- `loop/FORMAT_CONTRACT.md`: 突合表に`## 📣 今日の宣言`行を追加+「2026-07-17で変更した
  もの」節を新設(挿入位置の理由・省略しない契約・daily-review.mdの参照要否を記録)。
- `loop/coach/daily-review.md`: 観点6(意図と結果のズレ)に「今日の宣言との突合」を追記。
  日報の宣言内容と実績を突合し着手できたかに触れる、未入力日は責めないトーンで気づきとして
  伝える、達成が続いていれば認める、をK指示どおり明記。

## テスト実行時の副作用(既存スイートへの影響と対応)

機能Cのゲート追加により、既存の`toggle-block`完了フローに新しいモーダルが割り込みうるように
なったため、以下2件の**既存**スイートに影響が出た(いずれもFeature A/B/Cの主題ではない):

- `tests/v115.test.js`: セクション[3](アンカー配置)で「歯磨き」Blockを`toggle-block`で
  完了させる際、protection:trueの「読書」(縮退版未設定)が未実行のまま残っているため、
  仕様どおりゲートモーダルが開く。このスイートの主題ではないため、開いていれば「あとで」で
  閉じてから続行するよう1ブロック追加した(既存のアサーションは1つも変更していない)。
- `tests/v67.test.js`: セクション[10](AI作業結果の二重登録防止、リロード後の検証)が、
  固定600ms待ちに起因する既存の環境依存flakeを持っていた(このサンドボックス環境では
  reload後の2段階render — cachedAiWorkResults未取得の1回目→fetch完了後の2回目 — が
  600ms内に収まらないことがある。**v117変更前のオリジナルapp.jsでも`git stash`で
  再現確認し、同型の失敗が起こり得ることを確認した**。v117のrender対象追加でわずかに
  重くなった分、体感の再現率が上がった可能性はある)。固定待ちをポーリング待機
  (`page.waitForFunction`)に置き換え、アサーション自体は変更せずに解消した。

## 検証

- `node --check app.js` / `node --check sw.js` / `node --check tests/v117.test.js` /
  `node --check tests/v115.test.js` / `node --check tests/v67.test.js` すべてexit 0。
- `tests/v117.test.js`(新規、303行・32チェック)ALL PASS:
  (a)宣言カードの表示・change保存・赤警告の出現(今日・未入力)/消灯(入力後)・過去日での
  非表示、(b)日報生成での節出力(入力あり/未入力「(未入力)」)、(c)effectiveDueDateの
  -2日前倒し・selfDueOff時の無効化・WBS行の期限切れ判定と締切ラベル併記・編集モーダルの
  チェックボックス保存反映、(d)ゲートの表示条件(未実行あり/全実行済みで非表示)・
  「Block作成」ボタンの非完了生成・縮退版ワンタップボタン・「あとで」による抑止フラグ・
  **ポモドーロ完了でもゲートが開くこと(独立レビュー指摘対応、追補)**。
- `node tests/run-all.js v117 v115` ALL PASS(exit 0、独立レビュー指摘対応後の再検証)。
- `npm run test:core`相当(直近5件+固定コア5件、計10スイート)を4バッチに分割して
  フォアグラウンド実行、全バッチALL PASS(exit 0): v113/v114/v115/v116/v117/v50/v59/v67/v70/v72。
  v115・v67は上記の理由でテストファイル側に軽微な修正を加えた上でのPASS(app.js側の実装を
  弱めた修正は一切していない)。
- `daily-report-fallback.py`は合成データ2パターン(宣言あり/dailyDeclarations空)で手動実行し、
  両方とも`## 📣 今日の宣言`節が正しい位置・内容で出力されることを確認した。

## 未対応・懸念点

- 機能Cのゲートは「Blockの直接完了(○タップ)」「■いま終了→終了報告モーダル解決後」
  「ポモドーロ完了」の3経路にフックした(3経路目は独立レビュー指摘を受けて追加)。
  タスク完了チェック(`toggleTaskCompleteFromBlock`)・一括承認(`bulkApproveAsPlanned`)・
  ゼロ摩擦一括チェック(`bulkCheckRoutinesUpToNow`)・チェーンのステップ完了
  (`completeRoutineForToday`経由)には引き続き意図的にフックしていない。理由: 前者3つは
  複数Block一括処理系であり、都度ゲートを出すと連打的な体験になり得るため。チェーン完了は
  保護系ルーティン自身を完了させる経路であり、そこでゲートを出すと自己言及的になり得ると
  判断した。この判断はレビューで見てほしい。
- ゲートの90分抑止は「表示した時点」を起点にしている。「あとで」を押さず放置してモーダルが
  画面に残ったまま次の操作をした場合の挙動(閉じずに別画面へ遷移する等)は、closeModal()の
  既存の背景クリック/×ボタンに委ねており、v117独自の追加検証はしていない。
  時間経過(90分)そのもののモック検証はしていない(spec許容の「抑止フラグの単体確認」に留めた)。
  実際に90分経過後に再表示されるかは、時計を進めるテストが無いため未検証。
  (`_hyperfocusGateSuppressedUntil`の値自体はテストから直接読めない=モジュール内let変数の
  ため、状態遷移の外形からのみ確認している。)
- 機能Bの前倒しはWBS・ホームの未完了タスクパネル・朝プラン候補フィルタにのみ適用した。
  横断検索・週次レビュー・12週サイクルレビュー等、他にもdueDateを参照する画面がある可能性が
  あり、そこまでは洗い出していない(指示された行番号ヒントの範囲に絞った)。
- `tests/v115.test.js`・`tests/v67.test.js`への修正は、機能Cとの相互作用/既存の環境依存flakeへの
  対応であり、両ファイルとも既存のアサーション内容は一切変更・削除していない(これは事実として
  確認済み。差分は「モーダルが開いていれば閉じる」「固定待ちをポーリング待機に置換」の2箇所のみ)。
- 本コミット群はローカルcommitのみでpushしていない(指示どおり。監督者レビュー後にpush予定)。
