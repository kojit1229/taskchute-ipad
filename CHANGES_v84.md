# CHANGES v84

## 概要

ポモドーロタブに「Study With Me」YouTube埋め込みトグルを追加した(taskchute-notes/ROADMAP.md
「v90: ポモドーロにStudy With Me埋め込み」を実番号v84として実装。K承認済み)。ADHD支援・疑似
ボディダブリング系(v90番台)の最初の一手。ONの間だけ`youtube-nocookie.com/embed`のiframeを
DOM生成し、OFF・タブ離脱で破棄する(常時ロード禁止=iOS PWAのメモリとタブの軽さを守るため)。

## 変更内容

### 状態・マイグレーション
- `state.pomodoro.studyWithMeOn`(boolean・既定false): トグルON/OFF状態。既存の
  `fullscreen`/`tab`と同じ「UI状態」の扱いで `persistLocalNoSchedule()`(dataModifiedAtを
  汚さない)を使う。`state.pomodoro`を丸ごと再構築している既存8箇所(startPomodoro /
  forceResetPomodoroSession / stopPomodoro / completePomodoro / goBreakPomodoro /
  endBreakPomodoro / finishBlockFromBreak / renderManualPomodoroの自動修復ブロック)すべてに
  `studyWithMeOn: state.pomodoro?.studyWithMeOn || false` を追加し、ポモドーロ開始・完了・
  休憩遷移のたびにトグルがリセットされないようにした。
- `state.settings.studyWithMe = { videoId, startSec }`(既定 `WgxzRsiIwb8` / `1986`秒 =
  Kが指定した動画): 設定画面から変更可能。`normalizeState()`に既存値優先の補完を追加。

### ポモドーロタブ
- `renderPomodoro()`ヘッダーに「🎥 Study With Me」トグルボタンを追加(全画面モードは対象外、
  既存の背景動画演出=`study_with_me.mp4`とは別機能)。
- `renderStudyWithMeFrame()`: ON時のみ `study-with-me-frame-wrap` + `iframe.study-with-me-frame`
  を生成。srcは `https://www.youtube-nocookie.com/embed/{videoId}?start={startSec}` の
  静的URLのみ(トークン等の個人情報は一切含まない)。autoplayパラメータ・属性は一切付与しない
  (iOS Safariは音付き自動再生不可のため、再生開始は常にユーザーのタップに委ねる)。

### tickの安定性(重要な内部修正)
- `startTimerTicker()`は500ms毎に、任意タイマー実行中/常時タイマー表示中は`renderMain()`
  (=`main.innerHTML`の丸ごと差し替え)を直接呼んでいた。Study With Me表示中にこれをそのまま
  使うと、返るHTML文字列が同じでもDOMノードとしては作り直しになるため、埋め込み中のiframeが
  1秒に2回再読込されてしまう(YouTube動画が常に再起動し続ける=実質使用不能かつ無駄な
  ネットワーク負荷)。これを避けるため`updatePomodoroTick()`を新設し、Study With Me表示中は
  `.pomo-time-overlay`のテキストと`.pomo-progress-circle`の進捗(stroke-dashoffset等)だけを
  直接DOM更新する差分パッチに切り替えた(v34の検索欄差分パッチと同じ考え方)。Study With Me
  非表示時は従来どおり`renderMain()`にフォールバックし、挙動は一切変えていない。

### 設定画面
- 新設パネル「🎥 Study With Me(v84)」: 動画ID・開始秒の直接編集欄 + YouTube URL貼り付け欄
  (`#study-with-me-url-input`)。貼り付けると`parseYouTubeUrl()`が正規表現でvideoIdと
  開始秒(t=/start=、数値秒 or `1h2m3s`形式)を抽出し、対応する2フィールドとstateへ反映する
  (`new Date`は使用していない)。既存の`data-vision-field`/`data-github-field`欄と同じ方針で、
  貼り付け欄自体はDOM直接更新に留め、他欄のフォーカスを奪わないようにした。

### スタイル
- `styles.css`に`.study-with-me-frame-wrap`(16:9のレスポンシブ枠)/`.study-with-me-frame`を追加。
- 設定画面の新規input欄は既存の`.input`クラスを使用しているため、iOS自動ズーム防止の
  `font-size: 16px`は既存のメディアクエリ経由でそのまま適用される(追加CSS不要)。

### Service Worker
- `CACHE_NAME`を`v83`→`v84`に更新。
- **確認結果**: `sw.js`のfetchハンドラは`url.origin !== self.location.origin`の場合に即
  `return`しており(既存実装、v24/v38由来)、同一オリジン以外(youtube-nocookie.com含む)への
  リクエストはSWを経由しない。iframeが外部ドメインへ発行するリクエストはSWキャッシュ対象外で
  あることをコード現物で確認済み。対応不要(コード変更なし)。

## テスト

`tests/v84.test.js`(新規)。実際のブラウザ(Playwright/Chromium)でapp.jsを無改変のまま動かし検証:
1. トグルON: iframeが`https://www.youtube-nocookie.com/embed/WgxzRsiIwb8?start=1986`形式で
   生成される。autoplayパラメータ・属性なし。
2. トグルOFF: iframeが破棄される。
3. Pomodoro以外のviewへ遷移: iframeが破棄される(トグル状態自体はstateに残り、戻ると復元)。
4. 常時タイマー(passiveタブ)表示中、500ms tickを2〜3回挟んでも同一DOMノードのままである
   ことをJSプロパティのマーカーで確認(tick安定性の回帰テスト)。カウントダウン表示自体は
   差分更新で変化し続けることも確認。
5. 設定画面: 動画ID/開始秒の直接編集の反映、URL貼り付け(数値秒/youtu.be短縮形/複合h・m・s
   形式/embed形式/t指定なし/非YouTube文字列)からの抽出、iOS 16px入力ルールの充足。
6. normalizeStateの後方互換(旧state再現→補完された既定値がUIに反映される。既存値優先の
   部分マイグレーションも確認)。
7. プライバシー: GitHubトークンを設定した状態でも、iframe srcに含まれないこと・想定の
   静的URL形式のみであることを確認。

`npm test`(全量)で ALL PASS を確認済み(実行結果は本ファイル末尾の実装完了報告を参照)。

## 自信がない箇所・懸念点

- tickの差分パッチ(`updatePomodoroTick`)は、`renderManualPomodoro`内にあるセッション
  異常値の自動修復ロジック(60分超過・時計巻き戻し等)を複製していない。この自動修復は
  ticker側の期限切れ判定(`endsAtMs <= now`)で通常カバーされるため実害は小さいと判断したが、
  極端な時計操作系の異常系は次回フル再描画(タブ切替等)まで補正されない。
- 全画面モード(`renderPomodoroFullscreen`、背景に`study_with_me.mp4`ループ再生)には
  Study With Meトグルを追加していない(既存の背景動画演出と役割が重複するため、スコープを
  通常表示のみに絞った)。将来的に両立させたい場合は設計の相談が必要。
- iPhone縦/iPad横の実機レイアウト確認はしていない(ROADMAPの検証方法に記載があるが、
  今回はブラウザE2Eのみで完走。実機確認は別途K本人にお願いしたい)。
