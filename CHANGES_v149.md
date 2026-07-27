# v149 UI改善計画Phase4a(基盤・K指定2026-07-27)

入力: `workbench/out/2026-07-27-taskchute-ui-review/ui-improvement-plan.md`(Phase4a節、
2026-07-27にKが設計を確定・承認)。本コミット群はホームを「ホーム/今日」の2タブに分割し、
日付ナビをヘッダーへ統合して縦幅を圧縮する。機能削除は一切していない(カードの所属タブ振り分けと
日付ナビの移動のみ。各カードの中身・data-actionは無変更)。

## 4a-1. ホームの2タブ分割

`app.js` の `renderHome()` を、ヘッダー+タブバーの薄いディスパッチャに変え、本体を
`renderHomeTodayTab()`(「今日」)と `renderHomeReflectTab()`(「ホーム」)の2関数に分割した。

- タブ選択はモジュール変数 `homeTab`(非永続、`let homeTab = "today"`)で保持する。state /
  localStorage には一切保存しない — **起動・リロードのたびに必ず「今日」へ戻る**(K指定)。
  タブ切替ボタンは `data-action="home-tab" data-tab="today"|"home"` で、クリックハンドラは
  `homeTab` を更新して `render()` するだけ(vision画面の `vision-section` と同じ最小実装)。
- タブUIは既存の `.segmented`(タイムラインの予定/実績切替と同じ見た目パターン)を流用し、
  `.home-tabbar` として配置した。
- **タブ切替時に自動スクロールは発火しない**: `renderMain()` の既存ロジック(v146)は
  `view !== _lastScrollView || state.selectedDate !== _lastScrollDate` のときだけ
  `.home-hero` へ自動スクロールする。タブ切替は `state.currentView`(常に`"home"`のまま)も
  `state.selectedDate` も変えないため、この判定に一切手を入れずに自動抑制される
  (追加コード不要、既存実装の副産物として満たされた)。

### カード対応表

| K指定の名称 | 実装上の関数/要素 | 振り分け先タブ |
|---|---|---|
| いま、これ | `homeHero()` | 今日(既定) |
| 今日の主役MIT | `homeMIT()`(`#home-mit-anchor`) | 今日 |
| 今日のタスクシュート | `homeTaskchute()`(`#homezone-1`) | 今日 |
| 今日のリズム | `homeFlow()`+`homeRoutine()`(`#homezone-2`、縮退時は`zone2-degraded`) | 今日 |
| 今日の状態カード | `homeTodayStatusCard()` | 今日 |
| ルーティン警告 | `homeDegradedBanner()`/`homeRoutineCheckBanner()` | 今日 |
| 読書 | `homeReadingCard()` | 今日 |
| 12週サイクル | `homeCycle()`(`#homezone-3`、非foldable) | 今日 |
| 今日の足あと | `homeSteps()`(`#homezone-4`) | 今日 |
| 未完了 | `homeBacklog()` | 今日 |
| (その他、今日の主役以外に振り分けなかったもの) | `homeWeeklyWishCard()` / `homeScoreboard()` | 今日 |
| 三つの信条 | `homeCreedBody()`(`.home-creed`、下記参照) | ホーム(タブを開くたび既定open) |
| 寿命カウントダウン | `homeLifespanBody()`(`.home-lifespan`、下記参照) | ホーム(タブを開くたび既定open) |
| アファメーション | `homeIdeal()`(今日の理想)+`homeDeclarationCard()`(今日の宣言) | ホーム |
| 80歳ビジョン | `homeVisionCard()`(ビジョンボード「80歳」ページへのワンタップ導線、下記参照) | ホーム |
| AIから | `homeAiHubBody()`(`data-fold-id="ai-hub"`/`"ai-hub-degraded"`) | ホーム(既定closed) |
| 長い弧をたしかめる | `homeQuestions()`(開いている問い)+`homeWeeklyLink()`(週次/サイクルレビュー導線)。`data-fold-id="zone3"`、既定closed | ホーム |

**「アファメーション」の対応付け**: K指示原文「アファメーション(今日の理想/宣言まわりの該当カード)」
に従い、`homeIdeal()`(今日の理想ワンライナー)と `homeDeclarationCard()`(今日の宣言)をホームタブへ
移動した。従来はどちらも「今日」の行動系エリア上部にあったが、今回の指示で明示的にホームタブ行きと
指定されているため、そのとおりに移動した(監督者確認済み判断ではなく、指示文の読み替え)。

**「80歳ビジョン」の対応付け(2系統レビュー対応で追加)**: 初回実装時点ではホーム画面に該当する
カード・機能が存在しなかった(既存実装は「ビジョン」タブのビジョンボード内サブページとしてのみ
存在)ため「該当なし」と報告したが、レビューで新規カード追加の指示を受け、`homeVisionCard()`を
新設した。ホームカードとして80歳ビジョンのPDF/画像そのものを複製表示するのではなく、既存の
ビジョンボード(`renderVisionBoard()`、`state.settings.visionSection="board"`+
`visionBoardIndex=2`)へワンタップで遷移する導線カードとした(`openVisionBoard(2)`、
`data-action="open-vision-board"`)。機能の複製ではなく既存導線への入口を増やすだけに留めた
(表示ロジックの二重実装を避けるため)。

### 「長い弧をたしかめる」の分割(K指定の文字どおりの解釈)

旧実装は `homezone-3`(青ゾーン、`data-fold-id="zone3"`)の折りたたみ内に
`homeCycle()`(12週サイクル)・`homeBacklog()`(未完了タスク)・`homeQuestions()`(開いている問い)・
`homeWeeklyLink()`(週次/サイクルレビュー導線)の4つをまとめて格納していた。

K指定は今日タブ側リストに「12週サイクル」「未完了」を明記し、ホームタブ側リストに「長い弧を
たしかめる」を別項目として明記している(=既存の1つの折りたたみを指す言葉ではなく、
`homeCycle()`自体のsummary見出し文言「12週サイクル」と、zone3のsummary見出し文言
「長い弧をたしかめる」をそれぞれ別カードとして指している)。このため:

- `homeCycle()`(12週サイクル)と `homeBacklog()`(未完了タスク)は、今日タブへ独立カードとして
  移動した。青ゾーン(`z-blue`)の視覚的な括りからは外れ、通常の`<section class="panel">`として
  表示される(`homeCycle()`のジャンプ先idは `#homezone-3` のまま今日タブ側に残した→後述)。
- `homeQuestions()`(開いている問い)と `homeWeeklyLink()`(週次/サイクルレビュー導線)は、
  「長い弧をたしかめる」(`data-fold-id="zone3"`、既定closed=既存仕様を維持)としてホームタブに
  残した。ラップ用の`id`は重複を避けるため`home-arc-zone`に変更した(旧`homezone-3`は今日タブの
  12週サイクルカードへ譲った)。

### スコアボードのジャンプ先の変更

`homeScoreboard()`の「12週 今週」セル(`data-id="homezone-3"`)は `home-jump` アクションで
`document.getElementById("homezone-3")` へスクロールする。上記の分割により、この参照先は
「今日タブの12週サイクルカード(非foldable)」になった。旧仕様(長い弧の折りたたみを自動的に
開いてからスクロールする)は、ジャンプ先がそもそも折りたたみでなくなったため意味を失った
(常時表示・タブ内に既に見えているため開閉動作自体が不要)。挙動としては「クリックで
scrollIntoViewが呼ばれる」点のみ維持し、「ホームタブのzone3が自動で開く」という副作用は
発生しなくなった(そもそも無関係なカードになったため)。

## 4a-2. 日付ナビのヘッダー統合(ホームビューのみ)

`renderDateBar()`(前日/日付ピッカー/翌日/今日へ(非当日のみ)/🔍検索)自体は無変更のまま、
**ホームビューの `renderHeader()` 呼び出しの action 引数**(タイトル行の空きスペース、従来
「▶ Now」「今日へ」ボタンが並んでいた場所)へ埋め込み、直後の独立行(`${renderDateBar()}`)を
削除した。ホームの縦幅圧縮という目的を満たしつつ、変更を最小化した:

- 旧: ヘッダー action=「▶ Now」+「今日へ」(常時表示の固定ボタン) → その下に独立行で
  `renderDateBar()`(前日/日付/翌日/今日へ(非当日のみ)/🔍)。**「今日へ」ボタンが2箇所に
  重複していた**(非当日を見ている間)。
- 新: ヘッダー action=「▶ Now」+ `renderDateBar()` を1つのrow(`flex-wrap:wrap`)にまとめた。
  固定の「今日へ」ボタンは削除し、`renderDateBar()`側の条件付き「今日へ」(非当日のみ表示)に
  一本化した。重複が解消された。
- CSS: `.view-header .datebar { margin-bottom: 0; }` を追加(ヘッダー内に埋め込む際、独立行
  だった頃の下マージンが不要になるため)。この規則は `.view-header` の子孫としての `.datebar`
  にのみ効き、他5ビュー(タスクシュート/タイムライン/ルーティン/ジャーナル/日報)の
  `.datebar`(`.view-header` の外、独立行のまま)には影響しない。

**判断: ヘッダー統合はホームビューのみに適用し、他5ビュー(タスクシュート/タイムライン/
ルーティン/ジャーナル/日報)は現状維持(独立行のまま)とした。** 依頼文は「してよい」という
許可であり必須要求ではなく、他5ビューを含めると影響テストの範囲が大きく広がる
(`renderDateBar()`を参照する既存テストは30本以上あり、date-prev/date-next/today等の
data-action自体は変えないため多くは無風だが、DOM構造・タイミングを直接前提にしている箇所の
洗い出しコストが本タスクのスコープに対して過大)。K確認の上、必要であれば別チケットで他ビューへ
展開する。

## 検証(375px幅)

`tests/v149.test.js` に以下を実装:
- 既定タブは「今日」(起動直後・リロード後とも)
- タブ切替で表示カードが入れ替わる(今日タブのカード群がホームタブでは消え、逆も同様)
- 信条・寿命はホームタブを開くたび既定open(下記4a-3参照。折りたたみ機構自体は維持、
  summaryクリックで閉じられる)
- 日付ナビ(前日/日付ピッカー/翌日)がホームビュー中に1回だけ存在する(ヘッダーへ統合済み、
  独立行の重複が無い)
- 375px幅で横スクロールが発生しない(`scrollWidth <= clientWidth`)。かつヘッダーの
  ▶Now・日付ナビ・タブバーが重ならず全て可視である
- タブ切替は非永続(リロードで「今日」に戻る)

## 4a-3. 2系統レビュー対応(Claude+Codex、初回実装後)

初回実装のレビューで6件の必須修正+3件の推奨修正を受け、すべて対応した。

**必須1(毎分全再描画のリスク)**: `updateBatteryTick()`(500msティッカー内、1分間隔スロットル)
の`else if (!computeHomeBatteryInfo(...).ok) renderDeferringForFocus()`分岐は、`.home-today-status`
が今日タブ専用DOMのため、ホームタブ滞在中は`statusCard`が常にnullになり、電池残量が
`BATTERY_OK_PCT`(40%)未満の間、毎分`renderDeferringForFocus()`(全再描画)が発火し続けていた
(ホームタブで宣言・理想を書いている最中に割り込む恐れ)。`state.currentView === "home" && homeTab === "today"`
のガードを追加し、ホームタブ滞在中はこの分岐自体を評価しないようにした。

**必須2(375pxで縦幅+84px悪化)**: 720px以下で`.view-header`がgrid1列化しaction欄の横幅が縮み、
`.datebar`(前日/日付/翌日/🔍)が2行に折り返して87px(実測)に膨らんでいた。`.view-header .datebar`
限定で`flex-wrap:nowrap`+ボタンpadding圧縮+日付inputのmax-width(170px→104px、font-size 16pxは
iOSズーム防止のため維持)を適用し1行(37px)に収めた。加えて`.home-header-wrap`
(`renderHome()`専用のラッパー、他ビュー無関係)で`.view-header`のmargin-bottom・`.buffer-meter`の
margin・`.home-tabbar`のmargin-bottomを圧縮。**実測(375px幅、Chromium、同期異常バナー等の
アーティファクトを除いた条件)**:

| 指標 | 修正前(レビュー時点) | 修正後 | 目標 |
|---|---|---|---|
| `.datebar`の高さ(2行→1行) | 87px | 37px | — |
| `.view-header`の高さ | 199px | 101px | — |
| `.home-hero`のoffsetTop | 422px(banner artifact込み。除いた場合328px) | **196px** | ≤200px、v148(224px)未満 |

日付未変更ボタン(前日/日付/翌日/🔍、非当日では+「今日へ」)は全パターンでoverlapなし・
横スクロールなし(`scrollWidth === clientWidth === 375`)を実測確認。

**必須3(80歳ビジョン導線)**: `homeVisionCard()`を新設(ホームタブ、アファメーションと
AIからの間)。タップで`openVisionBoard(2)`(`data-action="open-vision-board" data-index="2"`)を
呼び、`state.settings.visionSection="board"`+`visionBoardIndex=2`をセットして`setView("vision")`。
既存のビジョンボード表示ロジックをそのまま再利用し、複製実装は避けた。

**必須4(ホームタブ復帰時のスクロール取り残し)**: `renderMain()`のホーム自動スクロールは
`.home-hero`固定だったため、ホームタブ滞在中に別ビューへ移動して戻ってくると(view切替=
`shouldAutoScroll`成立)、`.home-hero`が存在せず(今日タブ専用)スクロールが不発になり前の
スクロール位置に取り残されていた(Codex指摘)。`.home-hero`が無ければ`.home-tabbar`
(両タブ共通で常に先頭にある)へフォールバックするよう変更した。

**必須5(宣言→タブ直タップの1回目が食われる)**: 宣言入力(`[data-declaration-date]`)の
`change`ハンドラは`saveAndRender()`(全再描画)を呼んでいたが、宣言入力欄はホームタブ専用・
影響先の`.home-today-status`は今日タブ専用で、blur時点の現在DOMには互いに存在しない
(タブが排他のため、この保存は実際には即時再描画を必要としない。タブ切替自体が別途render()
するため次の描画で自然に反映される)。`saveState()`のみに変更し、blur直後の全DOM入れ替えで
直後のタブタップ1回目が消費される問題(Codex指摘)を解消した(保存失敗時のトースト表示は維持)。

**必須6(信条・寿命の既定展開が確実でない)**: 旧実装は`homeFoldSection`(localStorage永続の
`isHomeFoldOpen`)を使っており、過去にKが一度でも閉じていれば以後ずっと閉じたままになる
(「タブを開くたび既定で展開」というK指定を満たさない)。ジャーナルセグメント
(`_journalSegmentOverride`)と同じ非永続セッションオーバーライド方式(`_homeReflectFoldOverride`、
新設の`homeReflectFoldSection()`、summaryへ`data-action="toggle-home-reflect-fold"`)に変更した。
`data-fold-id`は持たない(グローバルのtoggleイベント委譲によるlocalStorage永続化を意図的に
受けない)。挙動: ホームタブを開くたび既定open。手動で閉じたらそのセッション中(=ページ
reloadまで、_journalSegmentOverrideと同じ寿命)だけ閉じたままになり、reloadすれば既定openに
戻る。テストのセレクタは`data-fold-id="creed"/"lifespan"`から`.home-creed`/`.home-lifespan`
(クラス)へ変更した。

**推奨7(宣言未入力警告への導線)**: 今日タブの「今日の状態」カード内「📣 今日の宣言が未入力です」
行に「ホームタブへ →」ボタン(既存の`data-action="home-tab" data-tab="home"`をそのまま再利用)を
追加した。

**推奨8**: 本ファイル(CHANGES_v149.md)のファイル数誤記(13→18)・信条/寿命の展開仕様を
本セクションで修正・明記。

**推奨9**: `tests/v71.test.js`のスコアボードジャンプ検証で`Element.prototype.scrollIntoView`を
モンキーパッチしたまま復元していなかった箇所を、パッチ前の関数を`window.__origScrollIntoView`に
退避し使用後に復元するよう修正した。

## 既存テストへの影響

ホームの各カードを参照する既存テストを全数grepし、以下**18ファイル**を修正した(振り分け先タブへの
`[data-action="home-tab"][data-tab="home"]` クリックの追加、および defaultOpen 反転
(creed/lifespan)・スコアボードジャンプ仕様変更に伴うアサーション更新)。機能や検証内容を
弱める変更は行っていない(削除・スキップは無し。すべて「新しい正しい振る舞い」を検証する形へ
更新):

- `tests/v57.test.js`(直push検知フィードバックのホーム反映)
- `tests/v58.test.js`(週次レビュー導線の曜日境界)
- `tests/v61.test.js`(今日の理想の保存/3日リトライ/日報反映)
- `tests/v62.test.js`(ホーム信条の文言確認)
- `tests/v67.test.js`(AI連携鮮度・AI作業結果の取り込み)
- `tests/v71.test.js`(ホームの折りたたみ既定値・並び順・AIから集約・スコアボードジャンプ)
- `tests/v73.test.js`(縮退モードのAIから折りたたみ)
- `tests/v75.test.js`(AIフィードバック本文の閲覧)
- `tests/v76.test.js`(AIフィードバックselectedDate非依存の回帰)
- `tests/v77.test.js`(visibilitychange再fetchの自動表示)
- `tests/v81.test.js`(今日の理想の空欄カード折りたたみ)
- `tests/v82.test.js`(ホームのスリム化・スコアボード・折りたたみ既定値)
- `tests/v83.test.js`(AIフィードバックキャッシュ更新の回帰)
- `tests/v112.test.js`(未完了タスクパネルの複数回追加)
- `tests/v117.test.js`(今日の宣言の警告表示・保存)
- `tests/v141.test.js`(AIフィードバック閲覧の回帰、ジャーナル3列目撤去に伴う代替確認)
- `tests/v143.test.js`(死コード削除後のAIフィードバック閲覧回帰)
- `tests/v146.test.js`(ホーム折りたたみ既定値・並び順、v149でタブ別に再構成)

実走結果は完了報告(コミットメッセージ/引き継ぎ)に記載する。
