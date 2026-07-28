#!/usr/bin/env bash
# commit-size-gate: 1コミットあたりの実行コード追加+削除を原則200行以下にする。
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
# - tests/**、docs/**、Markdown、releases/**、package-lock.json は数値対象外。
# - 1コミットでも実行コードが200行(追加+削除合計)を超えていれば exit 1。
# - 行数とは独立の第2判定(Must-4): コミット範囲の前後で tests/suite-manifest.json を比較し、
#   スイート総数 or assertionSignals合計が減っていれば、コミット範囲の本文に
#   "Test-Reduction: <理由>" トレーラーが無い限り exit 1(Size-Exemptと同じ「理由を書けば
#   通るがログに残る」方式。テスト削除・弱体化の無届けを機械検知する)。
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

suite_manifest_stats() {
  # 指定refでのtests/suite-manifest.jsonの概算統計を返す(「<suite総数> <assertionSignals合計>」)。
  # 生成物のJSONを厳密パースはせず、grep/awkでフィールドを数え上げる簡易実装で十分
  # (フォーマットの妥当性自体はscripts/test-manifest.jsが担保する)。
  local ref="$1"
  local content
  content=$(git show "${ref}:tests/suite-manifest.json" 2>/dev/null || true)
  if [ -z "$content" ]; then
    echo "0 0"
    return 0
  fi
  local count sum
  count=$(printf '%s' "$content" | grep -c '"file":[[:space:]]*"' || true)
  sum=$(printf '%s' "$content" | grep -oE '"assertionSignals":[[:space:]]*[0-9]+' \
    | grep -oE '[0-9]+$' | awk '{s+=$1} END {print s+0}')
  echo "${count:-0} ${sum:-0}"
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

echo "判定対象: ${#COMMITS[@]}件のコミット(範囲: $RANGE、実行コード上限: ${LIMIT}行、マージコミットは除外済み)"
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

  all_total=$(git show --numstat --format="" "$sha" | awk '
    {
      add = ($1 == "-") ? 0 : $1
      del = ($2 == "-") ? 0 : $2
      sum += add + del
    }
    END { print sum + 0 }
  ')

  executable_total=$(git show --numstat --format="" "$sha" -- . \
    ':(glob,exclude)tests/**' \
    ':(glob,exclude)docs/**' \
    ':(glob,exclude)releases/**' \
    ':(glob,exclude)**/*.md' \
    ':(exclude)package-lock.json' | awk '
    {
      add = ($1 == "-") ? 0 : $1
      del = ($2 == "-") ? 0 : $2
      sum += add + del
    }
    END { print sum + 0 }
  ')
  excluded_total=$((all_total - executable_total))

  if [ "$executable_total" -gt "$LIMIT" ]; then
    echo "[NG]   $short $subject -- 実行コード${executable_total}行 / 対象外${excluded_total}行 (上限${LIMIT}行超過)"
    violations+=("$short $subject -- 実行コード${executable_total}行")
  else
    echo "[OK]   $short $subject -- 実行コード${executable_total}行 / 対象外${excluded_total}行"
  fi
done

echo "---"

# Must-4: 行数とは独立の第2判定。コミット範囲の前後でtests/suite-manifest.jsonを比較し、
# スイート総数 or assertionSignals合計が減っていれば、無届けのテスト削減とみなす。
test_reduction_violation=0
if [ -n "$RESOLVED_BASE" ]; then
  read -r base_suite_count base_assertion_sum <<< "$(suite_manifest_stats "$RESOLVED_BASE")"
  read -r head_suite_count head_assertion_sum <<< "$(suite_manifest_stats "$HEAD")"
  echo "テスト削減チェック: suite総数 ${base_suite_count}→${head_suite_count} / assertionSignals合計 ${base_assertion_sum}→${head_assertion_sum}"
  if [ "$head_suite_count" -lt "$base_suite_count" ] || [ "$head_assertion_sum" -lt "$base_assertion_sum" ]; then
    reduction_reason=$(git log --format=%B "$RANGE" 2>/dev/null \
      | grep -E '^Test-Reduction:' | head -1 | sed -E 's/^Test-Reduction:[[:space:]]*//')
    if [ -n "$reduction_reason" ]; then
      echo "[SKIP] テスト削減を検知 -- Test-Reduction: $reduction_reason"
    else
      echo "[NG]   テスト削減を検知(suite総数 または assertionSignals合計が減少)しましたが、Test-Reductionトレーラーがありません"
      test_reduction_violation=1
    fi
  fi
else
  echo "テスト削減チェック: 比較対象のBASEがないためスキップします。"
fi

echo "---"

if [ "${#violations[@]}" -gt 0 ] || [ "$test_reduction_violation" -eq 1 ]; then
  if [ "${#violations[@]}" -gt 0 ]; then
    echo "FAIL: ${#violations[@]}件のコミットが実行コード${LIMIT}行の原則上限を超えています。"
    echo ""
    echo "超過コミット一覧:"
    for v in "${violations[@]}"; do
      echo "  - $v"
    done
    echo ""
    echo "対応: 関心事を分けられる場合だけ、依存順の小さいコミットへ分割してください。"
    echo "密結合で分割不能な変更は、コミットメッセージ本文に"
    echo "'Size-Exempt: <理由>' トレーラーを付けてください。"
  fi
  if [ "$test_reduction_violation" -eq 1 ]; then
    echo "FAIL: tests/suite-manifest.jsonでスイート総数またはassertionSignals合計が減少していますが、"
    echo "      'Test-Reduction: <移行先スイートと同等性の根拠>' トレーラーが見つかりません。"
  fi
  exit 1
fi

echo "PASS: 全コミットが実行コード${LIMIT}行の原則上限内、かつ無届けのテスト削減もありません。"
exit 0
