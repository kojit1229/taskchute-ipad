// v59由来回帰 / v299追随: 廃止した朝プランを復活させず、維持対象の下書きスケジュールを固定する。
// Test-Reduction: v59の旧挙動本体(runAiMorningPlan)をv299で削除したため、旧E2Eを
// 「削除対象が存在しないこと」と「移行先ではなく独立維持のai-scheduleが残ること」の静的契約へ更新。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const timelineSource = fs.readFileSync(path.join(ROOT, "src", "features", "timeline.js"), "utf8");

let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

console.log("[1] v299: 朝プランのaction・本体・専用候補生成を削除");
check("ai-morning-plan actionが存在しない", !appSource.includes('"ai-morning-plan"'));
check("runAiMorningPlan本体が存在しない", !/\bfunction\s+runAiMorningPlan\b/.test(appSource));
check("aiScheduleCandidates本体が存在しない", !/\bfunction\s+aiScheduleCandidates\b/.test(appSource));
check("朝プラン専用in-flight stateが存在しない", !appSource.includes("_morningPlanInFlight"));

console.log("[2] 維持対象: 下書きスケジュールのaction・本体・Timeline導線");
check("ai-schedule actionを維持", appSource.includes('"ai-schedule": () => runAiSchedule()'));
check("runAiSchedule本体を維持", /\bfunction\s+runAiSchedule\s*\(/.test(appSource));
check("_scheduleDraftを維持", /\blet\s+_scheduleDraft\s*=\s*null/.test(appSource));
check("Timelineの下書きボタンを維持", timelineSource.includes('data-action="ai-schedule"'));
check("下書き確定actionを維持", appSource.includes('"draft-confirm": () => confirmScheduleDraft()'));

console.log(failures === 0 ? "\nv59: 全件成功" : `\nv59: ${failures}件失敗`);
process.exit(failures === 0 ? 0 : 1);
