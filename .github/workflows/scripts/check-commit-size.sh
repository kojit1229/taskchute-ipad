#!/usr/bin/env bash
# commit-size-gate: 1コミットあたり追加+削除行数合計200行以下を強制する。
#
# Usage: check-commit-size.sh <base-sha-or-empty> <head-sha> [default-branch]
#
# - <base> が空 / 全ゼロ / 解決不能なら、次の順でフォールバックする:
#     1) origin/<default-branch> との merge-base
#     2) HEADから直近20コミット分だけを対象範囲にする
# - マージコミット(親2つ以上)は判定対象から除外する。
# - コミット本文に "Size-Exempt: <理由>" トレーラーがあれば、そのコミットは
#   理由をログに出したうえでスキップする。
# - バイナリファイル(numstatが "-") は0行として扱う。
# - 1コミットでも 200行(追加+削除合計)を超えていれば exit 1。
#
# CI(GitHub Actions)からもローカル検証からも同じロジックを使う。

set -u
set -o pipefail

LIMIT=200
FALLBACK_COMMIT_COUNT=20

BASE="${1:-}"
HEAD="${2:-}"
DEFAULT_BRANCH="${3:-}"

if [ -z "$HEAD" ]; then
  echo "ERROR: HEAD SHA が指定されていません" >&2
  exit 2
fi

ZERO_SHA="0000000000000000000000000000000000000000"

# HEADがブランチ削除等で全ゼロなら判定対象なし
if [ "$HEAD" = "$ZERO_SHA" ]; then
  echo "HEADが全ゼロ(ブランチ削除等)のため判定をスキップします。"
  exit 0
fi

if ! git rev-parse --verify "$HEAD" >/dev/null 2>&1; then
  echo "ERROR: HEAD ($HEAD) を解決できません" >&2
  exit 2
fi

resolve_base() {
  # BASEが空 or 全ゼロ or 解決不能な場合のフォールバック
  if [ -n "$BASE" ] && [ "$BASE" != "$ZERO_SHA" ] && git rev-parse --verify "$BASE" >/dev/null 2>&1; then
    echo "$BASE"
    return 0
  fi

  echo "BASEが未指定/全ゼロ/解決不能なためフォールバックします(新規ブランチ初pushの可能性)。" >&2

  # フォールバック1: デフォルトブランチとのmerge-base
  if [ -n "$DEFAULT_BRANCH" ]; then
    if git rev-parse --verify "origin/$DEFAULT_BRANCH" >/dev/null 2>&1; then
      local_mb=$(git merge-base "origin/$DEFAULT_BRANCH" "$HEAD" 2>/dev/null || true)
      if [ -n "$local_mb" ]; then
        echo "フォールバック: origin/$DEFAULT_BRANCH とのmerge-base ($local_mb) を使用します。" >&2
        echo "$local_mb"
        return 0
      fi
    fi
  fi

  # フォールバック2: 直近N件のコミットのみを対象にする
  fallback_base=$(git rev-list --no-merges "$HEAD" | sed -n "$((FALLBACK_COMMIT_COUNT + 1))p")
  if [ -n "$fallback_base" ]; then
    echo "フォールバック: 直近${FALLBACK_COMMIT_COUNT}件のコミットのみを対象にします(起点: $fallback_base)。" >&2
    echo "$fallback_base"
    return 0
  fi

  # 履歴がN件未満(リポジトリ最初期)ならHEADから辿れる全コミットが対象
  echo "フォールバック: 履歴が${FALLBACK_COMMIT_COUNT}件未満のため、HEADから辿れる全コミットを対象にします。" >&2
  echo ""
  return 0
}

RESOLVED_BASE=$(resolve_base)

if [ -n "$RESOLVED_BASE" ]; then
  RANGE="${RESOLVED_BASE}..${HEAD}"
else
  RANGE="$HEAD"
fi

# マージコミット(親2つ以上)を除外したコミット一覧
mapfile -t COMMITS < <(git rev-list --no-merges "$RANGE" 2>/dev/null)

if [ "${#COMMITS[@]}" -eq 0 ]; then
  echo "判定対象コミットはありません(範囲: $RANGE)。"
  exit 0
fi

echo "判定対象: ${#COMMITS[@]}件のコミット(範囲: $RANGE、上限: ${LIMIT}行、マージコミットは除外済み)"
echo "---"

violations=()

for sha in "${COMMITS[@]}"; do
  subject=$(git log -1 --format=%s "$sha")
  short=$(git rev-parse --short "$sha")
  body=$(git log -1 --format=%B "$sha")

  exempt_reason=$(printf '%s\n' "$body" | grep -E '^Size-Exempt:' | head -1 | sed -E 's/^Size-Exempt:[[:space:]]*//')

  if [ -n "$exempt_reason" ]; then
    echo "[SKIP] $short $subject -- Size-Exempt: $exempt_reason"
    continue
  fi

  total=$(git show --numstat --format="" "$sha" | awk '
    {
      add = ($1 == "-") ? 0 : $1
      del = ($2 == "-") ? 0 : $2
      sum += add + del
    }
    END { print sum + 0 }
  ')

  if [ "$total" -gt "$LIMIT" ]; then
    echo "[NG]   $short $subject -- ${total}行 (上限${LIMIT}行超過)"
    violations+=("$short $subject -- ${total}行")
  else
    echo "[OK]   $short $subject -- ${total}行"
  fi
done

echo "---"

if [ "${#violations[@]}" -gt 0 ]; then
  echo "FAIL: ${#violations[@]}件のコミットが1コミット${LIMIT}行の上限を超えています。"
  echo ""
  echo "超過コミット一覧:"
  for v in "${violations[@]}"; do
    echo "  - $v"
  done
  echo ""
  echo "対応: 依存順の小さいコミットへ分割してください。"
  echo "生成物・分割不能な移行など正当な例外は、コミットメッセージ本文に"
  echo "'Size-Exempt: <理由>' トレーラーを付けてください。"
  exit 1
fi

echo "PASS: 全コミットが1コミット${LIMIT}行の上限内です。"
exit 0
