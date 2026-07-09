# CLAUDE.md — TaskChute Journal

このリポジトリ(taskchute-ipad)で Claude Code が作業する際のガイド。
設計思想は `CONCEPT.md`(リポジトリ外)、技術構造は `設計書.md` を参照。

## 協働プロトコル

Codex(レビュアー)との協働は、隣接ディレクトリの別プライベートリポジトリ
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

## 補足

- taskchute-ipad 本体の変更手順・規約は `設計書.md` の「9. 規約」を参照
  (`// vNN:` コメント、保存3系統の使い分け、`parseDate()` 必須、SW `CACHE_NAME` の +1 等)。
- テストは `tests/` の E2E スイート(`tests/vNN.test.js`)。push/PR で GitHub Actions が全量実行する。

### テスト実行方針(v60〜)
- **開発中**: 改修に関連するスイート + 最新スイートだけ実行してよい。
  `node tests/run-all.js v59 v60`(スイート名の一部一致でも可)、または
  `node tests/vNN.test.js` で個別実行。速く回すことを優先する。
- **push前 / CI(GitHub Actions)では必ず全量**(`npm test` = `node tests/run-all.js` 引数なし)。
  これが唯一の安全網なので、納品前に1回は全量 ALL PASS を確認してからpushする。
- `npm run test:quick -- vNN` でも同じ絞り込みができる(`--` の後にスイート名を渡す)。
