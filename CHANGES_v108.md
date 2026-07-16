# CHANGES v108

## 概要

K承認(2026-07-16)による、Block保存の二重送信と繰り返しルールの重複生成の再発防止。
2026-07-15調査で確定した2026-05-22の実害(同一秒に同タイトル「宣言(今日も最高の一日にします!)」の
繰り返しルールが2本生成され、日報に宣言ブロックが2カテゴリ重複記録された)への対応。

SW `CACHE_NAME` を v107 → v108 に更新。

併せて、mainのCI赤(run 29463701823、v107 push後)を先行修正した(監督者判断の緊急追加スコープ、
独立コミットとして本体より先に着手・別コミットで完結済み。詳細は下記「CI赤の先行修正」参照)。

## 原因の整理(2026-07-15調査の結論)

`saveBlockFromModal()`(app.js)内の `createRecurrenceRule()` 呼び出し2箇所(新規Block作成時/
既存Blockを繰り返しシリーズ化する時)には、(1) 保存処理自体の再入防止、(2) 同一内容のルールが
既に存在する場合の重複防止、のいずれのガードも無かった。iPad Safariでの保存ボタン二重発火が
最有力仮説(未確定)。コード調査で以下を確認:

- `submitModal()` には `state.modal` のnullチェックがあるが、これは「モーダルが閉じた後の
  再クリック」だけを防ぐもので、「二重発火により独立したBlock作成フローが2回走り、それぞれが
  別idで繰り返しルールを作る」ケースは防げない(実際の事故はこの形と推定: 生成された2本の
  ルールはcategory・anchorDateが異なり、同一保存の単純な多重コミットではなく独立した2回の
  新規作成だったと考えられる)。

## 変更内容

### app.js

- `_blockSaveInFlight`(モジュール変数、非永続)を新設。`saveBlockFromModal()` の実行中は
  true になり、完了/失敗いずれも `finally` で必ず false に戻す(再入時は即return)。
- クリックデリゲーションの `modal-save` アクション: `state.modal.type === "block"` の場合のみ、
  保存ボタンを処理開始時に `disabled=true`、モーダルが開いたまま戻ってきた場合(バリデーション
  失敗・重複ルール検知)は再度押せるよう `disabled=false` に戻す。他モーダル種別は対象外
  (スコープ外、下記「残るリスク」参照)。
- `findActiveDuplicateRecurrenceRule(title, startTime)`(新設): タイトル完全一致(trim後)+
  開始時刻(`plannedStartAt`のHH:MM:SS部分)一致で、`deleted:false` のアクティブなルールを
  検索する。
- `createRecurrenceRule(block, kind)`: 冒頭で上記の重複チェックを行い、該当ルールがあれば
  `showToast()` で通知して `null` を返す(作成しない)。戻り値が変わったため、呼び出し側2箇所
  (新規Block作成時/既存Blockのシリーズ化時)に `if (!rule) { ... }` の分岐を追加。新規作成時は
  Block自体も保存せずモーダルを開いたままにし、既存Block編集時は直前に確定済みのBlock本体の
  編集だけ保存してシリーズ化のみスキップする(いずれも黙って握りつぶさない)。

## 判定基準について

「同タイトル・同時刻帯」の判定は、ルールスキーマ(`title`/`startTime`)を見て
**タイトル完全一致(前後空白trim)+開始時刻(HH:MM:SS)完全一致** を採用した。カテゴリや
`kind`(毎日/毎週等)までは見ない — 別カテゴリで登録し直したい・繰り返し頻度を変えて登録し
直したいケースまで誤ブロックしないため。`deleted:true` のルールは対象外(過去に終了させた
シリーズと同名同時刻で再登録したいケースを妨げない)。

## CI赤の先行修正(監督者からの緊急追加スコープ、v108本体とは独立コミット)

main CIが赤(run 29463701823、v107 push後)。原因はv107ロジックではなく、`tests/v97.test.js`/
`tests/v98.test.js` の `TODAY` ハードコード(2026-07-15)が実行日(2026-07-16)からズレたことで
顕在化した既知の脆弱性(CHANGES_v107.mdで実装者も警告済み)。app.js起動時に
`state.selectedDate = todayISO()`(実時計)へ強制されるため、フィクスチャの期日計算・
Block.dateが選択日とズレて境界判定・`.timeline-card`描画が壊れていた。

v89/v90の先例(コミット79995b9、`page.clock.setFixedTime`)と同じ流儀で、両スイートの `TODAY` を
実行時の「今日」10:00に固定する動的算出へ修正(アサーションの削除・弱体化はしていない)。
独立コミット `test: v97/v98スイートの実時刻依存フレークを修正(CI赤の解消)` として先に作成済み。

grep棚卸し: 同様に `TODAY` をハードコードしている `tests/v95.test.js` / `tests/v96.test.js` /
`tests/v99.test.js` / `tests/v107.test.js` も将来同種のリスクを持つが、今回の修正対象
(CI赤の2本)には含まれないため申し送り(監督者判断待ち)。

## テスト

`node --check app.js` / `node --check sw.js` / `node --check tests/v108.test.js` /
`node --check tests/v97.test.js` / `node --check tests/v98.test.js` すべて exit 0。

`tests/v108.test.js`(新規、15チェック)ALL PASS。修正前のapp.js(一時的に巻き戻し)では
「同一内容の新規Block作成を2回連続実行」シナリオで実際に2本目の繰り返しルール(別
`recurrenceGroupId`の系列)が生成されることを確認し、修正後は生成されないことを確認済み
(再現→修正確認の両方を実施)。

`tests/v97.test.js` / `tests/v98.test.js` 個別実行 ALL PASS(CI赤修正分、実日付のままモック無しで
確認)。

`npm run test:core`(直近5本=v104〜v108 + 固定コア5本=v50/v59/v67/v70/v72、計10本)ALL PASS。

## 残るリスク・未対応

- 二重発火の正確な発生メカニズムは未確定(iPad Safari実機ログが無い、仮説のまま)。今回の
  ガードは「実行中フラグ+ボタンdisable」(再入防止)と「同名同時刻ルールの重複防止」の
  二重の防御であり、後者は実際の事故の証跡(2本のルールがcategory/anchorDate違いで
  独立生成されていたこと)と整合する形でE2E検証済み。前者(再入防止フラグ)は、この
  アプリがtype="module"かつグローバルクリックデリゲーション一本+`closeModal()`が同期的に
  モーダルDOMを除去する構成のため、実ブラウザの2回の独立したclickイベントによる純粋な
  再現がE2Eでは作りにくく、コードレビュー(try/finallyの構造)による検証に留まる
  (defense-in-depth)。
- 他の保存系での同型の二重発火リスク(今回はスコープ外、対応していない):
  - `saveTaskFromModal` / `saveProjectFromModal` / `saveActualEntryFromModal` /
    `saveQuestionFromModal` / `saveExperimentFromModal`(いずれも`submitModal()`経由で
    同じ`modal-save`ボタンを共有するが、今回のボタンdisableガードは
    `state.modal.type === "block"` の場合のみ有効化しており、これら5経路は対象外)。
  - `confirmDeclare()` / `finishReport()`(v87宣言・終了報告ループ)も同種のワンタップ確定
    UIで、二重発火時の再入防止は未実装。
  - `addTask()` / `addProject()` / `addExperimentOrGuard()` 等、モーダルを介さない
    直接追加系アクションも同様に未対応。
- CI赤の先行修正で見つけた同様のリスク(`tests/v95.test.js` / `v96.test.js` / `v99.test.js` /
  `v107.test.js` のTODAYハードコード)は未着手(申し送り)。
