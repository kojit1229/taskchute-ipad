# v145 エネルギーバッテリー「行動接続」— 残量低下時の回復Block下書き提案(P4、opt-in・既定OFF)

承認済み設計(`workbench/out/2026-07-26-taskchute-revamp/design-proposal.md` §3「行動接続(後続
フェーズ・任意)」)の実装。v144(バッテリー本体)の最終フェーズ。新規UIは作らず、既存の
`_scheduleDraft`+draftレイヤ(`runAiMorningPlan`と同じ機構)へ1〜2件の下書きBlockとして静かに
流し込むだけ。通知・アラート・トーストは新設しない(「静かな計器」の最低線を維持)。

## 1. 設定(opt-in、既定OFF)

`state.settings.battery` に2フィールドを追加(`defaultBatterySettings()`が唯一の既定値の
正本。`normalizeState`に既存値優先のマイグレーションを追加):

- `recoveryDraft: false` — 機能全体のON/OFF(既定OFF)
- `recoveryThresholdPct: 40` — 発火しきい値(開始値に対する%。1〜100にクランプ、範囲外は既定40)

設定画面「🔋 エネルギーバッテリー(v144)」パネルに、既存パターンを踏襲したトグル
(`class="checkbox-line"`)としきい値の数値入力(`data-setting-battery-field="recoveryThresholdPct"`
=既存の汎用ハンドラにそのまま乗る)を追加した。

## 2. 判定(決定論・1日1回冪等) — `maybeSuggestRecoveryDraft(nowMinutes)`

以下がすべて成立したときだけ発火する:

1. `state.settings.battery.recoveryDraft` が true(opt-in)
2. 当日(`todayISO()`)の `computeBatteryLevel` が閾値(開始値 × `recoveryThresholdPct` / 100。
   開始値は既存の体力予算連動ロジックと同一)を下回っている
3. 本日まだ提案していない(`state.batteryRecoveryDraftDates` に当日日付が無い。
   `feedbackIngestedDates` と同じ軽量配列の冪等パターン、上限180件)

**冪等ガードは「発火条件が成立した時点」で立てる**(`maybeAutoMorningPlan` と同じ思想)。候補が
0件・空き時間が0件で結局1件も配置できなかった日も、その日は再試行しない(空振りのたびに
毎分再チェックしないため)。

## 3. 候補選定(決定論) — `computeChargeTopTitles(since, today)`

直近4週(`since`〜`today`、固定28日。判定用途のため他のstats-range連動ルールとは独立して固定)の
完了Blockを**タイトル単位**でグルーピングし、net(charge−discharge)の中央値を計算する。

- n>=3件(`BATTERY_RECOVERY_MIN_SAMPLES`)揃わないタイトルは対象外(過剰解釈防止)
- net中央値が正のものだけを候補にし、中央値の降順でソート
- 各候補の配置所要時間(`durationMin`)は同タイトルの実績時間(`_actualDurationMin`)の中央値。
  実績時間が1件も無ければ既定20分(`BATTERY_RECOVERY_DURATION_FALLBACK_MIN`)にフォールバック

v143の `computeChargeTopCategories`(カテゴリ単位、計器盤「今週のヒント」用)と同じ中央値ロジック
だが、K指示は「ルーティン/タイトル単位」のため別実装にした(カテゴリだと粒度が粗く、個々の
充電系ルーティン・タスクを名指しできないため)。最大2件(`BATTERY_RECOVERY_MAX_ITEMS`)まで採用。

## 4. 流し込み(既存draft機構への合流)

`computeFreeGaps(today)` で当日の空き時間を求め(現在時刻より前は除外、15分未満の枠は無視)、
候補を前詰めで配置する。空き枠に入り切らない候補は配置しない(詰め込まない。既存の
`fallbackMorningPlan` と同じ方針。ブロック間には同じく既存の `MORNING_PLAN_BUFFER_MIN`(10分)を
挟む)。

- 既に `_scheduleDraft`(朝プラン等、他のsourceでも可)が当日分で存在すれば、その `items` の
  末尾に合流させる(下書きを上書きしない)。**合流時は既存下書き項目の占有区間
  ([start, start+minutes])を新設ヘルパー `subtractOccupiedIntervals(gaps, occupied)` で
  空き時間から差し引いてから配置する**(computeFreeGapsは実Blockしか占有として見ないため、
  朝プラン下書きの真上に回復提案が重なる事故を防ぐ)。合流時も新規作成時と対称に
  `_draftUndo`/`_draftUndoHistoryEntry` をリセットする
- 存在しなければ新規に `_scheduleDraft = { date, items, skipped: [], source: "battery-recovery" }`
  を作る。`source` は `draftBarHTML` の表示分岐(`"ai-plan"` 以外は「⚙ 決定論配置」表示)に
  そのまま乗るため、新規ラベル・新規UIは一切追加していない
- **当日重複候補の除外**: `aiScheduleCandidates`(app.js:3848近辺)の規約に合わせ、「当日すでに
  同名Blockが存在する」「当日の`_scheduleDraft`に同名項目がある」タイトルは候補から除外する
  (最大2件へ絞る前に除外するため、除外後も上位候補をきちんと拾える。夕方発火時に今日もう
  やった「散歩」を再提案しない)
- 各下書き項目には `reason`(下書きバーのツールチップで見える。既存の `AIプラン由来` 項目と
  同じ表示経路)に「回復提案: 直近4週の充電効果(net中央値+N)が高いBlock」を入れた。また
  各項目に `source: "battery-recovery"` を持たせ、**合流(他sourceの下書きへの追記)後も
  学習ログ(`recordScheduleHistory`)にitem単位で正しい出どころが残るようにした**
  (`draft-confirm`/`draft-remove`/`draft-discard` の3箇所を `it.source || _scheduleDraft.source`
  優先へ変更。既存項目には`source`が無いため従来どおり`_scheduleDraft.source`にフォールバックし、
  既存挙動は無変化)
- 承認/個別却下/ドラッグ調整/一括確定は既存のdraft操作(`draft-confirm`/`draft-remove`/
  `draft-discard`/ドラッグ)がそのまま使える。新規操作は追加していない

## 5. 発火タイミングと非同期処理の直列化

- **アプリ起動時**: 起動シーケンスの1本の `setTimeout`(4500ms後)から、`maybeAutoMorningPlan()`
  を呼び、その戻り値(実際に朝プランを起動した場合はPromise、起動条件を満たさなければ`null`)に
  応じて回復Block下書き提案を評価する。`state.selectedDate === todayISO()` もティッカー側と
  対称に確認する
- **バッテリーティッカー更新時**: `updateBatteryTick()`(`startTimerTicker` 経由、約1分間隔で
  スロットル済み)の先頭で毎回チェックする。冪等ガードにより実際に下書きが追加されるのは
  1日最大1回

**朝プランとの競合の直列化(レビュー対応)**: `runAiMorningPlan`(AIプランJSONのfetchを含む
非同期処理)と回復Block下書き提案は同じ`_scheduleDraft`を取り合うため、同時に走らせない。
- 新設のモジュール変数 `_morningPlanInFlight` を、`runAiMorningPlan`の実行中(全ての早期returnも
  含めて`try/finally`で確実に)trueにする
- **起動時経路**: `maybeAutoMorningPlan()`が実際にrunAiMorningPlanを起動した場合はその
  Promiseを受け取り、`.then()`で朝プランの完了後に回復提案の評価を連鎖させる(起動条件を
  満たさなかった場合は`null`が返るため即座に評価してよい)。以前は起動時経路が独立した2本の
  `setTimeout`(4500ms/5000ms)で、朝プランのfetchがわずかに長引くと回復提案が先に走り、後から
  朝プランが`_scheduleDraft`を上書きして提案だけ消える一方、冪等マーカーだけは焼けたままになる
  事故があった。1本のチェーンへ統合してこの事故を根絶した
- **ティッカー経路**: `maybeSuggestRecoveryDraft`の先頭で`_morningPlanInFlight`を確認し、trueなら
  **冪等マーカーを焼かずに**そのtickをスキップする(次tickで改めて評価される。空振りと違い
  「発火条件の判定に至る前」の早期returnのため、マーカーは立てない)

**render()直呼びの廃止(レビュー対応)**: `updateBatteryTick()`は通常「全再描画しない」方針
(検索入力のフォーカス・IME入力保護のため`outerHTML`部分差し替えのみ)だが、新規下書き追加
(draft-layer/draft-barという新しいDOMを出す必要がある)は例外的に再描画が要る。当初は
「1日高々1回のレアケースだからrender()直呼びでもリスクは実質無い」としていたが、レビュー
指摘のとおりこれは実体に即さない判断だった(低頻度であることはフォーカス/IME破壊の可能性を
ゼロにしない)。既存の`renderDeferringForFocus()`(v137/v140で確立。入力中・IME変換中は
focusout/compositionendまで延期+60秒フェイルセーフ)に置き換え、まさにこの用途のために
存在する仕組みを再利用した。

## 規約遵守

- 現在時刻の取得は既存パターンと同じ `new Date()` の数値コンストラクタのみ(`new Date("文字列")`
  は一切書いていない)
- sw.js: `CACHE_NAME` を v144→v145
- 通知・アラート・トーストは一切追加していない(`showToast` を呼んでいない)
- 新規UIは設定画面のトグル+しきい値入力のみ(font-size 16pxを満たす既存 `.input`/
  `.checkbox-line` パターンを流用)。draft自体の表示・操作は既存機構そのまま

## テスト

`tests/v145.test.js`(新規、12セクション)。`page.clock.setFixedTime` で時刻を固定し、
localStorageへの状態注入 + 画面表示(下書きバー・draft-blockの有無とテキスト)で以下を検証する
(既存スイートと同じ流儀):

1. `recoveryDraft` OFF(既定)では、閾値を下回っていても何も起きない
2. 閾値を上回っている(残量が十分)間はONでも何も起きない
3. `recoveryDraft` ONかつ閾値を下回ると、下書き(`_scheduleDraft`)が1〜2件現れる。候補選定
   (n<3のタイトル・net中央値が負のタイトルは除外)
4. 1日1回の冪等: 同日内でティッカーが複数回走っても下書きは増殖しない
5. 下書きに対して既存のdraft操作(却下 `draft-remove` ・確定 `draft-confirm`)がそのまま使える
6. **既存の下書き(手動「📋 下書きスケジュール」)への追記経路**: 合流後も重ならない配置に
   なること・既存項目が上書きされず残ること
7. **当日に予定Blockがある状態での衝突回避**: 既存Blockの時間帯より後に配置される
8. **空き無し時のno-op**: 下書きは0件のままだが、冪等マーカーは立つ(発火条件自体は成立した
   ため空振りでも再試行しない)
9. `recoveryThresholdPct` のクランプ(1〜100外は既定40、範囲内はそのまま)
10. **v144時点の旧battery設定(recoveryDraft/recoveryThresholdPct無し)からのnormalizeState
    後方互換**(既存フィールドは保持、新規フィールドのみ既定値を補完)
11. **候補選定の優先順位**: net中央値が高い方(散歩)が、両方は入り切らない競合する空き時間
    (35分)を優先的に得ることを直接検証(中央値が低い方=ストレッチは除外される)
12. **朝プランとの競合直列化**: `page.route`でAIプランJSONのfetchを人為的に遅延させ、朝プラン
    処理中は回復提案がスキップされ冪等マーカーも焼かれないこと、完了後に改めて評価され発火する
    ことを確認(同一URLへの2回目のfetchがブラウザのメモリキャッシュから即時解決されて
    しまわないよう、モックの応答に`cache-control: no-store`を付けている)

**実行結果**:
- `node tests/v145.test.js` 単体実行: **44チェック全PASS**(2回連続実行して再現性確認済み。
  項目12はネットワーク遅延を使う時間依存テストのため、他項目より再現性の余地に注意。
  同一URLへの2回目のfetchがブラウザキャッシュから即時解決される問題は`cache-control: no-store`
  で解消済み)
- `node tests/run-all.js v145`: ALL PASS
- `npm run test:core`(フォアグラウンド、timeout 600000明示): **ALL PASS**(206.5s、v145が直近5本
  として対象に含まれることを確認済み。v144/v72/v59/v67/v50/v70の既存回帰も無し)
