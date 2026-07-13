# CHANGES v88

K本日指示の2件。

## ① Study With Me を全画面ポモドーロの背景として透過表示

これまでStudy With Me(v84)はポモドーロの通常表示にだけ対応し、全画面モード
(`renderPomodoroFullscreen`、v12の背景mp4演出)では使えなかった(v84の懸念点として明記済み)。
今回、全画面モードでもStudy With MeをONにできるようにし、「動画とタイマーを両方、全画面で観る」
というKの意図を実現した。

### レイヤ構成
- `renderPomodoroFullscreen()`にて、Study With MeがON かつ videoId 設定済みなら、
  従来の背景mp4(`<video class="pomo-bg-video">`)の代わりに `renderStudyWithMeFullscreenBg()`
  が返すYouTube iframe(`.pomo-fs-bg-iframe`、`.pomo-fs-bg-wrap`でラップ)を背景レイヤ(z-index:0)
  として敷く。OFF・videoId未設定時は従来どおりmp4背景にフォールバックする(役割が重複しないよう、
  同時に両方は出さない)。
- iframeは`object-fit`が使えない(Safari含め挙動が不安定)ため、CSSの`max()`関数で
  16:9の実寸をvw/vhの大きい方に合わせて拡大し、中央からはみ出た分を親の`overflow:hidden`で
  クリップする、古典的な「iframeでcover相当を実現する」手法を使った
  (`width: max(100vw, 177.78vh); height: max(100vh, 56.25vw);` + `translate(-50%,-50%)`)。
- 半透明フィルタ(`.pomo-bg-overlay`、既存)はそのまま重ね、その上に円形プログレス+残り時間の
  タイマー(`.pomo-fullscreen-content`)を「半透明HUD」として重ねる(`.pomo-circle-wrap`に
  `opacity:0.9`を追加)。
- 全画面内に🎥トグルボタン(`.pomo-fullscreen-swm-toggle`、既存の`toggle-study-with-me`
  アクションを再利用)を新設し、全画面に入ってからでもON/OFFできるようにした
  (通常表示でONにしてから全画面へ、の動線ももちろん維持)。

### タップ制御(pointer-events)
YouTube IFrame APIでの再生状態監視(postMessage)は過剰実装と判断し、CSSだけで
「動画のどこをタップしても再生開始できる/ボタン類は引き続き押せる」を成立させた:
- `.pomo-fullscreen.has-swm-bg .pomo-fullscreen-content { pointer-events: none; }`
  でHUD全体をタップ透過にする。
- `button` / `select` / `input` / `a` だけ個別に`pointer-events: auto`へ戻す
  (✕ボタン・🎥トグル・任意/常時タブ・開始/停止ボタン等はすべて引き続き押せる)。
- `.pomo-bg-overlay`にも`pointer-events:none`を追加(元々インタラクティブ要素を持たないので
  実害はないが、下のiframeへタップを通すために必要な変更)。

### tickの安定性(v84差分パッチの継承)
`updatePomodoroTick()`は元々`state.pomodoro.studyWithMeOn`と`state.currentView`だけで
分岐しており、全画面かどうかは見ていない。かつ全画面モードの内部も
`renderManualPomodoro`/`renderPassivePomodoro`(既存関数、無改変)を呼ぶため
`.pomo-time-overlay`/`.pomo-progress-circle`は全画面でも同じクラス名で存在する。
したがって**tick側のコード変更は不要**で、500ms tickは全画面でも従来どおり
DOM差分パッチのみ行い、背景iframeのDOMノードは再生成されない
(`tests/v88.test.js`でDOMノードマーカーによる回帰テストを追加)。

### 規約(YouTubeロゴ・コントロール等)
autoplayパラメータ・属性は付与しない(v84からの方針を継承、再生開始はユーザーのタップに委ねる)。
YouTubeのロゴ・コントロールは非表示にしていない。

## ② 未完了タスクの表示を当日+3日までに絞り込み

ホームの「未完了タスク」パネル(`homeBacklog()`)は従来、期限切れ〜当日+7日のタスクを
最大8件まで一括表示していた。件数が多いと見づらいため、当日+3日までを既定表示、
+4日以降は既存の折りたたみ機構へ格納するよう変更した。

- 全体の取得上限(7日)は維持し、その中を`当日+3日`を境に「近接(near)」「遠方(far)」へ分割。
- near(当日+3日まで、期限切れ含む): 従来どおり常時表示(最大8件のsliceも維持)。
- far(+4日〜+7日): 完全非表示にはせず、「＋4日以降 N件」の見出しを持つ
  `<details class="home-fold" data-fold-id="home-backlog-far">`に格納。
  既定closed、開閉状態はlocalStorageに記憶される(zone2/zone3/zone4と同じ
  `isHomeFoldOpen`/`toggle`イベント委譲の仕組みをそのまま再利用。新規stateフィールドは
  追加していないので`normalizeState`のマイグレーションも不要)。
  - `homeFoldSection()`ヘルパーは自動的に`panel`クラスを付けるため、`homeBacklog()`自体が
    既に`<section class="panel">`である今回はそのまま使うと「パネルの中にパネル」の
    二重の箱になってしまう。そのため、既存のzone2/zone3/zone4と同じ「パネルの中に素の
    `<details class="home-fold">`を直接書く」パターンを採用した(`homeFoldSection()`は
    未使用、`isHomeFoldOpen()`だけ流用)。
- 期限なしタスクの扱い: 従来から`t.dueDate`の真偽チェックで除外しており、この仕様は
  変更していない(現行仕様を維持)。
- v86の自動取り込みタスク(dueDate=当日)は当然near(当日〜+3日)の範囲内に入り、
  既定表示される(`tests/v88.test.js`で回帰テスト化)。

## 変更ファイル

- `app.js`: `studyWithMeSrc()`(src組み立ての共通化)、`renderStudyWithMeFullscreenBg()`(新規)、
  `renderPomodoroFullscreen()`(背景切替+🎥トグル追加)、`homeBacklog()`(当日+3日/折りたたみ分割)
- `styles.css`: `.pomo-fs-bg-wrap`/`.pomo-fs-bg-iframe`(全画面背景iframe)、
  `.pomo-fullscreen-swm-toggle`(全画面内トグルボタン)、pointer-eventsカスケード、
  `.pomo-bg-overlay`にpointer-events:none追加
- `sw.js`: `CACHE_NAME` を v87 → v88
- `tests/v88.test.js`: 新規(①全画面背景+HUD表示 ②tick中iframe再読込なし ③全画面終了/トグルOFFで破棄
  ④未完了タスク当日+3日既定表示 ⑤+4日以降は折りたたみにN件格納 ⑥自動取込タスクの表示範囲確認)

`npm test`(全36スイート)フォアグラウンド実行、ALL PASS を確認済み。

## 自信がない箇所・懸念点

- iframeでの「cover」実現(`max()`によるvw/vh計算)は主要なブラウザ挙動としては確立した手法だが、
  実機のiPhone/iPadでの見え方(ノッチ・セーフエリアとの干渉、回転時の再計算)はブラウザE2Eでは
  確認できていない。実機確認をKにお願いしたい。
- HUD全体をpointer-events:noneにする方式は「実装しやすさ」を優先した選択で、YouTube
  IFrame APIによる再生状態監視は行っていない。将来的に「再生中はHUD操作を優先」という
  より精密な制御が欲しくなった場合は、enablejsapi=1 + postMessageでの状態監視という
  別実装が必要になる(今回はスコープ外と判断)。
- 未完了タスクの「当日+3日」という境界は日付文字列の比較(`<=`)で行っており、既存の
  `addDays()`/日付文字列比較の慣習をそのまま使っているため9時間ズレ等のiOS Safari地雷は踏んでいない。
