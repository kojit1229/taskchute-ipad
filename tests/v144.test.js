// v144 検証: エネルギーバッテリーモデル(computeBatteryLevel + ホーム電池チップ + タイムライン
// 実カーブ重ね描き)。design-proposal.md §3(P3)+ 2026-07-27 2系統レビュー(Codex+Claude)の
// 監督者裁定への対応。CHANGES_v144.md参照。
//
// app.js は type="module" のため内部関数を window に露出しない(既存方針)。本テストは
// page.clock.setFixedTime で時刻を固定し、localStorageへの状態注入 + 画面表示(ホーム電池
// チップのテキスト・タイムラインSVGのpolyline)で挙動を間接検証する(既存スイートと同じ流儀)。
//
// レビュー裁定による集計セマンティクス:
// - チップ(現在残量): 当日の完了Block全部を時刻フィルタなしで合算(既存エネルギー実線と整合)
// - カーブ(当日の軌跡): actualEndAtの日付部分がdateKeyと異なれば[0,1440]にクランプした位置。
//   充放電イベントは斜め補間でなく垂直な段差(直前/直後の2点)で描く
// - 電池チップは当日限定(過去日・未来日は非表示)
//
// (1) 07:00より前は減衰しない
// (2) 減衰3時間(-9)
// (3) 完了Blockの充放電が時刻フィルタなしで反映される(未来時刻のactualEndAtでも当日合計に入る)
// (4) クランプ0 (5) クランプ上限 (6) 開始値3種+データ無し(none→normal)
// (7) 過去日ではチップが非表示、今日へ戻すと再表示
// (8) toggle-block(Block完了導線)での即時再描画(reload無し)
// (9) タイムライン重ね描き: 当日のみ・日またぎイベントの[0,1440]クランプ・垂直段差
// (10) ティッカー(startTimerTicker経由)による自動更新(reload無し、時間経過だけで表示が変わる)
// (11) 設定画面: start.*ドット分岐の境界クランプ(0〜200)・decayPerHour(0以上)・max(1以上)・
//      decayStartMinutesのtype="time"入力
// (12) normalizeStateマイグレーション: 個別プロパティ比較(新規補完/旧decayStartHourからの
//      分単位移行/既存値の再クランプ)
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, openSettingsGroup } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const TODAY = "2026-07-27";
const YDAY = "2026-07-26";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  // localStorageのsleep.logs/blocksを丸ごと差し替えてreloadする共通ヘルパー。
  async function seed({ sleepLog, blocks }) {
    await page.evaluate(({ KEY, TODAY, sleepLog, blocks }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.sleep = s.sleep || { logs: {} };
      s.sleep.logs = {};
      if (sleepLog) s.sleep.logs[TODAY] = sleepLog;
      s.condition = s.condition || { logs: {} };
      s.condition.logs = {};
      s.blocks = blocks || [];
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY, sleepLog, blocks });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function batteryChipText() {
    const loc = page.locator(".home-battery-chip");
    if ((await loc.count()) === 0) return null;
    return (await loc.textContent()).trim();
  }

  // "x1,y1 x2,y2 ..." 形式のSVG points属性をパースし、[{x,y}]の配列にする。
  function parsePoints(pointsAttr) {
    return pointsAttr.trim().split(/\s+/).map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    });
  }

  // 同じy(=同じ時刻)で異なるxを持つ点が2つ以上あれば「垂直な段差(瞬時のジャンプ)」が
  // 描かれている証拠とみなす。
  function countJumpGroups(points) {
    const byY = new Map();
    for (const p of points) {
      const key = Math.round(p.y * 100);
      if (!byY.has(key)) byY.set(key, new Set());
      byY.get(key).add(Math.round(p.x * 100));
    }
    return [...byY.values()].filter((xs) => xs.size >= 2).length;
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (1) 07:00より前は減衰しない(開始値のまま)。睡眠ログ無し→level:none→normal(50)。
    // ============================================================
    console.log("[1] 07:00より前は減衰しない(開始値のまま)");
    await page.clock.setFixedTime(new Date(2026, 6, 27, 6, 0, 0, 0));
    await seed({ sleepLog: null, blocks: [] });
    check("電池チップに残量50(開始値のまま、睡眠データ無し=normal扱い)",
      (await batteryChipText())?.includes("残量 50"), await batteryChipText());

    // ============================================================
    // (2) 07:00から3時間後、減衰3/hなら-9 → 50-9=41
    // ============================================================
    console.log("[2] 減衰途中(10:00、07:00から3時間・3/h)");
    await page.clock.setFixedTime(new Date(2026, 6, 27, 10, 0, 0, 0));
    await seed({ sleepLog: null, blocks: [] });
    check("電池チップに残量41(50-9)", (await batteryChipText())?.includes("残量 41"), await batteryChipText());

    // ============================================================
    // (3) 完了Blockの充放電は時刻フィルタなしで反映される(レビュー裁定: チップは当日丸ごと合算)。
    //     actualEndAtが「今」より未来でも当日合計に入ることを確認する(旧実装との違いの核心)。
    // ============================================================
    console.log("[3] 完了Blockの充放電が時刻フィルタなしで反映される(未来時刻のactualEndAtでも合算)");
    await seed({
      sleepLog: null,
      blocks: [{
        id: "b-future", date: TODAY, title: "夜に完了登録したBlock", category: "休息",
        plannedStartAt: `${TODAY}T22:30`, plannedEndAt: `${TODAY}T23:00`,
        actualStartAt: `${TODAY}T22:30`, actualEndAt: `${TODAY}T23:00`,  // now(10:00)より未来
        completed: true, charge: 5, discharge: 1, estimateMin: 0, deleted: false
      }]
    });
    check("電池チップに残量45(41+net4、actualEndAtが未来でも合算される)",
      (await batteryChipText())?.includes("残量 45"), await batteryChipText());

    // ============================================================
    // (4) クランプ0: 体力予算「赤字」(睡眠5.0h→deficit、開始値30)+ 23:00(16時間分の減衰=48)
    // ============================================================
    console.log("[4] クランプ0(赤字開始値30、16時間分の減衰48で本来-18)");
    await page.clock.setFixedTime(new Date(2026, 6, 27, 23, 0, 0, 0));
    await seed({ sleepLog: { bed: "23:00", wake: "05:00", sleepH: 5.0 }, blocks: [] });
    check("電池チップに残量0(マイナスにならずクランプ)", (await batteryChipText())?.includes("残量 0"), await batteryChipText());

    // ============================================================
    // (5) クランプ上限: 07:00ちょうど(減衰0)+ charge20の完了Block → 50+20=70だが上限50でクランプ
    // ============================================================
    console.log("[5] クランプ上限(50+20=70のはずが上限50でクランプ)");
    await page.clock.setFixedTime(new Date(2026, 6, 27, 7, 0, 0, 0));
    await seed({
      sleepLog: null,
      blocks: [{
        id: "b-big", date: TODAY, title: "大充電ブロック", category: "休息",
        plannedStartAt: `${TODAY}T06:00`, plannedEndAt: `${TODAY}T06:30`,
        actualStartAt: `${TODAY}T06:00`, actualEndAt: `${TODAY}T06:00`,
        completed: true, charge: 20, discharge: 0, estimateMin: 0, deleted: false
      }]
    });
    check("電池チップに残量50(上限クランプ、70にならない)", (await batteryChipText())?.includes("残量 50"), await batteryChipText());

    // ============================================================
    // (6) 開始値3種の切替(07:00ちょうど・Block無し): deficit=30 / low=40 / normal=50 / none=50
    // ============================================================
    console.log("[6] 開始値3種の切替(体力予算 deficit/low/normal + 睡眠データ無し)");
    await seed({ sleepLog: { bed: "23:00", wake: "05:00", sleepH: 5.0 }, blocks: [] });  // <5.5h → deficit
    check("睡眠5.0h(赤字)→開始値30", (await batteryChipText())?.includes("残量 30"), await batteryChipText());

    await seed({ sleepLog: { bed: "23:00", wake: "06:00", sleepH: 6.0 }, blocks: [] });  // 5.5-6.5h → low
    check("睡眠6.0h(低予算)→開始値40", (await batteryChipText())?.includes("残量 40"), await batteryChipText());

    await seed({ sleepLog: { bed: "23:00", wake: "07:00", sleepH: 8.0 }, blocks: [] });  // >=6.5h → normal
    check("睡眠8.0h(通常)→開始値50", (await batteryChipText())?.includes("残量 50"), await batteryChipText());

    await seed({ sleepLog: null, blocks: [] });  // ログ無し → none → normal扱い
    check("睡眠ログ無し(データなし)→normal扱いで開始値50", (await batteryChipText())?.includes("残量 50"), await batteryChipText());

    // ============================================================
    // (7) 過去日ではチップが非表示(レビュー裁定: 既定パラメタでは過去日が構造的に残量0になり
    //     「裁かない」思想に反するため当日限定)。今日へ戻すと再表示される。
    // ============================================================
    console.log("[7] 過去日ではチップが非表示、今日へ戻すと再表示");
    check("当日は電池チップが表示される(前提確認)", (await batteryChipText()) !== null);
    await page.click('[data-action="date-prev"]');
    await page.waitForTimeout(300);
    check("過去日では電池チップが非表示になる", await page.locator(".home-battery-chip").count() === 0);
    await page.click('[data-action="today"]');
    await page.waitForTimeout(300);
    check("今日へ戻すと電池チップが再表示される", await page.locator(".home-battery-chip").count() === 1);
    check("再表示後の値は変わらない(残量50)", (await batteryChipText())?.includes("残量 50"), await batteryChipText());

    // ============================================================
    // (8) Block完了導線(toggle-block)での即時再描画(reload無し)。
    //     「今日の主役」(homeMIT、既定で折りたたまれていない)の完了チェックを使う。
    // ============================================================
    console.log("[8] toggle-blockで電池チップが即座に再描画される(reload無し)");
    await page.clock.setFixedTime(new Date(2026, 6, 27, 10, 0, 0, 0));  // 07:00から3h、減衰9
    await seed({
      sleepLog: null,  // normal(50)
      blocks: [{
        id: "b-mit", date: TODAY, title: "今日の主役ブロック", category: "作業", isMIT: true,
        plannedStartAt: `${TODAY}T08:00`, plannedEndAt: `${TODAY}T08:30`,
        actualStartAt: `${TODAY}T08:00`, actualEndAt: `${TODAY}T08:30`,
        completed: true, charge: 5, discharge: 1, estimateMin: 0, deleted: false
      }]
    });
    check("編集前: 電池チップに残量45(50-9+net4)", (await batteryChipText())?.includes("残量 45"), await batteryChipText());
    await page.click('.home-box[data-action="toggle-block"][data-id="b-mit"]');
    await page.waitForTimeout(200);
    check("toggle-block後: reload無しで電池チップが残量41(50-9、completed解除でnet分が抜ける)に再描画される",
      (await batteryChipText())?.includes("残量 41"), await batteryChipText());

    // ============================================================
    // (9) タイムライン重ね描き: 当日のみ・日またぎイベントの[0,1440]クランプ・垂直段差
    // ============================================================
    console.log("[9a] タイムライン重ね描き(当日のみ)");
    await seed({
      sleepLog: null,
      blocks: [{
        id: "b-mit", date: TODAY, title: "今日の主役ブロック", category: "作業", isMIT: true,
        plannedStartAt: `${TODAY}T08:00`, plannedEndAt: `${TODAY}T08:30`,
        actualStartAt: `${TODAY}T08:00`, actualEndAt: `${TODAY}T08:30`,
        completed: true, charge: 5, discharge: 1, estimateMin: 0, deleted: false
      }]
    });
    await page.click('[data-action="nav"][data-view="timeline"]');
    await page.waitForTimeout(400);
    // v148(UI改善計画Phase3-5)以降、エネルギー/バッテリーは同じSVGへの重ね描きをやめ切替式に
    // なった(既定"energy")。battery-curveを見るテストなので「バッテリー」へ切り替える
    // (state.settings.timelineEnergyGraphModeとしてlocalStorageへ保存されるため、以降の
    // seed()/reloadでも維持され、本ファイル内で再度切り替える必要はない)。
    await page.click('[data-action="tl-energy-mode"][data-mode="battery"]');
    await page.waitForTimeout(200);
    check("当日はbattery-curveのpolylineが1本出る", await page.locator(".battery-curve").count() === 1);

    await page.click('[data-action="nav"][data-view="home"]');
    await page.waitForTimeout(300);
    await page.click('[data-action="date-prev"]');
    await page.waitForTimeout(300);
    await page.click('[data-action="nav"][data-view="timeline"]');
    await page.waitForTimeout(400);
    check("当日以外の日付ではbattery-curveが出ない", await page.locator(".battery-curve").count() === 0);
    await page.click('[data-action="nav"][data-view="home"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="today"]');
    await page.waitForTimeout(300);

    console.log("[9b] 日またぎイベントの[0,1440]クランプ+充放電イベントの垂直段差");
    await page.clock.setFixedTime(new Date(2026, 6, 27, 12, 0, 0, 0));  // 12:00
    await seed({
      sleepLog: null,
      blocks: [
        {
          id: "b-today", date: TODAY, title: "当日中に完了", category: "作業",
          plannedStartAt: `${TODAY}T09:30`, plannedEndAt: `${TODAY}T10:00`,
          actualStartAt: `${TODAY}T09:30`, actualEndAt: `${TODAY}T10:00`,
          completed: true, charge: 5, discharge: 1, estimateMin: 0, deleted: false
        },
        {
          id: "b-overnight", date: TODAY, title: "日またぎ実績(前日深夜に完了登録)", category: "作業",
          plannedStartAt: `${TODAY}T00:00`, plannedEndAt: `${TODAY}T00:30`,
          actualStartAt: `${YDAY}T23:30`, actualEndAt: `${YDAY}T23:50`,  // dateKey(TODAY)より前の日付
          completed: true, charge: 0, discharge: 3, estimateMin: 0, deleted: false
        }
      ]
    });
    // チップでは時刻フィルタなしで両方合算される: 50-15(decay 3h)+4-3=36
    check("チップ: 日またぎBlockも時刻フィルタなしで合算される(残量36)",
      (await batteryChipText())?.includes("残量 36"), await batteryChipText());

    await page.click('[data-action="nav"][data-view="timeline"]');
    await page.waitForTimeout(400);
    const pointsAttr = await page.locator(".battery-curve").getAttribute("points");
    const pts = parsePoints(pointsAttr);
    check("battery-curveに2件以上の垂直段差(同時刻で異なる残量の点)が存在する"
      + "(当日中の充放電イベント+日またぎイベントの[0,1440]クランプ分)",
      countJumpGroups(pts) >= 2, JSON.stringify(pts));
    check("battery-curve-labelの最終値がチップと同じ残量36になる",
      (await page.locator(".battery-curve-label").textContent()).includes("36"));

    // ============================================================
    // (10) ティッカー(startTimerTicker経由)による自動更新。reload・クリック無しで、
    //      固定時刻を進めるだけで電池チップの表示が変わることを確認する。
    // ============================================================
    console.log("[10] ティッカーによる自動更新(reload無し)");
    await page.click('[data-action="nav"][data-view="home"]');
    await page.waitForTimeout(200);
    await page.clock.setFixedTime(new Date(2026, 6, 27, 10, 0, 0, 0));  // 10:00固定
    await seed({ sleepLog: null, blocks: [] });
    await page.waitForTimeout(700);  // 500ms周期のティッカーを最低1回は通す(_lastBatteryTickAtの基準を作る)
    check("ティッカー開始時点: 電池チップに残量41(50-9)", (await batteryChipText())?.includes("残量 41"), await batteryChipText());
    await page.clock.setFixedTime(new Date(2026, 6, 27, 11, 0, 0, 0));  // 60分進める(reload・クリックなし)
    await page.waitForTimeout(800);  // 500ms周期のティッカーが新しい固定時刻を検知するのを待つ
    check("60分経過後: reload・クリック無しでも電池チップが残量38(50-12)に自動更新される",
      (await batteryChipText())?.includes("残量 38"), await batteryChipText());

    // ============================================================
    // (11) 設定画面: start.*ドット分岐の境界クランプ(0〜200)・decayPerHour(0以上)・
    //      max(1以上)・decayStartMinutesのtype="time"入力
    // ============================================================
    console.log("[11] 設定画面の境界検証(M3/M4)とdecayStartMinutesのtime入力");
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(300);
    // v148(UI改善計画Phase3-2)以降、エネルギーバッテリー欄は「日々の使い方」群のdetails内にあり
    // 既定closed。fill対象を可視化するため<summary>を実クリックして開く。
    // v169追記: 各fillのchangeイベントが保存→再描画を誘発し、遅い環境(CI)では次のfillまでに
    // detailsが既定closedへ戻って対象欄が不可視になりTimeoutする(CI run 30369862292/30373680847で
    // v144が同一箇所=start.lowのfillで2回失敗、ローカルでは再描画完了前にfillが通るため再現せず)。
    // openSettingsGroupは冪等(開いていれば何もしない)なので、各fill前に開き直す。検証内容は無変更。
    await openSettingsGroup(page, "settings-daily");

    check("減衰開始時刻の入力欄がtype=\"time\"になっている(iOS規約)",
      await page.locator('[data-setting-battery-field="decayStartMinutes"]').getAttribute("type") === "time");

    await page.fill('[data-setting-battery-field="start.deficit"]', "500");
    await page.locator('[data-setting-battery-field="start.deficit"]').dispatchEvent("change");
    await page.waitForTimeout(150);
    let st = await stateNow();
    check("start.deficit=500は0〜200にクランプされ200になる", st.settings.battery.start.deficit === 200, String(st.settings.battery.start.deficit));

    await openSettingsGroup(page, "settings-daily");
    await page.fill('[data-setting-battery-field="start.low"]', "-50");
    await page.locator('[data-setting-battery-field="start.low"]').dispatchEvent("change");
    await page.waitForTimeout(150);
    st = await stateNow();
    check("start.low=-50は0〜200にクランプされ0になる", st.settings.battery.start.low === 0, String(st.settings.battery.start.low));

    await openSettingsGroup(page, "settings-daily");
    await page.fill('[data-setting-battery-field="start.normal"]', "45");
    await page.locator('[data-setting-battery-field="start.normal"]').dispatchEvent("change");
    await page.waitForTimeout(150);
    st = await stateNow();
    check("start.normal=45は範囲内なのでそのまま45になる", st.settings.battery.start.normal === 45, String(st.settings.battery.start.normal));

    await openSettingsGroup(page, "settings-daily");
    await page.fill('[data-setting-battery-field="decayPerHour"]', "-2");
    await page.locator('[data-setting-battery-field="decayPerHour"]').dispatchEvent("change");
    await page.waitForTimeout(150);
    st = await stateNow();
    check("decayPerHour=-2は0以上にクランプされ0になる", st.settings.battery.decayPerHour === 0, String(st.settings.battery.decayPerHour));

    await openSettingsGroup(page, "settings-daily");
    await page.fill('[data-setting-battery-field="max"]', "0");
    await page.locator('[data-setting-battery-field="max"]').dispatchEvent("change");
    await page.waitForTimeout(150);
    st = await stateNow();
    check("max=0は1以上にクランプされ1になる", st.settings.battery.max === 1, String(st.settings.battery.max));

    await openSettingsGroup(page, "settings-daily");
    await page.fill('[data-setting-battery-field="max"]', "50");
    await page.locator('[data-setting-battery-field="max"]').dispatchEvent("change");
    await page.waitForTimeout(150);
    st = await stateNow();
    check("max=50は範囲内なのでそのまま50になる(正常系も回帰なし)", st.settings.battery.max === 50, String(st.settings.battery.max));

    await openSettingsGroup(page, "settings-daily");
    await page.fill('[data-setting-battery-field="decayStartMinutes"]', "09:15");
    await page.locator('[data-setting-battery-field="decayStartMinutes"]').dispatchEvent("change");
    await page.waitForTimeout(150);
    st = await stateNow();
    check("decayStartMinutesがtime入力09:15から555分に変換されて保存される",
      st.settings.battery.decayStartMinutes === 555, String(st.settings.battery.decayStartMinutes));

    // ============================================================
    // (12) normalizeStateマイグレーション(個別プロパティ比較。JSON.stringifyのキー順依存を廃止)
    // ============================================================
    console.log("[12a] battery設定を持たない旧stateに既定値が補完される");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.settings.battery;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(500);
    // v67テストと同じ手法: navをクリックし、normalizeStateが補完した値をlocalStorageへ永続化させる
    await page.click('[data-action="nav"][data-view="home"]');
    await page.waitForTimeout(200);
    let stMig = await stateNow();
    const b1 = stMig.settings.battery;
    check("start.deficit=30が補完される", b1.start.deficit === 30, String(b1.start.deficit));
    check("start.low=40が補完される", b1.start.low === 40, String(b1.start.low));
    check("start.normal=50が補完される", b1.start.normal === 50, String(b1.start.normal));
    check("decayPerHour=3が補完される", b1.decayPerHour === 3, String(b1.decayPerHour));
    check("decayStartMinutes=420(07:00)が補完される", b1.decayStartMinutes === 420, String(b1.decayStartMinutes));
    check("max=50が補完される", b1.max === 50, String(b1.max));
    check("旧decayStartHourキーは残らない", !("decayStartHour" in b1));

    console.log("[12b] 旧decayStartHour(時単位)からdecayStartMinutes(分単位)への移行");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.battery = { decayStartHour: 9 };  // 旧形式(分単位フィールドが無い)
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('[data-action="nav"][data-view="home"]');
    await page.waitForTimeout(200);
    stMig = await stateNow();
    const b2 = stMig.settings.battery;
    check("decayStartHour:9 → decayStartMinutes:540(9*60)に移行される", b2.decayStartMinutes === 540, String(b2.decayStartMinutes));
    check("移行後はdecayStartHourキーを持たない", !("decayStartHour" in b2));

    console.log("[12c] 既存値の再クランプ(同期データ等で異常値が混入していても補正される)");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.battery = {
        start: { deficit: 999, low: -20, normal: 9999 },
        decayPerHour: -5,
        decayStartMinutes: 99999,
        max: -3
      };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('[data-action="nav"][data-view="home"]');
    await page.waitForTimeout(200);
    stMig = await stateNow();
    const b3 = stMig.settings.battery;
    check("start.deficit=999は200にクランプされる", b3.start.deficit === 200, String(b3.start.deficit));
    check("start.low=-20は0にクランプされる", b3.start.low === 0, String(b3.start.low));
    check("start.normal=9999は200にクランプされる", b3.start.normal === 200, String(b3.start.normal));
    check("decayPerHour=-5は0にクランプされる", b3.decayPerHour === 0, String(b3.decayPerHour));
    check("decayStartMinutes=99999は範囲外なので既定420に戻る", b3.decayStartMinutes === 420, String(b3.decayStartMinutes));
    check("max=-3は1にクランプされる", b3.max === 1, String(b3.max));

    console.log(failures === 0 ? "\n✅ v144 ALL PASS" : `\n❌ v144: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }

  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
