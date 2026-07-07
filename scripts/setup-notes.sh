#!/usr/bin/env bash
# setup-notes.sh — Codex 協働レビュー用の別プライベートリポジトリ taskchute-notes を
# ローカルで作成・初期化するワンショットスクリプト。
# Windows(Git Bash / WSL)・macOS・Linux 対応。
#
# 使い方:
#   Git Bash / WSL / macOS:  bash scripts/setup-notes.sh
#   PowerShell からは:        & "C:\Program Files\Git\bin\bash.exe" scripts/setup-notes.sh
#
# 動作:
#   - taskchute-notes は「このリポジトリ(taskchute-ipad)の親ディレクトリ」に置く。
#     CLAUDE.md / AGENTS.md / .claude/settings.json の ../taskchute-notes 参照を
#     構成的に成立させるため(~/Downloads 固定ではない)。
#   - 冪等: リポジトリ・ファイルが既にあればスキップして先へ進む。
#   - *.md は .gitattributes で eol=lf に固定(Windows の CRLF 警告を予防)。

set -euo pipefail

OWNER="kojit1229"
REPO="taskchute-notes"

# ---- 0) 環境判定 -----------------------------------------------------------
UNAME_S="$(uname -s 2>/dev/null || echo unknown)"
ENV_LABEL="Linux"
case "${UNAME_S}" in
  MINGW*|MSYS*) ENV_LABEL="Windows (Git Bash)" ;;
  Darwin)       ENV_LABEL="macOS" ;;
  Linux)
    if grep -qi microsoft /proc/version 2>/dev/null; then ENV_LABEL="Windows (WSL)"; fi ;;
esac
echo "🖥  環境: ${ENV_LABEL} (${UNAME_S}) / shell: bash"

# POSIX パス → その環境の表示用パス(Git Bash: cygpath -w / WSL: wslpath -w)
display_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"
  elif command -v wslpath >/dev/null 2>&1; then wslpath -w "$1" 2>/dev/null || echo "$1"
  else echo "$1"
  fi
}

# ---- 1) taskchute-ipad の位置と親ディレクトリを特定 -------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IPAD_DIR="$(dirname "${SCRIPT_DIR}")"
PARENT_DIR="$(dirname "${IPAD_DIR}")"
DEST="${PARENT_DIR}/${REPO}"

if [ ! -d "${IPAD_DIR}/.git" ] || [ ! -f "${IPAD_DIR}/CLAUDE.md" ]; then
  echo "❌ taskchute-ipad リポジトリを特定できません(${IPAD_DIR})。"
  echo "   taskchute-ipad リポジトリ内の scripts/setup-notes.sh を実行してください。"
  exit 1
fi
echo "📁 taskchute-ipad: $(display_path "${IPAD_DIR}")"
echo "📁 taskchute-notes の配置先(同じ階層): $(display_path "${DEST}")"

# ---- 2) gh CLI の確認 -------------------------------------------------------
if ! command -v gh >/dev/null 2>&1; then
  echo "❌ GitHub CLI (gh) が見つかりません。インストールしてから再実行してください:"
  echo "   - Windows: winget install --id GitHub.cli   (または https://cli.github.com/)"
  echo "   - WSL(Ubuntu): sudo apt install gh          (または上記サイトの手順)"
  echo "   - macOS: brew install gh"
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "❌ gh が未認証です。先に認証してから再実行してください:"
  echo "   gh auth login   (GitHub.com → HTTPS → ブラウザでログイン)"
  exit 1
fi
echo "✅ gh 認証OK"

# ---- 3) taskchute-notes を親ディレクトリに用意 ------------------------------
if [ -d "${DEST}/.git" ]; then
  echo "ℹ️  ${DEST} は既に存在します。作成/clone をスキップします。"
else
  if gh repo view "${OWNER}/${REPO}" >/dev/null 2>&1; then
    echo "ℹ️  リモート ${OWNER}/${REPO} は既に存在。clone します。"
    gh repo clone "${OWNER}/${REPO}" "${DEST}"
  else
    echo "🆕 private リポジトリ ${OWNER}/${REPO} を作成して clone します。"
    ( cd "${PARENT_DIR}" && gh repo create "${OWNER}/${REPO}" --private --clone )
  fi
fi

cd "${DEST}"
mkdir -p archive

# ---- 4) ファイル生成(既存は上書きしない)-----------------------------------
write_if_absent() {
  # $1 = ファイルパス, 標準入力 = 内容
  if [ -e "$1" ]; then
    echo "ℹ️  $1 は既に存在。スキップ。"
    cat >/dev/null
  else
    cat > "$1"
    echo "📝 作成: $1"
  fi
}

# CRLF 警告の予防: *.md を LF に固定(最初に置いてから md を作る)
write_if_absent .gitattributes <<'EOF'
*.md text eol=lf
EOF

write_if_absent handoff.md <<'EOF'
# Handoff Log

<!--
実装完了ごとに、以下のフォーマットで追記する(CLAUDE.md「協働プロトコル」参照):

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

実装者(Claude)は作業開始前にこの未対応(- [ ])を確認し、対応したら [x] にして
末尾に対応内容を1行追記する。
例: - [x] 指摘内容(severity: high)(対象: app.js) → 正規表現パースに修正 (v55)
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
Thumbs.db
desktop.ini
EOF

# ---- 5) commit & push -------------------------------------------------------
git add -A
if git diff --cached --quiet; then
  echo "ℹ️  変更なし。commit をスキップします。"
else
  git commit -m "initial vault setup"
  git push
  echo "🚀 push 完了"
fi

# ---- 6) taskchute-ipad 側との整合確認 ---------------------------------------
echo ""
echo "== 整合確認 =="
OK=1

# ../taskchute-notes が taskchute-ipad から解決できるか
if [ -d "${IPAD_DIR}/../${REPO}" ]; then
  echo "✅ ../taskchute-notes 参照OK(taskchute-ipad と同じ階層に配置済み)"
else
  echo "❌ ../taskchute-notes が解決できません"; OK=0
fi

# 書き込み実地テスト(一時ファイル作成→削除)
PROBE="${DEST}/.write-test-$$"
if ( echo test > "${PROBE}" && rm "${PROBE}" ) 2>/dev/null; then
  echo "✅ taskchute-notes への書き込みOK(一時ファイル作成・削除に成功)"
else
  echo "❌ taskchute-notes へ書き込めません(権限を確認してください)"; OK=0
fi

# taskchute-ipad 側の設定ファイル
for f in CLAUDE.md AGENTS.md .claude/settings.json; do
  if [ -f "${IPAD_DIR}/${f}" ]; then
    echo "✅ taskchute-ipad/${f} あり"
  else
    echo "⚠️  taskchute-ipad/${f} が見つかりません。taskchute-ipad で git pull してください。"
    OK=0
  fi
done

# ---- 7) 完了表示 -------------------------------------------------------------
echo ""
if [ "${OK}" = "1" ]; then echo "✅ セットアップ完了"; else echo "⚠️  セットアップは完了しましたが、上の⚠️/❌を確認してください"; fi
echo ""
echo "📦 taskchute-notes の場所(Obsidian で「フォルダを vault として開く」に使うパス):"
echo "   $(display_path "${DEST}")"
echo ""
echo "次の手動ステップ:"
echo "  1. taskchute-ipad 側を最新化(deploy.sh 運用の前に必須): cd \"$(display_path "${IPAD_DIR}")\" && git pull"
echo "  2. Obsidian → 「フォルダを vault として開く」→ 上記パスを選択"
