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

