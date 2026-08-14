// tower-model-core.test.js — v202 today-model純関数抽出とTOWER便モデルのcharacterization test。
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const MODULE_PATH = path.join(ROOT, "src", "core", "today-model.js");
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function equal(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

function minutesOf(value) {
  const match = String(value || "").match(/(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

(async () => {
  const source = fs.readFileSync(MODULE_PATH, "utf8");
  const {
    towerFlights, queueBlocksOf, projectedInfo, runningBlockOf, routineBandsOf,
    undoneRoutineBlocksOf, twelveWeekMinutes, flightPosition
  } = await import(pathToFileURL(MODULE_PATH).href);
  const localDateTimeToMs = (value) => (value ? new Date(value).getTime() : 0);
  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

  console.log("[1] coreはimport文を持たない純粋な葉");
  check("import文ゼロ", !/^\s*import\s/m.test(source));
  check("stateを直接参照しない", !/\bstate\s*[.[]/.test(source));

  console.log("[2] towerFlightsの便名・並びは入力順に依存しない");
  const blocks = [
    { id: "no-plan", title: "未定便" },
    { id: "future-z", title: "未来Z", plannedStartAt: "2026-08-14T10:30", orderIndex: 2 },
    { id: "done", title: "完了", plannedStartAt: "2026-08-14T08:30", completed: true, actualStartAt: "2026-08-14T08:20" },
    { id: "exact", title: "定刻", plannedStartAt: "2026-08-14T10:00" },
    { id: "late", title: "定刻過ぎ", plannedStartAt: "2026-08-14T08:00" },
    { id: "running", title: "実行中", plannedStartAt: "2026-08-14T09:00", actualStartAt: "2026-08-14T09:05" },
    { id: "future-b", title: "未来B", plannedStartAt: "2026-08-14T10:30", orderIndex: 1 },
    { id: "future-a", title: "未来A", plannedStartAt: "2026-08-14T10:30", orderIndex: 1 }
  ];
  const inputSnapshot = JSON.stringify(blocks);
  const first = towerFlights(blocks, 10 * 60, { minutesOf });
  const second = towerFlights([blocks[4], blocks[7], blocks[1], blocks[5], blocks[0], blocks[3], blocks[6], blocks[2]], 10 * 60, { minutesOf });
  equal("シャッフルしても結果全体が一致", second, first);
  check("入力配列を破壊しない(順序・中身とも呼び出し前と同一)", JSON.stringify(blocks) === inputSnapshot);
  const noPlanPair = towerFlights([
    { id: "np-b", title: "未定B" }, { id: "np-a", title: "未定A" },
    { id: "np-c", title: "未定C", orderIndex: -1 }
  ], 10 * 60, { minutesOf });
  equal("plannedStartAt無し同士はorderIndex→idで並ぶ", noPlanPair.map((x) => x.id), ["np-c", "np-a", "np-b"]);
  equal("時刻→orderIndex→idで並び、便名は奇数連番", first.map((x) => [x.id, x.callsign]), [
    ["late", "TC-701"], ["done", "TC-703"], ["running", "TC-705"], ["exact", "TC-707"],
    ["future-a", "TC-709"], ["future-b", "TC-711"], ["future-z", "TC-713"], ["no-plan", "TC-715"]
  ]);

  console.log("[3] towerFlightsの状態境界");
  const byId = Object.fromEntries(first.map((flight) => [flight.id, flight]));
  equal("定刻ちょうどは最終進入", [byId.exact.status, byId.exact.label], ["final", "最終進入"]);
  equal("実行中は着陸中", [byId.running.status, byId.running.label], ["landing", "着陸中"]);
  equal("完了は到着（実行中条件より優先）", [byId.done.status, byId.done.label], ["arrived", "到着"]);
  equal("定刻過ぎ未着手はリスロット", [byId.late.status, byId.late.label], ["resloted", "リスロット"]);
  equal("2便目以降の未来は待機", [byId["future-a"].status, byId["future-b"].status], ["holding", "holding"]);
  equal("予定なしは末尾・待機・plannedMin=null", [first.at(-1).id, first.at(-1).status, first.at(-1).plannedMin], ["no-plan", "holding", null]);

  console.log("[4] queueBlocksOfのソート・除外・5件制限");
  const queueInput = [
    { id: "q7" }, { id: "q6", plannedStartAt: "12:00" }, { id: "q2", plannedStartAt: "09:00", orderIndex: 2 },
    { id: "q5", plannedStartAt: "11:00" }, { id: "q3", plannedStartAt: "09:00", orderIndex: 1 },
    { id: "q1", plannedStartAt: "08:00" }, { id: "q4", plannedStartAt: "10:00" },
    { id: "stale", plannedStartAt: "07:00", stale: true }, { id: "tap", oneTap: true },
    { id: "routine", category: "ルーティン" }, { id: "done-q", completed: true }, { id: "run-q", actualStartAt: "09:00" }
  ];
  const queue = queueBlocksOf(queueInput, { minutesOf, isStaleBlock: (block) => Boolean(block.stale) });
  equal("対象だけを予定時刻・orderIndex順に5件返す", queue.map((x) => x.id), ["q1", "q3", "q2", "q4", "q5"]);

  console.log("[5] projectedInfoの翌日跨ぎ表記");
  const projected = projectedInfo(
    [{ id: "p", plannedStartAt: "2026-08-14T22:00", plannedEndAt: "2026-08-14T23:00" }],
    { minutesOf, todayISO: () => "2026-08-14", computeProjectedEnd: () => 25 * 60 + 5 },
    new Date(2026, 7, 14, 22, 0)
  );
  equal("翌日表記・計画比・残り分を返す", projected, { text: "翌01:05", comparison: "計画比 +125分", remainingMin: 185 });
  equal("全件完了なら完了表記を返す", projectedInfo([{ id: "d", completed: true }],
    { minutesOf, todayISO: () => "2026-08-14", computeProjectedEnd: () => 0 }, new Date(2026, 7, 14, 10, 0)),
    { text: "完了", comparison: "", remainingMin: 0 });
  equal("plannedStartAtが1件も無ければ計画終端なし", projectedInfo([{ id: "n" }],
    { minutesOf, todayISO: () => "2026-08-14", computeProjectedEnd: () => 23 * 60 }, new Date(2026, 7, 14, 22, 0)),
    { text: "23:00", comparison: "計画終端なし", remainingMin: 60 });

  console.log("[6] runningBlockOfは非ルーティンの実行中から最新開始を選ぶ");
  const runInput = [
    { id: "r-old", actualStartAt: "2026-08-14T09:00" },
    { id: "r-new", actualStartAt: "2026-08-14T09:30" },
    { id: "r-ended", actualStartAt: "2026-08-14T10:00", actualEndAt: "2026-08-14T10:30" },
    { id: "r-routine", category: "ルーティン", actualStartAt: "2026-08-14T11:00" }
  ];
  equal("最新開始の実行中を返す(終了済み・ルーティン除外)",
    runningBlockOf(runInput, { localDateTimeToMs })?.id, "r-new");
  equal("実行中が無ければnull", runningBlockOf([runInput[2]], { localDateTimeToMs }), null);

  console.log("[7] routineBandsOf / undoneRoutineBlocksOf のoneTap・完了・削除の扱い");
  const routineInput = [
    { id: "b1", category: "ルーティン", plannedStartAt: "2026-08-14T08:00", completed: true },
    { id: "b2", category: "ルーティン", plannedStartAt: "2026-08-14T10:00" },
    { id: "b3", category: "ルーティン", plannedStartAt: "2026-08-14T13:00", oneTap: true },
    { id: "b4", category: "ルーティン", plannedStartAt: "2026-08-14T19:00" },
    { id: "b5", category: "ルーティン", deleted: true },
    { id: "b6", plannedStartAt: "2026-08-14T08:30" }
  ];
  // deleted除外はここでは行わない(上流blocksForDateの責務)。予定なしdeletedのb5は朝(minute=0)に入る現挙動を固定。
  equal("帯集計はoneTap除外・非ルーティン除外(帯合計=routineRate契約)",
    routineBandsOf(routineInput, { minutesOf }),
    [{ label: "朝", done: 1, total: 2 }, { label: "午前", done: 0, total: 1 },
     { label: "午後", done: 0, total: 0 }, { label: "夜", done: 0, total: 1 }]);
  equal("未実施チップは未完了・未削除・非oneTapのルーティンだけ",
    undoneRoutineBlocksOf(routineInput).map((x) => x.id), ["b2", "b4"]);

  console.log("[8] twelveWeekMinutesのプロジェクト/タスク絞り込みとnowMs経路");
  const projects = [
    { id: "P1", kind: "normal", status: "active", twelveWeekStartDate: "2026-08-01" },
    { id: "P2", kind: "normal", status: "active" },
    { id: "P3", kind: "habit", status: "active", twelveWeekStartDate: "2026-08-01" },
    { id: "P4", kind: "normal", status: "done", twelveWeekStartDate: "2026-08-01" },
    { id: "P5", kind: "normal", status: "active", twelveWeekStartDate: "2026-08-01", deleted: true }
  ];
  const tasks = [
    { id: "T1", projectId: "P1" }, { id: "T2", projectId: "P1", deleted: true },
    { id: "T3", projectId: "P2" }, { id: "T4", projectId: "P3" }
  ];
  const twBlocks = [
    { taskId: "T1", actualStartAt: "2026-08-14T09:00", actualEndAt: "2026-08-14T09:30" },
    { taskId: "T1", actualStartAt: "2026-08-14T10:00" },
    { taskId: "T2", actualStartAt: "2026-08-14T09:00", actualEndAt: "2026-08-14T10:00" },
    { taskId: "T3", actualStartAt: "2026-08-14T09:00", actualEndAt: "2026-08-14T10:00" },
    { taskId: "T4", actualStartAt: "2026-08-14T09:00", actualEndAt: "2026-08-14T10:00" }
  ];
  equal("12WY対象(deleted/kind/status/開始日なしを除外)+実行中はnowMsまで加算",
    twelveWeekMinutes(twBlocks, projects, tasks, { localDateTimeToMs }, new Date("2026-08-14T10:45").getTime()), 75);

  console.log("[9] flightPositionは6:00-24:00を0-100へclampする");
  equal("6:00は0 / 15:00は50 / 5:00と24:00はclamp",
    [flightPosition(6 * 60, { clamp }), flightPosition(15 * 60, { clamp }),
     flightPosition(5 * 60, { clamp }), flightPosition(24 * 60, { clamp })], [0, 50, 0, 100]);

  console.log(failures === 0 ? "\ntower-model-core: 全件成功" : `\ntower-model-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
