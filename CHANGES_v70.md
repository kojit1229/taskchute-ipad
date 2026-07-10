# CHANGES v70

## 概要

`../taskchute-notes/designs/v70-execution-surface.md`(実行接点の強化)のうち、アプリ側の
3機能(2→1→4の設計順)を実装した。機能3(外部カレンダーICS読み込み)はバッチ側(`loop/plan-daily.sh`)
実装済みのため本変更の対象外。あわせて、`tests/v62.test.js`/`tests/v65.test.js`が本番バッチ生成の
実ファイル`AIプラン_<実行日>.json`を一時生成・削除していた既存の地雷（v67 CHANGES記載の環境依存）を
恒久修正した。**バージョン番号は v68 → v70(v69は欠番。データ寿命フェーズ用に予約、本変更では未着手)。**

- **ワンタップ実績(機能2・S)** — タイムラインのBlockカード(未実行)に「▶いま開始」、実行中
  (`actualStartAt`あり・`actualEndAt`なし)に「■いま終了」ボタンを追加した(既存の○完了登録ボタンとは
  別の軽量アクション。ボタンの発火先は既存の`now-start`/`now-end`アクション・`setBlockTime()`を
  そのまま再利用しており、WBS一覧・ホームの「▶ いま着手する」と実装が完全に一致する)。
  当日ビュー(タイムライン・予定モード)に「予定通りだった」一括承認ボタンを追加。当日の未記録Block
  (`plannedStartAt`あり・`actualStartAt`/`actualEndAt`両方なし・未完了・非ルーティン)だけに計画時刻を
  実績としてコピーし`completed`化する(確認は`window.confirm`一回、既存の`deleteProject`等と同じ流儀)。
- **Now画面=実行コンベア(機能1・S〜M)** — ホームに「▶ Now」ボタンを追加。押すと全画面モードに入り、
  現在時刻に該当する(無ければ次の・それも無ければ未着手優先の)Blockを1個だけ大きく表示し、
  [開始][完了][スキップ]の3ボタンのみを出す。完了/スキップで次のBlockが自動表示され、✕で通常UIへ戻る。
  新しい状態は`nowMode`(全画面フラグ)と`_nowSkippedIds`(このセッション中のスキップ集合)のみで、
  どちらも非永続のモジュール変数(`normalizeState`への補完は不要、設計書の指示どおり)。
- **ポモドーロ×Block融合+チョコ停記録(機能4・M)** — Block「開始」(Now画面・タイムライン・
  WBS一覧・ホームのどれから開始しても、すべて`setBlockTime(id, "actualStartAt")`を経由するため
  一律に効く)で、既存ポモドーロUIを流用したフォーカスタイマー(25分)を自動起動する。設定
  `focusTimerAuto`(既定ON)でON/OFFでき、既に別Blockのタイマーが動いている場合は乗っ取らない。
  タイマー表示中の「中断」ボタンは理由ワンタップピッカー(割込み/疲労/迷い/その他)を経由するように
  変更し、理由選択で`block.interruptions[]`に`{at, reason}`を記録したうえで(既存どおり)タイマーを
  中断する。キャンセルすればタイマーは止まらず記録も残らない(トラップにしない)。分析UIは追加しない
  (集計はバッチ側の領分という設計方針どおり)。
- **【ついで必須】テストフィクスチャ地雷の恒久修正** — `tests/v62.test.js`/`tests/v65.test.js`が
  `AIプラン_<実行日>.json`を実ファイルとして一時生成→`finally`で削除していたため、本番バッチが
  同名の実ファイルを置く日にテストを実行すると本物のファイルが一時的に消えていた(v67 CHANGESで
  発覚した既知の環境依存)。v67/v68で確立した`page.route`方式(fetchをフィクスチャ応答に差し替え)に
  書き換え、実ファイルの生成・削除を完全にやめた。

## 変更内容(app.js)

### 1. ワンタップ実績

- **`renderTimelineCard`**: `block.actualStartAt`/`actualEndAt`/`completed`から`started`/`inProgress`を
  判定し、実績モードでない・極小カード(`isShort`)でない・未完了のときだけ、未着手なら
  `data-action="now-start"`の▶ボタン、着手中なら`data-action="now-end"`の■ボタンを右上に追加した
  (左側は既存の○完了登録ボタンの領域のため、右上に配置して衝突を避けた)。
  クリックは`document`の`data-action`デリゲーションでカード自体の`edit-block`より優先して拾われる
  (`event.target.closest("[data-action]")`が最も近い要素を見るため、既存のtl-complete-btnと同じ)。
- **`bulkApproveAsPlanned()`**(新規): 当日(`todayISO()`固定)の対象Blockを抽出し、`window.confirm`
  で1回確認したうえで`actualStartAt`/`actualEndAt`に計画時刻をコピーし`completed:true`にする。
  紐づくTaskは`toggleBlock()`と同じ思想で`"todo"`→`"doing"`のみ(自動で`"completed"`までは進めない —
  Task完了は既存フロー同様、人の判断に委ねる)。対象0件ならトーストのみで確認ダイアログは出さない。
- **`renderTimelineView`**: 予定モード・当日表示のときだけ「✅ 予定通りだった(一括承認)」ボタンを
  アクション行に追加。

### 2. Now画面(実行コンベア)

- モジュールレベル変数(非永続・`normalizeState`不要): `nowMode`(全画面フラグ)、
  `_nowSkippedIds`(このセッション中にスキップしたBlock idのSet)。
- **`openNowMode()`/`closeNowMode()`**(新規): 開始時に`selectedDate`が今日でなければ
  `setSelectedDate(todayISO())`で今日へ揃える(Now画面は常に「今日」が対象という設計の前提を
  維持するため)。スキップ集合はセッション開始のたびにリセットする。
- **`nowConveyorTarget()`**(新規): `homeHero()`と同じ「現在時刻に該当するBlock、無ければ未着手優先の
  次」の抽出ロジックに、スキップ集合の除外を加えたもの。
- **`nowConveyorComplete(id)`**(新規): フォーカスタイマーがそのBlockで動いていれば`completePomodoro()`
  に委ね(pomodoroCount加算・タイマー後始末まで一致させる)、動いていなければ`toggleBlock(id)`で
  完了化する(モーダルを挟まない即時完了 — 設計書の「3ボタンのみ」の速度優先方針に合わせた判断。
  ホームの「✓ 完了にする」ボタンが開く実績登録モーダルとは意図的に別動作)。
- **`renderNowConveyor()`**(新規): 対象が無ければ「今日のBlockはすべて片づきました。」を表示。
  あれば[▶開始(着手済みならdisabled)][✓完了][→スキップ]の3ボタンを表示する。
- **`renderMain()`**: 冒頭で`nowMode`をチェックし、trueなら通常のビュー分岐を飛ばして
  `renderNowConveyor()`のみを描く(`state.currentView`はそのまま保持されるので、✕で閉じると
  元の画面に戻る)。
- **`renderHome`**: ヘッダーのアクション欄に「▶ Now」ボタンを追加(「今日へ」ボタンの隣)。

### 3. ポモドーロ×Block融合+チョコ停記録

- **`normalizeState`**: `value.settings.focusTimerAuto`を真偽値として既定`true`で補完
  (`typeof !== "boolean"`パターン、既存の`autoSync`等と同じ)。`value.blocks`のmapに
  `interruptions: []`の既定値を追加し、スプレッド後に`Array.isArray(block.interruptions) ? ... : []`
  で壊れた形状(配列でない値)も初期化する(`fixDateTime`と同じ「スプレッド後に上書き補正」パターン)。
- **`makeBlock`**: 新規Block作成時の既定値に`interruptions: []`を追加。
- **`setBlockTime(id, "actualStartAt")`**: 既存の着手処理(Task doing化・着手ジュース)の後に、
  `state.settings.focusTimerAuto`がtrueかつ`state.pomodoro.running`がfalseのときだけ
  `forceResetPomodoroSession(); startPomodoro(id);`を呼んで早期returnする(`startPomodoro`自体が
  render/toastまで行うため、末尾の共通render/toastと二重にしない)。これにより`now-start`アクションを
  経由する全ての着手経路(タイムライン・WBS一覧・ホームの「▶ いま着手する」・Now画面の「開始」)に
  一律で効く。既に別Blockのタイマーが動いている場合は`!state.pomodoro.running`が偽になり乗っ取らない。
- **`INTERRUPT_REASONS`**(新規定数): `["割込み", "疲労", "迷い", "その他"]`。
- **`recordBlockInterruption(blockId, reason)`**(新規): 該当Blockの`interruptions`に
  `{at: nowDateTime(), reason}`を追加して保存する(集計・分析ロジックは持たない)。
- **`interruptReasonPickerHTML()`**(新規): 「中断の理由」ワンタップボタン4種+キャンセルの軽量ピッカー
  (v62の`draftRejectReasonPickerHTML()`と同じ思想)。
- **クリックハンドラ**: 「中断」ボタン(`stop-pomodoro`)を、紐づくBlockがあれば即中断せず
  `_pendingInterruptBlockId`をセットして理由ピッカーを表示するように変更した(紐づくBlockが無い
  異常系のみ、記録の意味が無いため従来どおり即`stopPomodoro()`)。新規`interrupt-reason`
  (理由選択→記録→`stopPomodoro()`)、`interrupt-reason-cancel`(ピッカーを閉じるだけ、タイマー継続)
  を追加。
- **`renderManualPomodoro`**: 作業中(focusフェーズ)の描画で、`_pendingInterruptBlockId`が現在の
  `pomodoro.blockId`と一致する間は3ボタン行の代わりに`interruptReasonPickerHTML()`を表示する。
  `renderPomodoroFullscreen`もこの関数を再利用しているため、全画面モードでも同じ挙動になる
  (常時タイマー(`passive`タブ)はBlockに紐づかない別モデルのため対象外のまま)。
- **`renderSettings`**: 「実行(v70)」パネルを新設し、`focusTimerAuto`のチェックボックスを追加。
- **change イベントハンドラ**: `data-setting-focustimerauto`のトグルを追加。

## 変更内容(styles.css)

- `.tl-start-btn`/`.tl-end-btn`: タイムラインカードの▶いま開始/■いま終了ボタン。既存の
  `.tl-complete-btn`と同じ「極小アイコンボタン」の流儀(iOS指サイズ規約は`.btn`系の実UIボタンに適用し、
  この種の补助アイコンは既存踏襲)で右上に配置。
- `.interrupt-reason-picker`: 中断理由ピッカー(`.draft-reject-picker`と同系統の見た目)。
- `.now-fullscreen`/`.now-fullscreen-content`/`.now-fullscreen-close`/`.now-eyebrow`/`.now-title`/
  `.now-meta`/`.now-cat`/`.now-status`/`.now-empty`/`.now-actions`/`.now-btn`: Now画面本体。
  `.pomo-fullscreen`と同じ`position:fixed; inset:0`の全画面手法(iOS Safariの100vh問題を回避する
  既存手法をそのまま踏襲)を使い、動画背景の代わりにテーマ変数(`var(--bg)`等)で
  ライト/ダークモードに自動追従させた。ボタンは`min-height:48px; font-size:16px`でiOS Safari規約
  (指サイズ・自動ズーム防止)を満たす。

## 変更内容(sw.js)

- `CACHE_NAME`を`taskchute-journal-pwa-v68`→`taskchute-journal-pwa-v70`に更新(v69は欠番。
  データ寿命フェーズ用に予約されており本変更では未着手のため、v68から直接v70へ進めた)。
  新規静的アセットの追加は無いため`APP_SHELL`は無変更。

## テストフィクスチャ地雷の恒久修正(tests/v62.test.js, tests/v65.test.js)

- 従来: `fs.writeFileSync(aiPlanPath, ...)`でリポジトリ直下に実ファイル`AIプラン_<TODAY>.json`
  (`tests/v62.test.js`はさらに`週次レビュー_<WEEK>.md`も)を書き、`finally`で`fs.unlinkSync`して
  削除していた。本番バッチ(`plan-daily.sh`)が同名の実ファイルを日次でcommitするため、実行日が
  一致するとテスト終了後にその実ファイルが作業ツリーから消える(v67 CHANGESで発覚・当時はスコープ外
  として`git checkout`での都度復元運用にしていた)。
- 修正: v67/v68で確立した`page.route`方式に統一した。`aiPlanFixture`/`weeklyReviewFixture`という
  モジュールレベルの文字列変数(既定`null`)を用意し、`page.route`で該当パスへのfetchを
  「`null`なら404、文字列ならその内容で200」を返すハンドラに固定登録する。各シナリオは
  `fs.writeFileSync(...)`の代わりに変数へ代入するだけ(`fs.unlinkSync`の代わりは`= null`)。
  実ファイルへは一切触れなくなったため、`finally`のクリーンアップコードも削除した。
  `path`/`fs`/`ROOT`のimportも不要になったため削除した。

## 実装判断(仕様から補った点)

1. **「中断」ボタンの挙動を変更せず、理由記録を追加する形にした**: 既存の`stopPomodoro()`は
   「中断時、紐づくBlockの`actualStartAt`を消す(再開で改めて記録するため)」という明確な設計
   (v13コメント)を持つ。チョコ停記録を導入するにあたり、この既存挙動(actualStartAtクリア含む)は
   変更せず、理由選択後に`stopPomodoro()`をそのまま呼ぶ形にした。設計書は「実行の道具に痩せさせる」
   方針を明言しており、中断の意味論を作り替えるのは本タスクのスコープ外と判断した。
2. **Now画面の「完了」はモーダルを開かない即時完了にした**: ホームの「✓ 完了にする」ボタン
   (`complete-block-with-actual`)は充電/放電・コメント入力の実績登録モーダルを開くが、Now画面は
   設計書が「[開始][完了][スキップ]の3ボタンのみ」「認知負荷ゼロ」を明言しているため、
   `toggleBlock`/`completePomodoro`による即時完了(モーダル無し)にした。charge/discharge等は
   Now画面からは入力できず、後から編集で補う運用になる。
3. **Now画面の「開始」ボタンはアクション自体を`now-start`に統一した**: 別アクション名
   (`now-conveyor-start`等)を新設せず、タイムライン・WBS・ホームの「▶ いま着手する」と全く同じ
   `now-start`アクションを再利用した。これにより機能4(フォーカスタイマー自動起動)が
   「Now画面から開始しても」自動的に効く(設計書の要求どおり)。
4. **フォーカスタイマーは既に別Blockで動いていれば乗っ取らないことにした**: 設計書に明記が無い
   境界だが、無条件に乗っ取ると「集中を破壊するタイマー切り替え」という本末転倒になりかねないため、
   `!state.pomodoro.running`をガードにした(Block自体の`actualStartAt`記録は乗っ取り有無に関わらず
   常に行われる)。
5. **「予定通りだった」一括承認は選択式ではなく全対象一括にした**: 設計書は「当日の未記録Blockに
   計画時刻を実績としてコピー+completed化(確認モーダル1回)」とあり、個別選択UIへの言及が無いため、
   対象Block全件をまとめて処理し、確認は`window.confirm`1回のみとした(件数を確認文言に含めることで
   「何件が対象か」は伝わるようにした)。
6. **一括承認ボタンの設置場所はタイムライン(予定モード・当日表示時のみ)にした**: 設計書の
   「当日ビュー」という表現は具体的な画面を指定していないため、Blockの計画/実績が一覧で見える
   タイムラインの「予定」モードを「当日ビュー」と解釈した。過去日を見ている間はボタン自体を
   非表示にし、誤って別日を一括承認できないようにした。

## テスト

- `tests/v70.test.js`(新規)。Clock APIで時刻固定(10:00固定)+ AIプラン/AIフィードバック/週次レビューの
  実ファイルfetchを`page.route`で常に404隔離。以下を検証する:
  1. normalizeState後方互換: `settings.focusTimerAuto`が無い旧stateに`true`が補完される。
     Block`interruptions`フィールド無し/壊れた形状(配列でない)のいずれも`[]`に補完・初期化される。
     既存の`interruptions`値は保持される(既存値優先)
  2. タイムラインカードの「▶いま開始」で`actualStartAt`が入り「■いま終了」に切り替わる。押すと
     `actualEndAt`が入る(`focusTimerAuto:false`でボタン単体の挙動をタイマー自動起動と切り分けて検証)
  3. 「予定通りだった」一括承認: 未記録Blockだけ計画時刻がコピーされ`completed`化される。既に実績が
     あるBlock・完了済み・ルーティンは対象外のまま。キャンセルすると何も変わらない。紐づくTaskは
     `todo`→`doing`のみ(自動完了はしない)。対象0件ならトーストのみで`confirm`は呼ばれない
  4. Now画面: 「▶ Now」で全画面表示 → 現在時刻に該当するBlockが1個だけ出る → 「開始」で
     `actualStartAt`記録+ボタンがdisabledに → 「完了」で次のBlockへ自動遷移 → 「スキップ」で
     データを変更せず次へ(全部片付くと完了メッセージ) → 「✕」で通常UIに戻る
  5. `focusTimerAuto:true`(既定)でBlock開始 → ポモドーロが自動起動し、開始したBlockに紐づく。
     既に別Blockのタイマーが動いていれば乗っ取らない(新しく開始したBlock自体の`actualStartAt`は
     記録される)
  6. 中断記録: 「中断」ボタンは理由ワンタップピッカーを経由する。ピッカー表示中はまだタイマーは
     止まらない。キャンセルすればタイマー継続・記録なし。理由選択で`interruptions`に
     `{at, reason}`が記録され、既存どおりタイマーが中断され`actualStartAt`がクリアされる
- 開発中は`node tests/v70.test.js`または`node tests/run-all.js v70`で単独実行してALL PASSを確認。
- 【全量確認】リポジトリ直下に検証用の`AIプラン_2026-07-10.json`(ダミー内容)を一時的に作成し、
  実ファイルが存在する状態で全量`npm test`(`node tests/run-all.js`、v70含む全18スイート)を実行し
  **ALL PASS**を確認した。実行後`git status`でこのファイルが未追跡(`??`)のまま無傷で残っている
  ことを確認し(page.routeによるモックのため実ファイルへは一切書き込まれない)、検証用ファイルは
  削除して作業ツリーをクリーンに戻した。

## 変更ファイル

- `app.js`
- `styles.css`(`.tl-start-btn` / `.interrupt-reason-picker` / `.now-*`)
- `sw.js`(`CACHE_NAME`を`v68`→`v70`、v69欠番)
- `tests/v62.test.js`(実ファイル生成→page.routeモックへ書き換え)
- `tests/v65.test.js`(同上)
- `tests/v70.test.js`(新規)
- `CHANGES_v70.md`(本ファイル)
- `../taskchute-notes/handoff.md`(notes リポジトリ側、本エントリ追記)

## 実機テスト手順

1. `sw.js?nocache=YYYYMMDD`を開き、1行目が`taskchute-journal-pwa-v70`になっていることを確認。
2. タイムラインで未着手のBlockカードに「▶いま開始」ボタンが出ることを確認し、押すと
   「■いま終了」に切り替わることを確認する。押すと実績が記録されカードが実績色にならないこと
   (完了はしない、あくまで実績時刻の記録)を確認する。
3. タイムライン(予定モード・今日を表示中)に「✅ 予定通りだった(一括承認)」ボタンが出ることを
   確認し、押すと確認ダイアログ→対象Blockが計画時刻どおりの実績で完了になることを確認する。
4. ホームの「▶ Now」ボタンを押し、全画面のNow画面が開くことを確認する。現在時刻のBlockが
   1個だけ表示され、[開始][完了][スキップ]で操作できること、完了/スキップで次のBlockに
   自動で切り替わること、✕で元の画面(タブ)に戻ることを確認する。
5. 設定タブに「⏱ Block開始でフォーカスタイマーを自動起動」のトグル(既定ON)があることを確認する。
   ONの状態でBlockを開始すると、ポモドーロタイマー(25:00からの2倍速カウントダウン)が自動で
   始まることを確認する。
6. ポモドーロ作業中に「中断」を押すと、理由ワンタップ(割込み/疲労/迷い/その他)+キャンセルの
   ピッカーが出ることを確認する。理由を選ぶとタイマーが中断されること、キャンセルするとタイマーが
   継続することを確認する(記録自体を確認するUIは無い設計どおりのため、`state.blocks`の
   `interruptions`はエクスポート等で間接確認)。
7. 既存のWBS/タスクシュート/タイムライン/朝プラン/週次レビュー/レバレッジ台帳/AI連携鮮度/
   AI作業ワーカー連携/人生実験機構(v39〜v68)の動作が壊れていないことを一通り確認する。

## 確認サイン

- [ ] 実機(iPad/iPhone)で上記手順を確認
- [ ] 確認者:
- [ ] 確認日:
