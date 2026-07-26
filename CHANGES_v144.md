# v144 エネルギーバッテリーモデル(computeBatteryLevel + ホーム電池チップ + タイムライン実カーブ重ね描き)

承認済み設計(`workbench/out/2026-07-26-taskchute-revamp/design-proposal.md` §3=P3)への対応。
K指示(2026-07-26)「朝30あったエネルギーがデフォルトで徐々に減る(例: 1時間3ずつ)。適宜
回復させないと!という意識になるようにしたい」を、**通知・アラート無し・表示のみ**で実現する
(静かな計器の最低線=催促しない・裁かないは維持)。

**2026-07-27追記**: Codex+Claudeの2系統レビュー後、監督者裁定により集計セマンティクス・
境界検証・時間経過での自動更新を修正した(下記「レビュー対応」節参照)。本節以降は
レビュー対応後の最終仕様を記す。

## 1. computeBatteryLevel(dateKey, nowMinutes, opts) — 決定論・都度計算の純関数

```
残量 = 開始値 − 減衰率 × (減衰開始時刻からの経過時間h) + Σ(当日完了Blockのcharge−discharge)
```
を 0〜上限でクランプして返す。保存はしない(renderStatsと同じ都度計算思想)。

- **開始値(K確定)**: 体力予算(`conditionBudget`)連動で `deficit=30 / low=40 / normal=50`。
  睡眠データ無しの日(`level:"none"`)は `normal=50` 扱い。
- **減衰率(K確定)**: `3/h`、減衰開始は既定 `07:00`(起床時刻には連動させない。設定画面で
  変更可)。07:00以前は開始値のまま。
- **減衰の計算方式**: **分単位の連続計算**を採用した(1時間ごとの階段状にはしていない)。
  理由: 同じ考え方をホーム電池チップと、タイムラインの実カーブ重ね描きの両方で使い回すため、
  階段状だと重ね描きの折れ線が不自然にカクつく。
- **`nowMinutes`は必ず引数で受け取る**(関数内部で現在時刻を取得しない)。テスト容易性の
  ためで、`opts.budgetLevel`/`opts.blocks`も上書き可能。
- **チップ(現在残量)の集計は時刻フィルタなし**(レビュー対応、下記参照): `blocksForDate(dateKey)`
  の完了Block全部のcharge−discharge合計を、`actualEndAt`の時刻に関わらず合算する。

パラメタは `state.settings.battery = { start: {deficit, low, normal}, decayPerHour, decayStartMinutes, max }`
として保存し、`normalizeState`にマイグレーションを追加した(`defaultBatterySettings()`を
唯一の既定値の正本とし、既存値優先でマージ。既存データを壊さない)。

## 2. 設定画面(v116の1日バッファ/締め時刻パネルの隣に新設)

開始値3種・減衰率・減衰開始時刻・上限の6項目を編集可能にした(`class="input"`、既存パターン
と同じくfont-size 16px以上はCSSの`.input`既定に委譲)。イベントハンドラは
`[data-setting-battery-field]`の汎用1本(`"start.deficit"`のようにドット区切りでネストした
キーを指定できる)。減衰開始時刻は`type="time"`(iOS規約、下記レビュー対応参照)。

## 3. ホーム電池チップ(homeBatteryChip)

体力予算チップの直下に追加。現在残量の数値+簡易バーのみ(%閾値で色は変える。点滅・
バッジ・通知・アラートは一切無し)。**当日限定で表示**(過去日・未来日は非表示。下記
レビュー対応参照)。当日の完了Block変更(充放電編集・完了登録)は既存の各data-actionハンドラが
呼ぶ`render()`で自然に再描画され、時間経過(減衰)はupdateBatteryTick()(下記)が差分更新する。

## 4. タイムライン実カーブの重ね描き(renderEnergyGraph拡張)

既存の`renderEnergyGraph`(morningEnergyLog起点のSVG)は**置き換えず**、当日のバッテリー
実カーブを新しいpolylineとして重ね描きした(`batteryCurvePoints(dateKey, nowMinutes, opts)`。
既存グラフのx軸(`-maxAbs〜+maxAbs`、朝の主観エネルギーが起点)とはスケールの意味が違うため、
独立した0〜上限のスケール(中央線=0・右端=上限)を新設(`battXOf`)。既存の起点/終点ラベルは
無変更。**当日以外の日付では出さない**。

## レビュー対応(2026-07-27、Codex+Claude 2系統レビュー後、監督者裁定)

### 集計セマンティクスの裁定(両レビューの相反を解消)

- **チップ(現在残量)**: `blocksForDate(dateKey)`の完了Block全部を**時刻フィルタなしで**合算
  する(`actualEndAt`が未来時刻・翌日時刻でも当日合計に入れる)。既存のエネルギー実線
  (`renderEnergyGraph`の実績カーブ)と同じ「当日ぶん丸ごと」思想に揃えた。
- **カーブ(当日の軌跡)**: イベント時刻は`actualEndAt`の日付部分を確認し、`dateKey`と同日なら
  `minutesOf`、日付が異なる(翌日跨ぎ・前日跨ぎ等)なら`[0,1440]`にクランプした位置に置く
  (`batteryEventMinuteForDate`)。描画は現在時刻まで。
- **電池チップは当日限定**(過去日・未来日は非表示。`homeDeclarationCard`の
  `if (date !== todayISO()) return "";`と同じパターン)。既定パラメタでは過去日が構造的に
  残量0(≒毎回赤ゲージ)になり「裁かない」思想に反するため。

### 必須修正

1. **時間経過で表示が凍る問題**: 既存のティッカー(`startTimerTicker`、500ms周期)に
   `updateBatteryTick()`を載せ、当日表示中は電池チップ(`.home-battery-chip`)とタイムラインの
   バッテリーカーブ(`.energy-graph-overlay`)を約1分間隔(`BATTERY_TICK_INTERVAL_MS`)で
   差分更新する(`outerHTML`の部分置換。`render()`は呼ばない=検索入力のフォーカス・IME入力を
   飛ばさない)。
2. **カーブの垂直ジャンプ**: 充放電のある完了イベントの分に「直前値」「直後値」の2サンプルを
   出し、斜め線でなく垂直な段差として描くよう`batteryCurvePoints`を書き直した(時刻昇順の
   ブレークポイント処理で、イベント時のみcumを更新して前後2点を出す)。
3. **設定値の境界検証**: `clampBatteryFieldValue(field, raw)`を新設し、保存ハンドラ・
   `normalizeState`の両方から呼ぶ(手入力・同期データ経由の異常値をどちらの経路からも同じ
   基準で弾く)。start各値は有限かつ0〜200にクランプ、decayPerHourは0以上、maxは1以上
   (空欄・0・負値は`Math.max(1, …)`側へ倒す)。
4. **減衰開始時刻をネイティブtime入力に**: `type="number"`をやめ`type="time" step="300"`に
   変更(iOS規約)。保存形式を`decayStartHour`(時単位)から`decayStartMinutes`(分単位)へ
   移行し、`normalizeState`に旧`decayStartHour`からのマイグレーションを追加(既定420=07:00。
   K確定の意味は不変)。
5. **batteryCurvePointsがoptsを使っていない問題**: `renderEnergyGraph`側で
   `conditionBudget(dateKey).level`と`blocksForDate`相当(既存の`allBlocks`引数を再利用)を
   1回だけ求め、`opts.budgetLevel`/`opts.blocks`として渡すよう修正(イベント点の数だけ
   繰り返し計算していたN+3回の重複呼び出しを解消)。

### 推奨修正(すべて対応)

6. 既定値のハードコード重複を`defaultBatterySettings()`参照に統一(`homeBatteryChip`・
   `renderEnergyGraph`のフォールバック値を`def.max`等の参照に変更)。
7. 本ファイルのテスト結果プレースホルダを実測値で埋めた(下記「テスト」節)。
8. `tests/v144.test.js`を全面書き直し: (a) `JSON.stringify`のキー順依存assertを個別プロパティ
   比較に直した (b) Block完了導線(`toggle-block`)での再描画チェックを追加 (c) 設定画面の
   `start.*`ドット分岐の境界クランプ・`decayStartMinutes`(time入力)・`max`変更の反映を追加
   (d) 過去日でチップが非表示になることを追加 (e) 時刻フィルタなし合算(未来時刻の実績終了が
   当日チップに入る)ことを追加 (f) ティッカー更新(`page.clock.setFixedTime`で時刻を進めて
   reload無しで表示が変わることを確認)を追加。
9. 修正済みセマンティクス(チップ=時刻フィルタなし日合計・カーブ=日境界クランプ配置+垂直
   ジャンプ・当日限定表示)をCHANGES_v144.md(本ファイル)とapp.jsの各関数コメントに明記した。

## 規約遵守

- 現在時刻の取得は既存ヘルパーと同じ `new Date()` の数値コンストラクタのみ使用
  (`new Date("文字列")`は一切書いていない)。
- sw.js: `CACHE_NAME` を v143→v144。

## テスト

`tests/v144.test.js`(新規、42チェック): `page.clock.setFixedTime`で時刻を固定し、localStorageへの
状態注入 + 画面表示のテキスト/SVG要素で以下を検証する(app.jsの内部関数を`window`に露出しない
既存方針のため、UIとlocalStorageからの間接検証。既存スイートと同じ流儀)。

- 07:00より前は減衰しない/減衰途中の値/クランプ0・上限/開始値3種+データ無しの切替
- チップは時刻フィルタなしで完了Block全部を合算する(未来時刻のactualEndAtでも合算される)
- 過去日ではチップが非表示、今日へ戻すと再表示される
- toggle-block(Block完了導線)での即時再描画(reload無し)
- タイムライン重ね描き: 当日のみ・日またぎイベントの[0,1440]クランプ・充放電イベントの垂直段差
- ティッカー(startTimerTicker経由)による自動更新(reload・クリック無しで時間経過だけで表示が変わる)
- 設定画面: start.*境界クランプ(0〜200)・decayPerHour(0以上)・max(1以上)・decayStartMinutes
  のtype="time"入力
- normalizeStateマイグレーション: 新規補完・旧decayStartHourからの分単位移行・既存値の再クランプ

**実行結果**:
- `node tests/v144.test.js` 単体実行: **42チェック全PASS**(2回連続実行して再現性確認済み)
- `node tests/run-all.js v144`: ALL PASS
- `npm run test:core`(フォアグラウンド、timeout 600000): **ALL PASS**(179.4s、v144が直近5本
  として含まれることを確認済み)

## 自信がない箇所・未対応

- タイムライン重ね描きのx軸スケール(中央線=0・右端=上限)は、既存グラフの正の充電側と
  視覚的に重なる配置を意図的に選んだが、実機で見たときに2本の折れ線の意味の違いが
  直感的にわかるかは未検証(合成データでのみ確認)。Kの実機確認が必要。
- P4(残量低下時の回復ドラフト提案・opt-in)は設計書どおり本フェーズのスコープ外。
- ティッカーによる自動更新テスト(項目10)は`page.clock.setFixedTime`と実時間の
  `waitForTimeout`を組み合わせた時間依存テストのため、CI環境の実行速度次第では
  ごく稀にタイミングがずれる可能性がある(ローカルで2回連続PASSを確認済み)。
