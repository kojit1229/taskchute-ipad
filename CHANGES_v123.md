# v123 タイポグラフィ + マテリアル(apple-design HIG)

## 目的

apple-design Skill(Apple HIG/WWDC設計知見)の §15 タイポグラフィ と §12 マテリアル(半透明
チローム)を、既存のデザイン語彙(CSS変数・角丸・パネル)を変えずに「磨き」として反映する。
モーション(§14含む動きの調整)は次のv124のスコープとし、今回は一切変更していない。

## 変更点(styles.css。app.js・index.htmlは無変更)

### 1. タイポグラフィ(§15)

- フォントスタックの先頭に `system-ui` を追加(`-apple-system` は維持、WebKit以外のブラウザでも
  システムフォントが確実に起点になるようにした)。
- `h1`(view-headerの見出し・0秒思考タイトル等)/ `h2`(モーダル内含む各セクション見出し)/
  `h3` に、サイズだけでなく **weight** で階層を明示: `h1: 800` / `h2: 700` / `h3: 600`
  (従来はUA既定のbold(700)均一だったため、h3が初めて視覚的に一段軽くなる)。
  あわせて `h1: letter-spacing -0.02em` / `h2: letter-spacing -0.01em`(共に既存の
  `letter-spacing:0`ベースからの負トラッキング化)、`h2: line-height 1.2` を追加。
  `h3`(15px)は本文に近いサイズのため letter-spacing は据え置き(0のまま)。
- `.brand-title`(アプリタイトル、サイドバー)と `.modal-title`(モーダルタイトル)に
  `letter-spacing: -0.01em` + タイトな `line-height`(1.15 / 1.2)を追加。
- `.home-zone` / `.home-plabel` / `.home-creed-head`(ホームのゾーン見出し・信条見出し)は
  **意図的に変更していない**(設計判断を参照)。
- 数値表示に `font-variant-numeric: tabular-nums` を追加: `.home-life-num`(寿命カウントダウン)、
  `.home-rate-pct` / `.home-stat-pct` / `.home-wk strong` / `.home-ring-txt`(ホームの計器盤系
  パーセント・進捗数字)、`.metric-value`(現状未使用の汎用クラスだが将来利用時のため統一)。
  既存の `.pomo-time-overlay` / `.routine-card-time-*` / `.routine-now-label` は既にv107以前から
  tabular-nums済みのため変更なし。
- 本文(段落・muted・textarea等)の line-height は既存値(1.5〜1.7)がすでに要件を満たしており
  変更していない。

### 2. マテリアル(§12)

- 固定チロームは `.bottom-nav`(iPhone幅のボトムナビ)のみ該当(上部固定ヘッダ・サイドバーは
  `position: fixed` ではなくCSS Grid内の通常要素のため対象外)。
- `:root` とダークテーマの `@media (prefers-color-scheme: dark)` ブロックの両方に新変数を追加:
  `--chrome-bg`(半透明背景。ライト `rgba(255,255,255,.72)` / ダーク `rgba(28,29,34,.72)`、
  いずれも既存の `--panel` 値から導出)と `--chrome-edge`(境目のソフトシャドウ)。
- `.bottom-nav` の背景を `--chrome-bg` に、`backdrop-filter` を `blur(18px)` から
  `blur(20px) saturate(180%)` に強化し `-webkit-backdrop-filter` も明示追加。境目の
  `border-top: 1px solid var(--line)`(硬い1px罫線)を廃し、`box-shadow: var(--chrome-edge)`
  (控えめな上向きシャドウ、スクロールエッジ表現)に置き換えた。
- フォールバック3種を追加(`.bottom-nav`は元々`display:none`が既定で、mobile幅でのみ
  gridに切り替わるため、これらは常時定義しておいても他幅に影響しない):
  - `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))`
    → 不透明フォールバック(`background: var(--panel)`)。
  - `@media (prefers-reduced-transparency: reduce)` → 不透明+blur無し。
  - `@media (prefers-contrast: more)` → 不透明+blur無し+`border-top: 1px solid var(--text)`
    による明確な境界線(この場合のみ意図的に硬い罫線へ戻す。高コントラスト要求時は
    「控えめな表現」より「明確な境界」を優先するのが§14の指示のため)。
- Service Workerキャッシュ名を `v123` に更新。

## 設計判断

- **`.home-zone` / `.home-plabel` / `.home-creed-head` はあえて変更しなかった**。これらは
  21px前後で「大きい見出し」というより、色付きバー+罫線と組み合わせた**エイボブロウ/ラベル
  的見出し**(`.eyebrow`と同系統の役割)であり、既に `letter-spacing: +0.02〜0.12em` の
  正のトラッキングが意図的に付けられている(v33のコメント参照)。apple-design §15は
  「大きい表示テキストは負、小さいテキストは正のトラッキング」という**サイズ相応の**原則を
  述べており、これらのラベル的要素に負トラッキングを機械的に当てはめると、既存の意匠(小さめ
  カピタル風の間延び)を反転させる**再設計**になり、CLAUDE.mdの抑制(§16)方針に反する。
  「アプリタイトル・モーダルタイトル」等、より正当に「見出し」と呼べる要素(`h1`/`h2`/
  `.brand-title`/`.modal-title`)にのみ適用した。
- `.metric-value` は現状app.js側で使用箇所が無い(死んでいるCSSクラス)ことをgrepで確認した
  うえで、将来の計器盤UIで再利用された際に既定でtabular-numsになるよう合わせておいた
  (挙動に影響しないため200行制約にもほぼ影響なし)。
- `--chrome-bg`/`--chrome-edge` を新変数として両テーマに追加する形にしたのは、依頼の
  「新CSS変数を両テーマブロックへ追加」という明示要件に沿うため。以前の
  `color-mix(in srgb, var(--panel) 94%, transparent)` でも近い結果は出せるが、`color-mix()`は
  iOS Safari 16.2未満で未サポートのため、固定rgba値の方がこのPWAの実機互換性方針(iOS Safari
  最優先)に合う。

## 不可侵の制約の遵守確認

- `input`/`select`/`textarea` の `font-size: 16px` 指定は1つも変更していない(grep確認済み)。
- `.timeline-card` へのtransform/marginオフセット追加なし、`:hover`のtransformも追加していない
  (既存の`box-shadow`ホバー表現のみ、v56コメントの禁止事項を再確認したうえで無変更)。
- z-index体系・モーダルの重なりは無変更。
- `transition`/`animation`の新規追加・変更なし(v124スコープ)。
- 既存テストの削除・スキップ・弱体化なし。

## 検証手順

1. `node --check app.js`(app.js自体は無変更だが念のため)
2. `node tests/run-all.js v122 v123`
3. `node tests/run-core.js`
4. ブラウザ目視: iPhone幅(390px)でボトムナビの半透明+ぼかし、ライト/ダーク両テーマでの
   視認性、`prefers-reduced-transparency`/`prefers-contrast`環境でのフォールバックを確認。
