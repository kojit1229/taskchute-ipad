// v252: 習慣ストリーク弾1(固定化・ログ・純関数・移行・上限・取消)。
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const { habitStreakStats } = await import(pathToFileURL(path.join(__dirname, "..", "src", "core", "habit-streak.js")).href);

  console.log("[1] 純関数: daily連続・途切れ後リセット・自己ベスト・streakSince境界");
  const daily = { kind: "daily", streakSince: "2026-08-17" };
  let stats = habitStreakStats(daily, { logs: {
    "2026-08-17": { doneAt: "x" }, "2026-08-18": { doneAt: "x" }
  } }, "2026-08-18");
  check("dailyを2日連続完了するとストリーク2", stats.currentStreak === 2 && stats.bestStreak === 2, JSON.stringify(stats));
  stats = habitStreakStats(daily, { logs: {
    "2026-08-16": { doneAt: "x" }, "2026-08-17": { doneAt: "x" }, "2026-08-18": { doneAt: "x" },
    "2026-08-20": { doneAt: "x" }
  } }, "2026-08-20");
  check("過去の未完了日で現在値を1へリセットし自己ベスト2を保持", stats.currentStreak === 1 && stats.bestStreak === 2, JSON.stringify(stats));
  check("streakSince前の完了は自己ベストにも数えない", stats.bestStreak === 2, JSON.stringify(stats));

  console.log("[2] 純関数: weekdaysは土日を非該当日としてスキップ");
  stats = habitStreakStats({ kind: "weekdays", streakSince: "2026-08-21" }, { logs: {
    "2026-08-21": { doneAt: "x" }, "2026-08-24": { doneAt: "x" }
  } }, "2026-08-24");
  check("金曜と月曜が連続2になり土日で切れない", stats.currentStreak === 2 && stats.bestStreak === 2, JSON.stringify(stats));

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 768, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);
  const now = new Date();
  now.setHours(10, 0, 0, 0);
  const pad2 = (n) => String(n).padStart(2, "0");
  const TODAY = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const block = (id, ruleId, title) => ({
    id, title, recurrenceGroupId: ruleId, category: "習慣", taskId: "", date: TODAY,
    plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`, actualStartAt: "", actualEndAt: "",
    completed: false, charge: 0, discharge: 0, comment: "", createdAt: `${TODAY}T08:00`, updatedAt: `${TODAY}T08:00`, deleted: false
  });
  const rule = (id, kind, streakSince = null) => ({
    id, title: id, category: "習慣", taskId: "", kind, streakSince, startTime: "09:00", endTime: "09:30",
    anchorDate: TODAY, exceptionDates: [], createdAt: `${TODAY}T07:00`, updatedAt: `${TODAY}T07:00`, deleted: false
  });

  async function seed(recurrences, blocks, habitStreaks = {}, extraState = {}) {
    await page.goto(`http://localhost:${PORT}/styles.css`);
    await page.evaluate(({ KEY, recurrences, blocks, habitStreaks, extraState, TODAY }) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      state.recurrences = recurrences;
      state.blocks = blocks;
      state.habitStreaks = habitStreaks;
      Object.assign(state, extraState);
      state.currentView = "timeline";
      state.selectedDate = TODAY;
      state.timelineMode = "planned";
      localStorage.setItem(KEY, JSON.stringify(state));
    }, { KEY, recurrences, blocks, habitStreaks, extraState, TODAY });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector(".timeline");
  }

  async function habitLog(ruleId = "habit") {
    return page.evaluate(({ KEY, TODAY, ruleId }) =>
      JSON.parse(localStorage.getItem(KEY)).habitStreaks?.[ruleId]?.logs?.[TODAY] || null,
    { KEY, TODAY, ruleId });
  }

  async function checkCompletionLog(label, ruleId = "habit") {
    const log = await habitLog(ruleId);
    check(`${label}で当日ログを生成`, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(log?.doneAt || ""), JSON.stringify(log));
  }

  async function clickSyntheticAction(action, id = "") {
    await page.evaluate(({ action, id }) => {
      const button = document.createElement("button");
      button.dataset.action = action;
      button.dataset.testAction = action;
      if (id) button.dataset.id = id;
      document.body.appendChild(button);
      button.click();
    }, { action, id });
  }

  try {
    await page.clock.setFixedTime(now);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[3] normalizeState: 欠損・null要素を補完しupdatedAtを変えない");
    await seed([null, rule("missing", "daily"), rule("invalid", "monthly", "2026-08-01")], [], { broken: null });
    const normalized = await page.evaluate((KEY) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      return { recurrences: state.recurrences, habitStreaks: state.habitStreaks };
    }, KEY);
    const missing = normalized.recurrences.find((item) => item.id === "missing");
    const invalid = normalized.recurrences.find((item) => item.id === "invalid");
    check("欠損streakSinceをnull補完しupdatedAtを維持", missing.streakSince === null && missing.updatedAt === `${TODAY}T07:00`, JSON.stringify(missing));
    check("null recurrence要素でも起動しstreakSince null", normalized.recurrences[0]?.streakSince === null, JSON.stringify(normalized.recurrences[0]));
    check("monthlyの不正なstreakSinceはnullへ閉じる", invalid.streakSince === null, JSON.stringify(invalid));
    check("null habitStreak要素をlogs空objectへ補完", normalized.habitStreaks.broken && Object.keys(normalized.habitStreaks.broken.logs).length === 0, JSON.stringify(normalized.habitStreaks));

    console.log("[3b] 同期比較: 旧stateの空/欠損とruleIdキー順を正規化して偽fail-closeを防ぐ");
    async function syncCoreEqualFor(localHabit, remoteHabit) {
      await page.goto(`http://localhost:${PORT}/styles.css`);
      await page.evaluate(({ KEY, localHabit }) => {
        const state = JSON.parse(localStorage.getItem(KEY));
        if (localHabit === "__missing__") delete state.habitStreaks;
        else state.habitStreaks = localHabit;
        localStorage.setItem(KEY, JSON.stringify(state));
      }, { KEY, localHabit });
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector("#app");
      return page.evaluate(async (remoteHabit) => {
        const [{ state }, sync] = await Promise.all([
          import("./src/state/store.js"),
          import("./src/sync/github.js")
        ]);
        const remote = JSON.parse(JSON.stringify(state));
        if (remoteHabit === "__missing__") delete remote.habitStreaks;
        else remote.habitStreaks = remoteHabit;
        return sync.syncCoreEqual(sync.normalizedRemoteCopy(JSON.stringify(remote)));
      }, remoteHabit);
    }
    check("local欠損/remote空でもsyncCoreEqualはtrue", await syncCoreEqualFor("__missing__", {}) === true);
    check("local空/remote欠損でもsyncCoreEqualはtrue", await syncCoreEqualFor({}, "__missing__") === true);
    const orderedAB = {
      a: { logs: { [TODAY]: { doneAt: `${TODAY}T08:00:00` } } },
      b: { logs: { [TODAY]: { doneAt: `${TODAY}T09:00:00` } } }
    };
    const orderedBA = { b: orderedAB.b, a: orderedAB.a };
    check("ruleIdキー順だけ違う同内容でもsyncCoreEqualはtrue", await syncCoreEqualFor(orderedBA, orderedAB) === true);

    console.log("[4] 固定化UI: daily/weekdaysのみ表示し最大3件で静かに拒否");
    await seed([rule("toggle", "weekdays")], [block("toggle-block", "toggle", "固定化切替")]);
    await page.locator('[data-action="edit-block"][data-id="toggle-block"]').evaluate((element) => element.click());
    await page.locator('[data-modal-field="streakFixed"]').check();
    await page.locator('[data-action="modal-save"]').click();
    let toggled = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).recurrences.find((item) => item.id === "toggle"), KEY);
    check("固定化時にstreakSinceへ今日を記録", toggled.streakSince === TODAY && toggled.updatedAt !== `${TODAY}T07:00`, JSON.stringify(toggled));
    await page.locator('[data-action="edit-block"][data-id="toggle-block"]').evaluate((element) => element.click());
    await page.locator('[data-modal-field="streakFixed"]').uncheck();
    await page.locator('[data-action="modal-save"]').click();
    toggled = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).recurrences.find((item) => item.id === "toggle"), KEY);
    check("解除時にstreakSinceをnullへ戻す", toggled.streakSince === null, JSON.stringify(toggled));

    const rules = [rule("fixed1", "daily", TODAY), rule("fixed2", "weekdays", TODAY), rule("fixed3", "daily", TODAY), rule("candidate", "daily"), rule("monthly", "monthly")];
    await seed(rules, [block("candidate-block", "candidate", "候補"), block("monthly-block", "monthly", "月次")]);
    await page.locator('[data-action="edit-block"][data-id="candidate-block"]').evaluate((element) => element.click());
    await page.waitForSelector('[data-modal-field="streakFixed"]');
    await page.locator('[data-modal-field="streakFixed"]').check();
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("3件まで"));
    const refused = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).recurrences.find((item) => item.id === "candidate"), KEY);
    check("4件目を保存せずstreakSince nullのまま", refused.streakSince === null, JSON.stringify(refused));
    await page.locator('.modal-footer [data-action="modal-close"]').click();
    await page.locator('[data-action="edit-block"][data-id="monthly-block"]').evaluate((element) => element.click());
    check("monthlyには固定化トグルを出さない", await page.locator('[data-modal-field="streakFixed"]').count() === 0);
    await page.locator('.modal-footer [data-action="modal-close"]').click();

    console.log("[5] 当日Block完了でログを書き、完了取消で対称に削除");
    await seed([rule("habit", "daily", TODAY)], [block("habit-block", "habit", "読書")]);
    await page.locator('[data-action="toggle-block"][data-id="habit-block"]').click();
    await page.waitForFunction(({ KEY, TODAY }) => Boolean(JSON.parse(localStorage.getItem(KEY)).habitStreaks?.habit?.logs?.[TODAY]), { KEY, TODAY });
    const doneLog = await page.evaluate(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).habitStreaks.habit.logs[TODAY], { KEY, TODAY });
    check("toggleBlockで当日ログを生成しdoneAtを持つ", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(doneLog.doneAt), JSON.stringify(doneLog));
    await page.locator('[data-action="timeline-mode"][data-mode="actual"]').click();
    await page.waitForSelector('[data-action="edit-block"][data-id="habit-block"]');
    await page.locator('[data-action="edit-block"][data-id="habit-block"]').evaluate((element) => element.click());
    await page.locator('[data-modal-field="completed"]').uncheck();
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForFunction(({ KEY, TODAY }) => !JSON.parse(localStorage.getItem(KEY)).habitStreaks?.habit?.logs?.[TODAY], { KEY, TODAY });
    check("完了取消で当日ログが消える", true);

    console.log("[6] 残る6完了経路もそれぞれ当日ログを書き込む");
    const habitRule = () => [rule("habit", "daily", TODAY)];

    await seed(habitRule(), [{ ...block("task-block", "habit", "タスク完了"), taskId: "habit-task" }], {}, {
      tasks: [{
        id: "habit-task", title: "タスク完了", status: "todo", progressNum: 0, progressDen: 1,
        createdAt: `${TODAY}T08:00`, updatedAt: `${TODAY}T08:00`, deleted: false
      }]
    });
    await page.locator('[data-action="edit-block"][data-id="task-block"]').evaluate((element) => element.click());
    await page.locator('[data-action="toggle-task-complete"][data-id="task-block"]').click();
    await checkCompletionLog("toggleTaskCompleteFromBlock");

    await seed(habitRule(), [block("bulk-block", "habit", "一括承認")]);
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('[data-action="bulk-approve-planned"]').click();
    await checkCompletionLog("bulkApproveAsPlanned");

    await seed(habitRule(), [block("pomodoro-block", "habit", "ポモドーロ完了")], {}, {
      pomodoro: {
        running: true, blockId: "pomodoro-block", startedAt: `${TODAY}T09:00:00`,
        endsAt: `${TODAY}T09:50:00`, mode: "focus"
      }
    });
    await clickSyntheticAction("complete-pomodoro");
    await page.locator('[data-action="report-skip"]').click();
    await checkCompletionLog("completePomodoro");

    await seed(habitRule(), [block("break-block", "habit", "休憩から完了")], {}, {
      pomodoro: {
        running: true, blockId: "", lastFocusBlockId: "break-block",
        startedAt: `${TODAY}T09:50:00`, endsAt: `${TODAY}T09:55:00`, mode: "break"
      }
    });
    await clickSyntheticAction("finish-block");
    await checkCompletionLog("finishBlockFromBreak");

    await seed(habitRule(), [block("modal-block", "habit", "編集保存で完了")]);
    await page.locator('[data-action="edit-block"][data-id="modal-block"]').evaluate((element) => element.click());
    await page.locator('[data-modal-field="completed"]').check();
    await page.locator('[data-action="modal-save"]').click();
    await checkCompletionLog("saveBlockFromModal完了保存");

    await seed(habitRule(), [block("actual-block", "habit", "実績登録で完了")]);
    await clickSyntheticAction("complete-block-with-actual", "actual-block");
    await page.waitForSelector('[data-modal-field="actualStartAt"]');
    await page.locator('[data-action="modal-save"]').click();
    await checkCompletionLog("saveActualEntryFromModal");
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
