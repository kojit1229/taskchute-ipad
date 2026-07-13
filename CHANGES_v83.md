# CHANGES v83

## 概要

UX監査(`workbench/out/2026-07-12-ux-audit/findings.md`)のK承認済み2件、
B4(完了トグルの見た目統一)+B8(Markdown描画キャッシュ)に対応。
SW `CACHE_NAME` を v82 → v83 に更新。

---

## B4: 完了トグルUIの形状を「丸チェック」に統一

現状5種の完了トグルは形状がバラバラだった。

| クラス | 変更前の形状 | 変更後 |
|---|---|---|
| `.home-box`(ホーム: 今日の主役/12週サイクル/週次タスク) | 角丸四角20px(border-radius:6px) | **円20px**(border-radius:50%) |
| `.home-dot`(ホーム: タスクシュート/ながれ) | 既に円20px | 変更なし |
| `.checkbox-button`(タスクシュート実行リスト/WBS) | 既に円30px(border-radius:999px) | 変更なし |
| `.tl-complete-btn`(タイムラインカード) | 既に円24px(border-radius:50%) | 変更なし |
| `.wish-check`(Wish、ネイティブ`<input type="checkbox">`) | ネイティブ角丸四角(OS依存の既定描画) | **円24px**(appearance:none + 自前描画) |

実質的な変更点は `.home-box` の border-radius 変更(1行)と、`.wish-check` の全面的な
CSS再定義(appearance:none化)の2点のみ。`.home-dot`/`.checkbox-button`/`.tl-complete-btn`
は既に円形だったため変更していない(サイズも文脈ごとの現行値のまま。見た目の「形」を
揃えるのが目的で、レイアウト崩れ回避を優先する方針のため)。

### チェック済み状態(塗り+✓)の統一

- `.home-box`(`.home-ck.done .home-box`)・`.checkbox-button.done` は既存どおり
  `background: var(--green)` + テキストノード `✓`。
- `.wish-check` は appearance:none化に伴い、ネイティブのOS既定チェックマークが失われるため、
  `:checked` 擬似クラスに `background: var(--green)` と `::after { content: "✓" }` を追加し、
  他の完了トグルと同じ「塗り+白い✓」の見た目に揃えた。
- `.tl-complete-btn` は完了すると要素自体がDOMから消える(タイムラインカードの背景色変化で
  完了を表現する既存設計。app.js:5132 `!isActual && !isShort` の条件で非完了時のみ描画)ため、
  この挙動は変更していない(チェック済み状態そのものが存在しない要素なので統一の対象外)。

### wish-checkの技術詳細(appearance:none化)

`accent-color`によるネイティブ描画のカスタマイズには限界があり(実機・ブラウザでの見た目が
統一できない)、`appearance: none` + `box-sizing: border-box` で完全に自前描画へ切り替えた。
`::after`による✓表示は、`appearance:none`を指定した`<input>`要素であれば生成コンテンツが
描画される(広く使われている実装パターン)。`<input type="checkbox">`・`data-action`・
`checked`属性・イベント委譲は無変更のため、既存のトグルロジック(realizeWish/unrealizeWish)
には触れていない。

### v81の当たり判定44px拡張(壊していないことを確認済み)

- `.home-box::before`(inset:-12px)はセレクタ自体を変更していないため無影響。
- `.wish-check-wrap`(labelラッパー、padding:10px/margin:-10px)は`.wish-check`本体の
  width/height(24px、box-sizing:border-box化後も総サイズは変わらず24px)を前提にしており、
  今回のCSS変更後も実測で44px相当を維持していることをテストで確認した。

---

## B8: `renderMarkdown` の結果メモ化

### 課題

ジャーナル(前日journal・AIフィードバック)とホーム「AIから」は、再描画のたび
(完了トグル1回でも)`marked.parse` → `sanitizeHTML`(DOM走査)をフルで再実行していた
(app.js:5691/5669付近、B7と重複する無駄な再計算)。

### 対処

`renderMarkdown(text)` を薄いキャッシュ層に変更し、実際のparse+sanitizeは
`renderMarkdownUncached(text)` に切り出した。

```js
const MARKDOWN_RENDER_CACHE_LIMIT = 50;
const markdownRenderCache = new Map(); // key: 入力テキストそのもの, value: サニタイズ済みHTML

function renderMarkdown(text) {
  const key = text || "";
  if (markdownRenderCache.has(key)) { ... return cached; }  // ヒット時はMap末尾へ移動(簡易LRU)
  const html = renderMarkdownUncached(key);
  markdownRenderCache.set(key, html);
  if (markdownRenderCache.size > MARKDOWN_RENDER_CACHE_LIMIT) { ... 最古のキーを1件破棄 }
  return html;
}
```

- **キー設計**: 入力テキスト文字列そのもの(ハッシュ化はしない。テキスト長は数千文字程度で
  Mapのキーとして問題にならない規模のため、シンプルさを優先した)。
- **明示的invalidationが不要な理由**: `cachedFeedback[date]`は新着fetchで文字列自体が
  変わる(バッチが生成するAIフィードバックMarkdownは内容が毎回変わる)ため、古い内容の
  キャッシュキーはそのまま参照されなくなり、新しい内容は新しいキーとして自然に再parseされる。
  同じ内容が再度必要になった場合(例: 日付ナビゲーションで前日パネルを行き来する)はキャッシュ
  ヒットし、再parseされない。
- **上限**: 50件を超えたら挿入順(=最終アクセス順、ヒット時に末尾へ移動する簡易LRU)で
  最も古いものから1件ずつ破棄する。ジャーナル・AIフィードバック・Vision/Affirmationなど
  用途が限られており、日常利用で50件を大きく超えることは想定していない。
- サニタイズ後のHTML(`sanitizeHTML`を通した後の戻り値)をキャッシュするため、安全性
  (script除去等)は既存のまま維持される。

---

## SW

`CACHE_NAME`: `taskchute-journal-pwa-v82` → `taskchute-journal-pwa-v83`

## テスト

`tests/v83.test.js` を新規追加。

1. 完了トグル5種(`.home-box`/`.home-dot`/`.checkbox-button`/`.tl-complete-btn`/`.wish-check`)
   がすべて円形(border-radiusが短辺の半分以上)であることをcomputed styleで検証。
2. チェック済み状態の塗り色が3クラス間(`.home-box`/`.checkbox-button`/`.wish-check`)で
   一致すること、✓が表示されること(`.wish-check`は`::after`のcontent)を検証。
3. v81で入れた当たり判定44px拡張(`.home-box::before`のinset、`.wish-check-wrap`の
   実ボックスサイズ)が壊れていないことの回帰確認。
4. `renderMarkdown`のキャッシュ: `window.marked.parse`をスパイし、同一テキストの再描画では
   呼び出し回数が増えない(キャッシュヒット)こと、異なるテキストでは正しく新しい内容が
   表示される(キャッシュミスで再parseされ、かつ取り違えが無い)ことを、ジャーナルの
   前日パネル+日付ナビゲーションで検証。
5. cachedFeedback更新(新着fetch)時の表示更新: `page.route`でAIフィードバックのfixtureを
   差し替えて2回起動し、新しい内容が正しく表示され、古い内容が残留しないことを検証
   (v57/v62と同じfixture差し替え手法)。

`npm test`(全31スイート)ALL PASS。

## 未対応・懸念点

- `.tl-complete-btn`はチェック済み状態自体を持たない設計(完了すると要素が消える)ため、
  「塗り+✓」の統一対象からは実質除外している。将来的にB7(部分DOM更新)に着手する際、
  タイムラインの完了表現も見直すならこの点も合わせて再検討する余地がある。
