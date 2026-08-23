// 12WY週次コミット データ層のfast-node検証。app.js常駐関数を既存v197同様にVM抽出し、
// 候補境界・manual/auto確定・完了刻印・免除・計画追加・決定論id upsertをUIなしで固定する。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const start = appSource.indexOf("function candidateBlocksForWeek(value, weekStart) {");
const end = appSource.indexOf("// v39: 開いている問い", start);
if (start < 0 || end < 0) throw new Error("週次コミット関数のsource markerが見つかりません");
const commitSource = appSource.slice(start, end);

let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

let currentToday = "2026-08-23";
let currentNow = "2026-08-23T12:34:56";
const sandbox = { Map, Set, String, Boolean };
sandbox.todayISO = () => currentToday;
sandbox.nowDateTime = () => currentNow;
sandbox.activeTrackForProject = (tracks, projectId) => (tracks || [])
  .filter((track) => !track.deleted && track.status === "active" && track.ownerId === projectId)
  .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
    || String(a.id || "").localeCompare(String(b.id || "")))[0] || null;
sandbox.parseDate = (date) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
};
sandbox.dateToISO = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
sandbox.addDays = (date, delta) => {
  const d = sandbox.parseDate(date);
  d.setDate(d.getDate() + delta);
  return sandbox.dateToISO(d);
};
sandbox.weekRange = (date) => {
  const d = sandbox.parseDate(date);
  const dow = (d.getDay() + 1) % 7;
  const weekStart = sandbox.addDays(date, -dow);
  return { weekStart, weekEnd: sandbox.addDays(weekStart, 6) };
};
sandbox.saveCount = 0;
sandbox.saveState = () => {
  sandbox.state.dataModifiedAt = sandbox.nowDateTime();
  sandbox.saveCount += 1;
};
vm.createContext(sandbox);
vm.runInContext(commitSource, sandbox);

function project(id = "p1", twelveWeekStartDate = "2026-06-01", extra = {}) {
  return { id, kind: "normal", status: "active", twelveWeekStartDate, deleted: false, ...extra };
}
function task(id = "t1", projectId = "p1", extra = {}) {
  return { id, projectId, status: "todo", deleted: false, ...extra };
}
function block(id = "b1", taskId = "t1", date = "2026-08-22", extra = {}) {
  return { id, taskId, date, title: id, completed: false, actualEndAt: "", deleted: false, migratedTo: "", ...extra };
}
function baseState(extra = {}) {
  return {
    settings: { twelveWeekStartDate: "2026-06-01" },
    projects: [project()], tasks: [task()], blocks: [block()], tracks: [],
    weeklyCommitments: [], dataModifiedAt: "", ...extra
  };
}
function setState(value) {
  sandbox.state = value;
  sandbox.saveCount = 0;
}
function records(type) {
  return sandbox.state.weeklyCommitments.filter((record) => record.recordType === type);
}
function commitmentItem(id, weekStart = "2026-08-22", extra = {}) {
  return {
    id: `wci_${weekStart}_${id}`, recordType: "item", weekStart, blockId: id,
    taskId: "t1", projectId: "p1", trackId: "", title: id, plannedDate: weekStart,
    source: "confirmed", lane: "cycle", excused: false, excusedReason: "", excusedChangedAt: "",
    completedAt: "", completedChangedAt: "", createdAt: "2026-08-22T08:00:00",
    updatedAt: "2026-08-22T08:00:00", deleted: false, ...extra
  };
}
function weekMeta(weekStart = "2026-08-22", extra = {}) {
  return {
    id: "wcw_" + weekStart, recordType: "week", weekStart,
    cycleStartDate: "2026-06-01", committedAt: "2026-08-22T08:00:00",
    committedVia: "manual", selectedBlockIds: [], createdAt: "2026-08-22T08:00:00",
    updatedAt: "2026-08-22T08:00:00", deleted: false, ...extra
  };
}

console.log("[1] candidateBlocksForWeek: サイクル・週・Project・Task・Blockの全ガード");
{
  const state = baseState({
    projects: [
      project("p-cycle-start", "2026-06-01"), project("p-before-cycle", "2026-05-31"),
      project("p83", "2026-08-23"), project("p84", "2026-08-24"),
      project("p-kind", "2026-06-01", { kind: "wish" }),
      project("p-paused", "2026-06-01", { status: "paused" }),
      project("p-deleted", "2026-06-01", { deleted: true })
    ],
    tasks: [
      task("t-cycle-start", "p-cycle-start"), task("t-before-cycle", "p-before-cycle"),
      task("t83", "p83"), task("t84", "p84"), task("t-suspended", "p83", { status: "suspended" }),
      task("t-cancelled", "p83", { status: "cancelled" }), task("t-deleted", "p83", { deleted: true }),
      task("t-kind", "p-kind"), task("t-paused", "p-paused"), task("t-pdeleted", "p-deleted")
    ],
    blocks: [
      block("b-cycle-start", "t-cycle-start"), block("b-before-cycle", "t-before-cycle"),
      block("b83", "t83"), block("b84", "t84"), block("b-suspended", "t-suspended"),
      block("b-suspended-completed", "t-suspended", "2026-08-22", { completed: true }),
      block("b-cancelled", "t-cancelled"),
      block("b-cancelled-completed", "t-cancelled", "2026-08-22", { completed: true }),
      block("b-tdeleted", "t-deleted"), block("b-no-task", ""),
      block("b-deleted", "t83", "2026-08-22", { deleted: true }),
      block("b-migrated", "t83", "2026-08-22", { migratedTo: "b-next" }),
      block("b-before", "t83", "2026-08-21"), block("b-after", "t83", "2026-08-29"),
      block("b-week-end", "t83", "2026-08-28"),
      block("b-kind", "t-kind"), block("b-paused", "t-paused"), block("b-pdeleted", "t-pdeleted")
    ]
  });
  const ids = sandbox.candidateBlocksForWeek(state, "2026-08-22").map((entry) => entry.id);
  check("全ガードとサイクル両端を維持し、開始日・+83日のProjectだけ候補",
    JSON.stringify(ids) === '["b-cycle-start","b83","b-suspended-completed","b-cancelled-completed","b-week-end"]', JSON.stringify(ids));
  check("開始日前のProjectは候補外", !ids.includes("b-before-cycle"), JSON.stringify(ids));
  check("完了済みBlockは中断・中止Task配下でも候補",
    ids.includes("b-suspended-completed") && ids.includes("b-cancelled-completed")
      && !ids.includes("b-suspended") && !ids.includes("b-cancelled"), JSON.stringify(ids));
  check("weekEnd当日の金曜Blockも候補", ids.includes("b-week-end"), JSON.stringify(ids));
  state.settings.twelveWeekStartDate = "";
  check("設定開始日が空なら常に0件", sandbox.candidateBlocksForWeek(state, "2026-08-22").length === 0);
  check("実装本体にnew Date(文字列)が無い", !/new Date\s*\(\s*["'`]/.test(commitSource));
  check("VMスタブのweekRange既知陽性", sandbox.weekRange("2026-08-28").weekStart === "2026-08-22");
}

console.log("[2] commitWeek: manual item/週メタ・完了スナップショット・upsert");
{
  const state = baseState({
    blocks: [
      block("b1", "t1", "2026-08-22", { title: "完了済み", completed: true, actualEndAt: "2026-08-22T09:15" }),
      block("b2", "t1", "2026-08-23", { title: "未選択" })
    ],
    tracks: [
      { id: "trk-later", ownerId: "p1", status: "active", createdAt: "2026-06-02T00:00:00", deleted: false },
      { id: "trk-first", ownerId: "p1", status: "active", createdAt: "2026-06-01T00:00:00", deleted: false }
    ]
  });
  setState(state);
  sandbox.commitWeek("2026-08-22", ["b1", "bogus", "b1"]);
  const meta = records("week")[0];
  const item = records("item")[0];
  check("manual週メタは選択候補だけをスナップショット", meta.id === "wcw_2026-08-22"
    && meta.committedVia === "manual" && JSON.stringify(meta.selectedBlockIds) === '["b1"]');
  check("itemは確定時の参照・表示値とcycle laneを焼き込み", item.id === "wci_2026-08-22_b1"
    && item.taskId === "t1" && item.projectId === "p1" && item.trackId === "trk-first"
    && item.title === "完了済み" && item.plannedDate === "2026-08-22"
    && item.source === "confirmed" && item.lane === "cycle");
  check("完了済みの分精度actualEndAtへ秒を補完", item.completedAt === "2026-08-22T09:15:00"
    && item.completedChangedAt === currentNow && item.updatedAt === currentNow);
  check("保存でdataModifiedAtをbump", state.dataModifiedAt === currentNow && sandbox.saveCount === 1);
  sandbox.commitWeek("2026-08-22", ["b1"]);
  check("manual二重実行でもweek/item件数不変", records("week").length === 1 && records("item").length === 1);
}

console.log("[2a] commitWeek: 秒付き完了スナップショット境界");
{
  const state = baseState({
    blocks: [block("b-seconds", "t1", "2026-08-22", {
      completed: true, actualEndAt: "2026-08-22T09:15:42"
    })]
  });
  setState(state);
  sandbox.commitWeek("2026-08-22", ["b-seconds"]);
  const item = records("item")[0];
  check("秒付きactualEndAtは無変更でcompletedAtへ転写",
    item.completedAt === "2026-08-22T09:15:42", item.completedAt);
}

console.log("[2b] commitWeek: 週開始日の正規化・過去未来週no-op");
{
  const state = baseState({ blocks: [block("b1", "t1", "2026-08-23")] });
  setState(state);
  sandbox.commitWeek("2026-08-23", ["b1"]);
  check("非土曜weekStartは土曜週として保存", records("week")[0]?.weekStart === "2026-08-22"
    && records("week")[0]?.id === "wcw_2026-08-22"
    && records("item")[0]?.weekStart === "2026-08-22");

  const past = baseState({ blocks: [block("past", "t1", "2026-08-16")] });
  setState(past);
  sandbox.commitWeek("2026-08-16", ["past"]);
  check("過去週のmanual確定はno-op", past.weeklyCommitments.length === 0 && sandbox.saveCount === 0);

  const future = baseState({ blocks: [block("future", "t1", "2026-08-29")] });
  setState(future);
  sandbox.commitWeek("2026-08-29", ["future"]);
  check("未来週のmanual確定はno-op", future.weeklyCommitments.length === 0 && sandbox.saveCount === 0);
}

console.log("[3] autoCommitWeekIfNeeded: 当週候補全件・候補起点ガード・冪等");
{
  const state = baseState({ blocks: [
    block("b1"), block("b2", "t1", "2026-08-23"),
    block("b-completed", "t1", "2026-08-23", { completed: true, actualEndAt: "" })
  ] });
  setState(state);
  sandbox.autoCommitWeekIfNeeded(state.blocks[0]);
  check("autoは候補全件を確定", records("item").length === 3
    && records("item").every((item) => item.source === "auto"));
  check("auto週メタはselected空", records("week")[0].committedVia === "auto"
    && records("week")[0].selectedBlockIds.length === 0);
  const completed = records("item").find((item) => item.blockId === "b-completed");
  check("autoでも完了済み候補のcompletedAtを初期化",
    completed.completedAt === currentNow && completed.completedChangedAt === currentNow);
  const count = state.weeklyCommitments.length;
  sandbox.autoCommitWeekIfNeeded(state.blocks[0]);
  check("週メタ存在後は即no-op", state.weeklyCommitments.length === count && sandbox.saveCount === 1);

  const nonCandidate = baseState({
    tasks: [task("t-suspended", "p1", { status: "suspended" })],
    blocks: [block("b-suspended", "t-suspended", "2026-08-23")]
  });
  setState(nonCandidate);
  sandbox.autoCommitWeekIfNeeded(nonCandidate.blocks[0]);
  check("当週でも非候補Block起点のauto確定はno-op",
    nonCandidate.weeklyCommitments.length === 0 && sandbox.saveCount === 0);

  const past = baseState({ blocks: [block("past", "t1", "2026-08-15")] });
  setState(past);
  sandbox.autoCommitWeekIfNeeded(past.blocks[0]);
  check("過去週Blockではauto確定しない", past.weeklyCommitments.length === 0 && sandbox.saveCount === 0);
}

console.log("[4] stampCommitmentCompletion: 当週だけ刻印/解除、移動元item不変");
{
  const state = baseState({ weeklyCommitments: [weekMeta(), commitmentItem("b1")] });
  setState(state);
  sandbox.stampCommitmentCompletion(block("b1"), true);
  let item = state.weeklyCommitments.find((record) => record.id === "wci_2026-08-22_b1");
  check("当週itemへ完了刻印", item.completedAt === currentNow && item.completedChangedAt === currentNow && item.updatedAt === currentNow);
  check("完了刻印は1回保存しdataModifiedAtと対象updatedAtを更新",
    sandbox.saveCount === 1 && state.dataModifiedAt === currentNow && item.updatedAt === currentNow);
  currentNow = "2026-08-23T12:35:00";
  sandbox.stampCommitmentCompletion(block("b1"), false);
  item = state.weeklyCommitments.find((record) => record.id === "wci_2026-08-22_b1");
  check("当週内の完了取消は刻印解除", item.completedAt === "" && item.completedChangedAt === currentNow);

  const immutable = baseState({ weeklyCommitments: [
    commitmentItem("past", "2026-08-15", { completedAt: "past-value" }),
    commitmentItem("future", "2026-08-29", { completedAt: "future-value" }),
    commitmentItem("moved", "2026-08-15", { completedAt: "origin-value" })
  ] });
  setState(immutable);
  sandbox.stampCommitmentCompletion(block("past", "t1", "2026-08-15"), true);
  sandbox.stampCommitmentCompletion(block("future", "t1", "2026-08-29"), true);
  sandbox.stampCommitmentCompletion(block("moved", "t1", "2026-08-22"), true);
  check("過去週・未来週は変更せず、別週移動元itemも不変", immutable.weeklyCommitments.map((record) => record.completedAt).join("|")
    === "past-value|future-value|origin-value" && sandbox.saveCount === 0);
}

console.log("[5] excuse/unexcuse: 当週・理由必須・未来週ガード・解除");
{
  const state = baseState({ weeklyCommitments: [
    commitmentItem("b1"), commitmentItem("old", "2026-08-15"),
    commitmentItem("future", "2026-08-29", {
      excused: true, excusedReason: "未来理由", excusedChangedAt: "2026-08-22T07:00:00",
      updatedAt: "2026-08-22T07:00:00"
    })
  ] });
  setState(state);
  sandbox.excuseCommitmentItem("wci_2026-08-22_b1", "   ");
  check("空白理由では免除しない", !state.weeklyCommitments.find((record) => record.id === "wci_2026-08-22_b1").excused && sandbox.saveCount === 0);
  sandbox.excuseCommitmentItem("wci_2026-08-15_old", "過去理由");
  check("過去週は免除しない", !state.weeklyCommitments.find((record) => record.id === "wci_2026-08-15_old").excused && sandbox.saveCount === 0);
  const futureBefore = JSON.stringify(state.weeklyCommitments.find((record) => record.id === "wci_2026-08-29_future"));
  sandbox.excuseCommitmentItem("wci_2026-08-29_future", "未来理由を更新");
  check("未来週の免除はno-op",
    JSON.stringify(state.weeklyCommitments.find((record) => record.id === "wci_2026-08-29_future")) === futureBefore
      && sandbox.saveCount === 0);
  const futureBeforeUnexcuse = JSON.stringify(state.weeklyCommitments.find((record) => record.id === "wci_2026-08-29_future"));
  sandbox.unexcuseCommitmentItem("wci_2026-08-29_future");
  check("未来週の免除解除はno-op",
    JSON.stringify(state.weeklyCommitments.find((record) => record.id === "wci_2026-08-29_future")) === futureBeforeUnexcuse
      && sandbox.saveCount === 0);
  sandbox.excuseCommitmentItem("wci_2026-08-22_b1", "体調不良");
  let item = state.weeklyCommitments.find((record) => record.id === "wci_2026-08-22_b1");
  check("当週は理由付きで免除", item.excused && item.excusedReason === "体調不良"
    && item.excusedChangedAt === currentNow && item.updatedAt === currentNow);
  check("免除は1回保存しdataModifiedAtと対象updatedAtを更新",
    sandbox.saveCount === 1 && state.dataModifiedAt === currentNow && item.updatedAt === currentNow);
  sandbox.saveCount = 0;
  state.dataModifiedAt = "before-unexcuse";
  currentNow = "2026-08-23T12:36:00";
  sandbox.unexcuseCommitmentItem(item.id);
  item = state.weeklyCommitments.find((record) => record.id === "wci_2026-08-22_b1");
  check("当週内で免除解除できる", !item.excused && item.excusedReason === ""
    && item.excusedChangedAt === currentNow && item.updatedAt === currentNow);
  check("免除解除は1回保存しdataModifiedAtと対象updatedAtを更新",
    sandbox.saveCount === 1 && state.dataModifiedAt === currentNow && item.updatedAt === currentNow);
}

console.log("[6] addCommitmentItems: 当週確定後だけsource:addedでupsert");
{
  const state = baseState({
    blocks: [block("b1"), block("b2", "t1", "2026-08-23", { completed: true, actualEndAt: "" })],
    weeklyCommitments: [weekMeta(), commitmentItem("b1")]
  });
  setState(state);
  sandbox.addCommitmentItems("2026-08-22", ["b2", "b2"]);
  const added = state.weeklyCommitments.find((record) => record.id === "wci_2026-08-22_b2");
  check("計画追加はsource:added・cycle lane", added.source === "added" && added.lane === "cycle");
  check("完了済みでactualEndAt無しならnowを初期値にする", added.completedAt === currentNow
    && added.completedChangedAt === currentNow);
  check("計画追加は1回保存しdataModifiedAtと対象updatedAtを更新",
    sandbox.saveCount === 1 && state.dataModifiedAt === currentNow && added.updatedAt === currentNow);
  const count = state.weeklyCommitments.length;
  sandbox.addCommitmentItems("2026-08-22", ["b2"]);
  check("計画追加の二重実行でも件数不変", state.weeklyCommitments.length === count);
  sandbox.addCommitmentItems("2026-08-15", ["b1"]);
  check("過去週への計画追加はno-op", state.weeklyCommitments.length === count);

  const future = baseState({
    blocks: [block("future", "t1", "2026-08-29")],
    weeklyCommitments: [weekMeta("2026-08-29")]
  });
  setState(future);
  sandbox.addCommitmentItems("2026-08-29", ["future"]);
  check("確定済みでも未来週への計画追加はno-op",
    future.weeklyCommitments.length === 1 && records("item").length === 0 && sandbox.saveCount === 0);

  const uncommitted = baseState({ blocks: [block("b1")] });
  setState(uncommitted);
  sandbox.addCommitmentItems("2026-08-22", ["b1"]);
  check("週メタ未確定では計画追加しない", uncommitted.weeklyCommitments.length === 0 && sandbox.saveCount === 0);
}

console.log("[7] commitmentItem upsert: フィールド別マージ");
{
  const excused = baseState({
    weeklyCommitments: [weekMeta(), commitmentItem("b1", "2026-08-22", {
      excused: true, excusedReason: "既存免除", excusedChangedAt: "2026-08-23T13:00:00"
    })]
  });
  setState(excused);
  sandbox.addCommitmentItems("2026-08-22", ["b1"]);
  let item = records("item")[0];
  check("免除済みitemへの計画追加で免除を保持", item.excused && item.excusedReason === "既存免除"
    && item.excusedChangedAt === "2026-08-23T13:00:00");

  const added = baseState({ weeklyCommitments: [commitmentItem("b1", "2026-08-22", { source: "added" })] });
  setState(added);
  sandbox.commitWeek("2026-08-22", ["b1"]);
  item = records("item")[0];
  check("added itemのmanual再確定でsourceが後退しない", item.source === "added");

  const lane = baseState({ weeklyCommitments: [commitmentItem("b1", "2026-08-22", { lane: "cycle" })] });
  setState(lane);
  sandbox.commitWeek("2026-08-22", ["b1"]);
  item = records("item")[0];
  check("manual再確定でlaneが上書きされない", item.lane === "cycle");

  const laneInputMarker = 'source, lane: "cycle",';
  if (commitSource.split(laneInputMarker).length !== 2) {
    throw new Error("lane入力のテスト差し替え点が一意ではありません");
  }
  // フェーズ2のtask lane入力をテスト内で注入し、実装のフィールド別マージ本体を直接通す。
  const taskLaneSandbox = { Map, Set, String, Boolean, activeTrackForProject: sandbox.activeTrackForProject };
  vm.createContext(taskLaneSandbox);
  vm.runInContext(commitSource.replace(laneInputMarker, 'source, lane: "task",'), taskLaneSandbox);
  const directLaneMerge = baseState({ weeklyCommitments: [commitmentItem("b1", "2026-08-22", { lane: "cycle" })] });
  item = taskLaneSandbox.commitmentItemForBlock(
    directLaneMerge, directLaneMerge.blocks[0], "2026-08-22", "confirmed", currentNow
  );
  check("既存cycle×入力taskのフィールド別マージでcycleを保持", item.lane === "cycle", item.lane);

  const completed = baseState({
    blocks: [block("b1", "t1", "2026-08-22", { completed: true, actualEndAt: "2026-08-22T09:15" })],
    weeklyCommitments: [commitmentItem("b1", "2026-08-22", {
      completedAt: "2026-08-23T13:00:00", completedChangedAt: "2026-08-23T13:00:00"
    })]
  });
  setState(completed);
  sandbox.commitWeek("2026-08-22", ["b1"]);
  item = records("item")[0];
  check("新しいcompletedChangedAtを古いスナップショットで潰さない",
    item.completedAt === "2026-08-23T13:00:00" && item.completedChangedAt === "2026-08-23T13:00:00");
}

console.log(failures === 0 ? "\ntrack-commit-core: 全件成功" : `\ntrack-commit-core: ${failures}件失敗`);
process.exit(failures === 0 ? 0 : 1);
