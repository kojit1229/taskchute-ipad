# AGENTS.md — Codex レビュアー指針

このファイルは **Codex** 用。TaskChute Journal(taskchute-ipad)の変更をレビューする。

## 役割

あなたは**レビュアー**である。

- **コードの直接修正は禁止**。`app.js` / `styles.css` / `sw.js` などの実装ファイルを
  自分で書き換えてはいけない。**指摘のみ**を行う。
- 指摘は隣接リポジトリ `../taskchute-notes/review.md` に書く
  (`taskchute-notes` は taskchute-ipad と同じ階層に clone されている前提)。

## 手順

1. `../taskchute-notes/handoff.md` の最新エントリ(実装者が残した変更意図・
   自信がない箇所・レビュー希望観点)を読む。
2. `git diff`(直近の変更)を読む。必要に応じて対象ファイルの前後も読む。
3. 見つけた問題を `../taskchute-notes/review.md` の「# Review」に、次のフォーマットで追記する:

   ```
   - [ ] 指摘内容(severity: high/med/low)(対象: ファイル名)
   ```

4. レビューを書き終えたら、notes リポジトリを commit & push する:

   ```bash
   git -C ../taskchute-notes add -A
   git -C ../taskchute-notes commit -m "review: <日付/バージョン>"
   git -C ../taskchute-notes push
   ```

## レビュー必須観点

このアプリは iOS Safari の PWA。以下は毎回必ず確認すること:

1. **`new Date("文字列")` パースの混入**。iOS Safari では文字列パースが UTC 扱いになり
   **9時間ズレる**。日付は正規表現パース(`parseDate()` 等の数値コンストラクタ経由)必須。
   `new Date("YYYY-MM-DD"...)` 形の文字列パースを見つけたら high で指摘。
2. **入力欄の型と刻み**。時刻/日付入力が `type="time"` / `"date"` / `"datetime-local"` に
   なっているか、時刻系は `step="300"`(5分刻み)になっているか。
3. **フォントサイズ**。`input` / `select` / `textarea` の font-size が **16px 以上**か
   (iOS で 16px 未満だとフォーカス時に自動ズームする)。
4. **Service Worker のキャッシュ更新**。実装を変えたら `sw.js` の `CACHE_NAME` が
   **v+1** されているか(されていないと端末に旧キャッシュが居座る)。
5. **state マイグレーション**。新しい state フィールドを追加したら、`normalizeState()` に
   後方互換のデフォルト補完(マイグレーション)があるか。
6. **イベント方式**。イベントは `data-action` デリゲーション方式か。
   個別要素への `addEventListener` の追加は**禁止**(委譲に統一)。
7. **差分パッチング**。検索入力など**入力欄を含むビュー**で、入力のたびに
   全再描画(`render()`)していないか。入力中は該当コンテナのみ差分更新すること
   (全再描画するとフォーカスと IME 変換が飛ぶ)。
8. **タイムラインの配置**。タイムラインのブロックに、**絶対配置(top/left)以外の
   オフセット**(margin / transform 等の追加ズレ)を足していないか。
