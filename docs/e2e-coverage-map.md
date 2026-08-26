# 12WY §6.2 E2E箇条 ⇔ テスト対応表(v267確定版)

更新: 2026-08-26(v267二系統レビュー修正後)

この表はworkbenchで作成された事前調査を、v266/v267の実テストまで再検算してリポジトリへ永続化した確定版である。

| 判定条件 | 箇条 | 判定 | 根拠(既存/新規) |
|---|---|---|---|
| 1 登録 | numeric/milestoneをフォーム登録しWBSへ表示、構造バリデーション | 固定済み | 既存: `track-crud-core`, `track-core`, `v258`, `v260`。新規連鎖: `v267` 条件1 |
| 2 スコア | manual確定、候補Block完了、COUNTDOWN率/色、免除で分母減、全免除N/A | 固定済み | 既存: `track-commit-core`, `track-core`, `v254`, `v264`, `v266`(全免除N/A)。新規連鎖: `v267` 条件2(実DOM完了、1/2 low、実DOM免除後1/1、全免除N/A) |
| 3 入力 | トースト1タップ、絶対値measurement、WBS更新、同日抑止、7日/8日未更新境界 | 固定済み | 既存: `track-core`, `v262`。新規連鎖: `v267` 条件3(同じ測定の7日側/8日側) |
| 4 同期 | 3コレクションへ5観点、競合3種、全通し往復生存 | 固定済み | 既存: `track-sync-characterization`(5観点×3コレクション+競合3種)。新規連鎖: `v267` 条件4(件数・ID集合・value・trackId/blockId参照を含む全量一致) |
| 追加a | 全完了/開始経路、非interactive、変化なし操作 | 固定済み | 既存: `v254` |
| 追加b | 別週移動、当週取消、週跨ぎ取消 | 固定済み | 既存: `track-commit-core`, `v254` |
| 追加c | 前サイクル排除、carry/supersedes不変、carry初期値 | 固定済み | 既存: `track-commit-core`, `track-crud-core`, `v259` |
| 追加d | 土曜23:59:59→00:00:00、auto候補全件、再確定なし | 固定済み | 既存: `track-commit-core`。新規: `v267`(Asia/Tokyo固定の実app.js境界) |
| 追加e | 重複active決定論、close/carry、source優先、同秒tie、完了済み初期化、中断/中止除外 | 固定済み | 既存: `track-core`, `track-crud-core`, `track-merge-core`, `track-commit-core` |
| 追加f | 12WY未設定、+83/+84境界、OFFでclose、減少目標、done後訂正 | 固定済み | 既存: `track-commit-core`, `track-core`, `track-crud-core`, `v254`, `v258`, `v261`, `v262` |

レビュー前の誤帰属だった「免除で分母減」は、確定シートUIの`v264`だけをCOUNTDOWNの根拠にはしない。COUNTDOWN経路は`v267`の確定済み週に対する実DOM免除操作で直接固定し、`v266`の全免除N/Aも併記した。
