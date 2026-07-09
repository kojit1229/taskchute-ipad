# CHANGES v58

## 概要

`../taskchute-notes/review.md` に残っていた Codex レビュー未対応指摘(9件)を一括対応した。
作業開始前にコード現物を確認したところ、下記7件は **v56 の時点で実装済み**であり、
review.md 側のチェックが更新漏れになっていただけだったと判明した(app.js/styles.css は
今回の作業では無変更)。

## 判定結果

| # | 指摘 | 判定 |
|---|---|---|
| 1 | weekRange()/isWishStagnant()/Pomodoro系の new Date(文字列)パース(high) | v56で `parseDate()`/`localDateTimeToMs()` に統一済み → review.md 更新漏れをクローズ |
| 2 | .zt-add-text/.zt-search-input/.home-cd の font-size 16px未満(med) | v56で16px化済み → review.md 更新漏れをクローズ |
| 3 | AIプロンプト textarea の inline font-size:12px(med) | v56で16pxに修正済み → review.md 更新漏れをクローズ |
| 4 | .timeline-card hover の transform: translateX(-2px)(med) | v56で box-shadow ベースに置換済み → review.md 更新漏れをクローズ |
| 5 | AI下書き削除ボタンが .draft-resize に奪われる(high) | v56で `.draft-remove` に z-index:2 付与済み → review.md 更新漏れをクローズ |
| 6 | assets/icon.svg 不在で404(med) | v56で追加済み → review.md 更新漏れをクローズ |
| 7 | 問いモーダル placeholder の未エスケープ引用符(low) | v56で全角鉤括弧に置換済み → review.md 更新漏れをクローズ |
| 8 | AIフィードバックfetchの404ノイズ(low) | v56/v57で対応済み(既に [x] 済み、変更なし) |
| 9 | 機能改善案: 計器盤ドリルダウン(low) | 機能追加のため見送り(review.mdに注記) |
| 10 | 機能改善案: AI下書きのUndo/Redo・却下理由メモ(low) | 機能追加のため見送り(review.mdに注記、項目9と同種と判断) |

## 変更内容

- `sw.js` の `CACHE_NAME` を `v57` → `v58` に更新(PWA強キャッシュ対策。今回はUI/ロジックの
  変更は無いため実質的な再取得コンテンツは無いが、リリース番号の一貫性のため更新した)。
- `tests/v58.test.js` を新規追加。上記1件目・5件目が「たまたま直っていた」で終わらせず、
  将来の先祖返りを検知できるように以下の回帰テストを固定化した:
  - `isWishStagnant()` の60日境界を `"YYYY-MM-DDTHH:mm:ss"` 形式で判定(30日前=非停滞、
    61日前=停滞、🐢マーカーで検証)
  - Pomodoro の `startedAt`/`endsAt`(同フォーマット)から残り時間が正しく算出される
    (セッション切れとして自動リセットされない、2倍速換算値が期待レンジ内)
  - `weekRange()` の週起点(土曜)判定(土曜は週次レビュー導線が出る/金曜(前週扱い)は出ない)
  - 15分の極短AI下書きBlock(高さが下限26pxに張り付くケース)で `.draft-remove`(×)が
    `.draft-resize` に横取りされずクリックできる(実際に `styles.css` の `z-index:2` を
    一時的に外して本テストが確実に落ちることを確認済み)
- `../taskchute-notes/review.md` の該当9指摘を `[x]` または明示的な見送り注記に更新
  (taskchute-notes リポジトリ側、コミット&プッシュ済み)。

## 変更ファイル

- `sw.js`(`CACHE_NAME`、1行目)
- `tests/v58.test.js`(新規)
- `../taskchute-notes/review.md`(notes リポジトリ側)
- `../taskchute-notes/handoff.md`(notes リポジトリ側、本エントリ追記)

## 懸念点・レビュー観点

- 今回 app.js / styles.css には**機能修正を一切加えていない**。review.md の記述と実コードが
  食い違っていた原因(v56作業時にコードは直したが review.md のチェックを更新し忘れた)は
  今回の作業では特定できていない。次回以降、コード修正コミットと review.md 更新を必ず
  セットでコミットする運用を徹底したい。
- SW の `CACHE_NAME` を上げたが、配信物(app.js/styles.css/index.html等)は前回(v57)から
  無変更。強キャッシュの都合上バージョンだけ上げたため、実機での「反映確認」は事実上
  意味を持たない(内容が同じため)。次に実コード変更が出るタイミングでまとめて確認で問題ない。
- 項目10(AI下書きのUndo/Redo・却下理由メモ)は監督者から明示的な見送り指示が出ていた
  項目9(計器盤ドリルダウン)と同種の「機能改善案」と判断し、同様に見送った。個別の
  対応要否判断が必要であれば次回指示してほしい。

## テスト

`npm test`(`node tests/run-all.js`)で全スイート実行。`tests/v58.test.js` 単体、および
`tests/v58.test.js` のみ `.draft-remove` の `z-index:2` を一時的に外した状態で実行し、
本テストが確実に赤くなる(`.draft-resize intercepts pointer events`)ことを確認した上で復元済み。
