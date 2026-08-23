// v240: Today ATISのMIT候補チップを全撤去し、タスク候補と旧state互換は維持する。
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
check("atisFeedbackCandidatesHTMLが無い", !/function\s+atisFeedbackCandidatesHTML\b/.test(appSource));
check("aiMitChipsが無い", !/function\s+aiMitChips\b/.test(appSource));
check("adoptAiMitが無い", !/function\s+adoptAiMit\b/.test(appSource));
check("ai-mit-adopt action登録が無い", !appSource.includes('"ai-mit-adopt"'));
check("MIT候補コンテナを描画しない", !appSource.includes("data-atis-mit-candidates") && !appSource.includes("data-atis-feedback-candidates"));

console.log("[2] タスク候補UIと旧stateデータは維持する");
check("aiTaskChipsが残る", /function\s+aiTaskChips\b/.test(appSource));
check("タスク候補の採用・却下actionが残る", appSource.includes('"ai-task-adopt"') && appSource.includes('"ai-task-dismiss"'));
check("タスク候補コンテナが残る", appSource.includes("data-atis-task-candidates"));
check("journalMeta.aiMitCandidates互換データが残る", appSource.includes("aiMitCandidates"));

if (failures) {
  console.error(`\n❌ v240: ${failures}件失敗`);
  process.exit(1);
}
console.log("\n✅ v240: 全テストPASS");
