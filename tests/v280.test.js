// v280: 固定化解除履歴(habitPinHistory)とINSTRUMENTSのPIN ARCHIVE。
const path = require("path");
const { pathToFileURL } = require("url");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const KEY = STATE_KEY;
const LAST_SYNCED_SHA_KEY = "taskchute-journal-last-synced-sha";
const API_HOST = "api.github.com";
const TODAY = "2026-08-27";
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

const rule = (id, title, streakSince = null, extra = {}) => ({
  id, title, category: "ルーティン", taskId: "", kind: "daily", streakSince,
  startTime: "09:00", endTime: "09:30", anchorDate: TODAY, order: 0,
  exceptionDates: [], createdAt: `${TODAY}T07:00`, updatedAt: `${TODAY}T07:00`, deleted: false,
  ...extra
});

const block = (id, ruleId, title) => ({
  id, title, recurrenceGroupId: ruleId, category: "習慣", taskId: "", date: TODAY,
  plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`, actualStartAt: "", actualEndAt: "",
  completed: false, charge: 0, discharge: 0, comment: "", createdAt: `${TODAY}T08:00`,
  updatedAt: `${TODAY}T08:00`, deleted: false
});

function contentsBodyFor(jsonText, sha) {
  return JSON.stringify({
    content: Buffer.from(jsonText, "utf-8").toString("base64"), encoding: "base64", sha
  });
}

(async () => {
  const { habitStreakPeriodStats } = await import(pathToFileURL(
    path.join(__dirname, "..", "src", "core", "habit-streak.js")
  ).href);

  console.log("[1] 期間純関数は閉区間だけで連続BEST・累計・実施率を算出");
  let stats = habitStreakPeriodStats({ kind: "daily" }, { logs: {
    "2026-08-19": { doneAt: "outside-before" },
    "2026-08-20": { doneAt: "inside" },
    "2026-08-21": { doneAt: "inside" },
    "2026-08-23": { doneAt: "inside" },
    "2026-08-24": { doneAt: "outside-after" }
  } }, "2026-08-20", "2026-08-23");
  check("境界±1日のログを混ぜずbest=2/累計=3/実施率=75%", stats.bestStreak === 2
    && stats.totalCount === 3 && stats.successRate === 75, JSON.stringify(stats));
  stats = habitStreakPeriodStats({ kind: "weekdays" }, { logs: {
    "2026-08-21": { doneAt: "fri" }, "2026-08-24": { doneAt: "mon" }
  } }, "2026-08-21", "2026-08-24");
  check("weekdaysは土日を分母から除いて金→月を2日連続とする", stats.bestStreak === 2
    && stats.totalCount === 2 && stats.successRate === 100, JSON.stringify(stats));
  stats = habitStreakPeriodStats({ kind: "weekdays" }, { logs: {
    "2026-08-24": { doneAt: "mon" }, "2026-08-26": { doneAt: "wed" }
  } }, "2026-08-24", "2026-08-26");
  check("weekdaysの対象曜日未実施は連続を切る(月達成・火未達・水達成→BEST=1)", stats.bestStreak === 1
    && stats.totalCount === 2 && stats.successRate === 67, JSON.stringify(stats));
  check("不正日付は空統計へ縮退", habitStreakPeriodStats(
    { kind: "daily" }, { logs: {} }, "2026-02-30", "2026-03-01"
  ).totalCount === 0);
  check("非うるう年2/29と4/31も空統計へ縮退", ["2025-02-29", "2026-04-31"].every((from) =>
    habitStreakPeriodStats({ kind: "daily" }, { logs: {} }, from, "2026-05-01").totalCount === 0));

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  const syncFixtures = { remoteJson: null, sha: "remote-sha-v280", puts: [], holdGet: false, releaseGet: null };
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, async (route) => {
    const request = route.request();
    if (!new URL(request.url()).pathname.endsWith("/contents/taskchute/app-state.json")) {
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
    if (request.method() === "PUT") {
      syncFixtures.puts.push(request.postData());
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "after-put-v280" } }) });
    }
    if (syncFixtures.holdGet) {
      await new Promise((resolve) => { syncFixtures.releaseGet = resolve; });
    }
    if (syncFixtures.remoteJson === null) {
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: contentsBodyFor(syncFixtures.remoteJson, syncFixtures.sha)
    });
  });

  async function seed({ recurrences = [], blocks = [], habitStreaks = {}, habitPinHistory = {}, view = "today" } = {}) {
    await page.goto(`http://localhost:${PORT}/styles.css`);
    await page.evaluate(({ KEY, recurrences, blocks, habitStreaks, habitPinHistory, view, TODAY }) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      state.recurrences = recurrences;
      state.blocks = blocks;
      state.habitStreaks = habitStreaks;
      state.habitPinHistory = habitPinHistory;
      state.currentView = view;
      state.selectedDate = TODAY;
      state.timelineMode = "planned";
      state.dataModifiedAt = `${TODAY}T06:00:00`;
      localStorage.setItem(KEY, JSON.stringify(state));
    }, { KEY, recurrences, blocks, habitStreaks, habitPinHistory, view, TODAY });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector("#app");
  }

  async function storedState() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  async function setLiveSyncState(habitPinHistory, { autoSync, dataModifiedAt, lastPushedAt }) {
    await page.evaluate(async ({ KEY, habitPinHistory, autoSync, dataModifiedAt, lastPushedAt }) => {
      const { state } = await import("./src/state/store.js");
      state.habitPinHistory = habitPinHistory;
      state.dataModifiedAt = dataModifiedAt;
      state.settings.autoSync = autoSync;
      state.settings.lastPushedAt = lastPushedAt;
      state.settings.github = {
        ...state.settings.github, token: "test-token-v280", dataOwner: "kojit1229",
        dataRepo: "personal-data", branch: "main", path: "app-state.json"
      };
      localStorage.setItem(KEY, JSON.stringify(state));
    }, { KEY, habitPinHistory, autoSync, dataModifiedAt, lastPushedAt });
  }

  async function liveState() {
    return page.evaluate(async () => JSON.parse(JSON.stringify((await import("./src/state/store.js")).state)));
  }

  try {
    await page.clock.setFixedTime(new Date(2026, 7, 27, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[2] normalizeStateは壊れ値を空補完し、正しい期間を往復保持");
    const normalization = await page.evaluate(async () => {
      const [{ state }, sync] = await Promise.all([import("./src/state/store.js"), import("./src/sync/github.js")]);
      const normalizeHistory = (habitPinHistory) => {
        const exported = JSON.parse(JSON.stringify(state));
        exported.habitPinHistory = habitPinHistory;
        return sync.normalizedRemoteCopy(JSON.stringify(exported)).habitPinHistory;
      };
      const broken = normalizeHistory({
        zBroken: null,
        aValid: [
          { from: "2026-08-01", to: "2026-08-03", kind: "weekdays" },
          { from: "2026-02-30", to: "2026-03-01" },
          { from: "2025-02-29", to: "2025-03-01" },
          { from: "2026-04-31", to: "2026-05-01" },
          { from: "2026-08-05", to: "2026-08-04" },
          null
        ],
        mBroken: "not-array"
      });
      const array = normalizeHistory([]);
      const topNull = normalizeHistory(null);
      const roundTrip = normalizeHistory({ keep: [
        { from: "2026-08-01", to: "2026-08-07", kind: "daily" },
        { from: "2026-08-08", to: "2026-08-09" },
        { from: "2026-08-10", to: "2026-08-11", kind: "legacy-kind" }
      ] });
      const remote = JSON.parse(JSON.stringify(state));
      remote.habitPinHistory = roundTrip;
      return {
        broken,
        array,
        topNull,
        roundTrip,
        equalWithDifferentHistory: sync.syncCoreEqual(sync.normalizedRemoteCopy(JSON.stringify(remote)))
      };
    });
    check("ruleIdキーをソートし非配列を空配列へ補完", Object.keys(normalization.broken).join("|")
      === "aValid|mBroken|zBroken" && normalization.broken.mBroken.length === 0 && normalization.broken.zBroken.length === 0,
    JSON.stringify(normalization.broken));
    check("不正日付・逆転期間・nullを除き正常期間だけ保持", JSON.stringify(normalization.broken.aValid)
      === JSON.stringify([{ from: "2026-08-01", to: "2026-08-03", kind: "weekdays" }]), JSON.stringify(normalization.broken.aValid));
    check("トップレベル配列は空objectへ縮退", !Array.isArray(normalization.array)
      && Object.keys(normalization.array).length === 0, JSON.stringify(normalization.array));
    check("トップレベルnullも空objectへ縮退", normalization.topNull && !Array.isArray(normalization.topNull)
      && Object.keys(normalization.topNull).length === 0, JSON.stringify(normalization.topNull));
    check("export→normalize(import相当)で任意kind・kind欠損・未知kindを保持", normalization.roundTrip.keep?.length === 3
      && normalization.roundTrip.keep[0].kind === "daily" && !("kind" in normalization.roundTrip.keep[1])
      && normalization.roundTrip.keep[2].kind === "legacy-kind", JSON.stringify(normalization));
    check("履歴差分は同期の自動解決対象にせずfail-close", normalization.equalWithDifferentHistory === false);

    console.log("[sync] habitPinHistory競合は実push/pull経路でも自動解決しない");
    const localHistory = { syncRule: [{ from: "2026-08-01", to: "2026-08-02", kind: "daily" }] };
    const remoteHistory = { syncRule: [{ from: "2026-08-03", to: "2026-08-04", kind: "daily" }] };

    await setLiveSyncState(localHistory, {
      autoSync: false, dataModifiedAt: "2026-08-27T10:00:00", lastPushedAt: "2026-08-27T09:00:00"
    });
    await page.evaluate((key) => localStorage.setItem(key, "local-sha-v280"), LAST_SYNCED_SHA_KEY);
    let remote = await liveState();
    remote.habitPinHistory = remoteHistory;
    remote.dataModifiedAt = "2026-08-27T11:00:00";
    syncFixtures.remoteJson = JSON.stringify(remote);
    syncFixtures.sha = "remote-sha-push-v280";
    syncFixtures.puts.length = 0;
    await page.evaluate(async () => (await import("./src/sync/github.js")).saveToGitHub(true));
    check("手動pushのSHA競合経路は履歴差分でPUTを中止", syncFixtures.puts.length === 0, `puts=${syncFixtures.puts.length}`);
    check("手動push中止後もローカル履歴を保持", JSON.stringify((await liveState()).habitPinHistory) === JSON.stringify(localHistory));

    await setLiveSyncState(localHistory, {
      autoSync: true, dataModifiedAt: "2026-08-27T12:00:00", lastPushedAt: "2026-08-27T09:00:00"
    });
    remote = await liveState();
    remote.habitPinHistory = remoteHistory;
    remote.dataModifiedAt = "2026-08-27T13:00:00";
    syncFixtures.remoteJson = JSON.stringify(remote);
    syncFixtures.sha = "remote-sha-auto-pull-v280";
    await page.evaluate(async () => (await import("./src/sync/github.js")).runAutoSyncPull());
    await page.locator('.sync-banner-message [data-view="settings"]').click();
    const autoPullBanner = await page.locator(".sync-error-detail").textContent();
    check("自動pullの未push競合経路は履歴差分を自動和集合しない", autoPullBanner.includes("ローカルにも未push")
      && await page.locator(".sync-error-banner").count() === 1, autoPullBanner);
    check("自動pull中止後もローカル履歴を保持", JSON.stringify((await liveState()).habitPinHistory) === JSON.stringify(localHistory));
    await page.locator('[data-action="nav"][data-view="today"]:visible').click();

    await setLiveSyncState(localHistory, {
      autoSync: false, dataModifiedAt: "2026-08-27T14:00:00", lastPushedAt: "2026-08-27T14:00:00"
    });
    remote = await liveState();
    remote.habitPinHistory = remoteHistory;
    remote.dataModifiedAt = "2027-01-02T00:00:00";
    syncFixtures.remoteJson = JSON.stringify(remote);
    syncFixtures.sha = "remote-sha-startup-v280";
    syncFixtures.holdGet = true;
    const startupGet = page.waitForRequest((request) => request.method() === "GET"
      && new URL(request.url()).pathname.endsWith("/contents/taskchute/app-state.json"));
    await page.evaluate(() => {
      window.__v280StartupSync = import("./src/sync/github.js").then((sync) => sync.syncFromGitHubOnStartup());
    });
    await startupGet;
    await page.evaluate(async () => {
      const { state } = await import("./src/state/store.js");
      state.dataModifiedAt = "2026-08-27T14:01:00";
    });
    syncFixtures.holdGet = false;
    syncFixtures.releaseGet?.();
    await page.waitForSelector(".sync-error-banner");
    await page.locator('.sync-banner-message [data-view="settings"]').click();
    await page.waitForFunction(() => document.querySelector(".sync-error-detail")?.textContent.includes("編集中に取得したため"));
    const startupBanner = await page.locator(".sync-error-detail").textContent();
    check("起動時pullの編集中競合経路も履歴差分で自動取込を中止", startupBanner.includes("自動取込を中止")
      && await page.locator(".sync-error-banner").count() === 1, startupBanner);
    check("起動時pull中止後もローカル履歴を保持", JSON.stringify((await liveState()).habitPinHistory) === JSON.stringify(localHistory));
    await page.locator('[data-action="nav"][data-view="today"]:visible').click();
    syncFixtures.remoteJson = null;
    await page.evaluate(async () => {
      const { state } = await import("./src/state/store.js");
      state.settings.autoSync = false;
      (await import("./src/sync/github.js")).clearSyncBanner();
    });

    console.log("[3] GATE解除で履歴を保存し、PIN ARCHIVEへ期間内statsを表示");
    const logs = {
      "2026-08-19": { doneAt: "before" },
      "2026-08-20": { doneAt: "inside" },
      "2026-08-21": { doneAt: "inside" },
      "2026-08-23": { doneAt: "inside" },
      "2026-08-27": { doneAt: "inside" },
      "2026-08-28": { doneAt: "after" }
    };
    await seed({
      recurrences: [
        rule("archive", "朝の読書", "2026-08-20", { order: 0 }),
        rule("active", "運動", "2026-08-25", { order: 1 })
      ],
      habitStreaks: { archive: { logs }, active: { logs: { [TODAY]: { doneAt: "active" } } } },
      view: "instruments"
    });
    check("既存HABITパネルはアクティブ2件を維持", await page.locator(".instr-habit-panel").count() === 2
      && (await page.locator(".instr-habit-panel").allTextContents()).join("|").includes("運動"));
    check("履歴0件/解除前はPIN ARCHIVEセクションごと非表示", await page.locator(".instr-pin-archive").count() === 0);
    await page.locator('.nav-button[data-view="today"]').click();
    await page.locator('[data-action="tower-gate-edit-toggle"]').click();
    await page.locator('.tower-gate-edit-row[data-rule-id="archive"] [data-action="tower-gate-streak-toggle"]').click();
    await page.waitForFunction(({ KEY, TODAY }) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      return state.recurrences.find((item) => item.id === "archive")?.streakSince === null
        && state.habitPinHistory?.archive?.[0]?.to === TODAY;
    }, { KEY, TODAY });
    let stored = await storedState();
    check("解除でfrom=固定化日/to=当日を1件push", JSON.stringify(stored.habitPinHistory.archive)
      === JSON.stringify([{ from: "2026-08-20", to: TODAY, kind: "daily" }]), JSON.stringify(stored.habitPinHistory.archive));
    await page.locator('.nav-button[data-view="instruments"]').click();
    const firstCard = page.locator('.instr-pin-archive-card[data-rule-id="archive"]').first();
    await firstCard.waitFor();
    const firstText = await firstCard.textContent();
    check("カードにタイトル・期間を表示", firstText.includes("朝の読書") && firstText.includes(`2026-08-20 〜 ${TODAY}`), firstText);
    check("期間外ログを除きbest=2/累計=4/実施率=50%", /連続BEST\s*2\s*日/.test(firstText)
      && /累計\s*4\s*回/.test(firstText) && /実施率\s*50\s*%/.test(firstText), firstText);
    await page.reload();
    await page.waitForSelector('.instr-pin-archive-card[data-rule-id="archive"]');
    check("saveState後のreloadでも解除履歴を保持", (await storedState()).habitPinHistory.archive.length === 1);

    console.log("[4] 再固定化→再解除で2件目を先頭へ追加");
    await page.locator('.nav-button[data-view="today"]').click();
    await page.locator('[data-action="tower-gate-edit-toggle"]').click();
    const archiveToggle = page.locator('.tower-gate-edit-row[data-rule-id="archive"] [data-action="tower-gate-streak-toggle"]');
    await archiveToggle.click();
    await page.waitForFunction(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).recurrences
      .find((item) => item.id === "archive")?.streakSince === TODAY, { KEY, TODAY });
    await page.locator('.tower-gate-edit-row[data-rule-id="archive"] [data-action="tower-gate-streak-toggle"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).habitPinHistory.archive.length === 2, KEY);
    await page.locator('.nav-button[data-view="instruments"]').click();
    const archiveCards = page.locator('.instr-pin-archive-card[data-rule-id="archive"]');
    check("同じruleの履歴を2件表示", await archiveCards.count() === 2);
    check("新しい固定化期間(当日〜当日)が先頭", (await archiveCards.first().textContent()).includes(`${TODAY} 〜 ${TODAY}`));

    console.log("[5] 未固定ルールの通常保存は偽履歴を作らない");
    await seed({
      recurrences: [rule("unfixed", "未固定ルーティン")],
      blocks: [block("unfixed-block", "unfixed", "未固定ルーティン")], view: "timeline"
    });
    await page.locator('[data-action="edit-block"][data-id="unfixed-block"]').evaluate((element) => element.click());
    await page.locator('[data-action="modal-save"]').click();
    stored = await storedState();
    check("streakSince=nullの通常保存で履歴0件", !stored.habitPinHistory?.unfixed?.length, JSON.stringify(stored.habitPinHistory));

    console.log("[6] Block編集モーダル解除はto=当日で1件保存しreload後も保持");
    await seed({
      recurrences: [rule("modal", "モーダル習慣", "2026-08-25", { category: "習慣" })],
      blocks: [block("modal-block", "modal", "モーダル習慣")], view: "timeline"
    });
    await page.locator('[data-action="edit-block"][data-id="modal-block"]').evaluate((element) => element.click());
    await page.waitForSelector('[data-modal-field="streakFixed"]');
    await page.locator('[data-modal-field="streakFixed"]').uncheck();
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).habitPinHistory?.modal?.length === 1, KEY);
    stored = await storedState();
    check("Block編集モーダル解除も期間を1件push", stored.habitPinHistory.modal[0].from === "2026-08-25"
      && stored.habitPinHistory.modal[0].to === TODAY && stored.habitPinHistory.modal[0].kind === "daily",
    JSON.stringify(stored.habitPinHistory.modal));
    await page.reload();
    await page.waitForSelector("#app");
    check("Blockモーダル解除履歴はreload後も1件保持", (await storedState()).habitPinHistory.modal.length === 1);

    console.log("[7] GATE削除・シリーズ終了・kind変更で各1件だけ期間を閉じる");
    await seed({ recurrences: [rule("gate-delete", "削除ゲート", "2026-08-20")], view: "today" });
    await page.locator('[data-action="tower-gate-edit-toggle"]').click();
    await page.locator('.tower-gate-edit-row[data-rule-id="gate-delete"] [data-action="tower-gate-delete"]').click();
    await page.waitForFunction((KEY) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      return state.recurrences.find((item) => item.id === "gate-delete")?.deleted
        && state.habitPinHistory?.["gate-delete"]?.length === 1;
    }, KEY);
    check("GATE削除で履歴1件", (await storedState()).habitPinHistory["gate-delete"][0].kind === "daily");

    await seed({
      recurrences: [rule("series-end", "終了ルーティン", "2026-08-21", { category: "習慣" })],
      blocks: [block("series-end-block", "series-end", "終了ルーティン")], view: "timeline"
    });
    await page.locator('[data-action="edit-block"][data-id="series-end-block"]').evaluate((element) => element.click());
    await page.locator('[data-modal-field="recurrenceKind"]').selectOption("__end__");
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).habitPinHistory?.["series-end"]?.length === 1, KEY);
    stored = await storedState();
    check("Blockモーダルのシリーズ終了で履歴1件", stored.recurrences.find((item) => item.id === "series-end")?.deleted
      && stored.habitPinHistory["series-end"][0].from === "2026-08-21");

    await seed({
      recurrences: [rule("kind-change", "種別変更", "2026-08-22", { category: "習慣" })],
      blocks: [block("kind-change-block", "kind-change", "種別変更")], view: "timeline"
    });
    await page.locator('[data-action="edit-block"][data-id="kind-change-block"]').evaluate((element) => element.click());
    await page.locator('[data-modal-field="recurrenceKind"]').selectOption("weekly");
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForFunction((KEY) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      const changed = state.recurrences.find((item) => item.id === "kind-change");
      return changed?.kind === "weekly" && changed.streakSince === null
        && state.habitPinHistory?.["kind-change"]?.length === 1;
    }, KEY);
    stored = await storedState();
    check("daily→weekly変更で解除時dailyを記録", stored.habitPinHistory["kind-change"][0].kind === "daily");

    await seed({ recurrences: [rule("unpin-delete", "解除後削除", "2026-08-23")], view: "today" });
    await page.locator('[data-action="tower-gate-edit-toggle"]').click();
    await page.locator('.tower-gate-edit-row[data-rule-id="unpin-delete"] [data-action="tower-gate-streak-toggle"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).habitPinHistory?.["unpin-delete"]?.length === 1, KEY);
    await page.locator('.tower-gate-edit-row[data-rule-id="unpin-delete"] [data-action="tower-gate-delete"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).recurrences
      .find((item) => item.id === "unpin-delete")?.deleted, KEY);
    check("解除→削除の順でも履歴は重複せず1件", (await storedState()).habitPinHistory["unpin-delete"].length === 1);

    console.log("[8] 複数ruleの履歴はto降順で並び、キーあり0件ではセクション非表示");
    await seed({ habitPinHistory: { emptyRule: [] }, view: "instruments" });
    check("{ ruleId: [] }はPIN ARCHIVEセクションごと非表示", await page.locator(".instr-pin-archive").count() === 0);
    await page.evaluate(async () => {
      const { state } = await import("./src/state/store.js");
      state.habitPinHistory = { reversed: [{ from: "2026-08-10", to: "2026-08-09" }] };
    });
    await page.locator('.nav-button[data-view="today"]').click();
    await page.locator('.nav-button[data-view="instruments"]').click();
    check("normalizeを介さない逆転期間も表示側ガードで非表示", await page.locator(".instr-pin-archive").count() === 0);
    await seed({
      habitPinHistory: {
        old: [{ from: "2026-08-01", to: "2026-08-02" }],
        newest: [{ from: "2026-08-20", to: "2026-08-21" }],
        middle: [{ from: "2026-08-10", to: "2026-08-11" }]
      }, view: "instruments"
    });
    const archiveOrder = await page.locator(".instr-pin-archive-card").evaluateAll((cards) =>
      cards.map((card) => card.dataset.ruleId));
    check("複数rule横断で新しい履歴からDOM配置", archiveOrder.join("|") === "newest|middle|old", archiveOrder.join("|"));

    console.log("[9] 履歴kind優先の統計と削除済みタイトルフォールバック");

    await seed({
      recurrences: [
        rule("deleted", "終了した読書", null, { deleted: true }),
        rule("historical-kind", "旧平日習慣", null, { kind: "daily" })
      ],
      habitPinHistory: {
        deleted: [{ from: "2026-08-01", to: "2026-08-02" }],
        missing: [{ from: "2026-08-03", to: "2026-08-04" }],
        "historical-kind": [{ from: "2026-08-21", to: "2026-08-24", kind: "weekdays" }]
      },
      habitStreaks: {
        deleted: { logs: {} }, missing: { logs: {} },
        "historical-kind": { logs: { "2026-08-21": { doneAt: "fri" }, "2026-08-24": { doneAt: "mon" } } }
      }, view: "instruments"
    });
    const historicalKindText = await page.locator('.instr-pin-archive-card[data-rule-id="historical-kind"]').textContent();
    check("現在ruleがdailyでも履歴weekdaysを優先して金→月をBEST=2", /連続BEST\s*2\s*日/.test(historicalKindText), historicalKindText);
    check("論理削除ルールはrecurrencesから元タイトルを逆引き", (await page.locator(
      '.instr-pin-archive-card[data-rule-id="deleted"]'
    ).textContent()).includes("終了した読書"));
    check("recurrencesに無いルールは削除済みフォールバック", (await page.locator(
      '.instr-pin-archive-card[data-rule-id="missing"]'
    ).textContent()).includes("(削除済みルーティン)"));
    await page.setViewportSize({ width: 390, height: 844 });
    const narrow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    check("390pxのPIN ARCHIVEでページ横スクロールなし", narrow.scroll <= narrow.client, JSON.stringify(narrow));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nv280: 全件成功" : `\nv280: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
