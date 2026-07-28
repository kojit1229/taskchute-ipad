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
v164以降は `releases/vNNN.json` を唯一の手書き記録とし、次を実行して
`CHANGES_vNNN.md` と `../taskchute-notes/handoff.md` を生成する:

```bash
node scripts/release-record.js releases/vNNN.json --write
node scripts/release-record.js releases/vNNN.json --check
```

生成物を手で直さない。内容を変える場合はJSONを直して再生成する。v163以前の既存記録は
従来形式のまま保持し、移行・再生成しない。

### 設計判断
設計上の合意(方針・トレードオフの結論)は `../taskchute-notes/decisions.md` の
「# Design Decisions」に日付付きで追記する。

### notes リポジトリへの反映(重要)
`../taskchute-notes` 配下のファイルを書いたら、Kの明示承認後にnotesリポジトリ側で
コミット & プッシュまで行う(協働の履歴を残すため)。承認前は未コミットで残す:

```bash
git -C ../taskchute-notes add -A
git -C ../taskchute-notes commit -m "docs: <要約>"
git -C ../taskchute-notes push
```

## コミットサイズゲート(CI: commit-size-gate.yml)

workspace CLAUDE.md NEVER 1に従い、1コミットの**実行コード差分**を原則200行以下にする。
`.github/workflows/scripts/check-commit-size.sh` はテスト・Markdown・release記録・生成物を
数値対象から除外し、実行コードだけを判定する。対象外ファイルもレビューと検証は省略しない。

- 関心事が独立する実装は依存順の小さいコミットへ分ける。
- 密結合な変更を動かない途中状態へ機械分割しない。分割不能な実行コード変更のみ、本文に
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

### 並列開発
- 主担当は仕様・依存関係・統合を保持し、独立領域を最大3サブエージェントへ並列委譲してよい。
- 着手前に担当ファイルと完了条件を固定する。書き込み担当はworktreeを分離し、同一ファイルへの
  書き込みは1エージェントだけにする。共有worktreeでは実装者を1人に限定する。
- `app.js`を複数実装者が同時編集してはならない。他の並列枠は影響調査、テスト作成、
  固定wait調査、読み取り専用レビューへ割り当てる。
- 同期・保存・日付・migration・iOS固有処理は直列実装し、別エージェントが独立レビューする。
- 各担当はcommit/pushせず、主担当が`git status --short`と`git diff`で実体を確認して統合する。

### テスト実行方針(v60〜、コアセットはv93〜)
- `app.js`を変更したら`npm run code:index:write`、テストを追加/変更したら
  `npm run test:manifest:write`を実行してからコミットする(生成物のsourceHash/行番号を
  最新化する。実行し忘れても`npm test`は警告に留めて続行するが、pushするなら最新化しておくこと)。
- **開発中**: 改修に関連するスイート + 最新スイートだけ実行してよい。
  `node tests/run-all.js v59 v60`(スイート名の一部一致でも可)、または
  `node tests/vNN.test.js` で個別実行。速く回すことを優先する。
- **レビュー修正がすべて終わった後**: push前ローカルの最終ゲートとして
  `npm run test:core`を1回だけ実行する。最終core後に実行コード・共有helperを直した場合だけ、
  関連スイート→coreを再実行する。文書・release記録だけの修正ではcoreを繰り返さない。
- v164以降は開発中に
  開発中は`node scripts/release-gate.js releases/vNNN.json --suite=vNNN`、
  最終時は`node scripts/release-gate.js releases/vNNN.json --final`として検証順を一本化する。
- **CI(GitHub Actions)では4シャードの和集合で必ず全量**(`npm test -- --shard=N/4`)。
  これが唯一の完全な安全網。push後は必ずGitHub ActionsのCI成功を確認すること
  (test:coreは範囲を絞ったローカル既定であり、全量の代替ではない)。
- `npm run test:quick -- vNN` でも同じ絞り込みができる(`--` の後にスイート名を渡す)。
- `npm run test:fast`はブラウザ不要の高速Nodeテスト、`npm run test:smoke`は重要導線、
  `npm run test:e2e`は全ブラウザE2Eを実行する。fast-nodeとdomain-e2eの和集合は
  `npm test`全量と一致し、smokeはdomain-e2eの部分集合であることを
  `tests/run-all-options.test.js`で検証する。
- `--workers=N`は独立スイートのrunner内並列化。既定は1、最大8。まずfast-nodeだけ2並列で使い、
  ブラウザE2Eは計測と副作用監査が済むまでCI 4シャードによる並列化だけを使う。

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

#### ポートのランダム化(v93〜、単一run内の衝突防止をv137で追加、並行run間の衝突防止をv140で追加)
各スイートの`PORT`は`tests/helpers.js`の`randomPort()`(20000〜40000のランダム値)を使う。
固定ポートのまま2プロセスが同時に同じ/近いポートでサーバを立てるとEADDRINUSEで偽失敗する
(2ターミナルでの同時実行、CIとローカルpush前ゲートが重なる場合など)ため、実行のたびに
払い出す。各`tests/vNN.test.js`は`const PORT = randomPort();`と書くだけで、
`startServer`/`page.goto`/`page.route`等の使い方は従来どおり(PORTという名前の定数を
参照する構造は変えていない)。

**単一run内でも衝突しうることが判明(2026-07-22、CI run 29877100127でv58.test.jsが実際に
EADDRINUSEでクラッシュ)**: `npm test`(全量、88スイート前後)を1回のnpm testで連続実行すると、
異なるスイートが独立に同じ乱数を引く確率が誕生日のパラドックスにより無視できない大きさになる
(1runあたり約17%)。`run-all.js`は逐次実行(前のスイートが完全終了するまで次を起動しない)
であり、タイムアウト/kill処理も発生していなかったことをCIログで確認済みのため、`run-all.js`
自体の並行実行バグではない。「先発が完全終了していれば同じport番号を後発が引いても衝突しない
はず」という理論(sequential実行なら本来矛盾しないはず)に反する実例が観測されており、根本原因
(OS側のTIME_WAIT相当の一過性状態が有力な仮説だが断定はできていない)は完全には特定できて
いない。**対策(v137で導入、原因を問わず単一run内の衝突を数学的にゼロにする設計)**:
`run-all.js`が各スイートへ環境変数`TEST_PORT_INDEX`(実行リスト内のindex)を渡し、
`randomPort()`はそれがあればスイートごとの専用帯(1スイートあたり10番、`20000 + index*10`)
から決定論的に採番する(帯を跨がないため他スイートと絶対に重複しない)。`TEST_PORT_INDEX`が
無い場合(`node tests/vNN.test.js`の単独実行等)は従来どおり完全ランダム。加えて
`tests/helpers.js`の`startServer()`にEADDRINUSE時の同一portへの軽いリトライ(最大5回、
300ms刻みのバックオフ)を追加し、上記の帯分離だけでは防げない別要因(外部プロセス等)への
保険とした。リトライを使い果たした場合は従来どおり例外を投げてクラッシュする(フェイルラウドの
原則は維持、検証内容の弱体化ではない)。

**並行run間ではv137時点でも退行していた(2026-07-22、Codexレビュー Med-4)**: v137の帯
(`20000 + index*10`)は`run-all.js`の起動ごとに常に同じ基底(20000)から割り当てていたため、
v93が本来防ぎたかったシナリオ(2ターミナルでの同時実行、CIとローカルpush前ゲートが重なる等)
に対しては未対応のままだった(並行して動く2つの`run-all.js`は同じport帯を使い、依然として
衝突しうる)。**対策(v140で追加)**: `run-all.js`が起動ごとにランダムな基底
(20000〜38000の1000刻み、19通り)を選び、環境変数`TEST_PORT_BASE`としてスイートへ渡す。
`randomPort()`は`TEST_PORT_BASE + index*10`で採番する(`TEST_PORT_BASE`が無ければ従来どおり
基底20000)。並行run同士が偶然同じ基底を引く確率は1/19以下に下がり、それでも衝突すれば
`startServer()`のEADDRINUSEリトライ(v137で追加済み)で自己回復する。単一run内の衝突は
同じ基底を共有する限り従来どおり数学的にゼロのまま。
