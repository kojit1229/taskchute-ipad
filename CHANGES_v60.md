# CHANGES v60

## 概要

アプリ内(ブラウザ)からの Claude API 直接呼び出しを**全廃**した(コスト理由)。
今後のAI活用は自宅PCのバッチ処理(`loop/coach-daily.sh` 等)→ファイル連携
(`AIフィードバック_日付.md` の自動fetch・手動.mdアップロード)に限定する方針。

これに伴い、AI呼び出し前提だった機能を「削除」または「決定論ロジックへの置き換えで存続」の
どちらかに仕分けた。あわせて、テスト実行方針を「開発中は関連スイート限定でよい」に見直した。

## 削除した機能 / 残した機能の対照表

| 機能 | v59まで | v60 | 代替手段 |
|---|---|---|---|
| 朝の一括プランニング(🌅朝プラン) | AI優先・失敗時のみ決定論フォールバック | **決定論配置(fallbackMorningPlan)が正規経路**。ボタン常時表示 | そのまま(質は下がるが機能は同じ) |
| 下書きスケジュール(📋旧🤖) | AIが空き時間へ仮配置 | **決定論配置**(computeFreeGaps→fallbackMorningPlan)に置換 | そのまま |
| AIレビュー実行(日報→フィードバック) | 削除 | — | コピー/共有→外部AI→ジャーナルへ貼り付け or `.md`アップロード(既存) |
| AIタスク分解(WBS「🤖分解」) | 削除 | — | 代替なし(手動でタスク追加) |
| AI一括編集(WBS「まとめて編集」) | 削除 | — | v55のインライン編集(行内で直接編集、既存) |
| 週次/12週サイクルAI壁打ち | 削除 | — | 代替なし(手動メモ欄はそのまま) |
| 0秒思考のまとめ所感 | 削除 | — | 代替なし |
| 今日のタスク提案 | 削除 | — | 🌅朝プランが上位互換 |
| 朝イチ自動レビュー | 削除 | — | 代替なし(下記「残すもの」は別経路として存続) |
| APIキー・モデル選択・プロンプト編集UI | 削除 | — | 不要になったため |
| **前日AIフィードバックの自動fetch** | 存続 | **存続**(APIではなくファイル取得) | 変更なし |
| **`.md`アップロード / 貼り付け** | 存続 | **存続** | 変更なし |
| **AI返信からの取り込み**(テーマ/MIT/問い) | 存続 | **存続** | 変更なし |
| GitHub同期・日報push | 存続 | **存続** | 変更なし |

## 変更内容(app.js)

### 1. 全廃した関数・定数
`callClaude` / `aiErrorMessage` / `syncAiFieldsFromDOM` / `aiEnabled` / `aiPrompt` /
`aiCommonPreamble` / `extractAiJson` / `AI_DEFAULT_PROMPTS` / `AI_MODELS` /
`runAiReview` / `aiReviewButton` / `runAiDecompose` / `buildAiDecomposeModal` /
`submitAiDecompose` / `AI_BULK_FIELDS` / `TASK_STATUSES` / `wbsEditableTasks` /
`openAiBulkEditModal` / `runAiBulkEdit` / `buildAiBulkEditConfirm` / `submitAiBulkEdit` /
`runAiWeekly` / `runAiCycle` / `runAiZeroComment` / `buildZtAiCommentModal` /
`runAiTodaySuggest` / `buildAiTodayModal` / `submitAiToday` / `maybeAutoMorningReview`。
`aiEnabled()` ゲートの廃止に伴い、存続するボタン(🌅朝プラン・📋下書きスケジュール)は
APIキーの有無に関わらず常時表示にした(v59レビュー指摘(b)の非対称も解消)。

### 2. 決定論化して存続
- **`runAiSchedule`**(下書きスケジュール): AI呼び出し経路を削除し、
  `computeFreeGaps` + `fallbackMorningPlan`(朝プランと共通の決定論配置ロジック)に置換。
  同期関数になったため `_aiReviewPending` ガードも不要になり削除。
- **`runAiMorningPlan`**(朝の一括プランニング): AI分岐を削除し、`fallbackMorningPlan` を
  正規経路に昇格。関数名・シグネチャは維持(呼び出し側の互換のため)。
- **`aiScheduleCandidates`**: 候補にタスクの `estimateMin` を載せるようにした(v59レビュー
  指摘(i))。これにより「下書きスケジュール」経由の決定論配置が既定30分固定にならず、
  見積のあるタスクはその分数で配置される。
- **`_scheduleDraft`**: shape コメントに `skipped` を反映(v59レビュー指摘(ii))。

### 3. デッドコード削除
`buildScheduleLearningDigest` / `morningEnergyCorrelation` / `hhmmToMin` を削除した。
これらはいずれも「過去の実績から集計した傾向」を**AIプロンプトへ注入するためだけ**に存在した
関数で、注入先(`runAiSchedule`/`runAiMorningPlan`のAI分岐・`runAiWeekly`・`runAiTodaySuggest`)
が全て削除された結果、呼び出し元ゼロの完全なデッドコードになったため。
一方、`SCHED_BANDS`(計器盤のヒートマップでも使用)、`recordScheduleHistory` /
`aiScheduleHistory`(配置提案に対する採否ログ。将来の自宅PCバッチでの分析用途を見込んで残置)
は削除していない。

### 4. normalizeState
既存の保存値に `apiKey` / `model` / `prompts` / `autoMorningReview` が残っていた場合、
起動時に明示的に `delete` して端末のlocalStorageから掃除する(v59以前のデータを持つ端末で
古いAPIキーが残り続けないように)。`autoMorningPlan`(決定論配置の自動下書き)は機能として
残るため既定値補完のみ継続。

### 5. UI文言
「🤖」絵文字はClaude API呼び出しを連想させるため、決定論化した2機能のボタン・トースト・
下書きバーから外した(📋に統一。🌅はAI専有の絵文字ではないため維持)。設定画面の
「AIレビュー(Anthropic API)」パネルは「朝の一括プランニング」パネルに縮小し、
APIキー欄・モデル選択・プロンプト編集(上級設定)・朝イチ自動レビュートグルを削除、
朝の一括プランニングの自動下書きトグルのみ残した。

## テスト方針の見直し

- `tests/run-all.js` にスイート絞り込み引数を追加: `node tests/run-all.js v59 v60` で
  該当スイートのみ実行(引数なしは従来通り全量)。
- `package.json` に `test:quick` スクリプトを追加(`npm run test:quick -- v59 v60` で同じ絞り込み)。
  `npm test`(=引数なし全量)はCI・push前用として変更なし。
- `CLAUDE.md` に「開発中は関連スイート+最新スイートのみでよい。push前・CI(GitHub Actions)では
  必ず全量」の方針を明記。

## テスト変更の根拠(既存スイートの更新・削除)

機能削除に伴い、以下の既存テストを更新・削除した(いずれも「機能自体が無くなった」ことに
伴う正当な更新であり、無関係の検証を減らしてはいない):

- **`tests/v49.test.js`**: 「AIレビュー直接統合」の検証(APIキー入力・Messages API呼び出し・
  取り込みモーダル自動起動・エラーハンドリング等)を全て削除。世代バックアップ・横断検索は
  AI機能と無関係なのでそのまま残した。
- **`tests/v50.test.js`**: 「①AIタスク分解」「③週次壁打ち」「④0秒思考所感」の検証を削除
  (いずれもcallClaude前提の機能が消滅)。「②スケジュール下書きD&D」はfetchモックを外し、
  決定論配置の初期値を数式で予測してD&D操作(ドラッグ移動・下端リサイズ・確定・破棄)の
  検証として残した。
- **`tests/v51.test.js`**(削除): 検証対象が「プロンプト設定UI」「共通コンテキストの注入」
  「今日のタスク提案」「朝イチ自動レビュー」の4本で、全て機能ごと削除されたため、部分更新では
  内容が空になる。ファイルごと削除した。
- **`tests/v52.test.js`**(削除・**訂正**): 当初「検証対象が一本(AIスケジュール学習ダイジェストの
  プロンプト注入)で全面的に成立しなくなった」として全削除したが、これは事実誤認だった。
  実際には [1] プロンプト注入(削除済みの`buildScheduleLearningDigest`が対象、これは正しく消滅)
  に加えて、[2][3] は `confirmScheduleDraft()` 内の `block.aiPlan = {...}`(app.js)と
  `recordScheduleHistory()` による `state.aiScheduleHistory` への confirmed/removed/discarded
  記録という**現存コード**(v60でも無改修)を検証していた。この保存系の検証を落としたまま
  ファイル削除するのは不当だったため、該当アサーションを `tests/v60.test.js`
  ((e): 確定Blockに`aiPlan`が残ること・`aiScheduleHistory`にconfirmed(userStart/userMin付き)
  /removed/discardedが記録されること)へ移設したうえで、v52.test.js自体は
  (a)プロンプト注入テスト(対象関数が消滅済み)(b)D&D操作の検証(v50.test.jsと重複)しか
  残らないためファイル自体は削除とした。
- **`tests/v53.test.js`**: 「[2] 朝の体調相関のAI注入」セクションを削除(digest注入経路が
  消滅)。計器盤・自動アーカイブ・検索のアーカイブ合流・後方互換はAI機能と無関係なので
  そのまま残した。
- **`tests/v55.test.js`**: 「[2] AI一括編集」セクションを削除。WBSインライン編集・後方互換は
  そのまま残した。
- **`tests/v56.test.js`**: 「#3 設定画面のAIプロンプトtextarea(inline style)」の検証対象が
  消滅したため、同じ回帰(inline styleの`font-size:16px`が16px未満に落ちないこと)を汎用の
  合成textarea要素で検証する形に置き換えた(検証内容の後退ではなく対象の付け替え)。
- **`tests/v57.test.js`**: 「[2] 直push検知」のうち、fetchした前日フィードバックが
  callClaudeプロンプトへ反映されることの確認(「今日のタスク提案」経由)を、同じ本文が
  ジャーナルの「前日のフィードバックも見る」欄に反映されることの確認に置き換えた。
  fetch自体(feedbackFilesへの登録・fetch回数)の検証は変更していない。
- **`tests/v58.test.js`**: 「[4] 短い下書きBlockの削除ボタン」のAIモック(15分の配置案を
  fetchで返す)を、`estimateMin: 15` を持つWBSタスクを決定論配置させる形に置き換えた。
  検証対象(15分の極短Blockで削除ボタンが`.draft-resize`に横取りされないこと)は同じ。
- **`tests/v59.test.js`**: `window.fetch` をAnthropic API宛のみrejectさせるモック
  (`installFailingAiFetch`)とAPIキーのseedを削除(AI呼び出し自体が無くなったため不要)。
  検証していた「決定論フォールバックの配置境界」はv60で唯一の配置経路になったため、
  そのまま「常用経路」の検証として成立する(assertion自体は無改修)。
- **`tests/v60.test.js`**(新規): (a) 起動〜朝プラン確定までの全経路で `api.anthropic.com`
  への fetch が一切発生しないこと (b) 設定画面にAPIキー・モデル・プロンプト編集欄が無く、
  旧保存値も起動時に掃除されること (c) 🌅朝プラン・📋下書きスケジュールがAPIキー無しで
  表示・動作すること (d) 下書きスケジュールがestimateMinを反映した決定論配置で動くこと
  (e) 確定Blockに`aiPlan`(決定論配置の元値)が残ること、`aiScheduleHistory`に
  confirmed(userStart/userMin付き)/removed/discardedの各outcomeが記録されること
  (旧v52.test.jsから移設)、を検証。

## 実装判断(仕様から補った点)

1. **v51/v52テストファイルは部分更新ではなく削除**: v51は検証対象の機能が100%削除されたため
   ファイルごと削除。v52は当初「検証対象が一本で100%削除」と誤認して全削除していたが、
   レビュー指摘を受けて確認した結果、[2][3]で検証していた`block.aiPlan`/
   `recordScheduleHistory`/`aiScheduleHistory`は現存コードだったため、該当検証を
   `tests/v60.test.js`へ移設したうえで改めてファイル削除とした(詳細は上記「テスト変更の根拠」
   のv52.test.js項を参照)。
2. **buildScheduleLearningDigest等のデッドコード削除**: 明示的な削除指示はなかったが、
   「AIプロンプトへ注入するためだけの関数」が呼び出し元ゼロで残ることは全廃の趣旨に反すると
   判断し、あわせて削除した。統計機能で使う `SCHED_BANDS` 等は残置。
3. **ボタンの🤖絵文字を📋に変更**: 決定論化した機能がAI由来に見えると誤解を招くため、
   明示的な指示はなかったが表記を整合させた。🌅(朝プラン)はAI専有の絵文字ではないため維持。
4. **代替手段のない4機能(AIタスク分解・AI一括編集・週次/12週壁打ち・0秒思考所感)は
   単純削除**: いずれもAPI呼び出し前提の一発生成機能で、決定論的な代替ロジックが存在しない
   (WBS分解や壁打ちを機械的にやる意味がない)ため。AI一括編集はv55のインライン編集で
   代替可能と判断し、他は代替を用意しなかった。

## 変更ファイル

- `app.js`
- `sw.js`(`CACHE_NAME` を `v59` → `v60`)
- `package.json`(`test:quick` スクリプト追加)
- `tests/run-all.js`(スイート絞り込み引数の追加)
- `tests/v49.test.js`(AIレビュー/APIキー検証を削除、バックアップ・横断検索のみ残す)
- `tests/v50.test.js`(①③④削除、②を決定論配置のD&D検証に置換)
- `tests/v51.test.js`(削除)
- `tests/v52.test.js`(削除)
- `tests/v53.test.js`(体調相関のAI注入セクションを削除)
- `tests/v55.test.js`(AI一括編集セクションを削除)
- `tests/v56.test.js`(inline style検証の対象を汎用要素に置換)
- `tests/v57.test.js`(AI提案プロンプト検証をジャーナル反映検証に置換)
- `tests/v58.test.js`(AIモックをestimateMin付きタスクでの決定論配置に置換)
- `tests/v59.test.js`(AI失敗モック・APIキーseedを削除、コメント更新)
- `tests/v60.test.js`(新規)
- `CLAUDE.md`(テスト実行方針の追記)
- `CHANGES_v60.md`(本ファイル)
- `../taskchute-notes/handoff.md`(notes リポジトリ側、本エントリ追記)

## 実機テスト手順

1. `sw.js?nocache=YYYYMMDD` を開き、1行目が `taskchute-journal-pwa-v60` になっていることを確認。
2. 旧バージョン(v59以前)でAPIキーを設定していた端末があれば、そのPWAを開いて設定画面を確認し、
   APIキー欄自体が表示されず、旧キーが端末に残っていないことを確認(初回起動でnormalizeStateが
   自動的に掃除する)。
3. ブラウザの開発者ツール(Network タブ)を開いた状態で、タスクシュート画面の
   「📋 下書きスケジュール」「🌅 朝プラン」をそれぞれ実行し、`api.anthropic.com` への通信が
   一切発生しないこと、かつ空き時間への仮配置(下書きBlock)が問題なく行われることを確認。
4. ジャーナル画面で「📤 .mdアップロード」ボタン、および貼り付け欄への手動貼り付けが
   引き続き機能し、「🤖 AI返信から取り込み(テーマ/MIT/問い)」も動くことを確認。
5. 自宅PCの `loop/coach-daily.sh` が翌朝pushする `AIフィードバック_日付.md` が、引き続き
   前日1日分だけ自動fetchされ、ジャーナルに反映されることを確認(v56/v57の既存仕様通り)。
6. WBS画面・週次画面・0秒思考画面から、削除したAIボタン(🤖分解・まとめて編集・AIと振り返る・
   直近7日の所感)が跡形もなく消えていることを目視確認。

## 確認サイン

- [ ] 実機(iPad/iPhone)で上記手順を確認
- [ ] 確認者:
- [ ] 確認日:

## テスト

`npm test`(`node tests/run-all.js`)で v49・v50・v53〜v60 の全10スイートを実行し ALL PASS を
確認済み(v51・v52は機能削除に伴い削除。開発中は `node tests/run-all.js v59 v60` のように
関連スイートのみを回してよいが、納品前には必ず全量を実行すること)。
