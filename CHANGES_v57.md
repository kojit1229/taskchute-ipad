# CHANGES v57

## 変更内容

ローカルAIコーチングがGitHubリポジトリ直下に直接pushした前日フィードバック
(`AIフィードバック_YYYY-MM-DD.md`)を、アプリ内アップロードを経ずに自動で読み込めるようにした。

- `hydrateStaticMarkdown()`(app.js)の起動時fetchゲートを、**前日(昨日)1日分に限り**緩和。
  従来は `state.feedbackFiles`(アプリ内アップロード `uploadFeedbackFile()` 経由でのみ追加される
  push済み日付リスト)に載っている日付しか fetch しなかったため、リポジトリへの直接pushはアプリが
  気づけなかった。前日分だけは `feedbackFiles` 未登録でも常に `fetchText()` で取得を試みる。
- ファイルが存在しない場合(直接pushが無い日)の 404 は `fetchText()` が既に catch/`!response.ok` で
  静かに空文字を返す実装になっており、追加のエラーハンドリングは不要だった。
- 前日フィードバックの取得に成功した場合は `recordFeedbackFile(prev)` を呼び、以後は正規の
  `feedbackFiles` ルートに載せる(今日・過去日の既存ロジックは変更していない)。
- **F1(レビュー反映)**: 上記の無条件fetchは「**今日から見た昨日**」1日分にのみ限定した
  (`wantFetchPrev` の判定を `d === addDays(todayISO(), -1)` に固定)。初期実装では
  `selectedDate` 基準で前日を計算していたため、過去日をブラウズするたびに存在しない
  前々日以前の `.md` へ無条件fetchが飛び、過去日ブラウズ時の404ノイズ回避という
  v56の目的を再度壊してしまっていた。この修正により、無条件fetchは「アプリを今日開いた
  ときの起動時hydrate」でしか発生しない。
- テスト: `tests/v56.test.js`「feedbackFiles が空なら fetch を出さない」を新仕様
  (許容されるfetchは「今日から見た昨日」分ちょうど1件のみ、それ以外は0件)に更新し、
  `tests/v57.test.js` を新規追加(直push検知の読込→提案プロンプトへの反映、
  過去日ブラウズ時にF1が無条件fetchを出さないことの回帰、`recordFeedbackFile` による
  `feedbackFiles` 登録を検証)。
- `sw.js` の `CACHE_NAME` を `v56` → `v57` に更新(PWA強キャッシュ対策)。
- アプリ内にユーザー可視のバージョン表記は無いため、grep確認の上で変更なし
  (コード内 `// v56:` コメント群は変更履歴コメントであり、UI表示ではないため据え置き)。

## 変更ファイル

- `app.js`(`hydrateStaticMarkdown()` 内、8029〜8055行目付近)
- `sw.js`(`CACHE_NAME`、1行目)
- `tests/v56.test.js`(前日1日分限定の新仕様に合わせてアサーション更新)
- `tests/v57.test.js`(新規)

## テスト手順(iPhone実機)

前提: 「今日のタスク提案」ボタンは `state.selectedDate` が**当日**のときのみ表示される
(`app.js` 3887行目付近)。手順2でPWAを再読込した時点(＝当日表示でhydrate済み)から
続けて操作すること。

1. GitHubリポジトリ直下に、手動で `AIフィードバック_<昨日の日付>.md` を配置(アプリ内アップロードは使わない)。
2. TaskChute Journal PWAをアプリ再読込(またはSafariでURLを開き直す)。ホーム画面が当日表示であることを確認する。
3. ホーム画面の「今日のタスク提案」(`runAiTodaySuggest()`)を実行し、提案結果(またはSafari開発者ツールの
   Consoleで `cachedFeedback` を直接見られない場合はNetworkタブで `api.anthropic.com` へのリクエストの
   送信本文)に配置した昨日のフィードバック内容が反映されていることを確認する。反映有無が目視でわかりにくい
   場合は、フィードバック本文に一時的な目印文言(例: 「TEST-MARKER」)を仕込んでおくと確認しやすい。
4. 参考: 当日分・アプリ内アップロード済みの過去日については、従来どおり
   `feedbackFiles` に載っている日付のみ fetch される(挙動は変更していない)。
5. 過去日(前日以外)にページ送りしても、その前日分の `AIフィードバック_*.md` への404が
   コンソールに出ないことを確認する(F1の回帰確認)。

## 反映確認サイン

```
https://kojit1229.github.io/taskchute-ipad/sw.js?nocache=YYYYMMDD
```

を開き、1行目が `const CACHE_NAME = "taskchute-journal-pwa-v57";` になっていることを確認する。
反映されない場合は Skill 記載の復旧手順(PWA再起動 → SafariのWebサイトデータ削除 → PWA削除→再追加)に従う。
