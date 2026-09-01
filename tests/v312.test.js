// v312 report/block completion/表示: 「できた」終了報告だけがBlock完了を自動確定するcharacterization test。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY, dismissBodyScanIfOpen
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-01";
const FIXED_NOW = new Date(2026, 8, 1, 10, 0, 0);
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function block(id, completed = false) {
  return {
    id, taskId: "", date: TODAY, title: `終了報告 ${id}`, category: "",
    plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`,
    actualStartAt: `${TODAY}T09:00:00`, actualEndAt: "", completed,
    charge: 0, discharge: 0, estimateMin: 30, comment: "",
    recurrenceGroupId: "", pomodoroCount: 0, interruptions: [],
    migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T09:00:00`, deleted: false
  };
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  async function storedState() {
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  }

  async function seed(targetBlock, pomodoro = null) {
    await page.evaluate(({ key, targetBlock, pomodoro, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      Object.assign(state, {
        blocks: [targetBlock], declarations: [], bodyScans: [], tasks: [], projects: [], recurrences: [],
        selectedDate: today, currentView: "timeline",
        pomodoro: pomodoro || {
          running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus",
          paused: false, pausedRemainMs: 0
        }
      });
      state.settings.focusTimerAuto = false;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, targetBlock, pomodoro, today: TODAY });
    await page.reload();
    await page.locator('#app[data-view="timeline"]').waitFor();
  }

  async function openReport(blockId, action = "now-end") {
    const selector = `.timeline-card [data-action="now-end"][data-id="${blockId}"]`;
    if (action === "now-end" && await page.locator(selector).count()) {
      await page.locator(selector).click();
    } else {
      await page.evaluate(({ action, blockId }) => {
        const trigger = document.createElement("button");
        trigger.dataset.action = action;
        if (blockId) trigger.dataset.id = blockId;
        document.body.appendChild(trigger);
        trigger.click();
        trigger.remove();
      }, { action, blockId });
    }
    await page.locator('[data-action="report-outcome"][data-outcome="done"]').waitFor();
  }

  async function selectOutcome(blockId, outcome, note = "") {
    await openReport(blockId);
    if (note) await page.locator("[data-report-note]").fill(note);
    await page.locator(`[data-action="report-outcome"][data-outcome="${outcome}"]`).click();
    await page.waitForFunction(({ key, blockId, outcome }) => {
      const state = JSON.parse(localStorage.getItem(key));
      const saved = state.blocks.find((item) => item.id === blockId);
      return Boolean(saved?.actualEndAt)
        && state.declarations.some((item) => item.blockId === blockId && item.outcome === outcome);
    }, { key: STATE_KEY, blockId, outcome });
    return storedState();
  }

  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] doneだけcompleted=trueになり、partial/derailedは未完了を維持する");
    for (const [outcome, expectedCompleted] of [["done", true], ["partial", false], ["derailed", false]]) {
      const id = `blk-${outcome}`;
      await seed(block(id));
      const state = await selectOutcome(id, outcome, `${outcome}報告`);
      const saved = state.blocks.find((item) => item.id === id);
      check(`${outcome}: actualEndAtは従来どおり保存`, Boolean(saved.actualEndAt), JSON.stringify(saved));
      check(`${outcome}: completed=${expectedCompleted}`, saved.completed === expectedCompleted, JSON.stringify(saved));
      check(`${outcome}: localStorageの完了値が期待どおり`,
        (await storedState()).blocks.find((item) => item.id === id)?.completed === expectedCompleted);
      check(`${outcome}: 身体スキャンはdone経由だけ表示`,
        await page.locator(".modal-title", { hasText: "身体スキャン" }).count() === (expectedCompleted ? 1 : 0));
      await dismissBodyScanIfOpen(page);
      if (outcome === "done") {
        await page.reload();
        await page.locator('#app[data-view="timeline"]').waitFor();
        check("done: reload後もcompleted=trueを維持",
          (await storedState()).blocks.find((item) => item.id === id)?.completed === true);
      }
    }

    console.log("[2] completed=trueへのdone報告はトグル事故を起こさない");
    await seed(block("blk-already", true));
    let state = await selectOutcome("blk-already", "done", "完了済み報告");
    check("完了済みBlockはtrueのまま", state.blocks[0].completed === true, JSON.stringify(state.blocks[0]));
    check("完了済みBlockではtoggleBlock由来の身体スキャンを開かない",
      await page.locator(".modal-title", { hasText: "身体スキャン" }).count() === 0);

    console.log("[3] スキップは完了・報告ログを変更せずactualEndAtだけ従来どおり保存する");
    await seed(block("blk-skip"));
    await openReport("blk-skip");
    await page.locator('[data-action="report-skip"]').click();
    await page.waitForFunction((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      return Boolean(state.blocks[0]?.actualEndAt);
    }, STATE_KEY);
    state = await storedState();
    check("スキップではcompleted=falseのまま", state.blocks[0].completed === false, JSON.stringify(state.blocks[0]));
    check("スキップではdeclarationsを追加しない", state.declarations.length === 0, JSON.stringify(state.declarations));
    check("スキップでは身体スキャンを開かない",
      await page.locator(".modal-title", { hasText: "身体スキャン" }).count() === 0);

    console.log("[4] ポモドーロdone経路はcompletePomodoro後に再トグルしない");
    const pomo = {
      running: true, blockId: "blk-pomo", startedAt: `${TODAY}T09:35:00`, endsAt: `${TODAY}T10:00:00`,
      mode: "focus", paused: false, pausedRemainMs: 0
    };
    await seed(block("blk-pomo"), pomo);
    await openReport("blk-pomo", "complete-pomodoro");
    await page.locator('[data-action="report-outcome"][data-outcome="done"]').click();
    await page.waitForFunction((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      return state.blocks[0]?.completed === true && state.pomodoro.running === false;
    }, STATE_KEY);
    state = await storedState();
    check("ポモ完了後もcompleted=true(ガードでfalseへ戻さない)", state.blocks[0].completed === true);
    check("ポモセッションは従来どおり終了", state.pomodoro.running === false && state.pomodoro.blockId === "",
      JSON.stringify(state.pomodoro));
    check("ポモ完了の身体スキャンは表示", await page.locator(".modal-title", { hasText: "身体スキャン" }).count() === 1);

    // Codexレビュー指摘: toggleBlock自身が出す完了トースト(「実績を編集」アクション付き)は
    // showToastが単一表示のため直後のフィードバックトーストに即座に上書きされ、
    // ユーザーが一度も見られないまま消えていた。フィードバックトースト側へアクションを
    // 統合したことで、doneで自動完了した場合だけ「実績を編集」ボタンが最終トーストに残ることを固定する。
    console.log("[5] doneで自動完了した最終トーストは実績編集アクションを保持する");
    await dismissBodyScanIfOpen(page);
    await seed(block("blk-toast-done"));
    await selectOutcome("blk-toast-done", "done", "トースト確認");
    check("doneの最終トーストに実績編集アクションが残る",
      await page.locator('.toast-action[data-action="complete-block-with-actual"][data-id="blk-toast-done"]').count() === 1);
    await dismissBodyScanIfOpen(page);

    await seed(block("blk-toast-partial"));
    await selectOutcome("blk-toast-partial", "partial", "トースト確認partial");
    check("partialの最終トーストに実績編集アクションは付かない(未完了のまま)",
      await page.locator(".toast-action").count() === 0);

    await seed(block("blk-toast-already", true));
    await selectOutcome("blk-toast-already", "done", "既完了トースト確認");
    check("既に完了済みBlockのdone報告では実績編集アクションを付けない(toggleBlockを呼んでいないため)",
      await page.locator(".toast-action").count() === 0);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures) { console.error(`\n❌ v312: ${failures}件失敗`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((error) => { console.error(error); process.exit(1); });
