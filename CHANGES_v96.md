# CHANGES v96

## 概要

K依頼(2026-07-15、依頼書「開発依頼書: 完了条件・スモールステップ欄の新設とAI自動設定、表示コンパクト化」のR1のみ)
「Taskに『完了条件』『スモールステップ』欄を新設する」への対応。

背景: 心理検査で「じっくり考える課題への着手回避(頻繁)」「詰めの甘さ」が確認され、対策として
「完了条件の事前明文化」と「最初の一歩の極小化」をアプリに組み込む(適用指針の正典は
`knowledge/self/profile.md`、git管理外)。

SW `CACHE_NAME` を v95 → v96 に更新。

R2(日次バッチでのAI自動設定)/R3(タスクシュート画面の表示範囲を絞る)/R4(縦方向コンパクト化)は
別エージェントが後続で対応する(本バッチはR1のみ)。

---

## 採用したスキーマ

### Task

| フィールド | 型 | 既定値 | 内容 |
|---|---|---|---|
| `doneCriteria` | string | `""` | 完了条件。「行動でなく“終わったら残る物”で書く」1文 |
| `firstStep` | string | `""` | スモールステップ。「5〜15分で終わる最初の行動」 |

`makeTask()` に追加、`normalizeState()` で旧Taskへ後方互換補完(既存値優先。既存の
progressNum/progressDen 補完パターンと同じ場所・同じ流儀)。命名は既存の `aiWorkBrief`/
`description` 等の camelCase 流儀に合わせた。

---

## 変更ファイルと行数

taskchute-ipad リポジトリ、ローカルcommitのみ(push未実施):

1. app.js +23/-0 — スキーマ追加(`normalizeState`/`makeTask`)+ 編集モーダル(2テキストエリア)+
   保存処理(`saveTaskFromModal` の新規/更新両分岐)+ タスクシュート画面の未完了タスク一覧への
   行内サブテキスト表示(`renderOpenTasks`)
2. sw.js +4/-1 — `CACHE_NAME` v95→v96、変更履歴コメント追加
3. tests/v96.test.js +223(新規) — E2Eテスト(a)〜(e)
4. 本ファイル: CHANGES_v96.md 追加

diffの合計が200行以下(23+4+223+本ファイル)のため、依頼書の「1コミット200行以下」分割方針上、
schemaコミット・SW/CHANGESコミット・テストコミットの3つに分けてcommitする(各コミット単独でも
200行以下)。

loop側(`loop/scripts/journal-requests-apply.py`)にも `make_task_dict` へ同フィールドを追加
(依頼書要件4)。この変更はワークスペース最上位 `C:\Users\kojit\Documents\ClaudeCode` が
git管理外のため、taskchute-ipadのcommit対象には含まれない(py_compileと個別の適用テストのみで
検証)。

---

## UI判断

- **表示先はタスクシュート画面(dueDateベースのタスク一覧=`renderOpenTasks`、`renderTasks()`内の
  「未完了タスク」セクション)の行内**。監督者指示により、v95で新設されたWBSタブの
  `renderTaskRow`(進捗バー付きの別ビュー)には表示しない。両者は別画面・別データ経路であり、
  今回のR1要件は「タスクを開かず一覧で見える」場所としてタスクシュート画面を明示指定されたため。
- 完了条件は🎯、スモールステップは👣の絵文字プレフィックスで区別した。他のバッジ表現
  (🤝AI作業ワーカー連携など)と同様、絵文字1文字でカテゴリを視認できるようにする既存流儀に
  合わせた。
- 両欄とも**空欄なら該当行そのものを出力しない**(依頼書要件どおり)。既存の `dueLabel`/
  `todayCount` 表示と同じ「値があるときだけ追加」パターンを踏襲。
- 編集モーダル内の設置位置は「期限」フィールドの直後、「レバレッジ(10x機構)」の直前とした。
  Taskの中核情報(タイトル/Project/ステータス/期限)のすぐ後に置き、任意項目(レバレッジ/AI作業
  連携/説明)より優先度を上げた。
- textareaは`min-height:48px`(2〜3行程度)とし、`aiWorkBrief`と同じ短文メモ用の大きさに揃えた
  (`description`欄の120pxほど大きくする必要はないと判断)。
- プレースホルダ文言は依頼書の指定どおり一字一句採用: 完了条件=「行動でなく“終わったら残る物”で
  書く」、スモールステップ=「5〜15分で終わる最初の行動」。

---

## テスト: `tests/v96.test.js`(新設、5シナリオ)

- (a) normalizeState後方互換(旧Task→doneCriteria/firstStepとも"")
- (b) Task編集モーダルにテキストエリアがあり、プレースホルダのガイド文言・font-size 16px以上
- (c) 両欄に入力→保存→リロード後も値が保持される
- (d) タスクシュート画面の未完了タスク一覧に、開かずに両欄のサブテキストが見える。空欄タスクには
  出ない(同一画面内で入力済み/空欄の2件を比較)
- (e) 390px幅でサブテキスト表示込みでも横スクロールが発生しない

既存タスクシュート関連スイート(v58/v59/v60/v67/v72/v92/v93/v94/v95 を含む `npm run test:core`)を
実行し、回帰0件を確認。

---

## 検証結果

- `node --check app.js`: OK(exit 0)
- `node tests/v96.test.js`: **ALL PASS**(5シナリオ、失敗0)
- `npm run test:core`(直近5件: v92〜v96 + 固定横断コア5件: v72/v59/v67/v50/v70、計10本):
  **✅ All suites passed**(所要153.1秒)
- `python -m py_compile loop/scripts/journal-requests-apply.py`: OK
- `journal-requests-apply.py` のスモークテスト(テスト用app-state.jsonコピー+ createTask 1件の
  検証済み操作JSONに対しdry-run実行): 生成されたTaskに `doneCriteria: ""` / `firstStep: ""` が
  含まれることを実測確認(既存フィールドの並び・値は変更なし)
- `bash loop/guardrails/verify.sh`(ワークスペース DONE 手順1): exit 0(全39検査通過)
- タスクシュート画面のスクリーンショット(390px幅、両欄がタスクを開かず行内に見える状態、
  空欄タスクには出ない状態を1画面で比較)を検証物として保存
  (`scratchpad/v96-taskchute-390px-2.png`)

「作業済み・未検証」— 上記は機械的検証(1)+ローカルE2E実行の結果であり、DONE手順の
独立検証(fresh contextエージェントによるverify.md準拠レビュー)と最終判定はまだ通していない。

---

## 未対応・懸念点

- `../taskchute-notes/review.md` の未対応指摘(2026-07-14全体レビュー分、9件)はR1(Task欄新設・
  タスクシュート画面表示)に直接関係する項目が無かったため今回は対応していない(監督者指示の
  「R1に直接関係する指摘のみ確認」に従った判断)。
- R2(日次バッチでのAI自動設定)は本バッチのフィールド追加が前提となるため、まだ実装していない
  (依頼書の変更単位分割どおり、app側R1のデプロイ完了後に別途対応)。
- R3(表示範囲を絞る)/R4(縦コンパクト化)も未対応(別エージェント担当)。
- 実機iOS Safariでの実地確認はこのセッションでは未実施(taskchute-ipad本体はcommit止まりで
  push禁止のため)。Playwright Chromium(390px viewport)での検証のみ。
- WBSタブ(`renderTaskRow`)には今回doneCriteria/firstStepを表示していない。両欄をWBS側にも
  出すかは依頼書に明記が無く、監督者指示で表示先をタスクシュート画面のみに絞ったため対応範囲外
  とした。
