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
