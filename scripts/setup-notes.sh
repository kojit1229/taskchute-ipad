#!/usr/bin/env bash
# setup-notes.sh — Codex 協働レビュー用の別プライベートリポジトリ taskchute-notes を
# ローカル(Mac)で作成・初期化するワンショットスクリプト。
#
# 使い方(Mac のターミナル):
#   1. ローカルの taskchute-ipad で最新を取り込む:  git pull
#   2. このスクリプトを実行:                        bash scripts/setup-notes.sh
#
# 前提: gh CLI が認証済み(未認証なら `gh auth login`)。
# 冪等性: taskchute-notes が既にあれば作成/clone はスキップし、ファイルだけ整える。

set -euo pipefail

OWNER="kojit1229"
REPO="taskchute-notes"
DEST="${HOME}/Downloads/${REPO}"

# 1) gh 認証確認
if ! command -v gh >/dev/null 2>&1; then
  echo "❌ gh CLI が見つかりません。https://cli.github.com/ からインストールしてください。"
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "❌ gh が未認証です。先に \`gh auth login\` を実行してください。"
  exit 1
fi
echo "✅ gh 認証OK"

# 2) private リポジトリを作成して clone(既に clone 済みならスキップ)
mkdir -p "${HOME}/Downloads"
if [ -d "${DEST}/.git" ]; then
  echo "ℹ️  ${DEST} は既に存在します。作成/clone をスキップします。"
else
  cd "${HOME}/Downloads"
  if gh repo view "${OWNER}/${REPO}" >/dev/null 2>&1; then
    echo "ℹ️  リモート ${OWNER}/${REPO} は既に存在。clone します。"
    gh repo clone "${OWNER}/${REPO}" "${REPO}"
  else
    gh repo create "${OWNER}/${REPO}" --private --clone
  fi
fi

cd "${DEST}"
mkdir -p archive

# 3) ファイル生成(既存は上書きしないよう、無い場合のみ作成)
write_if_absent() {
  # $1 = ファイルパス, 標準入力 = 内容
  if [ -e "$1" ]; then
    echo "ℹ️  $1 は既に存在。スキップ。"
    cat >/dev/null   # 標準入力を捨てる
  else
    cat > "$1"
    echo "📝 作成: $1"
  fi
}

write_if_absent handoff.md <<'EOF'
# Handoff Log

<!--
実装完了ごとに、以下のフォーマットで下に追記する(新しいものを上に足してもよい):

## <日付 YYYY-MM-DD> / v<バージョン>
- 変更ファイル: <ファイル名(カンマ区切り)>
- 変更意図: <なぜこの変更をしたか>
- 自信がない箇所: <レビューで特に見てほしい不安な点>
- レビュー希望観点: <重点的に確認してほしい観点>
-->
EOF

write_if_absent review.md <<'EOF'
# Review

<!--
Codex(レビュアー)が指摘を追記する。1指摘1行、未対応は [ ]、対応済みは [x]:

- [ ] 指摘内容(severity: high/med/low)(対象: ファイル名)

実装者は作業開始前にこの未対応(- [ ])を確認し、対応したら [x] にして
末尾に対応内容を1行追記する。
-->
EOF

write_if_absent decisions.md <<'EOF'
# Design Decisions

<!--
設計上の合意(方針・トレードオフの結論)を日付付きで残す:

## <日付 YYYY-MM-DD> <タイトル>
- 背景 / 選択肢 / 決定 / 理由
-->
EOF

write_if_absent archive/.gitkeep <<'EOF'
EOF

write_if_absent .gitignore <<'EOF'
.obsidian/
.DS_Store
EOF

# 4) commit & push
git add -A
if git diff --cached --quiet; then
  echo "ℹ️  変更なし。commit をスキップします。"
else
  git commit -m "chore: init collaboration notes (handoff/review/decisions)"
  git push
  echo "🚀 push 完了"
fi

echo ""
echo "✅ 完了: ${DEST}"
echo "   次に Obsidian で「フォルダを vault として開く」→ ${DEST} を選択してください。"
