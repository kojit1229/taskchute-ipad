// data-contract-gate: 単位13(S-K2)。scripts/data-contract-gate.jsのrunGate()を、実物のloop/*.sh・
// personal-dataではなくフィクスチャ(一致/パス違い/ファイル欠落/未clone)へ差し替えて検証する
// (依頼文の制約: モックではなく契約突合ロジック自体をPASS/FAILの両方向で機械判別すること)。
// node単体テスト(ブラウザ不要)。
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runGate } = require("../scripts/data-contract-gate.js");

let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function silent() {} // ログを捨てて件数だけ検証する

const SAMPLE_CONTRACT = [{
  resolvedPath: "karada/health-daily.json",
  consumer: "sample consumer",
  writerScript: "karada-daily.sh",
  requiredPatterns: [/\$REPO\/karada\/health-daily\.json/]
}];

console.log("[1] 一致ケース: writerパターン一致 + 実ファイル存在 → failures=0");
{
  const loopDir = mkTmp("dcg-loop-ok-");
  const pdataDir = mkTmp("dcg-pdata-ok-");
  fs.writeFileSync(path.join(loopDir, "karada-daily.sh"), 'mv "$REPO/karada/.tmp" "$REPO/karada/health-daily.json"\n');
  fs.mkdirSync(path.join(pdataDir, "karada"), { recursive: true });
  fs.writeFileSync(path.join(pdataDir, "karada", "health-daily.json"), "{}");
  const { failures: f, personalDataCloned } = runGate(SAMPLE_CONTRACT, loopDir, pdataDir, silent);
  check("failures=0", f === 0, f);
  check("personalDataCloned=true", personalDataCloned === true);
}

console.log("[2] パス違いケース: writerスクリプトに期待パターンが無い → failures>=1");
{
  const loopDir = mkTmp("dcg-loop-mismatch-");
  const pdataDir = mkTmp("dcg-pdata-mismatch-");
  // v314〜v327が固定していた誤パス相当(taskchute/karada/配下)をwriterが書く体で再現。
  fs.writeFileSync(path.join(loopDir, "karada-daily.sh"), 'mv "$REPO/.tmp" "$REPO/taskchute/karada/health-daily.json"\n');
  fs.mkdirSync(path.join(pdataDir, "karada"), { recursive: true });
  fs.writeFileSync(path.join(pdataDir, "karada", "health-daily.json"), "{}");
  const { failures: f } = runGate(SAMPLE_CONTRACT, loopDir, pdataDir, silent);
  check("パス違いをfailuresとして検出", f >= 1, f);
}

console.log("[3] ファイル欠落ケース: writerは一致するがpersonal-data実ファイルが無い → failures>=1");
{
  const loopDir = mkTmp("dcg-loop-missingfile-");
  const pdataDir = mkTmp("dcg-pdata-missingfile-");
  fs.writeFileSync(path.join(loopDir, "karada-daily.sh"), 'mv "$REPO/karada/.tmp" "$REPO/karada/health-daily.json"\n');
  // pdataDir自体は存在する(clone済み扱い)がファイルは置かない。
  const { failures: f, personalDataCloned } = runGate(SAMPLE_CONTRACT, loopDir, pdataDir, silent);
  check("ファイル欠落をfailuresとして検出", f >= 1, f);
  check("personalDataCloned=true(dirはある)", personalDataCloned === true);
}

console.log("[4] 未cloneケース: personal-dataディレクトリが無ければ(b)はスキップし(a)のみで判定");
{
  const loopDir = mkTmp("dcg-loop-noclone-");
  const pdataDir = path.join(os.tmpdir(), "dcg-pdata-does-not-exist-" + Date.now());
  fs.writeFileSync(path.join(loopDir, "karada-daily.sh"), 'mv "$REPO/karada/.tmp" "$REPO/karada/health-daily.json"\n');
  const { failures: f, personalDataCloned } = runGate(SAMPLE_CONTRACT, loopDir, pdataDir, silent);
  check("未cloneでも(a)一致ならfailures=0", f === 0, f);
  check("personalDataCloned=false", personalDataCloned === false);
}

console.log("[5] writerスクリプト自体が無い → failures>=1(未clone下でも検出)");
{
  const loopDir = mkTmp("dcg-loop-noscript-");
  const pdataDir = path.join(os.tmpdir(), "dcg-pdata-does-not-exist-" + Date.now());
  const { failures: f } = runGate(SAMPLE_CONTRACT, loopDir, pdataDir, silent);
  check("writer不在をfailuresとして検出", f >= 1, f);
}

console.log("[6] 実運用の契約表(CONTRACT)を本物のscripts/data-contract-gate.js require結果で確認");
{
  const { CONTRACT } = require("../scripts/data-contract-gate.js");
  check("CONTRACTに3エントリ(health/ai-insights/fund参考)", CONTRACT.length === 3, CONTRACT.length);
  check("health-dailyの実配置パスがtaskchute/前置なし", CONTRACT.some((e) => e.resolvedPath === "karada/health-daily.json"));
  check("ai-insightsの実配置パスがdashboard/配下", CONTRACT.some((e) => e.resolvedPath === "taskchute/dashboard/ai-insights.json"));
}

if (failures) {
  console.error(`\n❌ data-contract-gate.test: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\n✅ data-contract-gate.test: all checks passed");
