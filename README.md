# TaskChute Journal PWA

iPad / iPhone / PC のブラウザで使える、タスクシュート + WBS + タイムライン + ジャーナルのWebアプリです。

> 📐 技術構造の詳細は **[`設計書.md`](./設計書.md)** を参照。設計思想は `CONCEPT.md`(リポジトリ外で管理)。

## 方針

- iOSネイティブではなく PWA として実装
- GitHub Pages で公開可能
- iPhone/iPad は Safari から「ホーム画面に追加」で利用
- データ保存はブラウザの `localStorage` を主とし、GitHub 上の `app-state.json` 1ファイルで端末間同期・バックアップ
- 実行時依存はゼロ(Markdown パーサ `marked` のみ同梱、CDN 非依存)

## 起動

依存パッケージはありません。Node.js だけでローカル確認できます。

```bash
npm run dev
```

ブラウザで `http://localhost:4173` を開きます。

## 主なファイル

| ファイル | 役割 |
|---|---|
| `index.html` | アプリの入口(静的な骨格のみ) |
| `app.js` | 本体。状態管理・全画面描画・同期・繰り返し等すべて |
| `styles.css` | レスポンシブUI・テーマ |
| `marked.min.js` | Markdown パーサ(同梱) |
| `manifest.webmanifest` | ホーム画面追加用 manifest |
| `sw.js` | オフラインキャッシュ用 service worker |
| `app-state.json` | GitHub 同期先(token は除去して保存) |
| `設計書.md` | 技術設計書 |

## 現在できること

- ホーム(コックピット): 信条・寿命カウントダウン・スコアボード・4ゾーン
- WBS: Project / Task ツリー、中断、Taskを今日のBlockへ登録
- タスクシュート: Block追加、着手/完了、実績時刻、充電/放電
- タイムライン: 予定/実績の時間軸表示、累積エネルギー
- ルーティン / ポモドーロ(任意・常時)
- ジャーナル: 前日/当日/AIフィードバックの3ペイン、朝の体調
- 0秒思考: 1テーマ1分の書き出し、履歴、日報連携
- やりたいこと / やらないこと リスト
- 日報: Markdown生成・ダウンロード・GitHub push・AIレビュー(Anthropic API 直接呼び出し)
- AI活用: プロジェクトのタスク分解 / 空き時間への下書きスケジュール(タイムラインでD&D調整→確定)/ 週次・12週レビューの壁打ち / 0秒思考のまとめ所感 / 今日のタスク提案(昨日の日報から)/ 朝イチ自動レビュー(opt-in)
- AIプロンプト設定: 共通コンテキスト(私について)・カスタム指示・機能別テンプレを設定画面で編集可能
- ビジョン: Vision / Affirmation / ビジョンボード
- 横断検索: 0秒思考・ジャーナル・問い・AIフィードバック・日報をまたいで検索(日付バーの🔍)
- 世代バックアップ: GitHub保存時に日次スナップショットを `backups/` に自動保存(14日分)・任意時点へ復元
- 設定: プロフィール・GitHub同期・AIレビュー(APIキー/モデル)・マスタ編集・JSON入出力

## GitHub Pages 公開

1. GitHubでリポジトリを作成する。
2. このフォルダの内容をpushする。
3. GitHubの `Settings > Pages` を開く。
4. Source を `Deploy from a branch`、Branch を `main`、Folder を `/root` にする。
5. 表示されたURLをSafariで開き、iPhone/iPadでは「ホーム画面に追加」する。

## ネイティブiOS版の名残

`Sources/`、`Tests/`、`Package.swift` は、最初に作ったSwift版フェーズ0の雛形です。Web/PWA方針ではすぐには使いませんが、データモデル設計の参考として残しています。
