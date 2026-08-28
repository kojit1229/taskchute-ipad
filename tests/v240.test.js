// v240由来回帰: MIT/タスク候補UIを撤去し、残存action本体と旧state互換は維持する。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}`); }
}

console.log("[1] MIT候補の表示・操作経路だけを撤去する");
check("旧フィードバック候補rendererが無い", !/function\s+\w*FeedbackCandidatesHTML\b/.test(appSource));
check("aiMitChipsが無い", !/function\s+aiMitChips\b/.test(appSource));
check("adoptAiMitが無い", !/function\s+adoptAiMit\b/.test(appSource));
check("ai-mit-adopt action登録が無い", !appSource.includes('"ai-mit-adopt"'));
check("MIT候補コンテナを描画しない", !appSource.includes("data-mit-candidates") && !appSource.includes("data-feedback-candidates"));

console.log("[2] タスク候補UIは撤去し、残存action本体と旧stateデータは維持する");
check("タスク候補rendererが無い", !/function\s+aiTaskChips\b/.test(appSource));
check("タスク候補の採用・却下actionが残る", appSource.includes('"ai-task-adopt"') && appSource.includes('"ai-task-dismiss"'));
check("タスク候補コンテナを描画しない", !appSource.includes("data-task-candidates"));
check("journalMeta.aiMitCandidates互換データが残る", appSource.includes("aiMitCandidates"));

if (failures) {
  console.error(`\n❌ v240: ${failures}件失敗`);
  process.exit(1);
}
console.log("\n✅ v240: 全テストPASS");
