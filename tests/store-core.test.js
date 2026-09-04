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
//     syncCoreEqualのマージ・比較対象に入っていないキー(routineChains/weeklyReviews/
//     cycleReviews)が、自動解決の経路によって保全されるか消えるかを実測する。
//     「こうあるべき」ではなく現状の実装が実際にどう振る舞うかを固定する(§9: stage3では
//     挙動を変更しない。fail-close化は次タスク)。
//     unit14(D-1)でchainRunsはSYNC_CORE_COMPARE_KEYSへ移った(=もう「消える」側の例には
//     使えない)ため、既知リスクの例からは外し、B-4で「不一致ならfail-closeする」側として検証する。
// [B-4] unit14(D-1): SYNC_CORE_COMPARE_KEYSへ追加したstate直下9キー+settings一次データ12キー
//     (計21キー)の行列。各キーだけが異なればsyncCoreEqualがfalseになること(=fail-closeで
//     バナーへ落ちる)を1キーずつ固定する。UI状態キー(比較対象外)だけが異なる場合は
//     従来どおりtrueのままであることもB-5で固定する。
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
    journalMeta: {},
    settings: {
      journalTemplate: "", morningEnergyLog: {}, github: {},
      // unit14: SYNC_CORE_COMPARE_KEYSへ追加したsettings一次データ12キーの既定値
      // (local/remoteとも同じ既定値から出発させ、行列テストで1キーずつ差し替える)。
      avoidList: [], categories: [], lifeAreas: [], vision: "", affirmation: "",
      twelveWeekStartDate: "", twelveWeekScoreTarget: 85, birthDate: "", battery: {},
      gymExerciseList: [], visionDirectCategories: []
    },
    journals: {}, feedback: {}, condition: { logs: {} }, sleep: { logs: {} },
    blocks: [], zeroThinking: { entries: [], suggestedThemes: [] },
    dailyDeclarations: {}, weeklyWishes: {}, bodyScans: [], tasks: [], projects: [], storeVisits: [],
    swipeTriageLog: [], gardenLog: {},
    recurrences: ["r1"], declarations: ["d1"], questions: ["q1"], experiments: ["e1"],
    // unit14: SYNC_CORE_COMPARE_KEYSに残るaiScheduleHistory(fail-close比較)の既定値。
    // reports/chainRuns/feedbackFiles/feedbackIngestedDates/migrationRitualLog/
    // zeroSecThemeLog/aiWorkProcessedIdsはunit14bで和集合マージ対象へ移ったため比較対象では
    // ないが、computeSyncMergeの新しいマージ処理(B-6)が参照するため既定値は引き続き必要。
    // ironImportは比較対象からもマージ対象からも外れた端末ローカルな派生状態(既定値のみ残す)。
    reports: {}, chainRuns: [], aiScheduleHistory: [], feedbackFiles: [], feedbackIngestedDates: [],
    migrationRitualLog: [], zeroSecThemeLog: [], aiWorkProcessedIds: [], ironImport: {},
    dataModifiedAt: "2026-07-28T10:00:00",
    ...extra
  };
}

// ドット区切りパスへ値を設定する(SYNC_CORE_COMPARE_KEYSの"settings.xxx"形式に対応するテスト用ヘルパー)。
function setByPath(obj, dotted, value) {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = cur[parts[i]] || {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
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

  // ===================== [B] Must-1: 一次データ3キーの自動解決前後保全 =====================
  // 端末AがローカルにroutineChains/weeklyReviews/cycleReviewsのエントリを持ち、
  // 端末Bはjournalsだけが異なる状態を想定する(baseState()の既定値により残る21キーは
  // 一致するので、syncCoreEqual()がtrueを返す=「両方に未反映の変更を人間判断なしで
  // 自動解消してよい」経路に入るようにする)。
  // unit14でchainRunsはSYNC_CORE_COMPARE_KEYSへ移動したため、ここには含めない
  // (含めるとsyncCoreEqualがfalseになり本セクションの前提が崩れる。B-4で別途検証する)。
  function makeLocalWithPrimaryData() {
    return baseState({
      routineChains: [{ id: "chainA", name: "朝ルーティン" }],
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

  // ===================== [B-4] unit14+unit14b: 13キー行列(1キーだけ違えばfail-close) =====================
  // unit14でSYNC_CORE_COMPARE_KEYSへ追加したaiScheduleHistory+settings一次データ12キー=計13キー。
  // それぞれについて、そのキーだけがlocal/remoteで異なればsyncCoreEqualがfalseを返すこと
  // (=「変更なし」の誤判定をやめてバナーへ落とす)を1キーずつ固定する。
  // unit14b(独立レビュー2026-09-04、A1-M1拡大の救済): reports/chainRuns/feedbackFiles/
  // feedbackIngestedDates/migrationRitualLog/zeroSecThemeLog/aiWorkProcessedIdsの7キーは
  // 和集合マージ対象へ昇格したためこの行列から外した(下のB-6で「不一致でもマージされ両方残る」
  // 側として検証する)。ironImportは端末ローカルな派生状態のため比較対象からも外した。
  const UNIT14_COMPARE_KEYS = [
    { path: "aiScheduleHistory", a: [{ source: "local", reason: "" }], b: [{ source: "remote", reason: "" }] },
    { path: "settings.avoidList", a: ["酒"], b: ["糖質"] },
    { path: "settings.categories", a: [{ id: "c1", name: "仕事" }], b: [{ id: "c2", name: "私用" }] },
    { path: "settings.lifeAreas", a: [{ id: "l1", name: "健康" }], b: [{ id: "l2", name: "家族" }] },
    { path: "settings.vision", a: "ローカルのVision", b: "リモートのVision" },
    { path: "settings.affirmation", a: "ローカルのAffirmation", b: "リモートのAffirmation" },
    { path: "settings.journalTemplate", a: "# ローカルテンプレ", b: "# リモートテンプレ" },
    { path: "settings.twelveWeekStartDate", a: "2026-01-01", b: "2026-04-01" },
    { path: "settings.twelveWeekScoreTarget", a: 85, b: 90 },
    { path: "settings.birthDate", a: "1990-01-01", b: "1991-01-01" },
    { path: "settings.battery", a: { start: { hh: 7, mm: 0 } }, b: { start: { hh: 8, mm: 0 } } },
    { path: "settings.gymExerciseList", a: ["スクワット"], b: ["デッドリフト"] },
    { path: "settings.visionDirectCategories", a: ["c1"], b: ["c2"] }
  ];
  check(`unit14行列の対象キー数は13`, UNIT14_COMPARE_KEYS.length === 13, String(UNIT14_COMPARE_KEYS.length));

  console.log("[B-4] unit14: 13キーそれぞれ「そのキーだけ違えば不一致」を固定");
  for (const { path: dotted, a, b } of UNIT14_COMPARE_KEYS) {
    const local = makeLocalWithPrimaryData();
    setByPath(local, dotted, a);
    storeMod.setState(local);
    const remoteNorm = makeRemoteDiffOnlyInJournals();
    setByPath(remoteNorm, dotted, b);
    check(
      `${dotted}だけ違えばsyncCoreEqualはfalse`,
      syncMod.syncCoreEqual(remoteNorm) === false
    );
  }

  console.log("[B-5] UI状態キー(比較対象外)だけ違えばsyncCoreEqualは従来どおりtrue");
  {
    // currentView/selectedDateはSYNC_CORE_COMPARE_KEYSに入らないUI状態キーの代表例
    // (画面表示上の状態であり、端末間で異なっていても同期の競合として扱わない)。
    const local = makeLocalWithPrimaryData();
    local.currentView = "timeline";
    local.selectedDate = "2026-07-28";
    storeMod.setState(local);
    const remoteNorm = makeRemoteDiffOnlyInJournals();
    remoteNorm.currentView = "settings";
    remoteNorm.selectedDate = "2026-07-27";
    check(
      "UI状態キー(currentView/selectedDate)だけの差分ではsyncCoreEqualはtrueのまま",
      syncMod.syncCoreEqual(remoteNorm) === true
    );
  }

  // ===================== [B-6] unit14b: 8キーの和集合マージ(独立追記が両方残る) =====================
  // 独立レビュー2026-09-04指摘: 単位14のfail-close化だけだと、2端末で独立に追記される
  // reports/chainRuns/zeroSecThemeLog/migrationRitualLog/feedbackFiles/feedbackIngestedDates/
  // aiWorkProcessedIds(+zeroThinking.groups)が毎日「不一致」となり自動保存・自動pullが止まる
  // (A1-M1の拡大)。computeSyncMergeへ和集合マージを実装したので、
  //   (1) そのキーだけの差分ではsyncCoreEqualがtrueのまま(比較対象外=自動解決経路に入る)
  //   (2) 両端末で独立追記した内容が、マージ後・採用後とも両方残る
  //   (3) 同一id/日付/複合キーは重複排除されて1件になる
  // の3点を、実際のデータ形状(日付マップ/id+updatedAt配列/id非保持の複合キーログ/文字列集合)
  // ごとに固定する。

  console.log("[B-6a] reports(日付キーの和集合マージ): 両日とも残る");
  {
    const local = makeLocalWithPrimaryData();
    local.reports = { "2026-07-01": "ローカル限定の日報" };
    storeMod.setState(local);
    const remoteNorm = makeRemoteDiffOnlyInJournals();
    remoteNorm.reports = { "2026-07-02": "リモート限定の日報" };
    check("reportsだけの差分でもsyncCoreEqualはtrue(マージ対象=比較対象外)", syncMod.syncCoreEqual(remoteNorm) === true);
    const merged = syncMod.computeSyncMerge(remoteNorm, "remote");
    check(
      "マージ結果に両日の日報が残る",
      merged.values.reports["2026-07-01"] === "ローカル限定の日報" && merged.values.reports["2026-07-02"] === "リモート限定の日報",
      JSON.stringify(merged.values.reports)
    );
    syncMod.applySyncMergeToRemote(merged, remoteNorm);
    check(
      "リモート採用後も両日の日報が残る(採用で消えない)",
      remoteNorm.reports["2026-07-01"] === "ローカル限定の日報" && remoteNorm.reports["2026-07-02"] === "リモート限定の日報",
      JSON.stringify(remoteNorm.reports)
    );
    // unit14b差し戻し(独立レビュー2026-09-05): applySyncMergeToLocal(state.reportsへの反映)も
    // 同じ観点で固定する(applySyncMergeToRemoteだけでなくローカル基準経路も回帰対象にする)。
    syncMod.applySyncMergeToLocal(merged);
    check(
      "ローカル採用後も両日の日報が残る(state.reportsへ反映される)",
      storeMod.state.reports["2026-07-01"] === "ローカル限定の日報" && storeMod.state.reports["2026-07-02"] === "リモート限定の日報",
      JSON.stringify(storeMod.state.reports)
    );
  }

  console.log("[B-6b] id+updatedAt配列(chainRuns/zeroThinking.groups): 和集合+同一idは新しい方1件");
  {
    const idArraySpecs = [
      {
        label: "chainRuns", stateKey: "chainRuns", valuesKey: "chainRuns",
        localOnly: { id: "chainA_2026-07-01", chainId: "chainA", date: "2026-07-01", currentIndex: 0, updatedAt: "2026-07-01T08:00:00" },
        remoteOnly: { id: "chainB_2026-07-03", chainId: "chainB", date: "2026-07-03", currentIndex: 0, updatedAt: "2026-07-03T08:00:00" },
        sharedLocal: { id: "shared_2026-07-02", chainId: "shared", date: "2026-07-02", currentIndex: 1, updatedAt: "2026-07-02T08:00:00" },
        sharedRemote: { id: "shared_2026-07-02", chainId: "shared", date: "2026-07-02", currentIndex: 3, updatedAt: "2026-07-02T09:00:00" },
        winnerField: "currentIndex", winnerValue: 3
      },
      {
        label: "zeroThinking.groups", stateKey: null, valuesKey: "zeroThinkingGroups",
        localOnly: { id: "g-local", title: "ローカル限定大テーマ", order: 0, createdAt: "2026-07-01T08:00:00" },
        remoteOnly: { id: "g-remote", title: "リモート限定大テーマ", order: 0, createdAt: "2026-07-03T08:00:00" },
        sharedLocal: { id: "g-shared", title: "旧タイトル", order: 0, createdAt: "2026-07-02T08:00:00", updatedAt: "2026-07-02T08:00:00" },
        sharedRemote: { id: "g-shared", title: "リネーム後タイトル", order: 0, createdAt: "2026-07-02T08:00:00", updatedAt: "2026-07-02T09:00:00" },
        winnerField: "title", winnerValue: "リネーム後タイトル"
      }
    ];
    for (const spec of idArraySpecs) {
      const local = makeLocalWithPrimaryData();
      const remoteNorm = makeRemoteDiffOnlyInJournals();
      if (spec.stateKey) {
        local[spec.stateKey] = [spec.localOnly, spec.sharedLocal];
        remoteNorm[spec.stateKey] = [spec.remoteOnly, spec.sharedRemote];
      } else {
        local.zeroThinking = { entries: [], suggestedThemes: [], groups: [spec.localOnly, spec.sharedLocal] };
        remoteNorm.zeroThinking = { entries: [], suggestedThemes: [], groups: [spec.remoteOnly, spec.sharedRemote] };
      }
      storeMod.setState(local);
      check(`${spec.label}だけの差分でもsyncCoreEqualはtrue`, syncMod.syncCoreEqual(remoteNorm) === true);
      const merged = syncMod.computeSyncMerge(remoteNorm, "remote");
      const list = merged.values[spec.valuesKey];
      const ids = list.map((x) => x.id).sort();
      check(
        `${spec.label}: 両端末限定のidが両方残る(和集合)`,
        ids.includes(spec.localOnly.id) && ids.includes(spec.remoteOnly.id), JSON.stringify(ids)
      );
      check(
        `${spec.label}: 同一idは重複排除され1件`,
        list.filter((x) => x.id === spec.sharedLocal.id).length === 1, JSON.stringify(list)
      );
      const shared = list.find((x) => x.id === spec.sharedLocal.id);
      check(
        `${spec.label}: 同一idはupdatedAtが新しい方(リモート)が勝つ`,
        shared[spec.winnerField] === spec.winnerValue, JSON.stringify(shared)
      );
      // unit14b差し戻し(独立レビュー2026-09-05): applySyncMergeToLocalでもstate側
      // (state.chainRuns / state.zeroThinking.groups)へ同じ内容が反映されることを固定する。
      syncMod.applySyncMergeToLocal(merged);
      const localList = spec.stateKey ? storeMod.state[spec.stateKey] : storeMod.state.zeroThinking.groups;
      const localIds = localList.map((x) => x.id).sort();
      check(
        `${spec.label}: applySyncMergeToLocal後も両端末限定のidが両方state側に反映される`,
        localIds.includes(spec.localOnly.id) && localIds.includes(spec.remoteOnly.id), JSON.stringify(localIds)
      );
      const localShared = localList.find((x) => x.id === spec.sharedLocal.id);
      check(
        `${spec.label}: applySyncMergeToLocal後も同一idはupdatedAtが新しい方(リモート)が勝つ`,
        localShared && localShared[spec.winnerField] === spec.winnerValue, JSON.stringify(localShared)
      );
    }
  }

  console.log("[B-6c] id非保持の複合キーログ(zeroSecThemeLog/migrationRitualLog): 和集合+同一キーは重複排除");
  {
    const logSpecs = [
      {
        label: "zeroSecThemeLog", stateKey: "zeroSecThemeLog", valuesKey: "zeroSecThemeLog",
        dupKeyField: "theme",
        localItems: [
          { date: "2026-07-01", theme: "共通の重複キー", at: "2026-07-01T08:00:00", reason: "", outcome: "skipped" },
          { date: "2026-07-01", theme: "ローカル限定", at: "2026-07-01T09:00:00", reason: "", outcome: "skipped" }
        ],
        remoteItems: [
          { date: "2026-07-01", theme: "共通の重複キー", at: "2026-07-01T08:00:00", reason: "", outcome: "skipped" },  // localと同一キー
          { date: "2026-07-02", theme: "リモート限定", at: "2026-07-02T08:00:00", reason: "", outcome: "skipped" }
        ]
      },
      {
        label: "migrationRitualLog", stateKey: "migrationRitualLog", valuesKey: "migrationRitualLog",
        dupKeyField: "choice",
        localItems: [
          { blockId: "b1", title: "共通ブロック", carryCount: 1, choice: "carry", at: "2026-07-01T08:00:00" },
          { blockId: "b2", title: "ローカル限定ブロック", carryCount: 1, choice: "release", at: "2026-07-01T09:00:00" }
        ],
        remoteItems: [
          { blockId: "b1", title: "共通ブロック", carryCount: 1, choice: "carry", at: "2026-07-01T08:00:00" },  // localと同一キー
          { blockId: "b3", title: "リモート限定ブロック", carryCount: 1, choice: "decompose", at: "2026-07-02T08:00:00" }
        ]
      }
    ];
    for (const spec of logSpecs) {
      const local = makeLocalWithPrimaryData();
      local[spec.stateKey] = spec.localItems;
      storeMod.setState(local);
      const remoteNorm = makeRemoteDiffOnlyInJournals();
      remoteNorm[spec.stateKey] = spec.remoteItems;
      check(`${spec.label}だけの差分でもsyncCoreEqualはtrue`, syncMod.syncCoreEqual(remoteNorm) === true);
      const merged = syncMod.computeSyncMerge(remoteNorm, "remote");
      const list = merged.values[spec.valuesKey];
      const localOnlyLabel = spec.localItems[1][spec.dupKeyField];
      const remoteOnlyLabel = spec.remoteItems[1][spec.dupKeyField];
      const dupLabel = spec.localItems[0][spec.dupKeyField];
      check(
        `${spec.label}: 両端末限定のログが両方残る`,
        list.some((e) => e[spec.dupKeyField] === localOnlyLabel) && list.some((e) => e[spec.dupKeyField] === remoteOnlyLabel),
        JSON.stringify(list)
      );
      check(
        `${spec.label}: 同一の複合キー(at+主要フィールド)は重複排除され1件`,
        list.filter((e) => e[spec.dupKeyField] === dupLabel).length === 1, JSON.stringify(list)
      );
      // unit14b差し戻し(独立レビュー2026-09-05): applySyncMergeToLocalでもstate側へ
      // 同じ内容(両端末分の残存+重複排除)が反映されることを固定する。
      syncMod.applySyncMergeToLocal(merged);
      const localList = storeMod.state[spec.stateKey];
      check(
        `${spec.label}: applySyncMergeToLocal後も両端末限定のログがstate側に両方残る`,
        localList.some((e) => e[spec.dupKeyField] === localOnlyLabel) && localList.some((e) => e[spec.dupKeyField] === remoteOnlyLabel),
        JSON.stringify(localList)
      );
      check(
        `${spec.label}: applySyncMergeToLocal後も同一の複合キーはstate側で1件に集約される`,
        localList.filter((e) => e[spec.dupKeyField] === dupLabel).length === 1, JSON.stringify(localList)
      );
    }
  }

  console.log("[B-6d] 文字列集合(feedbackFiles/feedbackIngestedDates/aiWorkProcessedIds): 和集合+重複排除");
  {
    const setSpecs = [
      { label: "feedbackFiles", stateKey: "feedbackFiles", localOnly: "2026-07-01", remoteOnly: "2026-07-02", dup: "2026-06-30" },
      { label: "feedbackIngestedDates", stateKey: "feedbackIngestedDates", localOnly: "2026-07-01", remoteOnly: "2026-07-02", dup: "2026-06-30" },
      { label: "aiWorkProcessedIds", stateKey: "aiWorkProcessedIds", localOnly: "reqLocal", remoteOnly: "reqRemote", dup: "reqShared" }
    ];
    for (const spec of setSpecs) {
      const local = makeLocalWithPrimaryData();
      local[spec.stateKey] = [spec.dup, spec.localOnly];
      storeMod.setState(local);
      const remoteNorm = makeRemoteDiffOnlyInJournals();
      remoteNorm[spec.stateKey] = [spec.dup, spec.remoteOnly];
      check(`${spec.label}だけの差分でもsyncCoreEqualはtrue`, syncMod.syncCoreEqual(remoteNorm) === true);
      const merged = syncMod.computeSyncMerge(remoteNorm, "remote");
      const list = merged.values[spec.stateKey];
      check(
        `${spec.label}: 両端末限定の値が両方残る`,
        list.includes(spec.localOnly) && list.includes(spec.remoteOnly), JSON.stringify(list)
      );
      check(
        `${spec.label}: 重複する値は1件に集約される`,
        list.filter((x) => x === spec.dup).length === 1, JSON.stringify(list)
      );
      // unit14b差し戻し(独立レビュー2026-09-05): applySyncMergeToLocalでもstate側へ
      // 同じ内容(両端末分の残存+重複排除)が反映されることを固定する。
      syncMod.applySyncMergeToLocal(merged);
      const localList = storeMod.state[spec.stateKey];
      check(
        `${spec.label}: applySyncMergeToLocal後も両端末限定の値がstate側に両方残る`,
        localList.includes(spec.localOnly) && localList.includes(spec.remoteOnly), JSON.stringify(localList)
      );
      check(
        `${spec.label}: applySyncMergeToLocal後も重複する値はstate側で1件に集約される`,
        localList.filter((x) => x === spec.dup).length === 1, JSON.stringify(localList)
      );
    }
  }

  console.log(failures === 0 ? "\nstore-core: 全件成功" : `\nstore-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
