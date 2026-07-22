# v139 review.md未対応指摘ラウンド4(テスト基盤・セキュリティ、K承認済み2026-07-22)

`../taskchute-notes/review.md` の未対応指摘のうち実装可能な9件を4ラウンドに分けて解消する
作業の第4(最終)ラウンド。テスト基盤の空白(review.md:33)とXSS否定テストの欠如(review.md:35)
に対応する。

## 1. SW有効の統合スイート(review.md:33)

**指摘**: 既存40本余のE2Eが全てService Workerをblockしており、install/activate/offline/
controllerchangeを検証していなかった。

**対応**: `tests/sw-integration.test.js`(新規、少数チェック)を追加した。既存スイートの
SW block方針は無変更(このスイートだけ`serviceWorkers: "block"`を付けずbrowserContextを
作る)。検証内容:
1. install/activate: `navigator.serviceWorker.ready`が解決し、`reg.active.state === "activated"`
2. CACHE_NAME一致: `sw.js`から実際にCACHE_NAMEを正規表現抽出し、`caches.keys()`に同名の
   キャッシュが存在することを確認(ハードコードした期待値ではなく現物のsw.jsを都度読む)
3. APP_SHELLがキャッシュされている(index.html/app.js/styles.css)
4. オフライン相当でのキャッシュ配信: `context.setOffline(true)`でreloadしてもページ本文が
   空にならない(network-firstのfetchハンドラがキャッシュへフォールバックすることの確認)
5. controllerchangeの基本動線: 初回install時`self.clients.claim()`によりcontrollerchangeが
   既存ページへ飛び、`navigator.serviceWorker.controller`がセットされることを確認

## 2. XSS否定テスト+サニタイザの穴の修正(review.md:35)

**指摘**: Markdown sanitizer(`sanitizeHTML`、v37導入)は実装済みだがXSS否定テストが無い。
DOMPurifyのローカル同梱を検討する。

**調査手順**: 依頼書の指示どおり、まず現物の`sanitizeHTML`(app.js)を読み、script/onerror/
javascript:/SVG payloadの否定テストを書いて現行実装で通るか確認した。

**発見**: 4クラス中2クラスで文字列レベルの穴があった(手元のPlaywright検証で確認)。
- `<svg><script>...</script></svg>`: `el.tagName`はSVG名前空間の要素だと大文字正規化されず
  `"script"`(小文字)になるため、`BLOCKED_TAGS`(大文字の配列)との`includes`比較をすり抜けて
  サニタイズ後のHTML文字列に生き残っていた。
- `style="background:url(javascript:...)"`: `javascript:`スキームの検知が`href`/`src`/
  `xlink:href`の3属性限定だったため、`style`属性経由の混入を見逃していた。

**実XSSかどうかの確認**: 上記2件とも、本アプリの実際の挿入経路(ライブDOM要素への
`innerHTML =`代入)では**実行されないことを確認済み**(`window.__xss`フラグ・`alert`ダイアログ
いずれも発火せず)。理由: (a) `innerHTML`経由で挿入された`<script>`要素はHTML仕様上SVG名前空間
でもinert化され実行されない、(b) 現代ブラウザ(Chromium/Safari)はCSS `url()`内の`javascript:`
スキームを実行しない(過去のIE固有の挙動)。つまり「通らない=実XSSがある」の分岐には
該当しないが、サニタイザ自体の契約(危険な要素・属性を取り除く)としては穴であり、修正コストが
極めて小さい(2行の変更)ため、安全側に倒して修正した:
- `BLOCKED_TAGS.includes(el.tagName)` → `BLOCKED_TAGS.includes(el.tagName.toUpperCase())`
- `javascript:`/`data:text/html`検知の対象を`href`/`src`/`xlink:href`の3属性限定から
  全属性へ拡大し、`startsWith`から`includes`へ変更(`url(...)`等のラップも拾う)

`tests/xss-sanitizer.test.js`(新規)を追加。実際のレンダリング経路(`marked.parse` →
`sanitizeHTML` → `.md-render`要素への`innerHTML`代入)を通し、上記7ペイロード
(script/onerror/javascript:リンク/SVG script/SVG onload/style url(javascript:)/iframe)が
(a) 実行されない、(b) サニタイズ後のHTML文字列にも残らない、の両方を確認する。修正前の
`sanitizeHTML`に対して一時的に本テストを実走し、[2]の2チェック(SVG script・style
javascript:)が実際に失敗することを確認してから修正・復元した(テストの実効性を裏取り済み)。
正常なMarkdown(見出し・太字・通常のhttpsリンク)が引き続き問題なく描画されることも回帰確認した。

**DOMPurifyの同梱**: 見送り(review.mdの該当行に「否定テスト追加済み・修正済み。DOMPurify
同梱は要K判断」と追記し、判断待ちとして残す)。

## テスト

`tests/sw-integration.test.js`(新規、5チェック)・`tests/xss-sanitizer.test.js`(新規、
17チェック)。既存スイートには一切触れていない(SW block方針・sanitizeHTMLの呼び出し元は
無変更)。

回帰: `node tests/run-all.js sw-integration xss-sanitizer v56 v133 v77 v92`(日時パース・
AIフィードバック自動取り込み・下書き機構・AIレポートビューアの各領域) ALL PASS。`npm test`
(全量)はpush前に別途実行して確認する。

## 自信がない箇所

- sanitizeHTMLの`javascript:`検知を全属性へ拡大したことで、`title`属性等に偶然
  「javascript:」という文字列を含む正当なテキストが書かれた場合に属性ごと除去されうる
  (稀・低リスクだが、既存の`startsWith`限定より過剰検知の可能性はわずかに増えている)。
- `<svg><script>`・`style="url(javascript:)"`が「実XSSではない」という判定は、本アプリの
  実際の挿入経路(`innerHTML`代入のみ)に基づく。将来別の挿入方法(`document.write`等)が
  追加された場合はこの判定が成立しなくなる可能性がある。
