# CHANGES v104

## 概要

K指示(2026-07-15)「0秒思考の入力時間(書き始め→保存の所要秒数)を自動計測してエントリに
保存し、朝の書き出しmd(iPhone Obsidian閲覧用)に参考情報として載せる」への対応。

SW `CACHE_NAME` を v103 → v104 に更新。

## 変更内容

### アプリ側(app.js)

- `ztWriteStartedAt`(モジュールレベル変数)を新設。書く画面(`openZtWrite`)を開いた時刻を
  `Date.now()` で記録する。
- `saveZtEntry()` で保存時に `Date.now() - ztWriteStartedAt` の差分秒数(四捨五入・0未満は0に
  クランプ)を `entries[].durationSec` として保存する。60秒カウントダウン
  (`ztTimerLeft`/`ztTimerInterval`)の残数ではなく実経過時間を使うため、カウントダウンを超えて
  書き続けたケースでも正しく記録される。`Date.now()` の差分計算のみで文字列パースを伴わない
  ため、iOS Safariの `new Date("文字列")` 9時間ズレ問題には抵触しない。
- `ztWriteStartedAt` は書く画面を抜ける全経路(`discardZtWrite` / `saveZtEntry` /
  `setView`(zero画面から離脱時))でnullへリセットする。書く画面に入っていない状態で保存が
  起きることは無いが、リセット漏れによる古い開始時刻の誤流用を防ぐための防御。
- 追記編集(v102の `renderZtEdit`/`saveZtEdit`)は `{ ...e, body, updatedAt: nowDateTime() }` の
  スプレッドで既存フィールドを保持するため、`durationSec` には触れない(初回書き出し時の
  所要時間を維持する仕様どおり)。
- `normalizeState()` に `durationSec` 欠損時のnull補完を追加(既存entryの後方互換)。

### loop側(zero-thinking-export.py)

- `format_duration(duration_sec)` を新設。`durationSec` が数値(bool・負値は除外)のときだけ
  「(入力時間: X分Y秒)」または「(入力時間: Y秒)」の参考行を返す。
- `format_entry()` で、見出し(`## HH:MM:SS 質問文`)の直下・本文の前に上記参考行を挿入する。
  `durationSec` が無い(null・キー欠損)entryは従来どおり見出し+本文のみで、参考行は出ない。
  見出し行の形式(`## HH:MM:SS 質問文`)自体は変更していない。

## 機械パース消費者への影響(FORMAT_CONTRACT.md未変更の理由)

`loop/FORMAT_CONTRACT.md` を確認したところ、`insight-ledger.py` の
`extract_zero_thinking_candidates()` が「見出し行から次の同形式見出しまたはEOFまでを
回答本文として抽出する」実装になっており、見出し直下に挿入した「(入力時間: ...)」参考行も
その抽出範囲(＝類似度判定に使う `body`/`match_text`)に含まれる。

- 見出し行の正規表現(`^## (\d{2}:\d{2}:\d{2}) (.+)$`)自体は変更していないため、抽出対象の
  検出そのものは壊れない。
- 挿入した参考行は全entryでほぼ同一パターンの文字列(「(入力時間: N分N秒)」)になるため、
  `insight-ledger.py` のキーワード類似度計算(文書頻度ベースの重み付け、`weighted_dice`)では
  「全文書に均等に出現する語」として自動的に低く重み付けされ、類似度判定への実質的な影響は
  小さいと判断した。
- ただし `loop/FORMAT_CONTRACT.md` と `loop/scripts/insight-ledger.py` は本タスク着手時点
  (2026-07-15 22:00台)で**別セッションが検証中**(dry-run中)だったため、今回はこの2ファイルに
  一切手を加えていない。「本文に参考行が混ざる」という事実は影響が小さいと判断した上での
  意図的な見送りであり、insight-ledger.py側で参考行を除外する必要があるかどうかはKの判断を
  仰ぐ別対応とする。

## テスト

`tests/v104.test.js`(新規、4シナリオ):

1. 書く画面を開いて保存すると `durationSec`(実経過秒数、0以上)が記録される
2. 60秒カウントダウンを超えて書き続けても(`page.clock` で75秒後に固定)、実経過(約75秒)が
   `durationSec` に入る(カウントダウンの残数ではない)
3. 回答済みentryを追記編集(v102)して保存しても `durationSec` は変わらない
4. normalizeState後方互換: `durationSec` 欠損の旧entryはnullで補完され壊れない

`node --check app.js` / `node --check sw.js` / `node --check tests/v104.test.js` すべて exit 0。
`npm run test:core`(v104を含む直近5本 + 固定コア5本、計10本)ALL PASS。

`loop/scripts/zero-thinking-export.py`: durationSecあり(分:秒/秒のみ両パターン)・null・
キー欠損の混在ダミーentriesで実走し、あり分のみ「(入力時間: ...)」が出力され、null/キー欠損分は
従来どおり見出し+本文のみになることを確認。`python -m py_compile` OK。

`bash loop/guardrails/verify.sh` exit 0(workspaceルート、bash構文チェック等41件)。

## 残る懸念・未対応

- `loop/FORMAT_CONTRACT.md` / `loop/scripts/insight-ledger.py` は今回意図的に未変更(上記
  「機械パース消費者への影響」参照)。参考行を気づき候補の類似度判定対象から除外すべきかは
  次サイクルでKの判断を仰ぐ。
- `repos/taskchute-notes/review.md` の2026-07-14全体レビュー(未対応 `- [ ]` 多数)は本対応の
  スコープ外(K指示は0秒思考の入力時間計測のみ)のため着手していない。
