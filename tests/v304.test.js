// v304: 終了報告の一言を全outcomeでBlockコメントへ行単位dedup付き追記する。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-08-30";
const FIXED_NOW = new Date(2026, 7, 30, 10, 0, 0);
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function block(id, comment = "") {
  return {
    id, taskId: "", date: TODAY, title: `終了報告 ${id}`, category: "",
    plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`,
    actualStartAt: `${TODAY}T09:00:00`, actualEndAt: "", completed: false,
    charge: 0, discharge: 0, estimateMin: 30, comment,
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

  async function seed(blocks, declarations = []) {
    await page.evaluate(({ key, blocks, declarations, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      Object.assign(state, {
        blocks, declarations, tasks: [], projects: [], recurrences: [],
        selectedDate: today, currentView: "timeline"
      });
      state.settings.focusTimerAuto = false;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, blocks, declarations, today: TODAY });
    await page.reload();
    await page.locator('#app[data-view="timeline"]').waitFor();
  }

  async function report(blockId, outcome, note) {
    const beforeCount = (await storedState()).declarations.length;
    await page.locator(`.timeline-card [data-action="now-end"][data-id="${blockId}"]`).click();
    await page.locator(`[data-action="report-outcome"][data-outcome="${outcome}"]`).waitFor();
    await page.locator("[data-report-note]").fill(note);
    await page.locator(`[data-action="report-outcome"][data-outcome="${outcome}"]`).click();
    await page.waitForFunction(({ key, blockId, beforeCount }) => {
      const state = JSON.parse(localStorage.getItem(key));
      return Boolean(state.blocks.find((item) => item.id === blockId)?.actualEndAt)
        && state.declarations.length === beforeCount + 1;
    }, { key: STATE_KEY, blockId, beforeCount });
    return storedState();
  }

  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] done/partial/derailedの全経路で既存commentを保って追記");
    for (const [outcome, label] of [["done", "できた"], ["partial", "一部できた"], ["derailed", "脱線した"]]) {
      const id = `blk-${outcome}`;
      const note = `${label}の一言`;
      await seed([block(id, "既存メモ")]);
      const state = await report(id, outcome, `  ${note}  `);
      const savedBlock = state.blocks.find((item) => item.id === id);
      const declaration = state.declarations.find((item) => item.blockId === id);
      check(`${label}: commentへtrim済みで追記`, savedBlock.comment === `既存メモ\n${note}`, savedBlock.comment);
      check(`${label}: declaration.resultNoteと永続commentが一致`,
        declaration?.outcome === outcome && declaration?.resultNote === note && savedBlock.comment.split(/\r?\n/).includes(declaration.resultNote),
        JSON.stringify({ savedBlock, declaration }));
      check(`${label}: #1のcompleted処理は混入しない`, savedBlock.completed === false, JSON.stringify(savedBlock));
    }

    console.log("[2] 空の一言は空commentを汚さない");
    await seed([block("blk-empty", "")]);
    let state = await report("blk-empty", "done", "   ");
    check("空白だけの一言でcommentは空文字のまま", state.blocks[0].comment === "", JSON.stringify(state.blocks[0]));
    check("空白だけの一言はresultNoteも空文字", state.declarations[0].resultNote === "", JSON.stringify(state.declarations[0]));

    console.log("[3] 同じ一言を2回報告しても行単位で重複追記しない");
    await seed([block("blk-dup", "既存行")]);
    state = await report("blk-dup", "partial", "同じ一言");
    check("1回目は既存部分を残して改行追記", state.blocks[0].comment === "既存行\n同じ一言", state.blocks[0].comment);
    await page.evaluate((key) => {
      const saved = JSON.parse(localStorage.getItem(key));
      saved.blocks[0].actualEndAt = "";
      localStorage.setItem(key, JSON.stringify(saved));
    }, STATE_KEY);
    await page.reload();
    await page.locator('[data-action="now-end"][data-id="blk-dup"]').waitFor();
    state = await report("blk-dup", "derailed", "  同じ一言  ");
    const duplicateLines = state.blocks[0].comment.split(/\r?\n/).filter((line) => line === "同じ一言");
    check("2回目も同じ行は1件だけ", duplicateLines.length === 1, state.blocks[0].comment);
    check("重複を抑止しても両方の終了報告は保存", state.declarations.length === 2
      && state.declarations.every((item) => item.resultNote === "同じ一言"), JSON.stringify(state.declarations));

    console.log("[4] saveState後・reload後もcommentとdeclarationを維持");
    await page.reload();
    await page.locator('#app[data-view="timeline"]').waitFor();
    const reloaded = await storedState();
    check("reload後も既存commentと追記行を維持", reloaded.blocks[0].comment === "既存行\n同じ一言", reloaded.blocks[0].comment);
    check("reload後もdeclarations[].resultNoteを維持", reloaded.declarations.length === 2
      && reloaded.declarations.every((item) => item.resultNote === "同じ一言"), JSON.stringify(reloaded.declarations));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures) { console.error(`\n❌ v304: ${failures}件失敗`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((error) => { console.error(error); process.exit(1); });
