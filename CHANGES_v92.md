# CHANGES v92

## 概要

K指示(2026-07-14)「コンテンツ総括・自己分析(自宅PCのloop側バッチが生成するAIレポート)をアプリ側でも見れるようにして。履歴も選択可能とする」への対応。

**バージョン番号の注意**: これは taskchute-ipad の SW実番号 v92(`sw.js` の `CACHE_NAME`)。
`../taskchute-notes/ROADMAP.md` の**論理番号v92「過集中ブレーカー」**(loop側=自宅PC常駐の
経過時間・次ルーティン割り込み通知)とは別物・別カウンタ。混同注意。

SW `CACHE_NAME` を v91 → v92 に更新。

---

## 実装した機能: AIレポートビューア(その他 > AIレポート)

「その他」グリッドに新タブ「AIレポート」を追加。新しいbottom-navタブは増やしていない
(`mobileNav` は無改変。既存の「その他」→ `renderMore()` の受け皿にそのまま乗る設計)。

### 対象データ(4種類、いずれもGitHub Contents API経由・taskchute/直下)

| タブ | ファイル名prefix | 頻度 |
|---|---|---|
| コンテンツ総括 | `コンテンツ総括_YYYY-MM-DD.md` | 不定期+四半期 |
| 自己分析 | `自己分析_YYYY-MM.md` | 月次 |
| 基盤ヘルス | `基盤ヘルス_YYYY-MM-DD.md` | 日次(loop側) |
| 週次レビュー | `週次レビュー_YYYY-MM-DD.md`(週開始土曜) | 週次 |

指示にあった「基盤ヘルス・週次レビューも実装コストがほぼ同じなら含める」の判断結果:
**4種類とも含めた**。理由 = ディレクトリ一覧を種類ごとにprefixでローカルフィルタするだけの
設計のため、種類を増やす追加コストは `AI_REPORT_TYPES` 配列に1行足すだけで済む
(API呼び出し回数・UIコードの複雑度は増えない)。週次レビューは既存「週次」タブでも
今週分は見られるが、こちらは**過去分の履歴を横断的に選んで読む**用途なので重複ではなく
補完と判断した。

### UI構成

1. レポート種類のセグメントタブ(コンテンツ総括・自己分析・基盤ヘルス・週次レビュー)
2. 日付の履歴セレクタ(`<select style="font-size:16px">`、新しい順)
3. 本文を `renderMarkdown()`(v83キャッシュ経由)で表示
4. ヘッダー右に「🔄 一覧を更新」ボタン(手動更新。自動ポーリングはしない)

### 一覧取得API(新設)

`fetchPersonalDataDirList()`(app.js): GitHub Contents API の**ディレクトリ**指定GET
(`GET /repos/{owner}/{repo}/contents/taskchute?ref={branch}`、ファイルパスではなくディレクトリ
そのものをGETするとエントリ配列が返る仕様を利用)。既存の `fetchGitHubRawResult` と同じ
`personalDataReady` ゲート・認証ヘッダ・401専用バナー(`setPersonalDataAuthError`)の流儀を踏襲。
1回の呼び出しで taskchute/ 直下の全ファイルが拾えるため、4種類のタブ切替では追加のAPI呼び出しが
発生しない(ローカルで `aiReportFilesForType(prefix)` がprefixフィルタ+日付降順ソートするだけ)。

### キャッシュ設計

- `_aiReportDirCache`(一覧、モジュール変数・null=未取得)
- `_aiReportBodyCache`(本文、ファイル名キー・モジュール変数)
- どちらもセッション内で使い回し、「🔄 一覧を更新」ボタンでのみ強制再取得(rate limit配慮)。
  再取得時は一覧キャッシュ全体は捨てるが、本文キャッシュは**現在表示中のファイルの分だけ**
  破棄する(他の種類・日付の本文キャッシュは温存し、無駄なAPI呼び出しを増やさない)。
- タブ・日付の選択状態はUI操作のみで `dataModifiedAt` は汚さない
  (`state.settings.aiReportType` は `persistLocalNoSchedule()` で保存。既存の `visionSection` と
  同じ扱い)。日付選択自体は `_aiReportSelectedDate`(種類ごと・非永続)で保持し、タブ切替・
  再読込では常に「その種類の最新日付」に戻る(履歴を見返す用途なので毎回最新から、という
  既存の週次レビュー・日報タブと同じ挙動)。

### フェイルソフト

- 該当種類のファイルが0件 → 「まだ生成されていません」+ 種類ごとの1行ガイド
  (例: 自己分析は「ジャーナルの「### 依頼」に「自己分析して」と書いてください」)。
- 一覧取得自体が失敗(401/5xx/ネットワーク例外) → 「⚠ 一覧の取得に失敗しました」+ 再試行ボタン。
- 未接続(personal-data未設定) → 設定画面への案内(既存 `renderVisionBoard` 等と同じ文言パターン)。

---

## app.js の変更点

1. `navItems` に `{ id: "ai-reports", label: "AIレポート", mark: "A" }` を追加
   (「日報」の直後。除外リストに入れていないため `renderMore()` の「その他」グリッドへ自動的に出る)。
2. `renderMain()` に `if (view === "ai-reports") main.innerHTML = renderAiReports();` を追加。
3. `normalizeState()` に `value.settings.aiReportType ||= "content";` を追加(新フィールドの
   マイグレーション、既存端末でも起動時に安全な既定値が入る)。
4. モジュール冒頭のキャッシュ変数群に `_aiReportDirCache` / `_aiReportDirError` /
   `_aiReportDirLoadInFlight` / `_aiReportBodyCache` / `_aiReportBodyLoadInFlight` /
   `_aiReportSelectedDate` を追加。
5. `AI_REPORT_TYPES` 定数・`aiReportFilesForType()` / `triggerAiReportDirLoad()` /
   `triggerAiReportBodyLoad()` / `refreshAiReports()` / `renderAiReports()` /
   `renderAiReportBody()` を新設(`renderVision()` の直前)。
6. `fetchPersonalDataDirList()` を新設(`fetchGitHubRawBlob()` の直後、既存fetch関数群と同じ場所)。
7. クリックハンドラに `ai-report-type`(タブ切替) / `ai-report-refresh`(手動更新)を追加。
   changeハンドラに `[data-ai-report-date]`(履歴セレクタ)を追加。
8. `setAiReportType()` を新設(`setVisionBoardIndex()` の直後、同じ `persistLocalNoSchedule` 流儀)。

**アプリ内Claude API呼び出しは増やしていない**(v60の方針を維持。あくまで
「バッチ生成ファイル→GitHub→fetch」を読むだけのビューア)。

---

## テスト: `tests/v92.test.js`(新設)

① 一覧取得(Contents APIのディレクトリ一覧モック)→ タブ切替でセレクタに履歴日付が新しい順に並ぶ
② セレクタで日付を選択 → 該当ファイルがGETされ本文が切り替わる(タブ切替での本文切替も確認)
③ 該当種類が0件(基盤ヘルス) → フェイルソフト(1行ガイド)を表示し、履歴セレクタは出さない
④ 公開オリジン(同一オリジン)へレポートファイル名のfetchが一切飛ばない(否定アサーション。
  api.github.com経由以外のフォールバック経路を作っていないことの回帰ガード)

`node tests/run-all.js v92` で個別実行、その後 `npm test` で全量実行(結果は完了報告本文を参照)。

---

## 検証結果

- `node --check app.js` / `node --check sw.js` / `node --check tests/v92.test.js`: OK
- `npm test`(全量): 実行・結果は完了報告本文を参照

---

## 未対応・懸念点

- 週次レビューの履歴セレクタの日付は「週開始(土曜)」のISO日付をそのまま表示している
  (既存の週次タブと同じ形式。土曜始まりである旨のラベルは付けていない)。
- 実機(iPad Safari)での実地確認はこのセッションでは行っていない
  (taskchute-ipad本体はcommit/push禁止のため、Kの承認後の反映時に確認を推奨)。
- 一覧取得のContents APIレスポンスは taskchute/ 直下1階層のみを見る設計(サブディレクトリ
  `content/` `reading/` `backups/` 配下は対象外)。今回の4種類のレポートはいずれも直下に
  生成される前提のため問題ないが、将来サブディレクトリに生成する運用に変える場合は
  `fetchPersonalDataDirList()` の再帰化が別途必要。
