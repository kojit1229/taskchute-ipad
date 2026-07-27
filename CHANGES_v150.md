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
集計(実績が両方揃っているBlockだけ分加算する分岐)から実質的に抜け落ちる問題があった。
`quickCompleteActualStart(block, endDateTime)`を新設し、実績開始時刻は
`block.actualStartAt || block.plannedStartAt || endDateTime`の優先順位で決める
(plannedStartAtが分かればそちらを使う=より実態に近い)。plannedStartAtが終了時刻より未来
(未着手のまま先取り完了した等)で開始>終了になってしまう場合は、`estimateMin`
(無ければplannedStartAt/plannedEndAtの差)ぶん終了時刻から巻き戻す(`subtractMinutesFromDateTime`、
それも無ければ開始=終了0分実績を許容)。日時文字列はゼロ埋めされた"YYYY-MM-DDTHH:mm"形式のため、
文字列としての大小比較がそのまま時系列の前後判定になる(既存の`localDateTimeToMs`節と同じ前提)。
tests/v150.test.js [A1]で「実績開始時刻がplannedStartAtになる」「開始≠終了」を、[A8]で
「未来のplannedStartAtは終了−予定所要へ丸め込まれる」ことを検証した。

**必須3(prefillEnergyが手入力の充放電を上書き、両レビュー一致、項目3)**: 即完了のたびに
`prefillEnergy()`を無条件適用していたため、既に手入力済みの充放電(例: 別経路で先に充/放電
セレクトを操作していた場合)が完了操作だけで中央値へ上書きされてしまっていた。
`if (!block.charge && !block.discharge)`のガードを追加し、どちらかが非0(=手入力済み)なら
prefillEnergyを呼ばない。tests/v150.test.js [A9]で、手入力値(charge:2/discharge:3)が
過去実績の中央値(4/1)で上書きされないことを反例テストとして確認した。

**必須4(完了解除で自動書き込みが残留、項目4)**: 即完了で自動補完した実績時刻・充放電は、
その場でチェックを外して完了解除しても元に戻らず「解除したのに実績だけ残る」状態になっていた。
`_quickCompleteSnapshots`(blockId→フィールドごとの`{before, after}`、セッション限りの
非永続モジュール変数)を新設し、自動補完した瞬間に退避しておく。完了解除時は、各フィールドが
「まだ自動補完時点の値のまま(=補完後に実績編集モーダル等で手を加えていない)」場合だけ
`before`へ戻す(手で直した値を巻き戻さないための安全策)。**セッションを跨いだ解除
(リロード後)は現状維持で許容する**(スナップショットが非永続のため。新規stateフィールドは
追加していない)。tests/v150.test.js [A10]で、即完了→同セッション内で解除→実績時刻・充放電が
すべて元(空/0)へ戻ることを確認した。

**必須5(再起動で次点候補が追加提案される、Codex指摘、項目5)**: `maybeRebuildRecoveryDraft`は
初回実装では単に`placeRecoveryDraftCandidates`(候補をcomputeChargeTopTitlesで毎回計算し
直すロジック)を再実行していたため、「元は2件提案し、片方は確定・もう片方は未確定のまま
PWAが破棄された」場合に、確定済み分を除外した空き枠へ**3番手の候補が新規に繰り上げ提案されて
しまう**バグがあった(ユーザーが見ていない・却下したかもしれない候補が後から出てくる)。
`state.batteryRecoveryDraftDates`の各要素を`{date, titles}`へ拡張し(旧: 日付文字列のみ)、
新規発火時に実際に配置できたタイトル一覧を記録するようにした。旧形式(文字列)は
`normalizeState`で`{date, titles:[]}`へ後方互換マイグレーションする(titles不明のため、
その日は再構築の対象外=自動的にスキップされる)。`placeRecoveryDraftCandidates`に
`opts.restoreTitles`を追加し、再構築時は「記録済みタイトルのうち当日まだ実Block化されていない
(=未確定な)ものだけ」を対象にする——`computeChargeTopTitles`を素で再実行した場合の3番手を
拾うことは無い。tests/v150.test.js [C1]〜[C4]で、(a)記録済み2件がそのまま復元される、
(b)片方確定・片方未確定なら未確定分だけが復元され記録に無い3番手は繰り上がらない、
(c)両方確定なら何も出さない、(d)旧形式マーカーは再構築スキップかつ後方互換で移行される、
の4パターンを検証した。

**必須6(レーン分割の適用範囲を限定、監督者裁定、項目6)**: 初回実装(clusterEndの延長を
実所要5分以上すべてに適用)は、実測で連続する30分Block同士まで一日中50%幅に分割してしまう
過剰適用だった(min-height 38pxとの差が大きい20分未満のBlockだけを想定していたが、
条件で絞っていなかった)。分割対象を**実所要20分未満のBlockに限定**するよう監督者裁定を
反映した(20分以上の数px〜十数px程度の食い込みはv149以前からの既存挙動として許容する)。
tests/v150.test.js [D3]で、連続する30分Block同士が引き続き全幅(left:0%)のままであることを
確認した([D1]の15分Block分割・[D2]の離れたBlock非分割は既存どおり)。

**推奨7(トースト「実績を編集」ボタンの当たり判定44px化)**: 見た目のサイズは変えず、
`.toast-action::before`の透明拡張(`inset:-8px`)で当たり判定だけ広げた
(`.home-box::before`等、既存の当たり判定拡張パターンと同じ手法)。

**推奨8(タイムラインの完了済みカードの○を解除とわかる表現に)**: `renderTimelineCard`で
`block.completed`に応じてグリフ(○→↺)・aria-label/title("完了登録"→"完了を解除")を
切り替えるようにした。現状の予定モードフィルタ(`!b.completed`)では完了済みBlockはこの位置に
描画されないため実際には到達しない分岐だが、将来の表示条件変更に備えた防御的対応として実装した。

**推奨9(showToastのblockId挿入にescapeHTML)**: `data-id="${actionOpts.blockId}"`を
`data-id="${escapeHTML(actionOpts.blockId)}"`に変更した(他のdata-id埋め込み箇所と同じ
防御の一貫性のため)。

**推奨10(styles.css:2547の死んだ--text-lg宣言を整理)**: `.home-hero-title`が2箇所で
定義されており、後方(v33節)の`font-size: 24px`が常に先勝ちのfont-size宣言を上書きしていた
(v150のトークン置換時に気づかず`20px`→`var(--text-lg)`へ書き換えてしまい、実質無意味な
変更になっていた)。前方の宣言からfont-sizeを削除し(font-weight/line-height/cursorは
このルールだけが持つ有効な宣言なので残す)、実際の表示値(24px)は変えずに整理した。

### 検証(2系統レビュー対応後)

`node tests/run-all.js v150 v81 v107 v83 v89 v115 v117 v144 v146 v145` — 全ファイルPASS
(v145は完了統一の影響テスト洗い出しには含まれないが、`batteryRecoveryDraftDates`の形式変更
[必須5]の影響を受けるため追加で実走・修正した。`hasRecoveryMarker()`ヘルパーで
新旧両形式を吸収する`.includes(TODAY)`→date一致判定へ更新)。
`npm run test:core`(直近5バージョン+固定横断コア5本)全PASS(277.6s)。
tests/v150.test.js自体は27→55チェックへ拡張し全PASS。
