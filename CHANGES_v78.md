# CHANGES v78

## 概要

K報告「日報を生成すると『パスが違う』という趣旨のエラーが出る」の原因調査と修正。

**結論**: URL組み立て自体(二重プレフィックス等)にバグは無かった。実体は、v72の
`personal-data`リポジトリ移行後にFine-grained PATへの権限付与(CHANGES_v72.md「Kの移行手順」
手順2)が未実施/不足のまま新設定へ切り替わり、GitHubが権限不足を404で返す状態を、アプリの
既存エラーヒントが「パス/Owner/Repoの綴りを確認」としか案内していなかったために起きていた、
という強い状況証拠が得られた(詳細は下記1章)。アプリのコードだけで断定的に「これが100%の
原因」と証明することはできない(Kの端末のトークン実値・GitHub側の実際のRepository access設定は
この環境から見えないため)が、確認できた事実から取りうる最善の対応として、
**エラー文言とバナー表示を「パスだけでなく権限も疑わせる」内容に是正**した。

SW `CACHE_NAME` を v77 → v78 に更新。

---

## 1. 原因調査(現物根拠)

### 1.1 URL組み立て自体は正しかった(v76で疑われた「二重プレフィックス」は不成立)

指示にあった仮説「v76でセグメントencode方式に統一した際、呼び出し元が既に`taskchute/`付きの
パスを渡していると`taskchute/taskchute/日報_*.md`になる二重プレフィックスバグ」を、
`pushFileToGitHub`/`pushReportToGitHub`/`pushGitHubPath`/`personalDataPath`/`personalDataFileConfig`
全ての現物コード(app.js 1909行目・8792〜8817行目・11286〜11348行目)を読んで検証した。

- `pushReportToGitHub` は常に `日報_${date}.md`(フラットなファイル名、`/`を含まない)を渡す。
- `pushFileToGitHub` 内部で `personalDataPath(filename)` = `taskchute/${filename}` を1回だけ付加する。
- 呼び出し元(日報・週次・12週)はいずれもフラットなファイル名しか渡していないため、
  二重プレフィックスは発生し得ない。v76のコメント自身も「フラットなfilenameでは旧実装と
  完全に一致する安全な統一」と明記しており、コード上の記述と実態は一致していた。
- `tests/v76.test.js`[5]も実際にこの経路を実行して`taskchute/日報_<date>.md`形式であることを
  確認しており、E2Eレベルでも再現しなかった。

→ このため、v76のURL組み立て変更自体は今回の不具合の原因ではないと判断した。

### 1.2 実コミット履歴からの物証: pushが一度も成功していない

`repos/personal-data`(K本人のGitHubリポジトリのローカルclone)の`git log --oneline --all`を
全数確認した(12コミット)。

```
0644b7b review: 週次レビュー_2026-07-11 を追加(自動生成)
65a14ef plan: AIプラン_2026-07-11 を追加(自動生成)
dbdf447 feedback: AIフィードバック_2026-07-10.md を追加(AIコーチング自動生成)
b9941c2 feedback: AIフィードバック_2026-07-09.md を追加(AIコーチング自動生成)
3c2bd21 feedback: AIフィードバック_2026-07-09.md を追加(AIコーチング自動生成)
c1a1fcb reading: highlights.json を更新(自動生成・knowledge/kindle再パース)
25e6a27 K指示: ウイスキー検定2級 12WYプロジェクト登録
c337324 K指示: ジム日程の表示反映修正+旧ジャーナル枠削除
8357c24 K指示: ルーティン最適化+12WY日程更新
417051e feedback: AIフィードバック_2026-07-09.md を追加(AIコーチング自動生成)
ad0a28b migrate: now_vision.pdf を移行(個人データ)
0f988cd migrate: taskchute-ipadから個人データを初回移行(16件)
```

すべて**自宅PCバッチ(coach-daily.sh/plan-daily.sh/weekly-review.sh等)またはK指示の手動commit**
であり、アプリ自身が生成するコミットメッセージ形式(`pushFileToGitHub`/`saveToGitHub`が生成する
`chore: update <filename> <ISO>` / `chore: update app state <ISO>`)に一致するコミットが
**1件も存在しない**。つまり、v72移行(2026-07-10の初回移行コミット`0f988cd`)以降、

- 日報のアプリ内push(`pushReportToGitHub`、設定でautoSave ONなら日報生成時に自動実行)
- app-state.jsonの自動保存/手動保存(`saveToGitHub`)

のいずれも一度も成功していない。これはアプリのURL構築コードの局所的な欠陥では説明できず
(欠陥ならたまに/特定条件下でだけ失敗するはずだが、実態は「一度も成功していない」)、
**接続設定そのもの(token/dataOwner/dataRepo、特にtokenの対象repoへのアクセス権)がv72移行後
ずっと機能していない**ことを示す状況証拠である。

### 1.3 GitHub Fine-grained PATの実挙動との突合

`CHANGES_v72.md`の「Kの移行手順」2は次の手動作業を要求している:

> 既存のFine-grained PATを開き、**Repository access** に `personal-data` を追加し、
> **Contents: Read and write** 権限を付与する(既存の`taskchute-ipad`向け権限はそのままでよい)。

これは**アプリが自動化できない、K本人がGitHub側で行う必要がある操作**であり、旧`taskchute-ipad`
(public)から新設の`personal-data`(private)への切り替えのタイミングでのみ必要になる、
一度きりの見落としやすい手順である。

GitHub Fine-grained PATは、**アクセス権を持たないprivateリポジトリに対しては(そのリポジトリの
存在自体を第三者に漏らさないため)403ではなく404を返す**仕様になっている。つまり、
K側でこの手順が未実施/不足(例: `personal-data`を選択し忘れた、または選択したがContents権限を
Read-onlyのままにした)だった場合、アプリからのすべてのPUT(app-state.json保存・日報push・
週次push・12週push・バックアップ)は404として返ってくる。

一方、`gitHubErrorMessage()`(app.js 8915行目〜、修正前)の404ヒントは

```
"ファイルが見つかりません。Owner / Repository / Branch / 保存先パスの綴りを確認してください"
```

であり、**「パスの綴りが違う」としか読めない文言**になっていた。これがK報告の「パスが違う」
という体感の直接の出所であり、実際の原因(トークンの権限不足)を正しく案内できていなかった。

### 1.4 なぜv76のレビュー・テストがこれを検出できなかったか

- `tests/v76.test.js`[5]は`page.route()`で**常に201を返すモック**を使ってURL構築の回帰だけを
  見るテストであり、実際のGitHub APIが権限不足時に404を返す挙動そのものを一切踏んでいない。
  モックが常に成功するため、「URLは正しいが、その先の実サーバが権限不足で404を返す」ケースは
  構造的に検出できない設計だった。
- v76の担当者自身も引き継ぎ(`../taskchute-notes/handoff.md` 2026-07-10 v76節)で
  「日報push不具合の真因は特定できていない…Kの端末側の設定値(token/dataOwner/dataRepo/
  autoSave)には今回アクセスできていない」と明記しており、王道の「URL構築を疑って直す」対応を
  取った上で、真因未特定のまま暫定対応に留まっていた。
- 今回は`repos/personal-data`のgit履歴という**Kの環境に実際に残っている物証**にあたることで、
  「そもそも一度も成功していない」という決定的な手がかりを得られた。これは前回のセッションでは
  参照されていなかった情報源である。

---

## 2. 修正

### 2.1 エラーヒントの是正(`gitHubErrorMessage`、app.js 8915行目〜)

404ヒントを「パスの綴り」**と**「Fine-grained tokenのRepository access（対象repoが選択されて
いるか）・Contents: Read and write権限」の両方を案内する内容に変更した。401/403の既存ヒントは
維持しつつ、401/403/404のいずれについても、読み込み失敗(401)時に既に使っている
`.pd-auth-banner`(設定画面への誘導バナー)を同様に表示するようにした。

`gitHubErrorMessage`は`saveToGitHub`/`loadFromGitHub`/`pushFileToGitHub`/`pushGitHubPath`/
世代バックアップ保存・復元/アーカイブ検索など、**書き込み・読み込みの失敗が「起きてはいけない」
すべての経路で共有されている単一の関数**であるため、この1箇所の修正で日報・週次・12週・
app-state.json保存の全経路に同じ改善が及ぶ(個別に直す必要はなかった)。

### 2.2 週次push・12週サイクルpush・app-state.json保存の点検

いずれも`pushFileToGitHub`(週次・12週)/`saveToGitHub`(app-state.json、`gitHubContentsURL`+
`personalDataFileConfig`)を経由しており、URL組み立て・エラーハンドリングとも日報pushと完全に
同一の経路であることをコード上確認した。二重プレフィックス等の個別の欠陥は無い。
`tests/v78.test.js`[2]でapp-state.json保存のPUT先パスも厳格アサーションを追加した(週次・12週は
UIから`week`/`cycleStart`の値をrender済み画面から取得する必要がありE2Eのセットアップコストが
高いため、コードレビューでの確認に留めた。`pushFileToGitHub`という同一関数を通る以上、
日報pushの厳格アサーションが週次・12週にもそのまま当てはまる)。

---

## 3. テスト(`tests/v78.test.js`、新設)

1. 日報push: PUT先パスの厳格アサーション。`taskchute/日報_<date>.md`への**完全一致**
   (`===`比較)を追加し、`%2F`/`%2f`混入・`taskchute/taskchute`二重・root直下(`taskchute/`無し)
   のいずれでもないことを明示的に否定するチェックを追加した(v76の`endsWith`ベースの緩い
   アサーションより厳格化)。
2. app-state.json保存: 同様にPUT先パスの完全一致アサーションを追加。
3. **実際のGitHub挙動を模擬した404**(トークン権限不足時と同じ形の`{message:"Not Found"}`)を
   日報pushのPUTに対して返し、(a)失敗トーストに「パス」の案内が残っていること、
   (b)新たに「Repository access」または「権限」の案内が追加されていること、
   (c)`.pd-auth-banner`が表示されることを検証した。これが今回追加した本質的な回帰テストであり、
   v76が検出できなかった「実サーバの権限不足404」のケースを初めて明示的に踏む。

全量`npm test`(26スイート、v78含む)フォアグラウンド実行でALL PASS(exit code 0)を確認済み。

---

## 4. 未対応・懸念点

- **真因の断定はできていない**。今回のアプリ側修正は「404の案内文言・バナーを、パスだけでなく
  権限も疑わせる内容に是正する」という、コードから確認・検証可能な範囲での対応である。
  Kの端末のトークンが実際に`personal-data`へのアクセス権を持っているか、Contents権限が
  Read and writeになっているかは、この環境からは確認できない。**Kに実機で以下を確認して
  もらう必要がある**:
  1. GitHubのFine-grained PAT設定画面を開く。
  2. Repository accessに`personal-data`が含まれているか確認する(含まれていなければ追加)。
  3. Permissionsの`Contents`が`Read and write`になっているか確認する(`Read-only`だと書き込み
     だけ失敗し、読み込み=AIフィードバック等の表示は正常に見えてしまうため気づきにくい)。
  4. 上記を修正後、設定画面の「今すぐGitHubへ保存」を押し、`personal-data`リポジトリに
     `chore: update app state ...`のコミットが実際に増えることをGitHub上で確認する。
- 上記確認の結果、それでも404/403が出る場合は、トークンの権限以外の原因(トークン自体の
  失効、リポジトリ名/Ownerの入力誤り等)を切り分ける必要がある。今回是正した404ヒントの
  文言はこの切り分けもある程度助ける内容にしてある。
- 週次push・12週サイクルpushは個別のE2E(UIクリックベース)での厳格アサーションは追加して
  いない(2.2節参照)。コードパスの同一性は確認済みだが、UI経由の実操作での確認はしていない。
