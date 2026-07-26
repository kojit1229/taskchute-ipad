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
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

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
