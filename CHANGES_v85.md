# CHANGES v85

## 概要

K報告「ビジョンボードが見れない」の原因特定・修正と、「各タブは基本的に今日を表示する」機能を実装した。

## [A] 不具合修正: ビジョンボードが見れない

### 原因(現物調査)

「ビジョンボード」は `#vision` タブ内の3セグメント(ビジョン/アファメーション/**ビジョンボード**)の
うち、`renderVisionBoard()`(app.js)が描画する45歳/80歳/今(33歳)の3枚のPDFビューア
(`now_vision.pdf` / `45_vision.pdf` / `80_vision.pdf`)を指す。

`renderVisionBoard()` は `<object data="./now_vision.pdf#view=FitH">` のように、これらのPDFを
**同一オリジンの相対パス**でそのまま埋め込んでいた。しかし2026-07-10のv72個人データ分離移行
(workspace CLAUDE.md NEVER 9参照)で、Vision.md / Daily_Affirmation.md / 各PDFは
`personal-data`リポジトリ(private、`taskchute/content/`配下)へ移動しており、
`taskchute-ipad`(GitHub Pages配信の同一オリジン)には**もう存在しない**。実際、
`git log --diff-filter=D`ではなく現在のリポジトリ直下に `*.pdf` が1つも無いことをコード現物で確認した。

Vision.md / Daily_Affirmation.md は同じv72移行の際に `fetchGitHubRawText("content/Vision.md")`
経由(`hydrateStaticMarkdown()`)へ既に直っていたが、**PDF側(`renderVisionBoard`)だけが旧実装の
まま取り残されていた** — これが「ビジョンボードが見れない」(実際には常に404)の直接原因。
`sw.js` の `APP_SHELL` にも `./now_vision.pdf` 等が残っており(`cache.add()`が個別に静かに404
していただけで実害は無かったが)、同根の残骸として合わせて削除した。

### 修正内容

- `fetchGitHubRawResult(name, kind)` に `kind="blob"` を追加(既定は従来通り `"text"`)。
  GitHub Contents APIは `Accept: application/vnd.github.raw+json` 指定時、1〜100MBのファイルでも
  raw bytesをそのまま返す(1MB以下限定ではない)ため、`response.blob()` を使えばテキストと
  同じ経路でPDF等のバイナリも読める。既存呼び出し元(`fetchGitHubRawText`、kind省略)の挙動は
  一切変えていない。
- 新設 `fetchGitHubRawBlob(name)`: personal-data Contents APIからバイナリをBlobとして取得する。
- 新設 `ensureVisionPdfLoaded(file)`: 1ファイル1回だけ`fetchGitHubRawBlob(`content/${file}`)`し、
  成功したら `URL.createObjectURL(blob)` でBlob URL化してモジュール内キャッシュ
  (`cachedVisionPdfUrls`)に保存。ビジョンボードを開いたままなら`render()`で反映する。
  多重fetch防止に `_visionPdfLoadInFlight` を使用。
- `renderVisionBoard()` を書き換え: 個人データ未接続なら接続を促す案内、取得前は「読み込み中...」、
  取得成功後だけ `<object data="blob:...">` を埋め込む(**壊れたsrcを一瞬でも出さない** ―
  公開URLへのフォールバックは行わない設計)。
- `sw.js`: `CACHE_NAME` を `v84`→`v85`、`APP_SHELL` から実在しない
  `Vision.md`/`Daily_Affirmation.md`/`*_vision.pdf` の5エントリを削除。

## [B] 機能追加: 各タブは基本的に今日を表示

### 背景

`state.selectedDate` は全タブ共有 + localStorage永続のため、過去日を見たまま離脱すると次回起動
(PWA再起動含む)も過去日のままだった。

### 実装

- **(a) 起動時**: モジュール末尾の起動処理で `state.selectedDate = todayISO()` を無条件に実行
  (永続化されたselectedDateは初期表示に使わない)。`ensureJournal()` + `persistLocalNoSchedule()`
  で当日ジャーナルの用意と永続値の更新も行う。既存の `runDailyOpen({force:true})` より前に置く。
- **(b) 日をまたいだフォアグラウンド復帰**: 既存の `runDailyOpen()`
  (`state.settings.lastOpenedDate !== todayISO()` で日跨ぎを検知する唯一のポイント。起動時・
  `visibilitychange`復帰時の両方を通る)の `isNewDay` 分岐に、`state.selectedDate = today` と
  `ensureJournal(today)` を追加。visibilitychange復帰時にこの分岐を通るのは実際に日をまたいだ
  ときだけなので、(c)を壊さずに(b)を実現できる。
- **(c) セッション中の意図的な日付移動は尊重**: (a)(b)はどちらも「日付が変わった/起動した」
  タイミングのみで発火し、`setSelectedDate`/`shiftSelectedDate`(date-prev/date-next/日付ピッカー)
  自体には一切手を入れていない。タブ切替(`setView`)もselectedDateに触れない既存仕様のまま。

### 既存テストとの整合(重要)

「reload直後は常にselectedDate=今日になる」という仕様変更により、`tests/v57.test.js` /
`v58.test.js` / `v76.test.js` / `v83.test.js` の一部が、**localStorageにselectedDateを
過去日として仕込んでからreloadし、起動時にその過去日を見ている体で検証する**という手法に
依存していた(reload後に強制的に今日へ戻るため、この手法はもう成立しない)。
これらは「過去日を見ている最中の挙動」を検証する意図だったため、テストを弱めず
**reload後にセッション中の操作(日付ピッカー/date-prev/date-next)で目的の日付へ実際に移動する**
形に書き換えた(UIを介する分、むしろ実際のユーザー操作に忠実になった)。

- `v57.test.js` [1]: 過去日ブラウズ中のfetchノイズ回避(F1)の検証を、reload後に日付ピッカーで
  PASTへ移動する形に変更。移動の副作用として発見した「`setSelectedDate`は日付変更のたびに
  `hydrateStaticMarkdown()`を再実行する」既存フック(app.js 11868行付近の`setSelectedDate`
  ラッパー)を使い、visibilitychangeの追加発火なしで検証できるようにした。
- `v58.test.js` [3]: 土曜/金曜の週次レビュー導線判定を、reload後に日付ピッカーで移動する形に変更。
- `v76.test.js` [1b][2b]: 「selectedDateが2日前でも今日基準の前日フィードバックが読める」検証を、
  reload後に日付ピッカーでPREV2へ移動する形に変更。また起動処理がわずかに重くなった分、
  `seed()`内の待ち時間を700→900msに調整(無関係箇所[4]がタイミングでまれに落ちたための安定化)。
- `v83.test.js` [B8-1]: renderMarkdownキャッシュの検証で、YESTERDAYへの移動をreload後の
  日付ピッカー操作に変更。**注意点**: 起動直後にjournalタブをselectedDate=今日のまま描画すると
  「前日パネル」(=YESTERDAY、テキストB)が先にキャッシュされてしまい後段のキャッシュミス検証が
  偽陰性になるため、日付移動を終えてからjournalタブへ入る順序(home→日付ピッカー→journal nav)
  にした。

## テスト

`tests/v85.test.js`(新規)。実ブラウザ(Playwright/Chromium)でapp.jsを無改変のまま動かし検証:

1. ビジョンタブ→ビジョンボードで、personal-data Contents APIからPDFが取得され、
   `<object>`のsrcがBlob URL化されて表示される(45歳/80歳タブへの切替でも同様)。
2. (否定アサーション)同一オリジン(GitHub Pages相当)への `*_vision.pdf` / `Vision.md` /
   `Daily_Affirmation.md` リクエストが一切発生しない。
3. 過去日を選択したまま永続化された状態でも、reload(再起動相当)後は必ず今日が選択される。
4. セッション中に日付ピッカーで過去日へ移動した場合、タブ切替(再描画)を挟んでも維持される。
5. 日をまたいでの`visibilitychange`復帰(`page.clock`で時刻を翌日へ進めてから発火)では、
   選択中の日付が新しい今日へ自動でリセットされる。

既存スイート(`v57`/`v58`/`v76`/`v83`)は上記の理由で日付操作方式を書き換えた上でALL PASSを維持。
`npm test`(全量35スイート)で **ALL PASS** を確認済み。

## 自信がない箇所・懸念点

- ビジョンボードのPDF(特に80_vision.pdfは約18MB)はGitHub Contents APIの
  「1〜100MBはraw mediaTypeで取得可」という仕様に依拠している。実際のpersonal-dataリポジトリの
  ファイルで動作確認していない(テストはfixtureの小さいダミーPDFバイトで検証)。100MBを超える
  ファイルに差し替わった場合はこの経路が使えなくなる(Git Data API/blobsへの切替が必要)。
- Blob URL(`URL.createObjectURL`)の`URL.revokeObjectURL`による解放は行っていない
  (ビジョンボードはアプリ稼働中に頻繁に開閉するタブではなく、3ファイル分のメモリ保持で
  実害は小さいと判断)。長時間PWAを起動しっぱなしで頻繁にビジョンボードを開閉するようなら、
  タブ離脱時のrevoke対応を検討の余地がある。
- 日をまたいだリセット((b))は`runDailyOpen()`が呼ばれる経路(起動時・visibilitychange復帰・
  `runAutoSyncPull`内の各分岐)でのみ発火する。アプリを起動もフォアグラウンド復帰もせず
  裏で日付だけが変わり続けるケース(通常は起こり得ない)は対象外。
