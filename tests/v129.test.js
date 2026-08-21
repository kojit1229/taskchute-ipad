// v129 検証: ポモドーロ身体スキャン(完了時に疲労1-5+任意部位を2タップで記録)。
// K承認済み案件(2026-07-18)。
//
// (a) ポモドーロ完了直後に身体スキャンモーダル(ステップ1: 疲労)が開く
// (b) 疲労選択→部位選択(ステップ2)へ遷移し、部位タップでstate.bodyScansに記録・モーダルが閉じる
// (c) 「スキップして記録」ではpart=""で記録される
// (d) 「記録せず閉じる」ではどのステップからでもbodyScansに何も追加されない
// (e) 身体スキャンを閉じた後(保存/スキップ/discardいずれも)に過集中ゲートが判定される(順序契約)
// (f) 日報生成: 当日分のbodyScansがあれば`### 身体スキャン`表が出る/0件の日は節ごと省略
// (g) normalizeStateの後方互換: bodyScansフィールドが無い旧stateでも起動できる
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
  now0.setHours(10, 0, 0, 0);  // 実行時刻依存のフレーク回避(v117等と同じ方針)
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

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a)(b) 身体スキャンモーダルが開き、疲労→部位の2タップで記録される
    // ============================================================
    console.log("[1] ポモドーロ完了直後に身体スキャンモーダル(疲労)が開く");
    await seed({ blocks: [makeBlock({ id: "blk-1", title: "対象1", startMin: 9 * 60 + 50 })], pomodoro: runningPomodoro("blk-1") });
    await completeActivePomodoro();
    check("身体スキャンモーダル(疲労)が開く", await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).count() === 1);
    check("1〜5のボタンが5個出る", await page.locator('[data-action="body-scan-fatigue"]').count() === 5);

    console.log("[2] 疲労4をタップ→部位選択(ステップ2)へ遷移。部位タップで記録・モーダルが閉じる");
    await page.click('[data-action="body-scan-fatigue"][data-value="4"]');
    await page.waitForTimeout(150);
    check("部位選択モーダルへ遷移する", await page.locator(".modal-title", { hasText: "どこが疲れていますか" }).count() === 1);
    check("部位ボタンが4個(目/肩/胃/頭)出る", await page.locator('[data-action="body-scan-part"]:not([data-part=""])').count() === 4);
    await page.click('[data-action="body-scan-part"][data-part="肩"]');
    await page.waitForTimeout(300);
    check("モーダルが閉じる", await page.locator(".modal-title", { hasText: "どこが疲れていますか" }).count() === 0);
    const s2 = await stateNow();
    check("bodyScansに1件記録される", (s2.bodyScans || []).length === 1, JSON.stringify(s2.bodyScans));
    const scan1 = (s2.bodyScans || [])[0];
    check("fatigue=4が記録される", scan1?.fatigue === 4, JSON.stringify(scan1));
    check("part=肩が記録される", scan1?.part === "肩", JSON.stringify(scan1));
    check("pomodoroBlockIdが記録される", scan1?.pomodoroBlockId === "blk-1", JSON.stringify(scan1));
    check("idとdateTimeが記録される", !!scan1?.id && !!scan1?.dateTime, JSON.stringify(scan1));

    // ============================================================
    // (c) 「スキップして記録」ではpart=""で記録される
    // ============================================================
    console.log("[3] 部位選択で「スキップして記録」を押すとpart=\"\"で記録される");
    await seed({ blocks: [makeBlock({ id: "blk-2", title: "対象2", startMin: 11 * 60 })], bodyScans: [], pomodoro: runningPomodoro("blk-2") });
    await completeActivePomodoro();
    await page.click('[data-action="body-scan-fatigue"][data-value="2"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="body-scan-part"][data-part=""]');
    await page.waitForTimeout(300);
    const s3 = await stateNow();
    check("bodyScansに1件、part=\"\"で記録される",
      (s3.bodyScans || []).length === 1 && s3.bodyScans[0].part === "" && s3.bodyScans[0].fatigue === 2,
      JSON.stringify(s3.bodyScans));

    // ============================================================
    // (d) 「記録せず閉じる」ではどのステップからでも記録されない
    // ============================================================
    console.log("[4] ステップ1で「記録せず閉じる」→bodyScansに追加されない");
    await seed({ blocks: [makeBlock({ id: "blk-3", title: "対象3", startMin: 12 * 60 })], bodyScans: [], pomodoro: runningPomodoro("blk-3") });
    await completeActivePomodoro();
    await page.click('[data-action="body-scan-discard"]');
    await page.waitForTimeout(300);
    const s4 = await stateNow();
    check("bodyScansは0件のまま", (s4.bodyScans || []).length === 0, JSON.stringify(s4.bodyScans));

    console.log("[5] ステップ2(部位選択中)で×閉じ→疲労を選んでいてもbodyScansに追加されない");
    await seed({ blocks: [makeBlock({ id: "blk-4", title: "対象4", startMin: 13 * 60 })], bodyScans: [], pomodoro: runningPomodoro("blk-4") });
    await completeActivePomodoro();
    await page.click('[data-action="body-scan-fatigue"][data-value="5"]');
    await page.waitForTimeout(150);
    await page.click('.modal-close[data-action="body-scan-discard"]');
    await page.waitForTimeout(300);
    const s5 = await stateNow();
    check("疲労を選んでいてもdiscardならbodyScansに追加されない", (s5.bodyScans || []).length === 0, JSON.stringify(s5.bodyScans));

    // ============================================================
    // (e) 身体スキャンを閉じた後に過集中ゲートが判定される(順序契約)
    // ============================================================
    console.log("[6] 身体スキャンを記録して閉じた後、保護系ルーティン未実行があればゲートが開く");
    const rule = makeRule({ id: "rule-1", title: "白湯を飲む", time: "06:30" });
    const routineBlock = makeRoutineBlock({ id: "blk-routine", ruleId: "rule-1", title: "白湯を飲む", time: "06:30" });
    await seed({
      blocks: [routineBlock, makeBlock({ id: "blk-5", title: "対象5", startMin: 14 * 60 })],
      recurrences: [rule], bodyScans: [], pomodoro: runningPomodoro("blk-5")
    });
    await completeActivePomodoro();
    check("(準備)身体スキャンモーダルが開く", await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).count() === 1);
    await page.click('[data-action="body-scan-fatigue"][data-value="1"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="body-scan-part"][data-part=""]');
    await page.waitForTimeout(300);
    check("身体スキャンを閉じた後に過集中ゲートモーダルが開く",
      await page.locator(".modal-title", { hasText: "保護ルーティンが残っています" }).count() === 1);
    await page.click('[data-action="hyperfocus-gate-later"]');
    await page.waitForTimeout(200);

    // ============================================================
    // (f) 日報生成
    // ============================================================
    console.log("[7] 日報生成: 当日分のbodyScansがあれば`### 身体スキャン`表が出る");
    const scans = [
      { id: "bs-a", dateTime: `${TODAY}T10:30:00`, fatigue: 4, part: "肩", pomodoroBlockId: "blk-x" },
      { id: "bs-b", dateTime: `${TODAY}T09:15:00`, fatigue: 2, part: "", pomodoroBlockId: "blk-y" },
      { id: "bs-other-day", dateTime: `${YEST}T10:00:00`, fatigue: 5, part: "頭", pomodoroBlockId: "blk-z" }
    ];
    await seed({ blocks: [], bodyScans: scans, view: "journal" });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(400);
    const reportText1 = await page.evaluate(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).reports[TODAY] || "", { KEY, TODAY });
    check("`### 身体スキャン`見出しが出る", reportText1.includes("### 身体スキャン"), reportText1.slice(0, 600));
    check("時刻昇順で出る(09:15が10:30より前)", reportText1.indexOf("09:15") < reportText1.indexOf("10:30"), reportText1);
    check("他日分は含まれない(該当エントリのpart「頭」が出ない)", !reportText1.includes("頭"), reportText1);
    check("部位が空の行は「—」になる", /09:15 \| 2 \| —/.test(reportText1), reportText1);

    console.log("[8] 日報生成: 当日分のbodyScansが0件なら`### 身体スキャン`節は省略される");
    await seed({ blocks: [], bodyScans: [], view: "journal" });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(400);
    const reportText2 = await page.evaluate(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).reports[TODAY] || "", { KEY, TODAY });
    check("`### 身体スキャン`見出しが出ない", !reportText2.includes("### 身体スキャン"), reportText2.slice(0, 400));

    // ============================================================
    // (g) normalizeStateの後方互換
    // ============================================================
    console.log("[9] bodyScansフィールドが無い旧stateでも例外なく起動できる");
    const failuresBefore = failures;
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.bodyScans;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);
    check("旧stateでも例外なく起動できる(pageerrorなし)", failures === failuresBefore);
    const s9 = await stateNow();
    check("normalizeStateがbodyScansを[]で補完する", Array.isArray(s9.bodyScans) && s9.bodyScans.length === 0, JSON.stringify(s9.bodyScans));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
