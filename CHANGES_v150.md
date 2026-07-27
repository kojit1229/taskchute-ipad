# v150 UI改善計画Phase4b(残る構造課題、K指定2026-07-27)

入力: `workbench/out/2026-07-27-taskchute-ui-review/ui-improvement-plan.md`(Phase4節、
claude-ux-review.md の T4/H4/R3/R9、codex-ui-review.md の S3/S4/S7 が根拠)。
Phase4aはv149で実装済み(ホームの「今日」/「ホーム」2タブ分割)。本コミット群は残る4項目を
実装し、UI改善シリーズを完結させる。機能削除は無い。

## 1. 「完了」作法の統一(R3、T4/H4対応)

**変更前**: 完了導線が2系統に分裂していた。
- `toggle-block`(タスクシュートの✓・checkbox-button): 直接completed化(モーダル無し)
- `complete-block-with-actual`(ホームのドット・タイムラインの○・「いま、これ」の完了ボタン):
  実績登録モーダル(実績開始/終了・充放電・コメント)を開き、保存して初めて完了する

同じ「完了」操作なのに入口によって挙動が違い(T4)、見た目からは判別できなかった。

**変更後**: すべての完了導線を `toggle-block`(即完了)へ一本化した。

- 対象: `homeHero()`(「いま、これ」の✓完了にするボタン)/ `homeCheckRow()`(今日の主役MIT・
  今日のルーティン)/ `homeTaskchute()`(今日のタスクシュート)/ `homeFlow()`(今日のながれ)/
  `renderTimelineCard()`(タイムラインの○)。data-action を `complete-block-with-actual` から
  `toggle-block` へ変更しただけで、DOM構造・クラス名は変えていない。
- `toggleBlock(id)`(app.js)を拡張: 完了へ切り替わる瞬間(false→true)に、
  - `actualStartAt`/`actualEndAt` が未設定なら現在時刻で自動記録(従来は `actualEndAt` のみ
    未設定時補完・`actualStartAt` は補完されず、タイムライン実績モードから漏れる既存の
    抜け穴があった。今回あわせて解消)
  - 充放電を `prefillEnergy()`(実績登録モーダルと同じ、過去実績3件以上の中央値)で補完
    (従来の `toggle-block` 系はcharge/dischargeに一切触れておらず0のまま残っていた)
  - 完了解除(true→false、チェックを外す方向)は従来どおり何も補完しない
- 完了(true化)した瞬間だけ、トーストへ「実績を編集」ボタンを添える(`saveAndRender`の
  第2引数 `{ blockId, actionLabel }` → `showToast` が `data-action="complete-block-with-actual"`
  のボタンをトースト内に描画)。押すと**既存の実績登録モーダルがそのまま開く**(削除していない、
  編集導線として存続)。完了解除方向のトーストはボタン無しの従来どおりの見た目。
- ポモドーロ完了経路(`completePomodoro`)は対象外・現行維持(K指示)。この経路は
  `toggleBlock`/`complete-block-with-actual` のどちらも経由しないため、コード変更なし
  (tests/v87.test.jsの全件成功で非破壊を確認)。

## 2. タイポ・余白トークン(S4、段階移行の第1弾)

`styles.css` の `:root` に以下を新設した:

```css
--text-xs: 12px;  --text-sm: 14px;  --text-md: 16px;  --text-lg: 20px;
--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px;
```

**適用範囲**: 全17,000行の一括置換はしていない。今回触った範囲(トースト新規CSS)+
ホーム/今日タブのCSS(`.home-*` セレクタ)+ジャーナルのCSS(`.journal-*` セレクタ)の中で、
既存の生px値が上記トークンの値と**完全一致するもの**だけを機械的に `var()` 参照へ置換した
(54箇所、font-size 12/14/16/20px・margin/padding/gap系の4/8/12/16/24px)。
- 一致しない値(9〜11.5px・11px・13px・21px・35px 等)は意図的に変更していない
  (装飾値・視覚階層として既に確立している値を、トークン都合で変えると別の回帰になるため)。
- 数値そのものは一切変えていない(`14px` → `var(--text-sm)` のように、計算結果が同じ参照へ
  差し替えただけ)。iOSズーム防止の16px系(`.home-ideal-input` 等)も `var(--text-md)` = 16px
  で値は変わらない。
- 適用箇所の例: `.home-score-lab`(font-size: var(--text-xs))、`.home-hero-title`(font-size:
  var(--text-lg))、`.journal-grid h2`(720px以下、font-size: var(--text-sm))。

## 3. 回復候補ドラフトの再構築(S7)

**問題**: v145の回復ドラフト提案は、1日1回の冪等マーカー(`state.batteryRecoveryDraftDates`、
永続)を立てたあと、実際の下書きは `_scheduleDraft`(モジュール変数、非永続)へ積む設計だった。
iOS SafariがPWAプロセスを破棄した後の再起動では `_scheduleDraft` がリセットされる一方
`batteryRecoveryDraftDates` は残るため、「提案が出た事実だけが残り、Homeの回復候補→
Timelineへの導線が消える」状態になりうる(S7で指摘)。

**対応**: 新規stateフィールドは追加せず、起動シーケンスに再構築ステップを1つ追加した。

- `maybeSuggestRecoveryDraft()` から候補計算+配置+`_scheduleDraft`マージの本体を
  `placeRecoveryDraftCandidates(today, nowMinutes)` として切り出した(挙動は無変更、
  リファクタのみ)。
- 新設 `maybeRebuildRecoveryDraft(nowMinutes)`: 「当日の冪等マーカーがある」+「現在の
  `_scheduleDraft` に当日の `source:"battery-recovery"` 項目が無い」を満たすときだけ
  `placeRecoveryDraftCandidates` を再実行する。**閾値判定・冪等マーカーの再設定はしない**
  (呼び出し時点でどちらも既に成立済みとして扱う)。「未確定」の判定は新フィールドを使わず、
  `placeRecoveryDraftCandidates` 内の既存の重複除外ロジック(当日に同名Blockが既にあれば
  除外)へそのまま委ねる — 確定済み(=同名の実Blockが当日に存在する)候補は自然に再提案されない。
- 起動時の `checkRecoveryDraft`(app.js末尾、朝プランの完了を待ってから評価する箇所)で、
  `maybeSuggestRecoveryDraft` が新規発火しなかった場合のフォールバックとして
  `maybeRebuildRecoveryDraft` を1回だけ呼ぶ。`updateBatteryTick`(1分ごとのティッカー)には
  **載せていない** — 同一セッション内でユーザーが確定/却下した直後も「マーカーあり+draft無し」
  の条件は一致してしまうため、毎分ループに載せると確定・却下済みの提案を蒸し返してしまう。
  「新規stateフィールドを増やさない」方針を優先した結果のトレードオフとして、起動時1回のみに
  絞った(詳細はコード内コメント参照)。

## 4. タイムライン短時間Blockの重なり解消(R9)

**問題**: `adjustLaneTopPositions()` が描画時に `min-height`(通常38px、5分未満は14px)を
強制するため、実時間では連続していて重ならない短時間Block(例: 15分×2、1xズームで本来15px)
同士でも、描画上の高さが次のBlockのtopへ食い込み物理的に重なっていた(L2)。

**対応**: 「タイムラインは開始時刻ベースの絶対配置を厳守し、レーン補正(縦方向のずらし)を
入れない」という正典ルールには触れず、**既存の横レーン分割(重なり検出→段差配置)の判定条件へ
min-height換算の実効終了時刻を織り込む**方式で解消した。

- `assignBlocksToLanes(blocks, mode, maxLanes, rowHeight)` に第4引数 `rowHeight` を追加。
- 各Blockについて、実時間の `end` とは別に `clusterEnd = max(end, start + minHeightPx/rowHeight*60)`
  を計算し、クラスタ判定(重なり検出)・レーン内の「空いているレーン」判定の両方でこちらを使う。
- `top`(開始時刻の絶対位置)・実時間の `height`(min-height適用は従来どおり
  `adjustLaneTopPositions` 側のみ)には一切触れていない。結果として、実時間では重ならない
  短時間Blockでも、描画上の高さで次のBlockへ食い込む場合だけ横に段差配置(50:50等)される。
  離れた時刻のBlock同士は従来どおりレーン分割されない(過剰適用の防止、tests/v150.test.js [D2]で確認)。

## 検証

`tests/v150.test.js` を新規追加(A: 完了統一7項目 / B: トークン定義+適用範囲2項目 /
C: 回復候補の再構築3項目 / D: タイムライン非重なり2項目、計27チェック全PASS)。

### 既存テストへの影響(完了導線の挙動変更、洗い出しと実走結果)

`complete-block-with-actual` / `toggle-block` を操作・参照する全テストをgrepで洗い出し
(action名・関連DOM要素・トースト文言・prefillEnergyの計12キーワードで包含関係も含めて検索)、
該当した以下16ファイルを全実走した。

- tests/v56.test.js — ALL PASS(無風)
- tests/v70.test.js — ALL PASS(無風、タイムライン実行接点の回帰)
- tests/v81.test.js — **要修正・修正済み**: `.home-box`/`.tl-complete-btn`への直接クリックが
  「実績を登録」モーダルを開く前提のアサーションが、即完了へ仕様変更したため不成立になった。
  新しい仕様(即完了→トーストの「実績を編集」からモーダルを開く)を検証する形に更新
- tests/v83.test.js — ALL PASS(丸チェック統一の見た目回帰、無風)
- tests/v87.test.js — ALL PASS(ポモドーロ完了経路の非破壊確認、無風)
- tests/v89.test.js — ALL PASS(ルーティン一括チェックのtoggle-block経路、無風)
- tests/v98.test.js — ALL PASS(無風)
- tests/v107.test.js — **要修正・修正済み**: 390px幅の `[data-action="toggle-block"][data-id=...]`
  セレクタが、タイムラインの○もtoggle-blockへ一本化されたことで2件ヒットするようになった
  (タスクシュート行の✓ と `#timelineRail` 内の○。後者は390px幅でCSS非表示だがDOM上には存在)。
  `.checkbox-button` クラスで一意に絞るセレクタへ修正(検証意図は無変更)
- tests/v108.test.js — ALL PASS(無風)
- tests/v111.test.js — 全件成功(無風)
- tests/v115.test.js — ALL PASS(無風)
- tests/v117.test.js — ALL PASS(無風)
- tests/v124.test.js — ALL PASS(無風)
- tests/v127.test.js — ALL PASS(無風)
- tests/v144.test.js — ALL PASS(無風)
- tests/v146.test.js — ALL PASS(無風)

修正した2ファイル(v81/v107)も含め、上記16ファイル+新規tests/v150.test.jsを合わせた
17ファイルすべてが最終的に全PASS。

### 全体ゲート(初回実装時点)

`npm run test:core`(直近5バージョン=v146〜v150+固定横断コア5本=v50/v59/v67/v70/v72)を
実行し全PASS(210.0s)。push前・CIでの全量実行(`npm test`)は別途必要。

## 5. 2系統レビュー対応(Claude+Codex、初回実装後)

初回実装のレビューで6件の必須修正+4件の推奨修正を受け、すべて対応した。

**必須1(トーストの透明当たり判定が残留、両レビュー一致・最重要)**: `showToast()`の消滅タイマーが
`classList.remove("show")`のみで`has-action`を外していなかったため、非表示化後も
`opacity:0`のまま`pointer-events:auto`の透明領域がボトムナビ中央3ボタンの上に居座り続け、
そこをタップすると実績登録モーダルが誤って開く事故が実測で確認された。
`toastTimer = setTimeout(() => toastEl.classList.remove("show", "has-action"), ...)`へ修正し、
CSS側にも保険として`.toast:not(.show) { pointer-events: none !important; }`を追加した(二重の
防御。将来has-actionだけが残る別の経路が生まれても事故らない)。tests/v150.test.js [A11]で
`document.elementFromPoint`によりボトムナビ位置の当たり判定を実測し、表示中はトースト側に
ある(前提確認)・消滅後はトースト側ではなくなることの両方を検証した。

**必須2(0分実績で日報の時間集計が壊れる、項目2)**: 即完了時にactualStartAt/actualEndAtを
両方「現在時刻」で埋めると、着手前に先取り完了したBlockが実績0分になり、日報「時間実行」の
