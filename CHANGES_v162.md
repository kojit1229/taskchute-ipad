# v162 「未完了理由クイック入力」

K裁定b案(2026-07-28、`../taskchute-notes/decisions.md`「2026-07-28 言い訳ハンターの入力源」)の実装。
v160「言い訳ハンター」の代理指標(やり残し×コメントの交差抽出)が実データ検証で精度0/2だったため
不採用となり、代わりにアプリ本体に未完了理由のクイック入力を新設し、それを日報の専用欄へ出力する
方式へ切り替えた。

## 背景・入口

理由チップ(疲労/時間切れ/気分が乗らない/割り込み/見積り過大/その他)+ 任意ひと言を、以下の
2箇所から記録できる。どちらもスキップ可能(必須入力にしない=罰なし)。

1. **仕分けモードの「手放す/延期」実行直後**(既存v152/v154/v156)。
2. **日次締め**(「日報を生成」ボタン押下時、当日を見ていて理由未記録の未完了Blockが残っている場合)。

## データモデル(app.js)

- `block.incompleteReason = { chip, note, at } | null` を Block の新フィールドとして追加
  (`makeBlock()` / `normalizeState()` 両方に既定値 `null` を補完)。
- `normalizeState()` は壊れた形状(`chip` 欠落等)も `null` へ正規化する(既存の正しい値は保持)。
- 既存の `updatedAt` 同期機構にそのまま乗るため、専用のマイグレーションフラグは追加していない。

## 入口1: 仕分けモードのインライン理由チップ欄

**設計上の重要な判断**: 当初は「Undoトースト(5秒)のタップを妨げないよう、5.3秒待ってから
全画面モーダルで尋ねる」案で実装したが、実装・テスト段階で2つの問題が判明し、**モーダルではなく
インライン(非モーダル)の理由チップ欄**へ設計変更した。

- **問題1(実測で発覚)**: `setTimeout`ベースの遅延は、既存のtriage E2Eスイート
  (`tests/v152.test.js` / `v154.test.js`)のように1ページセッション内で連続して複数の
  手放す/延期を行うテスト・実運用フローで、Playwrightの実クリック待機等の累積時間が5.3秒を
  超えると「間に合わずタイマーが発火し、無関係な操作中に突然フルスクリーンモーダルが被さって
  後続のクリックをブロックする」事故が実際に再現した(単一タイマー方式で直近1件に絞る対策を
  入れても、操作間隔が空くケースでは防げない)。
- **問題2(設計上の根本問題)**: 全画面モーダル(`.modal-root`、z-index:10050)はUndoトースト
  (z-index:10001)より上に来るため、たとえ表示タイミングをずらしても表示中はUndoトーストを
  完全に覆ってタップ不能にしてしまう。

このため、`triageAction()`の「手放す/延期」(kind:"block")が成立した直後に
`_pendingInlineReason = { blockId }`をセットし、`renderWishTriage()`が
仕分けカードの下に控えめな`<section class="triage-inline-reason">`を**即座に**(遅延なしで)
描く方式にした。Undoトーストと同じ画面領域に同時に表示され、互いのタップを妨げない。

- チップをタップすると`incompleteReason`を記録し、`_pendingInlineReason`をnullに戻して
  欄を引っ込める。**このときsaveAndRender()で新しいトーストは出さない**(saveState()+render()
  のみ)。理由: saveAndRender()でトーストを出すと直前の「手放す/延期」のUndoトースト
  (`triageUndoToastOpts`、5秒間有効)を上書きし、「元に戻す」ボタンごと消してしまう事故が
  実装中に発覚したため(理由記録はUndo対象の一部であり続けるべきで、Undoの生存期間に
  一切触れないようにした)。
- 「スキップ」ボタンも同様に記録せず`render()`のみで欄を引っ込める。
- `triageUndo()`のrevertクロージャ(手放す/延期それぞれ)で、`_pendingInlineReason`が同じ
  blockIdを指していればnull化する(Undoされた行動の理由を今さら尋ねない)。**理由を記録した
  「後」でUndoされた場合も**、revertがBlock全体を`blockSnapshot`(記録前の状態)へ丸ごと
  差し替えるため、`incompleteReason`も自動的に元(null)へ戻る(v156のUndo契約どおり)。

## 入口2: 日次締めモーダル

「日報を生成」(`data-action="generate-report"`)クリック時、`state.selectedDate === todayISO()`
かつ理由未記録(`!hasIncompleteReason(b)`)の未完了Blockが1件以上あれば、`generateReport()`を
直接呼ばず先に`openIncompleteReasonModal(ids, "dailyClose")`を開く。こちらはUndoトーストとの
競合が無いため通常のモーダル(v129身体スキャンと同じ「強制しない・いつでも抜けられる」設計)。

- 複数件は1件ずつキューで回す(`_pendingIncompleteReasonCtx.queue`)。チップ1タップ or
  「スキップ」で次へ進み、全件処理後(記録・スキップ問わず)に自動で`generateReport()`が走る。
- 背景タップ(`.modal-root`のbackdropクリック)も「スキップ」経由に統一した(`renderModal()`の
  onclick分岐に`incompleteReason`タイプを追加。理由: 背景タップで単純に`closeModal()`すると
  `_pendingIncompleteReasonCtx`が残ったままとなり、dailyCloseモードの`generateReport()`呼び出しが
  永久に起きなくなる事故を防ぐため)。
- 既に`incompleteReason`が付いているBlockは対象から除外(同じBlockに何度も尋ねない)。

## 日報出力(generateReport())

「## 6. やり残し」「## 7. Block 内のコメント」の後、「## 8. ジャーナル」の前に
**「## 未完了理由」節**(番号なし。既存の「## AIへの質問」等と同じ非番号見出しの型)を追加。

- 対象は`state.blocks`から`date`一致 + `incompleteReason`ありのものを**直接**拾う
  (`blocksForDate()`の`!deleted`フィルタは使わない。仕分けの手放す/延期はBlockを
  `deleted:true`化するため、`blocksForDate()`経由だと既に対象から外れてしまう。それでも
  「その日なぜ完了しなかったか」の記録は残すため、deleted済みも含めて拾う設計にした)。
- 理由が1件以上ある日のみ節を出す。書式は `- [Block名] チップ名: ひと言`
  (ひと言が空なら `- [Block名] チップ名`)。

## バッチ側: `loop/scripts/excuse-ledger-extract.py` の入力源切替(ClaudeCodeワークスペース側)

`loop/scripts/excuse-ledger-extract.py`(excuse-ledger.sh専用の抽出ヘルパ)を、旧「## 6. やり残し」
×「## 7. Block 内のコメント」の交差抽出から、上記「## 未完了理由」節の直接パースへ切替した。

- `REASON_HEADING_RE` / `REASON_LINE_RE`(旧`INCOMPLETE_HEADING_RE`/`COMMENT_HEADING_RE`を削除)。
- 出力スキーマ(`{"date","source","items":[{"title","text"}]}`)は不変。`source`は
  `"incomplete-reason"`(v160時点の`"journal-incomplete-comment"`から変更)。
- `excuse-ledger.sh`の`LEDGER_SOURCE_LABEL`も`"やり残しBlockのコメント"`→`"incomplete-reason"`
  に変更(台帳エントリの`source`欄値)。台帳自体のスキーマ(`{date,text,source}`)・冪等/
  ロールバック方針は不変。
- 検証: 合成日報(3ケース: 「## 未完了理由」節ありの日/「## 6.」だけあり「## 未完了理由」節
  無しの日〈旧ロジックなら拾えたはずが新ロジックでは`source:"none"`になることを確認〉/
  ファイル自体が存在しない日)での単体実行と、`--dry-run --date`での
  `excuse-ledger.sh`エンドツーエンド確認(personal-dataへの実push・実書き込みは無し)を実施。
  詳細な出力例は本ファイルではなくコミット時の作業ログ(実行結果はテスト実行時に確認済み)。
- `loop/FORMAT_CONTRACT.md`の突合表・「excuse-ledger.json / 言い訳レポート_YYYY-MM-DD.mdの契約」
  節・「今後見出しを変更する際のチェックリスト」を本切替に合わせて更新した。

## SWキャッシュ

`sw.js`の`CACHE_NAME`を`v161`→`v162`へ更新。

## テスト

`tests/v162.test.js`(9観点+補助2件)。観点:
1. `normalizeState`後方互換: `incompleteReason`キー自体が無い旧Blockはnullへ補完/壊れた形状
   (chip欠落)もnullへ正規化/正しい値は保持される
2. 日次締め: 理由未記録の未完了Blockが残っていると「日報を生成」で直接は生成されず理由チップ
   モーダルが開く(完了済みBlockは対象外)
3. チップ1タップ(+任意のひと言)で記録→次のBlockへ→全件処理後にgenerateReport()が走る
4. 全件スキップでもgenerateReport()は最終的に実行される(理由は記録されない)
5. 既に理由が付いているBlockは日次締めモーダルに再度出ない
6. 日報出力: 「## 未完了理由」節が指定書式(ひと言あり/なし)で出る/理由が無い日は節ごと省略
7. 仕分け「手放す」実行直後、カードの下にインライン理由チップ欄が即座に出る(全画面モーダルは
   開かない・Undoトーストも同時にタップ可能なことを`isVisible()`で確認)。deleted:true化された
   Blockにも理由が記録できる。「スキップ」でも記録せず引っ込む(7b)
8. 仕分け「手放す」直後にUndoすると、インライン理由チップ欄も引っ込む(undoされた行動の理由は
   尋ねない)
9. **理由を記録した後でもUndoを押すと、記録した理由ごと完全に元へ戻る**(v156のUndo契約。
   実装中に「理由記録時のsaveAndRender()がUndoトーストを上書きして『元に戻す』ボタンが消える」
   実バグをこのテストで検出・修正した)

既存テストへの影響確認: v81/v91/v117/v128/v129/v131/v152/v154/v156を実行してALL PASSを確認。
うちv81/v128/v131の3スイートは、`seedState()`由来の当日デモBlock(未完了)が残っていると
「日報を生成」クリックが新設の理由チップモーダルに横取りされてしまうため、各スイートの
本題(トースト文言/体力予算)とは無関係なblocksを明示的に`[]`へクリアするフィクスチャ修正を
行った(アサーション自体は無変更・弱体化なし)。

## つまずいた点

- 当初案(setTimeoutで5.3秒後にモーダル表示)は、実装後のtriageスイート回帰テストで
  タイムアウト事故を実測してから設計ミスに気づいた。理屈上は「単一タイマーで直近1件に絞れば
  安全」と考えていたが、実際のPlaywright操作(要素安定性待機等)の累積遅延が読みより大きく、
  操作間隔が空くケースを塞ぎきれなかった。最終的にモーダルをやめてインライン非モーダル方式に
  設計変更することで、遅延そのものが不要になり問題が根本から解消した。
- 上記のインライン化に伴い、「理由記録時にsaveAndRender()で新トーストを出す」という素朴な実装が
  Undoトーストを上書きして消してしまう副作用に気づかず一度実装し、[9]のテストケースを追加で
  書いたことで実際に検出できた(このテストが無ければ見逃していた可能性が高い)。

## 2系統レビュー対応(2026-07-28、Claude+Codex)

### 必須修正

1. **仕分け経路の理由が台帳に届かない構造的欠陥**(両レビュー一致・最重要): 仕分けの対象
   (`carryableBlocks()`)は常に**前日**のBlock(`b.date === addDays(today, -1)`)であり、
   `generateReport()`の抽出条件が`b.date === date`だけだったため、仕分けで記録した理由は
   「当日の日報」にも「前日の日報(既に生成・push済みで再生成されない)」にも構造上一切載らず、
   `excuse-ledger-extract.py`にも永久に届かない欠陥があった。抽出条件へ
   `incompleteReasonAtDate(b) === date`(記録時刻`incompleteReason.at`の日付一致)をORで追加し、
   前日Blockでも「記録したその日」の日報に載るようにした(前日由来であることの注記は追加せず、
   仕様どおり淡々と`- [Block名] チップ: ひと言`のまま出力)。
   テスト[10](一気通貫: 仕分けで記録→当日の日報に載る)を追加し、さらに`excuse-ledger-extract.py`
   を合成日報(前日Block由来の行を含む当日日報)で単体実行して抽出できることを再確認した。
2. **完了済みBlockの理由が「未完了理由」欄に出続ける汚染リスク**: 記録後にBlockが完了へ転じても
   欄からは消えず、偽の「言い訳」が台帳へ流れうる状態だった。抽出条件へ`!b.completed`を追加
   (`incompleteReason`自体は削除せず、表示条件だけを変更)。テスト[6c]を追加。
3. **問い入力の未保存窓**: 「日報を生成」クリック時に`state.questions.push(...)`した直後、
   理由チップモーダルのキュー処理中にPWAがkillされる/リモート側の状態が先に同期採用される等が
   起きると、積んだ問いが保存されずに消える窓があった。`push`直後に`saveState()`を1行追加。

### 推奨修正(すべて対応)

4. **日次締めモーダルのスキップ記憶**: `_dailyCloseReasonSkipped`(セッション内Set、
   `_triageSessionDone`と同じ流儀・非永続)を新設。スキップしたBlock idを記録し、同じセッション内
   で「日報を生成」を再度押しても再質問しない。テスト[11]を追加。
5. **インライン理由欄のクリア漏れ**: `triageAction()`の冒頭(三択のいずれかが成立することが
   確定した時点)で`_pendingInlineReason`を無条件にnullへリセットしてから、block/drop・
   block/deferの分岐だけが改めて自分のid向けへセットするよう変更した。これにより「今日やる」や
   Wish系操作の後には出ない(前カード分の理由欄が次カードの下に居座らない)。該当コメント
   (`_pendingInlineReason`宣言部)も実装に合わせて更新した。テスト[7c]を追加。
6. **`incompleteReason.at`のString()正規化**: `normalizeState()`で`chip`/`note`と同様に
   `at`も`String()`で包むようにした(数値・null等の壊れた入力でも文字列として扱えるようにする)。

### 検証(レビュー対応後、再実施)

- `node tests/run-all.js v162 v152 v154 v156 v81 v128 v131` → 全PASS。
- `npm run test:core`(フォアグラウンド、Bashツールのtimeoutパラメタ600000を明示指定)→
  2回実行し両方全PASS(232.3s / 396.7s)。
- `node tests/v68.test.js`(state.questions.push経路の既存回帰確認)→ ALL PASS。
- `loop/scripts/excuse-ledger-extract.py`を合成日報(前日Block由来の行1件+当日Block由来の
  行1件、計2件)で単体実行し、両方とも`source:"incomplete-reason"`で正しく抽出されることを確認。

### 対応できなかった項目

なし(必須3件・推奨3件すべて対応済み)。ただし上記「自信がない箇所」(handoff.md参照)として、
前日Blockの理由が「当日の日報」と「Block本来の日(前日)の日報」の両方に出現しうる設計上の
トレードオフは、監督者確認事項として残っている(実運用のexcuse-ledger.shは当日分のみ読むため
実害は無い想定だが、Kが過去日報を手動で見返した際の見え方について正典化されていない)。
