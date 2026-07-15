# CHANGES v105

## 概要

K指示(2026-07-15)「前日の睡眠ログCSV(AutoSleep書き出し)をジャーナルタブからアップロード
できるようにする。未アップロードなら赤くして目立たせる。ジャーナルのテンプレートから
睡眠時間の記述は外す」への対応。

背景: 日報の睡眠自己申告(就寝23:00/起床6:30、質★3)がAutoSleep実測と乖離しており
計測器として機能していない(2026-07-15の4年分析で確認)。実測CSVの取込に一本化する。

SW `CACHE_NAME` を v104 → v105 に更新。

## 変更内容(app.js)

- **`state.sleep.logs` を新設**(起床日 `YYYY-MM-DD` キー)。`normalizeState()` で
  `{ logs: {} }` を補完。1日分 = `{ bed, wake, sleepH, inBedH, deepH, qualityH, eff,
  hrSleep, hrvSleep, spo2Avg, importedAt }`。既存のコンディションOS
  (`condition.logs[].sleepHours`、5〜9hプリセットの主観値)とは別物として共存させ、
  二重管理を避けるため相互書き込みはしない。
- **CSV取込 `importSleepCsv(file)`**: ジャーナルタブ「📤 睡眠CSV」ラベル
  (`input[type=file][data-sleep-csv-upload]`、AIフィードバックの.mdアップロードと同じ
  デリゲーションパターン)。パーサはAutoSleepの日本語ヘッダー前提の最小実装
  (引用符・`""`エスケープ対応、BOM除去)。日時は iOS Safari ルールに従い
  `new Date("文字列")` を使わず正規表現の文字列抽出のみ。複数日を一括upsertし、
  同一起床日に複数行(昼寝セッション)がある場合は睡眠時間が長い行を採用する。
  読み取り0件なら state に触れずトーストで通知。
- **ジャーナルタブ当日編集パネル最上部に睡眠カード `renderSleepCard(date)`**:
  - 未取込 + 今日を表示中 → 赤帯警告(`--red-soft` 背景 + `--red` 枠)+ dangerボタン
    (毎朝アップする運用のリマインダー)
  - 未取込 + 過去日 → 控えめなグレー表示(過去分の未取込を責めない)
  - 取込済み → 就寝→起床 / 睡眠 / 効率 / 深さ / HR / HRV のチップ表示 + ghostボタン
- **ジャーナルテンプレートから「## 🛏 睡眠」セクションを廃止**: `defaultJournal()` から
  削除、`JOURNAL_PROMPTS` の同項目も削除。既存端末の `settings.journalTemplate` は
  `normalizeState()` で「未記入のデフォルト形(`就寝: __:__ / 起床: __:__` +
  `質: ★…`)」に一致する場合のみ除去し、ユーザーが値や文言を書き換えたテンプレは
  触らない(v91の依頼セクション追記と同じ後方互換方針)。過去のジャーナル本文は
  書き換えない。`upsertMorningLine()` の旧テンプレ判定分岐は互換のため残置。

## テスト

- `tests/v105.test.js` を追加(初のファイルアップロードE2E。`setInputFiles` にバッファで
  実ヘッダーのフィクスチャCSVを渡す)。検証: normalizeState補完とテンプレ移行 /
  今日未取込の赤帯 + dangerボタン / CSV取込で複数日保存・就寝起床抽出・時間換算・
  昼寝より夜間セッション優先・赤帯消滅・サマリ表示 / 過去日は控えめ表示。
  ※ 起動時に `selectedDate` が必ず今日へ戻るため、過去日の検証は日付バー「前日」で遷移。
- `node --check app.js` / `node tests/v105.test.js`(全通過)/ `npm run test:core`
  (10スイート全通過、180s)。

## 運用メモ

- 取込データは app-state.json として personal-data へ既存の自動同期で載るため、
  loop側バッチ(coach-daily等)が実測睡眠を参照する拡張は別件(K承認待ちのqueue案件)。
- Appleヘルスケアの「書き出したデータ.zip」(export.xml 1.5GB)は日次運用には不向き。
  取込はAutoSleepアプリの書き出しCSVを正とする。
