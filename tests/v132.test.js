// v132 検証: Codexレビュー指摘[med]対応。身体スキャンモーダルの背景タップが
// closeModal()直呼びで_pendingBodyScanCtxを破棄するだけで、closeBodyScanFlow()
// (v117過集中ゲート判定を呼ぶ)を経由しない不具合の修正。
//
// (a) ステップ1(疲労選択)表示中の背景タップ → discard扱いでゲートが開く(bodyScansは0件のまま)
// (b) ステップ2(部位選択)表示中の背景タップも同様
// (c) 回帰: 明示ボタン(body-scan-discard/body-scan-part)経路の挙動は不変
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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  function isoOffset(n) {
    const d = new Date(now0);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const TODAY = isoOffset(0);
  const YEST = isoOffset(-1);
  const hhmm = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

  function makeRule({ id, title, time }) {
    return {
      id, title, category: "ルーティン", taskId: "", kind: "daily", startTime: time, endTime: "",
      anchorDate: YEST, expectedCharge: "", expectedDischarge: "", source: "", exceptionDates: [],
      protection: true, fallbackTitle: "", fallbackMinutes: null, anchor: "",
      createdAt: `${YEST}T00:00`, updatedAt: `${YEST}T00:00`, deleted: false
    };
  }
  function makeRoutineBlock({ id, ruleId, title, time }) {
    return {
      id, taskId: "", date: TODAY, title, category: "ルーティン",
      plannedStartAt: `${TODAY}T${time}`, plannedEndAt: `${TODAY}T${time}`,
      actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
      expectedCharge: "", expectedDischarge: "", comment: "", recurrenceGroupId: ruleId,
      pomodoroCount: 0, migratedTo: "", carryCount: 0, orderIndex: 0, isMIT: false, source: "",
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }
  function makeBlock({ id, title, startMin }) {
    return {
      id, taskId: "", date: TODAY, title, category: "",
      plannedStartAt: `${TODAY}T${hhmm(startMin)}`, plannedEndAt: `${TODAY}T${hhmm(startMin + 30)}`,
      actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
      carryCount: 0, isMIT: false, source: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
      deleted: false
    };
  }

  async function seed({ blocks = [], recurrences = [], bodyScans = [], view = "pomodoro", pomodoro = null } = {}) {
    await page.evaluate(({ KEY, blocks, recurrences, bodyScans, TODAY, view, pomodoro }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.recurrences = recurrences;
      s.bodyScans = bodyScans;
      s.selectedDate = TODAY;
      s.currentView = view;
      if (pomodoro) s.pomodoro = { ...(s.pomodoro || {}), ...pomodoro };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, recurrences, bodyScans, TODAY, view, pomodoro });
    await page.reload();
    await page.waitForTimeout(400);
  }
  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }
  async function completeActivePomodoro() {
    await page.click('[data-action="complete-pomodoro"]');
    await page.waitForTimeout(200);
    if (await page.locator('[data-action="report-skip"]').count() > 0) {
      await page.click('[data-action="report-skip"]');
      await page.waitForTimeout(300);
    }
  }
  const runningPomodoro = (blockId) => ({
    tab: "manual", fullscreen: false, running: true, blockId,
    startedAt: `${TODAY}T09:50:00`, endsAt: `${TODAY}T10:25:00`, mode: "focus"
  });
  // 背景(modalRoot自身)へのクリック。position:fixedで画面全体を覆うため、モーダルカードの
  // 外側の座標を狙う(左上隅付近)。
  const clickModalBackground = () => page.locator("#modalRoot").click({ position: { x: 5, y: 5 } });

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    const rule = makeRule({ id: "rule-1", title: "白湯を飲む", time: "06:30" });
    const routineBlock = makeRoutineBlock({ id: "blk-routine", ruleId: "rule-1", title: "白湯を飲む", time: "06:30" });

    // ============================================================
    // (a) ステップ1(疲労選択)での背景タップ
    // ============================================================
    console.log("[1] ステップ1(疲労選択)表示中に背景タップ → discard扱いでゲートが開く");
    await seed({
      blocks: [routineBlock, makeBlock({ id: "blk-1", title: "対象1", startMin: 9 * 60 + 50 })],
      recurrences: [rule], bodyScans: [], pomodoro: runningPomodoro("blk-1")
    });
    await completeActivePomodoro();
    check("(準備)身体スキャンモーダル(疲労)が開く", await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).count() === 1);
    await clickModalBackground();
    await page.waitForTimeout(300);
    check("身体スキャンモーダルが閉じる", await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).count() === 0);
    check("背景タップを閉じた後に過集中ゲートモーダルが開く(修正前は飛ばされていた)",
      await page.locator(".modal-title", { hasText: "保護ルーティンが残っています" }).count() === 1);
    const s1 = await stateNow();
    check("bodyScansには記録されない(discard扱い)", (s1.bodyScans || []).length === 0, JSON.stringify(s1.bodyScans));
    await page.click('[data-action="hyperfocus-gate-later"]');
    await page.waitForTimeout(200);

    // ============================================================
    // (b) ステップ2(部位選択)での背景タップ
    // ============================================================
    console.log("[2] ステップ2(部位選択)表示中に背景タップ → discard扱いでゲートが開く(疲労選択済みでも記録されない)");
    await seed({
      blocks: [routineBlock, makeBlock({ id: "blk-2", title: "対象2", startMin: 10 * 60 })],
      recurrences: [rule], bodyScans: [], pomodoro: runningPomodoro("blk-2")
    });
    await completeActivePomodoro();
    await page.click('[data-action="body-scan-fatigue"][data-value="3"]');
    await page.waitForTimeout(150);
    check("(準備)部位選択モーダルへ遷移する", await page.locator(".modal-title", { hasText: "どこが疲れていますか" }).count() === 1);
    await clickModalBackground();
    await page.waitForTimeout(300);
    check("身体スキャンモーダルが閉じる", await page.locator(".modal-title", { hasText: "どこが疲れていますか" }).count() === 0);
    check("背景タップを閉じた後に過集中ゲートモーダルが開く",
      await page.locator(".modal-title", { hasText: "保護ルーティンが残っています" }).count() === 1);
    const s2 = await stateNow();
    check("疲労を選んでいてもbodyScansには記録されない(discard扱い)", (s2.bodyScans || []).length === 0, JSON.stringify(s2.bodyScans));
    await page.click('[data-action="hyperfocus-gate-later"]');
    await page.waitForTimeout(200);

    // ============================================================
    // (c) 回帰: 明示ボタン経路の挙動は不変(保存経路がゲートを飛ばしていないか)
    // ============================================================
    console.log("[3] 回帰: 明示ボタンで記録した場合も、閉じた後にゲートが開く(従来どおり)");
    await seed({
      blocks: [routineBlock, makeBlock({ id: "blk-3", title: "対象3", startMin: 11 * 60 })],
      recurrences: [rule], bodyScans: [], pomodoro: runningPomodoro("blk-3")
    });
    await completeActivePomodoro();
    await page.click('[data-action="body-scan-fatigue"][data-value="4"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="body-scan-part"][data-part="肩"]');
    await page.waitForTimeout(300);
    check("bodyScansに1件記録される(明示ボタン経路は不変)",
      (await stateNow()).bodyScans.length === 1);
    check("記録後もゲートモーダルが開く(従来どおり)",
      await page.locator(".modal-title", { hasText: "保護ルーティンが残っています" }).count() === 1);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
