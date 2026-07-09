# CHANGES v65

## 概要

`../taskchute-notes/designs/10x-mechanism.md` のv65節(最小構成・2週間で体感できる範囲)に基づき、
「同じ仕事を速く・確実にやる(2x)」に加えて「やる仕事の質そのものを変える(10x)」への入口を
アプリ側に軽量追加した。アプリ内Claude API呼び出しは追加していない(v60方針を維持)。
あわせて `../taskchute-notes/designs/v64-ai-data-loop.md` §3(アプリ側最小改修)の残余
(AIプランのskipped理由がアプリ側で永続化されていなかった点)を吸収し、
`tests/v57.test.js` の実時刻依存フレーキーを他スイートと同じclock固定方式で解消した。

- **leverageType属性** — Task/Blockに「資産を作る(asset)/繰り返しを消す(eliminate)/一回きり
  (oneoff)/未設定」を選べる任意属性を追加。編集モーダルにselect+10秒判定ヘルプ、
  一覧(タスクシュート/WBS)・タイムラインに控えめマーク(⚙資産/✂削減。oneoffは視覚ノイズ回避の
  ため無表示)を出す。
- **10秒判定の3問(任意ヘルプ)** — 設計書§1の3問を、Task/Block編集モーダル内の折りたたみ
  (`<details>`)として表示。チェック数をその場で数え、2問以上Yesなら「資産」を提案する
  ワンタップボタンを用意。強制はせず、保存ボタンを押すまでは何も永続化しない。
- **AIプランの[資産]検出** — `loop/plan/daily-plan.md`(v64バッチで実装済み)がtitle先頭に
  付ける「[資産]」プレフィックスを、AIプラン取り込み(v62実装済みの`tryFetchAiPlan`)で検出し、
  下書き段階・確定後のBlockの両方にleverageType=assetを自動付与する。
- **週次のleverageType別1行集計** — 週次レビュータブの既存「戦略/雑用/休息配分」ゲージの下に、
  完了Blockのleveragetype別合計時間(資産/削減/単発/未設定)を1行テキストで表示する
  (本格可視化はv66で対応予定)。

## 変更内容(app.js)

### 1. leverageType属性(designs/10x-mechanism.md 2-1)

- **`normalizeState`**: `value.tasks`/`value.blocks` のmapに `leverageType: ""` のデフォルトを
  追加(既存値優先で後方互換補完)。
- **`makeBlock`/`makeTask`**: `leverageType` 引数を追加(未指定時は `""`)。
- **`leverageTypeLabel(type)`/`leverageTypeMarkHTML(type)`**(新規): ラベル変換と、一覧・
  タイムライン用の控えめマークHTML。oneoffはマーク非表示(設計書6章の「毎タスクに問わない・
  裁かない」歯止めに合わせ、通常の2x作業に視覚的な負担を足さない)。
- **`leverageTypeOptionsHTML(current)`**(新規): 編集モーダルのselectオプション。
- **`buildTaskModal`/`buildBlockModal`**: leverageTypeセレクト + 10秒判定ヘルプを追加。
- **`saveTaskFromModal`/`saveBlockFromModal`**: `fields.leverageType` を保存する。
- **`renderBlockItem`(タスクシュート一覧)/`renderTaskRow`(WBS一覧)/`renderTimelineCard`
  (タイムライン)**: `leverageTypeMarkHTML` を挿入。

### 2. 10秒判定の3問(designs/10x-mechanism.md §1)

- **`leverageJudgeHelperHTML()`**(新規): 3問のチェックボックス + 「判定結果を反映」ボタンを
  持つ`<details>`。編集モーダルのleverageTypeフィールド直下に挿入。
- **`lev-judge`アクション**(click委譲へ追加): モーダル内のチェック済み `[data-lev-q]` 数を
  数え、2問以上ならleverageTypeセレクトへ`"asset"`をセットするだけ(state未変更)。
  トースト表示のみで、保存(`modal-save`)を押すまで永続化されない。

### 3. AIプランの[資産]検出(designs/10x-mechanism.md 2-3 後段)

- **`ASSET_TITLE_PREFIX`/`detectLeverageTypeFromTitle(title)`**(新規): title先頭
  `"[資産]"` の検出。
- **`tryFetchAiPlan`**: 各plan項目のleverageTypeは元title(プレフィックス付き)に対して
  `detectLeverageTypeFromTitle(p.title)` で検出する一方、下書き・確定Blockへ渡すtitle自体は
  `p.title.replace(/^\[資産\]\s*/, "")` でプレフィックスを除去する(レビュー対応:
  ⚙資産マークとの二重表示を防ぐ)。
- **`renderDraftLayer`**: 下書きカードのタイトルに `leverageTypeMarkHTML(it.leverageType)` を
  追加(確定前から見える。titleは既にプレフィックス除去済みのため二重表示しない)。
- **`confirmScheduleDraft`**: `it.leverageType` があれば確定後のBlockへ引き継ぐ(titleは
  `tryFetchAiPlan`側で既にプレフィックス除去済みのものがそのまま伝播する)。

### 4. 週次のleverageType別1行集計(designs/10x-mechanism.md 2-1後段、簡略版)

- **`weeklyLeverageMinutes(weekBlocks)`**(新規): 選択中週の完了Blockをleveragetype別
  (asset/eliminate/oneoff/unset)に時間集計する。既存の`weeklyBucketMinutes`と同じ
  「実績優先・無ければ計画」の時間算出(`_actualDurationMin`)を再利用。
- **`renderLeverageSummaryLine(weekBlocks)`**(新規): 1行テキストのHTML。
- **`renderWeekly`**: 「戦略/雑用/休息配分」セクション内、既存の説明文の直後に追加。

### 5. v64設計§3残余の吸収(designs/v64-ai-data-loop.md §3)

現物確認の結果、§3の主要項目(AIプランJSON取り込み・aiScheduleHistoryのsource区別)は
v62で既に実装済みだったが、「AIプラン自身のskipped理由をアプリ側に永続化する」
(学習シグナル#8)だけが未実装のまま残っていたため、今回吸収した。

- **`normalizeState`**: `value.aiPlanSkippedLog ||= []` を追加(`migrationRitualLog`と同じ
  軽量配列の思想、上限300件)。
- **`AI_PLAN_SKIPPED_LOG_MAX`**(新規定数、300)。
- **`runAiMorningPlan`**: AIプラン取得成功時、`aiPlan.skipped` のうち `kind:"ai"`
  (=AI自身が「配置しない」と判断した候補。空き時間との不整合による機械的な除外
  `kind:"expired"` は対象外)を `state.aiPlanSkippedLog` へ `{date, title, reason, at}` で
  記録する。
- **方針の明文化(監督者決定、2026-07-10)**: `weekly-extract.py`が直接読む生
  `AIプラン_*.json`方式を「skipped妥当率」の集計源として正とし、`aiPlanSkippedLog`は
  クライアント側文脈用の将来シグナルとしてwrite-onlyのまま残置する
  (`../taskchute-notes/decisions.md`に追記。将来集計源に切り替える場合はGitHub重複push
  の冪等化が前提条件)。

## 変更内容(styles.css)

- `.lev-mark`/`.lev-mark.lev-asset`/`.lev-mark.lev-eliminate`: leverageTypeの控えめマーク
  (`migration-badge`と同系統の丸バッジ)。asset=緑系、eliminate=紫系(既存の`--green-soft`/
  `--purple-soft`変数を再利用、新規カラー定義なし)。
- `.lev-helper`/`.lev-helper summary`/`.lev-helper-body`: 10秒判定ヘルプの折りたたみ
  (`.journal-prompts`と同じ▶マーカー回転パターンを再利用)。

## 変更内容(tests/v57.test.js、実装無改修のテスト側修正)

- 実行時刻が深夜0時を跨ぐと `new Date()` ベースのTODAY/YESTERDAY判定が[1]/[2]間でズレて
  フレーキーになる指摘に対応。他スイート(v61/v62/v63)と同じ `page.clock.setFixedTime` で
  ページ内の現在時刻を日中(10:00)に固定した。アプリ本体(app.js)は無改修。

## 実装判断(仕様から補った点)

1. **設計書v65節の2-2(レバレッジ台帳)・2-4(マイグレーション儀式へのAvoid List選択肢追加)は
   今回対象外とした**: `designs/10x-mechanism.md` のv65節本文には2-2/2-4も含まれるが、
   監督者からの実装指示(実装内容1〜4)には明記されていなかったため、指示された範囲
   (2-1属性+§1判定ヘルプ+2-3後段のAIプラン連携+週次1行集計)のみを実装した。
   次サイクルでの追加要否は監督者判断を仰ぐ(スコープを黙って広げない方針のため)。
2. **oneoffは一覧・タイムラインでマーク非表示にした**: 3値のうちoneoff(一回きり=通常の2x
   作業)は判断上ニュートラルであり、常時マークすると視覚ノイズが増え「毎タスクに10x/2xを
   問う」歯止め(設計書6章)に反すると判断した。編集モーダルのselectには選択肢として残す。
3. **10秒判定ヘルパーはAI呼び出しをしない静的UIとした**: 設計書§1本文は「Task/Block登録時、
   または週次レビューで問う」形式のみを想定しているが、v60方針(アプリ内AI呼び出し全廃)と
   矛盾しないよう、3問はアプリ側に静的テキストとして埋め込み、判定はチェック数のその場計算
   (クライアントサイドのみ)に留めた。
4. **AIプランのcarryFromId経由(繰越由来)候補や決定論配置(fallbackMorningPlan)には
   leverageType伝播を実装しなかった**: 設計書2-3後段は「AIプランのtitle」の検出のみを
   求めており、決定論配置パイプラインへの拡張は明記されていない。スコープを広げず、
   AIプラン経由(`tryFetchAiPlan`)のみに限定した。

## テスト

- `tests/v65.test.js`(新規)。以下を検証する:
  1. `normalizeState` 後方互換: 旧Task/旧Block(leverageTypeフィールド無し)に `""` が
     補完される。旧state(aiPlanSkippedLogフィールド自体が無い)にも `[]` が補完される
  2. Task編集モーダルでleverageType(資産)を選択→保存できる
  3. Block編集モーダルでleverageType(削減)を選択→保存できる
  4. 10秒判定ヘルパー: 2問以上チェック→「判定結果を反映」でselectがassetになる。
     保存せずキャンセルすると判定結果は反映されない(強制しない)
  5. 10秒判定ヘルパー: 1問だけなら未設定のまま
  6. タスクシュート一覧・WBS一覧・タイムラインにleverageTypeの控えめマークが出る
     (oneoffは非表示であることも確認)
  7. AIプランのtitle先頭「[資産]」検出 → 下書き段階でマーク表示 → 確定後のBlockに
     leverageType=assetが自動付与される(プレフィックス無し項目は影響を受けない)
  8. v64設計§3残余: AIプラン自身のskipped(kind:"ai")がaiPlanSkippedLogへ記録される
  9. 週次レビュータブのbucketゲージ下にleverageType別実績時間の1行集計が表示される
- `tests/v57.test.js`(修正): clock固定化後もALL PASS(既存の検証内容は無変更)。
- 開発中は `node tests/run-all.js v65` で絞り込み実行。
- 納品前に全量 `npm test`(`node tests/run-all.js`)を実行し、14スイート全てALL PASSを確認済み。

## 変更ファイル

- `app.js`
- `styles.css`(`.lev-mark*` / `.lev-helper*`)
- `sw.js`(`CACHE_NAME` を `v63` → `v65`)
- `tests/v57.test.js`(修正: clock固定化)
- `tests/v65.test.js`(新規)
- `CHANGES_v65.md`(本ファイル)
- `../taskchute-notes/handoff.md`(notes リポジトリ側、本エントリ追記)

## 実機テスト手順

1. `sw.js?nocache=YYYYMMDD` を開き、1行目が `taskchute-journal-pwa-v65` になっていることを確認。
2. WBS/タスクシュートでTask・Blockを編集し、「レバレッジ(10x機構・任意)」selectで
   資産/削減/一回きり/未設定を切り替えて保存できることを確認する。
3. 同モーダル内「10秒で判定する(任意)」を開き、3問中2問以上チェック→「判定結果を反映」で
   selectが「資産」になることを確認する(保存を押すまでは反映されない)。
4. leverageTypeを設定したTask/Blockが、タスクシュート一覧・WBS一覧・タイムラインカードに
   控えめなマーク(⚙資産/✂削減)で出ることを確認する(一回きりはマーク無し)。
5. 自宅PCバッチが生成する `AIプラン_YYYY-MM-DD.json` のplan項目titleに `[資産]` を付けて
   朝プランを実行し、下書き・確定後のBlockに⚙資産マークが付くことを確認する。
6. 週次レビュータブの「戦略/雑用/休息配分」の下に、資産/削減/単発/未設定の実績時間1行が
   表示されることを確認する。
7. 既存のWBS/タスクシュート/タイムライン/朝プラン/週次レビューの他機能(v39〜v63)の動作が
   壊れていないことを一通り確認する。

## 確認サイン

- [ ] 実機(iPad/iPhone)で上記手順を確認
- [ ] 確認者:
- [ ] 確認日:
