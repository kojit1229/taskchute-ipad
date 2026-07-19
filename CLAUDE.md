# CLAUDE.md — TaskChute Journal

このリポジトリ(taskchute-ipad)で Claude Code が作業する際のガイド。
設計思想は `CONCEPT.md`(リポジトリ外)、技術構造は `設計書.md` を参照。

## 協働プロトコル

Codex(レビュアー/実装者。役割判定は AGENTS.md、2026-07-20改訂)との協働は、隣接ディレクトリの別プライベートリポジトリ
`../taskchute-notes` を介して行う(handoff / review / decisions のログを残す)。
`taskchute-notes` は taskchute-ipad と**同じ階層**に clone されている前提。

### 作業開始前
1. `../taskchute-notes/review.md` の**未対応の指摘(`- [ ]`)**を確認する。
2. 未対応の指摘があれば、**新しい実装より先に**対応する。
3. 対応したら該当行を `- [x]` に変え、末尾に対応内容を1行追記する。
   例: `- [x] 指摘内容(severity: high)(対象: app.js) → 正規表現パースに修正 (v55)`

### 実装完了後
`../taskchute-notes/handoff.md` の「# Handoff Log」に、以下のフォーマットで追記する:

```
## <日付 YYYY-MM-DD> / v<バージョン>
- 変更ファイル: <ファイル名(カンマ区切り)>
- 変更意図: <なぜこの変更をしたか>
- 自信がない箇所: <レビューで特に見てほしい不安な点>
- レビュー希望観点: <重点的に確認してほしい観点>
```

### 設計判断
設計上の合意(方針・トレードオフの結論)は `../taskchute-notes/decisions.md` の
「# Design Decisions」に日付付きで追記する。

### notes リポジトリへの反映(重要)
`../taskchute-notes` 配下のファイルを書いたら、**必ず** notes リポジトリ側で
コミット & プッシュまで行う(協働の履歴を残すため):

```bash
git -C ../taskchute-notes add -A
git -C ../taskchute-notes commit -m "docs: <要約>"
git -C ../taskchute-notes push
```

## コミットサイズゲート(v92〜、CI: commit-size-gate.yml)

workspace CLAUDE.md NEVER 1「1コミット(1変更単位)で追加+削除合計200行を超えない」を
CIで機械強制する。`.github/workflows/commit-size-gate.yml`(判定本体は
`.github/workflows/scripts/check-commit-size.sh`)が push / pull_request のたびに
対象範囲内の各コミットの `git show --numstat` 合計行数(バイナリは0行扱い)を調べ、
**マージコミットを除いて**200行を超えるコミットが1つでもあれば CI を fail させる。

- 実装前に、仕様/test/実装/記録を依存順の小さいコミットへ分割してからpushすること。
- 生成物・分割不能な移行など正当な理由で超過がやむを得ない場合のみ、コミットメッセージ本文に
  以下のトレーラーを付けて例外扱いにできる(乱用はレビューで検知する運用。安易な多用は禁止):
  ```
  Size-Exempt: <なぜ分割できないかの理由>
  ```
- ローカルで先に確認したい場合は `bash .github/workflows/scripts/check-commit-size.sh <base> <head>` を
  直接実行できる(第3引数にデフォルトブランチ名を渡すとフォールバックの挙動もCIと同一になる)。

## 補足

- taskchute-ipad 本体の変更手順・規約は `設計書.md` の「9. 規約」を参照
  (`// vNN:` コメント、保存3系統の使い分け、`parseDate()` 必須、SW `CACHE_NAME` の +1 等)。
- テストは `tests/` の E2E スイート(`tests/vNN.test.js`)。push/PR で GitHub Actions が全量実行する。

### テスト実行方針(v60〜、コアセットはv93〜)
- **開発中**: 改修に関連するスイート + 最新スイートだけ実行してよい。
  `node tests/run-all.js v59 v60`(スイート名の一部一致でも可)、または
  `node tests/vNN.test.js` で個別実行。速く回すことを優先する。
- **push前ローカルは `npm run test:core`**(コアセット、目標3分以内)。
- **CI(GitHub Actions)では必ず全量**(`npm test` = `node tests/run-all.js` 引数なし)。
  これが唯一の完全な安全網。push後は必ずGitHub ActionsのCI成功を確認すること
  (test:coreは範囲を絞ったローカル既定であり、全量の代替ではない)。
- `npm run test:quick -- vNN` でも同じ絞り込みができる(`--` の後にスイート名を渡す)。

#### コアセット(`npm run test:core` = `tests/run-core.js`)
push前にローカルで毎回全量(現在40本)を回すと時間がかかるため、「実質的にカバー範囲が広い」
サブセットに絞ったもの。**スイートの削除・スキップ・弱体化ではない**——`npm test`(全量)・CIは無改変。
構成 = 以下を合わせて計10本前後:
- **直近5バージョン**(動的: `tests/`のvNN.test.jsを番号降順で上位5本。新規スイート追加で自動追従)
- **固定の横断コア5本**(選定理由。新しい代表例が出たら随時見直してよい):
  - v72: privacy/同期ゲート(GitHub Contents APIへの移行・起動時ゲート)を唯一直接検証
  - v59: 朝の一括プランニング=下書き(`_scheduleDraft`)機構の代表(承認/却下/確定)
  - v67: `normalizeState`の新フィールド移行を最も広く踏む(後方互換ケース含む)
  - v50: タイムライン上のスケジュール下書きD&D(タイムライン描画+下書き操作の複合)
  - v70: タイムラインカードの実行接点(いま開始/いま終了ボタン)描画

#### ポートのランダム化(v93〜)
各スイートの`PORT`は`tests/helpers.js`の`randomPort()`(20000〜40000のランダム値)を使う。
固定ポートのまま2プロセスが同時に同じ/近いポートでサーバを立てるとEADDRINUSEで偽失敗する
(2ターミナルでの同時実行、CIとローカルpush前ゲートが重なる場合など)ため、実行のたびに
払い出す。各`tests/vNN.test.js`は`const PORT = randomPort();`と書くだけで、
`startServer`/`page.goto`/`page.route`等の使い方は従来どおり(PORTという名前の定数を
参照する構造は変えていない)。
