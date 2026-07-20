# v131 体力予算・睡眠カードの鮮度フォールバック

## 根本原因(実データ解析で確定)

AutoSleepのCSVは各日レコードを夜21:00に確定する(実CSVのISO8601列がすべて
`20:59:59+09:00`)。そのため**朝の書き出しには構造的に直前の夜が含まれない**。
v128(体力予算)・既存の睡眠カード(v105)はどちらも`state.sleep.logs[当日キー]`のみを
参照していたため、実運用では毎朝、睡眠カードが常に「⚠️前夜の睡眠CSVが未アップロードです」、
体力予算が常に「データなし」になっていた(2026-07-20実運用で確認)。CSVのパース自体
(v120で表記揺れ対応済み)は正常に動作しており、原因は「当日キーがそもそも朝の時点で
存在しない」という参照側の設計だった。

## 変更点(app.js)

- `latestSleepLogWithin(date, maxAgeDays=2)`を新設。`state.sleep.logs[date]`があればそれ
  (`ageDays: 0`)、無ければ`date-1`、`date-2`の順に遡って最初に見つかったログを返す
  (`{log, logDate, ageDays}`)。2日以内に1件も無ければ`null`。
- `conditionBudget(date)`: `state.sleep.logs[date]`直接参照から`latestSleepLogWithin(date)`
  経由に変更。フォールバックした(`ageDays > 0`)場合、`reason`の先頭に`M/D朝`ラベルを付ける
  (例: `低予算(7/19朝: HRV -12%・睡眠5.2h)`)。**根拠が0件(通常判定)でもラベルは必ず出す**
  (「今日は通常」と黙って誤読されるのを防ぐ)。**ベースライン計算(過去28日中央値、
  `conditionBudgetBaseline`)は変更していない**——常に引数`date`基準(フォールバック元の
  `logDate`ではない)。2日以内に1件も無い日は従来どおり`level:"none"`。
- `renderSleepCard(date)`: 同じく`latestSleepLogWithin`経由に変更。フォールバックした場合、
  ヘッダを`💤 前夜の睡眠`から`💤 M/D朝のデータ(前夜分はAutoSleep未確定)`に切り替える。
  赤警告(`⚠️ 前夜の睡眠CSVが未アップロードです`)は**2日以内に1件も無い場合のみ**に変更
  (従来は当日キーが無いだけで常に出ていた)。
- `homeConditionBudgetChip()` / 日報`generateReport()`の体力予算行は無変更——`conditionBudget()`
  の`reason`に日付ラベルが既に含まれるため、呼び出し側の変更は不要だった。

## 変更点(loop側)

- `loop/scripts/daily-report-fallback.py`: `latest_sleep_log_within()`をapp.jsと完全に同じ
  ロジックで実装し、`condition_budget()`を同じフォールバック+ラベル付けに更新した。
- `loop/FORMAT_CONTRACT.md`: `## 1. サマリ`行の備考へ鮮度フォールバック規則を追記、専用の
  日付節を追加。
- `loop/coach/daily-review.md`: 体力予算の観点(7点目)に「表示は前日朝データの場合がある
  (日付が明示される)」を1文追記。

## 検証手順

1. `node --check app.js` / `node --check sw.js`
2. `node tests/run-all.js v131 v128 v105 v120`
3. `node tests/run-core.js`(直近5件+固定横断コア5本、回帰確認)
4. `PYTHONUTF8=1 python loop/scripts/daily-report-fallback.py <date> <合成app-state.json> <出力.md>`
   で前日のみログがあるケースの体力予算行がapp.js側と同じ書式になることを手動確認済み
   (`体力予算: 低予算(7/19朝: 睡眠6.0h)`)。
