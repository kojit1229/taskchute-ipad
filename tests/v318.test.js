// v318: タップ領域44px / FUND失敗表示 / 睡眠未記録の中立化 / 同期バナー閉じる。
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
const FIXED_NOW = new Date(2026, 8, 2, 10, 0, 0, 0);
const TODAY = "2026-09-02";
const DISMISS_KEY = "taskchute-sync-banner-dismissed";
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

const FUND_FIXTURE = {
  version: 1,
  generatedAt: "2026-09-02T09:00:00+09:00",
  start: { date: "2026-09-01", capital: 1000000 },
  nav: { current: 1010000, dayChangePct: 1, totalReturnPct: 1, series: [
    { date: "2026-09-01", nav: 1000000, n225: 42000, spx: 5600 }
  ] },
  benchmark: { n225ReturnPct: 0.5, spxReturnPct: 0.4, excessVsN225: 0.5, excessVsSpx: 0.6 },
  cash: 1010000, positions: [], openOrders: [], recentTrades: [], journal: null
};
const HEALTH_FIXTURE = {
  schema: 1, generated_at: "2026-09-02T06:00:00+09:00", days: [{
    date: TODAY, sleep_min: 425, bed_time: "23:46", wake_time: "06:51",
    resting_hr: 58, hrv_sdnn: 41, steps: 8120, weight_kg: null
  }]
};

(async () => {
  console.log("[1] FUNDの未設定・404・壊れJSON・前回正常値保持を非永続キャッシュで表す");
  const fund = await import(pathToFileURL(path.join(ROOT, "src/features/fund.js")).href);
  const store = await import(pathToFileURL(path.join(ROOT, "src/state/store.js")).href);
  const { fundCache } = await import(pathToFileURL(path.join(ROOT, "src/state/fund-cache.js")).href);
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  let ready = false;
  let result = "";
  fund.configureFund({
    escapeHTML, renderHeader: () => "<header>FUND</header>", renderMarkdown: (value) => value,
    personalDataReady: () => ready,
    fetchGitHubRawText: async () => {
      if (result instanceof Error) throw result;
      return result;
    }
  });
  store.setState({ settings: { github: {} } });
  Object.assign(fundCache, { fetchedAt: 0, data: undefined, lastError: "", lastAttemptAt: 0 });
  check("personal-data未設定は接続案内", fund.renderFund().includes("設定で個人データリポジトリを接続すると表示されます"));
  ready = true;
  check("試行前は取得中表示", fund.renderFund().includes("FUNDデータを読み込んでいます"));
  result = new Error("404");
  const failureChanged = await fund.hydrateFundData(0);
  const unavailable = fund.renderFund();
  check("失敗メタデータ更新は再描画対象", failureChanged === true);
  check("404は最終試行時刻と30分後の再試行を表示", unavailable.includes("FUNDデータを取得できませんでした")
    && /最終試行 \d{2}:\d{2}/.test(unavailable) && unavailable.includes("30分後に再試行します"));
  check("失敗表示に赤・警告クラスを使わない", !/class="[^"]*(?:danger|error|warning|red)/i.test(unavailable));
  Object.assign(fundCache, { fetchedAt: 0, data: undefined, lastError: "", lastAttemptAt: 0 });
  result = "{broken";
  await fund.hydrateFundData(0);
  check("壊れたJSONも取得失敗表示", fund.renderFund().includes("FUNDデータを取得できませんでした") && fundCache.lastError.length > 0);
  result = JSON.stringify(FUND_FIXTURE);
  await fund.hydrateFundData(0);
  const previous = fundCache.data;
  result = new Error("404 after success");
  await fund.hydrateFundData(0);
  check("前回成功後の失敗は従来データとstale判定経路を維持", fundCache.data === previous
    && fund.renderFund().includes("fund-summary") && !fund.renderFund().includes("FUNDデータを取得できませんでした"));

  console.log("[2] 390pxの実DOMで操作領域・横スクロール・睡眠カード・同期バナーを確認");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({
    serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo"
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);
  let fundMode = "success";
  let healthMode = "success";
  await page.route((url) => url.hostname === "api.github.com", async (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    if (pathname.endsWith("/contents/taskchute/dashboard/fund.json")) {
      if (fundMode === "404") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", body: fundMode === "broken" ? "{broken" : JSON.stringify(FUND_FIXTURE) });
    }
    if (pathname.endsWith("/contents/karada/health-daily.json")) {
      if (healthMode === "404") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(HEALTH_FIXTURE) });
    }
    return route.fallback();
  });

  const setView = async (view, extra = {}) => {
    await page.evaluate(({ key, view, today, extra }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = view;
      state.selectedDate = today;
      Object.assign(state, extra);
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, view, today: TODAY, extra });
    await page.reload();
  };
  const rect = (locator) => locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height, left: box.left, right: box.right };
  });
  const noPageOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await setView("today", {
      sleep: { logs: {} },
      condition: { logs: { [TODAY]: { gym: [{ id: "set-v318", exercise: "ベンチプレス", weight: 60, reps: 10, at: `${TODAY}T09:00` }] } } }
    });
    await page.waitForSelector(".tower-journal-save");
    const baseBtn = await rect(page.locator(".tower-journal-save"));
    const editTarget = await rect(page.locator(".tower-gate-edit"));
    check("共通btn由来のSAVEとGATE EDITは44px以上", baseBtn.height >= 44
      && editTarget.width >= 44 && editTarget.height >= 44, JSON.stringify({ baseBtn, editTarget }));
    await page.locator("#towerGateStrip .tower-gate").first().scrollIntoViewIfNeeded();
    const gateHit = await page.evaluate(() => {
      const button = document.querySelector(".tower-gate-edit").getBoundingClientRect();
      const x = button.left + button.width / 2;
      const y = button.bottom + 6;
      const hit = document.elementFromPoint(x, y);
      return { x, y, buttonLeft: button.left, buttonRight: button.right, buttonBottom: button.bottom,
        hitClass: hit?.className || hit?.id || hit?.tagName || "",
        hitStrip: Boolean(hit?.closest(".tower-gate, #towerGateStrip")) };
    });
    check("GATE EDIT水平範囲内の直下6pxはストリップ側へ到達", gateHit.x >= gateHit.buttonLeft
      && gateHit.x <= gateHit.buttonRight && gateHit.y === gateHit.buttonBottom + 6
      && gateHit.hitStrip, JSON.stringify(gateHit));
    check("Today 390pxに横スクロールなし", await noPageOverflow());
    await page.screenshot({ path: path.join(os.tmpdir(), "taskchute-v318-today-390.png"), fullPage: true });

    await setView("iron-log");
    await page.waitForSelector(".iron-set-del");
    const ironDelete = await rect(page.locator(".iron-set-del"));
    check("IRON削除×は44px以上", ironDelete.width >= 44 && ironDelete.height >= 44, JSON.stringify(ironDelete));
    check("IRON LOG 390pxに横スクロールなし", await noPageOverflow());
    await page.screenshot({ path: path.join(os.tmpdir(), "taskchute-v318-iron-390.png"), fullPage: true });

    await setView("wbs", {
      projects: [{ id: "project-v318", title: "安全修正", kind: "normal", status: "active", collapsed: false, deleted: false, updatedAt: `${TODAY}T09:00:00` }],
      tasks: [
        { id: "task-v318", projectId: "project-v318", parentTaskId: "", title: "行内ボタン確認", status: "todo", kind: "normal", planTarget: true, deleted: false, updatedAt: `${TODAY}T09:00:00` },
        { id: "step-v318", projectId: "project-v318", parentTaskId: "task-v318", title: "担当ボタン確認", status: "todo", kind: "normal", owner: "k", deleted: false, updatedAt: `${TODAY}T09:00:00` }
      ]
    });
    await page.locator('[data-wbs-row-id="step-v318"] .wbs-row-menu-toggle').click();
    await page.waitForSelector('[data-wbs-row-id="step-v318"] .wbs-row-menu-panel:not([hidden])');
    const wbsButtons = await page.locator('[data-wbs-row-id="step-v318"] .wbs-row-menu-panel > button').evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height, left: box.left, right: box.right };
    }));
    check("WBS行内ボタンは全て高さ44px以上で画面内", wbsButtons.length >= 4
      && wbsButtons.every((box) => box.height >= 44 && box.left >= 0 && box.right <= 391), JSON.stringify(wbsButtons));
    const wbsInlineTargets = await page.locator(".checkbox-button, .wbs-criteria-btn, .wbs-caret, .plan-owner-badge, .wbs-row-menu-toggle").evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { className: element.className, width: box.width, height: box.height, left: box.left, right: box.right };
    }));
    check("WBSの完了・条件・キャレット・担当・メニューボタンは実体が44px以上", ["checkbox-button", "wbs-criteria-btn", "wbs-caret", "plan-owner-badge", "wbs-row-menu-toggle"].every((name) =>
      wbsInlineTargets.some((target) => target.className.includes(name) && target.height >= 44 && target.width >= 44)), JSON.stringify(wbsInlineTargets));
    const taskCaret = page.locator('.wbs-caret[data-id="task-v318"]');
    await taskCaret.evaluate((caret) => caret.closest(".wbs-task-row").scrollIntoView({ block: "center" }));
    const wbsHitTargets = await taskCaret.evaluate((caret) => {
      const row = caret.closest(".wbs-task-row");
      const buttons = [caret, row.querySelector(".checkbox-button"), row.querySelector(".wbs-row-menu-toggle")];
      const boxes = buttons.map((button) => button.getBoundingClientRect());
      const hitButton = (x, y) => document.elementFromPoint(x, y)?.closest("button");
      const centers = buttons.map((button, index) => {
        const box = boxes[index];
        return hitButton(box.left + box.width / 2, box.top + box.height / 2) === button;
      });
      const gaps = boxes.slice(0, -1).map((box, index) => {
        const next = boxes[index + 1];
        const x = (box.right + next.left) / 2;
        const y = (Math.max(box.top, next.top) + Math.min(box.bottom, next.bottom)) / 2;
        const hit = document.elementFromPoint(x, y);
        return { width: next.left - box.right, x, y,
          hitClass: hit?.className || hit?.tagName || "", hitInRow: Boolean(hit && row.contains(hit)) };
      });
      return { centers, gaps };
    });
    check("WBS主操作3ボタンの各中心は自ボタンへ到達し、間隔は同じ行内",
      wbsHitTargets.centers.length === 3 && wbsHitTargets.centers.every(Boolean)
      && wbsHitTargets.gaps.length === 2 && wbsHitTargets.gaps.every((gap) => gap.width >= 0 && gap.hitInRow),
      JSON.stringify(wbsHitTargets));
    check("WBS 390pxに横スクロールなし", await noPageOverflow());
    await page.screenshot({ path: path.join(os.tmpdir(), "taskchute-v318-wbs-390.png"), fullPage: true });

    await setView("instruments");
    await page.waitForSelector(".instr-open-btn");
    const instrumentButton = await rect(page.locator(".instr-open-btn"));
    check("計器盤の遷移ボタンは44px以上", instrumentButton.height >= 44, JSON.stringify(instrumentButton));

    await setView("journal", { sleep: { logs: {} } });
    await page.waitForFunction(() => document.querySelector(".sleep-card-empty")?.textContent.includes("Apple Health: 睡眠 7h05m"));
    const sleepCard = page.locator(".sleep-card-empty");
    check("睡眠未記録は中立文言で赤系クラス・警告記号なし", (await sleepCard.textContent()).includes("前夜の睡眠: 未記録(AutoSleep CSV をアップロードすると表示)")
      && await sleepCard.locator(".danger, .error, .warning").count() === 0 && !(await sleepCard.textContent()).includes("⚠"));
    check("睡眠CSV導線を維持し、健康日次の同日睡眠を補助表示", await sleepCard.locator("input[data-sleep-csv-upload]").count() === 1
      && (await sleepCard.textContent()).includes("Apple Health: 睡眠 7h05m (23:46→06:51)"));

    await page.locator('#bottomNav [data-action="nav"][data-view="more"]').click();
    await page.locator('.more-tower-item[data-view="fund"]').click();
    await page.waitForSelector(".fund-summary");
    fundMode = "404";
    healthMode = "404";
    await page.evaluate(async () => (await import("./src/features/fund.js")).hydrateFundData(0));
    await page.locator('#bottomNav [data-action="nav"][data-view="more"]').click();
    await page.locator('.more-tower-item[data-view="fund"]').click();
    check("FUNDは前回成功後の404でも従来データを表示", await page.locator(".fund-summary").count() === 1
      && await page.locator(".fund-status").count() === 0);
    await page.reload();
    await page.waitForFunction(() => document.querySelector(".fund-status")?.textContent.includes("FUNDデータを取得できませんでした"));
    check("キャッシュ無し404は中立の失敗表示", (await page.locator(".fund-status").textContent()).includes("FUNDデータを取得できませんでした")
      && await page.locator(".fund-status.danger, .fund-status.error, .fund-status.warning").count() === 0);
    fundMode = "broken";
    await page.reload();
    await page.waitForFunction(() => document.querySelector(".fund-status")?.textContent.includes("30分後に再試行します"));
    check("キャッシュ無し壊れJSONも中立の失敗表示", (await page.locator(".fund-status").textContent()).includes("30分後に再試行します"));

    await page.evaluate(async () => (await import("./src/sync/github.js")).setSyncBanner("同期エラーA: 詳細メッセージ"));
    await page.waitForSelector(".sync-error-banner");
    const lineInfo = await page.locator(".sync-banner-message").evaluate((element) => {
      const style = getComputedStyle(element);
      return { lines: Math.ceil(element.getBoundingClientRect().height / parseFloat(style.lineHeight)), text: element.textContent };
    });
    check("同期バナーは短い文言で390px三行以内", lineInfo.lines <= 3 && lineInfo.text.includes("設定へ"), JSON.stringify(lineInfo));
    await page.locator('.sync-banner-message [data-view="settings"]').click();
    check("設定画面に同期エラー全文を中立表示", (await page.locator(".sync-error-detail").textContent()).includes("同期エラーA: 詳細メッセージ")
      && await page.locator(".sync-error-detail.danger, .sync-error-detail.error, .sync-error-detail.warning").count() === 0);
    const stateBeforeDismiss = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await page.locator('[data-action="sync-banner-dismiss"]').click();
    const dismissedA = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), DISMISS_KEY);
    check("閉じるとhash+当日だけを端末ローカルへ保存", /^[0-9a-f]{8}$/.test(dismissedA?.hash || "")
      && dismissedA?.date === TODAY && !JSON.stringify(dismissedA).includes("詳細メッセージ"), JSON.stringify(dismissedA));
    check("閉じる操作はapp stateを変更しない", await page.evaluate((key) => localStorage.getItem(key), STATE_KEY) === stateBeforeDismiss);
    await page.evaluate(async () => (await import("./src/sync/github.js")).setSyncBanner("同期エラーA: 詳細メッセージ"));
    check("同じエラーは再描画しても当日中は出ない", await page.locator(".sync-error-banner").count() === 0);
    await page.reload();
    await page.evaluate(async () => (await import("./src/sync/github.js")).setSyncBanner("同期エラーA: 詳細メッセージ"));
    check("同じエラーの当日抑止は再起動相当のreload後も維持", await page.locator(".sync-error-banner").count() === 0);
    if (!await page.locator("[data-settings-sync]").evaluate((element) => element.open)) {
      await page.locator("[data-settings-sync] > summary").click();
    }
    const autoSync = page.locator("[data-setting-autosync]");
    if (!await autoSync.isChecked()) await autoSync.check();
    await autoSync.uncheck();
    await page.locator("[data-setting-autosync]").check();
    await page.evaluate(async () => (await import("./src/sync/github.js")).setSyncBanner("同期エラーA: 詳細メッセージ"));
    check("自動同期OFF→ON後も同じエラーは当日中再表示しない", await page.locator(".sync-error-banner").count() === 0
      && await page.evaluate((key) => localStorage.getItem(key) !== null, DISMISS_KEY));
    await page.evaluate(async () => (await import("./src/sync/github.js")).setSyncBanner("同期エラーB: 内容変更"));
    check("エラー内容が変わると再表示", await page.locator(".sync-error-banner").count() === 1);
    await page.locator('[data-action="sync-banner-dismiss"]').click();
    await page.clock.setFixedTime(new Date(2026, 8, 3, 10, 0, 0, 0));
    await page.evaluate(async () => (await import("./src/sync/github.js")).setSyncBanner("同期エラーB: 内容変更"));
    check("翌日は同じエラーでも再表示", await page.locator(".sync-error-banner").count() === 1);
    await page.evaluate(async () => (await import("./src/sync/github.js")).clearSyncBanner({ clearDismissal: true }));
    check("同期成功相当のclearで閉じた記憶を消す", await page.evaluate((key) => localStorage.getItem(key) === null, DISMISS_KEY));
    check("全ケースで横スクロール・pageerrorなし", await noPageOverflow() && pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures) {
    console.error(`\n❌ v318: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\n✅ v318: all checks passed");
})().catch((error) => { console.error(error); process.exit(1); });
