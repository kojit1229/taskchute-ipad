# CHANGES v99

## 概要

K依頼(2026-07-15)。WBSタブのタスク行に「翌朝のAI処理を依頼する」チェックUIを追加する。

SW `CACHE_NAME` を v98 → v99 に更新。

---

## 仕様

1. 新フィールド **`criteriaRequest`**(Task直下、boolean、既定false)。`normalizeState` と
   `makeTask()` で後方互換補完。この名前は日次バッチ(`loop/task-criteria.sh`)と合意済みのため
   変更していない。
2. WBSタブのタスク行(通常表示)に、既存の完了チェック(緑の丸ボタン `.checkbox-button`)とは
   明確に区別できるチェックコントロールを追加した: 🤖アイコンの角丸ボタン(`.wbs-criteria-btn`)。
   タップで `criteriaRequest` を true/false トグルし、既存の `updateTaskField` → `saveState` 系統
   で保存する。
3. ボタンに `title` 属性(ホバー/長押しで見えるツールチップ)で挙動を明文化した:
   「チェックすると翌朝の日次バッチが完了条件/スモールステップを自動設定(またはサブタスク生成)
   します。処理後は自動でOFFに戻ります」。`aria-label` はON/OFFで文言を変え、`aria-pressed` も
   同期させた。
4. ON状態は (a) ボタン自体の見た目変化(`.on`クラス — 背景を`--accent-soft`、枠を`--accent`に)
   と (b) 行内バッジ「🤖 AI設定待ち」(既存の `aiWork` フラグ🤝と同じ配置パターン)の二重で
   視覚的にわかるようにした。バッジは既存の `.badge.blue` を流用。

---

## UI文言・配置の判断理由

- **アイコンは🤖**: 依頼書の例示どおり採用。既存の `aiWork`(バッチ側でなくK自身がAI作業ワーカーに
  丸投げする用途、アイコン🤝「AIに作業依頼中」)と役割が異なるため、意図的に別アイコンにして
  混同を避けた。🤝は「今すぐ人力で依頼する対象」、🤖は「翌朝バッチが自動で1回だけ処理する対象
  (処理後自動OFF)」という一過性トリガーの違いがある。
- **ボタンをチェックボックスの直後・タイトルの直前に配置**: `renderTaskRow` の既存の並び
  (折りたたみキャレット → 完了チェック → タイトル → バッジ群)を踏襲し、「タスクの状態を変える
  操作系ボタン」を一箇所にまとめた。編集モード(`wbsEditMode`)のON/OFFに関わらず常時表示にした
  (完了チェック `.checkbox-button` と同じ扱い)。理由: 編集モードでは既存の `inlineEdit`
  (状態/期限/カテゴリのselect群)がバッジ群を置き換えて非表示にするが、AI設定依頼は「編集モード
  かどうか」と独立した一過性の依頼操作であり、編集モード中だけ操作できなくなるのは仕様4
  (既存の完了チェック・進捗入力と干渉しない=独立動作)の趣旨に反すると判断した。
- **形状を角丸四角(`border-radius:8px`)にして完了チェック(真円)と区別**: 色だけでなく形状でも
  差をつけ、iOS Safariの小さい画面でも一瞬で見分けられるようにした。サイズは既存の
  `.checkbox-button`(30×30px)に合わせ、タップ領域の統一感を優先した(依頼書のタップ領域要件は
  既存パターンへの準拠で満たす方針。新規に44px化すると周辺ボタン群との整列が崩れるため見送った)。
- **バッジは非OFF時のみDOMに出す(常時グレー表示にしない)**: 「行が煩雑になるのを避けたい」
  既存WBS行の情報密度(状態バッジ・子タスク進捗・期日・実績時間・カテゴリチップ等が既に並ぶ)を
  踏まえ、ONの時だけ追加情報を出す設計にした。ボタン自体の`.on`色変化がOFF/ON双方の状態表示を
  常時担う。

---

## 変更ファイルと行数

taskchute-ipad リポジトリ、ローカルcommitのみ(push未実施):

1. `app.js` — `criteriaRequest` フィールド追加(normalizeState 1箇所・makeTask 1箇所)、
   `toggleCriteriaRequest()` 関数追加、click委譲に `toggle-criteria-request` アクション追加、
   `renderTaskRow` にトグルボタン+バッジのHTML追加(計 +20 行程度)
2. `styles.css` — `.wbs-criteria-btn` / `.wbs-criteria-btn.on` / `.wbs-criteria-badge` 追加(+24行)
3. `sw.js` — `CACHE_NAME` v98→v99、変更履歴コメント更新(+2/-2)
4. `tests/v99.test.js`(新規) — 仕様(a)〜(e)のE2E回帰テスト
5. 本ファイル: `CHANGES_v99.md` 追加
6. `../taskchute-notes/handoff.md` に本バージョンの引き継ぎログを追記(別リポジトリ、ローカル
   commitのみ)

各コミット単独で200行以下になるよう、実装コミット(app.js+styles.css)・SW/CHANGESコミット・
テストコミットの3つに分けてcommitする。

---

## テスト: `tests/v99.test.js`(新設、5シナリオ)

- (a) トグルON→保存→再描画(リロード)で保持される。再タップでOFFに戻せることも確認
- (b) 既定false・`normalizeState` 後方互換(旧Task=フィールド無し→falseが補完される)
- (c) ON状態が視覚的にわかる(`.on`クラス・`aria-pressed`・バッジ表示)
- (d) 完了チェック(`toggle-task`)・進捗入力(`wbs-progress`)と独立に動作する。両方向
  (criteriaRequestトグルが進捗/完了状態を書き換えない、逆に完了チェックや進捗編集が
  criteriaRequestを書き換えない)を確認
- (e) 390px幅でトグルON状態でも横スクロールが発生しない(`scrollWidth <= clientWidth`)

`npm run test:core`(直近5件が動的に v95〜v99 に更新 + 固定横断コア5件: v72/v59/v67/v50/v70、
計10本)を実行し、回帰0件を確認。

---

## 検証結果

- `node --check app.js`: OK(exit 0)
- `node tests/v99.test.js`: **ALL PASS**(5シナリオ、失敗0)
- `npm run test:core`: **✅ All suites passed**(所要186.8秒、v95〜v99 + 固定コア5本)

「作業済み・未検証」— 上記は機械的検証(1)+ローカルE2E実行の結果であり、DONE手順の
独立検証(fresh contextエージェントによるverify.md準拠レビュー)と最終判定はまだ通していない。

---

## 未対応・懸念点

- 実機iOS Safari(iPhone/iPad)での実地確認はこのセッションでは未実施(taskchute-ipad本体は
  commit止まりでpush禁止のため)。Playwright Chromium(390px viewport、SW block)での検証のみ
- `.wbs-criteria-btn` のタップ領域は既存 `.checkbox-button` と同じ30×30pxに揃えたが、Appleの
  44pt目安には届いていない(既存コードベース全体の慣習に合わせた判断であり、本タスク単独での
  是正は範囲外とした)
- バッチ側(`loop/task-criteria.sh`、実装済みとの前提)が実際に `criteriaRequest:true` のTaskを
  拾って `doneCriteria`/`firstStep` を設定し `false` へ書き戻す一連の連動は、アプリ側のUIのみを
  作った本タスクの範囲では確認していない(GitHub同期を介した実データでのエンドツーエンド確認は
  未実施)
