# CHANGES v62

## 概要

ROADMAP(`../taskchute-notes/ROADMAP.md`)v62(朝プランをAI計画ファイルへ発展させる)を実装した。
バッチ側(`loop/plan-daily.sh` / `loop/weekly-review.sh`、いずれもリポジトリ外スコープで実装済み)が
リポジトリ直下へpushする `AIプラン_YYYY-MM-DD.json` / `週次レビュー_YYYY-MM-DD.md` を、アプリ側
(v57のバッチ→GitHub→fetchパターン)で着地させる。**アプリ内Claude API呼び出しは追加していない**
(v60方針を維持。搬入経路は引き続き「バッチ生成ファイル→GitHub→fetch」のみ)。

- **AIプランのアプリ側着地** — 朝プラン(`runAiMorningPlan`)は、まず当日の `AIプラン_日付.json` を
  同一オリジンfetchし、構造検証+現在状態との整合性チェックを通ったものだけ下書きに採用する。
  取得失敗・不正・古い(状態とズレている)場合は既存の決定論配置(v60)へ無傷でフォールバックする。
- **下書きUndo・却下理由メモ** — 下書きレイヤ操作(×削除・ドラッグ移動/リサイズ)の直前状態への
  1段Undoと、×直後の却下理由ワンタップ選択(今日は無理/価値が薄い/時間帯が合わない/その他)を追加。
- **週次レビューのアプリ内表示** — 週次レビュータブに「AI週次レビュー」セクションを追加。直近土曜の
  `週次レビュー_*.md` を表示し、「来週のタスク提案」は1行ずつ「+登録」でWBSへ登録できる
  (一括登録はしない。Kの指示どおり最終判断は1件ずつ)。
- **ホーム信条の実データ化** — `homeCreed()` のハードコード標語を、`Daily_Affirmation.md` v4.1と
  整合する実データ裏付け型の3行(MIT達成率100%・実行率と充電の無相関・朝型)に更新。

## 変更内容(app.js)

### 1. AIプラン_日付.json のアプリ側着地

- **`tryFetchAiPlan(date, freeGaps)`**(新規、async): `./AIプラン_${date}.json` を同一オリジン
  fetchし、以下をすべて通った場合のみ `{ items, skipped }` を返す。1つでも壊れていれば `null` を
  返し、呼び出し元は決定論配置へフォールバックする。
  1. fetch成功(404含む取得失敗は即 `null`。`fetchText` の既存仕様どおり静かに空文字を返す)
  2. JSONとしてパース可能
  3. トップレベルがオブジェクトで `plan`/`skipped` が配列
  4. **`date` フィールドが当日と一致**(取り違え・古いファイルの取り違え防止)
  5. `plan` 各項目の `title`/`start`("HH:MM")/`minutes`(1〜600の整数)が型として正しい
  6. `carryFromId` を持つ項目は、参照先Blockが存在し・未削除・**`migratedTo` 未設定**(=まだ
     繰り越されていない)ことを確認する。v61の二重繰越防止セマンティクスをAIプラン経由でも
     維持するための追加チェックで、条件を満たさない項目だけを不採用にする(プラン全体は活かす)
  7. `taskId` を持つ項目は、参照先Taskが存在し・未削除・未完了であることを確認する(同様に
     個別不採用)
  8. 採用できた `items` が1件もなければ `null`(決定論へフォールバック)
  9. **空き時間(`freeGaps`)との整合性(レビュー対応で項目単位のドロップに変更)**: 各項目が
     現在の空き枠に収まっているかを個別に確認する。過去時刻になった・既存Blockと衝突した
     項目だけを不採用にし(プラン全体は活かす)、`skipped` に `{ title, reason: "", kind:
     "expired" }` として積む。下書きバー下に「時間切れで除外: タイトル」として表示し、判断を
     透明化する。採用可能な項目が1件も残らない場合のみ `null`(決定論へフォールバック)
- **`runAiMorningPlan()`**(async化): まず `tryFetchAiPlan()` を試し、成功すれば
  `_scheduleDraft = { date, items, skipped, source: "ai-plan" }` として下書きに採用する。
  失敗時のみ、v60までの決定論配置(`aiMorningPlanCandidates` → `fallbackMorningPlan`)を実行し
  `source: "deterministic"` を付けて下書きに採用する。**決定論配置のロジック自体は無改修**。
- **`maybeAutoMorningPlan()`**: `runAiMorningPlan` の async化に伴い、`.catch()` でも例外を
  握りつぶすよう変更(同期try/catchだけでは非同期rejectを拾えないため)。

### 2. 下書きの出どころ区別(source)

- `_scheduleDraft` に `source`("ai-plan" | "deterministic")を追加。`runAiSchedule()`
  (②の即時下書き。常に決定論)にも `source: "deterministic"` を付与。
- `draftBarHTML()` に「🤖 AIプラン由来」/「⚙ 決定論配置」のラベルを追加(下書き件数の隣)。
- `recordScheduleHistory(item, outcome, date, source, reason)` にパラメータを追加し、
  push した `entry` オブジェクト自体を返すよう変更(却下理由をあとから紐付けるため)。
  `confirmScheduleDraft` / `draft-discard` / `draft-remove` の全呼び出し箇所で
  `_scheduleDraft.source` を渡すようにした。

### 3. 下書きUndo(1段)

- `_draftUndo`(非永続)を追加。`snapshotDraftForUndo(historyEntry)` が `_scheduleDraft` の
  ディープコピーを退避する。呼び出しタイミングは2箇所:
  - `draft-remove` クリック時(削除直前。この時記録した `aiScheduleHistory` の `removed`
    エントリ自体も `_draftUndoHistoryEntry` として一緒に退避する)
  - `pointerdown`(ドラッグ開始時。移動・リサイズ両方に共通。`historyEntry` は渡さない)
- `draftBarHTML()` に「↩ 元に戻す」ボタンを追加(`_draftUndo` がある時だけ表示)。
  `draft-undo` アクションで `_scheduleDraft = _draftUndo; _draftUndo = null;` として復元する。
- **（レビュー対応 m2）Undo時に `aiScheduleHistory` の二重計上を防止**: 削除操作由来のUndo
  (`_draftUndoHistoryEntry` が非null)なら、その削除で積んだ `removed` エントリを
  `state.aiScheduleHistory` から取り除いてから復元する。これをしないと「削除→Undo→確定」で
  同じ提案に対し `removed` と `confirmed` の両方が記録され、v64のAI学習データ(採否実績)が
  汚れる。却下理由ピッカーが同じエントリを参照していた場合はピッカーも畳む。
- `draft-discard`(下書き全体の破棄)・新規下書き作成(`runAiSchedule`/`runAiMorningPlan` の
  両分岐)・`confirmScheduleDraft`(確定完了時)では `_draftUndo`/`_draftUndoHistoryEntry` を
  クリアする(下書き自体が消える、または新しいセッションが始まるため、前のUndoを持ち越さない)。

### 4. 却下理由のワンタップ選択

- `_pendingRejectReason`(非永続、`{ title, entry }`)を追加。`draft-remove` は**削除自体は
  即座に完了させたまま**(既存のクリック1回での削除挙動を変えない)、削除直後に軽量な
  非ブロッキングピッカー(`draftRejectReasonPickerHTML()`、モーダルにはしない)を表示する。
- 4択(今日は無理/価値が薄い/時間帯が合わない/その他)+「閉じる」。理由を選ぶと
  `recordScheduleHistory` が返した `entry.reason` に直接書き込む(選ばなければ空文字のまま)。
- `renderTimelineView()` に `draftRejectReasonPickerHTML()` を追加(`draftBarHTML()` の直下)。

### 5. 週次レビュー_*.md のアプリ内表示

- `hydrateStaticMarkdown()` に週次レビューのfetchを追加(既存のVision/Daily_Affirmation/
  AIフィードバックと同じ関数に相乗り)。直近土曜(`weekStartFor(todayISO())`)1件のみ、
  無ければ404を静かに無視する(`fetchText` の既存仕様)。同じ週の再fetchはしない
  (`cachedWeeklyReviewMd` にキャッシュ)。
- `splitWeeklyReviewMd(md)`(新規): 「## 来週のタスク提案」節から `- [ ]` 行を抜き出し、
  それ以外の本文は通常の `renderMarkdown()` に渡せる形へ分離する。
- `aiWeeklyReviewSectionHTML()`(新規): 週次レビュータブに「AI週次レビュー」セクションを追加。
  提案タスクは行ごとに「+登録」ボタンを添えた独自リストで表示する(一括登録はしない)。
  `renderWeekly()` に挿入(「問いの動き」の後、12週サイクルリンクの前)。
- `addWeeklySuggestedTask(week, idx)`(新規): 1行を「その他」Project配下のTask(todo)として
  登録する。`_weeklySuggestRegistered`(非永続Set)で同一セッション内の二重登録を防ぐ
  (登録済みは「+登録」ボタンが「✓ 登録済み」に変わる)。
- **（レビュー対応 m7)見積分数の抽出**: `parseSuggestedTaskTitle()`(新規)が行末尾の
  「(30分)」「(45分)」等(半角/全角括弧どちらも)を正規表現で抜き出し、`estimateMin` として
  登録するTaskへ設定、タイトルからは取り除く。見積表記が無ければ従来どおり `estimateMin: null`
  のまま登録する(表示上の提案文自体は元のまま変更しない。分離するのは登録時のみ)。

### 6. ホーム信条の実データ化

- `homeCreed()` の3行を、`Daily_Affirmation.md` v4.1(実データ裏付け型に刷新済み)と整合する
  文言に更新:
  1. 「決めた一つは、必ずやり切れる(MIT達成率100%)」
  2. 「進んだ量で測る。実行率で自分を裁かない」
  3. 「朝に全部を注ぐ。夜は手放して充電する」

### 7. その他

- `sw.js` の `CACHE_NAME` を `v61` → `v62` に更新。
- **（レビュー対応 m5）`sw.js` の fetch ハンドラで `.json` を network-first に変更**
  (`.md` と同じ扱いに統一。`AIプラン_*.json` が cache-first だと当日分をpushしても端末に
  旧キャッシュが居座り、朝プランに反映されなくなるため)。GitHub API(`api.github.com`)は
  従来どおり SW を経由しないため影響しない。この改修も同じ `v62` の CACHE_NAME に含める
  (未リリースのため version は上げない)。
- **（レビュー対応 m4)`normalizeState` に `aiScheduleHistory` の後方互換補完を追加**:
  既存エントリに `source`/`reason` が無ければ `source: "unknown", reason: ""` を補完する
  (SKILLの「新フィールドは必ずnormalizeStateに後方互換補完を書く」規約への準拠。v62より前の
  エントリはsourceが不明なため `"unknown"` とし、`"ai-plan"`/`"deterministic"` と区別できる
  ようにした)。
- `styles.css` に `.draft-block-reason` / `.draft-reject-picker` /
  `.ai-weekly-suggest*` を追加。

## 実装判断(仕様から補った点)

1. **ホーム信条の見出し/本文の分割**: 指示の3行は1行文だったため、既存の `homeCreed()` の
   `[見出し, 本文]` 2行表示フォーマット(既存3信条と同じ見た目を維持するため)に合わせて、
   句点までを見出し・残りを本文に分割した(例:「決めた一つは、」/「必ずやり切れる
   (MIT達成率100%)」)。連結すれば指示どおりの全文になる。
2. **`blockId` フィールドは完全に未参照**(訂正: 当初「型チェックのみ行う」と記載したが実態と
   異なっていた。`tryFetchAiPlan` は `p.blockId` を一切読んでいない): `plan-daily-validate.py`
   のスキーマには `blockId`(バッチ側の検証用途。既存Blockとの重複チェックに使うのみ)が
   含まれるが、アプリの下書き機構は常に新規Blockを作る設計であり「既存Blockを書き換える」
   概念が無いため、アプリ側では読み捨てている(将来 v64 で活用余地があれば別途検討)。
3. **carryFromId / taskId の参照切れ、freeGaps不整合(過去時刻・既存Blockとの重複)は
   いずれも「項目単位で個別ドロップ」に統一**(レビュー対応で当初の「freeGaps不整合はプラン
   全体を不採用」から変更): 自宅PCバッチ(05:00生成)からユーザーがアプリでfetchするまでには
   時間差があり、一部の項目だけが古くなるケースの方が一般的(全項目が同時に破綻するのは稀)と
   判断した。ドロップした項目は「時間切れで除外: タイトル」として下書きバー下に表示し、
   判断を透明化する。採用可能な項目が1件も残らない場合のみ決定論配置へフォールバックする。
4. **却下理由ピッカーは非ブロッキング**: 「軽量UIで」という指示から、モーダルにはせず
   ×クリックによる削除自体は即座に完了させ、理由選択はあとから追加できる情報として扱った。
   これにより既存の `.draft-remove` クリック=即削除という挙動(`tests/v58.test.js`・
   `tests/v60.test.js` が検証済み)を一切変えずに実装できた。
5. **Undoは削除とドラッグの両方に対応する1段Undo**: 「トースト内『元に戻す』でも、下書きバーの
   Undoボタンでも可(実装しやすい方)」との指示に対し、下書きバーへのボタン追加を選んだ
   (`showToast` は現状プレーンテキストのみでボタンを埋め込む仕組みが無いため)。

## レビュー対応(2026-07-09、条件付き合格 → 対応後push)

コーディネーターのv62レビューで指摘された6点(M1・m2・m4・m5必須、m3・m7)に対応した。

1. **M1: freeGaps不整合を「プラン全体不採用」から「項目単位の個別ドロップ」に変更**
   (`tryFetchAiPlan`)。空き時間に収まらない項目(過去時刻・既存Blockと重複)だけを除外し、
   残った項目で下書きを作る。除外項目は `skipped` に `kind: "expired"` として積み、
   `draftBarHTML()` で「時間切れで除外: タイトル」と表示する(既存の「見送り: 」ラベルとは
   区別)。採用可能な項目が0件の場合のみ決定論フォールバックへ。`tests/v62.test.js` に
   「一部項目が過去時刻→その項目だけ落ち、残りは採用される」シナリオ[11]を追加。
2. **m2: 下書きUndo時に対応する `aiScheduleHistory` の `removed` エントリも取り消す**。
   `snapshotDraftForUndo(historyEntry)` が削除操作由来のUndoでは対応entryも一緒に退避し
   (`_draftUndoHistoryEntry`)、`draft-undo` 実行時に `state.aiScheduleHistory` から
   `splice` で取り除く(配列参照の `indexOf` で特定)。これをしないと「削除→Undo→確定」で
   同じ提案に `removed`/`confirmed` が二重記録され、v64のAI学習データが汚れる。却下理由
   ピッカーが同じentryを参照していた場合はピッカーも畳む。新規下書き作成時
   (`runAiSchedule`/`runAiMorningPlan`)・確定完了時(`confirmScheduleDraft`)にも
   `_draftUndo`/`_draftUndoHistoryEntry` をリセットし、前セッションのUndoを持ち越さないよう
   にした(レビュー指摘には無いが同種の不整合のため合わせて対応)。`tests/v62.test.js` に
   「削除→Undo→確定でremoved/confirmedが二重計上されない」シナリオ[12]を追加。
3. **m4: `normalizeState` に `aiScheduleHistory` の後方互換補完を追加**。既存エントリに
   `source`/`reason` が無ければ `{ source: "unknown", reason: "", ...h }` で補完する
   (SKILL「新フィールドは必ずnormalizeStateに補完」規約への準拠)。
4. **m5: `sw.js` の `.json` を network-first に変更**(`.md`/HTML/JS/CSSと同じ扱いに統一)。
   `AIプラン_*.json` が cache-first のままだと、自宅PCバッチが当日分をpushしても端末に
   旧キャッシュ(前日分または無し)が居座り続け、朝プランに反映されない不具合が起き得た。
5. **m3: CHANGES_v62.md の `blockId` に関する記述を訂正**。「型チェックのみ行う」としていたが
   実態は `tryFetchAiPlan` が `p.blockId` を一切読んでいなかった(未参照)。実態に合わせて
   訂正した。
6. **m7: 週次「+登録」の見積分数パース**。`parseSuggestedTaskTitle()` が行末尾の
   「(30分)」等を正規表現で抜き出し、登録するTaskの `estimateMin` に設定・タイトルからは
   除去する(表示上の提案文自体は変更しない)。`tests/v62.test.js` シナリオ[9]を、
   タイトルに見積表記が残らないこと・`estimateMin` が数値で入ることを確認する内容に更新した。

## テスト

- `node tests/v62.test.js`: 12シナリオ・約50チェック ALL PASS を確認済み(レビュー対応で
  [11][12]を追加、[9]を見積分数パース対応に更新)。
  - AIプラン正常fetch(source=ai-plan・reason表示・skipped表示・確定時のBlock/history記録)
  - 不正JSON・日付不一致・carryFromId二重繰越参照 の3パターンで決定論配置への全体フォール
    バックと `source=deterministic` 記録を確認
  - **一部項目のみ過去時刻/既存Blockと衝突 → その項目だけ「時間切れで除外」され、残りは
    `source=ai-plan` のまま採用される**(M1)
  - 下書きUndo(削除→復元、1段のみ)・**Undo後に確定してもaiScheduleHistoryへ二重計上され
    ない**(m2)
  - 却下理由のワンタップ選択(選択時/「閉じる」時それぞれの `aiScheduleHistory.reason`)
  - 週次レビューmdの表示(無い週は非表示)・「+登録」の1件ずつ登録・二重登録防止・
    **見積分数(30分/45分)がestimateMinへ分離されタイトルから消える**(m7)
  - ホーム信条の新文言
- `node tests/v58.test.js` のシナリオ[4](`.draft-remove` クリック検証)が、実行時刻が
  23:00境界に近いとフレーキーになる既存バグ(v61で v50/v59/v60 に適用した
  `page.clock.setFixedTime()` 対策が本スイートだけ未適用だった)を発見したため、同じ対策を
  追加した(該当シナリオ限定。他シナリオは実時刻ベースのロジックのため変更していない)。
- 納品前の全量実行(`npm test` = `node tests/run-all.js`、v49・v50・v53〜v62 の全13スイート)
  ALL PASS を確認済み。

## 変更ファイル

- `app.js`
- `styles.css`(`.draft-block-reason` / `.draft-reject-picker` / `.ai-weekly-suggest*`)
- `sw.js`(`CACHE_NAME` / m5: `.json` を network-first に)
- `tests/v62.test.js`(新規。レビュー対応でシナリオ[11][12]追加・[9]更新)
- `tests/v58.test.js`(レビュー対応: シナリオ[4]に `page.clock.setFixedTime()` を追加)
- `CHANGES_v62.md`(本ファイル)
- `../taskchute-notes/review.md`(notes リポジトリ側、m1指摘のクローズ)
- `../taskchute-notes/handoff.md`(notes リポジトリ側、本エントリ追記)

## 実機テスト手順

1. `sw.js?nocache=YYYYMMDD` を開き、1行目が `taskchute-journal-pwa-v62` になっていることを確認。
2. 自宅PCバッチ(`loop/plan-daily.sh`)が朝05:00に `AIプラン_YYYY-MM-DD.json` を生成した日、
   タスクシュート画面の🌅朝プランボタンを押し、下書きバーに「🤖 AIプラン由来」と出ること、
   各下書きBlockに理由(reason)がツールチップ・小さな注記の両方で見えることを確認する。
3. バッチが未生成の日(または `AIプラン_*.json` を手元で削除した状態)で🌅朝プランを押し、
   下書きバーが「⚙ 決定論配置」になり、従来どおり動作することを確認する(フォールバック)。
4. 下書きの×で1件外し、下書きバーに「↩ 元に戻す」が出ること・押すと外した項目が戻ることを確認。
   ×の直後に出る理由ピッカーで理由を1つ選び、`aiScheduleHistory`(開発者ツールでlocalStorage
   確認)に反映されることを確認する。
5. 自宅PCバッチ(`loop/weekly-review.sh`)が週次レビュー_*.mdを生成した週、週次タブに
   「AI週次レビュー」セクションが出ること、「来週のタスク提案」の各行に「+登録」ボタンがあり、
   1件押すとWBSにタスクが追加され、その行だけ「✓ 登録済み」になることを確認する。
6. ホーム画面の「三つの信条」が新しい3行(MIT達成率100%/実行率で裁かない/朝に注ぎ夜は充電)に
   なっていることを確認する。
7. 既存の繰越・朝プラン決定論配置・マイグレーション儀式・今日の理想(v59〜v61)の動作が
   壊れていないことを一通り確認する。

## 確認サイン

- [ ] 実機(iPad/iPhone)で上記手順を確認
- [ ] 確認者:
- [ ] 確認日:
