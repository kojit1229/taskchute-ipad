# TaskChute Journal PWA

iPad / iPhone / PC のブラウザで使える、タスクシュート + WBS + タイムライン + ジャーナルのWebアプリです。

> 📐 技術構造の詳細は **[`設計書.md`](./設計書.md)** を参照。設計思想は `CONCEPT.md`(リポジトリ外で管理)。
> 🤝 Claude Code × Codex × Obsidian の協働レビュー環境を他アプリでも作る手順は **[`docs/collaboration-setup.md`](./docs/collaboration-setup.md)**。

## 正典ポインタ

- **現行バージョン**: `sw.js` 1行目の `CACHE_NAME`(例: `taskchute-journal-pwa-v138`)。配布中の
  実体はこの番号が真実。
- **変更履歴**: リポジトリ直下の `CHANGES_vNNN.md`(バージョンごとの変更内容・設計判断・テスト結果)。
- **今後の計画**: `../taskchute-notes/ROADMAP.md`(隣接する非公開の設計・運用リポジトリ)。
  未対応の指摘・改善提案は同リポジトリの `review.md` / `improvement-proposals.md`。

## 方針

- iOSネイティブではなく PWA として実装
- GitHub Pages で公開可能
- iPhone/iPad は Safari から「ホーム画面に追加」で利用
- データ保存はブラウザの `localStorage` を主とし、GitHub 上の `app-state.json` 1ファイルで端末間同期・バックアップ
- 実行時依存はゼロ(Markdown パーサ `marked` のみ同梱、CDN 非依存)

## 起動

実行時依存はありません。Node.js だけでローカル確認できます。

```bash
npm run dev
```

ブラウザで `http://localhost:4173` を開きます。

## テスト

E2Eテスト(headless Chromium + fetchモック)を同梱しています。push / PR 時に GitHub Actions でも自動実行されます。

```bash
npm install                                  # devDependencies(テスト・索引用)のみ
npx playwright-core install chromium         # ブラウザ取得(初回のみ)
npm test
```

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
- WBS: Project / Task ツリー、中断、Taskを今日のBlockへ登録、一括編集(編集モードで日付/状態/カテゴリを行内編集。自然文一括変更のAI一括編集はv60で廃止)
- タスクシュート: Block追加、着手/完了、実績時刻、充電/放電
- タイムライン: 予定/実績の時間軸表示、累積エネルギー
- ルーティン / ポモドーロ(任意・常時)
- ジャーナル: 前日/当日/AIフィードバックの3ペイン、朝の体調
- 0秒思考: 1テーマ1分の書き出し、履歴、日報連携
- やりたいこと / やらないこと リスト
- 日報: Markdown生成・ダウンロード・GitHub push・AIフィードバック閲覧(自宅PC側バッチが生成した `AIフィードバック_*.md` を GitHub 経由で取得・表示。アプリ内から Anthropic API を直接呼ぶ経路は v60 で全廃。下記「AI活用」参照)
- AI活用: 空き時間への下書きスケジュール配置(決定論エンジン、朝の一括プランニング。タイムラインでD&D調整→確定)/ AIレポートビューア(「その他」タブ。自宅PC側バッチが生成したコンテンツ総括・自己分析・基盤ヘルス・週次レビュー・バッチ実行サマリ・英語表現集をGitHub経由で横断閲覧)。会話的にAnthropic APIを直接呼ぶ機能(プロジェクトのタスク分解・週次/12週レビューの壁打ち・0秒思考のまとめ所感・今日のタスク提案・朝イチ自動レビュー)はv60で全廃(APIキー設定UIも同時に削除)。アプリにAIの知恵を入れる経路は「バッチ生成ファイル→GitHub→fetch」のみ
- スケジュール実績ログ: 下書き配置の採否・修正・実績を `aiScheduleHistory` へ蓄積(次回提案への自動注入はv60でAI呼び出しごと廃止済み。将来の自宅PCバッチ分析用途を見込んで記録のみ継続)
- 計器盤: 着手率・エネルギー収支の週次推移、時間帯×曜日の着手ヒートマップ、見積vs実績、カテゴリ別時間配分(ドーナツ)、カテゴリ別エネルギー収支、主要指標の推移(折れ線)、記録の継続カレンダー、時間帯別の活動量(4週/12週/全期間)
- 自動アーカイブ: 90日超の日報等・180日超のBlockを `archive/` へ退避して localStorage を軽く保つ(書き込み成功後にのみ削除)
- ビジョン: Vision / Affirmation / ビジョンボード
- 横断検索: 0秒思考・ジャーナル・問い・AIフィードバック・日報をまたいで検索(日付バーの🔍)
- 世代バックアップ: GitHub保存時に日次スナップショットを `backups/` に自動保存(14日分)・任意時点へ復元
- 設定: プロフィール・GitHub同期(個人データリポジトリの Owner/Repository/Token)・マスタ編集・JSON入出力(アプリ内でのAnthropic APIキー設定はv60で廃止済み。AIの知恵を取り込む経路は「バッチ生成ファイル→GitHub→fetch」のみ)

## GitHub Pages 公開

1. GitHubでリポジトリを作成する。
2. このフォルダの内容をpushする。
3. GitHubの `Settings > Pages` を開く。
4. Source を `Deploy from a branch`、Branch を `main`、Folder を `/root` にする。
5. 表示されたURLをSafariで開き、iPhone/iPadでは「ホーム画面に追加」する。

## ネイティブiOS版の名残

`Sources/`、`Tests/`、`Package.swift` は、最初に作ったSwift版フェーズ0の雛形です。Web/PWA方針ではすぐには使いませんが、データモデル設計の参考として残しています。
