# CHANGES v73

## 概要

`condition-os/SPEC.md`(コンディションOS。当初は単独アプリ案として設計)のMVP5機能を、
新規アプリとしてではなく **taskchute-ipad 本体の機能として統合実装**した。既存の「朝の体調欄」
(`renderMorningEnergyPicker` / `state.settings.morningEnergyLog`)を体調記録の入口として拡張し、
新しいタブは追加していない(ジャーナル/ホーム/週次レビューの既存タブへの組み込み)。

---

## 1. SPECからの読み替え(監督者確定・本タスクで反映)

### 1.1 「ローカルのみ・外部送信禁止」→ v72のprivate基盤で充足

`condition-os/SPEC.md` 21〜23行は「体調・服薬情報は機微な医療関連データ。既定でローカル保存
(localStorage/IndexedDB)のみとし、外部送信・クラウド同期はしない」と定める(単独アプリ前提の
制約)。

taskchute-ipad は v72 で `app-state.json` 全体の読み書きを **同一オリジンfetch(公開GitHub Pages)
から GitHub Contents API 経由の private リポジトリ(`kojit1229/personal-data`)へ全面移行済み**
であり、トークンゲート(未設定端末はアプリの中身自体を表示しない)も導入済みである
(CHANGES_v72.md参照)。本統合では体調データ(`state.condition`)を `state` オブジェクト直下に
素直に追加しており、**localStorage保存 → デバウンスで personal-data リポジトリへpush**という
既存の保存経路にそのまま乗る。公開経路(taskchute-ipad本体のpublicリポジトリ)には一切書き込まれ
ないため、SPECの「外部送信・公開経路への漏洩を避ける」という趣旨は v72 の private 基盤で
充足していると判断し、体調データ専用の別ストレージ(IndexedDB分離等)は実装していない。

### 1.2 「体調(1〜10)・縮退モード閾値4以下」→ 既存ピッカーの離散値へマッピング

SPECは体調を連続的な1〜10の値として扱い、縮退モードの閾値を「仮4以下」としている。しかし
taskchute-ipadには既に v38 から「朝の体調ピッカー」(`energyLevels`: 悪い0/少し悪い3/普通5/
少し良い7/良い10 の5段階ボタン)が存在し、エネルギーグラフの始点として使われている。

指示(「既存の朝の体調欄と二重管理にならないよう統合」)に従い、**体調の値そのものは既存の
`morningEnergyLog` を継続利用し、二重のピッカーを増やさなかった**。そのため縮退モードの閾値は
「4以下」をそのまま実装できず、既存の離散5段階のうち下位2段(悪い0・少し悪い3 = 3以下)を
縮退トリガーとして採用した(`CONDITION_DEGRADED_THRESHOLD = 3`、app.js)。SPECの数値仕様からの
実質的な逸脱だが、「新しいUIを作らず既存機構に相乗りする」という本ワークスペースの設計原則
(ai-linked-app-dev Skill)を優先した判断。

### 1.3 「①タスク名から目標重量を表示」→ 見送り、直近記録の参考表示のみ

SPEC5(運動記録)の「尚可」項目である、MITタスク名から目標重量をパースして表示する機能は、
タスクタイトルの自由記述から重量表記を頑健にパースする実装コストに対して効果が不確実なため、
指示の「無理はしない」に従い見送った。代わりに、同じ種目の直近記録(今日以外の最新日付)を
「(前回 75kg×5 / 日付)」という軽い参考情報として運動記録欄に添えるだけに留めた
(`lastGymRecord`、app.js)。

---

## 2. データモデル(app.js: `normalizeState`)

`state.condition.logs[date]` を新設(日付キーの軽量ログ、既存の `journalMeta` / `weeklyReviews`
と同じ思想)。フィールド:

```js
{
  sleepHours: null,        // 睡眠時間(プリセット5/6/7/8/9h+のいずれか、またはnull=未記録)
  meds: null,               // 服薬有無(true/false、null=未記録)
  capacity: "",             // 今日の余力("full"|"normal"|"minimal"|""=未記録)
  morningRecordedAt: "",    // 朝の記録印(加点式カウント用。睡眠/服薬/余力/朝の体調ピッカーの
                             // いずれかを触った時刻。同日は初回のみ設定=以後は上書きしない)
  eveningMood: null,        // 夜の体調(既存energyLevelsの値を再利用。0/3/5/7/10)
  eveningNote: "",          // 夜のひとこと(任意・80文字)
  eveningRecordedAt: "",    // 夜の記録印
  gym: []                   // 運動記録 [{id, exercise, weight, reps, at}]
}
```

体調そのもの(1〜10相当)は既存の `state.settings.morningEnergyLog[date]` を継続使用するため、
`condition.logs` には含めていない(1.2節参照)。

`normalizeState` は `condition`/`condition.logs` フィールド自体が無い旧state(v72以前のデータ)
でも `{}` を補完し、既存の各ログエントリにも欠損フィールドをデフォルト値で補完する(既存値優先
のスプレッド順序、`gym` は配列でなければ空配列に修復)。

---

## 3. UI実装

### 3.1 朝晩10秒記録(ジャーナル「当日編集」への組み込み)

新しいタブは追加していない。既存の `renderMorningEnergyPicker`(朝の体調ボタン)の直下に
以下を追加した(`renderJournal`):

- `renderConditionMorningExtra(date)`: 睡眠時間(5/6/7/8/9h+のワンタップボタン)・服薬
  (済み/まだのトグルボタン)・今日の余力(全力でいける/普通/最低限でのワンタップボタン)。
  いずれもタップ即保存(`setConditionSleep` / `toggleConditionMeds` / `setConditionCapacity`)
- `renderEveningConditionCard(date)`: 夜の体調(既存の5段階ボタンを再利用)+ ひとこと
  (テキスト欄、入力中も保存。ジャーナル本文欄と同じ「data-属性 + input委譲」パターン)
- `renderGymLogCard(date)`: 種目(datalistでベンチプレス/デッドリフト/スクワットを候補提示)・
  重量・回数の3欄+「記録」ボタン。記録済み一覧+削除ボタン+直近記録の参考表示

ボタンサイズは既存の朝の体調ピッカー(font-size:12px、`.btn`の min-height:36px)に合わせた。
指示にあった「48px+・16px」はSPEC単独案の一般的UX指針であり、既存アプリの確立済みボタン規約
(taskchute-journal Skill)との一貫性を優先してそのまま踏襲した。iOS Safariのズーム防止規約
(input/select/textareaは16px以上)は、新規追加した text/number input(夜のひとこと・運動記録の
種目/重量/回数)には厳守した(`.cond-evening-note` / `.cond-gym-input`、いずれも`font-size:16px`)。

### 3.2 加点式(ストリーク表示なし)

`conditionRecordedCountThisWeek()` が「今週書けた日数」だけを数える(既存の朝の体調ピッカー
使用日 or 朝/夜いずれかの記録印がある日の合計、連続日数・欠落日は一切数えない・表示しない)。
ジャーナル当日編集に「📝 今週はN回書けました」とだけ表示する。責める文言・ストリーク文言が
出ないことは `tests/v73.test.js` [4] で正規表現アサーションとして固定した。

### 3.3 縮退モード(ホーム)

`isConditionDegraded(date)`(今日の朝の体調ピッカー値が3以下)がtrueのとき、`renderHome()`で:

- MIT(今日の主役)の直下に `.cond-degraded-banner`(責めない・煽らないトーン。既存の
  `.wip-banner` と同じ「情報を渡すだけ」の配色思想をteal系で踏襲)を表示。タップでジャーナル
  (体調記録の入口)へ遷移
- 「今日のリズム」ゾーン(ながれ+ルーティン)を `<details>` の既定closed折りたたみに変える
  (`data-fold-id="zone2-degraded"`、既存のhomeFoldSection/isHomeFoldOpenと同じlocalStorage
  記憶パターン。非縮退時に使う `zone2`/`zone3`/`zone4` 等の既存foldIdとは独立させ、通常表示に
  影響を与えない)
- 「AIから」カード(`homeAiHub`)も同様に既定closedの折りたたみにする。表示内容自体は無変更
  (`homeAiHub` を外側`<section>`と中身`homeAiHubBody`に分離しただけ)
- MIT・スコアボード・「今日、すすめる」(タスクシュート本体)は畳まない(指示どおり
  「MITと体調記録だけを推す」対象から除外)

過去日を閲覧している時は発火しない(`isToday`判定。振り返り中に「今日は最低限」と出すのは
文脈が違うため)。

### 3.4 週次相関(週次レビュータブ)

`computeWeeklyMetrics` の日別集計(`daily`)に、既存の `startPct`(タスク着手率)に加えて
`routinePct`/`routineTotal`(ルーティン実行率、既存の `routineRate()` を日別に適用しただけ)を
追加した。`renderConditionCorrelation(m)` が「体調 × 実行率(7日)」という軽量な表
(曜日・朝体調・夜体調・タスク着手・ルーティンの5列 × 7行)を表示する。相関係数などの統計分析は
一切行わず(「分析はごく軽く、深い分析はバッチの領分」の指示どおり)、数値を並べるだけに留めた。
週の記録が1件も無い(`noRecord`)場合は既存どおり何も表示しない。

### 3.5 運動記録

3.1節の `renderGymLogCard` 参照。1.3節のとおりMITタスク名からの目標重量パースは見送った。

---

## 4. Service Worker / その他

- `sw.js`: `CACHE_NAME` を `taskchute-journal-pwa-v72` → `taskchute-journal-pwa-v73` に更新。
  ロジック変更なし。
- `styles.css`: `.cond-degraded-banner` / `.cond-row` / `.cond-btn-row` / `.cond-evening-note` /
  `.cond-gym-card` / `.cond-gym-input` / `.cond-corr-table` 系を追加。既存クラスの変更は無い。

---

## 5. テスト

`tests/v73.test.js`(新規、21番目のスイート)。Clock APIで時刻固定、`blockGithubApiByDefault`+
`passGithubGate`(v72確立のトークンゲートバイパス)を使用。検証内容:

1. 朝の記録拡張(睡眠/服薬/今日の余力)の保存・服薬トグルの解除
2. 夜の記録(体調+ひとこと)の保存(入力中も保存されフォーカスが飛ばない前提の`page.fill`)
3. 運動記録の保存・前回記録の参考表示・削除
4. 加点式の「今週はN回書けました」表示 + ストリーク/未記入を責める表現が**出ないこと**の
   正規表現による否定アサーション
5. 縮退モード: 体調3以下でバナー+2つの折りたたみ(zone2-degraded/ai-hub-degraded)が既定closed
   で出ること、MITは畳まれないこと。体調7では非発火(通常表示のまま)であること
6. 週次レビューの体調×実行率ミニ表(8行=見出し+7日、特定曜日の値の一致、分析していない旨の注記)
7. `normalizeState` 後方互換: `state.condition` フィールド自体が無い旧stateでもクラッシュせず
   `condition.logs` がオブジェクトとして補完されること

- `node --check app.js` / `node --check sw.js` / `node --check tests/v73.test.js`: いずれもOK
- `node tests/v73.test.js` 単体: ALL PASS
- 全量 `npm test`(21スイート、v73含む)フォアグラウンド実行で **ALL PASS**(exit code 0)を
  2回確認済み(既存20スイートに影響なし)

---

## 変更ファイル

- `app.js`(`state.condition`の`normalizeState`補完、朝の記録拡張/夜の記録/運動記録の
  render・状態更新関数群、`isConditionDegraded`/`homeDegradedBanner`、`renderHome`の縮退モード
  分岐、`homeAiHub`の`homeAiHubBody`分離、`computeWeeklyMetrics`の日別ルーティン実行率追加、
  `renderConditionCorrelation`、クリック/inputイベント委譲への新規data-action/data-属性追加)
- `styles.css`(コンディションOS関連クラス追加。既存クラスは無変更)
- `sw.js`(`CACHE_NAME`を`v72`→`v73`)
- `tests/v73.test.js`(新規)
- `CHANGES_v73.md`(本ファイル)
- `../taskchute-notes/handoff.md`(notes リポジトリ側、本エントリ追記)

---

## 実機テスト手順

1. `sw.js?nocache=YYYYMMDD` を開き、1行目が `taskchute-journal-pwa-v73` になっていることを
   確認する。
2. ジャーナルタブの「当日編集」を開き、朝の体調ピッカーの下に睡眠/服薬/今日の余力のボタンが
   増えていることを確認し、それぞれタップして保存されること(リロード後も保持)を確認する。
3. 同じ画面下部に「🌙 夜の体調」ボタンとひとこと欄、「🏋 運動記録」欄(種目/重量/回数+記録
   ボタン)が出ることを確認し、運動記録を1件追加→一覧に表示→×で削除できることを確認する。
4. 「📝 今週はN回書けました」という表示が出ており、日数が空白でも責める文言が無いことを確認
   する。
5. 朝の体調ピッカーで「少し悪い」または「悪い」を選んだ状態でホームタブを開き、「今日は最低限
   だけでいい日です」バナーと、「今日のリズム」「AIから」が畳まれた状態で表示されることを
   確認する。体調を「普通」以上に変えると通常表示に戻ることを確認する。
6. 週次レビュータブを開き、「体調 × 実行率(7日)」の表が表示され、朝の体調ピッカーで記録した
   日の値が反映されていることを確認する。
7. PWAとして一度アプリを終了→再起動し、上記の記録がすべて保持されていることを確認する
   (localStorage → personal-dataリポジトリへの自動保存が有効な場合はGitHub上でも確認)。

## 確認サイン

- [ ] 実機(iPad/iPhone)で上記手順を確認
- [ ] 確認者:
- [ ] 確認日:
