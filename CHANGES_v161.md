# v161 AI機能第5弾(最終)「エネルギーカーブ」

K発注仕様(workbench/out/2026-07-27-taskchute-ai5/spec.md 機能5、AI機能5件シリーズの最終弾)。
実績ログから時間帯別の集中度・実行量を**バッチ側で決定論集計**し、1日のエネルギーカーブを
アプリで可視化する。「いつやるか」の最適化に振り切り、タスクの中身には踏み込まない。AIによる
「この時間帯にこのタスク種別を置くとよい」提案は既存のAIプラン経路(`loop/plan-daily.sh`)に
載せる。バッチ側実装は ClaudeCode ワークスペース側(`loop/scripts/energy-curve.sh` /
`loop/scripts/energy-curve-build.py`)。本ファイルはアプリ側(taskchute-ipad)の変更点を中心に、
バッチ側実証ログも参考として記録する。

**2026-07-28追記**: Codex+Claudeの2系統レビュー後、監督者裁定により5点の必須修正・6点の推奨
修正を反映した(下記「レビュー対応」節参照)。本節以降は初回実装+レビュー対応後の最終仕様を記す。

## アーキテクチャ

既存のAI連携パターン(バッチ→personal-data→アプリfetch、ai-linked-app-dev Skill)を踏襲。
**集計・分析ロジックは一切アプリに持たせない**(K発注仕様「集計はバッチ側、アプリに分析ロジックを
足さない」)。アプリは `personal-data/taskchute/energy-curve.json`(単一の上書きファイル、
日付を含まないファイル名)をfetchし、届いた値をそのまま棒グラフとして描画するだけ。

## 変更内容(app.js)

1. `cachedEnergyCurveJson`(`{ fetchedAt: number(ms epoch), data: {generatedAt,days,hourly} |
   undefined }`)を新設。**日付キーではなくTTL(取得時刻)キャッシュ**にしている点が
   today-enemy/勝手に格言と異なる(レビュー対応・必須修正4。energy-curve.jsonは日付を含まない
   単一の上書きファイルのため、日付キー方式だと同日中の再pushを拾えない事故があった)。
2. `hydrateStaticMarkdown()` に `energy-curve.json` のfetchを追加(今日の敵/勝手に格言/未来からの
   手紙と並列fetch)。取得判定は `Date.now() - cachedEnergyCurveJson.fetchedAt >=
   FEEDBACK_REFRESH_INTERVAL_MS(30分)` で、既存のAIフィードバック等の定期再fetch機構
   (visibilitychange復帰時 / 30分毎ティック → `maybeRefreshFeedback()`)にそのまま乗る。
   JSON.parse失敗・オブジェクトでない・`hourly`が24件でない・各要素が
   `{hour,count,netAvg,startRate}` の期待形状でない場合はすべてフェイルソフトで
   `cachedEnergyCurveJson.data = undefined`(セクション非表示)にする。バッチ側の壊れ・
   仕様変更でもアプリは落ちない。
3. `renderEnergyCurveCard()` を新設。計器盤(統計)の**詳細層**(v148の2層構造)に
   「エネルギーカーブ(時間帯別)」節として追加(`detailBody`末尾。専用クラス`.energy-curve-*`
   でDOM/CSSを新設し、既存`.stats-hist`系とは分離した — レビュー対応・推奨修正9)。
   - 棒の高さ = 実行数(`count`、24時間中の最大値を100%として正規化)
   - 棒の色 = 充放電net(`netAvg`)の符号。正=緑(`--green`)、負=赤(`--red`)、
     0または3件未満は無色(レビュー対応・推奨修正6/8)
   - 着手率(`startRate`)は**バー下の可視テキスト**として表示(title属性のツールチップのみに
     頼らない。iOS実機ではtitleが読めないため — レビュー対応・必須修正5)
   - `count=0`の時間帯は棒自体を描画しない(空表示)
   - **`hourly`全24件が`count=0`(実データ無し)の場合は節ごと非表示**(スキーマは正常でも
     空チャートを出さない — レビュー対応・必須修正3)
4. ファイルが無い/取得前/スキーマ不正/全時間帯0件の場合はセクションごと非表示(既存の静かな
   計器の方針)。ホーム画面への新規導線は追加しない(計器盤の既存「詳細を見る」に相乗りするのみ。
   ラベル文言にも「エネルギーカーブ」を追記済み — レビュー対応・推奨修正11)。
5. `hydrateStaticMarkdown()` 末尾の再描画対象view一覧に `"stats"` を追加(計器盤を開いたまま
   新着fetchが完了しても節が反映されるように)。

## SWキャッシュ

`sw.js` の `CACHE_NAME` を `v160` → `v161` へ更新。

## テスト

`tests/v161.test.js`(12観点)。観点:
1. energy-curve.jsonが取得できる(スキーマ正常)場合、計器盤の詳細details内に節が表示され、
   24時間分のセルが描画される
2. count>=3かつnetAvgが正の時間帯は緑(pos)クラス、負の時間帯は赤(neg)クラスが付く
3. netAvg/startRateがnull(3件未満)の時間帯は色クラスが付かない
4. count=0の時間帯は棒(.energy-curve-fill)自体が描画されない
5. 着手率がバー下に可視テキストとして表示される(title頼みにしない)
6. ファイルが無い(404)場合は節ごと非表示
7. 壊れたJSON(パース不能)の場合は節ごと非表示
8. hourlyが24件でない(スキーマ不正)場合は節ごと非表示
9. hourly全24件がcount=0(実データ無し)の場合は節ごと非表示
10. 公開Pages側(同一オリジン)へのenergy-curve.jsonのfetchは一切発生しない(同一オリジン
    fetch回帰の防止、v157〜v160.test.jsと同じ観点)
11. api.github.com の taskchute/energy-curve.json へ実際にリクエストが飛んでいる(裏取り)
12. **初回取得から30分以上経過後、visibilitychange復帰でバッチの新着カーブが再取得され表示に
    反映される**(TTLキャッシュにした効果の直接検証。日付キー方式だった旧実装ではこの観点は
    テストできなかった)

既存テストへの影響は無い想定(新規セクションの追加のみで、既存DOM構造・既存アクションは無変更。
`renderEnergyCurveCard()`が空文字を返す既存シナリオでは`detailBody`の末尾に空文字列が
連結されるだけ)。

## バッチ側の実証(参考、ClaudeCodeワークスペース側)

### `loop/scripts/energy-curve.sh` + `loop/scripts/energy-curve-build.py`(決定論、claude不使用)

`personal-data/taskchute/app-state.json` の直近28日固定・0〜23時全24枠の完了Block実績から、
{実行数,充放電net,着手率}を集計する。集計定義は既存app.js(taskchute-ipad)の同種集計を
**参考にしつつ、本バッチ専用の切り口(固定24時間軸・固定28日窓)で定義した別切り口**であり、
値の完全一致は期待しない(レビュー対応・推奨修正7。「既存と同じ」という初期実装時の記述は
不正確だったため訂正した。相違点の詳細はビルドスクリプト冒頭コメント/FORMAT_CONTRACT.md参照):
- 実行数/充放電net: 「時間帯別の活動量」ヒストグラム(renderStats)と同じ`actualStartAt`の
  時〈hour〉で束ねる着眼点は踏襲するが、期間は可変(4週/12週/全期間)ではなく固定28日、対象は
  05〜23時ではなく0〜23時全24枠、かつ`completed`を条件に加えている点が既存と異なる
- 着手率: `computeHeatmapCells`(時間帯×曜日ヒートマップ)と**同じ**`plannedStartAt`基準の
  「計画Blockのうち実際に着手した割合」定義(こちらは相違点なし)
- いずれも3件未満はnull(K発注仕様「過剰解釈防止」)
- **`--date`でtoday以外を指定してpersonal-dataへ書き込む場合は`--force`が必須**(単一の
  上書きファイルを誤ったバックフィルで上書きする事故を防ぐ確認ガード。レビュー対応・推奨修正10)

単体実行で冪等性を実証済み(1回目=生成・push成功、2回目=`generatedAt`の日付一致によりスキップ)。
`--force`ガードの両分岐(--date+--forceなし=die、--date+--dry-run=guardをスキップして配線確認)
も実証済み。

### AIプラン経路への接続: `loop/plan-daily.sh` / `loop/plan/daily-plan.md`

`AIプラン_YYYY-MM-DD.json`の出力契約・`plan-daily-extract.py`の抽出契約は**無変更**。
`energy-curve.json`が存在し、かつ**鮮度ガードを通過すれば**プロンプト入力へ「時間帯別
エネルギーカーブ」節として1つ追加する(存在しない/鮮度ガード不通過なら「(なし)」で無視)。

**鮮度ガード(レビュー対応・必須修正2)**: `energy-curve.sh`は2026-07-28時点でスケジューラ
未登録(単体実行のみ)のため、単一の上書きファイルである`energy-curve.json`が更新されないまま
何日も居座りうる。`plan-daily.sh`の`energy_curve_is_fresh()`が`generatedAt`の日付部分と実行日の
差分を計算し、3日超過(環境変数`ENERGY_CURVE_FRESH_DAYS`で上書き可)、または未来日付、または
`generatedAt`が読めない/不正な場合は「(なし)」として扱う。純粋なローカル判定(git pull不要)の
ため`--dry-run`でも鮮度OK/鮮度切れの両分岐をログで確認できる。

**方針記述の矛盾解消(レビュー対応・必須修正1)**: 初回実装の`daily-plan.md`追記は「実データ上
21時が最多実行・net正だから重要タスクを21時に置く」のような判断を誘発しうる書き方で、既存
方針1の2ルール(午前優先/21時以降に重いタスク禁止)と正面衝突する余地があった。追記を
「エネルギーカーブは既存2ルールを上書きしない。同ルールの範囲内での微調整にのみ使う」と
明記し、あわせて「`startRate`の母数にはルーティンの未着手が含まれるため、低い値を『調子が
悪い』と解釈しない」という注意も追記した(energy-curve-build.py側のコメントにも同旨を追記)。

## 契約(FORMAT_CONTRACT.md)

`energy-curve.json`のスキーマ・冪等判定・鮮度ガード・AIプラン経路への接続方法を
`loop/FORMAT_CONTRACT.md`の「energy-curve.jsonの契約(2026-07-28新設・v161)」に明記した。
