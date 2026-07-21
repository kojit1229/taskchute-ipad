# v134 同期停止アラート(K承認済み、2026-07-21)

## 背景(実際に起きた事故、2026-07-20〜21)

端末の自動push(30秒デバウンス)が2026-07-20 09:47〜07-21 16:03の約24時間、無警告で
停止した(原因不明)。この間の実績は端末内にのみ存在し、朝5時の日報バッチが古いリモート
状態から不完全な日報を生成した。push/pullの失敗・停止を検知するアラートが無かったため、
K本人が気づくまで丸1日ズレたまま運用が続いた。

## 設計判断

- **push/pull成功時刻は端末ローカルのlocalStorageに独立キーで持つ**(state本体には
  入れない)。理由: `state.settings.lastPushedAt`/`lastPulledAt` は state 全体の一部として
  同期(push/pull)される値であり、他端末からのpull・採用でその端末の値に上書きされてしまう
  ため、「この端末が最後にいつ成功したか」を表せない。v37で確立済みの
  `LAST_SYNCED_SHA_KEY`(端末ローカルSHA)と全く同じ設計思想をそのまま踏襲し、
  `LAST_SYNC_PUSH_KEY` / `LAST_SYNC_PULL_KEY` を追加した。
- **記録の差し込み箇所**: push成功は `saveToGitHub()` のPUT成功直後(手動保存・自動保存
  `scheduleAutoSave`・自動同期 `runAutoSyncPush` の3経路すべてがこの関数を経由するため
  1箇所で足りる)。pull成功は `downloadGitHubStateText()` の呼び出しが成功した直後、
  3箇所(`runAutoSyncPull` / `syncFromGitHubOnStartup` / `loadFromGitHub` の手動読込)。
  いずれも「実際にGitHubとの通信に成功した瞬間」を記録するだけで、その後の採用/マージ/
  競合バナー分岐には関与しない(どの分岐に転んでも「成功はした」という事実は変わらないため)。
- **push側アラートの発火条件**: 「push成功から6時間以上経過」に加えて「未push変更が
  実際にある」ことを要求する(`state.dataModifiedAt !== state.settings.lastPushedAt`。
  既存の同期ドット `syncDotClass()` と同じ判定式を再利用)。変更が無い日にまで警告を
  出すと無意味なノイズになるため。
- **pull側アラートの発火条件**: 「pull成功から24時間以上経過」のみ(push側と違い、
  「取得できていない」こと自体が問題であり、ローカル変更の有無は無関係)。
- **後方互換**: localStorageに記録が一度も無い状態(未アップデート端末・初回起動)では
  アラートを出さない。
- **表示場所**: ホーム最上部(`renderHome()` の一番先頭、`renderHeader` の直後)に赤帯
  バナー(`.sync-alert-banner`)。既存の `.sync-banner`(競合時、橙、判断を仰ぐトーン)や
  `.cond-degraded-banner`(意図的に赤を避けた落ち着いたトーン)とは別の、見落とし厳禁の
  異常系として意図的に赤(`var(--red)` / `var(--red-soft)`)にした。タップで設定画面へ。
- 設定タブの同期セクションに、この端末のpush/pull成功時刻(localStorageベース)を
  常時・小さく表示する行を追加した(既存の `github.lastSavedAt` / `state.settings.lastPulledAt`
  表示行はそのまま残し、追加行として併記。既存行はstate同期の影響を受けうるため、
  「この端末:」ラベルの新設行が信頼できる情報源になる)。

## 実装

- `app.js`
  - `LAST_SYNC_PUSH_KEY` / `LAST_SYNC_PULL_KEY`(localStorage、`LAST_SYNCED_SHA_KEY` と同じ並び)
  - `recordSyncPushSuccess()` / `recordSyncPullSuccess()` / `getLastSyncPushAt()` / `getLastSyncPullAt()`
  - `hoursSinceLocalDateTime()`: 既存の `localDateTimeToMs()`(v56、iOS Safari の
    `new Date(文字列)` TZ解釈バグ回避ヘルパー)を再利用し、`new Date(文字列)` を直接使わない
  - `syncAlertMessage()` / `homeSyncAlertBanner()`
  - `saveToGitHub()` のPUT成功直後に `recordSyncPushSuccess()` を追加
  - `runAutoSyncPull()` / `syncFromGitHubOnStartup()` / `loadFromGitHub()` の
    `downloadGitHubStateText()` 成功直後に `recordSyncPullSuccess()` を追加
  - `renderHome()` 先頭に `${homeSyncAlertBanner()}` を追加
  - 設定タブの同期セクションに「この端末:」の表示行を追加
- `styles.css`: `.sync-alert-banner`(赤帯)を追加
- `sw.js`: `CACHE_NAME` を `v133` → `v134`
- `tests/v134.test.js`: 新規。記録なし時の後方互換非表示、push/pull停止時のバナー表示・
  文言・条件(未push変更の有無)、実際のpush成功/pull成功での記録更新と表示反映をE2Eで検証

## 自信がない箇所

- push側アラートの「未push変更あり」判定に既存の `state.settings.lastPushedAt`
  (state同期の影響を受けうる値)をそのまま再利用した。理論上、他端末からの採用で
  この値が巻き戻ると誤判定の可能性はあるが、既存の同期ドット表示と同じ前提を踏襲しており、
  今回の事故(pushが物理的に止まっていた)の検知には影響しない。
- アラート表示のタイミングはページ描画時点の評価であり、ホームを開きっぱなしにしていても
  時間経過だけでリアルタイムに赤帯が出現するわけではない(次の `render()` 契機——ナビ切替・
  reload・他の操作による再描画——で反映される。既存の `sync-banner`/`cond-degraded-banner`
  も同じ制約を持つため、このアプリの既存の描画モデルに合わせた)。
