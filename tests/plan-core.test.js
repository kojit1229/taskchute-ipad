// plan-core.test.js — R0: task.twyPlan(週次目安)の正規化と、タスク×週の目安/確定/完了
// 3数を返す純関数(src/core/plan.js)を固定するfast-nodeテスト。
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const MODULE_PATH = path.join(__dirname, "..", "src", "core", "plan.js");
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures += 1; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}

function same(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function item(id, taskId, weekStart, extra = {}) {
  return {
    id, recordType: "item", weekStart, taskId, blockId: id, lane: "cycle", source: "confirmed",
    completedAt: "", excused: false, deleted: false, updatedAt: "2026-09-01T00:00:00", ...extra
  };
}

// v336: taskWeekTripleはtrack.jsのweeklyCommittedItems経由になった(weeklyScoreと同じ絞り込み)ため、
// itemだけでなく週メタ(recordType:"week")も無いと採点対象にならない。テストfixtureは
// weekMeta(weekStart)を各weekStartにつき1件commitmentsへ含める(既定はcommittedVia:"auto"=全item採用)。
function weekMeta(weekStart, extra = {}) {
  return {
    id: `wk-${weekStart}`, recordType: "week", weekStart, deleted: false,
    committedVia: "auto", selectedBlockIds: [], updatedAt: "2026-09-01T00:00:00", ...extra
  };
}

(async () => {
  const mod = await import(pathToFileURL(MODULE_PATH).href);
  const { normalizeTwyPlan, planTargetForWeek, taskWeekTriple, taskPlanGrid, remainingTarget } = mod;

  console.log("[0] 依存ゼロ契約");
  const source = fs.readFileSync(MODULE_PATH, "utf8");
  check("new Date(文字列)を使わない", !/new\s+Date\s*\(\s*["'`]/.test(source));
  // v336: plan.jsはtrack.js(同じsrc/core配下の依存ゼロの葉)のweeklyCommittedItemsだけをimportする
  // (weeklyScoreの採点分母抽出と二重実装しないため)。state/store.js/app.jsのimportは引き続き禁止。
  check("state/store.js/app.jsをimportしない", !/from\s+["'][^"']*(state\/store|app)\.js["']/.test(source));
  const importLines = source.match(/^\s*import\s.*$/mg) || [];
  check("import先はsrc/core配下(./track.js)のみ", importLines.every((line) => /from\s+["']\.\/track\.js["']/.test(line)));

  console.log("[1] normalizeTwyPlan: 既定値補完・部分欠損・既存値優先");
  check("twyPlanなしは既定値", same(normalizeTwyPlan(undefined), { perWeek: 0, fromWeek: 1, toWeek: 12, keystone: false }));
  check("twyPlanなし(null)も既定値", same(normalizeTwyPlan(null), { perWeek: 0, fromWeek: 1, toWeek: 12, keystone: false }));
  check("部分欠損は欠損分のみ補完", same(normalizeTwyPlan({ perWeek: 3 }), { perWeek: 3, fromWeek: 1, toWeek: 12, keystone: false }));
  check("既存値優先(全項目指定)", same(normalizeTwyPlan({ perWeek: 2, fromWeek: 3, toWeek: 5, keystone: true }),
    { perWeek: 2, fromWeek: 3, toWeek: 5, keystone: true }));

  console.log("[2] normalizeTwyPlan: perWeekのclamp(0以上の整数)");
  check("perWeek -1は0", normalizeTwyPlan({ perWeek: -1 }).perWeek === 0);
  check("perWeek 2.7は2へ切り捨て", normalizeTwyPlan({ perWeek: 2.7 }).perWeek === 2);
  check("perWeek \"3\"は3(数値文字列)", normalizeTwyPlan({ perWeek: "3" }).perWeek === 3);
  check("perWeek NaNは0", normalizeTwyPlan({ perWeek: NaN }).perWeek === 0);
  check("perWeek \"abc\"は0", normalizeTwyPlan({ perWeek: "abc" }).perWeek === 0);

  console.log("[3] normalizeTwyPlan: fromWeek/toWeekのclamp・逆転");
  check("fromWeek 0は1へclamp", normalizeTwyPlan({ fromWeek: 0 }).fromWeek === 1);
  check("toWeek 13は12へclamp", normalizeTwyPlan({ toWeek: 13 }).toWeek === 12);
  check("fromWeek>toWeekはtoWeek=fromWeekへ", same(normalizeTwyPlan({ fromWeek: 8, toWeek: 3 }), { perWeek: 0, fromWeek: 8, toWeek: 8, keystone: false }));
  check("keystoneはboolean化(truthy文字列)", normalizeTwyPlan({ keystone: "yes" }).keystone === true);
  check("keystoneはboolean化(0)", normalizeTwyPlan({ keystone: 0 }).keystone === false);

  console.log("[4] normalizeTwyPlan: updatedAtを進めない契約の前提(入力を変更しない)");
  const raw = { perWeek: 5, fromWeek: 2, toWeek: 4, keystone: true };
  const rawCopy = JSON.stringify(raw);
  normalizeTwyPlan(raw);
  check("normalizeTwyPlanは入力オブジェクトを変更しない", JSON.stringify(raw) === rawCopy);

  console.log("[5] planTargetForWeek");
  const taskA = { id: "t1", twyPlan: { perWeek: 3, fromWeek: 2, toWeek: 5, keystone: false } };
  check("対象週内は目安n", planTargetForWeek(taskA, 3) === 3);
  check("対象週外(手前)は0", planTargetForWeek(taskA, 1) === 0);
  check("対象週外(後ろ)は0", planTargetForWeek(taskA, 6) === 0);
  check("twyPlanなしTaskは0", planTargetForWeek({ id: "t2" }, 1) === 0);
  check("perWeek0は0", planTargetForWeek({ id: "t3", twyPlan: { perWeek: 0, fromWeek: 1, toWeek: 12 } }, 1) === 0);
  const single = { id: "t4", twyPlan: { perWeek: 1, fromWeek: 7, toWeek: 7 } };
  check("単発(from=to)は対象週のみ1", planTargetForWeek(single, 7) === 1 && planTargetForWeek(single, 6) === 0 && planTargetForWeek(single, 8) === 0);
  check("weekNo不正(NaN)は0", planTargetForWeek(taskA, NaN) === 0);

  console.log("[6] taskWeekTriple");
  const commitments = [
    weekMeta("2026-09-05"), weekMeta("2026-09-12"),
    item("i1", "t1", "2026-09-05", { completedAt: "2026-09-05T10:00:00" }),
    item("i2", "t1", "2026-09-05", { completedAt: "" }),
    item("i3", "t1", "2026-09-05", { excused: true, completedAt: "" }),
    item("i4", "t1", "2026-09-12", { completedAt: "2026-09-12T10:00:00" }), // 別週
    item("i5", "t9", "2026-09-05", { completedAt: "2026-09-05T10:00:00" }), // 別taskId
    item("i6", "t1", "2026-09-05", { recordType: "week-note", completedAt: "2026-09-05T10:00:00" }), // recordType!=="item"(B-M1負例)
    item("i7", "t1", "2026-09-05", { deleted: true, completedAt: "2026-09-05T10:00:00" }) // deleted:true(B-M1負例)
  ];
  const triple = taskWeekTriple(commitments, "t1", "2026-09-05");
  check("免除は分母外(confirmedに含まない)・excusedへ数える", triple.confirmed === 2 && triple.excused === 1, JSON.stringify(triple));
  check("doneはcompletedAt非空の件数", triple.done === 1, JSON.stringify(triple));
  check("recordType!==\"item\"はconfirmedに混入しない(B-M1)", triple.confirmed === 2, JSON.stringify(triple));
  check("deleted:trueはconfirmedに混入しない(B-M1)", triple.confirmed === 2, JSON.stringify(triple));
  const other = taskWeekTriple(commitments, "t1", "2026-09-19");
  check("別週のitemを拾わない(週メタも無い週は0)", same(other, { confirmed: 0, done: 0, excused: 0 }));

  console.log("[6b] taskWeekTriple: weeklyScoreと同じ絞り込み(A-M2)");
  // 週メタ無し(recordType:"week"が存在しない週)はitemがあっても採点対象外
  const noMetaCommitments = [item("nm1", "t1", "2026-09-26", { completedAt: "2026-09-26T10:00:00" })];
  check("週メタが無い週はconfirmed 0(weeklyScoreのuncommittedに合わせる)",
    same(taskWeekTriple(noMetaCommitments, "t1", "2026-09-26"), { confirmed: 0, done: 0, excused: 0 }));
  // lane!=="cycle"はweeklyScore同様に対象外
  const otherLaneCommitments = [
    weekMeta("2026-10-03"),
    item("ol1", "t1", "2026-10-03", { lane: "other" }),
    item("ol2", "t1", "2026-10-03", { lane: "cycle" })
  ];
  check("laneがcycle以外のitemは数えない(A-M2)",
    taskWeekTriple(otherLaneCommitments, "t1", "2026-10-03").confirmed === 1,
    JSON.stringify(taskWeekTriple(otherLaneCommitments, "t1", "2026-10-03")));
  // committedVia==="manual"はselectedBlockIds経由 or source==="added"の item だけがスコープ
  const manualCommitments = [
    weekMeta("2026-10-10", { committedVia: "manual", selectedBlockIds: ["blk-in"] }),
    item("man-in", "t1", "2026-10-10", { blockId: "blk-in", source: "confirmed" }),        // selectedBlockIdsに含まれる→対象
    item("man-added", "t1", "2026-10-10", { blockId: "blk-added", source: "added" }),       // source==="added"→対象
    item("man-out", "t1", "2026-10-10", { blockId: "blk-out", source: "confirmed" })        // selectedBlockIds外・source!=="added"→対象外
  ];
  const manualTriple = taskWeekTriple(manualCommitments, "t1", "2026-10-10");
  check("手動確定週でselectedBlockIds外のitemはconfirmedに数えない(A-M2)", manualTriple.confirmed === 2, JSON.stringify(manualTriple));
  const wrongTask = taskWeekTriple(commitments, "not-t1", "2026-09-05");
  check("taskId不一致は0", same(wrongTask, { confirmed: 0, done: 0, excused: 0 }));
  const commitmentsCopy = JSON.stringify(commitments);
  taskWeekTriple(commitments, "t1", "2026-09-05");
  check("taskWeekTripleは入力を変更しない", JSON.stringify(commitments) === commitmentsCopy);

  console.log("[7] taskPlanGrid: past(met / missed-1-2 / missed-3+ / none)");
  const weekStarts = ["2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22", "2026-08-29"];
  // week1: 目安2・確定2・完了2 → met / week2: 目安2・確定3・完了1 → missed-1-2(missed=2)
  // week3: 目安2・確定5・完了1 → missed-3+(missed=4) / week4: 目安0・確定0・完了0 → none
  const gridItems = [
    weekMeta(weekStarts[0]), weekMeta(weekStarts[1]), weekMeta(weekStarts[2]),
    item("w1a", "g1", weekStarts[0], { completedAt: "2026-08-01T10:00:00" }),
    item("w1b", "g1", weekStarts[0], { completedAt: "2026-08-01T10:00:00" }),
    item("w2a", "g1", weekStarts[1], { completedAt: "2026-08-08T10:00:00" }),
    item("w2b", "g1", weekStarts[1], { completedAt: "" }),
    item("w2c", "g1", weekStarts[1], { completedAt: "" }),
    item("w3a", "g1", weekStarts[2], { completedAt: "2026-08-15T10:00:00" }),
    item("w3b", "g1", weekStarts[2], { completedAt: "" }),
    item("w3c", "g1", weekStarts[2], { completedAt: "" }),
    item("w3d", "g1", weekStarts[2], { completedAt: "" }),
    item("w3e", "g1", weekStarts[2], { completedAt: "" })
  ];
  const gridTaskWithPlan = { id: "g1", twyPlan: { perWeek: 2, fromWeek: 1, toWeek: 3, keystone: false } };
  // currentWeekNo=5: weeks1-4はpast, week5はfuture(currentWeekNoは今週=5週目のはずが、5週目自体を
  // currentとして扱うためweekStarts.length=5にして week5をfutureにするにはcurrentWeekNo=4以下が必要。
  // ここではpast/future境界確認のためcurrentWeekNo=5(week5=current)で past=1..4, current=5とする。
  const grid = taskPlanGrid([gridTaskWithPlan], gridItems, "2026-08-01", weekStarts, 5);
  const byWeek = Object.fromEntries(grid.map((row) => [row.weekNo, row]));
  check("week1: 目安2・確定2・完了2 → met", byWeek[1].status === "met" && byWeek[1].target === 2 && byWeek[1].confirmed === 2 && byWeek[1].done === 2, JSON.stringify(byWeek[1]));
  check("week2: 目安2・確定3・完了1 → missed-1-2(missed=2)", byWeek[2].status === "missed-1-2", JSON.stringify(byWeek[2]));
  check("week3: 目安2・確定5・完了1 → missed-3+(missed=4)", byWeek[3].status === "missed-3+", JSON.stringify(byWeek[3]));
  check("week4: 目安0・確定0・完了0 → none", byWeek[4].status === "none" && byWeek[4].target === 0, JSON.stringify(byWeek[4]));
  check("week5: currentWeekNoと一致 → current", byWeek[5].status === "current", JSON.stringify(byWeek[5]));

  console.log("[7b] taskPlanGrid: past 落ち量はmax(target,confirmed)-doneで測る(A-M1/B-H1)");
  // 目安ありで1コマも確定・完了しなかった過去週は"met"にならない(旧実装は誤ってmetを返していた)。
  const missedWeekStart = "2026-08-01";
  const boundaryTask2 = { id: "b2", twyPlan: { perWeek: 2, fromWeek: 1, toWeek: 1, keystone: false } };
  const boundaryTask3 = { id: "b3", twyPlan: { perWeek: 3, fromWeek: 1, toWeek: 1, keystone: false } };
  const noConfirmGrid2 = taskPlanGrid([boundaryTask2], [weekMeta(missedWeekStart)], "2026-08-01", [missedWeekStart], 2);
  check("目安2・確定0・完了0の過去週 → missed-1-2(落ち=max(2,0)-0=2)", noConfirmGrid2[0].status === "missed-1-2", JSON.stringify(noConfirmGrid2[0]));
  const noConfirmGrid3 = taskPlanGrid([boundaryTask3], [weekMeta(missedWeekStart)], "2026-08-01", [missedWeekStart], 2);
  check("目安3・確定0・完了0の過去週 → missed-3+(落ち=max(3,0)-0=3)", noConfirmGrid3[0].status === "missed-3+", JSON.stringify(noConfirmGrid3[0]));

  console.log("[7c] taskPlanGrid: past missedの境界値(1と3)");
  const boundaryItems1 = [
    weekMeta(missedWeekStart),
    item("bd1a", "b1", missedWeekStart, { completedAt: "2026-08-01T10:00:00" }), // done
    item("bd1b", "b1", missedWeekStart, { completedAt: "" })                      // confirmedのみ→missed=1
  ];
  const boundaryTask1 = { id: "b1", twyPlan: { perWeek: 2, fromWeek: 1, toWeek: 1, keystone: false } };
  const boundaryGrid1 = taskPlanGrid([boundaryTask1], boundaryItems1, "2026-08-01", [missedWeekStart], 2);
  check("missed=1(境界) → missed-1-2", boundaryGrid1[0].status === "missed-1-2", JSON.stringify(boundaryGrid1[0]));
  const boundaryItems3 = [
    weekMeta(missedWeekStart),
    item("bd3a", "b1", missedWeekStart, { completedAt: "" }),
    item("bd3b", "b1", missedWeekStart, { completedAt: "" }),
    item("bd3c", "b1", missedWeekStart, { completedAt: "" }) // confirmed3・done0→missed=3
  ];
  const boundaryTask1b = { id: "b1", twyPlan: { perWeek: 1, fromWeek: 1, toWeek: 1, keystone: false } };
  const boundaryGrid3 = taskPlanGrid([boundaryTask1b], boundaryItems3, "2026-08-01", [missedWeekStart], 2);
  check("missed=3(境界) → missed-3+", boundaryGrid3[0].status === "missed-3+", JSON.stringify(boundaryGrid3[0]));

  console.log("[8] taskPlanGrid: future(planned / short / unplanned / none)");
  const futureItems = [
    weekMeta(weekStarts[3]),
    item("f8a", "g2", weekStarts[3]), item("f8b", "g2", weekStarts[3]) // week4に確定2件(免除なし)
  ];
  const futureTask = { id: "g2", twyPlan: { perWeek: 2, fromWeek: 4, toWeek: 5, keystone: false } };
  const futureGrid = taskPlanGrid([futureTask], futureItems, "2026-08-01", weekStarts, 1); // current=1 → week4/5はfuture
  const byWeekFuture = Object.fromEntries(futureGrid.map((row) => [row.weekNo, row]));
  check("future 目安2・確定2 → planned(充足)", byWeekFuture[4].status === "planned", JSON.stringify(byWeekFuture[4]));
  check("future 目安2・確定0 → unplanned", byWeekFuture[5].status === "unplanned", JSON.stringify(byWeekFuture[5]));
  const shortTask = { id: "g3", twyPlan: { perWeek: 3, fromWeek: 4, toWeek: 4 } };
  const shortItems = [weekMeta(weekStarts[3]), item("s1", "g3", weekStarts[3])];
  const shortGrid = taskPlanGrid([shortTask], shortItems, "2026-08-01", weekStarts, 1);
  check("future 目安3・確定1 → short(不足だが0でない)", shortGrid[3].status === "short", JSON.stringify(shortGrid[3]));
  const noneTask = { id: "g4", twyPlan: { perWeek: 0, fromWeek: 1, toWeek: 12 } };
  const noneGrid = taskPlanGrid([noneTask], [], "2026-08-01", weekStarts, 1);
  check("future 目安0 → none", noneGrid[3].status === "none", JSON.stringify(noneGrid[3]));

  console.log("[9] remainingTarget");
  const remTask = { id: "r1", twyPlan: { perWeek: 2, fromWeek: 1, toWeek: 6 } };
  check("current以降(currentWeekNo+1〜toWeek)の合計", remainingTarget(remTask, 3) === 6); // week4,5,6 = 2*3
  check("toWeekを超えると加算されない", remainingTarget(remTask, 6) === 0);
  check("currentWeekNo=0は全12週のうちtoWeekまで(1..6)", remainingTarget(remTask, 0) === 12);
  check("不正なcurrentWeekNo(NaN)は0", remainingTarget(remTask, NaN) === 0);
  check("twyPlanなしTaskは0", remainingTarget({ id: "r2" }, 1) === 0);

  console.log("[10] 例外を投げない・不正入力の防御");
  check("taskPlanGridはtasks=null/weeklyCommitments=nullでも例外なし",
    same(taskPlanGrid(null, null, "", [], 1), []));
  check("taskPlanGridはweekStarts=nullでも例外なし", same(taskPlanGrid([{ id: "x" }], [], "", null, 1), []));
  check("taskWeekTripleはweeklyCommitments=nullでも例外なし", same(taskWeekTriple(null, "t1", "2026-09-05"), { confirmed: 0, done: 0, excused: 0 }));
  check("normalizeTwyPlanは配列を渡されても既定値", same(normalizeTwyPlan([1, 2, 3]), { perWeek: 0, fromWeek: 1, toWeek: 12, keystone: false }));
  check("planTargetForWeekはtask=nullでも例外なし", planTargetForWeek(null, 1) === 0);

  console.log("[11] 入力不変(M5): planTargetForWeek / taskPlanGrid / remainingTarget");
  const immutableTask = { id: "im1", twyPlan: { perWeek: 2, fromWeek: 1, toWeek: 3, keystone: false } };
  const immutableTaskCopy = JSON.stringify(immutableTask);
  planTargetForWeek(immutableTask, 2);
  check("planTargetForWeekは入力taskを変更しない", JSON.stringify(immutableTask) === immutableTaskCopy);

  const gridTasksInput = [immutableTask];
  const gridCommitmentsInput = [weekMeta("2026-08-01"), item("im-a", "im1", "2026-08-01")];
  const gridWeekStartsInput = ["2026-08-01"];
  const gridTasksCopy = JSON.stringify(gridTasksInput);
  const gridCommitmentsCopy = JSON.stringify(gridCommitmentsInput);
  const gridWeekStartsCopy = JSON.stringify(gridWeekStartsInput);
  taskPlanGrid(gridTasksInput, gridCommitmentsInput, "2026-08-01", gridWeekStartsInput, 1);
  check("taskPlanGridはtasks/weeklyCommitments/weekStartsを変更しない",
    JSON.stringify(gridTasksInput) === gridTasksCopy
    && JSON.stringify(gridCommitmentsInput) === gridCommitmentsCopy
    && JSON.stringify(gridWeekStartsInput) === gridWeekStartsCopy);

  const remTaskInput = { id: "rm1", twyPlan: { perWeek: 1, fromWeek: 1, toWeek: 6, keystone: false } };
  const remTaskCopy = JSON.stringify(remTaskInput);
  remainingTarget(remTaskInput, 3);
  check("remainingTargetは入力taskを変更しない", JSON.stringify(remTaskInput) === remTaskCopy);

  console.log(failures === 0 ? "\nplan-core: 全件成功" : `\nplan-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
