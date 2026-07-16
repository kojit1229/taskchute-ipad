# CHANGES v111

## 概要

K依頼(2026-07-16)。iPad/iPhoneでポモドーロ中の脱線防止に画面ロック(ガイド付きアクセス)を
使いたいが、PWAからの自動設定はiOSの制約上不可能(調査済み)。代替として、ポモドーロ開始時に
「ガイド付きアクセスで画面をロックしますか?」というリマインドポップアップを、iOS系端末
(iPad/iPhone)のみ非ブロッキングで表示するようにした。SW `CACHE_NAME` を v110 → v111 に更新。

## ポモドーロ開始経路の調査結果

`startPomodoro(blockId)`(app.js)を実際にタイマーを開始する唯一の低レベル関数として特定した。
以下の4経路はすべて最終的にこの関数を通る(呼び出し元の分岐を追った現物確認):

1. `resumeLifecycleStart()`(宣言モーダルで「宣言して開始」/「宣言せず開始」を選んだ後)
2. `openDeclareModal()`内、対象Blockが見つからない場合の即時フォールバック
3. `setBlockTime()`内、`focusTimerAuto`(既定ON)でBlock開始と同時にタイマー自動起動する経路
   (v70)
4. `continueFocusPomodoro()`、休憩中「🔁 同じBlockで続ける」での再開

このため、`startPomodoro()`本体にフックを1箇所入れるだけで全経路を漏れなくカバーできる設計に
した(個々の呼び出し元へ分散して仕込む必要がない)。

## ポップアップ表示 vs タイマー開始の順序判断

仕様では「表示と同時にタイマーは走る」「確認→開始」のどちらが既存UXに合うか判断して報告する
よう指示されていた。**「表示と同時にタイマーは走る(非ブロッキング)」を採用した**。理由:

- `startPomodoro()`の呼び出し元(特にv70の`focusTimerAuto`自動起動)は、そもそもユーザーの
  追加タップなしでタイマーが起動する設計思想(摩擦最小)であり、ここに確認ダイアログを挟むと
  既存のフリクションレス体験を壊す。
- SKILL.mdのコミュニケーション規約・アプリの設計思想(「実行の道具に痩せさせる」)からも、
  ガイド付きアクセスの案内はあくまで補助情報であり、開始そのものをブロックする理由がない。
- 実装は`startPomodoro()`内で`saveAndRender()`(タイマー開始+永続化+トースト)の**直後**に
  `maybeShowGuidedAccessHint()`を呼ぶ形にした。モーダル用DOMルート(`#modalRoot`)は`render()`
  とは独立したDOM要素のため、後続の再描画で消えることもない。

## 変更内容

### app.js

- `normalizeState`: `settings.pomoGuidedAccessHint`(既定`true`)を補完(`focusTimerAuto`と
  同じ`typeof`ガードパターン)。
- `isIOSDevice()`(新設): iPhone/iPodはUAの`iPhone|iPad|iPod`で判定。iPadOS(v13以降は既定で
  デスクトップ版Safari同様`Macintosh`を名乗る)は`Macintosh` UA + `maxTouchPoints > 1`で判定
  (通常のデスクトップMacは`maxTouchPoints`が0のため誤検知しない)。
- `maybeShowGuidedAccessHint()` / `buildGuidedAccessHintModal()`(新設): 既存のモーダル基盤
  (`state.modal` + `renderModal()`)をそのまま再利用し、新規UI機構は作らなかった。文言は
  「サイドボタン(ホームボタン搭載機はホームボタン)トリプルクリックで開始できます」の趣旨。
  「今後表示しない」チェックボックス付き。
- `startPomodoro()`: `saveAndRender()`の直後に`maybeShowGuidedAccessHint()`を呼ぶ1行を追加。
- クリックデリゲーション: `data-action="guided-access-dismiss"`(×ボタン/「閉じる」ボタン共通)
  で、チェックボックスがONなら`settings.pomoGuidedAccessHint = false`を永続化してから
  `closeModal()`。
- 設定画面: 「実行(v70)」パネルの直後に「🔒 ガイド付きアクセス案内(v111)」パネルを追加し、
  モーダルの「今後表示しない」と同じ設定を再度ONに戻せるトグルを設けた
  (`data-setting-pomoguidedaccesshint`)。

### sw.js

- `CACHE_NAME`を`taskchute-journal-pwa-v111`に更新。

## 検証

- `node --check app.js` / `node --check sw.js` / `node --check tests/v111.test.js` すべて exit 0。
- `tests/v111.test.js`(新規、20チェック)ALL PASS:
  (1) iPhone UAでfocusTimerAuto経由のポモドーロ開始→案内モーダル表示、モーダル表示中も
  タイマーはrunning:trueのまま(非ブロッキングの確認)、(2)「今後表示しない」→設定へ永続化・
  2回目の開始では出ない、(3) デスクトップUA(タッチ無し)では一切出ない、(4) iPadOS
  (Macintosh UA+タッチ対応)でも出る、(5) 設定OFF時はポモドーロ動作自体
  (running/blockId/endsAt)が通常どおりで回帰が無いことを確認、(6) チェックせず「閉じる」なら
  設定はtrueのまま次回も出る。
- `npm run test:core`(直近5本=v107〜v111 + 固定コア5本、計10本。v70の中断/自動起動/乗っ取り
  回帰含む)ALL PASS。
- スクリーンショット: iPhone UA・390px幅でポップアップが表示された状態(背景に「ポモドーロを
  開始しました」トーストが見え、開始をブロックしていないことも視覚確認)をscratchpadへ保存。

## 未対応・懸念点

- 休憩中「🔁 同じBlockで続ける」(`continueFocusPomodoro()`)経由の再開でも同じ案内が毎回出る
  仕様にした(`startPomodoro()`への集約フックのため自動的にそうなる)。1セッション中に休憩を
  何度も挟むと案内が繰り返し出てやや煩わしい可能性がある。「今後表示しない」で恒久抑制できる
  ため実害は小さいと判断したが、Kの実際の使用感で気になるようなら「直近N分は再表示しない」
  等のクールダウンを追加で検討の余地がある。
- iPadOS判定は`Macintosh` UA + `maxTouchPoints > 1`のヒューリスティックであり、将来Safariの
  UA仕様が変わった場合は追従が必要。
