# CHANGES v93

## 概要

K報告(2026-07-14)「0秒思考のタブがiphone表示だと崩れる」への対応。

SW `CACHE_NAME` を v92 → v93 に更新。

---

## 根本原因

`.zt-theme-item`(0秒思考タブ「テーマ一覧」の1行 = ☆ + 本文 + 大テーマselect + 書く→ + ×)は
`display:flex; align-items:center` の1行レイアウトで、本文(`.zt-theme-text`)以外の4要素
(☆・大テーマselect・書く→・×)はすべて `flex: none` の固定幅(styles.css)。

- `.zt-star`(☆、flex:none) — styles.css:2443
- `.zt-theme-group-select`(大テーマselect、flex:none / max-width:118px) — styles.css:2466
- `.zt-theme-go`(書く→、flex:none / white-space:nowrap) — styles.css:2446
- `.zt-theme-del`(×、flex:none / min-width:44px) — styles.css:2449

本文だけが `flex:1; min-width:0`(styles.css:2445)で伸縮可能なため、狭幅では本文の割当幅が
上記4要素の固定幅合計(☆18px + select118px + 書く→66px + ×44px + gap 11px×4 = 約290px)を
引いた残りまで圧縮される。iPhone幅(390px)・v90の大テーマ階層(`.zt-group-body` の
`padding-left:22px` でさらに狭まる)の条件下で実測したところ、本文の割当幅はわずか
**35.6px**(日本語1〜2文字分)まで潰れ、`min-width:0` により横スクロールは起きない代わりに、
本文が1文字ずつ縦に折り返され、1テーマの行の高さが**449.5px**まで膨張していた
(app.js の `ztRenderThemeItem` が生成するDOM構造自体、styles.css:2440-2466)。

294件規模・28グループの実データ相当の合成データ(scratchpadで検証、実データはコピー未使用)で
再現。単一テーマ・単一グループの最小構成でも同じ現象が起きることを確認済み(後述の検証結果)。

---

## 修正内容(styles.css、+9行)

```css
@media (max-width: 480px) {
  .zt-theme-item { flex-wrap: wrap; }
  .zt-theme-text { order: -1; flex-basis: 100%; }
}
```

`.zt-theme-item` に狭幅(480px以下)限定で `flex-wrap: wrap` を追加し、本文
(`.zt-theme-text`)を `order: -1` で先頭へ、`flex-basis: 100%` で独立した全幅の1行にする。
残りの☆・大テーマselect・書く→・×は自動的に次の行へ折り返される(固定幅合計は約290pxで
iPhone最小幅375pxでも収まる)。

- デスクトップ幅(480px超)は無改変。既存の1行表示のまま(回帰なし、tests/v93.test.jsで確認)。
- `transform` は使っていない(iOS Safariのタイムラインブロック規則はそもそも本箇所と無関係だが、
  Skillの「タイムラインブロックへのtop/left以外のオフセット禁止」に抵触する変更もしていない)。
- input/select/textareaの16px規則は既存のまま変更なし(`.zt-theme-group-select` は元々
  `font-size:16px`)。

---

## テスト: `tests/v93.test.js`(新設)

① 390px幅(iPhone相当)で横スクロールが発生しない・本文が異常に潰れない(幅200px以上)・
   1行の高さが異常に膨張しない(150px未満)
② v90の大テーマ階層(グループ)配下でも同様に折り返される・グループ機能自体は壊れていない
③ デスクトップ幅(1280px)では従来どおり☆・本文などが同じ行に並ぶ(top座標一致、回帰防止)

修正前(styles.cssの当該差分を `git stash` で退避)でこのテストを実行し、①③のうち①の3項目が
`❌`(exit 1)で落ちることを確認した上で、修正を戻して全項目PASSに変わることを確認済み。

---

## 検証結果

- `node --check app.js`: OK(exit 0、app.js自体は無変更)
- `node tests/v93.test.js`: ALL PASS(修正前は3件失敗することを確認済み、上記参照)
- `node tests/v90.test.js`: ALL PASS(v90の大テーマ階層機能に回帰なし)
- `npm run test:core`(コアセット、v89〜v93 + 固定コア5本の計10本): **ALL PASS**、所要149.3秒
- 修正前後のスクリーンショット(390px幅・28グループ300件規模の合成データ):
  - 修正前: `before_zero_sec_390_top_confirmed.png`(本文が縦に1文字ずつ折り返され、
    テーマ1件分が画面を大きく占有)
  - 修正後: `after_zero_sec_390_top.png`(本文が横幅いっぱいに通常改行、☆/select/書く→/×が
    次の行に整列)
  - 置き場所: `C:\Users\kojit\AppData\Local\Temp\claude\C--Users-kojit-Documents-ClaudeCode\ac3cec4e-418b-4f65-ade2-106241939040\scratchpad\`

---

## 未対応・懸念点

- **実機iOS Safari(iPad/iPhone)での実地確認はこのセッションでは行っていない**
  (taskchute-ipad本体はcommit/push禁止のため、Kの承認後の反映時に確認を推奨)。
  Playwright Chromiumでのビューポート再現・スクリーンショット確認のみ。
- 極端に古い/小さい端末幅(320px、iPhone SE初代相当)では、大テーマ階層(グループ)配下の
  2行目(☆+select+書く→+×、固定幅合計約279px)がインデント22px分と重なりごく僅かに
  窮屈になる可能性がある(理論値では約21pxの余裕不足)。現行の実運用端末(iPhone SE以降は
  375px以上)では発生しないため、今回のスコープでは対応していない。気になる場合は
  `.zt-theme-group-select` の `max-width` をさらに狭い専用メディアクエリで縮める対応が考えられる。
- 修正はCSSのみ(`.zt-theme-item` の折り返し)で、`ztRenderThemeItem()` のDOM構造(app.js)は
  変更していない。
