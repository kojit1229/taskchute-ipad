# CHANGES v59

## 概要

「朝の一括プランニング」を追加した。前日の未完了(繰り越し)・WBSの未完了タスク・
昨日のMIT候補をまとめて見て、当日の空き時間にAIが仮配置の下書きを作る。ユーザーは
既存のAI下書きスケジュールUI(点線Block・ドラッグで移動/長さ調整・×で個別却下・
「確定して登録」で一括確定)をそのまま使って、当日の予定を短時間で確定できる。

AIが使えない(APIキー未設定・呼び出し失敗・オフライン)場合でも、MIT→繰越→WBSの
優先順で空き枠へ機械的に前詰め配置する決定論フォールバックが動くため、AIなしでも
最低限「今日の下書き」は得られる。

## 変更内容

### 1. 空き時間計算(新規・決定論)
- `computeFreeGaps(date, dayStartMin=5*60, dayEndMin=23*60)`: `blocksForDate(date)` の
  `plannedStartAt`/`plannedEndAt`(ルーティンのrec Blockも含む)から占有区間を作り、
  指定範囲内の空き枠([start,end] 分・昇順)を返す純関数。`minutesOf()` で文字列から
  分を抽出し `Date(文字列)` は経由しない(iOS Safariの9時間ズレ回避ルールに準拠)。

### 2. 朝の一括プランニング本体(新規)
- `aiMorningPlanCandidates(date)`: `carryableBlocks()`(昨日未完了・繰越候補。元Block idを
  `carryFromId` として保持)+ `aiScheduleCandidates(date)`(MIT候補+WBS未完了)を合成。
  同taskId/同titleが両方に居る場合は繰越側を優先して1本化する。
- `runAiMorningPlan({ auto })`: 候補・確定済み予定/ルーティンの占有一覧・空き枠・
  前日AIフィードバック・`buildScheduleLearningDigest()` をAIへ渡し、
  `{"plan":[{id,start,minutes}],"skipped":[{id,reason}]}` の形式で受け取る。
  `plan` は既存の `_scheduleDraft` にそのまま流し込み(`carryFromId` を保持)、`skipped` は
  下書きバー直下に「見送り: タイトル(理由)」として表示する(トーストにはしない)。
  当日プランのため、現在時刻より前の空き枠は自動的に除外する。
- `fallbackMorningPlan(candidates, freeGaps)`: AI不使用時の決定論配置。MIT候補→繰越→WBSの
  優先順で、各候補の見積分数(無ければ30分)を空き枠へ前詰め。入り切らない候補は
  「空き枠なし」として skipped に回す。
- `confirmScheduleDraft()` を拡張し、`carryFromId` を持つ下書き項目を確定すると元Block
  (昨日の未完了Block)に `migratedTo` を設定する。`carryOverBlock()` と同じセマンティクス
  で、二重に繰り越し提案されなくなる。

### 3. UI
- タスクシュート画面のAI行(既存の「今日のタスク提案」「空き時間に下書きスケジュール」の
  並び)に「🌅 朝プラン」ボタンを追加(`data-action="ai-morning-plan"`、今日を選択中のみ表示、
  `_aiReviewPending` の間はdisabled)。
- 自動起動: `maybeAutoMorningPlan()`。`maybeAutoMorningReview()` と同じ1日1回ガード
  (localStorage)パターン。**設定でopt-in**(既定OFF、「🌅 朝の一括プランニング」トグルを
  設定画面のAIレビュー節に追加)。ONの場合、10:00までの初回起動 かつ 当日の非ルーティン
  Blockが0件のときだけ自動実行し、「🌅 今日の下書きプランを置きました。タイムラインで
  調整→確定してください」とトーストする(画面遷移はしない)。破棄しても同日中は
  再自動起動しない(ガードは実行を決めた時点で立てる)。
- プロンプト設定(上級)に「朝の一括プランニングの指示」欄を追加(`AI_DEFAULT_PROMPTS.morningPlan`)。

### 4. その他
- `sw.js` の `CACHE_NAME` を `v58` → `v59` に更新。
- `tests/v59.test.js` を新規追加。
- `tests/v51.test.js` の「プロンプト編集欄が5つ」を、`morningPlan` 欄追加により「6つ」に更新
  (機能追加に伴う正当な期待値更新。UI・保存ロジック自体は無変更)。

## 実装判断(仕様から補った/外れた点)

1. **自動起動をopt-in化した**: 仕様は「`maybeAutoMorningReview()` と同じパターンで…自動で
   `runAiMorningPlan()` を走らせ」とあり、設定トグルの要否は明記されていなかった。既存の
   `maybeAutoMorningReview()` は `state.settings.ai.autoMorningReview` による明示opt-in
   (既定OFF)なので、「同じパターン」を字義通り踏襲し `autoMorningPlan` トグルを新設した
   (既定OFF)。無許可でホーム画面を離れてタイムラインへ飛ばしたり、未確認の下書きが
   勝手に溜まる体験を避ける意図。
2. **自動起動はAPIキー未設定でも動く**: 仕様の「AIなしでも機能する」というフォールバック要件を
   自動起動にも適用し、`maybeAutoMorningPlan()` は `aiEnabled()` を必須にしていない
   (`autoMorningPlan` トグルのみで判定)。一方、手動の「🌅 朝プラン」ボタンは既存の
   「🤖」系ボタンと同じ行にあり `aiEnabled()`(APIキー設定済み)がゲートになっている。
   このため APIキー未設定のユーザーは自動下書き(フォールバック配置)は受け取れるが、
   手動ボタンからは呼べない、という非対称が生じている。ボタン単体をAPIキー無しでも
   表示するかは設計判断が必要なため、現状は既存の「AI行」の慣習を優先した。
3. **`_scheduleDraft` に `skipped` フィールドを追加**: 既存の `{date, items}` 形状を
   `{date, items, skipped}` に拡張。`draftBarHTML()` のみで参照し、他の読み出し箇所
   (`renderDraftLayer()` 等)は `items` のみ見るため影響なし。

## 変更ファイル

- `app.js`
- `sw.js`(`CACHE_NAME`)
- `tests/v59.test.js`(新規)
- `tests/v51.test.js`(プロンプト欄カウントの期待値更新)
- `../taskchute-notes/handoff.md`(notes リポジトリ側、本エントリ追記)

## 実機テスト手順

1. `sw.js?nocache=YYYYMMDD` を開き、1行目が `taskchute-journal-pwa-v59` になっていることを確認。
2. 設定画面 → 「AIレビュー(Anthropic API)」節に「🌅 朝の一括プランニング」トグルがあることを確認。
3. タスクシュート画面(今日を表示中)で「🌅 朝プラン」ボタンが「🤖 今日のタスク提案」
   「🤖 空き時間に下書きスケジュール」と並んで表示されることを確認(APIキー設定済み前提)。
4. 昨日の未完了Blockを1件残した状態で「🌅 朝プラン」を押し、タイムラインに遷移して
   点線Blockとして繰越タスクが仮配置されることを確認。下書きバー下に見送り理由が
   表示される場合はその文言も確認。
5. 「確定して登録」を押し、繰越元(昨日)のBlockが「昨日の未完了」パネルから消える
   (=二重繰越されない)ことを確認。
6. 設定でAPIキーを空にした状態(またはネットワーク遮断)で「🌅 朝の一括プランニング」を
   ONにし、翌朝10:00前にアプリを開いてトーストと下書きが自動生成されることを確認
   (フォールバック配置。空き時間と重ならないことを目視確認)。

## 確認サイン

- [ ] 実機(iPad/iPhone)で上記手順を確認
- [ ] 確認者:
- [ ] 確認日:

## テスト

`npm test`(`node tests/run-all.js`)で v49〜v59 全11スイートを実行し ALL PASS を確認。
`tests/v59.test.js` は以下を検証する(いずれも `window.fetch` をAnthropic API宛のみ
reject させ、決定論フォールバック経路を強制して確認):

- (a) `computeFreeGaps` の境界: 占有なし(今〜23:00の1本)/ 連続占有(隙間に配置されず
  マージ後の終端から配置される)/ 日跨ぎ端(23:00を超えて配置しない、入り切らない候補は
  skipped)
- (b) 繰越候補(昨日未完了Block)が下書きのタイトルとして表示される
- (c) 確定操作で元Block(昨日)に `migratedTo` が付き、「昨日の未完了」パネルに
  再表示されない(二重繰越防止)
- (d) フォールバック配置が占有区間(空き枠)と重ならない
- (e) 「🌅 朝プラン」ボタンの存在(APIキー設定・今日選択中)

`maybeAutoMorningPlan()` の「10:00以前の初回起動」判定は実時刻(`new Date()`)に依存するため
自動テストの対象外とした(既存の `maybeAutoMorningReview()` も同様の制約)。手順6の実機確認で
代替する。
