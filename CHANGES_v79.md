# CHANGES v79

## 概要

K指示「Wishの実行性を上げる2機能」+ 作業中に発覚したKフォローアップ指示2件への対応。

1. Wishカード上のワンタップ実行チェック(編集を開かずに「実現済み」にできる)
2. 月間プランニングボード(1〜12月の枠へWishをドラッグ&ドロップ/タップで配置)
3. (Kフォローアップ1) Wish編集にdueDate(期限・任意)入力欄を追加
4. (Kフォローアップ2) Wish関連の全タスク作成経路でdueDateが「登録日」で自動的に埋まらないよう是正

SW `CACHE_NAME` を v78 → v79 に更新。

---

## 1. カード上ワンタップ実行チェック

`renderWishCard`(app.js)のカード先頭にチェックボックス(`.wish-check`)を追加した。
タップで `data-action="wish-realize"` / `"wish-unrealize"` を発火させ、**既存の
`realizeWish()`/`unrealizeWish()` をそのまま再利用**する(新しい実現ロジックは作っていない)。
これにより:

- `realizeWish()` の `window.confirm` は維持される(誤タップ防止の既存挙動を壊さない)。
- 実現済みにすると `status: "completed"` にもなる既存の副作用も維持される。
- 実現済みカードは既定フィルタ(`showRealized=false`)で一覧から消える既存挙動もそのまま
  (チェックを外すには「実現済みも表示」を先にONにする必要がある。これは今回変更していない
  既存のUXなので、v79では踏襲した)。

誤タップ配慮: チェックボックスはタイトル領域とは別の独立した24x24pxの要素とし、既存の
「開く/閉じる」ボタンとも重ならない位置(行の左端)に配置した。カード上のタイトル自体は
クリッカブルではない(既存どおり)ため、チェックだけが新しい操作面になる。

---

## 2. 月間プランニングボード

### 2.1 データ設計: targetMonth(新設) と targetYear の関係

**targetMonth を targetYear とは独立したフィールドとして新設した**(1〜12 または null=未定)。

現物の `targetYear` UI(`renderWishDetail`)を確認したところ、年は「西暦そのもの」ではなく
「今年からNヶ月後」という**相対年バケット**(0,1,2,3,5,7,10,13,20,30年後)の選択式であり、
「何年何月」という具体的なカレンダー日付を表す設計にはそもそもなっていない。月間ボードが
要求するのは「1〜12月のどの枠に置くか」という**もっと粗い実行プランニングの手がかり**であり、
年の指定を必須にすると「targetYearを設定していないWish(=『いつか』)は月だけ設定できない」
という不便が生じる。

そのため今回は:
- **targetYear未設定でも targetMonth だけを設定できる**(「いつか、でも8月にやりたい」を許容)。
- targetMonth は年をまたいだ「毎年巡ってくる8月」的な緩い意味づけとし、「2026年8月」のような
  厳密な暦日への統合は**今回は行わない**(dueDate/motivation内の会期との整合と合わせてv80検討)。
- 期限バッジ等の表示は作らない(K確定: 期限の見せ場所は週次レビュー)ため、targetMonthと
  dueDateが将来同じUIで衝突することもない。

この判断により、normalizeStateへの後方互換補完は targetYear の隣に `targetMonth: null` を
追加するだけで済み、既存データへの影響はゼロ(既存値優先の展開順を維持)。

### 2.2 UI: リスト⇔ボード切替(新タブは作らない)

Wishタブ内に `.segmented` トグル(既存の routine-mode 等と同じコンポーネント)で
「☰ リスト」「🗓 月間ボード」を切り替える。表示モードは `state.wishViewMode`
(UI状態のみ・`persistLocalNoSchedule`で保存・`dataModifiedAt`は汚さない。既存の
`routineViewMode` と同じ扱い)。既存のarea/showRealizedフィルタはボードでも共通適用される。

ボードは「未定」プール(スクロール可能・`max-height:260px`)+ 1〜12月の12枠
(`grid-template-columns: repeat(auto-fill, minmax(150px,1fr))` でレスポンシブ)。
各枠には件数を常に表示し、カードはコンパクトな1行チップ(タイトル+月選択のみ)にすることで、
初期状態の99件が全部「未定」でも一覧性が壊れない(スクロールで捌く設計)。

### 2.3 D&D実装方式(流用元)

**既存のAI下書きスケジュールのタッチドラッグ(`_draftDrag`、pointerdown/pointermove/pointerup
+ pointercancelのPointer Events。iPad実機タッチ対応)と同じ土台方式を流用**した。相違点は:

- 下書きドラッグは「連続Y座標に15分単位でスナップする1次元移動」だが、月間ボードは
  「どの月枠の上で離したか」を判定する**離散ドロップ**のため、`pointermove`中は
  `document.elementFromPoint(x,y).closest(".month-zone")` でドロップ候補を判定し
  `.drag-over` クラスでハイライト、`pointerup` で実際に `targetMonth` を確定する方式にした。
- 下書きドラッグは pointerdown 時点で即 `preventDefault()` するが、月間ボードの「未定」
  プールは99件スクロールが前提のため、**移動量が閾値(8px)を超えるまではpreventDefaultしない**
  (タップ/スクロールと衝突しないようにするための意図的な差分。閾値未満はタップとみなし、
  カード上の月選択セレクトの操作を邪魔しない)。
- ドラッグ中のカードには `pointer-events:none` を付与し、`elementFromPoint` が
  カード自身ではなく真下の月枠を正しく拾えるようにした(実装時に踏んだ落とし穴)。
- `.wish-board-card` に `touch-action:none` を付与し、iOS Safari がドラッグ中のジェスチャを
  スクロールとして横取りしないようにした。

### 2.4 タップ代替(必須要件)

指示どおり、ドラッグが苦手な場合の代替として**カード自体に月選択の `<select>`
(`data-action="wish-set-month"`)を常時同居**させた。これはドラッグの有無に関わらず常に
機能する経路であり、E2Eテストの主検証経路もこちら(実機Pointer Eventsの再現はPlaywrightで
コストが高いため)。「未定」を選べば `targetMonth: null` に戻せる。

---

## 3. Kフォローアップ1: Wish編集へのdueDate入力欄追加

`renderWishDetail` の年/領域セレクトの下に「期限(任意。週次レビューで参照)」の
`type="date"` 入力を追加した(`data-action="wish-set-duedate"`)。指示どおり**表示側
(バッジ等)は一切作らず、保存のみ**。週次バッチが読む想定。

---

## 4. Kフォローアップ2: Wish関連タスク作成経路のdueDate既定値を是正(重要)

### 4.1 発覚した実データ問題

上記3の作業中、`repos/personal-data/taskchute/app-state.json`(実データ、読み取りのみ)を
確認したところ、**登録済みWish 99件すべてに `dueDate = 登録日(2026-07-11)` が入っている**
ことが判明した。原因は `makeTask()` の既定値ロジック:

```js
dueDate: dueDate || state.selectedDate,
```

`dueDate` を明示的に渡さないタスク作成はすべて「今日」が期限として自動的に入る。これは
タスクシュート実行前提の通常Task/Blockには合理的な既定(その日やることが前提)だが、
**長期的な「やりたいこと」であるWishには意味的に合わない既定**であり、K確認により
「バッチの期限≤当日集計に99件が誤って混入する」実害が確認された(データ・バッチ側は
別エージェントが対応中。本タスクはアプリ側の作成経路の是正のみを担当)。

### 4.2 修正した全経路(`makeTask(` の呼び出し箇所を全数確認)

Wish(kind:"wish"のProject配下)にTaskを作成する経路を洗い出し、**3箇所すべて**で
作成直後に `task.dueDate = ""` を明示するよう修正した(makeTask自体の既定ロジックは
通常Task/Blockのために維持し、Wish側だけ個別に上書きする方式。影響範囲を最小化):

1. `addWish()` — Wishタブの「追加」ボタン
2. `addWishSubtask()` — Wish詳細展開の「+ 追加」(サブタスク)
3. `moveBlockToWish()` — マイグレーション儀式(3回目以降の繰り越し確認)の「手放す→Wishへ移動」

他に `makeTask(` を呼ぶ箇所(WBSの「+タスク」「+サブ」、問いの実行橋渡し、その他Project受け皿)
はいずれも `kind !== "wish"` または `kind === "normal"` のProjectに限定されるルートであり、
Wishには到達しないことをコード上確認した(WBS: `activeProjects = state.projects.filter(p =>
... p.kind !== "wish")`。問い橋渡し: `projects.filter(p => ... p.kind === "normal")`)。

**注意**: 既存の99件(および過去に作られた実データ)は対象外(今回のスコープはアプリの
作成経路のみ)。既存データのクリーニングが必要であれば別途対応が要る。

---

## 5. テスト(`tests/v79.test.js`、新設)

1. normalizeState後方互換: `targetMonth`キー自体が無い旧Wishタスクに`null`が補完される
   / 既存値(5)がある場合は上書きされない(既存値優先)。
2. カード上チェックボックスで`realized`がトグルされる(既存`realizeWish`/`unrealizeWish`の
   挙動=confirm・status連動を含めて回帰確認)。
3. 月間ボード: カード上の月選択(タップ代替)で`targetMonth`が保存される。
4. ボード表示: `targetMonth=8`のWishが8月枠にのみ表示され、未定プール・他の月には出ない。
5. 既存Wish編集(年・モチベーション)の回帰なし + 新規dueDate入力の保存。
6. 新規Wish作成時、dueDateが「今日」で汚染されない(4.2の修正の回帰ガード)。
6b. 同様にWishサブタスク作成でも汚染されない。

全量`npm test`(30スイート、v79含む)フォアグラウンド実行でALL PASS(exit code 0)を確認済み。

---

## 6. 未対応・懸念点

- 実機でのPointer Eventsドラッグ操作そのものはPlaywrightでの自動テスト対象にしていない
  (タップ代替経路のみ自動テスト化。ドラッグの実機確認は目視で別途行うことを推奨)。
- 既存99件のWishのdueDate(誤って登録日が入っている分)のクリーニングはスコープ外
  (データ側は別エージェント対応中との連絡あり)。
- targetMonthとtargetYear/dueDateを組み合わせた「厳密などの年の何月か」という統合UIは
  今回作っていない(2.1節で明記した設計判断どおり、v80以降の検討事項)。
- 月間ボードの月枠に代表カードの「もっと見る」的な展開UIは作っていない(スクロール任せ)。
  1つの月に大量に配置されるケースが出てきたら再検討。
