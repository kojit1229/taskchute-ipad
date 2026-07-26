# v141 ジャーナルタブ改修: AIフィードバック列の撤去+「今日行ったお店」ログ

K依頼(ジャーナルタブから使っていないAIフィードバック列を撤去して残り2列を広げる/
当日行ったお店を登録する欄と年間一覧を追加する)への対応。①→②の順に完成させた。

## ①: AIフィードバック列の削除(UI表示のみ)

**変更内容**: ジャーナルタブの3列目(🤖 AIフィードバック — 表示/.mdアップロード/AI返信取り込み/
実験にする/昨日のAIフィードバックを見るdetails)を撤去し、`.journal-grid`を2列
(`0.8fr 1.4fr 0.8fr` → `0.8fr 1.4fr`)にした。残り2列(前日/当日編集)は3列目の分だけ
自動的に拡幅される。

**スコープ**: UI表示の削除のみ。AIフィードバックのfetchロジック(`hydrateStaticMarkdown`)・
保存データ(`state.feedback`/`cachedFeedback`)は無変更。前日フィードバックを読む機能自体は
Homeの「AIから」カード(`homeAiFeedbackReadHTML`、v75〜)に一本化されている(元々ホームと
ジャーナルの二重掲載だった)。

**変更ファイル**:
- `app.js`: `renderJournal()`から3列目パネルと関連の一時変数(feedbackFromFile等)を削除。
- `styles.css`: `.journal-grid`のgrid-template-columnsを2トラックに変更。
- `tests/v57.test.js`: 「前日フィードバックがジャーナルに反映される」検証をHomeの
  「AIから」カード(`.home-ai-feedback-read`)へ差し替え。
- `tests/v60.test.js`: 「.mdアップロード欄がジャーナルに存在する」チェックを、UI撤去に
  伴い「存在しない」チェックへ更新。
- `tests/v68.test.js`: ジャーナルのAIフィードバック欄「🧪 実験にする」ボタンの回帰チェック
  ([7])を削除(ボタン自体が無くなったため。同じガードは実験カード本体([5][6])で確認済み)。
- `tests/v76.test.js`: ジャーナルタブの「昨日のAIフィードバックを見る」details
  (`.journal-yesterday-feedback`)に関する検証([2][2b])を削除し、コメントで撤去の経緯と
  代替検証先(Home「AIから」カード、同スイートの[1][1b])を明記。[3]のジャーナル側404
  チェックも同様に削除。
- `tests/v83.test.js`: [B8-2](renderMarkdownキャッシュのcachedFeedback更新反映)の
  検証対象をジャーナルからHomeの「AIから」カードへ差し替え。
- `tests/v137.test.js`: [1-b](フォーカス離脱後のrender flush確認)を、消えたAI
  フィードバック文言ではなくテスト用DOM marker(data-test-marker)の消失で検証する方式に
  変更。[1-a]の`.journal-yesterday-feedback`カウントチェック(常に0で無意味になった)を削除。

## ②: 「今日行ったお店」ログ+年間一覧

**変更内容**:
- ジャーナルタブ(当日編集パネル、運動記録カードの下)に「🏪 今日行ったお店」カードを追加。
  1件 = 店名/URL(任意)/感想の3枠。「+ 追加」でモーダルを開いて登録、1日に複数件登録可。
  各行に「編集」「×(削除、確認ダイアログつき)」ボタン。
- データは新規コレクション `state.storeVisits: [{id, date, name, url, comment, createdAt,
  updatedAt, deleted}]`。`normalizeState`にマイグレーションを追加(`{ 既定値, ...既存 }`の
  順で既存データを壊さない)。
- 多端末同期は tasks/projects と同じ `mergeByIdPreferNewer`(updatedAt優先+同値時は
  tombstone優先)で `computeSyncMerge`/`applySyncMergeToLocal`/`applySyncMergeToRemote`
  に組み込んだ(soft-delete対応のコレクションのため、bodyScans等が使う単純な`mergeById`
  ではなく、削除の巻き戻り防止ロジックを持つ方を採用)。
- 年間一覧: 「📅 年間一覧」ボタンでモーダルを開き、選択中ジャーナル日付の年を対象に月別
  グループ表示(日付・店名・感想。URLがあればリンク)。0件の月は省略。既存モーダル基盤
  (`state.modal`/`renderModal`/`submitModal`/`deleteFromModal`)をそのまま流用。
- URLは`safeExternalUrl()`でhttp(s)スキームのみリンク化する(`escapeHTML`は文字の
  エスケープのみでjavascript:等の危険なスキームは防げないため)。安全でない値は店名を
  プレーンテキストとして表示するフェイルセーフにした。

**規約遵守**: click デリゲーション+data-action(`store-visit-add`/`store-visit-edit`/
`store-visit-delete`/`store-visit-year`)。name/url/comment入力欄はすべてinline
`font-size:16px`(iOS自動ズーム防止)。日付は`state.selectedDate`/`YYYY-MM`文字列処理のみで
`new Date(文字列)`は未使用。

**変更ファイル**:
- `app.js`: `normalizeState`にstoreVisitsマイグレーション追加。`safeExternalUrl`/
  `storeVisitsForDate`/`renderStoreVisitsCard`/`openStoreVisitEditor`/`buildStoreVisitModal`/
  `saveStoreVisitFromModal`/`deleteStoreVisit`/`deleteStoreVisitWithConfirm`/
  `openStoreVisitsYearModal`/`buildStoreVisitsYearModal`を新設。クリックデリゲーションへ
  `store-visit-add`/`store-visit-edit`/`store-visit-delete`/`store-visit-year`を追加。
  `submitModal()`/`deleteFromModal()`に`storeVisit`分岐を追加。`computeSyncMerge`/
  `applySyncMergeToLocal`/`applySyncMergeToRemote`にstoreVisitsのマージ処理を追加。
  `renderJournal()`から`renderStoreVisitsCard(date)`を呼び出す行を追加。
- `tests/v141.test.js`(新規): ①②両方をカバー(ジャーナル2列化・AIフィードバックDOM不在・
  Home側回帰、storeVisitsのnormalizeState後方互換、新規追加/バリデーション/編集/削除
  (キャンセル・確認・モーダル削除ボタン経由の両経路)/年間一覧の月別グループ・年フィルタ・
  危険URL非リンク化)。

## 共通

- `sw.js`: CACHE_NAME を v140→v141 に更新。

## テスト

`node tests/run-all.js v57 v60 v68 v76 v83 v137 v141` ALL PASS(7スイート)。
`npm test`(全量)はpush前に別途実行して確認する。

## 自信がない箇所・未対応

- 年間一覧に年の切替(前年/翌年ボタン)は付けていない(依頼の操作導線一覧に無かったため
  最小実装。対象年は常に選択中ジャーナル日付の年)。将来必要なら追加を検討。
- 年間一覧からの直接編集/削除は実装していない(当日欄=日付ピッカーで対象日へ移動して
  編集/削除する設計。依頼の操作導線でも年間一覧は「開く/閉じる」「URLリンクを開く」のみ
  だったため)。
