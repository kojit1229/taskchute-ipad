# v127 apple-design 全体ポリッシュ(角丸+2層シャドウ/ヘッダのマテリアル/余白/ボタン/見出し)

## 目的

v123(タイポグラフィ+マテリアル)・v124(押下フィードバック+モーション)は「抑制的すぎて違いが
分からない」とKからフィードバックがあった。今回は機能・レイアウト構造・情報量を変えずに、
**アプリを開いた瞬間に違いが分かる**レベルの全体ポリッシュを行う。styles.cssのみの変更で、
app.js・index.html・DOM構造・data-actionは無変更。

## 変更点(styles.cssのみ)

### 1. 角丸と深度の刷新

- `--radius` を `8px` → `12px` に変更。`.panel`/`.item`/`.form-strip`/`.segmented`/
  `.home-score`/`.zt-tab`/`.wbs-caret`の背景ドロップゾーン等、`var(--radius)`を参照する
  カード類すべてに反映される。
- `--shadow`(ライトテーマ)を単層 `0 1px 2px rgba(20,20,30,.08)` から、近接シャドウ+拡散
  シャドウの2層構成 `0 1px 2px rgba(20,20,30,.05), 0 10px 24px -14px rgba(20,20,30,.22)` に
  変更。`.panel`/`.item`/`.form-strip`/`.timeline-card`など`var(--shadow)`参照箇所すべてに
  反映される。
- ダークテーマは影ではなく面の明度差で階層を出す方針のため`--shadow: none`は維持しつつ、
  `--panel`(#1c1d22→#202129)・`--panel-soft`(#252730→#2a2c35)を`--bg`(#111216)に対して
  わずかに持ち上げ、bg<panel<panel-soft<lineの階調をこれまでより明確にした。

### 2. ヘッダのマテリアル化(§12)+ 重要な設計変更点

`renderHeader()`が全ビュー共通で出力する`.view-header`に、ボトムナビ(v123)と対になる
半透明+blurのマテリアル背景(`--chrome-bg`+`backdrop-filter: blur(20px) saturate(180%)`)と、
下端の柔らかい境目シャドウ(新設`--chrome-edge-down`、`--chrome-edge`の下向き版)を追加した。

**当初`position: sticky`での実装を試みたが、実機検証(ブラウザのcomputed style確認)で
無効であることが判明し、不採用にした。** 理由:

- `.app-shell`は`min-height: 100dvh`のCSS Grid(明示的な`height`ではなく`min-height`)で、
  行の高さは常にコンテンツにぴったり(`auto`)伸びる。
- そのため `#main`(`.main-pane`、CSSで`overflow: auto`を宣言)は**実際には自分自身の中で
  スクロールしていない**。`#main`の内容がビューポートより高くなると、`.app-shell`全体・
  ひいては`<body>`が高くなり、**ページ(document)側がスクロールする**。
- `position: sticky`は「最も近いスクロールコンテナ」を基準に固定位置を計算する。`#main`が
  `overflow: auto`を宣言している以上、ブラウザは`#main`をその基準にするが、`#main`自身が
  実際にはスクロールしないため、`sticky`は見た目上まったく効かない(検証:
  `window.scrollTo`でページをスクロールさせると、ヘッダはコンテンツと完全に同じ量だけ
  画面外へ流れ去った=`position: static`と同じ挙動だった)。
- 直すには`.app-shell`を`height`固定+`overflow: hidden`にして各カラム(サイドバー/
  main-pane/timeline-rail)を本当に内部スクロールさせる必要があるが、これは既存の
  レイアウト構造そのものへの踏み込んだ変更であり、依頼の制約(「レイアウト構造は変えない」)
  に反する。またサイドバー・タイムラインレールの現在のスクロール挙動への影響範囲も未検証。
- そのため依頼書の許容(「stickyにするとレイアウトが崩れる場合は、崩さない範囲の表現
  (背景マテリアル化のみ)に留めて報告」)に従い、`position: sticky`を外し、通常のフロー内に
  留めたまま背景のマテリアル化(半透明+blur+下端シャドウ)だけを適用した。
- 結果として「スクロールすると内容がヘッダ下に透けて流れる」という当初想定の効果は
  **得られていない**(ヘッダは他のコンテンツと同様にページと一緒にスクロールして画面外へ
  出る)。得られているのは「ヘッダ領域がボトムナビと同じ質感の半透明+ぼかし背景を持つ」
  という静的な質感の統一のみ。

フォールバックは既存のボトムナビ用ブロック3種(`@supports not (backdrop-filter)`/
`prefers-reduced-transparency`/`prefers-contrast`)に`.view-header`を追加する形で実装
(ボトムナビは`border-top`、ヘッダは`border-bottom`で明確な境界に切り替える)。

### 3. 余白のリズム(4/8ptグリッド)

`.panel`(14→18px)/`.item`(12→16px)/`.form-strip`(10→12px)/`.section`(margin-top
18→22px)をbase値でゆったり方向へ調整した。

**重要な制約**: `min-width: 760px`(v98、2026-07-15のK承認済みiPad/デスクトップ縦圧縮方針)
のブロックはコメントで「1pxも変更しない」と明記されており、本件のゆったり化と直接対立する
ため**意図的に手を付けていない**。結果として、iPad幅(≥760px。多くのiPad実機がここに該当)
では`.panel`等のpaddingはv98の圧縮値(10px等)のまま変わらない。ゆったり化が実際に見えるのは
主に720px以下(iPhone)と721〜759pxの狭い帯。**iPadでは主に#1(角丸+シャドウ)・#2(ヘッダ)・
#4(ボタン)・#5(見出し)が変化点になる**(#3の余白は据え置き)。

### 4. ボタンの階層明確化

- `.btn`: `border-radius: 7px → 10px`(カード類の角丸刷新と整合)、`padding: 8px 12px →
  8px 14px`。
- `.btn.primary`: `min-height: 40px`・`padding: 10px 18px`・`font-weight: 800`を追加し、
  base `.btn`より明確に大きく太くした。CSS詳細度により、v98の`min-width:760px`側の
  `.btn { min-height: 33px; padding: 7px 11px; }`(圧縮値)より`.btn.primary`(クラス2つ)が
  常に勝つため、iPad幅でもprimaryボタンは大きいまま表示される(実機検証で確認)。
- `.btn.ghost`: `box-shadow: none`を明示し、背景・影を持たない最下層であることを明確化。
- `.input`/`.select`/`.textarea`の`border-radius`も`7px → 10px`(font-sizeは無変更)。

### 5. 見出しの磨き(.home-zone / .home-plabel)

帯デザイン(色付きマーク+区切り罫線)は維持したまま、`.home-zone`の`margin-top`を
`10px → 20px`(ゾーン間の「章立て」区切りを強調)、`letter-spacing`を`0.04em → 0.06em`に。
`.home-plabel`も同様に`margin-top: 8px`追加・`margin-bottom: 13px → 15px`・
`letter-spacing: 0.02em → 0.03em`。v123の設計判断(これらはラベル的見出しであり大見出しの
負トラッキング原則をそのまま当てはめない)を踏襲し、字間は正のトラッキングのまま強めるに
留めた。

### 6. Service Worker

`CACHE_NAME`を`v127`に更新。

## 不可侵の制約の遵守確認

- `input`/`select`/`textarea`の`font-size: 16px`指定(iOSズーム防止)は変更していない
  (grep確認済み、`tests/v127.test.js`でも静的検査+ブラウザ実測)。
- `.timeline-card`/`.draft-*`の絶対配置系に`transform`/`margin`/`position`の変更を加えて
  いない(既存の`position: absolute !important`は無変更。`tests/v127.test.js`で静的検査+
  ブラウザのcomputed style検証)。
- z-index体系は無変更(新規z-indexの追加もしていない。ヘッダのマテリアル化はposition:sticky
  を採用しなかったためz-indexも不要になった)。
- 機能・DOM構造・data-actionは変更していない(app.js無変更)。
- 既存テスト(v123/v124/v126)の削除・スキップ・弱体化はしていない。

## 検証

1. `node --check app.js` / `node --check sw.js`: OK
2. CSS波括弧バランス: 978開/978閉、一致(node実行で確認)
3. `node tests/run-all.js v123 v124 v126 v127`: **ALL PASS**
4. `node tests/run-core.js`: **ALL PASS**(直近5バージョン+固定横断コア5本)
5. `node tests/run-all.js`(全量): **ALL PASS**
6. ブラウザ実機確認(Chrome、`node tests/serve.js`経由、JS computed style):
   - ライト/デスクトップ幅(800px、min-width:760px該当): `--radius: 12px`、`.view-header`の
     `background: rgba(255,255,255,.72)` + `backdrop-filter: blur(20px) saturate(1.8)`、
     `.panel`の`padding: 10px`(v98の圧縮値のまま、意図通り)・`border-radius: 12px`・
     2層box-shadow、`.btn.primary`の`padding: 10px 18px`・`min-height: 40px`・
     `border-radius: 10px`、`.home-zone`の`margin: 20px 2px 0`・`letter-spacing: 1.26px`
     (0.06em×21px)を確認。
   - ダーク/デスクトップ幅: `--bg: #111216`、`--panel: #202129`、`--panel-soft: #2a2c35`、
     `--shadow: none`、`.panel`の`background-color: rgb(32,33,41)`・`box-shadow: none`
     (影でなく面の明度差で階層)、`.view-header`の`background: rgba(28,29,34,.72)`を確認。
   - モバイル幅(390×844、ライト): `.view-header`が`display: grid`(縦積みレイアウト)のまま
     半透明+blur背景、`.bottom-nav`と同系統の質感で対になっていることを確認。水平スクロール
     (`document.body.scrollWidth > window.innerWidth`)は発生していない。
   - スクロール挙動: `window.scrollTo`でページをスクロールさせ、`.view-header`が
     `position: static`のまま他コンテンツと同じ量だけ画面外へ移動することを確認
     (=stickyではない。上記2章の設計判断どおりの挙動)。

## Kが見て分かる変化トップ5

1. **カードの角丸+浮遊感**: ホーム/WBS/タイムライン等、あらゆる`.panel`(ひと目スコア・
   AIから・今日のタスクシュート等)の角がこれまでより丸く(8→12px)、ソフトな2層シャドウで
   浮いて見える(ライトテーマ)。ダークテーマでは影の代わりにパネル自体がわずかに明るく
   浮き上がって見える。
2. **プライマリボタンの存在感**: 「今日へ」「▶ Now」等の`.btn.primary`が他のボタンより
   明確に大きく・太く・角丸になり、「これが主要アクション」と一目で分かる。
3. **ヘッダの質感**: 各画面上部(「今日の入口 / ホーム」等)の帯がボトムナビと同じ半透明+
   ぼかし(すりガラス)の質感になり、下端に柔らかい影が付く(ただしスクロール追従は
   しない=上記の設計判断参照)。
4. **ホームのゾーン見出し**: 「今日、すすめる」「今日のリズム・ながれ」等のゾーン見出しの
   上マージンが2倍(10→20px)になり、セクション間の「章の区切り」感が強まる。
5. **入力欄・小ボタンの角丸統一**: input/select/textareaや各種ボタンの角丸が7→10pxになり、
   12pxのカード角丸と系統立って見える(iOSズーム防止の16pxフォントサイズ規定は無変更)。

## 未対応・懸念点

- ヘッダの「スクロールで内容が透けて流れる」効果(§12の主眼)は、上記2章の理由により
  **実現できていない**。真に実現するには`.app-shell`の高さ固定+内部スクロール化という
  レイアウト構造そのものの変更が必要で、影響範囲(サイドバー/timeline-railの現在の挙動)が
  未検証のため今回は見送った。次回このテーマに再挑戦する場合は、まず`.app-shell`を
  `height: 100dvh` + `overflow: hidden`にして3カラムを個別に内部スクロールさせる設計を
  別タスクとして検証することを推奨する。
- 余白のリズム(#3)はiPad幅(≥760px)ではv98の圧縮方針を優先し変更していないため、K本人の
  実機(iPadである可能性が高い)では余白の変化は感じにくい可能性がある。角丸・シャドウ・
  ヘッダ質感・ボタン階層・見出しの変化は幅を問わず有効。
