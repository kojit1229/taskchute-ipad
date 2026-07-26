# v142 計器盤「睡眠」セクション + 日次結合ヘルパー computeDailyMetrics

承認済み設計(`workbench/out/2026-07-26-taskchute-revamp/design-proposal.md` §0+P1)への対応。
睡眠(実測)・主観コンディション・Block実績(着手率/充放電)が別々のサイロで突き合わせが
無かった状態に、共通の日次結合ヘルパーを1つ作り、計器盤に「睡眠」セクションを新設した。

## computeDailyMetrics(dateKey)

`app.js`に新設した純関数(保存しない、renderStatsと同じ都度計算思想)。
`state.sleep.logs[dateKey]`(実測: bed/wake/sleepH/eff/deepH/hrSleep/hrvSleep)、
`state.condition.logs[dateKey]`(主観: sleepHours/capacity/gym)、`state.blocks`の
当日実績(startPct/startTotal/completedCount/chargeSum/dischargeSum/net)を1つの
オブジェクトへ結合して返す。

実測と主観は統合しない(現状維持)。`sleepHFinal`は実測`sleepH`が無い日だけ主観
`sleepHours`をフォールバックとして使う値で、`sleepHIsSubjective`で由来を注釈できる
(ただし今回の睡眠帯別比較は「実測sleepH基準」の設計どおり、フォールバック値は帯集計に
含めていない — 実測/主観が分析ロジック上で混同されないことをテストで確認済み)。
`sleep.logs`は起床日をキーに持つため、dateKeyのblocks実績とそのまま組み合わせれば
「前夜の睡眠→その日の実績」の対応になり、日付シフトは不要。

## 計器盤「睡眠」セクション(renderSleepStats)

`renderStats()`の肥大化を避けるため、`renderSleepStats()`(+内部の
`renderSleepBandCard`/`renderSleepTrendCard`/`renderSleepBucketCard`/
`sleepValuesForRange`)を別関数として切り出し、`renderStats()`からは呼ぶだけにした。
3部品ともデータ不足時は自前のガードで空文字を返し、3部品すべて空なら「睡眠」セクション
自体を非表示にする(静かな計器)。

1. **就寝・起床の帯グラフ**(直近4週固定。stats-rangeの4w/12w/all切替には追従しない設計
   どおり): 軸を20時〜翌10時の14時間窓に固定し、bed/wakeの時刻をその窓へ写像して横バー
   で描画。軸窓と矛盾する異常な並び(right<=left)の日はバーを描かず黙ってスキップする
   (クラッシュではなく非表示を選んだ)。
2. **睡眠時間トレンド+中央値ベースライン**: stats-range(4w/12w/all)のsinceに追従して
   実測sleepHをトレンド線に載せ、直近28日分(today当日を含む窓)の中央値
   (`CONDITION_BUDGET_BASELINE_MIN_SAMPLES`=7件未満ならベースライン非表示)を
   ベースライン線として重ねる。既存の`conditionBudgetBaseline`は当日を含まない過去28日窓
   (`addDays(date,-28)`〜`addDays(date,-1)`)で、共通なのは最小サンプル数の定数のみ
   ——窓の取り方自体は別物(下記「自信がない箇所」参照)。5.5h/6.5hの目安線は控えめな
   破線(裁かない)。
3. **睡眠帯別 当日実績(中央値)**: sleepHを4帯(<5.5 / 5.5-6.5 / 6.5-7.5 / >7.5h)に分け、
   各帯の当日着手率・エネルギーnetの中央値を表示。3件未満の帯は非表示(renderStats既存の
   ヒートマップ/見積カードと同じ最小件数ガードを踏襲)。

## 既知バグの再確認(decisions.md 2026-07-20 v131記載)

`log.sleepH.toFixed(1)`のような生値への直接呼び出しは`conditionBudget`側でv137時点で
既に`toNumber()`ガード済みであることを確認した(未修正のまま残っていたのは指摘コメントの
記述のみ)。今回新設した`computeDailyMetrics`および睡眠セクションの表示箇所はすべて
既存の共通ガード`toNumber()`を経由させ、CSVの非正規state(sleepHが数値文字列)でも
クラッシュしないことをテストで確認した。

## 変更ファイル

- `app.js`: `computeDailyMetrics()`新設(renderSleepCardの直後)。`sleepValuesForRange()`/
  `oldestSleepLogDate()`/`buildBlocksByDateMap()`/`renderSleepBandCard()`/
  `renderSleepTrendCard()`/`renderSleepBucketCard()`/`SLEEP_BUCKETS`/
  `SLEEP_BUCKET_MIN_SAMPLES`/`renderSleepStats()`を新設(statsRangeWeeksの直後、
  renderStatsの前)。`renderStats()`に`oldestSleep`/`sleepSince`のローカル変数を追加し、
  `sleepStatsCard`(=`renderSleepStats(sleepSince, today)`)を呼ぶ数行のみ変更。
- `styles.css`: `.stats-sleep-*`(帯グラフ・帯別比較の行/トラック/バー)のCSSを追加
  (`.stats-hist-lab`の直後)。既存の`.progress`/`.stats-div-track`/`.stats-line-svg`を
  再利用しており、新規追加は帯グラフ専用のレイアウトのみ。
- `sw.js`: CACHE_NAME を v141→v142 に更新。
- `tests/v142.test.js`(新規): computeDailyMetricsの単体的な検証(帯グラフ・トレンド・
  帯別比較のDOM描画結果を通した間接検証。app.jsはtype=moduleでinternalsをwindowに
  露出しないため、既存のv53系テストと同じ流儀)+ 睡眠セクションの表示/非表示/
  最小件数ガード/stats-range切替時の帯グラフ固定/実測と主観の非混同/文字列sleepHの
  型安全性。

## テスト

`node tests/v142.test.js` 単体PASS。
`node tests/run-all.js v53 v54 v73 v128 v131 v141`(睡眠・計器盤・コンディションOS関連の
既存スイート)ALL PASS(回帰なし)。
`npm run test:core` ALL PASS(149.2s、v142含む直近5本+固定コア5本)。
`npm test`(全量)はpush前に別途実行して確認する。

## レビュー対応(2026-07-26、Codex+Claude 2系統レビュー後の追記)

push前に指摘された9件すべてに対応した(commit/pushはまだしていない)。

**必須修正(正確性)**
1. 「全期間」レンジでBlockより古い睡眠ログが除外される件: `oldestSleepLogDate()`を新設し、
   `renderStats()`で`range === "all"`のときだけ睡眠ログの最古日がBlock由来の`since`より
   前ならそちらを起点にする`sleepSince`を計算し、`renderSleepStats(sleepSince, today)`へ
   渡すよう変更(他チャートが使う共有`since`は変えていない)。テストに回帰確認を追加
   (Blockの無い古い睡眠ログが「全期間」でのみ取り込まれることを確認)。
2. 帯別比較のガードが対サンプル数(startVals/netVals)を見ておらず、r.n(帯の睡眠件数)
   >=3でも実際の着手率/net計算に使うサンプルが1〜2件の可能性があった件: `startVals.length`/
   `netVals.length`それぞれに`SLEEP_BUCKET_MIN_SAMPLES`(=3)の閾値を適用し、満たない側は
   「—」表示にした。あわせてnetValsが空のとき`netMed`が`0`(「+0」表示)になっていた問題も
   `null`→「—」に統一(着手率側と同じ扱い)。

**推奨修正(品質)**
3. 帯グラフの説明文に「日付は起床日(就寝バーは前夜分)」を追記。
4. 帯グラフのtitle属性(`${r.date}`/`${r.bar.bed}`/`${r.bar.wake}`)に`escapeHTML()`を適用。
5. 本文2節・「自信がない箇所」の「conditionBudgetBaselineと同じ」という記述を訂正
   (新実装は当日を含む28日窓、既存baselineは当日を除く28日窓。共通なのは最小サンプル数
   の定数のみ)。
6. 全期間時の計算量 O(日数×全Block数) を解消: `buildBlocksByDateMap()`で日付→Block配列の
   Mapを1回だけ構築し、`computeDailyMetrics(dateKey, { blocksByDate })`の第2引数として渡す
   形にした。`renderSleepBucketCard`の一括集計だけがこれを使う。`opts`省略時(単発呼び出し)
   は従来どおり`state.blocks`をその場でfilterする後方互換を維持。
7. `computeDailyMetrics`の主観系に`meds`(condition.logsに実在。設計書§0のgym/meds注釈に
   対応)を追加。
8. `tests/v142.test.js`を強化: (a) `lt55.includes("0%")`が"100%"にもマッチしてしまう問題を
   `(?<!\d)N%(?!\d)`の否定先読み正規表現に差し替えて厳密化(net側の数値も同様に厳密化)。
   (b) 帯別の日数チェックを、パネル全体テキストへのincludes判定からbucketRows由来の
   行スコープ変数(lt55/mid1/mid2/gt75)へ統合し、ラベルと件数が同じ行由来であることを
   保証。(c) 恒真だった`check("pageerrorが起きていない...", true)`を削除(pageerrorは
   `page.on("pageerror")`で既に自動検知・failuresへ計上されるため、この行は検証として
   意味を持っていなかった)。(d) 「ログ無し3日+異常1日」というコメント誤り(実際は
   ログ無し2日+異常1日=計3日除外)を修正。
9. 着手率の定義が計器盤先頭チャート(`taskchuteStartRate`。Task紐づけ済みBlockが分母)と
   睡眠帯別(`computeDailyMetrics`のplannedBlocks、Task紐づけ不問)で異なる件を
   `taskchute-notes/decisions.md`へ1エントリ追記した(commitはしていない)。

**レビュー対応後のテスト**: `tests/v142.test.js`に(1e)対サンプル不足時の「—」表示ガードと
(4)全期間レンジの古い睡眠ログ取り込み(4w/12wは影響を受けないことも確認)の2ケースを追加。
`node tests/v142.test.js` 単体PASS(全30チェック超)。`node tests/run-all.js v142` ALL PASS。
`npm run test:core` ALL PASS(159.7s、v142含む直近5本+固定コア5本、回帰なし)。
`npm test`(全量)はpush前に別途実行して確認する。

## 自信がない箇所・未対応

- 睡眠時間トレンドのベースライン(直近28日中央値)は常に「today基準の固定28日窓
  (todayを含む)」で計算しており、stats-rangeを過去に遡って見ても(仕様上そのような画面は
  無いが)ベースライン自体は動かない。既存の`conditionBudgetBaseline`は当日を含まない
  過去28日窓なので、今回の実装とは窓の取り方が異なる(共通なのは最小サンプル数7件の定数
  のみ。CHANGES本文2節で訂正済み)。要件文の「28日中央値をそのまま可視化」の解釈が
  これで合っているかは要確認。
- 帯グラフの軸窓(20時〜翌10時固定)は一般的な就寝パターンを想定した固定値。深夜勤務等で
  常時軸窓外の生活パターンの場合、バーが縮んで見えにくくなる可能性があるが、今回のK自身の
  実データ(31件、AutoSleep由来)には該当しないため対応を保留した。
