# CHANGES test-infra(2026-07-14)

## 概要

K承認済みのテスト基盤改善2点。**アプリ機能の変更ではないため vNN 形式にせず、
SW `CACHE_NAME` のbumpも行っていない**(ユーザーが触る挙動は一切変わらない)。

1. テスト実行ポートのランダム化(二重実行時の偽失敗防止)
2. push前ローカルゲートを「コアセット」に絞る新設スクリプト `npm run test:core`
   (`npm test` = 全量、CIも全量のまま — 変更なし)

対象範囲は `tests/` 配下のみ。`app.js` / `styles.css` / `sw.js` は無改変。

---

## ①ポートのランダム化

### 問題
`tests/vNN.test.js` は各スイートが `const PORT = <固定値>;` を持ち、`tests/helpers.js` の
`startServer(PORT)` で使い捨てHTTPサーバを立てる設計。調べたところ、ポート値は歴史的に
使い回されており(例: `4193` が v54/v57/v58、`4194` が v53/v59、`4215` が v77/v78で重複)、
2ターミナルで同時に `npm test` を回す、あるいはCIとローカルのpush前ゲートが偶然重なる、
といった二重実行があると `EADDRINUSE` で片方が偽失敗する状態だった。

### 対応
`tests/helpers.js` に `randomPort(min = 20000, max = 40000)` を追加(実行のたびに
20000〜40000のランダムな整数を返すだけの純関数)。全40本の `tests/vNN.test.js` について:
- `require("./helpers")` の分割代入に `randomPort` を追加
- `const PORT = <固定値>;` → `const PORT = randomPort();` に置換

これだけで、各ファイル内での `PORT` の使い方(`startServer(PORT)` / `page.goto(...${PORT}...)` /
一部スイートの `page.route` でのポート一致判定)は一切変更していない。`PORT` という定数名を
実行時にランダム値で初期化するようにしただけ、という最小変更(監督者指示どおり「helpers/run-all
の現物構造に合わせて最小変更」)。

### 実証
`tests/v49.test.js` と `tests/v50.test.js`(元々は別ポート4199/4198だったが、ランダム化後は
両方ともrandomPort()の払い出し値になる)を**2プロセス同時起動**し、両方が衝突なくALL PASSする
ことを確認した(2回目の同時実行時点で旧固定値は使われていない)。

---

## ②コアセット(`npm run test:core`)

### 背景
現在 `tests/` には40本のスイートがあり、全量 `npm test` は10分超かかる。push前に毎回
全量を回すのは開発速度を落とすが、絞り込みすぎると回帰を見逃す。そこで
「実質的にカバー範囲が広いサブセット」を新設し、**pushの度にローカルで実行する既定**だけを
変える(CIは唯一の完全な安全網として全量のまま)。

### 構成(計10本、`tests/run-core.js` が算出)

**直近5バージョン(動的)**: `tests/` の `vNN.test.js` を番号降順でソートし上位5本を機械的に
選ぶ。新しいスイートが追加されるたびに自動で追従するため、メンテ不要。
現時点(HEAD `737b895` / v92まで存在)では `v92, v91, v90, v89, v88`。

**固定の横断コア5本(選定理由)**:

| スイート | 選定理由 |
|---|---|
| `v72` | privacy/同期ゲート。個人データ読み書きを同一オリジンfetchからGitHub Contents APIへ移行した際の起動時ゲート(トークン/dataOwner/dataRepo未設定→セットアップ画面)を**唯一直接検証**しているスイート(`helpers.js`の`passGithubGate`を意図的に使わず、ゲート自体を組み立てて確認している)。この経路が壊れると全機能がゲートで止まるため優先度が高い。 |
| `v59` | 朝の一括プランニング=下書き(`_scheduleDraft`)機構の代表。`computeFreeGaps`の境界値・繰越の`migratedTo`付与・二重繰越防止など、以後のAI連携系機能が乗る土台を広くカバーする。 |
| `v67` | `normalizeState`の新フィールド移行を最も広く踏む(旧Task/旧stateへの4箇所の後方互換補完+AI作業結果の二重登録防止まで検証)。 |
| `v50` | タイムライン上のスケジュール下書きD&D(ドラッグ移動/下端リサイズ/確定/破棄)。タイムライン描画とdraft操作の複合ケースであり、`v59`(データ生成側)と役割が異なる。 |
| `v70` | タイムラインカードの実行接点(▶いま開始/■いま終了、フォーカスタイマー連動、中断記録)描画。純粋なタイムライン描画(`position: absolute`)ではなくカードの状態遷移中心だが、`normalizeState`後方互換ケースも含み1本で複数観点を踏める。 |

直近5バージョンと固定5本が将来重複した場合(例: 固定コアの番号が新しくなり「直近5」に
自然に入ってくる)は `tests/run-core.js` 内で重複除去しているため、実行本数が10本を割る
ことはあっても増えることはない。

### `npm test` / CI への影響
- `tests/run-all.js` は無改変。`package.json` の `test` スクリプトも無改変(全量のまま)。
- `.github/workflows/test.yml` も無改変(`npm ci` → `npx playwright-core install` →
  `npm test` で従来どおり全量)。
- **スイートの削除・スキップ・弱体化は一切行っていない**(NEVER 5)。変更したのは
  「pushのたびにローカルで何を回すかの既定」だけ。

---

## 変更ファイル

- `tests/helpers.js`: `randomPort()` を追加・export
- `tests/v49.test.js` 〜 `tests/v92.test.js`(全40本): `randomPort` の分割代入追加 +
  `PORT` 定数をランダム化(機械的な2行変更 × 40ファイル)
- `tests/run-core.js`(新設): コアセット算出+実行
- `package.json`: `"test:core": "node tests/run-core.js"` を追加(`test`/`test:quick`は無改変)
- `CLAUDE.md`: 「テスト実行方針」節を改訂(開発中/push前ローカル/CIの3段+コアセット構成+
  ポートランダム化の記載)
- (vault側)`Obsidian/knowledge/skills-src/taskchute-journal-SKILL.md`: 同内容をSkill正本へ反映

---

## 検証結果

- `node --check` を `tests/helpers.js` / 全40本の `tests/vNN.test.js` / `tests/run-core.js` に
  実行し、いずれも構文エラー無し
- ポートランダム化の実証: `tests/v49.test.js` と `tests/v50.test.js` を2プロセス同時起動 →
  両方ともALL PASS(ポート衝突なし)
- `npm run test:core`(コアセット10本、フォアグラウンド実行): **ALL PASS**、所要時間 **183.0秒
  (約3分)**
- `npm test`(全量40本、フォアグラウンド実行。ランダム化後の回帰確認・本件最後の全量ローカル
  実行): **ALL PASS**、所要時間 約10分33秒

---

## 未対応・懸念点

- コアセットの固定5本は現時点(HEAD `737b895`)のapp.js機能構成に基づく選定であり、今後
  大きな機能追加(例: 新しい同期方式、新しいdraft系UI)があれば見直しが必要。選定基準自体
  (privacy/sync gate・draft機構・normalizeState後方互換・タイムライン描画)は残るはずなので、
  差し替え時はこのCHANGESの表を更新すること。
- `randomPort()` の範囲(20000〜40000)は現状の固定ポート帯(4190〜4285)と重ならないよう
  離しているが、他の開発ツール(devサーバ等)がこの帯域を恒常的に使っている場合は衝突しうる。
  現時点ではローカル環境での確認のみ(CI環境=GitHub Actions runnerでの動作はpush後のCI成功
  確認で担保する)。
- 別件: `../taskchute-notes/review.md` に「v73〜v91の多数のコミットが200行超過」
  「run-all.jsは中断時に子Chromiumプロセスが残る」という既存の未対応指摘(severity: high/low)
  があるが、いずれも今回のK承認スコープ(①②)の外のため対応していない。監督者への報告で
  別途フラグする。
