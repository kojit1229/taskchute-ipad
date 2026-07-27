# v158 AI機能第2弾「勝手に格言」

K発注仕様(workbench/out/2026-07-27-taskchute-ai5/spec.md 機能2)。日次バッチが前日の行動ログに
ちなんだ「偉人風の捏造格言」を生成し、アプリの軽い場所に表示する(ADHD支援の面白がりレイヤー、
v157「今日の敵」の第2弾)。バッチ側実装は ClaudeCode ワークスペース側
(`loop/scripts/quote-forge.sh` / `quote-forge-extract.py` / `quote-forge-validate.py` /
`loop/quote-forge/prompt.md`)。本ファイルはアプリ側(taskchute-ipad)の変更点のみを記録する。

## アーキテクチャ

既存のAI連携パターン(バッチ→personal-data→アプリfetch、ai-linked-app-dev Skill)をそのまま
踏襲。アプリ内からAI APIは一切呼ばない。生成物が無い日/JSONが壊れている日はカードごと出さない
(決定論フォールバック=非表示。既存機能を壊さない)。

## 変更内容(app.js)

1. `cachedQuoteJson`(非永続、セッションメモリのみ)を新設。`hydrateStaticMarkdown()` 内で
   `勝手に格言_<実際の今日>.json` を1回だけfetchし、`JSON.parse` する。パース失敗・
   オブジェクトでない・`quote`/`author`いずれかが空/欠損の場合はすべてフェイルソフトで
   `cachedQuoteJson`に書き込まない(カード非表示のまま。バッチ側の不具合・仕様変更でアプリが
   落ちないようにする防御)。今日の敵と同じく前日分の無条件fetchは行わない(当日限定の演出)。
2. `homeQuoteCard(isToday)` を新設。ホーム「今日」タブ最下部・「今日の足あと」の下に、
   `📜 (格言) — 偽偉人名 ※AIによる捏造です` の小さな1行カード(`class="panel"`)として表示する。
   - 過去日の閲覧中(`isToday===false`)は出さない
   - `quote`/`author`は`escapeHTML`した上でプレーンテキストとして表示(`renderMarkdown`は使わない)
   - バッチ側の上限(quote200字/author80字、`quote-forge-validate.py`)と揃えた表示側クリップを
     二重防御として実施
   - **「※AIによる捏造です」の注記はJSONの`note`フィールドを一切読まず、固定文言としてアプリ側
     が常時付ける**(バッチ側が万一注記を欠落・改変しても、ジョークだと一目で分かる体裁が
     崩れないようにするための信頼境界。`quote-forge-validate.py`側の設計と対称)
3. `renderHomeTodayTab()` の末尾(「今日の足あと」の`</details></div>`の直後)に
   `homeQuoteCard(isToday)` を追加。

## SWキャッシュ

`sw.js` の `CACHE_NAME` を `v157` → `v158` へ更新。

## テスト

`tests/v158.test.js` を新設(ファイルあり=表示・なし=非表示・壊れたJSON=非表示・
quote/author欠損=非表示・「※AIによる捏造です」の注記が必ず出る・エスケープ・過去日は非表示・
同一オリジンfetch無し・quote200字境界の絵文字クリップが文字化けしない、の9観点。9番目は
下記レビュー対応・項目1で追加)。既存テストへの影響は無い想定(新規カードの追加のみで既存
DOM構造・既存アクションは無変更)。

## 2026-07-28レビュー対応(2系統、FAILなし・条件付き)

1. **クリップのコードポイント対応(Codex指摘)**: `homeQuoteCard()`のquote/authorクリップを
   `Array.from`ベース(コードポイント単位)に変更した。JSの`.length`/`.slice`はUTF-16コード
   単位(サロゲートペアは2単位)で数えるため、絵文字等がクリップ境界に掛かると孤立サロゲート
   による文字化けを起こしうる問題を修正(バッチ側`quote-forge-validate.py`のPython`len()`は
   元々コードポイント単位のため、この修正で両者の数え方が一致した)。`tests/v158.test.js`に
   絵文字を含む200字境界のクリップテスト(観点9)を追加。
2. `sw.js`の変更履歴コメントに、v157→v156と番号が飛んでいた欠落(v157「今日の敵」導入時に
   コメント自体が追加されていなかった)を埋める`// v157: ...`ブロックを追補した。
3. `cachedQuoteJson`/`cachedTodayEnemyMd`とも、fetch失敗時・該当ファイル無し(404)の場合に
   `cachedXxx[realToday] = 値 || undefined`を明示代入するようにした。従来はfalsy判定
   (`!cachedXxx[realToday]`)だけで「未取得」を判定していたため、取得に失敗した日は
   キャッシュに登録されず、同一セッション内でhydrateStaticMarkdownが再度走るたび
   (タブ切替・visibilitychange復帰等)に404を再発行し続けていた。判定を`realToday in
   cachedXxx`(キーの有無)へ変え、取得試行済みであることを明示的に記録することで、
   コメントに書かれていた「1回だけfetch」を実挙動として成立させた。
4. `hydrateStaticMarkdown()`内の今日の敵fetchと勝手に格言fetchを、互いに独立した別ファイル・
   別キャッシュであることを踏まえ`Promise.all`で並列実行するよう統合した(従来は2つの
   `if`ブロックがそれぞれ`await`する逐次実行だった)。
5. 本節を追記(このCHANGES_v158.md自体の更新)。

いずれも`node tests/run-all.js v158 v157`・`npm run test:core`で検証済み(全件PASS、詳細は
実装ログ参照)。

## バッチ側の実証(参考、ClaudeCodeワークスペース側)

`loop/scripts/quote-forge.sh` を単体実行で検証済み:
- 1回目: `personal-data/taskchute/日報_2026-07-27.md`(前日分)を抽出→claude生成→検証OK→
  `personal-data/taskchute/勝手に格言_2026-07-28.json` を生成しcommit・push成功
- 2回目: 当日分が既に存在するため「既に本日の『勝手に格言』が存在するためスキップ(冪等)」で
  即exit 0(抽出・生成を一切行わない)

## 未対応(K承認待ち)

- `loop/scripts/quote-forge.sh` のタスクスケジューラ登録・coach-dailyチェーンへの組み込みは
  実施していない(spec通り単体実行検証まで)。
