# v128 体力予算

## 背景

疲労を主観で気づく前に、朝の睡眠心拍データ(`state.sleep.logs`、AutoSleep CSV取込。
起床日キー、`sleepH` / `hrSleep` / `hrvSleep`)で先取りする。

## バージョン番号についての注記

依頼書は「HEAD=v119、機能1をv120として実装」を前提としていたが、着手時点でリポジトリの
HEADは既にv127(CACHE_NAME/CHANGES_v127.mdまで存在、CIグリーン)だった。v120/v121は
既に別件(睡眠CSV取込の修正・今週のやりたいこと機能)で使用済みのため、本機能は**v128**、
続く機能2(ポモドーロ身体スキャン)は**v129**として採番し直した。

## 変更点(app.js)

- `conditionBudget(date)`(決定論の算定関数)を新設。当日の`sleep.logs[date]`が無ければ
  `{level:"none", reason:""}`(データなし)。
- ベースラインは`conditionBudgetBaseline(date)`が、当日を含まない過去28日分
  (`CONDITION_BUDGET_BASELINE_LOOKBACK_DAYS`)の`hrSleep`/`hrvSleep`の中央値(`median()`)を
  それぞれ独立に算出する。サンプルが7日分未満(`CONDITION_BUDGET_BASELINE_MIN_SAMPLES`)なら
  そのベースラインは`null`とし、該当する心拍系の判定だけをスキップする(睡眠時間のみで判定)。
- 3段階判定(閾値はすべて定数化、初期値):
  - **赤字**: HRVがベースライン比`-15%`以下(`CONDITION_BUDGET_HRV_DEFICIT_PCT`) or
    HRがベースライン比`+5bpm`以上(`CONDITION_BUDGET_HR_DEFICIT_BPM`) or
    睡眠時間`<5.5h`(`CONDITION_BUDGET_SLEEP_DEFICIT_H`)
  - **低予算**: HRVが`-5%`以下(`CONDITION_BUDGET_HRV_LOW_PCT`) or HRが`+2bpm`以上
    (`CONDITION_BUDGET_HR_LOW_BPM`) or 睡眠時間`<6.5h`(`CONDITION_BUDGET_SLEEP_LOW_H`)
  - **通常**: それ以外
  - 根拠文字列(`reason`)は該当した条件を`「HRV -12%・睡眠5.2h」`のように`・`区切りで連結
    (複数該当時は全部載せる。1つも該当しなければ空文字)。
- ホーム(コックピット)の宣言カード直後に`homeConditionBudgetChip()`を追加。
  通常=緑/低予算=黄(オレンジ系)/赤字=赤+根拠短文、データなしは灰色「データなし」。
  睡眠カード(`renderSleepCard`)と同じく`state.selectedDate`の判定をそのまま出す
  (過去日を見ている時もその日の判定を表示する)。
- 日報`generateReport()`: `## 1. サマリ`内、`### 達成率`表の直後に
  `体力予算: 低予算(HRV -12%、睡眠5.2h)`のような1行を、当日ログがある日のみ出力する
  (データなし日は行ごと省略)。

## 変更点(loop側)

- `loop/scripts/daily-report-fallback.py`: `condition_budget()`をapp.jsの`conditionBudget()`と
  完全に同じ式・同じ定数値で実装し、同じ位置(サマリ表の直後)に同じ行を出力する。
- `loop/FORMAT_CONTRACT.md`: 突合表の`## 1. サマリ`行の備考へ体力予算行の追加を明記。
- `loop/coach/daily-review.md`: 「観点」に7点目を追加。体力予算が低予算・赤字の日は、
  提案を負荷削減方向に切り替え、夜の開発の終業時刻前倒しと保護ルーティン優先を提案する。
  通常日は言及不要。

## 検証手順

1. `node --check app.js` / `node --check sw.js`
2. `node tests/run-all.js v128`
3. `node tests/run-core.js`(直近5件+固定横断コア5本、回帰確認)
4. `PYTHONUTF8=1 python loop/scripts/daily-report-fallback.py <date> <合成app-state.json> <出力.md>`
   で体力予算行がapp.js側と同じ書式・同じ判定になることを手動確認。
