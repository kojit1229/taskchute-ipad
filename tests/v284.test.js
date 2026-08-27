// v284: IRON LOG gym[]の同期マージによる全消失・削除復活・属性破壊を防ぐ。
// 純粋マージ、実同期適用、normalize永続化、IRON LOG/journal両削除導線を固定する。
const path = require("path");
const { pathToFileURL } = require("url");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
const TODAY = "2026-08-27";
const OTHER_DAY = "2026-08-26";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function gymSet(exercise, at, weight, reps, extra = {}) {
  return { exercise, at: `${TODAY}T${at}`, weight, reps, ...extra };
}

function json(value) { return JSON.stringify(value); }
function withoutIds(list) {
  return list.map(({ id, ...set }) => set).sort((a, b) => json(a).localeCompare(json(b)));
}
function sameWithoutIds(actual, expected) { return json(withoutIds(actual)) === json(withoutIds(expected)); }

function baseSyncState(logs) {
  return {
    journalMeta: {}, settings: { journalTemplate: "", morningEnergyLog: {}, github: {} },
    journals: {}, feedback: {}, condition: { logs }, sleep: { logs: {} },
    blocks: [], zeroThinking: { entries: [], suggestedThemes: [] },
    dailyDeclarations: {}, weeklyWishes: {}, bodyScans: [], tasks: [], projects: [], storeVisits: [],
    tracks: [], trackMeasurements: [], weeklyCommitments: [], swipeTriageLog: [], gardenLog: {},
    coachLog: { meals: [], settings: {} }, aiStepProcessedIds: [], aiStepDismissedIds: [],
    aiStepPendingRequests: [], aiReportReadIds: [], dataModifiedAt: `${TODAY}T12:00:00`
  };
}

async function verifyPureMergeAndSync() {
  const mergeMod = await import(pathToFileURL(path.join(ROOT, "src", "core", "merge.js")).href);
  const ironMod = await import(pathToFileURL(path.join(ROOT, "src", "features", "iron-log.js")).href);
  const instrumentsMod = await import(pathToFileURL(path.join(ROOT, "src", "features", "instruments.js")).href);
  const storeMod = await import(pathToFileURL(path.join(ROOT, "src", "state", "store.js")).href);
  const syncMod = await import(pathToFileURL(path.join(ROOT, "src", "sync", "github.js")).href);
  const { mergeGymSets, normalizeGymSetIds } = mergeMod;

  const localFour = [
    gymSet("ベンチプレス", "18:00", 60, 10, { blockId: "block-bench" }),
    gymSet("ベンチプレス", "18:05", 65, 8),
    gymSet("スクワット", "18:15", 80, 10),
    gymSet("デッドリフト", "18:30", 100, 5, { blockId: "block-dead" })
  ];

  console.log("[1] id有無・多重集合・壊れ値を安全にマージ");
  const reproduced = mergeGymSets(localFour, []);
  check("再現形: id無しlocal 4件×remote空でも全内容が残る",
    reproduced.length === 4 && sameWithoutIds(reproduced, localFour), json(reproduced));

  const shared = gymSet("ショルダープレス", "19:10", 30, 8, { blockId: "block-shared" });
  const legacyUnion = mergeGymSets([shared, gymSet("A", "19:20", 10, 1)], [
    { ...shared }, gymSet("B", "19:25", 20, 2)
  ]);
  check("id無し同士は共通コピーだけ除き全フィールドを温存",
    legacyUnion.length === 3 && sameWithoutIds(legacyUnion, [shared, gymSet("A", "19:20", 10, 1), gymSet("B", "19:25", 20, 2)]),
    json(legacyUnion));

  const duplicateLegacy = [shared, { ...shared }];
  const multiset = mergeGymSets(duplicateLegacy, [{ ...shared }]);
  check("同一端末内の正当な同内容2セットを多重集合として維持",
    multiset.length === 2 && sameWithoutIds(multiset, duplicateLegacy), json(multiset));
  check("片側だけnullでも正常側の全内容を双方向で温存",
    sameWithoutIds(mergeGymSets(localFour, null), localFour)
      && sameWithoutIds(mergeGymSets(null, localFour), localFour));

  const regular = gymSet("通常ID", "19:30", 40, 4, { id: "uuid-1", blockId: "block-regular" });
  const mixedSame = mergeGymSets([{ ...shared }], [{ ...shared, id: "uuid-shared" }]);
  const mixedDifferentLR = mergeGymSets([{ ...shared }], [regular]);
  const mixedDifferentRL = mergeGymSets([regular], [{ ...shared }]);
  check("v283 id無し×v284 id有りは同内容コピーを1件へ収束",
    mixedSame.length === 1 && mixedSame[0].id === "uuid-shared"
      && mergeGymSets(mixedSame, [{ ...shared }]).length === 1, json(mixedSame));
  check("新旧端末の異内容セットは順方向・逆方向とも欠落や重複なし",
    mixedDifferentLR.length === 2 && mixedDifferentRL.length === 2
      && sameWithoutIds(mixedDifferentLR, mixedDifferentRL), json({ mixedDifferentLR, mixedDifferentRL }));

  const chronological = mergeGymSets(
    [gymSet("後", "18:30", 10, 1)], [gymSet("先", "18:00", 10, 1), gymSet("中", "18:15", 10, 1)]
  );
  check("マージ結果はat昇順", json(chronological.map((s) => s.exercise)) === json(["先", "中", "後"]));

  console.log("[2] 移行IDは決定論的・属性安全でblockIdを維持");
  const source = [shared, { ...shared }, regular];
  const normalizedA = normalizeGymSetIds(TODAY, structuredClone(source));
  const normalizedB = normalizeGymSetIds(TODAY, structuredClone(source));
  check("独立normalizeで同一入力から同一ID列を生成",
    json(normalizedA.map((s) => s.id)) === json(normalizedB.map((s) => s.id)));
  check("移行IDは英数字とハイフンだけの不透明トークンで同内容出現順も区別",
    normalizedA.slice(0, 2).every((s) => /^gymlegacy-[0-9a-f]{16}$/.test(s.id))
      && normalizedA[0].id !== normalizedA[1].id, json(normalizedA.map((s) => s.id)));
  check("normalizeは既存IDと全セット属性を維持し往復でIDを変えない",
    sameWithoutIds(normalizedA, source) && normalizedA[2].id === "uuid-1"
      && json(normalizeGymSetIds(TODAY, normalizedA)) === json(normalizedA), json(normalizedA));
  const repairedTombstone = normalizeGymSetIds(TODAY, [
    { ...shared, id: "broken-delete", deleted: true }, null, "broken"
  ]);
  check("壊れtombstoneを補完し非オブジェクト要素を安全に除外",
    repairedTombstone.length === 1 && repairedTombstone[0].deletedAt === shared.at
      && repairedTombstone[0].updatedAt === shared.at, json(repairedTombstone));

  console.log("[3] ID付きLWW・tombstone・集計除外");
  const old = gymSet("旧", "20:00", 50, 10, { id: "same", createdAt: `${TODAY}T20:00`, updatedAt: `${TODAY}T20:00` });
  const newer = { ...old, exercise: "新", updatedAt: `${TODAY}T20:05`, blockId: "block-new" };
  check("LWWはremote更新が新しい方向とlocal更新が新しい方向の両方で新を選ぶ",
    mergeGymSets([old], [newer])[0].exercise === "新" && mergeGymSets([newer], [old])[0].exercise === "新");
  const createdOld = { ...old, id: "created-only", updatedAt: undefined, createdAt: `${TODAY}T19:00` };
  const createdNew = { ...createdOld, exercise: "created新", createdAt: `${TODAY}T19:05` };
  const tieRemote = { ...old, exercise: "remote同値" };
  check("updatedAt無しはcreatedAtへフォールバックし、同値の通常レコードはlocal優先",
    mergeGymSets([createdOld], [createdNew])[0].exercise === "created新"
      && mergeGymSets([old], [tieRemote])[0].exercise === "旧");

  const live = gymSet("削除対象", "20:30", 70, 10, {
    id: "delete-me", createdAt: `${TODAY}T20:30`, updatedAt: `${TODAY}T20:30`, blockId: "block-delete"
  });
  const tombstone = { ...live, deleted: true, deletedAt: `${TODAY}T20:35`, updatedAt: `${TODAY}T20:35` };
  const deletedLR = mergeGymSets([tombstone], [live]);
  const deletedRL = mergeGymSets([live], [tombstone]);
  const deletedVsLegacy = mergeGymSets([tombstone], [{ ...live, id: undefined }]);
  check("削除tombstoneは旧liveが残るpullでも双方向に勝ち、id無し旧コピーも復活させない",
    deletedLR.length === 1 && deletedLR[0].deleted && deletedRL[0].deleted && deletedVsLegacy[0].deleted,
    json({ deletedLR, deletedRL, deletedVsLegacy }));
  const aggregateState = { condition: { logs: { [TODAY]: { gym: [regular, tombstone] } } } };
  check("tombstoneはIRON LOGと計器盤の集計から除外",
    ironMod.ironTotals(aggregateState).lifetimeKg === 160
      && instrumentsMod.ironSummary(aggregateState, TODAY).todayKg === 160);

  console.log("[4] computeSyncMerge実配線とlocal/remote適用");
  const noop = () => {};
  syncMod.configureGithubSync({
    normalizeState: (value) => {
      for (const [date, log] of Object.entries(value.condition?.logs || {})) {
        if (log && typeof log === "object") log.gym = normalizeGymSetIds(date, log.gym);
      }
      return value;
    },
    nowDateTime: () => `${TODAY}T21:00:00`, todayISO: () => TODAY, addDays: (d) => d,
    isTouchedBlock: () => false, RECURRENCE_KEEP_PAST_DAYS: 7, RECURRENCE_FUTURE_DAYS: 31,
    SWIPE_TRIAGE_LOG_MAX: 200, showToast: noop, maintainRecurrences: noop, render: noop,
    runDailyOpen: () => false, saveState: noop, requireGitHubConfig: noop, fetchGitHubFileSHA: noop,
    personalDataReady: () => true, personalDataFileConfig: noop, gitHubContentsURL: noop,
    githubHeaders: noop, gitHubErrorMessage: noop, fromBase64: noop, toBase64: noop,
    sanitizedStateForGitHub: noop, maybeWriteBackupSnapshot: noop, updateAutoSaveStatus: noop,
    updateSyncDot: noop, renderSyncBanner: noop, pruneExpiredSuggestedThemes: (x) => x,
    _startupDataModifiedAt: ""
  });
  const rawLocal = baseSyncState({
    [TODAY]: {
      sleepHours: 6, morningRecordedAt: `${TODAY}T07:00`, eveningMood: 4,
      eveningNote: "local evening", eveningRecordedAt: `${TODAY}T21:00`, gym: structuredClone(localFour)
    }
  });
  const remoteRaw = baseSyncState({
    [TODAY]: { sleepHours: 8, morningRecordedAt: `${TODAY}T08:00` },
    [OTHER_DAY]: { gym: [{ ...gymSet("別日", "09:00", 10, 10), at: `${OTHER_DAY}T09:00` }] }
  });

  storeMod.setState(structuredClone(rawLocal));
  let remoteNorm = syncMod.normalizedRemoteCopy(json(remoteRaw));
  let syncMerge = syncMod.computeSyncMerge(remoteNorm, "local");
  const todayMerged = syncMerge?.values.conditionLogs[TODAY];
  check("ID無しlocalを事前ID化せずcomputeSyncMergeへ通しても全内容が残る",
    todayMerged?.gym.length === 4 && sameWithoutIds(todayMerged.gym, localFour), json(todayMerged?.gym));
  check("新しい朝だけremote、より新しい夜はlocal、別日セットは別日に維持",
    todayMerged?.sleepHours === 8 && todayMerged?.eveningNote === "local evening"
      && todayMerged.gym.every((s) => s.exercise !== "別日")
      && syncMerge.values.conditionLogs[OTHER_DAY].gym.length === 1);
  check("applySyncMergeToLocalが計算結果を実stateへ反映",
    syncMod.applySyncMergeToLocal(syncMerge)
      && storeMod.state.condition.logs[TODAY].gym.length === 4
      && storeMod.state.condition.logs[TODAY].sleepHours === 8);

  storeMod.setState(structuredClone(rawLocal));
  remoteNorm = syncMod.normalizedRemoteCopy(json(remoteRaw));
  syncMerge = syncMod.computeSyncMerge(remoteNorm, "remote");
  check("applySyncMergeToRemoteがlocal限定セットとblockIdを採用予定stateへ反映",
    syncMod.applySyncMergeToRemote(syncMerge, remoteNorm)
      && remoteNorm.condition.logs[TODAY].gym.length === 4
      && remoteNorm.condition.logs[TODAY].gym.some((s) => s.blockId === "block-dead"), json(remoteNorm.condition.logs[TODAY].gym));

  const deletedLocal = baseSyncState({ [TODAY]: { gym: [tombstone] } });
  const staleRemote = baseSyncState({ [TODAY]: { gym: [live] } });
  storeMod.setState(deletedLocal);
  remoteNorm = syncMod.normalizedRemoteCopy(json(staleRemote));
  syncMerge = syncMod.computeSyncMerge(remoteNorm, "remote");
  syncMod.applySyncMergeToRemote(syncMerge, remoteNorm);
  check("pull相当の実配線でも削除は復活せずtombstoneが相手側へ同期",
    remoteNorm.condition.logs[TODAY].gym.length === 1 && remoteNorm.condition.logs[TODAY].gym[0].deleted,
    json(remoteNorm.condition.logs[TODAY].gym));
}

async function verifyBrowserMigrationAndCrud() {
  console.log("[5] normalize保存・UUID一意性・IRON LOG/journal削除");
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await blockGithubApiByDefault(page);
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    const legacy = [
      gymSet("ベンチプレス", "18:00", 60, 10, { blockId: "block-browser" }),
      gymSet("スクワット", "18:10", 80, 10)
    ];
    await page.evaluate(({ KEY, TODAY, legacy }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "iron-log";
      s.selectedDate = TODAY;
      s.condition.logs[TODAY] = { gym: legacy };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY: STATE_KEY, TODAY, legacy });
    await page.reload();
    await page.waitForSelector('#app[data-view="iron-log"] .iron-set-row');
    check("既存index描画は元配列index 0,1のまま",
      await page.locator('[data-action="iron-delete-set"][data-id="0"]').count() === 1
        && await page.locator('[data-action="iron-delete-set"][data-id="1"]').count() === 1);

    for (let i = 0; i < 2; i++) {
      await page.selectOption("#ironFormExercise", "デッドリフト");
      await page.fill("#ironFormWeight", "100");
      await page.fill("#ironFormReps", "5");
      await page.click('[data-action="iron-add-set"]');
      await page.waitForFunction((count) => document.querySelectorAll(".iron-set-row").length === count, 3 + i);
    }
    const afterSave = await page.evaluate(({ KEY, TODAY }) =>
      JSON.parse(localStorage.getItem(KEY)).condition.logs[TODAY].gym, { KEY: STATE_KEY, TODAY });
    check("移行IDは属性安全でblockIdを保持しsave→reload後も固定",
      afterSave.slice(0, 2).every((s) => /^gymlegacy-[0-9a-f]{16}$/.test(s.id))
        && afterSave[0].blockId === "block-browser", json(afterSave));
    check("新規セット複数件のUUIDは非空・相互一意でcreatedAt/updatedAt付き",
      new Set(afterSave.map((s) => s.id)).size === 4
        && afterSave.slice(2).every((s) => s.id && !s.id.startsWith("gymlegacy-")
          && s.createdAt === s.at && s.updatedAt === s.at), json(afterSave));

    const savedIds = afterSave.map((s) => s.id);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll(".iron-set-row").length === 4);
    const afterReload = await page.evaluate(({ KEY, TODAY }) =>
      JSON.parse(localStorage.getItem(KEY)).condition.logs[TODAY].gym, { KEY: STATE_KEY, TODAY });
    check("normalize往復でIDを二重付与せず全フィールドを維持", json(afterReload.map((s) => s.id)) === json(savedIds)
      && afterReload[0].blockId === "block-browser");

    await page.click('[data-action="iron-delete-set"][data-id="1"]');
    await page.waitForFunction(() => document.querySelectorAll(".iron-set-row").length === 3);
    const afterIronDelete = await page.evaluate(({ KEY, TODAY }) =>
      JSON.parse(localStorage.getItem(KEY)).condition.logs[TODAY].gym, { KEY: STATE_KEY, TODAY });
    const displayedTotal = Number((await page.locator(".iron-total span").textContent()).replace(/\D/g, ""));
    check("IRON LOG index削除は物理削除せずtombstone化し表示・集計から除外",
      afterIronDelete.length === 4 && afterIronDelete[1].deleted && afterIronDelete[1].deletedAt
        && afterIronDelete[1].updatedAt === afterIronDelete[1].deletedAt && displayedTotal === 1600,
      json({ afterIronDelete, displayedTotal }));

    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "journal";
      s.selectedDate = TODAY;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY: STATE_KEY, TODAY });
    await page.reload();
    await page.waitForSelector('#app[data-view="journal"] .cond-gym-card');
    const legacyId = afterIronDelete[0].id;
    const journalDelete = page.locator(`[data-action="delete-gym-entry"][data-id="${legacyId}"]`);
    check("移行IDがjournalのdata-id属性で壊れず一意に描画", await journalDelete.count() === 1, legacyId);
    await journalDelete.click();
    await page.waitForFunction((id) => !document.querySelector(`[data-action="delete-gym-entry"][data-id="${id}"]`), legacyId);
    const afterJournalDelete = await page.evaluate(({ KEY, TODAY }) =>
      JSON.parse(localStorage.getItem(KEY)).condition.logs[TODAY].gym, { KEY: STATE_KEY, TODAY });
    check("journal削除も対象セットをtombstone化して他セットを維持",
      afterJournalDelete.length === 4 && afterJournalDelete[0].deleted
        && afterJournalDelete.filter((s) => !s.deleted).length === 2, json(afterJournalDelete));
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }
}

(async () => {
  await verifyPureMergeAndSync();
  await verifyBrowserMigrationAndCrud();
  console.log(failures === 0 ? "\n✅ v284: 全テスト成功" : `\n❌ v284: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
