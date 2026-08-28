// v278: PC計器盤導線とGATE ROUTINE編集パネルの固定化トグル。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");

const PORT = randomPort();
const KEY = STATE_KEY;
const TODAY = "2026-08-27";
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

const rule = (id, title, kind = "daily", streakSince = null, extra = {}) => ({
  id, title, category: "ルーティン", taskId: "", kind, streakSince,
  startTime: "09:00", endTime: "09:30", anchorDate: TODAY, order: 0,
  exceptionDates: [], createdAt: `${TODAY}T07:00`, updatedAt: `${TODAY}T07:00`, deleted: false,
  ...extra
});

const block = (id, ruleId, title = "朝の読書") => ({
  id, title, recurrenceGroupId: ruleId, category: "習慣", taskId: "", date: TODAY,
  plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`, actualStartAt: "", actualEndAt: "",
  completed: false, charge: 0, discharge: 0, comment: "", createdAt: `${TODAY}T08:00`,
  updatedAt: `${TODAY}T08:00`, deleted: false
});

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  async function seed({ recurrences = [], blocks = [], view = "today" } = {}) {
    await page.goto(`http://localhost:${PORT}/styles.css`);
    await page.evaluate(({ KEY, recurrences, blocks, view, TODAY }) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      state.recurrences = recurrences;
      state.blocks = blocks;
      state.habitStreaks = {};
      state.currentView = view;
      state.selectedDate = TODAY;
      state.timelineMode = "planned";
      state.dataModifiedAt = `${TODAY}T06:00:00`;
      localStorage.setItem(KEY, JSON.stringify(state));
    }, { KEY, recurrences, blocks, view, TODAY });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector("#app");
  }

  async function storedRule(id) {
    return page.evaluate(({ KEY, id }) => JSON.parse(localStorage.getItem(KEY)).recurrences.find((item) => item.id === id), { KEY, id });
  }

  try {
    await page.clock.setFixedTime(new Date(2026, 7, 27, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] PCサイドバーからINSTRUMENTS/IRON LOGへ直接遷移しmobileNavは不変");
    const navLabels = await page.locator(".nav-list .nav-label").allTextContents();
    // v281: FUNDタブがIRON LOGの後へ常設されたため期待列を追従(INSTRUMENTS→IRON LOGの隣接と0秒思考〜その他の位置関係は維持して検証)。
    check("zeroとmoreの間にINSTRUMENTS→IRON LOG(→FUND)", navLabels.slice(-6).join("|") === "0秒思考|INSTRUMENTS|IRON LOG|FUND|その他|設定", JSON.stringify(navLabels));
    const mobileItems = await page.$$eval("#bottomNav button", (elements) => elements.map((element) => ({
      id: element.dataset.view, label: element.childNodes[0].textContent
    })));
    check("mobileNavは今日/ジャーナル/実行/時間/その他の5枠を維持",
      JSON.stringify(mobileItems) === JSON.stringify([
        { id: "today", label: "今日" }, { id: "journal", label: "ジャーナル" },
        { id: "tasks", label: "実行" }, { id: "timeline", label: "時間" }, { id: "more", label: "その他" }
      ]), JSON.stringify(mobileItems));
    await page.locator('.nav-button[data-view="instruments"]').click();
    await page.waitForSelector('.instr-view');
    check("INSTRUMENTSクリックでビュー遷移", await page.locator('#app[data-view="instruments"] .instr-view').count() === 1);
    await page.locator('.nav-button[data-view="iron-log"]').click();
    await page.waitForSelector('#ironRoot');
    check("IRON LOGクリックでビュー遷移", await page.locator('#app[data-view="iron-log"] #ironRoot').count() === 1);

    console.log("[2] GATE編集でdailyだけを固定化し、保存・再読込後にINSTRUMENTSへ表示");
    const daily = rule("daily", "朝の読書", "daily", null, { order: 0 });
    const weekly = rule("weekly", "週次レビュー", "weekly", null, { order: 1 });
    await seed({ recurrences: [daily, weekly] });
    check("編集モードOFFでは固定化トグル非表示", await page.locator('[data-action="tower-gate-streak-toggle"]').count() === 0);
    await page.locator('[data-action="tower-gate-edit-toggle"]').click();
    await page.waitForSelector(".tower-gate-editor");
    check("daily行だけに📌固定化トグル", await page.locator('.tower-gate-edit-row[data-rule-id="daily"] [data-action="tower-gate-streak-toggle"]').count() === 1);
    check("weekly行には固定化トグル非表示", await page.locator('.tower-gate-edit-row[data-rule-id="weekly"] [data-action="tower-gate-streak-toggle"]').count() === 0);
    await page.locator('.tower-gate-edit-row[data-rule-id="daily"] [data-action="tower-gate-streak-toggle"]').click();
    await page.waitForFunction(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).recurrences.find((item) => item.id === "daily")?.streakSince === TODAY, { KEY, TODAY });
    const fixed = await storedRule("daily");
    const fixedModifiedAt = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).dataModifiedAt, KEY);
    check("ONでstreakSinceへ当日を付与しupdatedAt更新", fixed.streakSince === TODAY && fixed.updatedAt === `${TODAY}T10:00:00`, JSON.stringify(fixed));
    check("ONはsaveState経由でdataModifiedAt更新", fixedModifiedAt === `${TODAY}T10:00:00`, fixedModifiedAt);
    await page.locator('.nav-button[data-view="instruments"]').click();
    await page.waitForSelector('.instr-habit-panel');
    check("固定化したルーティンがINSTRUMENTSのHABITパネルへ出現", (await page.locator('.instr-habit-panel').first().textContent()).includes("朝の読書"));
    await page.reload();
    await page.waitForSelector('.instr-habit-panel');
    check("ONはreload後も維持", (await storedRule("daily")).streakSince === TODAY && await page.locator('.instr-habit-panel').count() === 1);

    console.log("[3] GATE編集で固定化を解除し、保存・再読込後も解除を維持");
    await page.locator('.nav-button[data-view="today"]').click();
    await page.waitForSelector('.today-tower');
    await page.locator('[data-action="tower-gate-edit-toggle"]').click();
    await page.waitForSelector('.tower-gate-editor');
    check("再読込後の編集行は固定化ONを反映", await page.locator('.tower-gate-edit-row[data-rule-id="daily"] input:checked').count() === 1);
    await page.clock.setFixedTime(new Date(2026, 7, 27, 10, 5, 0));
    await page.locator('.tower-gate-edit-row[data-rule-id="daily"] [data-action="tower-gate-streak-toggle"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).recurrences.find((item) => item.id === "daily")?.streakSince === null, KEY);
    const unfixed = await storedRule("daily");
    const unfixedModifiedAt = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).dataModifiedAt, KEY);
    check("OFFでstreakSinceを解除しupdatedAt更新", unfixed.streakSince === null && unfixed.updatedAt === `${TODAY}T10:05:00`, JSON.stringify(unfixed));
    check("OFFもsaveState経由でdataModifiedAt更新", unfixedModifiedAt === `${TODAY}T10:05:00`, unfixedModifiedAt);
    await page.reload();
    await page.waitForSelector('.today-tower');
    check("OFFはreload後も維持", (await storedRule("daily")).streakSince === null);

    console.log("[4] 4件目は拒否して指定トーストを出しstateを変えない");
    const fixedRules = [
      rule("fixed-1", "固定1", "daily", TODAY, { order: 0 }),
      rule("fixed-2", "固定2", "weekdays", TODAY, { order: 1 }),
      rule("fixed-3", "固定3", "daily", TODAY, { order: 2 }),
      rule("candidate", "固定候補", "daily", null, { order: 3 }),
      rule("weekly-2", "週次", "weekly", null, { order: 4 })
    ];
    await seed({ recurrences: fixedRules });
    await page.locator('[data-action="tower-gate-edit-toggle"]').click();
    await page.waitForSelector('.tower-gate-editor');
    const beforeRefusal = await page.evaluate((KEY) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      return JSON.stringify({ recurrences: state.recurrences, dataModifiedAt: state.dataModifiedAt });
    }, KEY);
    await page.locator('.tower-gate-edit-row[data-rule-id="candidate"] [data-action="tower-gate-streak-toggle"]').click();
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent === "固定化は3件まで");
    const afterRefusal = await page.evaluate((KEY) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      return JSON.stringify({ recurrences: state.recurrences, dataModifiedAt: state.dataModifiedAt });
    }, KEY);
    check("拒否時は候補を未固定のままstate不変", beforeRefusal === afterRefusal && (await storedRule("candidate")).streakSince === null);
    check("拒否後のチェック表示もOFFへ戻る", await page.locator('.tower-gate-edit-row[data-rule-id="candidate"] input:checked').count() === 0);
    check("weekly負例も固定化トグル非表示", await page.locator('.tower-gate-edit-row[data-rule-id="weekly-2"] [data-action="tower-gate-streak-toggle"]').count() === 0);
    await page.setViewportSize({ width: 390, height: 844 });
    const narrowLayout = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    check("390pxのGATE編集行にページ横スクロールなし", narrowLayout.scroll <= narrowLayout.client, JSON.stringify(narrowLayout));
    await page.locator('[data-action="tower-gate-edit-toggle"]').click();
    check("編集モードを閉じると全固定化トグル非表示", await page.locator('[data-action="tower-gate-streak-toggle"]').count() === 0);

    console.log("[5] 既存Block編集モーダルの固定化経路も維持");
    await page.setViewportSize({ width: 1100, height: 900 });
    const modalRule = rule("modal-rule", "モーダル固定", "weekdays", null, { category: "習慣" });
    await seed({ recurrences: [modalRule], blocks: [block("modal-block", "modal-rule")], view: "timeline" });
    await page.waitForSelector('.timeline');
    await page.locator('[data-action="edit-block"][data-id="modal-block"]').evaluate((element) => element.click());
    check("既存streakFixedチェックボックスを表示", await page.locator('[data-modal-field="streakFixed"]').count() === 1);
    await page.locator('[data-modal-field="streakFixed"]').check();
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForFunction(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).recurrences.find((item) => item.id === "modal-rule")?.streakSince === TODAY, { KEY, TODAY });
    check("既存モーダル経路でも固定化を保存", (await storedRule("modal-rule")).streakSince === TODAY);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nv278: 全件成功" : `\nv278: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
