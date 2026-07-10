# CHANGES v74

## 概要

`reading-compound/SPEC.md`(読書複利化。当初は単独アプリ案として設計)のMVPを、新規アプリと
してではなく **taskchute-ipad 本体の機能として統合実装**した。既存49冊分のKindleハイライト
(個人データリポジトリ `taskchute/reading/highlights.json`)を毎日1件だけホームに提示し、
「自分の言葉で1行言語化する」入力を蓄積する。新しいタブは追加していない(ホームカード1枚+
週次レビュータブの折りたたみ表示で完結)。

---

## 1. SPECからの読み替え(監督者確定・本タスクで反映)

### 1.1 「単独アプリ・vaultへ直接保存」→ 個人データリポジトリ経由に統合

SPECは保存先を「Obsidian vault配下」、実行環境を「File System Access APIかローカルスクリプト」
としているが、taskchute-ipad は v72 で個人データ全般(日報・AIフィードバック・週次レビュー等)
を GitHub Contents API 経由の private リポジトリ(`kojit1229/personal-data`)へ一本化済みである。
本統合でも同じ経路(`fetchGitHubRawText` / 新設 `pushGitHubPath`)にそのまま乗せ、Kindleハイライト
自体は前提どおり「読み取り専用」として一切書き込まない。バッチ側(`loop/scripts/reading-monthly-
extract.py`)が `taskchute/reading/reflections.json` を読む契約と整合させている。

### 1.2 reflections.json のスキーマ確定

バッチ側(`reading-monthly-extract.py`)のコメントにある「仮契約」(トップレベル `{"entries":
[...]}` 、各エントリは `date` キー必須、それ以外は自由記述として転記)をそのまま正式スキーマとして
確定した:

```json
{
  "entries": [
    {
      "date": "YYYY-MM-DD",
      "bookId": "highlights.json内のid",
      "bookTitle": "書籍タイトル",
      "author": "著者",
      "highlightRef": "ref-XXXXX",
      "highlightText": "提示したハイライト本文",
      "reflection": "1行言語化の本文",
      "savedAt": "YYYY-MM-DDTHH:mm:ss"
    }
  ]
}
```

1日1件(同じ `date` のエントリは上書き。複数冊・複数ハイライトの言語化を1日に重ねる設計には
していない — 「今日の1冊」提示という一次UIの単純さを優先した)。

### 1.3 「日にちmod冊数」の選定ロジックは使わず、日付文字列全体のハッシュに変更

`coach-daily.sh` の参考実装は「`date +%-d` mod ファイル数」で書籍を選ぶが、この方式は月をまたぐと
同じ日にち(例: 毎月10日)で同じ書籍に偏る。アプリ側は日付文字列(`YYYY-MM-DD`)全体を
`dateHashSeed()` でハッシュ化し、`ハッシュ mod 冊数`で書籍を、`ハッシュ("日付|bookId") mod
ハイライト数`でハイライトを決定論的に選ぶ(`todaysReadingPick()`、app.js)。iOS Safari の
日時パース規約(`new Date(文字列)` 禁止)には抵触しない(`todayISO()` が返す文字列をそのまま
文字コード演算するだけで、Dateオブジェクトの文字列解釈を経由しない)。

### 1.4 月次AI要約は表示のみ(生成トリガーは実装対象外)

SPECの「月次AI要約(手動トリガーでよい)」は、本ワークスペースでは既存のバッチ→ファイル→fetch
の型(`ai-linked-app-dev` Skill)に従い、要約生成自体は自宅PC側バッチの領分とし、アプリ側は
`taskchute/reading/summary_YYYY-MM.md` の**表示のみ**を実装した(現状バッチ未実装のためファイル
自体が存在せず、404フェイルソフトで非表示のまま — 指示どおり)。

---

## 2. データモデル

読書複利化機能は **`state` に新しい永続フィールドを追加していない**(`normalizeState` の変更
なし)。ハイライト・言語化・月次要約はいずれも個人データリポジトリ側が正であり、アプリ側は
既存の `cachedVisionMd` 等と同じ「モジュールレベル変数のメモリキャッシュ(非永続)」として保持
する:

- `cachedReadingHighlights`(null=未取得 / `highlights.json` の `books` 配列)
- `cachedReadingReflections`(`{ 'YYYY-MM-DD': '保存済み言語化文字列' }`。自分が保存した当日分の
  エコー表示専用)
- `cachedReadingSummaryMd`(`{ 'YYYY-MM': '...md text...' }`)

これらはリロードのたび `hydrateReadingData()`(`hydrateStaticMarkdown()` から呼ばれる)が
個人データリポジトリから再取得するため、永続フィールドが無くても「保存後リロードしても言語化が
失われない」という受け入れ基準を満たす(真実の保存先は `reflections.json` そのもの)。

新規state項目が無いため、**旧stateとの後方互換は自動的に確保される**(`tests/v74.test.js` [8]
で、読書関連キーが一切無いレガシーstateでもクラッシュしないことを回帰テスト化した)。

---

## 3. UI実装

### 3.1 ホームカード「今日の1冊から」(`homeReadingCard`)

`renderHome()` に1枚追加(`homeIdeal` の直下、縮退モード時は非表示 — コンディションOSの
「今日は最低限だけ」方針を踏襲)。書籍タイトル・著者・ハイライト本文を表示し、その下に
テキスト欄(`.home-reading-input`、`font-size:16px` 明示、iOS Safariのズーム防止規約準拠)+
「保存」ボタン。ハイライトが1件も引けない場合(`highlights.json` 未取得・404・0冊)はカード
自体を出さない(`todaysReadingPick()` が null を返す)。

### 3.2 1行言語化の保存(`saveReadingReflection`)

保存ボタン押下で `data-action="reading-save"` → `saveReadingReflection()`。
`fetchGitHubRawResult("reading/reflections.json")` で既存分を読み → 今日の日付のエントリだけを
差し替え(読み-マージ-書き、楽観排他なし) → `pushGitHubPath("reading/reflections.json", ...)`
で書き戻す。他日のエントリは一切変更しない(`tests/v74.test.js` [2][3] で、既存の別日エントリが
保持されたまま今日の分だけが1件に保たれる(重複しない)ことを確認済み)。

**独立レビュー(should-fix)対応**: 当初は既存の `fetchGitHubRawText` をそのまま使っており、
404(本当に無い)と401/5xx/ネットワーク例外(読めたかどうか分からない)を区別できなかった。
これだと一過性の読み失敗直後に書き込みが成功すると、`reflections.json` が「今日の1件だけ」に
上書きされ、過去の全言語化が消失しうる。対応として:

- `fetchGitHubRawText` の内部実装を `fetchGitHubRawResult(name)`(`{ ok, status, text }` を返す)
  に切り出した。既存の `fetchGitHubRawText` は `result.ok ? result.text : ""` を返すだけの
  薄いラッパーにし、**既存の全呼び出し元(Vision/AIフィードバック/週次レビュー等)の挙動は
  一切変えていない**(401時のバナー表示・404での静かな無視を含め同一)。
- `saveReadingReflection` は `fetchGitHubRawResult` を使い、`status === 404` のときだけ
  `entries = []` から始める。401/5xx/ネットワーク例外(`result.ok === false && status !== 404`)
  のときは `throw` して保存自体を中断する(catchでtoast表示、`pushGitHubPath` は呼ばれない)。
- `tests/v74.test.js` [3b] に、読み込みが500で失敗するケースの回帰テストを追加(PUTが送信
  されないこと、既存の2エントリが消失していないことを直接fetchで検証)。

### 3.3 月次要約の折りたたみ表示(`readingMonthlySummarySectionHTML`)

週次レビュータブの既存「AI週次レビュー」セクション直下に追加。`homeFoldSection` を再利用した
既定closedの `<details>`。今月分の `summary_YYYY-MM.md` が無ければ(404)何も出さない。

### 3.4 新設の書き込みヘルパー `pushGitHubPath`(サブディレクトリpath対応)

既存 `pushFileToGitHub` は `personalDataPath(encodeURIComponent(filename))` という組み立てのため、
`filename` に `/` を含めると丸ごと `%2F` にエンコードされてしまい `taskchute/reading/
reflections.json` のようなサブディレクトリを正しく指せない(既存呼び出し元は全てフラットな
ファイル名だったため、このバグは顕在化していなかった)。`fetchGitHubRawText` / `gitHubContentsURL`
と同じ「パスセグメントごとにencodeして`/`で結合」方式の `pushGitHubPath(relPath, content, label)`
を新設し、読書関連の書き込みはこちらを使う(既存 `pushFileToGitHub` 自体は無変更・他機能への
影響なし)。

---

## 4. Service Worker / その他

- `sw.js`: `CACHE_NAME` を `taskchute-journal-pwa-v73` → `taskchute-journal-pwa-v74` に更新。
  ロジック変更なし。
- `styles.css`: `.home-reading-book` / `.home-reading-highlight` / `.home-reading-input` を追加。
  既存クラスの変更は無い。

---

## 5. テスト

`tests/v74.test.js`(新規、22番目のスイート)。Clock APIで時刻固定、`blockGithubApiByDefault`+
`passGithubGate`(v72確立のトークンゲートバイパス)を使用。`highlights.json` は単一書籍・単一
ハイライトのフィクスチャにして、日付ハッシュの実装詳細に依存せず「必ずこれが選ばれる」ことを
保証している。検証内容:

1. ホームに「今日の1冊から」カードが表示され、書籍タイトル・著者・ハイライト本文が出る。
   言語化欄は保存前は空
2. 既存の他日エントリがある状態で言語化を保存 → `reflections.json` へのPUTペイロード(base64
   デコード)を検証し、他日のエントリが保持されたまま今日の分だけが1件追加されることを確認
3. 同日に再保存すると新規追加ではなく上書きされる(重複しない)
4. リロード後、保存済みの言語化がテキスト欄にプリフィルされる(永続性)
5. `summary_YYYY-MM.md` が404の間は週次レビューに要約セクションが出ない
6. `summary_YYYY-MM.md` がある場合、折りたたみセクションとして中身(見出し+本文)が出る
7. `highlights.json` が404の間はホームに読書カードが出ない(クラッシュしない、他のホーム要素は
   通常どおり表示される)
8. `normalizeState` 後方互換: 読書関連キーが一切無いレガシーstateでもクラッシュせず起動できる

- `node --check app.js` / `node --check sw.js` / `node --check tests/v74.test.js`: いずれもOK
- `node tests/v74.test.js` 単体: ALL PASS
- 全量 `npm test`(22スイート、v74含む)フォアグラウンド実行で **ALL PASS**(exit code 0)を
  2回確認済み(既存21スイートに影響なし)

---

## 変更ファイル

- `app.js`(`cachedReadingHighlights`/`cachedReadingReflections`/`cachedReadingSummaryMd` の
  モジュール変数追加、`dateHashSeed`/`todaysReadingPick`/`homeReadingCard`/`pushGitHubPath`/
  `parseReadingReflections`/`saveReadingReflection`/`hydrateReadingData`/
  `readingMonthlySummarySectionHTML` の新設、`renderHome`・`renderWeekly`・
  `hydrateStaticMarkdown`・クリックイベント委譲への組み込み)
- `styles.css`(`.home-reading-*` 系クラス追加。既存クラスは無変更)
- `sw.js`(`CACHE_NAME`を`v73`→`v74`)
- `tests/v74.test.js`(新規)
- `CHANGES_v74.md`(本ファイル)
- `../taskchute-notes/handoff.md`(notes リポジトリ側、本エントリ追記)

---

## 実機テスト手順

1. `sw.js?nocache=YYYYMMDD` を開き、1行目が `taskchute-journal-pwa-v74` になっていることを
   確認する。
2. ホームタブを開き、「今日の1冊から」カードに書籍タイトル・ハイライト本文が表示されることを
   確認する(個人データリポジトリの `taskchute/reading/highlights.json` にトークンでアクセス
   できる前提)。
3. カード下部のテキスト欄に一言書いて「保存」を押し、トーストで保存完了が示されることを確認
   する。GitHub上で `taskchute/reading/reflections.json` に今日のエントリが追加されていることを
   確認する。
4. アプリを再読み込みし、同じテキストがテキスト欄に残っていることを確認する。
5. 週次レビュータブを開き、`taskchute/reading/summary_YYYY-MM.md` が存在する月であれば
   「📖 今月の読書ふりかえり」の折りたたみが出ることを確認する(バッチ未生成の間は出なくてよい)。

## 確認サイン

- [ ] 実機(iPad/iPhone)で上記手順を確認
- [ ] 確認者:
- [ ] 確認日:
