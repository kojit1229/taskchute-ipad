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

console.log("[2] タスク候補UIは撤去し、旧stateデータは維持する");
check("タスク候補rendererが無い", !/function\s+aiTaskChips\b/.test(appSource));
// Test-Reduction: 「タスク候補の採用・却下actionが残る」(ai-task-adopt/ai-task-dismissの
// action登録が存在することを直接検証する肯定チェック)は、R3(v290)で対象関数
// adoptAiTaskCandidate/dismissAiTaskCandidateごとaction登録を削除したため削除
// (K裁定2026-08-27=ATIS6機能の完全廃止の最終段階)。移行先の同等検証は無い(機能自体の廃止のため)。
check("タスク候補コンテナを描画しない", !appSource.includes("data-task-candidates"));
check("journalMeta.aiMitCandidates互換データが残る", appSource.includes("aiMitCandidates"));

if (failures) {
  console.error(`\n❌ v240: ${failures}件失敗`);
  process.exit(1);
}
console.log("\n✅ v240: 全テストPASS");
