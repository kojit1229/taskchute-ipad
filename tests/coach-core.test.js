// AI Coach phase 1a deterministic aggregation tests (browser-free).
const path = require("path");
const { pathToFileURL } = require("url");

const COACH_PATH = path.join(__dirname, "..", "src", "features", "coach.js");
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const { coachSummaryForDate, trimCoachMeals, markCoachMealDeleted } =
    await import(pathToFileURL(COACH_PATH).href);
  const today = "2026-08-12";
  const meals = [
    { id: "a", date: today, quickKcal: 700 },
    { id: "b", date: today, quickKcal: 150 },
    { id: "c", date: today, quickKcal: 300, deleted: true },
    { id: "d", date: "2026-08-11", quickKcal: 800 }
  ];

  console.log("[1] 今日の合計は当日かつ未削除の食事だけを集計する");
  const summary = coachSummaryForDate(meals, today, 2278);
  check("今日の合計は850kcal", summary.total === 850, JSON.stringify(summary));
  check("今日の表示対象は2件", summary.entries.length === 2, JSON.stringify(summary.entries));

  console.log("[2] 残りkcalはdailyKcal−今日の合計");
  check("残りは1,428kcal", summary.remaining === 1428, JSON.stringify(summary));

  console.log("[3] 90日トリミングは当日を含む直近90日を保持する");
  const trimmed = trimCoachMeals([
    { id: "old", date: "2026-05-14", quickKcal: 100 },
    { id: "edge", date: "2026-05-15", quickKcal: 200 },
    { id: "today", date: today, quickKcal: 300 },
    { id: "future", date: "2026-08-13", quickKcal: 400 }
  ], today);
  check("90日前は除外し、境界日・当日・未来日の3件を保持", trimmed.map((m) => m.id).join(",") === "edge,today,future", JSON.stringify(trimmed));
  const overLimit = Array.from({ length: 505 }, (_, index) => ({
    id: `limit-${index}`, date: today, quickKcal: 1
  }));
  const capped = trimCoachMeals(overLimit, today);
  check("保持期間内でも最新500件を上限にする", capped.length === 500 && capped[0].id === "limit-5", JSON.stringify(capped.slice(0, 2)));

  console.log("[4] 取り消しはtombstone化し、合計と残りを再計算する");
  const afterDelete = markCoachMealDeleted(meals, "a");
  const recalculated = coachSummaryForDate(afterDelete, today, 2278);
  check("元配列はappend-onlyデータとして未変更", meals[0].deleted !== true, JSON.stringify(meals[0]));
  check("対象レコードがdeleted:trueになる", afterDelete[0].deleted === true, JSON.stringify(afterDelete[0]));
  check("tombstoneに同期競合解決用updatedAt(ISO)を刻む", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(afterDelete[0].updatedAt || ""), JSON.stringify(afterDelete[0]));
  check("削除後の合計は150kcal", recalculated.total === 150, JSON.stringify(recalculated));
  check("削除後の残りは2,128kcal", recalculated.remaining === 2128, JSON.stringify(recalculated));

  console.log(failures === 0 ? "\ncoach-core: 全件成功" : `\ncoach-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
