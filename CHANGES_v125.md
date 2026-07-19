# CHANGES v125

## 概要

K要望「ビジョンタブの『ビジョンボード』PDFを、別タブに飛ばさず同一画面内で表示したい」への対応。

SW `CACHE_NAME` を v124 → v125 に更新。

## 背景(不可侵の教訓)

- v85: PDFを`<object>`でインライン埋め込み → v101「K報告: PCブラウザでビジョンタブを開くと
  毎回固まる」。原因は`<object>`が起動するブラウザ内蔵PDFビューア(別プロセス)の大容量ページ
  描画がSPA本体のタブの描画・入力キューと競合すること(CHANGES_v101.md参照)。
- v101: 自動fetch・インライン埋め込みを撤去し、「読み込む」明示クリック→取得後は実アンカー
  `<a target="_blank">`で別タブに開かせる方式へ退避した。
- iOS Safariは元々PDFのインライン表示が実質1ページ目のみという制約もある。

このため、**PDFそのものの`<object>`/`<iframe>`インライン埋め込みには今回も戻していない。**

## 修正内容

事前にPDFをページ画像(JPEG)へ変換したものをpersonal-dataリポジトリ
`taskchute/content/vision-pages/`(`now_vision-p01.jpg` / `45_vision-p01.jpg` /
`80_vision-p01.jpg`〜`80_vision-p05.jpg` + `manifest.json`)に配置済みという前提のもと、
アプリ側は画像を`<img>`として同一画面に並べる方式にした。画像はブラウザの通常の画像デコード/
描画パイプラインで表示できるため、`<object>`の専用ビューアプロセスを起動せずに済み、v101が
回避した「固まる」問題を再発させずに同一画面内表示を実現できる。

### 1. manifest.jsonの軽量fetch(app.js `loadVisionManifest()`)

ビジョンボードタブを開くと、まず `content/vision-pages/manifest.json`
(`{ "now_vision.pdf": {"pages":1,"files":[...],"w":1400,"h":...}, ... }`)を
`fetchGitHubRawText` 経由で軽量fetchする(PDF本体やページ画像本体は取りに行かない)。
取得・パースに失敗した場合(404、ネットワーク例外、JSON異常)は `_visionManifestFailed = true`
とし、以降そのセッションでは従来のv101方式(PDF Blob化→別タブで開く、
`renderVisionBoardPdfFallback()`)へ恒久的にフォールバックする。

### 2. ページ画像の明示取得(app.js `loadVisionBoardImages()`)

manifest.jsonの取得に成功した場合、選択中ボードの画像は「📥 読み込む」ボタンの明示クリック
(`data-action="vision-board-load-images"`)でのみfetchする(v101の「タブを開いただけでは
自動fetchしない」方針を踏襲)。取得は`fetchGitHubRawBlob(content/vision-pages/<file>)`で
ページファイルを1枚ずつ`await`しながら順に取得し、**1枚取得できるたびに`render()`を呼んで
差し込み表示する**(`Promise.all`による一斉取得はしない)。これにより80歳版(5ページ)は
1ページ目から順に表示が始まり、全ページの取得完了を待たせない。取得済みのページ画像は
`cachedVisionPageUrls`(ページファイル名→Blob URL)にキャッシュし、ボードタブを行き来しても
再fetchしない(1ファイル1回)。ボード単位の多重fetch防止は`_visionPageLoadInFlight`で行う
(v101の`_visionPdfLoadInFlight`と同じ設計)。

### 3. 表示(app.js `renderVisionBoardImages()`)

取得済みのページは`<div class="vision-pages">`配下に`<img>`(`max-width:100%`、複数ページは
縦に連続)で並べ、複数ページのボードには右下に小さなページ番号ラベル(`1 / 5`等)を付ける。
未取得のページは同じ枠のプレースホルダ(`.vision-page-placeholder`、「読み込み中...」)を表示する。

### 4. 原本PDFの「別タブで開く」導線は補助として維持

v101方式の`loadVisionBoardPdf()`/`cachedVisionPdfUrls`はそのまま残し、画像版UIの下に
「📂 原本PDFを別タブで開く」という控えめなテキストリンク(`.vision-pdf-fallback-link`、
下線付きの小さなテキストで`.btn`系のプライマリボタンとは視覚的に区別)として設置した。
manifest.json自体が取得できない/該当ボードのエントリが無い場合は、この補助導線がそのまま
主導線(v101方式のフルUI、`renderVisionBoardPdfFallback()`)として使われる。

### 5. Service Worker

`CACHE_NAME` を `v125` に更新。

## 変更ファイル

- `app.js`
  - モジュール変数: `_visionManifest` / `_visionManifestFailed` / `_visionManifestLoadInFlight` /
    `cachedVisionPageUrls` / `_visionPageLoadInFlight` を追加
  - `renderVisionBoard()`: manifest.json取得状態に応じて分岐する形に刷新
  - `renderVisionBoardImages()` / `renderVisionBoardPdfFallback()`: 新規(後者は旧
    `renderVisionBoard()`本体をそのまま切り出したもの、内容は無変更)
  - `loadVisionManifest()` / `loadVisionBoardImages()`: 新規
  - `loadVisionBoardPdf()`: 無変更(補助導線から引き続き使用)
  - クリックデリゲーション: `data-action="vision-board-load-images"` を追加
    (既存の`vision-board-load`は無変更)
- `styles.css`: `.vision-pages` / `.vision-page` / `.vision-page-placeholder` /
  `.vision-page-label` / `.vision-pdf-fallback-link` を追加(既存の`.vision-*`ルールは無変更)
- `sw.js`: `CACHE_NAME` を `v125` に更新
- `tests/v125.test.js`: 新規

## 不可侵の制約の遵守確認

- PDFの`<object>`/`<iframe>`インライン埋め込みは一切追加していない(新規テストで
  `object, iframe` の要素数が0であることを画像版・フォールバック版の両方で確認)。
- Vision.md/Daily_Affirmation.mdの表示(`renderVisionMd`)、PDF原本の取得経路
  (`fetchGitHubRawBlob`/`loadVisionBoardPdf`)は無変更。
- 既存テスト(`v85.test.js` [A1][A2] / `v101.test.js` / `github-vision-pdf-fallback.test.js`)は
  無改変のまま全てPASSすることを確認済み(manifest.jsonへのfetchは既存のモック上404で処理され、
  結果として従来のv101方式フォールバックが表示されるため、既存の検証内容と整合する)。
- `type="text"`化やDateパースには触れていない。iOS 16pxルール対象(input/select/textarea)の
  新規追加なし。`data-action`デリゲーション一本の既存方針を踏襲。

## テスト

`tests/v125.test.js`(新規、[A]/[C]/[B]の3ブロック):

- [A] manifest.json取得(1回だけ)→「読み込む」クリック→今(33歳)ボードの1枚が`<img>`表示される。
  クリックまでページ画像はfetchされない。`<object>`/`<iframe>`は使われない。
- [C] 80歳タブへ切替(今ボードのキャッシュを引き継がず未読み込み状態に戻る)→「読み込む」で
  5枚が1ページ目から順に差し込まれる(全5枚揃う前に一部だけ表示されるタイミングを直接確認)→
  最終的に5枚すべて表示・fetch済み。今ボードへ戻ると再fetchせずキャッシュ済みの1枚がそのまま
  表示される。補助導線「原本PDFを別タブで開く」が画像版UI内に存在する。
- [B] manifest.json取得失敗(404)時、画像版ボタンではなく旧PDF方式の「このPDFを読み込む」
  ボタンが出て、クリックすると従来どおりBlob URLの「別タブで開く」リンクに切り替わる
  (`.vision-pages`は描画されない、`<object>`/`<iframe>`も使われない)。

## 検証結果

- `node --check app.js` / `node --check sw.js` / `node --check tests/v125.test.js`: すべて exit 0
- `node tests/run-all.js v124 v125`: **ALL PASS**
- 既存回帰確認: `node tests/v85.test.js` / `node tests/v101.test.js` /
  `node tests/github-vision-pdf-fallback.test.js`: いずれも無改変のまま **ALL PASS**
- `npm run test:core`(コアセット、直近5バージョン+固定コア5本、v72のVision.md API取得検証含む):
  **ALL PASS**(所要時間 132.0s)

## 未対応・懸念点

- manifest.json自体の取得失敗はセッション中「恒久的」にフォールバックへ倒す設計(再訪問での
  自動リトライはしない)。personalDataReadyな限りmanifest.jsonは配置済み前提のファイルであり、
  失敗は「今回だけ読めなかった」ではなく「画像化されていない/経路が壊れている」と見なす判断
  だが、一時的なネットワーク不調でmanifest取得だけ失敗した場合もそのセッション中はPDF方式に
  固定される(タブ再訪では復帰しない)。再訪(タブ切替)で再試行してよいか等はK判断が必要なら
  別途相談。
- ページ画像のBlob URLはセッション(ページロード)ごとにリセットされる(v101の`cachedVisionPdfUrls`
  と同じ設計方針を踏襲)。

## 追補: Codex P2指摘対応(HEAD dcc0569以降の作業ツリー差分。SW `CACHE_NAME` はv127のまま無変更)

Codexレビュー指摘: 「ビジョンページ画像の取得が一部失敗した場合、失敗ページは『読み込み中...』
表示のまま再試行手段がない(`anyCached`により『読み込む』ボタンも戻らない)。全ページ失敗時は
最終renderがin-flightフラグのクリア前に走り、ビュー全体が固まった表示のままになる」への対応。

### 原因

`loadVisionBoardImages()`の取得ループは、各ページのfetch完了ごとに`render()`していたが、
ループを抜けた**後**に初めて`_visionPageLoadInFlight[file] = false`をセットしており、
ループ最後の(=最後のページの)`render()`は常に`loading=true`のまま描画されていた。全ページの
最後の1枚が失敗で終わった場合、その後`_visionPageLoadInFlight`をfalseにしてもrenderを
呼び直していなかったため、画面は「読み込み中...」のまま更新されず固まって見えていた。
加えて、失敗ページ自体に取得失敗を示す状態が無く(成功キャッシュ`cachedVisionPageUrls`にしか
状態を持っていなかった)、失敗後にユーザーが取れる手段が無かった。

### 修正内容(app.js)

1. **失敗追跡の追加**: 新しいモジュール変数 `_visionPageFailed`(`{ 'now_vision-p01.jpg': true }`
   形式)を追加。`loadVisionBoardImages()`は各ページの再挑戦直前に該当キーを`delete`してから
   fetchし、失敗した場合(`blob`が`null`、または例外)は`_visionPageFailed[pageFile] = true`を
   立てる。成功時は(事前delete済みのため)自然にキーが残らない。
2. **表示の分岐**: `renderVisionBoardImages()`のページ描画で、`cachedVisionPageUrls[f]`が無く
   `_visionPageFailed[f]`が立っているページは「読み込み中...」ではなく「🔄 再読み込み」ボタン
   (`data-action="vision-board-retry-images"`、`.vision-page-failed`クラスでスタイルも区別
   — styles.cssに実線+警告色の枠を追加)を表示する。未着手(失敗も成功もまだ)のページのみ
   引き続き「読み込み中...」を表示する。
3. **再試行の実装**: `vision-board-retry-images`アクションは`loadVisionBoardImages(file)`を
   そのまま呼ぶだけでよい設計にした。ループは`cachedVisionPageUrls`に無いページ(未着手 or
   前回失敗)だけを対象にするため、成功済みページは再fetchされず、失敗したページ(または
   ボード内の残り全ページ)だけが再試行される。新しいfetch関数は追加していない。
4. **render順序のバグ修正(本丸)**: ループの外、`_visionPageLoadInFlight[file] = false`の
   **後**に無条件の最終`render()`を追加した。これにより、全ページ失敗で終わった場合も
   `loading=false`の状態で必ず1回再描画され、「読み込み中...」に固定されたまま止まることが
   無くなる。
5. **表示ゲートの修正(付随バグ)**: 上記4.の修正で「全滅時もloading=falseへ戻る」ようになった
   結果、`renderVisionBoardImages()`冒頭の「まだ何も試していないか」の判定を旧来の`anyCached`
   (成功キャッシュの有無)のままにしていると、全ページ失敗直後に`anyCached=false`かつ
   `loading=false`となり「📥 読み込む」の初期画面に逆戻りしてしまい、再読み込みボタンへ
   一生辿り着けない新しいバグを生むことが実装中の自己レビューで判明した。`anyCached`を
   `anyAttempted`(`cachedVisionPageUrls[f] || _visionPageFailed[f]`のいずれかを満たすページが
   1枚でもあるか)に置き換えて解消した。

### 変更ファイル(このコミット時点、コミット未実施)

- `app.js`: `_visionPageFailed`追加、`renderVisionBoardImages()`のゲート判定・失敗ページ表示、
  `loadVisionBoardImages()`の失敗追跡・final render順序修正、クリックデリゲーションに
  `vision-board-retry-images`を追加
- `styles.css`: `.vision-page-placeholder.vision-page-failed`(枠線の視覚区別)を追加
- `tests/v125.test.js`: 新規 `[D]` ブロックを追加(既存 `[A]`/`[B]`/`[C]` のチェックは無改変)。
  1ページ構成の今(33歳)ボードで1回目のfetchを500失敗させ、再読み込みボタンの出現・
  「読み込み中...」に固定されないこと・再試行(モックを成功に切替)後に`<img>`が表示され
  再読み込みボタンが消えることを確認する
- `sw.js`: 変更していない(現HEAD時点で既に`v127`。指示どおりバージョン更新なし)

### 検証(追補分)

- `node --check app.js`: exit 0
- `node tests/run-all.js v125`: **ALL PASS**(新規`[D]`7件含む全27件の静的/動作検証。
  既存`[A]`/`[B]`/`[C]`ブロックは無改変のままPASS)
- 回帰確認: `node tests/v85.test.js` / `node tests/v101.test.js` /
  `node tests/github-vision-pdf-fallback.test.js`: いずれも無改変のまま **ALL PASS**
- `git diff --stat sw.js AGENTS.md`: 出力なし(両ファイルとも無変更を確認)
