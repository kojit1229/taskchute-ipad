// v59由来回帰 / v299修正: 維持対象のai-schedule経由でcomputeFreeGapsと下書き確定を実ブラウザ検証する。
//
// v299で朝プラン(runAiMorningPlan / ai-morning-plan)は削除されたが、computeFreeGapsと
// _scheduleDraftは、維持対象のrunAiSchedule / ai-scheduleから引き続き使われている。
// そのため旧v59の静的存在チェック化は取り消し、次の4シナリオをE2Eとして維持する。
//   [1] 占有なし境界 [2] 連続占有境界 [3] 日跨ぎ端23:00 [4] 繰越draftの確定+migratedTo
//
// v199以降のrunAiScheduleは「当日のタスクシュートBlock再配置」かつ私用Blockは8〜21時に
// 制限されるため、[1]〜[3]の候補はWBS未Block化Taskではなく当日の可動Blockで作る。
// [3]の22:15〜23:00枠は現行配置窓の外なので、実computeFreeGapsの戻り値をブラウザ内で直接確認し、
// ai-schedule側では見送りになることを確認する。
// また朝プラン削除後はcarryFromId付きdraftの生成入口が無いため、[4]だけテスト用module hookで
// _scheduleDraftを注入する。描画・draft-confirm・永続state更新はすべて本番実装をそのまま通す。
const {
  chromium,
  launchOptions,
  startServer,
  blockGithubApiByDefault,
  passGithubGate,
  randomPort,
  dispatchRegisteredAction
} = require("./helpers");

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

  // app.jsはtype="module"で内部関数・変数をwindowへ公開しない。実装ファイルを変えず、
  // このE2Eの応答だけに最小hookを末尾追加して純粋関数の境界とcarryFromId確定分岐を観測する。
  await page.route((url) => url.hostname === "localhost" && url.pathname === "/app.js", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const hook = `
window.__v59Test = {
  computeFreeGaps(date, dayStartMin, dayEndMin, excludeIds = []) {
    return computeFreeGaps(date, dayStartMin, dayEndMin, new Set(excludeIds));
  },
  setScheduleDraft(draft) {
    _scheduleDraft = draft;
    _draftUndo = null;
    state.timelineMode = "planned";
    setView("timeline");
    render();
  }
};`;
    await route.fulfill({ response, body: source + hook, contentType: "text/javascript" });
  });

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const yesterday = new Date(now0);
  yesterday.setDate(yesterday.getDate() - 1);
  const YEST = isoDate(yesterday);

  function planBlock({ id, date, title, startMin, endMin, taskId = "", category = "" }) {
    return {
      id, taskId, date, title, category,
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(endMin)}`,
      actualStartAt: "", everStartedAt: "", actualEndAt: "",
      completed: false, charge: 0, discharge: 0,
      estimateMin: endMin - startMin,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", carryCount: 0, orderIndex: 0,
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`,
      deleted: false
    };
  }

  function wbsTask(id, title) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }

  const testProject = () => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "",
    createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, collapsed: false
  });

  // 非同期hydrateがseedを古いメモリstateで上書きしないよう、アプリJSの動いていない同一originで書く。
  async function seed({ blocks = [], tasks = [], projects = [] } = {}) {
    await page.goto(`http://localhost:${PORT}/styles.css`);
    await page.evaluate(({ key, blocks, tasks, projects, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.blocks = blocks;
      state.tasks = tasks;
      state.projects = projects;
      state.selectedDate = today;
      state.currentView = "timeline";
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: KEY, blocks, tasks, projects, today: TODAY });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => Boolean(window.__v59Test));
  }

  async function runSchedule() {
    await dispatchRegisteredAction(page, "ai-schedule");
    await page.waitForSelector(".draft-bar");
  }

  async function draftBlocks() {
    const times = await page.locator(".draft-block-time").allTextContents();
    return times.map((text) => {
      const match = text.match(/(\d{2}):(\d{2})〜(\d{2}):(\d{2})\((\d+)分\)/);
      if (!match) return null;
      return {
        start: Number(match[1]) * 60 + Number(match[2]),
        end: Number(match[3]) * 60 + Number(match[4]),
        minutes: Number(match[5])
      };
    }).filter(Boolean);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.waitForFunction(() => Boolean(window.__v59Test));

    // ---- [1] 空き時間の境界: 占有なし ----
    console.log("[1] computeFreeGaps 境界(占有なし)— 5:00〜23:00の1本");
    const movable1 = planBlock({
      id: "test-movable-1", taskId: "test-task-1", date: TODAY,
      title: "占有なし候補Block", startMin: 14 * 60, endMin: 14 * 60 + 30
    });
    await seed({ blocks: [movable1], tasks: [wbsTask("test-task-1", movable1.title)], projects: [testProject()] });
    check("廃止済み朝プランボタンを本番DOMへ戻さない",
      await page.locator('[data-action="ai-morning-plan"]').count() === 0);
    const rawGaps1 = await page.evaluate(({ today, excludeIds }) =>
      window.__v59Test.computeFreeGaps(today, 5 * 60, 23 * 60, excludeIds),
    { today: TODAY, excludeIds: [movable1.id] });
    check("占有なしは5:00〜23:00の単一gap", JSON.stringify(rawGaps1) === JSON.stringify([[300, 1380]]), JSON.stringify(rawGaps1));
    await runSchedule();
    const gaps1 = await draftBlocks();
    check("候補1件が下書きとして1件だけ配置される", gaps1.length === 1, JSON.stringify(gaps1));
    if (gaps1.length === 1) {
      check("現在時刻10:00から配置される", gaps1[0].start === 10 * 60, JSON.stringify(gaps1[0]));
      check("配置時間は元Blockと同じ30分", gaps1[0].minutes === 30, JSON.stringify(gaps1[0]));
      check("配置は23:00(1380分)を超えない", gaps1[0].end <= 1380, JSON.stringify(gaps1[0]));
    }

    // ---- [2] 空き時間の境界: 連続占有 ----
    console.log("[2] computeFreeGaps 境界(連続占有)— 隣接Blockをマージして終端後へ配置");
    const movable2 = planBlock({
      id: "test-movable-2", taskId: "test-task-2", date: TODAY,
      title: "連続占有テスト候補", startMin: 15 * 60, endMin: 15 * 60 + 30
    });
    const occStart = 10 * 60 + 15;
    const occMid = occStart + 30;
    const occEnd = occMid + 30;
    await seed({
      tasks: [wbsTask("test-task-2", movable2.title)],
      projects: [testProject()],
      blocks: [
        movable2,
        planBlock({ id: "test-occ-1", date: TODAY, title: "占有A", startMin: occStart, endMin: occMid }),
        planBlock({ id: "test-occ-2", date: TODAY, title: "占有B", startMin: occMid, endMin: occEnd })
      ]
    });
    const rawGaps2 = await page.evaluate(({ today, excludeIds }) =>
      window.__v59Test.computeFreeGaps(today, 5 * 60, 23 * 60, excludeIds),
    { today: TODAY, excludeIds: [movable2.id] });
    check("連続占有2件は1区間へマージされる",
      JSON.stringify(rawGaps2) === JSON.stringify([[300, occStart], [occEnd, 1380]]), JSON.stringify(rawGaps2));
    await runSchedule();
    const gaps2 = await draftBlocks();
    check("候補1件が連続占有Blockの直後に配置される", gaps2.length === 1, JSON.stringify(gaps2));
    if (gaps2.length === 1) {
      check("配置開始は連続占有の終端と一致する", gaps2[0].start === occEnd,
        `start=${gaps2[0].start} occEnd=${occEnd}`);
      check("配置は占有区間と重ならない", gaps2[0].start >= occEnd || gaps2[0].end <= occStart,
        JSON.stringify({ gap: gaps2[0], occStart, occEnd }));
    }

    // ---- [3] 空き時間の境界: 日跨ぎ端(23:00) ----
    console.log("[3] computeFreeGaps 境界(日跨ぎ端23:00)— 22:15〜23:00だけを返し、23:00を超えない");
    const movable3a = planBlock({
      id: "test-movable-3a", taskId: "test-task-3a", date: TODAY,
      title: "23時境界テストA", startMin: 8 * 60, endMin: 8 * 60 + 30
    });
    const movable3b = planBlock({
      id: "test-movable-3b", taskId: "test-task-3b", date: TODAY,
      title: "23時境界テストB", startMin: 8 * 60 + 40, endMin: 9 * 60 + 10
    });
    await seed({
      tasks: [wbsTask("test-task-3a", movable3a.title), wbsTask("test-task-3b", movable3b.title)],
      projects: [testProject()],
      blocks: [
        movable3a,
        movable3b,
        planBlock({ id: "test-occ-3", date: TODAY, title: "ほぼ終日の占有", startMin: 5 * 60, endMin: 22 * 60 + 15 })
      ]
    });
    const rawGaps3 = await page.evaluate(({ today, excludeIds }) =>
      window.__v59Test.computeFreeGaps(today, 5 * 60, 23 * 60, excludeIds),
    { today: TODAY, excludeIds: [movable3a.id, movable3b.id] });
    check("残りgapは22:15〜23:00の45分だけ",
      JSON.stringify(rawGaps3) === JSON.stringify([[22 * 60 + 15, 23 * 60]]), JSON.stringify(rawGaps3));
    check("gap終端は23:00(1380分)を超えない", rawGaps3[0]?.[1] === 1380, JSON.stringify(rawGaps3));
    await runSchedule();
    const gaps3 = await draftBlocks();
    check("現行の私用配置窓(8〜21時)外なので下書きへは配置しない", gaps3.length === 0, JSON.stringify(gaps3));
    const skippedText3 = await page.locator(".draft-skipped-list").textContent().catch(() => "");
    check("配置窓内に入らない2候補を見送りとして表示", (skippedText3 || "").includes(movable3a.title)
      && (skippedText3 || "").includes(movable3b.title) && (skippedText3.match(/見送り:/g) || []).length === 2,
    skippedText3);

    // ---- [4] 繰越候補がdraftに載る / 確定で元BlockにmigratedToが付く ----
    console.log("[4] 繰越候補のdraft搭載 と 確定時のmigratedTo付与");
    const CARRY_TITLE = "昨日やり残したレポート作成";
    const carryBlock = planBlock({
      id: "test-carry-1", date: YEST, title: CARRY_TITLE,
      startMin: 14 * 60, endMin: 14 * 60 + 30
    });
    await seed({ blocks: [carryBlock] });
    await page.evaluate(({ today, carryFromId, title }) => {
      window.__v59Test.setScheduleDraft({
        date: today,
        source: "deterministic",
        skipped: [],
        items: [{
          id: "test-carry-draft-1", title, taskId: "", category: "",
          start: 10 * 60, minutes: 30, aiStart: 10 * 60, aiMinutes: 30,
          carryFromId
        }]
      });
    }, { today: TODAY, carryFromId: carryBlock.id, title: CARRY_TITLE });
    await page.waitForSelector(".draft-block-title");
    const draftTitle = await page.locator(".draft-block-title").first().textContent().catch(() => "");
    check("昨日未完了(繰越候補)がdraftのタイトルとして表示される", (draftTitle || "").includes(CARRY_TITLE), draftTitle);

    await page.click('[data-action="draft-confirm"]');
    await page.waitForFunction(({ key, srcId, today, title }) => {
      const state = JSON.parse(localStorage.getItem(key));
      const src = (state.blocks || []).find((block) => block.id === srcId);
      return Boolean(src?.migratedTo && (state.blocks || []).some((block) => block.id === src.migratedTo && block.date === today && block.title === title));
    }, { key: KEY, srcId: carryBlock.id, today: TODAY, title: CARRY_TITLE });
    const afterConfirm = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    const srcBlock = (afterConfirm.blocks || []).find((block) => block.id === carryBlock.id);
    const newBlock = (afterConfirm.blocks || []).find((block) => block.date === TODAY && block.title === CARRY_TITLE);
    check("元Block(昨日)にmigratedToが設定される", !!srcBlock?.migratedTo, JSON.stringify(srcBlock));
    check("今日に新しいBlockとして登録される", !!newBlock, JSON.stringify(newBlock));
    check("migratedToの参照先は今日の新Blockと一致する",
      !!srcBlock && !!newBlock && srcBlock.migratedTo === newBlock.id);

    await page.reload();
    await page.waitForFunction(() => Boolean(window.__v59Test));
    await dispatchRegisteredAction(page, "nav", { view: "today" });
    await page.waitForSelector('#app[data-view="today"]');
    const carryPanelText = await page.locator(".carryover-panel").textContent().catch(() => "");
    check("確定後は昨日の未完了パネルに再表示されない", !(carryPanelText || "").includes(CARRY_TITLE), carryPanelText);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
