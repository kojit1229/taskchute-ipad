# CHANGES v95

## 概要

K依頼(2026-07-15)「WBSタブに、タスク単位の進捗率(分子/分母)入力とプログレスバー、
プロジェクト単位の集計表示を追加する」への対応。

SW `CACHE_NAME` を v94 → v95 に更新。

---

## 採用したスキーマ

### Task

| フィールド | 型 | 既定値 | 内容 |
|---|---|---|---|
| `progressNum` | number | `0` | 進捗の分子。0=未着手扱い |
| `progressDen` | number | `10` | 進捗の分母 |

`makeTask()` に追加、`normalizeState()` で旧Taskへ後方互換補完(既存値優先)。

### Project

| フィールド | 型 | 既定値 | 内容 |
|---|---|---|---|
| `showProgress` | boolean | `false` | WBS一覧でΣ分子/Σ分母の集計バーを表示するか |

`normalizeState()` で旧Projectへ `false` を補完。Project編集モーダルにチェックボックスを追加
(`data-modal-field="showProgress"`)。**既定OFF**とした判断理由は「UI判断」節を参照。

### 進捗↔ステータス連動(K追加指示 2026-07-15)

新しい永続ステータス値は追加していない。既存の `task.status` 5値
(`todo`/`doing`/`completed`/`suspended`/`cancelled`)のうち、**`doing`(着手中)が既にラベル
"着手中" で存在した**ため、それをそのまま「着手中」として再利用した(K指示の「存在すればそれを
使う」に該当。新規ステータス値もnormalizeState補完も不要)。

連動ルール(`deriveStatusFromProgress(currentStatus, num, den)`、app.js):

- `suspended`/`cancelled` は進捗編集で上書きしない(意図的な中断を尊重)
- `den <= 0` は判定不能として現状維持(0除算ガードは表示上のみ別途 `taskProgressPct()` で対応)
- `num <= 0` → `todo`(分子0の未完了Taskは従来どおり未着手表示)
- `0 < num < den` → `doing`(着手中)
- `num >= den` → `completed`

分子>分母の入力は `updateTaskProgress()` が分母へクランプしてから上記を適用する。
チェックボックス完了(`toggleTask()`)およびステータスセレクトを直接「完了」にした場合
(`data-wbs-edit="status"`)は、`fillProgressOnComplete()` で分子を分母に合わせる
(分母<=0の場合は分子を変更しない)。

---

## 変更ファイルと行数(コミット分割、全て200行以下)

taskchute-ipad リポジトリ、ローカルcommitのみ(push未実施):

1. `b38687e` app.js +13/-1 — スキーマ追加(makeTask/normalizeState/Project編集モーダル)
2. `5098bc7` app.js +42, styles.css +7 — UI(Task行の常時表示入力+バー、Project集計バー)
3. `5589ae9` app.js +47/-2 — 進捗↔ステータス双方向連動ロジック(K追加指示への対応)
4. `2b26f2c` tests/v95.test.js +192(新規) — E2Eテスト(a)〜(f)
5. `205fadc` tests/v95.test.js +48/-2 — E2Eテスト(g)〜(j)(進捗↔ステータス連動、200行制約のため
   コミットを分割し同一ファイルへ追記)
6. 本コミット: sw.js CACHE_NAME v94→v95、CHANGES_v95.md 追加

---

## UI判断

- **「進捗率を表示」チェックボックスの既定値は OFF**。理由: 既存の `wbsEditMode`/
  `wbsHideCompleted` などWBSの表示系フラグが軒並み既定OFF(opt-in)である既存の流儀に合わせた。
  また、既存Projectはまだ進捗(分子/分母)を使っておらず、既定ONにすると
  「分子0/分母10=0%」のバーが未使用Project全てに一律で出てしまい画面が荒れるため。
- チェックボックスの設置場所は、他のProject単位のON/OFFフラグ(`is12WY` など)と同じく
  Project編集モーダル内(`buildProjectModal`)に置いた。WBS一覧行に常時ボタンを増やすより
  既存の操作導線と一貫する。
- Task行の分子/分母入力欄は `data-wbs-edit`(既存のインライン編集モード限定の属性)とは
  別に `data-wbs-progress` を新設した。既存の「編集モードOFF時は `[data-wbs-edit]` が0件」
  というv55のテスト前提を壊さずに、進捗欄だけを常時表示にするため。
- 入力→保存のタイミングは既存の `data-wbs-edit`(期限/状態/カテゴリ)と同じ **change イベント**
  (blur確定)を踏襲した。iOS Safariでの数値ステッパー操作でも自然に効くはず。入力中のライブ
  プレビュー(inputイベントごとの再描画)は、既存の差分DOMパッチングが無い数値欄で全体再描画を
  頻発させるとフォーカスが飛ぶリスクがあるため採用しなかった。
- 進捗編集による自動ステータス変更は、分子側の入力だけでなく **分母を変えた場合にも同じ規則を
  適用**した(例: 分母を下げて分子と一致させたら completed になる)。K指示の文言は「分子に…
  入力されたら」だが、分子/分母どちらを動かしても最終的な整合性(num/denの関係とstatusが常に
  一致する)を保つほうがバグが少ないと判断した判断拡張。

---

## テスト: `tests/v95.test.js`(新設、10シナリオ)

- (a) normalizeState後方互換(旧Task→0/10、旧Project→false)
- (b) 編集モードOFFでも入力欄が常時表示され、入力→change→保存→再描画で値保持
- (c) バー幅がnum/denに一致、分母0で0%(0除算ガード)
- (d) Project集計(Σ分子/Σ分母)が正しく算出される
- (e) showProgress OFFでProject集計バーが非表示(Task入力欄は表示のまま)
- (f) 390px幅で横スクロールが発生しない
- (g) チェックボックス完了→分子が分母と同じ値になる
- (h) 完了済みTaskに分子<分母を入力→完了解除されdoing(着手中)になる
- (i) 分子>分母を入力→分子が分母にクランプされcompletedになる
- (j) 分子=分母を入力→completed。分子0の未完了Taskはtodoのまま

既存WBS関連スイート(v55/v59/v61/v62/v63/v65/v66/v67/v70/v71/v77/v82/v86)+v95を
`node tests/run-all.js` で個別実行し、回帰0件を確認。

---

## 検証結果

- `node --check app.js`: OK(exit 0、全コミット時点で確認)
- `node tests/v95.test.js`: **ALL PASS**(10シナリオ、失敗0)
- WBS関連の既存13スイート + v95 の個別実行(`node tests/run-all.js v55 v59 v61 v62 v63 v65 v66
  v67 v70 v71 v77 v82 v86 v95`): **✅ All suites passed**(回帰なし)
- `npm run test:core`(直近5件: v91〜v95 + 固定横断コア5件: v72/v59/v67/v50/v70、計10本):
  **✅ All suites passed**(所要193.7秒)

「作業済み・未検証」— 上記は機械的検証(1)+ローカルE2E実行の結果であり、DONE手順の
独立検証(fresh contextエージェントによるverify.md準拠レビュー)と最終判定はまだ通していない。

---

## 未対応・懸念点

- Kの補足「この後、別エージェントが『自己分析』プロジェクト等のタスクを分母=設問数付きで
  app-state.jsonへ直接登録する予定」に対応するスキーマは上記の通り
  `task.progressNum`(既定0)/`task.progressDen`(既定10)。直接JSON編集時は
  `state.dataModifiedAt` のbumpを忘れないこと(taskchute-journal-SKILL.md記載の既知の罠)。
- `../taskchute-notes/review.md` の未対応指摘(2026-07-14全体レビュー分、9件)はWBS/進捗表示に
  直接関係する項目が無かったため今回は対応していない(指示の「WBS/進捗表示に直接関係するもの
  のみ確認」に従った判断)。
- 実機iOS Safariでの実地確認はこのセッションでは未実施(taskchute-ipad本体はcommit止まりで
  push禁止のため)。Playwright Chromium(390px viewport)での検証のみ。
- Project集計バーの分母には「中断/中止」タスクの進捗を含めない(`isTaskCountable()` で除外し、
  既存の完了率バー `taskProgress()` と算出対象を揃えた)。中断中のタスクにも分子/分母が入力
  済みの場合、集計上は無視される仕様になっている点はKの元の依頼文には明記が無く、こちらの
  判断で決めた。
- 進捗編集はTask行の分母を直接書き換えられる(K依頼どおり)。分母を極端に小さくする操作への
  UI上の警告・確認は入れていない(既存のdueDate/category等のインライン編集も同様に無確認即保存
  のため、既存の流儀に合わせた)。
