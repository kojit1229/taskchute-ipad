# v159 AI機能第3弾「未来の自分からの手紙」

K発注仕様(workbench/out/2026-07-27-taskchute-ai5/spec.md 機能3)。月次バッチが目標ファイル
(goals/配下)+直近7日分の日報から「1年後の自分」視点の短い手紙を生成してストックし、アプリで
過去の手紙も一覧で読めるようにする(ADHD支援の面白がりレイヤー、v157「今日の敵」・v158
「勝手に格言」の第3弾)。バッチ側実装は ClaudeCode ワークスペース側
(`loop/scripts/future-letter.sh` / `future-letter-extract.py` / `future-letter-validate.py` /
`loop/future-letter/prompt.md`)。本ファイルはアプリ側(taskchute-ipad)の変更点のみを記録する。

## アーキテクチャ

既存のAI連携パターン(バッチ→personal-data→アプリfetch、ai-linked-app-dev Skill)をそのまま
踏襲。アプリ内からAI APIは一切呼ばない。今日の敵/勝手に格言と異なり本機能は「日次で1回きり
見る演出」ではなく「月次ストック+過去分も読み返せる」設計のため、**新しい一覧UIは作らず既存の
AIレポート画面(AI_REPORT_TYPES/report-index機構)に相乗り**する(K発注仕様どおり)。

## 変更内容(app.js)

1. `AI_REPORT_TYPES` に `{ id: "letter", label: "未来からの手紙", prefix: "未来からの手紙_" }`
   を追加。既存の`aiReportFilesForType()`/`renderAiReportBody()`/report-index機構が無変更で
   そのまま使える(月次ファイル名の日付部分`YYYY-MM`は既存の`slice(prefix.length, -3)`が
   拡張子`.md`を除去するだけのロジックのため、日付桁数に依存せず動く。自己分析_YYYY-MM.mdと
   同型)。
2. `cachedFutureLetterMd`(非永続、セッションメモリのみ、当月キーのみ保持)を新設。
   `hydrateStaticMarkdown()` 内で `未来からの手紙_<実際の当月>.md` を1セッション1回だけfetchし、
   今日の敵/勝手に格言と同じ「取得試行済みかどうかをキーの有無で判定」パターン
   (`realCurrentMonth in cachedFutureLetterMd`)を踏襲する。3つのfetchは互いに独立な別ファイル・
   別キャッシュのため`Promise.all`で並列実行する(v158の2026-07-28レビュー対応・項目4と同じ方針)。
3. `homeFutureLetterLink()` を新設。ホーム(内省側)タブの「AIから」カード直前に、当月分が
   存在する間だけ `✉️ 未来からの手紙が届いています` の小さな1行導線(`class="panel"`)を出す。
   無い月は空文字を返しカードごと非表示(フェイルソフト)。
4. クリックハンドラに `open-future-letter` アクションを追加。タップでAIレポート画面の
   「未来からの手紙」タブへ直接遷移する。
5. `renderHomeReflectTab()` の「AIから」カード直前に `homeFutureLetterLink()` を追加。

## SWキャッシュ

`sw.js` の `CACHE_NAME` を `v158` → `v159` へ更新。

## テスト

`tests/v159.test.js` を新設。観点:
1. AIレポート画面の種類タブに「未来からの手紙」が追加され、選択すると`未来からの手紙_*.md`の
   履歴一覧(月次=YYYY-MM形式)と本文が表示される(**report-index.json経由のみを本スイートで
   直接検証**。Contents APIフォールバック経路自体はaiReportFilesForType/triggerAiReportDirLoad
   側の既存ロジック無改変のため新規テストは追加していないが、v138.test.jsの既存回帰テストで
   引き続きカバーされている〈本対応で再実行しALL PASS済み〉)
1b. report-index.jsonへ意図的に当月分`未来からの手紙`エントリを含めない状態(coach-dailyの
   日次再生成が新着を反映していない状態の再現)でも、`hydrateStaticMarkdown()`の直接fetch成功分が
   `_aiReportDirCache`へunionされ、選択肢・本文とも表示される(下記「必須修正2」の直接検証)
2. 当月分の`未来からの手紙_<当月>.md`が存在する日は、ホーム(内省側)タブの「AIから」近くに
   導線(`✉️ 未来からの手紙が届いています`)が表示される
3. 当月分が存在しない日(404)は導線が表示されない(フェイルソフト)
4. 導線をタップするとAIレポート画面へ遷移し「未来からの手紙」タブが選択された状態になる
   (kind判定の実質確認を兼ねる)
5. 公開Pages側(同一オリジン)への`未来からの手紙_*.md`へのfetchは一切発生しない
   (同一オリジンfetch回帰の防止、v157/v158と同じ観点)

テスト内のfixture本文(`LETTER_BODY`)は実際のバッチ生成物(private/personal-dataリポジトリ)の
逐語ではなく、完全に架空のテスト専用文字列にしている(v157/v158.test.jsと同じ「公開repoに
private生成物の文面を置かない」原則)。

既存テストへの影響は無い想定(新規タブ・新規導線の追加のみで、既存DOM構造・既存アクション・
既存AI_REPORT_TYPES要素は無変更)。

## バッチ側の実証(参考、ClaudeCodeワークスペース側)

`loop/scripts/future-letter.sh` を単体実行で検証済み(初回実装時点、参照元=`goals/`当時):
- dry-run: goals/読み込み・claude呼び出し・personal-dataへの書き込みを行わず、ダミーデータで
  抽出→検証の配線のみ確認(検証OK・pushなしを確認)
- 1回目(実行): `goals/*.md`(7件)+`personal-data/taskchute/日報_2026-07-2{1..7}.md`
  (直近7日、7件)を抽出→claude生成→検証OK→
  `personal-data/taskchute/未来からの手紙_2026-07.md` を生成しcommit・push成功
- 2回目(実行): 当月分が既に存在するため「既に今月の『未来からの手紙』が存在するためスキップ
  (冪等)」で即exit 0(抽出・生成を一切行わない)

**2026-07-28、参照元切替後に再実証済み**(下記「懸念点」節参照): 新ソース(12週サイクル+
Vision/Daily_Affirmation)で1回目=生成push+index更新、2回目=冪等スキップを再確認。
抽出結果は`cycleGoals=3 vision=yes journalDays=7`(実データ: アクティブな12週プロジェクト
「感想をまとめる」「ウイスキー検定2級 合格」等3件+Vision.md/Daily_Affirmation.md+日報7日分)。

## 未対応(K承認待ち)

- `loop/scripts/future-letter.sh` のタスクスケジューラ登録・coach-dailyチェーンへの組み込みは
  実施していない(spec通り単体実行検証まで)。

## 懸念点(監督者へ共有・2026-07-28に解消済み)

- ~~発注仕様どおり `goals/` 配下を目標ファイルとして読んでいたが、実体はKの個人的な人生目標では
  なく本ワークスペースのインフラ・ヘルスチェック用goal宣言だった~~ → **K承認(2026-07-28)により
  解消**: 参照元を `goals/`(インフラのヘルスチェック用goal宣言)から、アプリの実際の**12週
  サイクル目標(`personal-data/taskchute/app-state.json`)+ Vision.md/Daily_Affirmation.md
  (`personal-data/taskchute/content/`)** へ切替済み。バッチ側の変更詳細は
  `loop/scripts/future-letter-extract.py`冒頭コメント・`loop/FORMAT_CONTRACT.md`
  「未来からの手紙_YYYY-MM.mdの契約」参照(アプリ側=本リポジトリの変更は無し。参照元切替は
  バッチ側〈ClaudeCodeワークスペース側〉のみで完結する)。今月分(`未来からの手紙_2026-07.md`)は
  旧ソース由来の内容を削除し、新ソースで作り直し済み(personal-dataリポジトリのcommit履歴:
  `fe3f415`削除→`92c8069`新ソースで再生成・push→`637dd27`report-index.json再生成・push)。

## 2026-07-28レビュー対応(2系統、Claude reviewer + Codex)

初回実装後の2系統レビューで、「手紙は存在するのにAIレポート画面の『未来からの手紙』タブが
空になる」不具合が実際に発生することが判明し、以下を修正した(いずれもverify-goals.sh的な
機械検証ではなく人間可読の実挙動レビューで検出)。

### 必須修正1: report-index.jsonとの整合(バッチ側)
- **現象**: `future-letter.sh`で手紙を生成・pushしても、`personal-data/taskchute/report-index.json`
  (アプリのAIレポート画面が優先的に読む索引)はcoach-daily.shの日次バッチが再生成するまで
  当該ファイルを知らないままになる。48時間以内の鮮度チェックは通ってしまうため、アプリは
  「indexは新鮮だが中身に新着の手紙が載っていない」状態を正常系として扱い、Contents API
  フォールバックへ降りない結果、タブが空表示になっていた(2026-07-28に実際に発生・確認)。
- **対応**: (a) 発覚時点でpersonal-dataの`report-index.json`を`report-index-build.py`で
  再生成し即時push(実証: `未来からの手紙_2026-07.md`が`kind:"letter"`で索引に載ったことを
  確認)。(b) `loop/scripts/future-letter.sh`に`rebuild_report_index()`(`loop/coach-daily.sh`の
  同名関数と同一ロジック)を追加し、手紙のpush成功直後に必ず呼ぶよう変更(月次単発実行でも
  索引が即座に追随する)。(c) `loop/FORMAT_CONTRACT.md`と`future-letter.sh`冒頭コメントに、
  将来coach-dailyチェーンへ組み込む場合は「チェーン側の`rebuild_report_index()`呼び出しより
  前に本スクリプトを置くこと」を明記した。

### 必須修正2: indexが古くてもタブが空にならない自衛策(app.js、Codex指摘)
- `hydrateStaticMarkdown()`が`未来からの手紙_<当月>.md`の直接fetchに成功した場合、および
  `triggerAiReportDirLoad()`が一覧(`_aiReportDirCache`)を確定させた直後の両方で、
  `knownFutureLetterEntries()`/`unionKnownFutureLetters()`により`cachedFutureLetterMd`に
  記録済みの月をunionする。これにより、report-index.jsonの反映が遅延・失敗していても、
  アプリが実地でfetchに成功した手紙は必ずタブに表示される(バッチ側の修正1と対をなす二重防御)。
- `tests/v159.test.js`に観点[1b]を追加: report-index.jsonへ意図的に当月分`未来からの手紙`
  エントリを含めない状態でAIレポート画面を開き、直接fetch成功分がunionされて選択肢・本文とも
  正しく表示されることを確認する(「indexに手紙が載っていない状態でタブを開くと表示される」の
  直接検証)。

### 必須修正3: 初回セットアップ前の失敗キャッシュ抑止(app.js、Codex指摘)
- GitHub(personal-data)連携が未設定(`personalDataReady()===false`)の間は、
  `cachedFutureLetterMd`/`cachedTodayEnemyMd`/`cachedQuoteJson`のいずれにも`undefined`を
  書き込まないよう`want*Fetch`のガードを追加した(`ghReady && !(key in cachedXxx)`)。
  従来は未設定時も`fetchGitHubRawText`が空文字を返す挙動に乗って「取得試行済み(undefined)」が
  キャッシュに固定されてしまい、セットアップ完了直後の`hydrateStaticMarkdown()`再実行
  (`gate-continue`アクション)でも二度とフェッチされない不具合が今日の敵/勝手に格言も含めて
  潜在していた(v159追加時に発覚、3機能共通で修正)。

### 推奨修正5: テストfixtureの架空化
- `tests/v159.test.js`の`LETTER_BODY`を実際の1回目バッチ生成物の文面から、完全に架空の
  テスト専用文字列へ差し替えた(上記「テスト」節参照)。

### 推奨修正6: ホーム導線タップ時のrender重複解消
- `open-future-letter`アクションを`setAiReportType("letter")`(自身がrender()する)経由から、
  `open-questions`等と同じ「`state.settings.aiReportType`を直接書き換え→
  `persistLocalNoSchedule()`→`setView()`」の型に変更し、render()が1回だけ走るようにした。

いずれも`node tests/run-all.js v159 v158 v157 v113 v138`・`npm run test:core`で検証済み
(詳細は本ファイル末尾の実行結果参照)。
