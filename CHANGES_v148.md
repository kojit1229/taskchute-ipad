# v148 UI改善計画Phase3(導線の再編)

入力: `workbench/out/2026-07-27-taskchute-ui-review/ui-improvement-plan.md`(承認済み計画。
claude-ux-review.md + codex-ui-review.mdの2系統レビューの統合)。本コミット群はそのうち
**Phase3(5項目)**の実装。機能削除は一切していない(移動と格納のみ)。

## 3-1. 「その他」の目的別グループ化 + 現在地表示

- `navItems`とは別に`moreGroups`(4群: 計画/思考/振り返り/ツール)を新設し、`renderMore()`は
  群ごとに見出し(`.more-group-title`)付きで描画するよう変更した。`navItems`自体(サイドバー用)
  は無変更。
  - 計画: WBS / やりたい / やらない / ビジョン
  - 思考: 0秒思考
  - 振り返り: 週次 / 計器盤 / AIレポート / 日報
  - ツール: ポモドーロ / 設定
- 頭文字1字アイコン(W/R/A/S/V/P等、日本語ラベルと対応しない指摘=codex-ui-review N4)は
  この「その他」グリッド限定でやめ、既存の絵文字語彙(✦=やりたい、✕=やらない、🗓=週次、
  📤=日報、🤖=AIレポート等、アプリ内の他画面で既に使っているもの)に統一した。
- ルーティンは「その他」から除外し、実行系(タスクシュート画面 `renderTasks()`)の上部に
  「↻ 今日使うルーティンを見る →」リンクとして昇格した。
- **現在地表示**: `moreGroupLabelFor(viewId)`で現在のビューが`moreGroups`のどれかに属するか
  判定し、属する場合は`renderHeader()`(共通ヘッダー)に「その他 › 群名」を1行(`.view-breadcrumb`)
  追加する。`renderHeader()`を使わない0秒思考(独自ヘッダー)にも同様に追加した。

## 3-2. 設定の4群アコーディオン化

- 13パネルを個別の`renderSettingsXxxPanel()`関数へ分割し、`renderSettings()`は4群にまとめて出す。
  - 日々の使い方(id: `settings-daily`): バッファ/バッテリー/朝の一括プランニング/実行
  - 表示・タイマー(id: `settings-display`): Study With Me/ガイド付きアクセス/休憩メッセージ
  - データと同期(`renderSettingsSyncGroup()`、他3群と実装が異なる。後述): データ(JSON
    エクスポート等)/クラウド保存/GitHub Pages
  - マスタ・詳細(id: `settings-master`): プロフィール/カテゴリ管理/現在のファイル構成(既存の
    ネストしたdetailsのまま)
- 「日々の使い方」「表示・タイマー」「マスタ・詳細」の3群は`homeFoldSection()`(既存の折りたたみ
  機構、`taskchute-journal-home-fold-v1`にopen/closedを記憶)で既定closed、通常どおり手動開閉が
  永続化される。
- 「データと同期」だけは既存の`syncAlertMessage()`(同期停止アラート、ホームバナーと共通ロジック)
  または認証エラー(`_personalDataAuthError`)が真の間だけ自動openになる専用実装
  (`renderSettingsSyncGroup()`)。3-4のジャーナルと同じ理由(後述のレビュー対応1参照)で
  `homeFoldSection()`は使わず、`data-fold-id`属性も意図的に持たない(マーカーは
  `data-settings-sync`)。

## 3-3. 計器盤の2層化

- `renderStats()`の内訳を「常時表示(summaryBody)」と「詳細(detailBody、`homeFoldSection`の
  `<details>`、既定closed)」に分割した。
  - 常時表示: 今週のヒント(insightsCard)→ 主要指標(rateChart=着手率の週次推移)→
    睡眠1行要約(新規`renderSleepSummaryLine()`、直近の睡眠中央値だけを1行で示す)
  - 詳細: エネルギー収支 → カテゴリ配分 → カテゴリ収支 → 週次推移 → 時間帯×曜日ヒートマップ →
    時間帯別活動量 → 見積 → 記録の継続(カレンダー)→ 睡眠詳細(既存`renderSleepStats()`)
- 節の配置ルール(固定・新しい節を足すときもこの順を守る)は`renderStats()`内にコードコメントで
  明記した。
- 既存チャートは1つも削除していない。詳細detailsへ格納するだけ(`tests/v148.test.js`で
  `.stats-donut-wrap`等5クラスの存在を回帰確認)。

## 3-4. ジャーナル当日パネルの朝/夜セグメント化

- 当日編集パネルを「朝(前夜の睡眠・朝の体調・睡眠時間・服薬・今日の余力)/ 夜(夜の体調・
  夜メモ・運動記録・お店ログ)/ 本文(思考のヒント+textarea)」の3`<details>`に再編した。
  日報生成・pushボタンは従来位置(当日編集パネル最上部)のまま。
- 開閉既定は現在時刻(`new Date()`、〜14時=朝・14時〜=夜)で毎回計算する。本文は時間帯に
  関係なく常時open。
- **実装上の注意(レビューで発覚した不具合と対策)**: 当初`homeFoldSection()`(localStorage
  記憶)をそのまま再利用したが、ブラウザは`<details open>`を描画しただけで(ユーザー操作が
  無くても)`toggle`イベントを発火する仕様があり(実測確認済み)、時刻由来で開いた側が
  「ユーザーが手動で開いた」扱いとして永続化され、時刻が変わっても二度と閉じなくなる不具合が
  あった。素の`<details>`+時刻からの毎回再計算に戻すと、今度は閉じている側の欄を手動で開いて
  何か入力するたびに(data-action経由の再render)時刻基準へ巻き戻り連続入力ができない、という
  別の実害があった。最終的に、モジュール変数`_journalSegmentOverride`(非永続。ページリロードで
  消える)へ`<summary>`への本物のクリック(`data-action="toggle-journal-segment"`)だけを記録し、
  `render()`時はこれを時刻より優先する方式にした(`toggle`イベントには一切頼らない)。

## 3-5. タイムライン(v144)エネルギー/バッテリー切替式

- `renderTimeline()`に「エネルギー / バッテリー」2択トグル(`.tl-zoom-controls`と同じ見た目の
  小ボタン、`data-action="tl-energy-mode"`)を追加した。
- `renderEnergyGraph()`は`state.settings.timelineEnergyGraphMode`(既定`"energy"`)に応じて
  片方のpolylineだけを描画するよう変更。データ算出(realPoints/predictPoints/batteryPts)自体は
  従来どおり両方計算するが、表示するのはモードに応じた片方のみ(別スケール2線の重ね描きを廃止)。
- 選択状態は`state.settings.timelineEnergyGraphMode`に保存(`persistLocalNoSchedule()`、UI状態
  なので`dataModifiedAt`は汚さない)。`normalizeState()`に新規マイグレーションを追加し、
  `"energy"`/`"battery"`以外の値(未設定含む)は`"energy"`へ補完する。

## 規約遵守

- `new Date("文字列")`は使っていない(`new Date()`は既存の`currentOrNextTaskchuteBlockId`等と
  同じ「現在時刻取得」用途のみ)
- input/select/textareaの新規16px未満は追加していない
- `data-action`デリゲーション方式を維持
- sw.js: `CACHE_NAME`を v147→v148
- 機能の削除はしていない(全ての既存パネル・チャート・入力欄はdetails/グループへの格納のみで
  DOM上に存在し続ける)

## レビュー対応(2026-07-27、Claude+Codex 2系統レビューFAIL判定への対応)

### 必須修正

1. **closedコンテナ配下の全要素を機械的に洗い出し、影響テストを実走**: 「セレクタが変わったか」
   ではなく「包含関係が変わったか」で対象を決め、設定4群(全パネルのdata-action/id/入力)・
   計器盤detailsの中身・ジャーナル3セグメントの中身をapp.jsから列挙し、それぞれをgrepでヒット
   させた全テストファイルを実走した(結果は下表)。最初の一括実行で7ファイル
   (v49/v53/v78/v94/v103/v135/v136)が確実に落ちることを確認し、いずれも「データと同期」群の
   details内にある`save-github`/`load-github`/`open-backup-list`/`run-archive`を、群を開かずに
   `page.click()`していたのが原因だった。
2. **「データと同期」群のtoggle誤永続化(3-4のジャーナルと同一クラスのバグ)**: `homeFoldSection`
   のまま`syncAbnormal`をdefaultOpenに渡す実装だと、同期異常による自動openが(ブラウザが
   `<details open>`描画だけで`toggle`イベントを発火する仕様のため)ユーザー操作扱いで
   `taskchute-journal-home-fold-v1`へ永続化され、(a)異常解消後も開きっぱなし、(b)一度手動closeした
   端末では異常時も二度と自動openしない、という2つの不具合があった。`renderSettingsSyncGroup()`を
   専用実装にし、ジャーナルと同じ設計(モジュール変数`_settingsSyncOpenOverride`、非永続、
   `<summary>`への本物のクリックだけを見る)に統一。`open = 動的異常判定 || override`という式で
   「動的open(異常時)はstored値より優先・動的open自体は永続化しない」を実現した。
3. **ルーティンのbottom-nav現在地(Codex指摘)**: `renderBottomNav()`が`state.currentView`を
   そのまま`mobileNav`のidと比較しており、`routine`はどの項目にも一致せず「その他」がactive
   になっていた。`bottomNavEffectiveView(view)`(`routine`→`tasks`にマッピング)を介するよう変更。
4. **過去日+バッテリーモードで空グラフになる(Codex指摘)**: `state.settings.
   timelineEnergyGraphMode`はグローバル設定のため、当日のタイムラインで「バッテリー」を選んだ
   まま過去日へ移動する、またはcompact表示(タスクシュート右レール、切替トグルが無い)を見ると、
   `batteryPts`が常に空になり復帰手段の無い空グラフになっていた。`renderEnergyGraph()`に
   `compact`引数を追加し、`isToday && !compact`のときだけ`"battery"`を有効にし、それ以外は
   強制的に`"energy"`へフォールバックする(設定自体は書き換えない。当日のタイムラインへ戻れば
   選択済みのバッテリー表示に復帰する)。
5. **認証エラーバナーからの設定遷移でも「データと同期」群を自動open**: `renderSettingsSyncGroup()`
   のdynamicOpen判定に`_personalDataAuthError`(認証エラーバナー、app.js:13877付近の
   `pd-auth-banner`と同じ変数)も含めた。バナーをタップして設定へ遷移すると、トークン再入力欄
   (クラウド保存パネル)が最初から見える。

### 推奨修正(すべて対応)

6. **テストコメントの虚偽修正**: v63/v72/v84/v144/v145の5箇所で「`.open=true`の直接代入は
   state/localStorageを汚さない純粋なDOM操作」とコメントしていたが、実際はブラウザの`toggle`
   イベント自動発火経由で`taskchute-journal-home-fold-v1`へ書き込まれることがある(事実と異なる
   説明だった)。5箇所とも`<summary>`への本物のクリックへ統一し(`tests/helpers.js`に共通
   ヘルパー`openSettingsGroup(page, groupId)`を新設して重複を削減)、コメントも実際の理由
   (toggleイベントに頼らない実クリック方式にした経緯)に書き換えた。
7. **`tests/v146.test.js:345`のセレクタ拡張**: `.settings-grid > .panel h2`は4群化で個々のパネル
   見出し(h3、2階層ネスト)に届かなくなり、vNNN非表示の回帰保護が実質空洞化していた。
   `.settings-grid h2/h3/summary`を広く拾う形に直し、13パネル分の見出しへ保護を回復した。
8. **ジャーナル「本文」セグメントも朝/夜と同じ挙動に**: `_journalSegmentOverride.body`を追加し、
   本文summaryにも`data-action="toggle-journal-segment" data-segment="body"`を付けた。既定open
   (時間帯に関係なく)だが、手動で閉じても再描画のたびに開き直らなくなった。
9. **`.tl-zoom-controls`の2段化を1段に統合**: ズーム(1x/2x/4x)とエネルギー/バッテリー切替を
   別々の`.tl-zoom-controls`行にしていたのを、`.tl-controls-divider`区切りで1行にまとめ、
   縦圧縮方針(v98以降の一貫方針)に揃えた。
10. **睡眠1行要約のラベル修正・`new Date()`重複排除・変数宣言位置の統一**: 「直近中央値」は
    期間セレクタ(全期間選択時は最大2年)によっては誤解を招くため「期間中央値」に変更。
    `renderJournal()`内の`new Date()`2回呼びを1回(`const _now = new Date()`)にまとめた。
    `_journalSegmentOverride`/`_settingsSyncOpenOverride`の宣言を、それぞれの初出箇所近くから
    ファイル冒頭の他のモジュール変数群(`toastTimer`等の並び)へ移動し、経緯コメントも1箇所に
    統合した。

## 既存テストへの追随修正(仕様変更に伴う正当な更新。弱体化ではない)

変更する全セレクタ・data-action・文言(その他グリッド/設定パネル/計器盤節/ジャーナル行/
タイムラインエネルギーグラフに関連するキーワード)を`grep`で洗い出し、ヒットした全ファイルを
実走確認した。

| 対象要素(app.js) | 格納先(closedコンテナ) | grepヒット・実走したテスト | 結果 |
|---|---|---|---|
| `save-github`/`load-github`/`open-backup-list`/`download-data`/`reset-demo`/`run-archive`/`data-github-field`/`data-setting-autoarchive`/`data-setting-autosync`/`gh-owner`/`gh-token`/`importData` | 設定「データと同期」群 | v49, v53, v72, v78, v94, v103, v135, v136, v144(境界値部), v145(境界値部), v148 | 修正後 全PASS(修正前: 7ファイルが確実にタイムアウト失敗) |
| `data-setting-battery-field`/`data-setting-battery-recoverydraft`/`data-ai-automorningplan`/`data-setting-focustimerauto`/`data-setting-dailybuffermin`/`data-setting-dayclosehours` | 設定「日々の使い方」群 | v60, v144, v145, v148 | 全PASS(v60は`.count()`のみで無変更PASS、v144/v145は修正) |
| `data-swm-field`/`study-with-me-url-input`/`data-setting-pomoguidedaccesshint`/`add-break-message`/`delete-break-message`/`data-msg-id` | 設定「表示・タイマー」群 | v84, v148 | 全PASS(v84を修正) |
| `data-setting-field`/`add-category`/`data-cat-id`/`delete-category` | 設定「マスタ・詳細」群 | v63, v148 | 全PASS(v63を修正) |
| 計器盤(energyChart/donutCard/catEnergyCard/trendCard/heatmap/histCard/estimateCard/calendarCard/sleepStatsCard) | 計器盤「詳細」details | (renderStats内にdata-action無し。既存テストは`.count()`/`.textContent()`のみで影響なし) | 該当ファイル無し |
| `set-morning`/`set-sleep`/`toggle-meds`/`set-capacity`/`sleep-csv-upload` | ジャーナル「朝」セグメント | v73, v81, v148 | 全PASS(v73/v81を修正) |
| `set-evening-mood`/`cond-evening-note`/`add-gym-entry`/`delete-gym-entry`/`gym-*-input`/`store-visit-*` | ジャーナル「夜」セグメント | v73, v81, v105, v120, v130, v134, v141, v148 | 全PASS(v73/v81/v141を修正。v105/v120/v130/v134は`.count()`/`.textContent()`のみで無変更PASS=誤検出) |
| `data-journal-date`/`journal-prompts` | ジャーナル「本文」セグメント(既定open) | v123, v124, v127, v137, v140 | 全PASS(本文は既定openのため無変更で動作。フォントサイズ確認は`getComputedStyle`でclosedでも可) |
| その他グリッドの`data-action="nav"`/バッジ文言 | 「その他」グリッド(closed化はしていない、ただの見出し追加) | v82, v92 | 全PASS(navボタン自体は隠れないため無変更) |
| `.settings-grid > .panel h2`(vNNN非表示の回帰保護) | (グループ再編でセレクタの意味が変化) | v146 | 修正(セレクタをh2/h3/summary全体へ拡張)、全PASS |

修正した個別ファイル:

- `tests/helpers.js`: 共通ヘルパー`openSettingsGroup(page, groupId)`を新設(設定4群を`<summary>`
  への実クリックで開く。`settings-sync`だけ`data-settings-sync`属性、他は`data-fold-id`属性で分岐)。
- `tests/v49.test.js` / `v53.test.js` / `v72.test.js` / `v78.test.js` / `v94.test.js` /
  `v103.test.js` / `v135.test.js` / `v136.test.js`: `save-github`等のクリック前に
  `openSettingsGroup(page, "settings-sync")`を追加(新規に確実に落ちていた7ファイル+関連の
  v72/v94)。
- `tests/v63.test.js`: カテゴリ管理のバケットselect操作前に「マスタ・詳細」群を開く手順を
  `openSettingsGroup`へ統一。
- `tests/v73.test.js` / `tests/v81.test.js`: ジャーナルの夜/運動記録フィールドを操作する前に、
  `.journal-segment-morning`/`-evening`のsummaryを実クリックして開く`openBothJournalSegments()`
  ヘルパーへ統一(手動close/open検出は`_journalSegmentOverride`経由のため`.open`直接代入では
  機能しない)。
- `tests/v84.test.js`: Study With Me欄の入力前に「表示・タイマー」群を開く手順を`openSettingsGroup`
  へ統一。
- `tests/v141.test.js`: お店ログ操作前に「夜」detailsを開く`openJournalEvening()`ヘルパーを実
  クリック方式に統一(reloadを挟む2箇所で呼び出し)。
- `tests/v144.test.js`: battery-curve検証の直前に「バッテリー」モードへ切り替える手順、設定境界値
  テスト前の「日々の使い方」群オープンを`openSettingsGroup`へ統一。
- `tests/v145.test.js`: `goSettings()`ヘルパー内の「日々の使い方」群オープンを`openSettingsGroup`
  へ統一。
- `tests/v146.test.js`: vNNN非表示チェックのセレクタをh2/h3/summary全体へ拡張(項目7)。

## テスト

`tests/v148.test.js`(新規、レビュー対応で大幅拡充)でPhase3の5項目+レビュー指摘5件を直接検証:

1. 「その他」12項目→4群(計画/思考/振り返り/ツール)。ルーティンは除外され11項目になる。
   バッジが1文字アルファベットでない(絵文字化)ことを確認。ルーティン画面でbottom-navの
   「実行」がactiveになる(項目3)
2. その他配下(0秒思考)を開くと「その他 › 思考」の現在地表示が出る。home/tasks/timeline/
   journal/routineには出ない
3. 設定は4群のdetailsで既定全閉。既存の設定欄(バッテリー/Study With Me)はDOM上に存在する
   (格納するだけ)。同期停止アラート発生時は「データと同期」群だけ既定openになり、**異常解消後は
   再びcloseする(項目2-a)**・**手動closed履歴があっても異常時は開く(項目2-b)**・**認証エラー
   バナーからの遷移でも自動openする(項目5)**ことを回帰確認
4. 計器盤は常時表示(着手率の週次推移が詳細detailsの外にある)+詳細details(既定closed、
   既存チャート5種の存在を確認)。詳細は既定closedで既存チャートは全部残る
5. ジャーナル: 10:00(朝)は朝open/夜closed、20:00(夜)は逆になる。本文は常時open。
   **回帰確認**: 20:00に朝detailsを手動展開して操作(set-sleep)しても、再描画後に朝detailsが
   閉じ直らないこと
6. タイムラインのエネルギー/バッテリートグル: 既定はエネルギー(バッテリー線は出ない=1グラフ
   1スケール)。切替でバッテリー線のみ表示・エネルギー線が消える。選択状態は
   `state.settings.timelineEnergyGraphMode`に保存され、reload後も維持される。**過去日では
   バッテリー選択のままでもエネルギー系列へフォールバックし、当日へ戻ると復帰する(項目4)**・
   **compact表示(タスクシュート右レール)でも同様にフォールバックする(項目4)**ことを確認

**実行結果**:
- `node tests/v148.test.js`単体: 全項目PASS
- `node tests/run-all.js v49 v53 v60 v63 v72 v73 v78 v81 v82 v83 v84 v92 v94 v103 v105 v120 v123
  v124 v127 v130 v134 v135 v136 v137 v140 v141 v144 v145 v146 v147 v148`(修正した全ファイル+
  Phase3で影響しうる全ファイルの一括実行、フォアグラウンド・timeout 600000): ✅ All suites passed
  (30ファイル)
- `npm run test:core`(フォアグラウンド、timeout 600000明示): ✅ All suites passed(209.4s)
- `npm test`(全量)は監督者側でpush前に実行するため本ラウンドでは未実行(指示どおり)

## 対応できなかった項目

なし(必須5件・推奨5件すべて対応済み)。
