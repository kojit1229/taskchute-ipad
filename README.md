# TaskChute Journal PWA

iPad / iPhone / PC のブラウザで使える、タスクシュート + WBS + タイムライン + ジャーナルのWebアプリです。

## 方針

- iOSネイティブではなく PWA として実装
- GitHub Pages で公開可能
- iPhone/iPad は Safari から「ホーム画面に追加」で利用
- 初期データ保存はブラウザの `localStorage`
- 端末間同期は後フェーズで Supabase / Firebase / Cloudflare などを検討

## 起動

依存パッケージはありません。Node.js だけでローカル確認できます。

```bash
npm run dev
```

ブラウザで `http://localhost:4173` を開きます。

## 主なファイル

| ファイル | 役割 |
|---|---|
| `index.html` | アプリの入口 |
| `styles.css` | レスポンシブUI |
| `app.js` | PWA版MVPの画面・状態管理 |
| `manifest.webmanifest` | ホーム画面追加用 manifest |
| `sw.js` | オフラインキャッシュ用 service worker |
| `Docs/WebAppPivot.md` | iOSネイティブ版からWeb/PWA版への方針転換メモ |

## 現在できること

- ホーム: 朝の体調、12WY/今年のアンドン、今日のBlock表示
- WBS: Project / Task 追加、Taskを今日のBlockへ登録
- タスクシュート: Block追加、完了、開始/終了時刻、充電/放電
- タイムライン: 予定Blockの時間軸表示、累積エネルギーポイント
- ポモドーロ: Blockに紐づく25分タイマー
- ジャーナル: 前日/当日/AIフィードバックの3ペイン
- 日報: Markdown生成、ダウンロード
- ビジョン: Vision / Affirmation の編集
- 設定: プロフィール、JSONエクスポート/インポート

## GitHub Pages 公開

1. GitHubでリポジトリを作成する。
2. このフォルダの内容をpushする。
3. GitHubの `Settings > Pages` を開く。
4. Source を `Deploy from a branch`、Branch を `main`、Folder を `/root` にする。
5. 表示されたURLをSafariで開き、iPhone/iPadでは「ホーム画面に追加」する。

## ネイティブiOS版の名残

`Sources/`、`Tests/`、`Package.swift` は、最初に作ったSwift版フェーズ0の雛形です。Web/PWA方針ではすぐには使いませんが、データモデル設計の参考として残しています。
