# CHANGES v126

## 概要

K確定仕様(2026-07-19)への仕様変更: 「やりたいこと(Wish)」を、週次選定という特別枠ではなく
**「WBSのProject+Task」**として扱う。やりたいことはタスクと同じものとして扱い、期日を設定すれば
既存のWBS期日駆動フロー(`aiScheduleCandidates` → `effectiveDueDate(t) <= date` → `wbsTaskCompare`
ソート → 15件cap)にそのまま乗り、朝の一括プランニング候補(朝プラン候補)に自然に上がるように
した。v122で作った「今週選定した3件だけを別ルートで合流させる」週次選定ベースの特別スケジュール
ルートは撤去した。Wishタブ(専用の実現/未実現ビュー)とv121のホームカードUI(今週のフォーカス
表示+「今日へ」ボタン、`state.weeklyWishes`)はそのまま存続する。

SW `CACHE_NAME` を v125 → v126 に更新。

## 経緯

v122は「今週やりたいことを3件選ぶ」週次選定(v121)を、`state.weeklyWishes`という別データ構造から
`aiScheduleCandidates`へ特別合流させ、`fallbackMorningPlan`のrankにも専用の2段目
(`note === "今週のやりたいこと"`)を追加する形で朝プランに載せていた。運用してみると、
「やりたいことは元々タスクと同じはずなのに、なぜ週次選定という別ゲートを通さないと
スケジュールに乗らないのか」という設計上の違和感があり、K指示により「Wishも期日を持てる
タスクである」という原則に立ち返って作り直した。週次選定(state.weeklyWishes)自体は
「今週フォーカスしたいものを手動で意識づける」UIとして引き続き価値があるため、そちらは
残しつつ、スケジュールへの自動合流機構だけを撤去した。

## 修正内容

### 1. WBS表示(`renderWBS`)

v16の「Wish Projectは専用「やりたい」タブで表示するためWBSから除外する」フィルタを撤去し、
やりたいことProject(kind:"wish"、常に1つだけ存在)を通常Projectと同列でWBSの一覧に表示する。
`renderProjectTree`/`renderTaskTree`はkindを問わない汎用実装のため変更不要で、インライン編集
モード(期限/状態/カテゴリ)もそのまま効く。

これに伴い、Wishが一覧に表示されるようになったことと整合させるため2箇所を追加修正した:

- 中断件数バッジ(`suspCount`)からWishタスクを除外する特別扱いを撤去
  (除外したままだと、表示されているWishの中断タスクがバッジ件数に反映されない不整合になる)。
- 「すべて展開/折りたたむ」(`wbs-collapse-all`)の対象からWishだけを除く特別扱いを撤去
  (除外したままだと、Wish Projectだけ一括開閉ボタンが効かない不整合になる)。

Wishタブ自体(`renderWish`、`view === "wish"`のルーティング)は無変更。

### 2. 朝プラン候補フロー(`aiScheduleCandidates`)

「全Wish除外」を「期日なしWishのみ除外」へ変更した。期日を持つWishタスクは、以降の
`effectiveDueDate(t) <= date`フィルタ・`wbsTaskCompare`ソート・15件capに通常のWBSタスクと
完全に同じ条件で乗る。特別なrank・noteは一切付けない(候補オブジェクトの形は通常WBSタスクと
区別できない)。

期日なしWishは引き続き候補から除外する。通常のWBSタスクは「期日なし=filler」として
(空いた枠があれば埋める要員として)候補に残す設計だが、この扱いをWishには適用しない。
Wishは60件を超えて未着手のまま溜まる運用実態があり、期日なしWishまでfillerとして朝プランに
含めると候補が溢れて収拾がつかなくなるため、意図的にWBSタスクと差をつけている。

### 3. v122特別ルートの撤去

- `aiScheduleCandidates`内の週次選定(`state.weeklyWishes`)合流ブロックを削除。
- `fallbackMorningPlan`の`rank`関数を、v122で追加した2段目
  (`note === "今週のやりたいこと"`)を削除し、`MIT=0 → 繰越=1 → WBS(Wish含む)=2`の
  3段階へ戻した。
- `runAiMorningPlan`のaiPlan採用ブランチにあった「バッチ生成AIプランが知らない週次選定Wishを
  残り空き時間へ追記合流する」ブロックを削除。これに伴い、このブロックからしか呼ばれていなかった
  `subtractBusyFromGaps`ユーティリティ関数も未使用になったため削除した。

`state.weeklyWishes`のデータ構造・保存/読込・マージ処理(`mergeWeeklyWishMaps`等)、v121の
UI(ホームの赤帯アラート、選定モーダル、ホームカード、`weekly-wish-*`系のdata-action)は
一切変更していない。ホームカードは「今週のフォーカス表示+ワンタップで今日へ」という
手動登録の役割として引き続き機能する(`wishSubtaskToTasks`の再利用は無変更)。

## Wish除外箇所の監査(app.js内 `kind === "wish"` 全箇所)

「期日付きWishはタスクと同じ」という原則で、各箇所を判断した。

| 行(目安) | 内容 | 判断 | 理由 |
|---|---|---|---|
| `normalizeState`(既定Wish Projectの自動作成) | Wish Projectのコンテナ自体が無ければ作る | 変更なし | 除外フィルタではなく、Wishの入れ物自体を保証する処理 |
| `initialState`(初期state) | 初期データにWish Projectを含める | 変更なし | 同上 |
| `renderWBS`のactiveProjects | WBS一覧からWish除外 | **解除** | 本仕様変更の本体(要件1) |
| `renderWBS`のsuspCount | 中断件数からWish配下タスクを除外 | **解除** | Wishが一覧表示されるようになったことに伴う整合性の修正 |
| `wbs-collapse-all`アクション | 一括開閉の対象からWishを除外 | **解除** | 同上 |
| `homeBacklog`(ホーム「未完了タスク」) | 除外Project一覧にwish/otherを含める | **wishのみ解除**(otherは維持) | 元々`t.dueDate`必須の期日つき一覧のため、期日を持つWishだけが自然に混ざるようになる |
| `aiScheduleCandidates`のwishIds | 全Wishを候補から除外 | **「期日なしのみ除外」へ変更** | 本仕様変更の本体(要件2) |
| `getWishProject()` | Wish Projectを1件検索して返すヘルパー | 変更なし | 除外フィルタではなく参照取得 |
| `renderProjectTree`のbadge表示 | kindに応じて「Wish」/「Project」ラベルを出し分け | 変更なし | 除外ではなくラベル表示。Wishが一覧に出るようになった今もそのまま有用 |
| `renderOpenTasks`(WBSの「未完了Task」一覧) | Wish配下タスクを除外(`wishProjectIds`) | **解除** | 本仕様変更の本体(要件4で明示指定)。元々`Boolean(task.dueDate)`必須のため期日なしWishは従来どおり出ない |
| `generateReport`の12WY進捗集計 | Wish Projectを12週プロジェクト進捗の集計対象から除外 | 変更なし | 日報生成の「進んだこと」セクション分け(12WYプロジェクト進捗 vs 進んだWish)の話であり、スケジュール/WBS表示とは無関係。Wishのサブタスク完了は引き続き別枠の「進んだWish」セクションで報告する方が意味的に正しい |
| `generateReport`のwishProgress集計 | 完了サブタスクの親がWish配下かどうかの判定 | 変更なし | 同上のペア処理 |
| `effectiveDueDate`のコメント | 「Wishタブの描画コードからは呼ばない」という注記 | 変更なし | 関数自体はkind非依存の汎用実装。この注記は今も事実(Wishタブ自体のレンダリングは呼ばない。呼ぶのは`aiScheduleCandidates`等スケジュール側) |
| Project編集モーダルのkind選択肢(`<option value="wish">`) | Project作成/編集時にWish種別を選べる | 変更なし | Wish Project自体の種別選択UIであり除外ロジックではない |

## 変更ファイル

- `app.js`
  - `renderWBS()`: Wish除外フィルタを撤去、中断件数・一括開閉のWish特別扱いを撤去
  - `aiScheduleCandidates()`: Wish除外を「期日なしのみ」へ変更、v122週次合流ブロックを削除
  - `fallbackMorningPlan()`: rankを3段階へ戻す
  - `runAiMorningPlan()`: aiPlan採用ブランチの週次Wish合流ブロックを削除
  - `subtractBusyFromGaps()`: 未使用になったため削除
  - `homeBacklog()`: 除外対象からWishを外す(otherは維持)
  - `renderOpenTasks()`: Wish除外(`wishProjectIds`)を撤去
  - `wbs-collapse-all`アクション: Wish特別扱いを撤去
- `sw.js`: `CACHE_NAME` を `v126` に更新
- `tests/v126.test.js`: 新規(WBS表示・期日付きWishの朝プラン合流・期日なしWishの除外・
  ホームカード「今日へ」の回帰を検証)
- `tests/v122.test.js`: v126の仕様変更に合わせて更新。撤去した週次合流・note-rank・
  AIプランmergeを検証する内容(旧(a)(b)(d)(e)(f)(g))を、「週次選定しただけ(期日なし)の
  Wishは自動では合流しない」ことを確認する内容へ反転した。ホームカード「今日へ」の検証
  (旧(c))はそのまま維持している。テストの削除・弱体化ではなく、撤去した機能に対応する
  正当な更新である。

## 不可侵の制約の遵守確認

- Wishタブ(`renderWish`)・`state.weeklyWishes`の同期マージ(`mergeWeeklyWishMaps`)・
  v121のUI(選定モーダル・ホームカード・赤帯・「今日へ」ボタン)は無変更。
- `new Date("文字列")`は使っていない(既存の`addDays`/`effectiveDueDate`等の文字列ベース
  ヘルパーをそのまま再利用)。
- 16pxルール対象(input/select/textarea)の新規追加なし。
- `data-action`デリゲーション一本の既存方針を踏襲(新規アクションは追加していない)。
- v122テスト以外の既存テストは無改変。

## 検証結果

- `node --check app.js` / `node --check sw.js`: exit 0
- `node tests/run-all.js v121 v122 v126`: **ALL PASS**
- `node tests/run-all.js v59 v60 v62 v77`: **ALL PASS**
- `node tests/run-core.js`(直近5件: v126/v125/v124/v123/v122 + 固定横断コア5件:
  v72/v59/v67/v50/v70、計10本): **ALL PASS**(所要時間 約120s)

## 未対応・懸念点

- `npm test`(全量スイート)はローカルで未実行(コアセット+指定スイートのみ確認)。pushして
  CI(GitHub Actions)での全量成功確認が必要。
- v122.test.jsは「機能の反転検証」という性質上、旧テストと同じくAIプランJSONのfetchモック
  (`page.route`)を再利用しているが、モックする対象JSON自体の構造は変えていない。

## 追補(v127レビュー対応、Codex/reviewer指摘)

v126のレビューで、要件1(WBS一覧でのWish Project露出)に伴う副作用の指摘が2件(Codex P1/P2)、
撤去済み機能に対する説明コメントの残存が1件(reviewer low)出たため、以下を追加修正した。
HEADは`a98f737`(v127コミット済み)。sw.jsの`CACHE_NAME`はv127のままバンプしていない
(v126実装への追補修正のため、新規デプロイ単位を増やさない判断)。

### 指摘1(Codex P1): Wish Projectの削除・種別変更に対する保護が無かった

要件1でWish Project(kind:"wish"、常に1つだけ存在するシングルトン)がWBS一覧に通常Projectと
同列で表示されるようになった結果、`renderProjectTree`/`buildProjectModal`という汎用UIを
経由して、このシングルトンを削除したり種別を"wish"から変更したりできてしまっていた。
`getWishProject()`は`state.projects.find((p) => p.kind === "wish" && !p.deleted)`で
1件だけを前提に参照するため、削除・種別変更されると参照が見つからなくなり、
`normalizeState`が新しい空のWish Projectを再生成してしまう。既存のWishタスクは
旧`projectId`のまま残り、Wishタブから見えなくなる(データ消失ではないが実質的に迷子になる)。

対処として二重防御を入れた:

- **UI層**: `buildProjectModal(project)`で`project.kind === "wish"`の場合、
  (a) フッターの「削除」ボタン(`data-action="modal-delete"`)自体を出さない、
  (b) 種別プルダウン(`data-modal-field="kind"`)に`disabled`属性を付け、固定である旨の
  補助テキストを添える。
- **関数層**: `deleteProject(id)`の先頭で対象が`kind === "wish"`ならトースト
  (「「Wish」はやりたいことの保存先のため削除できません」)を出して処理を中断する。
  `saveProjectFromModal(id, fields)`でも、保存直前の元projectが`kind === "wish"`なら
  `fields.kind`の値に関わらず`kind`を`"wish"`に固定する(disabled selectのDOM改変等を
  経由した変更への最終防波堤)。UIを迂回して`data-action="delete-project"`を直接発火させても
  拒否されることをテストで確認済み。

### 指摘2(Codex P2): Wish Project配下の新規タスクに当日期日が既定で付いていた

`addWish()`/`addWishSubtask()`は元々(v79)、`makeTask()`の既定期日(未指定時は
`state.selectedDate`=当日)をWishには持ち込まないよう、作成直後に`task.dueDate = ""`へ
明示的に戻していた。しかし要件4でWBS経由の汎用タスク作成経路(`addTask()`・
`addTaskToProject()`→`openTaskCreator()`、いずれも`makeTask()`を共有)がこのガードを
素通りしていたため、WBS上でWish Project配下に「+ タスク」で新規作成すると当日期日が
即座に付いてしまい、`addWish`系との挙動不一致に加え、要件2で追加した「期日付きWishは
候補に入る」フローに意図せず載ってバックログ・朝プラン候補へ混入する問題があった。

対処として`makeTask()`自体を修正: `projectId`が指す先が`kind === "wish"`のProjectで、
かつ呼び出し元から明示的な`dueDate`引数が渡されていない場合は、期日を`state.selectedDate`へ
既定せず空のままにする(`dueDate: dueDate || (isWishProject ? "" : state.selectedDate)`)。
これにより`addTask()`の即時作成、`openTaskCreator()`が組み立てるモーダル用stub(編集
モーダルの期限入力欄も空で開く)、`saveTaskFromModal()`経由の保存のいずれもWish配下では
期日が空になる。ユーザーが編集モーダルで明示的に期日を入力した場合はその値がそのまま
採用される(`fields.dueDate || ""`が優先されるため、既定側のロジックには落ちない)。
`addWish()`/`addWishSubtask()`側の明示的な`dueDate = ""`上書きは冗長になったが、
意図を明示するコメントとして残し、削除はしていない。

### 指摘3(reviewer low): 撤去済み「今週のやりたいこと」段の残存コメント

`runAiSchedule()`直前(旧: 3653行付近)と`fallbackMorningPlan()`直前(旧: 3911行付近)の
優先順コメントが、v126で撤去したv122の4段階rank(`MIT→繰越→今週のやりたいこと→WBS`)の
ままになっており、実コード(3段階: `MIT→繰越→WBS`、Wishは期日付きならWBS段に含まれる)と
食い違っていた。両コメントを実コードに合わせて更新した(「WBS(期日付きWish含む)」という
表現に統一し、v126で専用段を撤去した旨を明記)。

## 変更ファイル(追補分)

- `app.js`
  - `deleteProject()`: Wish Project(kind:"wish")の削除を拒否するガードを追加
  - `buildProjectModal()`: Wish Projectでは削除ボタンを出さず、種別プルダウンをdisabled化
  - `saveProjectFromModal()`: 元projectがkind:"wish"ならkindを保存時にも固定
  - `makeTask()`: Wish Project配下では期日の既定補完(当日日付)をしない
  - `runAiSchedule()`直前・`fallbackMorningPlan()`直前のコメントを実コードに合わせて更新
- `tests/v126.test.js`: 既存チェックは無改変のまま、[1b](削除ボタン非表示+削除ガード+
  種別ロック)・[1c](Wish Project配下の新規タスク作成で期日が空になる)を追加
- `sw.js`: 変更なし(`CACHE_NAME`はv127のまま)

## 追補分の検証結果

- `node --check app.js`: exit 0
- `node tests/run-all.js v126 v122 v121`: **ALL PASS**(v126: [1][1b][1c][2][3]すべて✅、
  既存の[1][2][3]チェックは無改変のまま通過)
