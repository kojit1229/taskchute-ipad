// src/core/plan.js — R0: task.twyPlan(週次目安)のデータ契約と、タスク×週の
// 「目安・確定・完了」3数を返す純関数群。state / store.js / app.js を一切importしない葉モジュール
// (track.jsと同じ依存ゼロの契約。詳細: workbench/out/2026-09-04-12wy-tab-mock/12wy-tab-design.md §2.0)。
// track.js(同じsrc/core配下の依存ゼロの葉)のweeklyCommittedItemsだけをimportする
// (weeklyScoreの採点分母抽出を二重実装しないため。track.jsの挙動は変えない=track-coreは緑のまま)。
import { weeklyCommittedItems } from "./track.js";

// v336: perWeekは0以上の整数(NaN/負→0、小数は切り捨て)。
function normalizePerWeek(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

// v336: 週番号は1〜12へclamp。非数・欠損はfallbackへ。
function clampWeekNo(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(12, Math.round(n)));
}

// v336: task.twyPlanの既定値補完(既存値優先)+clamp。fromWeek>toWeekの逆転はtoWeek=fromWeekへ。
function normalizeTwyPlan(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const perWeek = normalizePerWeek(src.perWeek);
  const fromWeek = clampWeekNo(src.fromWeek, 1);
  let toWeek = clampWeekNo(src.toWeek, 12);
  if (fromWeek > toWeek) toWeek = fromWeek;
  const keystone = Boolean(src.keystone);
  return { perWeek, fromWeek, toWeek, keystone };
}

// v336: 週weekNoの目安n。twyPlanなし・perWeek0・対象週外は0。
function planTargetForWeek(task, weekNo) {
  const plan = normalizeTwyPlan(task?.twyPlan);
  const week = Number(weekNo);
  if (!Number.isFinite(week) || plan.perWeek <= 0) return 0;
  if (week < plan.fromWeek || week > plan.toWeek) return 0;
  return plan.perWeek;
}

// v336: その週(weekStart一致)でtaskId一致のitemから確定m・完了k・免除件数を導出する。
// 母集団はweeklyCommittedItems(track.js)=weeklyScoreと同じ絞り込みなので確定mは採点分母と一致する。
// 免除はweeklyScoreと同じ規則で分母外(excusedへ数える)。
function taskWeekTriple(weeklyCommitments, taskId, weekStart) {
  const scope = weeklyCommittedItems(weeklyCommitments, weekStart);
  const items = scope.filter((item) => item && item.taskId === taskId);
  const excused = items.filter((item) => item.excused).length;
  const active = items.filter((item) => !item.excused);
  const done = active.filter((item) => item.completedAt).length;
  return { confirmed: active.length, done, excused };
}

// v336: 過去週の状態判定(§2.0/PLAN面の描き分け)。判定表:
// target=0,confirmed=0 → none / それ以外は 落ち=max(target,confirmed)-done で判定
// (落ち<=0→met / 1〜2→missed-1-2 / 3以上→missed-3+)。落ち量にtargetも見るのは、confirmed
// だけで測ると「目安3・確定0・完了0」の週が落ち0=metに丸め込まれてしまうため(R0レビューM1)。
function pastCellStatus(target, confirmed, done) {
  if (target === 0 && confirmed === 0) return "none";
  const missed = Math.max(target, confirmed) - done;
  if (missed <= 0) return "met";
  if (missed >= 3) return "missed-3+";
  return "missed-1-2";
}

// v336: 未来週の状態判定。
function futureCellStatus(target, confirmed) {
  if (target === 0) return "none";
  if (confirmed >= target) return "planned";
  if (confirmed === 0) return "unplanned";
  return "short";
}

// v336: tasks × weekStarts の目安/確定/完了グリッド。weekNoはweekStartsの並び順(1始まり)。
// cycleStartDateは検証用に受けるだけで日付展開はしない。currentWeekNoは呼び出し側が渡す
// (Dateを内部で生成しない)。
function taskPlanGrid(tasks, weeklyCommitments, cycleStartDate, weekStarts, currentWeekNo) {
  void cycleStartDate;
  const list = Array.isArray(tasks) ? tasks : [];
  const starts = Array.isArray(weekStarts) ? weekStarts : [];
  const current = Number(currentWeekNo);
  const rows = [];
  for (const task of list) {
    if (!task || !task.id) continue;
    starts.forEach((weekStart, index) => {
      const weekNo = index + 1;
      const target = planTargetForWeek(task, weekNo);
      const triple = taskWeekTriple(weeklyCommitments, task.id, weekStart);
      let status;
      if (Number.isFinite(current) && weekNo < current) status = pastCellStatus(target, triple.confirmed, triple.done);
      else if (Number.isFinite(current) && weekNo === current) status = "current";
      else status = futureCellStatus(target, triple.confirmed);
      rows.push({
        taskId: task.id, weekNo, weekStart,
        target, confirmed: triple.confirmed, done: triple.done, status
      });
    });
  }
  return rows;
}

// v336: currentWeekNoより後(currentWeekNo+1〜toWeek)の目安合計。不正入力は0。
function remainingTarget(task, currentWeekNo) {
  const current = Number(currentWeekNo);
  if (!Number.isFinite(current)) return 0;
  let total = 0;
  for (let week = current + 1; week <= 12; week++) total += planTargetForWeek(task, week);
  return total;
}

export {
  normalizeTwyPlan, planTargetForWeek, taskWeekTriple, taskPlanGrid, remainingTarget
};
