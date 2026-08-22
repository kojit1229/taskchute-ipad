// v235 検証: 主観睡眠時間(condition.logs.sleepHours)の入力UI・書き込み経路を廃止。
// v236: 到達不能になった日次結合関数は不存在へ追従する。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const journalSource = fs.readFileSync(path.join(ROOT, "src", "features", "journal.js"), "utf8");
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

console.log("[1] journalの主観睡眠入力UI・action・書き込み関数は廃止され、旧state既定形は残る");
check("睡眠プリセットUIが無い", !journalSource.includes('data-action="set-sleep"'));
check("set-sleep action登録が無い", !journalSource.includes('"set-sleep":'));
check("setConditionSleep書き込み関数が無い", !journalSource.includes("function setConditionSleep"));
check("睡眠プリセット定数が無い", !journalSource.includes("CONDITION_SLEEP_PRESETS"));
check("旧state互換のsleepHours:null既定形は温存", /sleepHours:\s*null/.test(journalSource));

console.log("[2] 到達不能の日次結合関数は削除済み");
check("computeDailyMetrics宣言が無い", !/\bfunction\s+computeDailyMetrics\b/.test(appSource));

if (failures) {
  console.error(`\n❌ v235: ${failures}件失敗`);
  process.exit(1);
}
console.log("\n✅ v235: 全テストPASS");
