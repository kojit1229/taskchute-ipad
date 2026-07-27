# v151 ダークモード既定化(K指示2026-07-27)

UIの配色を既定でダークにする。ライト/OS追従(auto)も設定から選べる。

## 1. state.settings.theme(既定"dark")

`"light" | "dark" | "auto"` の3値。`normalizeState()`で既定"dark"を補完するマイグレーションを
追加した(app.js、`timelineEnergyGraphMode`補完の直後)。既存端末も次回起動からdarkになる。
不正な値(旧データ・手動編集ミス等)が入っていた場合も"dark"へ補正する。"auto"を選べば
従来どおりOSの外観設定(`prefers-color-scheme`)に追従する。

## 2. 適用方式: `<html data-theme="dark|light">`

**採った方式**: 色トークンの定義箇所を`styles.css`の`:root[data-theme="dark"]`ブロック**1箇所だけ**
に一本化し、`@media (prefers-color-scheme: dark)`は使わないことにした。「OS追従」の実際の判定
(matchMediaでOSのライト/ダークを読む)は常にJS側(`resolveTheme()`)で行い、結果を必ず
`data-theme="dark"|"light"`という具体値としてhtml要素へ反映する(`data-theme="auto"`という
状態はDOM上には存在しない)。

**理由**: 依頼の制約「色値の重複定義を作らない」を満たす方法として、(a)メディアクエリと属性
セレクタの両方に同じ色値を書く、(b)属性セレクタだけに書きJS側でauto解決する、の2択があった。
(a)は「メディアクエリ側はdata-theme="auto"相当のときだけ効くようにする」ことになるが、CSS上で
「data-theme属性が無い/autoのとき」と「OS設定」の両方を条件にする書き方は`:not([data-theme])`
等になり、结局2箇所に同じ値を書く点は変わらない。(b)ならCSSは常に`data-theme`属性だけを見れば
よく、値の重複がゼロになる。副作用として、ライト/ダークどちらの色を使うかの判定ロジック
(auto解決)が1箇所(JS)に閉じるという利点もあるため(b)を採用した。

- `app.js`: `resolveTheme(mode)`(auto→matchMediaで実解決)/ `applyTheme()`
  (`document.documentElement`へ`data-theme`属性を設定+`meta[name=theme-color]`を更新)を新設。
  `render()`の先頭で毎回呼ぶ(冪等。設定変更経路を問わず取りこぼさない)。
- OS設定がaudio中に変わるケース(iOS設定アプリでの切替・日没自動切替)に対応するため、
  起動処理で`matchMedia("(prefers-color-scheme: dark)")`の`change`イベントを監視し、
  `theme==="auto"`のときだけ`applyTheme()`を再実行する。
- `styles.css`: 旧`@media (prefers-color-scheme: dark) { :root {...} }`を
  `:root[data-theme="dark"] {...}`へ書き換え(色値は無変更、セレクタのみ変更)。
  `color-scheme`(ネイティブ入力の見た目に影響)も`:root[data-theme="dark"]`/
  `:root[data-theme="light"]`でそれぞれ明示上書きし、`type="time"`/`type="date"`等の
  ネイティブピッカーの見た目もアプリの選択テーマと一致させる。

## 3. フラッシュ防止(起動直後の一瞬ライトが出る問題への対処)

`app.js`は`type="module"`(非同期・実行が遅い)のため、初回ペイントに間に合わない。
`index.html`の`<head>`に同期スクリプトを追加し、`localStorage`を直接読んで
`data-theme`属性を最初のCSSOM構築より前に確定させる(判定ロジックはapp.jsの
`resolveTheme()`と同内容を複製——モジュール読込前の素の`<script>`のためimportできない。
`STORAGE_KEY`の文字列はapp.jsの`STORAGE_KEY`定数と手動同期が必要、とコメントで明記した)。
`<meta name="theme-color">`の既定値も`#f7f7fa`→`#111216`(ダーク値)へ変更した。
同期スクリプトは`meta[name=theme-color]`の`content`も解決済みテーマの値へその場で更新する
(初版はdata-theme属性しか更新しておらず、light解決時にステータスバー相当の色が一瞬既定の
ダーク値`#111216`のまま残る問題があった。2系統レビュー対応・必須4)。

## 4. 設定画面「表示・タイマー」群にテーマ選択

`renderSettingsThemePanel()`を新設し、`<select class="select" data-setting-field="theme">`
(ダーク/ライト/OS追従の3択)を追加した。既存の汎用ハンドラ(`data-setting-field`、change
イベントで`state.settings[field]=value; saveState(); render();`)にそのまま乗せているため、
専用のイベントハンドラは新設していない。`.select`はbodyのfont-size(既定16px)を`font: inherit`
で継承しており、iOS規約(input/select/textareaはfont-size 16px以上)を満たす。

## 5. ダークで破綻していた「ライト専用の生値」の修正(初回3箇所+2系統レビューで1箇所追加)

全画面をダーク既定で確認し、CSS変数を経由しないハードコードのライト色値でダーク背景では
読みづらい/浮いて見える箇所を修正した。コントラスト比はWCAG相対輝度式で、初回実装時は手計算
していたが、2系統レビューの指摘を受けてnode scriptで再計算し、以下は再計算後の実測値に
差し替えている(初回手計算の数値には誤差があった。以後このファイルの数値は明記が無い限り
`(width*255の整数丸め等を含む)概算`として扱うこと)。

1. **gate画面の認証エラー文言**(app.js `renderGate()`): `color:#c0392b` →
   `color:var(--red)`。ダークパネル(`#202129`)上での実測コントラストは`#c0392b`が**2.95:1**
   (AA 4.5:1未達)、`var(--red)`(`#ff453a`)は**4.70:1**まで改善(既存の危険/エラー表示全般で
   使われている established トークンへの統一でもある)。
2. **タイムラインのエネルギー/バッテリーグラフSVGの中央目盛線**(app.js
   `renderEnergyGraphSvg`相当箇所): `stroke="#D1D1D6"` → `stroke="var(--line)"`。
   ライト専用の薄灰色をそのまま使うと、ダーク背景では意図した「控えめな目盛線」より明るく
   浮いて見える。`var(--line)`はSVG属性内でも既に他箇所(例: app.js該当行10377/3904)で
   使われている確立済みパターンのため、iOS Safariを含め安全に使える。
3. **0秒思考のAI提案タグ**(app.js `ztRenderThemeItem`)——**2系統レビュー対応(必須1)で方式変更、
   さらにテスト実装中に追加のAA未達を発見して`--accent-text`トークンを新設**:
   初回実装は`style="background:#eef; color:#448"` → `style="background:var(--accent-soft);
   color:var(--accent)"`としたが、レビューで実測AA未達(ライト3.51:1/ダーク3.63:1、いずれも
   4.5:1未達)を指摘された。隣接する既存の「問い」タグ(`.zt-theme-qtag`、背景paint無し・
   `border:1px solid var(--accent)`+`color:var(--accent)`)と**完全に同じスタイル**に揃える方式へ
   再修正し(独自の`style`属性を削除、`class="zt-theme-qtag"`だけを共有)、この状態を検証する
   `tests/v151.test.js`の[E]をapp.js実物のDOM(`getComputedStyle`+背景を親要素へ辿って合成)で
   実装したところ、レビューが想定していた「ダーク実測4.66:1」(`var(--accent)` on `--bg`で計算)
   は実際のDOM構造とは背景が異なり(`.zt-theme-item`は`<section class="panel zt-section">`の中に
   あるため実効背景は`--panel`)、実測は**3.99:1でAA未達のまま**だった。つまり「問い」タグ自体が
   v151以前から(ライト3.56:1/ダーク3.99:1で)AA未達だった既存の潜在バグで、スタイルを完全一致
   させるだけでは解消しなかった。orange/green/tealと同じ`-text`トークン方式で`--accent-text`を
   新設し(ライト`#0050e0`/ダーク`#00a2ff`、node script実測でpanel/panel-soft/bg/accent-softの
   全組み合わせが5:1台以上)、`.zt-theme-qtag`の`color`をこれに切り替えた(`border`は非text要素の
   3:1要件を素の`var(--accent)`で満たすため無変更)。結果として「問い」タグ自身の潜在的なAA未達も
   副次的に解消し、ライト・ダークとも実測5:1台以上になった(`tests/v151.test.js`[E]で
   `getComputedStyle`ベースの実測5.81:1を確認、ライトは未テストだが上記node script実測6.51:1)。
4. **横断検索の「フィードバック」種別タグ**(styles.css `.search-kind-feedback`、2系統レビュー
   推奨6・4件目の見落とし): `color:#af52de` → `color:var(--text)`。背景`rgba(175,82,222,.12)`は
   `.search-hit`(`background:var(--panel-soft)`)の上に乗るため実効背景はpanel-soft寄りで、
   `#af52de`はダーク実測**2.96:1**・ライトも3.66:1でどちらもAA未達だった。専用の
   `--purple-text`トークンを新設するのはオーバースペックと判断し、常にAA適合が保証されている
   本文色トークン`var(--text)`(panel/panel-soft系の背景に対して12:1台の余裕を持つ)へ切り替えた。
   背景の淡い紫タグ自体(種別の視覚的な色分け)は維持している。

上記以外にも生の`#RRGGBB`/`white`/`black`をgrepで洗い出したが、(a)彩度の高いボタン背景+白文字
の組み合わせ(コントラストペア自体が背景色を問わず固定、例: `.btn.primary`の`background:var(--accent)
color:white`)、(b)常時黒背景の動画/ポモドーロ全画面オーバーレイ(`background:#000`、テーマとは
無関係に意図的に黒)、(c)MIT★の`color:#F5A623`(ダークパネル上で実測コントラスト約7.29:1、
ライトより向上する側で破綻なし)は「ダークで破綻」に該当しないため変更していない。

## 6. 2系統レビュー対応(初回実装後、他ファイル分)

**必須2(iOS standaloneのステータスバー)**: `index.html`の`meta[name=apple-mobile-web-app-status-bar-style]`
は`theme-color`メタとは独立した仕組みで、standalone起動時のステータスバー色に`theme-color`メタは
効かない(Safari/ホームブラウザ表示だけが見る)。既定値`"default"`(=常に明るい)を`"black"`へ
変更した。`"black-translucent"`はコンテンツがステータスバー領域まで潜り込みsafe-area-inset対応が
別途必要になるため、既存レイアウトへの副作用を避けて不採用にした。

**必須3(manifest.webmanifestのコールドスタート)**: `background_color`/`theme_color`を
`#f7f7fa`→`#111216`へ変更。**注意**: iOSはPWAをホーム画面に追加した時点でmanifestの内容を
キャッシュするため、既存インストール済みのPWAにはこの変更が自動反映されない。反映するには
**PWA削除→ホーム画面に再追加**が必要(SW`CACHE_NAME`更新だけでは効かない、manifest独自のキャッシュ
であることに注意)。

**必須5(resolveTheme等価性のドリフト防止)**: `app.js`の`resolveTheme(mode)`と`index.html`の
同期スクリプト内の同等ロジックを、分岐の「形」まで完全一致させた。統一形:
`mode !== "auto" ? (mode === "light" ? "light" : "dark") : (matchMediaでOS判定)`。
初版はapp.js側が`mode==="light"||mode==="dark"`(該当しなければmatchMediaへフォールバック)、
index.html側が`theme==="auto"`分岐という非対称な書き方で、実際の入力値が両者とも
"light"/"dark"/"auto"の3値に既に正規化されているため挙動上の差異は無かったが、将来どちらかだけ
書き換えられて意味的にズレるリスクがあった。両ファイルのコメントに「変更時は両方を見比べること」
と明記した。

## 検証

`tests/v151.test.js`を新規追加(A: 既定dark適用4項目 / B: 設定selectでlight切替+永続化9項目 /
C: auto選択時のOS追従5項目 / D: normalizeStateマイグレーション3項目、小計21チェック)。
2系統レビュー対応で以下を追加(小計10項目、合計31チェック):
- E: 0秒思考のAI提案タグが「問い」タグと同じ`.zt-theme-qtag`クラスのみで独自`style`を持たず、
  実際のDOM(`getComputedStyle`+親要素を辿った実効背景合成)でコントラスト4.5:1以上になる
  (必須1。この検証を書く過程で`--accent-text`トークン新設が必要と判明した経緯は上記5-3参照)
- F: app.jsをroute.abort()で完全に遮断しても、index.htmlの同期スクリプト単独で
  `data-theme="dark"`+`meta[theme-color]`更新が機能する(必須4・必須8相当のフラッシュ防止経路の
  独立検証)
単体実行(`node tests/v151.test.js`)で全PASS(31/31)。

### 既存テストへの影響

`prefers-color-scheme`/`getComputedStyle`/`--bg`/`--panel`等をgrepで洗い出し、色・computed style
を検証しているスイート(v147=AAコントラスト検証を含む21ファイル)を確認した。特に懸念していた
`tests/v147.test.js`([4]のAAコントラスト検証、`getComputedStyle(document.documentElement)`で
`--orange-text`等を読む)は、Chromiumの`getComputedStyle`がカスタムプロパティ内の`var()`参照を
解決した値(例: ダークの`--orange-text: var(--orange)`は`#ff9500`として読める)を返すことを
実機確認した。ダーク側の値はv147時点で既にAA(4.5:1)を満たす設計だったため、テストがどちらの
テーマで走ってもそのまま通る。`node tests/v147.test.js`を単体実行し全PASSを確認した(実測値は
ダーク側の数値に変わったが、閾値判定はいずれも通過)。

`npm run test:core`(フォアグラウンド実行、tests/v151.test.js追加後の実対象=直近5バージョン
v151/v150/v149/v148/v147+固定横断コア5本 v50/v59/v67/v70/v72、計10ファイル)を実行し
全PASS(218.7s)。`node tests/run-all.js v151 v147 v150`(フォアグラウンド)でも個別に全PASSを確認。
push前・CIでの全量実行(`npm test`)は別途必要。
