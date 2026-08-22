// src/core/today-model.js — v202: 今日タブのデータ層抽出とTOWER便モデル。
// 純粋性の契約: import文・state参照・I/O・入力変更を持たず、外部依存はhelpersで受け取る。
// 抽出元: src/features/today.js:112-209 (runningBlockOf〜projectedInfo) / :558-560 (flightPosition)。
// 抽出した7関数はロジックを変えず、依存だけhelpers/projects/tasks引数へ置き換えた。
// v191(C2)の不変条件: ルーティンBlockはNOW FOCUS/NEXT QUEUE(runningBlockOf/queueBlocksOf)から除外しROUTINEパネルへ一本化。
// oneTap(実績記録専用Block)の除外は src/core/recurrence.js routineRate() と帯合計を一致させる契約(routineBandsOf/undoneRoutineBlocksOf)。
// 時刻の既定引数(Date.now()/new Date())のみ純粋性の例外。呼び出し側が明示注入すれば決定論になる。
// characterization test: tests/tower-model-core.test.js / tests/today-core.test.js。

function runningBlockOf(blocks, helpers) {
  return (blocks || []).filter((b) => b.actualStartAt && !b.actualEndAt && b.category !== "ルーティン")
    .sort((a, b) => helpers.localDateTimeToMs(b.actualStartAt) - helpers.localDateTimeToMs(a.actualStartAt))[0] || null;
}

function queueBlocksOf(blocks, helpers) {
  return (blocks || [])
    .filter((b) => !b.completed && !b.actualStartAt && !helpers.isStaleBlock(b) && !b.oneTap && b.category !== "ルーティン")
    .sort((a, b) => {
      const aMin = a.plannedStartAt ? helpers.minutesOf(a.plannedStartAt) : Number.POSITIVE_INFINITY;
      const bMin = b.plannedStartAt ? helpers.minutesOf(b.plannedStartAt) : Number.POSITIVE_INFINITY;
      return aMin - bMin || (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0);
    }).slice(0, 5);
}

function routineBandFor(block, helpers) {
  const minute = block.plannedStartAt ? helpers.minutesOf(block.plannedStartAt) : 0;
  if (minute < 9 * 60) return "朝";
  if (minute < 12 * 60) return "午前";
  if (minute < 18 * 60) return "午後";
  return "夜";
}

function routineBandsOf(blocks, helpers) {
  const bands = ["朝", "午前", "午後", "夜"].map((label) => ({ label, done: 0, total: 0 }));
  (blocks || []).filter((b) => b.category === "ルーティン" && !b.oneTap).forEach((block) => {
    const band = bands.find((item) => item.label === routineBandFor(block, helpers));
    band.total += 1;
    if (block.completed) band.done += 1;
  });
  return bands;
}

function undoneRoutineBlocksOf(blocks) {
  return (blocks || []).filter((b) => b.category === "ルーティン" && !b.completed && !b.deleted && !b.oneTap);
}

function actualMinutes(block, helpers, nowMs = Date.now()) {
  const startMs = helpers.localDateTimeToMs(block.actualStartAt);
  if (!startMs) return 0;
  const endMs = helpers.localDateTimeToMs(block.actualEndAt) || nowMs;
  return Math.max(0, Math.floor((endMs - startMs) / 60000));
}

function twelveWeekMinutes(blocks, projects, tasks, helpers, nowMs = Date.now()) {
  const goalProjectIds = new Set((projects || [])
    .filter((p) => !p.deleted && p.kind === "normal" && p.status === "active" && p.twelveWeekStartDate).map((p) => p.id));
  const goalTaskIds = new Set((tasks || [])
    .filter((t) => !t.deleted && goalProjectIds.has(t.projectId)).map((t) => t.id));
  return (blocks || []).filter((b) => goalTaskIds.has(b.taskId))
    .reduce((sum, block) => sum + actualMinutes(block, helpers, nowMs), 0);
}

function projectedInfo(blocks, helpers, now = new Date()) {
  const remaining = (blocks || []).filter((b) => !b.completed);
  if (!remaining.length) return { text: "完了", comparison: "", remainingMin: 0 };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const endMin = helpers.computeProjectedEnd(helpers.todayISO(), nowMin);
  const plannedEnd = Math.max(0, ...(blocks || []).filter((b) => b.plannedStartAt)
    .map((b) => helpers.minutesOf(b.plannedEndAt || b.plannedStartAt)));
  const hh = Math.floor((endMin % 1440) / 60);
  const mm = endMin % 60;
  const text = `${endMin >= 1440 ? "翌" : ""}${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  const delta = plannedEnd ? endMin - plannedEnd : 0;
  const comparison = plannedEnd ? `計画比 ${delta >= 0 ? "+" : "−"}${Math.abs(delta)}分` : "計画終端なし";
  return { text, comparison, remainingMin: Math.max(0, endMin - nowMin) };
}

function flightPosition(minute, helpers) {
  return helpers.clamp((minute - 6 * 60) / (18 * 60) * 100, 0, 100);
}

function towerFlights(blocks, nowMin, helpers) {
  const sorted = (blocks || []).map((block) => ({
    block, plannedMin: block.plannedStartAt ? helpers.minutesOf(block.plannedStartAt) : null
  })).sort((a, b) => {
    const byTime = (a.plannedMin ?? Number.POSITIVE_INFINITY) - (b.plannedMin ?? Number.POSITIVE_INFINITY);
    if (byTime) return byTime;
    const byOrder = (Number(a.block.orderIndex) || 0) - (Number(b.block.orderIndex) || 0);
    if (byOrder) return byOrder;
    const aId = String(a.block.id);
    const bId = String(b.block.id);
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });
  let finalAssigned = false;
  return sorted.map(({ block, plannedMin }, index) => {
    let status = "holding", label = "待機";
    if (block.completed) { status = "arrived"; label = "到着"; }
    else if (block.actualStartAt && !block.actualEndAt) { status = "landing"; label = "着陸中"; }
    else if (!block.actualStartAt && plannedMin !== null && plannedMin < nowMin) { status = "resloted"; label = "リスロット"; }
    else if (!block.actualStartAt && plannedMin !== null && plannedMin >= nowMin && !finalAssigned) {
      status = "final"; label = "最終進入"; finalAssigned = true;
    }
    return { id: block.id, callsign: `TC-${index * 2 + 701}`, title: block.title, plannedMin, status, label };
  });
}

export {
  runningBlockOf, queueBlocksOf, routineBandsOf, undoneRoutineBlocksOf,
  twelveWeekMinutes, projectedInfo, flightPosition, towerFlights
};
