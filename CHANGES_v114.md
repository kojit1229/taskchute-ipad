# CHANGES v114

## 概要

ROADMAP「TOC由来の提案F」(2026-07-16 K採用)。運動・睡眠・内省・家族時間などの
ルーティンは「実行率」で裁くべきではない(制約理論でいう「制約=集中力・体力を保護する
メンテナンス工程」であり、実行率は忙しさの指標であってメンテの良し悪しを測らない)。
代わりに『Atomic Habits』のNever miss twice原則(1回のミスは事故、2回連続からが
習慣を殺す故障予兆)に基づき「連続欠落日数」で見せる新機能を実装した。
SW `CACHE_NAME` を v113 → v114 に更新。

## 変更内容

### app.js

- `state.recurrences[]`の各要素に`protection`属性(boolean、既定false)を追加。
  - `createRecurrenceRule()`: 新規作成時に`protection: false`を明示。
  - `normalizeState()`: 既存ルールへの後方互換マイグレーション(`protection: false`を
    デフォルトとしてスプレッド、既存値があればそちらを優先)。
- `computeProtectionMissedStreak(ruleId, targetDateISO)`: `loop/scripts/canary-check.py`の
  `compute_missed_streak`と同じ判定ロジックのJS版(決定論・AI呼び出し無し)。
  `recurrenceGroupId`でBlock群と突合し、対象日から過去へ1日ずつ遡って
  - ブロックが1件も無い日 → そこで打ち切り(データ欠落、それ以前は数えない)
  - 1件でも`completed:true`があれば → そこで打ち切り
  - 全件`completed:false`なら → 連続加算して前日へ
  を`MAX_LOOKBACK_DAYS`(14日、Python版と同じ既定値)まで繰り返す。
- `protectionRuleFor(block)` / `protectionStreakBadgeHTML(block)`: Blockが
  `protection:true`のルールに属していればバッジHTMLを返す(属していなければ空文字=
  何も表示しない)。
- 表示配線:
  - `renderRoutineCard()`(ルーティンタブ): カテゴリチップの隣に連続欠落バッジを追加。
  - `homeRoutine()`(ホーム「今日のルーティン」): `homeCheckRow()`に第4引数
    `extraBadge`を追加(既存の他呼び出し元は未指定=影響なし)し、保護系ルーティンの
    行にだけバッジを表示。実行率%の集計は`protection`の有無に関係なく全ルーティンを
    分母に含めたまま変更していない。
  - Block編集モーダル(`buildBlockModal`): カテゴリ「ルーティン」の繰り返し済みBlockを
    編集する際、「制約保護系(運動・睡眠・内省・家族時間など)」チェックボックスを表示。
  - `saveBlockFromModal()`: チェックボックスのON/OFFをルールへ反映(kind変更を伴う
    保存・伴わない保存の両経路に対応)。チェックボックスが存在しない画面
    (非ルーティンカテゴリ・繰り返し未設定など)では`fields.protection`が`undefined`の
    ため何もせず、既存挙動に影響しない。

### styles.css

- `.protection-badge`(0〜1日欠落・緑系、警告なし)/`.protection-badge.warn`
  (2日以上欠落・オレンジ系)を追加。`cond-degraded-banner`/`routine-check-banner`と
  同じ「責めない・煽らない」トーンの配色(赤は使わない)。バッジ文言も
  「連続◯日欠落・今日やれば止められます」という復帰喚起のみで、「危険」等の
  煽り表現は使っていない。

### sw.js

- `CACHE_NAME`を`taskchute-journal-pwa-v114`に更新。

## 検証

- `node --check app.js` / `node --check sw.js` / `node --check tests/v114.test.js`
  すべてexit 0(データモデルのみの中間状態・UI配線後の最終状態、両方で確認)。
- `tests/v114.test.js`(新規、16チェック)ALL PASS:
  (1) normalizeStateマイグレーション(protection無し旧データへのfalse補完・
  protection:trueの維持)、(2) 連続欠落日数の計算(連続3日・連続1日の2パターン)、
  (3) 2日未満は警告なし・2日以上は警告色、(4) protection:falseの既存ルーティンには
  バッジが出ず実行率%の集計も従来どおり、(5) 編集モーダルのチェックボックスON/OFFで
  ルールが更新されバッジ表示が即座に反映される(往復両方向)。
- `npm run test:core`(直近5件 + 固定コア5件、v114含む計10スイート)ALL PASS。

## 未対応・懸念点

- ROADMAP提案G(縮退版+連続ルーティン)・H(週次レビューの「保護系は削らない」ガード)は
  本バージョンのスコープ外(提案Fのみを対象とした)。Hはバッチ側(`loop/coach/weekly-review.md`)
  のみの変更でFに依存しないため、次回以降の対応候補として引き続き有効。
- 保護系チェックボックスはカテゴリ「ルーティン」かつ繰り返し設定済み(liveRule存在)の
  Blockでのみ表示される(既存のexpectedCharge/expectedDischarge欄と同じ表示条件に揃えた)。
  単発Block・非ルーティンカテゴリの繰り返しからは設定できない仕様だが、これはK依頼の
  「運動・睡眠・内省・家族時間などのルーティン」という対象範囲と一致していると判断した。
- 本コミット群はローカルcommitのみでpushしていない(指示どおり。監督者レビュー後にpush予定)。
