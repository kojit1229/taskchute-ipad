# v132 Codexレビュー指摘対応(v128〜v131の欠陥修正)

K承認済みスコープ内の欠陥修正。Codex独立レビューで確定した3件(事実ベース、実コード行で裏取り済み)。

## [med] 身体スキャンモーダルの背景タップでv117ゲートが飛ばされる

- 根因: `renderModal()`の背景クリックハンドラ(app.js旧14283行付近)が常に`closeModal()`を
  直接呼んでいた。`closeModal()`は`_pendingBodyScanCtx`を破棄するだけで、v129で新設した
  `closeBodyScanFlow()`(記録の確定/discardいずれの経路でもv117過集中ゲート判定
  `maybeOpenHyperfocusGate()`を呼ぶ関数)を経由しない。結果として、身体スキャンモーダルを
  背景タップで閉じた場合だけ、保護系ルーティン未実行のゲートが表示されなくなっていた
  (明示ボタン=「記録せず閉じる」/部位選択/スキップして記録、のいずれの経路も影響なし)。
- 修正: `renderModal()`の背景タップハンドラで、`state.modal.type === "bodyScan"`のときは
  `closeModal()`ではなく`bodyScanDiscard()`(= discard扱いで`closeBodyScanFlow(false)`を呼ぶ)
  へルーティングするよう分岐を追加した。他の全モーダル種別の背景タップ挙動(即`closeModal()`)
  は無変更。
- 検証: `tests/v132.test.js`にステップ1・ステップ2それぞれでの背景タップ→ゲート起動の
  E2Eを追加(bodyScansに記録されないことも確認)。既存の明示ボタン経路の回帰も追加。

## [med] Python丸めがJSと不一致(.5境界)

- 根因: Pythonのビルトイン`round()`は銀行丸め(偶数丸め、`round(2.5)==2`)、
  `f"{x:.1f}"`もIEEE754の丸め規則がJSの`toFixed(1)`と異なる。JSの`Math.round()`は
  常にhalf-up(`floor(x+0.5)`、`Math.round(-2.5)===-2`)。`.5`境界(HR差+2.5bpm、
  睡眠6.25h等)で日報の体力予算行の文言がapp.js側とズレる可能性があった。
- 修正: `daily-report-fallback.py`に`js_round(x)`(`math.floor(x+0.5)`)と
  `js_to_fixed1(x)`(`Decimal(x)`でdoubleの厳密な10進値を取得し`ROUND_HALF_UP`で
  1桁に丸める)を新設し、`condition_budget()`内の全ての丸め処理(`fmt_signed_pct`・
  HR差の`round()`・睡眠時間の`.1f`)をこれらに置き換えた。
- 検証: `node -e`でJSの`Math.round`/`toFixed(1)`の実測値を77件(境界値付近・負値含む)
  収集し、Pythonの新ヘルパーと完全一致することを機械比較(不一致0件)。さらに
  `conditionBudget()`をそのまま複製したnode参照スクリプトと`condition_budget()`を、
  HR差+2.5bpm境界・睡眠6.25h境界・HRV-5.0%境界・前日フォールバック+境界値の複合、
  など8ケースで直接比較し完全一致を確認(下記「JS/Python一致比較ログ」参照)。

## [low] 数値型の受入差

- 根因: JSは`!= null`判定の後、算術演算(`-`等)がToNumberで暗黙変換するため、
  `hrSleep`/`hrvSleep`が数値文字列でも実質的に動作する。Pythonは
  `isinstance(x, (int, float))`で文字列を弾いており、同じ入力でPythonだけ
  データを無視してしまう非対称があった。
- 修正: `to_number(v)`ヘルパーを新設(int/float/数値文字列を受け入れ、変換不能・
  None・boolはNone扱い)し、ベースライン収集ループ(`hr_vals`/`hrv_vals`)と
  当日ログの3フィールド(`hrvSleep`/`hrSleep`/`sleepH`)すべてに適用した。
- **発見(v132スコープ外、既存app.js側の潜在ギャップとして報告)**: 実際のapp.jsは
  `sleepH`に対して`log.sleepH.toFixed(1)`を**直接**呼ぶため、`sleepH`が数値文字列だと
  本物のJSは`TypeError`で例外になる(`hrSleep`/`hrvSleep`は算術式の中でしか使われない
  ため文字列でも暗黙変換で動く、という非対称性が実際に存在する)。今回のPython修正は
  `sleepH`についてもJSより**堅牢な方向**(例外にせず数値変換して処理)へ倒した——
  バッチのフォールバック生成が入力データの型不備で丸ごと落ちるより、緩く受け入れて
  処理を続けるほうが安全と判断した。app.js本体の`sleepH`型安全性は本修正の対象外。

## 検証手順

1. `node --check app.js` / `node --check sw.js`
2. `node tests/run-all.js v132 v129 v117 v87` ALL PASS
3. `npm run test:core` ALL PASS
4. `python -m py_compile loop/scripts/daily-report-fallback.py`
5. JS/Python一致比較(scratchpad、リポジトリ非同梱): node参照実装(app.jsの
   `conditionBudget`/`conditionBudgetBaseline`/`median`をそのまま複製)と
   `daily-report-fallback.py`の`condition_budget()`を8ケースで比較——完全一致
   (不一致0件)。加えて`sleepH`数値文字列のPython単体テスト(数値化した場合と
   同じ結果になることを確認)。

## loop側の変更(コミットは監督者が実施)

`loop/scripts/daily-report-fallback.py`のみ変更(+64行/-15行、`git diff --numstat`実測)。
`js_round`/`js_to_fixed1`/`to_number`ヘルパー新設+`condition_budget()`内の丸め・型チェック
箇所の置き換え。`loop/FORMAT_CONTRACT.md`・`loop/coach/daily-review.md`の変更は無し
(出力書式・観点の記述内容自体は変わらないため)。
