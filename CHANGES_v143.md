# v143 計器盤「今週のヒント」(computeInsights) + AIフィードバック手動取込系の死コード削除

承認済み設計(`workbench/out/2026-07-26-taskchute-revamp/design-proposal.md` §2=P2)への対応。
2つの独立した変更単位(A: 新機能、B: 死コード掃除)を含む。コミットは分けられるよう
app.js内でも編集領域を分離している(Aは主に8970〜9460行台の新規関数+renderStats呼び出し1行、
Bは662/840/1055/3610/16280/16700行台の既存コードの削除のみで、両者の行範囲は重ならない)。

## A. 今週のヒント(computeInsights + ドリルダウン)

計器盤(統計)の最上部に「今週のヒント」節を新設した。既存9チャートは全部残し、追加は
この1節のみ(design-proposal.mdの方針どおり)。

### computeInsights(since, today)

5ルールを評価し、該当したものだけ**ルールにつき最大1件・合計最大5件**を返す決定論関数
(保存しない、renderStatsと同じ都度計算思想)。文体は観察文のみ(「〜すべき」を出さない、
催促・評価語を使わない)。0件なら節ごと非表示(静かな計器)。

1. **放電超過カテゴリ/曜日**: 既存`computeEnergyStructure()`の結果を統合表示(二重実装しない)。
   `findings[0]`(曜日finding優先)をそのまま1件のヒントとして採用する。
2. **時間帯×曜日の着手率(予定ベース)の上位・下位セル**: 新設`computeHeatmapCells(since, today)`
   (時間帯×曜日ごとのセル集計を切り出した純関数)から、最良セルと最悪セルを1文で言語化する
   (例:「土曜早朝は着手率100%、木曜午後は25%」)。両セルが同一なら非表示。
3. **見積誤差が大きいカテゴリ**: 新設`computeEstimateStats(since, today)`(見積vs実績集計を
   切り出した純関数)のcatRows先頭(乖離が最大のカテゴリ)を採用。5件未満ガード踏襲。
4. **睡眠帯×実績の観察**: 新設`computeSleepBucketStats(since, today)`(v142の帯別集計ロジックを
   分離)から、全体の着手率中央値と比べて最も落ち込みが大きい帯を検出し、-5pt以上の落ち込みが
   ある場合のみ観察文を出す(閾値は過剰検出を避けるための恣意的な値。3件未満の帯・対サンプル
   ともに対象外)。
5. **充電効果の高いカテゴリ上位**: 新設`computeChargeTopCategories(since, today)`(完了Blockの
   カテゴリ別net中央値、n>=3・正のみ)の最上位カテゴリを採用。

### ドリルダウン導線

新規actionは追加せず、既存の`energy-open-routine`(曜日→ルーティンタブ)・
`energy-open-category`(カテゴリ→タイムラインタブ)の2つのdata-actionパターンをそのまま
再利用した。睡眠帯ヒントのみ、該当する直近日のジャーナルへ飛ぶ導線が無かったため、既存の
`search-jump`(data-view/data-date)actionへ値を渡す形でドリルダウンさせている(新規action
ハンドラの追加は無し、既存デリゲーションへ値を渡すだけ)。

### 二重実装の回避(既存チャートのリファクタ)

renderStats()内にインラインで書かれていたヒートマップ集計・見積vs実績集計を、それぞれ
`computeHeatmapCells()`・`computeEstimateStats()`として切り出し、renderStats自身もこの2関数を
呼ぶ形に変えた(出力は従来と完全に同一。既存テストv53/v54で回帰なしを確認)。renderStats本体
への追加は`renderInsights(since, today)`の呼び出し1行+`body`への合成のみ。

### 着手率の定義注記

計器盤には「着手率」の定義が2つ存在する(`taskchute-notes/decisions.md` 2026-07-26記載、
予定ベース=`plannedStartAt`分母 vs タスク紐づけ=`taskchuteStartRate`)。ヒント文はヒートマップ・
睡眠帯別と同じ「着手率(予定ベース)」定義を使い、節末尾のキャプションにその旨を1行明記した。

## B. 死コード削除(AIフィードバック手動取込系)

v141でジャーナルのAIフィードバック列(手動貼り付け欄)自体を撤去した結果、以下が到達不能に
なっていた。Kが「問い取込は不要」と確定済みのため、削除した(hydrateStaticMarkdown /
autoIngestFeedback / state.feedback / cachedFeedback は削除していない — Home「AIから」カードと
AI連携ループで引き続き使用中。aiMitChips/adoptAiMit/ai-mit-adoptも別系統のため残している)。

- `data-action="journal-import-ai"`ハンドラ(クリック委譲内、旧662行付近)
- `data-feedback-upload`ハンドラ(change委譲内、旧1060行付近)+ 呼び出し先`uploadFeedbackFile()`本体
  (唯一の呼び出し元だったため、削除の連鎖として本体も削除)
- `data-feedback-date`の入力ハンドラ(input委譲内、旧842行付近)と、同名属性へのpasteリスナー
  (旧16385行付近、`document.addEventListener("paste", ...)`)
- `openAiImportModal()`一式: `openAiImportModal` / `buildAiImportModal` / `submitAiImport` /
  `parseAiFeedback` / `_aiImportCtx` / `ai-import-submit`アクションハンドラ

### 削除前の参照確認(1件ずつgrepで確認したもの)

| シンボル | 削除前の呼び出し元 | 判定 |
|---|---|---|
| `openAiImportModal` | `journal-import-ai`ハンドラ・pasteリスナーの2箇所のみ | 両方削除するため道連れで削除可 |
| `buildAiImportModal`/`submitAiImport`/`parseAiFeedback`/`_aiImportCtx` | いずれも上記`openAiImportModal`系からのみ参照 | 同上 |
| `uploadFeedbackFile` | `data-feedback-upload`ハンドラの1箇所のみ | 削除可 |
| `recordFeedbackFile` | `uploadFeedbackFile`内 **と** `hydrateStaticMarkdown`内(v57、前日分の直push検知)の2箇所 | **削除しない**(hydrateStaticMarkdown側が生きている) |
| `state.modal.type === "aiImport"` | `closeModal`/型別再描画の分岐(15251〜)に無し | モーダル種別として他から参照されておらず削除しても分岐漏れは無い |
| `aiMitCandidates`/`aiMitChips`/`adoptAiMit`/`ai-mit-adopt` | `aiMitChips()`がHome画面から呼ばれ続けている(生きているUI) | 削除しない(スコープ外) |

## テスト

`tests/v143.test.js`(新規): A(computeInsightsの5ルール発火・0件非表示・睡眠帯の最小サンプル数
ガード・3系統のドリルダウン遷移)+ B(削除後もHome「AIから」カードが機能する回帰、削除済み
UI要素が出ないままであることの回帰)を1ファイルで検証。

- `node tests/v143.test.js` 単体PASS(22チェック)。
- `node tests/run-all.js v53 v54 v73 v76 v128 v131 v141 v142 v143` ALL PASS(計器盤・エネルギー
  構造・睡眠・AIフィードバック関連の既存回帰確認)。
- `npm run test:core` ALL PASS(160.1s、v143含む直近5本+固定コア5本)。
- `npm test`(全量)は別途バックグラウンドで実行し、結果は本ファイルの追記または監督者への
  報告で別途伝える(9分50秒のフォアグラウンド上限に収まらないため)。

## 自信がない箇所・未対応

- ルール4(睡眠帯)の「-5pt」閾値、ルール2の「best!==worstなら発火」は今回新設した恣意的な
  基準であり、K自身の実データでどの程度の頻度で発火するかは未検証(合成データでのみ確認)。
- `aiMitChips`/`adoptAiMit`(`state.journalMeta.aiMitCandidates`)は、その唯一の書き込み経路
  だった`submitAiImport`を今回削除したため、**今後アプリ内で二度と値が入らない**(v141時点で
  既に同じ状態だった可能性が高いが未検証)。スコープ外のため今回は現状維持としたが、次回の
  死コード掃除候補として認識しておくとよい。
