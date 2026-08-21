// tests/routine-core.test.js — 段階4-4抽出(ルーティンタブのドメインロジック+UI+連続ルーティン
// (チェーン)+今日の庭+保護系ルーティン+過集中ブレーカー+繰り返し実体化エンジン)の
// characterization test。
// 対象: src/features/routine.js(configureRoutine(deps)による依存注入。wish.js/
// journal.jsと同じ抽出パターン)。prep-stage4-routine.md §8が挙げた項目のうち、DOM描画や
// ブラウザE2E(v89/v115/v153/v155)で別途カバーされない一次データ系ロジックをNode単体で固定する。
//
// routine.jsはsrc/storage/local.jsのpersistLocalNoScheduleを静的importする(app.js非常駐の
// 真の葉のため)。openRoutineForWeekday以外はpersistLocalNoScheduleを呼ばないため、
// このテストではlocalStorageスタブは用意しない(呼び出し経路を踏むテストは無いため)。
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const ROUTINE_PATH = path.join(ROOT, "src", "features", "routine.js");
const STORE_PATH = path.join(ROOT, "src", "state", "store.js");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// ---- app.js側の実装と同一(相当)のヘルパー(依存注入のスタブ) ----
// pad2/parseDate/addDaysはapp.js(15029-15052行台)の実装をそのまま再現する(iOS Safari向けの
// 文字列パース契約=new Date(文字列)を経由しない、をテスト側でも壊さないため)。
function pad2(value) { return String(value).padStart(2, "0"); }
function dateToISO(date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`; }
function parseDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function addDays(date, delta) {
  const d = parseDate(date);
  d.setDate(d.getDate() + delta);
  return dateToISO(d);
}
function minutesOf(dateTime) {
  if (!dateTime) return 0;
  const m1 = /T(\d{1,2}):(\d{2})/.exec(dateTime);
  if (m1) return Number(m1[1]) * 60 + Number(m1[2]);
  const m2 = /^(\d{1,2}):(\d{2})/.exec(dateTime);
  if (m2) return Number(m2[1]) * 60 + Number(m2[2]);
  return 0;
}
function timeFromDateTime(dateTime) {
  if (!dateTime) return "";
  const m = /T(\d{1,2}):(\d{2})/.exec(dateTime);
  return m ? `${pad2(Number(m[1]))}:${m[2]}` : "";
}
function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function renderHeader(eyebrow, title) { return `<div class="stub-header">${eyebrow}/${title}</div>`; }
function renderDateBar() { return `<div class="stub-datebar"></div>`; }
function getCategoryColor() { return "#123456"; }

let todayISOValue = "2026-07-28";
function todayISO() { return todayISOValue; }
let nowDateTimeValue = "2026-07-28T09:00:00";
function nowDateTime() { return nowDateTimeValue; }

let toastCalls = [];
function showToast(message, opts) { toastCalls.push({ message, opts }); }
let saveAndRenderCalls = [];
function saveAndRender(message, opts) { saveAndRenderCalls.push({ message, opts }); }
let renderCalls = 0;
function render() { renderCalls++; }
let setViewCalls = [];
function setView(view) { setViewCalls.push(view); }
function closeModal() {}
let renderModalCalls = [];
function renderModal(html) { renderModalCalls.push(html); }

// blocksForDate/isTouchedBlockはapp.js実装と同じ契約(state.blocksから絞り込むだけ)を再現する。
let storeModRef = null;
function blocksForDate(date) {
  return storeModRef.state.blocks
    .filter((b) => !b.deleted && b.date === date)
    .sort((a, b) => (a.plannedStartAt || "99").localeCompare(b.plannedStartAt || "99"));
}
function isTouchedBlock(b) {
  return Boolean(
    b.completed || b.actualStartAt || b.actualEndAt ||
    Number(b.pomodoroCount || 0) > 0 || (b.comment || "").trim() ||
    b.isMIT || Number(b.charge || 0) > 0 || Number(b.discharge || 0) > 0
  );
}
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const RECURRENCE_KEEP_PAST_DAYS = 7;
const RECURRENCE_FUTURE_DAYS = 31;

async function loadModules() {
  const storeMod = await import(pathToFileURL(STORE_PATH).href);
  const routineMod = await import(pathToFileURL(ROUTINE_PATH).href);
  return { storeMod, routineMod };
}

(async () => {
  const { storeMod, routineMod } = await loadModules();
  storeModRef = storeMod;

  routineMod.configureRoutine({
    escapeHTML, renderHeader, renderDateBar, todayISO, addDays, parseDate,
    minutesOf, timeFromDateTime, pad2, nowDateTime, getCategoryColor,
    showToast, saveAndRender, render, setView, closeModal, renderModal,
    blocksForDate, isTouchedBlock, WEEKDAY_LABELS,
    RECURRENCE_KEEP_PAST_DAYS, RECURRENCE_FUTURE_DAYS
  });

  function setBaseState(extra = {}) {
    storeMod.setState({
      blocks: [], recurrences: [], routineChains: [], chainRuns: [], gardenLog: {},
      settings: { routineDayFilter: null },
      routineViewMode: "routine",
      selectedDate: "2026-07-28",
      ...extra
    });
  }

  console.log("[1] gardenStageRank: 5つの境界値(非表示/土/芽/若木/開花)");
  {
    check("total:0は-1(非表示)", routineMod.gardenStageRank({ done: 0, total: 0, pct: 0 }) === -1);
    check("done:0は0(土)", routineMod.gardenStageRank({ done: 0, total: 5, pct: 0 }) === 0);
    check("pct<50は1(芽)", routineMod.gardenStageRank({ done: 1, total: 5, pct: 20 }) === 1);
    check("pct>=50かつ未全完了は2(若木)", routineMod.gardenStageRank({ done: 3, total: 5, pct: 60 }) === 2);
    check("done===totalは3(開花)", routineMod.gardenStageRank({ done: 5, total: 5, pct: 100 }) === 3);
  }

  console.log("[2] updateGardenLog: フィールド別maxマージ(total縮小・done同値でも既存値を改竄しない)");
  {
    setBaseState({
      blocks: [
        { id: "b1", date: "2026-07-28", category: "ルーティン", completed: true, deleted: false },
        { id: "b2", date: "2026-07-28", category: "ルーティン", completed: true, deleted: false },
        { id: "b3", date: "2026-07-28", category: "ルーティン", completed: true, deleted: false },
        { id: "b4", date: "2026-07-28", category: "ルーティン", completed: true, deleted: false }
      ],
      gardenLog: { "2026-07-28": { done: 4, total: 5 } }  // 既存: 5件中4件完了(実体1件がpurge等で消失した想定)
    });
    routineMod.updateGardenLog("2026-07-28");
    const entry = storeMod.state.gardenLog["2026-07-28"];
    check("既存{done:4,total:5}が{done:4,total:4}へ改竄されない(totalはmaxのまま5)",
      entry.done === 4 && entry.total === 5, JSON.stringify(entry));

    console.log("  -- ルーティン0件・既存エントリも無い日は書き込まない --");
    setBaseState({ blocks: [], gardenLog: {} });
    routineMod.updateGardenLog("2026-07-28");
    check("空エントリを作らない", storeMod.state.gardenLog["2026-07-28"] === undefined);
  }

  console.log("[3] overdueUncheckedRoutines: deleted/category/completed除外+時刻超過のみ+昇順ソート");
  {
    nowDateTimeValue = "2026-07-28T10:00:00";
    const blocks = [
      { id: "future", category: "ルーティン", completed: false, deleted: false, plannedStartAt: "2026-07-28T11:00:00" },
      { id: "late", category: "ルーティン", completed: false, deleted: false, plannedStartAt: "2026-07-28T09:30:00" },
      { id: "early", category: "ルーティン", completed: false, deleted: false, plannedStartAt: "2026-07-28T07:00:00" },
      { id: "done", category: "ルーティン", completed: true, deleted: false, plannedStartAt: "2026-07-28T08:00:00" },
      { id: "notRoutine", category: "その他", completed: false, deleted: false, plannedStartAt: "2026-07-28T08:00:00" },
      { id: "deletedOne", category: "ルーティン", completed: false, deleted: true, plannedStartAt: "2026-07-28T08:00:00" }
    ];
    const result = routineMod.overdueUncheckedRoutines(blocks).map((b) => b.id);
    check("未来のBlockは除外", !result.includes("future"));
    check("完了済みは除外", !result.includes("done"));
    check("category!=='ルーティン'は除外", !result.includes("notRoutine"));
    check("deleted:trueは除外", !result.includes("deletedOne"));
    check("plannedStartAt昇順(early→late)", JSON.stringify(result) === JSON.stringify(["early", "late"]), JSON.stringify(result));
  }

  console.log("[4] computeProtectionMissedStreak: anchor無しは即打ち切り/anchor付きは活動有無で継続/MAX_LOOKBACK_DAYSで打ち切り");
  {
    // (a) anchor無しルール: 2026-07-28にBlockが1件も無ければそこで打ち切り(missed=0)
    setBaseState({
      recurrences: [{ id: "r1", deleted: false, anchor: "" }],
      blocks: []
    });
    check("anchor無し・当日Block無しは即打ち切り(missed=0)",
      routineMod.computeProtectionMissedStreak("r1", "2026-07-28") === 0);

    // (b) anchor付きルール: アンカー元(r-anchor)が当日活動していればBlockが無くても継続加算
    setBaseState({
      recurrences: [
        { id: "r2", deleted: false, anchor: "anchor-rule" },
        { id: "anchor-rule", deleted: false, anchor: "" }
      ],
      blocks: [
        { id: "ab1", date: "2026-07-27", recurrenceGroupId: "anchor-rule", deleted: false, completed: false },
        { id: "ab2", date: "2026-07-26", recurrenceGroupId: "anchor-rule", deleted: false, completed: false }
      ]
    });
    const streak = routineMod.computeProtectionMissedStreak("r2", "2026-07-27");
    check("アンカー元の活動がある日は継続加算される(2日連続欠落)", streak === 2, String(streak));

    // (c) MAX_LOOKBACK_DAYS(14日)で無限ループせず打ち切る
    setBaseState({
      recurrences: [
        { id: "r3", deleted: false, anchor: "anchor2" },
        { id: "anchor2", deleted: false, anchor: "" }
      ],
      blocks: Array.from({ length: 20 }, (_, i) => ({
        id: `ab-${i}`, date: addDays("2026-07-28", -i), recurrenceGroupId: "anchor2", deleted: false, completed: false
      }))
    });
    const capped = routineMod.computeProtectionMissedStreak("r3", "2026-07-28");
    check("14日を超えて数えない(無限ループ防止)", capped === 14, String(capped));
  }

  console.log("[5] chainStepComplete: リンクした繰り返しルールの当日Blockを完了化・全ステップ完了でcompletedAt確定+isChainRunActiveがfalseに戻る");
  {
    nowDateTimeValue = "2026-07-28T09:00:00";
    setBaseState({
      routineChains: [{ id: "chain1", deleted: false, title: "朝の整え", anchor: "", steps: [
        { id: "s1", title: "目薬", estimatedMinutes: 1 },
        { id: "s2", title: "深呼吸", estimatedMinutes: 2 }
      ] }],
      recurrences: [{ id: "rule-medoku", deleted: false, title: "目薬", startTime: "", endTime: "", category: "ルーティン" }]
    });
    routineMod.openChainRun("chain1");
    check("開始直後はisChainRunActiveがtrue", routineMod.isChainRunActive() === true);

    routineMod.chainStepComplete();  // ステップ1(目薬)完了
    const linkedBlock = storeMod.state.blocks.find((b) => b.recurrenceGroupId === "rule-medoku" && b.date === "2026-07-28");
    check("タイトル一致する繰り返しルールの当日Blockが完了化される", Boolean(linkedBlock?.completed), JSON.stringify(linkedBlock));

    routineMod.chainStepComplete();  // ステップ2(深呼吸、リンクなし)完了→全ステップ完了
    const run = storeMod.state.chainRuns.find((r) => r.chainId === "chain1");
    check("全ステップ完了でrun.completedAtがセットされる", Boolean(run?.completedAt));
    check("完了後はisChainRunActiveがfalseに戻る", routineMod.isChainRunActive() === false);
  }

  console.log("[6] maintainRecurrences: anchor付きルールは通常実体化から除外/purgeは実績ありを残し未編集を破棄");
  {
    todayISOValue = "2026-07-28";
    setBaseState({
      recurrences: [
        { id: "daily1", deleted: false, kind: "daily", anchor: "", anchorDate: "2026-01-01", exceptionDates: [], startTime: "", endTime: "" },
        { id: "anchored1", deleted: false, kind: "daily", anchor: "some-anchor", anchorDate: "2026-01-01", exceptionDates: [] }
      ],
      blocks: []
    });
    routineMod.maintainRecurrences();
    const anchoredInstances = storeMod.state.blocks.filter((b) => b.recurrenceGroupId === "anchored1");
    const dailyInstances = storeMod.state.blocks.filter((b) => b.recurrenceGroupId === "daily1");
    check("anchor付きルールは事前実体化されない(0件)", anchoredInstances.length === 0, String(anchoredInstances.length));
    check("anchor無しルールは通常どおり実体化される(1件以上)", dailyInstances.length > 0, String(dailyInstances.length));

    console.log("  -- purge: 期間外+未編集は破棄、実績ありは残す --");
    setBaseState({
      recurrences: [{ id: "ruleA", deleted: false, kind: "daily", anchor: "", anchorDate: "2020-01-01", exceptionDates: [] }],
      blocks: [
        { id: "old-untouched", date: "2020-01-01", recurrenceGroupId: "ruleA", deleted: false, completed: false },
        { id: "old-touched", date: "2020-01-02", recurrenceGroupId: "ruleA", deleted: false, completed: true }
      ]
    });
    routineMod.maintainRecurrences({ purge: true });
    const remainingIds = storeMod.state.blocks.map((b) => b.id);
    check("期間外・未編集(old-untouched)は破棄される", !remainingIds.includes("old-untouched"), JSON.stringify(remainingIds));
    check("実績あり(old-touched、completed:true)は履歴として残る", remainingIds.includes("old-touched"), JSON.stringify(remainingIds));
  }

  console.log("[7] createRecurrenceRule: 同タイトル・同開始時刻のアクティブなルールが既にあれば新規作成せずtoast");
  {
    setBaseState({
      recurrences: [{ id: "existing", deleted: false, title: "朝の瞑想", startTime: "07:00" }]
    });
    toastCalls = [];
    const dup = routineMod.createRecurrenceRule({ title: "朝の瞑想", plannedStartAt: "2026-07-28T07:00", plannedEndAt: "2026-07-28T07:10" }, "daily");
    check("重複ルールはnullを返し作成しない", dup === null);
    check("重複toastが出る", toastCalls.some((c) => c.message.includes("既にあるため作成しませんでした")));
    check("state.recurrencesが増えていない", storeMod.state.recurrences.length === 1);

    const created = routineMod.createRecurrenceRule({ title: "新規ルーティン", plannedStartAt: "2026-07-28T08:00", plannedEndAt: "2026-07-28T08:10", category: "ルーティン" }, "weekdays");
    check("重複していなければ作成される", created !== null && storeMod.state.recurrences.length === 2);
  }

  console.log("[8] triggerAnchorPlacements: 完了時刻23:58は23:59にクランプ/同日に既にBlockがあれば重複生成しない");
  {
    setBaseState({
      recurrences: [{ id: "afterAnchor", deleted: false, anchor: "anchorX", title: "夜のログ", startTime: "", endTime: "", category: "ルーティン" }],
      blocks: []
    });
    routineMod.triggerAnchorPlacements("anchorX", "2026-07-28T23:58:00");
    const placed = storeMod.state.blocks.find((b) => b.recurrenceGroupId === "afterAnchor");
    check("開始時刻が23:59にクランプされる", placed?.plannedStartAt === "2026-07-28T23:59", placed?.plannedStartAt);

    const beforeCount = storeMod.state.blocks.length;
    routineMod.triggerAnchorPlacements("anchorX", "2026-07-28T23:58:00");
    check("同日に既にBlockがあれば重複生成しない", storeMod.state.blocks.length === beforeCount);
  }

  console.log("[9] parseChainStepsText ⇄ chainStepsToText: 往復変換の同値性(空行除去・見積分の数値/null変換)");
  {
    const text = "目薬, 0.5\n深呼吸, 2\n瞑想\n\n";
    const steps = routineMod.parseChainStepsText(text);
    check("空行は除去される(3ステップ)", steps.length === 3, String(steps.length));
    check("見積分は数値化される", steps[0].estimatedMinutes === 0.5, String(steps[0].estimatedMinutes));
    check("見積分が無い行はnull", steps[2].estimatedMinutes === null, String(steps[2].estimatedMinutes));
    const roundTrip = routineMod.chainStepsToText(steps);
    check("往復変換後も同じステップ数を再パースできる", routineMod.parseChainStepsText(roundTrip).length === 3);
  }

  console.log(failures === 0 ? "\nroutine-core: 全件成功" : `\nroutine-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
