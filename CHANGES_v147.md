# v147 UI改善計画Phase2(数字と警告の信頼回復)

入力: `workbench/out/2026-07-27-taskchute-ui-review/ui-improvement-plan.md`(承認済み計画。
claude-ux-review.md + codex-ui-review.mdの2系統レビューの統合)。本コミット群はそのうち
**Phase2(4項目)**の実装。

## 2-1. 数字の一貫性

### (a) 「今日のタスクシュート」着手率の分母

母数を「当日の全Block」へ統一すると、`homeTaskchute()`が一覧表示する対象(Project紐づき
Blockのみ、`taskchuteBlocks()`)と分母がズレて「X/Yブロック」のYが一覧行数と食い違う
新たな混乱を生むと判断した(taskchute-notes/decisions.md 2026-07-27参照。2026-07-26の
睡眠帯別×taskchuteStartRateの決定と同種の判断)。計画が用意していた代替案(統一で意味が
壊れる場合は見出しに明示)を採用し、分母は従来どおりProject紐づきBlockのまま、見出しを
「今日のタスクシュート」→「今日のタスクシュート(Project紐づき)」に変更した(空状態・
通常状態の2箇所)。

### (b) 12週サイクル残り日数の基準日統一

ホーム(`homeCycle`、旧: `daysBetween(state.selectedDate, ...)`)と週次レビュー
(`computeWeeklyMetrics`、旧: `daysBetween(weekStart, ...)`)で基準日が異なり同じ日でも
表示日数が食い違っていた。節目レビュー画面(`renderCycleReview`)が既に使っている
`todayISO()`基準へ両方を統一した。

## 2-2. 「今日の状態」1枚化

ホームの警告チップ4種(宣言未入力・体力予算・電池残量・週Wish未設定)を新規
`homeTodayStatusCard()`へ統合した。

- **色ルール**: 赤は同期異常等データ保全系の異常だけに使う(既存の同期警告バナーは対象外で
  維持)。体力予算「赤字」は「低予算」と同じオレンジへ、電池残量が閾値(`BATTERY_OK_PCT`、
  後述レビュー対応で40%に統一)未満も赤ではなくオレンジへ変更(`--orange-text`)。宣言未入力・
  週Wish未設定はグレー(`.muted`)。
- **表示条件**: 宣言済み・週Wish設定済み・体力予算が正常/データなし・電池残量が閾値以上の
  4つがすべて揃えば、カードごと非表示(「未対応0件+状態正常なら非表示」)。
- **summary/details構造**: 既存の`homeFoldSection`パターンを再利用。`<summary>`(常時表示)へ
  「エネルギー: 低予算・残量34 / 準備: 宣言済み・週Wish未設定」形式の1〜2行summaryを出し、
  既定closed。体力予算チップ・電池チップ・宣言未入力アラート・週Wish未設定アラート(設定する
  ボタン付き)は`<details>`内(展開しないと見えないが、summary自体が要約を兼ねる)。
- **過去日**: 電池/宣言/週Wishはいずれも既存仕様で「今日」限定のため、過去日は体力予算チップの
  単独表示(従来どおり)のみ。過去日の体力予算閲覧機能は維持した。
- `homeDeclarationCard()`から赤警告行(`.home-declaration-alert`)を撤去(入力欄は無変更)。
- `homeWeeklyWishCard()`は未設定時(taskIds.length===0)に空文字を返すよう変更(設定済み時の
  一覧表示・「今日へ」ボタン等は無変更)。

## 2-3. コントラストAA対応

- CSS変数に文字色専用トークンを追加(最終値。初期実装の白背景基準の値はレビュー対応で
  一段濃く再調整済み。詳細は後述「レビュー対応」1参照): `--orange-text`(#8a5100)、
  `--green-text`(#1b6b3f)、`--teal-text`(#0a6a61)。ダークテーマでは元の
  `--orange`/`--green`/`--teal`(暗い背景に対して4.88〜8.51:1)へフォールバックする。
- `styles.css`内で実際に文字色として`color: var(--orange|green|teal)`を使っている53箇所
  すべてを対応する`-text`トークンへ機械的に置換(`background:`/`border-color:`等の装飾用途は
  対象外、無変更)。
- `.home-cd-lab`(充/放ラベル)・`.home-badge`(着手中/未着手ラベル)のfont-sizeを10px→11.5pxへ。

## 2-4. Block編集モーダルの整理

- `leverageJudgeHelperHTML(currentType)`に引数を追加。既定closedの`<details class="lev-helper">`
  自体はv65から変更なしだが、`currentType`(leverageType)が設定済みなら、summary行を
  「10秒で判定する(任意)」から「10秒判定: 「◯◯」と判定済み(変更する)」に変える。
  Task/Block両モーダルの呼び出し元(`task.leverageType`/`block.leverageType`)を更新。
- `buildBlockModal()`のフッタ削除ボタンに`style="margin-right:auto"`を追加し、キャンセル/保存
  から視覚的に分離した(Block編集モーダルのみのスコープ。他モーダルの共通`.modal-footer`は
  無変更)。

## 規約遵守

- `new Date("文字列")`は使っていない
- input/select/textareaの新規16px未満は追加していない
- `data-action`デリゲーション方式を維持
- sw.js: `CACHE_NAME`を v146→v147
- 機能の削除はしていない(宣言入力欄・週Wish一覧・体力予算チップ・電池チップ・レバレッジ判定は
  いずれも表示位置/既定開閉/色の変更のみで、機能自体は残存)

## 既存テストへの追随修正(仕様変更に伴う正当な更新。弱体化ではない)

`grep -rln "home-declaration-alert\|home-weekly-wish-alert\|home-condition-budget-chip\|home-battery-chip\|home-cd-lab\|home-badge\|lev-helper\|leverageJudgeHelperHTML\|modal-delete\|daysLeft\|残り.*日\|home-wk-days\|今日のタスクシュート\|ff9500\|2fb96d\|13b5a6\|getComputedStyle\|getPropertyValue" tests/`
で洗い出した全ファイルを実走で確認した。

- `tests/v117.test.js`: 宣言未入力の赤警告(`.home-declaration-alert`)は`homeTodayStatusCard`へ
  統合されたため、`.home-today-status`のtextContentで「今日の宣言が未入力です」の有無を見る
  形へ変更([1][2])。
- `tests/v121.test.js`: 未設定時の赤帯(`.home-weekly-wish-alert`)も同様に統合されたため、
  `.home-today-status`のtextContentへ変更。「設定する」ボタンをクリックする前に
  `details[data-fold-id="today-status"]`のsummaryを1度開く手順を追加(既定closedのため。
  以降はlocalStorageのfold状態が保持されreloadしても開いたまま)([1][2])。過去日の確認は
  `.home-weekly-wish-alert`ではなく`.home-today-status`自体の非存在を見る形へ変更([5])。
- `tests/v128.test.js` / `tests/v131.test.js`: `.home-condition-budget-chip`を`.innerText()`で
  読んでいるため(closed detailsの中身は`innerText`では読めない)、最初のseed直後に
  `today-status`のsummaryを1度開く手順を追加。以降は開いたまま推移するため他のcheckは無変更。
- `tests/v137.test.js` / `tests/v144.test.js`: `.textContent()`ベースの読み取りは`<details>`が
  closedでも動作するため無変更で全PASSを確認済み。

## テスト

`tests/v147.test.js`(新規)で5項目を直接検証:
1. 「今日のタスクシュート」見出しに(Project紐づき)が付き、「X/Yブロック」のYが一覧表示件数
   (ルーティンBlockを除く)と一致すること
2. 12週サイクル残り日数がホーム/週次で一致し、selectedDateを動かしても変わらないこと
3. 「今日の状態」: (a) 4つとも良好なら非表示 (b) 何も揃っていなければsummary+details内訳が
   揃うこと(体力予算/電池/宣言未入力/週Wish未設定+設定するボタン) (c) 過去日は体力予算
   チップの単独表示のみ(電池チップは出ない)であること
4. `--orange-text`/`--green-text`/`--teal-text`が定義され、実際に併用される背景
   (`-soft`/`panel-soft`/`panel`)とのペアすべてで4.5:1以上を満たすこと(実測計算で検証。
   レビュー対応で白背景のみの検証から拡張)。`.home-cd-lab`/`.home-badge`のfont-sizeが
   11.5px以上であること
5. レバレッジ3問クイズが既定closedで、未判定時は招待文・判定済み(資産に設定)後は判定結果が
   summaryに出ること。モーダルフッタの削除ボタンがmargin-right:autoで分離されていること

**実行結果**:
- `node tests/v147.test.js`単体: 全項目PASS
- `node tests/v117.test.js` / `v121.test.js` / `v128.test.js` / `v131.test.js`
  (追随修正後): 全項目PASS
- `node tests/v137.test.js` / `v144.test.js`(無変更で確認): 全項目PASS
- `node tests/v65.test.js`(レバレッジ既存回帰) / `v68.test.js`(modal-delete既存回帰) /
  `v124.test.js`(lev-helperのreduced-motion回帰) / `v141.test.js`(modal-delete既存回帰) /
  `v122.test.js` / `v126.test.js`(週Wish「今日へ」既存回帰): 全項目PASS
- `node tests/run-all.js v146 v71 v82 v107 v112 v73 v67 v75 v83 v116`
  (v146関連の広域回帰、フォアグラウンド・timeout 600000): ✅ All suites passed
- `npm run test:core`(フォアグラウンド、timeout 600000明示): 1回目は1スイート失敗(既知の
  ポート衝突フレーク、CLAUDE.md記載の現象)。2回目・3回目は連続で **✅ All suites passed**
  (351.6s / 224.9s)
- `npm test`(全量)は監督者側でpush前に実行するため本ラウンドでは未実行(指示どおり)

## レビュー対応(2026-07-27、Claude+Codex 2系統レビュー)

1. **AAトークンが実背景で未達**: `--orange-text`等は白背景でのみ4.5:1を満たしていたが、
   実際に併用される`--orange-soft`/`--green-soft`/`--teal-soft`/`--panel-soft`上では
   4.17〜4.41にとどまっていた。トークンを一段濃くした:
   `--orange-text:#8a5100`(orange-soft比5.79:1)、`--green-text:#1b6b3f`(green-soft比5.90:1)、
   `--teal-text:#0a6a61`(teal-soft比5.56:1)。最も厳しい`--teal-soft`上でも全トークンが
   5.5:1以上(node script実測)。`tests/v147.test.js`のcontrast検証を「トークン×実背景ペア」
   (各`-text`×同系`-soft`/`panel-soft`/`panel`の9ペア)へ拡張した。
2. **状態カードがティッカーで更新されない**: `updateBatteryTick()`は`.home-battery-chip`だけを
   差し替えており、常時見える`<summary>`の「残量N」が凍っていた。`.home-today-status`カード
   全体をouterHTMLで差し替えるよう変更(`homeFoldSection`はlocalStorageのfold開閉状態を
   再読込するため、開閉状態は自然に保持される)。さらに、カードが「全て良好」で非存在の場合に
   電池残量が閾値を割ったら`renderDeferringForFocus()`で全再描画し、カードを新たに出すように
   変更(旧実装はカード非存在時に何もしておらず、閾値割れを検知できなかった)。
3. **電池の閾値不整合**: 非表示判定(旧: pct>=30)とチップの警告色(旧: pct<60でオレンジ)が
   別の値だった。単一定数`BATTERY_OK_PCT=40`(recoveryThresholdPct既定値と同値)に統一し、
   `computeHomeBatteryInfo()`の`ok`フィールドを両方が共有する。
4. **電池バーの塗り色が文字用トークンになっていた**: `homeBatteryChip()`のバー塗り色
   (装飾)を`--orange`/`--green`(素の彩色トークン)に戻し、文字色(`textColor`、AA対応の
   `-text`トークン)と分離した。
5. **12週ウィジェット内の新たな不整合**: 「Week N」(旧: selectedDate/weekStart基準)と
   「残りX日」(todayISO基準、前段で対応済み)が同一ウィジェット内で矛盾していた。週番号も
   `todayISO()`基準に統一(`homeCycle`の`wk`、`computeWeeklyMetrics`の`wkNum`)。
   `tests/v147.test.js`にWeek N版の不変性・ホーム/週次一致チェックを追加した。
6. **インライン文字色12箇所**(ホームhero系「いま、これ」eyebrow等を含む)を`-text`トークンへ
   変換。`styles.css`の53箇所と同じ機械的パターン(`color:` のみ対象、`background:`は対象外)。
7. **`.bottom-nav button`の10px→11.5px**(`@media (max-width:420px)`側、モバイル主ナビ)。
   375px幅で5列gridのまま「ジャーナル」(最長ラベル)を含め折り返し・オーバーフローが無いことを
   実測確認済み。それ以外に残る10px(`.timeline-card`等)はPhase4のタイポトークン化(K承認済み
   ui-improvement-plan.mdのPhase4「タイポ(3段)・余白(4/8pt)・色のトークン化」)で扱う対象と
   位置づけ、本ラウンドでは見送る。
8. **`homeTodayStatusCard()`と`homeBatteryChip()`の重複計算**を`computeHomeBatteryInfo(date)`
   (新規共通ヘルパー)へ統一。
9. **ダークモード側コメントの数値**を実測に訂正(旧: 「7:1超」は不正確。実際は`--*-soft`背景を
   含めた最小値4.88:1〜最大8.51:1。node script実測でコメントを更新)。
10. **`tests/v128.test.js`/`v131.test.js`の暗黙依存を明示化**: 体力予算チップは「今日の状態」
    カードのdetails内にあり、宣言・週Wishが未設定な限りカードは常に表示される(=これらの
    テストが暗黙に依存していた前提)。`seed()`が`dailyDeclarations`/`weeklyWishes`を毎回
    明示的に`{}`へリセットするよう変更し、コメントで依存関係を明記した。

### 追加検証(レビュー対応後)

- `node tests/v147.test.js`(3d/3e/3fの新規ティッカー・閾値統一・バー色検証を含む)単体: 全項目PASS
- `node tests/run-all.js v147 v146 v144 v137 v128 v131 v117 v121`
  (フォアグラウンド、timeout 600000明示): ✅ All suites passed
- `npm run test:core`(フォアグラウンド、timeout 600000明示): ✅ All suites passed(269.6s)
- 375px幅での`.bottom-nav`目視回帰(JS実測、オーバーフロー無し)を確認
- `npm test`(全量)は指示どおりCIに委ねるため本ラウンドでも未実行
