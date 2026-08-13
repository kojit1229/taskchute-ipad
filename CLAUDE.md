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
- 各担当へ渡すのは必要なファイル・関数・行範囲だけとし、`app.js`全文の重複読込を避ける。
  長い調査結果はファイルへ保存し、主担当には結論・根拠行・パスだけを返す。

### 実装前レビューと複数機能の進め方
- 実装前に10〜15分で、操作導線、日付境界、同期/state、失敗・再試行・オフライン時、
  390/768/1024px、iOS PWA・日本語IME、関連テスト、非目標を確認する。
- `docs/code-index.generated.md`と`docs/test-impact-map.generated.md`で変更波及と関連スイートを
  先に特定し、characterization testが不足する高リスク箇所は実装より先に現挙動を固定する。
- 複数機能は全体仕様・依存関係・ファイル所有を最初に1回レビューし、各機能の実装直後に
  軽量レビューしてから次へ進む。全機能の統合後に統合レビュー、最終core、CI全量を各1回行い、
  まとめて1リリースする。
- 同期・保存・日付・migration・iOS固有処理は各機能でもClaude/Codexの二系統レビューを通す。
  表示専用等は各機能で一系統、最終統合時に二系統とする。

### 段階分割の恒久契約
- `app.js`は起動・依存注入・全体統合へ縮小する。単なる行移動ではなく、各モジュールに
  明示的な入出力と副作用境界を作る。
- 分割前に候補をP0〜P2で順位付けし、呼び出し元、state入出力、I/O、関連E2E、
  必要なcharacterization testをセットで記録する。無関係なスパゲッティ箇所を便乗修正しない。
- `state`の再代入は`src/state/store.js`の`setState()`経由だけにする。他モジュールは
  live bindingを読み取り、必要なプロパティ変更だけを行う。
- `src/core/**`は`state`や`src/state/store.js`をimportしない純粋な依存グラフの葉にする。
  `src/**`から`app.js`をimportせず、必要な依存は`configureXxx()`等で注入して循環依存を防ぐ。
- 抽出は原則として、純粋関数 → 読み取り専用feature → storage/sync gateway →
  残りのfeature render → event dispatcherの順に行う。同期、`normalizeState()`、`saveState()`は
  現挙動と失敗時契約をテストで固定せず機械的に分割しない。
- 同期・mergeを変える際は、一次データを含む全state領域が「比較・merge・明示的除外」の
  どれかに分類されていることを確認する。リモート取得・JSON検証・mergeが曖昧ならfail-closeとし、
  ローカル全量で上書きしない。
- ビルド工程なしのESMを維持する。`src/**/*.js`を追加したら`sw.js`の`APP_SHELL`へ追加し、
  `CACHE_NAME`を+1する。release gate、SW統合テスト、iOS実機PWAの更新・オフライン確認まで行う。

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
- v164以降の開発中は
  `node scripts/release-gate.js releases/vNNN.json [--suite=<追加対象>]`を使う。
  release番号のテストと、実行差分から選ばれる高速Node baseline・領域別回帰束は自動で加算される。
  選定規則は`tests/impact-regression-map.json`を正本とし、CIを最初の回帰検出場所にしない。
  最終時は`node scripts/release-gate.js releases/vNNN.json --final [--suite=<追加対象>]`として
  重要導線smoke・自動回帰束・追加対象→coreの検証順を一本化する。core重複分は自動除外する。
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
- 既存スイート・assertionは、移行先との対応と同等以上の検証を確認するまで削除・skip・弱体化
  しない。意図した削減でも`Test-Reduction: <移行先と同等性の根拠>`をコミット本文へ記載し、
  独立レビューを通す。速度を理由にした削減は禁止する。
- 固定時間そのものが仕様でない限り、新しい`waitForTimeout`を追加しない。selector、DOM状態、
  state、network response、Playwright clock等、検証対象の成立を待つ。既存固定waitは
  assertionを維持したまま待機時間上位から段階的に置き換える。

#### コアセット(`npm run test:core` = `tests/run-core.js`)
push前にローカルで毎回全量を回すと時間がかかるため、「実質的にカバー範囲が広い」
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
(20000〜62000の2000刻み、22通り)を選び、環境変数`TEST_PORT_BASE`としてスイートへ渡す。
`randomPort()`は`TEST_PORT_BASE + index*10`で採番する(`TEST_PORT_BASE`が無ければ従来どおり
基底20000)。最大200スイートまで隣接基底の帯は重ならない。並行run同士が偶然同じ基底を
引く確率は1/22以下に下がり、それでも衝突すれば
`startServer()`のEADDRINUSEリトライ(v137で追加済み)で自己回復する。単一run内の衝突は
同じ基底を共有する限り従来どおり数学的にゼロのまま。
