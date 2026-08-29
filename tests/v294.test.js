// v294: 「書く瞑想」パネル(充放電ログ改善計画R1a)。ジャーナルタブへNIGHT BRIEFとFREE LOGの
// 間に新details「書く瞑想」を追加し、独立state(state.writeMeditations、bodyScansと同型の
// mergeById同期コレクション、1日1レコード)へ保存・同期し、日報「## 書く瞑想」節へ出力する。
//
// [sync-*] computeSyncMerge/applySyncMergeToLocal/applySyncMergeToRemoteのidキー和集合マージ
//          (updatedAt新しい方が勝つ)・remote欠落時のfail-close(store-core/track-sync-
//          characterizationと同じNode ESM直import方式、v129のbodyScans節を踏襲)
// (a) 全経路: チップ追加(放電・充電各)→保存→リロード後も保持 / 深掘りtextareaの保存 /
//     チップ削除 / 節見出し要約の更新
// (b) 負例: 空のまま保存→日報に節が出ない / チップ追加中にフォーカスが飛ばない(同一DOM
//     ノード・全体再描画なしの間接検証) / state.journals[date]が変化しない
// (c) 永続化: saveState経由でdataModifiedAt更新
// (d) 退行: 既存ジャーナルタブの全節(MORNING/NIGHT/FREE LOG)・日報生成の既存節が無改修で
//     通過 / 390px横スクロールなし
const path = require("path");
const { pathToFileURL } = require("url");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY, generateReportThroughGate
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
const TODAY = "2026-08-29";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function noop() {}

function configureMinimalStubs(syncMod) {
  syncMod.configureGithubSync({
    normalizeState: (x) => x,
    nowDateTime: () => "2026-08-29T12:00:00",
    todayISO: () => "2026-08-29", addDays: (d) => d, isTouchedBlock: () => false,
    RECURRENCE_KEEP_PAST_DAYS: 7, RECURRENCE_FUTURE_DAYS: 31, SWIPE_TRIAGE_LOG_MAX: 200,
    showToast: noop, maintainRecurrences: noop, render: noop, runDailyOpen: () => false, saveState: noop,
    requireGitHubConfig: noop, fetchGitHubFileSHA: noop, personalDataReady: () => true, personalDataFileConfig: noop,
    gitHubContentsURL: noop, githubHeaders: noop, gitHubErrorMessage: noop, fromBase64: noop, toBase64: noop,
    sanitizedStateForGitHub: noop, maybeWriteBackupSnapshot: noop, updateAutoSaveStatus: noop, updateSyncDot: noop,
    renderSyncBanner: noop, pruneExpiredSuggestedThemes: (x) => x, _startupDataModifiedAt: ""
  });
}

// track-sync-characterization.test.jsと同じ完全なstate(computeSyncMergeが参照する全キーを
// そろえる。一部だけ欠けていると、writeMeditations以外のキーでの意図しないTypeErrorが
// try/catchに飲まれてfalse-negativeになるため)。あえてwriteMeditationsキー自体だけを
// 省略したい場合はdeleteで個別に落とす(fail-close検証、[sync-3]で使う)。
function baseState(extra = {}) {
  return {
    journalMeta: {}, settings: { journalTemplate: "", morningEnergyLog: {}, github: {} },
    journals: {}, feedback: {}, condition: { logs: {} }, sleep: { logs: {} },
    blocks: [], zeroThinking: { entries: [], suggestedThemes: [] },
    dailyDeclarations: {}, weeklyWishes: {}, bodyScans: [], tasks: [], projects: [], storeVisits: [],
    tracks: [], trackMeasurements: [], weeklyCommitments: [], swipeTriageLog: [], gardenLog: {},
    coachLog: { settings: {}, meals: [] }, aiStepProcessedIds: [], aiStepDismissedIds: [],
    aiStepPendingRequests: [], aiReportReadIds: [],
    recurrences: [], declarations: [], questions: [], experiments: [], earlyBird: { logs: {} },
    dataModifiedAt: "2026-08-29T10:00:00",
    ...extra
  };
}

function wm(text, updatedAt, id = "d1", date = TODAY) {
  return {
    id: "wm_" + date, date,
    discharge: [{ id, text }], charge: [], dischargeTalk: "", chargeTalk: "",
    updatedAt, deleted: false
  };
}

async function verifyPureSyncMerge() {
  const storeMod = await import(pathToFileURL(path.join(ROOT, "src", "state", "store.js")).href);
  const syncMod = await import(pathToFileURL(path.join(ROOT, "src", "sync", "github.js")).href);
  configureMinimalStubs(syncMod);

  console.log("[sync-1] remoteの新しい編集(updatedAt新しい方)がlocalへ採用される(mergeById、bodyScansと同型)");
  {
    const local = baseState({ writeMeditations: [wm("local版", `${TODAY}T09:00:00`)] });
    const remote = baseState({ writeMeditations: [wm("remote版", `${TODAY}T10:00:00`)] });
    storeMod.setState(local);
    const merged = syncMod.computeSyncMerge(remote, "local");
    check("computeSyncMergeが例外なく値を返す", merged !== null);
    check("changedVsLocalが立つ", merged?.changedVsLocal === true);
    syncMod.applySyncMergeToLocal(merged);
    check("remoteの新しい編集がlocalへ採用される",
      storeMod.state.writeMeditations[0].discharge[0].text === "remote版",
      JSON.stringify(storeMod.state.writeMeditations));
  }

  console.log("[sync-2] localの新しい編集がremote採用経路でも消えない");
  {
    const local = baseState({ writeMeditations: [wm("local新", `${TODAY}T11:00:00`, "d2")] });
    const remoteNorm = baseState({ writeMeditations: [wm("remote旧", `${TODAY}T09:00:00`, "d3")] });
    storeMod.setState(local);
    const merged = syncMod.computeSyncMerge(remoteNorm, "remote");
    check("applySyncMergeToRemoteがlocalの新しい編集を採用予定stateへ反映",
      syncMod.applySyncMergeToRemote(merged, remoteNorm)
        && remoteNorm.writeMeditations[0].discharge[0].text === "local新",
      JSON.stringify(remoteNorm.writeMeditations));
  }

  console.log("[sync-3] 欠損フィールド後方互換: remote側にwriteMeditations自体が無くても(旧state)localが消えない");
  {
    const local = baseState({ writeMeditations: [wm("保持されるべき", `${TODAY}T09:00:00`, "d4")] });
    const remote = baseState();
    delete remote.writeMeditations;
    storeMod.setState(local);
    const merged = syncMod.computeSyncMerge(remote, "local");
    check("remote欠落でもcomputeSyncMergeは例外化せずlocalの内容を残す",
      merged !== null && merged.values.writeMeditations.length === 1
        && merged.values.writeMeditations[0].discharge[0].text === "保持されるべき",
      JSON.stringify(merged?.values.writeMeditations));
  }

  console.log("[sync-4] mergeByIdの和集合検証: 異なる日付(=異なるid)のlocal限定・remote限定レコードが1件ずつでもmerge結果は2件の和集合になる");
  {
    const YDAY = "2026-08-28";
    const local = baseState({ writeMeditations: [wm("local限定(前日分、和集合検証)", `${YDAY}T09:00:00`, "d5", YDAY)] });
    const remote = baseState({ writeMeditations: [wm("remote限定(当日分、和集合検証)", `${TODAY}T09:00:00`, "d6", TODAY)] });
    storeMod.setState(local);
    const merged = syncMod.computeSyncMerge(remote, "local");
    const mergedIds = (merged?.values.writeMeditations || []).map((w) => w.id).sort();
    check("id違い(異なる日付)のlocal限定・remote限定レコードがどちらも消えず、merge結果は2件の和集合になる",
      merged !== null && merged.values.writeMeditations.length === 2, JSON.stringify(mergedIds));
    check("local限定レコード(前日分)が和集合に残る", mergedIds.includes(`wm_${YDAY}`), JSON.stringify(mergedIds));
    check("remote限定レコード(当日分)も和集合として採用される", mergedIds.includes(`wm_${TODAY}`), JSON.stringify(mergedIds));
  }
}

function makeBlock({ id, title, startMin, TODAY }) {
  const pad2 = (n) => String(n).padStart(2, "0");
  const hhmm = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  return {
    id, taskId: "", date: TODAY, title, category: "",
    plannedStartAt: `${TODAY}T${hhmm(startMin)}`, plannedEndAt: `${TODAY}T${hhmm(startMin + 30)}`,
    actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
    comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
    carryCount: 0, isMIT: false, source: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false
  };
}

async function verifyBrowserPanel() {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  // writeMeditationsは既定で毎回[]へリセットする(各[N]シナリオを前段の蓄積から独立させる。
  // v129のseed()がbodyScansを既定[]にする方式と同じ)。リロード後の永続化検証はseed()を
  // 挟まずpage.reload()を直接呼ぶことで、リセットせず素通しする。blocksも既定[]にし、
  // デモ初期データの未完了Blockによる日次締めゲート(理由チップモーダル)の誤発火を防ぐ。
  async function seed({ view = "journal", journalText = "", writeMeditations = [], blocks = [] } = {}) {
    await page.evaluate(({ KEY, TODAY, view, journalText, writeMeditations, blocks }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.selectedDate = TODAY;
      s.currentView = view;
      s.writeMeditations = writeMeditations;
      s.blocks = blocks;
      if (journalText) { s.journals ||= {}; s.journals[TODAY] = journalText; }
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY: STATE_KEY, TODAY, view, journalText, writeMeditations, blocks });
    await page.reload();
    // 起動完了=#app[data-view]属性が指定viewへ確定するまで待つ(render()が毎回app.dataset.view
    // = state.currentViewをセットする。instruments-e2e.test.js等と同じ確立済みパターン)。
    await page.waitForSelector(`#app[data-view="${view}"]`, { state: "attached" });
  }
  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), STATE_KEY);
  }
  async function openKmSegment() {
    const seg = page.locator(".journal-segment-writeMeditation");
    if (!(await seg.evaluate((el) => el.open))) await seg.locator("summary").click();
    await page.waitForFunction(() => document.querySelector(".journal-segment-writeMeditation")?.open === true);
  }

  try {
    await page.clock.setFixedTime(new Date(2026, 7, 29, 19, 0, 0));  // 19時=既定open(夜18時判定)
    await page.goto(`http://localhost:${PORT}/`);
    // passGithubGateが直後にlocalStorage.getItem(KEY)を読むため、起動時に書き込まれる初期state
    // が揃うまで待つ。この時点ではtoken未設定でgate画面(render()内 app.dataset.view="gate")の
    // ため[data-action="nav"]は存在せず、nav待ちは使えない。
    await page.waitForFunction((KEY) => {
      try { return JSON.parse(localStorage.getItem(KEY)) !== null; } catch { return false; }
    }, STATE_KEY);
    await passGithubGate(page);

    console.log("[1] 既定開閉: 19時(夜18時以降)は開");
    await seed();
    check("19時は書く瞑想segmentが既定openになる",
      await page.locator(".journal-segment-writeMeditation").evaluate((el) => el.open));
    await openKmSegment();

    console.log("[2](a) チップ追加(放電・充電各)→保存→リロード後も保持 / 節見出し要約の更新");
    await page.fill("#km-discharge-input", "資料作成後の肩こり");
    await page.click('[data-action="km-chip-add"][data-kind="discharge"]');
    await page.waitForFunction(() => document.querySelectorAll("#km-discharge-list [data-action=\"km-chip-remove\"]").length === 1);
    check("放電チップが1件表示される", (await page.locator("#km-discharge-list [data-action=\"km-chip-remove\"]").count()) === 1);
    check("節見出し要約が「放電1件」を反映", (await page.locator("#km-oneliner").textContent()).includes("放電1件・充電0件"));

    await page.fill("#km-charge-input", "筋トレ 60kg×8");
    await page.click('[data-action="km-chip-add"][data-kind="charge"]');
    await page.waitForFunction(() => document.querySelectorAll("#km-charge-list [data-action=\"km-chip-remove\"]").length === 1);
    check("充電チップが1件表示される", (await page.locator("#km-charge-list [data-action=\"km-chip-remove\"]").count()) === 1);

    await page.click('[data-action="km-save"]');
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent === "書く瞑想を保存しました");
    check("保存トーストが出る", (await page.locator("#toast").textContent().catch(() => "")).includes("保存"));

    await page.reload();
    await page.waitForSelector('#app[data-view="journal"]', { state: "attached" });
    const sAfterReload = await stateNow();
    const wmToday = (sAfterReload.writeMeditations || []).find((w) => w.date === TODAY);
    check("放電・充電チップがリロード後も保持される",
      wmToday?.discharge.length === 1 && wmToday.discharge[0].text === "資料作成後の肩こり"
        && wmToday?.charge.length === 1 && wmToday.charge[0].text === "筋トレ 60kg×8",
      JSON.stringify(wmToday));

    console.log("[3](a) 深掘りtextareaの保存(blur時)");
    await openKmSegment();
    await page.click(".journal-segment-writeMeditation .fold >> nth=0 >> summary");
    await page.fill('[data-km-talk="discharge"]', "なぜ引っかかったんだろう");
    await page.locator('[data-km-talk="discharge"]').blur();
    await page.waitForFunction(({ KEY, TODAY, text }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return (s.writeMeditations || []).find((w) => w.date === TODAY)?.dischargeTalk === text;
    }, { KEY: STATE_KEY, TODAY, text: "なぜ引っかかったんだろう" });
    const sAfterTalk = await stateNow();
    check("深掘り(放電)テキストが保存される",
      (sAfterTalk.writeMeditations || []).find((w) => w.date === TODAY)?.dischargeTalk === "なぜ引っかかったんだろう");

    console.log("[4](a) チップ削除");
    const chipId = (await stateNow()).writeMeditations.find((w) => w.date === TODAY).discharge[0].id;
    await page.click(`[data-action="km-chip-remove"][data-kind="discharge"][data-id="${chipId}"]`);
    await page.waitForFunction(() => document.querySelectorAll("#km-discharge-list [data-action=\"km-chip-remove\"]").length === 0);
    check("削除後は放電チップが0件になる",
      (await stateNow()).writeMeditations.find((w) => w.date === TODAY)?.discharge.length === 0);
    check("削除後の節見出し要約も追随する", (await page.locator("#km-oneliner").textContent()).includes("放電0件"));

    console.log("[5](b)(c) チップ追加は同一DOMノード維持+focus復帰(全体再描画なしの間接検証)、dataModifiedAt更新");
    const before = await stateNow();
    await page.clock.setFixedTime(new Date(2026, 7, 29, 19, 1, 0));  // dataModifiedAt変化を検出可能にする
    await page.evaluate(() => {
      const input = document.querySelector("#km-discharge-input");
      window.__v294InputNode = input;
      input.value = "会議ラッシュ";
    });
    await page.click('[data-action="km-chip-add"][data-kind="discharge"]');
    await page.waitForFunction(() => document.querySelectorAll("#km-discharge-list [data-action=\"km-chip-remove\"]").length === 1);
    const focusState = await page.evaluate(() => ({
      sameNode: window.__v294InputNode === document.querySelector("#km-discharge-input"),
      focused: document.activeElement === document.querySelector("#km-discharge-input")
    }));
    check("チップ追加後も同じinputノードでフォーカスが戻る(renderJournal全体を再呼びしていない間接証跡)",
      focusState.sameNode && focusState.focused, JSON.stringify(focusState));
    const after = await stateNow();
    check("チップ追加はsaveState経由でdataModifiedAtを更新する", after.dataModifiedAt !== before.dataModifiedAt);

    console.log("[6](b) state.journals[date]は書く瞑想の編集(追加・削除・深掘り保存・明示保存)を通じて変化しない");
    const JOURNAL_SENTINEL = "# 既存のFREE LOG本文";
    await seed({ journalText: JOURNAL_SENTINEL });
    await openKmSegment();
    check("(前提)seed直後のjournals[date]がsentinelと一致", (await stateNow()).journals[TODAY] === JOURNAL_SENTINEL);

    await page.fill("#km-charge-input", "子どもと公園");
    await page.click('[data-action="km-chip-add"][data-kind="charge"]');
    await page.waitForFunction(() => document.querySelectorAll("#km-charge-list [data-action=\"km-chip-remove\"]").length === 1);
    check("チップ追加後もstate.journals[date]は不変", (await stateNow()).journals[TODAY] === JOURNAL_SENTINEL);

    const chargeChipIdForJournalCheck = (await stateNow()).writeMeditations.find((w) => w.date === TODAY).charge[0].id;
    await page.click(`[data-action="km-chip-remove"][data-kind="charge"][data-id="${chargeChipIdForJournalCheck}"]`);
    await page.waitForFunction(() => document.querySelectorAll("#km-charge-list [data-action=\"km-chip-remove\"]").length === 0);
    check("チップ削除後もstate.journals[date]は不変", (await stateNow()).journals[TODAY] === JOURNAL_SENTINEL);

    await page.click(".journal-segment-writeMeditation .fold >> nth=1 >> summary");  // 深掘り(充電)fold
    await page.fill('[data-km-talk="charge"]', "散歩で気分転換できた");
    await page.locator('[data-km-talk="charge"]').blur();
    await page.waitForFunction(({ KEY, TODAY, text }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return (s.writeMeditations || []).find((w) => w.date === TODAY)?.chargeTalk === text;
    }, { KEY: STATE_KEY, TODAY, text: "散歩で気分転換できた" });
    check("深掘り(充電)blur保存後もstate.journals[date]は不変", (await stateNow()).journals[TODAY] === JOURNAL_SENTINEL);

    await page.fill("#km-discharge-input", "会議の詰め込みすぎ");
    await page.click('[data-action="km-chip-add"][data-kind="discharge"]');
    await page.waitForFunction(() => document.querySelectorAll("#km-discharge-list [data-action=\"km-chip-remove\"]").length === 1);
    await page.click('[data-action="km-save"]');
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent === "書く瞑想を保存しました");
    const journalAfter = (await stateNow()).journals[TODAY];
    check("state.journals[date]は書く瞑想パネルの操作(追加・削除・深掘り・明示保存)を通じて一貫して変化しない(FREE NOTE二重上書きリスクの回避)",
      journalAfter === JOURNAL_SENTINEL);

    console.log("[7](b) 空のまま保存の負例: km-saveを実クリックしても空レコードは作られず、journals[date]も不変、ガードトーストが出る");
    await seed();
    await openKmSegment();
    const journalBeforeEmptySave = (await stateNow()).journals[TODAY];
    await page.click('[data-action="km-save"]');
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent === "放電・充電のいずれかを1件以上入力してください");
    check("空のまま保存はガードトーストを出す",
      (await page.locator("#toast").textContent()) === "放電・充電のいずれかを1件以上入力してください");
    const sAfterEmptySave = await stateNow();
    check("空のまま保存では空レコードが作られない(state.writeMeditationsに当日分が無い)",
      !(sAfterEmptySave.writeMeditations || []).some((w) => w.date === TODAY),
      JSON.stringify(sAfterEmptySave.writeMeditations));
    check("空のまま保存ではstate.journals[date]も不変",
      sAfterEmptySave.journals[TODAY] === journalBeforeEmptySave);

    console.log("[7](b) 続き: 日報生成→空のままは`## 書く瞑想`節が出ない / 記入(放電・充電とも)があれば節が出る");
    // v296(R1b)追随: 当日writeMeditationsが未保存のためdailyCloseゲートが挟まる。
    // 「スキップして生成」経由で片付けてから生成完了を待つ(検証意図=節が出ないこと、は不変)。
    const reportBeforeEmpty = (await stateNow()).reports?.[TODAY] ?? null;
    await generateReportThroughGate(page);
    await page.waitForFunction(({ KEY, TODAY, prev }) => {
      const r = JSON.parse(localStorage.getItem(KEY)).reports?.[TODAY] ?? null;
      return r !== prev;
    }, { KEY: STATE_KEY, TODAY, prev: reportBeforeEmpty });
    const reportEmpty = (await stateNow()).reports[TODAY] || "";
    check("書く瞑想が未記入の日は`## 書く瞑想`節が出ない", !reportEmpty.includes("## 書く瞑想"), reportEmpty.slice(0, 300));

    await openKmSegment();
    await page.fill("#km-discharge-input", "夕方の会議ラッシュ");
    await page.click('[data-action="km-chip-add"][data-kind="discharge"]');
    await page.waitForFunction(() => document.querySelectorAll("#km-discharge-list [data-action=\"km-chip-remove\"]").length === 1);
    await page.fill("#km-charge-input", "夕食後の散歩");
    await page.click('[data-action="km-chip-add"][data-kind="charge"]');
    await page.waitForFunction(() => document.querySelectorAll("#km-charge-list [data-action=\"km-chip-remove\"]").length === 1);
    await page.click('[data-action="km-save"]');
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent === "書く瞑想を保存しました");
    // 保存済みなのでゲートは出ない想定(generateReportThroughGate内はno-op)。
    await generateReportThroughGate(page);
    await page.waitForFunction(({ KEY, TODAY, prev }) => {
      const r = JSON.parse(localStorage.getItem(KEY)).reports?.[TODAY] ?? null;
      return r !== prev;
    }, { KEY: STATE_KEY, TODAY, prev: reportEmpty });
    const reportFilled = (await stateNow()).reports[TODAY] || "";
    check("記入があれば`## 書く瞑想`→`### 放電`節が日報へ出る",
      reportFilled.includes("## 書く瞑想") && reportFilled.includes("### 放電")
        && reportFilled.includes("- 夕方の会議ラッシュ"), reportFilled.slice(0, 500));
    check("充電側も`### 充電`節+チップ本文が日報へ出る(放電側と同等に検証)",
      reportFilled.includes("### 充電") && reportFilled.includes("- 夕食後の散歩"), reportFilled.slice(0, 500));
    check("`## 書く瞑想`節は`## 8. ジャーナル`の直前に出る",
      reportFilled.indexOf("## 書く瞑想") < reportFilled.indexOf("## 8. ジャーナル")
        && reportFilled.indexOf("## 8. ジャーナル") - reportFilled.indexOf("## 書く瞑想") < 200);

    console.log("[8](d) 退行: 既存ジャーナル節(MORNING/NIGHT/FREE LOG)・既存日報節が無改修で通過");
    check("MORNING BRIEFのsegmentが存在する", (await page.locator(".journal-segment-morning").count()) === 1);
    check("NIGHT BRIEFのsegmentが存在する", (await page.locator(".journal-segment-evening").count()) === 1);
    check("FREE LOGのsegmentが存在する", (await page.locator(".journal-segment-body").count()) === 1);
    check("既存の`## 5. 時間の使い方`節は無改修で出力される", reportFilled.includes("## 5. 時間の使い方"));
    check("既存の`## 8. ジャーナル`節も出力される", reportFilled.includes("## 8. ジャーナル"));

    console.log("[9](d) 390pxで横スクロールが出ない");
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth <= doc.clientWidth + 1;
    });
    check("390pxで書く瞑想パネル込みでも横スクロールが出ない", overflow);

    console.log("[10] normalizeStateの後方互換: writeMeditationsフィールドが無い旧stateでも例外なく起動できる");
    const failuresBefore = failures;
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.writeMeditations;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, STATE_KEY);
    await page.reload();
    // 起動完了=#app[data-view]属性がjournalへ確定するまで待つ(normalizeStateが例外化すれば
    // ここがタイムアウトし、フェイルラウドにテスト自体が失敗する)。
    await page.waitForSelector('#app[data-view="journal"]', { state: "attached", timeout: 5000 });
    check("旧stateでも例外なく起動できる(pageerrorなし)", failures === failuresBefore);
    const sMigrated = await stateNow();
    check("normalizeStateがwriteMeditationsを[]で補完する",
      Array.isArray(sMigrated.writeMeditations) && sMigrated.writeMeditations.length === 0);
  } finally {
    await ctx.close();
    await browser.close();
    server.close();
  }
}

(async () => {
  await verifyPureSyncMerge();
  await verifyBrowserPanel();
  console.log(failures === 0 ? "\n✅ v294: 全テスト成功" : `\n❌ v294: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
