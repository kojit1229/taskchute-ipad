// 修正フェーズ 単位9(第2回レビュー 1-H3): carryOverBlock() のフィールド引き継ぎ検証。
//
// (a) comment/leverageType/expectedCharge/expectedDischarge/isMIT が繰越先Blockへ引き継がれる
// (b) 実績系(actualStartAt/actualEndAt/completed/charge/discharge/pomodoroCount/interruptions/
//     incompleteReason)は引き継がれず初期値になる
// (c) id は新規・createdAt/updatedAtは繰越時刻・元Blockのmigratedtoは従来どおり
// (d) 既存の繰越テスト(v61等)の退行が無いことは別suiteで担保する(本suiteはフィールド引き継ぎ専任)
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
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const YEST = isoDate(new Date(now0.getTime() - 24 * 60 * 60 * 1000));

  // 全フィールドを埋めたBlock(繰越元)。実績系も敢えて埋め、消えることを確認する。
  function fullBlock(id, title) {
    return {
      id, taskId: "task-1", date: YEST, title, category: "仕事",
      plannedStartAt: `${YEST}T10:00`, plannedEndAt: `${YEST}T10:30`,
      // 未完了(carryableBlocksの前提)だが実績が部分的に付いている状況(着手→中断で放置)を模す。
      actualStartAt: `${YEST}T10:05`, everStartedAt: `${YEST}T10:05`, actualEndAt: "",
      completed: false, charge: 3, discharge: 1,
      expectedCharge: 2, expectedDischarge: 1,
      estimateMin: 30,
      comment: "元Blockのメモ(引き継がれるべき)",
      recurrenceGroupId: "", pomodoroCount: 4,
      migratedTo: "", carryCount: 0,
      leverageType: "asset",
      interruptions: [{ at: `${YEST}T10:10`, reason: "電話" }],
      incompleteReason: { chip: "見積もり過小", note: "時間が足りなかった", at: `${YEST}T10:20` },
      isMIT: true,
      orderIndex: 0, source: "",
      createdAt: `${YEST}T09:00`, updatedAt: `${YEST}T10:20`,
      deleted: false
    };
  }
  const testProject = () => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });
  // fullBlock() の taskId="task-1" と対応させる(未知taskIdだと一覧に出ずcarry-overボタンを掴めない)。
  const testTask = () => ({
    id: "task-1", projectId: "test-proj", parentTaskId: "", title: "テストタスク", category: "仕事", status: "todo", dueDate: "",
    description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  });

  async function seed({ blocks = [], view = "tasks" } = {}) {
    await page.evaluate(({ KEY, blocks, TODAY, view, project, task }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = [task];
      s.projects = [project];
      s.journalMeta = {};
      s.migrationRitualLog = [];
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, TODAY, view, project: testProject(), task: testTask() });
    await page.reload();
    await page.waitForTimeout(400);
  }
  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  await page.clock.setFixedTime(now0);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(500);
  await passGithubGate(page);

  // ============================================================
  // [1] 全フィールドを埋めたBlockを繰越し、引き継ぎ表どおりに複写される
  // ============================================================
  console.log("[1] carryOverBlock: 引き継ぐべきフィールドが複写される");
  await seed({
    blocks: [fullBlock("cb-full", "全フィールドBlock")]
  });
  await page.click('[data-action="carry-over"][data-id="cb-full"]');
  await page.waitForTimeout(300);
  const s1 = await stateNow();
  const src1 = (s1.blocks || []).find((b) => b.id === "cb-full");
  const dst1 = (s1.blocks || []).find((b) => b.date === TODAY && b.title === "全フィールドBlock");

  check("新Blockが作成される", !!dst1, JSON.stringify(dst1));
  check("comment が引き継がれる", dst1?.comment === "元Blockのメモ(引き継がれるべき)", dst1?.comment);
  check("leverageType が引き継がれる", dst1?.leverageType === "asset", dst1?.leverageType);
  check("expectedCharge が引き継がれる", dst1?.expectedCharge === 2, dst1?.expectedCharge);
  check("expectedDischarge が引き継がれる", dst1?.expectedDischarge === 1, dst1?.expectedDischarge);
  check("isMIT が引き継がれる(最大3個ルール内)", dst1?.isMIT === true, dst1?.isMIT);
  check("taskId が引き継がれる(既存仕様)", dst1?.taskId === "task-1", dst1?.taskId);
  check("category が引き継がれる(既存仕様)", dst1?.category === "仕事", dst1?.category);
  check("estimateMin が引き継がれる(既存仕様)", dst1?.estimateMin === 30, dst1?.estimateMin);

  console.log("[2] carryOverBlock: 実績系フィールドは引き継がれず初期値になる");
  check("actualStartAt は空文字にリセット", dst1?.actualStartAt === "", dst1?.actualStartAt);
  check("everStartedAt は空文字にリセット", dst1?.everStartedAt === "", dst1?.everStartedAt);
  check("actualEndAt は空文字にリセット", dst1?.actualEndAt === "", dst1?.actualEndAt);
  check("completed は false にリセット", dst1?.completed === false, dst1?.completed);
  check("charge は 0 にリセット", dst1?.charge === 0, dst1?.charge);
  check("discharge は 0 にリセット", dst1?.discharge === 0, dst1?.discharge);
  check("pomodoroCount は 0 にリセット", dst1?.pomodoroCount === 0, dst1?.pomodoroCount);
  check("interruptions は空配列にリセット", Array.isArray(dst1?.interruptions) && dst1.interruptions.length === 0, JSON.stringify(dst1?.interruptions));
  check("incompleteReason は null にリセット(仕様: K裁定待ち、現状は非引き継ぎ)", dst1?.incompleteReason === null, JSON.stringify(dst1?.incompleteReason));

  console.log("[3] carryOverBlock: id/createdAt/updatedAt/migratedTo は従来どおり");
  check("id は元Blockと異なる新規id", !!dst1?.id && dst1.id !== "cb-full", dst1?.id);
  check("createdAt は繰越時刻(元Blockの作成時刻と異なる)", dst1?.createdAt !== src1?.createdAt, `${dst1?.createdAt} / ${src1?.createdAt}`);
  // 元Blockのupdated_atは繰越と同時刻に更新される(4421行目)ため、繰越前の元フィクスチャ値と比較する。
  check("updatedAt は繰越時刻(繰越前の元Blockの更新時刻と異なる)", dst1?.updatedAt !== `${YEST}T10:20`, dst1?.updatedAt);
  check("元Blockのmigratedtoが新Blockのidを指す", src1?.migratedTo === dst1?.id, `${src1?.migratedTo} / ${dst1?.id}`);
  check("carryCountが0→1になる(既存仕様)", dst1?.carryCount === 1, `${dst1?.carryCount}`);

  // ============================================================
  // [4] isMITの最大3個ルール: 繰越先の当日に既に3個MITがある場合はMIT化されない
  // ============================================================
  console.log("[4] carryOverBlock: 当日MITが既に3個ある場合、元がMITでも新BlockはisMIT=falseのまま");
  function todayMitBlock(id, title) {
    return {
      id, taskId: "", date: TODAY, title, category: "",
      plannedStartAt: "", plannedEndAt: "", actualStartAt: "", everStartedAt: "", actualEndAt: "",
      completed: false, charge: 0, discharge: 0, expectedCharge: "", expectedDischarge: "",
      estimateMin: null, comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", carryCount: 0, leverageType: "", interruptions: [], incompleteReason: null,
      isMIT: true, orderIndex: 0, source: "",
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }
  await seed({
    blocks: [
      todayMitBlock("mit-1", "既存MIT1"), todayMitBlock("mit-2", "既存MIT2"), todayMitBlock("mit-3", "既存MIT3"),
      fullBlock("cb-full2", "満杯時の繰越Block")
    ]
  });
  await page.click('[data-action="carry-over"][data-id="cb-full2"]');
  await page.waitForTimeout(300);
  const s4 = await stateNow();
  const dst4 = (s4.blocks || []).find((b) => b.date === TODAY && b.title === "満杯時の繰越Block");
  check("当日MIT3個で上限のため新BlockはisMIT=falseのまま(既存の上限ルール維持)", dst4?.isMIT !== true, dst4?.isMIT);
  check("comment等の他フィールドは上限とは独立して引き継がれる", dst4?.comment === "元Blockのメモ(引き継がれるべき)", dst4?.comment);

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
