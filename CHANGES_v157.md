# v157 AI機能第1弾「今日の敵」

K発注仕様(workbench/out/2026-07-27-taskchute-ai5/spec.md 機能1)。朝バッチが当日の予定を
「ラスボス風」の実況ナレーション1段落に演出し、アプリの朝の画面に表示する(ADHD支援の
面白がりレイヤー)。バッチ側実装は ClaudeCode ワークスペース側(loop/scripts/today-enemy.sh)。
本ファイルはアプリ側(taskchute-ipad)の変更点のみを記録する。

## アーキテクチャ

既存のAI連携パターン(バッチ→personal-data→アプリfetch、ai-linked-app-dev Skill)をそのまま
踏襲。アプリ内からAI APIは一切呼ばない。生成物が無い日はカードごと出さない(決定論フォール
バック=非表示。既存機能を壊さない)。

## 変更内容(app.js)

1. `cachedTodayEnemyMd`(非永続、セッションメモリのみ)を新設。`hydrateStaticMarkdown()` 内で
   `今日の敵_<実際の今日>.md` を1回だけfetchする(AIフィードバックと異なり前日分の無条件fetch
   は行わない。当日限定の演出のため)。ファイルが無ければ404を静かに無視。
2. `homeTodayEnemyCard(isToday)` を新設。ホーム「今日」タブの hero直後に、既定openの折りたたみ
   カード(`homeFoldSection`、`👹 今日の敵`)としてナレーション本文を表示する。
   - 過去日の閲覧中(`isToday===false`)は出さない
   - 本文はプレーンテキスト契約(`FORMAT_CONTRACT.md`)のため `renderMarkdown` は使わず
     `escapeHTML` した上で `white-space:pre-wrap` 表示(Markdown/HTML記法を誤実行させない防御)
   - バッチ側の4000字上限とは別に、表示側でも4000字超は末尾を省略する二重防御
   - 「※AI演出(自動生成のジョーク文章です)」の注記を常時添える
3. `renderHomeTodayTab()` の `homeHero(blocks, isToday)` 直後に `homeTodayEnemyCard(isToday)` を
   追加。

## SWキャッシュ

`sw.js` の `CACHE_NAME` を `v156` → `v157` へ更新。

## テスト

`tests/v157.test.js` を新設(ファイルあり=表示・なし=非表示・エスケープ・折りたたみ既定open・
過去日は非表示・同一オリジンfetch無し、の6観点。2026-07-28レビュー対応・項目8で「5観点」の
誤記を修正)。4000字超クリップ表示のケースも追加済み(項目9)。既存テストへの影響は無い想定
(新規カードの追加のみで既存DOM構造・既存アクションは無変更)。

## 未対応(K承認待ち)

- `loop/scripts/today-enemy.sh` のタスクスケジューラ登録・coach-dailyチェーンへの組み込みは
  実施していない(spec通り単体実行検証まで)。
