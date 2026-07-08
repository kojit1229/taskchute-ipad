# Claude Code × Codex × Obsidian 協働レビュー環境 セットアップ手順書

新しいアプリ／リポジトリでも、この通りにやれば同じ「Claude が実装 → Codex がレビュー」の
協働環境を作れます。**このファイル自体を新プロジェクトにコピーして使う**ことを想定しています。

> このリポジトリ（taskchute-ipad）自体が「実装リポジトリ」の実例です。

---

## 0. これは何 / なぜ

```
Claude Code(実装)  ──実装後──▶  handoff.md(何を変えたか)
      ▲                                  │
      │対応                              ▼
   review.md(指摘)  ◀──レビュー──  Codex(レビュアー・コードは直さず指摘だけ)
```

- ログ（handoff / review / decisions）は **別の private リポジトリ `<APP>-notes`** に置く。
- `<APP>-notes` は実装リポジトリ `<APP>` と **同じ階層**に置く（`../<APP>-notes` で参照するため）。
- **Obsidian** で `<APP>-notes` フォルダを開き、ログを人間が読む。

---

## 1. 置き換える値（プレースホルダ）★重要★

以下の記号は、**あなたの環境に合わせて置き換えてください**。以降のコマンド中に出てきます。

| 記号 | 意味 | 例（このアプリの場合） |
|---|---|---|
| `<OWNER>` | GitHub のユーザー名 | `kojit1229` |
| `<APP>` | 実装リポジトリ名 | `taskchute-ipad` |
| `<APP_DIR>` | ローカルの実装リポジトリのパス | `C:\Users\kojit\Downloads\taskchute-ipad` |

`<APP>-notes` はログ用リポジトリ名（例 `taskchute-ipad-notes`）。**自分で決めずに `<APP>` の後ろに `-notes` を付けるだけ**でOK。

---

## 2. 一度だけの準備（PCに1回・全プロジェクト共通）

すでに済んでいれば飛ばして構いません。**PowerShell** で:

```powershell
winget install --id Git.Git         # Git 本体 + Git Bash
winget install --id GitHub.cli      # GitHub CLI(gh)
```
→ 一度 PowerShell を **閉じて開き直す**。続けて:

```powershell
gh auth login                       # GitHub.com → HTTPS → ブラウザでログイン
git config --global user.email "あなたのメール"
git config --global user.name  "あなたの名前"
```

- **Obsidian** も入れておく（https://obsidian.md/）。

> これらは「一度だけ」。次のアプリからは 3 章だけで済みます。

---

## 3. プロジェクトごとの設定（新しいアプリのたび・所要 5〜10分）

必要なのは **4 つ**（CLAUDE.md / AGENTS.md / .claude/settings.json / notesリポジトリ）だけ。
うち3ファイルは **Claude Code に丸ごと頼めば作ってくれます**。

### ステップ1 ── Claude Code に依頼（実装リポジトリ側の3ファイル＋スクリプト）

`<APP_DIR>` で **Claude Code を起動**し、下を貼り付けて依頼する（`<OWNER>` `<APP>` を置換）:

```text
このリポジトリに Codex 協働レビュー環境のメタファイルを作ってください。
GitHub は <OWNER>/<APP> です。ログ用リポジトリ名は <APP>-notes とします。

1. CLAUDE.md に「## 協働プロトコル」節:
   - 作業開始前に ../<APP>-notes/review.md の未対応指摘(- [ ])を確認し、先に対応。
     対応したら - [x] にして対応内容を1行追記
   - 実装完了後、../<APP>-notes/handoff.md に「日付/バージョン/変更ファイル/
     変更意図/自信がない箇所/レビュー希望観点」の形式で追記
   - 設計判断は ../<APP>-notes/decisions.md に追記
   - notes 側を書いたら ../<APP>-notes で git add -A && commit && push まで行う
2. AGENTS.md(Codex用):
   - 役割はレビュアー。コードの直接修正は禁止、指摘のみ
   - ../<APP>-notes/handoff.md と git diff を読み、review.md に
     「- [ ] 指摘内容(severity: high/med/low)(対象: ファイル名)」形式で書く
   - このアプリの技術スタックに合わせたレビュー必須観点を列挙する
   - レビュー後 notes リポジトリを commit & push
3. .claude/settings.json に、../<APP>-notes への書き込み・Bash実行許可
   (permissions.additionalDirectories と allow)を追加。既存設定は壊さない
4. scripts/setup-notes.sh と scripts/setup-notes.bat:
   親ディレクトリに <APP>-notes(private)を作成・初期化するスクリプト。
   Windows(Git Bash)対応、OWNER=<OWNER> / REPO=<APP>-notes。
   handoff.md / review.md / decisions.md / archive/.gitkeep /
   .gitignore(.obsidian/ .DS_Store Thumbs.db desktop.ini)/
   .gitattributes(* text=auto eol=lf)を生成し、gh未導入・未認証・
   git未設定は事前チェックして案内。初回 push は git push -u origin HEAD。

できたら PR を作ってマージまで進めてください。
```

> taskchute-ipad では、これらは `scripts/setup-notes.sh` / `scripts/setup-notes.bat` として
> 既にあります。**同じ内容を新アプリ用に頼む**イメージです。

### ステップ2 ── あなたが notes リポジトリを作成（PowerShell）

`<APP_DIR>` を自分のパスに置き換えて:

```powershell
cd <APP_DIR>
git pull
.\scripts\setup-notes.bat
```

- `.bat` が Git Bash を自動検出して `scripts/setup-notes.sh` を実行し、
  `<APP>-notes` を private で作成・初期化・push します。
- 途中で止まったら、画面の案内（gh のインストール/認証、git設定）に従って**もう一度**実行。
- 最後に **Obsidian で開くパス**（`C:\...\<APP>-notes`）が表示されます。

（Git Bash / WSL なら `bash scripts/setup-notes.sh` でも同じ）

### ステップ3 ── Obsidian で開く

- Obsidian →「**フォルダを vault として開く**（Open folder as vault）」
- ステップ2で表示された `<APP>-notes` フォルダを選ぶ
- （複数アプリのログを1つの Obsidian で見たい場合は、各 `<APP>-notes` を別 vault として開くか、
   それらを含む親フォルダを vault にする）

### ステップ4 ── Codex に依頼（レビュー開始）

`<APP_DIR>` で **Codex を起動**（`AGENTS.md` を自動で読みます）し、下を貼り付ける:

```text
あなたはこのリポジトリの「レビュアー」です。AGENTS.md と CLAUDE.md を読み、
役割とレビュー観点を把握してください。
- ../<APP>-notes/handoff.md の最新エントリと git diff を読む
- 見つけた問題を ../<APP>-notes/review.md に
  「- [ ] 指摘内容(severity: high/med/low)(対象: ファイル名)」で追記
- コードは直接修正しない(指摘のみ)
- 書いたら ../<APP>-notes を git add -A && commit && push
※ ../<APP>-notes はリポジトリ外です。アクセス許可を求められたら承認してください。
```

---

## 4. 毎回の運用ループ（設定後の日常）

1. **Claude Code** が実装 → `handoff.md` に追記して push
2. **あなた** が **Codex** に「レビューして」と頼む（ステップ4のプロンプト）
3. **Codex** が `review.md` に指摘を追記して push
4. **あなた** が Obsidian で `review.md` を確認
5. 次の実装で **Claude Code** が着手前に `review.md` の未対応（`- [ ]`）を対応 → `- [x]` に

> Claude Code へ「レビューを反映して」と頼むときは、`review.md` の中身をチャットに貼るか、
> 「../<APP>-notes/review.md の未対応指摘を対応して」と頼めばOK。

---

## 5. よくある質問

**Q. 新しいアプリのたびに全部やり直し?**
A. いいえ。「2章の一度だけの準備」は最初の1回だけ。新アプリで要るのは3章（4ファイル）だけで、
   うち3つは **Claude Code に依頼（ステップ1）** で自動作成。あなたの手作業は実質
   **ステップ2の2〜3コマンド + Obsidianで開く + Codexに1回頼む** だけです。

**Q. notesリポジトリは1つにまとめられない?**
A. アプリごとに `<APP>-notes` を分けるのが標準（handoff/review が混ざらない）。
   1つの Obsidian で見たいだけなら、複数 vault を切り替えるか、親フォルダを vault にする。

**Q. パスはWindows/Macで違う?**
A. スクリプトが環境を自動判定します。`../<APP>-notes` の相対参照や settings.json の
   スラッシュ表記は Windows でもそのまま有効です。

**Q. gh や git identity が未設定で止まった**
A. スクリプトが事前チェックして案内を出します。案内のコマンド（`gh auth login` /
   `git config --global user.email/…`）を実行して、もう一度スクリプトを走らせてください。
