// data-contract-gate: 単位13(S-K2)+コーディネーター追補(2026-09-04)。
// scripts/data-contract-gate.jsのrunGate()を、実物のloop/*.sh・personal-data・app.jsではなく
// フィクスチャ(一致/パス違い/ファイル欠落/consumer不在/loop未clone/personal-data未clone/
// 単独clone)へ差し替えて検証する(依頼文の制約: モックではなく契約突合ロジック自体を
// PASS/FAILの両方向で機械判別すること)。node単体テスト(ブラウザ不要)。
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

function nonExistentDir(prefix) {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function silent() {} // ログを捨てて件数だけ検証する

const SNIPPET = 'fetchGitHubRawTextAtRoot("karada/health-daily.json")';
const SAMPLE_CONTRACT = [{
  resolvedPath: "karada/health-daily.json",
  consumer: "sample consumer",
  consumerSnippet: SNIPPET,
  writerScript: "karada-daily.sh",
  requiredPatterns: [/\$REPO\/karada\/health-daily\.json/]
}];

// (c)consumer検査用フィクスチャ: app.js/src/features/health.js を持つ最小ソースツリーを作る。
function mkSourceRoot(prefix, { includeSnippet }) {
  const root = mkTmp(prefix);
  fs.writeFileSync(path.join(root, "app.js"), "// dummy app.js (snippetなし)\n");
  const featuresDir = path.join(root, "src", "features");
  fs.mkdirSync(featuresDir, { recursive: true });
  const line = includeSnippet
    ? `const raw = await ${SNIPPET};\n`
    // 旧誤パス(taskchute/前置)へ戻したコピーを再現。これが今回のバグそのもの。
    : 'const raw = await fetchGitHubRawText("karada/health-daily.json");\n';
  fs.writeFileSync(path.join(featuresDir, "health.js"), line);
  return root;
}

console.log("[1] 一致ケース: writer/実ファイル/consumerすべて一致 → failures=0");
{
  const loopDir = mkTmp("dcg-loop-ok-");
  const pdataDir = mkTmp("dcg-pdata-ok-");
  const srcRoot = mkSourceRoot("dcg-src-ok-", { includeSnippet: true });
  fs.writeFileSync(path.join(loopDir, "karada-daily.sh"), 'mv "$REPO/karada/.tmp" "$REPO/karada/health-daily.json"\n');
  fs.mkdirSync(path.join(pdataDir, "karada"), { recursive: true });
  fs.writeFileSync(path.join(pdataDir, "karada", "health-daily.json"), "{}");
  const { failures: f, personalDataCloned, loopCloned } = runGate(SAMPLE_CONTRACT, loopDir, pdataDir, srcRoot, silent);
  check("failures=0", f === 0, f);
  check("personalDataCloned=true", personalDataCloned === true);
  check("loopCloned=true", loopCloned === true);
}

console.log("[2] パス違いケース(a): writerスクリプトに期待パターンが無い → failures>=1");
{
  const loopDir = mkTmp("dcg-loop-mismatch-");
  const pdataDir = mkTmp("dcg-pdata-mismatch-");
  const srcRoot = mkSourceRoot("dcg-src-mismatch-", { includeSnippet: true });
  // v314〜v327が固定していた誤パス相当(taskchute/karada/配下)をwriterが書く体で再現。
  fs.writeFileSync(path.join(loopDir, "karada-daily.sh"), 'mv "$REPO/.tmp" "$REPO/taskchute/karada/health-daily.json"\n');
  fs.mkdirSync(path.join(pdataDir, "karada"), { recursive: true });
  fs.writeFileSync(path.join(pdataDir, "karada", "health-daily.json"), "{}");
  const { failures: f } = runGate(SAMPLE_CONTRACT, loopDir, pdataDir, srcRoot, silent);
  check("(a)パス違いをfailuresとして検出", f >= 1, f);
}

console.log("[3] ファイル欠落ケース(b): writerは一致するがpersonal-data実ファイルが無い → failures>=1");
{
  const loopDir = mkTmp("dcg-loop-missingfile-");
  const pdataDir = mkTmp("dcg-pdata-missingfile-");
  const srcRoot = mkSourceRoot("dcg-src-missingfile-", { includeSnippet: true });
  fs.writeFileSync(path.join(loopDir, "karada-daily.sh"), 'mv "$REPO/karada/.tmp" "$REPO/karada/health-daily.json"\n');
  // pdataDir自体は存在する(clone済み扱い)がファイルは置かない。
  const { failures: f, personalDataCloned } = runGate(SAMPLE_CONTRACT, loopDir, pdataDir, srcRoot, silent);
  check("(b)ファイル欠落をfailuresとして検出", f >= 1, f);
  check("personalDataCloned=true(dirはある)", personalDataCloned === true);
}

console.log("[4] consumer不在ケース(c・本命): 旧誤パスへ戻したコピーは(a)(b)が一致していてもfailures>=1");
{
  const loopDir = mkTmp("dcg-loop-revert-");
  const pdataDir = mkTmp("dcg-pdata-revert-");
  // 旧誤パスへ「戻した」ソース(includeSnippet:false = 今回直す前のリテラルに復元したコピー)。
  const srcRoot = mkSourceRoot("dcg-src-revert-", { includeSnippet: false });
  fs.writeFileSync(path.join(loopDir, "karada-daily.sh"), 'mv "$REPO/karada/.tmp" "$REPO/karada/health-daily.json"\n');
  fs.mkdirSync(path.join(pdataDir, "karada"), { recursive: true });
  fs.writeFileSync(path.join(pdataDir, "karada", "health-daily.json"), "{}");
  const { failures: f } = runGate(SAMPLE_CONTRACT, loopDir, pdataDir, srcRoot, silent);
  check("(a)(b)一致でも(c)consumer不在をfailuresとして検出(退行再発防止の本体)", f >= 1, f);
}

console.log("[5] personal-data未cloneケース: (b)はスキップされfailuresに数えない");
{
  const loopDir = mkTmp("dcg-loop-noclone-");
  const pdataDir = nonExistentDir("dcg-pdata-does-not-exist");
  const srcRoot = mkSourceRoot("dcg-src-noclone-", { includeSnippet: true });
  fs.writeFileSync(path.join(loopDir, "karada-daily.sh"), 'mv "$REPO/karada/.tmp" "$REPO/karada/health-daily.json"\n');
  const { failures: f, personalDataCloned } = runGate(SAMPLE_CONTRACT, loopDir, pdataDir, srcRoot, silent);
  check("personal-data未cloneでも(a)(c)一致ならfailures=0", f === 0, f);
  check("personalDataCloned=false", personalDataCloned === false);
}

console.log("[6] writerスクリプト自体が無い(loop/はあるがファイル欠落) → failures>=1");
{
  const loopDir = mkTmp("dcg-loop-noscript-");
  const pdataDir = nonExistentDir("dcg-pdata-does-not-exist");
  const srcRoot = mkSourceRoot("dcg-src-noscript-", { includeSnippet: true });
  const { failures: f, loopCloned } = runGate(SAMPLE_CONTRACT, loopDir, pdataDir, srcRoot, silent);
  check("loopCloned=trueだがwriter不在をfailuresとして検出", f >= 1 && loopCloned === true, f);
}

console.log("[7] loop/ディレクトリ自体が無いケース(追補指摘2): (a)はスキップされfailuresに数えない");
{
  const loopDir = nonExistentDir("dcg-loop-does-not-exist");
  const pdataDir = nonExistentDir("dcg-pdata-does-not-exist");
  const srcRoot = mkSourceRoot("dcg-src-noloopdir-", { includeSnippet: true });
  const { failures: f, loopCloned, personalDataCloned } = runGate(SAMPLE_CONTRACT, loopDir, pdataDir, srcRoot, silent);
  check("loop/丸ごと不在でも(a)スキップ・(c)一致でfailures=0(単独clone/CI相当)", f === 0, f);
  check("loopCloned=false", loopCloned === false);
  check("personalDataCloned=false", personalDataCloned === false);
}

console.log("[8] 実運用の契約表(CONTRACT)を本物のscripts/data-contract-gate.js require結果で確認");
{
  const { CONTRACT } = require("../scripts/data-contract-gate.js");
  check("CONTRACTに3エントリ(health/ai-insights/fund参考)", CONTRACT.length === 3, CONTRACT.length);
  check("health-dailyの実配置パスがtaskchute/前置なし", CONTRACT.some((e) => e.resolvedPath === "karada/health-daily.json"));
  check("ai-insightsの実配置パスがdashboard/配下", CONTRACT.some((e) => e.resolvedPath === "taskchute/dashboard/ai-insights.json"));
  check("全エントリにconsumerSnippetがある((c)検査の対象)", CONTRACT.every((e) => typeof e.consumerSnippet === "string" && e.consumerSnippet.length > 0));
}

console.log("[9] 実物のapp.js/src/features/*.jsに対して本番CONTRACTをsourceRoot既定(引数省略)で実行 → (c)は全件一致");
{
  const { CONTRACT } = require("../scripts/data-contract-gate.js");
  // sourceRootを省略し、data-contract-gate.js自身の既定値(このリポジトリのROOT)で(c)を検査する。
  // loop/personal-dataは存在しない一時ディレクトリを渡し(a)(b)をスキップさせ、(c)だけを見る。
  const loopDir = nonExistentDir("dcg-loop-real-src-check");
  const pdataDir = nonExistentDir("dcg-pdata-real-src-check");
  const { failures: f } = runGate(CONTRACT, loopDir, pdataDir, undefined, silent);
  check("実物ソースに対し本番CONTRACTの(c)がすべて一致(このコミットのapp.js/health.js/fund.jsが対象)", f === 0, f);
}

if (failures) {
  console.error(`\n❌ data-contract-gate.test: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\n✅ data-contract-gate.test: all checks passed");
