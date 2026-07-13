# CHANGES v87

## 概要

`taskchute-notes/ROADMAP.md` の「v91: 宣言→終了報告ループ(疑似ボディダブリングの核心)」を
実番号v87として実装した。Focusmateの効果成分のうち、実行意図研究の裏付けがある「目標の宣言」と
「終了報告」だけを取り出し、被視感を伴わない軽量ループとしてアプリ内に組み込む。アプリ内
Claude API呼び出しは全廃済み(v60)のため、即時フィードバックは決定論(定型文+簡易集計)のみで
返し、AIの知恵は既存の「バッチ生成ファイル→GitHub→fetch」経路(翌朝のAIフィードバック)へ、
宣言・報告ログを新しい入力として合流させる形で注入する。

## [A] 宣言(開始時)

対象の開始アクションを2つに絞った(ROADMAPが名指しした「タスク/Block開始時・ポモドーロ開始時」
に対応):

- `data-action="now-start"`(▶ 開始/いま着手する。ホームの「いまこれ」カード・Block行・
  タイムライン等、複数箇所から呼ばれる既存アクション)
- `data-action="start-pomodoro"`(25分ボタン)

いずれも、クリック時に直接 `setBlockTime`/`startPomodoro` を呼んでいた従来の即時実行を、
新設の `openDeclareModal(blockId, kind)` を経由するよう変更した。宣言モーダルは
「今から『{タイトル}』を{見積}分やる」の固定文言+一言(任意、16px入力欄)を表示し、
[宣言して開始] [宣言せず開始] の2ボタンのみ(ワンタップ確定)。[宣言せず開始] または ×閉じ
(→ `closeModal()` で `_pendingLifecycleCtx` をクリア)の場合は、宣言ログを残さず従来どおり
即座に開始処理(`resumeLifecycleStart`)が走る——「強制しない」というK既存方針を踏襲した。

見積時間は種別で分岐する(`estimateMinutesForBlock`): ポモドーロは固定25分(実時間。表示は
50:00→00:00の2倍速)、通常Blockは `block.estimateMin`(v41の既存フィールド)→無ければ
`plannedStartAt`/`plannedEndAt` の差→どちらも無ければ非表示。

`setBlockTime(id, "actualStartAt")` 内部の「Block開始でフォーカスタイマーを自動起動」
(v70・`focusTimerAuto`)は、宣言モーダル解決後に呼ばれる元の関数内でそのまま動くため、
now-startの宣言確定/スキップ後に自動連鎖するポモドーロ側で二重に宣言を求めることはない。

## [B] 終了報告(完了/停止時)

同じ考え方で、完了アクション2つを対象にした:

- `data-action="now-end"`(■ 終了)
- `data-action="complete-pomodoro"`(✓ 完了)

`openReportModal(blockId, kind)` 経由にし、終了報告モーダルは「できた/一部できた/脱線した」の
ワンタップ選択肢+一言(任意、自由記述)を表示する。いずれかの選択肢をタップした時点で
`finishReport(outcome, note)` が確定し(自由記述欄の値はその時点でDOMから読む。二段階の
状態管理をしないため、モーダル再描画によるテキスト消失が起きない)、[スキップ] または ×閉じ
なら報告ログを残さず従来どおりの完了処理のみ走る。

**意図的に対象外にしたもの**: `toggle-block`(完了チェックボックスの直接トグル。完了/未完了
双方向に使われるため報告の意味が一意に決まらない)、`complete-block-with-actual`→実績登録
モーダル(過去分の手動バックフィル用途であり、Focusmateが想定する「今まさに終わった」ときの
即時報告とは性質が異なる)。この2経路は今回のK指示にある「タスク/Block開始時・ポモドーロ
開始時」「完了/停止時」という文言に対して、`now-start`/`now-end`/`start-pomodoro`/
`complete-pomodoro` の4アクションが最も直接的に対応すると判断し、スコープをそこに絞った。

## [C] 決定論フィードバック

`buildDeclareFeedback(entry)` が、報告確定時に次の2つを組み立てて返す(該当データが無い部分は
省略。AI呼び出しは一切行わない):

- 宣言が伴っていた場合: `宣言→完了まで{分}分(宣言時見積{分}分)`
  (`localDateTimeToMs`で`declaredAt`/`reportedAt`の差を計算。iOS Safariの`new Date()`TZ解釈
  バグを避ける既存ヘルパーをそのまま使う)
- 当日に1件以上宣言があれば: `今日の宣言達成 X/Y`(Y=当日の宣言件数、X=そのうち
  `outcome==="done"`の件数)

これを `showToast()` で表示する。既存の完了処理(`completePomodoro`/`setBlockTime`)が内部で
呼ぶ既定トーストは、この決定論フィードバックの表示で(同一同期タスク内のため)上書きされる形に
なる——スキップ時(報告なし)は従来どおり既定トーストのみが見える。

## [D] データモデル

新規 `state.declarations`(配列、上限300件、`normalizeState`で後方互換補完)。1エントリ:

```
{ id, blockId, date, title, estimateMin, note,
  declaredAt, reportedAt, outcome, resultNote }
```

宣言(`logDeclaration`)と報告(`reportForBlock`)は独立して任意なため、宣言だけ・報告だけの
エントリも存在しうる。報告は当日・同一Blockで未報告(`reportedAt`が空)の宣言があればそこへ
合流し、無ければ「宣言なしの終了報告」として新規エントリを作る。

## [E] バッチ側(loop/coach-daily.sh + loop/coach/daily-review.md)

- `coach-daily.sh`: 既存の `get_zero_sec_entries` と同じパターンで `get_declarations <date>` を
  新設。`app-state.json` の `declarations` のうち `date` が一致するものを、宣言時刻・見積・
  一言・報告時刻・成果・報告一言つきで整形して返す(データが無ければ「(前日の宣言・終了報告
  ログなし)」)。入力組み立てのプロンプト本文に「---- 前日の宣言・終了報告ログ ----」節として
  追加した(0秒思考と同じ、鮮度注記——personal-dataへのapp-state.json自動push状況に依存する
  旨——も踏襲)。
- `loop/coach/daily-review.md`: 新しい機械可読セクションは作らず、既存の観点6「意図と結果の
  ズレ」に「宣言と実績のズレ」を織り込む形で追記した(宣言した見積と実際の所要時間・報告内容の
  ズレがあれば言及する旨)。「新しい入力データの使い方」節にも「前日の宣言・終了報告ログ」の
  説明を追加した。

## テスト

- `tests/v87.test.js`(新規): ①宣言モーダルでワンタップ確定→開始(now-start/start-pomodoro
  それぞれ) ②宣言スキップ/×閉じで従来動作(宣言ログなしで開始のみ実行) ③終了報告→ログ記録
  (now-end/complete-pomodoroそれぞれ、outcome/一言の保存) ④決定論フィードバックの文言
  (宣言→完了までの分数・見積・今日の宣言達成X/Y) ⑤normalizeStateの後方互換(旧state
  =`declarations`フィールド無し、から補完されること)。
- `npm test`(全量)ALL PASSを確認。

## 自信がない箇所・懸念点

- 終了報告の対象を`now-end`/`complete-pomodoro`の2経路に絞り、`toggle-block`(チェックボックス
  トグル)と実績登録モーダル(`complete-block-with-actual`)は対象外にした判断は、K自身が
  普段どちらのボタンで完了操作をしていることが多いかによっては物足りない可能性がある
  (体感で最も使われている完了経路がチェックボックスなら、宣言・報告ループがほとんど発火しない
  ことになる)。実機の使用感を見て、必要なら次イテレーションで対象を広げたい。
- 決定論フィードバックのトーストは、完了処理自身が出す既定トースト(「ポモドーロを完了しま
  した」等)を同一同期タスク内で上書きする実装にした(setTimeoutを使わず確実に最終表示を
  制御するため)。挙動としては意図通りだが、「まず完了の確認、次にフィードバック」という
  2段階の体感を期待していた場合はギャップになりうる。

## should-fix対応(レビュー、2026-07-13)

レビューはmust-fixゼロでPASS、should-fix1件を追加修正した。

- **トーストが全画面レイヤの裏に隠れる**: `.toast`が`z-index: 40`のままだったため、
  `.now-fullscreen`/`.pomo-fullscreen`(いずれも`z-index: 9999`)が表示されている間に出る
  トーストが不可視になっていた。特に全画面ポモドーロ(`.pomo-fullscreen`)で完了→終了報告
  モーダルを経て表示される決定論フィードバックトースト(本バージョンの目玉)が見えなくなる
  実害があった。`styles.css`の`.toast`を`z-index: 10001`(全画面レイヤ超・宣言/報告モーダル
  の`10050`未満)に変更した。
- **テスト**: `tests/v87.test.js`に[⑥][⑥b]を追加。
  - [⑥] `.pomo-fullscreen`を開いた状態で宣言→ポモドーロ完了→終了報告(できた)まで一連の
    操作を行い、完了後も全画面表示が維持されたまま決定論フィードバックトーストが
    `.show`状態になっていること、`#toast`のcomputed z-indexが`.pomo-fullscreen`より大きい
    ことを確認する。
  - [⑥b] `.now-fullscreen`(Now画面/実行コンベア)を開いた状態で「✓ 完了」を押し、完了トースト
    のcomputed z-indexが`.now-fullscreen`より大きいことを確認する。
  - 検証手法の注記: `.toast`は`pointer-events: none`のため、`document.elementFromPoint`による
    最前面判定はヒットテストの対象外になり使えない(視覚的な重なりに関わらず背後の要素が
    返ってしまう)。両要素とも`position: fixed`でルートのスタッキングコンテキストを共有する
    ため、computed z-indexの比較で視覚的な重なりを正しく判定できると判断し、そちらを採用した。
- 全量`npm test`フォアグラウンド実行でALL PASS(exit code 0)を確認。
