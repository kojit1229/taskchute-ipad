// v193由来回帰 / v299追随: 廃止したオンデマンド再プラン一式の不在を固定する。
// Test-Reduction: requestReplan/ポーリング本体をv299で削除したため、旧response分岐E2Eを
// 削除対象のソース不在と、別機能であるplan-stepポーリングの維持契約へ更新する。
const fs = require("fs");
const path = require("path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

console.log("[1] v299: AI再プランのaction・request・polling・UIを削除");
check("today-replan actionが存在しない", !appSource.includes('"today-replan"'));
check("requestReplan本体が存在しない", !/\bfunction\s+requestReplan\b/.test(appSource));
check("再プランpending stateが存在しない", !appSource.includes("_replanPending"));
check("再プランpoll定数が存在しない", !/\bREPLAN_(?:POLL|TIMEOUT)_MS\b/.test(appSource));
check("再プラン案内DOMが存在しない", !appSource.includes("data-replan-guide"));
check("ai-replan由来のdraft sourceが存在しない", !appSource.includes('source: "ai-replan"'));

console.log("[2] 維持対象: 実行計画(plan-step)の非同期契約");
check("plan-step-request actionを維持", appSource.includes('"plan-step-request"'));
check("requestPlanStep本体を維持", /\basync\s+function\s+requestPlanStep\b/.test(appSource));
check("plan-step poll間隔60秒を維持", /PLAN_STEP_POLL_MS\s*=\s*60\s*\*\s*1000/.test(appSource));
check("plan-step timeout15分を維持", /PLAN_STEP_TIMEOUT_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/.test(appSource));

console.log(failures === 0 ? "\nv193: 全件成功" : `\nv193: ${failures}件失敗`);
process.exit(failures === 0 ? 0 : 1);
