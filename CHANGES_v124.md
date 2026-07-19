# v124 押下フィードバック + モーションの磨き + reduced-motion対応(apple-design HIG)

## 目的

apple-design Skill(Apple HIG/WWDC設計知見)の §1 Response(押下フィードバック)、§4
Behavior over animation(減衰スプリング近似のイージング)、§12 Materialize(モーダルの実体化)、
§14 Reduced motion を、v123(タイポグラフィ+マテリアル)に続く「磨き」として反映する。
`.timeline-card` / `.draft-*`(タイムライン絶対配置系、過去にリバート事例のある不可侵領域)には
一切transformを付けていない。

## 変更点(styles.css のみ。app.js・index.htmlは無変更)

### 1. 押下フィードバック(§1)

- `.btn`(全ボタンバリアント共通の基底ルール)と `.nav-button` / `.bottom-nav button`(サイドバー
  ナビ・ボトムナビの共有ルール)に `transition: transform 100ms ease-out;` を追加し、
  `:active { transform: scale(0.97); }` を新設。hoverではなく押下(pointerdown〜up)の瞬間に
  反応する。

### 2. イージングの統一(§4)

既存の `transition`/`animation` を全数走査し、`ease`/`linear` 系で250msを超え、かつ実際に
「動き」を伴う(色・不透明度だけではない)箇所を洗い出したところ、該当したのは以下2箇所のみ
だった(他は元々150〜200ms程度で収まっているか、色/不透明度のみの遷移だったため変更していない)。

- `.pomo-progress-circle`(ポモドーロ円形プログレス): `stroke-dashoffset 0.4s ease-out` →
  `stroke-dashoffset 300ms cubic-bezier(0.22, 1, 0.36, 1)`
- `.just-started`(着手ジュース、v40): `just-started-juice 0.3s ease-out` →
  `just-started-juice 280ms cubic-bezier(0.22, 1, 0.36, 1)`(既存の
  `@media (prefers-reduced-motion: reduce) { .just-started { animation: none; } }` はそのまま)

`.zt-write-card.run::before`(0秒思考の60秒カウントダウンバー、`animation: zt-drain 60s linear`)
は**意図的に変更していない**。線形の減衰は「時間が一定速度で経過している」ことを表す実用的な
表現であり、スプリング的な緩急を付けると逆に誤解を招くため(設計判断を参照)。同様に
`zt-pulse`(opacity のみのループ)も「色・不透明度だけの遷移は現状維持でよい」の対象として無変更。

### 3. モーダルのマテリアライズ(§12)

`.modal-card` に enter アニメーションを追加した:

```css
.modal-card { animation: modal-materialize 200ms cubic-bezier(0.22, 1, 0.36, 1); }
@keyframes modal-materialize {
  from { opacity: 0; transform: scale(0.98); }
  to   { opacity: 1; transform: scale(1); }
}
```

`renderModal()` は `modalRoot.innerHTML` を書き換えてから `.open` クラスを付ける実装であり、
モーダル内フィールドの入力(change/input)は個別ハンドラが `saveState()` するだけで
`renderModal()` を再実行しない(app.js 718行目付近で確認済み)。そのため `.modal-card` は
開いた瞬間に一度だけDOMへ挿入され、アニメーションは開いた時にだけ発火し、入力のたびに
再生されることはない。閉じる側のアニメーションは `closeModal()` が `innerHTML = ""` で
即時除去する実装のため、JS変更なしには追加できずスコープ外とした(依頼どおり)。

### 4. reduced-motion(§14)

`@media (prefers-reduced-motion: reduce)` ブロックを新設(styles.css 末尾)。「無効化」ではなく
「穏やかな等価表現」に倒す方針で、以下を実施:

- (a) 今回追加した transform 系の transition/animation を止める: `.btn` / `.nav-button` /
  `.bottom-nav button` の transition を `none` に、`:active` の `transform` を `none` に、
  `.pomo-progress-circle` の transition を `none` に、`.just-started` の animation を `none` に
  (既存の1行はそのまま活かし、新ブロック側でも同じ指定を明示)。opacity/colorのフェード
  (`zt-pulse` 等)には触れていない。
- (b) 完了演出(`.ce-particle`/`.ce-message`/`.ce-next`、v17〜v18のきらめき粒子)を短い
  フェード(400ms、`ce-fade-reduced` keyframes、opacityのみ)に縮退。`transform` プロパティを
  一切指定しないことで、各要素の基本ルールが持つ静的な `transform`(位置決め用の `translate`)
  がそのまま保たれ、位置ズレを起こさない(CSS Animationsの仕様上、animatedでないプロパティは
  underlying valueが維持される)。
- (c) モーダルのマテリアライズは `modal-materialize-reduced`(opacityのみ、150ms）に差し替え、
  scaleを外した。

### 5. compositor-friendly(§11)

新規に追加した `modal-materialize` / `ce-fade-reduced` / `modal-materialize-reduced`
keyframesはいずれも `transform` と `opacity` のみを使用し、width/height/margin等のレイアウトに
影響するプロパティはアニメーションしていない(`tests/v124.test.js` で静的検査)。

### 6. Service Worker

`CACHE_NAME` を `v124` に更新。

## 不可侵の制約の遵守確認

- `.timeline-card` / `.draft-*` へのtransform追加は一切していない(grep確認済み、
  `tests/v124.test.js` の静的検査でも回帰防止)。
- `input`/`select`/`textarea` の `font-size: 16px` 指定は変更していない。
- z-index体系・モーダルの重なりは無変更。
- 既存テストの削除・スキップ・弱体化なし。
- app.jsは無変更(モーダルの`renderModal()`実装は読解のみで変更していない)。

## 検証手順

1. `node --check app.js` / `node --check sw.js`
2. `node tests/run-all.js v123 v124`
3. `node tests/run-core.js`

## 追補(Codexレビュー P2指摘対応。HEAD b16a0a9 以降の作業ツリー差分)

上記4.のreduced-motionブロックは「v124で新規に追加した」transform系のtransition/animationしか
止めておらず、**v124以前から存在していた**transform系の位置エフェクトが reduced-motion環境でも
動き続けたまま残っていた(Codexレビュー指摘: `.toast` の `translateY(20px)` 系スライド、
`.routine-card:hover` の水平シフト、開閉シェブロンの `rotate`)。CHANGES_v124.md冒頭の
「transform系を無効化」という記載と実態が乖離していたため、styles.css全体を
`transform\s*:` / `transition:` / `animation:` / `@keyframes` で網羅的に洗い出し、対象を
再点検した。

### 洗い出し結果

| 対象 | 判定 | 理由 |
|---|---|---|
| `.toast` / `.toast.show`(translateX(-50%) translateY(20px→0)) | **対象・追加対応** | translateXは中央揃えの静的transform(除外b)だが、translateYは`transition: opacity 0.2s ease, transform 0.2s ease`で実際にアニメーションしているスライド。指摘の1件目 |
| `.routine-card:hover`(translateX(2px)、base側`transition: all 0.15s ease`) | **対象・追加対応** | hoverで水平にアニメーション移動する。指摘の2件目 |
| `.journal-prompts summary::before` / `.home-fold-chevron` / `.lev-helper summary::before`(`transition: transform 0.15s ease`、`[open]`側で`rotate(90deg)`) | **対象・追加対応**(3箇所) | 開閉状態を表す回転がアニメーションしている。指摘の3件目(同型が3箇所あったため全て対応) |
| `.zt-write-card.run::before`(`animation: zt-drain 60s linear`、`scaleX(1→0)`) | **対象・追加対応**(新規発見) | 除外(a)(b)(c)いずれにも該当しない(opacity/colorのみでも静的transformでもtimeline-card系でもない)ため、網羅の原則上は含める必要がある。0秒思考の60秒カウントダウンバー。停止すると視覚的な残り時間表現は失うが、「WRITING — 1 MINUTE」の文言表示と`zt-pulse`(opacityのみ、除外a)は残るため状況把握手段はゼロにはならない。**設計判断としての注記**: 元のCHANGES_v124.mdでは「線形の減衰は時間経過を表す実用表現なので通常モーションのイージングは変えない」と書いたが、これは「イージングを変えない」であって「reduced-motionで止めない」とは別の論点であり、両立する(通常表示のスプリング化はしない/reduced-motion時は止める、で矛盾しない) |
| `.pomo-time-overlay` / `.tl-complete-btn` / `.pomo-fs-bg-iframe` / `.pomo-fs-tabs`(`translate(-50%, -50%)`等) | 除外(b) | いずれも同要素に`transition`が無く、値も変化しない純粋な位置決め(センタリング)用の静的transform。動きではない |
| `.home-score:active`(`transform: scale(0.985)`) | 除外(「transitionを伴わない」ため対象外) | `.home-score`に`transition`が一切定義されておらず、`:active`時の値変化は瞬時(アニメーションなし)。除外(a)(b)(c)の3類型そのものではないが、「transition/animationを伴う」という指摘の前提条件を満たさない |
| `.zt-search-row::before`(`translateY(-50%)`) | 除外(b) | 検索アイコンの縦センタリング、transitionなし、静的 |
| `.ce-particle` / `.ce-message` / `.ce-next` / `.modal-card` / `.btn` / `.nav-button` / `.bottom-nav button` / `.pomo-progress-circle` / `.just-started` | 対応済み(変更なし) | 元のv124 reduced-motionブロックで既に対応済み |
| `.timeline-card` / `.draft-*` 全般 | 除外(c) | 不可侵領域。transformを付けるルール自体が存在しない(grep確認済み、無変更) |

### 追加した reduced-motion 対応

`@media (prefers-reduced-motion: reduce)` ブロックをもう1つ追加(styles.css、元の4.のブロックの
直後)し、以下を実施。いずれも「消すのはtransition/animationであってtransformプロパティ自体では
ない」の原則どおり、状態を表すtransformの値(`rotate(90deg)`等)自体は変更していない:

- `.toast { transition: opacity 0.2s ease; }` — transitionからtransform分を外し、opacityのみに。
  `.toast`/`.toast.show`双方のtransform値自体は無変更(横方向のtranslateX(-50%)センタリングは
  維持したまま、縦方向のスライドだけアニメーションしなくなる)。
- `.routine-card:hover { transform: none; }` — hover時の水平シフト自体を打ち消す。base側の
  `transition: all`(border-colorのフェードも兼ねる)はそのまま残した。
- `.journal-prompts summary::before, .home-fold-chevron, .lev-helper summary::before { transition: none; }`
  — 3箇所の開閉シェブロンの回転アニメーションを止める。`[open]`側の`rotate(90deg)`ルールは
  無変更のため、開閉状態そのものは瞬時切り替えで引き続き視覚的に分かる。
- `.zt-write-card.run::before { animation: none; }` — 60秒カウントダウンバーの縮退。

### テスト

`tests/v124.test.js` に静的検査を5件追加(既存チェックは無改変):
reduced-motionブロックが `.toast` / `.routine-card:hover` / 開閉シェブロン3種 /
`.zt-write-card.run::before` をカバーしていること、およびシェブロンの`rotate(90deg)`自体は
reduced-motionブロックの外(通常ルール側)に残っていることを確認する。

### 検証(追補分)

- CSS波括弧バランス: 970開/970閉、一致(`python`でカウント確認)
- `node tests/v124.test.js`: **ALL PASS**(新規5件含む全18件の静的検査 + 起動/モーダル開閉/
  押下フィードバックのブラウザ検証)
- `node tests/run-all.js v124`: **ALL PASS**
- ブラウザ実機確認(CSSOM経由): `document.styleSheets`から実際にパースされた
  `@media (prefers-reduced-motion: reduce)` ルールを読み出し、`.toast`/`.routine-card:hover`/
  シェブロン3種/`.zt-write-card.run::before`が意図通りの内容になっていること、かつ通常時
  (`.toast`のtransition・`.routine-card:hover`のtransform)が無変更のままであることを確認。
  コンソールエラーなし。

### 監督判断による差し戻し(zt-drain)

上記追補で一度は reduced-motion 対象に含めた `.zt-write-card.run::before`(zt-drain、
0秒思考の60秒カウントダウンバー)は、**監督レビューで対象から外した(=reduced-motionでも
動かし続ける)**。理由: 3px・60秒・1回きりの残り時間表現で前庭刺激性がなく、停止すると
「残り時間」という機能情報が失われる。apple-design §14 の reduced motion は「フィードバックの
除去」ではなく「穏やかな等価物への置換」であり、本件は置換ではなく情報喪失になるため。
tests/v124.test.js は「reduced-motionブロックが zt-drain を含まないこと」を検証する形に反転済み。
