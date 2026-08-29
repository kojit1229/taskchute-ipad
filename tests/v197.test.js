// v197 検証: AI秘書化「第3弾3d」(データ層。phase3-design.md §8 3d)。
// 対象: makeTaskの新フィールド既定値(aiSummary/aiQuestion/aiStepRequestId/aiStepRequestedAt)、
// normalizeStateのstate直下3コレクション(aiStepProcessedIds/aiStepDismissedIds/
// aiStepPendingRequests)の型正規化+決定論剪定、computeSyncMergeへのこの3コレクションの
// マージ追随(集合和/requestIdキー和集合)。
// トリガー・送受信UI・引き継ぎシートは後続単位(3e/3f+3g)のため本テストの対象外。
// v291孤児掃除(低優先度棚卸しK裁定2026-08-29): 時刻パーサparseAiStepIsoToMsは実装から
// 2バージョン以上経過しても呼び出し元が付かなかったため(本人のテストコメントが
// 「まだ呼び出し元が無い純粋関数」と自己申告済み)、旧Part 0の専用テスト区間ごとapp.js側の
// 関数本体を削除した(Test-Reduction: 検証対象自体が消滅したための削減、移行先はない)。
//
// Part A: makeTask新フィールドの既定値(null)。
// Part B: normalizeStateの型正規化(配列でなければ[]/要素の形が不正なら捨てる)+
//   保留台帳の決定論剪定(processed/dismissedに入ったrequestIdは消える)。
// Part C: computeSyncMergeへの3コレクションのマージ追随(C-5回帰: タスク等は完全に同一で
//   この3コレクションだけに差がある入力でも、changedVsLocal/changedVsRemoteが正しく立ち、
//   マージ結果がローカルへ適用されること)+ 和集合マージで剪定済みエントリが復活しないこと。
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, GITHUB_API_HOST, STATE_KEY } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
const OWNER = "kojit1229";
const REPO = "personal-data";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  // ============================================================
  // Part E(堅牢性レビュー修正1・2): mergeAiStepPendingRequestsの決定論タイブレーク +
  // computeSyncMerge時点での即時剪定。ブラウザ不要のNode直接import(store-core.test.jsと同じ
  // configureGithubSync最小スタブ方式)で検証する。
  // ============================================================
  console.log("[E] mergeAiStepPendingRequests: 同一requestId競合の決定論タイブレーク + マージ計算時点での即時剪定");
  {
    const storeMod = await import(pathToFileURL(path.join(ROOT, "src", "state", "store.js")).href);
    const syncMod = await import(pathToFileURL(path.join(ROOT, "src", "sync", "github.js")).href);
    const noop = () => {};
    syncMod.configureGithubSync({
      normalizeState: (x) => x, nowDateTime: () => "2026-08-08T12:00:00", todayISO: () => "2026-08-08",
      addDays: (d) => d, isTouchedBlock: () => false,
      RECURRENCE_KEEP_PAST_DAYS: 7, RECURRENCE_FUTURE_DAYS: 31, SWIPE_TRIAGE_LOG_MAX: 200,
      showToast: noop, maintainRecurrences: noop, render: noop, runDailyOpen: () => false, saveState: noop,
      requireGitHubConfig: noop, fetchGitHubFileSHA: noop, personalDataReady: () => true, personalDataFileConfig: noop,
      gitHubContentsURL: noop, githubHeaders: noop, gitHubErrorMessage: noop, fromBase64: noop, toBase64: noop,
      sanitizedStateForGitHub: noop, maybeWriteBackupSnapshot: noop, updateAutoSaveStatus: noop, updateSyncDot: noop,
      renderSyncBanner: noop, pruneExpiredSuggestedThemes: (x) => x,
      _startupDataModifiedAt: ""
    });
    function baseSyncState(extra) {
      return {
        journalMeta: {}, settings: { journalTemplate: "", morningEnergyLog: {}, github: {} },
        journals: {}, feedback: {}, condition: { logs: {} }, sleep: { logs: {} },
        blocks: [], zeroThinking: { entries: [], suggestedThemes: [] },
        dailyDeclarations: {}, weeklyWishes: {}, bodyScans: [], tasks: [], projects: [], storeVisits: [],
        swipeTriageLog: [], gardenLog: {},
        aiStepProcessedIds: [], aiStepDismissedIds: [], aiStepPendingRequests: [],
        dataModifiedAt: "2026-08-08T10:00:00",
        ...extra
      };
    }

    console.log("[E-1] 同一requestIdが両端末で内容違い: local/remoteを入れ替えても同じ結果になる(決定論)");
    {
      const laterEntry = { requestId: "req-conflict", taskId: "task-b", requestedAt: "2026-08-08T10:00:00.000Z" };
      const earlierEntry = { requestId: "req-conflict", taskId: "task-a", requestedAt: "2026-08-08T09:00:00.000Z" };
      storeMod.setState(baseSyncState({ aiStepPendingRequests: [laterEntry] }));
      const merged1 = syncMod.computeSyncMerge(baseSyncState({ aiStepPendingRequests: [earlierEntry] }), "local");
      storeMod.setState(baseSyncState({ aiStepPendingRequests: [earlierEntry] }));
      const merged2 = syncMod.computeSyncMerge(baseSyncState({ aiStepPendingRequests: [laterEntry] }), "local");
      check(
        "local/remoteを入れ替えても同じ結果になる",
        JSON.stringify(merged1.values.aiStepPendingRequests) === JSON.stringify(merged2.values.aiStepPendingRequests),
        JSON.stringify({ merged1: merged1.values.aiStepPendingRequests, merged2: merged2.values.aiStepPendingRequests })
      );
      check(
        "requestedAtが早い方(earlierEntry)が採用される(local-firstではない)",
        merged1.values.aiStepPendingRequests.length === 1 && merged1.values.aiStepPendingRequests[0].taskId === "task-a",
        JSON.stringify(merged1.values.aiStepPendingRequests)
      );
    }

    console.log("[E-2] 同一requestedAtでも内容違い: taskId辞書順でタイブレークし、引数順に依存しない");
    {
      const entryZ = { requestId: "req-tie", taskId: "task-z", requestedAt: "2026-08-08T09:00:00.000Z" };
      const entryA = { requestId: "req-tie", taskId: "task-a", requestedAt: "2026-08-08T09:00:00.000Z" };
      storeMod.setState(baseSyncState({ aiStepPendingRequests: [entryZ] }));
      const merged = syncMod.computeSyncMerge(baseSyncState({ aiStepPendingRequests: [entryA] }), "local");
      check(
        "requestedAt同値ならtaskId辞書順が早い方(entryA)が採用される",
        merged.values.aiStepPendingRequests.length === 1 && merged.values.aiStepPendingRequests[0].taskId === "task-a",
        JSON.stringify(merged.values.aiStepPendingRequests)
      );
    }

    console.log("[E-3] processed/dismissed済みのrequestIdは、マージ計算(values)の時点で既に台帳から除かれている(次回normalizeState前)");
    {
      const settled = { requestId: "req-settled", taskId: "task-x", requestedAt: "2026-08-08T09:00:00.000Z" };
      storeMod.setState(baseSyncState({ aiStepProcessedIds: [], aiStepPendingRequests: [settled] }));
      const remoteNorm = baseSyncState({ aiStepProcessedIds: ["req-settled"], aiStepPendingRequests: [settled] });
      const merged = syncMod.computeSyncMerge(remoteNorm, "local");
      check(
        "computeSyncMergeの戻り値(values)の時点で既に空",
        Array.isArray(merged.values.aiStepPendingRequests) && merged.values.aiStepPendingRequests.length === 0,
        JSON.stringify(merged.values.aiStepPendingRequests)
      );
      syncMod.applySyncMergeToLocal(merged);
      check(
        "applySyncMergeToLocal適用直後のstateにも残っていない(次回normalizeStateを待たない)",
        Array.isArray(storeMod.state.aiStepPendingRequests) && storeMod.state.aiStepPendingRequests.length === 0,
        JSON.stringify(storeMod.state.aiStepPendingRequests)
      );
    }
  }

  // ============================================================
  // Part A: makeTask新フィールドの既定値
  // ============================================================
  console.log("[A] makeTask: aiSummary/aiQuestion/aiStepRequestId/aiStepRequestedAtの既定値はnull");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());

  const ctxA = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const pageA = await ctxA.newPage();
  pageA.on("pageerror", (e) => { failures++; console.log("  ❌ [A] pageerror:", e.message); });
  await blockGithubApiByDefault(pageA);
  await pageA.goto(`http://localhost:${PORT}/`);
  await pageA.waitForTimeout(400);
  await passGithubGate(pageA);

  const PROJECT_ID = "proj-v197-a";
  const TASK_TITLE = "v197検証タスクA";
  await pageA.evaluate(({ KEY, PROJECT_ID }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.projects.push({
      id: PROJECT_ID, kind: "normal", title: "v197検証プロジェクト", category: "", status: "active",
      description: "", createdAt: "2026-08-01T00:00:00", updatedAt: "2026-08-01T00:00:00", deleted: false
    });
    s.currentView = "wbs";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY: STATE_KEY, PROJECT_ID });
  await pageA.reload();
  await pageA.waitForTimeout(400);
  await pageA.click(`[data-action="add-task-to-project"][data-id="${PROJECT_ID}"]`);
  await pageA.waitForSelector('[data-modal-field="title"]', { state: "visible" });
  await pageA.fill('[data-modal-field="title"]', TASK_TITLE);
  await pageA.click('[data-action="modal-save"]');
  await pageA.waitForTimeout(300);

  const sA = await pageA.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), STATE_KEY);
  const createdTask = sA.tasks.find((t) => t.title === TASK_TITLE);
  check("新規タスクが作成された", !!createdTask, JSON.stringify(sA.tasks.map((t) => t.title)));
  if (createdTask) {
    check("aiSummaryの既定値はnull", createdTask.aiSummary === null, JSON.stringify(createdTask.aiSummary));
    check("aiQuestionの既定値はnull", createdTask.aiQuestion === null, JSON.stringify(createdTask.aiQuestion));
    check("aiStepRequestIdの既定値はnull", createdTask.aiStepRequestId === null, JSON.stringify(createdTask.aiStepRequestId));
    check("aiStepRequestedAtの既定値はnull", createdTask.aiStepRequestedAt === null, JSON.stringify(createdTask.aiStepRequestedAt));
    // 第4弾予約: 本弾のアプリはaiQuestionへ書き込まない(§5)。既存の書き込み経路が無いことの
    // 間接確認として、既定値のnullが保存直後も維持されていることを併せて確認する(上のcheckと同義)。
  }
  await ctxA.close();

  // ============================================================
  // Part B: normalizeStateの型正規化+決定論剪定
  // ============================================================
  console.log("[B] normalizeState: 型正規化(配列でなければ[]/要素の形が不正なら捨てる)");
  const ctxB = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const pageB = await ctxB.newPage();
  pageB.on("pageerror", (e) => { failures++; console.log("  ❌ [B] pageerror:", e.message); });
  await blockGithubApiByDefault(pageB);
  await pageB.goto(`http://localhost:${PORT}/`);
  await pageB.waitForTimeout(400);
  await passGithubGate(pageB);

  console.log("[B1] 不正な型(非配列)は空配列へ、要素の形が不正なものは捨てる");
  await pageB.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.aiStepProcessedIds = "bogus";
    s.aiStepDismissedIds = [123, "ok-dismissed-id", null, "", { not: "a string" }];
    s.aiStepPendingRequests = "also-bogus";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, STATE_KEY);
  await pageB.reload();
  await pageB.waitForTimeout(300);
  let sB = await pageB.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), STATE_KEY);
  check("非配列のaiStepProcessedIdsは[]へ補完される", Array.isArray(sB.aiStepProcessedIds) && sB.aiStepProcessedIds.length === 0, JSON.stringify(sB.aiStepProcessedIds));
  check("aiStepDismissedIdsは文字列以外の要素を捨てる", JSON.stringify(sB.aiStepDismissedIds) === JSON.stringify(["ok-dismissed-id"]), JSON.stringify(sB.aiStepDismissedIds));
  check("非配列のaiStepPendingRequestsは[]へ補完される", Array.isArray(sB.aiStepPendingRequests) && sB.aiStepPendingRequests.length === 0, JSON.stringify(sB.aiStepPendingRequests));

  console.log("[B2] aiStepPendingRequests: 形が不正な要素を捨て、processed/dismissed済みのrequestIdは剪定する");
  await pageB.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.aiStepProcessedIds = ["req-done-1"];
    s.aiStepDismissedIds = ["req-cancel-1"];
    s.aiStepPendingRequests = [
      { requestId: "req-done-1", taskId: "t1", requestedAt: "2026-08-01T00:00:00.000Z" },   // 剪定対象(processed)
      { requestId: "req-cancel-1", taskId: "t2", requestedAt: "2026-08-01T00:00:00.000Z" },  // 剪定対象(dismissed)
      { requestId: "req-pending-1", taskId: "t3", requestedAt: "2026-08-01T00:00:00.000Z" }, // 残る
      { requestId: "", taskId: "t4", requestedAt: "2026-08-01T00:00:00.000Z" },              // 不正(requestId空)
      { taskId: "t5", requestedAt: "2026-08-01T00:00:00.000Z" },                             // 不正(requestId欠落)
      { requestId: "req-no-task", requestedAt: "2026-08-01T00:00:00.000Z" },                 // 不正(taskId欠落)
      "not-an-object"                                                                        // 不正(型)
    ];
    localStorage.setItem(KEY, JSON.stringify(s));
  }, STATE_KEY);
  await pageB.reload();
  await pageB.waitForTimeout(300);
  sB = await pageB.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), STATE_KEY);
  check(
    "processed/dismissed済み・形不正なエントリは消え、pending中の1件だけが残る",
    Array.isArray(sB.aiStepPendingRequests) && sB.aiStepPendingRequests.length === 1
      && sB.aiStepPendingRequests[0].requestId === "req-pending-1",
    JSON.stringify(sB.aiStepPendingRequests)
  );

  console.log("[B3](堅牢性レビュー修正3) normalizeState: 新4フィールドを持たない旧Taskへも既定値(null)がbackfillされる");
  await pageB.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    // v197以前に作られた旧Task相当(aiSummary/aiQuestion/aiStepRequestId/aiStepRequestedAtが無い)
    const { aiSummary, aiQuestion, aiStepRequestId, aiStepRequestedAt, ...legacyTask } = {
      id: "legacy-task-v197", projectId: "", parentTaskId: "", title: "旧Task",
      category: "", status: "todo", dueDate: "", description: "",
      aiWork: false, aiWorkBrief: "", planTarget: false, owner: "k", order: null,
      aiBrief: "", handoffNote: "", aiStatus: "none", aiResultRef: "",
      aiSummary: null, aiQuestion: null, aiStepRequestId: null, aiStepRequestedAt: null,
      progressNum: 0, progressDen: 10, doneCriteria: "", firstStep: "", criteriaRequest: false,
      selfDueOff: true, updatedAt: "2026-01-01T00:00", createdAt: "2026-01-01T00:00", deleted: false
    };
    s.tasks = [legacyTask];
    localStorage.setItem(KEY, JSON.stringify(s));
  }, STATE_KEY);
  await pageB.reload();
  await pageB.waitForTimeout(300);
  sB = await pageB.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), STATE_KEY);
  const legacyAfter = sB.tasks.find((t) => t.id === "legacy-task-v197");
  check("旧TaskにaiSummaryがnullで補完される", legacyAfter && legacyAfter.aiSummary === null, JSON.stringify(legacyAfter));
  check("旧TaskにaiQuestionがnullで補完される", legacyAfter && legacyAfter.aiQuestion === null, JSON.stringify(legacyAfter));
  check("旧Taskにaiステップ待受でaiStepRequestIdがnullで補完される", legacyAfter && legacyAfter.aiStepRequestId === null, JSON.stringify(legacyAfter));
  check("旧Taskにaiステップ待受でaiStepRequestedAtがnullで補完される", legacyAfter && legacyAfter.aiStepRequestedAt === null, JSON.stringify(legacyAfter));
  await ctxB.close();

  // ============================================================
  // Part C: computeSyncMergeへのマージ追随(C-5回帰)+ 和集合マージでの復活防止
  // ============================================================
  console.log("[C] 同期マージ: aiStepProcessedIds/aiStepDismissedIds/aiStepPendingRequestsの集合和・requestIdキー和集合マージ");
  const ctxC = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const pageC = await ctxC.newPage();
  pageC.on("pageerror", (e) => { failures++; console.log("  ❌ [C] pageerror:", e.message); });

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(22, 0, 0, 0);  // 日中固定(深夜跨ぎ回避、v103/v153と同じ理由)
  const TODAY = isoDate(now0);

  function contentsBodyFor(obj) {
    const jsonText = JSON.stringify(obj);
    const b64 = Buffer.from(jsonText, "utf-8").toString("base64");
    const chunked = (b64.match(/.{1,60}/g) || []).join("\n");
    return JSON.stringify({ name: "app-state.json", path: "taskchute/app-state.json", sha: "sha-v197", content: chunked, encoding: "base64" });
  }
  // C-5回帰の核心: 「タスクは同一で3コレクションだけに差がある」入力を作るため、
  // tasks/projects/blocksはローカル側で実際に確定した内容(wish/other等の既定シングルトンは
  // normalizeStateがcrypto.randomUUID()で生成するため、空配列を渡しても両端末で別idが
  // 独立に振られてしまい「同一」にならない)をそのままリモート側へミラーする。
  // 差分は3コレクション(aiStepProcessedIds/aiStepDismissedIds/aiStepPendingRequests)だけに
  // 限定されるため、これらのchanged判定が漏れていればapplySyncMergeToLocal/ToRemoteが
  // 即returnし、マージ結果が一切適用されない(この構造で赤→緑を確認済み)。
  function remoteState(dataModifiedAt, mirror, overrides) {
    return {
      dataModifiedAt,
      currentView: "home",
      selectedDate: TODAY,
      blocks: mirror.blocks, projects: mirror.projects, tasks: mirror.tasks, settings: {},
      aiStepProcessedIds: [], aiStepDismissedIds: [], aiStepPendingRequests: [],
      ...overrides
    };
  }

  const fixtures = { status: 404, body: null };
  await blockGithubApiByDefault(pageC);
  await pageC.route((url) => url.hostname === GITHUB_API_HOST, (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    if (p === `/repos/${OWNER}/${REPO}/contents/taskchute/app-state.json`) {
      if (fixtures.status === 200) return route.fulfill({ status: 200, contentType: "application/json", body: fixtures.body });
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  await pageC.clock.setFixedTime(now0);
  await pageC.goto(`http://localhost:${PORT}/`);
  await pageC.waitForTimeout(400);
  await passGithubGate(pageC);  // token/dataOwner/dataRepo投入(この時点は404で同期は何もしない)

  const LOCAL_T = `${TODAY}T10:00:00`;
  const REMOTE_T = `${TODAY}T08:00:00`;  // ローカルより古い → applySyncMergeToLocal経路(remoteT<=localT)

  const mirrorC = await pageC.evaluate(({ KEY, LOCAL_T }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.dataModifiedAt = LOCAL_T;
    s.settings.lastPushedAt = LOCAL_T;
    s.aiStepProcessedIds = ["req-local-proc"];
    s.aiStepDismissedIds = ["req-local-dismiss"];
    s.aiStepPendingRequests = [{ requestId: "req-local-pending", taskId: "t-local", requestedAt: "2026-08-01T00:00:00.000Z" }];
    localStorage.setItem(KEY, JSON.stringify(s));
    return { tasks: s.tasks, projects: s.projects, blocks: s.blocks };
  }, { KEY: STATE_KEY, LOCAL_T });

  fixtures.status = 200;
  fixtures.body = contentsBodyFor(remoteState(REMOTE_T, mirrorC, {
    aiStepProcessedIds: ["req-remote-proc"],
    aiStepDismissedIds: ["req-remote-dismiss"],
    aiStepPendingRequests: [{ requestId: "req-remote-pending", taskId: "t-remote", requestedAt: "2026-08-01T00:00:00.000Z" }]
  }));

  await pageC.reload();
  await pageC.waitForTimeout(700);
  const afterC1 = await pageC.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), STATE_KEY);
  check(
    "aiStepProcessedIdsが両端末の和集合になる(C-5: マージ結果がローカルに適用される)",
    JSON.stringify([...afterC1.aiStepProcessedIds].sort()) === JSON.stringify(["req-local-proc", "req-remote-proc"]),
    JSON.stringify(afterC1.aiStepProcessedIds)
  );
  check(
    "aiStepDismissedIdsが両端末の和集合になる",
    JSON.stringify([...afterC1.aiStepDismissedIds].sort()) === JSON.stringify(["req-local-dismiss", "req-remote-dismiss"]),
    JSON.stringify(afterC1.aiStepDismissedIds)
  );
  check(
    "aiStepPendingRequestsが両端末の和集合になる(requestIdキー)",
    Array.isArray(afterC1.aiStepPendingRequests) && afterC1.aiStepPendingRequests.length === 2
      && new Set(afterC1.aiStepPendingRequests.map((r) => r.requestId)).size === 2
      && afterC1.aiStepPendingRequests.some((r) => r.requestId === "req-local-pending")
      && afterC1.aiStepPendingRequests.some((r) => r.requestId === "req-remote-pending"),
    JSON.stringify(afterC1.aiStepPendingRequests)
  );

  console.log("[C2] 和集合マージで復活しない: リモートで先に処理済み(processed)になったrequestIdは、"
    + "ローカルの保留台帳に残っていても次回起動のnormalizeStateで剪定される");
  await ctxC.close();

  const ctxC2 = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const pageC2 = await ctxC2.newPage();
  pageC2.on("pageerror", (e) => { failures++; console.log("  ❌ [C2] pageerror:", e.message); });
  const fixtures2 = { status: 404, body: null };
  await blockGithubApiByDefault(pageC2);
  await pageC2.route((url) => url.hostname === GITHUB_API_HOST, (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    if (p === `/repos/${OWNER}/${REPO}/contents/taskchute/app-state.json`) {
      if (fixtures2.status === 200) return route.fulfill({ status: 200, contentType: "application/json", body: fixtures2.body });
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await pageC2.clock.setFixedTime(now0);
  await pageC2.goto(`http://localhost:${PORT}/`);
  await pageC2.waitForTimeout(400);
  await passGithubGate(pageC2);

  const mirrorC2 = await pageC2.evaluate(({ KEY, LOCAL_T }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.dataModifiedAt = LOCAL_T;
    s.settings.lastPushedAt = LOCAL_T;
    s.aiStepProcessedIds = [];
    s.aiStepDismissedIds = [];
    s.aiStepPendingRequests = [{ requestId: "req-shared", taskId: "t-shared", requestedAt: "2026-08-01T00:00:00.000Z" }];
    localStorage.setItem(KEY, JSON.stringify(s));
    return { tasks: s.tasks, projects: s.projects, blocks: s.blocks };  // C1と同じ理由(diffを3コレクションだけに限定)
  }, { KEY: STATE_KEY, LOCAL_T });

  fixtures2.status = 200;
  fixtures2.body = contentsBodyFor(remoteState(REMOTE_T, mirrorC2, {
    aiStepProcessedIds: ["req-shared"]  // 他端末が既に処理済みにした
  }));

  await pageC2.reload();
  await pageC2.waitForTimeout(700);
  const afterC2a = await pageC2.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), STATE_KEY);
  check("[中間状態] マージ直後はprocessedへreq-sharedが合流する", afterC2a.aiStepProcessedIds.includes("req-shared"), JSON.stringify(afterC2a.aiStepProcessedIds));

  // 次回起動(normalizeState再実行)で、processed済みのrequestIdは保留台帳から剪定される。
  await pageC2.reload();
  await pageC2.waitForTimeout(400);
  const afterC2b = await pageC2.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), STATE_KEY);
  check(
    "次回起動でaiStepPendingRequestsからreq-sharedが剪定され、復活しない",
    Array.isArray(afterC2b.aiStepPendingRequests) && !afterC2b.aiStepPendingRequests.some((r) => r.requestId === "req-shared"),
    JSON.stringify(afterC2b.aiStepPendingRequests)
  );
  check("processedには引き続きreq-sharedが残る", afterC2b.aiStepProcessedIds.includes("req-shared"), JSON.stringify(afterC2b.aiStepProcessedIds));

  await ctxC2.close();

  await browser.close();
  server.close();

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
