// v89 検証: taskchute-notes/ROADMAP.md「v93: ゼロ摩擦ルーティンチェック」を実番号v89として実装。
// ルーティン記録の「アプリを開いて押す」依存をなくすため:
//   ① まとめてワンタップ確定: ルーティンタブ/ホームの「ここまで全部やった」ボタンで、
//      現在時刻以前・未チェックのルーティンBlockだけを一括completed化する。
//   ② 個別解除: 一括ON後もチェックボックス(toggle-block)で1件ずつ元に戻せる(強制しない)。
//   ③ 時刻ベースの自動チェック提案バナー: 過ぎた未チェックルーティンがあるときだけホームに出る。
//      縮退モード(v73)の日は出さない(cond-degraded-bannerと排他)。
//   ④ 勝手にチェックされない: ボタンをタップするまでは何もcompletedにならない。
//   ⑤ normalizeStateの後方互換: 新フィールドを追加していないため、旧形状のstate
//      (declarations等の新しめのフィールドが無い最小限のstate)でも描画がクラッシュしないこと。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  // 現在時刻を10:00に固定した仮想「今日」を使う(過ぎた/来ていないルーティンを安定して作るため)。
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

  function planBlock({ id, title, startMin, minutes = 15, category = "ルーティン", completed = false, deleted = false } = {}) {
    return {
      id, taskId: "", date: TODAY, title, category,
      plannedStartAt: `${TODAY}T${hhmm(startMin)}`,
      plannedEndAt: `${TODAY}T${hhmm(startMin + minutes)}`,
      actualStartAt: completed ? `${TODAY}T${hhmm(startMin)}` : "",
      actualEndAt: completed ? `${TODAY}T${hhmm(startMin + minutes)}` : "",
      completed, charge: 0, discharge: 0, isMIT: false,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, interruptions: [],
      migratedTo: "", orderIndex: 0, carryCount: 0, leverageType: "", estimateMin: null,
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted
    };
  }

  async function seed({ blocks = [], view = "routine", morningEnergyLog } = {}) {
    await page.evaluate(({ KEY, blocks, TODAY, view, morningEnergyLog }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = [];
      s.questions = [];
      s.feedback = {};
      s.settings.morningEnergyLog = morningEnergyLog || {};
      s.settings.routineDayFilter = null;
      s.routineViewMode = "routine";
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, TODAY, view, morningEnergyLog });
    await page.reload();
    await page.waitForTimeout(500);
  }

  try {
    // v90: 実時刻依存フレーク対策 — now0(10:00)に時計を固定(v77と同じ流儀)。
    // これが無いと「plannedStartAt <= 現在時刻」の判定が実時計に依存し、10時前後以外の実行で3件落ちる。
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [①] ルーティンタブ: 「ここまで全部やった」で現在時刻(10:00)以前のみON
    // ============================================================
    console.log("[①] 一括チェックで現在時刻以前のルーティンのみcompletedになる(未来のものは変わらない)");
    await seed({
      view: "routine",
      blocks: [
        planBlock({ id: "rt-past1", title: "朝の白湯", startMin: 7 * 60 }),          // 07:00 過ぎている
        planBlock({ id: "rt-past2", title: "ストレッチ", startMin: 9 * 60 + 30 }),   // 09:30 過ぎている
        planBlock({ id: "rt-now", title: "境界ちょうど10:00", startMin: 10 * 60 }),  // 10:00 <= now(10:00) は対象
        planBlock({ id: "rt-future", title: "夜の日記", startMin: 21 * 60 }),        // 21:00 まだ先
        planBlock({ id: "rt-done", title: "すでに完了済み", startMin: 6 * 60, completed: true }), // 対象外(既完了)
        planBlock({ id: "flow-1", title: "ながれBlock", startMin: 8 * 60, category: "" }) // ルーティン以外は対象外
      ]
    });

    const bulkBtn = page.locator('[data-action="routine-bulk-check"]');
    check("一括確定ボタンが表示される(過ぎた未チェックが3件あるため)", await bulkBtn.count() >= 1);
    const btnText = await bulkBtn.first().textContent();
    check("ボタンに対象件数(3件)が出る", /3件/.test(btnText || ""), btnText);

    await bulkBtn.first().click();
    await page.waitForTimeout(300);

    const afterBulk = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const byId = Object.fromEntries(s.blocks.map((b) => [b.id, b]));
      return {
        past1: byId["rt-past1"].completed,
        past2: byId["rt-past2"].completed,
        nowBoundary: byId["rt-now"].completed,
        future: byId["rt-future"].completed,
        flowUntouched: byId["flow-1"].completed,
        nowActualEndAt: byId["rt-now"].actualEndAt
      };
    }, KEY);
    check("07:00のルーティンがONになる", afterBulk.past1 === true);
    check("09:30のルーティンがONになる", afterBulk.past2 === true);
    check("現在時刻ちょうど(10:00)の境界もONになる(<=now)", afterBulk.nowBoundary === true);
    check("21:00(未来)のルーティンはONにならない", afterBulk.future === false);
    check("ルーティン以外のBlockは一括チェックの対象にならない", afterBulk.flowUntouched === false);
    check("一括ONされたBlockはactualEndAtが補完される", !!afterBulk.nowActualEndAt);

    console.log("[①b] 一括チェック後は対象が無くなり、ボタン自体が消える(2度押しで何も壊れない)");
    check("一括確定ボタンが消える(過ぎた未チェックが0件になったため)", await page.locator('[data-action="routine-bulk-check"]').count() === 0);

    // ============================================================
    // [②] 個別解除: 一括ONしたルーティンをチェックボックスで1件だけ戻せる
    // ============================================================
    console.log("[②] 一括ON後も個別のチェックボックス(toggle-block)で1件だけ解除できる");
    await page.click('.routine-card[data-id="rt-past1"] [data-action="toggle-block"]');
    await page.waitForTimeout(300);
    const afterUndo = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const byId = Object.fromEntries(s.blocks.map((b) => [b.id, b]));
      return { past1: byId["rt-past1"].completed, past2: byId["rt-past2"].completed };
    }, KEY);
    check("個別解除した1件だけfalseに戻る", afterUndo.past1 === false);
    check("他の一括ON分はcompletedのまま(道連れで消えない)", afterUndo.past2 === true);
    console.log("[②b] 解除後は再び「過ぎた未チェック」扱いになり、一括確定ボタンが復活する");
    check("一括確定ボタンが1件分だけ復活する", (await page.locator('[data-action="routine-bulk-check"]').first().textContent() || "").includes("1件"));

    // ============================================================
    // [③] 提案バナー: 過ぎた未チェックあり/なし・縮退モードの表示条件
    // ============================================================
    console.log("[③-a] ホーム: 過ぎた未チェックルーティンがあればバナーが出る");
    await seed({
      view: "home",
      blocks: [planBlock({ id: "rt-b1", title: "朝の白湯", startMin: 7 * 60 })]
    });
    check("提案バナーが表示される", await page.locator(".routine-check-banner").count() === 1);
    const bannerText = await page.locator(".routine-check-banner").textContent();
    check("バナーに件数が出る(1件)", /1件/.test(bannerText || ""), bannerText);

    console.log("[③-b] タップでルーティンタブへ遷移する");
    await page.click(".routine-check-banner");
    await page.waitForTimeout(300);
    const viewAfterBannerTap = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView, KEY);
    check("ルーティンタブへ遷移する", viewAfterBannerTap === "routine", viewAfterBannerTap);

    console.log("[③-c] 過ぎた未チェックが無ければバナーは出ない(全部完了済み)");
    await seed({
      view: "home",
      blocks: [planBlock({ id: "rt-b2", title: "朝の白湯", startMin: 7 * 60, completed: true })]
    });
    check("バナーが出ない(未チェックのルーティンが無いため)", await page.locator(".routine-check-banner").count() === 0);

    console.log("[③-d] 縮退モード(v73)の日はバナーを出さない(cond-degraded-bannerと排他)");
    await seed({
      view: "home",
      blocks: [planBlock({ id: "rt-b3", title: "朝の白湯", startMin: 7 * 60 })],
      morningEnergyLog: { [TODAY]: 3 } // v73: CONDITION_DEGRADED_THRESHOLD=3以下で縮退モード
    });
    check("縮退バナーは出る(前提確認)", await page.locator(".cond-degraded-banner").count() === 1);
    check("縮退モードの日はルーティン提案バナーを出さない", await page.locator(".routine-check-banner").count() === 0);

    // ============================================================
    // [④] 勝手にチェックされない: ボタンを押すまでは何も変わらない
    // ============================================================
    console.log("[④] バナー表示・アプリを開いただけでは自動チェックされない(タップして初めて確定する)");
    await seed({
      view: "home",
      blocks: [planBlock({ id: "rt-auto1", title: "自動チェックされないか確認1", startMin: 7 * 60 }),
        planBlock({ id: "rt-auto2", title: "自動チェックされないか確認2", startMin: 8 * 60 })]
    });
    await page.waitForTimeout(500); // 描画・タイマー等が誤発火しないか少し待つ
    const autoCheckState = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.blocks.map((b) => b.completed);
    }, KEY);
    check("バナー表示だけでは何もcompletedにならない", autoCheckState.every((c) => c === false), JSON.stringify(autoCheckState));

    // ============================================================
    // [⑤] normalizeStateの後方互換: 新フィールドを追加していないため、
    //      最小限の旧形状state(未知の設定が欠けたもの)でもクラッシュしないこと
    // ============================================================
    console.log("[⑤] 最小限の旧state(このバージョンが参照する設定が欠けている)でも描画がクラッシュしない");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      // 意図的に古い最小形へ縮める: routineViewMode/routineDayFilter等のUI状態を消し、
      // plannedStartAtが空/未設定のルーティンBlockを混ぜる(overdueUncheckedRoutinesが
      // 例外を投げずにフィルタで弾けるか確認する)。
      delete s.routineViewMode;
      s.settings.morningEnergyLog = {};
      s.blocks = [
        { id: "legacy-1", taskId: "", date: TODAY, title: "旧データ(時刻未設定)", category: "ルーティン",
          plannedStartAt: "", plannedEndAt: "", actualStartAt: "", actualEndAt: "",
          completed: false, charge: 0, discharge: 0, isMIT: false, comment: "",
          recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
          carryCount: 0, leverageType: "", estimateMin: null,
          createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false }
      ];
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(500);
    check("旧形状stateでもpageerrorが出ずホームが描画される", await page.locator("#bottomNav").count() === 1);
    check("plannedStartAt未設定のルーティンは提案バナー・一括確定の対象から静かに除外される(バナー無し)",
      await page.locator(".routine-check-banner").count() === 0);

    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "routine";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(500);
    check("ルーティンタブも旧データでクラッシュせず描画される(一括確定ボタンも出ない)",
      await page.locator(".routine-stack, section.panel.muted").count() >= 1
      && await page.locator('[data-action="routine-bulk-check"]').count() === 0);

    console.log(failures === 0 ? "\n✅ v89 ALL PASS" : `\n❌ v89: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
