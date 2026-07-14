# CHANGES v94

## 概要

K報告(2026-07-14)「個人リポジトリ設定の『保存先パス』に taskchute/ が混入して(例:
taskchute/app-state.json)、実リクエストが taskchute/taskchute/... の二重プレフィックスに
なりデータが読めなくなることがある」の根本原因調査と修正。

SW `CACHE_NAME` を v93 → v94 に更新。

---

## 混入経路の調査結果(全書き込み経路を洗い出し済み)

`settings.github.path`(および dataOwner/dataRepo)への代入箇所を全数確認した。

| 箇所 | 内容 | 評価 |
|---|---|---|
| app.js:937-941(修正前、normalizeState) | `path ||= "app-state.json"` の既定値補完のみ | 汚染源ではない |
| app.js:948-949(normalizeState) | dataOwner/dataRepo の既定値補完のみ | 汚染源ではない |
| app.js:696, 6307(設定画面 data-github-field) | ユーザーが手入力した生の値をそのまま `state.settings.github[key]` へ保存 | ユーザーが誤って `taskchute/app-state.json` と入力すれば汚染されうる(UI文言不足が誘因) |
| app.js:9599(旧行番号。syncFromGitHubOnStartup) | `state.settings.github = { ...cfg, token }` — `cfg` は関数冒頭で `state.settings.github` から**上書き前に**捕捉した生の設定 | **安全**(生の形状のまま) |
| app.js:9494(旧行番号。runAutoSyncPull) | 同上パターン。`cfg` は関数冒頭で捕捉した生の設定 | **安全** |
| app.js:10003(旧行番号。restoreBackup) | `next.settings.github = { ...next.settings.github, ...currentGithubSettings }` — `currentGithubSettings` は上書き前に捕捉した生の設定 | **安全**(v72で既に対策済み。9995-9998のコメントの通り) |
| **app.js:9570(旧行番号。loadFromGitHub、「GitHubから読込」ボタン)** | `state.settings.github = { ...config, token }` — `config` は `requireGitHubConfig()` の**変換済み**戻り値(`{owner, repo, branch, token, path}`。`personalDataFileConfig()` 経由で `path` に `taskchute/` が既に付与済み、かつキー名も `dataOwner/dataRepo` ではなく `owner/repo`) | **これが唯一のバグ**。手動「GitHubから読込」を押すたびに、dataOwner/dataRepo が失われ(次回起動のnormalizeStateの `||=` で既定値に戻るため実害が見えにくい)、path が `taskchute/` 付きのまま永続化される。次回以降 `personalDataPath()` がさらに `taskchute/` を付与し `taskchute/taskchute/...` の二重プレフィックスになる |

`loadFromGitHub()` 以外の2経路(`syncFromGitHubOnStartup`/`runAutoSyncPull`)と `restoreBackup()`
は、いずれも state を上書きする**前**に生の `state.settings.github` を変数へ退避してから使っており、
変換済み形状を書き戻すバグは無かった(現物確認による事実。v72コメントが「対策済み」と自認していた
箇所は実際に対策されていた)。`loadFromGitHub()` だけが、退避に `state.settings.github.token` の
1フィールドしか使っておらず、それ以外(owner/repo/path)を変換済み `config` から流用していたため
今回のバグが生じていた。

---

## 修正内容

### 1. 混入点そのものの修正(app.js、loadFromGitHub）

`requireGitHubConfig()` の変換済み `config` ではなく、上書き前に捕捉した生の
`state.settings.github`(rawSettings)を使うよう変更。

```js
// 修正前
const token = state.settings.github.token;
state = normalizeState(loaded);
state.settings.github = { ...config, token };

// 修正後
const rawSettings = state.settings.github;
state = normalizeState(loaded);
state.settings.github = { ...rawSettings };
```

### 2. 自己修復(normalizeState、本命)

`settings.github.path` 先頭の `taskchute/`(大文字小文字を問わず、`taskchute/taskchute/` の
多重付与も含む)を剥がす後方互換補完を追加。どの経路から汚染されても、次に state が
`normalizeState()` を通る(起動のたび)たびに自動修復される。同期で他端末へ伝播していた
汚染済みstateも、pull側の端末で読み込み次第そこで直る。

```js
value.settings.github.path ||= "app-state.json";
{
  let p = value.settings.github.path;
  while (/^taskchute\/+/i.test(p)) p = p.replace(/^taskchute\/+/i, "");
  value.settings.github.path = p || "app-state.json";
}
```

### 3. UI誤操作の予防

- 設定画面の保存先パス欄のラベル・placeholder・補足文に「taskchute/ は自動付与されるため
  入力不要」「含めないでください」を明記(app.js、`renderSettingsGitHubForm` 相当箇所)。
- 404エラーヒント文言(`gitHubErrorMessage`)に「保存先パスに taskchute/ を含めないでください」
  を追記。

---

## テスト: `tests/v94.test.js`(新設)

`node tests/v94.test.js` 実行前に、app.js/sw.js の修正を `git stash` で退避し**修正前のコードで
テストが落ちることを確認済み**(下記「検証結果」参照)。修正を戻すと全項目PASSに変わる。

- [1] path="taskchute/app-state.json"(単一混入)を持つstateをロード → normalizeStateが
  `app-state.json` へ修復し、保存リクエストが `taskchute/app-state.json` の単一プレフィックスになる
- [2] path="taskchute/taskchute/app-state.json"(二重混入)も同様に単一プレフィックスへ復旧。
  大文字小文字混在(`TaskChute/app-state.json`)の剥がしも確認
- [3] 正常値 `app-state.json` は不変(回帰なし)
- [4] 混入経路の再現: 「GitHubから読込」ボタンを押しても dataOwner/dataRepo が失われず、
  path も taskchute/ で汚染されない(loadFromGitHub修正の直接検証)。読込直後の保存でも
  PUT先が単一プレフィックスのままであることまで確認

---

## 検証結果

- `node --check app.js`: OK(exit 0)
- `node tests/v94.test.js`(修正前・`git stash` で app.js/sw.js を退避した状態): **[1][2][4] が
  ❌ で失敗**することを確認(二重/三重プレフィックスのPUTリクエスト、dataOwner/dataRepoの消失、
  設定画面への遷移不能まで再現)。`git stash pop` で修正を戻すと **ALL PASS** に変化することを確認
- `node tests/v94.test.js`(修正後): **ALL PASS**
- `npm run test:core`(コアセット。直近5バージョン: v90〜v94 + 固定コア5本: v72/v59/v67/v50/v70の
  計10本): **✅ All suites passed**(所要392.8秒)

---

## 未対応・懸念点

- 実機iOS Safari(iPad/iPhone)での実地確認はこのセッションでは行っていない(taskchute-ipad本体は
  commit/push禁止のため、Kの承認後の反映時に確認を推奨)。Playwright Chromiumでの検証のみ。
- 今回の自己修復は `settings.github.path` の `taskchute/` プレフィックス剥がしに限定している。
  `taskchute` という単語のみ(末尾スラッシュなし)が丸ごとpathに入っているような、より特殊な
  破損パターンは対象外(通常の誤操作・混入経路では発生しないため、今回のスコープでは見送り)。
- `owner`/`repo`(旧・同一オリジンfetch時代のレガシーフィールド)は現在も
  normalizeStateで既定値補完され続けている(v72で用途廃止済みだが未削除)。今回のバグとは
  無関係だが、テスト作成中に存在を確認した。削除は別対応が妥当(影響範囲の洗い出しが必要なため)。
