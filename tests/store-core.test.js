// store-core.test.js — 段階3抽出(state store + storage/sync gateway)のcharacterization test。
// 対象: src/state/store.js(setState契約)、src/sync/github.js(computeSyncMerge/syncCoreEqual/
// applySyncMergeToLocal/applySyncMergeToRemote)。src/storage/local.jsは循環import回避のため
// normalizeState/seedStateを引数で受け取る設計(loadState(normalize, seed))であり、
// loadState自体はlocalStorageというブラウザAPIに依存するため、ここではsetStateのライブ
// バインディング契約とMust-1の実測に絞る(loadState/persistLocalNoScheduleの実データI/Oは
// 既存のsw-integration/v135等のbrowser E2Eが実機同等の環境でカバーする)。
//
// 固定する2グループの挙動:
// [A] setState契約(claude-review-result.md §2 Blocker-1): app.js側の6箇所の`state = X`は
//     すべて`setState(X)`へ置換した。抽出前後で「再代入後にimport済みstateが同一内容を指す」
//     ことが同値であることを、6箇所それぞれが生成する代表的な形(importData/restoreBackup/
//     resetDemoDataのような単純な全置換、runAutoSyncPull/loadFromGitHub/
//     syncFromGitHubOnStartupのような同期採用後の置換)で固定する。
// [B] Must-1(claude-review-result.md §3、prep-stage3-gateway.md §7-2): computeSyncMerge/
//     syncCoreEqualのマージ・比較対象に入っていないキー(routineChains/chainRuns/
//     weeklyReviews/cycleReviews)が、自動解決の経路によって保全されるか消えるかを実測する。
//     「こうあるべき」ではなく現状の実装が実際にどう振る舞うかを固定する(§9: stage3では
//     挙動を変更しない。fail-close化は次タスク)。
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const STORE_PATH = path.join(ROOT, "src", "state", "store.js");
const SYNC_PATH = path.join(ROOT, "src", "sync", "github.js");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function noop() {}

// computeSyncMerge/syncCoreEqual/applySyncMergeToLocal/applySyncMergeToRemoteが実際に呼ぶ
// app.js側の依存の最小スタブ(configureGithubSyncによる依存注入。src/sync/github.js冒頭コメント
// の契約どおり、src/配下からapp.jsを直接importしないための仕組み)。
function configureMinimalStubs(syncMod) {
  syncMod.configureGithubSync({
    normalizeState: (x) => x,
    nowDateTime: () => "2026-07-28T12:00:00",
    todayISO: () => "2026-07-28",
    addDays: (d) => d,
    isTouchedBlock: () => false,
    RECURRENCE_KEEP_PAST_DAYS: 7,
    RECURRENCE_FUTURE_DAYS: 31,
    SWIPE_TRIAGE_LOG_MAX: 200,
    showToast: noop, maintainRecurrences: noop, render: noop, runDailyOpen: () => false, saveState: noop,
    requireGitHubConfig: noop, fetchGitHubFileSHA: noop, personalDataReady: () => true, personalDataFileConfig: noop,
    gitHubContentsURL: noop, githubHeaders: noop, gitHubErrorMessage: noop, fromBase64: noop, toBase64: noop,
    sanitizedStateForGitHub: noop, maybeWriteBackupSnapshot: noop, updateAutoSaveStatus: noop, updateSyncDot: noop,
    renderSyncBanner: noop, pruneExpiredSuggestedThemes: (x) => x,
    _startupDataModifiedAt: ""
  });
}

// computeSyncMerge/syncCoreEqualが参照するキーを一式そろえた最小state(SYNC_CORE_COMPARE_KEYS
// のキーはlocal/remoteで意図的に一致させ、syncCoreEqual()がtrueを返す=自動解決経路に入る
// 状況を作る)。
function baseState(extra) {
  return {
    journalMeta: {}, settings: { journalTemplate: "", morningEnergyLog: {}, github: {} },
    journals: {}, feedback: {}, condition: { logs: {} }, sleep: { logs: {} },
    blocks: [], zeroThinking: { entries: [], suggestedThemes: [] },
    dailyDeclarations: {}, weeklyWishes: {}, bodyScans: [], tasks: [], projects: [], storeVisits: [],
    swipeTriageLog: [], gardenLog: {},
    recurrences: ["r1"], declarations: ["d1"], questions: ["q1"], experiments: ["e1"],
    dataModifiedAt: "2026-07-28T10:00:00",
    ...extra
  };
}

async function loadModules() {
  const storeMod = await import(pathToFileURL(STORE_PATH).href);
  const syncMod = await import(pathToFileURL(SYNC_PATH).href);
  configureMinimalStubs(syncMod);
  return { storeMod, syncMod };
}

(async () => {
  const { storeMod, syncMod } = await loadModules();

  // ===================== [A] setState契約 =====================
  console.log("[A-1] setState()前はstateがnull(store.js冒頭の契約どおり)");
  {
    check("初期値はnull", storeMod.state === null, String(storeMod.state));
  }

  console.log("[A-2] setState(X)後、import済みstateがXと同一参照になる(live binding)");
  {
    const next = { marker: "importData風の全置換", tasks: [{ id: "t1" }] };
    storeMod.setState(next);
    check("同一参照", storeMod.state === next);
    check("内容が一致", storeMod.state.marker === "importData風の全置換");
  }

  console.log("[A-3] 6箇所すべてに共通する形(単純な全置換 → その後プロパティを追記)を固定");
  {
    // importData/restoreBackup/resetDemoDataは「setState(next); next.xxx = ...;」のパターン、
    // runAutoSyncPull/loadFromGitHub/syncFromGitHubOnStartupは
    // 「setState(adopted); state.settings.github = ...;」のパターン。
    // いずれも「setState後にimport済みstateへプロパティを書き足すと、その変更が
    // 同じ参照から見える」という同一の契約に依存している。6箇所ともこの形で正しく動く。
    const scenarios = [
      { label: "importData風", next: { settings: { github: {} } } },
      { label: "restoreBackup風", next: { settings: { github: {} } } },
      { label: "resetDemoData風", next: { settings: { github: {} } } },
      { label: "runAutoSyncPull風", next: { settings: { github: {} } } },
      { label: "loadFromGitHub風", next: { settings: { github: {} } } },
      { label: "syncFromGitHubOnStartup風", next: { settings: { github: {} } } }
    ];
    for (const { label, next } of scenarios) {
      storeMod.setState(next);
      storeMod.state.settings.github = { token: "dummy-" + label };
      check(
        `${label}: setState後の追記が同一stateから見える`,
        storeMod.state === next && storeMod.state.settings.github.token === "dummy-" + label,
        JSON.stringify(storeMod.state)
      );
    }
  }

  // ===================== [B] Must-1: 一次データ4キーの自動解決前後保全 =====================
  // 端末AがローカルにroutineChains/chainRuns/weeklyReviews/cycleReviewsのエントリを持ち、
  // 端末Bはjournalsだけが異なる状態を想定する(SYNC_CORE_COMPARE_KEYSの4キーは一致させ、
  // syncCoreEqual()がtrueを返す=「両方に未反映の変更を人間判断なしで自動解消してよい」
  // 経路に入るようにする)。
  function makeLocalWithPrimaryData() {
    return baseState({
      routineChains: [{ id: "chainA", name: "朝ルーティン" }],
      chainRuns: [{ id: "runA", chainId: "chainA" }],
      weeklyReviews: { "2026-W30": { text: "順調" } },
      cycleReviews: { cycle1: { text: "12週レビュー" } }
    });
  }
  function makeRemoteDiffOnlyInJournals() {
    // リモートはjournalsだけ異なり、routineChains等はまだ持っていない
    // (この端末発の新規ローカルデータがリモートへ未反映という想定)。
    return baseState({ journals: { "2026-07-27": "別端末で書いたジャーナル本文" } });
  }

  console.log("[B-1] syncCoreEqual: 比較対象キーが一致すればtrue(自動解決経路に入る前提)");
  {
    storeMod.setState(makeLocalWithPrimaryData());
    const remoteNorm = makeRemoteDiffOnlyInJournals();
    check("syncCoreEqualはtrueを返す", syncMod.syncCoreEqual(remoteNorm) === true);
  }
  console.log("[B-1b] earlyBirdは取消が物理削除のため競合時にfail-closeする");
  {
    const local = makeLocalWithPrimaryData();
    local.earlyBird = { logs: { "2026-07-27": { checkedAt: "2026-07-27T05:55:00" } } };
    storeMod.setState(local);
    const remoteNorm = makeRemoteDiffOnlyInJournals();
    remoteNorm.earlyBird = { logs: {} };
    check("earlyBird不一致ならsyncCoreEqualはfalse", syncMod.syncCoreEqual(remoteNorm) === false);
  }
  console.log("[B-1c] habitStreaksも取消を復活させないため競合時にfail-closeする");
  {
    const local = makeLocalWithPrimaryData();
    local.habitStreaks = { r1: { logs: { "2026-07-27": { doneAt: "2026-07-27T08:00:00" } } } };
    storeMod.setState(local);
    const remoteNorm = makeRemoteDiffOnlyInJournals();
    remoteNorm.habitStreaks = { r1: { logs: {} } };
    check("habitStreaks不一致ならsyncCoreEqualはfalse", syncMod.syncCoreEqual(remoteNorm) === false);
  }

  function habitStreakFixture() {
    return {
      done: { logs: { "2026-07-28": { doneAt: "2026-07-28T08:00:00" } } },
      cancelled: { logs: { "2026-07-27": { doneAt: "2026-07-27T08:00:00" } } }
    };
  }

  console.log("[B-1d] ローカル採用でhabitStreaksの当日ログと当日取消を保持する");
  {
    const local = makeLocalWithPrimaryData();
    local.habitStreaks = habitStreakFixture();
    storeMod.setState(local);
    const remoteNorm = makeRemoteDiffOnlyInJournals();
    remoteNorm.habitStreaks = habitStreakFixture();
    check("ローカル採用の前提としてsyncCoreEqualはtrue", syncMod.syncCoreEqual(remoteNorm) === true);
    const merged = syncMod.computeSyncMerge(remoteNorm, "local");
    syncMod.applySyncMergeToLocal(merged);
    check("ローカル採用後も当日完了ログを保持", storeMod.state.habitStreaks.done.logs["2026-07-28"]?.doneAt === "2026-07-28T08:00:00");
    check("ローカル採用後も取消済みruleの当日ログなしを保持",
      storeMod.state.habitStreaks.cancelled.logs["2026-07-28"] == null
        && storeMod.state.habitStreaks.cancelled.logs["2026-07-27"] != null,
      JSON.stringify(storeMod.state.habitStreaks.cancelled));
  }

  console.log("[B-1e] リモート採用でhabitStreaksの当日ログと当日取消を保持する");
  {
    const local = makeLocalWithPrimaryData();
    local.habitStreaks = habitStreakFixture();
    storeMod.setState(local);
    const remoteNorm = makeRemoteDiffOnlyInJournals();
    remoteNorm.habitStreaks = habitStreakFixture();
    check("リモート採用の前提としてsyncCoreEqualはtrue", syncMod.syncCoreEqual(remoteNorm) === true);
    const merged = syncMod.computeSyncMerge(remoteNorm, "remote");
    syncMod.applySyncMergeToRemote(merged, remoteNorm);
    storeMod.setState(remoteNorm);
    check("リモート採用後も当日完了ログを保持", storeMod.state.habitStreaks.done.logs["2026-07-28"]?.doneAt === "2026-07-28T08:00:00");
    check("リモート採用後も取消済みruleの当日ログなしを保持",
      storeMod.state.habitStreaks.cancelled.logs["2026-07-28"] == null
        && storeMod.state.habitStreaks.cancelled.logs["2026-07-27"] != null,
      JSON.stringify(storeMod.state.habitStreaks.cancelled));
  }

  console.log("[B-2] ローカルを基準に残す経路(applySyncMergeToLocal): 4キーは触れられないため保全される");
  {
    const local = makeLocalWithPrimaryData();
    storeMod.setState(local);
    const remoteNorm = makeRemoteDiffOnlyInJournals();
    const merged = syncMod.computeSyncMerge(remoteNorm, "local");
    syncMod.applySyncMergeToLocal(merged);
    check(
      "state.routineChainsのローカルエントリが残る",
      Array.isArray(storeMod.state.routineChains) && storeMod.state.routineChains.length === 1
        && storeMod.state.routineChains[0].id === "chainA",
      JSON.stringify(storeMod.state.routineChains)
    );
    check(
      "state.chainRunsのローカルエントリが残る",
      Array.isArray(storeMod.state.chainRuns) && storeMod.state.chainRuns.length === 1,
      JSON.stringify(storeMod.state.chainRuns)
    );
    check(
      "state.weeklyReviewsのローカルエントリが残る",
      storeMod.state.weeklyReviews && storeMod.state.weeklyReviews["2026-W30"] != null,
      JSON.stringify(storeMod.state.weeklyReviews)
    );
    check(
      "state.cycleReviewsのローカルエントリが残る",
      storeMod.state.cycleReviews && storeMod.state.cycleReviews.cycle1 != null,
      JSON.stringify(storeMod.state.cycleReviews)
    );
  }

  console.log("[B-3] リモートを採用する経路(applySyncMergeToRemote + setState(adopted)):");
  console.log("       既知のリスクを実測で固定(routineChains等はcomputeSyncMergeのマージ対象に");
  console.log("       含まれていないため、applySyncMergeToRemoteはこれらをremoteNormへコピーせず、");
  console.log("       その後のsetState(remoteNorm)でstate全体がremoteNormに置き換わるため消える)。");
  {
    const local = makeLocalWithPrimaryData();
    storeMod.setState(local);
    const remoteNorm = makeRemoteDiffOnlyInJournals();
    const merged = syncMod.computeSyncMerge(remoteNorm, "remote");
    syncMod.applySyncMergeToRemote(merged, remoteNorm);
    storeMod.setState(remoteNorm);  // runAutoSyncPull/loadFromGitHub/syncFromGitHubOnStartupと同じ手順
    check(
      "【既知のリスク・stage3では修正しない】state.routineChainsのローカルエントリは消える(undefined)",
      storeMod.state.routineChains === undefined,
      JSON.stringify(storeMod.state.routineChains)
    );
    check(
      "【既知のリスク】state.chainRunsのローカルエントリも消える(undefined)",
      storeMod.state.chainRuns === undefined,
      JSON.stringify(storeMod.state.chainRuns)
    );
    check(
      "【既知のリスク】state.weeklyReviewsのローカルエントリも消える(undefined)",
      storeMod.state.weeklyReviews === undefined,
      JSON.stringify(storeMod.state.weeklyReviews)
    );
    check(
      "【既知のリスク】state.cycleReviewsのローカルエントリも消える(undefined)",
      storeMod.state.cycleReviews === undefined,
      JSON.stringify(storeMod.state.cycleReviews)
    );
  }

  console.log(failures === 0 ? "\nstore-core: 全件成功" : `\nstore-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
