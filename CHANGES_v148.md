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
