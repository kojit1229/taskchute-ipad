// v111 検証: ポモドーロ開始時のiOSガイド付きアクセス案内。
// K要望: iPad/iPhoneでポモドーロ中の脱線防止にガイド付きアクセス(画面ロック)を使いたいが、
// PWAからの自動設定はiOSの制約上不可能(調査済み)。代替として、ポモドーロ開始時に手動操作
// (サイドボタン/ホームボタン トリプルクリック)を案内する非ブロッキングのポップアップを出す。
//
// (a) iOS(iPhone UA)でポモドーロ開始(=startPomodoro呼び出し)→ 案内ポップアップが出る。
//     ポップアップ表示中もタイマーは既に走っている(開始をブロックしない)。
// (b) 「今後表示しない」にチェックして閉じる → settings.pomoGuidedAccessHintがfalseになり、
//     次回の開始では出ない。
// 非iOS非表示・iPadOS判定・設定OFF時の回帰確認・チェック無し閉じは次コミット以降で追加する。
//
// 起動経路はstartPomodoro()という単一の合流点(通常のBlock開始時のfocusTimerAuto自動起動、
// 宣言モーダル経由のポモドーロ開始、休憩中「同じBlockで続ける」のいずれも最終的にここを通る)
// でフックしているため、本スイートは最も単純な経路(focusTimerAuto自動起動)で代表させる。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPADOS_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

  function planBlock({ id, title, startMin, minutes = 30 }) {
    return {
      id, taskId: "", date: TODAY, title, category: "",
      plannedStartAt: `${TODAY}T${hhmm(startMin)}`,
      plannedEndAt: `${TODAY}T${hhmm(startMin + minutes)}`,
      actualStartAt: "", actualEndAt: "",
      completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "",
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }

  // iOS/iPadOS判定・タッチエミュレーションのため、新しいcontextごとに用意する。
  async function newPage({ userAgent, touch = false } = {}) {
    const ctx = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 390, height: 844 },
      userAgent
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
    if (touch) {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5, configurable: true });
      });
    }
    await blockGithubApiByDefault(page);
    return { ctx, page };
  }

  async function seed(page, { blocks = [], pomoGuidedAccessHint } = {}) {
    await page.evaluate(({ KEY, blocks, TODAY, pomoGuidedAccessHint }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = []; s.projects = [];
      s.selectedDate = TODAY;
      s.currentView = "timeline";
      s.settings = s.settings || {};
      s.settings.focusTimerAuto = true;
      if (typeof pomoGuidedAccessHint === "boolean") s.settings.pomoGuidedAccessHint = pomoGuidedAccessHint;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, TODAY, pomoGuidedAccessHint });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function stateNow(page) {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  // now-start は宣言モーダル(kind="block")を経由するため、スキップして進める
  // (v70スイートと同じ流儀)。
  async function startBlockSkippingDeclare(page, blockId) {
    await page.click(`.timeline-card [data-action="now-start"][data-id="${blockId}"]`);
    await page.waitForTimeout(150);
    const declareSkip = page.locator('[data-action="declare-skip"]');
    if (await declareSkip.count() > 0) await declareSkip.click();
  }

  try {
    // ============================================================
    // (a) iPhone UA でポモドーロ開始 → 案内ポップアップが出る(タイマーはブロックしない)
    // ============================================================
    console.log("[1] iPhone UA: focusTimerAuto経由でポモドーロ開始 → ガイド付きアクセス案内が出る");
    {
      const { ctx, page } = await newPage({ userAgent: IPHONE_UA });
      await page.clock.setFixedTime(now0);
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForTimeout(500);
      await passGithubGate(page);
      await seed(page, { blocks: [planBlock({ id: "b1", title: "iPhone検証Block", startMin: 9 * 60 })] });

      await startBlockSkippingDeclare(page, "b1");
      await page.waitForTimeout(300);

      const s1 = await stateNow(page);
      check("ポモドーロは開始済み(running:true)", s1.pomodoro?.running === true, JSON.stringify(s1.pomodoro));
      check("開始したBlockに紐づく", s1.pomodoro?.blockId === "b1");

      const modalText = await page.locator(".modal-root").textContent();
      check("案内モーダルが表示される", modalText.includes("ガイド付きアクセス"), modalText);
      check("サイドボタン操作の案内文が含まれる", modalText.includes("サイドボタン"), modalText);
      check("「今後表示しない」チェックボックスがある", await page.locator("[data-guided-access-suppress]").count() === 1);
      check("モーダル表示中もタイマーは動いたまま(非ブロッキング)", (await stateNow(page)).pomodoro?.running === true);

      await ctx.close();
    }

    // ============================================================
    // (b) 「今後表示しない」→ 設定に永続化され、次回は出ない
    // ============================================================
    console.log("[2] 「今後表示しない」にチェックして閉じる → 次回のポモドーロ開始では出ない");
    {
      const { ctx, page } = await newPage({ userAgent: IPHONE_UA });
      await page.clock.setFixedTime(now0);
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForTimeout(500);
      await passGithubGate(page);
      await seed(page, {
        blocks: [
          planBlock({ id: "b2a", title: "1回目Block", startMin: 9 * 60 }),
          planBlock({ id: "b2b", title: "2回目Block", startMin: 10 * 60 })
        ]
      });

      await startBlockSkippingDeclare(page, "b2a");
      await page.waitForTimeout(300);
      check("1回目は案内モーダルが出る", (await page.locator(".modal-root").textContent()).includes("ガイド付きアクセス"));

      await page.check("[data-guided-access-suppress]");
      await page.click('[data-action="guided-access-dismiss"]:has-text("閉じる")');
      await page.waitForTimeout(200);

      const sAfterDismiss = await stateNow(page);
      check("設定pomoGuidedAccessHintがfalseになる", sAfterDismiss.settings.pomoGuidedAccessHint === false, JSON.stringify(sAfterDismiss.settings.pomoGuidedAccessHint));
      check("モーダルは閉じている", await page.locator(".modal-root.open").count() === 0);

      // 1回目のタイマーを直接リセットしてから、別のBlockでポモドーロを再度開始する
      // (中断UIの経路検証はv70スイートの担当範囲のため、ここでは設定の永続化だけを見る)
      await page.evaluate((KEY) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.pomodoro = { tab: "manual", passive: s.pomodoro?.passive, fullscreen: false, studyWithMeOn: false,
          running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
        localStorage.setItem(KEY, JSON.stringify(s));
      }, KEY);
      await page.reload();
      await page.waitForTimeout(400);
      await startBlockSkippingDeclare(page, "b2b");
      await page.waitForTimeout(300);
      const s2b = await stateNow(page);
      check("2回目のポモドーロは正常に開始する(running:true)", s2b.pomodoro?.running === true, JSON.stringify(s2b.pomodoro));
      check("2回目は案内モーダルが出ない", await page.locator(".modal-root.open").count() === 0);

      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures ? `\n❌ v111: ${failures} 件失敗` : "\n✅ v111: 全件成功");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
