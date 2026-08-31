// v309 timeline/drift表示: 朝一の候補なし文言と候補ありの従来表示を固定する。
// drift-noteは候補の有無に関わらず、1件も動かさなかった場合の見込みと伝える。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-08-31";
const FIXED_NOW = new Date(2026, 7, 31, 8, 0, 0);
const NEW_NO_CANDIDATE_TEXT = "1件では収まりません。予定を見直すとDRIFTを縮められる場合があります。";
const OLD_NO_CANDIDATE_TEXT = "1件送るだけで収まる案はありません。";
const DRIFT_NOTE_TEXT = "今日の全Block(ルーティン・タイムライン由来を含む)で、着地予定と計画上の最終終了を比較。1件も動かさなかった場合の見込みです。";
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function block({ id, title, start, end, estimateMin }) {
  return {
    id, taskId: "task-v309", date: TODAY, title, category: "仕事",
    plannedStartAt: `${TODAY}T${start}:00`, plannedEndAt: `${TODAY}T${end}:00`,
    actualStartAt: "", actualEndAt: "", everStartedAt: "", completed: false,
    charge: 0, discharge: 0, estimateMin, comment: "", recurrenceGroupId: "",
    source: "", orderIndex: 0, migratedTo: "", deleted: false, oneTap: false,
    createdAt: `${TODAY}T07:00:00`, updatedAt: `${TODAY}T07:00:00`
  };
}

function fixture(kind) {
  const blocks = kind === "none"
    ? [
        block({ id: "small-1", title: "小粒Block 1", start: "08:00", end: "08:10", estimateMin: 30 }),
        block({ id: "small-2", title: "小粒Block 2", start: "08:10", end: "08:20", estimateMin: 30 }),
        block({ id: "small-3", title: "小粒Block 3", start: "08:20", end: "08:30", estimateMin: 30 })
      ]
    : kind === "boundary"
    // plannedEndAtをFIXED_NOW(08:00)と一致させることで drift(=projectedEnd-plannedEnd) が
    // ちょうど見積分(20分)と等しくなるフィクスチャ。item.minutes >= drift の境界(等号側)が
    // 候補ありとして扱われることを検証する(Codexレビュー指摘: 境界条件が未検証だった)。
    ? [block({ id: "boundary-1", title: "境界Block", start: "07:30", end: "08:00", estimateMin: 20 })]
    : [block({ id: "large-1", title: "候補ありBlock", start: "08:00", end: "08:30", estimateMin: 90 })];
  return {
    blocks,
    task: {
      id: "task-v309", projectId: "project-v309", title: "v309 Task", kind: "normal",
      status: "todo", deleted: false, dueDate: TODAY,
      createdAt: `${TODAY}T07:00:00`, updatedAt: `${TODAY}T07:00:00`
    },
    project: {
      id: "project-v309", title: "v309 Project", kind: "normal", status: "active",
      deleted: false, createdAt: `${TODAY}T07:00:00`, updatedAt: `${TODAY}T07:00:00`
    }
  };
}

async function openFixture(browser, kind) {
  const context = await browser.newContext({
    serviceWorkers: "block", viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await blockGithubApiByDefault(page);
  await page.goto(`http://localhost:${PORT}/`);
  await passGithubGate(page);
  const items = fixture(kind);
  await page.evaluate(({ key, itemsValue, today }) => {
    const state = JSON.parse(localStorage.getItem(key));
    Object.assign(state, {
      blocks: itemsValue.blocks, tasks: [itemsValue.task], projects: [itemsValue.project],
      recurrences: [], selectedDate: today, currentView: "timeline"
    });
    state.settings.focusTimerAuto = false;
    state.settings.autoSync = false;
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: STATE_KEY, itemsValue: items, today: TODAY });
  await page.reload();
  await page.locator('#app[data-view="timeline"]').waitFor();
  return { context, page, pageErrors };
}

async function checkNoCandidate(browser) {
  const current = await openFixture(browser, "none");
  try {
    const panel = current.page.locator(".drift-panel");
    check("朝一・実績ゼロの候補なし条件でDRIFTパネルは1件だけ表示", await panel.count() === 1);
    const suggestion = panel.locator(".drift-suggestion");
    check("候補なしのdrift-suggestionは1件だけでstrict locatorが曖昧にならない", await suggestion.count() === 1);
    check("DRIFTは60分で、全候補の最大見積30分を上回る", (await panel.locator(".drift-value").textContent()) === "+60分");
    check("候補なし時に新文言を表示", (await suggestion.textContent()).trim() === NEW_NO_CANDIDATE_TEXT);
    check("旧文言は表示しない", !(await panel.textContent()).includes(OLD_NO_CANDIDATE_TEXT));
    check("候補なし時は明日へ送るボタンを表示しない",
      await panel.locator('button[data-action="drift-postpone"]').count() === 0);
    check("前提説明を候補なし時にも表示",
      (await panel.locator(".drift-note").textContent()).trim() === DRIFT_NOTE_TEXT);
    check("候補なしケースでpageerrorなし", current.pageErrors.length === 0, JSON.stringify(current.pageErrors));
  } finally {
    await current.context.close();
  }
}

async function checkCandidate(browser) {
  const current = await openFixture(browser, "candidate");
  try {
    const panel = current.page.locator(".drift-panel");
    check("候補あり条件でDRIFTパネルは1件だけ表示", await panel.count() === 1);
    const suggestion = panel.locator(".drift-suggestion");
    const button = panel.locator('button[data-action="drift-postpone"]');
    check("候補ありのdrift-suggestionは1件だけ", await suggestion.count() === 1);
    check("候補ありのdrift-postponeボタンは1件だけでstrict locatorが曖昧にならない", await button.count() === 1);
    check("候補あり時は従来どおり取り戻す案を表示",
      (await suggestion.textContent()).includes("取り戻す案: 候補ありBlock (90分)"));
    check("候補あり時は新しい候補なし文言を表示しない", !(await panel.textContent()).includes(NEW_NO_CANDIDATE_TEXT));
    check("候補あり時は従来どおり明日へ送るボタンを表示",
      (await button.textContent()).trim() === "明日へ送る" && await button.getAttribute("data-id") === "large-1");
    check("前提説明を候補あり時にも表示",
      (await panel.locator(".drift-note").textContent()).trim() === DRIFT_NOTE_TEXT);
    check("候補ありケースでpageerrorなし", current.pageErrors.length === 0, JSON.stringify(current.pageErrors));
  } finally {
    await current.context.close();
  }
}

async function checkBoundaryCandidate(browser) {
  const current = await openFixture(browser, "boundary");
  try {
    const panel = current.page.locator(".drift-panel");
    check("境界ケース(item.minutes===drift)でDRIFTは20分",
      (await panel.locator(".drift-value").textContent()) === "+20分");
    check("境界ケースは等号(>=)で候補ありとして扱われる(取り戻す案を表示)",
      (await panel.locator(".drift-suggestion").textContent()).includes("取り戻す案: 境界Block (20分)"));
    check("境界ケースでは候補なし文言を表示しない", !(await panel.textContent()).includes(NEW_NO_CANDIDATE_TEXT));
    check("境界ケースでpageerrorなし", current.pageErrors.length === 0, JSON.stringify(current.pageErrors));
  } finally {
    await current.context.close();
  }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  try {
    console.log("[1] 朝一・実績ゼロ・小粒Block積み上げの候補なしケース");
    await checkNoCandidate(browser);
    console.log("\n[2] 1件でDRIFT以上を縮められる候補ありケース");
    await checkCandidate(browser);
    console.log("\n[3] item.minutes===driftの境界ケース(>=が等号側も候補ありとする)");
    await checkBoundaryCandidate(browser);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures) { console.error(`\n❌ v309: ${failures}件失敗`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((error) => { console.error(error); process.exit(1); });
