# CHANGES v76

## 概要

1. 【不具合修正・原因特定】ホーム「AIから」で昨日のフィードバックが読めない不具合の根本原因を特定し修正
2. 【機能追加】ジャーナルタブで「今日基準の前日」のAIフィードバックを常に読めるようにする
3. 【追加スコープ・不具合修正】日報push(`pushFileToGitHub`)のURL組み立てを安全な方式に統一
   (v74で発覚していた本体側の未修正nitへの対応)

---

## 1. 【不具合修正】ホーム「AIから」で昨日のフィードバックが読めない

### 1.1 前提: v75で一度対応済みだったが、症状は再現しうる状態だった

v75(同日, f7e90f6)で `homeAiFeedbackReadHTML()` が追加され、「AIから」カードに本文を読む
`<details>` が新設された。CHANGES_v75.md はこれで不具合が直ったとしているが、**v75の実装自体に
`state.selectedDate` 依存のバグが残っており、特定条件下では追加した details ごと表示されなくなる**
ことが今回の調査で判明した。

### 1.2 実際の原因(現物のコードで特定)

`state.selectedDate` はタブ間で共有され、かつ `localStorage` に永続化される(アプリを閉じても次回
起動時に前回閲覧していた日付が残る)。ここが「今日」でない状態(例: ホームの日付バーで前日/翌日を
一度でも見てからアプリを離れた場合など)になっていると、以下の2箇所が連鎖して失敗していた。

**(a) `hydrateStaticMarkdown()` の前日fetch条件のミスマッチ(app.js 旧9483行付近)**

```js
const today = state.selectedDate;
const prev = addDays(today, -1);                       // ← selectedDate 基準
const wantFetchPrev = (d) =>
  d === addDays(todayISO(), -1) && ...;                 // ← 実際の今日基準でチェック
...
wantFetchPrev(prev) ? fetchGitHubRawText(...) : ...     // prev と判定基準が食い違う
```

`prev`(実際にfetchする対象日)が `state.selectedDate` 基準で計算される一方、`wantFetchPrev()` の
判定は「実際の今日から見た昨日」を基準にしている。`state.selectedDate` が今日以外だと
`prev !== addDays(todayISO(), -1)` となり、**「前日1日分は無条件でfetchする」という v57 由来の
仕様そのものが発火しなくなる**(コメント上は「無条件」と書かれていたが、実際には selectedDate に
連動していた)。

**(b) `homeAiFeedbackReadHTML()` 自体も selectedDate 基準だった(app.js 旧9731行付近)**

```js
function homeAiFeedbackReadHTML() {
  const today = state.selectedDate;      // ← 実際の今日ではなく閲覧中の日付
  const prev = addDays(today, -1);
  ...
}
```

さらに呼び出し側 `homeAiHubBody()` も `isToday`(= `state.selectedDate === todayISO()`)でこの
関数自体をゲートしていた(`const readHTML = isToday ? homeAiFeedbackReadHTML() : "";`)。

つまり (a) で本文がそもそも `cachedFeedback` に載らず、(b) で百歩譲って載っていたとしても
selectedDateが今日でなければ details 自体が描画されない、という**二重の selectedDate 依存**が
あった。v75のテスト(tests/v75.test.js)は `seed()` が常に `selectedDate = TODAY` に固定していた
ため、この経路のバグには気づけない構造だった。

### 1.3 調査で除外した仮説(現物で裏取り済み・原因ではなかったもの)

- **「失敗/空応答を永続キャッシュしてしまうバグ」**: `cachedFeedback[d]` への代入は
  `if (todayFb && ...)` / `if (prevFb && ...)` の形でしか行われず(app.js該当箇所全数確認)、
  空文字列や404はキーごと未設定のまま残る。次回の `hydrateStaticMarkdown()` 実行時に
  再度fetch対象になる。該当パターンは存在しない(tests/v76.test.js [4]で回帰確認)。
- **Service Workerによる api.github.com のキャッシュ汚染**: sw.js は
  `if (url.hostname === "api.github.com") return;` でGitHub APIを明示的にSW経由対象外にしている
  (キャッシュされない)。
- **ファイル名のUnicode正規化(NFC/NFD)不一致**: app.js のテンプレートリテラルも
  personal-data 上の実ファイル名も両方NFCで一致(node で codepoint 比較して確認済み)。
- **`new Date(文字列)` によるタイムゾーンずれ**: `todayISO()`/`addDays()`/`parseDate()` は
  すべて `new Date(y, m-1, d)` 数値コンストラクタ経由で、文字列パースを経由しない。

### 1.4 修正

- `hydrateStaticMarkdown()`: 前日1日分の無条件fetch対象を `addDays(state.selectedDate, -1)` から
  `addDays(todayISO(), -1)` に固定し、`wantFetchPrev` の判定と完全に一致させた。鮮度シグナル
  (`aiLinkFreshness.feedbackAt`)の前日側判定も、selectedDateの閲覧有無に関係なく反映されるよう
  分離した(todayFb側の鮮度判定は従来どおり「今日を見ているときだけ」のまま)。
- `homeAiFeedbackReadHTML()`: `today` を `state.selectedDate` ではなく `todayISO()` に固定。
- `homeAiHubBody()`: `readHTML`(= `homeAiFeedbackReadHTML()`)を `isToday` ゲートから外し、
  Homeでどの日付を閲覧していても常に表示されるようにした(閲覧中日付に関係なく「実際の
  昨日のフィードバックを読む」機能として独立させた)。

### 1.5 既存テスト `tests/v57.test.js` の更新(仕様変更に伴う正当な更新)

上記1.4の修正(1.2(a)の是正)により、「今日から見た昨日」1日分の無条件fetchは
`state.selectedDate` に関わらず常に発火するようになった。`tests/v57.test.js` [1]
(F1回帰: 過去日ブラウズ中はfetchを一切出さない)は、この無条件fetch自体が
`selectedDate===今日`のときしか発火しない**という旧仕様(=今回特定した実バグそのもの)を
「fetch 0件」という形で固定するテストだったため、そのままでは今回の修正で必ず落ちる
(実際に1回目の全量実行で失敗を確認した)。

F1が本来守りたかったのは「閲覧中の(無関係な)日付自身へのfetchノイズを出さないこと」であり、
「今日から見た昨日」1日分の無条件fetch可否ではなかった(コメント上も「前日ノイズ回避」であって
「昨日分は今日を見ているときしか取りにいかない」という仕様を明言してはいなかった)。そのため
[1]の期待値を「fetch 0件」から「①閲覧中の無関係な過去日自身へのfetchは無い(ノイズ回避は維持)
②『今日から見た昨日』1日分は閲覧中の日付に関わらず必ず1件fetchされる(v76の仕様変更)」に
更新した。検証意図(閲覧中の無関係な日付自身へのfetchノイズを出さない)は弱めておらず、
むしろ①として引き続き明示的に確認している。[2]は無改修で従来どおりPASS。

---

## 2. 【機能追加】ジャーナルタブに「今日基準の前日」のAIフィードバック閲覧

### 2.1 既存実装の扱い

`renderJournal()` には元々(最初期のコミットから存在)「前日(selectedDateの前日)のフィードバックも
見る」という details が「🤖 AIフィードバック」パネル内にあった。これは `previous = addDays(
state.selectedDate, -1)` 基準で、**閲覧中の日付が実際の今日のときだけ、たまたま「実際の昨日」と
一致して正しく機能する**設計だった(1.2(a)と同根の selectedDate 依存)。ジャーナルで過去日を
めくると `previous` は実際にfetch済みの日付とずれ、黙って非表示になっていた。

### 2.2 設計判断: 「表示中日付の前日」ではなく「今日基準の前日」に固定した

指示にあった二案(日付追従 or 今日基準固定)のうち、**今日基準固定**を採用した。理由:
- 実装コストが低い(既存の `cachedFeedback`/`state.feedback` をそのまま参照するだけで、新規fetchが
  不要)。
- `hydrateStaticMarkdown()` が実際にfetchするのは「実際の今日から見た昨日」1日分のみ(1.4参照)
  であり、日付追従(閲覧中の任意の過去日のfeedbackを都度fetchする)には fetch対象拡張・
  `feedbackFiles` 登録周りの設計変更が必要でスコープが大きくなる。
- 「今日基準固定」は既存のホーム側実装(1.4)と全く同じ考え方で、実装の一貫性も保てる。

既存の selectedDate 依存の details(2.1)は用途(選択中日付を編集する文脈で、その前日の
フィードバックも参照する)自体は残す価値があるため削除せず、日付基準だけを `previous` から
`yesterdayReal`(= `addDays(todayISO(), -1)`)に変更した。結果として、通常利用(ジャーナルは
今日を見ていることが大半)では表示内容は変わらないが、**過去日を閲覧しても selectedDate に
関係なく「実際の昨日」のフィードバックが読めるようになった**(フェイルソフト: 実際の昨日分が
無ければ details 自体が出ない)。

### 2.3 実装

- `renderJournal()`: `feedbackFromFilePrev` の基準日を `previous`(selectedDateの前日)から
  `yesterdayReal`(todayISO()の前日)に変更。`state.feedback[yesterdayReal]` へのフォールバックも
  追加(旧実装は `cachedFeedback` のみ参照していた)。
- details のクラス名を `journal-yesterday-feedback` にし、見出しを「🤖 昨日(YYYY-MM-DD)の
  AIフィードバックを見る」に統一(ホーム側の表現と揃えた)。
- 新規fetchは追加していない(`hydrateStaticMarkdown()` が埋める `cachedFeedback` の共有のみ)。

---

## 3. 【追加スコープ】日報push(`pushFileToGitHub`)のURL組み立てを安全な方式に統一

### 3.1 経緯・調査結果

K指示により追加されたスコープ。「personal-data/taskchute/ の日報が 日報_2026-06-04.md(v72移行時
コピー)で止まっており、今日生成した日報_2026-07-10.mdが届いていない」という報告を受け、
「`pushFileToGitHub` が `encodeURIComponent(filename)` を `personalDataPath()` に渡しており、
filenameに"/"が含まれるとサブディレクトリごと%2Fに壊れる(v74で発覚した既知の欠陥、
`pushGitHubPath`新設で回避したが本体は未修正)」という仮説が示された。

**現物で検証した結果、この仮説は「日報_YYYY-MM-DD.md」というファイル名そのものには当てはまらない
ことを確認した**(日報のfilenameに"/"は含まれないため、`encodeURIComponent(filename)` は"/"を
持たない文字列を丸ごとエンコードするだけで、`personalDataPath(filename).split("/").map(
encodeURIComponent).join("/")` という安全な方式と**バイト単位で完全に同一のURLを生成する**
ことをNode上で確認済み、かつPlaywrightで実際に生成→pushまで動かして `taskchute/日報_2026-07-10.md`
へ正しくPUTされることも確認した(%2Fは混入しない)。

そのため、この特定の不具合の直接原因はfilenameエンコーディングではないと考えられる。ただし
v74レビューで「本体側修正のタイミングは別途」と保留されていた既知の欠陥ではあり、**将来
サブディレクトリを含むファイル名を pushFileToGitHub に渡した場合に同じ問題が再発する**ため、
今回のタイミングで本体を修正した(指示どおり)。

- `pushFileToGitHub()` のURL組み立てを `personalDataPath(encodeURIComponent(filename))` から
  `personalDataPath(filename).split("/").map(encodeURIComponent).join("/")` に変更。
  `pushGitHubPath`/`gitHubContentsURL`/`fetchGitHubRawResult` と同じ、確立済みの安全な方式に統一。
- filenameに"/"を含まない既存の全呼び出し元(日報_/週次_/12週_/AIフィードバックのアップロード)は、
  修正前後でURLがバイト単位で完全に同一(既存の正常系は無変更)。

### 3.2 未解決の懸念(現物で確認できた事実として報告)

`repos/personal-data` の git 履歴を全数確認したところ、**リポジトリ全体でコミットは9件のみ**で、
うち内訳は「migrate: (初回移行) ×2」「reading:/feedback: (loop側バッチスクリプトの自動コミット) ×4」
「K指示: (人手/AI直接編集) ×3」のみだった。アプリの `saveToGitHub()`/`pushFileToGitHub()` が
生成するコミットメッセージ形式(`chore: update app state <ISO時刻>` / `chore: update <filename>
<ISO時刻>`)に一致するコミットは**1件も存在しない**(`git fetch` でリモートと同期済みであることも
確認済み)。

これは「アプリ本体からのpushが、日報に限らずapp-state.jsonも含めて、v72移行後に一度も
personal-dataへ実際に到達していない可能性がある」ことを示唆する。今回のK指示メッセージにあった
「app-state.jsonのpushは生きている」という前提は、おそらく端末上で保存成功のトースト
(「GitHubへ保存しました」)を見たことに基づくものと思われるが、それが実際にGitHub側へ
到達しているかは今回のリポジトリ調査だけでは確認できなかった(端末のトークン・設定値には
アクセスできないため)。

**次の診断ステップとして推奨**: 修正後、Kの端末で実際に「日報を生成」→「📤 GitHubに日報push」
(または既存の保存ボタン)を押し、
- 成功トースト「📤 日報 YYYY-MM-DD をGitHubへpushしました」が出るか
- 万一「push失敗: ...」トーストが出た場合は、そのエラー文言(トークン権限不足/設定未入力/
  ネットワーク等)がそのまま原因を特定する情報になる

を確認いただきたい。押した直後に `github.com/kojit1229/personal-data` 側でコミットが増えているかも
あわせて見ていただくと、今回の本体修正で解決したのか、別の原因(設定値・トークン権限)が
残っているのかを切り分けられる。

---

## テスト

`tests/v76.test.js` を新設。`tests/v57.test.js` [1] は1.5の理由で期待値を更新(検証意図は
維持・弱体化はしていない)。他の既存スイートは無改変。

1. ホーム「AIから」で、実際の `AIフィードバック_*.md` と同じ見出し構造(`## 明日への提案` 等)の
   前日フィードバック本文が読める(回帰)
2. 【根本原因の回帰】`state.selectedDate` が実際の今日以外でも、ホームで実際の昨日のフィードバックが
   読める
3. ジャーナルタブに「昨日のAIフィードバックを見る」detailsが出る(既定closed)。ジャーナルで
   過去日(2日前)を開いても、対象は選択中日付の前日ではなく「今日基準の前日」のまま変わらないこと
   を確認
4. 前日分のフィードバックファイルが存在しない(404)日でも、ホーム/ジャーナルどちらもクラッシュせず
   details自体が出ない(フェイルソフト)
5. 404の直後にファイルが用意されても、次回起動時には再fetchされて読める(失敗を永続キャッシュ
   していないことの確認)
6. 日報push(`pushFileToGitHub`)のPUT先URLパスに `%2F` が含まれず、
   `taskchute/日報_<date>.md` 形式になっていることの確認

`npm test`(全量、24スイート)で ALL PASS を確認済み。
