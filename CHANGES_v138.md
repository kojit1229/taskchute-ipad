# v138 AIレポート履歴のindex JSON化(review.md:31、K承認済み2026-07-22)

`../taskchute-notes/review.md` 未対応指摘のうち実装可能な9件を4ラウンドに分けて解消する
作業の第2ラウンド。AIレポートビューアの履歴一覧取得を、GitHub Contents APIのディレクトリ
一覧直叩き(1ディレクトリ1000件の公式上限に日報等の日次蓄積で近づくリスクがある)から、
loop側の決定論バッチが生成する索引JSONを優先するfetch方式へ切り替える。

## 背景

`renderAiReportBody` → `aiReportFilesForType(prefix)` → `_aiReportDirCache` の経路は、
`personal-data/taskchute/` 直下を1回のGitHub Contents APIで一覧取得していた。このAPIは
1ディレクトリあたり1000件が公式上限で、日報_*.md / AIフィードバック_*.md / AIプラン_*.json /
AI作業結果_*.json 等が日次で積み上がる運用では、将来この上限に近づき一覧の一部が
欠落しうる(review.md:31)。

## loop側(監督者コミット待ち。本ラウンドではコミットしていない)

- **新規**: `loop/scripts/report-index-build.py`(130行、決定論・claude不使用)。
  `personal-data/taskchute/` 直下(非再帰)のファイル一覧を読み、
  `{generatedAt, files:[{name,date,kind}]}`(date降順)のJSONを生成する。kindはファイル名
  prefixで分類(journal/feedback/weekly/content/self/health/batch/english/other)。
  合成ディレクトリ(14ファイル、日報・AIフィードバック・週次レビュー・コンテンツ総括×2・
  自己分析・基盤ヘルス・バッチ実行サマリ・英語表現集・AIプラン/AI作業結果json・
  app-state.json・サブディレクトリ2つ)で手動実行し、想定どおりの分類・ソート・
  サブディレクトリ除外を確認した。
- **変更**: `loop/coach-daily.sh`(+47行)。`push_feedback_to_personal_data()`と同じ作法の
  `rebuild_report_index()` を新設し、その日の新規AIフィードバックがtaskchute/直下へ
  反映された直後(`push_feedback_to_personal_data`呼び出しの直後)に呼ぶ。dry-run時は
  coach-daily.sh自体がこの手前で早期exitするため到達しない(=個人データrepoへは一切触れない)。
  失敗しても非致命(索引の鮮度が最大1日遅れるだけで、アプリ側フォールバックにより動作継続)。
- **変更**: `loop/FORMAT_CONTRACT.md`(+42行)。「report-index.jsonの契約」節を新設し、
  書き手・スキーマ・読み手・kind分類の追随ルールを記載。
- 依頼書の指示どおり、これら loop/ 配下3ファイルの変更は**コミットしていない**
  (監督者がレビューの上コミットする)。差分は上記のとおり。

## アプリ側(taskchute-ipad、本ラウンドでcommit&push)

- `fetchReportIndex()`(app.js新設): `report-index.json` を `fetchGitHubRawResult` で取得し、
  成功すれば `_aiReportDirCache` へ `{name,type:"file"}` 配列として変換して格納する。
  404(未生成環境)やJSON不正の場合は `false` を返す。
- `triggerAiReportDirLoad()` を2段構成に変更: まず `fetchReportIndex()` を試し、失敗すれば
  従来の `fetchPersonalDataDirList()`(Contents APIディレクトリ一覧)へフォールバックする。
- `aiReportFilesForType()` 自体は無改変(`_aiReportDirCache` の内部形状をどちらの取得元でも
  揃えたため、ファイル名からのprefix/日付抽出ロジックはソースに依存しない)。
- `refreshAiReports()`(「一覧を更新」ボタン)も無改変で、`_aiReportDirCache` を `null` に
  戻すだけで次回描画時に2段フェッチが再実行される(index復活の検知も自然に効く)。

## テスト

`tests/v138.test.js`(E2E、3シナリオ): [1]report-index.json存在時はそれだけで履歴一覧が
構築されディレクトリ一覧APIは1回も飛ばない、[2]report-index.json不在(404)時は従来の
ディレクトリ一覧APIへフォールバックし同じ結果になる、[3]「一覧を更新」後にindexが
復活していれば次はindex経由に切り替わる(手動更新のたびに2段判定をやり直す)。

回帰: `node tests/run-all.js v138 v92 v137 v79 v56 v72` ALL PASS。`npm test`(全量)は
push前に別途実行して確認する。

## 自信がない箇所

- report-index.jsonの「その日の新着分の反映タイミング」は`push_feedback_to_personal_data`の
  直後(coach-daily.sh内)にした。依頼書の「personal-dataへのpush直前」という文言とは順序が
  逆だが、直前だとその日新規生成したAIフィードバック自身がまだtaskchute/直下にコピーされて
  おらず索引から漏れる(翌日まで反映されない)ため、鮮度を優先してあえて直後にした
  (../taskchute-notes/handoff.mdに理由を記載)。
- `report-index-build.py`の合成ディレクトリ手動実行はローカル(Windows)のみ。coach-daily.sh
  への実際の組み込み(cron実行)は監督者コミット後、次回の実運転(翌朝05:00台)で初めて
  実地確認できる。
