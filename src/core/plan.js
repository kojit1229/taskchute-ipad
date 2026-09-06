// src/core/plan.js — R0: task.twyPlan(週次目安)のデータ契約と、タスク×週の
// 「目安・確定・完了」3数を返す純関数群。state / store.js / app.js を一切importしない葉モジュール
// (track.jsと同じ依存ゼロの契約。詳細: workbench/out/2026-09-04-12wy-tab-mock/12wy-tab-design.md §2.0)。
// track.js(同じsrc/core配下の依存ゼロの葉)から採点分母抽出・日付演算を二重実装しないためimportする
// (track.jsの挙動は変えない=track-coreは緑のまま)。
import { weeklyCommittedItems, weeklyScore, dateParts, daysBetween } from "./track.js";

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

// v357(R1b): UTC日付演算(design §2.1)。new Date(文字列)は使わず数値コンストラクタだけを使う。
function isoOfUTCms(ms) {
  const d = new Date(ms), pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addDaysISO(iso, delta) {
  const p = dateParts(iso);
  if (!p) return "";
  return isoOfUTCms(Date.UTC(p.y, p.m - 1, p.d) + delta * 86400000);
}
// app.js weekRange()相当(土曜始まり)を文字列演算のみで再現する。
function weekStartOfISO(iso) {
  const p = dateParts(iso);
  if (!p) return "";
  const dow = (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 1) % 7; // Sat=0
  return addDaysISO(iso, -dow);
}

// v357(R1b): 13 WEEKSバー集計(design §2.1裁定7=案A)。W1〜W12はweeklyScore()週ごと適用でscored週
// だけの平均(avg12)を正本とし、W13は別枠で確定コマ数(免除除く)が閾値以上の時だけ参考平均を出す。
function cycleWeeksSummary(weeklyCommitments, settings, cycleStartDate, todayISO) {
  const settingsObj = settings && typeof settings === "object" ? settings : {};
  const targetRaw = Number(settingsObj.twelveWeekScoreTarget);
  const target = Number.isFinite(targetRaw) ? targetRaw : 85;
  const minRaw = Number(settingsObj.twelveWeekReviewWeekMinItems);
  const reviewMin = Number.isFinite(minRaw) && minRaw >= 0 ? Math.floor(minRaw) : 3;
  const empty = {
    weeks: [], avg12: null,
    reviewWeek: { committedCount: 0, pct: null, eligible: false },
    avgWithReview: null, target, remainingDays: 0, cycleEnded: false
  };
  if (!dateParts(cycleStartDate) || !dateParts(todayISO)) return empty;

  // A-M2/review-r1-claude-a2.md M1: weekNo(=当週判定)の正本はtopband.js cycleWeekForDate()と
  // 同じ式(経過日数÷7+1、cycleStartDate起点)。weeklyScore()の週キーは既存契約どおり
  // weekStartOfISO(土曜スナップ)起点の7日刻み(week1Start)のまま変えない——採点(weeklyScore)は
  // 土曜キーを正本、表示(週番号・isCurrent)はcycleWeekForDateを正本とする2基準併存が既定。
  // cycleStartDateが土曜以外だと両者は一致しない(non-Saturday開始の週は「暦週」と「経過日数の
  // 週窓」が最大6日ずれる)。この既知の食い違いはUIでは各週バーのツールチップに実スパン日付
  // (weekStart〜weekEnd)を出して補う(twelve-week.js twyWeekTitle。isCurrentはweekNo===
  // cycleWeekForDate(today)で判定し続ける=weekStart基準へは戻さない)。
  const week1Start = weekStartOfISO(cycleStartDate);
  const elapsedRaw = daysBetween(cycleStartDate, todayISO);
  const elapsed = Number.isFinite(elapsedRaw) ? elapsedRaw : 0;
  const effectiveWeekNo = Math.max(1, Math.min(13, Math.floor(elapsed / 7) + 1));
  // A-M1: W13末(cycleStartDate+90日)を過ぎたらisCurrentを全falseにする(過去週の実データ
  // 描画自体は維持=effectiveWeekNoは13にclampしたまま各週を評価する)。
  const cycleEnded = elapsed > 90;
  // R2 fix3 M1: 開始前は当週も採点済み週も無い。未来の確定データを平均へ混ぜない。
  const currentWeekNo = elapsed < 0 || cycleEnded ? null : effectiveWeekNo;
  const weeks = [];
  let sumPct = 0, countScored = 0;
  for (let weekNo = 1; weekNo <= 13; weekNo++) {
    const weekStart = addDaysISO(week1Start, (weekNo - 1) * 7);
    const isReviewWeek = weekNo === 13;
    let status = "future", pct = null;
    if (elapsed >= 0 && weekNo <= effectiveWeekNo) {
      const score = weeklyScore(weeklyCommitments, weekStart);
      status = score.status;
      if (status === "scored") pct = score.pct;
    }
    if (!isReviewWeek && status === "scored") { sumPct += pct; countScored += 1; }
    // M1: weekEndはUI側のツールチップ用(weekStart〜weekEndの実スパンを見せて土曜キーとの
    // 食い違いを利用者に伝える)。weeklyScore()の週判定自体はweekStartのみ使用し不変。
    const weekEnd = addDaysISO(weekStart, 6);
    weeks.push({ weekNo, weekStart, weekEnd, status, pct, isCurrent: currentWeekNo !== null && weekNo === currentWeekNo, isReviewWeek });
  }
  const reviewEntry = weeks[12];
  const committedCount = weeklyCommittedItems(weeklyCommitments, reviewEntry.weekStart)
    .filter((item) => !item.excused).length;
  const eligible = committedCount >= reviewMin;
  const avg12 = countScored ? Math.round(sumPct / countScored) : null;
  // review-r1-claude-a2.md L3: avg12がnull(countScored=0)のときはW13単独値を「参考平均」と
  // して出さない(平均not-availableの週にreviewWeek単独値だけ出るのは紛らわしいため)。
  const avgWithReview = eligible && reviewEntry.pct !== null && countScored > 0
    ? Math.round((sumPct + reviewEntry.pct) / (countScored + 1)) : null;
  // review-r1-claude-a2.md M2: today<cycleStartDate(elapsed<0)では83-elapsedが83を超える
  // ため上限もclampする(cycleStartDate未到来の設定時にフッタの残日数が発散しないように)。
  const remainingDays = Math.max(0, Math.min(83, 83 - elapsed));
  return {
    weeks, avg12,
    reviewWeek: { committedCount, pct: reviewEntry.pct, eligible },
    avgWithReview, target, remainingDays, cycleEnded
  };
}

export {
  normalizeTwyPlan, planTargetForWeek, taskWeekTriple, taskPlanGrid, remainingTarget, cycleWeeksSummary, weekStartOfISO
};
