# v140 2系統レビュー対応(Claude reviewer=PASS軽微、Codexレビュー=High1件+Med3件+Low2件)

v137〜v139(review.md未対応9件のラウンド1〜4完了)後、Claude reviewerとCodexレビューの
2系統に通した結果への対応(監督者裁定で全件妥当と判断)。

## High-1: report-indexの鮮度・破損・手動更新(app.js)

**指摘**: report-index.jsonの検証が甘く、(i) 壊れたindex(files配列の要素が無効)でも
採用してしまう、(ii) 生成が長期間止まって古くなったindexで新着が覆い隠され続ける、(iii)
手動「一覧を更新」でもindexだけを見てContents APIを補完的に取得しないため、index側が
1000件超で一部欠落している場合に手動更新でも救済できない、という3点。

**対応**:
- **(i)** `fetchReportIndex()`をfiles配列の各要素がstring型nameを持つものだけ採用するよう
  修正し、有効な要素が0件ならindex自体を不採用にする(nullを返す)。
- **(ii)** `parseUtcIsoToMs()`(UTC ISO文字列をnew Date(string)を経由せずDate.UTC()で
  msへ変換するヘルパー)を新設し、generatedAtが現在時刻から`REPORT_INDEX_MAX_AGE_MS`
  (48時間)を超えて古い、または解析不能な場合もindexを不採用にする。
- **(iii)** 手動更新(`refreshAiReports`)は`_aiReportForceUnionRefresh`フラグを立てるように
  し、`triggerAiReportDirLoad`はこのフラグが立っていればreport-index.jsonとContents API
  ディレクトリ一覧の両方を並行取得し、`unionAiReportEntries()`でname単位のunion(dirList側を
  正とし、indexにしか無い名前だけ補う)を作る。`fetchReportIndex()`は副作用フリー(戻り値の
  みで結果を返す)に変更し、呼び出し元がunionできるようにした。

## Med-2: compositionend直後の即時render(app.js)

**指摘**: v137時点はcompositionend時、フォーカスがまだ入力欄に残っていても即render()して
いた。IME確定直後は続けて入力するのが通例のため、フォーカス/カーソル位置を失う。

**対応**: `attemptFlushDeferredRender()`を新設し、compositionend/focusoutの両方から呼ぶ
共通判定にした。フォーカスがまだ入力系要素に残っている場合は延期を継続し(compositionend
だけでは実行しない)、focusoutで初めて実行する。未確定文字消失というv137の核心的リスクは
compositionendの時点で解消済みのため、フォーカス保持を優先する仕様に精緻化した。

## Med-3: compositionend欠落時の永久延期(app.js)

**指摘**: compositionendイベントが何らかの理由(ブラウザ/IME実装差)で発火しなかった場合、
`_imeComposing`がtrueのまま固着し、新着が永久に反映されなくなるリスクがあった。

**対応**: 2段のフェイルセーフを追加。(a) focusoutハンドラで`_imeComposing`を無条件クリア
してから判定する(フォーカス喪失を跨いでIME変換が継続することは無いため安全)。(b) 延期発生
時刻(`_deferredRenderPendingSince`)を記録し、`DEFERRED_RENDER_FAILSAFE_MS`(60秒)経過して
もまだ保留中なら、500ms周期のtimerTicker(`startTimerTicker`)からフォーカス/IME状態に
関わらず強制flushする。

## Med-4: 並行runのポート帯重複(tests/run-all.js, tests/helpers.js)

**指摘**: v137のTEST_PORT_INDEX帯(1スイートあたり10番)は常に基底20000固定だったため、
v93が本来防ぎたかったシナリオ(2ターミナルでの同時実行)への対応としては退行していた。

**対応**: `run-all.js`起動ごとにランダムな基底(20000〜38000の1000刻み、19通り)を選び、
環境変数`TEST_PORT_BASE`としてスイートへ渡す。`randomPort()`は`TEST_PORT_BASE + index*10`
で採番する(無ければ従来どおり基底20000)。並行run間の衝突確率は1/19以下に下がり、それでも
衝突すればEADDRINUSEリトライ(v137で追加済み)で自己回復する。単一run内の衝突は同じ基底を
共有する限り従来どおり数学的にゼロのまま。CLAUDE.mdのポート節に経緯・対策を追記した。

## Low-5: javascript:検知の過剰サニタイズ(app.js)

**指摘**: v137でjavascript:検知の対象属性を全属性へ拡大したが、title等の正当なテキスト
属性(例: `title="Java Script: overview"`)まで属性ごと消してしまう過剰検知だった。

**対応**: 走査対象をURL系属性(href/src/xlink:href/action/formaction)+style属性へ戻した
(on*属性の検知は従来どおり全属性が対象のまま)。`xss-sanitizer.test.js`に肯定チェック
(titleが保持される)を追加した。

## Low-6: data: URIの扱い(app.js)

**指摘**: data:スキームの扱いが粗く、`data:text/html`のような危険なnavigationも
`data:image/svg+xml`(SVG内に`<script>`を埋め込める)も一律で同じ扱いだった。

**対応**: href/xlink:hrefはdata:を全面拒否(ナビゲーション用途はここにしか出てこない)、
srcは`data:image/(png|jpeg|gif|webp)`のみ許可しそれ以外(svg+xml含む)は拒否する
`SANITIZE_SAFE_DATA_IMAGE_RE`を新設した。`xss-sanitizer.test.js`にdata:関連のケース
(全面拒否・安全な画像は許可・svg+xmlは拒否)を追加した。

## テスト

- `tests/v140.test.js`(新規、5シナリオ): High-1の3ケース(破損index→フォールバック、
  古いindex→フォールバック、手動更新でindexとContents APIをunion)、Med-3の2ケース
  (compositionend欠落時のfocusoutフェイルセーフ、60秒タイムアウトフェイルセーフ)。
- `tests/v137.test.js`: Med-2の仕様精緻化に合わせて[1-c]シナリオを更新(compositionend
  直後はフォーカスが残っていれば延期継続、blur後に反映されることを確認する形に変更)。
- `tests/v138.test.js`: generatedAtをテスト実行時刻基準の動的な値に変更(48時間鮮度
  チェックの追加により、将来別日の実行で意図せず鮮度切れにならないようにするため)。
  [3]手動更新シナリオの期待値をunion仕様に合わせて更新。
- `tests/xss-sanitizer.test.js`: Low-5(title保持の肯定チェック)・Low-6(data:関連ケース)
  を追加。
- Med-4は`run-all.js`単体の帯計算をNode.jsのワンライナーで2000回サンプリングして19通りの
  値に一様分布することを確認し、さらに2つの`run-all.js`インスタンス(異なるスイート指定)を
  実際に並行実行して両方とも異なるport帯(35000/36000)を使い、EADDRINUSE無しで両方
  成功することを確認した(v93が本来想定していた「2ターミナル同時実行」シナリオの実地確認)。

回帰: `node tests/run-all.js v137 v138 v140 sw-integration xss-sanitizer v92 v79 v56 v72
v133 v77` ALL PASS。`npm test`(全量)はpush前に別途実行して確認する。

## 自信がない箇所

- Low-6のdata:image許可リスト(png/jpeg/gif/webp)は一般的な安全画像形式のつもりだが、
  アプリが将来これら以外の画像形式(avif等)を埋め込む必要が出た場合は許可リストの追加が
  必要になる。
- Med-3の60秒フェイルセーフ値(`DEFERRED_RENDER_FAILSAFE_MS`)は指摘に明記された数値
  (60秒)をそのまま採用したが、実運用でこの値が適切かは未検証(短すぎると入力中に不意の
  再描画が挟まるリスク、長すぎると新着反映の遅延が長引くリスクのトレードオフ)。
- Med-4の並行run間衝突確率(1/19以下)は基底の一致のみに基づく計算で、基底が一致した
  場合にスイート実行順序が完全に同じであれば個々のポートも全て一致しうる(EADDRINUSE
  リトライへ委ねる設計だが、リトライも使い果たすケースは理論上残る)。
