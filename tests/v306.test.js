// v306: タスクシュートのBlockカードにある充電/放電selectを連続操作しても、
// DOM再生成(render)で後発操作が巻き込まれないことを検証する。
const fs = require("fs");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-08-30";
const FIXED_NOW = new Date(2026, 7, 30, 10, 0, 0);
const BLOCK_ID = "doing-v306";
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function seededStateItems() {
  return {
    project: {
      id: "project-v306", title: "v306 Project", kind: "normal", status: "active",
      deleted: false, createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`
    },
    task: {
      id: "task-v306", projectId: "project-v306", title: "v306 Task", kind: "normal",
      status: "todo", deleted: false, dueDate: TODAY,
      createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`
    },
    block: {
      id: BLOCK_ID, taskId: "task-v306", date: TODAY, title: "v306 Block", category: "仕事",
      plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
      actualStartAt: `${TODAY}T09:05:00`, actualEndAt: "", everStartedAt: "", completed: false,
      charge: 0, discharge: 0, estimateMin: 30, comment: "",
      recurrenceGroupId: "", source: "", orderIndex: 0, migratedTo: "", deleted: false,
      createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`
    }
  };
}

async function storedBlock(page) {
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  return stored.blocks.find((item) => item.id === BLOCK_ID);
}

function fieldSelector(field) {
  // v331修正: 充放電selectは「いま」行の展開行(block-row-toggle)へ移り常時表示ではなくなった。
  // openSeededPageでmeta部タップ済みの前提でこのセレクタを使う。
  return `.exec-row:has([data-action="edit-block"][data-id="${BLOCK_ID}"]) [data-block-field="${field}"]`;
}

async function openSeededPage(browser) {
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
  const items = seededStateItems();
  await page.evaluate(({ key, itemsValue, today }) => {
    const state = JSON.parse(localStorage.getItem(key));
    Object.assign(state, {
      blocks: [itemsValue.block], tasks: [itemsValue.task], projects: [itemsValue.project],
      recurrences: [], selectedDate: today, currentView: "tasks"
    });
    state.settings.focusTimerAuto = false;
    state.settings.autoSync = false;
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: STATE_KEY, itemsValue: items, today: TODAY });
  await page.reload();
  await page.locator('#app[data-view="tasks"]').waitFor();
  // v331修正: 充放電selectは「いま」行の展開行へ移動したため、meta部タップで先に展開する。
  await page.locator(`.exec-row-now .exec-row-meta[data-action="block-row-toggle"][data-id="${BLOCK_ID}"]`).click();
  await page.locator(fieldSelector("charge")).waitFor();
  return { context, page, pageErrors };
}

async function checkFreshLocatorOrder(browser, firstField, firstValue, secondField, secondValue) {
  const current = await openSeededPage(browser);
  try {
    const first = current.page.locator(fieldSelector(firstField));
    const firstHandle = await first.elementHandle();
    await first.selectOption(firstValue);
    const second = current.page.locator(fieldSelector(secondField));
    await second.selectOption(secondValue);

    const stored = await storedBlock(current.page);
    check(`${firstField}→${secondField}: 両方をNumberで永続化`,
      stored[firstField] === Number(firstValue) && stored[secondField] === Number(secondValue),
      JSON.stringify({ charge: stored.charge, discharge: stored.discharge }));

    check(`${firstField}→${secondField}: 先発selectノードを維持`,
      await firstHandle.evaluate((element) => element.isConnected));
    const displayed = {
      charge: await current.page.locator(fieldSelector("charge")).inputValue(),
      discharge: await current.page.locator(fieldSelector("discharge")).inputValue()
    };
    check(`${firstField}→${secondField}: render省略後も保存値を表示`,
      displayed[firstField] === firstValue && displayed[secondField] === secondValue,
      JSON.stringify(displayed));
    check(`${firstField}→${secondField}: pageerrorなし`,
      current.pageErrors.length === 0, JSON.stringify(current.pageErrors));
  } finally {
    await current.context.close();
  }
}

async function openWideCompletedPage(browser) {
  const context = await browser.newContext({
    serviceWorkers: "block", viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await blockGithubApiByDefault(page);
  await page.goto(`http://localhost:${PORT}/`);
  await passGithubGate(page);
  const items = seededStateItems();
  // v306修正3ラウンド: エネルギーレールのrenderEnergyGraphはcompleted && actualEndAtの
  // Blockだけを累積カーブへ含めるため、実行中(doing)ではなく完了済みBlockで検証する。
  items.block.completed = true;
  items.block.actualEndAt = `${TODAY}T09:30:00`;
  await page.evaluate(({ key, itemsValue, today }) => {
    const state = JSON.parse(localStorage.getItem(key));
    Object.assign(state, {
      blocks: [itemsValue.block], tasks: [itemsValue.task], projects: [itemsValue.project],
      recurrences: [], selectedDate: today, currentView: "tasks"
    });
    state.settings.focusTimerAuto = false;
    state.settings.autoSync = false;
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: STATE_KEY, itemsValue: items, today: TODAY });
  await page.reload();
  await page.locator('#app[data-view="tasks"]').waitFor();
  return { context, page, pageErrors };
}

// v331 A-1a: 完了Blockは実行タブ(タスクシュート)から消え(「やったこと」非表示の契約)、
// 充放電selectも実行タブのdata-block-field即時反映経路からは到達できなくなった。完了Blockの
// charge編集は「実績はタイムラインで見る」契約どおりタイムライン(実績モード)→編集モーダルへ
// 置き換える(検証意図=完了Blockのcharge編集が永続化されエネルギーレールに反映される、を維持)。
async function checkEnergyRailFreshness(browser) {
  const current = await openWideCompletedPage(browser);
  try {
    const rail = current.page.locator("#timelineRail");
    await rail.waitFor();
    const before = await rail.innerHTML();
    check("1020px超でタスクタブのエネルギーレールが表示される", before.trim().length > 0);

    await current.page.click('[data-action="nav"][data-view="timeline"]');
    await current.page.click('[data-action="timeline-mode"][data-mode="actual"]');
    await current.page.click(`[data-action="edit-block"][data-id="${BLOCK_ID}"]`);
    const modalCharge = current.page.locator('.modal-card [data-modal-field="charge"]');
    const modalChargeHandle = await modalCharge.elementHandle();
    await modalCharge.selectOption("5");
    // v331修正(M3): 実行タブ即時反映selectの「stale化しない」検証の代替として、モーダル内
    // charge selectのElementHandleがselectOption後・modal-save前もDOMへ接続維持していることを確認する。
    check("完了Blockのcharge編集(モーダル): selectOption後もselectノードを維持(stale化しない)",
      await modalChargeHandle.evaluate((element) => element.isConnected));
    await current.page.click('[data-action="modal-save"]');
    await current.page.click('[data-action="nav"][data-view="tasks"]');

    const after = await rail.innerHTML();
    check("完了Blockのcharge編集(タイムライン経由)後にエネルギーレールの表示内容が更新される", after !== before);

    const stored = await storedBlock(current.page);
    check("完了Blockのcharge編集が永続化される(タイムライン経由)", stored.charge === 5);
    check("エネルギーレール経路でpageerrorなし",
      current.pageErrors.length === 0, JSON.stringify(current.pageErrors));
  } finally {
    await current.context.close();
  }
}

async function checkStaleDischargeHandle(browser) {
  const current = await openSeededPage(browser);
  try {
    const staleDischarge = await current.page.locator(fieldSelector("discharge")).elementHandle();
    const originalCharge = await current.page.locator(fieldSelector("charge")).elementHandle();
    let actionError = "";
    await current.page.locator(fieldSelector("charge")).selectOption("5");
    check("charge変更後も事前取得discharge ElementHandleを維持",
      await staleDischarge.evaluate((element) => element.isConnected));
    try {
      await staleDischarge.selectOption("3");
    } catch (error) {
      actionError = error.message;
    }

    const stored = await storedBlock(current.page);
    check("stale discharge ElementHandleの連続操作がエラーにならない",
      actionError === "", actionError);
    check("stale discharge ElementHandleでもcharge/dischargeを両方保存",
      stored.charge === 5 && stored.discharge === 3,
      JSON.stringify({ charge: stored.charge, discharge: stored.discharge }));

    check("charge変更後もcharge ElementHandleを維持",
      await originalCharge.evaluate((element) => element.isConnected));
    const displayed = {
      charge: await current.page.locator(fieldSelector("charge")).inputValue(),
      discharge: await current.page.locator(fieldSelector("discharge")).inputValue()
    };
    check("事前取得handle操作後も両方の保存値を表示",
      displayed.charge === "5" && displayed.discharge === "3", JSON.stringify(displayed));
    check("stale handle経路でpageerrorなし",
      current.pageErrors.length === 0, JSON.stringify(current.pageErrors));
  } finally {
    await current.context.close();
  }
}

(async () => {
  const testSource = fs.readFileSync(__filename, "utf8");
  check("新規固定waitなし", !testSource.includes(["waitFor", "Timeout"].join("")));

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  try {
    console.log("[1] fresh locatorでcharge→dischargeを連続変更");
    await checkFreshLocatorOrder(browser, "charge", "4", "discharge", "2");
    console.log("[2] fresh locatorでdischarge→chargeを連続変更");
    await checkFreshLocatorOrder(browser, "discharge", "1", "charge", "3");
    console.log("[3] charge変更前に取得したdischarge ElementHandleを待機なしで連続操作");
    await checkStaleDischargeHandle(browser);
    console.log("[4] 1020px超のタスクタブでcharge/discharge変更後もエネルギーレールが最新化される");
    await checkEnergyRailFreshness(browser);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures) { console.error(`\n❌ v306: ${failures}件失敗`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((error) => { console.error(error); process.exit(1); });
