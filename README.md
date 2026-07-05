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
- 日報: Markdown生成・ダウンロード・GitHub push
- ビジョン: Vision / Affirmation / ビジョンボード
- 設定: プロフィール・GitHub同期・マスタ編集・JSON入出力

## GitHub Pages 公開

1. GitHubでリポジトリを作成する。
2. このフォルダの内容をpushする。
3. GitHubの `Settings > Pages` を開く。
4. Source を `Deploy from a branch`、Branch を `main`、Folder を `/root` にする。
5. 表示されたURLをSafariで開き、iPhone/iPadでは「ホーム画面に追加」する。

## ネイティブiOS版の名残

`Sources/`、`Tests/`、`Package.swift` は、最初に作ったSwift版フェーズ0の雛形です。Web/PWA方針ではすぐには使いませんが、データモデル設計の参考として残しています。
