// sync-load-confirm-snapshot.test.js — unit15(A2-H4/D-K6)+差し戻し(独立レビュー2026-09-04)回帰テスト。
//
// [PART A] loadFromGitHub()(src/sync/github.js)の制御フローをNode直接importで検証する
// (store-core.test.jsと同じ手法。configureGithubSync(deps)でapp.js側依存を注入するため、
// ブラウザ・fetch実物・localStorageが無いNode環境でも本物のloadFromGitHubを直接動かせる)。
//   (b) diffCount(SYNC_CORE_COMPARE_KEYS基準)が0ならconfirmもスナップショットも出さない。
//   confirmキャンセルならstateを一切変更せず中断する。
//   confirmでOKなら、writeBackupSnapshotBeforeLoad(注入された依存)を呼んでから採用する。
//   (c) writeBackupSnapshotBeforeLoadが失敗(例外 or false)ならfail-close(採用せず中断)。
//     PUT 403相当(例外)とpersonalDataReady=false相当(false復帰)の両方を、github.js側の
//     契約(注入関数の成否だけで分岐する)として検証する。実際のPUT/personalDataReadyの
//     判定そのもの(2つの失敗モードの違い)はPART Bでapp.js実物を使って検証する。
//   (d) 採用成功時にsettings.lastPushedAtを採用したdataModifiedAtに揃える。
//
// [PART B] app.js実物 + ブラウザ + fetchモックで、PART Aでは検証できないapp.js側の実装
// (writeBackupSnapshotBeforeLoadの実体)を検証する。
//   (a) 採用直前の控えは通常の日次世代とは別名(app-state-YYYY-MM-DD-preload-HHMMSS.json)。
//       同日に2回OKで読み込むと、2つの別ファイルとして残る(1回目を上書きしない)。
//       restoreBackupの一覧(listBackups)からも両方拾えることを確認する。
//   (c) 実際のPUT失敗(403)と、personalDataReady=false(ダウンロード待ち中に設定が
//       クリアされる競合)の両方が、fail-closeで読込を中止しstateを変えないことを確認する。
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, openSettingsGroup } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const STORE_PATH = path.join(ROOT, "src", "state", "store.js");
const SYNC_PATH = path.join(ROOT, "src", "sync", "github.js");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// ===================== PART A: Node直接import(制御フロー) =====================
function noop() {}

// store-core.test.jsのbaseState()と同じ形(SYNC_CORE_COMPARE_KEYSの21キー+マージ対象
// コレクションを一式そろえた最小state)。local/remoteをこの関数からクローンして作ることで、
// 「どのキーを変えたか」だけで差分を制御できる。
function baseState(extra) {
  return {
    journalMeta: {},
    settings: {
      journalTemplate: "", morningEnergyLog: {}, github: { token: "t", dataOwner: "o", dataRepo: "r" },
      avoidList: [], categories: [], lifeAreas: [], vision: "", affirmation: "",
      twelveWeekStartDate: "", twelveWeekScoreTarget: 85, birthDate: "", battery: {},
      gymExerciseList: [], visionDirectCategories: [], lastPushedAt: ""
    },
    journals: {}, feedback: {}, condition: { logs: {} }, sleep: { logs: {} },
    blocks: [], zeroThinking: { entries: [], suggestedThemes: [] },
    dailyDeclarations: {}, weeklyWishes: {}, bodyScans: [], tasks: [], projects: [], storeVisits: [],
    swipeTriageLog: [], gardenLog: {},
    // computeSyncMerge()が参照する残りのマージ対象コレクション(欠けているとmergeById等が
    // 例外を投げ、computeSyncMergeが内部でフォールバック=nullへ倒れる。動作自体は
    // フォールバック経路でも壊れないが、実際のマージ経路を通す方が本番挙動に忠実なため揃える)。
    writeMeditations: [], aiStepProcessedIds: [], aiStepDismissedIds: [], aiReportReadIds: [],
    aiStepPendingRequests: [], coachLog: { meals: [] }, tracks: [], trackMeasurements: [], weeklyCommitments: [],
    recurrences: ["r1"], declarations: ["d1"], questions: ["q1"], experiments: ["e1"],
    earlyBird: {}, habitStreaks: {}, habitPinHistory: {},
    reports: {}, chainRuns: [], aiScheduleHistory: [], feedbackFiles: [], feedbackIngestedDates: [],
    migrationRitualLog: [], zeroSecThemeLog: [], aiWorkProcessedIds: [], ironImport: {},
    dataModifiedAt: "2026-07-28T08:00:00",
    ...extra
  };
}

async function loadModules() {
  const storeMod = await import(pathToFileURL(STORE_PATH).href);
  const syncMod = await import(pathToFileURL(SYNC_PATH).href);
  return { storeMod, syncMod };
}

// downloadGitHubStateText()が読む本文(remoteObj)をfromBase64=identityスタブ前提でそのまま返す
// fetchスタブ。writeBackupSnapshotBeforeLoad自体はconfigureGithubSyncの注入関数として
// 差し替えるため、このfetchスタブはメインファイルのGETだけ相手にすればよい。
// persistLocalNoSchedule/setLastSyncedSha等がlocalStorage.setItem/getItemを呼ぶ
// (いずれもtry/catchで安全に無視される設計だが、テスト出力のノイズを減らすため
// 簡易的なメモリ内polyfillを与えておく)。
function installMemoryLocalStorage() {
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
}

function installNodeStubs(syncMod, { remoteBodyText, confirmReturn = true, snapshotImpl }) {
  installMemoryLocalStorage();
  const calls = { confirm: [], toast: [], snapshotCalls: 0 };
  global.window = global.window || {};
  global.window.confirm = (msg) => { calls.confirm.push(msg); return confirmReturn; };
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ content: remoteBodyText, encoding: "base64", sha: "sha-remote-1" })
  });
  syncMod.configureGithubSync({
    normalizeState: (x) => x,
    nowDateTime: () => "2026-09-04T23:00:00",
    todayISO: () => "2026-09-04",
    addDays: (d) => d,
    isTouchedBlock: () => false,
    RECURRENCE_KEEP_PAST_DAYS: 7,
    RECURRENCE_FUTURE_DAYS: 31,
    SWIPE_TRIAGE_LOG_MAX: 200,
    showToast: (msg) => calls.toast.push(msg),
    maintainRecurrences: noop, render: noop, runDailyOpen: () => false, saveState: noop,
    requireGitHubConfig: () => ({ owner: "o", repo: "r", branch: "main", token: "t" }),
    fetchGitHubFileSHA: async () => "sha", personalDataReady: () => true,
    personalDataFileConfig: (c) => c,
    gitHubContentsURL: () => "https://api.github.com/fake/contents", githubHeaders: () => ({}),
    gitHubErrorMessage: async (r) => `HTTP ${r.status}`,
    fromBase64: (x) => x, toBase64: (x) => x,
    sanitizedStateForGitHub: () => ({}), maybeWriteBackupSnapshot: async () => {},
    writeBackupSnapshotBeforeLoad: async (...args) => {
      calls.snapshotCalls++;
      if (snapshotImpl) return snapshotImpl(...args);
      return true;
    },
    updateAutoSaveStatus: noop, updateSyncDot: noop,
    renderSyncBanner: noop, clearSyncBannerDismissal: noop, clearPersonalDataAuthError: noop,
    pruneExpiredSuggestedThemes: (x) => x,
    _startupDataModifiedAt: ""
  });
  return calls;
}

async function runPartA() {
  const { storeMod, syncMod } = await loadModules();

  // ---- (b)+(d): diffCount===0 → confirmもスナップショットも出さず、採用後lastPushedAtが揃う ----
  console.log("[A-1] diffCount0(コア一致): confirmを出さず読み込み、採用後lastPushedAt===dataModifiedAt");
  {
    const local = baseState({ reports: { "2026-07-01": "同じ内容" } });
    storeMod.setState(local);
    const remoteObj = JSON.parse(JSON.stringify(local));  // ディープクローン: コア・マージ対象とも完全一致
    remoteObj.dataModifiedAt = "2026-09-05T00:00:00";       // 新しさの違いだけ
    const calls = installNodeStubs(syncMod, { remoteBodyText: JSON.stringify(remoteObj) });
    await syncMod.loadFromGitHub();
    check("diffCount0のときconfirmは呼ばれない", calls.confirm.length === 0, JSON.stringify(calls.confirm));
    check("diffCount0のときスナップショットも呼ばれない", calls.snapshotCalls === 0, String(calls.snapshotCalls));
    check("採用は従来どおり行われる(dataModifiedAtがリモートの値)",
      storeMod.state.dataModifiedAt === "2026-09-05T00:00:00", storeMod.state.dataModifiedAt);
    check("(d) 採用後lastPushedAtがdataModifiedAtに揃う(addedLocalが無いクリーンな採用のため)",
      storeMod.state.settings.lastPushedAt === storeMod.state.dataModifiedAt,
      `lastPushedAt=${storeMod.state.settings.lastPushedAt} dataModifiedAt=${storeMod.state.dataModifiedAt}`);
  }

  // diff>0の共通フィクスチャ(aiScheduleHistoryだけ差をつける。unit14bでreports/chainRuns等7キー
  // が和集合マージ対象へ移りSYNC_CORE_COMPARE_KEYSから外れたため、fail-close比較のまま残る
  // aiScheduleHistoryを使う。マージ対象コレクションは完全一致のまま保つことで、後続のOKテストでも
  // addedLocal=falseになりlastPushedAt検証を併用できる)。
  function makeDiffFixtures() {
    const local = baseState({ aiScheduleHistory: [{ source: "local", reason: "" }] });
    const remoteObj = JSON.parse(JSON.stringify(local));
    remoteObj.aiScheduleHistory = [{ source: "remote", reason: "" }];  // SYNC_CORE_COMPARE_KEYSの1キーだけ差分
    remoteObj.dataModifiedAt = "2026-09-05T00:00:00";
    return { local, remoteObj };
  }

  // ---- confirmキャンセル: state不変 ----
  console.log("[A-2] diffCount>0 + confirmキャンセル: stateを一切変更せず中断する");
  {
    const { local, remoteObj } = makeDiffFixtures();
    storeMod.setState(local);
    const calls = installNodeStubs(syncMod, { remoteBodyText: JSON.stringify(remoteObj), confirmReturn: false });
    await syncMod.loadFromGitHub();
    check("confirmが呼ばれている", calls.confirm.length === 1, JSON.stringify(calls.confirm));
    check("キャンセル後もstate.aiScheduleHistoryはローカルのまま(state不変)",
      storeMod.state.aiScheduleHistory[0].source === "local", JSON.stringify(storeMod.state.aiScheduleHistory));
    check("キャンセル後はスナップショット関数を呼ばない", calls.snapshotCalls === 0, String(calls.snapshotCalls));
    check("中止トースト", calls.toast.some((t) => t.includes("中止")), JSON.stringify(calls.toast));
  }

  // ---- confirm OK: スナップショットを呼んでから採用し、lastPushedAtも揃う ----
  console.log("[A-3] diffCount>0 + confirmでOK: スナップショット関数を呼んでから採用する");
  {
    const { local, remoteObj } = makeDiffFixtures();
    storeMod.setState(local);
    const calls = installNodeStubs(syncMod, { remoteBodyText: JSON.stringify(remoteObj), confirmReturn: true });
    await syncMod.loadFromGitHub();
    check("スナップショット関数が1回呼ばれる", calls.snapshotCalls === 1, String(calls.snapshotCalls));
    check("OK後は採用される(state.aiScheduleHistoryがリモートの内容)",
      storeMod.state.aiScheduleHistory[0].source === "remote", JSON.stringify(storeMod.state.aiScheduleHistory));
    check("(d) 採用後lastPushedAtがdataModifiedAtに揃う",
      storeMod.state.settings.lastPushedAt === storeMod.state.dataModifiedAt,
      `lastPushedAt=${storeMod.state.settings.lastPushedAt} dataModifiedAt=${storeMod.state.dataModifiedAt}`);
  }

  // ---- (c) スナップショット関数が例外(PUT 403相当) → fail-close ----
  console.log("[A-4] スナップショット失敗(例外・PUT 403相当): 採用せず中断しstateは不変");
  {
    const { local, remoteObj } = makeDiffFixtures();
    storeMod.setState(local);
    const calls = installNodeStubs(syncMod, {
      remoteBodyText: JSON.stringify(remoteObj), confirmReturn: true,
      snapshotImpl: async () => { throw new Error("HTTP 403"); }
    });
    await syncMod.loadFromGitHub();
    check("スナップショット関数は呼ばれた(=PUTは試みられた)", calls.snapshotCalls === 1, String(calls.snapshotCalls));
    check("失敗後もstate.aiScheduleHistoryはローカルのまま(state不変)",
      storeMod.state.aiScheduleHistory[0].source === "local", JSON.stringify(storeMod.state.aiScheduleHistory));
    check("控えを保存できなかった旨のトースト", calls.toast.some((t) => t.includes("控えを保存できなかった")), JSON.stringify(calls.toast));
  }

  // ---- (c) スナップショット関数がfalseを返す(personalDataReady=false相当) → fail-close ----
  console.log("[A-5] スナップショット不可(false復帰・personalDataReady=false相当): 採用せず中断しstateは不変");
  {
    const { local, remoteObj } = makeDiffFixtures();
    storeMod.setState(local);
    const calls = installNodeStubs(syncMod, {
      remoteBodyText: JSON.stringify(remoteObj), confirmReturn: true,
      snapshotImpl: async () => false
    });
    await syncMod.loadFromGitHub();
    check("スナップショット関数は呼ばれた", calls.snapshotCalls === 1, String(calls.snapshotCalls));
    check("失敗後もstate.aiScheduleHistoryはローカルのまま(state不変)",
      storeMod.state.aiScheduleHistory[0].source === "local", JSON.stringify(storeMod.state.aiScheduleHistory));
    check("控えを保存できなかった旨のトースト", calls.toast.some((t) => t.includes("控えを保存できなかった")), JSON.stringify(calls.toast));
  }

  // ---- unit14b差し戻し: LOSS_RISK_KEYS(SYNC_CORE_COMPARE_KEYS + routineChains/weeklyReviews/
  // cycleReviews)基準のdiffCount。routineChains/weeklyReviews/cycleReviewsはcomputeSyncMergeの
  // マージ対象外(store-core.test.js [B-2][B-3]の既知リスク)でリモート採用時に無警告に消えうるが、
  // SYNC_CORE_COMPARE_KEYS(fail-close比較)自体には入っていないため、これらの3キーだけの差分では
  // syncCoreEqualはtrueのまま(=単位14/14bの自動解決経路の頻度は変えない)。それでも
  // loadFromGitHubのconfirmはLOSS_RISK_KEYSで広く見ているため、weeklyReviewsだけの差分でも
  // 確認ダイアログが出ることを固定する。
  console.log("[A-6] weeklyReviewsだけの差分でもLOSS_RISK_KEYS基準でconfirmが出る(SYNC_CORE_COMPARE_KEYSは増やさない)");
  {
    const local = baseState({ weeklyReviews: { "2026-W30": { text: "ローカルのレビュー" } } });
    storeMod.setState(local);
    const remoteObj = JSON.parse(JSON.stringify(local));
    remoteObj.weeklyReviews = { "2026-W30": { text: "リモートのレビュー" } };  // LOSS_RISK_KEYSの1キーだけ差分
    remoteObj.dataModifiedAt = "2026-09-05T00:00:00";
    check(
      "前提: syncCoreEqual(SYNC_CORE_COMPARE_KEYS基準)はweeklyReviewsを見ないのでtrueのまま",
      syncMod.syncCoreEqual(remoteObj) === true
    );
    const calls = installNodeStubs(syncMod, { remoteBodyText: JSON.stringify(remoteObj), confirmReturn: true });
    await syncMod.loadFromGitHub();
    check("weeklyReviewsだけの差分でもconfirmが呼ばれる(LOSS_RISK_KEYS基準)", calls.confirm.length === 1, JSON.stringify(calls.confirm));
    check("confirm文言のコア項目件数は1件以上(LOSS_RISK_KEYS差分を検出)", /コア項目\s*[1-9]\d*件/.test(calls.confirm[0] || ""), calls.confirm[0]);
  }

  console.log(failures === 0 ? "\n[PART A] 全件成功" : `\n[PART A] ${failures}件失敗`);
}

// ===================== PART B: ブラウザ + app.js実物(writeBackupSnapshotBeforeLoad本体) =====================
async function runPartB() {
  const PORT = randomPort();
  const KEY = "taskchute-journal-pwa-state-v1";
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const REMOTE_MARKER = "リモート編集_v15Btest";

  // aiScheduleHistoryを差分ドライバに使う(unit14bでreports/chainRuns等7キーは和集合マージ対象へ
  // 移りSYNC_CORE_COMPARE_KEYSから外れたため、fail-close比較のまま残るaiScheduleHistoryを使う)。
  function remoteStateJSON(dataModifiedAt, todayForOpen, aiScheduleReason) {
    return JSON.stringify({
      dataModifiedAt, currentView: "settings", selectedDate: "2026-07-28",
      blocks: [{
        id: "remote-block-v15b", taskId: "", date: "2026-07-28", title: REMOTE_MARKER, category: "",
        plannedStartAt: "2026-07-28T09:00:00", plannedEndAt: "2026-07-28T09:30:00",
        actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
        pomodoroCount: 0, migratedTo: "", carryCount: 0, orderIndex: 0,
        createdAt: dataModifiedAt, updatedAt: dataModifiedAt, deleted: false
      }],
      aiScheduleHistory: [{ source: "remote", reason: aiScheduleReason }],
      projects: [], tasks: [], settings: { lastOpenedDate: todayForOpen }
    });
  }

  async function todayForOpen() {
    return page.evaluate(() => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    });
  }

  async function gotoSettings() {
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(200);
    await openSettingsGroup(page, "settings-sync");
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  // diffCount>0を作るため、ローカルのaiScheduleHistoryをリモートと変えておく
  // (unit14bでreportsは和集合マージ対象へ移りSYNC_CORE_COMPARE_KEYSから外れたため、
  // fail-close比較のまま残るaiScheduleHistoryを使う)。
  async function seedLocalDiff() {
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.aiScheduleHistory = [{ source: "local", reason: "ローカルの選択_v15Btest" }];
      s.currentView = "settings";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await gotoSettings();
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(400);
    await passGithubGate(page);
    await seedLocalDiff();

    // ===================== [B-1] PUT 403(実際のバックアップPUT失敗) =====================
    console.log("[B-1] backups PUTが403: 読込を中止しstateは不変(app.js実物のwriteBackupSnapshotBeforeLoad)");
    {
      const today = await todayForOpen();
      const remoteBody = remoteStateJSON("2026-09-05T00:00:00", today, "リモートの日報_v15Btest");
      await page.evaluate(({ remoteBody }) => {
        window.__ghCalls = [];
        window.confirm = () => true;
        window.fetch = (url, opts = {}) => {
          const u = String(url); const method = opts.method || "GET";
          window.__ghCalls.push({ url: u, method });
          if (u.includes("/contents/taskchute/app-state.json") && method === "GET") {
            const content = btoa(unescape(encodeURIComponent(remoteBody)));
            return Promise.resolve(new Response(JSON.stringify({ sha: "sha-remote-1", content, encoding: "base64" }), { status: 200 }));
          }
          if (u.includes("/contents/taskchute/backups/app-state-") && method === "PUT") {
            return Promise.resolve(new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }));
          }
          return Promise.resolve(new Response("{}", { status: 200 }));
        };
      }, { remoteBody });
      const before = await stateNow();
      await page.click('[data-action="load-github"]');
      await page.waitForTimeout(600);
      const after = await stateNow();
      const calls = await page.evaluate(() => window.__ghCalls);
      check("バックアップPUTは実際に試みられた(403で失敗)",
        calls.some((c) => c.method === "PUT" && c.url.includes("/contents/taskchute/backups/")), JSON.stringify(calls));
      check("403失敗後もリモートのBlockは取り込まれていない(採用せず中止)",
        !after.blocks.some((b) => b.title === REMOTE_MARKER), JSON.stringify((after.blocks || []).map((b) => b.title)));
      check("403失敗後もdataModifiedAtは変化しない(state不変)", after.dataModifiedAt === before.dataModifiedAt,
        `${before.dataModifiedAt} -> ${after.dataModifiedAt}`);
    }

    // ===================== [B-2] personalDataReady=false(ダウンロード待ち中に設定がクリアされる) =====================
    console.log("[B-2] ダウンロード待ち中にtokenが空になる(personalDataReady=false相当): PUTを試みずに中止する");
    await seedLocalDiff();
    {
      const today = await todayForOpen();
      const remoteBody = remoteStateJSON("2026-09-05T00:00:00", today, "リモートの日報_v15Btest");
      await page.evaluate(({ remoteBody }) => {
        window.__ghCalls = [];
        window.confirm = () => true;
        // ダウンロードのGETはこのgateが解放されるまで待つ(Nodeから明示的に解放する)。
        window.__downloadGate = new Promise((resolve) => { window.__releaseDownload = resolve; });
        window.fetch = (url, opts = {}) => {
          const u = String(url); const method = opts.method || "GET";
          window.__ghCalls.push({ url: u, method });
          if (u.includes("/contents/taskchute/app-state.json") && method === "GET") {
            const content = btoa(unescape(encodeURIComponent(remoteBody)));
            return window.__downloadGate.then(() =>
              new Response(JSON.stringify({ sha: "sha-remote-1", content, encoding: "base64" }), { status: 200 }));
          }
          return Promise.resolve(new Response("{}", { status: 200 }));
        };
      }, { remoteBody });
      // クリック(requireGitHubConfig()がDOMのtoken欄を読むのはこの時点。まだ有効な値のまま)。
      await page.click('[data-action="load-github"]');
      await page.waitForTimeout(150);
      // ダウンロード待ち(gate未解放)の間に、設定画面のtoken欄を空にする
      // (input/changeハンドラでstate.settings.github.tokenが即座に空へ更新される)。
      await page.fill('[data-github-field="token"]', "");
      await page.waitForTimeout(100);
      // ここでダウンロードを解放し、writeBackupSnapshotBeforeLoadに到達させる。
      await page.evaluate(() => window.__releaseDownload());
      await page.waitForTimeout(600);
      const after = await stateNow();
      const calls = await page.evaluate(() => window.__ghCalls);
      check("token空(personalDataReady=false)のときバックアップPUTは試みられない(早期return)",
        !calls.some((c) => c.method === "PUT" && c.url.includes("/contents/taskchute/backups/")), JSON.stringify(calls));
      check("personalDataReady=false後もリモートのBlockは取り込まれていない",
        !after.blocks.some((b) => b.title === REMOTE_MARKER), JSON.stringify((after.blocks || []).map((b) => b.title)));
      // 後続テストのためtoken欄を戻す
      await page.fill('[data-github-field="token"]', "test-token-v72");
      await page.waitForTimeout(200);
    }

    // ===================== [B-3] 同日2回のOK読込 → 別ファイルとして両方残る =====================
    console.log("[B-3] 同日2回OKで読み込むと、控えが別名(preload-HHMMSS)で2件とも残る(restoreBackupの一覧からも拾える)");
    {
      // 各回のPUT URLはNode側配列で集計する(window変数はokLoadOnce内のreload/seedLocalDiffで
      // 消えるため、ページ側の状態には依存しない)。
      const putUrls = [];
      async function okLoadOnce(reportsSuffix) {
        await seedLocalDiff();
        const today = await todayForOpen();
        const remoteBody = remoteStateJSON("2026-09-05T00:00:00", today, `リモートの日報_${reportsSuffix}`);
        await page.evaluate(({ remoteBody }) => {
          window.confirm = () => true;
          window.__lastPutUrl = "";
          window.fetch = (url, opts = {}) => {
            const u = String(url); const method = opts.method || "GET";
            if (u.includes("/contents/taskchute/app-state.json") && method === "GET") {
              const content = btoa(unescape(encodeURIComponent(remoteBody)));
              return Promise.resolve(new Response(JSON.stringify({ sha: "sha-remote-1", content, encoding: "base64" }), { status: 200 }));
            }
            if (u.includes("/contents/taskchute/backups/app-state-") && method === "PUT") {
              window.__lastPutUrl = u;
              return Promise.resolve(new Response(JSON.stringify({ content: { sha: "sha-bk" } }), { status: 200 }));
            }
            return Promise.resolve(new Response("{}", { status: 200 }));
          };
        }, { remoteBody });
        await page.click('[data-action="load-github"]');
        await page.waitForTimeout(600);
        const putUrl = await page.evaluate(() => window.__lastPutUrl);
        if (putUrl) putUrls.push(putUrl);
      }

      await okLoadOnce("A");
      // 同一秒でのファイル名衝突を避けるため1.2秒あける(writeBackupSnapshotBeforeLoadは
      // 実時刻のHHMMSSでファイル名を作るため)。
      await page.waitForTimeout(1200);
      await okLoadOnce("B");

      check("2回とも別々のPUT URL(=別ファイル)になる", putUrls.length === 2 && putUrls[0] !== putUrls[1], JSON.stringify(putUrls));
      check("両方ともpreload-HHMMSSサフィックス付きのファイル名", putUrls.every((u) => /-preload-\d{6}\.json/.test(u)), JSON.stringify(putUrls));

      // restoreBackupの一覧(openBackupListModal→listBackups)からも両方拾えることを確認する
      // (2回分のPUT URLから、実際にwriteBackupSnapshotBeforeLoadが書いたファイル名を再構成して
      // ディレクトリ一覧のfixtureにする)。
      const backupFiles = putUrls.map((u, i) => ({
        name: decodeURIComponent(u.split("/contents/taskchute/backups/")[1]),
        sha: `sha-bk-${i}`
      }));
      await page.evaluate((backupFiles) => {
        window.fetch = (url, opts = {}) => {
          const u = String(url); const method = opts.method || "GET";
          if (u.match(/\/contents\/taskchute\/backups\?/) && method === "GET") {
            return Promise.resolve(new Response(JSON.stringify(backupFiles), { status: 200 }));
          }
          return Promise.resolve(new Response("{}", { status: 200 }));
        };
      }, backupFiles);
      await openSettingsGroup(page, "settings-sync");
      await page.click('[data-action="open-backup-list"]');
      await page.waitForTimeout(500);
      const rowCount = await page.locator(".backup-row").count();
      check("バックアップ一覧モーダルに2件表示される(preload控えも一覧から拾える)", rowCount === 2, String(rowCount));
      await page.evaluate(() => document.querySelector('[data-action="modal-close"]')?.click());
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n[PART B] 全件成功" : `\n[PART B] ${failures}件失敗`);
}

(async () => {
  await runPartA();
  await runPartB();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
