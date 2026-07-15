# CHANGES v98

## 概要

K依頼(2026-07-15、依頼書「開発依頼書: 完了条件・スモールステップ欄の新設とAI自動設定、表示コンパクト化」のR4のみ)
「縦方向のコンパクト化(iPhoneは現状維持)」への対応。

SW `CACHE_NAME` を v97 → v98 に更新。

---

## 変更方針(iPhone側1pxも変えないための実装方法)

`styles.css` の共通(未スコープ)構造クラス — `.main-pane` / `.view-header` / `h2` / `.grid` /
`.panel` / `.section` / `.item` / `.form-strip` / `.btn` — は縦方向のpadding/margin/gap/
min-heightを持ち、これまで幅を問わず同じ値だった。今回は**既存の宣言を1行も編集せず**、
ファイル末尾寄りに新規の `@media (min-width: 760px) { ... }` ブロックを追加し、その中だけで
これらの値を上書きした。

CSSのカスケードでは同じ詳細度(単一クラスセレクタ)の場合、後に書かれた宣言が勝つ。新規ブロックは
既存の `@media (max-width: 720px)` / `@media (max-width: 420px)` ブロックより後(ファイル末尾寄り)
かつ、それら2つのブロックとは幅の範囲が重ならない(`min-width:760px` は 720px 以下では絶対に
評価されない)。そのため:
- 720px以下では新規ブロックは一切評価されず、既存の見た目は完全に不変
- 760px以上では新規ブロックが既存の基本値を上書きし、コンパクトな値になる

`git diff styles.css` は**純粋な44行挿入(削除0行)**であることを確認済み(既存行を1行も
書き換えていない、という最も強い機械的証拠)。

**`.timeline-card` の絶対配置・40px/時のスケールには一切触れていない**(依頼書の変更禁止事項)。
タイムライン本体(`.timeline` / `.time-row` / `.timeline-card` / ズームコントロール)は対象から
明確に外した。

---

## 採用した値(before → after、min-width:760px側のみ)

| セレクタ | プロパティ | before | after |
|---|---|---|---|
| `.main-pane` | padding | `max(22px,…) 24px 32px` | `max(16px,…) 22px 20px` |
| `.view-header` | margin-bottom | 18px | 12px |
| `h2` | margin-bottom | 12px | 8px |
| `.grid` | gap | 12px | 8px |
| `.panel` | padding | 14px | 10px |
| `.section` | margin-top | 18px | 12px |
| `.item` | padding / gap | 12px / 8px | 9px / 6px |
| `.form-strip` | padding / gap | 10px(gapは元々8px) | 8px / 6px |
| `.btn` | min-height / padding | 36px / `8px 12px` | 33px / `7px 11px` |

`.row` の `gap` 圧縮は当初案に入れていたが、`.block-row > .row`(モバイル固有の複合セレクタ)や
複数コンテキストで既に個別調整されており、影響範囲の見切りが曖昧だったため**見送った**
(スコープを構造クラス9個に絞ることでリスクを抑えた判断。R4の主目的である「セクション間隔・
行の余白の圧縮」は上記9個で十分カバーできている)。

`.btn` の `min-height` は 36→33px の小幅な変更に留めた。iPadはタッチデバイスでもあるため、
Appleのタップ領域推奨(44pt目安)を大きく割り込まない範囲で控えめに調整した(依頼書は
「デスクトップ・iPad」を対象にしているが、iPadはマウスではなく指での操作が主なため）。

---

## 実測結果(scrollHeight、Playwright Chromiumでの実測)

同一データ(タスク8件・Block2件、うち3件が期日8日後=R3の折りたたみ込み)を投入し、
`document.scrollingElement.scrollHeight` を測定。BEFORE = R3のみ(v97時点、`git stash` で
R4分のstyles.css差分を一時退避して計測)、AFTER = 本バージョン(R4適用後)。

| 画面 | 幅 | BEFORE | AFTER | 差分 |
|---|---|---|---|---|
| ホーム | 1024px(iPad) | 1770px | 1690px | **-80px(-4.5%)** |
| タスクシュート | 1024px(iPad) | 1910px | 1704px | **-206px(-10.8%)** |
| タイムライン | 1024px(iPad) | 1639px | 1610px | **-29px(-1.8%)** |
| ホーム | 390px(iPhone) | 2134px | 2134px | **±0px** |
| タスクシュート | 390px(iPhone) | 1667px | 1667px | **±0px** |
| タイムライン | 390px(iPhone) | 1769px | 1769px | **±0px** |

iPhone幅の3画面は `scrollHeight` が1px単位で完全一致。目視比較(スクリーンショット差分)でも
唯一の差はタイムラインの「現在時刻」赤線ラベル(BEFORE計測時12:44→AFTER計測時12:45、実行時刻の
ずれによるもの)のみで、レイアウト差分はゼロだった。

---

## 変更ファイルと行数

taskchute-ipad リポジトリ、ローカルcommitのみ(push未実施):

1. styles.css +41/-0 — `@media (min-width: 760px)` 新規ブロック(既存行の編集なし)
2. sw.js +4/-1 — `CACHE_NAME` v97→v98、変更履歴コメント追加
3. tests/v98.test.js +196(新規) — CSS構造クラスの回帰テスト
4. 本ファイル: CHANGES_v98.md 追加

diffの合計が200行以下(41+4+196+本ファイル)のため、依頼書の「1コミット200行以下」分割方針上、
CSS実装コミット・SW/CHANGESコミット・テストコミットの3つに分けてcommitする(各コミット単独でも
200行以下)。

---

## テスト: `tests/v98.test.js`(新設、4シナリオ)

- (a) iPad幅(1024px)で対象9セレクタの縦方向プロパティがコンパクト化後の値になっている
- (b) iPhone幅(390px)で同じ9プロパティが従来値のまま(R4の影響がゼロ)であることを
  computed styleで直接検証
- (c) `.item` の縦padding合計がiPad幅の方がiPhone幅より小さいことを確認(コンテンツの折返しに
  左右されない、CSSが生む余白量だけを比較する指標)
- (d) `.timeline-card` の `position: absolute` がiPad幅・iPhone幅とも変わっていないことを確認
  (変更禁止事項の回帰確認)

`npm run test:core`(直近5件が動的に v94〜v98 に更新 + 固定横断コア5件: v72/v59/v67/v50/v70、
計10本)を実行し、回帰0件を確認。

---

## 検証結果

- `node --check app.js`: OK(exit 0)
- CSSの中括弧バランスチェック(`{`/`}` 数一致): OK
- `node tests/v98.test.js`: **ALL PASS**(4シナリオ、失敗0)
- `npm run test:core`: **✅ All suites passed**(所要170.1秒、v94〜v98 + 固定コア5本)
- `git diff styles.css`: 純粋な41行挿入・削除0行(既存の `max-width:720px` / `max-width:420px`
  ブロックを含む既存行を1行も変更していないことの機械的証拠)
- iPad幅(1024px)・iPhone幅(390px)のビフォー/アフタースクリーンショット(ホーム/タスクシュート/
  タイムライン、計12枚)を保存:
  - `scratchpad/v98-before-{home,tasks,timeline}-{1024,390}.png`
  - `scratchpad/v98-after-{home,tasks,timeline}-{1024,390}.png`

「作業済み・未検証」— 上記は機械的検証(1)+ローカルE2E実行の結果であり、DONE手順の
独立検証(fresh contextエージェントによるverify.md準拠レビュー)と最終判定はまだ通していない。

---

## 未対応・懸念点

- `.row` のgap圧縮は影響範囲の見切りが曖昧だったため見送った(上記「変更方針」節参照)。
  追加のコンパクト化余地はあるが、今回はリスクを抑える判断をした
- ホーム画面の `.home-*` 系専用クラス(スコアボード・ライフカウンタ等)は今回のコンパクト化
  対象に含めていない。共通構造クラス(`.section`/`.panel`等)の圧縮による間接的な効果のみ
  (ホームは-80px/-4.5%と3画面中もっとも効果が小さかった。ホーム専用に手を入れる余地あり)
- `.btn` のmin-height縮小(36→33px)はiPadのタッチ操作性とのトレードオフ。実機iPadでの
  タップしやすさは未検証(Playwright Chromiumでの座標クリックのみ)
- 実機iOS/iPadOS Safariでの実地確認はこのセッションでは未実施(taskchute-ipad本体はcommit
  止まりでpush禁止のため)。Playwright Chromium(1024px/390px viewport)での検証のみ
