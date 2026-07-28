# v163 — ダッシュボード

## 変更内容

- サイドバーと「その他 › 振り返り」に「ダッシュボード」を追加(mobileNavは変更なし)。
- 非永続の日付カーソルを追加し、`feedbackFiles` / `feedback` の最新日を既定値にした。
- 選択日の `AIフィードバック_YYYY-MM-DD.md` を既存GitHub Contents API経路で取得し、Markdownを常時展開表示するようにした。
- 月曜始まりの選択週と8週窓について、実績記録率、カテゴリ別計画時間、完了率、MIT達成、ルーティン遵守を決定論で集計する純粋関数を追加した。
- 1024px以上(iPad横以上)は実績/AI本文の2列、1024px未満(iPad縦・iPhone)は縦積みにした。日付入力はnative `type="date"` / 16px。
  - **レビュー是正(2026-07-28、Codex+reviewer 2系統)**: 当初は760px以上で2列にしていたが、iPad縦(サイドバー184px残置時、実効コンテンツ幅~540-590px)では左カラムに入れ子の`.stats-grid`(auto-fit minmax(340px,1fr))が340px未満に縮み横あふれする実測不具合(P1/High)が判明。2列トリガーを1024px(iPad横最小幅)へ引き上げて解消(styles.css:3348-3362、tests/v163.test.js該当checkも追従修正)。
- Service Workerのキャッシュ名を `taskchute-journal-pwa-v163` へ更新した。

## 実データでの数字一致確認(2026-07-28)

`repos/personal-data/taskchute/app-state.json`(実データ、選択日=2026-07-28)を、正典 `loop/scripts/taskchute-dashboard-build.py` の出力と、app.js `computeDashboardMetrics` をNode vmサンドボックスで直接実行した結果とで突合し、以下すべて一致を確認(誤差は丸め表示のみ):
- 全期間の実績記録率: 123/845(14.56% → 表示15%)で完全一致
- 選択週(2026-07-27〜08-02)の記録率2/30(6.67%→7%)・完了率9/30(30%)・MIT 5/6(83%)・ルーティン8/29(27.6%→28%)・カテゴリ時間(仕事1.0h・ルーティン1.6h・その他1.0h、計3.6h)がすべて一致

## batch 2 追記(2026-07-28、K指示「8週ミニバーも今回追加して」)

- 記録率・週次完了率・ルーティン遵守の3パネルに、計器盤(`renderStats`)と同じ`.stats-bars`/`.stats-bar-fill`を再利用した8週推移ミニバーを追加(`dashboardTrendBarsHTML()`)。集計は`computeDashboardMetrics()`が返す`weeklyTrend`配列(taskchute-dashboard-build.pyのbuild_weeksと同じ月曜始まり8週窓)。
- 実データでの再検証: `weeklyTrend`の8週分すべて(記録率・完了率・ルーティン遵守)が正典pyの週次バー値と完全一致(丸め表示の差のみ)。
- **2回目のCodexレビューでP2指摘2件、両方対応**:
  - 起動直後(hydration完了前)にレンダリングされた選択日カーソルが、hydration後の新着フィードバック発見(`recordFeedbackFile`)に追随しない問題。「手で日付を変えたか」フラグ(`dashboardDateTouched`)を追加し、未操作の間は毎回`defaultDashboardDate()`を取り直す方式に変更。
  - 狭いiPhone(320px幅など)で入れ子`.stats-grid`(340px固定下限)が横あふれする問題。`.dashboard-achievement-column .stats-grid`専用に`minmax(min(340px,100%),1fr)`のクランプを追加(計器盤側の挙動は変更なし)。
- 上記2点を反映しtests/v163.test.jsに7項目追加(計23項目)、全PASS再確認。

## push後のCI失敗と是正(2026-07-28)

初回push(ccd810b)でCIが2系統失敗した。原因と対応:
1. **commit-size-gate失敗**: ローカル確認時、並行して別セッションが進めていた`.github/workflows/scripts/check-commit-size.sh`の未コミット編集(tests/docs/releases除外ルールの追加)を誤って参照し「PASS」と誤認した。実際にpushされた(コミット済みの)ゲートスクリプトには当時その除外が無く、test/docsコミット(276行)が上限超過でNG判定された。後続pushで無関係な他セッションの編集がコミットされ次第、この除外ルールが適用される見込み。今回は監督者側の確認手順の誤り(共有ファイルの未コミット状態を自分の検証に使ってしまった)であり是正済み。
2. **全量test失敗(3スイート)**: `v148.test.js`(その他グリッド件数のハードコード)と`v71.test.js`(navItems順序のハードコード)が、ダッシュボードタブ追加という仕様変更に未追従で回帰。両テストの期待値をタブ追加後の実態に合わせて更新し再pushして解消(検証内容の弱体化ではなく、実際の変更を反映しただけ)。`v90.test.js`は`net::ERR_CONNECTION_REFUSED`によるCI側の一過性の起動待ちタイムアウトで、今回の変更とは無関係(再push後は発生せず)。
3. 是正後のpush(bc5f2f9)でcommit-size-gate・全量test(19分6秒)とも成功を確認。

## 検証

### `node --check app.js`

```text
(stdout/stderrなし、exit 0)
```

### `node tests/run-all.js v163`

```text
実行対象(絞り込み): v163.test.js
ポート帯基底(TEST_PORT_BASE): 36000(並行run間の衝突回避、v140)

===== v163.test.js =====
[1] 集計純粋関数: 記録率・カテゴリ時間・完了率・MIT・ルーティン
  ✅ 月曜始まりの選択週
  ✅ 全期間の実績記録率は削除済み・未来日を除外して3/7
  ✅ 選択週の実績記録率は1/4=25%
  ✅ カテゴリ時間はestimateMin優先、0は予定差へフォールバック(仕事90分・その他15分)
  ✅ 時間情報が両方無い1件を明示的に除外
  ✅ 選択週の完了率は3/4=75%
  ✅ MITは選択週で終わる8週窓の単一集計2/4=50%
  ✅ ルーティン遵守はrecurrenceGroupIdを持つBlockで1/2=50%
  ✅ 既定日はfeedbackFiles/state.feedbackの日付キー最大値
[2] UI・非同期取得・レスポンシブ・SWの接続契約
  ✅ navItemsにD印のダッシュボード
  ✅ moreGroupsの振り返り群に📈ダッシュボード
  ✅ renderMainからrenderDashboardへ接続
  ✅ 日付入力はnative type=date
  ✅ AI本文はdetailsでなくplain div
  ✅ 任意日のAIフィードバック命名でContents API取得
  ✅ 404/未取得時の日本語空表示
  ✅ hydrateStaticMarkdown完了時の再描画対象にdashboard
  ✅ 日付inputは16px以上
  ✅ 1024px以上(iPad横以上)は2列。iPad縦(760-1023px)は入れ子stats-gridの340pxはみ出しを避け縦積みのまま
  ✅ SW CACHE_NAMEはv163

✅ v163 ALL PASS

✅ All suites passed
```

初回のPlaywright版v163テストで、この管理サンドボックスがChromium起動を `spawn EPERM` で拒否することを確認したため、v163は実コードの純粋集計関数をNodeで単体検証し、UI接続点(navItems/moreGroups/renderMain接続/CSS構造/SW版数)を契約検証する構成にした。

### `npm run test:core`(直近5件+固定横断コア5件、v163含む計10件)

```text
test:core 実行対象(直近5件 + 固定横断コア5件、重複除き計10件): v163, v162, v161, v160, v159, v72, v59, v67, v50, v70

✅ All suites passed
test:core 所要時間: 186.9s
```

全量 `npm test`(CI相当の全スイート)はローカル未実行。push後にGitHub Actionsでの全量CI成功を必ず確認すること。

## レビュー

- **Codexレビュー**(`codex-companion.mjs review --wait`): P1指摘1件(iPad縦2カラム破綻)→ styles.css修正で解消(上記「レビュー是正」参照)。
- **reviewer(Claude、独立)**: High 1件(Codex指摘と同一事象、実測裏取り済み)→ 解消。Med 4件・Low複数件を検知。対応方針:
  - Med(Playwright E2Eが実際に描画経路を通していない): 既知の環境制約(EPERM)。次弾以降でE2E実行可否を再確認。
  - Med(`_dashboardFeedbackFetchState`がセッション中クリアされない・ダッシュボード閲覧分が`recordFeedbackFile`/`autoIngestFeedback`を通らず横断検索に出ない): 意図的な設計判断として現状維持(ダッシュボードは閲覧専用、状態書き込みの副作用を持たせない方針)。次弾で必要性を再検討。
  - Low(pyとJSでパネル2/3/5の集計粒度が異なる、未来週への→上限なし、`fmtMinShort`の小数表示、taskchute-notes handoff.md未追記): handoff.mdはこのコミット作業と合わせて追記。他はlow・次弾以降の検討事項。
