# v137 review.md未対応指摘ラウンド1(小型のUX・品質修正5件、K承認済み2026-07-22)

`../taskchute-notes/review.md` の未対応指摘のうち、実装可能な9件を4ラウンドに分けて解消する
作業の第1ラウンド。本バージョンでは小型のUX・品質修正5件に対応する。

## 1. hydrateStaticMarkdownの全render()が入力中フォーカス・IME未確定文字を飛ばす(review.md:28)

**指摘**: 復帰時(visibilitychange)・30分定期の新着取得後、journal等の入力中でも
`hydrateStaticMarkdown()`が無条件に`render()`していたため、フォーカス・選択範囲・
IME未確定文字が飛んでいた。

**対応**: 「フォーカス中/IME変換中は延期し、フォーカス離脱またはIME確定のタイミングで
1回だけ実行する」方式にした。

- `_imeComposing`(IME変換中フラグ)・`_deferredRenderPending`(延期中フラグ)をモジュール
  レベルに追加(app.js:153-154)。
- `isFocusInEditableElement()`: `document.activeElement`がINPUT/TEXTAREA/contenteditableか判定。
- `renderDeferringForFocus()`: 上記いずれかに該当すれば`render()`せず`_deferredRenderPending`を
  立てるだけ。`hydrateStaticMarkdown()`末尾の`render()`呼び出しをこれに置換した。
- `document`に`compositionstart`/`compositionend`/`focusout`のリスナーを追加(app.js:785-793)。
  - `compositionend`: `flushDeferredRenderAfterComposition()` — IME変換が確定した時点で
    フォーカスが同じ入力欄に残っていても実行する(未確定文字が消える具体的なリスクは
    確定と同時に解消しているため)。
  - `focusout`: `setTimeout(...,0)`を挟んで`flushDeferredRenderIfFocusLeft()` — フォーカスが
    別の入力欄へそのまま移った(タブ移動等)場合はまだ延期を続ける、という再判定付き。

**設計判断**: 依頼書は「対象カードだけの差分更新が容易ならそちらでも可」としていたが、
対象ビュー(vision/journal/weekly/home/zero/tasks)が多岐にわたり、対象要素も
ビューごとに異なるため、既存の検索欄差分パッチ(v34)のような個別対応より延期方式の方が
実装・保守コストが小さいと判断し、延期方式のみを採用した。

## 2. AIレポート本文の失敗キャッシュ(review.md:29)

**指摘**: `triggerAiReportBodyLoad`が取得失敗(401/5xx/ネットワーク例外)を空文字で
`_aiReportBodyCache`へキャッシュしており、`body === undefined`判定に引っかからず二度と
再取得されなかった。「一覧を更新」も明示選択が無い(=既定表示のfiles[0])場合は本文
キャッシュをinvalidateしていなかった。

**対応**:
- `fetchGitHubRawText`(成功/失敗を区別しない)ではなく`fetchGitHubRawResult`(区別する。
  `saveReadingReflection`が既に使っている区別方式)を使うよう変更。`result.ok`の時だけ
  `_aiReportBodyCache`へ書き込み、失敗時は書き込まない(=次回描画で再度
  `triggerAiReportBodyLoad`が呼ばれ、リトライされる)。
- 失敗が続く間に`render()`→`triggerAiReportBodyLoad()`→失敗→`render()`…と無限に
  ループしてAPIを連打しないよう、`_aiReportBodyFailedAt`(直近失敗時刻)を追加し、
  15秒(`AI_REPORT_BODY_RETRY_COOLDOWN_MS`)のクールダウンを設けた(feedbackHydrateの
  最短間隔ガードと同じ思想)。
- `refreshAiReports()`(「一覧を更新」ボタン)は、`_aiReportSelectedDate`に明示選択が
  無い場合でも`renderAiReportBody`と同じフォールバック(files[0])で「表示中ファイル」を
  決定し、そのファイルの本文キャッシュ+失敗クールダウンの両方を明示的にクリアするよう
  修正した(クールダウン中でも手動更新は必ず即座に再試行できる)。

## 3. Wish詳細textareaの13px(review.md:30)

**指摘**: `.wish-detail .textarea`(モチベーション欄)が`font-size: 13px`で、モバイル側
`@media (max-width:720px) { .input,.select,.textarea{font-size:16px} }`をCSS
specificity(2クラス > 1クラス)で上書きし、iOS Safariのフォーカス時自動ズーム対象に
なっていた。

**対応**: `styles.css`の該当指定を`font-size: 16px`に変更(styles.css:2101-2109付近)。

## 4. run-all.jsの子Chromium残留(review.md:34)

**指摘**: `tests/run-all.js`が親プロセスのtimeout/中断時に`spawnSync`の直接killのみで、
各スイートが起動したChromiumの孫プロセスが残留することがあった。

**対応**: `spawnSync`(同期)から`spawn`(非同期)へ変更し、以下を追加した。
- スイートごとのtimeout(`SUITE_TIMEOUT_MS` = 3分)。超過したらプロセスツリーを強制終了して
  該当スイートを失敗扱いにし、次のスイートへ進む。
- `killProcessTree(pid)`: POSIXは`spawn`時`detached:true`でプロセスグループを作り
  `process.kill(-pid, "SIGKILL")`でグループごと終了。Windowsは`taskkill /pid <pid> /T /F`で
  ツリーを終了。
- `run-all.js`自体がCtrl+C/外部timeoutラッパーで`SIGINT`/`SIGTERM`を受けた場合も、実行中の
  子(とその孫)を`killProcessTree`で道連れにしてから終了する。

**検証**: 手元(Windows)で、孫プロセス(Chromium相当のダミーnodeプロセス)を起動してから
ハングする子プロセスを`killProcessTree`で終了させ、子・孫とも確実にプロセスが消えることを
確認した(`wmic`/`Get-Process`で存在確認)。この検証はテストランナー自体のプロセス管理の
確認であり、`tests/v137.test.js`(ブラウザE2E)には含めていない
(review.md記載どおり「単体確認ができる範囲で」の対応)。テストランナー・各`tests/vNN.test.js`
の検証内容自体は変更していない。

## 5. conditionBudgetのsleepH型非対称(review.md:39)

**指摘**: `conditionBudget()`がhr/hrv(算術式内で暗黙変換されるため数値文字列でも安全)と
sleepH(`.toFixed(1)`を直接呼ぶため数値文字列だとTypeError)とで非対称だった。loop側
`daily-report-fallback.py`の`to_number()`は既に対応済みのため、アプリ側をそれに揃える。

**対応**: `toNumber(v)`(`to_number()`と同じ変換ルール: null/undefined/booleanはnull、
それ以外はNumber化してNaNならnull)を追加し、`conditionBudgetBaseline()`のhr/hrv集計と
`conditionBudget()`のhrvSleep/hrSleep/sleepHすべてをこの関数経由に統一した。

## テスト

`tests/v137.test.js`(E2E、4セクション。journal入力中を実演): [1]フォーカス中/IME変換中の
render延期+フォーカス離脱/変換確定での実行、[2]AIレポート本文の失敗非キャッシュ+
「一覧を更新」の確実な再取得、[3]Wish詳細textareaのcomputed font-size、[4]sleepH数値
文字列でのTypeError非発生+正しい判定(数値型での回帰確認込み)。

回帰: `node tests/run-all.js v92 v79 v133 v77 v56`(AIレポート・Wish・AIフィードバック
自動取り込み・下書き機構・日時パースの各領域) ALL PASS。`npm test`(全量、v18〜v137の
全スイート)もpush前にフォアグラウンドで実行し ALL PASS を確認済み。

## 自信がない箇所

- `AI_REPORT_BODY_RETRY_COOLDOWN_MS`(15秒)は指摘に明記が無く、実装判断で追加した値。
  実運用でのAPI呼び出し頻度・レート制限余地は未計測。
- compositionend時にフォーカスが同じ入力欄に残っていても即renderする設計は、依頼書の
  「blur/compositionend時に1回だけ実行」という文言をそのまま解釈したもの。IME変換の
  合間(単語ごとに何度もcompositionstart/endが起きる場合)に再描画が挟まりカーソル位置が
  リセットされる可能性はゼロではないが、「未確定文字が消える」という指摘の核心的リスクは
  解消している。
