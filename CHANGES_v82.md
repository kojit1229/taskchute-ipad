# CHANGES v82

## 概要

UX監査(`workbench/out/2026-07-12-ux-audit/findings.md`)の「B. K判断が必要」のうち、
K承認済みのB1/B2/B3に対応。SW `CACHE_NAME` を v81 → v82 に更新。

---

## 対応表(findings.md B1〜B3)

| # | 指摘 | 対処方式 | 変更箇所 |
|---|---|---|---|
| B1 | bottom-nav 5枠に「ジャーナル」が無く、日課の朝動線(ホーム→ジャーナルで体調記録)が「その他」経由の2タップに沈んでいる一方、不定期にしか触らないWBSが一等地にいる | `mobileNav` を home/WBS/実行/時間/その他 → **home/ジャーナル/実行/時間/その他** に入替。WBSは`navItems`からは消していないため、`renderMore`(その他グリッド)の除外リストを`["home","wbs","tasks","timeline"]`→`["home","journal","tasks","timeline"]`に変更しただけで自動的に受け皿(その他)に出るようになる | app.js(`mobileNav`, `renderMore`) |
| B2 | MIT×Project紐付きBlockがホームで最大4箇所(hero/MIT/タスクシュート/ながれ)に完了ボタン付きで重複表示され、画面が伸びる | 「今日のリズム」ゾーン(ながれ+ルーティン、旧`homezone-2`)を**既定closedの折りたたみ**にした。hero/MIT/タスクシュート本体の3つは維持(集計目的が異なるため完全な重複排除は今回はしない)。集計値(ながれの完了数・ルーティン実行率)は畳んだ状態でも失われないよう、summary行に要約表示する(`homeZone2Summary()`) | app.js(`renderHome`, 新設 `homeZone2Summary`) |
| B3 | ホームの常時表示ゾーンだけでiPhone数スクリーン分あり、「今日やること」に到達するまでが長い | 常時表示を「信条・寿命(最上部固定)/いま、これ(hero)/MIT/タスクシュート/AIから」に絞り、**スコアボード**と**読書カード(今日の1冊から)**を既定closedの折りたたみへ縮小。長い弧(zone3)・今日の足あと(zone4)は既にv71で既定closed済みのため変更なし。「今日の理想」空欄カードはv81で対応済み(変更なし) | app.js(`homeScoreboard`, `homeReadingCard`) |

---

## foldId設計(B2: v73縮退モードとの整合)

v73で導入済みの縮退モード(`isConditionDegraded`)は、朝の体調が悪い日だけ「今日のリズム」ゾーンを
`data-fold-id="zone2-degraded"` として畳む独立した実装を持っていた。今回の変更は**通常時にも同じ
ゾーンを畳む**ため、2つのモードのfoldIdを衝突させずに共存させる設計にした。

```
renderHome() の homezone-2 ブロック:
  degraded === true  → <details data-fold-id="zone2-degraded" ...>  (v73から既存)
  degraded === false → <details data-fold-id="zone2"           ...>  (v82で新設)
```

- **なぜ同じfoldIdに統一しなかったか**: 縮退時と通常時で「開いた/閉じた」を覚えておきたい文脈が異なる
  (体調が悪い日にたまたま開いていたからといって、通常の日もデフォルトで開いてほしいわけではない、
  逆も然り)。foldIdを分けることで、`isHomeFoldOpen`/`setHomeFoldOpen`(localStorage
  `taskchute-journal-home-fold-v1`)がモードごとに独立した開閉記憶を持てる。
- **両者とも既定値はfalse(closed)**で統一。挙動の一貫性は「畳む」という結果ではなく、この
  「foldIdが別」という設計で保証している(どちらのモードで開いても、もう一方のモードの開閉状態を
  汚さない)。
- どちらのsummaryにも同じ`homeZone2Summary(blocks)`を使い、集計値の見せ方(「ながれ X/Y ・
  ルーティン実行 Z%(done/total)」)を揃えた。

同様に、B3で新規に折りたたみ化したスコアボード(`data-fold-id="home-scoreboard"`)・
読書カード(`data-fold-id="home-reading"`)も、既存の`homeFoldSection()`ヘルパーをそのまま再利用
しており、既存の`creed`/`lifespan`/`zone3`/`zone4`/`home-ideal-empty`と同じ仕組み
(localStorageキー1つ、id毎にbooleanを記憶)に乗っている。新しいfold機構は追加していない。

---

## 補足

- **スコアボードの「ジャンプ」機能との整合**: `homeScoreboard`の各セルは`data-action="home-jump"`
  でジャンプ先(`homezone-2`等)を自動で開いてスクロールする既存機能(v33〜)を持つ。スコアボード
  自体も折りたたまれたため、ジャンプ操作を使うにはまずスコアボードを開く必要があるが、
  スコアボードのsummary自体に集計値を要約表示しているため、「値だけ見たい」用途は畳んだままで
  足りる(ジャンプしたい時だけ開く)。
- **読書カードの気づきやすさ**: 常時フル表示だとホームの一等地を占有する一方、v74で追加した
  「1行言語化」の入力は放置されると機会損失になる。summary行に書名+「(記入済み)/(未記入)」を
  出すことで、畳んだままでも今日の1冊と記入状況だけは一瞥できるようにした。
- **一度でも開いたセクションの開閉状態はlocalStorage記憶(既存仕様)**: 今回追加した3つの
  foldId(`zone2`, `home-scoreboard`, `home-reading`)もすべて既定値だけを変えており、
  ユーザーが一度開けば以後は開いたまま維持される(`homeFoldSection`/直書き`<details>`いずれも
  同じ`toggle`イベント委譲で`setHomeFoldOpen`に記憶される)。

---

## 既存テストの変更(弱体化ではなく仕様変更への追従)

B1/B2/B3はいずれも「見えている物」自体を変える仕様変更(K承認済み)のため、以下の既存テストは
現物確認のうえで正当に更新した。テストを緩めた箇所はない(むしろ新しい仕様に対する具体的な
アサーションを追加している)。

| ファイル | 変更内容 | 理由 |
|---|---|---|
| `tests/v71.test.js` | [1b] `mobileNav`の期待値を `["ホーム","WBS","実行","時間","その他"]` → `["ホーム","ジャーナル","実行","時間","その他"]` に更新。ヘッダコメントの「mobileNavは意図的に不変更」という記述も更新 | v71時点では意図的に不変更としていたが、v82(B1・K承認)でmobileNav自体を変更したため、旧テストのままだと新仕様で必ず落ちる |
| `tests/v71.test.js` | [7] スコアボードの「今日の主役」ジャンプ検証で、`.home-score[data-id="homezone-3"]`をクリックする前に`details[data-fold-id="home-scoreboard"] summary`を開く一手順を追加 | B3でスコアボード自体が既定closedの折りたたみになったため、閉じたままでは中のセルがクリック不可(Playwrightの可視性チェックで失敗する)。テストの意図(ジャンプ機能の検証)は変えていない |
| `tests/v74.test.js` | [1b] 読書カードのdetailsが既定closedであることの確認+タップで開く手順を追加してから、以降の`fill`/`click`(言語化の入力・保存)を実行するようにした | B3で読書カードが既定closedの折りたたみになったため、閉じたままでは入力欄・保存ボタンが操作不可。一度開けばlocalStorageに記憶され、以降のreloadでも開いたままなので、以降のテスト本体(read-merge-write検証等)は無修正で通る |

上記以外の既存スイート(v49〜v81)は無修正で全量PASSしている(`.home-dot`/`.home-box`等の
選択子はDOM順で先に来る非折りたたみ側の要素にマッチするため、今回の折りたたみ化の影響を受け
なかった。詳細は動作確認済み)。

---

## テスト

`tests/v82.test.js` を新規追加(PORT 4219、iPhone縦持ち390×844で検証)。検証内容:
1. B1: bottom-navの並びが `ホーム/ジャーナル/実行/時間/その他`。bottom-navのジャーナルタップで
   1タップで`currentView`が`journal`になる。「その他」画面にWBSが受け皿として出て、
   ホーム/ジャーナル/実行/時間は「その他」に出ない
2. B2(通常時): `zone2`が既定closed。summaryに「ながれ X/Y」「ルーティン実行 Z%(done/total)」の
   集計が出る。閉じている間は本文が見えず、タップで開くと見える。開閉状態はlocalStorageに記憶され
   リロード後も維持される
3. B2(縮退時): `zone2-degraded`も既定closedで、`zone2`とは独立したfoldIdとして共存する
   (縮退時に`zone2`は存在せず、通常時に`zone2-degraded`は存在しない)
4. B3: 初期表示で信条/寿命(既定open)・いま、これ・MIT・タスクシュート・AIからが折りたたみ無しで
   見える。スコアボード・読書カードは既定closedで、summaryに集計値/書名が要約表示される。
   長い弧(zone3)・足あと(zone4)は既存どおり既定closedのまま(回帰確認)
5. スコアボードを開いてから「ルーティン実行」セルをジャンプすると、閉じたままの`zone2`が
   自動的に開く(既存home-jump機構の回帰確認)

`npm test`(全量、`v49`〜`v82`まで全スイート)で **ALL PASS** を確認済み。
