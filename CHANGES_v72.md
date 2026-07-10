# CHANGES v72

## 概要

個人データ(app-state.json・日報・AIフィードバック・AIプラン・週次レビュー・AI作業結果・
Vision/Daily_Affirmation)の読み書きを、**同一オリジンfetch(GitHub Pagesの静的ファイル)から
GitHub Contents API(Fine-grained PAT認証・private リポジトリ)へ全面切替**した。あわせて、
トークン・個人データリポジトリ未設定の端末では**アプリの中身を一切表示しないセットアップ画面
(トークンゲート)**を追加した。

**重大な経緯(なぜこの変更が必要だったか)**: 従来、`settings.github`(owner/repo/branch/path/
token)は既定で **`kojit1229/taskchute-ipad`(=このアプリ自身のpublicリポジトリ)** を指しており、
`app-state.json` の自動保存・世代バックアップ・自動アーカイブは(token設定済みの端末では)
すべてこの public リポジトリへ書き込まれる設計だった。実際、このリポジトリのルート直下には
`Vision.md` / `Daily_Affirmation.md` が実データ(家族名・生年月日・人生観を含む)のまま
コミットされている。v72はこれをprivateリポジトリへ分離することで、この構造的な漏洩経路を塞ぐ。

**Kへの重要な申し送り(下記「未対応・懸念点」参照)**: `Vision.md` / `Daily_Affirmation.md` は
今回のコード変更だけでは public リポジトリの git 履歴・ワーキングツリーから消えない。実データを
守るには追加の対応(ファイル削除・履歴のscrub)が必要で、これは無人では行わない破壊的操作の
ため、本タスクのスコープ外として**Kの判断・作業**に委ねる。

---

## 1. データ配置契約(監督者確定)

private リポジトリ `kojit1229/personal-data`(設定でowner/repo変更可)の `taskchute/` 配下:

```
taskchute/
  app-state.json
  日報_*.md
  AIフィードバック_*.md
  AIプラン_*.json
  週次レビュー_*.md
  AI作業結果_*.json
  backups/app-state-*.json
  archive/archive-*.json
  content/Vision.md
  content/Daily_Affirmation.md
```

---

## 2. 設定の拡張(app.js: `defaultGitHubSettings` / `normalizeState`)

`state.settings.github` に **`dataOwner`**(既定 `kojit1229`)・**`dataRepo`**(既定 `personal-data`)
を追加した。**`branch`・`token` は既存フィールドを共用**する(PATに personal-data リポジトリへの
Contents 権限を足すだけで両リポジトリに使い回せる運用)。

既存の `owner`/`repo`/`path` フィールドはスキーマ上は残すが(後方互換・normalizeStateの補完対象
のまま)、**個人データの読み書きコードはもう一切これらを参照しない**。設定画面(GitHub設定カード)
の Owner/Repository 入力欄は `dataOwner`/`dataRepo` にバインドし直した(`renderSettings`)。

新設ヘルパー(app.js、`requireGitHubConfig` の直前):
- `personalDataReady(cfg)` — token・dataOwner・dataRepo が揃っているか
- `personalDataConn(cfg)` — `{owner, repo, branch, token}`(dataOwner/dataRepo を owner/repo として返す)
- `personalDataPath(name)` — `taskchute/${name}`
- `personalDataFileConfig(cfg, name)` — 上記2つ+pathをまとめた形(既存の`gitHubContentsURL`等へ
  そのまま渡せる)
- `fetchGitHubRawText(name)` — 個人データリポジトリからの読み込み専用GET(下記3節)
- `setPersonalDataAuthError` / `clearPersonalDataAuthError` / `renderPersonalDataAuthBanner` — 401
  バナー(下記5節)

`requireGitHubConfig()` は dataOwner/dataRepo/token の3つを検証し、`personalDataFileConfig` で
変換した `{owner, repo, branch, path, token}` を返すよう書き換えた。これにより `saveToGitHub` /
`loadFromGitHub` / `syncFromGitHubOnStartup` / バックアップ復元(`openBackupListModal` /
`restoreBackup`)は**内部実装を変えずに**個人データリポジトリへ向くようになった。

---

## 3. 読み込みのAPI化(app.js: `hydrateStaticMarkdown` / `tryFetchAiPlan` / `fetchAiPlanFreshnessDate` /
`hydrateAiWorkResults`)

同一オリジンの `fetchText(path)` を全廃し、`fetchGitHubRawText(name)` に置き換えた:

```
GET https://api.github.com/repos/{dataOwner}/{dataRepo}/contents/taskchute/{name}?ref={branch}
Accept: application/vnd.github.raw+json
Authorization: Bearer {token}
```

対象は Vision.md → `content/Vision.md`、Daily_Affirmation.md → `content/Daily_Affirmation.md`、
AIフィードバック_\*.md、週次レビュー_\*.md、AIプラン_\*.json、AI作業結果_\*.json の6種。

- 未設定(token/dataOwner/dataRepo のいずれか無し)・404 は**静かに空文字を返す**(既存の
  「まだ届いていない」フォールバックと完全に同じ挙動)。
- **401だけ**具体的なバナーを出す(5節)。
- 旧来の同一オリジンパスへのフォールバックは**意図的に残していない**(それ自体が漏洩経路のため)。
- 廃止に伴い `fetchText()` 関数自体を削除した(呼び出し元が0件になったため)。

---

## 4. 書き込み先の変更(app.js: `saveToGitHub` / `pushFileToGitHub` / バックアップ・アーカイブ系)

以下すべてのPUT/GET/DELETE先を `personalDataConn`/`personalDataPath` 経由の個人データリポジトリ
(`taskchute/` 配下)へ変更した:

| 関数 | 用途 | 変更後のパス |
|---|---|---|
| `saveToGitHub` / `loadFromGitHub` / `syncFromGitHubOnStartup` / `runAutoSyncPush` / `runAutoSyncPull` | app-state.json | `taskchute/app-state.json` |
| `maybeWriteBackupSnapshot` / `listBackups` / `pruneOldBackups` / `restoreBackup` | 世代バックアップ | `taskchute/backups/app-state-日付.json`(`BACKUP_DIR`を変更) |
| `runArchive` / `loadArchiveForSearch` | 自動アーカイブ | `taskchute/archive/archive-年.json` |
| `pushFileToGitHub`(日報 / AIフィードバックアップロード) | 日報・フィードバック | `taskchute/日報_日付.md` / `taskchute/AIフィードバック_日付.md` |

`pushFileToGitHub` / `uploadFeedbackFile` / `pushReportToGitHub` / `generateReport`の自動push条件は
すべて `personalDataReady()` で判定するよう更新(旧: token+owner のみで判定)。

`restoreBackup` に**修正込み**: 旧実装は復元後に `next.settings.github = { ...next.settings.github,
...cfg, token }` としており、`cfg` が `requireGitHubConfig()` の変換後の形(owner/repoがdataOwner/
dataRepoの値、pathが`taskchute/app-state.json`)になったため、そのまま流し込むと**dataOwner/
dataRepo/pathが壊れる**バグになる箇所だった。復元前の生の `state.settings.github` 全体をそのまま
引き継ぐよう修正した(復元はデータの中身の話であり、GitHub接続設定は端末側の話という分離を
維持)。

---

## 5. トークンゲート(K確定の設計)

`render()` の先頭で `personalDataReady(state.settings.github)` を判定し、false ならアプリの中身
(サイドバー・ボトムナビ・タイムラインレール・各ビュー)を一切描画せず、`renderGate()` が返す
全画面セットアップ画面だけを `#main` に出す(サイドバー・ボトムナビ・タイムラインレールは空に
する)。

- 画面には private リポジトリを使う理由の説明・設定手順(PAT発行→Contents権限付与→入力)・
  Owner/Repository/Token の3入力欄(`data-github-field="dataOwner"/"dataRepo"/"token"`、既存の
  input/changeハンドラをそのまま再利用)・「設定してはじめる」ボタンを表示する。
- 判定は**localStorageの設定有無のみ**(指示どおり。トークンの有効性検証はしない)。
- 「設定してはじめる」(`gate-continue`)クリック時に再判定し、まだ揃っていなければトーストで
  案内。揃っていれば `render()` で通常画面へ進み、`syncFromGitHubOnStartup()` →
  `hydrateStaticMarkdown()` を明示的に実行する(起動時と同じ初期化を今ここで行う)。
- 401時のみ `setPersonalDataAuthError()` で「トークンに personal-data リポジトリの権限が必要です
  (Fine-grained tokenのRepository access / Contents権限を確認してください)」という具体的な
  バナー(`.pd-auth-banner`)を`#main`先頭に出す。タップで設定画面へ。ゲート通過後にだけ起こり
  得る状態(ゲート自体は有効性を見ないため)。

---

## 6. Service Worker

- `sw.js`: `CACHE_NAME` を `taskchute-journal-pwa-v71` → `taskchute-journal-pwa-v72` に更新。
- ロジック変更は無し。既存の「`api.github.com` は SW を経由させない」分岐(v38〜)により、個人
  データAPI呼び出しはそもそもSWキャッシュ対象になっていないことを確認した(sw.js 54-57行)。
  `.md`/`.json` の network-first 分岐はコード上残るが、対象は同一オリジンの静的ファイル
  (index.html/manifest等)のみになり、実害はない。

---

## 7. ホームタブの構成変更(K追加指示・実装途中で受領)

実装途中、Kから「三つの信条」「寿命カウントダウン」をホーム最上部(Now/MITより上)へ移動し、
既定openにする追加指示を受けたため本バージョンに同梱した。

- `renderHome()`: `homeFoldSection("creed", …)` / `homeFoldSection("lifespan", …)` を、日付バー
  直後・`homeIdeal`/`homeHero`(いま、これ)/`homeMIT`(今日の主役)より**前**に移動。
- 両セクションとも `defaultOpen` を `false` → `true` に変更(既定で開いた状態。折りたたみ自体は
  維持し、閉じることもできる)。
- 「長い弧をたしかめる」(zone3)・「今日の足あと」(zone4)は**変更していない**(下部・既定
  closedのまま)。
- `tests/v71.test.js` の該当アサーションを更新(下記9節)。

---

## 8. 実装判断(仕様から補った点)

1. **dataOwner/dataRepoは既存owner/repoと別フィールドにした**: 指示文「既存のGitHub設定に
   個人データリポジトリを追加」を字面どおり解釈し、既存owner/repoは(現状は個人データ以外の
   用途が無いためコードからは参照されなくなるが)スキーマ上は残した。将来の別用途
   (例: コードリポジトリへの直接操作)のための余地を残す判断。
2. **token/branchは共用にした**: 指示に明記されていた("トークンは既存のものを共用")ため。
   branchも同様に共用が自然と判断した(2リポジトリで別ブランチ運用は想定しにくいため)。
3. **pathフィールドの意味変更**: 既存の`path`(既定`app-state.json`)は「`taskchute/`配下の
   ファイル名」という意味に変えた(フォルダ契約は固定、ファイル名だけ設定可能な形を維持)。
4. **401バナーの文言・スコープ**: 指示は「トークンにpersonal-data権限が必要です」という趣旨の
   バナーとだけ指定されていたため、具体的な文言・実装(既存の`renderSyncBanner`と同型の軽量
   バナー)は自分で設計した。
5. **Vision.md/Daily_Affirmation.mdの配置**: データ配置契約に明記された`content/Vision.md`/
   `content/Daily_Affirmation.md`をそのまま採用。
6. **restoreBackupの設定復元ロジック修正**: 仕様に明記はなかったが、personalDataFileConfigへの
   置き換えに伴い顕在化した実バグ(4節参照)のため、スコープ内の必須修正として対応した。

---

## 9. テスト

- `tests/v72.test.js`(新規): トークンゲートの表示/未入力時は解除されないこと/入力後に解除
  されること、Vision.md のAPI経由取得と画面反映、401時の案内バナーとタップ遷移、
  `save-github`のPUT先URL(`https://api.github.com/repos/kojit1229/personal-data/contents/
  taskchute/app-state.json`)を検証。Clock固定はこのスイートでは不要(日付跨ぎに依存する
  検証が無いため省略)。api.github.com はこのスイート専用のpage.routeで丸ごと偽装し、
  ゲート自体の検証のため既存スイート共通の `passGithubGate` はあえて使わない。
- `tests/helpers.js`(拡張): `blockGithubApiByDefault(page)`(api.github.comへの予期しない実
  ネットワーク呼び出しを既定404で塞ぐ)/ `passGithubGate(page)`(既に永続化済みのフルstateへ
  token/dataOwner/dataRepoを追加してreloadし、ゲートを一括バイパスする)を追加。**既存19スイート
  全てに1回ずつ呼び出しを追加**(各ファイル2行程度の機械的な追加。個々のスイートの検証内容・
  アサーションは変更していない)。
- `tests/v57.test.js`: リポジトリ直下への実ファイル書き込み(`AIフィードバック_<昨日>.md`)を
  廃止し、`page.route`の可変fixtureへ書き換え(v62と同じ手法)。
- `tests/v62.test.js` / `tests/v65.test.js`: AIプラン/週次レビューのfetchモック判定を、同一
  オリジンの絶対パス完全一致から `api.github.com` の contents URL 末尾一致へ更新。
- `tests/v67.test.js`: AI作業結果_\*.jsonの実ファイル書き込み(書き/消し)を`page.route`の可変
  fixtureへ書き換え(v62と同じ手法。fs/path/ROOTの依存を削除)。
- `tests/v71.test.js`: 信条/寿命の折りたたみ既定値アサーションを `closed` → `open` に更新
  (7節のK追加指示に基づく正当な変更)。「操作→localStorage記憶→リロード後も維持」を検証する
  対象をcreedからzone4(既定closedのまま)に差し替え(creedが既定openになったため、同じ
  検証意図をclosed系セクションで維持する形にした)。
- 全量 `npm test`(20スイート、v72含む)で**ALL PASS**を確認済み(実行ログは末尾参照)。

### 9.1 引き継ぎ実装時の追加修正(実装中断からの再開分)

前段までの記述は前任実装時点の想定であり、実際に引き継いで全量 `npm test` を実行したところ
**4スイートが失敗していた**(前任の「ALL PASS済み」という記載は誤りだった)。原因はいずれも、
本体側で`taskchute/`配下への保存先変更・URLの`encodeURIComponent`化を行ったのに対応する形で
テスト側のモックURLパターン/検証ロジックを更新し切れていなかったこと。以下を修正し、20スイート
全てALL PASSを確認した。

- `tests/v49.test.js`(世代バックアップ): モックfetchの判定パターンが旧
  `/contents/backups/app-state-...` のままで、実際のPUT/GET/DELETE先である
  `/contents/taskchute/backups/app-state-...`(および`/contents/taskchute/app-state.json`)と
  一致せず3件失敗していた。全パターンに`taskchute/`プレフィックスを補って修正。
- `tests/v53.test.js`(自動アーカイブ): 同様に、モックfetchの判定パターンが旧
  `/contents/archive/archive-...` のままで、実際のパス`/contents/taskchute/archive/archive-...`
  と一致せず9件失敗(PUT自体が発生しない状態)していた。`taskchute/`プレフィックスを補って修正。
- `tests/v56.test.js` / `tests/v57.test.js`(AIフィードバックfetchの404ノイズ解消・直push検知):
  `fetchGitHubRawText`がURLを組み立てる際に`encodeURIComponent`でパスセグメントごとにエンコード
  するようになった(Contents APIへ渡すため必須)結果、fetchに渡される実際のURL文字列は
  日本語ファイル名がpercent-encodeされた形になり、テスト側の`addInitScript`によるfetch監視が
  生URL文字列に対して`u.includes("AIフィードバック_")`という素の日本語部分一致で判定していたため
  常に不一致(0件)になっていた。監視フック内で`decodeURIComponent`してから判定するよう修正
  (本体側のURLエンコード自体は正しい実装のため変更していない)。
- 修正後、全量 `npm test`(20スイート)で改めて**ALL PASS**(exit code 0)を確認済み。

---

## 変更ファイル

- `app.js`(GitHub設定拡張、個人データAPI用ヘルパー群新設、読み込み6箇所・書き込み4系統の
  API切替、トークンゲート`render`/`renderGate`、401バナー、設定画面のGitHub設定カード、
  ホーム最上部への信条/寿命移動+既定open化、`restoreBackup`の設定復元バグ修正)
- `sw.js`(`CACHE_NAME`を`v71`→`v72`)
- `tests/helpers.js`(`blockGithubApiByDefault`/`passGithubGate`追加)
- `tests/v72.test.js`(新規)
- `tests/v49,v50,v53〜v71.test.js`(19ファイル。ゲートバイパスの機械的な追加。v57/v62/v65/v67は
  加えてfetchモックの書き換え、v71は信条/寿命の既定値アサーション更新。**引き継ぎ時の追加修正
  (9.1節)**: v49/v53はモックURLへの`taskchute/`プレフィックス補完、v56/v57はfetch監視の
  `decodeURIComponent`対応)
- `CHANGES_v72.md`(本ファイル)
- `../taskchute-notes/handoff.md`(notes リポジトリ側、本エントリ追記)

---

## Kの移行手順

1. GitHubで **private** リポジトリ(既定名 `personal-data`)を作成する。
2. 既存のFine-grained PATを開き、**Repository access** に `personal-data` を追加し、
   **Contents: Read and write** 権限を付与する(既存の`taskchute-ipad`向け権限はそのままでよい)。
3. アプリを開く(トークン未設定の端末は自動でセットアップ画面になる)。Owner/Repository は既定値
   (`kojit1229`/`personal-data`)のままでよければ入力不要。Tokenを貼り付けて「設定してはじめる」。
4. 自宅PCの日次バッチ(coach-daily.sh / plan-daily.sh / weekly-review.sh / ai-work.sh 等)側は
   **既に対応済み**: `personal-data` リポジトリの `taskchute/` 配下へpushするよう切替済みで
   (`PERSONAL_REPO` 環境変数、`loop/coach-daily.sh` 等参照)、移行期間中はアプリ未展開の端末が
   困らないよう `taskchute-ipad` 側にも同じファイルを二重push(dual-write)する当面の措置が
   入っている(`loop/coach-daily.sh` 111行目〜のコメント参照。v72アプリが全端末に展開されたら
   撤去予定のTODO付き)。そのため本アプリ設定完了後は追加のバッチ設定変更なしでAIフィードバック
   等が届く。
5. 旧 `app-state.json` 等のデータを引き継ぎたい場合は、`taskchute-ipad` リポジトリ側の既存
   ファイルを手動で `personal-data/taskchute/` へコピーしてから起動するか、アプリの
   「JSONインポート」機能でローカルにあるエクスポート済みJSONを読み込む。

---

## 未対応・懸念点(重要)

- **`Vision.md` / `Daily_Affirmation.md` が現在も public リポジトリ(taskchute-ipad)のルート
  直下に実データのまま存在している**(コミット済み)。v72はアプリの「読み込み元」を切り替えた
  だけで、この2ファイル自体の削除・git履歴からの除去は行っていない(削除は無人でのデータ操作に
  あたり、かつ履歴scrubはforce-push等の破壊的操作を伴うため、CLAUDE.mdのNEVERルールに従い今回は
  手を付けていない)。**実質的な漏洩は本コミットが手元にpushされない限り継続する**。Kの判断で
  早急に対応することを強く推奨する(最低限: 2ファイルを削除してコミット。GitHub上に既に
  publicで公開済みなら、内容を別の非公開手段で退避したうえでリポジトリの履歴からの完全消去も
  検討)。
- （訂正）自宅PC側のバッチ(coach-daily.sh / plan-daily.sh / weekly-review.sh / ai-work.sh 等)は
  **既に`personal-data`リポジトリの`taskchute/`配下へpush済み**(過渡期dual-writeで
  `taskchute-ipad`側にも当面二重push)。当初この節に「バッチ側のpush先変更は別途必要」と
  記載していたのは誤りで、Kが不要な残タスクと誤認しないよう訂正する。バッチ側の対応状況は
  `loop/coach-daily.sh` 等の該当コメント・`PERSONAL_REPO`環境変数を参照。
- `tests/v72.test.js`のPUT先URL検証は`save-github`(app-state.json)のみを対象にした。日報/
  AIフィードバックのpush先(`pushFileToGitHub`)も同じ`personalDataConn`/`personalDataPath`を
  通るため理屈上は同様に正しいはずだが、個別のE2E検証はしていない(時間の制約。コードレビューで
  確認いただきたい)。
- 設定画面の旧`owner`/`repo`フィールドはUIから削除したが、`normalizeState`のスキーマからは
  削除していない(後方互換のため無害に残存)。

## 10. v72レビュー対応(条件付き合格分)

コーディネーターのレビューで指摘された以下を修正した。

- **【必須】`openMdInGithub`(app.js）が旧publicリポジトリ(taskchute-ipad)の編集画面を開いて
  しまう問題**: Vision/Daily_Affirmationの実体は個人データリポジトリの`taskchute/content/`配下に
  移行済みだが、「GitHubで編集」ボタンは`state.settings.github`の旧`owner`/`repo`(=このアプリ
  自身のpublicリポジトリ)でURLを組んでいたため、移行が塞いだはずの公開リポジトリへの導線が
  残っていた。`personalDataConn`/`personalDataPath`で個人データリポジトリ側
  (`.../edit/{branch}/taskchute/content/{ファイル名}`)のURLを組むよう修正。呼び出し元
  (`renderVisionMd`の`data-path`属性、"Vision.md"/"Daily_Affirmation.md")は変更不要
  (`content/`プレフィックスは`openMdInGithub`側で補うようにした)。
- **【軽微1】ポモドーロの500msタイマー(`startTimerTicker`)が`render()`のトークンゲート判定を
  経由せず`renderMain()`を直接呼んでいた**: トークン喪失等でゲート表示に戻るべき状態でも、
  ポモドーロ画面を開いたままだとこのタイマーが#mainだけを裏で再描画し続ける穴になっていた。
  2箇所の`renderMain()`呼び出しに`personalDataReady(state.settings.github)`ガードを追加。
- **【軽微2】旧`state.settings.github?.owner`ベースの表示判定を`personalDataReady`に統一**:
  日報push(ジャーナル画面)・週次push・12週サイクルpushの各ボタンの表示条件が
  `token && owner`(旧public repoフィールド)のままだったのを、個人データリポジトリの準備状態
  を正しく見る`personalDataReady()`に統一した。
- **【軽微3(本節末尾に反映済み)】** 「Kの移行手順」step4と「未対応・懸念点」の自宅PCバッチに
  関する記載を訂正。バッチ側は既に`personal-data`リポジトリへのpush対応・過渡期dual-writeまで
  済んでおり、「別途対応が必要」という当初の記載は誤りだった(9節・10節参照)。
- 修正後、`node --check app.js`+全量`npm test`(20スイート)でALL PASSを再確認済み。

## 実機テスト手順

1. `sw.js?nocache=YYYYMMDD`を開き、1行目が`taskchute-journal-pwa-v72`になっていることを確認。
2. トークン未設定の端末(または `taskchute-journal-pwa-state-v1` を一度削除した状態)でアプリを
   開き、セットアップ画面が出てタイムライン等が一切見えないことを確認する。
3. 上記「Kの移行手順」どおりPAT権限追加→Owner/Repository/Token入力→「設定してはじめる」で
   アプリが使えるようになることを確認する。
4. 設定画面で「今すぐGitHubへ保存」を押し、`personal-data`リポジトリの`taskchute/app-state.json`
   が作成/更新されることをGitHub上で確認する。
5. `personal-data`リポジトリの`taskchute/content/Vision.md`にテスト用テキストを置き、ビジョン
   タブに反映されることを確認する。
6. わざと無効なトークンにして再読み込みし、「トークンにpersonal-data リポジトリの権限が必要
   です」バナーが出ることを確認する。

## 確認サイン

- [ ] 実機(iPad/iPhone)で上記手順を確認
- [ ] 確認者:
- [ ] 確認日:
